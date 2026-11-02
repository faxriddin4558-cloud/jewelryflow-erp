-- ROLLBACK for migration 20260101000070_goldia_acceptance_audit_fixes.sql
-- NOT a migration (never applied automatically). Restores the exact 069 definitions, EXECUTE grants and
-- RLS policies of every object 070 changed. Business rows are not touched.
-- WARNING: this re-opens the 069 defects (cross-org profit summary, lost customer payments on reversal,
-- concurrent-payment lost update, whole-consignment oversell, receipt retry duplicates, cross-org employees).
-- Generated from a database built from migrations 001-069 (docs/audits/goldia-final-acceptance/harness).

begin;

CREATE OR REPLACE FUNCTION public.prevent_employee_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_in_salary_rpc  boolean := (coalesce(current_setting('app.in_salary_rpc', true), 'false') = 'true');
  v_in_auth_link   boolean := (coalesce(current_setting('app.in_auth_link_trigger', true), 'false') = 'true');
begin
  if auth.uid() is not null and not public.is_admin_or_manager() then
    if new.role is distinct from old.role
       or new.role_type is distinct from old.role_type
       or new.status is distinct from old.status
       or new.employment_status is distinct from old.employment_status
       or new.is_active is distinct from old.is_active
       or new.employee_code is distinct from old.employee_code
       or new.primary_department_id is distinct from old.primary_department_id
       or new.rate is distinct from old.rate
       or (new.user_id is distinct from old.user_id and not v_in_auth_link)
       or new.email is distinct from old.email
       or (new.balance is distinct from old.balance and not v_in_salary_rpc)
    then
      raise exception 'Privilege escalation blocked: only admin or manager may modify role, identity link, status, rate, or balance'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$
;
revoke all on function public.prevent_employee_privilege_escalation() from public, anon, authenticated, service_role;
grant execute on function public.prevent_employee_privilege_escalation() to authenticated;
grant execute on function public.prevent_employee_privilege_escalation() to service_role;

CREATE OR REPLACE FUNCTION public.rpc_get_accounting_profit_summary(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_gold_rate numeric DEFAULT NULL::numeric, p_usd_rate numeric DEFAULT NULL::numeric, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id                 uuid := coalesce(p_org_id, public.current_organization_id());
  v_today                  date := (timezone('Asia/Tashkent', now()))::date;
  v_gold_rate_585          numeric(18, 2);
  v_usd_rate               numeric(18, 2);
  v_rate_confirmed         boolean := false;
  v_base                   public.accounting_baselines%rowtype;
  v_mgr_stock_g            numeric(14, 4) := 0;
  v_seller_stock_g         numeric(14, 4) := 0;
  v_mgr_scrap_g            numeric(14, 4) := 0;
  v_mgr_scrap_phys_g       numeric(14, 4) := 0;
  v_seller_scrap_g         numeric(14, 4) := 0;
  v_seller_scrap_phys_g    numeric(14, 4) := 0;
  v_mgr_refined_g          numeric(14, 4) := 0;
  v_mgr_capital_pure_g     numeric(14, 4) := 0;
  v_mgr_purchased_g        numeric(14, 4) := 0;
  v_refining_wip_g         numeric(14, 4) := 0;
  v_cust_debts_g           numeric(14, 4) := 0;
  v_cust_advances_g        numeric(14, 4) := 0;
  v_mgr_cash_uzs           numeric(18, 2) := 0;
  v_seller_cash_uzs        numeric(18, 2) := 0;
  v_total_cash_uzs         numeric(18, 2) := 0;
  v_cash_585_eq_g          numeric(14, 4) := 0;
  v_mgr_usd                numeric(18, 2) := 0;
  v_seller_usd             numeric(18, 2) := 0;
  v_total_usd              numeric(18, 2) := 0;
  v_usd_585_eq_g           numeric(14, 4) := 0;
  v_factory_rcp_due_g      numeric(14, 4) := 0;
  v_factory_hnd_paid_g     numeric(14, 4) := 0;
  v_net_factory_g          numeric(14, 4) := 0;
  v_factory_debt_g         numeric(14, 4) := 0;
  v_factory_advance_g      numeric(14, 4) := 0;
  v_tot_assets_g           numeric(14, 4) := 0;
  v_tot_liabilities_g      numeric(14, 4) := 0;
  v_cur_net_assets_g       numeric(14, 4) := 0;
  v_cap_in_g               numeric(14, 4) := 0;
  v_cap_out_g              numeric(14, 4) := 0;
  v_expenses_g             numeric(14, 4) := 0;
  v_refining_loss_g        numeric(14, 4) := 0;
  v_post_base_legacy_adj   numeric(14, 4) := 0;
  v_period_accounting_res  numeric(14, 4) := null;
  v_vault_rec              public.manager_vault_account%rowtype;
  v_components             jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if p_end_date is not null and p_end_date > v_today then
    return jsonb_build_object(
      'status', 'unsupported_pilot_period',
      'error', format('Pilot davrida faqat bugungi kungacha (jonli real-time) hisoblash qo''llab-quvvatlanadi. Tanlangan oxirgi sana: %s, Bugun: %s.', p_end_date, v_today),
      'is_computable', false,
      'is_complete', false,
      'accounting_method', 'realtime_pilot_locked'
    );
  end if;

  select * into v_base
    from public.accounting_baselines
   where organization_id = v_org_id
     and status = 'active'
   order by baseline_date desc, created_at desc
   limit 1;

  if p_gold_rate is not null and p_gold_rate > 0 then
    v_gold_rate_585 := round(p_gold_rate::numeric, 2);
    v_rate_confirmed := true;
  else
    select rate_per_gram, is_confirmed
      into v_gold_rate_585, v_rate_confirmed
      from public.daily_gold_rates
     where organization_id = v_org_id
       and proba = 585
       and rate_date = v_today
     order by created_at desc
     limit 1;

    if v_gold_rate_585 is null and v_base.id is not null then
      v_gold_rate_585 := v_base.gold_rate_585;
      v_rate_confirmed := true;
    end if;
  end if;

  if p_usd_rate is not null and p_usd_rate > 0 then
    v_usd_rate := round(p_usd_rate::numeric, 2);
  else
    if v_base.id is not null and v_base.usd_rate is not null and v_base.usd_rate > 0 then
      v_usd_rate := v_base.usd_rate;
    else
      v_usd_rate := 12800.0;
    end if;
  end if;

  select coalesce(sum(available_physical_g), 0) into v_mgr_stock_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(public.get_seller_available_stock_grams(seller_id)), 0)
    into v_seller_stock_g
    from public.seller_gold_accounts
   where organization_id = v_org_id;

  select * into v_vault_rec
  from public.manager_vault_account
  where organization_id = v_org_id;

  if found then
    v_mgr_scrap_g := coalesce(v_vault_rec.manager_scrap_585_eq_g, v_vault_rec.manager_scrap_grams, 0);
    v_mgr_scrap_phys_g := coalesce(v_vault_rec.manager_scrap_physical_g, v_vault_rec.manager_scrap_grams, 0);
    v_mgr_refined_g := coalesce(v_vault_rec.manager_refined_gold_grams, 0);
    v_mgr_capital_pure_g := coalesce(v_vault_rec.manager_capital_pure_gold_g, 0);
    v_mgr_purchased_g := coalesce(v_vault_rec.manager_purchased_gold_grams, 0);
    v_mgr_cash_uzs := coalesce(v_vault_rec.manager_cash_amount, 0);
    v_mgr_usd := coalesce(v_vault_rec.manager_usd_amount, 0);
  end if;

  select coalesce(sum(coalesce(seller_till_scrap_585_eq_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(coalesce(seller_till_scrap_physical_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(seller_till_cash_amount), 0),
         coalesce(sum(coalesce(seller_till_usd_amount, 0)), 0)
    into v_seller_scrap_g, v_seller_scrap_phys_g, v_seller_cash_uzs, v_seller_usd
    from public.seller_gold_accounts
   where organization_id = v_org_id;

  select coalesce(sum(coalesce(input_585_equiv_grams, input_scrap_grams * (coalesce(input_scrap_proba, 585.0) / 585.0))), 0)
    into v_refining_wip_g
    from public.refining_batches
   where organization_id = v_org_id and status in ('pending', 'in_progress');

  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_cust_debts_g, v_cust_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  v_total_cash_uzs := round(v_mgr_cash_uzs + v_seller_cash_uzs, 2);
  v_total_usd := round(v_mgr_usd + v_seller_usd, 2);

  if v_gold_rate_585 is not null and v_gold_rate_585 > 0 then
    v_cash_585_eq_g := round((v_total_cash_uzs / v_gold_rate_585)::numeric, 4);
    if v_usd_rate is not null and v_usd_rate > 0 then
      v_usd_585_eq_g := round(((v_total_usd * v_usd_rate) / v_gold_rate_585)::numeric, 4);
    end if;
  end if;

  -- Factory net balance: receipts vs handovers
  select coalesce(sum(factory_obligation_g), 0) into v_factory_rcp_due_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(agreed_equivalent_g), 0) into v_factory_hnd_paid_g
  from public.factory_gold_handovers
  where organization_id = v_org_id and status <> 'reversed';

  v_net_factory_g := v_factory_rcp_due_g - v_factory_hnd_paid_g;
  if v_net_factory_g >= 0 then
    v_factory_debt_g := round(v_net_factory_g, 4);
    v_factory_advance_g := 0;
  else
    v_factory_debt_g := 0;
    v_factory_advance_g := round(abs(v_net_factory_g), 4);
  end if;

  -- Total Assets includes factory advance gold as asset!
  v_tot_assets_g := round(
    v_mgr_stock_g + v_seller_stock_g +
    v_mgr_scrap_g + v_seller_scrap_g +
    v_mgr_refined_g + v_mgr_capital_pure_g + v_mgr_purchased_g +
    v_refining_wip_g +
    v_cust_debts_g +
    v_cash_585_eq_g + v_usd_585_eq_g +
    v_factory_advance_g,
    4
  );

  v_tot_liabilities_g := round(v_factory_debt_g + v_cust_advances_g, 4);
  v_cur_net_assets_g := round(v_tot_assets_g - v_tot_liabilities_g, 4);

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
    'factory_obligation_585_g', v_factory_debt_g,
    'factory_debt_585_g', v_factory_debt_g,
    'factory_advance_585_g', v_factory_advance_g
  );

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

    select coalesce(sum(total_loss_grams), 0) into v_refining_loss_g
    from public.refining_batches
    where organization_id = v_org_id and status = 'completed'
      and created_at > v_base.created_at;

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
      'manager_scrap_585_eq_g', v_mgr_scrap_g,
      'seller_scrap_585_eq_g', v_seller_scrap_g,
      'manager_refined_gold_585_g', v_mgr_refined_g,
      'manager_capital_pure_gold_585_g', v_mgr_capital_pure_g,
      'manager_purchased_gold_585_g', v_mgr_purchased_g,
      'refining_wip_585_g', v_refining_wip_g,
      'customer_debts_585_g', v_cust_debts_g,
      'cash_uzs_585_eq_g', v_cash_585_eq_g,
      'cash_usd_585_eq_g', v_usd_585_eq_g,
      'factory_advance_585_g', v_factory_advance_g
    ),
    'liabilities', jsonb_build_object(
      'factory_debt_585_g', v_factory_debt_g,
      'customer_advances_585_g', v_cust_advances_g
    )
  );
