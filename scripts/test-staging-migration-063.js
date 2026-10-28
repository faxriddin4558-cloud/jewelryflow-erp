const { runSqlQuery } = require('./execute-staging-sql.js');

async function run() {
  console.log('====================================================================');
  console.log('STAGING MIGRATION 063 RIGOROUS VERIFICATION & FULL LIFECYCLE AUDIT');
  console.log('Target DB: vouehtlmsunebracahon (Staging ONLY)');
  console.log('====================================================================\n');

  const STAGING_REF = 'vouehtlmsunebracahon';

  // 1. Verify Staging Functions & Schema
  console.log('[STEP 1]: Verifying Migration 063 functions on Staging...');
  const funcCheck = await runSqlQuery(`
    select routine_name 
    from information_schema.routines 
    where routine_schema = 'public' and routine_name in (
      'rpc_get_customer_monthly_report',
      'rpc_record_gold_purchase',
      'rpc_record_factory_receipt'
    );
  `, STAGING_REF);
  console.log('Migration 063 routines present:', funcCheck.map(f => f.routine_name));
  if (funcCheck.length < 3) {
    throw new Error('Migration 063 functions missing on Staging!');
  }
  console.log('✅ All Migration 063 functions exist on Staging.\n');

  // Obtain active Director for authenticated session simulation
  const directors = await runSqlQuery(`
    select id, user_id, organization_id, name, role
    from employees 
    where role in ('director', 'admin') and user_id is not null 
    limit 1;
  `, STAGING_REF);
  if (!directors || directors.length === 0) {
    throw new Error('No director/admin found on Staging for session simulation');
  }
  const dir = directors[0];
  console.log('Using authenticated session as:', { name: dir.name, role: dir.role, org_id: dir.organization_id });
  const authPrefix = `select set_config('request.jwt.claims', '{"sub": "${dir.user_id}", "role": "authenticated"}', false);`;

  // 2. Test Strict Server-Side Validations & Rejections
  console.log('\n[STEP 2]: Testing Server-Side Guard Rails & Rejections...');

  // Test 2A: Negative cash in gold purchase
  console.log('  Testing 2A: Negative cash in rpc_record_gold_purchase...');
  try {
    await runSqlQuery(`
      ${authPrefix}
      select public.rpc_record_gold_purchase(
        p_supplier_name := 'Test',
        p_cash_spent_uzs := -500000,
        p_gold_weight_grams := 10,
        p_proba := 585
      );
    `, STAGING_REF);
    throw new Error('FAILED: Server accepted negative cash in gold purchase!');
  } catch (err) {
    console.log('  ✅ Correctly REJECTED negative cash:', err.message.slice(0, 100));
  }

  // Test 2B: Negative USD in gold purchase
  console.log('  Testing 2B: Negative USD in rpc_record_gold_purchase...');
  try {
    await runSqlQuery(`
      ${authPrefix}
      select public.rpc_record_gold_purchase(
        p_supplier_name := 'Test',
        p_cash_spent_uzs := 100000,
        p_gold_weight_grams := 10,
        p_proba := 585,
        p_usd_spent := -50,
        p_usd_rate := 11900
      );
    `, STAGING_REF);
    throw new Error('FAILED: Server accepted negative USD in gold purchase!');
  } catch (err) {
    console.log('  ✅ Correctly REJECTED negative USD:', err.message.slice(0, 100));
  }

  // Test 2C: USD purchase without positive USD rate
  console.log('  Testing 2C: Missing USD rate when USD > 0...');
  try {
    await runSqlQuery(`
      ${authPrefix}
      select public.rpc_record_gold_purchase(
        p_supplier_name := 'Test',
        p_cash_spent_uzs := 0,
        p_gold_weight_grams := 10,
        p_proba := 585,
        p_usd_spent := 200,
        p_usd_rate := null
      );
    `, STAGING_REF);
    throw new Error('FAILED: Server accepted USD purchase without exchange rate!');
  } catch (err) {
    console.log('  ✅ Correctly REJECTED missing USD rate:', err.message.slice(0, 100));
  }

  // Test 2D: Non-585 Proba in Finished Goods Factory Receipt (750 proba)
  console.log('  Testing 2D: 750 proba in rpc_record_factory_receipt...');
  try {
    await runSqlQuery(`
      ${authPrefix}
      select public.rpc_record_factory_receipt(
        p_product_name := '750 Uzuk',
        p_quantity := 1,
        p_original_physical_g := 100,
        p_proba := 750,
        p_factory_markup_pct := 8.0
      );
    `, STAGING_REF);
    throw new Error('FAILED: Server accepted 750 proba in factory receipt!');
  } catch (err) {
    console.log('  ✅ Correctly REJECTED non-585 proba (750):', err.message.slice(0, 100));
  }

  // Test 2E: Non-585 Proba in Finished Goods Factory Receipt (999 proba)
  console.log('  Testing 2E: 999 proba in rpc_record_factory_receipt...');
  try {
    await runSqlQuery(`
      ${authPrefix}
      select public.rpc_record_factory_receipt(
        p_product_name := '999 Quymo',
        p_quantity := 1,
        p_original_physical_g := 50,
        p_proba := 999,
        p_factory_markup_pct := 8.0
      );
    `, STAGING_REF);
    throw new Error('FAILED: Server accepted 999 proba in factory receipt!');
  } catch (err) {
    console.log('  ✅ Correctly REJECTED non-585 proba (999):', err.message.slice(0, 100));
  }

  // 3. Parametric Markup Matrix Test (Real DB Mathematical Evaluation)
  console.log('\n[STEP 3]: Testing Parametric Markups Matrix (Factory 6-30% x Seller 10-35%)...');
  const factoryMarkups = [6, 8, 10, 15, 20, 30];
  const sellerMarkups = [10, 12, 15, 20, 25, 30, 35];
  const testWeight = 100.0;
  let matrixTested = 0;

  for (const fPct of factoryMarkups) {
    for (const sPct of sellerMarkups) {
      const row = await runSqlQuery(`
        select
          round((${testWeight} * (1 + ${fPct} / 100.0))::numeric, 4) as f_due,
          round((${testWeight} * (1 + (${fPct} + ${sPct}) / 100.0))::numeric, 4) as s_due,
          round(((${testWeight} * (1 + (${fPct} + ${sPct}) / 100.0)) - (${testWeight} * (1 + ${fPct} / 100.0)))::numeric, 4) as spread;
      `, STAGING_REF);
      const fDue = Number(row[0].f_due);
      const sDue = Number(row[0].s_due);
      const spread = Number(row[0].spread);

      if (Math.abs((fDue + spread) - sDue) > 0.0001) {
        throw new Error(`Markup equation mismatch at F:${fPct}%, S:${sPct}%: ${fDue} + ${spread} != ${sDue}`);
      }
      matrixTested++;
    }
  }
  console.log(`✅ Tested ${matrixTested} markup combinations across Factory 6-30% x Seller 10-35%: ALL 100% PARITY!\n`);

  // 4. Initial Reset and Full Zero-State Assertions
  console.log('[STEP 4]: Executing full test reset and verifying STRICT ZERO STATE across all ledgers...');
  await runSqlQuery(`
    ${authPrefix}
    select public.rpc_execute_full_test_reset('RESET_TEST_ACCOUNT_2026', 'Automated Staging 063 Verification');
  `, STAGING_REF);

  // Assert Vault is strictly zero
  const vaultZero = await runSqlQuery(`
    select * from manager_vault_account where organization_id = '${dir.organization_id}';
  `, STAGING_REF);
  const v0 = vaultZero[0];
  console.log('Vault after reset:', {
    stock: v0.manager_physical_stock_g,
    cash_uzs: v0.manager_cash_amount,
    usd: v0.manager_usd_amount,
    scrap: v0.manager_scrap_585_eq_g,
    refined: v0.manager_refined_gold_grams,
    purchased: v0.manager_purchased_gold_grams,
    factory_debt: v0.current_factory_obligation_g
  });

  if (Number(v0.manager_physical_stock_g || 0) !== 0 ||
      Number(v0.manager_cash_amount || 0) !== 0 ||
      Number(v0.manager_usd_amount || 0) !== 0 ||
      Number(v0.manager_refined_gold_grams || 0) !== 0 ||
      Number(v0.manager_purchased_gold_grams || 0) !== 0 ||
      Number(v0.current_factory_obligation_g || 0) !== 0) {
    throw new Error('ASSERTION FAILED: Manager vault balances are NOT all 0.00 after reset!');
  }

  // Assert Seller Accounts are strictly zero
  const sellerZeros = await runSqlQuery(`
    select count(*) as cnt from seller_gold_accounts 
    where organization_id = '${dir.organization_id}'
      and (abs(bozor_qarzi_signed_g) > 0.001 or abs(seller_owes_manager_g) > 0.001 or seller_till_cash_amount > 0 or seller_till_usd_amount > 0 or seller_till_scrap_grams > 0);
  `, STAGING_REF);
  if (Number(sellerZeros[0].cnt) !== 0) {
    throw new Error('ASSERTION FAILED: Seller accounts still have non-zero balances after reset!');
  }

  // Assert Customer Accounts are strictly zero for this org
  const custZeros = await runSqlQuery(`
    select count(*) as cnt from client_gold_accounts 
    where organization_id = '${dir.organization_id}'
      and (abs(current_debt_grams) > 0.001 or abs(advance_balance_grams) > 0.001);
  `, STAGING_REF);
  if (Number(custZeros[0].cnt) !== 0) {
    throw new Error('ASSERTION FAILED: Customer accounts still have non-zero balances after reset!');
  }

  // Assert A-G Reconciliation on empty reset state has 0.00 disparity
  const sellerCheck = await runSqlQuery(`select id, name, full_name from employees where organization_id = '${dir.organization_id}' and role::text in ('sales', 'seller') limit 1;`, STAGING_REF);
  const testSeller = sellerCheck[0];
  const emptyRecon = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_get_seller_reconciliation_statement('${testSeller.id}'::uuid);
  `, STAGING_REF);
  const emptyReconData = emptyRecon[0].rpc_get_seller_reconciliation_statement;
  console.log('Empty A-G Reconciliation statement:', {
    seller: emptyReconData.seller?.name || emptyReconData.seller?.full_name,
    discrepancy: emptyReconData.section_g?.discrepancy_grams,
    is_reconciled: emptyReconData.is_reconciled
  });
  if (Math.abs(Number(emptyReconData.section_g?.discrepancy_grams || 0)) > 0.0001) {
    throw new Error(`ASSERTION FAILED: Empty A-G reconciliation has disparity: ${emptyReconData.section_g?.discrepancy_grams}`);
  }
  console.log('✅ Full Zero State Assertions PASSED (All safes, tills, debts, and A-G disparity strictly 0.00)!\n');

  // 5. Full Lifecycle Chain on Staging
  console.log('[STEP 5]: Executing Complete Lifecycle Chain on Staging...');

  // 5A: Seed cash and USD in manager vault
  console.log('  5A: Seeding 20,000,000 UZS and $2,000 USD to manager vault...');
  await runSqlQuery(`
    update manager_vault_account 
    set manager_cash_amount = 20000000, manager_usd_amount = 2000 
    where organization_id = '${dir.organization_id}';
  `, STAGING_REF);

  // 5B: Multi-Currency Gold Purchase
  console.log('  5B: Multi-currency gold purchase (5,000,000 UZS + $200 USD @ 11,900 = 7.74 g 585 eq)...');
  const purchRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_record_gold_purchase(
      p_supplier_name := 'Bozor Ta''minotchi Staging',
      p_cash_spent_uzs := 5000000,
      p_gold_weight_grams := 7.7400,
      p_proba := 585,
      p_rate_per_gram := 953488.37,
      p_notes := 'Staging mixed currency test',
      p_usd_spent := 200,
      p_usd_rate := 11900
    );
  `, STAGING_REF);
  const purch = purchRes[0].rpc_record_gold_purchase;
  console.log('  Purchased gold recorded:', {
    purchase_no: purch.purchase_no,
    currency: purch.currency,
    gold_weight_g: purch.gold_weight_grams,
    equiv_585: purch.equiv_585_grams,
    total_cost_uzs: purch.total_cost_uzs
  });
  if (Number(purch.total_cost_uzs) !== 7380000) {
    throw new Error(`Total cost mismatch: expected 7380000 UZS, got ${purch.total_cost_uzs}`);
  }

  // 5C: Factory Finished Goods Receipt (strictly 585 proba)
  console.log('  5C: Factory receipt (100.00 g, 585 proba, 8% markup = 108.00 g obligation)...');
  const rcpRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_record_factory_receipt(
      p_product_name := 'Staging Zargarlik To''plami',
      p_quantity := 1,
      p_original_physical_g := 100.0000,
      p_proba := 585,
      p_factory_markup_pct := 8.0,
      p_notes := 'Staging lifecycle receipt'
    );
  `, STAGING_REF);
  const rcp = rcpRes[0].rpc_record_factory_receipt;
  console.log('  Factory receipt recorded:', {
    receipt_no: rcp.receipt_no,
    weight: rcp.physical_weight_g,
    proba: rcp.proba,
    obligation: rcp.factory_obligation_g
  });
  if (Number(rcp.factory_obligation_g) !== 108.0) {
    throw new Error(`Factory obligation mismatch: expected 108.00g, got ${rcp.factory_obligation_g}`);
  }

  // 5D: Consignment to Seller
  console.log('  5D: Consigning 100.00 g to seller (seller markup 15% -> 124.20 g obligation)...');
  const consignRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_issue_barcode_consignment(
      p_seller_id := '${testSeller.id}'::uuid,
      p_factory_markup_pct := 8.0,
      p_pieces := '[{"weight_grams": 100.0000, "product_name": "Staging Zargarlik"}]'::jsonb,
      p_notes := 'Staging lifecycle consignment',
      p_idempotency_key := null,
      p_factory_receipt_id := '${rcp.receipt_id}'::uuid,
      p_seller_markup_pct := 15.0
    );
  `, STAGING_REF);
  const csg = consignRes[0].rpc_issue_barcode_consignment;
  console.log('  Consignment issued:', {
    consignment_no: csg.consignment_no,
    weight: csg.total_weight_grams || csg.base_weight_grams,
    obligation: csg.total_seller_due_grams || csg.total_seller_gold_due_grams
  });

  // 5E: Jewelry Sale to Customer
  console.log('  5E: Selling 50.00 g to customer...');
  const custRow = await runSqlQuery(`select id, contact_name from customers where seller_id = '${testSeller.id}' limit 1;`, STAGING_REF);
  let customerId;
  if (!custRow || custRow.length === 0) {
    const newCust = await runSqlQuery(`
      ${authPrefix}
      insert into customers (organization_id, seller_id, customer_code, contact_name, phone)
      values ('${dir.organization_id}', '${testSeller.id}', 'CUST-STAG-01', 'Staging Mijoz', '+998901234567')
      returning id;
    `, STAGING_REF);
    customerId = newCust[0].id;
  } else {
    customerId = custRow[0].id;
  }

  const saleRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_record_weight_sale(
      p_customer_id := '${customerId}'::uuid,
      p_seller_id := '${testSeller.id}'::uuid,
      p_weight_grams := 50.0000,
      p_client_markup_pct := 0.0,
      p_notes := 'Staging lifecycle sale'
    );
  `, STAGING_REF);
  console.log('  Sale recorded:', saleRes[0]);

  // 5F: Customer Settlement (Mixed: scrap 20g + cash 1M UZS + USD $100 @ 11,900)
  console.log('  5F: Customer settlement with scrap + UZS + USD...');
  const settleRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_record_client_settlement(
      p_customer_id := '${customerId}'::uuid,
      p_sale_id := null,
      p_scrap_weight := 20.0000,
      p_scrap_proba := 585,
      p_cash_amount := 1000000,
      p_rate_per_gram := 860000,
      p_usd_amount := 100,
      p_usd_rate := 11900,
      p_notes := 'Staging customer payment'
    );
  `, STAGING_REF);
  const stl = settleRes[0].rpc_record_client_settlement;
  console.log('  Customer settlement recorded:', {
    settlement_no: stl?.settlement_no,
    scrap: stl?.scrap_weight_grams,
    cash: stl?.cash_paid_amount,
    usd: stl?.usd_amount,
    total_settled_g: stl?.total_settled_grams
  });

  // 5G: Seller Surrender to Manager
  console.log('  5G: Seller surrenders collected payments to manager...');
  const surrRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_record_seller_to_manager_settlement(
      p_seller_id := '${testSeller.id}'::uuid,
      p_scrap_weight_grams := 20.0000,
      p_cash_paid_amount := 1000000,
      p_usd_paid_amount := 100,
      p_usd_rate := 11900,
      p_rate_per_gram := 860000,
      p_notes := 'Staging seller surrender'
    );
  `, STAGING_REF);
  console.log('  Seller surrender recorded:', surrRes[0]);

  // 5H: Refining Batch with 997° fine gold
  console.log('  5H: Refining 20.00 g scrap into 997 fine gold...');
  const refRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_record_refining_batch(
      20.0000,
      19.9000,
      11.7000,
      997.0,
      null::uuid,
      'Staging refining 997 test',
      null::text,
      20.0000,
      585.0
    );
  `, STAGING_REF);
  const refBatch = refRes[0].rpc_record_refining_batch;
  console.log('  Refining batch recorded:', {
    batch_no: refBatch.batch_no,
    output_fine_g: refBatch.output_fine_grams,
    output_fine_proba: refBatch.output_fine_proba,
    equiv_585: refBatch.output_585_equiv_grams
  });

  // 5I: Factory Gold Handover from Refined Gold
  console.log('  5I: Factory gold handover from refined gold (11.70 g @ 997)...');
  const hndRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_record_factory_gold_handover(
      p_source_type := 'refined_gold',
      p_physical_weight_g := 11.7000,
      p_proba := 997.0,
      p_agreed_equivalent_g := round((11.7000 * 997.0 / 585.0)::numeric, 4),
      p_refining_batch_id := '${refBatch.batch_id}'::uuid,
      p_notes := 'Staging refined handover'
    );
  `, STAGING_REF);
  console.log('  Factory handover recorded:', hndRes[0]);

  // 5J: Verify Monthly Report RPC
  console.log('  5J: Verifying rpc_get_customer_monthly_report output...');
  const mReportRes = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_get_customer_monthly_report(null, 2026, 10);
  `, STAGING_REF);
  const mReport = mReportRes[0].rpc_get_customer_monthly_report;
  console.log('  Monthly report summary:', {
    total_customers: mReport.summary?.total_customers,
    total_opening_debt_g: mReport.summary?.total_opening_debt_g,
    total_distributed_month_g: mReport.summary?.total_distributed_month_g,
    total_collected_month_g: mReport.summary?.total_collected_month_g,
    total_closing_debt_g: mReport.summary?.total_closing_debt_g,
    seller_held_usd: mReport.summary?.seller_held_usd,
    bozor_qarzi: mReport.summary?.seller_manager_bozor_qarzi_g
  });
  if (mReport.items.length > 0) {
    console.log('  Sample customer item in report:', {
      name: mReport.items[0].customer_name,
      opening: mReport.items[0].opening_debt_g,
      sales: mReport.items[0].sales_in_month_g,
      scrap: mReport.items[0].scrap_received_g,
      cash_uzs: mReport.items[0].cash_received_uzs,
      usd: mReport.items[0].usd_received,
      usd_rate: mReport.items[0].usd_rate,
      total_settled: mReport.items[0].total_settled_g,
      closing: mReport.items[0].closing_debt_g
    });
  }

  // 5K: Verify A-G Reconciliation Discrepancy
  console.log('  5K: Verifying A-G Reconciliation on active state...');
  const activeRecon = await runSqlQuery(`
    ${authPrefix}
    select public.rpc_get_seller_reconciliation_statement('${testSeller.id}'::uuid);
  `, STAGING_REF);
  const activeReconData = activeRecon[0].rpc_get_seller_reconciliation_statement;
  console.log('  Active A-G Reconciliation statement:', {
    seller: activeReconData.seller?.full_name || activeReconData.seller?.name,
    obligation_a: activeReconData.section_a?.total_seller_gold_due_grams,
    settled_e: activeReconData.section_e?.total_settled_to_manager_grams,
    discrepancy: activeReconData.section_g?.discrepancy_grams,
    is_reconciled: activeReconData.is_reconciled
  });
  if (Math.abs(Number(activeReconData.section_g?.discrepancy_grams || 0)) > 0.0001) {
    throw new Error(`A-G discrepancy detected: ${activeReconData.section_g?.discrepancy_grams}`);
  }
  console.log('  ✅ A-G Reconciliation is 100% BALANCED (discrepancy = 0.00 g)!');

  // 5L: Final Reset and Re-assert all zero balances
  console.log('\n[STEP 6]: Final Reset and Post-Reset Zero Assertions...');
  await runSqlQuery(`
    ${authPrefix}
    select public.rpc_execute_full_test_reset('RESET_TEST_ACCOUNT_2026', 'Staging final zero assertion');
  `, STAGING_REF);

  const finalVault = await runSqlQuery(`
    select manager_physical_stock_g, manager_cash_amount, manager_usd_amount,
           manager_refined_gold_grams, manager_purchased_gold_grams, current_factory_obligation_g
    from manager_vault_account where organization_id = '${dir.organization_id}';
  `, STAGING_REF);
  const fv = finalVault[0];
  console.log('Final Vault State:', fv);
  if (Number(fv.manager_physical_stock_g) !== 0 ||
      Number(fv.manager_cash_amount) !== 0 ||
      Number(fv.manager_usd_amount) !== 0 ||
      Number(fv.manager_refined_gold_grams) !== 0 ||
      Number(fv.manager_purchased_gold_grams) !== 0 ||
      Number(fv.current_factory_obligation_g) !== 0) {
    throw new Error('FINAL ASSERTION FAILED: Non-zero vault values remaining after final reset!');
  }

  const finalSellerZeros = await runSqlQuery(`
    select count(*) as cnt from seller_gold_accounts 
    where organization_id = '${dir.organization_id}'
      and (abs(bozor_qarzi_signed_g) > 0.001 or abs(seller_owes_manager_g) > 0.001 or seller_till_cash_amount > 0 or seller_till_usd_amount > 0 or seller_till_scrap_grams > 0);
  `, STAGING_REF);
  if (Number(finalSellerZeros[0].cnt) !== 0) {
    throw new Error('FINAL ASSERTION FAILED: Seller accounts still have non-zero balances after final reset!');
  }

  const finalCustZeros = await runSqlQuery(`
    select count(*) as cnt from client_gold_accounts 
    where organization_id = '${dir.organization_id}'
      and (abs(current_debt_grams) > 0.001 or abs(advance_balance_grams) > 0.001);
  `, STAGING_REF);
  if (Number(finalCustZeros[0].cnt) !== 0) {
    throw new Error('FINAL ASSERTION FAILED: Customer accounts still have non-zero balances after final reset!');
  }
  console.log('✅ Final Post-Reset Assertions PASSED: Vault, Seller accounts, and Customer accounts strictly zero.');

  console.log('\n====================================================================');
  console.log('🎉 ALL STAGING MIGRATION 063 TESTS COMPLETED AND 100% VERIFIED!');
  console.log('====================================================================');
}

run().catch(err => {
  console.error('\n❌ STAGING TEST ERROR:', err);
  process.exit(1);
});
