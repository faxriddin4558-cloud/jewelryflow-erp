import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 073 (release candidate):
//  B. the full test reset also empties the 072 seller valued till pool (else 2.0 g collected -> 2.0593 g handed over);
//  A. one business date = Asia/Tashkent calendar date (the RPC boundary run with a faked server clock is in
//     scripts/verify-073-business-date-local.sh);
//  C. weight sales name the physical piece(s).

describe("Goldia 073 — release candidate", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-00000000a073";
  let dir: { userId: string; employeeId: string };
  let mgr: { userId: string; employeeId: string };
  let seller: { userId: string; employeeId: string };
  let cust: string;
  const today = `(timezone('Asia/Tashkent', now()))::date`;

  const cycle = async (lomRate: number, cash: number) => {
    await t.asUser(mgr.userId);
    const r = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'R', p_original_physical_g := 10, p_factory_markup_pct := 8)`);
    const c = await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${seller.employeeId}', p_factory_markup_pct := 8,
      p_seller_markup_pct := 15, p_factory_receipt_id := '${r.receipt_id}', p_pieces := '[{"weight_grams":10}]'::jsonb)`);
    const pieces = c.pieces as { id: string }[];
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_set_my_seller_rates(p_lom_rate_uzs := ${lomRate})`);
    await t.rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${cust}', p_piece_id := '${pieces[0]!.id}', p_client_markup_pct := 15)`);
    const pay = await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${cust}', p_cash_amount := ${cash})`);
    const ho = await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${seller.employeeId}', p_cash_paid_amount := ${cash})`);
    return { paid: Number(pay.total_settled_grams), handedOver: Number(ho.total_settled_grams) };
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'org-073', 'Org 073', 'ACTIVE')`);
    dir = await t.addUser(org, "dir073@goldia.uz", "Dir", "director");
    mgr = await t.addUser(org, "mgr073@goldia.uz", "Mgr", "production_manager");
    seller = await t.addUser(org, "sel073@goldia.uz", "Sel", "sales");
    await t.asAdmin();
    cust = (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${org}', 'C073', 'Mijoz', '${seller.employeeId}') RETURNING id`)).rows[0]!.id;
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_set_daily_gold_rate(p_rate_per_gram := 900000, p_rate_date := ${today})`);
  });

  it("a handover after the reset closes exactly the grams collected after the reset", async () => {
    const before = await cycle(890000, 8900000); // 10 g at 890,000
    expect(before.paid).toBe(10);
    expect(before.handedOver).toBe(10);
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_execute_full_test_reset(p_confirmation_code := 'RESET_TEST_ACCOUNT_2026', p_reason := 'test 073')`);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT till_valued_cash_uzs + till_valued_cash_585_g + till_valued_usd + till_valued_usd_585_g
      FROM public.seller_gold_accounts WHERE seller_id = '${seller.employeeId}')`)).toBe(0);
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_set_daily_gold_rate(p_rate_per_gram := 900000, p_rate_date := ${today})`);
    const after = await cycle(920000, 1840000); // 2 g at 920,000
    expect(after.paid).toBe(2);
    expect(after.handedOver).toBe(2);
  });

  it("A: _goldia_business_date is the Tashkent calendar date at every boundary", async () => {
    await t.asAdmin();
    const cases: [string, string][] = [
      ["2026-11-25 18:59:00+00", "2026-11-25"], ["2026-11-25 19:00:00+00", "2026-11-26"], ["2026-11-25 19:01:00+00", "2026-11-26"],
      ["2026-11-25 23:59:00+00", "2026-11-26"], ["2026-11-26 00:00:00+00", "2026-11-26"], ["2026-11-30 19:00:00+00", "2026-12-01"],
      ["2026-12-31 18:59:00+00", "2026-12-31"], ["2026-12-31 19:00:00+00", "2027-01-01"], ["2027-01-01 00:00:00+00", "2027-01-01"],
    ];
    for (const [ts, expected] of cases) {
      const r = await t.db.query<{ d: string }>(`SELECT public._goldia_business_date('${ts}')::text AS d`);
      expect(r.rows[0]!.d, ts).toBe(expected);
    }
    // independent of the session time zone
    await t.db.exec(`SET TIME ZONE 'America/New_York'`);
    const ny = await t.db.query<{ d: string }>(`SELECT public._goldia_business_date('2026-11-25 19:00:00+00')::text AS d`);
    await t.db.exec(`SET TIME ZONE 'UTC'`);
    expect(ny.rows[0]!.d).toBe("2026-11-26");
    const defaults = await t.scalar(`(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
      AND column_default LIKE '%_goldia_business_date()%')`);
    expect(defaults).toBe(8);
  });

  it("C: chosen pieces are checked (076: choosing is optional, without it the oldest pieces are used); only the last piece may be cut", async () => {
    await t.asUser(mgr.userId);
    const r = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'P', p_original_physical_g := 20, p_factory_markup_pct := 8)`);
    const c = await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${seller.employeeId}', p_factory_markup_pct := 8,
      p_seller_markup_pct := 12, p_factory_receipt_id := '${r.receipt_id}',
      p_pieces := '[{"weight_grams":3},{"weight_grams":5},{"weight_grams":8}]'::jsonb)`);
    const [p3, p5, p8] = (c.pieces as { id: string }[]).map((p) => p.id);
    await t.asUser(seller.userId);
    const ws = (w: number, ids: string[] | null) =>
      `SELECT public.rpc_record_weight_sale(p_customer_id := '${cust}', p_weight_grams := ${w}, p_client_markup_pct := 10${
        ids ? `, p_piece_ids := ARRAY[${ids.map((i) => `'${i}'`).join(",")}]::uuid[]` : ""})`;
    await t.expectError(ws(4, [p8!, p8!]), "ERR_PIECE_DUPLICATE");
    await t.expectError(ws(4, [p3!]), "ERR_PIECES_TOO_LIGHT");
    await t.expectError(ws(4, [p5!, p3!]), "ERR_PIECE_EXTRA");
    const sale = await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${cust}', p_weight_grams := 7, p_client_markup_pct := 10,
      p_piece_ids := ARRAY['${p3}', '${p5}']::uuid[])`);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT weight_grams FROM public.consignment_pieces WHERE id = '${p5}')`)).toBe(1);
    expect(await t.scalar(`(SELECT count(*) FROM public.consignment_pieces WHERE id = '${p3}' AND status = 'sold')`)).toBe(1);
    expect(await t.scalar(`(SELECT count(*) FROM public.weight_sale_allocations WHERE sale_id = '${sale.sale_id}')`)).toBe(2);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_client_sale(p_sale_id := '${sale.sale_id}', p_reason := 'qaytdi')`);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT weight_grams FROM public.consignment_pieces WHERE id = '${p5}')`)).toBe(5);
    expect(await t.scalar(`(SELECT count(*) FROM public.consignment_pieces WHERE id = '${p3}' AND status = 'held_by_seller')`)).toBe(1);
    expect(await t.scalar(`(SELECT weight_grams FROM public.consignment_pieces WHERE id = '${p8}')`)).toBe(8);
    // 076: no piece chosen -> 4 g taken from the held pieces automatically (whole pieces sold, only the last one cut)
    await t.asUser(seller.userId);
    const auto = await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${cust}', p_weight_grams := 4, p_client_markup_pct := 10)`);
    expect(Number(auto.client_gold_due_grams)).toBe(4.4);
    await t.asAdmin();
    const held = `(SELECT coalesce(sum(weight_grams), 0) FROM public.consignment_pieces WHERE id IN ('${p3}', '${p5}', '${p8}') AND status = 'held_by_seller')`;
    expect(await t.scalar(held)).toBe(12);
    expect(await t.scalar(`(SELECT coalesce(sum(grams), 0) FROM public.weight_sale_allocations WHERE sale_id = '${auto.sale_id}')`)).toBe(4);
    expect(await t.scalar(`(SELECT count(*) FROM public.weight_sale_allocations WHERE sale_id = '${auto.sale_id}' AND NOT fully_consumed)`)).toBeLessThanOrEqual(1);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_client_sale(p_sale_id := '${auto.sale_id}', p_reason := 'qaytdi')`);
    await t.asAdmin();
    expect(await t.scalar(held)).toBe(16);
    expect(await t.scalar(`(SELECT count(*) FROM public.consignment_pieces WHERE (id = '${p3}' AND weight_grams = 3) OR (id = '${p5}' AND weight_grams = 5) OR (id = '${p8}' AND weight_grams = 8))`)).toBe(3);
  });
});
