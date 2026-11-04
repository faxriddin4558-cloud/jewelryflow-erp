// STAGING (vouehtlmsunebracahon) only, synthetic audit organization users (audit.fx075.*), real GoTrue JWTs.
// 1) reproduces the incident: seller / manager legacy debt on staging at 075; 2) measures the server permission of every
//    write RPC the frontend calls, per role, with probe arguments that fail AFTER the permission check (unknown ids,
//    zero amounts) -> DENY (42501) / AMBIGUOUS (PGRST203) / MISSING (PGRST202) / PASSES-PERMISSION.
// Writes: only in the synthetic organization (one customer + the incident probe, reversed again).
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const fs = require('fs');
const Z = '00000000-0000-0000-0000-000000000000';
const ROLES = ['director', 'manager', 'sellera', 'worker', 'directorB'];
const PROBES = {
  rpc_record_client_legacy_debt: { p_customer_id: Z, p_balance_type: 'debt', p_amount_585_g: 1, p_as_of_date: L.tashkentToday() },
  rpc_reverse_client_legacy_debt: { p_legacy_debt_id: Z, p_reason: 'probe' },
  rpc_record_weight_sale: { p_customer_id: Z, p_weight_grams: 1, p_client_markup_pct: 10 },
  rpc_record_barcode_piece_sale: { p_customer_id: Z, p_piece_id: Z, p_client_markup_pct: 10 },
  rpc_record_client_jewelry_sale: { p_customer_id: Z, p_consignment_id: Z, p_client_markup_pct: 10 },
  rpc_record_client_settlement: { p_customer_id: Z, p_cash_amount: 0 },
  rpc_record_seller_to_manager_settlement: { p_seller_id: Z, p_cash_paid_amount: 0 },
  rpc_reverse_client_sale: { p_sale_id: Z, p_reason: 'probe' },
  rpc_reverse_client_settlement: { p_settlement_id: Z, p_reason: 'probe' },
  rpc_reverse_seller_to_manager_settlement: { p_settlement_id: Z, p_reason: 'probe' },
  rpc_return_piece_to_manager: { p_piece_id: Z, p_reason: 'probe' },
  rpc_issue_barcode_consignment: { p_seller_id: Z, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_pieces: [] },
  rpc_issue_seller_consignment: { p_seller_id: Z, p_product_id: Z, p_quantity: 0, p_factory_markup_pct: 8 },
  rpc_reverse_barcode_consignment: { p_consignment_id: Z, p_reason: 'probe' },
  rpc_record_factory_receipt: { p_product_name: 'probe', p_original_physical_g: 0, p_factory_markup_pct: 8 },
  rpc_reverse_factory_receipt: { p_receipt_id: Z, p_reason: 'probe' },
  rpc_record_factory_gold_handover: { p_gold_weight_g: 0 },
  rpc_reverse_factory_gold_handover: { p_handover_id: Z, p_reason: 'probe' },
  rpc_record_financial_transaction: { p_transaction_type: 'expense', p_source_till: 'manager_cash', p_amount: 0, p_currency: 'UZS' },
  rpc_reverse_financial_transaction: { p_transaction_id: Z, p_reason: 'probe' },
  rpc_record_gold_purchase: { p_physical_weight_g: 0 },
  rpc_reverse_gold_purchase: { p_purchase_id: Z, p_reason: 'probe' },
  rpc_record_refining_batch: { p_input_scrap_grams: 0, p_melted_weight_grams: 0, p_output_fine_grams: 0, p_input_scrap_proba: 585 },
  rpc_reverse_refining_batch: { p_batch_id: Z, p_reason: 'probe' },
  rpc_manage_sales_markup_preset: { p_action: 'toggle', p_preset_id: Z },
  rpc_reclassify_capital_transaction: { p_transaction_id: Z },
  rpc_create_customer_with_code: null, // real write, tested separately
};
const cls = (r) => r.ok ? 'PASSES' : r.status === 300 || r.code === 'PGRST203' ? 'AMBIGUOUS' : r.code === 'PGRST202' ? 'MISSING' : (r.code === '42501' || /permission denied|ruxsat etilmadi/i.test(r.error || '')) && !/sizga biriktirilmagan|boshqa tashkilot/i.test(r.error || '') ? 'DENY' : 'PASSES';
(async () => {
  const out = { at: new Date().toISOString(), incident: [], matrix: {} };
  // ---- 1. incident
  const cu = await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `INCIDENT 206.83 ${Date.now().toString(36)}` });
  out.incident.push({ step: 'seller creates own customer', ok: cu.ok, customer_id: cu.ok ? cu.data.customer_id : null, error: cu.error });
  if (cu.ok) {
    const args = { p_customer_id: cu.data.customer_id, p_balance_type: 'debt', p_amount_585_g: 206.83, p_as_of_date: L.tashkentToday(), p_notes: 'incident repro', p_entry_type: 'manual_addition', p_target_final_balance: null, p_idempotency_key: `INC-${Date.now()}` };
    for (const role of ['sellera', 'manager']) {
      const r = await L.rpc(role, 'rpc_record_client_legacy_debt', args);
      out.incident.push({ step: `${role} enters 206.83 g legacy debt (UI shows the button)`, ok: r.ok, status: r.status, code: r.code, error: r.error && r.error.slice(0, 160) });
      console.log(`INCIDENT ${role}: ${r.ok ? 'ACCEPTED' : r.status + ' ' + r.code + ' ' + r.error}`);
    }
  }
  // ---- 2. matrix
  for (const [name, args] of Object.entries(PROBES)) {
    if (!args) continue;
    out.matrix[name] = {};
    for (const role of ROLES) { const r = await L.rpc(role, name, args); out.matrix[name][role] = { c: cls(r), e: (r.error || '').slice(0, 110) }; }
    console.log(name.padEnd(42), ROLES.map((r) => `${r}=${out.matrix[name][r].c}`).join(' '));
  }
  fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
})();
