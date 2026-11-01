-- ROLLBACK for migration 20260101000069_goldia_security_hotfix_anon_rpcs.sql
-- NOT a migration (never applied automatically). Restores the pre-069 rpc_get_unified_customer_ledger
-- (with its organization/admin fallbacks) and re-grants the pre-069 PUBLIC/anon EXECUTE on the RPCs.
-- Only run this if the hotfix breaks a legitimate workflow; it re-opens the anonymous exposure.
-- (Re-grants PUBLIC EXECUTE, which covers anon; the ACL string may list PUBLIC rather than anon by name.)

begin;

CREATE OR REPLACE FUNCTION public.rpc_get_unified_customer_ledger(p_customer_id uuid DEFAULT NULL::uuid, p_seller_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org     uuid := coalesce(
    public.current_organization_id(),
    (select organization_id from public.customers where id = p_customer_id limit 1),
    (select id from public.organizations limit 1)
  );
  v_caller_role    text := coalesce(public.current_employee_role_text(), 'admin');
  v_caller_emp_id  uuid := public.current_employee_id();
  v_filter_seller  uuid;
  v_cust_rec       record;
  v_gross_sales    numeric(14, 4);
  v_legacy_debt    numeric(14, 4);
  v_paid_scrap     numeric(14, 4);
  v_paid_cash_g    numeric(14, 4);
  v_paid_cash_uzs  numeric(18, 2);
  v_paid_usd_g     numeric(14, 4);
  v_paid_usd       numeric(18, 2);
  v_total_settled_sum numeric(14, 4);
  v_total_paid     numeric(14, 4);
  v_gross_debt     numeric(14, 4);
  v_net_debt       numeric(14, 4);
  v_avail_adv      numeric(14, 4);
  v_applied_adv    numeric(14, 4);
  v_tot_gross      numeric(14, 4) := 0;
  v_tot_paid       numeric(14, 4) := 0;
  v_tot_net        numeric(14, 4) := 0;
  v_tot_adv        numeric(14, 4) := 0;
  v_tot_cash_uzs   numeric(18, 2) := 0;
  v_tot_usd        numeric(18, 2) := 0;
  v_rows           jsonb := '[]'::jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

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
    into v_gross_sales
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';

    -- 2. Total Unreversed Legacy Debt / Advance (Signed Delta Sum)
    select coalesce(sum(delta_585_g), 0)
    into v_legacy_debt
    from public.client_legacy_debts
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';

    -- 3. Total Unreversed Scrap Gold Paid
    select coalesce(sum(coalesce(scrap_585_equiv_grams, scrap_weight_grams)), 0)
    into v_paid_scrap
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and direction = 'client_to_seller'
      and status <> 'reversed';

    -- 4. Total Unreversed Cash Equivalent Paid (UZS & USD BOTH INCLUDED!)
    select
      coalesce(sum(cash_equivalent_grams), 0),
      coalesce(sum(cash_paid_amount), 0),
      coalesce(sum(usd_equivalent_grams), 0),
      coalesce(sum(usd_paid_amount), 0),
      coalesce(sum(total_settled_grams), 0)
    into v_paid_cash_g, v_paid_cash_uzs, v_paid_usd_g, v_paid_usd, v_total_settled_sum
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and direction = 'client_to_seller'
      and status <> 'reversed';

    -- Total paid strictly combines Scrap + UZS Gold Eq + USD Gold Eq
    v_total_paid := round(v_paid_scrap + v_paid_cash_g + v_paid_usd_g, 4);

    -- Gross obligation combining sales and legacy debt
    if v_legacy_debt >= 0 then
      v_gross_debt := round(v_gross_sales + v_legacy_debt, 4);
      if v_gross_debt >= v_total_paid then
        v_net_debt := round((v_gross_debt - v_total_paid)::numeric, 4);
        v_avail_adv := 0;
      else
        v_net_debt := 0;
        v_avail_adv := round((v_total_paid - v_gross_debt)::numeric, 4);
      end if;
    else
      -- Negative legacy debt means customer had pre-existing advance
      v_gross_debt := v_gross_sales;
      if v_gross_sales >= (v_total_paid + abs(v_legacy_debt)) then
        v_net_debt := round((v_gross_sales - (v_total_paid + abs(v_legacy_debt)))::numeric, 4);
        v_avail_adv := 0;
      else
        v_net_debt := 0;
        v_avail_adv := round(((v_total_paid + abs(v_legacy_debt)) - v_gross_sales)::numeric, 4);
      end if;
    end if;

    -- Applied Advance
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
      'legacy_debt_g', v_legacy_debt,
      'paid_scrap_equivalent_g', v_paid_scrap,
      'paid_cash_equivalent_g', v_paid_cash_g,
      'paid_cash_amount_uzs', v_paid_cash_uzs,
      'paid_usd_equivalent_g', v_paid_usd_g,
      'paid_usd_amount', v_paid_usd,
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
    v_tot_usd      := v_tot_usd + v_paid_usd;

    -- Sync client_gold_accounts cache accurately
    insert into public.client_gold_accounts (
      customer_id, organization_id, seller_id, total_purchased_gold_grams,
      total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams,
      total_usd_paid_amount, total_usd_equiv_grams, total_settled_grams,
      current_debt_grams, advance_balance_grams, updated_at
    ) values (
      v_cust_rec.id, v_caller_org, v_cust_rec.seller_id, v_gross_debt,
      v_paid_scrap, v_paid_cash_uzs, round(v_paid_cash_g + v_paid_usd_g, 4),
      v_paid_usd, v_paid_usd_g, v_total_paid,
      v_net_debt, v_avail_adv, now()
    )
    on conflict (customer_id) do update set
      seller_id = coalesce(excluded.seller_id, client_gold_accounts.seller_id),
      total_purchased_gold_grams = excluded.total_purchased_gold_grams,
      total_scrap_paid_grams = excluded.total_scrap_paid_grams,
      total_cash_paid_amount = excluded.total_cash_paid_amount,
      total_cash_equiv_grams = excluded.total_cash_equiv_grams,
      total_usd_paid_amount  = excluded.total_usd_paid_amount,
      total_usd_equiv_grams  = excluded.total_usd_equiv_grams,
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
      'total_advance_g', v_tot_adv,
      'total_cash_uzs', v_tot_cash_uzs,
      'total_usd', v_tot_usd
    )
  );
