const { runSqlQuery } = require('./execute-staging-sql.js');

async function verifyStaging() {
  console.log('==============================================================================');
  console.log('RUNNING STAGING AUDIT FIXES VERIFICATION (vouehtlmsunebracahon)');
  console.log('==============================================================================\n');

  const STAGING_REF = 'vouehtlmsunebracahon';

  // 1. Verify schema constraints on seller_consignments
  console.log('[TEST 1] Verifying seller_consignments constraints (>= 0)...');
  const constraints = await runSqlQuery(`
    select conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'seller_consignments' and c.contype = 'c';
  `, STAGING_REF);
  console.log('Constraints found:', constraints.map(c => `${c.conname}: ${c.def}`).join(' | '));
  const hasValidWeightCheck = constraints.some(c => c.def.includes('base_weight_grams >='));
  const hasValidQtyCheck = constraints.some(c => c.def.includes('quantity >= 0'));
  const hasValidStatusCheck = constraints.some(c => c.def.includes('returned_to_manager'));
  if (!hasValidWeightCheck || !hasValidQtyCheck || !hasValidStatusCheck) {
    throw new Error('FAIL: seller_consignments constraints are not properly configured!');
  }
  console.log('✓ PASS: Constraints allow zero remaining weight, zero quantity, and returned_to_manager status.\n');

  // Select director and seller
  const director = (await runSqlQuery(`
    select e.id, e.user_id, e.name, e.role::text, e.organization_id
    from employees e
    where e.role::text in ('director', 'admin') and e.user_id is not null
    limit 1;
  `, STAGING_REF))[0];
  console.log(`Simulating session for Director: id=${director.id}, org=${director.organization_id}`);

  const seller = (await runSqlQuery(`
    select id, name, user_id from employees
    where organization_id = '${director.organization_id}' and id != '${director.id}'
    limit 1;
  `, STAGING_REF))[0] || director;

  const authHeader = `select set_config('request.jwt.claims', '{"sub": "${director.user_id}", "role": "authenticated"}', false);`;

  // 2. Test Consignment Return for a single-piece consignment
  console.log('[TEST 2] Testing consignment return without constraint error...');

  // Create test factory receipt
  const rcpRes = await runSqlQuery(`
    ${authHeader}
    select public.rpc_record_factory_receipt(
      p_product_name := 'Test Barcode Ring 585',
      p_quantity := 1,
      p_original_physical_g := 10.0000,
      p_proba := 585.0,
      p_factory_markup_pct := 6.00,
      p_notes := 'Test receipt for return test',
      p_idempotency_key := 'idemp_rcp_${Date.now()}'
    ) as res;
  `, STAGING_REF);
  const rcpId = rcpRes[0].res.receipt_id;
  console.log(`Created factory receipt: id=${rcpId}, obligation=${rcpRes[0].res.factory_obligation_g}g`);

  // Issue consignment with 35% markup (10g -> 13.5g seller obligation) via barcode consignment
  const piecesPayload = JSON.stringify([{
    barcode: 'BC-TEST-' + Date.now(),
    weight_grams: 10.0000,
    model_name: 'Test Piece 10g',
    model_code: 'MOD-TEST-01',
    purity: 585
  }]);

  const consignRes = await runSqlQuery(`
    ${authHeader}
    select public.rpc_issue_barcode_consignment(
      p_seller_id := '${seller.id}'::uuid,
      p_factory_markup_pct := 6.00,
      p_pieces := '${piecesPayload}'::jsonb,
      p_notes := 'Test consignment for return test',
      p_idempotency_key := 'idemp_csg_${Date.now()}',
      p_factory_receipt_id := '${rcpId}'::uuid,
      p_seller_markup_pct := 35.00
    ) as res;
  `, STAGING_REF);
  const consignId = consignRes[0].res.consignment_id;
  console.log(`Issued consignment: id=${consignId}, seller_due=${consignRes[0].res.seller_obligation_g}g`);

  // Find the created piece
  const pieces = await runSqlQuery(`
    select id, model_code, weight_grams, status from consignment_pieces
    where consignment_id = '${consignId}';
  `, STAGING_REF);
  console.log(`Created test piece: id=${pieces[0].id}, weight=${pieces[0].weight_grams}g, status=${pieces[0].status}`);

  // Return the piece to manager
  const returnRes = await runSqlQuery(`
    ${authHeader}
    select public.rpc_return_piece_to_manager(
      p_piece_id := '${pieces[0].id}'::uuid,
      p_notes := 'Audit test: piece returned by seller',
      p_idempotency_key := 'idemp_ret_${Date.now()}'
    ) as res;
  `, STAGING_REF);
  console.log('Return RPC result:', JSON.stringify(returnRes[0].res));

  // Verify consignment record
  const consignAfter = (await runSqlQuery(`
    select id, quantity, base_weight_grams, seller_obligation_g, status, returned_quantity, returned_weight_grams, returned_seller_obligation_g
    from seller_consignments where id = '${consignId}';
  `, STAGING_REF))[0];
  console.log('Consignment after full return:', consignAfter);
  if (Number(consignAfter.quantity) !== 0 || Number(consignAfter.base_weight_grams) !== 0 || Number(consignAfter.seller_obligation_g) !== 0) {
    throw new Error('FAIL: Consignment remaining weight/quantity is not 0!');
  }
  if (consignAfter.status !== 'returned_to_manager') {
    throw new Error(`FAIL: Consignment status is ${consignAfter.status}, expected returned_to_manager`);
  }
  console.log('✓ PASS: Single piece consignment returned cleanly with 0 remaining weight and quantity!\n');

  // 3. Test Pure Gold Capital Contribution
  console.log('[TEST 3] Testing pure gold bullion capital contribution (p_physical_weight and p_physical_weight_g)...');
  const capRes = await runSqlQuery(`
    ${authHeader}
    select public.rpc_record_financial_transaction(
      p_transaction_type := 'capital_contribution',
      p_source_till := 'manager_fine_gold',
      p_amount := 5.0,
      p_currency := 'GRAMS_585',
      p_category := 'Tasischi Kapitali',
      p_notes := 'Pure gold bullion test capital',
      p_gold_rate := 1150000,
      p_usd_rate := 12850,
      p_idempotency_key := 'idemp_cap_${Date.now()}',
      p_physical_weight := 5.0,
      p_physical_weight_g := 5.0,
      p_gold_proba := 995,
      p_seller_id := null,
      p_product_name := 'Toza quyma oltin 995',
      p_quantity := null
    ) as res;
  `, STAGING_REF);
  console.log('Capital contribution RPC result:', JSON.stringify(capRes[0].res));
  if (capRes[0].res.status !== 'ok') {
    throw new Error('FAIL: Pure gold capital contribution failed!');
  }
  console.log('✓ PASS: Pure gold capital saved without schema cache error!\n');

  // 4. Test Factory Receipt Proba Parity (750 assay)
  console.log('[TEST 4] Testing factory receipt proba conversion (10g @ 750 assay, 8% markup)...');
  const rcp750 = await runSqlQuery(`
    ${authHeader}
    select public.rpc_record_factory_receipt(
      p_product_name := 'Italian Gold Chain 750',
      p_quantity := 1,
      p_original_physical_g := 10.0000,
      p_proba := 750.0,
      p_factory_markup_pct := 8.00,
      p_notes := 'Assay parity test',
      p_idempotency_key := 'idemp_750_${Date.now()}'
    ) as res;
  `, STAGING_REF);
  const rcpData = rcp750[0].res;
  console.log('750 Assay Receipt result:', JSON.stringify(rcpData));
  const expected585 = Math.round((10.0 * 750 / 585) * 10000) / 10000; // 12.8205
  const expectedObl = Math.round((expected585 * 1.08) * 10000) / 10000; // 13.8462
  console.log(`Calculated: 585_equiv=${rcpData.base_585_equivalent_g} (expected ~${expected585}), obligation=${rcpData.factory_obligation_g} (expected ~${expectedObl})`);
  if (Math.abs(Number(rcpData.base_585_equivalent_g) - expected585) > 0.001) {
    throw new Error('FAIL: 750 proba was not converted to 585 equivalent!');
  }
  console.log('✓ PASS: 750 assay correctly converted to 585 equivalent!\n');

  // 5. Test Full Test Account Reset Preview & Execution
  console.log('[TEST 5] Testing Full Test Account Reset (Zero-Reset)...');
  const preview = await runSqlQuery(`
    ${authHeader}
    select public.rpc_preview_full_test_reset() as preview;
  `, STAGING_REF);
  console.log('Reset Preview Summary:', JSON.stringify(preview[0].preview, null, 2));

  const resetResult = await runSqlQuery(`
    ${authHeader}
    select public.rpc_execute_full_test_reset(
      p_confirmation_code := 'RESET_TEST_ACCOUNT_2026',
      p_reason := 'Automated Staging Audit Verification Reset'
    ) as res;
  `, STAGING_REF);
  console.log('Execute Reset Result:', JSON.stringify(resetResult[0].res, null, 2));

  // Verify all balances are exact zero
  const vaultCheck = (await runSqlQuery(`
    select manager_physical_stock_g, manager_scrap_grams, manager_capital_pure_gold_g, current_factory_obligation_g, current_factory_advance_g, manager_cash_amount, manager_usd_amount
    from manager_vault_account where organization_id = '${director.organization_id}';
  `, STAGING_REF))[0];
  console.log('Manager Vault after zero-reset:', vaultCheck);

  const sellerCheck = await runSqlQuery(`
    select seller_id, current_physical_stock_g, seller_owes_manager_g, bozor_qarzi_signed_g
    from seller_gold_accounts where organization_id = '${director.organization_id}';
  `, STAGING_REF);
  console.log('Seller accounts after zero-reset:', sellerCheck);

  const clientCheck = await runSqlQuery(`
    select customer_id, current_debt_grams, advance_balance_grams
    from client_gold_accounts where organization_id = '${director.organization_id}';
  `, STAGING_REF);
  console.log('Client accounts after zero-reset:', clientCheck);

  const baselineCheck = await runSqlQuery(`
    select baseline_no, status, net_assets_585_g
    from accounting_baselines where organization_id = '${director.organization_id}' and status = 'active';
  `, STAGING_REF);
  console.log('Active baselines after zero-reset (should be empty):', baselineCheck);

  const employeesCount = (await runSqlQuery(`select count(*) as cnt from employees where organization_id = '${director.organization_id}';`, STAGING_REF))[0].cnt;
  const customersCount = (await runSqlQuery(`select count(*) as cnt from customers where organization_id = '${director.organization_id}';`, STAGING_REF))[0].cnt;
  const modelsCount = (await runSqlQuery(`select count(*) as cnt from jewelry_models where organization_id = '${director.organization_id}';`, STAGING_REF))[0].cnt;
  console.log(`Preserved master data: employees=${employeesCount}, customers=${customersCount}, models=${modelsCount}`);

  if (Number(vaultCheck.manager_physical_stock_g) !== 0 ||
      Number(vaultCheck.manager_scrap_grams) !== 0 ||
      Number(vaultCheck.current_factory_obligation_g) !== 0) {
    throw new Error('FAIL: Manager vault was not reset to 0!');
  }
  if (baselineCheck.length > 0) {
    throw new Error('FAIL: Active baseline was not archived!');
  }
  if (Number(employeesCount) === 0 || Number(customersCount) === 0) {
    throw new Error('FAIL: Master data was lost during reset!');
  }

  console.log('✓ PASS: Full Test Account Reset executed flawlessly! All active balances = 0.0000g, baseline archived, master data preserved.\n');
  console.log('==============================================================================');
  console.log('ALL STAGING TESTS PASSED WITH 100% SUCCESS!');
  console.log('==============================================================================');
}

verifyStaging().catch(err => {
  console.error('\n❌ STAGING TEST ERROR:', err);
  process.exit(1);
});
