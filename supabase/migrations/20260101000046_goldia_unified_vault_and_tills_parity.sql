-- =========================================================================
-- 20260101000046_goldia_unified_vault_and_tills_parity.sql
-- Goldia Sales — Unified Vault, Multi-Currency Till Parity & Manager Stock
--
-- 1. Adds manager_physical_stock_g, manager_scrap_physical_g, manager_scrap_585_eq_g
--    to public.manager_vault_account.
-- 2. Adds seller_till_scrap_physical_g, seller_till_scrap_585_eq_g
--    to public.seller_gold_accounts.
-- 3. Adds currency ('UZS', 'USD') and usd_spent to public.gold_purchases.
-- 4. get_manager_available_stock_grams(): Canonical manager stock calculator.
-- 5. fn_sync_manager_vault_account() + triggers for automatic manager stock sync.
-- 6. rpc_record_client_settlement: Dual physical and 585-equiv scrap tracking in till.
-- 7. rpc_record_seller_to_manager_settlement: Multi-currency surrender (Scrap phys & 585 eq, UZS, USD).
-- 8. rpc_reverse_seller_to_manager_settlement: Complete reversal restoring all till columns.
-- 9. rpc_record_gold_purchase: Multi-currency gold purchase (UZS cash or USD from manager vault).
-- 10. rpc_issue_barcode_consignment: Strict manager stock availability check.
-- 11. rpc_record_barcode_piece_sale: Seller available physical stock validation.
-- =========================================================================

-- 1. Schema Enhancements
alter table public.manager_vault_account
  add column if not exists manager_physical_stock_g numeric(14, 4) not null default 0 check (manager_physical_stock_g >= 0),
  add column if not exists manager_scrap_physical_g numeric(14, 4) not null default 0 check (manager_scrap_physical_g >= 0),
  add column if not exists manager_scrap_585_eq_g numeric(14, 4) not null default 0 check (manager_scrap_585_eq_g >= 0);

alter table public.seller_gold_accounts
  add column if not exists seller_till_scrap_physical_g numeric(14, 4) not null default 0 check (seller_till_scrap_physical_g >= 0),
  add column if not exists seller_till_scrap_585_eq_g numeric(14, 4) not null default 0 check (seller_till_scrap_585_eq_g >= 0);

-- Backfill initial values
update public.manager_vault_account
set manager_scrap_585_eq_g = coalesce(manager_scrap_grams, 0),
    manager_scrap_physical_g = coalesce(manager_scrap_grams, 0)
where manager_scrap_585_eq_g = 0 and manager_scrap_grams > 0;

update public.seller_gold_accounts
set seller_till_scrap_585_eq_g = coalesce(seller_till_scrap_grams, 0),
    seller_till_scrap_physical_g = coalesce(seller_till_scrap_grams, 0)
where seller_till_scrap_585_eq_g = 0 and seller_till_scrap_grams > 0;

-- Enhance gold_purchases for multi-currency (USD purchases)
alter table public.gold_purchases
  alter column cash_spent_uzs drop not null,
  add column if not exists currency text not null default 'UZS' check (currency in ('UZS', 'USD')),
  add column if not exists usd_spent numeric(18, 2) default 0 check (usd_spent >= 0);

alter table public.gold_purchases drop constraint if exists gold_purchases_cash_spent_uzs_check;
alter table public.gold_purchases drop constraint if exists gold_purchases_payment_check;
alter table public.gold_purchases add constraint gold_purchases_payment_check check (
  (currency = 'UZS' and coalesce(cash_spent_uzs, 0) > 0) or
  (currency = 'USD' and coalesce(usd_spent, 0) > 0)
);

-- 2. Manager Stock Calculation & Synchronization
create or replace function public.get_manager_available_stock_grams(p_org_id uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id      uuid := coalesce(p_org_id, public.current_organization_id());
  v_receipt_g   numeric(14, 4);
  v_returned_g  numeric(14, 4);
begin
  if v_org_id is null then
    return 0;
  end if;

  select coalesce(sum(available_physical_g), 0)
  into v_receipt_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(weight_grams), 0)
  into v_returned_g
  from public.consignment_pieces
  where organization_id = v_org_id and status in ('in_manager_stock', 'returned_to_manager');

  return round(greatest(0, v_receipt_g + v_returned_g), 4);
end;
$$;

grant execute on function public.get_manager_available_stock_grams(uuid) to authenticated;

-- Function to sync manager vault stock
create or replace function public.fn_sync_manager_vault_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id       uuid := coalesce(NEW.organization_id, OLD.organization_id);
  v_avail_stock  numeric(14, 4);
begin
  if v_org_id is null then
    return coalesce(NEW, OLD);
  end if;

  v_avail_stock := public.get_manager_available_stock_grams(v_org_id);

  perform public._get_or_create_manager_vault(v_org_id);

  update public.manager_vault_account
     set manager_physical_stock_g = v_avail_stock,
         updated_at = now()
   where organization_id = v_org_id;

  return coalesce(NEW, OLD);
end;
$$;

-- Triggers for fn_sync_manager_vault_account
drop trigger if exists trg_sync_manager_vault_receipts on public.factory_receipts;
create trigger trg_sync_manager_vault_receipts
  after insert or update or delete on public.factory_receipts
  for each row execute function public.fn_sync_manager_vault_account();

drop trigger if exists trg_sync_manager_vault_handovers on public.factory_gold_handovers;
create trigger trg_sync_manager_vault_handovers
  after insert or update or delete on public.factory_gold_handovers
  for each row execute function public.fn_sync_manager_vault_account();

drop trigger if exists trg_sync_manager_vault_pieces on public.consignment_pieces;
create trigger trg_sync_manager_vault_pieces
  after insert or update or delete on public.consignment_pieces
  for each row execute function public.fn_sync_manager_vault_account();

-- Initial sync for all existing manager vaults
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public._get_or_create_manager_vault(r.id);
    update public.manager_vault_account
       set manager_physical_stock_g = public.get_manager_available_stock_grams(r.id),
           updated_at = now()
     where organization_id = r.id;
  end loop;
end;
$$;

-- 3. rpc_record_client_settlement (Upgraded for Physical & 585 Eq Scrap Tracking)
drop function if exists public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text, uuid, numeric, numeric);

