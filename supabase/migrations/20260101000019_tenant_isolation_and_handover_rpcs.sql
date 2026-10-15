-- ============================================================================
-- JewelryFlow ERP — Migration 019: Multi-Tenant Isolation & Handover RPCs
-- ============================================================================
-- 1. Helper function: current_organization_id()
-- 2. Tenant linkage columns across remaining operational tables
-- 3. Default tenant assignments & safe Goldia backfill
-- 4. High-performance tenant indices
-- 5. Multi-Tenant RLS isolation policies
-- 6. Atomic Two-Party Handover RPCs:
--    - rpc_dispatch_stage_handover
--    - rpc_accept_stage_handover
--    - rpc_override_stage_handover
-- 7. Grant execute permissions to authenticated users
-- ============================================================================

-- 1. Helper: Determine active caller organization UUID
create or replace function public.current_organization_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_org_id    uuid;
  v_cfg_org   text;
begin
  -- Explicit transaction / session override (if set by API or test)
  v_cfg_org := current_setting('app.current_organization_id', true);
  if v_cfg_org is not null and v_cfg_org ~* '^[0-9a-f-]{36}$' then
    return v_cfg_org::uuid;
  end if;

  if v_uid is null then
    -- Internal / background fallback to default Goldia organization
    select id into v_org_id from public.organizations where code = 'goldia' limit 1;
    return v_org_id;
  end if;

  -- 1. Check employee organization assignment
  select organization_id
    into v_org_id
    from public.employees e
   where (e.user_id = v_uid or e.id::text = v_uid::text)
     and e.organization_id is not null
   limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  -- 2. Check profile organization assignment
  select organization_id
    into v_org_id
    from public.profiles p
   where p.user_id = v_uid
     and p.organization_id is not null
   limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  -- 3. Fallback to primary tenant (Goldia) for backward compatibility
  select id into v_org_id from public.organizations where code = 'goldia' limit 1;
  return v_org_id;
end;
$$;

grant execute on function public.current_organization_id() to authenticated, anon;

-- 2. Non-destructive tenant columns across remaining operational tables
alter table public.batch_stage_wip
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.gold_transactions
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.products
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.sales
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.customers
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.salary_ledger
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.audit_logs
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

-- 3. Seed / Backfill existing records to Goldia tenant
do $$
declare
  v_goldia_id uuid;
begin
  select id into v_goldia_id from public.organizations where code = 'goldia' limit 1;

  if v_goldia_id is not null then
    -- Set defaults
    alter table public.batches alter column organization_id set default v_goldia_id;
    alter table public.orders alter column organization_id set default v_goldia_id;
    alter table public.inventory_items alter column organization_id set default v_goldia_id;
    alter table public.batch_stage_wip alter column organization_id set default v_goldia_id;
    alter table public.two_party_handovers alter column organization_id set default v_goldia_id;
    alter table public.gold_transactions alter column organization_id set default v_goldia_id;
    alter table public.employees alter column organization_id set default v_goldia_id;
    alter table public.profiles alter column organization_id set default v_goldia_id;
    alter table public.products alter column organization_id set default v_goldia_id;
    alter table public.customers alter column organization_id set default v_goldia_id;
    alter table public.sales alter column organization_id set default v_goldia_id;
    alter table public.salary_ledger alter column organization_id set default v_goldia_id;

    -- Backfill nulls safely
    update public.employees set organization_id = v_goldia_id where organization_id is null;
    update public.profiles set organization_id = v_goldia_id where organization_id is null;
    update public.batches set organization_id = v_goldia_id where organization_id is null;
    update public.orders set organization_id = v_goldia_id where organization_id is null;
    update public.inventory_items set organization_id = v_goldia_id where organization_id is null;
    update public.batch_stage_wip set organization_id = v_goldia_id where organization_id is null;
    update public.two_party_handovers set organization_id = v_goldia_id where organization_id is null;
    update public.gold_transactions set organization_id = v_goldia_id where organization_id is null;
    update public.products set organization_id = v_goldia_id where organization_id is null;
    update public.customers set organization_id = v_goldia_id where organization_id is null;
    update public.sales set organization_id = v_goldia_id where organization_id is null;
    update public.salary_ledger set organization_id = v_goldia_id where organization_id is null;
  end if;
end $$;

