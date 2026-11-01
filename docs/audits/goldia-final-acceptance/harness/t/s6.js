const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  rec('S7.1', 'director sets new 585 rate 1,000,000 same day', await rpc(U.D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 1000000 }));
  console.log(JSON.stringify(await su(`select rate_date, rate_per_gram, is_confirmed, created_at from daily_gold_rates order by created_at`)));
  rec('S7.2', 'SA tries handover more scrap than till (5g eq)', await rpc(U.SA, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SA, p_scrap_weight_grams: 5 }));
  rec('S7.3', 'SA hands over SB till (forged seller)', await rpc(U.SA, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SB, p_cash_paid_amount: 1000 }));
  rec('S7.4', 'SA hands over all: scrap 3.4188eq/4.0phys + 150000 UZS + 500 USD@12800 at official rate', await rpc(U.SA, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SA, p_scrap_weight_grams: 3.4188, p_physical_scrap_g: 4.0, p_cash_paid_amount: 150000, p_usd_paid_amount: 500, p_usd_rate: 12800, p_idempotency_key: 'h-a1' }));
  rec('S7.5', 'manager receives SB cash 4,750,000 at manager-chosen rate 950,000', await rpc(U.M, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SB, p_cash_paid_amount: 4750000, p_rate_per_gram: 950000 }));
  await pool.end();
})();
