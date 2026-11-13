import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 086 server-side financial write freeze (backup -> restart window) + server-side T0 validation (PHASE F2, 2026-11-13).
// The 085 business rules are unchanged (covered by the 085 suites, which now freeze before their restarts).
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 086 — financial write freeze + T0 on the server", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-0000000008a6";
  const org2 = "00000000-0000-0000-0000-0000000008b6";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S: U, S2: U;
  let c1 = "", c2 = "";
  let kn = 0;
  const key = (p: string) => `f86-${p}-${++kn}`;
  const RATE = 900000;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const freeze = async (o: string, on: boolean) => (await one(`SELECT public._goldia_financial_freeze('${o}', 'test window', ${on}) r`)).r as Record<string, unknown>;
  const verify = async (o = org) => (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${o}', 'f86.dump', true) RETURNING id`)).id as string;
  const legacy = (c: string) => `public.rpc_record_client_legacy_debt(p_customer_id := '${c}', p_balance_type := 'debt', p_amount_585_g := ${1 + kn / 100}, p_as_of_date := CURRENT_DATE, p_idempotency_key := '${key("leg")}')`;
  const restart = (t0: string, bv: string) => `SELECT public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'f86', ${t0}, '${bv}', '${key("rs")}')`;

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-86', 'Goldia 86', 'ACTIVE'), ('${org2}', 'other-86', 'Other 86', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-86@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-86@goldia.uz", "Menejer", "manager");
    S = await t.addUser(org, "s-86@goldia.uz", "Sotuvchi", "sales");
    S2 = await t.addUser(org2, "s2-86@goldia.uz", "Sotuvchi 2", "sales");
    c1 = (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id) VALUES ('${org}', 'K86-1', 'Mijoz 1', '+998900008601', '${S.employeeId}') RETURNING id`)).id as string;
    c2 = (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id) VALUES ('${org2}', 'K86-2', 'Mijoz 2', '+998900008602', '${S2.employeeId}') RETURNING id`)).id as string;
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, ${RATE}, 'UZS', true), ('${org2}', CURRENT_DATE, 585, ${RATE}, 'UZS', true)`);
  }, 180000);

  it("F0 085 alone has no backup -> restart protection: after a backup verification an ordinary write still passes", async () => {
    await verify();
    await t.asUser(S.userId);
    const r = await t.rpc(`SELECT ${legacy(c1)}`.replace(/^SELECT /, ""));
    expect(r).toBeTruthy();
  });

  it("F1 restart refused without a freeze (ERR_FREEZE_REQUIRED); nothing changed", async () => {
    const bv = await verify();
    await t.asUser(dir.userId);
    await t.expectError(restart("now()", bv), "ERR_FREEZE_REQUIRED");
    expect(N((await one(`SELECT count(*) n FROM public.financial_restarts`)).n)).toBe(0);
    expect((await one(`SELECT consumed_by_restart_id x FROM public.financial_backup_verifications WHERE id = '${bv}'`)).x).toBeNull();
  });

  it("F2 freeze: every ordinary financial write of the organization refused for seller, manager and director; customers still allowed; the other organization works", async () => {
    const f = await freeze(org, true);
    expect(f.status).toBe("frozen");
    expect((await freeze(org, true)).status).toBe("already_active");
    await t.asUser(S.userId);
    await t.expectError(`SELECT ${legacy(c1)}`, "ERR_FINANCIAL_FREEZE");
    await t.expectError(`SELECT public.rpc_record_client_settlement(p_customer_id := '${c1}', p_cash_amount := 900000, p_rate_per_gram := ${RATE})`, "ERR_FINANCIAL_FREEZE");
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_record_financial_transaction(p_transaction_type := 'capital_contribution', p_source_till := 'manager_uzs', p_amount := 1000, p_currency := 'UZS', p_gold_rate := ${RATE}, p_idempotency_key := '${key("cap")}')`, "ERR_FINANCIAL_FREEZE");
    await t.expectError(`SELECT public.rpc_record_factory_receipt(p_product_name := 'x', p_original_physical_g := 1, p_factory_markup_pct := 8, p_idempotency_key := '${key("rc")}')`, "ERR_FINANCIAL_FREEZE");
    await t.asUser(dir.userId);
    await t.expectError(`SELECT public.rpc_record_financial_transaction(p_transaction_type := 'capital_contribution', p_source_till := 'manager_uzs', p_amount := 2000, p_currency := 'UZS', p_gold_rate := ${RATE}, p_idempotency_key := '${key("cap2")}')`, "ERR_FINANCIAL_FREEZE");
    // a direct table write by the service role is refused as well (the trigger is the guard, not the RPC)
    await t.asAdmin();
    await t.expectError(`INSERT INTO public.client_legacy_debts (organization_id, customer_id, seller_id, balance_type, amount_585_g, delta_585_g, as_of_date, status)
      VALUES ('${org}', '${c1}', '${S.employeeId}', 'debt', 1, 1, CURRENT_DATE, 'active')`, "ERR_FINANCIAL_FREEZE");
    // other organization: not affected
    await t.asUser(S2.userId);
    expect(await t.rpc(legacy(c2))).toBeTruthy();
  });

  it("F3 permissions: signed-in users cannot freeze / unfreeze or write the freeze table; they read their own organization's freeze only", async () => {
    await t.asUser(dir.userId);
    await t.expectError(`SELECT public._goldia_financial_freeze('${org}', 'x', false)`, "permission denied");
    await t.expectError(`UPDATE public.financial_write_freezes SET released_at = now()`, "permission denied");
    const own = await t.db.query(`SELECT organization_id FROM public.financial_write_freezes`);
    expect(own.rows.length).toBe(1);
    await t.asUser(S2.userId);
    expect((await t.db.query(`SELECT 1 FROM public.financial_write_freezes`)).rows.length).toBe(0);
  });

  it("F4 T0 on the server: future, older than 24 h and more than 1 h before the freeze are refused (whole restart rolled back)", async () => {
    const bv = await verify();
    await t.asUser(dir.userId);
    await t.expectError(restart("now() + interval '10 minutes'", bv), "ERR_T0_FUTURE");
    await t.expectError(restart("now() - interval '25 hours'", bv), "ERR_T0_TOO_OLD");
    // a browser in another zone: "10:00" typed, Tokyo +09 instead of Tashkent +05 = 4 h too early, before the freeze
    await t.expectError(restart("now() - interval '4 hours'", bv), "ERR_T0_BEFORE_FREEZE");
    expect(N((await one(`SELECT count(*) n FROM public.financial_restarts`)).n)).toBe(0);
    expect(N((await one(`SELECT count(*) n FROM public.opening_periods`)).n)).toBe(0);
  });

  it("F5 restart inside the freeze with a valid T0; opening documents pass the freeze; the lock ends the freeze and ordinary work resumes", async () => {
    const bv = await verify();
    await t.asUser(dir.userId);
    const r = await t.rpc(restart("now() - interval '1 minute'", bv).replace(/^SELECT /, ""));
    expect(r.status).toBe("ok");
    await t.asUser(mgr.userId);
    const d = await t.rpc(`public.rpc_record_opening_document(p_kind := 'manager_cash', p_unit := 'UZS', p_amount := 1000000, p_idempotency_key := '${key("d")}')`);
    expect(d.status).toBe("ok");
    await t.asUser(S.userId);
    await t.expectError(`SELECT ${legacy(c1)}`, "ERR_OPENING_DRAFT"); // the draft guard speaks first
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'T0', p_idempotency_key := '${key("b")}', p_usd_rate := 12500)`);
    expect((await one(`SELECT public._goldia_active_freeze('${org}') a`)).a).toBeNull();
    await t.asUser(S.userId);
    expect(await t.rpc(legacy(c1))).toBeTruthy();
  });

  it("F6 explicit release (abort before a restart): writes resume; the freeze history is kept and audited", async () => {
    expect((await freeze(org2, true)).status).toBe("frozen");
    await t.asUser(S2.userId);
    await t.expectError(`SELECT ${legacy(c2)}`, "ERR_FINANCIAL_FREEZE");
    expect((await freeze(org2, false)).status).toBe("released");
    await t.asUser(S2.userId);
    expect(await t.rpc(legacy(c2))).toBeTruthy();
    expect(N((await one(`SELECT count(*) n FROM public.financial_write_freezes WHERE organization_id = '${org2}' AND released_at IS NOT NULL`)).n)).toBe(1);
    expect(N((await one(`SELECT count(*) n FROM public.audit_logs WHERE action IN ('FINANCIAL_FREEZE_ON', 'FINANCIAL_FREEZE_OFF') AND organization_id = '${org2}'`)).n)).toBe(2);
  });
});
