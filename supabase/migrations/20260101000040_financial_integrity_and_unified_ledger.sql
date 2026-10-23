-- =========================================================================
-- Migration 040: Financial Integrity, Unified Customer Ledger & Proba Safety
-- =========================================================================
-- Addresses P0/P1 gaps:
-- 1. Unified Customer Ledger RPC (single source of truth for all screens)
-- 2. Proba-aware scrap gold conversions (physical g * purity / 585.0)
-- 3. Unknown proba rejection guard (cannot default arbitrarily to 585)
-- 4. Reversal exclusion (status <> 'reversed') in three-tier ledger & monthly reports
-- 5. Sale reversal parity (restores settled_gold_grams and advance balance)
-- 6. RLS security hardening on sales_login_audit_logs and sheets_import_batches
-- 7. Manager role authorization for refining operations
-- 8. Explicit factory vs seller markup parameters on barcode consignments
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. SCHEMA ENHANCEMENTS
-- -------------------------------------------------------------------------

-- 1.a Enhance gold_settlements with distinct physical & fine gold tracking
alter table public.gold_settlements
  add column if not exists physical_scrap_grams numeric(14, 4),
  add column if not exists fine_gold_grams numeric(14, 4),
  add column if not exists scrap_585_equiv_grams numeric(14, 4);

-- 1.b Enhance manager_vault_account with fine gold tracking
alter table public.manager_vault_account
  add column if not exists manager_refined_gold_fine_grams numeric(14, 4) not null default 0;

-- 1.c Ensure seller_consignments has return tracking columns
alter table public.seller_consignments
  add column if not exists returned_to_factory_quantity integer default 0,
  add column if not exists returned_to_factory_gold_grams numeric(14, 4) default 0;

-- 1.c Update RLS policy on client_gold_accounts to grant Manager/Production Manager access
drop policy if exists "client_gold_accounts_select_policy" on public.client_gold_accounts;

create policy "client_gold_accounts_select_policy" on public.client_gold_accounts
  for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() = any (array[
        'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
        'manager', 'production_manager', 'boshqaruvchi', 'inventory_manager'
      ])
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- 1.d Enable and harden RLS on sales_login_audit_logs
alter table public.sales_login_audit_logs enable row level security;

drop policy if exists "sales_login_audit_logs_org_policy" on public.sales_login_audit_logs;
create policy "sales_login_audit_logs_org_policy" on public.sales_login_audit_logs
  for all to authenticated
  using (
    organization_id = public.current_organization_id()
  )
  with check (
    organization_id = public.current_organization_id()
  );

-- 1.e Enable and harden RLS on sheets_import_batches
alter table public.sheets_import_batches enable row level security;

drop policy if exists "sheets_import_batches_org_policy" on public.sheets_import_batches;
create policy "sheets_import_batches_org_policy" on public.sheets_import_batches
  for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() = any (array[
      'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
      'manager', 'production_manager', 'boshqaruvchi'
    ])
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() = any (array[
      'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
      'manager', 'production_manager', 'boshqaruvchi'
    ])
  );

-- -------------------------------------------------------------------------
-- 2. PROBA-AWARE CLIENT SETTLEMENT RPC
-- -------------------------------------------------------------------------

-- Drop legacy conflicting overloads
drop function if exists public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text);
drop function if exists public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text, text);
drop function if exists public.rpc_record_client_settlement(uuid, numeric, numeric, numeric, numeric, uuid, text, text);
drop function if exists public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text, uuid);

