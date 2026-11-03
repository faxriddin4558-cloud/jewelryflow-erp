-- POSTFLIGHT for migration 075 (customer codes per organization, factory settings pinned to the caller) — READ ONLY.
-- Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000075') as recorded,
  -- customer_code unique per organization, not globally
  exists (select 1 from pg_constraint where conrelid = 'public.customers'::regclass and conname = 'customers_org_customer_code_key'
            and pg_get_constraintdef(oid) = 'UNIQUE NULLS NOT DISTINCT (organization_id, customer_code)') as code_unique_per_org,
  not exists (select 1 from pg_constraint where conrelid = 'public.customers'::regclass and contype = 'u'
                and pg_get_constraintdef(oid) = 'UNIQUE (customer_code)') as no_global_code_unique,
  -- the generator reads only the caller's organization, canonical codes, as bigint, under a per-organization lock
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.rpc_create_customer_with_code(text,text,text,uuid,text)'::regprocedure)) > 0
    and position('::bigint' in pg_get_functiondef('public.rpc_create_customer_with_code(text,text,text,uuid,text)'::regprocedure)) > 0
    and position('::integer' in pg_get_functiondef('public.rpc_create_customer_with_code(text,text,text,uuid,text)'::regprocedure)) = 0
    and position('^CUST-([0-9]{1,9})$' in pg_get_functiondef('public.rpc_create_customer_with_code(text,text,text,uuid,text)'::regprocedure)) > 0 as generator_fixed,
  position('boshqa tashkilotga tegishli' in pg_get_functiondef('public.rpc_create_customer_with_code(text,text,text,uuid,text)'::regprocedure)) > 0 as seller_id_checked,
  -- direct writes
  not has_table_privilege('anon', 'public.customers', 'SELECT') and not has_table_privilege('anon', 'public.customers', 'INSERT')
    and not has_table_privilege('anon', 'public.customers', 'UPDATE') and not has_table_privilege('anon', 'public.customers', 'DELETE')
    and not has_table_privilege('anon', 'public.customers', 'TRUNCATE') as anon_no_customer_access,
  not has_table_privilege('authenticated', 'public.customers', 'INSERT') and not has_table_privilege('authenticated', 'public.customers', 'TRUNCATE') as no_direct_insert,
  has_table_privilege('authenticated', 'public.customers', 'SELECT,UPDATE,DELETE') as authenticated_keeps_read_update_delete,
  exists (select 1 from pg_trigger where tgrelid = 'public.customers'::regclass and tgname = 'trg_goldia_guard_customer_code' and tgenabled = 'O') as code_guard_trigger,
  (select relrowsecurity from pg_class where oid = 'public.customers'::regclass) as customers_rls,
  -- factory settings: caller's organization only, no 'goldia' fallback; table policies tenant-bound
  position('boshqa tashkilot sozlamalari' in pg_get_functiondef('public.rpc_get_factory_settings(uuid)'::regprocedure)) > 0
    and position('coalesce(p_organization_id' in pg_get_functiondef('public.rpc_get_factory_settings(uuid)'::regprocedure)) = 0
    and position('code = ''goldia''' in pg_get_functiondef('public.rpc_get_factory_settings(uuid)'::regprocedure)) = 0 as factory_settings_pinned,
  (select relrowsecurity from pg_class where oid = 'public.organization_factory_settings'::regclass)
    and (select count(*) = 0 from pg_policies where schemaname = 'public' and tablename = 'organization_factory_settings'
           and coalesce(qual, '') || coalesce(with_check, '') not like '%current_organization_id()%') as factory_settings_rls_tenant,
  not has_function_privilege('anon', 'public.rpc_get_factory_settings(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.rpc_create_customer_with_code(text,text,text,uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_get_factory_settings(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_create_customer_with_code(text,text,text,uuid,text)', 'EXECUTE') as rpc_grants,
  -- existing codes kept: still unique per organization (guaranteed by the constraint), none rewritten to a new shape
  (select count(*) = 0 from (select organization_id, customer_code from public.customers group by 1, 2 having count(*) > 1) d) as codes_unique_in_org,
  -- 069 contract preserved
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')) as no_anon_rpcs;

rollback;
