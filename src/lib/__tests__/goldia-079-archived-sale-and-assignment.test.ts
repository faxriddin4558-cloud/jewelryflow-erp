import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 079: D-A1 a new sale to an archived customer is refused on the server (every sale path), old debt stays
// collectible; D-A2 a seller cannot assign / move customers by changing seller_id; director = manager can.
describe("Goldia 079 — no new sale to an archived customer, sellers cannot reassign customers", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-00000000a079";
  let dir: { userId: string; employeeId: string };
  let mgr: { userId: string; employeeId: string };
  let seller: { userId: string; employeeId: string };
  let seller2: { userId: string; employeeId: string };
  let cust: string;
  let free: string;
  let free2: string;
  const today = `(timezone('Asia/Tashkent', now()))::date`;
  const n = async (sql: string) => { await t.asAdmin(); return Number(await t.scalar(sql)); };
  const stock = async () => n(`(SELECT current_physical_stock_g FROM public.seller_gold_accounts WHERE seller_id = '${seller.employeeId}')`);
  const sales = async (c: string) => n(`(SELECT count(*) FROM public.jewelry_sales WHERE customer_id = '${c}')`);
  const debt = async (c: string) => n(`(SELECT coalesce(current_debt_grams, 0) FROM public.client_gold_accounts WHERE customer_id = '${c}')`);
  const usd = async (c: string) => n(`(SELECT coalesce(sum(debt_amount), 0) FROM public.client_currency_accounts WHERE customer_id = '${c}' AND currency = 'USD')`);
  const owner = async (c: string) => { await t.asAdmin(); return (await t.db.query<{ s: string | null }>(`SELECT seller_id s FROM public.customers WHERE id = '${c}'`)).rows[0]!.s; };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'org-079', 'Org 079', 'ACTIVE')`);
    dir = await t.addUser(org, "dir079@goldia.uz", "Dir", "director");
    mgr = await t.addUser(org, "mgr079@goldia.uz", "Mgr", "production_manager");
    seller = await t.addUser(org, "sel079@goldia.uz", "Sel", "sales");
    seller2 = await t.addUser(org, "sel079b@goldia.uz", "Sel2", "sales");
    await t.asAdmin();
    const ins = async (code: string, s: string | null) => (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${org}', '${code}', '${code}', ${s ? `'${s}'` : "null"}) RETURNING id`)).rows[0]!.id;
    cust = await ins("C079", seller.employeeId);
    free = await ins("C079-FREE", null);
    free2 = await ins("C079-FREE2", null);
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_set_daily_gold_rate(p_rate_per_gram := 900000, p_rate_date := ${today})`);
    await t.asUser(mgr.userId);
    const r = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'R', p_original_physical_g := 60, p_factory_markup_pct := 8)`);
    await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${seller.employeeId}', p_factory_markup_pct := 8, p_seller_markup_pct := 10,
      p_factory_receipt_id := '${r.receipt_id}', p_pieces := '[{"weight_grams":10},{"weight_grams":10},{"weight_grams":10},{"weight_grams":10},{"weight_grams":10}]'::jsonb)`);
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_set_my_seller_rates(p_lom_rate_uzs := 900000, p_usd_rate_uzs := 12500)`);
    // open debts before archiving: 5 g gram sale + $500 currency sale
    await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${cust}', p_weight_grams := 5, p_client_markup_pct := 10, p_idempotency_key := 'a79-w1')`);
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_record_currency_sale(p_customer_id := '${cust}', p_currency := 'USD', p_amount := 500, p_weight_grams := 2, p_idempotency_key := 'a79-c1')`);
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_archive_customer(p_customer_id := '${cust}', p_archive := true)`);
  });

  it("D-A1: every sale path refuses an archived customer; no stock, sale or debt changes", async () => {
    const s0 = await stock(); const c0 = await sales(cust); const d0 = await debt(cust); const u0 = await usd(cust);
    expect(c0).toBe(2);
    await t.asAdmin();
    const piece = (await t.db.query<{ id: string }>(`SELECT id FROM public.consignment_pieces WHERE seller_id = '${seller.employeeId}' AND status = 'held_by_seller' ORDER BY id LIMIT 1`)).rows[0]!.id;
    const calls = [
      `SELECT public.rpc_record_weight_sale(p_customer_id := '${cust}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := 'a79-x1')`,
      `SELECT public.rpc_record_currency_sale(p_customer_id := '${cust}', p_currency := 'UZS', p_amount := 1000000, p_weight_grams := 1, p_idempotency_key := 'a79-x2')`,
      `SELECT public.rpc_record_barcode_piece_sale(p_customer_id := '${cust}', p_piece_id := '${piece}', p_client_markup_pct := 10, p_idempotency_key := 'a79-x3')`,
    ];
    for (const sql of calls) {
      await t.asUser(seller.userId);
      await t.expectError(sql, "ERR_CUSTOMER_ARCHIVED");
    }
    // management is refused too (the rule is about the customer, not the role)
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_record_weight_sale(p_customer_id := '${cust}', p_seller_id := '${seller.employeeId}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := 'a79-x4')`, "ERR_CUSTOMER_ARCHIVED");
    // a direct insert is refused as well
    await t.asAdmin();
    await t.expectError(`INSERT INTO public.jewelry_sales (organization_id, customer_id, seller_id, sale_no) VALUES ('${org}', '${cust}', '${seller.employeeId}', 'X79')`, "ERR_CUSTOMER_ARCHIVED");
    expect(await stock()).toBe(s0);
    expect(await sales(cust)).toBe(c0);
    expect(await debt(cust)).toBe(d0);
    expect(await usd(cust)).toBe(u0);
  });

  it("D-A1: the archived customer's old debt is still collectible (gram and USD payments) and payments can be reversed", async () => {
    const d0 = await debt(cust);
    expect(d0).toBeGreaterThan(5);
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${cust}', p_cash_amount := 900000, p_rate_per_gram := 900000)`);
    expect(await debt(cust)).toBeCloseTo(d0 - 1, 4);
    await t.asUser(seller.userId);
    const p = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cust}', p_currency := 'USD', p_usd_amount := 200, p_idempotency_key := 'a79-p1')`);
    expect(await usd(cust)).toBe(300);
    await t.asAdmin();
    const sid = (await t.db.query<{ id: string }>(`SELECT id FROM public.client_currency_settlements WHERE customer_id = '${cust}' AND idempotency_key = 'a79-p1'`)).rows[0]!.id;
    expect(p).toBeTruthy();
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_client_currency_settlement(p_settlement_id := '${sid}', p_reason := 'test')`);
    expect(await usd(cust)).toBe(500);
  });

  it("D-A1: after restoring, sales work again", async () => {
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_archive_customer(p_customer_id := '${cust}', p_archive := false)`);
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${cust}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := 'a79-w2')`);
    expect(await sales(cust)).toBe(3);
  });

  it("D-A2: a seller cannot assign an unassigned customer to himself nor move his own customer (direct write)", async () => {
    await t.asUser(seller.userId);
    await t.expectError(`UPDATE public.customers SET seller_id = '${seller.employeeId}' WHERE id = '${free}'`, "faqat direktor yoki menejer");
    await t.asUser(seller.userId);
    await t.expectError(`UPDATE public.customers SET seller_id = '${seller2.employeeId}' WHERE id = '${cust}'`, "faqat direktor yoki menejer");
    await t.asUser(seller.userId);
    await t.expectError(`UPDATE public.customers SET seller_id = null WHERE id = '${cust}'`, "faqat direktor yoki menejer");
    expect(await owner(free)).toBeNull();
    expect(await owner(cust)).toBe(seller.employeeId);
    // other columns of his own customer still editable (name), seller_id untouched
    await t.asUser(seller.userId);
    const ok = await t.db.query(`UPDATE public.customers SET contact_name = 'C079 yangi' WHERE id = '${cust}' RETURNING id`);
    expect(ok.rows.length).toBe(1);
  });

  it("D-A2: selling to an unassigned customer still works and does not assign it", async () => {
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${free}', p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := 'a79-w3')`);
    expect(await owner(free)).toBeNull();
  });

  it("D-A2: director and manager (equal rights) assign and move customers", async () => {
    await t.asUser(mgr.userId);
    expect((await t.db.query(`UPDATE public.customers SET seller_id = '${seller2.employeeId}' WHERE id = '${free2}' RETURNING id`)).rows.length).toBe(1);
    expect(await owner(free2)).toBe(seller2.employeeId);
    await t.asUser(dir.userId);
    expect((await t.db.query(`UPDATE public.customers SET seller_id = '${seller.employeeId}' WHERE id = '${free2}' RETURNING id`)).rows.length).toBe(1);
    expect(await owner(free2)).toBe(seller.employeeId);
  });
});
