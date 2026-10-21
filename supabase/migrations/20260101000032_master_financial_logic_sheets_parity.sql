-- =========================================================================
-- JewelryFlow ERP — Migration 032
-- Master Financial Logic Fix: Complete Sheets-Parity, Separate Vaults & 3-Tier Debt Ledgers
-- =========================================================================
-- Implements:
-- 1. FACTORY -> MANAGER -> SELLER -> CUSTOMER -> TILL -> VAULT -> FACTORY Chain
-- 2. Three distinct debt relationships:
--    a. Customer owes Seller (client_gold_accounts)
--    b. Seller owes Manager (seller_gold_accounts with signed 'bozor_qarzi')
--    c. Manager owes Factory (manager_vault_account & factory_receipts)
-- 3. Non-compounding markups calculated strictly from original physical weight
-- 4. Refining batches ("Lom pateriya") with loss borne exclusively by manager
-- 5. Gold purchase with cash ("Tovar olish") consuming manager cash
-- 6. Confirmed factory handover as the exclusive mechanism to reduce factory debt
-- 7. Full automated reconciliation view and invariants
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Manager Vault & Financial Account (Boshqaruvchi Kassasi & Balansi)
-- -------------------------------------------------------------------------
create table if not exists public.manager_vault_account (
  organization_id              uuid primary key references public.organizations(id) on delete cascade,
  manager_scrap_grams          numeric(14, 4) not null default 0 check (manager_scrap_grams >= 0),
  manager_cash_amount          numeric(18, 2) not null default 0 check (manager_cash_amount >= 0),
  manager_refined_gold_grams   numeric(14, 4) not null default 0 check (manager_refined_gold_grams >= 0),
  manager_purchased_gold_grams numeric(14, 4) not null default 0 check (manager_purchased_gold_grams >= 0),
  total_factory_received_g     numeric(14, 4) not null default 0 check (total_factory_received_g >= 0),
  total_factory_obligation_g   numeric(14, 4) not null default 0 check (total_factory_obligation_g >= 0),
  total_factory_handed_over_g  numeric(14, 4) not null default 0 check (total_factory_handed_over_g >= 0),
  current_factory_obligation_g numeric(14, 4) not null default 0 check (current_factory_obligation_g >= 0),
  updated_at                   timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 2. Factory Receipts ("Zavod bilan" — Zavoddan Boshqaruvchiga Tovar Kirishi)
-- -------------------------------------------------------------------------
create table if not exists public.factory_receipts (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  receipt_no             text not null,
  receipt_date           date not null default current_date,
  product_id             uuid references public.products(id) on delete set null,
  model_id               uuid references public.jewelry_models(id) on delete set null,
  product_name           text not null,
  proba                  numeric(6, 2) not null default 585 check (proba > 0 and proba <= 1000),
  quantity               integer not null default 1 check (quantity > 0),
  original_physical_g    numeric(14, 4) not null check (original_physical_g > 0),
  factory_markup_pct     numeric(6, 2) not null default 0 check (factory_markup_pct >= 0),
  factory_obligation_g   numeric(14, 4) not null check (factory_obligation_g > 0),
  transferred_physical_g numeric(14, 4) not null default 0 check (transferred_physical_g >= 0 and transferred_physical_g <= original_physical_g),
  available_physical_g   numeric(14, 4) not null check (available_physical_g >= 0),
  status                 text not null default 'in_manager_stock'
                         check (status in ('in_manager_stock', 'partially_transferred', 'fully_transferred', 'returned_to_factory')),
  notes                  text,
  idempotency_key        text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_factory_receipts_tenant_no unique (organization_id, receipt_no)
);

create index if not exists idx_factory_receipts_tenant_status
  on public.factory_receipts (organization_id, status, receipt_date desc);

-- -------------------------------------------------------------------------
-- 3. Refining Batches ("Lom pateriya" — Afinaj va Yo'qotish Jurnali)
-- -------------------------------------------------------------------------
create table if not exists public.refining_batches (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  batch_no               text not null,
  batch_date             date not null default current_date,
  input_scrap_grams      numeric(14, 4) not null check (input_scrap_grams > 0),
  melted_weight_grams    numeric(14, 4) not null check (melted_weight_grams > 0 and melted_weight_grams <= input_scrap_grams),
  output_fine_grams      numeric(14, 4) not null check (output_fine_grams > 0),
  output_fine_proba      numeric(6, 2) not null default 999 check (output_fine_proba > 0 and output_fine_proba <= 1000),
  output_585_equiv_grams numeric(14, 4) not null check (output_585_equiv_grams > 0),
  total_loss_grams       numeric(14, 4) not null default 0 check (total_loss_grams >= 0),
  loss_pct               numeric(6, 3) not null default 0 check (loss_pct >= 0),
  operator_id            uuid references public.employees(id) on delete set null,
  status                 text not null default 'completed' check (status in ('pending', 'completed', 'cancelled')),
  notes                  text,
  idempotency_key        text unique,
  created_at             timestamptz not null default now(),
  constraint uq_refining_batches_tenant_no unique (organization_id, batch_no)
);

create index if not exists idx_refining_batches_tenant_date
  on public.refining_batches (organization_id, batch_date desc);

-- -------------------------------------------------------------------------
-- 4. Gold Purchases ("Tovar olish" — Naqd Pulga Oltin Xarid Qilish)
-- -------------------------------------------------------------------------
create table if not exists public.gold_purchases (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  purchase_no       text not null,
  purchase_date     date not null default current_date,
  supplier_name     text not null,
  cash_spent_uzs    numeric(18, 2) not null check (cash_spent_uzs > 0),
  rate_per_gram     numeric(18, 2) not null check (rate_per_gram > 0),
  gold_weight_grams numeric(14, 4) not null check (gold_weight_grams > 0),
  proba             numeric(6, 2) not null default 585 check (proba > 0 and proba <= 1000),
  equiv_585_grams   numeric(14, 4) not null check (equiv_585_grams > 0),
  payment_method    text not null default 'cash',
  notes             text,
  idempotency_key   text unique,
  recorded_by       uuid references public.employees(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint uq_gold_purchases_tenant_no unique (organization_id, purchase_no)
);

create index if not exists idx_gold_purchases_tenant_date
  on public.gold_purchases (organization_id, purchase_date desc);

-- -------------------------------------------------------------------------
-- 5. Factory Gold Handovers ("Zavodga topshirish" — Zavod Qarzini Kamaytiruvchi Hodisa)
-- -------------------------------------------------------------------------
create table if not exists public.factory_gold_handovers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  handover_no         text not null,
  handover_date       date not null default current_date,
  source_type         text not null check (source_type in ('refined_gold', 'purchased_gold', 'scrap_gold')),
  physical_weight_g   numeric(14, 4) not null check (physical_weight_g > 0),
  proba               numeric(6, 2) not null check (proba > 0 and proba <= 1000),
  agreed_equivalent_g numeric(14, 4) not null check (agreed_equivalent_g > 0),
  factory_recipient   text not null default 'Zavod',
  factory_accepted    boolean not null default true,
  notes               text,
  idempotency_key     text unique,
  recorded_by         uuid references public.employees(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint uq_factory_gold_handovers_tenant_no unique (organization_id, handover_no)
);

create index if not exists idx_factory_gold_handovers_tenant_date
  on public.factory_gold_handovers (organization_id, handover_date desc);

-- -------------------------------------------------------------------------
-- 6. Enhance Seller Consignments & Seller Gold Accounts
-- -------------------------------------------------------------------------
alter table public.seller_consignments
  add column if not exists factory_receipt_id uuid references public.factory_receipts(id) on delete set null,
  add column if not exists seller_markup_pct numeric(6, 2) default 12.0,
  add column if not exists seller_obligation_g numeric(14, 4);

-- Populate seller_obligation_g if null
update public.seller_consignments
set seller_markup_pct = coalesce(seller_markup_pct, 12.0),
    seller_obligation_g = coalesce(seller_obligation_g, round(base_weight_grams * (1 + coalesce(seller_markup_pct, 12.0) / 100.0), 4))
where seller_obligation_g is null;

alter table public.seller_gold_accounts
  add column if not exists total_transferred_physical_g numeric(14, 4) not null default 0,
  add column if not exists total_seller_obligation_g numeric(14, 4) not null default 0,
  add column if not exists total_settled_to_manager_g numeric(14, 4) not null default 0,
  add column if not exists seller_owes_manager_g numeric(14, 4) not null default 0,
  add column if not exists manager_owes_seller_g numeric(14, 4) not null default 0,
  add column if not exists bozor_qarzi_signed_g numeric(14, 4) not null default 0;

-- Update direction constraint on gold_settlements
alter table public.gold_settlements drop constraint if exists gold_settlements_direction_check;
alter table public.gold_settlements
  add constraint gold_settlements_direction_check
  check (direction in ('client_to_seller', 'seller_to_manager', 'seller_to_factory', 'manager_to_factory'));

-- -------------------------------------------------------------------------
-- 7. RLS Policies
-- -------------------------------------------------------------------------
alter table public.manager_vault_account enable row level security;
alter table public.factory_receipts enable row level security;
alter table public.refining_batches enable row level security;
alter table public.gold_purchases enable row level security;
alter table public.factory_gold_handovers enable row level security;
alter table public.seller_consignments force row level security;
alter table public.jewelry_sales force row level security;
alter table public.gold_settlements force row level security;
alter table public.factory_receipts force row level security;
alter table public.manager_vault_account force row level security;

create policy "manager_vault_account_all_policy"
  on public.manager_vault_account for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "factory_receipts_all_policy"
  on public.factory_receipts for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "refining_batches_all_policy"
  on public.refining_batches for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "gold_purchases_all_policy"
  on public.gold_purchases for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "factory_gold_handovers_all_policy"
  on public.factory_gold_handovers for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

grant all on table public.manager_vault_account to authenticated, service_role;
grant all on table public.factory_receipts to authenticated, service_role;
grant all on table public.refining_batches to authenticated, service_role;
grant all on table public.gold_purchases to authenticated, service_role;
grant all on table public.factory_gold_handovers to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 8. SECURITY DEFINER RPCs for Master Financial Logic
-- -------------------------------------------------------------------------

-- Helper: Ensure manager_vault_account row exists
create or replace function public._get_or_create_manager_vault(p_org_id uuid)
returns public.manager_vault_account
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vault public.manager_vault_account;
begin
  select * into v_vault from public.manager_vault_account where organization_id = p_org_id;
  if not found then
    insert into public.manager_vault_account (organization_id)
    values (p_org_id)
    on conflict (organization_id) do update set updated_at = now()
    returning * into v_vault;
  end if;
  return v_vault;
end;
$$;

-- A. rpc_record_factory_receipt ("Zavod bilan" — Zavoddan tovar qabul qilish)
create or replace function public.rpc_record_factory_receipt(
  p_product_name       text,
  p_quantity           integer default 1,
  p_original_physical_g numeric default 0,
  p_proba              numeric default 585,
  p_factory_markup_pct numeric default 8.0,
  p_product_id         uuid default null,
  p_model_id           uuid default null,
  p_notes              text default null,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id        uuid := public.current_organization_id();
  v_caller_id     uuid := auth.uid();
  v_receipt_no    text;
  v_receipt_id    uuid;
  v_phys_g        numeric(14, 4);
  v_f_pct         numeric(6, 2);
  v_f_due_g       numeric(14, 4);
  v_vault         public.manager_vault_account;
  v_existing      jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'inventory_manager']);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'receipt_id', id,
      'receipt_no', receipt_no,
      'factory_obligation_g', factory_obligation_g
    ) into v_existing
    from public.factory_receipts
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_phys_g := round(coalesce(p_original_physical_g, 0)::numeric, 4);
  v_f_pct := round(greatest(0, coalesce(p_factory_markup_pct, 0))::numeric, 2);

  if v_phys_g <= 0 then
    raise exception 'Invalid physical weight: must be greater than 0';
  end if;

  -- Formula: factory_obligation_g = original_physical_g * (1 + factory_markup_pct / 100)
  v_f_due_g := round(v_phys_g * (1.0 + (v_f_pct / 100.0)), 4);
  v_receipt_no := 'ZVD-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.factory_receipts (
    organization_id,
    receipt_no,
    product_id,
    model_id,
    product_name,
    proba,
    quantity,
    original_physical_g,
    factory_markup_pct,
    factory_obligation_g,
    transferred_physical_g,
    available_physical_g,
    status,
    notes,
    idempotency_key
  ) values (
    v_org_id,
    v_receipt_no,
    p_product_id,
    p_model_id,
    coalesce(nullif(btrim(p_product_name), ''), 'Zargarlik buyumi'),
    coalesce(p_proba, 585),
    greatest(1, coalesce(p_quantity, 1)),
    v_phys_g,
    v_f_pct,
    v_f_due_g,
    0,
    v_phys_g,
    'in_manager_stock',
    p_notes,
    p_idempotency_key
  ) returning id into v_receipt_id;

  -- Update manager vault factory obligation
  perform public._get_or_create_manager_vault(v_org_id);

  update public.manager_vault_account
  set total_factory_received_g = round(total_factory_received_g + v_phys_g, 4),
      total_factory_obligation_g = round(total_factory_obligation_g + v_f_due_g, 4),
      current_factory_obligation_g = round(greatest(0, (total_factory_obligation_g + v_f_due_g) - total_factory_handed_over_g), 4),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  return jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'original_physical_g', v_phys_g,
    'factory_markup_pct', v_f_pct,
    'factory_obligation_g', v_f_due_g,
    'manager_current_factory_obligation_g', v_vault.current_factory_obligation_g
  );