create or replace function public.rpc_record_client_settlement(
  p_customer_id       uuid,
  p_sale_id           uuid default null,
  p_scrap_weight      numeric default 0,
  p_scrap_proba       numeric default null,
  p_cash_amount       numeric default 0, -- UZS
  p_rate_per_gram     numeric default null, -- 585 gold rate (UZS/g)
  p_settlement_date   date default current_date,
  p_notes             text default null,
  p_idempotency_key   text default null,
  p_seller_id         uuid default null,
  p_usd_amount        numeric default 0, -- USD
  p_usd_rate          numeric default null -- USD exchange rate (UZS/USD)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_customer          public.customers%rowtype;
  v_rate              numeric(18, 2);
  v_usd_rate          numeric(18, 2);
  v_physical_scrap    numeric(14, 4);
  v_proba             numeric(6, 2);
  v_fine_gold         numeric(14, 4) := 0;
  v_scrap_585_eq      numeric(14, 4) := 0;
  v_cash              numeric(18, 2);
  v_usd               numeric(18, 2);
  v_cash_equiv        numeric(14, 4) := 0;
  v_usd_equiv         numeric(14, 4) := 0;
  v_total_settled     numeric(14, 4);
  v_settle_id         uuid;
  v_settle_no         text;
  v_client_acc        public.client_gold_accounts%rowtype;
  v_prev_debt         numeric(14, 4) := 0;
  v_applied_to_debt   numeric(14, 4) := 0;
  v_excess_advance    numeric(14, 4) := 0;
  v_rem_debt          numeric(14, 4) := 0;
  v_new_advance       numeric(14, 4) := 0;
  v_payload           jsonb;
  v_existing          jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  v_physical_scrap := round(greatest(0, coalesce(p_scrap_weight, 0))::numeric, 4);
  v_cash := round(greatest(0, coalesce(p_cash_amount, 0))::numeric, 2);
  v_usd  := round(greatest(0, coalesce(p_usd_amount, 0))::numeric, 2);

  if v_physical_scrap <= 0 and v_cash <= 0 and v_usd <= 0 then
    raise exception 'To''lov uchun lom vazni, naqd so''m yoki dollar summasi kiritilishi shart';
  end if;

  -- 1. Scrap validation
  if v_physical_scrap > 0 then
    if p_scrap_proba is null or p_scrap_proba <= 0 then
      raise exception 'Lom oltin probasi aniq ko''rsatilishi shart (masalan: 375, 585, 750, 995, 999.9)';
    end if;
    v_proba := round(p_scrap_proba::numeric, 2);
    if v_proba < 300.0 or v_proba > 1000.0 then
      raise exception 'Noto''g''ri proba kiritildi: % (ruxsat: 300 - 1000)', v_proba;
    end if;

    v_fine_gold := round((v_physical_scrap * (v_proba / 1000.0))::numeric, 4);
    v_scrap_585_eq := round((v_physical_scrap * (v_proba / 585.0))::numeric, 4);
  else
    v_proba := 585.0;
    v_fine_gold := 0;
    v_scrap_585_eq := 0;
  end if;

  -- 2. 585 Gold rate determination (NO SILENT 900,000 FALLBACK!)
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_caller_org and proba = 585 and is_confirmed = true
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      select rate_per_gram into v_rate
      from public.daily_gold_rates
      where organization_id = v_caller_org and proba = 585
      order by rate_date desc, created_at desc
      limit 1;
    end if;
  end if;

  if (v_cash > 0 or v_usd > 0) and (v_rate is null or v_rate <= 0) then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Naqd pul yoki dollarni qabul qilish uchun 585 oltin kursi kiritilishi shart! Avval kunlik kursni belgilang.';
  end if;

  -- Sentinel rate for scrap-only to satisfy DB check constraint
  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0;
  end if;

  -- 3. USD rate determination (NO SILENT 12,850 FALLBACK!)
  if v_usd > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) to''lovini hisoblash uchun USD kursi (CBU yoki qo''lda) kiritilishi shart!';
    end if;

    -- USD -> UZS -> 585 Gold Grams
    v_usd_equiv := round(((v_usd * v_usd_rate) / v_rate)::numeric, 4);
  else
    v_usd_rate := null;
    v_usd_equiv := 0;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  else
    v_cash_equiv := 0;
  end if;

  -- 4. Total settled grams = scrap (in 585 eq) + UZS equiv + USD equiv
  v_total_settled := round(v_scrap_585_eq + v_cash_equiv + v_usd_equiv, 4);

  -- 5. Customer lookup
  select * into v_customer
  from public.customers
  where id = p_customer_id and organization_id = v_caller_org
  limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;

  -- 6. Seller lookup
  if p_seller_id is not null then
    select * into v_seller
    from public.employees
    where id = p_seller_id and organization_id = v_caller_org
    limit 1;
  elsif v_customer.seller_id is not null then
    select * into v_seller
    from public.employees
    where id = v_customer.seller_id and organization_id = v_caller_org
    limit 1;
  else
    select * into v_seller
    from public.employees
    where user_id = auth.uid() and organization_id = v_caller_org
    limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_client_settlement',
    'customer_id', p_customer_id,
    'scrap_weight', v_physical_scrap,
    'cash_amount', v_cash,
    'usd_amount', v_usd
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 7. Lock client gold account FOR UPDATE
  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = p_customer_id and organization_id = v_caller_org
  for update;

  if found then
    v_prev_debt := coalesce(v_client_acc.current_debt_grams, 0);
  else
    v_prev_debt := 0;
  end if;

  -- Debt reduction math
  if v_total_settled <= v_prev_debt then
    v_applied_to_debt := v_total_settled;
    v_excess_advance  := 0;
    v_rem_debt        := round((v_prev_debt - v_total_settled)::numeric, 4);
    v_new_advance     := coalesce(v_client_acc.advance_balance_grams, 0);
  else
    v_applied_to_debt := v_prev_debt;
    v_excess_advance  := round((v_total_settled - v_prev_debt)::numeric, 4);
    v_rem_debt        := 0;
    v_new_advance     := round((coalesce(v_client_acc.advance_balance_grams, 0) + v_excess_advance)::numeric, 4);
  end if;

  v_settle_no := 'SETTL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id, customer_id, sale_id,
    settlement_date, gold_rate_applied,
    scrap_weight_grams, physical_scrap_grams, scrap_proba, fine_gold_grams, scrap_585_equiv_grams,
    cash_paid_amount, currency, cash_equivalent_grams,
    usd_paid_amount, applied_usd_rate, usd_equivalent_grams,
    total_settled_grams, applied_to_debt_grams, excess_gold_grams,
    previous_debt_grams, remaining_debt_grams,
    status, notes, recorded_by, idempotency_key
  ) values (
    v_caller_org, v_settle_no, 'client_to_seller', v_seller.id, v_customer.id, p_sale_id,
    coalesce(p_settlement_date, current_date), v_rate,
    v_scrap_585_eq, v_physical_scrap, v_proba, v_fine_gold, v_scrap_585_eq,
    v_cash, 'UZS', v_cash_equiv,
    v_usd, v_usd_rate, v_usd_equiv,
    v_total_settled, v_applied_to_debt, v_excess_advance,
    v_prev_debt, v_rem_debt,
    'confirmed', p_notes, coalesce(public.current_employee_id(), v_seller.id), nullif(btrim(p_idempotency_key), '')
  ) returning id into v_settle_id;

  -- 8. Update client_gold_accounts atomically
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, 0,
    v_scrap_585_eq, v_cash, round(v_cash_equiv + v_usd_equiv, 4), v_total_settled,
    v_rem_debt, v_new_advance, now()
  )
  on conflict (customer_id) do update set
    total_scrap_paid_grams = round((client_gold_accounts.total_scrap_paid_grams + v_scrap_585_eq)::numeric, 4),
    total_cash_paid_amount = round((client_gold_accounts.total_cash_paid_amount + v_cash)::numeric, 2),
    total_cash_equiv_grams = round((client_gold_accounts.total_cash_equiv_grams + v_cash_equiv + v_usd_equiv)::numeric, 4),
    total_settled_grams    = round((client_gold_accounts.total_settled_grams + v_total_settled)::numeric, 4),
    current_debt_grams     = v_rem_debt,
    advance_balance_grams  = v_new_advance,
    updated_at             = now();

  -- 9. Update seller till with received scrap (PHYSICAL and 585 EQ), cash UZS and cash USD
  insert into public.seller_gold_accounts (
    seller_id, organization_id,
    seller_till_scrap_grams, seller_till_scrap_physical_g, seller_till_scrap_585_eq_g,
    seller_till_cash_amount, seller_till_usd_amount, updated_at
  ) values (
    v_seller.id, v_caller_org,
    v_scrap_585_eq, v_physical_scrap, v_scrap_585_eq,
    v_cash, v_usd, now()
  )
  on conflict (seller_id) do update set
    seller_till_scrap_grams        = round((seller_gold_accounts.seller_till_scrap_grams + v_scrap_585_eq)::numeric, 4),
    seller_till_scrap_physical_g   = round((coalesce(seller_gold_accounts.seller_till_scrap_physical_g, 0) + v_physical_scrap)::numeric, 4),
    seller_till_scrap_585_eq_g     = round((coalesce(seller_gold_accounts.seller_till_scrap_585_eq_g, 0) + v_scrap_585_eq)::numeric, 4),
    seller_till_cash_amount        = round((seller_gold_accounts.seller_till_cash_amount + v_cash)::numeric, 2),
    seller_till_usd_amount         = round((coalesce(seller_gold_accounts.seller_till_usd_amount, 0) + v_usd)::numeric, 2),
    updated_at                     = now();

  -- If linked to specific sale, update settled amount on sale
  if p_sale_id is not null then
    update public.jewelry_sales
    set settled_gold_grams = round((coalesce(settled_gold_grams, 0) + v_applied_to_debt)::numeric, 4),
        remaining_gold_grams = round(greatest(0, remaining_gold_grams - v_applied_to_debt)::numeric, 4),
        status = case
          when round(greatest(0, remaining_gold_grams - v_applied_to_debt)::numeric, 4) <= 0.0001 then 'fully_paid'
          else 'partially_paid'
        end,
        updated_at = now()
    where id = p_sale_id and organization_id = v_caller_org;
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'physical_scrap_grams', v_physical_scrap,
    'scrap_weight_grams', v_physical_scrap,
    'scrap_proba', v_proba,
    'fine_gold_grams', v_fine_gold,
    'scrap_585_equiv_grams', v_scrap_585_eq,
    'cash_paid_amount', v_cash,
    'usd_paid_amount', v_usd,
    'usd_rate_applied', v_usd_rate,
    'rate_applied', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'usd_equivalent_grams', v_usd_equiv,
    'total_settled_585_grams', v_total_settled,
    'total_settled_grams', v_total_settled,
    'previous_debt_grams', v_prev_debt,
    'applied_to_debt_grams', v_applied_to_debt,
    'excess_gold_advance_grams', v_excess_advance,
    'excess_gold_grams', v_excess_advance,
    'remaining_debt_grams', v_rem_debt,
    'advance_balance_grams', v_new_advance,
    'seller_id', v_seller.id,
    'customer_id', v_customer.id
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_settlement', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text, uuid, numeric, numeric) to authenticated;

