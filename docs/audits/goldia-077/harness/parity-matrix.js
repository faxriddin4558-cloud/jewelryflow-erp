// Automatic director = manager permission matrix (077) with REAL GoTrue JWTs through PostgREST (exactly the UI path).
// Every Goldia Sales RPC the frontend calls (+ the 077 RPCs) is called by director, manager, seller, worker and a user of
// another organization with probe arguments that fail AFTER the permission check (unknown ids, zero amounts) or are
// harmless in the synthetic organization. Classification: DENY (42501 / permission), AMBIGUOUS (PGRST203), MISSING
// (PGRST202 = wrong argument names in the call), PASSES (the server let the role through its permission check).
// Expected: director and manager identical for every RPC except the test reset / cleanup functions (decision gate D-P1).
const fs = require('fs'); const path = require('path');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const Z = '00000000-0000-0000-0000-000000000000';
const today = L.tashkentToday();
const OTHER = TARGET === 'staging' ? 'directorB' : 'director56';
const ROLES = ['director', 'manager', 'sellera', 'worker', OTHER];
const EXCEPT = new Set(['rpc_execute_full_test_reset', 'rpc_preview_full_test_reset', 'rpc_execute_selective_test_cleanup', 'rpc_preview_selective_test_cleanup']);
const P = {
  // customers, legacy debt, sales, payments, reversals
  rpc_create_customer_with_code: null,
  rpc_archive_customer: { p_customer_id: Z, p_archive: true },
  rpc_record_client_legacy_debt: { p_customer_id: Z, p_balance_type: 'debt', p_amount_585_g: 1, p_as_of_date: today },
  rpc_reverse_client_legacy_debt: { p_legacy_debt_id: Z, p_reason: 'probe' },
  rpc_record_weight_sale: { p_customer_id: Z, p_weight_grams: 1, p_client_markup_pct: 10 },
  rpc_record_barcode_piece_sale: { p_customer_id: Z, p_piece_id: Z, p_client_markup_pct: 10 },
  rpc_record_client_jewelry_sale: { p_customer_id: Z, p_consignment_id: Z, p_client_markup_pct: 10 },
  rpc_record_currency_sale: { p_customer_id: Z, p_currency: 'USD', p_amount: 1, p_weight_grams: 1 },
  rpc_record_client_settlement: { p_customer_id: Z, p_cash_amount: 0 },
  rpc_record_client_currency_settlement: { p_customer_id: Z, p_currency: 'USD', p_usd_amount: 1 },
  rpc_reverse_client_sale: { p_sale_id: Z, p_reason: 'probe' },
  rpc_reverse_client_settlement: { p_settlement_id: Z, p_reason: 'probe' },
  rpc_reverse_client_currency_settlement: { p_settlement_id: Z, p_reason: 'probe' },
  rpc_reverse_customer_settlement: { p_settlement_id: Z, p_reversal_reason: 'probe' },
  // factory, stock, consignment, handovers
  rpc_record_factory_receipt: { p_product_name: 'probe', p_original_physical_g: 0, p_factory_markup_pct: 8 },
  rpc_reverse_factory_receipt: { p_receipt_id: Z, p_reason: 'probe' },
  rpc_issue_barcode_consignment: { p_seller_id: Z, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_pieces: [] },
  rpc_issue_seller_consignment: { p_seller_id: Z, p_product_id: Z, p_quantity: 0, p_factory_markup_pct: 8 },
  rpc_transfer_to_seller: { p_seller_id: Z, p_original_physical_g: 0 },
  rpc_reverse_barcode_consignment: { p_consignment_id: Z, p_reason: 'probe' },
  rpc_return_piece_to_manager: { p_piece_id: Z, p_notes: 'probe', p_idempotency_key: null },
  rpc_record_seller_to_manager_settlement: { p_seller_id: Z, p_cash_paid_amount: 0 },
  rpc_reverse_seller_to_manager_settlement: { p_settlement_id: Z, p_reason: 'probe' },
  rpc_record_manager_seller_settlement: { p_seller_id: Z },
  rpc_record_factory_gold_handover: { p_source_type: 'manager_stock', p_physical_weight_g: 0, p_proba: 585, p_agreed_equivalent_g: 0, p_factory_recipient: 'probe' },
  rpc_reverse_factory_gold_handover: { p_handover_id: Z, p_reason: 'probe' },
  rpc_record_refining_batch: { p_input_scrap_grams: 0, p_melted_weight_grams: 0, p_output_fine_grams: 0, p_input_scrap_proba: 585 },
  rpc_reverse_refining_batch: { p_batch_id: Z, p_reason: 'probe' },
  rpc_record_gold_purchase: { p_supplier_name: 'probe', p_cash_spent_uzs: 0, p_gold_weight_grams: 0, p_proba: 585 },
  rpc_reverse_gold_purchase: { p_purchase_id: Z, p_reason: 'probe' },
  // money, capital, accounting
  rpc_record_financial_transaction: { p_transaction_type: 'business_expense', p_source_till: 'manager_uzs', p_amount: 0, p_currency: 'UZS' },
  rpc_reverse_financial_transaction: { p_transaction_id: Z, p_reason: 'probe' },
  rpc_reclassify_capital_transaction: { p_transaction_id: Z, p_new_destination: 'manager_usd', p_reason: 'probe' },
  rpc_confirm_accounting_baseline: { p_notes: 'parity probe' },
  // rates, markups, settings
  rpc_set_daily_gold_rate: { p_rate_per_gram: 900000, p_rate_date: today },
  rpc_set_seller_rate_limits: { p_lom_min_uzs: 1, p_lom_max_uzs: 100000000, p_usd_min_uzs: 1, p_usd_max_uzs: 100000000 },
  rpc_manage_sales_markup_preset: { p_preset_id: Z, p_type: 'client_markup', p_name: 'probe', p_percentage: 1 },
  rpc_update_factory_settings: {},
  // reports
  rpc_get_period_report: { p_from: today, p_to: today },
  // a future end date passes the permission check and is then refused ("bugundan keyin"): the probe stores nothing.
  // (The first version used 2000-01-31, which really stored a period in the synthetic orgs - finding F77-11.)
  rpc_close_report_period: { p_end: '2099-12-31' },
  rpc_get_director_sales_overview: {},
  rpc_get_seller_sales_summary: {},
  rpc_get_accounting_profit_summary: {},
  rpc_get_seller_rates: {},
  rpc_get_daily_sales_ledger: { p_seller_id: null, p_start_date: today, p_end_date: today },
  rpc_get_unified_customer_ledger: { p_customer_id: Z, p_seller_id: null },
  // test-only (decision gate D-P1: stays director-only)
  rpc_preview_full_test_reset: {},
};
const cls = (r) => r.ok ? 'PASSES' : r.status === 300 || r.code === 'PGRST203' ? 'AMBIGUOUS' : r.code === 'PGRST202' ? 'MISSING'
  : (r.code === '42501' || /permission denied|ruxsat etilmadi|faqat direktor/i.test(r.error || '')) && !/sizga biriktirilmagan|boshqa tashkilot|boshqa sotuvchiga|o'z kassasi|o''z kassasi/i.test(r.error || '') ? 'DENY' : 'PASSES';
