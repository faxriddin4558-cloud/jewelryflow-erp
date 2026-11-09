import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb, pieceIdsArg, rpcRolledBack } from "./helpers/goldia-pglite";

// Migration 072: independent seller LOM / USD rates. Calls run as the `authenticated` role with RLS on.
// Every expected gram value is computed independently in the test (round to 4 decimals like the ledger).

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

describe("Goldia 072 — independent seller rates", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgId = "00000000-0000-0000-0000-0000000000f2";
  const OFFICIAL = 890000;
  type U = { userId: string; employeeId: string; customer: string };
  let director: { userId: string; employeeId: string };
  let manager: { userId: string; employeeId: string };
  let A: U, B: U, C: U;

  const newSeller = async (tag: string): Promise<U> => {
    const s = await t.addUser(orgId, `${tag}@goldia.uz`, tag, "sales");
    await t.asAdmin();
    const c = (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${orgId}', 'C-${tag}', 'Mijoz ${tag}', '+998900000000', '${s.employeeId}') RETURNING id`)).rows[0]!.id;
    return { ...s, customer: c };
  };
  const consignAndSell = async (s: U, grams: number) => {
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${s.employeeId}', p_factory_markup_pct := 8,
      p_pieces := '[{"weight_grams":100,"model_code":"M"}]'::jsonb, p_notes := 'r', p_seller_markup_pct := 12)`);
    await t.asAdmin();
    const ids = await pieceIdsArg(t.db, s.employeeId, grams);
    await t.asUser(s.userId);
    await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${s.customer}', p_weight_grams := ${grams}, p_client_markup_pct := 15, ${ids})`);
  };
  const setRates = async (s: { userId: string }, lom: number | null, usd: number | null) => {
    await t.asUser(s.userId);
    return t.rpc(`public.rpc_set_my_seller_rates(p_lom_rate_uzs := ${lom ?? "null"}, p_usd_rate_uzs := ${usd ?? "null"}, p_reason := 'test')`);
  };
  const pay = async (s: U, args: string) => {
    await t.asUser(s.userId);
    return t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${s.customer}', ${args})`);
  };
  const debt = async (s: U) => {
    await t.asAdmin();
    return t.scalar(`(SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${s.customer}')`);
  };
  const acc = async (s: U) => {
    await t.asAdmin();
    return (await t.db.query<Record<string, string>>(`SELECT * FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`)).rows[0]!;
  };
  const balances = async () => {
    await t.asAdmin();
    return (await t.db.query<{ v: string }>(`SELECT
      (SELECT string_agg(seller_id || ':' || seller_owes_manager_g || ':' || seller_till_cash_amount || ':' || seller_till_usd_amount, ',' ORDER BY seller_id) FROM public.seller_gold_accounts) || '|' ||
      (SELECT string_agg(customer_id || ':' || current_debt_grams || ':' || advance_balance_grams, ',' ORDER BY customer_id) FROM public.client_gold_accounts) || '|' ||
      (SELECT string_agg(id || ':' || gold_rate_applied || ':' || cash_equivalent_grams || ':' || usd_equivalent_grams || ':' || status, ',' ORDER BY id) FROM public.gold_settlements) AS v`)).rows[0]!.v;
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${orgId}', 'goldia-072', 'Goldia 072', 'ACTIVE')`);
    director = await t.addUser(orgId, "dir072@goldia.uz", "Direktor", "director");
    manager = await t.addUser(orgId, "mgr072@goldia.uz", "Menejer", "manager");
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed)
                     VALUES ('${orgId}', CURRENT_DATE, 585, ${OFFICIAL}, 'UZS', true);
      INSERT INTO public.factory_receipts (organization_id, receipt_no, product_name, original_physical_g, available_physical_g, proba,
        factory_markup_pct, factory_obligation_g, status)
      VALUES ('${orgId}', 'ZVD-072', 'Partiya 072', 3000, 3000, 585, 8, 3240, 'in_manager_stock')`);
    A = await newSeller("sa072");
    B = await newSeller("sb072");
    C = await newSeller("sc072");
    await consignAndSell(A, 40); // customer A owes 40 * 1.15 = 46 g
    await consignAndSell(B, 40);
    await consignAndSell(C, 40);
  });

  it("O: the production postflight is all true right after the migration (nothing valued, no rate set)", async () => {
    await t.asAdmin();
    const fs = await import("fs");
    const body = fs.readFileSync("supabase/release/072_postflight_readonly.sql", "utf8").split(/\r?\n/)
      .filter((l) => !/^\s*--/.test(l) && !/^\s*(begin transaction read only|rollback);\s*$/i.test(l)).join("\n").trim().replace(/;\s*$/, "");
    const row = (await t.db.query<Record<string, boolean>>(body)).rows[0]!;
    expect(Object.entries(row).filter(([, v]) => v !== true)).toEqual([]);
    expect(Object.keys(row).length).toBe(10);
  });

  it("A/B: two sellers keep independent rates; changing A never touches B", async () => {
    await setRates(A, 890000, 12500);
    await setRates(B, 900000, 12700);
    await t.asUser(A.userId);
    let r = await t.rpc(`public.rpc_get_seller_rates()`);
    let rows = r.sellers as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.seller_id).toBe(A.employeeId);
    expect([Number(rows[0]!.lom_rate_uzs), Number(rows[0]!.usd_rate_uzs)]).toEqual([890000, 12500]);

    await setRates(A, 880000, null); // USD kept
    await t.asUser(B.userId);
    r = await t.rpc(`public.rpc_get_seller_rates()`);
    rows = r.sellers as Record<string, unknown>[];
    expect([rows[0]!.seller_id, Number(rows[0]!.lom_rate_uzs), Number(rows[0]!.usd_rate_uzs)]).toEqual([B.employeeId, 900000, 12700]);

    // Management sees every seller; history records old -> new with seller and time
    for (const u of [director, manager]) {
      await t.asUser(u.userId);
      const all = await t.rpc(`public.rpc_get_seller_rates()`);
      const map = Object.fromEntries((all.sellers as Record<string, unknown>[]).map((x) => [x.seller_id, [Number(x.lom_rate_uzs), Number(x.usd_rate_uzs)]]));
      expect(map[A.employeeId]).toEqual([880000, 12500]);
      expect(map[B.employeeId]).toEqual([900000, 12700]);
    }
    await t.asAdmin();
    const h = (await t.db.query<Record<string, string>>(`SELECT * FROM public.seller_rate_history WHERE seller_id = '${A.employeeId}' ORDER BY changed_at, id`)).rows;
    expect(h.length).toBe(2);
    expect([h[1]!.old_lom_rate_uzs, h[1]!.new_lom_rate_uzs, h[1]!.old_usd_rate_uzs, h[1]!.new_usd_rate_uzs].map(Number)).toEqual([890000, 880000, 12500, 12500]);
    expect(h[1]!.changed_by).toBe(A.employeeId);
    expect(h[1]!.changed_at).toBeTruthy();
    expect(await t.scalar(`(SELECT count(*) FROM public.audit_logs WHERE action = 'SET_SELLER_RATES' AND record_id = '${A.employeeId}')`)).toBe(2);
  });

  it("C/D: a cash payment uses the seller's own rate and stays an immutable snapshot after the rate changes", async () => {
    const cash = 1760000;
    const expected = r4(cash / 880000); // 2.0000 g
    const before = await debt(A);
    const res = await pay(A, `p_cash_amount := ${cash}`);
    expect(Number(res.rate_applied)).toBe(880000);
    expect(Number(res.cash_equivalent_grams)).toBe(expected);
    expect(await debt(A)).toBe(r4(before - expected));

    // B pays at B's rate
    const resB = await pay(B, `p_cash_amount := 1800000`);
    expect(Number(resB.rate_applied)).toBe(900000);
    expect(Number(resB.cash_equivalent_grams)).toBe(r4(1800000 / 900000));

    // Rate change: no debt or snapshot moves
    const snap = await balances();
    await setRates(A, 890000, null);
    expect(await balances()).toBe(snap);
    await t.asAdmin();
    expect(await t.scalar(`(SELECT gold_rate_applied FROM public.gold_settlements WHERE id = '${res.settlement_id}')`)).toBe(880000);
  });

  it("E: USD is converted with the captured seller USD and LOM rates", async () => {
    const res = await pay(A, `p_usd_amount := 100`);
    expect(Number(res.usd_rate_applied)).toBe(12500);
    expect(Number(res.rate_applied)).toBe(890000);
    expect(Number(res.usd_equivalent_grams)).toBe(r4((100 * 12500) / 890000)); // 1.4045
  });

  it("I: browser rates are checked, never trusted; invalid and cross-seller changes are rejected", async () => {
    await t.asUser(A.userId);
    // 084: the saved rate is only the default; a rate the seller enters for this payment is used (inside the limits and
    // the deviation rule) and snapshotted. Was ERR_RATE_MISMATCH before 084. Checked in a rolled-back transaction.
    const own = await rpcRolledBack(t.db, `public.rpc_record_client_settlement(p_customer_id := '${A.customer}', p_cash_amount := 950000, p_rate_per_gram := 950000)`);
    expect(Number(own.rate_applied)).toBe(950000);
    expect(Number(own.cash_equivalent_grams)).toBe(1);
    const ownUsd = await rpcRolledBack(t.db, `public.rpc_record_client_settlement(p_customer_id := '${A.customer}', p_usd_amount := 10, p_usd_rate := 13000)`);
    expect(Number(ownUsd.usd_rate_applied)).toBe(13000);
    await t.expectError(`SELECT public.rpc_record_client_settlement(p_customer_id := '${A.customer}', p_cash_amount := 100000, p_rate_per_gram := 1)`, "ERR_RATE_OUT_OF_RANGE");
    // No own USD rate: no rate entered -> refused (nothing is guessed); an entered rate is used (084, was ERR_USD_RATE_NOT_SET).
    // No own LOM rate -> official rate is the default.
    await t.asUser(C.userId);
    await t.expectError(`SELECT public.rpc_record_client_settlement(p_customer_id := '${C.customer}', p_usd_amount := 10)`, "ERR_RATE_REQUIRED");
    const typedUsd = await rpcRolledBack(t.db, `public.rpc_record_client_settlement(p_customer_id := '${C.customer}', p_usd_amount := 10, p_usd_rate := 12600)`);
    expect(Number(typedUsd.usd_rate_applied)).toBe(12600);
    const rc = await pay(C, `p_cash_amount := ${OFFICIAL}`);
    expect(Number(rc.rate_applied)).toBe(OFFICIAL);
    expect(Number(rc.cash_equivalent_grams)).toBe(1);

    await t.asUser(A.userId);
    for (const bad of ["'NaN'::numeric", "'Infinity'::numeric", "0", "-5", "50000", "9000000"]) {
      await t.expectError(`SELECT public.rpc_set_my_seller_rates(p_lom_rate_uzs := ${bad})`, "ERR_RATE_");
    }
    await t.expectError(`SELECT public.rpc_set_my_seller_rates(p_lom_rate_uzs := 600000)`, "foizdan"); // > 25 % below official
    await t.expectError(`SELECT public.rpc_set_my_seller_rates(p_usd_rate_uzs := 100)`, "ERR_RATE_OUT_OF_RANGE");
    await t.expectError(`SELECT public.rpc_set_my_seller_rates()`, "ERR_RATE_INVALID");
    // Cross-seller: no parameter to name another seller; reads of B are refused; direct table writes are refused
    await t.expectError(`SELECT public.rpc_get_seller_rates('${B.employeeId}')`, "Ruxsat etilmadi");
    expect((await t.db.query(`SELECT 1 FROM public.seller_rates WHERE seller_id = '${B.employeeId}'`)).rows.length).toBe(0);
    expect((await t.db.query(`SELECT 1 FROM public.seller_rate_history WHERE seller_id = '${B.employeeId}'`)).rows.length).toBe(0);
    await t.expectError(`UPDATE public.seller_rates SET lom_rate_uzs = 1 WHERE seller_id = '${A.employeeId}'`, "permission denied");
    await t.expectError(`INSERT INTO public.seller_rates (seller_id, organization_id, lom_rate_uzs) VALUES ('${B.employeeId}', '${orgId}', 1)`, "permission denied");
    await t.expectError(`INSERT INTO public.seller_rate_history (organization_id, seller_id) VALUES ('${orgId}', '${A.employeeId}')`, "permission denied");
    await t.expectError(`UPDATE public.seller_gold_accounts SET till_valued_cash_585_g = 999 WHERE seller_id = '${A.employeeId}'`, "permission denied");
    // Company official rate and limits stay management-only
    await t.expectError(`SELECT public.rpc_set_daily_gold_rate(700000)`, "ermission denied");
    await t.expectError(`SELECT public.rpc_set_seller_rate_limits(1, 2, 3, 4, 5)`, "ermission denied");
    // Management cannot set a seller's rate through the seller RPC
    await t.asUser(manager.userId);
    await t.expectError(`SELECT public.rpc_set_my_seller_rates(p_lom_rate_uzs := 890000)`, "ermission denied");
    // Anonymous
    await t.db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE anon;`);
    await t.expectError(`SELECT public.rpc_get_seller_rates()`, "permission denied for function");
    await t.expectError(`SELECT public.rpc_set_my_seller_rates(p_lom_rate_uzs := 890000)`, "permission denied for function");
    await t.asAdmin();
    expect(await t.scalar(`(SELECT lom_rate_uzs FROM public.seller_rates WHERE seller_id = '${A.employeeId}')`)).toBe(890000);
  });

  it("F: partial payments and a reversal restore debt, till and the valued pool exactly", async () => {
    const d0 = await debt(A);
    const a0 = await acc(A);
    const p1 = await pay(A, `p_cash_amount := 445000, p_idempotency_key := 'f-p1'`); // 0.5 g at 890,000
    expect(Number(p1.cash_equivalent_grams)).toBe(0.5);
    // retry after a rate change returns the original snapshot, not a second payment
    await setRates(A, 900000, null);
    const retry = await pay(A, `p_cash_amount := 445000, p_idempotency_key := 'f-p1'`);
    expect(retry.settlement_id).toBe(p1.settlement_id);
    expect(Number(retry.rate_applied)).toBe(890000);
    const p2 = await pay(A, `p_cash_amount := 450000`); // 0.5 g at 900,000
    expect(Number(p2.cash_equivalent_grams)).toBe(0.5);
    expect(await debt(A)).toBe(r4(d0 - 1));

    await t.asUser(director.userId);
    await t.rpc(`public.rpc_reverse_client_settlement('${p1.settlement_id}', 'xato', null)`);
    expect(await debt(A)).toBe(r4(d0 - 0.5));
    const a1 = await acc(A);
    expect(Number(a1.seller_till_cash_amount)).toBe(Number(a0.seller_till_cash_amount) + 450000);
    expect(Number(a1.till_valued_cash_uzs)).toBe(Number(a0.till_valued_cash_uzs) + 450000);
    expect(Number(a1.till_valued_cash_585_g)).toBeCloseTo(Number(a0.till_valued_cash_585_g) + 0.5, 6);
    await setRates(A, 890000, null);
  });

  it("G/H: the handover closes exactly the captured grams even after a rate change; the company difference is counted once", async () => {
    const a0 = await acc(A);
    const pooledCash = Number(a0.till_valued_cash_uzs);
    const pooledG = Number(a0.till_valued_cash_585_g);
    const pooledUsd = Number(a0.till_valued_usd);
    const pooledUsdG = Number(a0.till_valued_usd_585_g);
    expect(pooledCash).toBe(Number(a0.seller_till_cash_amount)); // all of A's till was collected after 072
    // 1,760,000 @ 880,000 (2 g) + 450,000 @ 900,000 (0.5 g) = 2.5 g; 100 USD = 1.4045 g
    expect(pooledCash).toBe(2210000);
    expect(r4(pooledG)).toBe(2.5);
    expect(r4(pooledUsdG)).toBe(1.4045);
    expect(pooledUsd).toBe(100);

    // A lowers the rate (an attempt to close more grams with the same cash): the handover ignores it
    await setRates(A, 800000, null);
    const owes0 = Number(a0.seller_owes_manager_g);
    const custDebt = await debt(A);
    const vault0 = await (async () => { await t.asAdmin(); return (await t.db.query<Record<string, string>>(`SELECT * FROM public.manager_vault_account WHERE organization_id = '${orgId}'`)).rows[0]; })();

    // partial handover: half the cash -> half the captured grams (average of the pool)
    await t.asUser(A.userId);
    const h1 = await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${A.employeeId}', p_cash_paid_amount := 1105000)`);
    expect(Number(h1.cash_equivalent_grams)).toBe(r4((pooledG * 1105000) / pooledCash)); // 1.25
    const h2 = await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${A.employeeId}', p_cash_paid_amount := 1105000, p_usd_paid_amount := 100)`);
    expect(Number(h2.cash_equivalent_grams)).toBe(1.25);
    expect(Number(h2.usd_equivalent_grams)).toBe(1.4045);
    const a1 = await acc(A);
    expect(r4(owes0 - Number(a1.seller_owes_manager_g))).toBe(r4(2.5 + 1.4045)); // exactly the captured grams
    expect(Number(a1.till_valued_cash_uzs)).toBe(0);
    expect(Number(a1.till_valued_usd)).toBe(0);
    expect(await debt(A)).toBe(custDebt); // the customer is not touched by a handover
    await t.asAdmin();
    const vault1 = (await t.db.query<Record<string, string>>(`SELECT * FROM public.manager_vault_account WHERE organization_id = '${orgId}'`)).rows[0]!;
    expect(r4(Number(vault1.valued_cash_585_g) - Number(vault0?.valued_cash_585_g ?? 0))).toBe(2.5);

    // H: the manager buys gold with that cash at 850,000 UZS/g -> 2.6 g bought for 2.5 g of value: +0.1 g difference
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_record_gold_purchase(p_supplier_name := 'Bozor', p_cash_spent_uzs := 2210000, p_rate_per_gram := 850000,
      p_gold_weight_grams := 2.6, p_idempotency_key := 'g072-1')`);
    const rep = await t.rpc(`public.rpc_get_company_rate_difference_report()`);
    const e = (rep.entries as Record<string, unknown>[])[0]!;
    expect(Number(e.accounting_value_585_g)).toBe(2.5);
    expect(Number(e.difference_585_g)).toBe(0.1);
    // counted once: seller obligation and customer debt unchanged by the purchase
    expect(Number((await acc(A)).seller_owes_manager_g)).toBe(Number(a1.seller_owes_manager_g));
    expect(await debt(A)).toBe(custDebt);
    await setRates(A, 890000, null);
  });

  it("G: reversing a handover puts the cash and its captured grams back in the pool", async () => {
    await pay(A, `p_cash_amount := 890000`); // 1 g
    await t.asUser(A.userId);
    const h = await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${A.employeeId}', p_cash_paid_amount := 890000)`);
    const owesAfter = Number((await acc(A)).seller_owes_manager_g);
    await t.asUser(director.userId);
    await t.rpc(`public.rpc_reverse_seller_to_manager_settlement('${h.settlement_id}', 'xato', null)`);
    const a = await acc(A);
    expect(Number(a.till_valued_cash_uzs)).toBe(890000);
    expect(r4(Number(a.till_valued_cash_585_g))).toBe(1);
    expect(r4(Number(a.seller_owes_manager_g) - owesAfter)).toBe(1);
  });

  it("legacy till cash (before 072): official rate is the default, a seller-entered handover rate is used (084)", async () => {
    // Simulate cash already in C's till before 072 (no captured value)
    await t.asAdmin();
    await t.db.exec(`UPDATE public.seller_gold_accounts SET seller_till_cash_amount = seller_till_cash_amount + 890000 WHERE seller_id = '${C.employeeId}'`);
    const c0 = await acc(C);
    expect(Number(c0.till_valued_cash_uzs)).toBe(OFFICIAL); // only C's post-072 payment above
    await t.asUser(C.userId);
    // 084: was ERR_RATE_MISMATCH; the entered rate now values only the legacy (unvalued) part: 1 g + 890,000 / 800,000
    const typed = await rpcRolledBack(t.db, `public.rpc_record_seller_to_manager_settlement(p_seller_id := '${C.employeeId}', p_cash_paid_amount := 1780000, p_rate_per_gram := 800000)`);
    expect(Number(typed.cash_equivalent_grams)).toBe(r4(1 + 890000 / 800000));
    const h = await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${C.employeeId}', p_cash_paid_amount := 1780000)`);
    expect(Number(h.cash_equivalent_grams)).toBe(2); // 1 g captured + 890,000 / official 890,000
  });

  it("M: management entries keep their pre-072 behaviour", async () => {
    await t.asUser(manager.userId);
    const r = await t.rpc(`public.rpc_record_client_settlement(p_customer_id := '${B.customer}', p_cash_amount := 870000, p_rate_per_gram := 870000)`);
    expect(Number(r.rate_applied)).toBe(870000);
    expect(Number(r.cash_equivalent_grams)).toBe(1);
    const lim = await t.rpc(`public.rpc_set_seller_rate_limits(100000, 3000000, 5000, 30000, 30)`);
    expect(lim.status).toBe("ok");
  });
});
