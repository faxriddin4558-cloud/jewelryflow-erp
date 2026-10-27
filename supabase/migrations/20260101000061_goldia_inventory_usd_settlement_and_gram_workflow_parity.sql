-- ============================================================================
-- Migration 061: Goldia Inventory, USD Settlement, and Pure Gram Workflow Parity
-- Targets:
-- 1. Eliminates phantom returned pieces from cancelled consignments (fixes 315.50g mgr stock & 84.50g seller stock)
-- 2. Guarantees 200g Manager Finished Stock + 200g Seller Physical Stock + 100g Customer Sold = 500g Factory Batch Parity
-- 3. Synchronizes USD Settlement math in client_gold_accounts & unified customer ledger ($1,000 USD @ 11,900 = 13.5227g eq, Dilrabo debt = 90.1137g)
-- 4. Weight Sale FIFO allocation against active seller consignments and pieces
-- 5. Full test account reset: marks pieces as 'cancelled' (never 'returned_to_manager'), reverses gold purchases, zeros all vault & till balances
-- 6. Factory handover refining batch link & auto-assay populating
-- ============================================================================

-- PART 1: SCHEMA ENHANCEMENTS
alter table public.client_gold_accounts
  add column if not exists total_usd_paid_amount numeric(18, 2) default 0,
  add column if not exists total_usd_equiv_grams numeric(14, 4) default 0;

alter table public.factory_gold_handovers
  add column if not exists refining_batch_id uuid references public.refining_batches(id) on delete set null;

create index if not exists idx_factory_gold_handovers_refining_batch
  on public.factory_gold_handovers (organization_id, refining_batch_id);

-- Expand consignment_pieces status check to permit 'cancelled' and 'reversed'
alter table public.consignment_pieces
  drop constraint if exists consignment_pieces_status_check;

alter table public.consignment_pieces
  add constraint consignment_pieces_status_check
  check (status in (
    'in_factory',
    'in_manager_stock',
    'held_by_seller',
    'sold',
    'returned_to_manager',
    'returned_to_factory',
    'reconciled',
    'cancelled',
    'reversed'
  ));


