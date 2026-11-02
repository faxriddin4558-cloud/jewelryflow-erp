const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  const P = Object.fromEntries((await su(`select model_code||'-'||e.employee_code k, cp.id from consignment_pieces cp join employees e on e.id=cp.seller_id`)).map(r => [r.k, r.id]));
  const S = Object.fromEntries((await su(`select sale_no, id, base_weight_grams from jewelry_sales order by created_at`)).map((r, i) => ['s' + (i + 1), r.id]));
  const ST = await su(`select id, direction, seller_id, cash_paid_amount from gold_settlements order by created_at`);
  rec('S8.1', 'seller A tries to return own piece SR-02 to manager', await rpc(U.SA, 'rpc_return_piece_to_manager', { p_piece_id: P['SR-02-T-SA'] }));
  rec('S8.2', 'manager returns SA piece SR-02 5.10g', await rpc(U.M, 'rpc_return_piece_to_manager', { p_piece_id: P['SR-02-T-SA'], p_idempotency_key: 'ret-1' }));
  rec('S8.3', 'manager returns same piece again', await rpc(U.M, 'rpc_return_piece_to_manager', { p_piece_id: P['SR-02-T-SA'] }));
  rec('S8.4', 'manager returns a SOLD piece (UZ-01 SA)', await rpc(U.M, 'rpc_return_piece_to_manager', { p_piece_id: P['UZ-01-T-SA'] }));
  rec('S12.1', 'SA reverses own weight sale 0.5g to CB1', await rpc(U.SA, 'rpc_reverse_client_sale', { p_sale_id: S.s4, p_reason: 'xato' }));
  rec('S12.2', 'manager reverses weight sale 0.5g to CB1', await rpc(U.M, 'rpc_reverse_client_sale', { p_sale_id: S.s4, p_reason: 'xato mijoz' }));
  rec('S12.3', 'manager reverses it again (double reversal)', await rpc(U.M, 'rpc_reverse_client_sale', { p_sale_id: S.s4, p_reason: 'again' }));
  rec('S12.4', 'manager reverses PAID barcode sale UZ-01 (CA1)', await rpc(U.M, 'rpc_reverse_barcode_piece_sale', { p_piece_id: P['UZ-01-T-SA'], p_reason: 'qaytarildi' }));
  rec('S12.5', 'reverse SB handover after manager spent the cash', await rpc(U.M, 'rpc_reverse_seller_to_manager_settlement', { p_settlement_id: ST.find(s => s.direction === 'seller_to_manager' && Number(s.cash_paid_amount) === 4750000).id, p_reason: 'test' }));
  rec('S12.6', 'reverse CB1 client settlement whose cash already handed over', await rpc(U.M, 'rpc_reverse_client_settlement', { p_settlement_id: ST.find(s => s.direction === 'client_to_seller' && Number(s.cash_paid_amount) === 4750000).id, p_reason: 'test' }));
  await pool.end();
})();
