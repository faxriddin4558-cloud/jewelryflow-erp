-- GOLDIA — cross-organization WRITE isolation probe. LOCAL RESTORED COPY ONLY — never run on staging or production.
-- (scripts/goldia-staging-release.js runs it only against its disposable local cluster.)
-- For every active employee with a login, as role `authenticated` with that user's JWT claims, it tries
--   update <t> set organization_id = organization_id where organization_id <> own organization
--   delete from <t> where organization_id <> own organization
-- for every public table with organization_id. Each probe runs in its own subtransaction that is always rolled
-- back, and the whole transaction is rolled back at the end: nothing is changed.
-- Output: LEAK|update|<table>|<role>|users=..|rows=.. / LEAK|delete|... and RLS_WRITE_ISOLATION|PASS|... or |LEAKS|n|...
begin;

do $$
declare
  e record;
  t text;
  op text;
  n bigint;
  k text;
  checks bigint := 0;
  users int := 0;
  leaks jsonb := '{}';
  org_tables text[];
  role_label text;
begin
  if to_regprocedure('public.deployment_environment()') is not null then
    raise exception 'refusing: not a Goldia local copy';
  end if;
  select array_agg(distinct c.table_name order by c.table_name) into org_tables
    from information_schema.columns c
    join pg_class r on r.relname = c.table_name and r.relnamespace = 'public'::regnamespace and r.relkind in ('r', 'p')
   where c.table_schema = 'public' and c.column_name = 'organization_id';

  for e in
    select emp.id, emp.user_id, emp.organization_id, lower(coalesce(emp.role::text, '')) as role, lower(coalesce(emp.role_type::text, '')) as role_type
      from public.employees emp
      join auth.users u on u.id = emp.user_id
     where emp.is_active and emp.organization_id is not null
  loop
    users := users + 1;
    role_label := case when e.role in ('seller', 'sales', 'sotuvchi') or e.role_type in ('seller', 'sales', 'sotuvchi') then 'seller' else e.role end;
    perform set_config('request.jwt.claims', json_build_object('sub', e.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', e.user_id::text, true);
    set local role authenticated;
    foreach t in array org_tables loop
      foreach op in array array['update', 'delete'] loop
        n := 0;
        begin
          if op = 'update' then
            execute format('with x as (update public.%I set organization_id = organization_id where organization_id <> $1 returning 1) select count(*) from x', t)
              into n using e.organization_id;
          else
            execute format('with x as (delete from public.%I where organization_id <> $1 returning 1) select count(*) from x', t)
              into n using e.organization_id;
          end if;
          raise exception using errcode = 'P0099'; -- always undo this probe
        exception
          when sqlstate 'P0099' then null;          -- n keeps the number of rows the user could change
          when others then n := 0;                  -- denied (permission, policy or guard trigger)
        end;
        checks := checks + 1;
        if n > 0 then
          k := op || '|' || t || '|' || role_label;
          leaks := jsonb_set(leaks, array[k], jsonb_build_object(
            'users', coalesce((leaks -> k ->> 'users')::int, 0) + 1,
            'rows', greatest(coalesce((leaks -> k ->> 'rows')::bigint, 0), n)));
        end if;
      end loop;
    end loop;
    reset role;
  end loop;

  for k in select jsonb_object_keys(leaks) order by 1 loop
    raise notice '%', format('LEAK|%s|users=%s|rows=%s', k, leaks -> k ->> 'users', leaks -> k ->> 'rows');
  end loop;
  if leaks = '{}' then
    raise notice '%', format('RLS_WRITE_ISOLATION|PASS|users=%s|checks=%s', users, checks);
  else
    raise notice '%', format('RLS_WRITE_ISOLATION|LEAKS|%s|users=%s|checks=%s', (select count(*) from jsonb_object_keys(leaks)), users, checks);
  end if;
end $$;

rollback;
