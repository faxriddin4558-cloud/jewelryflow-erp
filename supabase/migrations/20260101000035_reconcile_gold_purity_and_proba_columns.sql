-- =========================================================================
-- JewelryFlow ERP — Migration 035
-- Schema Reconciliation: Unify `proba` and `purity` across Gold Tables
-- =========================================================================
-- Solves the root cause of:
-- "daily_gold_rates: column 'purity' of relation 'daily_gold_rates' does not exist"
-- and protects all existing code, APIs, and future migrations by ensuring
-- bi-directional synchronization between `proba` and `purity`.
-- =========================================================================

-- 1. Harmonize public.daily_gold_rates
-- -------------------------------------------------------------------------
alter table public.daily_gold_rates
  add column if not exists purity numeric(6, 2) check (purity > 0 and purity <= 1000);

-- Backfill existing data
update public.daily_gold_rates
   set purity = proba
 where purity is null and proba is not null;

update public.daily_gold_rates
   set proba = purity
 where proba is null and purity is not null;

-- Bi-directional trigger function for daily_gold_rates
create or replace function public.trg_sync_daily_gold_rates_purity_proba()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.proba is not null and (new.purity is null or new.purity <> new.proba) then
    new.purity := new.proba;
  elsif new.purity is not null and (new.proba is null or new.proba <> new.purity) then
    new.proba := new.purity;
  elsif new.proba is null and new.purity is null then
    new.proba := 585;
    new.purity := 585;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_daily_gold_rates_purity on public.daily_gold_rates;
create trigger trg_sync_daily_gold_rates_purity
  before insert or update on public.daily_gold_rates
  for each row execute function public.trg_sync_daily_gold_rates_purity_proba();

create index if not exists idx_daily_gold_rates_purity_lookup
  on public.daily_gold_rates (organization_id, rate_date desc, purity);

-- -------------------------------------------------------------------------
-- 2. Harmonize public.consignment_pieces
-- -------------------------------------------------------------------------
alter table public.consignment_pieces
  add column if not exists proba numeric(6, 2) check (proba > 0 and proba <= 1000);

-- Backfill existing data
update public.consignment_pieces
   set proba = purity
 where proba is null and purity is not null;

update public.consignment_pieces
   set purity = proba
 where purity is null and proba is not null;

-- Bi-directional trigger function for consignment_pieces
create or replace function public.trg_sync_consignment_pieces_purity_proba()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.purity is not null and (new.proba is null or new.proba <> new.purity) then
    new.proba := new.purity;
  elsif new.proba is not null and (new.purity is null or new.purity <> new.proba) then
    new.purity := new.proba;
  elsif new.purity is null and new.proba is null then
    new.purity := 585;
    new.proba := 585;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_consignment_pieces_purity on public.consignment_pieces;
create trigger trg_sync_consignment_pieces_purity
  before insert or update on public.consignment_pieces
  for each row execute function public.trg_sync_consignment_pieces_purity_proba();

create index if not exists idx_consignment_pieces_proba
  on public.consignment_pieces (organization_id, proba);

-- -------------------------------------------------------------------------
-- 3. Update rpc_set_daily_gold_rate to populate both proba and purity
-- -------------------------------------------------------------------------
drop function if exists public.rpc_set_daily_gold_rate(numeric, numeric, date, text, text, text);
drop function if exists public.rpc_set_daily_gold_rate(numeric, numeric, numeric, date, text, text, text);
drop function if exists public.rpc_set_daily_gold_rate(numeric, numeric, date, text, text, text, numeric);

create or replace function public.rpc_set_daily_gold_rate(
  p_rate_per_gram   numeric,
  p_proba           numeric default 585,
  p_rate_date       date default current_date,
  p_currency        text default 'UZS',
  p_notes           text default null,
  p_idempotency_key text default null,
  p_purity          numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org  uuid := public.current_organization_id();
  v_caller_id   uuid := auth.uid();
  v_rate        numeric(18, 2);
  v_pr          numeric(6, 2);
  v_dt          date := coalesce(p_rate_date, current_date);
  v_cur         text := upper(trim(coalesce(p_currency, 'UZS')));
  v_payload     jsonb;
  v_existing    jsonb;
  v_rate_id     uuid;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  v_rate := round(coalesce(p_rate_per_gram, 0)::numeric, 2);
  if v_rate <= 0 then
    raise exception 'Lom kursi 0 dan katta bo''lishi shart (kiritildi: %)', p_rate_per_gram;
  end if;

  -- Support both p_proba and p_purity
  v_pr := round(coalesce(p_purity, p_proba, 585)::numeric, 2);
  if v_pr <= 0 or v_pr > 1000 then
    raise exception 'Proba 1 dan 1000 oralig''ida bo''lishi shart (kiritildi: %)', v_pr;
  end if;

  v_payload := jsonb_build_object(
    'action', 'set_daily_gold_rate',
    'rate_date', v_dt,
    'proba', v_pr,
    'purity', v_pr,
    'rate_per_gram', v_rate
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_set_daily_gold_rate', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.daily_gold_rates (
    organization_id, rate_date, proba, purity, rate_per_gram, currency, is_confirmed, set_by, notes, updated_at
  ) values (
    v_caller_org, v_dt, v_pr, v_pr, v_rate, v_cur, true, v_caller_id, p_notes, now()
  )
  on conflict (organization_id, rate_date, proba)
  do update set
    rate_per_gram = excluded.rate_per_gram,
    purity        = excluded.purity,
    currency      = excluded.currency,
    is_confirmed  = true,
    set_by        = excluded.set_by,
    notes         = coalesce(excluded.notes, daily_gold_rates.notes),
    updated_at    = now()
  returning id into v_rate_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'rate_id', v_rate_id,
    'rate_date', v_dt,
    'proba', v_pr,
    'purity', v_pr,
    'rate_per_gram', v_rate,
    'currency', v_cur
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_set_daily_gold_rate', v_existing, v_payload);
  return v_existing;
end;
$$;

-- -------------------------------------------------------------------------
-- 4. Permissions and RLS for daily_gold_rates & RPC
-- -------------------------------------------------------------------------
grant execute on function public.rpc_set_daily_gold_rate(numeric, numeric, date, text, text, text, numeric) to authenticated, anon;

grant select, insert, update on public.daily_gold_rates to authenticated, anon;

drop policy if exists "daily_gold_rates_admin_manage" on public.daily_gold_rates;
create policy "daily_gold_rates_admin_manage"
  on public.daily_gold_rates for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi')
  );

