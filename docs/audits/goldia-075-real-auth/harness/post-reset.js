// F-073 regression on the local 075 stack: after a reset the old valued till pool must not leak into a new handover.
const { ORG, creds, rpc, sel, T, R, eq, must, r4, tashkentToday } = require('./lib');
(async () => {
  const C = creds(); const SA = C.sellera.id; const run = Date.now().toString(36);
  const cust = (await sel(`customers?organization_id=eq.${ORG}&contact_name=eq.${encodeURIComponent('A mijoz 1 (UI)')}&select=id`))[0].id;
  const pre = { 'AUD-STG-A1': cust };
  must(await rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: tashkentToday() }), 'rate');
  const r = must(await rpc('manager', 'rpc_record_factory_receipt', { p_product_name: 'post-reset (audit)', p_original_physical_g: 10, p_factory_markup_pct: 8, p_idempotency_key: 'pr-' + run }), 'receipt');
  const c = must(await rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: SA, p_factory_markup_pct: 8, p_seller_markup_pct: 15, p_factory_receipt_id: r.receipt_id, p_pieces: [{ weight_grams: 10, model_code: 'PR' }] }), 'cons');
  must(await rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: pre['AUD-STG-A1'], p_piece_id: c.pieces[0].id, p_client_markup_pct: 15 }), 'sale');
  const rate = Number((await sel(`seller_rates?seller_id=eq.${SA}&select=lom_rate_uzs`))[0].lom_rate_uzs);
  const pay = must(await rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: pre['AUD-STG-A1'], p_cash_amount: rate * 2 }), 'pay');
  const till = (await sel(`seller_gold_accounts?seller_id=eq.${SA}&select=c:seller_till_cash_amount,vc:till_valued_cash_585_g`))[0];
  const ho = must(await rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: SA, p_cash_paid_amount: Number(till.c) }), 'handover');
  T('F073', `after reset: ${rate * 2} UZS at ${rate} = 2.0 g paid; handover is exactly 2.0 g (old pool not mixed in)`, pay && eq(pay.total_settled_grams, 2) && Number(till.c) === rate * 2 && eq(till.vc, 2) && ho && eq(ho.total_settled_grams, 2), { paid: 2, till_cash: rate * 2, till_valued: 2, handover: 2 }, { paid: pay && pay.total_settled_grams, till_cash: Number(till.c), till_valued: r4(till.vc), handover: ho && ho.total_settled_grams });
  require('fs').writeFileSync(__dirname + '/../evidence/post-reset-f073.json', JSON.stringify(R, null, 1));
})();