end;
$function$
;
revoke all on function public.rpc_get_accounting_profit_summary(date,date,numeric,numeric,uuid) from public, anon, authenticated, service_role;
grant execute on function public.rpc_get_accounting_profit_summary(date,date,numeric,numeric,uuid) to authenticated;
grant execute on function public.rpc_get_accounting_profit_summary(date,date,numeric,numeric,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.rpc_get_financial_reconciliation_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id        uuid := public.current_organization_id();
  v_vault         public.manager_vault_account;
  v_total_cns_phys numeric(14, 4);
  v_total_s_due    numeric(14, 4);
  v_total_s_stl    numeric(14, 4);
  v_total_s_owes   numeric(14, 4);
  v_total_m_owes   numeric(14, 4);
  v_total_s_till_sc numeric(14, 4);
  v_total_s_till_c numeric(18, 2);
  v_total_cl_debt  numeric(14, 4);
  v_total_cl_adv   numeric(14, 4);
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id;

  select
    coalesce(sum(total_transferred_physical_g), 0),
    coalesce(sum(total_seller_obligation_g), 0),
    coalesce(sum(total_settled_to_manager_g), 0),
    coalesce(sum(seller_owes_manager_g), 0),
    coalesce(sum(manager_owes_seller_g), 0),
    coalesce(sum(seller_till_scrap_grams), 0),
    coalesce(sum(seller_till_cash_amount), 0)
  into
    v_total_cns_phys,
    v_total_s_due,
    v_total_s_stl,
    v_total_s_owes,
    v_total_m_owes,
    v_total_s_till_sc,
    v_total_s_till_c
  from public.seller_gold_accounts
  where organization_id = v_org_id;

  select
    coalesce(sum(current_debt_grams), 0),
    coalesce(sum(advance_balance_grams), 0)
  into
    v_total_cl_debt,
    v_total_cl_adv
  from public.client_gold_accounts
  where organization_id = v_org_id;

  return jsonb_build_object(
    'organization_id', v_org_id,
    'manager_factory_account', jsonb_build_object(
      'total_factory_received_g', v_vault.total_factory_received_g,
      'total_factory_obligation_g', v_vault.total_factory_obligation_g,
      'total_factory_handed_over_g', v_vault.total_factory_handed_over_g,
      'current_factory_obligation_g', v_vault.current_factory_obligation_g
    ),
    'manager_vault_holdings', jsonb_build_object(
      'manager_scrap_grams', v_vault.manager_scrap_grams,
      'manager_cash_amount', v_vault.manager_cash_amount,
      'manager_refined_gold_grams', v_vault.manager_refined_gold_grams,
      'manager_purchased_gold_grams', v_vault.manager_purchased_gold_grams
    ),
    'sellers_summary', jsonb_build_object(
      'total_transferred_physical_g', v_total_cns_phys,
      'total_seller_obligation_g', v_total_s_due,
      'total_settled_to_manager_g', v_total_s_stl,
      'total_seller_owes_manager_g', v_total_s_owes,
      'total_manager_owes_seller_g', v_total_m_owes,
      'total_seller_till_scrap_grams', v_total_s_till_sc,
      'total_seller_till_cash_amount', v_total_s_till_c
    ),
    'clients_summary', jsonb_build_object(
      'total_client_debt_grams', v_total_cl_debt,
      'total_client_advance_grams', v_total_cl_adv
    )
  );
end;
$function$
;
revoke all on function public.rpc_get_financial_reconciliation_summary() from public, anon, authenticated, service_role;
grant execute on function public.rpc_get_financial_reconciliation_summary() to authenticated;
grant execute on function public.rpc_get_financial_reconciliation_summary() to service_role;

CREATE OR REPLACE FUNCTION public.rpc_get_seller_available_pieces(p_seller_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org uuid := public.current_organization_id();
  v_caller_emp uuid := public.current_employee_id();
  v_caller_role text := public.current_employee_role();
  v_target_seller uuid;
  v_pieces jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if p_seller_id is not null then
    v_target_seller := p_seller_id;
  else
    v_target_seller := v_caller_emp;
  end if;

  select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
  into v_pieces
  from (
    select 
      cp.id,
      cp.consignment_id,
      cp.model_id,
      cp.model_code,
      cp.model_name,
      cp.category,
      cp.purity,
      cp.proba,
      cp.weight_grams,
      cp.status,
      cp.seller_id,
      cp.raw_barcode,
      jm.primary_image_url,
      cp.notes,
      cp.seller_markup_pct,
      cp.seller_obligation_grams,
      cp.created_at,
      sc.consignment_no
    from public.consignment_pieces cp
    join public.seller_consignments sc on sc.id = cp.consignment_id
    left join public.jewelry_models jm on jm.id = cp.model_id
    where cp.organization_id = v_caller_org
      and (v_target_seller is null or cp.seller_id = v_target_seller)
      and cp.status = 'held_by_seller'
      and cp.sale_id is null
      and sc.status not in ('fully_sold', 'returned_to_manager', 'cancelled')
      and coalesce(sc.sold_quantity, 0) < sc.quantity
    order by cp.created_at desc
  ) r;

  return v_pieces;
end;
$function$
;
revoke all on function public.rpc_get_seller_available_pieces(uuid) from public, anon, authenticated, service_role;
grant execute on function public.rpc_get_seller_available_pieces(uuid) to authenticated;
grant execute on function public.rpc_get_seller_available_pieces(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.rpc_get_three_tier_ledger_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org         uuid := public.current_organization_id();
  v_tier1_received_g   numeric(14, 4) := 0;
  v_tier1_factory_obl  numeric(14, 4) := 0;
  v_tier1_handed_over  numeric(14, 4) := 0;
  v_tier1_factory_due  numeric(14, 4) := 0;
  v_tier2_consigned_g  numeric(14, 4) := 0;
  v_tier2_seller_obl   numeric(14, 4) := 0;
  v_tier2_settled_g    numeric(14, 4) := 0;
  v_tier2_seller_due   numeric(14, 4) := 0;
  v_tier3_sales_due    numeric(14, 4) := 0;
  v_tier3_settled_g    numeric(14, 4) := 0;
  v_tier3_client_debt  numeric(14, 4) := 0;
  v_tier3_advance_g    numeric(14, 4) := 0;
  v_vault_scrap_g      numeric(14, 4) := 0;
  v_vault_cash         numeric(18, 2) := 0;
  v_vault_refined_585  numeric(14, 4) := 0;
  v_manager_avail_g    numeric(14, 4) := 0;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- Tier 1: Factory <-> Manager (Filter out reversed receipts!)
  select
    coalesce(sum(original_physical_g), 0),
    coalesce(sum(factory_obligation_g), 0),
    coalesce(sum(available_physical_g), 0)
  into v_tier1_received_g, v_tier1_factory_obl, v_manager_avail_g
  from public.factory_receipts
  where organization_id = v_caller_org and status <> 'reversed';

  select coalesce(sum(agreed_equivalent_g), 0)
  into v_tier1_handed_over
  from public.factory_gold_handovers
  where organization_id = v_caller_org;

  v_tier1_factory_due := round(greatest(0, v_tier1_factory_obl - v_tier1_handed_over), 4);

  -- Tier 2: Manager <-> Seller (Filter out cancelled/reversed consignments and settlements!)
  select
    coalesce(sum(base_weight_grams), 0),
    coalesce(sum(coalesce(seller_obligation_g, factory_gold_due_grams)), 0)
  into v_tier2_consigned_g, v_tier2_seller_obl
  from public.seller_consignments
  where organization_id = v_caller_org and status <> 'cancelled' and status <> 'reversed';

  select coalesce(sum(total_settled_grams), 0)
  into v_tier2_settled_g
  from public.gold_settlements
  where organization_id = v_caller_org and direction = 'seller_to_manager' and status <> 'reversed';

  v_tier2_seller_due := round(greatest(0, v_tier2_seller_obl - v_tier2_settled_g), 4);

  -- Tier 3: Seller <-> Customer (Filter out reversed sales and settlements!)
  select coalesce(sum(client_gold_due_grams), 0)
  into v_tier3_sales_due
  from public.jewelry_sales
  where organization_id = v_caller_org and status <> 'reversed';

  select coalesce(sum(total_settled_grams), 0)
  into v_tier3_settled_g
  from public.gold_settlements
  where organization_id = v_caller_org and direction = 'client_to_seller' and status <> 'reversed';

  select
    coalesce(sum(current_debt_grams), 0),
    coalesce(sum(advance_balance_grams), 0)
  into v_tier3_client_debt, v_tier3_advance_g
  from public.client_gold_accounts
  where organization_id = v_caller_org;

  -- Vault Snapshot
  select
    coalesce(manager_scrap_grams, 0),
    coalesce(manager_cash_amount, 0),
    coalesce(manager_refined_gold_grams, 0)
  into v_vault_scrap_g, v_vault_cash, v_vault_refined_585
  from public.manager_vault_account
  where organization_id = v_caller_org;

  return jsonb_build_object(
    'status', 'ok',
    'tier1_factory', jsonb_build_object(
      'total_obligation_grams', v_tier1_factory_obl,
      'total_handovers_grams', v_tier1_handed_over,
      'net_factory_debt_grams', v_tier1_factory_due,
      'available_stock_grams', v_manager_avail_g
    ),
    'tier1_factory_to_manager', jsonb_build_object(
      'total_received_physical_g', v_tier1_received_g,
      'total_factory_obligation_g', v_tier1_factory_obl,
      'total_handed_over_g', v_tier1_handed_over,
      'current_factory_gold_due_g', v_tier1_factory_due,
      'manager_available_stock_g', v_manager_avail_g
    ),
    'tier2_sellers', jsonb_build_object(
      'total_seller_obligation_grams', v_tier2_seller_obl,
      'total_settled_to_manager_grams', v_tier2_settled_g,
      'bozor_qarzi_signed_grams', -v_tier2_seller_due,
      'net_seller_due_grams', v_tier2_seller_due
    ),
    'tier2_manager_to_seller', jsonb_build_object(
      'total_consigned_physical_g', v_tier2_consigned_g,
      'total_seller_obligation_g', v_tier2_seller_obl,
      'total_surrendered_to_manager_g', v_tier2_settled_g,
      'current_seller_gold_due_g', v_tier2_seller_due
    ),
    'tier3_clients', jsonb_build_object(
      'total_purchased_grams', v_tier3_sales_due,
      'total_settled_grams', v_tier3_settled_g,
      'net_debt_grams', v_tier3_client_debt,
      'advance_balance_grams', v_tier3_advance_g
    ),
    'tier3_seller_to_customer', jsonb_build_object(
      'total_sales_obligation_g', v_tier3_sales_due,
      'total_settled_by_customers_g', v_tier3_settled_g,
      'current_customer_debt_g', v_tier3_client_debt,
      'current_customer_advance_g', v_tier3_advance_g
    ),
    'manager_vault', jsonb_build_object(
      'scrap_gold_585_g', v_vault_scrap_g,
      'refined_gold_585_equiv_g', v_vault_refined_585,
      'cash_amount_uzs', v_vault_cash
    )
  );
end;
$function$
;
revoke all on function public.rpc_get_three_tier_ledger_summary() from public, anon, authenticated, service_role;
grant execute on function public.rpc_get_three_tier_ledger_summary() to authenticated;
grant execute on function public.rpc_get_three_tier_ledger_summary() to service_role;

CREATE OR REPLACE FUNCTION public.rpc_record_client_jewelry_sale(p_customer_id uuid, p_consignment_id uuid, p_client_markup_pct numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_cons            public.seller_consignments%rowtype;
  v_cust            public.customers%rowtype;
  v_client_acc      public.client_gold_accounts%rowtype;
  v_caller_emp_id   uuid;
  v_caller_role     text := public.current_employee_role_text();
  v_client_markup   numeric(6, 2) := round(coalesce(p_client_markup_pct, 0)::numeric, 2);
  v_client_gold_due numeric(14, 4);
  v_markup_spread   numeric(14, 4);
  v_avail_adv       numeric(14, 4) := 0;
  v_apply_adv       numeric(14, 4) := 0;
  v_net_rem_due     numeric(14, 4);
  v_sale_id         uuid;
  v_sale_no         text;
  v_payload         jsonb;
  v_existing        jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  select id into v_caller_emp_id
    from public.employees
   where (user_id = auth.uid() or id = auth.uid())
     and organization_id = v_caller_org
   limit 1;

  if v_client_markup < 0 then
    raise exception 'Client markup percentage cannot be negative';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_client_sale',
    'customer_id', p_customer_id,
    'consignment_id', p_consignment_id,
    'client_markup_pct', v_client_markup
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_jewelry_sale', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Lock consignment
  select * into v_cons
    from public.seller_consignments
   where id = p_consignment_id
     and organization_id = v_caller_org
   for update;
  if not found then
    raise exception 'Consignment (%) not found', p_consignment_id;
  end if;

  if v_cons.status in ('fully_sold', 'returned_to_factory', 'closed') or coalesce(v_cons.sold_quantity, 0) >= coalesce(v_cons.quantity, 0) then
    raise exception 'Consignment % is already closed or fully sold', v_cons.consignment_no;
  end if;

  -- P0-2: Check if pieces exist for this consignment in consignment_pieces and whether any piece was already sold
  if exists (
    select 1 from public.consignment_pieces
    where consignment_id = v_cons.id
      and status in ('sold', 'returned_to_factory')
  ) then
    raise exception 'Ushbu partiyadagi donalardan ayrimlari allaqachon sotilgan yoki qaytarilgan. Donalab sotuvdan foydalaning.';
  end if;

  -- Ensure seller owns this consignment unless privileged
  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi') then
    if v_cons.seller_id <> v_caller_emp_id then
      raise exception 'Cross-seller violation: You can only sell consignments allocated to your account' using errcode = '42501';
    end if;
  end if;

  -- Verify customer
  select * into v_cust
    from public.customers
   where id = p_customer_id
     and organization_id = v_caller_org
   limit 1;
  if not found then
    raise exception 'Customer (%) not found in your organization', p_customer_id;
  end if;

  -- Non-compounding: Client gold due is calculated strictly from base weight
  v_client_gold_due := round((v_cons.base_weight_grams * (1.0 + v_client_markup / 100.0))::numeric, 4);
  v_markup_spread   := round((v_client_gold_due - v_cons.factory_gold_due_grams)::numeric, 4);

  -- Check existing advance balance
  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_cust.id
     and organization_id = v_caller_org
   for update;

  v_avail_adv := coalesce(v_client_acc.advance_balance_grams, 0);
  if v_avail_adv > 0 then
    v_apply_adv   := round(least(v_avail_adv, v_client_gold_due)::numeric, 4);
    v_net_rem_due := round((v_client_gold_due - v_apply_adv)::numeric, 4);
  else
    v_apply_adv   := 0;
    v_net_rem_due := v_client_gold_due;
  end if;

  v_sale_no := 'SALE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.jewelry_sales (
    organization_id, sale_no, seller_id, customer_id, consignment_id,
    product_id, product_name, quantity, base_weight_grams, proba,
    factory_markup_pct, factory_gold_due_grams,
    client_markup_pct, client_gold_due_grams, markup_spread_grams,
    settled_gold_grams, remaining_gold_grams, status,
    sale_date, idempotency_key, notes
  ) values (
    v_caller_org, v_sale_no, v_cons.seller_id, v_cust.id, v_cons.id,
    v_cons.product_id, v_cons.product_name, v_cons.quantity, v_cons.base_weight_grams, v_cons.proba,
    v_cons.factory_markup_pct, v_cons.factory_gold_due_grams,
    v_client_markup, v_client_gold_due, v_markup_spread,
    v_apply_adv, v_net_rem_due,
    case when v_net_rem_due <= 0.0001 then 'fully_paid' else 'open_debt' end,
    current_date, nullif(btrim(p_idempotency_key), ''), p_notes
  ) returning id into v_sale_id;

  -- P0-2: ATOMICALLY UPDATE ALL PIECES in this consignment to 'sold' with sale_id
  update public.consignment_pieces
     set status = 'sold',
         sale_id = v_sale_id,
         sold_at = now(),
         updated_at = now()
   where consignment_id = v_cons.id
     and status = 'held_by_seller';

  -- Update parent consignment status
  update public.seller_consignments
     set sold_quantity = quantity,
         status        = 'fully_sold',
         updated_at    = now()
   where id = v_cons.id;

  -- Update client running debt in client_gold_accounts
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    current_debt_grams, advance_balance_grams, total_settled_grams, updated_at
  ) values (
    v_cust.id, v_caller_org, v_cons.seller_id, v_client_gold_due,
    v_net_rem_due, greatest(0, v_avail_adv - v_apply_adv), v_apply_adv, now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_gold_due)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_net_rem_due)::numeric, 4),
    advance_balance_grams      = round(greatest(0, client_gold_accounts.advance_balance_grams - v_apply_adv)::numeric, 4),
    total_settled_grams        = round((client_gold_accounts.total_settled_grams + v_apply_adv)::numeric, 4),
    seller_id                  = coalesce(client_gold_accounts.seller_id, v_cons.seller_id),
    updated_at                 = now();

  -- Update seller's total client debt tracking
  insert into public.seller_gold_accounts (
    seller_id, organization_id, total_client_debt_grams, updated_at
  ) values (
    v_cons.seller_id, v_caller_org, v_net_rem_due, now()
  )
  on conflict (seller_id) do update set
    total_client_debt_grams = round((seller_gold_accounts.total_client_debt_grams + v_net_rem_due)::numeric, 4),
    updated_at              = now();

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'seller_id', v_cons.seller_id,
    'customer_id', v_cust.id,
    'product_name', v_cons.product_name,
    'base_weight_grams', v_cons.base_weight_grams,
    'factory_gold_due_grams', v_cons.factory_gold_due_grams,
    'client_markup_pct', v_client_markup,
    'gross_gold_due_grams', v_client_gold_due,
    'client_gold_due_grams', v_client_gold_due,
    'advance_applied_grams', v_apply_adv,
    'net_remaining_debt_grams', v_net_rem_due,
    'remaining_gold_grams', v_net_rem_due,
    'markup_spread_grams', v_markup_spread
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_jewelry_sale', v_existing, v_payload);
  return v_existing;