-- 4. High-Performance Tenant Filter Indices
create index if not exists idx_batches_org on public.batches(organization_id);
create index if not exists idx_orders_org on public.orders(organization_id);
create index if not exists idx_inventory_items_org on public.inventory_items(organization_id);
create index if not exists idx_batch_stage_wip_org on public.batch_stage_wip(organization_id);
create index if not exists idx_two_party_handovers_org on public.two_party_handovers(organization_id);
create index if not exists idx_gold_transactions_org on public.gold_transactions(organization_id);
create index if not exists idx_products_org on public.products(organization_id);
create index if not exists idx_customers_org on public.customers(organization_id);
create index if not exists idx_sales_org on public.sales(organization_id);

-- 5. Multi-Tenant RLS Isolation Policies
-- Ensures users can only access rows belonging to their active organization,
-- while safely allowing access to unassigned rows for backwards compatibility.

drop policy if exists "tenant isolation batches select" on public.batches;
create policy "tenant isolation batches select"
  on public.batches for select to authenticated
  using (
    organization_id is null
    or organization_id = public.current_organization_id()
    or public.current_organization_id() is null
  );

drop policy if exists "tenant isolation batches mutate" on public.batches;
create policy "tenant isolation batches mutate"
  on public.batches for all to authenticated
  using (
    organization_id is null
    or organization_id = public.current_organization_id()
    or public.current_organization_id() is null
  )
  with check (
    organization_id is null
    or organization_id = public.current_organization_id()
    or public.current_organization_id() is null
  );

drop policy if exists "tenant isolation orders select" on public.orders;
create policy "tenant isolation orders select"
  on public.orders for select to authenticated
  using (
    organization_id is null
    or organization_id = public.current_organization_id()
    or public.current_organization_id() is null
  );

drop policy if exists "tenant isolation inventory select" on public.inventory_items;
create policy "tenant isolation inventory select"
  on public.inventory_items for select to authenticated
  using (
    organization_id is null
    or organization_id = public.current_organization_id()
    or public.current_organization_id() is null
  );

drop policy if exists "tenant isolation batch_stage_wip select" on public.batch_stage_wip;
create policy "tenant isolation batch_stage_wip select"
  on public.batch_stage_wip for select to authenticated
  using (
    organization_id is null
    or organization_id = public.current_organization_id()
    or public.current_organization_id() is null
  );

-- 6. Two-Party Handover Atomic RPCs

-- 6A. RPC: Dispatch Handover (Sender)
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
  p_idempotency_key        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_handover_id text;
  v_org_id      uuid := public.current_organization_id();
  v_tol         numeric(6, 4) := round(coalesce(p_tolerance_gram, 0.05)::numeric, 4);
  v_weight      numeric(14, 4) := round(coalesce(p_dispatched_weight_gram, 0)::numeric, 4);
  v_existing    jsonb;
  v_payload     jsonb;
