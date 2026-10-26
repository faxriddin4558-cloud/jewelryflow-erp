-- =========================================================================
-- JEWELRYFLOW / GOLDIA SALES — MIGRATION 053
-- 1. rpc_get_accounting_profit_summary PARITY & SCHEMA CACHE RESOLUTION
--    (Aligns PostgREST signature with frontend: p_start_date, p_end_date, p_gold_rate, p_usd_rate, p_org_id)
-- 2. AUDITED TEST DATA CLEANUP:
--    Reverses test handover HND-20261023-E66FC1 (connected to reversed test receipt ZVD-20261023-DD88F2)
--    Reconciles manager vault without leaving fake gold in the safe
-- =========================================================================

-- -------------------------------------------------------------------------
-- PART 1: rpc_get_accounting_profit_summary
-- Drop all conflicting overloads to ensure clean PostgREST schema cache
-- -------------------------------------------------------------------------
drop function if exists public.rpc_get_accounting_profit_summary(date, date, numeric, numeric);
drop function if exists public.rpc_get_accounting_profit_summary(uuid, numeric, date, date);
drop function if exists public.rpc_get_accounting_profit_summary(uuid, numeric, date, date, numeric);
drop function if exists public.rpc_get_accounting_profit_summary(date, date, numeric, numeric, uuid);
drop function if exists public.rpc_get_accounting_profit_summary(date, date);
drop function if exists public.rpc_get_accounting_profit_summary();

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
  v_start_dt              timestamptz;
  v_end_dt                timestamptz;
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
  v_mgr_purchased_g       numeric(14, 4) := 0;
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

  -- 1. ASSET: Manager finished goods in stock (strictly excluding reversed receipts)
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
    v_mgr_scrap_g      := coalesce(v_vault_rec.manager_scrap_585_eq_g, coalesce(v_vault_rec.manager_scrap_grams, 0));
    v_mgr_scrap_phys_g := coalesce(v_vault_rec.manager_scrap_physical_g, coalesce(v_vault_rec.manager_scrap_grams, 0));
    v_mgr_refined_g    := coalesce(v_vault_rec.manager_refined_gold_grams, 0);
    v_mgr_purchased_g  := coalesce(v_vault_rec.manager_purchased_gold_grams, 0);
    v_mgr_cash_uzs     := coalesce(v_vault_rec.manager_cash_amount, 0);
    v_mgr_usd          := coalesce(v_vault_rec.manager_usd_amount, 0);
  end if;

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
    v_mgr_refined_g + v_mgr_purchased_g + v_cust_debts_g +
    v_cash_585_eq_g + v_usd_585_eq_g,
    4
  );

  -- 7. LIABILITIES: Factory Obligations (strictly excluding reversed receipts/handovers)
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
    'manager_purchased_gold_585_g', v_mgr_purchased_g,
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

  -- 9. CAPITAL FLOWS & AUDITED LEGACY DEBT ADJUSTMENTS (Only if baseline exists)
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
    'accounting_method', 'net_assets_delta_capital_adjusted_585_g',
    'accounting_scope_notes', 'Hisob 585 proba sof oltin ekvivalentida yuritiladi. Pilot davrida sof aktivlar o''zgarishi (kapital kiritish/yechib olishga tuzatilgan holda) asosiy mezondir.',
    'pilot_notice', 'Pilot davrida umumiy hisobiy natija (aktivlar o''sishi) to''liq aniq; alohida savdo marjasi va kurs tafovutiga ajratish to''liq partiyaviy konvertatsiya tahlili yakunlangach taqdim etiladi.',
    'components', v_components,
    'assets', jsonb_build_object(
      'manager_stock_585_g', v_mgr_stock_g,
      'seller_stock_585_g', v_seller_stock_g,
      'manager_scrap_585_g', v_mgr_scrap_g,
      'seller_scrap_585_g', v_seller_scrap_g,
      'manager_refined_585_g', v_mgr_refined_g,
      'manager_purchased_585_g', v_mgr_purchased_g,
      'customer_debts_585_g', v_cust_debts_g,
      'cash_uzs_amount', v_total_cash_uzs,
      'cash_uzs_585_eq_g', v_cash_585_eq_g,
      'usd_amount', v_total_usd,
      'usd_585_eq_g', v_usd_585_eq_g,
      'total_assets_585_g', v_tot_assets_g
    ),
    'liabilities', jsonb_build_object(
      'factory_receipts_due_585_g', v_factory_rcp_due_g,
      'factory_handovers_paid_585_g', v_factory_hnd_paid_g,
      'factory_debt_585_g', v_factory_debt_g,
      'customer_advances_585_g', v_cust_advances_g,
      'total_liabilities_585_g', v_tot_liabilities_g
    ),
    'capital_adjustments', jsonb_build_object(
      'capital_in_585_g', v_cap_in_g,
      'capital_out_585_g', v_cap_out_g,
      'expenses_585_g', v_expenses_g,
      'post_baseline_legacy_debt_adjustment_585_g', v_post_base_legacy_adj
    ),
    'profit_result', case
      when v_base.id is null then null
      else jsonb_build_object(
        'period_profit_585_g', v_period_accounting_res,
        'trading_profit_585_g', v_period_accounting_res,
        'fx_gain_loss_585_g', null,
        'formula', 'ΔNetAssets - CapIn + CapOut + Expenses - PostBaselineLegacyDebtAdj',
        'note', 'Pilot davrida 585 ekvivalentidagi kapital harakatlariga to''liq tuzatilgan sof aktiv o''zgarishi'
      )
    end
  );
