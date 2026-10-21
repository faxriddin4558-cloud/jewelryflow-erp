const http = require('http');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');

const PORT = parseInt(process.env.STAGING_SUPABASE_PORT || '54321', 10);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../.local-pilot-data/db');
const DEFAULT_BACKUP_DIR = path.resolve(__dirname, '../.local-backups');

// Fictional test organization and user IDs
const ORG_GOLDIA_ID = '00000000-0000-0000-0000-000000000001';
const ORG_SAMARKAND_ID = '00000000-0000-0000-0000-000000000002';

const TEST_USERS = [
  {
    id: '11111111-1111-4001-8001-000000000001',
    email: 'director@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'admin',
    role_type: 'director',
    department: 'Rahbariyat',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Alisher Director (Goldia)'
  },
  {
    id: '11111111-1111-4001-8001-000000000002',
    email: 'manager@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'production_manager',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Bobur Manager (Goldia)'
  },
  {
    id: '11111111-1111-4001-8001-000000000003',
    email: 'operator@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'department_operator',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Davron Usta (Goldia)'
  },
  {
    id: '11111111-1111-4001-8001-000000000004',
    email: 'qc@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'quality_inspector',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Dilshod Nazoratchi (Goldia)'
  },
  {
    id: '11111111-1111-4001-8001-000000000005',
    email: 'accountant@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'accountant',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Ziyoda Hisobchi (Goldia)'
  },
  {
    id: '11111111-1111-4001-8001-000000000006',
    email: 'warehouse@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'inventory_manager',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Anvar Omborchi (Goldia)'
  },
  {
    id: '11111111-1111-4001-8001-000000000007',
    email: 'seller@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'sales',
    role_type: 'seller',
    department: 'Savdo',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Jamshid Sotuvchi (Goldia)'
  },
  {
    id: '22222222-2222-4002-8002-000000000001',
    email: 'director@samarkand.uz',
    password: 'SamarkandPassword2026!',
    role: 'admin',
    organization_id: ORG_SAMARKAND_ID,
    full_name: 'Sardor Director (Samarkand)'
  },
  {
    id: '22222222-2222-4002-8002-000000000002',
    email: 'seller@samarkand.uz',
    password: 'SamarkandPassword2026!',
    role: 'sales',
    role_type: 'seller',
    department: 'Savdo',
    organization_id: ORG_SAMARKAND_ID,
    full_name: 'Bekzod Sotuvchi (Samarkand)'
  }
];

let dbInstance = null;
let serverInstance = null;
let activeDataDir = null;
let activeLockFile = null;

// ==============================================================================
// 1. Concurrency File-Lock Mechanism
// ==============================================================================
function acquireDbLock(dataDir, port) {
  const lockDir = path.dirname(dataDir);
  fs.mkdirSync(lockDir, { recursive: true });
  const lockFilePath = path.join(lockDir, 'db.lock');

  if (fs.existsSync(lockFilePath)) {
    try {
      const content = fs.readFileSync(lockFilePath, 'utf8');
      const lockData = JSON.parse(content);
      if (lockData.pid) {
        let isRunning = false;
        try {
          process.kill(lockData.pid, 0);
          isRunning = true;
        } catch {
          isRunning = false;
        }
        if (isRunning) {
          throw new Error(
            `[CONCURRENCY_VIOLATION] Local database is locked by another running process (PID: ${lockData.pid}, Port: ${lockData.port}, Started: ${lockData.startedAt}). Multiple processes cannot write to the same database directory concurrently.`
          );
        } else {
          console.warn(`[DATABASE-LOCK] Stale lockfile detected from dead process (PID: ${lockData.pid}). Recovering lock safely.`);
        }
      }
    } catch (err) {
      if (err.message.includes('[CONCURRENCY_VIOLATION]')) {
        throw err;
      }
      console.warn('[DATABASE-LOCK] Unreadable lockfile detected. Overwriting safely.');
    }
  }

  const newLock = {
    pid: process.pid,
    port,
    dataDir,
    startedAt: new Date().toISOString()
  };
  fs.writeFileSync(lockFilePath, JSON.stringify(newLock, null, 2), 'utf8');
  return lockFilePath;
}

function releaseDbLock(lockFilePath) {
  if (lockFilePath && fs.existsSync(lockFilePath)) {
    try {
      fs.unlinkSync(lockFilePath);
    } catch {}
  }
}

