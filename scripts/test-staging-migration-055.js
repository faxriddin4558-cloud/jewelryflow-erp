/**
 * Comprehensive Staging Verification for Migration 055
 * Tests:
 * 1. Automatic FIFO deduction across active factory receipts when p_factory_receipt_id is NULL.
 * 2. Explicit factory receipt deduction when p_factory_receipt_id is specified.
 * 3. Strict stock insufficiency guard (atomic abort on insufficient manager stock).
 * 4. Idempotency protection (no duplicate stock deduction or pieces).
 * 5. Factory debt independence (internal consignments do not alter factory obligation).
 * 6. Isolated test tenant cleanup.
 */

const { runSqlQuery } = require('./execute-staging-sql.js');

async function testMigration055() {
  console.log('==============================================================================');
  console.log('TEST STAGING MIGRATION 055: FIFO CONSIGNMENT & MANAGER STOCK PARITY');
  console.log('==============================================================================\n');

  const testOrgId = '00000000-0000-4001-8001-000000055001';
  const directorUserId = '00000000-0000-4001-8001-000000055002';
  const directorEmpId = '00000000-0000-4001-8001-000000055003';
  const sellerEmpId = '00000000-0000-4001-8001-000000055004';
  const receiptAId = '00000000-0000-4001-8001-000000055005';
  const receiptBId = '00000000-0000-4001-8001-000000055006';

  // Cleanup any old test artifacts
  await runSqlQuery(`
    DELETE FROM public.consignment_pieces WHERE organization_id = '${testOrgId}';
    DELETE FROM public.seller_consignments WHERE organization_id = '${testOrgId}';
    DELETE FROM public.factory_receipts WHERE organization_id = '${testOrgId}';
    DELETE FROM public.seller_gold_accounts WHERE organization_id = '${testOrgId}';
    DELETE FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';
    DELETE FROM public.employees WHERE organization_id = '${testOrgId}';
    DELETE FROM public.organizations WHERE id = '${testOrgId}';
  `);

  console.log('[STEP 1]: Setting up test tenant with 2 factory receipts (FIFO setup)...');
  await runSqlQuery(`
    INSERT INTO public.organizations (id, code, name, status)
    VALUES ('${testOrgId}', 'fifo-test-055', 'FIFO Test Org 055', 'ACTIVE');

    INSERT INTO public.employees (id, organization_id, user_id, name, full_name, role, is_active)
    VALUES ('${directorEmpId}', '${testOrgId}', '${directorUserId}', 'Dir 055', 'Dir 055', 'director', true);

    INSERT INTO public.employees (id, organization_id, name, full_name, role, is_active)
    VALUES ('${sellerEmpId}', '${testOrgId}', 'Sotuvchi 055', 'Sotuvchi 055', 'sales', true);

    -- Receipt A (Older date: 2026-10-20): 60.00g physical @ 8% markup = 64.80g obligation
    INSERT INTO public.factory_receipts (
      id, organization_id, receipt_no, product_name, original_physical_g,
      factory_obligation_g, available_physical_g, transferred_physical_g,
      factory_markup_pct, status, receipt_date, created_at
    ) VALUES (
      '${receiptAId}', '${testOrgId}', 'RCP-A-055', 'Partiya A 60g', 60.0000,
      64.8000, 60.0000, 0.0000, 8.00, 'in_manager_stock', '2026-10-20', '2026-10-20 10:00:00+00'
    );

    -- Receipt B (Newer date: 2026-10-22): 80.00g physical @ 10% markup = 88.00g obligation
    INSERT INTO public.factory_receipts (
      id, organization_id, receipt_no, product_name, original_physical_g,
      factory_obligation_g, available_physical_g, transferred_physical_g,
      factory_markup_pct, status, receipt_date, created_at
    ) VALUES (
      '${receiptBId}', '${testOrgId}', 'RCP-B-055', 'Partiya B 80g', 80.0000,
      88.0000, 80.0000, 0.0000, 10.00, 'in_manager_stock', '2026-10-22', '2026-10-22 10:00:00+00'
    );

    -- Initialize manager vault account
    INSERT INTO public.manager_vault_account (
      organization_id, manager_physical_stock_g, total_factory_received_g,
      total_factory_obligation_g, current_factory_obligation_g, updated_at
    ) VALUES (
      '${testOrgId}', 140.0000, 140.0000, 152.8000, 152.8000, now()
    ) ON CONFLICT (organization_id) DO UPDATE SET
      manager_physical_stock_g = 140.0000,
      total_factory_received_g = 140.0000,
      total_factory_obligation_g = 152.8000,
      current_factory_obligation_g = 152.8000,
      updated_at = now();
  `);

  console.log('[PASS] Setup complete:');
  console.log('  Receipt A: 60.00g (older)');
  console.log('  Receipt B: 80.00g (newer)');
  console.log('  Total Manager Stock: 140.00g\n');

  // STEP 2: Test Automatic FIFO deduction (100.00g consignment without specifying receipt_id)
  console.log('[STEP 2]: Testing Automatic FIFO Consignment (100.00g: 45g + 55g)...');
  const fifoPieces = [
    {
      model_code: 'VAZN',
      model_name: 'Zargarlik Buyumi (Standart 585)',
      category: 'Buyum',
      purity: 585,
      weight_grams: 45.0000,
      raw_barcode: '45.00'
    },
    {
      model_code: 'VAZN',
      model_name: 'Zargarlik Buyumi (Standart 585)',
      category: 'Buyum',
      purity: 585,
      weight_grams: 55.0000,
      raw_barcode: '55.00'
    }
  ];

  const fifoRes = await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_issue_barcode_consignment(
      '${sellerEmpId}'::uuid,
      8.00::numeric,
      '${JSON.stringify(fifoPieces)}'::jsonb,
      'FIFO Test Consignment'::text,
      'idemp-fifo-055-1'::text,
      NULL::uuid,
      12.00::numeric
    ) as result;
  `);

  console.log('FIFO Consignment Result:', JSON.stringify(fifoRes, null, 2));

  // Verify Receipt A: must be fully transferred (60g deducted, 0g remaining)
  const [rcpA] = await runSqlQuery(`SELECT available_physical_g, transferred_physical_g, status FROM public.factory_receipts WHERE id = '${receiptAId}';`);
  console.log('Receipt A post-FIFO:', rcpA);
  if (Number(rcpA.available_physical_g) !== 0 || Number(rcpA.transferred_physical_g) !== 60 || rcpA.status !== 'fully_transferred') {
    throw new Error(`Receipt A mismatch! Expected avail=0, transferred=60. Got: ${JSON.stringify(rcpA)}`);
  }

  // Verify Receipt B: must be partially transferred (40g deducted, 40g remaining)
  const [rcpB] = await runSqlQuery(`SELECT available_physical_g, transferred_physical_g, status FROM public.factory_receipts WHERE id = '${receiptBId}';`);
  console.log('Receipt B post-FIFO:', rcpB);
  if (Number(rcpB.available_physical_g) !== 40 || Number(rcpB.transferred_physical_g) !== 40 || rcpB.status !== 'partially_transferred') {
    throw new Error(`Receipt B mismatch! Expected avail=40, transferred=40. Got: ${JSON.stringify(rcpB)}`);
  }

  // Verify Manager Vault: must be exactly 40.00g (140 - 100 = 40)
  const [vault1] = await runSqlQuery(`SELECT manager_physical_stock_g, current_factory_obligation_g FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';`);
  console.log('Manager Vault post-FIFO:', vault1);
  if (Number(vault1.manager_physical_stock_g) !== 40) {
    throw new Error(`Manager vault stock mismatch! Expected 40. Got: ${vault1.manager_physical_stock_g}`);
  }
  // Factory obligation must NOT be changed!
  if (Number(vault1.current_factory_obligation_g) !== 152.8) {
    throw new Error(`Factory obligation changed! Expected 152.8. Got: ${vault1.current_factory_obligation_g}`);
  }

  // Verify Seller Stock: must be exactly 100.00g
  const [seller1] = await runSqlQuery(`SELECT current_physical_stock_g, total_seller_obligation_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';`);
  console.log('Seller Account post-FIFO:', seller1);
  if (Number(seller1.current_physical_stock_g) !== 100) {
    throw new Error(`Seller stock mismatch! Expected 100. Got: ${seller1.current_physical_stock_g}`);
  }

  console.log('[PASS] Automatic FIFO Consignment passed with 100% mathematical precision!\n');

  // STEP 3: Test Explicit Receipt Deduction (25.00g from Receipt B)
  console.log('[STEP 3]: Testing Explicit Receipt Consignment (25.00g from Receipt B)...');
  const explicitPiece = [
    {
      model_code: 'VAZN',
      model_name: 'Standart 585',
      category: 'Buyum',
      purity: 585,
      weight_grams: 25.0000,
      raw_barcode: '25.00'
    }
  ];

  await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_issue_barcode_consignment(
      '${sellerEmpId}'::uuid,
      10.00::numeric,
      '${JSON.stringify(explicitPiece)}'::jsonb,
      'Explicit Receipt Test'::text,
      'idemp-explicit-055-1'::text,
      '${receiptBId}'::uuid,
      12.00::numeric
    );
  `);

  const [rcpB2] = await runSqlQuery(`SELECT available_physical_g, transferred_physical_g FROM public.factory_receipts WHERE id = '${receiptBId}';`);
  console.log('Receipt B post-explicit:', rcpB2);
  if (Number(rcpB2.available_physical_g) !== 15 || Number(rcpB2.transferred_physical_g) !== 65) {
    throw new Error(`Receipt B mismatch! Expected avail=15, transferred=65. Got: ${JSON.stringify(rcpB2)}`);
  }

  const [vault2] = await runSqlQuery(`SELECT manager_physical_stock_g FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';`);
  console.log('Manager Vault post-explicit:', vault2);
  if (Number(vault2.manager_physical_stock_g) !== 15) {
    throw new Error(`Manager vault stock mismatch! Expected 15. Got: ${vault2.manager_physical_stock_g}`);
  }

  const [seller2] = await runSqlQuery(`SELECT current_physical_stock_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';`);
  console.log('Seller Stock post-explicit:', seller2);
  if (Number(seller2.current_physical_stock_g) !== 125) {
    throw new Error(`Seller stock mismatch! Expected 125. Got: ${seller2.current_physical_stock_g}`);
  }
  console.log('[PASS] Explicit receipt consignment passed!\n');

  // STEP 4: Test Stock Insufficiency Guard (attempting 50.00g when only 15.00g available)
  console.log('[STEP 4]: Testing Stock Insufficiency Guard (attempting 50.00g with 15.00g stock)...');
  const excessivePieces = [
    {
      model_code: 'VAZN',
      model_name: 'Standart 585',
      category: 'Buyum',
      purity: 585,
      weight_grams: 50.0000,
      raw_barcode: '50.00'
    }
  ];

  let guardTriggered = false;
  try {
    await runSqlQuery(`
      SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
      SELECT public.rpc_issue_barcode_consignment(
        '${sellerEmpId}'::uuid,
        8.00::numeric,
        '${JSON.stringify(excessivePieces)}'::jsonb,
        'Excessive consignment'::text,
        'idemp-excessive-055'::text,
        NULL::uuid,
        12.00::numeric
      );
    `);
  } catch (err) {
    guardTriggered = true;
    console.log('Expected guard error successfully caught:', err.message || err);
  }

  if (!guardTriggered) {
    throw new Error('Insufficiency guard FAILED to trigger for 50g transfer on 15g stock!');
  }

  // Verify stock remained strictly 15.00g (atomic rollback)
  const [vaultPostGuard] = await runSqlQuery(`SELECT manager_physical_stock_g FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';`);
  if (Number(vaultPostGuard.manager_physical_stock_g) !== 15) {
    throw new Error(`Atomic rollback failed! Vault stock altered to ${vaultPostGuard.manager_physical_stock_g}`);
  }
  console.log('[PASS] Insufficiency guard triggered and atomic rollback verified!\n');

  // STEP 5: Test Idempotency
  console.log('[STEP 5]: Testing Idempotency Protection...');
  const idempPiece = [
    {
      model_code: 'VAZN',
      model_name: 'Standart 585',
      category: 'Buyum',
      purity: 585,
      weight_grams: 5.0000,
      raw_barcode: '5.00'
    }
  ];

  const firstCall = await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_issue_barcode_consignment(
      '${sellerEmpId}'::uuid,
      8.00::numeric,
      '${JSON.stringify(idempPiece)}'::jsonb,
      'Idempotency test'::text,
      'idemp-repeat-055-unique'::text,
      NULL::uuid,
      12.00::numeric
    ) as res;
  `);

  const secondCall = await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_issue_barcode_consignment(
      '${sellerEmpId}'::uuid,
      8.00::numeric,
      '${JSON.stringify(idempPiece)}'::jsonb,
      'Idempotency test'::text,
      'idemp-repeat-055-unique'::text,
      NULL::uuid,
      12.00::numeric
    ) as res;
  `);

  // Vault should have decreased by 5.00g ONCE (15 - 5 = 10), not twice
  const [vaultIdemp] = await runSqlQuery(`SELECT manager_physical_stock_g FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';`);
  console.log('Vault after duplicate calls:', vaultIdemp.manager_physical_stock_g);
  if (Number(vaultIdemp.manager_physical_stock_g) !== 10) {
    throw new Error(`Idempotency failed! Vault stock is ${vaultIdemp.manager_physical_stock_g}, expected 10`);
  }
  console.log('[PASS] Idempotency duplicate call successfully blocked!\n');

  // Clean up test tenant
  console.log('[STEP 6]: Cleaning up isolated test tenant...');
  await runSqlQuery(`
    DELETE FROM public.consignment_pieces WHERE organization_id = '${testOrgId}';
    DELETE FROM public.seller_consignments WHERE organization_id = '${testOrgId}';
    DELETE FROM public.factory_receipts WHERE organization_id = '${testOrgId}';
    DELETE FROM public.seller_gold_accounts WHERE organization_id = '${testOrgId}';
    DELETE FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';
    DELETE FROM public.employees WHERE organization_id = '${testOrgId}';
    DELETE FROM public.organizations WHERE id = '${testOrgId}';
  `);
  console.log('[PASS] Test tenant cleaned up completely.\n');

  console.log('==============================================================================');
  console.log('ALL MIGRATION 055 STAGING TESTS PASSED (100% VERIFIED)');
  console.log('==============================================================================');
}

testMigration055().catch((err) => {
  console.error('Migration 055 test failed:', err);
  process.exit(1);
});
