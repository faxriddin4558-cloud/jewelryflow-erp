-- =========================================================================
-- Migration 038: Final Mega Fix for JewelryFlow Sales
-- 1. Customers RLS Policy: Full access for directors/managers; isolated access for sellers
-- 2. Manager Settlement Permissions: Authorize manager (production_manager) to accept seller cash/scrap
-- 3. Read-Only Piece-Sales Reconciliation Report
-- 4. Timezone-aware Daily Ledger Filtering (Asia/Tashkent)
-- =========================================================================

-- 1. CUSTOMERS RLS POLICY (P0: Section 1)
-- Allow privileged roles to see/manage all customers in the organization.
-- Allow sellers to see/manage only their assigned customers or unassigned customers.
drop policy if exists "customers_tenant_select" on public.customers;
create policy "customers_tenant_select" on public.customers
for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.current_employee_role_text() = any (array[
      'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager',
      'boshqaruvchi', 'accountant', 'buxgalter', 'hisobchi'
    ])
    or (
      public.current_employee_role_text() = any (array['seller', 'sotuvchi', 'sales'])
      and (seller_id = public.current_employee_id() or seller_id is null)
    )
  )
);

drop policy if exists "customers_tenant_manage" on public.customers;
create policy "customers_tenant_manage" on public.customers
for all to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.current_employee_role_text() = any (array[
      'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager',
      'boshqaruvchi', 'accountant', 'buxgalter', 'hisobchi'
    ])
    or (
      public.current_employee_role_text() = any (array['seller', 'sotuvchi', 'sales'])
      and (seller_id = public.current_employee_id() or seller_id is null)
    )
  )
)
with check (
  organization_id = public.current_organization_id()
  and (
    public.current_employee_role_text() = any (array[
      'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager',
      'boshqaruvchi', 'accountant', 'buxgalter', 'hisobchi'
    ])
    or (
      public.current_employee_role_text() = any (array['seller', 'sotuvchi', 'sales'])
      and (seller_id = public.current_employee_id() or seller_id is null)
    )
  )
);


-- 2. MANAGER SETTLEMENT PERMISSIONS (P0: Section 2)
-- Authorize manager ('production_manager', 'manager', 'boshqaruvchi') to receive seller till settlements
create or replace function public.rpc_record_seller_to_manager_settlement(
  p_seller_id           uuid,
  p_scrap_weight_grams  numeric default 0,
  p_cash_paid_amount    numeric default 0,
  p_rate_per_gram       numeric default null,
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
  v_caller_emp_id   uuid;
  v_rate            numeric(18, 2);
  v_scrap_w         numeric(14, 4);
  v_cash            numeric(18, 2);
  v_cash_equiv      numeric(14, 4) := 0;
  v_total_settled   numeric(14, 4);
  v_settle_no       text;
  v_settle_id       uuid;
  v_seller_acc      public.seller_gold_accounts;
  v_vault           public.manager_vault_account;
  v_existing        jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'settlement_id', id,
      'settlement_no', settlement_no,
      'total_settled_grams', total_settled_grams
    ) into v_existing
    from public.gold_settlements
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_scrap_w := round(greatest(0, coalesce(p_scrap_weight_grams, 0))::numeric, 4);
  v_cash := round(greatest(0, coalesce(p_cash_paid_amount, 0))::numeric, 2);

  if v_scrap_w <= 0 and v_cash <= 0 then
    raise exception 'Settlement must include either scrap gold grams or cash amount';
  end if;

  -- Determine gold rate
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_org_id
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      v_rate := 900000;
    end if;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  end if;

  v_total_settled := round(v_scrap_w + v_cash_equiv, 4);

  -- Resolve employee ID for recorded_by
  select id into v_caller_emp_id
  from public.employees
  where user_id = auth.uid() and organization_id = v_org_id
  limit 1;

  if v_caller_emp_id is null then
    v_caller_emp_id := p_seller_id;
  end if;

  -- Fetch and lock seller gold account
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id and organization_id = v_org_id for update;

  -- Deduct from seller till
  update public.seller_gold_accounts
  set seller_till_scrap_grams = round(greatest(0, seller_till_scrap_grams - v_scrap_w), 4),
      seller_till_cash_amount = round(greatest(0, seller_till_cash_amount - v_cash), 2),
      updated_at = now()
  where seller_id = p_seller_id;

  -- Add to manager vault (scrap and cash holdings)
  perform public._get_or_create_manager_vault(v_org_id);

  update public.manager_vault_account
  set manager_scrap_grams = round(manager_scrap_grams + v_scrap_w, 4),
      manager_cash_amount = round(manager_cash_amount + v_cash, 2),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  v_settle_no := 'STL-MGR-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id,
    settlement_no,
    direction,
    seller_id,
    gold_rate_applied,
    scrap_weight_grams,
    scrap_proba,
    cash_paid_amount,
    currency,
    cash_equivalent_grams,
    total_settled_grams,
    applied_to_debt_grams,
    excess_gold_grams,
    previous_debt_grams,
    remaining_debt_grams,
    notes,
    recorded_by,
    idempotency_key
  ) values (
    v_org_id,
    v_settle_no,
    'seller_to_manager',
    p_seller_id,
    v_rate,
    v_scrap_w,
    585,
    v_cash,
    'UZS',
    v_cash_equiv,
    v_total_settled,
    v_total_settled,
    0,
    0,
    0,
    p_notes,
    v_caller_emp_id,
    p_idempotency_key
  ) returning id into v_settle_id;

  -- Read seller account updated automatically by fn_sync_seller_gold_account trigger
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id;

  return jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'scrap_weight_grams', v_scrap_w,
    'cash_paid_amount', v_cash,
    'rate_applied', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'total_settled_grams', v_total_settled,
    'seller_owes_manager_g', v_seller_acc.seller_owes_manager_g,
    'manager_owes_seller_g', v_seller_acc.manager_owes_seller_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_cash_amount', v_vault.manager_cash_amount
  );
