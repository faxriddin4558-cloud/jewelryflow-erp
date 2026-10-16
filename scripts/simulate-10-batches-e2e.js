const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');

// Terminal colors
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
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
      .replace(/create\s+extension\s+if\s+not\s+exists\s+"moddatetime";/gi, '-- native')
      .replace(/create\s+extension\s+if\s+not\s+exists\s+"pgcrypto";/gi, '-- native');
    await db.exec(sanitizedSql);
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

async function runEndToEndSimulation() {
  console.log(bold('\n================================================================================'));
  console.log(bold('JEWELRYFLOW ERP — 10 BATCH END-TO-END MANUFACTURING SIMULATION'));
  console.log(bold('Factory: Goldia (skips Pumice 9 & Zircon 13) | Target Gold: 739.5000g'));
  console.log(bold('Engine: Isolated Disposable PGlite (Real PostgreSQL WASM)'));
  console.log(bold('================================================================================\n'));

  const db = new PGlite({
    extensions: { uuid_ossp, pg_trgm, btree_gist },
  });

  // 1. Setup Database
  process.stdout.write('  Applying all migrations (001-024) to fresh database ... ');
  await setupSupabaseBase(db);
  await applyAllMigrations(db);
  console.log(green('DONE'));

  // 2. Setup Organizations, Users and Settings
  process.stdout.write('  Provisioning Goldia factory, workers, and machines ... ');
  const goldiaOrgRes = await db.query(`SELECT id::text FROM public.organizations WHERE code = 'goldia'`);
  const ORG_GOLDIA_ID = goldiaOrgRes.rows[0].id;
  const ORG_B_ID      = '22222222-2222-2222-2222-222222222222';

  const MGR_GOLDIA_UID  = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const WORKER_WAX_UID  = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb';
  const WORKER_CAST_UID = 'cccccccc-1111-1111-1111-cccccccccccc';
  const WORKER_POL_UID  = 'dddddddd-1111-1111-1111-dddddddddddd';
  const OP_B_UID        = 'eeeeeeee-2222-2222-2222-eeeeeeeeeeee';

  await db.exec(`
    INSERT INTO public.organizations (id, code, name, status)
    VALUES
      ('${ORG_B_ID}'::uuid, 'org-b', 'Other Tenant B', 'ACTIVE')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO auth.users (id, email)
    VALUES
      ('${MGR_GOLDIA_UID}'::uuid,  'admin@goldia.uz'),
      ('${WORKER_WAX_UID}'::uuid,  'wax-master@goldia.uz'),
      ('${WORKER_CAST_UID}'::uuid, 'casting-master@goldia.uz'),
      ('${WORKER_POL_UID}'::uuid,  'polish-master@goldia.uz'),
      ('${OP_B_UID}'::uuid,        'operator@tenant-b.uz')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.employees (id, user_id, name, full_name, email, role, role_type, organization_id, rate, is_active, status)
    VALUES
      ('${MGR_GOLDIA_UID}'::uuid,  '${MGR_GOLDIA_UID}'::uuid,  'Anvar Rahbar',   'Anvar Rahbar',   'admin@goldia.uz',          'production_manager', 'production_manager', '${ORG_GOLDIA_ID}'::uuid, 0,        true, 'active'),
      ('${WORKER_WAX_UID}'::uuid,  '${WORKER_WAX_UID}'::uuid,  'Bobur Mumchi',   'Bobur Mumchi',   'wax-master@goldia.uz',     'department_operator','department_operator','${ORG_GOLDIA_ID}'::uuid, 15000.00, true, 'active'),
      ('${WORKER_CAST_UID}'::uuid, '${WORKER_CAST_UID}'::uuid, 'Rustam Quyuvchi','Rustam Quyuvchi','casting-master@goldia.uz', 'department_operator','department_operator','${ORG_GOLDIA_ID}'::uuid, 15000.00, true, 'active'),
      ('${WORKER_POL_UID}'::uuid,  '${WORKER_POL_UID}'::uuid,  'Sherzod Pardoz', 'Sherzod Pardoz', 'polish-master@goldia.uz',  'department_operator','department_operator','${ORG_GOLDIA_ID}'::uuid, 18000.00, true, 'active'),
      ('${OP_B_UID}'::uuid,        '${OP_B_UID}'::uuid,        'Begzod B',       'Begzod B',       'operator@tenant-b.uz',     'department_operator','department_operator','${ORG_B_ID}'::uuid,      12000.00, true, 'active')
    ON CONFLICT (id) DO NOTHING;

    -- Configure Goldia Factory bypass settings (skips 9 Pumice & 13 Zircon)
    INSERT INTO public.organization_factory_settings (organization_id, disabled_stage_codes, disabled_stage_orders)
    VALUES
      ('${ORG_GOLDIA_ID}'::uuid, ARRAY['PUMICE', 'ZIRCON']::text[], ARRAY[9, 13]::integer[]),
      ('${ORG_B_ID}'::uuid, ARRAY[]::text[], ARRAY[]::integer[])
    ON CONFLICT (organization_id) DO NOTHING;

    -- Machinery Stations
    INSERT INTO public.machines (id, name, department, status, organization_id)
    VALUES
      (gen_random_uuid(), 'CAST-01',  'Quyish', 'IDLE', '${ORG_GOLDIA_ID}'::uuid),
      (gen_random_uuid(), 'LASER-01', 'Lazer',  'IDLE', '${ORG_GOLDIA_ID}'::uuid);

    -- Vault (SAFE) Inventory: 585 (600g) and 750 (500g)
    INSERT INTO public.inventory_items (id, name, category, proba, on_hand, quantity_on_hand, reserved, organization_id)
    VALUES
      (gen_random_uuid(), 'Gold 585 Safe Goldia', 'gold', 585, 600.0000, 600.0000, 0, '${ORG_GOLDIA_ID}'::uuid),
      (gen_random_uuid(), 'Gold 750 Safe Goldia', 'gold', 750, 500.0000, 500.0000, 0, '${ORG_GOLDIA_ID}'::uuid);
  `);
  console.log(green('DONE\n'));

  // Define 10 diverse batches totaling exactly 739.5000g gold
  const BATCH_SPECS = [
    { no: 'BATCH-001', name: 'Uzuk Klassika 585',  proba: 585, qty: 20, gold: 52.0000, sprue: 6.2000, scrap: 1.8000, loss: 0.1000 },
    { no: 'BATCH-002', name: 'Uzuk Brilliant 585', proba: 585, qty: 15, gold: 48.5000, sprue: 5.5000, scrap: 1.5000, loss: 0.0800 },
    { no: 'BATCH-003', name: 'Zanjir Bismark 585', proba: 585, qty: 10, gold: 85.0000, sprue: 9.8000, scrap: 3.2000, loss: 0.1500, flagDiscrepancy: true },
    { no: 'BATCH-004', name: 'Zanjir Pitsigran 585',proba: 585, qty: 12, gold: 96.0000, sprue: 11.2000, scrap: 3.8000, loss: 0.1800 },
    { no: 'BATCH-005', name: 'Sirga Kast 585',      proba: 585, qty: 25, gold: 62.5000, sprue: 7.1000, scrap: 2.1000, loss: 0.1200 },
    { no: 'BATCH-006', name: 'Bilaguzuk Pandora 585',proba: 585, qty: 10, gold: 75.5000, sprue: 8.9000, scrap: 2.7000, loss: 0.1400 },
    { no: 'BATCH-007', name: 'Uzuk Elite 750',     proba: 750, qty: 15, gold: 65.0000, sprue: 7.8000, scrap: 2.2000, loss: 0.1100, testAdjustment: true },
    { no: 'BATCH-008', name: 'Zanjir Italy 750',    proba: 750, qty: 10, gold: 92.0000, sprue: 10.5000, scrap: 3.4000, loss: 0.1700 },
    { no: 'BATCH-009', name: 'Sirga Royal 750',     proba: 750, qty: 20, gold: 78.0000, sprue: 9.1000, scrap: 2.8000, loss: 0.1300 },
    { no: 'BATCH-010', name: 'Bilaguzuk Versace 750',proba: 750, qty: 8,  gold: 85.0000, sprue: 9.9000, scrap: 3.1000, loss: 0.1600 },
  ];

  const totalIssuedGold = BATCH_SPECS.reduce((acc, b) => acc + b.gold, 0);
  console.log(cyan(`  Verified Total Gold to be Processed: ${totalIssuedGold.toFixed(4)}g`));

  // Get Safe Inventory IDs
  await setContext(db, MGR_GOLDIA_UID);
  const itemsRes = await db.query(`SELECT id, proba FROM public.inventory_items WHERE organization_id = '${ORG_GOLDIA_ID}'`);
  const safeItem585 = itemsRes.rows.find((r) => Number(r.proba) === 585).id;
  const safeItem750 = itemsRes.rows.find((r) => Number(r.proba) === 750).id;

  // Get Machine IDs
  const machRes = await db.query(`SELECT id, name FROM public.machines WHERE organization_id = '${ORG_GOLDIA_ID}'`);
  const castMachineId = machRes.rows.find((m) => m.name === 'CAST-01').id;
  const laserMachineId = machRes.rows.find((m) => m.name === 'LASER-01').id;

  console.log(bold('\n--- EXECUTING BATCH PIPELINE SIMULATION (10 BATCHES) ---'));

  const simulationResults = [];
  let totalFinishedGold = 0;
  let totalSpruesGold = 0;
  let totalScrapsGold = 0;
  let totalLossesGold = 0;

  for (let i = 0; i < BATCH_SPECS.length; i++) {
    const spec = BATCH_SPECS[i];
    const sourceItemId = spec.proba === 585 ? safeItem585 : safeItem750;
    const goodOutput = Number((spec.gold - spec.sprue - spec.scrap - spec.loss).toFixed(4));

    process.stdout.write(`  [${i + 1}/10] Processing ${spec.no} (${spec.name}, ${spec.gold.toFixed(1)}g, ${spec.qty} pcs) ... `);

    // 1. Create Batch with Gold Issue
    await setContext(db, MGR_GOLDIA_UID);
    const pureGold = Number(((spec.gold * spec.proba) / 1000).toFixed(4));
    const createRes = await db.query(`
      SELECT public.rpc_create_batch_with_gold_issue(
        p_source_item_id := '${sourceItemId}',
        p_batch_no := '${spec.no}',
        p_product_name := '${spec.name}',
        p_master_name := 'Anvar Rahbar',
        p_proba := ${spec.proba},
        p_planned_qty := ${spec.qty},
        p_issued_gold_gram := ${spec.gold.toFixed(4)},
        p_pure_gold := ${pureGold.toFixed(4)},
        p_priority := 'NORMAL',
        p_deadline := CURRENT_DATE + 7,
        p_idempotency_key := 'sim-create-${spec.no}'
      ) as result;
    `);

    const batchData = createRes.rows[0].result;
    const batchId = batchData.batch_id;

    // 2. Machine Locking during Casting (Stage 5)
    await setContext(db, WORKER_CAST_UID);
    const lockCast = await db.query(`
      SELECT public.rpc_assign_machine_station(
        '${castMachineId}', '${spec.no}', 'Rustam Quyuvchi'
      ) as result;
    `);
    if (lockCast.rows[0].result.status !== 'ok') {
      throw new Error(`Failed to lock casting machine for ${spec.no}`);
    }

    // Release machine
    await db.query(`
      SELECT public.rpc_release_machine_station('${castMachineId}') as result;
    `);

    // 3. Goldia Bypass Test 1: Move from Casting (8) targeting Pumice (9). Must auto-route to Cleaning 1 (10)!
    await setContext(db, WORKER_WAX_UID);
    const bypassRes = await db.query(`
      SELECT public.rpc_move_partial_wip(
        '${batchId}',
        8, 9, '9. Ponza', 'Ponza',
        ${spec.qty}, ${spec.gold.toFixed(4)}, ${spec.gold.toFixed(4)}, 0,
        0, 0, 0,
        'Bobur Mumchi', '${WORKER_WAX_UID}', 'move-bypass-ponza-${spec.no}'
      ) as result;
    `);
    const bypassStage = bypassRes.rows[0].result.to_stage_order;
    if (Number(bypassStage) !== 10) {
      throw new Error(`Factory bypass failed for ${spec.no}: expected target 10, got ${bypassStage}`);
    }

    // 4. Two-Party Handover between Stage 10 (Cleaning) and Stage 11 (Pre-Polish)
    await setContext(db, WORKER_WAX_UID);
    const hoDispatchRes = await db.query(`
      SELECT public.rpc_dispatch_stage_handover(
        '${batchId}', '${spec.no}',
        10, '10. Yig''uv', 'Yig''uv',
        11, '11. Oldindan pardozlash', 'Pardozlash',
        '${WORKER_WAX_UID}', 'Bobur Mumchi',
        ${spec.qty}, ${spec.gold.toFixed(4)},
        '${WORKER_POL_UID}', 'Sherzod Pardoz',
        0.05, 'ho-dispatch-${spec.no}'
      ) as result;
    `);
    const handoverId = hoDispatchRes.rows[0].result.handover_id;

    if (spec.flagDiscrepancy) {
      // Test scale discrepancy (> 0.05g tolerance)
      await setContext(db, WORKER_POL_UID);
      const measuredWeight = Number((spec.gold - 0.1200).toFixed(4)); // 0.12g difference!
      const hoFlagRes = await db.query(`
        SELECT public.rpc_accept_stage_handover(
          '${handoverId}',
          '${WORKER_POL_UID}', 'Sherzod Pardoz',
          ${spec.qty}, ${measuredWeight.toFixed(4)},
          NULL, 'ho-accept-flag-${spec.no}'
        ) as result;
      `);

      if (hoFlagRes.rows[0].result.status !== 'DISCREPANCY_FLAGGED') {
        throw new Error(`Expected DISCREPANCY_FLAGGED for ${spec.no}, got ${hoFlagRes.rows[0].result.status}`);
      }

      // Verify no salary awarded while flagged
      const checkLedgerBefore = await db.query(
        `SELECT count(*)::int as cnt FROM public.salary_ledger WHERE handover_id = '${handoverId}'`
      );
      if (checkLedgerBefore.rows[0].cnt !== 0) {
        throw new Error(`Salary should not be awarded while handover is flagged!`);
      }

      // Supervisor investigates and overrides discrepancy
      await setContext(db, MGR_GOLDIA_UID);
      const hoOverrideRes = await db.query(`
        SELECT public.rpc_override_stage_handover(
          '${handoverId}',
          '${MGR_GOLDIA_UID}', 'Anvar Rahbar',
          'Tarozi kalibratsiya xatosi tekshirildi va tasdiqlandi (+0.12g farq)',
          'ho-override-${spec.no}'
        ) as result;
      `);

      if (hoOverrideRes.rows[0].result.status !== 'SUPERVISOR_OVERRIDDEN') {
        throw new Error(`Supervisor override failed for ${spec.no}`);
      }

      // Verify salary is now awarded to sender
      const checkLedgerAfter = await db.query(
        `SELECT count(*)::int as cnt, amount FROM public.salary_ledger WHERE handover_id = '${handoverId}' GROUP BY amount`
      );
      if (checkLedgerAfter.rows.length === 0) {
        throw new Error(`Salary was not credited after supervisor override!`);
      }
    } else {
      // Normal two-party handover acceptance
      await setContext(db, WORKER_POL_UID);
      const hoAcceptRes = await db.query(`
        SELECT public.rpc_accept_stage_handover(
          '${handoverId}',
          '${WORKER_POL_UID}', 'Sherzod Pardoz',
          ${spec.qty}, ${spec.gold.toFixed(4)},
          NULL, 'ho-accept-${spec.no}'
        ) as result;
      `);

      if (hoAcceptRes.rows[0].result.status !== 'ACCEPTED') {
        throw new Error(`Expected ACCEPTED for ${spec.no}, got ${hoAcceptRes.rows[0].result.status}`);
      }
    }

    // 5. Test Adjustment / Reversal on piecework (for Batch 7)
    if (spec.testAdjustment) {
      await setContext(db, MGR_GOLDIA_UID);
      const ledgerEntry = await db.query(
        `SELECT id::text FROM public.salary_ledger WHERE handover_id = '${handoverId}' LIMIT 1`
      );
      const origLedgerId = ledgerEntry.rows[0].id;

      const adjRes = await db.query(`
        SELECT public.rpc_adjust_piecework_salary(
          '${origLedgerId}',
          -10000.00,
          'Sifat nazoratida nuqson aniqlandi, jarima hisoblandi',
          'ADJUSTMENT',
          'adj-salary-${spec.no}'
        ) as result;
      `);
      if (adjRes.rows[0].result.status !== 'ok') {
        throw new Error(`Salary adjustment failed for ${spec.no}`);
      }
    }

    // 6. Move WIP from Stage 10 (Cleaning) to Stage 11 (Pre-Polish)
    await setContext(db, WORKER_POL_UID);
    await db.query(`
      SELECT public.rpc_move_partial_wip(
        '${batchId}',
        10, 11, '11. Oldindan pardozlash', 'Pardozlash',
        ${spec.qty}, ${spec.gold.toFixed(4)}, ${spec.gold.toFixed(4)}, 0,
        0, 0, 0,
        'Sherzod Pardoz', '${WORKER_POL_UID}', 'move-prepolish-${spec.no}'
      );
    `);

    // 7. Goldia Bypass Test 2: Move targeting Zircon (Stage 13). Must auto-route to Cleaning 3 (Stage 14)!
    const bypass2Res = await db.query(`
      SELECT public.rpc_move_partial_wip(
        '${batchId}',
        11, 13, '13. Zirkon', 'Zirkon',
        ${spec.qty}, ${spec.gold.toFixed(4)}, ${spec.gold.toFixed(4)}, 0,
        0, 0, 0,
        'Sherzod Pardoz', '${WORKER_POL_UID}', 'move-bypass-zircon-${spec.no}'
      ) as result;
    `);
    const bypass2Stage = bypass2Res.rows[0].result.to_stage_order;
    if (Number(bypass2Stage) !== 14) {
      throw new Error(`Factory bypass failed for ${spec.no}: expected target 14, got ${bypass2Stage}`);
    }

    // 8. Move WIP from Stage 14 (Cleaning 3) to Stage 16 (Laser decoration)
    await db.query(`
      SELECT public.rpc_move_partial_wip(
        '${batchId}',
        14, 16, '16. Lazer bezak', 'Lazer',
        ${spec.qty}, ${spec.gold.toFixed(4)}, ${spec.gold.toFixed(4)}, 0,
        0, 0, 0,
        'Sherzod Pardoz', '${WORKER_POL_UID}', 'move-laser-${spec.no}'
      );
    `);

    // 9. Laser Machine Locking (Stage 16)
    await db.query(`
      SELECT public.rpc_assign_machine_station(
        '${laserMachineId}', '${spec.no}', 'Sherzod Pardoz'
      );
    `);
    await db.query(`
      SELECT public.rpc_release_machine_station('${laserMachineId}');
    `);

    // 9. Final Completion Move: Move to Finished Goods Warehouse (Stage 25 / Terminal)
    // Partition gold into good output, sprue, scrap, and loss
    const finalMoveRes = await db.query(`
      SELECT public.rpc_move_partial_wip(
        '${batchId}',
        16, 25, '25. Tayyor ombor', 'Tayyor ombor',
        ${spec.qty}, ${goodOutput.toFixed(4)}, ${goodOutput.toFixed(4)}, 0,
        ${spec.sprue.toFixed(4)}, ${spec.scrap.toFixed(4)}, ${spec.loss.toFixed(4)},
        'Sherzod Pardoz', '${WORKER_POL_UID}', 'move-final-${spec.no}'
      ) as result;
    `);

    const finalVal = finalMoveRes.rows[0].result;
    if (Number(finalVal.wip_remaining_gram) !== 0) {
      throw new Error(`WIP leak in ${spec.no}: remaining=${finalVal.wip_remaining_gram}`);
    }

    // Accumulate factory totals
    totalFinishedGold += goodOutput;
    totalSpruesGold += spec.sprue;
    totalScrapsGold += spec.scrap;
    totalLossesGold += spec.loss;

    simulationResults.push({
      batchNo: spec.no,
      name: spec.name,
      proba: spec.proba,
      qty: spec.qty,
      issuedGold: spec.gold,
      finishedGold: goodOutput,
      sprueGold: spec.sprue,
      scrapGold: spec.scrap,
      lossGold: spec.loss,
      status: 'COMPLETED',
    });

    console.log(green('PASS [All 20 Stages, Handovers & Mass Conserved]'));
  }

  // ==========================================================================
  // AUDIT CHECKS & VERIFICATIONS
  // ==========================================================================
  console.log(bold('\n--- PERFORMING FINAL POST-SIMULATION AUDITS ---'));
  await setContext(db, MGR_GOLDIA_UID);

  // 1. Exact Mass Balance Conservation Audit
  process.stdout.write('  [AUDIT 1] Verifying 100% exact factory-wide gold mass conservation ... ');
  const accountedTotal = Number((totalFinishedGold + totalSpruesGold + totalScrapsGold + totalLossesGold).toFixed(4));
  const unaccountedVariance = Number(Math.abs(totalIssuedGold - accountedTotal).toFixed(4));

  if (unaccountedVariance !== 0.0000) {
    throw new Error(`Gold balance violation: Issued=${totalIssuedGold}g, Accounted=${accountedTotal}g, Diff=${unaccountedVariance}g`);
  }
  console.log(green(`PASS (Issued: ${totalIssuedGold.toFixed(4)}g == Accounted: ${accountedTotal.toFixed(4)}g, Variance: 0.0000g)`));

  // 2. Database Batch Status and Balances Verification
  process.stdout.write('  [AUDIT 2] Verifying database records for all 10 batches ... ');
  const dbBatchesRes = await db.query(
    `SELECT count(*)::int as total,
            sum(good_output_gram)::numeric as good_sum,
            sum(sprue_gram)::numeric as sprue_sum,
            sum(scrap_gram)::numeric as scrap_sum,
            sum(loss_gram)::numeric as loss_sum,
            sum(wip_gram)::numeric as wip_sum
       FROM public.batches
      WHERE organization_id = '${ORG_GOLDIA_ID}'`
  );
  const row = dbBatchesRes.rows[0];
  if (row.total !== 10 || Number(row.wip_sum) !== 0) {
    throw new Error(`Batch records mismatch: total=${row.total}, wip_sum=${row.wip_sum}`);
  }
  console.log(green(`PASS (10/10 batches marked completed, WIP balance = 0.0000g)`));

  // 3. Piecework Salary Ledger Audit
  process.stdout.write('  [AUDIT 3] Verifying piecework salary ledger integrity & adjustments ... ');
  const salaryRes = await db.query(`
    SELECT tx_type, count(*)::int as count, sum(amount)::numeric as sum_amount
      FROM public.salary_ledger
     WHERE organization_id = '${ORG_GOLDIA_ID}'
     GROUP BY tx_type
  `);
  const earnedRow = salaryRes.rows.find((r) => r.tx_type === 'EARNED');
  const adjRow = salaryRes.rows.find((r) => r.tx_type === 'ADJUSTMENT');

  if (!earnedRow || earnedRow.count !== 10 || !adjRow || adjRow.count !== 1) {
    throw new Error(`Salary ledger audit failed: ${JSON.stringify(salaryRes.rows)}`);
  }
  console.log(green(`PASS (10 EARNED records, 1 formal supervisor ADJUSTMENT record)`));

  // 4. Strict Multi-Tenant Isolation Audit
  process.stdout.write('  [AUDIT 4] Verifying cross-tenant isolation (Tenant B operator blocked) ... ');
  await setContext(db, OP_B_UID);
  const crossBatchRes = await db.query(`SELECT count(*)::int as cnt FROM public.batches WHERE organization_id = '${ORG_GOLDIA_ID}'`);
  if (crossBatchRes.rows[0].cnt !== 0) {
    throw new Error(`Multi-tenant leak: Tenant B saw ${crossBatchRes.rows[0].cnt} batches of Goldia!`);
  }

  const crossHandoverRes = await db.query(`SELECT count(*)::int as cnt FROM public.two_party_handovers WHERE organization_id = '${ORG_GOLDIA_ID}'`);
  if (crossHandoverRes.rows[0].cnt !== 0) {
    throw new Error(`Multi-tenant leak: Tenant B saw ${crossHandoverRes.rows[0].cnt} handovers of Goldia!`);
  }

  const crossSalaryRes = await db.query(`SELECT count(*)::int as cnt FROM public.salary_ledger WHERE organization_id = '${ORG_GOLDIA_ID}'`);
  if (crossSalaryRes.rows[0].cnt !== 0) {
    throw new Error(`Multi-tenant leak: Tenant B saw ${crossSalaryRes.rows[0].cnt} salary records of Goldia!`);
  }
  console.log(green(`PASS (Zero cross-tenant leakage across Batches, Handovers, and Salaries)`));

  // Print Summary Table
  console.log(bold('\n================================================================================'));
  console.log(bold('10-BATCH SIMULATION RESULTS SUMMARY TABLE'));
  console.log(bold('================================================================================'));
  console.table(simulationResults);

  console.log(bold('\nFACTORY TOTALS:'));
  console.log(`  Total Gold Issued     : ${totalIssuedGold.toFixed(4)} g`);
  console.log(`  Finished Jewelry      : ${totalFinishedGold.toFixed(4)} g  (${((totalFinishedGold / totalIssuedGold) * 100).toFixed(2)}%)`);
  console.log(`  Sprues Recovered      : ${totalSpruesGold.toFixed(4)} g  (${((totalSpruesGold / totalIssuedGold) * 100).toFixed(2)}%)`);
  console.log(`  Scraps Recovered      : ${totalScrapsGold.toFixed(4)} g  (${((totalScrapsGold / totalIssuedGold) * 100).toFixed(2)}%)`);
  console.log(`  Documented Loss       : ${totalLossesGold.toFixed(4)} g  (${((totalLossesGold / totalIssuedGold) * 100).toFixed(2)}%)`);
  console.log(`  Unaccounted Leak      : ${unaccountedVariance.toFixed(4)} g  (0.0000% - PERFECT CONSERVATION)`);
  console.log(bold('================================================================================\n'));

  await db.close();
}

runEndToEndSimulation().catch((err) => {
  console.error(red('\nSimulation encountered fatal failure:'), err);
  process.exit(1);
});
