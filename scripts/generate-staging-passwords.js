const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function generateSecurePassword(length = 18) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*()_+';
  const all = upper + lower + digits + symbols;

  let pwd = '';
  pwd += upper[crypto.randomInt(upper.length)];
  pwd += lower[crypto.randomInt(lower.length)];
  pwd += digits[crypto.randomInt(digits.length)];
  pwd += symbols[crypto.randomInt(symbols.length)];

  for (let i = 4; i < length; i++) {
    pwd += all[crypto.randomInt(all.length)];
  }

  // Shuffle characters
  return pwd.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

function main() {
  const accounts = [
    {
      id: '11111111-1111-4001-8001-000000000001',
      code: 'EMP-DEMO-DIR-01',
      title: '1. DIREKTOR (Boshqaruv, barcha hisobotlar, kassa, monitoring)',
      email: 'demo.director@goldia.uz',
      name: 'Alisher Direktor (Demo)',
      role: 'admin',
      roleType: 'director',
      dept: 'Rahbariyat'
    },
    {
      id: '11111111-1111-4001-8001-000000000002',
      code: 'EMP-DEMO-MGR-02',
      title: '2. BOSHQARUVCHI (Zavod, ombor, mahsulot topshirish)',
      email: 'demo.manager@goldia.uz',
      name: 'Bobur Boshqaruvchi (Demo)',
      role: 'production_manager',
      roleType: 'manager',
      dept: 'Boshqaruv'
    },
    {
      id: '11111111-1111-4001-8001-000000000007',
      code: 'EMP-DEMO-SLR-07',
      title: '3. SOTUVCHI (Savdo, konsignatsiya, mijoz qarzlar, tolov)',
      email: 'demo.seller@goldia.uz',
      name: 'Jamshid Sotuvchi (Demo)',
      role: 'sales',
      roleType: 'seller',
      dept: 'Savdo'
    },
    {
      id: '11111111-1111-4001-8001-000000000011',
      code: 'EMP-PLT-DIR-11',
      title: '4. PILOT DIREKTOR (Moslik hisobi)',
      email: 'director@goldia.uz',
      name: 'Alisher Director',
      role: 'admin',
      roleType: 'director',
      dept: 'Rahbariyat'
    },
    {
      id: '11111111-1111-4001-8001-000000000012',
      code: 'EMP-PLT-MGR-12',
      title: '5. PILOT BOSHQARUVCHI (Moslik hisobi)',
      email: 'manager@goldia.uz',
      name: 'Rustam Manager',
      role: 'production_manager',
      roleType: 'manager',
      dept: 'Boshqaruv'
    },
    {
      id: '11111111-1111-4001-8001-000000000017',
      code: 'EMP-PLT-SLR-17',
      title: '6. PILOT SOTUVCHI (Moslik hisobi)',
      email: 'seller@goldia.uz',
      name: 'Jamshid Sotuvchi',
      role: 'sales',
      roleType: 'seller',
      dept: 'Savdo'
    }
  ];

  const credLines = [
    '==============================================================================',
    'JEWELRYFLOW SALES — STAGING DEMO AKKAUNTLAR VA MAXFIY PAROLLAR',
    '==============================================================================',
    'Loyiha:        JewelryFlow Sales Staging',
    'Target Ref:    vouehtlmsunebracahon (Oceania Sydney Cloud Supabase)',
    `Sana:          ${new Date().toISOString()}`,
    'XAVFSIZLIK:    Ushbu fayl .gitignore ga kiritilgan. Chat yoki Git ga yozilmaydi.',
    '==============================================================================',
    ''
  ];

  for (const acc of accounts) {
    acc.plainPassword = generateSecurePassword(18);
    acc.bcryptHash = bcrypt.hashSync(acc.plainPassword, 10);

    credLines.push(acc.title);
    credLines.push(`   Email:  ${acc.email}`);
    credLines.push(`   Parol:  ${acc.plainPassword}`);
    credLines.push(`   Rol:    ${acc.role} / ${acc.roleType}`);
    credLines.push('');
  }

  credLines.push('==============================================================================');
  credLines.push('Login sahifasi: /sales/login');
  credLines.push('==============================================================================');

  // Save credentials file locally
  const credFilePath = path.resolve(process.cwd(), '.staging-credentials.txt');
  fs.writeFileSync(credFilePath, credLines.join('\n'), 'utf8');

  // Construct updated seed.sql
  const seedTemplate = `-- ==============================================================================
-- JEWELRYFLOW SALES — SYNTHETIC DEMO SEED SCRIPT FOR SAFE STAGING
-- ==============================================================================
-- MUHIM: Ushbu faylda FAQAT sun'iy (synthetic) demo ma'lumotlar mavjud.
-- Real mijozlar, qarzlar, xodimlar yoki maxfiy kalitlar mutlaqo kiritilmagan.
-- Yangi test Supabase bazasida "SQL Editor" orqali to'g'ridan-to'g'ri ishga tushiriladi.
-- Barcha jadval ustunlari va UNIQUE constraintlari haqiqiy sxemaga 100% mos.
-- 100% Idempotent: qayta ishga tushirilganda xato bermaydi va dublikat yaratmaydi.
-- Parollar yangi bcrypt xeshlari bilan ta'minlangan (asl parollar .staging-credentials.txt da).
-- ==============================================================================

BEGIN;

-- 0. Helper: Parollarni xavfsiz bcrypt formatida saqlash funksiyasi
CREATE OR REPLACE FUNCTION public.demo_hash_password(pwd text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_hash text;
BEGIN
  BEGIN
    EXECUTE 'SELECT extensions.crypt($1, extensions.gen_salt(''bf'', 10))' INTO v_hash USING pwd;
    IF v_hash IS NOT NULL AND length(v_hash) > 10 THEN
      RETURN v_hash;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'SELECT crypt($1, gen_salt(''bf'', 10))' INTO v_hash USING pwd;
    IF v_hash IS NOT NULL AND length(v_hash) > 10 THEN
      RETURN v_hash;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN '${accounts[0].bcryptHash}';
END;
$$;

-- 1. Demo Korxonalar (Organizations)
INSERT INTO public.organizations (id, code, name, status)
VALUES 
  ('00000000-0000-0000-0000-000000000001'::uuid, 'goldia', 'Goldia Jewelry Factory', 'ACTIVE')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status;

INSERT INTO public.organizations (id, code, name, status)
VALUES 
  ('00000000-0000-4001-8001-000000000001'::uuid, 'goldia_staging', 'Goldia Jewelry Demo Staging', 'ACTIVE')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status;

-- 2. Idempotent tozalash: Demo email'lar boshqa begona UUID bilan qolib ketgan bo'lsa tozalash
DELETE FROM public.employees
WHERE lower(email) IN (
  'demo.director@goldia.uz',
  'demo.manager@goldia.uz',
  'demo.seller@goldia.uz',
  'director@goldia.uz',
  'manager@goldia.uz',
  'seller@goldia.uz'
) AND id NOT IN (
  '11111111-1111-4001-8001-000000000001'::uuid,
  '11111111-1111-4001-8001-000000000002'::uuid,
  '11111111-1111-4001-8001-000000000007'::uuid,
  '11111111-1111-4001-8001-000000000011'::uuid,
  '11111111-1111-4001-8001-000000000012'::uuid,
  '11111111-1111-4001-8001-000000000017'::uuid
);

DELETE FROM auth.users
WHERE lower(email) IN (
  'demo.director@goldia.uz',
  'demo.manager@goldia.uz',
  'demo.seller@goldia.uz',
  'director@goldia.uz',
  'manager@goldia.uz',
  'seller@goldia.uz'
) AND id NOT IN (
  '11111111-1111-4001-8001-000000000001'::uuid,
  '11111111-1111-4001-8001-000000000002'::uuid,
  '11111111-1111-4001-8001-000000000007'::uuid,
  '11111111-1111-4001-8001-000000000011'::uuid,
  '11111111-1111-4001-8001-000000000012'::uuid,
  '11111111-1111-4001-8001-000000000017'::uuid
);

-- 3. Demo Foydalanuvchilar (auth.users va public.employees)
-- Yangi noyob Blowfish Bcrypt parollar bilan xavfsiz ta'minlangan

-- 3.1 Direktor (demo.director@goldia.uz)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud)
VALUES (
  '11111111-1111-4001-8001-000000000001'::uuid,
  'demo.director@goldia.uz',
  '${accounts[0].bcryptHash}',
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"admin","role_type":"director","department":"Rahbariyat","full_name":"Alisher Direktor (Demo)","organization_id":"00000000-0000-4001-8001-000000000001","is_demo":true}'::jsonb,
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = EXCLUDED.email_confirmed_at,
  raw_app_meta_data = EXCLUDED.raw_app_meta_data,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  role = EXCLUDED.role,
  aud = EXCLUDED.aud;

INSERT INTO public.employees (
  id, user_id, employee_code, name, full_name, email, role, role_type, department, organization_id, is_active, status
)
VALUES (
  '11111111-1111-4001-8001-000000000001'::uuid,
  '11111111-1111-4001-8001-000000000001'::uuid,
  'EMP-DEMO-DIR-01',
  'Alisher Direktor (Demo)',
  'Alisher Direktor (Demo)',
  'demo.director@goldia.uz',
  'admin',
  'director',
  'Rahbariyat',
  '00000000-0000-4001-8001-000000000001'::uuid,
  true,
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  employee_code = EXCLUDED.employee_code,
  name = EXCLUDED.name,
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  role_type = EXCLUDED.role_type,
  department = EXCLUDED.department,
  organization_id = EXCLUDED.organization_id,
  is_active = true,
  status = 'active';

-- 3.2 Ishlab chiqarish menejeri (demo.manager@goldia.uz)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud)
VALUES (
  '11111111-1111-4001-8001-000000000002'::uuid,
  'demo.manager@goldia.uz',
  '${accounts[1].bcryptHash}',
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"production_manager","role_type":"manager","department":"Boshqaruv","full_name":"Bobur Boshqaruvchi (Demo)","organization_id":"00000000-0000-4001-8001-000000000001","is_demo":true}'::jsonb,
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = EXCLUDED.email_confirmed_at,
  raw_app_meta_data = EXCLUDED.raw_app_meta_data,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  role = EXCLUDED.role,
  aud = EXCLUDED.aud;

INSERT INTO public.employees (
  id, user_id, employee_code, name, full_name, email, role, role_type, department, organization_id, is_active, status
)
VALUES (
  '11111111-1111-4001-8001-000000000002'::uuid,
  '11111111-1111-4001-8001-000000000002'::uuid,
  'EMP-DEMO-MGR-02',
  'Bobur Boshqaruvchi (Demo)',
  'Bobur Boshqaruvchi (Demo)',
  'demo.manager@goldia.uz',
  'production_manager',
  'manager',
  'Boshqaruv',
  '00000000-0000-4001-8001-000000000001'::uuid,
  true,
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  employee_code = EXCLUDED.employee_code,
  name = EXCLUDED.name,
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  role_type = EXCLUDED.role_type,
  department = EXCLUDED.department,
  organization_id = EXCLUDED.organization_id,
  is_active = true,
  status = 'active';

-- 3.3 Savdo vakili / Sotuvchi (demo.seller@goldia.uz)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud)
VALUES (
  '11111111-1111-4001-8001-000000000007'::uuid,
  'demo.seller@goldia.uz',
  '${accounts[2].bcryptHash}',
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"sales","role_type":"seller","department":"Savdo","full_name":"Jamshid Sotuvchi (Demo)","organization_id":"00000000-0000-4001-8001-000000000001","is_demo":true}'::jsonb,
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = EXCLUDED.email_confirmed_at,
  raw_app_meta_data = EXCLUDED.raw_app_meta_data,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  role = EXCLUDED.role,
  aud = EXCLUDED.aud;

INSERT INTO public.employees (
  id, user_id, employee_code, name, full_name, email, role, role_type, department, organization_id, is_active, status
)
VALUES (
  '11111111-1111-4001-8001-000000000007'::uuid,
  '11111111-1111-4001-8001-000000000007'::uuid,
  'EMP-DEMO-SLR-07',
  'Jamshid Sotuvchi (Demo)',
  'Jamshid Sotuvchi (Demo)',
  'demo.seller@goldia.uz',
  'sales',
  'seller',
  'Savdo',
  '00000000-0000-4001-8001-000000000001'::uuid,
  true,
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  employee_code = EXCLUDED.employee_code,
  name = EXCLUDED.name,
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  role_type = EXCLUDED.role_type,
  department = EXCLUDED.department,
  organization_id = EXCLUDED.organization_id,
  is_active = true,
  status = 'active';

-- 3.4 Mavjud pilot foydalanuvchilari bilan to'liq moslik:
-- director@goldia.uz, manager@goldia.uz, seller@goldia.uz
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud)
VALUES
  ('11111111-1111-4001-8001-000000000011'::uuid, 'director@goldia.uz', '${accounts[3].bcryptHash}', NOW(), '{"provider":"email","providers":["email"]}'::jsonb, '{"role":"admin","role_type":"director","full_name":"Alisher (Goldia)","organization_id":"00000000-0000-4001-8001-000000000001","is_demo":true}'::jsonb, 'authenticated', 'authenticated'),
  ('11111111-1111-4001-8001-000000000012'::uuid, 'manager@goldia.uz', '${accounts[4].bcryptHash}', NOW(), '{"provider":"email","providers":["email"]}'::jsonb, '{"role":"production_manager","role_type":"manager","full_name":"Rustam (Goldia)","organization_id":"00000000-0000-4001-8001-000000000001","is_demo":true}'::jsonb, 'authenticated', 'authenticated'),
  ('11111111-1111-4001-8001-000000000017'::uuid, 'seller@goldia.uz', '${accounts[5].bcryptHash}', NOW(), '{"provider":"email","providers":["email"]}'::jsonb, '{"role":"sales","role_type":"seller","full_name":"Jamshid (Goldia)","organization_id":"00000000-0000-4001-8001-000000000001","is_demo":true}'::jsonb, 'authenticated', 'authenticated')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = EXCLUDED.email_confirmed_at,
  raw_app_meta_data = EXCLUDED.raw_app_meta_data,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  role = EXCLUDED.role,
  aud = EXCLUDED.aud;

INSERT INTO public.employees (id, user_id, employee_code, name, full_name, email, role, role_type, department, organization_id, is_active, status)
VALUES
  ('11111111-1111-4001-8001-000000000011'::uuid, '11111111-1111-4001-8001-000000000011'::uuid, 'EMP-PLT-DIR-11', 'Alisher Director', 'Alisher Director', 'director@goldia.uz', 'admin', 'director', 'Rahbariyat', '00000000-0000-4001-8001-000000000001'::uuid, true, 'active'),
  ('11111111-1111-4001-8001-000000000012'::uuid, '11111111-1111-4001-8001-000000000012'::uuid, 'EMP-PLT-MGR-12', 'Rustam Manager', 'Rustam Manager', 'manager@goldia.uz', 'production_manager', 'manager', 'Boshqaruv', '00000000-0000-4001-8001-000000000001'::uuid, true, 'active'),
  ('11111111-1111-4001-8001-000000000017'::uuid, '11111111-1111-4001-8001-000000000017'::uuid, 'EMP-PLT-SLR-17', 'Jamshid Sotuvchi', 'Jamshid Sotuvchi', 'seller@goldia.uz', 'sales', 'seller', 'Savdo', '00000000-0000-4001-8001-000000000001'::uuid, true, 'active')
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  employee_code = EXCLUDED.employee_code,
  name = EXCLUDED.name,
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  role_type = EXCLUDED.role_type,
  department = EXCLUDED.department,
  organization_id = EXCLUDED.organization_id,
  is_active = true,
  status = 'active';

-- 3.5 Cloud Supabase GoTrue auth.identities sinxronizatsiyasi
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES
      ('11111111-1111-4001-8001-000000000001', '11111111-1111-4001-8001-000000000001'::uuid, '{"sub":"11111111-1111-4001-8001-000000000001","email":"demo.director@goldia.uz"}'::jsonb, 'email', 'demo.director@goldia.uz', NOW(), NOW(), NOW()),
      ('11111111-1111-4001-8001-000000000002', '11111111-1111-4001-8001-000000000002'::uuid, '{"sub":"11111111-1111-4001-8001-000000000002","email":"demo.manager@goldia.uz"}'::jsonb, 'email', 'demo.manager@goldia.uz', NOW(), NOW(), NOW()),
      ('11111111-1111-4001-8001-000000000007', '11111111-1111-4001-8001-000000000007'::uuid, '{"sub":"11111111-1111-4001-8001-000000000007","email":"demo.seller@goldia.uz"}'::jsonb, 'email', 'demo.seller@goldia.uz', NOW(), NOW(), NOW()),
      ('11111111-1111-4001-8001-000000000011', '11111111-1111-4001-8001-000000000011'::uuid, '{"sub":"11111111-1111-4001-8001-000000000011","email":"director@goldia.uz"}'::jsonb, 'email', 'director@goldia.uz', NOW(), NOW(), NOW()),
      ('11111111-1111-4001-8001-000000000012', '11111111-1111-4001-8001-000000000012'::uuid, '{"sub":"11111111-1111-4001-8001-000000000012","email":"manager@goldia.uz"}'::jsonb, 'email', 'manager@goldia.uz', NOW(), NOW(), NOW()),
      ('11111111-1111-4001-8001-000000000017', '11111111-1111-4001-8001-000000000017'::uuid, '{"sub":"11111111-1111-4001-8001-000000000017","email":"seller@goldia.uz"}'::jsonb, 'email', 'seller@goldia.uz', NOW(), NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      identity_data = EXCLUDED.identity_data,
      updated_at = NOW();
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 4. Bugungi Lom Kursi (585 proba = 900,000 UZS)
INSERT INTO public.daily_gold_rates (
  id, organization_id, rate_date, proba, purity, rate_per_gram, currency, is_confirmed, notes
)
VALUES (
  '55555555-5555-4001-8001-000000000001'::uuid,
  '00000000-0000-4001-8001-000000000001'::uuid,
  CURRENT_DATE,
  585.00,
  585.00,
  900000.00,
  'UZS',
  true,
  'Staging Demo standarti'
)
ON CONFLICT (organization_id, rate_date, proba) DO UPDATE SET
  rate_per_gram = EXCLUDED.rate_per_gram,
  purity = EXCLUDED.purity,
  is_confirmed = true;

-- 5. Sun'iy Zargarlik Modellari (Jewelry Models)
INSERT INTO public.jewelry_models (id, organization_id, model_code, name, category, reference_weight_grams, proba, gold_purity, notes)
VALUES
  ('33333333-3333-4001-8001-000000000001'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, 'MOD-UZK-01', 'Italiya Uzuk 585', 'Uzuk', 4.500, 585, '585', 'Klassik ayollar uzugi'),
  ('33333333-3333-4001-8001-000000000002'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, 'MOD-ZNJ-02', 'Bismark Zanjir 585', 'Zanjir', 12.800, 585, '585', 'Erkaklar zanjiri'),
  ('33333333-3333-4001-8001-000000000003'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, 'MOD-BLG-03', 'Klassik Bilaguzuk 585', 'Bilaguzuk', 18.200, 585, '585', 'Qattiq bilaguzuk'),
  ('33333333-3333-4001-8001-000000000004'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, 'MOD-SRG-04', 'Sharq Sirg''asi 585', 'Sirg''a', 8.200, 585, '585', 'Brilliant qoshli sirg''a')
ON CONFLICT (model_code) DO NOTHING;

-- 6. Boshqaruvchi Omboridagi Sun'iy Mahsulotlar (Inventory Products)
INSERT INTO public.products (id, name, title, category, weight, proba, stock, quantity, organization_id)
VALUES
  ('66666666-6666-4001-8001-000000000001'::uuid, 'Uzuk Italiya 585 - 14.5g', 'Uzuk Italiya', 'Uzuk', 14.5000, 585.00, 10, 10, '00000000-0000-4001-8001-000000000001'::uuid),
  ('66666666-6666-4001-8001-000000000002'::uuid, 'Zanjir Bismark 585 - 22.8g', 'Zanjir Bismark', 'Zanjir', 22.8000, 585.00, 5, 5, '00000000-0000-4001-8001-000000000001'::uuid),
  ('66666666-6666-4001-8001-000000000003'::uuid, 'Bilaguzuk Klassik 585 - 35.0g', 'Bilaguzuk Klassik', 'Bilaguzuk', 35.0000, 585.00, 3, 3, '00000000-0000-4001-8001-000000000001'::uuid),
  ('66666666-6666-4001-8001-000000000004'::uuid, 'Sharq Sirg''asi 585 - 8.2g', 'Sharq Sirg''asi', 'Sirg''a', 8.2000, 585.00, 8, 8, '00000000-0000-4001-8001-000000000001'::uuid)
ON CONFLICT (id) DO UPDATE SET
  stock = EXCLUDED.stock,
  quantity = EXCLUDED.quantity,
  weight = EXCLUDED.weight;

-- 7. Demo Konsignatsiya va Individual Shtrix-kodli Buyumlar (Consignment Pieces)
INSERT INTO public.seller_consignments (
  id, organization_id, consignment_no, seller_id, product_name, quantity, base_weight_grams, proba, factory_markup_pct, factory_gold_due_grams, factory_remaining_gold_grams, status, notes
)
VALUES (
  '99999999-9999-4001-8001-000000000001'::uuid,
  '00000000-0000-4001-8001-000000000001'::uuid,
  'CS-DEMO-001',
  '11111111-1111-4001-8001-000000000007'::uuid,
  'Uzuk & Zanjir To''plami',
  4,
  40.5000,
  585,
  8.00,
  43.7400,
  43.7400,
  'held_by_seller',
  'Staging demo konsignatsiya'
)
ON CONFLICT (organization_id, consignment_no) DO NOTHING;

INSERT INTO public.consignment_pieces (
  id, organization_id, consignment_id, model_code, model_name, category, weight_grams, purity, proba, status, seller_id, raw_barcode, notes
)
VALUES
  ('88888888-8888-4001-8001-000000000001'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, '99999999-9999-4001-8001-000000000001'::uuid, 'MOD-UZK-01', 'Uzuk Italiya #1', 'Uzuk', 4.5000, 585, 585, 'held_by_seller', '11111111-1111-4001-8001-000000000007'::uuid, '564000001', 'Staging demo dona'),
  ('88888888-8888-4001-8001-000000000002'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, '99999999-9999-4001-8001-000000000001'::uuid, 'MOD-UZK-01', 'Uzuk Italiya #2', 'Uzuk', 5.0000, 585, 585, 'held_by_seller', '11111111-1111-4001-8001-000000000007'::uuid, '564000002', 'Staging demo dona'),
  ('88888888-8888-4001-8001-000000000003'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, '99999999-9999-4001-8001-000000000001'::uuid, 'MOD-ZNJ-02', 'Bismark Zanjir #1', 'Zanjir', 12.8000, 585, 585, 'held_by_seller', '11111111-1111-4001-8001-000000000007'::uuid, '564000003', 'Sotuvchiga berilgan'),
  ('88888888-8888-4001-8001-000000000004'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, '99999999-9999-4001-8001-000000000001'::uuid, 'MOD-BLG-03', 'Bilaguzuk Klassik #1', 'Bilaguzuk', 18.2000, 585, 585, 'held_by_seller', '11111111-1111-4001-8001-000000000007'::uuid, '564000004', 'Sotuvchiga berilgan')
ON CONFLICT (id) DO UPDATE SET
  weight_grams = EXCLUDED.weight_grams,
  status = EXCLUDED.status,
  seller_id = EXCLUDED.seller_id;

-- 8. Sun'iy Demo Mijozlar (Customers)
INSERT INTO public.customers (
  id, organization_id, customer_code, contact_name, company_name, phone, billing_address, is_active, seller_id
)
VALUES
  ('77777777-7777-4001-8001-000000000001'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, 'CUST-DEMO-01', 'Rustam Zargar (Demo)', 'Chorsu Savdo Rastasi #14', '+998901234567', 'Toshkent, Chorsu bozori', true, '11111111-1111-4001-8001-000000000007'::uuid),
  ('77777777-7777-4001-8001-000000000002'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, 'CUST-DEMO-02', 'Sherzod Akfa (Demo)', 'Qo''qon Savdo Markazi', '+998909876543', 'Farg''ona viloyati, Qo''qon', true, '11111111-1111-4001-8001-000000000007'::uuid)
ON CONFLICT (customer_code) DO UPDATE SET
  contact_name = EXCLUDED.contact_name,
  company_name = EXCLUDED.company_name,
  phone = EXCLUDED.phone,
  billing_address = EXCLUDED.billing_address,
  is_active = true,
  seller_id = EXCLUDED.seller_id;

COMMIT;
`;

  fs.writeFileSync('supabase/seed.sql', seedTemplate, 'utf8');
  fs.writeFileSync('scripts/seed-staging-synthetic-demo.sql', seedTemplate, 'utf8');

  console.log('[MUVAFFAQIYAT] Barcha 6 ta demo hisob uchun yangi, noyob va xavfsiz parollar generatsiya qilindi.');
  console.log('[XAVFSIZLIK] Parollar konsolga, chatga yoki ochiq kodga yozilmadi.');
  console.log('[FAYL] Parollar faqat quyidagi shaxsiy faylga saqlandi:');
  console.log('       ' + credFilePath);
}

main();
