-- ============================================================================
-- Migration: 20260101000015_erp_operational_schema_reconciliation.sql
-- Purpose:   Forward-only, non-destructive reconciliation between the
--            normalized manufacturing schema (001..014), the live hybrid
--            production schema (bigint & uuid PKs), and the operational
--            ERP modules (inventory, alloying, refining, batches, partial WIP,
--            consumption, products/BOM, orders, sales, debt repayments,
--            employees/salary_ledger, machines, quality_control, audit_logs,
--            system_settings, stage_loss_configs).
-- Safety:    Zero DROP TABLE, TRUNCATE, or DELETE statements. Uses IF NOT EXISTS,
--            column-existence guards, and NOT VALID check constraints to preserve
--            all existing production records.
-- ============================================================================

-- Helper: Safe text-to-UUID cast that returns NULL instead of throwing 22P02
-- when a table uses bigint primary keys ("1", "2", etc.).
create or replace function public.try_cast_uuid(p_val text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_val is null or trim(p_val) = '' then
    return null;
  end if;
  return trim(p_val)::uuid;
exception when others then
  return null;
end;
$$;

-- 0. Safely ensure public.app_role exists, then extend values at top-level (never inside DO $$)
do $$
begin
  if not exists (
    select 1 from pg_type
    where typnamespace = 'public'::regnamespace and typname = 'app_role'
  ) then
    create type public.app_role as enum (
      'admin',
      'production_manager',
      'department_head',
      'department_operator',
      'inventory_manager',
      'quality_inspector',
      'sales',
      'viewer',
      'director',
      'manager',
      'master',
      'supervisor',
      'warehouse',
      'accountant',
      'worker'
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typnamespace = 'public'::regnamespace and typname = 'order_status'
  ) then
    create type public.order_status as enum (
      'draft',
      'confirmed',
      'in_production',
      'ready_for_qc',
      'completed',
      'delivered',
      'cancelled',
      'Kutilmoqda',
      'Ishlab chiqarishda',
      'Tugatildi',
      'Bekor qilindi'
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typnamespace = 'public'::regnamespace and typname = 'order_priority'
  ) then
    create type public.order_priority as enum (
      'low',
      'normal',
      'high',
      'urgent',
      'Normal',
      'VIP',
      'URGENT'
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typnamespace = 'public'::regnamespace and typname = 'batch_status'
  ) then
    create type public.batch_status as enum (
      'pending',
      'in_progress',
      'on_hold',
      'rework',
      'completed',
      'cancelled',
      'Jarayonda',
      'Tugatildi',
      'Bekor qilindi'
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typnamespace = 'public'::regnamespace and typname = 'batch_priority'
  ) then
    create type public.batch_priority as enum (
      'low',
      'normal',
      'high',
      'urgent',
      'Normal',
      'VIP',
      'URGENT'
    );
  end if;
end $$;

-- Top-level ALTER TYPE ... ADD VALUE IF NOT EXISTS (PostgreSQL-safe outside DO $$ blocks)
alter type public.app_role add value if not exists 'admin';
alter type public.app_role add value if not exists 'production_manager';
alter type public.app_role add value if not exists 'department_head';
alter type public.app_role add value if not exists 'department_operator';
alter type public.app_role add value if not exists 'inventory_manager';
alter type public.app_role add value if not exists 'quality_inspector';
alter type public.app_role add value if not exists 'sales';
alter type public.app_role add value if not exists 'viewer';
alter type public.app_role add value if not exists 'director';
alter type public.app_role add value if not exists 'manager';
alter type public.app_role add value if not exists 'master';
alter type public.app_role add value if not exists 'supervisor';
alter type public.app_role add value if not exists 'warehouse';
alter type public.app_role add value if not exists 'accountant';
alter type public.app_role add value if not exists 'worker';

alter type public.order_status add value if not exists 'Kutilmoqda';
alter type public.order_status add value if not exists 'Ishlab chiqarishda';
alter type public.order_status add value if not exists 'Tugatildi';
alter type public.order_status add value if not exists 'Bekor qilindi';

alter type public.order_priority add value if not exists 'Normal';
alter type public.order_priority add value if not exists 'VIP';
alter type public.order_priority add value if not exists 'URGENT';

alter type public.batch_status add value if not exists 'Jarayonda';
alter type public.batch_status add value if not exists 'Tugatildi';
alter type public.batch_status add value if not exists 'Bekor qilindi';

alter type public.batch_priority add value if not exists 'Normal';
alter type public.batch_priority add value if not exists 'VIP';
alter type public.batch_priority add value if not exists 'URGENT';


-- 1. Idempotency key registry to prevent duplicate posting on network retries
create table if not exists public.idempotency_keys (
  idempotency_key text primary key,
  operation_name  text not null,
  actor_id        uuid,
  response_data   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- 2. Extend inventory_items non-destructively for operational gold & material tracking
alter table public.inventory_items
  add column if not exists material_code text,
  add column if not exists category text default 'Gold',
  add column if not exists proba numeric(6, 2) default 0,
  add column if not exists on_hand numeric(14, 4) default 0,
  add column if not exists quantity_on_hand numeric(14, 4) default 0,
  add column if not exists reserved numeric(14, 4) default 0;

-- Allow legacy/operational rows where category_id, sku, or unit were not populated
do $$
declare
  v_unit_udt text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'sku'
  ) then
    alter table public.inventory_items alter column sku drop not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'category_id'
  ) then
    alter table public.inventory_items alter column category_id drop not null;
  end if;

  select udt_name into v_unit_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'unit';

  if v_unit_udt is not null then
    alter table public.inventory_items alter column unit drop not null;
    if v_unit_udt = 'inventory_unit' then
      alter table public.inventory_items alter column unit set default 'gram'::public.inventory_unit;
    else
      alter table public.inventory_items alter column unit set default 'gram';
    end if;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_inventory_items_non_negative_and_reserved'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint chk_inventory_items_non_negative_and_reserved
      check (
        coalesce(on_hand, 0) >= 0
        and coalesce(reserved, 0) >= 0
        and coalesce(on_hand, 0) >= coalesce(reserved, 0)
      ) not valid;
  end if;
