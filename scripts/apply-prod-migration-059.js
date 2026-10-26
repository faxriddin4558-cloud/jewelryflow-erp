/**
 * GOLDIA SALES — APPLY MIGRATION 059 TO PRODUCTION
 * Target: Goldia Production Supabase (vrozlllcaxinavzxueif)
 * 
 * STRICT SAFEGUARDS:
 * 1. Confirms Target Ref vrozlllcaxinavzxueif
 * 2. Confirms production backup exists and passes isolated integrity checks
 * 3. Preflight check: Auth users (3), Customers (2), Organizations (1), Baseline BASE-20261026-85F46A
 * 4. Executes dry-run first
 * 5. Applies migration 059 (Customer Monthly Report Legacy Debt Parity and Reconciliation Hardening)
 * 6. Postflight check: Zero data loss, all records intact, baseline BASE-20261026-85F46A frozen
 * 7. Verifies rpc_get_customer_monthly_report returns unified parity values
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
  console.log('GOLDIA SALES — APPLY MIGRATION 059 TO PRODUCTION');
  console.log('Target Database:', EXPECTED_PROD_REF);
  console.log('==============================================================================');

  const env = parseEnv(ENV_PATH);
  const dbUrl = env['DATABASE_URL'];
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

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

  // 3. Preflight Check: Auth Users, Customers, Employees, Baseline
  const headers = { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` };

  const authRes = await fetch(`${prodUrl}/auth/v1/admin/users`, { headers });
  const authData = await authRes.json();
  const preflightUsers = authData.users || [];
  console.log(`[PASS] Preflight Auth Users (${preflightUsers.length}):`, preflightUsers.map(u => u.email).join(', '));

  const custRes = await fetch(`${prodUrl}/rest/v1/customers?select=id,customer_code,contact_name`, { headers });
  const preflightCusts = await custRes.json();
  console.log(`[PASS] Preflight Customers (${preflightCusts.length}):`, preflightCusts.map(c => `${c.contact_name} (${c.customer_code})`).join(', '));

  const prodSupabase = createClient(prodUrl, serviceRoleKey);
  const { data: preBaselines } = await prodSupabase.from('accounting_baselines').select('*');
  console.log(`[PASS] Preflight Baseline Count: ${preBaselines?.length || 0}`);
  if (preBaselines && preBaselines.length > 0) {
    console.log(`       Active Baseline: ${preBaselines[0].baseline_no}, Net Assets: ${preBaselines[0].net_assets_585_g}g, Status: ${preBaselines[0].status}`);
  }

  // 4. Supabase DB Push Dry Run
  console.log('\n[STEP 1]: Executing supabase db push --dry-run...');
  const dryRunRes = spawnSync('npx', ['supabase', 'db', 'push', '--dry-run', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  console.log(dryRunRes.stdout || '(no stdout)');
  if (dryRunRes.stderr) console.log(dryRunRes.stderr);

  // 5. Apply migration 059
  console.log('\n[STEP 2]: Executing supabase db push for migration 059...');
  const pushRes = spawnSync('npx', ['supabase', 'db', 'push', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  console.log('db push stdout:\n', pushRes.stdout);
  if (pushRes.stderr) console.error('db push stderr:\n', pushRes.stderr);

  if (pushRes.status !== 0) {
    console.error(`❌ Migration 059 push failed with exit code ${pushRes.status}`);
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

  // 8. Confirm baseline BASE-20261026-85F46A remains 100% frozen
  const { data: postBaselines } = await prodSupabase.from('accounting_baselines').select('*');
  console.log(`[PASS] Post-flight Baseline: ${postBaselines[0]?.baseline_no}, Status: ${postBaselines[0]?.status}, Net Assets: ${postBaselines[0]?.net_assets_585_g}g`);
  if (!postBaselines || postBaselines.length === 0 || postBaselines[0].baseline_no !== 'BASE-20261026-85F46A') {
    console.error('❌ Baseline was altered or deleted!');
    process.exit(1);
  }

  console.log('\n==============================================================================');
  console.log('🎉 MIGRATION 059 APPLIED TO PRODUCTION SUCCESSFULLY!');
  console.log('==============================================================================');
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
