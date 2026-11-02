-- PRODUCTION POSTFLIGHT for migration 073 — READ ONLY. Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000073') as recorded,
  position('till_valued_cash_uzs = 0' in pg_get_functiondef('public.rpc_execute_full_test_reset(text,text)'::regprocedure)) > 0 as reset_clears_till_pool,
  not has_function_privilege('anon', 'public.rpc_execute_full_test_reset(text,text)'::regprocedure, 'EXECUTE') as no_anon_reset,
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')) as no_anon_rpcs;

rollback;