create or replace function public.rpc_record_client_settlement(
  p_customer_id       uuid,
  p_sale_id           uuid default null,
  p_scrap_weight      numeric default 0,
  p_scrap_proba       numeric default null,
  p_cash_amount       numeric default 0,
  p_rate_per_gram     numeric default null,
  p_settlement_date   date default current_date,
  p_notes             text default null,
  p_idempotency_key   text default null,
  p_seller_id         uuid default null
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
  v_physical_scrap    numeric(14, 4);
  v_proba             numeric(6, 2);
  v_fine_gold         numeric(14, 4) := 0;
  v_scrap_585_eq      numeric(14, 4) := 0;
  v_cash              numeric(18, 2);
  v_cash_equiv        numeric(14, 4) := 0;
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

  if v_physical_scrap <= 0 and v_cash <= 0 then
    raise exception 'To''lov uchun lom vazni yoki naqd pul summasi kiritilishi shart';
  end if;

  -- P0: Strict proba validation — unknown proba MUST NOT default arbitrarily to 585
  if v_physical_scrap > 0 then
    if p_scrap_proba is null or p_scrap_proba <= 0 then
      raise exception 'Lom oltin probasi aniq ko''rsatilishi shart (masalan: 375, 585, 750, 995, 999.9)';
    end if;
    v_proba := round(p_scrap_proba::numeric, 2);
    if v_proba < 300.0 or v_proba > 1000.0 then
      raise exception 'Noto''g''ri proba kiritildi: % (ruxsat: 300 - 1000)', v_proba;
    end if;

    -- Strict mathematical purity conversion
    v_fine_gold := round((v_physical_scrap * (v_proba / 1000.0))::numeric, 4);
    v_scrap_585_eq := round((v_physical_scrap * (v_proba / 585.0))::numeric, 4);
  else
    v_proba := 585.0;
    v_fine_gold := 0;
    v_scrap_585_eq := 0;
  end if;

  -- Determine gold rate
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_caller_org
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      v_rate := 900000;
    end if;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  end if;

  -- Total settled is strictly in 585 gold equivalent
  v_total_settled := round(v_scrap_585_eq + v_cash_equiv, 4);

  -- Verify customer
  select * into v_customer
  from public.customers
  where id = p_customer_id and organization_id = v_caller_org
  limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;

  -- Determine seller
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
    raise exception 'Sotuvchi aniqlanmadi: mijozga yoki joriy foydalanuvchiga biriktirilgan sotuvchi topilmadi';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_client_settlement',
    'customer_id', p_customer_id,
    'seller_id', v_seller.id,
    'physical_scrap_g', v_physical_scrap,
    'scrap_proba', v_proba,
    'scrap_585_equiv_g', v_scrap_585_eq,
    'cash_amount', v_cash,
    'rate_applied', v_rate,
    'total_settled_585_g', v_total_settled
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Lock client gold account
  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = p_customer_id and organization_id = v_caller_org
  for update;

  if found then
    v_prev_debt := coalesce(v_client_acc.current_debt_grams, 0);
  else
    v_prev_debt := 0;
  end if;

  -- Debt settlement math
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
    cash_paid_amount, currency, cash_equivalent_grams, total_settled_grams,
    applied_to_debt_grams, excess_gold_grams,
    previous_debt_grams, remaining_debt_grams,
    status, notes, recorded_by, idempotency_key
  ) values (
    v_caller_org, v_settle_no, 'client_to_seller', v_seller.id, v_customer.id, p_sale_id,
    coalesce(p_settlement_date, current_date), v_rate,
    v_scrap_585_eq, v_physical_scrap, v_proba, v_fine_gold, v_scrap_585_eq,
    v_cash, 'UZS', v_cash_equiv, v_total_settled,
    v_applied_to_debt, v_excess_advance,
    v_prev_debt, v_rem_debt,
    'confirmed', p_notes, coalesce(public.current_employee_id(), v_seller.id), nullif(btrim(p_idempotency_key), '')
  ) returning id into v_settle_id;

  -- Update client_gold_accounts atomically
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, 0,
    v_scrap_585_eq, v_cash, v_cash_equiv, v_total_settled,
    v_rem_debt, v_new_advance, now()
  )
  on conflict (customer_id) do update set
    total_scrap_paid_grams = round((client_gold_accounts.total_scrap_paid_grams + v_scrap_585_eq)::numeric, 4),
    total_cash_paid_amount = round((client_gold_accounts.total_cash_paid_amount + v_cash)::numeric, 2),
    total_cash_equiv_grams = round((client_gold_accounts.total_cash_equiv_grams + v_cash_equiv)::numeric, 4),
    total_settled_grams    = round((client_gold_accounts.total_settled_grams + v_total_settled)::numeric, 4),
    current_debt_grams     = v_rem_debt,
    advance_balance_grams  = v_new_advance,
    updated_at             = now();

  -- Update seller till with received scrap (in 585 eq) and cash
  insert into public.seller_gold_accounts (
    seller_id, organization_id, seller_till_scrap_grams, seller_till_cash_amount, updated_at
  ) values (
    v_seller.id, v_caller_org, v_scrap_585_eq, v_cash, now()
  )
  on conflict (seller_id) do update set
    seller_till_scrap_grams = round((seller_gold_accounts.seller_till_scrap_grams + v_scrap_585_eq)::numeric, 4),
    seller_till_cash_amount = round((seller_gold_accounts.seller_till_cash_amount + v_cash)::numeric, 2),
    updated_at              = now();

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
    'rate_applied', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'total_settled_585_grams', v_total_settled,
    'total_settled_grams', v_total_settled,
    'previous_debt_grams', v_prev_debt,
    'applied_to_debt_grams', v_applied_to_debt,
    'excess_gold_advance_grams', v_excess_advance,
    'excess_gold_grams', v_excess_advance,
    'remaining_debt_grams', v_rem_debt,
    'current_advance_balance_grams', v_new_advance
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_settlement', v_existing, v_payload);
  return v_existing;
end;
$$;

-- -------------------------------------------------------------------------
-- 3. UNIFIED CUSTOMER LEDGER RPC (SINGLE SOURCE OF TRUTH)
-- -------------------------------------------------------------------------