end $$;

-- Order-specific inventory reservations table (dynamically matches inventory_items.id type: uuid or bigint)
do $$
declare
  v_inv_id_udt text;
  v_inv_id_col_type text := 'uuid';
begin
  select udt_name into v_inv_id_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'id';

  if v_inv_id_udt in ('int8', 'bigint') then
    v_inv_id_col_type := 'bigint';
  elsif v_inv_id_udt in ('int4', 'integer') then
    v_inv_id_col_type := 'integer';
  else
    v_inv_id_col_type := 'uuid';
  end if;

  if to_regclass('public.inventory_reservations') is null then
    execute format($sql$
      create table public.inventory_reservations (
        id                uuid primary key default gen_random_uuid(),
        inventory_item_id %s not null references public.inventory_items(id) on delete restrict,
        order_id          text,
        order_no          text,
        batch_no          text,
        reserved_grams    numeric(14, 4) not null check (reserved_grams > 0),
        consumed_grams    numeric(14, 4) not null default 0 check (consumed_grams >= 0),
        released_grams    numeric(14, 4) not null default 0 check (released_grams >= 0),
        status            text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONSUMED', 'RELEASED')),
        idempotency_key   text unique,
        created_by        uuid,
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now(),
        constraint chk_reservation_balance check (consumed_grams + released_grams <= reserved_grams)
      )
    $sql$, v_inv_id_col_type);
  end if;
end $$;

-- 3. Extend gold_transactions non-destructively for operational ledger compatibility
alter table public.gold_transactions
  add column if not exists transaction_type text,
  add column if not exists from_location text default 'SAFE',
  add column if not exists to_location text default 'WIP',
  add column if not exists material_name text,
  add column if not exists gross_weight numeric(14, 4),
  add column if not exists proba numeric(6, 2),
  add column if not exists pure_gold numeric(18, 6),
  add column if not exists batch_no text,
  add column if not exists description text,
  add column if not exists idempotency_key text unique;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gold_transactions' and column_name = 'lot_id'
  ) then
    alter table public.gold_transactions alter column lot_id drop not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gold_transactions' and column_name = 'type'
  ) then
    alter table public.gold_transactions alter column type drop not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gold_transactions' and column_name = 'weight_grams'
  ) then
    alter table public.gold_transactions alter column weight_grams drop not null;
  end if;
end $$;

-- Authoritative melting loss helper (loss = initial - output; rejects negative loss)
create or replace function public.calculate_melting_loss(
  p_initial_weight_grams numeric,
  p_output_weight_grams  numeric
)
returns numeric(14, 4)
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_loss numeric(14, 4);
begin
  if p_initial_weight_grams <= 0 or p_output_weight_grams < 0 then
    raise exception 'Invalid weights for melting loss calculation: initial=%, output=%',
      p_initial_weight_grams, p_output_weight_grams;
  end if;

  v_loss := round((p_initial_weight_grams - p_output_weight_grams)::numeric, 4);
  if v_loss < 0 then
    raise exception 'Melting output (%g) cannot exceed initial input weight (%g) without explicit adjustment',
      p_output_weight_grams, p_initial_weight_grams;
  end if;

  return v_loss;
end;
$$;

-- Fix apply_gold_transaction() melting_loss sign convention and support both enum and operational rows
create or replace function public.apply_gold_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delta numeric(14, 4) := 0;
  v_type  text := lower(coalesce(new.type::text, new.transaction_type, ''));
  v_w     numeric(14, 4) := coalesce(new.weight_grams, new.gross_weight, 0);
begin
  -- Operational ledger entries that reference inventory_items instead of gold_lots
  if new.lot_id is null or v_type = '' or v_w <= 0 then
    return new;
  end if;

  case v_type
    when 'lot_received', 'receipt', 'returned_from_batch', 'return_from_batch', 'scrap_recovered', 'scrap_recovery', 'adjustment', 'adjustment_plus' then
      v_delta := v_w;
    when 'issued_to_batch', 'issue_to_batch', 'adjustment_minus' then
      v_delta := -v_w;
    when 'melting_loss' then
      if new.batch_id is null then
        v_delta := -v_w;
      else
        v_delta := 0;
      end if;
    else
      v_delta := 0;
  end case;

  if v_delta <> 0 and to_regclass('public.gold_lots') is not null then
    update public.gold_lots
       set remaining_weight_grams = remaining_weight_grams + v_delta
     where id = new.lot_id;
  end if;

  return new;
end;
$$;

