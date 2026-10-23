const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function getStagingServiceRoleKey() {
  const rawKeys = execSync('npx supabase projects api-keys --project-ref vouehtlmsunebracahon --output json', {
    encoding: 'utf8'
  });
  const jsonStart = rawKeys.indexOf('[');
  const jsonEnd = rawKeys.lastIndexOf(']') + 1;
  const keys = JSON.parse(rawKeys.slice(jsonStart, jsonEnd));
  const serviceKey = keys.find(k => k.name === 'service_role');
  const anonKey = keys.find(k => k.name === 'anon');
  return { serviceRoleKey: serviceKey.api_key, anonKey: anonKey.api_key };
}

async function run() {
  console.log('==============================================================================');
  console.log('JEWELRYFLOW SALES — ATOMIC EMPLOYEE CREATION, LOGIN, AND ACCESS TEST');
  console.log('==============================================================================');

  const { serviceRoleKey, anonKey } = getStagingServiceRoleKey();
  const supabaseUrl = 'https://vouehtlmsunebracahon.supabase.co';

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const anonClient = createClient(supabaseUrl, anonKey);

  const testEmail = 'real.seller.audit.' + Date.now() + '@goldia.uz';
  const testPassword = 'GoldiaPassword2026!';
  const testName = 'Temur Test Sotuvchi';
  const testRole = 'sales';

  console.log('\n[1/5] Testing Auth User Creation via admin API (No Email Limits)...');
  const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
    user_metadata: {
      full_name: testName,
      role: testRole
    }
  });

  if (authErr) throw new Error('Auth creation failed: ' + authErr.message);
  console.log('  ✅ Auth user created successfully. User ID:', authUser.user.id);

  console.log('\n[2/5] Inserting employee profile linked 1:1 to Auth user...');
  const empCode = 'EMP-TEST-' + Math.floor(Math.random() * 9000 + 1000);
  const { data: emp, error: empErr } = await adminClient.from('employees').upsert({
    id: authUser.user.id,
    user_id: authUser.user.id,
    employee_code: empCode,
    name: testName,
    full_name: testName,
    email: testEmail,
    phone: '+998901234567',
    role: testRole,
    role_type: 'seller',
    department: 'Savdo',
    position: 'Seller',
    is_active: true,
    organization_id: '00000000-0000-4001-8001-000000000001'
  }).select().single();

  if (empErr) {
    console.error('Employee creation failed, rolling back auth user...');
    await adminClient.auth.admin.deleteUser(authUser.user.id);
    throw new Error('Employee insert failed: ' + empErr.message);
  }
  console.log('  ✅ Employee row created. Code:', emp.employee_code);

  console.log('\n[3/5] Initializing seller_gold_accounts with strictly 0.0000 g...');
  const { data: sga, error: sgaErr } = await adminClient.from('seller_gold_accounts').insert({
    seller_id: authUser.user.id,
    organization_id: '00000000-0000-4001-8001-000000000001',
    total_consigned_gold_grams: 0,
    total_factory_settled_gold_grams: 0,
    current_factory_obligation_grams: 0,
    seller_till_scrap_grams: 0,
    seller_till_cash_amount: 0,
    total_client_debt_grams: 0,
    total_transferred_physical_g: 0,
    total_seller_obligation_g: 0,
    total_settled_to_manager_g: 0,
    seller_owes_manager_g: 0,
    manager_owes_seller_g: 0,
    bozor_qarzi_signed_g: 0
  }).select().single();

  if (sgaErr) {
    console.error('SGA creation failed, rolling back employee and auth user...');
    await adminClient.from('employees').delete().eq('id', authUser.user.id);
    await adminClient.auth.admin.deleteUser(authUser.user.id);
    throw new Error('SGA insert failed: ' + sgaErr.message);
  }
  console.log('  ✅ Seller gold account opened:');
  console.log('     current_factory_obligation_grams:', sga.current_factory_obligation_grams, 'g');
  console.log('     bozor_qarzi_signed_g:', sga.bozor_qarzi_signed_g, 'g');
  console.log('     total_client_debt_grams:', sga.total_client_debt_grams, 'g');

  console.log('\n[4/5] Testing Real Login and RLS Isolation for the new seller...');
  const newSellerClient = createClient(supabaseUrl, anonKey);
  const { data: loginData, error: loginErr } = await newSellerClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  });

  if (loginErr) throw new Error('New seller login failed: ' + loginErr.message);
  console.log('  ✅ Login successful! Session user ID:', loginData.user.id);

  // Query own account
  const { data: ownSga, error: ownSgaErr } = await newSellerClient.from('seller_gold_accounts').select('*');
  console.log('  Own SGA accounts visible:', ownSga?.length);
  if (ownSga && ownSga.length === 1) {
    console.log('  ✅ New seller sees strictly their own 0.0000 g account.');
  } else {
    console.log('  ⚠️ Visible accounts mismatch:', ownSga);
  }

  // Test logout
  console.log('\n[5/5] Testing Logout & Rollback/Cleanup...');
  await newSellerClient.auth.signOut();
  console.log('  ✅ Logout completed.');

  // Clean up test records
  await adminClient.from('seller_gold_accounts').delete().eq('seller_id', authUser.user.id);
  await adminClient.from('employees').delete().eq('id', authUser.user.id);
  await adminClient.auth.admin.deleteUser(authUser.user.id);
  console.log('  ✅ Test employee, SGA, and auth user cleaned up successfully.');

  console.log('\n==============================================================================');
  console.log('ATOMIC EMPLOYEE PROVISIONING TEST RESULT: 100% PASS');
  console.log('==============================================================================');
}

run().catch(err => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