-- PART 2: FIX GET_MANAGER_AVAILABLE_STOCK_GRAMS
-- Manager available stock must ONLY include available batch physical grams
-- PLUS returned pieces whose parent consignments are ACTUALLY ACTIVE (not cancelled or reversed)
create or replace function public.get_manager_available_stock_grams(p_org_id uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id      uuid := coalesce(p_org_id, public.current_organization_id());
  v_receipt_g   numeric(14, 4);
  v_returned_g  numeric(14, 4);
begin
  if v_org_id is null then
    return 0;
  end if;

  -- 1. Available physical grams in active factory receipts
  select coalesce(sum(available_physical_g), 0)
  into v_receipt_g
  from public.factory_receipts
  where organization_id = v_org_id and status not in ('reversed', 'cancelled');

  -- 2. Consignment pieces returned to manager ONLY from active/non-cancelled consignments
  select coalesce(sum(cp.weight_grams), 0)
  into v_returned_g
  from public.consignment_pieces cp
  join public.seller_consignments sc on cp.consignment_id = sc.id
  where cp.organization_id = v_org_id
    and cp.status in ('in_manager_stock', 'returned_to_manager')
    and sc.status not in ('cancelled', 'reversed');

  return round(greatest(0, v_receipt_g + v_returned_g), 4);
end;
$$;

grant execute on function public.get_manager_available_stock_grams(uuid) to authenticated, service_role;


-- PART 3: FIX GET_SELLER_AVAILABLE_STOCK_GRAMS & RECALC_SELLER_GOLD_ACCOUNT
-- Returns must ONLY count pieces belonging to active (non-cancelled) consignments.
create or replace function public.get_seller_available_stock_grams(p_seller_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id    uuid := public.current_organization_id();
  v_consigned numeric(14, 4);
  v_sold      numeric(14, 4);
  v_ret       numeric(14, 4);
begin
  if p_seller_id is null then
    return 0;
  end if;

  select coalesce(sum(base_weight_grams), 0) into v_consigned
    from public.seller_consignments
   where seller_id = p_seller_id and organization_id = v_org_id
     and status in ('held_by_seller', 'partially_sold', 'fully_sold');

  select coalesce(sum(base_weight_grams), 0) into v_sold
    from public.jewelry_sales
   where seller_id = p_seller_id and organization_id = v_org_id
     and status not in ('cancelled', 'reversed');

  -- STRICT: Only count returns from non-cancelled/non-reversed consignments
  select coalesce(sum(cp.weight_grams), 0) into v_ret
    from public.consignment_pieces cp
    join public.seller_consignments sc on cp.consignment_id = sc.id
   where cp.seller_id = p_seller_id and cp.organization_id = v_org_id
     and cp.status in ('returned_to_factory', 'returned_to_manager')
     and sc.status not in ('cancelled', 'reversed');

  return round(greatest(0, v_consigned - v_sold - v_ret), 4);
end;
$$;

grant execute on function public.get_seller_available_stock_grams(uuid) to authenticated, service_role;


create or replace function public.recalc_seller_gold_account(
  p_seller_id uuid,
  p_org_id    uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_phys       numeric(14, 4);
  v_consignment_obl  numeric(14, 4);
  v_legacy_debt_obl  numeric(14, 4);
  v_total_obl        numeric(14, 4);
  v_total_stl        numeric(14, 4);
  v_s_owes           numeric(14, 4);
  v_m_owes           numeric(14, 4);
  v_signed           numeric(14, 4);
  v_total_sold       numeric(14, 4);
  v_total_ret        numeric(14, 4);
  v_cur_stock        numeric(14, 4);
begin
  if p_seller_id is null or p_org_id is null then
    return;
  end if;

  -- 1. Active Consignments
  select
    coalesce(sum(base_weight_grams), 0),
    coalesce(sum(coalesce(seller_obligation_g, factory_gold_due_grams)), 0)
  into v_total_phys, v_consignment_obl
  from public.seller_consignments
  where seller_id = p_seller_id and organization_id = p_org_id
    and status in ('held_by_seller', 'partially_sold', 'fully_sold');

  -- 1b. Legacy client debts assigned to this seller (unreversed)
  select coalesce(sum(delta_585_g), 0)
  into v_legacy_debt_obl
  from public.client_legacy_debts
  where seller_id = p_seller_id and organization_id = p_org_id
    and balance_type = 'debt'
    and status <> 'reversed';

  v_total_obl := round(v_consignment_obl + v_legacy_debt_obl, 4);

  -- 2. Total non-reversed settlements surrendered to manager/factory
  select coalesce(sum(total_settled_grams), 0)
  into v_total_stl
  from public.gold_settlements
  where seller_id = p_seller_id and organization_id = p_org_id
    and direction in ('seller_to_manager', 'seller_to_factory')
    and (status is null or status not in ('reversed', 'cancelled'))
    and reversal_of_id is null;

  v_s_owes := round(greatest(0, v_total_obl - v_total_stl), 4);
  v_m_owes := round(greatest(0, v_total_stl - v_total_obl), 4);
  v_signed := round(v_m_owes - v_s_owes, 4);

  -- 3. Total sold physical grams (sales not cancelled or reversed)
  select coalesce(sum(base_weight_grams), 0)
  into v_total_sold
  from public.jewelry_sales
  where seller_id = p_seller_id and organization_id = p_org_id
    and status not in ('cancelled', 'reversed');

  -- 4. Total returned pieces/consignments ONLY from active consignments
  select coalesce(sum(cp.weight_grams), 0)
  into v_total_ret
  from public.consignment_pieces cp
  join public.seller_consignments sc on cp.consignment_id = sc.id
  where cp.seller_id = p_seller_id and cp.organization_id = p_org_id
    and cp.status in ('returned_to_factory', 'returned_to_manager')
    and sc.status not in ('cancelled', 'reversed');

  v_cur_stock := round(greatest(0, v_total_phys - v_total_sold - v_total_ret), 4);

  insert into public.seller_gold_accounts (
    seller_id, organization_id,
    total_transferred_physical_g, total_seller_obligation_g,
    total_settled_to_manager_g, seller_owes_manager_g,
    manager_owes_seller_g, bozor_qarzi_signed_g,
    total_consigned_gold_grams, current_factory_obligation_grams,
    current_physical_stock_g, seller_legacy_debt_obligation_g,
    updated_at
  ) values (
    p_seller_id, p_org_id,
    v_total_phys, v_total_obl,
    v_total_stl, v_s_owes,
    v_m_owes, v_signed,
    v_consignment_obl, v_s_owes,
    v_cur_stock, v_legacy_debt_obl,
    now()
  )
  on conflict (seller_id) do update set
    total_transferred_physical_g = v_total_phys,
    total_seller_obligation_g = v_total_obl,
    total_settled_to_manager_g = v_total_stl,
    seller_owes_manager_g = v_s_owes,
    manager_owes_seller_g = v_m_owes,
    bozor_qarzi_signed_g = v_signed,
    total_consigned_gold_grams = v_consignment_obl,
    current_factory_obligation_grams = v_s_owes,
    current_physical_stock_g = v_cur_stock,
    seller_legacy_debt_obligation_g = v_legacy_debt_obl,
    updated_at = now();
end;
$$;

grant execute on function public.recalc_seller_gold_account(uuid, uuid) to authenticated, service_role;


-- PART 4: UPGRADE RPC_RECORD_WEIGHT_SALE (FIFO Consignment Allocation & Consistency)
drop function if exists public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text);

create or replace function public.rpc_record_weight_sale(
  p_customer_id       uuid,
  p_seller_id         uuid default null,
  p_weight_grams      numeric default null,
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

  v_weight := round(greatest(0, coalesce(p_weight_grams, 0))::numeric, 4);
  v_markup := round(coalesce(p_client_markup_pct, 0)::numeric, 2);

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

  -- Check available physical stock via canonical helper
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

    -- Also check if a weight-only consignment piece exists to decrement
    select * into v_piece
      from public.consignment_pieces
     where consignment_id = v_consign.id and status = 'held_by_seller'
     order by created_at asc limit 1
     for update;

    if found then
      if v_piece.weight_grams - v_weight > 0.0001 then
        update public.consignment_pieces
           set weight_grams = round((weight_grams - v_weight)::numeric, 4),
               updated_at = now()
         where id = v_piece.id;
      else
        update public.consignment_pieces
           set status = 'sold',
               sale_id = v_sale_id,
               sold_at = now(),
               updated_at = now()
         where id = v_piece.id;
      end if;
    end if;
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
$$;

grant execute on function public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text) to authenticated;


-- PART 5: FIX RPC_GET_UNIFIED_CUSTOMER_LEDGER (Include USD Equivalents in Customer Debt)
drop function if exists public.rpc_get_unified_customer_ledger();
drop function if exists public.rpc_get_unified_customer_ledger(uuid);
drop function if exists public.rpc_get_unified_customer_ledger(uuid, uuid);

create or replace function public.rpc_get_unified_customer_ledger(
  p_customer_id uuid default null,
  p_seller_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

grant execute on function public.rpc_get_unified_customer_ledger(uuid, uuid) to authenticated;


-- PART 6: UPGRADE RPC_GET_CUSTOMER_MONTHLY_REPORT (Return USD columns)
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
  v_bozor_qarzi  numeric(14, 4) := 0;
  v_seller_held_cash_uzs numeric(18, 2) := 0;
  v_seller_held_scrap_g  numeric(14, 4) := 0;
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

  if v_filter_seller is not null then
    select
      coalesce(seller_till_cash_amount, 0),
      coalesce(seller_till_scrap_grams, 0),
      coalesce(seller_owes_manager_g, 0)
    into v_seller_held_cash_uzs, v_seller_held_scrap_g, v_bozor_qarzi
    from public.seller_gold_accounts
    where seller_id = v_filter_seller and organization_id = v_caller_org;
  end if;

  return jsonb_build_object(
    'year', v_year,
    'month', v_month,
    'items', v_rows,
    'summary', jsonb_build_object(
      'total_customers', jsonb_array_length(v_rows),
      'total_opening_debt_g', v_tot_open,
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
      'seller_manager_bozor_qarzi_g', v_bozor_qarzi
    )
  );
end;
$$;

grant execute on function public.rpc_get_customer_monthly_report(uuid, integer, integer) to authenticated;


-- PART 7: UPGRADE RPC_REVERSE_CUSTOMER_SETTLEMENT (USD Reversals)
drop function if exists public.rpc_reverse_customer_settlement(uuid, text);

create or replace function public.rpc_reverse_customer_settlement(
  p_settlement_id   uuid,
  p_reversal_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    'accountant', 'buxgalter'
  ]);

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
$$;

grant execute on function public.rpc_reverse_customer_settlement(uuid, text) to authenticated;


-- PART 8: UPGRADE FACTORY GOLD HANDOVER (With Refining Batch Link)
drop function if exists public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric);
drop function if exists public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric, uuid);
drop function if exists public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric, uuid, uuid);

