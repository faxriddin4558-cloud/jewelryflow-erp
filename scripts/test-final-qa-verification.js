const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath) {
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}
loadEnvFile(path.resolve(__dirname, '../.env.staging.local'));
loadEnvFile(path.resolve(__dirname, '../.env.local'));

const sbJamshid = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const sbDirector = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  await sbJamshid.auth.signInWithPassword({ email: 'seller@goldia.uz', password: 'GoldiaPassword2026!' });
  await sbDirector.auth.signInWithPassword({ email: 'director@goldia.uz', password: 'GoldiaPassword2026!' });

  const dilshodSellerId = '11111111-1111-4001-8001-000000000018';

  console.log('=== TEST 1: Jamshid Customer Isolation (Direct SELECT vs RPC) ===');
  const { data: rlsCusts } = await sbJamshid.from('customers').select('customer_code, contact_name, seller_id');
  console.log('Jamshid Direct RLS SELECT customers count:', rlsCusts ? rlsCusts.length : 0);
  console.log('Jamshid sees CUST-A38A87 in direct SELECT?', rlsCusts ? rlsCusts.some(c => c.customer_code === 'CUST-A38A87') : false);

  const { data: rpcLedger, error: rpcErr } = await sbJamshid.rpc('rpc_get_unified_customer_ledger');
  const items = rpcLedger ? rpcLedger.items || [] : [];
  console.log('Jamshid RPC rpc_get_unified_customer_ledger items count:', items.length);
  console.log('Jamshid sees CUST-A38A87 in RPC?', items.some(c => c.customer_code === 'CUST-A38A87'));
  console.log('Jamshid sees CUST-7681F5 in RPC?', items.some(c => c.customer_code === 'CUST-7681F5'));

  console.log('\n=== TEST 2: Jamshid Cross-Seller Explicit Request Rejection (42501) ===');
  const { error: crossLedgerErr } = await sbJamshid.rpc('rpc_get_unified_customer_ledger', { p_seller_id: dilshodSellerId });
  console.log('Jamshid requesting Dilshod ledger result:', crossLedgerErr ? `BLOCKED (${crossLedgerErr.code}): ${crossLedgerErr.message}` : 'ALLOWED (FAIL!)');

  const { error: crossMonthlyErr } = await sbJamshid.rpc('rpc_get_customer_monthly_report', { p_seller_id: dilshodSellerId });
  console.log('Jamshid requesting Dilshod monthly result:', crossMonthlyErr ? `BLOCKED (${crossMonthlyErr.code}): ${crossMonthlyErr.message}` : 'ALLOWED (FAIL!)');

  const { error: crossDailyErr } = await sbJamshid.rpc('rpc_get_daily_sales_ledger', { p_seller_id: dilshodSellerId });
  console.log('Jamshid requesting Dilshod daily ledger result:', crossDailyErr ? `BLOCKED (${crossDailyErr.code}): ${crossDailyErr.message}` : 'ALLOWED (FAIL!)');

  console.log('\n=== TEST 3: Director Global Visibility Preserved ===');
  const { data: dirLedger } = await sbDirector.rpc('rpc_get_unified_customer_ledger');
  console.log('Director sees all customers count in unified ledger:', dirLedger?.items?.length);
  console.log('Director sees CUST-A38A87?', dirLedger?.items?.some(c => c.customer_code === 'CUST-A38A87'));
  console.log('Director sees CUST-7681F5?', dirLedger?.items?.some(c => c.customer_code === 'CUST-7681F5'));

  console.log('\n=== TEST 4: CUST-00AF4C Cash UZS & Grams Parity ===');
  const custAf4c = items.find(c => c.customer_code === 'CUST-00AF4C') || dirLedger?.items?.find(c => c.customer_code === 'CUST-00AF4C');
  console.log('CUST-00AF4C Unified Ledger entry:');
  console.log('  - paid_cash_amount_uzs:', custAf4c?.paid_cash_amount_uzs, 'UZS (Expected: 9,720,000 UZS)');
  console.log('  - paid_cash_equivalent_g:', custAf4c?.paid_cash_equivalent_g, 'g (Expected: 10.80 g)');
  console.log('  - gross_debt_g:', custAf4c?.gross_debt_g, 'g');
  console.log('  - net_debt_g:', custAf4c?.net_debt_g, 'g');

  console.log('\n=== TEST 5: Daily Ledger Date Filter (2026-10-22 Boundary) ===');
  const { data: daily22 } = await sbDirector.rpc('rpc_get_daily_sales_ledger', { p_start_date: '2026-10-22' });
  const datesIn22 = [...new Set((daily22 || []).map(r => r.tx_date))];
  console.log('Distinct dates returned when querying p_start_date = 2026-10-22:', datesIn22);
  const contains23 = (daily22 || []).some(r => r.tx_date === '2026-10-23');
  console.log('Does 2026-10-22 query contain 2026-10-23 entries?', contains23);
}

main().catch(console.error);
