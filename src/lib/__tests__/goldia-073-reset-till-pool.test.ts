import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 073: the full test reset must also empty the 072 seller valued till pool, otherwise the first
// handover after the reset closes the seller obligation at a stale pre-reset average.

describe("Goldia 073 — reset clears the seller valued till pool", () => {
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
});