end;
$function$
;
revoke all on function public.rpc_record_client_jewelry_sale(uuid,uuid,numeric,text,text) from public, anon, authenticated, service_role;
grant execute on function public.rpc_record_client_jewelry_sale(uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.rpc_record_client_jewelry_sale(uuid,uuid,numeric,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.rpc_record_client_settlement(p_customer_id uuid, p_sale_id uuid DEFAULT NULL::uuid, p_scrap_weight numeric DEFAULT 0, p_scrap_proba numeric DEFAULT NULL::numeric, p_cash_amount numeric DEFAULT 0, p_rate_per_gram numeric DEFAULT NULL::numeric, p_settlement_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_seller_id uuid DEFAULT NULL::uuid, p_usd_amount numeric DEFAULT 0, p_usd_rate numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_caller_role       text := public.current_employee_role_text();
  v_caller_emp_id     uuid := public.current_employee_id();
  v_official_rate     numeric(18, 2);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

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

  -- 2. 585 Gold rate determination. Sellers must use the official confirmed rate (065).
  v_official_rate := public._goldia_official_585_rate(v_caller_org);
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    v_rate := v_official_rate;
  end if;
  perform public._goldia_assert_seller_rate(v_caller_role, v_rate, v_official_rate, (v_cash > 0 or v_usd > 0));

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

  -- 065: sellers may only collect for themselves and their own customers
  if public._goldia_is_seller_role(v_caller_role) then
    if v_caller_emp_id is null or v_seller.id <> v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''z kassasiga to''lov qabul qila oladi' using errcode = '42501';
    end if;
    if v_customer.seller_id is not null and v_customer.seller_id <> v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Ushbu mijoz sizga biriktirilmagan' using errcode = '42501';
    end if;
  end if;

  if p_sale_id is not null and not exists (
    select 1 from public.jewelry_sales s
     where s.id = p_sale_id and s.organization_id = v_caller_org and s.customer_id = v_customer.id
       and s.status not in ('reversed', 'cancelled')
  ) then
    raise exception 'Savdo hujjati ushbu mijozga tegishli emas yoki bekor qilingan (%)', p_sale_id;
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
$function$
;
revoke all on function public.rpc_record_client_settlement(uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,uuid,numeric,numeric) from public, anon, authenticated, service_role;
grant execute on function public.rpc_record_client_settlement(uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,uuid,numeric,numeric) to authenticated;
grant execute on function public.rpc_record_client_settlement(uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,uuid,numeric,numeric) to service_role;

CREATE OR REPLACE FUNCTION public.rpc_record_factory_receipt(p_product_name text, p_quantity integer DEFAULT 1, p_original_physical_g numeric DEFAULT 0, p_proba numeric DEFAULT 585, p_factory_markup_pct numeric DEFAULT 8.0, p_product_id uuid DEFAULT NULL::uuid, p_model_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
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
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  IF v_caller_role IN ('seller', 'sotuvchi', 'sales', 'worker', 'viewer') OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Ruxsat etilmadi: Sotuvchi yoki begona foydalanuvchi zavod tovar kirimini saqlay olmaydi (Rol: %)', v_caller_role
      USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  v_phys_g := ROUND(COALESCE(p_original_physical_g, 0)::numeric, 4);
  IF v_phys_g <= 0 THEN
    RAISE EXCEPTION 'Zavod kirimi fizik vazni 0 dan katta bo''lishi shart';
  END IF;

  v_pr := ROUND(COALESCE(p_proba, 585.0)::numeric, 2);
  IF v_pr <> 585.0 THEN
    RAISE EXCEPTION 'JewelryFlow Sales tayyor mahsulotlar ombori faqat 585 proba uchun mo''ljallangan. Kiritilgan proba: %. Boshqa probalar (750/999) qabul qilinmaydi.', v_pr;
  END IF;

  v_base_585_g := v_phys_g;
  v_f_pct      := ROUND(COALESCE(p_factory_markup_pct, 8.0)::numeric, 2);
  v_f_due_g    := ROUND((v_base_585_g * (1.0 + v_f_pct / 100.0))::numeric, 4);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT jsonb_build_object(
      'action', 'record_factory_receipt',
      'product_name', p_product_name,
      'physical_weight_g', v_phys_g,
      'original_physical_g', v_phys_g,
      'proba', v_pr
    ) INTO v_existing;
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_factory_receipt', v_existing);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  v_receipt_no := 'ZVD-' || to_char(NOW(), 'YYYYMMDD') || '-' || UPPER(SUBSTR(md5(random()::text || clock_timestamp()::text), 1, 6));

  INSERT INTO public.factory_receipts (
    organization_id, receipt_no, product_id, model_id, product_name,
    quantity, original_physical_g, available_physical_g, transferred_physical_g,
    proba, factory_markup_pct, factory_obligation_g, status, notes
  ) VALUES (
    v_org_id, v_receipt_no, p_product_id, p_model_id, p_product_name,
    GREATEST(1, COALESCE(p_quantity, 1)), v_phys_g, v_phys_g, 0,
    v_pr, v_f_pct, v_f_due_g, 'in_manager_stock', p_notes
  ) RETURNING id INTO v_receipt_id;

  PERFORM public._get_or_create_manager_vault(v_org_id);
  SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id FOR UPDATE;

  v_new_obligation := ROUND(v_vault.total_factory_obligation_g + v_f_due_g, 4);
  v_net_balance := ROUND(v_new_obligation - v_vault.total_factory_handed_over_g, 4);

  IF v_net_balance >= 0 THEN
    v_cur_obligation := v_net_balance;
    v_cur_advance := 0;
  ELSE
    v_cur_obligation := 0;
    v_cur_advance := ROUND(ABS(v_net_balance), 4);
  END IF;

  UPDATE public.manager_vault_account
     SET total_factory_received_g     = ROUND(total_factory_received_g + v_phys_g, 4),
         total_factory_obligation_g   = v_new_obligation,
         current_factory_obligation_g = v_cur_obligation,
         current_factory_advance_g    = v_cur_advance,
         manager_physical_stock_g     = ROUND(manager_physical_stock_g + v_phys_g, 4),
         updated_at                   = clock_timestamp()
   WHERE organization_id = v_org_id;

  -- Audit log
  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) VALUES (
    v_org_id, 'factory_receipts', v_receipt_id::text, 'RECORD_RECEIPT', auth.uid(),
    NULL,
    jsonb_build_object(
      'receipt_no', v_receipt_no,
      'product_name', p_product_name,
      'physical_weight_g', v_phys_g,
      'original_physical_g', v_phys_g,
      'proba', v_pr,
      'factory_markup_pct', v_f_pct,
      'factory_obligation_g', v_f_due_g
    ),
    'Factory finished goods receipt'
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'physical_weight_g', v_phys_g,
    'original_physical_g', v_phys_g,
    'proba', v_pr,
    'factory_markup_pct', v_f_pct,
    'factory_obligation_g', v_f_due_g,
    'new_total_obligation_g', v_new_obligation
  );
END;
$function$
;
revoke all on function public.rpc_record_factory_receipt(text,integer,numeric,numeric,numeric,uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.rpc_record_factory_receipt(text,integer,numeric,numeric,numeric,uuid,uuid,text,text) to authenticated;
grant execute on function public.rpc_record_factory_receipt(text,integer,numeric,numeric,numeric,uuid,uuid,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.rpc_record_financial_transaction(p_transaction_type text, p_source_till text, p_amount numeric, p_currency text, p_category text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_gold_rate numeric DEFAULT NULL::numeric, p_usd_rate numeric DEFAULT NULL::numeric, p_idempotency_key text DEFAULT NULL::text, p_physical_weight numeric DEFAULT NULL::numeric, p_physical_weight_g numeric DEFAULT NULL::numeric, p_gold_proba numeric DEFAULT NULL::numeric, p_seller_id uuid DEFAULT NULL::uuid, p_model_id uuid DEFAULT NULL::uuid, p_product_name text DEFAULT NULL::text, p_quantity integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Normalize currency representations
  if v_cur in ('GRAMS_585', '585', 'G585') then
    v_cur := '585_GOLD';
  elsif v_cur in ('GRAMS_FINE', 'FINE', '995', '9999', 'PURE', 'PURE_GOLD') then
    v_cur := 'FINE_GOLD';
  elsif v_cur in ('SCRAP', 'LOM') then
    v_cur := 'SCRAP_GOLD';
  elsif v_cur in ('FINISHED') then
    v_cur := 'FINISHED_GOODS';
  elsif v_cur in ('CASH_UZS') then
    v_cur := 'UZS';
  elsif v_cur in ('CASH_USD') then
    v_cur := 'USD';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id from public.employees where user_id = auth.uid() and organization_id = v_org_id limit 1;
  end if;

  v_amt := round(coalesce(p_amount, 0)::numeric, 4);
  if v_amt <= 0 then
    raise exception 'Tranzaksiya summasi yoki miqdori 0 dan katta bo''lishi shart';
  end if;

  -- Unified physical weight resolution (accepts both p_physical_weight and p_physical_weight_g)
  v_phys_w := round(coalesce(p_physical_weight, p_physical_weight_g, v_amt)::numeric, 4);
  v_proba  := round(coalesce(p_gold_proba, 585.0)::numeric, 2);

  v_payload := jsonb_build_object(
    'type', v_type,
    'source_till', v_till,
    'amount', v_amt,
    'currency', v_cur,
    'physical_weight', v_phys_w,
    'gold_proba', v_proba
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_financial_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Gold and USD rate resolution
  if p_gold_rate is not null and p_gold_rate > 0 then
    v_rate_585 := round(p_gold_rate::numeric, 2);
  else
    select rate_per_gram into v_rate_585
      from public.daily_gold_rates
     where organization_id = v_org_id
     order by rate_date desc, created_at desc limit 1;
    v_rate_585 := coalesce(v_rate_585, 880000);
  end if;

  if p_usd_rate is not null and p_usd_rate > 0 then
    v_rate_usd := round(p_usd_rate::numeric, 2);
  else
    select rate_to_uzs into v_rate_usd
      from public.currency_rates
     where organization_id = v_org_id and from_currency = 'USD'
     order by rate_date desc, created_at desc limit 1;
    v_rate_usd := coalesce(v_rate_usd, 12800);
  end if;

  -- 585 Gold Equivalent Calculation
  if v_cur in ('UZS', 'CASH_UZS') then
    v_equiv_585 := round((v_amt / v_rate_585)::numeric, 4);
    v_fine_g    := round((v_equiv_585 * 0.585)::numeric, 4);
  elsif v_cur in ('USD', 'CASH_USD') then
    v_equiv_585 := round(((v_amt * v_rate_usd) / v_rate_585)::numeric, 4);
    v_fine_g    := round((v_equiv_585 * 0.585)::numeric, 4);
  elsif v_cur in ('SCRAP_GOLD', '585_GOLD') then
    v_equiv_585 := round(v_phys_w * (v_proba / 585.0), 4);
    v_fine_g    := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);
  elsif v_cur in ('FINE_GOLD', 'PURE_GOLD', '995_GOLD', '999_GOLD') then
    v_proba     := coalesce(p_gold_proba, 995.0);
    v_fine_g    := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);
    v_equiv_585 := round((v_phys_w * (v_proba / 585.0))::numeric, 4);
  elsif v_cur in ('FINISHED_GOODS') then
    v_equiv_585 := round(v_phys_w * (v_proba / 585.0), 4);
    v_fine_g    := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);
  else
    v_equiv_585 := round(v_amt::numeric, 4);
    v_fine_g    := round((v_equiv_585 * 0.585)::numeric, 4);
  end if;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  -- 1. Apply asset balance updates atomically (No fake profit!)
  if v_type in ('capital_in', 'capital_contribution') then
    if v_till in ('manager_fine_gold', 'manager_capital_pure_gold', 'manager_vault_pure_gold') or v_cur in ('FINE_GOLD', 'PURE_GOLD') then
      -- Pure cast gold goes to pure gold capital safe (NOT affinage output!)
      update public.manager_vault_account
         set manager_capital_pure_gold_g      = round(manager_capital_pure_gold_g + v_equiv_585, 4),
             manager_capital_pure_gold_fine_g = round(manager_capital_pure_gold_fine_g + v_phys_w, 4),
             updated_at                       = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_scrap', 'manager_vault_scrap') then
      update public.manager_vault_account
         set manager_scrap_grams    = round(manager_scrap_grams + v_equiv_585, 4),
             manager_scrap_physical_g = round(coalesce(manager_scrap_physical_g, 0) + v_phys_w, 4),
             manager_scrap_585_eq_g   = round(coalesce(manager_scrap_585_eq_g, 0) + v_equiv_585, 4),
             updated_at             = now()
       where organization_id = v_org_id;

    elsif v_till in ('seller_till_scrap') and p_seller_id is not null then
      update public.seller_gold_accounts
         set seller_till_scrap_grams      = round(seller_till_scrap_grams + v_equiv_585, 4),
             seller_till_scrap_physical_g = round(coalesce(seller_till_scrap_physical_g, 0) + v_phys_w, 4),
             seller_till_scrap_585_eq_g   = round(coalesce(seller_till_scrap_585_eq_g, 0) + v_equiv_585, 4),
             updated_at                   = now()
       where seller_id = p_seller_id and organization_id = v_org_id;

    elsif v_till in ('manager_finished', 'manager_stock') or v_cur = 'FINISHED_GOODS' then
      v_rec_no := 'CAP-FIN-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      insert into public.factory_receipts (
        organization_id, receipt_no, product_name, quantity, original_physical_g,
        available_physical_g, transferred_physical_g, proba, factory_markup_pct,
        factory_obligation_g, status, notes
      ) values (
        v_org_id, v_rec_no, coalesce(p_product_name, 'Kapital Tayyor Mahsulot'),
        greatest(1, coalesce(p_quantity, 1)), v_phys_w, v_phys_w, 0,
        v_proba, 0.0, 0.0, 'in_manager_stock',
        'KAPITAL KIRIMI: Ta''sischi hissasi sifatida kiritilgan mahsulot (Zavod qarzi yaratilmaydi)'
      ) returning id into v_receipt_id;

      update public.manager_vault_account
         set manager_finished_capital_g = round(coalesce(manager_finished_capital_g, 0) + v_phys_w, 4),
             manager_physical_stock_g   = public.get_manager_available_stock_grams(v_org_id),
             updated_at                 = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_uzs', 'manager_cash') then
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount + v_amt, 2),
             updated_at          = now()
       where organization_id = v_org_id;

    elsif v_till in ('seller_till_uzs') and p_seller_id is not null then
      update public.seller_gold_accounts
         set seller_till_cash_amount = round(seller_till_cash_amount + v_amt, 2),
             updated_at              = now()
       where seller_id = p_seller_id and organization_id = v_org_id;

    elsif v_till in ('manager_usd') then
      update public.manager_vault_account
         set manager_usd_amount = round(manager_usd_amount + v_amt, 2),
             updated_at         = now()
       where organization_id = v_org_id;

    elsif v_till in ('seller_till_usd') and p_seller_id is not null then
      update public.seller_gold_accounts
         set seller_till_usd_amount = round(coalesce(seller_till_usd_amount, 0) + v_amt, 2),
             updated_at             = now()
       where seller_id = p_seller_id and organization_id = v_org_id;

    else
      -- Default to manager vault gold
      update public.manager_vault_account
         set manager_capital_pure_gold_g = round(manager_capital_pure_gold_g + v_equiv_585, 4),
             updated_at                  = now()
       where organization_id = v_org_id;
    end if;

  elsif v_type in ('capital_out', 'capital_distribution', 'expense', 'business_expense') then
    if v_till in ('manager_uzs', 'manager_cash') then
      if v_vault.manager_cash_amount < v_amt then
        raise exception 'Boshqaruvchi kassasida yetarli naqd pul yo''q (Mavjud: % UZS, Talab: % UZS)',
          v_vault.manager_cash_amount, v_amt;
      end if;
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount - v_amt, 2),
             updated_at          = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_usd') then
      if v_vault.manager_usd_amount < v_amt then
        raise exception 'Boshqaruvchi kassasida yetarli USD yo''q (Mavjud: $% , Talab: $%)',
          v_vault.manager_usd_amount, v_amt;
      end if;
      update public.manager_vault_account
         set manager_usd_amount = round(manager_usd_amount - v_amt, 2),
             updated_at         = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_scrap') then
      if v_vault.manager_scrap_grams < v_equiv_585 then
        raise exception 'Boshqaruvchi seyfida yetarli lom yo''q (Mavjud: % g, Talab: % g)',
          v_vault.manager_scrap_grams, v_equiv_585;
      end if;
      update public.manager_vault_account
         set manager_scrap_grams = round(manager_scrap_grams - v_equiv_585, 4),
             updated_at          = now()
       where organization_id = v_org_id;
    end if;
  end if;

  -- 2. Insert transaction record
  v_tx_no := 'FTX-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.financial_transactions (
    organization_id, transaction_no, transaction_date, transaction_type,
    source_till, amount_num, currency, gold_rate_applied, usd_rate_applied,
    equiv_585_grams, category, notes, recorded_by, idempotency_key,
    physical_weight_grams, gold_proba, seller_id, status
  ) values (
    v_org_id, v_tx_no, v_today, v_type,
    v_till, v_amt, v_cur, v_rate_585, v_rate_usd,
    v_equiv_585, p_category, p_notes, v_caller_emp_id, p_idempotency_key,
    v_phys_w, v_proba, p_seller_id, 'confirmed'
  ) returning id into v_tx_id;

  -- 3. Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) values (
    v_org_id, 'financial_transactions', v_tx_id::text, 'RECORD_FINANCIAL_TRANSACTION', auth.uid(),
    jsonb_build_object(
      'transaction_no', v_tx_no,
      'type', v_type,
      'source_till', v_till,
      'amount', v_amt,
      'currency', v_cur,
      'equiv_585_grams', v_equiv_585,
      'physical_weight_grams', v_phys_w,
      'gold_proba', v_proba
    )
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'id', v_tx_id,
    'transaction_id', v_tx_id,
    'transaction_no', v_tx_no,
    'equiv_585_grams', v_equiv_585,
    'fine_gold_grams', v_fine_g,
    'physical_weight_g', v_phys_w,
    'gold_proba', v_proba
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_financial_transaction', v_existing, v_payload);
  return v_existing;
end;
$function$
;
revoke all on function public.rpc_record_financial_transaction(text,text,numeric,text,text,text,numeric,numeric,text,numeric,numeric,numeric,uuid,uuid,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.rpc_record_financial_transaction(text,text,numeric,text,text,text,numeric,numeric,text,numeric,numeric,numeric,uuid,uuid,text,integer) to authenticated;
grant execute on function public.rpc_record_financial_transaction(text,text,numeric,text,text,text,numeric,numeric,text,numeric,numeric,numeric,uuid,uuid,text,integer) to service_role;

CREATE OR REPLACE FUNCTION public.rpc_record_weight_sale(p_customer_id uuid, p_seller_id uuid DEFAULT NULL::uuid, p_weight_grams numeric DEFAULT NULL::numeric, p_client_markup_pct numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_caller_emp_id uuid := public.current_employee_id();
  v_seller        public.employees%rowtype;
  v_customer      public.customers%rowtype;
  v_seller_acc    public.seller_gold_accounts%rowtype;
  v_client_acc    public.client_gold_accounts%rowtype;
  v_weight        numeric(14, 4);
  v_markup        numeric(6, 2);
  v_avail_stock   numeric(14, 4);
  v_client_due    numeric(14, 4);
  v_avail_adv     numeric(14, 4);
  v_apply_adv     numeric(14, 4);
  v_net_rem_due   numeric(14, 4);
  v_sale_no       text;
  v_sale_id       uuid;
  v_existing      jsonb;
  v_payload       jsonb;
  v_consign       public.seller_consignments%rowtype;
  v_piece         public.consignment_pieces%rowtype;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'sales', 'seller', 'sotuvchi', 'manager', 'production_manager', 'boshqaruvchi'
  ]);
  v_weight := round(greatest(0, coalesce(p_weight_grams, 0))::numeric, 4);
  if p_client_markup_pct is null then
    raise exception 'ERR_MARKUP_REQUIRED: Mijoz ustama foizi aniq ko''rsatilishi shart';
  end if;
  v_markup := round(p_client_markup_pct::numeric, 2);
  if v_markup < 0 or v_markup > 100 then
    raise exception 'ERR_MARKUP_OUT_OF_RANGE: Mijoz ustama foizi 0 dan 100 gacha bo''lishi shart (kiritildi: %)', v_markup;
  end if;

  if v_weight <= 0 then
    raise exception 'Sotilayotgan mahsulot vazni 0 dan katta bo''lishi shart';
  end if;

  -- Seller determination
  if v_caller_role in ('seller', 'sotuvchi', 'sales') then
    select * into v_seller from public.employees
    where id = v_caller_emp_id and organization_id = v_caller_org limit 1;
  elsif p_seller_id is not null then
    select * into v_seller from public.employees
    where id = p_seller_id and organization_id = v_caller_org limit 1;
  else
    select * into v_seller from public.employees
    where organization_id = v_caller_org and lower(role::text) in ('seller', 'sotuvchi', 'sales')
    order by created_at asc limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  select * into v_customer from public.customers
   where id = p_customer_id and organization_id = v_caller_org limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;

  -- Check available physical stock via canonical helper.
  -- 065: serialize stock-changing sales per seller before checking availability
  perform pg_advisory_xact_lock(hashtextextended('goldia_seller_stock:' || v_seller.id::text, 0));
  v_avail_stock := public.get_seller_available_stock_grams(v_seller.id);

  if v_avail_stock < v_weight then
    raise exception 'ERR_INSUFFICIENT_SELLER_STOCK: Sotuvchi omborida yetarli oltin mavjud emas (Mavjud: % g, Talab: % g)',
      v_avail_stock, v_weight;
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_weight_sale',
    'customer_id', p_customer_id,
    'seller_id', v_seller.id,
    'weight_grams', v_weight,
    'markup_pct', v_markup
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_weight_sale', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Math: Client gross gold due = weight * (1 + markup / 100)
  v_client_due := round((v_weight * (1.0 + v_markup / 100.0))::numeric, 4);

  -- Lock client account and check advance
  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_customer.id and organization_id = v_caller_org
   for update;

  v_avail_adv := coalesce(v_client_acc.advance_balance_grams, 0);

  if v_avail_adv > 0 then
    v_apply_adv   := round(least(v_avail_adv, v_client_due)::numeric, 4);
    v_net_rem_due := round((v_client_due - v_apply_adv)::numeric, 4);
  else
    v_apply_adv   := 0;
    v_net_rem_due := v_client_due;
  end if;

  -- FIFO: Link sale to seller's active consignment
  select * into v_consign
    from public.seller_consignments
   where seller_id = v_seller.id and organization_id = v_caller_org
     and status in ('held_by_seller', 'partially_sold')
   order by created_at asc
   limit 1
   for update;

  v_sale_no := 'SALE-W-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.jewelry_sales (
    organization_id, sale_no, seller_id, customer_id, consignment_id,
    product_name, quantity, base_weight_grams, proba,
    factory_markup_pct, factory_gold_due_grams,
    client_markup_pct, client_gold_due_grams,
    markup_spread_grams, settled_gold_grams, remaining_gold_grams,
    status, sale_date, idempotency_key, notes, sale_type
  ) values (
    v_caller_org, v_sale_no, v_seller.id, v_customer.id, v_consign.id,
    'Standart 585 Oltin (Vazn bo''yicha)', 1, v_weight, 585.00,
    0.00, v_weight,
    v_markup, v_client_due,
    round((v_client_due - v_weight)::numeric, 4), v_apply_adv, v_net_rem_due,
    case when v_net_rem_due <= 0.0001 then 'fully_paid' else 'open_debt' end,
    current_date, nullif(btrim(p_idempotency_key), ''), p_notes, 'weight'
  ) returning id into v_sale_id;

  -- If a consignment was linked, update sold info and pieces
  if v_consign.id is not null then
    update public.seller_consignments
       set status = 'partially_sold',
           sold_quantity = coalesce(sold_quantity, 0) + 1,
           updated_at = now()
     where id = v_consign.id;

    -- 068: consume the full sold weight across every held piece (this consignment first)
    perform public._goldia_consume_weight_sale_pieces(v_sale_id, v_seller.id, v_consign.id, v_weight, v_caller_org);
  end if;

  -- Update client_gold_accounts atomically
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    current_debt_grams, advance_balance_grams, total_settled_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, v_client_due,
    v_net_rem_due, round(greatest(0, v_avail_adv - v_apply_adv)::numeric, 4), v_apply_adv, now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_due)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_net_rem_due)::numeric, 4),
    advance_balance_grams      = round(greatest(0, client_gold_accounts.advance_balance_grams - v_apply_adv)::numeric, 4),
    total_settled_grams        = round((client_gold_accounts.total_settled_grams + v_apply_adv)::numeric, 4),
    seller_id                  = coalesce(client_gold_accounts.seller_id, v_seller.id),
    updated_at                 = now();

  -- Recalculate seller gold account
  perform public.recalc_seller_gold_account(v_seller.id, v_caller_org);

  v_avail_stock := public.get_seller_available_stock_grams(v_seller.id);

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'seller_id', v_seller.id,
    'customer_id', v_customer.id,
    'base_weight_grams', v_weight,
    'weight_grams', v_weight,
    'client_markup_pct', v_markup,
    'client_gold_due_grams', v_client_due,
    'advance_applied_grams', v_apply_adv,
    'remaining_debt_grams', v_net_rem_due,
    'remaining_physical_stock_g', v_avail_stock
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_weight_sale', v_existing, v_payload);
  return v_existing;
