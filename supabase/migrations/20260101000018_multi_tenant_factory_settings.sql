-- ============================================================================
-- JewelryFlow ERP — Migration 018: Multi-Tenant Architecture & Factory Settings
-- ============================================================================
-- Establishes the multi-tenant SaaS foundation:
-- 1. Organizations table (tenant registry) with initial Goldia factory tenant.
-- 2. Organization Factory Settings (dynamic stage bypass, machinery & capacities).
-- 3. Two-Party Handover ledger table for verified stage-to-stage transfers.
-- 4. Safe nullable organization_id linkage across operational tables.
-- ============================================================================

-- 1. Organizations (Tenants)
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  status      text not null default 'ACTIVE',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Seed initial Goldia factory tenant
insert into public.organizations (code, name, status)
values ('goldia', 'Goldia Jewelry Factory', 'ACTIVE')
on conflict (code) do nothing;

-- 2. Organization Factory Settings (Tenant-specific pipeline & machinery)
create table if not exists public.organization_factory_settings (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade unique,
  disabled_stage_codes     text[] not null default array['PUMICE', 'PUMICE_MACHINE', 'PONZA', 'ZIRCON', 'ZIRCON_MACHINE']::text[],
  disabled_stage_orders    integer[] not null default array[9, 13]::integer[],
  disabled_department_slugs text[] not null default array['pumice', 'zircon']::text[],
  laser_machines_count     integer not null default 8,
  casting_machines_count   integer not null default 2,
  workers_count            integer not null default 35,
  max_models_per_batch     integer not null default 20,
  sets_per_model           integer not null default 10,
  handover_tolerance_gram  numeric(6, 4) not null default 0.05,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Seed Goldia factory settings linked to Goldia organization
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
)
select
  id,
  array['PUMICE', 'PUMICE_MACHINE', 'PONZA', 'ZIRCON', 'ZIRCON_MACHINE']::text[],
  array[9, 13]::integer[],
  array['pumice', 'zircon']::text[],
  8,
  2,
  35,
  20,
  10,
  0.05
from public.organizations
where code = 'goldia'
on conflict (organization_id) do nothing;

-- 3. Two-Party Handover Tracking
create table if not exists public.two_party_handovers (
  id                          text primary key,
  organization_id             uuid references public.organizations(id) on delete set null,
  batch_id                    text not null,
  batch_no                    text not null,
  from_stage_order            integer not null,
  from_stage_name             text not null,
  from_department             text not null,
  to_stage_order              integer not null,
  to_stage_name               text not null,
  to_department               text not null,
  sender_worker_id            text not null,
  sender_worker_name          text not null,
  receiver_worker_id          text,
  receiver_worker_name        text,
  dispatched_qty              integer not null check (dispatched_qty > 0),
  dispatched_weight_gram      numeric(14, 4) not null check (dispatched_weight_gram > 0),
  received_qty                integer check (received_qty is null or received_qty >= 0),
  received_weight_gram        numeric(14, 4) check (received_weight_gram is null or received_weight_gram >= 0),
  weight_discrepancy_gram     numeric(14, 4),
  status                      text not null default 'PENDING_ACCEPTANCE',
  tolerance_gram              numeric(6, 4) not null default 0.05,
  flag_reason                 text,
  supervisor_override_id      text,
  supervisor_override_reason  text,
  dispatched_at               timestamptz not null default now(),
  resolved_at                 timestamptz,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_two_party_handovers_batch on public.two_party_handovers(batch_no);
create index if not exists idx_two_party_handovers_status on public.two_party_handovers(status);

-- 4. Forward-Only Non-Destructive Tenant Linkage Columns
alter table public.batches
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.orders
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.inventory_items
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.employees
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.profiles
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

-- 5. Row Level Security & Access Hardening
alter table public.organizations enable row level security;
alter table public.organization_factory_settings enable row level security;
alter table public.two_party_handovers enable row level security;

-- Policies for Organizations
drop policy if exists "authenticated read organizations" on public.organizations;
create policy "authenticated read organizations"
  on public.organizations for select to authenticated using (true);

drop policy if exists "director write organizations" on public.organizations;
create policy "director write organizations"
  on public.organizations for all to authenticated
  using (
    exists (
      select 1 from public.profiles
       where profiles.user_id = auth.uid()
         and lower(profiles.role) in ('director', 'admin', 'owner')
    )
  );

-- Policies for Organization Factory Settings
drop policy if exists "authenticated read factory settings" on public.organization_factory_settings;
create policy "authenticated read factory settings"
  on public.organization_factory_settings for select to authenticated using (true);

drop policy if exists "director write factory settings" on public.organization_factory_settings;
create policy "director write factory settings"
  on public.organization_factory_settings for all to authenticated
  using (
    exists (
      select 1 from public.profiles
       where profiles.user_id = auth.uid()
         and lower(profiles.role) in ('director', 'admin', 'owner')
    )
  );

-- Policies for Two-Party Handovers
drop policy if exists "authenticated read two party handovers" on public.two_party_handovers;
create policy "authenticated read two party handovers"
  on public.two_party_handovers for select to authenticated using (true);

drop policy if exists "authenticated write two party handovers" on public.two_party_handovers;
create policy "authenticated write two party handovers"
  on public.two_party_handovers for all to authenticated using (true);

grant select, insert, update on public.organizations to authenticated;
grant select, insert, update on public.organization_factory_settings to authenticated;
grant select, insert, update on public.two_party_handovers to authenticated;
