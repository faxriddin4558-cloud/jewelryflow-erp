-- =============================================================================================================
-- 075 — Customer codes per organization (F-STG-1) and tenant-pinned rpc_get_factory_settings (F-STG-2).
--
-- Found by the real-Auth staging audit (docs/audits/goldia-staging-real-auth/README.md):
--   F-STG-1 rpc_create_customer_with_code took max(<all digits of every customer_code in the WHOLE table>)::integer.
--           One code with >= 10 digits in ANY organization (e.g. 'CUST-T056_1793002353699') made customer creation
--           fail with "out of range for type integer" for EVERY organization, and any tenant seller could plant such
--           a code with a direct PostgREST INSERT (customers_tenant_manage does not look at customer_code).
--   F-STG-2 rpc_get_factory_settings(p_organization_id) (SECURITY DEFINER) returned any organization's name, code and
--           factory settings for a caller-chosen id, created a settings row for it, and fell back to the 'goldia'
--           organization for callers without one.
-- Fix (no financial table, balance, formula or existing row is changed):
--   * customer_code is unique per organization (organization_id, customer_code) instead of globally; existing codes
--     are kept exactly as they are (they are globally unique today, so the new constraint holds for every row).
--   * rpc_create_customer_with_code numbers per organization: only codes of the caller's organization in the
--     canonical form CUST-<1..9 digits> are read, as bigint -> no overflow, foreign/odd codes are ignored.
--     lpad no longer truncates numbers above 9999 (038 turned 10000 into 'CUST-1000').
--     A per-organization transaction advisory lock serializes concurrent creations (no duplicate code, no duplicate
--     same-name customer); the unique constraint stays as the last guard. Caller role and p_seller_id are checked:
--     the seller must belong to the caller's organization, a seller can only create customers for himself.
--   * direct writes: anon loses every privilege on customers; authenticated loses INSERT/TRUNCATE/MAINTAIN, so new
--     customers are created only through the RPCs (rpc_create_customer_with_code, rpc_register_or_get_customer);
--     a trigger rejects changing customer_code / organization_id through a direct UPDATE by anon/authenticated.
--   * rpc_get_factory_settings always uses the caller's organization; another p_organization_id is refused (42501);
--     no 'goldia' fallback. Directors/managers keep reading (and lazily creating) their own organization's settings.
-- Idempotent: safe to run twice. Rollback: supabase/rollback/20260101000075_rollback.sql.
-- =============================================================================================================

-- ---------------------------------------------------------------------------------------------------------------
-- A. customer_code unique per organization (existing rows untouched)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.customers drop constraint if exists customers_customer_code_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.customers'::regclass and conname = 'customers_org_customer_code_key') then
    alter table public.customers
      add constraint customers_org_customer_code_key unique nulls not distinct (organization_id, customer_code);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B. rpc_create_customer_with_code — per-organization numbering, overflow-safe, concurrency-safe, role-checked
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.rpc_create_customer_with_code(
  p_contact_name text,
  p_phone        text default null,
  p_company_name text default null,
  p_seller_id    uuid default null,
  p_notes        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org   uuid := public.current_organization_id();
  v_caller_role  text := lower(coalesce(public.current_employee_role_text(), ''));
  v_caller_emp   uuid;
  v_clean_name   text := nullif(btrim(p_contact_name), '');
  v_next_seq     bigint;
  v_cust_code    text;
  v_cust_id      uuid;
  v_seller_id    uuid := p_seller_id;
  v_existing_id  uuid;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- same role set as the customers_tenant_manage policy
  if not (v_caller_role = any (array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager',
                                     'boshqaruvchi', 'accountant', 'buxgalter', 'hisobchi', 'seller', 'sotuvchi', 'sales'])) then
    raise exception 'Permission denied: mijoz yaratish huquqi yo''q (rol: %)', coalesce(nullif(v_caller_role, ''), '-') using errcode = '42501';
  end if;

  if v_clean_name is null then
    raise exception 'Mijoz ismi kiritilishi shart';
  end if;

  select id into v_caller_emp
    from public.employees
   where user_id = auth.uid() and organization_id = v_caller_org
   limit 1;

  if v_seller_id is null then
    v_seller_id := v_caller_emp;
  elsif not exists (select 1 from public.employees where id = v_seller_id and organization_id = v_caller_org) then
    raise exception 'Permission denied: sotuvchi boshqa tashkilotga tegishli yoki topilmadi' using errcode = '42501';
  elsif v_caller_role = any (array['seller', 'sotuvchi', 'sales']) and v_seller_id is distinct from v_caller_emp then
    raise exception 'Permission denied: sotuvchi faqat o''zi uchun mijoz yarata oladi' using errcode = '42501';
  end if;

  -- one creator at a time per organization: no duplicate code, no duplicate same-name customer
  perform pg_advisory_xact_lock(hashtextextended('goldia:customer_code:' || v_caller_org::text, 0));

  select id into v_existing_id
    from public.customers
   where organization_id = v_caller_org
     and lower(contact_name) = lower(v_clean_name)
     and (v_seller_id is null or seller_id = v_seller_id)
   limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'status', 'existing',
      'customer_id', v_existing_id,
      'message', 'Ushbu nomdagi mijoz allaqachon mavjud'
    );
  end if;

  -- next number inside the caller's organization; only canonical CUST-<1..9 digits> codes count (bigint, no overflow)
  select coalesce(max(substring(customer_code from '^CUST-([0-9]{1,9})$')::bigint), 0) + 1
    into v_next_seq
    from public.customers
   where organization_id = v_caller_org;

  v_cust_code := 'CUST-' || lpad(v_next_seq::text, greatest(4, length(v_next_seq::text)), '0');
  while exists (select 1 from public.customers where organization_id = v_caller_org and customer_code = v_cust_code) loop
    v_next_seq := v_next_seq + 1;
    v_cust_code := 'CUST-' || lpad(v_next_seq::text, greatest(4, length(v_next_seq::text)), '0');
  end loop;

  insert into public.customers (
    organization_id, customer_code, contact_name, phone, company_name, seller_id, notes
  ) values (
    v_caller_org, v_cust_code, v_clean_name, p_phone, p_company_name, v_seller_id, p_notes
  ) returning id into v_cust_id;

  return jsonb_build_object(
    'status', 'ok',
    'customer_id', v_cust_id,
    'customer_code', v_cust_code,
    'contact_name', v_clean_name,
    'phone', p_phone,
    'seller_id', v_seller_id
  );
