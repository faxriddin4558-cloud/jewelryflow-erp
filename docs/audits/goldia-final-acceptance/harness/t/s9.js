const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  const r3 = (await su(`select id from factory_receipts where original_physical_g=20`))[0].id;
  const r1 = (await su(`select id from factory_receipts where original_physical_g=100 and status<>'reversed'`))[0].id;
  const cc = rec('S13.0', 'issue SC consignment 2 pieces 2.0+3.0 from R1 f8 s12', await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SC, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_pieces: [{ weight_grams: 2.0, model_code: 'UZ-01' }, { weight_grams: 3.0, model_code: 'SR-02' }], p_factory_receipt_id: r1 }));
  const cust = (await rpc(U.SC, 'rpc_create_customer_with_code', { p_contact_name: 'Mijoz C1 (sintetik)' })).data.customer_id;
  const stockBefore = (await rpc(U.SC, 'get_seller_available_stock_grams', { p_seller_id: U.SC })).data;
  rec('S13.1', 'SC weight sale 11.0g @10% (consumes 10g piece fully + 1g partial)', await rpc(U.SC, 'rpc_record_weight_sale', { p_customer_id: cust, p_weight_grams: 11.0, p_client_markup_pct: 10 }));
  console.log(JSON.stringify(await su(`select sc.consignment_no, sc.quantity, sc.sold_quantity, sc.base_weight_grams, sc.status, (select json_agg(json_build_object('w',weight_grams,'s',status)) from consignment_pieces p where p.consignment_id=sc.id) pcs from seller_consignments sc where seller_id=$1`, [U.SC])));
  rec('S13.2', 'SC whole-consignment sale (mobile RPC) of the 2-piece consignment @200%', await rpc(U.SC, 'rpc_record_client_jewelry_sale', { p_customer_id: cust, p_consignment_id: cc.data.consignment_id, p_client_markup_pct: 200 }));
  const sold = await su(`select coalesce(sum(base_weight_grams),0) g from jewelry_sales where seller_id=$1 and status not in ('reversed','cancelled')`, [U.SC]);
  console.log('SC stock before', stockBefore, 'consigned=15, sold grams now', sold[0].g, 'stock now', (await rpc(U.SC, 'get_seller_available_stock_grams', { p_seller_id: U.SC })).data);
  await pool.end();
})();
