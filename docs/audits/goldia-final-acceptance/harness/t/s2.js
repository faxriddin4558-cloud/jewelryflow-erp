const { U, rpc, su, rec, pool } = require('./lib');
const { snap } = require('./snap');
(async () => {
  const rc = await su(`select id, original_physical_g, factory_markup_pct, created_at from factory_receipts order by created_at`);
  const h = rc.filter(r => Number(r.original_physical_g) === 100); const r1 = h[0].id, r1dup = h[1] ? h[1].id : null; const r2 = rc.find(r => Number(r.original_physical_g) === 50).id, r3 = rc.find(r => Number(r.original_physical_g) === 20).id;
  if (r1dup) { rec('S2.6', 'manager reverses duplicate receipt', await rpc(U.M, 'rpc_reverse_factory_receipt', { p_receipt_id: r1dup, p_reason: 'duplicate' }));
  rec('S2.7', 'double reversal of same receipt', await rpc(U.M, 'rpc_reverse_factory_receipt', { p_receipt_id: r1dup, p_reason: 'duplicate again' })); } else rec('S2.6', 'no duplicate receipt exists (idempotent retry returned the original)', { ok: true });
  const extra = await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'reverse-test', p_original_physical_g: 1, p_factory_markup_pct: 8 });
  rec('S2.8', 'reverse a fresh 1 g receipt', await rpc(U.M, 'rpc_reverse_factory_receipt', { p_receipt_id: extra.data.receipt_id, p_reason: 'test' }));
  rec('S2.9', 'double reversal of same receipt', await rpc(U.M, 'rpc_reverse_factory_receipt', { p_receipt_id: extra.data.receipt_id, p_reason: 'again' }));
  // models
  const pa = [{ weight_grams: 3.25, model_code: 'UZ-01', model_name: 'Uzuk A', purity: 585, raw_barcode: 'UZ-01|3.25' },
              { weight_grams: 5.10, model_code: 'SR-02', model_name: "Sirg'a B", purity: 585, raw_barcode: 'SR-02|5.10' },
              { weight_grams: 7.65, model_code: 'ZN-03', model_name: 'Zanjir C', purity: 585, raw_barcode: 'ZN-03|7.65' },
              { weight_grams: 12.00, model_code: 'BL-04', model_name: 'Bilakuzuk D', purity: 585, raw_barcode: 'BL-04|12.00' }];
  rec('S3.1', 'issue consignment to SA 28g from R1 f8% s12%', await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_pieces: pa, p_factory_receipt_id: r1, p_idempotency_key: 'cons-a' }));
  rec('S3.1b', 'retry consignment same key', await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_pieces: pa, p_factory_receipt_id: r1, p_idempotency_key: 'cons-a' }));
  const pb = [{ weight_grams: 4.4, model_code: 'UZ-01', purity: 585 }, { weight_grams: 6.6, model_code: 'SR-02', purity: 585 }, { weight_grams: 9.0, model_code: 'ZN-03', purity: 585 }];
  rec('S3.2', 'issue consignment to SB 20g from R2 f6% s10%', await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SB, p_factory_markup_pct: 6, p_seller_markup_pct: 10, p_pieces: pb, p_factory_receipt_id: r2 }));
  rec('S3.3', 'issue consignment to SC 10g from R3 f10% s15%', await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SC, p_factory_markup_pct: 10, p_seller_markup_pct: 15, p_pieces: [{ weight_grams: 10, model_code: 'BL-04', purity: 585 }], p_factory_receipt_id: r3 }));
  rec('S3.4', 'seller A tries to issue consignment to self', await rpc(U.SA, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_pieces: [{ weight_grams: 1 }] }));
  rec('S3.5', 'consign more than receipt R3 holds (10g left, ask 11)', await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SC, p_factory_markup_pct: 10, p_pieces: [{ weight_grams: 11 }], p_factory_receipt_id: r3 }));
  rec('S3.6', 'consign to director (non-seller) employee', await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.D, p_factory_markup_pct: 8, p_pieces: [{ weight_grams: 0.001 }], p_factory_receipt_id: r3 }));
  rec('S3.7', 'consign to inactive seller', await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SX, p_factory_markup_pct: 8, p_pieces: [{ weight_grams: 0.002 }], p_factory_receipt_id: r3 }));
  rec('S3.8', 'consign piece purity 750 into 585-only stock', await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SC, p_factory_markup_pct: 10, p_pieces: [{ weight_grams: 0.003, purity: 750 }], p_factory_receipt_id: r3 }));
  console.log('SNAP', JSON.stringify(await snap()));
  await pool.end();
})();
