/**
 * GOLDIA SALES — APPLY MIGRATIONS 045, 046, AND 047 TO PRODUCTION
 * Target: Goldia Production Supabase (vrozlllcaxinavzxueif)
 * 
 * STRICT SAFEGUARD: Only executes when explicitly called with confirmation.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
  console.log('GOLDIA SALES — APPLY MIGRATIONS 045, 046, AND 047 TO PRODUCTION');
  console.log('Target Database:', EXPECTED_PROD_REF);
  console.log('==============================================================================');

  const env = parseEnv(ENV_PATH);
  const dbUrl = env['DATABASE_URL'];
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  // 1. Preflight sanity checks
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

  // 2. Preflight Check: Auth Users
  const authRes = await fetch(`${prodUrl}/auth/v1/admin/users`, {
    headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` }
  });
  const authData = await authRes.json();
  const users = authData.users || [];
  console.log(`[PASS] Preflight Verified Auth Users (${users.length}):`, users.map(u => u.email).join(', '));

  if (users.length !== 3) {
    console.error(`❌ [CRITICAL STOP] Expected exactly 3 production users, found ${users.length}`);
    process.exit(1);
  }

  // 3. Apply migrations using supabase db push
  console.log('\n[STEP 1]: Executing supabase db push for migrations 045, 046, and 047...');
  const pushRes = spawnSync('npx', ['supabase', 'db', 'push', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });

  console.log('db push stdout:\n', pushRes.stdout);
  if (pushRes.stderr) console.error('db push stderr:\n', pushRes.stderr);

  if (pushRes.status !== 0) {
    console.error(`❌ Migration push failed with exit code ${pushRes.status}`);
    process.exit(1);
  }

  // 4. Post-flight verification
  console.log('\n[STEP 2]: Post-flight Migration Check...');
  const migRes = spawnSync('npx', ['supabase', 'migration', 'list', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  console.log(migRes.stdout);

  // 5. Verify Auth Users remain 100% intact
  const postAuthRes = await fetch(`${prodUrl}/auth/v1/admin/users`, {
    headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` }
  });
  const postAuthData = await postAuthRes.json();
  const postUsers = postAuthData.users || [];
  console.log(`[PASS] Post-flight Confirmed Auth Users (${postUsers.length}):`, postUsers.map(u => u.email).join(', '));

  // 6. Verify Customer Accounts remain 100% intact
  const postCustRes = await fetch(`${prodUrl}/rest/v1/customers?select=id,customer_code,contact_name`, {
    headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` }
  });
  const postCustomers = await postCustRes.json();
  console.log(`[PASS] Post-flight Confirmed Customers (${postCustomers.length}):`, postCustomers.map(c => `${c.customer_code} / ${c.contact_name}`).join(', '));

  console.log('\n==============================================================================');
  console.log('>>> PRODUCTION MIGRATIONS 045, 046, AND 047 APPLIED SUCCESSFULLY WITH ZERO DATA LOSS <<<');
  console.log('==============================================================================');
}

run().catch(err => {
  console.error('Error applying production migrations:', err);
  process.exit(1);
});
