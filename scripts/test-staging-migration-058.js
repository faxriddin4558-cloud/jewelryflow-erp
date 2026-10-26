/**
 * JEWELRYFLOW / GOLDIA SALES — STAGING TEST SUITE FOR MIGRATION 058
 * Target Database: Staging (vouehtlmsunebracahon)
 * 
 * Tests the entire lifecycle:
 * 1. Capital Injection (Pure Gold @ 995 proba) -> Vault Manager Safe ("Kapital kirimi").
 * 2. Factory Receipt -> Establishes initial factory debt.
 * 3. Over-Handover of Capital Gold -> Clears debt to 0g, accumulates "Zavoddagi avans / bizning haqdorligimiz" (excess not clamped).
 * 4. Profit & Net Assets Neutrality -> Handover of gold in excess of debt is an asset transformation (gold -> gold receivable), 0.0000g profit.
 * 5. Subsequent Factory Receipts -> Absorbs factory advance before accumulating debt.
 * 6. Partial / Exhausting Receipts -> Advance goes to 0g, excess becomes current debt.
 * 7. Reversals -> Reversing receipts and handovers atomically restores safe gold, debt, and advance with audit logs.
 */

const { runSqlQuery } = require('./execute-staging-sql.js');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function test() {
  console.log('==============================================================================');
  console.log('STARTING STAGING MIGRATION 058 VERIFICATION: CAPITAL PURE GOLD & FACTORY ADVANCE');
  console.log('==============================================================================\n');

  const runId = Math.floor(Math.random() * 899999 + 100000).toString();
  const testOrgId = `00000000-0000-4001-8001-000000${runId}`;
  const directorUserId = `00000000-0000-4001-8002-000000${runId}`;
  const directorEmpId = `00000000-0000-4001-8003-000000${runId}`;
  const sellerEmpId = `00000000-0000-4001-8004-000000${runId}`;

  const jwtHeader = `SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';`;

  // Step 0: Apply Migration 058 to Staging
  console.log('--- Step 0: Apply Migration 058 to Staging ---');
  const fs = require('fs');
  const path = require('path');
  const migration058Sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260101000058_goldia_factory_advance_and_capital_linking.sql'), 'utf-8');
  await runSqlQuery(migration058Sql);
  console.log('✅ Migration 058 applied to Staging successfully.\n');

  // Step 1: Setup isolated test tenant
  console.log('--- Step 1: Setup Isolated Test Tenant ---');
  await runSqlQuery(`
    INSERT INTO public.organizations (id, code, name, status)
    VALUES ('${testOrgId}', 'advance-058-${runId}', 'Advance 058 Org ${runId}', 'ACTIVE');

    INSERT INTO public.employees (id, organization_id, user_id, name, full_name, role, is_active)
    VALUES ('${directorEmpId}', '${testOrgId}', '${directorUserId}', 'Dir 058', 'Dir 058', 'director', true);

    INSERT INTO public.employees (id, organization_id, name, full_name, role, is_active)
    VALUES ('${sellerEmpId}', '${testOrgId}', 'Sotuvchi 058', 'Sotuvchi 058', 'sales', true);

    INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, is_confirmed)
    VALUES ('${testOrgId}', (timezone('Asia/Tashkent', now()))::date, 585, 900000, true)
    ON CONFLICT (organization_id, rate_date, proba) DO UPDATE SET rate_per_gram = 900000, is_confirmed = true;

    SELECT public._get_or_create_manager_vault('${testOrgId}');
  `);
  console.log('✅ Fresh tenant initialized.\n');

  // Step 2: Inject Pure Gold Capital (100g @ 995 proba)
  console.log('--- Step 2: Inject Pure Gold Capital (100g @ 995 proba) ---');
  // 100g @ 995: 585 eq = 100 * (995/585) = 170.0855g. Fine g = 100 * (995/1000) = 99.5000g.
  const capRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_financial_transaction(
      'capital_contribution',
      'manager_fine_gold',
      100.0000,
      'FINE_GOLD',
      'Ta''sischi hissasi',
      'Ta''sischi 100g toza oltin kiritdi',
      900000,
      12800,
      'T058_CAP_' || gen_random_uuid(),
      100.0000,
      995.0
    );
  `);
  console.log('Capital Tx Res:', capRes);
  const capTxId = capRes[0]?.rpc_record_financial_transaction?.id || capRes[0]?.id;

  const vaultAfterCap = await runSqlQuery(`
    SELECT manager_capital_pure_gold_g, manager_capital_pure_gold_fine_g, current_factory_advance_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Capital:', vaultAfterCap);
  assert(Math.abs(Number(vaultAfterCap[0].manager_capital_pure_gold_g) - 170.0855) < 0.001, 'manager_capital_pure_gold_g must be 170.0855g');
  assert(Math.abs(Number(vaultAfterCap[0].manager_capital_pure_gold_fine_g) - 99.5000) < 0.001, 'manager_capital_pure_gold_fine_g must be 99.5000g');
  assert(Number(vaultAfterCap[0].current_factory_advance_g) === 0, 'current_factory_advance_g must be 0 initially');
  console.log('✅ PASS: Pure gold capital deposited correctly.\n');

  // Step 3: Establish Initial Factory Debt (50g @ 585 + 8% markup -> 54.0000g obligation)
  console.log('--- Step 3: Factory Receipt -> Initial Debt ---');
  const rcp1Res = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_factory_receipt(
      p_product_name := 'Test Tovar 1',
      p_quantity := 5,
      p_original_physical_g := 50.0000,
      p_proba := 585.0,
      p_factory_markup_pct := 8.0,
      p_notes := 'Initial factory receipt'
    );
  `);
  console.log('Receipt 1 Res:', rcp1Res);

  const vaultAfterRcp1 = await runSqlQuery(`
    SELECT total_factory_obligation_g, total_factory_handed_over_g, current_factory_obligation_g, current_factory_advance_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Receipt 1:', vaultAfterRcp1);
  assert(Math.abs(Number(vaultAfterRcp1[0].current_factory_obligation_g) - 54.0000) < 0.001, 'Current factory obligation must be 54.0000g');
  assert(Number(vaultAfterRcp1[0].current_factory_advance_g) === 0, 'Current factory advance must be 0g');
  console.log('✅ PASS: Factory debt established at 54.0000g.\n');

  // Step 4: Negative Test: Attempt to handover 150g pure gold when vault only has 100g
  console.log('--- Step 4: Negative Test: Over-handover from Safe Capital ---');
  let overSafeBlocked = false;
  try {
    await runSqlQuery(`
      ${jwtHeader}
      SELECT public.rpc_record_factory_gold_handover(
        'capital_pure_gold',
        150.0000,
        995.0,
        null,
        'Zavod 1',
        'Over safe attempt',
        'T058_OVERSAFE_' || gen_random_uuid(),
        ${capTxId ? `'${capTxId}'` : 'null'}
      );
    `);
  } catch (err) {
    overSafeBlocked = true;
    console.log('Handover blocked as expected with error:', err.message);
    assert(err.message.includes('ERR_INSUFFICIENT_CAPITAL_GOLD') || err.message.includes('yetarli emas'), 'Must contain ERR_INSUFFICIENT_CAPITAL_GOLD');
  }
  assert(overSafeBlocked, 'Over-handover from safe must be blocked');
  console.log('✅ PASS: Insufficient safe capital properly blocked.\n');

  // Step 5: Over-handover to Factory: Hand over 80g pure gold @ 995 proba (136.0684g 585 eq)
  // Current debt = 54.0000g. Handover = 136.0684g.
  // Excess = 136.0684 - 54.0000 = 82.0684g -> Stored in current_factory_advance_g!
  console.log('--- Step 5: Over-handover of Pure Gold Capital -> Factory Advance ---');
  const hnd1Res = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_factory_gold_handover(
      'capital_pure_gold',
      80.0000,
      995.0,
      null,
      'Zavod Qabul Qiluvchi',
      'Over-handover creates advance',
      'T058_HND1_' || gen_random_uuid(),
      ${capTxId ? `'${capTxId}'` : 'null'}
    );
  `);
  console.log('Handover 1 Res:', hnd1Res);
  const hnd1Data = hnd1Res[0]?.rpc_record_factory_gold_handover;
  assert(Math.abs(Number(hnd1Data?.current_factory_obligation_g) - 0) < 0.001, 'Obligation must be cleared to 0');
  assert(Math.abs(Number(hnd1Data?.current_factory_advance_g) - 82.0684) < 0.001, 'Advance must be 82.0684g');
  assert(Math.abs(Number(hnd1Data?.excess_advance_g) - 82.0684) < 0.001, 'Excess advance must be 82.0684g');

  const vaultAfterHnd1 = await runSqlQuery(`
    SELECT manager_capital_pure_gold_g, manager_capital_pure_gold_fine_g, current_factory_obligation_g, current_factory_advance_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Handover 1:', vaultAfterHnd1);
  // Remaining pure gold in vault: 100 - 80 = 20g fine / 34.0171g 585 eq
  assert(Math.abs(Number(vaultAfterHnd1[0].manager_capital_pure_gold_g) - 34.0171) < 0.001, 'Remaining capital gold 585 eq must be 34.0171g');
  assert(Math.abs(Number(vaultAfterHnd1[0].manager_capital_pure_gold_fine_g) - 19.9000) < 0.001, 'Remaining fine gold must be 19.9000g');
  assert(Math.abs(Number(vaultAfterHnd1[0].current_factory_obligation_g) - 0) < 0.001, 'Current factory obligation must be 0');
  assert(Math.abs(Number(vaultAfterHnd1[0].current_factory_advance_g) - 82.0684) < 0.001, 'Current factory advance must be 82.0684g');

  // Verify Handover row links capital_tx_id
  const hndRows = await runSqlQuery(`
    SELECT handover_no, source_type, agreed_equivalent_g, capital_tx_id, status
    FROM public.factory_gold_handovers
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Handover Rows:', hndRows);
  if (capTxId) {
    assert(hndRows[0].capital_tx_id === capTxId, 'Handover must link capital_tx_id');
  }
  console.log('✅ PASS: Over-handover correctly cleared debt and created factory advance of 82.0684g.\n');

  // Step 6: Verify Profit Neutrality & Net Assets Parity
  console.log('--- Step 6: Verify Profit Neutrality & Net Assets Parity ---');
  const profitSummaryRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_get_accounting_profit_summary(
      p_start_date := (timezone('Asia/Tashkent', now()))::date,
      p_end_date := (timezone('Asia/Tashkent', now()))::date,
      p_gold_rate := 900000,
      p_usd_rate := 12800
    );
  `);
  const profitData = profitSummaryRes[0]?.rpc_get_accounting_profit_summary;
  console.log('Profit Summary Components:', JSON.stringify(profitData?.components, null, 2));
  console.log('Current Total Assets:', profitData?.current_total_assets_585_g);
  console.log('Current Total Liabilities:', profitData?.current_total_liabilities_585_g);
  console.log('Current Net Assets:', profitData?.current_net_assets_585_g);

  // Total Assets must include:
  // manager_finished_goods (50g) + manager_capital_pure_gold (34.0171g) + factory_advance (82.0684g) = 166.0855g
  assert(Math.abs(Number(profitData?.components?.factory_advance_585_g) - 82.0684) < 0.001, 'components.factory_advance_585_g must be 82.0684g');
  assert(Math.abs(Number(profitData?.components?.manager_capital_pure_gold_585_g) - 34.0171) < 0.001, 'components.manager_capital_pure_gold_585_g must be 34.0171g');
  assert(Math.abs(Number(profitData?.current_total_assets_585_g) - 166.0855) < 0.001, 'current_total_assets_585_g must be 166.0855g');
  assert(Math.abs(Number(profitData?.current_total_liabilities_585_g) - 0) < 0.001, 'current_total_liabilities_585_g must be 0g');
  assert(Math.abs(Number(profitData?.current_net_assets_585_g) - 166.0855) < 0.001, 'current_net_assets_585_g must be 166.0855g');
  console.log('✅ PASS: Profit summary accurately includes factory advance in net assets.\n');

  // Step 7: Subsequent Factory Receipt absorbing Advance
  // Receive 30g goods @ 585 with 5% markup -> 31.5000g obligation.
  // Advance before = 82.0684g.
  // 31.5000g is absorbed by advance -> Remaining advance = 82.0684 - 31.5000 = 50.5684g.
  // Net debt remains 0g!
  console.log('--- Step 7: Subsequent Factory Receipt Absorbs Advance ---');
  const rcp2Res = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_factory_receipt(
      p_product_name := 'Test Tovar 2',
      p_quantity := 3,
      p_original_physical_g := 30.0000,
      p_proba := 585.0,
      p_factory_markup_pct := 5.0,
      p_notes := 'Subsequent receipt absorbing advance'
    );
  `);
  console.log('Receipt 2 Res:', rcp2Res);
  const rcp2Data = rcp2Res[0]?.rpc_record_factory_receipt;
  assert(Math.abs(Number(rcp2Data?.current_factory_obligation_g) - 0) < 0.001, 'Current factory obligation must remain 0');
  assert(Math.abs(Number(rcp2Data?.current_factory_advance_g) - 50.5684) < 0.001, 'Current factory advance must be 50.5684g');

  const vaultAfterRcp2 = await runSqlQuery(`
    SELECT total_factory_obligation_g, current_factory_obligation_g, current_factory_advance_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Receipt 2:', vaultAfterRcp2);
  assert(Math.abs(Number(vaultAfterRcp2[0].current_factory_obligation_g) - 0) < 0.001, 'Obligation must be 0');
  assert(Math.abs(Number(vaultAfterRcp2[0].current_factory_advance_g) - 50.5684) < 0.001, 'Advance must be 50.5684g');
  console.log('✅ PASS: Subsequent receipt absorbed 31.5000g from advance without creating debt.\n');

  // Step 8: Subsequent Factory Receipt Exhausting Advance
  // Current advance = 50.5684g.
  // Receive 60g goods @ 585 with 10% markup -> 66.0000g obligation.
  // Advance absorbs 50.5684g -> Advance becomes 0g!
  // Remaining debt = 66.0000 - 50.5684 = 15.4316g -> Stored in current_factory_obligation_g!
  console.log('--- Step 8: Factory Receipt Exhausting Advance and Creating Debt ---');
  const rcp3Res = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_factory_receipt(
      p_product_name := 'Test Tovar 3 (Exhausting)',
      p_quantity := 6,
      p_original_physical_g := 60.0000,
      p_proba := 585.0,
      p_factory_markup_pct := 10.0,
      p_notes := 'Exhausting receipt'
    );
  `);
  console.log('Receipt 3 Res:', rcp3Res);
  const rcp3Data = rcp3Res[0]?.rpc_record_factory_receipt;
  assert(Math.abs(Number(rcp3Data?.current_factory_advance_g) - 0) < 0.001, 'Advance must be exhausted to 0');
  assert(Math.abs(Number(rcp3Data?.current_factory_obligation_g) - 15.4316) < 0.001, 'Remaining debt must be 15.4316g');

  const vaultAfterRcp3 = await runSqlQuery(`
    SELECT total_factory_obligation_g, current_factory_obligation_g, current_factory_advance_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Receipt 3:', vaultAfterRcp3);
  assert(Math.abs(Number(vaultAfterRcp3[0].current_factory_advance_g) - 0) < 0.001, 'Advance must be 0');
  assert(Math.abs(Number(vaultAfterRcp3[0].current_factory_obligation_g) - 15.4316) < 0.001, 'Current obligation must be 15.4316g');
  console.log('✅ PASS: Advance exhausted to 0, excess accurately accumulated into current obligation.\n');

  // Step 9: Reversal of Exhausting Receipt (Receipt 3)
  console.log('--- Step 9: Reverse Receipt 3 -> Restore Advance and Obligation ---');
  const rcp3Id = rcp3Data?.receipt_id;
  const revRcp3Res = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_reverse_factory_receipt(
      '${rcp3Id}',
      'Audit rollback test for Receipt 3'
    );
  `);
  console.log('Reverse Receipt 3 Res:', revRcp3Res);

  const vaultAfterRevRcp3 = await runSqlQuery(`
    SELECT current_factory_obligation_g, current_factory_advance_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Reversal of Receipt 3:', vaultAfterRevRcp3);
  assert(Math.abs(Number(vaultAfterRevRcp3[0].current_factory_obligation_g) - 0) < 0.001, 'Obligation must revert to 0');
  assert(Math.abs(Number(vaultAfterRevRcp3[0].current_factory_advance_g) - 50.5684) < 0.001, 'Advance must revert to 50.5684g');
  console.log('✅ PASS: Receipt reversal accurately restored advance to 50.5684g and obligation to 0g.\n');

  // Step 10: Reversal of Handover (Handover 1)
  console.log('--- Step 10: Reverse Handover 1 -> Restore Safe Gold and Reconcile Debt ---');
  const hnd1Id = hnd1Data?.handover_id;
  const revHnd1Res = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_reverse_factory_gold_handover(
      '${hnd1Id}',
      'Audit rollback test for Handover 1'
    );
  `);
  console.log('Reverse Handover 1 Res:', revHnd1Res);

  const vaultAfterRevHnd1 = await runSqlQuery(`
    SELECT manager_capital_pure_gold_g, manager_capital_pure_gold_fine_g, current_factory_obligation_g, current_factory_advance_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Reversal of Handover 1:', vaultAfterRevHnd1);
  // Safe gold restored:
  assert(Math.abs(Number(vaultAfterRevHnd1[0].manager_capital_pure_gold_g) - 170.0855) < 0.001, 'manager_capital_pure_gold_g must restore to 170.0855g');
  assert(Math.abs(Number(vaultAfterRevHnd1[0].manager_capital_pure_gold_fine_g) - 99.5000) < 0.001, 'manager_capital_pure_gold_fine_g must restore to 99.5000g');
  // Since Handover was reversed, the remaining active receipts are Receipt 1 (54g) + Receipt 2 (31.5g) = 85.5000g obligation.
  assert(Math.abs(Number(vaultAfterRevHnd1[0].current_factory_obligation_g) - 85.5000) < 0.001, 'Current factory obligation must be 85.5000g');
  assert(Math.abs(Number(vaultAfterRevHnd1[0].current_factory_advance_g) - 0) < 0.001, 'Current factory advance must be 0g');
  console.log('✅ PASS: Handover reversal restored safe gold and obligation accurately.\n');

  console.log('==============================================================================');
  console.log('🎉 ALL STAGING MIGRATION 058 VERIFICATION TESTS PASSED SUCCESSFULLY! (10/10)');
  console.log('==============================================================================');
}

test().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
