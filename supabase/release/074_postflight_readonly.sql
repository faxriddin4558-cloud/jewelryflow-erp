-- POSTFLIGHT for migration 074 (tenant isolation of jewelry_models / stage_loss_configs) — READ ONLY.
-- Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000074') as recorded,
  -- exactly the eight tenant policies, none of the pre-074 ones
  (select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'jewelry_models'
     and policyname in ('jewelry_models_tenant_select', 'jewelry_models_tenant_insert', 'jewelry_models_tenant_update', 'jewelry_models_tenant_delete'))
    and (select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'jewelry_models') as models_policies,
  (select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'stage_loss_configs'
     and policyname in ('stage_loss_configs_tenant_select', 'stage_loss_configs_tenant_insert', 'stage_loss_configs_tenant_update', 'stage_loss_configs_tenant_delete'))
    and (select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'stage_loss_configs') as loss_configs_policies,
  -- every policy on the two tables is tied to the caller's organization
  (select count(*) = 0 from pg_policies where schemaname = 'public' and tablename in ('jewelry_models', 'stage_loss_configs')
     and coalesce(qual, '') || coalesce(with_check, '') not like '%current_organization_id()%') as all_policies_org_bound,
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.jewelry_models'::regclass, 'public.stage_loss_configs'::regclass)) as rls_enabled,
  not has_table_privilege('anon', 'public.jewelry_models', 'SELECT') and not has_table_privilege('anon', 'public.stage_loss_configs', 'SELECT')
    and not has_table_privilege('anon', 'public.jewelry_models', 'INSERT') and not has_table_privilege('anon', 'public.stage_loss_configs', 'DELETE') as anon_no_access,
  not has_table_privilege('authenticated', 'public.jewelry_models', 'TRUNCATE') and not has_table_privilege('authenticated', 'public.stage_loss_configs', 'TRUNCATE') as no_truncate,
  has_table_privilege('authenticated', 'public.jewelry_models', 'SELECT,INSERT,UPDATE,DELETE')
    and has_table_privilege('authenticated', 'public.stage_loss_configs', 'SELECT,INSERT,UPDATE,DELETE') as authenticated_keeps_dml,
  (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name in ('jewelry_models', 'stage_loss_configs')
     and column_name = 'organization_id' and column_default like '%current_organization_id()%') as org_defaults,
  position('boshqa tashkilot' in pg_get_functiondef('public.rpc_create_jewelry_model(text,text,text,numeric,text,text,uuid,text)'::regprocedure)) > 0
    and position('order by created_at asc limit 1' in pg_get_functiondef('public.rpc_create_jewelry_model(text,text,text,numeric,text,text,uuid,text)'::regprocedure)) = 0 as create_model_rpc_pinned,
  position('current_organization_id()' in pg_get_functiondef('public.rpc_update_jewelry_model_photo(uuid,text)'::regprocedure)) > 0 as photo_rpc_pinned,
  not has_function_privilege('anon', 'public._goldia_can_manage_models()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.rpc_create_jewelry_model(text,text,text,numeric,text,text,uuid,text)', 'EXECUTE') as anon_no_model_rpcs,
  -- 069 contract preserved
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')) as no_anon_rpcs;

rollback;