end;
$$;

-- B. rpc_transfer_to_seller ("O'tush" — Boshqaruvchi omboridan sotuvchiga tovar berish)
create or replace function public.rpc_transfer_to_seller(
  p_seller_id           uuid,
  p_original_physical_g numeric,
  p_seller_markup_pct   numeric default 12.0,
  p_factory_markup_pct  numeric default 8.0,
  p_product_name        text default 'Zargarlik buyumi',
  p_quantity            integer default 1,
  p_factory_receipt_id  uuid default null,
  p_product_id          uuid default null,
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

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'inventory_manager']);

  -- Verify seller is not director/admin
  select lower(coalesce(role::text, '')) into v_seller_role
  from public.employees
  where id = p_seller_id and organization_id = v_org_id;

  if v_seller_role is null then
    raise exception 'Seller not found or does not belong to active organization';
  end if;

  if v_seller_role in ('admin', 'director', 'owner', 'direktor', 'rahbar') then
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

  v_consign_no := 'CNS-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

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
$$;

-- C. rpc_record_seller_to_manager_settlement (Sotuvchi Boshqaruvchiga Pul va Lom topshirishi)
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
  v_caller_id       uuid := auth.uid();
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

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'sales', 'seller']);

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
      v_rate := 900000; -- standard default
    end if;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  end if;

  v_total_settled := round(v_scrap_w + v_cash_equiv, 4);

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
    v_caller_id,
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