create or replace function public.rpc_record_factory_gold_handover(
  p_source_type         text default 'refined_gold',
  p_physical_weight_g   numeric default null,
  p_proba               numeric default 585.0,
  p_agreed_equivalent_g numeric default null,
  p_factory_recipient   text default 'Zavod',
  p_notes               text default null,
  p_idempotency_key     text default null,
  p_gross_weight_grams  numeric default null,
  p_capital_tx_id       uuid default null,
  p_refining_batch_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id          uuid := public.current_organization_id();
  v_emp_id          uuid := public.current_employee_id();
  v_phys_w          numeric(14, 4);
  v_pr              numeric(6, 2);
  v_computed_eq     numeric(14, 4);
  v_agreed_eq       numeric(14, 4);
  v_fine_w          numeric(14, 4);
  v_src_type        text;
  v_handover_no     text;
  v_handover_id     uuid;
  v_vault           public.manager_vault_account;
  v_existing        jsonb;
  v_notes           text := p_notes;
  v_cap_tx_id       uuid := p_capital_tx_id;
  v_ref_batch_id    uuid := p_refining_batch_id;
  v_new_handed_over numeric(14, 4);
  v_net_balance     numeric(14, 4);
  v_new_obligation  numeric(14, 4);
  v_new_advance     numeric(14, 4);
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi',
    'accountant', 'buxgalter'
  ]);

  if v_emp_id is null then
    select id into v_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
  end if;

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'handover_id', id,
      'handover_no', handover_no,
      'agreed_equivalent_g', agreed_equivalent_g,
      'equivalent_585_grams', agreed_equivalent_g,
      'current_factory_obligation_g', (select current_factory_obligation_g from public.manager_vault_account where organization_id = v_org_id),
      'current_factory_advance_g', (select current_factory_advance_g from public.manager_vault_account where organization_id = v_org_id)
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

  v_computed_eq := round(v_phys_w * (v_pr / 585.0), 4);
  v_fine_w := round((v_phys_w * (v_pr / 1000.0))::numeric, 4);

  v_agreed_eq := round(coalesce(p_agreed_equivalent_g, v_computed_eq)::numeric, 4);
  v_src_type := lower(coalesce(p_source_type, 'refined_gold'));

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  if v_src_type = 'capital_pure_gold' then
    if coalesce(v_vault.manager_capital_pure_gold_g, 0) < v_agreed_eq then
      raise exception 'ERR_INSUFFICIENT_VAULT_CAPITAL_PURE: Boshqaruvchi seyfida yetarli toza oltin kapitali yo''q (Mavjud: % g 585 eq, Talab: % g)',
        coalesce(v_vault.manager_capital_pure_gold_g, 0), v_agreed_eq;
    end if;

    update public.manager_vault_account
    set manager_capital_pure_gold_g = round(greatest(0, coalesce(manager_capital_pure_gold_g, 0) - v_agreed_eq)::numeric, 4),
        manager_capital_pure_gold_fine_g = round(greatest(0, coalesce(manager_capital_pure_gold_fine_g, 0) - v_fine_w)::numeric, 4),
        updated_at = now()
    where organization_id = v_org_id;

  elsif v_src_type = 'refined_gold' then
    if coalesce(v_vault.manager_refined_gold_grams, 0) < v_agreed_eq then
      raise exception 'ERR_INSUFFICIENT_VAULT_REFINED: Boshqaruvchi seyfida yetarli afinaj qilingan toza oltin yo''q (Mavjud: % g 585 eq, Talab: % g)',
        coalesce(v_vault.manager_refined_gold_grams, 0), v_agreed_eq;
    end if;

    update public.manager_vault_account
    set manager_refined_gold_grams = round(greatest(0, manager_refined_gold_grams - v_agreed_eq)::numeric, 4),
        manager_refined_gold_fine_grams = round(greatest(0, coalesce(manager_refined_gold_fine_grams, 0) - v_fine_w)::numeric, 4),
        updated_at = now()
    where organization_id = v_org_id;

  elsif v_src_type = 'purchased_gold' then
    if coalesce(v_vault.manager_purchased_gold_grams, 0) < v_agreed_eq then
      raise exception 'ERR_INSUFFICIENT_VAULT_PURCHASED: Boshqaruvchi seyfida yetarli xarid qilingan oltin yo''q (Mavjud: % g, Talab: % g)',
        coalesce(v_vault.manager_purchased_gold_grams, 0), v_agreed_eq;
    end if;

    update public.manager_vault_account
    set manager_purchased_gold_grams = round(greatest(0, manager_purchased_gold_grams - v_agreed_eq)::numeric, 4),
        updated_at = now()
    where organization_id = v_org_id;

  elsif v_src_type = 'scrap_gold' then
    if coalesce(v_vault.manager_scrap_grams, 0) < v_phys_w then
      raise exception 'ERR_INSUFFICIENT_VAULT_SCRAP: Boshqaruvchi seyfida yetarli lom oltin yo''q (Mavjud: % g, Talab: % g)',
        coalesce(v_vault.manager_scrap_grams, 0), v_phys_w;
    end if;

    update public.manager_vault_account
    set manager_scrap_grams = round(greatest(0, manager_scrap_grams - v_phys_w)::numeric, 4),
        manager_scrap_physical_g = round(greatest(0, coalesce(manager_scrap_physical_g, 0) - v_phys_w)::numeric, 4),
        manager_scrap_585_eq_g = round(greatest(0, coalesce(manager_scrap_585_eq_g, 0) - v_agreed_eq)::numeric, 4),
        updated_at = now()
    where organization_id = v_org_id;
  end if;

  v_handover_no := 'HND-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.factory_gold_handovers (
    organization_id, handover_no, source_type,
    physical_weight_g, gross_weight_grams, proba,
    computed_equivalent_g, agreed_equivalent_g, equivalent_585_grams, fine_weight_g,
    factory_recipient, handover_date, notes, idempotency_key, recorded_by,
    capital_tx_id, refining_batch_id
  ) values (
    v_org_id, v_handover_no, v_src_type,
    v_phys_w, v_phys_w, v_pr,
    v_computed_eq, v_agreed_eq, v_agreed_eq, v_fine_w,
    p_factory_recipient, current_date, v_notes, p_idempotency_key, v_emp_id,
    v_cap_tx_id, v_ref_batch_id
  ) returning id into v_handover_id;

  -- Update factory total obligation vs handovers
  select coalesce(sum(agreed_equivalent_g), 0) into v_new_handed_over
  from public.factory_gold_handovers
  where organization_id = v_org_id and status <> 'reversed';

  v_net_balance := coalesce(v_vault.total_factory_obligation_g, 0) - v_new_handed_over;

  if v_net_balance >= 0 then
    v_new_obligation := round(v_net_balance, 4);
    v_new_advance := 0;
  else
    v_new_obligation := 0;
    v_new_advance := round(abs(v_net_balance), 4);
  end if;

  update public.manager_vault_account
  set total_factory_handed_over_g = v_new_handed_over,
      current_factory_obligation_g = v_new_obligation,
      current_factory_advance_g = v_new_advance,
      updated_at = now()
  where organization_id = v_org_id;

  return jsonb_build_object(
    'status', 'ok',
    'handover_id', v_handover_id,
    'handover_no', v_handover_no,
    'source_type', v_src_type,
    'physical_weight_g', v_phys_w,
    'agreed_equivalent_g', v_agreed_eq,
    'equivalent_585_grams', v_agreed_eq,
    'current_factory_obligation_g', v_new_obligation,
    'current_factory_advance_g', v_new_advance
  );
