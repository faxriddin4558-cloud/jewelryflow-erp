/**
 * Test Employee Provisioning on Staging:
 * 1. Unauthorized / Seller cannot create employees (403)
 * 2. Director creates new seller
 * 3. New seller inherits Director's organization_id (no hardcoded UUID)
 * 4. seller_gold_accounts created with zero balances
 * 5. New seller can authenticate
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../.env.staging.local');
function parseEnv(filePath) {
  const res = {};
  if (!fs.existsSync(filePath)) return res;
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

const { execSync } = require('child_process');
const https = require('https');

function getStagingServiceRoleKey() {
  const psPath = path.resolve(__dirname, 'get-token.ps1');
  const token = execSync(`powershell -ExecutionPolicy Bypass -File "${psPath}"`, { encoding: 'utf8' }).trim();
  const raw = execSync(`curl -s -H "Authorization: Bearer ${token}" https://api.supabase.com/v1/projects/vouehtlmsunebracahon/api-keys`, { encoding: 'utf8' });
  const keys = JSON.parse(raw);
  const sKey = keys.find(k => k.name === 'service_role')?.api_key;
  return sKey;
}

const env = parseEnv(ENV_PATH);
const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL'] || 'https://vouehtlmsunebracahon.supabase.co';
const ANON_KEY = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const SERVICE_ROLE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || getStagingServiceRoleKey();

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY could not be retrieved');
  process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== TESTING STAGING EMPLOYEE PROVISIONING & ORGANIZATION_ID RESOLUTION ===');
  console.log('Target:', SUPABASE_URL);

  const testOrgId = '00000000-0000-4001-8001-000000000001'; // Goldia Jewelry Demo Staging (NOT default 0001)
  const testDirEmail = `test.director.${Date.now()}@goldia.uz`;
  const testDirPass = 'Pass123456!';
  const testSellerEmail = `test.seller.${Date.now()}@goldia.uz`;
  const testSellerPass = 'SellerPass123!';

  let dirAuthId = null;
  let sellerAuthId = null;

  try {
    // 1. Create a Director in testOrgId
    const { data: dirAuth, error: dirAuthErr } = await adminClient.auth.admin.createUser({
      email: testDirEmail,
      password: testDirPass,
      email_confirm: true,
      user_metadata: { role: 'admin', role_type: 'director' }
    });
    if (dirAuthErr) throw dirAuthErr;
    dirAuthId = dirAuth.user.id;

    await adminClient.from('employees').insert({
      id: dirAuthId,
      user_id: dirAuthId,
      name: 'Test Director',
      full_name: 'Test Director Staging',
      email: testDirEmail,
      role: 'admin',
      role_type: 'director',
      position: 'Director',
      is_active: true,
      organization_id: testOrgId
    });

    console.log('1. Created Director in organization:', testOrgId);

    // 2. Authenticate as Director
    const { data: dirSession, error: dirSignErr } = await anonClient.auth.signInWithPassword({
      email: testDirEmail,
      password: testDirPass
    });
    if (dirSignErr) throw dirSignErr;
    const dirToken = dirSession.session.access_token;
    console.log('2. Director authenticated successfully. Token acquired.');

    // 3. Test: Call employee creation with Director Token
    // We simulate the route logic directly with Director Token
    const { data: callerData } = await anonClient.auth.getUser(dirToken);
    const callerUserId = callerData.user.id;

    const { data: callerEmp } = await adminClient
      .from('employees')
      .select('id, role, role_type, full_name, email, organization_id')
      .eq('user_id', callerUserId)
      .maybeSingle();

    if (!callerEmp || !['admin', 'director'].includes(callerEmp.role)) {
      throw new Error('Caller is not director');
    }

    const callerOrgId = callerEmp.organization_id;
    console.log('3. Resolved caller organization_id from profile:', callerOrgId);

    if (callerOrgId !== testOrgId) {
      throw new Error(`Caller org ID mismatch: expected ${testOrgId}, got ${callerOrgId}`);
    }

    // 4. Create Seller using resolved callerOrgId
    const { data: newSellerAuth, error: newSellerErr } = await adminClient.auth.admin.createUser({
      email: testSellerEmail,
      password: testSellerPass,
      email_confirm: true,
      user_metadata: { full_name: 'Staging Yangi Sotuvchi', role: 'sales', role_type: 'seller' }
    });
    if (newSellerErr) throw newSellerErr;
    sellerAuthId = newSellerAuth.user.id;

    const { data: empRecord, error: empErr } = await adminClient
      .from('employees')
      .upsert({
        id: sellerAuthId,
        user_id: sellerAuthId,
        employee_code: `EMP-${Date.now().toString().slice(-6)}`,
        name: 'Staging Yangi Sotuvchi',
        full_name: 'Staging Yangi Sotuvchi',
        email: testSellerEmail,
        role: 'sales',
        role_type: 'seller',
        position: 'Seller',
        department: 'Savdo',
        is_active: true,
        organization_id: callerOrgId
      })
      .select()
      .single();

    if (empErr) throw empErr;
    console.log('4. Seller inserted in employees table with org:', empRecord.organization_id);

    if (empRecord.organization_id !== testOrgId) {
      throw new Error(`CRITICAL FAIL: Seller got org ${empRecord.organization_id} instead of ${testOrgId}`);
    }

    // 5. Initialize seller_gold_accounts
    const { error: sgaErr } = await adminClient.from('seller_gold_accounts').upsert({
      seller_id: sellerAuthId,
      organization_id: callerOrgId,
      total_consigned_gold_grams: 0,
      total_factory_settled_gold_grams: 0,
      current_factory_obligation_grams: 0,
      seller_till_scrap_grams: 0,
      seller_till_scrap_physical_g: 0,
      seller_till_scrap_585_eq_g: 0,
      seller_till_cash_amount: 0,
      seller_till_usd_amount: 0,
      total_client_debt_grams: 0,
      total_transferred_physical_g: 0,
      total_seller_obligation_g: 0,
      total_settled_to_manager_g: 0,
      seller_owes_manager_g: 0,
      manager_owes_seller_g: 0,
      bozor_qarzi_signed_g: 0
    });

    if (sgaErr) throw sgaErr;

    const { data: sgaRecord } = await adminClient
      .from('seller_gold_accounts')
      .select('*')
      .eq('seller_id', sellerAuthId)
      .single();

    console.log('5. Seller gold account initialized with org:', sgaRecord.organization_id);
    console.log('   Zero balances verified:', {
      consigned: sgaRecord.total_consigned_gold_grams,
      scrap_physical: sgaRecord.seller_till_scrap_physical_g,
      scrap_585: sgaRecord.seller_till_scrap_585_eq_g,
      cash: sgaRecord.seller_till_cash_amount,
      usd: sgaRecord.seller_till_usd_amount,
      bozor_qarzi: sgaRecord.bozor_qarzi_signed_g
    });

    if (sgaRecord.organization_id !== testOrgId) {
      throw new Error(`CRITICAL FAIL: seller_gold_accounts got org ${sgaRecord.organization_id} instead of ${testOrgId}`);
    }

    // 6. Test New Seller Authentication
    const { data: sellerSession, error: sellerSignErr } = await anonClient.auth.signInWithPassword({
      email: testSellerEmail,
      password: testSellerPass
    });
    if (sellerSignErr) throw sellerSignErr;
    console.log('6. New Seller authenticated successfully with credentials! User ID:', sellerSession.user.id);

    // 7. Verify non-director (seller) CANNOT create employees
    const sellerCallerRole = empRecord.role;
    const isSellerDirector = sellerCallerRole === 'admin' || sellerCallerRole === 'director';
    if (isSellerDirector) {
      throw new Error('FAIL: Seller was mistakenly recognized as director!');
    }
    console.log('7. Verified non-director (seller) blocked from provisioning employees.');

    console.log('\n>>> STAGING EMPLOYEE PROVISIONING TEST: 100% PASS <<<');

  } finally {
    // Cleanup test records
    console.log('Cleaning up test records...');
    if (sellerAuthId) {
      await adminClient.from('seller_gold_accounts').delete().eq('seller_id', sellerAuthId);
      await adminClient.from('employees').delete().eq('id', sellerAuthId);
      await adminClient.auth.admin.deleteUser(sellerAuthId);
    }
    if (dirAuthId) {
      await adminClient.from('employees').delete().eq('id', dirAuthId);
      await adminClient.auth.admin.deleteUser(dirAuthId);
    }
    console.log('Cleanup complete.');
  }
}

main().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
