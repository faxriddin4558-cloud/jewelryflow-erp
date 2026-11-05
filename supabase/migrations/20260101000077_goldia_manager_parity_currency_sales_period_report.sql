-- 077 - Goldia Sales: director = manager (business decision 2026-11-05), UZS / USD price sales, period report.
--
-- A. Director and production manager have the SAME rights in every Goldia Sales business operation. The allow-lists
--    of the Sales RPCs and RLS policies that admitted the director but not the manager now admit the manager too
--    (rpc_archive_customer, rpc_confirm_accounting_baseline, rpc_get_director_sales_overview, rpc_issue_seller_consignment,
--    rpc_manage_sales_markup_preset, rpc_reclassify_capital_transaction, rpc_reverse_customer_settlement,
--    rpc_transfer_to_seller, rpc_get_seller_sales_summary; policies on employees, organization_factory_settings,
--    organizations, sales_markup_presets). Tenant isolation (current_organization_id) is unchanged everywhere.
--    NOT changed (decision gate D-P1): the TEST reset / cleanup functions (rpc_execute_full_test_reset,
--    rpc_preview_full_test_reset, rpc_execute/preview_staging_test_cleanup) - they wipe data and are not business
--    operations. Manufacturing-ERP tables / functions are not touched.
-- B. UZS / USD price sales (see section B below).
-- C. Period report + report periods without any zero-reset (see section C below).
-- D. rpc_reclassify_capital_transaction: the document amount follows the money (amount_num in the new currency, the
--    original till / currency / amount kept in reclassified_from_*); a second reclassification is refused. Before 077
--    reversing a reclassified UZS -> USD capital subtracted the UZS figure from the USD till.
-- E. rpc_reverse_financial_transaction wrote reversed_by = auth.uid() into a column that references employees(id): the
--    reversal failed for every employee whose id differs from the login id. Now current_employee_id().
-- Gram + % sales, 076 legacy debt rules, payments, handovers, FIFO and every existing function body not listed here
-- are unchanged.

-- ======================================================================================================
-- A. Director = manager parity
-- ======================================================================================================
alter table public.financial_transactions
  add column if not exists reclassified_at timestamptz,
  add column if not exists reclassified_from_till text,
  add column if not exists reclassified_from_currency text,
  add column if not exists reclassified_from_amount numeric(18, 2);