-- D. rpc_record_refining_batch ("Lom pateriya" — Afinaj va Pateriya Yo'qotishi)
create or replace function public.rpc_record_refining_batch(
  p_input_scrap_grams   numeric,
  p_melted_weight_grams numeric,
  p_output_fine_grams   numeric,
  p_output_fine_proba   numeric default 999.0,
  p_operator_id         uuid default null,
  p_notes               text default null,
  p_idempotency_key     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'inventory_manager']);

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
  v_out_proba := round(coalesce(p_output_fine_proba, 999.0)::numeric, 2);

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
    raise exception 'Insufficient manager scrap gold: available %g, needed %g',
      v_vault.manager_scrap_grams, v_in_w;
  end if;

  -- Deduct scrap, add refined gold. Loss is borne exclusively by manager!
  update public.manager_vault_account
  set manager_scrap_grams = round(manager_scrap_grams - v_in_w, 4),
      manager_refined_gold_grams = round(manager_refined_gold_grams + v_out_585_eq, 4),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  v_batch_no := 'REF-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.refining_batches (
    organization_id,
    batch_no,
    input_scrap_grams,
    melted_weight_grams,
    output_fine_grams,
    output_fine_proba,
    output_585_equiv_grams,
    total_loss_grams,
    loss_pct,
    operator_id,
    status,
    notes,
    idempotency_key
  ) values (
    v_org_id,
    v_batch_no,
    v_in_w,
    v_melt_w,
    v_out_fine_g,
    v_out_proba,
    v_out_585_eq,
    v_loss_g,
    v_loss_pct,
    coalesce(p_operator_id, v_caller_id),
    'completed',
    p_notes,
    p_idempotency_key
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
    'manager_refined_gold_grams', v_vault.manager_refined_gold_grams
  );
