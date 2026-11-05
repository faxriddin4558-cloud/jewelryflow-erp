-- 078 — Goldia Sales: "Mijozni o'chirish" (seller archives / restores HIS OWN customer, soft delete) and
--        reopening the latest stored report period (finding F77-11).
--
-- A. Customer archive (business decision 2026-11-05, PRIORITET 4)
--    * rpc_archive_customer(p_customer_id, p_archive):
--        - director / manager (any spelling of the two management roles): every customer of their organization;
--        - seller: only a customer of his organization assigned to him (customers.seller_id = his employee id);
--          never another seller's customer, an unassigned customer or another organization's customer (42501);
--        - restore = p_archive false, with the same rule;
--        - idempotent: a customer already in the requested state returns status ok, changed false, writes nothing;
--        - soft delete only: the row stays; sales, payments, debts (585 g and UZS / USD), till and audit rows are not
--          touched; the open balances at that moment are written to the audit log and returned.
--    * archived_at / archived_by columns (who / when).
--    * trg_goldia_guard_customer_archive: a direct PostgREST UPDATE of is_archived / archived_at / archived_by by a
--      logged-in user must follow the same rule (customers_tenant_manage lets a seller update his own AND unassigned
--      customers, so without this trigger a seller could archive an unassigned customer with a table write).
--    * Physical DELETE stays forbidden for customers with operations (trg_guard_customer_deletion, 051, unchanged).
--    Reports, ledgers, payments and reversals keep working for archived customers (nothing filters on is_archived on
--    the server); the UI hides archived customers from the normal list and shows them under "Arxivlangan mijozlar".
--
-- B. rpc_reopen_report_period(p_period_id): director / manager remove the LATEST stored period of their organization
--    (a frozen report copy, nothing else). Without it one mistaken "Yangi davrni boshlash" (e.g. an end date in the
--    year 2000) blocked every later close, because the next period would start the day after it and exceed the
--    10-year report window. No balance, debt, stock, till or transaction is touched; the removed report is kept in
--    audit_logs.old_data.
--
-- Production is NOT changed by this file; staging first (owner applies), production only with written approval.

-- ===================================================================================================================
-- A. Customer archive
-- ===================================================================================================================
alter table public.customers add column if not exists archived_at timestamptz;
alter table public.customers add column if not exists archived_by uuid;

create or replace function public._goldia_customer_open_balances(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'debt_g585', coalesce((select current_debt_grams from public.client_gold_accounts where customer_id = p_customer_id), 0),
    'advance_g585', coalesce((select advance_balance_grams from public.client_gold_accounts where customer_id = p_customer_id), 0),
    'debt_uzs', coalesce((select debt_amount from public.client_currency_accounts where customer_id = p_customer_id and currency = 'UZS'), 0),
    'advance_uzs', coalesce((select advance_amount from public.client_currency_accounts where customer_id = p_customer_id and currency = 'UZS'), 0),
    'debt_usd', coalesce((select debt_amount from public.client_currency_accounts where customer_id = p_customer_id and currency = 'USD'), 0),
    'advance_usd', coalesce((select advance_amount from public.client_currency_accounts where customer_id = p_customer_id and currency = 'USD'), 0)
  );
$$;
revoke all on function public._goldia_customer_open_balances(uuid) from public, anon, authenticated;
grant execute on function public._goldia_customer_open_balances(uuid) to service_role;

