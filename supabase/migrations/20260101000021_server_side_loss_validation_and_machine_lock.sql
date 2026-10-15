-- ==============================================================================
-- Migration 021: Server-Side Stage Loss Validation & Machine Concurrency Locking
--
-- Features:
-- 1. public.current_employee_name() helper for audit accountability
-- 2. Multi-tenant stage_loss_configs table & Goldia factory seed defaults
-- 3. Server-side / Database enforced stage loss validation in rpc_move_partial_wip:
--    - Evaluates stage-level percentage and gram loss against configured thresholds
--    - Blocks unconfirmed or unauthorized excess loss at the database level
--    - Requires manager/director authorization to override excess loss
--    - Emits immutable EXCESSIVE_LOSS_ALERT in public.audit_logs upon override
-- 4. Atomic machine station concurrency lock RPCs:
--    - rpc_assign_machine_station (locks station atomically, prevents race conditions)
--    - rpc_release_machine_station (releases station back to IDLE state)
-- ==============================================================================

-- 1. Helper function: current_employee_name()
create or replace function public.current_employee_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(trim(e.name), ''), nullif(trim(e.full_name), ''), e.email, 'Employee')
    from public.employees e
   where (e.user_id = auth.uid() or e.id::text = auth.uid()::text)
   limit 1;
$$;

-- 2. Ensure multi-tenant support on stage_loss_configs
alter table public.stage_loss_configs
  add column if not exists organization_id uuid references public.organizations(id);

create index if not exists idx_stage_loss_configs_tenant_stage
  on public.stage_loss_configs (organization_id, stage_order);

-- Seed authoritative factory stage loss tolerances for Goldia
insert into public.stage_loss_configs (stage_order, stage_name, department, max_loss_pct, max_loss_gram, organization_id)
values
  (8,  '8. Quyish',            'Quyish',   1.000, 0.8000, '00000000-0000-0000-0000-000000000001'::uuid),
  (10, '10. Yig''uv',          'Yig''uv',  0.500, 0.3000, '00000000-0000-0000-0000-000000000001'::uuid),
  (11, '11. Shlifovka',        'Shlifovka',1.500, 0.8000, '00000000-0000-0000-0000-000000000001'::uuid),
  (12, '12. Fiksaj',           'Fiksaj',   0.500, 0.3000, '00000000-0000-0000-0000-000000000001'::uuid),
  (14, '14. Zakrepka',         'Zakrepka', 0.800, 0.5000, '00000000-0000-0000-0000-000000000001'::uuid),
  (15, '15. Magnit',           'Magnit',   0.300, 0.2000, '00000000-0000-0000-0000-000000000001'::uuid),
  (16, '16. Jilolash',         'Jilolash', 2.500, 1.5000, '00000000-0000-0000-0000-000000000001'::uuid),
  (17, '17. Yuvish',           'Yuvish',   0.200, 0.1000, '00000000-0000-0000-0000-000000000001'::uuid),
  (18, '18. Rodiy',            'Rodiy',    0.200, 0.1000, '00000000-0000-0000-0000-000000000001'::uuid),
  (20, '20. Lazer markalash',  'Lazer',    0.100, 0.0500, '00000000-0000-0000-0000-000000000001'::uuid),
  (22, '22. Sifat nazorati',   'Sifat',    0.000, 0.0000, '00000000-0000-0000-0000-000000000001'::uuid)
on conflict (stage_order) do update set
  stage_name    = excluded.stage_name,
  department    = excluded.department,
  max_loss_pct  = excluded.max_loss_pct,
  max_loss_gram = excluded.max_loss_gram,
  organization_id = coalesce(public.stage_loss_configs.organization_id, excluded.organization_id);

-- Strict RLS for stage_loss_configs
alter table public.stage_loss_configs enable row level security;

drop policy if exists "stage_loss_configs_tenant_select" on public.stage_loss_configs;
drop policy if exists "stage_loss_configs_tenant_manage" on public.stage_loss_configs;

create policy "stage_loss_configs_tenant_select"
  on public.stage_loss_configs for select to authenticated
  using (
    organization_id = public.current_organization_id()
    or organization_id is null
  );

create policy "stage_loss_configs_tenant_manage"
  on public.stage_loss_configs for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager')
  );

-- 3. Drop legacy 15-parameter signature of rpc_move_partial_wip
drop function if exists public.rpc_move_partial_wip(
  text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text
);

