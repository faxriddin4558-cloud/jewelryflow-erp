// Regression suite for the 070 fixes. Runs on a FRESH disposable database (setup.sh + seed.sql).
const { U, rpc, req, su, pool } = require('./lib');
const results = []; const T = (id, title, ok, detail) => { results.push({ id, title, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + (detail ? ' | ' + JSON.stringify(detail).slice(0, 220) : '')); };
const one = async (s, p) => (await su(s, p))[0];
(async () => {
  const OA = '00000000-0000-0000-0000-000000000001', OB = '00000000-0000-0000-0000-0000000000b2';
  await rpc(U.D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 1000000 });
  // F5 receipt retry
  const r1 = await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'R', p_original_physical_g: 100, p_factory_markup_pct: 8, p_idempotency_key: 'reg-fr' });
  const r1b = await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'R', p_original_physical_g: 100, p_factory_markup_pct: 8, p_idempotency_key: 'reg-fr' });
  const nrc = (await one(`select count(*)::int n, sum(factory_obligation_g) o from factory_receipts`)).n;
  T('F5', 'factory receipt retried with same key creates ONE receipt', r1.ok && r1b.ok && nrc === 1 && r1.data.receipt_id === r1b.data.receipt_id, { receipts: nrc });
  const v0 = await one(`select manager_physical_stock_g s from manager_vault_account`);
  T('F5b', 'stored manager_physical_stock_g equals canonical stock after receipt', Number(v0.s) === 100, v0);
  const rid = r1.data.receipt_id;
  const cA = await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rid, p_pieces: [{ weight_grams: 4 }, { weight_grams: 6 }] });
  const cC1 = await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SC, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rid, p_pieces: [{ weight_grams: 10 }] });
  const cC2 = await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SC, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rid, p_pieces: [{ weight_grams: 2 }, { weight_grams: 3 }] });
  const custA = (await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'Reg A' })).data.customer_id;
  const custC = (await rpc(U.SC, 'rpc_create_customer_with_code', { p_contact_name: 'Reg C' })).data.customer_id;
  // F4 oversell via whole-consignment sale
  await rpc(U.SC, 'rpc_record_weight_sale', { p_customer_id: custC, p_weight_grams: 11, p_client_markup_pct: 10 });
  const whole = await rpc(U.SC, 'rpc_record_client_jewelry_sale', { p_customer_id: custC, p_consignment_id: cC2.data.consignment_id, p_client_markup_pct: 10 });
  const soldC = Number((await one(`select coalesce(sum(base_weight_grams),0) g from jewelry_sales where seller_id=$1 and status not in ('reversed','cancelled')`, [U.SC])).g);
  T('F4', 'whole-consignment sale after partial weight sale is rejected (no oversell)', !whole.ok && soldC <= 15, { whole: whole.ok ? 'ACCEPTED' : whole.error.slice(0, 80), soldC });
  const cC3 = await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SC, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rid, p_pieces: [{ weight_grams: 1 }] });
  const m200 = await rpc(U.SC, 'rpc_record_client_jewelry_sale', { p_customer_id: custC, p_consignment_id: cC3.data.consignment_id, p_client_markup_pct: 200 });
  T('F4b', 'whole-consignment sale with 200% markup is rejected', !m200.ok, m200.ok ? 'ACCEPTED' : m200.error.slice(0, 80));
  const okWhole = await rpc(U.SC, 'rpc_record_client_jewelry_sale', { p_customer_id: custC, p_consignment_id: cC3.data.consignment_id, p_client_markup_pct: 12 });
  T('F4c', 'untouched consignment can still be sold as a whole (no regression)', okWhole.ok && okWhole.data.client_gold_due_grams === 1.12, okWhole.ok ? okWhole.data.client_gold_due_grams : okWhole.error);
  // F2 reverse a paid sale
  const piece = (await one(`select id from consignment_pieces where seller_id=$1 and weight_grams=4`, [U.SA])).id;
  await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: custA, p_piece_id: piece, p_client_markup_pct: 10 });
  await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: custA, p_cash_amount: 4400000 }); // 4.4 g = fully paid
  const rv = await rpc(U.M, 'rpc_reverse_barcode_piece_sale', { p_piece_id: piece, p_reason: 'regression' });
  const accA = await one(`select current_debt_grams d, advance_balance_grams a from client_gold_accounts where customer_id=$1`, [custA]);
  T('F2', 'reversing a fully paid 4.4 g sale leaves the customer a 4.4 g advance', rv.ok && Number(accA.d) === 0 && Number(accA.a) === 4.4, accA);
  // partial: sale 6g@10% = 6.6, paid 2.0 -> reverse -> advance 2.0
  const piece6 = (await one(`select id from consignment_pieces where seller_id=$1 and weight_grams=6`, [U.SA])).id;
  await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: custA, p_piece_id: piece6, p_client_markup_pct: 10 }); // uses 4.4 advance -> remaining 2.2
  await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: custA, p_cash_amount: 1000000 }); // 1.0 -> debt 1.2
  await rpc(U.M, 'rpc_reverse_barcode_piece_sale', { p_piece_id: piece6, p_reason: 'regression 2' });
  const accA2 = await one(`select current_debt_grams d, advance_balance_grams a from client_gold_accounts where customer_id=$1`, [custA]);
  T('F2b', 'reversing a partly paid sale (6.6 due, 5.4 paid incl. advance) leaves 5.4 g advance', Number(accA2.d) === 0 && Number(accA2.a) === 5.4, accA2);
  // F3 concurrent first payments
  const nc = (await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'Reg conc' })).data.customer_id;
  await Promise.all([1, 2, 3].map(i => rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: nc, p_cash_amount: 1000000, p_idempotency_key: 'reg-c3-' + i }, { hold: 1 })));
  const acc3 = await one(`select advance_balance_grams a from client_gold_accounts where customer_id=$1`, [nc]);
  T('F3', '3 concurrent 1,000,000 UZS first payments => 3.0 g advance', Number(acc3.a) === 3, acc3);
  await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: nc, p_usd_amount: 100, p_usd_rate: 12800 });
  const acc3u = await one(`select total_usd_paid_amount u from client_gold_accounts where customer_id=$1`, [nc]);
  T('F3b', 'customer account records USD paid', Number(acc3u.u) === 100, acc3u);
  // F7 weight sale retry
  const stockA = Number((await rpc(U.SA, 'get_seller_available_stock_grams', { p_seller_id: U.SA })).data);
  const w1 = await rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: custA, p_weight_grams: stockA, p_client_markup_pct: 10, p_idempotency_key: 'reg-w' });
  const w2 = await rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: custA, p_weight_grams: stockA, p_client_markup_pct: 10, p_idempotency_key: 'reg-w' });
  T('F7', 'weight-sale retry after selling all stock returns the original sale', w1.ok && w2.ok && w1.data.sale_id === w2.data.sale_id, w2.ok ? w2.data.sale_no : w2.error.slice(0, 90));
  // F6 + F1b
  await rpc(U.D, 'rpc_confirm_accounting_baseline', { p_notes: 'reg', p_usd_rate: 12800 });
  const cap = await rpc(U.D, 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 5000000, p_currency: 'UZS', p_gold_rate: 1000000 });
  T('F6', 'capital contribution in UZS without USD rate succeeds', cap.ok, cap.ok ? cap.data.transaction_no : cap.error);
  const exp = await rpc(U.M, 'rpc_record_financial_transaction', { p_transaction_type: 'business_expense', p_source_till: 'manager_uzs', p_amount: 500000, p_currency: 'UZS', p_gold_rate: 1000000 });
  const usdNoRate = await rpc(U.D, 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_usd', p_amount: 10, p_currency: 'USD', p_gold_rate: 1000000 });
  T('F6b', 'USD transaction without a USD rate is refused (no silent 12,800)', !usdNoRate.ok, usdNoRate.ok ? 'ACCEPTED' : usdNoRate.error.slice(0, 80));
  const pr = await rpc(U.D, 'rpc_get_accounting_profit_summary', {});
  T('F1b', 'after 0.5 g expense the period result is -0.5 g (operational before expenses 0)', exp.ok && pr.data.period_accounting_result_585_g === -0.5 && pr.data.operational_trading_result_585_g === 0, { result: pr.data.period_accounting_result_585_g, op: pr.data.operational_trading_result_585_g });
  // F1 access
  const acc = {};
  for (const [k, uid, org] of [['NOEMP', U.NOEMP, OA], ['NOORG', U.NOORG, OA], ['INACTIVE', U.SX, OA], ['SELLER', U.SA, null], ['ORGB_DIR', U.DB, OA], ['MANAGER', U.M, null], ['DIRECTOR', U.D, null]]) {
    const r = await rpc(uid, 'rpc_get_accounting_profit_summary', org ? { p_org_id: org } : {}); acc[k] = r.ok ? 'ALLOWED' : 'DENIED';
  }
  T('F1', 'profit summary: only director/manager of the own org', acc.NOEMP === 'DENIED' && acc.NOORG === 'DENIED' && acc.INACTIVE === 'DENIED' && acc.SELLER === 'DENIED' && acc.ORGB_DIR === 'DENIED' && acc.MANAGER === 'ALLOWED' && acc.DIRECTOR === 'ALLOWED', acc);
  // F8
  const f8 = await Promise.all([rpc(U.SA, 'rpc_get_financial_reconciliation_summary', {}), rpc(U.SA, 'rpc_get_three_tier_ledger_summary', {}), rpc(U.SA, 'rpc_get_seller_available_pieces', { p_seller_id: U.SC }), rpc(U.SA, 'rpc_get_seller_available_pieces', {}), rpc(U.M, 'rpc_get_financial_reconciliation_summary', {})]);
  T('F8', 'seller denied company summaries/other seller pieces; own pieces + manager summary still allowed', !f8[0].ok && !f8[1].ok && !f8[2].ok && f8[3].ok && f8[4].ok, f8.map(r => r.ok));
  // F9
  const u1 = await req(U.DB, `update employees set is_active=false where id='${U.D}' returning id`);
  const u2 = await req(U.SA, `update employees set organization_id='${OB}' where id='${U.SA}' returning id`);
  const u3 = await req(U.DB, `select count(*)::int n from employees where organization_id='${OA}'`);
  const u4 = await req(U.DB, `select count(*)::int n from audit_logs where organization_id='${OA}'`);
  const u5 = await req(U.D, `update employees set name='T Sotuvchi A' where id='${U.SA}' returning id`);
  T('F9', 'other-org director cannot modify/read Goldia employees or audit logs; employee cannot change org', (u1.ok && u1.rows.length === 0) && !u2.ok && u3.rows[0].n === 0 && u4.rows[0].n === 0 && u5.ok && u5.rows.length === 1, { orgB_update: u1.ok ? u1.rows.length : u1.error, self_move: u2.ok ? 'ALLOWED' : 'DENIED', orgB_reads_emps: u3.rows[0].n, orgB_reads_audit: u4.rows[0].n, own_director_update: u5.ok });
  require('fs').writeFileSync(process.argv[2] || '/opt/goldia-audit/regression.json', JSON.stringify(results, null, 1));
  console.log('REGRESSION', results.filter(r => r.ok).length, '/', results.length, 'passed');
  await pool.end();
})();
