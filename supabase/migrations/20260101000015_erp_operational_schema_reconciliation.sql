-- ============================================================================
-- Migration: 20260101000015_erp_operational_schema_reconciliation.sql
-- Purpose:   Forward-only, non-destructive reconciliation between the
--            normalized manufacturing schema (001..014) and the operational
--            ERP modules (inventory, alloying, refining, batches, partial WIP,
--            consumption, products/BOM, orders, sales, debt repayments,
--            employees/salary_ledger, machines, quality_control, audit_logs).
-- Safety:    Zero DROP, TRUNCATE, or DELETE statements. Uses IF NOT EXISTS
--            and NOT VALID check constraints to preserve all existing records.
-- ============================================================================

-- 0. Safely extend enums for operational status/priority/role labels (non-destructive)
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
  add column if not exists reserved numeric(14, 4) default 0;

-- Allow legacy/operational rows where category_id, sku, or unit were not populated
alter table public.inventory_items
  alter column sku drop not null,
  alter column category_id drop not null,
  alter column unit set default 'gram'::public.inventory_unit,
  alter column unit drop not null;

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

-- Order-specific inventory reservations table
create table if not exists public.inventory_reservations (
  id                uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  order_id          uuid,
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
);

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

alter table public.gold_transactions
  alter column lot_id drop not null,
  alter column type drop not null,
  alter column weight_grams drop not null;

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
      -- If melting_loss is logged against a batch whose gold was already deducted
      -- from the vault lot via issued_to_batch, do not add or double-deduct the vault lot.
      -- If logged directly against an un-issued vault lot (batch_id is null), deduct the loss.
      if new.batch_id is null then
        v_delta := -v_w;
      else
        v_delta := 0;
      end if;
    else
      v_delta := 0;
  end case;

  if v_delta <> 0 then
    update public.gold_lots
       set remaining_weight_grams = remaining_weight_grams + v_delta
     where id = new.lot_id;
  end if;

  return new;
end;
$$;

-- 4. Refining (Affinaj) records table
create table if not exists public.affinaj_records (
  id                  uuid primary key default gen_random_uuid(),
  scrap_item_id       uuid references public.inventory_items(id) on delete restrict,
  target_gold_item_id uuid references public.inventory_items(id) on delete restrict,
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
);

-- 5. Extend orders non-destructively
alter table public.orders
  add column if not exists order_no text unique,
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
  add column if not exists priority_label text default 'Normal',
  add column if not exists status_label text default 'Kutilmoqda',
  add column if not exists batch_created boolean not null default false,
  add column if not exists reserved_item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists reserved_gold_gram numeric(14, 4) not null default 0;

alter table public.orders
  alter column order_number drop not null,
  alter column customer_id drop not null;

-- 6. Extend batches non-destructively
alter table public.batches
  add column if not exists batch_no text unique,
  add column if not exists parent_batch_no text,
  add column if not exists number text,
  add column if not exists product_id uuid,
  add column if not exists product_name text,
  add column if not exists product text,
  add column if not exists client_name text,
  add column if not exists master_name text,
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
  add column if not exists deadline date;

alter table public.batches
  alter column batch_number drop not null,
  alter column order_id drop not null;

-- Fix log_batch_status_change() from migration 007 so empty app.current_employee_id never fails UUID cast
create or replace function public.log_batch_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp_id uuid;
begin
  if (old.status is distinct from new.status) or (old.priority is distinct from new.priority) then
    select e.id into v_emp_id
      from public.employees e
     where e.id = coalesce(nullif(current_setting('app.current_employee_id', true), '')::uuid, auth.uid())
     limit 1;

    insert into public.batch_status_history (
      batch_id, previous_status, new_status, previous_priority, new_priority, changed_by
    ) values (
      new.id, old.status, new.status, old.priority, new.priority, v_emp_id
    );
  end if;
  return new;
end;
$$;

-- Fix record_audit_event() from migration 012 so changed_by safely resolves existing employee or null
create or replace function public.record_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp_id uuid;
begin
  select e.id into v_emp_id
    from public.employees e
   where e.id = coalesce(nullif(current_setting('app.current_employee_id', true), '')::uuid, auth.uid())
   limit 1;

  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    case when tg_op in ('update', 'delete') then to_jsonb(old) else null end,
    case when tg_op in ('insert', 'update') then to_jsonb(new) else null end,
    v_emp_id
  );
  return coalesce(new, old);
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
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid references public.batches(id) on delete cascade,
  batch_no        text not null,
  stage_order     integer not null,
  stage_name      text not null,
  department      text not null default 'Quyish',
  available_qty   integer not null default 0 check (available_qty >= 0),
  completed_qty   integer not null default 0 check (completed_qty >= 0),
  rework_qty      integer not null default 0 check (rework_qty >= 0),
  input_weight    numeric(14, 4) not null default 0 check (input_weight >= 0),
  output_weight   numeric(14, 4) not null default 0 check (output_weight >= 0),
  loss_weight     numeric(14, 4) not null default 0 check (loss_weight >= 0),
  queue_status    text not null default 'NOW',
  assigned_worker text,
  assigned_employee_id uuid references public.employees(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (batch_no, stage_order)
);