-- 4. Refining (Affinaj) records table (dynamically matches inventory_items.id type: uuid or bigint)
do $$
declare
  v_inv_id_udt text;
  v_inv_id_col_type text := 'uuid';
begin
  select udt_name into v_inv_id_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'id';

  if v_inv_id_udt in ('int8', 'bigint') then
    v_inv_id_col_type := 'bigint';
  elsif v_inv_id_udt in ('int4', 'integer') then
    v_inv_id_col_type := 'integer';
  else
    v_inv_id_col_type := 'uuid';
  end if;

  if to_regclass('public.affinaj_records') is null then
    execute format($sql$
      create table public.affinaj_records (
        id                  uuid primary key default gen_random_uuid(),
        scrap_item_id       %s references public.inventory_items(id) on delete restrict,
        target_gold_item_id %s references public.inventory_items(id) on delete restrict,
        scrap_weight        numeric(14, 4) not null check (scrap_weight > 0),
        estimated_proba     numeric(6, 2) not null check (estimated_proba > 0 and estimated_proba <= 1000),
        output_weight       numeric(14, 4) not null check (output_weight > 0 and output_weight <= scrap_weight),
        output_proba        numeric(6, 2) not null default 999 check (output_proba > 0 and output_proba <= 1000),
        expected_fine       numeric(18, 6) not null check (expected_fine >= 0),
        actual_fine         numeric(18, 6) not null check (actual_fine >= 0),
        refining_loss       numeric(14, 4) not null default 0 check (refining_loss >= 0),
        master_name         text,
        idempotency_key     text unique,
        performed_by        uuid,
        created_at          timestamptz not null default now()
      )
    $sql$, v_inv_id_col_type, v_inv_id_col_type);
  end if;
end $$;

-- 5. Extend orders non-destructively
alter table public.orders
  add column if not exists order_no text unique,
  add column if not exists order_number text,
  add column if not exists client_name text,
  add column if not exists customer_name text,
  add column if not exists phone text,
  add column if not exists product_model text,
  add column if not exists details text,
  add column if not exists proba numeric(6, 2) default 585,
  add column if not exists qty integer default 1,
  add column if not exists weight_gram numeric(14, 4) default 0,
  add column if not exists total_price numeric(18, 2) default 0,
  add column if not exists advance numeric(18, 2) default 0,
  add column if not exists paid_amount numeric(18, 2) default 0,
  add column if not exists debt_amount numeric(18, 2) default 0,
  add column if not exists deadline date,
  add column if not exists priority text default 'Normal',
  add column if not exists status text default 'Kutilmoqda',
  add column if not exists priority_label text default 'Normal',
  add column if not exists status_label text default 'Kutilmoqda',
  add column if not exists batch_created boolean not null default false,
  add column if not exists reserved_gold_gram numeric(14, 4) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

do $$
declare
  v_inv_id_udt text;
  v_inv_id_col_type text := 'uuid';
begin
  select udt_name into v_inv_id_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'id';

  if v_inv_id_udt in ('int8', 'bigint') then
    v_inv_id_col_type := 'bigint';
  elsif v_inv_id_udt in ('int4', 'integer') then
    v_inv_id_col_type := 'integer';
  else
    v_inv_id_col_type := 'uuid';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'reserved_item_id'
  ) then
    execute format(
      'alter table public.orders add column reserved_item_id %s references public.inventory_items(id) on delete set null',
      v_inv_id_col_type
    );
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'order_number'
  ) then
    alter table public.orders alter column order_number drop not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_id'
  ) then
    alter table public.orders alter column customer_id drop not null;
  end if;
end $$;

-- 6. Extend batches non-destructively (product_id is text to support both bigint and uuid product PKs)
alter table public.batches
  add column if not exists batch_no text,
  add column if not exists batch_number text,
  add column if not exists parent_batch_no text,
  add column if not exists number text,
  add column if not exists product_id text,
  add column if not exists product_name text,
  add column if not exists product text,
  add column if not exists client_name text,
  add column if not exists master_name text,
  add column if not exists status text default 'Jarayonda',
  add column if not exists priority text default 'Normal',
  add column if not exists status_label text default 'Jarayonda',
  add column if not exists proba numeric(6, 2) default 585,
  add column if not exists planned_qty integer default 0,
  add column if not exists planned_gram numeric(14, 4) default 0,
  add column if not exists actual_qty integer default 0,
  add column if not exists actual_gram numeric(14, 4) default 0,
  add column if not exists issued_gold_gram numeric(14, 4) default 0,
  add column if not exists wip_gram numeric(14, 4) default 0,
  add column if not exists good_output_gram numeric(14, 4) default 0,
  add column if not exists sprue_gram numeric(14, 4) default 0,
  add column if not exists scrap_gram numeric(14, 4) default 0,
  add column if not exists rework_gram numeric(14, 4) default 0,
  add column if not exists loss_gram numeric(14, 4) default 0,
  add column if not exists finished_qty integer default 0,
  add column if not exists credited_finished_qty integer not null default 0,
  add column if not exists current_step text default '8. Quyish',
  add column if not exists priority_label text default 'Normal',
  add column if not exists deadline date,
  add column if not exists due_date date,
  add column if not exists updated_at timestamptz not null default now();

do $$
declare
  v_ord_id_udt text;
  v_ord_id_col_type text := 'uuid';
  v_batch_order_id_udt text;
  v_r record;
