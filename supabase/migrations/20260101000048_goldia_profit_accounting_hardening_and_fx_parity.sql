-- =============================================================================
-- MIGRATION 048: GOLDIA PROFIT ACCOUNTING HARDENING, IMMUTABILITY & FX PARITY
--
-- Fixes & Hardening for Migration 047:
-- 1. Purges all hidden hardcoded fallbacks (12800 USD, 950000 gold). Requires explicit confirmed rates.
-- 2. Strict till-currency pair validation on server:
--      manager_uzs <-> UZS, manager_usd <-> USD, manager_vault_gold <-> 585_GOLD
-- 3. Four-decimal precision for gold quantities (preserves numeric(18, 4) in transactions and deductions).
-- 4. Baseline and transaction immutability triggers (prevents UPDATE/DELETE on financial records).
-- 5. Strict RLS and grants: Revokes direct table modifications; restricts SELECT to authorized director/admin roles; blocks seller role.
-- 6. Clean FX drift calculation strictly on baseline cash positions:
--      Prevents newly injected capital from generating false operational trading profit when gold rate shifts.
-- 7. Historical period evaluation safety guard:
--      Rejects past end-dates without corresponding frozen snapshots instead of using current live balances.
-- =============================================================================

-- 1. Table Schema Hardening
alter table public.financial_transactions
  alter column amount_num type numeric(18, 4);

-- Enforce strict till-currency pairing at database constraint level
alter table public.financial_transactions
  drop constraint if exists chk_financial_transactions_till_currency;

alter table public.financial_transactions
  add constraint chk_financial_transactions_till_currency check (
    (source_till = 'manager_uzs' and currency = 'UZS') or
    (source_till = 'manager_usd' and currency = 'USD') or
    (source_till = 'manager_vault_gold' and currency = '585_GOLD')
  );

-- 2. Immutability Triggers for Baselines and Transactions
create or replace function public.trg_prevent_accounting_baseline_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'ERR_BASELINE_IMMUTABLE: Tasdiqlangan boshlang''ich hisob daxlsizdir. Uni o''chirish qat''iyan taqiqlanadi (ID: %)', OLD.id
      using errcode = '42501';
  end if;

  if TG_OP = 'UPDATE' then
    -- Only allow status transition from 'active' to 'archived', NO financial modification allowed
    if OLD.status = 'active' and NEW.status = 'archived'
       and NEW.id = OLD.id
       and NEW.organization_id = OLD.organization_id
       and NEW.baseline_no = OLD.baseline_no
       and NEW.net_assets_585_g = OLD.net_assets_585_g
       and NEW.total_assets_585_g = OLD.total_assets_585_g
       and NEW.total_liabilities_585_g = OLD.total_liabilities_585_g
       and NEW.gold_rate_585 = OLD.gold_rate_585
       and NEW.usd_rate = OLD.usd_rate
       and NEW.baseline_date = OLD.baseline_date then
      return NEW;
    end if;

    raise exception 'ERR_BASELINE_IMMUTABLE: Tasdiqlangan boshlang''ich hisob ko''rsatkichlarini o''zgartirish taqiqlanadi (ID: %)', OLD.id
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_accounting_baselines_immutable on public.accounting_baselines;
create trigger trg_accounting_baselines_immutable
  before update or delete on public.accounting_baselines
  for each row execute function public.trg_prevent_accounting_baseline_mutation();

create or replace function public.trg_prevent_financial_transaction_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'ERR_FINANCIAL_TRANSACTION_IMMUTABLE: Tasdiqlangan moliyaviy operatsiya yozuvini o''zgartirish yoki o''chirish taqiqlanadi (ID: %)', OLD.id
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_financial_transactions_immutable on public.financial_transactions;
create trigger trg_financial_transactions_immutable
  before update or delete on public.financial_transactions
  for each row execute function public.trg_prevent_financial_transaction_mutation();

-- 3. RLS & Table Permissions Hardening
revoke all on table public.accounting_baselines from public, anon;
revoke insert, update, delete on table public.accounting_baselines from authenticated;
grant select on table public.accounting_baselines to authenticated;

