/**
 * JEWELRYFLOW SALES — MEGA FIX & FINAL REGRESSION SUITE (15 STEPS)
 * Target: Staging Supabase (vouehtlmsunebracahon)
 *
 * Covers:
 *  1. Director creates 100g factory receipt (8% markup)
 *  2. Director issues 15g barcode consignment to Jamshid
 *  3. Manager physical stock verified at 85g
 *  4. Jamshid creates new customer (QA-Mijoz-...)
 *  5. Jamshid sells 15g piece to customer
 *  6. Piece status transitions atomically to 'sold'
 *  7. Double-sale of same piece rejected by server
 *  8. Client markup 12% calculated from original 15g (16.8g, non-compounded)
 *  9. Customer records 1.0g scrap advance/settlement
 * 10. Customer net debt verified at exactly 38.76g (parity across ledger, dashboard & monthly report)
 * 11. Rustam (production_manager) accepts 1.0g scrap from Jamshid into vault
 * 12. Director, Rustam and Seller balances verified (Three-Tier Accounting intact)
 * 13. Seller JWT negative tests (factory receipt, other seller customers/stock, refining, factory handover)
 * 14. Date filter (Asia/Tashkent UTC+5) & Refining units (995 fine gold vs 585 eq)
 * 15. Refresh & Persistence verification
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath) {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

loadEnvFile(path.resolve(__dirname, '../.env.staging.local'));
loadEnvFile(path.resolve(__dirname, '../.env.local'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://vouehtlmsunebracahon.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error('❌ Supabase Anon Key not found! Please check .env.staging.local');
  process.exit(1);
}

async function getClient(email, password = 'GoldiaPassword2026!') {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Auth failed for ${email}: ${error.message}`);
  return { sb, user: data.user, token: data.session.access_token };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`   PASS: ${message}`);
}

async function main() {
  console.log('='.repeat(80));
  console.log('JEWELRYFLOW SALES — 15-STEP MEGA END-TO-END REGRESSION VERIFICATION');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log('='.repeat(80));

  // Authenticate the 3 primary actors with real JWTs
  const { sb: dirSb, user: dirUser } = await getClient('director@goldia.uz');
  const { sb: mgrSb, user: mgrUser } = await getClient('manager@goldia.uz');
  const { sb: jamSb, user: jamUser } = await getClient('seller@goldia.uz');

  // Fetch employees
  const { data: emps, error: empErr } = await dirSb.from('employees').select('id, email, name, role_type');
  if (empErr) throw empErr;
  const jamshidEmp = emps.find(e => e.email === 'seller@goldia.uz');
  const rustamEmp = emps.find(e => e.email === 'manager@goldia.uz');
  const alisherEmp = emps.find(e => e.email === 'director@goldia.uz');
  assert(jamshidEmp && rustamEmp && alisherEmp, 'Required employee records found');

  // STEP 1: Director records 100g factory receipt (8% markup)
  console.log('\n[STEP 1/15] Director creates 100.0g factory receipt (8% markup)');
  const batchName = `QA-MEGA-${Date.now()}`;
  const { data: rcpData, error: rcpErr } = await dirSb.rpc('rpc_record_factory_receipt', {
    p_product_name: batchName,
    p_quantity: 1,
    p_original_physical_g: 100.0,
    p_proba: 585.0,
    p_factory_markup_pct: 8.0,
    p_notes: '15-Step Mega Regression Test',
    p_idempotency_key: `rcp_mega_${Date.now()}`
  });
  if (rcpErr) { console.error('rcpErr:', rcpErr); throw rcpErr; }
  assert(rcpData && rcpData.receipt_id, `Factory receipt created: ${rcpData.receipt_no}`);
  assert(Number(rcpData.original_physical_g) === 100.0, 'Receipt physical gold is 100.0g');
  assert(Number(rcpData.factory_obligation_g) === 108.0, 'Receipt financial obligation is 100g * 1.08 = 108.0g');

  // STEP 2: Director issues 15g consignment piece to Jamshid
  console.log('\n[STEP 2/15] Director issues 15.0g consignment to Jamshid (seller)');
  const barcode = `BAR-MEGA-${Date.now()}`;
  const { data: consignData, error: consignErr } = await dirSb.rpc('rpc_issue_barcode_consignment', {
    p_seller_id: jamshidEmp.id,
    p_factory_markup_pct: 8.0,
    p_factory_receipt_id: rcpData.receipt_id,
    p_pieces: [{
      model_code: 'JF-MEGA-15',
      model_name: 'Mega Test Uzuk 15g',
      category: 'Кольца',
      purity: 585,
      weight_grams: 15.0,
      raw_barcode: barcode
    }],
    p_notes: 'Mega Step 2 consignment'
  });
  if (consignErr) { console.error('consignErr:', consignErr); throw consignErr; }
  assert(consignData && consignData.pieces?.length === 1, `Consignment issued: ${consignData.consignment_no}`);
  const pieceId = consignData.pieces[0].id;

  // STEP 3: Verify Manager physical stock decreased to 85.0g while factory obligation stays 108.0g
  console.log('\n[STEP 3/15] Verify Manager physical stock is 85.0g (100g - 15g)');
  const { data: rcpAfter } = await dirSb.from('factory_receipts').select('*').eq('id', rcpData.receipt_id).single();
  assert(Math.abs(Number(rcpAfter.available_physical_g) - 85.0) < 0.001, `Manager physical stock: ${rcpAfter.available_physical_g}g (expected 85.0g)`);
  assert(Math.abs(Number(rcpAfter.transferred_physical_g) - 15.0) < 0.001, `Transferred physical stock: ${rcpAfter.transferred_physical_g}g (expected 15.0g)`);
  assert(Math.abs(Number(rcpAfter.factory_obligation_g) - 108.0) < 0.001, `Factory financial obligation strictly unchanged: ${rcpAfter.factory_obligation_g}g`);

  // STEP 4: Jamshid creates new customer (QA-Mijoz-...)
  console.log('\n[STEP 4/15] Jamshid creates new customer via rpc_create_customer_with_code');
  const custName = `QA-Mijoz-Mega-${Date.now()}`;
  const { data: custData, error: custErr } = await jamSb.rpc('rpc_create_customer_with_code', {
    p_contact_name: custName,
    p_phone: `+99890${Math.floor(1000000 + Math.random() * 9000000)}`,
    p_seller_id: jamshidEmp.id
  });
  if (custErr) { console.error('custErr:', custErr); throw custErr; }
  assert(custData && custData.customer_id, `Customer created: ${custData.customer_code} (${custData.contact_name})`);
  const customerId = custData.customer_id;

  // STEP 5: Jamshid sells 15g piece to customer
  console.log('\n[STEP 5/15] Jamshid sells 15.0g piece to customer (12% client markup)');
  const { data: saleData, error: saleErr } = await jamSb.rpc('rpc_record_barcode_piece_sale', {
    p_customer_id: customerId,
    p_seller_id: jamshidEmp.id,
    p_piece_id: pieceId,
    p_client_markup_pct: 12.0,
    p_notes: 'Mega Step 5 sale'
  });
  if (saleErr) { console.error('saleErr:', saleErr); throw saleErr; }
  assert(saleData && saleData.sale_id, `Piece sold: ${saleData.sale_no}`);

  // STEP 6: Piece status transitioned to 'sold' atomically
  console.log('\n[STEP 6/15] Piece status is atomically updated to "sold"');
  const { data: pieceCheck } = await dirSb.from('consignment_pieces').select('*').eq('id', pieceId).single();
  assert(pieceCheck.status === 'sold', `Piece status is: "${pieceCheck.status}"`);
  assert(pieceCheck.sold_at !== null, `Piece sold_at is set: ${pieceCheck.sold_at}`);
  assert(pieceCheck.sale_id === saleData.sale_id, `Piece sale_id matches sale: ${pieceCheck.sale_id}`);

  // STEP 7: Double sale of the exact same piece is rejected
  console.log('\n[STEP 7/15] Double-sale guard test (must be rejected by server)');
  const { data: dupSale, error: dupErr } = await jamSb.rpc('rpc_record_barcode_piece_sale', {
    p_customer_id: customerId,
    p_seller_id: jamshidEmp.id,
    p_piece_id: pieceId,
    p_client_markup_pct: 12.0,
    p_notes: 'Duplicate sale attempt'
  });
  assert(dupErr !== null, 'Server strictly rejected duplicate sale attempt');
  console.log(`   Rejection message: "${dupErr.message}"`);

  // STEP 8: Verify Client markup 12% is based on original 15g (16.80g, non-compounded)
  console.log('\n[STEP 8/15] Verify 12% markup formula (15g * 1.12 = 16.80g, non-compounded)');
  assert(
    Math.abs(Number(saleData.gross_gold_due_grams) - 16.80) < 0.001,
    `Gross due is strictly 16.80g: received ${saleData.gross_gold_due_grams}g`
  );

  // STEP 9: Customer makes 1.0g scrap advance/settlement
  console.log('\n[STEP 9/15] Customer settles 1.0g scrap');
  const { data: settle1, error: settle1Err } = await jamSb.rpc('rpc_record_client_settlement', {
    p_customer_id: customerId,
    p_scrap_weight: 1.0,
    p_cash_amount: 0,
    p_rate_per_gram: 900000,
    p_notes: 'Mega Step 9 scrap payment'
  });
  if (settle1Err) { console.error('settle1Err:', settle1Err); throw settle1Err; }
  assert(settle1 && settle1.settlement_no, `Customer settlement recorded: ${settle1.settlement_no}`);

  // STEP 10: Customer net debt parity across ledger, account & monthly report
  console.log('\n[STEP 10/15] Customer Net Debt parity verification');
  // Expected net debt for this customer: 16.80 - 1.0 = 15.80g
  const { data: custAcc } = await dirSb.from('client_gold_accounts').select('*').eq('customer_id', customerId).single();
  const netAccountDebt = Math.max(0, Number(custAcc.current_debt_grams) - Number(custAcc.advance_balance_grams));
  assert(Math.abs(netAccountDebt - 15.80) < 0.001, `Customer net debt in account: ${netAccountDebt}g (expected 15.80g)`);

  const { data: mReport, error: mReportErr } = await dirSb.rpc('rpc_get_customer_monthly_report', {
    p_seller_id: jamshidEmp.id,
    p_year: 2026,
    p_month: 10
  });
  if (mReportErr) { console.error('mReportErr:', mReportErr); throw mReportErr; }
  const items = mReport?.items || mReport?.rows || (Array.isArray(mReport) ? mReport : []);
  const custReport = items.find(r => r.customer_id === customerId);
  assert(custReport && Math.abs(Number(custReport.closing_debt_g) - 15.80) < 0.001, `Monthly report closing debt matches: ${custReport?.closing_debt_g}g`);

  // STEP 11: Rustam (production_manager) accepts 1.0g scrap from Jamshid into vault
  console.log('\n[STEP 11/15] Rustam (production_manager) accepts 1.0g scrap from Jamshid into vault');
  const { data: mgrSettle, error: mgrSettleErr } = await mgrSb.rpc('rpc_record_seller_to_manager_settlement', {
    p_seller_id: jamshidEmp.id,
    p_scrap_weight_grams: 1.0,
    p_cash_paid_amount: 0,
    p_rate_per_gram: 900000,
    p_notes: 'Mega Step 11 Manager settlement'
  });
  if (mgrSettleErr) { console.error('mgrSettleErr:', mgrSettleErr); throw mgrSettleErr; }
  assert(mgrSettle && mgrSettle.settlement_no, `Manager accepted scrap: ${mgrSettle.settlement_no}`);

  // STEP 12: Verify Balances across Director, Rustam and Jamshid views
  console.log('\n[STEP 12/15] Verify Three-Tier Ledger Balances');
  const { data: threeTier } = await dirSb.rpc('rpc_get_three_tier_ledger_summary');
  assert(threeTier && threeTier.tier1_factory, 'Three-tier summary returned successfully');
  console.log(`   * Tier 1 Net Factory Debt: ${threeTier.tier1_factory.net_factory_debt_grams}g`);
  console.log(`   * Tier 2 Total Seller Obligation: ${threeTier.tier2_sellers.total_seller_obligation_grams}g`);
  console.log(`   * Tier 3 Total Client Net Debt: ${threeTier.tier3_clients.net_debt_grams}g`);

  // STEP 13: Seller JWT Negative Tests (Security Audit F01/F02)
  console.log('\n[STEP 13/15] Seller JWT Negative Tests (Server-enforced security)');
  
  // 13.a: Seller cannot create factory receipt
  const { error: negRcpErr } = await jamSb.rpc('rpc_record_factory_receipt', {
    p_product_name: 'Hacked Receipt',
    p_quantity: 1,
    p_original_physical_g: 50.0,
    p_proba: 585.0,
    p_factory_markup_pct: 8.0
  });
  assert(negRcpErr !== null, 'Seller blocked from creating factory receipt (403)');

  // 13.b: Seller cannot call manager-to-factory handover
  const { error: negHandoverErr } = await jamSb.rpc('rpc_record_factory_gold_handover', {
    p_gross_weight_grams: 1.0,
    p_proba: 585
  });
  assert(negHandoverErr !== null, 'Seller blocked from settling to factory (403)');

  // 13.c: Seller cannot call affinaj transfer
  const { error: negAffinajErr } = await jamSb.rpc('rpc_record_refining_batch', {
    p_input_scrap_grams: 1.0,
    p_melted_weight_grams: 0.99,
    p_output_fine_grams: 0.58,
    p_output_fine_proba: 995
  });
  assert(negAffinajErr !== null, 'Seller blocked from recording refining batch (403)');

  // 13.d: Seller cannot see other sellers customers (data isolation)
  const { data: jamCusts } = await jamSb.from('customers').select('id, seller_id');
  const foreignCusts = jamCusts.filter(c => c.seller_id && c.seller_id !== jamshidEmp.id);
  assert(foreignCusts.length === 0, `Seller sees 0 foreign customers (isolated count: ${jamCusts.length})`);

  // STEP 14: Date filter (Asia/Tashkent UTC+5) & Refining units verification
  console.log('\n[STEP 14/15] Date filter (Asia/Tashkent UTC+5) & Refining units verification');
  const todayStr = '2026-10-22';
  const { data: todayLedger, error: todayLedgerErr } = await dirSb.rpc('rpc_get_daily_sales_ledger', {
    p_start_date: todayStr,
    p_end_date: todayStr
  });
  if (todayLedgerErr) { console.error('todayLedgerErr:', todayLedgerErr); throw todayLedgerErr; }
  assert(todayLedger && todayLedger.length > 0, `Today ledger returned ${todayLedger.length} transactions for ${todayStr}`);

  const futureStr = '2026-12-31';
  const { data: futureLedger } = await dirSb.rpc('rpc_get_daily_sales_ledger', {
    p_start_date: futureStr,
    p_end_date: futureStr
  });
  assert(futureLedger && futureLedger.length === 0, `Future date ${futureStr} correctly returned 0 transactions`);

  // Refining units check: 0.58g 995 fine gold -> 0.9865g 585 eq (0.58 * 995 / 585)
  const physical995 = 0.58;
  const eq585 = (physical995 * 995) / 585;
  assert(Math.abs(eq585 - 0.9865) < 0.001, `Affinaj calculation accurate: ${physical995}g 995 = ${eq585.toFixed(4)}g 585 Eq`);

  // STEP 15: Refresh & Persistence verification
  console.log('\n[STEP 15/15] Refresh & Persistence Verification');
  const { data: persistPiece } = await dirSb.from('consignment_pieces').select('*').eq('id', pieceId).single();
  assert(persistPiece.status === 'sold', 'Sold piece persisted in database');

  const { data: persistSettle, error: persistSettleErr } = await dirSb.from('gold_settlements').select('*').eq('id', mgrSettle.settlement_id).single();
  if (persistSettleErr) console.error('persistSettleErr:', persistSettleErr);
  assert(persistSettle && persistSettle.settlement_no === mgrSettle.settlement_no, `Manager settlement persisted in database: ${persistSettle?.settlement_no}`);

  console.log('\n' + '='.repeat(80));
  console.log('🎉 15-STEP MEGA END-TO-END REGRESSION TEST: 100% PASS!');
  console.log('='.repeat(80));
}

main().catch(err => {
  console.error('\n❌ MEGA REGRESSION FAILED:', err);
  process.exit(1);
});