(async () => {
  const out = {}; const bad = []; const missing = [];
  for (const [name, args] of Object.entries(P)) {
    if (!args) continue;
    out[name] = {};
    for (const role of ROLES) { const r = await L.rpc(role, name, args); out[name][role] = { c: cls(r), e: (r.error || '').slice(0, 110) }; }
    const d = out[name].director.c, m = out[name].manager.c;
    if (d === 'MISSING' || m === 'MISSING' || d === 'AMBIGUOUS') missing.push(name);
    if (d !== m && !EXCEPT.has(name)) bad.push(`${name}: director=${d} manager=${m}`);
    console.log(name.padEnd(40), ROLES.map((r) => `${r}=${out[name][r].c}`).join(' '));
  }
  const res = { target: TARGET, at: new Date().toISOString(), director_manager_mismatches: bad, missing_or_ambiguous: missing, matrix: out };
  fs.writeFileSync(path.join(__dirname, '..', 'evidence', `${TARGET}-parity-matrix.json`), JSON.stringify(res, null, 1));
  console.log(`\nDIRECTOR vs MANAGER mismatches (excluding test reset): ${bad.length}${bad.length ? ' -> ' + bad.join('; ') : ''}`);
  console.log(`MISSING / AMBIGUOUS calls: ${missing.length}${missing.length ? ' -> ' + missing.join(', ') : ''}`);
  process.exit(bad.length || missing.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
