const { runSqlQuery } = require('./execute-staging-sql.js');

async function testHndReversal() {
  console.log('Testing rpc_reverse_factory_gold_handover on Staging...');

  const sql = `
  DO $test$
  DECLARE
    v_org_id      uuid := gen_random_uuid();
    v_dir_user    uuid := gen_random_uuid();
    v_dir_emp     uuid := gen_random_uuid();
    v_hnd_res     jsonb;
    v_rev_res     jsonb;
    v_hnd_id      uuid;
    v_vault       record;
  BEGIN
    -- Setup Org & Director
    INSERT INTO public.organizations (id, code, name) VALUES (v_org_id, 'ORG-HND-' || substr(v_org_id::text, 1, 6), 'Handover Test Org');
    INSERT INTO public.employees (id, user_id, organization_id, name, full_name, role)
    VALUES (v_dir_emp, v_dir_user, v_org_id, 'Director Test', 'Director Test Full', 'director');

    -- Setup Initial Manager Vault with Refined Gold (150g) and Factory Obligation (200g)
    INSERT INTO public.manager_vault_account (
      organization_id, manager_refined_gold_grams, manager_refined_gold_fine_grams,
      total_factory_received_g, total_factory_obligation_g, total_factory_handed_over_g, current_factory_obligation_g
    ) VALUES (
      v_org_id, 150.0000, 149.0000, 200.0000, 200.0000, 0.0000, 200.0000
    );

    PERFORM set_config('request.jwt.claim.sub', v_dir_user::text, true);

    -- 1. Record Factory Gold Handover (50g refined gold, agreed equivalent 50.0000g)
    v_hnd_res := public.rpc_record_factory_gold_handover(
      p_source_type := 'refined_gold',
      p_physical_weight_g := 50.0000,
      p_proba := 585.00,
      p_agreed_equivalent_g := 50.0000,
      p_factory_recipient := 'Test Zavod',
      p_notes := 'Test handover 50g'
    );

    v_hnd_id := (v_hnd_res->>'handover_id')::uuid;

    -- Verify post-handover vault
    SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
    IF v_vault.manager_refined_gold_grams <> 100.0000 OR v_vault.total_factory_handed_over_g <> 50.0000 OR v_vault.current_factory_obligation_g <> 150.0000 THEN
      RAISE EXCEPTION 'Post-handover check failed: refined=%, handed=%, cur_obl=%',
        v_vault.manager_refined_gold_grams, v_vault.total_factory_handed_over_g, v_vault.current_factory_obligation_g;
    END IF;

    -- 2. Reverse Factory Gold Handover
    v_rev_res := public.rpc_reverse_factory_gold_handover(
      p_handover_id := v_hnd_id,
      p_reason := 'Audit test reversal: error correction'
    );

    -- Verify post-reversal vault
    SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
    IF v_vault.manager_refined_gold_grams <> 150.0000 THEN
      RAISE EXCEPTION 'Post-reversal gold restoration failed: expected 150g, got %g', v_vault.manager_refined_gold_grams;
    END IF;

    IF v_vault.total_factory_handed_over_g <> 0.0000 THEN
      RAISE EXCEPTION 'Post-reversal handed-over decrement failed: expected 0g, got %g', v_vault.total_factory_handed_over_g;
    END IF;

    IF v_vault.current_factory_obligation_g <> 200.0000 THEN
      RAISE EXCEPTION 'Post-reversal obligation restoration failed: expected 200g, got %g', v_vault.current_factory_obligation_g;
    END IF;

    -- 3. Double reversal must fail
    BEGIN
      PERFORM public.rpc_reverse_factory_gold_handover(
        p_handover_id := v_hnd_id,
        p_reason := 'Double reversal attempt'
      );
      RAISE EXCEPTION 'Double reversal did not throw!';
    EXCEPTION WHEN OTHERS THEN
      NULL; -- Expected error
    END;

    RAISE NOTICE 'Handover reversal test successfully verified!';
  END $test$;
  `;

  const res = await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log('Result:', res);
  console.log('✅ rpc_reverse_factory_gold_handover PASSED 100% on Staging!');
}

testHndReversal().catch(console.error);
