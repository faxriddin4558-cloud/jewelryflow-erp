-- ============================================================================
-- JewelryFlow ERP — Migration 023: Factory Settings Persistence & QC Defect Rework
-- ============================================================================
-- 1. Multi-Tenant Factory Settings Persistence (get & update RPCs)
-- 2. Quality Control Schema Enrichment (defect code, rework stage, inspector)
-- 3. Atomic QC Inspection & Rework Stage Routing RPC
-- ============================================================================

-- 1. Enrich quality_control table with multi-tenant and rework fields
alter table public.quality_control
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists batch_id text,
  add column if not exists defect_code text,
  add column if not exists rework_stage_order integer,
  add column if not exists inspector_name text,
  add column if not exists rework_notes text;

-- Update RLS on quality_control for tenant isolation
drop policy if exists "quality_control_tenant_select" on public.quality_control;
create policy "quality_control_tenant_select"
  on public.quality_control for select to authenticated
  using (organization_id = public.current_organization_id() or organization_id is null);

drop policy if exists "quality_control_tenant_insert" on public.quality_control;
create policy "quality_control_tenant_insert"
  on public.quality_control for insert to authenticated
  with check (
    (organization_id = public.current_organization_id() or organization_id is null)
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
      'quality_inspector', 'quality_control', 'qc', 'otk', 'supervisor', 'master'
    )
  );

