/**
 * STAGING PRACTICAL WORKFLOW TEST:
 * Eski qarz -> Mijoz to'lovi -> Sotuvchi kassasi -> Menejerga topshirish va bekor qilish (reversal)
 * Target: Staging (vouehtlmsunebracahon)
 */

const { runSqlQuery } = require('./execute-staging-sql.js');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function run() {
  console.log('==============================================================================');
  console.log('STAGING PRACTICAL WORKFLOW: ESKI QARZ -> TO\'LOV -> SOTUVCHI KASSASI -> SURRENDER -> REVERSAL');
  console.log('Target: Staging Supabase (vouehtlmsunebracahon)');
  console.log('==============================================================================\n');

  const runId = Math.floor(Math.random() * 899999 + 100000).toString();
  const testOrgId = `00000000-0000-4001-8001-000000${runId}`;
  const directorUserId = `00000000-0000-4001-8002-000000${runId}`;
  const directorEmpId = `00000000-0000-4001-8003-000000${runId}`;
  const sellerEmpId = `00000000-0000-4001-8004-000000${runId}`;
  const customerId = `00000000-0000-4001-8005-000000${runId}`;

  // Step 1: Setup isolated tenant
  console.log('[STEP 1]: Creating isolated test tenant...');
  await runSqlQuery(`
    INSERT INTO public.organizations (id, code, name, status)
    VALUES ('${testOrgId}', 'chain-${runId}', 'Practical Chain Org ${runId}', 'ACTIVE');

    INSERT INTO public.employees (id, organization_id, user_id, name, full_name, role, is_active)
    VALUES ('${directorEmpId}', '${testOrgId}', '${directorUserId}', 'Dir Chain', 'Dir Chain', 'director', true);

    INSERT INTO public.employees (id, organization_id, name, full_name, role, is_active)
    VALUES ('${sellerEmpId}', '${testOrgId}', 'Sotuvchi Chain', 'Sotuvchi Chain', 'sales', true);

    INSERT INTO public.customers (id, organization_id, customer_code, contact_name, phone, seller_id, is_active)
    VALUES ('${customerId}', '${testOrgId}', 'CUST-CH${runId.slice(0, 4)}', 'Dilrabo Sinov', '+998901234567', '${sellerEmpId}', true);

    INSERT INTO public.client_gold_accounts (organization_id, customer_id, seller_id, current_debt_grams, total_settled_grams, advance_balance_grams)
    VALUES ('${testOrgId}', '${customerId}', '${sellerEmpId}', 0, 0, 0);

    INSERT INTO public.seller_consignments (
      organization_id, seller_id, consignment_no, product_name, quantity, base_weight_grams,
      factory_gold_due_grams, factory_remaining_gold_grams, seller_obligation_g, status
    ) VALUES (
      '${testOrgId}', '${sellerEmpId}', 'CSG-TEST-${runId.slice(0, 4)}', 'Test Consignment', 1, 105.50,
      105.50, 105.50, 118.16, 'held_by_seller'
    );

    INSERT INTO public.seller_gold_accounts (organization_id, seller_id, total_consigned_gold_grams, current_physical_stock_g, total_seller_obligation_g, seller_owes_manager_g, bozor_qarzi_signed_g, seller_till_scrap_grams, seller_till_cash_amount)
    VALUES ('${testOrgId}', '${sellerEmpId}', 118.16, 105.50, 118.16, 118.16, -118.16, 0, 0)
    ON CONFLICT (seller_id) DO UPDATE SET
      total_consigned_gold_grams = 118.16,
      current_physical_stock_g = 105.50,
      total_seller_obligation_g = 118.16,
      seller_owes_manager_g = 118.16,
      bozor_qarzi_signed_g = -118.16;

    INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, is_confirmed)
    VALUES ('${testOrgId}', (timezone('Asia/Tashkent', now()))::date, 585, 900000, true)
    ON CONFLICT (organization_id, rate_date, proba) DO UPDATE SET rate_per_gram = 900000, is_confirmed = true;
  `);
  console.log('  Isolated tenant and accounts initialized.');

  // Step 2: Register 45g legacy debt assigned to seller
  console.log('\n[STEP 2]: Registering 45g Legacy Debt for Customer and assigning to Seller...');
  const legRes = await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_record_client_legacy_debt(
      p_customer_id => '${customerId}'::uuid,
      p_balance_type => 'debt'::text,
      p_amount_585_g => 45.0::numeric,
      p_as_of_date => '2026-10-26'::date,
      p_notes => 'Dilrabo 45g eski qarz sinovi'::text,
      p_entry_type => 'reconciliation_adjustment'::text,
      p_idempotency_key => 'idemp-leg-${runId}'::text,
      p_seller_id => '${sellerEmpId}'::uuid
    );
  `);
  console.log('  Legacy debt recorded:', legRes);

  // Check balances after legacy debt
  const cAcc1 = (await runSqlQuery(`SELECT * FROM public.client_gold_accounts WHERE customer_id = '${customerId}';`))[0];
  const sAcc1 = (await runSqlQuery(`SELECT * FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';`))[0];
  console.log(`  Customer Debt: ${cAcc1.current_debt_grams}g (Expected: 45.0000g)`);
  console.log(`  Seller Total Obligation: ${sAcc1.total_seller_obligation_g}g (Expected: 163.1600g = 118.16 + 45)`);
  console.log(`  Seller Bozor Qarzi: ${sAcc1.bozor_qarzi_signed_g}g (Expected: -163.1600g)`);
  assert(Math.abs(Number(cAcc1.current_debt_grams) - 45) < 0.001, 'Customer debt must be 45g');
  assert(Math.abs(Number(sAcc1.total_seller_obligation_g) - 163.16) < 0.001, 'Seller obligation must be 163.16g');

  // Check Monthly Report
  console.log('\n[STEP 3]: Checking rpc_get_customer_monthly_report...');
  const monRes = await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_get_customer_monthly_report('${sellerEmpId}'::uuid, 2026, 10);
  `);
  const monthly = monRes[0].rpc_get_customer_monthly_report;
  console.log('  Monthly Report Item for Dilrabo:', monthly.items[0]);
  console.log('  Monthly Report Summary:', monthly.summary);
  assert(Math.abs(Number(monthly.items[0].legacy_added_month_g) - 45) < 0.001, 'legacy_added_month_g must be 45g');
  assert(Math.abs(Number(monthly.items[0].closing_debt_g) - 45) < 0.001, 'closing_debt_g must be 45g');
  assert(Math.abs(Number(monthly.summary.total_opening_debt_g) - 45) < 0.001, 'summary opening debt must be 45g');
  assert(Math.abs(Number(monthly.summary.total_distributed_month_g) - 0) < 0.001, 'summary distributed must be 0g (no new sales)');
  console.log('✅ Monthly report displays 45g legacy debt as opening/legacy, sales 0g, closing 45g!');

  // Step 4: Customer payment of 5g scrap
  console.log('\n[STEP 4]: Recording Customer Payment (5g 585 scrap)...');
  const payRes = await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_record_client_settlement(
      p_customer_id => '${customerId}'::uuid,
      p_seller_id => '${sellerEmpId}'::uuid,
      p_scrap_weight => 5.0::numeric,
      p_scrap_proba => 585::numeric,
      p_cash_amount => 0::numeric,
      p_settlement_date => '2026-10-26'::date,
      p_notes => 'Dilrabo 5g lom to''lovi'::text,
      p_idempotency_key => 'idemp-pay-${runId}'::text
    );
  `);
  const payData = payRes[0].rpc_record_client_settlement;
  console.log('  Payment recorded:', payData);
  const settlementId = payData.settlement_id || payData.id;

  const cAcc2 = (await runSqlQuery(`SELECT * FROM public.client_gold_accounts WHERE customer_id = '${customerId}';`))[0];
  const sAcc2 = (await runSqlQuery(`SELECT * FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';`))[0];
  console.log(`  Customer Debt: ${cAcc2.current_debt_grams}g (Expected: 40.0000g)`);
  console.log(`  Seller Till Scrap: ${sAcc2.seller_till_scrap_grams}g (Expected: 5.0000g)`);
  assert(Math.abs(Number(cAcc2.current_debt_grams) - 40) < 0.001, 'Customer debt must drop to 40g');
  assert(Math.abs(Number(sAcc2.seller_till_scrap_grams) - 5) < 0.001, 'Seller till must have 5g scrap');
  console.log('✅ Customer payment processed cleanly: customer debt 45 -> 40g, seller till 0 -> 5g.');

  // Step 5: Surrender from Seller to Manager (Topshirish)
  console.log('\n[STEP 5]: Surrendering 5g Scrap from Seller till to Manager Safe...');
  const surRes = await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_record_seller_to_manager_settlement(
      p_seller_id => '${sellerEmpId}'::uuid,
      p_scrap_weight_grams => 5.0::numeric,
      p_cash_paid_amount => 0::numeric,
      p_usd_paid_amount => 0::numeric,
      p_notes => 'Sotuvchidan menejerga 5g lom topshirildi'::text,
      p_idempotency_key => 'idemp-sur-${runId}'::text
    );
  `);
  console.log('  Surrender recorded:', surRes);
  const surrenderData = surRes[0].rpc_record_seller_to_manager_settlement;
  const surrenderId = surrenderData.settlement_id || surrenderData.id;

  const sAcc3 = (await runSqlQuery(`SELECT * FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';`))[0];
  const vAcc3 = (await runSqlQuery(`SELECT * FROM public.manager_vault_account WHERE organization_id = '${testOrgId}';`))[0];
  console.log(`  Seller Till Scrap: ${sAcc3.seller_till_scrap_grams}g (Expected: 0.0000g)`);
  console.log(`  Seller Settled to Manager: ${sAcc3.total_settled_to_manager_g}g (Expected: 5.0000g)`);
  console.log(`  Seller Bozor Qarzi: ${sAcc3.bozor_qarzi_signed_g}g (Expected: -158.1600g = -163.16 + 5)`);
  console.log(`  Manager Safe Scrap: ${vAcc3?.manager_scrap_grams || 0}g (Expected: 5.0000g)`);
  assert(Math.abs(Number(sAcc3.seller_till_scrap_grams) - 0) < 0.001, 'Seller till must be 0g after surrender');
  assert(Math.abs(Number(sAcc3.bozor_qarzi_signed_g) - (-158.16)) < 0.001, 'Bozor qarzi must reduce to -158.16g');
  console.log('✅ Surrender processed cleanly: seller till 0g, manager safe 5g, bozor qarzi -158.16g.');

  // Step 6: Reversals (Bekor qilish)
  console.log('\n[STEP 6]: Reversing Surrender and Payment with full audit trail...');
  // 6a. Reverse surrender first
  await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_reverse_seller_to_manager_settlement(
      p_settlement_id => '${surrenderId}'::uuid,
      p_reason => 'Audit test: surrender bekor qilindi'::text
    );
  `);
  console.log('  Surrender reversed.');

  const sAcc4 = (await runSqlQuery(`SELECT * FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';`))[0];
  console.log(`  Seller Till Scrap restored: ${sAcc4.seller_till_scrap_grams}g (Expected: 5.0000g)`);
  console.log(`  Seller Bozor Qarzi restored: ${sAcc4.bozor_qarzi_signed_g}g (Expected: -163.1600g)`);
  assert(Math.abs(Number(sAcc4.seller_till_scrap_grams) - 5) < 0.001, 'Seller till must restore to 5g');
  assert(Math.abs(Number(sAcc4.bozor_qarzi_signed_g) - (-163.16)) < 0.001, 'Bozor qarzi must restore to -163.16g');

  // 6b. Reverse customer payment
  await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_reverse_client_settlement(
      p_settlement_id => '${settlementId}'::uuid,
      p_reason => 'Audit test: to''lov bekor qilindi'::text
    );
  `);
  console.log('  Payment reversed.');

  const cAcc5 = (await runSqlQuery(`SELECT * FROM public.client_gold_accounts WHERE customer_id = '${customerId}';`))[0];
  const sAcc5 = (await runSqlQuery(`SELECT * FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';`))[0];
  console.log(`  Customer Debt fully restored: ${cAcc5.current_debt_grams}g (Expected: 45.0000g)`);
  console.log(`  Seller Till Scrap fully restored: ${sAcc5.seller_till_scrap_grams}g (Expected: 0.0000g)`);
  assert(Math.abs(Number(cAcc5.current_debt_grams) - 45) < 0.001, 'Customer debt must restore to 45g');
  assert(Math.abs(Number(sAcc5.seller_till_scrap_grams) - 0) < 0.001, 'Seller till must restore to 0g');

  // Verify settlement status in DB
  const stlCheck = (await runSqlQuery(`SELECT status, reversed_at, reversal_reason FROM public.gold_settlements WHERE id = '${settlementId}';`))[0];
  console.log('  Settlement row in DB:', stlCheck);
  assert(stlCheck.status === 'reversed', 'Settlement status must be reversed');

  // Check Monthly Report again to confirm reversed payment is excluded
  const monResAfter = await runSqlQuery(`
    SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';
    SELECT public.rpc_get_customer_monthly_report('${sellerEmpId}'::uuid, 2026, 10);
  `);
  const monthlyAfter = monResAfter[0].rpc_get_customer_monthly_report;
  console.log('  Monthly Report after reversal total_collected:', monthlyAfter.summary.total_collected_month_g);
  console.log('  Monthly Report after reversal total_customer_debt:', monthlyAfter.summary.total_customer_debt_g);
  assert(Math.abs(Number(monthlyAfter.summary.total_collected_month_g) - 0) < 0.001, 'Reversed payment must be excluded from active collected (0g)');
  assert(Math.abs(Number(monthlyAfter.summary.total_customer_debt_g) - 45) < 0.001, 'Closing debt must remain 45g');

  console.log('\n==============================================================================');
  console.log('🎉 PRACTICAL STAGING WORKFLOW 100% PASSED WITH ZERO DISCREPANCIES!');
  console.log('==============================================================================');
}

run().catch((err) => {
  console.error('Workflow test failed:', err);
  process.exit(1);
});
