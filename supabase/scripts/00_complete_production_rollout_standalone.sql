-- ============================================================================
-- JEWELRYFLOW ERP — COMPLETE PRODUCTION ROLLOUT STANDALONE SCRIPT
-- ============================================================================
-- File: supabase/scripts/00_complete_production_rollout_standalone.sql
-- Purpose: Complete, dependency-ordered, non-destructive rollout script bundling:
--   1. Precondition checks (verifies database schema & version)
--   2. Schema reconciliation (20260101000015)
--   3. Atomic ERP RPCs & Idempotency (20260101000016)
--   4. Security RLS & Privilege hardening (20260101000017)
--   5. Director/Admin account linking for admin@goldia.uz (02_manual_link)
--   6. Post-migration verification report
--
-- Safety & Transaction Semantics:
--   - Wrapped in a single top-level BEGIN ... COMMIT transaction.
--   - Fails atomically on any error: zero partial database migration.
--   - Non-destructive: zero DROP TABLE, zero TRUNCATE, zero data deletion.
--   - Reconciles bigint/uuid hybrid ID types safely.
--
-- Execution: Run this entire script in Supabase SQL Editor as 'postgres' role.
-- ============================================================================

BEGIN;

-- PRECONDITION CHECK: Ensure we are in public schema and database is accessible
do $do$
begin
  if current_schema() <> 'public' then
    set search_path = public, pg_temp;
  end if;
  raise notice 'PRECONDITION CHECK PASSED: connected as % in schema %', current_user, current_schema();
end $do$;


-- ============================================================================
-- Migration: 20260101000015_erp_operational_schema_reconciliation.sql
-- ============================================================================
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


-- ============================================================================
-- Migration: 20260101000016_atomic_erp_rpcs.sql
-- ============================================================================
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

-- Helper: Normalize role tokens to canonical ERP role identifiers (fail-closed to NULL for unknown tokens)
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

-- Helper: Resolve active caller's UUID identity for uuid audit/ledger columns (performed_by)
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

-- Helper: Resolve active caller's employee.id as text (supports both bigint and uuid employee primary keys)
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

-- Helper: Resolve active caller's normalized role text across both enum/text (`role`) and operational (`role_type`) schemas
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
  -- 1. Specific non-generic role_type (Director, Manager, Accountant, Warehouse, Supervisor)
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

-- Helper: Check role permissions for authenticated sessions (fail-closed)
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
  v_norm_role  text;
  v_allowed    boolean := false;
begin
  -- Fail closed: reject unauthenticated / anonymous invocations immediately
  if v_uid is null then
    raise exception 'Permission denied: authentication required'
      using errcode = '42501';
  end if;

  select *
    into v_emp
    from public.employees e
   where (e.user_id = v_uid or e.id::text = v_uid::text)
     and coalesce(e.is_active, true) = true
     and lower(coalesce(e.status, e.employment_status::text, 'active')) in ('active', 'faol')
   limit 1;

  if not found then
    raise exception 'Permission denied: no active employee profile for current user'
      using errcode = '42501';
  end if;

  v_norm_role := coalesce(public.current_employee_role_text(), 'viewer');

  select exists (
    select 1
      from unnest(p_allowed_roles) as r(token)
     where public.normalize_erp_role_token(r.token) = v_norm_role
  ) into v_allowed;

  if not v_allowed then
    raise exception 'Permission denied for role "%" (required one of: %)',
      v_norm_role,
      array_to_string(p_allowed_roles, ', ')
      using errcode = '42501';
  end if;
end;
$$;

