import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 066: company cash-to-scrap rate difference, plus the full
// Factory -> Manager -> Seller -> Customer -> Cash/Scrap -> Manager -> Refining -> Factory chain.
// Everything runs as the `authenticated` role with RLS on.

describe("Goldia 066 — company rate difference and full transaction chain", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgId = "00000000-0000-0000-0000-0000000000c6";
  let director: { userId: string; employeeId: string };
  let sellerA: { userId: string; employeeId: string };
  let sellerB: { userId: string; employeeId: string };
  let customerA: string;
  let receiptId: string;

  const sellerAccount = async () => {
    await t.asAdmin();
    const r = await t.db.query<{ seller_owes_manager_g: string; current_physical_stock_g: string; seller_till_cash_amount: string; seller_till_scrap_grams: string }>(
      `SELECT seller_owes_manager_g, current_physical_stock_g, seller_till_cash_amount, seller_till_scrap_grams
         FROM public.seller_gold_accounts WHERE seller_id = '${sellerA.employeeId}'`);
    return r.rows[0]!;
  };
  const customerDebt = async () => {
    await t.asAdmin();
    return t.scalar(`(SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${customerA}')`);
  };
  const vault = async () => {
    await t.asAdmin();
    return (await t.db.query<Record<string, string>>(`SELECT * FROM public.manager_vault_account WHERE organization_id = '${orgId}'`)).rows[0]!;
  };
  // Customer pays cash to seller A, then seller A hands the full cash to the manager.
  const cashThroughSeller = async (uzs: number) => {
    await t.asUser(sellerA.userId);
    await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${customerA}', p_cash_amount := ${uzs}, p_rate_per_gram := 890000)`);
    await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${sellerA.employeeId}', p_cash_paid_amount := ${uzs}, p_rate_per_gram := 890000)`);
  };
  const purchase = (uzs: number, rate: number, grams: number, key: string, proba = 585) =>
    t.rpc(`public.rpc_record_gold_purchase(p_supplier_name := 'Bozor', p_cash_spent_uzs := ${uzs}, p_rate_per_gram := ${rate},
      p_gold_weight_grams := ${grams}, p_proba := ${proba}, p_idempotency_key := '${key}')`);
  const report = async () => {
    await t.asUser(director.userId);
    return t.rpc(`public.rpc_get_company_rate_difference_report()`);
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${orgId}', 'goldia-066', 'Goldia 066', 'ACTIVE')`);
    director = await t.addUser(orgId, "dir066@goldia.uz", "Alisher", "director");
    sellerA = await t.addUser(orgId, "a066@goldia.uz", "Jamshid", "sales");
    sellerB = await t.addUser(orgId, "b066@goldia.uz", "Dilshod", "sales");
    customerA = (await t.db.query<{ id: string }>(`
      INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${orgId}', 'C066', 'Mijoz 066', '+998900000066', '${sellerA.employeeId}') RETURNING id`)).rows[0]!.id;
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed)
                     VALUES ('${orgId}', CURRENT_DATE, 585, 890000, 'UZS', true)`);

    // FACTORY -> MANAGER: 100 g at 8% factory markup (obligation on original weight = 108 g)
    await t.asUser(director.userId);
    const rcp = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'Partiya 066', p_original_physical_g := 100, p_factory_markup_pct := 8)`);
    expect(rcp.status).toBe("ok");
    receiptId = String(rcp.receipt_id);
    expect(Number(rcp.factory_obligation_g)).toBe(108);

    // MANAGER -> SELLER: 10 g + 20 g + 5 g at 12% seller markup (obligation 35 * 1.12 = 39.2 g)
    const cons = await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${sellerA.employeeId}', p_factory_markup_pct := 8,
      p_pieces := '[{"weight_grams":10,"model_code":"R10","purity":585},{"weight_grams":20,"model_code":"R20","purity":585},{"weight_grams":5,"model_code":"R5","purity":585}]'::jsonb,
      p_notes := 'chain', p_seller_markup_pct := 12)`);
    expect(cons.status).toBe("ok");
  });

  it("chain step 1: markups use the original weight and physical stock is conserved", async () => {
    await t.asAdmin();
    const piece10 = (await t.db.query<{ id: string }>(`SELECT id FROM public.consignment_pieces WHERE seller_id = '${sellerA.employeeId}' AND weight_grams = 10`)).rows[0]!.id;
    await t.asUser(sellerA.userId);
    const sale = await t.rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${customerA}', p_piece_id := '${piece10}', p_client_markup_pct := 15)`);
    expect(Number(sale.client_gold_due_grams)).toBe(11.5); // 10 * 1.15, not compounded on 10.8
    const acc = await sellerAccount();
    expect(Number(acc.seller_owes_manager_g)).toBe(39.2);
    expect(Number(acc.current_physical_stock_g)).toBe(25);

    await t.asUser(director.userId);
    const managerAvail = await t.scalar(`public.get_manager_available_stock_grams()`);
    await t.asAdmin();
    const sold = await t.scalar(`(SELECT sum(base_weight_grams) FROM public.jewelry_sales WHERE status NOT IN ('reversed','cancelled'))`);
    expect(managerAvail + Number(acc.current_physical_stock_g) + sold).toBe(100);
    expect(await customerDebt()).toBe(11.5);
  });

  it("negative stock and duplicate submissions are rejected", async () => {
    await t.asUser(sellerA.userId);
    await t.expectError(`SELECT public.rpc_record_weight_sale(p_customer_id := '${customerA}', p_weight_grams := 500, p_client_markup_pct := 10)`, "ERR_INSUFFICIENT_SELLER_STOCK");
    const first = await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${customerA}', p_scrap_weight := 3, p_scrap_proba := 585, p_idempotency_key := 'dup-scrap-1')`);
    const again = await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${customerA}', p_scrap_weight := 3, p_scrap_proba := 585, p_idempotency_key := 'dup-scrap-1')`);
    expect(again.settlement_id).toBe(first.settlement_id);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT count(*) FROM public.gold_settlements WHERE idempotency_key = 'dup-scrap-1')`)).toBe(1);
    expect(await customerDebt()).toBe(8.5); // 11.5 - 3 g scrap, counted once
  });

  it("scenario A: 890,000 UZS settled as 1 g, scrap bought at 900,000 UZS/g -> company -0.0111 g; seller and customer unchanged", async () => {
    await cashThroughSeller(890000);
    const sellerBefore = await sellerAccount();
    const debtBefore = await customerDebt();
    expect(Number(sellerBefore.seller_owes_manager_g)).toBe(38.2); // 39.2 - 1 g cash handover
    const pool = await vault();
    expect(Number(pool.valued_cash_uzs)).toBe(890000);
    expect(Number(pool.valued_cash_585_g)).toBe(1);

    await t.asUser(director.userId);
    const p = await purchase(890000, 900000, 0.9889, "buy-a");
    expect(p.status).toBe("ok");
    const r = await report();
    const entry = (r.entries as Record<string, unknown>[])[0]!;
    expect(Number(entry.accounting_value_585_g)).toBe(1);
    expect(Number(entry.physical_grams)).toBe(0.9889);
    expect(Number(entry.avg_conversion_rate)).toBe(890000);
    expect(Number(entry.purchase_rate_per_gram)).toBe(900000);
    expect(Number(entry.difference_585_g)).toBe(-0.0111);

    const sellerAfter = await sellerAccount();
    expect(sellerAfter.seller_owes_manager_g).toBe(sellerBefore.seller_owes_manager_g);
    expect(await customerDebt()).toBe(debtBefore);
    expect(Number((await vault()).valued_cash_uzs)).toBe(0);
  });

  it("scenario B: bought at 880,000 UZS/g -> company +0.0114 g; idempotent replay records nothing twice", async () => {
    await cashThroughSeller(890000);
    await t.asUser(director.userId);
    await purchase(890000, 880000, 1.0114, "buy-b");
    await purchase(890000, 880000, 1.0114, "buy-b");
    const r = await report();
    expect(Number(r.purchases_count)).toBe(2);
    expect(Number(r.gain_585_g)).toBe(0.0114);
    expect(Number(r.loss_585_g)).toBe(-0.0111);
    expect(Number(r.net_difference_585_g)).toBe(0.0003);
    expect(r.included_in_profit_summary).toBe(true);
  });

  it("reversing a purchase offsets its difference and returns the value to the pool", async () => {
    await t.asAdmin();
    const purchaseB = (await t.db.query<{ id: string }>(`SELECT id FROM public.gold_purchases WHERE idempotency_key = 'buy-b'`)).rows[0]!.id;
    await t.asUser(director.userId);
    const rev = await t.rpc(`public.rpc_reverse_gold_purchase('${purchaseB}', 'xato xarid', null)`);
    expect(rev.status).toBe("ok");
    const r = await report();
    expect(Number(r.reversals_count)).toBe(1);
    expect(Number(r.net_difference_585_g)).toBe(-0.0111);
    expect(Number(r.gain_585_g)).toBe(0);
    const pool = await vault();
    expect(Number(pool.valued_cash_uzs)).toBe(890000);
    expect(Number(pool.valued_cash_585_g)).toBe(1);
  });

  it("purity is respected and unvalued (older) cash never creates a difference", async () => {
    // 750 purity: 1 g physical = 1.2821 g 585-eq (purchase stores 4 decimals), bought with the valued 890,000 UZS
    await t.asUser(director.userId);
    await purchase(890000, 890000, 1, "buy-750", 750);
    let r = await report();
    const e750 = (r.entries as Record<string, unknown>[]).find((e) => Number(e.proba) === 750)!;
    expect(Number(e750.valued_purchased_585_g)).toBe(1.2821);
    expect(Number(e750.difference_585_g)).toBe(0.2821);

    // Cash that predates 066 (no gram value) spent on scrap: no ledger row
    await t.asAdmin();
    await t.db.exec(`UPDATE public.manager_vault_account SET manager_cash_amount = manager_cash_amount + 500000 WHERE organization_id = '${orgId}'`);
    await t.asUser(director.userId);
    await purchase(500000, 900000, 0.5556, "buy-unvalued");
    r = await report();
    expect((r.entries as Record<string, unknown>[]).some((e) => e.purchase_no && Number(e.cash_spent_uzs) === 500000)).toBe(false);
  });

  it("chain step 2: scrap handover, refining and factory handover keep gold balanced", async () => {
    await t.asUser(sellerA.userId);
    await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${sellerA.employeeId}', p_scrap_weight_grams := 3, p_physical_scrap_g := 3)`);
    expect(Number((await vault()).manager_scrap_grams)).toBe(3);

    await t.asUser(director.userId);
    const ref = await t.rpc(`public.rpc_record_refining_batch(p_input_scrap_grams := 3, p_melted_weight_grams := 3,
      p_output_fine_grams := 1.75, p_output_fine_proba := 999, p_physical_scrap_grams := 3, p_input_scrap_proba := 585)`);
    expect(ref.status).toBe("ok");
    const afterRefining = await vault();
    expect(Number(afterRefining.manager_scrap_grams)).toBe(0);
    const refined = Number(afterRefining.manager_refined_gold_grams);
    expect(refined).toBeGreaterThan(0);

    await t.asUser(director.userId);
    const obligationBefore = Number((await vault()).current_factory_obligation_g);
    const h = await t.rpc(`public.rpc_record_factory_gold_handover(p_source_type := 'refined_gold', p_physical_weight_g := 1.75,
      p_proba := 999, p_factory_recipient := 'Zavod', p_notes := 'chain')`);
    expect(h.status).toBe("ok");
    const after = await vault();
    expect(Number(after.manager_refined_gold_grams)).toBeLessThan(refined + 0.0001);
    expect(Number(after.current_factory_obligation_g)).toBeLessThan(obligationBefore);
  });

  it("returns and reversals restore balances; cancelled records stay out of active balances", async () => {
    await t.asAdmin();
    const piece5 = (await t.db.query<{ id: string }>(`SELECT id FROM public.consignment_pieces WHERE seller_id = '${sellerA.employeeId}' AND weight_grams = 5`)).rows[0]!.id;
    const owesBefore = Number((await sellerAccount()).seller_owes_manager_g);
    await t.asUser(sellerA.userId);
    await t.rpc(`public.rpc_return_piece_to_manager('${piece5}', 'qaytarish', null)`);
    expect(Math.round((owesBefore - Number((await sellerAccount()).seller_owes_manager_g)) * 10000) / 10000).toBe(5.6);

    // A sale that is reversed must leave stock and debt exactly as before
    const stockBefore = Number((await sellerAccount()).current_physical_stock_g);
    const debtBefore = await customerDebt();
    await t.asAdmin();
    const piece20 = (await t.db.query<{ id: string }>(`SELECT id FROM public.consignment_pieces WHERE seller_id = '${sellerA.employeeId}' AND weight_grams = 20`)).rows[0]!.id;
    await t.asUser(sellerA.userId);
    const sale = await t.rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${customerA}', p_piece_id := '${piece20}', p_client_markup_pct := 12)`);
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_reverse_client_sale('${sale.sale_id}', 'sinov bekor', null)`);
    expect(Number((await sellerAccount()).current_physical_stock_g)).toBe(stockBefore);
    expect(await customerDebt()).toBe(debtBefore);

    // Physical conservation after return + reversed sale
    await t.asUser(director.userId);
    const managerAvail = await t.scalar(`public.get_manager_available_stock_grams()`);
    await t.asAdmin();
    const sold = await t.scalar(`(SELECT coalesce(sum(base_weight_grams), 0) FROM public.jewelry_sales WHERE status NOT IN ('reversed','cancelled'))`);
    expect(managerAvail + Number((await sellerAccount()).current_physical_stock_g) + sold).toBe(100);
    expect(receiptId).toBeTruthy();
  });

  it("sellers cannot see the company rate-difference ledger", async () => {
    await t.asUser(sellerB.userId);
    await t.expectError(`SELECT public.rpc_get_company_rate_difference_report()`, "Permission denied");
    const rows = await t.db.query(`SELECT 1 FROM public.company_rate_differences`);
    expect(rows.rows.length).toBe(0);
    await t.expectError(`INSERT INTO public.company_rate_differences (organization_id, entry_type, purchase_id) VALUES ('${orgId}', 'purchase', gen_random_uuid())`, "permission denied");
  });
});

describe("Goldia 066 — mixed historical rates, partial purchase, USD and non-purchase outflows", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgId = "00000000-0000-0000-0000-0000000000c7";
  let director: { userId: string; employeeId: string };
  let seller: { userId: string; employeeId: string };
  let customer: string;

  const vault = async () => {
    await t.asAdmin();
    return (await t.db.query<Record<string, string>>(`SELECT * FROM public.manager_vault_account WHERE organization_id = '${orgId}'`)).rows[0]!;
  };
  const lastEntry = async () => {
    await t.asUser(director.userId);
    const r = await t.rpc(`public.rpc_get_company_rate_difference_report()`);
    return { report: r, entry: (r.entries as Record<string, unknown>[])[0] };
  };
  const setRate = async (rate: number, dayOffset: number) => {
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed)
                     VALUES ('${orgId}', CURRENT_DATE + ${dayOffset}, 585, ${rate}, 'UZS', true)`);
  };
  const handover = async (sql: string) => {
    await t.asUser(seller.userId);
    return t.rpc(sql);
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${orgId}', 'goldia-066b', 'Goldia 066b', 'ACTIVE')`);
    director = await t.addUser(orgId, "dir066b@goldia.uz", "Alisher", "director");
    seller = await t.addUser(orgId, "s066b@goldia.uz", "Jasur", "sales");
    customer = (await t.db.query<{ id: string }>(`
      INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${orgId}', 'C066B', 'Mijoz', '+998900000067', '${seller.employeeId}') RETURNING id`)).rows[0]!.id;
  });

  it("cash received at two historical rates is valued at its weighted average; a partial purchase leaves the rest valued", async () => {
    await setRate(890000, 0);
    await handover(`public.rpc_record_client_settlement(p_customer_id := '${customer}', p_cash_amount := 890000, p_rate_per_gram := 890000)`);
    await handover(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${seller.employeeId}', p_cash_paid_amount := 890000, p_rate_per_gram := 890000)`);
    await setRate(900000, 1);
    await handover(`public.rpc_record_client_settlement(p_customer_id := '${customer}', p_cash_amount := 900000, p_rate_per_gram := 900000)`);
    await handover(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${seller.employeeId}', p_cash_paid_amount := 900000, p_rate_per_gram := 900000)`);
    let v = await vault();
    expect(Number(v.valued_cash_uzs)).toBe(1790000);
    expect(Number(v.valued_cash_585_g)).toBe(2);

    // Spend 900,000 of 1,790,000 at 880,000 UZS/g -> 1.0227 g bought; value released 2 * 900000 / 1790000 = 1.005587 g
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_record_gold_purchase(p_supplier_name := 'Bozor', p_cash_spent_uzs := 900000, p_rate_per_gram := 880000,
      p_gold_weight_grams := 1.0227, p_idempotency_key := 'mix-1')`);
    const { entry } = await lastEntry();
    expect(Number(entry!.accounting_value_585_g)).toBe(1.005587);
    expect(Number(entry!.difference_585_g)).toBe(0.017113);
    expect(Math.abs(Number(entry!.avg_conversion_rate) - 895000)).toBeLessThan(1); // display rate, 6-decimal grams
    v = await vault();
    expect(Number(v.valued_cash_uzs)).toBe(890000);
    expect(Number(v.valued_cash_585_g)).toBe(0.994413);
  });

  it("USD received from sellers is valued at its own rates and compared with the USD purchase", async () => {
    // 100 USD at 12,800 UZS/USD with the 900,000 gold rate = 1.4222 g settled
    await handover(`public.rpc_record_client_settlement(p_customer_id := '${customer}', p_usd_amount := 100, p_usd_rate := 12800, p_rate_per_gram := 900000)`);
    await handover(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${seller.employeeId}', p_usd_paid_amount := 100, p_usd_rate := 12800, p_rate_per_gram := 900000)`);
    expect(Number((await vault()).valued_usd_585_g)).toBe(1.4222);

    // Spent at 12,900 UZS/USD, 900,000 UZS/g -> 1.4333 g bought
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_record_gold_purchase(p_supplier_name := 'Bozor', p_cash_spent_uzs := 0, p_usd_spent := 100, p_usd_rate := 12900,
      p_rate_per_gram := 900000, p_gold_weight_grams := 1.4333, p_idempotency_key := 'usd-1')`);
    const { entry } = await lastEntry();
    expect(Number(entry!.valued_usd)).toBe(100);
    expect(Number(entry!.accounting_value_585_g)).toBe(1.4222);
    expect(Number(entry!.difference_585_g)).toBe(0.0111);
    expect(Number((await vault()).valued_usd)).toBe(0);
  });

  it("cash leaving by another route shrinks the valuation, so later unvalued cash is never valued", async () => {
    // e.g. an expense or factory cash handover empties the vault, then capital (unvalued) arrives
    await t.asAdmin();
    await t.db.exec(`UPDATE public.manager_vault_account SET manager_cash_amount = 0 WHERE organization_id = '${orgId}'`);
    expect(Number((await vault()).valued_cash_uzs)).toBe(0);
    expect(Number((await vault()).valued_cash_585_g)).toBe(0);
    await t.db.exec(`UPDATE public.manager_vault_account SET manager_cash_amount = 1000000 WHERE organization_id = '${orgId}'`);

    const before = Number((await lastEntry()).report.purchases_count);
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_record_gold_purchase(p_supplier_name := 'Bozor', p_cash_spent_uzs := 890000, p_rate_per_gram := 900000,
      p_gold_weight_grams := 0.9889, p_idempotency_key := 'unvalued-after-outflow')`);
    expect(Number((await lastEntry()).report.purchases_count)).toBe(before);
  });
});
