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
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}
loadEnvFile(path.resolve(__dirname, '../.env.staging.local'));
loadEnvFile(path.resolve(__dirname, '../.env.local'));

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  await sb.auth.signInWithPassword({ email: 'director@goldia.uz', password: 'GoldiaPassword2026!' });

  // 1. Unified customer ledger
  const { data: unified, error: uErr } = await sb.rpc('rpc_get_unified_customer_ledger');
  if (uErr) console.error('Unified ledger error:', uErr);
  const totalNetDebtUnified = unified?.summary?.total_net_debt_g;

  // 2. Client gold accounts
  const { data: accs, error: aErr } = await sb.from('client_gold_accounts').select('current_debt_grams');
  if (aErr) console.error('Accounts error:', aErr);
  const totalDebtAccounts = accs.reduce((sum, a) => sum + Number(a.current_debt_grams || 0), 0);

  // 3. Monthly report for October 2026
  const { data: monthly, error: mErr } = await sb.rpc('rpc_get_customer_monthly_report', {
    p_seller_id: null,
    p_year: 2026,
    p_month: 10
  });
  if (mErr) console.error('Monthly report error:', mErr);
  const totalDebtMonthly = monthly?.summary?.total_customer_debt_g;

  console.log('--- RECONCILIATION AUDIT ---');
  console.log('Unified Ledger Total Net Debt:', totalNetDebtUnified, 'g');
  console.log('Client Accounts Total Debt:    ', totalDebtAccounts.toFixed(4), 'g');
  console.log('Monthly Report Total Debt:     ', totalDebtMonthly, 'g');

  const diffMonthlyVsUnified = Math.abs(Number(totalDebtMonthly) - Number(totalNetDebtUnified));
  const diffAccountsVsUnified = Math.abs(Number(totalDebtAccounts) - Number(totalNetDebtUnified));

  console.log(`Discrepancy (Monthly vs Unified): ${diffMonthlyVsUnified.toFixed(4)} g`);
  console.log(`Discrepancy (Accounts vs Unified): ${diffAccountsVsUnified.toFixed(4)} g`);

  if (diffMonthlyVsUnified < 0.0001 && diffAccountsVsUnified < 0.0001) {
    console.log('✅ PERFECT 100% PARITY ACHIEVED! Discrepancy is 0.0000 g!');
  } else {
    console.error('❌ Parity mismatch still present!');
  }
}

main().catch(console.error);