create or replace function public.rpc_get_unified_customer_ledger(
  p_seller_id   uuid default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_org  uuid := public.current_organization_id();
  v_rows        jsonb := '[]'::jsonb;
  v_cust_rec    record;
  v_gross_debt  numeric(14, 4);
  v_paid_scrap  numeric(14, 4);
  v_paid_cash   numeric(14, 4);
  v_total_paid  numeric(14, 4);
  v_applied_adv numeric(14, 4);
  v_avail_adv   numeric(14, 4);
  v_net_debt    numeric(14, 4);
  v_tot_gross   numeric(14, 4) := 0;
  v_tot_paid    numeric(14, 4) := 0;
  v_tot_net     numeric(14, 4) := 0;
  v_tot_adv     numeric(14, 4) := 0;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  for v_cust_rec in
    select c.id, c.customer_code, c.contact_name, c.phone, c.company_name, c.seller_id,
           coalesce(e.full_name, e.name, 'Biriktirilmagan') as seller_name
    from public.customers c
    left join public.employees e on e.id = c.seller_id
    where c.organization_id = v_caller_org
      and (p_customer_id is null or c.id = p_customer_id)
      and (p_seller_id is null or c.seller_id = p_seller_id)
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

    -- 3. Total Unreversed Cash Equivalent Paid
    select coalesce(sum(cash_equivalent_grams), 0)
    into v_paid_cash
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and direction = 'client_to_seller'
      and status <> 'reversed';

    v_total_paid := round(v_paid_scrap + v_paid_cash, 4);

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
      'paid_cash_equivalent_g', v_paid_cash,
      'total_paid_g', v_total_paid,
      'applied_advance_g', v_applied_adv,
      'available_advance_g', v_avail_adv,
      'net_debt_g', v_net_debt
    );

    v_tot_gross := v_tot_gross + v_gross_debt;
    v_tot_paid  := v_tot_paid + v_total_paid;
    v_tot_net   := v_tot_net + v_net_debt;
    v_tot_adv   := v_tot_adv + v_avail_adv;

    -- Ensure client_gold_accounts cache stays 100% synchronized
    insert into public.client_gold_accounts (
      customer_id, organization_id, seller_id, total_purchased_gold_grams,
      total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
      current_debt_grams, advance_balance_grams, updated_at
    ) values (
      v_cust_rec.id, v_caller_org, v_cust_rec.seller_id, v_gross_debt,
      v_paid_scrap, 0, v_paid_cash, v_total_paid,
      v_net_debt, v_avail_adv, now()
    )
    on conflict (customer_id) do update set
      total_purchased_gold_grams = v_gross_debt,
      total_scrap_paid_grams     = v_paid_scrap,
      total_cash_equiv_grams     = v_paid_cash,
      total_settled_grams        = v_total_paid,
      current_debt_grams         = v_net_debt,
      advance_balance_grams      = v_avail_adv,
      updated_at                 = now();
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'items', v_rows,
    'summary', jsonb_build_object(
      'total_customers', jsonb_array_length(v_rows),
      'total_gross_debt_g', v_tot_gross,
      'total_paid_g', v_tot_paid,
      'total_net_debt_g', v_tot_net,
      'total_available_advance_g', v_tot_adv
    )
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 4. REVERSAL FILTERS IN THREE-TIER LEDGER & MONTHLY REPORT
-- -------------------------------------------------------------------------

create or replace function public.rpc_get_three_tier_ledger_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- -------------------------------------------------------------------------
-- 5. REVERSAL OF CLIENT SETTLEMENT (SALE PARITY RESTORATION)
-- -------------------------------------------------------------------------