// ==============================================================================
// 2. Base Supabase Auth & Schema Setup
// ==============================================================================
async function setupSupabaseBase(db) {
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT
    LANGUAGE sql
    STABLE
    AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$;

    CREATE OR REPLACE FUNCTION auth.jwt()
    RETURNS JSONB
    LANGUAGE sql
    STABLE
    AS $$
      SELECT json_build_object(
        'sub', current_setting('request.jwt.claim.sub', true),
        'role', COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
      )::jsonb;
    $$;

    CREATE OR REPLACE FUNCTION moddatetime()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;

    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.local_db_metadata (
      key TEXT PRIMARY KEY,
      value JSONB,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

// ==============================================================================
// 3. Schema Migrations with Version Tracking (Never re-runs applied migrations)
// ==============================================================================
async function applyAllMigrations(db) {
  const appliedRes = await db.query('SELECT version FROM public.schema_migrations;');
  const appliedSet = new Set(appliedRes.rows.map(r => r.version));

  const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let newlyApplied = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    const sanitizedSql = sql
      .replace(
        /create\s+extension\s+if\s+not\s+exists\s+"moddatetime";/gi,
        '-- moddatetime handled natively'
      )
      .replace(
        /create\s+extension\s+if\s+not\s+exists\s+"pgcrypto";/gi,
        '-- pgcrypto gen_random_uuid is native in PG13+'
      );

    await db.exec(sanitizedSql);
    await db.query('INSERT INTO public.schema_migrations (version) VALUES ($1);', [file]);
    newlyApplied++;
  }

  if (newlyApplied > 0) {
    console.log(`[DATABASE-MIGRATIONS] Applied ${newlyApplied} new migrations. Schema is up to date.`);
  }

  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
  `);
}

// ==============================================================================
// 4. Seed Staging Data (Separated from user data, never overwrites on restart)
// ==============================================================================
async function ensureSalesDemoData(db) {
  // Ensure Organizations
  try {
    await db.exec(`
      INSERT INTO public.organizations (id, code, name, status)
      VALUES 
        ('${ORG_GOLDIA_ID}'::uuid, 'goldia', 'Goldia Jewelry Factory', 'ACTIVE'),
        ('${ORG_SAMARKAND_ID}'::uuid, 'samarkand', 'Samarkand Gold Factory', 'ACTIVE')
      ON CONFLICT (code) DO NOTHING;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] org ensure skipped:', err.message);
  }

  // Ensure Users into auth.users and public.employees (including Jamshid Sotuvchi)
  for (const u of TEST_USERS) {
    try {
      await db.exec(`
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (
          '${u.id}'::uuid,
          '${u.email}',
          '{"role": "${u.role}", "organization_id": "${u.organization_id}", "full_name": "${u.full_name}", "is_demo": true}'::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          raw_user_meta_data = EXCLUDED.raw_user_meta_data;

        INSERT INTO public.employees (
          id, user_id, name, full_name, email, role, role_type, department, organization_id, is_active, status
        )
        VALUES (
          '${u.id}'::uuid,
          '${u.id}'::uuid,
          '${u.full_name}',
          '${u.full_name}',
          '${u.email}',
          '${u.role}',
          '${u.role_type || (u.role === 'admin' ? 'director' : u.role === 'sales' ? 'seller' : u.role)}',
          '${u.department || (u.role === 'admin' ? 'Rahbariyat' : u.role === 'sales' ? 'Savdo' : 'Ishlab chiqarish')}',
          '${u.organization_id}'::uuid,
          true,
          'active'
        )
        ON CONFLICT (id) DO UPDATE SET
          role = EXCLUDED.role,
          role_type = EXCLUDED.role_type,
          department = EXCLUDED.department,
          full_name = EXCLUDED.full_name,
          name = EXCLUDED.name,
          organization_id = EXCLUDED.organization_id;
      `);
    } catch (err) {
      console.warn('[SEED-NOTICE] user ensure skipped:', err.message);
    }
  }

  // Ensure Finished Products for Sales
  try {
    await db.exec(`
      INSERT INTO public.products (
        id, name, title, category, weight, proba, stock, quantity, organization_id
      )
      VALUES
        ('66666666-6666-4001-8001-000000000001'::uuid, 'Uzuk Italiya 585 - 14.5g', 'Uzuk Italiya', 'Uzuk', 14.5000, 585.00, 10, 10, '${ORG_GOLDIA_ID}'::uuid),
        ('66666666-6666-4001-8001-000000000002'::uuid, 'Zanjir Bismark 585 - 22.8g', 'Zanjir Bismark', 'Zanjir', 22.8000, 585.00, 5, 5, '${ORG_GOLDIA_ID}'::uuid),
        ('66666666-6666-4001-8001-000000000003'::uuid, 'Bilaguzuk Klassik 585 - 35.0g', 'Bilaguzuk Klassik', 'Bilaguzuk', 35.0000, 585.00, 3, 3, '${ORG_GOLDIA_ID}'::uuid),
        ('66666666-6666-4001-8001-000000000100'::uuid, 'Zargarlik To''plami 585 - 100.0g', 'Zargarlik To''plami', 'Komplekt', 100.0000, 585.00, 10, 10, '${ORG_GOLDIA_ID}'::uuid)
      ON CONFLICT (id) DO UPDATE SET
        stock = EXCLUDED.stock,
        quantity = EXCLUDED.quantity,
        weight = EXCLUDED.weight,
        proba = EXCLUDED.proba;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] products ensure skipped:', err.message);
  }

  // Ensure Demo Customer
  try {
    await db.exec(`
      INSERT INTO public.customers (
        id, customer_code, contact_name, company_name, phone, organization_id, seller_id
      )
      VALUES (
        '77777777-7777-4001-8001-000000000001'::uuid,
        'CUST-GOLDIA-01',
        'Rustam Zargar',
        'Chorsu Savdo Markazi',
        '+998901234567',
        '${ORG_GOLDIA_ID}'::uuid,
        '11111111-1111-4001-8001-000000000007'::uuid
      )
      ON CONFLICT (id) DO UPDATE SET
        contact_name = EXCLUDED.contact_name,
        company_name = EXCLUDED.company_name;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] customers ensure skipped:', err.message);
  }

  // Ensure Daily Gold Rate
  try {
    await db.exec(`
      INSERT INTO public.daily_gold_rates (
        id, organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed, set_by, notes
      )
      VALUES (
        '55555555-5555-4001-8001-000000000001'::uuid,
        '${ORG_GOLDIA_ID}'::uuid,
        current_date,
        585.00,
        900000.00,
        'UZS',
        true,
        '11111111-1111-4001-8001-000000000001'::uuid,
        'Goldia zavodi pilot 585 lom narxi (900,000 UZS/g)'
      )
      ON CONFLICT (organization_id, rate_date, proba) DO NOTHING;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] daily_gold_rates ensure skipped:', err.message);
  }

  // Ensure Demo Jewelry Models (e.g. Malika for BarTender / Scanner 564)
  try {
    await db.exec(`
      INSERT INTO public.jewelry_models (
        id, model_code, name, category, ring_size, loops_count, locks_count, decorations, reference_weight_grams, is_active, organization_id, gold_purity, proba
      )
      VALUES (
        '88888888-8888-4001-8001-000000000001'::uuid,
        'JF-M-0001',
        'Malika',
        'Серьги',
        null,
        0,
        0,
        'Дорика',
        14.500,
        true,
        '${ORG_GOLDIA_ID}'::uuid,
        '585',
        585
      )
      ON CONFLICT (model_code) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        decorations = EXCLUDED.decorations,
        reference_weight_grams = EXCLUDED.reference_weight_grams,
        organization_id = EXCLUDED.organization_id,
        gold_purity = '585',
        proba = 585,
        is_active = true;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] jewelry_models ensure skipped:', err.message);
  }

  // Ensure Sales Markup Presets (Factory & Client)
  try {
    await db.exec(`
      INSERT INTO public.sales_markup_presets (
        organization_id, type, name, percentage, is_active, is_default, display_order
      )
      VALUES
        ('${ORG_GOLDIA_ID}'::uuid, 'factory_markup', 'Zavod 6%', 6.00, true, false, 1),
        ('${ORG_GOLDIA_ID}'::uuid, 'factory_markup', 'Zavod 8% (Standart)', 8.00, true, true, 2),
        ('${ORG_GOLDIA_ID}'::uuid, 'factory_markup', 'Zavod 10%', 10.00, true, false, 3),
        ('${ORG_GOLDIA_ID}'::uuid, 'client_markup', 'Mijoz 10% (Optom)', 10.00, true, false, 1),
        ('${ORG_GOLDIA_ID}'::uuid, 'client_markup', 'Mijoz 12% (Standart)', 12.00, true, true, 2),
        ('${ORG_GOLDIA_ID}'::uuid, 'client_markup', 'Mijoz 15% (Chakana)', 15.00, true, false, 3),
        ('${ORG_GOLDIA_ID}'::uuid, 'client_markup', 'Mijoz 18% (Eksklyuziv)', 18.00, true, false, 4),
        ('${ORG_GOLDIA_ID}'::uuid, 'client_markup', 'Mijoz 25% (Maxsus)', 25.00, true, false, 5)
      ON CONFLICT (organization_id, type, percentage) DO NOTHING;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] sales_markup_presets ensure skipped:', err.message);
  }
}

async function seedStagingData(db, force = false) {
  // Always verify sales demo data exists idempotently
  await ensureSalesDemoData(db);

  if (!force) {
    const metaCheck = await db.query(
      "SELECT value FROM public.local_db_metadata WHERE key = 'initial_seed_completed';"
    );
    if (metaCheck.rows.length > 0) {
      console.log('[DATABASE-SEED] Persistent database verified. Preserving user records and verified idempotent seeds.');
      return;
    }
  }

  console.log('[DATABASE-SEED] Initializing demo factory (Goldia), users, and safe inventory...');

  // Seed Organizations
  await db.exec(`
    INSERT INTO public.organizations (id, code, name, status)
    VALUES 
      ('${ORG_GOLDIA_ID}'::uuid, 'goldia', 'Goldia Jewelry Factory', 'ACTIVE'),
      ('${ORG_SAMARKAND_ID}'::uuid, 'samarkand', 'Samarkand Gold Factory', 'ACTIVE')
    ON CONFLICT (code) DO NOTHING;
  `);

  // Seed Users into auth.users and public.employees
  for (const u of TEST_USERS) {
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES (
        '${u.id}'::uuid,
        '${u.email}',
        '{"role": "${u.role}", "organization_id": "${u.organization_id}", "full_name": "${u.full_name}", "is_demo": true}'::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        raw_user_meta_data = EXCLUDED.raw_user_meta_data;

      INSERT INTO public.employees (
        id, user_id, name, full_name, email, role, role_type, department, organization_id, is_active, status
      )
      VALUES (
        '${u.id}'::uuid,
        '${u.id}'::uuid,
        '${u.full_name}',
        '${u.full_name}',
        '${u.email}',
        '${u.role}',
        '${u.role_type || (u.role === 'admin' ? 'director' : u.role === 'sales' ? 'seller' : u.role)}',
        '${u.department || (u.role === 'admin' ? 'Rahbariyat' : u.role === 'sales' ? 'Savdo' : 'Ishlab chiqarish')}',
        '${u.organization_id}'::uuid,
        true,
        'active'
      )
      ON CONFLICT (id) DO UPDATE SET
        role = EXCLUDED.role,
        role_type = EXCLUDED.role_type,
        department = EXCLUDED.department,
        full_name = EXCLUDED.full_name,
        name = EXCLUDED.name,
        organization_id = EXCLUDED.organization_id;
    `);
  }

  // Seed Factory Settings for Samarkand (no bypasses)
  await db.exec(`
    INSERT INTO public.organization_factory_settings (
      organization_id, disabled_stage_codes, disabled_stage_orders, disabled_department_slugs
    )
    VALUES (
      '${ORG_SAMARKAND_ID}'::uuid,
      ARRAY[]::text[],
      ARRAY[]::integer[],
      ARRAY[]::text[]
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      disabled_stage_codes = EXCLUDED.disabled_stage_codes,
      disabled_stage_orders = EXCLUDED.disabled_stage_orders;
  `);

  // Seed Inventory items (Safe gold balance)
  await db.exec(`
    INSERT INTO public.inventory_items (
      id, name, category, proba, on_hand, quantity_on_hand, reserved, organization_id
    )
    VALUES 
      ('33333333-3333-4001-8001-000000000001'::uuid, 'Chisto Oltin 999.9', 'Gold', 999.9, 1000.0000, 1000.0000, 0, '${ORG_GOLDIA_ID}'::uuid),
      ('33333333-3333-4001-8001-000000000002'::uuid, 'Oltin Lom 585', 'scrap', 585.0, 500.0000, 500.0000, 0, '${ORG_GOLDIA_ID}'::uuid),
      ('33333333-3333-4001-8001-000000000003'::uuid, 'Ligatura Master Qotishma', 'consumable', 0.0, 150.0000, 150.0000, 0, '${ORG_GOLDIA_ID}'::uuid),
      ('33333333-3333-4001-8001-000000000004'::uuid, 'Oltin 585 SAFE', 'Gold', 585.0, 1000.0000, 1000.0000, 0, '${ORG_GOLDIA_ID}'::uuid),
      ('33333333-3333-4002-8002-000000000001'::uuid, 'Samarkand Chisto Oltin 999.9', 'Gold', 999.9, 500.0000, 500.0000, 0, '${ORG_SAMARKAND_ID}'::uuid),
      ('33333333-3333-4002-8002-000000000002'::uuid, 'Samarkand Oltin 585 SAFE', 'Gold', 585.0, 500.0000, 500.0000, 0, '${ORG_SAMARKAND_ID}'::uuid)
    ON CONFLICT (id) DO UPDATE SET
      category = EXCLUDED.category,
      on_hand = EXCLUDED.on_hand,
      quantity_on_hand = EXCLUDED.quantity_on_hand;
  `);

  // Seed Machines
  await db.exec(`
    INSERT INTO public.machines (id, name, department, status, organization_id)
    VALUES
      (gen_random_uuid(), 'LASER-01', 'Lazer', 'IDLE', '${ORG_GOLDIA_ID}'::uuid),
      (gen_random_uuid(), 'CAST-01', 'Quyish', 'IDLE', '${ORG_GOLDIA_ID}'::uuid),
      (gen_random_uuid(), 'LASER-SAM-01', 'Lazer', 'IDLE', '${ORG_SAMARKAND_ID}'::uuid)
    ON CONFLICT DO NOTHING;
  `);

  // Seed Daily Gold Rate for today
  try {
    await db.exec(`
      INSERT INTO public.daily_gold_rates (
        id, organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed, set_by, notes
      )
      VALUES (
        '55555555-5555-4001-8001-000000000001'::uuid,
        '${ORG_GOLDIA_ID}'::uuid,
        current_date,
        585.00,
        900000.00,
        'UZS',
        true,
        '11111111-1111-4001-8001-000000000001'::uuid,
        'Goldia zavodi pilot 585 lom narxi (900,000 UZS/g)'
      )
      ON CONFLICT (organization_id, rate_date, proba) DO NOTHING;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] daily_gold_rates seed skipped:', err.message);
  }

  // Seed Finished Products for Sales
  try {
    await db.exec(`
      INSERT INTO public.products (
        id, name, title, category, weight, proba, stock, quantity, organization_id
      )
      VALUES
        ('66666666-6666-4001-8001-000000000001'::uuid, 'Uzuk Italiya 585 - 14.5g', 'Uzuk Italiya', 'Uzuk', 14.5000, 585.00, 10, 10, '${ORG_GOLDIA_ID}'::uuid),
        ('66666666-6666-4001-8001-000000000002'::uuid, 'Zanjir Bismark 585 - 22.8g', 'Zanjir Bismark', 'Zanjir', 22.8000, 585.00, 5, 5, '${ORG_GOLDIA_ID}'::uuid),
        ('66666666-6666-4001-8001-000000000003'::uuid, 'Bilaguzuk Klassik 585 - 35.0g', 'Bilaguzuk Klassik', 'Bilaguzuk', 35.0000, 585.00, 3, 3, '${ORG_GOLDIA_ID}'::uuid),
        ('66666666-6666-4001-8001-000000000100'::uuid, 'Zargarlik To''plami 585 - 100.0g', 'Zargarlik To''plami', 'Komplekt', 100.0000, 585.00, 10, 10, '${ORG_GOLDIA_ID}'::uuid)
      ON CONFLICT (id) DO UPDATE SET
        stock = EXCLUDED.stock,
        quantity = EXCLUDED.quantity,
        weight = EXCLUDED.weight,
        proba = EXCLUDED.proba;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] products seed skipped:', err.message);
  }

  // Seed Demo Customer
  try {
    await db.exec(`
      INSERT INTO public.customers (
        id, customer_code, contact_name, company_name, phone, organization_id, seller_id
      )
      VALUES (
        '77777777-7777-4001-8001-000000000001'::uuid,
        'CUST-GOLDIA-01',
        'Rustam Zargar',
        'Chorsu Savdo Markazi',
        '+998901234567',
        '${ORG_GOLDIA_ID}'::uuid,
        '11111111-1111-4001-8001-000000000007'::uuid
      )
      ON CONFLICT (id) DO UPDATE SET
        contact_name = EXCLUDED.contact_name,
        company_name = EXCLUDED.company_name;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] customers seed skipped:', err.message);
  }

  // Seed Seller Gold Account for Jamshid Sotuvchi
  try {
    await db.exec(`
      INSERT INTO public.seller_gold_accounts (
        seller_id, organization_id, total_consigned_gold_grams, current_factory_obligation_grams,
        seller_till_scrap_grams, seller_till_cash_amount, total_client_debt_grams
      )
      VALUES (
        '11111111-1111-4001-8001-000000000007'::uuid,
        '${ORG_GOLDIA_ID}'::uuid,
        0, 0, 0, 0, 0
      )
      ON CONFLICT (seller_id) DO NOTHING;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] seller_gold_accounts seed skipped:', err.message);
  }

  // Seed Client Gold Account for Rustam Zargar
  try {
    await db.exec(`
      INSERT INTO public.client_gold_accounts (
        customer_id, organization_id, seller_id, total_purchased_gold_grams, current_debt_grams
      )
      VALUES (
        '77777777-7777-4001-8001-000000000001'::uuid,
        '${ORG_GOLDIA_ID}'::uuid,
        '11111111-1111-4001-8001-000000000007'::uuid,
        0, 0
      )
      ON CONFLICT (customer_id) DO NOTHING;
    `);
  } catch (err) {
    console.warn('[SEED-NOTICE] client_gold_accounts seed skipped:', err.message);
  }

  await db.query(
    "INSERT INTO public.local_db_metadata (key, value) VALUES ('initial_seed_completed', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET updated_at = now();"
  );
  console.log('[DATABASE-SEED] Initial demo factory and accounts successfully provisioned.');
}