alter table public.batch_stage_wip
  add column if not exists batch_id uuid references public.batches(id) on delete cascade,
  add column if not exists department text default 'Quyish',
  add column if not exists available_qty integer default 0,
  add column if not exists completed_qty integer default 0,
  add column if not exists rework_qty integer default 0,
  add column if not exists input_weight numeric(14, 4) default 0,
  add column if not exists output_weight numeric(14, 4) default 0,
  add column if not exists loss_weight numeric(14, 4) default 0,
  add column if not exists queue_status text default 'NOW',
  add column if not exists assigned_worker text,
  add column if not exists assigned_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists updated_at timestamptz default now();

create table if not exists public.consumption (
  id                 uuid primary key default gen_random_uuid(),
  batch_id           uuid references public.batches(id) on delete set null,
  batch_no           text not null,
  stage_order        integer,
  master_name        text,
  master_employee_id uuid references public.employees(id) on delete set null,
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
  constraint chk_consumption_mass_balance check (
    returned_weight + sprue_gram + scrap_gram + loss_weight <= given_weight + 0.0005
  )
);

alter table public.consumption
  add column if not exists batch_id uuid references public.batches(id) on delete set null,
  add column if not exists stage_order integer,
  add column if not exists master_name text,
  add column if not exists master_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists proba numeric(6, 2) default 585,
  add column if not exists given_weight numeric(14, 4) default 0,
  add column if not exists returned_weight numeric(14, 4) default 0,
  add column if not exists sprue_gram numeric(14, 4) default 0,
  add column if not exists scrap_gram numeric(14, 4) default 0,
  add column if not exists loss_weight numeric(14, 4) default 0,
  add column if not exists sent_to_refinery boolean default false,
  add column if not exists idempotency_key text unique;

create table if not exists public.machines (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  department     text not null,
  daily_capacity integer not null default 0,
  current_batch  text,
  status         text not null default 'ACTIVE',
  created_at     timestamptz not null default now()
);

alter table public.machines
  add column if not exists department text default 'Quyish',
  add column if not exists daily_capacity integer default 0,
  add column if not exists current_batch text,
  add column if not exists status text default 'ACTIVE';

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
  product_id        uuid not null references public.products(id) on delete cascade,
  product_name      text not null,
  bom_version       integer not null default 1,
  component_name    text not null,
  material_category text not null,
  weight_per_set    numeric(14, 4) not null check (weight_per_set >= 0),
  proba             numeric(6, 2) not null default 0,
  created_at        timestamptz not null default now()
);

alter table public.bom_items
  add column if not exists product_id uuid references public.products(id) on delete cascade,
  add column if not exists product_name text,
  add column if not exists bom_version integer default 1,
  add column if not exists component_name text,
  add column if not exists material_category text default 'Gold',
  add column if not exists weight_per_set numeric(14, 4) default 0,
  add column if not exists proba numeric(6, 2) default 0;

-- 9. Sales & Customer Debt Repayments
create table if not exists public.sales (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid references public.orders(id) on delete set null,
  product_id         uuid references public.products(id) on delete set null,
  parent_sale_id     uuid references public.sales(id) on delete set null,
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
  created_at         timestamptz not null default now()
);

alter table public.sales
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists parent_sale_id uuid references public.sales(id) on delete set null,
  add column if not exists sale_total_amount numeric(18, 2) default 0,
  add column if not exists idempotency_key text unique;

create table if not exists public.debt_repayments (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid references public.sales(id) on delete restrict,
  order_id        uuid references public.orders(id) on delete restrict,
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
  add column if not exists email text,
  add column if not exists status text default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists name text,
  add column if not exists department text,
  add column if not exists role_type text,
  add column if not exists position text,
  add column if not exists salary_type text default 'Grammabay',
  add column if not exists rate numeric(18, 2) not null default 0,
  add column if not exists balance numeric(18, 2) not null default 0;

alter table public.employees
  alter column id set default gen_random_uuid(),
  alter column employee_code set default ('EMP-' || substr(gen_random_uuid()::text, 1, 8)),
  alter column employee_code drop not null,
  alter column full_name drop not null;

-- Allow operational workshop staff rows that do not yet have an auth.users login
alter table public.employees
  drop constraint if exists employees_id_fkey;

create table if not exists public.salary_ledger (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid references public.employees(id) on delete restrict,
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
  add column if not exists employee_id uuid references public.employees(id) on delete restrict,
  add column if not exists idempotency_key text unique;

-- Database-enforced duplicate guard for EARNED salary entries per worker + batch + stage
create unique index if not exists idx_salary_ledger_unique_earned
  on public.salary_ledger (
    coalesce(employee_id::text, lower(trim(worker_name))),
    upper(trim(batch_no)),
    lower(trim(stage_name))
  )
  where tx_type = 'EARNED';

-- 11. Operational Quality Control & Audit Logs compatibility tables
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
  actor_id    uuid,
  actor_name  text,
  actor_role  text,
  old_data    jsonb,
  new_data    jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists record_id text,
  add column if not exists actor_id uuid,
  add column if not exists actor_name text,
  add column if not exists actor_role text,
  add column if not exists old_data jsonb,
  add column if not exists new_data jsonb,
  add column if not exists reason text;
