-- =============================================================================
-- MIGRATION 047: GOLDIA AUTOMATIC PROFIT ACCOUNTING & BASELINE MODULE
--
-- Objective:
-- Automated management profit & loss accounting for Goldia Sales (585 gold basis)
-- Formula:
--   Net Assets = Total Assets (585g) - Total External Liabilities (585g)
--   Period Accounting Result (585g) =
--     Current Net Assets - Baseline Net Assets - Capital Injected + Capital Distributed
--
-- Features:
-- 1. accounting_baselines table (frozen historical baseline snapshots)
-- 2. financial_transactions table (audited expenses, capital contributions, distributions)
-- 3. rpc_record_financial_transaction (atomic vault debits/credits)
-- 4. rpc_confirm_accounting_baseline (snapshot gathering & confirmation)
-- 5. rpc_get_accounting_profit_summary (server-side, tenant-isolated profit calculator)
-- =============================================================================

-- 1. Table: accounting_baselines
create table if not exists public.accounting_baselines (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations(id) on delete cascade,
  baseline_no                 text not null,
  baseline_date               timestamptz not null default now(),
  confirmed_by                uuid references public.employees(id) on delete set null,
  status                      text not null default 'active' check (status in ('active', 'archived')),
  gold_rate_585               numeric(18, 2) not null check (gold_rate_585 > 0),
  usd_rate                    numeric(18, 2) not null check (usd_rate > 0),
  manager_finished_g          numeric(14, 4) not null default 0 check (manager_finished_g >= 0),
  seller_finished_g           numeric(14, 4) not null default 0 check (seller_finished_g >= 0),
  manager_scrap_585_eq_g      numeric(14, 4) not null default 0 check (manager_scrap_585_eq_g >= 0),
  seller_scrap_585_eq_g       numeric(14, 4) not null default 0 check (seller_scrap_585_eq_g >= 0),
  manager_refined_gold_g      numeric(14, 4) not null default 0 check (manager_refined_gold_g >= 0),
  manager_purchased_gold_g    numeric(14, 4) not null default 0 check (manager_purchased_gold_g >= 0),
  customer_debts_585_g        numeric(14, 4) not null default 0 check (customer_debts_585_g >= 0),
  cash_uzs_amount             numeric(18, 2) not null default 0 check (cash_uzs_amount >= 0),
  cash_uzs_585_eq_g           numeric(14, 4) not null default 0 check (cash_uzs_585_eq_g >= 0),
  cash_usd_amount             numeric(18, 2) not null default 0 check (cash_usd_amount >= 0),
  cash_usd_585_eq_g           numeric(14, 4) not null default 0 check (cash_usd_585_eq_g >= 0),
  total_assets_585_g          numeric(14, 4) not null default 0 check (total_assets_585_g >= 0),
  factory_obligation_585_g    numeric(14, 4) not null default 0 check (factory_obligation_585_g >= 0),
  customer_advances_585_g     numeric(14, 4) not null default 0 check (customer_advances_585_g >= 0),
  total_liabilities_585_g     numeric(14, 4) not null default 0 check (total_liabilities_585_g >= 0),
  net_assets_585_g            numeric(14, 4) not null default 0,
  components_snapshot         jsonb not null default '{}'::jsonb,
  notes                       text,
  created_at                  timestamptz not null default now(),
  constraint uq_accounting_baselines_org_no unique (organization_id, baseline_no)
);

create index if not exists idx_accounting_baselines_org_status
  on public.accounting_baselines (organization_id, status, baseline_date desc);