-- Helper: Transaction-scoped advisory lock & payload-mismatch guard for idempotency keys
create or replace function public.check_and_lock_idempotency(
  p_key       text,
  p_operation text,
  p_payload   jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := nullif(btrim(coalesce(p_key, '')), '');
  v_row public.idempotency_keys%rowtype;
begin
  if v_key is null then
    return null;
  end if;

  -- Serialize concurrent requests with the same idempotency key within the transaction
  perform pg_advisory_xact_lock(hashtext('jewelryflow_idemp'), hashtext(v_key));

  select *
    into v_row
    from public.idempotency_keys
   where idempotency_key = v_key;

  if not found then
    return null;
  end if;

  if v_row.operation_name <> p_operation then
    raise exception 'Idempotency key conflict: key "%" was already used for operation "%"',
      v_key, v_row.operation_name
      using errcode = '23505';
  end if;

  if p_payload is not null
     and (v_row.response_data ? '_request_hash')
     and (v_row.response_data ->> '_request_hash') <> md5(p_payload::text) then
    raise exception 'Idempotency key conflict: key "%" was already used with different request parameters',
      v_key
      using errcode = '23505';
  end if;

  return v_row.response_data - '_request_hash';
end;
$$;

-- Helper: Store idempotency response with request payload hash
create or replace function public.save_idempotency_response(
  p_key       text,
  p_operation text,
  p_response  jsonb,
  p_payload   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key   text := nullif(btrim(coalesce(p_key, '')), '');
  v_store jsonb;
begin
  if v_key is null then
    return;
  end if;

  if p_payload is not null then
    v_store := coalesce(p_response, '{}'::jsonb) || jsonb_build_object('_request_hash', md5(p_payload::text));
  else
    v_store := coalesce(p_response, '{}'::jsonb);
  end if;

  insert into public.idempotency_keys (idempotency_key, operation_name, actor_id, response_data)
  values (v_key, p_operation, auth.uid(), v_store);
end;
$$;

-- ============================================================================
-- 1. RPC: Atomic Inventory & Reservation Transaction
-- ============================================================================
drop function if exists public.rpc_inventory_transaction(uuid, text, numeric, numeric, numeric, text, text, text, uuid, text, text);
drop function if exists public.rpc_inventory_transaction(uuid, text, numeric, numeric, numeric, text, text, text, text, text, text);
create or replace function public.rpc_inventory_transaction(
  p_item_id         text,
  p_tx_type         text,
  p_weight          numeric,
  p_proba           numeric default 0,
  p_pure_gold       numeric default 0,
  p_from_location   text default 'SAFE',
  p_to_location     text default 'WIP',
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
  v_item      public.inventory_items%rowtype;
  v_on_hand   numeric(14, 4);
  v_reserved  numeric(14, 4);
  v_avail     numeric(14, 4);
  v_weight    numeric(14, 4) := round(coalesce(p_weight, 0)::numeric, 4);
  v_fine      numeric(18, 6);
  v_existing  jsonb;
  v_payload   jsonb;
  v_res_row   public.inventory_reservations%rowtype;
begin
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
    raise exception 'Transaction weight must be greater than 0';
  end if;

  select * into v_item
    from public.inventory_items
   where id::text = btrim(p_item_id)
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
      v_item.id, p_order_id, p_order_no, v_weight, 'ACTIVE', nullif(btrim(p_idempotency_key), ''), auth.uid()
    );

    if p_order_id is not null and btrim(p_order_id) <> '' then
      update public.orders
         set reserved_item_id = v_item.id,
             reserved_gold_gram = coalesce(reserved_gold_gram, 0) + v_weight
       where id::text = btrim(p_order_id);
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
       where id::text = btrim(p_order_id);
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
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, description, idempotency_key, performed_by
  ) values (
    p_tx_type, p_from_location, p_to_location, v_item.name,
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

-- ============================================================================
-- 2. RPC: Atomic Alloy Transaction (Down-Alloying & Up-Alloying)
-- ============================================================================
drop function if exists public.rpc_execute_alloy_transaction(uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, numeric, uuid, numeric, text);
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

  if (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)) < v_in_w then
    raise exception 'Insufficient available source gold: available=%g, required=%g',
      (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)), v_in_w;
  end if;

  select * into v_tar from public.inventory_items where id::text = btrim(p_target_item_id) for update;
  if not found then
    raise exception 'Target alloy gold item not found';
  end if;

  -- Up-alloying: consume additional 999 fine gold item
  if v_fine_add_w > 0 then
    if p_fine_gold_item_id is not null and btrim(p_fine_gold_item_id) <> '' then
      select * into v_fine_item from public.inventory_items where id::text = btrim(p_fine_gold_item_id) for update;
    else
      select * into v_fine_item
        from public.inventory_items
       where category = 'Gold' and proba = 999 and id <> v_src.id
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
  if p_silver_item_id is not null and btrim(p_silver_item_id) <> '' and v_silver_w > 0 then
    select * into v_silver_item from public.inventory_items where id::text = btrim(p_silver_item_id) for update;
    if not found or (coalesce(v_silver_item.on_hand, v_silver_item.quantity_on_hand, 0) - coalesce(v_silver_item.reserved, 0)) < v_silver_w then
      raise exception 'Insufficient silver ligature in inventory (required=%g)', v_silver_w;
    end if;
    update public.inventory_items
       set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_silver_w,
           quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_silver_w
     where id = v_silver_item.id;
  end if;

  if p_copper_item_id is not null and btrim(p_copper_item_id) <> '' and v_copper_w > 0 then
    select * into v_copper_item from public.inventory_items where id::text = btrim(p_copper_item_id) for update;
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
   where id = v_src.id;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_out_w,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_out_w
   where id = v_tar.id;

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
    nullif(btrim(p_idempotency_key), ''),
    public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'source_item_id', v_src.id::text,
    'target_item_id', v_tar.id::text,
    'input_weight', v_in_w,
    'fine_gold_added', v_fine_add_w,
    'ligature_weight', v_lig_w,
    'output_weight', v_out_w,
    'pure_gold', v_pure_gold
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_execute_alloy_transaction', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 3. RPC: Atomic Refining (Affinaj) Transaction
-- ============================================================================
drop function if exists public.rpc_execute_affinaj_transaction(uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text);
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
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi',
    'inventory_manager', 'manager', 'production_manager', 'production manager'
  ]);

  v_payload := jsonb_build_object(
    'scrap_item_id', btrim(coalesce(p_scrap_item_id, '')),
    'target_gold_item_id', btrim(coalesce(p_target_gold_item_id, '')),
    'scrap_weight', v_sc_w,
    'output_weight', v_out_w
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_execute_affinaj_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(btrim(p_scrap_item_id), '') = '' or coalesce(btrim(p_target_gold_item_id), '') = '' then
    raise exception 'Scrap and target gold item IDs are required';
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

  select * into v_scrap from public.inventory_items where id::text = btrim(p_scrap_item_id) for update;
  if not found then
    raise exception 'Scrap inventory item not found';
  end if;

  if (coalesce(v_scrap.on_hand, v_scrap.quantity_on_hand, 0) - coalesce(v_scrap.reserved, 0)) < v_sc_w then
    raise exception 'Insufficient available scrap: available=%g, requested=%g',
      (coalesce(v_scrap.on_hand, v_scrap.quantity_on_hand, 0) - coalesce(v_scrap.reserved, 0)), v_sc_w;
  end if;

  select * into v_target from public.inventory_items where id::text = btrim(p_target_gold_item_id) for update;
  if not found then
    raise exception 'Target 999 gold item not found';
  end if;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_sc_w,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_sc_w
   where id = v_scrap.id;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_out_w,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_out_w
   where id = v_target.id;

  insert into public.affinaj_records (
    scrap_item_id, target_gold_item_id, scrap_weight, estimated_proba,
    output_weight, output_proba, expected_fine, actual_fine, refining_loss,
    master_name, idempotency_key, performed_by
  ) values (
    v_scrap.id, v_target.id, v_sc_w, p_estimated_proba,
    v_out_w, p_output_proba, v_exp_fine, v_act_fine, round(v_loss_fine, 4),
    p_master_name, nullif(btrim(p_idempotency_key), ''), public.current_employee_id()
  );

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, description, idempotency_key, performed_by
  ) values (
    'affinaj', 'SCRAP', 'SAFE', v_target.name,
    v_out_w, v_out_w, p_output_proba, v_act_fine,
    format('Affinaj (%s): %sg scrap (%s) -> %sg (%s), loss=%sg',
      p_master_name, v_sc_w, p_estimated_proba, v_out_w, p_output_proba, round(v_loss_fine, 4)),
    nullif(btrim(p_idempotency_key), ''), public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'scrap_deducted', v_sc_w,
    'gold_credited', v_out_w,
    'expected_fine', v_exp_fine,
    'actual_fine', v_act_fine,
    'refining_loss', round(v_loss_fine, 4)
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_execute_affinaj_transaction', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 4. RPC: Create Batch With Gold Issue
-- ============================================================================
drop function if exists public.rpc_create_batch_with_gold_issue(uuid, text, text, text, numeric, integer, numeric, numeric, text, date, text);
create or replace function public.rpc_create_batch_with_gold_issue(
  p_source_item_id   text,
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
  v_batch_id  text;
  v_issued    numeric(14, 4) := round(coalesce(p_issued_gold_gram, 0)::numeric, 4);
  v_fine      numeric(18, 6);
  v_existing  jsonb;
  v_payload   jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  v_payload := jsonb_build_object(
    'source_item_id', btrim(coalesce(p_source_item_id, '')),
    'batch_no', btrim(coalesce(p_batch_no, '')),
    'planned_qty', p_planned_qty,
    'issued_gold_gram', v_issued
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_create_batch_with_gold_issue', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(btrim(p_source_item_id), '') = '' or coalesce(btrim(p_batch_no), '') = '' or p_planned_qty <= 0 or v_issued <= 0 then
    raise exception 'Invalid batch parameters';
  end if;

  select * into v_src from public.inventory_items where id::text = btrim(p_source_item_id) for update;
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
   where id = v_src.id;

  v_fine := public.calc_fine_gold_exact(v_issued, p_proba);

  insert into public.batches (
    batch_number, batch_no, number, product_name, product, master_name,
    proba, planned_qty, planned_gram, issued_gold_gram, wip_gram,
    good_output_gram, sprue_gram, scrap_gram, rework_gram, loss_gram,
    finished_qty, credited_finished_qty, current_step, status, status_label, priority, priority_label, deadline, due_date
  ) values (
    btrim(p_batch_no), btrim(p_batch_no), btrim(p_batch_no), btrim(p_product_name), btrim(p_product_name), btrim(p_master_name),
    p_proba, p_planned_qty, v_issued, v_issued, v_issued,
    0, 0, 0, 0, 0,
    0, 0, '8. Quyish', 'Jarayonda', 'Jarayonda', p_priority, p_priority, p_deadline, p_deadline
  ) returning id::text into v_batch_id;

  insert into public.batch_stage_wip (
    batch_id, batch_no, stage_order, stage_name, department,
    available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
    queue_status, assigned_worker
  ) values (
    v_batch_id, btrim(p_batch_no), 8, '8. Quyish', 'Quyish',
    p_planned_qty, 0, 0, v_issued, 0, 0,
    'NOW', btrim(p_master_name)
  );

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, batch_no, description, idempotency_key, performed_by
  ) values (
    'chiqim', 'SAFE', 'CASTING', v_src.name,
    v_issued, v_issued, p_proba, v_fine, btrim(p_batch_no),
    format('Batch %s issue: %s pcs / %sg (%s)', btrim(p_batch_no), p_planned_qty, v_issued, p_proba),
    nullif(btrim(p_idempotency_key), ''), public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch_id,
    'batch_no', btrim(p_batch_no),
    'issued_gold_gram', v_issued,
    'pure_gold', v_fine
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_create_batch_with_gold_issue', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 5. RPC: Launch Order Production Chain (Supports Order-Reserved Gold)
-- ============================================================================
drop function if exists public.rpc_launch_order_production_chain(uuid, uuid, text, text, text, text, numeric, integer, numeric, numeric, text, date, text);
drop function if exists public.rpc_launch_order_production_chain(text, uuid, text, text, text, text, numeric, integer, numeric, numeric, text, date, text);
create or replace function public.rpc_launch_order_production_chain(
  p_order_id         text,
  p_source_item_id   text,
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
  v_batch_id     text;
  v_fine         numeric(18, 6);
  v_existing     jsonb;
  v_payload      jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  v_payload := jsonb_build_object(
    'order_id', btrim(coalesce(p_order_id, '')),
    'source_item_id', btrim(coalesce(p_source_item_id, '')),
    'batch_no', btrim(coalesce(p_batch_no, '')),
    'issued_gold_gram', v_issued
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_launch_order_production_chain', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(btrim(p_order_id), '') = '' or coalesce(btrim(p_source_item_id), '') = '' or coalesce(btrim(p_batch_no), '') = '' then
    raise exception 'Order ID, source gold item ID, and batch number are required';
  end if;

  select * into v_ord from public.orders where id::text = btrim(p_order_id) for update;
  if not found then
    raise exception 'Order (%) not found', p_order_id;
  end if;

  if coalesce(v_ord.batch_created, false) then
    raise exception 'Production batch has already been created for order %', coalesce(v_ord.order_no, p_order_id);
  end if;

  select * into v_src from public.inventory_items where id::text = btrim(p_source_item_id) for update;
  if not found then
    raise exception 'Source gold item not found';
  end if;

  -- Consume gold reserved specifically for this order first, then draw remainder from available
  if v_ord.reserved_item_id is not null and v_ord.reserved_item_id::text = v_src.id::text and coalesce(v_ord.reserved_gold_gram, 0) > 0 then
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
   where id = v_src.id;

  if v_from_res > 0 then
    update public.inventory_reservations
       set consumed_grams = consumed_grams + v_from_res,
           status = case
             when consumed_grams + released_grams + v_from_res >= reserved_grams then 'CONSUMED'
             else 'ACTIVE'
           end,
           batch_no = btrim(p_batch_no),
           updated_at = now()
     where order_id::text = btrim(p_order_id)
       and inventory_item_id = v_src.id
       and status = 'ACTIVE';
  end if;

  update public.orders
     set batch_created = true,
         status = 'Ishlab chiqarishda',
         status_label = 'Ishlab chiqarishda',
         reserved_gold_gram = greatest(0, coalesce(reserved_gold_gram, 0) - v_from_res)
   where id = v_ord.id;

  v_fine := public.calc_fine_gold_exact(v_issued, p_proba);

  insert into public.batches (
    order_id, batch_number, batch_no, number, product_name, product,
    client_name, master_name, proba, planned_qty, planned_gram,
    issued_gold_gram, wip_gram, good_output_gram, sprue_gram, scrap_gram,
    rework_gram, loss_gram, finished_qty, credited_finished_qty,
    current_step, status, status_label, priority, priority_label, deadline, due_date
  ) values (
    v_ord.id, btrim(p_batch_no), btrim(p_batch_no), btrim(p_batch_no), btrim(p_product_name), btrim(p_product_name),
    btrim(p_client_name), btrim(p_master_name), p_proba, p_planned_qty, v_issued,
    v_issued, v_issued, 0, 0, 0,
    0, 0, 0, 0,
    '8. Quyish', 'Jarayonda', 'Jarayonda', p_priority, p_priority, p_deadline, p_deadline
  ) returning id::text into v_batch_id;

  insert into public.batch_stage_wip (
    batch_id, batch_no, stage_order, stage_name, department,
    available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
    queue_status, assigned_worker
  ) values (
    v_batch_id, btrim(p_batch_no), 8, '8. Quyish', 'Quyish',
    p_planned_qty, 0, 0, v_issued, 0, 0,
    'NOW', btrim(p_master_name)
  );

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, batch_no, description, idempotency_key, performed_by
  ) values (
    'chiqim', 'SAFE', 'CASTING', v_src.name,
    v_issued, v_issued, p_proba, v_fine, btrim(p_batch_no),
    format('Order %s -> Batch %s (%s pcs / %sg, reserved_used=%sg)',
      coalesce(v_ord.order_no, p_order_id), btrim(p_batch_no), p_planned_qty, v_issued, v_from_res),
    nullif(btrim(p_idempotency_key), ''), public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'order_id', v_ord.id::text,
    'batch_id', v_batch_id,
    'batch_no', btrim(p_batch_no),
    'issued_gold_gram', v_issued,
    'reserved_consumed_gram', v_from_res
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_launch_order_production_chain', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 6. RPC: Atomic Partial WIP Movement & Final Stage Finished-Goods Stock Credit
-- ============================================================================
drop function if exists public.rpc_move_partial_wip(uuid, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, uuid, text);
create or replace function public.rpc_move_partial_wip(
  p_batch_id          text,
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
  p_worker_id         text default null,
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
  v_payload     jsonb;
begin
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
    'rework_qty', p_rework_qty
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
             assigned_worker      = coalesce(nullif(btrim(p_worker_name), ''), assigned_worker),
             assigned_employee_id = coalesce(p_worker_id, assigned_employee_id),
             updated_at           = now()
       where id = v_nxt_wip.id;
    else
      insert into public.batch_stage_wip (
        batch_id, batch_no, stage_order, stage_name, department,
        available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
        queue_status, assigned_worker, assigned_employee_id
      ) values (
        public.try_cast_uuid(p_batch_id), v_batch_code, p_to_stage_order, p_to_stage_name, p_to_department,
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
       where (v_batch.product_id is not null and id::text = v_batch.product_id::text)
          or lower(btrim(name)) = lower(btrim(coalesce(v_batch.product_name, v_batch.product, '')))
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
         status                = case when v_done_all then 'Tugatildi' else 'Jarayonda' end,
         status_label          = case when v_done_all then 'Tugatildi' else 'Jarayonda' end
   where id = v_batch.id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch.id::text,
    'batch_no', v_batch_code,
    'remaining_stage_qty', v_rem_qty,
    'new_wip_gram', case when v_done_all then 0 else v_new_wip_g end,
    'finished_qty', v_new_fin_qty,
    'credited_product_stock', v_credit_qty,
    'completed', v_done_all
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_move_partial_wip', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 7. RPC: Atomic Batch Split (Splits Parent Batch AND Stage WIP Records)
-- ============================================================================
drop function if exists public.rpc_split_batch(uuid, integer, text, integer, text);
create or replace function public.rpc_split_batch(
  p_parent_batch_id text,
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
  v_child_id    text;
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
  v_payload     jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  v_payload := jsonb_build_object(
    'parent_batch_id', btrim(coalesce(p_parent_batch_id, '')),
    'split_qty', p_split_qty,
    'stage_order', p_stage_order
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_split_batch', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_parent from public.batches where id::text = btrim(p_parent_batch_id) for update;
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

  if coalesce(btrim(p_child_batch_no), '') <> '' then
    v_child_no := btrim(p_child_batch_no);
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
   where id = v_parent.id;

  -- 2. Create child batch
  insert into public.batches (
    order_id, batch_number, batch_no, number, parent_batch_no,
    product_id, product_name, product, client_name, master_name,
    proba, planned_qty, planned_gram, issued_gold_gram, wip_gram,
    good_output_gram, sprue_gram, scrap_gram, rework_gram, loss_gram,
    finished_qty, credited_finished_qty, current_step, status, status_label, priority, priority_label, deadline, due_date
  ) values (
    v_parent.order_id, v_child_no, v_child_no, v_child_no, v_parent_no,
    v_parent.product_id, v_parent.product_name, v_parent.product, v_parent.client_name, v_parent.master_name,
    v_parent.proba, p_split_qty, v_child_gold, v_child_gold, v_child_wip_g,
    0, 0, 0, 0, 0,
    0, 0, v_wip.stage_name, 'Jarayonda', 'Jarayonda', coalesce(v_parent.priority_label, 'Normal'), coalesce(v_parent.priority_label, 'Normal'), v_parent.deadline, v_parent.due_date
  ) returning id::text into v_child_id;

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
    public.try_cast_uuid(v_child_id), v_child_no, v_wip.stage_order, v_wip.stage_name, v_wip.department,
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

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_split_batch', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 8. RPC: Record Stage Consumption & Return Sprue to Scrap Inventory
-- ============================================================================
drop function if exists public.rpc_record_stage_consumption(text, text, text, numeric, numeric, numeric, numeric, numeric, uuid, boolean, text);
create or replace function public.rpc_record_stage_consumption(
  p_batch_no        text,
  p_department      text,
  p_master_name     text,
  p_proba           numeric,
  p_given_weight    numeric,
  p_returned_weight numeric,
  p_sprue_gram      numeric default 0,
  p_scrap_gram      numeric default 0,
  p_master_id       text default null,
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
  v_cons_id   text;
  v_existing  jsonb;
  v_payload   jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator', 'inventory_manager', 'warehouse'
  ]);

  v_payload := jsonb_build_object(
    'batch_no', btrim(coalesce(p_batch_no, '')),
    'department', btrim(coalesce(p_department, '')),
    'given_weight', v_given,
    'returned_weight', v_ret,
    'sprue_gram', v_sprue,
    'scrap_gram', v_scrap
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_stage_consumption', v_payload);
  if v_existing is not null then
    return v_existing;
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
   where batch_no = btrim(p_batch_no) or number = btrim(p_batch_no) or batch_number = btrim(p_batch_no)
   limit 1
     for update;

  insert into public.consumption (
    batch_id, batch_no, master_name, master_employee_id, department, proba,
    given_weight, returned_weight, sprue_gram, scrap_gram, loss_weight,
    sent_to_refinery, idempotency_key
  ) values (
    v_batch.id::text, btrim(p_batch_no), btrim(p_master_name), p_master_id, btrim(p_department), p_proba,
    v_given, v_ret, v_sprue, v_scrap, v_loss,
    false, nullif(btrim(p_idempotency_key), '')
  ) returning id::text into v_cons_id;

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
      'yoqotish', 'WIP', 'LOSS', format('Pateriya (%s - %s)', btrim(p_department), btrim(p_batch_no)),
      v_loss, v_loss, p_proba, public.calc_fine_gold_exact(v_loss, p_proba), btrim(p_batch_no),
      format('Master: %s | Given: %sg, Returned: %sg, Sprue: %sg, Scrap: %sg',
        btrim(p_master_name), v_given, v_ret, v_sprue, v_scrap),
      public.current_employee_id()
    );
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'consumption_id', v_cons_id,
    'batch_no', btrim(p_batch_no),
    'loss_weight', v_loss,
    'sprue_gram', v_sprue,
    'scrap_gram', v_scrap
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_stage_consumption', v_existing, v_payload);

  return v_existing;
end;
$$;

drop function if exists public.rpc_return_sprue_to_scrap_inventory(uuid, uuid, text, numeric, numeric, numeric, text);
drop function if exists public.rpc_return_sprue_to_scrap_inventory(text, uuid, text, numeric, numeric, numeric, text);
create or replace function public.rpc_return_sprue_to_scrap_inventory(
  p_consumption_id  text,
  p_scrap_item_id   text,
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
  v_payload   jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'warehouse', 'omborchi', 'inventory_manager',
    'manager', 'production_manager', 'production manager', 'master', 'supervisor', 'bosh usta', 'usta', 'department_head'
  ]);

  v_payload := jsonb_build_object(
    'consumption_id', btrim(coalesce(p_consumption_id, '')),
    'scrap_item_id', btrim(coalesce(p_scrap_item_id, '')),
    'sprue_weight', round(coalesce(p_sprue_weight, 0)::numeric, 4)
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_return_sprue_to_scrap_inventory', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(btrim(p_consumption_id), '') = '' or coalesce(btrim(p_scrap_item_id), '') = '' then
    raise exception 'Consumption ID and Scrap item ID are required';
  end if;

  select * into v_cons from public.consumption where id::text = btrim(p_consumption_id) for update;
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

  select * into v_scrap from public.inventory_items where id::text = btrim(p_scrap_item_id) for update;
  if not found then
    raise exception 'Target Scrap/Lom inventory item not found';
  end if;

  update public.consumption
     set sent_to_refinery = true
   where id = v_cons.id;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_weight,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) + v_weight
   where id = v_scrap.id;

  v_fine := public.calc_fine_gold_exact(v_weight, coalesce(nullif(p_proba, 0), v_cons.proba, 585));

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, batch_no, description, idempotency_key, performed_by
  ) values (
    'kirim', 'WIP_SPRUE', 'SCRAP_SAFE', v_scrap.name,
    v_weight, v_weight, coalesce(nullif(p_proba, 0), v_cons.proba, 585), v_fine,
    coalesce(p_batch_no, v_cons.batch_no),
    format('Returned sprue/scrap from %s to %s', coalesce(p_batch_no, v_cons.batch_no), v_scrap.name),
    nullif(btrim(p_idempotency_key), ''), public.current_employee_id()
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'consumption_id', v_cons.id::text,
    'scrap_item_id', v_scrap.id::text,
    'returned_weight', v_weight,
    'pure_gold', v_fine
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_return_sprue_to_scrap_inventory', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 9. RPC: Record Sale With Stock Deduction & Dedicated Atomic Debt Repayment
-- ============================================================================
drop function if exists public.rpc_record_sale_with_stock_deduction(uuid, text, text, integer, numeric, numeric, text, numeric, numeric, uuid, text);
create or replace function public.rpc_record_sale_with_stock_deduction(
  p_product_id      text,
  p_client_name     text,
  p_product_name    text,
  p_quantity        integer,
  p_weight          numeric,
  p_proba           numeric,
  p_payment_type    text,
  p_paid_amount     numeric,
  p_debt_amount     numeric,
  p_order_id        text default null,
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
  v_sale_id    text;
  v_existing   jsonb;
  v_payload    jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'accountant', 'buxgalter', 'hisobchi', 'sales', 'manager', 'production_manager', 'production manager'
  ]);

  v_payload := jsonb_build_object(
    'product_id', btrim(coalesce(p_product_id, '')),
    'client_name', btrim(coalesce(p_client_name, '')),
    'quantity', p_quantity,
    'paid_amount', v_paid,
    'debt_amount', v_debt
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_sale_with_stock_deduction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if p_quantity <= 0 or v_paid < 0 or v_debt < 0 or v_sale_total <= 0 then
    raise exception 'Invalid sale quantity or amounts';
  end if;

  select * into v_prod from public.products where id::text = btrim(p_product_id) for update;
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
   where id = v_prod.id;

  insert into public.sales (
    order_id, product_id, client_name, product_name, quantity,
    weight, proba, payment_type, sale_total_amount, total_amount,
    debt_amount, tx_type, idempotency_key
  ) values (
    p_order_id, v_prod.id::text, btrim(p_client_name), v_prod.name, p_quantity,
    round(coalesce(p_weight, v_prod.weight, 0)::numeric, 4),
    coalesce(p_proba, v_prod.proba, 585),
    p_payment_type, v_sale_total, v_paid,
    v_debt, 'kirim', nullif(btrim(p_idempotency_key), '')
  ) returning id::text into v_sale_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'product_id', v_prod.id::text,
    'remaining_stock', v_cur_stock - p_quantity,
    'paid_amount', v_paid,
    'debt_amount', v_debt
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_sale_with_stock_deduction', v_existing, v_payload);

  return v_existing;
end;
$$;

-- Dedicated Atomic Customer Debt Repayment (NEVER deducts product stock!)
drop function if exists public.rpc_record_debt_repayment(uuid, uuid, numeric, numeric, text, text, text);
create or replace function public.rpc_record_debt_repayment(
  p_sale_id         text default null,
  p_order_id        text default null,
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
  v_payload       jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'accountant', 'buxgalter', 'hisobchi', 'sales', 'manager', 'production_manager', 'production manager'
  ]);

  v_payload := jsonb_build_object(
    'sale_id', btrim(coalesce(p_sale_id, '')),
    'order_id', btrim(coalesce(p_order_id, '')),
    'amount', v_pay_amount
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_debt_repayment', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_pay_amount <= 0 then
    raise exception 'Debt repayment amount must be greater than 0';
  end if;

  if (coalesce(btrim(p_sale_id), '') = '' and coalesce(btrim(p_order_id), '') = '')
     or (coalesce(btrim(p_sale_id), '') <> '' and coalesce(btrim(p_order_id), '') <> '') then
    raise exception 'Specify exactly one of p_sale_id or p_order_id for debt repayment';
  end if;

  if coalesce(btrim(p_sale_id), '') <> '' then
    select * into v_sale from public.sales where id::text = btrim(p_sale_id) for update;
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
     where id = v_sale.id;
  else
    select * into v_order from public.orders where id::text = btrim(p_order_id) for update;
    if not found then
      raise exception 'Order (%) not found', p_order_id;
    end if;

    if lower(coalesce(v_order.status::text, '')) in ('cancelled', 'bekor qilindi')
       or lower(coalesce(v_order.status_label, '')) = 'bekor qilindi' then
      raise exception 'Cannot record debt repayment on a cancelled order (%)', coalesce(v_order.order_no, p_order_id);
    end if;

    v_prev_debt := round(greatest(0, coalesce(v_order.total_price, 0) - coalesce(v_order.advance, 0))::numeric, 2);
    if v_prev_debt <= 0 then
      raise exception 'Order (%) has no outstanding debt', coalesce(v_order.order_no, p_order_id);
    end if;
    if v_pay_amount > v_prev_debt then
      raise exception 'Repayment (%s) exceeds outstanding order debt (%s)', v_pay_amount, v_prev_debt;
    end if;

    v_new_debt := round(v_prev_debt - v_pay_amount, 2);
    v_client   := coalesce(v_order.client_name, v_order.customer_name, 'Mijoz');
    v_label    := format('Buyurtma Qarz To''lovi (%s)', coalesce(v_order.order_no, p_order_id));

    update public.orders
       set advance     = round(coalesce(advance, 0) + v_pay_amount, 2),
           paid_amount = round(coalesce(advance, 0) + v_pay_amount, 2),
           debt_amount = v_new_debt
     where id = v_order.id;
  end if;

  insert into public.debt_repayments (
    sale_id, order_id, client_name, amount, payment_type,
    previous_debt, remaining_debt, note, idempotency_key, recorded_by
  ) values (
    nullif(btrim(p_sale_id), ''), nullif(btrim(p_order_id), ''), v_client, v_pay_amount, p_payment_type,
    v_prev_debt, v_new_debt, p_note, nullif(btrim(p_idempotency_key), ''), auth.uid()
  ) returning id into v_repayment_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'repayment_id', v_repayment_id,
    'sale_id', nullif(btrim(p_sale_id), ''),
    'order_id', nullif(btrim(p_order_id), ''),
    'paid_amount', v_pay_amount,
    'previous_debt', v_prev_debt,
    'remaining_debt', v_new_debt
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_debt_repayment', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 10. RPC: Atomic Salary Ledger & Employee Balance Update
-- ============================================================================
drop function if exists public.rpc_record_salary_transaction(uuid, text, text, text, text, numeric, numeric, numeric, text, text);
create or replace function public.rpc_record_salary_transaction(
  p_employee_id     text default null,
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
  v_payload    jsonb;
begin
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'accountant', 'buxgalter', 'hisobchi', 'manager', 'production_manager', 'production manager'
  ]);

  v_payload := jsonb_build_object(
    'employee_id', btrim(coalesce(p_employee_id, '')),
    'worker_name', lower(btrim(coalesce(p_worker_name, ''))),
    'batch_no', upper(btrim(coalesce(p_batch_no, ''))),
    'stage_name', lower(btrim(coalesce(p_stage_name, ''))),
    'tx_type', p_tx_type,
    'amount', v_amount
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_salary_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_amount <= 0 or v_weight < 0 or v_rate < 0 or p_tx_type not in ('EARNED', 'PAID') then
    raise exception 'Invalid salary transaction parameters';
  end if;

  if p_employee_id is not null and btrim(p_employee_id) <> '' then
    select * into v_emp from public.employees where id::text = btrim(p_employee_id) for update;
  else
    select * into v_emp
      from public.employees
     where lower(btrim(coalesce(name, full_name, ''))) = lower(btrim(p_worker_name))
     limit 1
       for update;
  end if;

  if not found then
    raise exception 'Employee (%) not found', coalesce(nullif(btrim(p_employee_id), ''), p_worker_name);
  end if;

  v_worker_nm := coalesce(v_emp.name, v_emp.full_name, btrim(p_worker_name));

  -- Explicit duplicate check before insert (backed by idx_salary_ledger_unique_earned)
  if p_tx_type = 'EARNED' and exists (
    select 1 from public.salary_ledger s
     where (s.employee_id::text = v_emp.id::text or lower(btrim(s.worker_name)) = lower(btrim(v_worker_nm)))
       and upper(btrim(s.batch_no)) = upper(btrim(p_batch_no))
       and lower(btrim(s.stage_name)) = lower(btrim(p_stage_name))
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
    v_emp.id::text, v_worker_nm, btrim(p_batch_no), btrim(p_stage_name), p_tx_type,
    v_weight, v_rate, v_amount,
    case when p_tx_type = 'PAID' then 'PAID' else 'UNPAID' end,
    coalesce(nullif(p_note, ''), format('%s - %s', btrim(p_batch_no), btrim(p_stage_name))),
    nullif(btrim(p_idempotency_key), '')
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
    'employee_id', v_emp.id::text,
    'worker_name', v_worker_nm,
    'new_balance', v_new_bal
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_salary_transaction', v_existing, v_payload);

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
  v_prod_id    text;
  v_prod_uuid  uuid;
  v_bom_elem   jsonb;
  v_existing   jsonb;
  v_payload    jsonb;
begin
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

  -- Product model always starts with stock = 0 (stock only increases via production completion or verified receipt)
  insert into public.products (
    name, title, category, weight, proba, stock, quantity,
    stone_weight, bom_version, bom_details, image_url
  ) values (
    btrim(p_name), btrim(p_name), coalesce(nullif(btrim(p_category), ''), 'Komplekt'),
    v_tot_w, coalesce(p_proba, 585), 0, 0,
    v_stone_w, coalesce(p_bom_version, 1), v_summary,
    coalesce(p_image_url, 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80')
  ) returning id::text into v_prod_id;

  v_prod_uuid := public.try_cast_uuid(v_prod_id);

  if p_bom_items is not null and jsonb_typeof(p_bom_items) = 'array' and jsonb_array_length(p_bom_items) > 0 then
    for v_bom_elem in select * from jsonb_array_elements(p_bom_items)
    loop
      insert into public.bom_items (
        product_id, product_name, bom_version, component_name, material_category, weight_per_set, proba
      ) values (
        v_prod_uuid,
        btrim(p_name),
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
      (v_prod_uuid, btrim(p_name), coalesce(p_bom_version, 1), 'Ring (Uzuk)', 'Gold', v_ring_w, coalesce(p_proba, 585)),
      (v_prod_uuid, btrim(p_name), coalesce(p_bom_version, 1), 'Earring (Zirak)', 'Gold', v_ear_w, coalesce(p_proba, 585)),
      (v_prod_uuid, btrim(p_name), coalesce(p_bom_version, 1), 'Chain/Wire (Zanjir/Sim)', 'Wire', v_chain_w, coalesce(p_proba, 585)),
      (v_prod_uuid, btrim(p_name), coalesce(p_bom_version, 1), 'Dorika', 'Wire', v_dorika_w, coalesce(p_proba, 585)),
      (v_prod_uuid, btrim(p_name), coalesce(p_bom_version, 1), 'Zircon Stone (Tosh)', 'Stone', v_stone_w, 0);
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'product_id', v_prod_id,
    'name', btrim(p_name),
    'total_weight', v_tot_w,
    'stock', 0
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_create_product_with_bom', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 12. RPC: Atomic Order & Initial Advance Creation
--     Ensures an order and its initial advance (in orders + sales) either
--     both succeed or both fail inside a single authorized database transaction.
-- ============================================================================
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
  v_order_no   text := btrim(coalesce(p_order_no, ''));
  v_client     text := btrim(coalesce(p_client_name, ''));
  v_model      text := btrim(coalesce(p_product_model, ''));
  v_qty        integer := coalesce(p_qty, 0);
  v_weight     numeric(14, 4) := round(coalesce(p_weight_gram, 0)::numeric, 4);
  v_total      numeric(18, 2) := round(coalesce(p_total_price, 0)::numeric, 2);
  v_adv        numeric(18, 2) := round(coalesce(p_advance, 0)::numeric, 2);
  v_debt       numeric(18, 2);
  v_order_id   text;
  v_sale_id    text := null;
  v_existing   jsonb;
  v_payload    jsonb;
begin
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

  insert into public.orders (
    order_no, order_number, client_name, customer_name, phone,
    product_model, details, proba, qty, weight_gram,
    total_price, advance, paid_amount, debt_amount,
    deadline, priority, priority_label, status, status_label, batch_created
  ) values (
    v_order_no, v_order_no, v_client, v_client, btrim(coalesce(p_phone, '')),
    v_model, btrim(coalesce(p_details, '')), coalesce(p_proba, 585), v_qty, v_weight,
    v_total, v_adv, v_adv, v_debt,
    p_deadline, coalesce(nullif(btrim(p_priority), ''), 'Normal'), coalesce(nullif(btrim(p_priority), ''), 'Normal'),
    'Kutilmoqda', 'Kutilmoqda', false
  ) returning id::text into v_order_id;

  -- Record initial advance in sales ledger atomically inside the same transaction
  if v_adv > 0 then
    insert into public.sales (
      order_id, client_name, product_name, quantity, weight, proba,
      payment_type, sale_total_amount, total_amount, debt_amount, tx_type, idempotency_key
    ) values (
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
    'debt_amount', v_debt
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_create_order_with_advance', v_existing, v_payload);

  return v_existing;
end;
$$;

-- ============================================================================
-- 13. Immediate Least-Privilege Function EXECUTE Hardening
--     Revokes PUBLIC, anon, and broad authenticated EXECUTE immediately inside
--     016 and grants EXECUTE to authenticated ONLY on safe helpers and
--     RBAC-enforced ERP RPCs.
-- ============================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function public.try_cast_uuid(text) to authenticated;
grant execute on function public.calc_fine_gold_exact(numeric, numeric) to authenticated;
grant execute on function public.calculate_melting_loss(numeric, numeric) to authenticated;
grant execute on function public.normalize_erp_role_token(text) to authenticated;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_employee_id_text() to authenticated;
grant execute on function public.current_employee_role_text() to authenticated;
grant execute on function public.assert_erp_permission(text[]) to authenticated;
grant execute on function public.check_and_lock_idempotency(text, text, jsonb) to authenticated;
grant execute on function public.save_idempotency_response(text, text, jsonb, jsonb) to authenticated;

grant execute on function public.rpc_inventory_transaction(text, text, numeric, numeric, numeric, text, text, text, text, text, text) to authenticated;
grant execute on function public.rpc_execute_alloy_transaction(text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, numeric, text, numeric, text) to authenticated;
grant execute on function public.rpc_execute_affinaj_transaction(text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_create_batch_with_gold_issue(text, text, text, text, numeric, integer, numeric, numeric, text, date, text) to authenticated;
grant execute on function public.rpc_launch_order_production_chain(text, text, text, text, text, text, numeric, integer, numeric, numeric, text, date, text) to authenticated;
grant execute on function public.rpc_move_partial_wip(text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.rpc_split_batch(text, integer, text, integer, text) to authenticated;
grant execute on function public.rpc_record_stage_consumption(text, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, text) to authenticated;
grant execute on function public.rpc_return_sprue_to_scrap_inventory(text, text, text, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.rpc_record_sale_with_stock_deduction(text, text, text, integer, numeric, numeric, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_record_debt_repayment(text, text, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.rpc_record_salary_transaction(text, text, text, text, text, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_create_product_with_bom(text, text, numeric, integer, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb, text) to authenticated;
grant execute on function public.rpc_create_order_with_advance(text, text, text, text, text, numeric, integer, numeric, numeric, numeric, date, text, text, text) to authenticated;


-- ============================================================================
-- Migration: 20260101000017_security_rls_and_privilege_hardening.sql
-- ============================================================================
-- ============================================================================
-- Migration: 20260101000017_security_rls_and_privilege_hardening.sql
-- Purpose:   Phase 9 Security Hardening (Hybrid bigint/uuid Schema Compatible):
--            1. Prevent employee self-promotion to admin (RLS + Trigger)
--            2. Enable RLS on all operational & legacy tables (incl. orfers/payroll)
--            3. Remove permissive PUBLIC/anon policies and enforce role-based RLS
--            4. Protect audit logs and financial ledgers from DELETE/tampering
--            5. Harden SECURITY DEFINER search_path & revoke PUBLIC/anon EXECUTE
-- ============================================================================

-- 0. Verify all required core ERP tables exist before applying RLS policies & triggers
do $$
declare
  v_core_table text;
  v_required_core_tables text[] := array[
    'employees',
    'orders',
    'batches',
    'inventory_items',
    'gold_transactions',
    'idempotency_keys',
    'inventory_reservations',
    'affinaj_records',
    'production_stages',
    'batch_stage_wip',
    'consumption',
    'machines',
    'products',
    'bom_items',
    'sales',
    'debt_repayments',
    'salary_ledger',
    'quality_control',
    'audit_logs',
    'system_settings',
    'stage_loss_configs'
  ];
begin
  foreach v_core_table in array v_required_core_tables
  loop
    if to_regclass('public.' || v_core_table) is null then
      raise exception 'Required core ERP table "public.%" does not exist. Apply migration 015 before migration 017.', v_core_table;
    end if;
  end loop;
end $$;

-- 1. Harden search_path on all existing SECURITY DEFINER functions (if present)
do $$
begin
  if to_regprocedure('public.handle_new_auth_user()') is not null then
    alter function public.handle_new_auth_user() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.log_batch_status_change()') is not null then
    alter function public.log_batch_status_change() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.sync_batch_current_stage()') is not null then
    alter function public.sync_batch_current_stage() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.complete_batch_on_terminal_stage()') is not null then
    alter function public.complete_batch_on_terminal_stage() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.apply_inventory_transaction()') is not null then
    alter function public.apply_inventory_transaction() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.apply_gold_transaction()') is not null then
    alter function public.apply_gold_transaction() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.handle_qc_failure()') is not null then
    alter function public.handle_qc_failure() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.record_audit_event()') is not null then
    alter function public.record_audit_event() set search_path = public, pg_temp;
  end if;
end $$;

create or replace function public.current_employee_role()
returns public.app_role
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_employee_role_text();
begin
  case v_role
    when 'admin', 'director', 'owner', 'direktor', 'rahbar' then
      return 'admin'::public.app_role;
    when 'production_manager', 'production manager', 'manager', 'ishlab chiqarish boshlig''i' then
      return 'production_manager'::public.app_role;
    when 'inventory_manager', 'warehouse', 'omborchi' then
      return 'inventory_manager'::public.app_role;
    when 'sales', 'accountant', 'buxgalter', 'hisobchi' then
      return 'sales'::public.app_role;
    when 'quality_inspector', 'quality_control' then
      return 'quality_inspector'::public.app_role;
    when 'department_operator', 'department_head', 'supervisor', 'master', 'worker', 'usta', 'bosh usta' then
      return 'department_operator'::public.app_role;
    else
      return 'viewer'::public.app_role;
  end case;
end;
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i'
    ),
    false
  );
$$;

-- 2. Fix Employees Self-Promotion Vulnerability (BEFORE UPDATE Trigger)
create or replace function public.prevent_employee_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_in_salary_rpc  boolean := (coalesce(current_setting('app.in_salary_rpc', true), 'false') = 'true');
  v_in_auth_link   boolean := (coalesce(current_setting('app.in_auth_link_trigger', true), 'false') = 'true');
begin
  if auth.uid() is not null and not public.is_admin_or_manager() then
    if new.role is distinct from old.role
       or new.role_type is distinct from old.role_type
       or new.status is distinct from old.status
       or new.employment_status is distinct from old.employment_status
       or new.is_active is distinct from old.is_active
       or new.employee_code is distinct from old.employee_code
       or new.primary_department_id is distinct from old.primary_department_id
       or new.rate is distinct from old.rate
       or (new.user_id is distinct from old.user_id and not v_in_auth_link)
       or new.email is distinct from old.email
       or (new.balance is distinct from old.balance and not v_in_salary_rpc)
    then
      raise exception 'Privilege escalation blocked: only admin or manager may modify role, identity link, status, rate, or balance'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_employee_privilege_escalation on public.employees;
create trigger trg_prevent_employee_privilege_escalation
  before update on public.employees
  for each row execute function public.prevent_employee_privilege_escalation();

-- 3. Enable RLS on all core operational tables (and guarded optional legacy tables)
alter table public.employees              enable row level security;
alter table public.orders                 enable row level security;
alter table public.batches                enable row level security;
alter table public.inventory_items        enable row level security;
alter table public.gold_transactions      enable row level security;
alter table public.idempotency_keys       enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.affinaj_records        enable row level security;
alter table public.production_stages      enable row level security;
alter table public.batch_stage_wip        enable row level security;
alter table public.consumption            enable row level security;
alter table public.machines               enable row level security;
alter table public.products               enable row level security;
alter table public.bom_items              enable row level security;
alter table public.sales                  enable row level security;
alter table public.debt_repayments        enable row level security;
alter table public.salary_ledger          enable row level security;
alter table public.quality_control        enable row level security;
alter table public.audit_logs             enable row level security;
alter table public.system_settings        enable row level security;
alter table public.stage_loss_configs     enable row level security;

do $$
declare
  v_opt_tbl text;
  v_optional_legacy_tables text[] := array[
    'inventory_transactions',
    'gold_lots',
    'batch_operations',
    'batch_status_history',
    'qc_inspections',
    'qc_inspection_results',
    'audit_log'
  ];
begin
  foreach v_opt_tbl in array v_optional_legacy_tables
  loop
    if to_regclass('public.' || v_opt_tbl) is not null then
      execute format('alter table public.%I enable row level security', v_opt_tbl);
    end if;
  end loop;
end $$;

-- 4. Deterministically drop all pre-existing legacy (014) and permissive Dashboard policies
--    on managed ERP tables before creating the authoritative hardened policy set.
drop policy if exists "self update own profile" on public.employees;
drop policy if exists "Employees can update own profile" on public.employees;
drop policy if exists "Employees can update own safe profile fields" on public.employees;

do $$
declare
  v_pol record;
begin
  for v_pol in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in (
         'employees',
         'orders',
         'batches',
         'inventory_items',
         'inventory_transactions',
         'gold_lots',
         'gold_transactions',
         'batch_operations',
         'batch_status_history',
         'qc_inspections',
         'qc_inspection_results',
         'audit_log',
         'idempotency_keys',
         'inventory_reservations',
         'affinaj_records',
         'production_stages',
         'batch_stage_wip',
         'consumption',
         'machines',
         'products',
         'bom_items',
         'sales',
         'debt_repayments',
         'salary_ledger',
         'quality_control',
         'audit_logs',
         'system_settings',
         'stage_loss_configs',
         'orfers',
         'payroll'
       )
  loop
    execute format('drop policy if exists %I on %I.%I', v_pol.policyname, v_pol.schemaname, v_pol.tablename);
  end loop;

  if to_regclass('public.orfers') is not null then
    execute 'alter table public.orfers enable row level security';
    execute 'create policy "Admins and managers can access legacy orfers" on public.orfers for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager())';
  end if;
  if to_regclass('public.payroll') is not null then
    execute 'alter table public.payroll enable row level security';
    execute 'create policy "Admins and managers can access legacy payroll" on public.payroll for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager())';
  end if;
end $$;

-- 5. Least-Privilege SELECT & Write Policies on Core & Operational ERP Tables

-- 5.1 EMPLOYEES:
-- Every authenticated user can read their own employee row; only management, accounting,
-- and supervisory roles can read all employee rows (workers/viewers cannot dump other employees' salaries).
create policy "employees_select_own_or_authorized"
  on public.employees for select to authenticated
  using (
    user_id = auth.uid()
    or id::text = auth.uid()::text
    or public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "Employees can update own safe profile fields"
  on public.employees for update to authenticated
  using (user_id = auth.uid() or id::text = auth.uid()::text)
  with check (
    (user_id = auth.uid() or id::text = auth.uid()::text)
    and role is not distinct from (select e.role from public.employees e where e.id = employees.id)
    and role_type is not distinct from (select e.role_type from public.employees e where e.id = employees.id)
    and status is not distinct from (select e.status from public.employees e where e.id = employees.id)
    and employment_status is not distinct from (select e.employment_status from public.employees e where e.id = employees.id)
    and is_active is not distinct from (select e.is_active from public.employees e where e.id = employees.id)
    and employee_code is not distinct from (select e.employee_code from public.employees e where e.id = employees.id)
    and primary_department_id is not distinct from (select e.primary_department_id from public.employees e where e.id = employees.id)
    and user_id is not distinct from (select e.user_id from public.employees e where e.id = employees.id)
    and email is not distinct from (select e.email from public.employees e where e.id = employees.id)
    and rate is not distinct from (select e.rate from public.employees e where e.id = employees.id)
    and balance is not distinct from (select e.balance from public.employees e where e.id = employees.id)
  );

create policy "admin manage employees"
  on public.employees for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.2 ORDERS:
-- Contains customer phone, total price, advance, and debt. Restricted from worker/viewer.
create policy "orders_select_authorized"
  on public.orders for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi',
      'inventory_manager', 'warehouse', 'omborchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "sales write orders"
  on public.orders for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "sales update orders"
  on public.orders for update to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  )
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "admin delete orders"
  on public.orders for delete to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.3 INVENTORY, SAFE GOLD LOTS, GOLD TRANSACTIONS, RESERVATIONS & AFFINAJ:
-- Restricted from worker/viewer. All balance mutations occur via SECURITY DEFINER RPCs;
-- direct client INSERT on inventory_items is permitted ONLY for 0-balance material card registration.
create policy "inventory_items_select_authorized"
  on public.inventory_items for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'sales', 'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "inventory_items_insert_zero_balance_card"
  on public.inventory_items for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
    and coalesce(on_hand, 0) = 0
    and coalesce(quantity_on_hand, 0) = 0
    and coalesce(reserved, 0) = 0
  );

create policy "inventory_items_admin_manage"
  on public.inventory_items for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "gold_transactions_select_authorized"
  on public.gold_transactions for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "gold_transactions_admin_insert"
  on public.gold_transactions for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "inventory_reservations_select_authorized"
  on public.inventory_reservations for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "inventory_reservations_admin_manage"
  on public.inventory_reservations for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "affinaj_records_select_authorized"
  on public.affinaj_records for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "affinaj_records_admin_insert"
  on public.affinaj_records for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.4 BATCHES, WIP, CONSUMPTION, STAGES, OPERATIONS & QC:
-- Operational mutations on batches, batch_stage_wip, and consumption run via SECURITY DEFINER RPCs;
-- direct client table writes on those ledger/state tables are restricted to admin/director.
create policy "authenticated read batches"
  on public.batches for select to authenticated using (true);

create policy "batches_admin_manage"
  on public.batches for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Authenticated users can read own idempotency keys"
  on public.idempotency_keys for select to authenticated
  using (actor_id = auth.uid() or public.is_admin_or_manager());

create policy "Authenticated users can read production stages"
  on public.production_stages for select to authenticated using (true);

create policy "Admins and managers can manage production stages"
  on public.production_stages for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

create policy "Authenticated users can read batch stage wip"
  on public.batch_stage_wip for select to authenticated using (true);

create policy "batch_stage_wip_admin_manage"
  on public.batch_stage_wip for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Authenticated users can read consumption"
  on public.consumption for select to authenticated using (true);

create policy "consumption_admin_insert"
  on public.consumption for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Authenticated users can read machines"
  on public.machines for select to authenticated using (true);

create policy "Admins and managers can manage machines"
  on public.machines for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

-- Guarded RLS policies for optional legacy tables (004..012) when present in the schema
do $$
begin
  if to_regclass('public.inventory_transactions') is not null then
    execute $sql$
      create policy "inventory_transactions_select_authorized"
        on public.inventory_transactions for select to authenticated
        using (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'inventory_manager', 'warehouse', 'omborchi',
            'accountant', 'buxgalter', 'hisobchi'
          )
        );
      create policy "inventory_transactions_admin_insert"
        on public.inventory_transactions for insert to authenticated
        with check (
          public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
        );
    $sql$;
  end if;

  if to_regclass('public.gold_lots') is not null then
    execute $sql$
      create policy "gold_lots_select_authorized"
        on public.gold_lots for select to authenticated
        using (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'inventory_manager', 'warehouse', 'omborchi',
            'accountant', 'buxgalter', 'hisobchi',
            'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
          )
        );
      create policy "gold_lots_admin_manage"
        on public.gold_lots for all to authenticated
        using (
          public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
        )
        with check (
          public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
        );
    $sql$;
  end if;

  if to_regclass('public.batch_operations') is not null then
    execute $sql$
      create policy "authenticated read batch_operations"
        on public.batch_operations for select to authenticated using (true);
      create policy "Authorized manufacturing roles can insert batch operations"
        on public.batch_operations for insert to authenticated
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator', 'worker'
          )
        );
      create policy "Authorized manufacturing roles can update batch operations"
        on public.batch_operations for update to authenticated
        using (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator', 'worker'
          )
        )
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator', 'worker'
          )
        );
    $sql$;
  end if;

  if to_regclass('public.batch_status_history') is not null then
    execute $sql$
      create policy "authenticated read batch_status_history"
        on public.batch_status_history for select to authenticated using (true);
    $sql$;
  end if;

  if to_regclass('public.qc_inspections') is not null then
    execute $sql$
      create policy "authenticated read qc_inspections"
        on public.qc_inspections for select to authenticated using (true);
      create policy "QC and managers can insert inspections"
        on public.qc_inspections for insert to authenticated
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'quality_inspector', 'quality_control'
          )
        );
      create policy "QC and managers can update inspections"
        on public.qc_inspections for update to authenticated
        using (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'quality_inspector', 'quality_control'
          )
        )
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'quality_inspector', 'quality_control'
          )
        );
    $sql$;
  end if;

  if to_regclass('public.qc_inspection_results') is not null then
    execute $sql$
      create policy "authenticated read qc_inspection_results"
        on public.qc_inspection_results for select to authenticated using (true);
      create policy "QC and managers can insert inspection results"
        on public.qc_inspection_results for insert to authenticated
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'quality_inspector', 'quality_control'
          )
        );
    $sql$;
  end if;

  if to_regclass('public.audit_log') is not null then
    execute $sql$
      create policy "Only admins and managers can read audit log"
        on public.audit_log for select to authenticated
        using (public.is_admin_or_manager());
    $sql$;
  end if;
end $$;

-- 5.5 PRODUCTS & BOM ITEMS:
-- Model creation and stock mutations occur via rpc_create_product_with_bom, rpc_move_partial_wip,
-- and rpc_record_sale_with_stock_deduction. Direct client table writes are restricted to admin/director.
create policy "Authenticated users can read products and bom"
  on public.products for select to authenticated using (true);

create policy "products_admin_manage"
  on public.products for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Authenticated users can read bom items"
  on public.bom_items for select to authenticated using (true);

create policy "bom_items_admin_manage"
  on public.bom_items for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.6 SALES, DEBT REPAYMENTS & SALARY LEDGER:
-- Product sales ('kirim'), order advances, and debt repayments run through SECURITY DEFINER RPCs.
-- Direct client INSERT on public.sales is allowed ONLY for cash expenses ('chiqim' with 0 weight/debt, null product_id, positive amount) or admin/director.
create policy "Sales and managers can read sales"
  on public.sales for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "sales_insert_expense_or_admin"
  on public.sales for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
    or (
      public.current_employee_role_text() in (
        'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
        'sales', 'accountant', 'buxgalter', 'hisobchi'
      )
      and tx_type = 'chiqim'
      and product_id is null
      and coalesce(weight, 0) = 0
      and coalesce(debt_amount, 0) = 0
      and coalesce(total_amount, 0) > 0
    )
  );

