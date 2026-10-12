-- ============================================================================
-- Migration: 20260101000016_atomic_erp_rpcs.sql
-- Purpose:   Authoritative atomic PostgreSQL RPC functions for all JewelryFlow
--            ERP financial, gold-accounting, inventory, manufacturing, sales,
--            debt-repayment, BOM, and payroll operations.
-- ============================================================================

-- Helper: Authoritative Fine Gold Calculation (exact 6-decimal precision)
create or replace function public.calc_fine_gold_exact(
  p_gross_weight numeric,
  p_proba        numeric
)
returns numeric(18, 6)
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case
    when p_gross_weight <= 0 or p_proba <= 0 or p_proba > 1000 then 0::numeric(18, 6)
    else round((p_gross_weight::numeric(18, 6) * p_proba::numeric(18, 6)) / 1000.0, 6)
  end;
$$;

-- Helper: Resolve active caller's employee.id (returns NULL if unauthenticated or no active employee row)
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id
    from public.employees e
   where (e.id = auth.uid() or e.user_id = auth.uid())
     and coalesce(e.is_active, true) = true
     and lower(coalesce(e.status, e.employment_status::text, 'active')) in ('active', 'faol')
   limit 1;
$$;

-- Helper: Resolve active caller's normalized role text across both enum (`role`) and operational (`role_type`) schemas
create or replace function public.current_employee_role_text()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_emp  public.employees%rowtype;
  v_role text;
begin
  if v_uid is null then
    return null;
  end if;

  select *
    into v_emp
    from public.employees e
   where (e.id = v_uid or e.user_id = v_uid)
     and coalesce(e.is_active, true) = true
     and lower(coalesce(e.status, e.employment_status::text, 'active')) in ('active', 'faol')
   limit 1;

  if not found then
    return 'viewer';
  end if;

  -- Prefer specific operational role_type when enum role is left at default 'department_operator'
  if v_emp.role is not null and v_emp.role::text <> 'department_operator' then
    v_role := lower(trim(v_emp.role::text));
  elsif coalesce(trim(v_emp.role_type), '') <> '' then
    v_role := lower(trim(v_emp.role_type));
  elsif coalesce(trim(v_emp.position), '') <> '' then
    v_role := lower(trim(v_emp.position));
  else
    v_role := lower(coalesce(v_emp.role::text, 'viewer'));
  end if;

  return coalesce(v_role, 'viewer');
end;
$$;