-- 2. Table: financial_transactions
create table if not exists public.financial_transactions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  transaction_no         text not null,
  transaction_date       date not null default current_date,
  transaction_type       text not null check (transaction_type in ('capital_contribution', 'capital_distribution', 'business_expense')),
  source_till            text not null check (source_till in ('manager_uzs', 'manager_usd', 'manager_vault_gold')),
  amount_num             numeric(18, 2) not null check (amount_num > 0),
  currency               text not null check (currency in ('UZS', 'USD', '585_GOLD')),
  gold_rate_applied      numeric(18, 2) check (gold_rate_applied > 0),
  usd_rate_applied       numeric(18, 2) check (usd_rate_applied > 0),
  equiv_585_grams        numeric(14, 4) not null check (equiv_585_grams > 0),
  category               text,
  notes                  text,
  recorded_by            uuid references public.employees(id) on delete set null,
  idempotency_key        text unique,
  created_at             timestamptz not null default now(),
  constraint uq_financial_transactions_org_no unique (organization_id, transaction_no)
);

create index if not exists idx_financial_transactions_org_date
  on public.financial_transactions (organization_id, transaction_date desc);

-- Enable RLS
alter table public.accounting_baselines enable row level security;
alter table public.financial_transactions enable row level security;

create policy "accounting_baselines_org_read"
  on public.accounting_baselines for select
  using (organization_id = public.current_organization_id());

create policy "accounting_baselines_org_write"
  on public.accounting_baselines for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "financial_transactions_org_read"
  on public.financial_transactions for select
  using (organization_id = public.current_organization_id());

create policy "financial_transactions_org_write"
  on public.financial_transactions for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- 3. rpc_record_financial_transaction
