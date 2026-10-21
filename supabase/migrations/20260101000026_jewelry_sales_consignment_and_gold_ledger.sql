-- =========================================================================
-- JewelryFlow ERP — Migration 026
-- Jewelry Sales, Seller Consignment, Gold Settlements & Dual-Ledger Architecture
-- =========================================================================
-- Implements:
-- 1. Factory -> Seller -> Client separate ledger balances
-- 2. Non-compounding markups calculated strictly from base product weight
-- 3. Pure scrap gold gram accounting with immutable historical currency rates
-- 4. Segregation of client settlements into seller till vs seller-to-factory surrender
-- 5. Non-loss preservation of client advance/excess payments
-- 6. Strict customer unique identities and cross-seller RLS boundary
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Daily Gold Rates (Kunlik Lom Oltin Kursi)
-- -------------------------------------------------------------------------
create table if not exists public.daily_gold_rates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  rate_date        date not null default current_date,
  proba            numeric(6, 2) not null default 585 check (proba > 0 and proba <= 1000),
  rate_per_gram    numeric(18, 2) not null check (rate_per_gram > 0),
  currency         text not null default 'UZS',
  is_confirmed     boolean not null default true,
  set_by           uuid references public.employees(id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_daily_gold_rates_tenant_date_proba unique (organization_id, rate_date, proba)
);

create index if not exists idx_daily_gold_rates_lookup
  on public.daily_gold_rates (organization_id, rate_date desc, proba);

-- -------------------------------------------------------------------------
-- 2. Enhance Customers Table for Sales Identity & Seller Assignment
-- -------------------------------------------------------------------------
alter table public.customers
  add column if not exists seller_id uuid references public.employees(id) on delete set null,
  add column if not exists advance_balance_gold_grams numeric(14, 4) not null default 0 check (advance_balance_gold_grams >= 0);

create index if not exists idx_customers_seller_org
  on public.customers (organization_id, seller_id);

-- -------------------------------------------------------------------------
-- 3. Seller Consignments (Zavod -> Sotuvchi Yuklamasi)
-- -------------------------------------------------------------------------
create table if not exists public.seller_consignments (
  id                           uuid primary key default gen_random_uuid(),
  organization_id              uuid not null references public.organizations(id) on delete cascade,
  consignment_no               text not null,
  seller_id                    uuid not null references public.employees(id) on delete restrict,
  product_id                   uuid references public.products(id) on delete set null,
  product_name                 text not null,
  quantity                     integer not null default 1 check (quantity > 0),
  base_weight_grams            numeric(14, 4) not null check (base_weight_grams > 0),
  proba                        numeric(6, 2) not null default 585 check (proba > 0 and proba <= 1000),
  factory_markup_pct           numeric(6, 2) not null default 0 check (factory_markup_pct >= 0),
  factory_gold_due_grams       numeric(14, 4) not null check (factory_gold_due_grams > 0),
  factory_settled_gold_grams   numeric(14, 4) not null default 0 check (factory_settled_gold_grams >= 0),
  factory_remaining_gold_grams numeric(14, 4) not null check (factory_remaining_gold_grams >= 0),
  sold_quantity                integer not null default 0 check (sold_quantity >= 0 and sold_quantity <= quantity),
  status                       text not null default 'held_by_seller'
                               check (status in ('held_by_seller', 'partially_sold', 'fully_sold', 'returned_to_factory', 'closed')),
  issued_at                    timestamptz not null default now(),
  idempotency_key              text unique,
  notes                        text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint uq_seller_consignments_tenant_no unique (organization_id, consignment_no)
);

create index if not exists idx_seller_consignments_seller
  on public.seller_consignments (organization_id, seller_id, status);