revoke all on table public.financial_transactions from public, anon;
revoke insert, update, delete on table public.financial_transactions from authenticated;
grant select on table public.financial_transactions to authenticated;

drop policy if exists "accounting_baselines_org_read" on public.accounting_baselines;
drop policy if exists "accounting_baselines_org_write" on public.accounting_baselines;

create policy "accounting_baselines_director_select"
  on public.accounting_baselines for select
  using (
    organization_id = public.current_organization_id() and
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'accountant', 'buxgalter')
  );

drop policy if exists "financial_transactions_org_read" on public.financial_transactions;
drop policy if exists "financial_transactions_org_write" on public.financial_transactions;

create policy "financial_transactions_director_select"
  on public.financial_transactions for select
  using (
    organization_id = public.current_organization_id() and
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'accountant', 'buxgalter')
  );

-- 4. rpc_record_financial_transaction
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
  v_amt             numeric(18, 4);
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
    raise exception 'ERR_INVALID_TX_TYPE: Noto''g''ri operatsiya turi: % (ruxsat: capital_contribution, capital_distribution, business_expense)', v_type;
  end if;

  if v_till not in ('manager_uzs', 'manager_usd', 'manager_vault_gold') then
    raise exception 'ERR_INVALID_TILL: Noto''g''ri kassa tanlandi: % (ruxsat: manager_uzs, manager_usd, manager_vault_gold)', v_till;
  end if;

  -- Strict pairing validation (FAIL-CLOSED)
  if (v_till = 'manager_uzs' and v_cur <> 'UZS') or
     (v_till = 'manager_usd' and v_cur <> 'USD') or
     (v_till = 'manager_vault_gold' and v_cur <> '585_GOLD') then
    raise exception 'ERR_INVALID_TILL_CURRENCY: Tanlangan kassa (%) faqat mos valyutada (%) ishlatilishi shart (Murojaat: %)',
      v_till,
      case v_till
        when 'manager_uzs' then 'UZS'
        when 'manager_usd' then 'USD'
        when 'manager_vault_gold' then '585_GOLD'
      end,
      v_cur
      using errcode = '22023';
  end if;

  if v_cur = '585_GOLD' then
    v_amt := round(greatest(0, coalesce(p_amount, 0))::numeric, 4);
  else
    v_amt := round(greatest(0, coalesce(p_amount, 0))::numeric, 2);
  end if;

  if v_amt <= 0 then
    raise exception 'ERR_ZERO_AMOUNT: Operatsiya summasi yoki miqdori 0 dan katta bo''lishi shart';
  end if;

  -- Resolve 585 gold rate (NO SILENT 950000 FALLBACK!)
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

  -- Resolve USD rate (NO SILENT 12800 FALLBACK!)
  if v_cur = 'USD' or v_till = 'manager_usd' then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_rate_usd := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) operatsiyasini hisoblash uchun USD kursi kiritilishi shart!'
        using errcode = '22023';
    end if;
  else
    v_rate_usd := null;
  end if;

  -- Calculate 585 gold equivalent with exact 4-decimal precision
  if v_cur = '585_GOLD' then
    v_equiv_585 := v_amt;
  elsif v_cur = 'UZS' then
    if v_rate_585 is null or v_rate_585 <= 0 then
      raise exception 'ERR_DAILY_RATE_NOT_SET: 585 oltin kursi belgilanmagan yoki tasdiqlanmagan'
        using errcode = '22023';
    end if;
    v_equiv_585 := round((v_amt / v_rate_585)::numeric, 4);
  elsif v_cur = 'USD' then
    if v_rate_585 is null or v_rate_585 <= 0 then
      raise exception 'ERR_DAILY_RATE_NOT_SET: 585 oltin kursi belgilanmagan yoki tasdiqlanmagan'
        using errcode = '22023';
    end if;
    v_equiv_585 := round(((v_amt * v_rate_usd) / v_rate_585)::numeric, 4);
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
    if v_till = 'manager_uzs' then
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount + v_amt, 2), updated_at = now()
       where organization_id = v_org_id;
    elsif v_till = 'manager_usd' then
      update public.manager_vault_account
         set manager_usd_amount = round(coalesce(manager_usd_amount, 0) + v_amt, 2), updated_at = now()
       where organization_id = v_org_id;
    elsif v_till = 'manager_vault_gold' then
      update public.manager_vault_account
         set manager_purchased_gold_grams = round(manager_purchased_gold_grams + v_equiv_585, 4), updated_at = now()
       where organization_id = v_org_id;
    end if;

  elsif v_type in ('capital_distribution', 'business_expense') then
    if v_till = 'manager_uzs' then
      if v_vault.manager_cash_amount < v_amt then
        raise exception 'ERR_INSUFFICIENT_VAULT_CASH: Seyfda yetarli naqd pul (UZS) mavjud emas (Mavjud: % UZS, Talab: % UZS)',
          v_vault.manager_cash_amount, v_amt;
      end if;
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount - v_amt, 2), updated_at = now()
       where organization_id = v_org_id;

    elsif v_till = 'manager_usd' then
      if coalesce(v_vault.manager_usd_amount, 0) < v_amt then
        raise exception 'ERR_INSUFFICIENT_VAULT_USD: Seyfda yetarli dollar (USD) mavjud emas (Mavjud: % USD, Talab: % USD)',
          coalesce(v_vault.manager_usd_amount, 0), v_amt;
      end if;
      update public.manager_vault_account
         set manager_usd_amount = round(coalesce(manager_usd_amount, 0) - v_amt, 2), updated_at = now()
       where organization_id = v_org_id;

    elsif v_till = 'manager_vault_gold' then
      if v_vault.manager_refined_gold_grams >= v_equiv_585 then
        update public.manager_vault_account
           set manager_refined_gold_grams = round(manager_refined_gold_grams - v_equiv_585, 4), updated_at = now()
         where organization_id = v_org_id;
      elsif v_vault.manager_purchased_gold_grams >= v_equiv_585 then
        update public.manager_vault_account
           set manager_purchased_gold_grams = round(manager_purchased_gold_grams - v_equiv_585, 4), updated_at = now()
         where organization_id = v_org_id;
      elsif round((v_vault.manager_refined_gold_grams + v_vault.manager_purchased_gold_grams)::numeric, 4) >= v_equiv_585 then
        update public.manager_vault_account
           set manager_refined_gold_grams = 0,
               manager_purchased_gold_grams = round((manager_purchased_gold_grams - (v_equiv_585 - v_vault.manager_refined_gold_grams))::numeric, 4),
               updated_at = now()
         where organization_id = v_org_id;
      else
        raise exception 'ERR_INSUFFICIENT_VAULT_GOLD: Seyfda yetarli sof/xarid oltin mavjud emas (Mavjud: % g, Talab: % g)',
          round(v_vault.manager_refined_gold_grams + v_vault.manager_purchased_gold_grams, 4), v_equiv_585;
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
    'gold_rate_applied', v_rate_585,
    'usd_rate_applied', v_rate_usd,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount,
    'manager_refined_gold_grams', v_vault.manager_refined_gold_grams,
    'manager_purchased_gold_grams', v_vault.manager_purchased_gold_grams
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_financial_transaction', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_financial_transaction to authenticated;