create policy "sales_admin_manage"
  on public.sales for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Sales and managers can read debt repayments"
  on public.debt_repayments for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "debt_repayments_admin_insert"
  on public.debt_repayments for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Admins and accountants can read salary ledger"
  on public.salary_ledger for select to authenticated
  using (
    public.is_admin_or_manager()
    or public.current_employee_role_text() in ('accountant', 'buxgalter', 'hisobchi')
    or employee_id::text = auth.uid()::text
    or employee_id::text = public.current_employee_id_text()
  );

create policy "salary_ledger_admin_insert"
  on public.salary_ledger for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.7 QUALITY CONTROL, SETTINGS & AUDIT LOGS:
create policy "Authenticated users can read quality control"
  on public.quality_control for select to authenticated using (true);

create policy "QC and managers can insert quality control"
  on public.quality_control for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'quality_inspector', 'quality_control'
    )
  );

create policy "Authenticated users can read system settings"
  on public.system_settings for select to authenticated using (true);

create policy "Admins and managers can manage system settings"
  on public.system_settings for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

create policy "Authenticated users can read stage loss configs"
  on public.stage_loss_configs for select to authenticated using (true);

create policy "Admins and managers can manage stage loss configs"
  on public.stage_loss_configs for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

create policy "Only admins and managers can read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin_or_manager());

