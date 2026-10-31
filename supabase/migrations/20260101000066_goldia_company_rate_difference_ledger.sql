-- JewelryFlow ERP Migration 20260101000066
-- GOLDIA SALES: COMPANY CASH-TO-SCRAP RATE DIFFERENCE LEDGER
--
-- Business rule. A seller converts customer cash to 585 grams at the transaction rate and hands
-- the full cash to the manager; that settles the seller's gram obligation. When the manager later
-- spends that cash on scrap gold at a different rate, the gap between the 585 grams the cash was
-- worth when it was received and the 585 grams actually bought belongs to GOLDIA (company), e.g.
--   890,000 UZS received as 1.0000 g, scrap bought at 900,000 UZS/g -> 0.9889 g -> -0.0111 g
--   890,000 UZS received as 1.0000 g, scrap bought at 880,000 UZS/g -> 1.0114 g -> +0.0114 g
--
-- Also fixes: USD-only settlements were rejected by chk_gold_settlement_has_payment (section 0).
--
-- Design (schema only; no historical row is changed or recalculated):
--   * manager_vault_account keeps a "valued cash pool": UZS / USD received from seller
--     handovers together with the 585 grams they settled. Only cash received after this
--     migration is valued; older vault cash stays unvalued and produces no difference.
--   * Each confirmed gold purchase consumes the pool at its average gram value (weighted
--     average) and writes one row to company_rate_differences. A purchase reversal writes an
--     offsetting row and returns the consumed value to the pool.
--   * Seller obligations, customer debts and settlement rows are not touched.
--   * The difference is realized only when the purchase is recorded (scrap physically received).
--   * rpc_get_accounting_profit_summary already revalues cash and gold at the current rate, so
--     these differences are ALREADY inside its net-asset profit. The ledger is an explanatory,
--     auditable breakdown and must not be added to that profit a second time.

-- -------------------------------------------------------------------------
-- 0. USD-only payments were rejected: the 026 constraint predates the USD columns (045/046).
--    Every existing row already satisfies the wider rule.
-- -------------------------------------------------------------------------
alter table public.gold_settlements drop constraint if exists chk_gold_settlement_has_payment;
alter table public.gold_settlements add constraint chk_gold_settlement_has_payment
  check (scrap_weight_grams > 0 or cash_paid_amount > 0 or coalesce(usd_paid_amount, 0) > 0);

-- -------------------------------------------------------------------------
-- 1. Valued cash pool on the manager vault
-- -------------------------------------------------------------------------
alter table public.manager_vault_account
  add column if not exists valued_cash_uzs   numeric(18, 2) not null default 0,
  add column if not exists valued_cash_585_g numeric(18, 6) not null default 0,
  add column if not exists valued_usd        numeric(18, 2) not null default 0,
  add column if not exists valued_usd_585_g  numeric(18, 6) not null default 0;