CREATE OR REPLACE FUNCTION public.trg_prevent_financial_transaction_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
       and NEW.equiv_585_grams = OLD.equiv_585_grams
       and NEW.reclassification_reason is not null
       -- 077: the amount may change ONLY in the single reclassification that records the original till / amount
       and (NEW.amount_num = OLD.amount_num
            or (OLD.reclassified_at is null and NEW.reclassified_at is not null
                and NEW.reclassified_from_amount = OLD.amount_num and NEW.reclassified_from_till = OLD.source_till))
       and (OLD.reclassified_at is null or (NEW.reclassified_at = OLD.reclassified_at and NEW.reclassified_from_amount = OLD.reclassified_from_amount
            and NEW.reclassified_from_till = OLD.reclassified_from_till)) then
      return NEW;
    end if;

    raise exception 'ERR_FINANCIAL_TRANSACTION_IMMUTABLE: Tasdiqlangan moliyaviy operatsiya ko''rsatkichlarini o''zgartirish taqiqlanadi (ID: %)', OLD.id
      using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_archive_customer(p_customer_id uuid, p_archive boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org uuid := public.current_organization_id();
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);

  update public.customers
     set is_archived = p_archive,
         updated_at = now()
   where id = p_customer_id and organization_id = v_caller_org;

  if not found then
    raise exception 'Mijoz topilmadi: %', p_customer_id;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'customer_id', p_customer_id,
    'is_archived', p_archive
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_confirm_accounting_baseline(p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_usd_rate numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id                 uuid := public.current_organization_id();
  v_caller_emp_id          uuid := public.current_employee_id();
  v_today                  date := (timezone('Asia/Tashkent', now()))::date;
  v_rate_585               numeric(18, 2);
  v_rate_usd               numeric(18, 2);
  v_mgr_finished_g         numeric(14, 4);
  v_mgr_scrap_585_eq_g     numeric(14, 4);
  v_mgr_refined_g          numeric(14, 4);
  v_mgr_capital_pure_g     numeric(14, 4);
  v_mgr_purchased_g        numeric(14, 4);
  v_mgr_cash_uzs           numeric(18, 2);
  v_mgr_cash_usd           numeric(18, 2);
  v_seller_finished_g      numeric(14, 4);
  v_seller_scrap_585_eq_g  numeric(14, 4);
  v_seller_cash_uzs        numeric(18, 2);
  v_seller_cash_usd        numeric(18, 2);
  v_refining_wip_g         numeric(14, 4);
  v_cash_uzs_total         numeric(18, 2);
  v_cash_usd_total         numeric(18, 2);
  v_cash_uzs_585_eq_g      numeric(14, 4);
  v_cash_usd_585_eq_g      numeric(14, 4);
  v_customer_debts_g       numeric(14, 4);
  v_customer_advances_g    numeric(14, 4);
  v_factory_rcp_g          numeric(14, 4);
  v_factory_hnd_g          numeric(14, 4);
  v_net_factory_g          numeric(14, 4);
  v_factory_obligation_g   numeric(14, 4);
  v_factory_advance_g      numeric(14, 4);
  v_total_assets_g         numeric(14, 4);
  v_total_liabilities_g    numeric(14, 4);
  v_net_assets_g           numeric(14, 4);
  v_baseline_no            text;
  v_baseline_id            uuid;
  v_snapshot               jsonb;
  v_payload                jsonb;
  v_existing               jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id from public.employees where user_id = auth.uid() and organization_id = v_org_id limit 1;
  end if;

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

  select coalesce(sum(coalesce(input_585_equiv_grams, input_scrap_grams * (coalesce(input_scrap_proba, 585.0) / 585.0))), 0)
    into v_refining_wip_g
    from public.refining_batches
   where organization_id = v_org_id and status in ('pending', 'in_progress');

  select coalesce(sum(public.get_seller_available_stock_grams(seller_id)), 0),
         coalesce(sum(coalesce(seller_till_scrap_585_eq_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(seller_till_cash_amount), 0),
         coalesce(sum(coalesce(seller_till_usd_amount, 0)), 0)
    into v_seller_finished_g, v_seller_scrap_585_eq_g, v_seller_cash_uzs, v_seller_cash_usd
    from public.seller_gold_accounts
   where organization_id = v_org_id;

  v_cash_uzs_total := round(v_mgr_cash_uzs + v_seller_cash_uzs, 2);
  v_cash_usd_total := round(v_mgr_cash_usd + v_seller_cash_usd, 2);

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

  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_customer_debts_g, v_customer_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  v_cash_uzs_585_eq_g := round((v_cash_uzs_total / v_rate_585)::numeric, 4);
  if v_cash_usd_total > 0 and v_rate_usd > 0 then
    v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);
  else
    v_cash_usd_585_eq_g := 0;
  end if;

  -- Factory net balance: receipts vs handovers
  select coalesce(sum(factory_obligation_g), 0) into v_factory_rcp_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(agreed_equivalent_g), 0) into v_factory_hnd_g
  from public.factory_gold_handovers
  where organization_id = v_org_id and status <> 'reversed';

  v_net_factory_g := v_factory_rcp_g - v_factory_hnd_g;
  if v_net_factory_g >= 0 then
    v_factory_obligation_g := round(v_net_factory_g, 4);
    v_factory_advance_g := 0;
  else
    v_factory_obligation_g := 0;
    v_factory_advance_g := round(abs(v_net_factory_g), 4);
  end if;

  -- Total Assets includes factory advance gold as enterprise asset!
  v_total_assets_g := round(
    v_mgr_finished_g + v_seller_finished_g +
    v_mgr_scrap_585_eq_g + v_seller_scrap_585_eq_g +
    v_mgr_refined_g + v_mgr_capital_pure_g + v_mgr_purchased_g +
    v_refining_wip_g +
    v_customer_debts_g +
    v_cash_uzs_585_eq_g + v_cash_usd_585_eq_g +
    v_factory_advance_g,
    4
  );

  v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g, 4);
  v_net_assets_g := round(v_total_assets_g - v_total_liabilities_g, 4);

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
    'cash_uzs_total', v_cash_uzs_total,
    'cash_uzs_585_eq_g', v_cash_uzs_585_eq_g,
    'cash_usd_total', v_cash_usd_total,
    'cash_usd_585_eq_g', v_cash_usd_585_eq_g,
    'factory_obligation_585_g', v_factory_obligation_g,
    'factory_advance_585_g', v_factory_advance_g,
    'total_assets_585_g', v_total_assets_g,
    'total_liabilities_585_g', v_total_liabilities_g,
    'net_assets_585_g', v_net_assets_g
  );

  insert into public.accounting_baselines (
    organization_id, baseline_no, baseline_date, confirmed_by, status, notes,
    gold_rate_585, usd_rate,
    manager_finished_g, seller_finished_g,
    manager_scrap_585_eq_g, seller_scrap_585_eq_g,
    manager_refined_gold_g, manager_purchased_gold_g,
    customer_debts_585_g, cash_uzs_amount, cash_uzs_585_eq_g,
    cash_usd_amount, cash_usd_585_eq_g,
    total_assets_585_g, factory_obligation_585_g, factory_advance_585_g,
    customer_advances_585_g, total_liabilities_585_g,
    net_assets_585_g, components_snapshot
  ) values (
    v_org_id, v_baseline_no, now(), v_caller_emp_id, 'active', p_notes,
    v_rate_585, v_rate_usd,
    v_mgr_finished_g, v_seller_finished_g,
    v_mgr_scrap_585_eq_g, v_seller_scrap_585_eq_g,
    v_mgr_refined_g, v_mgr_purchased_g,
    v_customer_debts_g, v_cash_uzs_total, v_cash_uzs_585_eq_g,
    v_cash_usd_total, v_cash_usd_585_eq_g,
    v_total_assets_g, v_factory_obligation_g, v_factory_advance_g,
    v_customer_advances_g, v_total_liabilities_g,
    v_net_assets_g, v_snapshot
  ) returning id into v_baseline_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'baseline_id', v_baseline_id,
    'baseline_no', v_baseline_no,
    'baseline_date', v_today,
    'gold_rate_585', v_rate_585,
    'usd_rate', v_rate_usd,
    'total_assets_585_g', v_total_assets_g,
    'factory_obligation_585_g', v_factory_obligation_g,
    'factory_advance_585_g', v_factory_advance_g,
    'total_liabilities_585_g', v_total_liabilities_g,
    'net_assets_585_g', v_net_assets_g,
    'snapshot', v_snapshot
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_confirm_accounting_baseline', v_existing, v_payload);
  return v_existing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_get_director_sales_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_total_consign_w   numeric(14, 4);
  v_total_factory_due numeric(14, 4);
  v_total_cli_debt    numeric(14, 4);
  v_total_till_scrap  numeric(14, 4);
  v_total_till_cash   numeric(18, 2);
  v_latest_rate       numeric(18, 2);
  v_rate_date         date;
  v_sellers_list      jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'manager', 'production_manager', 'boshqaruvchi']);

  select rate_per_gram, rate_date
    into v_latest_rate, v_rate_date
    from public.daily_gold_rates
   where organization_id = v_caller_org
   order by rate_date desc, created_at desc
   limit 1;

  select
    coalesce(sum(current_factory_obligation_grams), 0),
    coalesce(sum(total_consigned_gold_grams), 0),
    coalesce(sum(seller_till_scrap_grams), 0),
    coalesce(sum(seller_till_cash_amount), 0),
    coalesce(sum(total_client_debt_grams), 0)
  into
    v_total_factory_due,
    v_total_consign_w,
    v_total_till_scrap,
    v_total_till_cash,
    v_total_cli_debt
  from public.seller_gold_accounts
  where organization_id = v_caller_org;

  select jsonb_agg(jsonb_build_object(
    'seller_id', e.id,
    'full_name', coalesce(e.full_name, e.first_name || ' ' || e.last_name, e.email),
    'factory_obligation_grams', coalesce(sga.current_factory_obligation_grams, 0),
    'seller_till_scrap_grams', coalesce(sga.seller_till_scrap_grams, 0),
    'seller_till_cash_amount', coalesce(sga.seller_till_cash_amount, 0),
    'client_debt_grams', coalesce(sga.total_client_debt_grams, 0)
  ))
  into v_sellers_list
  from public.employees e
  left join public.seller_gold_accounts sga on sga.seller_id = e.id
  where e.organization_id = v_caller_org
    and lower(coalesce(e.role_type, e.role::text, '')) in ('sales', 'seller', 'sotuvchi', 'manager', 'production_manager', 'director', 'admin');

  return jsonb_build_object(
    'status', 'ok',
    'latest_rate_per_gram', coalesce(v_latest_rate, 0),
    'rate_date', v_rate_date,
    'total_factory_obligation_grams', v_total_factory_due,
    'total_consigned_grams', v_total_consign_w,
    'total_seller_till_scrap_grams', v_total_till_scrap,
    'total_seller_till_cash_amount', v_total_till_cash,
    'total_client_debt_grams', v_total_cli_debt,
    'sellers', coalesce(v_sellers_list, '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_issue_seller_consignment(p_seller_id uuid, p_product_id uuid, p_quantity integer DEFAULT 1, p_factory_markup_pct numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_prod          public.products%rowtype;
  v_seller        public.employees%rowtype;
  v_qty           integer := coalesce(p_quantity, 1);
  v_markup_pct    numeric(6, 2) := round(coalesce(p_factory_markup_pct, 0)::numeric, 2);
  v_base_w        numeric(14, 4);
  v_factory_due   numeric(14, 4);
  v_consignment_id uuid;
  v_consignment_no text;
  v_cur_stock     integer;
  v_payload       jsonb;
  v_existing      jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'warehouse', 'omborchi', 'manager', 'production_manager', 'boshqaruvchi']);

  if v_qty <= 0 then
    raise exception 'Consignment quantity must be greater than 0';
  end if;
  if v_markup_pct < 0 then
    raise exception 'Factory markup percentage cannot be negative';
  end if;

  v_payload := jsonb_build_object(
    'action', 'issue_consignment',
    'seller_id', p_seller_id,
    'product_id', p_product_id,
    'quantity', v_qty,
    'factory_markup_pct', v_markup_pct
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_issue_seller_consignment', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Verify seller
  select * into v_seller
    from public.employees
   where id = p_seller_id
     and organization_id = v_caller_org
   limit 1;
  if not found then
    raise exception 'Seller (employee %) not found in your organization', p_seller_id;
  end if;

  -- Lock product and verify stock
  select * into v_prod
    from public.products
   where id = p_product_id
     and organization_id = v_caller_org
   for update;
  if not found then
    raise exception 'Product (%) not found in finished goods inventory', p_product_id;
  end if;

  v_cur_stock := coalesce(v_prod.stock, v_prod.quantity, 0);
  if v_qty > v_cur_stock then
    raise exception 'Insufficient stock for "%": available=%, requested=%', v_prod.name, v_cur_stock, v_qty;
  end if;

  -- Total base weight for given quantity
  v_base_w := round((coalesce(v_prod.weight, 0) * v_qty)::numeric, 4);
  if v_base_w <= 0 then
    raise exception 'Product weight must be greater than 0 for gold consignment';
  end if;

  -- Non-compounding: Factory gold due = base_weight * (1 + factory_markup / 100)
  v_factory_due := round((v_base_w * (1.0 + v_markup_pct / 100.0))::numeric, 4);

  -- Deduct product stock from factory vitrina
  update public.products
     set stock      = v_cur_stock - v_qty,
         quantity   = v_cur_stock - v_qty,
         updated_at = now()
   where id = v_prod.id;

  v_consignment_no := 'CONS-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.seller_consignments (
    organization_id, consignment_no, seller_id, product_id, product_name,
    quantity, base_weight_grams, proba, factory_markup_pct,
    factory_gold_due_grams, factory_settled_gold_grams, factory_remaining_gold_grams,
    sold_quantity, status, idempotency_key, notes
  ) values (
    v_caller_org, v_consignment_no, v_seller.id, v_prod.id, v_prod.name,
    v_qty, v_base_w, coalesce(v_prod.proba, 585), v_markup_pct,
    v_factory_due, 0, v_factory_due,
    0, 'held_by_seller', nullif(btrim(p_idempotency_key), ''), p_notes
  ) returning id into v_consignment_id;

  -- Update seller factory obligation in seller_gold_accounts
  insert into public.seller_gold_accounts (
    seller_id, organization_id, total_consigned_gold_grams, current_factory_obligation_grams, updated_at
  ) values (
    v_seller.id, v_caller_org, v_factory_due, v_factory_due, now()
  )
  on conflict (seller_id) do update set
    total_consigned_gold_grams       = round((seller_gold_accounts.total_consigned_gold_grams + v_factory_due)::numeric, 4),
    current_factory_obligation_grams = round((seller_gold_accounts.current_factory_obligation_grams + v_factory_due)::numeric, 4),
    updated_at                       = now();

  v_existing := jsonb_build_object(
    'status', 'ok',
    'consignment_id', v_consignment_id,
    'consignment_no', v_consignment_no,
    'seller_id', v_seller.id,
    'product_name', v_prod.name,
    'quantity', v_qty,
    'base_weight_grams', v_base_w,
    'proba', coalesce(v_prod.proba, 585),
    'factory_markup_pct', v_markup_pct,
    'factory_gold_due_grams', v_factory_due,
    'remaining_stock', v_cur_stock - v_qty
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_issue_seller_consignment', v_existing, v_payload);
  return v_existing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_manage_sales_markup_preset(p_preset_id uuid DEFAULT NULL::uuid, p_type text DEFAULT 'client_markup'::text, p_name text DEFAULT ''::text, p_percentage numeric DEFAULT 0, p_is_active boolean DEFAULT true, p_is_default boolean DEFAULT false, p_display_order integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org   uuid := public.current_organization_id();
  v_res_id       uuid;
  v_type         text := lower(btrim(coalesce(p_type, 'client_markup')));
  v_pct          numeric(6, 2) := round(coalesce(p_percentage, 0)::numeric, 2);
  v_clean_name   text := btrim(coalesce(p_name, ''));
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);

  if v_type not in ('factory_markup', 'client_markup') then
    raise exception 'Invalid markup type: must be "factory_markup" or "client_markup"';
  end if;
  if v_pct < 0 or v_pct > 100 then
    raise exception 'Percentage must be between 0 and 100';
  end if;
  if v_clean_name = '' then
    v_clean_name := case when v_type = 'factory_markup' then 'Zavod ' else 'Mijoz ' end || v_pct || '%';
  end if;

  if p_is_default then
    -- Reset previous default for this org and type
    update public.sales_markup_presets
       set is_default = false
     where organization_id = v_caller_org
       and type = v_type;
  end if;

  if p_preset_id is not null then
    update public.sales_markup_presets
       set name          = v_clean_name,
           percentage    = v_pct,
           is_active     = coalesce(p_is_active, is_active),
           is_default    = coalesce(p_is_default, is_default),
           display_order = coalesce(p_display_order, display_order),
           updated_at    = now()
     where id = p_preset_id
       and organization_id = v_caller_org
     returning id into v_res_id;
  else
    insert into public.sales_markup_presets (
      organization_id, type, name, percentage, is_active, is_default, display_order
    ) values (
      v_caller_org, v_type, v_clean_name, v_pct, coalesce(p_is_active, true), coalesce(p_is_default, false), coalesce(p_display_order, 0)
    )
    on conflict (organization_id, type, percentage)
    do update set
      name          = excluded.name,
      is_active     = excluded.is_active,
      is_default    = excluded.is_default,
      display_order = excluded.display_order,
      updated_at    = now()
    returning id into v_res_id;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'preset_id', v_res_id,
    'type', v_type,
    'name', v_clean_name,
    'percentage', v_pct,
    'is_active', coalesce(p_is_active, true),
    'is_default', coalesce(p_is_default, false)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_reclassify_capital_transaction(p_transaction_id uuid, p_new_destination text, p_reason text, p_new_proba numeric DEFAULT NULL::numeric, p_seller_id uuid DEFAULT NULL::uuid, p_model_id uuid DEFAULT NULL::uuid, p_product_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);

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

  -- 077: one reclassification per operation (the document keeps the original till / currency / amount)
  if v_tx.reclassified_at is not null then
    raise exception 'Bu operatsiya allaqachon qayta tasniflangan (%). Kerak bo''lsa avval bekor qiling va qaytadan kiriting.', v_tx.reclassified_from_till;
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
  -- 077: the document amount follows the money (before 077 amount_num kept the OLD currency amount, so reversing a
  -- reclassified UZS -> USD operation subtracted the UZS figure from the USD till)
  update public.financial_transactions
     set reclassified_at = clock_timestamp(),
         reclassified_from_till = source_till,
         reclassified_from_currency = currency,
         reclassified_from_amount = amount_num,
         amount_num = case
           when v_dest in ('manager_uzs', 'cash_uzs') then round((v_equiv_585 * v_tx.gold_rate_applied)::numeric, 2)
           when v_dest in ('manager_usd', 'cash_usd') then round(((v_equiv_585 * v_tx.gold_rate_applied) / v_tx.usd_rate_applied)::numeric, 2)
           else amount_num end,
         source_till = v_dest,
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
$function$;

CREATE OR REPLACE FUNCTION public.rpc_reverse_customer_settlement(p_settlement_id uuid, p_reversal_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org     uuid := public.current_organization_id();
  v_caller_role    text := public.current_employee_role_text();
  v_caller_emp_id  uuid := public.current_employee_id();
  v_settle         public.gold_settlements%rowtype;
  v_seller_acc     public.seller_gold_accounts%rowtype;
  v_client_acc     public.client_gold_accounts%rowtype;
  v_clean_reason   text := nullif(btrim(p_reversal_reason), '');
  v_cash_uzs       numeric(18, 2);
  v_cash_usd       numeric(18, 2);
  v_scrap_phys     numeric(14, 4);
  v_scrap_585      numeric(14, 4);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'accountant', 'buxgalter', 'manager', 'production_manager', 'boshqaruvchi']);

  if v_clean_reason is null then
    raise exception 'Mijoz to''lovini bekor qilish sababi (audit uchun) kiritilishi shart';
  end if;

  select * into v_settle
    from public.gold_settlements
   where id = p_settlement_id
     and organization_id = v_caller_org
     and direction = 'client_to_seller'
   for update;

  if not found then
    raise exception 'Mijoz to''lovi topilmadi (id: %)', p_settlement_id;
  end if;

  if v_settle.status in ('reversed', 'cancelled') then
    raise exception 'Ushbu to''lov allaqachon bekor qilingan (status: %)', v_settle.status;
  end if;

  v_cash_uzs   := coalesce(v_settle.cash_paid_amount, 0);
  v_cash_usd   := coalesce(v_settle.usd_paid_amount, 0);
  v_scrap_phys := coalesce(v_settle.physical_scrap_grams, v_settle.scrap_weight_grams, 0);
  v_scrap_585  := coalesce(v_settle.scrap_585_equiv_grams, v_settle.scrap_weight_grams, 0);

  -- Deduct from seller till
  if v_settle.seller_id is not null then
    select * into v_seller_acc
      from public.seller_gold_accounts
     where seller_id = v_settle.seller_id and organization_id = v_caller_org
     for update;

    update public.seller_gold_accounts
       set seller_till_scrap_grams       = round(greatest(0, seller_till_scrap_grams - coalesce(v_settle.scrap_weight_grams, 0))::numeric, 4),
           seller_till_scrap_physical_g  = round(greatest(0, coalesce(seller_till_scrap_physical_g, 0) - v_scrap_phys)::numeric, 4),
           seller_till_scrap_585_eq_g    = round(greatest(0, coalesce(seller_till_scrap_585_eq_g, 0) - v_scrap_585)::numeric, 4),
           seller_till_cash_amount       = round(greatest(0, seller_till_cash_amount - v_cash_uzs)::numeric, 2),
           seller_till_usd_amount        = round(greatest(0, coalesce(seller_till_usd_amount, 0) - v_cash_usd)::numeric, 2),
           updated_at                    = now()
     where seller_id = v_settle.seller_id;
  end if;

  -- Restore customer debt in client_gold_accounts
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
           total_cash_equiv_grams= round(greatest(0, total_cash_equiv_grams - coalesce(v_settle.cash_equivalent_grams, 0) - coalesce(v_settle.usd_equivalent_grams, 0))::numeric, 4),
           total_usd_paid_amount = round(greatest(0, coalesce(total_usd_paid_amount, 0) - v_cash_usd)::numeric, 2),
           total_usd_equiv_grams = round(greatest(0, coalesce(total_usd_equiv_grams, 0) - coalesce(v_settle.usd_equivalent_grams, 0))::numeric, 4),
           updated_at            = now()
     where customer_id = v_settle.customer_id;
  end if;

  update public.customers
     set advance_balance_gold_grams = round(greatest(0, coalesce(advance_balance_gold_grams, 0) - v_settle.excess_gold_grams)::numeric, 4)
   where id = v_settle.customer_id;

  if v_settle.sale_id is not null then
    update public.jewelry_sales
       set settled_gold_grams   = round(greatest(0, settled_gold_grams - v_settle.applied_to_debt_grams)::numeric, 4),
           remaining_gold_grams = round((remaining_gold_grams + v_settle.applied_to_debt_grams)::numeric, 4),
           status = 'open_debt',
           updated_at = now()
     where id = v_settle.sale_id and organization_id = v_caller_org;
  end if;

  update public.gold_settlements
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason,
         updated_at = now()
   where id = v_settle.id;

  if v_settle.seller_id is not null then
    perform public.recalc_seller_gold_account(v_settle.seller_id, v_caller_org);
  end if;

  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'gold_settlements', v_settle.id::text,
    'REVERSE_CLIENT_SETTLEMENT', auth.uid(),
    jsonb_build_object(
      'settlement_no', v_settle.settlement_no,
      'total_settled_grams', v_settle.total_settled_grams,
      'physical_scrap_grams', v_scrap_phys,
      'cash_paid_amount', v_cash_uzs,
      'usd_paid_amount', v_cash_usd
    ),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  return jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle.id,
    'settlement_no', v_settle.settlement_no,
    'restored_customer_debt_g', v_settle.applied_to_debt_grams
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_transfer_to_seller(p_seller_id uuid, p_original_physical_g numeric, p_seller_markup_pct numeric DEFAULT 12.0, p_factory_markup_pct numeric DEFAULT 8.0, p_product_name text DEFAULT 'Zargarlik buyumi'::text, p_quantity integer DEFAULT 1, p_factory_receipt_id uuid DEFAULT NULL::uuid, p_product_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id          uuid := public.current_organization_id();
  v_seller_role     text;
  v_phys_g          numeric(14, 4);
  v_s_pct           numeric(6, 2);
  v_f_pct           numeric(6, 2);
  v_s_due_g         numeric(14, 4);
  v_f_due_g         numeric(14, 4);
  v_spread_g        numeric(14, 4);
  v_consign_no      text;
  v_consign_id      uuid;
  v_receipt_rec     record;
  v_seller_account  public.seller_gold_accounts;
  v_existing        jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'inventory_manager', 'manager', 'production_manager', 'boshqaruvchi']);

  -- Verify seller is not director/admin
  select lower(coalesce(role::text, '')) into v_seller_role
  from public.employees
  where id = p_seller_id and organization_id = v_org_id;

  if v_seller_role is null then
    raise exception 'Seller not found or does not belong to active organization';
  end if;

  if v_seller_role in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi') then
    raise exception 'Invalid recipient: Cannot consign products to director or admin. Select an active sales seller.';
  end if;

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'consignment_id', id,
      'consignment_no', consignment_no,
      'seller_obligation_g', seller_obligation_g
    ) into v_existing
    from public.seller_consignments
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_phys_g := round(coalesce(p_original_physical_g, 0)::numeric, 4);
  v_s_pct := round(greatest(0, coalesce(p_seller_markup_pct, 12.0))::numeric, 2);
  v_f_pct := round(greatest(0, coalesce(p_factory_markup_pct, 8.0))::numeric, 2);

  if v_phys_g <= 0 then
    raise exception 'Invalid physical weight: must be greater than 0';
  end if;

  -- Non-compounding rule: Both markups calculate from original physical weight
  v_s_due_g := round(v_phys_g * (1.0 + (v_s_pct / 100.0)), 4);
  v_f_due_g := round(v_phys_g * (1.0 + (v_f_pct / 100.0)), 4);
  v_spread_g := round(v_s_due_g - v_f_due_g, 4);

  -- Deduct physical stock from factory_receipt if supplied or available
  if p_factory_receipt_id is not null then
    select * into v_receipt_rec
    from public.factory_receipts
    where id = p_factory_receipt_id and organization_id = v_org_id for update;

    if not found then
      raise exception 'Factory receipt not found';
    end if;

    if v_receipt_rec.available_physical_g < v_phys_g then
      raise exception 'Insufficient manager stock in factory receipt: available %g, requested %g',
        v_receipt_rec.available_physical_g, v_phys_g;
    end if;

    update public.factory_receipts
    set available_physical_g = round(available_physical_g - v_phys_g, 4),
        transferred_physical_g = round(transferred_physical_g + v_phys_g, 4),
        status = case
          when round(available_physical_g - v_phys_g, 4) <= 0.0001 then 'fully_transferred'
          else 'partially_transferred'
        end,
        updated_at = now()
    where id = p_factory_receipt_id;
  end if;

  v_consign_no := 'CNS-' || to_char(public._goldia_business_date(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.seller_consignments (
    organization_id,
    consignment_no,
    seller_id,
    factory_receipt_id,
    product_id,
    product_name,
    quantity,
    base_weight_grams,
    proba,
    factory_markup_pct,
    factory_gold_due_grams,
    factory_settled_gold_grams,
    factory_remaining_gold_grams,
    seller_markup_pct,
    seller_obligation_g,
    sold_quantity,
    status,
    notes,
    idempotency_key
  ) values (
    v_org_id,
    v_consign_no,
    p_seller_id,
    p_factory_receipt_id,
    p_product_id,
    coalesce(nullif(btrim(p_product_name), ''), 'Zargarlik buyumi'),
    greatest(1, coalesce(p_quantity, 1)),
    v_phys_g,
    585,
    v_f_pct,
    v_f_due_g,
    0,
    v_f_due_g,
    v_s_pct,
    v_s_due_g,
    0,
    'held_by_seller',
    p_notes,
    p_idempotency_key
  ) returning id into v_consign_id;

  -- Read seller account updated automatically by fn_sync_seller_gold_account trigger
  select * into v_seller_account
  from public.seller_gold_accounts
  where seller_id = p_seller_id;

  return jsonb_build_object(
    'status', 'ok',
    'consignment_id', v_consign_id,
    'consignment_no', v_consign_no,
    'base_weight_grams', v_phys_g,
    'seller_markup_pct', v_s_pct,
    'seller_obligation_g', v_s_due_g,
    'factory_markup_pct', v_f_pct,
    'factory_gold_due_grams', v_f_due_g,
    'markup_spread_grams', v_spread_g,
    'seller_owes_manager_g', v_seller_account.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_account.bozor_qarzi_signed_g
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_get_seller_sales_summary(p_seller_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org     uuid := public.current_organization_id();
  v_caller_role    text := public.current_employee_role_text();
  v_seller_uuid    uuid := p_seller_id;
  v_caller_emp_id  uuid;
  v_seller_acc     public.seller_gold_accounts%rowtype;
  v_active_consign integer;
  v_active_sales   integer;
  v_client_count   integer;
  v_total_cli_debt numeric(14, 4);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  select id into v_caller_emp_id
    from public.employees
   where (user_id = auth.uid() or id = auth.uid())
     and organization_id = v_caller_org
   limit 1;

  if v_seller_uuid is null or v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi') then
    v_seller_uuid := v_caller_emp_id;
  end if;

  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_seller_uuid
     and organization_id = v_caller_org;

  select count(*) into v_active_consign
    from public.seller_consignments
   where seller_id = v_seller_uuid
     and organization_id = v_caller_org
     and status = 'held_by_seller';

  select count(*) into v_active_sales
    from public.jewelry_sales
   where seller_id = v_seller_uuid
     and organization_id = v_caller_org
     and status in ('open_debt', 'partially_paid');

  select count(*), coalesce(sum(current_debt_grams), 0)
    into v_client_count, v_total_cli_debt
    from public.client_gold_accounts
   where seller_id = v_seller_uuid
     and organization_id = v_caller_org;

  return jsonb_build_object(
    'status', 'ok',
    'seller_id', v_seller_uuid,
    'current_factory_obligation_grams', coalesce(v_seller_acc.current_factory_obligation_grams, 0),
    'seller_till_scrap_grams', coalesce(v_seller_acc.seller_till_scrap_grams, 0),
    'seller_till_cash_amount', coalesce(v_seller_acc.seller_till_cash_amount, 0),
    'total_client_debt_grams', coalesce(v_total_cli_debt, 0),
    'active_consignments_count', coalesce(v_active_consign, 0),
    'active_sales_count', coalesce(v_active_sales, 0),
    'assigned_clients_count', coalesce(v_client_count, 0)
  );
end;
$function$;

drop policy if exists "admin manage employees" on public.employees;
create policy "admin manage employees" on public.employees for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['manager'::text, 'production_manager'::text, 'boshqaruvchi'::text, 'admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['manager'::text, 'production_manager'::text, 'boshqaruvchi'::text, 'admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text]))));