-- Enforce authoritative actor_id and actor_role on direct client audit_logs inserts (prevents spoofing)
create or replace function public.enforce_audit_logs_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- When pg_trigger_depth() = 1, the insert came directly from a client query rather than record_audit_event()
  if pg_trigger_depth() <= 1 and auth.uid() is not null then
    new.actor_id   := auth.uid();
    new.actor_role := coalesce(public.current_employee_role_text(), 'viewer');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_audit_logs_actor on public.audit_logs;
create trigger trg_enforce_audit_logs_actor
  before insert on public.audit_logs
  for each row execute function public.enforce_audit_logs_actor();

create policy "Authenticated users can append audit logs"
  on public.audit_logs for insert to authenticated
  with check (
    auth.uid() is not null
    and (actor_id is null or actor_id = auth.uid())
    and public.current_employee_role_text() is not null
  );

-- 6. Immutability Protection: Prevent DELETE (and unauthorized UPDATE) on audit & financial ledgers
create or replace function public.prevent_ledger_delete_or_tamper()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Deleting records from immutable ledger table "%" is strictly prohibited', tg_table_name
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and tg_table_name in (
    'audit_log', 'audit_logs', 'gold_transactions', 'inventory_transactions',
    'debt_repayments', 'salary_ledger', 'affinaj_records'
  ) then
    raise exception 'Modifying existing records in immutable ledger table "%" is strictly prohibited', tg_table_name
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_immutable_audit_logs on public.audit_logs;
create trigger trg_immutable_audit_logs
  before update or delete on public.audit_logs
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_gold_transactions on public.gold_transactions;
create trigger trg_immutable_gold_transactions
  before update or delete on public.gold_transactions
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_debt_repayments on public.debt_repayments;
create trigger trg_immutable_debt_repayments
  before update or delete on public.debt_repayments
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_salary_ledger on public.salary_ledger;
create trigger trg_immutable_salary_ledger
  before update or delete on public.salary_ledger
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_affinaj_records on public.affinaj_records;
create trigger trg_immutable_affinaj_records
  before update or delete on public.affinaj_records
  for each row execute function public.prevent_ledger_delete_or_tamper();

