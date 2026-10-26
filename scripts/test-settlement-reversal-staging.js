const { runSqlQuery } = require('./execute-staging-sql.js');

async function testSettlementReversal() {
  console.log('Testing rpc_reverse_client_settlement with multi-currency & till deductions on Staging...');

  const sql = `
  DO $test$
  DECLARE
    v_org_id      uuid := gen_random_uuid();
    v_dir_user    uuid := gen_random_uuid();
    v_dir_emp     uuid := gen_random_uuid();
    v_seller_user uuid := gen_random_uuid();
    v_seller_emp  uuid := gen_random_uuid();
    v_cust_id     uuid := gen_random_uuid();
    v_settle_res  jsonb;
    v_rev_res     jsonb;
    v_settle_id   uuid;
    v_seller_acc  record;
    v_client_acc  record;
    v_cust        record;
  BEGIN
    -- Setup Org, Director & Seller
    INSERT INTO public.organizations (id, code, name) VALUES (v_org_id, 'ORG-SETTLE-' || substr(v_org_id::text, 1, 6), 'Settlement Test Org');
    INSERT INTO public.employees (id, user_id, organization_id, name, full_name, role)
    VALUES (v_dir_emp, v_dir_user, v_org_id, 'Director Test', 'Director Test Full', 'director');

    INSERT INTO public.employees (id, user_id, organization_id, name, full_name, role)
    VALUES (v_seller_emp, v_seller_user, v_org_id, 'Seller Test', 'Seller Test Full', 'sales');

    INSERT INTO public.customers (id, organization_id, customer_code, contact_name, phone, seller_id)
    VALUES (v_cust_id, v_org_id, 'CUST-' || upper(substr(gen_random_uuid()::text, 1, 8)), 'Client Test', '+998901112233', v_seller_emp);

    -- Setup Initial Customer Debt (10g)
    INSERT INTO public.client_gold_accounts (customer_id, organization_id, seller_id, current_debt_grams, advance_balance_grams)
    VALUES (v_cust_id, v_org_id, v_seller_emp, 10.0000, 0.0000);

    INSERT INTO public.seller_gold_accounts (
      seller_id, organization_id, seller_till_scrap_grams, seller_till_scrap_physical_g, seller_till_scrap_585_eq_g,
      seller_till_cash_amount, seller_till_usd_amount
    ) VALUES (
      v_seller_emp, v_org_id, 0.0000, 0.0000, 0.0000, 0, 0
    );

    PERFORM set_config('request.jwt.claim.sub', v_dir_user::text, true);

    -- 1. Record Client Settlement: 5g 585 scrap, 1,000,000 UZS cash, 50 USD cash
    -- Customer pays toward 10g debt
    INSERT INTO public.gold_settlements (
      id, organization_id, settlement_no, direction, seller_id, customer_id,
      settlement_date, gold_rate_applied, scrap_weight_grams, scrap_proba, physical_scrap_grams,
      scrap_585_equiv_grams, cash_paid_amount, usd_paid_amount, applied_to_debt_grams,
      excess_gold_grams, total_settled_grams, status
    ) VALUES (
      gen_random_uuid(), v_org_id, 'SETTL-TEST-MULTI', 'client_to_seller', v_seller_emp, v_cust_id,
      current_date, 1000000, 5.0000, 585.00, 5.0000, 5.0000, 1000000.00, 50.00, 6.0000, 0.0000, 6.0000, 'confirmed'
    ) RETURNING id INTO v_settle_id;

    -- Update balances as normal settlement would
    UPDATE public.seller_gold_accounts
    SET seller_till_scrap_grams = 5.0000,
        seller_till_scrap_physical_g = 5.0000,
        seller_till_scrap_585_eq_g = 5.0000,
        seller_till_cash_amount = 1000000.00,
        seller_till_usd_amount = 50.00
    WHERE seller_id = v_seller_emp;

    UPDATE public.client_gold_accounts
    SET current_debt_grams = 4.0000,
        total_settled_grams = 6.0000
    WHERE customer_id = v_cust_id;

    -- 2. Reverse Client Settlement
    v_rev_res := public.rpc_reverse_client_settlement(
      p_settlement_id := v_settle_id,
      p_reason := 'Audit reversal: payment returned'
    );

    -- Verify seller till: scrap physical, 585 eq, UZS and USD MUST ALL BE 0!
    SELECT * INTO v_seller_acc FROM public.seller_gold_accounts WHERE seller_id = v_seller_emp;
    IF v_seller_acc.seller_till_scrap_physical_g <> 0.0000 OR v_seller_acc.seller_till_scrap_585_eq_g <> 0.0000 OR
       v_seller_acc.seller_till_cash_amount <> 0 OR v_seller_acc.seller_till_usd_amount <> 0 THEN
      RAISE EXCEPTION 'Seller till reversal failed: phys=%, 585=%, uzs=%, usd=%',
        v_seller_acc.seller_till_scrap_physical_g, v_seller_acc.seller_till_scrap_585_eq_g,
        v_seller_acc.seller_till_cash_amount, v_seller_acc.seller_till_usd_amount;
    END IF;

    -- Verify customer debt restored to 10g
    SELECT * INTO v_client_acc FROM public.client_gold_accounts WHERE customer_id = v_cust_id;
    IF v_client_acc.current_debt_grams <> 10.0000 THEN
      RAISE EXCEPTION 'Customer debt restoration failed: expected 10g, got %g', v_client_acc.current_debt_grams;
    END IF;

    RAISE NOTICE 'Settlement reversal with multi-currency successfully verified!';
  END $test$;
  `;

  const res = await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log('Result:', res);
  console.log('✅ rpc_reverse_client_settlement PASSED 100% on Staging!');
}

testSettlementReversal().catch(console.error);