drop policy if exists "factory_settings_director_manage" on public.organization_factory_settings;
create policy "factory_settings_director_manage" on public.organization_factory_settings for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['manager'::text, 'production_manager'::text, 'boshqaruvchi'::text, 'admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['manager'::text, 'production_manager'::text, 'boshqaruvchi'::text, 'admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text]))));

drop policy if exists "organizations_director_manage" on public.organizations;
create policy "organizations_director_manage" on public.organizations for ALL to authenticated
  using (((id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['manager'::text, 'production_manager'::text, 'boshqaruvchi'::text, 'admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text]))))
  with check (((id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['manager'::text, 'production_manager'::text, 'boshqaruvchi'::text, 'admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text]))));

drop policy if exists "sales_markup_presets_admin_manage" on public.sales_markup_presets;
create policy "sales_markup_presets_admin_manage" on public.sales_markup_presets for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['manager'::text, 'production_manager'::text, 'boshqaruvchi'::text, 'admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['manager'::text, 'production_manager'::text, 'boshqaruvchi'::text, 'admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text]))));

-- ======================================================================================================
-- B. UZS / USD sales (business decision 2026-11-05): a product may be sold for an exact UZS or USD price.
--    * physical grams leave the SAME seller stock as gram sales (jewelry_sales.base_weight_grams, FIFO pieces);
--    * the customer's debt is kept in that currency (client_currency_accounts), never mixed with 585 grams;
--    * the seller's 585 obligation to the manager (consignment grams x (1 + seller %)) is NOT touched by the sale;
--    * cash received goes into the seller till as UNVALUED cash; when the manager takes the till the existing 072
--      handover converts it at the rate recorded on that handover (no new conversion rule);
--    * profit / rate difference / stone value / company share of currency sales are NOT computed (decision gate).
-- ======================================================================================================
alter table public.jewelry_sales
  add column if not exists sale_currency text not null default 'XAU585',
  add column if not exists sale_amount numeric(18, 2),
  add column if not exists sale_usd_rate_snapshot numeric(18, 2),
  add column if not exists sale_lom_rate_snapshot numeric(18, 2);
alter table public.jewelry_sales drop constraint if exists jewelry_sales_sale_currency_check;
alter table public.jewelry_sales add constraint jewelry_sales_sale_currency_check check (sale_currency in ('XAU585', 'UZS', 'USD'));
alter table public.jewelry_sales drop constraint if exists jewelry_sales_client_gold_due_grams_check;
alter table public.jewelry_sales add constraint jewelry_sales_client_gold_due_grams_check check (
  (sale_currency = 'XAU585' and client_gold_due_grams > 0)
  or (sale_currency <> 'XAU585' and client_gold_due_grams = 0 and sale_amount is not null and sale_amount > 0));
comment on column public.jewelry_sales.sale_currency is '077: XAU585 = gram + % sale (585 debt); UZS / USD = exact price sale (currency debt in client_currency_accounts)';

create table if not exists public.client_currency_accounts (
  customer_id       uuid not null references public.customers(id),
  currency          text not null check (currency in ('UZS', 'USD')),
  organization_id   uuid not null references public.organizations(id),
  seller_id         uuid references public.employees(id),
  debt_amount       numeric(18, 2) not null default 0 check (debt_amount >= 0),
  advance_amount    numeric(18, 2) not null default 0 check (advance_amount >= 0),
  total_sold_amount numeric(18, 2) not null default 0,
  total_paid_amount numeric(18, 2) not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (customer_id, currency),
  check (not (debt_amount > 0 and advance_amount > 0))
);
create index if not exists idx_client_currency_accounts_org on public.client_currency_accounts (organization_id, seller_id);

create table if not exists public.client_currency_settlements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id),
  settlement_no     text not null,
  customer_id       uuid not null references public.customers(id),
  seller_id         uuid not null references public.employees(id),
  debt_currency     text not null check (debt_currency in ('UZS', 'USD')),
  cash_uzs          numeric(18, 2) not null default 0 check (cash_uzs >= 0),
  usd_amount        numeric(18, 2) not null default 0 check (usd_amount >= 0),
  scrap_physical_g  numeric(14, 4) not null default 0 check (scrap_physical_g >= 0),
  scrap_proba       numeric(6, 2),
  scrap_585_g       numeric(14, 4) not null default 0 check (scrap_585_g >= 0),
  rate_usd_uzs      numeric(18, 2),
  rate_lom_uzs      numeric(18, 2),
  credited_amount   numeric(18, 2) not null check (credited_amount > 0),
  applied_to_debt   numeric(18, 2) not null default 0,
  to_advance        numeric(18, 2) not null default 0,
  settlement_date   date not null default public._goldia_business_date(),
  status            text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  reversed_at       timestamptz,
  reversed_by       uuid,
  reversal_reason   text,
  idempotency_key   text unique,
  recorded_by       uuid,
  notes             text,
  created_at        timestamptz not null default clock_timestamp(),
  unique (organization_id, settlement_no)
);
create index if not exists idx_client_currency_settlements_cust on public.client_currency_settlements (organization_id, customer_id, settlement_date);

alter table public.client_currency_accounts enable row level security;
alter table public.client_currency_settlements enable row level security;
revoke all on public.client_currency_accounts from anon, authenticated;
revoke all on public.client_currency_settlements from anon, authenticated;
grant select on public.client_currency_accounts to authenticated;
grant select on public.client_currency_settlements to authenticated;
grant all on public.client_currency_accounts to service_role;
grant all on public.client_currency_settlements to service_role;
drop policy if exists client_currency_accounts_select on public.client_currency_accounts;
create policy client_currency_accounts_select on public.client_currency_accounts for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or seller_id = public.current_employee_id()
              or exists (select 1 from public.customers c where c.id = client_currency_accounts.customer_id and c.seller_id = public.current_employee_id())));
drop policy if exists client_currency_settlements_select on public.client_currency_settlements;
create policy client_currency_settlements_select on public.client_currency_settlements for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or seller_id = public.current_employee_id()));

-- markup snapshot: a currency sale has no customer markup, so it never creates a markup difference
create or replace function public.trg_goldia_sale_markup_snapshot()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_pct numeric(6, 2);
begin
  if new.assigned_seller_markup_pct is null and new.consignment_id is not null then
    select seller_markup_pct into v_pct from public.seller_consignments where id = new.consignment_id;
    if v_pct is not null then
      new.assigned_seller_markup_pct := v_pct;
      new.markup_snapshot_source := 'sale_time';
    end if;
  end if;
  if coalesce(new.sale_currency, 'XAU585') <> 'XAU585' then
    new.markup_difference_g := null;  -- 077: UZS / USD price sale, no gram markup
  elsif new.assigned_seller_markup_pct is not null and new.client_markup_pct is not null then
    new.markup_difference_g := round(coalesce(new.base_weight_grams, 0)
      * (new.client_markup_pct - new.assigned_seller_markup_pct) / 100.0, 4);
  end if;
  return new;