-- 4. rpc_record_seller_to_manager_settlement (Multi-Currency with Dual Scrap Parity)
drop function if exists public.rpc_record_seller_to_manager_settlement(uuid, numeric, numeric, numeric, text, text, numeric, numeric);

create or replace function public.rpc_record_seller_to_manager_settlement(
  p_seller_id           uuid,
  p_scrap_weight_grams  numeric default 0, -- 585 equivalent grams surrendered
  p_cash_paid_amount    numeric default 0, -- UZS
  p_rate_per_gram       numeric default null, -- 585 gold rate
  p_notes               text default null,
  p_idempotency_key     text default null,
  p_usd_paid_amount     numeric default 0, -- USD
  p_usd_rate            numeric default null, -- USD exchange rate
  p_physical_scrap_g    numeric default null  -- Physical scale weight surrendered
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id          uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_rate            numeric(18, 2);
  v_usd_rate        numeric(18, 2);
  v_scrap_585_eq    numeric(14, 4);
  v_scrap_phys      numeric(14, 4);
  v_cash            numeric(18, 2);
  v_usd             numeric(18, 2);
  v_cash_equiv      numeric(14, 4) := 0;
  v_usd_equiv       numeric(14, 4) := 0;
  v_total_settled   numeric(14, 4);
  v_settle_no       text;
  v_settle_id       uuid;
  v_seller_acc      public.seller_gold_accounts%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_existing        jsonb;
  v_payload         jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

  v_scrap_585_eq := round(greatest(0, coalesce(p_scrap_weight_grams, 0))::numeric, 4);
  v_scrap_phys   := round(greatest(0, coalesce(p_physical_scrap_g, p_scrap_weight_grams, 0))::numeric, 4);
  v_cash := round(greatest(0, coalesce(p_cash_paid_amount, 0))::numeric, 2);
  v_usd  := round(greatest(0, coalesce(p_usd_paid_amount, 0))::numeric, 2);

  if v_scrap_585_eq <= 0 and v_cash <= 0 and v_usd <= 0 then
    raise exception 'Settlement must include either scrap gold grams, UZS cash, or USD cash';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_seller_to_manager_settlement',
    'seller_id', p_seller_id,
    'scrap_w', v_scrap_585_eq,
    'scrap_phys', v_scrap_phys,
    'cash', v_cash,
    'usd', v_usd
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_seller_to_manager_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. STRICT LOCK ORDER HIERARCHY: Lock Manager Vault FIRST
  perform public._get_or_create_manager_vault(v_org_id);

  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_org_id
  for update;

  -- 2. STRICT LOCK ORDER HIERARCHY: Lock Seller Gold Account SECOND
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id and organization_id = v_org_id
  for update;

  if not found then
    raise exception 'Sotuvchi oltin hisobi topilmadi: %', p_seller_id;
  end if;

  -- 3. HARD BALANCE CHECK (F03):
  if v_scrap_585_eq > 0 and v_seller_acc.seller_till_scrap_grams < v_scrap_585_eq then
    raise exception 'ERR_INSUFFICIENT_SCRAP_BALANCE: Sotuvchi kassasida yetarli lom mavjud emas (Kassada: % g, Talab: % g)',
      v_seller_acc.seller_till_scrap_grams, v_scrap_585_eq;
  end if;

  if v_cash > 0 and v_seller_acc.seller_till_cash_amount < v_cash then
    raise exception 'ERR_INSUFFICIENT_CASH_BALANCE: Sotuvchi kassasida yetarli naqd pul (UZS) mavjud emas (Kassada: % UZS, Talab: % UZS)',
      v_seller_acc.seller_till_cash_amount, v_cash;
  end if;

  if v_usd > 0 and coalesce(v_seller_acc.seller_till_usd_amount, 0) < v_usd then
    raise exception 'ERR_INSUFFICIENT_USD_BALANCE: Sotuvchi kassasida yetarli dollar (USD) mavjud emas (Kassada: % USD, Talab: % USD)',
      coalesce(v_seller_acc.seller_till_usd_amount, 0), v_usd;
  end if;

  -- 4. Gold Rate determination
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_org_id and proba = 585 and is_confirmed = true
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      select rate_per_gram into v_rate
      from public.daily_gold_rates
      where organization_id = v_org_id and proba = 585
      order by rate_date desc, created_at desc
      limit 1;
    end if;

    if (v_cash > 0 or v_usd > 0) and (v_rate is null or v_rate <= 0) then
      raise exception 'ERR_DAILY_RATE_NOT_SET: Bugungi 585 oltin kursi belgilanmagan! Naqd pul topshirish uchun avval kunlik kursni kiriting.';
    end if;
  end if;

  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0; -- Safe sentinel rate for DB check constraint (gold_rate_applied > 0) when cash is 0
  end if;

  -- 5. USD Rate determination
  if v_usd > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) topshirish uchun USD kursi kiritilishi shart!';
    end if;
    v_usd_equiv := round(((v_usd * v_usd_rate) / v_rate)::numeric, 4);
  else
    v_usd_rate := null;
    v_usd_equiv := 0;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  else
    v_cash_equiv := 0;
  end if;

  v_total_settled := round(v_scrap_585_eq + v_cash_equiv + v_usd_equiv, 4);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
    if v_caller_emp_id is null then
      v_caller_emp_id := p_seller_id;
    end if;
  end if;

  -- 6. Deduct exactly from seller till (both physical and 585 eq scrap)
  update public.seller_gold_accounts
  set seller_till_scrap_grams        = round(seller_till_scrap_grams - v_scrap_585_eq, 4),
      seller_till_scrap_585_eq_g     = round(greatest(0, coalesce(seller_till_scrap_585_eq_g, 0) - v_scrap_585_eq), 4),
      seller_till_scrap_physical_g   = round(greatest(0, coalesce(seller_till_scrap_physical_g, 0) - v_scrap_phys), 4),
      seller_till_cash_amount        = round(seller_till_cash_amount - v_cash, 2),
      seller_till_usd_amount         = round(coalesce(seller_till_usd_amount, 0) - v_usd, 2),
      updated_at = now()
  where seller_id = p_seller_id;

  -- 7. Add to manager vault (both physical and 585 eq scrap)
  update public.manager_vault_account
  set manager_scrap_grams        = round(manager_scrap_grams + v_scrap_585_eq, 4),
      manager_scrap_585_eq_g     = round(coalesce(manager_scrap_585_eq_g, 0) + v_scrap_585_eq, 4),
      manager_scrap_physical_g   = round(coalesce(manager_scrap_physical_g, 0) + v_scrap_phys, 4),
      manager_cash_amount        = round(manager_cash_amount + v_cash, 2),
      manager_usd_amount         = round(coalesce(manager_usd_amount, 0) + v_usd, 2),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  -- 8. Insert gold settlement
  v_settle_no := 'STL-MGR-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id,
    settlement_no,
    direction,
    seller_id,
    gold_rate_applied,
    scrap_weight_grams,
    physical_scrap_grams,
    scrap_proba,
    scrap_585_equiv_grams,
    cash_paid_amount,
    currency,
    cash_equivalent_grams,
    usd_paid_amount,
    applied_usd_rate,
    usd_equivalent_grams,
    total_settled_grams,
    applied_to_debt_grams,
    excess_gold_grams,
    previous_debt_grams,
    remaining_debt_grams,
    status,
    notes,
    recorded_by,
    idempotency_key
  ) values (
    v_org_id,
    v_settle_no,
    'seller_to_manager',
    p_seller_id,
    v_rate,
    v_scrap_585_eq,
    v_scrap_phys,
    585,
    v_scrap_585_eq,
    v_cash,
    'UZS',
    v_cash_equiv,
    v_usd,
    v_usd_rate,
    v_usd_equiv,
    v_total_settled,
    v_total_settled,
    0,
    coalesce(v_seller_acc.seller_owes_manager_g, v_seller_acc.current_factory_obligation_grams, 0),
    round(greatest(0, coalesce(v_seller_acc.seller_owes_manager_g, v_seller_acc.current_factory_obligation_grams, 0) - v_total_settled), 4),
    'confirmed',
    p_notes,
    v_caller_emp_id,
    p_idempotency_key
  ) returning id into v_settle_id;

  -- 9. Read synced seller gold account
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'scrap_grams_settled', v_scrap_585_eq,
    'scrap_weight_grams', v_scrap_585_eq,
    'scrap_physical_grams', v_scrap_phys,
    'cash_amount_settled', v_cash,
    'usd_amount_settled', v_usd,
    'applied_usd_rate', v_usd_rate,
    'applied_rate_per_gram', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'usd_equivalent_grams', v_usd_equiv,
    'total_settled_grams', v_total_settled,
    'remaining_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'seller_owes_manager_g', v_seller_acc.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'seller_till_scrap_grams', v_seller_acc.seller_till_scrap_grams,
    'seller_till_scrap_physical_g', v_seller_acc.seller_till_scrap_physical_g,
    'seller_till_cash_amount', v_seller_acc.seller_till_cash_amount,
    'seller_till_usd_amount', v_seller_acc.seller_till_usd_amount,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_scrap_physical_g', v_vault.manager_scrap_physical_g,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_seller_to_manager_settlement', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_seller_to_manager_settlement(uuid, numeric, numeric, numeric, text, text, numeric, numeric, numeric) to authenticated;

