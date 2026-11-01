const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  rec('S9.1', 'manager buys 3.0g 750 scrap for 2,700,000 UZS', await rpc(U.M, 'rpc_record_gold_purchase', { p_supplier_name: 'Bozor (sintetik)', p_cash_spent_uzs: 2700000, p_gold_weight_grams: 3.0, p_proba: 750, p_idempotency_key: 'buy-1' }));
  rec('S9.1b', 'retry purchase same key', await rpc(U.M, 'rpc_record_gold_purchase', { p_supplier_name: 'Bozor (sintetik)', p_cash_spent_uzs: 2700000, p_gold_weight_grams: 3.0, p_proba: 750, p_idempotency_key: 'buy-1' }));
  rec('S9.2', 'manager buys 2.0g 585 for 200 USD @12,900', await rpc(U.M, 'rpc_record_gold_purchase', { p_supplier_name: 'Bozor USD', p_usd_spent: 200, p_usd_rate: 12900, p_gold_weight_grams: 2.0, p_proba: 585 }));
  rec('S9.3', 'purchase exceeding vault cash', await rpc(U.M, 'rpc_record_gold_purchase', { p_supplier_name: 'x', p_cash_spent_uzs: 99000000, p_gold_weight_grams: 1 }));
  rec('S9.4', 'seller attempts purchase', await rpc(U.SA, 'rpc_record_gold_purchase', { p_supplier_name: 'x', p_cash_spent_uzs: 1000, p_gold_weight_grams: 1 }));
  // refining: manager scrap 3.4188 eq / 4.0 phys @500. refine 4.0g@500 -> melted 3.95 -> fine 1.98g @999 = 3.3815 eq ; loss 0.0373
  rec('S10.1', 'refine 4.0g@500 -> 1.98g@999', await rpc(U.M, 'rpc_record_refining_batch', { p_input_scrap_grams: 4.0, p_melted_weight_grams: 3.95, p_output_fine_grams: 1.98, p_output_fine_proba: 999, p_physical_scrap_grams: 4.0, p_input_scrap_proba: 500, p_idempotency_key: 'ref-1' }));
  rec('S10.2', 'refine output > input (anomaly)', await rpc(U.M, 'rpc_record_refining_batch', { p_input_scrap_grams: 0.1, p_melted_weight_grams: 0.1, p_output_fine_grams: 5, p_output_fine_proba: 999, p_input_scrap_proba: 585 }));
  rec('S10.3', 'refine more scrap than vault', await rpc(U.M, 'rpc_record_refining_batch', { p_input_scrap_grams: 50, p_melted_weight_grams: 49, p_output_fine_grams: 20, p_output_fine_proba: 999, p_input_scrap_proba: 585 }));
  // factory handover of refined gold: 1.98 @999 -> 3.3815 eq
  rec('S11.1', 'hand refined gold 1.98g@999 to factory', await rpc(U.M, 'rpc_record_factory_gold_handover', { p_source_type: 'refined_gold', p_physical_weight_g: 1.98, p_proba: 999, p_factory_recipient: 'Zavod', p_idempotency_key: 'fh-1' }));
  rec('S11.2', 'hand purchased gold 3.0g@750 to factory', await rpc(U.M, 'rpc_record_factory_gold_handover', { p_source_type: 'purchased_gold', p_physical_weight_g: 3.0, p_proba: 750 }));
  rec('S11.3', 'hand more refined gold than vault holds', await rpc(U.M, 'rpc_record_factory_gold_handover', { p_source_type: 'refined_gold', p_physical_weight_g: 10, p_proba: 999 }));
  rec('S11.4', 'seller attempts factory handover', await rpc(U.SA, 'rpc_record_factory_gold_handover', { p_source_type: 'refined_gold', p_physical_weight_g: 0.1, p_proba: 999 }));
  console.log(JSON.stringify(await su(`select * from company_rate_differences`)));
  console.log(JSON.stringify(await su(`select source_type, physical_weight_g, proba, agreed_equivalent_g, status from factory_gold_handovers`)));
  await pool.end();
})();
