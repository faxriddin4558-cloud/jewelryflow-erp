import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 081: a seller may enter a legacy ADVANCE ("biz mijozga qarzdormiz") for his own customer - as an addition
// only, only without open 585 debt; no cash / stock / vault / obligation movement; reconciliation of an advance and
// reversals stay with the manager / director.
describe("Goldia 081 — seller legacy advance", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-00000000a081";
  const org2 = "00000000-0000-0000-0000-00000000b081";
  let dir: { userId: string; employeeId: string };
  let mgr: { userId: string; employeeId: string };
  let seller: { userId: string; employeeId: string };
  let seller2: { userId: string; employeeId: string };
  let sellerX: { userId: string; employeeId: string };
  let own: string; let ownDebt: string; let other: string; let foreign: string;
  const today = `(timezone('Asia/Tashkent', now()))::date`;
  const adv = (c: string, g: number, extra = "") => `SELECT public.rpc_record_client_legacy_debt(p_customer_id := '${c}', p_balance_type := 'advance',
      p_amount_585_g := ${g}, p_as_of_date := ${today}, p_entry_type := 'manual_addition'${extra})`;
  const acc = async (c: string) => {
    await t.asAdmin();
    const r = await t.db.query<{ d: string; a: string }>(`SELECT coalesce(current_debt_grams, 0) d, coalesce(advance_balance_grams, 0) a FROM public.client_gold_accounts WHERE customer_id = '${c}'`);
    return r.rows[0] ? { d: Number(r.rows[0].d), a: Number(r.rows[0].a) } : { d: 0, a: 0 };
  };
  // everything an advance must NOT move: seller stock / tills / obligation, manager vault
  const money = async () => {
    await t.asAdmin();
    const s = (await t.db.query<Record<string, string>>(`SELECT current_physical_stock_g st, total_seller_obligation_g o, seller_legacy_debt_obligation_g l,
      seller_till_cash_amount c, seller_till_usd_amount u, seller_till_scrap_grams sc FROM public.seller_gold_accounts WHERE seller_id = '${seller.employeeId}'`)).rows[0];
    const v = (await t.db.query<Record<string, string>>(`SELECT manager_cash_amount c, manager_usd_amount u, manager_physical_stock_g st FROM public.manager_vault_account WHERE organization_id = '${org}'`)).rows[0];
    return JSON.stringify({ s, v });
  };
  const rows = async (c: string) => { await t.asAdmin(); return Number(await t.scalar(`(SELECT count(*) FROM public.client_legacy_debts WHERE customer_id = '${c}')`)); };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'org-081', 'Org 081', 'ACTIVE'), ('${org2}', 'org-081b', 'Org 081b', 'ACTIVE')`);
    dir = await t.addUser(org, "dir081@goldia.uz", "Dir", "director");
    mgr = await t.addUser(org, "mgr081@goldia.uz", "Mgr", "production_manager");
    seller = await t.addUser(org, "sel081@goldia.uz", "Sel", "sales");
    seller2 = await t.addUser(org, "sel081b@goldia.uz", "Sel2", "sales");
    sellerX = await t.addUser(org2, "sel081x@goldia.uz", "SelX", "sales");
    await t.asAdmin();
    const ins = async (o: string, code: string, s: string) => (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${o}', '${code}', '${code}', '${s}') RETURNING id`)).rows[0]!.id;
    own = await ins(org, "C081", seller.employeeId);
    ownDebt = await ins(org, "C081D", seller.employeeId);
    other = await ins(org, "C081O", seller2.employeeId);
    foreign = await ins(org2, "C081X", sellerX.employeeId);
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_set_daily_gold_rate(p_rate_per_gram := 900000, p_rate_date := ${today})`);
    await t.asUser(mgr.userId);
    const r = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'R', p_original_physical_g := 40, p_factory_markup_pct := 8)`);
    await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${seller.employeeId}', p_factory_markup_pct := 8, p_seller_markup_pct := 10,
      p_factory_receipt_id := '${r.receipt_id}', p_pieces := '[{"weight_grams":10},{"weight_grams":10}]'::jsonb)`);
    // ownDebt: the seller has a 7 g legacy debt on this customer
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_record_client_legacy_debt(p_customer_id := '${ownDebt}', p_balance_type := 'debt', p_amount_585_g := 7, p_as_of_date := ${today}, p_entry_type := 'manual_addition')`);
  });

  it("seller enters a 12.5 g advance for his own customer without debt: advance +12.5, one row, nothing else moves", async () => {
    const m0 = await money();
    await t.asUser(seller.userId);
    const r = await t.rpc(adv(own, 12.5, `, p_idempotency_key := 'k81-1'`).replace(/^SELECT /, ""));
    expect(r.status).toBe("ok");
    expect(Number(r.delta_585_g)).toBe(-12.5);
    expect(await acc(own)).toEqual({ d: 0, a: 12.5 });
    expect(await rows(own)).toBe(1);
    expect(await money()).toBe(m0); // no till income, no stock, no vault, seller obligation unchanged
    await t.asAdmin();
    expect(await t.scalar(`(SELECT count(*) FROM public.client_legacy_debts WHERE customer_id = '${own}' AND seller_id = '${seller.employeeId}' AND balance_type = 'advance' AND created_by = '${seller.employeeId}')`)).toBe(1);
  });

  it("idempotency: same key returns the first result; another key within 10 minutes is refused as a duplicate", async () => {
    await t.asUser(seller.userId);
    const again = await t.rpc(adv(own, 12.5, `, p_idempotency_key := 'k81-1'`).replace(/^SELECT /, ""));
    expect(Number(again.delta_585_g)).toBe(-12.5);
    await t.asUser(seller.userId);
    await t.expectError(adv(own, 12.5, `, p_idempotency_key := 'k81-2'`), "Takroriy");
    expect(await rows(own)).toBe(1);
    expect(await acc(own)).toEqual({ d: 0, a: 12.5 });
  });

  it("seller advance refused when the customer has open debt (it would write the debt off); nothing changes", async () => {
    const before = await acc(ownDebt); const m0 = await money();
    expect(before.d).toBe(7);
    await t.asUser(seller.userId);
    await t.expectError(adv(ownDebt, 3), "ochiq qarz bor");
    expect(await acc(ownDebt)).toEqual(before);
    expect(await money()).toBe(m0);
  });

  it("seller cannot replace a final balance with an advance, nor use a reconciliation entry type", async () => {
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_record_client_legacy_debt(p_customer_id := '${own}', p_balance_type := 'advance', p_amount_585_g := 0,
      p_as_of_date := ${today}, p_entry_type := 'reconciliation_adjustment', p_target_final_balance := 50)`, "yakuniy balansni");
    await t.asUser(seller.userId);
    await t.expectError(adv(own, 1, `, p_entry_type := 'reconciliation_adjustment'`).replace(", p_entry_type := 'manual_addition'", ""), "faqat qo'shish");
    expect(await acc(own)).toEqual({ d: 0, a: 12.5 });
  });

  it("other seller's customer, another seller id, another organization's customer: refused", async () => {
    await t.asUser(seller.userId);
    await t.expectError(adv(other, 2), "sizga biriktirilmagan");
    await t.asUser(seller.userId);
    await t.expectError(adv(own, 2, `, p_seller_id := '${seller2.employeeId}'`), "o'z nomiga");
    await t.asUser(seller.userId);
    await t.expectError(adv(foreign, 2), "Mijoz topilmadi");
    expect(await acc(other)).toEqual({ d: 0, a: 0 });
    expect(await acc(foreign)).toEqual({ d: 0, a: 0 });
  });

  it("the advance is used by the next gram sale exactly like any advance; the seller obligation follows only the consignment", async () => {
    await t.asAdmin();
    const o0 = Number(await t.scalar(`(SELECT total_seller_obligation_g FROM public.seller_gold_accounts WHERE seller_id = '${seller.employeeId}')`));
    await t.asUser(seller.userId);
    const s = await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${own}', p_weight_grams := 10, p_client_markup_pct := 10, p_idempotency_key := 'k81-s1')`);
    expect(Number(s.advance_applied_grams)).toBe(11); // 10 g x 1.10 = 11 g due, all from the 12.5 g advance
    expect(await acc(own)).toEqual({ d: 0, a: 1.5 });
    await t.asAdmin();
    expect(Number(await t.scalar(`(SELECT total_seller_obligation_g FROM public.seller_gold_accounts WHERE seller_id = '${seller.employeeId}')`))).toBe(o0);
  });

  it("reversal stays with the manager: seller refused; manager reverses the seller's advance -> advance back, obligation unchanged", async () => {
    // a fresh customer so the reversal is the newest entry
    await t.asAdmin();
    const c = (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id) VALUES ('${org}', 'C081R', 'R', '${seller.employeeId}') RETURNING id`)).rows[0]!.id;
    await t.asUser(seller.userId);
    const r = await t.rpc(adv(c, 4).replace(/^SELECT /, ""));
    const m0 = await money();
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_legacy_debt(p_legacy_debt_id := '${r.legacy_debt_id}', p_reason := 'x')`, "Permission denied");
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_client_legacy_debt(p_legacy_debt_id := '${r.legacy_debt_id}', p_reason := 'xato kiritildi')`);
    expect(await acc(c)).toEqual({ d: 0, a: 0 });
    expect(await money()).toBe(m0);
  });

  it("076 rules unchanged: seller debt addition works, debt reduction refused; manager / director advance netting works", async () => {
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_record_client_legacy_debt(p_customer_id := '${ownDebt}', p_balance_type := 'debt', p_amount_585_g := 2, p_as_of_date := ${today}, p_entry_type := 'manual_addition')`);
    expect((await acc(ownDebt)).d).toBe(9);
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_record_client_legacy_debt(p_customer_id := '${ownDebt}', p_balance_type := 'debt', p_amount_585_g := 0,
      p_as_of_date := ${today}, p_entry_type := 'reconciliation_adjustment', p_target_final_balance := 5)`, "Qarzni kamaytirishni faqat menejer");
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_record_client_legacy_debt(p_customer_id := '${ownDebt}', p_balance_type := 'advance', p_amount_585_g := 10, p_as_of_date := ${today}, p_entry_type := 'manual_addition')`);
    expect(await acc(ownDebt)).toEqual({ d: 0, a: 1 }); // manager advance nets the 9 g debt first (unchanged 076 behaviour)
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_record_client_legacy_debt(p_customer_id := '${other}', p_balance_type := 'advance', p_amount_585_g := 3, p_as_of_date := ${today}, p_entry_type := 'manual_addition')`);
    expect(await acc(other)).toEqual({ d: 0, a: 3 });
  });
});
