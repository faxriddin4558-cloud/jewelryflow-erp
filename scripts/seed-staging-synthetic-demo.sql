-- ==============================================================================
-- JEWELRYFLOW SALES — SYNTHETIC DEMO SEED SCRIPT FOR SAFE STAGING
-- ==============================================================================
-- MUHIM: Ushbu faylda FAQAT sun'iy (synthetic) demo ma'lumotlar mavjud.
-- Real mijozlar, qarzlar, xodimlar yoki maxfiy kalitlar mutlaqo kiritilmagan.
-- Yangi test Supabase bazasida "SQL Editor" orqali to'g'ridan-to'g'ri ishga tushiriladi.
-- ==============================================================================

BEGIN;

-- 1. Demo Korxona (Organization)
INSERT INTO public.organizations (id, code, name, status)
VALUES 
  ('00000000-0000-4001-8001-000000000001'::uuid, 'goldia_staging', 'Goldia Jewelry Demo Staging', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

-- 2. Demo Xodimlar (auth.users va public.employees)
-- Parol: GoldiaDemo2026! (Barcha demo rollar uchun yagona xavfsiz test paroli)

-- 2.1 Direktor (demo.director@goldia.uz)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud)
VALUES (
  '11111111-1111-4001-8001-000000000001'::uuid,
  'demo.director@goldia.uz',
  crypt('GoldiaDemo2026!', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"admin","role_type":"director","department":"Rahbariyat","full_name":"Alisher Direktor (Demo)","organization_id":"00000000-0000-4001-8001-000000000001","is_demo":true}'::jsonb,
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data;

INSERT INTO public.employees (
  id, user_id, name, full_name, email, role, role_type, department, organization_id, is_active, status
)
VALUES (
  '11111111-1111-4001-8001-000000000001'::uuid,
  '11111111-1111-4001-8001-000000000001'::uuid,
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
  name = EXCLUDED.name,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  role_type = EXCLUDED.role_type,
  department = EXCLUDED.department,
  organization_id = EXCLUDED.organization_id;

-- 2.2 Boshqaruvchi / Ishlab Chiqarish Menejeri (demo.manager@goldia.uz)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud)
VALUES (
  '11111111-1111-4001-8001-000000000002'::uuid,
  'demo.manager@goldia.uz',
  crypt('GoldiaDemo2026!', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"production_manager","role_type":"manager","department":"Boshqaruv","full_name":"Bobur Boshqaruvchi (Demo)","organization_id":"00000000-0000-4001-8001-000000000001","is_demo":true}'::jsonb,
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data;

INSERT INTO public.employees (
  id, user_id, name, full_name, email, role, role_type, department, organization_id, is_active, status
)
VALUES (
  '11111111-1111-4001-8001-000000000002'::uuid,
  '11111111-1111-4001-8001-000000000002'::uuid,
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
  name = EXCLUDED.name,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  role_type = EXCLUDED.role_type,
  department = EXCLUDED.department,
  organization_id = EXCLUDED.organization_id;

-- 2.3 Sotuvchi (demo.seller@goldia.uz)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud)
VALUES (
  '11111111-1111-4001-8001-000000000007'::uuid,
  'demo.seller@goldia.uz',
  crypt('GoldiaDemo2026!', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"sales","role_type":"seller","department":"Savdo","full_name":"Jamshid Sotuvchi (Demo)","organization_id":"00000000-0000-4001-8001-000000000001","is_demo":true}'::jsonb,
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data;

INSERT INTO public.employees (
  id, user_id, name, full_name, email, role, role_type, department, organization_id, is_active, status
)
VALUES (
  '11111111-1111-4001-8001-000000000007'::uuid,
  '11111111-1111-4001-8001-000000000007'::uuid,
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
  name = EXCLUDED.name,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  role_type = EXCLUDED.role_type,
  department = EXCLUDED.department,
  organization_id = EXCLUDED.organization_id;

-- Shuningdek mavjud pilot email loginlari bilan moslik:
-- director@goldia.uz, manager@goldia.uz, seller@goldia.uz
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud)
VALUES
  ('11111111-1111-4001-8001-000000000011'::uuid, 'director@goldia.uz', crypt('GoldiaPassword2026!', gen_salt('bf')), NOW(), '{"provider":"email"}'::jsonb, '{"role":"admin","role_type":"director","full_name":"Alisher (Goldia)","is_demo":true}'::jsonb, 'authenticated', 'authenticated'),
  ('11111111-1111-4001-8001-000000000012'::uuid, 'manager@goldia.uz', crypt('GoldiaPassword2026!', gen_salt('bf')), NOW(), '{"provider":"email"}'::jsonb, '{"role":"production_manager","role_type":"manager","full_name":"Rustam (Goldia)","is_demo":true}'::jsonb, 'authenticated', 'authenticated'),
  ('11111111-1111-4001-8001-000000000017'::uuid, 'seller@goldia.uz', crypt('GoldiaPassword2026!', gen_salt('bf')), NOW(), '{"provider":"email"}'::jsonb, '{"role":"sales","role_type":"seller","full_name":"Jamshid (Goldia)","is_demo":true}'::jsonb, 'authenticated', 'authenticated')
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.employees (id, user_id, name, full_name, email, role, role_type, department, organization_id, is_active, status)
VALUES
  ('11111111-1111-4001-8001-000000000011'::uuid, '11111111-1111-4001-8001-000000000011'::uuid, 'Alisher Director', 'Alisher Director', 'director@goldia.uz', 'admin', 'director', 'Rahbariyat', '00000000-0000-4001-8001-000000000001'::uuid, true, 'active'),
  ('11111111-1111-4001-8001-000000000012'::uuid, '11111111-1111-4001-8001-000000000012'::uuid, 'Rustam Manager', 'Rustam Manager', 'manager@goldia.uz', 'production_manager', 'manager', 'Boshqaruv', '00000000-0000-4001-8001-000000000001'::uuid, true, 'active'),
  ('11111111-1111-4001-8001-000000000017'::uuid, '11111111-1111-4001-8001-000000000017'::uuid, 'Jamshid Sotuvchi', 'Jamshid Sotuvchi', 'seller@goldia.uz', 'sales', 'seller', 'Savdo', '00000000-0000-4001-8001-000000000001'::uuid, true, 'active')
ON CONFLICT (email) DO NOTHING;

-- 3. Bugungi Lom Kursi (585 proba = 900,000 UZS)
INSERT INTO public.daily_gold_rates (
  id, organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed, notes
)
VALUES (
  '55555555-5555-4001-8001-000000000001'::uuid,
  '00000000-0000-4001-8001-000000000001'::uuid,
  CURRENT_DATE,
  585.00,
  900000.00,
  'UZS',
  true,
  'Staging Demo standarti'
)
ON CONFLICT (organization_id, rate_date, proba) DO UPDATE SET
  rate_per_gram = EXCLUDED.rate_per_gram,
  is_confirmed = true;

-- 4. Sun'iy Zargarlik Modellari (Jewelry Models)
INSERT INTO public.jewelry_models (id, organization_id, code, name, category, standard_purity, description)
VALUES
  ('33333333-3333-4001-8001-000000000001'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, 'MOD-UZK-01', 'Italiya Uzuk 585', 'Uzuk', 585, 'Klassik ayollar uzugi'),
  ('33333333-3333-4001-8001-000000000002'::uuid, '00000000-0000-4001-8001-000000000002'::uuid, 'MOD-ZNJ-02', 'Bismark Zanjir 585', 'Zanjir', 585, 'Erkaklar zanjiri'),
  ('33333333-3333-4001-8001-000000000003'::uuid, '00000000-0000-4001-8001-000000000003'::uuid, 'MOD-BLG-03', 'Klassik Bilaguzuk 585', 'Bilaguzuk', 585, 'Qattiq bilaguzuk'),
  ('33333333-3333-4001-8001-000000000004'::uuid, '00000000-0000-4001-8001-000000000004'::uuid, 'MOD-SRG-04', 'Sharq Sirg''asi 585', 'Sirg''a', 585, 'Brilliant qoshli sirg''a')
ON CONFLICT (organization_id, code) DO NOTHING;

-- 5. Boshqaruvchi Omboridagi Sun'iy Mahsulotlar (Inventory Products)
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

-- 6. Individual Shtrix-kodli Buyumlar (Consignment Pieces)
INSERT INTO public.consignment_pieces (
  id, organization_id, barcode, model_code, title, weight, proba, status, location, current_holder_role, current_holder_id, notes
)
VALUES
  ('88888888-8888-4001-8001-000000000001'::uuid, '00000000-0000-4001-8001-000000000001'::uuid, '564000001', 'MOD-UZK-01', 'Uzuk Italiya #1', 4.5000, 585, 'in_stock', 'Boshqaruvchi Ombori', 'manager', '11111111-1111-4001-8001-000000000002'::uuid, 'Staging demo dona'),
  ('88888888-8888-4001-8001-000000000002'::uuid, '00000000-0000-4001-8001-000000000002'::uuid, '564000002', 'MOD-UZK-01', 'Uzuk Italiya #2', 5.0000, 585, 'in_stock', 'Boshqaruvchi Ombori', 'manager', '11111111-1111-4001-8001-000000000002'::uuid, 'Staging demo dona'),
  ('88888888-8888-4001-8001-000000000003'::uuid, '00000000-0000-4001-8001-000000000003'::uuid, '564000003', 'MOD-ZNJ-02', 'Bismark Zanjir #1', 12.8000, 585, 'consigned', 'Jamshid Sotuvchi Qo''lida', 'seller', '11111111-1111-4001-8001-000000000007'::uuid, 'Sotuvchiga berilgan'),
  ('88888888-8888-4001-8001-000000000004'::uuid, '00000000-0000-4001-8001-000000000004'::uuid, '564000004', 'MOD-BLG-03', 'Bilaguzuk Klassik #1', 18.2000, 585, 'consigned', 'Jamshid Sotuvchi Qo''lida', 'seller', '11111111-1111-4001-8001-000000000007'::uuid, 'Sotuvchiga berilgan')
ON CONFLICT (organization_id, barcode) DO NOTHING;

-- 7. Sun'iy Demo Mijozlar (Customers)
INSERT INTO public.customers (
  id, customer_code, contact_name, company_name, phone, organization_id, seller_id, address
)
VALUES
  ('77777777-7777-4001-8001-000000000001'::uuid, 'CUST-DEMO-01', 'Rustam Zargar (Demo)', 'Chorsu Savdo Rastasi #14', '+998901234567', '00000000-0000-4001-8001-000000000001'::uuid, '11111111-1111-4001-8001-000000000007'::uuid, 'Toshkent, Chorsu bozori'),
  ('77777777-7777-4001-8001-000000000002'::uuid, 'CUST-DEMO-02', 'Sherzod Akfa (Demo)', 'Qo''qon Savdo Markazi', '+998909876543', '00000000-0000-4001-8001-000000000001'::uuid, '11111111-1111-4001-8001-000000000007'::uuid, 'Farg''ona viloyati, Qo''qon')
ON CONFLICT (id) DO UPDATE SET
  contact_name = EXCLUDED.contact_name,
  company_name = EXCLUDED.company_name;

COMMIT;
