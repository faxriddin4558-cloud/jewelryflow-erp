-- ============================================================================
-- Migration 063: Customer Monthly Report Parity, Strict Gold Purchase, and Proba Guard
--
-- 1. Updates rpc_get_customer_monthly_report:
--    - Fixes opening debt summary: combines opening debt + month legacy debt (v_tot_open + v_tot_legacy)
--    - Fixes "All Sellers" filter: aggregates seller till cash, scrap, and bozor qarzi across all sellers in org
--    - Adds applied_usd_rate to item rows for clear currency settlement tracking
--    - Returns seller_owes_manager_total_g and manager_owes_seller_total_g in summary
--
-- 2. Hardens rpc_record_gold_purchase:
--    - Strict non-negative validation (rejects negative cash/usd/gold weight with descriptive errors)
--    - Mandatory positive usd_rate when USD is spent (rejects USD purchase without valid exchange rate)
--    - Calculates total_cost_uzs properly from USD * usd_rate, never leaving it 0 for USD purchases
--
-- 3. Hardens rpc_record_factory_receipt:
--    - Restricts finished goods factory receipts strictly to 585 proba
-- ============================================================================

-- 1. UPGRADE RPC_GET_CUSTOMER_MONTHLY_REPORT
drop function if exists public.rpc_get_customer_monthly_report(uuid, integer, integer);

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
  v_month_usd     numeric(18, 2);
  v_month_usd_g   numeric(14, 4);
  v_month_usd_rate numeric(14, 2);
  v_month_settle  numeric(14, 4);
  v_close_debt    numeric(14, 4);

  -- Overall totals
  v_tot_open     numeric(14, 4) := 0;
  v_tot_legacy   numeric(14, 4) := 0;
  v_tot_dist     numeric(14, 4) := 0;
  v_tot_coll     numeric(14, 4) := 0;
  v_tot_debt     numeric(14, 4) := 0;
  v_tot_cash_uzs numeric(18, 2) := 0;
  v_tot_usd      numeric(18, 2) := 0;
  v_tot_scrap_g  numeric(14, 4) := 0;

  -- Seller till & obligation totals
  v_seller_held_cash_uzs numeric(18, 2) := 0;
  v_seller_held_scrap_g  numeric(14, 4) := 0;
  v_seller_held_usd      numeric(18, 2) := 0;
  v_bozor_qarzi          numeric(14, 4) := 0;
  v_seller_owes_m_tot    numeric(14, 4) := 0;
  v_m_owes_seller_tot    numeric(14, 4) := 0;
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
    -- 1. Opening debt: Legacy debts before start date + Sales before start date - Payments before start date
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
      coalesce(sum(usd_paid_amount), 0),
      coalesce(sum(usd_equivalent_grams), 0),
      coalesce(sum(total_settled_grams), 0)
    into v_month_scrap, v_month_cash, v_month_cash_g, v_month_usd, v_month_usd_g, v_month_settle
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and direction = 'client_to_seller'
      and status <> 'reversed'
      and settlement_date between v_start_date and v_end_date;

    -- Fetch applied USD rate for the month settlements if any
    select coalesce(max(applied_usd_rate), 0) into v_month_usd_rate
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and direction = 'client_to_seller'
      and status <> 'reversed'
      and settlement_date between v_start_date and v_end_date
      and usd_paid_amount > 0;

    -- 5. Closing debt: opening + month legacy + sales - settled
    v_close_debt := round(greatest(0, (v_open_debt + v_month_legacy + v_month_sales) - v_month_settle), 4);

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
        'usd_received', v_month_usd,
        'usd_rate', v_month_usd_rate,
        'usd_equivalent_g', v_month_usd_g,
        'total_settled_g', v_month_settle,
        'closing_debt_g', v_close_debt
      );

      v_tot_open := v_tot_open + v_open_debt;
      v_tot_legacy := v_tot_legacy + v_month_legacy;
      v_tot_dist := v_tot_dist + v_month_sales;
      v_tot_coll := v_tot_coll + v_month_settle;
      v_tot_debt := v_tot_debt + v_close_debt;
      v_tot_cash_uzs := v_tot_cash_uzs + v_month_cash;
      v_tot_usd := v_tot_usd + v_month_usd;
      v_tot_scrap_g := v_tot_scrap_g + v_month_scrap;
    end if;
  end loop;

  -- Calculate seller till and bozor qarzi (filter-specific OR across all sellers)
  if v_filter_seller is not null then
    select
      coalesce(seller_till_cash_amount, 0),
      coalesce(seller_till_scrap_grams, 0),
      coalesce(seller_till_usd_amount, 0),
      coalesce(seller_owes_manager_g, 0),
      coalesce(manager_owes_seller_g, 0),
      coalesce(bozor_qarzi_signed_g, 0)
    into v_seller_held_cash_uzs, v_seller_held_scrap_g, v_seller_held_usd,
         v_seller_owes_m_tot, v_m_owes_seller_tot, v_bozor_qarzi
    from public.seller_gold_accounts
    where seller_id = v_filter_seller and organization_id = v_caller_org;
  else
    select
      coalesce(sum(seller_till_cash_amount), 0),
      coalesce(sum(seller_till_scrap_grams), 0),
      coalesce(sum(seller_till_usd_amount), 0),
      coalesce(sum(seller_owes_manager_g), 0),
      coalesce(sum(manager_owes_seller_g), 0),
      coalesce(sum(bozor_qarzi_signed_g), 0)
    into v_seller_held_cash_uzs, v_seller_held_scrap_g, v_seller_held_usd,
         v_seller_owes_m_tot, v_m_owes_seller_tot, v_bozor_qarzi
    from public.seller_gold_accounts
    where organization_id = v_caller_org;
  end if;

  return jsonb_build_object(
    'year', v_year,
    'month', v_month,
    'items', v_rows,
    'summary', jsonb_build_object(
      'total_customers', jsonb_array_length(v_rows),
      -- Combine opening debt + legacy debt added in month so card matches table!
      'total_opening_debt_g', round(v_tot_open + v_tot_legacy, 4),
      'base_opening_debt_g', v_tot_open,
      'total_legacy_added_month_g', v_tot_legacy,
      'total_distributed_month_g', v_tot_dist,
      'total_collected_scrap_g', v_tot_scrap_g,
      'total_collected_cash_uzs', v_tot_cash_uzs,
      'total_collected_usd', v_tot_usd,
      'total_collected_month_g', v_tot_coll,
      'total_closing_debt_g', v_tot_debt,
      'total_customer_debt_g', v_tot_debt,
      'seller_held_cash_uzs', v_seller_held_cash_uzs,
      'seller_held_scrap_g', v_seller_held_scrap_g,
      'seller_held_usd', v_seller_held_usd,
      'seller_owes_manager_total_g', v_seller_owes_m_tot,
      'manager_owes_seller_total_g', v_m_owes_seller_tot,
      'seller_manager_bozor_qarzi_g', v_bozor_qarzi
    )
  );