-- Helper: Check role permissions for authenticated sessions
create or replace function public.assert_erp_permission(
  p_allowed_roles text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_emp        public.employees%rowtype;
  v_role_enum  text;
  v_role_type  text;
  v_position   text;
  v_norm_role  text;
begin
  -- If an authenticated session is active, enforce employee role check
  if v_uid is not null then
    select *
      into v_emp
      from public.employees e
     where (e.id = v_uid or e.user_id = v_uid)
       and coalesce(e.is_active, true) = true
       and lower(coalesce(e.status, e.employment_status::text, 'active')) in ('active', 'faol')
     limit 1;

    if not found then
      raise exception 'Permission denied: no active employee profile for current user'
        using errcode = '42501';
    end if;

    v_role_enum := lower(coalesce(v_emp.role::text, ''));
    v_role_type := lower(coalesce(trim(v_emp.role_type), ''));
    v_position  := lower(coalesce(trim(v_emp.position), ''));
    v_norm_role := coalesce(public.current_employee_role_text(), 'viewer');

    if not (
      v_role_enum = any(p_allowed_roles)
      or v_role_type = any(p_allowed_roles)
      or v_position = any(p_allowed_roles)
      or v_norm_role = any(p_allowed_roles)
    ) then
      raise exception 'Permission denied for role "%" (required one of: %)',
        coalesce(nullif(v_role_type, ''), nullif(v_role_enum, ''), 'unassigned'),
        array_to_string(p_allowed_roles, ', ')
        using errcode = '42501';
    end if;
  end if;
end;
$$;

-- ============================================================================
-- 1. RPC: Atomic Inventory & Reservation Transaction
-- ============================================================================
create or replace function public.rpc_inventory_transaction(
  p_item_id         uuid,
  p_tx_type         text,
  p_weight          numeric,
  p_proba           numeric default 0,
  p_pure_gold       numeric default 0,
  p_from_location   text default 'SAFE',
  p_to_location     text default 'WIP',
  p_description     text default '',
  p_order_id        uuid default null,
  p_order_no        text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item      public.inventory_items%rowtype;
  v_on_hand   numeric(14, 4);
  v_reserved  numeric(14, 4);
  v_avail     numeric(14, 4);
  v_weight    numeric(14, 4) := round(coalesce(p_weight, 0)::numeric, 4);
  v_fine      numeric(18, 6);
  v_existing  jsonb;
  v_res_row   public.inventory_reservations%rowtype;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi',
    'inventory_manager', 'manager', 'production_manager', 'production manager'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if v_weight <= 0 then
    raise exception 'Transaction weight must be greater than 0';
  end if;

  select * into v_item
    from public.inventory_items
   where id = p_item_id
     for update;

  if not found then
    raise exception 'Inventory item (%) not found', p_item_id;
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
      inventory_item_id, order_id, order_no, reserved_grams, status, idempotency_key, created_by
    ) values (
      p_item_id, p_order_id, p_order_no, v_weight, 'ACTIVE', p_idempotency_key, auth.uid()
    );

    if p_order_id is not null then
      update public.orders
         set reserved_item_id = p_item_id,
             reserved_gold_gram = coalesce(reserved_gold_gram, 0) + v_weight
       where id = p_order_id;
    end if;
  elsif p_tx_type = 'unreserve' then
    if v_weight > v_reserved then
      raise exception 'Cannot unreserve %g: only %g currently reserved', v_weight, v_reserved;
    end if;
    v_reserved := v_reserved - v_weight;

    if p_order_id is not null then
      select * into v_res_row
        from public.inventory_reservations
       where inventory_item_id = p_item_id
         and order_id = p_order_id
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
       where id = p_order_id;
    end if;
  else
    raise exception 'Unsupported inventory transaction type: %', p_tx_type;
  end if;

  update public.inventory_items
     set on_hand = v_on_hand,
         quantity_on_hand = v_on_hand,
         reserved = v_reserved
   where id = p_item_id;

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, description, idempotency_key, performed_by
  ) values (
    p_tx_type, p_from_location, p_to_location, v_item.name,
    v_weight, v_weight, coalesce(nullif(p_proba, 0), v_item.proba, 0), v_fine,
    p_description, p_idempotency_key, public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'item_id', p_item_id,
    'on_hand', v_on_hand,
    'reserved', v_reserved,
    'available', v_on_hand - v_reserved
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_inventory_transaction', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 2. RPC: Atomic Alloy Transaction (Down-Alloying & Up-Alloying)
-- ============================================================================
create or replace function public.rpc_execute_alloy_transaction(
  p_source_item_id     uuid,
  p_target_item_id     uuid,
  p_input_weight       numeric,
  p_source_proba       numeric,
  p_target_proba       numeric,
  p_ligature_weight    numeric default 0,
  p_fine_gold_added    numeric default 0,
  p_output_weight      numeric default 0,
  p_pure_gold          numeric default 0,
  p_fine_gold_item_id  uuid default null,
  p_silver_item_id     uuid default null,
  p_silver_weight      numeric default 0,
  p_copper_item_id     uuid default null,
  p_copper_weight      numeric default 0,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
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
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi',
    'inventory_manager', 'manager', 'production_manager', 'production manager'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if v_in_w <= 0 or p_source_proba <= 0 or p_target_proba <= 0 or p_source_proba = p_target_proba then
    raise exception 'Invalid alloy parameters';
  end if;

  if p_source_item_id = p_target_item_id then
    raise exception 'Source and target inventory items must be distinct';
  end if;

  select * into v_src from public.inventory_items where id = p_source_item_id for update;
  if not found then
    raise exception 'Source gold item not found';
  end if;

  if (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)) < v_in_w then
    raise exception 'Insufficient available source gold: available=%g, required=%g',
      (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)), v_in_w;
  end if;

  select * into v_tar from public.inventory_items where id = p_target_item_id for update;
  if not found then
    raise exception 'Target alloy gold item not found';
  end if;

  -- Up-alloying: consume additional 999 fine gold item
  if v_fine_add_w > 0 then
    if p_fine_gold_item_id is not null then
      select * into v_fine_item from public.inventory_items where id = p_fine_gold_item_id for update;
    else
      select * into v_fine_item
        from public.inventory_items
       where category = 'Gold' and proba = 999 and id <> p_source_item_id
       order by on_hand desc
       limit 1
         for update;
    end if;

    if not found or (coalesce(v_fine_item.on_hand, v_fine_item.quantity_on_hand, 0) - coalesce(v_fine_item.reserved, 0)) < v_fine_add_w then
      raise exception 'Insufficient 999 fine gold for up-alloying (required=%g)', v_fine_add_w;
    end if;

    update public.inventory_items
       set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_fine_add_w,
           quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_fine_add_w
     where id = v_fine_item.id;
  end if;

  -- Silver & copper ligature deduction when tracked in inventory_items
  if p_silver_item_id is not null and v_silver_w > 0 then
    select * into v_silver_item from public.inventory_items where id = p_silver_item_id for update;
    if not found or (coalesce(v_silver_item.on_hand, v_silver_item.quantity_on_hand, 0) - coalesce(v_silver_item.reserved, 0)) < v_silver_w then
      raise exception 'Insufficient silver ligature in inventory (required=%g)', v_silver_w;
    end if;
    update public.inventory_items
       set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_silver_w,
           quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_silver_w
     where id = v_silver_item.id;
  end if;

  if p_copper_item_id is not null and v_copper_w > 0 then
    select * into v_copper_item from public.inventory_items where id = p_copper_item_id for update;
    if not found or (coalesce(v_copper_item.on_hand, v_copper_item.quantity_on_hand, 0) - coalesce(v_copper_item.reserved, 0)) < v_copper_w then
      raise exception 'Insufficient copper ligature in inventory (required=%g)', v_copper_w;
    end if;
    update public.inventory_items
       set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_copper_w,
           quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_copper_w
     where id = v_copper_item.id;
  end if;

  -- Deduct source gold and credit target alloy gold
  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_in_w,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_in_w
   where id = p_source_item_id;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_out_w,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_out_w
   where id = p_target_item_id;

  v_pure_gold := public.calc_fine_gold_exact(v_out_w, p_target_proba);

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, description, idempotency_key, performed_by
  ) values (
    'qotishma',
    'SAFE (' || p_source_proba || ')',
    'SAFE (' || p_target_proba || ')',
    v_tar.name,
    v_out_w,
    v_out_w,
    p_target_proba,
    v_pure_gold,
    format('Alloy: %sg (%s) + ligature %sg + fine999 %sg -> %sg (%s)',
      v_in_w, p_source_proba, v_lig_w, v_fine_add_w, v_out_w, p_target_proba),
    p_idempotency_key,
    public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'source_item_id', p_source_item_id,
    'target_item_id', p_target_item_id,
    'input_weight', v_in_w,
    'fine_gold_added', v_fine_add_w,
    'ligature_weight', v_lig_w,
    'output_weight', v_out_w,
    'pure_gold', v_pure_gold
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_execute_alloy_transaction', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 3. RPC: Atomic Refining (Affinaj) Transaction
-- ============================================================================
create or replace function public.rpc_execute_affinaj_transaction(
  p_scrap_item_id       uuid,
  p_target_gold_item_id uuid,
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
  v_scrap     public.inventory_items%rowtype;
  v_target    public.inventory_items%rowtype;
  v_sc_w      numeric(14, 4) := round(coalesce(p_scrap_weight, 0)::numeric, 4);
  v_out_w     numeric(14, 4) := round(coalesce(p_output_weight, 0)::numeric, 4);
  v_exp_fine  numeric(18, 6);
  v_act_fine  numeric(18, 6);
  v_loss_fine numeric(18, 6);
  v_existing  jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi',
    'inventory_manager', 'manager', 'production_manager', 'production manager'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if v_sc_w <= 0 or v_out_w <= 0 or v_out_w > v_sc_w then
    raise exception 'Invalid refining weights: scrap=%g, output=%g', v_sc_w, v_out_w;
  end if;

  v_exp_fine := public.calc_fine_gold_exact(v_sc_w, p_estimated_proba);
  v_act_fine := public.calc_fine_gold_exact(v_out_w, p_output_proba);
  if v_act_fine > v_exp_fine + 0.01 then
    raise exception 'Refined fine gold (%g) cannot exceed expected fine gold in scrap (%g)', v_act_fine, v_exp_fine;
  end if;
  v_loss_fine := greatest(0, v_exp_fine - v_act_fine);

  select * into v_scrap from public.inventory_items where id = p_scrap_item_id for update;
  if not found then
    raise exception 'Scrap inventory item not found';
  end if;

  if (coalesce(v_scrap.on_hand, v_scrap.quantity_on_hand, 0) - coalesce(v_scrap.reserved, 0)) < v_sc_w then
    raise exception 'Insufficient available scrap: available=%g, requested=%g',
      (coalesce(v_scrap.on_hand, v_scrap.quantity_on_hand, 0) - coalesce(v_scrap.reserved, 0)), v_sc_w;
  end if;

  select * into v_target from public.inventory_items where id = p_target_gold_item_id for update;
  if not found then
    raise exception 'Target 999 gold item not found';
  end if;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_sc_w,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_sc_w
   where id = p_scrap_item_id;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_out_w,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_out_w
   where id = p_target_gold_item_id;

  insert into public.affinaj_records (
    scrap_item_id, target_gold_item_id, scrap_weight, estimated_proba,
    output_weight, output_proba, expected_fine, actual_fine, refining_loss,
    master_name, idempotency_key, performed_by
  ) values (
    p_scrap_item_id, p_target_gold_item_id, v_sc_w, p_estimated_proba,
    v_out_w, p_output_proba, v_exp_fine, v_act_fine, round(v_loss_fine, 4),
    p_master_name, p_idempotency_key, public.current_employee_id()
  );

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, description, idempotency_key, performed_by
  ) values (
    'affinaj', 'SCRAP', 'SAFE', v_target.name,
    v_out_w, v_out_w, p_output_proba, v_act_fine,
    format('Affinaj (%s): %sg scrap (%s) -> %sg (%s), loss=%sg',
      p_master_name, v_sc_w, p_estimated_proba, v_out_w, p_output_proba, round(v_loss_fine, 4)),
    p_idempotency_key, public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'scrap_deducted', v_sc_w,
    'gold_credited', v_out_w,
    'expected_fine', v_exp_fine,
    'actual_fine', v_act_fine,
    'refining_loss', round(v_loss_fine, 4)
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_execute_affinaj_transaction', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 4. RPC: Create Batch With Gold Issue
-- ============================================================================
create or replace function public.rpc_create_batch_with_gold_issue(
  p_source_item_id   uuid,
  p_batch_no         text,
  p_product_name     text,
  p_master_name      text,
  p_proba            numeric,
  p_planned_qty      integer,
  p_issued_gold_gram numeric,
  p_pure_gold        numeric,
  p_priority         text default 'Normal',
  p_deadline         date default null,
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src       public.inventory_items%rowtype;
  v_batch_id  uuid;
  v_issued    numeric(14, 4) := round(coalesce(p_issued_gold_gram, 0)::numeric, 4);
  v_fine      numeric(18, 6);
  v_existing  jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if coalesce(trim(p_batch_no), '') = '' or p_planned_qty <= 0 or v_issued <= 0 then
    raise exception 'Invalid batch parameters';
  end if;

  select * into v_src from public.inventory_items where id = p_source_item_id for update;
  if not found then
    raise exception 'Source gold item not found';
  end if;

  if (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)) < v_issued then
    raise exception 'Insufficient available gold in SAFE: available=%g, required=%g',
      (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)), v_issued;
  end if;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_issued,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_issued
   where id = p_source_item_id;

  v_fine := public.calc_fine_gold_exact(v_issued, p_proba);

  insert into public.batches (
    batch_number, batch_no, number, product_name, product, master_name,
    proba, planned_qty, planned_gram, issued_gold_gram, wip_gram,
    good_output_gram, sprue_gram, scrap_gram, rework_gram, loss_gram,
    finished_qty, credited_finished_qty, current_step, status_label, priority_label, deadline, due_date
  ) values (
    trim(p_batch_no), trim(p_batch_no), trim(p_batch_no), trim(p_product_name), trim(p_product_name), trim(p_master_name),
    p_proba, p_planned_qty, v_issued, v_issued, v_issued,
    0, 0, 0, 0, 0,
    0, 0, '8. Quyish', 'Jarayonda', p_priority, p_deadline, p_deadline
  ) returning id into v_batch_id;

  insert into public.batch_stage_wip (
    batch_id, batch_no, stage_order, stage_name, department,
    available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
    queue_status, assigned_worker
  ) values (
    v_batch_id, trim(p_batch_no), 8, '8. Quyish', 'Quyish',
    p_planned_qty, 0, 0, v_issued, 0, 0,
    'NOW', trim(p_master_name)
  );

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, batch_no, description, idempotency_key, performed_by
  ) values (
    'chiqim', 'SAFE', 'CASTING', v_src.name,
    v_issued, v_issued, p_proba, v_fine, trim(p_batch_no),
    format('Batch %s issue: %s pcs / %sg (%s)', trim(p_batch_no), p_planned_qty, v_issued, p_proba),
    p_idempotency_key, public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch_id,
    'batch_no', trim(p_batch_no),
    'issued_gold_gram', v_issued,
    'pure_gold', v_fine
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_create_batch_with_gold_issue', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 5. RPC: Launch Order Production Chain (Supports Order-Reserved Gold)
-- ============================================================================
create or replace function public.rpc_launch_order_production_chain(
  p_order_id         uuid,
  p_source_item_id   uuid,
  p_batch_no         text,
  p_product_name     text,
  p_client_name      text,
  p_master_name      text,
  p_proba            numeric,
  p_planned_qty      integer,
  p_issued_gold_gram numeric,
  p_pure_gold        numeric,
  p_priority         text default 'Normal',
  p_deadline         date default null,
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ord          public.orders%rowtype;
  v_src          public.inventory_items%rowtype;
  v_issued       numeric(14, 4) := round(coalesce(p_issued_gold_gram, 0)::numeric, 4);
  v_from_res     numeric(14, 4) := 0;
  v_from_avail   numeric(14, 4) := 0;
  v_avail        numeric(14, 4);
  v_batch_id     uuid;
  v_fine         numeric(18, 6);
  v_existing     jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_ord from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order (%) not found', p_order_id;
  end if;

  if coalesce(v_ord.batch_created, false) then
    raise exception 'Production batch has already been created for order %', coalesce(v_ord.order_no, p_order_id::text);
  end if;

  select * into v_src from public.inventory_items where id = p_source_item_id for update;
  if not found then
    raise exception 'Source gold item not found';
  end if;

  -- Consume gold reserved specifically for this order first, then draw remainder from available
  if v_ord.reserved_item_id = p_source_item_id and coalesce(v_ord.reserved_gold_gram, 0) > 0 then
    v_from_res := least(v_issued, coalesce(v_ord.reserved_gold_gram, 0), coalesce(v_src.reserved, 0));
  end if;
  v_from_avail := v_issued - v_from_res;
  v_avail := coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0);

  if v_from_avail > v_avail then
    raise exception 'Insufficient available gold for order: needed=%g (after %g reserved), available=%g',
      v_from_avail, v_from_res, v_avail;
  end if;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_issued,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_issued,
         reserved = coalesce(reserved, 0) - v_from_res
   where id = p_source_item_id;

  if v_from_res > 0 then
    update public.inventory_reservations
       set consumed_grams = consumed_grams + v_from_res,
           status = case
             when consumed_grams + released_grams + v_from_res >= reserved_grams then 'CONSUMED'
             else 'ACTIVE'
           end,
           batch_no = trim(p_batch_no),
           updated_at = now()
     where order_id = p_order_id
       and inventory_item_id = p_source_item_id
       and status = 'ACTIVE';
  end if;

  update public.orders
     set batch_created = true,
         status_label = 'Ishlab chiqarishda',
         reserved_gold_gram = greatest(0, coalesce(reserved_gold_gram, 0) - v_from_res)
   where id = p_order_id;

  v_fine := public.calc_fine_gold_exact(v_issued, p_proba);

  insert into public.batches (
    order_id, batch_number, batch_no, number, product_name, product,
    client_name, master_name, proba, planned_qty, planned_gram,
    issued_gold_gram, wip_gram, good_output_gram, sprue_gram, scrap_gram,
    rework_gram, loss_gram, finished_qty, credited_finished_qty,
    current_step, status_label, priority_label, deadline, due_date
  ) values (
    p_order_id, trim(p_batch_no), trim(p_batch_no), trim(p_batch_no), trim(p_product_name), trim(p_product_name),
    trim(p_client_name), trim(p_master_name), p_proba, p_planned_qty, v_issued,
    v_issued, v_issued, 0, 0, 0,
    0, 0, 0, 0,
    '8. Quyish', 'Jarayonda', p_priority, p_deadline, p_deadline
  ) returning id into v_batch_id;

  insert into public.batch_stage_wip (
    batch_id, batch_no, stage_order, stage_name, department,
    available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
    queue_status, assigned_worker
  ) values (
    v_batch_id, trim(p_batch_no), 8, '8. Quyish', 'Quyish',
    p_planned_qty, 0, 0, v_issued, 0, 0,
    'NOW', trim(p_master_name)
  );

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, batch_no, description, idempotency_key, performed_by
  ) values (
    'chiqim', 'SAFE', 'CASTING', v_src.name,
    v_issued, v_issued, p_proba, v_fine, trim(p_batch_no),
    format('Order %s -> Batch %s (%s pcs / %sg, reserved_used=%sg)',
      coalesce(v_ord.order_no, p_order_id::text), trim(p_batch_no), p_planned_qty, v_issued, v_from_res),
    p_idempotency_key, public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'order_id', p_order_id,
    'batch_id', v_batch_id,
    'batch_no', trim(p_batch_no),
    'issued_gold_gram', v_issued,
    'reserved_consumed_gram', v_from_res
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_launch_order_production_chain', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 6. RPC: Atomic Partial WIP Movement & Final Stage Finished-Goods Stock Credit
-- ============================================================================
create or replace function public.rpc_move_partial_wip(
  p_batch_id          uuid,
  p_from_stage_order  integer,
  p_to_stage_order    integer,
  p_to_stage_name     text,
  p_to_department     text,
  p_move_qty          integer,
  p_move_gram         numeric default null,
  p_move_weight       numeric default null,
  p_rework_qty        integer default 0,
  p_sprue_gram        numeric default 0,
  p_scrap_gram        numeric default 0,
  p_loss_gram         numeric default 0,
  p_worker_name       text default '',
  p_worker_id         uuid default null,
  p_idempotency_key   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch       public.batches%rowtype;
  v_cur_wip     public.batch_stage_wip%rowtype;
  v_nxt_wip     public.batch_stage_wip%rowtype;
  v_prod        public.products%rowtype;
  v_batch_code  text;
  v_rem_qty     integer;
  v_move_g      numeric(14, 4) := round(coalesce(p_move_weight, p_move_gram, 0)::numeric, 4);
  v_sprue_g     numeric(14, 4) := round(coalesce(p_sprue_gram, 0)::numeric, 4);
  v_scrap_g     numeric(14, 4) := round(coalesce(p_scrap_gram, 0)::numeric, 4);
  v_loss_g      numeric(14, 4) := round(coalesce(p_loss_gram, 0)::numeric, 4);
  v_new_sprue   numeric(14, 4);
  v_new_scrap   numeric(14, 4);
  v_new_loss    numeric(14, 4);
  v_new_good    numeric(14, 4);
  v_in_gold     numeric(14, 4);
  v_tot_out     numeric(14, 4);
  v_new_wip_g   numeric(14, 4);
  v_is_final    boolean := (p_to_stage_order >= 25);
  v_new_fin_qty integer;
  v_credit_qty  integer := 0;
  v_done_all    boolean;
  v_existing    jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if p_move_qty < 0 or p_rework_qty < 0 or v_move_g < 0 or v_sprue_g < 0 or v_scrap_g < 0 or v_loss_g < 0 then
    raise exception 'Negative quantities or weights are not permitted';
  end if;
  if p_move_qty <= 0 and p_rework_qty <= 0 then
    raise exception 'Either moved quantity or rework quantity must be greater than 0';
  end if;

  select * into v_batch from public.batches where id = p_batch_id for update;
  if not found then
    raise exception 'Batch (%) not found', p_batch_id;
  end if;
  v_batch_code := coalesce(v_batch.batch_no, v_batch.number, v_batch.batch_number);

  select * into v_cur_wip
    from public.batch_stage_wip
   where batch_no = v_batch_code
     and stage_order = p_from_stage_order
     for update;

  if not found then
    raise exception 'Active WIP record not found for batch % at stage %', v_batch_code, p_from_stage_order;
  end if;

  if (p_move_qty + p_rework_qty) > v_cur_wip.available_qty then
    raise exception 'Insufficient stage WIP quantity: available=%, requested=%',
      v_cur_wip.available_qty, (p_move_qty + p_rework_qty);
  end if;

  v_rem_qty   := v_cur_wip.available_qty - p_move_qty - p_rework_qty;
  v_new_sprue := round(coalesce(v_batch.sprue_gram, 0) + v_sprue_g, 4);
  v_new_scrap := round(coalesce(v_batch.scrap_gram, 0) + v_scrap_g, 4);
  v_new_loss  := round(coalesce(v_batch.loss_gram, 0) + v_loss_g, 4);
  v_new_good  := case
    when v_is_final then round(coalesce(v_batch.good_output_gram, 0) + v_move_g, 4)
    else round(coalesce(v_batch.good_output_gram, 0), 4)
  end;

  v_in_gold := round(coalesce(v_batch.issued_gold_gram, v_batch.planned_gram, 0), 4);
  v_tot_out := round(v_new_good + v_new_sprue + v_new_scrap + v_new_loss, 4);

  if v_in_gold <= 0 or v_tot_out > v_in_gold + 0.05 then
    raise exception 'Mass balance violation: total accounted output/losses (%g) exceeds issued gold (%g)',
      v_tot_out, v_in_gold;
  end if;

  v_new_wip_g   := greatest(0, round(v_in_gold - v_tot_out, 4));
  v_new_fin_qty := case
    when v_is_final then coalesce(v_batch.finished_qty, 0) + p_move_qty
    else coalesce(v_batch.finished_qty, 0)
  end;
  v_done_all := (coalesce(v_batch.planned_qty, 0) > 0 and v_new_fin_qty >= v_batch.planned_qty and v_new_wip_g <= 0.05);

  -- 1. Update current stage WIP
  update public.batch_stage_wip
     set available_qty = v_rem_qty,
         completed_qty = coalesce(completed_qty, 0) + p_move_qty,
         rework_qty    = coalesce(rework_qty, 0) + p_rework_qty,
         output_weight = round(coalesce(output_weight, 0) + v_move_g, 4),
         loss_weight   = round(coalesce(loss_weight, 0) + v_loss_g, 4),
         queue_status  = case when v_rem_qty = 0 then 'DONE' else 'NOW' end,
         updated_at    = now()
   where id = v_cur_wip.id;

  -- 2. Advance moved units to next stage WIP
  if p_move_qty > 0 then
    select * into v_nxt_wip
      from public.batch_stage_wip
     where batch_no = v_batch_code
       and stage_order = p_to_stage_order
       for update;

    if found then
      update public.batch_stage_wip
         set available_qty        = coalesce(available_qty, 0) + p_move_qty,
             input_weight         = round(coalesce(input_weight, 0) + v_move_g, 4),
             queue_status         = 'NOW',
             assigned_worker      = coalesce(nullif(trim(p_worker_name), ''), assigned_worker),
             assigned_employee_id = coalesce(p_worker_id, assigned_employee_id),
             updated_at           = now()
       where id = v_nxt_wip.id;
    else
      insert into public.batch_stage_wip (
        batch_id, batch_no, stage_order, stage_name, department,
        available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
        queue_status, assigned_worker, assigned_employee_id
      ) values (
        p_batch_id, v_batch_code, p_to_stage_order, p_to_stage_name, p_to_department,
        p_move_qty, 0, 0, v_move_g, 0, 0,
        'NOW', p_worker_name, p_worker_id
      );
    end if;
  end if;

  -- 3. Credit finished goods stock exactly once when reaching final stage (>= 25)
  if v_is_final and p_move_qty > 0 then
    v_credit_qty := greatest(0, v_new_fin_qty - coalesce(v_batch.credited_finished_qty, 0));
    if v_credit_qty > 0 then
      select * into v_prod
        from public.products
       where (v_batch.product_id is not null and id = v_batch.product_id)
          or lower(trim(name)) = lower(trim(coalesce(v_batch.product_name, v_batch.product, '')))
       limit 1
         for update;

      if found then
        update public.products
           set stock      = coalesce(stock, 0) + v_credit_qty,
               quantity   = coalesce(quantity, 0) + v_credit_qty,
               updated_at = now()
         where id = v_prod.id;
      end if;
    end if;
  end if;

  -- 4. Record stage consumption/sprue/scrap/loss if any material was consumed or lost
  if (v_sprue_g > 0 or v_scrap_g > 0 or v_loss_g > 0) then
    insert into public.consumption (
      batch_id, batch_no, stage_order, master_name, master_employee_id, department, proba,
      given_weight, returned_weight, sprue_gram, scrap_gram, loss_weight, sent_to_refinery
    ) values (
      p_batch_id, v_batch_code, p_from_stage_order, p_worker_name, p_worker_id, v_cur_wip.department,
      coalesce(v_batch.proba, 585),
      round(v_move_g + v_sprue_g + v_scrap_g + v_loss_g, 4),
      v_move_g, v_sprue_g, v_scrap_g, v_loss_g, false
    );
  end if;

  -- 5. Update batch totals atomically
  update public.batches
     set current_step          = p_to_stage_name,
         sprue_gram            = v_new_sprue,
         scrap_gram            = v_new_scrap,
         loss_gram             = v_new_loss,
         good_output_gram      = v_new_good,
         wip_gram              = case when v_done_all then 0 else v_new_wip_g end,
         finished_qty          = v_new_fin_qty,
         credited_finished_qty = coalesce(credited_finished_qty, 0) + v_credit_qty,
         status                = case when v_done_all then 'completed'::public.batch_status else 'in_progress'::public.batch_status end,
         status_label          = case when v_done_all then 'Tugatildi' else 'Jarayonda' end
   where id = p_batch_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', p_batch_id,
    'batch_no', v_batch_code,
    'remaining_stage_qty', v_rem_qty,
    'new_wip_gram', case when v_done_all then 0 else v_new_wip_g end,
    'finished_qty', v_new_fin_qty,
    'credited_product_stock', v_credit_qty,
    'completed', v_done_all
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_move_partial_wip', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 7. RPC: Atomic Batch Split (Splits Parent Batch AND Stage WIP Records)
-- ============================================================================
create or replace function public.rpc_split_batch(
  p_parent_batch_id uuid,
  p_split_qty       integer,
  p_child_batch_no  text default null,
  p_stage_order     integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent      public.batches%rowtype;
  v_wip         public.batch_stage_wip%rowtype;
  v_parent_no   text;
  v_child_no    text;
  v_child_id    uuid;
  v_tot_qty     integer;
  v_rem_qty     integer;
  v_tot_gold    numeric(14, 4);
  v_cur_wip_g   numeric(14, 4);
  v_ratio       numeric(18, 8);
  v_child_gold  numeric(14, 4);
  v_parent_gold numeric(14, 4);
  v_child_wip_g numeric(14, 4);
  v_parent_wip_g numeric(14, 4);
  v_wip_in_child numeric(14, 4);
  v_wip_in_parent numeric(14, 4);
  v_idx         integer := 1;
  v_existing    jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_parent from public.batches where id = p_parent_batch_id for update;
  if not found then
    raise exception 'Parent batch (%) not found', p_parent_batch_id;
  end if;

  v_parent_no := coalesce(v_parent.batch_no, v_parent.number, v_parent.batch_number);
  v_tot_qty   := coalesce(v_parent.planned_qty, 0);
  v_tot_gold  := round(coalesce(v_parent.issued_gold_gram, v_parent.planned_gram, 0), 4);
  v_cur_wip_g := round(coalesce(v_parent.wip_gram, v_tot_gold), 4);

  if p_split_qty <= 0 or p_split_qty >= v_tot_qty or v_tot_gold <= 0 then
    raise exception 'Invalid split quantity (%) for batch % (total qty=%)', p_split_qty, v_parent_no, v_tot_qty;
  end if;

  -- Lock the active stage WIP row to split its available_qty & input_weight
  if p_stage_order is not null then
    select * into v_wip
      from public.batch_stage_wip
     where batch_no = v_parent_no and stage_order = p_stage_order
       for update;
  else
    select * into v_wip
      from public.batch_stage_wip
     where batch_no = v_parent_no and available_qty >= p_split_qty
     order by stage_order asc
     limit 1
       for update;
  end if;

  if not found or v_wip.available_qty < p_split_qty then
    raise exception 'Active stage WIP row does not have enough available units (%) to split % units',
      coalesce(v_wip.available_qty, 0), p_split_qty;
  end if;

  v_rem_qty      := v_tot_qty - p_split_qty;
  v_ratio        := p_split_qty::numeric / v_tot_qty::numeric;
  v_child_gold   := round(v_tot_gold * v_ratio, 4);
  v_parent_gold  := round(v_tot_gold - v_child_gold, 4);
  v_child_wip_g  := round(v_cur_wip_g * v_ratio, 4);
  v_parent_wip_g := round(v_cur_wip_g - v_child_wip_g, 4);

  v_wip_in_child  := round(coalesce(v_wip.input_weight, v_cur_wip_g) * (p_split_qty::numeric / v_wip.available_qty::numeric), 4);
  v_wip_in_parent := round(coalesce(v_wip.input_weight, v_cur_wip_g) - v_wip_in_child, 4);

  if coalesce(trim(p_child_batch_no), '') <> '' then
    v_child_no := trim(p_child_batch_no);
  else
    loop
      v_child_no := format('%s-S%s', v_parent_no, v_idx);
      exit when not exists (
        select 1 from public.batches
         where batch_no = v_child_no or number = v_child_no or batch_number = v_child_no
      );
      v_idx := v_idx + 1;
    end loop;
  end if;

  -- 1. Update parent batch
  update public.batches
     set planned_qty      = v_rem_qty,
         planned_gram     = v_parent_gold,
         issued_gold_gram = v_parent_gold,
         wip_gram         = v_parent_wip_g
   where id = p_parent_batch_id;

  -- 2. Create child batch
  insert into public.batches (
    order_id, batch_number, batch_no, number, parent_batch_no,
    product_id, product_name, product, client_name, master_name,
    proba, planned_qty, planned_gram, issued_gold_gram, wip_gram,
    good_output_gram, sprue_gram, scrap_gram, rework_gram, loss_gram,
    finished_qty, credited_finished_qty, current_step, status_label, priority_label, deadline, due_date
  ) values (
    v_parent.order_id, v_child_no, v_child_no, v_child_no, v_parent_no,
    v_parent.product_id, v_parent.product_name, v_parent.product, v_parent.client_name, v_parent.master_name,
    v_parent.proba, p_split_qty, v_child_gold, v_child_gold, v_child_wip_g,
    0, 0, 0, 0, 0,
    0, 0, v_wip.stage_name, 'Jarayonda', v_parent.priority_label, v_parent.deadline, v_parent.due_date
  ) returning id into v_child_id;

  -- 3. Update parent stage WIP & insert child stage WIP
  update public.batch_stage_wip
     set available_qty = v_wip.available_qty - p_split_qty,
         input_weight  = v_wip_in_parent,
         queue_status  = case when (v_wip.available_qty - p_split_qty) = 0 then 'DONE' else 'NOW' end,
         updated_at    = now()
   where id = v_wip.id;

  insert into public.batch_stage_wip (
    batch_id, batch_no, stage_order, stage_name, department,
    available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
    queue_status, assigned_worker, assigned_employee_id
  ) values (
    v_child_id, v_child_no, v_wip.stage_order, v_wip.stage_name, v_wip.department,
    p_split_qty, 0, 0, v_wip_in_child, 0, 0,
    'NOW', v_wip.assigned_worker, v_wip.assigned_employee_id
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'parent_batch_no', v_parent_no,
    'child_batch_id', v_child_id,
    'child_batch_no', v_child_no,
    'parent_qty', v_rem_qty,
    'child_qty', p_split_qty,
    'parent_gold_gram', v_parent_gold,
    'child_gold_gram', v_child_gold,
    'parent_wip_gram', v_parent_wip_g,
    'child_wip_gram', v_child_wip_g
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_split_batch', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 8. RPC: Record Stage Consumption & Return Sprue to Scrap Inventory
-- ============================================================================
create or replace function public.rpc_record_stage_consumption(
  p_batch_no        text,
  p_department      text,
  p_master_name     text,
  p_proba           numeric,
  p_given_weight    numeric,
  p_returned_weight numeric,
  p_sprue_gram      numeric default 0,
  p_scrap_gram      numeric default 0,
  p_master_id       uuid default null,
  p_sync_batch      boolean default true,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch     public.batches%rowtype;
  v_given     numeric(14, 4) := round(coalesce(p_given_weight, 0)::numeric, 4);
  v_ret       numeric(14, 4) := round(coalesce(p_returned_weight, 0)::numeric, 4);
  v_sprue     numeric(14, 4) := round(coalesce(p_sprue_gram, 0)::numeric, 4);
  v_scrap     numeric(14, 4) := round(coalesce(p_scrap_gram, 0)::numeric, 4);
  v_loss      numeric(14, 4);
  v_cons_id   uuid;
  v_existing  jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator', 'inventory_manager', 'warehouse'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if v_given <= 0 or v_ret < 0 or v_sprue < 0 or v_scrap < 0 then
    raise exception 'Invalid consumption weights';
  end if;

  v_loss := round(v_given - v_ret - v_sprue - v_scrap, 4);
  if v_loss < 0 then
    raise exception 'Returned product + sprue + scrap (%g) cannot exceed given gold (%g)',
      (v_ret + v_sprue + v_scrap), v_given;
  end if;

  select * into v_batch
    from public.batches
   where batch_no = trim(p_batch_no) or number = trim(p_batch_no) or batch_number = trim(p_batch_no)
   limit 1
     for update;

  insert into public.consumption (
    batch_id, batch_no, master_name, master_employee_id, department, proba,
    given_weight, returned_weight, sprue_gram, scrap_gram, loss_weight,
    sent_to_refinery, idempotency_key
  ) values (
    v_batch.id, trim(p_batch_no), trim(p_master_name), p_master_id, trim(p_department), p_proba,
    v_given, v_ret, v_sprue, v_scrap, v_loss,
    false, p_idempotency_key
  ) returning id into v_cons_id;

  if found and p_sync_batch then
    update public.batches
       set sprue_gram = round(coalesce(sprue_gram, 0) + v_sprue, 4),
           scrap_gram = round(coalesce(scrap_gram, 0) + v_scrap, 4),
           loss_gram  = round(coalesce(loss_gram, 0) + v_loss, 4),
           wip_gram   = greatest(0, round(coalesce(wip_gram, issued_gold_gram, 0) - v_sprue - v_scrap - v_loss, 4))
     where id = v_batch.id;
  end if;

  if v_loss > 0 then
    insert into public.gold_transactions (
      transaction_type, from_location, to_location, material_name,
      weight_grams, gross_weight, proba, pure_gold, batch_no, description, performed_by
    ) values (
      'yoqotish', 'WIP', 'LOSS', format('Pateriya (%s - %s)', trim(p_department), trim(p_batch_no)),
      v_loss, v_loss, p_proba, public.calc_fine_gold_exact(v_loss, p_proba), trim(p_batch_no),
      format('Master: %s | Given: %sg, Returned: %sg, Sprue: %sg, Scrap: %sg',
        trim(p_master_name), v_given, v_ret, v_sprue, v_scrap),
      public.current_employee_id()
    );
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'consumption_id', v_cons_id,
    'batch_no', trim(p_batch_no),
    'loss_weight', v_loss,
    'sprue_gram', v_sprue,
    'scrap_gram', v_scrap
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_record_stage_consumption', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

create or replace function public.rpc_return_sprue_to_scrap_inventory(
  p_consumption_id  uuid,
  p_scrap_item_id   uuid,
  p_batch_no        text,
  p_sprue_weight    numeric,
  p_proba           numeric,
  p_pure_gold       numeric,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cons      public.consumption%rowtype;
  v_scrap     public.inventory_items%rowtype;
  v_weight    numeric(14, 4);
  v_fine      numeric(18, 6);
  v_existing  jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi', 'inventory_manager',
    'manager', 'production_manager', 'production manager', 'master', 'supervisor', 'bosh usta', 'usta', 'department_head'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_cons from public.consumption where id = p_consumption_id for update;
  if not found then
    raise exception 'Consumption record (%) not found', p_consumption_id;
  end if;

  if v_cons.sent_to_refinery then
    raise exception 'Sprue/scrap for consumption record % has already been returned to inventory', p_consumption_id;
  end if;

  v_weight := round(coalesce(nullif(p_sprue_weight, 0), v_cons.sprue_gram + coalesce(v_cons.scrap_gram, 0)), 4);
  if v_weight <= 0 then
    raise exception 'No recoverable sprue/scrap weight to return';
  end if;

  select * into v_scrap from public.inventory_items where id = p_scrap_item_id for update;
  if not found then
    raise exception 'Target Scrap/Lom inventory item not found';
  end if;

  update public.consumption
     set sent_to_refinery = true
   where id = p_consumption_id;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_weight,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_weight
   where id = p_scrap_item_id;

  v_fine := public.calc_fine_gold_exact(v_weight, coalesce(nullif(p_proba, 0), v_cons.proba, 585));

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, batch_no, description, idempotency_key, performed_by
  ) values (
    'kirim', 'WIP_SPRUE', 'SCRAP_SAFE', v_scrap.name,
    v_weight, v_weight, coalesce(nullif(p_proba, 0), v_cons.proba, 585), v_fine,
    coalesce(p_batch_no, v_cons.batch_no),
    format('Returned sprue/scrap from %s to %s', coalesce(p_batch_no, v_cons.batch_no), v_scrap.name),
    p_idempotency_key, public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'consumption_id', p_consumption_id,
    'scrap_item_id', p_scrap_item_id,
    'returned_weight', v_weight,
    'pure_gold', v_fine
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_return_sprue_to_scrap_inventory', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 9. RPC: Record Sale With Stock Deduction & Dedicated Atomic Debt Repayment
-- ============================================================================
create or replace function public.rpc_record_sale_with_stock_deduction(
  p_product_id      uuid,
  p_client_name     text,
  p_product_name    text,
  p_quantity        integer,
  p_weight          numeric,
  p_proba           numeric,
  p_payment_type    text,
  p_paid_amount     numeric,
  p_debt_amount     numeric,
  p_order_id        uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod       public.products%rowtype;
  v_cur_stock  integer;
  v_paid       numeric(18, 2) := round(coalesce(p_paid_amount, 0)::numeric, 2);
  v_debt       numeric(18, 2) := round(coalesce(p_debt_amount, 0)::numeric, 2);
  v_sale_total numeric(18, 2) := round(v_paid + v_debt, 2);
  v_sale_id    uuid;
  v_existing   jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'accountant', 'buxgalter', 'hisobchi', 'sales', 'manager', 'production_manager', 'production manager'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if p_quantity <= 0 or v_paid < 0 or v_debt < 0 or v_sale_total <= 0 then
    raise exception 'Invalid sale quantity or amounts';
  end if;

  select * into v_prod from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product (%) not found in finished goods inventory', p_product_id;
  end if;

  v_cur_stock := coalesce(v_prod.stock, v_prod.quantity, 0);
  if p_quantity > v_cur_stock then
    raise exception 'Insufficient finished goods stock for "%": available=%, requested=%',
      v_prod.name, v_cur_stock, p_quantity;
  end if;

  update public.products
     set stock      = v_cur_stock - p_quantity,
         quantity   = v_cur_stock - p_quantity,
         updated_at = now()
   where id = p_product_id;

  insert into public.sales (
    order_id, product_id, client_name, product_name, quantity,
    weight, proba, payment_type, sale_total_amount, total_amount,
    debt_amount, tx_type, idempotency_key
  ) values (
    p_order_id, p_product_id, trim(p_client_name), v_prod.name, p_quantity,
    round(coalesce(p_weight, v_prod.weight, 0)::numeric, 4),
    coalesce(p_proba, v_prod.proba, 585),
    p_payment_type, v_sale_total, v_paid,
    v_debt, 'kirim', p_idempotency_key
  ) returning id into v_sale_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'product_id', p_product_id,
    'remaining_stock', v_cur_stock - p_quantity,
    'paid_amount', v_paid,
    'debt_amount', v_debt
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_record_sale_with_stock_deduction', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- Dedicated Atomic Customer Debt Repayment (NEVER deducts product stock!)
create or replace function public.rpc_record_debt_repayment(
  p_sale_id         uuid default null,
  p_order_id        uuid default null,
  p_amount          numeric default 0,
  p_repaid_amount   numeric default null,
  p_payment_type    text default 'Naqd pul',
  p_note            text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale          public.sales%rowtype;
  v_order         public.orders%rowtype;
  v_pay_amount    numeric(18, 2) := round(coalesce(nullif(p_repaid_amount, 0), p_amount, 0)::numeric, 2);
  v_prev_debt     numeric(18, 2);
  v_new_debt      numeric(18, 2);
  v_client        text;
  v_label         text;
  v_repayment_id  uuid;
  v_existing      jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'accountant', 'buxgalter', 'hisobchi', 'sales', 'manager', 'production_manager', 'production manager'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if v_pay_amount <= 0 then
    raise exception 'Debt repayment amount must be greater than 0';
  end if;

  if (p_sale_id is null and p_order_id is null) or (p_sale_id is not null and p_order_id is not null) then
    raise exception 'Specify exactly one of p_sale_id or p_order_id for debt repayment';
  end if;

  if p_sale_id is not null then
    select * into v_sale from public.sales where id = p_sale_id for update;
    if not found then
      raise exception 'Original sale (%) not found', p_sale_id;
    end if;

    v_prev_debt := round(coalesce(v_sale.debt_amount, 0)::numeric, 2);
    if v_prev_debt <= 0 then
      raise exception 'Sale (%) has no outstanding debt', p_sale_id;
    end if;
    if v_pay_amount > v_prev_debt then
      raise exception 'Repayment (%s) exceeds outstanding sale debt (%s)', v_pay_amount, v_prev_debt;
    end if;

    v_new_debt := round(v_prev_debt - v_pay_amount, 2);
    v_client   := v_sale.client_name;
    v_label    := format('Qarz to''lovi (%s)', v_sale.product_name);

    -- Update original sale: increase paid total_amount and decrease debt_amount in-place
    update public.sales
       set total_amount = round(coalesce(total_amount, 0) + v_pay_amount, 2),
           debt_amount  = v_new_debt
     where id = p_sale_id;
  else
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
      raise exception 'Order (%) not found', p_order_id;
    end if;

    if lower(coalesce(v_order.status::text, '')) in ('cancelled', 'bekor qilindi')
       or lower(coalesce(v_order.status_label, '')) = 'bekor qilindi' then
      raise exception 'Cannot record debt repayment on a cancelled order (%)', coalesce(v_order.order_no, p_order_id::text);
    end if;

    v_prev_debt := round(greatest(0, coalesce(v_order.total_price, 0) - coalesce(v_order.advance, 0))::numeric, 2);
    if v_prev_debt <= 0 then
      raise exception 'Order (%) has no outstanding debt', coalesce(v_order.order_no, p_order_id::text);
    end if;
    if v_pay_amount > v_prev_debt then
      raise exception 'Repayment (%s) exceeds outstanding order debt (%s)', v_pay_amount, v_prev_debt;
    end if;

    v_new_debt := round(v_prev_debt - v_pay_amount, 2);
    v_client   := coalesce(v_order.client_name, v_order.customer_name, 'Mijoz');
    v_label    := format('Buyurtma Qarz To''lovi (%s)', coalesce(v_order.order_no, p_order_id::text));

    update public.orders
       set advance     = round(coalesce(advance, 0) + v_pay_amount, 2),
           paid_amount = round(coalesce(advance, 0) + v_pay_amount, 2),
           debt_amount = v_new_debt
     where id = p_order_id;
  end if;

  insert into public.debt_repayments (
    sale_id, order_id, client_name, amount, payment_type,
    previous_debt, remaining_debt, note, idempotency_key, recorded_by
  ) values (
    p_sale_id, p_order_id, v_client, v_pay_amount, p_payment_type,
    v_prev_debt, v_new_debt, p_note, p_idempotency_key, auth.uid()
  ) returning id into v_repayment_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'repayment_id', v_repayment_id,
    'sale_id', p_sale_id,
    'order_id', p_order_id,
    'paid_amount', v_pay_amount,
    'previous_debt', v_prev_debt,
    'remaining_debt', v_new_debt
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_record_debt_repayment', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 10. RPC: Atomic Salary Ledger & Employee Balance Update
-- ============================================================================
create or replace function public.rpc_record_salary_transaction(
  p_employee_id     uuid default null,
  p_worker_name     text default '',
  p_batch_no        text default '',
  p_stage_name      text default '',
  p_tx_type         text default 'EARNED',
  p_weight_done     numeric default 0,
  p_rate            numeric default 0,
  p_amount          numeric default 0,
  p_note            text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp        public.employees%rowtype;
  v_amount     numeric(18, 2) := round(coalesce(p_amount, 0)::numeric, 2);
  v_weight     numeric(14, 4) := round(coalesce(p_weight_done, 0)::numeric, 4);
  v_rate       numeric(18, 2) := round(coalesce(p_rate, 0)::numeric, 2);
  v_new_bal    numeric(18, 2);
  v_ledger_id  uuid;
  v_worker_nm  text;
  v_existing   jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'accountant', 'buxgalter', 'hisobchi', 'manager', 'production_manager', 'production manager'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if v_amount <= 0 or v_weight < 0 or v_rate < 0 or p_tx_type not in ('EARNED', 'PAID') then
    raise exception 'Invalid salary transaction parameters';
  end if;

  if p_employee_id is not null then
    select * into v_emp from public.employees where id = p_employee_id for update;
  else
    select * into v_emp
      from public.employees
     where lower(trim(coalesce(name, full_name, ''))) = lower(trim(p_worker_name))
     limit 1
       for update;
  end if;

  if not found then
    raise exception 'Employee (%) not found', coalesce(p_employee_id::text, p_worker_name);
  end if;

  v_worker_nm := coalesce(v_emp.name, v_emp.full_name, trim(p_worker_name));

  -- Explicit duplicate check before insert (backed by idx_salary_ledger_unique_earned)
  if p_tx_type = 'EARNED' and exists (
    select 1 from public.salary_ledger s
     where (s.employee_id = v_emp.id or lower(trim(s.worker_name)) = lower(trim(v_worker_nm)))
       and upper(trim(s.batch_no)) = upper(trim(p_batch_no))
       and lower(trim(s.stage_name)) = lower(trim(p_stage_name))
       and s.tx_type = 'EARNED'
  ) then
    raise exception 'Duplicate salary guard: EARNED entry already exists for % on batch % stage %',
      v_worker_nm, p_batch_no, p_stage_name
      using errcode = '23505';
  end if;

  insert into public.salary_ledger (
    employee_id, worker_name, batch_no, stage_name, tx_type,
    weight_done, rate, amount, payment_status, note, idempotency_key
  ) values (
    v_emp.id, v_worker_nm, trim(p_batch_no), trim(p_stage_name), p_tx_type,
    v_weight, v_rate, v_amount,
    case when p_tx_type = 'PAID' then 'PAID' else 'UNPAID' end,
    coalesce(nullif(p_note, ''), format('%s - %s', trim(p_batch_no), trim(p_stage_name))),
    p_idempotency_key
  ) returning id into v_ledger_id;

  v_new_bal := case
    when p_tx_type = 'EARNED' then round(coalesce(v_emp.balance, 0) + v_amount, 2)
    else round(coalesce(v_emp.balance, 0) - v_amount, 2)
  end;

  -- Mark trusted RPC context so trg_prevent_employee_privilege_escalation permits accountant balance update
  perform set_config('app.in_salary_rpc', 'true', true);
  update public.employees
     set balance = v_new_bal
   where id = v_emp.id;
  perform set_config('app.in_salary_rpc', 'false', true);

  v_existing := jsonb_build_object(
    'status', 'ok',
    'ledger_id', v_ledger_id,
    'employee_id', v_emp.id,
    'worker_name', v_worker_nm,
    'new_balance', v_new_bal
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_record_salary_transaction', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;

-- ============================================================================
-- 11. RPC: Atomic Product Model & BOM Creation (Starts With Zero Stock)
-- ============================================================================
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
  v_ring_w     numeric(14, 4) := round(greatest(0, coalesce(p_ring_weight, 0))::numeric, 4);
  v_ear_w      numeric(14, 4) := round(greatest(0, coalesce(p_earring_weight, 0))::numeric, 4);
  v_chain_w    numeric(14, 4) := round(greatest(0, coalesce(p_chain_weight, 0))::numeric, 4);
  v_dorika_w   numeric(14, 4) := round(greatest(0, coalesce(p_dorika_weight, 0))::numeric, 4);
  v_stone_w    numeric(14, 4) := round(greatest(0, coalesce(p_stone_weight, 0))::numeric, 4);
  v_tot_w      numeric(14, 4);
  v_summary    text;
  v_prod_id    uuid;
  v_bom_elem   jsonb;
  v_existing   jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi',
    'inventory_manager', 'manager', 'production_manager', 'production manager'
  ]);

  if p_idempotency_key is not null then
    select response_data into v_existing
      from public.idempotency_keys
     where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  v_tot_w := round(
    coalesce(nullif(p_weight, 0), v_ring_w + v_ear_w + v_chain_w + v_dorika_w + v_stone_w)::numeric,
    4
  );

  if coalesce(trim(p_name), '') = '' or v_tot_w <= 0 or v_stone_w >= v_tot_w then
    raise exception 'Invalid product model or BOM weights (total=%g, stone=%g)', v_tot_w, v_stone_w;
  end if;

  v_summary := coalesce(
    nullif(trim(p_bom_details), ''),
    format('v%s: Uzuk(%sg) + Zirak(%sg) + Zanjir(%sg) + Dorika(%sg) + Tosh(%sg)',
      coalesce(p_bom_version, 1), v_ring_w, v_ear_w, v_chain_w, v_dorika_w, v_stone_w)
  );

  -- Product model always starts with stock = 0 (stock only increases via production completion or verified receipt)
  insert into public.products (
    name, title, category, weight, proba, stock, quantity,
    stone_weight, bom_version, bom_details, image_url
  ) values (
    trim(p_name), trim(p_name), coalesce(nullif(trim(p_category), ''), 'Komplekt'),
    v_tot_w, coalesce(p_proba, 585), 0, 0,
    v_stone_w, coalesce(p_bom_version, 1), v_summary,
    coalesce(p_image_url, 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80')
  ) returning id into v_prod_id;

  if p_bom_items is not null and jsonb_typeof(p_bom_items) = 'array' and jsonb_array_length(p_bom_items) > 0 then
    for v_bom_elem in select * from jsonb_array_elements(p_bom_items)
    loop
      insert into public.bom_items (
        product_id, product_name, bom_version, component_name, material_category, weight_per_set, proba
      ) values (
        v_prod_id,
        trim(p_name),
        coalesce(p_bom_version, 1),
        coalesce(v_bom_elem ->> 'component_name', 'Component'),
        coalesce(v_bom_elem ->> 'material_category', 'Gold'),
        round(greatest(0, coalesce((v_bom_elem ->> 'weight_per_set')::numeric, 0)), 4),
        coalesce((v_bom_elem ->> 'proba')::numeric, coalesce(p_proba, 585))
      );
    end loop;
  else
    insert into public.bom_items (
      product_id, product_name, bom_version, component_name, material_category, weight_per_set, proba
    ) values
      (v_prod_id, trim(p_name), coalesce(p_bom_version, 1), 'Ring (Uzuk)', 'Gold', v_ring_w, coalesce(p_proba, 585)),
      (v_prod_id, trim(p_name), coalesce(p_bom_version, 1), 'Earring (Zirak)', 'Gold', v_ear_w, coalesce(p_proba, 585)),
      (v_prod_id, trim(p_name), coalesce(p_bom_version, 1), 'Chain/Wire (Zanjir/Sim)', 'Wire', v_chain_w, coalesce(p_proba, 585)),
      (v_prod_id, trim(p_name), coalesce(p_bom_version, 1), 'Dorika', 'Wire', v_dorika_w, coalesce(p_proba, 585)),
      (v_prod_id, trim(p_name), coalesce(p_bom_version, 1), 'Zircon Stone (Tosh)', 'Stone', v_stone_w, 0);
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'product_id', v_prod_id,
    'name', trim(p_name),
    'total_weight', v_tot_w,
    'stock', 0
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
    values (p_idempotency_key, 'rpc_create_product_with_bom', auth.uid(), v_existing);
  end if;

  return v_existing;
end;
$$;
