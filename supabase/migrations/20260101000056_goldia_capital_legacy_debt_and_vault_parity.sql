-- =========================================================================
-- JEWELRYFLOW / GOLDIA SALES — MIGRATION 056
-- 1. MULTI-ASSET CAPITAL CONTRIBUTIONS (UZS, USD, Scrap, Fine Gold, Finished Goods)
-- 2. AUDITED CAPITAL RECLASSIFICATION (Director control without baseline mutation)
-- 3. SELLER RESPONSIBILITY FOR LEGACY CUSTOMER DEBT (Dilrabo Apka 45g -> Omonboy 163.16g)
-- 4. REFINING & PATERIYA MASS BALANCE (Single-count profit parity & proba support)
-- 5. REVERSED DOCUMENTS FILTERING IN RECONCILIATION & MONTHLY REPORTS
-- 6. BASELINE ASSET SNAPSHOTTING & PROFIT PARITY
-- =========================================================================

-- -------------------------------------------------------------------------
-- PART 1: SCHEMA ENHANCEMENTS
-- -------------------------------------------------------------------------

-- 1. Manager Vault Account enhancements
alter table public.manager_vault_account
  add column if not exists manager_capital_pure_gold_g numeric(14, 4) not null default 0 check (manager_capital_pure_gold_g >= 0),
  add column if not exists manager_capital_pure_gold_fine_g numeric(14, 4) not null default 0 check (manager_capital_pure_gold_fine_g >= 0),
  add column if not exists manager_finished_capital_g numeric(14, 4) not null default 0 check (manager_finished_capital_g >= 0);

-- Allow zero factory obligation for capital finished goods
alter table public.factory_receipts
  drop constraint if exists factory_receipts_factory_obligation_g_check;
alter table public.factory_receipts
  add constraint factory_receipts_factory_obligation_g_check check (factory_obligation_g >= 0);

-- 2. Seller Gold Accounts enhancements
alter table public.seller_gold_accounts
  add column if not exists seller_legacy_debt_obligation_g numeric(14, 4) not null default 0 check (seller_legacy_debt_obligation_g >= 0);

-- 3. Refining Batches enhancements
alter table public.refining_batches
  add column if not exists input_scrap_proba numeric(6, 2) default 585.0 check (input_scrap_proba > 0 and input_scrap_proba <= 1000),
  add column if not exists input_585_equiv_grams numeric(14, 4);

update public.refining_batches
set input_scrap_proba = coalesce(input_scrap_proba, 585.0),
    input_585_equiv_grams = coalesce(input_585_equiv_grams, round((input_scrap_grams * (coalesce(input_scrap_proba, 585.0) / 585.0))::numeric, 4))
where input_585_equiv_grams is null;

-- 4. Financial Transactions enhancements
alter table public.financial_transactions drop constraint if exists financial_transactions_source_till_check;
alter table public.financial_transactions drop constraint if exists financial_transactions_currency_check;
alter table public.financial_transactions drop constraint if exists chk_financial_transactions_till_currency;

alter table public.financial_transactions
  add constraint chk_financial_transactions_till_currency check (
    (source_till in ('manager_uzs', 'seller_till_uzs') and currency = 'UZS') or
    (source_till in ('manager_usd', 'seller_till_usd') and currency = 'USD') or
    (source_till = 'manager_vault_gold' and currency = '585_GOLD') or
    (source_till in ('manager_scrap', 'seller_till_scrap') and currency in ('SCRAP_GOLD', '585_GOLD', 'FINE_GOLD')) or
    (source_till in ('manager_fine_gold') and currency in ('FINE_GOLD', '585_GOLD', 'SCRAP_GOLD')) or
    (source_till in ('manager_finished') and currency in ('FINISHED_GOODS', '585_GOLD'))
  );

alter table public.financial_transactions
  add column if not exists physical_weight_grams numeric(14, 4),
  add column if not exists gold_proba numeric(6, 2),
  add column if not exists seller_id uuid references public.employees(id) on delete set null,
  add column if not exists reclassified_from_id uuid references public.financial_transactions(id) on delete set null,
  add column if not exists reclassification_reason text,
  add column if not exists updated_at timestamptz default now();

-- 5. Immutability trigger update for audited capital reclassification
create or replace function public.trg_prevent_financial_transaction_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'ERR_FINANCIAL_TRANSACTION_IMMUTABLE: Tasdiqlangan moliyaviy operatsiya yozuvini o''chirish taqiqlanadi (ID: %)', OLD.id
      using errcode = '42501';
  end if;

  if TG_OP = 'UPDATE' then
    -- Allow transition from 'confirmed' to 'reversed' ONLY, no financial numbers can be altered
    if OLD.status = 'confirmed' and NEW.status = 'reversed'
       and NEW.id = OLD.id
       and NEW.organization_id = OLD.organization_id
       and NEW.transaction_no = OLD.transaction_no
       and NEW.transaction_date = OLD.transaction_date
       and NEW.transaction_type = OLD.transaction_type
       and NEW.source_till = OLD.source_till
       and NEW.amount_num = OLD.amount_num
       and NEW.currency = OLD.currency
       and NEW.equiv_585_grams = OLD.equiv_585_grams then
      return NEW;
    end if;

    -- Allow audited capital reclassification by Director (updating destination till and audit reason while preserving financial balance)
    if OLD.transaction_type = 'capital_contribution'
       and NEW.id = OLD.id
       and NEW.organization_id = OLD.organization_id
       and NEW.transaction_no = OLD.transaction_no
       and NEW.transaction_date = OLD.transaction_date
       and NEW.transaction_type = OLD.transaction_type
       and NEW.amount_num = OLD.amount_num
       and NEW.equiv_585_grams = OLD.equiv_585_grams
       and NEW.reclassification_reason is not null then
      return NEW;
    end if;

    raise exception 'ERR_FINANCIAL_TRANSACTION_IMMUTABLE: Tasdiqlangan moliyaviy operatsiya ko''rsatkichlarini o''zgartirish taqiqlanadi (ID: %)', OLD.id
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

-- -------------------------------------------------------------------------
-- PART 2: SELLER RESPONSIBILITY & recalc_seller_gold_account()
-- -------------------------------------------------------------------------

