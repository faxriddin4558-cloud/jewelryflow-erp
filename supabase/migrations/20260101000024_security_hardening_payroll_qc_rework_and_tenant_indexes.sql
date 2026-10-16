-- ============================================================================
-- JewelryFlow ERP — Migration 024: Security Hardening, Payroll Over-Adjustment
-- Guards, QC Defect Rework Completion & Multi-Tenant Unique Index Scoping
-- ============================================================================
-- 1. Multi-Tenant Unique Constraint Scoping (Order, Batch, WIP, Product, Payroll)
-- 2. Quality Control Schema Enrichment & rpc_complete_qc_rework
-- 3. Piecework Payroll Deduplication & Over-Adjustment Prevention
-- 4. Multi-Tenant Hardening for Inventory, Alloy, Affinaj, Orders & Products
-- ============================================================================

-- ============================================================================
-- 1. MULTI-TENANT UNIQUE CONSTRAINT SCOPING
-- ============================================================================
-- Drop global table constraints and indexes that prevent multi-tenant coexistence
alter table public.products drop constraint if exists products_name_key;
alter table public.orders drop constraint if exists orders_order_number_key;
alter table public.orders drop constraint if exists orders_order_no_key;
alter table public.batches drop constraint if exists batches_batch_number_key;
alter table public.batches drop constraint if exists batches_batch_no_key;
alter table public.batches drop constraint if exists batches_number_key;
alter table public.batch_stage_wip drop constraint if exists batch_stage_wip_batch_no_stage_order_key;
alter table public.batch_stage_wip drop constraint if exists batch_stage_wip_batch_id_stage_order_key;

drop index if exists public.idx_orders_order_no_unique;
drop index if exists public.idx_orders_tenant_order_no_unique;
create unique index idx_orders_tenant_order_no_unique
  on public.orders (coalesce(organization_id, '00000000-0000-0000-0000-000000000001'::uuid), order_no)
  where order_no is not null and btrim(order_no) <> '';

drop index if exists public.idx_batches_batch_no_unique;
drop index if exists public.idx_batches_tenant_batch_no_unique;
create unique index idx_batches_tenant_batch_no_unique
  on public.batches (coalesce(organization_id, '00000000-0000-0000-0000-000000000001'::uuid), batch_no)
  where batch_no is not null and btrim(batch_no) <> '';

drop index if exists public.idx_batch_stage_wip_batch_stage_unique;
drop index if exists public.idx_batch_stage_wip_tenant_batch_stage_unique;
create unique index idx_batch_stage_wip_tenant_batch_stage_unique
  on public.batch_stage_wip (coalesce(organization_id, '00000000-0000-0000-0000-000000000001'::uuid), batch_no, stage_order);

drop index if exists public.idx_products_name_unique;
drop index if exists public.idx_products_tenant_name_unique;
create unique index idx_products_tenant_name_unique
  on public.products (coalesce(organization_id, '00000000-0000-0000-0000-000000000001'::uuid), lower(btrim(name)))
  where name is not null and btrim(name) <> '';

drop index if exists public.idx_salary_ledger_unique_earned;
drop index if exists public.idx_salary_ledger_tenant_unique_earned;
create unique index idx_salary_ledger_tenant_unique_earned
  on public.salary_ledger (
    coalesce(organization_id, '00000000-0000-0000-0000-000000000001'::uuid),
    coalesce(employee_id::text, lower(trim(worker_name))),
    upper(trim(batch_no)),
    lower(trim(stage_name))
  )
  where tx_type = 'EARNED';


-- ============================================================================
-- 2. QUALITY CONTROL SCHEMA ENRICHMENT & REWORK COMPLETION
-- ============================================================================
alter table public.quality_control
  add column if not exists status text default 'PENDING',
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by text,
  add column if not exists resolution_notes text;

drop policy if exists "quality_control_tenant_update" on public.quality_control;
create policy "quality_control_tenant_update"
  on public.quality_control for update to authenticated
  using (
    (organization_id = public.current_organization_id() or organization_id is null)
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
      'quality_inspector', 'quality_control', 'qc', 'otk', 'supervisor', 'master'
    )
  );

