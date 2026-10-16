-- ==============================================================================
-- Migration 022: Manufacturing WIP Synchronization, Goldia Bypass & Piecework Payroll
--
-- Features:
-- 1. Reference seed for departments and workflow_stages (safe idempotency)
-- 2. Extended salary_ledger transaction types (EARNED, PAID, ADJUSTMENT, REVERSAL)
-- 3. rpc_calculate_piecework_salary: Idempotent piecework earnings on accepted work
-- 4. rpc_adjust_piecework_salary: Formal supervisor/accounting adjustment & reversal
-- 5. Updated rpc_accept_stage_handover & rpc_override_stage_handover:
--    - Server-side weighing tolerance checks
--    - Automatic trigger of piecework salary for sender upon verified acceptance
-- 6. Updated rpc_move_partial_wip:
--    - Goldia factory bypass enforcement (skips 9 Pumice/Ponza and 13 Zircon)
--    - Bidirectional synchronization with batch_operations table
-- ==============================================================================

-- 1. Reference Data: Ensure default departments and workflow_stages exist
insert into public.departments (code, name, description) values
  ('WAX',        'Wax',               'Wax pattern preparation'),
  ('WAX_ASM',    'Wax Assembly',      'Assembling wax trees'),
  ('INVESTMENT', 'Investment',        'Gypsum/plaster investment'),
  ('BURNOUT',    'Burnout Furnace',   'Wax burnout firing'),
  ('CASTING',    'Casting',           'Gold casting'),
  ('TUMBLING',   'Tumbling',          'Tumble finishing'),
  ('STRAIGHTEN', 'Straightening',     'Straightening rings/findings'),
  ('SANDING',    'Sanding',           'Surface sanding'),
  ('PUMICE',     'Pumice Machine',    'Pumice finishing'),
  ('CLEANING',   'Cleaning',          'Ultrasonic/manual cleaning'),
  ('PRE_POLISH', 'Pre-Polish Machine','Pre-polish finishing'),
  ('ZIRCON',     'Zircon Machine',    'Zircon setting/finishing'),
  ('FINAL_POLISH','Final Polish',     'Final hand polish'),
  ('LASER',      'Laser Decoration',  'Laser engraving/decoration'),
  ('QUICK_POLISH','Quick Polish',     'Final quick polish pass'),
  ('WASHING',    'Washing',           'Final wash'),
  ('PACKAGING',  'Packaging',         'Packing for shipment')
on conflict (code) do nothing;

insert into public.workflow_stages (code, name, sequence_order, department_id, is_terminal, default_sla_minutes)
select s.code, s.name, s.sequence_order, d.id, s.is_terminal, s.sla
from (values
  ('WAX',              'Wax',                 1,  'WAX',         false, 60),
  ('WAX_ASSEMBLY',      'Wax Assembly',        2,  'WAX_ASM',     false, 90),
  ('INVESTMENT',        'Investment',          3,  'INVESTMENT',  false, 120),
  ('BURNOUT_FURNACE',   'Burnout Furnace',     4,  'BURNOUT',     false, 480),
  ('CASTING',           'Casting',             5,  'CASTING',     false, 60),
  ('TUMBLING',          'Tumbling',            6,  'TUMBLING',    false, 120),
  ('STRAIGHTENING',     'Straightening',       7,  'STRAIGHTEN',  false, 60),
  ('SANDING',           'Sanding',             8,  'SANDING',     false, 60),
  ('PUMICE_MACHINE',    'Pumice Machine',      9,  'PUMICE',      false, 45),
  ('CLEANING_1',        'Cleaning',            10, 'CLEANING',    false, 20),
  ('PRE_POLISH_MACHINE','Pre-Polish Machine',  11, 'PRE_POLISH',  false, 45),
  ('CLEANING_2',        'Cleaning',            12, 'CLEANING',    false, 20),
  ('ZIRCON_MACHINE',    'Zircon Machine',      13, 'ZIRCON',      false, 45),
  ('CLEANING_3',        'Cleaning',            14, 'CLEANING',    false, 20),
  ('FINAL_POLISH',      'Final Polish',        15, 'FINAL_POLISH',false, 60),
  ('LASER_DECORATION',  'Laser Decoration',    16, 'LASER',       false, 30),
  ('QUICK_POLISH',      'Quick Polish',        17, 'QUICK_POLISH',false, 20),
  ('WASHING',           'Washing',             18, 'WASHING',     false, 15),
  ('PACKAGING',         'Packaging',           19, 'PACKAGING',   false, 20),
  ('COMPLETED',         'Completed',           20, 'PACKAGING',   true,  null)
) as s(code, name, sequence_order, dept_code, is_terminal, sla)
join public.departments d on d.code = s.dept_code
on conflict (code) do nothing;

-- 2. Extend salary_ledger table constraints and columns
do $$
begin
  -- Drop existing tx_type check constraints if present
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.salary_ledger'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tx_type%'
  ) then
    execute (
      select 'alter table public.salary_ledger drop constraint ' || conname
      from pg_constraint
      where conrelid = 'public.salary_ledger'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%tx_type%'
      limit 1
    );
  end if;
