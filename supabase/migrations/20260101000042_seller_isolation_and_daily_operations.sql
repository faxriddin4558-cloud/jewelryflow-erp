-- Migration 042: Seller Isolation, Daily Ledger Date Boundary, and Customer Cash UZS Parity
-- Hardens SECURITY DEFINER RPCs against cross-seller leakage and fixes reporting discrepancies.

-- -------------------------------------------------------------------------
-- 1. UNIFIED CUSTOMER LEDGER (P0-1 & P1-1)
-- -------------------------------------------------------------------------

create or replace function public.rpc_get_unified_customer_ledger(
  p_seller_id   uuid default null,
  p_customer_id uuid default null
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
  v_rows          jsonb := '[]'::jsonb;
  v_cust_rec      record;
  v_gross_debt    numeric(14, 4);
  v_paid_scrap    numeric(14, 4);
  v_paid_cash_g   numeric(14, 4);
  v_paid_cash_uzs numeric(18, 2);
  v_total_paid    numeric(14, 4);
  v_applied_adv   numeric(14, 4);
  v_avail_adv     numeric(14, 4);
  v_net_debt      numeric(14, 4);
  v_tot_gross     numeric(14, 4) := 0;
  v_tot_paid      numeric(14, 4) := 0;
  v_tot_net       numeric(14, 4) := 0;
  v_tot_adv       numeric(14, 4) := 0;
  v_tot_cash_uzs  numeric(18, 2) := 0;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- P0-1: Seller isolation rule - Sellers can ONLY view their own customers
  if v_caller_role in ('seller', 'sotuvchi', 'sales') then
    if p_seller_id is not null and p_seller_id <> v_caller_emp_id then
      raise exception 'Cross-seller violation: Sotuvchilar faqat o''z mijozlarini ko''ra oladi' using errcode = '42501';
    end if;
    v_filter_seller := v_caller_emp_id;

    if p_customer_id is not null then
      if not exists (
        select 1 from public.customers
        where id = p_customer_id
          and organization_id = v_caller_org
          and (seller_id = v_caller_emp_id or seller_id is null)
      ) then
        raise exception 'Cross-seller violation: Ushbu mijoz sizga biriktirilmagan' using errcode = '42501';
      end if;
    end if;
  else
    v_filter_seller := p_seller_id;
  end if;

  for v_cust_rec in
    select c.id, c.customer_code, c.contact_name, c.phone, c.company_name, c.seller_id,
           coalesce(e.full_name, e.name, 'Biriktirilmagan') as seller_name
    from public.customers c
    left join public.employees e on e.id = c.seller_id
    where c.organization_id = v_caller_org
      and (p_customer_id is null or c.id = p_customer_id)
      and (v_filter_seller is null or c.seller_id = v_filter_seller)
    order by c.contact_name asc
  loop
    -- 1. Total Unreversed Gross Sales Due
    select coalesce(sum(client_gold_due_grams), 0)
    into v_gross_debt
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';

    -- 2. Total Unreversed Scrap Gold Paid (in 585 equivalent)
    select coalesce(sum(coalesce(scrap_585_equiv_grams, scrap_weight_grams)), 0)
    into v_paid_scrap
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and direction = 'client_to_seller'
      and status <> 'reversed';

    -- 3. Total Unreversed Cash Equivalent Paid (both grams and UZS)
    select
      coalesce(sum(cash_equivalent_grams), 0),
      coalesce(sum(cash_paid_amount), 0)
    into v_paid_cash_g, v_paid_cash_uzs
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and direction = 'client_to_seller'
      and status <> 'reversed';

    v_total_paid := round(v_paid_scrap + v_paid_cash_g, 4);

    -- 4. Net Debt and Available Advance
    if v_gross_debt >= v_total_paid then
      v_net_debt  := round((v_gross_debt - v_total_paid)::numeric, 4);
      v_avail_adv := 0;
    else
      v_net_debt  := 0;
      v_avail_adv := round((v_total_paid - v_gross_debt)::numeric, 4);
    end if;

    -- 5. Applied Advance (Advance applied to sales)
    select coalesce(sum(settled_gold_grams), 0)
    into v_applied_adv
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';

    v_rows := v_rows || jsonb_build_object(
      'customer_id', v_cust_rec.id,
      'customer_code', v_cust_rec.customer_code,
      'contact_name', v_cust_rec.contact_name,
      'phone', v_cust_rec.phone,
      'company_name', v_cust_rec.company_name,
      'seller_id', v_cust_rec.seller_id,
      'seller_name', v_cust_rec.seller_name,
      'gross_debt_g', v_gross_debt,
      'paid_scrap_equivalent_g', v_paid_scrap,
      'paid_cash_equivalent_g', v_paid_cash_g,
      'paid_cash_amount_uzs', v_paid_cash_uzs,
      'total_paid_g', v_total_paid,
      'applied_advance_g', v_applied_adv,
      'available_advance_g', v_avail_adv,
      'net_debt_g', v_net_debt
    );

    v_tot_gross := v_tot_gross + v_gross_debt;
    v_tot_paid  := v_tot_paid + v_total_paid;
    v_tot_net   := v_tot_net + v_net_debt;
    v_tot_adv   := v_tot_adv + v_avail_adv;
    v_tot_cash_uzs := v_tot_cash_uzs + v_paid_cash_uzs;

    -- Synchronize client_gold_accounts cache accurately
    insert into public.client_gold_accounts (
      customer_id, organization_id, seller_id, total_purchased_gold_grams,
      total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
      current_debt_grams, advance_balance_grams, updated_at
    ) values (
      v_cust_rec.id, v_caller_org, v_cust_rec.seller_id, v_gross_debt,
      v_paid_scrap, v_paid_cash_uzs, v_paid_cash_g, v_total_paid,
      v_net_debt, v_avail_adv, now()
    )
    on conflict (customer_id) do update set
      seller_id = coalesce(excluded.seller_id, client_gold_accounts.seller_id),
      total_purchased_gold_grams = excluded.total_purchased_gold_grams,
      total_scrap_paid_grams = excluded.total_scrap_paid_grams,
      total_cash_paid_amount = excluded.total_cash_paid_amount,
      total_cash_equiv_grams = excluded.total_cash_equiv_grams,
      total_settled_grams = excluded.total_settled_grams,
      current_debt_grams = excluded.current_debt_grams,
      advance_balance_grams = excluded.advance_balance_grams,
      updated_at = now();
  end loop;

  return jsonb_build_object(
    'items', v_rows,
    'summary', jsonb_build_object(
      'total_gross_debt_g', v_tot_gross,
      'total_paid_g', v_tot_paid,
      'total_net_debt_g', v_tot_net,
      'total_available_advance_g', v_tot_adv,
      'total_cash_paid_uzs', v_tot_cash_uzs
    )
  );
end;
$$;

grant execute on function public.rpc_get_unified_customer_ledger to authenticated;


-- -------------------------------------------------------------------------
-- 2. CUSTOMER MONTHLY REPORT WITH STRICT SELLER ISOLATION (P0-1)
-- -------------------------------------------------------------------------

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

  -- P0-1: Seller isolation rule - Sellers can ONLY view their own monthly report
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
    -- 1. Opening debt: Sales before v_start_date minus Settlements before v_start_date (EXCLUDE REVERSED!)
    select
      coalesce(sum(client_gold_due_grams), 0)
    into v_open_debt
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and sale_date < v_start_date
      and status <> 'reversed';

    select
      v_open_debt - coalesce(sum(total_settled_grams), 0)
    into v_open_debt
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and direction = 'client_to_seller'
      and status <> 'reversed'
      and settlement_date < v_start_date;

    v_open_debt := round(greatest(0, v_open_debt), 4);

    -- 2. Sales during selected month (EXCLUDE REVERSED!)
    select
      coalesce(sum(client_gold_due_grams), 0)
    into v_month_sales
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and sale_date between v_start_date and v_end_date
      and status <> 'reversed';

    -- 3. Payments during selected month (EXCLUDE REVERSED!)
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

    -- 4. Closing debt: opening + sales - settled
    v_close_debt := round(greatest(0, (v_open_debt + v_month_sales) - v_month_settle), 4);

    -- Only include if customer had any activity or opening debt
    if v_open_debt > 0 or v_month_sales > 0 or v_month_settle > 0 or v_close_debt > 0 then
      v_rows := v_rows || jsonb_build_object(
        'customer_id', v_cust_rec.id,
        'customer_code', v_cust_rec.customer_code,
        'customer_name', v_cust_rec.contact_name,
        'phone', v_cust_rec.phone,
        'opening_debt_g', v_open_debt,
        'sales_in_month_g', v_month_sales,
        'scrap_received_g', v_month_scrap,
        'cash_received_uzs', v_month_cash,
        'cash_equivalent_g', v_month_cash_g,
        'total_settled_g', v_month_settle,
        'closing_debt_g', v_close_debt
      );

      v_tot_dist := v_tot_dist + v_month_sales;
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
      'note', 'Bozor qarzi - Boshqaruvchiga nisbatan sof majburiyat (mijozlar qarzi bilan aralashtirilmaydi)'
    )
  );