create or replace function public.rpc_reverse_client_settlement(
  p_settlement_id    uuid,
  p_reason           text default 'Audited Compensating Reversal',
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_org       uuid := public.current_organization_id();
  v_caller_emp_id    uuid := public.current_employee_id();
  v_settle           public.gold_settlements%rowtype;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_client_acc       public.client_gold_accounts%rowtype;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

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

  -- Verify seller till has sufficient scrap and cash to reverse
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id
     and organization_id = v_caller_org
   for update;

  if v_seller_acc.seller_till_scrap_grams < v_settle.scrap_weight_grams then
    raise exception 'To''lovni bekor qilib bo''lmaydi: Sotuvchi kassasidagi lom yetarli emas (Mavjud: % g, Talab: % g). Avval boshqaruvchiga topshirilgan lomni qaytaring.',
      v_seller_acc.seller_till_scrap_grams, v_settle.scrap_weight_grams;
  end if;

  if v_seller_acc.seller_till_cash_amount < v_settle.cash_paid_amount then
    raise exception 'To''lovni bekor qilib bo''lmaydi: Sotuvchi kassasidagi naqd pul yetarli emas (Mavjud: % UZS, Talab: % UZS).',
      v_seller_acc.seller_till_cash_amount, v_settle.cash_paid_amount;
  end if;

  -- Deduct from seller till
  update public.seller_gold_accounts
     set seller_till_scrap_grams = round(greatest(0, seller_till_scrap_grams - v_settle.scrap_weight_grams)::numeric, 4),
         seller_till_cash_amount = round(greatest(0, seller_till_cash_amount - v_settle.cash_paid_amount)::numeric, 2),
         updated_at = now()
   where seller_id = v_settle.seller_id;

  -- Restore customer debt and reverse excess advance
  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_settle.customer_id
     and organization_id = v_caller_org
   for update;

  update public.client_gold_accounts
     set current_debt_grams    = round((current_debt_grams + v_settle.applied_to_debt_grams)::numeric, 4),
         advance_balance_grams = round(greatest(0, advance_balance_grams - v_settle.excess_gold_grams)::numeric, 4),
         total_settled_grams   = round(greatest(0, total_settled_grams - v_settle.total_settled_grams)::numeric, 4),
         total_scrap_paid_grams= round(greatest(0, total_scrap_paid_grams - v_settle.scrap_weight_grams)::numeric, 4),
         total_cash_paid_amount= round(greatest(0, total_cash_paid_amount - v_settle.cash_paid_amount)::numeric, 2),
         total_cash_equiv_grams= round(greatest(0, total_cash_equiv_grams - v_settle.cash_equivalent_grams)::numeric, 4),
         updated_at            = now()
   where customer_id = v_settle.customer_id;

  -- P0: If linked to a sale, restore the sale's settled and remaining gold balance!
  if v_settle.sale_id is not null then
    update public.jewelry_sales
       set settled_gold_grams = round(greatest(0, settled_gold_grams - v_settle.applied_to_debt_grams)::numeric, 4),
           remaining_gold_grams = round((remaining_gold_grams + v_settle.applied_to_debt_grams)::numeric, 4),
           status = 'open_debt',
           updated_at = now()
     where id = v_settle.sale_id and organization_id = v_caller_org;
  end if;

  -- Mark settlement as reversed
  update public.gold_settlements
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = p_reason
   where id = v_settle.id;

  -- Audit log
  insert into public.audit_logs (
    table_name, record_id, action, actor_id, actor_name, actor_role,
    old_data, new_data, reason, organization_id
  ) values (
    'gold_settlements', v_settle.id::text, 'REVERSAL',
    v_caller_emp_id, public.current_employee_name(), public.current_employee_role_text(),
    to_jsonb(v_settle),
    jsonb_build_object('status', 'reversed', 'reversed_at', now(), 'reversal_reason', p_reason),
    p_reason, v_caller_org
  );

  return jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle.id,
    'settlement_no', v_settle.settlement_no,
    'reversed_total_grams', v_settle.total_settled_grams,
    'restored_customer_debt_g', v_settle.applied_to_debt_grams,
    'deducted_customer_advance_g', v_settle.excess_gold_grams
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 6. REFINING PERMISSIONS HARDENING (GRANT MANAGER ROLE)
-- -------------------------------------------------------------------------

create or replace function public.rpc_record_refining_batch(
  p_input_scrap_grams       numeric,
  p_melted_weight_grams     numeric,
  p_output_fine_grams       numeric,
  p_output_fine_proba       numeric default 995.0,
  p_operator_id             uuid default null,
  p_notes                   text default null,
  p_idempotency_key         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id         uuid := public.current_organization_id();
  v_caller_id      uuid := auth.uid();
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

  -- P1-6: Grant manager, production_manager, boshqaruvchi permission alongside director/admin!
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'inventory_manager'
  ]);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'batch_id', id,
      'batch_no', batch_no,
      'total_loss_grams', total_loss_grams
    ) into v_existing
    from public.refining_batches
    where idempotency_key = p_idempotency_key;

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

  -- 585 equivalent = output_fine_grams * (output_fine_proba / 585.0)
  v_out_585_eq := round(v_out_fine_g * (v_out_proba / 585.0), 4);
  -- Total loss in 585 scrap equivalent = input_scrap - output_585_equiv
  v_loss_g := round(greatest(0, v_in_w - v_out_585_eq), 4);
  v_loss_pct := round(((v_loss_g / v_in_w) * 100.0), 3);

  -- Check manager scrap balance
  perform public._get_or_create_manager_vault(v_org_id);

  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  if v_vault.manager_scrap_grams < v_in_w then
    raise exception 'Yetarli lom oltin yo''q: mavjud % g, talab qilindi % g',
      v_vault.manager_scrap_grams, v_in_w;
  end if;

  -- Deduct scrap, add refined fine gold and 585 equivalent. Loss is borne exclusively by manager!
  update public.manager_vault_account
  set manager_scrap_grams = round(manager_scrap_grams - v_in_w, 4),
      manager_refined_gold_grams = round(manager_refined_gold_grams + v_out_585_eq, 4),
      manager_refined_gold_fine_grams = round(manager_refined_gold_fine_grams + v_out_fine_g, 4),
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
    v_loss_g, v_loss_pct, coalesce(p_operator_id, v_caller_id), 'completed', p_notes, p_idempotency_key
  ) returning id into v_batch_id;

  return jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch_id,
    'batch_no', v_batch_no,
    'input_scrap_grams', v_in_w,
    'melted_weight_grams', v_melt_w,
    'output_fine_grams', v_out_fine_g,
    'output_fine_proba', v_out_proba,
    'output_585_equiv_grams', v_out_585_eq,
    'total_loss_grams', v_loss_g,
    'loss_pct', v_loss_pct,
    'manager_remaining_scrap_grams', v_vault.manager_scrap_grams,
    'manager_refined_gold_585_equiv_grams', v_vault.manager_refined_gold_grams,
    'manager_refined_gold_fine_grams', v_vault.manager_refined_gold_fine_grams
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 7. CONSIGNMENT MARKUP PARAMETERIZATION (P0-2)
-- -------------------------------------------------------------------------

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

  -- P0-2: Distinct seller markup parameter from base
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

  -- Verify seller
  select * into v_seller
    from public.employees
   where id = p_seller_id
     and organization_id = v_caller_org
   limit 1;
  if not found then
    raise exception 'Sotuvchi (xodim %) topilmadi', p_seller_id;
  end if;

  -- Validate every piece and calculate total base weight
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
  -- 1. Factory due = base_weight * (1 + factory_markup / 100)
  v_factory_due := round((v_total_base_weight * (1.0 + v_factory_pct / 100.0))::numeric, 4);
  -- 2. Seller obligation = base_weight * (1 + seller_markup / 100)
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
    -- Auto-link FIFO to available factory receipt
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
    end if;
  end if;

  v_consignment_no := 'CONS-BC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- Insert parent consignment record with both factory and seller markups
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

  -- Insert each individual piece with unique ID
  for v_piece_elem in select * from jsonb_array_elements(p_pieces) loop
    v_piece_id := gen_random_uuid();
    v_model_id := null;
    if (v_piece_elem->>'model_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_model_id := (v_piece_elem->>'model_id')::uuid;
    end if;
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
    'seller_name', coalesce(v_seller.full_name, v_seller.name),
    'quantity', v_total_qty,
    'base_weight_grams', v_total_base_weight,
    'factory_markup_pct', v_factory_pct,
    'factory_gold_due_grams', v_factory_due,
    'seller_markup_pct', v_seller_pct,
    'seller_obligation_g', v_seller_due,
    'factory_receipt_id', v_receipt_id,
    'pieces', v_inserted_pieces
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_issue_barcode_consignment', v_existing, v_payload);
  return v_existing;
end;
$$;

-- -------------------------------------------------------------------------
-- 7.b ENHANCED rpc_return_piece_to_manager (FULL RECONCILIATION PAYLOAD)
-- -------------------------------------------------------------------------

create or replace function public.rpc_return_piece_to_manager(
  p_piece_id         uuid,
  p_notes            text default null,
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_piece         public.consignment_pieces%rowtype;
  v_seller        public.employees%rowtype;
  v_consign       public.seller_consignments%rowtype;
  v_seller_markup numeric(6, 2);
  v_deduct_obl    numeric(14, 4);
  v_existing      jsonb;
  v_payload       jsonb;
  v_seller_acc    public.seller_gold_accounts%rowtype;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'action', 'return_piece_to_manager',
    'piece_id', p_piece_id
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_return_piece_to_manager', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. Lock and fetch piece
  select * into v_piece
    from public.consignment_pieces
   where id = p_piece_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Qaytariladigan mahsulot donasi topilmadi (%)', p_piece_id;
  end if;

  if v_piece.status <> 'held_by_seller' then
    raise exception 'Faqat sotuvchi qo''lidagi (sotilmagan) mahsulotni boshqaruvchiga qaytarish mumkin. Hozirgi holat: %', v_piece.status;
  end if;

  -- 2. Seller authorization check
  select * into v_seller
    from public.employees
   where id = v_piece.seller_id
     and organization_id = v_caller_org
   limit 1;

  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'warehouse', 'omborchi', 'inventory_manager', 'manager', 'production_manager', 'boshqaruvchi') then
    if v_seller.user_id is not null and v_seller.user_id <> auth.uid() then
      raise exception 'Ruxsat etilmadi: Faqat o''zingizga biriktirilgan mahsulotni qaytara olasiz' using errcode = '42501';
    end if;
  end if;

  -- 3. Lock parent consignment to get seller markup snapshot
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;

  v_seller_markup := coalesce(v_consign.seller_markup_pct, 12.00);
  v_deduct_obl := round((v_piece.weight_grams * (1.0 + v_seller_markup / 100.0))::numeric, 4);

  -- 4. Update piece status to returned_to_manager
  update public.consignment_pieces
     set status                 = 'returned_to_manager',
         returned_to_manager_at = now(),
         notes                  = coalesce(notes, '') || case when notes is not null then ' | ' else '' end ||
                                  'BOSHQARUVCHIGA QAYTARILDI: ' || coalesce(p_notes, 'Sotilmagan tovar qaytarildi') || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')',
         updated_at             = now()
   where id = v_piece.id;

  -- 5. Update parent consignment: adjust active weight and obligation
  update public.seller_consignments
     set returned_quantity           = coalesce(returned_quantity, 0) + 1,
         returned_to_factory_quantity= coalesce(returned_to_factory_quantity, 0) + 1,
         returned_weight_grams       = round((coalesce(returned_weight_grams, 0) + v_piece.weight_grams)::numeric, 4),
         returned_to_factory_gold_grams = round((coalesce(returned_to_factory_gold_grams, 0) + v_piece.weight_grams)::numeric, 4),
         returned_seller_obligation_g= round((coalesce(returned_seller_obligation_g, 0) + v_deduct_obl)::numeric, 4),
         base_weight_grams           = round(greatest(0, base_weight_grams - v_piece.weight_grams)::numeric, 4),
         seller_obligation_g         = round(greatest(0, seller_obligation_g - v_deduct_obl)::numeric, 4),
         quantity                    = greatest(0, quantity - 1),
         status                      = case
                                         when quantity - 1 <= 0 and sold_quantity = 0 then 'returned_to_manager'
                                         when quantity - 1 <= 0 and sold_quantity > 0 then 'fully_sold'
                                         else status
                                       end,
         updated_at                  = now()
   where id = v_consign.id;

  -- 6. Restore manager physical stock if linked to a factory receipt
  if v_consign.factory_receipt_id is not null then
    update public.factory_receipts
       set available_physical_g = round((available_physical_g + v_piece.weight_grams)::numeric, 4),
           status = case
                      when round((available_physical_g + v_piece.weight_grams)::numeric, 4) >= original_physical_g then 'in_manager_stock'
                      else 'partially_transferred'
                    end,
           updated_at = now()
     where id = v_consign.factory_receipt_id;
  end if;

  -- 7. Read updated seller gold account
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_piece.seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code,
    'weight_grams', v_piece.weight_grams,
    'seller_markup_pct', v_seller_markup,
    'seller_obligation_deducted_g', v_deduct_obl,
    'seller_owes_manager_g', coalesce(v_seller_acc.seller_owes_manager_g, 0),
    'bozor_qarzi_signed_g', coalesce(v_seller_acc.bozor_qarzi_signed_g, 0),
    'new_status', 'returned_to_manager'
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_return_piece_to_manager', v_existing, v_payload);
  return v_existing;
end;
$$;

-- -------------------------------------------------------------------------
-- 8. PERMISSIONS / GRANTS
-- -------------------------------------------------------------------------
grant execute on function public.rpc_record_client_settlement to authenticated;
grant execute on function public.rpc_get_unified_customer_ledger to authenticated;
grant execute on function public.rpc_get_three_tier_ledger_summary to authenticated;
grant execute on function public.rpc_reverse_client_settlement to authenticated;
grant execute on function public.rpc_record_refining_batch to authenticated;
grant execute on function public.rpc_issue_barcode_consignment to authenticated;
grant execute on function public.rpc_return_piece_to_manager to authenticated;

-- -------------------------------------------------------------------------
-- 9. FACTORY GOLD HANDOVER HARDENING (COLUMNS & PERMISSIONS PARITY)
-- -------------------------------------------------------------------------

drop function if exists public.rpc_record_factory_gold_handover(numeric, numeric, numeric, date, text, text);
drop function if exists public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text);

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
  v_caller_id      uuid := auth.uid();
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
        manager_refined_gold_fine_grams = round(greatest(0, manager_refined_gold_fine_grams - v_phys_w), 4)
    where organization_id = v_org_id;

  elsif v_src_type = 'purchased_gold' then
    update public.manager_vault_account
    set manager_purchased_gold_grams = round(greatest(0, manager_purchased_gold_grams - v_agreed_eq), 4)
    where organization_id = v_org_id;

  elsif v_src_type = 'scrap_gold' then
    update public.manager_vault_account
    set manager_scrap_grams = round(greatest(0, manager_scrap_grams - v_phys_w), 4)
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
    v_caller_id
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

