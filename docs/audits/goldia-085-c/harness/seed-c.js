// Seeds a small real history in org C ONLY (through the users' own JWTs = the UI path), so that the financial restart has
// real documents to archive. Prints ids / statuses only.
const L = require('./lib');
(async () => {
  const C = L.creds(); const run = Date.now().toString(36); const out = {};
  const must = (r, n) => { if (!r.ok) { console.log('FAILED', n, r.status, r.error); process.exit(1); } out[n] = 'ok'; return r.data; };
  must(await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: L.tashkentToday() }), 'rate');
  const rc = must(await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: 'C partiya (sintetik)', p_original_physical_g: 60, p_factory_markup_pct: 8, p_idempotency_key: `c85-rc-${run}` }), 'receipt');
  const cons = must(await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.receipt_id,
    p_pieces: [{ weight_grams: 5, model_code: 'C-1' }, { weight_grams: 7, model_code: 'C-2' }, { weight_grams: 8, model_code: 'C-3' }], p_idempotency_key: `c85-cons-${run}` }), 'consignment');
  const cu1 = must(await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `C85 Mijoz 1 ${run}` }), 'customer1').customer_id;
  const cu2 = must(await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `C85 Mijoz 2 ${run}` }), 'customer2').customer_id;
  must(await L.rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12600, p_reason: 'C seed' }), 'seller_rates');
  must(await L.rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: cu1, p_piece_id: cons.pieces[0].id, p_client_markup_pct: 12, p_idempotency_key: `c85-s1-${run}` }), 'piece_sale');
  must(await L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: cu1, p_cash_amount: 900000, p_idempotency_key: `c85-pay-${run}` }), 'uzs_payment');
  must(await L.rpc('sellera', 'rpc_record_currency_sale', { p_customer_id: cu2, p_currency: 'USD', p_amount: 300, p_weight_grams: 0, p_piece_ids: [cons.pieces[1].id], p_idempotency_key: `c85-cs-${run}` }), 'usd_sale');
  must(await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cu2, p_currency: 'USD', p_usd_amount: 100, p_usd_rate: 12600, p_idempotency_key: `c85-cp-${run}` }), 'usd_payment');
  must(await L.rpc('sellera', 'rpc_record_client_legacy_debt', { p_customer_id: cu1, p_balance_type: 'debt', p_amount_585_g: 2, p_as_of_date: L.tashkentToday(), p_idempotency_key: `c85-leg-${run}` }), 'legacy_debt');
  const acc = await L.sel(`seller_gold_accounts?organization_id=eq.${L.ORG}&select=seller_id,current_physical_stock_g,seller_owes_manager_g,seller_till_cash_amount,seller_till_usd_amount`);
  const vault = await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=manager_physical_stock_g,current_factory_obligation_g`);
  console.log(JSON.stringify({ seeded: out, sellers: acc, vault }));
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
