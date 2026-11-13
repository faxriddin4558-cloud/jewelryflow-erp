// PHASE F3 step 1 on STAGING, org D only: real "old" history through the users' own JWTs (gram / UZS / USD debts, two
// sellers, factory receipt + consignments), then the 086 FREEZE by the service role (= release tooling) while 20 parallel
// ordinary writes run, then every bypass attempt. Ends FROZEN, waiting for the owner's backup (--backup-only --verify-org).
// Prints ids / numbers / error codes only (no secrets).
const fs = require('fs');
const L = require('./lib');
const N = (x) => Number(x || 0); const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
const R = []; const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// org D fingerprint over the business tables (derived updated_at ignored)
const FP_TABLES = ['client_gold_accounts', 'client_currency_accounts', 'seller_gold_accounts', 'manager_vault_account', 'customers', 'jewelry_sales', 'jewelry_sale_returns',
  'gold_settlements', 'client_currency_settlements', 'client_legacy_debts', 'seller_consignments', 'consignment_pieces', 'factory_receipts', 'factory_gold_handovers',
  'refining_batches', 'financial_transactions', 'gold_purchases', 'accounting_baselines', 'opening_periods', 'opening_documents', 'financial_restarts'];
async function fpD() {
  const parts = [];
  for (const t of FP_TABLES) {
    const rows = await L.sel(`${t}?organization_id=eq.${L.ORG}&select=*`);
    parts.push(t + ':' + rows.length + ':' + rows.map((r) => { const c = { ...r }; delete c.updated_at; return JSON.stringify(c, Object.keys(c).sort()); }).sort().join('|'));
  }
  return require('crypto').createHash('sha256').update(parts.join('\n')).digest('hex');
}
(async () => {
  const C = L.creds(); const run = Date.now().toString(36); let kn = 0; const key = (p) => `f3d-${run}-${p}-${++kn}`;
  const must = (r, n) => { if (!r.ok) throw new Error(`${n}: ${r.status} ${r.error}`); return r.data; };
  if ((await L.sel(`financial_write_freezes?organization_id=eq.${L.ORG}&select=id`)).length) throw new Error('org D already has a freeze row - step 1 runs once');
  // ---------------------------------------------------------------- old history
  must(await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: L.tashkentToday() }), 'rate');
  const rc = must(await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: 'D partiya (sintetik)', p_original_physical_g: 60, p_factory_markup_pct: 8, p_idempotency_key: key('rc') }), 'receipt');
  const consA = must(await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.receipt_id,
    p_pieces: [{ weight_grams: 5, model_code: 'D-1' }, { weight_grams: 7, model_code: 'D-2' }, { weight_grams: 8, model_code: 'D-3' }], p_idempotency_key: key('ca') }), 'consignment A');
  const consB = must(await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellerb.id, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rc.receipt_id,
    p_pieces: [{ weight_grams: 6, model_code: 'D-4' }, { weight_grams: 4, model_code: 'D-5' }], p_idempotency_key: key('cb') }), 'consignment B');
  const cu1 = must(await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `D86 Mijoz 1 ${run}` }), 'c1').customer_id;
  const cu2 = must(await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `D86 Mijoz 2 ${run}` }), 'c2').customer_id;
  const cu3 = must(await L.rpc('sellerb', 'rpc_create_customer_with_code', { p_contact_name: `D86 Mijoz 3 ${run}` }), 'c3').customer_id;
  must(await L.rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12600, p_reason: 'D seed' }), 'rates A');
  must(await L.rpc('sellerb', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12600, p_reason: 'D seed' }), 'rates B');
  must(await L.rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: cu1, p_piece_id: consA.pieces[0].id, p_client_markup_pct: 12, p_idempotency_key: key('s1') }), 'gram sale');
  must(await L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: cu1, p_cash_amount: 900000, p_idempotency_key: key('p1') }), 'uzs payment (gram debt)');
  must(await L.rpc('sellera', 'rpc_record_client_legacy_debt', { p_customer_id: cu1, p_balance_type: 'debt', p_amount_585_g: 2, p_as_of_date: L.tashkentToday(), p_idempotency_key: key('leg') }), 'legacy gram debt');
  must(await L.rpc('sellera', 'rpc_record_currency_sale', { p_customer_id: cu2, p_currency: 'USD', p_amount: 300, p_weight_grams: 7, p_piece_ids: [consA.pieces[1].id], p_idempotency_key: key('usd') }), 'usd sale');
  must(await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cu2, p_currency: 'USD', p_usd_amount: 100, p_usd_rate: 12600, p_idempotency_key: key('usdp') }), 'usd payment');
  must(await L.rpc('sellerb', 'rpc_record_currency_sale', { p_customer_id: cu3, p_currency: 'UZS', p_amount: 6000000, p_weight_grams: 6, p_piece_ids: [consB.pieces[0].id], p_idempotency_key: key('uzs') }), 'uzs sale');
  must(await L.rpc('sellerb', 'rpc_record_client_currency_settlement', { p_customer_id: cu3, p_currency: 'UZS', p_cash_uzs: 1000000, p_idempotency_key: key('uzsp') }), 'uzs payment');
  console.log('seeded: receipt 60 g @8 %, seller A 5+7+8 g @10 %, seller B 6+4 g @12 %, gram / legacy / USD / UZS debts');

  // ---------------------------------------------------------------- FZ-0: freeze while 20 parallel ordinary writes run
  const writes = [];
  for (let i = 0; i < 20; i++) writes.push((async () => { await sleep(i * 40); const who = i % 2 ? 'sellerb' : 'sellera'; const c = i % 2 ? cu3 : cu2;
    const r = await L.rpc(who, 'rpc_record_client_legacy_debt', { p_customer_id: c, p_balance_type: 'debt', p_amount_585_g: r4(0.1 + i / 100), p_as_of_date: L.tashkentToday(), p_idempotency_key: key('race') });
    return { ok: r.ok, error: r.error, at: Date.now() }; })());
  await sleep(300);
  const fz = await L.svc('POST', 'rest/v1/rpc/_goldia_financial_freeze', { p_org: L.ORG, p_reason: 'PHASE F3 D: backup -> restart window', p_on: true });
  const res = await Promise.all(writes);
  if (!fz.ok) throw new Error('freeze failed ' + fz.status + ' ' + fz.error);
  const frozenAt = fz.data.frozen_at;
  const younger = (await L.sel(`client_legacy_debts?organization_id=eq.${L.ORG}&created_at=gt.${encodeURIComponent(frozenAt)}&select=id`)).length;
  const refused = res.filter((r) => !r.ok); const bad = refused.filter((r) => !/ERR_FINANCIAL_FREEZE|ERR_OPENING_DRAFT/.test(r.error));
  T('FZ-0', 'freeze set by the release tooling while 20 parallel ordinary writes run: each write committed before the freeze moment or refused; 0 committed rows younger than frozen_at',
    fz.data.status === 'frozen' && bad.length === 0 && younger === 0, { younger: 0, otherErrors: 0 },
    { status: fz.data.status, committed: res.length - refused.length, refused: refused.length, otherErrors: bad.map((x) => x.error), younger, frozenAt });
  await sleep(1500);
  const fp0 = await fpD();

  // ---------------------------------------------------------------- FZ-1: direct RPC bypass attempts, every role
  const tries = [
    ['sellera', 'rpc_record_weight_sale', { p_customer_id: cu1, p_seller_id: C.sellera.id, p_weight_grams: 1, p_client_markup_pct: 10, p_idempotency_key: key('x') }],
    ['sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: cu1, p_piece_id: consA.pieces[2].id, p_client_markup_pct: 12, p_idempotency_key: key('x') }],
    ['sellera', 'rpc_record_currency_sale', { p_customer_id: cu2, p_currency: 'USD', p_amount: 10, p_weight_grams: 1, p_idempotency_key: key('x') }],
    ['sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cu2, p_currency: 'USD', p_usd_amount: 5, p_usd_rate: 12600, p_idempotency_key: key('x') }],
    ['sellera', 'rpc_record_client_settlement', { p_customer_id: cu1, p_cash_amount: 900000, p_idempotency_key: key('x') }],
    ['sellera', 'rpc_record_client_legacy_debt', { p_customer_id: cu1, p_balance_type: 'debt', p_amount_585_g: 1, p_as_of_date: L.tashkentToday(), p_idempotency_key: key('x') }],
    ['sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: C.sellera.id, p_cash_paid_amount: 900000, p_rate_per_gram: 900000, p_idempotency_key: key('x') }],
    ['sellerb', 'rpc_record_client_currency_settlement', { p_customer_id: cu3, p_currency: 'UZS', p_cash_uzs: 1000, p_idempotency_key: key('x') }],
    ['manager', 'rpc_record_client_settlement', { p_customer_id: cu1, p_cash_amount: 900000, p_rate_per_gram: 900000 }],
    ['manager', 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 1000, p_currency: 'UZS', p_gold_rate: 900000, p_idempotency_key: key('x') }],
    ['manager', 'rpc_record_factory_receipt', { p_product_name: 'x', p_original_physical_g: 1, p_factory_markup_pct: 8, p_idempotency_key: key('x') }],
    ['manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_pieces: [{ weight_grams: 1 }], p_seller_markup_pct: 12, p_idempotency_key: key('x') }],
    ['director', 'rpc_record_factory_gold_handover', { p_source_type: 'refined_gold', p_physical_weight_g: 1, p_proba: 999, p_agreed_equivalent_g: 1, p_idempotency_key: key('x') }],
    ['director', 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 2000, p_currency: 'UZS', p_gold_rate: 900000, p_idempotency_key: key('x') }],
    ['manager', 'rpc_confirm_accounting_baseline', { p_notes: 'between backup and restart', p_idempotency_key: key('x'), p_usd_rate: 12500 }],
  ];
  const tr = await Promise.all(tries.map(([u, f, a]) => L.rpc(u, f, a)));
  const frozenRefusals = tr.filter((r) => !r.ok && /ERR_FINANCIAL_FREEZE/.test(r.error)).length;
  T('FZ-1', `direct RPC writes during the freeze (seller A / B, manager, director; sales, payments, legacy, handover, capital, receipt, consignment, factory payment, baseline): all ${tries.length} refused ERR_FINANCIAL_FREEZE`,
    frozenRefusals === tries.length, tries.length, { refused: frozenRefusals, other: tr.map((r, i) => (r.ok || /ERR_FINANCIAL_FREEZE/.test(r.error)) ? null : `${tries[i][1]}: ${r.ok ? 'ACCEPTED' : r.error.slice(0, 50)}`).filter(Boolean) });

  // FZ-2: no way around the freeze for a signed-in user
  const byp = {
    unfreeze: await L.rpc('director', '_goldia_financial_freeze', { p_org: L.ORG, p_reason: 'bypass', p_on: false }),
    activeFn: await L.rpc('director', '_goldia_active_freeze', { p_org: L.ORG }),
    guardFn: await L.rpc('director', '_goldia_guard_opening_draft', {}),
    setConfig: await L.rpc('director', 'set_config', { setting_name: 'goldia.opening_write', new_value: '1', is_local: false }),
    patchFreeze: await L.uwrite('director', 'PATCH', `financial_write_freezes?organization_id=eq.${L.ORG}`, { released_at: new Date().toISOString() }),
    deleteFreeze: await L.uwrite('director', 'DELETE', `financial_write_freezes?organization_id=eq.${L.ORG}`),
    insertDebt: await L.uwrite('sellera', 'POST', 'client_legacy_debts', { organization_id: L.ORG, customer_id: cu1, seller_id: C.sellera.id, balance_type: 'debt', amount_585_g: 1, delta_585_g: 1, as_of_date: L.tashkentToday(), status: 'active' }),
    writeVerification: await L.uwrite('director', 'POST', 'financial_backup_verifications', { organization_id: L.ORG, backup_reference: 'fake', restore_verified: true }),
    managerRestart: await L.rpc('manager', 'rpc_financial_restart', { p_confirmation: 'MOLIYAVIY HISOBNI QAYTA BOSHLASH', p_reason: 'bypass', p_t0: new Date(Date.now() - 60e3).toISOString(), p_backup_verification_id: '00000000-0000-0000-0000-000000000000', p_idempotency_key: key('x') }),
    directorFakeBackup: await L.rpc('director', 'rpc_financial_restart', { p_confirmation: 'MOLIYAVIY HISOBNI QAYTA BOSHLASH', p_reason: 'bypass', p_t0: new Date(Date.now() - 60e3).toISOString(), p_backup_verification_id: '00000000-0000-0000-0000-000000000000', p_idempotency_key: key('x') }),
    sellerOpening: await L.rpc('sellera', 'rpc_record_opening_document', { p_kind: 'manager_cash', p_unit: 'UZS', p_amount: 1, p_idempotency_key: key('x') }),
    managerOpeningNoDraft: await L.rpc('manager', 'rpc_record_opening_document', { p_kind: 'manager_cash', p_unit: 'UZS', p_amount: 1, p_idempotency_key: key('x') }),
    oldReset: await L.rpc('director', 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'bypass' }),
  };
  const stillFrozen = (await L.sel(`financial_write_freezes?organization_id=eq.${L.ORG}&released_at=is.null&select=id`)).length;
  const patchedRows = byp.patchFreeze.ok ? (byp.patchFreeze.data || []).length : 0; const deletedRows = byp.deleteFreeze.ok ? (byp.deleteFreeze.data || []).length : 0;
  const allRefused = Object.entries(byp).every(([k, r]) => (k === 'patchFreeze' || k === 'deleteFreeze') ? (!r.ok || (r.data || []).length === 0) : !r.ok);
  T('FZ-2', 'bypass attempts by signed-in users (unfreeze, private functions, set_config, edit / delete the freeze row, direct table insert, fake backup verification, manager restart, restart with a fake backup, seller / manager opening without a restart, old test reset): all refused, freeze still active',
    allRefused && stillFrozen === 1 && patchedRows === 0 && deletedRows === 0, 'all refused, 1 active freeze',
    { stillFrozen, patchedRows, deletedRows, results: Object.fromEntries(Object.entries(byp).map(([k, r]) => [k, r.ok ? `OK(${JSON.stringify(r.data).slice(0, 30)})` : `${r.status} ${String(r.error).slice(0, 45)}`])) });

  // FZ-3: the director sees the freeze (RLS: own organization), and nothing was written by all the attempts
  const seen = await L.usel('director', 'financial_write_freezes?select=organization_id,frozen_at,released_at');
  const fp1 = await fpD();
  T('FZ-3', 'director reads only the own organization freeze row; organization D unchanged by every refused attempt (fingerprint after freeze = now)',
    seen.ok && seen.data.length === 1 && seen.data[0].organization_id === L.ORG && fp1 === fp0, { rows: 1, same: true }, { rows: seen.ok ? seen.data.length : seen.error, same: fp1 === fp0 });

  const acc = await L.sel(`seller_gold_accounts?organization_id=eq.${L.ORG}&select=seller_id,current_physical_stock_g,seller_owes_manager_g,total_seller_obligation_g,seller_till_cash_amount,seller_till_usd_amount`);
  const vault = (await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=manager_physical_stock_g,current_factory_obligation_g,manager_cash_amount,manager_usd_amount`))[0];
  const cg = await L.sel(`client_gold_accounts?organization_id=eq.${L.ORG}&select=customer_id,current_debt_grams,advance_balance_grams`);
  const cc = await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&select=customer_id,currency,debt_amount,advance_amount`);
  const held = await L.sel(`consignment_pieces?organization_id=eq.${L.ORG}&status=eq.held_by_seller&select=id,weight_grams,consignment_id`);
  const state = { run, frozenAt, fp: fp1, customers: { cu1, cu2, cu3 }, pieces: { a: consA.pieces.map((p) => p.id), b: consB.pieces.map((p) => p.id) },
    old: { sellers: acc, vault, client_gold: cg, client_currency: cc, held } };
  fs.writeFileSync(L.STATE, JSON.stringify(state, null, 1), { mode: 0o600 });
  fs.writeFileSync('/home/user/jewelryflow-erp/docs/audits/goldia-086-d/evidence/phase1-seed-freeze.json', JSON.stringify({ run, frozenAt, old: state.old, results: R }, null, 1));
  console.log(JSON.stringify({ old: state.old }));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} - org D stays FROZEN (frozen_at ${frozenAt}); next: the owner's backup --backup-only --verify-org ${L.ORG} --verify-count 2`);
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