-- -------------------------------------------------------------------------
-- 9. ATOMIC PIECE SALE WITH PARENT CONSIGNMENT LOCK & DOUBLE-SALE GUARD (P0-2)
-- -------------------------------------------------------------------------

create or replace function public.rpc_record_barcode_piece_sale(
  p_customer_id        uuid,
  p_seller_id          uuid,
  p_piece_id           uuid default null,
  p_model_id           uuid default null,
  p_weight_grams       numeric default null,
  p_client_markup_pct  numeric default 0,
  p_notes              text default null,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_customer          public.customers%rowtype;
  v_piece             public.consignment_pieces%rowtype;
  v_consign           public.seller_consignments%rowtype;
  v_client_acc        public.client_gold_accounts%rowtype;
  v_client_pct        numeric(6, 2) := round(coalesce(p_client_markup_pct, 0)::numeric, 2);
  v_base_w            numeric(14, 4);
  v_factory_due       numeric(14, 4);
  v_client_due        numeric(14, 4);
  v_spread            numeric(14, 4);
  v_avail_adv         numeric(14, 4) := 0;
  v_apply_adv         numeric(14, 4) := 0;
  v_net_rem_due       numeric(14, 4);
  v_sale_id           uuid;
  v_sale_no           text;
  v_payload           jsonb;
  v_existing          jsonb;
  v_remaining_pieces  integer;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_client_pct < 0 then
    raise exception 'Mijoz ustama foizi manfiy bo''lishi mumkin emas';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_barcode_piece_sale',
    'customer_id', p_customer_id,
    'seller_id', p_seller_id,
    'piece_id', p_piece_id,
    'model_id', p_model_id,
    'weight_grams', p_weight_grams,
    'client_markup_pct', v_client_pct
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_barcode_piece_sale', v_payload);
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
    raise exception 'Sotuvchi (xodim %) topilmadi', p_seller_id;
  end if;

  -- Ensure seller can only sell their own pieces unless privileged
  if public.current_employee_role_text() not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi') then
    if v_seller.user_id is not null and v_seller.user_id <> auth.uid() then
      raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''z omboridagi mahsulotlarni sotishi mumkin' using errcode = '42501';
    end if;
  end if;

  -- Verify customer
  select * into v_customer
    from public.customers
   where id = p_customer_id
     and organization_id = v_caller_org
   limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
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
    select * into v_piece
      from public.consignment_pieces
     where model_id = p_model_id
       and weight_grams = round(p_weight_grams::numeric, 4)
       and seller_id = v_seller.id
       and status = 'held_by_seller'
       and organization_id = v_caller_org
     order by created_at asc
     limit 1
     for update;
  else
    raise exception 'Mahsulot donasini aniqlash uchun piece_id yoki (model_id + weight_grams) talab qilinadi';
  end if;

  if not found then
    raise exception 'Tanlangan mahsulot donasi sotuvchi omborida topilmadi';
  end if;

  -- Piece-level double sale guard
  if v_piece.status = 'sold' then
    raise exception 'Bu mahsulot donasi (% — % g) allaqachon sotilgan (Sotuv ID: %)',
      v_piece.model_code, v_piece.weight_grams, coalesce(v_piece.sale_id::text, 'MAVJUD');
  end if;

  if v_piece.status <> 'held_by_seller' then
    raise exception 'Mahsulot sotuvga yaroqsiz holatda (Joriy holat: %)', v_piece.status;
  end if;

  -- P0-2: Fetch parent consignment with FOR UPDATE lock & enforce mutual exclusion!
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;
  if not found then
    raise exception 'Konsignatsiya yozuvi topilmadi';
  end if;

  if v_consign.status in ('fully_sold', 'returned_to_manager', 'cancelled') or coalesce(v_consign.sold_quantity, 0) >= coalesce(v_consign.quantity, 0) then
    raise exception 'Ushbu partiya (%) allaqachon to''liq sotilgan yoki bekor qilingan (Sotilgan: %/%)',
      v_consign.consignment_no, coalesce(v_consign.sold_quantity, 0), v_consign.quantity;
  end if;

  v_base_w      := v_piece.weight_grams;
  v_factory_due := round((v_base_w * (1.0 + v_consign.factory_markup_pct / 100.0))::numeric, 4);
  v_client_due  := round((v_base_w * (1.0 + v_client_pct / 100.0))::numeric, 4);
  v_spread      := round((v_client_due - v_factory_due)::numeric, 4);

  -- Check customer advance
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

  -- Insert sale record (strictly 'fully_paid' or 'open_debt')
  insert into public.jewelry_sales (
    organization_id, sale_no, seller_id, customer_id, consignment_id,
    product_name, quantity, base_weight_grams, proba,
    factory_markup_pct, factory_gold_due_grams,
    client_markup_pct, client_gold_due_grams,
    markup_spread_grams, settled_gold_grams, remaining_gold_grams,
    status, sale_date, idempotency_key, notes
  ) values (
    v_caller_org, v_sale_no, v_seller.id, v_customer.id, v_consign.id,
    v_piece.model_name || ' (' || v_piece.weight_grams || 'g)',
    1, v_base_w, v_piece.purity,
    v_consign.factory_markup_pct, v_factory_due,
    v_client_pct, v_client_due,
    v_spread, v_apply_adv, v_net_rem_due,
    case when v_net_rem_due <= 0.0001 then 'fully_paid' else 'open_debt' end,
    current_date, nullif(btrim(p_idempotency_key), ''), p_notes
  ) returning id into v_sale_id;

  -- Mark piece as sold
  update public.consignment_pieces
     set status = 'sold',
         sale_id = v_sale_id,
         sold_at = now(),
         updated_at = now()
   where id = v_piece.id;

  -- Update parent consignment sold_quantity and status
  select count(*) into v_remaining_pieces
    from public.consignment_pieces
   where consignment_id = v_consign.id
     and status = 'held_by_seller';

  if v_remaining_pieces = 0 or (coalesce(v_consign.sold_quantity, 0) + 1) >= v_consign.quantity then
    update public.seller_consignments
       set status = 'fully_sold',
           sold_quantity = quantity,
           updated_at = now()
     where id = v_consign.id;
  else
    update public.seller_consignments
       set status = 'partially_sold',
           sold_quantity = coalesce(sold_quantity, 0) + 1,
           updated_at = now()
     where id = v_consign.id;
  end if;

  -- Update client running debt in client_gold_accounts
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    current_debt_grams, advance_balance_grams, total_settled_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, v_client_due,
    v_net_rem_due, greatest(0, v_avail_adv - v_apply_adv), v_apply_adv, now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_due)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_net_rem_due)::numeric, 4),
    advance_balance_grams      = round(greatest(0, client_gold_accounts.advance_balance_grams - v_apply_adv)::numeric, 4),
    total_settled_grams        = round((client_gold_accounts.total_settled_grams + v_apply_adv)::numeric, 4),
    updated_at                 = now();

  -- Update seller's total client debt tracking
  insert into public.seller_gold_accounts (
    seller_id, organization_id, total_client_debt_grams, updated_at
  ) values (
    v_seller.id, v_caller_org, v_net_rem_due, now()
  )
  on conflict (seller_id) do update set
    total_client_debt_grams = round((seller_gold_accounts.total_client_debt_grams + v_net_rem_due)::numeric, 4),
    updated_at              = now();

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code,
    'model_name', v_piece.model_name,
    'weight_grams', v_base_w,
    'client_markup_pct', v_client_pct,
    'gross_gold_due_grams', v_client_due,
    'client_gold_due_grams', v_client_due,
    'advance_applied_grams', v_apply_adv,
    'net_remaining_debt_grams', v_net_rem_due,
    'remaining_gold_grams', v_net_rem_due,
    'markup_spread_grams', v_spread
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_barcode_piece_sale', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_record_barcode_piece_sale to authenticated;