create or replace function public.recalc_seller_gold_account(
  p_seller_id uuid,
  p_org_id    uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_phys       numeric(14, 4);
  v_consignment_obl  numeric(14, 4);
  v_legacy_debt_obl  numeric(14, 4);
  v_total_obl        numeric(14, 4);
  v_total_stl        numeric(14, 4);
  v_s_owes           numeric(14, 4);
  v_m_owes           numeric(14, 4);
  v_signed           numeric(14, 4);
  v_total_sold       numeric(14, 4);
  v_total_ret        numeric(14, 4);
  v_cur_stock        numeric(14, 4);
begin
  if p_seller_id is null or p_org_id is null then
    return;
  end if;

  -- 1. Consignments
  select
    coalesce(sum(base_weight_grams), 0),
    coalesce(sum(coalesce(seller_obligation_g, factory_gold_due_grams)), 0)
  into v_total_phys, v_consignment_obl
  from public.seller_consignments
  where seller_id = p_seller_id and organization_id = p_org_id
    and status in ('held_by_seller', 'partially_sold', 'fully_sold');

  -- 1b. Legacy client debts assigned to this seller (unreversed)
  -- Dilrabo Apka 45g enters seller responsibility directly (no extra markup)
  select coalesce(sum(delta_585_g), 0)
  into v_legacy_debt_obl
  from public.client_legacy_debts
  where seller_id = p_seller_id and organization_id = p_org_id
    and balance_type = 'debt'
    and status <> 'reversed';

  v_total_obl := round(v_consignment_obl + v_legacy_debt_obl, 4);

  -- 2. Total non-reversed settlements to manager/factory
  select coalesce(sum(total_settled_grams), 0)
  into v_total_stl
  from public.gold_settlements
  where seller_id = p_seller_id and organization_id = p_org_id
    and direction in ('seller_to_manager', 'seller_to_factory')
    and (status is null or status not in ('reversed', 'cancelled'))
    and reversal_of_id is null;

  v_s_owes := round(greatest(0, v_total_obl - v_total_stl), 4);
  v_m_owes := round(greatest(0, v_total_stl - v_total_obl), 4);
  v_signed := round(v_m_owes - v_s_owes, 4);

  -- 3. Total sold physical grams (sales not cancelled or reversed)
  select coalesce(sum(base_weight_grams), 0)
  into v_total_sold
  from public.jewelry_sales
  where seller_id = p_seller_id and organization_id = p_org_id
    and status not in ('cancelled', 'reversed');

  -- 4. Total returned pieces/consignments
  select coalesce(sum(weight_grams), 0)
  into v_total_ret
  from public.consignment_pieces
  where seller_id = p_seller_id and organization_id = p_org_id
    and status in ('returned_to_factory', 'returned_to_manager');

  v_cur_stock := round(greatest(0, v_total_phys - v_total_sold - v_total_ret), 4);

  insert into public.seller_gold_accounts (
    seller_id, organization_id,
    total_transferred_physical_g, total_seller_obligation_g,
    total_settled_to_manager_g, seller_owes_manager_g,
    manager_owes_seller_g, bozor_qarzi_signed_g,
    total_consigned_gold_grams, current_factory_obligation_grams,
    current_physical_stock_g, seller_legacy_debt_obligation_g,
    updated_at
  ) values (
    p_seller_id, p_org_id,
    v_total_phys, v_total_obl,
    v_total_stl, v_s_owes,
    v_m_owes, v_signed,
    v_consignment_obl, v_s_owes,
    v_cur_stock, v_legacy_debt_obl,
    now()
  )
  on conflict (seller_id) do update set
    total_transferred_physical_g = v_total_phys,
    total_seller_obligation_g = v_total_obl,
    total_settled_to_manager_g = v_total_stl,
    seller_owes_manager_g = v_s_owes,
    manager_owes_seller_g = v_m_owes,
    bozor_qarzi_signed_g = v_signed,
    total_consigned_gold_grams = v_consignment_obl,
    current_factory_obligation_grams = v_s_owes,
    current_physical_stock_g = v_cur_stock,
    seller_legacy_debt_obligation_g = v_legacy_debt_obl,
    updated_at = now();
end;
$$;

grant execute on function public.recalc_seller_gold_account(uuid, uuid) to authenticated, service_role;

create or replace function public.fn_sync_seller_gold_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller_id uuid := coalesce(NEW.seller_id, OLD.seller_id);
  v_org_id    uuid := coalesce(NEW.organization_id, OLD.organization_id);
begin
  if v_seller_id is not null and v_org_id is not null then
    perform public.recalc_seller_gold_account(v_seller_id, v_org_id);
  end if;
  return coalesce(NEW, OLD);
end;
$$;

-- Trigger on client_legacy_debts to immediately re-sync seller responsibility
drop trigger if exists trg_sync_seller_gold_account_legacy_debt on public.client_legacy_debts;
create trigger trg_sync_seller_gold_account_legacy_debt
  after insert or update or delete on public.client_legacy_debts
  for each row execute function public.fn_sync_seller_gold_account();

-- Re-sync all existing sellers immediately
do $$
declare
  r record;
begin
  for r in select distinct seller_id, organization_id from public.seller_gold_accounts loop
    perform public.recalc_seller_gold_account(r.seller_id, r.organization_id);
  end loop;
end $$;

-- Enhanced rpc_record_client_legacy_debt supporting explicit seller_id
drop function if exists public.rpc_record_client_legacy_debt(uuid, text, numeric, date, text, text, numeric, text);
drop function if exists public.rpc_record_client_legacy_debt(uuid, text, numeric, date, text, text, numeric, text, uuid);

create or replace function public.rpc_record_client_legacy_debt(
  p_customer_id          uuid,
  p_balance_type         text, -- 'debt' yoki 'advance'
  p_amount_585_g         numeric,
  p_as_of_date           date,
  p_notes                text default null,
  p_entry_type           text default 'initial', -- 'initial', 'reconciliation_adjustment', 'manual_addition'
  p_target_final_balance numeric default null, -- if provided in reconciliation mode
  p_idempotency_key      text default null,
  p_seller_id            uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org           uuid := public.current_organization_id();
  v_caller_emp_id        uuid := public.current_employee_id();
  v_customer             public.customers%rowtype;
  v_seller_id            uuid;
  v_client_acc           public.client_gold_accounts%rowtype;
  v_cur_debt             numeric(14, 4) := 0;
  v_cur_adv              numeric(14, 4) := 0;
  v_target               numeric(14, 4);
  v_delta                numeric(14, 4) := 0;
  v_new_debt             numeric(14, 4) := 0;
  v_new_adv              numeric(14, 4) := 0;
  v_amt                  numeric(14, 4);
  v_entry_type           text := coalesce(nullif(btrim(p_entry_type), ''), 'initial');
  v_bal_type             text := coalesce(nullif(btrim(p_balance_type), ''), 'debt');
  v_legacy_id            uuid;
  v_payload              jsonb;
  v_existing             jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter'
  ]);

  if p_customer_id is null then
    raise exception 'Mijoz tanlanishi shart';
  end if;

  if p_as_of_date is null then
    raise exception 'Qarz qaysi sanadagi holat ekani ko''rsatilishi shart';
  end if;

  if v_bal_type not in ('debt', 'advance') then
    raise exception 'Qoldiq turi faqat "debt" (qarz) yoki "advance" (avans) bo''lishi mumkin';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Mijoz topilmadi: %', p_customer_id;
  end if;

  v_seller_id := coalesce(p_seller_id, v_customer.seller_id);

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    v_payload := jsonb_build_object(
      'action', 'record_client_legacy_debt',
      'customer_id', p_customer_id,
      'balance_type', v_bal_type,
      'amount_585_g', p_amount_585_g,
      'target_balance', p_target_final_balance,
      'as_of_date', p_as_of_date
    );

    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_legacy_debt', v_payload);
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = p_customer_id and organization_id = v_caller_org
  for update;

  if found then
    v_cur_debt := coalesce(v_client_acc.current_debt_grams, 0);
    v_cur_adv  := coalesce(v_client_acc.advance_balance_grams, 0);
  end if;

  if p_target_final_balance is not null then
    v_target := round(greatest(0, p_target_final_balance)::numeric, 4);

    if v_bal_type = 'debt' then
      v_new_debt := v_target;
      v_new_adv  := 0;
      v_delta    := round(v_new_debt - (v_cur_debt - v_cur_adv), 4);
    else
      v_new_debt := 0;
      v_new_adv  := v_target;
      v_delta    := round((-v_new_adv) - (v_cur_debt - v_cur_adv), 4);
    end if;

    v_amt := abs(v_delta);
    if abs(v_delta) < 0.0001 then
      return jsonb_build_object(
        'status', 'ok',
        'no_change_needed', true,
        'current_debt_585_g', v_cur_debt,
        'current_advance_585_g', v_cur_adv,
        'target_balance', v_target,
        'delta_585_g', 0
      );
    end if;

  else
    v_amt := round(greatest(0, coalesce(p_amount_585_g, 0))::numeric, 4);
    if v_amt <= 0 then
      raise exception 'Qarz yoki avans miqdori 0 dan katta bo''lishi shart';
    end if;

    if v_bal_type = 'debt' then
      v_delta := v_amt;
      if v_cur_adv > 0 then
        if v_cur_adv >= v_amt then
          v_new_adv  := round(v_cur_adv - v_amt, 4);
          v_new_debt := v_cur_debt;
        else
          v_new_debt := round(v_cur_debt + (v_amt - v_cur_adv), 4);
          v_new_adv  := 0;
        end if;
      else
        v_new_debt := round(v_cur_debt + v_amt, 4);
        v_new_adv  := 0;
      end if;
    else
      v_delta := -v_amt;
      if v_cur_debt > 0 then
        if v_cur_debt >= v_amt then
          v_new_debt := round(v_cur_debt - v_amt, 4);
          v_new_adv  := v_cur_adv;
        else
          v_new_adv  := round(v_cur_adv + (v_amt - v_cur_debt), 4);
          v_new_debt := 0;
        end if;
      else
        v_new_adv  := round(v_cur_adv + v_amt, 4);
        v_new_debt := 0;
      end if;
    end if;
  end if;

  insert into public.client_legacy_debts (
    organization_id, customer_id, seller_id, balance_type,
    amount_585_g, previous_debt_585_g, previous_advance_585_g, delta_585_g,
    new_debt_585_g, new_advance_585_g, as_of_date, notes,
    entry_type, status, created_by
  ) values (
    v_caller_org, p_customer_id, v_seller_id, v_bal_type,
    v_amt, v_cur_debt, v_cur_adv, v_delta,
    v_new_debt, v_new_adv, p_as_of_date, p_notes,
    v_entry_type, 'confirmed', v_caller_emp_id
  ) returning id into v_legacy_id;

  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id,
    total_purchased_gold_grams, total_scrap_paid_grams,
    total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    p_customer_id, v_caller_org, v_seller_id,
    0, 0, 0, 0, 0,
    v_new_debt, v_new_adv, now()
  )
  on conflict (customer_id) do update set
    seller_id = coalesce(client_gold_accounts.seller_id, excluded.seller_id),
    current_debt_grams = v_new_debt,
    advance_balance_grams = v_new_adv,
    updated_at = now();

  if v_seller_id is not null then
    perform public.recalc_seller_gold_account(v_seller_id, v_caller_org);
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'legacy_debt_id', v_legacy_id,
    'customer_id', p_customer_id,
    'seller_id', v_seller_id,
    'balance_type', v_bal_type,
    'delta_585_g', v_delta,
    'previous_debt_585_g', v_cur_debt,
    'previous_advance_585_g', v_cur_adv,
    'new_debt_585_g', v_new_debt,
    'new_advance_585_g', v_new_adv,
    'as_of_date', p_as_of_date
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_legacy_debt', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_record_client_legacy_debt(uuid, text, numeric, date, text, text, numeric, text, uuid) to authenticated;

-- -------------------------------------------------------------------------
-- PART 3: MULTI-ASSET CAPITAL CONTRIBUTIONS
-- -------------------------------------------------------------------------

drop function if exists public.rpc_record_financial_transaction(text, text, numeric, text, text, text, numeric, numeric, text);
drop function if exists public.rpc_record_financial_transaction(text, text, numeric, text, text, text, numeric, numeric, text, numeric, numeric, uuid, uuid, text, integer);

