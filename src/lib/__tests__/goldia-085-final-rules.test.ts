import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 085 final business rules (2026-11-11): D-2 the company bears the rate difference (recorded on the handover, no double
// counting), D-3 a currency advance never lowers the seller obligation and is no income, D-4 every ordinary financial
// write is refused by the database while the opening is in draft, D-6 opening fine gold = the refined pure gold asset.
// Every expected value is computed here (oracle).
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 085 — final rules D-2 / D-3 / D-4 / D-6", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-0000000008f5";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S: U;
  let cUzs = "", cUsd = "", cAdv = "", cG = "";
  let mi = "";
  let kn = 0;
  const key = (p: string) => `fr-${p}-${++kn}`;
  const RATE = 900000;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const doc = async (args: string) => { await t.asUser(mgr.userId); return t.rpc(`public.rpc_record_opening_document(${args}, p_idempotency_key := '${key("d")}')`); };
  const owes = async () => N((await one(`SELECT seller_owes_manager_g v FROM public.seller_gold_accounts WHERE seller_id = '${S.employeeId}'`)).v);
  const cur = async (c: string, k: string) => one(`SELECT coalesce(debt_amount, 0) d, coalesce(advance_amount, 0) a FROM public.client_currency_accounts WHERE customer_id = '${c}' AND currency = '${k}'`);

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-fr', 'Goldia FR', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-fr@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-fr@goldia.uz", "Menejer", "manager");
    S = await t.addUser(org, "s-fr@goldia.uz", "Sotuvchi", "sales");
    const c = async (code: string) => (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${org}', '${code}', 'Mijoz ${code}', '+99890${code.replace(/\D/g, "").padStart(7, "0")}', '${S.employeeId}') RETURNING id`)).id as string;
    cUzs = await c("C-U1"); cUsd = await c("C-U2"); cAdv = await c("C-U3"); cG = await c("C-U4");
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, ${RATE}, 'UZS', true)`);
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 'fr.dump', true) RETURNING id`)).id;
    await t.asUser(dir.userId);
    // 086: the restart needs an active write freeze (release tooling) and a T0 within the last 24 h
    await t.asAdmin();
    await t.db.query(`SELECT public._goldia_financial_freeze(organization_id, 'test restart window', true) FROM public.financial_backup_verifications WHERE id = '${bv}'`);
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'final rules', '${new Date(Date.now() - 60_000).toISOString()}', '${bv}', 'fr-restart')`);
    mi = (await doc(`p_kind := 'manager_inventory', p_physical_g := 100, p_factory_markup_pct := 8`)).document_id as string;
    await doc(`p_kind := 'seller_inventory', p_seller_id := '${S.employeeId}', p_pieces := '[{"weight_grams":20},{"weight_grams":30}]'::jsonb, p_seller_markup_pct := 12, p_source_document_id := '${mi}'`);
    await doc(`p_kind := 'customer_currency', p_customer_id := '${cUzs}', p_unit := 'UZS', p_side := 'debt', p_amount := 8600000, p_lom_rate := 860000`);
    await doc(`p_kind := 'customer_currency', p_customer_id := '${cUsd}', p_unit := 'USD', p_side := 'debt', p_amount := 100, p_usd_rate := 12600, p_lom_rate := 900000`);
    await doc(`p_kind := 'manager_fine_gold', p_physical_g := 20, p_proba := 999`);
  }, 180000);

  it("D-4 draft: every ordinary financial write is refused by the database for director, manager and seller; opening documents still work", async () => {
    const tries: [U, string][] = [
      [S, `public.rpc_record_weight_sale(p_customer_id := '${cG}', p_weight_grams := 1, p_client_markup_pct := 10)`],
      [S, `public.rpc_record_currency_sale(p_customer_id := '${cG}', p_currency := 'USD', p_amount := 10, p_weight_grams := 1, p_idempotency_key := 'x1')`],
      [S, `public.rpc_record_client_currency_settlement(p_customer_id := '${cUzs}', p_currency := 'UZS', p_cash_uzs := 1000, p_idempotency_key := 'x2')`],
      [S, `public.rpc_record_client_legacy_debt(p_customer_id := '${cG}', p_balance_type := 'debt', p_amount_585_g := 1, p_as_of_date := CURRENT_DATE)`],
      [mgr, `public.rpc_record_client_settlement(p_customer_id := '${cG}', p_cash_amount := 900000, p_rate_per_gram := 900000)`],
      [mgr, `public.rpc_record_financial_transaction(p_transaction_type := 'capital_contribution', p_source_till := 'manager_uzs', p_amount := 1000, p_currency := 'UZS', p_gold_rate := 900000, p_idempotency_key := 'x3')`],
      [mgr, `public.rpc_record_factory_receipt(p_product_name := 'x', p_original_physical_g := 1, p_factory_markup_pct := 8, p_idempotency_key := 'x4')`],
      [dir, `public.rpc_issue_barcode_consignment(p_seller_id := '${S.employeeId}', p_factory_markup_pct := 8, p_pieces := '[{"weight_grams":1}]'::jsonb, p_seller_markup_pct := 12, p_idempotency_key := 'x5')`],
      [dir, `public.rpc_record_factory_gold_handover(p_source_type := 'refined_gold', p_physical_weight_g := 1, p_proba := 999, p_agreed_equivalent_g := 1, p_idempotency_key := 'x6')`],
    ];
    for (const [u, call] of tries) {
      await t.asUser(u.userId);
      await t.expectError(`SELECT ${call}`, "ERR_OPENING_DRAFT");
    }
    // the old bypasses are closed too: test cleanup, a second restart
    await t.asUser(dir.userId);
    await t.expectError(`SELECT public.rpc_execute_full_test_reset('RESET_TEST_ACCOUNT_2026', 'x')`, "ERR_USE_FINANCIAL_RESTART");
    // opening documents keep working, and only those
    const d = await doc(`p_kind := 'manager_scrap', p_physical_g := 10, p_proba := 750`);
    expect(d.status).toBe("ok");
    await t.asUser(mgr.userId);
    const st = await t.rpc(`public.rpc_get_opening_state()`);
    expect((st.checks as Record<string, unknown>).non_opening_documents_after_restart).toBe(0);
  });

  it("D-6 opening fine gold = the refined pure gold asset: 20 g @999 -> 34.1538 g (585) and 19.98 g fine; usable for a factory payment", async () => {
    const v = await one(`SELECT manager_refined_gold_grams g, manager_refined_gold_fine_grams f FROM public.manager_vault_account WHERE organization_id = '${org}'`);
    expect([N(v.g), N(v.f)]).toEqual([r4((20 * 999) / 585), r4((20 * 999) / 1000)]);
    // lock the opening, then pay the factory with 10 g of it: refined gold and the factory obligation go down, nothing else
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'T0', p_idempotency_key := 'fr-b', p_usd_rate := 12500)`);
    const f0 = N((await one(`SELECT current_factory_obligation_g v FROM public.manager_vault_account WHERE organization_id = '${org}'`)).v);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_record_factory_gold_handover(p_source_type := 'refined_gold', p_physical_weight_g := 10, p_proba := 999, p_agreed_equivalent_g := ${r4((10 * 999) / 585)}, p_idempotency_key := 'fr-fh')`);
    const v2 = await one(`SELECT manager_refined_gold_grams g, current_factory_obligation_g fo FROM public.manager_vault_account WHERE organization_id = '${org}'`);
    expect([N(v2.g), N(v2.fo)]).toEqual([r4(r4((20 * 999) / 585) - r4((10 * 999) / 585)), r4(f0 - r4((10 * 999) / 585))]);
  });

  it("D-2 UZS: the opening debt 8 600 000 @860 000 (10 g) paid in full and handed over at 900 000 -> seller obligation exactly -10 g once, company difference 0.4444 g recorded, customer debt 0", async () => {
    const o0 = await owes();
    await t.asUser(S.userId);
    const p = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cUzs}', p_currency := 'UZS', p_cash_uzs := 8600000, p_idempotency_key := 'fr-p1')`);
    expect([N(p.opening_snapshot_585_g), N((await cur(cUzs, "UZS")).d)]).toEqual([10, 0]);
    expect(await owes()).toBe(o0); // paying the customer debt does not touch the seller obligation (D-2: kept apart)
    const h = await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${S.employeeId}', p_cash_paid_amount := 8600000, p_rate_per_gram := 900000, p_idempotency_key := 'fr-h1')`);
    expect(r4(o0 - (await owes()))).toBe(10);
    expect(N(h.company_rate_difference_585_g)).toBe(r4(10 - 8600000 / 900000));
    await t.asUser(mgr.userId);
    const ps = await t.rpc(`public.rpc_get_accounting_profit_summary(p_gold_rate := ${RATE}, p_usd_rate := 12500)`);
    expect(N(ps.company_rate_difference_585_g)).toBe(r4(10 - 8600000 / 900000));
    // the handover reversal puts everything back exactly once
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_seller_to_manager_settlement('${h.settlement_id}', 'sinov', null)`);
    expect(await owes()).toBe(o0);
    const ps2 = await t.rpc(`public.rpc_get_accounting_profit_summary(p_gold_rate := ${RATE}, p_usd_rate := 12500)`);
    expect(N(ps2.company_rate_difference_585_g)).toBe(0);
    await t.asUser(S.userId);
    await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${S.employeeId}', p_cash_paid_amount := 8600000, p_rate_per_gram := 900000, p_idempotency_key := 'fr-h1b')`);
    expect(r4(o0 - (await owes()))).toBe(10);
  });

  it("D-2 USD: 100 USD opening debt (12 600 / 900 000 = 1.4 g) paid and handed over at 12 500 -> obligation -1.4 g, difference 0.0111 g; a reversed payment takes its pool share with it", async () => {
    const o0 = await owes();
    await t.asUser(S.userId);
    const p = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cUsd}', p_currency := 'USD', p_usd_amount := 100, p_idempotency_key := 'fr-p2')`);
    expect(N(p.opening_snapshot_585_g)).toBe(1.4);
    // reversed before the handover: debt, till and valued pool back (nothing left to close)
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_client_currency_settlement('${p.settlement_id}', 'xato', 'fr-p2r')`);
    const pool = await one(`SELECT till_valued_usd u, till_valued_usd_585_g g, seller_till_usd_amount t FROM public.seller_gold_accounts WHERE seller_id = '${S.employeeId}'`);
    expect([N(pool.u), N(pool.g), N(pool.t), N((await cur(cUsd, "USD")).d)]).toEqual([0, 0, 0, 100]);
    await t.asUser(S.userId);
    await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cUsd}', p_currency := 'USD', p_usd_amount := 100, p_idempotency_key := 'fr-p3')`);
    const h = await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${S.employeeId}', p_usd_paid_amount := 100, p_usd_rate := 12500, p_rate_per_gram := 900000, p_idempotency_key := 'fr-h2')`);
    expect(r4(o0 - (await owes()))).toBe(1.4);
    expect(N(h.company_rate_difference_585_g)).toBe(r4(1.4 - (100 * 12500) / 900000));
  });

  it("D-3 a currency advance: no seller obligation change at payment or at handover; liability = cash asset, so the result does not move", async () => {
    await t.asUser(mgr.userId);
    const before = await t.rpc(`public.rpc_get_accounting_profit_summary(p_gold_rate := ${RATE}, p_usd_rate := 12500)`);
    const o0 = await owes();
    await t.asUser(S.userId);
    await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cAdv}', p_currency := 'USD', p_usd_amount := 50, p_idempotency_key := 'fr-a1')`);
    expect([N((await cur(cAdv, "USD")).a), await owes()]).toEqual([50, o0]);
    await t.asUser(mgr.userId);
    const mid = await t.rpc(`public.rpc_get_accounting_profit_summary(p_gold_rate := ${RATE}, p_usd_rate := 12500)`);
    expect(N(mid.period_accounting_result_585_g)).toBe(N(before.period_accounting_result_585_g));
    await t.asUser(S.userId);
    await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${S.employeeId}', p_usd_paid_amount := 50, p_usd_rate := 12500, p_rate_per_gram := 900000, p_idempotency_key := 'fr-a2')`);
    expect(await owes()).toBe(o0); // the advance money handed over does not lower the seller obligation
    await t.asUser(mgr.userId);
    const after = await t.rpc(`public.rpc_get_accounting_profit_summary(p_gold_rate := ${RATE}, p_usd_rate := 12500)`);
    expect(N(after.period_accounting_result_585_g)).toBe(N(before.period_accounting_result_585_g));
    expect(N((after.liabilities as Record<string, unknown>).customer_usd_advance_585_eq_g)).toBe(r4((50 * 12500) / RATE));
  });

  it("D-1 still holds after all of it: factory obligation moved only by the factory payment; manager -> seller transfer did not touch it", async () => {
    const v = await one(`SELECT current_factory_obligation_g fo FROM public.manager_vault_account WHERE organization_id = '${org}'`);
    expect(N(v.fo)).toBe(r4(108 - r4((10 * 999) / 585)));
  });
});