-- -------------------------------------------------------------------------
-- 10. ATOMIC BATCH SALE WITH PIECE SYNCHRONIZATION & DOUBLE-SALE GUARD (P0-2)
-- -------------------------------------------------------------------------

create or replace function public.rpc_record_client_jewelry_sale(
  p_customer_id       uuid,
  p_consignment_id    uuid,
  p_client_markup_pct numeric default 0,
  p_notes             text default null,
  p_idempotency_key   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

grant execute on function public.rpc_record_client_jewelry_sale to authenticated;

-- -------------------------------------------------------------------------
-- 11. CUSTOMER MONTHLY REPORT WITH REVERSED SETTLEMENTS FILTER (P0-3)
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
  v_caller_org   uuid := public.current_organization_id();
  v_year         integer := coalesce(p_year, extract(year from current_date)::integer);
  v_month        integer := coalesce(p_month, extract(month from current_date)::integer);
  v_start_date   date;
  v_end_date     date;
  v_rows         jsonb := '[]'::jsonb;
  v_cust_rec     record;
  v_open_debt    numeric(14, 4);
  v_month_sales  numeric(14, 4);
  v_month_scrap  numeric(14, 4);
  v_month_cash   numeric(18, 2);
  v_month_cash_g numeric(14, 4);
  v_month_settle numeric(14, 4);
  v_close_debt   numeric(14, 4);

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

  v_start_date := make_date(v_year, v_month, 1);
  v_end_date   := (v_start_date + interval '1 month - 1 day')::date;

  for v_cust_rec in
    select c.id, c.customer_code, c.contact_name, c.phone, c.seller_id
    from public.customers c
    where c.organization_id = v_caller_org
      and (p_seller_id is null or c.seller_id = p_seller_id)
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
  if p_seller_id is not null then
    select
      coalesce(seller_till_cash_amount, 0),
      coalesce(seller_till_scrap_grams, 0),
      coalesce(bozor_qarzi_signed_g, 0)
    into v_tot_cash_uzs, v_tot_scrap_g, v_bozor_qarzi
    from public.seller_gold_accounts
    where seller_id = p_seller_id and organization_id = v_caller_org;
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
    'seller_id', p_seller_id,
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



