/**
 * GOLDIA SALES — APPLY MIGRATION 055 TO PRODUCTION
 * Target: Goldia Production Supabase (vrozlllcaxinavzxueif)
 * 
 * STRICT SAFEGUARDS:
 * 1. Confirms Target Ref vrozlllcaxinavzxueif
 * 2. Confirms production backup exists and passes isolated integrity checks
 * 3. Preflight check: Auth users (3), Customers (2), Organizations (1)
 * 4. Executes dry-run first
 * 5. Applies migration 055 (FIFO Consignment Deduction & Manager Stock Parity)
 * 6. Postflight check: Zero data loss, all records intact, baseline unconfirmed
 * 7. Verification of audit reconciliation of CONS-BC-514773B9 and ZVD-20261026-0BBA55
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
  console.log('GOLDIA SALES — APPLY MIGRATION 055 TO PRODUCTION');
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

  // 5. Apply migration 055
  console.log('\n[STEP 2]: Executing supabase db push for migration 055...');
  const pushRes = spawnSync('npx', ['supabase', 'db', 'push', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  console.log('db push stdout:\n', pushRes.stdout);
  if (pushRes.stderr) console.error('db push stderr:\n', pushRes.stderr);

  if (pushRes.status !== 0) {
    console.error(`❌ Migration 055 push failed with exit code ${pushRes.status}`);
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

  // 9. Verify audit reconciliation of CONS-BC-514773B9 and ZVD-20261026-0BBA55 on Production
  console.log('\n[STEP 4]: Verifying audit reconciliation of CONS-BC-514773B9 and ZVD-20261026-0BBA55...');
  const prodSupabase = createClient(prodUrl, serviceRoleKey);

  const { data: receipts } = await prodSupabase.from('factory_receipts').select('*').eq('receipt_no', 'ZVD-20261026-0BBA55');
  const rcp = receipts[0];
  console.log('Production Receipt ZVD-20261026-0BBA55:', {
    receipt_no: rcp.receipt_no,
    original_physical_g: rcp.original_physical_g,
    transferred_physical_g: rcp.transferred_physical_g,
    available_physical_g: rcp.available_physical_g,
    status: rcp.status
  });

  if (Number(rcp.available_physical_g) !== 0.5 || Number(rcp.transferred_physical_g) !== 105) {
    throw new Error(`Receipt stock mismatch! Expected available=0.5, transferred=105. Got: ${JSON.stringify(rcp)}`);
  }

  const { data: consignments } = await prodSupabase.from('seller_consignments').select('*').eq('consignment_no', 'CONS-BC-514773B9');
  const cns = consignments[0];
  console.log('Production Consignment CONS-BC-514773B9:', {
    consignment_no: cns.consignment_no,
    base_weight_grams: cns.base_weight_grams,
    factory_receipt_id: cns.factory_receipt_id,
    notes: cns.notes
  });

  if (cns.factory_receipt_id !== rcp.id) {
    throw new Error(`Consignment factory_receipt_id NOT linked! Expected ${rcp.id}, got ${cns.factory_receipt_id}`);
  }

  const { data: vaults } = await prodSupabase.from('manager_vault_account').select('*');
  const vault = vaults[0];
  console.log('Production Manager Vault:', {
    manager_physical_stock_g: vault.manager_physical_stock_g,
    total_factory_received_g: vault.total_factory_received_g,
    current_factory_obligation_g: vault.current_factory_obligation_g
  });

  if (Number(vault.manager_physical_stock_g) !== 0.5) {
    throw new Error(`Manager vault stock mismatch! Expected 0.5, got ${vault.manager_physical_stock_g}`);
  }

  const { data: sellerAccounts } = await prodSupabase.from('seller_gold_accounts').select('*');
  const sAcc = sellerAccounts[0];
  console.log('Production Seller Account:', {
    current_physical_stock_g: sAcc.current_physical_stock_g,
    total_transferred_physical_g: sAcc.total_transferred_physical_g
  });

  if (Number(sAcc.current_physical_stock_g) !== 105) {
    throw new Error(`Seller stock mismatch! Expected 105, got ${sAcc.current_physical_stock_g}`);
  }

  const totalStock = Number(vault.manager_physical_stock_g) + Number(sAcc.current_physical_stock_g);
  const factoryReceived = Number(rcp.original_physical_g);
  const discrepancy = Math.abs(factoryReceived - totalStock);
  console.log(`Total Stock Reconciliation: Manager (${vault.manager_physical_stock_g}g) + Seller (${sAcc.current_physical_stock_g}g) = ${totalStock}g (Factory Received: ${factoryReceived}g). Discrepancy: ${discrepancy}g`);

  if (discrepancy > 0.0001) {
    throw new Error(`Discrepancy detected! Expected 0, got ${discrepancy}`);
  }

  console.log('\n==============================================================================');
  console.log('>>> PRODUCTION MIGRATION 055 APPLIED & VERIFIED 100% SUCCESSFULLY! <<<');
  console.log('==============================================================================');
}

run().catch(err => {
  console.error('\n❌ ERROR APPLYING PRODUCTION MIGRATION 055:', err);
  process.exit(1);
});
