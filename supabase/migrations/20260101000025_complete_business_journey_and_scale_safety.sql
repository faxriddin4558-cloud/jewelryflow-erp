-- ==============================================================================
-- JewelryFlow ERP Migration 025: Complete Business Journey & Scale Safety
-- 1. Hardware measurement mode & scale audit columns in two_party_handovers
-- 2. Enhanced rpc_dispatch_stage_handover with duplicate dispatch protection & scale audit
-- 3. Enhanced rpc_accept_stage_handover with scale audit
-- 4. Auto-creation of finished goods in public.products upon batch completion (rpc_move_partial_wip)
-- 5. Atomic QC Re-inspection RPC (rpc_reinspect_qc)
-- 6. Strict positive inventory weight enforcement in rpc_inventory_transaction
-- ==============================================================================

-- 1. Schema Extensions
alter table public.two_party_handovers
  add column if not exists measurement_mode text not null default 'MANUAL_ENTRY',
  add column if not exists is_scale_stable boolean default true,
  add column if not exists scale_model text,
  add column if not exists scale_raw_reading text,
  add column if not exists received_measurement_mode text not null default 'MANUAL_ENTRY',
  add column if not exists received_scale_stable boolean default true,
  add column if not exists received_scale_model text;

alter table public.quality_control
  add column if not exists notes text,
  add column if not exists updated_at timestamptz default now();

-- 2. Drop old overloads so parameter resolution is unique
drop function if exists public.rpc_dispatch_stage_handover(text, text, integer, text, text, integer, text, text, text, text, integer, numeric, text, text, numeric, text);
drop function if exists public.rpc_accept_stage_handover(text, text, text, integer, numeric, text, text);

