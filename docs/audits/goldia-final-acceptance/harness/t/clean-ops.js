// Normal daily operations that do not hit any 069 defect (for the clean release rehearsal).
const { U, rpc, su, pool } = require('./lib');
(async () => {
  const ok = (r, n) => { if (!r.ok) { console.error('FAIL', n, r.error); process.exit(1); } return r.data; };
  ok(await rpc(U.D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 1000000 }), 'rate');
  const r = ok(await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'Uzuk', p_original_physical_g: 50, p_factory_markup_pct: 8 }), 'receipt');
  const c = ok(await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: r.receipt_id, p_pieces: [{ weight_grams: 4 }, { weight_grams: 6 }] }), 'consign');
  const cust = ok(await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'Toza mijoz (sintetik)' }), 'cust').customer_id;
  ok(await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: cust, p_piece_id: c.pieces[0].id, p_client_markup_pct: 10 }), 'sale');
  ok(await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: cust, p_cash_amount: 2000000 }), 'pay');
  ok(await rpc(U.SA, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SA, p_cash_paid_amount: 2000000 }), 'handover');
  console.log('clean ops done'); await pool.end();
})();