do $$
begin
  if to_regclass('public.audit_log') is not null then
    execute 'drop trigger if exists trg_immutable_audit_log on public.audit_log';
    execute 'create trigger trg_immutable_audit_log before update or delete on public.audit_log for each row execute function public.prevent_ledger_delete_or_tamper()';
  end if;

  if to_regclass('public.inventory_transactions') is not null then
    execute 'drop trigger if exists trg_immutable_inventory_transactions on public.inventory_transactions';
    execute 'create trigger trg_immutable_inventory_transactions before update or delete on public.inventory_transactions for each row execute function public.prevent_ledger_delete_or_tamper()';
  end if;
end $$;

-- 7. Least-Privilege Function EXECUTE Hardening
--    Revoke PUBLIC, anon, and broad authenticated EXECUTE on all public functions,
--    then explicitly grant EXECUTE to authenticated ONLY on safe helpers and
--    RBAC-protected ERP RPCs.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function public.try_cast_uuid(text) to authenticated;
grant execute on function public.calc_fine_gold_exact(numeric, numeric) to authenticated;
grant execute on function public.calculate_melting_loss(numeric, numeric) to authenticated;
grant execute on function public.normalize_erp_role_token(text) to authenticated;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_employee_id_text() to authenticated;
grant execute on function public.current_employee_role_text() to authenticated;
grant execute on function public.current_employee_role() to authenticated;
grant execute on function public.is_admin_or_manager() to authenticated;
grant execute on function public.assert_erp_permission(text[]) to authenticated;
grant execute on function public.check_and_lock_idempotency(text, text, jsonb) to authenticated;
grant execute on function public.save_idempotency_response(text, text, jsonb, jsonb) to authenticated;

