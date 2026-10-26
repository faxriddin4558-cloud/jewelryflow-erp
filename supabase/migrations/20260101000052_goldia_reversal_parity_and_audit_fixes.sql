-- =========================================================================
-- JEWELRYFLOW / GOLDIA SALES — MIGRATION 052
-- REVERSAL PARITY, FACTORY VAULT RECONCILIATION, REVERSAL RPC HARDENING,
-- FUNCTION OVERLOAD RESOLUTION & AUDITED BALANCE REPAIR
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. DROP OBSOLETE OVERLOADS OF rpc_get_accounting_profit_summary
-- PostgREST PGRST203 fix: resolve candidate function ambiguity
-- -------------------------------------------------------------------------
drop function if exists public.rpc_get_accounting_profit_summary(date, date, numeric, numeric);
drop function if exists public.rpc_get_accounting_profit_summary(uuid, numeric, date, date);
drop function if exists public.rpc_get_accounting_profit_summary();

create or replace function public.rpc_get_accounting_profit_summary(
  p_org_id      uuid default null,
  p_gold_rate   numeric default null,
  p_start_date  date default null,
  p_end_date    date default null
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
  v_seller_scrap_g        numeric(14, 4) := 0;
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
  v_period_accounting_res numeric(14, 4) := 0;
  v_seller_rec            record;
  v_vault_rec             public.manager_vault_account%rowtype;
begin
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

  select usd_rate into v_usd_rate
  from public.accounting_baselines
  where organization_id = v_org_id
  order by baseline_date desc, created_at desc
  limit 1;

  if v_usd_rate is null or v_usd_rate <= 0 then
    v_usd_rate := 12800.00;
  end if;

  if p_gold_rate is not null and p_gold_rate > 0 and (v_gold_rate_585 is null or not v_rate_confirmed) then
    v_gold_rate_585 := round(p_gold_rate::numeric, 2);
    v_rate_confirmed := false;
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
    v_mgr_scrap_g     := coalesce(v_vault_rec.manager_scrap_585_eq_g, coalesce(v_vault_rec.manager_scrap_grams, 0));
    v_mgr_refined_g   := coalesce(v_vault_rec.manager_refined_gold_grams, 0);
    v_mgr_purchased_g := coalesce(v_vault_rec.manager_purchased_gold_grams, 0);
    v_mgr_cash_uzs    := coalesce(v_vault_rec.manager_cash_amount, 0);
    v_mgr_usd         := coalesce(v_vault_rec.manager_usd_amount, 0);
  end if;

  -- 4. ASSET: Seller Till Holdings
  for v_seller_rec in
    select coalesce(seller_till_scrap_585_eq_g, coalesce(seller_till_scrap_grams, 0)) as scrap_585,
           coalesce(seller_till_cash_amount, 0) as cash_uzs,
           coalesce(seller_till_usd_amount, 0) as cash_usd
    from public.seller_gold_accounts
    where organization_id = v_org_id
  loop
    v_seller_scrap_g  := v_seller_scrap_g + v_seller_rec.scrap_585;
    v_seller_cash_uzs := v_seller_cash_uzs + v_seller_rec.cash_uzs;
    v_seller_usd      := v_seller_usd + v_seller_rec.cash_usd;
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
    'status', 'ok',
    'is_computable', true,
    'is_complete', (v_gold_rate_585 is not null and v_gold_rate_585 > 0 and v_rate_confirmed),
    'as_of_date', v_today,
    'as_of_timestamp', clock_timestamp(),
    'has_active_baseline', (v_base.id is not null),
    'baseline_id', v_base.id,
    'baseline_date', v_base.baseline_date,
    'applied_gold_rate_585', v_gold_rate_585,
    'is_rate_confirmed', v_rate_confirmed,
    'applied_usd_rate', v_usd_rate,
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
    'net_assets_585_g', v_cur_net_assets_g,
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

grant execute on function public.rpc_get_accounting_profit_summary(uuid, numeric, date, date) to authenticated;


-- -------------------------------------------------------------------------
-- 2. HARDEN rpc_reverse_factory_gold_handover
-- Fixes:
-- A) Replaces invalid v_hnd.handover_material_type with v_hnd.source_type (SQLSTATE 42703 fix)
-- B) Atomically restores manager vault holdings across refined, purchased, and scrap gold
-- C) Atomically decrements total_factory_handed_over_g and restores current_factory_obligation_g
-- -------------------------------------------------------------------------
drop function if exists public.rpc_reverse_factory_gold_handover(uuid, text, text);
create or replace function public.rpc_reverse_factory_gold_handover(
  p_handover_id     uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := nullif(btrim(p_reason), '');
  v_hnd             public.factory_gold_handovers%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_payload         jsonb;
  v_existing        jsonb;
  v_src             text;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Zavodga topshirishni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_factory_gold_handover',
    'handover_id', p_handover_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_factory_gold_handover', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_hnd
  from public.factory_gold_handovers
  where id = p_handover_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Zavodga oltin topshirish hujjati topilmadi: %', p_handover_id;
  end if;

  if v_hnd.status = 'reversed' then
    raise exception 'Ushbu zavodga topshirish hujjati allaqachon bekor qilingan (%s)', v_hnd.handover_no;
  end if;

  -- Lock manager vault
  perform public._get_or_create_manager_vault(v_caller_org);
  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_caller_org
  for update;

  v_src := coalesce(v_hnd.source_type, 'refined_gold');

  -- Restore handed-over gold to manager vault according to source_type
  if v_src = 'refined_gold' then
    update public.manager_vault_account
       set manager_refined_gold_grams = round((manager_refined_gold_grams + v_hnd.agreed_equivalent_g)::numeric, 4),
           manager_refined_gold_fine_grams = round((coalesce(manager_refined_gold_fine_grams, 0) + coalesce(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  elsif v_src = 'purchased_gold' then
    update public.manager_vault_account
       set manager_purchased_gold_grams = round((manager_purchased_gold_grams + v_hnd.agreed_equivalent_g)::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  else -- scrap_gold or scrap
    update public.manager_vault_account
       set manager_scrap_grams = round((manager_scrap_grams + coalesce(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           manager_scrap_physical_g = round((coalesce(manager_scrap_physical_g, 0) + coalesce(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           manager_scrap_585_eq_g = round((coalesce(manager_scrap_585_eq_g, 0) + v_hnd.agreed_equivalent_g)::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  end if;

  -- Atomically update factory obligation totals on manager vault
  update public.manager_vault_account
     set total_factory_handed_over_g = round(greatest(0, total_factory_handed_over_g - v_hnd.agreed_equivalent_g), 4),
         current_factory_obligation_g = round(greatest(0, total_factory_obligation_g - greatest(0, total_factory_handed_over_g - v_hnd.agreed_equivalent_g)), 4),
         updated_at = now()
   where organization_id = v_caller_org;

  -- Mark handover as reversed
  update public.factory_gold_handovers
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = p_handover_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'factory_gold_handovers', p_handover_id::text,
    'REVERSE_FACTORY_GOLD_HANDOVER', auth.uid(),
    jsonb_build_object('handover_no', v_hnd.handover_no, 'source_type', v_hnd.source_type, 'agreed_eq_g', v_hnd.agreed_equivalent_g),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'handover_id', p_handover_id,
    'handover_no', v_hnd.handover_no,
    'restored_gold_grams', v_hnd.agreed_equivalent_g,
    'reason', v_clean_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_factory_gold_handover', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_factory_gold_handover(uuid, text, text) to authenticated;


-- -------------------------------------------------------------------------
-- 3. HARDEN rpc_reverse_factory_receipt
-- Atomically updates manager_vault_account factory received and obligation balances
-- -------------------------------------------------------------------------
drop function if exists public.rpc_reverse_factory_receipt(uuid, text, text);
create or replace function public.rpc_reverse_factory_receipt(
  p_receipt_id      uuid,
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
  v_rcp              public.factory_receipts%rowtype;
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Fabrika qabulini bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_factory_receipt',
    'receipt_id', p_receipt_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_factory_receipt', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_rcp
    from public.factory_receipts
   where id = p_receipt_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Fabrika qabuli topilmadi (%)', p_receipt_id;
  end if;

  if v_rcp.status = 'reversed' then
    raise exception 'Ushbu fabrika qabuli allaqachon bekor qilingan (%s)', v_rcp.receipt_no;
  end if;

  -- Dependency Guard: Check if gold was already transferred to consignment
  if coalesce(v_rcp.transferred_physical_g, 0) > 0.0001 or v_rcp.available_physical_g < (v_rcp.original_physical_g - 0.0001) then
    raise exception 'Fabrika qabulini bekor qilib bo''lmaydi: ushbu partiyadan tovarlar allaqachon konsignatsiyaga tarqatilgan (% g). Avval bog''langan konsignatsiyalarni bekor qiling.',
      v_rcp.transferred_physical_g;
  end if;

  -- Mark receipt as reversed
  update public.factory_receipts
     set status          = 'reversed',
         available_physical_g = 0,
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = v_clean_reason,
         updated_at      = now()
   where id = p_receipt_id;

  -- Atomically update manager vault account balances
  perform public._get_or_create_manager_vault(v_caller_org);
  update public.manager_vault_account
     set total_factory_received_g   = round(greatest(0, total_factory_received_g - v_rcp.original_physical_g), 4),
         total_factory_obligation_g = round(greatest(0, total_factory_obligation_g - v_rcp.factory_obligation_g), 4),
         current_factory_obligation_g = round(greatest(0, greatest(0, total_factory_obligation_g - v_rcp.factory_obligation_g) - total_factory_handed_over_g), 4),
         manager_physical_stock_g   = round(greatest(0, coalesce(manager_physical_stock_g, 0) - v_rcp.original_physical_g), 4),
         updated_at = now()
   where organization_id = v_caller_org;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) values (
    v_caller_org, 'factory_receipts', v_rcp.id::text, 'REVERSE_FACTORY_RECEIPT', auth.uid(),
    jsonb_build_object(
      'receipt_no', v_rcp.receipt_no,
      'original_physical_g', v_rcp.original_physical_g,
      'factory_obligation_g', v_rcp.factory_obligation_g,
      'product_name', v_rcp.product_name
    ),
    jsonb_build_object(
      'status', 'reversed',
      'available_physical_g', 0
    ),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_rcp.id,
    'receipt_no', v_rcp.receipt_no,
    'deducted_obligation_grams', v_rcp.factory_obligation_g,
    'deducted_physical_grams', v_rcp.original_physical_g,
    'reason', v_clean_reason
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_factory_receipt', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_factory_receipt(uuid, text, text) to authenticated;


-- -------------------------------------------------------------------------
-- 4. HARDEN rpc_reverse_client_settlement
-- Comprehensive multi-currency, physical/585 scrap, and customer advance rollback
-- -------------------------------------------------------------------------
drop function if exists public.rpc_reverse_client_settlement(uuid, text, text);
create or replace function public.rpc_reverse_client_settlement(
  p_settlement_id    uuid,
  p_reason           text default 'Audited Compensating Reversal',
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org       uuid := public.current_organization_id();
  v_caller_emp_id    uuid := public.current_employee_id();
  v_settle           public.gold_settlements%rowtype;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_client_acc       public.client_gold_accounts%rowtype;
  v_payload          jsonb;
  v_existing         jsonb;
  v_scrap_phys       numeric(14, 4);
  v_scrap_585        numeric(14, 4);
  v_cash_uzs         numeric(18, 2);
  v_cash_usd         numeric(18, 2);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  v_payload := jsonb_build_object(
    'action', 'reverse_client_settlement',
    'settlement_id', p_settlement_id,
    'reason', p_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_settle
    from public.gold_settlements
   where id = p_settlement_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'To''lov yozuvi (%) topilmadi', p_settlement_id;
  end if;

  if v_settle.status = 'reversed' then
    return jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'settlement_id', v_settle.id,
      'message', 'To''lov avval bekor qilingan'
    );
  end if;

  v_scrap_phys := round(coalesce(v_settle.physical_scrap_grams, v_settle.scrap_weight_grams, 0)::numeric, 4);
  v_scrap_585  := round(coalesce(v_settle.scrap_585_equiv_grams, v_settle.scrap_weight_grams, 0)::numeric, 4);
  v_cash_uzs   := round(coalesce(v_settle.cash_paid_amount, 0)::numeric, 2);
  v_cash_usd   := round(coalesce(v_settle.usd_paid_amount, 0)::numeric, 2);

  -- Verify seller till has sufficient scrap, UZS cash, and USD
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id
     and organization_id = v_caller_org
   for update;

  if found then
    if v_scrap_phys > 0 and coalesce(v_seller_acc.seller_till_scrap_physical_g, v_seller_acc.seller_till_scrap_grams, 0) < v_scrap_phys then
      raise exception 'To''lovni bekor qilib bo''lmaydi: Sotuvchi kassasidagi fizik lom yetarli emas (Mavjud: % g, Talab: % g). Avval boshqaruvchiga topshirilgan lomni qaytaring.',
        coalesce(v_seller_acc.seller_till_scrap_physical_g, v_seller_acc.seller_till_scrap_grams, 0), v_scrap_phys;
    end if;

    if v_cash_uzs > 0 and coalesce(v_seller_acc.seller_till_cash_amount, 0) < v_cash_uzs then
      raise exception 'To''lovni bekor qilib bo''lmaydi: Sotuvchi kassasidagi naqd so''m yetarli emas (Mavjud: % UZS, Talab: % UZS).',
        v_seller_acc.seller_till_cash_amount, v_cash_uzs;
    end if;

    if v_cash_usd > 0 and coalesce(v_seller_acc.seller_till_usd_amount, 0) < v_cash_usd then
      raise exception 'To''lovni bekor qilib bo''lmaydi: Sotuvchi kassasidagi naqd USD yetarli emas (Mavjud: % USD, Talab: % USD).',
        v_seller_acc.seller_till_usd_amount, v_cash_usd;
    end if;

    -- Deduct ALL till holdings
    update public.seller_gold_accounts
       set seller_till_scrap_grams       = round(greatest(0, seller_till_scrap_grams - coalesce(v_settle.scrap_weight_grams, 0))::numeric, 4),
           seller_till_scrap_physical_g  = round(greatest(0, coalesce(seller_till_scrap_physical_g, 0) - v_scrap_phys)::numeric, 4),
           seller_till_scrap_585_eq_g    = round(greatest(0, coalesce(seller_till_scrap_585_eq_g, 0) - v_scrap_585)::numeric, 4),
           seller_till_cash_amount       = round(greatest(0, seller_till_cash_amount - v_cash_uzs)::numeric, 2),
           seller_till_usd_amount        = round(greatest(0, coalesce(seller_till_usd_amount, 0) - v_cash_usd)::numeric, 2),
           updated_at                    = now()
     where seller_id = v_settle.seller_id;
  end if;

  -- Restore customer debt and reverse excess advance in client_gold_accounts
  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_settle.customer_id
     and organization_id = v_caller_org
   for update;

  if found then
    update public.client_gold_accounts
       set current_debt_grams    = round((current_debt_grams + v_settle.applied_to_debt_grams)::numeric, 4),
           advance_balance_grams = round(greatest(0, advance_balance_grams - v_settle.excess_gold_grams)::numeric, 4),
           total_settled_grams   = round(greatest(0, total_settled_grams - v_settle.total_settled_grams)::numeric, 4),
           total_scrap_paid_grams= round(greatest(0, total_scrap_paid_grams - coalesce(v_settle.scrap_weight_grams, 0))::numeric, 4),
           total_cash_paid_amount= round(greatest(0, total_cash_paid_amount - v_cash_uzs)::numeric, 2),
           total_cash_equiv_grams= round(greatest(0, total_cash_equiv_grams - coalesce(v_settle.cash_equivalent_grams, 0))::numeric, 4),
           updated_at            = now()
     where customer_id = v_settle.customer_id;
  end if;

  -- Also reverse advance on customers table
  update public.customers
     set advance_balance_gold_grams = round(greatest(0, coalesce(advance_balance_gold_grams, 0) - v_settle.excess_gold_grams)::numeric, 4)
   where id = v_settle.customer_id;

  -- If linked to a specific piece sale, restore sale's settled and remaining gold balance
  if v_settle.sale_id is not null then
    update public.jewelry_sales
       set settled_gold_grams   = round(greatest(0, settled_gold_grams - v_settle.applied_to_debt_grams)::numeric, 4),
           remaining_gold_grams = round((remaining_gold_grams + v_settle.applied_to_debt_grams)::numeric, 4),
           status               = case
             when round((remaining_gold_grams + v_settle.applied_to_debt_grams)::numeric, 4) >= (base_weight_grams - 0.0001) then 'unpaid'
             else 'partial'
           end,
           updated_at           = now()
     where id = v_settle.sale_id;
  end if;

  -- Mark settlement as reversed
  update public.gold_settlements
     set status          = 'reversed',
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = p_reason
   where id = p_settlement_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) values (
    v_caller_org, 'gold_settlements', v_settle.id::text, 'REVERSE_CLIENT_SETTLEMENT', auth.uid(),
    jsonb_build_object(
      'settlement_no', v_settle.settlement_no,
      'total_settled_grams', v_settle.total_settled_grams,
      'physical_scrap_grams', v_scrap_phys,
      'cash_paid_amount', v_cash_uzs,
      'usd_paid_amount', v_cash_usd
    ),
    jsonb_build_object('status', 'reversed'),
    p_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle.id,
    'settlement_no', v_settle.settlement_no,
    'restored_debt_grams', v_settle.applied_to_debt_grams,
    'deducted_advance_grams', v_settle.excess_gold_grams,
    'deducted_seller_scrap_g', v_scrap_phys,
    'deducted_seller_cash_uzs', v_cash_uzs,
    'deducted_seller_cash_usd', v_cash_usd,
    'reason', p_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_settlement', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_client_settlement(uuid, text, text) to authenticated;


-- -------------------------------------------------------------------------
-- 5. HARDEN rpc_issue_barcode_consignment
-- Supports custom p_factory_markup_pct and p_seller_markup_pct with full parity
-- -------------------------------------------------------------------------
drop function if exists public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text, uuid);
drop function if exists public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text, uuid, numeric);

create or replace function public.rpc_issue_barcode_consignment(
  p_seller_id          uuid,
  p_factory_markup_pct numeric default 0,
  p_pieces             jsonb default '[]'::jsonb,
  p_notes              text default null,
  p_idempotency_key    text default null,
  p_factory_receipt_id uuid default null,
  p_seller_markup_pct  numeric default 12.00
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_factory_pct       numeric(6, 2) := round(coalesce(p_factory_markup_pct, 0)::numeric, 2);
  v_seller_pct        numeric(6, 2) := round(coalesce(p_seller_markup_pct, 12.00)::numeric, 2);
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
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'inventory_manager'
  ]);

  if jsonb_array_length(p_pieces) = 0 then
    raise exception 'Kamida 1 ta mahsulot dona skaner qilinishi shart';
  end if;

  if v_factory_pct < 0 then
    raise exception 'Zavod ustama foizi manfiy bo''lishi mumkin emas';
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
  v_factory_due := round((v_total_base_weight * (1.0 + v_factory_pct / 100.0))::numeric, 4);
  v_seller_due  := round((v_total_base_weight * (1.0 + v_seller_pct / 100.0))::numeric, 4);

  -- Deduct manager physical stock from factory_receipt
  if v_receipt_id is not null then
    select * into v_receipt_rec
    from public.factory_receipts
    where id = v_receipt_id and organization_id = v_caller_org and status <> 'reversed'
    for update;

    if not found then
      raise exception 'Belgilangan zavod kirim hujjati (%) topilmadi yoki bekor qilingan', v_receipt_id;
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
  end if;

  -- Deduct from manager vault physical stock
  perform public._get_or_create_manager_vault(v_caller_org);
  update public.manager_vault_account
     set manager_physical_stock_g = round(greatest(0, coalesce(manager_physical_stock_g, 0) - v_total_base_weight), 4),
         updated_at = now()
   where organization_id = v_caller_org;

  v_consignment_no := 'CONS-BC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.seller_consignments (
    organization_id, consignment_no, seller_id, factory_receipt_id, product_id, product_name,
    quantity, base_weight_grams, proba, factory_markup_pct,
    factory_gold_due_grams, factory_settled_gold_grams, factory_remaining_gold_grams,
    seller_markup_pct, seller_obligation_g,
    sold_quantity, status, idempotency_key, notes, pieces
  ) values (
    v_caller_org, v_consignment_no, v_seller.id, v_receipt_id, null,
    'Skanerlangan Partiya (' || v_total_qty || ' dona)',
    v_total_qty, v_total_base_weight, 585.00, v_factory_pct,
    v_factory_due, 0, v_factory_due,
    v_seller_pct, v_seller_due,
    0, 'held_by_seller', nullif(btrim(p_idempotency_key), ''), p_notes, p_pieces
  ) returning id into v_consignment_id;

  for v_piece_elem in select * from jsonb_array_elements(p_pieces) loop
    v_piece_id := gen_random_uuid();
    v_model_id := nullif(v_piece_elem->>'model_id', '')::uuid;
    v_model_code := coalesce(v_piece_elem->>'model_code', 'M-GENERIC');
    v_model_name := coalesce(v_piece_elem->>'model_name', 'Zargarlik Buyumi');
    v_category := coalesce(v_piece_elem->>'category', 'Серьги');
    v_purity := coalesce((v_piece_elem->>'purity')::numeric, 585.00);
    v_weight := round((v_piece_elem->>'weight_grams')::numeric, 4);
    v_raw_barcode := coalesce(v_piece_elem->>'raw_barcode', v_piece_elem->>'weight_grams');
    v_piece_seller_obl := round((v_weight * (1.0 + v_seller_pct / 100.0))::numeric, 4);

    insert into public.consignment_pieces (
      id, organization_id, consignment_id, model_id, model_code, model_name,
      category, purity, weight_grams, status, seller_id, raw_barcode, notes,
      seller_markup_pct, seller_obligation_grams
    ) values (
      v_piece_id, v_caller_org, v_consignment_id, v_model_id, v_model_code, v_model_name,
      v_category, v_purity, v_weight, 'held_by_seller', v_seller.id, v_raw_barcode, p_notes,
      v_seller_pct, v_piece_seller_obl
    );

    v_inserted_pieces := v_inserted_pieces || jsonb_build_object(
      'id', v_piece_id,
      'model_code', v_model_code,
      'model_name', v_model_name,
      'weight_grams', v_weight,
      'seller_obligation_grams', v_piece_seller_obl
    );
  end loop;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'consignment_id', v_consignment_id,
    'consignment_no', v_consignment_no,
    'seller_id', v_seller.id,
    'pieces_count', v_total_qty,
    'base_weight_grams', v_total_base_weight,
    'factory_markup_pct', v_factory_pct,
    'factory_gold_due_grams', v_factory_due,
    'seller_markup_pct', v_seller_pct,
    'seller_obligation_g', v_seller_due,
    'pieces', v_inserted_pieces
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_issue_barcode_consignment', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text, uuid, numeric) to authenticated;


-- -------------------------------------------------------------------------
-- 6. HARDEN SELECTIVE TEST CLEANUP RPCS (Role Permissions)
-- Allow all director and manager aliases to avoid false 42501 permission denied
-- -------------------------------------------------------------------------
drop function if exists public.rpc_preview_selective_test_cleanup(uuid[]);
create or replace function public.rpc_preview_selective_test_cleanup(
  p_receipt_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org     uuid := public.current_organization_id();
  v_preview_token  text;
  v_tot_phys_g     numeric(14, 4) := 0;
  v_tot_obl_g      numeric(14, 4) := 0;
  v_blocked_items  jsonb := '[]'::jsonb;
  v_clean_items    jsonb := '[]'::jsonb;
  v_r_id           uuid;
  v_r_rec          public.factory_receipts%rowtype;
  v_sold_count     int;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  if p_receipt_ids is null or array_length(p_receipt_ids, 1) = 0 then
    select coalesce(array_agg(id), array[]::uuid[])
    into p_receipt_ids
    from public.factory_receipts
    where organization_id = v_caller_org and status <> 'reversed';
  end if;

  v_preview_token := 'CLN-PREV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  if p_receipt_ids is not null then
    foreach v_r_id in array p_receipt_ids loop
      select * into v_r_rec
      from public.factory_receipts
      where id = v_r_id and organization_id = v_caller_org;

      if found then
        if v_r_rec.status = 'reversed' then
          continue;
        end if;

        select count(*) into v_sold_count
        from public.consignment_pieces cp
        join public.seller_consignments sc on sc.id = cp.consignment_id
        where sc.factory_receipt_id = v_r_id and cp.status in ('sold', 'client_sale');

        if v_sold_count > 0 then
          v_blocked_items := v_blocked_items || jsonb_build_object(
            'receipt_id', v_r_rec.id,
            'receipt_no', v_r_rec.receipt_no,
            'product_name', v_r_rec.product_name,
            'blocked_reason', format('Ushbu partiyadan %s dona buyum mijozlarga sotilgan. Sotuv bekor qilinmasdan tozalash mumkin emas.', v_sold_count)
          );
        elsif v_r_rec.transferred_physical_g > 0.0001 then
          v_blocked_items := v_blocked_items || jsonb_build_object(
            'receipt_id', v_r_rec.id,
            'receipt_no', v_r_rec.receipt_no,
            'product_name', v_r_rec.product_name,
            'blocked_reason', format('Ushbu partiya sotuvchilarga tarqatilgan (%s g). Avval konsignatsiyani bekor qiling.', v_r_rec.transferred_physical_g)
          );
        else
          v_clean_items := v_clean_items || jsonb_build_object(
            'receipt_id', v_r_rec.id,
            'receipt_no', v_r_rec.receipt_no,
            'product_name', v_r_rec.product_name,
            'physical_g', v_r_rec.original_physical_g,
            'obligation_g', v_r_rec.factory_obligation_g,
            'status', v_r_rec.status
          );
          v_tot_phys_g := v_tot_phys_g + v_r_rec.original_physical_g;
          v_tot_obl_g  := v_tot_obl_g + v_r_rec.factory_obligation_g;
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'preview_token', v_preview_token,
    'cleanable_items', v_clean_items,
    'blocked_items', v_blocked_items,
    'summary', jsonb_build_object(
      'cleanable_count', jsonb_array_length(v_clean_items),
      'blocked_count', jsonb_array_length(v_blocked_items),
      'inventory_reduction_585_g', v_tot_phys_g,
      'factory_obligation_reduction_g', v_tot_obl_g
    )
  );
end;
$$;

grant execute on function public.rpc_preview_selective_test_cleanup(uuid[]) to authenticated;

drop function if exists public.rpc_execute_selective_test_cleanup(uuid[], text, text);
create or replace function public.rpc_execute_selective_test_cleanup(
  p_receipt_ids       uuid[],
  p_reason            text default null,
  p_confirmation_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org     uuid := public.current_organization_id();
  v_clean_reason   text := nullif(btrim(p_reason), '');
  v_r_id           uuid;
  v_rev_res        jsonb;
  v_cleaned_count  int := 0;
  v_tot_obl_g      numeric(14, 4) := 0;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  if p_confirmation_code is null or btrim(p_confirmation_code) <> 'CONFIRM_TEST_CLEANUP_2026' then
    raise exception 'Xavfsizlik tasdiqlash kodi noto''g''ri. Talab qilinadi: CONFIRM_TEST_CLEANUP_2026';
  end if;

  if v_clean_reason is null then
    raise exception 'Sinov ma''lumotlarini tozalash sababi (audit uchun) kiritilishi shart';
  end if;

  if p_receipt_ids is null or array_length(p_receipt_ids, 1) = 0 then
    raise exception 'Tozalanadigan sinov partiyalari tanlanmagan';
  end if;

  foreach v_r_id in array p_receipt_ids loop
    v_rev_res := public.rpc_reverse_factory_receipt(v_r_id, v_clean_reason, null);
    v_cleaned_count := v_cleaned_count + 1;
    v_tot_obl_g := v_tot_obl_g + coalesce((v_rev_res->>'deducted_obligation_grams')::numeric, 0);
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'cleaned_receipts_count', v_cleaned_count,
    'total_deducted_obligation_g', v_tot_obl_g,
    'reason', v_clean_reason,
    'message', format('%s ta sinov partiyasi muvaffaqiyatli tozalandi (bekor qilindi).', v_cleaned_count)
  );
end;
$$;

grant execute on function public.rpc_execute_selective_test_cleanup(uuid[], text, text) to authenticated;


-- -------------------------------------------------------------------------
-- 7. AUDITED RECONCILIATION & BALANCE REPAIR
-- A) Fix seller till physical/585 scrap remnants caused by old settlement reversals
-- B) Fix manager vault account totals caused by un-deducted factory receipt reversals
-- -------------------------------------------------------------------------
do $$
declare
  v_org uuid;
begin
  for v_org in select id from public.organizations loop
    -- 1. Reconcile seller tills
    update public.seller_gold_accounts s
    set seller_till_scrap_physical_g = round(greatest(0,
          coalesce((
            select sum(coalesce(g.physical_scrap_grams, g.scrap_weight_grams, 0))
            from public.gold_settlements g
            where g.seller_id = s.seller_id
              and g.direction = 'client_to_seller'
              and g.status <> 'reversed'
          ), 0) - coalesce((
            select sum(coalesce(m.scrap_weight_grams, 0))
            from public.gold_settlements m
            where m.seller_id = s.seller_id
              and m.direction = 'seller_to_manager'
              and m.status <> 'reversed'
          ), 0)
        )::numeric, 4),
        seller_till_scrap_585_eq_g = round(greatest(0,
          coalesce((
            select sum(coalesce(g.scrap_585_equiv_grams, g.scrap_weight_grams, 0))
            from public.gold_settlements g
            where g.seller_id = s.seller_id
              and g.direction = 'client_to_seller'
              and g.status <> 'reversed'
          ), 0) - coalesce((
            select sum(coalesce(m.scrap_585_equiv_grams, m.scrap_weight_grams, 0))
            from public.gold_settlements m
            where m.seller_id = s.seller_id
              and m.direction = 'seller_to_manager'
              and m.status <> 'reversed'
          ), 0)
        )::numeric, 4),
        updated_at = now()
    where s.organization_id = v_org;

    -- 2. Reconcile manager vault account
    update public.manager_vault_account v
    set total_factory_received_g = round(coalesce((
          select sum(r.original_physical_g)
          from public.factory_receipts r
          where r.organization_id = v.organization_id and r.status <> 'reversed'
        ), 0)::numeric, 4),
        total_factory_obligation_g = round(coalesce((
          select sum(r.factory_obligation_g)
          from public.factory_receipts r
          where r.organization_id = v.organization_id and r.status <> 'reversed'
        ), 0)::numeric, 4),
        total_factory_handed_over_g = round(coalesce((
          select sum(h.agreed_equivalent_g)
          from public.factory_gold_handovers h
          where h.organization_id = v.organization_id and h.status <> 'reversed'
        ), 0)::numeric, 4),
        current_factory_obligation_g = round(greatest(0,
          coalesce((select sum(r.factory_obligation_g) from public.factory_receipts r where r.organization_id = v.organization_id and r.status <> 'reversed'), 0) -
          coalesce((select sum(h.agreed_equivalent_g) from public.factory_gold_handovers h where h.organization_id = v.organization_id and h.status <> 'reversed'), 0)
        )::numeric, 4),
        manager_physical_stock_g = round(coalesce((
          select sum(r.available_physical_g)
          from public.factory_receipts r
          where r.organization_id = v.organization_id and r.status <> 'reversed'
        ), 0)::numeric, 4),
        updated_at = now()
    where v.organization_id = v_org;

    -- 3. Audit trail for audited reconciliation repair
    insert into public.audit_logs (
      organization_id, table_name, record_id, action, old_data, new_data, reason
    ) values (
      v_org, 'migration_052', 'RECONCILIATION_REPAIR', 'AUDITED_BALANCE_REPAIR',
      jsonb_build_object('event', 'migration_052_reconciliation_start'),
      jsonb_build_object(
        'event', 'migration_052_reconciliation_completed',
        'fixed_seller_scrap_discrepancy', true,
        'fixed_manager_vault_discrepancy', true
      ),
      'Audited balance repair: Recomputed manager vault and seller tills from non-reversed source documents to correct reversed settlement and receipt remnants'
    );
  end loop;
end;
$$;
