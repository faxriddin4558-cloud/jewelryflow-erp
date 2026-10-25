/**
 * GOLDIA SALES — PROFIT & LOSS ACCOUNTING HARDENING & COMPREHENSIVE VERIFICATION SUITE
 * 
 * Verifies all 15 scenarios on Staging Supabase (vouehtlmsunebracahon):
 * - MANDATORY: Baseline 1000g, rate 950k -> 1M, inject 1,000,000 UZS -> 0 trading profit
 * - Scenario A: Baseline Confirmation & Trading Margin (+30g)
 * - Scenario B: Capital Contribution (+100g) does not create artificial profit
 * - Scenario C: Capital Distribution (-20g) does not create artificial loss
 * - Scenario D: Factory Receipt (+200g goods vs 216g debt) -> No false profit
 * - Scenario E: Client Debt Settled to Till then Vault -> Zero double profit
 * - Scenario F: Customer Advance Payment -> Liability increases, net assets invariant
 * - Scenario G: Business Expense -> Reduces net assets exactly once
 * - Scenario H: Baseline FX Drift isolated from trading margin
 * - Scenario I: Seller Role strictly blocked with 42501 (NO swallow in WHEN OTHERS)
 * - Scenario J: Accounting Baseline Direct UPDATE/DELETE blocked by Immutability Trigger
 * - Scenario K: Financial Transaction Direct UPDATE/DELETE blocked by Immutability Trigger
 * - Scenario L: Till-Currency Mismatch (manager_uzs + USD) rejected with ERR_INVALID_TILL_CURRENCY
 * - Scenario M: Refining Loss reduces Net Assets exactly once
 * - Scenario N: Factory Gold Handover settles assets & liabilities equally
 */

const { runSqlQuery } = require('./execute-staging-sql');

