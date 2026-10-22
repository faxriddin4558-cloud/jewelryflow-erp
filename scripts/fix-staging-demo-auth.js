const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  console.log('==============================================================================');
  console.log('JEWELRYFLOW SALES — STAGING DEMO AUTH HOTFIX & SYNCHRONIZATION');
  console.log('Target Ref: vouehtlmsunebracahon (jewelryflow-sales-staging)');
  console.log('==============================================================================');

  // 1. Fetch API keys from linked Supabase project via CLI
  console.log('\n[1/5] Supabase Staging API kalitlarini CLI orqali olish...');
  let anonKey = '';
  let serviceRoleKey = '';

  try {
    const rawKeys = execSync('npx supabase projects api-keys --project-ref vouehtlmsunebracahon --output json', {
      encoding: 'utf8'
    });
    const jsonStart = rawKeys.indexOf('[');
    const jsonEnd = rawKeys.lastIndexOf(']') + 1;
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('API keys JSON output topilmadi');
    }
    const keys = JSON.parse(rawKeys.slice(jsonStart, jsonEnd));
    for (const k of keys) {
      if (k.name === 'anon') anonKey = k.api_key;
      if (k.name === 'service_role') serviceRoleKey = k.api_key;
    }
  } catch (err) {
    console.error('Xatolik: CLI orqali API kalitlarini olib bolmadi:', err.message);
    process.exit(1);
  }

  if (!anonKey || !serviceRoleKey) {
    console.error('Xatolik: anon yoki service_role kaliti topilmadi!');
    process.exit(1);
  }
  console.log('   OK: Staging anon va service_role kalitlari olindi.');

  const supabaseUrl = 'https://vouehtlmsunebracahon.supabase.co';
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const DEMO_ORG_ID = '00000000-0000-4001-8001-000000000001';
  // Password matches the UI 1-click button expectation
  const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || 'GoldiaPassword2026!';

  // 2. Define the exact demo accounts required by 1-click buttons and roles
  const demoUsers = [
    // 1-Click Button 1: 👑 Alisher (Direktor)
    {
      id: '11111111-1111-4001-8001-000000000011',
      employee_code: 'EMP-PLT-DIR-11',
      email: 'director@goldia.uz',
      name: 'Alisher Director',
      full_name: 'Alisher Director',
      role: 'admin',
      role_type: 'director',
      department: 'Rahbariyat'
    },
    // 1-Click Button 2: 💼 Rustam (Boshqaruvchi)
    {
      id: '11111111-1111-4001-8001-000000000012',
      employee_code: 'EMP-PLT-MGR-12',
      email: 'manager@goldia.uz',
      name: 'Rustam Manager',
      full_name: 'Rustam Manager',
      role: 'production_manager',
      role_type: 'manager',
      department: 'Boshqaruv'
    },
    // 1-Click Button 3: 🛍️ Jamshid (Sotuvchi - Toshkent)
    {
      id: '11111111-1111-4001-8001-000000000017',
      employee_code: 'EMP-PLT-SLR-17',
      email: 'seller@goldia.uz',
      name: 'Jamshid Sotuvchi',
      full_name: 'Jamshid Sotuvchi',
      role: 'sales',
      role_type: 'seller',
      department: 'Savdo'
    },
    // 1-Click Button 4: 🛍️ Dilshod (Sotuvchi - Navoiy)
    {
      id: '11111111-1111-4001-8001-000000000018',
      employee_code: 'EMP-PLT-SLR-18',
      email: 'dilshod@jewelryflow.uz',
      name: 'Dilshod Sotuvchi',
      full_name: 'Dilshod Sotuvchi',
      role: 'sales',
      role_type: 'seller',
      department: 'Savdo'
    },
    // 1-Click Button 5: 🛍️ Jasur (Sotuvchi - Buxoro)
    {
      id: '11111111-1111-4001-8001-000000000019',
      employee_code: 'EMP-PLT-SLR-19',
      email: 'jasur@jewelryflow.uz',
      name: 'Jasur Sotuvchi',
      full_name: 'Jasur Sotuvchi',
      role: 'sales',
      role_type: 'seller',
      department: 'Savdo'
    },
    // Aliases & Demo variants
    {
      id: '11111111-1111-4001-8001-000000000001',
      employee_code: 'EMP-DEMO-DIR-01',
      email: 'demo.director@goldia.uz',
      name: 'Alisher Direktor (Demo)',
      full_name: 'Alisher Direktor (Demo)',
      role: 'admin',
      role_type: 'director',
      department: 'Rahbariyat'
    },
    {
      id: '11111111-1111-4001-8001-000000000002',
      employee_code: 'EMP-DEMO-MGR-02',
      email: 'demo.manager@goldia.uz',
      name: 'Bobur Boshqaruvchi (Demo)',
      full_name: 'Bobur Boshqaruvchi (Demo)',
      role: 'production_manager',
      role_type: 'manager',
      department: 'Boshqaruv'
    },
    {
      id: '11111111-1111-4001-8001-000000000007',
      employee_code: 'EMP-DEMO-SLR-07',
      email: 'demo.seller@goldia.uz',
      name: 'Jamshid Sotuvchi (Demo)',
      full_name: 'Jamshid Sotuvchi (Demo)',
      role: 'sales',
      role_type: 'seller',
      department: 'Savdo'
    },
    {
      id: '11111111-1111-4001-8001-000000000020',
      employee_code: 'EMP-PLT-ADM-20',
      email: 'admin@goldia.uz',
      name: 'Alisher Admin',
      full_name: 'Alisher Admin',
      role: 'admin',
      role_type: 'director',
      department: 'Rahbariyat'
    }
  ];

  // 3. Upsert into public.employees
  console.log('\n[2/5] public.employees jadvaliga xodimlarni yozish/yangilash...');
  for (const u of demoUsers) {
    const payload = {
      id: u.id,
      employee_code: u.employee_code,
      email: u.email,
      name: u.name,
      full_name: u.full_name,
      role: u.role,
      role_type: u.role_type,
      department: u.department,
      organization_id: DEMO_ORG_ID,
      status: 'active',
      employment_status: 'active',
      is_active: true
    };
    const { error: empErr } = await adminClient.from('employees').upsert(payload, { onConflict: 'id' });
    if (empErr) {
      console.error(`   FAIL: Employee upsert xatoligi (${u.email}):`, empErr.message);
      process.exit(1);
    }
  }
  console.log('   OK: Barcha 9 ta employee yozuvlari muvaffaqiyatli saqlandi.');

  // 4. Provision Supabase Auth Users via Admin API
  console.log('\n[3/5] Supabase GoTrue Auth da foydalanuvchilar va parollarni yangilash...');
  const { data: userListData, error: listErr } = await adminClient.auth.admin.listUsers({ perPage: 100 });
  if (listErr) {
    console.error('Auth admin listUsers xatoligi:', listErr.message);
    process.exit(1);
  }
  const existingUsers = userListData.users || [];

  for (const u of demoUsers) {
    const existing = existingUsers.find(ex => ex.email.toLowerCase() === u.email.toLowerCase());
    let finalUserId = u.id;

    if (existing) {
      finalUserId = existing.id;
      const { error: updErr } = await adminClient.auth.admin.updateUserById(existing.id, {
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: {
          role: u.role,
          role_type: u.role_type,
          full_name: u.full_name,
          organization_id: DEMO_ORG_ID,
          is_demo: true
        }
      });
      if (updErr) {
        console.error(`   FAIL: Auth updateUserById xatoligi (${u.email}):`, updErr.message);
        process.exit(1);
      }
      console.log(`   OK: ${u.email} paroli va metadatalari yangilandi (ID: ${finalUserId.slice(0, 8)}...).`);
    } else {
      const { data: newU, error: createErr } = await adminClient.auth.admin.createUser({
        id: u.id,
        email: u.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: {
          role: u.role,
          role_type: u.role_type,
          full_name: u.full_name,
          organization_id: DEMO_ORG_ID,
          is_demo: true
        }
      });
      if (createErr) {
        console.error(`   FAIL: Auth createUser xatoligi (${u.email}):`, createErr.message);
        process.exit(1);
      }
      finalUserId = newU.user.id;
      console.log(`   OK: ${u.email} yangi yaratildi va paroli o'rnatildi (ID: ${finalUserId.slice(0, 8)}...).`);
    }

    // Link user_id in employees
    await adminClient.from('employees').update({ user_id: finalUserId }).ilike('email', u.email);
  }

  // 5. Ensure seller consignments & accounts exist for Jamshid, Dilshod, and Jasur
  console.log('\n[4/5] Sotuvchilar konsignatsiyalari va hisoblarini moslashtirish...');
  const sellerConfigs = [
    {
      seller_id: '11111111-1111-4001-8001-000000000017', // Jamshid
      consign_id: '99999999-9999-4001-8001-000000000017',
      consign_no: 'CS-PLT-TOSHKENT-01',
      title: 'Toshkent Savdo To\'plami (Jamshid)',
      weight: 35.5,
      due: 38.34,
      pieces: [
        { id: '88888888-8888-4001-8001-000000000011', barcode: '564000011', name: 'Italiya Uzuk 585 - Toshkent', weight: 4.8 },
        { id: '88888888-8888-4001-8001-000000000012', barcode: '564000012', name: 'Bismark Zanjir 585 - Toshkent', weight: 14.5 }
      ]
    },
    {
      seller_id: '11111111-1111-4001-8001-000000000018', // Dilshod
      consign_id: '99999999-9999-4001-8001-000000000018',
      consign_no: 'CS-PLT-NAVOIY-02',
      title: 'Navoiy Filiali To\'plami (Dilshod)',
      weight: 28.0,
      due: 30.24,
      pieces: [
        { id: '88888888-8888-4001-8001-000000000013', barcode: '564000013', name: 'Klassik Bilaguzuk 585 - Navoiy', weight: 18.0 },
        { id: '88888888-8888-4001-8001-000000000014', barcode: '564000014', name: 'Sharq Sirg\'asi 585 - Navoiy', weight: 10.0 }
      ]
    },
    {
      seller_id: '11111111-1111-4001-8001-000000000019', // Jasur
      consign_id: '99999999-9999-4001-8001-000000000019',
      consign_no: 'CS-PLT-BUXORO-03',
      title: 'Buxoro Rastasi To\'plami (Jasur)',
      weight: 22.4,
      due: 24.19,
      pieces: [
        { id: '88888888-8888-4001-8001-000000000015', barcode: '564000015', name: 'Bismark Zanjir 585 - Buxoro', weight: 12.4 },
        { id: '88888888-8888-4001-8001-000000000016', barcode: '564000016', name: 'Italiya Uzuk 585 - Buxoro', weight: 10.0 }
      ]
    }
  ];

  for (const sc of sellerConfigs) {
    // Upsert consignment
    await adminClient.from('seller_consignments').upsert({
      id: sc.consign_id,
      organization_id: DEMO_ORG_ID,
      consignment_no: sc.consign_no,
      seller_id: sc.seller_id,
      product_name: sc.title,
      quantity: sc.pieces.length,
      base_weight_grams: sc.weight,
      proba: 585,
      factory_markup_pct: 8.00,
      factory_gold_due_grams: sc.due,
      factory_remaining_gold_grams: sc.due,
      status: 'held_by_seller',
      notes: 'Staging demo konsignatsiya'
    }, { onConflict: 'organization_id,consignment_no' });

    // Upsert pieces
    for (const p of sc.pieces) {
      await adminClient.from('consignment_pieces').upsert({
        id: p.id,
        organization_id: DEMO_ORG_ID,
        consignment_id: sc.consign_id,
        model_code: 'MOD-UZK-01',
        model_name: p.name,
        category: 'Zargarlik',
        weight_grams: p.weight,
        purity: 585,
        proba: 585,
        status: 'held_by_seller',
        seller_id: sc.seller_id,
        raw_barcode: p.barcode,
        notes: 'Staging demo dona'
      }, { onConflict: 'id' });
    }

    // Upsert seller gold accounts
    await adminClient.from('seller_gold_accounts').upsert({
      seller_id: sc.seller_id,
      organization_id: DEMO_ORG_ID,
      total_consigned_gold_grams: sc.due,
      total_factory_settled_gold_grams: 0,
      current_factory_obligation_grams: sc.due,
      seller_till_scrap_grams: 0,
      seller_till_cash_amount: 0,
      total_client_debt_grams: 0,
      total_transferred_physical_g: sc.weight,
      total_seller_obligation_g: sc.due,
      total_settled_to_manager_g: 0,
      seller_owes_manager_g: sc.due,
      manager_owes_seller_g: 0,
      bozor_qarzi_signed_g: -sc.due
    }, { onConflict: 'seller_id' });
  }
  console.log('   OK: Toshkent, Navoiy va Buxoro sotuvchilari uchun konsignatsiyalar saqlandi.');

  // 6. Verify real authentication via Cloud Supabase Auth (using anon client)
  console.log('\n[5/5] Haqiqiy Cloud Supabase Auth orqali Login va RLS tekshiruvi...');
  const anonClient = createClient(supabaseUrl, anonKey);

  const verificationTargets = [
    { roleTitle: 'Direktor (Alisher)', email: 'director@goldia.uz', expectedRole: 'Director' },
    { roleTitle: 'Boshqaruvchi (Rustam)', email: 'manager@goldia.uz', expectedRole: 'Production Manager' },
    { roleTitle: 'Sotuvchi Toshkent (Jamshid)', email: 'seller@goldia.uz', expectedRole: 'Seller' },
    { roleTitle: 'Sotuvchi Navoiy (Dilshod)', email: 'dilshod@jewelryflow.uz', expectedRole: 'Seller' },
    { roleTitle: 'Sotuvchi Buxoro (Jasur)', email: 'jasur@jewelryflow.uz', expectedRole: 'Seller' }
  ];

  for (const vt of verificationTargets) {
    const { data: authData, error: authErr } = await anonClient.auth.signInWithPassword({
      email: vt.email,
      password: DEMO_PASSWORD
    });

    if (authErr || !authData?.user) {
      console.error(`   FAIL: ${vt.roleTitle} (${vt.email}) login qila olmadi:`, authErr?.message);
      process.exit(1);
    }

    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } }
    });

    const { data: empData, error: empErr } = await authedClient
      .from('employees')
      .select('*')
      .ilike('email', vt.email)
      .limit(1);

    if (empErr || !empData || empData.length === 0) {
      console.error(`   FAIL: ${vt.roleTitle} employee profili RLS orqali topilmadi:`, empErr?.message);
      process.exit(1);
    }

    const emp = empData[0];
    console.log(`   PASS: [${vt.roleTitle}] ${vt.email} -> Muvaffaqiyatli kirdi! Ism: "${emp.name || emp.full_name}", Rol: "${emp.role_type}"`);

    await anonClient.auth.signOut();
  }

  console.log('\n==============================================================================');
  console.log('STAGING DEMO AUTH HOTFIX MUVAFFAQIYATLI YAKUNLANDI!');
  console.log('Barcha 5 ta 1-click foydalanuvchilari Cloud Supabase Auth bilan sinxronlandi.');
  console.log('==============================================================================');
}

main().catch(err => {
  console.error('Kutilmagan xatolik:', err);
  process.exit(1);
});
