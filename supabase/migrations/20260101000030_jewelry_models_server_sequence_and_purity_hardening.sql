-- ============================================================================
-- JewelryFlow ERP — Migration 030
-- Jewelry Models Server-Side Sequence Generation, Purity Hardening & RLS Permissions
-- ============================================================================
-- 1. Relax or adapt gold_purity to text so millesimal values (e.g. '585', '750', '999')
--    do not fail PostgreSQL enum validation.
-- 2. Add proba integer column defaulting to 585.
-- 3. Explicitly GRANT table permissions on jewelry_models to authenticated & anon.
-- 4. Atomic Server-Side RPC `rpc_create_jewelry_model` with advisory lock to
--    generate sequence (JF-M-0001, JF-M-0002, etc.) and prevent race-condition duplicates.
-- 5. Guarantee Malika (JF-M-0001) is seeded and preserved.
-- ============================================================================

-- 1. Hardening jewelry_models table columns
do $$
begin
  -- Convert gold_purity enum to text to prevent 'invalid input value for enum gold_purity: "585"'
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'jewelry_models'
       and column_name = 'gold_purity'
       and udt_name = 'gold_purity'
  ) then
    alter table public.jewelry_models alter column gold_purity type text using gold_purity::text;
  end if;
end $$;

alter table public.jewelry_models
  add column if not exists proba integer not null default 585;

alter table public.jewelry_models
  alter column is_active set default true;

-- 2. Grant table permissions
grant select, insert, update, delete on public.jewelry_models to authenticated;
grant select on public.jewelry_models to anon;

-- 3. Hardened RLS Policy
alter table public.jewelry_models enable row level security;

drop policy if exists "authenticated read jewelry_models" on public.jewelry_models;
create policy "authenticated read jewelry_models" on public.jewelry_models
  for select to authenticated using (true);

drop policy if exists "managers write jewelry_models" on public.jewelry_models;
drop policy if exists "tenant managers and sales write jewelry_models" on public.jewelry_models;
create policy "tenant managers and sales write jewelry_models" on public.jewelry_models
  for all to authenticated
  using (
    public.is_admin_or_manager()
    or public.current_employee_role_text() in ('admin', 'director', 'manager', 'sales', 'seller', 'accountant')
    or organization_id = public.current_organization_id()
    or organization_id is null
  )
  with check (
    public.is_admin_or_manager()
    or public.current_employee_role_text() in ('admin', 'director', 'manager', 'sales', 'seller', 'accountant')
    or organization_id = public.current_organization_id()
    or organization_id is null
  );

-- 4. Atomic Server-Side RPC Function for Creating Models
create or replace function public.rpc_create_jewelry_model(
  p_name text,
  p_category text default 'Серьги',
  p_decorations text default null,
  p_reference_weight_grams numeric default null,
  p_purity text default '585',
  p_model_code text default null,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_model_code text := trim(p_model_code);
  v_next_num integer;
  v_new_model record;
  v_purity_val integer;
  v_purity_text text;
begin
  -- Validation: name is required
  if p_name is null or trim(p_name) = '' then
    raise exception 'Model nomi kiritilishi shart!';
  end if;

  -- Organization assignment
  v_org_id := coalesce(p_organization_id, public.current_organization_id());
  if v_org_id is null then
    select id into v_org_id from public.organizations order by created_at asc limit 1;
  end if;

  -- Advisory lock to prevent concurrent duplicate model codes
  perform pg_advisory_xact_lock(hashtext('jewelry_models_sequence_lock'));

  -- Clean and parse purity
  v_purity_text := trim(coalesce(p_purity, '585'));
  begin
    v_purity_val := nullif(regexp_replace(v_purity_text, '[^0-9]', '', 'g'), '')::integer;
  exception when others then
    v_purity_val := 585;
  end;
  if v_purity_val is null or v_purity_val <= 0 then
    v_purity_val := 585;
  end if;

  -- Generate or normalize sequential model_code (e.g. JF-M-0001, JF-M-0002)
  if v_model_code is null or v_model_code = '' or v_model_code ~* '^JF-M-0*$' then
    select coalesce(max(substring(model_code from 'JF-M-([0-9]+)')::integer), 0) + 1
      into v_next_num
      from public.jewelry_models
     where model_code ~ '^JF-M-[0-9]+';

    v_model_code := 'JF-M-' || lpad(v_next_num::text, 4, '0');
  else
    -- If custom code provided, check for duplicate collision
    if exists (select 1 from public.jewelry_models where upper(model_code) = upper(v_model_code)) then
      select coalesce(max(substring(model_code from 'JF-M-([0-9]+)')::integer), 0) + 1
        into v_next_num
        from public.jewelry_models
       where model_code ~ '^JF-M-[0-9]+';

      v_model_code := 'JF-M-' || lpad(v_next_num::text, 4, '0');
    end if;
  end if;

  -- Insert atomic record
  insert into public.jewelry_models (
    organization_id,
    model_code,
    name,
    category,
    decorations,
    reference_weight_grams,
    gold_purity,
    proba,
    is_active
  )
  values (
    v_org_id,
    upper(v_model_code),
    trim(p_name),
    trim(coalesce(p_category, 'Серьги')),
    nullif(trim(p_decorations), ''),
    case when p_reference_weight_grams is not null and p_reference_weight_grams > 0
         then p_reference_weight_grams else null end,
    v_purity_val::text,
    v_purity_val,
    true
  )
  returning * into v_new_model;

  -- Record audit log
  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (
      organization_id,
      table_name,
      record_id,
      action,
      new_data,
      reason,
      created_at
    ) values (
      v_org_id,
      'jewelry_models',
      v_new_model.id::text,
      'create_model',
      jsonb_build_object(
        'model_code', v_new_model.model_code,
        'name', v_new_model.name,
        'category', v_new_model.category,
        'purity', v_purity_val,
        'weight', v_new_model.reference_weight_grams
      ),
      'Created new permanent jewelry model',
      now()
    );
  end if;

  return to_jsonb(v_new_model);
end;
$$;

grant execute on function public.rpc_create_jewelry_model(text, text, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.rpc_create_jewelry_model(text, text, text, numeric, text, text, uuid) to anon;

-- 5. Guarantee Malika (JF-M-0001) is seeded and preserved
insert into public.jewelry_models (
  model_code, name, category, ring_size, loops_count, locks_count, decorations, reference_weight_grams, gold_purity, proba, is_active
)
values (
  'JF-M-0001', 'Malika', 'Серьги', null, 0, 0, 'Дорика', 14.500, '585', 585, true
)
on conflict (model_code) do update set
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  decorations = EXCLUDED.decorations,
  reference_weight_grams = EXCLUDED.reference_weight_grams,
  gold_purity = '585',
  proba = 585,
  is_active = true;