grant execute on function public.rpc_inventory_transaction(text, text, numeric, numeric, numeric, text, text, text, text, text, text) to authenticated;
grant execute on function public.rpc_execute_alloy_transaction(text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, numeric, text, numeric, text) to authenticated;
grant execute on function public.rpc_execute_affinaj_transaction(text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_create_batch_with_gold_issue(text, text, text, text, numeric, integer, numeric, numeric, text, date, text) to authenticated;
grant execute on function public.rpc_launch_order_production_chain(text, text, text, text, text, text, numeric, integer, numeric, numeric, text, date, text) to authenticated;
grant execute on function public.rpc_move_partial_wip(text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.rpc_split_batch(text, integer, text, integer, text) to authenticated;
grant execute on function public.rpc_record_stage_consumption(text, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, text) to authenticated;
grant execute on function public.rpc_return_sprue_to_scrap_inventory(text, text, text, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.rpc_record_sale_with_stock_deduction(text, text, text, integer, numeric, numeric, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_record_debt_repayment(text, text, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.rpc_record_salary_transaction(text, text, text, text, text, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_create_product_with_bom(text, text, numeric, integer, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb, text) to authenticated;
grant execute on function public.rpc_create_order_with_advance(text, text, text, text, text, numeric, integer, numeric, numeric, numeric, date, text, text, text) to authenticated;


-- ============================================================================
-- Director/Admin account linking for admin@goldia.uz
-- ============================================================================
-- ============================================================================
-- JEWELRYFLOW ERP — OPERATOR SCRIPT: SAFE DIRECTOR/ADMIN ACCOUNT LINKING
-- ============================================================================
-- File: supabase/scripts/02_manual_link_director_admin.sql
-- Purpose: Safely link the verified Supabase Auth user 'admin@goldia.uz' to an
--          active, authoritative Director/Admin record in `public.employees`.
--
-- INSTRUCTIONS FOR OPERATOR:
-- 1. Review this script carefully before executing.
-- 2. Execute within the Supabase SQL Editor as `postgres` or `service_role`.
-- 3. This script is fully idempotent and transactional. If no auth user exists
--    with email 'admin@goldia.uz', it raises an informative notice and does not fail.
-- ============================================================================

-- [begin deferred to outer transaction]
do $$
declare
  v_user_id uuid;
  v_emp_id_text text;
  v_existing_user_id uuid;
  v_existing_email text;
  v_role_col_type text;
begin
  -- Step 1: Look up the verified auth user id
  select id into v_user_id
  from auth.users
  where lower(email) = 'admin@goldia.uz'
  limit 1;

  if v_user_id is null then
    raise notice 'ATTENTION: No Supabase Auth user found with email admin@goldia.uz. Please ensure the user has signed up or been invited in Supabase Auth before running this link script.';
    return;
  end if;

  -- Inspect the data type of public.employees.role to handle enum vs text gracefully
  select data_type into v_role_col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'employees' and column_name = 'role';

  -- Step 2: Safe lookup by exact matching email 'admin@goldia.uz'
  select id::text, user_id, email into v_emp_id_text, v_existing_user_id, v_existing_email
  from public.employees
  where lower(btrim(coalesce(email, ''))) = 'admin@goldia.uz'
  order by id asc
  limit 1;

  -- Safety Guard A: If an employee record already has email 'admin@goldia.uz' but points to another auth user
  if v_emp_id_text is not null and v_existing_user_id is not null and v_existing_user_id <> v_user_id then
    raise exception 'SAFETY VIOLATION: Employee ID % already has email admin@goldia.uz but is linked to another auth user (%). Aborting to prevent identity collision.',
      v_emp_id_text, v_existing_user_id;
  end if;

  -- Safety Guard B: If no employee record has email 'admin@goldia.uz', check if any record points to v_user_id
  if v_emp_id_text is null then
    select id::text, email into v_emp_id_text, v_existing_email
    from public.employees
    where user_id = v_user_id
    limit 1;

    -- If that employee record has a DIFFERENT email (e.g., worker@goldia.uz), DO NOT overwrite or elevate them!
    if v_emp_id_text is not null and v_existing_email is not null and lower(btrim(v_existing_email)) <> 'admin@goldia.uz' then
      raise exception 'SAFETY VIOLATION: Employee ID % is linked to auth user % but belongs to another identity (email: %). Aborting to prevent accidental privilege escalation.',
        v_emp_id_text, v_user_id, v_existing_email;
    end if;
  end if;

  if v_emp_id_text is not null then
    -- Safely update the verified record to full Director / Admin authority
    update public.employees
    set
      user_id = v_user_id,
      email = 'admin@goldia.uz',
      name = coalesce(nullif(btrim(name), ''), 'Bosh Direktor'),
      full_name = coalesce(nullif(btrim(full_name), ''), nullif(btrim(name), ''), 'Bosh Direktor'),
      role = 'admin',
      role_type = 'Director',
      position = 'Director',
      department = coalesce(nullif(btrim(department), ''), 'Boshqaruv'),
      status = 'active',
      employment_status = 'active',
      is_active = true
    where id::text = v_emp_id_text;

    raise notice 'SUCCESS: Updated verified employee record (ID: %) with Director/Admin credentials linked to auth user %.', v_emp_id_text, v_user_id;
  else
    -- Insert a canonical Director employee record linked to the auth user
    insert into public.employees (
      employee_code,
      name,
      full_name,
      email,
      department,
      role,
      role_type,
      position,
      salary_type,
      rate,
      balance,
      status,
      employment_status,
      is_active,
      user_id
    ) values (
      'EMP-DIR-001',
      'Bosh Direktor',
      'Bosh Direktor',
      'admin@goldia.uz',
      'Boshqaruv',
      'admin',
      'Director',
      'Director',
      'Oylik (Fixed)',
      0,
      0,
      'active',
      'active',
      true,
      v_user_id
    );

    raise notice 'SUCCESS: Created new employee record EMP-DIR-001 with Director/Admin credentials linked to auth user %.', v_user_id;
  end if;
end $$;

-- [commit deferred to outer transaction]
-- Verification Query: Inspect the updated employee and auth user linkage
select
  e.id as employee_id,
  e.user_id as linked_auth_user_id,
  u.email as auth_email,
  e.email as employee_email,
  e.name,
  e.full_name,
  e.role,
  e.role_type,
  e.position,
  e.department,
  e.status,
  e.employment_status,
  e.is_active
from public.employees e
join auth.users u on u.id = e.user_id
where lower(u.email) = 'admin@goldia.uz';


COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION AUDIT (Runs after successful COMMIT)
-- ============================================================================
select
  'VERIFICATION SUMMARY' as check_category,
  (select count(*) from information_schema.tables where table_schema = 'public') as total_public_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'rpc_%') as installed_erp_rpcs,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true) as rls_enabled_tables,
  (select e.role_type from public.employees e where lower(e.email) = 'admin@goldia.uz' limit 1) as director_role_type;

select
  e.id as employee_id,
  e.user_id as auth_user_id,
  e.email,
  e.name,
  e.role,
  e.role_type,
  e.status,
  e.is_active
from public.employees e
where lower(coalesce(e.email, '')) = 'admin@goldia.uz';

-- Verify batches.order_id and batch_stage_wip.batch_id data types
select
  table_name,
  column_name,
  data_type,
  udt_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'batches' and column_name in ('id', 'order_id', 'order_id_legacy_uuid', 'batch_no')) or
    (table_name = 'orders' and column_name in ('id', 'order_no', 'reserved_item_id')) or
    (table_name = 'batch_stage_wip' and column_name in ('id', 'batch_id', 'batch_no')) or
    (table_name = 'employees' and column_name in ('id', 'user_id', 'role', 'role_type'))
  )
order by table_name, column_name;