begin
  select udt_name into v_ord_id_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'orders' and column_name = 'id';

  if v_ord_id_udt in ('int8', 'bigint') then
    v_ord_id_col_type := 'bigint';
  elsif v_ord_id_udt in ('int4', 'integer') then
    v_ord_id_col_type := 'integer';
  else
    v_ord_id_col_type := 'uuid';
  end if;

  select udt_name into v_batch_order_id_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'batches' and column_name = 'order_id';

  -- Case A: batches.order_id does NOT exist yet -> add it with matching orders.id type
  if v_batch_order_id_udt is null then
    execute format(
      'alter table public.batches add column order_id %s references public.orders(id) on delete set null',
      v_ord_id_col_type
    );
  -- Case B: batches.order_id is uuid while orders.id is bigint/integer -> safely reconcile
  elsif v_batch_order_id_udt = 'uuid' and v_ord_id_col_type in ('bigint', 'integer') then
    -- 1. Preserve any legacy non-null UUID data in order_id_legacy_uuid so zero data is lost
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'batches' and column_name = 'order_id_legacy_uuid'
    ) then
      alter table public.batches add column order_id_legacy_uuid uuid;
      update public.batches set order_id_legacy_uuid = order_id where order_id is not null;
    end if;

    -- 2. Drop any foreign key constraints on batches(order_id)
    for v_r in (
      select conname
        from pg_constraint
       where conrelid = 'public.batches'::regclass
         and contype = 'f'
         and conkey = array[(
           select attnum from pg_attribute
            where attrelid = 'public.batches'::regclass and attname = 'order_id'
         )]
    ) loop
      execute format('alter table public.batches drop constraint %I', v_r.conname);
    end loop;

    -- 3. Drop NOT NULL
    alter table public.batches alter column order_id drop not null;

    -- 4. Alter column type to bigint with safe numeric regex conversion
    execute format(
      'alter table public.batches alter column order_id type %s using (case when order_id::text ~ ''^[0-9]+$'' then order_id::text::%s else null end)',
      v_ord_id_col_type,
      v_ord_id_col_type
    );

    -- 5. Add matching foreign key to public.orders(id)
    execute format(
      'alter table public.batches add constraint batches_order_id_fkey foreign key (order_id) references public.orders(id) on delete set null'
    );
  else
    -- Case C: batches.order_id already matches orders.id type
    alter table public.batches alter column order_id drop not null;
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.batches'::regclass
         and contype = 'f'
         and conkey = array[(
           select attnum from pg_attribute
            where attrelid = 'public.batches'::regclass and attname = 'order_id'
         )]
    ) then
      begin
        execute format(
          'alter table public.batches add constraint batches_order_id_fkey foreign key (order_id) references public.orders(id) on delete set null'
        );
      exception when others then
        raise notice 'Notice: FK constraint batches_order_id_fkey skipped: %', sqlerrm;
      end;
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'batches' and column_name = 'batch_number'
  ) then
    alter table public.batches alter column batch_number drop not null;
  end if;
end $$;

-- Fix log_batch_status_change() so it never compares bigint employee/batch IDs with uuid directly
create or replace function public.log_batch_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp_uuid   uuid;
  v_batch_uuid uuid;
  v_setting    text := nullif(current_setting('app.current_employee_id', true), '');
begin
  if (old.status is distinct from new.status) or (old.priority is distinct from new.priority) then
    v_batch_uuid := public.try_cast_uuid(new.id::text);
    if v_batch_uuid is not null and to_regclass('public.batch_status_history') is not null then
      select coalesce(public.try_cast_uuid(e.id::text), e.user_id)
        into v_emp_uuid
        from public.employees e
       where (e.user_id = auth.uid() or e.id::text = coalesce(v_setting, auth.uid()::text))
       limit 1;

      insert into public.batch_status_history (
        batch_id, previous_status, new_status, previous_priority, new_priority, changed_by
      ) values (
        v_batch_uuid, old.status, new.status, old.priority, new.priority, v_emp_uuid
      );
    end if;
  end if;
  return new;
end;
$$;

-- 7. Production stages, Batch Stage WIP, Consumption, and Machines
create table if not exists public.production_stages (
  id          uuid primary key default gen_random_uuid(),
  stage_order integer not null unique,
  name        text not null,
  department  text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.batch_stage_wip (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             text,
  batch_no             text not null,
  stage_order          integer not null,
  stage_name           text not null,
  department           text not null default 'Quyish',
  available_qty        integer not null default 0 check (available_qty >= 0),
  completed_qty        integer not null default 0 check (completed_qty >= 0),
  rework_qty           integer not null default 0 check (rework_qty >= 0),
  input_weight         numeric(14, 4) not null default 0 check (input_weight >= 0),
  output_weight        numeric(14, 4) not null default 0 check (output_weight >= 0),
  loss_weight          numeric(14, 4) not null default 0 check (loss_weight >= 0),
  queue_status         text not null default 'NOW',
  assigned_worker      text,
  assigned_employee_id text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (batch_no, stage_order)
);

alter table public.batch_stage_wip
  add column if not exists batch_id text,
  add column if not exists department text default 'Quyish',
  add column if not exists available_qty integer default 0,
  add column if not exists completed_qty integer default 0,
  add column if not exists rework_qty integer default 0,
  add column if not exists input_weight numeric(14, 4) default 0,
  add column if not exists output_weight numeric(14, 4) default 0,
  add column if not exists loss_weight numeric(14, 4) default 0,
  add column if not exists queue_status text default 'NOW',
  add column if not exists assigned_worker text,
  add column if not exists assigned_employee_id text,
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'batch_stage_wip' and column_name = 'batch_id'
  ) then
    alter table public.batch_stage_wip alter column batch_id drop not null;
    alter table public.batch_stage_wip alter column batch_id type text using batch_id::text;
  end if;
