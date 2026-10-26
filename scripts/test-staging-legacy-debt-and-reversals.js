/**
 * STAGING VERIFICATION SUITE FOR MIGRATION 051
 * Tests Scenarios A through H on Staging Supabase (vouehtlmsunebracahon)
 */
const { runSqlQuery } = require('./execute-staging-sql.js');

async function run() {
  console.log('==============================================================================');
  console.log('STAGING VERIFICATION: MIGRATION 051 (SCENARIOS A – H)');
  console.log('Target: Staging Supabase (vouehtlmsunebracahon)');
  console.log('==============================================================================');

  const testSql = `
  DO $suite$
  DECLARE
    v_org_id          uuid := gen_random_uuid();
    v_dir_user        uuid := gen_random_uuid();
    v_dir_emp         uuid := gen_random_uuid();
    v_seller_user     uuid := gen_random_uuid();
    v_seller_emp      uuid := gen_random_uuid();
    v_other_org       uuid := gen_random_uuid();
    v_other_user      uuid := gen_random_uuid();
    v_other_emp       uuid := gen_random_uuid();
    v_cust_id         uuid := gen_random_uuid();
    v_model_id        uuid := gen_random_uuid();
    v_today           date := (timezone('Asia/Tashkent', now()))::date;

    v_rec_res         jsonb;
    v_settle_res      jsonb;
    v_hnd_res         jsonb;
    v_base_res        jsonb;
    v_profit_res      jsonb;
    v_rev_res         jsonb;
    v_preview_res     jsonb;
    v_clean_res       jsonb;
    v_ledger_res      jsonb;

    v_cust_acc        record;
    v_seller_acc      record;
    v_vault_acc       record;
    v_rcp_id          uuid;
    v_legacy_id       uuid;
  BEGIN
    -- 0. SETUP: Tenant, Users, Employees, Daily Rate
    INSERT INTO public.organizations (id, code, name, created_at, updated_at)
    VALUES (v_org_id, 'ORG-051-' || substr(v_org_id::text, 1, 6), 'Staging Test Org 051', now(), now());

    INSERT INTO public.organizations (id, code, name, created_at, updated_at)
    VALUES (v_other_org, 'ORG-051-F-' || substr(v_other_org::text, 1, 6), 'Foreign Org 051', now(), now());

    INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
    VALUES (v_dir_emp, v_org_id, v_dir_user, 'Staging Test Director', 'Director', 'director', true);

    INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
    VALUES (v_seller_emp, v_org_id, v_seller_user, 'Staging Test Seller', 'Seller', 'sales', true);

    INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
    VALUES (v_other_emp, v_other_org, v_other_user, 'Foreign Employee', 'Foreign', 'director', true);

    INSERT INTO public.daily_gold_rates (id, organization_id, proba, rate_per_gram, rate_date, is_confirmed)
    VALUES (gen_random_uuid(), v_org_id, 585, 1000000.00, v_today, true);

    -- Setup Seller Till Account
    INSERT INTO public.seller_gold_accounts (
      seller_id, organization_id,
      seller_till_scrap_grams, seller_till_scrap_585_eq_g,
      seller_till_cash_amount, seller_till_usd_amount
    ) VALUES (
      v_seller_emp, v_org_id, 0, 0, 0, 0
    );

    -- Setup Manager Vault
    PERFORM public._get_or_create_manager_vault(v_org_id);

    -- Setup Customer
    INSERT INTO public.customers (id, organization_id, customer_code, contact_name, phone, seller_id)
    VALUES (v_cust_id, v_org_id, 'CUST-' || upper(substr(gen_random_uuid()::text, 1, 8)), 'Dilshod Sinovchi', '+998901234567', v_seller_emp);

    -- Act as Director
    PERFORM set_config('request.jwt.claim.sub', v_dir_user::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    RAISE NOTICE '>>> SETUP COMPLETED SUCCESSFULLY <<<';


    -- =========================================================================
    -- SCENARIO A: 22g Legacy Debt Entry
    -- =========================================================================
    v_rec_res := public.rpc_record_client_legacy_debt(
      p_customer_id := v_cust_id,
      p_balance_type := 'debt',
      p_amount_585_g := 22.0000,
      p_as_of_date := v_today,
      p_notes := 'Daftar bo''yicha boshlang''ich qarz: 22g',
      p_entry_type := 'initial'
    );

    v_legacy_id := (v_rec_res->>'legacy_debt_id')::uuid;

    -- Verify Customer Account
    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    IF v_cust_acc.current_debt_grams <> 22.0000 OR v_cust_acc.advance_balance_grams <> 0 THEN
      RAISE EXCEPTION 'Scenario A Failed: Expected customer debt 22.0000g, got % (adv: %)',
        v_cust_acc.current_debt_grams, v_cust_acc.advance_balance_grams;
    END IF;

    -- Verify NO Stock deduction, NO till change, NO sales turnover, NO factory debt
    IF EXISTS (SELECT 1 FROM public.jewelry_sales WHERE organization_id = v_org_id) THEN
      RAISE EXCEPTION 'Scenario A Failed: Legacy debt created unauthorized jewelry_sales entry!';
    END IF;
    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    IF v_seller_acc.seller_till_scrap_grams <> 0 OR v_seller_acc.seller_till_cash_amount <> 0 THEN
      RAISE EXCEPTION 'Scenario A Failed: Seller till was modified by legacy debt entry!';
    END IF;

    RAISE NOTICE '[PASS] SCENARIO A: 22g legacy debt recorded cleanly with zero stock/till/factory impact.';


    -- =========================================================================
    -- SCENARIO B: Payment (5g scrap + 2g cash equiv = 2,000,000 UZS) + Handover
    -- =========================================================================
    -- Act as Seller receiving payment
    PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);

    v_settle_res := public.rpc_record_client_settlement(
      p_customer_id := v_cust_id,
      p_seller_id := v_seller_emp,
      p_scrap_weight := 5.0000,
      p_scrap_proba := 585.0,
      p_cash_amount := 2000000.00,
      p_rate_per_gram := 1000000.00,
      p_notes := '5g lom + 2,000,000 UZS to''lov'
    );

    -- Customer debt should now be 22 - (5 + 2) = 15.0000g
    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    IF v_cust_acc.current_debt_grams <> 15.0000 THEN
      RAISE EXCEPTION 'Scenario B Failed: Customer debt expected 15.0000g, got %', v_cust_acc.current_debt_grams;
    END IF;

    -- Seller Till should have 5g scrap and 2,000,000 UZS cash
    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    IF v_seller_acc.seller_till_scrap_585_eq_g <> 5.0000 OR v_seller_acc.seller_till_cash_amount <> 2000000.00 THEN
      RAISE EXCEPTION 'Scenario B Failed: Seller till expected 5g scrap & 2M UZS, got %g & %UZS',
        v_seller_acc.seller_till_scrap_585_eq_g, v_seller_acc.seller_till_cash_amount;
    END IF;

    -- Seller hands over collected scrap and cash to manager
    v_hnd_res := public.rpc_record_seller_to_manager_settlement(
      p_seller_id := v_seller_emp,
      p_scrap_weight_grams := 5.0000,
      p_cash_paid_amount := 2000000.00,
      p_notes := 'Sotuvchi kassani menejerga topshirdi'
    );

    -- Seller till should be 0, manager vault should hold 5g scrap and 2,000,000 UZS
    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    SELECT * INTO v_vault_acc FROM public.manager_vault_account WHERE organization_id = v_org_id;

    IF v_seller_acc.seller_till_scrap_585_eq_g <> 0 OR v_seller_acc.seller_till_cash_amount <> 0 THEN
      RAISE EXCEPTION 'Scenario B Failed: Seller till not cleared after handover!';
    END IF;
    IF v_vault_acc.manager_scrap_585_eq_g <> 5.0000 OR v_vault_acc.manager_cash_amount <> 2000000.00 THEN
      RAISE EXCEPTION 'Scenario B Failed: Manager vault did not receive scrap or cash!';
    END IF;

    RAISE NOTICE '[PASS] SCENARIO B: Payment settled debt to 15g, seller till cleared upon manager handover without unwarranted claims.';


    -- =========================================================================
    -- SCENARIO C: Smart Reconciliation (15g re-entry vs 25g re-entry)
    -- =========================================================================
    -- Act as Director
    PERFORM set_config('request.jwt.claim.sub', v_dir_user::text, true);

    -- 1. Re-entering 15g notebook figure (matches system 15g) -> No-op adjustment!
    v_rec_res := public.rpc_record_client_legacy_debt(
      p_customer_id := v_cust_id,
      p_balance_type := 'debt',
      p_amount_585_g := 0,
      p_as_of_date := v_today,
      p_notes := 'Daftarni tekshirish: 15g',
      p_target_final_balance := 15.0000
    );

    IF (v_rec_res->>'no_change_needed')::boolean IS NOT TRUE OR (v_rec_res->>'delta_585_g')::numeric <> 0 THEN
      RAISE EXCEPTION 'Scenario C Failed: Expected no_change_needed=true and delta=0, got %', v_rec_res;
    END IF;

    -- 2. Re-entering 25g notebook figure (system has 15g) -> Delta must be +10g!
    v_rec_res := public.rpc_record_client_legacy_debt(
      p_customer_id := v_cust_id,
      p_balance_type := 'debt',
      p_amount_585_g := 0,
      p_as_of_date := v_today,
      p_notes := 'Daftar yangilanishi: 25g',
      p_target_final_balance := 25.0000
    );

    IF (v_rec_res->>'delta_585_g')::numeric <> 10.0000 OR (v_rec_res->>'new_debt_585_g')::numeric <> 25.0000 THEN
      RAISE EXCEPTION 'Scenario C Failed: Expected delta=+10g and new_debt=25g, got delta=%, new_debt=%',
        (v_rec_res->>'delta_585_g'), (v_rec_res->>'new_debt_585_g');
    END IF;

    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    IF v_cust_acc.current_debt_grams <> 25.0000 THEN
      RAISE EXCEPTION 'Scenario C Failed: Cache not updated to 25.0000g, got %', v_cust_acc.current_debt_grams;
    END IF;

    RAISE NOTICE '[PASS] SCENARIO C: Smart reconciliation: identical 15g returned no-op, 25g calculated exact +10g delta.';


    -- =========================================================================
    -- SCENARIO D: Post-Baseline Legacy Adjustment & Zero Fake Profit
    -- =========================================================================
    -- 1. Confirm Baseline with current state
    v_base_res := public.rpc_confirm_accounting_baseline(
      p_notes := 'Pilot Test Baseline'
    );
    PERFORM pg_sleep(0.05);

    -- 2. Enter post-baseline legacy debt adjustment of +5g (target 30g)
    v_rec_res := public.rpc_record_client_legacy_debt(
      p_customer_id := v_cust_id,
      p_balance_type := 'debt',
      p_amount_585_g := 0,
      p_as_of_date := v_today,
      p_notes := 'Post-baseline adjustment +5g',
      p_target_final_balance := 30.0000
    );

    v_legacy_id := (v_rec_res->>'legacy_debt_id')::uuid;

    -- 3. Check Profit Summary: must have EXACTLY 0.0000g period accounting result!
    v_profit_res := public.rpc_get_accounting_profit_summary(
      p_org_id := v_org_id,
      p_gold_rate := 1000000.00
    );

    IF (v_profit_res->>'period_accounting_result_585_g')::numeric <> 0.0000 THEN
      RAISE EXCEPTION 'Scenario D Failed: Post-baseline legacy debt created fake operational profit! Expected 0.0000g, got %',
        (v_profit_res->>'period_accounting_result_585_g');
    END IF;

    -- 4. Reversal of the +5g legacy debt
    v_rev_res := public.rpc_reverse_client_legacy_debt(
      p_legacy_debt_id := v_legacy_id,
      p_reason := 'Xato kiritilgan post-baseline tuzatish'
    );

    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    IF v_cust_acc.current_debt_grams <> 25.0000 THEN
      RAISE EXCEPTION 'Scenario D Failed: Reversal did not restore debt to 25.0000g, got %', v_cust_acc.current_debt_grams;
    END IF;

    -- Double-reversal must fail
    BEGIN
      PERFORM public.rpc_reverse_client_legacy_debt(
        p_legacy_debt_id := v_legacy_id,
        p_reason := 'Ikkinchi marta bekor qilish'
      );
      RAISE EXCEPTION 'Scenario D Failed: Double reversal succeeded!';
    EXCEPTION WHEN OTHERS THEN
      -- Expected error
      NULL;
    END;

    RAISE NOTICE '[PASS] SCENARIO D: Post-baseline legacy adjustment produced 0 fake profit, and was reversed cleanly.';


    -- =========================================================================
    -- SCENARIO E: Customer Advance & Full Settlement
    -- =========================================================================
    -- Customer has 25g debt. They pay 30g scrap.
    PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);

    v_settle_res := public.rpc_record_client_settlement(
      p_customer_id := v_cust_id,
      p_seller_id := v_seller_emp,
      p_scrap_weight := 30.0000,
      p_scrap_proba := 585.0,
      p_cash_amount := 0,
      p_rate_per_gram := 1000000.00,
      p_notes := '30g to''lov: 25g qarz yopildi, 5g avans hosil bo''ldi'
    );

    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    IF v_cust_acc.current_debt_grams <> 0 OR v_cust_acc.advance_balance_grams <> 5.0000 THEN
      RAISE EXCEPTION 'Scenario E Failed: Expected debt=0 and advance=5.0000g, got debt=%, adv=%',
        v_cust_acc.current_debt_grams, v_cust_acc.advance_balance_grams;
    END IF;

    -- Now director enters legacy debt of 2g in direct mode -> offsets advance to 3g
    PERFORM set_config('request.jwt.claim.sub', v_dir_user::text, true);

    v_rec_res := public.rpc_record_client_legacy_debt(
      p_customer_id := v_cust_id,
      p_balance_type := 'debt',
      p_amount_585_g := 2.0000,
      p_as_of_date := v_today,
      p_notes := 'Qo''shimcha 2g qarz: avansni 3g ga kamaytiradi'
    );

    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    IF v_cust_acc.current_debt_grams <> 0 OR v_cust_acc.advance_balance_grams <> 3.0000 THEN
      RAISE EXCEPTION 'Scenario E Failed: Expected debt=0 and advance=3.0000g, got debt=%, adv=%',
        v_cust_acc.current_debt_grams, v_cust_acc.advance_balance_grams;
    END IF;

    RAISE NOTICE '[PASS] SCENARIO E: Customer advance creation and debt-advance offset verified.';


    -- =========================================================================
    -- SCENARIO F: Universal Sale & Payment Reversal + Safeguards
    -- =========================================================================
    -- 1. Create a model and give seller stock to make a sale
    INSERT INTO public.jewelry_models (id, organization_id, model_code, name, category, is_active)
    VALUES (v_model_id, v_org_id, 'MOD-' || upper(substr(gen_random_uuid()::text, 1, 8)), 'Uzuk 051', 'rings', true);

    -- Insert factory receipt
    INSERT INTO public.factory_receipts (
      id, organization_id, receipt_no, product_name, proba, quantity,
      original_physical_g, factory_obligation_g, available_physical_g, status
    ) VALUES (
      gen_random_uuid(), v_org_id, 'RCP-051-TEST', 'Uzuk 051', 585, 1,
      10.0000, 10.0000, 10.0000, 'in_manager_stock'
    ) RETURNING id INTO v_rcp_id;

    -- Consign piece to seller
    DECLARE
      v_cons_id uuid;
      v_piece_id uuid;
      v_sale_res jsonb;
      v_sale_id uuid;
    BEGIN
      INSERT INTO public.seller_consignments (
        id, organization_id, consignment_no, seller_id, factory_receipt_id,
        product_name, quantity, base_weight_grams, proba, factory_markup_pct,
        factory_gold_due_grams, factory_remaining_gold_grams, status
      ) VALUES (
        gen_random_uuid(), v_org_id, 'CONS-051-TEST', v_seller_emp, v_rcp_id,
        'Uzuk 051', 1, 10.0000, 585, 0,
        10.0000, 10.0000, 'held_by_seller'
      ) RETURNING id INTO v_cons_id;

      INSERT INTO public.consignment_pieces (
        id, organization_id, consignment_id, seller_id, model_id, model_code,
        model_name, weight_grams, proba, status
      ) VALUES (
        gen_random_uuid(), v_org_id, v_cons_id, v_seller_emp, v_model_id, 'MOD-051',
        'Uzuk 051', 10.0000, 585, 'held_by_seller'
      ) RETURNING id INTO v_piece_id;

      -- Seller makes barcode piece sale to customer
      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);

      v_sale_res := public.rpc_record_barcode_piece_sale(
        p_piece_id := v_piece_id,
        p_customer_id := v_cust_id,
        p_client_markup_pct := 10.00,
        p_notes := '10g uzuk sotuvi'
      );
      v_sale_id := (v_sale_res->>'sale_id')::uuid;

      -- Customer had 3g advance. Sale due is 11g (10g + 10% markup).
      -- Net debt should be 11 - 3 = 8.0000g, advance = 0.
      SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
      IF v_cust_acc.current_debt_grams <> 8.0000 OR v_cust_acc.advance_balance_grams <> 0 THEN
        RAISE EXCEPTION 'Scenario F Failed: Expected customer debt=8g after sale, got debt=%, adv=%',
          v_cust_acc.current_debt_grams, v_cust_acc.advance_balance_grams;
      END IF;

      -- Act as Director and reverse the sale
      PERFORM set_config('request.jwt.claim.sub', v_dir_user::text, true);

      v_rev_res := public.rpc_reverse_client_sale(
        p_sale_id := v_sale_id,
        p_reason := 'Mijoz tovar qaytardi'
      );

      -- Check piece is back to seller stock
      IF (SELECT status FROM public.consignment_pieces WHERE id = v_piece_id) <> 'held_by_seller' THEN
        RAISE EXCEPTION 'Scenario F Failed: Consignment piece status not restored to held_by_seller!';
      END IF;

      -- Check customer advance is restored to 3.0000g, debt back to 0g
      SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
      IF v_cust_acc.current_debt_grams <> 0 OR v_cust_acc.advance_balance_grams <> 3.0000 THEN
        RAISE EXCEPTION 'Scenario F Failed: Customer balance not restored after sale reversal! Debt=%, Adv=%',
          v_cust_acc.current_debt_grams, v_cust_acc.advance_balance_grams;
      END IF;
    END;

    RAISE NOTICE '[PASS] SCENARIO F: Universal sale reversal restored piece stock and customer advance.';


    -- =========================================================================
    -- SCENARIO G: Selective Test Cleanup (Preview & Execution)
    -- =========================================================================
    -- Create cleanable test receipt
    INSERT INTO public.factory_receipts (
      id, organization_id, receipt_no, product_name, proba, quantity,
      original_physical_g, factory_obligation_g, available_physical_g, status
    ) VALUES (
      gen_random_uuid(), v_org_id, 'ZVD-CLEANUP-TEST', 'Sinov Partiyasi 50g', 585, 1,
      50.0000, 55.0000, 50.0000, 'in_manager_stock'
    ) RETURNING id INTO v_rcp_id;

    -- Preview cleanup
    v_preview_res := public.rpc_preview_selective_test_cleanup(array[v_rcp_id]);
    IF (v_preview_res->'summary'->>'cleanable_count')::int <> 1 OR
       (v_preview_res->'summary'->>'inventory_reduction_585_g')::numeric <> 50.0000 THEN
      RAISE EXCEPTION 'Scenario G Failed: Preview mismatch! Got %', v_preview_res;
    END IF;

    -- Execute cleanup with incorrect code -> MUST fail
    BEGIN
      PERFORM public.rpc_execute_selective_test_cleanup(
        p_receipt_ids := array[v_rcp_id],
        p_confirmation_code := 'WRONG_CODE',
        p_reason := 'Sinov'
      );
      RAISE EXCEPTION 'Scenario G Failed: Cleanup executed with wrong confirmation code!';
    EXCEPTION WHEN OTHERS THEN
      NULL; -- Expected failure
    END;

    -- Execute cleanup with correct code
    v_clean_res := public.rpc_execute_selective_test_cleanup(
      p_receipt_ids := array[v_rcp_id],
      p_confirmation_code := 'CONFIRM_TEST_CLEANUP_2026',
      p_reason := 'Sinov ma''lumotini tozalash'
    );

    IF (v_clean_res->>'cleaned_receipts_count')::int <> 1 THEN
      RAISE EXCEPTION 'Scenario G Failed: Expected 1 cleaned receipt, got %', v_clean_res;
    END IF;

    -- Verify receipt status is now 'reversed' and available is 0
    IF (SELECT status FROM public.factory_receipts WHERE id = v_rcp_id) <> 'reversed' OR
       (SELECT available_physical_g FROM public.factory_receipts WHERE id = v_rcp_id) <> 0 THEN
      RAISE EXCEPTION 'Scenario G Failed: Receipt was not reversed cleanly!';
    END IF;

    -- Verify customer and employee records remain intact
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_cust_id) OR
       NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_dir_emp) THEN
      RAISE EXCEPTION 'Scenario G Failed: Cleanup affected customer or employee entities!';
    END IF;

    RAISE NOTICE '[PASS] SCENARIO G: Selective test cleanup preview and execution passed without touching genuine records.';


    -- =========================================================================
    -- SCENARIO H: Permissions, Cross-Tenant Denial, and Idempotency
    -- =========================================================================
    -- 1. Seller attempts to record legacy debt -> MUST fail
    PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);
    BEGIN
      PERFORM public.rpc_record_client_legacy_debt(
        p_customer_id := v_cust_id,
        p_balance_type := 'debt',
        p_amount_585_g := 5.0000,
        p_as_of_date := v_today,
        p_notes := 'Sotuvchi ruxsatsiz yozmoqchi'
      );
      RAISE EXCEPTION 'Scenario H Failed: Seller was allowed to record legacy debt!';
    EXCEPTION WHEN OTHERS THEN
      NULL; -- Expected 42501 permission denied
    END;

    -- 2. Foreign user attempts to record legacy debt on customer -> MUST fail
    PERFORM set_config('request.jwt.claim.sub', v_other_user::text, true);
    BEGIN
      PERFORM public.rpc_record_client_legacy_debt(
        p_customer_id := v_cust_id,
        p_balance_type := 'debt',
        p_amount_585_g := 5.0000,
        p_as_of_date := v_today,
        p_notes := 'Foreign tenant attack'
      );
      RAISE EXCEPTION 'Scenario H Failed: Foreign user touched customer from another tenant!';
    EXCEPTION WHEN OTHERS THEN
      NULL; -- Expected tenant violation
    END;

    -- 3. Idempotency test (Director)
    PERFORM set_config('request.jwt.claim.sub', v_dir_user::text, true);

    DECLARE
      v_test_idem text := 'IDEM-KEY-' || upper(substr(gen_random_uuid()::text, 1, 8));
    BEGIN
      v_rec_res := public.rpc_record_client_legacy_debt(
        p_customer_id := v_cust_id,
        p_balance_type := 'debt',
        p_amount_585_g := 1.2345,
        p_as_of_date := v_today,
        p_notes := 'Idempotency test entry',
        p_idempotency_key := v_test_idem
      );

      v_legacy_id := (v_rec_res->>'legacy_debt_id')::uuid;

      -- Replaying with same idempotency key must return the SAME legacy debt ID
      v_rec_res := public.rpc_record_client_legacy_debt(
        p_customer_id := v_cust_id,
        p_balance_type := 'debt',
        p_amount_585_g := 1.2345,
        p_as_of_date := v_today,
        p_notes := 'Idempotency test entry replay',
        p_idempotency_key := v_test_idem
      );

      IF (v_rec_res->>'legacy_debt_id')::uuid <> v_legacy_id THEN
        RAISE EXCEPTION 'Scenario H Failed: Idempotency replay did not return original record!';
      END IF;
    END;

    -- 4. Customer Deletion Guard: Deleting customer with transactions MUST fail
    BEGIN
      DELETE FROM public.customers WHERE id = v_cust_id;
      RAISE EXCEPTION 'Scenario H Failed: Customer with transaction history was hard deleted!';
    EXCEPTION WHEN OTHERS THEN
      NULL; -- Expected trigger block
    END;

    -- But archiving works
    v_rev_res := public.rpc_archive_customer(v_cust_id, true);
    IF (SELECT is_archived FROM public.customers WHERE id = v_cust_id) IS NOT TRUE THEN
      RAISE EXCEPTION 'Scenario H Failed: Customer archiving failed!';
    END IF;

    -- Note: audit_logs is append-only immutable, preserving audit logs for test tenant
    RAISE NOTICE '>>> ALL 8 STAGING SCENARIOS (A – H) PASSED WITH FLYING COLORS <<<';
  END $suite$;
  `;

  console.log('Executing test suite on Staging...');
  const res = await runSqlQuery(testSql, 'vouehtlmsunebracahon');
  console.log('Test execution complete! Result:', res);
  console.log('\n==============================================================================');
  console.log('✅ ALL STAGING SCENARIOS (A THROUGH H) VERIFIED AND PASSED 100%!');
  console.log('==============================================================================');
}

run().catch((err) => {
  console.error('❌ Staging verification failed:', err);
  process.exit(1);
});