end;
$function$

;

-- Re-grant EXECUTE to PUBLIC on the RPCs 069 locked down (restores the 068 default)
grant execute on function public.rpc_record_client_settlement(uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,uuid,numeric,numeric) to public;
grant execute on function public.rpc_record_seller_to_manager_settlement(uuid,numeric,numeric,numeric,text,text,numeric,numeric,numeric) to public;
grant execute on function public.rpc_record_refining_batch(numeric,numeric,numeric,numeric,uuid,text,text,numeric) to public;
grant execute on function public.rpc_archive_customer(uuid,boolean) to public;
grant execute on function public.rpc_reverse_client_legacy_debt(uuid,text,text) to public;
grant execute on function public.rpc_reverse_financial_transaction(uuid,text,text) to public;
grant execute on function public.rpc_reverse_factory_receipt(uuid,text,text) to public;
grant execute on function public.rpc_reverse_client_settlement(uuid,text,text) to public;
grant execute on function public.rpc_preview_selective_test_cleanup(uuid[]) to public;
grant execute on function public.rpc_execute_selective_test_cleanup(uuid[],text,text) to public;
grant execute on function public.rpc_get_accounting_profit_summary(date,date,numeric,numeric,uuid) to public;
grant execute on function public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid) to public;
grant execute on function public.rpc_reclassify_capital_transaction(uuid,text,text,numeric,uuid,uuid,text) to public;
grant execute on function public.rpc_record_refining_batch(numeric,numeric,numeric,numeric,uuid,text,text,numeric,numeric) to public;
grant execute on function public.rpc_confirm_accounting_baseline(text,text,numeric) to public;
grant execute on function public.rpc_reverse_jewelry_sale(uuid,text,text) to public;
grant execute on function public.rpc_record_financial_transaction(text,text,numeric,text,text,text,numeric,numeric,text,numeric,numeric,numeric,uuid,uuid,text,integer) to public;
grant execute on function public.rpc_reverse_financial_transaction(uuid,text) to public;
grant execute on function public.rpc_record_barcode_piece_sale(uuid,uuid,uuid,uuid,numeric,numeric,text,text) to public;
grant execute on function public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text) to public;
grant execute on function public.rpc_get_unified_customer_ledger(uuid,uuid) to public;
grant execute on function public.rpc_reverse_customer_settlement(uuid,text) to public;
grant execute on function public.rpc_preview_full_test_reset() to public;
grant execute on function public.rpc_execute_full_test_reset(text,text) to public;
grant execute on function public.rpc_record_factory_gold_handover(text,numeric,numeric,numeric,text,text,text,numeric,uuid,uuid,uuid) to public;
grant execute on function public.rpc_create_jewelry_sale(uuid,numeric,numeric,text,text) to public;
grant execute on function public.rpc_get_customer_monthly_report(uuid,integer,integer) to public;
grant execute on function public.rpc_record_gold_purchase(text,numeric,numeric,numeric,numeric,text,text,text,numeric,numeric) to public;
grant execute on function public.rpc_return_piece_to_manager(uuid,text,text) to public;
grant execute on function public.rpc_record_factory_receipt(text,integer,numeric,numeric,numeric,uuid,uuid,text,text) to public;
grant execute on function public.rpc_issue_barcode_consignment(uuid,numeric,jsonb,text,text,uuid,numeric) to public;
grant execute on function public.rpc_get_seller_reconciliation_statement(uuid) to public;
grant execute on function public.rpc_reverse_refining_batch(uuid,text,text) to public;
grant execute on function public.rpc_reverse_gold_purchase(uuid,text,text) to public;
grant execute on function public.rpc_reverse_factory_gold_handover(uuid,text,text) to public;
grant execute on function public.rpc_reverse_client_sale(uuid,text,text) to public;
grant execute on function public.rpc_get_daily_sales_ledger(uuid,date,date) to public;
grant execute on function public.rpc_get_company_rate_difference_report(date,date) to public;
grant execute on function public.rpc_get_seller_markup_difference_report(uuid,date,date) to public;

commit;
