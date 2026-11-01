const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  const C = Object.fromEntries((await su(`select customer_code, id from customers`)).map(r => [r.customer_code, r.id]));
  // CA1 owes 3.575: scrap 4.0g @500 proba (=3.4188 eq) + cash 150,000 @950,000 (=0.1579) -> 3.5767 => advance 0.0017
  rec('S6.1', 'CA1 pays 4.0g 500-proba scrap + 150000 UZS to SA', await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: C['CUST-0001'], p_scrap_weight: 4.0, p_scrap_proba: 500, p_cash_amount: 150000, p_idempotency_key: 'set-a1' }));
  rec('S6.1b', 'retry same settlement key', await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: C['CUST-0001'], p_scrap_weight: 4.0, p_scrap_proba: 500, p_cash_amount: 150000, p_idempotency_key: 'set-a1' }));
  rec('S6.2', 'SA uses own (non-official) rate 1,200,000', await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: C['CUST-0002'], p_cash_amount: 100000, p_rate_per_gram: 1200000 }));
  rec('S6.3', 'CA2 pays USD 500 @12,800 to SA', await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: C['CUST-0002'], p_usd_amount: 500, p_usd_rate: 12800, p_idempotency_key: 'set-a2' }));
  rec('S6.4', 'CB1 pays 4,750,000 UZS to SB', await rpc(U.SB, 'rpc_record_client_settlement', { p_customer_id: C['CUST-0003'], p_cash_amount: 4750000 }));
  rec('S6.5', 'SA collects from SB customer CB1', await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: C['CUST-0003'], p_cash_amount: 1000 }));
  rec('S6.6', 'scrap proba 1200 invalid', await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: C['CUST-0001'], p_scrap_weight: 1, p_scrap_proba: 1200 }));
  rec('S6.7', 'negative cash', await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: C['CUST-0001'], p_cash_amount: -5000 }));
  await pool.end();
})();