end $$;

create table if not exists public.consumption (
  id                 uuid primary key default gen_random_uuid(),
  batch_id           text,
  batch_no           text not null,
  stage_order        integer,
  master_name        text,
  master_employee_id text,
  department         text not null,
  proba              numeric(6, 2) not null default 585,
  given_weight       numeric(14, 4) not null check (given_weight > 0),
  returned_weight    numeric(14, 4) not null default 0 check (returned_weight >= 0),
  sprue_gram         numeric(14, 4) not null default 0 check (sprue_gram >= 0),
  scrap_gram         numeric(14, 4) not null default 0 check (scrap_gram >= 0),
  loss_weight        numeric(14, 4) not null default 0 check (loss_weight >= 0),
  sent_to_refinery   boolean not null default false,
  idempotency_key    text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chk_consumption_mass_balance check (
    returned_weight + sprue_gram + scrap_gram + loss_weight <= given_weight + 0.0005
  )
);

alter table public.consumption
  add column if not exists batch_id text,
  add column if not exists batch_no text,
  add column if not exists stage_order integer,
  add column if not exists master_name text,
  add column if not exists master_employee_id text,
  add column if not exists proba numeric(6, 2) default 585,
  add column if not exists given_weight numeric(14, 4) default 0,
  add column if not exists returned_weight numeric(14, 4) default 0,
  add column if not exists sprue_gram numeric(14, 4) default 0,
  add column if not exists scrap_gram numeric(14, 4) default 0,
  add column if not exists loss_weight numeric(14, 4) default 0,
  add column if not exists sent_to_refinery boolean default false,
  add column if not exists idempotency_key text unique,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.machines (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  department     text not null,
  daily_capacity integer not null default 0,
  current_batch  text,
  status         text not null default 'ACTIVE',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.machines
  add column if not exists department text default 'Quyish',
  add column if not exists daily_capacity integer default 0,
  add column if not exists current_batch text,
  add column if not exists status text default 'ACTIVE',
  add column if not exists updated_at timestamptz not null default now();

-- 8. Products (Finished Goods) & BOM Items
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  title        text,
  category     text not null default 'Komplekt',
  weight       numeric(14, 4) not null check (weight > 0),
  proba        numeric(6, 2) not null default 585,
  stock        integer not null default 0 check (stock >= 0),
  quantity     integer not null default 0 check (quantity >= 0),
  stone_weight numeric(14, 4) not null default 0 check (stone_weight >= 0 and stone_weight <= weight),
  bom_version  integer not null default 1,
  bom_details  text,
  image_url    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.products
  add column if not exists title text,
  add column if not exists category text default 'Komplekt',
  add column if not exists weight numeric(14, 4) default 0,
  add column if not exists proba numeric(6, 2) default 585,
  add column if not exists stock integer default 0,
  add column if not exists quantity integer default 0,
  add column if not exists stone_weight numeric(14, 4) default 0,
  add column if not exists bom_version integer default 1,
  add column if not exists bom_details text,
  add column if not exists image_url text,
  add column if not exists updated_at timestamptz default now();

create table if not exists public.bom_items (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid,
  product_name      text not null,
  bom_version       integer not null default 1,
  component_name    text not null,
  material_category text not null,
  weight_per_set    numeric(14, 4) not null check (weight_per_set >= 0),
  proba             numeric(6, 2) not null default 0,
  created_at        timestamptz not null default now()
);

alter table public.bom_items
  add column if not exists product_id uuid,
  add column if not exists product_name text,
  add column if not exists bom_version integer default 1,
  add column if not exists component_name text,
  add column if not exists material_category text default 'Gold',
  add column if not exists weight_per_set numeric(14, 4) default 0,
  add column if not exists proba numeric(6, 2) default 0;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bom_items' and column_name = 'product_id'
  ) then
    alter table public.bom_items alter column product_id drop not null;
  end if;
end $$;