end $$;

alter table public.salary_ledger
  add constraint chk_salary_ledger_tx_type
  check (tx_type in ('EARNED', 'PAID', 'ADJUSTMENT', 'REVERSAL'));

alter table public.salary_ledger
  add column if not exists handover_id text,
  add column if not exists stage_order integer,
  add column if not exists original_ledger_id text,
  add column if not exists batch_id text;

-- Allow production managers and supervisors to view piecework salary records
drop policy if exists "salary_ledger_tenant_select" on public.salary_ledger;
create policy "salary_ledger_tenant_select"
  on public.salary_ledger for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in (
        'admin', 'director', 'owner', 'direktor', 'rahbar',
        'accountant', 'buxgalter', 'hisobchi',
        'manager', 'production_manager', 'production manager', 'supervisor', 'master'
      )
      or employee_id::text = auth.uid()::text
    )
  );

drop policy if exists "salary_ledger_tenant_admin_insert" on public.salary_ledger;
create policy "salary_ledger_tenant_admin_insert"
  on public.salary_ledger for insert to authenticated
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'accountant', 'buxgalter', 'hisobchi',
      'manager', 'production_manager', 'production manager'
    )
  );

alter table public.employees
  add column if not exists gram_rate numeric(18, 2) default 15000.00;

-- Ensure sync_batch_current_stage does not fail with CASE type mismatch against reconciled text status
create or replace function public.sync_batch_current_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.batches
  set
    current_stage_id = new.stage_id,
    current_department_id = new.department_id,
    assigned_employee_id = coalesce(new.assigned_employee_id, batches.assigned_employee_id),
    status = case
      when new.status = 'in_progress' then 'in_progress'
      when new.status = 'delayed' then 'delayed'
      when new.status = 'queued' then 'queued'
      else coalesce(batches.status::text, 'queued')
    end,
    started_at = case when new.status = 'in_progress' and batches.started_at is null then new.started_at else batches.started_at end
  where id = new.batch_id;
  return new;
end;
$$;

-- 3. RPC: rpc_calculate_piecework_salary
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
  v_emp          public.employees%rowtype;
  v_rate         numeric(18, 2);
  v_amount       numeric(18, 2);
  v_weight       numeric(14, 4) := round(coalesce(p_weight_done, 0)::numeric, 4);
  v_existing     jsonb;
  v_payload      jsonb;
  v_ledger_id    uuid;
  v_worker_title text;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
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
    v_rate := 15000.00; -- Standard default UZS per gram for jewelry floor
  end if;

  v_amount := round((v_weight * v_rate)::numeric, 2);
  if v_amount <= 0 then
    v_amount := 1.00; -- Floor minimum for tracked physical piece
  end if;

  -- Idempotently check if an EARNED entry already exists for this handover
  if p_handover_id is not null and btrim(p_handover_id) != '' then
    select id into v_ledger_id
      from public.salary_ledger
     where handover_id = btrim(p_handover_id)
       and tx_type = 'EARNED'
     limit 1;

    if v_ledger_id is not null then
      v_existing := jsonb_build_object(
        'status', 'ok',
        'deduplicated', true,
        'ledger_id', v_ledger_id::text,
        'amount', v_amount,
        'worker_name', v_worker_title,
        'rate', v_rate,
        'weight_done', v_weight,
        'organization_id', v_caller_org
      );
      return v_existing;
    end if;
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

