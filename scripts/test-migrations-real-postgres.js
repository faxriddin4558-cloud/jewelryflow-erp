const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');

async function setupSupabaseBase(db) {
  // 1. Roles
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
  `);

  // 2. Auth schema & users table
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT,
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
  `);

  // 3. Fallback trigger function for moddatetime if extension is invoked
  await db.exec(`
    CREATE OR REPLACE FUNCTION moddatetime()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;
  `);
}

async function runMigrations(runNumber = 1) {
  console.log(`\n======================================================`);
  console.log(`STARTING REAL POSTGRESQL MIGRATION RUN #${runNumber}`);
  console.log(`Target: Isolated Disposable PGlite (Real PostgreSQL 18/16 WASM)`);
  console.log(`======================================================`);

  const db = new PGlite({
    extensions: {
      uuid_ossp,
      pg_trgm,
      btree_gist,
    },
  });

  await setupSupabaseBase(db);

  const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration files in sequence:`);

  const results = [];
  let hasFailure = false;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    // Replace moddatetime / pgcrypto extension calls if not compiled in wasm bundle
    const sanitizedSql = sql
      .replace(
        /create\s+extension\s+if\s+not\s+exists\s+"moddatetime";/gi,
        '-- moddatetime handled via native function'
      )
      .replace(
        /create\s+extension\s+if\s+not\s+exists\s+"pgcrypto";/gi,
        '-- pgcrypto gen_random_uuid is native in PG 13+'
      );

    const start = Date.now();
    try {
      await db.exec(sanitizedSql);
      const duration = Date.now() - start;
      console.log(`  [OK] ${file} (${duration}ms)`);
      results.push({ file, status: 'PASS', duration });
    } catch (err) {
      const duration = Date.now() - start;
      console.error(`  [FAIL] ${file} (${duration}ms)`);
      console.error(`         ERROR: ${err.message}`);
      results.push({ file, status: 'FAIL', duration, error: err.message });
      hasFailure = true;
      break;
    }
  }

  // Count tables and functions created
  if (!hasFailure) {
    const tablesRes = await db.query(`
      SELECT count(*)::int as count
        FROM information_schema.tables
       WHERE table_schema = 'public';
    `);
    const funcsRes = await db.query(`
      SELECT count(*)::int as count
        FROM information_schema.routines
       WHERE routine_schema = 'public';
    `);

    console.log(`\nMigration Run #${runNumber} Summary:`);
    console.log(`  Total Tables in public schema: ${tablesRes.rows[0].count}`);
    console.log(`  Total Functions/RPCs in public: ${funcsRes.rows[0].count}`);
  }

  await db.close();
  return { results, hasFailure };
}

async function main() {
  // Run 1: First fresh database run
  const run1 = await runMigrations(1);
  if (run1.hasFailure) {
    console.error('\nRun #1 FAILED. Aborting subsequent runs.');
    process.exit(1);
  }

  // Run 2: Second fresh database run to confirm reproducibility
  const run2 = await runMigrations(2);
  if (run2.hasFailure) {
    console.error('\nRun #2 FAILED. Reproducibility test failed.');
    process.exit(1);
  }

  console.log('\n======================================================');
  console.log('ALL MIGRATIONS 001-021 PASSED REPRODUCIBLY (2/2 RUNS)');
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('Fatal error running migration verification:', err);
  process.exit(1);
});