-- 2. RPC: rpc_get_factory_settings
-- Retrieves the persistent factory configuration for the caller's organization
create or replace function public.rpc_get_factory_settings(
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id      uuid := coalesce(p_organization_id, public.current_organization_id());
  v_org         public.organizations%rowtype;
  v_settings    public.organization_factory_settings%rowtype;
begin
  if v_org_id is null then
    -- Fallback to default Goldia organization
    select * into v_org from public.organizations where code = 'goldia' limit 1;
    if found then
      v_org_id := v_org.id;
    end if;
  else
    select * into v_org from public.organizations where id = v_org_id;
  end if;

  select * into v_settings from public.organization_factory_settings where organization_id = v_org_id;

  if not found then
    -- Insert default settings row if missing
    insert into public.organization_factory_settings (
      organization_id,
      disabled_stage_codes,
      disabled_stage_orders,
      disabled_department_slugs,
      laser_machines_count,
      casting_machines_count,
      workers_count,
      max_models_per_batch,
      sets_per_model,
      handover_tolerance_gram
    ) values (
      v_org_id,
      array['PUMICE', 'PUMICE_MACHINE', 'PONZA', 'ZIRCON', 'ZIRCON_MACHINE']::text[],
      array[9, 13]::integer[],
      array['pumice', 'zircon']::text[],
      8, 2, 35, 20, 10, 0.05
    )
    returning * into v_settings;
  end if;

  return jsonb_build_object(
    'organizationId', v_org_id::text,
    'organizationCode', coalesce(v_org.code, 'goldia'),
    'organizationName', coalesce(v_org.name, 'Goldia Jewelry Factory'),
    'disabledStageCodes', coalesce(v_settings.disabled_stage_codes, array[]::text[]),
    'disabledStageOrders', coalesce(v_settings.disabled_stage_orders, array[]::integer[]),
    'disabledDepartmentSlugs', coalesce(v_settings.disabled_department_slugs, array[]::text[]),
    'laserMachinesCount', coalesce(v_settings.laser_machines_count, 8),
    'castingMachinesCount', coalesce(v_settings.casting_machines_count, 2),
    'workersCount', coalesce(v_settings.workers_count, 35),
    'maxModelsPerBatch', coalesce(v_settings.max_models_per_batch, 20),
    'setsPerModel', coalesce(v_settings.sets_per_model, 10),
    'handoverToleranceGram', coalesce(v_settings.handover_tolerance_gram, 0.05)
  );
end;
$$;

-- 3. RPC: rpc_update_factory_settings
-- Persistently updates factory routing, bypasses and machine capacities
create or replace function public.rpc_update_factory_settings(
  p_disabled_stage_codes      text[] default null,
  p_disabled_stage_orders     integer[] default null,
  p_disabled_department_slugs text[] default null,
  p_laser_machines_count      integer default null,
  p_casting_machines_count    integer default null,
  p_workers_count             integer default null,
  p_max_models_per_batch      integer default null,
  p_sets_per_model            integer default null,
  p_handover_tolerance_gram   numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_settings      public.organization_factory_settings%rowtype;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager'
  ]);

  insert into public.organization_factory_settings (
    organization_id,
    disabled_stage_codes,
    disabled_stage_orders,
    disabled_department_slugs,
    laser_machines_count,
    casting_machines_count,
    workers_count,
    max_models_per_batch,
    sets_per_model,
    handover_tolerance_gram
  ) values (
    v_caller_org,
    coalesce(p_disabled_stage_codes, array['PUMICE', 'PONZA', 'ZIRCON']::text[]),
    coalesce(p_disabled_stage_orders, array[9, 13]::integer[]),
    coalesce(p_disabled_department_slugs, array['pumice', 'zircon']::text[]),
    coalesce(p_laser_machines_count, 8),
    coalesce(p_casting_machines_count, 2),
    coalesce(p_workers_count, 35),
    coalesce(p_max_models_per_batch, 20),
    coalesce(p_sets_per_model, 10),
    coalesce(p_handover_tolerance_gram, 0.05)
  )
  on conflict (organization_id) do update set
    disabled_stage_codes      = coalesce(excluded.disabled_stage_codes, organization_factory_settings.disabled_stage_codes),
    disabled_stage_orders     = coalesce(excluded.disabled_stage_orders, organization_factory_settings.disabled_stage_orders),
    disabled_department_slugs = coalesce(excluded.disabled_department_slugs, organization_factory_settings.disabled_department_slugs),
    laser_machines_count      = coalesce(excluded.laser_machines_count, organization_factory_settings.laser_machines_count),
    casting_machines_count    = coalesce(excluded.casting_machines_count, organization_factory_settings.casting_machines_count),
    workers_count             = coalesce(excluded.workers_count, organization_factory_settings.workers_count),
    max_models_per_batch      = coalesce(excluded.max_models_per_batch, organization_factory_settings.max_models_per_batch),
    sets_per_model            = coalesce(excluded.sets_per_model, organization_factory_settings.sets_per_model),
    handover_tolerance_gram   = coalesce(excluded.handover_tolerance_gram, organization_factory_settings.handover_tolerance_gram),
    updated_at                = now()
  returning * into v_settings;

  -- Record audit trail
  insert into public.audit_logs (
    table_name, record_id, action, actor_id, actor_name, actor_role,
    reason, new_data, organization_id
  ) values (
    'organization_factory_settings',
    v_settings.id::text,
    'UPDATE_FACTORY_SETTINGS',
    auth.uid(),
    public.current_employee_name(),
    v_caller_role,
    'Factory settings updated by authorized manager',
    jsonb_build_object(
      'disabled_stage_orders', v_settings.disabled_stage_orders,
      'disabled_stage_codes', v_settings.disabled_stage_codes,
      'laser_machines_count', v_settings.laser_machines_count,
      'casting_machines_count', v_settings.casting_machines_count,
      'handover_tolerance_gram', v_settings.handover_tolerance_gram
    ),
    v_caller_org
  );

  return jsonb_build_object(
    'status', 'ok',
    'settingsId', v_settings.id::text,
    'organizationId', v_caller_org::text,
    'disabledStageOrders', v_settings.disabled_stage_orders,
    'handoverToleranceGram', v_settings.handover_tolerance_gram
  );
end;
$$;

