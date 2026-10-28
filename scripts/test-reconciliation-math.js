const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function parseEnv(filePath) {
  const res = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      res[trimmed.slice(0, idx).trim()] = v;
    }
  }
  return res;
}

const prodEnv = parseEnv('.env.production.local');
const sb = createClient(prodEnv['NEXT_PUBLIC_SUPABASE_URL'], prodEnv['SUPABASE_SERVICE_ROLE_KEY']);

async function testReconciliationMath() {
  const sellerId = '69ad3650-1437-4d63-af78-19f71f99dca6';
  const orgId = '00000000-0000-0000-0000-000000000001';

  // Section A: Active consignments
  const { data: consignments } = await sb.from('seller_consignments')
    .select('*')
    .eq('seller_id', sellerId)
    .not('status', 'in', '("cancelled","reversed")');

  let secA_orig = 0;
  let secA_obl = 0;
  for (const c of consignments) {
    secA_orig += Number(c.base_weight_grams) + Number(c.returned_weight_grams || 0);
    secA_obl += Number(c.seller_obligation_g || 0) + Number(c.returned_seller_obligation_g || 0);
  }

  const { data: legacyDebts } = await sb.from('client_legacy_debts')
    .select('*')
    .eq('seller_id', sellerId)
    .eq('balance_type', 'debt')
    .neq('status', 'reversed');

  let legacyTotal = 0;
  for (const d of legacyDebts) {
    legacyTotal += Number(d.delta_585_g || 0);
  }
  secA_obl += legacyTotal;

  // Seller account
  const { data: acc } = await sb.from('seller_gold_accounts')
    .select('*')
    .eq('seller_id', sellerId)
    .single();

  const secB_orig = Number(acc.current_physical_stock_g || 0);
  const markupRatio = secA_orig > 0 ? (secA_obl - legacyTotal) / secA_orig : 1.15;
  const secB_equiv = secB_orig * markupRatio;

  const secC_orig = Math.max(0, secA_orig - secB_orig);
  const secC_equiv = secC_orig * markupRatio;

  // Section F: Settlements to manager
  const { data: settlements } = await sb.from('gold_settlements')
    .select('*')
    .eq('seller_id', sellerId)
    .in('direction', ['seller_to_manager', 'seller_to_factory'])
    .not('status', 'in', '("cancelled","reversed")');

  let secF_scrap = 0;
  let secF_cash_uzs = 0;
  let secF_cash_eq = 0;
  let secF_usd = 0;
  let secF_usd_eq = 0;

  for (const s of settlements) {
    secF_scrap += Number(s.scrap_weight_grams || 0);
    secF_cash_uzs += Number(s.cash_paid_amount || 0);
    secF_cash_eq += Number(s.cash_equivalent_grams || 0);
    secF_usd += Number(s.usd_paid_amount || 0);
    secF_usd_eq += Number(s.usd_equivalent_grams || 0);
  }

  const secF_total_deductions = secF_scrap + secF_cash_eq + secF_usd_eq;
  const expectedObligation = Math.max(0, secA_obl - secF_total_deductions);
  const sellerOwesManager = Number(acc.seller_owes_manager_g || 0);
  const discrepancy = Math.abs(sellerOwesManager - expectedObligation);

  console.log({
    secA_orig,
    secA_obl,
    legacyTotal,
    secB_orig,
    secB_equiv,
    secC_orig,
    secC_equiv,
    secF_scrap,
    secF_cash_uzs,
    secF_cash_eq,
    secF_usd,
    secF_usd_eq,
    secF_total_deductions,
    expectedObligation,
    sellerOwesManager,
    discrepancy,
    isReconciled: discrepancy < 0.005
  });
}
testReconciliationMath();
