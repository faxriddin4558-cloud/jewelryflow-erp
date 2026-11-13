import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 085 controlled financial restart + opening accounting (decisions O-1 … O-6, 2026-11-11). Every expected value is
// computed here independently (oracle), never read back from the function under test.
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 100) / 100;
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 085 — financial restart + opening accounting", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-0000000008a5";
  const org2 = "00000000-0000-0000-0000-0000000008b5";
  // 086: T0 must be within the last 24 h and the restart needs an active write freeze
  const T0 = new Date(Date.now() - 60_000).toISOString();
  const RATE = 900000;
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, A: U, B: U, dir2: U, s2: U;
  let cA1: string, cA2: string, cB1: string, c2: string;
  let kn = 0;
  const key = (p: string) => `t85-${p}-${++kn}`;
  const q = async <T = Record<string, unknown>>(sql: string) => { await t.asAdmin(); return (await t.db.query<T>(sql)).rows; };
  const one = async (sql: string) => (await q(sql))[0] ?? {};
  const ex = async (sql: string) => { await t.asAdmin(); await t.db.exec(sql); };
  const as = async (u: U) => t.asUser(u.userId);
  const verify = async (o = org) => (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified)
                                                 VALUES ('${o}', 'backup-${++kn}.dump', true) RETURNING id`)).id as string;
  const doc = async (u: U, args: string) => { await as(u); return t.rpc(`public.rpc_record_opening_document(${args}, p_idempotency_key := '${key("d")}')`); };
  const acc = async (s: U) => one(`SELECT current_physical_stock_g st, seller_owes_manager_g owes, seller_till_cash_amount c, seller_till_usd_amount u FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`);
  const vault = async () => one(`SELECT manager_cash_amount c, manager_usd_amount u, manager_scrap_grams sc, manager_refined_gold_grams fg, current_factory_obligation_g fo, current_factory_advance_g fa FROM public.manager_vault_account WHERE organization_id = '${org}'`);
  const mgrStock = async () => N((await one(`SELECT public.get_manager_available_stock_grams('${org}') v`)).v);
  const gram = async (c: string) => one(`SELECT coalesce(current_debt_grams, 0) d, coalesce(advance_balance_grams, 0) a FROM public.client_gold_accounts WHERE customer_id = '${c}'`);
  const cur = async (c: string, k: string) => one(`SELECT coalesce(debt_amount, 0) d, coalesce(advance_amount, 0) a FROM public.client_currency_accounts WHERE customer_id = '${c}' AND currency = '${k}'`);
  // independent check of the period report engine: every unit's sum of document effects = the account balances
  const effectsMatchAccounts = async () => {
    const e = await one(`SELECT round(sum(cust_g), 4) cg, round(sum(cur_uzs), 2) cu, round(sum(cur_usd), 2) cd, round(sum(stock_g), 4) st,
                                round(sum(till_uzs), 2) tu, round(sum(till_usd), 2) td, round(sum(mgr_uzs), 2) mu, round(sum(mgr_usd), 2) md,
                                round(sum(factory_g), 4) fg FROM public._goldia_period_effects('${org}')`);
    const a = await one(`SELECT
      (SELECT round(coalesce(sum(current_debt_grams - advance_balance_grams), 0), 4) FROM public.client_gold_accounts WHERE organization_id = '${org}') cg,
      (SELECT round(coalesce(sum(debt_amount - advance_amount), 0), 2) FROM public.client_currency_accounts WHERE organization_id = '${org}' AND currency = 'UZS') cu,
      (SELECT round(coalesce(sum(debt_amount - advance_amount), 0), 2) FROM public.client_currency_accounts WHERE organization_id = '${org}' AND currency = 'USD') cd,
      (SELECT round(coalesce(sum(current_physical_stock_g), 0), 4) FROM public.seller_gold_accounts WHERE organization_id = '${org}') st,
      (SELECT round(coalesce(sum(seller_till_cash_amount), 0), 2) FROM public.seller_gold_accounts WHERE organization_id = '${org}') tu,
      (SELECT round(coalesce(sum(seller_till_usd_amount), 0), 2) FROM public.seller_gold_accounts WHERE organization_id = '${org}') td,
      (SELECT manager_cash_amount FROM public.manager_vault_account WHERE organization_id = '${org}') mu,
      (SELECT manager_usd_amount FROM public.manager_vault_account WHERE organization_id = '${org}') md,
      (SELECT round(current_factory_obligation_g - current_factory_advance_g, 4) FROM public.manager_vault_account WHERE organization_id = '${org}') fg`);
    return { effects: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, N(v)])), accounts: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, N(v)])) };
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-085', 'Goldia 085', 'ACTIVE'), ('${org2}', 'goldia-085b', 'Boshqa 085', 'ACTIVE')`);
    dir = await t.addUser(org, "dir085@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr085@goldia.uz", "Menejer", "manager");
    A = await t.addUser(org, "sa085@goldia.uz", "Sotuvchi A", "sales");
    B = await t.addUser(org, "sb085@goldia.uz", "Sotuvchi B", "sales");
    dir2 = await t.addUser(org2, "dir085b@goldia.uz", "Direktor2", "director");
    s2 = await t.addUser(org2, "s085b@goldia.uz", "Sotuvchi2", "sales");
    const cust = async (o: string, code: string, name: string, seller: U) => (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${o}', '${code}', '${name}', '+99890${code.replace(/\D/g, "").padStart(7, "0")}', '${seller.employeeId}') RETURNING id`)).id as string;
    cA1 = await cust(org, "C-A1", "Mijoz A1", A); cA2 = await cust(org, "C-A2", "Mijoz A2", A); cB1 = await cust(org, "C-B1", "Mijoz B1", B);
    c2 = await cust(org2, "C-X1", "Boshqa mijoz", s2);
    expect(c2).toBeTruthy();
    await ex(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES
             ('${org}', CURRENT_DATE, 585, ${RATE}, 'UZS', true), ('${org2}', CURRENT_DATE, 585, ${RATE}, 'UZS', true)`);
    // ---- the "wrong" pre-restart history: stock, sales, payments, a currency payment WITHOUT debt (advance + till),
    // a legacy gram debt, capital, a currency sale - like the production state found in the audit
    await as(mgr);
    const rc = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'Eski partiya', p_original_physical_g := 200, p_factory_markup_pct := 8, p_idempotency_key := 'old-rc')`);
    await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${A.employeeId}', p_factory_markup_pct := 8, p_pieces := '[{"weight_grams":30},{"weight_grams":20}]'::jsonb, p_factory_receipt_id := '${rc.receipt_id}', p_seller_markup_pct := 12, p_idempotency_key := 'old-con')`);
    await as(A);
    const s = await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${cA1}', p_weight_grams := 10, p_client_markup_pct := 15)`);
    await t.rpc(`public.rpc_record_sale_return(p_sale_id := '${s.sale_id}', p_weight_grams := 2, p_reason := 'old return', p_destination := 'seller', p_idempotency_key := 'old-ret')`);
    await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${cA1}', p_cash_amount := 900000, p_rate_per_gram := ${RATE})`);
    await t.rpc(`public.rpc_record_currency_sale(p_customer_id := '${cA2}', p_currency := 'USD', p_amount := 300, p_weight_grams := 3, p_idempotency_key := 'old-cs')`);
    await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cA1}', p_currency := 'USD', p_usd_amount := 700, p_idempotency_key := 'old-cp', p_usd_rate := 12500)`);
    await as(mgr);
    await t.rpc(`public.rpc_record_client_legacy_debt(p_customer_id := '${cB1}', p_balance_type := 'debt', p_amount_585_g := 100, p_as_of_date := CURRENT_DATE, p_entry_type := 'initial', p_idempotency_key := 'old-leg')`);
    await t.rpc(`public.rpc_record_financial_transaction(p_transaction_type := 'capital_contribution', p_source_till := 'manager_uzs', p_amount := 5000000, p_currency := 'UZS', p_gold_rate := ${RATE}, p_idempotency_key := 'old-cap')`);
    await as(A);
    await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${A.employeeId}', p_cash_paid_amount := 900000, p_idempotency_key := 'old-h')`);
    // 086: the backup -> restart window is frozen on the server (release tooling)
    await ex(`SELECT public._goldia_financial_freeze('${org}', 'test restart window', true)`);
  }, 180000);

  it("R1 guards: only the director, exact confirmation, reason, T0, key and a fresh unused restore-verified backup", async () => {
    const v = await verify();
    const call = (conf: string, reason: string, t0: string, bv: string | null, k: string | null) =>
      `SELECT public.rpc_financial_restart(${conf}, ${reason}, ${t0}, ${bv ? `'${bv}'` : "null"}, ${k ? `'${k}'` : "null"})`;
    await as(mgr);
    await t.expectError(call("'MOLIYAVIY HISOBNI QAYTA BOSHLASH'", "'x'", "now()", v, "k1"), "faqat direktor");
    await as(A);
    await t.expectError(call("'MOLIYAVIY HISOBNI QAYTA BOSHLASH'", "'x'", "now()", v, "k1"), "faqat direktor");
    await as(dir);
    await t.expectError(call("'RESET_TEST_ACCOUNT_2026'", "'x'", "now()", v, "k1"), "ERR_CONFIRMATION");
    await t.expectError(call("'MOLIYAVIY HISOBNI QAYTA BOSHLASH'", "' '", "now()", v, "k1"), "ERR_REASON");
    await t.expectError(call("'MOLIYAVIY HISOBNI QAYTA BOSHLASH'", "'x'", "null", v, "k1"), "ERR_T0");
    await t.expectError(call("'MOLIYAVIY HISOBNI QAYTA BOSHLASH'", "'x'", "now()", v, null), "ERR_IDEMPOTENCY");
    await t.expectError(call("'MOLIYAVIY HISOBNI QAYTA BOSHLASH'", "'x'", "now()", null, "k2"), "ERR_BACKUP_NOT_VERIFIED");
    const old = await verify();
    await q(`UPDATE public.financial_backup_verifications SET verified_at = now() - interval '25 hours' WHERE id = '${old}'`);
    await as(dir);
    await t.expectError(call("'MOLIYAVIY HISOBNI QAYTA BOSHLASH'", "'x'", "now()", old, "k3"), "ERR_BACKUP_NOT_VERIFIED");
    const other = await verify(org2);
    await as(dir);
    await t.expectError(call("'MOLIYAVIY HISOBNI QAYTA BOSHLASH'", "'x'", "now()", other, "k4"), "ERR_BACKUP_NOT_VERIFIED");
    // a signed-in user cannot fabricate a backup verification
    await as(dir);
    await t.expectError(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 'fake', true)`, "permission denied");
  });

  it("R2 atomic: a failure in the middle of the restart leaves every document, balance and the backup untouched", async () => {
    const v = await verify();
    const before = await one(`SELECT (SELECT count(*) FROM public.jewelry_sales WHERE organization_id = '${org}' AND status NOT IN ('reversed','cancelled')) s,
      (SELECT count(*) FROM public.client_currency_settlements WHERE organization_id = '${org}' AND status = 'confirmed') cs,
      (SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${cB1}') d`);
    await ex(`CREATE FUNCTION public._t85_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$;
             CREATE TRIGGER t85_fail BEFORE UPDATE ON public.client_currency_accounts FOR EACH ROW EXECUTE FUNCTION public._t85_fail();`);
    await as(dir);
    await t.expectError(`SELECT public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'atomic test', now(), '${v}', 'atomic-1')`, "injected failure");
    await ex(`DROP TRIGGER t85_fail ON public.client_currency_accounts; DROP FUNCTION public._t85_fail();`);
    const after = await one(`SELECT (SELECT count(*) FROM public.jewelry_sales WHERE organization_id = '${org}' AND status NOT IN ('reversed','cancelled')) s,
      (SELECT count(*) FROM public.client_currency_settlements WHERE organization_id = '${org}' AND status = 'confirmed') cs,
      (SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${cB1}') d`);
    expect(after).toEqual(before);
    expect(N(before.s)).toBeGreaterThan(0);
    expect((await q(`SELECT 1 FROM public.financial_restarts`)).length).toBe(0);
    expect((await one(`SELECT consumed_by_restart_id x FROM public.financial_backup_verifications WHERE id = '${v}'`)).x).toBeNull();
  });

  let restartId = "";
  it("R3 restart: identities kept; every balance (585 g, UZS, USD, LOM, stock, obligations, tills, vault) zero; documents archived row by row", async () => {
    const ids = await one(`SELECT (SELECT string_agg(concat_ws(':', id, contact_name, phone, seller_id), ',' ORDER BY id) FROM public.customers WHERE organization_id = '${org}') c,
                                  (SELECT string_agg(concat_ws(':', id, user_id, role), ',' ORDER BY id) FROM public.employees WHERE organization_id = '${org}') e`);
    const live = await one(`SELECT (SELECT count(*) FROM public.jewelry_sales WHERE organization_id = '${org}' AND status NOT IN ('reversed','cancelled'))
       + (SELECT count(*) FROM public.client_currency_settlements WHERE organization_id = '${org}' AND status <> 'reversed')
       + (SELECT count(*) FROM public.client_legacy_debts WHERE organization_id = '${org}' AND status <> 'reversed') n`);
    const org2Before = await one(`SELECT string_agg(customer_id::text || ':' || debt_amount::text, ',') v FROM public.client_currency_accounts WHERE organization_id = '${org2}'`);
    const v = await verify();
    await as(dir);
    const r = await t.rpc(`public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'Production restart sinovi', '${T0}', '${v}', 'restart-1')`);
    restartId = r.restart_id as string;
    expect(r.status).toBe("ok");
    // replay of the same request returns the same result, does nothing again
    const r2 = await t.rpc(`public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'Production restart sinovi', '${T0}', '${v}', 'restart-1')`);
    expect(r2.restart_id).toBe(restartId);
    const ids2 = await one(`SELECT (SELECT string_agg(concat_ws(':', id, contact_name, phone, seller_id), ',' ORDER BY id) FROM public.customers WHERE organization_id = '${org}') c,
                                   (SELECT string_agg(concat_ws(':', id, user_id, role), ',' ORDER BY id) FROM public.employees WHERE organization_id = '${org}') e`);
    expect(ids2).toEqual(ids);
    const z = await one(`SELECT
      (SELECT coalesce(sum(abs(current_debt_grams) + abs(advance_balance_grams)), 0) FROM public.client_gold_accounts WHERE organization_id = '${org}')
    + (SELECT coalesce(sum(debt_amount + advance_amount), 0) FROM public.client_currency_accounts WHERE organization_id = '${org}')
    + (SELECT coalesce(sum(abs(current_physical_stock_g) + abs(seller_owes_manager_g) + abs(seller_till_cash_amount) + abs(seller_till_usd_amount) + abs(seller_till_scrap_grams) + abs(till_valued_cash_uzs)), 0) FROM public.seller_gold_accounts WHERE organization_id = '${org}')
    + (SELECT abs(manager_cash_amount) + abs(manager_usd_amount) + abs(manager_scrap_grams) + abs(current_factory_obligation_g) + abs(current_factory_advance_g) FROM public.manager_vault_account WHERE organization_id = '${org}') v,
      public.get_manager_available_stock_grams('${org}') ms`);
    expect([N(z.v), N(z.ms)]).toEqual([0, 0]);
    // archived, not deleted; each row listed with its old status; reversal times stamped (period report nets them)
    const items = N((await one(`SELECT count(*) n FROM public.financial_restart_items WHERE restart_id = '${restartId}'`)).n);
    expect(items).toBeGreaterThanOrEqual(N(live.n));
    expect((await one(`SELECT count(*) n FROM public.client_currency_settlements WHERE organization_id = '${org}' AND (status <> 'reversed' OR reversed_at IS NULL)`)).n).toBe(0);
    expect((await one(`SELECT count(*) n FROM public.factory_receipts WHERE organization_id = '${org}' AND (status <> 'reversed' OR reversed_at IS NULL)`)).n).toBe(0);
    expect((await one(`SELECT count(*) n FROM public.seller_consignments WHERE organization_id = '${org}' AND (status <> 'cancelled' OR cancelled_at IS NULL)`)).n).toBe(0);
    expect((await one(`SELECT count(*) n FROM public.jewelry_sales WHERE organization_id = '${org}'`)).n).toBeGreaterThan(0);
    expect((await one(`SELECT count(*) n FROM public.accounting_baselines WHERE organization_id = '${org}' AND status = 'active'`)).n).toBe(0);
    expect((await one(`SELECT count(*) n FROM public.opening_periods WHERE organization_id = '${org}' AND status = 'draft'`)).n).toBe(1);
    expect((await one(`SELECT count(*) n FROM public.audit_logs WHERE action = 'FINANCIAL_RESTART' AND record_id = '${restartId}'`)).n).toBe(1);
    // the other organization is untouched
    expect(await one(`SELECT string_agg(customer_id::text || ':' || debt_amount::text, ',') v FROM public.client_currency_accounts WHERE organization_id = '${org2}'`)).toEqual(org2Before);
    // a second restart while the opening is in draft is refused; the used backup cannot serve again
    const v2 = await verify();
    await as(dir);
    await t.expectError(`SELECT public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'again', now(), '${v2}', 'restart-2')`, "ERR_RESTART_ALREADY_OPEN");
    // the period report engine: archived documents net out exactly - every unit = 0 = the accounts
    const m = await effectsMatchAccounts();
    expect(m.effects).toEqual(m.accounts);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const D: Record<string, any> = {};
  it("O1 opening documents: manager inventory 100 g @8 % -> stock 100, factory 108; seller inventory from it and direct; obligations separate", async () => {
    D.mi = await doc(mgr, `p_kind := 'manager_inventory', p_physical_g := 100, p_factory_markup_pct := 8, p_product_name := 'Uzuklar'`);
    expect([await mgrStock(), N((await vault()).fo)]).toEqual([100, 108]);
    // 30 g of it to seller A @12 % (moves, counted once)
    D.sa = await doc(mgr, `p_kind := 'seller_inventory', p_seller_id := '${A.employeeId}', p_pieces := '[{"weight_grams":10},{"weight_grams":20}]'::jsonb, p_seller_markup_pct := 12, p_source_document_id := '${D.mi.document_id}'`);
    expect(await mgrStock()).toBe(70);
    expect([N((await acc(A)).st), N((await acc(A)).owes)]).toEqual([30, r4(30 * 1.12)]);
    expect(N((await vault()).fo)).toBe(108);
    // 50 g only on seller B (not in the manager's stock) @ factory 8 % / seller 12 %: no manager stock is invented
    D.sb = await doc(mgr, `p_kind := 'seller_inventory', p_seller_id := '${B.employeeId}', p_physical_g := 50, p_factory_markup_pct := 8, p_seller_markup_pct := 12`);
    expect(await mgrStock()).toBe(70);
    expect([N((await acc(B)).st), N((await acc(B)).owes)]).toEqual([50, 56]);
    expect(N((await vault()).fo)).toBe(r4(108 + 54));
    // the seller's stock = his held pieces
    const held = N((await one(`SELECT public.get_seller_available_stock_grams('${B.employeeId}') v`)).v);
    expect(held).toBe(50);
  });

  it("O2 factory obligation / advance without goods, seller obligation; separate ledgers", async () => {
    D.fo = await doc(dir, `p_kind := 'factory_obligation', p_amount := 20, p_notes := 'zavodga eski qarz'`);
    D.fa = await doc(dir, `p_kind := 'factory_advance', p_amount := 5`);
    expect(N((await vault()).fo)).toBe(r4(162 + 20 - 5));
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'seller_obligation', p_seller_id := '${A.employeeId}', p_amount := 10, p_idempotency_key := 'no-note')`, "asosi");
    D.so = await doc(mgr, `p_kind := 'seller_obligation', p_seller_id := '${A.employeeId}', p_amount := 10, p_notes := 'eski hisob-kitob'`);
    expect(N((await acc(A)).owes)).toBe(r4(33.6 + 10));
    expect(N((await vault()).fo)).toBe(177); // the seller obligation does not touch the factory
  });

  it("O3 customers: 585 debt (seller obligation like a legacy debt), 585 advance, UZS debt 8 600 000 @ 860 000 = 10 g once, USD debt, USD advance; duplicates and missing rates refused", async () => {
    D.g1 = await doc(mgr, `p_kind := 'customer_gram', p_customer_id := '${cA1}', p_side := 'debt', p_amount := 25`);
    expect(N((await gram(cA1)).d)).toBe(25);
    expect(N((await acc(A)).owes)).toBe(r4(43.6 + 25));
    D.g2 = await doc(mgr, `p_kind := 'customer_gram', p_customer_id := '${cB1}', p_side := 'advance', p_amount := 3`);
    expect(N((await gram(cB1)).a)).toBe(3);
    expect(N((await acc(B)).owes)).toBe(56);
    D.u1 = await doc(mgr, `p_kind := 'customer_currency', p_customer_id := '${cA2}', p_unit := 'UZS', p_side := 'debt', p_amount := 8600000, p_lom_rate := 860000`);
    expect(N(D.u1.seller_obligation_g)).toBe(10);
    expect([N((await cur(cA2, "UZS")).d), N((await acc(A)).owes)]).toEqual([8600000, r4(68.6 + 10)]);
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'customer_currency', p_customer_id := '${cA2}', p_unit := 'UZS', p_side := 'debt', p_amount := 1, p_lom_rate := 860000, p_idempotency_key := 'dup')`, "ERR_OPENING_DUPLICATE");
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'customer_currency', p_customer_id := '${cB1}', p_unit := 'USD', p_side := 'debt', p_amount := 100, p_lom_rate := 900000, p_idempotency_key := 'norate')`, "ERR_RATE_REQUIRED");
    D.d1 = await doc(mgr, `p_kind := 'customer_currency', p_customer_id := '${cB1}', p_unit := 'USD', p_side := 'debt', p_amount := 100, p_usd_rate := 12600, p_lom_rate := 900000`);
    expect(N(D.d1.seller_obligation_g)).toBe(r4((100 * 12600) / 900000)); // 1.4
    expect(N((await acc(B)).owes)).toBe(r4(56 + 1.4));
    D.d2 = await doc(mgr, `p_kind := 'customer_currency', p_customer_id := '${cA1}', p_unit := 'USD', p_side := 'advance', p_amount := 50`);
    expect([N((await cur(cA1, "USD")).a), N(D.d2.seller_obligation_g)]).toEqual([50, 0]);
    // the snapshot keeps the rates and the formula
    const row = await one(`SELECT usd_rate, lom_rate, formula, effective_t0, created_by FROM public.opening_documents WHERE id = '${D.d1.document_id}'`);
    expect([N(row.usd_rate), N(row.lom_rate), row.created_by]).toEqual([12600, 900000, mgr.employeeId]);
    expect(String(row.formula)).toContain("100");
  });

  it("O4 manager cash / LOM by proba / fine gold / other assets and liabilities (kept apart)", async () => {
    D.c1 = await doc(mgr, `p_kind := 'manager_cash', p_unit := 'UZS', p_amount := 5000000`);
    D.c2 = await doc(mgr, `p_kind := 'manager_cash', p_unit := 'USD', p_amount := 300`);
    D.sc = await doc(mgr, `p_kind := 'manager_scrap', p_physical_g := 10, p_proba := 750`);
    D.fg = await doc(mgr, `p_kind := 'manager_fine_gold', p_physical_g := 20, p_proba := 999`);
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'manager_scrap', p_physical_g := 1, p_proba := 50, p_idempotency_key := 'badproba')`, "Proba");
    const v = await vault();
    expect([N(v.c), N(v.u), N(v.sc), N(v.fg)]).toEqual([5000000, 300, r4((10 * 750) / 585), r4((20 * 999) / 585)]);
    D.ol = await doc(dir, `p_kind := 'other', p_side := 'liability', p_unit := 'USD', p_amount := 1000, p_usd_rate := 12600, p_lom_rate := 900000, p_other_type := 'qarz pul', p_counterparty := 'Investor X'`);
    D.oa = await doc(dir, `p_kind := 'other', p_side := 'asset', p_unit := 'G585', p_amount := 2, p_other_type := 'ustaxonada', p_counterparty := 'Usta Y'`);
    expect(N(D.ol.equiv_585_g)).toBe(14);
    // other items never touch factory / seller / customer balances
    expect([N((await vault()).fo), N((await acc(A)).owes), N((await acc(B)).owes)]).toEqual([177, 78.6, 57.4]);
  });

  it("O5 rights + isolation: a seller cannot enter openings; another organization neither sees nor cancels them; a seller reads only his own", async () => {
    await as(A);
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'manager_cash', p_unit := 'UZS', p_amount := 1, p_idempotency_key := 'seller-try')`, "Permission denied");
    const own = (await t.db.query<{ seller_id: string | null }>(`SELECT seller_id FROM public.opening_documents`)).rows;
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.seller_id === A.employeeId)).toBe(true);
    await as(dir2);
    expect((await t.db.query(`SELECT 1 FROM public.opening_documents`)).rows.length).toBe(0);
    await t.expectError(`SELECT public.rpc_cancel_opening_document('${D.c1.document_id}', 'x', 'x-org')`, "topilmadi");
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'customer_gram', p_customer_id := '${cA1}', p_side := 'debt', p_amount := 1, p_idempotency_key := 'x-org2')`, "ERR_NO_OPENING_PERIOD");
  });

  it("O6 cancel while in draft: exact reversal of each kind; dependent documents protect their source", async () => {
    await as(mgr);
    await t.expectError(`SELECT public.rpc_cancel_opening_document('${D.mi.document_id}', 'xato', 'c-mi')`, "Avval");
    await t.rpc(`public.rpc_cancel_opening_document('${D.d1.document_id}', 'xato kurs', 'c-d1')`);
    expect([N((await cur(cB1, "USD")).d), N((await acc(B)).owes)]).toEqual([0, 56]);
    await t.rpc(`public.rpc_cancel_opening_document('${D.sa.document_id}', 'qayta kiritiladi', 'c-sa')`);
    expect([await mgrStock(), N((await acc(A)).st), N((await acc(A)).owes)]).toEqual([100, 0, r4(78.6 - 33.6)]);
    D.sa = await doc(mgr, `p_kind := 'seller_inventory', p_seller_id := '${A.employeeId}', p_pieces := '[{"weight_grams":10},{"weight_grams":20}]'::jsonb, p_seller_markup_pct := 12, p_source_document_id := '${D.mi.document_id}'`);
    expect([await mgrStock(), N((await acc(A)).st), N((await acc(A)).owes)]).toEqual([70, 30, 78.6]);
    await t.rpc(`public.rpc_cancel_opening_document('${D.c2.document_id}', 'xato', 'c-c2')`);
    expect(N((await vault()).u)).toBe(0);
    D.c2 = await doc(mgr, `p_kind := 'manager_cash', p_unit := 'USD', p_amount := 300`);
    await t.expectError(`SELECT public.rpc_cancel_opening_document('${D.d1.document_id}', 'again', 'c-d1b')`, "allaqachon");
    const m = await effectsMatchAccounts();
    expect(m.effects).toEqual(m.accounts);
  });

  it("O7 reconciliation dashboard: documents = balances; seller tills empty; nothing else recorded since the restart", async () => {
    await as(mgr);
    const s = await t.rpc(`public.rpc_get_opening_state()`);
    expect((s.period as Record<string, unknown>).status).toBe("draft");
    expect(s.checks).toEqual({ seller_tills_empty: true, seller_stock_equals_held_pieces: true, customer_585_equals_documents: true,
      customer_uzs_equals_documents: true, customer_usd_equals_documents: true, inventory_equals_opening_receipts: true,
      factory_obligation_equals_documents: true, non_opening_documents_after_restart: 0 });
    // D-1: on hand (manager 70 + sellers 80) = opening receipts (100 manager + 50 seller-only); factory = 108 + 54 + 20 - 5
    const t0 = s.totals as Record<string, unknown>;
    expect([N(t0.opening_receipts_physical_g), N(t0.factory_obligation_from_goods_g), N(t0.factory_obligation_without_goods_g), N(t0.factory_advance_documents_g)]).toEqual([150, 162, 20, 5]);
    const tot = s.totals as Record<string, unknown>;
    expect([N(tot.manager_stock_g), N(tot.sellers_stock_g), N(tot.factory_obligation_g), N(tot.sellers_obligation_g)]).toEqual([70, 80, 177, r4(78.6 + 56)]);
  });

  it("L baseline: refused with a non-empty seller till (O-2); then locks the opening; net assets = oracle; result 0; locked documents", async () => {
    await q(`UPDATE public.seller_gold_accounts SET seller_till_cash_amount = 1 WHERE seller_id = '${A.employeeId}'`);
    await as(mgr);
    await t.expectError(`SELECT public.rpc_confirm_accounting_baseline(p_notes := 'T0', p_idempotency_key := 'b0', p_usd_rate := 12500)`, "ERR_OPENING_SELLER_TILL_NOT_EMPTY");
    await q(`UPDATE public.seller_gold_accounts SET seller_till_cash_amount = 0 WHERE seller_id = '${A.employeeId}'`);
    // the SERVER refuses an unreconciled opening (not only the UI button): an ordinary factory receipt in the draft
    await as(mgr);
    // D-4: an ordinary write in the draft is refused by the database itself
    await t.expectError(`SELECT public.rpc_record_factory_receipt(p_product_name := 'oddiy kirim', p_original_physical_g := 5, p_factory_markup_pct := 8, p_idempotency_key := 'stray-rc')`, "ERR_OPENING_DRAFT");
    // second line of defence: even if a row got in (simulated bypass by the table owner), the baseline refuses
    await ex(`BEGIN; SELECT set_config('goldia.opening_write', txid_current()::text, true);
      INSERT INTO public.factory_receipts (id, organization_id, receipt_no, product_name, original_physical_g, available_physical_g, proba, factory_markup_pct, factory_obligation_g, status)
      VALUES ('00000000-0000-0000-0000-00000000f085', '${org}', 'STRAY-085', 'stray', 5, 5, 585, 8, 5.4, 'in_manager_stock'); COMMIT;`);
    await as(mgr);
    await t.expectError(`SELECT public.rpc_confirm_accounting_baseline(p_notes := 'T0', p_idempotency_key := 'b-stray', p_usd_rate := 12500)`, "ERR_OPENING_NOT_RECONCILED");
    await ex(`BEGIN; SELECT set_config('goldia.opening_write', txid_current()::text, true);
      UPDATE public.factory_receipts SET status = 'reversed', reversed_at = now(), available_physical_g = 0 WHERE id = '00000000-0000-0000-0000-00000000f085'; COMMIT;`);
    await as(mgr);
    const b = await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'T0', p_idempotency_key := 'b1', p_usd_rate := 12500)`);
    const U = 12500;
    const assets = 70 + 80 + r4((10 * 750) / 585) + r4((20 * 999) / 585) + 25 + r4(5000000 / RATE) + r4((300 * U) / RATE)
      + r4(8600000 / RATE) + 2;
    const liabilities = 177 + 3 + r4((50 * U) / RATE) + 14;
    expect(Math.abs(N(b.net_assets_585_g) - r4(assets - liabilities))).toBeLessThan(0.0005);
    expect((await one(`SELECT status, baseline_id FROM public.opening_periods WHERE organization_id = '${org}' ORDER BY created_at DESC LIMIT 1`))).toEqual({ status: "locked", baseline_id: b.baseline_id });
    await as(mgr);
    const p = await t.rpc(`public.rpc_get_accounting_profit_summary(p_gold_rate := ${RATE}, p_usd_rate := ${U})`);
    expect(N(p.period_accounting_result_585_g)).toBe(0);
    expect([N((p.liabilities as Record<string, unknown>).other_opening_liabilities_585_g), N((p.assets as Record<string, unknown>).other_opening_assets_585_g)]).toEqual([14, 2]);
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'manager_cash', p_unit := 'UZS', p_amount := 1, p_idempotency_key := 'after-lock')`, "ERR_OPENING_LOCKED");
    await t.expectError(`SELECT public.rpc_cancel_opening_document('${D.c1.document_id}', 'x', 'after-lock-c')`, "ERR_OPENING_LOCKED");
  });

  it("T after opening: sale, currency payment (no new obligation), handover (closes), return; period engine = accounts; nothing revalued", async () => {
    const owes0 = N((await acc(A)).owes);
    await as(A);
    const s = await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${cA1}', p_weight_grams := 10, p_client_markup_pct := 15)`);
    expect([N((await acc(A)).st), N((await gram(cA1)).d)]).toEqual([20, r4(25 + 11.5)]);
    expect(N((await acc(A)).owes)).toBe(owes0); // a sale moves stock, it does not change the seller's obligation
    // the customer pays 860 000 so'm of the opening UZS debt: debt down, till up, NO new seller obligation
    await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cA2}', p_currency := 'UZS', p_cash_uzs := 860000, p_idempotency_key := 'p-uzs')`);
    expect([N((await cur(cA2, "UZS")).d), N((await acc(A)).c), N((await acc(A)).owes)]).toEqual([8600000 - 860000, 860000, owes0]);
    // handover of that money at 860 000 closes exactly 1 g of the obligation created at the opening snapshot
    await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${A.employeeId}', p_cash_paid_amount := 860000, p_rate_per_gram := 860000, p_idempotency_key := 'h-1')`);
    expect([N((await acc(A)).c), N((await acc(A)).owes)]).toEqual([0, r4(owes0 - 1)]);
    // a customer return after the opening
    await t.rpc(`public.rpc_record_sale_return(p_sale_id := '${s.sale_id}', p_weight_grams := 4, p_reason := 'vozvrat', p_destination := 'seller', p_idempotency_key := 'r-1')`);
    expect([N((await acc(A)).st), N((await gram(cA1)).d)]).toEqual([24, r4(36.5 - 4.6)]);
    // a later change of the official rate never revalues the opening obligation (snapshot)
    await q(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE + 1, 585, 1000000, 'UZS', true)`);
    await q(`SELECT public.recalc_seller_gold_account('${A.employeeId}', '${org}')`);
    expect(N((await acc(A)).owes)).toBe(r4(owes0 - 1));
    expect(N((await one(`SELECT seller_obligation_g v FROM public.opening_documents WHERE id = '${D.u1.document_id}'`)).v)).toBe(10);
    const m = await effectsMatchAccounts();
    expect(m.effects).toEqual(m.accounts);
  });

  it("X rollback 085 is refused while restarts / opening documents exist; postflight 085 all true", async () => {
    await t.asAdmin();
    const rb = fs.readFileSync("supabase/rollback/20260101000085_rollback.sql", "utf8");
    await t.expectError(rb.slice(0, rb.indexOf("end $g$;") + 8), "ROLLBACK 085 REFUSED");
    await t.db.exec(`CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text primary key);
                     INSERT INTO supabase_migrations.schema_migrations VALUES ('20260101000085') ON CONFLICT DO NOTHING;`);
    const body = fs.readFileSync("supabase/release/085_postflight_readonly.sql", "utf8").split(/\r?\n/)
      .filter((l) => !/^\s*--/.test(l) && !/^\s*(begin transaction read only|rollback);\s*$/i.test(l)).join("\n").trim().replace(/;\s*$/, "");
    const row = (await t.db.query<Record<string, boolean>>(body)).rows[0]!;
    expect(Object.entries(row).filter(([, v]) => v !== true)).toEqual([]);
  });

  it("UI source guards: restart page needs the typed confirmation + reason + T0 + backup; old test cleanup hidden outside staging", () => {
    const page = fs.readFileSync("src/components/sales/OpeningAccountingSection.tsx", "utf8");
    expect(page).toContain("MOLIYAVIY HISOBNI QAYTA BOSHLASH");
    expect(page).toMatch(/rpc_financial_restart/);
    expect(page).toMatch(/rpc_record_opening_document/);
    expect(page).toMatch(/rpc_cancel_opening_document/);
    expect(page).toMatch(/useState\(newKey\)|newKey\(\)/);
    const settings = fs.readFileSync("src/app/sales/app/settings/page.tsx", "utf8");
    expect(settings).toMatch(/isStagingMode|NEXT_PUBLIC_STAGING_MODE/);
  });
  void r2;
});