-- 4. Server-Side Stage Loss Enforcement in rpc_move_partial_wip (17-parameter signature)
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
  v_is_final          boolean := (p_to_stage_order >= 25);
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
  v_caller_role       text := public.current_employee_role_text();
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  v_payload := jsonb_build_object(
    'batch_id', btrim(coalesce(p_batch_id, '')),
    'from_stage_order', p_from_stage_order,
    'to_stage_order', p_to_stage_order,
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
  -- SERVER-SIDE LOSS VALIDATION (Database Enforcement Gate)
  -- --------------------------------------------------------------------------
  if v_loss_g > 0 then
    v_proc_weight := (v_move_g + v_loss_g + v_sprue_g + v_scrap_g);

    -- Fetch configured threshold for this stage and organization
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

    -- If loss exceeds allowable limits, evaluate override authorization
    if v_loss_g > v_effective_limit and (v_proc_weight = 0 or v_loss_pct > v_max_loss_pct) then
      v_excess_loss_g := round((v_loss_g - v_effective_limit)::numeric, 4);

      if not coalesce(p_allow_excess_loss, false) then
        raise exception 'EXCESSIVE_LOSS_DETECTED: Stage % loss (%g, %s%%) exceeds allowable threshold (%g, %s%%). Manager override required.',
          p_from_stage_order, v_loss_g, v_loss_pct, v_effective_limit, v_max_loss_pct
          using errcode = 'P0001';
      end if;

      -- Caller must have manager/director role to approve excess loss override
      if v_caller_role not in (
        'admin', 'director', 'owner', 'direktor', 'rahbar',
        'manager', 'production_manager', 'production manager',
        'bosh usta', 'supervisor', 'master'
      ) then
        raise exception 'Permission denied: Operator role "%" cannot authorize excessive stage loss override (+%sg)',
          v_caller_role, v_excess_loss_g using errcode = '42501';
      end if;

      -- Record audit event for manager override
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

  v_new_wip_g := round(greatest(0, v_in_gold - v_tot_out)::numeric, 4);

  update public.batch_stage_wip
     set available_qty = v_rem_qty,
         completed_qty = coalesce(completed_qty, 0) + p_move_qty,
         rework_qty    = coalesce(rework_qty, 0) + p_rework_qty,
         loss_weight   = coalesce(loss_weight, 0) + v_loss_g,
         updated_at    = now()
   where id = v_cur_wip.id;

  if p_move_qty > 0 and not v_is_final then
    select * into v_nxt_wip
      from public.batch_stage_wip
     where (batch_id = btrim(p_batch_id) or batch_no = v_batch_code)
       and stage_order = p_to_stage_order
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
        btrim(p_batch_id), v_batch_code, p_to_stage_order, btrim(p_to_stage_name), btrim(p_to_department),
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
         current_step          = case when v_done_all then '25. Tayyor ombor' else btrim(p_to_stage_name) end,
         status                = case when v_done_all then 'Tugatildi' else 'Jarayonda' end,
         status_label          = case when v_done_all then 'Tugatildi' else 'Jarayonda' end,
         updated_at            = now()
   where id = v_batch.id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch.id::text,
    'batch_no', v_batch_code,
    'from_stage_order', p_from_stage_order,
    'to_stage_order', p_to_stage_order,
    'moved_qty', p_move_qty,
    'moved_weight', v_move_g,
    'rework_qty', p_rework_qty,
    'loss_gram', v_loss_g,
    'wip_remaining_gram', v_new_wip_g,
    'finished_qty', v_new_fin_qty,
    'is_completed', v_done_all,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_move_partial_wip', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 5. Atomic Machine Station Concurrency Lock RPCs
create or replace function public.rpc_assign_machine_station(
  p_machine_id    text,
  p_batch_no      text,
  p_operator_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_machine    public.machines%rowtype;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_operator'
  ]);

  -- Atomic update with concurrency guard: only succeed if machine is IDLE/ACTIVE and not occupied
  update public.machines
     set current_batch = btrim(p_batch_no),
         status        = 'BUSY',
         updated_at    = now()
   where id::text = btrim(p_machine_id)
     and organization_id = v_caller_org
     and status in ('ACTIVE', 'IDLE')
     and (current_batch is null or btrim(current_batch) = '')
  returning * into v_machine;

  if not found then
    -- Check if machine exists under this tenant
    select * into v_machine from public.machines where id::text = btrim(p_machine_id);
    if not found then
      raise exception 'Machine station (%) not found', p_machine_id;
    end if;
    if v_machine.organization_id is distinct from v_caller_org then
      raise exception 'Cross-tenant violation: Machine station does not belong to your organization' using errcode = '42501';
    end if;
    raise exception 'Machine station "%" is already occupied by batch "%" or is in status "%"',
      v_machine.name, coalesce(v_machine.current_batch, 'None'), v_machine.status;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'machine_id', v_machine.id::text,
    'machine_name', v_machine.name,
    'current_batch', v_machine.current_batch,
    'machine_status', v_machine.status,
    'assigned_operator', btrim(coalesce(p_operator_name, public.current_employee_name())),
    'organization_id', v_caller_org
  );
end;
$$;

create or replace function public.rpc_release_machine_station(
  p_machine_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_machine    public.machines%rowtype;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_operator'
  ]);

  update public.machines
     set current_batch = null,
         status        = 'IDLE',
         updated_at    = now()
   where id::text = btrim(p_machine_id)
     and organization_id = v_caller_org
  returning * into v_machine;

  if not found then
    select * into v_machine from public.machines where id::text = btrim(p_machine_id);
    if not found then
      raise exception 'Machine station (%) not found', p_machine_id;
    end if;
    if v_machine.organization_id is distinct from v_caller_org then
      raise exception 'Cross-tenant violation: Machine station does not belong to your organization' using errcode = '42501';
    end if;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'machine_id', v_machine.id::text,
    'machine_name', v_machine.name,
    'machine_status', 'IDLE',
    'current_batch', null,
    'organization_id', v_caller_org
  );
end;
$$;

-- 6. Grant & Revoke Privileges
revoke execute on function public.rpc_move_partial_wip(text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text, boolean, text) from public, anon;
grant execute on function public.rpc_move_partial_wip(text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text, boolean, text) to authenticated;

revoke execute on function public.rpc_assign_machine_station(text, text, text) from public, anon;
grant execute on function public.rpc_assign_machine_station(text, text, text) to authenticated;

revoke execute on function public.rpc_release_machine_station(text) from public, anon;
grant execute on function public.rpc_release_machine_station(text) to authenticated;
