import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 070: regressions found by the independent acceptance audit
// (docs/audits/goldia-final-acceptance). The concurrent-payment race (F3) needs two real sessions and
// is covered by scripts/verify-acceptance-audit-concurrency-local.sh on PostgreSQL 16.

describe("Goldia 070 — acceptance audit fixes", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgA = "00000000-0000-0000-0000-00000000a070";
  const orgB = "00000000-0000-0000-0000-00000000b070";
  let dir: { userId: string; employeeId: string };
  let mgr: { userId: string; employeeId: string };
  let sellerA: { userId: string; employeeId: string };
  let sellerC: { userId: string; employeeId: string };
  let dirB: { userId: string; employeeId: string };
  let receiptId: string;
  let custA: string, custC: string;

  const q1 = async <T,>(sql: string) => (await t.db.query<T>(sql)).rows[0]!;

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES
      ('${orgA}', 'org-a-070', 'Org A', 'ACTIVE'), ('${orgB}', 'org-b-070', 'Org B', 'ACTIVE')`);
    dir = await t.addUser(orgA, "dir070@goldia.uz", "Dir", "director");
    mgr = await t.addUser(orgA, "mgr070@goldia.uz", "Mgr", "production_manager");
    sellerA = await t.addUser(orgA, "sa070@goldia.uz", "SellerA", "sales");
    sellerC = await t.addUser(orgA, "sc070@goldia.uz", "SellerC", "sales");
    dirB = await t.addUser(orgB, "dirb070@goldia.uz", "DirB", "director");
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_set_daily_gold_rate(p_rate_per_gram := 1000000)`);
    await t.asUser(mgr.userId);
    const r = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'R', p_original_physical_g := 100,
      p_factory_markup_pct := 8, p_idempotency_key := 'r070')`);
    receiptId = String(r.receipt_id);
    await t.asAdmin();
    custA = (await q1<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${orgA}', 'A070', 'Mijoz A', '${sellerA.employeeId}') RETURNING id`)).id;
    custC = (await q1<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${orgA}', 'C070', 'Mijoz C', '${sellerC.employeeId}') RETURNING id`)).id;
  });

  const issue = async (seller: string, pieces: number[]) => {
    await t.asUser(mgr.userId);
    return t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${seller}', p_factory_markup_pct := 8,
      p_seller_markup_pct := 12, p_factory_receipt_id := '${receiptId}',
      p_pieces := '${JSON.stringify(pieces.map((w) => ({ weight_grams: w })))}'::jsonb)`);
  };

  it("F5: a factory receipt retried with the same idempotency key is recorded once", async () => {
    await t.asUser(mgr.userId);
    const again = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'R', p_original_physical_g := 100,
      p_factory_markup_pct := 8, p_idempotency_key := 'r070')`);
    expect(again.receipt_id).toBe(receiptId);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT count(*) FROM public.factory_receipts WHERE organization_id = '${orgA}')`)).toBe(1);
    expect(await t.scalar(`(SELECT total_factory_obligation_g FROM public.manager_vault_account WHERE organization_id = '${orgA}')`)).toBe(108);
    expect(await t.scalar(`(SELECT manager_physical_stock_g FROM public.manager_vault_account WHERE organization_id = '${orgA}')`)).toBe(100);
  });

  it("F4: a consignment partly consumed by a weight sale cannot be sold again as a whole", async () => {
    await issue(sellerC.employeeId, [10]);
    const second = await issue(sellerC.employeeId, [2, 3]);
    await t.asUser(sellerC.userId);
    await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${custC}', p_weight_grams := 11, p_client_markup_pct := 10)`);
    await t.expectError(`SELECT public.rpc_record_client_jewelry_sale(p_customer_id := '${custC}',
      p_consignment_id := '${second.consignment_id}', p_client_markup_pct := 10)`, "ERR_CONSIGNMENT_PARTIALLY_USED");
    await t.asAdmin();
    expect(await t.scalar(`(SELECT sum(base_weight_grams) FROM public.jewelry_sales
      WHERE seller_id = '${sellerC.employeeId}' AND status NOT IN ('reversed', 'cancelled'))`)).toBe(11);
    const fresh = await issue(sellerC.employeeId, [1]);
    await t.asUser(sellerC.userId);
    await t.expectError(`SELECT public.rpc_record_client_jewelry_sale(p_customer_id := '${custC}',
      p_consignment_id := '${fresh.consignment_id}', p_client_markup_pct := 200)`, "ERR_MARKUP_OUT_OF_RANGE");
    const ok = await t.rpc(`public.rpc_record_client_jewelry_sale(p_customer_id := '${custC}',
      p_consignment_id := '${fresh.consignment_id}', p_client_markup_pct := 12)`);
    expect(Number(ok.client_gold_due_grams)).toBe(1.12);
  });

  it("F2: reversing a sale the customer already paid turns the payment into an advance", async () => {
    await issue(sellerA.employeeId, [4, 6]);
    await t.asAdmin();
    const p4 = (await q1<{ id: string }>(`SELECT id FROM public.consignment_pieces WHERE seller_id = '${sellerA.employeeId}' AND weight_grams = 4`)).id;
    const p6 = (await q1<{ id: string }>(`SELECT id FROM public.consignment_pieces WHERE seller_id = '${sellerA.employeeId}' AND weight_grams = 6`)).id;
    await t.asUser(sellerA.userId);
    await t.rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${custA}', p_piece_id := '${p4}', p_client_markup_pct := 10)`);
    await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${custA}', p_cash_amount := 4400000)`);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_barcode_piece_sale(p_piece_id := '${p4}', p_reason := 'qaytdi')`);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${custA}')`)).toBe(0);
    expect(await t.scalar(`(SELECT advance_balance_grams FROM public.client_gold_accounts WHERE customer_id = '${custA}')`)).toBe(4.4);
    // partly paid: 6.6 due, 4.4 advance applied + 1.0 cash -> reversal leaves 5.4 g advance
    await t.asUser(sellerA.userId);
    await t.rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${custA}', p_piece_id := '${p6}', p_client_markup_pct := 10)`);
    await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${custA}', p_cash_amount := 1000000)`);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_barcode_piece_sale(p_piece_id := '${p6}', p_reason := 'qaytdi 2')`);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT advance_balance_grams FROM public.client_gold_accounts WHERE customer_id = '${custA}')`)).toBe(5.4);
    expect(await t.scalar(`(SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${custA}')`)).toBe(0);
  });

  it("F3b: USD payments are recorded on the customer account", async () => {
    await t.asUser(sellerA.userId);
    await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${custA}', p_usd_amount := 100, p_usd_rate := 12800)`);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT total_usd_paid_amount FROM public.client_gold_accounts WHERE customer_id = '${custA}')`)).toBe(100);
  });

  it("F7: a retried weight sale returns the original sale even when the stock is now used up", async () => {
    await issue(sellerA.employeeId, [2]);
    await t.asUser(sellerA.userId);
    const a = await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${custA}', p_weight_grams := 2, p_client_markup_pct := 10, p_idempotency_key := 'w070')`);
    const b = await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${custA}', p_weight_grams := 2, p_client_markup_pct := 10, p_idempotency_key := 'w070')`);
    expect(b.sale_id).toBe(a.sale_id);
  });

  it("F6 + F1b: UZS capital works without a USD rate; expenses reduce the period result", async () => {
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'b', p_usd_rate := 12800)`);
    await t.rpc(`public.rpc_record_financial_transaction(p_transaction_type := 'capital_contribution', p_source_till := 'manager_uzs',
      p_amount := 5000000, p_currency := 'UZS', p_gold_rate := 1000000)`);
    await t.expectError(`SELECT public.rpc_record_financial_transaction(p_transaction_type := 'capital_contribution',
      p_source_till := 'manager_usd', p_amount := 10, p_currency := 'USD', p_gold_rate := 1000000)`, "ERR_USD_RATE_NOT_SET");
    await t.rpc(`public.rpc_record_financial_transaction(p_transaction_type := 'business_expense', p_source_till := 'manager_uzs',
      p_amount := 500000, p_currency := 'UZS', p_gold_rate := 1000000)`);
    const p = await t.rpc(`public.rpc_get_accounting_profit_summary()`);
    expect(Number(p.period_accounting_result_585_g)).toBe(-0.5);
    expect(Number(p.operational_trading_result_585_g)).toBe(0);
  });

  it("F1: the profit summary is limited to management of the caller's own organization", async () => {
    await t.asUser(dirB.userId);
    await t.expectError(`SELECT public.rpc_get_accounting_profit_summary(p_org_id := '${orgA}')`, "boshqa tashkilot");
    await t.asAdmin();
    const ghost = (await q1<{ id: string }>(`INSERT INTO auth.users (email) VALUES ('ghost070@x.uz') RETURNING id`)).id;
    await t.asUser(ghost);
    await t.expectError(`SELECT public.rpc_get_accounting_profit_summary(p_org_id := '${orgA}')`, "Permission denied");
    await t.asUser(sellerA.userId);
    await t.expectError(`SELECT public.rpc_get_accounting_profit_summary()`, "Permission denied");
    await t.asUser(mgr.userId);
    expect((await t.rpc(`public.rpc_get_accounting_profit_summary()`)).status).toBe("ok");
  });

  it("F8: sellers cannot read company-wide balances or another seller's pieces", async () => {
    await t.asUser(sellerA.userId);
    await t.expectError(`SELECT public.rpc_get_financial_reconciliation_summary()`, "Permission denied");
    await t.expectError(`SELECT public.rpc_get_three_tier_ledger_summary()`, "Permission denied");
    await t.expectError(`SELECT public.rpc_get_seller_available_pieces('${sellerC.employeeId}')`, "Ruxsat etilmadi");
    await t.rpc(`public.rpc_get_seller_available_pieces()`);
  });

  it("F9: no cross-organization employee access; nobody changes their own organization", async () => {
    await t.asUser(dirB.userId);
    const upd = await t.db.query(`UPDATE public.employees SET is_active = false WHERE id = '${dir.employeeId}' RETURNING id`);
    expect(upd.rows.length).toBe(0);
    expect(await t.scalar(`(SELECT count(*) FROM public.employees WHERE organization_id = '${orgA}')`)).toBe(0);
    expect(await t.scalar(`(SELECT count(*) FROM public.audit_logs WHERE organization_id = '${orgA}')`)).toBe(0);
    await t.asUser(sellerA.userId);
    await t.expectError(`UPDATE public.employees SET organization_id = '${orgB}' WHERE id = '${sellerA.employeeId}'`, "organization_id cannot be changed");
    await t.asUser(dir.userId);
    const own = await t.db.query(`UPDATE public.employees SET name = 'SellerA' WHERE id = '${sellerA.employeeId}' RETURNING id`);
    expect(own.rows.length).toBe(1);
  });
});