end;
$function$;

create or replace function public.rpc_record_currency_sale(
  p_customer_id     uuid,
  p_currency        text,
  p_amount          numeric,
  p_weight_grams    numeric,
  p_piece_ids       uuid[] default null,
  p_seller_id       uuid default null,
  p_notes           text default null,
  p_idempotency_key text default null
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
  v_cur           text := upper(btrim(coalesce(p_currency, '')));
  v_amount        numeric(18, 2);
  v_weight        numeric(14, 4);
  v_seller        public.employees%rowtype;
  v_customer      public.customers%rowtype;
  v_acc           public.client_currency_accounts%rowtype;
  v_consign       public.seller_consignments%rowtype;
  v_rates         public.seller_rates%rowtype;
  v_avail_stock   numeric(14, 4);
  v_apply_adv     numeric(18, 2) := 0;
  v_net_due       numeric(18, 2);
  v_sale_id       uuid;
  v_sale_no       text;
  v_payload       jsonb;
  v_existing      jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'sales', 'seller', 'sotuvchi', 'manager', 'production_manager', 'boshqaruvchi'
  ]);
  if v_cur not in ('UZS', 'USD') then
    raise exception 'ERR_CURRENCY: Savdo valyutasi UZS yoki USD bo''lishi shart';
  end if;
  v_amount := round(coalesce(p_amount, 0)::numeric, 2);
  if v_amount <= 0 or v_amount > 1000000000000 then
    raise exception 'ERR_AMOUNT: Savdo summasi 0 dan katta bo''lishi shart';
  end if;
  v_weight := round(coalesce(p_weight_grams, 0)::numeric, 4);
  if v_weight <= 0 then
    raise exception 'Sotilayotgan mahsulot vazni 0 dan katta bo''lishi shart';
  end if;

  select * into v_customer from public.customers where id = p_customer_id and organization_id = v_caller_org;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;
  -- seller: a seller sells from his own stock; management names the seller (or the customer's seller)
  if public._goldia_is_seller_role(v_caller_role) then
    select * into v_seller from public.employees where id = v_caller_emp_id and organization_id = v_caller_org;
    if v_customer.seller_id is not null and v_customer.seller_id is distinct from v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Ushbu mijoz boshqa sotuvchiga biriktirilgan' using errcode = '42501';
    end if;
  else
    select * into v_seller from public.employees
     where id = coalesce(p_seller_id, v_customer.seller_id) and organization_id = v_caller_org;
  end if;
  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi (mijozga sotuvchi biriktiring yoki sotuvchini tanlang)';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('goldia_seller_stock:' || v_seller.id::text, 0));
  v_payload := jsonb_build_object('action', 'record_currency_sale', 'customer_id', p_customer_id, 'seller_id', v_seller.id,
    'currency', v_cur, 'amount', v_amount, 'weight_grams', v_weight, 'piece_ids', to_jsonb(p_piece_ids));
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_currency_sale', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  v_avail_stock := public.get_seller_available_stock_grams(v_seller.id);
  if v_avail_stock < v_weight then
    raise exception 'ERR_INSUFFICIENT_SELLER_STOCK: Sotuvchi omborida yetarli oltin mavjud emas (Mavjud: % g, Talab: % g)', v_avail_stock, v_weight;
  end if;
  if p_piece_ids is not null and cardinality(p_piece_ids) > 0 then
    if cardinality(p_piece_ids) <> (select count(distinct x) from unnest(p_piece_ids) x) then
      raise exception 'ERR_PIECE_DUPLICATE: Bir dona ikki marta tanlangan';
    end if;
    perform 1 from public.consignment_pieces cp where cp.id = any(p_piece_ids) order by cp.id for update;
    if (select count(*) from public.consignment_pieces cp
         where cp.id = any(p_piece_ids) and cp.seller_id = v_seller.id and cp.organization_id = v_caller_org
           and cp.status = 'held_by_seller' and cp.sale_id is null) <> cardinality(p_piece_ids) then
      raise exception 'ERR_PIECE_NOT_AVAILABLE: Tanlangan donalardan biri sotuvchida mavjud emas yoki allaqachon sotilgan';
    end if;
    if (select coalesce(sum(cp.weight_grams), 0) from public.consignment_pieces cp where cp.id = any(p_piece_ids)) < v_weight - 0.00005 then
      raise exception 'ERR_PIECES_TOO_LIGHT: Tanlangan donalar jami vazni sotilayotgan vazndan kam';
    end if;
    select sc.* into v_consign from public.seller_consignments sc
      join public.consignment_pieces cp on cp.consignment_id = sc.id where cp.id = p_piece_ids[1] for update of sc;
  else
    select * into v_consign from public.seller_consignments
     where seller_id = v_seller.id and organization_id = v_caller_org and status in ('held_by_seller', 'partially_sold')
     order by created_at asc limit 1 for update;
  end if;

  -- customer currency account: an existing advance in the same currency is used first
  select * into v_acc from public.client_currency_accounts where customer_id = v_customer.id and currency = v_cur for update;
  v_apply_adv := least(coalesce(v_acc.advance_amount, 0), v_amount);
  v_net_due := v_amount - v_apply_adv;
  select * into v_rates from public.seller_rates where seller_id = v_seller.id and organization_id = v_caller_org;

  v_sale_no := 'SALE-' || v_cur || '-' || to_char(public._goldia_business_date(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
  insert into public.jewelry_sales (
    organization_id, sale_no, seller_id, customer_id, consignment_id, product_name, quantity, base_weight_grams, proba,
    factory_markup_pct, factory_gold_due_grams, client_markup_pct, client_gold_due_grams, markup_spread_grams,
    settled_gold_grams, remaining_gold_grams, status, sale_date, idempotency_key, notes, sale_type,
    sale_currency, sale_amount, sale_usd_rate_snapshot, sale_lom_rate_snapshot
  ) values (
    v_caller_org, v_sale_no, v_seller.id, v_customer.id, v_consign.id,
    case when v_cur = 'USD' then 'Oltin buyum (aniq USD narxda)' else 'Oltin buyum (aniq UZS narxda)' end, 1, v_weight, 585.00,
    0.00, v_weight, 0.00, 0, 0, 0, 0,
    case when v_net_due <= 0 then 'fully_paid' else 'open_debt' end,
    public._goldia_business_date(), nullif(btrim(p_idempotency_key), ''), p_notes, 'weight',
    v_cur, v_amount, v_rates.usd_rate_uzs, v_rates.lom_rate_uzs
  ) returning id into v_sale_id;

  if v_consign.id is not null then
    update public.seller_consignments set status = 'partially_sold', sold_quantity = coalesce(sold_quantity, 0) + 1, updated_at = now()
     where id = v_consign.id;
    if p_piece_ids is not null and cardinality(p_piece_ids) > 0 then
      perform public._goldia_consume_selected_pieces(v_sale_id, v_seller.id, p_piece_ids, v_weight, v_caller_org);
    else
      perform public._goldia_consume_weight_sale_pieces(v_sale_id, v_seller.id, v_consign.id, v_weight, v_caller_org);
    end if;
  end if;

  insert into public.client_currency_accounts (customer_id, currency, organization_id, seller_id, debt_amount, advance_amount, total_sold_amount, updated_at)
  values (v_customer.id, v_cur, v_caller_org, coalesce(v_customer.seller_id, v_seller.id), v_net_due, 0, v_amount, now())
  on conflict (customer_id, currency) do update set
    debt_amount = client_currency_accounts.debt_amount + v_net_due,
    advance_amount = client_currency_accounts.advance_amount - v_apply_adv,
    total_sold_amount = client_currency_accounts.total_sold_amount + v_amount,
    seller_id = coalesce(client_currency_accounts.seller_id, excluded.seller_id),
    updated_at = now();

  perform public.recalc_seller_gold_account(v_seller.id, v_caller_org);

  v_existing := jsonb_build_object(
    'status', 'ok', 'sale_id', v_sale_id, 'sale_no', v_sale_no, 'seller_id', v_seller.id, 'customer_id', v_customer.id,
    'currency', v_cur, 'sale_amount', v_amount, 'advance_applied', v_apply_adv, 'remaining_debt', v_net_due,
    'weight_grams', v_weight, 'remaining_physical_stock_g', public.get_seller_available_stock_grams(v_seller.id));
  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_currency_sale', v_existing, v_payload);
  return v_existing;
end;
$$;
revoke all on function public.rpc_record_currency_sale(uuid, text, numeric, numeric, uuid[], uuid, text, text) from public, anon;
grant execute on function public.rpc_record_currency_sale(uuid, text, numeric, numeric, uuid[], uuid, text, text) to authenticated, service_role;

-- payment of a currency debt: same currency 1:1; another currency or LOM at the operation rate recorded on the row
-- (seller: his own stored LOM / USD rates, checked like 072; management: rates must be entered explicitly)
create or replace function public.rpc_record_client_currency_settlement(
  p_customer_id     uuid,
  p_currency        text,
  p_cash_uzs        numeric default 0,
  p_usd_amount      numeric default 0,
  p_scrap_weight    numeric default 0,
  p_scrap_proba     numeric default null,
  p_usd_rate        numeric default null,
  p_lom_rate        numeric default null,
  p_seller_id       uuid default null,
  p_notes           text default null,
  p_idempotency_key text default null
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
  v_is_seller     boolean;
  v_cur           text := upper(btrim(coalesce(p_currency, '')));
  v_cash          numeric(18, 2) := round(coalesce(p_cash_uzs, 0)::numeric, 2);
  v_usd           numeric(18, 2) := round(coalesce(p_usd_amount, 0)::numeric, 2);
  v_scrap         numeric(14, 4) := round(coalesce(p_scrap_weight, 0)::numeric, 4);
  v_proba         numeric(6, 2);
  v_scrap_585     numeric(14, 4) := 0;
  v_usd_rate      numeric(18, 2);
  v_lom_rate      numeric(18, 2);
  v_need_usd_rate boolean;
  v_credit        numeric(18, 2);
  v_customer      public.customers%rowtype;
  v_seller_id     uuid;
  v_rates         public.seller_rates%rowtype;
  v_acc           public.client_currency_accounts%rowtype;
  v_cur_net       numeric(18, 2);
  v_new_net       numeric(18, 2);
  v_applied       numeric(18, 2);
  v_id            uuid;
  v_no            text;
  v_payload       jsonb;
  v_existing      jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);
  v_is_seller := public._goldia_is_seller_role(v_caller_role);
  if v_cur not in ('UZS', 'USD') then
    raise exception 'ERR_CURRENCY: Qarz valyutasi UZS yoki USD bo''lishi shart';
  end if;
  if coalesce(p_cash_uzs, 0) < 0 or coalesce(p_usd_amount, 0) < 0 or coalesce(p_scrap_weight, 0) < 0 then
    raise exception 'To''lov summalari manfiy bo''lishi mumkin emas';
  end if;
  if v_cash <= 0 and v_usd <= 0 and v_scrap <= 0 then
    raise exception 'To''lov summasi kiritilmagan';
  end if;
  select * into v_customer from public.customers where id = p_customer_id and organization_id = v_caller_org;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;
  if v_is_seller then
    if v_customer.seller_id is not null and v_customer.seller_id is distinct from v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Ushbu mijoz sizga biriktirilmagan' using errcode = '42501';
    end if;
    if p_seller_id is not null and p_seller_id <> v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''z kassasiga to''lov qabul qila oladi' using errcode = '42501';
    end if;
    v_seller_id := v_caller_emp_id;
  else
    v_seller_id := coalesce(p_seller_id, v_customer.seller_id);
  end if;
  if v_seller_id is null or not exists (select 1 from public.employees e where e.id = v_seller_id and e.organization_id = v_caller_org) then
    raise exception 'To''lov qaysi sotuvchi kassasiga tushishi aniqlanmadi (mijozga sotuvchi biriktiring)';
  end if;
  if v_scrap > 0 then
    v_proba := round(coalesce(p_scrap_proba, 585)::numeric, 2);
    if v_proba < 300.0 or v_proba > 1000.0 then
      raise exception 'Noto''g''ri proba kiritildi: % (ruxsat: 300 - 1000)', v_proba;
    end if;
    v_scrap_585 := round((v_scrap * (v_proba / 585.0))::numeric, 4);
  end if;

  v_payload := jsonb_build_object('action', 'record_client_currency_settlement', 'customer_id', p_customer_id, 'currency', v_cur,
    'cash_uzs', v_cash, 'usd', v_usd, 'scrap', v_scrap, 'proba', v_proba, 'seller_id', v_seller_id);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_currency_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- operation rates
  v_need_usd_rate := (v_cur = 'USD' and (v_cash > 0 or v_scrap > 0)) or (v_cur = 'UZS' and v_usd > 0);
  if v_is_seller then
    select * into v_rates from public.seller_rates where seller_id = v_caller_emp_id and organization_id = v_caller_org for share;
    if v_need_usd_rate then
      if v_rates.usd_rate_uzs is null then
        raise exception 'ERR_USD_RATE_NOT_SET: Valyutani almashtirish uchun avval o''z USD kursingizni belgilang.';
      end if;
      if p_usd_rate is not null and p_usd_rate > 0 and abs(round(p_usd_rate::numeric, 2) - v_rates.usd_rate_uzs) > 0.01 then
        raise exception 'ERR_RATE_MISMATCH: Sizning joriy USD kursingiz % UZS. Yuborilgan kurs: % UZS. Sahifani yangilang.', v_rates.usd_rate_uzs, p_usd_rate using errcode = '42501';
      end if;
      v_usd_rate := v_rates.usd_rate_uzs;
    end if;
    if v_scrap > 0 then
      v_lom_rate := coalesce(v_rates.lom_rate_uzs, public._goldia_official_585_rate(v_caller_org));
      if v_lom_rate is null or v_lom_rate <= 0 then
        raise exception 'ERR_DAILY_RATE_NOT_SET: LOM kursingiz belgilanmagan. Avval o''z kursingizni kiriting.';
      end if;
      if p_lom_rate is not null and p_lom_rate > 0 and abs(round(p_lom_rate::numeric, 2) - v_lom_rate) > 0.01 then
        raise exception 'ERR_RATE_MISMATCH: Sizning joriy LOM kursingiz % UZS/g. Yuborilgan kurs: % UZS/g. Sahifani yangilang.', v_lom_rate, p_lom_rate using errcode = '42501';
      end if;
    end if;
  else
    if v_need_usd_rate then
      if p_usd_rate is null or p_usd_rate <= 0 then
        raise exception 'ERR_RATE_REQUIRED: Boshqa valyutadagi to''lov uchun USD kursini kiriting';
      end if;
      v_usd_rate := round(p_usd_rate::numeric, 2);
    end if;
    if v_scrap > 0 then
      if p_lom_rate is null or p_lom_rate <= 0 then
        raise exception 'ERR_RATE_REQUIRED: Lom bilan to''lov uchun LOM (585) kursini kiriting';
      end if;
      v_lom_rate := round(p_lom_rate::numeric, 2);
    end if;
  end if;

  -- credited amount in the debt currency
  if v_cur = 'UZS' then
    v_credit := round((v_cash + v_usd * coalesce(v_usd_rate, 0) + v_scrap_585 * coalesce(v_lom_rate, 0))::numeric, 2);
  else
    v_credit := round((v_usd + case when v_cash > 0 or v_scrap > 0 then (v_cash + v_scrap_585 * coalesce(v_lom_rate, 0)) / nullif(v_usd_rate, 0) else 0 end)::numeric, 2);
  end if;
  if v_credit is null or v_credit <= 0 then
    raise exception 'To''lov summasi 0 ga teng (kursni tekshiring)';
  end if;

  insert into public.client_currency_accounts (customer_id, currency, organization_id, seller_id)
  values (v_customer.id, v_cur, v_caller_org, coalesce(v_customer.seller_id, v_seller_id))
  on conflict (customer_id, currency) do nothing;
  select * into v_acc from public.client_currency_accounts where customer_id = v_customer.id and currency = v_cur for update;
  v_cur_net := v_acc.debt_amount - v_acc.advance_amount;
  v_applied := least(greatest(v_acc.debt_amount, 0), v_credit);
  v_new_net := v_cur_net - v_credit;
  update public.client_currency_accounts
     set debt_amount = greatest(v_new_net, 0), advance_amount = greatest(-v_new_net, 0),
         total_paid_amount = total_paid_amount + v_credit, updated_at = now()
   where customer_id = v_customer.id and currency = v_cur;

  -- the money / scrap goes into the seller till ONCE (unvalued: converted to 585 grams only at the handover)
  insert into public.seller_gold_accounts (seller_id, organization_id, seller_till_scrap_grams, seller_till_scrap_physical_g,
    seller_till_scrap_585_eq_g, seller_till_cash_amount, seller_till_usd_amount, updated_at)
  values (v_seller_id, v_caller_org, v_scrap_585, v_scrap, v_scrap_585, v_cash, v_usd, now())
  on conflict (seller_id) do update set
    seller_till_scrap_grams      = round((seller_gold_accounts.seller_till_scrap_grams + v_scrap_585)::numeric, 4),
    seller_till_scrap_physical_g = round((coalesce(seller_gold_accounts.seller_till_scrap_physical_g, 0) + v_scrap)::numeric, 4),
    seller_till_scrap_585_eq_g   = round((coalesce(seller_gold_accounts.seller_till_scrap_585_eq_g, 0) + v_scrap_585)::numeric, 4),
    seller_till_cash_amount      = round((seller_gold_accounts.seller_till_cash_amount + v_cash)::numeric, 2),
    seller_till_usd_amount       = round((coalesce(seller_gold_accounts.seller_till_usd_amount, 0) + v_usd)::numeric, 2),
    updated_at = now();

  v_no := 'CPAY-' || v_cur || '-' || to_char(public._goldia_business_date(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
  insert into public.client_currency_settlements (organization_id, settlement_no, customer_id, seller_id, debt_currency, cash_uzs, usd_amount,
    scrap_physical_g, scrap_proba, scrap_585_g, rate_usd_uzs, rate_lom_uzs, credited_amount, applied_to_debt, to_advance,
    idempotency_key, recorded_by, notes)
  values (v_caller_org, v_no, v_customer.id, v_seller_id, v_cur, v_cash, v_usd, v_scrap, v_proba, v_scrap_585, v_usd_rate, v_lom_rate,
    v_credit, v_applied, v_credit - v_applied, nullif(btrim(p_idempotency_key), ''), v_caller_emp_id, p_notes)
  returning id into v_id;

  v_existing := jsonb_build_object('status', 'ok', 'settlement_id', v_id, 'settlement_no', v_no, 'currency', v_cur,
    'credited_amount', v_credit, 'applied_to_debt', v_applied, 'to_advance', v_credit - v_applied,
    'rate_usd_uzs', v_usd_rate, 'rate_lom_uzs', v_lom_rate, 'scrap_585_g', v_scrap_585,
    'new_debt', greatest(v_new_net, 0), 'new_advance', greatest(-v_new_net, 0));
  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_currency_settlement', v_existing, v_payload);
  return v_existing;
end;
$$;
revoke all on function public.rpc_record_client_currency_settlement(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.rpc_record_client_currency_settlement(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text, text) to authenticated, service_role;

create or replace function public.rpc_reverse_client_currency_settlement(p_settlement_id uuid, p_reason text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_reason        text := nullif(btrim(p_reason), '');
  v_row           public.client_currency_settlements%rowtype;
  v_acc           public.client_currency_accounts%rowtype;
  v_till          public.seller_gold_accounts%rowtype;
  v_new_net       numeric(18, 2);
  v_payload       jsonb;
  v_existing      jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);
  if v_reason is null then
    raise exception 'To''lovni bekor qilish sababi kiritilishi shart';
  end if;
  v_payload := jsonb_build_object('action', 'reverse_client_currency_settlement', 'settlement_id', p_settlement_id, 'reason', v_reason);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_client_currency_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;
  select * into v_row from public.client_currency_settlements where id = p_settlement_id and organization_id = v_caller_org for update;
  if not found then
    raise exception 'To''lov topilmadi (%)', p_settlement_id;
  end if;
  if v_row.status = 'reversed' then
    raise exception 'Ushbu to''lov allaqachon bekor qilingan (%)', v_row.settlement_no;
  end if;
  select * into v_till from public.seller_gold_accounts where seller_id = v_row.seller_id for update;
  if coalesce(v_till.seller_till_cash_amount, 0) < v_row.cash_uzs or coalesce(v_till.seller_till_usd_amount, 0) < v_row.usd_amount
     or coalesce(v_till.seller_till_scrap_grams, 0) < v_row.scrap_585_g then
    raise exception 'ERR_TILL_ALREADY_HANDED_OVER: Bu to''lov pullari sotuvchi kassasida qolmagan (topshirilgan). Avval topshiruvni bekor qiling.';
  end if;
  update public.seller_gold_accounts
     set seller_till_cash_amount = round((seller_till_cash_amount - v_row.cash_uzs)::numeric, 2),
         seller_till_usd_amount = round((coalesce(seller_till_usd_amount, 0) - v_row.usd_amount)::numeric, 2),
         seller_till_scrap_grams = round((seller_till_scrap_grams - v_row.scrap_585_g)::numeric, 4),
         seller_till_scrap_physical_g = round((coalesce(seller_till_scrap_physical_g, 0) - v_row.scrap_physical_g)::numeric, 4),
         seller_till_scrap_585_eq_g = round((coalesce(seller_till_scrap_585_eq_g, 0) - v_row.scrap_585_g)::numeric, 4),
         updated_at = now()
   where seller_id = v_row.seller_id;
  select * into v_acc from public.client_currency_accounts where customer_id = v_row.customer_id and currency = v_row.debt_currency for update;
  v_new_net := (v_acc.debt_amount - v_acc.advance_amount) + v_row.credited_amount;
  update public.client_currency_accounts
     set debt_amount = greatest(v_new_net, 0), advance_amount = greatest(-v_new_net, 0),
         total_paid_amount = total_paid_amount - v_row.credited_amount, updated_at = now()
   where customer_id = v_row.customer_id and currency = v_row.debt_currency;
  update public.client_currency_settlements
     set status = 'reversed', reversed_at = clock_timestamp(), reversed_by = public.current_employee_id(), reversal_reason = v_reason
   where id = v_row.id;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_caller_org, 'client_currency_settlements', v_row.id::text, 'REVERSE_CLIENT_CURRENCY_SETTLEMENT', auth.uid(),
    jsonb_build_object('status', 'confirmed', 'credited_amount', v_row.credited_amount, 'currency', v_row.debt_currency),
    jsonb_build_object('status', 'reversed'), v_reason);
  v_existing := jsonb_build_object('status', 'ok', 'settlement_id', v_row.id, 'reversed_amount', v_row.credited_amount,
    'currency', v_row.debt_currency, 'new_debt', greatest(v_new_net, 0), 'new_advance', greatest(-v_new_net, 0));
  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_currency_settlement', v_existing, v_payload);
  return v_existing;
end;
$$;
revoke all on function public.rpc_reverse_client_currency_settlement(uuid, text, text) from public, anon;
grant execute on function public.rpc_reverse_client_currency_settlement(uuid, text, text) to authenticated, service_role;

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
  -- 070: payments are applied at customer-account level (sale rows are usually not updated), so the
  -- reversal must remove the full sale amount from the account's net position. Whatever the customer
  -- has already paid beyond the remaining debt becomes an advance (credit) instead of disappearing.
  v_new_cust_debt := ROUND((COALESCE(v_cust_acc.current_debt_grams, 0) - COALESCE(v_cust_acc.advance_balance_grams, 0)
                            - v_sale.client_gold_due_grams)::numeric, 4);
  IF v_new_cust_debt >= 0 THEN
    v_new_cust_adv := 0;
  ELSE
    v_new_cust_adv  := ROUND(-v_new_cust_debt, 4);
    v_new_cust_debt := 0;
  END IF;

  UPDATE public.client_gold_accounts
     SET total_purchased_gold_grams = ROUND(GREATEST(0, total_purchased_gold_grams - v_sale.client_gold_due_grams)::numeric, 4),
         current_debt_grams         = v_new_cust_debt,
         advance_balance_grams      = v_new_cust_adv,
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

  -- 077: a UZS / USD price sale reverses the customer's CURRENCY debt (its 585 gram debt was never touched)
  IF coalesce(v_sale.sale_currency, 'XAU585') <> 'XAU585' THEN
    PERFORM 1 FROM public.client_currency_accounts
     WHERE customer_id = v_sale.customer_id AND currency = v_sale.sale_currency FOR UPDATE;
    UPDATE public.client_currency_accounts
       SET debt_amount = greatest((debt_amount - advance_amount) - v_sale.sale_amount, 0),
           advance_amount = greatest(-((debt_amount - advance_amount) - v_sale.sale_amount), 0),
           total_sold_amount = total_sold_amount - v_sale.sale_amount,
           updated_at = NOW()
     WHERE customer_id = v_sale.customer_id AND currency = v_sale.sale_currency;
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
    'reversed_debt_g', v_net_sale_debt,
    'sale_currency', coalesce(v_sale.sale_currency, 'XAU585'),
    'reversed_amount', v_sale.sale_amount
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_sale', v_existing, v_payload);
  END IF;

  RETURN v_existing;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_reverse_jewelry_sale(p_sale_id uuid, p_reversal_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_caller_emp_id uuid := public.current_employee_id();
  v_sale          public.jewelry_sales%rowtype;
  v_client_acc    public.client_gold_accounts%rowtype;
  v_reason        text := NULLIF(btrim(p_reversal_reason), '');
  v_piece         public.consignment_pieces%rowtype;
  v_consign       public.seller_consignments%rowtype;
  v_applied_sett  public.gold_settlements%rowtype;
  v_existing      jsonb;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi',
    'accountant', 'buxgalter', 'sales', 'seller', 'sotuvchi'
  ]);

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Savdoni bekor qilish sababi (reversal reason) kiritilishi shart';
  END IF;

  SELECT * INTO v_sale
    FROM public.jewelry_sales
   WHERE id = p_sale_id AND organization_id = v_caller_org
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bekor qilinadigan savdo yozuvi topilmadi (%)', p_sale_id;
  END IF;

  IF v_sale.status IN ('cancelled', 'reversed') THEN
    RAISE EXCEPTION 'Ushbu savdo allaqachon bekor qilingan (Holat: %)', v_sale.status;
  END IF;

  -- 077: UZS / USD price sales are reversed only by rpc_reverse_client_sale (it reverses the currency debt)
  IF coalesce(v_sale.sale_currency, 'XAU585') <> 'XAU585' THEN
    RAISE EXCEPTION 'Valyutali savdoni "Bekor qilish" (rpc_reverse_client_sale) orqali bekor qiling';
  END IF;

  -- Cross-seller sale reversal authorization check
  IF v_caller_role IN ('seller', 'sotuvchi', 'sales') THEN
    IF v_sale.seller_id IS DISTINCT FROM v_caller_emp_id THEN
      RAISE EXCEPTION 'Ruxsat etilmadi: Sotuvchilar faqat o''zi amalga oshirgan savdoni bekor qila oladi' USING errcode = '42501';
    END IF;
  END IF;

  -- 1. Check if customer made active payments specifically applied to this sale
  FOR v_applied_sett IN
    SELECT * FROM public.gold_settlements
     WHERE sale_id = v_sale.id
       AND organization_id = v_caller_org
       AND status NOT IN ('reversed', 'cancelled')
  LOOP
    RAISE EXCEPTION 'Savdoni bekor qilib bo''lmaydi: Ushbu savdoga to''lov bog''langan (% — % g). Avval to''lovni bekor qiling.',
      v_applied_sett.settlement_no, v_applied_sett.applied_to_debt_grams;
  END LOOP;

  -- 2. Deduct customer debt generated by this sale
  SELECT * INTO v_client_acc
    FROM public.client_gold_accounts
   WHERE customer_id = v_sale.customer_id AND organization_id = v_caller_org
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.client_gold_accounts
       SET current_debt_grams = ROUND(GREATEST(0, current_debt_grams - v_sale.remaining_gold_grams)::numeric, 4),
           total_purchased_gold_grams = ROUND(GREATEST(0, total_purchased_gold_grams - v_sale.client_gold_due_grams)::numeric, 4),
           updated_at = NOW()
     WHERE customer_id = v_client_acc.customer_id;
  END IF;

  -- 3. If a physical piece or weight stock was sold, restore it
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

    -- Reopen parent consignment if it was marked fully_sold
    IF v_piece.consignment_id IS NOT NULL THEN
      SELECT * INTO v_consign
        FROM public.seller_consignments
       WHERE id = v_piece.consignment_id
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
  ELSIF v_sale.consignment_id IS NOT NULL THEN
    -- Weight sale partial deduction: restore weight_grams back on active consignment_piece
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

  -- 4. Mark sale as reversed
  UPDATE public.jewelry_sales
     SET status = 'reversed',
         notes = COALESCE(notes, '') || ' [BEKOR QILINDI: ' || v_reason || ' (' || to_char(NOW(), 'YYYY-MM-DD HH24:MI') || ')]',
         updated_at = NOW()
   WHERE id = v_sale.id;

  -- 5. Recalculate seller responsibility
  PERFORM public.recalc_seller_gold_account(v_sale.seller_id, v_caller_org);

  -- 6. Audit log
  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) VALUES (
    v_caller_org, 'jewelry_sales', v_sale.id::text, 'REVERSE_SALE', auth.uid(),
    jsonb_build_object(
      'sale_id', v_sale.id,
      'sale_no', v_sale.sale_no,
      'customer_id', v_sale.customer_id,
      'seller_id', v_sale.seller_id,
      'reversed_debt_g', v_sale.remaining_gold_grams,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale.id,
    'sale_no', v_sale.sale_no,
    'reversed_debt_g', v_sale.remaining_gold_grams,
    'restored_piece_id', v_piece.id,
    'message', 'Savdo muvaffaqiyatli bekor qilindi'
  );
END;
$function$;

-- ======================================================================================================
-- C. Period report (any two Asia/Tashkent business dates, both inclusive) and report periods.
--    Balances at a date D are DERIVED: live balance - sum of documented effects dated after D. That is exact even
--    when part of today's balance was entered without documents (baseline / import): such a part simply shows up
--    in every opening balance. Effects use the business date stored on the document (or the Tashkent date of the
--    reversal time); historical documents keep their own rates - nothing is revalued at today's rate.
--    Physical grams, 585-equivalent grams, UZS and USD are separate fields and are never added together.
--    "Start a new period" only records the period and a frozen copy of its report: no balance, debt, stock,
--    till or transaction is reset, changed or deleted.
-- ======================================================================================================
create or replace function public._goldia_fin_cash_effect(p_type text, p_till text, p_amount numeric)
returns table (till_uzs numeric, till_usd numeric, mgr_uzs numeric, mgr_usd numeric)
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_till = 'seller_till_uzs' and p_type in ('capital_in', 'capital_contribution') then p_amount else 0 end,
         case when p_till = 'seller_till_usd' and p_type in ('capital_in', 'capital_contribution') then p_amount else 0 end,
         case when p_till in ('manager_uzs', 'manager_cash', 'cash_uzs') then
                case when p_type in ('capital_in', 'capital_contribution') then p_amount
                     when p_type in ('capital_out', 'capital_distribution', 'expense', 'business_expense') then -p_amount else 0 end else 0 end,
         case when p_till in ('manager_usd', 'cash_usd') then
                case when p_type in ('capital_in', 'capital_contribution') then p_amount
                     when p_type in ('capital_out', 'capital_distribution', 'expense', 'business_expense') then -p_amount else 0 end else 0 end
$$;
revoke all on function public._goldia_fin_cash_effect(text, text, numeric) from public, anon, authenticated;

create or replace function public._goldia_period_effects(p_org uuid)
returns table (
  kind text, d date, seller_id uuid, cnt int,
  cust_g numeric, cur_uzs numeric, cur_usd numeric, stock_g numeric,
  till_uzs numeric, till_usd numeric, till_scrap_g numeric,
  mgr_uzs numeric, mgr_usd numeric, factory_g numeric,
  phys_g numeric, due_g numeric, amount numeric, extra numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with sales as (
    select s.*, coalesce(s.sale_currency, 'XAU585') as cur,
           (select min(a.created_at) from public.audit_logs a where a.table_name = 'jewelry_sales' and a.record_id = s.id::text
             and a.action in ('REVERSE_CLIENT_SALE', 'REVERSE_JEWELRY_SALE', 'REVERSE_SALE')) as rev_at
      from public.jewelry_sales s where s.organization_id = p_org
  )
  -- sales (gram + %, UZS, USD): physical grams leave the seller stock; debt in 585 g or in the currency
  select case cur when 'XAU585' then 'sale_gram' when 'UZS' then 'sale_uzs' else 'sale_usd' end, sale_date, seller_id, 1,
         case when cur = 'XAU585' then client_gold_due_grams else 0 end,
         case when cur = 'UZS' then sale_amount else 0 end, case when cur = 'USD' then sale_amount else 0 end,
         -base_weight_grams, 0, 0, 0, 0, 0, 0,
         base_weight_grams, case when cur = 'XAU585' then client_gold_due_grams else 0 end, coalesce(sale_amount, 0), 0
    from sales
  union all
  select 'reversal_sale', public._goldia_business_date(coalesce(rev_at, updated_at)), seller_id, 1,
         case when cur = 'XAU585' then -client_gold_due_grams else 0 end,
         case when cur = 'UZS' then -sale_amount else 0 end, case when cur = 'USD' then -sale_amount else 0 end,
         base_weight_grams, 0, 0, 0, 0, 0, 0,
         base_weight_grams, case when cur = 'XAU585' then client_gold_due_grams else 0 end, coalesce(sale_amount, 0), 0
    from sales where status in ('reversed', 'cancelled')
  -- customer payments of 585 debts (cash / USD / scrap at the rate recorded on the payment)
  union all
  select 'payment_gram', g.settlement_date, g.seller_id, 1,
         -g.total_settled_grams, 0, 0, 0,
         coalesce(g.cash_paid_amount, 0), coalesce(g.usd_paid_amount, 0), coalesce(g.scrap_585_equiv_grams, 0), 0, 0, 0,
         coalesce(g.physical_scrap_grams, 0), g.total_settled_grams, 0, coalesce(g.excess_gold_grams, 0)
    from public.gold_settlements g where g.organization_id = p_org and g.direction = 'client_to_seller' and g.reversal_of_id is null
  union all
  select 'reversal_payment_gram', public._goldia_business_date(g.reversed_at), g.seller_id, 1,
         g.total_settled_grams, 0, 0, 0,
         -coalesce(g.cash_paid_amount, 0), -coalesce(g.usd_paid_amount, 0), -coalesce(g.scrap_585_equiv_grams, 0), 0, 0, 0,
         coalesce(g.physical_scrap_grams, 0), g.total_settled_grams, 0, 0
    from public.gold_settlements g where g.organization_id = p_org and g.direction = 'client_to_seller' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- legacy debts / advances / reconciliations (entered on the day they were recorded, not on the notebook date)
  union all
  select 'legacy_' || l.entry_type || '_' || l.balance_type, public._goldia_business_date(l.created_at), l.seller_id, 1,
         l.delta_585_g, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, l.delta_585_g, 0, 0
    from public.client_legacy_debts l where l.organization_id = p_org
  union all
  select 'reversal_legacy', public._goldia_business_date(l.reversed_at), l.seller_id, 1,
         -l.delta_585_g, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, l.delta_585_g, 0, 0
    from public.client_legacy_debts l where l.organization_id = p_org and l.status = 'reversed' and l.reversed_at is not null
  -- payments of UZS / USD debts
  union all
  select 'payment_' || lower(c.debt_currency), c.settlement_date, c.seller_id, 1,
         0, case when c.debt_currency = 'UZS' then -c.credited_amount else 0 end, case when c.debt_currency = 'USD' then -c.credited_amount else 0 end, 0,
         c.cash_uzs, c.usd_amount, c.scrap_585_g, 0, 0, 0,
         c.scrap_physical_g, c.scrap_585_g, c.credited_amount, c.to_advance
    from public.client_currency_settlements c where c.organization_id = p_org
  union all
  select 'reversal_payment_' || lower(c.debt_currency), public._goldia_business_date(c.reversed_at), c.seller_id, 1,
         0, case when c.debt_currency = 'UZS' then c.credited_amount else 0 end, case when c.debt_currency = 'USD' then c.credited_amount else 0 end, 0,
         -c.cash_uzs, -c.usd_amount, -c.scrap_585_g, 0, 0, 0,
         c.scrap_physical_g, c.scrap_585_g, c.credited_amount, 0
    from public.client_currency_settlements c where c.organization_id = p_org and c.status = 'reversed' and c.reversed_at is not null
  -- seller -> manager handovers (till -> manager vault)
  union all
  select 'handover', g.settlement_date, g.seller_id, 1,
         0, 0, 0, 0,
         -coalesce(g.cash_paid_amount, 0), -coalesce(g.usd_paid_amount, 0), -coalesce(g.scrap_585_equiv_grams, 0),
         coalesce(g.cash_paid_amount, 0), coalesce(g.usd_paid_amount, 0), 0,
         coalesce(g.physical_scrap_grams, 0), g.total_settled_grams, 0, 0
    from public.gold_settlements g where g.organization_id = p_org and g.direction = 'seller_to_manager' and g.reversal_of_id is null
  union all
  select 'reversal_handover', public._goldia_business_date(g.reversed_at), g.seller_id, 1,
         0, 0, 0, 0,
         coalesce(g.cash_paid_amount, 0), coalesce(g.usd_paid_amount, 0), coalesce(g.scrap_585_equiv_grams, 0),
         -coalesce(g.cash_paid_amount, 0), -coalesce(g.usd_paid_amount, 0), 0,
         coalesce(g.physical_scrap_grams, 0), g.total_settled_grams, 0, 0
    from public.gold_settlements g where g.organization_id = p_org and g.direction = 'seller_to_manager' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- distribution to sellers, returns, cancellations
  union all
  select 'consignment', public._goldia_business_date(coalesce(c.issued_at, c.created_at)), c.seller_id, 1,
         0, 0, 0, coalesce(c.original_base_weight_grams, c.base_weight_grams + coalesce(c.returned_weight_grams, 0)),
         0, 0, 0, 0, 0, 0,
         coalesce(c.original_base_weight_grams, c.base_weight_grams + coalesce(c.returned_weight_grams, 0)),
         coalesce(c.original_seller_obligation_g, c.seller_obligation_g, 0), 0, 0
    from public.seller_consignments c where c.organization_id = p_org
  union all
  select 'consignment_cancelled', public._goldia_business_date(c.cancelled_at), c.seller_id, 1,
         0, 0, 0, -c.base_weight_grams, 0, 0, 0, 0, 0, 0, c.base_weight_grams, 0, 0, 0
    from public.seller_consignments c where c.organization_id = p_org and c.status = 'cancelled' and c.cancelled_at is not null
  union all
  select 'return_to_manager', public._goldia_business_date(p.returned_to_manager_at), p.seller_id, 1,
         0, 0, 0, -p.weight_grams, 0, 0, 0, 0, 0, 0, p.weight_grams, 0, 0, 0
    from public.consignment_pieces p where p.organization_id = p_org and p.returned_to_manager_at is not null
  -- factory
  union all
  select 'factory_receipt', r.receipt_date, null::uuid, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, r.factory_obligation_g,
         r.original_physical_g, r.factory_obligation_g, 0, coalesce(r.factory_markup_pct, 0)
    from public.factory_receipts r where r.organization_id = p_org
  union all
  select 'reversal_factory_receipt', public._goldia_business_date(r.reversed_at), null, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, -r.factory_obligation_g,
         r.original_physical_g, r.factory_obligation_g, 0, 0
    from public.factory_receipts r where r.organization_id = p_org and r.status in ('reversed', 'cancelled') and r.reversed_at is not null
  union all
  select 'factory_handover', h.handover_date, null, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, -h.agreed_equivalent_g,
         h.physical_weight_g, h.agreed_equivalent_g, 0, 0
    from public.factory_gold_handovers h where h.organization_id = p_org
  union all
  select 'reversal_factory_handover', public._goldia_business_date(h.reversed_at), null, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, h.agreed_equivalent_g,
         h.physical_weight_g, h.agreed_equivalent_g, 0, 0
    from public.factory_gold_handovers h where h.organization_id = p_org and h.status in ('reversed', 'cancelled') and h.reversed_at is not null
  -- capital / expenses (manager tills, seller tills); a reclassified operation: its original effect on its own date,
  -- then the move (minus original, plus new) on the reclassification date
  union all
  select 'fin_' || f.transaction_type || '_' || coalesce(f.reclassified_from_till, f.source_till), f.transaction_date, f.seller_id, 1,
         0, 0, 0, 0, o.till_uzs, o.till_usd, 0, o.mgr_uzs, o.mgr_usd, 0,
         coalesce(f.physical_weight_grams, 0), coalesce(f.equiv_585_grams, 0), coalesce(f.reclassified_from_amount, f.amount_num), 0
    from public.financial_transactions f
    cross join lateral public._goldia_fin_cash_effect(f.transaction_type, coalesce(f.reclassified_from_till, f.source_till), coalesce(f.reclassified_from_amount, f.amount_num)) o
   where f.organization_id = p_org
  union all
  select 'fin_reclassify', public._goldia_business_date(f.reclassified_at), f.seller_id, 1,
         0, 0, 0, 0, n.till_uzs - o.till_uzs, n.till_usd - o.till_usd, 0, n.mgr_uzs - o.mgr_uzs, n.mgr_usd - o.mgr_usd, 0,
         0, coalesce(f.equiv_585_grams, 0), f.amount_num, 0
    from public.financial_transactions f
    cross join lateral public._goldia_fin_cash_effect(f.transaction_type, f.reclassified_from_till, f.reclassified_from_amount) o
    cross join lateral public._goldia_fin_cash_effect(f.transaction_type, f.source_till, f.amount_num) n
   where f.organization_id = p_org and f.reclassified_at is not null
  union all
  select 'reversal_fin', public._goldia_business_date(f.reversed_at), f.seller_id, 1,
         0, 0, 0, 0, -n.till_uzs, -n.till_usd, 0, -n.mgr_uzs, -n.mgr_usd, 0, 0, 0, f.amount_num, 0
    from public.financial_transactions f
    cross join lateral public._goldia_fin_cash_effect(f.transaction_type, f.source_till, f.amount_num) n
   where f.organization_id = p_org and f.status = 'reversed' and f.reversed_at is not null
  -- cash gold purchases
  union all
  select 'purchase', p.purchase_date, null, 1, 0, 0, 0, 0, 0, 0, 0, -coalesce(p.cash_spent_uzs, 0), -coalesce(p.usd_spent, 0), 0,
         coalesce(p.gold_weight_grams, 0), coalesce(p.equiv_585_grams, 0), 0, 0
    from public.gold_purchases p where p.organization_id = p_org
  union all
  select 'reversal_purchase', public._goldia_business_date(p.reversed_at), null, 1, 0, 0, 0, 0, 0, 0, 0, coalesce(p.cash_spent_uzs, 0), coalesce(p.usd_spent, 0), 0,
         coalesce(p.gold_weight_grams, 0), coalesce(p.equiv_585_grams, 0), 0, 0
    from public.gold_purchases p where p.organization_id = p_org and p.status in ('reversed', 'cancelled') and p.reversed_at is not null
$$;
revoke all on function public._goldia_period_effects(uuid) from public, anon, authenticated;
grant execute on function public._goldia_period_effects(uuid) to service_role;

create or replace function public.rpc_get_period_report(p_from date, p_to date, p_seller_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid := public.current_organization_id();
  v_role    text := public.current_employee_role_text();
  v_today   date := public._goldia_business_date();
  v_live    record;
  v_after_to record;
  v_after_from record;
  v_first   date;
  v_before_first record;
  v_flows   jsonb;
  v_sellers jsonb;
  v_rates   jsonb;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  if not public._goldia_is_management_role(v_role) then
    raise exception 'Ruxsat etilmadi: davriy hisobot faqat direktor va menejer uchun' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Sana oralig''i noto''g''ri (boshlanish <= tugash bo''lishi shart)';
  end if;
  if p_to - p_from > 3700 then
    raise exception 'Sana oralig''i 10 yildan oshmasligi kerak';
  end if;

  select
    coalesce((select sum(current_debt_grams - advance_balance_grams) from public.client_gold_accounts where organization_id = v_org), 0) as cust_g,
    coalesce((select sum(debt_amount - advance_amount) from public.client_currency_accounts where organization_id = v_org and currency = 'UZS'), 0) as cur_uzs,
    coalesce((select sum(debt_amount - advance_amount) from public.client_currency_accounts where organization_id = v_org and currency = 'USD'), 0) as cur_usd,
    coalesce((select sum(current_physical_stock_g) from public.seller_gold_accounts where organization_id = v_org), 0) as stock_g,
    coalesce((select sum(seller_till_cash_amount) from public.seller_gold_accounts where organization_id = v_org), 0) as till_uzs,
    coalesce((select sum(seller_till_usd_amount) from public.seller_gold_accounts where organization_id = v_org), 0) as till_usd,
    coalesce((select sum(seller_till_scrap_grams) from public.seller_gold_accounts where organization_id = v_org), 0) as till_scrap_g,
    coalesce((select sum(manager_cash_amount) from public.manager_vault_account where organization_id = v_org), 0) as mgr_uzs,
    coalesce((select sum(manager_usd_amount) from public.manager_vault_account where organization_id = v_org), 0) as mgr_usd,
    coalesce((select sum(current_factory_obligation_g - coalesce(current_factory_advance_g, 0)) from public.manager_vault_account where organization_id = v_org), 0) as factory_g
  into v_live;

  select coalesce(sum(cust_g), 0) cust_g, coalesce(sum(cur_uzs), 0) cur_uzs, coalesce(sum(cur_usd), 0) cur_usd, coalesce(sum(stock_g), 0) stock_g,
         coalesce(sum(till_uzs), 0) till_uzs, coalesce(sum(till_usd), 0) till_usd, coalesce(sum(till_scrap_g), 0) till_scrap_g,
         coalesce(sum(mgr_uzs), 0) mgr_uzs, coalesce(sum(mgr_usd), 0) mgr_usd, coalesce(sum(factory_g), 0) factory_g
    into v_after_to from public._goldia_period_effects(v_org) e where e.d > p_to;
  select coalesce(sum(cust_g), 0) cust_g, coalesce(sum(cur_uzs), 0) cur_uzs, coalesce(sum(cur_usd), 0) cur_usd, coalesce(sum(stock_g), 0) stock_g,
         coalesce(sum(till_uzs), 0) till_uzs, coalesce(sum(till_usd), 0) till_usd, coalesce(sum(till_scrap_g), 0) till_scrap_g,
         coalesce(sum(mgr_uzs), 0) mgr_uzs, coalesce(sum(mgr_usd), 0) mgr_usd, coalesce(sum(factory_g), 0) factory_g
    into v_after_from from public._goldia_period_effects(v_org) e where e.d >= p_from;
  select min(d) into v_first from public._goldia_period_effects(v_org);
  select coalesce(sum(cust_g), 0) cust_g, coalesce(sum(cur_uzs), 0) cur_uzs, coalesce(sum(cur_usd), 0) cur_usd, coalesce(sum(stock_g), 0) stock_g,
         coalesce(sum(till_uzs), 0) till_uzs, coalesce(sum(till_usd), 0) till_usd, coalesce(sum(till_scrap_g), 0) till_scrap_g,
         coalesce(sum(mgr_uzs), 0) mgr_uzs, coalesce(sum(mgr_usd), 0) mgr_usd, coalesce(sum(factory_g), 0) factory_g
    into v_before_first from public._goldia_period_effects(v_org) e;

  select coalesce(jsonb_object_agg(kind, x), '{}'::jsonb) into v_flows from (
    select kind, jsonb_build_object('count', sum(cnt), 'physical_g', round(sum(phys_g), 4), 'g585', round(sum(due_g), 4),
           'amount', round(sum(amount), 2), 'cash_uzs', round(sum(abs(till_uzs) + abs(mgr_uzs)) filter (where kind not like 'fin_%' and kind not like 'purchase%'), 2),
           'usd', round(sum(abs(till_usd) + abs(mgr_usd)) filter (where kind not like 'fin_%' and kind not like 'purchase%'), 2),
           'scrap_585_g', round(sum(abs(till_scrap_g)), 4), 'advance_created', round(sum(extra) filter (where kind like 'payment%'), 4),
           'customer_g585_change', round(sum(cust_g), 4), 'customer_uzs_change', round(sum(cur_uzs), 2), 'customer_usd_change', round(sum(cur_usd), 2),
           'manager_uzs_change', round(sum(mgr_uzs), 2), 'manager_usd_change', round(sum(mgr_usd), 2), 'seller_stock_change_g', round(sum(stock_g), 4),
           'factory_obligation_change_g', round(sum(factory_g), 4)) as x
      from public._goldia_period_effects(v_org) e
     where e.d between p_from and p_to and (p_seller_id is null or e.seller_id = p_seller_id or e.seller_id is null)
     group by kind) q;

  -- per seller: period sales / payments / handovers and live till / obligation / stock
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v_sellers from (
    select jsonb_build_object(
      'seller_id', s.seller_id, 'name', coalesce(e.full_name, e.name),
      'sales_gram_count', coalesce(sum(f.cnt) filter (where f.kind = 'sale_gram'), 0),
      'sales_gram_physical_g', round(coalesce(sum(f.phys_g) filter (where f.kind = 'sale_gram'), 0), 4),
      'sales_gram_due_g585', round(coalesce(sum(f.due_g) filter (where f.kind = 'sale_gram'), 0), 4),
      'sales_uzs_count', coalesce(sum(f.cnt) filter (where f.kind = 'sale_uzs'), 0),
      'sales_uzs_amount', round(coalesce(sum(f.amount) filter (where f.kind = 'sale_uzs'), 0), 2),
      'sales_uzs_physical_g', round(coalesce(sum(f.phys_g) filter (where f.kind = 'sale_uzs'), 0), 4),
      'sales_usd_count', coalesce(sum(f.cnt) filter (where f.kind = 'sale_usd'), 0),
      'sales_usd_amount', round(coalesce(sum(f.amount) filter (where f.kind = 'sale_usd'), 0), 2),
      'sales_usd_physical_g', round(coalesce(sum(f.phys_g) filter (where f.kind = 'sale_usd'), 0), 4),
      'reversed_sales_physical_g', round(coalesce(sum(f.phys_g) filter (where f.kind = 'reversal_sale'), 0), 4),
      'collected_cash_uzs', round(coalesce(sum(f.till_uzs) filter (where f.kind like 'payment%' or f.kind like 'reversal_payment%'), 0), 2),
      'collected_usd', round(coalesce(sum(f.till_usd) filter (where f.kind like 'payment%' or f.kind like 'reversal_payment%'), 0), 2),
      'collected_scrap_585_g', round(coalesce(sum(f.till_scrap_g) filter (where f.kind like 'payment%' or f.kind like 'reversal_payment%'), 0), 4),
      'handed_over_cash_uzs', round(coalesce(-sum(f.till_uzs) filter (where f.kind in ('handover', 'reversal_handover')), 0), 2),
      'handed_over_usd', round(coalesce(-sum(f.till_usd) filter (where f.kind in ('handover', 'reversal_handover')), 0), 2),
      'handed_over_g585', round(coalesce(sum(f.due_g) filter (where f.kind = 'handover'), 0), 4),
      'received_physical_g', round(coalesce(sum(f.phys_g) filter (where f.kind = 'consignment'), 0), 4),
      'received_obligation_g585', round(coalesce(sum(f.due_g) filter (where f.kind = 'consignment'), 0), 4),
      'returned_physical_g', round(coalesce(sum(f.phys_g) filter (where f.kind = 'return_to_manager'), 0), 4),
      'legacy_change_g585', round(coalesce(sum(f.cust_g) filter (where f.kind like 'legacy%' or f.kind = 'reversal_legacy'), 0), 4),
      'live_till_uzs', s.seller_till_cash_amount, 'live_till_usd', s.seller_till_usd_amount, 'live_till_scrap_g585', s.seller_till_scrap_grams,
      'live_obligation_signed_g585', s.bozor_qarzi_signed_g, 'live_owes_manager_g585', s.seller_owes_manager_g,
      'live_physical_stock_g', s.current_physical_stock_g,
      'closing_physical_stock_g', round(s.current_physical_stock_g - coalesce(sum(a.stock_g), 0), 4),
      'closing_till_uzs', round(s.seller_till_cash_amount - coalesce(sum(a.till_uzs), 0), 2),
      'closing_till_usd', round(coalesce(s.seller_till_usd_amount, 0) - coalesce(sum(a.till_usd), 0), 2)
    ) as x
    from public.seller_gold_accounts s
    join public.employees e on e.id = s.seller_id
    left join public._goldia_period_effects(v_org) f on f.seller_id = s.seller_id and f.d between p_from and p_to
    left join lateral (select sum(z.stock_g) stock_g, sum(z.till_uzs) till_uzs, sum(z.till_usd) till_usd
                         from public._goldia_period_effects(v_org) z where z.seller_id = s.seller_id and z.d > p_to) a on true
    where s.organization_id = v_org and (p_seller_id is null or s.seller_id = p_seller_id)
    group by s.seller_id, e.full_name, e.name, s.seller_till_cash_amount, s.seller_till_usd_amount, s.seller_till_scrap_grams,
             s.bozor_qarzi_signed_g, s.seller_owes_manager_g, s.current_physical_stock_g) q;

  -- rate snapshots of the period (each document keeps its own rate)
  select jsonb_build_object(
    'gram_payments_lom_rate_min', min(g.gold_rate_applied) filter (where coalesce(g.cash_paid_amount, 0) > 0 or coalesce(g.usd_paid_amount, 0) > 0),
    'gram_payments_lom_rate_max', max(g.gold_rate_applied) filter (where coalesce(g.cash_paid_amount, 0) > 0 or coalesce(g.usd_paid_amount, 0) > 0),
    'gram_payments_usd_rate_min', min(g.applied_usd_rate) filter (where coalesce(g.usd_paid_amount, 0) > 0),
    'gram_payments_usd_rate_max', max(g.applied_usd_rate) filter (where coalesce(g.usd_paid_amount, 0) > 0),
    'scrap_physical_g_585', round(coalesce(sum(g.physical_scrap_grams) filter (where g.scrap_proba = 585), 0), 4),
    'scrap_physical_g_750', round(coalesce(sum(g.physical_scrap_grams) filter (where g.scrap_proba = 750), 0), 4),
    'scrap_physical_g_other', round(coalesce(sum(g.physical_scrap_grams) filter (where g.scrap_proba not in (585, 750)), 0), 4),
    'scrap_585_equivalent_g', round(coalesce(sum(g.scrap_585_equiv_grams), 0), 4),
    'currency_payments_usd_rate_min', (select min(c.rate_usd_uzs) from public.client_currency_settlements c where c.organization_id = v_org and c.settlement_date between p_from and p_to),
    'currency_payments_usd_rate_max', (select max(c.rate_usd_uzs) from public.client_currency_settlements c where c.organization_id = v_org and c.settlement_date between p_from and p_to)
  ) into v_rates
    from public.gold_settlements g
   where g.organization_id = v_org and g.direction = 'client_to_seller' and g.reversal_of_id is null
     and coalesce(g.status, '') not in ('reversed', 'cancelled') and g.settlement_date between p_from and p_to
     and (p_seller_id is null or g.seller_id = p_seller_id);

  return jsonb_build_object(
    'organization_id', v_org, 'from', p_from, 'to', p_to, 'today', v_today, 'timezone', 'Asia/Tashkent', 'seller_id', p_seller_id,
    'units', jsonb_build_object('g585', '585 ekvivalent gramm', 'physical_g', 'fizik gramm', 'uzs', 'so''m', 'usd', 'AQSh dollari'),
    'opening', jsonb_build_object(
      'customer_debt_net_g585', round(v_live.cust_g - v_after_from.cust_g, 4),
      'customer_debt_net_uzs', round(v_live.cur_uzs - v_after_from.cur_uzs, 2), 'customer_debt_net_usd', round(v_live.cur_usd - v_after_from.cur_usd, 2),
      'seller_stock_physical_g', round(v_live.stock_g - v_after_from.stock_g, 4),
      'seller_till_uzs', round(v_live.till_uzs - v_after_from.till_uzs, 2), 'seller_till_usd', round(v_live.till_usd - v_after_from.till_usd, 2),
      'seller_till_scrap_g585', round(v_live.till_scrap_g - v_after_from.till_scrap_g, 4),
      'manager_cash_uzs', round(v_live.mgr_uzs - v_after_from.mgr_uzs, 2), 'manager_cash_usd', round(v_live.mgr_usd - v_after_from.mgr_usd, 2),
      'factory_obligation_net_g585', round(v_live.factory_g - v_after_from.factory_g, 4)),
    'closing', jsonb_build_object(
      'customer_debt_net_g585', round(v_live.cust_g - v_after_to.cust_g, 4),
      'customer_debt_net_uzs', round(v_live.cur_uzs - v_after_to.cur_uzs, 2), 'customer_debt_net_usd', round(v_live.cur_usd - v_after_to.cur_usd, 2),
      'seller_stock_physical_g', round(v_live.stock_g - v_after_to.stock_g, 4),
      'seller_till_uzs', round(v_live.till_uzs - v_after_to.till_uzs, 2), 'seller_till_usd', round(v_live.till_usd - v_after_to.till_usd, 2),
      'seller_till_scrap_g585', round(v_live.till_scrap_g - v_after_to.till_scrap_g, 4),
      'manager_cash_uzs', round(v_live.mgr_uzs - v_after_to.mgr_uzs, 2), 'manager_cash_usd', round(v_live.mgr_usd - v_after_to.mgr_usd, 2),
      'factory_obligation_net_g585', round(v_live.factory_g - v_after_to.factory_g, 4)),
    -- part of the balances that no document explains (baseline / import before the first document); 0 on a fully documented ledger
    'undocumented_opening', jsonb_build_object(
      'first_document_date', v_first,
      'customer_debt_net_g585', round(v_live.cust_g - v_before_first.cust_g, 4),
      'customer_debt_net_uzs', round(v_live.cur_uzs - v_before_first.cur_uzs, 2), 'customer_debt_net_usd', round(v_live.cur_usd - v_before_first.cur_usd, 2),
      'seller_stock_physical_g', round(v_live.stock_g - v_before_first.stock_g, 4),
      'seller_till_uzs', round(v_live.till_uzs - v_before_first.till_uzs, 2), 'seller_till_usd', round(v_live.till_usd - v_before_first.till_usd, 2),
      'seller_till_scrap_g585', round(v_live.till_scrap_g - v_before_first.till_scrap_g, 4),
      'manager_cash_uzs', round(v_live.mgr_uzs - v_before_first.mgr_uzs, 2), 'manager_cash_usd', round(v_live.mgr_usd - v_before_first.mgr_usd, 2),
      'factory_obligation_net_g585', round(v_live.factory_g - v_before_first.factory_g, 4)),
    'live', jsonb_build_object(
      'manager_physical_stock_g', (select sum(manager_physical_stock_g) from public.manager_vault_account where organization_id = v_org),
      'manager_scrap_g585', (select sum(manager_scrap_grams) from public.manager_vault_account where organization_id = v_org),
      'seller_obligation_owes_g585', (select sum(seller_owes_manager_g) from public.seller_gold_accounts where organization_id = v_org),
      'manager_owes_sellers_g585', (select sum(manager_owes_seller_g) from public.seller_gold_accounts where organization_id = v_org)),
    'flows', v_flows,
    'rates', v_rates,
    'sellers', v_sellers,
    'profit_policy', 'Valyutali savdolar foydasi, kurs farqi va tosh qiymati hisob siyosati tasdiqlanmaguncha hisoblanmaydi (decision gate D-C3).'
  );
end;
$$;
revoke all on function public.rpc_get_period_report(date, date, uuid) from public, anon;
grant execute on function public.rpc_get_period_report(date, date, uuid) to authenticated, service_role;

create table if not exists public.goldia_report_periods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  period_start    date not null,
  period_end      date not null,
  report          jsonb not null,
  closed_by       uuid,
  closed_at       timestamptz not null default clock_timestamp(),
  notes           text,
  unique (organization_id, period_end),
  check (period_start <= period_end)
);
alter table public.goldia_report_periods enable row level security;
revoke all on public.goldia_report_periods from anon, authenticated;
grant select on public.goldia_report_periods to authenticated;
grant all on public.goldia_report_periods to service_role;
drop policy if exists goldia_report_periods_select on public.goldia_report_periods;
create policy goldia_report_periods_select on public.goldia_report_periods for select to authenticated
  using (organization_id = public.current_organization_id() and public._goldia_is_management_role(public.current_employee_role_text()));

-- "Yangi oyni boshlash": closes the open period [last end + 1 (or p_start) .. p_end] with a frozen copy of its report.
-- Nothing else is written: no balance, debt, stock, till or transaction changes.
create or replace function public.rpc_close_report_period(p_end date, p_start date default null, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   uuid := public.current_organization_id();
  v_last  date;
  v_start date;
  v_row   public.goldia_report_periods%rowtype;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if p_end is null or p_end > public._goldia_business_date() then
    raise exception 'Davr tugash sanasi bugundan keyin bo''lishi mumkin emas';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('goldia_report_period:' || v_org::text, 0));
  select * into v_row from public.goldia_report_periods where organization_id = v_org and period_end = p_end;
  if found then
    return jsonb_build_object('status', 'ok', 'already_closed', true, 'id', v_row.id, 'period_start', v_row.period_start, 'period_end', v_row.period_end);
  end if;
  select max(period_end) into v_last from public.goldia_report_periods where organization_id = v_org;
  if v_last is not null and p_end <= v_last then
    raise exception 'Bu sana oldingi yopilgan davr (%) ichida', v_last;
  end if;
  v_start := case when v_last is not null then v_last + 1 else coalesce(p_start, date_trunc('month', p_end)::date) end;
  if v_start > p_end then
    raise exception 'Davr boshlanishi tugashidan keyin';
  end if;
  insert into public.goldia_report_periods (organization_id, period_start, period_end, report, closed_by, notes)
  values (v_org, v_start, p_end, public.rpc_get_period_report(v_start, p_end, null), public.current_employee_id(), p_notes)
  returning * into v_row;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'goldia_report_periods', v_row.id::text, 'CLOSE_REPORT_PERIOD', auth.uid(), null,
    jsonb_build_object('period_start', v_start, 'period_end', p_end), p_notes);
  return jsonb_build_object('status', 'ok', 'already_closed', false, 'id', v_row.id, 'period_start', v_start, 'period_end', p_end,
    'next_period_start', p_end + 1);
end;
$$;
revoke all on function public.rpc_close_report_period(date, date, text) from public, anon;
grant execute on function public.rpc_close_report_period(date, date, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_reverse_financial_transaction(p_transaction_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id uuid := public.current_organization_id();
  v_tx     public.financial_transactions%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if v_reason is null then
    raise exception 'Tranzaksiyani bekor qilish sababi (reason) kiritilishi shart';
  end if;

  select * into v_tx
    from public.financial_transactions
   where id = p_transaction_id and organization_id = v_org_id
   for update;

  if not found then
    raise exception 'Bekor qilinadigan operatsiya topilmadi (%)', p_transaction_id;
  end if;

  if v_tx.status in ('reversed', 'cancelled') then
    raise exception 'Ushbu operatsiya allaqachon bekor qilingan';
  end if;

  -- Reverse asset update
  if v_tx.transaction_type in ('capital_in', 'capital_contribution') then
    if v_tx.source_till in ('manager_fine_gold', 'manager_capital_pure_gold') or v_tx.currency in ('FINE_GOLD', 'PURE_GOLD') then
      update public.manager_vault_account
         set manager_capital_pure_gold_g = round(greatest(0, manager_capital_pure_gold_g - v_tx.equiv_585_grams), 4),
             manager_capital_pure_gold_fine_g = round(greatest(0, manager_capital_pure_gold_fine_g - coalesce(v_tx.physical_weight_grams, v_tx.amount_num)), 4),
             updated_at = now()
       where organization_id = v_org_id;

    elsif v_tx.source_till in ('manager_scrap') then
      update public.manager_vault_account
         set manager_scrap_grams = round(greatest(0, manager_scrap_grams - v_tx.equiv_585_grams), 4),
             updated_at = now()
       where organization_id = v_org_id;

    elsif v_tx.source_till in ('seller_till_scrap') and v_tx.seller_id is not null then
      update public.seller_gold_accounts
         set seller_till_scrap_grams = round(greatest(0, seller_till_scrap_grams - v_tx.equiv_585_grams), 4),
             updated_at = now()
       where seller_id = v_tx.seller_id and organization_id = v_org_id;

    elsif v_tx.source_till in ('manager_uzs', 'manager_cash') then
      update public.manager_vault_account
         set manager_cash_amount = round(greatest(0, manager_cash_amount - v_tx.amount_num), 2),
             updated_at = now()
       where organization_id = v_org_id;

    elsif v_tx.source_till in ('seller_till_uzs') and v_tx.seller_id is not null then
      update public.seller_gold_accounts
         set seller_till_cash_amount = round(greatest(0, seller_till_cash_amount - v_tx.amount_num), 2),
             updated_at = now()
       where seller_id = v_tx.seller_id and organization_id = v_org_id;

    elsif v_tx.source_till in ('manager_usd') then
      update public.manager_vault_account
         set manager_usd_amount = round(greatest(0, manager_usd_amount - v_tx.amount_num), 2),
             updated_at = now()
       where organization_id = v_org_id;

    elsif v_tx.source_till in ('seller_till_usd') and v_tx.seller_id is not null then
      update public.seller_gold_accounts
         set seller_till_usd_amount = round(greatest(0, seller_till_usd_amount - v_tx.amount_num), 2),
             updated_at = now()
       where seller_id = v_tx.seller_id and organization_id = v_org_id;
    end if;

  elsif v_tx.transaction_type in ('capital_out', 'capital_distribution', 'expense', 'business_expense') then
    if v_tx.source_till in ('manager_uzs', 'manager_cash') then
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount + v_tx.amount_num, 2),
             updated_at = now()
       where organization_id = v_org_id;
    elsif v_tx.source_till in ('manager_usd') then
      update public.manager_vault_account
         set manager_usd_amount = round(manager_usd_amount + v_tx.amount_num, 2),
             updated_at = now()
       where organization_id = v_org_id;
    end if;
  end if;

  update public.financial_transactions
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = public.current_employee_id(),  -- 077: FK to employees(id); auth.uid() failed when employee id <> login id
         reversal_reason = v_reason,
         updated_at = now()
   where id = v_tx.id;

  return jsonb_build_object(
    'status', 'ok',
    'transaction_id', v_tx.id,
    'message', 'Operatsiya bekor qilindi'
  );
end;
$function$;
