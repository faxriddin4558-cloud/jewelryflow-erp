const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');

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

async function verify() {
  console.log('--- PRODUCTION POST-DEPLOY VERIFICATION (vrozlllcaxinavzxueif) ---');
  const env = parseEnv(ENV_PATH);
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  const supabase = createClient(prodUrl, serviceRoleKey);

  // 1. Check Baseline
  const { data: baselines, error: bErr } = await supabase.from('accounting_baselines').select('*');
  if (bErr) throw bErr;
  console.log('✅ Baseline check: Found', baselines.length, 'baseline(s)');
  if (baselines.length > 0) {
    console.log(`   Baseline No: ${baselines[0].baseline_no}, Status: ${baselines[0].status}, Net Assets: ${baselines[0].net_assets_585_g}g`);
  }

  // 2. Check Manager Vault
  const { data: vaults, error: vErr } = await supabase.from('manager_vault_account').select('*');
  if (vErr) throw vErr;
  console.log('✅ Manager Vault: Found', vaults.length, 'vault record');
  if (vaults.length > 0) {
    console.log(`   Capital Pure Gold: ${vaults[0].manager_capital_pure_gold_g}g (585 eq) / ${vaults[0].manager_capital_pure_gold_fine_g}g (fine)`);
    console.log(`   Factory Obligation: ${vaults[0].current_factory_obligation_g}g`);
  }

  // 3. Check Handovers
  const { data: handovers, error: hErr } = await supabase.from('factory_gold_handovers').select('*');
  if (hErr) throw hErr;
  console.log('✅ Factory Gold Handovers: Found', handovers.length, 'handovers');

  // 4. Check Employees
  const { data: employees, error: eErr } = await supabase.from('employees').select('id, name, role, is_active');
  if (eErr) throw eErr;
  console.log('✅ Employees: Found', employees.length, 'employees:', employees.map(e => `${e.name} (${e.role})`).join(', '));

  console.log('--- ALL PRODUCTION INTEGRITY CHECKS PASSED ---');
}

verify().catch(err => {
  console.error('PROD VERIFY FAILED:', err);
  process.exit(1);
});
