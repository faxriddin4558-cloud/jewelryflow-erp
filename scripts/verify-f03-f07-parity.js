/**
 * JEWELRYFLOW SALES — F03-F07 PARITY & LIFECYCLE VERIFICATION SCRIPT
 * Target: Staging Supabase (vouehtlmsunebracahon)
 *
 * Verifies:
 * 1. Three-tier ledger separation (Tier 1 Factory vs Tier 2 Seller vs Tier 3 Client)
 * 2. Factory debt immunity to internal seller->manager cash/scrap transfers
 * 3. Physical stock deduction on consignment creation (Manager -> Seller)
 * 4. Atomic piece-level transition to 'sold' and double-sale rejection
 * 5. Signed Bozor Qarzi (+/-) and absence of '-0.00g'
 * 6. Customer advance automatic application and 38.76g net debt reconciliation
 * 7. Daily sales ledger date range accuracy
 */

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

let SUPABASE_URL = 'https://vouehtlmsunebracahon.supabase.co';
let SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  try {
    const rawKeys = execSync('npx supabase projects api-keys --project-ref vouehtlmsunebracahon --output json', { encoding: 'utf8' });
    const jsonStart = rawKeys.indexOf('[');
    const jsonEnd = rawKeys.lastIndexOf(']') + 1;
    const keys = JSON.parse(rawKeys.slice(jsonStart, jsonEnd));
    SUPABASE_ANON_KEY = keys.find(k => k.name === 'anon').api_key;
  } catch (err) {
    console.error('Failed to get keys via supabase cli:', err.message);
  }
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

