-- =============================================================================================================
-- 074 — Tenant isolation for jewelry_models (barcode model catalogue) and stage_loss_configs.
--
-- Problem (found by the staging RLS gate, present since before 063 and unchanged by 063..073):
--   * jewelry_models: "authenticated read ... using (true)" and a write policy without an organization condition
--     -> any employee of any organization could read, insert into and update another organization's models.
--   * stage_loss_configs: "Authenticated users can read ... (true)" and "Admins and managers can manage ...
--     is_admin_or_manager()" -> any director/manager could read, update and delete another organization's rows.
--   * rpc_create_jewelry_model (SECURITY DEFINER) accepted a caller-chosen p_organization_id, fell back to the
--     first organization and had no role check; rpc_update_jewelry_model_photo updated any model by id.
-- Fix (no financial table, formula or 073 object is touched):
--   * every policy on the two tables is replaced by tenant policies:
--       SELECT  own organization, plus legacy shared rows with organization_id IS NULL (read only)
--       INSERT/UPDATE/DELETE  own organization only AND the role that already had these rights in its own
--       organization (models: admin/director/manager roles, seller, accountant; loss configs: admin/manager roles)
--   * organization_id defaults to the caller's organization (direct inserts keep working)
--   * anon loses every table privilege; authenticated keeps only SELECT/INSERT/UPDATE/DELETE (TRUNCATE bypasses RLS;
--     PostgreSQL 17 MAINTAIN allows LOCK TABLE)
--   * the two model RPCs are pinned to the caller's organization and role
-- Idempotent: safe to run twice. Rollback: supabase/rollback/20260101000074_rollback.sql.
-- =============================================================================================================

-- Catalogue rights (same role set the 073 write policy granted, now always combined with the own organization)
create or replace function public._goldia_can_manage_models()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin_or_manager()
      or coalesce(public.current_employee_role_text(), '') in ('admin', 'director', 'manager', 'sales', 'seller', 'accountant');
$$;
revoke all on function public._goldia_can_manage_models() from public, anon;
grant execute on function public._goldia_can_manage_models() to authenticated, service_role;

-- Replace every existing policy on the two tables (no stray permissive policy can survive)
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public' and tablename in ('jewelry_models', 'stage_loss_configs') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.jewelry_models enable row level security;
alter table public.stage_loss_configs enable row level security;

create policy jewelry_models_tenant_select on public.jewelry_models
  for select to authenticated
  using (organization_id = public.current_organization_id() or organization_id is null);
create policy jewelry_models_tenant_insert on public.jewelry_models
  for insert to authenticated
  with check (organization_id = public.current_organization_id() and public._goldia_can_manage_models());
create policy jewelry_models_tenant_update on public.jewelry_models
  for update to authenticated
  using (organization_id = public.current_organization_id() and public._goldia_can_manage_models())
  with check (organization_id = public.current_organization_id() and public._goldia_can_manage_models());
create policy jewelry_models_tenant_delete on public.jewelry_models
  for delete to authenticated
  using (organization_id = public.current_organization_id() and public._goldia_can_manage_models());

create policy stage_loss_configs_tenant_select on public.stage_loss_configs
  for select to authenticated
  using (organization_id = public.current_organization_id() or organization_id is null);
create policy stage_loss_configs_tenant_insert on public.stage_loss_configs
  for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.is_admin_or_manager());
create policy stage_loss_configs_tenant_update on public.stage_loss_configs
  for update to authenticated
  using (organization_id = public.current_organization_id() and public.is_admin_or_manager())
  with check (organization_id = public.current_organization_id() and public.is_admin_or_manager());
create policy stage_loss_configs_tenant_delete on public.stage_loss_configs
  for delete to authenticated
  using (organization_id = public.current_organization_id() and public.is_admin_or_manager());

alter table public.jewelry_models alter column organization_id set default public.current_organization_id();
alter table public.stage_loss_configs alter column organization_id set default public.current_organization_id();

revoke all on table public.jewelry_models, public.stage_loss_configs from anon;
revoke truncate, references, trigger on table public.jewelry_models, public.stage_loss_configs from authenticated;
do $$ begin
  if current_setting('server_version_num')::int >= 170000 then -- PostgreSQL 17 MAINTAIN (LOCK/VACUUM/REINDEX)
    execute 'revoke maintain on table public.jewelry_models, public.stage_loss_configs from authenticated';
  end if;
end $$;
grant select, insert, update, delete on table public.jewelry_models, public.stage_loss_configs to authenticated;