end;
$$;

grant execute on function public.rpc_get_customer_monthly_report to authenticated;


-- -------------------------------------------------------------------------
-- 3. DAILY SALES LEDGER WITH ISOLATION & EXACT DATE BOUNDARIES (P0-1 & P1-2)
-- -------------------------------------------------------------------------

drop function if exists public.rpc_get_daily_sales_ledger(uuid, date, date);

create or replace function public.rpc_get_daily_sales_ledger(
  p_seller_id   uuid default null,
  p_start_date  date default null,
  p_end_date    date default null
)
returns table (
  tx_id             uuid,
  tx_type           text,
  tx_date           date,
  customer_id       uuid,
  customer_code     text,
  customer_name     text,
  seller_id         uuid,
  seller_name       text,
  model_name        text,
  model_code        text,
  item_id           uuid,
  sold_weight_g     numeric,
  markup_pct        numeric,
  obligation_g      numeric,
  scrap_received_g  numeric,
  cash_received_uzs numeric,
  rate_per_gram     numeric,
  cash_equiv_g      numeric,
  total_payment_g   numeric,
  closing_debt_g    numeric,
  notes             text,
  status            text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_caller_emp_id uuid := public.current_employee_id();
  v_filter_seller uuid;
  v_today_tkt     date := (timezone('Asia/Tashkent', now()))::date;
  v_d1            date;
  v_d2            date;
  v_from          date;
  v_to            date;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- P0-1: Seller isolation rule
  if v_caller_role in ('seller', 'sotuvchi', 'sales') then
    if p_seller_id is not null and p_seller_id <> v_caller_emp_id then
      raise exception 'Cross-seller violation: Sotuvchilar faqat o''z savdo jurnalini ko''ra oladi' using errcode = '42501';
    end if;
    v_filter_seller := v_caller_emp_id;
  else
    v_filter_seller := p_seller_id;
  end if;

  -- P1-2: Exact single-date and date boundary logic
  -- If p_start_date is given and p_end_date is null, default p_end_date to p_start_date!
  -- This ensures querying a single date returns ONLY that date!
  if p_start_date is not null and p_end_date is null then
    v_d1 := p_start_date;
    v_d2 := p_start_date;
  elsif p_start_date is null and p_end_date is not null then
    v_d1 := p_end_date;
    v_d2 := p_end_date;
  elsif p_start_date is not null and p_end_date is not null then
    v_d1 := p_start_date;
    v_d2 := p_end_date;
  else
    v_d1 := v_today_tkt - interval '30 days';
    v_d2 := v_today_tkt;
  end if;

  v_from := least(v_d1, v_d2);
  v_to   := greatest(v_d1, v_d2);

  return query
  -- 1. Sales entries
  select
    s.id as tx_id,
    'sale'::text as tx_type,
    s.sale_date as tx_date,
    s.customer_id,
    coalesce(c.customer_code, 'CUST-XXXX') as customer_code,
    coalesce(c.contact_name, 'Mijoz') as customer_name,
    s.seller_id,
    coalesce(e.full_name, e.name, 'Sotuvchi') as seller_name,
    s.product_name as model_name,
    coalesce(cp.model_code, 'M-GENERIC') as model_code,
    cp.id as item_id,
    s.base_weight_grams as sold_weight_g,
    s.client_markup_pct as markup_pct,
    s.client_gold_due_grams as obligation_g,
    0::numeric as scrap_received_g,
    0::numeric as cash_received_uzs,
    0::numeric as rate_per_gram,
    0::numeric as cash_equiv_g,
    coalesce(s.settled_gold_grams, 0)::numeric as total_payment_g,
    s.remaining_gold_grams as closing_debt_g,
    s.notes,
    s.status
  from public.jewelry_sales s
  join public.customers c on c.id = s.customer_id
  join public.employees e on e.id = s.seller_id
  left join public.consignment_pieces cp on cp.sale_id = s.id
  where s.organization_id = v_caller_org
    and s.sale_date between v_from and v_to
    and (v_filter_seller is null or s.seller_id = v_filter_seller)

  union all

  -- 2. Payment/Settlement entries
  select
    gs.id as tx_id,
    'payment'::text as tx_type,
    gs.settlement_date as tx_date,
    gs.customer_id,
    coalesce(c.customer_code, 'CUST-XXXX') as customer_code,
    coalesce(c.contact_name, 'Mijoz') as customer_name,
    gs.seller_id,
    coalesce(e.full_name, e.name, 'Sotuvchi') as seller_name,
    'To''lov / Qaytim'::text as model_name,
    'PAYMENT'::text as model_code,
    null::uuid as item_id,
    0::numeric as sold_weight_g,
    0::numeric as markup_pct,
    0::numeric as obligation_g,
    gs.scrap_weight_grams as scrap_received_g,
    gs.cash_paid_amount as cash_received_uzs,
    gs.gold_rate_applied as rate_per_gram,
    gs.cash_equivalent_grams as cash_equiv_g,
    gs.total_settled_grams as total_payment_g,
    gs.remaining_debt_grams as closing_debt_g,
    gs.notes,
    gs.status
  from public.gold_settlements gs
  join public.customers c on c.id = gs.customer_id
  join public.employees e on e.id = gs.seller_id
  where gs.organization_id = v_caller_org
    and gs.direction = 'client_to_seller'
    and gs.settlement_date between v_from and v_to
    and (v_filter_seller is null or gs.seller_id = v_filter_seller)

  order by tx_date desc, tx_id desc;
end;
$$;

grant execute on function public.rpc_get_daily_sales_ledger to authenticated;


-- -------------------------------------------------------------------------
-- 4. HARDEN NON-SELLER RPC PERMISSION (P0-1)
-- -------------------------------------------------------------------------

create or replace function public.rpc_record_factory_receipt(
  p_product_name        text,
  p_quantity            integer default 1,
  p_original_physical_g numeric default 0,
  p_proba               numeric default 585,
  p_factory_markup_pct  numeric default 8.0,
  p_product_id          uuid default null,
  p_model_id            uuid default null,
  p_notes               text default null,
  p_idempotency_key     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id        uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_receipt_no    text;
  v_receipt_id    uuid;
  v_phys_g        numeric(14, 4);
  v_f_pct         numeric(6, 2);
  v_f_due_g       numeric(14, 4);
  v_vault         public.manager_vault_account;
  v_existing      jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- Fail closed: Explicitly reject sellers, workers, viewers
  if v_caller_role in ('seller', 'sotuvchi', 'sales', 'worker', 'viewer') or v_caller_role is null then
    raise exception 'Ruxsat etilmadi: Sotuvchi yoki begona foydalanuvchi zavod tovar kirimini saqlay olmaydi (Rol: %)', v_caller_role
      using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'action', 'record_factory_receipt',
      'product_name', p_product_name,
      'physical_weight_g', round(coalesce(p_original_physical_g, 0)::numeric, 4),
      'proba', coalesce(p_proba, 585)
    ) into v_existing;
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_factory_receipt', v_existing);
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_phys_g := round(coalesce(p_original_physical_g, 0)::numeric, 4);
  if v_phys_g <= 0 then
    raise exception 'Zavod kirimi fizik vazni 0 dan katta bo''lishi shart';
  end if;

  v_f_pct   := round(coalesce(p_factory_markup_pct, 8.0)::numeric, 2);
  v_f_due_g := round((v_phys_g * (1.0 + v_f_pct / 100.0))::numeric, 4);

  v_receipt_no := 'ZVD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.factory_receipts (
    organization_id, receipt_no, product_id, model_id, product_name,
    quantity, original_physical_g, available_physical_g, transferred_physical_g,
    proba, factory_markup_pct, factory_obligation_g, status, notes
  ) values (
    v_org_id, v_receipt_no, p_product_id, p_model_id, p_product_name,
    greatest(1, coalesce(p_quantity, 1)), v_phys_g, v_phys_g, 0,
    coalesce(p_proba, 585), v_f_pct, v_f_due_g, 'in_manager_stock', p_notes
  ) returning id into v_receipt_id;

  -- Update manager vault balance
  insert into public.manager_vault_account (
    organization_id, total_factory_received_g, total_factory_obligation_g, current_factory_obligation_g, updated_at
  ) values (
    v_org_id, v_phys_g, v_f_due_g, v_f_due_g, now()
  )
  on conflict (organization_id) do update set
    total_factory_received_g   = round((manager_vault_account.total_factory_received_g + v_phys_g)::numeric, 4),
    total_factory_obligation_g = round((manager_vault_account.total_factory_obligation_g + v_f_due_g)::numeric, 4),
    current_factory_obligation_g = round(greatest(0, (manager_vault_account.total_factory_obligation_g + v_f_due_g) - manager_vault_account.total_factory_handed_over_g)::numeric, 4),
    updated_at = now()
  returning * into v_vault;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'original_physical_g', v_phys_g,
    'physical_weight_g', v_phys_g,
    'factory_markup_pct', v_f_pct,
    'factory_obligation_g', v_f_due_g,
    'vault_factory_obligation_g', v_vault.current_factory_obligation_g,
    'manager_current_factory_obligation_g', v_vault.current_factory_obligation_g
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_factory_receipt', v_existing, v_existing);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_factory_receipt to authenticated;


-- -------------------------------------------------------------------------
-- 5. RECORD APPLIED MIGRATIONS IN SCHEMA METADATA
-- -------------------------------------------------------------------------

create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  inserted_at timestamptz default now()
);

insert into supabase_migrations.schema_migrations (version, name) values
  ('20260101000036', 'security_hardening_seller_isolation_and_factory_permissions'),
  ('20260101000037', 'core_accounting_parity_and_stock_lifecycle'),
  ('20260101000038', 'final_sales_mega_fix'),
  ('20260101000039', 'safe_corrections_reversals_and_staging_cleanup'),
  ('20260101000040', 'financial_integrity_and_unified_ledger'),
  ('20260101000041', 'jules_security_hardening'),
  ('20260101000042', 'seller_isolation_and_daily_operations')
on conflict (version) do nothing;
