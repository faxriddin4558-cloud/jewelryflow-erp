import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 077: director = manager, UZS / USD price sales, period report without any zero-reset.
type Rep = { flows: Record<string, Record<string, number>>; closing: Record<string, number>; opening: Record<string, number>; undocumented_opening: Record<string, unknown> };

describe("Goldia 077 — manager parity, currency sales, period report", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-00000000a077";
  let dir: { userId: string; employeeId: string };
  let mgr: { userId: string; employeeId: string };
  let seller: { userId: string; employeeId: string };
  let seller2: { userId: string; employeeId: string };
  let cust: string;
  let cust2: string;
  const today = `(timezone('Asia/Tashkent', now()))::date`;
  const n = async (sql: string) => Number(await t.scalar(sql));
  const cur = async (c: string, currency: string) => {
    await t.asAdmin();
    const r = await t.db.query<{ d: string; a: string }>(`SELECT debt_amount d, advance_amount a FROM public.client_currency_accounts WHERE customer_id = '${c}' AND currency = '${currency}'`);
    return r.rows[0] ? { d: Number(r.rows[0].d), a: Number(r.rows[0].a) } : { d: 0, a: 0 };
  };
  const acc = async (s: string) => {
    await t.asAdmin();
    const r = await t.db.query<Record<string, string>>(`SELECT current_physical_stock_g st, total_seller_obligation_g o, seller_till_cash_amount c,
      seller_till_usd_amount u, seller_till_scrap_grams sc FROM public.seller_gold_accounts WHERE seller_id = '${s}'`);
    const x = r.rows[0]!;
    return { st: Number(x.st), o: Number(x.o), c: Number(x.c), u: Number(x.u), sc: Number(x.sc) };
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'org-077', 'Org 077', 'ACTIVE')`);
    dir = await t.addUser(org, "dir077@goldia.uz", "Dir", "director");
    mgr = await t.addUser(org, "mgr077@goldia.uz", "Mgr", "production_manager");
    seller = await t.addUser(org, "sel077@goldia.uz", "Sel", "sales");
    seller2 = await t.addUser(org, "sel077b@goldia.uz", "Sel2", "sales");
    await t.asAdmin();
    cust = (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${org}', 'C077', 'Mijoz', '${seller.employeeId}') RETURNING id`)).rows[0]!.id;
    cust2 = (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${org}', 'C077B', 'Mijoz2', '${seller2.employeeId}') RETURNING id`)).rows[0]!.id;
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_set_daily_gold_rate(p_rate_per_gram := 900000, p_rate_date := ${today})`);
    // manager gives the seller 20 g at 10 % (obligation 22 g)
    await t.asUser(mgr.userId);
    const r = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'R', p_original_physical_g := 40, p_factory_markup_pct := 8)`);
    await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${seller.employeeId}', p_factory_markup_pct := 8, p_seller_markup_pct := 10,
      p_factory_receipt_id := '${r.receipt_id}', p_pieces := '[{"weight_grams":8},{"weight_grams":12},{"weight_grams":10}]'::jsonb)`);
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_set_my_seller_rates(p_lom_rate_uzs := 900000, p_usd_rate_uzs := 12500)`);
  });

  it("A: the manager can do what was director-only (accounting baseline, reclassification, presets, product consignment)", async () => {
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_manage_sales_markup_preset(p_type := 'client_markup', p_name := 'M 13', p_percentage := 13)`);
    await t.asAdmin();
    expect(await n(`(SELECT count(*) FROM public.sales_markup_presets WHERE organization_id = '${org}' AND percentage = 13)`)).toBe(1);
    await t.asUser(mgr.userId);
    const cap = await t.rpc(`public.rpc_record_financial_transaction(p_transaction_type := 'capital_contribution', p_source_till := 'manager_uzs',
      p_amount := 1250000, p_currency := 'UZS', p_gold_rate := 900000, p_usd_rate := 12500)`);
    const capId = cap.transaction_id ?? cap.id;
    await t.asAdmin();
    expect(await n(`(SELECT manager_cash_amount FROM public.manager_vault_account WHERE organization_id = '${org}')`)).toBe(1250000);
    // the manager reclassifies it (075/076: director only): 1 250 000 UZS -> 100 USD
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reclassify_capital_transaction(p_transaction_id := '${capId}', p_new_destination := 'manager_usd', p_reason := 'aslida dollar edi')`);
    await t.asAdmin();
    expect(await n(`(SELECT manager_cash_amount FROM public.manager_vault_account WHERE organization_id = '${org}')`)).toBe(0);
    expect(await n(`(SELECT manager_usd_amount FROM public.manager_vault_account WHERE organization_id = '${org}')`)).toBe(100);
    expect(await n(`(SELECT amount_num FROM public.financial_transactions WHERE id = '${capId}')`)).toBe(100);
    expect(await n(`(SELECT reclassified_from_amount FROM public.financial_transactions WHERE id = '${capId}')`)).toBe(1250000);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reclassify_capital_transaction(p_transaction_id := '${capId}', p_new_destination := 'manager_uzs', p_reason := 'yana')`, "allaqachon qayta tasniflangan");
    // a second capital stays, so the reversal below must take exactly 100 USD (before 077 it took 1 250 000 "USD")
    await t.rpc(`public.rpc_record_financial_transaction(p_transaction_type := 'capital_contribution', p_source_till := 'manager_usd', p_amount := 500, p_currency := 'USD', p_usd_rate := 12500)`);
    await t.rpc(`public.rpc_reverse_financial_transaction(p_transaction_id := '${capId}', p_reason := 'test')`);
    await t.asAdmin();
    expect(await n(`(SELECT manager_usd_amount FROM public.manager_vault_account WHERE organization_id = '${org}')`)).toBe(500);
    // capital for the later tests
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_record_financial_transaction(p_transaction_type := 'capital_contribution', p_source_till := 'manager_uzs', p_amount := 1000000, p_currency := 'UZS')`);
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_record_financial_transaction(p_transaction_type := 'business_expense', p_source_till := 'manager_uzs', p_amount := 50000, p_currency := 'UZS', p_category := 'ijara')`);
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_manage_sales_markup_preset(p_type := 'client_markup', p_name := 'S', p_percentage := 9)`, "Permission denied");
  });

  it("B: $2000 sale of 20 g: stock -20 g, the 22 g obligation stays, customer owes 2000 USD, 585 debt untouched", async () => {
    const before = await acc(seller.employeeId);
    await t.asUser(seller.userId);
    const s = await t.rpc(`public.rpc_record_currency_sale(p_customer_id := '${cust}', p_currency := 'USD', p_amount := 2000, p_weight_grams := 20, p_idempotency_key := 'cs-1')`);
    expect(Number(s.sale_amount)).toBe(2000);
    const after = await acc(seller.employeeId);
    expect(after.st).toBe(before.st - 20);
    expect(after.o).toBe(before.o); // 33 g obligation (30 g x 1.10) unchanged by the sale
    expect(before.o).toBe(33);
    expect(await cur(cust, "USD")).toEqual({ d: 2000, a: 0 });
    await t.asAdmin();
    expect(await n(`(SELECT coalesce(current_debt_grams, 0) FROM public.client_gold_accounts WHERE customer_id = '${cust}')`)).toBe(0);
    expect(await n(`(SELECT coalesce(sum(grams), 0) FROM public.weight_sale_allocations WHERE sale_id = '${s.sale_id}')`)).toBe(20);
    expect(await n(`(SELECT count(*) FROM public.jewelry_sales WHERE id = '${s.sale_id}' AND markup_difference_g IS NULL AND client_gold_due_grams = 0)`)).toBe(1);
    // retry with the same key -> same sale, nothing deducted twice
    await t.asUser(seller.userId);
    const again = await t.rpc(`public.rpc_record_currency_sale(p_customer_id := '${cust}', p_currency := 'USD', p_amount := 2000, p_weight_grams := 20, p_idempotency_key := 'cs-1')`);
    expect(again.sale_id).toBe(s.sale_id);
    expect((await acc(seller.employeeId)).st).toBe(before.st - 20);
    // another seller's customer, negative / zero, too heavy
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_record_currency_sale(p_customer_id := '${cust2}', p_currency := 'USD', p_amount := 10, p_weight_grams := 1)`, "boshqa sotuvchiga");
    await t.expectError(`SELECT public.rpc_record_currency_sale(p_customer_id := '${cust}', p_currency := 'USD', p_amount := -5, p_weight_grams := 1)`, "ERR_AMOUNT");
    await t.expectError(`SELECT public.rpc_record_currency_sale(p_customer_id := '${cust}', p_currency := 'EUR', p_amount := 5, p_weight_grams := 1)`, "ERR_CURRENCY");
    await t.expectError(`SELECT public.rpc_record_currency_sale(p_customer_id := '${cust}', p_currency := 'UZS', p_amount := 5, p_weight_grams := 99)`, "ERR_INSUFFICIENT_SELLER_STOCK");
  });

  it("B: payments - USD partial, UZS and scrap at the seller's own rates, overpay -> advance; till gets each asset once", async () => {
    const t0 = await acc(seller.employeeId);
    await t.asUser(seller.userId);
    const p1 = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cust}', p_currency := 'USD', p_usd_amount := 500, p_idempotency_key := 'cp-1')`);
    expect(Number(p1.credited_amount)).toBe(500);
    expect(await cur(cust, "USD")).toEqual({ d: 1500, a: 0 });
    const p1b = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cust}', p_currency := 'USD', p_usd_amount := 500, p_idempotency_key := 'cp-1')`);
    expect(p1b.settlement_id).toBe(p1.settlement_id);
    expect(await cur(cust, "USD")).toEqual({ d: 1500, a: 0 });
    // 6 250 000 UZS at the seller's 12 500 UZS/USD = 500 USD
    const p2 = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cust}', p_currency := 'USD', p_cash_uzs := 6250000)`);
    expect(Number(p2.credited_amount)).toBe(500);
    expect(Number(p2.rate_usd_uzs)).toBe(12500);
    // 10 g of 750 scrap = 12.8205 g 585 x 900 000 = 11 538 450 UZS / 12 500 = 923.08 USD
    const p3 = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cust}', p_currency := 'USD', p_scrap_weight := 10, p_scrap_proba := 750)`);
    expect(Number(p3.scrap_585_g)).toBe(12.8205);
    expect(Number(p3.credited_amount)).toBe(923.08);
    expect(await cur(cust, "USD")).toEqual({ d: 76.92, a: 0 });
    // overpay -> advance
    const p4 = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cust}', p_currency := 'USD', p_usd_amount := 100)`);
    expect(Number(p4.to_advance)).toBe(23.08);
    expect(await cur(cust, "USD")).toEqual({ d: 0, a: 23.08 });
    const t1 = await acc(seller.employeeId);
    expect(t1.u - t0.u).toBe(600);
    expect(t1.c - t0.c).toBe(6250000);
    expect(Math.round((t1.sc - t0.sc) * 1e4) / 1e4).toBe(12.8205);
    // a seller sending another USD rate is refused (ERR_RATE_MISMATCH), negative refused
    await t.expectError(`SELECT public.rpc_record_client_currency_settlement(p_customer_id := '${cust}', p_currency := 'USD', p_cash_uzs := 100000, p_usd_rate := 13000)`, "ERR_RATE_MISMATCH");
    await t.expectError(`SELECT public.rpc_record_client_currency_settlement(p_customer_id := '${cust}', p_currency := 'USD', p_usd_amount := -1)`, "manfiy");
    // management must give the rate for a conversion
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_record_client_currency_settlement(p_customer_id := '${cust}', p_currency := 'USD', p_cash_uzs := 100000)`, "ERR_RATE_REQUIRED");
  });

  it("B: reversals - payment reversal restores debt and takes the money out of the till once; sale reversal returns stock and the USD debt", async () => {
    await t.asAdmin();
    const pid = (await t.db.query<{ id: string }>(`SELECT id FROM public.client_currency_settlements WHERE idempotency_key = 'cp-1'`)).rows[0]!.id;
    const t0 = await acc(seller.employeeId);
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_currency_settlement(p_settlement_id := '${pid}', p_reason := 'x')`, "Permission denied");
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_client_currency_settlement(p_settlement_id := '${pid}', p_reason := 'xato')`);
    expect(await cur(cust, "USD")).toEqual({ d: 476.92, a: 0 });
    expect((await acc(seller.employeeId)).u).toBe(t0.u - 500);
    await t.expectError(`SELECT public.rpc_reverse_client_currency_settlement(p_settlement_id := '${pid}', p_reason := 'yana')`, "allaqachon");
    await t.asAdmin();
    const sid = (await t.db.query<{ id: string }>(`SELECT id FROM public.jewelry_sales WHERE idempotency_key = 'cs-1'`)).rows[0]!.id;
    const st0 = (await acc(seller.employeeId)).st;
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_client_sale(p_sale_id := '${sid}', p_reason := 'qaytdi')`);
    expect((await acc(seller.employeeId)).st).toBe(st0 + 20);
    // net USD: 476.92 - 2000 = -1523.08 -> advance 1523.08 (paid more than the remaining sales)
    expect(await cur(cust, "USD")).toEqual({ d: 0, a: 1523.08 });
  });

  it("C: period report - flows by kind, units separate, opening + flows = closing, nothing undocumented, closing a period changes nothing", async () => {
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_get_period_report(${today} - 30, ${today})`, "faqat direktor va menejer");
    await t.asUser(mgr.userId);
    const rep = (await t.rpc(`public.rpc_get_period_report(${today} - 30, ${today})`)) as unknown as Rep;
    expect(rep.flows.sale_usd!.count).toBe(1);
    expect(Number(rep.flows.sale_usd!.amount)).toBe(2000);
    expect(Number(rep.flows.sale_usd!.physical_g)).toBe(20);
    expect(Number(rep.flows.consignment!.physical_g)).toBe(30);
    // every balance of this fully documented organization is explained by documents
    for (const v of Object.entries(rep.undocumented_opening)) if (v[0] !== "first_document_date") expect([v[0], Number(v[1])]).toEqual([v[0], 0]);
    // closing = live
    await t.asAdmin();
    expect(Number(rep.closing.customer_debt_net_usd)).toBe(-1523.08);
    expect(Number(rep.closing.seller_stock_physical_g)).toBe(await n(`(SELECT sum(current_physical_stock_g) FROM public.seller_gold_accounts WHERE organization_id = '${org}')`));
    expect(Number(rep.closing.manager_cash_uzs)).toBe(await n(`(SELECT manager_cash_amount FROM public.manager_vault_account WHERE organization_id = '${org}')`));
    // before any document everything was 0
    await t.asUser(mgr.userId);
    const past = (await t.rpc(`public.rpc_get_period_report(${today} - 400, ${today} - 300)`)) as unknown as Rep;
    for (const v of Object.values(past.closing)) expect(Number(v)).toBe(0);
    // close the period: no balance changes, re-close is idempotent, next period starts the day after
    await t.asAdmin();
    const snap = async () => (await t.db.query<{ h: string }>(`SELECT (SELECT md5(string_agg(x::text, ',' ORDER BY x::text)) FROM (
      SELECT row(current_debt_grams, advance_balance_grams)::text x FROM public.client_gold_accounts WHERE organization_id = '${org}'
      UNION ALL SELECT row(debt_amount, advance_amount)::text FROM public.client_currency_accounts WHERE organization_id = '${org}'
      UNION ALL SELECT row(current_physical_stock_g, seller_till_cash_amount, seller_till_usd_amount, seller_owes_manager_g)::text FROM public.seller_gold_accounts WHERE organization_id = '${org}'
      UNION ALL SELECT row(manager_cash_amount, manager_usd_amount, current_factory_obligation_g)::text FROM public.manager_vault_account WHERE organization_id = '${org}'
      UNION ALL SELECT count(*)::text FROM public.jewelry_sales WHERE organization_id = '${org}') q) AS h`)).rows[0]!.h;
    const s0 = await snap();
    await t.asUser(mgr.userId);
    const c1 = await t.rpc(`public.rpc_close_report_period(p_end := ${today} - 1)`);
    const c2 = await t.rpc(`public.rpc_close_report_period(p_end := ${today} - 1)`);
    expect(c2.already_closed).toBe(true);
    expect(c1.next_period_start).toBeTruthy();
    expect(await snap()).toBe(s0);
    const next = (await t.rpc(`public.rpc_get_period_report(${today}, ${today})`)) as unknown as Rep;
    expect(Number(next.opening.customer_debt_net_usd)).toBe(Number(rep.closing.customer_debt_net_usd) - Number(next.flows.reversal_sale?.customer_usd_change ?? 0) - Number(next.flows.sale_usd?.customer_usd_change ?? 0) - Number(next.flows.payment_usd?.customer_usd_change ?? 0) - Number(next.flows.reversal_payment_usd?.customer_usd_change ?? 0));
  });
});
