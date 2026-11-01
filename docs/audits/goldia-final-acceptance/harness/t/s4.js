const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  const C = Object.fromEntries((await su(`select customer_code, id from customers`)).map(r => [r.customer_code, r.id]));
  const P = Object.fromEntries((await su(`select model_code||'-'||coalesce(e.employee_code,'') k, cp.id from consignment_pieces cp join employees e on e.id=cp.seller_id where cp.status='held_by_seller'`)).map(r => [r.k, r.id]));
  console.log(P);
  // barcode piece sale SA: UZ-01 3.25g @10% to CA1
  rec('S5.1', 'SA barcode sale UZ-01 3.25g @10% to CA1', await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: C['CUST-0001'], p_piece_id: P['UZ-01-T-SA'], p_client_markup_pct: 10, p_idempotency_key: 'sale-a1' }));
  rec('S5.1b', 'retry same sale key', await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: C['CUST-0001'], p_piece_id: P['UZ-01-T-SA'], p_client_markup_pct: 10, p_idempotency_key: 'sale-a1' }));
  rec('S5.1c', 'sell same piece again new key (duplicate barcode)', await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: C['CUST-0002'], p_piece_id: P['UZ-01-T-SA'], p_client_markup_pct: 10, p_idempotency_key: 'sale-a1x' }));
  rec('S5.2', 'SA weight sale 9.0g @15% to CA2', await rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: C['CUST-0002'], p_weight_grams: 9.0, p_client_markup_pct: 15, p_idempotency_key: 'wsale-a2' }));
  rec('S5.3', 'SB barcode sale ZN-03 9.0g @10% to CB1', await rpc(U.SB, 'rpc_record_barcode_piece_sale', { p_customer_id: C['CUST-0003'], p_piece_id: P['ZN-03-T-SB'], p_client_markup_pct: 10 }));
  rec('S5.4', 'SA sells SB piece (cross-seller)', await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: C['CUST-0001'], p_piece_id: P['UZ-01-T-SB'], p_client_markup_pct: 10 }));
  rec('S5.5', 'SA sells own piece passing p_seller_id=SB', await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: C['CUST-0001'], p_seller_id: U.SB, p_piece_id: P['UZ-01-T-SB'], p_client_markup_pct: 10 }));
  rec('S5.6', 'SA sells to SB customer CB1 (customer of other seller)', await rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: C['CUST-0003'], p_weight_grams: 0.5, p_client_markup_pct: 10 }));
  rec('S5.7', 'SA weight sale more than stock (100g)', await rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: C['CUST-0001'], p_weight_grams: 100, p_client_markup_pct: 10 }));
  rec('S5.8', 'SA weight sale markup 150%', await rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: C['CUST-0001'], p_weight_grams: 1, p_client_markup_pct: 150 }));
  rec('S5.9', 'SA weight sale markup null', await rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: C['CUST-0001'], p_weight_grams: 1, p_client_markup_pct: null }));
  rec('S5.10', 'SA weight sale negative weight', await rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: C['CUST-0001'], p_weight_grams: -3, p_client_markup_pct: 10 }));
  console.log(JSON.stringify(await su(`select sale_no, sale_type, e.employee_code s, c.customer_code c, base_weight_grams b, factory_markup_pct fp, factory_gold_due_grams fd, client_markup_pct cp, client_gold_due_grams cd, markup_spread_grams sp, seller_profit_spread_grams ssp, remaining_gold_grams rem, status from jewelry_sales j join employees e on e.id=j.seller_id join customers c on c.id=j.customer_id order by j.created_at`), null, 0));
  console.log(JSON.stringify(await su(`select model_code, weight_grams, status, e.employee_code from consignment_pieces cp join employees e on e.id=cp.seller_id where e.employee_code in ('T-SA','T-SB') order by 4,1`)));
  console.log(JSON.stringify(await su(`select * from weight_sale_allocations`)));
  await pool.end();
})();