end;
$$;

-- E. rpc_record_gold_purchase ("Tovar olish" — Naqd Pulga Oltin Xarid Qilish)
create or replace function public.rpc_record_gold_purchase(
  p_supplier_name     text,
  p_cash_spent_uzs    numeric,
  p_rate_per_gram     numeric,
  p_gold_weight_grams numeric,
  p_proba             numeric default 585.0,
  p_notes             text default null,
  p_idempotency_key   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id         uuid := public.current_organization_id();
  v_caller_id      uuid := auth.uid();
  v_cash_spent     numeric(18, 2);
  v_rate           numeric(18, 2);
  v_gold_w         numeric(14, 4);
  v_pr             numeric(6, 2);
  v_equiv_585      numeric(14, 4);
  v_purch_no       text;
  v_purch_id       uuid;
  v_vault          public.manager_vault_account;
  v_existing       jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'inventory_manager']);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'purchase_id', id,
      'purchase_no', purchase_no,
      'gold_weight_grams', gold_weight_grams
    ) into v_existing
    from public.gold_purchases
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_cash_spent := round(coalesce(p_cash_spent_uzs, 0)::numeric, 2);
  v_rate := round(coalesce(p_rate_per_gram, 0)::numeric, 2);
  v_gold_w := round(coalesce(p_gold_weight_grams, 0)::numeric, 4);
  v_pr := round(coalesce(p_proba, 585.0)::numeric, 2);

  if v_cash_spent <= 0 or v_gold_w <= 0 or v_rate <= 0 then
    raise exception 'Invalid purchase parameters: cash spent, rate and gold weight must be > 0';
  end if;

  v_equiv_585 := round(v_gold_w * (v_pr / 585.0), 4);

  -- Check manager cash
  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  if v_vault.manager_cash_amount < v_cash_spent then
    raise exception 'Insufficient manager cash in vault: available % UZS, required % UZS',
      v_vault.manager_cash_amount, v_cash_spent;
  end if;

  -- Deduct cash, add purchased gold
  update public.manager_vault_account
  set manager_cash_amount = round(manager_cash_amount - v_cash_spent, 2),
      manager_purchased_gold_grams = round(manager_purchased_gold_grams + v_equiv_585, 4),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  v_purch_no := 'BUY-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_purchases (
    organization_id,
    purchase_no,
    supplier_name,
    cash_spent_uzs,
    rate_per_gram,
    gold_weight_grams,
    proba,
    equiv_585_grams,
    payment_method,
    notes,
    idempotency_key,
    recorded_by
  ) values (
    v_org_id,
    v_purch_no,
    coalesce(nullif(btrim(p_supplier_name), ''), 'Bozor / Yetkazib beruvchi'),
    v_cash_spent,
    v_rate,
    v_gold_w,
    v_pr,
    v_equiv_585,
    'cash',
    p_notes,
    p_idempotency_key,
    v_caller_id
  ) returning id into v_purch_id;

  return jsonb_build_object(
    'status', 'ok',
    'purchase_id', v_purch_id,
    'purchase_no', v_purch_no,
    'cash_spent_uzs', v_cash_spent,
    'gold_weight_grams', v_gold_w,
    'equiv_585_grams', v_equiv_585,
    'manager_remaining_cash_amount', v_vault.manager_cash_amount,
    'manager_purchased_gold_grams', v_vault.manager_purchased_gold_grams
  );
