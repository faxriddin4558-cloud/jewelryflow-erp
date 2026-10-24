/**
 * GOLDIA SALES — SINGLE MAIN STAGING PRACTICAL TEST
 * 
 * Flow:
 * 1. Initial 100g consignment to seller.
 * 2. Weight-only sale: 15g @ 12% markup -> Customer debt = 16.8000g, Seller stock = 85.0000g.
 * 3. Multi-currency settlement: 2.0g scrap + 1,900,000 UZS cash + 100 USD currency.
 * 4. Page refresh simulation: re-query all balances directly from database.
 * 5. Verify seller physical stock (85g), till UZS/USD/scrap, and customer remaining debt (11.4526g).
 */

const { runSqlQuery } = require('./execute-staging-sql');

async function main() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES — STAGING PRACTICAL E2E WORKFLOW TEST');
  console.log('Target: vouehtlmsunebracahon (Staging Supabase)');
  console.log('==============================================================================\n');

  const testSql = `
    DO $$
    DECLARE
      v_test_org      uuid := gen_random_uuid();
      v_seller_user   uuid := gen_random_uuid();
      v_seller_emp    uuid := gen_random_uuid();
      v_cust          uuid := gen_random_uuid();
      v_consign_id    uuid := gen_random_uuid();
      v_rate_id       uuid := gen_random_uuid();
      v_sale_res      jsonb;
      v_pay_res       jsonb;
      v_sale_id       uuid;
      v_seller_acc    public.seller_gold_accounts%rowtype;
      v_client_acc    public.client_gold_accounts%rowtype;
    BEGIN
      -- Setup test organization & accounts
      INSERT INTO public.organizations (id, name, code, status)
      VALUES (v_test_org, 'Practical Test Org', 'prac-test-' || substr(v_test_org::text, 1, 8), 'active');

      INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
      VALUES (v_seller_emp, v_test_org, v_seller_user, 'Omonboy Sotuvchi', 'Omonboy', 'sales', true);

      INSERT INTO public.customers (id, organization_id, customer_code, contact_name, seller_id)
      VALUES (v_cust, v_test_org, 'CUST-PRAC-' || substr(v_cust::text, 1, 6), 'Alisher Aka', v_seller_emp);

      -- Daily gold rate: 585 proba = 950,000 UZS/g
      INSERT INTO public.daily_gold_rates (id, organization_id, proba, rate_per_gram, rate_date, is_confirmed)
      VALUES (v_rate_id, v_test_org, 585, 950000.00, current_date, true);

      -- Caller security context
      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

      -- STEP 1: Consignment 100.0000g
      INSERT INTO public.seller_consignments (
        id, organization_id, consignment_no, seller_id, product_name,
        quantity, base_weight_grams, proba, factory_markup_pct,
        factory_gold_due_grams, factory_remaining_gold_grams, status, seller_obligation_g
      ) VALUES (
        v_consign_id, v_test_org, 'CONS-PRAC-100G', v_seller_emp, 'Standart 585 Oltin Partiya',
        1, 100.0000, 585, 0, 100.0000, 100.0000, 'held_by_seller', 100.0000
      );

      -- STEP 2: Weight-only sale: 15g @ 12% markup
      v_sale_res := public.rpc_record_weight_sale(
        p_customer_id := v_cust,
        p_seller_id := v_seller_emp,
        p_weight_grams := 15.0000,
        p_client_markup_pct := 12.00,
        p_notes := 'Practical test 15g sale @ 12%'
      );

      IF (v_sale_res->>'success')::boolean != true THEN
        RAISE EXCEPTION 'Sale failed: %', v_sale_res;
      END IF;

      v_sale_id := (v_sale_res->>'sale_id')::uuid;

      -- STEP 3: Multi-currency settlement (Lom + UZS + USD)
      -- 2g scrap (585) = 2.0g
      -- 1,900,000 UZS @ 950,000 UZS/g = 2.0g
      -- 100 USD @ 12,800 UZS/$ @ 950,000 UZS/g = 1.3474g
      -- Total settled: 5.3474g
      v_pay_res := public.rpc_record_client_settlement(
        p_customer_id := v_cust,
        p_seller_id := v_seller_emp,
        p_scrap_weight := 2.0000,
        p_scrap_proba := 585.0,
        p_cash_amount := 1900000.00,
        p_rate_per_gram := 950000.00,
        p_usd_amount := 100.00,
        p_usd_rate := 12800.00,
        p_notes := 'Practical mixed payment'
      );

      IF (v_pay_res->>'success')::boolean != true THEN
        RAISE EXCEPTION 'Settlement failed: %', v_pay_res;
      END IF;

      -- STEP 4: Simulate Page Refresh -> Re-query database directly
      SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
      SELECT * INTO v_client_acc FROM public.client_gold_accounts WHERE customer_id = v_cust;

      -- VERIFICATIONS AFTER REFRESH
      -- 1. Seller Physical Stock: 100 - 15 = 85.0000g
      IF v_seller_acc.current_physical_stock_g != 85.0000 THEN
        RAISE EXCEPTION 'POST-REFRESH FAIL: Seller stock expected 85.0000g, got %', v_seller_acc.current_physical_stock_g;
      END IF;

      -- 2. Client Remaining Debt: 16.8000 - 5.3474 = 11.4526g
      IF round(v_client_acc.current_debt_grams, 4) != 11.4526 THEN
        RAISE EXCEPTION 'POST-REFRESH FAIL: Customer debt expected 11.4526g, got %', v_client_acc.current_debt_grams;
      END IF;

      -- 3. Seller Till UZS: 1,900,000
      IF v_seller_acc.seller_till_cash_amount != 1900000.00 THEN
        RAISE EXCEPTION 'POST-REFRESH FAIL: Seller cash till expected 1900000, got %', v_seller_acc.seller_till_cash_amount;
      END IF;

      -- 4. Seller Till USD: 100.00
      IF v_seller_acc.seller_till_usd_amount != 100.00 THEN
        RAISE EXCEPTION 'POST-REFRESH FAIL: Seller USD till expected 100.00, got %', v_seller_acc.seller_till_usd_amount;
      END IF;

      -- 5. Seller Till Scrap: 2.0000g
      IF v_seller_acc.seller_till_scrap_grams != 2.0000 THEN
        RAISE EXCEPTION 'POST-REFRESH FAIL: Seller scrap till expected 2.0000g, got %', v_seller_acc.seller_till_scrap_grams;
      END IF;

      RAISE NOTICE 'SUCCESS: All post-refresh assertions verified accurately!';
      RAISE EXCEPTION 'ROLLBACK_TEST_SUCCESS';
    EXCEPTION
      WHEN others THEN
        IF SQLERRM = 'ROLLBACK_TEST_SUCCESS' THEN
          RAISE NOTICE 'Test completed and rolled back cleanly.';
        ELSE
          RAISE;
        END IF;
    END $$;
  `;

  try {
    const result = await runSqlQuery(testSql, 'vouehtlmsunebracahon');
    console.log('--- TEST EXECUTION RESULT ---');
    console.log('Status: 100% PASS');
    console.log('Scenario verified:');
    console.log('  1. Consignment: 100.0000g initial physical stock');
    console.log('  2. Weight sale: 15.0000g @ 12% markup -> 16.8000g debt, 85.0000g physical stock');
    console.log('  3. Multi-currency payment: 2.0g scrap + 1,900,000 UZS + $100 USD (settled 5.3474g)');
    console.log('  4. Post-Refresh Database Balances:');
    console.log('     - Seller Physical Stock: 85.0000g [PASS]');
    console.log('     - Customer Remaining Debt: 11.4526g [PASS]');
    console.log('     - Seller Till Cash: 1,900,000 UZS [PASS]');
    console.log('     - Seller Till USD: $100.00 USD [PASS]');
    console.log('     - Seller Till Scrap: 2.0000g Lom [PASS]');
    console.log('\nResult: STAGING PRACTICAL TEST PASSED WITH 100% INTEGRITY!');
  } catch (err) {
    console.error('Test Execution Failed:', err.message);
    process.exit(1);
  }
}

main();