-- Valued cash can never exceed the cash physically in the vault. Any outflow that is not a
-- purchase (expense, factory handover, reset, ...) and pushes cash below the valued pool shrinks
-- the pool proportionally at that moment, so later unvalued inflows never revive old valuations.
create or replace function public.trg_goldia_cap_valued_pool()
returns trigger
language plpgsql
as $$
begin
  if new.valued_cash_uzs > greatest(coalesce(new.manager_cash_amount, 0), 0) then
    new.valued_cash_585_g := case when new.valued_cash_uzs > 0
      then round(new.valued_cash_585_g * greatest(coalesce(new.manager_cash_amount, 0), 0) / new.valued_cash_uzs, 6) else 0 end;
    new.valued_cash_uzs := greatest(coalesce(new.manager_cash_amount, 0), 0);
  end if;
  if new.valued_usd > greatest(coalesce(new.manager_usd_amount, 0), 0) then
    new.valued_usd_585_g := case when new.valued_usd > 0
      then round(new.valued_usd_585_g * greatest(coalesce(new.manager_usd_amount, 0), 0) / new.valued_usd, 6) else 0 end;
    new.valued_usd := greatest(coalesce(new.manager_usd_amount, 0), 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_goldia_cap_valued_pool on public.manager_vault_account;
create trigger trg_goldia_cap_valued_pool
  before update on public.manager_vault_account
  for each row execute function public.trg_goldia_cap_valued_pool();

-- -------------------------------------------------------------------------
-- 2. Company-level difference ledger (append-only)
-- -------------------------------------------------------------------------
create table if not exists public.company_rate_differences (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id),
  entry_type               text not null check (entry_type in ('purchase', 'purchase_reversal')),
  purchase_id              uuid not null references public.gold_purchases(id),
  reversal_of_id           uuid references public.company_rate_differences(id),
  cash_spent_uzs           numeric(18, 2) not null default 0,
  usd_spent                numeric(18, 2) not null default 0,
  usd_rate                 numeric(14, 2),
  valued_cash_uzs          numeric(18, 2) not null default 0,
  valued_usd               numeric(18, 2) not null default 0,
  valued_cash_585_g        numeric(18, 6) not null default 0,
  valued_usd_585_g         numeric(18, 6) not null default 0,
  unvalued_cost_uzs        numeric(18, 2) not null default 0,
  purchase_rate_per_gram   numeric(18, 2),
  physical_grams           numeric(14, 4) not null default 0,
  proba                    numeric(6, 2),
  purchased_585_g          numeric(18, 6) not null default 0,
  valued_purchased_585_g   numeric(18, 6) not null default 0,
  accounting_value_585_g   numeric(18, 6) not null default 0,
  avg_conversion_rate      numeric(18, 2),
  difference_585_g         numeric(18, 6) not null default 0,
  created_by               uuid,
  created_at               timestamptz not null default now()
);

create unique index if not exists company_rate_differences_one_per_purchase
  on public.company_rate_differences (purchase_id, entry_type);
create index if not exists company_rate_differences_org_created
  on public.company_rate_differences (organization_id, created_at);

alter table public.company_rate_differences enable row level security;
drop policy if exists "company_rate_differences_select" on public.company_rate_differences;
create policy "company_rate_differences_select" on public.company_rate_differences
  for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
      'manager', 'production_manager', 'boshqaruvchi')
  );
revoke insert, update, delete on table public.company_rate_differences from anon, authenticated;

-- -------------------------------------------------------------------------
-- 3. Seller -> manager handovers fill the valued pool
-- -------------------------------------------------------------------------
create or replace function public.trg_goldia_valued_cash_from_settlement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vault   public.manager_vault_account%rowtype;
  v_take    numeric(18, 2);
  v_take_g  numeric(18, 6);
begin
  if new.direction <> 'seller_to_manager' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Only the original confirmed handover; compensating rows are inserted as 'reversed'.
    if new.reversal_of_id is not null or coalesce(new.status, 'confirmed') <> 'confirmed' then
      return new;
    end if;
    perform public._get_or_create_manager_vault(new.organization_id);
    update public.manager_vault_account
       set valued_cash_uzs   = round(valued_cash_uzs + coalesce(new.cash_paid_amount, 0), 2),
           valued_cash_585_g = round(valued_cash_585_g + case when coalesce(new.cash_paid_amount, 0) > 0
                                 then coalesce(new.cash_equivalent_grams, 0) else 0 end, 6),
           valued_usd        = round(valued_usd + coalesce(new.usd_paid_amount, 0), 2),
           valued_usd_585_g  = round(valued_usd_585_g + case when coalesce(new.usd_paid_amount, 0) > 0
                                 then coalesce(new.usd_equivalent_grams, 0) else 0 end, 6)
     where organization_id = new.organization_id;
    return new;
  end if;

  -- UPDATE: a confirmed handover was reversed -> take its own value back out of the pool
  -- (never more than the pool still holds).
  if old.status is distinct from 'reversed' and new.status = 'reversed' and new.reversal_of_id is null then
    select * into v_vault from public.manager_vault_account where organization_id = new.organization_id for update;
    if not found then
      return new;
    end if;
    if coalesce(new.cash_paid_amount, 0) > 0 then
      v_take   := least(v_vault.valued_cash_uzs, new.cash_paid_amount);
      v_take_g := least(v_vault.valued_cash_585_g,
                        coalesce(new.cash_equivalent_grams, 0) * v_take / new.cash_paid_amount);
      v_vault.valued_cash_uzs   := v_vault.valued_cash_uzs - v_take;
      v_vault.valued_cash_585_g := v_vault.valued_cash_585_g - v_take_g;
    end if;
    if coalesce(new.usd_paid_amount, 0) > 0 then
      v_take   := least(v_vault.valued_usd, new.usd_paid_amount);
      v_take_g := least(v_vault.valued_usd_585_g,
                        coalesce(new.usd_equivalent_grams, 0) * v_take / new.usd_paid_amount);
      v_vault.valued_usd       := v_vault.valued_usd - v_take;
      v_vault.valued_usd_585_g := v_vault.valued_usd_585_g - v_take_g;
    end if;
    update public.manager_vault_account
       set valued_cash_uzs = round(v_vault.valued_cash_uzs, 2), valued_cash_585_g = round(v_vault.valued_cash_585_g, 6),
           valued_usd = round(v_vault.valued_usd, 2), valued_usd_585_g = round(v_vault.valued_usd_585_g, 6)
     where organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_goldia_valued_cash_from_settlement on public.gold_settlements;