-- 5. rpc_reverse_seller_to_manager_settlement (Upgraded Reversal for Dual Scrap Parity)
create or replace function public.rpc_reverse_seller_to_manager_settlement(
  p_settlement_id   uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org       uuid := public.current_organization_id();
  v_caller_emp_id    uuid := public.current_employee_id();
  v_clean_reason     text := nullif(btrim(p_reason), '');
  v_settle           public.gold_settlements%rowtype;
  v_vault            public.manager_vault_account%rowtype;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_comp_settle_no   text;
  v_comp_settle_id   uuid;
  v_payload          jsonb;
  v_existing         jsonb;
  v_usd              numeric(18, 2);
  v_scrap_phys       numeric(14, 4);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Tushumni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_seller_to_manager_settlement',
    'settlement_id', p_settlement_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_seller_to_manager_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. STRICT LOCK ORDER HIERARCHY: Lock Manager Vault FIRST
  perform public._get_or_create_manager_vault(v_caller_org);

  select * into v_vault
    from public.manager_vault_account
   where organization_id = v_caller_org
   for update;

  -- 2. Inspect settlement record
  select * into v_settle
    from public.gold_settlements
   where id = p_settlement_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Tushum kvitansiyasi topilmadi (%)', p_settlement_id;
  end if;

  if v_settle.direction <> 'seller_to_manager' then
    raise exception 'Ushbu operatsiya orqali faqat boshqaruvchi qabulini bekor qilish mumkin';
  end if;

  if v_settle.status = 'reversed' then
    raise exception 'Ushbu tushum kvitansiyasi allaqachon bekor qilingan (%s)', v_settle.settlement_no;
  end if;

  v_usd := coalesce(v_settle.usd_paid_amount, 0);
  v_scrap_phys := coalesce(v_settle.physical_scrap_grams, v_settle.scrap_weight_grams, 0);

  -- 3. STRICT LOCK ORDER HIERARCHY: Lock Seller Gold Account SECOND
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id and organization_id = v_caller_org
   for update;

  if v_settle.scrap_weight_grams > 0 and v_vault.manager_scrap_grams < v_settle.scrap_weight_grams then
    raise exception 'Boshqaruvchi seyfida yetarli lom mavjud emas (Seyfda: % g, talab: % g). Lom allaqachon affinajga yoki zavodga yuborilgan.',
      v_vault.manager_scrap_grams, v_settle.scrap_weight_grams;
  end if;

  if v_settle.cash_paid_amount > 0 and v_vault.manager_cash_amount < v_settle.cash_paid_amount then
    raise exception 'Boshqaruvchi seyfida yetarli naqd pul (UZS) mavjud emas (Seyfda: % UZS, talab: % UZS).',
      v_vault.manager_cash_amount, v_settle.cash_paid_amount;
  end if;

  if v_usd > 0 and coalesce(v_vault.manager_usd_amount, 0) < v_usd then
    raise exception 'Boshqaruvchi seyfida yetarli dollar (USD) mavjud emas (Seyfda: % USD, talab: % USD).',
      coalesce(v_vault.manager_usd_amount, 0), v_usd;
  end if;

  -- 4. Deduct scrap, UZS & USD from manager vault
  update public.manager_vault_account
     set manager_scrap_grams      = round(manager_scrap_grams - v_settle.scrap_weight_grams, 4),
         manager_scrap_585_eq_g   = round(greatest(0, coalesce(manager_scrap_585_eq_g, 0) - v_settle.scrap_weight_grams), 4),
         manager_scrap_physical_g = round(greatest(0, coalesce(manager_scrap_physical_g, 0) - v_scrap_phys), 4),
         manager_cash_amount      = round(manager_cash_amount - v_settle.cash_paid_amount, 2),
         manager_usd_amount       = round(coalesce(manager_usd_amount, 0) - v_usd, 2),
         updated_at               = now()
   where organization_id = v_caller_org
  returning * into v_vault;

  -- 5. Return scrap, UZS & USD to seller till
  update public.seller_gold_accounts
     set seller_till_scrap_grams        = round(seller_till_scrap_grams + v_settle.scrap_weight_grams, 4),
         seller_till_scrap_585_eq_g     = round(coalesce(seller_till_scrap_585_eq_g, 0) + v_settle.scrap_weight_grams, 4),
         seller_till_scrap_physical_g   = round(coalesce(seller_till_scrap_physical_g, 0) + v_scrap_phys, 4),
         seller_till_cash_amount        = round(seller_till_cash_amount + v_settle.cash_paid_amount, 2),
         seller_till_usd_amount         = round(coalesce(seller_till_usd_amount, 0) + v_usd, 2),
         updated_at                     = now()
   where seller_id = v_settle.seller_id;

  -- 6. Mark original settlement as reversed
  update public.gold_settlements
     set status          = 'reversed',
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = v_settle.id;

  -- 7. Insert compensating record with explicit reversal link
  v_comp_settle_no := 'STL-REV-MGR-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id,
    gold_rate_applied, scrap_weight_grams, physical_scrap_grams, scrap_585_equiv_grams,
    cash_paid_amount, cash_equivalent_grams,
    usd_paid_amount, applied_usd_rate, usd_equivalent_grams,
    total_settled_grams, status, reversal_of_id, reversal_reason,
    previous_debt_grams, remaining_debt_grams,
    notes, recorded_by
  ) values (
    v_caller_org, v_comp_settle_no, 'seller_to_manager', v_settle.seller_id,
    v_settle.gold_rate_applied, v_settle.scrap_weight_grams, v_scrap_phys, v_settle.scrap_weight_grams,
    v_settle.cash_paid_amount, coalesce(v_settle.cash_equivalent_grams, 0),
    v_usd, v_settle.applied_usd_rate, coalesce(v_settle.usd_equivalent_grams, 0),
    v_settle.total_settled_grams, 'reversed', v_settle.id, v_clean_reason,
    coalesce(v_settle.remaining_debt_grams, 0), coalesce(v_settle.previous_debt_grams, 0),
    'KOMPENSATSIYA: Boshqaruvchi tushumi ' || v_settle.settlement_no || ' bekor qilindi. Sabab: ' || v_clean_reason, v_caller_emp_id
  ) returning id into v_comp_settle_id;

  -- 8. Audit log
  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (
      organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
    ) values (
      v_caller_org, 'gold_settlements', v_settle.id::text, 'REVERSE_MANAGER_SETTLEMENT', auth.uid(),
      jsonb_build_object(
        'settlement_no', v_settle.settlement_no,
        'scrap_weight_g', v_settle.scrap_weight_grams,
        'cash_paid_uzs', v_settle.cash_paid_amount,
        'usd_paid', v_usd,
        'seller_id', v_settle.seller_id
      ),
      jsonb_build_object(
        'original_status', 'reversed',
        'compensating_settle_no', v_comp_settle_no
      ),
      v_clean_reason
    );
  end if;

  -- 9. Read back restored seller account
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'reversal_id', v_comp_settle_id,
    'reversal_no', v_comp_settle_no,
    'original_settlement_no', v_settle.settlement_no,
    'scrap_returned_grams', v_settle.scrap_weight_grams,
    'scrap_physical_returned_grams', v_scrap_phys,
    'cash_returned_amount', v_settle.cash_paid_amount,
    'usd_returned_amount', v_usd,
    'restored_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'seller_till_scrap_grams', v_seller_acc.seller_till_scrap_grams,
    'seller_till_scrap_physical_g', v_seller_acc.seller_till_scrap_physical_g,
    'seller_till_cash_amount', v_seller_acc.seller_till_cash_amount,
    'seller_till_usd_amount', v_seller_acc.seller_till_usd_amount,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_seller_to_manager_settlement', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_seller_to_manager_settlement(uuid, text, text) to authenticated;