end;
$$;

grant execute on function public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric, uuid, uuid) to authenticated;


-- PART 9: UPGRADE FULL TEST ACCOUNT RESET & PREVIEW (Set Pieces to 'cancelled', Reverse Purchases, Reset Vault/Tills)
drop function if exists public.rpc_preview_full_test_reset();

create or replace function public.rpc_preview_full_test_reset()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org     uuid := public.current_organization_id();
  v_preview_token  text;
  v_active_base    record;
  v_receipt_cnt    int;
  v_receipt_g      numeric(14, 4);
  v_consign_cnt    int;
  v_consign_g      numeric(14, 4);
  v_piece_cnt      int;
  v_sale_cnt       int;
  v_settle_cnt     int;
  v_refining_cnt   int;
  v_fintx_cnt      int;
  v_purch_cnt      int;
  v_cust_debt_g    numeric(14, 4);
  v_seller_till_g  numeric(14, 4);
  v_mgr_scrap_g    numeric(14, 4);
  v_mgr_fine_g     numeric(14, 4);
  v_mgr_cash       numeric(18, 2);
  v_mgr_usd        numeric(18, 2);
  v_preserved_emp  int;
  v_preserved_cus  int;
  v_preserved_mdl  int;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  v_preview_token := 'RESET-TOKEN-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  select id, baseline_no, baseline_date, net_assets_585_g into v_active_base
    from public.accounting_baselines
   where organization_id = v_caller_org and status = 'active'
   order by baseline_date desc, created_at desc limit 1;

  select count(*), coalesce(sum(available_physical_g), 0)
    into v_receipt_cnt, v_receipt_g
    from public.factory_receipts
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');

  select count(*), coalesce(sum(base_weight_grams), 0)
    into v_consign_cnt, v_consign_g
    from public.seller_consignments
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');

  select count(*) into v_piece_cnt
    from public.consignment_pieces
   where organization_id = v_caller_org and status <> 'cancelled';

  select count(*) into v_sale_cnt
    from public.jewelry_sales
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');

  select count(*) into v_settle_cnt
    from public.gold_settlements
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');

  select count(*) into v_refining_cnt
    from public.refining_batches
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');

  select count(*) into v_fintx_cnt
    from public.financial_transactions
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');

  select count(*) into v_purch_cnt
    from public.gold_purchases
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');

  select coalesce(sum(current_debt_grams), 0) into v_cust_debt_g
    from public.client_gold_accounts
   where organization_id = v_caller_org;

  select coalesce(sum(seller_till_scrap_grams), 0) into v_seller_till_g
    from public.seller_gold_accounts
   where organization_id = v_caller_org;

  select coalesce(manager_scrap_grams, 0), coalesce(manager_refined_gold_grams, 0),
         coalesce(manager_cash_amount, 0), coalesce(manager_usd_amount, 0)
    into v_mgr_scrap_g, v_mgr_fine_g, v_mgr_cash, v_mgr_usd
    from public.manager_vault_account
   where organization_id = v_caller_org;

  select count(*) into v_preserved_emp from public.employees where organization_id = v_caller_org;
  select count(*) into v_preserved_cus from public.customers where organization_id = v_caller_org;
  select count(*) into v_preserved_mdl from public.jewelry_models where organization_id = v_caller_org;

  return jsonb_build_object(
    'status', 'ok',
    'preview_token', v_preview_token,
    'has_active_baseline', (v_active_base.id is not null),
    'active_baseline_no', v_active_base.baseline_no,
    'active_baseline_net_assets_g', v_active_base.net_assets_585_g,
    'affected_records', jsonb_build_object(
      'factory_receipts_count', v_receipt_cnt,
      'factory_receipts_grams', v_receipt_g,
      'seller_consignments_count', v_consign_cnt,
      'seller_consignments_grams', v_consign_g,
      'consignment_pieces_count', v_piece_cnt,
      'jewelry_sales_count', v_sale_cnt,
      'gold_settlements_count', v_settle_cnt,
      'refining_batches_count', v_refining_cnt,
      'financial_transactions_count', v_fintx_cnt,
      'gold_purchases_count', v_purch_cnt,
      'customer_active_debt_g', v_cust_debt_g,
      'seller_tills_scrap_g', v_seller_till_g,
      'manager_scrap_vault_g', v_mgr_scrap_g,
      'manager_refined_vault_g', v_mgr_fine_g,
      'manager_cash_vault_uzs', v_mgr_cash,
      'manager_usd_vault', v_mgr_usd
    ),
    'preserved_master_data', jsonb_build_object(
      'employees_count', v_preserved_emp,
      'customers_count', v_preserved_cus,
      'jewelry_models_count', v_preserved_mdl,
      'organizations_preserved', true,
      'audit_history_preserved', true
    ),
    'confirmation_code_required', 'RESET_TEST_ACCOUNT_2026'
  );