end;
$$;

-- F. rpc_record_factory_gold_handover ("Zavodga topshirish" — Faqat shu zavod qarzini kamaytiradi!)
create or replace function public.rpc_record_factory_gold_handover(
  p_source_type         text,
  p_physical_weight_g   numeric,
  p_proba               numeric default 585.0,
  p_agreed_equivalent_g numeric default null,
  p_factory_recipient   text default 'Zavod',
  p_notes               text default null,
  p_idempotency_key     text default null
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
  v_handover_no    text;
  v_handover_id    uuid;
  v_vault          public.manager_vault_account;
  v_existing       jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter']);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'handover_id', id,
      'handover_no', handover_no,
      'agreed_equivalent_g', agreed_equivalent_g
    ) into v_existing
    from public.factory_gold_handovers
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_phys_w := round(coalesce(p_physical_weight_g, 0)::numeric, 4);
  v_pr := round(coalesce(p_proba, 585.0)::numeric, 2);

  if v_phys_w <= 0 then
    raise exception 'Invalid physical weight: must be > 0';
  end if;

  if p_agreed_equivalent_g is not null and p_agreed_equivalent_g > 0 then
    v_agreed_eq := round(p_agreed_equivalent_g::numeric, 4);
  else
    v_agreed_eq := round(v_phys_w * (v_pr / 585.0), 4);
  end if;

  -- Validate source type
  if p_source_type not in ('refined_gold', 'purchased_gold', 'scrap_gold') then
    raise exception 'Invalid source_type: must be refined_gold, purchased_gold, or scrap_gold';
  end if;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  -- Deduct from corresponding manager holding
  if p_source_type = 'refined_gold' then
    if v_vault.manager_refined_gold_grams < v_agreed_eq then
      raise exception 'Insufficient refined gold in manager holdings: available %g, needed %g',
        v_vault.manager_refined_gold_grams, v_agreed_eq;
    end if;
    update public.manager_vault_account
    set manager_refined_gold_grams = round(manager_refined_gold_grams - v_agreed_eq, 4)
    where organization_id = v_org_id;

  elsif p_source_type = 'purchased_gold' then
    if v_vault.manager_purchased_gold_grams < v_agreed_eq then
      raise exception 'Insufficient purchased gold in manager holdings: available %g, needed %g',
        v_vault.manager_purchased_gold_grams, v_agreed_eq;
    end if;
    update public.manager_vault_account
    set manager_purchased_gold_grams = round(manager_purchased_gold_grams - v_agreed_eq, 4)
    where organization_id = v_org_id;

  elsif p_source_type = 'scrap_gold' then
    if v_vault.manager_scrap_grams < v_phys_w then
      raise exception 'Insufficient scrap gold in manager holdings: available %g, needed %g',
        v_vault.manager_scrap_grams, v_phys_w;
    end if;
    update public.manager_vault_account
    set manager_scrap_grams = round(manager_scrap_grams - v_phys_w, 4)
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
    p_source_type,
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
    'source_type', p_source_type,
    'physical_weight_g', v_phys_w,
    'agreed_equivalent_g', v_agreed_eq,
    'total_factory_handed_over_g', v_vault.total_factory_handed_over_g,
    'current_factory_obligation_g', v_vault.current_factory_obligation_g
  );