-- 6. Multi-Currency rpc_record_gold_purchase (UZS or USD from Manager Vault)
drop function if exists public.rpc_record_gold_purchase(text, numeric, numeric, numeric, numeric, text, text);
drop function if exists public.rpc_record_gold_purchase(text, numeric, numeric, numeric, numeric, text, text, text, numeric);

create or replace function public.rpc_record_gold_purchase(
  p_supplier_name     text,
  p_cash_spent_uzs    numeric default 0,
  p_rate_per_gram     numeric default null,
  p_gold_weight_grams numeric default null,
  p_proba             numeric default 585.0,
  p_notes             text default null,
  p_idempotency_key   text default null,
  p_currency          text default 'UZS',
  p_usd_spent         numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id         uuid := public.current_organization_id();
  v_emp_id         uuid := public.current_employee_id();
  v_currency       text := upper(coalesce(nullif(btrim(p_currency), ''), 'UZS'));
  v_cash_spent     numeric(18, 2);
  v_usd_spent      numeric(18, 2);
  v_rate           numeric(18, 2);
  v_gold_w         numeric(14, 4);
  v_pr             numeric(6, 2);
  v_equiv_585      numeric(14, 4);
  v_purch_no       text;
  v_purch_id       uuid;
  v_vault          public.manager_vault_account;
  v_existing       jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_emp_id is null then
    select id into v_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'inventory_manager', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if v_currency not in ('UZS', 'USD') then
    raise exception 'Noto''g''ri valyuta: % (ruxsat: UZS, USD)', v_currency;
  end if;

  v_cash_spent := round(greatest(0, coalesce(p_cash_spent_uzs, 0))::numeric, 2);
  v_usd_spent  := round(greatest(0, coalesce(p_usd_spent, 0))::numeric, 2);
  v_rate       := round(greatest(0, coalesce(p_rate_per_gram, 0))::numeric, 2);
  v_gold_w     := round(greatest(0, coalesce(p_gold_weight_grams, 0))::numeric, 4);
  v_pr         := round(coalesce(p_proba, 585.0)::numeric, 2);

  if v_currency = 'UZS' and v_cash_spent <= 0 then
    raise exception 'UZS xaridi uchun sarflangan naqd pul summasi 0 dan katta bo''lishi shart';
  end if;

  if v_currency = 'USD' and v_usd_spent <= 0 then
    raise exception 'USD xaridi uchun sarflangan dollar summasi 0 dan katta bo''lishi shart';
  end if;

  if v_gold_w <= 0 then
    raise exception 'Oltin vazni 0 dan katta bo''lishi shart';
  end if;

  if v_rate <= 0 then
    if v_currency = 'UZS' and v_cash_spent > 0 and v_gold_w > 0 then
      v_rate := round((v_cash_spent / v_gold_w)::numeric, 2);
    elsif v_currency = 'USD' and v_usd_spent > 0 and v_gold_w > 0 then
      v_rate := round((v_usd_spent / v_gold_w)::numeric, 2);
    else
      raise exception '1 gramm oltin kursi 0 dan katta bo''lishi shart';
    end if;
  end if;

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'purchase_id', id,
      'purchase_no', purchase_no,
      'gold_weight_grams', gold_weight_grams,
      'equiv_585_grams', equiv_585_grams,
      'currency', currency
    ) into v_existing
    from public.gold_purchases
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_equiv_585 := round(v_gold_w * (v_pr / 585.0), 4);

  -- Check and lock manager vault
  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  if v_currency = 'UZS' then
    if v_vault.manager_cash_amount < v_cash_spent then
      raise exception 'ERR_INSUFFICIENT_VAULT_CASH: Boshqaruvchi seyfida yetarli naqd pul (UZS) mavjud emas (Mavjud: % UZS, Talab: % UZS)',
        v_vault.manager_cash_amount, v_cash_spent;
    end if;

    update public.manager_vault_account
    set manager_cash_amount = round(manager_cash_amount - v_cash_spent, 2),
        manager_purchased_gold_grams = round(manager_purchased_gold_grams + v_equiv_585, 4),
        updated_at = now()
    where organization_id = v_org_id
    returning * into v_vault;

  else -- USD
    if coalesce(v_vault.manager_usd_amount, 0) < v_usd_spent then
      raise exception 'ERR_INSUFFICIENT_VAULT_USD: Boshqaruvchi seyfida yetarli valyuta (USD) mavjud emas (Mavjud: % USD, Talab: % USD)',
        coalesce(v_vault.manager_usd_amount, 0), v_usd_spent;
    end if;

    update public.manager_vault_account
    set manager_usd_amount = round(coalesce(manager_usd_amount, 0) - v_usd_spent, 2),
        manager_purchased_gold_grams = round(manager_purchased_gold_grams + v_equiv_585, 4),
        updated_at = now()
    where organization_id = v_org_id
    returning * into v_vault;
  end if;

  v_purch_no := 'BUY-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_purchases (
    organization_id,
    purchase_no,
    supplier_name,
    cash_spent_uzs,
    usd_spent,
    currency,
    rate_per_gram,
    gold_weight_grams,
    proba,
    equiv_585_grams,
    notes,
    idempotency_key,
    recorded_by
  ) values (
    v_org_id,
    v_purch_no,
    p_supplier_name,
    case when v_currency = 'UZS' then v_cash_spent else 0 end,
    case when v_currency = 'USD' then v_usd_spent else 0 end,
    v_currency,
    v_rate,
    v_gold_w,
    v_pr,
    v_equiv_585,
    p_notes,
    p_idempotency_key,
    v_emp_id
  ) returning id into v_purch_id;

  return jsonb_build_object(
    'status', 'ok',
    'purchase_id', v_purch_id,
    'purchase_no', v_purch_no,
    'currency', v_currency,
    'cash_spent_uzs', case when v_currency = 'UZS' then v_cash_spent else 0 end,
    'usd_spent', case when v_currency = 'USD' then v_usd_spent else 0 end,
    'rate_per_gram', v_rate,
    'gold_weight_grams', v_gold_w,
    'proba', v_pr,
    'equiv_585_grams', v_equiv_585,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount,
    'manager_purchased_gold_grams', v_vault.manager_purchased_gold_grams
  );
end;
$$;

grant execute on function public.rpc_record_gold_purchase(text, numeric, numeric, numeric, numeric, text, text, text, numeric) to authenticated;

