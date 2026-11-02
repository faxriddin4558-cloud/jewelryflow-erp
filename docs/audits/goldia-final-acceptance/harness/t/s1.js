const { U, rpc, su, rec, pool } = require('./lib');
const { snap } = require('./snap');
(async () => {
  const out = {};
  rec('S1.1', 'director sets 585 rate 950000', await rpc(U.D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 950000 }));
  out.r1 = rec('S2.1', 'manager factory receipt 100g @8%', await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'Uzuk partiyasi', p_quantity: 4, p_original_physical_g: 100, p_factory_markup_pct: 8, p_idempotency_key: 'fr-1' }));
  out.r1dup = rec('S2.1b', 'RETRY same receipt same idempotency key fr-1', await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'Uzuk partiyasi', p_quantity: 4, p_original_physical_g: 100, p_factory_markup_pct: 8, p_idempotency_key: 'fr-1' }));
  out.r2 = rec('S2.2', 'manager factory receipt 50g @6%', await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'Sirg\'a', p_quantity: 3, p_original_physical_g: 50, p_factory_markup_pct: 6 }));
  out.r3 = rec('S2.3', 'manager factory receipt 20g @10%', await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'Zanjir', p_quantity: 1, p_original_physical_g: 20, p_factory_markup_pct: 10 }));
  rec('S2.4', 'seller tries factory receipt', await rpc(U.SA, 'rpc_record_factory_receipt', { p_product_name: 'x', p_original_physical_g: 5 }));
  rec('S2.5', 'manager receipt negative markup -50', await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'neg', p_original_physical_g: 1, p_factory_markup_pct: -50 }));
  console.log('SNAP', JSON.stringify(await snap()));
  await pool.end();
})();
