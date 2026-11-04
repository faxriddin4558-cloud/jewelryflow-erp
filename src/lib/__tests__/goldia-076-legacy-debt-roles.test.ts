import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 076 (pre-launch incident: a seller entering 206.83 g legacy debt got "permission denied"):
//  * seller: own customers only, booked on himself, additions only (reductions / advances -> manager);
//  * manager: every customer of the organization, reductions and reversals;
//  * p_seller_id of another organization refused; duplicate additions refused; reversal recalculates the seller;
//  * financial reversal overload ambiguity removed; weight sale without a chosen piece works.

describe("Goldia 076 — legacy debt for managers and sellers", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-00000000a076";
  const org2 = "00000000-0000-0000-0000-00000000b076";
  let mgr: { userId: string; employeeId: string };
  let seller: { userId: string; employeeId: string };
  let seller2: { userId: string; employeeId: string };
  let foreignSeller: { userId: string; employeeId: string };
  let cust: string;
  let cust2: string;
  const today = `(timezone('Asia/Tashkent', now()))::date`;
  const legacy = (c: string, g: number, extra = "") =>
    `public.rpc_record_client_legacy_debt(p_customer_id := '${c}', p_balance_type := 'debt', p_amount_585_g := ${g},
      p_as_of_date := ${today}, p_entry_type := 'manual_addition'${extra})`;
  const debt = async (c: string) => {
    await t.asAdmin();
    return Number(await t.scalar(`(SELECT coalesce(current_debt_grams, 0) FROM public.client_gold_accounts WHERE customer_id = '${c}')`));
  };
  const obligation = async (s: string) => {
    await t.asAdmin();
    return Number(await t.scalar(`(SELECT coalesce(seller_legacy_debt_obligation_g, 0) FROM public.seller_gold_accounts WHERE seller_id = '${s}')`));
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'org-076', 'Org 076', 'ACTIVE'), ('${org2}', 'org-076b', 'Org 076b', 'ACTIVE')`);
    await t.addUser(org, "dir076@goldia.uz", "Dir", "director");
    mgr = await t.addUser(org, "mgr076@goldia.uz", "Mgr", "production_manager");
    seller = await t.addUser(org, "sel076@goldia.uz", "Sel", "sales");
    seller2 = await t.addUser(org, "sel076b@goldia.uz", "Sel2", "sales");
    foreignSeller = await t.addUser(org2, "sel076x@goldia.uz", "SelX", "sales");
    await t.asAdmin();
    cust = (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${org}', 'C076', 'Mijoz', '${seller.employeeId}') RETURNING id`)).rows[0]!.id;
    cust2 = (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${org}', 'C076B', 'Mijoz2', '${seller2.employeeId}') RETURNING id`)).rows[0]!.id;
  });

  it("seller adds 206.83 g to his own customer; his obligation grows 1:1; a retry with another key is refused", async () => {
    await t.asUser(seller.userId);
    const r = await t.rpc(legacy(cust, 206.83, `, p_idempotency_key := 'k-076-1'`));
    expect(Number(r.delta_585_g)).toBe(206.83);
    expect(await debt(cust)).toBe(206.83);
    expect(await obligation(seller.employeeId)).toBe(206.83);
    await t.asUser(seller.userId);
    const again = await t.rpc(legacy(cust, 206.83, `, p_idempotency_key := 'k-076-1'`));
    expect(again.legacy_debt_id).toBe(r.legacy_debt_id);
    await t.expectError(`SELECT ${legacy(cust, 206.83, `, p_idempotency_key := 'k-076-2'`)}`, "Takroriy");
    expect(await debt(cust)).toBe(206.83);
  });

  it("seller is limited: other seller's customer, advances, reductions, reversal, another seller id", async () => {
    await t.asUser(seller.userId);
    await t.expectError(`SELECT ${legacy(cust2, 5)}`, "sizga biriktirilmagan");
    await t.expectError(`SELECT public.rpc_record_client_legacy_debt(p_customer_id := '${cust}', p_balance_type := 'advance',
      p_amount_585_g := 5, p_as_of_date := ${today})`, "Avansni faqat menejer");
    await t.expectError(`SELECT public.rpc_record_client_legacy_debt(p_customer_id := '${cust}', p_balance_type := 'debt',
      p_amount_585_g := 0, p_as_of_date := ${today}, p_entry_type := 'reconciliation_adjustment', p_target_final_balance := 100)`, "kamaytirishni faqat menejer");
    await t.expectError(`SELECT ${legacy(cust, 1, `, p_seller_id := '${seller2.employeeId}'`)}`, "o''z nomiga".replace("''", "'"));
    await t.asAdmin();
    const id = await t.db.query<{ id: string }>(`SELECT id FROM public.client_legacy_debts WHERE customer_id = '${cust}' LIMIT 1`);
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_legacy_debt(p_legacy_debt_id := '${id.rows[0]!.id}', p_reason := 'x')`, "Permission denied");
    expect(await debt(cust)).toBe(206.83);
  });

  it("manager: any customer, another organization's seller refused, reversal recalculates the seller", async () => {
    await t.asUser(mgr.userId);
    await t.rpc(legacy(cust2, 7.25));
    expect(await debt(cust2)).toBe(7.25);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT ${legacy(cust2, 1, `, p_seller_id := '${foreignSeller.employeeId}'`)}`, "boshqa tashkilotga");
    await t.asAdmin();
    const id = (await t.db.query<{ id: string }>(`SELECT id FROM public.client_legacy_debts WHERE customer_id = '${cust}' LIMIT 1`)).rows[0]!.id;
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_client_legacy_debt(p_legacy_debt_id := '${id}', p_reason := 'xato')`);
    expect(await debt(cust)).toBe(0);
    expect(await obligation(seller.employeeId)).toBe(0);
  });

  it("manager reconciles a SALES debt down; the seller's legacy obligation is clamped at 0 (075: check constraint error)", async () => {
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.client_gold_accounts (customer_id, organization_id, seller_id, current_debt_grams, advance_balance_grams, total_purchased_gold_grams)
      VALUES ('${cust}', '${org}', '${seller.employeeId}', 70, 0, 70)
      ON CONFLICT (customer_id) DO UPDATE SET current_debt_grams = 70, advance_balance_grams = 0`);
    expect(await obligation(seller.employeeId)).toBe(0);
    await t.asUser(mgr.userId);
    const r = await t.rpc(`public.rpc_record_client_legacy_debt(p_customer_id := '${cust}', p_balance_type := 'debt', p_amount_585_g := 0,
      p_as_of_date := ${today}, p_entry_type := 'reconciliation_adjustment', p_target_final_balance := 69)`);
    expect(Number(r.delta_585_g)).toBe(-1);
    expect(await debt(cust)).toBe(69);
    expect(await obligation(seller.employeeId)).toBe(0);
  });

  it("financial reversal has one unambiguous signature", async () => {
    await t.asAdmin();
    expect(await t.scalar(`(SELECT count(*) FROM pg_proc WHERE proname = 'rpc_reverse_financial_transaction')`)).toBe(1);
  });
});