-- -------------------------------------------------------------------------
-- 4. Jewelry Sales (Sotuvchi -> Mijoz Savdosi)
-- -------------------------------------------------------------------------
create table if not exists public.jewelry_sales (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  sale_no                text not null,
  seller_id              uuid not null references public.employees(id) on delete restrict,
  customer_id            uuid not null references public.customers(id) on delete restrict,
  consignment_id         uuid references public.seller_consignments(id) on delete set null,
  product_id             uuid references public.products(id) on delete set null,
  product_name           text not null,
  quantity               integer not null default 1 check (quantity > 0),
  base_weight_grams      numeric(14, 4) not null check (base_weight_grams > 0),
  proba                  numeric(6, 2) not null default 585 check (proba > 0 and proba <= 1000),
  factory_markup_pct     numeric(6, 2) not null default 0 check (factory_markup_pct >= 0),
  factory_gold_due_grams numeric(14, 4) not null check (factory_gold_due_grams > 0),
  client_markup_pct      numeric(6, 2) not null default 0 check (client_markup_pct >= 0),
  client_gold_due_grams  numeric(14, 4) not null check (client_gold_due_grams > 0),
  markup_spread_grams    numeric(14, 4) not null,
  settled_gold_grams     numeric(14, 4) not null default 0 check (settled_gold_grams >= 0),
  remaining_gold_grams   numeric(14, 4) not null check (remaining_gold_grams >= 0),
  status                 text not null default 'open_debt'
                         check (status in ('open_debt', 'partially_paid', 'fully_paid')),
  sale_date              date not null default current_date,
  idempotency_key        text unique,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_jewelry_sales_tenant_no unique (organization_id, sale_no)
);

create index if not exists idx_jewelry_sales_seller_client
  on public.jewelry_sales (organization_id, seller_id, customer_id, status);

