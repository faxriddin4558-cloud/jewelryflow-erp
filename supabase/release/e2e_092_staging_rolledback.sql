-- GOLDIA 092 staging end-to-end AFTER the staging release (staging at 092): new synthetic organization, ONE transaction, ROLLED BACK.
-- Every row of the final select must be ok = true (4 rows). Nothing persists.
begin;
create temp table _e2e (n serial, name text, ok boolean, detail text) on commit drop;
do $e2e$
declare
  v_org uuid := gen_random_uuid();
  u_dir uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_s1 uuid := gen_random_uuid(); u_s2 uuid := gen_random_uuid();
  e_s1 uuid; e_s2 uuid; c_a uuid; c_b uuid; c_e uuid; v_bv uuid; v_a uuid; v_arcp uuid; v_r2 uuid; v_r3 uuid;
  r jsonb; r2 jsonb; c1 jsonb; v_err text; st0 numeric; o0 numeric; m0 numeric; n0 numeric; n1 numeric; pe0 numeric; pe1 numeric; x numeric; y numeric;
  v_ok boolean; v_cnt int; c_o uuid; c_n uuid;
begin
  insert into public.organizations (id, code, name, status) values (v_org, 'e2e-092-' || substr(v_org::text, 1, 6), 'E2E 092 (sintetik)', 'ACTIVE');
  insert into auth.users (id, email) values (u_dir, 'e2e92-dir-' || substr(v_org::text,1,6) || '@goldia.test'), (u_mgr, 'e2e92-mgr-' || substr(v_org::text,1,6) || '@goldia.test'),
    (u_s1, 'e2e92-s1-' || substr(v_org::text,1,6) || '@goldia.test'), (u_s2, 'e2e92-s2-' || substr(v_org::text,1,6) || '@goldia.test');
  insert into public.employees (organization_id, user_id, name, full_name, role, is_active) values (v_org, u_dir, 'E2E Direktor', 'E2E Direktor', 'director', true), (v_org, u_mgr, 'E2E Menejer', 'E2E Menejer', 'manager', true);
  insert into public.employees (organization_id, user_id, name, full_name, role, is_active) values (v_org, u_s1, 'E2E Sotuvchi 1', 'E2E Sotuvchi 1', 'sales', true) returning id into e_s1;
  insert into public.employees (organization_id, user_id, name, full_name, role, is_active) values (v_org, u_s2, 'E2E Sotuvchi 2', 'E2E Sotuvchi 2', 'sales', true) returning id into e_s2;
  insert into public.customers (organization_id, customer_code, contact_name, phone, seller_id) values (v_org, 'E9-A', 'E2E mijoz A', '+998900000901', e_s1) returning id into c_a;
  insert into public.customers (organization_id, customer_code, contact_name, phone, seller_id) values (v_org, 'E9-B', 'E2E mijoz B', '+998900000902', e_s2) returning id into c_b;
  insert into public.customers (organization_id, customer_code, contact_name, phone, seller_id) values (v_org, 'E92-O', 'E2E O', '+998900009201', e_s1) returning id into c_o;
  insert into public.customers (organization_id, customer_code, contact_name, phone, seller_id) values (v_org, 'E92-N', 'E2E N', '+998900009202', e_s1) returning id into c_n;
  insert into public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) values (v_org, public._goldia_business_date(), 585, 900000, 'UZS', true) on conflict do nothing;
  perform public._goldia_financial_freeze(v_org, 'e2e 090 window', true);
  perform pg_sleep(0.01);
  insert into public.financial_backup_verifications (organization_id, backup_reference, restore_verified, verified_at) values (v_org, 'e2e-090.dump', true, clock_timestamp()) returning id into v_bv;
  perform set_config('request.jwt.claim.sub', u_dir::text, true); execute 'set local role authenticated';
  perform public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'e2e 090', clock_timestamp() - interval '1 minute', v_bv, 'e2e92-restart-' || v_org);
  execute 'reset role'; perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  v_a := (public.rpc_record_opening_document(p_kind := 'manager_inventory', p_physical_g := 20, p_factory_markup_pct := 8, p_idempotency_key := 'e2e92-a-' || v_org) ->> 'document_id')::uuid;
  perform public.rpc_record_opening_document(p_kind := 'seller_inventory', p_seller_id := e_s2, p_pieces := '[{"weight_grams":4}]'::jsonb, p_seller_markup_pct := 10, p_source_document_id := v_a, p_idempotency_key := 'e2e92-b-' || v_org);
  perform public.rpc_record_opening_document(p_kind := 'factory_advance', p_amount := 100, p_notes := 'C2 e2e', p_idempotency_key := 'e2e92-c2-' || v_org);
  perform public.rpc_record_opening_document(p_kind := 'customer_gram', p_customer_id := c_o, p_side := 'debt', p_amount := 10, p_idempotency_key := 'e2e92-od-' || v_org);
  perform public.rpc_confirm_accounting_baseline(p_notes := 'T0 e2e 090', p_idempotency_key := 'e2e92-lock-' || v_org, p_usd_rate := 12650);
  v_r2 := (public.rpc_record_factory_receipt(p_product_name := 'E2E keyingi kirim', p_original_physical_g := 50, p_factory_markup_pct := 10, p_idempotency_key := 'e2e92-r2-' || v_org) ->> 'receipt_id')::uuid;
  execute 'reset role';
  select factory_receipt_id into v_arcp from public.opening_documents where id = v_a;

  -- ---------------- R old-sale return (092): old -> new -> advance; no opening debt allowed
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  perform public.rpc_issue_barcode_consignment(p_seller_id := e_s1, p_factory_markup_pct := 10, p_pieces := '[{"weight_grams":20}]'::jsonb, p_factory_receipt_id := v_r2, p_seller_markup_pct := 10, p_idempotency_key := 'e2e92-c-' || v_org);
  execute 'reset role'; perform set_config('request.jwt.claim.sub', u_s1::text, true); execute 'set local role authenticated';
  perform public.rpc_record_weight_sale(p_customer_id := c_n, p_weight_grams := 5, p_client_markup_pct := 10, p_idempotency_key := 'e2e92-sn-' || v_org);
  perform public.rpc_record_weight_sale(p_customer_id := c_o, p_weight_grams := 5, p_client_markup_pct := 10, p_idempotency_key := 'e2e92-so-' || v_org);
  execute 'reset role';
  select seller_owes_manager_g into o0 from public.seller_gold_accounts where seller_id = e_s1;
  m0 := public.get_manager_available_stock_grams(v_org);
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  r := public.rpc_record_opening_sale_return(p_customer_id := c_n, p_unit := 'G585', p_weight_grams := 2, p_customer_markup_pct := 10, p_credit_amount := null, p_receiver := 'manager', p_seller_markup_pct := null, p_reason := 'e2e', p_confirmed := true, p_idempotency_key := 'e2e92-osr1-' || v_org);
  r2 := public.rpc_record_opening_sale_return(p_customer_id := c_n, p_unit := 'G585', p_weight_grams := 2, p_customer_markup_pct := 10, p_credit_amount := null, p_receiver := 'manager', p_seller_markup_pct := null, p_reason := 'e2e', p_confirmed := true, p_idempotency_key := 'e2e92-osr1-' || v_org);
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('R1 no opening debt: not blocked, 2.2 g off the new debt (old 0, advance 0), replay once, seller obligation unchanged, manager +2 g',
    (r ->> 'has_opening_document')::boolean = false and (r ->> 'opening_part')::numeric = 0 and (r ->> 'new_debt_part')::numeric = 2.2 and (r ->> 'advance_created')::numeric = 0
      and r2 ->> 'return_id' = r ->> 'return_id'
      and (select current_debt_grams - advance_balance_grams from public.client_gold_accounts where customer_id = c_n) = 3.3
      and (select seller_owes_manager_g from public.seller_gold_accounts where seller_id = e_s1) = o0
      and public.get_manager_available_stock_grams(v_org) = m0 + 2, r ->> 'formula');
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  r := public.rpc_record_opening_sale_return(p_customer_id := c_o, p_unit := 'G585', p_weight_grams := 10, p_customer_markup_pct := 30, p_credit_amount := null, p_receiver := 'manager', p_seller_markup_pct := null, p_reason := 'e2e', p_confirmed := true, p_idempotency_key := 'e2e92-osr2-' || v_org);
  r2 := public.rpc_record_opening_sale_return(p_customer_id := c_o, p_unit := 'G585', p_weight_grams := 5, p_customer_markup_pct := 0, p_credit_amount := null, p_receiver := 'manager', p_seller_markup_pct := null, p_reason := 'e2e', p_confirmed := true, p_idempotency_key := 'e2e92-osr3-' || v_org);
  c1 := public.rpc_get_unified_customer_ledger(c_o, null) -> 'items' -> 0;
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('R2 old 10 + new 5.5: 13 g -> old 10 / new 3; then 5 g -> old 0 / new 2.5 / advance 2.5; ledger old column 0, advance 2.5',
    (r ->> 'opening_part')::numeric = 10 and (r ->> 'new_debt_part')::numeric = 3 and (r ->> 'advance_created')::numeric = 0
      and (r2 ->> 'opening_part')::numeric = 0 and (r2 ->> 'new_debt_part')::numeric = 2.5 and (r2 ->> 'advance_created')::numeric = 2.5
      and (c1 ->> 'legacy_debt_g')::numeric = 0 and (c1 ->> 'available_advance_g')::numeric = 2.5
      and (select current_debt_grams - advance_balance_grams from public.client_gold_accounts where customer_id = c_o) = -2.5,
    format('ledger old=%s adv=%s', c1 ->> 'legacy_debt_g', c1 ->> 'available_advance_g'));
  perform set_config('request.jwt.claim.sub', u_dir::text, true); execute 'set local role authenticated';
  perform public.rpc_reverse_opening_sale_return((r2 ->> 'return_id')::uuid, 'xato', 'e2e92-rv-' || v_org);
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('R3 reversal (director = manager) restores the customer exactly; the opening document is unchanged',
    (select current_debt_grams - advance_balance_grams from public.client_gold_accounts where customer_id = c_o) = 2.5
      and (select amount from public.opening_documents where customer_id = c_o and kind = 'customer_gram') = 10, null);
end $e2e$;
insert into _e2e (name, ok, detail) select 'M1 the 3 changed 092 function bodies are identical to the repository', (select md5(string_agg(p.proname || md5(replace(p.prosrc, chr(13), '')), ',' order by p.oid::regprocedure::text collate "C")) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('_goldia_opening_return_calc','rpc_record_opening_sale_return','rpc_get_unified_customer_ledger')) = '323976bb8c1a23a670c25406f42ddce7', (select md5(string_agg(p.proname || md5(replace(p.prosrc, chr(13), '')), ',' order by p.oid::regprocedure::text collate "C")) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('_goldia_opening_return_calc','rpc_record_opening_sale_return','rpc_get_unified_customer_ledger'));
select n, name, ok, detail from _e2e order by n;
rollback;