end;
$$;

grant execute on function public.rpc_record_seller_to_manager_settlement(uuid, numeric, numeric, numeric, text, text) to authenticated;


-- Also authorize manager in rpc_record_seller_to_factory_settlement
create or replace function public.rpc_record_seller_to_factory_settlement(
  p_seller_id           uuid,
  p_scrap_weight        numeric default 0,
  p_cash_amount         numeric default 0,
  p_rate_per_gram       numeric default null,
  p_settlement_date     date default current_date,
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
  v_caller_emp_id   uuid;
  v_rate            numeric(18, 2);
  v_scrap_w         numeric(14, 4);
  v_cash            numeric(18, 2);
  v_cash_equiv      numeric(14, 4) := 0;
  v_total_settled   numeric(14, 4);
  v_settle_no       text;
  v_settle_id       uuid;
  v_seller_acc      public.seller_gold_accounts;
  v_existing        jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'warehouse', 'omborchi', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'settlement_id', id,
      'settlement_no', settlement_no,
      'total_settled_grams', total_settled_grams
    ) into v_existing
    from public.gold_settlements
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_scrap_w := round(greatest(0, coalesce(p_scrap_weight, 0))::numeric, 4);
  v_cash    := round(greatest(0, coalesce(p_cash_amount, 0))::numeric, 2);

  if v_scrap_w <= 0 and v_cash <= 0 then
    raise exception 'Settlement must include either scrap gold grams or cash amount';
  end if;

  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_org_id
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      v_rate := 900000;
    end if;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  end if;

  v_total_settled := round(v_scrap_w + v_cash_equiv, 4);

  select id into v_caller_emp_id
  from public.employees
  where user_id = auth.uid() and organization_id = v_org_id
  limit 1;

  if v_caller_emp_id is null then
    v_caller_emp_id := p_seller_id;
  end if;

  -- Deduct from seller till
  update public.seller_gold_accounts
  set seller_till_scrap_grams = round(greatest(0, seller_till_scrap_grams - v_scrap_w), 4),
      seller_till_cash_amount = round(greatest(0, seller_till_cash_amount - v_cash), 2),
      updated_at = now()
  where seller_id = p_seller_id;

  v_settle_no := 'STL-FCT-' || to_char(coalesce(p_settlement_date, current_date), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id,
    settlement_no,
    direction,
    seller_id,
    gold_rate_applied,
    scrap_weight_grams,
    scrap_proba,
    cash_paid_amount,
    currency,
    cash_equivalent_grams,
    total_settled_grams,
    applied_to_debt_grams,
    excess_gold_grams,
    previous_debt_grams,
    remaining_debt_grams,
    notes,
    recorded_by,
    idempotency_key,
    settlement_date
  ) values (
    v_org_id,
    v_settle_no,
    'seller_to_factory',
    p_seller_id,
    v_rate,
    v_scrap_w,
    585,
    v_cash,
    'UZS',
    v_cash_equiv,
    v_total_settled,
    v_total_settled,
    0,
    0,
    0,
    p_notes,
    v_caller_emp_id,
    p_idempotency_key,
    coalesce(p_settlement_date, current_date)
  ) returning id into v_settle_id;

  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id;

  return jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'scrap_weight_grams', v_scrap_w,
    'cash_paid_amount', v_cash,
    'rate_applied', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'total_settled_grams', v_total_settled,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g
  );
end;
$$;