-- -------------------------------------------------------------------------
-- 5. Gold Settlements (Qaytimlar & To'lovlar - Pul va Lom Alohida)
-- -------------------------------------------------------------------------
create table if not exists public.gold_settlements (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  settlement_no          text not null,
  direction              text not null check (direction in ('client_to_seller', 'seller_to_factory')),
  seller_id              uuid not null references public.employees(id) on delete restrict,
  customer_id            uuid references public.customers(id) on delete set null,
  sale_id                uuid references public.jewelry_sales(id) on delete set null,
  consignment_id         uuid references public.seller_consignments(id) on delete set null,
  settlement_date        date not null default current_date,
  daily_rate_id          uuid references public.daily_gold_rates(id) on delete set null,
  gold_rate_applied      numeric(18, 2) not null check (gold_rate_applied > 0),
  scrap_weight_grams     numeric(14, 4) not null default 0 check (scrap_weight_grams >= 0),
  scrap_proba            numeric(6, 2) default 585 check (scrap_proba > 0 and scrap_proba <= 1000),
  cash_paid_amount       numeric(18, 2) not null default 0 check (cash_paid_amount >= 0),
  currency               text not null default 'UZS',
  cash_equivalent_grams  numeric(14, 4) not null default 0 check (cash_equivalent_grams >= 0),
  total_settled_grams    numeric(14, 4) not null check (total_settled_grams >= 0),
  applied_to_debt_grams  numeric(14, 4) not null default 0 check (applied_to_debt_grams >= 0),
  excess_gold_grams      numeric(14, 4) not null default 0 check (excess_gold_grams >= 0),
  previous_debt_grams    numeric(14, 4) not null check (previous_debt_grams >= 0),
  remaining_debt_grams   numeric(14, 4) not null check (remaining_debt_grams >= 0),
  notes                  text,
  recorded_by            uuid references public.employees(id) on delete set null,
  idempotency_key        text unique,
  created_at             timestamptz not null default now(),
  constraint uq_gold_settlements_tenant_no unique (organization_id, settlement_no),
  constraint chk_gold_settlement_has_payment check (scrap_weight_grams > 0 or cash_paid_amount > 0)
);

create index if not exists idx_gold_settlements_lookup
  on public.gold_settlements (organization_id, direction, seller_id, customer_id, settlement_date desc);

-- -------------------------------------------------------------------------
-- 6. Dual-Ledger Running Balances Tables
-- -------------------------------------------------------------------------
create table if not exists public.client_gold_accounts (
  customer_id                uuid primary key references public.customers(id) on delete cascade,
  organization_id            uuid not null references public.organizations(id) on delete cascade,
  seller_id                  uuid references public.employees(id) on delete set null,
  total_purchased_gold_grams numeric(14, 4) not null default 0 check (total_purchased_gold_grams >= 0),
  total_scrap_paid_grams     numeric(14, 4) not null default 0 check (total_scrap_paid_grams >= 0),
  total_cash_paid_amount     numeric(18, 2) not null default 0 check (total_cash_paid_amount >= 0),
  total_cash_equiv_grams     numeric(14, 4) not null default 0 check (total_cash_equiv_grams >= 0),
  total_settled_grams        numeric(14, 4) not null default 0 check (total_settled_grams >= 0),
  current_debt_grams         numeric(14, 4) not null default 0 check (current_debt_grams >= 0),
  advance_balance_grams      numeric(14, 4) not null default 0 check (advance_balance_grams >= 0),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.seller_gold_accounts (
  seller_id                             uuid primary key references public.employees(id) on delete cascade,
  organization_id                       uuid not null references public.organizations(id) on delete cascade,
  total_consigned_gold_grams            numeric(14, 4) not null default 0 check (total_consigned_gold_grams >= 0),
  total_factory_settled_gold_grams      numeric(14, 4) not null default 0 check (total_factory_settled_gold_grams >= 0),
  current_factory_obligation_grams      numeric(14, 4) not null default 0 check (current_factory_obligation_grams >= 0),
  seller_till_scrap_grams               numeric(14, 4) not null default 0 check (seller_till_scrap_grams >= 0),
  seller_till_cash_amount               numeric(18, 2) not null default 0 check (seller_till_cash_amount >= 0),
  total_client_debt_grams               numeric(14, 4) not null default 0 check (total_client_debt_grams >= 0),
  updated_at                            timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 7. Row Level Security Policies
-- -------------------------------------------------------------------------
alter table public.daily_gold_rates enable row level security;
alter table public.seller_consignments enable row level security;
alter table public.jewelry_sales enable row level security;
alter table public.gold_settlements enable row level security;
alter table public.client_gold_accounts enable row level security;
alter table public.seller_gold_accounts enable row level security;

-- A. daily_gold_rates RLS
create policy "daily_gold_rates_select_tenant"
  on public.daily_gold_rates for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "daily_gold_rates_admin_manage"
  on public.daily_gold_rates for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- B. seller_consignments RLS
create policy "seller_consignments_select_policy"
  on public.seller_consignments for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter')
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- C. jewelry_sales RLS
create policy "jewelry_sales_select_policy"
  on public.jewelry_sales for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter')
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- D. gold_settlements RLS
create policy "gold_settlements_select_policy"
  on public.gold_settlements for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter')
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- E. client_gold_accounts RLS
create policy "client_gold_accounts_select_policy"
  on public.client_gold_accounts for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter')
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- F. seller_gold_accounts RLS
create policy "seller_gold_accounts_select_policy"
  on public.seller_gold_accounts for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter')
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- -------------------------------------------------------------------------
-- 8. Atomic SECURITY DEFINER RPC Functions
-- -------------------------------------------------------------------------

-- A. rpc_set_daily_gold_rate
create or replace function public.rpc_set_daily_gold_rate(
  p_rate_per_gram   numeric,
  p_proba           numeric default 585,
  p_rate_date       date default current_date,
  p_currency        text default 'UZS',
  p_notes           text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_caller_id  uuid := auth.uid();
  v_rate_id    uuid;
  v_payload    jsonb;
  v_existing   jsonb;
  v_rate       numeric(18, 2) := round(coalesce(p_rate_per_gram, 0)::numeric, 2);
  v_pr         numeric(6, 2)  := round(coalesce(p_proba, 585)::numeric, 2);
  v_dt         date           := coalesce(p_rate_date, current_date);
  v_cur        text           := upper(coalesce(nullif(btrim(p_currency), ''), 'UZS'));
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar']);

  if v_rate <= 0 then
    raise exception 'Invalid rate: Gold rate per gram must be greater than 0';
  end if;

  v_payload := jsonb_build_object(
    'action', 'set_daily_gold_rate',
    'rate_date', v_dt,
    'proba', v_pr,
    'rate_per_gram', v_rate
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_set_daily_gold_rate', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.daily_gold_rates (
    organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed, set_by, notes, updated_at
  ) values (
    v_caller_org, v_dt, v_pr, v_rate, v_cur, true, v_caller_id, p_notes, now()
  )
  on conflict (organization_id, rate_date, proba)
  do update set
    rate_per_gram = excluded.rate_per_gram,
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
    'rate_per_gram', v_rate,
    'currency', v_cur
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_set_daily_gold_rate', v_existing, v_payload);
  return v_existing;
end;
$$;

-- B. rpc_register_or_get_customer
create or replace function public.rpc_register_or_get_customer(
  p_contact_name text,
  p_phone        text default null,
  p_company_name text default null,
  p_seller_id    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_cust       public.customers%rowtype;
  v_seller_uuid uuid := p_seller_id;
  v_clean_name text := btrim(coalesce(p_contact_name, ''));
  v_clean_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_code       text;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_clean_name = '' then
    raise exception 'Customer contact name cannot be empty';
  end if;

  -- Default seller to caller if not specified
  if v_seller_uuid is null then
    select id into v_seller_uuid
      from public.employees
     where (user_id = auth.uid() or id = auth.uid())
       and organization_id = v_caller_org
     limit 1;
  end if;

  -- Find by phone or unique customer code first
  if v_clean_phone is not null then
    select * into v_cust
      from public.customers
     where organization_id = v_caller_org
       and phone = v_clean_phone
     limit 1;
  end if;

  if v_cust.id is null then
    v_code := 'CUST-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

    insert into public.customers (
      organization_id, customer_code, contact_name, company_name, phone, seller_id, is_active
    ) values (
      v_caller_org, v_code, v_clean_name, nullif(btrim(coalesce(p_company_name, '')), ''), v_clean_phone, v_seller_uuid, true
    ) returning * into v_cust;

    -- Ensure client gold account row exists
    insert into public.client_gold_accounts (customer_id, organization_id, seller_id)
    values (v_cust.id, v_caller_org, v_seller_uuid)
    on conflict (customer_id) do nothing;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'customer_id', v_cust.id,
    'customer_code', v_cust.customer_code,
    'contact_name', v_cust.contact_name,
    'phone', v_cust.phone,
    'seller_id', v_cust.seller_id
  );
end;
$$;

-- C. rpc_issue_seller_consignment (Factory -> Seller)
create or replace function public.rpc_issue_seller_consignment(
  p_seller_id          uuid,
  p_product_id         uuid,
  p_quantity           integer default 1,
  p_factory_markup_pct numeric default 0,
  p_notes              text default null,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'warehouse', 'omborchi'
  ]);

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
$$;

-- D. rpc_record_client_jewelry_sale (Seller -> Client)
create or replace function public.rpc_record_client_jewelry_sale(
  p_customer_id     uuid,
  p_consignment_id  uuid,
  p_client_markup_pct numeric default 0,
  p_notes           text default null,
  p_idempotency_key text default null
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
  v_caller_emp_id   uuid;
  v_caller_role     text := public.current_employee_role_text();
  v_client_markup   numeric(6, 2) := round(coalesce(p_client_markup_pct, 0)::numeric, 2);
  v_client_gold_due numeric(14, 4);
  v_markup_spread   numeric(14, 4);
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

  if v_cons.status in ('fully_sold', 'returned_to_factory', 'closed') then
    raise exception 'Consignment % is already closed or sold', v_cons.consignment_no;
  end if;

  -- Ensure seller owns this consignment unless admin/director
  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar') then
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

  -- Strict Calculation Rules:
  -- Client Gold Due is calculated from BASE WEIGHT (never compound!):
  -- client_gold_due = round(base_weight * (1 + client_markup / 100), 4)
  v_client_gold_due := round((v_cons.base_weight_grams * (1.0 + v_client_markup / 100.0))::numeric, 4);

  -- Markup spread is strictly an accounting differential between client due and factory obligation:
  v_markup_spread := round((v_client_gold_due - v_cons.factory_gold_due_grams)::numeric, 4);

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
    0, v_client_gold_due, 'open_debt',
    current_date, nullif(btrim(p_idempotency_key), ''), p_notes
  ) returning id into v_sale_id;

  -- Update consignment status
  update public.seller_consignments
     set sold_quantity = quantity,
         status        = 'fully_sold',
         updated_at    = now()
   where id = v_cons.id;

  -- Update client running debt in client_gold_accounts
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams, current_debt_grams, updated_at
  ) values (
    v_cust.id, v_caller_org, v_cons.seller_id, v_client_gold_due, v_client_gold_due, now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_gold_due)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_client_gold_due)::numeric, 4),
    seller_id                  = coalesce(client_gold_accounts.seller_id, v_cons.seller_id),
    updated_at                 = now();

  -- Update seller's total client debt tracking
  insert into public.seller_gold_accounts (
    seller_id, organization_id, total_client_debt_grams, updated_at
  ) values (
    v_cons.seller_id, v_caller_org, v_client_gold_due, now()
  )
  on conflict (seller_id) do update set
    total_client_debt_grams = round((seller_gold_accounts.total_client_debt_grams + v_client_gold_due)::numeric, 4),
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
    'client_gold_due_grams', v_client_gold_due,
    'markup_spread_grams', v_markup_spread,
    'remaining_gold_debt', v_client_gold_due
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_jewelry_sale', v_existing, v_payload);
  return v_existing;