create or replace function public.rpc_record_financial_transaction(
  p_transaction_type  text,
  p_source_till       text,
  p_amount            numeric,
  p_currency          text,
  p_category          text default null,
  p_notes             text default null,
  p_gold_rate         numeric default null,
  p_usd_rate          numeric default null,
  p_idempotency_key   text default null,
  p_physical_weight_g numeric default null,
  p_gold_proba        numeric default null,
  p_seller_id         uuid default null,
  p_model_id          uuid default null,
  p_product_name      text default null,
  p_quantity          integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id          uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_today           date := (timezone('Asia/Tashkent', now()))::date;
  v_tx_id           uuid;
  v_tx_no           text;
  v_amt             numeric(18, 4);
  v_cur             text := upper(btrim(p_currency));
  v_type            text := lower(btrim(p_transaction_type));
  v_till            text := lower(btrim(p_source_till));
  v_rate_585        numeric(18, 2);
  v_rate_usd        numeric(18, 2);
  v_equiv_585       numeric(14, 4);
  v_fine_g          numeric(14, 4);
  v_phys_w          numeric(14, 4);
  v_proba           numeric(6, 2);
  v_vault           public.manager_vault_account%rowtype;
  v_existing        jsonb;
  v_payload         jsonb;
  v_rec_no          text;
  v_receipt_id      uuid;
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

  v_amt := round(greatest(0, coalesce(p_amount, 0))::numeric, 4);
  if v_amt <= 0 and coalesce(p_physical_weight_g, 0) <= 0 then
    raise exception 'ERR_ZERO_AMOUNT: Operatsiya summasi yoki miqdori 0 dan katta bo''lishi shart';
  end if;

  -- 1. Rates resolution strictly for today in Asia/Tashkent
  if p_gold_rate is not null and p_gold_rate > 0 then
    v_rate_585 := round(p_gold_rate::numeric, 2);
  else
    select rate_per_gram into v_rate_585
      from public.daily_gold_rates
     where organization_id = v_org_id
       and proba = 585
       and rate_date = v_today
       and is_confirmed = true
     order by created_at desc
     limit 1;
  end if;

  if v_cur = 'USD' or v_till in ('manager_usd', 'seller_till_usd') then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_rate_usd := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) operatsiyasini hisoblash uchun USD kursi kiritilishi shart!'
        using errcode = '22023';
    end if;
  else
    v_rate_usd := null;
  end if;

  -- 2. Physical & Proba Resolution
  v_phys_w := round(greatest(0, coalesce(p_physical_weight_g, v_amt))::numeric, 4);

  -- 3. Calculate 585 gold equivalent and fine gold
  if v_till in ('manager_uzs', 'seller_till_uzs') or v_cur = 'UZS' then
    if v_rate_585 is null or v_rate_585 <= 0 then
      raise exception 'ERR_DAILY_RATE_NOT_SET: Bugungi (% sanadagi) 585 oltin kursi tasdiqlanmagan', v_today
        using errcode = '22023';
    end if;
    v_equiv_585 := round((v_amt / v_rate_585)::numeric, 4);
    v_fine_g := round((v_equiv_585 * 0.585)::numeric, 4);

  elsif v_till in ('manager_usd', 'seller_till_usd') or v_cur = 'USD' then
    if v_rate_585 is null or v_rate_585 <= 0 then
      raise exception 'ERR_DAILY_RATE_NOT_SET: Bugungi (% sanadagi) 585 oltin kursi tasdiqlanmagan', v_today
        using errcode = '22023';
    end if;
    v_equiv_585 := round(((v_amt * v_rate_usd) / v_rate_585)::numeric, 4);
    v_fine_g := round((v_equiv_585 * 0.585)::numeric, 4);

  elsif v_till in ('manager_scrap', 'seller_till_scrap') or v_cur = 'SCRAP_GOLD' then
    v_proba := coalesce(p_gold_proba, 585.0);
    v_equiv_585 := round((v_phys_w * (v_proba / 585.0))::numeric, 4);
    v_fine_g := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);

  elsif v_till in ('manager_fine_gold', 'fine_gold') or v_cur = 'FINE_GOLD' then
    v_proba := coalesce(p_gold_proba, 995.0);
    v_equiv_585 := round((v_phys_w * (v_proba / 585.0))::numeric, 4);
    v_fine_g := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);

  elsif v_till in ('manager_finished', 'finished_goods') or v_cur = 'FINISHED_GOODS' then
    v_proba := coalesce(p_gold_proba, 585.0);
    v_equiv_585 := round((v_phys_w * (v_proba / 585.0))::numeric, 4);
    v_fine_g := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);

  elsif v_till = 'manager_vault_gold' or v_cur = '585_GOLD' then
    v_equiv_585 := v_amt;
    v_fine_g := round((v_amt * 0.585)::numeric, 4);
    v_phys_w := v_amt;
    v_proba := 585.0;
  else
    raise exception 'ERR_INVALID_TILL: Noma''lum kassa/manba tanlandi: %', v_till;
  end if;

  -- 4. Idempotency Check
  v_payload := jsonb_build_object(
    'action', 'record_financial_transaction',
    'type', v_type,
    'source_till', v_till,
    'amount', v_amt,
    'currency', v_cur,
    'physical_w', v_phys_w
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_financial_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Lock manager vault
  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  -- 5. Apply balance changes
  if v_type = 'capital_contribution' then
    if v_till in ('manager_uzs', 'cash_uzs') then
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount + v_amt, 2), updated_at = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_usd', 'cash_usd') then
      update public.manager_vault_account
         set manager_usd_amount = round(coalesce(manager_usd_amount, 0) + v_amt, 2), updated_at = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_scrap', 'scrap_gold') then
      update public.manager_vault_account
         set manager_scrap_physical_g = round(manager_scrap_physical_g + v_phys_w, 4),
             manager_scrap_585_eq_g = round(manager_scrap_585_eq_g + v_equiv_585, 4),
             manager_scrap_grams = round(manager_scrap_grams + v_equiv_585, 4),
             updated_at = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_fine_gold', 'fine_gold') then
      -- Pure bullion capital enters manager_capital_pure_gold_g (distinct from affinaj output)
      update public.manager_vault_account
         set manager_capital_pure_gold_g = round(manager_capital_pure_gold_g + v_equiv_585, 4),
             manager_capital_pure_gold_fine_g = round(coalesce(manager_capital_pure_gold_fine_g, 0) + v_fine_g, 4),
             updated_at = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_finished', 'finished_goods') then
      -- Finished goods capital: zero factory debt, immediately consignable
      v_rec_no := 'CAP-REC-' || to_char(v_today, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

      insert into public.factory_receipts (
        organization_id, receipt_no, receipt_date, model_id,
        product_name, proba, quantity, original_physical_g,
        factory_markup_pct, factory_obligation_g, transferred_physical_g,
        available_physical_g, status, notes
      ) values (
        v_org_id, v_rec_no, v_today, p_model_id,
        coalesce(p_product_name, 'Kapital Tayyor Mahsulot'), coalesce(v_proba, 585.0),
        coalesce(p_quantity, 1), v_phys_w,
        0, 0, 0,
        v_phys_w, 'in_manager_stock',
        coalesce(p_notes, 'Ta''sischi kapitali sifatida kiritilgan tayyor mahsulot')
      ) returning id into v_receipt_id;

      -- manager_physical_stock_g is synced automatically by trg_sync_manager_vault_receipts
      update public.manager_vault_account
         set manager_finished_capital_g = round(manager_finished_capital_g + v_phys_w, 4),
             updated_at = now()
       where organization_id = v_org_id;

    elsif v_till = 'seller_till_uzs' then
      if p_seller_id is null then
        raise exception 'ERR_SELLER_REQUIRED: Sotuvchi kassasiga kapital kiritish uchun sotuvchini tanlang';
      end if;
      update public.seller_gold_accounts
         set seller_till_cash_amount = round(seller_till_cash_amount + v_amt, 2), updated_at = now()
       where seller_id = p_seller_id and organization_id = v_org_id;

    elsif v_till = 'seller_till_usd' then
      if p_seller_id is null then
        raise exception 'ERR_SELLER_REQUIRED: Sotuvchi kassasiga kapital kiritish uchun sotuvchini tanlang';
      end if;
      update public.seller_gold_accounts
         set seller_till_usd_amount = round(coalesce(seller_till_usd_amount, 0) + v_amt, 2), updated_at = now()
       where seller_id = p_seller_id and organization_id = v_org_id;

    elsif v_till = 'seller_till_scrap' then
      if p_seller_id is null then
        raise exception 'ERR_SELLER_REQUIRED: Sotuvchi kassasiga kapital kiritish uchun sotuvchini tanlang';
      end if;
      update public.seller_gold_accounts
         set seller_till_scrap_physical_g = round(seller_till_scrap_physical_g + v_phys_w, 4),
             seller_till_scrap_585_eq_g = round(seller_till_scrap_585_eq_g + v_equiv_585, 4),
             seller_till_scrap_grams = round(seller_till_scrap_grams + v_equiv_585, 4),
             updated_at = now()
       where seller_id = p_seller_id and organization_id = v_org_id;

    elsif v_till = 'manager_vault_gold' then
      -- Legacy compatibility
      update public.manager_vault_account
         set manager_refined_gold_grams = round(manager_refined_gold_grams + v_equiv_585, 4),
             manager_refined_gold_fine_grams = round(coalesce(manager_refined_gold_fine_grams, 0) + v_fine_g, 4),
             updated_at = now()
       where organization_id = v_org_id;
    end if;

  elsif v_type in ('capital_distribution', 'business_expense') then
    if v_till in ('manager_uzs', 'cash_uzs') then
      if v_vault.manager_cash_amount < v_amt then
        raise exception 'ERR_INSUFFICIENT_VAULT_CASH: Seyfda yetarli naqd pul (UZS) mavjud emas (Mavjud: % UZS, Talab: % UZS)',
          v_vault.manager_cash_amount, v_amt;
      end if;
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount - v_amt, 2), updated_at = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_usd', 'cash_usd') then
      if coalesce(v_vault.manager_usd_amount, 0) < v_amt then
        raise exception 'ERR_INSUFFICIENT_VAULT_USD: Seyfda yetarli dollar (USD) mavjud emas (Mavjud: % USD, Talab: % USD)',
          coalesce(v_vault.manager_usd_amount, 0), v_amt;
      end if;
      update public.manager_vault_account
         set manager_usd_amount = round(coalesce(manager_usd_amount, 0) - v_amt, 2), updated_at = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_fine_gold', 'fine_gold') then
      if v_vault.manager_capital_pure_gold_g < v_equiv_585 then
        raise exception 'ERR_INSUFFICIENT_GOLD: Seyfda yetarli kapital toza oltin yo''q';
      end if;
      update public.manager_vault_account
         set manager_capital_pure_gold_g = round(manager_capital_pure_gold_g - v_equiv_585, 4),
             manager_capital_pure_gold_fine_g = round(greatest(0, coalesce(manager_capital_pure_gold_fine_g, 0) - v_fine_g), 4),
             updated_at = now()
       where organization_id = v_org_id;

    elsif v_till = 'manager_vault_gold' then
      if v_vault.manager_refined_gold_grams >= v_equiv_585 then
        update public.manager_vault_account
           set manager_refined_gold_grams = round(manager_refined_gold_grams - v_equiv_585, 4),
               manager_refined_gold_fine_grams = round(greatest(0, coalesce(manager_refined_gold_fine_grams, 0) - v_fine_g), 4),
               updated_at = now()
         where organization_id = v_org_id;
      else
        raise exception 'ERR_INSUFFICIENT_VAULT_GOLD: Seyfda yetarli sof oltin mavjud emas (Mavjud: % g, Talab: % g)',
          v_vault.manager_refined_gold_grams, v_equiv_585;
      end if;
    end if;
  end if;

  v_tx_no := 'FTX-' || to_char(v_today, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.financial_transactions (
    organization_id, transaction_no, transaction_date, transaction_type,
    source_till, amount_num, currency, gold_rate_applied, usd_rate_applied,
    equiv_585_grams, physical_weight_grams, gold_proba, seller_id,
    category, notes, recorded_by, idempotency_key
  ) values (
    v_org_id, v_tx_no, v_today, v_type,
    v_till, v_amt, v_cur, v_rate_585, v_rate_usd,
    v_equiv_585, v_phys_w, v_proba, p_seller_id,
    p_category, p_notes, v_caller_emp_id, p_idempotency_key
  ) returning id into v_tx_id;

  select * into v_vault from public.manager_vault_account where organization_id = v_org_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'transaction_id', v_tx_id,
    'transaction_no', v_tx_no,
    'transaction_type', v_type,
    'source_till', v_till,
    'amount', v_amt,
    'currency', v_cur,
    'physical_weight_g', v_phys_w,
    'gold_rate_applied', v_rate_585,
    'usd_rate_applied', v_rate_usd,
    'equiv_585_grams', v_equiv_585,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount,
    'manager_scrap_585_eq_g', v_vault.manager_scrap_585_eq_g,
    'manager_capital_pure_gold_g', v_vault.manager_capital_pure_gold_g,
    'manager_physical_stock_g', v_vault.manager_physical_stock_g
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_financial_transaction', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_record_financial_transaction(text, text, numeric, text, text, text, numeric, numeric, text, numeric, numeric, uuid, uuid, text, integer) to authenticated;

-- -------------------------------------------------------------------------
-- PART 4: AUDITED CAPITAL RECLASSIFICATION
-- -------------------------------------------------------------------------

create or replace function public.rpc_reclassify_capital_transaction(
  p_transaction_id    uuid,
  p_new_destination   text,
  p_reason            text,
  p_new_proba         numeric default null,
  p_seller_id         uuid default null,
  p_model_id          uuid default null,
  p_product_name      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id          uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_tx              public.financial_transactions%rowtype;
  v_today           date := (timezone('Asia/Tashkent', now()))::date;
  v_dest            text := lower(btrim(p_new_destination));
  v_equiv_585       numeric(14, 4);
  v_fine_g          numeric(14, 4);
  v_phys_w          numeric(14, 4);
  v_proba           numeric(6, 2);
  v_rec_no          text;
  v_receipt_id      uuid;
  v_vault           public.manager_vault_account%rowtype;
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

  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'ERR_REASON_REQUIRED: Qayta tasniflash sababini kiritish shart' using errcode = '22023';
  end if;

  select * into v_tx
    from public.financial_transactions
   where id = p_transaction_id and organization_id = v_org_id
     for update;

  if not found then
    raise exception 'Operatsiya topilmadi (%)', p_transaction_id;
  end if;

  if v_tx.status = 'reversed' then
    raise exception 'Bekor qilingan operatsiyani qayta tasniflab bo''lmaydi';
  end if;

  if v_tx.transaction_type not in ('capital_contribution', 'capital_in') then
    raise exception 'Faqat ta''sischi kapital operatsiyalarini qayta tasniflash mumkin';
  end if;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  v_equiv_585 := v_tx.equiv_585_grams;

  -- 1. Reverse old allocation
  if v_tx.source_till = 'manager_vault_gold' then
    if v_vault.manager_refined_gold_grams < v_equiv_585 then
      raise exception 'Seyfda yetarli afinaj oltin mavjud emas qaytarish uchun';
    end if;
    update public.manager_vault_account
       set manager_refined_gold_grams = round(manager_refined_gold_grams - v_equiv_585, 4),
           manager_refined_gold_fine_grams = round(greatest(0, coalesce(manager_refined_gold_fine_grams, 0) - (v_equiv_585 * 0.585)), 4),
           updated_at = now()
     where organization_id = v_org_id;

  elsif v_tx.source_till in ('manager_scrap', 'scrap_gold') then
    update public.manager_vault_account
       set manager_scrap_585_eq_g = round(greatest(0, manager_scrap_585_eq_g - v_equiv_585), 4),
           manager_scrap_grams = round(greatest(0, manager_scrap_grams - v_equiv_585), 4),
           manager_scrap_physical_g = round(greatest(0, manager_scrap_physical_g - coalesce(v_tx.physical_weight_grams, v_equiv_585)), 4),
           updated_at = now()
     where organization_id = v_org_id;

  elsif v_tx.source_till in ('manager_fine_gold', 'fine_gold') then
    update public.manager_vault_account
       set manager_capital_pure_gold_g = round(greatest(0, manager_capital_pure_gold_g - v_equiv_585), 4),
           manager_capital_pure_gold_fine_g = round(greatest(0, coalesce(manager_capital_pure_gold_fine_g, 0) - (v_equiv_585 * 0.585)), 4),
           updated_at = now()
     where organization_id = v_org_id;

  elsif v_tx.source_till in ('manager_uzs', 'cash_uzs') then
    update public.manager_vault_account
       set manager_cash_amount = round(greatest(0, manager_cash_amount - v_tx.amount_num), 2),
           updated_at = now()
     where organization_id = v_org_id;

  elsif v_tx.source_till in ('manager_usd', 'cash_usd') then
    update public.manager_vault_account
       set manager_usd_amount = round(greatest(0, coalesce(manager_usd_amount, 0) - v_tx.amount_num), 2),
           updated_at = now()
     where organization_id = v_org_id;
  end if;

  -- 2. Apply new allocation
  if v_dest in ('manager_scrap', 'scrap_gold') then
    v_proba := coalesce(p_new_proba, 585.0);
    v_phys_w := round((v_equiv_585 * (585.0 / v_proba))::numeric, 4);

    update public.manager_vault_account
       set manager_scrap_physical_g = round(manager_scrap_physical_g + v_phys_w, 4),
           manager_scrap_585_eq_g = round(manager_scrap_585_eq_g + v_equiv_585, 4),
           manager_scrap_grams = round(manager_scrap_grams + v_equiv_585, 4),
           updated_at = now()
     where organization_id = v_org_id;

  elsif v_dest in ('manager_fine_gold', 'fine_gold') then
    v_proba := coalesce(p_new_proba, 995.0);
    v_phys_w := round((v_equiv_585 * (585.0 / v_proba))::numeric, 4);
    v_fine_g := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);

    update public.manager_vault_account
       set manager_capital_pure_gold_g = round(manager_capital_pure_gold_g + v_equiv_585, 4),
           manager_capital_pure_gold_fine_g = round(coalesce(manager_capital_pure_gold_fine_g, 0) + v_fine_g, 4),
           updated_at = now()
     where organization_id = v_org_id;

  elsif v_dest in ('manager_finished', 'finished_goods') then
    v_phys_w := v_equiv_585;
    v_proba := 585.0;
    v_rec_no := 'CAP-REC-' || to_char(v_today, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

    insert into public.factory_receipts (
      organization_id, receipt_no, receipt_date, model_id,
      product_name, proba, quantity, original_physical_g,
      factory_markup_pct, factory_obligation_g, transferred_physical_g,
      available_physical_g, status, notes
    ) values (
      v_org_id, v_rec_no, v_today, p_model_id,
      coalesce(p_product_name, 'Kapital Tayyor Mahsulot'), v_proba,
      1, v_phys_w,
      0, 0, 0,
      v_phys_w, 'in_manager_stock',
      'Audit tahrirlash: ' || p_reason
    ) returning id into v_receipt_id;

    -- manager_physical_stock_g is synced automatically by trg_sync_manager_vault_receipts
    update public.manager_vault_account
       set manager_finished_capital_g = round(manager_finished_capital_g + v_phys_w, 4),
           updated_at = now()
     where organization_id = v_org_id;

  elsif v_dest in ('manager_uzs', 'cash_uzs') then
    update public.manager_vault_account
       set manager_cash_amount = round(manager_cash_amount + (v_equiv_585 * v_tx.gold_rate_applied), 2),
           updated_at = now()
     where organization_id = v_org_id;

  elsif v_dest in ('manager_usd', 'cash_usd') then
    if coalesce(v_tx.usd_rate_applied, 0) <= 0 then
      raise exception 'USD kursi mavjud emas qayta tasniflash uchun';
    end if;
    update public.manager_vault_account
       set manager_usd_amount = round(coalesce(manager_usd_amount, 0) + ((v_equiv_585 * v_tx.gold_rate_applied) / v_tx.usd_rate_applied), 2),
           updated_at = now()
     where organization_id = v_org_id;

  else
    raise exception 'ERR_INVALID_DESTINATION: Noma''lum qayta tasniflash joylashuvi: %', v_dest;
  end if;

  -- 3. Update transaction record
  update public.financial_transactions
     set source_till = v_dest,
         currency = case
           when v_dest in ('manager_scrap', 'seller_till_scrap') then 'SCRAP_GOLD'
           when v_dest in ('manager_fine_gold') then 'FINE_GOLD'
           when v_dest in ('manager_finished') then 'FINISHED_GOODS'
           when v_dest in ('manager_uzs', 'seller_till_uzs') then 'UZS'
           when v_dest in ('manager_usd', 'seller_till_usd') then 'USD'
           else currency
         end,
         gold_proba = coalesce(p_new_proba, gold_proba),
         reclassification_reason = p_reason,
         notes = coalesce(notes, '') || ' [Audit Reclassified to ' || v_dest || ': ' || p_reason || ']',
         updated_at = now()
   where id = p_transaction_id;

  -- 4. Audit Log
  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (
      organization_id, table_name, record_id, action,
      actor_id, old_data, new_data, reason
    ) values (
      v_org_id, 'financial_transactions', p_transaction_id::text, 'RECLASSIFY_CAPITAL',
      auth.uid(),
      jsonb_build_object('old_source_till', v_tx.source_till, 'equiv_585_g', v_tx.equiv_585_grams),
      jsonb_build_object('new_source_till', v_dest, 'reason', p_reason, 'equiv_585_g', v_equiv_585),
      p_reason
    );
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'transaction_id', p_transaction_id,
    'old_source_till', v_tx.source_till,
    'new_source_till', v_dest,
    'equiv_585_grams', v_equiv_585,
    'reason', p_reason
  );
end;
$$;

grant execute on function public.rpc_reclassify_capital_transaction to authenticated;

-- -------------------------------------------------------------------------
-- PART 5: REFINING & PATERIYA MASS BALANCE
-- -------------------------------------------------------------------------

create or replace function public.rpc_record_refining_batch(
  p_input_scrap_grams   numeric,
  p_melted_weight_grams numeric,
  p_output_fine_grams   numeric,
  p_output_fine_proba   numeric default 995.0,
  p_operator_id         uuid default null,
  p_notes               text default null,
  p_idempotency_key     text default null,
  p_physical_scrap_grams numeric default null,
  p_input_scrap_proba   numeric default 585.0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id          uuid := public.current_organization_id();
  v_emp_id          uuid := coalesce(p_operator_id, public.current_employee_id());
  v_vault           public.manager_vault_account%rowtype;
  v_batch_id        uuid;
  v_batch_no        text;
  v_in_w            numeric(14, 4);
  v_in_proba        numeric(6, 2);
  v_in_585_eq       numeric(14, 4);
  v_melt_w          numeric(14, 4);
  v_out_fine_g      numeric(14, 4);
  v_out_proba       numeric(6, 2);
  v_out_585_eq      numeric(14, 4);
  v_loss_g          numeric(14, 4);
  v_loss_pct        numeric(6, 3);
  v_existing        jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'batch_id', id,
      'batch_no', batch_no,
      'total_loss_grams', total_loss_grams
    ) into v_existing
    from public.refining_batches
    where idempotency_key = p_idempotency_key and organization_id = v_org_id;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_in_w       := round(coalesce(p_input_scrap_grams, 0)::numeric, 4);
  v_in_proba   := round(coalesce(p_input_scrap_proba, 585.0)::numeric, 2);
  v_melt_w     := round(coalesce(p_melted_weight_grams, 0)::numeric, 4);
  v_out_fine_g := round(coalesce(p_output_fine_grams, 0)::numeric, 4);
  v_out_proba  := round(coalesce(p_output_fine_proba, 995.0)::numeric, 2);

  if v_in_w <= 0 or v_melt_w <= 0 or v_out_fine_g <= 0 then
    raise exception 'Invalid refining inputs: input scrap, melted weight and output fine gold must be > 0';
  end if;

  if v_melt_w > v_in_w then
    raise exception 'Physical anomaly: melted weight cannot exceed input scrap weight';
  end if;

  -- 585 Equivalent Mass Balance:
  v_in_585_eq  := round((v_in_w * (v_in_proba / 585.0))::numeric, 4);
  v_out_585_eq := round((v_out_fine_g * (v_out_proba / 585.0))::numeric, 4);
  v_loss_g     := round((v_in_585_eq - v_out_585_eq)::numeric, 4);

  if v_loss_g < 0 then
    raise exception 'Anomalous refining result: Chiqqan oltin (% g 585 ekv) kirgan lomdan (% g 585 ekv) ko''p bo''lishi mumkin emas. Probalar va vaznlarni tekshiring!',
      v_out_585_eq, v_in_585_eq using errcode = '22023';
  end if;

  v_loss_pct := round(((v_loss_g / v_in_585_eq) * 100.0), 3);

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  if v_vault.manager_scrap_grams < v_in_585_eq then
    raise exception 'Yetarli lom oltin yo''q: mavjud % g (585 ekv), talab qilindi % g',
      v_vault.manager_scrap_grams, v_in_585_eq;
  end if;

  -- Deduct scrap, add refined fine gold and 585 equivalent. Loss is borne exclusively by manager!
  update public.manager_vault_account
  set manager_scrap_grams = round(manager_scrap_grams - v_in_585_eq, 4),
      manager_scrap_585_eq_g = round(greatest(0, coalesce(manager_scrap_585_eq_g, 0) - v_in_585_eq), 4),
      manager_scrap_physical_g = round(greatest(0, coalesce(manager_scrap_physical_g, 0) - coalesce(p_physical_scrap_grams, v_in_w)), 4),
      manager_refined_gold_grams = round(manager_refined_gold_grams + v_out_585_eq, 4),
      manager_refined_gold_fine_grams = round(coalesce(manager_refined_gold_fine_grams, 0) + v_out_fine_g, 4),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  v_batch_no := 'REF-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.refining_batches (
    organization_id, batch_no, input_scrap_grams, input_scrap_proba,
    input_585_equiv_grams, melted_weight_grams,
    output_fine_grams, output_fine_proba, output_585_equiv_grams,
    total_loss_grams, loss_pct, operator_id, status, notes, idempotency_key
  ) values (
    v_org_id, v_batch_no, v_in_w, v_in_proba,
    v_in_585_eq, v_melt_w,
    v_out_fine_g, v_out_proba, v_out_585_eq,
    v_loss_g, v_loss_pct, v_emp_id, 'completed', p_notes, p_idempotency_key
  ) returning id into v_batch_id;

  return jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch_id,
    'batch_no', v_batch_no,
    'input_scrap_grams', v_in_w,
    'input_scrap_proba', v_in_proba,
    'input_585_equiv_grams', v_in_585_eq,
    'output_fine_grams', v_out_fine_g,
    'output_fine_proba', v_out_proba,
    'output_585_equiv_grams', v_out_585_eq,
    'total_loss_grams', v_loss_g,
    'loss_pct', v_loss_pct,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_refined_gold_585_equiv_grams', v_vault.manager_refined_gold_grams,
    'manager_refined_gold_fine_grams', v_vault.manager_refined_gold_fine_grams
  );
