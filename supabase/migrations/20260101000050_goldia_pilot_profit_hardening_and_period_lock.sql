-- =============================================================================
-- MIGRATION 050: PILOT PROFIT HARDENING, PERIOD LOCK & HEURISTIC FX SUPPRESSION
--
-- Fixes & Enhancements:
-- 1. Pilot Period Lock:
--    - Enforces calculation strictly from confirmed baseline_date to NOW (real-time).
--    - Rejects any arbitrary historical start or end dates on server and UI.
-- 2. Reliable Accounting Method:
--    - Retains mathematically proven 'net_assets_delta_capital_adjusted_585_g':
--      Period Result = Current Net Assets (585) - Baseline Net Assets (585)
--                    - Capital In (585) + Capital Out (585)
--    - Suppresses speculative separate breakdown of trading margin / FX drift
--      during the pilot until item-by-item double entry ledger snapshots are built.
-- 3. Clear Explanatory Notes & Failure Messaging.
-- =============================================================================

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
  v_today                date := (timezone('Asia/Tashkent', now()))::date;
  v_base                 public.accounting_baselines%rowtype;
  v_rate_585             numeric(18, 2);
  v_rate_usd             numeric(18, 2);
  v_rate_confirmed       boolean := false;
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
  v_start_dt             timestamptz;
  v_end_dt               timestamptz;
  v_components           jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  -- 1. PILOT PERIOD RESTRICTION:
  -- The pilot strictly operates in real-time mode from confirmed baseline to today.
  -- Reject any arbitrary historical end-date
  if p_end_date is not null and p_end_date != v_today then
    return jsonb_build_object(
      'status', 'unsupported_pilot_period',
      'is_computable', false,
      'has_baseline', false,
      'is_complete', false,
      'period_accounting_result_585_g', null,
      'operational_trading_result_585_g', null,
      'fx_valuation_impact_585_g', null,
      'missing_data', jsonb_build_array('Pilot davrida hisob faqat bugungi joriy holatgacha (real-time) hisoblanadi. Oylik tarixiy snapshotlar moduli to''liq joriy etilgunga qadar boshqa tugash sanalari rad etiladi.')
    );
  end if;

  -- 2. Fetch Active Baseline
  select * into v_base
    from public.accounting_baselines
   where organization_id = v_org_id and status = 'active'
   order by baseline_date desc limit 1;

  if v_base.id is not null then
    -- If baseline exists, start date must strictly match baseline date (or be null which defaults to baseline)
    if p_start_date is not null and p_start_date != v_base.baseline_date::date then
      return jsonb_build_object(
        'status', 'unsupported_pilot_period',
        'is_computable', false,
        'has_baseline', true,
        'is_complete', false,
        'period_accounting_result_585_g', null,
        'operational_trading_result_585_g', null,
        'fx_valuation_impact_585_g', null,
        'missing_data', jsonb_build_array('Pilot davrida hisob faqat tasdiqlangan boshlang''ich hisob sanasidan (' || v_base.baseline_date::date::text || ') hozirgi vaqtgacha yuritiladi. Oylik tarixiy snapshotlar moduli to''liq joriy etilgunga qadar boshqa boshlanish sanalari rad etiladi.')
      );
    end if;
    v_start_dt := v_base.baseline_date;
  else
    if p_start_date is not null and p_start_date != v_today then
      return jsonb_build_object(
        'status', 'unsupported_pilot_period',
        'is_computable', false,
        'has_baseline', false,
        'is_complete', false,
        'period_accounting_result_585_g', null,
        'operational_trading_result_585_g', null,
        'fx_valuation_impact_585_g', null,
        'missing_data', jsonb_build_array('Boshlang''ich hisob hali tasdiqlanmagan. Pilot davrida faqat joriy jonli ko''rinish (live preview) mavjud.')
      );
    end if;
    v_start_dt := timezone('Asia/Tashkent', now());
    v_missing := array_append(v_missing, 'ERR_BASELINE_NOT_SET: Boshlang''ich hisob hali tasdiqlanmagan. Quyida joriy ombor va aktivlar tarkibi ko''rsatilgan.');
  end if;

  v_end_dt := now();

  -- 3. Daily Gold Rate (Asia/Tashkent)
  select rate_per_gram, is_confirmed into v_rate_585, v_rate_confirmed
    from public.daily_gold_rates
   where organization_id = v_org_id
     and proba = 585
     and rate_date = v_today
     and is_confirmed = true
   order by created_at desc
   limit 1;

  if v_rate_585 is null or v_rate_585 <= 0 then
    if p_gold_rate is not null and p_gold_rate > 0 then
      v_rate_585 := round(p_gold_rate::numeric, 2);
      v_rate_confirmed := false;
      v_missing := array_append(v_missing, 'Bugungi (' || v_today::text || ') 585 oltin kursi tasdiqlanmagan (vaqtinchalik kurs ishlatilmoqda).');
    else
      v_rate_confirmed := false;
      v_missing := array_append(v_missing, 'ERR_DAILY_GOLD_RATE_NOT_CONFIRMED: Bugungi (' || v_today::text || ') 585 oltin kursi kiritilmagan yoki tasdiqlanmagan.');
    end if;
  end if;

  -- 4. Manager stock & vault (ALWAYS READ FOR LIVE PREVIEW)
  perform public._get_or_create_manager_vault(v_org_id);
  v_mgr_finished_g := public.get_manager_available_stock_grams(v_org_id);

  select coalesce(manager_scrap_585_eq_g, manager_scrap_grams, 0),
         coalesce(manager_scrap_physical_g, manager_scrap_grams, 0),
         coalesce(manager_refined_gold_grams, 0),
         coalesce(manager_purchased_gold_grams, 0),
         coalesce(current_factory_obligation_g, 0),
         coalesce(manager_cash_amount, 0),
         coalesce(manager_usd_amount, 0)
    into v_mgr_scrap_585_eq_g,
         v_mgr_scrap_physical_g,
         v_mgr_refined_g,
         v_mgr_purchased_g,
         v_factory_obligation_g,
         v_mgr_cash_uzs,
         v_mgr_cash_usd
    from public.manager_vault_account
   where organization_id = v_org_id;

  -- 5. Sellers stock and tills
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

  -- USD Rate Resolution
  if p_usd_rate is not null and p_usd_rate > 0 then
    v_rate_usd := round(p_usd_rate::numeric, 2);
  elsif v_cash_usd_total > 0 then
    v_missing := array_append(v_missing, 'ERR_USD_RATE_NOT_SET: Kassalarda dollar (USD) mavjud, bugungi USD kursi kiritilishi shart.');
  else
    v_rate_usd := null;
  end if;

  -- 6. Customer debts and advances
  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_customer_debts_g, v_customer_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  -- 7. Currency equivalents at current rate (if rate available)
  if v_rate_585 is not null and v_rate_585 > 0 then
    v_cash_uzs_585_eq_g := round((v_cash_uzs_total / v_rate_585)::numeric, 4);
    if v_cash_usd_total > 0 and v_rate_usd is not null and v_rate_usd > 0 then
      v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);
    else
      v_cash_usd_585_eq_g := 0;
    end if;

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
  else
    v_cash_uzs_585_eq_g := null;
    v_cash_usd_585_eq_g := null;
    v_total_assets_g := null;
    v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g, 4);
    v_cur_net_assets_g := null;
  end if;

  v_components := jsonb_build_object(
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
  );

  -- If baseline is missing OR critical rates missing, return PREVIEW with clear explanation
  if v_base.id is null or array_length(v_missing, 1) > 0 then
    return jsonb_build_object(
      'status', case when v_base.id is null then 'baseline_not_set' else 'incomplete' end,
      'has_baseline', (v_base.id is not null),
      'is_complete', false,
      'is_computable', false,
      'as_of_time', timezone('Asia/Tashkent', now()),
      'missing_data', to_jsonb(v_missing),
      'rates', jsonb_build_object(
        'gold_rate_585', v_rate_585,
        'is_confirmed', (v_rate_confirmed and v_rate_585 is not null),
        'usd_rate', v_rate_usd,
        'rate_date', v_today
      ),
      'current_net_assets_585_g', v_cur_net_assets_g,
      'current_total_assets_585_g', v_total_assets_g,
      'current_total_liabilities_585_g', v_total_liabilities_g,
      'period_accounting_result_585_g', null,
      'operational_trading_result_585_g', null,
      'fx_valuation_impact_585_g', null,
      'accounting_method', 'net_assets_delta_capital_adjusted_585_g',
      'pilot_notice', 'Pilot davrida umumiy hisobiy natija (aktivlar o''sishi) to''liq aniq; alohida savdo marjasi va kurs tafovutiga ajratish to''liq partiyaviy konvertatsiya tahlili yakunlangach taqdim etiladi.',
      'components', v_components
    );
  end if;

  -- 8. Capital & Expense movements in period
  select coalesce(sum(case when transaction_type = 'capital_contribution' then equiv_585_grams else 0 end), 0),
         coalesce(sum(case when transaction_type = 'capital_distribution' then equiv_585_grams else 0 end), 0),
         coalesce(sum(case when transaction_type = 'business_expense' then equiv_585_grams else 0 end), 0)
    into v_cap_in_g, v_cap_out_g, v_expenses_g
    from public.financial_transactions
   where organization_id = v_org_id
     and created_at >= v_start_dt
     and created_at <= v_end_dt;

  -- 9. Period Accounting Result (Strict 585g Capital Change)
  v_period_accounting_res := round(
    v_cur_net_assets_g - v_base.net_assets_585_g - v_cap_in_g + v_cap_out_g,
    4
  );

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
      'usd_rate', v_rate_usd,
      'rate_date', v_today
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
    'fx_valuation_impact_585_g', null,
    'operational_trading_result_585_g', null,
    'capital_contributions_585_g', v_cap_in_g,
    'capital_distributions_585_g', v_cap_out_g,
    'business_expenses_585_g', v_expenses_g,
    'accounting_method', 'net_assets_delta_capital_adjusted_585_g',
    'accounting_scope_notes', 'Hisob 585 proba sof oltin ekvivalentida yuritiladi. Pilot davrida sof aktivlar o''zgarishi (kapital kiritish/yechib olishga tuzatilgan holda) asosiy mezondir.',
    'pilot_notice', 'Pilot davrida umumiy hisobiy natija (aktivlar o''sishi) to''liq aniq; alohida savdo marjasi va kurs tafovutiga ajratish to''liq partiyaviy konvertatsiya tahlili yakunlangach taqdim etiladi.',
    'components', v_components
  );
end;
$$;

grant execute on function public.rpc_get_accounting_profit_summary(date, date, numeric, numeric) to authenticated;