end;
$$;

-- E. rpc_record_client_settlement (Client -> Seller Payment/Scrap Return)
create or replace function public.rpc_record_client_settlement(
  p_customer_id      uuid,
  p_sale_id          uuid default null,
  p_scrap_weight     numeric default 0,
  p_scrap_proba      numeric default 585,
  p_cash_amount      numeric default 0,
  p_rate_per_gram    numeric default null,
  p_settlement_date  date default current_date,
  p_notes            text default null,
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org       uuid := public.current_organization_id();
  v_caller_emp_id    uuid;
  v_caller_role      text := public.current_employee_role_text();
  v_cust             public.customers%rowtype;
  v_sale             public.jewelry_sales%rowtype;
  v_daily_rate       public.daily_gold_rates%rowtype;
  v_rate_id          uuid;
  v_active_rate      numeric(18, 2);
  v_scrap_w          numeric(14, 4) := round(coalesce(p_scrap_weight, 0)::numeric, 4);
  v_cash             numeric(18, 2) := round(coalesce(p_cash_amount, 0)::numeric, 2);
  v_cash_equiv       numeric(14, 4) := 0;
  v_total_settled    numeric(14, 4);
  v_prev_debt        numeric(14, 4);
  v_applied_to_debt  numeric(14, 4);
  v_excess_gold      numeric(14, 4) := 0;
  v_new_rem_debt     numeric(14, 4);
  v_settlement_id    uuid;
  v_settlement_no    text;
  v_target_seller_id uuid;
  v_dt               date := coalesce(p_settlement_date, current_date);
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  select id into v_caller_emp_id
    from public.employees
   where (user_id = auth.uid() or id = auth.uid())
     and organization_id = v_caller_org
   limit 1;

  if v_scrap_w < 0 or v_cash < 0 then
    raise exception 'Payment scrap weight and cash amount cannot be negative';
  end if;
  if v_scrap_w = 0 and v_cash = 0 then
    raise exception 'Payment required: Please provide scrap gold weight or cash amount';
  end if;

  v_payload := jsonb_build_object(
    'action', 'client_settlement',
    'customer_id', p_customer_id,
    'sale_id', p_sale_id,
    'scrap_weight', v_scrap_w,
    'cash_amount', v_cash
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Lock customer
  select * into v_cust
    from public.customers
   where id = p_customer_id
     and organization_id = v_caller_org
   for update;
  if not found then
    raise exception 'Customer (%) not found in your organization', p_customer_id;
  end if;

  -- Resolve seller
  if p_sale_id is not null then
    select * into v_sale
      from public.jewelry_sales
     where id = p_sale_id
       and customer_id = p_customer_id
       and organization_id = v_caller_org
     for update;
    if not found then
      raise exception 'Sale (%) not found for customer', p_sale_id;
    end if;
    v_target_seller_id := v_sale.seller_id;
    v_prev_debt        := v_sale.remaining_gold_grams;
  else
    v_target_seller_id := coalesce(v_cust.seller_id, v_caller_emp_id);
    select coalesce(current_debt_grams, 0) into v_prev_debt
      from public.client_gold_accounts
     where customer_id = v_cust.id;
    v_prev_debt := coalesce(v_prev_debt, 0);
  end if;

  -- Seller boundary check
  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar') then
    if v_target_seller_id <> v_caller_emp_id then
      raise exception 'Cross-seller violation: You can only record settlements for your own clients' using errcode = '42501';
    end if;
  end if;

  -- Resolve daily rate
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_active_rate := round(p_rate_per_gram::numeric, 2);
  else
    select * into v_daily_rate
      from public.daily_gold_rates
     where organization_id = v_caller_org
       and rate_date = v_dt
       and proba = coalesce(p_scrap_proba, 585)
     limit 1;
    if not found then
      -- Fallback to latest confirmed rate
      select * into v_daily_rate
        from public.daily_gold_rates
       where organization_id = v_caller_org
         and proba = coalesce(p_scrap_proba, 585)
       order by rate_date desc
       limit 1;
    end if;
    if v_daily_rate.id is null then
      raise exception 'No daily gold scrap rate found for date %. Please set daily rate first.', v_dt;
    end if;
    v_active_rate := v_daily_rate.rate_per_gram;
    v_rate_id     := v_daily_rate.id;
  end if;

  -- Conversion: cash_equivalent_grams = cash_amount / active_rate
  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_active_rate)::numeric, 4);
  end if;

  v_total_settled := round((v_scrap_w + v_cash_equiv)::numeric, 4);

  -- Handle Debt Deduction and Excess (Rule 10: Avans va ortiqcha qaytimlar saqlanadi)
  if v_total_settled > v_prev_debt then
    v_applied_to_debt := v_prev_debt;
    v_excess_gold     := round((v_total_settled - v_prev_debt)::numeric, 4);
    v_new_rem_debt    := 0;
  else
    v_applied_to_debt := v_total_settled;
    v_excess_gold     := 0;
    v_new_rem_debt    := round((v_prev_debt - v_total_settled)::numeric, 4);
  end if;

  v_settlement_no := 'SETTL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id, customer_id, sale_id,
    settlement_date, daily_rate_id, gold_rate_applied,
    scrap_weight_grams, scrap_proba, cash_paid_amount, currency,
    cash_equivalent_grams, total_settled_grams,
    applied_to_debt_grams, excess_gold_grams,
    previous_debt_grams, remaining_debt_grams,
    notes, recorded_by, idempotency_key
  ) values (
    v_caller_org, v_settlement_no, 'client_to_seller', v_target_seller_id, v_cust.id, p_sale_id,
    v_dt, v_rate_id, v_active_rate,
    v_scrap_w, coalesce(p_scrap_proba, 585), v_cash, 'UZS',
    v_cash_equiv, v_total_settled,
    v_applied_to_debt, v_excess_gold,
    v_prev_debt, v_new_rem_debt,
    p_notes, v_caller_emp_id, nullif(btrim(p_idempotency_key), '')
  ) returning id into v_settlement_id;

  -- Update specific sale if linked
  if p_sale_id is not null then
    update public.jewelry_sales
       set settled_gold_grams   = round((settled_gold_grams + v_applied_to_debt)::numeric, 4),
           remaining_gold_grams = v_new_rem_debt,
           status               = case when v_new_rem_debt = 0 then 'fully_paid' else 'partially_paid' end,
           updated_at           = now()
     where id = v_sale.id;
  end if;

  -- Update client running balance in client_gold_accounts
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id,
    total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams,
    total_settled_grams, current_debt_grams, advance_balance_grams, updated_at
  ) values (
    v_cust.id, v_caller_org, v_target_seller_id,
    v_scrap_w, v_cash, v_cash_equiv,
    v_total_settled, v_new_rem_debt, v_excess_gold, now()
  )
  on conflict (customer_id) do update set
    total_scrap_paid_grams = round((client_gold_accounts.total_scrap_paid_grams + v_scrap_w)::numeric, 4),
    total_cash_paid_amount = round((client_gold_accounts.total_cash_paid_amount + v_cash)::numeric, 2),
    total_cash_equiv_grams = round((client_gold_accounts.total_cash_equiv_grams + v_cash_equiv)::numeric, 4),
    total_settled_grams    = round((client_gold_accounts.total_settled_grams + v_total_settled)::numeric, 4),
    current_debt_grams     = case
                               when p_sale_id is not null then
                                 greatest(0, round((client_gold_accounts.current_debt_grams - v_applied_to_debt)::numeric, 4))
                               else v_new_rem_debt
                             end,
    advance_balance_grams  = round((client_gold_accounts.advance_balance_grams + v_excess_gold)::numeric, 4),
    updated_at             = now();

  -- Rule 5: Money and scrap enter SELLER'S TILL (not factory yet!)
  insert into public.seller_gold_accounts (
    seller_id, organization_id, seller_till_scrap_grams, seller_till_cash_amount, updated_at
  ) values (
    v_target_seller_id, v_caller_org, v_scrap_w, v_cash, now()
  )
  on conflict (seller_id) do update set
    seller_till_scrap_grams = round((seller_gold_accounts.seller_till_scrap_grams + v_scrap_w)::numeric, 4),
    seller_till_cash_amount = round((seller_gold_accounts.seller_till_cash_amount + v_cash)::numeric, 2),
    total_client_debt_grams = greatest(0, round((seller_gold_accounts.total_client_debt_grams - v_applied_to_debt)::numeric, 4)),
    updated_at              = now();

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settlement_id,
    'settlement_no', v_settlement_no,
    'customer_id', v_cust.id,
    'direction', 'client_to_seller',
    'gold_rate_applied', v_active_rate,
    'scrap_weight_grams', v_scrap_w,
    'cash_paid_amount', v_cash,
    'cash_equivalent_grams', v_cash_equiv,
    'total_settled_grams', v_total_settled,
    'applied_to_debt_grams', v_applied_to_debt,
    'excess_gold_grams', v_excess_gold,
    'previous_debt_grams', v_prev_debt,
    'remaining_debt_grams', v_new_rem_debt
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_settlement', v_existing, v_payload);
  return v_existing;
