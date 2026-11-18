import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb, pieceIdsArg } from "./helpers/goldia-pglite";

// 089 (2026-11-18): old-sale returns (pre-T0 goods, opening E / F debts), CPAY in the journal, payment currency
// correction, seller till counts, stock movements. Every expected number is computed here from the business rules:
//   585 value = grams x (1 + original customer %); currency value = the entered original amount;
//   debt part = min(value, open debt), rest = advance; the OPENING part of the debt part releases the seller's opening
//   obligation (E: its grams; rated F: its share of the snapshot; unrated F: 0); goods back to the seller add
//   grams x (1 + seller %) to his obligation; goods to the manager: seller net 0, manager stock + grams.
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 089 — old-sale returns, CPAY journal, payment correction, till count, stock movements", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-000000000891";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S1: U, S2: U;
  let cE = "", cE2 = "", cR = "", cU = "", cP = "";
  let kn = 0;
  const key = (p: string) => `t89-${p}-${++kn}`;
  const RATE = 900000;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const doc = async (args: string) => { await t.asUser(mgr.userId); return t.rpc(`public.rpc_record_opening_document(${args}, p_idempotency_key := '${key("d")}')`); };
  const sacc = async (s: U) => one(`SELECT seller_owes_manager_g o, current_physical_stock_g st, total_seller_obligation_g tot FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`);
  const owes = async (s: U) => N((await sacc(s)).o) - N((await one(`SELECT manager_owes_seller_g v FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`)).v);
  const gnet = async (c: string) => { const r = await one(`SELECT current_debt_grams d, advance_balance_grams a FROM public.client_gold_accounts WHERE customer_id = '${c}'`); return r4(N(r.d) - N(r.a)); };
  const cnet = async (c: string, cur: string) => { const r = await one(`SELECT debt_amount d, advance_amount a FROM public.client_currency_accounts WHERE customer_id = '${c}' AND currency = '${cur}'`); return Math.round((N(r.d) - N(r.a)) * 100) / 100; };
  const mgrStock = async () => N((await one(`SELECT public.get_manager_available_stock_grams('${org}') v`)).v);
  const ret = async (args: string, as: U = mgr) => { await t.asUser(as.userId); return t.rpc(`public.rpc_record_opening_sale_return(${args})`); };
  const retArgs = (c: string, unit: string, w: number, pct: string, amt: string, recv: string, spct: string, k = key("r")) =>
    `p_customer_id := '${c}', p_unit := '${unit}', p_weight_grams := ${w}, p_customer_markup_pct := ${pct}, p_credit_amount := ${amt}, p_receiver := '${recv}', p_seller_markup_pct := ${spct}, p_reason := 'eski savdo qaytdi', p_confirmed := true, p_idempotency_key := '${k}'`;
  const pay = async (s: U, c: string, cash: number, lom: number, k = key("p")) => { await t.asUser(s.userId); return t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${c}', p_currency := 'UZS', p_cash_uzs := ${cash}, p_lom_rate := ${lom}, p_idempotency_key := '${k}')`); };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-89', 'Goldia 89', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-89@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-89@goldia.uz", "Menejer", "manager");
    S1 = await t.addUser(org, "s1-89@goldia.uz", "Sotuvchi 1", "sales");
    S2 = await t.addUser(org, "s2-89@goldia.uz", "Sotuvchi 2", "sales");
    const c = async (code: string, s: U) => (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${org}', '${code}', 'Mijoz ${code}', '+99890${code.replace(/\D/g, "").padStart(7, "0")}', '${s.employeeId}') RETURNING id`)).id as string;
    cE = await c("E-1", S1); cE2 = await c("E-2", S1); cR = await c("R-3", S1); cU = await c("U-4", S1); cP = await c("P-5", S2);
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, ${RATE}, 'UZS', true), ('${org}', public._goldia_business_date(), 585, ${RATE}, 'UZS', true) ON CONFLICT DO NOTHING`);
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 't89 window', true)`);
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 't89.dump', true) RETURNING id`)).id;
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 't89', '${new Date(Date.now() - 60_000).toISOString()}', '${bv}', 't89-restart')`);
    const a = (await doc(`p_kind := 'manager_inventory', p_physical_g := 100, p_factory_markup_pct := 8`)).document_id as string;
    await doc(`p_kind := 'seller_inventory', p_seller_id := '${S1.employeeId}', p_pieces := '[{"weight_grams":10},{"weight_grams":12}]'::jsonb, p_seller_markup_pct := 10, p_source_document_id := '${a}'`);
    await doc(`p_kind := 'customer_gram', p_customer_id := '${cE}', p_side := 'debt', p_amount := 50`);
    await doc(`p_kind := 'customer_gram', p_customer_id := '${cE2}', p_side := 'debt', p_amount := 5`);
    await doc(`p_kind := 'customer_currency', p_customer_id := '${cR}', p_unit := 'UZS', p_side := 'debt', p_amount := 9000000, p_lom_rate := 900000`); // rated 10 g
    await doc(`p_kind := 'customer_currency', p_customer_id := '${cU}', p_unit := 'UZS', p_side := 'debt', p_amount := 2000000`);                       // unrated
    await doc(`p_kind := 'customer_gram', p_customer_id := '${cP}', p_side := 'debt', p_amount := 8`);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'T0 t89', p_idempotency_key := '${key("b")}', p_usd_rate := 12500)`);
  }, 240000);

  it("O1 refused before writing: no % / no amount / not confirmed / a seller / no opening debt / the draft guard covers the table", async () => {
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_record_opening_sale_return(${retArgs(cE, "G585", 10, "null", "null", "seller", "10")})`, "ERR_PCT_REQUIRED");
    await t.expectError(`SELECT public.rpc_record_opening_sale_return(${retArgs(cR, "UZS", 5, "null", "null", "seller", "10")})`, "ERR_AMOUNT_REQUIRED");
    await t.expectError(`SELECT public.rpc_record_opening_sale_return(${retArgs(cE, "G585", 10, "20", "null", "seller", "null")})`, "ERR_PCT_REQUIRED");
    await t.expectError(`SELECT public.rpc_record_opening_sale_return(${retArgs(cE, "G585", 10, "20", "null", "seller", "10").replace("p_confirmed := true", "p_confirmed := false")})`, "ERR_CONFIRM_REQUIRED");
    await t.expectError(`SELECT public.rpc_record_opening_sale_return(${retArgs(cE, "USD", 10, "null", "100", "seller", "10")})`, "ERR_NO_OPENING_DEBT");
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_record_opening_sale_return(${retArgs(cE, "G585", 10, "20", "null", "seller", "10")})`, "ermission");
    await t.expectError(`SELECT public.rpc_preview_opening_sale_return('${cE}', 'G585', 10, 20, null)`, "ermission");
    await t.asAdmin();
    // the guard stays on its 12 tables; an active freeze refuses an old return through the guarded consignment tables
    expect(N((await one(`SELECT count(DISTINCT tgrelid) n FROM pg_trigger WHERE tgname = 'trg_goldia_opening_draft_guard' AND NOT tgisinternal`)).n)).toBe(12);
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 't89 freeze probe', true)`);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_record_opening_sale_return(${retArgs(cE, "G585", 1, "20", "null", "seller", "10")})`, "ERR_FINANCIAL_FREEZE");
    await t.asAdmin();
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 't89 freeze probe', false)`);
    expect(N((await one(`SELECT count(*) n FROM public.opening_sale_returns`)).n)).toBe(0);
  });

  it("O2 585 (E) return to the SELLER: customer -12 g, seller obligation -12 + 10 x 1.10 = -1 g, stock +10 g, preview = record, replay = same document", async () => {
    const o0 = await owes(S1), st0 = N((await sacc(S1)).st), n0 = await gnet(cE);
    expect(n0).toBe(50);
    await t.asUser(mgr.userId);
    const pv = await t.rpc(`public.rpc_preview_opening_sale_return('${cE}', 'G585', 10, 20, null)`);
    expect([N(pv.credit), N(pv.debt_reduced), N(pv.advance_created), N(pv.seller_obligation_released_g)]).toEqual([12, 12, 0, 12]);
    const k = key("r");
    const r = await ret(retArgs(cE, "G585", 10, "20", "null", "seller", "10", k));
    expect(N(r.credit)).toBe(12);
    expect(N(r.seller_goods_obligation_g)).toBe(11);
    const again = await ret(retArgs(cE, "G585", 10, "20", "null", "seller", "10", k));
    expect(again.return_id).toBe(r.return_id);
    expect(await gnet(cE)).toBe(38);
    expect(r4(await owes(S1) - o0)).toBe(-1);
    expect(r4(N((await sacc(S1)).st) - st0)).toBe(10);
    expect((await one(`SELECT status s FROM public.consignment_pieces WHERE id = '${r.piece_id}'`)).s).toBe("held_by_seller");
    // the 585 ledger recomputes the account from documents: it keeps exactly 38 g
    await t.asUser(mgr.userId);
    const led = await t.rpc(`public.rpc_get_unified_customer_ledger(p_customer_id := '${cE}')`);
    const item = (led.items as Record<string, unknown>[])[0]!;
    expect([N(item.net_debt_g), N(item.old_sale_return_g)]).toEqual([38, 12]);
    expect(await gnet(cE)).toBe(38);
    // opening documents untouched (LOCK)
    expect(N((await one(`SELECT amount a FROM public.opening_documents WHERE customer_id = '${cE}' AND kind = 'customer_gram'`)).a)).toBe(50);
  });

  it("O3 585 return to the MANAGER, value above the debt: debt part = 5 g (opening part, released), 1.6 g advance, seller stock 0, manager +4 g", async () => {
    const o0 = await owes(S1), st0 = N((await sacc(S1)).st), m0 = await mgrStock();
    const r = await ret(retArgs(cE2, "G585", 5.5, "20", "null", "manager", "null"));
    // 5.5 x 1.2 = 6.6 g; the debt is 5 g -> 5 g debt, 1.6 g advance
    expect([N(r.credit), N(r.debt_reduced), N(r.advance_created), N(r.seller_obligation_released_g)]).toEqual([6.6, 5, 1.6, 5]);
    expect(await gnet(cE2)).toBe(-1.6);
    expect(r4(await owes(S1) - o0)).toBe(-5);
    expect(r4(N((await sacc(S1)).st) - st0)).toBe(0);
    expect(r4(await mgrStock() - m0)).toBe(5.5);
    expect((await one(`SELECT status s FROM public.consignment_pieces WHERE id = '${r.piece_id}'`)).s).toBe("returned_to_manager");
    // a second return on a fully returned opening debt: no opening part left, all advance, nothing released
    const r2 = await ret(retArgs(cE2, "G585", 1, "0", "null", "manager", "null"));
    expect([N(r2.debt_reduced), N(r2.advance_created), N(r2.seller_obligation_released_g)]).toEqual([0, 1, 0]);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_get_unified_customer_ledger(p_customer_id := '${cE2}')`);
    expect(await gnet(cE2)).toBe(-2.6);
  });

  it("O4 rated UZS (F) return: 4 500 000 releases 5 g of the 10 g snapshot; a later payment takes only the rest (5 g) - counted once", async () => {
    const o0 = await owes(S1);
    const r = await ret(retArgs(cR, "UZS", 4, "null", "4500000", "seller", "10"));
    expect([N(r.debt_reduced), N(r.opening_part), N(r.seller_obligation_released_g)]).toEqual([4500000, 4500000, 5]);
    expect(await cnet(cR, "UZS")).toBe(4500000);
    // obligation: -5 g (released) + 4 x 1.10 (goods) = -0.6 g
    expect(r4(await owes(S1) - o0)).toBe(-0.6);
    const o1 = await owes(S1);
    const p = await pay(S1, cR, 6000000, 1000000);
    expect(N(p.opening_snapshot_585_g)).toBe(5);
    expect(N((await one(`SELECT opening_applied_amount a FROM public.client_currency_settlements WHERE id = '${p.settlement_id}'`)).a)).toBe(4500000);
    expect(await owes(S1)).toBe(o1); // rated: the payment only moves the 5 g into the valued pool
    expect(await cnet(cR, "UZS")).toBe(-1500000);
  });

  it("O5 unrated UZS (F) return: nothing released (never in the obligation); a later payment values only what is left", async () => {
    const o0 = await owes(S1);
    const r = await ret(retArgs(cU, "UZS", 2, "null", "500000", "manager", "null"));
    expect([N(r.opening_part), N(r.seller_obligation_released_g)]).toEqual([500000, 0]);
    expect(r4(await owes(S1) - o0)).toBe(0);
    const p = await pay(S1, cU, 2000000, 1000000);
    // only 1 500 000 of the opening debt is left: valued at this payment's rate = 1.5 g into the obligation
    expect(N((await one(`SELECT opening_applied_amount a, snapshot_released_g g FROM public.client_currency_settlements WHERE id = '${p.settlement_id}'`)).a)).toBe(1500000);
    expect(N(p.unrated_opening_debt_valued_g)).toBe(1.5);
  });

  it("O6 reversal restores customer, seller obligation, stock and manager stock; second reversal refused; goods used -> refused", async () => {
    await t.asAdmin();
    const r = await ret(retArgs(cP, "G585", 3, "10", "null", "seller", "5"));
    const o1 = await owes(S2), st1 = N((await sacc(S2)).st);
    expect(await gnet(cP)).toBe(4.7);
    await t.asUser(mgr.userId);
    const k = key("rv");
    await t.rpc(`public.rpc_reverse_opening_sale_return('${r.return_id}', 'xato', '${k}')`);
    expect(await gnet(cP)).toBe(8);
    expect(r4(await owes(S2) - o1)).toBe(r4(3.3 - 3.15));
    expect(r4(N((await sacc(S2)).st) - st1)).toBe(-3);
    await t.expectError(`SELECT public.rpc_reverse_opening_sale_return('${r.return_id}', 'xato', '${key("rv")}')`, "allaqachon");
    await t.rpc(`public.rpc_get_unified_customer_ledger(p_customer_id := '${cP}')`);
    expect(await gnet(cP)).toBe(8);
    // manager-received return reversed: manager stock back
    const m0 = await mgrStock();
    const r2 = await ret(retArgs(cP, "G585", 2, "10", "null", "manager", "null"));
    expect(r4(await mgrStock() - m0)).toBe(2);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_opening_sale_return('${r2.return_id}', 'xato', '${key("rv")}')`);
    expect(r4(await mgrStock() - m0)).toBe(0);
    expect(await gnet(cP)).toBe(8);
    // goods sold after the return -> the return cannot be reversed
    const r3 = await ret(retArgs(cP, "G585", 1, "10", "null", "seller", "5"));
    await t.asAdmin();
    await t.db.exec(`UPDATE public.consignment_pieces SET status = 'sold' WHERE id = '${r3.piece_id}'`);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reverse_opening_sale_return('${r3.return_id}', 'xato', '${key("rv")}')`, "ERR_RETURN_GOODS_USED");
    await t.asAdmin();
    await t.db.exec(`UPDATE public.consignment_pieces SET status = 'held_by_seller' WHERE id = '${r3.piece_id}'`);
  });

  it("C1 journal: CPAY rows (own type, 0 g) and old-sale return rows; reversed CPAY keeps its row with status reversed", async () => {
    await t.asUser(mgr.userId);
    const rows = (await t.db.query<Record<string, unknown>>(`SELECT * FROM public.rpc_get_daily_sales_ledger(null, public._goldia_business_date(), public._goldia_business_date())`)).rows;
    const cp = rows.filter((x) => x.tx_type === "currency_payment");
    expect(cp.length).toBeGreaterThanOrEqual(2);
    for (const x of cp) expect([N(x.total_payment_g), N(x.obligation_g), N(x.cash_equiv_g)]).toEqual([0, 0, 0]);
    expect(cp.some((x) => N(x.cash_received_uzs) === 6000000)).toBe(true);
    const orr = rows.filter((x) => x.tx_type === "opening_return");
    expect(orr.length).toBeGreaterThanOrEqual(5);
    expect(orr.some((x) => x.status === "reversed")).toBe(true);
    const led = await t.rpc(`public.rpc_get_unified_customer_ledger(p_customer_id := '${cR}')`);
    const cur = ((led.items as Record<string, unknown>[])[0]!.currency as Record<string, Record<string, unknown>>).UZS!;
    expect([N(cur.cpay_paid), N(cur.cpay_count), N(cur.advance)]).toEqual([6000000, 1, 1500000]);
  });

  it("K1 a USD payment typed as UZS in CPAY is corrected to USD in one step; a failing new entry leaves the old payment intact", async () => {
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id) VALUES ('${org}', 'K-6', 'Mijoz K', '+998900000066', '${S2.employeeId}')`);
    const c = (await one(`SELECT id FROM public.customers WHERE customer_code = 'K-6'`)).id as string;
    await t.db.query(`SELECT public._goldia_currency_account_add('${org}', '${c}', '${S2.employeeId}', 'USD', 1000)`);
    await t.asUser(S2.userId);
    const bad = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${c}', p_currency := 'USD', p_cash_uzs := 6325000, p_usd_rate := 12650, p_idempotency_key := '${key("bad")}')`);
    expect(await cnet(c, "USD")).toBe(500);
    const till0 = await one(`SELECT seller_till_cash_amount u, seller_till_usd_amount d FROM public.seller_gold_accounts WHERE seller_id = '${S2.employeeId}'`);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_correct_client_payment('CPAY', '${bad.settlement_id}', 'CPAY', '{"currency":"USD","usd_amount":-5}'::jsonb, 'dollar edi', '${key("k")}')`, "");
    expect((await one(`SELECT status s FROM public.client_currency_settlements WHERE id = '${bad.settlement_id}'`)).s).not.toBe("reversed");
    await t.asUser(mgr.userId);
    const k = key("k");
    const res = await t.rpc(`public.rpc_correct_client_payment('CPAY', '${bad.settlement_id}', 'CPAY', '{"currency":"USD","usd_amount":500}'::jsonb, 'dollar edi', '${k}')`);
    const again = await t.rpc(`public.rpc_correct_client_payment('CPAY', '${bad.settlement_id}', 'CPAY', '{"currency":"USD","usd_amount":500}'::jsonb, 'dollar edi', '${k}')`);
    expect(again.new_payment_id).toBe(res.new_payment_id);
    expect((await one(`SELECT status s FROM public.client_currency_settlements WHERE id = '${bad.settlement_id}'`)).s).toBe("reversed");
    expect(await cnet(c, "USD")).toBe(500);
    const till1 = await one(`SELECT seller_till_cash_amount u, seller_till_usd_amount d FROM public.seller_gold_accounts WHERE seller_id = '${S2.employeeId}'`);
    expect([N(till1.u) - N(till0.u), N(till1.d) - N(till0.d)]).toEqual([-6325000, 500]);
    expect(N((await one(`SELECT count(*) n FROM public.audit_logs WHERE action = 'CORRECT_CLIENT_PAYMENT' AND record_id = '${bad.settlement_id}'`)).n)).toBe(1);
  });

  it("T1 till count: a record only (till unchanged); a shortage needs a reason; a seller cannot record it", async () => {
    const till0 = await one(`SELECT seller_till_cash_amount u, seller_till_usd_amount d, seller_owes_manager_g o FROM public.seller_gold_accounts WHERE seller_id = '${S1.employeeId}'`);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_record_seller_till_count('${S1.employeeId}', 0, 0, null, null, '${key("tc")}')`, "ERR_EXPLANATION_REQUIRED");
    const c = await t.rpc(`public.rpc_record_seller_till_count('${S1.employeeId}', ${N(till0.u) - 1000000}, ${N(till0.d)}, 'personal_use', 'oilaviy xarajat, ertaga qaytaradi', '${key("tc")}')`);
    expect([N(c.diff_uzs), c.explanation]).toEqual([-1000000, "personal_use"]);
    const ok = await t.rpc(`public.rpc_record_seller_till_count('${S1.employeeId}', ${N(till0.u)}, ${N(till0.d)}, null, null, '${key("tc")}')`);
    expect(ok.explanation).toBe("match");
    const till1 = await one(`SELECT seller_till_cash_amount u, seller_till_usd_amount d, seller_owes_manager_g o FROM public.seller_gold_accounts WHERE seller_id = '${S1.employeeId}'`);
    expect(till1).toEqual(till0);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT public.rpc_record_seller_till_count('${S1.employeeId}', 0, 0, 'shortage', 'x', '${key("tc")}')`, "ermission");
    expect(N(await t.scalar(`(SELECT count(*) FROM public.seller_till_counts)`))).toBe(2); // the seller sees his own counts (RLS)
  });

  it("M1 stock movements: all-time sum = stored stock for every seller, a sale and a return appear, seller sees only himself, duplicates listed", async () => {
    await t.asAdmin();
    const ids = await pieceIdsArg(t.db, S1.employeeId, 10);
    await t.asUser(S1.userId);
    await t.rpc(`public.rpc_record_jewelry_sale(p_customer_id := '${cE}', p_weight_grams := 10, p_client_markup_pct := 20, ${ids}, p_idempotency_key := '${key("s")}')`).catch(() => null);
    await t.asUser(mgr.userId);
    const m = await t.rpc(`public.rpc_get_seller_stock_movements(null, null, null)`);
    const sellers = m.sellers as Record<string, unknown>[];
    expect(sellers.length).toBeGreaterThanOrEqual(2);
    for (const s of sellers) expect(s.ok, JSON.stringify(s)).toBe(true);
    const lines = m.lines as Record<string, unknown>[];
    for (const k of ["opening_inventory", "old_sale_return", "return_to_manager", "consignment_cancelled"]) expect(lines.some((l) => l.kind === k), k).toBe(true);
    await t.asUser(S1.userId);
    const own = await t.rpc(`public.rpc_get_seller_stock_movements(null, null, null)`);
    expect((own.sellers as Record<string, unknown>[]).map((s) => s.seller_id)).toEqual([S1.employeeId]);
    await t.expectError(`SELECT public.rpc_get_seller_stock_movements('${S2.employeeId}', null, null)`, "Ruxsat");
  });

  it("P1 period effects: per seller the stock column sums to the stored stock; customer 585 effects of old returns sum to the account change", async () => {
    await t.asAdmin();
    const rows = (await t.db.query<Record<string, unknown>>(`SELECT seller_id, sum(stock_g) s FROM public._goldia_period_effects('${org}') WHERE seller_id IS NOT NULL GROUP BY seller_id`)).rows;
    for (const r of rows) {
      const st = N((await one(`SELECT current_physical_stock_g v FROM public.seller_gold_accounts WHERE seller_id = '${r.seller_id}'`)).v);
      expect(r4(N(r.s)), String(r.seller_id)).toBe(r4(st));
    }
    const ret585 = N((await one(`SELECT coalesce(sum(cust_g), 0) v FROM public._goldia_period_effects('${org}') WHERE kind LIKE '%opening_return_g585'`)).v);
    const live = N((await one(`SELECT coalesce(sum(credit_amount), 0) v FROM public.opening_sale_returns WHERE organization_id = '${org}' AND unit = 'G585' AND status = 'confirmed'`)).v);
    expect(r4(ret585)).toBe(r4(-live));
  });

  it("R1 rollback 089 is refused while 089 documents exist", async () => {
    await t.asAdmin();
    const fs = await import("node:fs");
    const sql = fs.readFileSync("supabase/rollback/20260101000089_rollback.sql", "utf8");
    let msg = "";
    try { await t.db.exec(sql); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).toContain("ROLLBACK 089 REFUSED");
    expect(N((await one(`SELECT count(*) n FROM pg_proc WHERE proname = 'rpc_record_opening_sale_return'`)).n)).toBe(1);
  });
});