-- 5. rpc_confirm_accounting_baseline
drop function if exists public.rpc_confirm_accounting_baseline(text, text);
drop function if exists public.rpc_confirm_accounting_baseline(text, text, numeric);
create or replace function public.rpc_confirm_accounting_baseline(
  p_notes            text default null,
  p_idempotency_key  text default null,
  p_usd_rate         numeric default null
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
  v_rate_usd             numeric(18, 2);
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

  -- 1. Rates resolution (NO SILENT 950000 FALLBACK!)
  select rate_per_gram into v_rate_585
    from public.daily_gold_rates
   where organization_id = v_org_id and proba = 585 and rate_date = current_date and is_confirmed = true
   order by created_at desc limit 1;

  if v_rate_585 is null or v_rate_585 <= 0 then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Boshlang''ich hisobni tasdiqlash uchun bugungi tasdiqlangan 585 oltin kursi kiritilishi shart'
      using errcode = '22023';
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

  -- USD Rate resolution (NO SILENT 12800 FALLBACK!)
  if v_cash_usd_total > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_rate_usd := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Kassalarda dollar (USD) mavjud, boshlang''ich hisob uchun tasdiqlangan USD kursi kiritilishi shart'
        using errcode = '22023';
    end if;
  else
    v_rate_usd := coalesce(p_usd_rate, 1.0);
  end if;

  -- 4. Customer debts and advances
  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_customer_debts_g, v_customer_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  -- 5. Currency 585 gold equivalents
  v_cash_uzs_585_eq_g := round((v_cash_uzs_total / v_rate_585)::numeric, 4);
  if v_cash_usd_total > 0 and v_rate_usd > 0 then
    v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);
  else
    v_cash_usd_585_eq_g := 0;
  end if;

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
  -- Temporary disable trigger for archiving status update only
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
    v_rate_585, coalesce(v_rate_usd, 1.0),
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
    'gold_rate_585', v_rate_585,
    'usd_rate', v_rate_usd,
    'snapshot', v_snapshot
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_confirm_accounting_baseline', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_confirm_accounting_baseline(text, text, numeric) to authenticated;