create or replace function public.rpc_archive_customer(p_customer_id uuid, p_archive boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid := public.current_organization_id();
  v_role    text := public.current_employee_role_text();
  v_emp     uuid := public.current_employee_id();
  v_mgmt    boolean := public._goldia_is_management_role(public.current_employee_role_text());
  v_seller  boolean := public._goldia_is_seller_role(public.current_employee_role_text());
  v_c       public.customers%rowtype;
  v_bal     jsonb;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  if not (v_mgmt or v_seller) then
    raise exception 'Ruxsat etilmadi: mijozni arxivlash faqat direktor, menejer yoki mijozning sotuvchisi uchun' using errcode = '42501';
  end if;
  if p_customer_id is null or p_archive is null then
    raise exception 'Mijoz va amal (arxivlash / tiklash) ko''rsatilishi shart' using errcode = '22023';
  end if;

  select * into v_c from public.customers where id = p_customer_id and organization_id = v_org for update;
  if not found then
    -- same answer for "does not exist" and "belongs to another organization": nothing leaks across tenants
    raise exception 'Mijoz topilmadi: %', p_customer_id;
  end if;
  if not v_mgmt and (v_emp is null or v_c.seller_id is distinct from v_emp) then
    raise exception 'Ruxsat etilmadi: Ushbu mijoz sizga biriktirilmagan (faqat o''z mijozingizni o''chira / tiklay olasiz)' using errcode = '42501';
  end if;

  v_bal := public._goldia_customer_open_balances(p_customer_id);

  -- idempotent: a repeated click (or a second tab) changes nothing and is not an error
  if coalesce(v_c.is_archived, false) = p_archive then
    return jsonb_build_object('status', 'ok', 'changed', false, 'customer_id', p_customer_id, 'is_archived', p_archive,
      'archived_at', v_c.archived_at, 'open_balances', v_bal);
  end if;

  update public.customers
     set is_archived = p_archive,
         archived_at = case when p_archive then now() else null end,
         archived_by = case when p_archive then v_emp else null end,
         updated_at  = now()
   where id = p_customer_id;

  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'customers', p_customer_id::text, case when p_archive then 'ARCHIVE_CUSTOMER' else 'RESTORE_CUSTOMER' end,
    auth.uid(),
    jsonb_build_object('is_archived', coalesce(v_c.is_archived, false), 'archived_at', v_c.archived_at, 'archived_by', v_c.archived_by),
    jsonb_build_object('is_archived', p_archive, 'by_employee', v_emp, 'by_role', v_role, 'seller_id', v_c.seller_id, 'open_balances', v_bal),
    null);

  return jsonb_build_object('status', 'ok', 'changed', true, 'customer_id', p_customer_id, 'is_archived', p_archive,
    'open_balances', v_bal);
end;
$$;
revoke all on function public.rpc_archive_customer(uuid, boolean) from public, anon;
grant execute on function public.rpc_archive_customer(uuid, boolean) to authenticated, service_role;

-- Direct table writes by a logged-in user (PostgREST, role authenticated) follow the same rule as the RPC.
-- The RPC runs as the function owner and is not affected; service-role / migrations are not affected.
create or replace function public._goldia_guard_customer_archive()
returns trigger
language plpgsql
security invoker -- must see the caller's role (a SECURITY DEFINER trigger would always see the owner and never guard)
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.is_archived is not distinct from old.is_archived
     and new.archived_at is not distinct from old.archived_at
     and new.archived_by is not distinct from old.archived_by then
    return new;
  end if;
  if public._goldia_is_management_role(public.current_employee_role_text()) then
    return new;
  end if;
  if public._goldia_is_seller_role(public.current_employee_role_text())
     and public.current_employee_id() is not null
     and old.seller_id = public.current_employee_id()
     and new.seller_id is not distinct from old.seller_id then
    return new;
  end if;
  raise exception 'Ruxsat etilmadi: mijozni faqat uning sotuvchisi, menejer yoki direktor arxivlay oladi' using errcode = '42501';
end;
$$;
revoke all on function public._goldia_guard_customer_archive() from public, anon, authenticated;

drop trigger if exists trg_goldia_guard_customer_archive on public.customers;
create trigger trg_goldia_guard_customer_archive
  before update of is_archived, archived_at, archived_by on public.customers
  for each row execute function public._goldia_guard_customer_archive();

-- ===================================================================================================================
-- B. Reopen (remove) the latest stored report period
-- ===================================================================================================================
create or replace function public.rpc_reopen_report_period(p_period_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid := public.current_organization_id();
  v_row  public.goldia_report_periods%rowtype;
  v_last date;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  perform pg_advisory_xact_lock(hashtextextended('goldia_report_period:' || v_org::text, 0));
  select * into v_row from public.goldia_report_periods where id = p_period_id and organization_id = v_org;
  if not found then
    -- already removed (repeated click) or another organization's period: nothing to do, nothing leaks
    return jsonb_build_object('status', 'ok', 'changed', false, 'id', p_period_id);
  end if;
  select max(period_end) into v_last from public.goldia_report_periods where organization_id = v_org;
  if v_row.period_end <> v_last then
    raise exception 'Faqat oxirgi saqlangan davrni (%) qayta ochish mumkin', v_last;
  end if;
  delete from public.goldia_report_periods where id = v_row.id;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'goldia_report_periods', v_row.id::text, 'REOPEN_REPORT_PERIOD', auth.uid(),
    to_jsonb(v_row), jsonb_build_object('reopened_by', public.current_employee_id()), nullif(btrim(p_reason), ''));
  return jsonb_build_object('status', 'ok', 'changed', true, 'id', v_row.id, 'period_start', v_row.period_start,
    'period_end', v_row.period_end);
end;
$$;
revoke all on function public.rpc_reopen_report_period(uuid, text) from public, anon;
grant execute on function public.rpc_reopen_report_period(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