-- 9. Sales & Customer Debt Repayments (order_id, product_id, sale_id use text for bigint/uuid compatibility)
create table if not exists public.sales (
  id                 uuid primary key default gen_random_uuid(),
  order_id           text,
  product_id         text,
  parent_sale_id     text,
  client_name        text not null,
  product_name       text not null,
  quantity           integer not null default 1 check (quantity >= 0),
  weight             numeric(14, 4) not null default 0 check (weight >= 0),
  proba              numeric(6, 2) not null default 585,
  payment_type       text not null default 'Naqd pul',
  sale_total_amount  numeric(18, 2) not null default 0 check (sale_total_amount >= 0),
  total_amount       numeric(18, 2) not null default 0 check (total_amount >= 0),
  debt_amount        numeric(18, 2) not null default 0 check (debt_amount >= 0),
  tx_type            text not null default 'kirim' check (tx_type in ('kirim', 'chiqim', 'qarz_tolovi', 'debt_repayment')),
  idempotency_key    text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.sales
  add column if not exists order_id text,
  add column if not exists product_id text,
  add column if not exists parent_sale_id text,
  add column if not exists sale_total_amount numeric(18, 2) default 0,
  add column if not exists idempotency_key text unique,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.debt_repayments (
  id              uuid primary key default gen_random_uuid(),
  sale_id         text,
  order_id        text,
  client_name     text not null,
  amount          numeric(18, 2) not null check (amount > 0),
  payment_type    text not null default 'Naqd pul',
  previous_debt   numeric(18, 2) not null check (previous_debt >= 0),
  remaining_debt  numeric(18, 2) not null check (remaining_debt >= 0),
  note            text,
  idempotency_key text unique,
  recorded_by     uuid,
  created_at      timestamptz not null default now(),
  constraint chk_repayment_target check (sale_id is not null or order_id is not null)
);

-- 10. Extend employees & create salary_ledger with duplicate-earned constraint
alter table public.employees
  add column if not exists user_id uuid,
  add column if not exists employee_code text default ('EMP-' || substr(gen_random_uuid()::text, 1, 8)),
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists status text default 'active',
  add column if not exists employment_status text default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists name text,
  add column if not exists department text,
  add column if not exists primary_department_id uuid,
  add column if not exists role text default 'worker',
  add column if not exists role_type text,
  add column if not exists position text,
  add column if not exists salary_type text default 'Grammabay',
  add column if not exists rate numeric(18, 2) not null default 0,
  add column if not exists balance numeric(18, 2) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill is_active from legacy status / employment_status where rows are explicitly inactive/terminated
update public.employees
   set is_active = false
 where is_active = true
   and lower(coalesce(status, employment_status::text, 'active')) not in ('active', 'faol');

create unique index if not exists idx_employees_user_id_unique
  on public.employees (user_id)
  where user_id is not null;

do $$
declare
  v_emp_id_type text;
begin
  select data_type into v_emp_id_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'employees' and column_name = 'id';

  if v_emp_id_type = 'uuid' then
    alter table public.employees alter column id set default gen_random_uuid();
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees' and column_name = 'employee_code'
  ) then
    alter table public.employees
      alter column employee_code set default ('EMP-' || substr(gen_random_uuid()::text, 1, 8)),
      alter column employee_code drop not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees' and column_name = 'full_name'
  ) then
    alter table public.employees alter column full_name drop not null;
  end if;
end $$;

-- Allow operational workshop staff rows that do not yet have an auth.users login
alter table public.employees
  drop constraint if exists employees_id_fkey;

-- Safe authentication-to-employee linking:
-- 1. Never trusts client-supplied raw_user_meta_data ->> 'role'
-- 2. Never inserts a UUID into bigint employees.id
-- 3. Links an unambiguous unlinked employees row by case-insensitive email match
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match_count integer;
begin
  if new.email is not null and btrim(new.email) <> '' then
    select count(*)
      into v_match_count
      from public.employees e
     where e.user_id is null
       and e.email is not null
       and lower(btrim(e.email)) = lower(btrim(new.email));

    if v_match_count = 1 then
      perform set_config('app.in_auth_link_trigger', 'true', true);
      update public.employees e
         set user_id = new.id
       where e.user_id is null
         and e.email is not null
         and lower(btrim(e.email)) = lower(btrim(new.email));
      perform set_config('app.in_auth_link_trigger', 'false', true);
    end if;
  end if;

  return new;
end;
$$;

-- Self-contained employee identity and role helpers (also re-declared in 016)
create or replace function public.normalize_erp_role_token(p_token text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_clean text := lower(btrim(coalesce(p_token, '')));
begin
  if v_clean = '' then
    return null;
  end if;

  case v_clean
    when 'admin', 'director', 'owner', 'direktor', 'rahbar' then
      return 'admin';
    when 'production_manager', 'production manager', 'manager', 'ishlab chiqarish boshlig''i' then
      return 'production_manager';
    when 'department_head', 'supervisor', 'master', 'bosh usta', 'usta' then
      return 'supervisor';
    when 'quality_inspector', 'quality_control', 'qc', 'otk' then
      return 'quality_inspector';
    when 'inventory_manager', 'warehouse', 'omborchi' then
      return 'inventory_manager';
    when 'sales', 'accountant', 'buxgalter', 'hisobchi' then
      return 'accountant';
    when 'department_operator', 'worker', 'zargar', 'operator' then
      return 'worker';
    when 'viewer' then
      return 'viewer';
    else
      return null;
  end case;
end;
$$;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.try_cast_uuid(e.id::text), e.user_id, auth.uid())
    from public.employees e
   where (e.user_id = auth.uid() or e.id::text = auth.uid()::text)
     and coalesce(e.is_active, true) = true
     and lower(coalesce(e.status, e.employment_status::text, 'active')) in ('active', 'faol')
   limit 1;
$$;

create or replace function public.current_employee_id_text()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id::text
    from public.employees e
   where (e.user_id = auth.uid() or e.id::text = auth.uid()::text)
     and coalesce(e.is_active, true) = true
     and lower(coalesce(e.status, e.employment_status::text, 'active')) in ('active', 'faol')
   limit 1;
$$;

create or replace function public.current_employee_role_text()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_emp       public.employees%rowtype;
  v_role_type text;
  v_role_col  text;
  v_pos_role  text;
