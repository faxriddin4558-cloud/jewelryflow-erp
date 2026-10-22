/**
 * JEWELRYFLOW SALES — FULL BUSINESS CYCLE E2E TEST (100g -> 8% -> 12% -> Client -> Scrap/Cash -> Advance -> Refining -> Factory Handover)
 * Target: Staging Supabase (vouehtlmsunebracahon)
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
  console.error('❌ Supabase Anon Key not found!');
  process.exit(1);
}

async function getClient(email, password = 'GoldiaPassword2026!') {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Auth failed for ${email}: ${error.message}`);
  return { sb, user: data.user };
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
  console.log('JEWELRYFLOW SALES — FULL BUSINESS CYCLE INTEGRATION VERIFICATION');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log('='.repeat(80));

  const { sb: dirSb } = await getClient('director@goldia.uz');
  const { sb: mgrSb } = await getClient('manager@goldia.uz');
  const { sb: jamSb } = await getClient('seller@goldia.uz');

  const { data: emps } = await dirSb.from('employees').select('id, email, name, role_type');
  const jamshidEmp = emps.find(e => e.email === 'seller@goldia.uz');
  const rustamEmp = emps.find(e => e.email === 'manager@goldia.uz');
  const alisherEmp = emps.find(e => e.email === 'director@goldia.uz');
  assert(jamshidEmp && rustamEmp && alisherEmp, 'Employees found for Director, Manager, Seller');

  // Baseline
  const { data: baseline3Tier } = await dirSb.rpc('rpc_get_three_tier_ledger_summary');
  const t1_base = Number(baseline3Tier.tier1_factory.net_factory_debt_grams);
  console.log(`\n[BASELINE] Tier 1 Factory Net Debt: ${t1_base}g`);

  // =========================================================================
  // STEP 1: Factory Receipt (100g @ 8% markup)
  // =========================================================================
  console.log('\n[STEP 1] Zavoddan 100g (585 proba, 8% ustama) qabul qilish');
  const rcpBatch = `QA-CYCLE-${Date.now()}`;
  const { data: rcpRes, error: rcpErr } = await dirSb.rpc('rpc_record_factory_receipt', {
    p_product_name: rcpBatch,
    p_quantity: 1,
    p_original_physical_g: 100.0,
    p_proba: 585.0,
    p_factory_markup_pct: 8.0,
    p_notes: 'Full Cycle Verification',
    p_idempotency_key: `rcp_cycle_${Date.now()}`
  });
  if (rcpErr) throw rcpErr;
  assert(rcpRes && rcpRes.receipt_id, `Receipt created: ${rcpRes.receipt_no}`);
  assert(Number(rcpRes.original_physical_g) === 100.0, 'Physical weight: 100.0g');
  assert(Number(rcpRes.factory_obligation_g) === 108.0, 'Factory obligation: 100g * 1.08 = 108.0g');

  // =========================================================================
  // STEP 2: Issue 15g Consignment to Jamshid (seller)
  // =========================================================================
  console.log('\n[STEP 2] Boshqaruvchi Jamshidga 15.0g tarqatadi (8% zavod, 12% sotuvchi)');
  const barcodePiece = `BAR-CYC-${Date.now()}`;
  const { data: consignRes, error: consignErr } = await dirSb.rpc('rpc_issue_barcode_consignment', {
    p_seller_id: jamshidEmp.id,
    p_factory_markup_pct: 8.0,
    p_pieces: [{
      model_code: 'JF-CYCLE-15',
      model_name: 'Cycle Uzuk 15g',
      category: 'Кольца',
      purity: 585,
      weight_grams: 15.0,
      raw_barcode: barcodePiece
    }],
    p_factory_receipt_id: rcpRes.receipt_id,
    p_notes: 'Full cycle consignment 15g'
  });
  if (consignErr) throw consignErr;
  assert(consignRes && consignRes.consignment_no, `Consignment issued: ${consignRes.consignment_no}`);
  const pieceId = consignRes.pieces[0].id;

  // Verify manager available physical stock: 100 - 15 = 85g
  const { data: rcpAfter } = await dirSb.from('factory_receipts').select('*').eq('id', rcpRes.receipt_id).single();
  assert(Number(rcpAfter.available_physical_g) === 85.0, `Manager available stock: ${rcpAfter.available_physical_g}g (expected 85.0g)`);
  assert(Number(rcpAfter.transferred_physical_g) === 15.0, `Manager transferred stock: ${rcpAfter.transferred_physical_g}g (expected 15.0g)`);
  assert(Number(rcpAfter.factory_obligation_g) === 108.0, `Factory financial obligation unchanged: ${rcpAfter.factory_obligation_g}g`);

  // =========================================================================
  // STEP 3: Seller Sells 15.0g Piece to Customer @ 12% Client Markup
  // =========================================================================
  console.log('\n[STEP 3] Jamshid yangi mijozga 15.0g donani 12% ustama bilan sotadi');
  const { data: custRes, error: custErr } = await jamSb.rpc('rpc_create_customer_with_code', {
    p_contact_name: `QA-Cycle-Cust-${Date.now()}`,
    p_phone: `+99899${Math.floor(1000000 + Math.random() * 9000000)}`,
    p_seller_id: jamshidEmp.id
  });
  if (custErr) throw custErr;
  const customerId = custRes.customer_id;

  const { data: saleRes, error: saleErr } = await jamSb.rpc('rpc_record_barcode_piece_sale', {
    p_customer_id: customerId,
    p_seller_id: jamshidEmp.id,
    p_piece_id: pieceId,
    p_client_markup_pct: 12.0,
    p_notes: 'Full cycle 15g sale'
  });
  if (saleErr) throw saleErr;
  assert(saleRes && saleRes.sale_no, `Piece sold: ${saleRes.sale_no}`);
  assert(Math.abs(Number(saleRes.gross_gold_due_grams) - 16.80) < 0.001, `Customer gross obligation: 15g * 1.12 = 16.80g (received: ${saleRes.gross_gold_due_grams}g)`);

  // Verify piece is atomically 'sold'
  const { data: pieceRow } = await dirSb.from('consignment_pieces').select('*').eq('id', pieceId).single();
  assert(pieceRow.status === 'sold', `Piece status is: "${pieceRow.status}"`);

  // =========================================================================
  // STEP 4: Customer Settlement (Lom + Cash + Excess Advance)
  // =========================================================================
  console.log('\n[STEP 4] Mijoz to\'lovi: 10.0g lom (585) + 7,020,000 UZS naqd (7.8g eq) = 17.80g jami');
  // Debt is 16.80g. Total settled is 10.0 + 7.80 = 17.80g.
  // Applied to debt: 16.80g. Excess advance: 1.00g!
  const rateUzs = 900000;
  const cashAmount = 7020000; // 7,020,000 / 900,000 = 7.80g
  const scrapWeight = 10.0;
  const scrapProba = 585;

  const { data: settleRes, error: settleErr } = await jamSb.rpc('rpc_record_client_settlement', {
    p_customer_id: customerId,
    p_scrap_weight: scrapWeight,
    p_scrap_proba: scrapProba,
    p_cash_amount: cashAmount,
    p_rate_per_gram: rateUzs,
    p_sale_id: saleRes.sale_id,
    p_notes: 'Full cycle settlement with excess advance'
  });
  if (settleErr) throw settleErr;
  assert(settleRes && settleRes.settlement_no, `Settlement recorded: ${settleRes.settlement_no}`);
  assert(Math.abs(Number(settleRes.applied_to_debt_grams) - 16.80) < 0.001, `Applied to debt: ${settleRes.applied_to_debt_grams}g`);
  assert(Math.abs(Number(settleRes.excess_gold_advance_grams) - 1.00) < 0.001, `Excess advance: ${settleRes.excess_gold_advance_grams}g`);
  assert(Number(settleRes.remaining_debt_grams) === 0, `Customer remaining debt: 0.0g`);

  // Verify customer gold account
  const { data: custAcc } = await dirSb.from('client_gold_accounts').select('*').eq('customer_id', customerId).single();
  assert(Number(custAcc.current_debt_grams) === 0, `Account debt is 0.0g: ${custAcc.current_debt_grams}g`);
  assert(Math.abs(Number(custAcc.advance_balance_grams) - 1.00) < 0.001, `Account advance balance is 1.00g: ${custAcc.advance_balance_grams}g`);

  // =========================================================================
  // STEP 5: Jamshid Hands Over Scrap & Cash to Manager Rustam
  // =========================================================================
  console.log('\n[STEP 5] Jamshid boshqaruvchi Rustamga 10.0g lom va 7,020,000 UZS naqd topshiradi');
  const { data: mgrSettleRes, error: mgrSettleErr } = await mgrSb.rpc('rpc_record_seller_to_manager_settlement', {
    p_seller_id: jamshidEmp.id,
    p_scrap_weight_grams: 10.0,
    p_cash_paid_amount: cashAmount,
    p_rate_per_gram: rateUzs,
    p_notes: 'Full cycle seller to manager settlement'
  });
  if (mgrSettleErr) throw mgrSettleErr;
  assert(mgrSettleRes && mgrSettleRes.settlement_no, `Manager accepted handover: ${mgrSettleRes.settlement_no}`);
  console.log(`   * Total settled to manager (585 eq): ${mgrSettleRes.total_settled_grams}g (10g scrap + 7.8g cash eq)`);

  // =========================================================================
  // STEP 6: Rustam Records Refining (Affinaj) of 10.0g Scrap
  // =========================================================================
  console.log('\n[STEP 6] Rustam 10.0g lomni affinaj qiladi (0.5% yo\'qotish, 995 sof oltin quyma)');
  // 10.0g of 585 scrap = 5.85g fine gold.
  // With 0.5% loss = 5.85 * 0.995 = 5.8208g fine gold (995 bar).
  // In 585 equivalent = 5.8208 * (995/585) = 9.90g.
  const { data: refRes, error: refErr } = await mgrSb.rpc('rpc_record_refining_batch', {
    p_input_scrap_grams: 10.0,
    p_melted_weight_grams: 9.95,
    p_output_fine_grams: 5.8208,
    p_output_fine_proba: 995.0,
    p_notes: 'Full cycle refining batch'
  });
  if (refErr) throw refErr;
  assert(refRes && refRes.batch_id, `Refining batch recorded: ${refRes.batch_no}`);
  assert(Number(refRes.loss_pct) >= 0 && Number(refRes.loss_pct) <= 2.0, `Allowable loss pct: ${refRes.loss_pct}%`);
  console.log(`   * 995 Fine Gold Output: ${refRes.output_fine_grams}g (585 Eq: ${refRes.output_585_equiv_grams}g)`);

  // =========================================================================
  // STEP 7: Rustam Hands Over Refined Gold to Factory (Tier 1 Debt Deduction)
  // =========================================================================
  console.log('\n[STEP 7] Rustam zavodga 5.8208g (995 proba = 9.90g 585 eq) sof oltin topshiradi');
  const { data: handoverRes, error: handoverErr } = await mgrSb.rpc('rpc_record_factory_gold_handover', {
    p_gross_weight_grams: 5.8208,
    p_proba: 995.0,
    p_notes: 'Full cycle factory handover'
  });
  if (handoverErr) throw handoverErr;
  assert(handoverRes && handoverRes.handover_id, `Factory handover recorded: ${handoverRes.handover_no}`);
  assert(Math.abs(Number(handoverRes.equivalent_585_grams) - 9.90) < 0.05, `Factory obligation reduced by: ${handoverRes.equivalent_585_grams}g`);

  // =========================================================================
  // STEP 8: Final Reconciliation Across All Tiers
  // =========================================================================
  console.log('\n[STEP 8] Barcha 3 darajali ledjer va balanslarni yakuniy tekshirish');
  const { data: final3Tier } = await dirSb.rpc('rpc_get_three_tier_ledger_summary');
  const t1_final = Number(final3Tier.tier1_factory.net_factory_debt_grams);
  console.log(`   * Tier 1 (Factory Net Debt): ${t1_final}g (Net change: +${(t1_final - t1_base).toFixed(4)}g: +108.0g receipt - 9.90g handover = +98.10g)`);
  assert(Math.abs((t1_final - t1_base) - 98.10) < 0.1, `Tier 1 Factory Net Debt net change is strictly +98.10g`);

  // Check Unified Customer Ledger for the customer
  const { data: custLedger, error: custLedgerErr } = await dirSb.rpc('rpc_get_unified_customer_ledger', {
    p_customer_id: customerId
  });
  const rows = custLedger?.items || custLedger?.rows || custLedger?.customers || [];
  assert(rows.length === 1, 'Customer found in unified customer ledger');
  const cRow = rows[0];
  assert(Number(cRow.net_debt_g) === 0, `Unified ledger net debt is 0.0g: ${cRow.net_debt_g}g`);
  assert(Math.abs(Number(cRow.available_advance_g) - 1.00) < 0.001, `Unified ledger advance is 1.00g: ${cRow.available_advance_g}g`);

  console.log('\n' + '='.repeat(80));
  console.log('🎉 TO\'LIQ BIZNES ZANJIRI (ZAVOD -> BOSHQARUVCHI -> SOTUVCHI -> MIJOZ -> AVANS -> AFFINAJ -> ZAVOD) 100% PASS BO\'LDI!');
  console.log('='.repeat(80));
}

main().catch(err => {
  console.error('\n❌ FULL CYCLE TEST TO\'XTADI:', err);
  process.exit(1);
});