-- 7. rpc_issue_barcode_consignment (Strict Manager Stock Availability Guard)
create or replace function public.rpc_issue_barcode_consignment(
  p_seller_id           uuid,
  p_factory_markup_pct  numeric,
  p_pieces              jsonb,
  p_notes               text default null,
  p_idempotency_key     text default null,
  p_factory_receipt_id  uuid default null,
  p_seller_markup_pct   numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_factory_pct       numeric(6, 2) := round(coalesce(p_factory_markup_pct, 0)::numeric, 2);
  v_seller_pct        numeric(6, 2);
  v_total_base_weight numeric(14, 4) := 0;
  v_total_qty         integer := 0;
  v_factory_due       numeric(14, 4) := 0;
  v_seller_due        numeric(14, 4) := 0;
  v_consignment_id    uuid;
  v_consignment_no    text;
  v_piece_elem        jsonb;
  v_piece_id          uuid;
  v_model_id          uuid;
  v_model_code        text;
  v_model_name        text;
  v_category          text;
  v_purity            numeric(6, 2);
  v_weight            numeric(14, 4);
  v_raw_barcode       text;
  v_piece_seller_obl  numeric(14, 4);
  v_inserted_pieces   jsonb := '[]'::jsonb;
  v_payload           jsonb;
  v_existing          jsonb;
  v_receipt_id        uuid := p_factory_receipt_id;
  v_receipt_rec       record;
  v_avail_mgr_stock   numeric(14, 4);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'inventory_manager', 'boshqaruvchi'
  ]);

  if jsonb_array_length(p_pieces) = 0 then
    raise exception 'Kamida 1 ta mahsulot dona skaner qilinishi shart';
  end if;

  if v_factory_pct < 0 then
    raise exception 'Zavod ustama foizi manfiy bo''lishi mumkin emas';
  end if;

  if p_seller_markup_pct is not null and p_seller_markup_pct >= 0 then
    v_seller_pct := round(p_seller_markup_pct::numeric, 2);
  else
    v_seller_pct := 12.00;
  end if;

  v_payload := jsonb_build_object(
    'action', 'issue_barcode_consignment',
    'seller_id', p_seller_id,
    'factory_markup_pct', v_factory_pct,
    'seller_markup_pct', v_seller_pct,
    'piece_count', jsonb_array_length(p_pieces),
    'factory_receipt_id', p_factory_receipt_id
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_issue_barcode_consignment', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_seller
    from public.employees
   where id = p_seller_id
     and organization_id = v_caller_org
   limit 1;
  if not found then
    raise exception 'Sotuvchi (xodim %) topilmadi', p_seller_id;
  end if;

  for v_piece_elem in select * from jsonb_array_elements(p_pieces) loop
    v_weight := round(coalesce((v_piece_elem->>'weight_grams')::numeric, 0), 4);
    if v_weight <= 0 or v_weight > 1000.0 then
      raise exception 'Noto''g''ri mahsulot vazni aniqlandi: % g (ruxsat: 0.05g - 1000g)', v_weight;
    end if;
    v_total_base_weight := v_total_base_weight + v_weight;
    v_total_qty := v_total_qty + 1;
  end loop;

  v_total_base_weight := round(v_total_base_weight, 4);

  -- Non-compounding: Both calculated strictly from the same base weight!
  v_factory_due := round((v_total_base_weight * (1.0 + v_factory_pct / 100.0))::numeric, 4);
  v_seller_due  := round((v_total_base_weight * (1.0 + v_seller_pct / 100.0))::numeric, 4);

  -- Deduct manager's physical stock from factory_receipt
  if v_receipt_id is not null then
    select * into v_receipt_rec
    from public.factory_receipts
    where id = v_receipt_id and organization_id = v_caller_org
    for update;

    if not found then
      raise exception 'Belgilangan zavod kirim hujjati (%) topilmadi', v_receipt_id;
    end if;

    if v_receipt_rec.available_physical_g < v_total_base_weight then
      raise exception 'Menejer omborida yetarli tovar yo''q: mavjud % g, talab qilindi % g',
        v_receipt_rec.available_physical_g, v_total_base_weight;
    end if;

    update public.factory_receipts
       set available_physical_g = round(available_physical_g - v_total_base_weight, 4),
           transferred_physical_g = round(transferred_physical_g + v_total_base_weight, 4),
           status = case
             when round(available_physical_g - v_total_base_weight, 4) <= 0.0001 then 'fully_transferred'
             else 'partially_transferred'
           end,
           updated_at = now()
     where id = v_receipt_id;
  else
    -- Find available factory receipt FIFO
    select id into v_receipt_id
    from public.factory_receipts
    where organization_id = v_caller_org
      and available_physical_g >= v_total_base_weight
      and status <> 'reversed'
    order by receipt_date asc, created_at asc
    limit 1
    for update;

    if v_receipt_id is not null then
      update public.factory_receipts
         set available_physical_g = round(available_physical_g - v_total_base_weight, 4),
             transferred_physical_g = round(transferred_physical_g + v_total_base_weight, 4),
             status = case
               when round(available_physical_g - v_total_base_weight, 4) <= 0.0001 then 'fully_transferred'
               else 'partially_transferred'
             end,
             updated_at = now()
       where id = v_receipt_id;
    else
      -- Check total available manager stock
      v_avail_mgr_stock := public.get_manager_available_stock_grams(v_caller_org);
      if v_avail_mgr_stock < v_total_base_weight then
        raise exception 'ERR_INSUFFICIENT_MANAGER_STOCK: Menejer omborida yetarli tovar yo''q (Mavjud: % g, Talab qilindi: % g)',
          v_avail_mgr_stock, v_total_base_weight;
      end if;
    end if;
  end if;

  v_consignment_no := 'CONS-BC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.seller_consignments (
    organization_id, consignment_no, seller_id,
    product_name, quantity, base_weight_grams, proba,
    factory_markup_pct, factory_gold_due_grams, factory_remaining_gold_grams,
    seller_obligation_g, status, notes
  ) values (
    v_caller_org, v_consignment_no, p_seller_id,
    'Skanerlangan partiya (' || v_total_qty || ' dona)',
    v_total_qty, v_total_base_weight, 585.00,
    v_factory_pct, v_factory_due, v_factory_due,
    v_seller_due, 'held_by_seller', p_notes
  ) returning id into v_consignment_id;

  for v_piece_elem in select * from jsonb_array_elements(p_pieces) loop
    v_model_id    := case when (v_piece_elem->>'model_id') is not null and (v_piece_elem->>'model_id') <> '' then (v_piece_elem->>'model_id')::uuid else null end;
    v_model_code  := coalesce(v_piece_elem->>'model_code', 'MODEL-BC');
    v_model_name  := coalesce(v_piece_elem->>'model_name', 'Skaner Mahsuloti');
    v_category    := v_piece_elem->>'category';
    v_purity      := round(coalesce((v_piece_elem->>'purity')::numeric, 585.0), 2);
    v_weight      := round((v_piece_elem->>'weight_grams')::numeric, 4);
    v_raw_barcode := v_piece_elem->>'raw_barcode';
    v_piece_seller_obl := round((v_weight * (1.0 + v_seller_pct / 100.0))::numeric, 4);

    insert into public.consignment_pieces (
      id, organization_id, consignment_id, seller_id, model_id, model_code,
      model_name, category, purity, weight_grams, raw_barcode, notes,
      seller_markup_pct, seller_obligation_grams,
      status
    ) values (
      gen_random_uuid(), v_caller_org, v_consignment_id, p_seller_id, v_model_id, v_model_code,
      v_model_name, v_category, v_purity, v_weight, v_raw_barcode, p_notes,
      v_seller_pct, v_piece_seller_obl,
      'held_by_seller'
    ) returning id into v_piece_id;

    v_inserted_pieces := v_inserted_pieces || jsonb_build_object(
      'piece_id', v_piece_id,
      'model_code', v_model_code,
      'weight_grams', v_weight
    );
  end loop;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'consignment_id', v_consignment_id,
    'consignment_no', v_consignment_no,
    'total_pieces', v_total_qty,
    'base_weight_grams', v_total_base_weight,
    'factory_markup_pct', v_factory_pct,
    'seller_markup_pct', v_seller_pct,
    'factory_gold_due_grams', v_factory_due,
    'seller_obligation_g', v_seller_due,
    'pieces', v_inserted_pieces
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_issue_barcode_consignment', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_issue_barcode_consignment to authenticated;