begin
  if v_uid is null then
    return null;
  end if;

  select *
    into v_emp
    from public.employees e
   where (e.user_id = v_uid or e.id::text = v_uid::text)
     and coalesce(e.is_active, true) = true
     and lower(coalesce(e.status, e.employment_status::text, 'active')) in ('active', 'faol')
   limit 1;

  if not found then
    return 'viewer';
  end if;

  v_role_type := public.normalize_erp_role_token(v_emp.role_type);
  v_role_col  := public.normalize_erp_role_token(v_emp.role::text);
  v_pos_role  := public.normalize_erp_role_token(v_emp.position);

  -- Explicit role precedence rule:
  -- 1. Specific non-generic role_type (e.g. Director, Manager, Accountant, Warehouse, Supervisor)
  --    takes precedence over legacy/default role column ('worker'/'viewer'/'department_operator').
  -- 2. Specific non-generic role column takes next precedence.
  -- 3. Validated generic role_type / role column / position fallback.
  -- 4. Unknown or malformed role values fail closed to 'viewer'.
  if v_role_type is not null and v_role_type not in ('worker', 'viewer') then
    return v_role_type;
  elsif v_role_col is not null and v_role_col not in ('worker', 'viewer') then
    return v_role_col;
  elsif v_role_type is not null then
    return v_role_type;
  elsif v_role_col is not null then
    return v_role_col;
  elsif v_pos_role is not null then
    return v_pos_role;
  else
    return 'viewer';
  end if;
end;
$$;

create table if not exists public.salary_ledger (
  id              uuid primary key default gen_random_uuid(),
  employee_id     text,
  worker_name     text not null,
  batch_no        text not null,
  stage_name      text not null,
  tx_type         text not null check (tx_type in ('EARNED', 'PAID')),
  weight_done     numeric(14, 4) not null default 0 check (weight_done >= 0),
  rate            numeric(18, 2) not null default 0 check (rate >= 0),
  amount          numeric(18, 2) not null check (amount > 0),
  payment_status  text not null default 'UNPAID' check (payment_status in ('UNPAID', 'PAID')),
  note            text,
  idempotency_key text unique,
  created_at      timestamptz not null default now()
);

alter table public.salary_ledger
  add column if not exists employee_id text,
  add column if not exists idempotency_key text unique;

-- Database-enforced duplicate guard for EARNED salary entries per worker + batch + stage
create unique index if not exists idx_salary_ledger_unique_earned
  on public.salary_ledger (
    coalesce(employee_id::text, lower(trim(worker_name))),
    upper(trim(batch_no)),
    lower(trim(stage_name))
  )
  where tx_type = 'EARNED';

-- 11. Operational Quality Control, Audit Logs, System Settings & Stage Loss Configs
create table if not exists public.quality_control (
  id             uuid primary key default gen_random_uuid(),
  batch_no       text not null,
  operation_name text not null,
  checked_qty    integer not null default 0 check (checked_qty >= 0),
  passed_qty     integer not null default 0 check (passed_qty >= 0),
  rework_qty     integer not null default 0 check (rework_qty >= 0),
  reason         text,
  created_at     timestamptz not null default now()
);

alter table public.quality_control
  add column if not exists batch_no text,
  add column if not exists operation_name text,
  add column if not exists checked_qty integer default 0,
  add column if not exists passed_qty integer default 0,
  add column if not exists rework_qty integer default 0,
  add column if not exists reason text;

create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_id   text,
  action      text not null,
  actor_id    uuid default auth.uid(),
  actor_name  text,
  actor_role  text,
  old_data    jsonb,
  new_data    jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists record_id text,
  add column if not exists actor_id uuid default auth.uid(),
  add column if not exists actor_name text,
  add column if not exists actor_role text,
  add column if not exists old_data jsonb,
  add column if not exists new_data jsonb,
  add column if not exists reason text;

alter table public.audit_logs
  alter column actor_id set default auth.uid();

-- Fix record_audit_event() so BOTH bigint and uuid primary keys are audited in public.audit_logs
-- while also writing to legacy public.audit_log when record_id is a valid UUID
create or replace function public.record_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp_uuid uuid;
  v_emp_name text;
  v_emp_role text;
  v_rec_text text := coalesce(new.id::text, old.id::text);
  v_rec_uuid uuid := public.try_cast_uuid(v_rec_text);
  v_setting  text := nullif(current_setting('app.current_employee_id', true), '');
begin
  select
    coalesce(public.try_cast_uuid(e.id::text), e.user_id),
    coalesce(nullif(trim(e.name), ''), nullif(trim(e.full_name), ''), e.email),
    coalesce(nullif(trim(e.role_type), ''), nullif(trim(e.role::text), ''), nullif(trim(e.position), ''))
    into v_emp_uuid, v_emp_name, v_emp_role
    from public.employees e
   where (e.user_id = auth.uid() or e.id::text = coalesce(v_setting, auth.uid()::text))
   limit 1;

  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (
      table_name, record_id, action, actor_id, actor_name, actor_role, old_data, new_data
    ) values (
      tg_table_name,
      v_rec_text,
      upper(tg_op),
      coalesce(auth.uid(), v_emp_uuid),
      coalesce(v_emp_name, 'System / Trigger'),
      coalesce(v_emp_role, public.current_employee_role_text(), 'system'),
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    );
  end if;

  if v_rec_uuid is not null and to_regclass('public.audit_log') is not null then
    insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    values (
      tg_table_name,
      v_rec_uuid,
      lower(tg_op),
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
      v_emp_uuid
    );
  end if;

  return coalesce(new, old);
