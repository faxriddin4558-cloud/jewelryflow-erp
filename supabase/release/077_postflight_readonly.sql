-- POSTFLIGHT for migration 077 (director = manager, UZS / USD sales, period report) - READ ONLY. Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000077') as recorded,
  -- A. parity: no Sales rpc admits the director but not the manager (test reset / cleanup excepted, decision gate D-P1)
  (select count(*) = 0 from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'rpc\_%'
       and p.proname not in ('rpc_execute_full_test_reset', 'rpc_preview_full_test_reset', 'rpc_execute_staging_test_cleanup', 'rpc_preview_staging_test_cleanup')
       and (select bool_or(public.normalize_erp_role_token(btrim(x, ' ''"' || chr(10))) = 'admin')
              from regexp_matches(p.prosrc, 'assert_erp_permission\s*\(\s*array\s*\[([^\]]*)\]', 'gi') m, unnest(string_to_array(m[1], ',')) x)
       and not coalesce((select bool_or(public.normalize_erp_role_token(btrim(x, ' ''"' || chr(10))) = 'production_manager')
              from regexp_matches(p.prosrc, 'assert_erp_permission\s*\(\s*array\s*\[([^\]]*)\]', 'gi') m, unnest(string_to_array(m[1], ',')) x), false)) as rpc_parity,
  (select count(*) = 4 from pg_policies where schemaname = 'public'
     and policyname in ('admin manage employees', 'factory_settings_director_manage', 'organizations_director_manage', 'sales_markup_presets_admin_manage')
     and qual like '%production_manager%' and qual like '%current_organization_id()%') as policy_parity_org_bound,
  -- B. currency sales
  to_regprocedure('public.rpc_record_currency_sale(uuid,text,numeric,numeric,uuid[],uuid,text,text)') is not null
    and to_regprocedure('public.rpc_record_client_currency_settlement(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,uuid,text,text)') is not null
    and to_regprocedure('public.rpc_reverse_client_currency_settlement(uuid,text,text)') is not null as currency_rpcs,
  exists (select 1 from pg_constraint where conname = 'jewelry_sales_client_gold_due_grams_check' and pg_get_constraintdef(oid) like '%sale_currency%') as sale_constraint,
  (select relrowsecurity from pg_class where oid = 'public.client_currency_accounts'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.client_currency_settlements'::regclass)
    and not has_table_privilege('authenticated', 'public.client_currency_accounts', 'INSERT')
    and not has_table_privilege('authenticated', 'public.client_currency_accounts', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.client_currency_settlements', 'INSERT')
    and not has_table_privilege('anon', 'public.client_currency_accounts', 'SELECT') as currency_tables_locked,
  position('sale_currency' in pg_get_functiondef('public.rpc_reverse_client_sale(uuid,text,text)'::regprocedure)) > 0 as sale_reversal_currency,
  -- C. period report, no reset
  to_regprocedure('public.rpc_get_period_report(date,date,uuid)') is not null
    and to_regprocedure('public.rpc_close_report_period(date,date,text)') is not null
    and not has_function_privilege('authenticated', 'public._goldia_period_effects(uuid)', 'EXECUTE') as report_rpcs,
  position('update public.client_gold_accounts' in lower(pg_get_functiondef('public.rpc_close_report_period(date,date,text)'::regprocedure))) = 0
    and position('delete from' in lower(pg_get_functiondef('public.rpc_close_report_period(date,date,text)'::regprocedure))) = 0 as close_period_no_reset,
  -- D / E. reclassification + financial reversal
  position('reclassified_from_amount = amount_num' in pg_get_functiondef('public.rpc_reclassify_capital_transaction(uuid,text,text,numeric,uuid,uuid,text)'::regprocedure)) > 0 as reclassify_amount_follows,
  position('reversed_by = public.current_employee_id()' in pg_get_functiondef('public.rpc_reverse_financial_transaction(uuid,text)'::regprocedure)) > 0 as fin_reversal_fk_fixed,
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')) as no_anon_rpcs;

rollback;