-- 8. rpc_record_barcode_piece_sale (Seller Available Physical Stock Check)
create or replace function public.rpc_record_barcode_piece_sale(
  p_customer_id         uuid,
  p_seller_id           uuid default null,
  p_piece_id            uuid default null,
  p_model_id            uuid default null,
  p_weight_grams        numeric default null,
  p_client_markup_pct   numeric default 12.0,
  p_notes               text default null,
  p_idempotency_key     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_caller_emp_id     uuid := public.current_employee_id();
  v_caller_role       text := public.current_employee_role_text();
  v_seller            public.employees%rowtype;
  v_customer          public.customers%rowtype;
  v_piece             public.consignment_pieces%rowtype;
  v_consign           public.seller_consignments%rowtype;
  v_client_acc        public.client_gold_accounts%rowtype;
  v_client_pct        numeric(6, 2) := round(coalesce(p_client_markup_pct, 12.0)::numeric, 2);
  v_base_w            numeric(14, 4);
  v_factory_due       numeric(14, 4);
  v_client_due        numeric(14, 4);
  v_spread            numeric(14, 4);
  v_avail_adv         numeric(14, 4) := 0;
  v_apply_adv         numeric(14, 4) := 0;
  v_net_rem_due       numeric(14, 4);
  v_sale_id           uuid;
  v_sale_no           text;
  v_remaining_pieces  integer;
  v_existing          jsonb;
  v_avail_stock       numeric(14, 4);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'sale_id', id,
      'sale_no', sale_no,
      'client_gold_due_grams', client_gold_due_grams,
      'gross_gold_due_grams', client_gold_due_grams,
      'advance_applied_grams', settled_gold_grams,
      'net_remaining_debt_grams', remaining_gold_grams,
      'remaining_gold_grams', remaining_gold_grams
    ) into v_existing
    from public.jewelry_sales
    where idempotency_key = p_idempotency_key and organization_id = v_caller_org;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  -- Determine seller
  if p_seller_id is not null then
    select * into v_seller
      from public.employees
     where id = p_seller_id
       and organization_id = v_caller_org
     limit 1;
  elsif v_caller_emp_id is not null then
    select * into v_seller
      from public.employees
     where id = v_caller_emp_id
       and organization_id = v_caller_org
     limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi') then
    if v_seller.id <> v_caller_emp_id then
      raise exception 'Boshqa sotuvchining mahsulotini sotish huquqingiz yo''q' using errcode = '42501';
    end if;
  end if;

  select * into v_customer
    from public.customers
   where id = p_customer_id
     and organization_id = v_caller_org
   limit 1;
  if not found then
    raise exception 'Mijoz topilmadi';
  end if;

  -- Locate piece with FOR UPDATE lock
  if p_piece_id is not null then
    select * into v_piece
      from public.consignment_pieces
     where id = p_piece_id
       and seller_id = v_seller.id
       and organization_id = v_caller_org
     for update;
  elsif p_model_id is not null and p_weight_grams is not null then
    select cp.* into v_piece
      from public.consignment_pieces cp
      join public.seller_consignments sc on sc.id = cp.consignment_id
     where cp.model_id = p_model_id
       and cp.weight_grams = round(p_weight_grams::numeric, 4)
       and cp.seller_id = v_seller.id
       and cp.status = 'held_by_seller'
       and cp.sale_id is null
       and sc.status not in ('fully_sold', 'returned_to_manager', 'cancelled')
       and coalesce(sc.sold_quantity, 0) < sc.quantity
       and cp.organization_id = v_caller_org
     order by cp.created_at asc
     limit 1
     for update of cp;
  else
    raise exception 'Mahsulot donasini aniqlash uchun piece_id yoki (model_id + weight_grams) talab qilinadi';
  end if;

  if not found or v_piece.id is null then
    raise exception 'Tanlangan mahsulot donasi sotuvchi omborida mavjud emas yoki allaqachon sotilgan';
  end if;

  if v_piece.sale_id is not null or v_piece.status = 'sold' then
    raise exception 'Bu mahsulot donasi (% — % g) allaqachon sotilgan (Sotuv ID: %)',
      v_piece.model_code, v_piece.weight_grams, coalesce(v_piece.sale_id::text, 'MAVJUD');
  end if;

  if v_piece.status <> 'held_by_seller' then
    raise exception 'Mahsulot sotuvga yaroqsiz holatda (Joriy holat: %)', v_piece.status;
  end if;

  v_base_w := v_piece.weight_grams;

  -- CHECK SELLER AVAILABLE PHYSICAL STOCK (Prevents selling piece if weight sales already consumed stock)
  v_avail_stock := public.get_seller_available_stock_grams(v_seller.id);
  if v_avail_stock < v_base_w then
    raise exception 'ERR_INSUFFICIENT_SELLER_STOCK: Sotuvchi omborida yetarli fizik oltin qolmagan (Mavjud: % g, Talab: % g). Avvalgi vazn savdolari ushbu oltinni sarflagan.',
      v_avail_stock, v_base_w;
  end if;

  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;

  if not found then
    raise exception 'Konsignatsiya yozuvi topilmadi';
  end if;

  if v_consign.status in ('fully_sold', 'returned_to_manager', 'cancelled') or coalesce(v_consign.sold_quantity, 0) >= coalesce(v_consign.quantity, 0) then
    raise exception 'Tarixiy ziddiyat: Ushbu dona mansub bo''lgan partiya (%) allaqachon to''liq sotilgan yoki bekor qilingan (Sotilgan: %/%)',
      v_consign.consignment_no, coalesce(v_consign.sold_quantity, 0), v_consign.quantity;
  end if;

  v_factory_due := round((v_base_w * (1.0 + v_consign.factory_markup_pct / 100.0))::numeric, 4);
  v_client_due  := round((v_base_w * (1.0 + v_client_pct / 100.0))::numeric, 4);
  v_spread      := round((v_client_due - v_factory_due)::numeric, 4);

  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_customer.id
     and organization_id = v_caller_org
   for update;

  v_avail_adv := coalesce(v_client_acc.advance_balance_grams, 0);
  if v_avail_adv > 0 then
    v_apply_adv   := round(least(v_avail_adv, v_client_due)::numeric, 4);
    v_net_rem_due := round((v_client_due - v_apply_adv)::numeric, 4);
  else
    v_apply_adv   := 0;
    v_net_rem_due := v_client_due;
  end if;

  v_sale_no := 'SALE-BC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.jewelry_sales (
    organization_id, sale_no, seller_id, customer_id, consignment_id,
    model_id, model_code, model_name, category, purity,
    base_weight_grams, factory_gold_due_grams, client_markup_pct,
    client_gold_due_grams, seller_profit_spread_grams, settled_gold_grams,
    remaining_gold_grams, status, sale_type, notes
  ) values (
    v_caller_org, v_sale_no, v_seller.id, v_customer.id, v_consign.id,
    v_piece.model_id, v_piece.model_code, v_piece.model_name, v_piece.category, v_piece.purity,
    v_base_w, v_factory_due, v_client_pct,
    v_client_due, v_spread, v_apply_adv,
    v_net_rem_due,
    case when v_net_rem_due <= 0.0001 then 'fully_paid' else 'unpaid' end,
    'piece', p_notes
  ) returning id into v_sale_id;

  update public.consignment_pieces
     set status = 'sold',
         sale_id = v_sale_id,
         sold_at = now(),
         updated_at = now()
   where id = v_piece.id;

  select count(*) into v_remaining_pieces
    from public.consignment_pieces
   where consignment_id = v_consign.id
     and status = 'held_by_seller';

  update public.seller_consignments
     set sold_quantity = coalesce(sold_quantity, 0) + 1,
         factory_remaining_gold_grams = round(greatest(0, coalesce(factory_remaining_gold_grams, factory_gold_due_grams) - v_factory_due)::numeric, 4),
         status = case
           when v_remaining_pieces = 0 then 'fully_sold'
           else 'partially_sold'
         end,
         updated_at = now()
   where id = v_consign.id;

  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id,
    total_purchased_gold_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id,
    v_client_due, v_apply_adv,
    v_net_rem_due, round(greatest(0, v_avail_adv - v_apply_adv)::numeric, 4), now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_due)::numeric, 4),
    total_settled_grams        = round((client_gold_accounts.total_settled_grams + v_apply_adv)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_net_rem_due)::numeric, 4),
    advance_balance_grams      = round(greatest(0, client_gold_accounts.advance_balance_grams - v_apply_adv)::numeric, 4),
    updated_at                 = now();

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'client_gold_due_grams', v_client_due,
    'gross_gold_due_grams', v_client_due,
    'advance_applied_grams', v_apply_adv,
    'net_remaining_debt_grams', v_net_rem_due,
    'remaining_gold_grams', v_net_rem_due,
    'remaining_pieces_in_consignment', v_remaining_pieces,
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_barcode_piece_sale', v_existing, v_existing);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_barcode_piece_sale to authenticated;

