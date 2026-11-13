import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 085 + business decision D-1 (2026-11-11): FACTORY -> MANAGER -> SELLER -> CUSTOMER. The factory obligation is created
// only at the factory -> manager stage; a manager -> seller transfer neither creates nor lowers it; every markup is on
// the ORIGINAL physical grams (never compounded); goods sold before T0 but not yet settled with the factory stay in
// the factory obligation (not derived from the stock on hand). Expected values are computed here (oracle).
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 085 / D-1 — factory -> manager -> seller chain at the opening and after it", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-0000000008d1";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S: U;
  let cust = "";
  let kn = 0;
  const key = (p: string) => `d1-${p}-${++kn}`;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const doc = async (args: string) => { await t.asUser(mgr.userId); return t.rpc(`public.rpc_record_opening_document(${args}, p_idempotency_key := '${key("d")}')`); };
  const state = async () => {
    const mStock = N((await one(`SELECT public.get_manager_available_stock_grams('${org}') v`)).v);
    const s = await one(`SELECT current_physical_stock_g st, seller_owes_manager_g owes FROM public.seller_gold_accounts WHERE seller_id = '${S.employeeId}'`);
    const v = await one(`SELECT current_factory_obligation_g fo, current_factory_advance_g fa FROM public.manager_vault_account WHERE organization_id = '${org}'`);
    return { manager: mStock, seller: N(s.st), factory: r4(N(v.fo) - N(v.fa)), sellerObligation: N(s.owes) };
  };
  const RATE = 900000;

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-d1', 'Goldia D-1', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-d1@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-d1@goldia.uz", "Menejer", "manager");
    S = await t.addUser(org, "s-d1@goldia.uz", "Sotuvchi", "sales");
    cust = (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${org}', 'C-D1', 'Mijoz D1', '+998900000801', '${S.employeeId}') RETURNING id`)).id as string;
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed)
                     VALUES ('${org}', CURRENT_DATE, 585, ${RATE}, 'UZS', true)`);
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 'd1.dump', true) RETURNING id`)).id;
    await t.asUser(dir.userId);
    // 086: the restart needs an active write freeze (release tooling) and a T0 within the last 24 h
    await t.asAdmin();
    await t.db.query(`SELECT public._goldia_financial_freeze(organization_id, 'test restart window', true) FROM public.financial_backup_verifications WHERE id = '${bv}'`);
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'D-1 sinovi', '${new Date(Date.now() - 60_000).toISOString()}', '${bv}', 'd1-restart')`);
  }, 180000);

  it("D1-1 the owner's example: factory 100 g @8 %, 60 g of it to the seller @12 % -> manager 40, seller 60, factory 108, seller 67.2 (markups on the original grams)", async () => {
    const mi = await doc(`p_kind := 'manager_inventory', p_physical_g := 100, p_factory_markup_pct := 8`);
    expect(await state()).toEqual({ manager: 100, seller: 0, factory: 108, sellerObligation: 0 });
    await doc(`p_kind := 'seller_inventory', p_seller_id := '${S.employeeId}', p_pieces := '[{"weight_grams":25},{"weight_grams":35}]'::jsonb, p_seller_markup_pct := 12, p_source_document_id := '${mi.document_id}'`);
    // the manager -> seller transfer neither creates nor lowers the factory obligation; 60 x 1.12 (not 60 x 1.08 x 1.12)
    expect(await state()).toEqual({ manager: 40, seller: 60, factory: 108, sellerObligation: r4(60 * 1.12) });
    expect(r4(60 * 1.12)).toBe(67.2);
  });

  it("D1-2 goods sold before T0 but not yet settled with the factory stay in the factory obligation (not derived from the stock)", async () => {
    await doc(`p_kind := 'factory_obligation', p_amount := 30, p_notes := 'T0 gacha sotilgan, zavodga hali to''lanmagan'`);
    expect((await state()).factory).toBe(138);
    await doc(`p_kind := 'manager_scrap', p_physical_g := 20, p_proba := 585`);
    await t.asUser(mgr.userId);
    const st = await t.rpc(`public.rpc_get_opening_state()`);
    const tot = st.totals as Record<string, unknown>;
    expect([N(tot.opening_receipts_physical_g), N(tot.factory_obligation_from_goods_g), N(tot.factory_obligation_without_goods_g)]).toEqual([100, 108, 30]);
    expect([(st.checks as Record<string, unknown>).inventory_equals_opening_receipts, (st.checks as Record<string, unknown>).factory_obligation_equals_documents]).toEqual([true, true]);
  });

  it("D1-3 lock, then ordinary transfers: manager -> seller 10 g (factory unchanged), seller sale + payment + handover (only the seller obligation moves), manager -> factory scrap (only the factory obligation moves)", async () => {
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'T0', p_idempotency_key := 'd1-b')`);
    const rcp = (await one(`SELECT factory_receipt_id v FROM public.opening_documents WHERE organization_id = '${org}' AND kind = 'manager_inventory'`)).v;
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${S.employeeId}', p_factory_markup_pct := 8, p_pieces := '[{"weight_grams":10}]'::jsonb, p_factory_receipt_id := '${rcp}', p_seller_markup_pct := 12, p_idempotency_key := 'd1-con')`);
    expect(await state()).toEqual({ manager: 30, seller: 70, factory: 138, sellerObligation: r4(67.2 + 11.2) });
    // the seller sells 10 g @15 % (stock moves, obligation does not), the customer pays 11.5 g in cash, the seller hands it over
    await t.asUser(S.userId);
    await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${cust}', p_weight_grams := 10, p_client_markup_pct := 15)`);
    expect(await state()).toEqual({ manager: 30, seller: 60, factory: 138, sellerObligation: 78.4 });
    await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${cust}', p_cash_amount := ${11.5 * RATE}, p_rate_per_gram := ${RATE})`);
    await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${S.employeeId}', p_cash_paid_amount := ${11.5 * RATE}, p_idempotency_key := 'd1-h')`);
    expect(await state()).toEqual({ manager: 30, seller: 60, factory: 138, sellerObligation: r4(78.4 - 11.5) });
    // the manager pays the factory with 20 g of LOM: only the factory obligation goes down
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_record_factory_gold_handover(p_source_type := 'scrap_gold', p_physical_weight_g := 20, p_proba := 585, p_agreed_equivalent_g := 20, p_idempotency_key := 'd1-fh')`);
    expect(await state()).toEqual({ manager: 30, seller: 60, factory: 118, sellerObligation: r4(78.4 - 11.5) });
  });

  it("D1-4 no double counting of the factory obligation anywhere: vault = receipts + opening obligations - handovers; consignments carry no factory debt; profit = baseline factory", async () => {
    const v = await one(`SELECT
        (SELECT coalesce(sum(factory_obligation_g), 0) FROM public.factory_receipts WHERE organization_id = '${org}' AND status <> 'reversed') rc,
        (SELECT coalesce(sum(agreed_equivalent_g), 0) FROM public.factory_gold_handovers WHERE organization_id = '${org}' AND status <> 'reversed') hd,
        (SELECT coalesce(sum(amount), 0) FROM public.opening_documents WHERE organization_id = '${org}' AND status = 'active' AND kind = 'factory_obligation') ob`);
    expect(r4(N(v.rc) + N(v.ob) - N(v.hd))).toBe(118);
    expect((await state()).factory).toBe(118);
    await t.asUser(mgr.userId);
    const p = await t.rpc(`public.rpc_get_accounting_profit_summary(p_gold_rate := ${RATE})`);
    expect(N((p.liabilities as Record<string, unknown>).factory_debt_585_g)).toBe(118);
    // the seller's obligation is never added to the factory obligation
    const owes = (await state()).sellerObligation;
    expect(owes).toBe(66.9);
    expect(N((p.liabilities as Record<string, unknown>).factory_debt_585_g)).not.toBe(r4(118 + owes));
  });

  it("D1-5 the old test cleanup is refused once the organization uses the controlled opening (it would leave UZS / USD behind)", async () => {
    await t.asUser(dir.userId);
    await t.expectError(`SELECT public.rpc_execute_full_test_reset('RESET_TEST_ACCOUNT_2026', 'sinov')`, "ERR_USE_FINANCIAL_RESTART");
  });
});