begin
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
    status, tolerance_gram, dispatched_at
  ) values (
    v_handover_id, v_org_id, btrim(p_batch_id), btrim(p_batch_no),
    p_from_stage_order, btrim(p_from_stage_name), btrim(p_from_department),
    p_to_stage_order, btrim(p_to_stage_name), btrim(p_to_department),
    btrim(p_sender_worker_id), btrim(p_sender_worker_name),
    nullif(btrim(p_receiver_worker_id), ''), nullif(btrim(p_receiver_worker_name), ''),
    p_dispatched_qty, v_weight,
    'PENDING_ACCEPTANCE', v_tol, clock_timestamp()
  );

  v_existing := jsonb_build_object(
    'success', true,
    'status', 'PENDING_ACCEPTANCE',
    'handover_id', v_handover_id,
    'batch_no', btrim(p_batch_no),
    'dispatched_qty', p_dispatched_qty,
    'dispatched_weight_gram', v_weight,
    'tolerance_gram', v_tol
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_dispatch_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 6B. RPC: Accept Handover (Receiver Verification & Tolerance Enforcement)
create or replace function public.rpc_accept_stage_handover(
  p_handover_id                text,
  p_receiver_worker_id         text,
  p_receiver_worker_name       text,
  p_received_qty               integer,
  p_received_weight_gram       numeric,
  p_supervisor_override_reason text default null,
  p_idempotency_key            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
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
begin
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
    -- Discrepancy detected! Check if valid supervisor override is provided
    if p_supervisor_override_reason is not null and length(btrim(p_supervisor_override_reason)) >= 5 then
      if v_caller_role not in ('admin', 'director', 'owner', 'manager', 'production_manager', 'supervisor', 'master') then
        raise exception 'Only supervisor or manager can override handover discrepancies';
      end if;

      v_new_status := 'SUPERVISOR_OVERRIDDEN';
      v_flag_reason := format('Overridden by supervisor: %s. Weight diff: %sg, Qty diff: %s',
        btrim(p_supervisor_override_reason), v_discrepancy, (p_received_qty - v_h.dispatched_qty));
    else
      v_new_status := 'DISCREPANCY_FLAGGED';
      if v_qty_mismatch and v_weight_excess then
        v_flag_reason := format('Quantity mismatch (sent %s, got %s) AND weight discrepancy of %sg exceeds allowable tolerance %sg',
          v_h.dispatched_qty, p_received_qty, v_discrepancy, v_h.tolerance_gram);
      elsif v_qty_mismatch then
        v_flag_reason := format('Quantity mismatch: sent %s, got %s', v_h.dispatched_qty, p_received_qty);
      else
        v_flag_reason := format('Weight discrepancy of %sg exceeds allowable tolerance %sg', v_discrepancy, v_h.tolerance_gram);
      end if;
    end if;
  end if;

  update public.two_party_handovers
     set receiver_worker_id         = btrim(p_receiver_worker_id),
         receiver_worker_name       = btrim(p_receiver_worker_name),
         received_qty               = p_received_qty,
         received_weight_gram       = v_rec_weight,
         weight_discrepancy_gram    = v_discrepancy,
         status                     = v_new_status,
         flag_reason                = v_flag_reason,
         supervisor_override_id     = case when v_new_status = 'SUPERVISOR_OVERRIDDEN' then auth.uid()::text else v_h.supervisor_override_id end,
         supervisor_override_reason = case when v_new_status = 'SUPERVISOR_OVERRIDDEN' then btrim(p_supervisor_override_reason) else v_h.supervisor_override_reason end,
         resolved_at                = clock_timestamp()
   where id = v_h.id;

  v_existing := jsonb_build_object(
    'success', (v_new_status in ('ACCEPTED', 'SUPERVISOR_OVERRIDDEN')),
    'handover_id', v_h.id,
    'status', v_new_status,
    'discrepancy_gram', v_discrepancy,
    'flag_reason', v_flag_reason
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_accept_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 6C. RPC: Override Discrepancy (Supervisor / Management Escalation)
create or replace function public.rpc_override_stage_handover(
  p_handover_id             text,
  p_supervisor_worker_id    text,
  p_supervisor_worker_name  text,
  p_override_reason         text,
  p_idempotency_key         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_h        public.two_party_handovers%rowtype;
  v_existing jsonb;
  v_payload  jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta'
  ]);

  if p_override_reason is null or length(btrim(p_override_reason)) < 5 then
    raise exception 'Supervisor override requires a documented investigation reason (min 5 characters)';
  end if;

  v_payload := jsonb_build_object(
    'handover_id', btrim(coalesce(p_handover_id, '')),
    'supervisor_worker_id', btrim(coalesce(p_supervisor_worker_id, '')),
    'reason', btrim(p_override_reason)
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_override_stage_handover', v_payload);
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

  if v_h.status <> 'DISCREPANCY_FLAGGED' then
    raise exception 'Only flagged handovers can be overridden (current: %)', v_h.status;
  end if;

  update public.two_party_handovers
     set status                     = 'SUPERVISOR_OVERRIDDEN',
         supervisor_override_id     = coalesce(nullif(btrim(p_supervisor_worker_id), ''), auth.uid()::text),
         supervisor_override_reason = btrim(p_override_reason),
         resolved_at                = clock_timestamp()
   where id = v_h.id;

  v_existing := jsonb_build_object(
    'success', true,
    'handover_id', v_h.id,
    'status', 'SUPERVISOR_OVERRIDDEN',
    'reason', btrim(p_override_reason)
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_override_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 7. Grant Execution Privileges to Authenticated Users
grant execute on function public.rpc_dispatch_stage_handover(
  text, text, integer, text, text, integer, text, text, text, text, integer, numeric, text, text, numeric, text
) to authenticated;

grant execute on function public.rpc_accept_stage_handover(
  text, text, text, integer, numeric, text, text
) to authenticated;

grant execute on function public.rpc_override_stage_handover(
  text, text, text, text, text
) to authenticated;