-- Update rpc_record_qc_inspection
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
  v_target_rw_st    integer := coalesce(p_rework_stage_order, 8);
  v_init_status     text := case when coalesce(p_rework_qty, 0) > 0 then 'IN_REWORK' else 'PASSED' end;
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
    status,
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
    v_init_status,
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
      update public.batch_stage_wip
         set available_qty = greatest(0, coalesce(available_qty, 0) - p_rework_qty),
             rework_qty    = coalesce(rework_qty, 0) + p_rework_qty,
             updated_at    = now()
       where id = v_cur_wip.id;
    else
      -- Ensure current stage WIP row exists
      insert into public.batch_stage_wip (
        organization_id, batch_id, batch_no, stage_order, stage_name, department,
        available_qty, completed_qty, rework_qty, queue_status
      ) values (
        v_caller_org, btrim(p_batch_id), v_effective_bno, p_current_stage_order, btrim(p_operation_name), 'QC',
        greatest(0, p_checked_qty - p_rework_qty), p_passed_qty, p_rework_qty, 'NOW'
      );
    end if;

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
    else
      insert into public.batch_stage_wip (
        organization_id, batch_id, batch_no, stage_order, stage_name, department,
        available_qty, completed_qty, rework_qty, queue_status
      ) values (
        v_caller_org, btrim(p_batch_id), v_effective_bno, v_target_rw_st, '8. Quyish (Rework)', 'Quyish',
        p_rework_qty, 0, 0, 'NOW'
      );
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
      'target_rework_stage', v_target_rw_st,
      'status', v_init_status
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
    'targetReworkStage', v_target_rw_st,
    'qcStatus', v_init_status
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_qc_inspection', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 2.2 RPC: rpc_complete_qc_rework
create or replace function public.rpc_complete_qc_rework(
  p_qc_id               text default null,
  p_batch_id            text default null,
  p_batch_no            text default null,
  p_rework_stage_order  integer default null,
  p_inspect_stage_order integer default 20,
  p_completed_qty       integer default 0,
  p_master_name         text default '',
  p_resolution_notes    text default '',
  p_idempotency_key     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org       uuid := public.current_organization_id();
  v_caller_role      text := public.current_employee_role_text();
  v_effective_bno    text := btrim(coalesce(p_batch_no, ''));
  v_effective_bid    text := btrim(coalesce(p_batch_id, ''));
  v_rw_st            integer := coalesce(p_rework_stage_order, 8);
  v_insp_st          integer := coalesce(p_inspect_stage_order, 20);
  v_qty              integer := coalesce(p_completed_qty, 0);
  v_rw_wip           public.batch_stage_wip%rowtype;
  v_insp_wip         public.batch_stage_wip%rowtype;
  v_qc               public.quality_control%rowtype;
  v_existing         jsonb;
  v_payload          jsonb;
  v_resolved_by      text;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'supervisor', 'master', 'bosh usta', 'usta', 'quality_inspector', 'qc', 'otk'
  ]);

  if v_qty <= 0 then
    raise exception 'Completed rework quantity must be greater than zero (received %)', v_qty;
  end if;

  v_payload := jsonb_build_object(
    'qc_id', btrim(coalesce(p_qc_id, '')),
    'batch_no', v_effective_bno,
    'completed_qty', v_qty,
    'rework_stage_order', v_rw_st,
    'inspect_stage_order', v_insp_st
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_complete_qc_rework', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  v_resolved_by := coalesce(nullif(btrim(p_master_name), ''), public.current_employee_name());

  -- 1. Identify and lock QC record
  if p_qc_id is not null and btrim(p_qc_id) <> '' then
    select * into v_qc
      from public.quality_control
     where id::text = btrim(p_qc_id)
       and organization_id = v_caller_org
     for update;
    if not found then
      raise exception 'QC record % not found in your organization', p_qc_id;
    end if;
  else
    select * into v_qc
      from public.quality_control
     where (batch_id = v_effective_bid or batch_no = v_effective_bno)
       and organization_id = v_caller_org
       and status = 'IN_REWORK'
     order by created_at desc
     limit 1
     for update;
  end if;

  if v_effective_bno = '' and v_qc.batch_no is not null then
    v_effective_bno := v_qc.batch_no;
  end if;
  if v_effective_bid = '' and v_qc.batch_id is not null then
    v_effective_bid := v_qc.batch_id;
  end if;

  -- 2. Lock rework WIP stage and transfer back to inspection WIP stage
  select * into v_rw_wip
    from public.batch_stage_wip
   where (batch_id = v_effective_bid or batch_no = v_effective_bno)
     and stage_order = v_rw_st
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Rework WIP record for stage % and batch % not found', v_rw_st, v_effective_bno;
  end if;

  if coalesce(v_rw_wip.available_qty, 0) < v_qty then
    raise exception 'Insufficient available pieces at rework stage % (available=%, requested=%)',
      v_rw_st, coalesce(v_rw_wip.available_qty, 0), v_qty;
  end if;

  -- Deduct from rework stage
  update public.batch_stage_wip
     set available_qty = available_qty - v_qty,
         completed_qty = coalesce(completed_qty, 0) + v_qty,
         updated_at    = now()
   where id = v_rw_wip.id;

  -- Return to inspection stage (clear rework_qty, restore available_qty)
  select * into v_insp_wip
    from public.batch_stage_wip
   where (batch_id = v_effective_bid or batch_no = v_effective_bno)
     and stage_order = v_insp_st
     and organization_id = v_caller_org
   for update;

  if found then
    update public.batch_stage_wip
       set available_qty = coalesce(available_qty, 0) + v_qty,
           rework_qty    = greatest(0, coalesce(rework_qty, 0) - v_qty),
           updated_at    = now()
     where id = v_insp_wip.id;
  else
    insert into public.batch_stage_wip (
      organization_id, batch_id, batch_no, stage_order, stage_name, department,
      available_qty, completed_qty, rework_qty, queue_status
    ) values (
      v_caller_org, v_effective_bid, v_effective_bno, v_insp_st, 'QC / Yakuniy nazorat', 'QC',
      v_qty, 0, 0, 'NOW'
    );
  end if;

  -- 3. Update QC record status
  if v_qc.id is not null then
    update public.quality_control
       set status           = 'REWORK_COMPLETED',
           resolved_at      = now(),
           resolved_by      = v_resolved_by,
           resolution_notes = coalesce(nullif(btrim(p_resolution_notes), ''), 'Rework successfully completed by master and returned for re-inspection')
     where id = v_qc.id;
  end if;

  -- 4. Record audit trail
  insert into public.audit_logs (
    table_name, record_id, action, actor_id, actor_name, actor_role,
    reason, new_data, organization_id
  ) values (
    'quality_control',
    coalesce(v_qc.id::text, v_effective_bno),
    'QC_REWORK_COMPLETED',
    auth.uid(),
    v_resolved_by,
    v_caller_role,
    coalesce(nullif(btrim(p_resolution_notes), ''), 'QC rework completed'),
    jsonb_build_object(
      'batch_no', v_effective_bno,
      'completed_qty', v_qty,
      'from_rework_stage', v_rw_st,
      'to_inspect_stage', v_insp_st,
      'master_name', v_resolved_by
    ),
    v_caller_org
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'qcId', coalesce(v_qc.id::text, null),
    'batchNo', v_effective_bno,
    'completedReworkQty', v_qty,
    'reworkStage', v_rw_st,
    'returnedStage', v_insp_st,
    'resolvedBy', v_resolved_by
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_complete_qc_rework', v_existing, v_payload);

  return v_existing;
end;
$$;


-- ============================================================================
-- 3. PIECEWORK PAYROLL DEDUPLICATION & OVER-ADJUSTMENT PREVENTION
-- ============================================================================

-- 3.1 Hardened rpc_calculate_piecework_salary
create or replace function public.rpc_calculate_piecework_salary(
  p_handover_id       text default null,
  p_worker_id         text default null,
  p_worker_name       text default null,
  p_batch_no          text default null,
  p_stage_name        text default null,
  p_stage_order       integer default null,
  p_weight_done       numeric default 0,
  p_qty_done          integer default 0,
  p_rate              numeric default null,
  p_idempotency_key   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org   uuid := public.current_organization_id();
  v_caller_role  text := public.current_employee_role_text();
  v_emp          public.employees%rowtype;
  v_rate         numeric(18, 2);
  v_amount       numeric(18, 2);
  v_weight       numeric(14, 4) := round(coalesce(p_weight_done, 0)::numeric, 4);
  v_existing     jsonb;
  v_payload      jsonb;
  v_ledger_id    uuid;
  v_worker_title text;
  v_ho           public.two_party_handovers%rowtype;
  v_existing_row public.salary_ledger%rowtype;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if p_handover_id is not null and btrim(p_handover_id) <> '' then
    select * into v_ho
      from public.two_party_handovers
     where id::text = btrim(p_handover_id)
       and organization_id = v_caller_org;

    if not found then
      raise exception 'Handover % not found in your organization', p_handover_id;
    end if;

    if v_ho.status not in ('ACCEPTED', 'SUPERVISOR_OVERRIDDEN') then
      raise exception 'Cannot award piecework salary for unapproved handover status: %', v_ho.status;
    end if;
  else
    perform public.assert_erp_permission(array[
      'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
      'supervisor', 'master', 'accountant', 'buxgalter'
    ]);
  end if;

  v_payload := jsonb_build_object(
    'handover_id', btrim(coalesce(p_handover_id, '')),
    'worker_id', btrim(coalesce(p_worker_id, '')),
    'batch_no', btrim(coalesce(p_batch_no, '')),
    'stage_name', btrim(coalesce(p_stage_name, '')),
    'weight_done', v_weight
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_calculate_piecework_salary', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_weight <= 0 and coalesce(p_qty_done, 0) <= 0 then
    raise exception 'Cannot calculate piecework salary with zero weight and quantity';
  end if;

  -- Resolve employee and rate
  select * into v_emp
    from public.employees
   where (id::text = btrim(coalesce(p_worker_id, ''))
          or lower(trim(name)) = lower(trim(coalesce(p_worker_name, '')))
          or lower(trim(full_name)) = lower(trim(coalesce(p_worker_name, ''))))
     and (organization_id = v_caller_org or organization_id is null)
   limit 1;

  v_worker_title := coalesce(v_emp.full_name, v_emp.name, p_worker_name, 'Xodim');

  if p_rate is not null and p_rate > 0 then
    v_rate := round(p_rate::numeric, 2);
  elsif v_emp.gram_rate is not null and v_emp.gram_rate > 0 then
    v_rate := round(v_emp.gram_rate::numeric, 2);
  elsif v_emp.rate is not null and v_emp.rate > 0 then
    v_rate := round(v_emp.rate::numeric, 2);
  else
    v_rate := 15000.00;
  end if;

  v_amount := round((v_weight * v_rate)::numeric, 2);
  if v_amount <= 0 then
    v_amount := 1.00;
  end if;

  -- Idempotently check if an EARNED entry already exists for this handover
  if p_handover_id is not null and btrim(p_handover_id) != '' then
    select * into v_existing_row
      from public.salary_ledger
     where handover_id = btrim(p_handover_id)
       and organization_id = v_caller_org
       and tx_type = 'EARNED'
     limit 1;

    if found then
      v_existing := jsonb_build_object(
        'status', 'ok',
        'deduplicated', true,
        'ledger_id', v_existing_row.id::text,
        'amount', v_existing_row.amount,
        'worker_name', v_worker_title,
        'rate', v_rate,
        'weight_done', v_weight,
        'organization_id', v_caller_org
      );
      return v_existing;
    end if;
  end if;

  -- Check if already earned by employee + batch + stage in this organization
  select * into v_existing_row
    from public.salary_ledger
   where organization_id = v_caller_org
     and (employee_id::text = coalesce(v_emp.id::text, p_worker_id)
          or lower(trim(worker_name)) = lower(trim(v_worker_title)))
     and upper(trim(batch_no)) = upper(trim(coalesce(p_batch_no, 'BATCH')))
     and lower(trim(stage_name)) = lower(trim(coalesce(p_stage_name, 'Manufacturing')))
     and tx_type = 'EARNED'
   limit 1;

  if found then
    v_existing := jsonb_build_object(
      'status', 'ok',
      'deduplicated', true,
      'ledger_id', v_existing_row.id::text,
      'amount', v_existing_row.amount,
      'worker_name', v_worker_title,
      'rate', v_rate,
      'weight_done', v_weight,
      'organization_id', v_caller_org
    );
    return v_existing;
  end if;

  insert into public.salary_ledger (
    employee_id, worker_name, batch_no, stage_name, tx_type,
    weight_done, rate, amount, payment_status, note,
    handover_id, stage_order, idempotency_key, organization_id
  ) values (
    coalesce(v_emp.id::text, p_worker_id),
    v_worker_title,
    btrim(coalesce(p_batch_no, 'BATCH')),
    btrim(coalesce(p_stage_name, 'Manufacturing')),
    'EARNED',
    v_weight,
    v_rate,
    v_amount,
    'UNPAID',
    format('Piecework earned: %sg @ %s UZS/g (Handover %s)', v_weight, v_rate, coalesce(p_handover_id, 'direct')),
    nullif(btrim(p_handover_id), ''),
    p_stage_order,
    nullif(btrim(p_idempotency_key), ''),
    v_caller_org
  ) returning id into v_ledger_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'deduplicated', false,
    'ledger_id', v_ledger_id::text,
    'amount', v_amount,
    'worker_name', v_worker_title,
    'rate', v_rate,
    'weight_done', v_weight,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_calculate_piecework_salary', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 3.2 Hardened rpc_adjust_piecework_salary with Over-Adjustment & Reversal Guards
create or replace function public.rpc_adjust_piecework_salary(
  p_original_ledger_id text,
  p_adjustment_amount  numeric,
  p_reason             text,
  p_tx_type            text default 'ADJUSTMENT',
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_caller_role       text := public.current_employee_role_text();
  v_orig              public.salary_ledger%rowtype;
  v_adj_amount        numeric(18, 2) := round(abs(coalesce(p_adjustment_amount, 0))::numeric, 2);
  v_tx_type           text := upper(btrim(coalesce(p_tx_type, 'ADJUSTMENT')));
  v_new_ledger_id     uuid;
  v_existing          jsonb;
  v_payload           jsonb;
  v_already_adjusted  numeric(18, 2) := 0;
  v_remaining_balance numeric(18, 2);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_caller_role not in (
    'admin', 'director', 'owner', 'manager', 'production_manager',
    'accountant', 'buxgalter', 'hisobchi', 'supervisor'
  ) then
    raise exception 'Permission denied: Role "%" is not authorized to adjust piecework salary', v_caller_role
      using errcode = '42501';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'Salary adjustment requires a documented justification reason (min 5 characters)';
  end if;

  if v_tx_type not in ('ADJUSTMENT', 'REVERSAL') then
    raise exception 'Invalid adjustment type: % (must be ADJUSTMENT or REVERSAL)', v_tx_type;
  end if;

  v_payload := jsonb_build_object(
    'original_ledger_id', btrim(coalesce(p_original_ledger_id, '')),
    'amount', v_adj_amount,
    'tx_type', v_tx_type
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_adjust_piecework_salary', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_orig
    from public.salary_ledger
   where id::text = btrim(p_original_ledger_id)
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Original salary ledger record (%) not found', p_original_ledger_id;
  end if;

  if v_orig.tx_type in ('ADJUSTMENT', 'REVERSAL') then
    raise exception 'Cannot adjust an adjustment or reversal transaction (only original EARNED records can be adjusted)';
  end if;

  select coalesce(sum(amount), 0) into v_already_adjusted
    from public.salary_ledger
   where original_ledger_id = v_orig.id::text
     and organization_id = v_caller_org
     and tx_type in ('ADJUSTMENT', 'REVERSAL');

  v_remaining_balance := v_orig.amount - v_already_adjusted;

  if v_remaining_balance <= 0 then
    raise exception 'Original salary record (%) has already been fully adjusted or reversed (% UZS adjusted of % UZS total)',
      v_orig.id, v_already_adjusted, v_orig.amount;
  end if;

  if v_adj_amount <= 0 or v_tx_type = 'REVERSAL' then
    v_adj_amount := v_remaining_balance;
  end if;

  if v_adj_amount > v_remaining_balance then
    raise exception 'Requested adjustment (% UZS) exceeds remaining adjustable balance (% UZS of original % UZS)',
      v_adj_amount, v_remaining_balance, v_orig.amount;
  end if;

  insert into public.salary_ledger (
    employee_id, worker_name, batch_no, stage_name, tx_type,
    weight_done, rate, amount, payment_status, note,
    handover_id, stage_order, original_ledger_id, idempotency_key, organization_id
  ) values (
    v_orig.employee_id,
    v_orig.worker_name,
    v_orig.batch_no,
    v_orig.stage_name,
    v_tx_type,
    v_orig.weight_done,
    v_orig.rate,
    v_adj_amount,
    'PAID',
    format('%s: %s (Orig Ledger: %s)', v_tx_type, btrim(p_reason), v_orig.id::text),
    v_orig.handover_id,
    v_orig.stage_order,
    v_orig.id::text,
    nullif(btrim(p_idempotency_key), ''),
    v_caller_org
  ) returning id into v_new_ledger_id;

  insert into public.audit_logs (
    table_name, record_id, action, actor_id, actor_name, actor_role,
    reason, new_data, organization_id
  ) values (
    'salary_ledger',
    v_new_ledger_id::text,
    'SALARY_' || v_tx_type,
    auth.uid(),
    public.current_employee_name(),
    v_caller_role,
    btrim(p_reason),
    jsonb_build_object(
      'original_ledger_id', v_orig.id::text,
      'adjusted_amount', v_adj_amount,
      'previous_adjusted', v_already_adjusted,
      'remaining_balance', v_remaining_balance - v_adj_amount,
      'worker_name', v_orig.worker_name,
      'batch_no', v_orig.batch_no,
      'tx_type', v_tx_type
    ),
    v_caller_org
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'adjustment_ledger_id', v_new_ledger_id::text,
    'original_ledger_id', v_orig.id::text,
    'worker_name', v_orig.worker_name,
    'adjusted_amount', v_adj_amount,
    'remaining_balance', v_remaining_balance - v_adj_amount,
    'tx_type', v_tx_type,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_adjust_piecework_salary', v_existing, v_payload);

  return v_existing;
end;
$$;


-- ============================================================================
-- 4. MULTI-TENANT HARDENING FOR INVENTORY, ALLOY, AFFINAJ, ORDERS & PRODUCTS
-- ============================================================================

-- 4.1 rpc_inventory_transaction multi-tenant hardening
create or replace function public.rpc_inventory_transaction(
  p_item_id         text,
  p_tx_type         text,
  p_weight          numeric,
  p_proba           numeric default 0,
  p_pure_gold       numeric default 0,
  p_from_location   text default 'safe',
  p_to_location     text default 'safe',
  p_description     text default '',
  p_order_id        text default null,
  p_order_no        text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org  uuid := public.current_organization_id();
  v_item        public.inventory_items%rowtype;
  v_res_row     public.inventory_reservations%rowtype;
  v_weight      numeric(14, 4) := round(abs(coalesce(p_weight, 0))::numeric, 4);
  v_on_hand     numeric(14, 4);
  v_reserved    numeric(14, 4);
  v_avail       numeric(14, 4);
  v_fine        numeric(18, 6);
  v_existing    jsonb;
  v_payload     jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi',
    'inventory_manager', 'manager', 'production_manager', 'production manager'
  ]);

  v_payload := jsonb_build_object(
    'item_id', btrim(coalesce(p_item_id, '')),
    'tx_type', btrim(coalesce(p_tx_type, '')),
    'weight', v_weight,
    'order_id', btrim(coalesce(p_order_id, ''))
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_inventory_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(btrim(p_item_id), '') = '' then
    raise exception 'Inventory item ID is required';
  end if;

  if v_weight <= 0 then
    raise exception 'Inventory transaction weight must be greater than zero';
  end if;

  select * into v_item
    from public.inventory_items
   where id::text = btrim(p_item_id)
     for update;

  if not found then
    raise exception 'Inventory item (%) not found', p_item_id;
  end if;

  if v_item.organization_id is not null and v_item.organization_id <> v_caller_org then
    raise exception 'Cross-tenant violation: Inventory item does not belong to your organization'
      using errcode = '42501';
  end if;

  v_on_hand  := coalesce(v_item.on_hand, v_item.quantity_on_hand, 0);
  v_reserved := coalesce(v_item.reserved, 0);
  v_avail    := v_on_hand - v_reserved;
  v_fine     := public.calc_fine_gold_exact(v_weight, coalesce(nullif(p_proba, 0), v_item.proba, 0));

  if p_tx_type = 'kirim' then
    v_on_hand := v_on_hand + v_weight;
  elsif p_tx_type = 'chiqim' then
    if v_weight > v_avail then
      raise exception 'Insufficient available inventory: available=%g, requested=%g', v_avail, v_weight;
    end if;
    v_on_hand := v_on_hand - v_weight;
  elsif p_tx_type = 'reserve' then
    if v_weight > v_avail then
      raise exception 'Cannot reserve %g: only %g available', v_weight, v_avail;
    end if;
    v_reserved := v_reserved + v_weight;

    insert into public.inventory_reservations (
      organization_id, inventory_item_id, order_id, order_no, reserved_grams, status, idempotency_key, created_by
    ) values (
      v_caller_org, v_item.id, p_order_id, p_order_no, v_weight, 'ACTIVE', nullif(btrim(p_idempotency_key), ''), auth.uid()
    );

    if p_order_id is not null and btrim(p_order_id) <> '' then
      update public.orders
         set reserved_item_id = v_item.id,
             reserved_gold_gram = coalesce(reserved_gold_gram, 0) + v_weight
       where id::text = btrim(p_order_id)
         and organization_id = v_caller_org;
    end if;
  elsif p_tx_type = 'unreserve' then
    if v_weight > v_reserved then
      raise exception 'Cannot unreserve %g: only %g currently reserved', v_weight, v_reserved;
    end if;
    v_reserved := v_reserved - v_weight;

    if p_order_id is not null and btrim(p_order_id) <> '' then
      select * into v_res_row
        from public.inventory_reservations
       where inventory_item_id = v_item.id
         and order_id::text = btrim(p_order_id)
         and (organization_id = v_caller_org or organization_id is null)
         and status = 'ACTIVE'
       order by created_at asc
       limit 1
         for update;

      if found then
        update public.inventory_reservations
           set released_grams = released_grams + least(v_weight, reserved_grams - consumed_grams - released_grams),
               status = case
                 when consumed_grams + released_grams + v_weight >= reserved_grams then 'RELEASED'
                 else 'ACTIVE'
               end,
               updated_at = now()
         where id = v_res_row.id;
      end if;

      update public.orders
         set reserved_gold_gram = greatest(0, coalesce(reserved_gold_gram, 0) - v_weight)
       where id::text = btrim(p_order_id)
         and organization_id = v_caller_org;
    end if;
  else
    raise exception 'Unsupported inventory transaction type: %', p_tx_type;
  end if;

  update public.inventory_items
     set on_hand = v_on_hand,
         quantity_on_hand = v_on_hand,
         reserved = v_reserved
   where id = v_item.id;

  insert into public.gold_transactions (
    organization_id, transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, description, idempotency_key, performed_by
  ) values (
    v_caller_org, p_tx_type, p_from_location, p_to_location, v_item.name,
    v_weight, v_weight, coalesce(nullif(p_proba, 0), v_item.proba, 0), v_fine,
    p_description, nullif(btrim(p_idempotency_key), ''), public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'item_id', v_item.id::text,
    'on_hand', v_on_hand,
    'reserved', v_reserved,
    'available', v_on_hand - v_reserved
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_inventory_transaction', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 4.2 rpc_execute_alloy_transaction multi-tenant hardening
create or replace function public.rpc_execute_alloy_transaction(
  p_source_item_id     text,
  p_target_item_id     text,
  p_input_weight       numeric,
  p_source_proba       numeric,
  p_target_proba       numeric,
  p_ligature_weight    numeric default 0,
  p_fine_gold_added    numeric default 0,
  p_output_weight      numeric default 0,
  p_pure_gold          numeric default 0,
  p_fine_gold_item_id  text default null,
  p_silver_item_id     text default null,
  p_silver_weight      numeric default 0,
  p_copper_item_id     text default null,
  p_copper_weight      numeric default 0,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org  uuid := public.current_organization_id();
  v_src         public.inventory_items%rowtype;
  v_tar         public.inventory_items%rowtype;
  v_fine_item   public.inventory_items%rowtype;
  v_silver_item public.inventory_items%rowtype;
  v_copper_item public.inventory_items%rowtype;
  v_in_w        numeric(14, 4) := round(coalesce(p_input_weight, 0)::numeric, 4);
  v_lig_w       numeric(14, 4) := round(coalesce(p_ligature_weight, 0)::numeric, 4);
  v_fine_add_w  numeric(14, 4) := round(coalesce(p_fine_gold_added, 0)::numeric, 4);
  v_out_w       numeric(14, 4) := round(coalesce(p_output_weight, 0)::numeric, 4);
  v_silver_w    numeric(14, 4) := round(coalesce(p_silver_weight, 0)::numeric, 4);
  v_copper_w    numeric(14, 4) := round(coalesce(p_copper_weight, 0)::numeric, 4);
  v_pure_gold   numeric(18, 6);
  v_existing    jsonb;
  v_payload     jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi',
    'inventory_manager', 'manager', 'production_manager', 'production manager'
  ]);

  v_payload := jsonb_build_object(
    'source_item_id', btrim(coalesce(p_source_item_id, '')),
    'target_item_id', btrim(coalesce(p_target_item_id, '')),
    'input_weight', v_in_w,
    'source_proba', p_source_proba,
    'target_proba', p_target_proba,
    'output_weight', v_out_w
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_execute_alloy_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(btrim(p_source_item_id), '') = '' or coalesce(btrim(p_target_item_id), '') = '' then
    raise exception 'Source and target inventory item IDs are required';
  end if;

  if v_in_w <= 0 or p_source_proba <= 0 or p_target_proba <= 0 or p_source_proba = p_target_proba then
    raise exception 'Invalid alloy parameters';
  end if;

  if btrim(p_source_item_id) = btrim(p_target_item_id) then
    raise exception 'Source and target inventory items must be distinct';
  end if;

  select * into v_src from public.inventory_items where id::text = btrim(p_source_item_id) for update;
  if not found then
    raise exception 'Source gold item not found';
  end if;

  if v_src.organization_id is not null and v_src.organization_id <> v_caller_org then
    raise exception 'Cross-tenant violation: Source item does not belong to your organization' using errcode = '42501';
  end if;

  if (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)) < v_in_w then
    raise exception 'Insufficient available source gold: available=%g, required=%g',
      (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)), v_in_w;
  end if;

  select * into v_tar from public.inventory_items where id::text = btrim(p_target_item_id) for update;
  if not found then
    raise exception 'Target alloy gold item not found';
  end if;

  if v_tar.organization_id is not null and v_tar.organization_id <> v_caller_org then
    raise exception 'Cross-tenant violation: Target item does not belong to your organization' using errcode = '42501';
  end if;

  -- Up-alloying: consume additional 999 fine gold item
  if p_target_proba > p_source_proba and v_fine_add_w > 0 and p_fine_gold_item_id is not null then
    select * into v_fine_item from public.inventory_items where id::text = btrim(p_fine_gold_item_id) for update;
    if found and (v_fine_item.organization_id is null or v_fine_item.organization_id = v_caller_org) then
      if (coalesce(v_fine_item.on_hand, 0) - coalesce(v_fine_item.reserved, 0)) < v_fine_add_w then
        raise exception 'Insufficient 999 fine gold for up-alloying';
      end if;
      update public.inventory_items
         set on_hand = on_hand - v_fine_add_w,
             quantity_on_hand = quantity_on_hand - v_fine_add_w
       where id = v_fine_item.id;
    end if;
  end if;

  -- Deduct source gold
  update public.inventory_items
     set on_hand = on_hand - v_in_w,
         quantity_on_hand = quantity_on_hand - v_in_w
   where id = v_src.id;

  -- Add to target alloy stock
  update public.inventory_items
     set on_hand = coalesce(on_hand, 0) + v_out_w,
         quantity_on_hand = coalesce(quantity_on_hand, 0) + v_out_w
   where id = v_tar.id;

  v_pure_gold := public.calc_fine_gold_exact(v_out_w, p_target_proba);

  insert into public.gold_transactions (
    organization_id, transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, description, idempotency_key, performed_by
  ) values (
    v_caller_org,
    'alloy',
    v_src.name,
    v_tar.name,
    format('Alloy %s -> %s', p_source_proba, p_target_proba),
    v_out_w,
    v_out_w,
    p_target_proba,
    v_pure_gold,
    format('Alloy: in=%sg (%s), out=%sg (%s)', v_in_w, p_source_proba, v_out_w, p_target_proba),
    nullif(btrim(p_idempotency_key), ''),
    public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'source_item_id', v_src.id::text,
    'target_item_id', v_tar.id::text,
    'input_weight', v_in_w,
    'output_weight', v_out_w,
    'pure_gold', v_pure_gold,
    'target_proba', p_target_proba
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_execute_alloy_transaction', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 4.3 rpc_execute_affinaj_transaction multi-tenant hardening
create or replace function public.rpc_execute_affinaj_transaction(
  p_scrap_item_id       text,
  p_target_gold_item_id text,
  p_scrap_weight        numeric,
  p_estimated_proba     numeric,
  p_output_weight       numeric,
  p_output_proba        numeric default 999,
  p_expected_fine       numeric default 0,
  p_actual_fine         numeric default 0,
  p_refining_loss       numeric default 0,
  p_master_name         text default '',
  p_idempotency_key     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org  uuid := public.current_organization_id();
  v_scrap     public.inventory_items%rowtype;
  v_target    public.inventory_items%rowtype;
  v_sc_w      numeric(14, 4) := round(coalesce(p_scrap_weight, 0)::numeric, 4);
  v_out_w     numeric(14, 4) := round(coalesce(p_output_weight, 0)::numeric, 4);
  v_exp_fine  numeric(18, 6);
  v_act_fine  numeric(18, 6);
  v_loss_fine numeric(18, 6);
  v_existing  jsonb;
  v_payload   jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi',
    'inventory_manager', 'manager', 'production_manager', 'production manager'
  ]);

  v_payload := jsonb_build_object(
    'scrap_item_id', btrim(coalesce(p_scrap_item_id, '')),
    'target_gold_item_id', btrim(coalesce(p_target_gold_item_id, '')),
    'scrap_weight', v_sc_w,
    'output_weight', v_out_w,
    'estimated_proba', p_estimated_proba
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_execute_affinaj_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(btrim(p_scrap_item_id), '') = '' or coalesce(btrim(p_target_gold_item_id), '') = '' then
    raise exception 'Scrap and target gold inventory item IDs are required';
  end if;

  if v_sc_w <= 0 or v_out_w <= 0 or p_estimated_proba <= 0 then
    raise exception 'Invalid refining parameters: scrap=%g, output=%g, proba=%g', v_sc_w, v_out_w, p_estimated_proba;
  end if;

  select * into v_scrap from public.inventory_items where id::text = btrim(p_scrap_item_id) for update;
  if not found then
    raise exception 'Scrap inventory item not found';
  end if;

  if v_scrap.organization_id is not null and v_scrap.organization_id <> v_caller_org then
    raise exception 'Cross-tenant violation: Scrap item does not belong to your organization' using errcode = '42501';
  end if;

  if (coalesce(v_scrap.on_hand, v_scrap.quantity_on_hand, 0) - coalesce(v_scrap.reserved, 0)) < v_sc_w then
    raise exception 'Insufficient scrap available: available=%g, required=%g',
      (coalesce(v_scrap.on_hand, v_scrap.quantity_on_hand, 0) - coalesce(v_scrap.reserved, 0)), v_sc_w;
  end if;

  select * into v_target from public.inventory_items where id::text = btrim(p_target_gold_item_id) for update;
  if not found then
    raise exception 'Target 999 gold inventory item not found';
  end if;

  if v_target.organization_id is not null and v_target.organization_id <> v_caller_org then
    raise exception 'Cross-tenant violation: Target item does not belong to your organization' using errcode = '42501';
  end if;

  v_exp_fine  := public.calc_fine_gold_exact(v_sc_w, p_estimated_proba);
  v_act_fine  := public.calc_fine_gold_exact(v_out_w, coalesce(nullif(p_output_proba, 0), 999));
  v_loss_fine := round(greatest(0, v_exp_fine - v_act_fine)::numeric, 6);

  -- Deduct scrap inventory
  update public.inventory_items
     set on_hand = on_hand - v_sc_w,
         quantity_on_hand = quantity_on_hand - v_sc_w
   where id = v_scrap.id;

  -- Add refined 999 gold to inventory
  update public.inventory_items
     set on_hand = coalesce(on_hand, 0) + v_out_w,
         quantity_on_hand = coalesce(quantity_on_hand, 0) + v_out_w
   where id = v_target.id;

  insert into public.affinaj_records (
    organization_id, scrap_batch_no, scrap_weight, estimated_purity,
    output_weight, actual_purity, expected_pure_gold, actual_pure_gold,
    loss_weight, refiner_name, notes, status, idempotency_key
  ) values (
    v_caller_org,
    v_scrap.name,
    v_sc_w,
    p_estimated_proba,
    v_out_w,
    coalesce(nullif(p_output_proba, 0), 999),
    v_exp_fine,
    v_act_fine,
    v_loss_fine,
    coalesce(nullif(btrim(p_master_name), ''), public.current_employee_name()),
    format('Affinaj %sg (%s) -> %sg (999)', v_sc_w, p_estimated_proba, v_out_w),
    'COMPLETED',
    nullif(btrim(p_idempotency_key), '')
  );

  insert into public.gold_transactions (
    organization_id, transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, description, idempotency_key, performed_by
  ) values (
    v_caller_org,
    'affinaj',
    v_scrap.name,
    v_target.name,
    'Fine Gold 999',
    v_out_w,
    v_out_w,
    coalesce(nullif(p_output_proba, 0), 999),
    v_act_fine,
    format('Refining output: %sg fine gold from %sg scrap', v_out_w, v_sc_w),
    nullif(btrim(p_idempotency_key), ''),
    public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'scrap_item_id', v_scrap.id::text,
    'target_gold_item_id', v_target.id::text,
    'scrap_weight', v_sc_w,
    'output_weight', v_out_w,
    'expected_fine', v_exp_fine,
    'actual_fine', v_act_fine,
    'refining_loss', v_loss_fine
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_execute_affinaj_transaction', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 4.4 rpc_create_product_with_bom multi-tenant hardening
create or replace function public.rpc_create_product_with_bom(
  p_name            text,
  p_category        text default 'Komplekt',
  p_proba           numeric default 585,
  p_bom_version     integer default 1,
  p_ring_weight     numeric default 0,
  p_earring_weight  numeric default 0,
  p_chain_weight    numeric default 0,
  p_dorika_weight   numeric default 0,
  p_stone_weight    numeric default 0,
  p_weight          numeric default null,
  p_bom_details     text default null,
  p_image_url       text default null,
  p_bom_items       jsonb default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_ring_w     numeric(14, 4) := round(greatest(0, coalesce(p_ring_weight, 0))::numeric, 4);
  v_ear_w      numeric(14, 4) := round(greatest(0, coalesce(p_earring_weight, 0))::numeric, 4);
  v_chain_w    numeric(14, 4) := round(greatest(0, coalesce(p_chain_weight, 0))::numeric, 4);
  v_dorika_w   numeric(14, 4) := round(greatest(0, coalesce(p_dorika_weight, 0))::numeric, 4);
  v_stone_w    numeric(14, 4) := round(greatest(0, coalesce(p_stone_weight, 0))::numeric, 4);
  v_tot_w      numeric(14, 4);
  v_summary    text;
  v_prod_id    text;
  v_prod_uuid  uuid;
  v_bom_elem   jsonb;
  v_existing   jsonb;
  v_payload    jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi',
    'inventory_manager', 'manager', 'production_manager', 'production manager'
  ]);

  v_tot_w := round(
    coalesce(nullif(p_weight, 0), v_ring_w + v_ear_w + v_chain_w + v_dorika_w + v_stone_w)::numeric,
    4
  );

  v_payload := jsonb_build_object(
    'name', lower(btrim(coalesce(p_name, ''))),
    'category', btrim(coalesce(p_category, 'Komplekt')),
    'proba', coalesce(p_proba, 585),
    'total_weight', v_tot_w
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_create_product_with_bom', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(btrim(p_name), '') = '' or v_tot_w <= 0 or v_stone_w >= v_tot_w then
    raise exception 'Invalid product model or BOM weights (total=%g, stone=%g)', v_tot_w, v_stone_w;
  end if;

  v_summary := coalesce(
    nullif(btrim(p_bom_details), ''),
    format('v%s: Uzuk(%sg) + Zirak(%sg) + Zanjir(%sg) + Dorika(%sg) + Tosh(%sg)',
      coalesce(p_bom_version, 1), v_ring_w, v_ear_w, v_chain_w, v_dorika_w, v_stone_w)
  );

  insert into public.products (
    organization_id, name, title, category, weight, proba, stock, quantity,
    stone_weight, bom_version, bom_details, image_url
  ) values (
    v_caller_org, btrim(p_name), btrim(p_name), coalesce(nullif(btrim(p_category), ''), 'Komplekt'),
    v_tot_w, coalesce(p_proba, 585), 0, 0,
    v_stone_w, coalesce(p_bom_version, 1), v_summary,
    coalesce(p_image_url, 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80')
  ) returning id::text into v_prod_id;

  v_prod_uuid := public.try_cast_uuid(v_prod_id);

  if p_bom_items is not null and jsonb_typeof(p_bom_items) = 'array' and jsonb_array_length(p_bom_items) > 0 then
    for v_bom_elem in select * from jsonb_array_elements(p_bom_items)
    loop
      insert into public.bom_items (
        product_id, component_name, component_type, quantity, unit_weight, total_weight, proba, notes
      ) values (
        v_prod_uuid,
        coalesce(v_bom_elem->>'component_name', 'Qism'),
        coalesce(v_bom_elem->>'component_type', 'gold'),
        coalesce((v_bom_elem->>'quantity')::integer, 1),
        coalesce((v_bom_elem->>'unit_weight')::numeric, 0),
        coalesce((v_bom_elem->>'total_weight')::numeric, 0),
        coalesce((v_bom_elem->>'proba')::numeric, coalesce(p_proba, 585)),
        v_bom_elem->>'notes'
      );
    end loop;
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'product_id', v_prod_id,
    'name', btrim(p_name),
    'category', coalesce(p_category, 'Komplekt'),
    'total_weight', v_tot_w,
    'proba', coalesce(p_proba, 585),
    'bom_version', coalesce(p_bom_version, 1),
    'summary', v_summary,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_create_product_with_bom', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 4.5 rpc_create_order_with_advance multi-tenant hardening
create or replace function public.rpc_create_order_with_advance(
  p_order_no        text,
  p_client_name     text,
  p_phone           text default '',
  p_product_model   text default '',
  p_details         text default '',
  p_proba           numeric default 585,
  p_qty             integer default 1,
  p_weight_gram     numeric default 0,
  p_total_price     numeric default 0,
  p_advance         numeric default 0,
  p_deadline        date default null,
  p_priority        text default 'Normal',
  p_payment_type    text default 'Avans (Naqd)',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org   uuid := public.current_organization_id();
  v_order_no     text := btrim(coalesce(p_order_no, ''));
  v_client       text := btrim(coalesce(p_client_name, ''));
  v_model        text := btrim(coalesce(p_product_model, ''));
  v_qty          integer := coalesce(p_qty, 0);
  v_weight       numeric(14, 4) := round(coalesce(p_weight_gram, 0)::numeric, 4);
  v_total        numeric(18, 2) := round(coalesce(p_total_price, 0)::numeric, 2);
  v_adv          numeric(18, 2) := round(coalesce(p_advance, 0)::numeric, 2);
  v_debt         numeric(18, 2);
  v_order_id     text;
  v_sale_id      text := null;
  v_existing     jsonb;
  v_payload      jsonb;
  v_priority_val public.order_priority;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'sales', 'accountant', 'buxgalter', 'hisobchi'
  ]);

  v_payload := jsonb_build_object(
    'order_no', v_order_no,
    'client_name', lower(v_client),
    'product_model', lower(v_model),
    'qty', v_qty,
    'weight_gram', v_weight,
    'total_price', v_total,
    'advance', v_adv
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_create_order_with_advance', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_order_no = '' or v_client = '' or v_model = '' then
    raise exception 'Order number, client name, and product model are required';
  end if;

  if v_qty <= 0 or v_weight <= 0 then
    raise exception 'Order quantity (%) and weight (%g) must be greater than 0', v_qty, v_weight;
  end if;

  if v_total < 0 or v_adv < 0 then
    raise exception 'Order total price (%s) and advance (%s) cannot be negative', v_total, v_adv;
  end if;

  if v_adv > v_total then
    raise exception 'Order advance (%s) cannot exceed total price (%s)', v_adv, v_total;
  end if;

  v_debt := round(v_total - v_adv, 2);

  -- Safe enum conversion
  case lower(btrim(coalesce(p_priority, 'normal')))
    when 'low' then v_priority_val := 'low'::public.order_priority;
    when 'high' then v_priority_val := 'high'::public.order_priority;
    when 'urgent' then v_priority_val := 'urgent'::public.order_priority;
    else v_priority_val := 'normal'::public.order_priority;
  end case;

  insert into public.orders (
    organization_id, order_no, order_number, client_name, customer_name, phone,
    product_model, details, proba, qty, weight_gram,
    total_price, advance, paid_amount, debt_amount,
    deadline, priority, priority_label, status, status_label, batch_created
  ) values (
    v_caller_org, v_order_no, v_order_no, v_client, v_client, btrim(coalesce(p_phone, '')),
    v_model, btrim(coalesce(p_details, '')), coalesce(p_proba, 585), v_qty, v_weight,
    v_total, v_adv, v_adv, v_debt,
    p_deadline, v_priority_val, coalesce(nullif(btrim(p_priority), ''), 'Normal'),
    'Kutilmoqda', 'Kutilmoqda', false
  ) returning id::text into v_order_id;

  if v_adv > 0 then
    insert into public.sales (
      organization_id, order_id, client_name, product_name, quantity, weight, proba,
      payment_type, sale_total_amount, total_amount, debt_amount, tx_type, idempotency_key
    ) values (
      v_caller_org,
      v_order_id,
      v_client,
      format('Buyurtma Avansi (%s - %s)', v_order_no, v_model),
      v_qty,
      v_weight,
      coalesce(p_proba, 585),
      coalesce(nullif(btrim(p_payment_type), ''), 'Avans (Naqd)'),
      v_total,
      v_adv,
      v_debt,
      'kirim',
      nullif(btrim(p_idempotency_key), '')
    ) returning id::text into v_sale_id;
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'order_id', v_order_id,
    'order_no', v_order_no,
    'advance_sale_id', v_sale_id,
    'total_price', v_total,
    'advance', v_adv,
    'debt_amount', v_debt,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_create_order_with_advance', v_existing, v_payload);

  return v_existing;
end;
$$;

-- Grant permissions on new and updated functions
grant execute on function public.rpc_complete_qc_rework(text, text, text, integer, integer, integer, text, text, text) to authenticated;
grant execute on function public.rpc_record_qc_inspection(text, text, text, integer, integer, integer, integer, text, integer, text, text, text) to authenticated;
grant execute on function public.rpc_calculate_piecework_salary(text, text, text, text, text, integer, numeric, integer, numeric, text) to authenticated;
grant execute on function public.rpc_adjust_piecework_salary(text, numeric, text, text, text) to authenticated;
grant execute on function public.rpc_inventory_transaction(text, text, numeric, numeric, numeric, text, text, text, text, text, text) to authenticated;
grant execute on function public.rpc_execute_alloy_transaction(text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, numeric, text, numeric, text) to authenticated;
grant execute on function public.rpc_execute_affinaj_transaction(text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_create_product_with_bom(text, text, numeric, integer, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb, text) to authenticated;
grant execute on function public.rpc_create_order_with_advance(text, text, text, text, text, numeric, integer, numeric, numeric, numeric, date, text, text, text) to authenticated;
