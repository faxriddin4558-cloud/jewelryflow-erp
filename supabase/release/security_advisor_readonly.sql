-- GOLDIA — Supabase Security Advisor equivalents — READ ONLY catalog queries.

begin transaction read only;

-- A1. SECURITY DEFINER views (advisor: security_definer_view). Views run with the owner's
--     rights unless security_invoker=true, which bypasses RLS of the caller.
select 'A1_security_definer_view' as check, n.nspname as schema, c.relname as view
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v' and n.nspname = 'public'
   and not coalesce(c.reloptions::text[] && array['security_invoker=true', 'security_invoker=on'], false)
 order by 3;

-- A2. Public tables without RLS (advisor: rls_disabled_in_public)
select 'A2_rls_disabled' as check, c.relname as table
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 order by 2;

-- A3. Functions with mutable search_path (advisor: function_search_path_mutable)
select 'A3_mutable_search_path' as check, p.oid::regprocedure as function, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
 order by p.prosecdef desc, 2;

-- A4. SECURITY DEFINER functions callable by anon (unauthenticated) — should be near zero
select 'A4_definer_executable_by_anon' as check, p.oid::regprocedure as function
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
 order by 2;

-- A5. Write policies that allow everything (USING/WITH CHECK true)
select 'A5_permissive_write_policy' as check, tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
   and (coalesce(qual, '') in ('true', '') and coalesce(with_check, '') in ('true', ''))
 order by 2, 3;

-- A6. anon table privileges beyond SELECT on public tables
select 'A6_anon_write_grant' as check, table_name, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
 group by 2 order by 2;

-- A7. Summary counts
select 'A7_summary' as check,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v' and n.nspname = 'public'
      and not coalesce(c.reloptions::text[] && array['security_invoker=true', 'security_invoker=on'], false)) as definer_views,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as rls_disabled_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')) as definer_fns_anon;

rollback;