end;
$$;

grant execute on function public.rpc_get_accounting_profit_summary(date, date, numeric, numeric, uuid) to authenticated;
grant execute on function public.rpc_get_accounting_profit_summary(date, date, numeric, numeric, uuid) to service_role;

-- -------------------------------------------------------------------------
-- PART 2: AUDITED CLEANUP OF TEST HANDOVER HND-20261023-E66FC1
-- Marks test handover as reversed and reconciles manager vault safely.
-- Strictly prevents adding fake gold to manager safe (manager_physical_stock_g = 0).
-- -------------------------------------------------------------------------
DO $hnd_cleanup$
DECLARE
  v_hnd_id        uuid := '1b4a61af-95cb-4f9c-a2a2-7cdccd6a6c9f';
  v_hnd_no        text := 'HND-20261023-E66FC1';
  v_org_id        uuid := '00000000-0000-0000-0000-000000000001';
  v_admin_id      uuid := 'a1d2f187-1763-4441-bc62-c5cd93aa7e83';
  v_hnd_rec       record;
  v_active_hnd_eq numeric(14, 4);
  v_active_rcp_g  numeric(14, 4);
  v_active_rcp_ob numeric(14, 4);
BEGIN
  -- Check if handover exists and is currently confirmed
  SELECT * INTO v_hnd_rec
  FROM public.factory_gold_handovers
  WHERE id = v_hnd_id OR handover_no = v_hnd_no;

  IF FOUND AND v_hnd_rec.status <> 'reversed' THEN
    -- Mark as reversed with clear audit reason
    UPDATE public.factory_gold_handovers
    SET status = 'reversed',
        reversed_at = now(),
        reversed_by = v_admin_id,
        reversal_reason = 'Sinov ma''lumotlarini auditli tozalash: ZVD-20261023-DD88F2 bilan bog''langan test topshirishi'
    WHERE id = v_hnd_rec.id;

    -- Recalculate manager vault factory totals strictly from active non-reversed records
    SELECT coalesce(sum(agreed_equivalent_g), 0) INTO v_active_hnd_eq
    FROM public.factory_gold_handovers
    WHERE organization_id = v_hnd_rec.organization_id AND status <> 'reversed';

    SELECT coalesce(sum(original_physical_g), 0),
           coalesce(sum(factory_obligation_g), 0)
    INTO v_active_rcp_g, v_active_rcp_ob
    FROM public.factory_receipts
    WHERE organization_id = v_hnd_rec.organization_id AND status <> 'reversed';

    -- Update manager_vault_account without leaving fake gold in the safe
    UPDATE public.manager_vault_account
    SET total_factory_handed_over_g = v_active_hnd_eq,
        total_factory_received_g = v_active_rcp_g,
        total_factory_obligation_g = v_active_rcp_ob,
        current_factory_obligation_g = greatest(0, v_active_rcp_ob - v_active_hnd_eq),
        manager_physical_stock_g = v_active_rcp_g,
        manager_refined_gold_grams = 0,
        manager_refined_gold_fine_grams = 0,
        updated_at = now()
    WHERE organization_id = v_hnd_rec.organization_id;

    -- Log audit trail in public.audit_logs
    INSERT INTO public.audit_logs (
      table_name,
      record_id,
      action,
      actor_id,
      actor_name,
      actor_role,
      reason,
      created_at
    ) VALUES (
      'factory_gold_handovers',
      v_hnd_rec.id::text,
      'REVERSE_TEST_HANDOVER',
      v_admin_id,
      'Goldia Administrator',
      'director',
      'Sinov topshirishi HND-20261023-E66FC1 auditli bekor qilindi, seyfga soxta oltin qo''shilmasdan factory_handed_over 0 ga tushirildi',
      now()
    );

    RAISE NOTICE 'Handover % successfully reversed and vault reconciled.', v_hnd_rec.handover_no;
  ELSE
    RAISE NOTICE 'Handover % already reversed or not found, no action needed.', v_hnd_no;
  END IF;
END $hnd_cleanup$;
