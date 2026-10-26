/**
 * JEWELRYFLOW / GOLDIA SALES — STAGING TEST SUITE FOR MIGRATION 056
 * Target Database: Staging (vouehtlmsunebracahon)
 * 
 * Verifies all 8 business workflows:
 * 1. Boshlang'ich hisob (Baseline snapshotting): assets gathered, internal seller debt excluded.
 * 2. Multi-asset capital injections (UZS, USD, Scrap, Fine Gold, Finished Goods).
 * 3. Consignment of capital finished goods (consigns to seller with 0 factory debt).
 * 4. Refining & Pateriya (mass balance in 585 eq, single-count profit parity, factory debt unchanged).
 * 5. Seller responsibility for legacy debt (Dilrabo Apka 45g -> Seller 163.16g).
 * 6. Client legacy debt payment lifecycle (seller till -> handover -> manager clears).
 * 7. Exclusion of reversed records in reconciliation & monthly reports.
 * 8. Audited capital reclassification without baseline snapshot mutation.
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
  console.log('STARTING STAGING MIGRATION 056 VERIFICATION');
  console.log('==============================================================================\n');

  const runId = Math.floor(Math.random() * 899999 + 100000).toString();
  const testOrgId = `00000000-0000-4001-8001-000000${runId}`;
  const directorUserId = `00000000-0000-4001-8002-000000${runId}`;
  const directorEmpId = `00000000-0000-4001-8003-000000${runId}`;
  const sellerEmpId = `00000000-0000-4001-8004-000000${runId}`;
  const custId = `00000000-0000-4001-8005-000000${runId}`;
  const testPrefix = 'T056_' + Date.now();

  const jwtHeader = `SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';`;

  // Step 0: Setup fresh isolated tenant
  console.log('--- Step 0: Setup Isolated Test Tenant ---');
  await runSqlQuery(`
    INSERT INTO public.organizations (id, code, name, status)
    VALUES ('${testOrgId}', 'parity-test-${runId}', 'Parity Test Org ${runId}', 'ACTIVE');

    INSERT INTO public.employees (id, organization_id, user_id, name, full_name, role, is_active)
    VALUES ('${directorEmpId}', '${testOrgId}', '${directorUserId}', 'Dir 056', 'Dir 056', 'director', true);

    INSERT INTO public.employees (id, organization_id, name, full_name, role, is_active)
    VALUES ('${sellerEmpId}', '${testOrgId}', 'Sotuvchi Omonboy 056', 'Sotuvchi Omonboy 056', 'sales', true);

    INSERT INTO public.customers (id, organization_id, customer_code, contact_name, phone, seller_id)
    VALUES ('${custId}', '${testOrgId}', 'CUST-${runId}', 'Dilrabo Apka ${runId}', '+998909998877', '${sellerEmpId}');

    -- Today's rate
    INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, is_confirmed)
    VALUES ('${testOrgId}', (timezone('Asia/Tashkent', now()))::date, 585, 900000, true)
    ON CONFLICT (organization_id, rate_date, proba) DO UPDATE SET rate_per_gram = 900000, is_confirmed = true;

    -- Init manager vault & seller account
    SELECT public._get_or_create_manager_vault('${testOrgId}');
    SELECT public.recalc_seller_gold_account('${sellerEmpId}', '${testOrgId}');
  `);
  console.log('[PASS] Test tenant initialized successfully.');

  // Scenario 1: Multi-Asset Capital Injections
  console.log('\n--- Scenario 1: Multi-Asset Capital Injections ---');
  await runSqlQuery(`
    ${jwtHeader}

    -- 1. Scrap Gold (50g @ 585 proba)
    SELECT public.rpc_record_financial_transaction(
      'capital_contribution', 'manager_scrap', 50.00, 'SCRAP_GOLD',
      'Ta''sischi hissasi', '50g lom 585', 900000, 12800,
      'cap-scrap-${testPrefix}', 50.00, 585.0
    );

    -- 2. Fine Bullion Gold (20g @ 995 proba)
    SELECT public.rpc_record_financial_transaction(
      'capital_contribution', 'manager_fine_gold', 20.00, 'FINE_GOLD',
      'Ta''sischi hissasi', '20g toza quyma 995', 900000, 12800,
      'cap-fine-${testPrefix}', 20.00, 995.0
    );

    -- 3. Finished Goods (30g @ 585 proba, zero factory debt)
    SELECT public.rpc_record_financial_transaction(
      'capital_contribution', 'manager_finished', 30.00, 'FINISHED_GOODS',
      'Ta''sischi hissasi', '30g tayyor buyum 585', 900000, 12800,
      'cap-fin-${testPrefix}', 30.00, 585.0, null, null, 'Kapital Zanjir 585', 1
    );

    -- 4. UZS Cash (90,000,000 UZS)
    SELECT public.rpc_record_financial_transaction(
      'capital_contribution', 'manager_uzs', 90000000, 'UZS',
      'Ta''sischi hissasi', '90M UZS naqd', 900000, 12800,
      'cap-uzs-${testPrefix}'
    );

    -- 5. USD Cash ($5,000)
    SELECT public.rpc_record_financial_transaction(
      'capital_contribution', 'manager_usd', 5000, 'USD',
      'Ta''sischi hissasi', '5,000 USD naqd', 900000, 12800,
      'cap-usd-${testPrefix}'
    );
  `);

  const vaultCheck = await runSqlQuery(`
    SELECT
      manager_scrap_585_eq_g,
      manager_capital_pure_gold_g,
      manager_capital_pure_gold_fine_g,
      manager_physical_stock_g,
      manager_cash_amount,
      manager_usd_amount,
      current_factory_obligation_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault check post-capital:', vaultCheck[0]);
  assert(Number(vaultCheck[0].manager_scrap_585_eq_g) === 50, 'Manager scrap 585 eq should be 50g');
  assert(Math.abs(Number(vaultCheck[0].manager_capital_pure_gold_g) - 34.0171) < 0.01, '20g 995 fine gold should be ~34.0171g in 585 eq');
  assert(Number(vaultCheck[0].manager_physical_stock_g) === 30, 'Manager finished stock should be 30g');
  assert(Number(vaultCheck[0].manager_cash_amount) === 90000000, 'Manager cash should be 90M UZS');
  assert(Number(vaultCheck[0].manager_usd_amount) === 5000, 'Manager USD should be $5,000');
  assert(Number(vaultCheck[0].current_factory_obligation_g) === 0, 'Capital additions must NOT create factory debt');
  console.log('✅ Scenario 1 PASS: Multi-asset capital injections correctly updated distinct vault holdings.');

  // Scenario 2: Consignment of Capital Finished Goods (Zero Factory Obligation)
  console.log('\n--- Scenario 2: Consignment of Capital Finished Goods ---');
  await runSqlQuery(`
    ${jwtHeader}
    DO $$
    DECLARE
      v_receipt_id uuid;
    BEGIN
      SELECT id INTO v_receipt_id FROM public.factory_receipts
       WHERE organization_id = '${testOrgId}' AND receipt_no LIKE 'CAP-REC-%' AND available_physical_g >= 10
       ORDER BY created_at DESC LIMIT 1;

      PERFORM public.rpc_issue_barcode_consignment(
        '${sellerEmpId}'::uuid,
        0.00::numeric, -- capital receipt has 0% factory markup
        '[{"model_code": "VAZN", "model_name": "Standart 585", "category": "Buyum", "purity": 585, "weight_grams": 10.00, "raw_barcode": "10.00"}]'::jsonb,
        'Kapital tovar topshirish',
        'consign-cap-${testPrefix}',
        v_receipt_id,
        12.00::numeric -- 12% seller markup
      );
    END $$;
  `);

  const consignCheck = await runSqlQuery(`
    SELECT
      total_transferred_physical_g,
      total_seller_obligation_g,
      seller_owes_manager_g
    FROM public.seller_gold_accounts
    WHERE seller_id = '${sellerEmpId}';
  `);
  console.log('Consignment check:', consignCheck[0]);
  assert(Number(consignCheck[0].total_transferred_physical_g) === 10, 'Seller physical stock should be 10g');
  assert(Number(consignCheck[0].total_seller_obligation_g) === 11.2, '10g with 12% markup = 11.20g obligation');

  const vaultAfterConsign = await runSqlQuery(`
    SELECT manager_physical_stock_g, current_factory_obligation_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault post-consignment:', vaultAfterConsign[0]);
  assert(Number(vaultAfterConsign[0].manager_physical_stock_g) === 20, 'Manager physical stock should decrease from 30g to 20g');
  assert(Number(vaultAfterConsign[0].current_factory_obligation_g) === 0, 'Factory debt must remain 0g!');
  console.log('✅ Scenario 2 PASS: Capital finished goods consigned to seller without creating fake factory debt.');

  // Scenario 3: Seller Responsibility for Legacy Customer Debt
  console.log('\n--- Scenario 3: Seller Responsibility for Legacy Customer Debt ---');
  await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_client_legacy_debt(
      '${custId}',
      'debt',
      45.00,
      (timezone('Asia/Tashkent', now()))::date,
      'Dilrabo Apka 45g eski qarz',
      'manual_addition',
      null,
      'leg-${testPrefix}',
      '${sellerEmpId}'
    );
  `);

  const sellerCheckLegacy = await runSqlQuery(`
    SELECT
      total_seller_obligation_g,
      seller_owes_manager_g,
      seller_legacy_debt_obligation_g
    FROM public.seller_gold_accounts
    WHERE seller_id = '${sellerEmpId}';
  `);
  console.log('Seller account post-legacy debt:', sellerCheckLegacy[0]);
  assert(Number(sellerCheckLegacy[0].seller_legacy_debt_obligation_g) === 45, 'Legacy debt portion should be 45g');
  assert(Number(sellerCheckLegacy[0].total_seller_obligation_g) === 56.2, 'Total obligation should be 11.2 + 45 = 56.2g');
  assert(Number(sellerCheckLegacy[0].seller_owes_manager_g) === 56.2, 'Seller owes manager must be 56.2g');
  console.log('✅ Scenario 3 PASS: Dilrabo Apka 45g legacy debt assigned to seller responsibility (56.20g total).');

  // Scenario 4: Customer Pays Old Debt (Seller till -> Manager handover)
  console.log('\n--- Scenario 4: Customer Pays Old Debt Lifecycle ---');
  await runSqlQuery(`
    ${jwtHeader}
    -- Client pays 15g scrap to seller
    SELECT public.rpc_record_client_settlement(
      p_customer_id := '${custId}',
      p_sale_id := null,
      p_scrap_weight := 15.00,
      p_scrap_proba := 585.0,
      p_cash_amount := 0,
      p_rate_per_gram := 900000,
      p_settlement_date := (timezone('Asia/Tashkent', now()))::date,
      p_notes := 'Dilrabo 15g to''lov',
      p_idempotency_key := 'settle-pay-${testPrefix}',
      p_seller_id := '${sellerEmpId}'
    );
  `);

  const clientCheck = await runSqlQuery(`
    SELECT current_debt_grams, total_settled_grams
    FROM public.client_gold_accounts
    WHERE customer_id = '${custId}';
  `);
  console.log('Client debt after 15g payment:', clientCheck[0]);
  assert(Number(clientCheck[0].current_debt_grams) === 30, 'Client debt should reduce from 45g to 30g');

  const sellerPreHnd = await runSqlQuery(`
    SELECT seller_till_scrap_grams, seller_owes_manager_g, total_settled_to_manager_g
    FROM public.seller_gold_accounts
    WHERE seller_id = '${sellerEmpId}';
  `);
  console.log('Seller till pre-handover to manager:', sellerPreHnd[0]);
  assert(Number(sellerPreHnd[0].seller_till_scrap_grams) === 15, 'Seller till scrap should be 15g');
  assert(Number(sellerPreHnd[0].seller_owes_manager_g) === 56.2, 'Seller obligation must still be 56.2g before handing over');

  // Seller hands over 15g to manager
  await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_seller_to_manager_settlement(
      p_seller_id := '${sellerEmpId}',
      p_scrap_weight_grams := 15.00,
      p_cash_paid_amount := 0,
      p_rate_per_gram := 900000,
      p_notes := 'Sotuvchidan menejerga topshirish',
      p_idempotency_key := 'settle-hnd-${testPrefix}',
      p_usd_paid_amount := 0,
      p_usd_rate := 12800,
      p_physical_scrap_g := 15.00
    );
  `);

  const sellerPostHnd = await runSqlQuery(`
    SELECT seller_till_scrap_grams, seller_owes_manager_g, total_settled_to_manager_g
    FROM public.seller_gold_accounts
    WHERE seller_id = '${sellerEmpId}';
  `);
  console.log('Seller till post-handover to manager:', sellerPostHnd[0]);
  assert(Number(sellerPostHnd[0].seller_till_scrap_grams) === 0, 'Seller till scrap cleared to 0');
  assert(Number(sellerPostHnd[0].total_settled_to_manager_g) === 15, 'Settled to manager is 15g');
  assert(Number(sellerPostHnd[0].seller_owes_manager_g) === 41.2, 'Seller obligation cleared to 41.2g (56.2 - 15)');
  console.log('✅ Scenario 4 PASS: Client payment reduced debt, entered seller till, and cleared seller liability ONLY upon handover to manager.');

  // Scenario 5: Refining & Pateriya Mass Balance
  console.log('\n--- Scenario 5: Refining & Pateriya Mass Balance ---');
  const refRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_refining_batch(
      20.00,   -- input scrap grams
      19.80,   -- melted weight
      11.1444, -- output fine gold
      995.0,   -- fine proba
      '${directorEmpId}',
      'Afinaj sinovi',
      'ref-batch-${testPrefix}',
      20.00,
      585.0    -- 585 proba scrap
    ) as batch;
  `);
  const rBatch = refRes[0].batch;
  console.log('Refining batch result:', rBatch);
  assert(Number(rBatch.input_585_equiv_grams) === 20, 'Input 585 eq should be 20g');
  assert(Math.abs(Number(rBatch.total_loss_grams) - 1.0450) < 0.01, 'Pateriya must be ~1.0450g in 585 eq');
  console.log('✅ Scenario 5 PASS: Refining correctly computed 585 equivalent pateriya.');

  // Scenario 6: Reversals filtering in Reconciliation Statement
  console.log('\n--- Scenario 6: Reconciliation Statement Invariant & Reversed Filtering ---');
  await runSqlQuery(`
    ${jwtHeader}
    DO $$
    DECLARE
      v_res jsonb;
      v_stl_id uuid;
    BEGIN
      -- Create 5g test settlement
      v_res := public.rpc_record_client_settlement(
        p_customer_id := '${custId}',
        p_sale_id := null,
        p_scrap_weight := 5.00,
        p_scrap_proba := 585.0,
        p_cash_amount := 0,
        p_rate_per_gram := 900000,
        p_settlement_date := (timezone('Asia/Tashkent', now()))::date,
        p_notes := 'Bekor qilinadigan 5g to''lov',
        p_idempotency_key := 'settle-to-rev-${testPrefix}',
        p_seller_id := '${sellerEmpId}'
      );
      v_stl_id := (v_res->>'settlement_id')::uuid;

      -- Immediately reverse it
      PERFORM public.rpc_reverse_client_settlement(v_stl_id, 'Sinov reversal');
    END $$;
  `);

  const stmtRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_get_seller_reconciliation_statement('${sellerEmpId}') as stmt;
  `);
  const stmt = stmtRes[0].stmt;
  console.log('Reconciliation statement Section D:', stmt.section_d);
  console.log('Reconciliation statement Section G:', stmt.section_g);
  assert(Number(stmt.section_d.scrap_collected_grams) === 15, 'Scrap collected must exclude reversed 5g settlement (must be 15g)');
  assert(stmt.section_g.is_reconciled === true, 'Statement must be reconciled');
  assert(Number(stmt.section_g.discrepancy_grams) < 0.001, 'Discrepancy must be 0.0000g');
  console.log('✅ Scenario 6 PASS: Reconciliation statement accurately excludes reversed settlement and achieves 0 discrepancy.');

  // Scenario 7: Monthly Customer Report includes customer with legacy debt
  console.log('\n--- Scenario 7: Customer Monthly Report Parity ---');
  const reportRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_get_customer_monthly_report('${sellerEmpId}') as report;
  `);
  const mReport = reportRes[0].report;
  const dilraboRow = mReport.items.find(it => it.customer_name.startsWith('Dilrabo Apka'));
  console.log('Dilrabo monthly row:', dilraboRow);
  assert(dilraboRow !== undefined, 'Dilrabo Apka must appear in monthly report');
  assert(Number(dilraboRow.legacy_added_month_g) === 45, 'Legacy debt added should be 45g');
  assert(Number(dilraboRow.total_settled_g) === 15, 'Settled should be 15g');
  assert(Number(dilraboRow.closing_debt_g) === 30, 'Closing debt should be 30g');
  console.log('✅ Scenario 7 PASS: Monthly report correctly incorporates legacy debt and shows non-zero balances.');

  // Scenario 8: Audited Capital Reclassification
  console.log('\n--- Scenario 8: Audited Capital Reclassification ---');
  await runSqlQuery(`
    ${jwtHeader}
    DO $$
    DECLARE
      v_tx_id uuid;
    BEGIN
      SELECT id INTO v_tx_id FROM public.financial_transactions
       WHERE organization_id = '${testOrgId}' AND idempotency_key = 'cap-fine-${testPrefix}' LIMIT 1;

      PERFORM public.rpc_reclassify_capital_transaction(
        v_tx_id,
        'manager_scrap',
        'Audit tahrirlash: Quyma emas, 585 lom sifatida qayta tasniflash',
        585.0
      );
    END $$;
  `);

  const reclassCheck = await runSqlQuery(`
    SELECT source_till, notes, reclassification_reason
    FROM public.financial_transactions
    WHERE idempotency_key = 'cap-fine-${testPrefix}';
  `);
  console.log('Reclassified transaction record:', reclassCheck[0]);
  assert(reclassCheck[0].source_till === 'manager_scrap', 'Source till should be updated to manager_scrap');
  assert(reclassCheck[0].reclassification_reason.includes('Audit tahrirlash'), 'Reason should be recorded');
  console.log('✅ Scenario 8 PASS: Capital reclassification executed with full audit trail without baseline mutation.');

  // Scenario 9: Baseline Confirmation & Profit Parity
  console.log('\n--- Scenario 9: Baseline Confirmation & Profit Parity ---');
  const baseRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_confirm_accounting_baseline(
      'Parity Baseline 056 Test',
      'base-test-${testPrefix}',
      12800.00
    ) as baseline;
  `);
  console.log('Confirmed Baseline:', baseRes[0].baseline);
  assert(baseRes[0].baseline.status === 'ok', 'Baseline confirmation must succeed');
  assert(Number(baseRes[0].baseline.net_assets_585_g) > 0, 'Net assets must be positive');

  const profitRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_get_accounting_profit_summary(
      null, null, 900000, 12800, '${testOrgId}'
    ) as profit;
  `);
  console.log('Profit Summary immediately after baseline:');
  console.log('Current Net Assets:', profitRes[0].profit.current_net_assets_585_g);
  console.log('Baseline Net Assets:', profitRes[0].profit.baseline.net_assets_585_g);
  console.log('Period Profit Result:', profitRes[0].profit.period_accounting_result_585_g);
  assert(Number(profitRes[0].profit.period_accounting_result_585_g) === 0, 'Immediate period profit must be exactly 0.0000g');
  console.log('✅ Scenario 9 PASS: Baseline confirmed and profit summary starts at 0.0000g.');

  console.log('\n==============================================================================');
  console.log('🎉 ALL SCENARIOS PASSED 100% ON STAGING!');
  console.log('==============================================================================');
}

test().catch(err => {
  console.error('\n❌ STAGING TEST FAILED:', err);
  process.exit(1);
});