create or replace function public.rpc_record_financial_transaction(
  p_transaction_type  text,
  p_source_till       text,
  p_amount            numeric,
  p_currency          text,
  p_category          text default null,
  p_notes             text default null,
  p_gold_rate         numeric default null,
  p_usd_rate          numeric default null,
  p_idempotency_key   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id          uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_tx_no           text;
  v_tx_id           uuid;
  v_amt             numeric(18, 2);
  v_cur             text := upper(btrim(p_currency));
  v_type            text := lower(btrim(p_transaction_type));
  v_till            text := lower(btrim(p_source_till));
  v_rate_585        numeric(18, 2);
  v_rate_usd        numeric(18, 2);
  v_equiv_585       numeric(14, 4);
  v_vault           public.manager_vault_account%rowtype;
  v_existing        jsonb;
  v_payload         jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id from public.employees where user_id = auth.uid() and organization_id = v_org_id limit 1;
  end if;

  if v_type not in ('capital_contribution', 'capital_distribution', 'business_expense') then
    raise exception 'Noto''g''ri operatsiya turi: % (ruxsat: capital_contribution, capital_distribution, business_expense)', v_type;
  end if;

  if v_till not in ('manager_uzs', 'manager_usd', 'manager_vault_gold') then
    raise exception 'Noto''g''ri kassa tanlandi: % (ruxsat: manager_uzs, manager_usd, manager_vault_gold)', v_till;
  end if;

  v_amt := round(greatest(0, coalesce(p_amount, 0))::numeric, 2);
  if v_amt <= 0 then
    raise exception 'Operatsiya summasi yoki miqdori 0 dan katta bo''lishi shart';
  end if;

  -- Resolve rates
  if p_gold_rate is not null and p_gold_rate > 0 then
    v_rate_585 := round(p_gold_rate::numeric, 2);
  else
    select rate_per_gram into v_rate_585
      from public.daily_gold_rates
     where organization_id = v_org_id
       and proba = 585
       and rate_date = current_date
       and is_confirmed = true
     order by created_at desc
     limit 1;
  end if;

  if p_usd_rate is not null and p_usd_rate > 0 then
    v_rate_usd := round(p_usd_rate::numeric, 2);
  else
    v_rate_usd := 12800.00;
  end if;

  -- Calculate 585 gold equivalent
  if v_cur = '585_GOLD' then
    v_equiv_585 := round(v_amt::numeric, 4);
  elsif v_cur = 'UZS' then
    if v_rate_585 is null or v_rate_585 <= 0 then
      raise exception 'ERR_DAILY_RATE_NOT_SET: 585 oltin kursi belgilanmagan';
    end if;
    v_equiv_585 := round((v_amt / v_rate_585)::numeric, 4);
  elsif v_cur = 'USD' then
    if v_rate_585 is null or v_rate_585 <= 0 then
      raise exception 'ERR_DAILY_RATE_NOT_SET: 585 oltin kursi belgilanmagan';
    end if;
    v_equiv_585 := round(((v_amt * v_rate_usd) / v_rate_585)::numeric, 4);
  else
    raise exception 'Noto''g''ri valyuta: % (ruxsat: UZS, USD, 585_GOLD)', v_cur;
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_financial_transaction',
    'type', v_type,
    'source_till', v_till,
    'amount', v_amt,
    'currency', v_cur
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_financial_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Lock manager vault
  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  -- Apply balance changes to manager vault
  if v_type = 'capital_contribution' then
    if v_till = 'manager_uzs' or v_cur = 'UZS' then
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount + v_amt, 2), updated_at = now()
       where organization_id = v_org_id;
    elsif v_till = 'manager_usd' or v_cur = 'USD' then
      update public.manager_vault_account
         set manager_usd_amount = round(coalesce(manager_usd_amount, 0) + v_amt, 2), updated_at = now()
       where organization_id = v_org_id;
    elsif v_till = 'manager_vault_gold' or v_cur = '585_GOLD' then
      update public.manager_vault_account
         set manager_purchased_gold_grams = round(manager_purchased_gold_grams + v_equiv_585, 4), updated_at = now()
       where organization_id = v_org_id;
    end if;

  elsif v_type in ('capital_distribution', 'business_expense') then
    if v_till = 'manager_uzs' or v_cur = 'UZS' then
      if v_vault.manager_cash_amount < v_amt then
        raise exception 'ERR_INSUFFICIENT_VAULT_CASH: Seyfda yetarli naqd pul (UZS) mavjud emas (Mavjud: % UZS, Talab: % UZS)',
          v_vault.manager_cash_amount, v_amt;
      end if;
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount - v_amt, 2), updated_at = now()
       where organization_id = v_org_id;

    elsif v_till = 'manager_usd' or v_cur = 'USD' then
      if coalesce(v_vault.manager_usd_amount, 0) < v_amt then
        raise exception 'ERR_INSUFFICIENT_VAULT_USD: Seyfda yetarli dollar (USD) mavjud emas (Mavjud: % USD, Talab: % USD)',
          coalesce(v_vault.manager_usd_amount, 0), v_amt;
      end if;
      update public.manager_vault_account
         set manager_usd_amount = round(coalesce(manager_usd_amount, 0) - v_amt, 2), updated_at = now()
       where organization_id = v_org_id;

    elsif v_till = 'manager_vault_gold' or v_cur = '585_GOLD' then
      if v_vault.manager_refined_gold_grams < v_equiv_585 and v_vault.manager_purchased_gold_grams < v_equiv_585 then
        raise exception 'ERR_INSUFFICIENT_VAULT_GOLD: Seyfda yetarli quyma yoki xarid oltin mavjud emas';
      end if;
      if v_vault.manager_refined_gold_grams >= v_equiv_585 then
        update public.manager_vault_account
           set manager_refined_gold_grams = round(manager_refined_gold_grams - v_equiv_585, 4), updated_at = now()
         where organization_id = v_org_id;
      else
        update public.manager_vault_account
           set manager_purchased_gold_grams = round(manager_purchased_gold_grams - v_equiv_585, 4), updated_at = now()
         where organization_id = v_org_id;
      end if;
    end if;
  end if;

  v_tx_no := 'FTX-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.financial_transactions (
    organization_id, transaction_no, transaction_date, transaction_type,
    source_till, amount_num, currency, gold_rate_applied, usd_rate_applied,
    equiv_585_grams, category, notes, recorded_by, idempotency_key
  ) values (
    v_org_id, v_tx_no, current_date, v_type,
    v_till, v_amt, v_cur, v_rate_585, v_rate_usd,
    v_equiv_585, p_category, p_notes, v_caller_emp_id, p_idempotency_key
  ) returning id into v_tx_id;

  select * into v_vault from public.manager_vault_account where organization_id = v_org_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'transaction_id', v_tx_id,
    'transaction_no', v_tx_no,
    'transaction_type', v_type,
    'source_till', v_till,
    'amount_num', v_amt,
    'currency', v_cur,
    'equiv_585_grams', v_equiv_585,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_financial_transaction', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_financial_transaction to authenticated;

