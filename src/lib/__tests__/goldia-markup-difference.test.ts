import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb, type Json } from "./helpers/goldia-pglite";

// Migration 067: signed seller markup difference ("Ustama farqi"). All calls run as the
// `authenticated` role with RLS on. Letters refer to the required regression cases.

describe("Goldia 067 — seller markup difference", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgId = "00000000-0000-0000-0000-0000000000d7";
  let director: { userId: string; employeeId: string };
  let sellerA: { userId: string; employeeId: string };
  let sellerB: { userId: string; employeeId: string };
  let sellerC: { userId: string; employeeId: string };
  const customers: Record<string, string> = {};
  const sales: Record<string, string> = {};

  const customer = async (code: string, sellerId: string) =>
    (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${orgId}', '${code}', 'Mijoz ${code}', '+998900000${code.length}', '${sellerId}') RETURNING id`)).rows[0]!.id;

  // Issues one piece per weight and returns the piece ids (manager action)
  const consign = async (sellerId: string, weights: number[], sellerPct: number, model = "M67") => {
    await t.asUser(director.userId);
    const pieces = JSON.stringify(weights.map((w) => ({ weight_grams: w, model_code: model, purity: 585 })));
    const res = await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${sellerId}', p_factory_markup_pct := 8,
      p_pieces := '${pieces}'::jsonb, p_notes := '067', p_seller_markup_pct := ${sellerPct})`);
    await t.asAdmin();
    return (await t.db.query<{ id: string }>(`SELECT id FROM public.consignment_pieces WHERE consignment_id = '${res.consignment_id}' ORDER BY weight_grams`)).rows.map((r) => r.id);
  };
  const sellPiece = async (seller: { userId: string }, customerId: string, pieceId: string, pct: number, key?: string) => {
    await t.asUser(seller.userId);
    return t.rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${customerId}', p_piece_id := '${pieceId}',
      p_client_markup_pct := ${pct}${key ? `, p_idempotency_key := '${key}'` : ""})`);
  };
  const report = async (user: { userId: string }, sellerId?: string) => {
    await t.asUser(user.userId);
    return t.rpc(`public.rpc_get_seller_markup_difference_report(${sellerId ? `p_seller_id := '${sellerId}'` : ""})`);
  };
  const balances = async () => {
    await t.asAdmin();
    return (await t.db.query<{ v: string }>(`SELECT
      (SELECT string_agg(seller_id || ':' || seller_owes_manager_g || ':' || current_physical_stock_g || ':' || total_seller_obligation_g, ',' ORDER BY seller_id) FROM public.seller_gold_accounts) || '|' ||
      (SELECT string_agg(customer_id || ':' || current_debt_grams || ':' || advance_balance_grams, ',' ORDER BY customer_id) FROM public.client_gold_accounts) AS v`)).rows[0]!.v;
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${orgId}', 'goldia-067', 'Goldia 067', 'ACTIVE')`);
    director = await t.addUser(orgId, "dir067@goldia.uz", "Alisher", "director");
    sellerA = await t.addUser(orgId, "a067@goldia.uz", "Jamshid", "sales");
    sellerB = await t.addUser(orgId, "b067@goldia.uz", "Dilshod", "sales");
    sellerC = await t.addUser(orgId, "c067@goldia.uz", "Jasur", "sales");
    await t.asAdmin();
    customers.A = await customer("A67", sellerA.employeeId);
    customers.B = await customer("B67", sellerB.employeeId);
    customers.C = await customer("C67", sellerC.employeeId);
    await t.db.exec(`INSERT INTO public.factory_receipts (organization_id, receipt_no, product_name, original_physical_g,
      available_physical_g, proba, factory_markup_pct, factory_obligation_g, status)
      VALUES ('${orgId}', 'ZVD-067', 'Partiya 067', 2000, 2000, 585, 8, 2160, 'in_manager_stock')`);
  });

  it("A: 100 g, assigned 15 %, sold at 12 % -> -3 g; obligations unchanged", async () => {
    const [p] = await consign(sellerA.employeeId, [100], 15);
    const sale = await sellPiece(sellerA, customers.A!, p!, 12);
    sales.A = String(sale.sale_id);
    expect(Number(sale.client_gold_due_grams)).toBe(112); // customer owes 112 g
    await t.asAdmin();
    const row = (await t.db.query<{ assigned_seller_markup_pct: string; markup_difference_g: string; markup_snapshot_source: string }>(
      `SELECT assigned_seller_markup_pct, markup_difference_g, markup_snapshot_source FROM public.jewelry_sales WHERE id = '${sales.A}'`)).rows[0]!;
    expect(Number(row.assigned_seller_markup_pct)).toBe(15);
    expect(Number(row.markup_difference_g)).toBe(-3);
    expect(row.markup_snapshot_source).toBe("sale_time");
    expect(await t.scalar(`(SELECT total_seller_obligation_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerA.employeeId}')`)).toBe(115);
  });

  it("B + C: 100 g at 15 % sold at 20 % -> +5 g; cumulative signed balance +2 g (grams, not percentages)", async () => {
    const [p] = await consign(sellerA.employeeId, [100], 15);
    const sale = await sellPiece(sellerA, customers.A!, p!, 20);
    sales.B = String(sale.sale_id);
    const r = await report(sellerA);
    expect(Number(r.total_difference_g)).toBe(2);
    expect(Number(r.positive_g)).toBe(5);
    expect(Number(r.negative_g)).toBe(-3);
    expect(Number(r.active_sales)).toBe(2);
  });

  it("D: different original weights use their own base", async () => {
    const [p1] = await consign(sellerA.employeeId, [7.5], 10);
    await sellPiece(sellerA, customers.A!, p1!, 18); // 7.5 * 8 % = +0.6
    const [p2] = await consign(sellerA.employeeId, [12.25], 25);
    await sellPiece(sellerA, customers.A!, p2!, 30); // 12.25 * 5 % = +0.6125
    expect(Number((await report(sellerA)).total_difference_g)).toBe(3.2125);
  });

  it("E + J: sellers are separated; a seller cannot read another seller's differences", async () => {
    const [p] = await consign(sellerB.employeeId, [50], 12);
    await sellPiece(sellerB, customers.B!, p!, 10); // -1
    const own = await report(sellerB);
    expect(Number(own.total_difference_g)).toBe(-1);
    expect((own.entries as Json[]).every((e) => e.seller_id === sellerB.employeeId)).toBe(true);
    expect((own.by_seller as Json[]).length).toBe(0);
    await t.asUser(sellerB.userId);
    await t.expectError(`SELECT public.rpc_get_seller_markup_difference_report(p_seller_id := '${sellerA.employeeId}')`, "o'z ustama farqini");

    const all = await report(director);
    expect(Number(all.total_difference_g)).toBe(2.2125);
    const bySeller = Object.fromEntries((all.by_seller as Json[]).map((s) => [s.seller_id, Number(s.total_difference_g)]));
    expect(bySeller[sellerA.employeeId]).toBe(3.2125);
    expect(bySeller[sellerB.employeeId]).toBe(-1);
    expect(Number((await report(director, sellerA.employeeId)).total_difference_g)).toBe(3.2125);
  });

  it("F: reversing a sale removes its difference exactly once and keeps it visible as reversed", async () => {
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_reverse_client_sale('${sales.A}', 'mijoz qaytardi', null)`);
    let r = await report(sellerA);
    expect(Number(r.total_difference_g)).toBe(6.2125);
    expect(Number(r.reversed_sales)).toBe(1);
    const entry = (r.entries as Json[]).find((e) => e.sale_id === sales.A)!;
    expect(entry.reversed).toBe(true);
    expect(Number(entry.markup_difference_g)).toBe(-3); // historical snapshot preserved
    await t.asUser(director.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_sale('${sales.A}', 'yana', null)`, "allaqachon bekor");
    r = await report(sellerA);
    expect(Number(r.total_difference_g)).toBe(6.2125);
  });

  it("G: partial weight sale and return of the unsold remainder", async () => {
    await consign(sellerC.employeeId, [40], 15);
    await t.asUser(sellerC.userId);
    const ws = await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${customers.C}', p_weight_grams := 10, p_client_markup_pct := 25)`);
    expect(Number((await report(sellerC)).total_difference_g)).toBe(1); // 10 g * 10 %
    await t.asAdmin();
    const rest = (await t.db.query<{ id: string; weight_grams: string }>(`SELECT id, weight_grams FROM public.consignment_pieces
      WHERE seller_id = '${sellerC.employeeId}' AND status = 'held_by_seller'`)).rows[0]!;
    expect(Number(rest.weight_grams)).toBe(30);
    await t.asUser(sellerC.userId);
    await t.rpc(`public.rpc_return_piece_to_manager('${rest.id}', 'sotilmagan qism', null)`);
    expect(Number((await report(sellerC)).total_difference_g)).toBe(1); // return does not touch the difference
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_reverse_client_sale('${ws.sale_id}', 'bekor', null)`);
    expect(Number((await report(sellerC)).total_difference_g)).toBe(0);
  });

  it("H: a repeated submission does not duplicate the variance", async () => {
    const [p] = await consign(sellerB.employeeId, [20], 12);
    const s1 = await sellPiece(sellerB, customers.B!, p!, 14, "retry-067");
    const s2 = await sellPiece(sellerB, customers.B!, p!, 14, "retry-067");
    expect(s2.sale_id).toBe(s1.sale_id);
    expect(Number((await report(sellerB)).total_difference_g)).toBe(-0.6); // -1 + 20 g * 2 %
  });

  it("I + L: reports never change debts, seller obligations, stock or profit; existing reports still work", async () => {
    const before = await balances();
    await t.asUser(director.userId);
    const profitBefore = await t.rpc(`public.rpc_get_accounting_profit_summary()`);
    await report(director);
    await report(sellerA);
    await t.asUser(director.userId);
    const profitAfter = await t.rpc(`public.rpc_get_accounting_profit_summary()`);
    expect(await balances()).toBe(before);
    expect(profitAfter.current_net_assets_585_g ?? profitAfter.status).toEqual(profitBefore.current_net_assets_585_g ?? profitBefore.status);

    // Customer debt stays the plain sales ledger: due at the ACTUAL customer markup, nothing extra
    await t.asAdmin();
    const debtA = await t.scalar(`(SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${customers.A}')`);
    const dueA = await t.scalar(`(SELECT sum(client_gold_due_grams) FROM public.jewelry_sales WHERE customer_id = '${customers.A}' AND status NOT IN ('reversed','cancelled'))`);
    expect(debtA).toBe(dueA);

    await t.asUser(director.userId);
    const ledger = await t.db.query(`SELECT * FROM public.rpc_get_daily_sales_ledger(p_seller_id := null, p_start_date := CURRENT_DATE - 1, p_end_date := CURRENT_DATE)`);
    expect(ledger.rows.length).toBeGreaterThan(0);
  });

  it("historical backfill reconstructs only provable markups and never changes balances", async () => {
    // Make two sales look historical (no snapshot); break the obligation proof of the second one.
    const [ok] = await consign(sellerC.employeeId, [10], 15, "HIST1");
    const sOk = await sellPiece(sellerC, customers.C!, ok!, 18);
    const [bad] = await consign(sellerC.employeeId, [10], 15, "HIST2");
    const sBad = await sellPiece(sellerC, customers.C!, bad!, 18);
    await t.asAdmin();
    await t.db.exec(`
      UPDATE public.jewelry_sales SET assigned_seller_markup_pct = NULL, markup_difference_g = NULL, markup_snapshot_source = NULL
       WHERE id IN ('${sOk.sale_id}', '${sBad.sale_id}');
      UPDATE public.seller_consignments SET original_seller_obligation_g = original_seller_obligation_g + 1
       WHERE id = (SELECT consignment_id FROM public.jewelry_sales WHERE id = '${sBad.sale_id}');`);
    const before = await balances();
    await t.db.exec(`
      ALTER TABLE public.jewelry_sales DISABLE TRIGGER trg_sync_seller_gold_account_sales;
      SELECT public._goldia_backfill_markup_difference();
      ALTER TABLE public.jewelry_sales ENABLE TRIGGER trg_sync_seller_gold_account_sales;`);
    const rows = (await t.db.query<{ id: string; markup_difference_g: string | null; markup_snapshot_source: string | null }>(
      `SELECT id, markup_difference_g, markup_snapshot_source FROM public.jewelry_sales WHERE id IN ('${sOk.sale_id}', '${sBad.sale_id}')`)).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(Number(byId[String(sOk.sale_id)]!.markup_difference_g)).toBe(0.3);
    expect(byId[String(sOk.sale_id)]!.markup_snapshot_source).toBe("reconstructed");
    expect(byId[String(sBad.sale_id)]!.markup_difference_g).toBeNull();
    expect(await balances()).toBe(before);
    expect(Number((await report(sellerC)).unknown_sales)).toBe(1);

    // Clients cannot run the backfill
    await t.asUser(director.userId);
    await t.expectError(`SELECT public._goldia_backfill_markup_difference()`, "permission denied");
  });
});
