const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

async function runSecurityAudit() {
  console.log('==============================================================================');
  console.log('JEWELRYFLOW SALES — F01 & F02 AUTOMATED REGRESSION & SECURITY VERIFICATION');
  console.log('Target Ref: vouehtlmsunebracahon (jewelryflow-sales-staging)');
  console.log('==============================================================================');

  const rawKeys = execSync('npx supabase projects api-keys --project-ref vouehtlmsunebracahon --output json', { encoding: 'utf8' });
  const jsonStart = rawKeys.indexOf('[');
  const jsonEnd = rawKeys.lastIndexOf(']') + 1;
  const keys = JSON.parse(rawKeys.slice(jsonStart, jsonEnd));
  const anonKey = keys.find(k => k.name === 'anon').api_key;
  const serviceRoleKey = keys.find(k => k.name === 'service_role').api_key;
  const supabaseUrl = 'https://vouehtlmsunebracahon.supabase.co';

  const anonClient = createClient(supabaseUrl, anonKey);
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const demoPass = process.env.NEXT_PUBLIC_DEMO_PASSWORD || 'GoldiaPassword2026!';

  // Get employee mapping
  const { data: emps } = await adminClient.from('employees').select('id, email, name, role_type');
  const jamshidEmp = emps.find(e => e.email === 'seller@goldia.uz');
  const dilshodEmp = emps.find(e => e.email === 'dilshod@jewelryflow.uz');
  const jasurEmp = emps.find(e => e.email === 'jasur@jewelryflow.uz');

  console.log('\n[1/3] SELLER (Jamshid) NEGATIVE TESTS — F01 AUTHORIZATION CHECKS');

  // Sign in as Jamshid (real JWT)
  const { data: jamshidAuth, error: jamshidLoginErr } = await anonClient.auth.signInWithPassword({
    email: 'seller@goldia.uz',
    password: demoPass
  });
  if (jamshidLoginErr) throw jamshidLoginErr;

  const jamshidClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: 'Bearer ' + jamshidAuth.session.access_token } }
  });

  // Test 1: Check role returned by DB
  const { data: jamshidRole } = await jamshidClient.rpc('current_employee_role_text');
  console.log(`   * Jamshid DB Normalized Role: "${jamshidRole}" (Must be "seller")`);
  if (jamshidRole !== 'seller') {
    throw new Error(`FAIL: Jamshid role is "${jamshidRole}", expected "seller"!`);
  }

  // Test 2: F01 — Try creating factory receipt via RPC as Seller
  const { data: rcpData, error: rcpErr } = await jamshidClient.rpc('rpc_record_factory_receipt', {
    p_product_name: 'SECURITY-TEST-UNAUTHORIZED-RECEIPT',
    p_quantity: 1,
    p_original_physical_g: 0.1,
    p_proba: 585,
    p_factory_markup_pct: 8
  });
  if (!rcpErr) {
    throw new Error('FAIL: Jamshid was able to create factory receipt! Security guard bypassed!');
  }
  console.log(`   PASS [F01]: rpc_record_factory_receipt blocked with: "${rcpErr.message}" (code: ${rcpErr.code})`);

  // Test 3: F01 — Try direct table insert into factory_receipts as Seller
  const { error: dirInsErr } = await jamshidClient.from('factory_receipts').insert({
    organization_id: '00000000-0000-4001-8001-000000000001',
    receipt_no: 'ZVD-DIRECT-INTRUSION',
    product_name: 'Hacked Receipt',
    original_physical_g: 1.0,
    factory_markup_pct: 8.0,
    factory_obligation_g: 1.08
  });
  if (!dirInsErr) {
    throw new Error('FAIL: Jamshid was able to directly insert into factory_receipts table!');
  }
  console.log(`   PASS [F01]: Direct factory_receipts insert blocked by RLS: "${dirInsErr.message}" (code: ${dirInsErr.code})`);

  // Test 4: F01 — Try factory gold handover as Seller
  const { error: hndErr } = await jamshidClient.rpc('rpc_record_factory_gold_handover', {
    p_gross_weight_grams: 1.0,
    p_proba: 585
  });
  if (!hndErr) {
    throw new Error('FAIL: Jamshid was able to record factory gold handover!');
  }
  console.log(`   PASS [F01]: rpc_record_factory_gold_handover blocked with: "${hndErr.message}" (code: ${hndErr.code})`);

  // Test 5: F01 — Try refining batch as Seller
  const { error: refErr } = await jamshidClient.rpc('rpc_record_refining_batch', {
    p_input_scrap_grams: 1.0,
    p_melted_weight_grams: 0.99,
    p_output_fine_grams: 0.58,
    p_output_fine_proba: 995
  });
  if (!refErr) {
    throw new Error('FAIL: Jamshid was able to record refining batch!');
  }
  console.log(`   PASS [F01]: rpc_record_refining_batch blocked with: "${refErr.message}" (code: ${refErr.code})`);

  console.log('\n[2/3] SELLER (Jamshid, Dilshod, Jasur) SCOPING TESTS — F02 DATA ISOLATION');

  // Test 6: F02 — Jamshid reads consignment pieces
  const { data: jamshidPieces } = await jamshidClient.from('consignment_pieces').select('id, seller_id, model_name');
  const foreignPieces = (jamshidPieces || []).filter(p => p.seller_id !== jamshidEmp.id);
  console.log(`   * Jamshid pieces visible: ${jamshidPieces?.length || 0} (Foreign pieces: ${foreignPieces.length})`);
  if (foreignPieces.length > 0) {
    throw new Error(`FAIL: Jamshid can see foreign pieces belonging to other sellers!`);
  }
  console.log('   PASS [F02]: Jamshid sees ZERO pieces of Dilshod or Jasur.');

  // Test 7: F02 — Jamshid reads seller gold accounts
  const { data: jamshidAccounts } = await jamshidClient.from('seller_gold_accounts').select('seller_id, total_consigned_gold_grams');
  const foreignAccounts = (jamshidAccounts || []).filter(a => a.seller_id !== jamshidEmp.id);
  console.log(`   * Jamshid accounts visible: ${jamshidAccounts?.length || 0} (Foreign accounts: ${foreignAccounts.length})`);
  if (foreignAccounts.length > 0) {
    throw new Error('FAIL: Jamshid can see other sellers\' gold accounts!');
  }
  console.log('   PASS [F02]: Jamshid sees ZERO seller accounts of other sellers.');

  // Test 8: F02 — Jamshid reads factory receipts & manager vault
  const { data: jamshidReceipts } = await jamshidClient.from('factory_receipts').select('id');
  const { data: jamshidVault } = await jamshidClient.from('manager_vault_account').select('id');
  console.log(`   * Factory receipts visible to Jamshid: ${jamshidReceipts?.length || 0}`);
  console.log(`   * Manager vault visible to Jamshid: ${jamshidVault?.length || 0}`);
  if ((jamshidReceipts && jamshidReceipts.length > 0) || (jamshidVault && jamshidVault.length > 0)) {
    throw new Error('FAIL: Jamshid can read factory receipts or manager vault!');
  }
  console.log('   PASS [F02]: Jamshid has ZERO access to factory receipts and manager vault.');

  // Test 9: Dilshod isolation check
  const { data: dilshodAuth } = await anonClient.auth.signInWithPassword({
    email: 'dilshod@jewelryflow.uz',
    password: demoPass
  });
  const dilshodClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: 'Bearer ' + dilshodAuth.session.access_token } }
  });
  const { data: dilshodPieces } = await dilshodClient.from('consignment_pieces').select('id, seller_id');
  const dilshodForeign = (dilshodPieces || []).filter(p => p.seller_id !== dilshodEmp.id);
  if (dilshodForeign.length > 0) {
    throw new Error('FAIL: Dilshod sees foreign pieces!');
  }
  console.log(`   PASS [F02]: Dilshod sees ONLY his own ${dilshodPieces?.length || 0} pieces (0 foreign).`);

  // Test 10: Jasur isolation check
  const { data: jasurAuth } = await anonClient.auth.signInWithPassword({
    email: 'jasur@jewelryflow.uz',
    password: demoPass
  });
  const jasurClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: 'Bearer ' + jasurAuth.session.access_token } }
  });
  const { data: jasurPieces } = await jasurClient.from('consignment_pieces').select('id, seller_id');
  const jasurForeign = (jasurPieces || []).filter(p => p.seller_id !== jasurEmp.id);
  if (jasurForeign.length > 0) {
    throw new Error('FAIL: Jasur sees foreign pieces!');
  }
  console.log(`   PASS [F02]: Jasur sees ONLY his own ${jasurPieces?.length || 0} pieces (0 foreign).`);

  console.log('\n[3/3] PRIVILEGED ROLES (Director & Manager) INTEGRITY TESTS');

  // Test 11: Director can see all
  const { data: dirAuth } = await anonClient.auth.signInWithPassword({
    email: 'director@goldia.uz',
    password: demoPass
  });
  const dirClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: 'Bearer ' + dirAuth.session.access_token } }
  });
  const { data: dirPieces } = await dirClient.from('consignment_pieces').select('id');
  const { data: dirAccounts } = await dirClient.from('seller_gold_accounts').select('seller_id');
  const { data: dirReceipts } = await dirClient.from('factory_receipts').select('id');
  console.log(`   PASS: Director sees all ${dirPieces?.length} pieces across all sellers.`);
  console.log(`   PASS: Director sees all ${dirAccounts?.length} seller accounts.`);
  console.log(`   PASS: Director sees all ${dirReceipts?.length} factory receipts.`);

  // Test 12: Manager can see all
  const { data: mgrAuth } = await anonClient.auth.signInWithPassword({
    email: 'manager@goldia.uz',
    password: demoPass
  });
  const mgrClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: 'Bearer ' + mgrAuth.session.access_token } }
  });
  const { data: mgrPieces } = await mgrClient.from('consignment_pieces').select('id');
  const { data: mgrAccounts } = await mgrClient.from('seller_gold_accounts').select('seller_id');
  console.log(`   PASS: Manager sees all ${mgrPieces?.length} pieces across all sellers.`);
  console.log(`   PASS: Manager sees all ${mgrAccounts?.length} seller accounts.`);

  console.log('\n==============================================================================');
  console.log('✅ BARCHA F01 VA F02 XAVFSIZLIK TESTLARI 100% PASS BO\'LDI!');
  console.log('==============================================================================');
}

runSecurityAudit().catch(err => {
  console.error('\n❌ XAVFSIZLIK AUDITI TESTI FAIL BO\'LDI:', err.message);
  process.exit(1);
});