end;
$$;

grant execute on function public.rpc_get_customer_monthly_report(uuid, integer, integer) to authenticated;


-- 2. HARDEN RPC_RECORD_GOLD_PURCHASE (Strict validation & mandatory USD rate)
drop function if exists public.rpc_record_gold_purchase(text, numeric, numeric, numeric, numeric, text, text, text, numeric, numeric);

create or replace function public.rpc_record_gold_purchase(
  p_supplier_name     text,
  p_cash_spent_uzs    numeric default 0,
  p_rate_per_gram     numeric default null,
  p_gold_weight_grams numeric default null,
  p_proba             numeric default 585.0,
  p_notes             text default null,
  p_idempotency_key   text default null,
  p_currency          text default 'UZS',
  p_usd_spent         numeric default 0,
  p_usd_rate          numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id         uuid := public.current_organization_id();
  v_emp_id         uuid := public.current_employee_id();
  v_cash_spent     numeric(18, 2);
  v_usd_spent      numeric(18, 2);
  v_usd_rate       numeric(14, 2);
  v_rate           numeric(18, 2);
  v_gold_w         numeric(14, 4);
  v_pr             numeric(6, 2);
  v_equiv_585      numeric(14, 4);
  v_purch_no       text;
  v_purch_id       uuid;
  v_vault          public.manager_vault_account;
  v_existing       jsonb;
  v_currency       text;
  v_total_cost_uzs numeric(18, 2);
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

  -- Strict validation of inputs without silent greatest(0, ...)
  if p_cash_spent_uzs is not null and p_cash_spent_uzs < 0 then
    raise exception 'Sarflangan UZS summasi manfiy bo''lishi mumkin emas (%)', p_cash_spent_uzs;
  end if;

  if p_usd_spent is not null and p_usd_spent < 0 then
    raise exception 'Sarflangan USD summasi manfiy bo''lishi mumkin emas (%)', p_usd_spent;
  end if;

  if p_gold_weight_grams is not null and p_gold_weight_grams < 0 then
    raise exception 'Olingan oltin vazni manfiy bo''lishi mumkin emas (%)', p_gold_weight_grams;
  end if;

  if p_rate_per_gram is not null and p_rate_per_gram < 0 then
    raise exception 'Gramm kursi manfiy bo''lishi mumkin emas (%)', p_rate_per_gram;
  end if;

  v_cash_spent := round(coalesce(p_cash_spent_uzs, 0)::numeric, 2);
  v_usd_spent  := round(coalesce(p_usd_spent, 0)::numeric, 2);
  v_gold_w     := round(coalesce(p_gold_weight_grams, 0)::numeric, 4);
  v_pr         := round(coalesce(p_proba, 585.0)::numeric, 2);
  v_rate       := round(coalesce(p_rate_per_gram, 0)::numeric, 2);

  if v_cash_spent > 0 and v_usd_spent > 0 then
    v_currency := 'MIXED';
  elsif v_usd_spent > 0 then
    v_currency := 'USD';
  else
    v_currency := 'UZS';
  end if;

  if v_cash_spent <= 0 and v_usd_spent <= 0 then
    raise exception 'Xarid uchun UZS yoki USD summasi kiritilishi shart (ikkalasi ham 0 bo''lishi mumkin emas)';
  end if;

  if v_gold_w <= 0 then
    raise exception 'Oltin vazni 0 dan katta bo''lishi shart';
  end if;

  if v_pr <= 0 or v_pr > 1000 then
    raise exception 'Oltin probasi noto''g''ri (%): 1 dan 1000 gacha bo''lishi shart', v_pr;
  end if;

  -- Mandatory positive USD rate check for USD or MIXED purchases
  if v_usd_spent > 0 then
    if p_usd_rate is null or p_usd_rate <= 0 then
      raise exception 'USD yoki MIXED xarid uchun musbat USD/UZS kursi (p_usd_rate) kiritilishi majburiy!';
    end if;
    v_usd_rate := round(p_usd_rate::numeric, 2);
    v_total_cost_uzs := round(v_cash_spent + (v_usd_spent * v_usd_rate), 2);
  else
    v_usd_rate := null;
    v_total_cost_uzs := v_cash_spent;
  end if;

  if v_total_cost_uzs <= 0 then
    raise exception 'Jami xarid qiymati (UZS) 0 dan katta bo''lishi shart!';
  end if;

  if v_rate <= 0 and v_gold_w > 0 then
    v_rate := round((v_total_cost_uzs / v_gold_w)::numeric, 2);
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

  if v_cash_spent > 0 and coalesce(v_vault.manager_cash_amount, 0) < v_cash_spent then
    raise exception 'ERR_INSUFFICIENT_VAULT_CASH: Boshqaruvchi seyfida yetarli naqd pul (UZS) mavjud emas (Mavjud: % UZS, Talab: % UZS)',
      coalesce(v_vault.manager_cash_amount, 0), v_cash_spent;
  end if;

  if v_usd_spent > 0 and coalesce(v_vault.manager_usd_amount, 0) < v_usd_spent then
    raise exception 'ERR_INSUFFICIENT_VAULT_USD: Boshqaruvchi seyfida yetarli valyuta (USD) mavjud emas (Mavjud: $% USD, Talab: $% USD)',
      coalesce(v_vault.manager_usd_amount, 0), v_usd_spent;
  end if;

  v_purch_no := 'BUY-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.gold_purchases (
    organization_id, purchase_no, supplier_name, cash_spent_uzs,
    rate_per_gram, gold_weight_grams, proba, equiv_585_grams,
    currency, usd_spent, usd_rate, total_cost_uzs,
    recorded_by, notes, idempotency_key, status
  ) values (
    v_org_id, v_purch_no, coalesce(p_supplier_name, 'Bozor / Noma''lum Ta''minotchi'),
    v_cash_spent, v_rate, v_gold_w, v_pr, v_equiv_585,
    v_currency, v_usd_spent, v_usd_rate, v_total_cost_uzs,
    v_emp_id, p_notes, p_idempotency_key, 'confirmed'
  ) returning id into v_purch_id;

  -- Deduct exact currencies and add purchased gold to safe
  update public.manager_vault_account
     set manager_cash_amount          = round(manager_cash_amount - v_cash_spent, 2),
         manager_usd_amount           = round(manager_usd_amount - v_usd_spent, 2),
         manager_purchased_gold_grams = round(manager_purchased_gold_grams + v_equiv_585, 4),
         updated_at                   = clock_timestamp()
   where organization_id = v_org_id;

  return jsonb_build_object(
    'status', 'ok',
    'purchase_id', v_purch_id,
    'purchase_no', v_purch_no,
    'gold_weight_grams', v_gold_w,
    'equiv_585_grams', v_equiv_585,
    'currency', v_currency,
    'cash_spent_uzs', v_cash_spent,
    'usd_spent', v_usd_spent,
    'usd_rate', v_usd_rate,
    'total_cost_uzs', v_total_cost_uzs
  );