// ==============================================================================
// 5. Auth Helper Functions (Explicitly marked DEMO / OFFLINE ONLY)
// ==============================================================================
function createJWT(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', emulated: true })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    is_demo: true,
    auth_emulator: 'LOCAL_OFFLINE_PG_EMULATOR_NOT_PRODUCTION',
    user_metadata: {
      role: user.role,
      role_type: user.role_type || (user.role === 'admin' ? 'director' : user.role === 'sales' ? 'seller' : user.role),
      department: user.department || (user.role === 'admin' ? 'Rahbariyat' : user.role === 'sales' ? 'Savdo' : 'Ishlab chiqarish'),
      organization_id: user.organization_id,
      full_name: user.full_name,
      is_demo_account: true
    },
    app_metadata: {
      provider: 'email',
      providers: ['email'],
      is_local_emulator: true
    },
    exp: Math.floor(Date.now() / 1000) + 86400 * 7
  })).toString('base64url');
  return `${header}.${payload}.demo-sig-do-not-use-in-production`;
}

function parseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadStr = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payloadStr);
  } catch {
    return null;
  }
}

async function setSqlContext(db, user) {
  if (!user || !user.sub) {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
      SELECT set_config('app.current_organization_id', '', false);
      SET ROLE anon;
    `);
  } else {
    const orgId = user.user_metadata?.organization_id || '';
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '${user.sub}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      ${orgId ? `SELECT set_config('app.current_organization_id', '${orgId}', false);` : ''}
      SET ROLE authenticated;
    `);
  }
}