create trigger trg_goldia_valued_cash_from_settlement
  after insert or update of status on public.gold_settlements
  for each row execute function public.trg_goldia_valued_cash_from_settlement();

-- -------------------------------------------------------------------------
-- 4. Gold purchases consume the pool and record the company difference
-- -------------------------------------------------------------------------
create or replace function public.trg_goldia_rate_difference_from_purchase()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vault        public.manager_vault_account%rowtype;
  v_cash         numeric(18, 2) := coalesce(new.cash_spent_uzs, 0);
  v_usd          numeric(18, 2) := coalesce(new.usd_spent, 0);
  v_usd_rate     numeric(14, 2) := new.usd_rate;
  v_total_cost   numeric(18, 2);
  v_pool_uzs     numeric(18, 2);
  v_pool_uzs_g   numeric(18, 6);
  v_pool_usd     numeric(18, 2);
  v_pool_usd_g   numeric(18, 6);
  v_val_cash     numeric(18, 2) := 0;
  v_val_cash_g   numeric(18, 6) := 0;
  v_val_usd      numeric(18, 2) := 0;
  v_val_usd_g    numeric(18, 6) := 0;
  v_valued_cost  numeric(18, 2);
  v_valued_585   numeric(18, 6);
  v_orig         public.company_rate_differences%rowtype;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.status, 'confirmed') <> 'confirmed' then
      return new;
    end if;
    perform public._get_or_create_manager_vault(new.organization_id);
    select * into v_vault from public.manager_vault_account where organization_id = new.organization_id for update;

    -- The purchase RPC inserts this row before it deducts the vault, so the vault still shows the
    -- cash available before the purchase. Valued cash can never exceed the cash really present
    -- (other outflows such as expenses shrink it proportionally).
    v_pool_uzs   := least(v_vault.valued_cash_uzs, greatest(coalesce(v_vault.manager_cash_amount, 0), 0));
    v_pool_uzs_g := case when v_vault.valued_cash_uzs > 0
                         then v_vault.valued_cash_585_g * v_pool_uzs / v_vault.valued_cash_uzs else 0 end;
    v_pool_usd   := least(v_vault.valued_usd, greatest(coalesce(v_vault.manager_usd_amount, 0), 0));
    v_pool_usd_g := case when v_vault.valued_usd > 0
                         then v_vault.valued_usd_585_g * v_pool_usd / v_vault.valued_usd else 0 end;

    -- Weighted-average consumption of the valued pool
    if v_cash > 0 and v_pool_uzs > 0 then
      v_val_cash   := least(v_cash, v_pool_uzs);
      v_val_cash_g := round(v_pool_uzs_g * v_val_cash / v_pool_uzs, 6);
    end if;
    if v_usd > 0 and v_pool_usd > 0 then
      v_val_usd   := least(v_usd, v_pool_usd);
      v_val_usd_g := round(v_pool_usd_g * v_val_usd / v_pool_usd, 6);
    end if;

    update public.manager_vault_account
       set valued_cash_uzs   = round(v_pool_uzs - v_val_cash, 2),
           valued_cash_585_g = round(v_pool_uzs_g - v_val_cash_g, 6),
           valued_usd        = round(v_pool_usd - v_val_usd, 2),
           valued_usd_585_g  = round(v_pool_usd_g - v_val_usd_g, 6)
     where organization_id = new.organization_id;

    if v_val_cash = 0 and v_val_usd = 0 then
      return new; -- paid entirely from unvalued (pre-066 or non-handover) cash: no difference to record
    end if;

    v_total_cost  := coalesce(new.total_cost_uzs, v_cash + v_usd * coalesce(v_usd_rate, 0));
    v_valued_cost := round(v_val_cash + v_val_usd * coalesce(v_usd_rate, 0), 2);
    v_valued_585  := case when v_total_cost > 0
                          then round(coalesce(new.equiv_585_grams, 0) * v_valued_cost / v_total_cost, 6) else 0 end;

    insert into public.company_rate_differences (
      organization_id, entry_type, purchase_id,
      cash_spent_uzs, usd_spent, usd_rate, valued_cash_uzs, valued_usd, valued_cash_585_g, valued_usd_585_g, unvalued_cost_uzs,
      purchase_rate_per_gram, physical_grams, proba, purchased_585_g, valued_purchased_585_g,
      accounting_value_585_g, avg_conversion_rate, difference_585_g, created_by
    ) values (
      new.organization_id, 'purchase', new.id,
      v_cash, v_usd, v_usd_rate, v_val_cash, v_val_usd, v_val_cash_g, v_val_usd_g, round(greatest(v_total_cost - v_valued_cost, 0), 2),
      new.rate_per_gram, coalesce(new.gold_weight_grams, 0), new.proba, coalesce(new.equiv_585_grams, 0), v_valued_585,
      round(v_val_cash_g + v_val_usd_g, 6),
      case when v_val_cash_g > 0 then round(v_val_cash / v_val_cash_g, 2) end,
      round(v_valued_585 - (v_val_cash_g + v_val_usd_g), 6),
      coalesce(new.recorded_by, public.current_employee_id())
    );
    return new;
  end if;

  -- UPDATE: purchase reversed -> offset its difference and give the value back to the pool
  if old.status is distinct from 'reversed' and new.status = 'reversed' then
    select * into v_orig from public.company_rate_differences
     where purchase_id = new.id and entry_type = 'purchase';
    if not found then
      return new;
    end if;
    perform public._get_or_create_manager_vault(new.organization_id);
    update public.manager_vault_account
       set valued_cash_uzs   = round(valued_cash_uzs + v_orig.valued_cash_uzs, 2),
           valued_cash_585_g = round(valued_cash_585_g + v_orig.valued_cash_585_g, 6),
           valued_usd        = round(valued_usd + v_orig.valued_usd, 2),
           valued_usd_585_g  = round(valued_usd_585_g + v_orig.valued_usd_585_g, 6)
     where organization_id = new.organization_id;
    insert into public.company_rate_differences (
      organization_id, entry_type, purchase_id, reversal_of_id,
      cash_spent_uzs, usd_spent, usd_rate, valued_cash_uzs, valued_usd, valued_cash_585_g, valued_usd_585_g, unvalued_cost_uzs,
      purchase_rate_per_gram, physical_grams, proba, purchased_585_g, valued_purchased_585_g,
      accounting_value_585_g, avg_conversion_rate, difference_585_g, created_by
    ) values (
      v_orig.organization_id, 'purchase_reversal', v_orig.purchase_id, v_orig.id,
      -v_orig.cash_spent_uzs, -v_orig.usd_spent, v_orig.usd_rate, -v_orig.valued_cash_uzs, -v_orig.valued_usd,
      -v_orig.valued_cash_585_g, -v_orig.valued_usd_585_g, -v_orig.unvalued_cost_uzs,
      v_orig.purchase_rate_per_gram, -v_orig.physical_grams, v_orig.proba, -v_orig.purchased_585_g, -v_orig.valued_purchased_585_g,
      -v_orig.accounting_value_585_g, v_orig.avg_conversion_rate, -v_orig.difference_585_g,
      public.current_employee_id()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_goldia_rate_difference_from_purchase on public.gold_purchases;
create trigger trg_goldia_rate_difference_from_purchase
  after insert or update of status on public.gold_purchases
  for each row execute function public.trg_goldia_rate_difference_from_purchase();

revoke all on function public.trg_goldia_valued_cash_from_settlement() from public, anon, authenticated;
revoke all on function public.trg_goldia_rate_difference_from_purchase() from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- 5. Director report
-- -------------------------------------------------------------------------
create or replace function public.rpc_get_company_rate_difference_report(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   uuid := public.current_organization_id();
  v_from  date := coalesce(p_from, date '2000-01-01');
  v_to    date := coalesce(p_to, current_date);
  v_vault public.manager_vault_account%rowtype;
  v_res   jsonb;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi']);

  select * into v_vault from public.manager_vault_account where organization_id = v_org;

  select jsonb_build_object(
    'status', 'ok',
    'period_from', v_from,
    'period_to', v_to,
    'net_difference_585_g', coalesce(round(sum(d.difference_585_g), 6), 0),
    'gain_585_g', coalesce(round(sum(d.difference_585_g) filter (where d.entry_type = 'purchase' and d.difference_585_g > 0
                     and not exists (select 1 from public.company_rate_differences r where r.reversal_of_id = d.id)), 6), 0),
    'loss_585_g', coalesce(round(sum(d.difference_585_g) filter (where d.entry_type = 'purchase' and d.difference_585_g < 0
                     and not exists (select 1 from public.company_rate_differences r where r.reversal_of_id = d.id)), 6), 0),
    'purchases_count', count(*) filter (where d.entry_type = 'purchase'),
    'reversals_count', count(*) filter (where d.entry_type = 'purchase_reversal'),
    'valued_cash_pool_uzs', coalesce(v_vault.valued_cash_uzs, 0),
    'valued_cash_pool_585_g', coalesce(v_vault.valued_cash_585_g, 0),
    'valued_usd_pool', coalesce(v_vault.valued_usd, 0),
    'valued_usd_pool_585_g', coalesce(v_vault.valued_usd_585_g, 0),
    'pool_avg_conversion_rate', case when coalesce(v_vault.valued_cash_585_g, 0) > 0
                                     then round(v_vault.valued_cash_uzs / v_vault.valued_cash_585_g, 2) end,
    'included_in_profit_summary', true,
    'note', 'Kompaniya kurs farqi rpc_get_accounting_profit_summary sof aktivlari ichida allaqachon bor; foydaga qayta qo''shilmaydi.',
    'entries', coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'created_at', d.created_at, 'entry_type', d.entry_type,
        'purchase_no', p.purchase_no, 'cash_spent_uzs', d.cash_spent_uzs, 'usd_spent', d.usd_spent,
        'valued_cash_uzs', d.valued_cash_uzs, 'valued_usd', d.valued_usd, 'usd_rate', d.usd_rate,
        'unvalued_cost_uzs', d.unvalued_cost_uzs,
        'avg_conversion_rate', d.avg_conversion_rate, 'purchase_rate_per_gram', d.purchase_rate_per_gram,
        'physical_grams', d.physical_grams, 'proba', d.proba,
        'valued_purchased_585_g', d.valued_purchased_585_g, 'accounting_value_585_g', d.accounting_value_585_g,
        'difference_585_g', d.difference_585_g
      ) order by d.created_at desc) filter (where d.id is not null), '[]'::jsonb)
  ) into v_res
  from public.company_rate_differences d
  join public.gold_purchases p on p.id = d.purchase_id
  where d.organization_id = v_org
    and d.created_at::date between v_from and v_to;

  return v_res;
end;
$$;

grant execute on function public.rpc_get_company_rate_difference_report(date, date) to authenticated;
