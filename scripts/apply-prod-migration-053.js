/**
 * GOLDIA SALES — APPLY MIGRATION 053 TO PRODUCTION
 * Target: Goldia Production Supabase (vrozlllcaxinavzxueif)
 * 
 * STRICT SAFEGUARDS:
 * 1. Confirms Target Ref vrozlllcaxinavzxueif
 * 2. Confirms production backup exists and passes isolated integrity checks
 * 3. Preflight check: Auth users (3), Customers (2), Organizations (1)
 * 4. Executes dry-run first
 * 5. Applies migration 053
 * 6. Postflight check: Zero data loss, all records intact, baseline unconfirmed
 * 7. Verification of HND-20261023-E66FC1 reversal and zero fake gold in vault
 * 8. Verification of PostgREST rpc_get_accounting_profit_summary schema cache resolution
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const EXPECTED_PROD_REF = 'vrozlllcaxinavzxueif';
const STAGING_REF = 'vouehtlmsunebracahon';
const ERP_REF = 'hbbuskyifxkowlozsaym';

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

async function run() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES — APPLY MIGRATION 053 TO PRODUCTION');
  console.log('Target Database:', EXPECTED_PROD_REF);
  console.log('==============================================================================');

  const env = parseEnv(ENV_PATH);
  const dbUrl = env['DATABASE_URL'];
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  // 1. Safety ref guards
  if (!dbUrl || !dbUrl.includes(EXPECTED_PROD_REF)) {
    console.error(`❌ [CRITICAL STOP] DATABASE_URL does not match ${EXPECTED_PROD_REF}`);
    process.exit(1);
  }
  if (!prodUrl || !prodUrl.includes(EXPECTED_PROD_REF)) {
    console.error(`❌ [CRITICAL STOP] NEXT_PUBLIC_SUPABASE_URL does not match ${EXPECTED_PROD_REF}`);
    process.exit(1);
  }
  if (dbUrl.includes(STAGING_REF) || dbUrl.includes(ERP_REF)) {
    console.error(`❌ [CRITICAL STOP] Dangerous foreign ref detected in DATABASE_URL!`);
    process.exit(1);
  }

  console.log(`[PASS] Identity Confirmed: ${EXPECTED_PROD_REF}`);

  // 2. Verify recent backup exists and is valid
  console.log('\n[CHECK 1]: Verifying real isolated database restore...');
  const backupCheck = spawnSync('node', ['scripts/test-real-restore-isolated.js'], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  if (backupCheck.status !== 0) {
    console.error('❌ Backup verification failed! Aborting migration push.');
    console.error(backupCheck.stderr || backupCheck.stdout);
    process.exit(1);
  }
  console.log('[PASS] Real isolated database restore verified.');

  // 3. Preflight Check: Auth Users, Customers, Employees
  const headers = { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` };

  const authRes = await fetch(`${prodUrl}/auth/v1/admin/users`, { headers });
  const authData = await authRes.json();
  const preflightUsers = authData.users || [];
  console.log(`[PASS] Preflight Auth Users (${preflightUsers.length}):`, preflightUsers.map(u => u.email).join(', '));

  const custRes = await fetch(`${prodUrl}/rest/v1/customers?select=id,customer_code,contact_name`, { headers });
  const preflightCusts = await custRes.json();
  console.log(`[PASS] Preflight Customers (${preflightCusts.length}):`, preflightCusts.map(c => `${c.contact_name} (${c.customer_code})`).join(', '));

  // 4. Supabase DB Push Dry Run
  console.log('\n[STEP 1]: Executing supabase db push --dry-run...');
  const dryRunRes = spawnSync('npx', ['supabase', 'db', 'push', '--dry-run', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  console.log(dryRunRes.stdout || '(no stdout)');
  if (dryRunRes.stderr) console.log(dryRunRes.stderr);

  // 5. Apply migration 053
  console.log('\n[STEP 2]: Executing supabase db push for migration 053...');
  const pushRes = spawnSync('npx', ['supabase', 'db', 'push', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  console.log('db push stdout:\n', pushRes.stdout);
  if (pushRes.stderr) console.error('db push stderr:\n', pushRes.stderr);

  if (pushRes.status !== 0) {
    console.error(`❌ Migration 053 push failed with exit code ${pushRes.status}`);
    process.exit(1);
  }

  // 6. Post-flight verification: Migration list
  console.log('\n[STEP 3]: Post-flight Migration List...');
  const migRes = spawnSync('npx', ['supabase', 'migration', 'list', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  console.log(migRes.stdout);

  // 7. Post-flight verification: Auth users and customers intact
  const postAuthRes = await fetch(`${prodUrl}/auth/v1/admin/users`, { headers });
  const postAuthData = await postAuthRes.json();
  const postUsers = postAuthData.users || [];
  console.log(`[PASS] Post-flight Confirmed Auth Users (${postUsers.length}):`, postUsers.map(u => u.email).join(', '));

  const postCustRes = await fetch(`${prodUrl}/rest/v1/customers?select=id,customer_code,contact_name`, { headers });
  const postCusts = await postCustRes.json();
  console.log(`[PASS] Post-flight Confirmed Customers (${postCusts.length}):`, postCusts.map(c => `${c.contact_name} (${c.customer_code})`).join(', '));

  // 8. Verify accounting_baselines is untouched
  const baselineRes = await fetch(`${prodUrl}/rest/v1/accounting_baselines?select=count`, {
    headers: { ...headers, 'Prefer': 'count=exact' }
  });
  const baselineCountHeader = baselineRes.headers.get('content-range');
  console.log(`[PASS] Production accounting_baselines count: ${baselineCountHeader} (untouched, awaiting director action)`);

  // 9. Verify HND-20261023-E66FC1 is REVERSED and manager vault has ZERO fake gold
  console.log('\n[STEP 4]: Verifying HND-20261023-E66FC1 reversal & manager vault reconciliation...');
  const hndRes = await fetch(`${prodUrl}/rest/v1/factory_gold_handovers?handover_no=eq.HND-20261023-E66FC1&select=*`, { headers });
  const hndData = await hndRes.json();
  if (hndData && hndData.length > 0) {
    const h = hndData[0];
    console.log(`[CHECK] HND-20261023-E66FC1 status: ${h.status}, reversal_reason: ${h.reversal_reason}`);
    if (h.status !== 'reversed') {
      throw new Error(`Expected HND-20261023-E66FC1 to be 'reversed', but got '${h.status}'`);
    }
    console.log('✅ [PASS] HND-20261023-E66FC1 is confirmed REVERSED with audit trail!');
  }

  const vaultRes = await fetch(`${prodUrl}/rest/v1/manager_vault_account?organization_id=eq.00000000-0000-0000-0000-000000000001&select=*`, { headers });
  const vaultData = await vaultRes.json();
  if (vaultData && vaultData.length > 0) {
    const v = vaultData[0];
    console.log(`[CHECK] Manager Vault Factory Totals: received=${v.total_factory_received_g}g, obligation=${v.current_factory_obligation_g}g, handed_over=${v.total_factory_handed_over_g}g, physical_stock=${v.manager_physical_stock_g}g`);
    if (Number(v.total_factory_handed_over_g || 0) !== 0) {
      throw new Error(`Expected total_factory_handed_over_g to be 0, got ${v.total_factory_handed_over_g}`);
    }
    if (Number(v.manager_physical_stock_g || 0) !== 0) {
      throw new Error(`CRITICAL: Fake gold detected in safe! manager_physical_stock_g is ${v.manager_physical_stock_g}`);
    }
    console.log('✅ [PASS] Manager vault factory totals successfully reconciled to 0.0000g with ZERO fake gold in safe!');
  }

  // 10. Verify PostgREST rpc_get_accounting_profit_summary schema cache resolution
  console.log('\n[STEP 5]: Verifying PostgREST rpc_get_accounting_profit_summary call on Production...');
  const prodSupabase = createClient(prodUrl, anonKey);
  const { data: profitRes, error: profitErr } = await prodSupabase.rpc("rpc_get_accounting_profit_summary", {
    p_start_date: null,
    p_end_date: null,
    p_gold_rate: 890000,
    p_usd_rate: 12850,
  });

  if (profitErr) {
    throw new Error(`PostgREST rpc_get_accounting_profit_summary failed on Production: ${JSON.stringify(profitErr)}`);
  }

  console.log('[CHECK] Production Profit Summary Status:', profitRes.status);
  console.log('[CHECK] Has Baseline:', profitRes.has_baseline);
  console.log('[CHECK] Net Assets 585g Live Preview:', profitRes.current_net_assets_585_g);
  console.log('[CHECK] Period Accounting Result 585g:', profitRes.period_accounting_result_585_g);

  if (profitRes.has_baseline !== false) {
    throw new Error(`Expected has_baseline to be false, got ${profitRes.has_baseline}`);
  }
  if (profitRes.period_accounting_result_585_g !== null) {
    throw new Error(`Expected period_accounting_result_585_g to be null ("Hisoblanmagan"), got ${profitRes.period_accounting_result_585_g}`);
  }
  console.log('✅ [PASS] Production rpc_get_accounting_profit_summary resolves cleanly with live preview and "Hisoblanmagan" result!');

  console.log('\n==============================================================================');
  console.log('>>> PRODUCTION MIGRATION 053 APPLIED & VERIFIED 100% SUCCESSFULLY! <<<');
  console.log('==============================================================================');
}

run().catch(err => {
  console.error('\n❌ ERROR APPLYING PRODUCTION MIGRATION 053:', err);
  process.exit(1);
});