-- 4. RPC: rpc_record_qc_inspection
-- Atomically records inspection defects into quality_control and routes rework WIP
create or replace function public.rpc_record_qc_inspection(
  p_batch_id           text,
  p_batch_no           text,
  p_operation_name     text,
  p_current_stage_order integer,
  p_checked_qty        integer,
  p_passed_qty         integer,
  p_rework_qty         integer,
  p_defect_code        text default null,
  p_rework_stage_order integer default null,
  p_inspector_name     text default '',
  p_reason             text default null,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_role     text := public.current_employee_role_text();
  v_cur_wip         public.batch_stage_wip%rowtype;
  v_rw_wip          public.batch_stage_wip%rowtype;
  v_qc_id           uuid;
  v_payload         jsonb;
  v_existing        jsonb;
  v_effective_bno   text := btrim(coalesce(p_batch_no, ''));
  v_target_rw_st    integer := coalesce(p_rework_stage_order, 8); -- Default rework fallback: Casting / Assembly
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'quality_inspector', 'quality_control', 'qc', 'otk', 'supervisor', 'master'
  ]);

  if p_checked_qty < 0 or p_passed_qty < 0 or p_rework_qty < 0 then
    raise exception 'Negative inspection quantities are not permitted';
  end if;

  if (p_passed_qty + p_rework_qty) > p_checked_qty then
    raise exception 'Sum of passed (%) and rework (%) quantities exceeds checked quantity (%)',
      p_passed_qty, p_rework_qty, p_checked_qty;
  end if;

  v_payload := jsonb_build_object(
    'batch_no', v_effective_bno,
    'operation_name', p_operation_name,
    'checked_qty', p_checked_qty,
    'passed_qty', p_passed_qty,
    'rework_qty', p_rework_qty,
    'defect_code', p_defect_code
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_qc_inspection', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. Insert into public.quality_control
  insert into public.quality_control (
    organization_id,
    batch_id,
    batch_no,
    operation_name,
    checked_qty,
    passed_qty,
    rework_qty,
    defect_code,
    rework_stage_order,
    inspector_name,
    reason,
    created_at
  ) values (
    v_caller_org,
    btrim(p_batch_id),
    v_effective_bno,
    btrim(p_operation_name),
    p_checked_qty,
    p_passed_qty,
    p_rework_qty,
    p_defect_code,
    v_target_rw_st,
    coalesce(nullif(btrim(p_inspector_name), ''), public.current_employee_name()),
    p_reason,
    now()
  )
  returning id into v_qc_id;

  -- 2. If rework is flagged, update WIP records
  if p_rework_qty > 0 then
    -- Find current stage WIP
    select * into v_cur_wip
      from public.batch_stage_wip
     where (batch_id = btrim(p_batch_id) or batch_no = v_effective_bno)
       and stage_order = p_current_stage_order
       and organization_id = v_caller_org
     for update;

    if found then
      -- Deduct rework from current stage available_qty, record in rework_qty
      update public.batch_stage_wip
         set available_qty = greatest(0, coalesce(available_qty, 0) - p_rework_qty),
             rework_qty    = coalesce(rework_qty, 0) + p_rework_qty,
             updated_at    = now()
       where id = v_cur_wip.id;

      -- Route rework pieces to target rework stage
      select * into v_rw_wip
        from public.batch_stage_wip
       where (batch_id = btrim(p_batch_id) or batch_no = v_effective_bno)
         and stage_order = v_target_rw_st
         and organization_id = v_caller_org
       for update;

      if found then
        update public.batch_stage_wip
           set available_qty = coalesce(available_qty, 0) + p_rework_qty,
               updated_at    = now()
         where id = v_rw_wip.id;
      end if;
    end if;
  end if;

  -- 3. Record audit trail
  insert into public.audit_logs (
    table_name, record_id, action, actor_id, actor_name, actor_role,
    reason, new_data, organization_id
  ) values (
    'quality_control',
    v_qc_id::text,
    'QC_INSPECTION',
    auth.uid(),
    public.current_employee_name(),
    v_caller_role,
    coalesce(p_reason, 'Quality control inspection completed'),
    jsonb_build_object(
      'batch_no', v_effective_bno,
      'checked_qty', p_checked_qty,
      'passed_qty', p_passed_qty,
      'rework_qty', p_rework_qty,
      'defect_code', p_defect_code,
      'target_rework_stage', v_target_rw_st
    ),
    v_caller_org
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'qcId', v_qc_id::text,
    'batchNo', v_effective_bno,
    'checkedQty', p_checked_qty,
    'passedQty', p_passed_qty,
    'reworkQty', p_rework_qty,
    'targetReworkStage', v_target_rw_st
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_qc_inspection', v_existing, v_payload);

  return v_existing;
end;
$$;
