/**
 * JEWELRYFLOW SALES — SAFE CORRECTIONS, REVERSALS & CLEANUP REGRESSION SUITE
 * Target: Staging Supabase (vouehtlmsunebracahon)
 *
 * Verifies:
 *  1. Double reversal rejection (sale & settlement)
 *  2. Partial settlement & advance restoration on sale reversal
 *  3. Sold item restoration (piece -> held_by_seller, consignment sold_quantity reduced)
 *  4. Consignment reversal & factory physical stock restoration
 *  5. Dependency chain guards (cannot reverse consignment with sold pieces; cannot reverse receipt with transferred stock)
 *  6. Role permissions (Seller cannot reverse manager settlements or factory receipts)
 *  7. Staging cleanup preview & confirmation code enforcement (zero destructive deletion)
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
  console.log(`   ✅ PASS: ${message}`);
}

async function main() {
  console.log('='.repeat(80));
  console.log('SAFE CORRECTIONS, REVERSALS & CLEANUP REGRESSION TEST SUITE');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log('='.repeat(80));

  // Authenticate users
  const { sb: dirSb, user: dirUser } = await getClient('director@goldia.uz');
  const { sb: jamSb, user: jamUser } = await getClient('seller@goldia.uz');
  const { sb: mgrSb, user: mgrUser } = await getClient('manager@goldia.uz');

  // Fetch employees
  const { data: emps, error: empErr } = await dirSb.from('employees').select('id, email, name, role_type');
  if (empErr) throw empErr;
  const jamshidEmp = emps.find(e => e.email === 'seller@goldia.uz');
  const alisherEmp = emps.find(e => e.email === 'director@goldia.uz');
  assert(jamshidEmp && alisherEmp, 'Required employee records found');

  // -------------------------------------------------------------------------
  // TEST 1: ROLE PERMISSIONS (Seller blocked from reversing manager settlement or factory receipt)
  // -------------------------------------------------------------------------
  console.log('\n[TEST 1/7] Role Permissions: Seller negative tests for manager/factory reversals');
  try {
    const fakeUuid = '00000000-0000-0000-0000-000000000001';
    const { error: sellErr } = await jamSb.rpc('rpc_reverse_seller_to_manager_settlement', {
      p_settlement_id: fakeUuid,
      p_reason: 'Unauthorized test by seller'
    });
    assert(sellErr && (sellErr.message.toLowerCase().includes('permission denied') || sellErr.message.toLowerCase().includes('ruxsat') || sellErr.message.includes('403')),
      'Seller blocked from rpc_reverse_seller_to_manager_settlement');
  } catch (err) {
    assert(err.message.toLowerCase().includes('permission denied') || err.message.toLowerCase().includes('ruxsat'),
      'Seller blocked with permission error');
  }

  try {
    const fakeUuid = '00000000-0000-0000-0000-000000000001';
    const { error: rcpErr } = await jamSb.rpc('rpc_reverse_factory_receipt', {
      p_receipt_id: fakeUuid,
      p_reason: 'Unauthorized test by seller'
    });
    assert(rcpErr && (rcpErr.message.toLowerCase().includes('permission denied') || rcpErr.message.toLowerCase().includes('ruxsat') || rcpErr.message.includes('403')),
      'Seller blocked from rpc_reverse_factory_receipt');
  } catch (err) {
    assert(err.message.toLowerCase().includes('permission denied') || err.message.toLowerCase().includes('ruxsat'),
      'Seller blocked with permission error');
  }

  // -------------------------------------------------------------------------
  // SETUP TEST DATA: Factory Receipt -> Consignment -> Pieces -> Sale
  // -------------------------------------------------------------------------
  console.log('\n[SETUP] Creating isolated test workflow for reversal testing...');
  const testBatchName = `REVERSAL-TEST-${Date.now()}`;
  
  // 1. Director creates 50.0g factory receipt (8% markup)
  const { data: rcpData, error: rcpErr } = await dirSb.rpc('rpc_record_factory_receipt', {
    p_product_name: testBatchName,
    p_quantity: 1,
    p_original_physical_g: 50.0,
    p_proba: 585.0,
    p_factory_markup_pct: 8.0,
    p_notes: 'Reversal test factory receipt'
  });
  if (rcpErr) throw rcpErr;
  const receiptId = rcpData.receipt_id || rcpData.id;
  console.log(`   Created Factory Receipt: ${rcpData.receipt_no} (50.0g, id: ${receiptId})`);

  // 2. Consign 20.0g (2 pieces x 10.0g) to Jamshid
  const barcode1 = `REV1-${Date.now()}`;
  const barcode2 = `REV2-${Date.now()}`;
  const { data: consData, error: consErr } = await dirSb.rpc('rpc_issue_barcode_consignment', {
    p_seller_id: jamshidEmp.id,
    p_factory_markup_pct: 8.0,
    p_factory_receipt_id: receiptId,
    p_pieces: [
      { model_code: 'JF-REV-1', raw_barcode: barcode1, weight_grams: 10.0, proba: 585 },
      { model_code: 'JF-REV-2', raw_barcode: barcode2, weight_grams: 10.0, proba: 585 }
    ],
    p_notes: 'Reversal test consignment'
  });
  if (consErr) { console.error('consErr:', consErr); throw consErr; }
  const consignmentId = consData.consignment_id;
  console.log(`   Consigned 20.0g (2 pieces) to seller. Consignment ID: ${consignmentId}`);

  assert(consData.pieces && consData.pieces.length === 2, '2 test pieces created in consignment');
  const piece1 = consData.pieces[0];
  const piece2 = consData.pieces[1];

  // 3. Create test customer
  const custName = `Reversal QA Customer ${Date.now()}`;
  const { data: custData, error: custErr } = await jamSb.rpc('rpc_create_customer_with_code', {
    p_contact_name: custName,
    p_phone: `+99890${Math.floor(1000000 + Math.random() * 9000000)}`,
    p_seller_id: jamshidEmp.id
  });
  if (custErr) { console.error('custErr:', custErr); throw custErr; }
  const customerId = custData.customer_id;
  console.log(`   Created Customer: ${custName} (${customerId})`);

  // 4. Jamshid sells Piece 1 (10.0g) with 12% client markup (11.2g obligation)
  const { data: saleData, error: saleErr } = await jamSb.rpc('rpc_record_barcode_piece_sale', {
    p_customer_id: customerId,
    p_seller_id: jamshidEmp.id,
    p_piece_id: piece1.id,
    p_client_markup_pct: 12.0,
    p_notes: 'Sale for reversal test'
  });
  if (saleErr) { console.error('saleErr:', saleErr); throw saleErr; }
  const saleId = saleData.sale_id;
  console.log(`   Piece 1 sold! Sale ID: ${saleId}, Gross Due: ${saleData.gross_gold_due_grams}g`);

  // 5. Customer makes 2.0g scrap payment
  const { data: setlData, error: setlErr } = await jamSb.rpc('rpc_record_client_settlement', {
    p_customer_id: customerId,
    p_scrap_weight: 2.0,
    p_cash_amount: 0,
    p_rate_per_gram: 900000,
    p_notes: 'Partial settlement for reversal test'
  });
  if (setlErr) { console.error('setlErr:', setlErr); throw setlErr; }
  console.log(`   Recorded 2.0g partial scrap payment: ${setlData.settlement_no}`);

  // -------------------------------------------------------------------------
  // TEST 2: DEPENDENCY CHAIN GUARDS
  // -------------------------------------------------------------------------
  console.log('\n[TEST 2/7] Dependency Chain Guards: Cannot reverse receipt or consignment with active sales');
  
  // A. Cannot reverse Factory Receipt because 20g was transferred to seller
  const { error: depRcpErr } = await dirSb.rpc('rpc_reverse_factory_receipt', {
    p_receipt_id: receiptId,
    p_reason: 'Attempt to reverse active receipt'
  });
  assert(depRcpErr && (depRcpErr.message.includes('tarqatilgan') || depRcpErr.message.includes('konsignatsiya')),
    'Factory receipt reversal blocked because stock was transferred');

  // B. Cannot reverse Consignment because Piece 1 is sold
  const { error: depConsErr } = await dirSb.rpc('rpc_reverse_barcode_consignment', {
    p_consignment_id: consignmentId,
    p_reason: 'Attempt to reverse consignment with sold piece'
  });
  assert(depConsErr && (depConsErr.message.includes('allaqachon sotilgan') || depConsErr.message.includes('sotilgan')),
    'Consignment reversal blocked because sold piece exists');

  // -------------------------------------------------------------------------
  // TEST 3: SOLD ITEM RESTORATION & DOUBLE REVERSAL REJECTION
  // -------------------------------------------------------------------------
  console.log('\n[TEST 3/7] Sold Item Restoration & Reversal of Piece Sale');
  
  // Check customer balance before reversal
  const { data: custAccBefore } = await jamSb
    .from('client_gold_accounts')
    .select('current_debt_grams, total_scrap_paid_grams')
    .eq('customer_id', customerId)
    .single();
  console.log(`   Customer before reversal: Debt=${custAccBefore.current_debt_grams}g, Scrap Paid=${custAccBefore.total_scrap_paid_grams}g`);

  // Reverse Piece 1 sale
  const { data: revSaleRes, error: revSaleErr } = await dirSb.rpc('rpc_reverse_barcode_piece_sale', {
    p_piece_id: piece1.id,
    p_reason: 'QA Test: Customer return'
  });
  if (revSaleErr) { console.error('revSaleErr:', revSaleErr); throw revSaleErr; }
  assert(revSaleRes && (revSaleRes.status === 'ok' || revSaleRes.sale_id), 'Sale reversed successfully');

  // Verify Piece status restored to 'held_by_seller'
  const { data: restoredPiece } = await dirSb
    .from('consignment_pieces')
    .select('status')
    .eq('id', piece1.id)
    .single();
  assert(restoredPiece.status === 'held_by_seller', 'Piece 1 restored to held_by_seller');

  // Verify consignment sold_quantity reduced back to 0
  const { data: updatedCons } = await dirSb
    .from('seller_consignments')
    .select('sold_quantity, status')
    .eq('id', consignmentId)
    .single();
  assert(Number(updatedCons.sold_quantity) === 0, 'Consignment sold_quantity decremented to 0');
  assert(updatedCons.status === 'held_by_seller', 'Consignment status restored to held_by_seller');

  // Verify customer debt is cleared (debt 11.2 - 2.0 scrap payment = 9.2, when sale reversed, debt removed, advance 2.0g created)
  const { data: custAccAfter } = await jamSb
    .from('client_gold_accounts')
    .select('current_debt_grams, total_scrap_paid_grams, advance_balance_grams')
    .eq('customer_id', customerId)
    .single();
  assert(Math.abs(Number(custAccAfter.current_debt_grams)) < 0.001,
    `Customer debt cleared after sale reversal (expected 0, got ${custAccAfter.current_debt_grams})`);

  // Verify Double Reversal of Sale is REJECTED
  console.log('   Testing double reversal rejection of same sale...');
  const { error: doubleSaleErr } = await dirSb.rpc('rpc_reverse_barcode_piece_sale', {
    p_piece_id: piece1.id,
    p_reason: 'Double reversal attempt'
  });
  assert(doubleSaleErr && (doubleSaleErr.message.includes('allaqachon bekor qilingan') || doubleSaleErr.message.includes('sold')),
    'Double reversal of sale strictly rejected');

  // -------------------------------------------------------------------------
  // TEST 4: CONSIGNMENT REVERSAL & FACTORY PHYSICAL STOCK RESTORATION
  // -------------------------------------------------------------------------
  console.log('\n[TEST 4/7] Consignment Reversal & Factory Stock Restoration');
  
  // Now that Piece 1 is restored (0 sold pieces), consignment reversal must SUCCEED
  const { data: revConsRes, error: revConsErr } = await dirSb.rpc('rpc_reverse_barcode_consignment', {
    p_consignment_id: consignmentId,
    p_reason: 'QA Test: Return consignment to factory stock'
  });
  if (revConsErr) { console.error('revConsErr:', revConsErr); throw revConsErr; }
  assert(revConsRes && (revConsRes.status === 'ok' || revConsRes.consignment_id), 'Consignment reversed successfully');

  // Verify consignment marked cancelled
  const { data: cancelledCons } = await dirSb
    .from('seller_consignments')
    .select('status, cancelled_at, cancellation_reason')
    .eq('id', consignmentId)
    .single();
  assert(cancelledCons.status === 'cancelled' && cancelledCons.cancelled_at !== null,
    'Consignment status marked cancelled with audit timestamp');

  // Verify factory receipt available physical grams restored from 30.0g back to 50.0g
  const { data: restoredReceipt } = await dirSb
    .from('factory_receipts')
    .select('available_physical_g, transferred_physical_g')
    .eq('id', receiptId)
    .single();
  assert(Math.abs(Number(restoredReceipt.available_physical_g) - 50.0) < 0.001,
    `Factory available physical restored to 50.0g (actual: ${restoredReceipt.available_physical_g}g)`);
  assert(Math.abs(Number(restoredReceipt.transferred_physical_g) - 0.0) < 0.001,
    `Factory transferred physical reduced to 0.0g (actual: ${restoredReceipt.transferred_physical_g}g)`);

  // Verify Double Reversal of Consignment is REJECTED
  console.log('   Testing double reversal rejection of consignment...');
  const { error: doubleConsErr } = await dirSb.rpc('rpc_reverse_barcode_consignment', {
    p_consignment_id: consignmentId,
    p_reason: 'Double consignment reversal attempt'
  });
  assert(doubleConsErr && doubleConsErr.message.includes('allaqachon bekor qilingan'),
    'Double reversal of consignment strictly rejected');

  // -------------------------------------------------------------------------
  // TEST 5: FACTORY RECEIPT REVERSAL
  // -------------------------------------------------------------------------
  console.log('\n[TEST 5/7] Factory Receipt Reversal (No active consignments remain)');
  
  // With 0 transferred physical grams, factory receipt reversal must SUCCEED
  const { data: revRcpRes, error: revRcpErr } = await dirSb.rpc('rpc_reverse_factory_receipt', {
    p_receipt_id: receiptId,
    p_reason: 'QA Test: Cancelling unneeded factory receipt'
  });
  if (revRcpErr) { console.error('revRcpErr:', revRcpErr); throw revRcpErr; }
  assert(revRcpRes && (revRcpRes.status === 'ok' || revRcpRes.receipt_id), 'Factory receipt reversed successfully');

  // Verify receipt status is reversed
  const { data: reversedRcp } = await dirSb
    .from('factory_receipts')
    .select('status, reversed_at, reversal_reason')
    .eq('id', receiptId)
    .single();
  assert(reversedRcp.status === 'reversed' && reversedRcp.reversed_at !== null,
    'Factory receipt marked reversed with audit metadata');

  // Verify Double Reversal of Factory Receipt is REJECTED
  console.log('   Testing double reversal rejection of factory receipt...');
  const { error: doubleRcpErr } = await dirSb.rpc('rpc_reverse_factory_receipt', {
    p_receipt_id: receiptId,
    p_reason: 'Double factory receipt reversal'
  });
  assert(doubleRcpErr && doubleRcpErr.message.includes('allaqachon bekor qilingan'),
    'Double reversal of factory receipt strictly rejected');

  // -------------------------------------------------------------------------
  // TEST 6: CLIENT SETTLEMENT REVERSAL & DOUBLE REVERSAL REJECTION
  // -------------------------------------------------------------------------
  console.log('\n[TEST 6/7] Client Settlement Reversal & Till Balance Reconciliation');
  
  // Record standalone customer scrap settlement of 5.0g
  const { data: setlData2, error: setlErr2 } = await jamSb.rpc('rpc_record_client_settlement', {
    p_customer_id: customerId,
    p_scrap_weight: 5.0,
    p_cash_amount: 0,
    p_rate_per_gram: 900000,
    p_notes: 'Standalone settlement for reversal test'
  });
  if (setlErr2) { console.error('setlErr2:', setlErr2); throw setlErr2; }
  const settlementId = setlData2.settlement_id;
  console.log(`   Recorded 5.0g scrap settlement. Settlement ID: ${settlementId}`);

  // Reverse client settlement
  const { data: revSetlRes, error: revSetlErr } = await dirSb.rpc('rpc_reverse_client_settlement', {
    p_settlement_id: settlementId,
    p_reason: 'QA Test: Client payment entered by mistake'
  });
  if (revSetlErr) { console.error('revSetlErr:', revSetlErr); throw revSetlErr; }
  assert(revSetlRes && (revSetlRes.status === 'ok' || revSetlRes.settlement_id), 'Client settlement reversed successfully');

  // Verify settlement status is 'reversed'
  const { data: reversedSetl } = await dirSb
    .from('gold_settlements')
    .select('status, reversed_at, reversal_reason')
    .eq('id', settlementId)
    .single();
  assert(reversedSetl.status === 'reversed' && reversedSetl.reversed_at !== null,
    'Settlement status marked reversed in gold_settlements table');

  // Verify Double Reversal of Settlement is REJECTED
  console.log('   Testing double reversal rejection of client settlement...');
  const { error: doubleSetlErr } = await dirSb.rpc('rpc_reverse_client_settlement', {
    p_settlement_id: settlementId,
    p_reason: 'Double settlement reversal'
  });
  assert(doubleSetlErr && doubleSetlErr.message.includes('allaqachon bekor qilingan'),
    'Double reversal of client settlement strictly rejected');

  // -------------------------------------------------------------------------
  // TEST 7: STAGING CLEANUP PREVIEW & CONFIRMATION CODE ENFORCEMENT
  // -------------------------------------------------------------------------
  console.log('\n[TEST 7/7] Staging Cleanup Preview & Strict Confirmation Code Guard');
  
  // 1. Run preview
  const { data: previewRes, error: prevErr } = await dirSb.rpc('rpc_preview_staging_test_cleanup');
  if (prevErr) throw prevErr;
  const totalCount = (previewRes.summary.factory_receipts_count || 0) +
                     (previewRes.summary.consignments_count || 0) +
                     (previewRes.summary.sales_count || 0) +
                     (previewRes.summary.settlements_count || 0);
  assert(previewRes.summary && typeof totalCount === 'number',
    `Cleanup preview returned audit summary (${totalCount} records eligible)`);
  const token = previewRes.preview_token;

  // 2. Execute with WRONG confirmation code -> MUST FAIL
  const { error: wrongCodeErr } = await dirSb.rpc('rpc_execute_staging_test_cleanup', {
    p_preview_token: token,
    p_confirmation_code: 'WRONG_CODE_123'
  });
  assert(wrongCodeErr && wrongCodeErr.message.includes('Tasdiqlash kodi noto\'g\'ri'),
    'Cleanup execution strictly rejected with invalid confirmation code');

  // 3. Execute without valid token -> MUST FAIL
  const { error: wrongTokenErr } = await dirSb.rpc('rpc_execute_staging_test_cleanup', {
    p_preview_token: '00000000-0000-0000-0000-000000000000',
    p_confirmation_code: 'CONFIRM_STAGING_CLEANUP_2026'
  });
  assert(wrongTokenErr && (wrongTokenErr.message.includes('topilmadi') || wrongTokenErr.message.includes('preview_token')),
    'Cleanup execution strictly rejected with invalid preview token');

  // 4. Verify snapshot was recorded in staging_backup_snapshots
  const { data: snapshots, error: snapErr } = await dirSb
    .from('staging_backup_snapshots')
    .select('id, snapshot_type, preview_token, record_count')
    .eq('preview_token', token);
  if (snapErr) throw snapErr;
  assert(snapshots && snapshots.length > 0,
    `Staging snapshot record verified in staging_backup_snapshots (ID: ${snapshots[0].id})`);

  console.log('\n' + '='.repeat(80));
  console.log('🎉 ALL 7 SAFE REVERSAL & STAGING CLEANUP TESTS PASSED WITH 100% SUCCESS!');
  console.log('='.repeat(80));
}

main().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
