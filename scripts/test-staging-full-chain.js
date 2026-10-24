/**
 * GOLDIA SALES — COMPREHENSIVE FULL OPERATIONAL CHAIN TEST ON STAGING
 * 
 * Pipeline:
 * ZAVOD -> MENEJER OMBORI -> SOTUVCHI -> MIJOZ -> SOTUVCHI KASSASI -> MENEJER SEYFI -> AFINAJ/XARID -> ZAVOD
 * 
 * Target Database: vouehtlmsunebracahon (Staging Supabase)
 */

const { runSqlQuery } = require('./execute-staging-sql');

async function main() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES — FULL OPERATIONAL LIFECYCLE PARITY TEST');
  console.log('Target: vouehtlmsunebracahon (Staging Supabase)');
  console.log('==============================================================================\n');

  const testSql = `
    DO $$
    DECLARE
      v_org_id        uuid := gen_random_uuid();
      v_seller_user   uuid := gen_random_uuid();
      v_seller_emp    uuid := gen_random_uuid();
      v_mgr_user      uuid := gen_random_uuid();
      v_mgr_emp       uuid := gen_random_uuid();
      v_cust_id       uuid := gen_random_uuid();
      v_rate_id       uuid := gen_random_uuid();
      v_rcp_res       jsonb;
      v_consign_res   jsonb;
      v_sale_res      jsonb;
      v_pay_res       jsonb;
      v_surr_res      jsonb;
      v_buy_res       jsonb;
      v_ref_res       jsonb;
      v_hnd_res       jsonb;
      v_seller_acc    public.seller_gold_accounts%rowtype;
      v_vault         public.manager_vault_account%rowtype;
      v_client_acc    public.client_gold_accounts%rowtype;
      v_piece_id      uuid;
      v_sale_id       uuid;
      v_surr_id       uuid;
      v_mgr_avail     numeric(14, 4);
      v_seller_avail  numeric(14, 4);
    BEGIN
      -- Setup test organization
      INSERT INTO public.organizations (id, name, code, status)
      VALUES (v_org_id, 'Full Chain Test Org', 'fc-org-' || substr(v_org_id::text, 1, 8), 'active');

      -- Employees: Manager and Seller
      INSERT INTO public.employees (id, organization_id, user_id, full_name, name, role, is_active)
      VALUES 
        (v_mgr_emp, v_org_id, v_mgr_user, 'Menejer Rahbar', 'Menejer', 'manager', true),
        (v_seller_emp, v_org_id, v_seller_user, 'Omonboy Sotuvchi', 'Omonboy', 'sales', true);

      -- Customer
      INSERT INTO public.customers (id, organization_id, customer_code, contact_name, seller_id)
      VALUES (v_cust_id, v_org_id, 'CUST-FC-' || substr(v_cust_id::text, 1, 6), 'Akmal Zargar', v_seller_emp);

      -- Confirmed daily gold rate: 585 = 950,000 UZS/g
      INSERT INTO public.daily_gold_rates (id, organization_id, proba, rate_per_gram, rate_date, is_confirmed)
      VALUES (v_rate_id, v_org_id, 585, 950000.00, current_date, true);

      -- -----------------------------------------------------------------------
      -- STEP 1: ZAVOD -> MENEJER OMBORI (Factory Receipt)
      -- -----------------------------------------------------------------------
      PERFORM set_config('request.jwt.claim.sub', v_mgr_user::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

      v_rcp_res := public.rpc_record_factory_receipt(
        p_product_name := 'Zavod 585 Uzuklar',
        p_quantity := 10,
        p_original_physical_g := 200.0000,
        p_proba := 585,
        p_factory_markup_pct := 8.00,
        p_notes := 'Zavod birinchi partiya'
      );

      RAISE NOTICE 'Step 1 Factory Receipt: %', v_rcp_res;

      -- Check manager available stock: 200.0000g
      v_mgr_avail := public.get_manager_available_stock_grams(v_org_id);
      IF v_mgr_avail <> 200.0000 THEN
        RAISE EXCEPTION 'Menejer ombori xato: kutilgan 200g, lekin % g', v_mgr_avail;
      END IF;

      -- Check manager vault factory obligation: 200 * 1.08 = 216.0000g
      SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
      IF v_vault.current_factory_obligation_g <> 216.0000 THEN
        RAISE EXCEPTION 'Zavod majburiyati xato: kutilgan 216g, lekin % g', v_vault.current_factory_obligation_g;
      END IF;

      -- -----------------------------------------------------------------------
      -- STEP 2: MENEJER OMBORI -> SOTUVCHI (Consignment)
      -- -----------------------------------------------------------------------
      v_consign_res := public.rpc_issue_barcode_consignment(
        p_seller_id := v_seller_emp,
        p_factory_markup_pct := 8.00,
        p_seller_markup_pct := 12.00,
        p_pieces := jsonb_build_array(
          jsonb_build_object('model_code', 'UZUK-01', 'model_name', 'Brilliant Uzuk', 'weight_grams', 20.0000, 'raw_barcode', 'BC-001'),
          jsonb_build_object('model_code', 'UZUK-02', 'model_name', 'Klassik Uzuk', 'weight_grams', 30.0000, 'raw_barcode', 'BC-002'),
          jsonb_build_object('model_code', 'UZUK-03', 'model_name', 'Erkaklar Uzugi', 'weight_grams', 50.0000, 'raw_barcode', 'BC-003')
        ),
        p_notes := '100g konsignatsiya partiyasi',
        p_factory_receipt_id := (v_rcp_res->>'receipt_id')::uuid
      );

      RAISE NOTICE 'Step 2 Consignment: %', v_consign_res;

      -- Manager remaining stock: 200 - 100 = 100.0000g
      v_mgr_avail := public.get_manager_available_stock_grams(v_org_id);
      IF v_mgr_avail <> 100.0000 THEN
        RAISE EXCEPTION 'Menejer qoldig''i xato: kutilgan 100g, lekin % g', v_mgr_avail;
      END IF;

      -- Seller physical stock: 100.0000g, Seller obligation: 100 * 1.12 = 112.0000g
      SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
      IF v_seller_acc.current_physical_stock_g <> 100.0000 THEN
        RAISE EXCEPTION 'Sotuvchi fizik qoldig''i xato: kutilgan 100g, lekin % g', v_seller_acc.current_physical_stock_g;
      END IF;
      IF v_seller_acc.seller_owes_manager_g <> 112.0000 THEN
        RAISE EXCEPTION 'Sotuvchi majburiyati xato: kutilgan 112g, lekin % g', v_seller_acc.seller_owes_manager_g;
      END IF;

      -- -----------------------------------------------------------------------
      -- STEP 3: SOTUVCHI -> MIJOZ (Weight-Only Sale: 15g @ 12%)
      -- -----------------------------------------------------------------------
      PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);

      v_sale_res := public.rpc_record_weight_sale(
        p_customer_id := v_cust_id,
        p_seller_id := v_seller_emp,
        p_weight_grams := 15.0000,
        p_client_markup_pct := 12.00,
        p_notes := 'Mijozga 15g savdo'
      );

      RAISE NOTICE 'Step 3 Weight Sale: %', v_sale_res;

      -- Seller remaining physical stock: 100 - 15 = 85.0000g
      SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
      IF v_seller_acc.current_physical_stock_g <> 85.0000 THEN
        RAISE EXCEPTION 'Sotuvchi savdodan keyingi fizik qoldig''i xato: kutilgan 85g, lekin % g', v_seller_acc.current_physical_stock_g;
      END IF;

      -- Customer debt: 15 * 1.12 = 16.8000g
      SELECT * INTO v_client_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
      IF v_client_acc.current_debt_grams <> 16.8000 THEN
        RAISE EXCEPTION 'Mijoz qarzi xato: kutilgan 16.8g, lekin % g', v_client_acc.current_debt_grams;
      END IF;

      -- -----------------------------------------------------------------------
      -- STEP 4: MIJOZ -> SOTUVCHI KASSASI (Multi-Currency Settlement)
      -- 2.0g Scrap @ 750 (2.5641g 585 eq) + 1,900,000 UZS (2.0000g) + $100 USD (1.3474g)
      -- -----------------------------------------------------------------------
      v_pay_res := public.rpc_record_client_settlement(
        p_customer_id := v_cust_id,
        p_sale_id := (v_sale_res->>'sale_id')::uuid,
        p_scrap_weight := 2.0000,
        p_scrap_proba := 750.0,
        p_cash_amount := 1900000.00,
        p_rate_per_gram := 950000.00,
        p_usd_amount := 100.00,
        p_usd_rate := 12800.00,
        p_notes := 'Mijoz to''lovi: Lom 750 + UZS + USD'
      );

      RAISE NOTICE 'Step 4 Client Settlement: %', v_pay_res;

      -- Check seller till:
      SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
      IF v_seller_acc.seller_till_scrap_physical_g <> 2.0000 THEN
        RAISE EXCEPTION 'Sotuvchi kassasi fizik lom xato: kutilgan 2g, lekin % g', v_seller_acc.seller_till_scrap_physical_g;
      END IF;
      IF v_seller_acc.seller_till_scrap_585_eq_g <> 2.5641 THEN
        RAISE EXCEPTION 'Sotuvchi kassasi 585 lom eq xato: kutilgan 2.5641g, lekin % g', v_seller_acc.seller_till_scrap_585_eq_g;
      END IF;
      IF v_seller_acc.seller_till_cash_amount <> 1900000.00 THEN
        RAISE EXCEPTION 'Sotuvchi kassasi UZS naqd xato: kutilgan 1.9M, lekin %', v_seller_acc.seller_till_cash_amount;
      END IF;
      IF v_seller_acc.seller_till_usd_amount <> 100.00 THEN
        RAISE EXCEPTION 'Sotuvchi kassasi USD xato: kutilgan 100 USD, lekin %', v_seller_acc.seller_till_usd_amount;
      END IF;

      -- Remaining customer debt: 16.8000 - (2.5641 + 2.0000 + 1.3474) = 10.8885g
      SELECT * INTO v_client_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
      IF v_client_acc.current_debt_grams <> 10.8885 THEN
        RAISE EXCEPTION 'Mijoz qoldiq qarzi xato: kutilgan 10.8885g, lekin % g', v_client_acc.current_debt_grams;
      END IF;

      -- -----------------------------------------------------------------------
      -- STEP 5: SOTUVCHI KASSASI -> MENEJER SEYFI (Surrender)
      -- Surrender 1.0g physical scrap (1.2821g 585 eq), 900,000 UZS, $50 USD
      -- -----------------------------------------------------------------------
      PERFORM set_config('request.jwt.claim.sub', v_mgr_user::text, true);

      v_surr_res := public.rpc_record_seller_to_manager_settlement(
        p_seller_id := v_seller_emp,
        p_scrap_weight_grams := 1.2821,
        p_physical_scrap_g := 1.0000,
        p_cash_paid_amount := 900000.00,
        p_rate_per_gram := 950000.00,
        p_usd_paid_amount := 50.00,
        p_usd_rate := 12800.00,
        p_notes := 'Menejerga topshirilgan tushum'
      );

      RAISE NOTICE 'Step 5 Surrender to Manager: %', v_surr_res;

      -- Check seller till deductions:
      SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
      IF v_seller_acc.seller_till_scrap_physical_g <> 1.0000 THEN
        RAISE EXCEPTION 'Sotuvchi kassasi qoldiq fizik lom xato: kutilgan 1g, lekin % g', v_seller_acc.seller_till_scrap_physical_g;
      END IF;
      IF v_seller_acc.seller_till_cash_amount <> 1000000.00 THEN
        RAISE EXCEPTION 'Sotuvchi kassasi qoldiq UZS xato: kutilgan 1M, lekin %', v_seller_acc.seller_till_cash_amount;
      END IF;
      IF v_seller_acc.seller_till_usd_amount <> 50.00 THEN
        RAISE EXCEPTION 'Sotuvchi kassasi qoldiq USD xato: kutilgan 50 USD, lekin %', v_seller_acc.seller_till_usd_amount;
      END IF;

      -- Check manager vault additions:
      SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
      IF v_vault.manager_scrap_physical_g <> 1.0000 THEN
        RAISE EXCEPTION 'Seyfdagi fizik lom xato: kutilgan 1g, lekin % g', v_vault.manager_scrap_physical_g;
      END IF;
      IF v_vault.manager_cash_amount <> 900000.00 THEN
        RAISE EXCEPTION 'Seyfdagi UZS naqd xato: kutilgan 900k, lekin %', v_vault.manager_cash_amount;
      END IF;
      IF v_vault.manager_usd_amount <> 50.00 THEN
        RAISE EXCEPTION 'Seyfdagi USD xato: kutilgan 50 USD, lekin %', v_vault.manager_usd_amount;
      END IF;

      -- -----------------------------------------------------------------------
      -- STEP 6: MENEJER SEYFI -> NAQDGA OLTIN XARID (Multi-Currency USD)
      -- Buy gold using $20 USD from vault @ $75/g -> 0.2667g gold
      -- -----------------------------------------------------------------------
      v_buy_res := public.rpc_record_gold_purchase(
        p_supplier_name := 'Bozor Zargar',
        p_cash_spent_uzs := 0,
        p_rate_per_gram := 75.00,
        p_gold_weight_grams := 0.2667,
        p_proba := 585.0,
        p_notes := 'Valyutaga oltin xarid',
        p_currency := 'USD',
        p_usd_spent := 20.00
      );

      RAISE NOTICE 'Step 6 USD Gold Purchase: %', v_buy_res;

      -- Manager USD balance: 50 - 20 = $30 USD
      SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
      IF v_vault.manager_usd_amount <> 30.00 THEN
        RAISE EXCEPTION 'Seyfdagi xariddan keyingi USD xato: kutilgan 30 USD, lekin %', v_vault.manager_usd_amount;
      END IF;
      IF v_vault.manager_purchased_gold_grams <> 0.2667 THEN
        RAISE EXCEPTION 'Seyfdagi xarid oltin xato: kutilgan 0.2667g, lekin %', v_vault.manager_purchased_gold_grams;
      END IF;

      -- -----------------------------------------------------------------------
      -- STEP 7: MENEJER SEYFI -> AFINAJ ("Lom pateriya")
      -- Melt 1.2821g 585 eq (1.0000g physical) scrap -> 0.7300g of 995 fine gold (1.2416g 585 eq)
      -- Loss = 1.2821 - 1.2416 = 0.0405g (manager loss)
      -- -----------------------------------------------------------------------
      v_ref_res := public.rpc_record_refining_batch(
        p_input_scrap_grams := 1.2821,
        p_melted_weight_grams := 1.2500,
        p_output_fine_grams := 0.7300,
        p_output_fine_proba := 995.0,
        p_notes := 'Afinaj partiyasi',
        p_physical_scrap_grams := 1.0000
      );

      RAISE NOTICE 'Step 7 Refining: %', v_ref_res;

      SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
      IF v_vault.manager_scrap_grams <> 0 THEN
        RAISE EXCEPTION 'Afinajdan keyin seyfdagi lom xato: kutilgan 0g, lekin %', v_vault.manager_scrap_grams;
      END IF;
      IF v_vault.manager_scrap_physical_g <> 0 THEN
        RAISE EXCEPTION 'Afinajdan keyin seyfdagi fizik lom xato: kutilgan 0g, lekin %', v_vault.manager_scrap_physical_g;
      END IF;
      IF v_vault.manager_refined_gold_grams <> 1.2416 THEN
        RAISE EXCEPTION 'Afinaj toza oltin (585 eq) xato: kutilgan 1.2416g, lekin %', v_vault.manager_refined_gold_grams;
      END IF;
      -- Factory obligation unchanged at refining step!
      IF v_vault.current_factory_obligation_g <> 216.0000 THEN
        RAISE EXCEPTION 'Afinajda zavod qarzi o''zgarmasligi shart! Joriy: %', v_vault.current_factory_obligation_g;
      END IF;

      -- -----------------------------------------------------------------------
      -- STEP 8: MENEJER SEYFI -> ZAVODGA TOPSHIRISH
      -- Handover 1.2416g refined gold to Factory -> Reduces factory debt!
      -- -----------------------------------------------------------------------
      v_hnd_res := public.rpc_record_factory_gold_handover(
        p_source_type := 'refined_gold',
        p_physical_weight_g := 0.7300,
        p_proba := 995.0,
        p_agreed_equivalent_g := 1.2416,
        p_factory_recipient := 'Toshkent Zavodi',
        p_notes := 'Zavodga afinaj oltin topshirish'
      );

      RAISE NOTICE 'Step 8 Factory Handover: %', v_hnd_res;

      -- Current factory obligation: 216.0000 - 1.2416 = 214.7584g!
      SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id;
      IF v_vault.current_factory_obligation_g <> 214.7584 THEN
        RAISE EXCEPTION 'Zavodga topshirilgandan keyingi qarz xato: kutilgan 214.7584g, lekin %', v_vault.current_factory_obligation_g;
      END IF;
      IF v_vault.manager_refined_gold_grams <> 0 THEN
        RAISE EXCEPTION 'Seyfdagi quyma oltin xato: kutilgan 0g, lekin %', v_vault.manager_refined_gold_grams;
      END IF;

      -- -----------------------------------------------------------------------
      -- STEP 9: PHYSICAL INVENTORY CONSERVATION LAW CHECK
      -- Total Factory Physical = 200.0000g
      -- Manager Available Stock: 100.0000g
      -- Seller Available Stock: 85.0000g
      -- Sold Physical Gold: 15.0000g
      -- Sum = 100 + 85 + 15 = 200.0000g EXACT MATCH!
      -- -----------------------------------------------------------------------
      v_mgr_avail := public.get_manager_available_stock_grams(v_org_id);
      v_seller_avail := public.get_seller_available_stock_grams(v_seller_emp);

      IF (v_mgr_avail + v_seller_avail + 15.0000) <> 200.0000 THEN
        RAISE EXCEPTION 'Fizik modda saqlanish qonuni buzildi! Menejer: %g, Sotuvchi: %g, Sotilgan: 15g, Jami: %g (kutilgan: 200g)',
          v_mgr_avail, v_seller_avail, (v_mgr_avail + v_seller_avail + 15.0000);
      END IF;

      RAISE NOTICE 'SUCCESS: ALL 9 STEPS VERIFIED WITH 100%% MATHEMATICAL ACCURACY!';
    END;
    $$;
  `;

  console.log('Running test transaction on vouehtlmsunebracahon (Staging)...');
  const res = await runSqlQuery(testSql, 'vouehtlmsunebracahon');
  console.log('Result:', res);
  console.log('\n>>> STAGING FULL CHAIN VERIFICATION: 100% PASS <<<');
}

main().catch(err => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