-- 4. rpc_confirm_accounting_baseline
create or replace function public.rpc_confirm_accounting_baseline(
  p_notes            text default null,
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id               uuid := public.current_organization_id();
  v_caller_emp_id        uuid := public.current_employee_id();
  v_rate_585             numeric(18, 2);
  v_rate_usd             numeric(18, 2) := 12800.00;
  v_mgr_finished_g       numeric(14, 4) := 0;
  v_seller_finished_g    numeric(14, 4) := 0;
  v_mgr_scrap_585_eq_g   numeric(14, 4) := 0;
  v_seller_scrap_585_eq_g numeric(14, 4) := 0;
  v_mgr_refined_g        numeric(14, 4) := 0;
  v_mgr_purchased_g      numeric(14, 4) := 0;
  v_customer_debts_g     numeric(14, 4) := 0;
  v_customer_advances_g  numeric(14, 4) := 0;
  v_mgr_cash_uzs         numeric(18, 2) := 0;
  v_mgr_cash_usd         numeric(18, 2) := 0;
  v_seller_cash_uzs      numeric(18, 2) := 0;
  v_seller_cash_usd      numeric(18, 2) := 0;
  v_cash_uzs_total       numeric(18, 2) := 0;
  v_cash_uzs_585_eq_g    numeric(14, 4) := 0;
  v_cash_usd_total       numeric(18, 2) := 0;
  v_cash_usd_585_eq_g    numeric(14, 4) := 0;
  v_factory_obligation_g numeric(14, 4) := 0;
  v_total_assets_g       numeric(14, 4) := 0;
  v_total_liabilities_g  numeric(14, 4) := 0;
  v_net_assets_g         numeric(14, 4) := 0;
  v_baseline_no          text;
  v_baseline_id          uuid;
  v_snapshot             jsonb;
  v_existing             jsonb;
  v_payload              jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id from public.employees where user_id = auth.uid() and organization_id = v_org_id limit 1;
  end if;

  -- 1. Rates
  select rate_per_gram into v_rate_585
    from public.daily_gold_rates
   where organization_id = v_org_id and proba = 585 and rate_date = current_date and is_confirmed = true
   order by created_at desc limit 1;

  if v_rate_585 is null or v_rate_585 <= 0 then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Boshlang''ich hisobni tasdiqlash uchun bugungi tasdiqlangan 585 oltin kursi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object('action', 'confirm_accounting_baseline', 'org_id', v_org_id);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_confirm_accounting_baseline', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 2. Manager stock & vault
  perform public._get_or_create_manager_vault(v_org_id);
  v_mgr_finished_g := public.get_manager_available_stock_grams(v_org_id);

  select coalesce(manager_scrap_585_eq_g, manager_scrap_grams, 0),
         coalesce(manager_refined_gold_grams, 0),
         coalesce(manager_purchased_gold_grams, 0),
         coalesce(current_factory_obligation_g, 0),
         coalesce(manager_cash_amount, 0),
         coalesce(manager_usd_amount, 0)
    into v_mgr_scrap_585_eq_g, v_mgr_refined_g, v_mgr_purchased_g, v_factory_obligation_g, v_mgr_cash_uzs, v_mgr_cash_usd
    from public.manager_vault_account
   where organization_id = v_org_id;

  -- 3. Sellers stock and tills
  select coalesce(sum(public.get_seller_available_stock_grams(seller_id)), 0),
         coalesce(sum(coalesce(seller_till_scrap_585_eq_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(seller_till_cash_amount), 0),
         coalesce(sum(coalesce(seller_till_usd_amount, 0)), 0)
    into v_seller_finished_g, v_seller_scrap_585_eq_g, v_seller_cash_uzs, v_seller_cash_usd
    from public.seller_gold_accounts
   where organization_id = v_org_id;

  v_cash_uzs_total := round(v_mgr_cash_uzs + v_seller_cash_uzs, 2);
  v_cash_usd_total := round(v_mgr_cash_usd + v_seller_cash_usd, 2);

  -- 4. Customer debts and advances (Strictly separated)
  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_customer_debts_g, v_customer_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  -- 5. Currency 585 gold equivalents
  v_cash_uzs_585_eq_g := round((v_cash_uzs_total / v_rate_585)::numeric, 4);
  v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);

  -- 6. Total Assets, Liabilities, Net Assets
  v_total_assets_g := round(
    v_mgr_finished_g + v_seller_finished_g +
    v_mgr_scrap_585_eq_g + v_seller_scrap_585_eq_g +
    v_mgr_refined_g + v_mgr_purchased_g +
    v_customer_debts_g +
    v_cash_uzs_585_eq_g + v_cash_usd_585_eq_g,
    4
  );

  v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g, 4);
  v_net_assets_g := round(v_total_assets_g - v_total_liabilities_g, 4);

  -- 7. Archive previous active baselines
  update public.accounting_baselines
     set status = 'archived'
   where organization_id = v_org_id and status = 'active';

  v_baseline_no := 'BASE-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  v_snapshot := jsonb_build_object(
    'gold_rate_585', v_rate_585,
    'usd_rate', v_rate_usd,
    'manager_finished_g', v_mgr_finished_g,
    'seller_finished_g', v_seller_finished_g,
    'manager_scrap_585_eq_g', v_mgr_scrap_585_eq_g,
    'seller_scrap_585_eq_g', v_seller_scrap_585_eq_g,
    'manager_refined_gold_g', v_mgr_refined_g,
    'manager_purchased_gold_g', v_mgr_purchased_g,
    'customer_debts_585_g', v_customer_debts_g,
    'customer_advances_585_g', v_customer_advances_g,
    'manager_cash_uzs', v_mgr_cash_uzs,
    'sellers_cash_uzs', v_seller_cash_uzs,
    'cash_uzs_amount', v_cash_uzs_total,
    'cash_uzs_585_eq_g', v_cash_uzs_585_eq_g,
    'manager_cash_usd', v_mgr_cash_usd,
    'sellers_cash_usd', v_seller_cash_usd,
    'cash_usd_amount', v_cash_usd_total,
    'cash_usd_585_eq_g', v_cash_usd_585_eq_g,
    'factory_obligation_585_g', v_factory_obligation_g,
    'total_assets_585_g', v_total_assets_g,
    'total_liabilities_585_g', v_total_liabilities_g,
    'net_assets_585_g', v_net_assets_g
  );

  insert into public.accounting_baselines (
    organization_id, baseline_no, baseline_date, confirmed_by, status,
    gold_rate_585, usd_rate,
    manager_finished_g, seller_finished_g,
    manager_scrap_585_eq_g, seller_scrap_585_eq_g,
    manager_refined_gold_g, manager_purchased_gold_g,
    customer_debts_585_g,
    cash_uzs_amount, cash_uzs_585_eq_g,
    cash_usd_amount, cash_usd_585_eq_g,
    total_assets_585_g,
    factory_obligation_585_g, customer_advances_585_g, total_liabilities_585_g,
    net_assets_585_g, components_snapshot, notes
  ) values (
    v_org_id, v_baseline_no, now(), v_caller_emp_id, 'active',
    v_rate_585, v_rate_usd,
    v_mgr_finished_g, v_seller_finished_g,
    v_mgr_scrap_585_eq_g, v_seller_scrap_585_eq_g,
    v_mgr_refined_g, v_mgr_purchased_g,
    v_customer_debts_g,
    v_cash_uzs_total, v_cash_uzs_585_eq_g,
    v_cash_usd_total, v_cash_usd_585_eq_g,
    v_total_assets_g,
    v_factory_obligation_g, v_customer_advances_g, v_total_liabilities_g,
    v_net_assets_g, v_snapshot, p_notes
  ) returning id into v_baseline_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'baseline_id', v_baseline_id,
    'baseline_no', v_baseline_no,
    'net_assets_585_g', v_net_assets_g,
    'total_assets_585_g', v_total_assets_g,
    'total_liabilities_585_g', v_total_liabilities_g,
    'snapshot', v_snapshot
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_confirm_accounting_baseline', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_confirm_accounting_baseline to authenticated;

