const { U, rpc, su, pool } = require('./lib');
(async () => {
  const r = await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'post-reset', p_original_physical_g: 10, p_factory_markup_pct: 8 });
  const c = await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: r.data.receipt_id, p_pieces: [{ weight_grams: 5 }] });
  const acc = await su(`select e.employee_code, current_physical_stock_g, total_seller_obligation_g, seller_owes_manager_g from seller_gold_accounts s join employees e on e.id=s.seller_id where seller_owes_manager_g<>0 or current_physical_stock_g<>0`);
  const v = await su(`select total_factory_obligation_g, current_factory_obligation_g, manager_physical_stock_g from manager_vault_account`);
  const m = await rpc(U.D, 'get_manager_available_stock_grams', {});
  console.log(JSON.stringify({ receipt: r.ok, consign: c.ok ? 'ok' : c.error, sellers: acc, vault: v, mgr_stock_fn: m.data }, null, 1));
  await pool.end();
})();
