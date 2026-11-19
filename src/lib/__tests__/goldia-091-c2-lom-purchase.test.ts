import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";
import { summarizeFactoryAccount } from "@/lib/factory-account-summary";

// 091 (2026-11-19): (1) a gold handover moves the factory account by exactly its 585 equivalent - the opening C2
// advance is no longer dropped; (2) a seller buys LOM at the bazaar with till UZS (an exchange inside the till).
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0; // + 0: no -0
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 091 — C2 handover fix, seller LOM purchase", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-000000000911";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S1: U, S2: U;
  let cA = "";
  let kn = 0;
  const key = (p: string) => `t91-${p}-${++kn}`;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const all = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows; };
  const as = async (u: U, sql: string) => { await t.asUser(u.userId); return t.rpc(sql); };
  const vault = async () => one(`SELECT current_factory_obligation_g o, current_factory_advance_g a, total_factory_handed_over_g h, manager_scrap_physical_g sp, manager_scrap_585_eq_g se FROM public.manager_vault_account WHERE organization_id = '${org}'`);
  const net = async () => { const v = await vault(); return r4(N(v.o) - N(v.a)); };
  const till = async (s: U) => one(`SELECT seller_till_cash_amount uzs, seller_till_usd_amount usd, seller_till_scrap_physical_g lp, seller_till_scrap_585_eq_g le, seller_till_scrap_grams lg,
      till_valued_cash_uzs pu, till_valued_cash_585_g pg, seller_owes_manager_g o FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`);
  const debt = async () => N((await one(`SELECT current_debt_grams - advance_balance_grams d FROM public.client_gold_accounts WHERE customer_id = '${cA}'`)).d);
  // the factory cards from the documents (same function the page uses) must equal the stored factory account
  const partsNet = async () => {
    const [receipts, handovers, openingDocs, v] = await Promise.all([
      all(`SELECT status, factory_obligation_g, original_physical_g, opening_document_id FROM public.factory_receipts WHERE organization_id = '${org}'`),
      all(`SELECT status, agreed_equivalent_g, source_type FROM public.factory_gold_handovers WHERE organization_id = '${org}'`),
      all(`SELECT kind, status, amount FROM public.opening_documents WHERE organization_id = '${org}' AND kind IN ('factory_obligation', 'factory_advance', 'factory_settled')`),
      vault(),
    ]);
    return summarizeFactoryAccount({ receipts, handovers, openingDocs: openingDocs as { kind: string }[], vault: { current_factory_obligation_g: N(v.o), current_factory_advance_g: N(v.a) } });
  };
  const effTill = async (s: U) => one(`SELECT round(coalesce(sum(till_uzs), 0), 2) uzs, round(coalesce(sum(till_scrap_g), 0), 4) lom FROM public._goldia_period_effects('${org}') WHERE seller_id = '${s.employeeId}'`);

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-91', 'Goldia 91', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-91@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-91@goldia.uz", "Menejer", "manager");
    S1 = await t.addUser(org, "s1-91@goldia.uz", "Sotuvchi 1", "sales");
    S2 = await t.addUser(org, "s2-91@goldia.uz", "Sotuvchi 2", "sales");
    cA = (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id) VALUES ('${org}', 'L-1', 'Mijoz L', '+998950000001', '${S1.employeeId}') RETURNING id`)).id as string;
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, 900000, 'UZS', true), ('${org}', public._goldia_business_date(), 585, 900000, 'UZS', true) ON CONFLICT DO NOTHING`);
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 't91', true)`);
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 't91.dump', true) RETURNING id`)).id;
    await as(dir, `public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 't91', '${new Date(Date.now() - 60_000).toISOString()}', '${bv}', 't91-restart')`);
    await as(mgr, `public.rpc_record_opening_document(p_kind := 'manager_inventory', p_physical_g := 20, p_factory_markup_pct := 8, p_idempotency_key := '${key("a")}')`);
    await as(mgr, `public.rpc_record_opening_document(p_kind := 'factory_advance', p_amount := 100, p_notes := 'C2 test', p_idempotency_key := '${key("c2")}')`);
    await as(mgr, `public.rpc_confirm_accounting_baseline(p_notes := 'T0 t91', p_idempotency_key := '${key("lock")}', p_usd_rate := 12650)`);
    await as(mgr, `public.rpc_record_factory_receipt(p_product_name := 'Kirim', p_original_physical_g := 50, p_factory_markup_pct := 10, p_idempotency_key := '${key("r2")}')`);
    await as(mgr, `public.rpc_issue_barcode_consignment(p_seller_id := '${S1.employeeId}', p_factory_markup_pct := 10, p_pieces := '[{"weight_grams":20}]'::jsonb, p_seller_markup_pct := 10, p_idempotency_key := '${key("c")}')`);
    // the customer buys 10 g and pays 9 000 000 UZS at the official 900 000 / g (cash valued 10 g in the seller's till)
    await as(S1, `public.rpc_record_weight_sale(p_customer_id := '${cA}', p_weight_grams := 10, p_client_markup_pct := 10, p_idempotency_key := '${key("s")}')`);
    await as(S1, `public.rpc_record_client_settlement(p_customer_id := '${cA}', p_cash_amount := 9000000, p_rate_per_gram := 900000, p_idempotency_key := '${key("pay")}')`);
  }, 240000);

  it("L1 seller buys 5 g 585 LOM for 4 500 000 UZS: UZS 9 mln -> 4.5 mln, LOM +5 phys / +5 585; debt, obligation, factory, report collections unchanged", async () => {
    const t0 = await till(S1), d0 = await debt(), n0 = await net();
    expect([N(t0.uzs), N(t0.pu), N(t0.pg)]).toEqual([9000000, 9000000, 10]);
    const flows0 = await one(`SELECT round(coalesce(sum(till_uzs) filter (where kind like 'payment%'), 0), 2) c FROM public._goldia_period_effects('${org}')`);
    const k = key("p1");
    const p = await as(S1, `public.rpc_record_seller_lom_purchase(p_physical_g := 5, p_proba := 585, p_idempotency_key := '${k}', p_uzs_amount := 4500000, p_counterparty := 'bozor')`);
    const again = await as(S1, `public.rpc_record_seller_lom_purchase(p_physical_g := 5, p_proba := 585, p_idempotency_key := '${k}', p_uzs_amount := 4500000, p_counterparty := 'bozor')`);
    expect(again.purchase_id).toBe(p.purchase_id);
    expect([N(p.equiv_585_g), N(p.price_per_g_uzs), N(p.pool_cash_uzs), N(p.pool_cash_585_g)]).toEqual([5, 900000, 4500000, 5]);
    const t1 = await till(S1);
    expect([N(t1.uzs), N(t1.lp), N(t1.le), N(t1.lg), N(t1.pu), N(t1.pg)]).toEqual([4500000, 5, 5, 5, 4500000, 5]);
    expect([N(t1.o), await debt(), await net()]).toEqual([N(t0.o), d0, n0]);
    expect(N((await one(`SELECT count(*) n FROM public.seller_lom_purchases WHERE seller_id = '${S1.employeeId}'`)).n)).toBe(1);
    expect(N((await one(`SELECT count(*) n FROM public.audit_logs WHERE action = 'SELLER_LOM_PURCHASE' AND record_id = '${p.purchase_id}'`)).n)).toBe(1);
    // period report: own kind, collections unchanged; the till rebuilt from the documents equals the stored till
    const flows1 = await one(`SELECT round(coalesce(sum(till_uzs) filter (where kind like 'payment%'), 0), 2) c, count(*) filter (where kind = 'seller_lom_purchase') n FROM public._goldia_period_effects('${org}')`);
    expect([flows1.c, N(flows1.n)]).toEqual([flows0.c, 1]);
    const e = await effTill(S1);
    expect([N(e.uzs), N(e.lom)]).toEqual([N(t1.uzs), N(t1.le)]);
  });

  it("L2 proba 750 at a price per gram: 2 g x 750/585 = 2.5641 g 585, UZS = 2 x price; physical and 585 kept apart", async () => {
    const t0 = await till(S1);
    const p = await as(S1, `public.rpc_record_seller_lom_purchase(p_physical_g := 2, p_proba := 750, p_idempotency_key := '${key("p2")}', p_price_per_g_uzs := 1100000)`);
    expect([N(p.equiv_585_g), N(p.uzs_amount)]).toEqual([2.5641, 2200000]);
    const t1 = await till(S1);
    expect([r4(N(t1.lp) - N(t0.lp)), r4(N(t1.le) - N(t0.le)), N(t0.uzs) - N(t1.uzs)]).toEqual([2, 2.5641, 2200000]);
  });

  it("L3 refused: more UZS than in the till, another seller's till, bad proba, total / price mismatch, future date, no price; the till is untouched", async () => {
    const t0 = await till(S1);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_record_seller_lom_purchase(p_physical_g := 5, p_proba := 585, p_idempotency_key := '${key("x1")}', p_uzs_amount := 99000000)`, "ERR_INSUFFICIENT_CASH_BALANCE");
    await t.expectError(`SELECT public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 200, p_idempotency_key := '${key("x2")}', p_uzs_amount := 100)`, "ERR_PROBA");
    await t.expectError(`SELECT public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := '${key("x3")}', p_uzs_amount := 900000, p_price_per_g_uzs := 800000)`, "ERR_PRICE_MISMATCH");
    await t.expectError(`SELECT public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := '${key("x4")}', p_uzs_amount := 900000, p_purchase_date := public._goldia_business_date() + 1)`, "ERR_FUTURE_DATE");
    await t.expectError(`SELECT public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := '${key("x5")}')`, "ERR_PRICE_REQUIRED");
    await t.asUser(S2.userId);
    await t.expectError(`SELECT public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := '${key("x6")}', p_uzs_amount := 900000, p_seller_id := '${S1.employeeId}')`, "ERR_NOT_OWN_TILL");
    await t.expectError(`SELECT public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := '${key("x7")}', p_uzs_amount := 900000)`, "ERR_");
    // a backup / restart freeze blocks the purchase like every other till operation
    await t.asAdmin();
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 't91 freeze', true)`);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := '${key("x8")}', p_uzs_amount := 900000)`, "ERR_FINANCIAL_FREEZE");
    await t.asAdmin();
    await t.db.exec(`UPDATE public.financial_write_freezes SET released_at = now() WHERE organization_id = '${org}' AND released_at IS NULL`);
    expect(await till(S1)).toEqual(t0);
    // isolation: S2 sees none of S1's purchases; the table cannot be written directly
    await t.asUser(S2.userId);
    expect(N((await t.db.query<Record<string, unknown>>(`SELECT count(*) n FROM public.seller_lom_purchases`)).rows[0]?.n)).toBe(0);
    await t.expectError(`DELETE FROM public.seller_lom_purchases`, "");
  });

  it("L4 manager (= director) records for a seller; reversal gives back UZS, pool share and LOM; double reversal refused", async () => {
    const t0 = await till(S1);
    const p = await as(mgr, `public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := '${key("m")}', p_uzs_amount := 900000, p_seller_id := '${S1.employeeId}')`);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := '${key("m0")}', p_uzs_amount := 900000)`, "ERR_SELLER_REQUIRED");
    await as(dir, `public.rpc_reverse_seller_lom_purchase('${p.purchase_id}', 'xato', '${key("mr")}')`);
    expect(await till(S1)).toEqual(t0);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_reverse_seller_lom_purchase('${p.purchase_id}', 'yana', '${key("mr2")}')`, "ERR_ALREADY_REVERSED");
    const e = await effTill(S1), t1 = await till(S1);
    expect([N(e.uzs), N(e.lom)]).toEqual([N(t1.uzs), N(t1.le)]);
  });

  it("C1 the bought LOM is handed to the manager (obligation - 585 eq), then to the factory: net - exactly the 585 eq, C2 stays; reversal exact; cards = account", async () => {
    const t0 = await till(S1);
    // seller -> manager: 5 g physical / 5 g 585 of LOM (the existing handover RPC, recorded by the manager)
    const h = await as(mgr, `public.rpc_record_seller_to_manager_settlement(p_seller_id := '${S1.employeeId}', p_scrap_weight_grams := 5, p_physical_scrap_g := 5, p_idempotency_key := '${key("h")}')`);
    const t1 = await till(S1);
    expect([r4(N(t0.o) - N(t1.o)), r4(N(t0.le) - N(t1.le)), r4(N(t0.lp) - N(t1.lp)), N(t1.uzs)]).toEqual([5, 5, 5, N(t0.uzs)]);
    // the purchase can no longer be reversed: its LOM has left the till
    const p1 = (await one(`SELECT id FROM public.seller_lom_purchases WHERE seller_id = '${S1.employeeId}' AND status = 'confirmed' AND physical_g = 5`)).id as string;
    await t.asUser(S1.userId);
    expect(h.status).toBe("ok");
    const v0 = await vault(), n0 = await net();
    expect(r4(N(v0.h))).toBe(100); // C2 is in the handed-over total
    // C2 100 + A 21.6 + receipt 55 -> advance 23.4 before the factory handover
    expect(n0).toBe(-23.4);
    const fh = await as(mgr, `public.rpc_record_factory_gold_handover(p_source_type := 'scrap_gold', p_physical_weight_g := 5, p_proba := 585, p_agreed_equivalent_g := 5, p_idempotency_key := '${key("fh")}')`);
    expect(await net()).toBe(-28.4);               // exactly -5 (before 091: +71.6, C2 lost)
    expect(r4(N((await vault()).h))).toBe(105);
    expect([N(fh.current_factory_obligation_g), N(fh.current_factory_advance_g)]).toEqual([0, 28.4]);
    let s = await partsNet();
    expect([r4(s.partsNetG), s.mismatchG === null ? null : r4(s.mismatchG)]).toEqual([-28.4, 0]);
    await as(mgr, `public.rpc_reverse_factory_gold_handover('${fh.handover_id}', 'xato', '${key("fhr")}')`);
    expect([await net(), r4(N((await vault()).h))]).toEqual([-23.4, 100]);
    // the obligation side: a new 100 g receipt (+110) -> obligation 86.6; a handover across zero is exact both ways
    await as(mgr, `public.rpc_record_factory_receipt(p_product_name := 'Kirim 2', p_original_physical_g := 100, p_factory_markup_pct := 10, p_idempotency_key := '${key("r3")}')`);
    expect(await net()).toBe(86.6);
    const fh2 = await as(mgr, `public.rpc_record_factory_gold_handover(p_source_type := 'scrap_gold', p_physical_weight_g := 5, p_proba := 585, p_agreed_equivalent_g := 5, p_idempotency_key := '${key("fh2")}')`);
    expect([await net(), N(fh2.current_factory_obligation_g), N(fh2.current_factory_advance_g)]).toEqual([81.6, 81.6, 0]);
    s = await partsNet();
    expect(r4(s.mismatchG ?? 99)).toBe(0);
    // the period report's factory column equals the account as well
    const pe = await one(`SELECT round(coalesce(sum(factory_g), 0), 4) f FROM public._goldia_period_effects('${org}')`);
    expect(N(pe.f)).toBe(81.6);
    expect(p1).toBeTruthy();
    await t.expectError(`SELECT public.rpc_reverse_seller_lom_purchase('${p1}', 'x', '${key("pr")}')`, "ERR_LOM_ALREADY_USED");
  });

  it("C2 the generic handover reversal still refuses a 090 finished-goods return; its own reversal works", async () => {
    const rc = (await one(`SELECT id FROM public.factory_receipts WHERE organization_id = '${org}' AND product_name = 'Kirim 2'`)).id as string;
    const n0 = await net();
    const r = await as(mgr, `public.rpc_return_goods_to_factory('${rc}', 1, 'qaytarish', '${key("g")}')`);
    expect(await net()).toBe(r4(n0 - 1.1));
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reverse_factory_gold_handover('${r.handover_id}', 'x', '${key("gx")}')`, "ERR_FINISHED_GOODS_HANDOVER");
    await as(mgr, `public.rpc_reverse_factory_goods_return('${r.return_id}', 'xato', '${key("gr")}')`);
    expect(await net()).toBe(n0);
  });

  it("C3 a later financial restart reverses goods returns and LOM purchases too (the 090 guard lets only its bulk statement through)", async () => {
    const rc = (await one(`SELECT id FROM public.factory_receipts WHERE organization_id = '${org}' AND product_name = 'Kirim 2'`)).id as string;
    await as(mgr, `public.rpc_return_goods_to_factory('${rc}', 1, 'qaytarish', '${key("g2")}')`);
    await as(mgr, `public.rpc_record_factory_receipt(p_product_name := 'x', p_original_physical_g := 1, p_factory_markup_pct := 1, p_idempotency_key := '${key("rx")}')`);
    await as(S1, `public.rpc_record_seller_lom_purchase(p_physical_g := 0.5, p_proba := 585, p_idempotency_key := '${key("p9")}', p_uzs_amount := 450000)`);
    await t.asAdmin();
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 't91 b', true)`);
    await new Promise((r) => setTimeout(r, 20));
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 't91b.dump', true) RETURNING id`)).id;
    await as(dir, `public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 't91 b', '${new Date(Date.now() - 1000).toISOString()}', '${bv}', '${key("restart2")}')`);
    const left = await one(`SELECT (SELECT count(*) FROM public.factory_goods_returns WHERE organization_id = '${org}' AND status = 'confirmed') g,
      (SELECT count(*) FROM public.seller_lom_purchases WHERE organization_id = '${org}' AND status = 'confirmed') l,
      (SELECT count(*) FROM public.factory_gold_handovers WHERE organization_id = '${org}' AND status <> 'reversed') h`);
    expect([N(left.g), N(left.l), N(left.h)]).toEqual([0, 0, 0]);
    expect(await till(S1)).toMatchObject({ uzs: "0.00", lp: "0.0000" });
  });

  it("R1 rollback 091 is refused while a seller LOM purchase exists", async () => {
    await t.asAdmin();
    const fs = await import("node:fs");
    let msg = "";
    try { await t.db.exec(fs.readFileSync("supabase/rollback/20260101000091_rollback.sql", "utf8")); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).toContain("ROLLBACK 091 REFUSED");
  });
});