end;
$$;

grant execute on function public.rpc_record_refining_batch(numeric, numeric, numeric, numeric, uuid, text, text, numeric, numeric) to authenticated;

-- -------------------------------------------------------------------------
-- PART 6: BASELINE & PROFIT SUMMARY PARITY
-- -------------------------------------------------------------------------

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
  v_today                date := (timezone('Asia/Tashkent', now()))::date;
  v_rate_585             numeric(18, 2);
  v_rate_usd             numeric(18, 2);
  v_mgr_finished_g       numeric(14, 4) := 0;
  v_seller_finished_g    numeric(14, 4) := 0;
  v_mgr_scrap_585_eq_g   numeric(14, 4) := 0;
  v_seller_scrap_585_eq_g numeric(14, 4) := 0;
  v_mgr_refined_g        numeric(14, 4) := 0;
  v_mgr_capital_pure_g   numeric(14, 4) := 0;
  v_mgr_purchased_g      numeric(14, 4) := 0;
  v_refining_wip_g       numeric(14, 4) := 0;
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
  v_factory_rcp_g        numeric(14, 4) := 0;
  v_factory_hnd_g        numeric(14, 4) := 0;
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

  -- 1. Rates resolution strictly for today in Asia/Tashkent
  select rate_per_gram into v_rate_585
    from public.daily_gold_rates
   where organization_id = v_org_id
     and proba = 585
     and rate_date = v_today
     and is_confirmed = true
   order by created_at desc
   limit 1;

  if v_rate_585 is null or v_rate_585 <= 0 then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Boshlang''ich hisobni tasdiqlash uchun bugungi (% sanadagi) tasdiqlangan 585 oltin kursi kiritilishi shart', v_today
      using errcode = '22023';
  end if;

  v_payload := jsonb_build_object('action', 'confirm_accounting_baseline', 'org_id', v_org_id);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_confirm_accounting_baseline', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 2. Manager stock & vault
  perform public._get_or_create_manager_vault(v_org_id);
  select coalesce(sum(available_physical_g), 0) into v_mgr_finished_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(manager_scrap_585_eq_g, manager_scrap_grams, 0),
         coalesce(manager_refined_gold_grams, 0),
         coalesce(manager_capital_pure_gold_g, 0),
         coalesce(manager_purchased_gold_grams, 0),
         coalesce(manager_cash_amount, 0),
         coalesce(manager_usd_amount, 0)
    into v_mgr_scrap_585_eq_g, v_mgr_refined_g, v_mgr_capital_pure_g, v_mgr_purchased_g, v_mgr_cash_uzs, v_mgr_cash_usd
    from public.manager_vault_account
   where organization_id = v_org_id;

  -- 3. Refining WIP (In-progress refining batches counted once as asset)
  select coalesce(sum(coalesce(input_585_equiv_grams, input_scrap_grams * (coalesce(input_scrap_proba, 585.0) / 585.0))), 0)
    into v_refining_wip_g
    from public.refining_batches
   where organization_id = v_org_id and status in ('pending', 'in_progress');

  -- 4. Sellers stock and tills
  select coalesce(sum(public.get_seller_available_stock_grams(seller_id)), 0),
         coalesce(sum(coalesce(seller_till_scrap_585_eq_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(seller_till_cash_amount), 0),
         coalesce(sum(coalesce(seller_till_usd_amount, 0)), 0)
    into v_seller_finished_g, v_seller_scrap_585_eq_g, v_seller_cash_uzs, v_seller_cash_usd
    from public.seller_gold_accounts
   where organization_id = v_org_id;

  v_cash_uzs_total := round(v_mgr_cash_uzs + v_seller_cash_uzs, 2);
  v_cash_usd_total := round(v_mgr_cash_usd + v_seller_cash_usd, 2);

  -- USD Rate resolution (FAIL-CLOSED)
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

  -- 5. Customer debts and advances
  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_customer_debts_g, v_customer_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  -- 6. Currency 585 gold equivalents
  v_cash_uzs_585_eq_g := round((v_cash_uzs_total / v_rate_585)::numeric, 4);
  if v_cash_usd_total > 0 and v_rate_usd > 0 then
    v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);
  else
    v_cash_usd_585_eq_g := 0;
  end if;

  -- 7. Factory debt (Receipts due minus Handover paid)
  select coalesce(sum(factory_obligation_g), 0) into v_factory_rcp_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(agreed_equivalent_g), 0) into v_factory_hnd_g
  from public.factory_gold_handovers
  where organization_id = v_org_id and status <> 'reversed';

  v_factory_obligation_g := round(greatest(0, v_factory_rcp_g - v_factory_hnd_g), 4);

  -- 8. Total Assets, Liabilities, Net Assets (SELLER INTERNAL DEBT EXCLUDED TO AVOID DOUBLE COUNTING)
  v_total_assets_g := round(
    v_mgr_finished_g + v_seller_finished_g +
    v_mgr_scrap_585_eq_g + v_seller_scrap_585_eq_g +
    v_mgr_refined_g + v_mgr_capital_pure_g + v_mgr_purchased_g +
    v_refining_wip_g +
    v_customer_debts_g +
    v_cash_uzs_585_eq_g + v_cash_usd_585_eq_g,
    4
  );

  v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g, 4);
  v_net_assets_g := round(v_total_assets_g - v_total_liabilities_g, 4);

  -- 9. Archive previous active baselines
  update public.accounting_baselines
     set status = 'archived'
   where organization_id = v_org_id and status = 'active';

  v_baseline_no := 'BASE-' || to_char(v_today, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  v_snapshot := jsonb_build_object(
    'gold_rate_585', v_rate_585,
    'usd_rate', v_rate_usd,
    'rate_date', v_today,
    'manager_finished_g', v_mgr_finished_g,
    'seller_finished_g', v_seller_finished_g,
    'manager_scrap_585_eq_g', v_mgr_scrap_585_eq_g,
    'seller_scrap_585_eq_g', v_seller_scrap_585_eq_g,
    'manager_refined_gold_g', v_mgr_refined_g,
    'manager_capital_pure_gold_g', v_mgr_capital_pure_g,
    'manager_purchased_gold_g', v_mgr_purchased_g,
    'refining_wip_585_g', v_refining_wip_g,
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
    'total_assets_585_g', v_total_assets_g,
    'total_liabilities_585_g', v_total_liabilities_g,
    'net_assets_585_g', v_net_assets_g,
    'gold_rate_585', v_rate_585,
    'usd_rate', v_rate_usd,
    'snapshot', v_snapshot
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_confirm_accounting_baseline', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_confirm_accounting_baseline(text, text, numeric) to authenticated;

-- Enhanced rpc_get_accounting_profit_summary
create or replace function public.rpc_get_accounting_profit_summary(
  p_start_date  date default null,
  p_end_date    date default null,
  p_gold_rate   numeric default null,
  p_usd_rate    numeric default null,
  p_org_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id                uuid := coalesce(p_org_id, public.current_organization_id());
  v_today                 date := (timezone('Asia/Tashkent', now()))::date;
  v_gold_rate_585         numeric(18, 2);
  v_usd_rate              numeric(18, 2);
  v_rate_confirmed        boolean := false;
  v_base                  public.accounting_baselines%rowtype;

  -- Live Asset Components (585 Eq)
  v_mgr_stock_g           numeric(14, 4) := 0;
  v_seller_stock_g        numeric(14, 4) := 0;
  v_mgr_scrap_g           numeric(14, 4) := 0;
  v_mgr_scrap_phys_g      numeric(14, 4) := 0;
  v_seller_scrap_g        numeric(14, 4) := 0;
  v_seller_scrap_phys_g   numeric(14, 4) := 0;
  v_mgr_refined_g         numeric(14, 4) := 0;
  v_mgr_capital_pure_g    numeric(14, 4) := 0;
  v_mgr_purchased_g       numeric(14, 4) := 0;
  v_refining_wip_g        numeric(14, 4) := 0;
  v_cust_debts_g          numeric(14, 4) := 0;
  v_mgr_cash_uzs          numeric(18, 2) := 0;
  v_seller_cash_uzs       numeric(18, 2) := 0;
  v_total_cash_uzs        numeric(18, 2) := 0;
  v_cash_585_eq_g         numeric(14, 4) := 0;
  v_mgr_usd               numeric(18, 2) := 0;
  v_seller_usd            numeric(18, 2) := 0;
  v_total_usd             numeric(18, 2) := 0;
  v_usd_585_eq_g          numeric(14, 4) := 0;
  v_tot_assets_g          numeric(14, 4) := 0;

  -- Live Liability Components
  v_factory_rcp_due_g     numeric(14, 4) := 0;
  v_factory_hnd_paid_g    numeric(14, 4) := 0;
  v_factory_debt_g        numeric(14, 4) := 0;
  v_cust_advances_g       numeric(14, 4) := 0;
  v_tot_liabilities_g     numeric(14, 4) := 0;
  v_cur_net_assets_g      numeric(14, 4) := 0;

  -- Period Capital Flows & Adjustments
  v_cap_in_g              numeric(14, 4) := 0;
  v_cap_out_g             numeric(14, 4) := 0;
  v_expenses_g            numeric(14, 4) := 0;
  v_post_base_legacy_adj  numeric(14, 4) := 0;
  v_refining_loss_g       numeric(14, 4) := 0;

  -- Final Capital-Adjusted Period Result
  v_period_accounting_res numeric(14, 4) := null;
  v_seller_rec            record;
  v_vault_rec             public.manager_vault_account%rowtype;
  v_components            jsonb;
begin
  if v_org_id is null then
    select id into v_org_id
    from public.organizations
    order by (case when id = '00000000-0000-0000-0000-000000000001'::uuid then 0 else 1 end), created_at asc
    limit 1;
  end if;

  if v_org_id is null then
    return jsonb_build_object(
      'status', 'error',
      'error', 'Tashkilot aniqlanmadi (organization_id is null)',
      'is_computable', false
    );
  end if;

  -- Look up active baseline
  select * into v_base
  from public.accounting_baselines
  where organization_id = v_org_id and status = 'active'
  order by baseline_date desc, created_at desc
  limit 1;

  -- PILOT PERIOD LOCK:
  if p_end_date is not null and p_end_date <> v_today then
    return jsonb_build_object(
      'status', 'unsupported_pilot_period',
      'error', format('Pilot davrida faqat bugungi kungacha (jonli real-time) hisoblash qo''llab-quvvatlanadi. Tanlangan oxirgi sana: %s, Bugun: %s.', p_end_date, v_today),
      'is_computable', false,
      'is_complete', false,
      'accounting_method', 'realtime_pilot_locked'
    );
  end if;

  if p_start_date is not null and v_base.id is not null and p_start_date <> v_base.baseline_date then
    return jsonb_build_object(
      'status', 'unsupported_pilot_period',
      'error', format('Pilot davrida faqat tasdiqlangan boshlang''ich hisob sanasidan (%s) boshlab hisoblash mumkin. Tarixiy sanalar bo''yicha alohida qoldiqlar arxivi keyingi bosqichda faollashadi.', v_base.baseline_date),
      'is_computable', false,
      'is_complete', false,
      'accounting_method', 'realtime_pilot_locked'
    );
  end if;

  -- Gold & USD rates from today's daily_gold_rates
  select rate_per_gram, is_confirmed into v_gold_rate_585, v_rate_confirmed
  from public.daily_gold_rates
  where organization_id = v_org_id and proba = 585 and rate_date = v_today
  order by created_at desc
  limit 1;

  if v_gold_rate_585 is null or v_gold_rate_585 <= 0 then
    select rate_per_gram, is_confirmed into v_gold_rate_585, v_rate_confirmed
    from public.daily_gold_rates
    where organization_id = v_org_id and proba = 585
    order by rate_date desc, created_at desc
    limit 1;
  end if;

  if p_gold_rate is not null and p_gold_rate > 0 and (v_gold_rate_585 is null or not v_rate_confirmed) then
    v_gold_rate_585 := round(p_gold_rate::numeric, 2);
    v_rate_confirmed := false;
  end if;

  -- USD rate: from p_usd_rate if provided, else from baseline, else default 12800
  if p_usd_rate is not null and p_usd_rate > 0 then
    v_usd_rate := round(p_usd_rate::numeric, 2);
  else
    select usd_rate into v_usd_rate
    from public.accounting_baselines
    where organization_id = v_org_id
    order by baseline_date desc, created_at desc
    limit 1;

    if v_usd_rate is null or v_usd_rate <= 0 then
      v_usd_rate := 12800.00;
    end if;
  end if;

  -- 1. ASSET: Manager finished goods in stock (excluding reversed receipts)
  select coalesce(sum(available_physical_g), 0) into v_mgr_stock_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  -- 2. ASSET: Seller consignment pieces
  select coalesce(sum(public.get_seller_available_stock_grams(e.id)), 0) into v_seller_stock_g
  from public.employees e
  where e.organization_id = v_org_id and e.role::text in ('seller', 'sales', 'sotuvchi');

  -- 3. ASSET: Manager Vault Holdings
  select * into v_vault_rec
  from public.manager_vault_account
  where organization_id = v_org_id;

  if found then
    v_mgr_scrap_g        := coalesce(v_vault_rec.manager_scrap_585_eq_g, coalesce(v_vault_rec.manager_scrap_grams, 0));
    v_mgr_scrap_phys_g   := coalesce(v_vault_rec.manager_scrap_physical_g, coalesce(v_vault_rec.manager_scrap_grams, 0));
    v_mgr_refined_g      := coalesce(v_vault_rec.manager_refined_gold_grams, 0);
    v_mgr_capital_pure_g := coalesce(v_vault_rec.manager_capital_pure_gold_g, 0);
    v_mgr_purchased_g    := coalesce(v_vault_rec.manager_purchased_gold_grams, 0);
    v_mgr_cash_uzs       := coalesce(v_vault_rec.manager_cash_amount, 0);
    v_mgr_usd            := coalesce(v_vault_rec.manager_usd_amount, 0);
  end if;

  -- 3b. ASSET: Refining WIP
  select coalesce(sum(coalesce(input_585_equiv_grams, input_scrap_grams * (coalesce(input_scrap_proba, 585.0) / 585.0))), 0)
    into v_refining_wip_g
    from public.refining_batches
   where organization_id = v_org_id and status in ('pending', 'in_progress');

  -- 4. ASSET: Seller Till Holdings
  for v_seller_rec in
    select coalesce(seller_till_scrap_585_eq_g, coalesce(seller_till_scrap_grams, 0)) as scrap_585,
           coalesce(seller_till_scrap_physical_g, coalesce(seller_till_scrap_grams, 0)) as scrap_phys,
           coalesce(seller_till_cash_amount, 0) as cash_uzs,
           coalesce(seller_till_usd_amount, 0) as cash_usd
    from public.seller_gold_accounts
    where organization_id = v_org_id
  loop
    v_seller_scrap_g      := v_seller_scrap_g + v_seller_rec.scrap_585;
    v_seller_scrap_phys_g := v_seller_scrap_phys_g + v_seller_rec.scrap_phys;
    v_seller_cash_uzs     := v_seller_cash_uzs + v_seller_rec.cash_uzs;
    v_seller_usd          := v_seller_usd + v_seller_rec.cash_usd;
  end loop;

  -- 5. ASSET: Client Debts and Advances
  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_cust_debts_g, v_cust_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  -- 6. Cash and USD 585 Gold Equivalents
  v_total_cash_uzs := round(v_mgr_cash_uzs + v_seller_cash_uzs, 2);
  v_total_usd      := round(v_mgr_usd + v_seller_usd, 2);

  if v_gold_rate_585 is not null and v_gold_rate_585 > 0 then
    v_cash_585_eq_g := round((v_total_cash_uzs / v_gold_rate_585)::numeric, 4);
    if v_usd_rate is not null and v_usd_rate > 0 then
      v_usd_585_eq_g := round(((v_total_usd * v_usd_rate) / v_gold_rate_585)::numeric, 4);
    end if;
  end if;

  v_tot_assets_g := round(
    v_mgr_stock_g + v_seller_stock_g + v_mgr_scrap_g + v_seller_scrap_g +
    v_mgr_refined_g + v_mgr_capital_pure_g + v_mgr_purchased_g +
    v_refining_wip_g +
    v_cust_debts_g +
    v_cash_585_eq_g + v_usd_585_eq_g,
    4
  );

  -- 7. LIABILITIES: Factory Obligations (strictly excluding reversed)
  select coalesce(sum(factory_obligation_g), 0) into v_factory_rcp_due_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(agreed_equivalent_g), 0) into v_factory_hnd_paid_g
  from public.factory_gold_handovers
  where organization_id = v_org_id and status <> 'reversed';

  v_factory_debt_g := round(greatest(0, v_factory_rcp_due_g - v_factory_hnd_paid_g)::numeric, 4);
  v_tot_liabilities_g := round(v_factory_debt_g + v_cust_advances_g, 4);

  -- 8. CURRENT LIVE NET ASSETS (585g Equivalent)
  v_cur_net_assets_g := round(v_tot_assets_g - v_tot_liabilities_g, 4);

  -- Components breakdown object
  v_components := jsonb_build_object(
    'manager_finished_goods_585_g', v_mgr_stock_g,
    'sellers_finished_goods_585_g', v_seller_stock_g,
    'manager_scrap_585_eq_g', v_mgr_scrap_g,
    'manager_scrap_physical_g', v_mgr_scrap_phys_g,
    'sellers_scrap_585_eq_g', v_seller_scrap_g,
    'sellers_scrap_physical_g', v_seller_scrap_phys_g,
    'manager_refined_gold_585_g', v_mgr_refined_g,
    'manager_capital_pure_gold_585_g', v_mgr_capital_pure_g,
    'manager_purchased_gold_585_g', v_mgr_purchased_g,
    'refining_wip_585_g', v_refining_wip_g,
    'customer_debts_585_g', v_cust_debts_g,
    'customer_advances_585_g', v_cust_advances_g,
    'manager_cash_uzs', v_mgr_cash_uzs,
    'sellers_cash_uzs', v_seller_cash_uzs,
    'cash_uzs_amount', v_total_cash_uzs,
    'cash_uzs_585_eq_g', v_cash_585_eq_g,
    'manager_cash_usd', v_mgr_usd,
    'sellers_cash_usd', v_seller_usd,
    'cash_usd_amount', v_total_usd,
    'cash_usd_585_eq_g', v_usd_585_eq_g,
    'factory_obligation_585_g', v_factory_debt_g
  );

  -- 9. CAPITAL FLOWS & AUDITED LEGACY DEBT ADJUSTMENTS
  if v_base.id is not null then
    select coalesce(sum(case when transaction_type in ('capital_in', 'capital_contribution') then equiv_585_grams else 0 end), 0),
           coalesce(sum(case when transaction_type in ('capital_out', 'capital_distribution') then equiv_585_grams else 0 end), 0),
           coalesce(sum(case when transaction_type in ('expense', 'business_expense') then equiv_585_grams else 0 end), 0)
      into v_cap_in_g, v_cap_out_g, v_expenses_g
      from public.financial_transactions
     where organization_id = v_org_id and status <> 'reversed'
       and created_at > v_base.created_at;

    select coalesce(sum(delta_585_g), 0) into v_post_base_legacy_adj
    from public.client_legacy_debts
    where organization_id = v_org_id and status <> 'reversed'
      and created_at > v_base.created_at;

    -- Pateriya during period (informational line item)
    select coalesce(sum(total_loss_grams), 0) into v_refining_loss_g
    from public.refining_batches
    where organization_id = v_org_id and status = 'completed'
      and created_at > v_base.created_at;

    -- Profit Formula:
    -- Net asset change naturally absorbs pateriya (since scrap reduced more than refined increased).
    -- Therefore, pateriya is accounted for EXACTLY ONCE and not double-subtracted.
    v_period_accounting_res := round(
      (v_cur_net_assets_g - v_base.net_assets_585_g)
      - v_cap_in_g
      + v_cap_out_g
      + v_expenses_g
      - v_post_base_legacy_adj,
      4
    );
  end if;

  return jsonb_build_object(
    'status', case when v_base.id is null then 'baseline_not_set' else 'ok' end,
    'is_computable', (v_base.id is not null),
    'is_complete', (v_gold_rate_585 is not null and v_gold_rate_585 > 0 and v_rate_confirmed and v_base.id is not null),
    'as_of_time', timezone('Asia/Tashkent', now()),
    'as_of_date', v_today,
    'has_baseline', (v_base.id is not null),
    'has_active_baseline', (v_base.id is not null),
    'missing_data', case
      when v_base.id is null then jsonb_build_array('Boshlang''ich hisob tasdiqlanmagan (muzlatilmagan). Boshqaruv panelidan hisobni boshlang.')
      else '[]'::jsonb
    end,
    'rates', jsonb_build_object(
      'gold_rate_585', v_gold_rate_585,
      'is_confirmed', (v_rate_confirmed and v_gold_rate_585 is not null),
      'usd_rate', v_usd_rate,
      'rate_date', v_today
    ),
    'baseline', case
      when v_base.id is null then null
      else jsonb_build_object(
        'id', v_base.id,
        'baseline_no', v_base.baseline_no,
        'baseline_date', v_base.baseline_date,
        'net_assets_585_g', v_base.net_assets_585_g,
        'total_assets_585_g', v_base.total_assets_585_g,
        'total_liabilities_585_g', v_base.total_liabilities_585_g,
        'gold_rate_585', v_base.gold_rate_585,
        'usd_rate', v_base.usd_rate
      )
    end,
    'current_net_assets_585_g', v_cur_net_assets_g,
    'net_assets_585_g', v_cur_net_assets_g,
    'current_total_assets_585_g', v_tot_assets_g,
    'current_total_liabilities_585_g', v_tot_liabilities_g,
    'period_accounting_result_585_g', v_period_accounting_res,
    'operational_trading_result_585_g', v_period_accounting_res,
    'fx_valuation_impact_585_g', null,
    'capital_contributions_585_g', v_cap_in_g,
    'capital_distributions_585_g', v_cap_out_g,
    'business_expenses_585_g', v_expenses_g,
    'refining_loss_585_g', v_refining_loss_g,
    'post_baseline_legacy_debt_adj_585_g', v_post_base_legacy_adj,
    'accounting_method', 'net_assets_delta_capital_adjusted_585_g',
    'accounting_scope_notes', 'Hisob 585 proba sof oltin ekvivalentida yuritiladi. Sof aktivlar o''zgarishi (kapital va pateriya ta''siri to''g''ri hisobga olingan holda) korxona sof natijasini beradi.',
    'pilot_notice', 'Pilot davrida umumiy hisobiy natija (aktivlar o''sishi) to''liq aniq; alohida savdo marjasi va kurs tafovutiga ajratish to''liq partiyaviy konvertatsiya tahlili yakunlangach taqdim etiladi.',
    'components', v_components,
    'assets', jsonb_build_object(
      'manager_stock_585_g', v_mgr_stock_g,
      'seller_stock_585_g', v_seller_stock_g,
      'manager_scrap_585_g', v_mgr_scrap_g,
      'seller_scrap_585_g', v_seller_scrap_g,
      'manager_refined_585_g', v_mgr_refined_g,
      'manager_capital_pure_585_g', v_mgr_capital_pure_g,
      'manager_purchased_585_g', v_mgr_purchased_g,
      'refining_wip_585_g', v_refining_wip_g,
      'customer_debts_585_g', v_cust_debts_g,
      'cash_uzs_585_g', v_cash_585_eq_g,
      'cash_usd_585_g', v_usd_585_eq_g
    ),
    'liabilities', jsonb_build_object(
      'factory_debt_585_g', v_factory_debt_g,
      'customer_advances_585_g', v_cust_advances_g
    )
  );
end;
$$;

grant execute on function public.rpc_get_accounting_profit_summary to authenticated;

-- -------------------------------------------------------------------------
-- PART 7: RECONCILIATION & MONTHLY REPORT PARITY
-- -------------------------------------------------------------------------

create or replace function public.rpc_get_seller_reconciliation_statement(
  p_seller_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_seller_acc        public.seller_gold_accounts%rowtype;

  -- Section A: Received from Manager + Legacy customer debts assigned
  v_sec_a_orig_g      numeric(14, 4) := 0;
  v_sec_a_obl_g       numeric(14, 4) := 0;
  v_sec_a_count       integer := 0;
  v_sec_a_legacy_g    numeric(14, 4) := 0;

  -- Section B: Goods Unsold
  v_sec_b_count       integer := 0;
  v_sec_b_orig_g      numeric(14, 4) := 0;
  v_sec_b_equiv_g     numeric(14, 4) := 0;

  -- Section C: Goods Sold to Customers
  v_sec_c_count       integer := 0;
  v_sec_c_orig_g      numeric(14, 4) := 0;
  v_sec_c_equiv_g     numeric(14, 4) := 0;

  -- Section D: Customer Receivables
  v_sec_d_client_obl  numeric(14, 4) := 0;
  v_sec_d_scrap_rec   numeric(14, 4) := 0;
  v_sec_d_cash_rec    numeric(18, 2) := 0;
  v_sec_d_cash_eq     numeric(14, 4) := 0;
  v_sec_d_cust_debt   numeric(14, 4) := 0;

  -- Section E: Seller Holdings
  v_sec_e_cash_uzs    numeric(18, 2) := 0;
  v_sec_e_cash_usd    numeric(18, 2) := 0;
  v_sec_e_scrap_g     numeric(14, 4) := 0;

  -- Section F: Seller-to-Manager Settlements & Returns
  v_sec_f_scrap_g     numeric(14, 4) := 0;
  v_sec_f_cash_uzs    numeric(18, 2) := 0;
  v_sec_f_cash_eq     numeric(14, 4) := 0;
  v_sec_f_ret_count   integer := 0;
  v_sec_f_ret_orig_g  numeric(14, 4) := 0;
  v_sec_f_ret_obl_g   numeric(14, 4) := 0;

  -- Section G: Signed Bozor Qarzi
  v_sec_g_signed_g    numeric(14, 4) := 0;
  v_sec_g_owes_m_g    numeric(14, 4) := 0;
  v_sec_g_m_owes_s_g  numeric(14, 4) := 0;
  v_discrepancy       numeric(14, 4) := 0;
  v_is_reconciled     boolean := true;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  select * into v_seller
    from public.employees
   where id = p_seller_id and organization_id = v_caller_org;

  if not found then
    raise exception 'Sotuvchi topilmadi (%)', p_seller_id;
  end if;

  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = p_seller_id and organization_id = v_caller_org;

  -- Section A: Consignments + Legacy Debts Assigned
  select
    coalesce(sum(base_weight_grams + returned_weight_grams), 0),
    coalesce(sum(coalesce(seller_obligation_g, 0) + returned_seller_obligation_g), 0),
    coalesce(sum(quantity + returned_quantity), 0)
  into v_sec_a_orig_g, v_sec_a_obl_g, v_sec_a_count
  from public.seller_consignments
  where seller_id = p_seller_id and organization_id = v_caller_org;

  select coalesce(sum(delta_585_g), 0)
  into v_sec_a_legacy_g
  from public.client_legacy_debts
  where seller_id = p_seller_id and organization_id = v_caller_org
    and balance_type = 'debt'
    and status <> 'reversed';

  v_sec_a_obl_g := round(v_sec_a_obl_g + v_sec_a_legacy_g, 4);

  -- Section B: Unsold Pieces
  select
    count(*),
    coalesce(sum(weight_grams), 0),
    coalesce(sum(round((weight_grams * (1.0 + coalesce(seller_markup_pct, 12.0) / 100.0))::numeric, 4)), 0)
  into v_sec_b_count, v_sec_b_orig_g, v_sec_b_equiv_g
  from public.consignment_pieces
  where seller_id = p_seller_id and organization_id = v_caller_org
    and status = 'held_by_seller';

  -- Section C: Sold Pieces
  select
    count(*),
    coalesce(sum(weight_grams), 0),
    coalesce(sum(round((weight_grams * (1.0 + coalesce(seller_markup_pct, 12.0) / 100.0))::numeric, 4)), 0)
  into v_sec_c_count, v_sec_c_orig_g, v_sec_c_equiv_g
  from public.consignment_pieces
  where seller_id = p_seller_id and organization_id = v_caller_org
    and status = 'sold';

  -- Section D: Customer Receivables (EXCLUDE REVERSED SETTLEMENTS & SALES)
  select
    coalesce(sum(client_gold_due_grams), 0)
  into v_sec_d_client_obl
  from public.jewelry_sales
  where seller_id = p_seller_id and organization_id = v_caller_org
    and status <> 'reversed';

  select
    coalesce(sum(scrap_weight_grams), 0),
    coalesce(sum(cash_paid_amount), 0),
    coalesce(sum(cash_equivalent_grams), 0)
  into v_sec_d_scrap_rec, v_sec_d_cash_rec, v_sec_d_cash_eq
  from public.gold_settlements
  where seller_id = p_seller_id and organization_id = v_caller_org
    and direction = 'client_to_seller'
    and (status is null or status not in ('reversed', 'cancelled'));

  select
    coalesce(sum(current_debt_grams), 0)
  into v_sec_d_cust_debt
  from public.client_gold_accounts
  where seller_id = p_seller_id and organization_id = v_caller_org;

  -- Section E: Seller Holdings
  v_sec_e_cash_uzs := coalesce(v_seller_acc.seller_till_cash_amount, 0);
  v_sec_e_cash_usd := coalesce(v_seller_acc.seller_till_usd_amount, 0);
  v_sec_e_scrap_g  := coalesce(v_seller_acc.seller_till_scrap_grams, 0);

  -- Section F: Seller to Manager Settlements & Returned Unsold Goods (EXCLUDE REVERSED!)
  select
    coalesce(sum(scrap_weight_grams), 0),
    coalesce(sum(cash_paid_amount), 0),
    coalesce(sum(cash_equivalent_grams), 0)
  into v_sec_f_scrap_g, v_sec_f_cash_uzs, v_sec_f_cash_eq
  from public.gold_settlements
  where seller_id = p_seller_id and organization_id = v_caller_org
    and direction in ('seller_to_manager', 'seller_to_factory')
    and (status is null or status not in ('reversed', 'cancelled'));

  select
    count(*),
    coalesce(sum(weight_grams), 0),
    coalesce(sum(round((weight_grams * (1.0 + coalesce(seller_markup_pct, 12.0) / 100.0))::numeric, 4)), 0)
  into v_sec_f_ret_count, v_sec_f_ret_orig_g, v_sec_f_ret_obl_g
  from public.consignment_pieces
  where seller_id = p_seller_id and organization_id = v_caller_org
    and status in ('returned_to_manager', 'returned_to_factory');

  -- Section G: Current Signed Bozor Qarzi
  v_sec_g_owes_m_g   := coalesce(v_seller_acc.seller_owes_manager_g, 0);
  v_sec_g_m_owes_s_g := coalesce(v_seller_acc.manager_owes_seller_g, 0);
  v_sec_g_signed_g   := coalesce(v_seller_acc.bozor_qarzi_signed_g, 0);

  -- Reconciliation Invariant Check:
  -- Expected liability = Total consigned obligation + legacy debt - Returned obligation - Total settled to manager
  v_discrepancy := round(abs(v_sec_g_owes_m_g - greatest(0, (v_sec_a_obl_g - v_sec_f_ret_obl_g) - (v_sec_f_scrap_g + v_sec_f_cash_eq))), 4);
  v_is_reconciled := (v_discrepancy < 0.001);

  return jsonb_build_object(
    'seller_id', p_seller_id,
    'seller_name', coalesce(v_seller.full_name, v_seller.name),
    'generated_at', timezone('Asia/Tashkent', now()),
    'section_a', jsonb_build_object(
      'title', 'A. Boshqaruvchidan qabul qilingan tovarlar va eski mas''uliyat',
      'original_grams', v_sec_a_orig_g,
      'seller_markup_obligation_grams', v_sec_a_obl_g,
      'legacy_customer_debt_assigned_g', v_sec_a_legacy_g,
      'item_count', v_sec_a_count
    ),
    'section_b', jsonb_build_object(
      'title', 'B. Sotilmagan tovarlar (Sotuvchi javonida)',
      'item_count', v_sec_b_count,
      'original_grams', v_sec_b_orig_g,
      'seller_markup_equivalent_grams', v_sec_b_equiv_g
    ),
    'section_c', jsonb_build_object(
      'title', 'C. Mijozlarga sotilgan tovarlar',
      'item_count', v_sec_c_count,
      'original_grams', v_sec_c_orig_g,
      'seller_markup_equivalent_grams', v_sec_c_equiv_g
    ),
    'section_d', jsonb_build_object(
      'title', 'D. Mijozlar qarzdorligi (Nasiya)',
      'customer_markup_obligation_grams', v_sec_d_client_obl,
      'scrap_collected_grams', v_sec_d_scrap_rec,
      'cash_collected_uzs', v_sec_d_cash_rec,
      'cash_equivalent_grams', v_sec_d_cash_eq,
      'outstanding_customer_debt_grams', v_sec_d_cust_debt
    ),
    'section_e', jsonb_build_object(
      'title', 'E. Sotuvchi kassasidagi mablag''lar',
      'cash_uzs', v_sec_e_cash_uzs,
      'cash_usd', v_sec_e_cash_usd,
      'scrap_grams', v_sec_e_scrap_g
    ),
    'section_f', jsonb_build_object(
      'title', 'F. Menejerga topshirilgan tushumlar va qaytarilgan tovarlar',
      'settlements_scrap_grams', v_sec_f_scrap_g,
      'settlements_cash_uzs', v_sec_f_cash_uzs,
      'settlements_cash_equivalent_grams', v_sec_f_cash_eq,
      'returned_unsold_items_count', v_sec_f_ret_count,
      'returned_unsold_original_grams', v_sec_f_ret_orig_g,
      'returned_unsold_seller_obligation_grams', v_sec_f_ret_obl_g
    ),
    'section_g', jsonb_build_object(
      'title', 'G. Yakuniy Bozor Qarzi va Solishtirma',
      'total_goods_obligation_grams', v_sec_a_obl_g,
      'total_deductions_settled_and_returned_grams', round(v_sec_f_ret_obl_g + v_sec_f_scrap_g + v_sec_f_cash_eq, 4),
      'seller_owes_manager_grams', v_sec_g_owes_m_g,
      'manager_owes_seller_grams', v_sec_g_m_owes_s_g,
      'bozor_qarzi_signed_grams', v_sec_g_signed_g,
      'discrepancy_grams', v_discrepancy,
      'is_reconciled', v_is_reconciled
    )
  );
end;
$$;

grant execute on function public.rpc_get_seller_reconciliation_statement to authenticated;

-- Enhanced rpc_get_customer_monthly_report
create or replace function public.rpc_get_customer_monthly_report(
  p_seller_id uuid default null,
  p_year      integer default null,
  p_month     integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_caller_emp_id uuid := public.current_employee_id();
  v_filter_seller uuid;
  v_year          integer := coalesce(p_year, extract(year from current_date)::integer);
  v_month         integer := coalesce(p_month, extract(month from current_date)::integer);
  v_start_date    date;
  v_end_date      date;
  v_rows          jsonb := '[]'::jsonb;
  v_cust_rec      record;
  v_open_debt     numeric(14, 4);
  v_month_legacy  numeric(14, 4);
  v_month_sales   numeric(14, 4);
  v_month_scrap   numeric(14, 4);
  v_month_cash    numeric(18, 2);
  v_month_cash_g  numeric(14, 4);
  v_month_settle  numeric(14, 4);
  v_close_debt    numeric(14, 4);

  -- Overall totals
  v_tot_dist     numeric(14, 4) := 0;
  v_tot_coll     numeric(14, 4) := 0;
  v_tot_debt     numeric(14, 4) := 0;
  v_tot_cash_uzs numeric(18, 2) := 0;
  v_tot_scrap_g  numeric(14, 4) := 0;
  v_bozor_qarzi  numeric(14, 4) := 0;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_caller_role in ('seller', 'sotuvchi', 'sales') then
    if p_seller_id is not null and p_seller_id <> v_caller_emp_id then
      raise exception 'Cross-seller violation: Sotuvchilar faqat o''z hisobotini ko''ra oladi' using errcode = '42501';
    end if;
    v_filter_seller := v_caller_emp_id;
  else
    v_filter_seller := p_seller_id;
  end if;

  v_start_date := make_date(v_year, v_month, 1);
  v_end_date   := (v_start_date + interval '1 month - 1 day')::date;

  for v_cust_rec in
    select c.id, c.customer_code, c.contact_name, c.phone, c.seller_id
    from public.customers c
    where c.organization_id = v_caller_org
      and (v_filter_seller is null or c.seller_id = v_filter_seller)
    order by c.contact_name asc
  loop
    -- 1. Opening debt: Legacy debts before start date + Sales before start date - Payments before start date (EXCLUDE REVERSED!)
    select coalesce(sum(delta_585_g), 0) into v_open_debt
    from public.client_legacy_debts
    where customer_id = v_cust_rec.id
      and balance_type = 'debt'
      and as_of_date < v_start_date
      and status <> 'reversed';

    select v_open_debt + coalesce(sum(client_gold_due_grams), 0) into v_open_debt
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and sale_date < v_start_date
      and status <> 'reversed';

    select v_open_debt - coalesce(sum(total_settled_grams), 0) into v_open_debt
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and direction = 'client_to_seller'
      and status <> 'reversed'
      and settlement_date < v_start_date;

    v_open_debt := round(greatest(0, v_open_debt), 4);

    -- 2. Legacy debts registered in current month
    select coalesce(sum(delta_585_g), 0) into v_month_legacy
    from public.client_legacy_debts
    where customer_id = v_cust_rec.id
      and balance_type = 'debt'
      and as_of_date between v_start_date and v_end_date
      and status <> 'reversed';

    -- 3. Sales during selected month (EXCLUDE REVERSED!)
    select coalesce(sum(client_gold_due_grams), 0) into v_month_sales
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and sale_date between v_start_date and v_end_date
      and status <> 'reversed';

    -- 4. Payments during selected month (EXCLUDE REVERSED!)
    select
      coalesce(sum(scrap_weight_grams), 0),
      coalesce(sum(cash_paid_amount), 0),
      coalesce(sum(cash_equivalent_grams), 0),
      coalesce(sum(total_settled_grams), 0)
    into v_month_scrap, v_month_cash, v_month_cash_g, v_month_settle
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and direction = 'client_to_seller'
      and status <> 'reversed'
      and settlement_date between v_start_date and v_end_date;

    -- 5. Closing debt: opening + month legacy + sales - settled
    v_close_debt := round(greatest(0, (v_open_debt + v_month_legacy + v_month_sales) - v_month_settle), 4);

    -- Include if customer had any legacy debt, opening debt, sales, settlement or closing debt
    if v_open_debt > 0 or v_month_legacy > 0 or v_month_sales > 0 or v_month_settle > 0 or v_close_debt > 0 then
      v_rows := v_rows || jsonb_build_object(
        'customer_id', v_cust_rec.id,
        'customer_code', v_cust_rec.customer_code,
        'customer_name', v_cust_rec.contact_name,
        'phone', v_cust_rec.phone,
        'opening_debt_g', v_open_debt,
        'legacy_added_month_g', v_month_legacy,
        'sales_in_month_g', v_month_sales,
        'scrap_received_g', v_month_scrap,
        'cash_received_uzs', v_month_cash,
        'cash_equivalent_g', v_month_cash_g,
        'total_settled_g', v_month_settle,
        'closing_debt_g', v_close_debt
      );

      v_tot_dist := v_tot_dist + v_month_sales + v_month_legacy;
      v_tot_coll := v_tot_coll + v_month_settle;
      v_tot_debt := v_tot_debt + v_close_debt;
    end if;
  end loop;

  -- Overall seller till & bozor qarzi
  if v_filter_seller is not null then
    select
      coalesce(seller_till_cash_amount, 0),
      coalesce(seller_till_scrap_grams, 0),
      coalesce(bozor_qarzi_signed_g, 0)
    into v_tot_cash_uzs, v_tot_scrap_g, v_bozor_qarzi
    from public.seller_gold_accounts
    where seller_id = v_filter_seller and organization_id = v_caller_org;
  else
    select
      coalesce(sum(seller_till_cash_amount), 0),
      coalesce(sum(seller_till_scrap_grams), 0),
      coalesce(sum(bozor_qarzi_signed_g), 0)
    into v_tot_cash_uzs, v_tot_scrap_g, v_bozor_qarzi
    from public.seller_gold_accounts
    where organization_id = v_caller_org;
  end if;

  return jsonb_build_object(
    'year', v_year,
    'month', v_month,
    'seller_id', v_filter_seller,
    'items', v_rows,
    'summary', jsonb_build_object(
      'total_distributed_month_g', v_tot_dist,
      'total_collected_month_g', v_tot_coll,
      'total_customer_debt_g', v_tot_debt,
      'seller_held_cash_uzs', v_tot_cash_uzs,
      'seller_held_scrap_g', v_tot_scrap_g,
      'seller_manager_bozor_qarzi_g', v_bozor_qarzi,
      'note', 'Bozor qarzi - Boshqaruvchiga nisbatan sof majburiyat (mijozlar qarzi va konsignatsiya majburiyati to''liq hisoblangan)'
    )
  );
end;
$$;

grant execute on function public.rpc_get_customer_monthly_report to authenticated;
