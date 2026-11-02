-- PRODUCTION POSTFLIGHT for migration 071 — READ ONLY. Every column must be true.

begin transaction read only;

select
  to_regprocedure('public.rpc_get_manager_available_stock_grams()') is not null as wrapper_exists,
  not has_function_privilege('authenticated', 'public.get_manager_available_stock_grams(uuid)'::regprocedure, 'EXECUTE') as helper_not_client_callable,
  not has_function_privilege('anon', 'public.get_manager_available_stock_grams(uuid)'::regprocedure, 'EXECUTE') as helper_not_anon_callable,
  has_function_privilege('authenticated', 'public.rpc_get_manager_available_stock_grams()'::regprocedure, 'EXECUTE') as wrapper_authenticated,
  not has_function_privilege('anon', 'public.rpc_get_manager_available_stock_grams()'::regprocedure, 'EXECUTE') as wrapper_not_anon,
  position('assert_erp_permission' in pg_get_functiondef('public.rpc_get_manager_available_stock_grams()'::regprocedure)) > 0 as wrapper_management_only,
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.prosrc ilike '%get_manager_available_stock_grams(%' and p.proname <> 'rpc_get_manager_available_stock_grams'
     and not p.prosecdef) as all_db_callers_definer;

rollback;