end;
$$;

-- Ensure database-level audit triggers exist across core operational tables (both bigint and uuid PKs)
drop trigger if exists audit_orders on public.orders;
create trigger audit_orders
  after insert or update or delete on public.orders
  for each row execute function public.record_audit_event();

drop trigger if exists audit_batches on public.batches;
create trigger audit_batches
  after insert or update or delete on public.batches
  for each row execute function public.record_audit_event();

drop trigger if exists audit_employees on public.employees;
create trigger audit_employees
  after insert or update or delete on public.employees
  for each row execute function public.record_audit_event();

drop trigger if exists audit_inventory_items on public.inventory_items;
create trigger audit_inventory_items
  after insert or update or delete on public.inventory_items
  for each row execute function public.record_audit_event();

drop trigger if exists audit_gold_transactions on public.gold_transactions;
create trigger audit_gold_transactions
  after insert or update or delete on public.gold_transactions
  for each row execute function public.record_audit_event();

drop trigger if exists audit_sales on public.sales;
create trigger audit_sales
  after insert or update or delete on public.sales
  for each row execute function public.record_audit_event();

drop trigger if exists audit_debt_repayments on public.debt_repayments;
create trigger audit_debt_repayments
  after insert or update or delete on public.debt_repayments
  for each row execute function public.record_audit_event();

drop trigger if exists audit_salary_ledger on public.salary_ledger;
create trigger audit_salary_ledger
  after insert or update or delete on public.salary_ledger
  for each row execute function public.record_audit_event();

drop trigger if exists audit_affinaj_records on public.affinaj_records;
create trigger audit_affinaj_records
  after insert or update or delete on public.affinaj_records
  for each row execute function public.record_audit_event();

drop trigger if exists audit_consumption on public.consumption;
create trigger audit_consumption
  after insert or update or delete on public.consumption
  for each row execute function public.record_audit_event();

create table if not exists public.system_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.stage_loss_configs (
  stage_order   integer primary key,
  stage_name    text not null,
  department    text not null,
  max_loss_pct  numeric(6, 3) not null default 1.0 check (max_loss_pct >= 0),
  max_loss_gram numeric(14, 4) not null default 0.5 check (max_loss_gram >= 0),
  updated_at    timestamptz not null default now()
);

-- 12. Guarded Unique Indexes on Pre-Existing Tables (orders.order_no, batches.batch_no,
--     batch_stage_wip (batch_no, stage_order), products.name, employees email)
--     Creates UNIQUE index when no duplicate rows exist; otherwise creates a lookup index
--     and emits a WARNING so pre-existing production data never aborts the migration.
do $$
begin
  -- orders.order_no
  if not exists (
    select 1 from public.orders
     where order_no is not null and btrim(order_no) <> ''
     group by order_no having count(*) > 1
  ) then
    create unique index if not exists idx_orders_order_no_unique
      on public.orders (order_no)
      where order_no is not null and btrim(order_no) <> '';
  else
    raise warning 'Duplicate order_no values detected in public.orders; creating non-unique lookup index';
    create index if not exists idx_orders_order_no_lookup on public.orders (order_no);
  end if;

  -- batches.batch_no
  if not exists (
    select 1 from public.batches
     where batch_no is not null and btrim(batch_no) <> ''
     group by batch_no having count(*) > 1
  ) then
    create unique index if not exists idx_batches_batch_no_unique
      on public.batches (batch_no)
      where batch_no is not null and btrim(batch_no) <> '';
  else
    raise warning 'Duplicate batch_no values detected in public.batches; creating non-unique lookup index';
    create index if not exists idx_batches_batch_no_lookup on public.batches (batch_no);
  end if;

  -- batch_stage_wip (batch_no, stage_order)
  if not exists (
    select 1 from public.batch_stage_wip
     group by batch_no, stage_order having count(*) > 1
  ) then
    create unique index if not exists idx_batch_stage_wip_batch_stage_unique
      on public.batch_stage_wip (batch_no, stage_order);
  else
    raise warning 'Duplicate (batch_no, stage_order) values detected in public.batch_stage_wip; creating non-unique lookup index';
    create index if not exists idx_batch_stage_wip_batch_stage_lookup on public.batch_stage_wip (batch_no, stage_order);
  end if;

  -- products.name
  if not exists (
    select 1 from public.products
     where name is not null and btrim(name) <> ''
     group by name having count(*) > 1
  ) then
    create unique index if not exists idx_products_name_unique
      on public.products (name)
      where name is not null and btrim(name) <> '';
  else
    raise warning 'Duplicate name values detected in public.products; creating non-unique lookup index';
    create index if not exists idx_products_name_lookup on public.products (name);
  end if;

  -- employees case-insensitive email
  if not exists (
    select 1 from public.employees
     where email is not null and btrim(email) <> ''
     group by lower(btrim(email)) having count(*) > 1
  ) then
    create unique index if not exists idx_employees_email_lower_unique
      on public.employees (lower(btrim(email)))
      where email is not null and btrim(email) <> '';
  else
    raise warning 'Duplicate email values detected in public.employees; creating non-unique lookup index';
    create index if not exists idx_employees_email_lower_lookup on public.employees (lower(btrim(email)));
  end if;
end $$;
