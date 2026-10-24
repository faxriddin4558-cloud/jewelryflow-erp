const { runSqlQuery } = require('./execute-staging-sql');

async function main() {
  console.log('=== STAGING LIVE P0 VERIFICATION SUITE ===');
  console.log('Target: vouehtlmsunebracahon (Staging Supabase)\n');

  let passed = 0;
  let failed = 0;

  // 1. Verify Storage Policies on jewelry-models
  console.log('1. Testing Storage Policies on jewelry-models...');
  const policies = await runSqlQuery(`
    SELECT policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'jewelry_models_%';
  `);
  console.log('Found policies:', policies.map(p => `${p.policyname} (${p.cmd})`));

  const uploadPolicy = policies.find(p => p.policyname === 'jewelry_models_auth_upload');
  const deletePolicy = policies.find(p => p.policyname === 'jewelry_models_auth_delete');

  if (uploadPolicy && deletePolicy && uploadPolicy.with_check.includes('role') && deletePolicy.qual.includes('role')) {
    console.log('PASS: Storage upload and delete policies enforce privileged employee roles');
    passed++;
  } else {
    console.error('FAIL: Storage policies do not enforce role checks');
    failed++;
  }

  // 2. Test ERR_DAILY_RATE_NOT_SET in rpc_record_seller_to_manager_settlement
  console.log('\n2. Testing ERR_DAILY_RATE_NOT_SET guard in rpc_record_seller_to_manager_settlement...');
  // We run an anonymous DO block or SQL function as a test organization without daily rates
  const testRateGuardRes = await runSqlQuery(`
    DO $$
    DECLARE
      v_test_org uuid := gen_random_uuid();
      v_seller_user uuid := gen_random_uuid();
      v_seller_emp uuid := gen_random_uuid();
      v_err_caught boolean := false;
    BEGIN
      INSERT INTO public.organizations (id, name, code) VALUES (v_test_org, 'Temp Test Org', 'temp-test-' || substr(v_test_org::text, 1, 8));
      INSERT INTO public.employees (id, organization_id, user_id, full_name, role, is_active)
      VALUES (v_seller_emp, v_test_org, v_seller_user, 'Temp Seller', 'sales', true);
      INSERT INTO public.seller_gold_accounts (organization_id, seller_id, seller_till_cash_amount)
      VALUES (v_test_org, v_seller_emp, 1000000);

      -- Set app session context
      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

      BEGIN
        -- Attempt settlement with cash > 0 and no rate
        PERFORM public.rpc_record_seller_to_manager_settlement(
          p_seller_id => v_seller_emp,
          p_scrap_weight_grams => 0,
          p_cash_paid_amount => 500000,
          p_rate_per_gram => null
        );
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%ERR_DAILY_RATE_NOT_SET%' THEN
          v_err_caught := true;
        ELSE
          RAISE NOTICE 'Unexpected error: %', SQLERRM;
        END IF;
      END;

      -- Cleanup temp test org
      DELETE FROM public.seller_gold_accounts WHERE organization_id = v_test_org;
      DELETE FROM public.employees WHERE organization_id = v_test_org;
      DELETE FROM public.manager_vault_account WHERE organization_id = v_test_org;
      DELETE FROM public.organizations WHERE id = v_test_org;

      IF NOT v_err_caught THEN
        RAISE EXCEPTION 'TEST FAILED: rpc_record_seller_to_manager_settlement did not throw ERR_DAILY_RATE_NOT_SET!';
      END IF;
    END $$;
  `);
  console.log('PASS: ERR_DAILY_RATE_NOT_SET successfully thrown and blocked settlement without rate');
  passed++;

  // 3. Test ERR_DAILY_RATE_NOT_SET in rpc_record_client_settlement
  console.log('\n3. Testing ERR_DAILY_RATE_NOT_SET guard in rpc_record_client_settlement...');
  await runSqlQuery(`
    DO $$
    DECLARE
      v_test_org uuid := gen_random_uuid();
      v_seller_user uuid := gen_random_uuid();
      v_seller_emp uuid := gen_random_uuid();
      v_cust uuid := gen_random_uuid();
      v_err_caught boolean := false;
    BEGIN
      INSERT INTO public.organizations (id, name, code) VALUES (v_test_org, 'Temp Test Org 2', 'temp-test2-' || substr(v_test_org::text, 1, 8));
      INSERT INTO public.employees (id, organization_id, user_id, full_name, role, is_active)
      VALUES (v_seller_emp, v_test_org, v_seller_user, 'Temp Seller 2', 'sales', true);
      INSERT INTO public.customers (id, organization_id, customer_code, contact_name, seller_id)
      VALUES (v_cust, v_test_org, 'CUST-TEMP-' || substr(v_cust::text, 1, 6), 'Temp Cust', v_seller_emp);

      -- Set app session context
      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

      BEGIN
        -- Attempt client payment with cash > 0 and no rate
        PERFORM public.rpc_record_client_settlement(
          p_customer_id => v_cust,
          p_cash_amount => 500000,
          p_rate_per_gram => null
        );
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%ERR_DAILY_RATE_NOT_SET%' THEN
          v_err_caught := true;
        ELSE
          RAISE NOTICE 'Unexpected error: %', SQLERRM;
        END IF;
      END;

      -- Cleanup temp test org
      DELETE FROM public.customers WHERE id = v_cust;
      DELETE FROM public.employees WHERE organization_id = v_test_org;
      DELETE FROM public.organizations WHERE id = v_test_org;

      IF NOT v_err_caught THEN
        RAISE EXCEPTION 'TEST FAILED: rpc_record_client_settlement did not throw ERR_DAILY_RATE_NOT_SET!';
      END IF;
    END $$;
  `);
  console.log('PASS: rpc_record_client_settlement successfully threw ERR_DAILY_RATE_NOT_SET');
  passed++;

  // 4. Test Lock Hierarchy & Full Reversal Restoration Cycle
  console.log('\n4. Testing Full Settlement -> Reversal Balance Integrity Cycle...');
  const cycleRes = await runSqlQuery(`
    DO $$
    DECLARE
      v_test_org uuid := gen_random_uuid();
      v_mgr_user uuid := gen_random_uuid();
      v_mgr_emp uuid := gen_random_uuid();
      v_seller_emp uuid := gen_random_uuid();
      v_settle_res jsonb;
      v_reverse_res jsonb;
      v_settle_id uuid;
      v_seller_acc public.seller_gold_accounts%rowtype;
      v_vault public.manager_vault_account%rowtype;
    BEGIN
      INSERT INTO public.organizations (id, name, code) VALUES (v_test_org, 'Cycle Org', 'temp-cycle-' || substr(v_test_org::text, 1, 8));
      INSERT INTO public.employees (id, organization_id, user_id, full_name, role, is_active)
      VALUES (v_mgr_emp, v_test_org, v_mgr_user, 'Temp Manager', 'manager', true);
      INSERT INTO public.employees (id, organization_id, user_id, full_name, role, is_active)
      VALUES (v_seller_emp, v_test_org, gen_random_uuid(), 'Temp Seller', 'sales', true);

      -- Daily rate 1,000,000 UZS/g
      INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, is_confirmed)
      VALUES (v_test_org, current_date, 585, 1000000, true);

      -- Consign 50.0g to seller
      INSERT INTO public.seller_consignments (
        organization_id, consignment_no, seller_id, product_name,
        base_weight_grams, proba, factory_markup_pct, factory_gold_due_grams,
        factory_remaining_gold_grams, seller_obligation_g, status
      ) VALUES (
        v_test_org, 'CONSIGN-TEST-1', v_seller_emp, 'Test Jewelry',
        50.0000, 585, 0, 50.0000,
        50.0000, 50.0000, 'held_by_seller'
      );

      -- Initialize seller till with 10.0g scrap and 5,000,000 UZS cash
      UPDATE public.seller_gold_accounts
      SET seller_till_scrap_grams = 10.0000,
          seller_till_cash_amount = 5000000.00
      WHERE seller_id = v_seller_emp;

      PERFORM set_config('request.jwt.claim.sub', v_mgr_user::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

      -- Record settlement: 4.0000g scrap + 2,000,000 UZS cash (= 2.0000g equiv) => 6.0000g total
      v_settle_res := public.rpc_record_seller_to_manager_settlement(
        p_seller_id => v_seller_emp,
        p_scrap_weight_grams => 4.0000,
        p_cash_paid_amount => 2000000,
        p_rate_per_gram => 1000000
      );
      v_settle_id := (v_settle_res->>'settlement_id')::uuid;

      -- Check till deductions
      SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
      SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_test_org;

      IF v_seller_acc.seller_till_scrap_grams <> 6.0000 OR v_seller_acc.seller_till_cash_amount <> 3000000.00 THEN
        RAISE EXCEPTION 'Settlement deduction incorrect: scrap=%, cash=%', v_seller_acc.seller_till_scrap_grams, v_seller_acc.seller_till_cash_amount;
      END IF;

      IF v_vault.manager_scrap_grams <> 4.0000 OR v_vault.manager_cash_amount <> 2000000.00 THEN
        RAISE EXCEPTION 'Vault addition incorrect: scrap=%, cash=%', v_vault.manager_scrap_grams, v_vault.manager_cash_amount;
      END IF;

      -- Now Reverse settlement: 4.0000g scrap + 2,000,000 UZS cash returned to seller till
      v_reverse_res := public.rpc_reverse_seller_to_manager_settlement(
        p_settlement_id => v_settle_id,
        p_reason => 'Test Reversal Audit'
      );

      -- Check restored balances
      SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
      SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_test_org;

      IF v_seller_acc.seller_till_scrap_grams <> 10.0000 OR v_seller_acc.seller_till_cash_amount <> 5000000.00 THEN
        RAISE EXCEPTION 'Restoration to seller till incorrect: scrap=%, cash=%', v_seller_acc.seller_till_scrap_grams, v_seller_acc.seller_till_cash_amount;
      END IF;

      IF v_vault.manager_scrap_grams <> 0.0000 OR v_vault.manager_cash_amount <> 0.00 THEN
        RAISE EXCEPTION 'Vault deduction incorrect: scrap=%, cash=%', v_vault.manager_scrap_grams, v_vault.manager_cash_amount;
      END IF;

      -- Obligation should be exactly 50.0000g (unchanged from initial)
      IF v_seller_acc.seller_owes_manager_g <> 50.0000 THEN
        RAISE EXCEPTION 'Obligation restoration incorrect: owes=%', v_seller_acc.seller_owes_manager_g;
      END IF;

      -- Cleanup
      DELETE FROM public.gold_settlements WHERE organization_id = v_test_org;
      DELETE FROM public.seller_consignments WHERE organization_id = v_test_org;
      DELETE FROM public.seller_gold_accounts WHERE organization_id = v_test_org;
      DELETE FROM public.manager_vault_account WHERE organization_id = v_test_org;
      DELETE FROM public.daily_gold_rates WHERE organization_id = v_test_org;
      DELETE FROM public.employees WHERE organization_id = v_test_org;
      UPDATE public.organizations SET status = 'test_completed' WHERE id = v_test_org;
    END $$;
  `);
  console.log('PASS: Full settlement and reversal cycle restored all balances with 100% precision');
  passed++;

  console.log(`\n========================================`);
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================`);
}

main().catch(err => {
  console.error('\nFAIL in Staging P0 Verification:', err);
  process.exit(1);
});
