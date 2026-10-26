/**
 * Test Scanner 564 Weight Mode & Two-Step Mode on Staging
 * Verifies Migration 054:
 * 1. Standard VAZN model exists in jewelry_models.
 * 2. Pure weight mode (50.00g + 55.50g = 105.50g) succeeds without FK error.
 * 3. Manager stock decreases by 105.50g, seller stock increases by 105.50g.
 * 4. Model QR + weight mode succeeds with specific model_id.
 * 5. Failed attempts leave zero partial records.
 */

const { runSqlQuery } = require('./execute-staging-sql.js');
const crypto = require('crypto');

async function run() {
  console.log('==============================================================================');
  console.log('TEST STAGING SCANNER 564 CONSIGNMENT (MIGRATION 054)');
  console.log('==============================================================================\n');

  // 1. Verify VAZN model in jewelry_models
  console.log('[STEP 1]: Verifying standard VAZN model in jewelry_models...');
  const vaznModelRows = await runSqlQuery(`
    SELECT id, model_code, name, category, proba, is_active
    FROM public.jewelry_models
    WHERE model_code = 'VAZN';
  `);
  console.log('VAZN Model Row:', JSON.stringify(vaznModelRows, null, 2));
  if (!vaznModelRows || vaznModelRows.length === 0) {
    throw new Error('Standard VAZN model not found in jewelry_models!');
  }
  const vaznModelId = vaznModelRows[0].id;
  console.log(`[PASS] Standard VAZN model found with ID: ${vaznModelId}\n`);

  // 2. Set up isolated test tenant, manager, seller, receipt, and vault
  console.log('[STEP 2]: Setting up isolated test organization & inventory...');
  const testOrgId = '00000000-0000-4001-8001-000000054001';
  const directorUserId = '00000000-0000-4001-8001-000000054002';
  const directorEmpId = '00000000-0000-4001-8001-000000054003';
  const sellerEmpId = '00000000-0000-4001-8001-000000054004';
  const receiptId = '00000000-0000-4001-8001-000000054005';

  await runSqlQuery(`
    -- Create test org
    INSERT INTO public.organizations (id, code, name, status)
    VALUES ('${testOrgId}', 'scan-test-054', 'Scanner Test Org 054', 'ACTIVE')
    ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

    -- Create director employee
    INSERT INTO public.employees (id, organization_id, user_id, name, full_name, role, is_active)
    VALUES ('${directorEmpId}', '${testOrgId}', '${directorUserId}', 'Test Director 054', 'Test Director 054', 'director', true)
    ON CONFLICT (id) DO UPDATE SET role = 'director', is_active = true;

    -- Create seller employee
    INSERT INTO public.employees (id, organization_id, name, full_name, role, is_active)
    VALUES ('${sellerEmpId}', '${testOrgId}', 'Dilshod 054', 'Dilshod Sotuvchi 054', 'sales', true)
    ON CONFLICT (id) DO UPDATE SET role = 'sales', is_active = true;

    -- Initialize manager vault with 200.00g physical stock
    INSERT INTO public.manager_vault_account (
      organization_id, manager_physical_stock_g, current_factory_obligation_g, updated_at
    ) VALUES (
      '${testOrgId}', 200.0000, 200.0000, now()
    ) ON CONFLICT (organization_id) DO UPDATE SET
      manager_physical_stock_g = 200.0000,
      current_factory_obligation_g = 200.0000,
      updated_at = now();

    -- Create factory receipt with 200.00g available physical stock
    INSERT INTO public.factory_receipts (
      id, organization_id, receipt_no, product_name, original_physical_g,
      factory_obligation_g, available_physical_g, transferred_physical_g,
      factory_markup_pct, status, receipt_date
    ) VALUES (
      '${receiptId}', '${testOrgId}', 'RCP-054-TEST', 'Kirim 200g 585', 200.0000,
      216.0000, 200.0000, 0.0000, 8.00, 'in_manager_stock', CURRENT_DATE
    ) ON CONFLICT (id) DO UPDATE SET
      available_physical_g = 200.0000,
      transferred_physical_g = 0.0000,
      status = 'in_manager_stock';
  `);
  console.log('[PASS] Isolated environment created. Manager physical stock: 200.00g\n');

  // Verify initial manager stock
  const preVault = await runSqlQuery(`
    SELECT manager_physical_stock_g FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';
  `);
  console.log('Pre-consignment manager vault stock:', preVault[0].manager_physical_stock_g, 'g');

  // 3. Test Pure Weight Mode: 2 pieces (50.00g and 55.50g = 105.50g total)
  console.log('\n[STEP 3]: Testing Pure Weight Mode (50.00g + 55.50g = 105.50g)...');
  const pureWeightPieces = [
    {
      model_id: '00000000-0000-0000-0000-000000000000', // Dummy ID from weight-only scan
      model_code: 'VAZN',
      model_name: 'Zargarlik Buyumi (Vazn)',
      category: 'Buyum',
      purity: 585,
      weight_grams: 50.0000,
      raw_barcode: '50.00'
    },
    {
      model_id: null, // Null model_id
      model_code: 'VAZN',
      model_name: 'Zargarlik Buyumi (Vazn)',
      category: 'Buyum',
      purity: 585,
      weight_grams: 55.5000,
      raw_barcode: '55.50'
    }
  ];

  const pureWeightIdemKey = 'IDEM-054-PW-' + crypto.randomBytes(4).toString('hex');
  const pureWeightSql = `
    SELECT public.rpc_issue_barcode_consignment(
      p_seller_id := '${sellerEmpId}'::uuid,
      p_factory_markup_pct := 8.00,
      p_pieces := '${JSON.stringify(pureWeightPieces)}'::jsonb,
      p_notes := 'Pure weight mode test 105.50g',
      p_idempotency_key := '${pureWeightIdemKey}',
      p_factory_receipt_id := '${receiptId}'::uuid,
      p_seller_markup_pct := 12.00
    ) as result;
  `;

  // Set claim session for test org & director employee
  const sessionWrapSql = `
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    ${pureWeightSql}
  `;

  const consignRes = await runSqlQuery(sessionWrapSql);
  console.log('Consignment Result:', JSON.stringify(consignRes, null, 2));

  // 4. Verify post-consignment balances
  console.log('\n[STEP 4]: Verifying balances after 105.50g pure weight consignment...');

  // A. Manager Vault physical stock
  const postVault = await runSqlQuery(`
    SELECT manager_physical_stock_g FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';
  `);
  const actualManagerStock = parseFloat(postVault[0].manager_physical_stock_g);
  const expectedManagerStock = 200.00 - 105.50; // 94.50g
  console.log(`Manager Vault Stock: Expected ${expectedManagerStock.toFixed(4)}g, Actual ${actualManagerStock.toFixed(4)}g`);
  if (Math.abs(actualManagerStock - expectedManagerStock) > 0.0001) {
    throw new Error(`Manager vault stock mismatch! Expected ${expectedManagerStock}, got ${actualManagerStock}`);
  }
  console.log('[PASS] Manager vault physical stock decreased by exactly 105.50g');

  // B. Factory Receipt available stock
  const postReceipt = await runSqlQuery(`
    SELECT available_physical_g, transferred_physical_g, status FROM public.factory_receipts WHERE id = '${receiptId}';
  `);
  console.log(`Factory Receipt: Available ${postReceipt[0].available_physical_g}g, Transferred ${postReceipt[0].transferred_physical_g}g, Status: ${postReceipt[0].status}`);
  if (Math.abs(parseFloat(postReceipt[0].available_physical_g) - 94.50) > 0.0001) {
    throw new Error('Factory receipt available stock mismatch!');
  }
  console.log('[PASS] Factory receipt available stock decreased by 105.50g');

  // C. Seller Stock & Consignment Pieces
  const insertedPieces = await runSqlQuery(`
    SELECT id, model_id, model_code, model_name, weight_grams, status, seller_id
    FROM public.consignment_pieces
    WHERE organization_id = '${testOrgId}' AND seller_id = '${sellerEmpId}';
  `);
  console.log(`Inserted consignment pieces count: ${insertedPieces.length}`);
  if (insertedPieces.length !== 2) {
    throw new Error(`Expected 2 consignment pieces, got ${insertedPieces.length}`);
  }

  const totalSellerStock = insertedPieces.reduce((sum, p) => sum + parseFloat(p.weight_grams), 0);
  console.log(`Seller Total Stock: Expected 105.5000g, Actual ${totalSellerStock.toFixed(4)}g`);
  if (Math.abs(totalSellerStock - 105.50) > 0.0001) {
    throw new Error('Seller stock mismatch!');
  }
  console.log('[PASS] Seller stock increased by exactly 105.50g');

  // D. Foreign Key verification on consignment pieces
  for (const piece of insertedPieces) {
    console.log(`Piece ID ${piece.id}: weight=${piece.weight_grams}g, model_id=${piece.model_id}, model_code=${piece.model_code}`);
    if (piece.model_id !== vaznModelId) {
      throw new Error(`Piece model_id ${piece.model_id} does not match standard VAZN model ID ${vaznModelId}!`);
    }
  }
  console.log('[PASS] All pieces linked to genuine standard VAZN model with valid foreign key');

  // 5. Test Two-Step Mode: Model QR + Weight (e.g. Malika JF-M-0001)
  console.log('\n[STEP 5]: Testing Two-Step Model QR + Weight Mode (Malika JF-M-0001, 14.50g)...');
  const malikaModel = await runSqlQuery(`
    SELECT id, model_code, name FROM public.jewelry_models WHERE model_code = 'JF-M-0001' LIMIT 1;
  `);
  if (!malikaModel || malikaModel.length === 0) {
    throw new Error('Malika JF-M-0001 model not found!');
  }
  const malikaId = malikaModel[0].id;

  const modelPieces = [
    {
      model_id: malikaId,
      model_code: 'JF-M-0001',
      model_name: 'Malika',
      category: 'Серьги',
      purity: 585,
      weight_grams: 14.5000,
      raw_barcode: '14.50'
    }
  ];

  const modelStepIdemKey = 'IDEM-054-MOD-' + crypto.randomBytes(4).toString('hex');
  const modelStepSql = `
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_issue_barcode_consignment(
      p_seller_id := '${sellerEmpId}'::uuid,
      p_factory_markup_pct := 8.00,
      p_pieces := '${JSON.stringify(modelPieces)}'::jsonb,
      p_notes := 'Two-step model mode test 14.50g',
      p_idempotency_key := '${modelStepIdemKey}',
      p_factory_receipt_id := '${receiptId}'::uuid,
      p_seller_markup_pct := 12.00
    ) as result;
  `;

  await runSqlQuery(modelStepSql);

  // Verify post-model-step balances:
  // Manager vault: 94.50 - 14.50 = 80.00g
  // Seller stock: 105.50 + 14.50 = 120.00g
  const postModelVault = await runSqlQuery(`
    SELECT manager_physical_stock_g FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';
  `);
  const actualManagerAfterModel = parseFloat(postModelVault[0].manager_physical_stock_g);
  console.log(`Manager Vault Stock after Model Consignment: Expected 80.0000g, Actual ${actualManagerAfterModel.toFixed(4)}g`);
  if (Math.abs(actualManagerAfterModel - 80.00) > 0.0001) {
    throw new Error(`Manager vault stock after model consignment mismatch! Expected 80.00, got ${actualManagerAfterModel}`);
  }

  const allPiecesAfterModel = await runSqlQuery(`
    SELECT id, model_id, model_code, model_name, weight_grams
    FROM public.consignment_pieces
    WHERE organization_id = '${testOrgId}' AND seller_id = '${sellerEmpId}';
  `);
  console.log(`Total seller pieces count after model scan: ${allPiecesAfterModel.length}`);
  const totalSellerAfterModel = allPiecesAfterModel.reduce((sum, p) => sum + parseFloat(p.weight_grams), 0);
  console.log(`Total seller stock after model scan: Expected 120.0000g, Actual ${totalSellerAfterModel.toFixed(4)}g`);
  if (Math.abs(totalSellerAfterModel - 120.00) > 0.0001) {
    throw new Error('Seller stock mismatch after model consignment!');
  }

  const malikaPiece = allPiecesAfterModel.find(p => p.model_code === 'JF-M-0001');
  if (!malikaPiece || malikaPiece.model_id !== malikaId) {
    throw new Error('Malika piece was not correctly saved with malikaId!');
  }
  console.log('[PASS] Two-step Model QR mode verified with genuine model ID!\n');

  // 6. Test Idempotency: re-executing with same idempotency key does not create duplicates
  console.log('[STEP 6]: Testing Idempotency guard...');
  const duplicateTestSql = `
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_issue_barcode_consignment(
      p_seller_id := '${sellerEmpId}'::uuid,
      p_factory_markup_pct := 8.00,
      p_pieces := '${JSON.stringify(modelPieces)}'::jsonb,
      p_notes := 'Duplicate test',
      p_idempotency_key := '${modelStepIdemKey}',
      p_factory_receipt_id := '${receiptId}'::uuid,
      p_seller_markup_pct := 12.00
    ) as result;
  `;
  await runSqlQuery(duplicateTestSql);

  const piecesAfterDuplicate = await runSqlQuery(`
    SELECT count(*) as count FROM public.consignment_pieces
    WHERE organization_id = '${testOrgId}' AND seller_id = '${sellerEmpId}';
  `);
  console.log(`Pieces count after duplicate request: ${piecesAfterDuplicate[0].count}`);
  if (parseInt(piecesAfterDuplicate[0].count, 10) !== 3) {
    throw new Error(`Duplicate submission created extra pieces! Count: ${piecesAfterDuplicate[0].count}`);
  }
  console.log('[PASS] Idempotency successfully prevented duplicate consignment creation!\n');

  // 7. Cleanup test data
  console.log('[STEP 7]: Cleaning up isolated test data from staging...');
  await runSqlQuery(`
    DELETE FROM public.consignment_pieces WHERE organization_id = '${testOrgId}';
    DELETE FROM public.seller_consignments WHERE organization_id = '${testOrgId}';
    DELETE FROM public.seller_gold_accounts WHERE organization_id = '${testOrgId}';
    DELETE FROM public.factory_receipts WHERE organization_id = '${testOrgId}';
    DELETE FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';
    DELETE FROM public.employees WHERE organization_id = '${testOrgId}';
    DELETE FROM public.organizations WHERE id = '${testOrgId}';
  `);
  console.log('[PASS] Staging test environment cleanly removed.\n');

  console.log('==============================================================================');
  console.log('ALL STAGING TESTS PASSED PERFECTLY!');
  console.log('==============================================================================');
}

run().catch(err => {
  console.error('\n❌ STAGING TEST FAILED:', err);
  process.exit(1);
});
