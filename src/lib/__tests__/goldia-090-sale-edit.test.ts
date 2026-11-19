import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 090 (2026-11-19): sale EDIT = the original reversed + the corrected sale recorded in ONE transaction
// (rpc_edit_client_sale). Seller: own, self-recorded sale only, no payment after it, open period. Audit: sale_edits + audit_logs.
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 090 — sale edit (weight / piece / currency), seller rules, atomic recalculation", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-000000000902";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S1: U, S2: U;
  let cA = "", cB = "", cC = "", cD = "";
  let kn = 0;
  const key = (p: string) => `t90e-${p}-${++kn}`;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const as = async (u: U, sql: string) => { await t.asUser(u.userId); return t.rpc(sql); };
  const sacc = async (s: U) => one(`SELECT seller_owes_manager_g o, current_physical_stock_g st FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`);
  const debt = async (c: string) => N((await one(`SELECT current_debt_grams - advance_balance_grams d FROM public.client_gold_accounts WHERE customer_id = '${c}'`)).d);
  const sale = async (id: string) => one(`SELECT status, recorded_by, base_weight_grams w, client_markup_pct p, client_gold_due_grams due, sale_amount amt FROM public.jewelry_sales WHERE id = '${id}'`);
  const effStock = async (s: U) => N((await one(`SELECT coalesce(sum(stock_g), 0) v FROM public._goldia_period_effects('${org}') WHERE seller_id = '${s.employeeId}'`)).v);
  const movesOk = async () => { await t.asUser(mgr.userId); const m = await t.rpc(`public.rpc_get_seller_stock_movements(null, null, null)`); return (m.sellers as Record<string, unknown>[]).every((s) => s.ok === true); };
  const edit = (id: string, args: string, k: string) => `public.rpc_edit_client_sale(p_sale_id := '${id}', p_reason := 'xato kiritilgan', p_idempotency_key := '${k}'${args ? ", " + args : ""})`;
  const held = async (s: U, w: number) => (await one(`SELECT id FROM public.consignment_pieces WHERE seller_id = '${s.employeeId}' AND status = 'held_by_seller' AND weight_grams = ${w} LIMIT 1`)).id as string;

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-90e', 'Goldia 90 edit', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-90e@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-90e@goldia.uz", "Menejer", "manager");
    S1 = await t.addUser(org, "s1-90e@goldia.uz", "Sotuvchi 1", "sales");
    S2 = await t.addUser(org, "s2-90e@goldia.uz", "Sotuvchi 2", "sales");
    const c = async (code: string, s: U) => (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${org}', '${code}', 'Mijoz ${code}', '+99894${code.replace(/\D/g, "").padStart(7, "0")}', '${s.employeeId}') RETURNING id`)).id as string;
    cA = await c("EA-1", S1); cB = await c("EB-2", S1); cC = await c("EC-3", S2); cD = await c("ED-4", S1);
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, 900000, 'UZS', true), ('${org}', public._goldia_business_date(), 585, 900000, 'UZS', true) ON CONFLICT DO NOTHING`);
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 't90e', true)`);
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 't90e.dump', true) RETURNING id`)).id;
    await as(dir, `public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 't90e', '${new Date(Date.now() - 60_000).toISOString()}', '${bv}', 't90e-restart')`);
    await as(mgr, `public.rpc_record_opening_document(p_kind := 'manager_inventory', p_physical_g := 100, p_factory_markup_pct := 8, p_idempotency_key := '${key("a")}')`);
    await as(mgr, `public.rpc_confirm_accounting_baseline(p_notes := 'T0 t90e', p_idempotency_key := '${key("lock")}', p_usd_rate := 12650)`);
    await as(mgr, `public.rpc_issue_barcode_consignment(p_seller_id := '${S1.employeeId}', p_factory_markup_pct := 8, p_pieces := '[{"weight_grams":10},{"weight_grams":8},{"weight_grams":6.5},{"weight_grams":12}]'::jsonb, p_seller_markup_pct := 10, p_idempotency_key := '${key("c1")}')`);
    await as(mgr, `public.rpc_issue_barcode_consignment(p_seller_id := '${S2.employeeId}', p_factory_markup_pct := 8, p_pieces := '[{"weight_grams":5}]'::jsonb, p_seller_markup_pct := 10, p_idempotency_key := '${key("c2")}')`);
  }, 240000);

  it("E1 seller edits his weight sale (gram + %): debt / stock / report recomputed, original kept as reversed, audit old->new, replay idempotent", async () => {
    const st0 = N((await sacc(S1)).st), o0 = N((await sacc(S1)).o);
    const p12 = await held(S1, 12);
    const s = await as(S1, `public.rpc_record_weight_sale(p_customer_id := '${cA}', p_weight_grams := 2, p_client_markup_pct := 20, p_piece_ids := ARRAY['${p12}']::uuid[], p_idempotency_key := '${key("s")}')`);
    expect(await debt(cA)).toBe(2.4);
    const k = key("e1");
    const e = await as(S1, edit(s.sale_id as string, "p_weight_grams := 2.5, p_client_markup_pct := 15", k));
    const again = await as(S1, edit(s.sale_id as string, "p_weight_grams := 2.5, p_client_markup_pct := 15", k));
    expect(again.new_sale_id).toBe(e.new_sale_id);
    expect(N((await one(`SELECT count(*) n FROM public.jewelry_sales WHERE customer_id = '${cA}'`)).n)).toBe(2);
    expect(await debt(cA)).toBe(2.875);
    expect((await sale(s.sale_id as string)).status).toBe("reversed");
    const n = await sale(e.new_sale_id as string);
    expect([N(n.w), N(n.p), N(n.due), n.recorded_by]).toEqual([2.5, 15, 2.875, S1.employeeId]);
    expect([r4(N((await sacc(S1)).st)), N((await sacc(S1)).o)]).toEqual([r4(st0 - 2.5), o0]);
    const ed = await one(`SELECT edited_by, reason, old_values ->> 'weight_g' ow, new_values ->> 'weight_g' nw, old_values ->> 'markup_pct' op, new_values ->> 'markup_pct' np FROM public.sale_edits WHERE original_sale_id = '${s.sale_id}'`);
    expect(ed).toEqual({ edited_by: S1.employeeId, reason: "xato kiritilgan", ow: "2.0000", nw: "2.5000", op: "20.00", np: "15.00" });
    expect(N((await one(`SELECT count(*) n FROM public.audit_logs WHERE action = 'EDIT_CLIENT_SALE' AND record_id = '${s.sale_id}'`)).n)).toBe(1);
    // the same piece is cut again (no FIFO jump), and the period report / stock movements agree with the stored stock
    expect((await one(`SELECT piece_id, grams FROM public.weight_sale_allocations WHERE sale_id = '${e.new_sale_id}' AND reversed_at IS NULL`))).toEqual({ piece_id: p12, grams: "2.5000" });
    expect(N((await one(`SELECT weight_grams w FROM public.consignment_pieces WHERE id = '${p12}'`)).w)).toBe(9.5);
    expect(r4(await effStock(S1))).toBe(r4(N((await sacc(S1)).st)));
    expect(await movesOk()).toBe(true);
    // the original cannot be edited again; the corrected sale can
    await t.asUser(S1.userId);
    await t.expectError(`SELECT ${edit(s.sale_id as string, "p_weight_grams := 3", key("e1b"))}`, "ERR_SALE_ALREADY_REVERSED");
    const e2 = await as(S1, edit(e.new_sale_id as string, "p_client_markup_pct := 10", key("e1c")));
    expect(await debt(cA)).toBe(2.75);
    expect((await sale(e2.new_sale_id as string)).status).not.toBe("reversed");
  });

  it("E2 seller edits his piece sale: another piece + another %; the first piece is back with him, the new one is sold", async () => {
    const p8 = await held(S1, 8), p65 = await held(S1, 6.5);
    const s = await as(S1, `public.rpc_record_barcode_piece_sale(p_customer_id := '${cB}', p_piece_id := '${p8}', p_client_markup_pct := 10, p_idempotency_key := '${key("ps")}')`);
    expect(await debt(cB)).toBe(8.8);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT ${edit(s.sale_id as string, "p_weight_grams := 7", key("pw"))}`, "ERR_PIECE_WEIGHT_FIXED");
    const e = await as(S1, edit(s.sale_id as string, `p_piece_id := '${p65}', p_client_markup_pct := 12`, key("pe")));
    expect(await debt(cB)).toBe(7.28);
    expect((await one(`SELECT status, sale_id FROM public.consignment_pieces WHERE id = '${p8}'`))).toEqual({ status: "held_by_seller", sale_id: null });
    expect((await one(`SELECT status, sale_id FROM public.consignment_pieces WHERE id = '${p65}'`))).toEqual({ status: "sold", sale_id: e.new_sale_id });
    expect(await movesOk()).toBe(true);
  });

  it("E3 seller edits the price of his USD sale: the currency debt follows, the 585 debt stays untouched", async () => {
    const g0 = await debt(cD);
    const s = await as(S1, `public.rpc_record_currency_sale(p_customer_id := '${cD}', p_currency := 'USD', p_amount := 500, p_weight_grams := 3, p_idempotency_key := '${key("cs")}')`);
    const cur = async () => N((await one(`SELECT debt_amount - advance_amount d FROM public.client_currency_accounts WHERE customer_id = '${cD}' AND currency = 'USD'`)).d);
    expect(await cur()).toBe(500);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT ${edit(s.sale_id as string, "p_client_markup_pct := 5", key("cm"))}`, "ERR_CURRENCY_NO_MARKUP");
    await as(S1, edit(s.sale_id as string, "p_sale_amount := 450", key("ce")));
    expect(await cur()).toBe(450);
    expect(await debt(cD)).toBe(g0);
  });

  it("E4 refused for a seller (and nothing changes): another seller's sale, a sale recorded by the manager, a later payment, a return, no change, not enough stock", async () => {
    const other = await as(S2, `public.rpc_record_weight_sale(p_customer_id := '${cC}', p_weight_grams := 0.5, p_client_markup_pct := 10, p_idempotency_key := '${key("o")}')`);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT ${edit(other.sale_id as string, "p_weight_grams := 0.6", key("o1"))}`, "ERR_NOT_OWN_SALE");
    const byMgr = await as(mgr, `public.rpc_record_weight_sale(p_customer_id := '${cA}', p_seller_id := '${S1.employeeId}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := '${key("m")}')`);
    const d0 = await debt(cA), st0 = N((await sacc(S1)).st);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT ${edit(byMgr.sale_id as string, "p_weight_grams := 1.2", key("m1"))}`, "ERR_NOT_RECORDED_BY_SELLER");
    expect([(await sale(byMgr.sale_id as string)).status, await debt(cA), N((await sacc(S1)).st)]).toEqual(["open_debt", d0, st0]);
    // own sale, then a payment
    const paid = await as(S1, `public.rpc_record_weight_sale(p_customer_id := '${cB}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := '${key("p")}')`);
    await as(S1, `public.rpc_record_client_settlement(p_customer_id := '${cB}', p_scrap_weight := 0.5, p_scrap_proba := 585, p_idempotency_key := '${key("pay")}')`);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT ${edit(paid.sale_id as string, "p_weight_grams := 1.5", key("p1"))}`, "ERR_SALE_HAS_PAYMENTS");
    // a sale with a customer return
    const ret = await as(S2, `public.rpc_record_weight_sale(p_customer_id := '${cC}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := '${key("r")}')`);
    await as(S2, `public.rpc_record_sale_return(p_sale_id := '${ret.sale_id}', p_weight_grams := 0.5, p_reason := 'qaytdi', p_idempotency_key := '${key("rr")}')`);
    await t.asUser(S2.userId);
    await t.expectError(`SELECT ${edit(ret.sale_id as string, "p_weight_grams := 0.8", key("r1"))}`, "ERR_SALE_HAS_RETURNS");
    // nothing changed / no reason / more grams than the seller has: refused, the original untouched
    const own = await as(S2, `public.rpc_record_weight_sale(p_customer_id := '${cC}', p_weight_grams := 0.5, p_client_markup_pct := 10, p_idempotency_key := '${key("w")}')`);
    const dc = await debt(cC);
    await t.asUser(S2.userId);
    await t.expectError(`SELECT ${edit(own.sale_id as string, "p_weight_grams := 0.5", key("w1"))}`, "ERR_EDIT_NO_CHANGE");
    await t.expectError(`SELECT public.rpc_edit_client_sale(p_sale_id := '${own.sale_id}', p_reason := ' ', p_idempotency_key := '${key("w2")}', p_weight_grams := 0.6)`, "ERR_REASON_REQUIRED");
    await t.expectError(`SELECT ${edit(own.sale_id as string, "p_weight_grams := 500", key("w3"))}`, "ERR_INSUFFICIENT_SELLER_STOCK");
    expect([(await sale(own.sale_id as string)).status, await debt(cC)]).toEqual(["open_debt", dc]);
    expect(N((await one(`SELECT count(*) n FROM public.sale_edits WHERE original_sale_id = '${own.sale_id}'`)).n)).toBe(0);
  });

  it("E5 management (manager = director): edits any sale of the org, also after a payment (the payment stays with the customer); closed period refused for everyone", async () => {
    const s = await as(S1, `public.rpc_record_weight_sale(p_customer_id := '${cD}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := '${key("x")}')`);
    const g0 = r4((await debt(cD)) - 1.1);
    await as(S1, `public.rpc_record_client_settlement(p_customer_id := '${cD}', p_scrap_weight := 0.5, p_scrap_proba := 585, p_idempotency_key := '${key("xp")}')`);
    expect(r4((await debt(cD)) - g0)).toBe(0.6);
    await as(mgr, edit(s.sale_id as string, "p_weight_grams := 2", key("xe")));
    expect(r4((await debt(cD)) - g0)).toBe(1.7);
    const s2 = await as(mgr, `public.rpc_record_weight_sale(p_customer_id := '${cD}', p_seller_id := '${S1.employeeId}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := '${key("y")}')`);
    const e = await as(dir, edit(s2.sale_id as string, "p_client_markup_pct := 12", key("ye")));
    expect(N((await sale(e.new_sale_id as string)).due)).toBe(1.12);
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.goldia_report_periods (organization_id, period_start, period_end, report) VALUES ('${org}', public._goldia_business_date() - 1, public._goldia_business_date(), '{}'::jsonb)`);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT ${edit(e.new_sale_id as string, "p_client_markup_pct := 11", key("z"))}`, "ERR_PERIOD_CLOSED");
    await t.asAdmin();
    await t.db.exec(`DELETE FROM public.goldia_report_periods WHERE organization_id = '${org}'`);
    expect(await movesOk()).toBe(true);
    expect(r4(await effStock(S1))).toBe(r4(N((await sacc(S1)).st)));
  });

  it("E6 isolation: a seller sees only the edits of his own sales; sale_edits cannot be written directly", async () => {
    await t.asUser(S2.userId);
    const mine = (await t.db.query<Record<string, unknown>>(`SELECT count(*) n FROM public.sale_edits`)).rows[0];
    expect(N(mine?.n)).toBe(0); // S2 never edited a sale successfully
    await t.asUser(S1.userId);
    expect(N((await t.db.query<Record<string, unknown>>(`SELECT count(*) n FROM public.sale_edits`)).rows[0]?.n)).toBeGreaterThan(0);
    await t.expectError(`DELETE FROM public.sale_edits`, "");
  });
});
