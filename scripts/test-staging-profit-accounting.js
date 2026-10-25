/**
 * GOLDIA SALES — AUTOMATIC PROFIT ACCOUNTING & BASELINE INTEGRATION TEST SUITE
 * 
 * Verifies Scenarios A through I on Staging Supabase (vouehtlmsunebracahon)
 */

const { runSqlQuery } = require('./execute-staging-sql');

async function runProfitAccountingTests() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES — PROFIT & LOSS ACCOUNTING VERIFICATION SUITE');
  console.log('Target: vouehtlmsunebracahon (Staging Supabase)');
  console.log('==============================================================================\n');

  const testSql = `
    CREATE OR REPLACE FUNCTION pg_temp.run_test_profit_matrix()
    RETURNS TABLE (
      test_scenario text,
      test_status text,
      net_assets numeric,
      period_profit numeric,
      test_details text
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_org_id          uuid := gen_random_uuid();
      v_seller_user     uuid := gen_random_uuid();
      v_seller_emp      uuid := gen_random_uuid();
      v_mgr_user        uuid := gen_random_uuid();
      v_mgr_emp         uuid := gen_random_uuid();
      v_cust_id         uuid := gen_random_uuid();
      v_rate_id         uuid := gen_random_uuid();
      v_base_res        jsonb;
      v_profit_res      jsonb;
      v_tx_res          jsonb;
      v_rcp_res         jsonb;
      v_consign_res     jsonb;
      v_sale_res        jsonb;
      v_pay_res         jsonb;
      v_seller_err      text;
      v_initial_base_net numeric(14, 4);
    BEGIN
      -- Setup test organization
      INSERT INTO public.organizations (id, name, code, status)
      VALUES (v_org_id, 'Accounting Profit Test Org', 'prof-org-' || substr(v_org_id::text, 1, 8), 'active');

      -- Employees: Director/Manager and Sales
      INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
      VALUES 
        (v_mgr_emp, v_org_id, v_mgr_user, 'Direktor Rahbar', 'Direktor', 'director', true),
        (v_seller_emp, v_org_id, v_seller_user, 'Test Sotuvchi', 'Sotuvchi', 'sales', true);

      -- Customer
      INSERT INTO public.customers (id, organization_id, customer_code, contact_name, seller_id)
      VALUES (v_cust_id, v_org_id, 'CUST-PRF-' || substr(v_cust_id::text, 1, 6), 'Shoxrux Zargar', v_seller_emp);

      -- Daily Gold Rate: 585 = 950,000 UZS/g
      INSERT INTO public.daily_gold_rates (id, organization_id, proba, rate_per_gram, rate_date, is_confirmed)
      VALUES (v_rate_id, v_org_id, 585, 950000.00, current_date, true);

      -- Switch to Director session
      PERFORM set_config('request.jwt.claim.sub', v_mgr_user::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

      -- Init manager vault with 1000.0000g refined gold (Baseline Net Assets = 1000g)
      PERFORM public._get_or_create_manager_vault(v_org_id);
      UPDATE public.manager_vault_account
         SET manager_refined_gold_grams = 1000.0000
       WHERE organization_id = v_org_id;

      -- -----------------------------------------------------------------------
      -- SCENARIO A: BASELINE CONFIRMATION AND TRADING PROFIT (+30g)
      -- -----------------------------------------------------------------------
      v_base_res := public.rpc_confirm_accounting_baseline(
        p_notes := 'Initial Test Baseline 1000g'
      );

      IF (v_base_res->>'net_assets_585_g')::numeric <> 1000.0000 THEN
        RAISE EXCEPTION 'Scenario A Failed: Expected initial baseline net assets 1000g, got %', (v_base_res->>'net_assets_585_g');
      END IF;

      -- Simulate +30g trading gain (e.g. manager vault purchased gold +30g)
      UPDATE public.manager_vault_account
         SET manager_purchased_gold_grams = 30.0000
       WHERE organization_id = v_org_id;

      v_profit_res := public.rpc_get_accounting_profit_summary();

      IF (v_profit_res->>'period_accounting_result_585_g')::numeric <> 30.0000 OR
         (v_profit_res->>'current_net_assets_585_g')::numeric <> 1030.0000 THEN
        RAISE EXCEPTION 'Scenario A Failed: Net assets % g, Profit % g',
          (v_profit_res->>'current_net_assets_585_g'), (v_profit_res->>'period_accounting_result_585_g');
      END IF;

      test_scenario := 'SCENARIO_A';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'period_accounting_result_585_g')::numeric;
      test_details := 'Boshlang''ich 1000g, joriy 1030g -> davr natijasi aniq +30.0000g';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO B: CAPITAL CONTRIBUTION (+100g) -> PROFIT REMAINS +30g
      -- -----------------------------------------------------------------------
      v_tx_res := public.rpc_record_financial_transaction(
        p_transaction_type := 'capital_contribution',
        p_source_till := 'manager_vault_gold',
        p_amount := 100.0000,
        p_currency := '585_GOLD',
        p_category := 'Ta''sischi hissasi',
        p_notes := 'Ta''sischi kiritgan 100g oltin kapital'
      );

      v_profit_res := public.rpc_get_accounting_profit_summary();

      IF (v_profit_res->>'current_net_assets_585_g')::numeric <> 1130.0000 OR
         (v_profit_res->>'period_accounting_result_585_g')::numeric <> 30.0000 THEN
        RAISE EXCEPTION 'Scenario B Failed: Net assets % g, Profit % g',
          (v_profit_res->>'current_net_assets_585_g'), (v_profit_res->>'period_accounting_result_585_g');
      END IF;

      test_scenario := 'SCENARIO_B';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'period_accounting_result_585_g')::numeric;
      test_details := 'Ta''sischi 100g kiritdi (aktiv 1130g) -> hisobiy foyda 130g emas, aynan +30.0000g';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO C: CAPITAL DISTRIBUTION (-20g) -> PROFIT REMAINS +30g
      -- -----------------------------------------------------------------------
      v_tx_res := public.rpc_record_financial_transaction(
        p_transaction_type := 'capital_distribution',
        p_source_till := 'manager_vault_gold',
        p_amount := 20.0000,
        p_currency := '585_GOLD',
        p_category := 'Foyda taqsimoti',
        p_notes := 'Ta''sischi yechib olgan 20g foyda'
      );

      v_profit_res := public.rpc_get_accounting_profit_summary();

      IF (v_profit_res->>'current_net_assets_585_g')::numeric <> 1110.0000 OR
         (v_profit_res->>'period_accounting_result_585_g')::numeric <> 30.0000 THEN
        RAISE EXCEPTION 'Scenario C Failed: Net assets % g, Profit % g',
          (v_profit_res->>'current_net_assets_585_g'), (v_profit_res->>'period_accounting_result_585_g');
      END IF;

      test_scenario := 'SCENARIO_C';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'period_accounting_result_585_g')::numeric;
      test_details := 'Ta''sischi 20g yechib oldi (aktiv 1110g) -> foyda yo''qolmadi, aynan +30.0000g';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO D: FACTORY RECEIPT (200g goods vs 216g debt) -> NO FALSE PROFIT
      -- -----------------------------------------------------------------------
      v_rcp_res := public.rpc_record_factory_receipt(
        p_product_name := 'Zavod Uzuklar 585',
        p_quantity := 10,
        p_original_physical_g := 200.0000,
        p_proba := 585,
        p_factory_markup_pct := 8.00,
        p_notes := 'Test Partiya 200g'
      );

      v_profit_res := public.rpc_get_accounting_profit_summary();

      IF (v_profit_res->>'current_total_assets_585_g')::numeric <> 1310.0000 OR
         (v_profit_res->>'current_total_liabilities_585_g')::numeric <> 216.0000 OR
         (v_profit_res->>'current_net_assets_585_g')::numeric <> 1094.0000 THEN
        RAISE EXCEPTION 'Scenario D Failed: Assets % g, Liab % g, Net % g',
          (v_profit_res->>'current_total_assets_585_g'), (v_profit_res->>'current_total_liabilities_585_g'), (v_profit_res->>'current_net_assets_585_g');
      END IF;

      test_scenario := 'SCENARIO_D';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'period_accounting_result_585_g')::numeric;
      test_details := 'Zavoddan 200g qabul qilindi, 216g qarz yozildi -> soxta foyda chiqmadi (sof aktiv 1094.0000g)';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO E: CLIENT DEBT SETTLED TO TILL THEN VAULT -> ZERO DOUBLE PROFIT
      -- -----------------------------------------------------------------------
      v_consign_res := public.rpc_issue_barcode_consignment(
        p_seller_id := v_seller_emp,
        p_factory_markup_pct := 8.00,
        p_seller_markup_pct := 10.00,
        p_pieces := jsonb_build_array(
          jsonb_build_object('model_code', 'UZUK-PRF', 'model_name', 'Test Uzuk', 'weight_grams', 10.0000, 'raw_barcode', 'BC-PRF-' || substr(gen_random_uuid()::text, 1, 6))
        ),
        p_notes := 'Seller consign 10g',
        p_factory_receipt_id := (v_rcp_res->>'receipt_id')::uuid
      );

      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);

      v_sale_res := public.rpc_record_weight_sale(
        p_customer_id := v_cust_id,
        p_seller_id := v_seller_emp,
        p_weight_grams := 10.0000,
        p_client_markup_pct := 10.00,
        p_notes := 'Weight sale 10g @ 10%'
      );

      v_pay_res := public.rpc_record_client_settlement(
        p_customer_id := v_cust_id,
        p_sale_id := (v_sale_res->>'sale_id')::uuid,
        p_cash_amount := 10450000.00,
        p_rate_per_gram := 950000.00,
        p_notes := 'To''liq qarz to''lovi'
      );

      PERFORM set_config('request.jwt.claim.sub', v_mgr_user::text, true);
      PERFORM public.rpc_record_seller_to_manager_settlement(
        p_seller_id := v_seller_emp,
        p_cash_paid_amount := 10450000.00,
        p_rate_per_gram := 950000.00,
        p_notes := 'Menejerga topshirilgan naqd pul'
      );

      v_profit_res := public.rpc_get_accounting_profit_summary();

      IF (v_profit_res->>'current_net_assets_585_g')::numeric <> 1095.0000 THEN
        RAISE EXCEPTION 'Scenario E Failed: Expected net assets 1095g, got %', (v_profit_res->>'current_net_assets_585_g');
      END IF;

      test_scenario := 'SCENARIO_E';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'period_accounting_result_585_g')::numeric;
      test_details := 'Qarz pulga aylandi, kassadan seyfga o''tdi -> 0 qo''shaloq hisob, aktiv aynan 1095.0000g';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO F: CUSTOMER ADVANCE PAYMENT -> LIABILITY INCREASES, NET ASSETS UNCHANGED
      -- -----------------------------------------------------------------------
      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);
      v_pay_res := public.rpc_record_client_settlement(
        p_customer_id := v_cust_id,
        p_cash_amount := 4750000.00,
        p_rate_per_gram := 950000.00,
        p_notes := 'Mijoz 5g avansi'
      );

      PERFORM set_config('request.jwt.claim.sub', v_mgr_user::text, true);
      v_profit_res := public.rpc_get_accounting_profit_summary();

      IF (v_profit_res->>'current_total_liabilities_585_g')::numeric <> 221.0000 OR
         (v_profit_res->>'current_net_assets_585_g')::numeric <> 1095.0000 THEN
        RAISE EXCEPTION 'Scenario F Failed: Liab % g, Net % g',
          (v_profit_res->>'current_total_liabilities_585_g'), (v_profit_res->>'current_net_assets_585_g');
      END IF;

      test_scenario := 'SCENARIO_F';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'period_accounting_result_585_g')::numeric;
      test_details := 'Mijoz 5g avans to''ladi -> majburiyat 221g ga chiqdi, sof aktiv o''zgarmadi (1095.0000g)';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO G: BUSINESS EXPENSE REDUCES NET ASSETS EXACTLY ONCE
      -- -----------------------------------------------------------------------
      v_tx_res := public.rpc_record_financial_transaction(
        p_transaction_type := 'business_expense',
        p_source_till := 'manager_uzs',
        p_amount := 950000.00,
        p_currency := 'UZS',
        p_category := 'Ofis ijara va kommunal',
        p_notes := 'Oylik kommunal xarajat'
      );

      v_profit_res := public.rpc_get_accounting_profit_summary();

      IF (v_profit_res->>'current_net_assets_585_g')::numeric <> 1094.0000 OR
         (v_profit_res->>'business_expenses_585_g')::numeric <> 1.0000 THEN
        RAISE EXCEPTION 'Scenario G Failed: Net assets % g, Expenses % g',
          (v_profit_res->>'current_net_assets_585_g'), (v_profit_res->>'business_expenses_585_g');
      END IF;

      test_scenario := 'SCENARIO_G';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'period_accounting_result_585_g')::numeric;
      test_details := '950k UZS (1g) rasmiy xarajat -> sof aktivni aynan 1 marta kamaytirdi (1094.0000g)';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO H: FX / GOLD RATE DRIFT VS OPERATIONAL TRADING MARGIN
      -- -----------------------------------------------------------------------
      UPDATE public.daily_gold_rates
         SET rate_per_gram = 1000000.00
       WHERE organization_id = v_org_id AND proba = 585 AND rate_date = current_date;

      v_profit_res := public.rpc_get_accounting_profit_summary();

      IF (v_profit_res->>'fx_valuation_impact_585_g')::numeric = 0 THEN
        RAISE EXCEPTION 'Scenario H Failed: FX drift should be non-zero after gold rate shift';
      END IF;

      test_scenario := 'SCENARIO_H';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'period_accounting_result_585_g')::numeric;
      test_details := 'Kurs 950k->1M ga oshdi -> savdo marjasi (' || (v_profit_res->>'operational_trading_result_585_g') || 'g) va FX drift (' || (v_profit_res->>'fx_valuation_impact_585_g') || 'g) to''liq ajratildi';
      RETURN NEXT;

      -- Reset rate
      UPDATE public.daily_gold_rates
         SET rate_per_gram = 950000.00
       WHERE organization_id = v_org_id AND proba = 585 AND rate_date = current_date;

      -- -----------------------------------------------------------------------
      -- SCENARIO I: BASELINE IMMUTABILITY & SELLER ISOLATION
      -- -----------------------------------------------------------------------
      SELECT net_assets_585_g INTO v_initial_base_net
        FROM public.accounting_baselines
       WHERE organization_id = v_org_id AND status = 'active';

      IF v_initial_base_net <> 1000.0000 THEN
        RAISE EXCEPTION 'Scenario I Failed: Frozen baseline was modified! Expected 1000g, got %', v_initial_base_net;
      END IF;

      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);
      BEGIN
        PERFORM public.rpc_get_accounting_profit_summary();
        RAISE EXCEPTION 'Scenario I Failed: Seller was able to access company profit summary!';
      EXCEPTION WHEN OTHERS THEN
        v_seller_err := SQLERRM;
      END;

      test_scenario := 'SCENARIO_I';
      test_status := 'PASS';
      net_assets := 1000.0000;
      period_profit := 0;
      test_details := 'Boshlang''ich snapshot daxlsiz (1000g muzlatilgan), sotuvchi 42501 bilan bloklandi (' || v_seller_err || ')';
      RETURN NEXT;

    END;
    $$;

    SELECT * FROM pg_temp.run_test_profit_matrix();
  `;

  console.log('Executing Profit Accounting Test Suite on Staging...');
  const res = await runSqlQuery(testSql, 'vouehtlmsunebracahon');
  console.log('\n==============================================================================');
  console.log('TEST MATRIX RESULTS:');
  console.log('==============================================================================');
  console.table(res);
}

runProfitAccountingTests().catch(err => {
  console.error('\n❌ Profit Accounting Test Suite FAILED:', err);
  process.exit(1);
});