-- 6. rpc_get_accounting_profit_summary
drop function if exists public.rpc_get_accounting_profit_summary(date, date);
drop function if exists public.rpc_get_accounting_profit_summary(date, date, numeric, numeric);
create or replace function public.rpc_get_accounting_profit_summary(
  p_start_date date default null,
  p_end_date   date default null,
  p_gold_rate  numeric default null,
  p_usd_rate   numeric default null
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
  v_rate_usd             numeric(18, 2);
  v_rate_confirmed       boolean := false;
  v_is_computable        boolean := true;
  v_missing              text[] := array[]::text[];
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
  v_end_dt               timestamptz;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  -- Historical Period Guard:
  -- If p_end_date is in the past, verify whether an exact frozen snapshot exists.
  if p_end_date is not null and p_end_date < current_date then
    select * into v_base
      from public.accounting_baselines
     where organization_id = v_org_id
       and baseline_date::date = p_end_date
     order by baseline_date desc limit 1;

    if v_base.id is null then
      return jsonb_build_object(
        'status', 'error',
        'is_computable', false,
        'has_baseline', false,
        'is_complete', false,
        'period_accounting_result_585_g', null,
        'missing_data', jsonb_build_array('Tarixiy davr (' || p_end_date::text || ') uchun muzlatilgan snapshot mavjud emas. Hozirgi qoldiqlardan o''tmish hisobiga foydalanish taqiqlanadi.')
      );
    end if;
  else
    -- Active baseline for live evaluation
    select * into v_base
      from public.accounting_baselines
     where organization_id = v_org_id and status = 'active'
     order by baseline_date desc limit 1;
  end if;

  if v_base.id is not null then
    v_start_dt := coalesce(p_start_date::timestamptz, v_base.baseline_date);
  else
    v_start_dt := coalesce(p_start_date::timestamptz, current_date::timestamptz);
    v_missing := array_append(v_missing, 'ERR_BASELINE_NOT_SET: Boshlang''ich hisob tasdiqlanmagan');
  end if;

  v_end_dt := coalesce(p_end_date::timestamptz + interval '23 hours 59 minutes 59 seconds', now());

  -- 2. Daily Gold Rate (NO SILENT 950000 FALLBACK!)
  if p_gold_rate is not null and p_gold_rate > 0 then
    v_rate_585 := round(p_gold_rate::numeric, 2);
    v_rate_confirmed := true;
  else
    select rate_per_gram, is_confirmed into v_rate_585, v_rate_confirmed
      from public.daily_gold_rates
     where organization_id = v_org_id and proba = 585 and rate_date = current_date and is_confirmed = true
     order by created_at desc limit 1;
  end if;

  if v_rate_585 is null or v_rate_585 <= 0 then
    v_rate_confirmed := false;
    v_missing := array_append(v_missing, 'ERR_DAILY_GOLD_RATE_NOT_CONFIRMED: Bugungi 585 oltin kursi tasdiqlanmagan');
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

  -- USD Rate (NO SILENT 12800 FALLBACK!)
  if p_usd_rate is not null and p_usd_rate > 0 then
    v_rate_usd := round(p_usd_rate::numeric, 2);
  elsif v_cash_usd_total > 0 then
    v_missing := array_append(v_missing, 'ERR_USD_RATE_NOT_SET: Kassalarda dollar (USD) mavjud, bugungi USD kursi kiritilishi shart');
  else
    v_rate_usd := null;
  end if;

  -- 5. Customer debts and advances
  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_customer_debts_g, v_customer_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  -- If critical data is missing, fail-closed without inventing numbers
  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object(
      'status', 'incomplete',
      'has_baseline', (v_base.id is not null),
      'is_complete', false,
      'is_computable', false,
      'as_of_time', timezone('Asia/Tashkent', now()),
      'missing_data', to_jsonb(v_missing),
      'current_net_assets_585_g', null,
      'period_accounting_result_585_g', null,
      'operational_trading_result_585_g', null,
      'fx_valuation_impact_585_g', null
    );
  end if;

  -- 6. Currency equivalents at CURRENT confirmed rates
  v_cash_uzs_585_eq_g := round((v_cash_uzs_total / v_rate_585)::numeric, 4);
  if v_cash_usd_total > 0 and v_rate_usd > 0 then
    v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);
  else
    v_cash_usd_585_eq_g := 0;
  end if;

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
  -- Formula: Period Result = Current Net Assets - Baseline Net Assets - Capital Injected + Capital Distributed
  v_period_accounting_res := round(
    v_cur_net_assets_g - v_base.net_assets_585_g - v_cap_in_g + v_cap_out_g,
    4
  );

  -- 10. Accurate FX / Valuation Drift:
  -- FX drift applies STRICTLY to the baseline cash balances that experienced rate drift!
  -- Newly injected capital entered at transaction-time rates and has zero baseline revaluation drift.
  if v_base.gold_rate_585 > 0 and v_rate_585 > 0 and (v_base.gold_rate_585 <> v_rate_585 or coalesce(v_base.usd_rate, 0) <> coalesce(v_rate_usd, 0)) then
    v_fx_drift_g := round(
      -- Baseline UZS cash drift
      ((coalesce(v_base.cash_uzs_amount, 0) / v_rate_585) - coalesce(v_base.cash_uzs_585_eq_g, 0)) +
      -- Baseline USD cash drift
      (case when coalesce(v_base.cash_usd_amount, 0) > 0 and v_rate_usd > 0
            then ((v_base.cash_usd_amount * v_rate_usd) / v_rate_585) - coalesce(v_base.cash_usd_585_eq_g, 0)
            else 0 end),
      4
    );
  else
    v_fx_drift_g := 0;
  end if;

  v_trading_res_g := round(v_period_accounting_res - v_fx_drift_g, 4);

  return jsonb_build_object(
    'status', 'ok',
    'has_baseline', true,
    'is_complete', true,
    'is_computable', true,
    'as_of_time', timezone('Asia/Tashkent', now()),
    'period_start', v_start_dt,
    'period_end', v_end_dt,
    'rates', jsonb_build_object(
      'gold_rate_585', v_rate_585,
      'is_confirmed', v_rate_confirmed,
      'usd_rate', v_rate_usd
    ),
    'baseline', jsonb_build_object(
      'id', v_base.id,
      'baseline_no', v_base.baseline_no,
      'baseline_date', v_base.baseline_date,
      'net_assets_585_g', v_base.net_assets_585_g,
      'total_assets_585_g', v_base.total_assets_585_g,
      'total_liabilities_585_g', v_base.total_liabilities_585_g,
      'gold_rate_585', v_base.gold_rate_585,
      'usd_rate', v_base.usd_rate
    ),
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

grant execute on function public.rpc_get_accounting_profit_summary(date, date, numeric, numeric) to authenticated;
