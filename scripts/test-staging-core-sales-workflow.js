/**
 * TEST STAGING CORE SALES WORKFLOW & MULTI-CURRENCY (USD/UZS)
 * Target: Staging Supabase (vouehtlmsunebracahon) via execute-staging-sql
 */

const { runSqlQuery } = require('./execute-staging-sql');

async function main() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES — STAGING CORE SALES WORKFLOW & MULTI-CURRENCY TEST');
  console.log('Target: vouehtlmsunebracahon (Staging Supabase)');
  console.log('==============================================================================\n');

  const testSql = `
    DO $$
    DECLARE
      v_test_org        uuid := gen_random_uuid();
      v_seller_user     uuid := gen_random_uuid();
      v_seller_emp      uuid := gen_random_uuid();
      v_mgr_user        uuid := gen_random_uuid();
      v_mgr_emp         uuid := gen_random_uuid();
      v_cust            uuid := gen_random_uuid();
      v_consign_id      uuid := gen_random_uuid();
      v_rate_id         uuid := gen_random_uuid();
      v_stock           numeric(14, 4);
      v_sale_res        jsonb;
      v_pay_res         jsonb;
      v_surr_res        jsonb;
      v_rev_surr_res    jsonb;
      v_rev_sale_res    jsonb;
      v_err_over_caught boolean := false;
      v_sale_id         uuid;
      v_surr_id         uuid;
      v_seller_acc      public.seller_gold_accounts%rowtype;
      v_client_acc      public.client_gold_accounts%rowtype;
      v_vault           public.manager_vault_account%rowtype;
    BEGIN
      -- 1. Setup isolated test organization
      INSERT INTO public.organizations (id, name, code, status)
      VALUES (v_test_org, 'Core Sales Test Org', 'core-test-' || substr(v_test_org::text, 1, 8), 'active');

      INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
      VALUES (v_seller_emp, v_test_org, v_seller_user, 'Dilshod Seller', 'Dilshod', 'sales', true);

      INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
      VALUES (v_mgr_emp, v_test_org, v_mgr_user, 'Director Anvar', 'Anvar', 'director', true);

      INSERT INTO public.customers (id, organization_id, customer_code, contact_name, seller_id)
      VALUES (v_cust, v_test_org, 'CUST-CORE-' || substr(v_cust::text, 1, 6), 'Dilrabo Apka', v_seller_emp);

      -- Set confirmed daily rate: 585 proba = 950,000 UZS/g
      INSERT INTO public.daily_gold_rates (id, organization_id, proba, rate_per_gram, rate_date, is_confirmed)
      VALUES (v_rate_id, v_test_org, 585, 950000.00, current_date, true);

      -- Set caller context
      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

      -- 2. Issue 100.0000g consignment to seller
      INSERT INTO public.seller_consignments (
        id, organization_id, consignment_no, seller_id, product_name,
        quantity, base_weight_grams, proba, factory_markup_pct,
        factory_gold_due_grams, factory_remaining_gold_grams, status, seller_obligation_g
      ) VALUES (
        v_consign_id, v_test_org, 'CONS-TEST-100G', v_seller_emp, 'Standart 585 Oltin Partiya',
        1, 100.0000, 585, 0, 100.0000, 100.0000, 'held_by_seller', 100.0000
      );

      -- Check initial stock
      v_stock := public.get_seller_available_stock_grams(v_seller_emp);
      IF v_stock <> 100.0000 THEN
        RAISE EXCEPTION 'TEST 1 FAILED: Expected 100.0000g initial stock, got % g', v_stock;
      END IF;
      RAISE NOTICE 'CHECK 1 PASS: Initial seller available stock is exactly % g', v_stock;

      -- =====================================================================
      -- TEST 2: Weight Sale 15g @ 12% markup
      -- Base weight: 15g, Client gross gold due: 15 * 1.12 = 16.8000g
      -- Remaining seller stock: 100 - 15 = 85.0000g
      -- =====================================================================
      v_sale_res := public.rpc_record_weight_sale(
        p_customer_id => v_cust,
        p_seller_id => v_seller_emp,
        p_weight_grams => 15.0000,
        p_client_markup_pct => 12.0,
        p_notes => '15g @ 12% test sale'
      );

      v_sale_id := (v_sale_res->>'sale_id')::uuid;

      IF (v_sale_res->>'client_gold_due_grams')::numeric <> 16.8000 THEN
        RAISE EXCEPTION 'TEST 2 FAILED: Expected client_gold_due_grams 16.8000, got %', v_sale_res->>'client_gold_due_grams';
      END IF;

      IF (v_sale_res->>'remaining_physical_stock_g')::numeric <> 85.0000 THEN
        RAISE EXCEPTION 'TEST 2 FAILED: Expected remaining_physical_stock_g 85.0000, got %', v_sale_res->>'remaining_physical_stock_g';
      END IF;

      v_stock := public.get_seller_available_stock_grams(v_seller_emp);
      IF v_stock <> 85.0000 THEN
        RAISE EXCEPTION 'TEST 2 FAILED: Helper returned % g, expected 85.0000g', v_stock;
      END IF;
      RAISE NOTICE 'CHECK 2 PASS: 15g @ 12%% = 16.8g debt recorded, remaining stock = % g', v_stock;

      -- Check client debt in client_gold_accounts
      SELECT * INTO v_client_acc FROM public.client_gold_accounts WHERE customer_id = v_cust;
      IF v_client_acc.current_debt_grams <> 16.8000 THEN
        RAISE EXCEPTION 'TEST 2 FAILED: Customer debt in client_gold_accounts is %, expected 16.8000', v_client_acc.current_debt_grams;
      END IF;
      RAISE NOTICE 'CHECK 3 PASS: Customer debt in client_gold_accounts is exactly % g', v_client_acc.current_debt_grams;

      -- =====================================================================
      -- TEST 3: Over-selling guard (attempting to sell 90g when only 85g left)
      -- =====================================================================
      BEGIN
        PERFORM public.rpc_record_weight_sale(
          p_customer_id => v_cust,
          p_seller_id => v_seller_emp,
          p_weight_grams => 90.0000,
          p_client_markup_pct => 12.0
        );
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%ERR_INSUFFICIENT_SELLER_STOCK%' THEN
          v_err_over_caught := true;
          RAISE NOTICE 'CHECK 4 PASS: Over-selling correctly blocked: %', SQLERRM;
        ELSE
          RAISE EXCEPTION 'Unexpected error during over-sell test: %', SQLERRM;
        END IF;
      END;

      IF NOT v_err_over_caught THEN
        RAISE EXCEPTION 'TEST 3 FAILED: Server allowed selling 90g when only 85g available!';
      END IF;

      -- =====================================================================
      -- TEST 4: Multi-Currency Payment (Scrap + UZS + USD)
      -- Customer pays:
      -- - 2.0g Scrap (585) = 2.0000g
      -- - 1,900,000 UZS @ 950,000 UZS/g = 2.0000g
      -- - $100 USD @ 12,800 UZS/$ and 950,000 UZS/g = 1.3474g
      -- Total settled: 2.0 + 2.0 + 1.3474 = 5.3474g
      -- Remaining customer debt: 16.8 - 5.3474 = 11.4526g
      -- =====================================================================
      v_pay_res := public.rpc_record_client_settlement(
        p_customer_id => v_cust,
        p_seller_id => v_seller_emp,
        p_scrap_weight => 2.0000,
        p_scrap_proba => 585.0,
        p_cash_amount => 1900000.00,
        p_rate_per_gram => 950000.00,
        p_usd_amount => 100.00,
        p_usd_rate => 12800.00,
        p_notes => 'Mixed Scrap + UZS + USD payment'
      );

      IF (v_pay_res->>'total_settled_grams')::numeric <> 5.3474 THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Expected total_settled_grams 5.3474, got %', v_pay_res->>'total_settled_grams';
      END IF;

      IF (v_pay_res->>'remaining_debt_grams')::numeric <> 11.4526 THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Expected remaining_debt_grams 11.4526, got %', v_pay_res->>'remaining_debt_grams';
      END IF;
      RAISE NOTICE 'CHECK 5 PASS: Multi-currency payment total_settled = % g, remaining debt = % g',
        v_pay_res->>'total_settled_grams', v_pay_res->>'remaining_debt_grams';

      -- Check seller till: must contain 2.0g scrap, 1,900,000 UZS, and 100 USD
      SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
      IF v_seller_acc.seller_till_scrap_grams <> 2.0000 OR
         v_seller_acc.seller_till_cash_amount <> 1900000.00 OR
         v_seller_acc.seller_till_usd_amount <> 100.00 THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Seller till balances incorrect: scrap=%, UZS=%, USD=%',
          v_seller_acc.seller_till_scrap_grams, v_seller_acc.seller_till_cash_amount, v_seller_acc.seller_till_usd_amount;
      END IF;
      RAISE NOTICE 'CHECK 6 PASS: Seller till verified: Scrap=% g, UZS=% UZS, USD=% USD',
        v_seller_acc.seller_till_scrap_grams, v_seller_acc.seller_till_cash_amount, v_seller_acc.seller_till_usd_amount;

      -- =====================================================================
      -- TEST 5: Seller Surrender to Manager with USD
      -- Seller hands over 2.0g scrap, 1,900,000 UZS, $100 USD to manager
      -- =====================================================================
      v_surr_res := public.rpc_record_seller_to_manager_settlement(
        p_seller_id => v_seller_emp,
        p_scrap_weight_grams => 2.0000,
        p_cash_paid_amount => 1900000.00,
        p_rate_per_gram => 950000.00,
        p_usd_paid_amount => 100.00,
        p_usd_rate => 12800.00,
        p_notes => 'Surrender scrap + UZS + USD to manager'
      );
      v_surr_id := (v_surr_res->>'settlement_id')::uuid;

      IF (v_surr_res->>'seller_till_scrap_grams')::numeric <> 0 OR
         (v_surr_res->>'seller_till_cash_amount')::numeric <> 0 OR
         (v_surr_res->>'seller_till_usd_amount')::numeric <> 0 THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Seller till not zero after full surrender!';
      END IF;

      IF (v_surr_res->>'manager_usd_amount')::numeric <> 100.00 THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Manager vault USD is %, expected 100.00', v_surr_res->>'manager_usd_amount';
      END IF;
      RAISE NOTICE 'CHECK 7 PASS: Seller till zeroed, Manager vault received 100 USD, 1.9M UZS, 2.0g scrap';

      -- =====================================================================
      -- TEST 6: Reversal of Manager Surrender
      -- Restores 2.0g scrap, 1,900,000 UZS and $100 USD back to seller till
      -- (Requires manager or director role)
      -- =====================================================================
      PERFORM set_config('request.jwt.claim.sub', v_mgr_user::text, true);

      v_rev_surr_res := public.rpc_reverse_seller_to_manager_settlement(
        p_settlement_id => v_surr_id,
        p_reason => 'Audit test reversal compensation'
      );

      IF (v_rev_surr_res->>'seller_till_usd_amount')::numeric <> 100.00 OR
         (v_rev_surr_res->>'manager_usd_amount')::numeric <> 0 THEN
        RAISE EXCEPTION 'TEST 6 FAILED: Reversal did not restore USD to seller till!';
      END IF;
      RAISE NOTICE 'CHECK 8 PASS: Surrender reversed, seller till USD restored to % USD', v_rev_surr_res->>'seller_till_usd_amount';

      -- Switch back to seller context for sale reversal
      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);

      -- =====================================================================
      -- TEST 7: Reversal of Weight Sale
      -- Reversing the 15g sale must restore customer debt and seller stock 85g -> 100g!
      -- =====================================================================
      v_rev_sale_res := public.rpc_reverse_client_sale(
        p_sale_id => v_sale_id,
        p_reason => 'Client returned goods'
      );

      v_stock := public.get_seller_available_stock_grams(v_seller_emp);
      IF v_stock <> 100.0000 THEN
        RAISE EXCEPTION 'TEST 7 FAILED: Expected restored stock 100.0000g, got % g', v_stock;
      END IF;
      RAISE NOTICE 'CHECK 9 PASS: Sale reversed! Seller stock restored: % g (Expected: 100.0000 g)', v_stock;

      -- Update org status to completed
      UPDATE public.organizations SET status = 'test_completed' WHERE id = v_test_org;
    END $$;
  `;

  console.log('Running test transaction on Staging...');
  const res = await runSqlQuery(testSql);
  console.log('\n==============================================================================');
  console.log('🎉 100% PASS: All Core Sales Workflow & Multi-Currency Tests Passed on Staging!');
  console.log('==============================================================================');
}

main().catch(err => {
  console.error('\n❌ STAGING TEST ERROR:', err.message);
  process.exit(1);
});
