-- GOLDIA 091 staging end-to-end AFTER the staging release (staging at 091): new synthetic organization, ONE transaction, ROLLED BACK.
-- Every row of the final select must be ok = true (7 rows). Nothing persists.
begin;
create temp table _e2e (n serial, name text, ok boolean, detail text) on commit drop;
do $e2e$
declare
  v_org uuid := gen_random_uuid();
  u_dir uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_s1 uuid := gen_random_uuid(); u_s2 uuid := gen_random_uuid();
  e_s1 uuid; e_s2 uuid; c_a uuid; c_b uuid; c_e uuid; v_bv uuid; v_a uuid; v_arcp uuid; v_r2 uuid; v_r3 uuid;
  r jsonb; r2 jsonb; c1 jsonb; v_err text; st0 numeric; o0 numeric; m0 numeric; n0 numeric; n1 numeric; pe0 numeric; pe1 numeric; x numeric; y numeric;
  v_ok boolean; v_cnt int;
begin
  insert into public.organizations (id, code, name, status) values (v_org, 'e2e-091-' || substr(v_org::text, 1, 6), 'E2E 091 (sintetik)', 'ACTIVE');
  insert into auth.users (id, email) values (u_dir, 'e2e91-dir-' || substr(v_org::text,1,6) || '@goldia.test'), (u_mgr, 'e2e91-mgr-' || substr(v_org::text,1,6) || '@goldia.test'),
    (u_s1, 'e2e91-s1-' || substr(v_org::text,1,6) || '@goldia.test'), (u_s2, 'e2e91-s2-' || substr(v_org::text,1,6) || '@goldia.test');
  insert into public.employees (organization_id, user_id, name, full_name, role, is_active) values (v_org, u_dir, 'E2E Direktor', 'E2E Direktor', 'director', true), (v_org, u_mgr, 'E2E Menejer', 'E2E Menejer', 'manager', true);
  insert into public.employees (organization_id, user_id, name, full_name, role, is_active) values (v_org, u_s1, 'E2E Sotuvchi 1', 'E2E Sotuvchi 1', 'sales', true) returning id into e_s1;
  insert into public.employees (organization_id, user_id, name, full_name, role, is_active) values (v_org, u_s2, 'E2E Sotuvchi 2', 'E2E Sotuvchi 2', 'sales', true) returning id into e_s2;
  insert into public.customers (organization_id, customer_code, contact_name, phone, seller_id) values (v_org, 'E9-A', 'E2E mijoz A', '+998900000901', e_s1) returning id into c_a;
  insert into public.customers (organization_id, customer_code, contact_name, phone, seller_id) values (v_org, 'E9-B', 'E2E mijoz B', '+998900000902', e_s2) returning id into c_b;
  insert into public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) values (v_org, public._goldia_business_date(), 585, 900000, 'UZS', true) on conflict do nothing;
  perform public._goldia_financial_freeze(v_org, 'e2e 090 window', true);
  perform pg_sleep(0.01);
  insert into public.financial_backup_verifications (organization_id, backup_reference, restore_verified, verified_at) values (v_org, 'e2e-090.dump', true, clock_timestamp()) returning id into v_bv;
  perform set_config('request.jwt.claim.sub', u_dir::text, true); execute 'set local role authenticated';
  perform public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'e2e 090', clock_timestamp() - interval '1 minute', v_bv, 'e2e91-restart-' || v_org);
  execute 'reset role'; perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  v_a := (public.rpc_record_opening_document(p_kind := 'manager_inventory', p_physical_g := 20, p_factory_markup_pct := 8, p_idempotency_key := 'e2e91-a-' || v_org) ->> 'document_id')::uuid;
  perform public.rpc_record_opening_document(p_kind := 'seller_inventory', p_seller_id := e_s2, p_pieces := '[{"weight_grams":4}]'::jsonb, p_seller_markup_pct := 10, p_source_document_id := v_a, p_idempotency_key := 'e2e91-b-' || v_org);
  perform public.rpc_record_opening_document(p_kind := 'factory_advance', p_amount := 100, p_notes := 'C2 e2e', p_idempotency_key := 'e2e91-c2-' || v_org);
  perform public.rpc_confirm_accounting_baseline(p_notes := 'T0 e2e 090', p_idempotency_key := 'e2e91-lock-' || v_org, p_usd_rate := 12650);
  v_r2 := (public.rpc_record_factory_receipt(p_product_name := 'E2E keyingi kirim', p_original_physical_g := 50, p_factory_markup_pct := 10, p_idempotency_key := 'e2e91-r2-' || v_org) ->> 'receipt_id')::uuid;
  execute 'reset role';
  select factory_receipt_id into v_arcp from public.opening_documents where id = v_a;

  -- ---------------- L seller LOM purchase (091)
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  perform public.rpc_issue_barcode_consignment(p_seller_id := e_s1, p_factory_markup_pct := 10, p_pieces := '[{"weight_grams":20}]'::jsonb, p_factory_receipt_id := v_r2, p_seller_markup_pct := 10, p_idempotency_key := 'e2e91-c-' || v_org);
  execute 'reset role'; perform set_config('request.jwt.claim.sub', u_s1::text, true); execute 'set local role authenticated';
  perform public.rpc_record_weight_sale(p_customer_id := c_a, p_weight_grams := 10, p_client_markup_pct := 10, p_idempotency_key := 'e2e91-s-' || v_org);
  perform public.rpc_record_client_settlement(p_customer_id := c_a, p_cash_amount := 9000000, p_rate_per_gram := 900000, p_idempotency_key := 'e2e91-pay-' || v_org);
  execute 'reset role';
  select seller_till_cash_amount, seller_owes_manager_g into x, o0 from public.seller_gold_accounts where seller_id = e_s1;
  y := (select current_debt_grams - advance_balance_grams from public.client_gold_accounts where customer_id = c_a);
  select current_factory_obligation_g - current_factory_advance_g into n0 from public.manager_vault_account where organization_id = v_org;
  perform set_config('request.jwt.claim.sub', u_s1::text, true); execute 'set local role authenticated';
  r := public.rpc_record_seller_lom_purchase(p_physical_g := 5, p_proba := 585, p_idempotency_key := 'e2e91-l1-' || v_org, p_uzs_amount := 4500000, p_counterparty := 'bozor');
  r2 := public.rpc_record_seller_lom_purchase(p_physical_g := 5, p_proba := 585, p_idempotency_key := 'e2e91-l1-' || v_org, p_uzs_amount := 4500000, p_counterparty := 'bozor');
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('L1 seller buys 5 g 585 for 4 500 000 UZS: till UZS -4.5 mln, LOM +5 phys / +5 585, valued pool -5 g; debt, obligation, factory unchanged; replay idempotent',
    r2 ->> 'purchase_id' = r ->> 'purchase_id' and (r ->> 'pool_cash_585_g')::numeric = 5
      and (select seller_till_cash_amount from public.seller_gold_accounts where seller_id = e_s1) = x - 4500000
      and (select seller_till_scrap_physical_g = 5 and seller_till_scrap_585_eq_g = 5 and seller_owes_manager_g = o0 from public.seller_gold_accounts where seller_id = e_s1)
      and (select current_debt_grams - advance_balance_grams from public.client_gold_accounts where customer_id = c_a) = y
      and (select current_factory_obligation_g - current_factory_advance_g from public.manager_vault_account where organization_id = v_org) = n0,
    format('till %s -> %s', x, (select seller_till_cash_amount from public.seller_gold_accounts where seller_id = e_s1)));
  insert into _e2e (name, ok, detail) values ('L2 period report: own kind, not a collection; till rebuilt from the documents = stored till',
    exists (select 1 from public._goldia_period_effects(v_org) where kind = 'seller_lom_purchase')
      and (select round(sum(till_uzs), 2) from public._goldia_period_effects(v_org) where seller_id = e_s1) = (select seller_till_cash_amount from public.seller_gold_accounts where seller_id = e_s1)
      and (select round(sum(till_scrap_g), 4) from public._goldia_period_effects(v_org) where seller_id = e_s1) = (select seller_till_scrap_585_eq_g from public.seller_gold_accounts where seller_id = e_s1), null);
  perform set_config('request.jwt.claim.sub', u_s2::text, true); execute 'set local role authenticated';
  v_err := null; begin perform public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := 'e2e91-l2-' || v_org, p_uzs_amount := 900000, p_seller_id := e_s1); exception when others then v_err := sqlerrm; end;
  select count(*) into v_cnt from public.seller_lom_purchases;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_s1::text, true); execute 'set local role authenticated';
  begin perform public.rpc_record_seller_lom_purchase(p_physical_g := 1, p_proba := 585, p_idempotency_key := 'e2e91-l3-' || v_org, p_uzs_amount := 99000000); v_ok := false;
  exception when others then v_ok := sqlerrm like 'ERR_INSUFFICIENT_CASH_BALANCE%'; end;
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('L3 refused: another seller''s till, more UZS than in the till; S2 sees none of S1''s purchases', v_err like 'ERR_NOT_OWN_TILL%' and v_ok and v_cnt = 0, v_err);
  -- ---------------- C the LOM goes to the manager, then to the factory: net - exactly 5, C2 (100) kept
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  perform public.rpc_record_seller_to_manager_settlement(p_seller_id := e_s1, p_scrap_weight_grams := 5, p_physical_scrap_g := 5, p_idempotency_key := 'e2e91-h-' || v_org);
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('C1 LOM handed to the manager: seller obligation -5 (585 eq), till LOM 0',
    (select round(o0 - seller_owes_manager_g, 4) = 5 and seller_till_scrap_physical_g = 0 from public.seller_gold_accounts where seller_id = e_s1), null);
  select current_factory_obligation_g - current_factory_advance_g into n0 from public.manager_vault_account where organization_id = v_org;
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  r := public.rpc_record_factory_gold_handover(p_source_type := 'scrap_gold', p_physical_weight_g := 5, p_proba := 585, p_agreed_equivalent_g := 5, p_idempotency_key := 'e2e91-fh-' || v_org);
  execute 'reset role';
  select current_factory_obligation_g - current_factory_advance_g into n1 from public.manager_vault_account where organization_id = v_org;
  insert into _e2e (name, ok, detail) values ('C2 factory handover 5 g: factory net exactly -5, C2 stays in the handed-over total (100 + 5)',
    round(n1 - n0, 4) = -5 and (select total_factory_handed_over_g from public.manager_vault_account where organization_id = v_org) = 105, format('net %s -> %s', n0, n1));
  perform set_config('request.jwt.claim.sub', u_dir::text, true); execute 'set local role authenticated';
  perform public.rpc_reverse_factory_gold_handover((r ->> 'handover_id')::uuid, 'xato', 'e2e91-fhr-' || v_org);
  v_err := null; begin perform public.rpc_reverse_seller_lom_purchase((select id from public.seller_lom_purchases where seller_id = e_s1 limit 1), 'x', 'e2e91-lr-' || v_org); exception when others then v_err := sqlerrm; end;
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('C3 reversal (director = manager) gives back exactly 5; the purchase cannot be reversed after its LOM left the till',
    (select current_factory_obligation_g - current_factory_advance_g from public.manager_vault_account where organization_id = v_org) = n0 and v_err like 'ERR_LOM_ALREADY_USED%', v_err);
end $e2e$;
insert into _e2e (name, ok, detail) select 'M1 the 8 changed/new 091 function bodies are identical to the repository', (select md5(string_agg(p.proname || md5(replace(p.prosrc, chr(13), '')), ',' order by p.oid::regprocedure::text collate "C")) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('rpc_record_factory_gold_handover','rpc_reverse_factory_gold_handover','_goldia_guard_finished_goods_handover','rpc_financial_restart','rpc_execute_full_test_reset','_goldia_period_effects','rpc_record_seller_lom_purchase','rpc_reverse_seller_lom_purchase')) = '042a479038ffd117458f7a4413e1cfc5', (select md5(string_agg(p.proname || md5(replace(p.prosrc, chr(13), '')), ',' order by p.oid::regprocedure::text collate "C")) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('rpc_record_factory_gold_handover','rpc_reverse_factory_gold_handover','_goldia_guard_finished_goods_handover','rpc_financial_restart','rpc_execute_full_test_reset','_goldia_period_effects','rpc_record_seller_lom_purchase','rpc_reverse_seller_lom_purchase'));
select n, name, ok, detail from _e2e order by n;
rollback;
