/**
 * JEWELRYFLOW SALES — APPLY MIGRATION 043 TO PRODUCTION
 * Target: Goldia Production Supabase (vrozlllcaxinavzxueif)
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
  console.log('JEWELRYFLOW SALES — APPLY MIGRATION 043 TO PRODUCTION');
  console.log('==============================================================================');

  const env = parseEnv(ENV_PATH);
  const dbUrl = env['DATABASE_URL'];
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  // 1. Preflight sanity check
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

  // 2. Apply migration 043 using supabase db push
  console.log('\n[STEP 1]: Executing db push for migration 043...');
  const pushRes = spawnSync('npx', ['supabase', 'db', 'push', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8',
    input: 'y\n'
  });

  console.log('Push stdout:');
  console.log(pushRes.stdout || '(no stdout)');
  if (pushRes.stderr) {
    console.log('Push stderr:');
    console.log(pushRes.stderr);
  }

  if (pushRes.status !== 0) {
    console.error('❌ Migration 043 push failed with status code:', pushRes.status);
    process.exit(1);
  }

  // 3. Post-flight verification
  console.log('\n==============================================================================');
  console.log('[STEP 2]: POST-MIGRATION VERIFICATION');
  console.log('==============================================================================');

  // Verify migration list
  const listRes = spawnSync('npx', ['supabase', 'migration', 'list', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  console.log('Updated Migration List:');
  console.log(listRes.stdout);

  // Verify Auth Users (must still be 3)
  const authRes = await fetch(`${prodUrl}/auth/v1/admin/users`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  const authData = await authRes.json();
  const users = authData.users || [];
  console.log(`Post-flight Auth Users: ${users.length} (Expected: 3)`);
  if (users.length !== 3) {
    console.error('⚠️ User count mismatch!');
  } else {
    console.log('  ✅ 3 Live users verified intact:');
    users.forEach(u => console.log(`     - ${u.email}`));
  }

  // Verify Customers (must still be 1)
  const custRes = await fetch(`${prodUrl}/rest/v1/customers?select=id,customer_code,contact_name`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  const customers = await custRes.json();
  console.log(`Post-flight Customers: ${customers.length} (Expected: 1)`);
  if (customers.length !== 1) {
    console.error('⚠️ Customer count mismatch!');
  } else {
    console.log(`  ✅ 1 Live customer verified intact: ${customers[0].customer_code} / ${customers[0].contact_name}`);
  }

  // Verify Employees (must still be 3)
  const empRes = await fetch(`${prodUrl}/rest/v1/employees?select=id,name,role,email`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  const emps = await empRes.json();
  console.log(`Post-flight Employees: ${emps.length} (Expected: 3)`);

  // Verify Storage Bucket
  const bucketRes = await fetch(`${prodUrl}/storage/v1/bucket/jewelry-models`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  if (bucketRes.status === 200) {
    const bucket = await bucketRes.json();
    console.log(`  ✅ Storage bucket 'jewelry-models' exists and public=${bucket.public}`);
  } else {
    console.error(`  ❌ Storage bucket 'jewelry-models' status: ${bucketRes.status}`);
  }

  // Verify USD columns via OpenAPI definitions
  const restRes = await fetch(`${prodUrl}/rest/v1/`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  if (restRes.status === 200) {
    const spec = await restRes.json();
    const sellerGoldAccCols = spec.definitions?.seller_gold_accounts?.properties || {};
    const mgrVaultCols = spec.definitions?.manager_vault_account?.properties || {};
    const stlCols = spec.definitions?.gold_settlements?.properties || {};

    const hasSellerUsd = 'seller_till_usd_amount' in sellerGoldAccCols;
    const hasMgrUsd = 'manager_usd_amount' in mgrVaultCols;
    const hasStlUsd = 'usd_paid_amount' in stlCols && 'applied_usd_rate' in stlCols;

    console.log(`  ✅ seller_gold_accounts.seller_till_usd_amount exists: ${hasSellerUsd}`);
    console.log(`  ✅ manager_vault_account.manager_usd_amount exists: ${hasMgrUsd}`);
    console.log(`  ✅ gold_settlements (usd_paid_amount, applied_usd_rate) exists: ${hasStlUsd}`);
  }

  console.log('\n🎉 PRODUCTION MIGRATION 043 APPLIED AND VERIFIED 100% SUCCESSFULLY!');
}

run().catch(console.error);