end;
$function$
;
revoke all on function public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text) from public, anon, authenticated, service_role;
grant execute on function public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text) to authenticated;
grant execute on function public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.rpc_reverse_client_sale(p_sale_id uuid, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_org       uuid := public.current_organization_id();
  v_caller_role      text := public.current_employee_role_text();
  v_caller_emp_id    uuid := public.current_employee_id();
  v_clean_reason     text := NULLIF(btrim(p_reason), '');
  v_sale             public.jewelry_sales%rowtype;
  v_cust_acc         public.client_gold_accounts%rowtype;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_net_sale_debt    numeric(14, 4);
  v_new_cust_debt    numeric(14, 4);
  v_new_cust_adv     numeric(14, 4);
  v_new_seller_debt  numeric(14, 4);
  v_piece            public.consignment_pieces%rowtype;
  v_consign          public.seller_consignments%rowtype;
  v_payload          jsonb;
  v_existing         jsonb;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'Savdoni bekor qilish sababi kiritilishi shart';
  END IF;

  v_payload := jsonb_build_object(
    'action', 'reverse_client_sale',
    'sale_id', p_sale_id,
    'reason', v_clean_reason
  );

  IF p_idempotency_key IS NOT NULL THEN
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_client_sale', v_payload);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- 1. Lock and fetch sale
  SELECT * INTO v_sale
    FROM public.jewelry_sales
   WHERE id = p_sale_id AND organization_id = v_caller_org
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Savdo hujjati topilmadi (%)', p_sale_id;
  END IF;

  IF v_sale.status IN ('reversed', 'cancelled') THEN
    RAISE EXCEPTION 'Ushbu savdo allaqachon bekor qilingan (%s)', v_sale.sale_no;
  END IF;

  -- Cross-seller sale reversal authorization check
  IF v_caller_role IN ('seller', 'sotuvchi', 'sales') THEN
    IF v_sale.seller_id IS DISTINCT FROM v_caller_emp_id THEN
      RAISE EXCEPTION 'Ruxsat etilmadi: Sotuvchilar faqat o''zi amalga oshirgan savdoni bekor qila oladi' USING errcode = '42501';
    END IF;
  END IF;

  -- 2. Lock client_gold_accounts
  SELECT * INTO v_cust_acc
    FROM public.client_gold_accounts
   WHERE customer_id = v_sale.customer_id AND organization_id = v_caller_org
   FOR UPDATE;

  -- 3. Lock seller_gold_accounts
  SELECT * INTO v_seller_acc
    FROM public.seller_gold_accounts
   WHERE seller_id = v_sale.seller_id AND organization_id = v_caller_org
   FOR UPDATE;

  -- Net customer debt that was added by this sale
  v_net_sale_debt := ROUND((v_sale.client_gold_due_grams - COALESCE(v_sale.settled_gold_grams, 0))::numeric, 4);

  -- Adjust customer debt and restore any applied advance
  v_new_cust_debt := ROUND(GREATEST(0, COALESCE(v_cust_acc.current_debt_grams, 0) - v_net_sale_debt)::numeric, 4);
  v_new_cust_adv  := ROUND((COALESCE(v_cust_acc.advance_balance_grams, 0) + COALESCE(v_sale.settled_gold_grams, 0))::numeric, 4);

  UPDATE public.client_gold_accounts
     SET total_purchased_gold_grams = ROUND(GREATEST(0, total_purchased_gold_grams - v_sale.client_gold_due_grams)::numeric, 4),
         current_debt_grams         = v_new_cust_debt,
         advance_balance_grams      = v_new_cust_adv,
         total_settled_grams        = ROUND(GREATEST(0, total_settled_grams - COALESCE(v_sale.settled_gold_grams, 0))::numeric, 4),
         updated_at                 = NOW()
   WHERE customer_id = v_sale.customer_id;

  -- Adjust seller's total client debt
  v_new_seller_debt := ROUND(GREATEST(0, COALESCE(v_seller_acc.total_client_debt_grams, 0) - v_net_sale_debt)::numeric, 4);
  UPDATE public.seller_gold_accounts
     SET total_client_debt_grams = v_new_seller_debt,
         updated_at              = NOW()
   WHERE seller_id = v_sale.seller_id;

  -- Mark sale as reversed
  UPDATE public.jewelry_sales
     SET status          = 'reversed',
         notes           = COALESCE(notes, '') || ' [BEKOR QILINDI: ' || v_clean_reason || ']',
         updated_at      = NOW()
   WHERE id = v_sale.id;

  -- 4. If a physical piece or weight stock was sold, restore it onto consignment_pieces
  -- 068: weight sales recorded with allocations are restored exactly piece by piece
  IF EXISTS (SELECT 1 FROM public.weight_sale_allocations WHERE sale_id = v_sale.id AND reversed_at IS NULL) THEN
    PERFORM public._goldia_restore_weight_sale_allocations(v_sale.id);
  ELSE
  SELECT * INTO v_piece
    FROM public.consignment_pieces
   WHERE sale_id = v_sale.id AND organization_id = v_caller_org
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.consignment_pieces
       SET status = 'held_by_seller',
           sale_id = NULL,
           sold_at = NULL,
           updated_at = NOW()
     WHERE id = v_piece.id;
    -- 065: the parent consignment must give back the sold count as well
    UPDATE public.seller_consignments
       SET sold_quantity = GREATEST(0, COALESCE(sold_quantity, 1) - 1),
           status = CASE
                      WHEN GREATEST(0, COALESCE(sold_quantity, 1) - 1) <= 0 THEN 'held_by_seller'
                      ELSE 'partially_sold'
                    END,
           updated_at = NOW()
     WHERE id = v_piece.consignment_id;
  ELSIF v_sale.consignment_id IS NOT NULL THEN
    -- 065: restore weight onto the exact piece the weight sale reduced, when known
    SELECT * INTO v_piece
      FROM public.consignment_pieces
     WHERE consignment_id = v_sale.consignment_id AND status = 'held_by_seller'
     ORDER BY (id = v_sale.source_piece_id) DESC, updated_at DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.consignment_pieces
         SET weight_grams = ROUND((weight_grams + v_sale.base_weight_grams)::numeric, 4),
             updated_at = NOW()
       WHERE id = v_piece.id;
    ELSE
      -- All pieces in this consignment were marked sold/unassigned. Re-create / re-open an active held piece with restored weight!
      INSERT INTO public.consignment_pieces (
        organization_id, consignment_id, model_code, model_name, category,
        purity, weight_grams, status, seller_id, notes
      ) VALUES (
        v_caller_org, v_sale.consignment_id, COALESCE(v_sale.model_code, 'VAZN'), COALESCE(v_sale.product_name, 'Qaytarilgan VAZN'),
        COALESCE(v_sale.category, 'Buyum'), COALESCE(v_sale.purity, 585), v_sale.base_weight_grams,
        'held_by_seller', v_sale.seller_id, 'Restored from reversed sale ' || v_sale.sale_no
      );
    END IF;

    SELECT * INTO v_consign
      FROM public.seller_consignments
     WHERE id = v_sale.consignment_id
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.seller_consignments
         SET sold_quantity = GREATEST(0, COALESCE(sold_quantity, 1) - 1),
             status = CASE
                        WHEN GREATEST(0, COALESCE(sold_quantity, 1) - 1) <= 0 THEN 'held_by_seller'
                        ELSE 'partially_sold'
                      END,
             updated_at = NOW()
       WHERE id = v_consign.id;
    END IF;
  END IF;
  END IF;

  -- Recalculate seller gold account physical stock
  PERFORM public.recalc_seller_gold_account(v_sale.seller_id, v_caller_org);

  -- Audit log
  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) VALUES (
    v_caller_org, 'jewelry_sales', v_sale.id::text, 'REVERSE_CLIENT_SALE', auth.uid(),
    jsonb_build_object(
      'sale_no', v_sale.sale_no,
      'base_weight_grams', v_sale.base_weight_grams,
      'client_gold_due_grams', v_sale.client_gold_due_grams,
      'customer_id', v_sale.customer_id,
      'seller_id', v_sale.seller_id
    ),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale.id,
    'sale_no', v_sale.sale_no,
    'restored_weight_g', v_sale.base_weight_grams,
    'reversed_debt_g', v_net_sale_debt
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_sale', v_existing, v_payload);
  END IF;

  RETURN v_existing;
END;
$function$
;
revoke all on function public.rpc_reverse_client_sale(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.rpc_reverse_client_sale(uuid,text,text) to authenticated;
grant execute on function public.rpc_reverse_client_sale(uuid,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.rpc_set_daily_gold_rate(p_rate_per_gram numeric, p_proba numeric DEFAULT 585, p_rate_date date DEFAULT CURRENT_DATE, p_currency text DEFAULT 'UZS'::text, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_purity numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;
revoke all on function public.rpc_set_daily_gold_rate(numeric,numeric,date,text,text,text,numeric) from public, anon, authenticated, service_role;
grant execute on function public.rpc_set_daily_gold_rate(numeric,numeric,date,text,text,text,numeric) to authenticated;
grant execute on function public.rpc_set_daily_gold_rate(numeric,numeric,date,text,text,text,numeric) to service_role;
drop policy if exists "Only admins and managers can read audit logs" on public.audit_logs;
create policy "Only admins and managers can read audit logs" on public.audit_logs as PERMISSIVE for SELECT to authenticated using (is_admin_or_manager());
drop policy if exists client_legacy_debts_select_policy on public.client_legacy_debts;
create policy client_legacy_debts_select_policy on public.client_legacy_debts as PERMISSIVE for SELECT to public using ((organization_id = current_organization_id()));
drop policy if exists "admin manage employees" on public.employees;
create policy "admin manage employees" on public.employees as PERMISSIVE for ALL to authenticated using ((current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text]))) with check ((current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text])));
drop policy if exists employees_select_own_or_authorized on public.employees;
create policy employees_select_own_or_authorized on public.employees as PERMISSIVE for SELECT to authenticated using (((user_id = auth.uid()) OR ((id)::text = (auth.uid())::text) OR (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'manager'::text, 'production_manager'::text, 'production manager'::text, 'ishlab chiqarish boshlig''i'::text, 'accountant'::text, 'buxgalter'::text, 'hisobchi'::text, 'department_head'::text, 'supervisor'::text, 'master'::text, 'bosh usta'::text, 'usta'::text]))));
drop policy if exists "Authenticated users can read own idempotency keys" on public.idempotency_keys;
create policy "Authenticated users can read own idempotency keys" on public.idempotency_keys as PERMISSIVE for SELECT to authenticated using (((actor_id = auth.uid()) OR is_admin_or_manager()));

notify pgrst, 'reload schema';

commit;