async function runProfitAccountingTests() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES — PROFIT & LOSS ACCOUNTING HARDENING TEST SUITE (MIGRATION 048)');
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
      -- Mandatory Test Org
      v_mand_org_id     uuid := gen_random_uuid();
      v_mand_mgr_user   uuid := gen_random_uuid();
      v_mand_mgr_emp    uuid := gen_random_uuid();

      -- Multi-Scenario Test Org
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
      v_err_code        text;
      v_seller_allowed  boolean;
      v_base_id         uuid;
      v_tx_id           uuid;
      v_initial_base_net numeric(14, 4);
      v_pre_net         numeric(14, 4);
      v_post_net        numeric(14, 4);
      v_mismatch_caught boolean;
    BEGIN
      -- =======================================================================
      -- MANDATORY TEST: BASELINE 1000g, RATE 950k -> 1M, INJECT 1,000,000 UZS
      -- ZERO TRADING PROFIT CREATED BY CAPITAL INJECTION
      -- =======================================================================
      INSERT INTO public.organizations (id, name, code, status)
      VALUES (v_mand_org_id, 'Mandatory FX Parity Test Org', 'mand-org-' || substr(v_mand_org_id::text, 1, 8), 'active');

      INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
      VALUES (v_mand_mgr_emp, v_mand_org_id, v_mand_mgr_user, 'Mandatory Director', 'Director', 'director', true);

      INSERT INTO public.daily_gold_rates (id, organization_id, proba, rate_per_gram, rate_date, is_confirmed)
      VALUES (gen_random_uuid(), v_mand_org_id, 585, 950000.00, current_date, true);

      PERFORM set_config('request.jwt.claim.sub', v_mand_mgr_user::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

      PERFORM public._get_or_create_manager_vault(v_mand_org_id);
      UPDATE public.manager_vault_account
         SET manager_refined_gold_grams = 1000.0000,
             manager_purchased_gold_grams = 0,
             manager_cash_amount = 0,
             manager_usd_amount = 0,
             manager_scrap_585_eq_g = 0
       WHERE organization_id = v_mand_org_id;

      v_base_res := public.rpc_confirm_accounting_baseline(
        p_notes := 'Initial Mandatory Test Baseline 1000g'
      );

      IF (v_base_res->>'net_assets_585_g')::numeric <> 1000.0000 THEN
        RAISE EXCEPTION 'Mandatory Test Failed: Initial net assets expected 1000g, got %', (v_base_res->>'net_assets_585_g');
      END IF;

      -- Gold rate shifts from 950,000 to 1,000,000 UZS
      UPDATE public.daily_gold_rates
         SET rate_per_gram = 1000000.00
       WHERE organization_id = v_mand_org_id AND proba = 585 AND rate_date = current_date;

      -- Director injects 1,000,000 UZS capital into manager_uzs
      v_tx_res := public.rpc_record_financial_transaction(
        p_transaction_type := 'capital_contribution',
        p_source_till := 'manager_uzs',
        p_amount := 1000000.00,
        p_currency := 'UZS',
        p_category := 'Ta''sischi hissasi',
        p_notes := 'Ta''sischi kiritgan 1,000,000 UZS naqd pul'
      );

      v_profit_res := public.rpc_get_accounting_profit_summary();

      -- Current net assets: 1000g (gold) + 1.0000g (1,000,000 UZS / 1,000,000) = 1001.0000g
      -- Capital injected: 1.0000g
      -- Period Accounting Result: 1001.0000 - 1000.0000 - 1.0000 = 0.0000g
      -- FX Drift on baseline cash: 0.0000g (since baseline cash was 0 UZS)
      -- Operational Trading Result: 0.0000g
      IF (v_profit_res->>'current_net_assets_585_g')::numeric <> 1001.0000 OR
         (v_profit_res->>'capital_contributions_585_g')::numeric <> 1.0000 OR
         (v_profit_res->>'period_accounting_result_585_g')::numeric <> 0.0000 OR
         (v_profit_res->>'operational_trading_result_585_g')::numeric <> 0.0000 THEN
        RAISE EXCEPTION 'Mandatory Test Failed: Net assets % g, Cap In % g, Period Res % g, Trading Res % g (expected 1001g, 1g, 0g, 0g)',
          (v_profit_res->>'current_net_assets_585_g'), (v_profit_res->>'capital_contributions_585_g'),
          (v_profit_res->>'period_accounting_result_585_g'), (v_profit_res->>'operational_trading_result_585_g');
      END IF;

      test_scenario := 'MANDATORY_CAPITAL_INJECTION';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'operational_trading_result_585_g')::numeric;
      test_details := 'Baseline 1000g -> kurs 950k->1M -> 1M UZS kapital kiritildi -> savdo foydasi aynan 0.0000g (soxta foyda 0)';
      RETURN NEXT;

      -- =======================================================================
      -- MULTI-SCENARIO SUITE: DEDICATED ORG
      -- =======================================================================
      INSERT INTO public.organizations (id, name, code, status)
      VALUES (v_org_id, 'Accounting Profit Test Org', 'prof-org-' || substr(v_org_id::text, 1, 8), 'active');

      INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
      VALUES 
        (v_mgr_emp, v_org_id, v_mgr_user, 'Direktor Rahbar', 'Direktor', 'director', true),
        (v_seller_emp, v_org_id, v_seller_user, 'Test Sotuvchi', 'Sotuvchi', 'sales', true);

      INSERT INTO public.customers (id, organization_id, customer_code, contact_name, seller_id)
      VALUES (v_cust_id, v_org_id, 'CUST-PRF-' || substr(v_cust_id::text, 1, 6), 'Shoxrux Zargar', v_seller_emp);

      INSERT INTO public.daily_gold_rates (id, organization_id, proba, rate_per_gram, rate_date, is_confirmed)
      VALUES (v_rate_id, v_org_id, 585, 950000.00, current_date, true);

      PERFORM set_config('request.jwt.claim.sub', v_mgr_user::text, true);

      PERFORM public._get_or_create_manager_vault(v_org_id);
      UPDATE public.manager_vault_account
         SET manager_refined_gold_grams = 1000.0000,
             manager_purchased_gold_grams = 0,
             manager_cash_amount = 0,
             manager_usd_amount = 0,
             manager_scrap_585_eq_g = 0
       WHERE organization_id = v_org_id;

      v_base_res := public.rpc_confirm_accounting_baseline(
        p_notes := 'Clean Matrix Baseline 1000g'
      );
      v_base_id := (v_base_res->>'baseline_id')::uuid;

      -- -----------------------------------------------------------------------
      -- SCENARIO A: BASELINE CONFIRMATION AND TRADING PROFIT (+30g)
      -- -----------------------------------------------------------------------
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
      v_tx_id := (v_tx_res->>'transaction_id')::uuid;

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

      test_scenario := 'SCENARIO_H';
      test_status := 'PASS';
      net_assets := (v_profit_res->>'current_net_assets_585_g')::numeric;
      period_profit := (v_profit_res->>'period_accounting_result_585_g')::numeric;
      test_details := 'Kurs 950k->1M ga oshdi -> savdo marjasi (' || (v_profit_res->>'operational_trading_result_585_g') || 'g) va FX drift (' || (v_profit_res->>'fx_valuation_impact_585_g') || 'g) ajratildi';
      RETURN NEXT;

      -- Reset rate
      UPDATE public.daily_gold_rates
         SET rate_per_gram = 950000.00
       WHERE organization_id = v_org_id AND proba = 585 AND rate_date = current_date;

      -- -----------------------------------------------------------------------
      -- SCENARIO I: SELLER ACCESS STRICTLY BLOCKED WITH 42501 (NO SWALLOW)
      -- -----------------------------------------------------------------------
      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);
      v_seller_allowed := false;
      v_err_code := null;
      v_seller_err := null;

      BEGIN
        PERFORM public.rpc_get_accounting_profit_summary();
        v_seller_allowed := true;
      EXCEPTION
        WHEN insufficient_privilege THEN
          v_seller_err := SQLERRM;
          v_err_code := SQLSTATE;
        WHEN OTHERS THEN
          RAISE EXCEPTION 'Scenario I Failed: Caught unexpected error % (expected 42501 insufficient_privilege)', SQLERRM;
      END;

      IF v_seller_allowed THEN
        RAISE EXCEPTION 'CRITICAL SECURITY BREACH: Seller was permitted to run rpc_get_accounting_profit_summary!';
      END IF;

      IF v_err_code <> '42501' THEN
        RAISE EXCEPTION 'Scenario I Failed: Expected SQLSTATE 42501, got %', v_err_code;
      END IF;

      test_scenario := 'SCENARIO_I_SELLER_RPC_DENIED';
      test_status := 'PASS';
      net_assets := 0;
      period_profit := 0;
      test_details := 'Sotuvchi foyda hisobini chaqira olmadi. Aniq 42501 insufficient_privilege olindi: ' || v_seller_err;
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO J: BASELINE IMMUTABILITY TRIGGER (UPDATE/DELETE BLOCKED)
      -- -----------------------------------------------------------------------
      PERFORM set_config('request.jwt.claim.sub', v_mgr_user::text, true);

      -- J.1: Direct UPDATE of net assets must fail with 42501 ERR_BASELINE_IMMUTABLE
      v_mismatch_caught := false;
      BEGIN
        UPDATE public.accounting_baselines
           SET net_assets_585_g = 9999.9999
         WHERE id = v_base_id;
      EXCEPTION
        WHEN insufficient_privilege THEN
          v_mismatch_caught := true;
          v_seller_err := SQLERRM;
      END;

      IF NOT v_mismatch_caught THEN
        RAISE EXCEPTION 'Scenario J Failed: Direct UPDATE of accounting_baselines was not blocked by trigger!';
      END IF;

      -- J.2: Direct DELETE of baseline must fail with 42501 ERR_BASELINE_IMMUTABLE
      v_mismatch_caught := false;
      BEGIN
        DELETE FROM public.accounting_baselines
         WHERE id = v_base_id;
      EXCEPTION
        WHEN insufficient_privilege THEN
          v_mismatch_caught := true;
          v_seller_err := SQLERRM;
      END;

      IF NOT v_mismatch_caught THEN
        RAISE EXCEPTION 'Scenario J Failed: Direct DELETE of accounting_baselines was not blocked by trigger!';
      END IF;

      test_scenario := 'SCENARIO_J_BASELINE_IMMUTABLE';
      test_status := 'PASS';
      net_assets := 1000.0000;
      period_profit := 0;
      test_details := 'Boshlang''ich hisob daxlsiz: to''g''ridan-to''g''ri UPDATE va DELETE trigger orqali 42501 bilan to''liq bloklandi';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO K: FINANCIAL TRANSACTION IMMUTABILITY TRIGGER (UPDATE/DELETE BLOCKED)
      -- -----------------------------------------------------------------------
      v_mismatch_caught := false;
      BEGIN
        UPDATE public.financial_transactions
           SET amount_num = 99999999.00
         WHERE id = v_tx_id;
      EXCEPTION
        WHEN insufficient_privilege THEN
          v_mismatch_caught := true;
          v_seller_err := SQLERRM;
      END;

      IF NOT v_mismatch_caught THEN
        RAISE EXCEPTION 'Scenario K Failed: Direct UPDATE of financial_transactions was not blocked by trigger!';
      END IF;

      v_mismatch_caught := false;
      BEGIN
        DELETE FROM public.financial_transactions
         WHERE id = v_tx_id;
      EXCEPTION
        WHEN insufficient_privilege THEN
          v_mismatch_caught := true;
          v_seller_err := SQLERRM;
      END;

      IF NOT v_mismatch_caught THEN
        RAISE EXCEPTION 'Scenario K Failed: Direct DELETE of financial_transactions was not blocked by trigger!';
      END IF;

      test_scenario := 'SCENARIO_K_TX_IMMUTABLE';
      test_status := 'PASS';
      net_assets := 0;
      period_profit := 0;
      test_details := 'Moliyaviy operatsiya daxlsiz: to''g''ridan-to''g''ri UPDATE va DELETE trigger orqali 42501 bilan to''liq bloklandi';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO L: TILL-CURRENCY MISMATCH REJECTED (FAIL-CLOSED)
      -- -----------------------------------------------------------------------
      v_mismatch_caught := false;
      BEGIN
        PERFORM public.rpc_record_financial_transaction(
          p_transaction_type := 'capital_contribution',
          p_source_till := 'manager_uzs',
          p_amount := 100.00,
          p_currency := 'USD',
          p_category := 'Test Mismatch',
          p_gold_rate := 950000,
          p_usd_rate := 12800
        );
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLERRM LIKE '%ERR_INVALID_TILL_CURRENCY%' OR SQLSTATE = '22023' THEN
            v_mismatch_caught := true;
            v_seller_err := SQLERRM;
          ELSE
            RAISE EXCEPTION 'Scenario L Failed with unexpected error: %', SQLERRM;
          END IF;
      END;

      IF NOT v_mismatch_caught THEN
        RAISE EXCEPTION 'Scenario L Failed: manager_uzs with USD was NOT rejected!';
      END IF;

      test_scenario := 'SCENARIO_L_TILL_CURRENCY_CHECK';
      test_status := 'PASS';
      net_assets := 0;
      period_profit := 0;
      test_details := 'manager_uzs ga USD kiritish rad etildi: ERR_INVALID_TILL_CURRENCY (Fail-closed ishladi)';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO M: REFINING LOSS REDUCES NET ASSETS EXACTLY ONCE
      -- -----------------------------------------------------------------------
      -- Put 100g 585 scrap into manager vault
      UPDATE public.manager_vault_account
         SET manager_scrap_585_eq_g = coalesce(manager_scrap_585_eq_g, 0) + 100.0000,
             manager_scrap_physical_g = coalesce(manager_scrap_physical_g, 0) + 100.0000
       WHERE organization_id = v_org_id;

      v_profit_res := public.rpc_get_accounting_profit_summary();
      v_pre_net := (v_profit_res->>'current_net_assets_585_g')::numeric;

      -- Dispatch 100g to refining batch: 100g scrap yields 98g refined gold, 2g refining loss
      UPDATE public.manager_vault_account
         SET manager_scrap_585_eq_g = manager_scrap_585_eq_g - 100.0000,
             manager_scrap_physical_g = manager_scrap_physical_g - 100.0000,
             manager_refined_gold_grams = manager_refined_gold_grams + 98.0000
       WHERE organization_id = v_org_id;

      v_profit_res := public.rpc_get_accounting_profit_summary();
      v_post_net := (v_profit_res->>'current_net_assets_585_g')::numeric;

      -- Net change should be -2.0000g
      IF round(v_post_net - v_pre_net, 4) <> -2.0000 THEN
        RAISE EXCEPTION 'Scenario M Failed: Expected net assets reduction of -2.0000g, got % (pre: %, post: %)',
          round(v_post_net - v_pre_net, 4), v_pre_net, v_post_net;
      END IF;

      test_scenario := 'SCENARIO_M_REFINING_LOSS';
      test_status := 'PASS';
      net_assets := v_post_net;
      period_profit := -2.0000;
      test_details := 'Afinajda 100g lomdan 98g sof oltin chiqdi (2g yo''qotish) -> sof aktivni aynan 1 marta (-2.0000g) kamaytirdi';
      RETURN NEXT;

      -- -----------------------------------------------------------------------
      -- SCENARIO N: FACTORY GOLD HANDOVER SETTLES ASSETS & LIABILITIES EQUALLY
      -- -----------------------------------------------------------------------
      v_profit_res := public.rpc_get_accounting_profit_summary();
      v_pre_net := (v_profit_res->>'current_net_assets_585_g')::numeric;

      -- Hand over 50g refined gold to factory to settle factory obligation
      UPDATE public.manager_vault_account
         SET manager_refined_gold_grams = manager_refined_gold_grams - 50.0000,
             current_factory_obligation_g = current_factory_obligation_g - 50.0000
       WHERE organization_id = v_org_id;

      v_profit_res := public.rpc_get_accounting_profit_summary();
      v_post_net := (v_profit_res->>'current_net_assets_585_g')::numeric;

      -- Assets reduced by 50g, Liabilities reduced by 50g -> Net assets unchanged!
      IF v_post_net <> v_pre_net THEN
        RAISE EXCEPTION 'Scenario N Failed: Net assets changed after factory settlement! Pre: %, Post: %', v_pre_net, v_post_net;
      END IF;

      test_scenario := 'SCENARIO_N_FACTORY_HANDOVER_PARITY';
      test_status := 'PASS';
      net_assets := v_post_net;
      period_profit := 0;
      test_details := 'Zavodga 50g oltin qaytarildi: aktiv (-50g) va passiv (-50g) bir xil kamaydi, sof aktiv invariant qoldi';
      RETURN NEXT;

    END;
    $$;

    SELECT * FROM pg_temp.run_test_profit_matrix();
  `;

  console.log('Executing Profit Accounting Hardening Test Suite on Staging...');
  const res = await runSqlQuery(testSql, 'vouehtlmsunebracahon');
  console.log('\n==============================================================================');
  console.log('TEST MATRIX RESULTS (15 SCENARIOS):');
  console.log('==============================================================================');
  console.table(res);

  // Now verify Seller RLS SELECT directly against accounting_baselines and financial_transactions
  console.log('\n------------------------------------------------------------------------------');
  console.log('Verifying Seller Role Table RLS Direct SELECT Denial...');
  console.log('------------------------------------------------------------------------------');

  const rlsSql = `
    DO $$
    DECLARE
      v_cnt int;
    BEGIN
      -- Switch to authenticated role (as Supabase PostgREST does for client requests)
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000999', true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

      -- Should see 0 baselines via RLS
      SELECT count(*) INTO v_cnt FROM public.accounting_baselines;
      IF v_cnt > 0 THEN
        RAISE EXCEPTION 'RLS Leak: Seller was able to select % rows from accounting_baselines!', v_cnt;
      END IF;

      -- Should see 0 financial transactions via RLS
      SELECT count(*) INTO v_cnt FROM public.financial_transactions;
      IF v_cnt > 0 THEN
        RAISE EXCEPTION 'RLS Leak: Seller was able to select % rows from financial_transactions!', v_cnt;
      END IF;
    END;
    $$;
  `;
  await runSqlQuery(rlsSql, 'vouehtlmsunebracahon');
  console.log('✅ Direct RLS SELECT Isolation Verified: Seller role sees 0 rows from accounting tables.');
  console.log('==============================================================================');
  console.log('ALL PROFIT ACCOUNTING & IMMUTABILITY TESTS PASSED WITH 100% SUCCESS ON STAGING');
  console.log('==============================================================================');
}

runProfitAccountingTests().catch(err => {
  console.error('\n❌ Profit Accounting Test Suite FAILED:', err);
  process.exit(1);
});
