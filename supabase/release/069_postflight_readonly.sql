-- PRODUCTION POSTFLIGHT for migration 069 — READ ONLY.

begin transaction read only;

-- Q1. 069 recorded
select version from supabase_migrations.schema_migrations where version = '20260101000069';

-- Q2. No SECURITY DEFINER rpc_* is executable by anon or PUBLIC (expected: both 0)
select
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname like 'rpc\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_executable_rpcs,
  (select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%' and a.grantee = 0) as public_executable_rpcs;

-- Q3. authenticated kept EXECUTE on every SECURITY DEFINER rpc_* (expected: 0 lost)
select count(*) as authenticated_lost from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
   and not has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- Q4. rpc_get_unified_customer_ledger no longer has the first-organization / admin fallbacks (expected: f, f)
select
  position('organizations' || E'\n' || '    limit 1' in pg_get_functiondef('public.rpc_get_unified_customer_ledger(uuid,uuid)'::regprocedure)) > 0 as has_first_org_fallback,
  position(E'current_employee_role_text(), ''admin''' in pg_get_functiondef('public.rpc_get_unified_customer_ledger(uuid,uuid)'::regprocedure)) > 0 as has_admin_fallback;

rollback;