-- 5. rpc_get_accounting_profit_summary
create or replace function public.rpc_get_accounting_profit_summary(
  p_start_date date default null,
  p_end_date   date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id               uuid := public.current_organization_id();
  v_base                 public.accounting_baselines%rowtype;
  v_rate_585             numeric(18, 2);
  v_rate_usd             numeric(18, 2) := 12800.00;
  v_rate_confirmed       boolean := false;
  v_mgr_finished_g       numeric(14, 4) := 0;
  v_seller_finished_g    numeric(14, 4) := 0;
  v_mgr_scrap_585_eq_g   numeric(14, 4) := 0;
  v_mgr_scrap_physical_g numeric(14, 4) := 0;
  v_seller_scrap_585_eq_g numeric(14, 4) := 0;
  v_seller_scrap_phys_g  numeric(14, 4) := 0;
  v_mgr_refined_g        numeric(14, 4) := 0;
  v_mgr_purchased_g      numeric(14, 4) := 0;
  v_customer_debts_g     numeric(14, 4) := 0;
  v_customer_advances_g  numeric(14, 4) := 0;
  v_mgr_cash_uzs         numeric(18, 2) := 0;
  v_mgr_cash_usd         numeric(18, 2) := 0;
  v_seller_cash_uzs      numeric(18, 2) := 0;
  v_seller_cash_usd      numeric(18, 2) := 0;
  v_cash_uzs_total       numeric(18, 2) := 0;
  v_cash_uzs_585_eq_g    numeric(14, 4) := 0;
  v_cash_usd_total       numeric(18, 2) := 0;
  v_cash_usd_585_eq_g    numeric(14, 4) := 0;
  v_factory_obligation_g numeric(14, 4) := 0;
  v_total_assets_g       numeric(14, 4) := 0;
  v_total_liabilities_g  numeric(14, 4) := 0;
  v_cur_net_assets_g     numeric(14, 4) := 0;
  v_cap_in_g             numeric(14, 4) := 0;
  v_cap_out_g            numeric(14, 4) := 0;
  v_expenses_g           numeric(14, 4) := 0;
  v_period_accounting_res numeric(14, 4) := 0;
  v_fx_drift_g           numeric(14, 4) := 0;
  v_trading_res_g        numeric(14, 4) := 0;
  v_start_dt             timestamptz;
  v_end_dt               timestamptz := coalesce(p_end_date::timestamptz + interval '23 hours 59 minutes 59 seconds', now());
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  -- 1. Get active baseline
  select * into v_base
    from public.accounting_baselines
   where organization_id = v_org_id and status = 'active'
   order by baseline_date desc
   limit 1;

  if v_base.id is not null then
    v_start_dt := coalesce(p_start_date::timestamptz, v_base.baseline_date);
  else
    v_start_dt := coalesce(p_start_date::timestamptz, current_date::timestamptz);
  end if;

  -- 2. Daily Gold and USD rate
  select rate_per_gram, is_confirmed into v_rate_585, v_rate_confirmed
    from public.daily_gold_rates
   where organization_id = v_org_id and proba = 585 and rate_date = current_date
   order by created_at desc limit 1;

  if v_rate_585 is null or v_rate_585 <= 0 then
    v_rate_585 := coalesce(v_base.gold_rate_585, 950000.00);
    v_rate_confirmed := false;
  end if;

  -- 3. Manager stock & vault
  perform public._get_or_create_manager_vault(v_org_id);
  v_mgr_finished_g := public.get_manager_available_stock_grams(v_org_id);

  select coalesce(manager_scrap_585_eq_g, manager_scrap_grams, 0),
         coalesce(manager_scrap_physical_g, manager_scrap_grams, 0),
         coalesce(manager_refined_gold_grams, 0),
         coalesce(manager_purchased_gold_grams, 0),
         coalesce(current_factory_obligation_g, 0),
         coalesce(manager_cash_amount, 0),
         coalesce(manager_usd_amount, 0)
    into v_mgr_scrap_585_eq_g, v_mgr_scrap_physical_g, v_mgr_refined_g, v_mgr_purchased_g,
         v_factory_obligation_g, v_mgr_cash_uzs, v_mgr_cash_usd
    from public.manager_vault_account
   where organization_id = v_org_id;

  -- 4. Sellers stock and tills
  select coalesce(sum(public.get_seller_available_stock_grams(seller_id)), 0),
         coalesce(sum(coalesce(seller_till_scrap_585_eq_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(coalesce(seller_till_scrap_physical_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(seller_till_cash_amount), 0),
         coalesce(sum(coalesce(seller_till_usd_amount, 0)), 0)
    into v_seller_finished_g, v_seller_scrap_585_eq_g, v_seller_scrap_phys_g,
         v_seller_cash_uzs, v_seller_cash_usd
    from public.seller_gold_accounts
   where organization_id = v_org_id;

  v_cash_uzs_total := round(v_mgr_cash_uzs + v_seller_cash_uzs, 2);
  v_cash_usd_total := round(v_mgr_cash_usd + v_seller_cash_usd, 2);

  -- 5. Customer debts and advances
  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_customer_debts_g, v_customer_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  -- 6. Currency equivalents at CURRENT rate
  v_cash_uzs_585_eq_g := round((v_cash_uzs_total / v_rate_585)::numeric, 4);
  v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);

  -- 7. Current Net Assets
  v_total_assets_g := round(
    v_mgr_finished_g + v_seller_finished_g +
    v_mgr_scrap_585_eq_g + v_seller_scrap_585_eq_g +
    v_mgr_refined_g + v_mgr_purchased_g +
    v_customer_debts_g +
    v_cash_uzs_585_eq_g + v_cash_usd_585_eq_g,
    4
  );

  v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g, 4);
  v_cur_net_assets_g := round(v_total_assets_g - v_total_liabilities_g, 4);

  -- 8. Capital & Expense movements in period
  select coalesce(sum(case when transaction_type = 'capital_contribution' then equiv_585_grams else 0 end), 0),
         coalesce(sum(case when transaction_type = 'capital_distribution' then equiv_585_grams else 0 end), 0),
         coalesce(sum(case when transaction_type = 'business_expense' then equiv_585_grams else 0 end), 0)
    into v_cap_in_g, v_cap_out_g, v_expenses_g
    from public.financial_transactions
   where organization_id = v_org_id
     and created_at >= v_start_dt
     and created_at <= v_end_dt;

  -- 9. Period Accounting Result
  -- Formula: Period Result = Current Net Assets - Baseline Net Assets - Capital Injected + Capital Withdrawn
  if v_base.id is not null then
    v_period_accounting_res := round(
      v_cur_net_assets_g - v_base.net_assets_585_g - v_cap_in_g + v_cap_out_g,
      4
    );

    -- FX / Valuation Impact:
    -- Difference in cash gold equivalent between current rates and baseline rates
    if v_base.gold_rate_585 > 0 and v_rate_585 > 0 and (v_base.gold_rate_585 <> v_rate_585 or v_base.usd_rate <> v_rate_usd) then
      v_fx_drift_g := round(
        (v_cash_uzs_585_eq_g + v_cash_usd_585_eq_g) -
        ((v_cash_uzs_total / v_base.gold_rate_585) + ((v_cash_usd_total * v_base.usd_rate) / v_base.gold_rate_585)),
        4
      );
    else
      v_fx_drift_g := 0;
    end if;

    v_trading_res_g := round(v_period_accounting_res - v_fx_drift_g, 4);
  else
    v_period_accounting_res := 0;
    v_fx_drift_g := 0;
    v_trading_res_g := 0;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'has_baseline', (v_base.id is not null),
    'as_of_time', timezone('Asia/Tashkent', now()),
    'period_start', v_start_dt,
    'period_end', v_end_dt,
    'is_complete', (v_rate_confirmed = true),
    'rates', jsonb_build_object(
      'gold_rate_585', v_rate_585,
      'is_confirmed', v_rate_confirmed,
      'usd_rate', v_rate_usd
    ),
    'baseline', case when v_base.id is not null then jsonb_build_object(
      'id', v_base.id,
      'baseline_no', v_base.baseline_no,
      'baseline_date', v_base.baseline_date,
      'net_assets_585_g', v_base.net_assets_585_g,
      'total_assets_585_g', v_base.total_assets_585_g,
      'total_liabilities_585_g', v_base.total_liabilities_585_g,
      'gold_rate_585', v_base.gold_rate_585,
      'usd_rate', v_base.usd_rate
    ) else null end,
    'current_net_assets_585_g', v_cur_net_assets_g,
    'current_total_assets_585_g', v_total_assets_g,
    'current_total_liabilities_585_g', v_total_liabilities_g,
    'period_accounting_result_585_g', v_period_accounting_res,
    'fx_valuation_impact_585_g', v_fx_drift_g,
    'operational_trading_result_585_g', v_trading_res_g,
    'capital_contributions_585_g', v_cap_in_g,
    'capital_distributions_585_g', v_cap_out_g,
    'business_expenses_585_g', v_expenses_g,
    'components', jsonb_build_object(
      'manager_finished_goods_585_g', v_mgr_finished_g,
      'sellers_finished_goods_585_g', v_seller_finished_g,
      'manager_scrap_585_eq_g', v_mgr_scrap_585_eq_g,
      'manager_scrap_physical_g', v_mgr_scrap_physical_g,
      'sellers_scrap_585_eq_g', v_seller_scrap_585_eq_g,
      'sellers_scrap_physical_g', v_seller_scrap_phys_g,
      'manager_refined_gold_585_g', v_mgr_refined_g,
      'manager_purchased_gold_585_g', v_mgr_purchased_g,
      'customer_debts_585_g', v_customer_debts_g,
      'customer_advances_585_g', v_customer_advances_g,
      'manager_cash_uzs', v_mgr_cash_uzs,
      'sellers_cash_uzs', v_seller_cash_uzs,
      'cash_uzs_amount', v_cash_uzs_total,
      'cash_uzs_585_eq_g', v_cash_uzs_585_eq_g,
      'manager_cash_usd', v_mgr_cash_usd,
      'sellers_cash_usd', v_seller_cash_usd,
      'cash_usd_amount', v_cash_usd_total,
      'cash_usd_585_eq_g', v_cash_usd_585_eq_g,
      'factory_obligation_585_g', v_factory_obligation_g
    )
  );
end;
$$;

grant execute on function public.rpc_get_accounting_profit_summary to authenticated;