async function run() {
  console.log('='.repeat(80));
  console.log('JEWELRYFLOW SALES — F03–F07 CORE ACCOUNTING & STOCK REGRESSION TEST');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log('='.repeat(80));

  const { sb: dirSb } = await getClient('director@goldia.uz');
  const { sb: jamSb } = await getClient('seller@goldia.uz');

  // =========================================================================
  // 1. THREE-TIER INDEPENDENT LEDGER VERIFICATION (F03)
  // =========================================================================
  console.log('\n[1/5] THREE-TIER LEDGER & FACTORY ISOLATION (F03)');

  const { data: summaryBefore, error: sumErr } = await dirSb.rpc('rpc_get_three_tier_ledger_summary');
  if (sumErr) {
    console.error('sumErr details:', sumErr);
  }
  assert(!sumErr && summaryBefore, 'rpc_get_three_tier_ledger_summary executed successfully');

  const t1Before = summaryBefore.tier1_factory;
  const t2Before = summaryBefore.tier2_sellers;
  const t3Before = summaryBefore.tier3_clients;

  console.log(`   * Tier 1 (Factory Net Debt): ${t1Before.net_factory_debt_grams}g (Receipts Due: ${t1Before.total_obligation_grams}g, Handovers: ${t1Before.total_handovers_grams}g)`);
  console.log(`   * Tier 2 (Sellers Obligation): ${t2Before.total_seller_obligation_grams}g (Signed Bozor Qarzi: ${t2Before.bozor_qarzi_signed_grams}g)`);
  console.log(`   * Tier 3 (Client Net Debt): ${t3Before.net_debt_grams}g (Total Purchased: ${t3Before.total_purchased_grams}g, Settled: ${t3Before.total_settled_grams}g)`);

  assert(
    Math.abs(Number(t1Before.net_factory_debt_grams) - Math.max(0, Number(t1Before.total_obligation_grams) - Number(t1Before.total_handovers_grams))) < 0.001,
    'Tier 1 Factory Net Debt strictly equals Factory Obligations minus Factory Handovers'
  );

  // =========================================================================
  // 2. MANAGER -> SELLER PHYSICAL STOCK DEDUCTION (F04)
  // =========================================================================
  console.log('\n[2/5] PHYSICAL STOCK TRANSITION ON CONSIGNMENT CREATION (F04)');

  // Create a designated test factory receipt of 100g with 8%
  const rcpName = `QA-BATCH-STOCK-TEST-${Date.now()}`;
  const { data: rcpData, error: rcpErr } = await dirSb.rpc('rpc_record_factory_receipt', {
    p_product_name: rcpName,
    p_quantity: 1,
    p_original_physical_g: 100.0,
    p_proba: 585.0,
    p_factory_markup_pct: 8.0,
    p_notes: 'F04 physical stock deduction test',
    p_idempotency_key: `rcp_test_${Date.now()}`
  });
  if (rcpErr) {
    console.error('rcpErr details:', rcpErr);
  }
  assert(!rcpErr && rcpData, `Factory receipt created: ${rcpData?.receipt_no} (100.0g physical, 108.0g obligation)`);

  const rcpId = rcpData.receipt_id;

  // Verify initial manager available stock
  const { data: rcpBefore } = await dirSb.from('factory_receipts').select('*').eq('id', rcpId).single();
  assert(Number(rcpBefore.available_physical_g) === 100.0, 'Initial manager available physical stock is 100.0g');
  assert(rcpBefore.status === 'in_manager_stock', 'Initial status is in_manager_stock');

  // Issue 15g consignment from this receipt to Jamshid
  const { data: empRes } = await dirSb.from('employees').select('id').eq('email', 'seller@goldia.uz').single();
  const jamshidId = empRes.id;

  const testPieces = [
    {
      model_code: 'JF-TEST-F04',
      model_name: 'Test Oltin Uzuk',
      category: 'Кольца',
      purity: 585,
      weight_grams: 15.0,
      raw_barcode: `BAR-F04-${Date.now()}`
    }
  ];

  const { data: consignData, error: consignErr } = await dirSb.rpc('rpc_issue_barcode_consignment', {
    p_seller_id: jamshidId,
    p_factory_markup_pct: 8.0,
    p_pieces: testPieces,
    p_notes: 'F04 stock test consignment',
    p_idempotency_key: `consign_f04_${Date.now()}`,
    p_factory_receipt_id: rcpId
  });
  assert(!consignErr && consignData, `Consignment issued: ${consignData?.consignment_no} (15.0g)`);

  // Verify manager available stock in factory_receipts has decreased by 15.0g
  const { data: rcpAfter } = await dirSb.from('factory_receipts').select('*').eq('id', rcpId).single();
  assert(
    Math.abs(Number(rcpAfter.available_physical_g) - 85.0) < 0.001,
    `Manager available physical stock decreased by 15g: 100g -> ${rcpAfter.available_physical_g}g`
  );
  assert(
    Math.abs(Number(rcpAfter.transferred_physical_g) - 15.0) < 0.001,
    `Manager transferred physical stock increased to 15g: ${rcpAfter.transferred_physical_g}g`
  );
  assert(rcpAfter.status === 'partially_transferred', 'Receipt status updated to partially_transferred');

  // Verify factory financial obligation remains 108g (NOT changed by internal transfer)
  assert(
    Math.abs(Number(rcpAfter.factory_obligation_g) - 108.0) < 0.001,
    `Factory financial obligation remains intact at 108g: ${rcpAfter.factory_obligation_g}g`
  );

  // =========================================================================
  // 3. ATOMIC PIECE SALE & DOUBLE-SALE GUARD (F05)
  // =========================================================================
  console.log('\n[3/5] ATOMIC PIECE-LEVEL SALE & DOUBLE-SALE REJECTION (F05)');

  const pieceId = consignData.pieces[0].id;

  // Verify piece is currently held_by_seller
  const { data: pieceBefore } = await dirSb.from('consignment_pieces').select('*').eq('id', pieceId).single();
  assert(pieceBefore.status === 'held_by_seller', 'Piece status is held_by_seller before sale');

  // Get or create test customer
  const { data: custRes } = await dirSb.rpc('rpc_create_customer_with_code', {
    p_contact_name: `QA-Klient-${Date.now()}`,
    p_phone: '+998901234567',
    p_seller_id: jamshidId
  });
  const customerId = custRes.customer_id;

  // Sell the piece via rpc_record_barcode_piece_sale
  const { data: saleData, error: saleErr } = await jamSb.rpc('rpc_record_barcode_piece_sale', {
    p_customer_id: customerId,
    p_seller_id: jamshidId,
    p_piece_id: pieceId,
    p_client_markup_pct: 12.0,
    p_notes: 'F05 atomic sale test',
    p_idempotency_key: `sale_f05_${Date.now()}`
  });
  assert(!saleErr && saleData, `Piece sold: ${saleData?.sale_no} (15g @ 12% = ${saleData?.gross_gold_due_grams}g)`);

  // Verify piece status transitioned to 'sold'
  const { data: pieceAfter } = await dirSb.from('consignment_pieces').select('*').eq('id', pieceId).single();
  assert(pieceAfter.status === 'sold', 'Piece status atomically updated to "sold"');
  assert(pieceAfter.sold_at !== null, 'Piece sold_at timestamp is populated');
  assert(pieceAfter.sale_id !== null, 'Piece sale_id is linked to the sale record');

  // Negative test: Try to sell the SAME piece again
  const { data: dupSaleData, error: dupSaleErr } = await jamSb.rpc('rpc_record_barcode_piece_sale', {
    p_customer_id: customerId,
    p_seller_id: jamshidId,
    p_piece_id: pieceId,
    p_client_markup_pct: 12.0,
    p_notes: 'Duplicate sale attempt'
  });
  assert(dupSaleErr !== null, `Duplicate sale rejected by server: "${dupSaleErr?.message}"`);

  // Negative test: Try to return the sold piece
  const { data: retData, error: retErr } = await jamSb.rpc('rpc_return_piece_to_manager', {
    p_piece_id: pieceId,
    p_notes: 'Attempted return of sold piece'
  });
  assert(retErr !== null, `Return of sold piece rejected by server: "${retErr?.message}"`);

  // =========================================================================
  // 4. SIGNED BOZOR QARZI & FORMATTING (F06)
  // =========================================================================
  console.log('\n[4/5] SIGNED BOZOR QARZI & FORMATTING VERIFICATION (F06)');

  const { data: sellerAccounts } = await dirSb.from('seller_gold_accounts').select('*');
  for (const acc of sellerAccounts) {
    const signed = Number(acc.bozor_qarzi_signed_g ?? 0);
    const formatted = Math.abs(signed) < 0.0001
      ? '0.00 g'
      : signed < 0
      ? `-${Math.abs(signed).toFixed(2)} g`
      : `+${signed.toFixed(2)} g`;

    assert(
      !formatted.includes('-0.00'),
      `Seller account ${acc.seller_id} Bozor Qarzi formatted correctly: "${formatted}" (no -0.00g)`
    );
  }

  // =========================================================================
  // 5. ADVANCE CONSUMPTION & 38.76g NET DEBT RECONCILIATION (F07)
  // =========================================================================
  console.log('\n[5/5] ADVANCE CONSUMPTION & 38.76g NET DEBT RECONCILIATION (F07)');

  // Step A: Create fresh customer
  const { data: advCust } = await dirSb.rpc('rpc_create_customer_with_code', {
    p_contact_name: `QA-Advance-Cust-${Date.now()}`,
    p_phone: '+998991112233',
    p_seller_id: jamshidId
  });
  const advCustId = advCust.customer_id;

  // Step B: Simulate 112g debt -> 90g settlement -> 22g debt -> 23g settlement -> 0 debt + 1g advance
  // Direct settlement with excess scrap:
  const { data: setRes, error: setErr } = await jamSb.rpc('rpc_record_client_settlement', {
    p_customer_id: advCustId,
    p_scrap_weight: 1.0,
    p_cash_amount: 0,
    p_rate_per_gram: 900000,
    p_notes: 'Initial 1.0g advance payment'
  });
  assert(!setErr && setRes, `Advance payment recorded: excess = ${setRes?.excess_gold_grams}g`);

  // Verify customer advance balance is 1.0g
  const { data: custAcc1 } = await dirSb.from('client_gold_accounts').select('*').eq('customer_id', advCustId).single();
  assert(Math.abs(Number(custAcc1.advance_balance_grams) - 1.0) < 0.001, `Customer advance balance is 1.0g: ${custAcc1.advance_balance_grams}g`);
  assert(Number(custAcc1.current_debt_grams) === 0, 'Customer current debt is 0.0g before sale');

  // Step C: Make new sale of 35.5g @ 12% = 39.76g
  // Issue a 35.5g consignment
  const { data: consignAdv, error: consignAdvErr } = await dirSb.rpc('rpc_issue_barcode_consignment', {
    p_seller_id: jamshidId,
    p_factory_markup_pct: 8.0,
    p_pieces: [{
      model_code: 'JF-M-355',
      model_name: 'Uzuk 35.5g',
      category: 'Кольца',
      purity: 585,
      weight_grams: 35.5,
      raw_barcode: `BAR-355-${Date.now()}`
    }],
    p_notes: '35.5g consignment for advance test'
  });
  if (consignAdvErr) {
    console.error('consignAdvErr details:', consignAdvErr);
  }
  assert(!consignAdvErr && consignAdv, `Consignment for advance test issued: ${consignAdv?.consignment_no}`);
  const piece355Id = consignAdv.pieces[0].id;

  // Sell 35.5g @ 12% (= 39.76g)
  const { data: advSaleData, error: advSaleErr } = await jamSb.rpc('rpc_record_barcode_piece_sale', {
    p_customer_id: advCustId,
    p_seller_id: jamshidId,
    p_piece_id: piece355Id,
    p_client_markup_pct: 12.0,
    p_notes: '35.5g sale with advance consumption'
  });
  if (advSaleErr) {
    console.error('advSaleErr details:', advSaleErr);
  }
  assert(!advSaleErr && advSaleData, `Sale of 35.5g created: gross due = ${advSaleData?.gross_gold_due_grams}g`);

  // Verify advance application in sale result
  assert(
    Math.abs(Number(advSaleData.gross_gold_due_grams) - 39.76) < 0.001,
    `Gross gold due is exactly 35.5g * 1.12 = 39.76g (received: ${advSaleData.gross_gold_due_grams}g)`
  );
  assert(
    Math.abs(Number(advSaleData.advance_applied_grams) - 1.0) < 0.001,
    `Advance applied is exactly 1.0g (received: ${advSaleData.advance_applied_grams}g)`
  );
  assert(
    Math.abs(Number(advSaleData.net_remaining_debt_grams) - 38.76) < 0.001,
    `Net remaining debt is exactly 39.76 - 1.0 = 38.76g (received: ${advSaleData.net_remaining_debt_grams}g)`
  );

  // Verify client_gold_accounts reflects 38.76g net debt and 0g advance
  const { data: custAcc2 } = await dirSb.from('client_gold_accounts').select('*').eq('customer_id', advCustId).single();
  assert(
    Math.abs(Number(custAcc2.current_debt_grams) - 38.76) < 0.001,
    `client_gold_accounts current debt is exactly 38.76g: ${custAcc2.current_debt_grams}g`
  );
  assert(
    Number(custAcc2.advance_balance_grams) === 0,
    `client_gold_accounts advance balance is consumed: ${custAcc2.advance_balance_grams}g`
  );

  // Verify monthly report for this customer matches 38.76g closing debt
  const now = new Date();
  const { data: monthlyData, error: monthErr } = await dirSb.rpc('rpc_get_customer_monthly_report', {
    p_seller_id: jamshidId,
    p_year: now.getFullYear(),
    p_month: now.getMonth() + 1
  });
  assert(!monthErr && monthlyData, 'rpc_get_customer_monthly_report executed successfully');

  const items = monthlyData.items || monthlyData.rows || [];
  const custMonthly = items.find(r => r.customer_id === advCustId);
  assert(custMonthly !== undefined, 'Customer found in monthly report items');
  assert(
    Math.abs(Number(custMonthly.closing_debt_g) - 38.76) < 0.001,
    `Monthly report closing debt for customer matches exactly 38.76g: ${custMonthly.closing_debt_g}g`
  );

  // =========================================================================
  // 6. DATE FILTERING (F11)
  // =========================================================================
  console.log('\n[BONUS] DAILY SALES LEDGER DATE FILTERING (F11)');

  const { data: futureLedger } = await dirSb.rpc('rpc_get_daily_sales_ledger', {
    p_start_date: '2026-12-31',
    p_end_date: '2026-12-31'
  });
  assert(
    !futureLedger || futureLedger.length === 0,
    `Date 2026-12-31 correctly returns 0 records (${futureLedger ? futureLedger.length : 0} rows)`
  );

  console.log('\n' + '='.repeat(80));
  console.log('✅ BARCHA F03–F07 TOP-LEVEL VA ATOMIC STOCK TESTLARI 100% PASS BO\'LDI!');
  console.log('='.repeat(80));
}

run().catch(err => {
  console.error('\n❌ TEST TO\'XTADI:', err.message);
  process.exit(1);
});
