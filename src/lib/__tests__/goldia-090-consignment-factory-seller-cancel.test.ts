import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 090 (2026-11-19): consignment cancellation across several factory receipts (no double count), manager -> factory
// goods return (088 rule: grams x (1 + the receipt's / A document's %)), a seller cancelling his own sale.
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 090 — consignment cancel, factory goods return, seller own-sale cancel", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-000000000901";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S1: U, S2: U;
  let cA = "", cB = "", cC = "", aDoc = "", aRcp = "", r2 = "";
  let kn = 0;
  const key = (p: string) => `t90-${p}-${++kn}`;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const as = async (u: U, sql: string) => { await t.asUser(u.userId); return t.rpc(sql); };
  const rcp = async (id: string) => one(`SELECT available_physical_g av, transferred_physical_g tr, original_physical_g og, status FROM public.factory_receipts WHERE id = '${id}'`);
  const sacc = async (s: U) => one(`SELECT seller_owes_manager_g o, current_physical_stock_g st FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`);
  const vault = async () => one(`SELECT current_factory_obligation_g o, current_factory_advance_g a, public.get_manager_available_stock_grams('${org}') st FROM public.manager_vault_account WHERE organization_id = '${org}'`);
  const net = async () => { const v = await vault(); return r4(N(v.o) - N(v.a)); };
  const effStock = async (s: U) => N((await one(`SELECT coalesce(sum(stock_g), 0) v FROM public._goldia_period_effects('${org}') WHERE seller_id = '${s.employeeId}'`)).v);
  const movesOk = async () => { await t.asUser(mgr.userId); const m = await t.rpc(`public.rpc_get_seller_stock_movements(null, null, null)`); return (m.sellers as Record<string, unknown>[]).every((s) => s.ok === true); };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-90', 'Goldia 90', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-90@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-90@goldia.uz", "Menejer", "manager");
    S1 = await t.addUser(org, "s1-90@goldia.uz", "Sotuvchi 1", "sales");
    S2 = await t.addUser(org, "s2-90@goldia.uz", "Sotuvchi 2", "sales");
    const c = async (code: string, s: U) => (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${org}', '${code}', 'Mijoz ${code}', '+99893${code.replace(/\D/g, "").padStart(7, "0")}', '${s.employeeId}') RETURNING id`)).id as string;
    cA = await c("A-1", S1); cB = await c("B-2", S1); cC = await c("C-3", S2);
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, 900000, 'UZS', true), ('${org}', public._goldia_business_date(), 585, 900000, 'UZS', true) ON CONFLICT DO NOTHING`);
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 't90', true)`);
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 't90.dump', true) RETURNING id`)).id;
    await as(dir, `public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 't90', '${new Date(Date.now() - 60_000).toISOString()}', '${bv}', 't90-restart')`);
    const a = await as(mgr, `public.rpc_record_opening_document(p_kind := 'manager_inventory', p_physical_g := 20, p_factory_markup_pct := 8, p_idempotency_key := '${key("a")}')`);
    aDoc = a.document_id as string;
    aRcp = (await one(`SELECT factory_receipt_id r FROM public.opening_documents WHERE id = '${aDoc}'`)).r as string;
    await as(mgr, `public.rpc_record_opening_document(p_kind := 'seller_inventory', p_seller_id := '${S2.employeeId}', p_pieces := '[{"weight_grams":4}]'::jsonb, p_seller_markup_pct := 10, p_source_document_id := '${aDoc}', p_idempotency_key := '${key("b")}')`);
    await as(mgr, `public.rpc_record_opening_document(p_kind := 'factory_advance', p_amount := 100, p_notes := 'C2 test', p_idempotency_key := '${key("c2")}')`);
    await as(mgr, `public.rpc_confirm_accounting_baseline(p_notes := 'T0 t90', p_idempotency_key := '${key("lock")}', p_usd_rate := 12650)`);
    r2 = (await as(mgr, `public.rpc_record_factory_receipt(p_product_name := 'Keyingi kirim', p_original_physical_g := 50, p_factory_markup_pct := 10, p_idempotency_key := '${key("r2")}')`)).receipt_id as string;
  }, 240000);

  it("K1 FIFO consignment of 39.46 g takes 16 g from A and 23.46 g from the later receipt; cancelling it puts each back on its own receipt", async () => {
    const st0 = N((await sacc(S1)).st), o0 = N((await sacc(S1)).o), m0 = N((await vault()).st);
    expect(N((await rcp(aRcp)).av)).toBe(16);
    const con = await as(mgr, `public.rpc_issue_barcode_consignment(p_seller_id := '${S1.employeeId}', p_factory_markup_pct := 8, p_pieces := '[{"weight_grams":20},{"weight_grams":19.46}]'::jsonb, p_seller_markup_pct := 10, p_idempotency_key := '${key("con")}')`);
    const alloc = (await t.db.query<Record<string, unknown>>(`SELECT factory_receipt_id r, grams g FROM public.consignment_receipt_allocations WHERE consignment_id = '${con.consignment_id}' ORDER BY seq`)).rows;
    expect(alloc.map((x) => [x.r, N(x.g)])).toEqual([[aRcp, 16], [r2, 23.46]]);
    expect([N((await rcp(aRcp)).av), N((await rcp(r2)).av)]).toEqual([0, 26.54]);
    await as(mgr, `public.rpc_reverse_barcode_consignment('${con.consignment_id}', 'ikki marta kiritilgan', '${key("cx")}')`);
    expect([N((await rcp(aRcp)).av), N((await rcp(r2)).av)]).toEqual([16, 50]);   // never above what each receipt had
    expect([N((await rcp(aRcp)).tr), N((await rcp(r2)).tr)]).toEqual([4, 0]);
    expect([N((await sacc(S1)).st), N((await sacc(S1)).o), N((await vault()).st)]).toEqual([st0, o0, m0]);
    expect((await one(`SELECT count(*) n FROM public.consignment_pieces WHERE consignment_id = '${con.consignment_id}' AND status = 'cancelled'`)).n).toBe(2);
    // the period report and the stock movements take the 39.46 g off the seller once (not twice)
    expect(r4(await effStock(S1))).toBe(r4(N((await sacc(S1)).st)));
    expect(await movesOk()).toBe(true);
  });

  it("K2 the user's case: the same 39.46 g consignment entered twice, one cancelled -> seller holds 39.46 g once; receipts exact", async () => {
    const m0 = N((await vault()).st);
    const p = `p_seller_id := '${S1.employeeId}', p_factory_markup_pct := 10, p_pieces := '[{"weight_grams":39.46}]'::jsonb, p_factory_receipt_id := '${r2}', p_seller_markup_pct := 10`;
    const c1 = await as(mgr, `public.rpc_issue_barcode_consignment(${p}, p_idempotency_key := '${key("d1")}')`);
    await as(mgr, `public.rpc_issue_barcode_consignment(${p.replace("39.46", "10.54")}, p_idempotency_key := '${key("d2")}')`);
    await as(mgr, `public.rpc_reverse_barcode_consignment('${c1.consignment_id}', 'ikkinchisi xato', '${key("dx")}')`);
    expect(N((await rcp(r2)).av)).toBe(39.46);
    expect(r4(N((await vault()).st) - m0)).toBe(-10.54);
    expect(r4(await effStock(S1))).toBe(r4(N((await sacc(S1)).st)));
    expect(await movesOk()).toBe(true);
    await as(mgr, `public.rpc_reverse_barcode_consignment('${c1.consignment_id}', 'yana', '${key("dx2")}')`).then(() => { throw new Error("double cancel accepted"); }, (e) => expect(String(e)).toMatch(/allaqachon/));
  });

  it("K3 refused: an opening B consignment (LOCK), a legacy multi-receipt consignment without allocations (no guessing), a seller", async () => {
    const b = (await one(`SELECT consignment_id c FROM public.opening_documents WHERE kind = 'seller_inventory' AND organization_id = '${org}'`)).c as string;
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reverse_barcode_consignment('${b}', 'x', '${key("o")}')`, "ERR_OPENING_CONSIGNMENT");
    const con = await as(mgr, `public.rpc_issue_barcode_consignment(p_seller_id := '${S1.employeeId}', p_factory_markup_pct := 8, p_pieces := '[{"weight_grams":20}]'::jsonb, p_seller_markup_pct := 10, p_idempotency_key := '${key("lg")}')`);
    await t.asAdmin();
    const saved = (await t.db.query<Record<string, unknown>>(`SELECT * FROM public.consignment_receipt_allocations WHERE consignment_id = '${con.consignment_id}' ORDER BY seq`)).rows;
    expect(saved.map((x) => N(x.grams))).toEqual([16, 4]);
    await t.db.exec(`DELETE FROM public.consignment_receipt_allocations WHERE consignment_id = '${con.consignment_id}'`); // a pre-090 consignment
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reverse_barcode_consignment('${con.consignment_id}', 'x', '${key("lgx")}')`, "ERR_CONSIGNMENT_RECEIPT_UNKNOWN");
    expect(N((await rcp(aRcp)).av)).toBe(0); // nothing changed
    // with its allocations the same cancellation is exact
    await t.asAdmin();
    for (const x of saved) await t.db.exec(`INSERT INTO public.consignment_receipt_allocations (organization_id, consignment_id, factory_receipt_id, seq, grams) VALUES ('${org}', '${con.consignment_id}', '${x.factory_receipt_id}', ${x.seq}, ${x.grams})`);
    await as(mgr, `public.rpc_reverse_barcode_consignment('${con.consignment_id}', 'x', '${key("lgy")}')`);
    expect(N((await rcp(aRcp)).av)).toBe(16);
    // a legacy single-receipt consignment within what its receipt gave out is restored as before
    const one1 = await as(mgr, `public.rpc_issue_barcode_consignment(p_seller_id := '${S1.employeeId}', p_factory_markup_pct := 10, p_pieces := '[{"weight_grams":3}]'::jsonb, p_factory_receipt_id := '${r2}', p_seller_markup_pct := 10, p_idempotency_key := '${key("l1")}')`);
    const r2av = N((await rcp(r2)).av);
    await t.asAdmin();
    await t.db.exec(`DELETE FROM public.consignment_receipt_allocations WHERE consignment_id = '${one1.consignment_id}'`);
    await as(mgr, `public.rpc_reverse_barcode_consignment('${one1.consignment_id}', 'x', '${key("l1x")}')`);
    expect(r4(N((await rcp(r2)).av) - r2av)).toBe(3);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_reverse_barcode_consignment('${con.consignment_id}', 'x', '${key("sx")}')`, "ermission");
  });

  it("F1 later receipt: 5 g back to the factory -> manager stock -5 g, factory net -5.5 g (10 %), seller / customers untouched; idempotent; in the period report", async () => {
    const v0 = await vault(), n0 = await net(), s0 = await sacc(S1), d0 = await one(`SELECT coalesce(sum(current_debt_grams), 0) d FROM public.client_gold_accounts`);
    const k = key("fg");
    const pe0 = N((await one(`SELECT coalesce(sum(factory_g), 0) v FROM public._goldia_period_effects('${org}')`)).v);
    const r = await as(mgr, `public.rpc_return_goods_to_factory('${r2}', 5, 'menejerda saqlanmaydi', '${k}')`);
    const again = await as(mgr, `public.rpc_return_goods_to_factory('${r2}', 5, 'menejerda saqlanmaydi', '${k}')`);
    expect(again.return_id).toBe(r.return_id);
    expect([N(r.factory_value_g), N(r.factory_markup_pct)]).toEqual([5.5, 10]);
    expect(r4(N((await vault()).st) - N(v0.st))).toBe(-5);
    expect(r4((await net()) - n0)).toBe(-5.5);
    expect(await sacc(S1)).toEqual(s0);
    expect(await one(`SELECT coalesce(sum(current_debt_grams), 0) d FROM public.client_gold_accounts`)).toEqual(d0);
    expect((await one(`SELECT source_type s, agreed_equivalent_g g FROM public.factory_gold_handovers WHERE id = '${r.handover_id}'`))).toEqual({ s: "finished_goods_return", g: "5.5000" });
    expect(N((await one(`SELECT coalesce(sum(factory_g), 0) v FROM public._goldia_period_effects('${org}') WHERE kind = 'factory_handover'`)).v)).toBe(-5.5);
    // no double count: the WHOLE factory column of the period report moves exactly like the stored factory net
    expect(r4(N((await one(`SELECT coalesce(sum(factory_g), 0) v FROM public._goldia_period_effects('${org}')`)).v) - pe0)).toBe(-5.5);
  });

  it("F2 opening A receipt: 10 g back at the A document's 8 % = 10.8 g; more than in stock / a seller refused", async () => {
    const n0 = await net();
    const r = await as(mgr, `public.rpc_return_goods_to_factory('${aRcp}', 10, 'A tovari zavodga', '${key("fa")}')`);
    expect(N(r.factory_value_g)).toBe(10.8);
    expect(r4((await net()) - n0)).toBe(-10.8);
    expect(N((await rcp(aRcp)).av)).toBe(6);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_return_goods_to_factory('${aRcp}', 7, 'x', '${key("fo")}')`, "ERR_NOT_IN_STOCK");
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_return_goods_to_factory('${aRcp}', 1, 'x', '${key("fs")}')`, "ermission");
    // the director has the same right as the manager
    const d = await as(dir, `public.rpc_return_goods_to_factory('${aRcp}', 1, 'direktor', '${key("fd")}')`);
    expect(N(d.factory_value_g)).toBe(1.08);
  });

  it("F3 with a factory advance the advance grows by the value; reversal restores everything; the generic gold-handover reversal is refused", async () => {
    const v0 = await vault();
    const r = await as(mgr, `public.rpc_return_goods_to_factory('${r2}', 2, 'avans holati', '${key("fv")}')`);
    const v1 = await vault();
    expect(r4((N(v1.o) - N(v1.a)) - (N(v0.o) - N(v0.a)))).toBe(-2.2);
    expect(N(v1.a)).toBeGreaterThan(0); // C2 advance 100 g > obligations -> the factory owes us, more now
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reverse_factory_gold_handover('${r.handover_id}', 'x', '${key("gx")}')`, "");
    await as(mgr, `public.rpc_reverse_factory_goods_return('${r.return_id}', 'xato', '${key("rv")}')`);
    expect(await vault()).toEqual(v0);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reverse_factory_goods_return('${r.return_id}', 'xato', '${key("rv2")}')`, "allaqachon");
  });

  it("S1 a seller cancels his own sale with a reason: debt, pieces, stock and obligation restored; double cancel refused", async () => {
    const st0 = N((await sacc(S2)).st), o0 = N((await sacc(S2)).o);
    const s = await as(S2, `public.rpc_record_weight_sale(p_customer_id := '${cC}', p_weight_grams := 2, p_client_markup_pct := 20, p_idempotency_key := '${key("s")}')`);
    expect(N((await one(`SELECT current_debt_grams d FROM public.client_gold_accounts WHERE customer_id = '${cC}'`)).d)).toBe(2.4);
    await t.asUser(S2.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_sale(p_sale_id := '${s.sale_id}', p_reason := '  ')`, "sababi");
    await as(S2, `public.rpc_reverse_client_sale(p_sale_id := '${s.sale_id}', p_reason := 'noto''g''ri vazn')`);
    expect(N((await one(`SELECT current_debt_grams d FROM public.client_gold_accounts WHERE customer_id = '${cC}'`)).d)).toBe(0);
    expect([N((await sacc(S2)).st), N((await sacc(S2)).o)]).toEqual([st0, o0]);
    expect((await one(`SELECT status s, recorded_by r FROM public.jewelry_sales WHERE id = '${s.sale_id}'`))).toEqual({ s: "reversed", r: S2.employeeId });
    await t.asUser(S2.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_sale(p_sale_id := '${s.sale_id}', p_reason := 'yana')`, "allaqachon");
    // and he can enter it again correctly
    const again = await as(S2, `public.rpc_record_weight_sale(p_customer_id := '${cC}', p_weight_grams := 1.5, p_client_markup_pct := 20, p_idempotency_key := '${key("s2")}')`);
    expect(again.sale_id).toBeTruthy();
  });

  it("S2 refused for a seller: another seller's sale, a sale recorded by the manager, a sale with a later payment, a returned sale, a sale in a closed period", async () => {
    const other = await as(S2, `public.rpc_record_weight_sale(p_customer_id := '${cC}', p_weight_grams := 0.5, p_client_markup_pct := 10, p_idempotency_key := '${key("o")}')`);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_sale(p_sale_id := '${other.sale_id}', p_reason := 'x')`, "faqat o");
    // the manager records a sale for S1: S1 may not cancel it, the manager may
    const byMgr = await as(mgr, `public.rpc_record_weight_sale(p_customer_id := '${cA}', p_seller_id := '${S1.employeeId}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := '${key("m")}')`);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_sale(p_sale_id := '${byMgr.sale_id}', p_reason := 'x')`, "ERR_NOT_RECORDED_BY_SELLER");
    await as(mgr, `public.rpc_reverse_client_sale(p_sale_id := '${byMgr.sale_id}', p_reason := 'menejer bekor qildi')`);
    // own sale, then the customer pays -> the seller may not cancel any more
    const paid = await as(S1, `public.rpc_record_weight_sale(p_customer_id := '${cB}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := '${key("p")}')`);
    await as(S1, `public.rpc_record_client_settlement(p_customer_id := '${cB}', p_scrap_weight := 0.5, p_scrap_proba := 585, p_idempotency_key := '${key("pay")}')`);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_sale(p_sale_id := '${paid.sale_id}', p_reason := 'x')`, "ERR_SALE_HAS_PAYMENTS");
    // a sale with a customer return (vozvrat) -> already refused by the 083 reversal (ERR_SALE_HAS_RETURNS) - kept
    const ret = await as(S2, `public.rpc_record_weight_sale(p_customer_id := '${cC}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := '${key("rt")}')`);
    await as(S2, `public.rpc_record_sale_return(p_sale_id := '${ret.sale_id}', p_weight_grams := 0.5, p_reason := 'mijoz qaytardi', p_idempotency_key := '${key("rtr")}')`);
    await t.asUser(S2.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_sale(p_sale_id := '${ret.sale_id}', p_reason := 'x')`, "ERR_SALE_HAS_RETURNS");
    // closed report period
    const own = await as(S2, `public.rpc_record_weight_sale(p_customer_id := '${cC}', p_weight_grams := 0.5, p_client_markup_pct := 10, p_idempotency_key := '${key("cp")}')`);
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.goldia_report_periods (organization_id, period_start, period_end, report) VALUES ('${org}', public._goldia_business_date() - 1, public._goldia_business_date(), '{}'::jsonb)`);
    await t.asUser(S2.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_sale(p_sale_id := '${own.sale_id}', p_reason := 'x')`, "ERR_PERIOD_CLOSED");
    await t.asAdmin();
    await t.db.exec(`DELETE FROM public.goldia_report_periods WHERE organization_id = '${org}'`);
    expect((await one(`SELECT status s FROM public.jewelry_sales WHERE id = '${paid.sale_id}'`)).s).not.toBe("reversed");
  });

  it("R1 rollback 090 is refused while a goods return exists", async () => {
    await t.asAdmin();
    const fs = await import("node:fs");
    let msg = "";
    try { await t.db.exec(fs.readFileSync("supabase/rollback/20260101000090_rollback.sql", "utf8")); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).toContain("ROLLBACK 090 REFUSED");
  });
});
