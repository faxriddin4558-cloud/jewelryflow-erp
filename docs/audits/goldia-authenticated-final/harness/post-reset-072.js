const { U, rpc, su, pool } = require('./lib');
(async () => {
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  await rpc(U.D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  const r = await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'post-reset', p_original_physical_g: 10, p_factory_markup_pct: 8 });
  const c = await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_factory_markup_pct: 8, p_seller_markup_pct: 15, p_factory_receipt_id: r.data.receipt_id, p_pieces: [{ weight_grams: 10 }] });
  const cust = (await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'post-reset mijoz' })).data.customer_id;
  await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: cust, p_piece_id: c.data.pieces[0].id, p_client_markup_pct: 15 });
  const rate = (await su(`select lom_rate_uzs from seller_rates where seller_id=$1`, [U.SA]))[0].lom_rate_uzs;
  const pay = await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: cust, p_cash_amount: Number(rate) * 2 });
  const till = (await su(`select seller_till_cash_amount c from seller_gold_accounts where seller_id=$1`, [U.SA]))[0];
  const ho = await rpc(U.SA, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SA, p_cash_paid_amount: Number(till.c) });
  console.log(JSON.stringify({ seller_rate: rate, paid_grams: pay.ok && pay.data.total_settled_grams, till_cash: till.c, handover_grams: ho.ok ? ho.data.total_settled_grams : ho.error, expected_handover_grams: pay.ok && pay.data.total_settled_grams }));
  await pool.end();
})();
