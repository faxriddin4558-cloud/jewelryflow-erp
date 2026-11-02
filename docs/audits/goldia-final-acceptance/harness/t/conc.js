const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  const C = Object.fromEntries((await su(`select customer_code, id from customers`)).map(r => [r.customer_code, r.id]));
  // C1: two concurrent barcode sales of the same piece (SB SR-02 6.6g)
  const pc = (await su(`select id from consignment_pieces where seller_id=$1 and status='held_by_seller' and model_code='SR-02'`, [U.SB]))[0].id;
  const c1 = await Promise.all([1, 2].map(i => rpc(U.SB, 'rpc_record_barcode_piece_sale', { p_customer_id: C['CUST-0003'], p_piece_id: pc, p_client_markup_pct: 10, p_idempotency_key: 'c1-' + i }, { hold: 1 })));
  rec('C1', 'two concurrent sales of the same barcode piece', c1.map(r => r.ok ? 'OK ' + r.data.sale_no : 'ERR ' + r.error.slice(0, 80)));
  // C3: concurrent advance payments for a brand-new customer (no account row yet)
  const nc = (await rpc(U.SB, 'rpc_create_customer_with_code', { p_contact_name: 'Avans mijoz (sintetik)' })).data.customer_id;
  const c3 = await Promise.all([1, 2, 3].map(i => rpc(U.SB, 'rpc_record_client_settlement', { p_customer_id: nc, p_cash_amount: 1000000, p_idempotency_key: 'c3-' + i }, { hold: 1 })));
  const acc = (await su(`select advance_balance_grams, total_settled_grams, total_cash_paid_amount from client_gold_accounts where customer_id=$1`, [nc]))[0];
  const till = (await su(`select seller_till_cash_amount from seller_gold_accounts where seller_id=$1`, [U.SB]))[0];
  rec('C3', '3 concurrent 1,000,000 UZS advance payments (rate 1,000,000) for a new customer; expected advance 3.0 g', { calls: c3.map(r => r.ok ? 'OK' : 'ERR ' + r.error.slice(0, 60)), account: acc, sb_till: till });
  // C5: same idempotency key concurrently
  const c5 = await Promise.all([1, 2].map(() => rpc(U.SB, 'rpc_record_client_settlement', { p_customer_id: nc, p_cash_amount: 10000, p_idempotency_key: 'c5-same' }, { hold: 1 })));
  const n5 = (await su(`select count(*)::int n from gold_settlements where idempotency_key='c5-same'`))[0].n;
  rec('C5', 'same idempotency key sent twice concurrently', { calls: c5.map(r => r.ok ? 'OK ' + r.data.settlement_no : 'ERR ' + r.error.slice(0, 60)), rows: n5 });
  // C4: two concurrent handovers of entire SB till
  const t = Number((await su(`select seller_till_cash_amount c from seller_gold_accounts where seller_id=$1`, [U.SB]))[0].c);
  const c4 = await Promise.all([1, 2].map(i => rpc(U.SB, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SB, p_cash_paid_amount: t, p_idempotency_key: 'c4-' + i }, { hold: 1 })));
  rec('C4', `two concurrent handovers of full till ${t}`, c4.map(r => r.ok ? 'OK' : 'ERR ' + r.error.slice(0, 70)));
  // C7: concurrent double reversal of the same sale
  const sale = (await su(`select id from jewelry_sales where seller_id=$1 and status not in ('reversed','cancelled') order by created_at desc limit 1`, [U.SB]))[0].id;
  const c7 = await Promise.all([1, 2].map(i => rpc(U.M, 'rpc_reverse_client_sale', { p_sale_id: sale, p_reason: 'conc ' + i }, { hold: 1 })));
  rec('C7', 'concurrent double reversal of the same sale', c7.map(r => r.ok ? 'OK' : 'ERR ' + r.error.slice(0, 70)));
  // C8: weight-sale retry after success when stock is exhausted (network retry with same key)
  const sbStock = Number((await rpc(U.SB, 'get_seller_available_stock_grams', { p_seller_id: U.SB })).data);
  const w1 = await rpc(U.SB, 'rpc_record_weight_sale', { p_customer_id: C['CUST-0003'], p_weight_grams: sbStock, p_client_markup_pct: 10, p_idempotency_key: 'w-retry' });
  const w2 = await rpc(U.SB, 'rpc_record_weight_sale', { p_customer_id: C['CUST-0003'], p_weight_grams: sbStock, p_client_markup_pct: 10, p_idempotency_key: 'w-retry' });
  rec('C8', `weight sale of all remaining stock (${sbStock} g) then identical retry with same key`, [w1.ok ? 'OK ' + w1.data.sale_no : 'ERR ' + w1.error, w2.ok ? 'OK ' + w2.data.sale_no : 'ERR ' + w2.error.slice(0, 120)]);
  await pool.end();
})();