-- 3. Enhanced rpc_dispatch_stage_handover with duplicate prevention and scale metadata
create or replace function public.rpc_dispatch_stage_handover(
  p_batch_id               text,
  p_batch_no               text,
  p_from_stage_order       integer,
  p_from_stage_name        text,
  p_from_department        text,
  p_to_stage_order         integer,
  p_to_stage_name          text,
  p_to_department          text,
  p_sender_worker_id       text,
  p_sender_worker_name     text,
  p_dispatched_qty         integer,
  p_dispatched_weight_gram numeric,
  p_receiver_worker_id     text default null,
  p_receiver_worker_name   text default null,
  p_tolerance_gram         numeric default 0.05,
  p_idempotency_key        text default null,
  p_measurement_mode       text default 'MANUAL_ENTRY',
  p_is_scale_stable        boolean default true,
  p_scale_model            text default null,
  p_scale_raw_reading      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_batch         public.batches%rowtype;
  v_handover_id   text;
  v_tol           numeric(6, 4) := round(coalesce(p_tolerance_gram, 0.05)::numeric, 4);
  v_weight        numeric(14, 4) := round(coalesce(p_dispatched_weight_gram, 0)::numeric, 4);
  v_existing      jsonb;
  v_payload       jsonb;
  v_open_ho       public.two_party_handovers%rowtype;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  if coalesce(p_dispatched_qty, 0) <= 0 then
    raise exception 'Dispatched quantity must be greater than 0';
  end if;
  if v_weight <= 0 then
    raise exception 'Dispatched weight must be greater than 0';
  end if;
  if p_from_stage_order = p_to_stage_order then
    raise exception 'Cannot dispatch handover to the same stage';
  end if;

  -- Verify batch ownership
  select * into v_batch
    from public.batches
   where (id::text = btrim(p_batch_id) or batch_no = btrim(p_batch_no))
   limit 1;

  if found and v_batch.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Batch does not belong to your organization' using errcode = '42501';
  end if;

  -- Duplicate Handover Prevention: Check if an open pending handover already exists for this stage transition
  select * into v_open_ho
    from public.two_party_handovers
   where organization_id = v_caller_org
     and batch_no = btrim(p_batch_no)
     and from_stage_order = p_from_stage_order
     and to_stage_order = p_to_stage_order
     and status = 'PENDING_ACCEPTANCE'
   limit 1;

  if v_open_ho.id is not null then
    raise exception 'Ushbu bosqich bo''yicha qabul qilinishi kutilayotgan handover (%s) allaqachon mavjud! Avval uni qabul qiling yoki bekor qiling.', v_open_ho.id;
  end if;

  v_payload := jsonb_build_object(
    'batch_id', p_batch_id,
    'batch_no', p_batch_no,
    'from_stage_order', p_from_stage_order,
    'to_stage_order', p_to_stage_order,
    'dispatched_qty', p_dispatched_qty,
    'dispatched_weight_gram', v_weight
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_dispatch_stage_handover', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  v_handover_id := 'HO-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 6);

  insert into public.two_party_handovers (
    id, organization_id, batch_id, batch_no,
    from_stage_order, from_stage_name, from_department,
    to_stage_order, to_stage_name, to_department,
    sender_worker_id, sender_worker_name,
    receiver_worker_id, receiver_worker_name,
    dispatched_qty, dispatched_weight_gram,
    status, tolerance_gram, dispatched_at,
    measurement_mode, is_scale_stable, scale_model, scale_raw_reading
  ) values (
    v_handover_id, v_caller_org, btrim(p_batch_id), btrim(p_batch_no),
    p_from_stage_order, btrim(p_from_stage_name), btrim(p_from_department),
    p_to_stage_order, btrim(p_to_stage_name), btrim(p_to_department),
    btrim(p_sender_worker_id), btrim(p_sender_worker_name),
    nullif(btrim(p_receiver_worker_id), ''), nullif(btrim(p_receiver_worker_name), ''),
    p_dispatched_qty, v_weight,
    'PENDING_ACCEPTANCE', v_tol, clock_timestamp(),
    coalesce(nullif(btrim(p_measurement_mode), ''), 'MANUAL_ENTRY'),
    coalesce(p_is_scale_stable, true),
    nullif(btrim(p_scale_model), ''),
    nullif(btrim(p_scale_raw_reading), '')
  );

  v_existing := jsonb_build_object(
    'success', true,
    'status', 'PENDING_ACCEPTANCE',
    'handover_id', v_handover_id,
    'batch_no', btrim(p_batch_no),
    'dispatched_qty', p_dispatched_qty,
    'dispatched_weight_gram', v_weight,
    'measurement_mode', coalesce(nullif(btrim(p_measurement_mode), ''), 'MANUAL_ENTRY')
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_dispatch_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;

revoke execute on function public.rpc_dispatch_stage_handover(text, text, integer, text, text, integer, text, text, text, text, integer, numeric, text, text, numeric, text, text, boolean, text, text) from public, anon;
grant execute on function public.rpc_dispatch_stage_handover(text, text, integer, text, text, integer, text, text, text, text, integer, numeric, text, text, numeric, text, text, boolean, text, text) to authenticated;

-- 4. Enhanced rpc_accept_stage_handover with measurement mode and scale tracking
create or replace function public.rpc_accept_stage_handover(
  p_handover_id                text,
  p_receiver_worker_id         text,
  p_receiver_worker_name       text,
  p_received_qty               integer,
  p_received_weight_gram       numeric,
  p_supervisor_override_reason text default null,
  p_idempotency_key            text default null,
  p_measurement_mode           text default 'MANUAL_ENTRY',
  p_is_scale_stable            boolean default true,
  p_scale_model                text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_h             public.two_party_handovers%rowtype;
  v_rec_weight    numeric(14, 4) := round(coalesce(p_received_weight_gram, 0)::numeric, 4);
  v_discrepancy   numeric(14, 4);
  v_qty_mismatch  boolean;
  v_weight_excess boolean;
  v_new_status    text := 'ACCEPTED';
  v_flag_reason   text := null;
  v_caller_role   text := public.current_employee_role_text();
  v_existing      jsonb;
  v_payload       jsonb;
  v_salary_res    jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  v_payload := jsonb_build_object(
    'handover_id', btrim(coalesce(p_handover_id, '')),
    'receiver_worker_id', btrim(coalesce(p_receiver_worker_id, '')),
    'received_qty', p_received_qty,
    'received_weight_gram', v_rec_weight
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_accept_stage_handover', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_h
    from public.two_party_handovers
   where id = btrim(p_handover_id)
     for update;

  if not found then
    raise exception 'Handover record not found: %', p_handover_id;
  end if;

  -- Cross-tenant isolation verification
  if v_h.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Handover does not belong to your organization' using errcode = '42501';
  end if;

  if v_h.status not in ('PENDING_ACCEPTANCE', 'DISCREPANCY_FLAGGED') then
    raise exception 'Handover % is already finalized in status %', p_handover_id, v_h.status;
  end if;

  if coalesce(p_received_qty, 0) <= 0 or v_rec_weight <= 0 then
    raise exception 'Received quantity and weight must be positive';
  end if;

  v_discrepancy := round(abs(v_h.dispatched_weight_gram - v_rec_weight), 4);
  v_qty_mismatch := (v_h.dispatched_qty <> p_received_qty);
  v_weight_excess := (v_discrepancy > coalesce(v_h.tolerance_gram, 0.05));

  if v_qty_mismatch or v_weight_excess then
    if p_supervisor_override_reason is not null and length(btrim(p_supervisor_override_reason)) >= 5 then
      if v_caller_role not in ('admin', 'director', 'owner', 'manager', 'production_manager', 'supervisor', 'master') then
        raise exception 'Only supervisor or manager can override handover discrepancies';
      end if;
      v_new_status := 'ACCEPTED_WITH_OVERRIDE';
      v_flag_reason := 'Supervayzer tasdiqladi: ' || btrim(p_supervisor_override_reason);
    else
      v_new_status := 'DISCREPANCY_FLAGGED';
      v_flag_reason := case
        when v_qty_mismatch and v_weight_excess then 'Soni va og''irligi mos kelmadi (farq: ' || v_discrepancy || 'g)'
        when v_qty_mismatch then 'Soni mos kelmadi (' || v_h.dispatched_qty || ' vs ' || p_received_qty || ')'
        else 'Og''irlik nomuvofiqligi me''yordan ortiq (' || v_discrepancy || 'g > ' || coalesce(v_h.tolerance_gram, 0.05) || 'g)'
      end;
    end if;
  end if;

  update public.two_party_handovers
     set receiver_worker_id          = btrim(p_receiver_worker_id),
         receiver_worker_name        = btrim(p_receiver_worker_name),
         received_qty                = p_received_qty,
         received_weight_gram        = v_rec_weight,
         weight_discrepancy_gram     = v_discrepancy,
         status                      = v_new_status,
         flag_reason                 = v_flag_reason,
         supervisor_override_id      = case when v_new_status = 'ACCEPTED_WITH_OVERRIDE' then btrim(p_receiver_worker_id) else null end,
         supervisor_override_reason  = case when v_new_status = 'ACCEPTED_WITH_OVERRIDE' then btrim(p_supervisor_override_reason) else null end,
         resolved_at                 = case when v_new_status in ('ACCEPTED', 'ACCEPTED_WITH_OVERRIDE') then clock_timestamp() else null end,
         received_measurement_mode   = coalesce(nullif(btrim(p_measurement_mode), ''), 'MANUAL_ENTRY'),
         received_scale_stable       = coalesce(p_is_scale_stable, true),
         received_scale_model        = nullif(btrim(p_scale_model), '')
   where id = v_h.id;

  -- AUTOMATIC PIECEWORK SALARY CALCULATION:
  -- Only award piecework salary when work is confirmed (ACCEPTED, SUPERVISOR_OVERRIDDEN, ACCEPTED_WITH_OVERRIDE)
  if v_new_status in ('ACCEPTED', 'SUPERVISOR_OVERRIDDEN', 'ACCEPTED_WITH_OVERRIDE') then
    v_salary_res := public.rpc_calculate_piecework_salary(
      p_handover_id     := v_h.id::text,
      p_worker_id       := v_h.sender_worker_id,
      p_worker_name     := v_h.sender_worker_name,
      p_batch_no        := v_h.batch_no,
      p_stage_name      := v_h.from_stage_name,
      p_stage_order     := v_h.from_stage_order,
      p_weight_done     := v_rec_weight,
      p_qty_done        := p_received_qty,
      p_idempotency_key := 'earned-ho-' || v_h.id::text
    );
  end if;

  v_existing := jsonb_build_object(
    'success', (v_new_status in ('ACCEPTED', 'SUPERVISOR_OVERRIDDEN', 'ACCEPTED_WITH_OVERRIDE')),
    'handover_id', v_h.id,
    'status', v_new_status,
    'discrepancy_gram', v_discrepancy,
    'flag_reason', v_flag_reason,
    'measurement_mode', coalesce(nullif(btrim(p_measurement_mode), ''), 'MANUAL_ENTRY'),
    'piecework_earned', v_salary_res
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_accept_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;

revoke execute on function public.rpc_accept_stage_handover(text, text, text, integer, numeric, text, text, text, boolean, text) from public, anon;
grant execute on function public.rpc_accept_stage_handover(text, text, text, integer, numeric, text, text, text, boolean, text) to authenticated;

-- 5. Strict Positive Weight Check in rpc_inventory_transaction
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
  v_weight      numeric(14, 4);
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

  if p_weight is null or p_weight <= 0 then
    raise exception 'Inventory transaction weight must be greater than zero';
  end if;

  v_weight := round(p_weight::numeric, 4);

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

  select * into v_item
    from public.inventory_items
   where id::text = btrim(p_item_id)
     and organization_id = v_caller_org
     for update;

  if not found then
    raise exception 'Inventory item (%) not found in your organization', p_item_id using errcode = '42501';
  end if;

  v_on_hand  := coalesce(v_item.on_hand, v_item.quantity_on_hand, 0);
  v_reserved := coalesce(v_item.reserved, 0);
  v_avail    := v_on_hand - v_reserved;
  v_fine     := round(coalesce(p_pure_gold, public.calc_fine_gold_exact(v_weight, coalesce(nullif(p_proba, 0), v_item.proba, 0))), 6);

  if p_tx_type = 'kirim' then
    v_on_hand := v_on_hand + v_weight;
  elsif p_tx_type = 'chiqim' then
    if v_weight > v_avail then
      raise exception 'Insufficient available inventory: requested %g exceeds available %g (total on-hand %g, reserved %g)',
        v_weight, v_avail, v_on_hand, v_reserved;
    end if;
    v_on_hand := v_on_hand - v_weight;
  elsif p_tx_type = 'reserve' then
    if v_weight > v_avail then
      raise exception 'Cannot reserve %g: exceeds available on-hand %g', v_weight, v_avail;
    end if;
    v_reserved := v_reserved + v_weight;

    insert into public.inventory_reservations (
      inventory_item_id, order_id, order_no, reserved_grams, status, idempotency_key, created_by, organization_id
    ) values (
      v_item.id, p_order_id, p_order_no, v_weight, 'ACTIVE', nullif(btrim(p_idempotency_key), ''), auth.uid(), v_caller_org
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
         and organization_id = v_caller_org
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
         reserved = v_reserved,
         updated_at = now()
   where id = v_item.id;

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, description, idempotency_key, performed_by, organization_id
  ) values (
    p_tx_type, p_from_location, p_to_location, v_item.name,
    v_weight, v_weight, coalesce(nullif(p_proba, 0), v_item.proba, 0), v_fine,
    p_description, nullif(btrim(p_idempotency_key), ''), public.current_employee_id(), v_caller_org
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'item_id', v_item.id::text,
    'on_hand', v_on_hand,
    'reserved', v_reserved,
    'available', v_on_hand - v_reserved,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_inventory_transaction', v_existing, v_payload);

  return v_existing;
end;
$$;

revoke execute on function public.rpc_inventory_transaction(text, text, numeric, numeric, numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.rpc_inventory_transaction(text, text, numeric, numeric, numeric, text, text, text, text, text, text) to authenticated;

-- 6. Enhanced rpc_move_partial_wip with auto-creation of finished goods in public.products
create or replace function public.rpc_move_partial_wip(
  p_batch_id           text,
  p_from_stage_order   integer,
  p_to_stage_order     integer,
  p_to_stage_name      text,
  p_to_department      text,
  p_move_qty           integer,
  p_move_gram          numeric default null,
  p_move_weight        numeric default null,
  p_rework_qty         integer default 0,
  p_sprue_gram         numeric default 0,
  p_scrap_gram         numeric default 0,
  p_loss_gram          numeric default 0,
  p_worker_name        text default '',
  p_worker_id          text default null,
  p_idempotency_key    text default null,
  p_allow_excess_loss  boolean default false,
  p_excess_loss_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_batch             public.batches%rowtype;
  v_cur_wip           public.batch_stage_wip%rowtype;
  v_nxt_wip           public.batch_stage_wip%rowtype;
  v_prod              public.products%rowtype;
  v_batch_code        text;
  v_rem_qty           integer;
  v_move_g            numeric(14, 4) := round(coalesce(p_move_weight, p_move_gram, 0)::numeric, 4);
  v_sprue_g           numeric(14, 4) := round(coalesce(p_sprue_gram, 0)::numeric, 4);
  v_scrap_g           numeric(14, 4) := round(coalesce(p_scrap_gram, 0)::numeric, 4);
  v_loss_g            numeric(14, 4) := round(coalesce(p_loss_gram, 0)::numeric, 4);
  v_new_sprue         numeric(14, 4);
  v_new_scrap         numeric(14, 4);
  v_new_loss          numeric(14, 4);
  v_new_good          numeric(14, 4);
  v_in_gold           numeric(14, 4);
  v_tot_out           numeric(14, 4);
  v_new_wip_g         numeric(14, 4);
  v_actual_target_st  integer := p_to_stage_order;
  v_actual_target_nm  text    := btrim(p_to_stage_name);
  v_actual_target_dp  text    := btrim(p_to_department);
  v_is_final          boolean;
  v_new_fin_qty       integer;
  v_credit_qty        integer := 0;
  v_done_all          boolean;
  v_existing          jsonb;
  v_payload           jsonb;

  -- Stage Loss Threshold Variables
  v_proc_weight       numeric(14, 4);
  v_max_loss_pct      numeric(6, 3);
  v_max_loss_gram     numeric(14, 4);
  v_loss_pct          numeric(6, 3);
  v_limit_by_pct      numeric(14, 4);
  v_effective_limit   numeric(14, 4);
  v_excess_loss_g     numeric(14, 4);
  v_avail_stage_g     numeric(14, 4);
  v_rem_stage_g       numeric(14, 4);
  v_caller_role       text := public.current_employee_role_text();
  v_org_code          text;

  -- batch_operations sync variables
  v_stage_uuid        uuid;
  v_dept_uuid         uuid;
  v_open_op_id        uuid;
  v_existing_op_id    uuid;
  v_next_attempt      integer;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  -- Resolve organization code for factory bypass verification
  select code into v_org_code from public.organizations where id = v_caller_org;

  -- GOLDIA FACTORY BYPASS RULES ENFORCEMENT:
  -- Ponza (Stage 9) and Zircon (Stage 13) are strictly bypassed in Goldia
  if v_org_code = 'goldia' or v_caller_org = '00000000-0000-0000-0000-000000000001'::uuid then
    if v_actual_target_st = 9 then
      v_actual_target_st := 10;
      v_actual_target_nm := '10. Yig''uv';
      v_actual_target_dp := 'Yig''uv';
    elsif v_actual_target_st = 13 then
      v_actual_target_st := 14;
      v_actual_target_nm := '14. Zakrepka';
      v_actual_target_dp := 'Zakrepka';
    end if;
  end if;

  v_is_final := (v_actual_target_st >= 25);

  v_payload := jsonb_build_object(
    'batch_id', btrim(coalesce(p_batch_id, '')),
    'from_stage_order', p_from_stage_order,
    'to_stage_order', v_actual_target_st,
    'move_qty', p_move_qty,
    'move_g', v_move_g,
    'rework_qty', p_rework_qty,
    'loss_gram', v_loss_g
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_move_partial_wip', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if p_move_qty < 0 or p_rework_qty < 0 or v_move_g < 0 or v_sprue_g < 0 or v_scrap_g < 0 or v_loss_g < 0 then
    raise exception 'Negative quantities or weights are not permitted';
  end if;
  if p_move_qty <= 0 and p_rework_qty <= 0 then
    raise exception 'Either moved quantity or rework quantity must be greater than 0';
  end if;

  select * into v_batch from public.batches where id::text = btrim(p_batch_id) for update;
  if not found then
    raise exception 'Batch (%) not found', p_batch_id;
  end if;

  -- Cross-tenant isolation verification
  if v_batch.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Batch does not belong to your organization' using errcode = '42501';
  end if;

  v_batch_code := coalesce(v_batch.batch_no, v_batch.batch_number, v_batch.number, p_batch_id);

  select * into v_cur_wip
    from public.batch_stage_wip
   where (batch_id = btrim(p_batch_id) or batch_no = v_batch_code)
     and stage_order = p_from_stage_order
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'WIP stage record (%) not found for batch %', p_from_stage_order, v_batch_code;
  end if;

  if (p_move_qty + p_rework_qty) > v_cur_wip.available_qty then
    raise exception 'Insufficient WIP in stage %: available=%, requested=%',
      p_from_stage_order, v_cur_wip.available_qty, (p_move_qty + p_rework_qty);
  end if;

  -- --------------------------------------------------------------------------
  -- SERVER-SIDE LOSS VALIDATION
  -- --------------------------------------------------------------------------
  if v_loss_g > 0 then
    v_proc_weight := (v_move_g + v_loss_g + v_sprue_g + v_scrap_g);

    select max_loss_pct, max_loss_gram
      into v_max_loss_pct, v_max_loss_gram
      from public.stage_loss_configs
     where stage_order = p_from_stage_order
       and (organization_id = v_caller_org or organization_id is null)
     order by case when organization_id = v_caller_org then 0 else 1 end
     limit 1;

    if not found then
      if p_from_stage_order in (16, 17, 18) then
        v_max_loss_pct  := 2.500;
        v_max_loss_gram := 1.5000;
      else
        v_max_loss_pct  := 1.000;
        v_max_loss_gram := 0.5000;
      end if;
    end if;

    if v_proc_weight > 0 then
      v_loss_pct := round((v_loss_g / v_proc_weight * 100)::numeric, 3);
      v_limit_by_pct := round((v_proc_weight * v_max_loss_pct / 100)::numeric, 4);
    else
      v_loss_pct := 0;
      v_limit_by_pct := v_max_loss_gram;
    end if;

    v_effective_limit := least(v_max_loss_gram, greatest(0.0100, v_limit_by_pct));

    if v_loss_g > v_effective_limit and (v_proc_weight = 0 or v_loss_pct > v_max_loss_pct) then
      v_excess_loss_g := round((v_loss_g - v_effective_limit)::numeric, 4);

      if not coalesce(p_allow_excess_loss, false) then
        raise exception 'EXCESSIVE_LOSS_DETECTED: Stage % loss (%g, %s%%) exceeds allowable threshold (%g, %s%%). Manager override required.',
          p_from_stage_order, v_loss_g, v_loss_pct, v_effective_limit, v_max_loss_pct
          using errcode = 'P0001';
      end if;

      if v_caller_role not in (
        'admin', 'director', 'owner', 'direktor', 'rahbar',
        'manager', 'production_manager', 'production manager',
        'bosh usta', 'supervisor', 'master'
      ) then
        raise exception 'Permission denied: Operator role "%" cannot authorize excessive stage loss override (+%sg)',
          v_caller_role, v_excess_loss_g using errcode = '42501';
      end if;

      insert into public.audit_logs (
        table_name, record_id, action, actor_id, actor_name, actor_role,
        reason, new_data, organization_id
      ) values (
        'batches',
        v_batch.id::text,
        'EXCESSIVE_LOSS_ALERT',
        auth.uid(),
        public.current_employee_name(),
        v_caller_role,
        coalesce(nullif(btrim(p_excess_loss_reason), ''), 'Stage loss exceeded standard threshold; manager override confirmed'),
        jsonb_build_object(
          'batch_no', v_batch_code,
          'stage_order', p_from_stage_order,
          'processed_weight_gram', v_proc_weight,
          'loss_gram', v_loss_g,
          'loss_pct', v_loss_pct,
          'effective_limit_gram', v_effective_limit,
          'excess_loss_gram', v_excess_loss_g,
          'worker_name', btrim(p_worker_name)
        ),
        v_caller_org
      );
    end if;
  end if;

  -- --------------------------------------------------------------------------
  -- MASS BALANCE & OUTPUT UPDATES
  -- --------------------------------------------------------------------------
  v_rem_qty   := v_cur_wip.available_qty - p_move_qty - p_rework_qty;
  v_new_sprue := round((coalesce(v_batch.sprue_gram, 0) + v_sprue_g)::numeric, 4);
  v_new_scrap := round((coalesce(v_batch.scrap_gram, 0) + v_scrap_g)::numeric, 4);
  v_new_loss  := round((coalesce(v_batch.loss_gram, 0) + v_loss_g)::numeric, 4);
  v_new_good  := case
                   when v_is_final then round((coalesce(v_batch.good_output_gram, 0) + v_move_g)::numeric, 4)
                   else round(coalesce(v_batch.good_output_gram, 0)::numeric, 4)
                 end;

  v_in_gold   := round(coalesce(v_batch.issued_gold_gram, v_batch.planned_gram, 0)::numeric, 4);
  v_tot_out   := round((v_new_good + v_new_sprue + v_new_scrap + v_new_loss)::numeric, 4);

  if v_in_gold <= 0 then
    raise exception 'Authoritative issued gold is missing or zero for batch %', v_batch_code;
  end if;

  if v_tot_out > (v_in_gold + 0.05) then
    raise exception 'Mass balance violation: total outputs (%g) exceeds issued gold (%g)', v_tot_out, v_in_gold;
  end if;

  -- Stage-level WIP mass balance check
  if coalesce(v_cur_wip.input_weight, 0) > 0 then
    v_avail_stage_g := round(greatest(0, coalesce(v_cur_wip.input_weight, 0) - coalesce(v_cur_wip.output_weight, 0) - coalesce(v_cur_wip.loss_weight, 0))::numeric, 4);
    if (v_move_g + v_sprue_g + v_scrap_g + v_loss_g) > (v_avail_stage_g + 0.05) then
      raise exception 'Mass balance violation: total outputs (%g) exceeds available stage WIP (%g)',
        (v_move_g + v_sprue_g + v_scrap_g + v_loss_g), v_avail_stage_g;
    end if;
    v_rem_stage_g := round(greatest(0, v_avail_stage_g - (v_move_g + v_sprue_g + v_scrap_g + v_loss_g))::numeric, 4);
  else
    v_rem_stage_g := round(greatest(0, v_in_gold - v_tot_out)::numeric, 4);
  end if;

  v_new_wip_g := v_rem_stage_g;

  update public.batch_stage_wip
     set available_qty = v_rem_qty,
         completed_qty = coalesce(completed_qty, 0) + p_move_qty,
         rework_qty    = coalesce(rework_qty, 0) + p_rework_qty,
         output_weight = coalesce(output_weight, 0) + v_move_g + v_sprue_g + v_scrap_g,
         loss_weight   = coalesce(loss_weight, 0) + v_loss_g,
         updated_at    = now()
   where id = v_cur_wip.id;

  if p_move_qty > 0 and not v_is_final then
    select * into v_nxt_wip
      from public.batch_stage_wip
     where (batch_id = btrim(p_batch_id) or batch_no = v_batch_code)
       and stage_order = v_actual_target_st
       and organization_id = v_caller_org
     for update;

    if found then
      update public.batch_stage_wip
         set available_qty = available_qty + p_move_qty,
             input_weight  = coalesce(input_weight, 0) + v_move_g,
             assigned_worker = coalesce(nullif(btrim(p_worker_name), ''), assigned_worker),
             updated_at    = now()
       where id = v_nxt_wip.id;
    else
      insert into public.batch_stage_wip (
        batch_id, batch_no, stage_order, stage_name, department,
        available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
        queue_status, assigned_worker, organization_id
      ) values (
        btrim(p_batch_id), v_batch_code, v_actual_target_st, v_actual_target_nm, v_actual_target_dp,
        p_move_qty, 0, 0, v_move_g, 0, 0,
        'NOW', nullif(btrim(p_worker_name), ''), v_caller_org
      );
    end if;
  end if;

  v_new_fin_qty := coalesce(v_batch.finished_qty, 0);
  if v_is_final and p_move_qty > 0 then
    v_new_fin_qty := v_new_fin_qty + p_move_qty;
    v_credit_qty  := p_move_qty;

    select * into v_prod
      from public.products
     where (lower(btrim(name)) = lower(btrim(v_batch.product_name)) or lower(btrim(name)) = lower(btrim(coalesce(v_batch.product, ''))))
       and organization_id = v_caller_org
     limit 1
     for update;

    if found then
      update public.products
         set stock      = coalesce(stock, quantity, 0) + v_credit_qty,
             quantity   = coalesce(stock, quantity, 0) + v_credit_qty,
             updated_at = now()
       where id = v_prod.id;
    else
      -- Seamless auto-creation of finished jewelry in vitrina
      insert into public.products (
        organization_id,
        name,
        category,
        proba,
        stock,
        quantity,
        weight,
        created_at,
        updated_at
      ) values (
        v_caller_org,
        coalesce(nullif(btrim(v_batch.product_name), ''), nullif(btrim(coalesce(v_batch.product, '')), ''), 'Zargarlik buyumi'),
        'Komplekt',
        coalesce(v_batch.proba, 585),
        v_credit_qty,
        v_credit_qty,
        round((v_move_g / greatest(p_move_qty, 1))::numeric, 4),
        now(),
        now()
      );
    end if;
  end if;

  v_done_all := (v_new_fin_qty >= coalesce(v_batch.planned_qty, 0) and v_new_wip_g <= 0.05);

  update public.batches
     set sprue_gram            = v_new_sprue,
         scrap_gram            = v_new_scrap,
         loss_gram             = v_new_loss,
         good_output_gram      = v_new_good,
         wip_gram              = v_new_wip_g,
         finished_qty          = v_new_fin_qty,
         credited_finished_qty = coalesce(credited_finished_qty, 0) + v_credit_qty,
         current_step          = case when v_done_all then '25. Tayyor ombor' else v_actual_target_nm end,
         status                = case when v_done_all then 'Tugatildi' else 'Jarayonda' end,
         status_label          = case when v_done_all then 'Tugatildi' else 'Jarayonda' end,
         updated_at            = now()
   where id = v_batch.id;

  -- --------------------------------------------------------------------------
  -- BIDIRECTIONAL BATCH_OPERATIONS SYNCHRONIZATION
  -- --------------------------------------------------------------------------
  if to_regclass('public.batch_operations') is not null and public.try_cast_uuid(p_batch_id) is not null then
    select bo.id into v_open_op_id
      from public.batch_operations bo
     where bo.batch_id = public.try_cast_uuid(p_batch_id)
       and bo.status in ('queued', 'in_progress', 'paused', 'delayed')
     order by bo.queued_at desc
     limit 1;

    if v_open_op_id is not null then
      update public.batch_operations
         set status = 'completed',
             finished_at = coalesce(finished_at, now()),
             output_weight_grams = coalesce(output_weight_grams, v_move_g),
             updated_at = now()
       where id = v_open_op_id;
    end if;

    if not v_is_final and p_move_qty > 0 then
      select ws.id, ws.department_id into v_stage_uuid, v_dept_uuid
        from public.workflow_stages ws
       where (ws.sequence_order = v_actual_target_st
              or lower(trim(ws.name)) = lower(trim(v_actual_target_nm))
              or lower(trim(ws.code)) = lower(trim(v_actual_target_dp)))
         and ws.is_active = true
       limit 1;

      if v_stage_uuid is not null and v_dept_uuid is not null then
        select bo.id into v_existing_op_id
          from public.batch_operations bo
         where bo.batch_id = public.try_cast_uuid(p_batch_id)
           and bo.stage_id = v_stage_uuid
           and bo.status in ('queued', 'in_progress')
         order by bo.queued_at desc
         limit 1;

        if v_existing_op_id is not null then
          update public.batch_operations
             set input_weight_grams = coalesce(input_weight_grams, 0) + v_move_g,
                 updated_at = now()
           where id = v_existing_op_id;
        else
          select coalesce(max(attempt_number), 0) + 1 into v_next_attempt
            from public.batch_operations
           where batch_id = public.try_cast_uuid(p_batch_id)
             and stage_id = v_stage_uuid;

          insert into public.batch_operations (
            batch_id, stage_id, department_id, attempt_number,
            status, queued_at, input_weight_grams
          ) values (
            public.try_cast_uuid(p_batch_id),
            v_stage_uuid,
            v_dept_uuid,
            v_next_attempt,
            'queued',
            now(),
            v_move_g
          );
        end if;
      end if;
    end if;
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch.id::text,
    'batch_no', v_batch_code,
    'from_stage_order', p_from_stage_order,
    'to_stage_order', v_actual_target_st,
    'to_stage_name', v_actual_target_nm,
    'moved_qty', p_move_qty,
    'moved_weight', v_move_g,
    'rework_qty', p_rework_qty,
    'loss_gram', v_loss_g,
    'wip_remaining_gram', v_new_wip_g,
    'remaining_wip_gram', v_new_wip_g,
    'finished_qty', v_new_fin_qty,
    'is_completed', v_done_all,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_move_partial_wip', v_existing, v_payload);

  return v_existing;
end;
$$;

revoke execute on function public.rpc_move_partial_wip(text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text, boolean, text) from public, anon;
grant execute on function public.rpc_move_partial_wip(text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text, boolean, text) to authenticated;

-- 7. Atomic QC Re-inspection RPC
create or replace function public.rpc_reinspect_qc(
  p_qc_id           text,
  p_passed          boolean,
  p_notes           text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_qc            public.quality_control%rowtype;
  v_existing      jsonb;
  v_payload       jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'supervisor', 'qc_inspector', 'quality_inspector'
  ]);

  v_payload := jsonb_build_object(
    'qc_id', btrim(p_qc_id),
    'passed', p_passed,
    'notes', p_notes
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reinspect_qc', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_qc
    from public.quality_control
   where (id::text = btrim(p_qc_id) or batch_id = btrim(p_qc_id))
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'QC record % not found in current organization', p_qc_id;
  end if;

  if p_passed then
    update public.quality_control
       set status = 'APPROVED',
           reason = coalesce(reason, '') || case when p_notes is not null then ' [Qayta tekshiruv: O''TDI - ' || p_notes || ']' else ' [Qayta tekshiruv: O''TDI]' end,
           notes = coalesce(notes, '') || case when p_notes is not null then ' [Qayta tekshiruv: O''TDI - ' || p_notes || ']' else ' [Qayta tekshiruv: O''TDI]' end,
           updated_at = now()
     where id = v_qc.id;
  else
    update public.quality_control
       set status = 'IN_REWORK',
           reason = coalesce(reason, '') || case when p_notes is not null then ' [Qayta tekshiruv: RAD ETILDI - ' || p_notes || ']' else ' [Qayta tekshiruv: RAD ETILDI]' end,
           notes = coalesce(notes, '') || case when p_notes is not null then ' [Qayta tekshiruv: RAD ETILDI - ' || p_notes || ']' else ' [Qayta tekshiruv: RAD ETILDI]' end,
           updated_at = now()
     where id = v_qc.id;
  end if;

  v_existing := jsonb_build_object(
    'success', true,
    'qc_id', v_qc.id,
    'status', case when p_passed then 'APPROVED' else 'IN_REWORK' end,
    'passed', p_passed
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reinspect_qc', v_existing, v_payload);

  return v_existing;
end;
$$;

revoke execute on function public.rpc_reinspect_qc(text, boolean, text, text) from public, anon;
grant execute on function public.rpc_reinspect_qc(text, boolean, text, text) to authenticated;

-- 8. Enhanced rpc_complete_qc_rework with Strict Status Validation
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
    if not found then
      raise exception 'No active rework QC record found for batch %', coalesce(v_effective_bno, v_effective_bid);
    end if;
  end if;

  if v_qc.id is not null and v_qc.status not in ('IN_REWORK', 'REWORK_IN_PROGRESS') then
    raise exception 'QC record % is in status %, not in rework status', v_qc.id, v_qc.status;
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
           resolution_notes = coalesce(nullif(btrim(p_resolution_notes), ''), 'Rework successfully completed by master and returned for re-inspection'),
           updated_at       = now()
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

revoke execute on function public.rpc_complete_qc_rework(text, text, text, integer, integer, integer, text, text, text) from public, anon;
grant execute on function public.rpc_complete_qc_rework(text, text, text, integer, integer, integer, text, text, text) to authenticated;

