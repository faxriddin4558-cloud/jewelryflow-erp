import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 068: a weight sale consumes every piece it sells; reversals restore exactly; the A-G
// statement follows the authoritative stock; evidence-based repair of old records; factory counters.
// Calls run as the `authenticated` role with RLS on.

describe("Goldia 068 — weight sales across multiple pieces", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgId = "00000000-0000-0000-0000-0000000000e8";
  let director: { userId: string; employeeId: string };

  const newSeller = async (tag: string) => {
    const s = await t.addUser(orgId, `${tag}@goldia.uz`, tag, "sales");
    const c = (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${orgId}', 'C-${tag}', 'Mijoz', '+998900000000', '${s.employeeId}') RETURNING id`)).rows[0]!.id;
    return { ...s, customer: c };
  };
  const consign3x100 = async (sellerId: string) => {
    await t.asUser(director.userId);
    const r = await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${sellerId}', p_factory_markup_pct := 8,
      p_pieces := '[{"weight_grams":100,"model_code":"W"},{"weight_grams":100,"model_code":"W"},{"weight_grams":100,"model_code":"W"}]'::jsonb,
      p_notes := '3x100', p_seller_markup_pct := 15)`);
    return String(r.consignment_id);
  };
  const weightSale = async (s: { userId: string; customer: string }, grams: number, key?: string) => {
    await t.asUser(s.userId);
    return t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${s.customer}', p_weight_grams := ${grams}, p_client_markup_pct := 15${key ? `, p_idempotency_key := '${key}'` : ""})`);
  };
  const shelf = async (sellerId: string) => {
    await t.asAdmin();
    const rows = (await t.db.query<{ status: string; weight_grams: string }>(
      `SELECT status, weight_grams FROM public.consignment_pieces WHERE seller_id = '${sellerId}' ORDER BY status, weight_grams`)).rows;
    const held = rows.filter((r) => r.status === "held_by_seller").map((r) => Number(r.weight_grams));
    return { held, heldTotal: held.reduce((a, b) => a + b, 0), sold: rows.filter((r) => r.status === "sold").length };
  };
  const stock = async (sellerId: string) => {
    await t.asAdmin();
    return t.scalar(`(SELECT current_physical_stock_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerId}')`);
  };
  const sectionB = async (sellerId: string) => {
    await t.asUser(director.userId);
    const r = await t.rpc(`public.rpc_get_seller_reconciliation_statement('${sellerId}')`);
    return r.section_b as Record<string, unknown>;
  };
  const balances = async () => {
    await t.asAdmin();
    return (await t.db.query<{ v: string }>(`SELECT
      (SELECT string_agg(seller_id || ':' || seller_owes_manager_g || ':' || current_physical_stock_g, ',' ORDER BY seller_id) FROM public.seller_gold_accounts) || '|' ||
      (SELECT string_agg(customer_id || ':' || current_debt_grams, ',' ORDER BY customer_id) FROM public.client_gold_accounts) || '|' ||
      (SELECT count(*) || ':' || sum(base_weight_grams) FROM public.jewelry_sales WHERE status NOT IN ('reversed','cancelled')) AS v`)).rows[0]!.v;
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${orgId}', 'goldia-068', 'Goldia 068', 'ACTIVE')`);
    director = await t.addUser(orgId, "dir068@goldia.uz", "Alisher", "director");
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.factory_receipts (organization_id, receipt_no, product_name, original_physical_g,
      available_physical_g, proba, factory_markup_pct, factory_obligation_g, status)
      VALUES ('${orgId}', 'ZVD-068', 'Partiya 068', 3000, 3000, 585, 8, 3240, 'in_manager_stock')`);
  });

  it("200 g from 3 x 100 g: two pieces sold, one held; shelf = stock = A-G section B = 100 g", async () => {
    const s = await newSeller("w1");
    await consign3x100(s.employeeId);
    const sale = await weightSale(s, 200);
    expect(sale.status).toBe("ok");
    const sh = await shelf(s.employeeId);
    expect(sh.held).toEqual([100]);
    expect(sh.sold).toBe(2);
    expect(await stock(s.employeeId)).toBe(100);
    const b = await sectionB(s.employeeId);
    expect(Number(b.original_grams)).toBe(100);
    expect(Number(b.pieces_vs_stock_difference_grams)).toBe(0);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT count(*) FROM public.weight_sale_allocations WHERE sale_id = '${sale.sale_id}')`)).toBe(2);
    // 067 snapshot still applies to the weight sale: assigned 15 %, sold 15 % -> 0 g
    expect(await t.scalar(`(SELECT markup_difference_g FROM public.jewelry_sales WHERE id = '${sale.sale_id}')`)).toBe(0);
  });

  it("partial sale of 150 g, reversal restores 3 x 100 g exactly once", async () => {
    const s = await newSeller("w2");
    await consign3x100(s.employeeId);
    const sale = await weightSale(s, 150);
    let sh = await shelf(s.employeeId);
    expect(sh.held).toEqual([50, 100]);
    expect(sh.sold).toBe(1);
    expect(await stock(s.employeeId)).toBe(150);

    await t.asUser(director.userId);
    await t.rpc(`public.rpc_reverse_client_sale('${sale.sale_id}', 'bekor', null)`);
    sh = await shelf(s.employeeId);
    expect(sh.held).toEqual([100, 100, 100]);
    expect(sh.sold).toBe(0);
    expect(await stock(s.employeeId)).toBe(300);
    await t.asUser(director.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_sale('${sale.sale_id}', 'yana', null)`, "allaqachon bekor");
    expect((await shelf(s.employeeId)).held).toEqual([100, 100, 100]);
  });

  it("return of the partially sold piece, then reversal: weight comes back without double counting", async () => {
    const s = await newSeller("w3");
    await consign3x100(s.employeeId);
    const sale = await weightSale(s, 150); // one 100 g sold, one reduced to 50 g
    await t.asAdmin();
    const p50 = (await t.db.query<{ id: string }>(`SELECT id FROM public.consignment_pieces WHERE seller_id = '${s.employeeId}' AND weight_grams = 50`)).rows[0]!.id;
    await t.asUser(s.userId);
    await t.rpc(`public.rpc_return_piece_to_manager('${p50}', 'qaytarildi', null)`);
    expect(await stock(s.employeeId)).toBe(100);
    expect((await shelf(s.employeeId)).heldTotal).toBe(100);

    await t.asUser(director.userId);
    await t.rpc(`public.rpc_reverse_client_sale('${sale.sale_id}', 'bekor', null)`);
    expect(await stock(s.employeeId)).toBe(250); // 300 consigned - 50 returned
    expect((await shelf(s.employeeId)).heldTotal).toBe(250);
  });

  it("a retried weight sale is not applied twice", async () => {
    const s = await newSeller("w4");
    await consign3x100(s.employeeId);
    const a = await weightSale(s, 120, "ws-retry-068");
    const b = await weightSale(s, 120, "ws-retry-068");
    expect(b.sale_id).toBe(a.sale_id);
    const sh = await shelf(s.employeeId);
    expect(sh.heldTotal).toBe(180);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT count(*) FROM public.weight_sale_allocations WHERE sale_id = '${a.sale_id}')`)).toBe(2);
  });

  it("repair fixes records left by the old code without changing any balance, and is idempotent", async () => {
    const s = await newSeller("w5");
    await consign3x100(s.employeeId);
    const sale = await weightSale(s, 200);
    // Recreate the pre-068 state: only one piece linked to the 200 g sale, the second one still held, no allocations.
    await t.asAdmin();
    await t.db.exec(`
      DELETE FROM public.weight_sale_allocations WHERE sale_id = '${sale.sale_id}';
      UPDATE public.consignment_pieces SET status = 'held_by_seller', sale_id = NULL, sold_at = NULL
       WHERE id = (SELECT id FROM public.consignment_pieces WHERE sale_id = '${sale.sale_id}' ORDER BY created_at DESC, id DESC LIMIT 1);`);
    expect((await shelf(s.employeeId)).heldTotal).toBe(200); // the audited production symptom
    expect(Number((await sectionB(s.employeeId)).original_grams)).toBe(100); // A-G already follows real stock

    const before = await balances();
    await t.asAdmin();
    const rep = (await t.db.query<{ r: unknown }>(`SELECT public._goldia_repair_weight_sale_pieces() AS r`)).rows[0]!.r;
    const report = (typeof rep === "string" ? JSON.parse(rep) : rep) as Record<string, unknown>[];
    expect(report.length).toBe(1);
    expect(Number(report[0]!.consumed_g)).toBe(100);
    const sh = await shelf(s.employeeId);
    expect(sh.held).toEqual([100]);
    expect(sh.sold).toBe(2);
    expect(await balances()).toBe(before);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT count(*) FROM public.audit_logs WHERE action = 'REPAIR_WEIGHT_SALE_PIECES' AND record_id = '${sale.sale_id}')`)).toBe(1);

    const again = (await t.db.query<{ r: unknown }>(`SELECT public._goldia_repair_weight_sale_pieces() AS r`)).rows[0]!.r;
    expect((typeof again === "string" ? JSON.parse(again) : again) as unknown[]).toEqual([]);

    // The repaired sale reverses exactly: all three pieces back on the shelf
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_reverse_client_sale('${sale.sale_id}', 'bekor', null)`);
    expect((await shelf(s.employeeId)).held).toEqual([100, 100, 100]);
  });

  it("stale factory counters are rebuilt from active receipts; correct counters are left alone", async () => {
    await t.asAdmin();
    await t.db.exec(`SELECT public._get_or_create_manager_vault('${orgId}');
      UPDATE public.manager_vault_account SET total_factory_received_g = 3010, total_factory_obligation_g = 3250.8,
        current_factory_obligation_g = 3250.8 WHERE organization_id = '${orgId}';`);
    const rep = (await t.db.query<{ r: unknown }>(`SELECT public._goldia_repair_factory_counters() AS r`)).rows[0]!.r;
    const report = (typeof rep === "string" ? JSON.parse(rep) : rep) as Record<string, Record<string, unknown>>[];
    const mine = report.find((x) => String(x.organization_id) === orgId)!;
    expect(Number(mine.before!.obligation_g)).toBe(3250.8);
    expect(Number(mine.after!.obligation_g)).toBe(3240);
    expect(Number(mine.after!.current_obligation_g)).toBe(3240);
    const again = (await t.db.query<{ r: unknown }>(`SELECT public._goldia_repair_factory_counters() AS r`)).rows[0]!.r;
    expect(((typeof again === "string" ? JSON.parse(again) : again) as Record<string, unknown>[]).some((x) => String(x.organization_id) === orgId)).toBe(false);

    await t.asUser(director.userId);
    await t.expectError(`SELECT public._goldia_repair_factory_counters()`, "permission denied");
  });
});
