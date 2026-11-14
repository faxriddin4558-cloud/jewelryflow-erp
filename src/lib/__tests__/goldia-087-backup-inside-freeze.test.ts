import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 087 (PHASE F3 audit, 2026-11-14): a restart accepts only a backup verification written INSIDE the active freeze, and one
// freeze serves one restart. Closes: a verification written before the freeze (or a spare verification of the same backup)
// reused for a restart the backup does not cover.
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 087 — backup verification inside the freeze, one restart per freeze", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-0000000008a7";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S: U;
  let c1 = "";
  let kn = 0;
  const key = (p: string) => `g87-${p}-${++kn}`;
  const RATE = 900000;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const freeze = async (on: boolean) => (await one(`SELECT public._goldia_financial_freeze('${org}', 'g87 window', ${on}) r`)).r as Record<string, unknown>;
  const verify = async () => (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 'g87.dump', true) RETURNING id`)).id as string;
  const restart = (bv: string) => `SELECT public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'g87', now() - interval '1 minute', '${bv}', '${key("rs")}')`;
  const restarts = async () => N((await one(`SELECT count(*) n FROM public.financial_restarts WHERE organization_id = '${org}'`)).n);
  const consumed = async (bv: string) => (await one(`SELECT consumed_by_restart_id x FROM public.financial_backup_verifications WHERE id = '${bv}'`)).x;
  const lock = async () => {
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_record_opening_document(p_kind := 'manager_cash', p_unit := 'UZS', p_amount := 1000, p_idempotency_key := '${key("d")}')`);
    await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'T0', p_idempotency_key := '${key("b")}', p_usd_rate := 12500)`);
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-87', 'Goldia 87', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-87@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-87@goldia.uz", "Menejer", "manager");
    S = await t.addUser(org, "s-87@goldia.uz", "Sotuvchi", "sales");
    c1 = (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id) VALUES ('${org}', 'K87-1', 'Mijoz 1', '+998900008701', '${S.employeeId}') RETURNING id`)).id as string;
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, ${RATE}, 'UZS', true)`);
  }, 180000);

  it("G1 a verification written BEFORE the freeze is refused (ERR_BACKUP_BEFORE_FREEZE); nothing consumed, nothing restarted", async () => {
    const early = await verify();
    // an ordinary write between that backup and the freeze: the backup does not contain it
    await t.asUser(S.userId);
    await t.rpc(`public.rpc_record_client_legacy_debt(p_customer_id := '${c1}', p_balance_type := 'debt', p_amount_585_g := 1.5, p_as_of_date := CURRENT_DATE, p_idempotency_key := '${key("leg")}')`);
    expect((await freeze(true)).status).toBe("frozen");
    await t.asUser(dir.userId);
    await t.expectError(restart(early), "ERR_BACKUP_BEFORE_FREEZE");
    expect(await restarts()).toBe(0);
    expect(await consumed(early)).toBeNull();
    expect(N((await one(`SELECT count(*) n FROM public.opening_periods WHERE organization_id = '${org}'`)).n)).toBe(0);
  });

  it("G2 a verification of a backup taken INSIDE the freeze passes; the 086 T0 rules still come first", async () => {
    const bv = await verify();
    await t.asUser(dir.userId);
    await t.expectError(`SELECT public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'g87', now() + interval '10 minutes', '${bv}', '${key("rs")}')`, "ERR_T0_FUTURE");
    const r = await t.rpc(restart(bv).replace(/^SELECT /, ""));
    expect(r.status).toBe("ok");
    expect(await consumed(bv)).not.toBeNull();
  });

  it("G3 replay: a spare second verification of the same backup cannot serve a later restart (new freeze -> it is older than the freeze)", async () => {
    const spare = await verify(); // written in the same freeze, while the first opening is still a draft
    await t.asUser(dir.userId);
    await t.expectError(restart(spare), "ERR_RESTART_ALREADY_OPEN"); // draft open: 085 refuses first
    await lock(); // the opening is locked: the freeze ends automatically
    expect((await one(`SELECT public._goldia_active_freeze('${org}') a`)).a).toBeNull();
    // ordinary work after the opening, not contained in that backup
    await t.asUser(S.userId);
    await t.rpc(`public.rpc_record_client_legacy_debt(p_customer_id := '${c1}', p_balance_type := 'debt', p_amount_585_g := 2.5, p_as_of_date := CURRENT_DATE, p_idempotency_key := '${key("leg")}')`);
    await t.asUser(dir.userId);
    await t.expectError(restart(spare), "ERR_FREEZE_REQUIRED"); // no freeze at all
    expect((await freeze(true)).status).toBe("frozen");
    await t.asUser(dir.userId);
    await t.expectError(restart(spare), "ERR_BACKUP_BEFORE_FREEZE"); // new freeze: the spare is older
    expect(await consumed(spare)).toBeNull();
    expect(await restarts()).toBe(1);
  });

  it("G4 abort: a backup of a released freeze cannot serve the next freeze", async () => {
    // the freeze from G3 is active; its own fresh backup is taken, then the window is aborted
    const v1 = await verify();
    expect((await freeze(false)).status).toBe("released");
    await t.asUser(S.userId);
    await t.rpc(`public.rpc_record_client_legacy_debt(p_customer_id := '${c1}', p_balance_type := 'debt', p_amount_585_g := 0.5, p_as_of_date := CURRENT_DATE, p_idempotency_key := '${key("leg")}')`);
    expect((await freeze(true)).status).toBe("frozen");
    await t.asUser(dir.userId);
    await t.expectError(restart(v1), "ERR_BACKUP_BEFORE_FREEZE");
    const v2 = await verify();
    expect((await t.rpc(restart(v2).replace(/^SELECT /, ""))).status).toBe("ok");
    expect(await restarts()).toBe(2);
  });

  it("G5 one freeze -> one restart (defence in depth): even if the draft disappeared, a second restart in the same freeze is refused", async () => {
    // simulate tampering by the database owner: the draft opening of G4 removed while its freeze is still active
    await t.asAdmin();
    await t.db.exec(`DELETE FROM public.opening_documents WHERE organization_id = '${org}' AND opening_period_id IN (SELECT id FROM public.opening_periods WHERE organization_id = '${org}' AND status = 'draft')`);
    await t.db.exec(`DELETE FROM public.opening_periods WHERE organization_id = '${org}' AND status = 'draft'`);
    const v3 = await verify();
    await t.asUser(dir.userId);
    await t.expectError(restart(v3), "ERR_FREEZE_ALREADY_USED");
    expect(await restarts()).toBe(2);
    expect(await consumed(v3)).toBeNull();
  });

  it("G6 signed-in users still cannot write a verification or touch the gate", async () => {
    await t.asUser(dir.userId);
    await t.expectError(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 'fake', true)`, "permission denied");
    await t.expectError(`UPDATE public.financial_backup_verifications SET verified_at = now()`, "permission denied");
    await t.expectError(`UPDATE public.financial_write_freezes SET frozen_at = now() - interval '2 days'`, "permission denied");
  });
});
