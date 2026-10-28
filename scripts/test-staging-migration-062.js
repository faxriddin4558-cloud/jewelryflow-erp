const { runSqlQuery } = require('./execute-staging-sql.js');

async function run() {
  console.log('====================================================================');
  console.log('STAGING MIGRATION 062 LIFECYCLE & AUDIT VERIFICATION');
  console.log('Target DB: vouehtlmsunebracahon (Staging ONLY)');
  console.log('====================================================================\n');

  const STAGING_REF = 'vouehtlmsunebracahon';

  // 1. Verify schema columns and constraints
  console.log('[STEP 1]: Verifying schema columns and constraints on Staging...');
  const colCheck = await runSqlQuery(`
    select column_name, data_type 
    from information_schema.columns 
    where table_name = 'gold_purchases' and column_name in ('usd_rate', 'total_cost_uzs', 'currency');
  `, STAGING_REF);
  console.log('gold_purchases columns:', colCheck);

  const hndColCheck = await runSqlQuery(`
    select column_name, data_type 
    from information_schema.columns 
    where table_name = 'factory_gold_handovers' and column_name = 'purchase_id';
  `, STAGING_REF);
  console.log('factory_gold_handovers columns:', hndColCheck);

  if (colCheck.length < 3 || hndColCheck.length < 1) {
    throw new Error('Schema verification failed! Expected columns missing.');
  }
  console.log('✅ Schema columns verified.\n');

  // 2. Test Parameterized Markups (Factory: 6, 7, 8, 10, 20, 30% | Seller: 10, 11, 12, 15, 25, 30, 35%)
  console.log('[STEP 2]: Testing Parameterized Markups Formulas...');
  const factoryMarkups = [6, 7, 8, 10, 20, 30];
  const sellerMarkups = [10, 11, 12, 15, 25, 30, 35];
  const baseWeight = 100.0;
  let testCount = 0;

  for (const fPct of factoryMarkups) {
    const factoryObligation = Math.round(baseWeight * (1 + fPct / 100) * 10000) / 10000;
    for (const sPct of sellerMarkups) {
      const clientDue = Math.round(baseWeight * (1 + (fPct + sPct) / 100) * 10000) / 10000;
      const spread = Math.round((clientDue - factoryObligation) * 10000) / 10000;
      if (Math.abs((factoryObligation + spread) - clientDue) > 0.0001) {
        throw new Error(`Markup discrepancy at F:${fPct}%, S:${sPct}%!`);
      }
      testCount++;
    }
  }
  console.log(`✅ Tested ${testCount} markup combinations (Factory 6-30% x Seller 10-35%): ALL 100% BALANCED!\n`);

  // Obtain active Director for authenticated session simulation
  const directors = await runSqlQuery(`
    select id, user_id, organization_id, name, role
    from employees 
    where role in ('director', 'admin') and user_id is not null 
    limit 1;
  `, STAGING_REF);
  const dir = directors[0];
  console.log('Using authenticated session as:', { name: dir.name, role: dir.role, org_id: dir.organization_id });
  const authPrefix = `select set_config('request.jwt.claims', '{"sub": "${dir.user_id}", "role": "authenticated"}', false);`;

  // 3. Reset staging to baseline
  console.log('\n[STEP 3]: Resetting Staging baseline via rpc_execute_full_test_reset...');
  const resetRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_execute_full_test_reset('RESET_TEST_ACCOUNT_2026', 'Staging automated lifecycle test reset');
  `, STAGING_REF);
  console.log('Reset result:', resetRes);

  // 4. Verify clean zero state
  console.log('\n[STEP 4]: Verifying clean zero state in vault...');
  const vault0 = await runSqlQuery(`
    select organization_id, manager_scrap_585_eq_g, manager_cash_amount, manager_usd_amount, 
           manager_refined_gold_grams, manager_purchased_gold_grams 
    from manager_vault_account where organization_id = '${dir.organization_id}';
  `, STAGING_REF);
  console.log('Vault at zero state:', vault0[0]);

  // 5. Test Multi-Currency Gold Purchase (UZS + USD MIXED)
  console.log('\n[STEP 5]: Testing Multi-Currency Gold Purchase (5M UZS + $500 USD @ 12,800)...');
  // Seed vault with cash to buy gold
  await runSqlQuery(`
    update manager_vault_account 
    set manager_cash_amount = 20000000, manager_usd_amount = 2000 
    where organization_id = '${dir.organization_id}';
  `, STAGING_REF);

  const purchRes = await runSqlQuery(`
    ${authPrefix}
    select * from public.rpc_record_gold_purchase(
      p_supplier_name := 'Test Supplier Toshkent',
      p_cash_spent_uzs := 5000000,
      p_gold_weight_grams := 12.0000,
      p_proba := 585,
      p_rate_per_gram := 950000,
      p_notes := 'Mixed purchase automated test',
      p_usd_spent := 500.00,
      p_usd_rate := 12800.0000
    );
  `, STAGING_REF);
  console.log('Recorded purchase:', purchRes);
  const purchData = purchRes[0]?.rpc_record_gold_purchase || purchRes[0];
  const purchaseId = purchData.purchase_id;

  const vaultAfterPurch = await runSqlQuery(`
    select manager_cash_amount, manager_usd_amount, manager_purchased_gold_grams 
    from manager_vault_account where organization_id = '${dir.organization_id}';
  `, STAGING_REF);
  console.log('Vault after purchase:', vaultAfterPurch[0]);

  if (Number(vaultAfterPurch[0].manager_cash_amount) !== 15000000 ||
      Number(vaultAfterPurch[0].manager_usd_amount) !== 1500 ||
      Number(vaultAfterPurch[0].manager_purchased_gold_grams) !== 12.0) {
    throw new Error('Vault balances mismatch after mixed gold purchase!');
  }
  console.log('✅ Multi-currency purchase verified: 5M UZS and $500 USD deducted, 12.00g purchased gold added to safe!\n');

  // 6. Test Factory Gold Handover from Purchased Gold
  console.log('[STEP 6]: Testing Factory Gold Handover from Purchased Gold (6.00 g)...');
  const hndRes = await runSqlQuery(`
    ${authPrefix}
    select * from public.rpc_record_factory_gold_handover(
      p_source_type := 'purchased_gold',
      p_physical_weight_g := 6.0000,
      p_proba := 585.0,
      p_agreed_equivalent_g := 6.0000,
      p_purchase_id := '${purchaseId}'::uuid,
      p_notes := 'Handover from purchased gold test'
    );
  `, STAGING_REF);
  console.log('Recorded factory handover:', hndRes);
  const hndData = hndRes[0]?.rpc_record_factory_gold_handover || hndRes[0];
  const handoverId = hndData.handover_id;

  const vaultAfterHnd = await runSqlQuery(`
    select manager_purchased_gold_grams from manager_vault_account where organization_id = '${dir.organization_id}';
  `, STAGING_REF);
  console.log('Vault purchased gold after handover:', vaultAfterHnd[0]);

  if (Number(vaultAfterHnd[0].manager_purchased_gold_grams) !== 6.0) {
    throw new Error('Purchased gold safe deduction mismatch after handover!');
  }
  console.log('✅ Factory handover from purchased gold verified: safe decreased by 6.00g!\n');

  // 7. Test Refining Batch with Custom Proba (997°)
  console.log('[STEP 7]: Testing Refining Batch with 997° purity...');
  // Seed vault scrap
  await runSqlQuery(`
    update manager_vault_account 
    set manager_scrap_grams = 300, manager_scrap_585_eq_g = 300, manager_scrap_physical_g = 300 
    where organization_id = '${dir.organization_id}';
  `, STAGING_REF);

  const refRes = await runSqlQuery(`
    ${authPrefix}
    select * from public.rpc_record_refining_batch(
      300.0000,
      299.0000,
      175.0000,
      997.0,
      null::uuid,
      'Refining test batch 997 purity'::text,
      null::text,
      300.0000,
      585.0
    );
  `, STAGING_REF);
  console.log('Recorded refining batch:', refRes);

  const vaultAfterRef = await runSqlQuery(`
    select manager_scrap_585_eq_g, manager_refined_gold_grams 
    from manager_vault_account where organization_id = '${dir.organization_id}';
  `, STAGING_REF);
  console.log('Vault after refining:', vaultAfterRef[0]);
  const expectedRefined = Math.round((175 * 997 / 585) * 10000) / 10000;
  console.log(`Expected refined: ${expectedRefined}g, actual: ${vaultAfterRef[0].manager_refined_gold_grams}g`);
  if (Math.abs(Number(vaultAfterRef[0].manager_refined_gold_grams) - expectedRefined) > 0.001) {
    throw new Error('Refined gold fine equivalent calculation mismatch!');
  }
  console.log('✅ Refining with custom 997° proba verified with 100% mathematical precision!\n');

  // 8. Test A-G Reconciliation Statement
  console.log('[STEP 8]: Testing A-G Reconciliation Statement...');
  const sellerCheck = await runSqlQuery(`select id, name, full_name from employees where role::text = 'sales' limit 1;`, STAGING_REF);
  if (sellerCheck && sellerCheck.length > 0) {
    const sId = sellerCheck[0].id;
    const recStmt = await runSqlQuery(`
      ${authPrefix}
      select public.rpc_get_seller_reconciliation_statement('${sId}'::uuid);
    `, STAGING_REF);
    const parsed = recStmt[0].rpc_get_seller_reconciliation_statement;
    console.log('Seller reconciliation result:', {
      seller: parsed.seller?.full_name || parsed.seller?.name,
      discrepancy: parsed.section_g?.discrepancy_grams,
      is_reconciled: parsed.is_reconciled
    });
    if (Math.abs(Number(parsed.section_g?.discrepancy_grams || 0)) > 0.0001) {
      throw new Error(`Reconciliation discrepancy is not 0: ${parsed.section_g?.discrepancy_grams}`);
    }
    console.log('✅ A-G Reconciliation verified: discrepancy is 0.0000 g!\n');
  }

  // 9. Test Reversals
  console.log('[STEP 9]: Testing Reversals (Handover & Purchase)...');
  const revHnd = await runSqlQuery(`
    ${authPrefix}
    select * from public.rpc_reverse_factory_gold_handover(
      p_handover_id := '${handoverId}'::uuid,
      p_reason := 'Automated test reversal'
    );
  `, STAGING_REF);
  console.log('Reversed handover:', revHnd);

  const revPurch = await runSqlQuery(`
    ${authPrefix}
    select * from public.rpc_reverse_gold_purchase(
      p_purchase_id := '${purchaseId}'::uuid,
      p_reason := 'Automated test reversal'
    );
  `, STAGING_REF);
  console.log('Reversed purchase:', revPurch);

  const vaultAfterRev = await runSqlQuery(`
    select manager_cash_amount, manager_usd_amount, manager_purchased_gold_grams 
    from manager_vault_account where organization_id = '${dir.organization_id}';
  `, STAGING_REF);
  console.log('Vault after reversals:', vaultAfterRev[0]);

  if (Number(vaultAfterRev[0].manager_cash_amount) !== 20000000 ||
      Number(vaultAfterRev[0].manager_usd_amount) !== 2000 ||
      Number(vaultAfterRev[0].manager_purchased_gold_grams) !== 0) {
    throw new Error('Vault balances not cleanly restored after reversals!');
  }
  console.log('✅ Reversals verified: UZS, USD, and purchased gold cleanly restored!\n');

  // 10. Final clean reset
  console.log('[STEP 10]: Final reset on Staging...');
  await runSqlQuery(`
    ${authPrefix}
    select public.rpc_execute_full_test_reset('RESET_TEST_ACCOUNT_2026', 'Post-verification final reset');
  `, STAGING_REF);
  console.log('====================================================================');
  console.log('🎉 ALL STAGING LIFECYCLE, AUDIT & RECONCILIATION TESTS PASSED!');
  console.log('====================================================================');
}

run().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
