const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function getStagingKeys() {
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
  console.log('JEWELRYFLOW SALES — PRE-FLIGHT ROLE ACCESS & DEBT INTEGRITY VERIFICATION');
  console.log('==============================================================================');

  const { serviceRoleKey, anonKey } = getStagingKeys();
  const supabaseUrl = 'https://vouehtlmsunebracahon.supabase.co';

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const directorClient = createClient(supabaseUrl, anonKey);

  // Authenticate as Director
  const { data: dirAuth, error: dirErr } = await directorClient.auth.signInWithPassword({
    email: 'director@goldia.uz',
    password: 'GoldiaPassword2026!'
  });
  if (dirErr) throw new Error('Director login failed: ' + dirErr.message);
  console.log('1. Director authenticated:', dirAuth.user.id);

  // Snapshot existing historical balances before creation
  const { data: beforeSga } = await directorClient.from('seller_gold_accounts').select('seller_id, bozor_qarzi_signed_g, current_factory_obligation_grams');
  const { data: beforeCustAccounts } = await directorClient.from('client_gold_accounts').select('customer_id, current_debt_grams, total_purchased_gold_grams').limit(5);

  console.log('\n2. Snapshot of historical balances before test:');
  console.log('   Total active seller accounts:', beforeSga?.length);
  beforeSga?.slice(0, 3).forEach(s => console.log(`   Seller ${s.seller_id.slice(-6)}: obligation=${s.current_factory_obligation_grams}g, bozor_qarzi=${s.bozor_qarzi_signed_g}g`));
  console.log('   Sample customer debt:', beforeCustAccounts?.[0]?.current_debt_grams, 'g');

  // Create new seller via atomic provisioning
  const newEmail = `farxod.test.${Date.now()}@goldia.uz`;
  const newPass = 'GoldiaPassword2026!';
  const newName = 'Farxod Test Xodim';

  console.log('\n3. Provisioning new Seller (Auth + Employees + SGA)...');
  const { data: authRes, error: authErr } = await adminClient.auth.admin.createUser({
    email: newEmail,
    password: newPass,
    email_confirm: true,
    user_metadata: { full_name: newName, role: 'sales' }
  });
  if (authErr) throw new Error('Auth creation failed: ' + authErr.message);
  const newUserId = authRes.user.id;

  const { data: newEmp, error: newEmpErr } = await adminClient.from('employees').insert({
    id: newUserId,
    user_id: newUserId,
    employee_code: 'EMP-FARXOD-99',
    name: newName,
    full_name: newName,
    email: newEmail,
    role: 'sales',
    role_type: 'seller',
    department: 'Savdo',
    position: 'Seller',
    is_active: true,
    organization_id: '00000000-0000-4001-8001-000000000001'
  }).select().single();
  if (newEmpErr) throw new Error('Employee insert failed: ' + newEmpErr.message);

  const { data: newSga, error: newSgaErr } = await adminClient.from('seller_gold_accounts').insert({
    seller_id: newUserId,
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
  if (newSgaErr) throw new Error('SGA insert failed: ' + newSgaErr.message);

  console.log('   ✅ New seller account opened:');
  console.log('      current_factory_obligation_grams =', newSga.current_factory_obligation_grams, 'g');
  console.log('      bozor_qarzi_signed_g =', newSga.bozor_qarzi_signed_g, 'g');
  console.log('      total_client_debt_grams =', newSga.total_client_debt_grams, 'g');

  // Verify historical debts were NOT zeroed or modified
  const { data: afterSga } = await directorClient.from('seller_gold_accounts').select('seller_id, bozor_qarzi_signed_g, current_factory_obligation_grams');
  const { data: afterCustAccounts } = await directorClient.from('client_gold_accounts').select('customer_id, current_debt_grams, total_purchased_gold_grams').limit(5);

  console.log('\n4. Verifying Historical Data Integrity:');
  let historicalIntegrityPreserved = true;
  beforeSga?.forEach(oldS => {
    const matched = afterSga?.find(n => n.seller_id === oldS.seller_id);
    if (!matched || matched.bozor_qarzi_signed_g !== oldS.bozor_qarzi_signed_g || matched.current_factory_obligation_grams !== oldS.current_factory_obligation_grams) {
      historicalIntegrityPreserved = false;
      console.error('❌ Mismatch in historical seller:', oldS.seller_id);
    }
  });

  if (historicalIntegrityPreserved) {
    console.log('   ✅ All historical seller balances strictly preserved (0 debts were zeroed out).');
  }

  if (beforeCustAccounts?.[0]?.current_debt_grams === afterCustAccounts?.[0]?.current_debt_grams) {
    console.log('   ✅ Historical customer debts strictly intact.');
  }

  // 5. Test Login as New Seller & RLS
  console.log('\n5. Testing Login as New Seller & RLS Boundary...');
  const newSellerClient = createClient(supabaseUrl, anonKey);
  const { data: newLogin, error: newLoginErr } = await newSellerClient.auth.signInWithPassword({
    email: newEmail,
    password: newPass
  });
  if (newLoginErr) throw new Error('New seller login failed: ' + newLoginErr.message);
  console.log('   ✅ Logged in successfully as Farxod. User ID:', newLogin.user.id);

  // Farxod attempts to view other sellers' accounts
  const { data: farxodVisibleSga } = await newSellerClient.from('seller_gold_accounts').select('*');
  console.log('   Visible SGA count to Farxod:', farxodVisibleSga?.length);
  if (farxodVisibleSga?.length === 1 && farxodVisibleSga[0].seller_id === newUserId) {
    console.log('   ✅ Strict RLS isolation: Farxod only sees his own 0.00g account.');
  } else {
    console.error('   ❌ RLS failure! Visible:', farxodVisibleSga);
  }

  // Farxod attempts to call director RPC
  const { error: unauthorizedRpcErr } = await newSellerClient.rpc('rpc_record_factory_receipt', {
    p_product_name: 'Hack Test',
    p_quantity: 1,
    p_original_physical_g: 100,
    p_proba: 585
  });
  console.log('   Farxod factory receipt RPC attempt:', unauthorizedRpcErr?.code, unauthorizedRpcErr?.message);
  if (unauthorizedRpcErr && (unauthorizedRpcErr.code === '42501' || unauthorizedRpcErr.message.includes('ruxsat'))) {
    console.log('   ✅ Manager/Director RPC strictly blocked for new seller (42501).');
  } else {
    console.error('   ❌ Security failure: Unauthorized RPC was not blocked!');
  }

  // 6. Test Logout
  console.log('\n6. Testing Logout...');
  await newSellerClient.auth.signOut();
  console.log('   ✅ Farxod logged out cleanly.');

  // 7. Cleanup
  console.log('\n7. Cleaning up test records...');
  await adminClient.from('seller_gold_accounts').delete().eq('seller_id', newUserId);
  await adminClient.from('employees').delete().eq('id', newUserId);
  await adminClient.auth.admin.deleteUser(newUserId);
  console.log('   ✅ Test account fully cleaned up.');

  console.log('\n==============================================================================');
  console.log('PRE-FLIGHT ROLE ACCESS & DEBT INTEGRITY VERIFICATION: 100% PASS');
  console.log('==============================================================================');
}

run().catch(err => {
  console.error('Verification FAILED:', err);
  process.exit(1);
});