// ==============================================================================
// 6. Server Lifecycle: Start & Stop (Persistent by Default)
// ==============================================================================
async function startStagingServer(port = PORT, options = {}) {
  // Remote production protection guard
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (configuredUrl && !configuredUrl.includes('127.0.0.1') && !configuredUrl.includes('localhost')) {
    throw new Error(
      `[CRITICAL_SECURITY_GUARD] Remote Supabase URL detected (${configuredUrl}). Refusing to run offline emulator against remote target to prevent accidental cloud leakage.`
    );
  }

  const isMemory = options.isMemory === true;
  const dataDir = isMemory ? null : (options.dataDir || DEFAULT_DATA_DIR);
  activeDataDir = dataDir;

  if (!isMemory) {
    activeLockFile = acquireDbLock(dataDir, port);
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`[LOCAL-PILOT-DB] Opening persistent PGlite storage at: ${dataDir}`);
    dbInstance = new PGlite(dataDir, {
      extensions: { uuid_ossp, pg_trgm, btree_gist }
    });
  } else {
    console.log('[LOCAL-PILOT-DB] Opening transient in-memory PGlite storage (isolated test run)');
    dbInstance = new PGlite({
      extensions: { uuid_ossp, pg_trgm, btree_gist }
    });
  }

  // Self-check database integrity
  try {
    await setupSupabaseBase(dbInstance);
    await applyAllMigrations(dbInstance);
    await seedStagingData(dbInstance);
  } catch (err) {
    console.error('[DATABASE-CORRUPTION-ALERT] Failed to initialize database:', err);
    throw new Error(`[DATABASE_INTEGRITY_FAILURE] Database startup failed: ${err.message}. If corrupted, restore from latest backup via node scripts/restore-local-db.js.`);
  }

  return new Promise((resolve) => {
    serverInstance = http.createServer(async (req, res) => {
      // Security and Demarcation Headers (Milestone 2)
      res.setHeader('X-JewelryFlow-Environment', 'LOCAL-PILOT-EMULATED-NOT-PRODUCTION');
      res.setHeader('X-JewelryFlow-Auth-Mode', 'OFFLINE-MOCK-JWT-DEMO-ONLY');
      res.setHeader('X-JewelryFlow-Notice', 'DEMO-OFFLINE-ONLY-NEVER-USE-IN-PRODUCTION');
      res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
      const pathname = parsedUrl.pathname;
      const tokenPayload = parseToken(req.headers['authorization']);

      if (options.verbose) {
        console.log(`[PILOT-REQ] ${req.method} ${pathname} Auth:${req.headers['authorization'] ? 'BEARER' : 'NONE'}`);
      }

      // Read Body
      let bodyData = '';
      req.on('data', chunk => { bodyData += chunk; });
      req.on('end', async () => {
        let jsonBody = {};
        if (bodyData) {
          try { jsonBody = JSON.parse(bodyData); } catch {}
        }

        try {
          // 1. Health check & Diagnostics
          if (pathname === '/staging/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              environment: 'LOCAL-PILOT-EMULATED-NOT-PRODUCTION',
              isolated: true,
              persistent: !isMemory,
              dataDir: activeDataDir,
              pid: process.pid,
              pglite: true,
              notice: 'DEMO / NOT PRODUCTION. Offline Emulated Supabase Backend.'
            }));
            return;
          }

          // 2. Database Backup Snapshot (Milestone 1)
          if (pathname === '/staging/backup' && req.method === 'POST') {
            const backupDir = DEFAULT_BACKUP_DIR;
            fs.mkdirSync(backupDir, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const targetDir = path.join(backupDir, `backup-${timestamp}`);

            const tableStats = await dbInstance.query(`
              SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
            `);
            const batchCount = await dbInstance.query('SELECT count(*)::int as cnt FROM public.batches;');
            const goldTxCount = await dbInstance.query('SELECT count(*)::int as cnt FROM public.gold_transactions;');
            const ordersCount = await dbInstance.query('SELECT count(*)::int as cnt FROM public.orders;');

            fs.mkdirSync(targetDir, { recursive: true });
            if (activeDataDir && fs.existsSync(activeDataDir)) {
              fs.cpSync(activeDataDir, path.join(targetDir, 'db'), { recursive: true });
            }

            const manifest = {
              backupName: `backup-${timestamp}`,
              timestamp: new Date().toISOString(),
              engine: 'PGlite PostgreSQL 18/16 WASM',
              totalTables: tableStats.rows.length,
              recordCounts: {
                batches: batchCount.rows[0].cnt,
                goldTransactions: goldTxCount.rows[0].cnt,
                orders: ordersCount.rows[0].cnt
              }
            };
            fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, targetDir, manifest }));
            return;
          }

          // 3. Reset (Requires explicit force: true parameter)
          if (pathname === '/staging/reset' && req.method === 'POST') {
            if (jsonBody.force === true) {
              await seedStagingData(dbInstance, true);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ reset: true, notice: 'Forced reseed completed.' }));
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Reset rejected: To prevent accidental data loss, provide force: true.' }));
            }
            return;
          }

          // 4. Auth: /auth/v1/token (Offline Mock Login)
          if (pathname === '/auth/v1/token') {
            const { email, password } = jsonBody;
            const normalizedEmail = (email || '').trim().toLowerCase();
            const normalizedPassword = (password || '').trim();

            const user = TEST_USERS.find(u => {
              const uEmail = u.email.toLowerCase();
              if (uEmail === normalizedEmail) return true;
              if (normalizedEmail === 'admin@zavod.uz' && uEmail === 'director@goldia.uz') return true;
              if (normalizedEmail === 'admin@goldia.uz' && uEmail === 'director@goldia.uz') return true;
              if (normalizedEmail === 'direktor@goldia.uz' && uEmail === 'director@goldia.uz') return true;
              if (normalizedEmail === 'sotuvchi@goldia.uz' && uEmail === 'seller@goldia.uz') return true;
              return false;
            });

            const isValidPassword =
              user &&
              (normalizedPassword === user.password ||
                normalizedPassword === 'GoldiaPassword2026!' ||
                normalizedPassword === 'SamarkandPassword2026!' ||
                normalizedPassword === 'demo12345' ||
                normalizedPassword === '123456');

            if (!user || !isValidPassword) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'invalid_grant',
                error_description: 'Email yoki parol noto\'g\'ri! Demo direktor: director@goldia.uz, demo sotuvchi: seller@goldia.uz (Parol: GoldiaPassword2026!)'
              }));
              return;
            }

            const token = createJWT(user);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              access_token: token,
              token_type: 'bearer',
              expires_in: 86400 * 7,
              refresh_token: 'ref-' + token,
              user: {
                id: user.id,
                aud: 'authenticated',
                role: 'authenticated',
                email: user.email,
                user_metadata: {
                  role: user.role,
                  role_type: user.role_type || (user.role === 'admin' ? 'director' : user.role === 'sales' ? 'seller' : user.role),
                  department: user.department || (user.role === 'admin' ? 'Rahbariyat' : user.role === 'sales' ? 'Savdo' : 'Ishlab chiqarish'),
                  organization_id: user.organization_id,
                  full_name: user.full_name,
                  is_demo_account: true
                },
                app_metadata: { provider: 'email', providers: ['email'], is_local_emulator: true }
              }
            }));
            return;
          }

          // 5. Auth: /auth/v1/user
          if (pathname === '/auth/v1/user') {
            if (!tokenPayload || !tokenPayload.sub) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Invalid or missing JWT' }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: tokenPayload.sub,
              aud: 'authenticated',
              role: 'authenticated',
              email: tokenPayload.email,
              user_metadata: tokenPayload.user_metadata || {},
              app_metadata: tokenPayload.app_metadata || { provider: 'email', is_local_emulator: true }
            }));
            return;
          }

          // 6. Auth: /auth/v1/logout
          if (pathname === '/auth/v1/logout') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));
            return;
          }

          // Set SQL context for RLS
          await setSqlContext(dbInstance, tokenPayload);

          // 7. REST RPC: /rest/v1/rpc/<rpc_name>
          if (pathname.startsWith('/rest/v1/rpc/')) {
            const rpcName = pathname.replace('/rest/v1/rpc/', '').replace(/\/$/, '');
            const params = jsonBody || {};
            const paramKeys = Object.keys(params);

            let sqlQuery = '';
            let paramValues = [];

            if (paramKeys.length === 0) {
              sqlQuery = `SELECT public.${rpcName}() as result;`;
            } else {
              const argList = paramKeys.map((k, i) => `${k} => $${i + 1}`).join(', ');
              sqlQuery = `SELECT public.${rpcName}(${argList}) as result;`;
              paramValues = paramKeys.map(k => params[k]);
            }

            const result = await dbInstance.query(sqlQuery, paramValues);
            const output = result.rows && result.rows.length > 0 ? result.rows[0].result : null;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(output !== undefined ? output : {}));
            return;
          }

          // 8. REST Tables: /rest/v1/<table>
          if (pathname.startsWith('/rest/v1/')) {
            const tableName = pathname.replace('/rest/v1/', '').split('?')[0].replace(/\/$/, '');
            
            let selectCol = parsedUrl.searchParams.get('select') || '*';
            if (selectCol.includes(':') || selectCol.includes('(')) {
              selectCol = '*';
            }
            const orderParam = parsedUrl.searchParams.get('order');
            const limitParam = parsedUrl.searchParams.get('limit');

            const whereClauses = [];
            const whereValues = [];

            parsedUrl.searchParams.forEach((val, key) => {
              if (['select', 'order', 'limit', 'offset'].includes(key)) return;
              if (val.startsWith('eq.')) {
                whereValues.push(val.slice(3));
                whereClauses.push(`${key} = $${whereValues.length}`);
              } else if (val.startsWith('gt.')) {
                whereValues.push(val.slice(3));
                whereClauses.push(`${key} > $${whereValues.length}`);
              } else if (val.startsWith('gte.')) {
                whereValues.push(val.slice(4));
                whereClauses.push(`${key} >= $${whereValues.length}`);
              } else if (val.startsWith('lt.')) {
                whereValues.push(val.slice(3));
                whereClauses.push(`${key} < $${whereValues.length}`);
              } else if (val.startsWith('lte.')) {
                whereValues.push(val.slice(4));
                whereClauses.push(`${key} <= $${whereValues.length}`);
              }
            });

            if (req.method === 'GET' || req.method === 'HEAD') {
              let sql = `SELECT ${selectCol} FROM public.${tableName}`;
              if (whereClauses.length > 0) {
                sql += ` WHERE ` + whereClauses.join(' AND ');
              }
              if (orderParam) {
                const parts = orderParam.split('.');
                const col = parts[0];
                const dir = parts[1] === 'desc' ? 'DESC' : 'ASC';
                sql += ` ORDER BY ${col} ${dir}`;
              }
              if (limitParam) {
                sql += ` LIMIT ${parseInt(limitParam, 10)}`;
              }

              const result = await dbInstance.query(sql, whereValues);
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Range': `0-${result.rows.length}/${result.rows.length}`
              });
              if (req.method === 'HEAD') {
                res.end();
              } else {
                res.end(JSON.stringify(result.rows));
              }
              return;
            }

            if (req.method === 'POST') {
              const items = Array.isArray(jsonBody) ? jsonBody : [jsonBody];
              const inserted = [];
              for (const item of items) {
                const cols = Object.keys(item);
                const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
                const vals = cols.map(c => item[c]);
                const insertSql = `INSERT INTO public.${tableName} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *;`;
                const r = await dbInstance.query(insertSql, vals);
                inserted.push(r.rows[0]);
              }
              res.writeHead(201, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(Array.isArray(jsonBody) ? inserted : inserted[0]));
              return;
            }

            if (req.method === 'PATCH') {
              const updateCols = Object.keys(jsonBody);
              const setClause = updateCols.map((c, i) => `${c} = $${i + 1}`).join(', ');
              const updateVals = updateCols.map(c => jsonBody[c]);

              let patchSql = `UPDATE public.${tableName} SET ${setClause}`;
              if (whereClauses.length > 0) {
                const adjustedWhere = whereClauses.map((c, i) => {
                  return c.replace(/\$\d+/, `$${updateVals.length + i + 1}`);
                });
                patchSql += ` WHERE ` + adjustedWhere.join(' AND ');
                updateVals.push(...whereValues);
              }
              patchSql += ` RETURNING *;`;

              const result = await dbInstance.query(patchSql, updateVals);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result.rows));
              return;
            }

            if (req.method === 'DELETE') {
              let delSql = `DELETE FROM public.${tableName}`;
              if (whereClauses.length > 0) {
                delSql += ` WHERE ` + whereClauses.join(' AND ');
              }
              delSql += ` RETURNING *;`;
              const result = await dbInstance.query(delSql, whereValues);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result.rows));
              return;
            }
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint not found', pathname }));
        } catch (err) {
          console.error(`[STAGING-SERVER-ERROR] ${pathname}:`, err.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            message: err.message,
            code: err.code || 'PGRST_ERROR',
            details: err.detail || err.message
          }));
        }
      });
    });

    // Explicit localhost-only binding (Milestone 2)
    serverInstance.listen(port, '127.0.0.1', () => {
      console.log(`[LOCAL-PILOT-SERVER] [DEMO/NOT-PRODUCTION] Listening exclusively on http://127.0.0.1:${port}`);
      resolve({ server: serverInstance, db: dbInstance, dataDir: activeDataDir });
    });
  });
}

function stopStagingServer() {
  return new Promise(async (resolve) => {
    if (activeLockFile) {
      releaseDbLock(activeLockFile);
      activeLockFile = null;
    }
    if (serverInstance) {
      serverInstance.close(async () => {
        if (dbInstance) {
          try {
            await dbInstance.close();
          } catch {}
          dbInstance = null;
        }
        console.log('[LOCAL-PILOT-SERVER] Stopped.');
        resolve();
      });
    } else {
      if (dbInstance) {
        try {
          await dbInstance.close();
        } catch {}
        dbInstance = null;
      }
      resolve();
    }
  });
}

if (require.main === module) {
  startStagingServer().then(() => {
    console.log('Press Ctrl+C to stop staging server.');
  });
}

module.exports = {
  startStagingServer,
  stopStagingServer,
  TEST_USERS,
  ORG_GOLDIA_ID,
  ORG_SAMARKAND_ID,
  DEFAULT_DATA_DIR,
  DEFAULT_BACKUP_DIR
};