end;
$$;

-- G. rpc_get_financial_reconciliation_summary (Barcha Invariantlar va Balanslar Hisoboti)
create or replace function public.rpc_get_financial_reconciliation_summary()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

-- -------------------------------------------------------------------------
-- 9. Automatic Ledger Sync Trigger for Seller Balances and Bozor Qarzi
-- -------------------------------------------------------------------------
create or replace function public.fn_sync_seller_gold_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller_id  uuid := coalesce(NEW.seller_id, OLD.seller_id);
  v_org_id     uuid := coalesce(NEW.organization_id, OLD.organization_id);
  v_total_phys numeric(14, 4);
  v_total_obl  numeric(14, 4);
  v_total_stl  numeric(14, 4);
  v_s_owes     numeric(14, 4);
  v_m_owes     numeric(14, 4);
  v_signed     numeric(14, 4);
begin
  if v_seller_id is null or v_org_id is null then
    return coalesce(NEW, OLD);
  end if;

  select
    coalesce(sum(base_weight_grams), 0),
    coalesce(sum(coalesce(seller_obligation_g, factory_gold_due_grams)), 0)
  into v_total_phys, v_total_obl
  from public.seller_consignments
  where seller_id = v_seller_id and organization_id = v_org_id
    and status in ('held_by_seller', 'partially_sold', 'fully_sold');

  select coalesce(sum(total_settled_grams), 0)
  into v_total_stl
  from public.gold_settlements
  where seller_id = v_seller_id and organization_id = v_org_id
    and direction in ('seller_to_manager', 'seller_to_factory');

  v_s_owes := round(greatest(0, v_total_obl - v_total_stl), 4);
  v_m_owes := round(greatest(0, v_total_stl - v_total_obl), 4);
  v_signed := round(v_m_owes - v_s_owes, 4);

  insert into public.seller_gold_accounts (
    seller_id, organization_id,
    total_transferred_physical_g, total_seller_obligation_g,
    total_settled_to_manager_g, seller_owes_manager_g,
    manager_owes_seller_g, bozor_qarzi_signed_g,
    total_consigned_gold_grams, current_factory_obligation_grams,
    updated_at
  ) values (
    v_seller_id, v_org_id,
    v_total_phys, v_total_obl,
    v_total_stl, v_s_owes,
    v_m_owes, v_signed,
    v_total_obl, v_s_owes,
    now()
  )
  on conflict (seller_id) do update set
    total_transferred_physical_g = v_total_phys,
    total_seller_obligation_g = v_total_obl,
    total_settled_to_manager_g = v_total_stl,
    seller_owes_manager_g = v_s_owes,
    manager_owes_seller_g = v_m_owes,
    bozor_qarzi_signed_g = v_signed,
    total_consigned_gold_grams = v_total_obl,
    current_factory_obligation_grams = v_s_owes,
    updated_at = now();

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_sync_seller_gold_account_consign on public.seller_consignments;
create trigger trg_sync_seller_gold_account_consign
  after insert or update or delete on public.seller_consignments
  for each row execute function public.fn_sync_seller_gold_account();

drop trigger if exists trg_sync_seller_gold_account_settle on public.gold_settlements;
create trigger trg_sync_seller_gold_account_settle
  after insert or update or delete on public.gold_settlements
  for each row execute function public.fn_sync_seller_gold_account();

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