-- 9. rpc_record_refining_batch (Proper Operator Employee Resolution)
create or replace function public.rpc_record_refining_batch(
  p_input_scrap_grams       numeric,
  p_melted_weight_grams     numeric,
  p_output_fine_grams       numeric,
  p_output_fine_proba       numeric default 995.0,
  p_operator_id             uuid default null,
  p_notes                   text default null,
  p_idempotency_key         text default null,
  p_physical_scrap_grams    numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id         uuid := public.current_organization_id();
  v_emp_id         uuid := coalesce(p_operator_id, public.current_employee_id());
  v_in_w           numeric(14, 4);
  v_melt_w         numeric(14, 4);
  v_out_fine_g     numeric(14, 4);
  v_out_proba      numeric(6, 2);
  v_out_585_eq     numeric(14, 4);
  v_loss_g         numeric(14, 4);
  v_loss_pct       numeric(6, 3);
  v_batch_no       text;
  v_batch_id       uuid;
  v_vault          public.manager_vault_account;
  v_existing       jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'inventory_manager'
  ]);

  if v_emp_id is null then
    select id into v_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
  end if;

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

  v_in_w := round(coalesce(p_input_scrap_grams, 0)::numeric, 4);
  v_melt_w := round(coalesce(p_melted_weight_grams, 0)::numeric, 4);
  v_out_fine_g := round(coalesce(p_output_fine_grams, 0)::numeric, 4);
  v_out_proba := round(coalesce(p_output_fine_proba, 995.0)::numeric, 2);

  if v_in_w <= 0 or v_melt_w <= 0 or v_out_fine_g <= 0 then
    raise exception 'Invalid refining inputs: input scrap, melted weight and output fine gold must be > 0';
  end if;

  if v_melt_w > v_in_w then
    raise exception 'Physical anomaly: melted weight cannot exceed input scrap weight';
  end if;

  v_out_585_eq := round(v_out_fine_g * (v_out_proba / 585.0), 4);
  v_loss_g := round(greatest(0, v_in_w - v_out_585_eq), 4);
  v_loss_pct := round(((v_loss_g / v_in_w) * 100.0), 3);

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  if v_vault.manager_scrap_grams < v_in_w then
    raise exception 'Yetarli lom oltin yo''q: mavjud % g, talab qilindi % g',
      v_vault.manager_scrap_grams, v_in_w;
  end if;

  -- Deduct scrap, add refined fine gold and 585 equivalent. Loss is borne exclusively by manager!
  update public.manager_vault_account
  set manager_scrap_grams = round(manager_scrap_grams - v_in_w, 4),
      manager_scrap_585_eq_g = round(greatest(0, coalesce(manager_scrap_585_eq_g, 0) - v_in_w), 4),
      manager_scrap_physical_g = round(greatest(0, coalesce(manager_scrap_physical_g, 0) - coalesce(p_physical_scrap_grams, v_in_w)), 4),
      manager_refined_gold_grams = round(manager_refined_gold_grams + v_out_585_eq, 4),
      manager_refined_gold_fine_grams = round(coalesce(manager_refined_gold_fine_grams, 0) + v_out_fine_g, 4),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  v_batch_no := 'REF-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.refining_batches (
    organization_id, batch_no, input_scrap_grams, melted_weight_grams,
    output_fine_grams, output_fine_proba, output_585_equiv_grams,
    total_loss_grams, loss_pct, operator_id, status, notes, idempotency_key
  ) values (
    v_org_id, v_batch_no, v_in_w, v_melt_w,
    v_out_fine_g, v_out_proba, v_out_585_eq,
    v_loss_g, v_loss_pct, v_emp_id, 'completed', p_notes, p_idempotency_key
  ) returning id into v_batch_id;

  return jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch_id,
    'batch_no', v_batch_no,
    'input_scrap_grams', v_in_w,
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

grant execute on function public.rpc_record_refining_batch(numeric, numeric, numeric, numeric, uuid, text, text, numeric) to authenticated;

-- 10. rpc_record_factory_gold_handover (Proper Recorded_By Employee Resolution)
create or replace function public.rpc_record_factory_gold_handover(
  p_source_type         text default 'refined_gold',
  p_physical_weight_g   numeric default null,
  p_proba               numeric default 585.0,
  p_agreed_equivalent_g numeric default null,
  p_factory_recipient   text default 'Zavod',
  p_notes               text default null,
  p_idempotency_key     text default null,
  p_gross_weight_grams  numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id         uuid := public.current_organization_id();
  v_emp_id         uuid := public.current_employee_id();
  v_phys_w         numeric(14, 4);
  v_pr             numeric(6, 2);
  v_agreed_eq      numeric(14, 4);
  v_src_type       text;
  v_handover_no    text;
  v_handover_id    uuid;
  v_vault          public.manager_vault_account;
  v_existing       jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi',
    'accountant', 'buxgalter'
  ]);

  if v_emp_id is null then
    select id into v_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
  end if;

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'handover_id', id,
      'handover_no', handover_no,
      'agreed_equivalent_g', agreed_equivalent_g,
      'equivalent_585_grams', agreed_equivalent_g
    ) into v_existing
    from public.factory_gold_handovers
    where idempotency_key = p_idempotency_key and organization_id = v_org_id;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_phys_w := round(coalesce(p_physical_weight_g, p_gross_weight_grams, 0)::numeric, 4);
  v_pr := round(coalesce(p_proba, 585.0)::numeric, 2);

  if v_phys_w <= 0 then
    raise exception 'Invalid physical weight: must be > 0';
  end if;

  if p_agreed_equivalent_g is not null and p_agreed_equivalent_g > 0 then
    v_agreed_eq := round(p_agreed_equivalent_g::numeric, 4);
  else
    v_agreed_eq := round(v_phys_w * (v_pr / 585.0), 4);
  end if;

  v_src_type := coalesce(nullif(btrim(p_source_type), ''), 'refined_gold');
  if v_src_type not in ('refined_gold', 'purchased_gold', 'scrap_gold') then
    v_src_type := 'refined_gold';
  end if;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  -- Deduct from corresponding manager holding
  if v_src_type = 'refined_gold' then
    update public.manager_vault_account
    set manager_refined_gold_grams = round(greatest(0, manager_refined_gold_grams - v_agreed_eq), 4),
        manager_refined_gold_fine_grams = round(greatest(0, coalesce(manager_refined_gold_fine_grams, 0) - v_phys_w), 4)
    where organization_id = v_org_id;

  elsif v_src_type = 'purchased_gold' then
    update public.manager_vault_account
    set manager_purchased_gold_grams = round(greatest(0, manager_purchased_gold_grams - v_agreed_eq), 4)
    where organization_id = v_org_id;

  elsif v_src_type = 'scrap_gold' then
    update public.manager_vault_account
    set manager_scrap_grams = round(greatest(0, manager_scrap_grams - v_phys_w), 4),
        manager_scrap_585_eq_g = round(greatest(0, coalesce(manager_scrap_585_eq_g, 0) - v_agreed_eq), 4),
        manager_scrap_physical_g = round(greatest(0, coalesce(manager_scrap_physical_g, 0) - v_phys_w), 4)
    where organization_id = v_org_id;
  end if;

  -- Update factory obligation: ONLY THIS EVENT REDUCES FACTORY DEBT!
  update public.manager_vault_account
  set total_factory_handed_over_g = round(total_factory_handed_over_g + v_agreed_eq, 4),
      current_factory_obligation_g = round(greatest(0, total_factory_obligation_g - (total_factory_handed_over_g + v_agreed_eq)), 4),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  v_handover_no := 'HND-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.factory_gold_handovers (
    organization_id,
    handover_no,
    source_type,
    physical_weight_g,
    proba,
    agreed_equivalent_g,
    factory_recipient,
    factory_accepted,
    notes,
    idempotency_key,
    recorded_by
  ) values (
    v_org_id,
    v_handover_no,
    v_src_type,
    v_phys_w,
    v_pr,
    v_agreed_eq,
    coalesce(nullif(btrim(p_factory_recipient), ''), 'Zavod'),
    true,
    p_notes,
    p_idempotency_key,
    v_emp_id
  ) returning id into v_handover_id;

  return jsonb_build_object(
    'status', 'ok',
    'handover_id', v_handover_id,
    'handover_no', v_handover_no,
    'source_type', v_src_type,
    'physical_weight_g', v_phys_w,
    'gross_weight_grams', v_phys_w,
    'proba', v_pr,
    'agreed_equivalent_g', v_agreed_eq,
    'equivalent_585_grams', v_agreed_eq,
    'total_factory_handed_over_g', v_vault.total_factory_handed_over_g,
    'current_factory_obligation_g', v_vault.current_factory_obligation_g
  );
end;
$$;

grant execute on function public.rpc_record_factory_gold_handover to authenticated;