end;
$$;

-- F. rpc_record_seller_to_factory_settlement (Seller -> Factory Surrender)
create or replace function public.rpc_record_seller_to_factory_settlement(
  p_seller_id        uuid,
  p_scrap_weight     numeric default 0,
  p_cash_amount      numeric default 0,
  p_rate_per_gram    numeric default null,
  p_settlement_date  date default current_date,
  p_notes            text default null,
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org       uuid := public.current_organization_id();
  v_caller_emp_id    uuid;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_daily_rate       public.daily_gold_rates%rowtype;
  v_rate_id          uuid;
  v_active_rate      numeric(18, 2);
  v_scrap_w          numeric(14, 4) := round(coalesce(p_scrap_weight, 0)::numeric, 4);
  v_cash             numeric(18, 2) := round(coalesce(p_cash_amount, 0)::numeric, 2);
  v_cash_equiv       numeric(14, 4) := 0;
  v_total_surrender  numeric(14, 4);
  v_prev_obligation  numeric(14, 4);
  v_new_obligation   numeric(14, 4);
  v_settlement_id    uuid;
  v_settlement_no    text;
  v_dt               date := coalesce(p_settlement_date, current_date);
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'warehouse', 'omborchi'
  ]);

  if v_scrap_w < 0 or v_cash < 0 then
    raise exception 'Surrender amounts cannot be negative';
  end if;
  if v_scrap_w = 0 and v_cash = 0 then
    raise exception 'Please specify scrap gold weight or cash amount to surrender to factory';
  end if;

  v_payload := jsonb_build_object(
    'action', 'seller_to_factory_surrender',
    'seller_id', p_seller_id,
    'scrap_weight', v_scrap_w,
    'cash_amount', v_cash
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_seller_to_factory_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Lock seller gold account
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = p_seller_id
     and organization_id = v_caller_org
   for update;
  if not found then
    raise exception 'Seller account (%) not found', p_seller_id;
  end if;

  -- Resolve rate
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_active_rate := round(p_rate_per_gram::numeric, 2);
  else
    select * into v_daily_rate
      from public.daily_gold_rates
     where organization_id = v_caller_org
       and rate_date = v_dt
     order by rate_date desc
     limit 1;
    if v_daily_rate.id is null then
      raise exception 'No daily rate found for factory surrender';
    end if;
    v_active_rate := v_daily_rate.rate_per_gram;
    v_rate_id     := v_daily_rate.id;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_active_rate)::numeric, 4);
  end if;

  v_total_surrender := round((v_scrap_w + v_cash_equiv)::numeric, 4);
  v_prev_obligation := v_seller_acc.current_factory_obligation_grams;

  if v_total_surrender > v_prev_obligation then
    v_new_obligation := 0;
  else
    v_new_obligation := round((v_prev_obligation - v_total_surrender)::numeric, 4);
  end if;

  v_settlement_no := 'SURR-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id,
    settlement_date, daily_rate_id, gold_rate_applied,
    scrap_weight_grams, cash_paid_amount, currency,
    cash_equivalent_grams, total_settled_grams,
    applied_to_debt_grams, excess_gold_grams,
    previous_debt_grams, remaining_debt_grams,
    notes, recorded_by, idempotency_key
  ) values (
    v_caller_org, v_settlement_no, 'seller_to_factory', p_seller_id,
    v_dt, v_rate_id, v_active_rate,
    v_scrap_w, v_cash, 'UZS',
    v_cash_equiv, v_total_surrender,
    least(v_total_surrender, v_prev_obligation), greatest(0, v_total_surrender - v_prev_obligation),
    v_prev_obligation, v_new_obligation,
    p_notes, auth.uid(), nullif(btrim(p_idempotency_key), '')
  ) returning id into v_settlement_id;

  -- Deduct from seller till and reduce factory obligation
  update public.seller_gold_accounts
     set total_factory_settled_gold_grams = round((total_factory_settled_gold_grams + v_total_surrender)::numeric, 4),
         current_factory_obligation_grams = v_new_obligation,
         seller_till_scrap_grams          = greatest(0, round((seller_till_scrap_grams - v_scrap_w)::numeric, 4)),
         seller_till_cash_amount          = greatest(0, round((seller_till_cash_amount - v_cash)::numeric, 2)),
         updated_at                       = now()
   where seller_id = p_seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settlement_id,
    'settlement_no', v_settlement_no,
    'direction', 'seller_to_factory',
    'seller_id', p_seller_id,
    'surrendered_gold_grams', v_total_surrender,
    'previous_obligation', v_prev_obligation,
    'remaining_obligation', v_new_obligation
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_seller_to_factory_settlement', v_existing, v_payload);
  return v_existing;
end;
$$;

-- G. rpc_get_seller_sales_summary
create or replace function public.rpc_get_seller_sales_summary(
  p_seller_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  if v_seller_uuid is null or v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar') then
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
$$;

-- H. rpc_get_director_sales_overview
create or replace function public.rpc_get_director_sales_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter'
  ]);

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
$$;

-- Grant execution permissions on all RPCs to authenticated role
grant execute on function public.rpc_set_daily_gold_rate(numeric, numeric, date, text, text, text) to authenticated;
grant execute on function public.rpc_register_or_get_customer(text, text, text, uuid) to authenticated;
grant execute on function public.rpc_issue_seller_consignment(uuid, uuid, integer, numeric, text, text) to authenticated;
grant execute on function public.rpc_record_client_jewelry_sale(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text) to authenticated;
grant execute on function public.rpc_record_seller_to_factory_settlement(uuid, numeric, numeric, numeric, date, text, text) to authenticated;
grant execute on function public.rpc_get_seller_sales_summary(uuid) to authenticated;
grant execute on function public.rpc_get_director_sales_overview() to authenticated;