end;
$$;

grant execute on function public.rpc_preview_full_test_reset() to authenticated;


drop function if exists public.rpc_execute_full_test_reset(text, text);

create or replace function public.rpc_execute_full_test_reset(
  p_confirmation_code text,
  p_reason            text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_emp_id uuid := public.current_employee_id();
  v_reason        text := nullif(btrim(p_reason), '');
  v_rev_ts        timestamptz := now();
  v_rev_note      text;
  v_base_archived int := 0;
  v_sale_rev      int := 0;
  v_settle_rev    int := 0;
  v_piece_rev     int := 0;
  v_consign_rev   int := 0;
  v_rcp_rev       int := 0;
  v_hnd_rev       int := 0;
  v_ref_rev       int := 0;
  v_fintx_rev     int := 0;
  v_purch_rev     int := 0;
  v_leg_rev       int := 0;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id from public.employees where user_id = auth.uid() and organization_id = v_caller_org limit 1;
  end if;

  if p_confirmation_code is null or btrim(p_confirmation_code) <> 'RESET_TEST_ACCOUNT_2026' then
    raise exception 'Tasdiqlash kodi noto''g''ri. Talab qilinadi: RESET_TEST_ACCOUNT_2026';
  end if;

  if v_reason is null then
    raise exception 'Test hisobini tozalash sababi (audit uchun) kiritilishi shart';
  end if;

  v_rev_note := 'TEST HISOBI TOZALANDI: ' || v_reason || ' (' || to_char(v_rev_ts, 'YYYY-MM-DD HH24:MI') || ')';

  -- A. Reverse sales
  update public.jewelry_sales
     set status = 'reversed',
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_sale_rev = row_count;

  -- B. Reverse customer settlements and manager surrenders
  update public.gold_settlements
     set status = 'reversed',
         reversed_at = v_rev_ts,
         reversed_by = v_caller_emp_id,
         reversal_reason = v_reason,
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']'
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_settle_rev = row_count;

  -- C. Reset client gold accounts
  update public.client_gold_accounts
     set current_debt_grams = 0,
         advance_balance_grams = 0,
         total_settled_grams = 0,
         total_purchased_gold_grams = 0,
         total_scrap_paid_grams = 0,
         total_cash_paid_amount = 0,
         total_cash_equiv_grams = 0,
         total_usd_paid_amount = 0,
         total_usd_equiv_grams = 0,
         updated_at = v_rev_ts
   where organization_id = v_caller_org;

  -- D. Reverse legacy client debts
  update public.client_legacy_debts
     set status = 'reversed',
         reversed_at = v_rev_ts,
         reversed_by = v_caller_emp_id,
         reversal_reason = v_reason,
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'reversed';
  get diagnostics v_leg_rev = row_count;

  -- E. Mark consignment pieces CANCELLED (never returned_to_manager!)
  update public.consignment_pieces
     set status = 'cancelled',
         sale_id = null,
         sold_at = null,
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'cancelled';
  get diagnostics v_piece_rev = row_count;

  -- F. Cancel seller consignments
  update public.seller_consignments
     set status = 'cancelled',
         base_weight_grams = 0,
         seller_obligation_g = 0,
         quantity = 0,
         sold_quantity = 0,
         returned_quantity = 0,
         returned_weight_grams = 0,
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'cancelled';
  get diagnostics v_consign_rev = row_count;

  -- G. Reverse factory receipts
  update public.factory_receipts
     set status = 'reversed',
         available_physical_g = 0,
         transferred_physical_g = 0,
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'reversed';
  get diagnostics v_rcp_rev = row_count;

  -- H. Reverse factory gold handovers
  update public.factory_gold_handovers
     set status = 'reversed',
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'reversed';
  get diagnostics v_hnd_rev = row_count;

  -- I. Cancel refining batches
  update public.refining_batches
     set status = 'reversed',
         reversed_at = v_rev_ts,
         reversed_by = v_caller_emp_id,
         reversal_reason = v_reason,
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_ref_rev = row_count;

  -- J. Reverse financial transactions
  update public.financial_transactions
     set status = 'reversed',
         reversed_at = v_rev_ts,
         reversed_by = v_caller_emp_id,
         reversal_reason = v_reason,
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_fintx_rev = row_count;

  -- J2. Reverse gold purchases
  update public.gold_purchases
     set status = 'reversed',
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']'
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_purch_rev = row_count;

  -- K. Reset seller gold accounts to exact zero
  update public.seller_gold_accounts
     set total_transferred_physical_g = 0,
         total_seller_obligation_g = 0,
         total_settled_to_manager_g = 0,
         seller_owes_manager_g = 0,
         manager_owes_seller_g = 0,
         bozor_qarzi_signed_g = 0,
         total_consigned_gold_grams = 0,
         current_factory_obligation_grams = 0,
         current_physical_stock_g = 0,
         seller_till_scrap_grams = 0,
         seller_till_scrap_physical_g = 0,
         seller_till_scrap_585_eq_g = 0,
         seller_till_cash_amount = 0,
         seller_till_usd_amount = 0,
         seller_legacy_debt_obligation_g = 0,
         updated_at = v_rev_ts
   where organization_id = v_caller_org;

  -- L. Reset manager vault to exact zero
  perform public._get_or_create_manager_vault(v_caller_org);
  update public.manager_vault_account
     set manager_physical_stock_g        = 0,
         manager_scrap_grams             = 0,
         manager_scrap_physical_g        = 0,
         manager_scrap_585_eq_g          = 0,
         manager_refined_gold_grams      = 0,
         manager_refined_gold_fine_grams = 0,
         manager_capital_pure_gold_g     = 0,
         manager_capital_pure_gold_fine_g= 0,
         manager_finished_capital_g      = 0,
         manager_purchased_gold_grams    = 0,
         manager_cash_amount             = 0,
         manager_usd_amount              = 0,
         total_factory_received_g        = 0,
         total_factory_obligation_g      = 0,
         total_factory_handed_over_g     = 0,
         current_factory_obligation_g    = 0,
         current_factory_advance_g       = 0,
         updated_at                      = v_rev_ts
   where organization_id = v_caller_org;

  -- M. Archive active baseline
  update public.accounting_baselines
     set status = 'archived',
         notes = coalesce(notes, '') || ' [TEST HISOBI TOZALASH BILAN ARXIVLANDI: ' || v_reason || ']'
   where organization_id = v_caller_org and status = 'active';
  get diagnostics v_base_archived = row_count;

  -- N. Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) values (
    v_caller_org, 'accounting_baselines', 'FULL_RESET', 'FULL_TEST_ACCOUNT_RESET', auth.uid(),
    jsonb_build_object(
      'reason', v_reason,
      'baselines_archived', v_base_archived,
      'sales_reversed', v_sale_rev,
      'settlements_reversed', v_settle_rev,
      'consignments_cancelled', v_consign_rev,
      'pieces_cancelled', v_piece_rev,
      'receipts_reversed', v_rcp_rev,
      'handovers_reversed', v_hnd_rev,
      'refining_reversed', v_ref_rev,
      'fintx_reversed', v_fintx_rev,
      'purchases_reversed', v_purch_rev,
      'legacy_debts_reversed', v_leg_rev
    )
  );

  return jsonb_build_object(
    'status', 'ok',
    'message', 'Test hisobi to''liq muvaffaqiyatli tozalandi va barcha faol qoldiqlar 0 ga keltirildi!',
    'summary', jsonb_build_object(
      'baselines_archived', v_base_archived,
      'sales_reversed', v_sale_rev,
      'settlements_reversed', v_settle_rev,
      'consignments_cancelled', v_consign_rev,
      'pieces_cancelled', v_piece_rev,
      'factory_receipts_reversed', v_rcp_rev,
      'factory_handovers_reversed', v_hnd_rev,
      'refining_batches_reversed', v_ref_rev,
      'financial_transactions_reversed', v_fintx_rev,
      'gold_purchases_reversed', v_purch_rev,
      'legacy_debts_reversed', v_leg_rev,
      'active_inventory_g', 0.0,
      'active_factory_obligation_g', 0.0,
      'active_customer_debts_g', 0.0,
      'active_seller_obligation_g', 0.0,
      'active_vault_scrap_g', 0.0,
      'active_vault_cash_uzs', 0.0,
      'active_vault_usd', 0.0
    )
  );