grant execute on function public.rpc_record_seller_to_factory_settlement(uuid, numeric, numeric, numeric, date, text, text) to authenticated;


-- 3. READ-ONLY PIECE SALES RECONCILIATION REPORT (P0: Section 5)
create or replace function public.rpc_get_piece_sales_reconciliation_report()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid := public.current_organization_id();
  v_discrepancies jsonb := '[]'::jsonb;
  v_total_pieces integer := 0;
  v_held_pieces integer := 0;
  v_sold_pieces integer := 0;
  v_ret_pieces integer := 0;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  select
    count(*),
    count(*) filter (where status = 'held_by_seller'),
    count(*) filter (where status = 'sold'),
    count(*) filter (where status like 'returned%')
  into v_total_pieces, v_held_pieces, v_sold_pieces, v_ret_pieces
  from public.consignment_pieces
  where organization_id = v_org_id;

  -- Find pieces with discrepancies:
  -- Case A: Piece marked held_by_seller but has sale_id
  -- Case B: Piece marked sold but has no sale_id or sale record doesn't exist
  -- Case C: Consignment marked fully_sold but pieces still held_by_seller
  select coalesce(jsonb_agg(d), '[]'::jsonb)
  into v_discrepancies
  from (
    select
      cp.id as piece_id,
      cp.model_code,
      cp.model_name,
      cp.weight_grams,
      cp.status as piece_status,
      cp.sale_id,
      sc.consignment_no,
      sc.status as consignment_status,
      case
        when cp.status = 'held_by_seller' and cp.sale_id is not null then 'piece_marked_held_but_has_sale_id'
        when cp.status = 'sold' and cp.sale_id is null then 'piece_marked_sold_without_sale_id'
        when sc.status = 'fully_sold' and cp.status = 'held_by_seller' then 'consignment_fully_sold_but_piece_held'
        else 'other_anomaly'
      end as anomaly_type
    from public.consignment_pieces cp
    join public.seller_consignments sc on sc.id = cp.consignment_id
    where cp.organization_id = v_org_id
      and (
        (cp.status = 'held_by_seller' and cp.sale_id is not null)
        or (cp.status = 'sold' and cp.sale_id is null)
        or (sc.status = 'fully_sold' and cp.status = 'held_by_seller')
      )
  ) d;

  return jsonb_build_object(
    'organization_id', v_org_id,
    'total_pieces', v_total_pieces,
    'held_pieces', v_held_pieces,
    'sold_pieces', v_sold_pieces,
    'returned_pieces', v_ret_pieces,
    'anomaly_count', jsonb_array_length(v_discrepancies),
    'discrepancies', v_discrepancies
  );
end;
$$;

grant execute on function public.rpc_get_piece_sales_reconciliation_report() to authenticated;