end;
$$;

grant execute on function public.rpc_record_gold_purchase(text, numeric, numeric, numeric, numeric, text, text, text, numeric, numeric) to authenticated;


-- 3. HARDEN RPC_RECORD_FACTORY_RECEIPT (Restricted strictly to 585 proba)
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
  v_org_id          uuid := public.current_organization_id();
  v_caller_role     text := public.current_employee_role_text();
  v_receipt_no      text;
  v_receipt_id      uuid;
  v_phys_g          numeric(14, 4);
  v_pr              numeric(6, 2);
  v_base_585_g      numeric(14, 4);
  v_f_pct           numeric(6, 2);
  v_f_due_g         numeric(14, 4);
  v_vault           public.manager_vault_account;
  v_existing        jsonb;
  v_new_obligation  numeric(14, 4);
  v_net_balance     numeric(14, 4);
  v_cur_obligation  numeric(14, 4);
  v_cur_advance     numeric(14, 4);
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_caller_role in ('seller', 'sotuvchi', 'sales', 'worker', 'viewer') or v_caller_role is null then
    raise exception 'Ruxsat etilmadi: Sotuvchi yoki begona foydalanuvchi zavod tovar kirimini saqlay olmaydi (Rol: %)', v_caller_role
      using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  v_phys_g := round(coalesce(p_original_physical_g, 0)::numeric, 4);
  if v_phys_g <= 0 then
    raise exception 'Zavod kirimi fizik vazni 0 dan katta bo''lishi shart';
  end if;

  v_pr := round(coalesce(p_proba, 585.0)::numeric, 2);
  if v_pr <> 585.0 then
    raise exception 'JewelryFlow Sales tayyor mahsulotlar ombori faqat 585 proba uchun mo''ljallangan. Kiritilgan proba: %. Boshqa probalar (750/999) qabul qilinmaydi.', v_pr;
  end if;

  v_base_585_g := v_phys_g;
  v_f_pct      := round(coalesce(p_factory_markup_pct, 8.0)::numeric, 2);
  v_f_due_g    := round((v_base_585_g * (1.0 + v_f_pct / 100.0))::numeric, 4);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'action', 'record_factory_receipt',
      'product_name', p_product_name,
      'physical_weight_g', v_phys_g,
      'proba', v_pr
    ) into v_existing;
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_factory_receipt', v_existing);
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_receipt_no := 'ZVD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.factory_receipts (
    organization_id, receipt_no, product_id, model_id, product_name,
    quantity, original_physical_g, available_physical_g, transferred_physical_g,
    proba, factory_markup_pct, factory_obligation_g, status, notes
  ) values (
    v_org_id, v_receipt_no, p_product_id, p_model_id, p_product_name,
    greatest(1, coalesce(p_quantity, 1)), v_phys_g, v_phys_g, 0,
    v_pr, v_f_pct, v_f_due_g, 'in_manager_stock', p_notes
  ) returning id into v_receipt_id;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  v_new_obligation := round(v_vault.total_factory_obligation_g + v_f_due_g, 4);
  v_net_balance := round(v_new_obligation - v_vault.total_factory_handed_over_g, 4);

  if v_net_balance >= 0 then
    v_cur_obligation := v_net_balance;
    v_cur_advance := 0;
  else
    v_cur_obligation := 0;
    v_cur_advance := round(abs(v_net_balance), 4);
  end if;

  update public.manager_vault_account
     set total_factory_received_g     = round(total_factory_received_g + v_phys_g, 4),
         total_factory_obligation_g   = v_new_obligation,
         current_factory_obligation_g = v_cur_obligation,
         current_factory_advance_g    = v_cur_advance,
         manager_physical_stock_g     = round(manager_physical_stock_g + v_phys_g, 4),
         updated_at                   = clock_timestamp()
   where organization_id = v_org_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_org_id, 'factory_receipts', v_receipt_id::text, 'RECORD_RECEIPT', auth.uid(),
    null,
    jsonb_build_object(
      'receipt_no', v_receipt_no,
      'product_name', p_product_name,
      'physical_weight_g', v_phys_g,
      'proba', v_pr,
      'factory_markup_pct', v_f_pct,
      'factory_obligation_g', v_f_due_g
    ),
    'Factory finished goods receipt'
  );

  return jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'physical_weight_g', v_phys_g,
    'proba', v_pr,
    'factory_markup_pct', v_f_pct,
    'factory_obligation_g', v_f_due_g,
    'new_total_obligation_g', v_new_obligation
  );
end;
$$;

grant execute on function public.rpc_record_factory_receipt(text, integer, numeric, numeric, numeric, uuid, uuid, text, text) to authenticated;