end;
$$;

grant execute on function public.rpc_execute_full_test_reset(text, text) to authenticated;


-- PART 10: IMMEDIATE AUDIT & DATA REPAIR FOR CURRENT PRODUCTION RECORDS
do $$
declare
  r_sel record;
  r_org record;
  v_cust_id uuid;
begin
  -- 1. Cancel all orphan/cancelled consignment pieces
  update public.consignment_pieces
     set status = 'cancelled'
   where consignment_id in (select id from public.seller_consignments where status in ('cancelled', 'reversed'));

  -- 2. Repair active consignment CONS-BC-4D9134D4 and sale SALE-W-20261027-96320D
  update public.jewelry_sales
     set consignment_id = (select id from public.seller_consignments where consignment_no = 'CONS-BC-4D9134D4')
   where sale_no = 'SALE-W-20261027-96320D';

  update public.seller_consignments
     set status = 'partially_sold',
         sold_quantity = 1
   where consignment_no = 'CONS-BC-4D9134D4';

  -- 3. Update piece 3e47550e to remaining 200g
  update public.consignment_pieces
     set weight_grams = 200.0000
   where model_code = 'VAZN' and status = 'held_by_seller'
     and consignment_id = (select id from public.seller_consignments where consignment_no = 'CONS-BC-4D9134D4');

  -- 4. Recalculate seller accounts across all organizations
  for r_sel in select id, organization_id from public.employees where lower(role::text) in ('seller', 'sotuvchi', 'sales') loop
    perform public.recalc_seller_gold_account(r_sel.id, r_sel.organization_id);
  end loop;

  -- 5. Sync manager vaults across all organizations
  for r_org in select id from public.organizations loop
    update public.manager_vault_account
       set manager_physical_stock_g = public.get_manager_available_stock_grams(r_org.id),
           updated_at = now()
     where organization_id = r_org.id;
  end loop;

  -- 6. Reconcile Dilrabo Apka customer account (SETTL-5A681492 USD 13.5227g inclusion)
  select id into v_cust_id from public.customers where customer_code = 'CUST-0001' limit 1;
  if v_cust_id is not null then
    perform public.rpc_get_unified_customer_ledger(v_cust_id, null);
  end if;
end;
$$;
