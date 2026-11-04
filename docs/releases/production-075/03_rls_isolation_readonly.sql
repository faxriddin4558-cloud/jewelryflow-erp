-- GOLDIA PRODUCTION - RLS isolation of every login (copy of supabase/release/staging_rls_isolation_readonly.sql with the
-- PL/pgSQL "begin" / "end" keywords joined to the previous line, so run-readonly-checks.ps1 can keep refusing any
-- line that starts with transaction control). Same logic, READ ONLY, nothing is written.
-- GOLDIA — RLS isolation check across EVERY organization. READ ONLY (begin transaction read only ... rollback).
-- For every active employee that has a login (auth.users), the check switches to the PostgREST role
-- `authenticated` with that user's JWT claims and counts what the user can SELECT directly:
--   * rows of any other organization in every public table with an organization_id column (and organizations.id)
--   * for sellers: rows of other sellers in seller-scoped tables
-- `anon` must see no business rows at all.
-- Output (psql prints NOTICEs on stderr):
--   LEAK|read|<table>|<role>|users=<n>|rows=<max>   one line per leaking table and role
--   RLS_ISOLATION|PASS|users=..|orgs=..|checks=..   or   RLS_ISOLATION|LEAKS|<n>|users=..|orgs=..|checks=..
begin transaction read only;

do $$
declare
  e record;
  t text;
  n bigint;
  k text;
  checks bigint := 0;
  users int := 0;
  orgs int;
  leaks jsonb := '{}';
  org_tables text[];
  seller_tables text[];
  all_tables text[];
  is_seller boolean;
  role_label text; begin
  select array_agg(distinct c.table_name order by c.table_name) into org_tables
    from information_schema.columns c
    join pg_class r on r.relname = c.table_name and r.relnamespace = 'public'::regnamespace and r.relkind in ('r', 'p')
   where c.table_schema = 'public' and c.column_name = 'organization_id';
  select array_agg(distinct c.table_name order by c.table_name) into seller_tables
    from information_schema.columns c
    join pg_class r on r.relname = c.table_name and r.relnamespace = 'public'::regnamespace and r.relkind in ('r', 'p')
   where c.table_schema = 'public' and c.column_name = 'seller_id'
     and c.table_name in ('jewelry_sales', 'consignment_pieces', 'seller_consignments', 'seller_gold_accounts',
                          'gold_settlements', 'client_gold_accounts', 'weight_sale_allocations', 'client_legacy_debts');
  select array_agg(r.relname::text order by r.relname) into all_tables
    from pg_class r where r.relnamespace = 'public'::regnamespace and r.relkind in ('r', 'p');

  -- anon: no rows anywhere
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  foreach t in array all_tables loop begin
      execute format('select count(*) from public.%I', t) into n;
      checks := checks + 1;
      if n > 0 then
        k := 'read|' || t || '|anon';
        leaks := jsonb_set(leaks, array[k], jsonb_build_object('users', 1, 'rows', n)); end if;
    exception when insufficient_privilege then checks := checks + 1; end; end loop;
  reset role;

  select count(distinct organization_id) into orgs from public.employees where organization_id is not null;

  for e in
    select emp.id, emp.user_id, emp.organization_id, lower(coalesce(emp.role::text, '')) as role, lower(coalesce(emp.role_type::text, '')) as role_type
      from public.employees emp
      join auth.users u on u.id = emp.user_id
     where emp.is_active and emp.organization_id is not null
  loop
    users := users + 1;
    is_seller := e.role in ('seller', 'sales', 'sotuvchi') or e.role_type in ('seller', 'sales', 'sotuvchi');
    role_label := case when is_seller then 'seller' else e.role end;
    perform set_config('request.jwt.claims', json_build_object('sub', e.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', e.user_id::text, true);
    set local role authenticated;
    foreach t in array array['organizations'] || org_tables loop begin
        if t = 'organizations' then
          execute 'select count(*) from public.organizations where id <> $1' into n using e.organization_id;
        else
          execute format('select count(*) from public.%I where organization_id <> $1', t) into n using e.organization_id; end if;
        checks := checks + 1;
        if n > 0 then
          k := 'read|' || t || '|' || role_label;
          leaks := jsonb_set(leaks, array[k], jsonb_build_object(
            'users', coalesce((leaks -> k ->> 'users')::int, 0) + 1,
            'rows', greatest(coalesce((leaks -> k ->> 'rows')::bigint, 0), n))); end if;
      exception when insufficient_privilege then checks := checks + 1; end; end loop;
    if is_seller then
      foreach t in array coalesce(seller_tables, '{}') loop begin
          execute format('select count(*) from public.%I where seller_id is distinct from $1', t) into n using e.id;
          checks := checks + 1;
          if n > 0 then
            k := 'read-other-seller|' || t || '|seller';
            leaks := jsonb_set(leaks, array[k], jsonb_build_object(
              'users', coalesce((leaks -> k ->> 'users')::int, 0) + 1,
              'rows', greatest(coalesce((leaks -> k ->> 'rows')::bigint, 0), n))); end if;
        exception when insufficient_privilege then checks := checks + 1; end; end loop; end if;
    reset role; end loop;

  for k in select jsonb_object_keys(leaks) order by 1 loop
    raise notice '%', format('LEAK|%s|users=%s|rows=%s', k, leaks -> k ->> 'users', leaks -> k ->> 'rows'); end loop;
  if leaks = '{}' then
    raise notice '%', format('RLS_ISOLATION|PASS|users=%s|orgs=%s|checks=%s', users, orgs, checks);
  else
    raise notice '%', format('RLS_ISOLATION|LEAKS|%s|users=%s|orgs=%s|checks=%s', (select count(*) from jsonb_object_keys(leaks)), users, orgs, checks); end if; end $$;

rollback;
