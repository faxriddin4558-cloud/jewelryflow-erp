-- PRODUCTION POSTFLIGHT for migration 072 — READ ONLY. Every column must be true.

begin transaction read only;

select
  to_regclass('public.seller_rates') is not null
    and to_regclass('public.seller_rate_history') is not null
    and to_regclass('public.seller_rate_limits') is not null as tables_exist,
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.seller_rates'::regclass, 'public.seller_rate_history'::regclass, 'public.seller_rate_limits'::regclass)) as rls_enabled,
  (select count(*) = 0 from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('seller_rates', 'seller_rate_history', 'seller_rate_limits', 'seller_gold_accounts', 'gold_settlements')
       and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) as no_client_writes,
  (select tgenabled = 'O' from pg_trigger where tgname = 'trg_goldia_seller_till_pool' and tgrelid = 'public.gold_settlements'::regclass) as pool_trigger_enabled,
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('rpc_set_my_seller_rates', 'rpc_get_seller_rates', 'rpc_set_seller_rate_limits', 'rpc_record_client_settlement', 'rpc_record_seller_to_manager_settlement')
     and has_function_privilege('anon', p.oid, 'EXECUTE')) as no_anon_execute,
  (select count(*) = 3 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('rpc_set_my_seller_rates', 'rpc_get_seller_rates', 'rpc_set_seller_rate_limits')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')) as rate_rpcs_callable,
  position('seller_rates' in pg_get_functiondef('public.rpc_record_client_settlement(uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,uuid,numeric,numeric)'::regprocedure)) > 0 as settlement_uses_seller_rates,
  position('till_valued_cash_uzs' in pg_get_functiondef('public.rpc_record_seller_to_manager_settlement(uuid,numeric,numeric,numeric,text,text,numeric,numeric,numeric)'::regprocedure)) > 0 as handover_uses_captured_value,
  -- nothing is valued or set by the migration itself: pools start at 0, no seller rate exists yet
  (select coalesce(sum(till_valued_cash_uzs + till_valued_usd + till_valued_cash_585_g + till_valued_usd_585_g), 0) = 0 from public.seller_gold_accounts) as pools_start_empty,
  (select coalesce(sum(till_pool_cash_uzs + till_pool_usd), 0) = 0 from public.gold_settlements) as history_not_revalued;

rollback;