-- 4. RPC: rpc_adjust_piecework_salary (Adjustment & Reversal Handling)
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
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_orig          public.salary_ledger%rowtype;
  v_adj_amount    numeric(18, 2) := round(abs(coalesce(p_adjustment_amount, 0))::numeric, 2);
  v_tx_type       text := upper(btrim(coalesce(p_tx_type, 'ADJUSTMENT')));
  v_new_ledger_id uuid;
  v_existing      jsonb;
  v_payload       jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- Only manager, director, or accountant can adjust piecework salary
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

  if v_adj_amount <= 0 then
    v_adj_amount := v_orig.amount; -- Full reversal if zero amount provided
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
    'PAID', -- Negative adjustment/reversal acts as deducted
    format('%s: %s (Orig Ledger: %s)', v_tx_type, btrim(p_reason), v_orig.id::text),
    v_orig.handover_id,
    v_orig.stage_order,
    v_orig.id::text,
    nullif(btrim(p_idempotency_key), ''),
    v_caller_org
  ) returning id into v_new_ledger_id;

  -- Record audit trail
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
    'tx_type', v_tx_type,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_adjust_piecework_salary', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 5. Updated rpc_accept_stage_handover with Automatic Piecework Calculation
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
  v_salary_res    jsonb := null;
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
   where id::text = btrim(p_handover_id)
     for update;

  if not found then
    raise exception 'Handover record not found: %', p_handover_id;
  end if;

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

  -- AUTOMATIC PIECEWORK SALARY CALCULATION:
  -- Only award piecework salary when work is confirmed (ACCEPTED or SUPERVISOR_OVERRIDDEN)
  if v_new_status in ('ACCEPTED', 'SUPERVISOR_OVERRIDDEN') then
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
    'success', (v_new_status in ('ACCEPTED', 'SUPERVISOR_OVERRIDDEN')),
    'handover_id', v_h.id::text,
    'status', v_new_status,
    'discrepancy_gram', v_discrepancy,
    'flag_reason', v_flag_reason,
    'piecework_earned', v_salary_res,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_accept_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 6. Updated rpc_override_stage_handover with Automatic Piecework Calculation
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
  v_caller_org  uuid := public.current_organization_id();
  v_caller_role text := public.current_employee_role_text();
  v_h           public.two_party_handovers%rowtype;
  v_existing    jsonb;
  v_payload     jsonb;
  v_salary_res  jsonb := null;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

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
    'override_reason', btrim(p_override_reason)
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_override_stage_handover', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_h
    from public.two_party_handovers
   where id::text = btrim(p_handover_id)
     for update;

  if not found then
    raise exception 'Handover record not found: %', p_handover_id;
  end if;

  if v_h.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Handover does not belong to your organization' using errcode = '42501';
  end if;

  if v_h.status not in ('DISCREPANCY_FLAGGED', 'PENDING_ACCEPTANCE') then
    raise exception 'Handover % is not in a flagged state (current: %)', p_handover_id, v_h.status;
  end if;

  update public.two_party_handovers
     set status                     = 'SUPERVISOR_OVERRIDDEN',
         supervisor_override_id     = btrim(p_supervisor_worker_id),
         supervisor_override_reason = btrim(p_override_reason),
         resolved_at                = clock_timestamp()
   where id = v_h.id;

  -- Record supervisor override in audit logs
  insert into public.audit_logs (
    table_name, record_id, action, actor_id, actor_name, actor_role,
    reason, new_data, organization_id
  ) values (
    'two_party_handovers',
    v_h.id::text,
    'HANDOVER_OVERRIDE_ALERT',
    auth.uid(),
    btrim(p_supervisor_worker_name),
    v_caller_role,
    btrim(p_override_reason),
    jsonb_build_object(
      'handover_id', v_h.id::text,
      'batch_no', v_h.batch_no,
      'dispatched_weight_gram', v_h.dispatched_weight_gram,
      'received_weight_gram', v_h.received_weight_gram,
      'discrepancy_gram', v_h.weight_discrepancy_gram,
      'sender_worker', v_h.sender_worker_name,
      'receiver_worker', v_h.receiver_worker_name
    ),
    v_caller_org
  );

  -- Award piecework salary upon approved supervisor override
  v_salary_res := public.rpc_calculate_piecework_salary(
    p_handover_id     := v_h.id::text,
    p_worker_id       := v_h.sender_worker_id,
    p_worker_name     := v_h.sender_worker_name,
    p_batch_no        := v_h.batch_no,
    p_stage_name      := v_h.from_stage_name,
    p_stage_order     := v_h.from_stage_order,
    p_weight_done     := coalesce(v_h.received_weight_gram, v_h.dispatched_weight_gram),
    p_qty_done        := coalesce(v_h.received_qty, v_h.dispatched_qty),
    p_idempotency_key := 'earned-ho-' || v_h.id::text
  );

  v_existing := jsonb_build_object(
    'success', true,
    'handover_id', v_h.id::text,
    'status', 'SUPERVISOR_OVERRIDDEN',
    'piecework_earned', v_salary_res,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_override_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 7. Enhanced rpc_move_partial_wip with Goldia Factory Bypass and batch_operations Sync
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
    -- 1. Complete open operation for the source stage if one exists
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

    -- 2. Open next queued operation if not terminal
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

-- 8. Privileges Granting
revoke execute on function public.rpc_calculate_piecework_salary(text, text, text, text, text, integer, numeric, integer, numeric, text) from public, anon;
grant execute on function public.rpc_calculate_piecework_salary(text, text, text, text, text, integer, numeric, integer, numeric, text) to authenticated;

revoke execute on function public.rpc_adjust_piecework_salary(text, numeric, text, text, text) from public, anon;
grant execute on function public.rpc_adjust_piecework_salary(text, numeric, text, text, text) to authenticated;

revoke execute on function public.rpc_accept_stage_handover(text, text, text, integer, numeric, text, text) from public, anon;
grant execute on function public.rpc_accept_stage_handover(text, text, text, integer, numeric, text, text) to authenticated;

revoke execute on function public.rpc_override_stage_handover(text, text, text, text, text) from public, anon;
grant execute on function public.rpc_override_stage_handover(text, text, text, text, text) to authenticated;

revoke execute on function public.rpc_move_partial_wip(text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text, boolean, text) from public, anon;
grant execute on function public.rpc_move_partial_wip(text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text, boolean, text) to authenticated;