CREATE OR REPLACE FUNCTION public.rpc_create_jewelry_model(p_name text, p_category text DEFAULT 'Серьги'::text, p_decorations text DEFAULT NULL::text, p_reference_weight_grams numeric DEFAULT NULL::numeric, p_purity text DEFAULT '585'::text, p_model_code text DEFAULT NULL::text, p_organization_id uuid DEFAULT NULL::uuid, p_primary_image_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id uuid;
  v_model_code text := trim(p_model_code);
  v_next_num integer;
  v_new_model record;
  v_purity_val integer;
  v_purity_text text;
  v_img_url text := nullif(trim(p_primary_image_url), '');
begin
  -- Validation: name is required
  if p_name is null or trim(p_name) = '' then
    raise exception 'Model nomi kiritilishi shart!';
  end if;

  -- 074: models belong to the caller's own organization. No caller-chosen organization, no "first
  -- organization" fallback. A trusted server call (service_role JWT) must name the organization explicitly.
  if coalesce(auth.role(), '') = 'service_role' then
    v_org_id := p_organization_id;
    if v_org_id is null then
      raise exception 'ERR_ORGANIZATION_REQUIRED: service chaqiruvi tashkilotni aniq ko''rsatishi shart';
    end if;
  else
    v_org_id := public.current_organization_id();
    if v_org_id is null then
      raise exception 'Permission denied: foydalanuvchi tashkilotga biriktirilmagan';
    end if;
    if p_organization_id is not null and p_organization_id <> v_org_id then
      raise exception 'Permission denied: boshqa tashkilot ma''lumotiga ruxsat yo''q';
    end if;
    if not public._goldia_can_manage_models() then
      raise exception 'Permission denied: model katalogini o''zgartirish huquqi yo''q';
    end if;
  end if;

  -- Advisory lock to prevent concurrent duplicate model codes
  perform pg_advisory_xact_lock(hashtext('jewelry_models_sequence_lock'));

  -- Clean and parse purity
  v_purity_text := trim(coalesce(p_purity, '585'));
  begin
    v_purity_val := nullif(regexp_replace(v_purity_text, '[^0-9]', '', 'g'), '')::integer;
  exception when others then
    v_purity_val := 585;
  end;
  if v_purity_val is null or v_purity_val <= 0 then
    v_purity_val := 585;
  end if;

  -- Generate or normalize sequential model_code (e.g. JF-M-0001, JF-M-0002)
  if v_model_code is null or v_model_code = '' or v_model_code ~* '^JF-M-0*$' then
    select coalesce(max(substring(model_code from 'JF-M-([0-9]+)')::integer), 0) + 1
      into v_next_num
      from public.jewelry_models
     where model_code ~ '^JF-M-[0-9]+';

    v_model_code := 'JF-M-' || lpad(v_next_num::text, 4, '0');
  else
    -- If custom code provided, check for duplicate collision
    if exists (select 1 from public.jewelry_models where upper(model_code) = upper(v_model_code)) then
      select coalesce(max(substring(model_code from 'JF-M-([0-9]+)')::integer), 0) + 1
        into v_next_num
        from public.jewelry_models
       where model_code ~ '^JF-M-[0-9]+';

      v_model_code := 'JF-M-' || lpad(v_next_num::text, 4, '0');
    end if;
  end if;

  -- Insert atomic record
  insert into public.jewelry_models (
    organization_id,
    model_code,
    name,
    category,
    decorations,
    reference_weight_grams,
    gold_purity,
    proba,
    primary_image_url,
    is_active
  )
  values (
    v_org_id,
    upper(v_model_code),
    trim(p_name),
    trim(coalesce(p_category, 'Серьги')),
    nullif(trim(p_decorations), ''),
    case when p_reference_weight_grams is not null and p_reference_weight_grams > 0
         then p_reference_weight_grams else null end,
    v_purity_val::text,
    v_purity_val,
    v_img_url,
    true
  )
  returning * into v_new_model;

  -- Record audit log
  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (
      organization_id,
      table_name,
      record_id,
      action,
      new_data,
      reason,
      created_at
    ) values (
      v_org_id,
      'jewelry_models',
      v_new_model.id::text,
      'create_model',
      jsonb_build_object(
        'model_code', v_new_model.model_code,
        'name', v_new_model.name,
        'category', v_new_model.category,
        'purity', v_purity_val,
        'weight', v_new_model.reference_weight_grams,
        'primary_image_url', v_new_model.primary_image_url
      ),
      'Created new permanent jewelry model with photo support',
      now()
    );
  end if;

  return to_jsonb(v_new_model);
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_jewelry_model_photo(p_model_id uuid, p_primary_image_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_updated record;
begin
  -- 074: only a model of the caller's own organization, and only with catalogue rights.
  if coalesce(auth.role(), '') <> 'service_role' and not public._goldia_can_manage_models() then
    raise exception 'Permission denied: model katalogini o''zgartirish huquqi yo''q';
  end if;

  update public.jewelry_models
     set primary_image_url = nullif(trim(p_primary_image_url), ''),
         updated_at = now()
   where id = p_model_id
     and (coalesce(auth.role(), '') = 'service_role'
          or organization_id is not distinct from public.current_organization_id() and organization_id is not null)
  returning * into v_updated;

  if not found then
    raise exception 'Model topilmadi (ID: %)', p_model_id;
  end if;

  return to_jsonb(v_updated);
end;
$function$;

revoke all on function public.rpc_create_jewelry_model(text, text, text, numeric, text, text, uuid, text) from public, anon;
revoke all on function public.rpc_update_jewelry_model_photo(uuid, text) from public, anon;
grant execute on function public.rpc_create_jewelry_model(text, text, text, numeric, text, text, uuid, text) to authenticated, service_role;
grant execute on function public.rpc_update_jewelry_model_photo(uuid, text) to authenticated, service_role;
