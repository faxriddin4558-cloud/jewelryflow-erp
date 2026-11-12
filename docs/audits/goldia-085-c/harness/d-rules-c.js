// PHASE D on STAGING, org C only: the 085 final rules D-4 / D-6 / D-2 (UZS, USD + reversal) / D-3 / D-1 through the users'
// real JWTs (the UI path). Same oracle as src/lib/__tests__/goldia-085-final-rules.test.ts. Starts in the draft opening that
// OP-10 left in C. Prints ids / numbers only.
const fs = require('fs');
const L = require('./lib');
const r4 = (x) => Math.round(x * 1e4) / 1e4; const N = (x) => Number(x || 0);
const R = []; const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 260)}`); };
(async () => {
  const C = L.creds(); const run = Date.now().toString(36); let kn = 0; const key = (p) => `dr-${run}-${p}-${++kn}`;
  const S = C.sellera.id; const RATE = 900000;
  const must = (r, n) => { if (!r.ok) throw new Error(`${n}: ${r.status} ${r.error}`); return r.data; };
  const owes = async () => N((await L.sel(`seller_gold_accounts?seller_id=eq.${S}&select=v:seller_owes_manager_g`))[0].v);
  const cur = async (c, k) => (await L.sel(`client_currency_accounts?customer_id=eq.${c}&currency=eq.${k}&select=d:debt_amount,a:advance_amount`))[0] || { d: 0, a: 0 };
  const vault = async () => (await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=g:manager_refined_gold_grams,f:manager_refined_gold_fine_grams,fo:current_factory_obligation_g`))[0];
  const draft = (await L.sel(`opening_periods?organization_id=eq.${L.ORG}&status=eq.draft&select=id`)).length;
  if (draft !== 1) throw new Error('expected exactly one draft opening in C, found ' + draft);
  const cust = async (n) => must(await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `DR85 ${n} ${run}` }), 'customer').customer_id;
  const cUzs = await cust('U1'); const cUsd = await cust('U2'); const cAdv = await cust('U3'); const cG = await cust('U4');
  const doc = async (a) => must(await L.rpc('manager', 'rpc_record_opening_document', { ...a, p_idempotency_key: key('d') }), 'opening ' + a.p_kind);
  const mi = (await doc({ p_kind: 'manager_inventory', p_physical_g: 100, p_factory_markup_pct: 8 })).document_id;
  await doc({ p_kind: 'seller_inventory', p_seller_id: S, p_pieces: [{ weight_grams: 20 }, { weight_grams: 30 }], p_seller_markup_pct: 12, p_source_document_id: mi });
  await doc({ p_kind: 'customer_currency', p_customer_id: cUzs, p_unit: 'UZS', p_side: 'debt', p_amount: 8600000, p_lom_rate: 860000 });
  await doc({ p_kind: 'customer_currency', p_customer_id: cUsd, p_unit: 'USD', p_side: 'debt', p_amount: 100, p_usd_rate: 12600, p_lom_rate: 900000 });
  await doc({ p_kind: 'manager_fine_gold', p_physical_g: 20, p_proba: 999 });

  // D-4
  const tries = [
    ['sellera', 'rpc_record_weight_sale', { p_customer_id: cG, p_weight_grams: 1, p_client_markup_pct: 10 }],
    ['sellera', 'rpc_record_currency_sale', { p_customer_id: cG, p_currency: 'USD', p_amount: 10, p_weight_grams: 1, p_idempotency_key: key('x') }],
    ['sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cUzs, p_currency: 'UZS', p_cash_uzs: 1000, p_idempotency_key: key('x') }],
    ['sellera', 'rpc_record_client_legacy_debt', { p_customer_id: cG, p_balance_type: 'debt', p_amount_585_g: 1, p_as_of_date: L.tashkentToday() }],
    ['manager', 'rpc_record_client_settlement', { p_customer_id: cG, p_cash_amount: 900000, p_rate_per_gram: 900000 }],
    ['manager', 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 1000, p_currency: 'UZS', p_gold_rate: 900000, p_idempotency_key: key('x') }],
    ['manager', 'rpc_record_factory_receipt', { p_product_name: 'x', p_original_physical_g: 1, p_factory_markup_pct: 8, p_idempotency_key: key('x') }],
    ['director', 'rpc_issue_barcode_consignment', { p_seller_id: S, p_factory_markup_pct: 8, p_pieces: [{ weight_grams: 1 }], p_seller_markup_pct: 12, p_idempotency_key: key('x') }],
    ['director', 'rpc_record_factory_gold_handover', { p_source_type: 'refined_gold', p_physical_weight_g: 1, p_proba: 999, p_agreed_equivalent_g: 1, p_idempotency_key: key('x') }],
  ];
  const res = []; for (const [u, f, a] of tries) res.push(await L.rpc(u, f, a));
  const reset = await L.rpc('director', 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'x' });
  const scrap = await L.rpc('manager', 'rpc_record_opening_document', { p_kind: 'manager_scrap', p_physical_g: 10, p_proba: 750, p_idempotency_key: key('d') });
  const st = must(await L.rpc('manager', 'rpc_get_opening_state', {}), 'state');
  T('D-4', 'draft: 9 ordinary writes (seller / manager / director) refused ERR_OPENING_DRAFT, old reset ERR_USE_FINANCIAL_RESTART, opening documents still work, no other document',
    res.every((r) => !r.ok && /ERR_OPENING_DRAFT/.test(r.error)) && !reset.ok && /ERR_USE_FINANCIAL_RESTART/.test(reset.error) && scrap.ok && st.checks.non_opening_documents_after_restart === 0,
    { refused: 9, reset: 'ERR_USE_FINANCIAL_RESTART', scrap: 'ok', other: 0 }, { refused: res.filter((r) => !r.ok && /ERR_OPENING_DRAFT/.test(r.error)).length, reset: reset.error && reset.error.slice(0, 40), scrap: scrap.ok, other: st.checks.non_opening_documents_after_restart, errs: [...new Set(res.map((r) => (r.error || 'OK').slice(0, 30)))] });

  // D-6
  const v = await vault();
  const lock = await L.rpc('manager', 'rpc_confirm_accounting_baseline', { p_notes: 'T0 PHASE D', p_idempotency_key: key('b'), p_usd_rate: 12500 });
  const f0 = N((await vault()).fo);
  const fh = await L.rpc('manager', 'rpc_record_factory_gold_handover', { p_source_type: 'refined_gold', p_physical_weight_g: 10, p_proba: 999, p_agreed_equivalent_g: r4((10 * 999) / 585), p_idempotency_key: key('fh') });
  const v2 = await vault();
  T('D-6', 'opening fine gold 20 g @999 = 34.1538 g (585) / 19.98 g fine; after the baseline lock a 10 g @999 factory payment lowers refined gold and factory obligation by 17.0769 g',
    N(v.g) === r4((20 * 999) / 585) && N(v.f) === r4((20 * 999) / 1000) && lock.ok && fh.ok && N(v2.g) === r4(r4((20 * 999) / 585) - r4((10 * 999) / 585)) && N(v2.fo) === r4(f0 - r4((10 * 999) / 585)),
    { g: r4((20 * 999) / 585), f: 19.98, g_after: r4(r4((20 * 999) / 585) - r4((10 * 999) / 585)), fo_after: r4(f0 - r4((10 * 999) / 585)) }, { g: v.g, f: v.f, lock: lock.ok || lock.error, fh: fh.ok || fh.error, g_after: v2.g, fo_after: v2.fo });

  // D-2 UZS + handover reversal
  {
    const o0 = await owes();
    const p = must(await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cUzs, p_currency: 'UZS', p_cash_uzs: 8600000, p_idempotency_key: key('p1') }), 'uzs pay');
    const afterPay = await owes(); const debt = N((await cur(cUzs, 'UZS')).d);
    const h = must(await L.rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: S, p_cash_paid_amount: 8600000, p_rate_per_gram: 900000, p_idempotency_key: key('h1') }), 'handover');
    const d1 = r4(o0 - (await owes()));
    const ps = must(await L.rpc('manager', 'rpc_get_accounting_profit_summary', { p_gold_rate: RATE, p_usd_rate: 12500 }), 'ps');
    const rv = await L.rpc('manager', 'rpc_reverse_seller_to_manager_settlement', { p_settlement_id: h.settlement_id, p_reason: 'sinov', p_idempotency_key: null });
    const afterRev = await owes();
    const ps2 = must(await L.rpc('manager', 'rpc_get_accounting_profit_summary', { p_gold_rate: RATE, p_usd_rate: 12500 }), 'ps2');
    must(await L.rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: S, p_cash_paid_amount: 8600000, p_rate_per_gram: 900000, p_idempotency_key: key('h1b') }), 'handover again');
    const d2 = r4(o0 - (await owes())); const diff = r4(10 - 8600000 / 900000);
    T('D-2 UZS', 'opening debt 8 600 000 @860 000 (10 g) paid: snapshot 10 g, debt 0, obligation untouched; handover at 900 000 -> obligation -10 g, company difference 0.4444 g; reversal restores both exactly; redo -10 g once',
      N(p.opening_snapshot_585_g) === 10 && debt === 0 && afterPay === o0 && d1 === 10 && N(h.company_rate_difference_585_g) === diff && N(ps.company_rate_difference_585_g) === diff && rv.ok && afterRev === o0 && N(ps2.company_rate_difference_585_g) === 0 && d2 === 10,
      { snap: 10, debt: 0, d1: 10, diff, afterRev: o0, diff2: 0, d2: 10 }, { snap: p.opening_snapshot_585_g, debt, d1, diff: h.company_rate_difference_585_g, ps: ps.company_rate_difference_585_g, rev: rv.ok || rv.error, afterRev, diff2: ps2.company_rate_difference_585_g, d2 });
  }
  // D-2 USD + payment reversal
  {
    const o0 = await owes();
    const p = must(await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cUsd, p_currency: 'USD', p_usd_amount: 100, p_idempotency_key: key('p2') }), 'usd pay');
    const rv = await L.rpc('manager', 'rpc_reverse_client_currency_settlement', { p_settlement_id: p.settlement_id, p_reason: 'xato', p_idempotency_key: key('p2r') });
    const pool = (await L.sel(`seller_gold_accounts?seller_id=eq.${S}&select=u:till_valued_usd,g:till_valued_usd_585_g,t:seller_till_usd_amount`))[0];
    const debt = N((await cur(cUsd, 'USD')).d);
    must(await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cUsd, p_currency: 'USD', p_usd_amount: 100, p_idempotency_key: key('p3') }), 'usd pay 2');
    const h = must(await L.rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: S, p_usd_paid_amount: 100, p_usd_rate: 12500, p_rate_per_gram: 900000, p_idempotency_key: key('h2') }), 'usd handover');
    const d = r4(o0 - (await owes())); const diff = r4(1.4 - (100 * 12500) / 900000);
    T('D-2 USD', '100 USD opening debt (12 600 / 900 000 = 1.4 g): reversed payment takes its pool share with it (pool 0, till 0, debt 100); paid again + handover at 12 500 -> obligation -1.4 g, difference 0.0111 g',
      N(p.opening_snapshot_585_g) === 1.4 && rv.ok && N(pool.u) === 0 && N(pool.g) === 0 && N(pool.t) === 0 && debt === 100 && d === 1.4 && N(h.company_rate_difference_585_g) === diff,
      { snap: 1.4, pool: [0, 0, 0], debt: 100, d: 1.4, diff }, { snap: p.opening_snapshot_585_g, rev: rv.ok || rv.error, pool: [pool.u, pool.g, pool.t], debt, d, diff: h.company_rate_difference_585_g });
  }
  // D-3
  {
    const before = must(await L.rpc('manager', 'rpc_get_accounting_profit_summary', { p_gold_rate: RATE, p_usd_rate: 12500 }), 'ps');
    const o0 = await owes();
    must(await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cAdv, p_currency: 'USD', p_usd_amount: 50, p_idempotency_key: key('a1') }), 'advance');
    const adv = N((await cur(cAdv, 'USD')).a); const o1 = await owes();
    const mid = must(await L.rpc('manager', 'rpc_get_accounting_profit_summary', { p_gold_rate: RATE, p_usd_rate: 12500 }), 'ps');
    must(await L.rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: S, p_usd_paid_amount: 50, p_usd_rate: 12500, p_rate_per_gram: 900000, p_idempotency_key: key('a2') }), 'adv handover');
    const o2 = await owes();
    const after = must(await L.rpc('manager', 'rpc_get_accounting_profit_summary', { p_gold_rate: RATE, p_usd_rate: 12500 }), 'ps');
    T('D-3', 'USD 50 advance: no obligation change at payment or handover; accounting result unchanged; liability = 50 x 12 500 / 900 000 g',
      adv === 50 && o1 === o0 && o2 === o0 && N(mid.period_accounting_result_585_g) === N(before.period_accounting_result_585_g) && N(after.period_accounting_result_585_g) === N(before.period_accounting_result_585_g)
        && N(after.liabilities.customer_usd_advance_585_eq_g) === r4((50 * 12500) / RATE),
      { adv: 50, owes: o0, result: N(before.period_accounting_result_585_g), liability: r4((50 * 12500) / RATE) }, { adv, o1, o2, mid: mid.period_accounting_result_585_g, after: after.period_accounting_result_585_g, liability: after.liabilities.customer_usd_advance_585_eq_g });
  }
  // D-1
  const fo = N((await vault()).fo);
  T('D-1', 'factory obligation = 100 g @8 % = 108 minus the factory payment only (manager -> seller transfer and all customer flows did not touch it)', fo === r4(108 - r4((10 * 999) / 585)), r4(108 - r4((10 * 999) / 585)), fo);
  fs.writeFileSync('/home/user/jewelryflow-erp/docs/audits/goldia-077/evidence/staging-085/opening/staging-c-d-rules.json', JSON.stringify({ run, results: R }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
