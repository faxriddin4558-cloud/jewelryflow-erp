const { runSqlQuery } = require('./execute-staging-sql.js');

async function run() {
  console.log('==============================================================================');
  console.log('STAGING END-TO-END WORKFLOW VERIFICATION (ITEM 7)');
  console.log('Kirim -> Tarqatish (Scanner) -> Savdo -> To\'lov -> Topshirish -> Reversals');
  console.log('Target: Staging Supabase (vouehtlmsunebracahon)');
  console.log('==============================================================================');

  const testSql = `
  DO $e2e$
  DECLARE
    v_org_id          uuid := gen_random_uuid();
    v_dir_user        uuid := gen_random_uuid();
    v_dir_emp         uuid := gen_random_uuid();
    v_seller_user     uuid := gen_random_uuid();
    v_seller_emp      uuid := gen_random_uuid();
    v_cust_id         uuid := gen_random_uuid();
    v_model_id        uuid := gen_random_uuid();
    v_piece_1_id      uuid := gen_random_uuid();
    v_piece_2_id      uuid := gen_random_uuid();
    v_today           date := (timezone('Asia/Tashkent', now()))::date;

    v_rcp_res         jsonb;
    v_rcp_id          uuid;
    v_consign_res     jsonb;
    v_consign_id      uuid;
    v_sale_res        jsonb;
    v_sale_id         uuid;
    v_settle_res      jsonb;
    v_settle_id       uuid;
    v_hnd_res         jsonb;
    v_hnd_id          uuid;

    v_vault           record;
    v_seller_acc      record;
    v_cust_acc        record;
    v_piece_1         record;
    v_piece_2         record;
    v_rcp_row         record;
    v_blocked_ok      boolean := false;
  BEGIN
    -- 0. SETUP: Tenant, Users, Employees, Model, Customer, Rate
    INSERT INTO public.organizations (id, code, name, created_at, updated_at)
    VALUES (v_org_id, 'ORG-E2E-' || substr(v_org_id::text, 1, 6), 'E2E Workflow Org', now(), now());

    INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
    VALUES (v_dir_emp, v_org_id, v_dir_user, 'E2E Director', 'Director', 'director', true);

    INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
    VALUES (v_seller_emp, v_org_id, v_seller_user, 'E2E Seller', 'Seller', 'sales', true);

    INSERT INTO public.daily_gold_rates (id, organization_id, proba, rate_per_gram, rate_date, is_confirmed)
    VALUES (gen_random_uuid(), v_org_id, 585, 1000000.00, v_today, true);

    INSERT INTO public.jewelry_models (id, organization_id, model_code, name, category, gold_purity, is_active)
    VALUES (v_model_id, v_org_id, 'MOD-E2E-' || substr(v_model_id::text, 1, 4), 'E2E Ring 585', 'Uzuk', 585, true);

    INSERT INTO public.customers (id, organization_id, customer_code, contact_name, phone, seller_id, is_active)
    VALUES (v_cust_id, v_org_id, 'CUST-E2E-' || substr(v_cust_id::text, 1, 4), 'E2E Customer Test', '+998901234567', v_seller_emp, true);

    -- Simulate Director session
    PERFORM set_config('request.jwt.claim.sub', v_dir_user::text, true);

    RAISE NOTICE '>>> STEP 0: Initial setup complete. Zero balance check.';
    SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
    IF v_vault.organization_id IS NOT NULL THEN
      ASSERT COALESCE(v_vault.manager_physical_stock_g, 0) = 0, 'Initial vault physical stock must be 0';
      ASSERT COALESCE(v_vault.current_factory_obligation_g, 0) = 0, 'Initial factory obligation must be 0';
    END IF;

    -- =========================================================================
    -- STEP 1: KIRIM (Factory Receipt)
    -- =========================================================================
    RAISE NOTICE '>>> STEP 1: Kirim (100.00g @ 8%% factory markup -> 108.00g obligation)';
    v_rcp_res := public.rpc_record_factory_receipt(
      p_product_name        := 'Zavod Tilla 585',
      p_quantity            := 10,
      p_original_physical_g := 100.00,
      p_proba               := 585,
      p_factory_markup_pct  := 8.00,
      p_notes               := 'E2E Kirim Test'
    );
    v_rcp_id := (v_rcp_res->>'receipt_id')::uuid;

    SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
    ASSERT ROUND(v_vault.manager_physical_stock_g::numeric, 4) = 100.0000,
      'Vault physical stock must be 100.00g, got ' || v_vault.manager_physical_stock_g;
    ASSERT ROUND(v_vault.total_factory_received_g::numeric, 4) = 100.0000,
      'Total factory received must be 100.00g, got ' || v_vault.total_factory_received_g;
    ASSERT ROUND(v_vault.current_factory_obligation_g::numeric, 4) = 108.0000,
      'Current factory obligation must be 108.00g, got ' || v_vault.current_factory_obligation_g;

    SELECT * INTO v_rcp_row FROM public.factory_receipts WHERE id = v_rcp_id;
    ASSERT v_rcp_row.status = 'in_manager_stock', 'Receipt status must be in_manager_stock';
    ASSERT ROUND(v_rcp_row.available_physical_g::numeric, 4) = 100.0000, 'Available physical must be 100.00g';
    ASSERT ROUND(v_rcp_row.factory_markup_pct::numeric, 2) = 8.00, 'Factory markup must be 8.00%';

    RAISE NOTICE 'STEP 1 Kirim PASSED.';

    -- =========================================================================
    -- STEP 2: TARQATISH (Scanner Consignment to Seller)
    -- =========================================================================
    RAISE NOTICE '>>> STEP 2: Tarqatish (Consign 2 pieces: 30g + 20g = 50g from receipt)';
    v_consign_res := public.rpc_issue_barcode_consignment(
      p_seller_id          := v_seller_emp,
      p_factory_markup_pct := 8.00,
      p_pieces             := jsonb_build_array(
        jsonb_build_object(
          'id', v_piece_1_id,
          'model_id', v_model_id,
          'model_code', 'MOD-E2E-01',
          'model_name', 'E2E Ring 585',
          'category', 'Uzuk',
          'purity', 585,
          'weight_grams', 30.00,
          'raw_barcode', 'BC-E2E-001'
        ),
        jsonb_build_object(
          'id', v_piece_2_id,
          'model_id', v_model_id,
          'model_code', 'MOD-E2E-02',
          'model_name', 'E2E Ring 585',
          'category', 'Uzuk',
          'purity', 585,
          'weight_grams', 20.00,
          'raw_barcode', 'BC-E2E-002'
        )
      ),
      p_notes              := 'E2E Consignment Test',
      p_idempotency_key    := 'IDEMP-CONSIGN-' || substr(v_piece_1_id::text, 1, 8),
      p_factory_receipt_id := v_rcp_id,
      p_seller_markup_pct  := 12.00
    );
    v_consign_id := (v_consign_res->>'consignment_id')::uuid;
    v_piece_1_id := ((v_consign_res->'pieces'->0)->>'id')::uuid;
    v_piece_2_id := ((v_consign_res->'pieces'->1)->>'id')::uuid;

    SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
    ASSERT ROUND(v_vault.manager_physical_stock_g::numeric, 4) = 50.0000,
      'Vault physical stock must decrease to 50.00g, got ' || v_vault.manager_physical_stock_g;

    SELECT * INTO v_rcp_row FROM public.factory_receipts WHERE id = v_rcp_id;
    ASSERT ROUND(v_rcp_row.available_physical_g::numeric, 4) = 50.0000,
      'Receipt available physical must be 50.00g, got ' || v_rcp_row.available_physical_g;
    ASSERT v_rcp_row.status = 'partially_transferred', 'Receipt status must be partially_transferred';

    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    ASSERT ROUND(v_seller_acc.current_physical_stock_g::numeric, 4) = 50.0000,
      'Seller stock must be 50.00g, got ' || v_seller_acc.current_physical_stock_g;
    -- Seller obligation = 50g * (1 + 12%) = 56.00g
    ASSERT ROUND(v_seller_acc.seller_owes_manager_g::numeric, 4) = 56.0000,
      'Seller obligation must be 56.00g, got ' || v_seller_acc.seller_owes_manager_g;

    RAISE NOTICE 'STEP 2 Tarqatish PASSED.';

    -- =========================================================================
    -- STEP 3: SAVDO (Sale of Piece 1 to Customer)
    -- =========================================================================
    RAISE NOTICE '>>> STEP 3: Savdo (Sale of Piece 1: 30.00g @ 15%% client markup -> 34.50g debt)';
    -- Simulate Seller session
    PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);

    v_sale_res := public.rpc_record_barcode_piece_sale(
      p_customer_id       := v_cust_id,
      p_seller_id         := v_seller_emp,
      p_piece_id          := v_piece_1_id,
      p_client_markup_pct := 15.00,
      p_notes             := 'E2E Piece 1 Sale'
    );
    v_sale_id := (v_sale_res->>'sale_id')::uuid;

    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    ASSERT ROUND(v_seller_acc.current_physical_stock_g::numeric, 4) = 20.0000,
      'Seller stock after sale must be 20.00g, got ' || v_seller_acc.current_physical_stock_g;

    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    ASSERT ROUND(v_cust_acc.current_debt_grams::numeric, 4) = 34.5000,
      'Customer debt after sale must be 34.50g, got ' || v_cust_acc.current_debt_grams;

    SELECT * INTO v_piece_1 FROM public.consignment_pieces WHERE id = v_piece_1_id;
    ASSERT v_piece_1.status = 'sold', 'Piece 1 status must be sold';

    RAISE NOTICE 'STEP 3 Savdo PASSED.';

    -- =========================================================================
    -- STEP 4: TO\'LOV (Customer Settlement: Lom + Naqd UZS + Naqd USD)
    -- =========================================================================
    RAISE NOTICE '>>> STEP 4: To''lov (10g scrap + 10M UZS + $1000 USD)';
    v_settle_res := public.rpc_record_client_settlement(
      p_customer_id     := v_cust_id,
      p_sale_id         := null,
      p_scrap_weight    := 10.00,
      p_scrap_proba     := 585,
      p_cash_amount     := 10000000.00,
      p_rate_per_gram   := 1000000.00,
      p_settlement_date := v_today,
      p_notes           := 'E2E Multi-currency Settlement',
      p_seller_id       := v_seller_emp,
      p_usd_amount      := 1000.00,
      p_usd_rate        := 13000.00
    );
    v_settle_id := (v_settle_res->>'settlement_id')::uuid;

    -- Total settled = 10g scrap + 10g cash (10M / 1M) + 13g usd (1000 * 13000 / 1M) = 33.00g
    -- Remaining customer debt = 34.50 - 33.00 = 1.50g
    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    ASSERT ROUND(v_cust_acc.current_debt_grams::numeric, 4) = 1.5000,
      'Customer debt after settlement must be 1.50g, got ' || v_cust_acc.current_debt_grams;

    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    ASSERT ROUND(v_seller_acc.seller_till_scrap_physical_g::numeric, 4) = 10.0000,
      'Seller till scrap physical must be 10.00g, got ' || v_seller_acc.seller_till_scrap_physical_g;
    ASSERT ROUND(v_seller_acc.seller_till_scrap_585_eq_g::numeric, 4) = 10.0000,
      'Seller till scrap 585 eq must be 10.00g, got ' || v_seller_acc.seller_till_scrap_585_eq_g;
    ASSERT ROUND(v_seller_acc.seller_till_cash_amount::numeric, 2) = 10000000.00,
      'Seller till cash amount must be 10,000,000 UZS, got ' || v_seller_acc.seller_till_cash_amount;
    ASSERT ROUND(v_seller_acc.seller_till_usd_amount::numeric, 2) = 1000.00,
      'Seller till usd amount must be 1000 USD, got ' || v_seller_acc.seller_till_usd_amount;

    RAISE NOTICE 'STEP 4 To''lov PASSED.';

    -- =========================================================================
    -- STEP 5: TOPSHIRISH (Factory Gold Handover)
    -- =========================================================================
    RAISE NOTICE '>>> STEP 5: Topshirish (Manager returns 20g refined gold to factory)';
    -- Simulate Director session
    PERFORM set_config('request.jwt.claim.sub', v_dir_user::text, true);

    -- Provision 20g refined gold to manager vault to hand over
    UPDATE public.manager_vault_account
    SET manager_refined_gold_grams = 20.00,
        manager_refined_gold_fine_grams = round(20.00 * (585.0 / 999.0), 4)
    WHERE organization_id = v_org_id;

    v_hnd_res := public.rpc_record_factory_gold_handover(
      p_source_type         := 'refined_gold',
      p_physical_weight_g   := 20.00,
      p_proba               := 585.0,
      p_agreed_equivalent_g := 20.00,
      p_factory_recipient   := 'Zavod Vakili',
      p_notes               := 'E2E Handover Test'
    );
    v_hnd_id := (v_hnd_res->>'handover_id')::uuid;

    SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
    ASSERT ROUND(v_vault.total_factory_handed_over_g::numeric, 4) = 20.0000,
      'Total factory handed over must be 20.00g, got ' || v_vault.total_factory_handed_over_g;
    ASSERT ROUND(v_vault.current_factory_obligation_g::numeric, 4) = 88.0000,
      'Current factory obligation must decrease to 88.00g (108 - 20), got ' || v_vault.current_factory_obligation_g;
    ASSERT ROUND(v_vault.manager_refined_gold_grams::numeric, 4) = 0.0000,
      'Refined gold grams must decrease to 0, got ' || v_vault.manager_refined_gold_grams;

    RAISE NOTICE 'STEP 5 Topshirish PASSED.';

    -- =========================================================================
    -- STEP 6: REVERSALS IN REVERSE ORDER
    -- =========================================================================
    RAISE NOTICE '>>> STEP 6.1: Reverse Factory Handover (HND)';
    PERFORM public.rpc_reverse_factory_gold_handover(
      p_handover_id := v_hnd_id,
      p_reason      := 'E2E Reversal: Handover xato kiritildi'
    );

    SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
    ASSERT ROUND(v_vault.total_factory_handed_over_g::numeric, 4) = 0.0000,
      'After HND reversal: handed over must restore to 0, got ' || v_vault.total_factory_handed_over_g;
    ASSERT ROUND(v_vault.current_factory_obligation_g::numeric, 4) = 108.0000,
      'After HND reversal: factory obligation must restore to 108.00g, got ' || v_vault.current_factory_obligation_g;
    ASSERT ROUND(v_vault.manager_refined_gold_grams::numeric, 4) = 20.0000,
      'After HND reversal: refined gold must restore to 20.00g, got ' || v_vault.manager_refined_gold_grams;

    RAISE NOTICE 'STEP 6.1 Reverse Handover PASSED.';

    RAISE NOTICE '>>> STEP 6.2: Reverse Customer Settlement (To''lov)';
    PERFORM public.rpc_reverse_client_settlement(
      p_settlement_id := v_settle_id,
      p_reason        := 'E2E Reversal: To''lov summasi noto''g''ri'
    );

    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    ASSERT ROUND(v_cust_acc.current_debt_grams::numeric, 4) = 34.5000,
      'After settlement reversal: customer debt must restore to 34.50g, got ' || v_cust_acc.current_debt_grams;

    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    ASSERT ROUND(v_seller_acc.seller_till_scrap_physical_g::numeric, 4) = 0.0000,
      'After settlement reversal: seller till scrap physical must be 0, got ' || v_seller_acc.seller_till_scrap_physical_g;
    ASSERT ROUND(v_seller_acc.seller_till_scrap_585_eq_g::numeric, 4) = 0.0000,
      'After settlement reversal: seller till scrap 585 eq must be 0, got ' || v_seller_acc.seller_till_scrap_585_eq_g;
    ASSERT ROUND(v_seller_acc.seller_till_cash_amount::numeric, 2) = 0.00,
      'After settlement reversal: seller till cash must be 0, got ' || v_seller_acc.seller_till_cash_amount;
    ASSERT ROUND(v_seller_acc.seller_till_usd_amount::numeric, 2) = 0.00,
      'After settlement reversal: seller till usd must be 0, got ' || v_seller_acc.seller_till_usd_amount;

    RAISE NOTICE 'STEP 6.2 Reverse Settlement PASSED.';

    RAISE NOTICE '>>> STEP 6.3: Reverse Customer Sale (Savdo)';
    PERFORM public.rpc_reverse_client_sale(
      p_sale_id := v_sale_id,
      p_reason  := 'E2E Reversal: Mijoz tovarini qaytardi'
    );

    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    ASSERT ROUND(v_cust_acc.current_debt_grams::numeric, 4) = 0.0000,
      'After sale reversal: customer debt must be 0, got ' || v_cust_acc.current_debt_grams;

    SELECT * INTO v_piece_1 FROM public.consignment_pieces WHERE id = v_piece_1_id;
    ASSERT v_piece_1.status = 'held_by_seller', 'Piece 1 status must restore to held_by_seller';

    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    ASSERT ROUND(v_seller_acc.current_physical_stock_g::numeric, 4) = 50.0000,
      'After sale reversal: seller stock must restore to 50.00g, got ' || v_seller_acc.current_physical_stock_g;

    RAISE NOTICE 'STEP 6.3 Reverse Sale PASSED.';

    RAISE NOTICE '>>> STEP 6.4: Safety Block Check: Cannot reverse factory receipt while pieces are with seller';
    BEGIN
      PERFORM public.rpc_reverse_factory_receipt(
        p_receipt_id := v_rcp_id,
        p_reason     := 'E2E Reversal: Xomaki kirim'
      );
      v_blocked_ok := false;
    EXCEPTION WHEN OTHERS THEN
      v_blocked_ok := true;
      RAISE NOTICE 'Safety Block Triggered as expected: %', SQLERRM;
    END;
    ASSERT v_blocked_ok, 'rpc_reverse_factory_receipt MUST be blocked while pieces are transferred to seller!';

    RAISE NOTICE '>>> STEP 6.5: Return pieces from seller to manager, then reverse factory receipt';
    -- Return pieces back to manager stock
    UPDATE public.consignment_pieces
    SET status = 'returned_to_manager', updated_at = now()
    WHERE id IN (v_piece_1_id, v_piece_2_id);

    UPDATE public.seller_consignments
    SET status = 'cancelled', cancellation_reason = 'E2E return', cancelled_at = now()
    WHERE id = v_consign_id;

    UPDATE public.factory_receipts
    SET available_physical_g = available_physical_g + 50.00,
        transferred_physical_g = transferred_physical_g - 50.00,
        status = 'in_manager_stock'
    WHERE id = v_rcp_id;

    UPDATE public.manager_vault_account
    SET manager_physical_stock_g = manager_physical_stock_g + 50.00
    WHERE organization_id = v_org_id;

    -- Now execute receipt reversal
    PERFORM public.rpc_reverse_factory_receipt(
      p_receipt_id := v_rcp_id,
      p_reason     := 'E2E Reversal: Xato kirim bekor qilindi'
    );

    SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
    ASSERT ROUND(v_vault.manager_physical_stock_g::numeric, 4) = 0.0000,
      'After receipt reversal: vault physical stock must be 0, got ' || v_vault.manager_physical_stock_g;
    ASSERT ROUND(v_vault.current_factory_obligation_g::numeric, 4) = 0.0000,
      'After receipt reversal: factory obligation must be 0, got ' || v_vault.current_factory_obligation_g;

    SELECT * INTO v_rcp_row FROM public.factory_receipts WHERE id = v_rcp_id;
    ASSERT v_rcp_row.status = 'reversed', 'Receipt status must be reversed';

    RAISE NOTICE 'STEP 6.5 Reverse Factory Receipt PASSED.';

    -- Reset the provisional test refined gold
    UPDATE public.manager_vault_account
    SET manager_refined_gold_grams = 0, manager_refined_gold_fine_grams = 0
    WHERE organization_id = v_org_id;

    -- =========================================================================
    -- FINAL BALANCE INTEGRITY CHECK
    -- =========================================================================
    SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    SELECT * INTO v_cust_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;

    ASSERT ROUND(v_vault.manager_physical_stock_g::numeric, 4) = 0.0000, 'Final vault physical stock must be 0';
    ASSERT ROUND(v_vault.current_factory_obligation_g::numeric, 4) = 0.0000, 'Final factory obligation must be 0';
    ASSERT ROUND(v_vault.total_factory_handed_over_g::numeric, 4) = 0.0000, 'Final factory handed over must be 0';
    ASSERT ROUND(v_seller_acc.current_physical_stock_g::numeric, 4) = 0.0000, 'Final seller stock must be 0';
    ASSERT ROUND(v_seller_acc.seller_till_scrap_physical_g::numeric, 4) = 0.0000, 'Final seller till scrap physical must be 0';
    ASSERT ROUND(v_seller_acc.seller_till_scrap_585_eq_g::numeric, 4) = 0.0000, 'Final seller till scrap 585 eq must be 0';
    ASSERT ROUND(v_seller_acc.seller_till_cash_amount::numeric, 2) = 0.00, 'Final seller till cash must be 0';
    ASSERT ROUND(v_seller_acc.seller_till_usd_amount::numeric, 2) = 0.00, 'Final seller till usd must be 0';
    ASSERT ROUND(v_cust_acc.current_debt_grams::numeric, 4) = 0.0000, 'Final customer debt must be 0';

    RAISE NOTICE 'ALL E2E WORKFLOW BALANCES ARE 100%% IN BALANCE. PERFECT ZERO PARITY.';
  END $e2e$;
  `;

  console.log('Executing E2E test on Staging...');
  const res = await runSqlQuery(testSql);
  console.log('Result:', res);
  console.log('>>> ALL E2E WORKFLOW TESTS PASSED 100% ON STAGING!');
}

run().catch((err) => {
  console.error('E2E TEST FAILURE:', err);
  process.exit(1);
});
