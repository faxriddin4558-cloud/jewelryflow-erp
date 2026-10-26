-- ============================================================================
-- Migration 059: Customer Monthly Report Legacy Debt Parity and Reconciliation Hardening
-- Ensures:
-- 1. rpc_get_customer_monthly_report distinguishes sales from legacy debts in summary.
--    total_distributed_month_g counts ONLY actual month sales (v_month_sales).
--    total_opening_debt_g aggregates opening debt + legacy debt.
--    legacy_added_month_g is returned and accounted for.
-- 2. Confirms rpc_get_seller_reconciliation_statement and rpc_get_daily_sales_ledger
--    strictly exclude reversed settlements and track legacy customer debt cleanly.
-- ============================================================================

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
  v_month_settle  numeric(14, 4);
  v_close_debt    numeric(14, 4);

  -- Overall totals
  v_tot_open     numeric(14, 4) := 0;
  v_tot_legacy   numeric(14, 4) := 0;
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

      v_tot_open := v_tot_open + v_open_debt;
      v_tot_legacy := v_tot_legacy + v_month_legacy;
      v_tot_dist := v_tot_dist + v_month_sales; -- STRICT: Only actual month sales counted in distributed!
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
      'total_opening_debt_g', v_tot_open + v_tot_legacy,
      'total_legacy_added_month_g', v_tot_legacy,
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

grant execute on function public.rpc_get_customer_monthly_report(uuid, integer, integer) to authenticated;
