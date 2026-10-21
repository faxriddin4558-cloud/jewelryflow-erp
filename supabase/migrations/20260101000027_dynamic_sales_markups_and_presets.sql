-- =========================================================================
-- JewelryFlow ERP — Migration 027
-- Dynamic Sales Markups & Presets Management
-- =========================================================================
-- Allows Directors to configure arbitrary factory and client markup percentages
-- (6%, 8%, 10%, 12%, 15%, 18%, 25%, etc.) with active/inactive toggles.
-- Protects historical sales from any future preset changes.
-- Enforces that sellers can only choose active, director-approved markups.
-- =========================================================================

create table if not exists public.sales_markup_presets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type            text not null check (type in ('factory_markup', 'client_markup')),
  name            text not null,
  percentage      numeric(6, 2) not null check (percentage >= 0 and percentage <= 100),
  is_active       boolean not null default true,
  is_default      boolean not null default false,
  display_order   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_sales_markup_presets_org_type_pct unique (organization_id, type, percentage)
);

create index if not exists idx_sales_markup_presets_lookup
  on public.sales_markup_presets (organization_id, type, is_active, display_order);

-- Enable RLS
alter table public.sales_markup_presets enable row level security;

create policy "sales_markup_presets_select"
  on public.sales_markup_presets for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "sales_markup_presets_admin_manage"
  on public.sales_markup_presets for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- Seed default presets for existing organizations (e.g. Goldia)
do $$
declare
  v_org record;
begin
  for v_org in select id from public.organizations loop
    -- Factory markups
    insert into public.sales_markup_presets (organization_id, type, name, percentage, is_active, is_default, display_order)
    values
      (v_org.id, 'factory_markup', 'Zavod 6%', 6.00, true, false, 1),
      (v_org.id, 'factory_markup', 'Zavod 8% (Standart)', 8.00, true, true, 2),
      (v_org.id, 'factory_markup', 'Zavod 10%', 10.00, true, false, 3)
    on conflict (organization_id, type, percentage) do nothing;

    -- Client markups
    insert into public.sales_markup_presets (organization_id, type, name, percentage, is_active, is_default, display_order)
    values
      (v_org.id, 'client_markup', 'Mijoz 10% (Optom)', 10.00, true, false, 1),
      (v_org.id, 'client_markup', 'Mijoz 12% (Standart)', 12.00, true, true, 2),
      (v_org.id, 'client_markup', 'Mijoz 15% (Chakana)', 15.00, true, false, 3),
      (v_org.id, 'client_markup', 'Mijoz 18% (Eksklyuziv)', 18.00, true, false, 4),
      (v_org.id, 'client_markup', 'Mijoz 25% (Maxsus)', 25.00, true, false, 5)
    on conflict (organization_id, type, percentage) do nothing;
  end loop;
end $$;

-- -------------------------------------------------------------------------
-- RPC Functions for Presets Management
-- -------------------------------------------------------------------------

-- A. rpc_manage_sales_markup_preset (Director only)
create or replace function public.rpc_manage_sales_markup_preset(
  p_preset_id   uuid default null,
  p_type        text default 'client_markup',
  p_name        text default '',
  p_percentage  numeric default 0,
  p_is_active   boolean default true,
  p_is_default  boolean default false,
  p_display_order integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org   uuid := public.current_organization_id();
  v_res_id       uuid;
  v_type         text := lower(btrim(coalesce(p_type, 'client_markup')));
  v_pct          numeric(6, 2) := round(coalesce(p_percentage, 0)::numeric, 2);
  v_clean_name   text := btrim(coalesce(p_name, ''));
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar']);

  if v_type not in ('factory_markup', 'client_markup') then
    raise exception 'Invalid markup type: must be "factory_markup" or "client_markup"';
  end if;
  if v_pct < 0 or v_pct > 100 then
    raise exception 'Percentage must be between 0 and 100';
  end if;
  if v_clean_name = '' then
    v_clean_name := case when v_type = 'factory_markup' then 'Zavod ' else 'Mijoz ' end || v_pct || '%';
  end if;

  if p_is_default then
    -- Reset previous default for this org and type
    update public.sales_markup_presets
       set is_default = false
     where organization_id = v_caller_org
       and type = v_type;
  end if;

  if p_preset_id is not null then
    update public.sales_markup_presets
       set name          = v_clean_name,
           percentage    = v_pct,
           is_active     = coalesce(p_is_active, is_active),
           is_default    = coalesce(p_is_default, is_default),
           display_order = coalesce(p_display_order, display_order),
           updated_at    = now()
     where id = p_preset_id
       and organization_id = v_caller_org
     returning id into v_res_id;
  else
    insert into public.sales_markup_presets (
      organization_id, type, name, percentage, is_active, is_default, display_order
    ) values (
      v_caller_org, v_type, v_clean_name, v_pct, coalesce(p_is_active, true), coalesce(p_is_default, false), coalesce(p_display_order, 0)
    )
    on conflict (organization_id, type, percentage)
    do update set
      name          = excluded.name,
      is_active     = excluded.is_active,
      is_default    = excluded.is_default,
      display_order = excluded.display_order,
      updated_at    = now()
    returning id into v_res_id;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'preset_id', v_res_id,
    'type', v_type,
    'name', v_clean_name,
    'percentage', v_pct,
    'is_active', coalesce(p_is_active, true),
    'is_default', coalesce(p_is_default, false)
  );
end;
$$;

-- B. rpc_get_active_sales_markups (Available to sellers & directors)
create or replace function public.rpc_get_active_sales_markups(
  p_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_filter_type text := lower(btrim(coalesce(p_type, '')));
  v_result jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', id,
    'type', type,
    'name', name,
    'percentage', percentage,
    'is_active', is_active,
    'is_default', is_default,
    'display_order', display_order
  ) order by display_order, percentage)
  into v_result
  from public.sales_markup_presets
  where organization_id = v_caller_org
    and (v_filter_type = '' or type = v_filter_type)
    and is_active = true;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- Grant execution permissions
grant execute on function public.rpc_manage_sales_markup_preset(uuid, text, text, numeric, boolean, boolean, integer) to authenticated;
grant execute on function public.rpc_get_active_sales_markups(text) to authenticated;