-- 4. RESILIENT DAILY SALES LEDGER (P1: Section 9)
-- Handles timezones cleanly using Tashkent (UTC+5) boundaries
create or replace function public.rpc_get_daily_sales_ledger(
  p_seller_id  uuid default null,
  p_start_date date default null,
  p_end_date   date default null
)
returns table(
  tx_id             uuid,
  tx_type           text,
  tx_date           date,
  customer_id       uuid,
  customer_code     text,
  customer_name     text,
  seller_id         uuid,
  seller_name       text,
  model_name        text,
  model_code        text,
  item_id           uuid,
  sold_weight_g     numeric,
  markup_pct        numeric,
  obligation_g      numeric,
  scrap_received_g  numeric,
  cash_received_uzs numeric,
  rate_per_gram     numeric,
  cash_equiv_g      numeric,
  total_payment_g   numeric,
  closing_debt_g    numeric,
  notes             text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_today_tkt  date := (timezone('Asia/Tashkent', now()))::date;
  v_d1         date := coalesce(p_start_date, v_today_tkt - interval '30 days');
  v_d2         date := coalesce(p_end_date, v_today_tkt);
  v_from       date := least(v_d1, v_d2);
  v_to         date := greatest(v_d1, v_d2);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  return query
  -- 1. Sales entries
  select
    s.id as tx_id,
    'sale'::text as tx_type,
    s.sale_date as tx_date,
    s.customer_id,
    coalesce(c.customer_code, 'CUST-XXXX') as customer_code,
    coalesce(c.contact_name, 'Mijoz') as customer_name,
    s.seller_id,
    coalesce(e.full_name, e.name, 'Sotuvchi') as seller_name,
    s.product_name as model_name,
    coalesce(cp.model_code, 'M-GENERIC') as model_code,
    cp.id as item_id,
    s.base_weight_grams as sold_weight_g,
    s.client_markup_pct as markup_pct,
    s.client_gold_due_grams as obligation_g,
    0::numeric as scrap_received_g,
    0::numeric as cash_received_uzs,
    0::numeric as rate_per_gram,
    0::numeric as cash_equiv_g,
    coalesce(s.settled_gold_grams, 0)::numeric as total_payment_g,
    s.remaining_gold_grams as closing_debt_g,
    s.notes
  from public.jewelry_sales s
  join public.customers c on c.id = s.customer_id
  join public.employees e on e.id = s.seller_id
  left join public.consignment_pieces cp on cp.sale_id = s.id
  where s.organization_id = v_caller_org
    and s.sale_date between v_from and v_to
    and (p_seller_id is null or s.seller_id = p_seller_id)
    and s.status <> 'reversed'

  union all

  -- 2. Payment/Settlement entries
  select
    gs.id as tx_id,
    'payment'::text as tx_type,
    gs.settlement_date as tx_date,
    gs.customer_id,
    coalesce(c.customer_code, 'CUST-XXXX') as customer_code,
    coalesce(c.contact_name, 'Mijoz') as customer_name,
    gs.seller_id,
    coalesce(e.full_name, e.name, 'Sotuvchi') as seller_name,
    'To''lov / Qaytim'::text as model_name,
    'PAYMENT'::text as model_code,
    null::uuid as item_id,
    0::numeric as sold_weight_g,
    0::numeric as markup_pct,
    0::numeric as obligation_g,
    gs.scrap_weight_grams as scrap_received_g,
    gs.cash_paid_amount as cash_received_uzs,
    gs.gold_rate_applied as rate_per_gram,
    gs.cash_equivalent_grams as cash_equiv_g,
    gs.total_settled_grams as total_payment_g,
    gs.remaining_debt_grams as closing_debt_g,
    gs.notes
  from public.gold_settlements gs
  join public.customers c on c.id = gs.customer_id
  join public.employees e on e.id = gs.seller_id
  where gs.organization_id = v_caller_org
    and gs.direction = 'client_to_seller'
    and gs.settlement_date between v_from and v_to
    and (p_seller_id is null or gs.seller_id = p_seller_id)

  order by tx_date desc, tx_id desc;
end;
$$;

grant execute on function public.rpc_get_daily_sales_ledger(uuid, date, date) to authenticated;


-- 5. ROBUST CUSTOMER CODE SEQUENCE GENERATION (P0 / Section 1)
-- Avoids duplicate key collisions on customers_customer_code_key
create or replace function public.rpc_create_customer_with_code(
  p_contact_name text,
  p_phone        text default null,
  p_company_name text default null,
  p_seller_id    uuid default null,
  p_notes        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org   uuid := public.current_organization_id();
  v_clean_name   text := nullif(btrim(p_contact_name), '');
  v_next_seq     integer;
  v_cust_code    text;
  v_cust_id      uuid;
  v_seller_id    uuid := p_seller_id;
  v_existing_id  uuid;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_clean_name is null then
    raise exception 'Mijoz ismi kiritilishi shart';
  end if;

  -- Default seller to caller employee if not supplied
  if v_seller_id is null then
    select id into v_seller_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_caller_org
    limit 1;
  end if;

  -- Duplicate check by name and seller
  select id into v_existing_id
  from public.customers
  where organization_id = v_caller_org
    and lower(contact_name) = lower(v_clean_name)
    and (v_seller_id is null or seller_id = v_seller_id)
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'status', 'existing',
      'customer_id', v_existing_id,
      'message', 'Ushbu nomdagi mijoz allaqachon mavjud'
    );
  end if;

  -- Generate sequential customer code (look across entire table to respect unique constraint)
  select coalesce(max(nullif(regexp_replace(customer_code, '\D', '', 'g'), '')::integer), 0) + 1
  into v_next_seq
  from public.customers;

  v_cust_code := 'CUST-' || lpad(v_next_seq::text, 4, '0');

  -- Loop to guarantee zero unique constraint collision
  while exists (select 1 from public.customers where customer_code = v_cust_code) loop
    v_next_seq := v_next_seq + 1;
    v_cust_code := 'CUST-' || lpad(v_next_seq::text, 4, '0');
  end loop;

  insert into public.customers (
    organization_id, customer_code, contact_name, phone, company_name, seller_id, notes
  ) values (
    v_caller_org, v_cust_code, v_clean_name, p_phone, p_company_name, v_seller_id, p_notes
  ) returning id into v_cust_id;

  return jsonb_build_object(
    'status', 'ok',
    'customer_id', v_cust_id,
    'customer_code', v_cust_code,
    'contact_name', v_clean_name,
    'phone', p_phone,
    'seller_id', v_seller_id
  );
end;
$$;

grant execute on function public.rpc_create_customer_with_code(text, text, text, uuid, text) to authenticated;

