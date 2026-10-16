const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');

// Colors for terminal output
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

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

async function applyAllMigrations(db) {
  const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
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
  }

  // Grant standard Supabase schema privileges so RLS handles row-level access
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
  `);
}

async function setContext(db, userId, role = 'authenticated') {
  if (!userId) {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
      SET ROLE anon;
    `);
  } else {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '${userId}', false);
      SELECT set_config('request.jwt.claim.role', '${role}', false);
      SET ROLE authenticated;
    `);
  }
}

async function runAllVerificationPhases() {
  console.log(bold('\n======================================================================'));
  console.log(bold('JEWELRYFLOW ERP — REAL POSTGRESQL MULTI-PHASE VERIFICATION SUITE'));
  console.log(bold('Engine: Isolated Disposable PGlite (Real PostgreSQL 18/16 WASM)'));
  console.log(bold('======================================================================\n'));

  const db = new PGlite({
    extensions: { uuid_ossp, pg_trgm, btree_gist },
  });

  const stats = { total: 0, passed: 0, failed: 0 };
  const testAssert = async (desc, fn) => {
    stats.total++;
    process.stdout.write(`  [TEST ${stats.total}] ${desc} ... `);
    try {
      await fn();
      stats.passed++;
      console.log(green('PASS'));
    } catch (err) {
      stats.failed++;
      console.log(red('FAIL'));
      console.error(red(`         -> Error: ${err.message}`));
    }
  };

  // 1. Initial Migration Setup
  console.log(cyan('--- PHASE A: Migration 001-024 Application & Database Boot ---'));
  await setupSupabaseBase(db);
  await applyAllMigrations(db);
  console.log(green('  Migrations 001 through 024 successfully applied to fresh PostgreSQL.\n'));

  // Define Fixture UUIDs (valid hex digits only)
  const ORG_A_ID = '11111111-1111-1111-1111-111111111111';
  const ORG_B_ID = '22222222-2222-2222-2222-222222222222';
  const OP_A_UID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const OP_B_UID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const MGR_A_UID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const MGR_B_UID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const MASTER_A_UID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  // Seed Tenants and Users as Superuser
  await db.exec(`
    INSERT INTO public.organizations (id, code, name, status)
    VALUES
      ('${ORG_A_ID}'::uuid, 'org-a', 'Zargarlik Zavodi A', 'ACTIVE'),
      ('${ORG_B_ID}'::uuid, 'org-b', 'Zargarlik Zavodi B', 'ACTIVE')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO auth.users (id, email)
    VALUES
      ('${OP_A_UID}'::uuid, 'operator-a@org-a.uz'),
      ('${OP_B_UID}'::uuid, 'operator-b@org-b.uz'),
      ('${MGR_A_UID}'::uuid, 'manager-a@org-a.uz'),
      ('${MGR_B_UID}'::uuid, 'manager-b@org-b.uz'),
      ('${MASTER_A_UID}'::uuid, 'master-a@org-a.uz')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.employees (id, user_id, name, full_name, email, role, role_type, organization_id, is_active, status)
    VALUES
      ('${OP_A_UID}'::uuid, '${OP_A_UID}'::uuid, 'Ali Operator A', 'Ali Operator A', 'operator-a@org-a.uz', 'department_operator', 'department_operator', '${ORG_A_ID}'::uuid, true, 'active'),
      ('${OP_B_UID}'::uuid, '${OP_B_UID}'::uuid, 'Vali Operator B', 'Vali Operator B', 'operator-b@org-b.uz', 'department_operator', 'department_operator', '${ORG_B_ID}'::uuid, true, 'active'),
      ('${MGR_A_UID}'::uuid, '${MGR_A_UID}'::uuid, 'Karim Rahbar A', 'Karim Rahbar A', 'manager-a@org-a.uz', 'production_manager', 'production_manager', '${ORG_A_ID}'::uuid, true, 'active'),
      ('${MGR_B_UID}'::uuid, '${MGR_B_UID}'::uuid, 'Sardor Rahbar B', 'Sardor Rahbar B', 'manager-b@org-b.uz', 'production_manager', 'production_manager', '${ORG_B_ID}'::uuid, true, 'active'),
      ('${MASTER_A_UID}'::uuid, '${MASTER_A_UID}'::uuid, 'Hasan Master A', 'Hasan Master A', 'master-a@org-a.uz', 'master', 'master', '${ORG_A_ID}'::uuid, true, 'active')
    ON CONFLICT (id) DO NOTHING;

    -- Seed factory configs for Org A (skips 9, 13) and Org B (full pipeline)
    INSERT INTO public.organization_factory_settings (organization_id, disabled_stage_codes, disabled_stage_orders)
    VALUES
      ('${ORG_A_ID}'::uuid, ARRAY['PUMICE', 'ZIRCON']::text[], ARRAY[9, 13]::integer[]),
      ('${ORG_B_ID}'::uuid, ARRAY[]::text[], ARRAY[]::integer[])
    ON CONFLICT (organization_id) DO NOTHING;

    -- Seed initial SAFE inventory for Org A & Org B
    INSERT INTO public.inventory_items (id, name, category, proba, on_hand, quantity_on_hand, reserved, organization_id)
    VALUES
      (gen_random_uuid(), 'Oltin 585 SAFE Org A', 'gold', 585, 500.0000, 500.0000, 0, '${ORG_A_ID}'::uuid),
      (gen_random_uuid(), 'Oltin 750 SAFE Org A', 'gold', 750, 200.0000, 200.0000, 0, '${ORG_A_ID}'::uuid),
      (gen_random_uuid(), 'Oltin 999 SAFE Org A', 'gold', 999, 100.0000, 100.0000, 0, '${ORG_A_ID}'::uuid),
      (gen_random_uuid(), 'Oltin 585 SAFE Org B', 'gold', 585, 300.0000, 300.0000, 0, '${ORG_B_ID}'::uuid);

    -- Seed machine stations for Org A & Org B
    INSERT INTO public.machines (id, name, department, status, organization_id)
    VALUES
      (gen_random_uuid(), 'LASER-01', 'Lazer', 'IDLE', '${ORG_A_ID}'::uuid),
      (gen_random_uuid(), 'CAST-01', 'Quyish', 'IDLE', '${ORG_A_ID}'::uuid),
      (gen_random_uuid(), 'LASER-B-01', 'Lazer', 'IDLE', '${ORG_B_ID}'::uuid);
  `);

  // ==========================================================================
  // PHASE B: MULTI-TENANT SECURITY INTEGRATION TESTS
  // ==========================================================================
  console.log(cyan('\n--- PHASE B: Multi-Tenant Security & Tenant Boundary Tests ---'));

  let batchAId = null;

  await testAssert('Operator A creates a batch in Organization A via RPC', async () => {
    // Manager A fetches the source inventory item ID
    await setContext(db, MGR_A_UID);
    const srcItemRes = await db.query(
      `SELECT id::text FROM public.inventory_items WHERE name = 'Oltin 585 SAFE Org A'`
    );
    const srcId = srcItemRes.rows[0].id;

    // Operator A executes rpc_create_batch_with_gold_issue with named parameters
    await setContext(db, OP_A_UID);
    const res = await db.query(`
      SELECT public.rpc_create_batch_with_gold_issue(
        p_source_item_id := '${srcId}',
        p_batch_no := 'BATCH-A-001',
        p_product_name := 'Zanjir Bismark 585',
        p_master_name := 'Ali Usta',
        p_proba := 585,
        p_planned_qty := 10,
        p_issued_gold_gram := 50.0000,
        p_pure_gold := 29.2500,
        p_priority := 'URGENT',
        p_deadline := CURRENT_DATE + 5,
        p_idempotency_key := 'idemp-batch-a-001'
      ) as result;
    `);
    const val = res.rows[0].result;
    batchAId = val.batch_id;
    if (!val || val.status !== 'ok' || val.issued_gold_gram !== 50) {
      throw new Error(`Unexpected RPC result: ${JSON.stringify(val)}`);
    }
  });

  await testAssert('Operator B CANNOT see Organization A batches (RLS isolation)', async () => {
    await setContext(db, OP_B_UID);
    const res = await db.query(`SELECT count(*)::int as count FROM public.batches WHERE id::text = '${batchAId}'`);
    if (res.rows[0].count !== 0) {
      throw new Error(`Data leakage! Operator B sees Org A batch: count=${res.rows[0].count}`);
    }
  });

  await testAssert('Operator B CANNOT mutate Org A batch directly via UPDATE (RLS check)', async () => {
    await setContext(db, OP_B_UID);
    const res = await db.query(`UPDATE public.batches SET product_name = 'HACKED' WHERE id::text = '${batchAId}' RETURNING *`);
    if (res.rows.length !== 0) {
      throw new Error('RLS bypass: Operator B updated Org A batch!');
    }
  });

  await testAssert('Operator B CANNOT call rpc_move_partial_wip on Org A batch (SECURITY DEFINER guard)', async () => {
    await setContext(db, OP_B_UID);
    let failed = false;
    try {
      await db.query(`
        SELECT public.rpc_move_partial_wip(
          '${batchAId}',
          8, 10, '10. Yig''uv', 'Yig''uv',
          5, 20.0000, 20.0000, 0, 0, 0, 0,
          'Vali Operator B', NULL, 'idemp-hack-001'
        );
      `);
    } catch (err) {
      failed = true;
      if (!err.message.includes('Cross-tenant violation') && !err.message.includes('Batch does not belong to your organization')) {
        throw new Error(`Unexpected error message: ${err.message}`);
      }
    }
    if (!failed) throw new Error('Security Definer breached: Operator B moved Org A WIP!');
  });

  await testAssert('Unauthenticated user is REJECTED from all queries and RPCs (fail-closed)', async () => {
    await setContext(db, null);
    const res = await db.query(`SELECT count(*)::int as count FROM public.batches`);
    if (res.rows[0].count !== 0) throw new Error('Unauthenticated user saw batches!');

    let rpcFailed = false;
    try {
      await db.query(`
        SELECT public.rpc_move_partial_wip(
          '${batchAId}',
          8, 10, '10. Yig''uv', 'Yig''uv',
          1, 5.0, 5.0, 0, 0, 0, 0
        );
      `);
    } catch (err) {
      rpcFailed = true;
    }
    if (!rpcFailed) throw new Error('Unauthenticated user executed RPC without rejection!');
  });

  // ==========================================================================
  // PHASE C: GOLD ACCOUNTING & MASS BALANCE TESTS
  // ==========================================================================
  console.log(cyan('\n--- PHASE C: Gold Accounting, Mass Balance & Loss Enforcement ---'));

  await testAssert('Fine gold equivalent calculations are 100% exact across 585, 750, 999', async () => {
    await setContext(db, OP_A_UID);
    const res585 = await db.query(`SELECT public.calc_fine_gold_exact(100.0000, 585) as fine;`);
    const res750 = await db.query(`SELECT public.calc_fine_gold_exact(100.0000, 750) as fine;`);
    const res999 = await db.query(`SELECT public.calc_fine_gold_exact(100.0000, 999) as fine;`);
    if (Number(res585.rows[0].fine) !== 58.5 || Number(res750.rows[0].fine) !== 75.0 || Number(res999.rows[0].fine) !== 99.9) {
      throw new Error(`Fine gold calculation mismatch: 585=${res585.rows[0].fine}, 750=${res750.rows[0].fine}, 999=${res999.rows[0].fine}`);
    }
  });

  await testAssert('Normal partial WIP move correctly updates outputs and preserves mass balance', async () => {
    await setContext(db, OP_A_UID);
    // Batch has 50g issued. Move 20g, sprue 1g, scrap 0.5g, loss 0.2g (Total 21.7g, remaining 28.3g)
    const res = await db.query(`
      SELECT public.rpc_move_partial_wip(
        '${batchAId}',
        8, 10, '10. Yig''uv', 'Yig''uv',
        4, 20.0000, 20.0000, 0, 1.0000, 0.5000, 0.2000,
        'Ali Usta', NULL, 'idemp-wip-move-001'
      ) as result;
    `);
    const val = res.rows[0].result;
    if (val.status !== 'ok' || Number(val.wip_remaining_gram) !== 28.3) {
      throw new Error(`Mass balance mismatch: remaining=${val.wip_remaining_gram}`);
    }
  });

  await testAssert('Mass balance violation (outputs > issued gold) is strictly rejected', async () => {
    await setContext(db, OP_A_UID);
    let rejected = false;
    try {
      // Trying to move 35g when only 28.3g remaining!
      await db.query(`
        SELECT public.rpc_move_partial_wip(
          '${batchAId}',
          8, 10, '10. Yig''uv', 'Yig''uv',
          6, 35.0000, 35.0000, 0, 0, 0, 0,
          'Ali Usta', NULL, 'idemp-violate-001'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Mass balance violation')) {
        throw new Error(`Unexpected error: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Mass balance breach: gold created out of thin air!');
  });

  await testAssert('Excessive stage loss without override is REJECTED at database level', async () => {
    await setContext(db, OP_A_UID);
    let rejected = false;
    try {
      // In stage 8, allowable loss is 1.0% / max 0.8g. Moving 10g with 2.5g loss (20% loss!)
      await db.query(`
        SELECT public.rpc_move_partial_wip(
          '${batchAId}',
          8, 10, '10. Yig''uv', 'Yig''uv',
          2, 10.0000, 10.0000, 0, 0, 0, 2.5000,
          'Ali Usta', NULL, 'idemp-excess-loss-fail'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('EXCESSIVE_LOSS_DETECTED')) {
        throw new Error(`Expected EXCESSIVE_LOSS_DETECTED, got: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Database allowed silent excessive loss!');
  });

  await testAssert('Operator CANNOT force excessive loss override (Permission Denied)', async () => {
    await setContext(db, OP_A_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_move_partial_wip(
          '${batchAId}',
          8, 10, '10. Yig''uv', 'Yig''uv',
          2, 10.0000, 10.0000, 0, 0, 0, 2.5000,
          'Ali Usta', NULL, 'idemp-excess-loss-op',
          true, 'Operator self override'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Permission denied: Operator role')) {
        throw new Error(`Unexpected error: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Operator was able to override excessive loss!');
  });

  await testAssert('Manager A CAN approve excessive loss override and EXCESSIVE_LOSS_ALERT is logged', async () => {
    await setContext(db, MGR_A_UID);
    const res = await db.query(`
      SELECT public.rpc_move_partial_wip(
        '${batchAId}',
        8, 10, '10. Yig''uv', 'Yig''uv',
        2, 10.0000, 10.0000, 0, 0, 0, 2.5000,
        'Ali Usta', NULL, 'idemp-excess-loss-mgr',
        true, 'Karim Rahbar tasdiqladi: quyishda qolip yorilgan'
      ) as result;
    `);
    if (res.rows[0].result.status !== 'ok') throw new Error('Manager override failed');

    // Check audit_logs table for EXCESSIVE_LOSS_ALERT
    const auditRes = await db.query(`
      SELECT action, reason, new_data
        FROM public.audit_logs
       WHERE record_id = '${batchAId}'
         AND action = 'EXCESSIVE_LOSS_ALERT';
    `);
    if (auditRes.rows.length === 0) throw new Error('Audit log record for EXCESSIVE_LOSS_ALERT not found!');
    if (!auditRes.rows[0].reason.includes('Karim Rahbar tasdiqladi')) {
      throw new Error(`Audit reason mismatch: ${auditRes.rows[0].reason}`);
    }
  });

  await testAssert('Idempotency prevents double withdrawal or double movement on retry', async () => {
    await setContext(db, MGR_A_UID);
    const retryRes = await db.query(`
      SELECT public.rpc_move_partial_wip(
        '${batchAId}',
        8, 10, '10. Yig''uv', 'Yig''uv',
        2, 10.0000, 10.0000, 0, 0, 0, 2.5000,
        'Ali Usta', NULL, 'idemp-excess-loss-mgr',
        true, 'Karim Rahbar tasdiqladi'
      ) as result;
    `);
    if (retryRes.rows[0].result.status !== 'ok') throw new Error('Idempotent retry failed');
  });

  // ==========================================================================
  // PHASE D: REAL MANUFACTURING WORKFLOW & TWO-PARTY HANDOVER
  // ==========================================================================
  console.log(cyan('\n--- PHASE D: Real Manufacturing Workflow & Two-Party Handover ---'));

  let activeHandoverId = null;

  await testAssert('Sender dispatches partial batch into PENDING_ACCEPTANCE', async () => {
    await setContext(db, OP_A_UID);
    const res = await db.query(`
      SELECT public.rpc_dispatch_stage_handover(
        '${batchAId}',
        'BATCH-A-001',
        10, '10. Yig''uv', 'Yig''uv',
        11, '11. Shlifovka', 'Shlifovka',
        '${OP_A_UID}', 'Ali Usta',
        4, 15.0000,
        NULL, NULL, 0.0500,
        'idemp-dispatch-001'
      ) as result;
    `);
    const val = res.rows[0].result;
    if (val.status !== 'PENDING_ACCEPTANCE' || !val.success) {
      throw new Error(`Dispatch failed: ${JSON.stringify(val)}`);
    }
    activeHandoverId = val.handover_id;
  });

  await testAssert('Receiver scale measurement with excess discrepancy (>0.05g) is FLAGGED', async () => {
    await setContext(db, OP_A_UID);
    // Received 14.80g (discrepancy = -0.20g > 0.05g tolerance!)
    const res = await db.query(`
      SELECT public.rpc_accept_stage_handover(
        '${activeHandoverId}',
        '${OP_A_UID}', 'Hasan Qabul Qiluvchi',
        4, 14.8000
      ) as result;
    `);
    const val = res.rows[0].result;
    if (val.status !== 'DISCREPANCY_FLAGGED') {
      throw new Error(`Expected DISCREPANCY_FLAGGED, got: ${JSON.stringify(val)}`);
    }

    // Verify record is marked DISCREPANCY_FLAGGED in table
    const hRes = await db.query(`SELECT status FROM public.two_party_handovers WHERE id = '${activeHandoverId}'`);
    if (hRes.rows[0].status !== 'DISCREPANCY_FLAGGED') {
      throw new Error(`Expected DISCREPANCY_FLAGGED, got: ${hRes.rows[0].status}`);
    }
  });

  await testAssert('Supervisor overrides discrepancy with documented justification', async () => {
    await setContext(db, MGR_A_UID);
    const res = await db.query(`
      SELECT public.rpc_override_stage_handover(
        '${activeHandoverId}',
        '${MGR_A_UID}',
        'Karim Rahbar',
        'Karim Rahbar tasdiqladi: tarozida chang va metall qirindisi hisobga olindi',
        'idemp-override-001'
      ) as result;
    `);
    const val = res.rows[0].result;
    if (!val.success || val.status !== 'SUPERVISOR_OVERRIDDEN') {
      throw new Error(`Override failed: ${JSON.stringify(val)}`);
    }
  });

  // ==========================================================================
  // PHASE E: MACHINE CONCURRENCY & STATION ALLOCATION
  // ==========================================================================
  console.log(cyan('\n--- PHASE E: Machine Concurrency & Atomic Station Locking ---'));

  let machineId = null;
  await testAssert('Operator A assigns IDLE machine station atomically', async () => {
    await setContext(db, OP_A_UID);
    const mRes = await db.query(`SELECT id::text FROM public.machines WHERE name = 'LASER-01'`);
    machineId = mRes.rows[0].id;

    const res = await db.query(`
      SELECT public.rpc_assign_machine_station(
        '${machineId}',
        'BATCH-A-001',
        'Ali Usta'
      ) as result;
    `);
    if (res.rows[0].result.status !== 'ok' || res.rows[0].result.machine_status !== 'BUSY') {
      throw new Error(`Assignment failed: ${JSON.stringify(res.rows[0].result)}`);
    }
  });

  await testAssert('Concurrent assignment of same BUSY station is REJECTED (no double booking)', async () => {
    await setContext(db, OP_A_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_assign_machine_station(
          '${machineId}',
          'BATCH-A-002',
          'Boshqa Usta'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('already occupied by batch')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Machine double booked!');
  });

  await testAssert('Releasing machine station sets status back to IDLE', async () => {
    await setContext(db, OP_A_UID);
    const res = await db.query(`SELECT public.rpc_release_machine_station('${machineId}') as result;`);
    if (res.rows[0].result.status !== 'ok' || res.rows[0].result.machine_status !== 'IDLE') {
      throw new Error(`Release failed: ${JSON.stringify(res.rows[0].result)}`);
    }
  });

  await testAssert('Cross-tenant machine access is strictly blocked', async () => {
    await setContext(db, OP_B_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_assign_machine_station(
          '${machineId}',
          'BATCH-B-001',
          'Vali Usta'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Cross-tenant violation')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Operator B assigned Org A machine!');
  });

  // ==========================================================================
  // PHASE F: SALES, INVENTORY & DEBT REPAYMENT
  // ==========================================================================
  console.log(cyan('\n--- PHASE F: Sales, Finished Goods Stock & Debt Accounting ---'));

  let prodId = null;
  await testAssert('Setup finished product in Org A with stock = 10', async () => {
    await setContext(db, MGR_A_UID);
    const pRes = await db.query(`
      INSERT INTO public.products (name, title, category, weight, proba, stock, quantity, organization_id)
      VALUES ('Uzuk Brilliant 585', 'Uzuk Brilliant 585', 'Uzuk', 4.5000, 585, 10, 10, '${ORG_A_ID}'::uuid)
      RETURNING id::text;
    `);
    prodId = pRes.rows[0].id;
  });

  let saleId = null;
  await testAssert('Sale atomically deducts finished inventory and records customer debt', async () => {
    await setContext(db, MGR_A_UID);
    const res = await db.query(`
      SELECT public.rpc_record_sale_with_stock_deduction(
        '${prodId}',
        'Akmal Zargar',
        'Uzuk Brilliant 585',
        3,
        13.5000,
        585,
        'Qarzga',
        2000000,
        4000000,
        NULL,
        'idemp-sale-001'
      ) as result;
    `);
    const val = res.rows[0].result;
    saleId = val.sale_id;
    if (val.status !== 'ok' || val.remaining_stock !== 7 || Number(val.debt_amount) !== 4000000) {
      throw new Error(`Sale failed: ${JSON.stringify(val)}`);
    }

    // Verify stock is now 7
    const stRes = await db.query(`SELECT stock FROM public.products WHERE id = '${prodId}'`);
    if (stRes.rows[0].stock !== 7) throw new Error(`Stock mismatch: ${stRes.rows[0].stock}`);
  });

  await testAssert('Overselling beyond available stock is REJECTED (no negative inventory)', async () => {
    await setContext(db, MGR_A_UID);
    let rejected = false;
    try {
      // Trying to sell 15 when only 7 left!
      await db.query(`
        SELECT public.rpc_record_sale_with_stock_deduction(
          '${prodId}',
          'Boshqa Mijoz',
          'Uzuk Brilliant 585',
          15,
          67.5000,
          585,
          'Naqd',
          10000000,
          0,
          NULL,
          'idemp-sale-oversell'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Insufficient finished goods stock')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Inventory went negative!');
  });

  await testAssert('Customer debt repayment reduces debt and increases paid total', async () => {
    await setContext(db, MGR_A_UID);
    const res = await db.query(`
      SELECT public.rpc_record_debt_repayment(
        '${saleId}',
        NULL,
        1500000,
        1500000,
        'Naqd pul',
        'Qarz qisman qaytarildi',
        'idemp-repay-001'
      ) as result;
    `);
    const val = res.rows[0].result;
    if (val.status !== 'ok' || Number(val.remaining_debt) !== 2500000 || Number(val.paid_amount) !== 1500000) {
      throw new Error(`Repayment failed: ${JSON.stringify(val)}`);
    }
  });

  await testAssert('Operator B CANNOT access or repay Org A customer debt (cross-tenant violation)', async () => {
    await setContext(db, OP_B_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_record_debt_repayment(
          '${saleId}',
          NULL,
          500000,
          500000,
          'Naqd pul',
          'Hacked payment'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Cross-tenant violation') && !err.message.includes('Permission denied')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Cross-tenant financial tampering succeeded!');
  });

  // ==========================================================================
  // PHASE G: MULTI-TENANT FACTORY SETTINGS PERSISTENCE
  // ==========================================================================
  console.log(cyan('\n--- PHASE G: Multi-Tenant Factory Settings Persistence ---'));

  await testAssert('Retrieve persistent factory settings for Org A (defaults match Goldia)', async () => {
    await setContext(db, MGR_A_UID);
    const res = await db.query(`SELECT public.rpc_get_factory_settings() as result;`);
    const val = res.rows[0].result;
    if (!val.organizationId || val.laserMachinesCount !== 8 || val.castingMachinesCount !== 2) {
      throw new Error(`Settings mismatch: ${JSON.stringify(val)}`);
    }
  });

  await testAssert('Manager A updates Org A settings (sets custom capacities & bypasses)', async () => {
    await setContext(db, MGR_A_UID);
    const res = await db.query(`
      SELECT public.rpc_update_factory_settings(
        ARRAY['PUMICE', 'PONZA', 'ZIRCON']::text[],
        ARRAY[9, 13]::integer[],
        ARRAY['pumice', 'zircon']::text[],
        10,
        3,
        40,
        25,
        12,
        0.04
      ) as result;
    `);
    const val = res.rows[0].result;
    if (val.status !== 'ok' || Number(val.handoverToleranceGram) !== 0.04) {
      throw new Error(`Update settings failed: ${JSON.stringify(val)}`);
    }

    // Verify persistence
    const reRes = await db.query(`SELECT public.rpc_get_factory_settings() as result;`);
    const reVal = reRes.rows[0].result;
    if (reVal.laserMachinesCount !== 10 || reVal.castingMachinesCount !== 3 || Number(reVal.handoverToleranceGram) !== 0.04) {
      throw new Error(`Settings not persisted: ${JSON.stringify(reVal)}`);
    }
  });

  await testAssert('Operator B CANNOT modify Org A factory settings (Permission Denied)', async () => {
    await setContext(db, OP_B_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_update_factory_settings(
          ARRAY[]::text[],
          ARRAY[]::integer[],
          ARRAY[]::text[],
          99,
          99,
          99
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Permission denied')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Operator updated factory settings!');
  });

  // ==========================================================================
  // PHASE H: QUALITY CONTROL DEFECT LOGGING & REWORK ROUTING
  // ==========================================================================
  console.log(cyan('\n--- PHASE H: Quality Control Defect Logging & Rework Routing ---'));

  await testAssert('QC Inspector logs inspection defect into quality_control table and routes rework WIP', async () => {
    await setContext(db, MGR_A_UID);
    const res = await db.query(`
      SELECT public.rpc_record_qc_inspection(
        '${batchAId}',
        'BATCH-A-001',
        'QC Nazorati',
        14,
        20,
        18,
        2,
        'CASTING_POROSITY',
        8,
        'QC Mutaxassis',
        'Quyish g''ovakligi aniqlandi - Quyishga qaytarildi',
        'idemp-qc-001'
      ) as result;
    `);
    const val = res.rows[0].result;
    if (val.status !== 'ok' || val.reworkQty !== 2 || val.targetReworkStage !== 8) {
      throw new Error(`QC inspection failed: ${JSON.stringify(val)}`);
    }

    // Verify record in quality_control table
    const qcRows = await db.query(`
      SELECT * FROM public.quality_control WHERE batch_no = 'BATCH-A-001' AND defect_code = 'CASTING_POROSITY'
    `);
    if (qcRows.rows.length === 0 || qcRows.rows[0].rework_qty !== 2) {
      throw new Error(`QC record not found in table: ${JSON.stringify(qcRows.rows)}`);
    }
  });

  await testAssert('Target rework stage (Casting order 8) receives rework pieces in available_qty', async () => {
    await setContext(db, MGR_A_UID);
    const rwWip = await db.query(`
      SELECT available_qty FROM public.batch_stage_wip WHERE batch_no = 'BATCH-A-001' AND stage_order = 8
    `);
    if (rwWip.rows.length === 0 || rwWip.rows[0].available_qty < 2) {
      throw new Error(`Rework WIP not routed to stage 8: ${JSON.stringify(rwWip.rows)}`);
    }
  });

  await testAssert('Operator B cannot inspect or tamper Org A batch QC (Cross-tenant violation)', async () => {
    await setContext(db, OP_B_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_record_qc_inspection(
          '${batchAId}',
          'BATCH-A-001',
          'Fake QC',
          14,
          20,
          20,
          0
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Cross-tenant violation') && !err.message.includes('Permission denied')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Operator B tampered Org A QC!');
  });

  // ==========================================================================
  // PHASE I: MULTI-TENANT SCHEMA ISOLATION & SEQUENCE COLLISION RESISTANCE
  // ==========================================================================
  console.log(cyan('\n--- PHASE I: Multi-Tenant Schema Isolation & Collision Resistance ---'));

  await testAssert('Org A creates order "ORD-SHARED-001" and batch "BATCH-SHARED-001"', async () => {
    await setContext(db, MGR_A_UID);
    const ordRes = await db.query(`
      SELECT public.rpc_create_order_with_advance(
        p_order_no := 'ORD-SHARED-001',
        p_client_name := 'Mijoz Org A',
        p_product_model := 'Uzuk Klassika',
        p_qty := 5,
        p_weight_gram := 20.0,
        p_total_price := 10000000,
        p_advance := 2000000
      ) as res;
    `);
    if (ordRes.rows[0].res.status !== 'ok') throw new Error('Failed to create Org A order');

    const srcRes = await db.query(`SELECT id::text FROM public.inventory_items WHERE name = 'Oltin 585 SAFE Org A'`);
    const bRes = await db.query(`
      SELECT public.rpc_create_batch_with_gold_issue(
        p_source_item_id := '${srcRes.rows[0].id}',
        p_batch_no := 'BATCH-SHARED-001',
        p_product_name := 'Uzuk Klassika',
        p_master_name := 'Ali Usta',
        p_proba := 585,
        p_planned_qty := 5,
        p_issued_gold_gram := 20.0000,
        p_pure_gold := 11.7000,
        p_priority := 'NORMAL',
        p_deadline := CURRENT_DATE + 5,
        p_idempotency_key := 'b-shared-a-01'
      ) as res;
    `);
    if (bRes.rows[0].res.status !== 'ok') throw new Error('Failed to create Org A batch');
  });

  await testAssert('Org B creates order "ORD-SHARED-001" and batch "BATCH-SHARED-001" with IDENTICAL keys without collision', async () => {
    await setContext(db, MGR_B_UID);
    const ordRes = await db.query(`
      SELECT public.rpc_create_order_with_advance(
        p_order_no := 'ORD-SHARED-001',
        p_client_name := 'Mijoz Org B',
        p_product_model := 'Uzuk Klassika',
        p_qty := 3,
        p_weight_gram := 15.0,
        p_total_price := 7500000,
        p_advance := 1500000
      ) as res;
    `);
    if (ordRes.rows[0].res.status !== 'ok') throw new Error('Failed to create Org B order with shared number');

    const srcRes = await db.query(`SELECT id::text FROM public.inventory_items WHERE name = 'Oltin 585 SAFE Org B'`);
    const bRes = await db.query(`
      SELECT public.rpc_create_batch_with_gold_issue(
        p_source_item_id := '${srcRes.rows[0].id}',
        p_batch_no := 'BATCH-SHARED-001',
        p_product_name := 'Uzuk Klassika',
        p_master_name := 'Vali Usta',
        p_proba := 585,
        p_planned_qty := 3,
        p_issued_gold_gram := 15.0000,
        p_pure_gold := 8.7750,
        p_priority := 'NORMAL',
        p_deadline := CURRENT_DATE + 5,
        p_idempotency_key := 'b-shared-b-01'
      ) as res;
    `);
    if (bRes.rows[0].res.status !== 'ok') throw new Error('Failed to create Org B batch with shared number');
  });

  await testAssert('Org B queries orders and batches and sees ONLY Org B data (0 leakage from Org A)', async () => {
    await setContext(db, MGR_B_UID);
    const ords = await db.query(`SELECT * FROM public.orders WHERE order_no = 'ORD-SHARED-001'`);
    if (ords.rows.length !== 1 || ords.rows[0].client_name !== 'Mijoz Org B') {
      throw new Error(`Data leakage in orders: got ${ords.rows.length} rows`);
    }

    await setContext(db, OP_B_UID);
    const batches = await db.query(`SELECT * FROM public.batches WHERE batch_no = 'BATCH-SHARED-001'`);
    if (batches.rows.length !== 1 || batches.rows[0].organization_id !== ORG_B_ID) {
      throw new Error(`Data leakage in batches: got ${batches.rows.length} rows`);
    }
  });

  await testAssert('Org A and Org B both create product with identical name "Uzuk Klassika" without collision', async () => {
    await setContext(db, MGR_A_UID);
    const pARes = await db.query(`
      SELECT public.rpc_create_product_with_bom(
        p_name := 'Uzuk Klassika 585 Model',
        p_proba := 585,
        p_weight := 4.0
      ) as res;
    `);
    if (pARes.rows[0].res.status !== 'ok') throw new Error('Org A product creation failed');

    await setContext(db, MGR_B_UID);
    const pBRes = await db.query(`
      SELECT public.rpc_create_product_with_bom(
        p_name := 'Uzuk Klassika 585 Model',
        p_proba := 585,
        p_weight := 5.0
      ) as res;
    `);
    if (pBRes.rows[0].res.status !== 'ok') throw new Error('Org B product creation failed with same name');
  });

  // ==========================================================================
  // PHASE J: INVENTORY, ALLOY, AFFINAJ & GOLD ACCOUNTING ISOLATION
  // ==========================================================================
  console.log(cyan('\n--- PHASE J: Inventory, Alloy, Affinaj & Gold Accounting Isolation ---'));

  let orgAItem585Id, orgAItem750Id, orgAItem999Id, orgBItem585Id;
  await testAssert('Setup and verify initial gold inventory items for Org A and Org B', async () => {
    await setContext(db, MGR_A_UID);
    const itemsA = await db.query(`SELECT id::text, name, on_hand FROM public.inventory_items WHERE organization_id = '${ORG_A_ID}'`);
    orgAItem585Id = itemsA.rows.find((r) => r.name === 'Oltin 585 SAFE Org A').id;
    orgAItem750Id = itemsA.rows.find((r) => r.name === 'Oltin 750 SAFE Org A').id;
    orgAItem999Id = itemsA.rows.find((r) => r.name === 'Oltin 999 SAFE Org A').id;

    await setContext(db, MGR_B_UID);
    const itemsB = await db.query(`SELECT id::text, name, on_hand FROM public.inventory_items WHERE organization_id = '${ORG_B_ID}'`);
    orgBItem585Id = itemsB.rows.find((r) => r.name === 'Oltin 585 SAFE Org B').id;

    if (!orgAItem585Id || !orgBItem585Id) throw new Error('Failed to resolve inventory IDs');
  });

  await testAssert('Org B operator CANNOT execute withdrawal (chiqim) on Org A inventory (Cross-tenant violation)', async () => {
    await setContext(db, OP_B_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_inventory_transaction(
          p_item_id := '${orgAItem585Id}',
          p_tx_type := 'chiqim',
          p_weight := 10.0
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Cross-tenant violation') && !err.message.includes('Permission denied')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Org B operator executed withdrawal on Org A inventory!');
  });

  await testAssert('Org A withdrawal exceeding available on-hand gold is rejected (Negative balance guard)', async () => {
    await setContext(db, MGR_A_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_inventory_transaction(
          p_item_id := '${orgAItem585Id}',
          p_tx_type := 'chiqim',
          p_weight := 999999.0
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Insufficient available inventory')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Overselling gold succeeded without error!');
  });

  await testAssert('Org B operator CANNOT execute alloy transaction using Org A gold items', async () => {
    await setContext(db, MGR_B_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_execute_alloy_transaction(
          p_source_item_id := '${orgAItem585Id}',
          p_target_item_id := '${orgBItem585Id}',
          p_input_weight := 10.0,
          p_source_proba := 585,
          p_target_proba := 750,
          p_output_weight := 12.0
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Cross-tenant violation') && !err.message.includes('Permission denied')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Org B executed alloy on Org A gold!');
  });

  await testAssert('Org A executes alloy transaction (585 -> 750) and fine gold mass is conserved', async () => {
    await setContext(db, MGR_A_UID);
    const alloyRes = await db.query(`
      SELECT public.rpc_execute_alloy_transaction(
        p_source_item_id := '${orgAItem585Id}',
        p_target_item_id := '${orgAItem750Id}',
        p_input_weight := 20.0,
        p_source_proba := 585,
        p_target_proba := 750,
        p_output_weight := 25.0,
        p_fine_gold_item_id := '${orgAItem999Id}',
        p_fine_gold_added := 7.05,
        p_idempotency_key := 'alloy-test-01'
      ) as res;
    `);
    const val = alloyRes.rows[0].res;
    if (val.status !== 'ok' || val.output_weight !== 25) {
      throw new Error(`Alloy transaction failed: ${JSON.stringify(val)}`);
    }
  });

  // ==========================================================================
  // PHASE K: PIECEWORK PAYROLL DEDUPLICATION & OVER-ADJUSTMENT GUARDS
  // ==========================================================================
  console.log(cyan('\n--- PHASE K: Piecework Payroll Deduplication & Adjustment Guards ---'));

  let earnedLedgerId = null;

  await testAssert('Unauthorized operator A CANNOT call rpc_calculate_piecework_salary directly without accepted handover', async () => {
    await setContext(db, OP_A_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_calculate_piecework_salary(
          p_worker_name := 'Ali Operator A',
          p_batch_no := 'BATCH-A-001',
          p_stage_name := '8. Quyish (Casting)',
          p_weight_done := 10.0,
          p_rate := 15000.0
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Permission denied')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Operator calculated piecework salary directly!');
  });

  await testAssert('Manager A awards piecework salary for completed stage (10g @ 15,000 UZS/g = 150,000 UZS)', async () => {
    await setContext(db, MGR_A_UID);
    const salRes = await db.query(`
      SELECT public.rpc_calculate_piecework_salary(
        p_worker_name := 'Ali Operator A',
        p_batch_no := 'BATCH-SHARED-001',
        p_stage_name := '8. Quyish (Casting)',
        p_weight_done := 10.0,
        p_rate := 15000.0,
        p_idempotency_key := 'sal-batch-shared-01'
      ) as res;
    `);
    const val = salRes.rows[0].res;
    if (val.status !== 'ok' || val.amount !== 150000 || val.deduplicated !== false) {
      throw new Error(`Salary calculation failed: ${JSON.stringify(val)}`);
    }
    earnedLedgerId = val.ledger_id;
  });

  await testAssert('Duplicate calculation call returns existing ledger record with deduplicated: true (no double salary)', async () => {
    await setContext(db, MGR_A_UID);
    const dupRes = await db.query(`
      SELECT public.rpc_calculate_piecework_salary(
        p_worker_name := 'Ali Operator A',
        p_batch_no := 'BATCH-SHARED-001',
        p_stage_name := '8. Quyish (Casting)',
        p_weight_done := 10.0,
        p_rate := 15000.0,
        p_idempotency_key := 'sal-batch-shared-02'
      ) as res;
    `);
    const val = dupRes.rows[0].res;
    if (val.status !== 'ok' || val.deduplicated !== true || val.ledger_id !== earnedLedgerId) {
      throw new Error(`Deduplication failed: ${JSON.stringify(val)}`);
    }
  });

  await testAssert('Operator A CANNOT adjust piecework salary (Permission Denied)', async () => {
    await setContext(db, OP_A_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_adjust_piecework_salary(
          p_original_ledger_id := '${earnedLedgerId}',
          p_adjustment_amount := 50000.0,
          p_reason := 'Unauthorized penalty'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Permission denied')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Operator adjusted piecework salary!');
  });

  let firstAdjLedgerId = null;
  await testAssert('Manager A adjusts 50,000 UZS with documented justification (100,000 UZS remaining)', async () => {
    await setContext(db, MGR_A_UID);
    const adjRes = await db.query(`
      SELECT public.rpc_adjust_piecework_salary(
        p_original_ledger_id := '${earnedLedgerId}',
        p_adjustment_amount := 50000.0,
        p_reason := 'Qisman nuqson jarimasi (50,000 UZS)',
        p_tx_type := 'ADJUSTMENT',
        p_idempotency_key := 'adj-01'
      ) as res;
    `);
    const val = adjRes.rows[0].res;
    if (val.status !== 'ok' || val.adjusted_amount !== 50000 || val.remaining_balance !== 100000) {
      throw new Error(`Salary adjustment failed: ${JSON.stringify(val)}`);
    }
    firstAdjLedgerId = val.adjustment_ledger_id;
  });

  await testAssert('Manager A attempts to adjust 110,000 UZS (exceeds 100,000 remaining balance) is REJECTED', async () => {
    await setContext(db, MGR_A_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_adjust_piecework_salary(
          p_original_ledger_id := '${earnedLedgerId}',
          p_adjustment_amount := 110000.0,
          p_reason := 'Over-adjustment exceeding balance'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('exceeds remaining adjustable balance')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Over-adjustment succeeded without error!');
  });

  await testAssert('Manager A attempts to adjust an ADJUSTMENT transaction is REJECTED', async () => {
    await setContext(db, MGR_A_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_adjust_piecework_salary(
          p_original_ledger_id := '${firstAdjLedgerId}',
          p_adjustment_amount := 10000.0,
          p_reason := 'Attempt to adjust an adjustment'
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Cannot adjust an adjustment or reversal transaction')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Adjusting an adjustment succeeded without error!');
  });

  // ==========================================================================
  // PHASE L: QC DEFECT REWORK COMPLETION LIFECYCLE
  // ==========================================================================
  console.log(cyan('\n--- PHASE L: QC Defect Rework Completion Lifecycle ---'));

  let createdQcId = null;
  await testAssert('QC Inspector records 2 defective pieces at stage 14 and routes to stage 8 (status: IN_REWORK)', async () => {
    await setContext(db, MGR_A_UID);
    const qcRes = await db.query(`
      SELECT public.rpc_record_qc_inspection(
        '${batchAId}',
        'BATCH-A-001',
        'QC Yakuniy Tekshiruv',
        14,
        20,
        18,
        2,
        'CASTING_POROSITY',
        8,
        'QC Nazoratchi',
        'G''ovaklik aniqlandi, qayta quyishga yuborildi',
        'idemp-qc-rw-01'
      ) as res;
    `);
    const val = qcRes.rows[0].res;
    if (val.status !== 'ok' || val.reworkQty !== 2 || val.qcStatus !== 'IN_REWORK') {
      throw new Error(`QC record failed: ${JSON.stringify(val)}`);
    }
    createdQcId = val.qcId;
  });

  await testAssert('Master A completes rework for defective pieces via rpc_complete_qc_rework', async () => {
    await setContext(db, MASTER_A_UID);
    const compRes = await db.query(`
      SELECT public.rpc_complete_qc_rework(
        p_qc_id := '${createdQcId}',
        p_batch_id := '${batchAId}',
        p_batch_no := 'BATCH-A-001',
        p_rework_stage_order := 8,
        p_inspect_stage_order := 14,
        p_completed_qty := 4,
        p_master_name := 'Hasan Master A',
        p_resolution_notes := 'G''ovak joylar eritilib qayta quyildi va to''g''rilandi',
        p_idempotency_key := 'comp-rw-01'
      ) as res;
    `);
    const val = compRes.rows[0].res;
    if (val.status !== 'ok' || val.completedReworkQty !== 4) {
      throw new Error(`Rework completion failed: ${JSON.stringify(val)}`);
    }
  });

  await testAssert('Rework WIP at stage 8 is decremented, inspection WIP at stage 14 restored, and rework_qty cleared', async () => {
    await setContext(db, MGR_A_UID);
    const inspWip = await db.query(`
      SELECT available_qty, rework_qty FROM public.batch_stage_wip
      WHERE batch_no = 'BATCH-A-001' AND stage_order = 14
    `);
    if (inspWip.rows.length === 0 || inspWip.rows[0].rework_qty !== 0) {
      throw new Error(`Inspection rework_qty was not cleared: ${JSON.stringify(inspWip.rows)}`);
    }

    const qcRow = await db.query(`SELECT status, resolved_by FROM public.quality_control WHERE id = '${createdQcId}'`);
    if (qcRow.rows[0].status !== 'REWORK_COMPLETED' || !qcRow.rows[0].resolved_by.includes('Hasan Master')) {
      throw new Error(`QC record not marked REWORK_COMPLETED: ${JSON.stringify(qcRow.rows)}`);
    }
  });

  await testAssert('Operator B CANNOT complete rework or tamper with Org A QC records (Cross-tenant violation)', async () => {
    await setContext(db, OP_B_UID);
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_complete_qc_rework(
          p_qc_id := '${createdQcId}',
          p_batch_no := 'BATCH-A-001',
          p_completed_qty := 1
        );
      `);
    } catch (err) {
      rejected = true;
      if (!err.message.includes('Cross-tenant violation') && !err.message.includes('Permission denied') && !err.message.includes('not found')) {
        throw new Error(`Unexpected message: ${err.message}`);
      }
    }
    if (!rejected) throw new Error('Operator B tampered with Org A rework completion!');
  });

  // ==========================================================================
  // PHASE M: CONCURRENCY & IDEMPOTENCY STRESS TESTING
  // ==========================================================================
  console.log(cyan('\n--- PHASE M: Concurrency & Idempotency Stress Testing ---'));

  await testAssert('Calling rpc_complete_qc_rework with duplicate idempotency key returns cached result without double decrement', async () => {
    await setContext(db, MASTER_A_UID);
    const dupRes = await db.query(`
      SELECT public.rpc_complete_qc_rework(
        p_qc_id := '${createdQcId}',
        p_batch_id := '${batchAId}',
        p_batch_no := 'BATCH-A-001',
        p_rework_stage_order := 8,
        p_inspect_stage_order := 14,
        p_completed_qty := 4,
        p_master_name := 'Hasan Master A',
        p_resolution_notes := 'G''ovak joylar eritilib qayta quyildi va to''g''rilandi',
        p_idempotency_key := 'comp-rw-01'
      ) as res;
    `);
    const val = dupRes.rows[0].res;
    if (val.status !== 'ok' || val.completedReworkQty !== 4) {
      throw new Error(`Idempotency replay failed: ${JSON.stringify(val)}`);
    }
  });

  // ==========================================================================
  // PHASE N: PRODUCTION-CRITICAL NEGATIVE TESTS & BALANCE INTEGRITY
  // ==========================================================================
  console.log(cyan('\n--- PHASE N: Production-Critical Negative Tests & Balance Integrity ---'));

  await testAssert('Insufficient Gold Guard: Requesting more gold than available in SAFE is rejected and balance is unchanged', async () => {
    await setContext(db, MGR_A_UID);
    const goldBeforeRes = await db.query(`
      SELECT on_hand FROM public.inventory_items WHERE name = 'Oltin 585 SAFE Org A';
    `);
    const initialOnHand = parseFloat(goldBeforeRes.rows[0].on_hand);

    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_inventory_transaction(
          p_item_id := (SELECT id::text FROM public.inventory_items WHERE name = 'Oltin 585 SAFE Org A' LIMIT 1),
          p_tx_type := 'chiqim',
          p_weight := 999999.0000,
          p_proba := 585,
          p_pure_gold := 584999.4150,
          p_from_location := 'SAFE',
          p_to_location := 'EXTERNAL',
          p_description := 'Illegal over-withdrawal attempt'
        );
      `);
    } catch (err) {
      rejected = true;
    }
    if (!rejected) throw new Error('Over-withdrawal was not rejected!');

    const goldAfterRes = await db.query(`
      SELECT on_hand FROM public.inventory_items WHERE name = 'Oltin 585 SAFE Org A';
    `);
    const afterOnHand = parseFloat(goldAfterRes.rows[0].on_hand);
    if (afterOnHand !== initialOnHand) {
      throw new Error(`SAFE gold balance changed! Initial: ${initialOnHand}, After: ${afterOnHand}`);
    }
  });

  await testAssert('Invalid Fineness & Negative Weight Guard: Negative weight is rejected', async () => {
    await setContext(db, MGR_A_UID);
    let rejectedNegative = false;
    try {
      await db.query(`
        SELECT public.rpc_inventory_transaction(
          p_item_id := (SELECT id::text FROM public.inventory_items WHERE name = 'Oltin 585 SAFE Org A' LIMIT 1),
          p_tx_type := 'kirim',
          p_weight := -15.5000,
          p_proba := 585,
          p_pure_gold := -9.0675,
          p_from_location := 'SUPPLIER',
          p_to_location := 'SAFE',
          p_description := 'Negative deposit attempt'
        );
      `);
    } catch (err) {
      rejectedNegative = true;
    }
    if (!rejectedNegative) throw new Error('Negative weight transaction was not rejected!');
  });

  await testAssert('Duplicate Batch Guard: Duplicate batch_no within tenant is rejected by unique constraint', async () => {
    await setContext(db, MGR_A_UID);
    let rejectedDup = false;
    try {
      await db.query(`
        INSERT INTO public.batches (
          id, batch_no, product_name, proba, planned_qty, planned_gram, issued_gold_gram, current_step, organization_id
        ) VALUES (
          gen_random_uuid(), 'BATCH-A-001', 'Uzuk Klassika 585', 585, 10, 50.0, 50.0, '01. Mum / Wax', '${ORG_A_ID}'::uuid
        );
      `);
    } catch (err) {
      rejectedDup = true;
    }
    if (!rejectedDup) throw new Error('Duplicate batch_no was not rejected!');
  });

  await testAssert('Repeated Handover Submission Guard: Duplicate open handover for same stage transition is rejected', async () => {
    await setContext(db, OP_A_UID);
    // Dispatch first handover
    await db.query(`
      SELECT public.rpc_dispatch_stage_handover(
        p_batch_id := '${batchAId}',
        p_batch_no := 'BATCH-A-001',
        p_from_stage_order := 1,
        p_from_stage_name := '01. Mum',
        p_from_department := 'Mum',
        p_to_stage_order := 2,
        p_to_stage_name := '02. Archa',
        p_to_department := 'Mum',
        p_sender_worker_id := '${OP_A_UID}',
        p_sender_worker_name := 'Ali Operator A',
        p_dispatched_qty := 10,
        p_dispatched_weight_gram := 45.5000,
        p_measurement_mode := 'AUTO_SCALE',
        p_is_scale_stable := true,
        p_scale_model := 'CAS XE-300'
      );
    `);

    // Dispatch second duplicate handover while first is still pending
    let rejectedDupHo = false;
    try {
      await db.query(`
        SELECT public.rpc_dispatch_stage_handover(
          p_batch_id := '${batchAId}',
          p_batch_no := 'BATCH-A-001',
          p_from_stage_order := 1,
          p_from_stage_name := '01. Mum',
          p_from_department := 'Mum',
          p_to_stage_order := 2,
          p_to_stage_name := '02. Archa',
          p_to_department := 'Mum',
          p_sender_worker_id := '${OP_A_UID}',
          p_sender_worker_name := 'Ali Operator A',
          p_dispatched_qty := 10,
          p_dispatched_weight_gram := 45.5000,
          p_measurement_mode := 'AUTO_SCALE'
        );
      `);
    } catch (err) {
      if (err.message.includes('allaqachon mavjud')) {
        rejectedDupHo = true;
      }
    }
    if (!rejectedDupHo) throw new Error('Duplicate pending handover was not rejected!');
  });

  await testAssert('Unauthorized Weight Override Guard: Operator cannot override discrepancy without supervisor role', async () => {
    await setContext(db, OP_A_UID);
    const hoRes = await db.query(`
      SELECT id FROM public.two_party_handovers WHERE batch_no = 'BATCH-A-001' AND status = 'PENDING_ACCEPTANCE' LIMIT 1;
    `);
    const hoId = hoRes.rows[0].id;

    let rejectedOverride = false;
    try {
      await db.query(`
        SELECT public.rpc_accept_stage_handover(
          p_handover_id := '${hoId}',
          p_receiver_worker_id := '${OP_A_UID}',
          p_receiver_worker_name := 'Ali Operator A',
          p_received_qty := 9,
          p_received_weight_gram := 40.0000,
          p_supervisor_override_reason := 'Unauthorized override attempt by operator'
        );
      `);
    } catch (err) {
      if (err.message.includes('Only supervisor or manager can override')) {
        rejectedOverride = true;
      }
    }
    if (!rejectedOverride) throw new Error('Operator was able to override discrepancy without supervisor role!');
  });

  await testAssert('Tenant Crossover Guard: Org B manager cannot override or accept Org A handover', async () => {
    await setContext(db, MGR_A_UID);
    const hoRes = await db.query(`
      SELECT id FROM public.two_party_handovers WHERE batch_no = 'BATCH-A-001' AND status = 'PENDING_ACCEPTANCE' LIMIT 1;
    `);
    const hoId = hoRes.rows[0].id;

    await setContext(db, MGR_B_UID);
    let rejectedCrossover = false;
    try {
      await db.query(`
        SELECT public.rpc_accept_stage_handover(
          p_handover_id := '${hoId}',
          p_receiver_worker_id := '${MGR_B_UID}',
          p_receiver_worker_name := 'Sardor Rahbar B',
          p_received_qty := 10,
          p_received_weight_gram := 45.5000
        );
      `);
    } catch (err) {
      if (err.message.includes('Cross-tenant violation')) {
        rejectedCrossover = true;
      }
    }
    if (!rejectedCrossover) throw new Error('Org B manager was able to tamper with Org A handover!');
  });

  await testAssert('QC Re-inspection Lifecycle: Reinspecting reworked QC defects updates QC record to APPROVED', async () => {
    await setContext(db, MGR_A_UID);
    const reinspectRes = await db.query(`
      SELECT public.rpc_reinspect_qc(
        p_qc_id := '${createdQcId}',
        p_passed := true,
        p_notes := 'Tekshirildi: nuqson to''liq bartaraf etilgan'
      ) as res;
    `);
    const res = reinspectRes.rows[0].res;
    if (!res.success || res.status !== 'APPROVED') {
      throw new Error(`QC Reinspection failed: ${JSON.stringify(res)}`);
    }

    const qcRow = await db.query(`
      SELECT status, notes FROM public.quality_control WHERE id::text = '${createdQcId}';
    `);
    if (qcRow.rows[0].status !== 'APPROVED' || !qcRow.rows[0].notes.includes("O'TDI")) {
      throw new Error(`QC record status was not updated to APPROVED: ${JSON.stringify(qcRow.rows[0])}`);
    }
  });

  await testAssert('Repeated QC Rework Completion Guard: Calling rpc_complete_qc_rework when no rework units remain is rejected', async () => {
    await setContext(db, MASTER_A_UID);
    let rejectedNoRework = false;
    try {
      await db.query(`
        SELECT public.rpc_complete_qc_rework(
          p_qc_id := '${createdQcId}',
          p_batch_id := '${batchAId}',
          p_batch_no := 'BATCH-A-001',
          p_rework_stage_order := 8,
          p_inspect_stage_order := 14,
          p_completed_qty := 1,
          p_master_name := 'Hasan Master A',
          p_resolution_notes := 'Should fail because available rework_qty is 0',
          p_idempotency_key := 'comp-rw-extra-fail'
        );
      `);
    } catch (err) {
      if (err.message.includes('Insufficient') || err.message.includes('not in rework') || err.message.includes('status')) {
        rejectedNoRework = true;
      }
    }
    if (!rejectedNoRework) throw new Error('Rework completion succeeded when rework_qty was 0!');
  });

  await testAssert('Over-Repayment Guard: Repaying more than the existing customer debt is rejected', async () => {
    await setContext(db, MGR_A_UID);
    const saleRes = await db.query(`
      SELECT id, debt_amount FROM public.sales WHERE debt_amount > 0 AND organization_id = '${ORG_A_ID}'::uuid LIMIT 1;
    `);
    if (saleRes.rows.length > 0) {
      const saleId = saleRes.rows[0].id;
      const debt = parseFloat(saleRes.rows[0].debt_amount);

      let rejectedOverRepay = false;
      try {
        await db.query(`
          SELECT public.rpc_record_debt_repayment(
            p_sale_id := '${saleId}',
            p_order_id := null,
            p_payment_type := 'Naqd pul',
            p_repaid_amount := ${debt + 500000},
            p_amount := ${debt + 500000},
            p_note := 'Excess repayment attempt'
          );
        `);
      } catch (err) {
        if (err.message.includes('exceeds current debt')) {
          rejectedOverRepay = true;
        }
      }
      if (!rejectedOverRepay) throw new Error('Over-repayment was not rejected!');
    }
  });

  await testAssert('Repeated Sale Submission Guard: Duplicate idempotency key returns cached result without double deducting stock', async () => {
    await setContext(db, MGR_A_UID);
    const prodResBefore = await db.query(`
      SELECT id, stock FROM public.products WHERE organization_id = '${ORG_A_ID}'::uuid AND stock >= 2 LIMIT 1;
    `);
    if (prodResBefore.rows.length > 0) {
      const prodId = prodResBefore.rows[0].id;
      const stockBefore = parseInt(prodResBefore.rows[0].stock, 10);
      const saleKey = 'idemp-sale-dedup-test-' + Date.now();

      // First sale
      await db.query(`
        SELECT public.rpc_record_sale_with_stock_deduction(
          p_product_id := '${prodId}',
          p_client_name := 'Test Client Dedup',
          p_product_name := 'Dedup Product',
          p_quantity := 1,
          p_weight := 5.0,
          p_proba := 585,
          p_payment_type := 'Naqd',
          p_paid_amount := 5000000,
          p_debt_amount := 0,
          p_idempotency_key := '${saleKey}'
        );
      `);

      // Second sale call with duplicate key
      await db.query(`
        SELECT public.rpc_record_sale_with_stock_deduction(
          p_product_id := '${prodId}',
          p_client_name := 'Test Client Dedup',
          p_product_name := 'Dedup Product',
          p_quantity := 1,
          p_weight := 5.0,
          p_proba := 585,
          p_payment_type := 'Naqd',
          p_paid_amount := 5000000,
          p_debt_amount := 0,
          p_idempotency_key := '${saleKey}'
        );
      `);

      const prodResAfter = await db.query(`
        SELECT stock FROM public.products WHERE id = '${prodId}';
      `);
      const stockAfter = parseInt(prodResAfter.rows[0].stock, 10);
      if (stockAfter !== stockBefore - 1) {
        throw new Error(`Stock was double deducted! Before: ${stockBefore}, After: ${stockAfter}`);
      }
    }
  });

  await db.close();

  // Final Summary
  console.log(bold('\n======================================================================'));
  console.log(bold(`MULTI-PHASE REAL DATABASE VERIFICATION COMPLETE`));
  console.log(`Total Scenarios Tested : ${stats.total}`);
  console.log(`Passed                 : ${green(stats.passed)}`);
  console.log(`Failed                 : ${stats.failed === 0 ? green('0') : red(stats.failed)}`);
  console.log(bold('======================================================================\n'));

  if (stats.failed > 0) {
    process.exit(1);
  }
}

runAllVerificationPhases().catch((err) => {
  console.error(red('FATAL ERROR during multi-phase verification:'), err);
  process.exit(1);
});