end;
$$;

revoke all on function public.rpc_create_customer_with_code(text, text, text, uuid, text) from public, anon;
grant execute on function public.rpc_create_customer_with_code(text, text, text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- C. Direct writes: customers are created through the RPCs only; codes cannot be rewritten directly
-- ---------------------------------------------------------------------------------------------------------------
revoke all on table public.customers from anon;
revoke insert, truncate, references, trigger on table public.customers from authenticated;
do $$
begin
  -- PostgreSQL 17: MAINTAIN allows LOCK TABLE / VACUUM / REFRESH
  if exists (select 1 from pg_settings where name = 'server_version_num' and setting::int >= 170000) then
    execute 'revoke maintain on table public.customers from authenticated';
  end if;
end $$;
grant select, update, delete on table public.customers to authenticated;

create or replace function public._goldia_guard_customer_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- current_user is the function owner inside SECURITY DEFINER RPCs; only direct client writes are anon/authenticated
  if current_user in ('anon', 'authenticated')
     and (new.customer_code is distinct from old.customer_code or new.organization_id is distinct from old.organization_id) then
    raise exception 'Permission denied: mijoz kodi va tashkiloti faqat server tomonidan belgilanadi' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public._goldia_guard_customer_code() from public, anon, authenticated;

drop trigger if exists trg_goldia_guard_customer_code on public.customers;
create trigger trg_goldia_guard_customer_code
  before update of customer_code, organization_id on public.customers
  for each row execute function public._goldia_guard_customer_code();

-- ---------------------------------------------------------------------------------------------------------------
-- D. rpc_get_factory_settings — caller's organization only
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.rpc_get_factory_settings(
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id      uuid := public.current_organization_id();
  v_org         public.organizations%rowtype;
  v_settings    public.organization_factory_settings%rowtype;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  if p_organization_id is not null and p_organization_id <> v_org_id then
    raise exception 'Permission denied: boshqa tashkilot sozlamalari' using errcode = '42501';
  end if;

  select * into v_org from public.organizations where id = v_org_id;

  select * into v_settings from public.organization_factory_settings where organization_id = v_org_id;

  if not found then
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
    ) values (
      v_org_id,
      array['PUMICE', 'PUMICE_MACHINE', 'PONZA', 'ZIRCON', 'ZIRCON_MACHINE']::text[],
      array[9, 13]::integer[],
      array['pumice', 'zircon']::text[],
      8, 2, 35, 20, 10, 0.05
    )
    on conflict (organization_id) do nothing
    returning * into v_settings;
    if v_settings.organization_id is null then
      select * into v_settings from public.organization_factory_settings where organization_id = v_org_id;
    end if;
  end if;

  return jsonb_build_object(
    'organizationId', v_org_id::text,
    'organizationCode', coalesce(v_org.code, 'goldia'),
    'organizationName', coalesce(v_org.name, 'Goldia Jewelry Factory'),
    'disabledStageCodes', coalesce(v_settings.disabled_stage_codes, array[]::text[]),
    'disabledStageOrders', coalesce(v_settings.disabled_stage_orders, array[]::integer[]),
    'disabledDepartmentSlugs', coalesce(v_settings.disabled_department_slugs, array[]::text[]),
    'laserMachinesCount', coalesce(v_settings.laser_machines_count, 8),
    'castingMachinesCount', coalesce(v_settings.casting_machines_count, 2),
    'workersCount', coalesce(v_settings.workers_count, 35),
    'maxModelsPerBatch', coalesce(v_settings.max_models_per_batch, 20),
    'setsPerModel', coalesce(v_settings.sets_per_model, 10),
    'handoverToleranceGram', coalesce(v_settings.handover_tolerance_gram, 0.05)
  );
end;
$$;

revoke all on function public.rpc_get_factory_settings(uuid) from public, anon;
grant execute on function public.rpc_get_factory_settings(uuid) to authenticated, service_role;
