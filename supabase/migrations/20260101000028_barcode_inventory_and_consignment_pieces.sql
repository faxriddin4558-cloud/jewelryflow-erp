-- =========================================================================
-- JewelryFlow ERP — Migration 028
-- Barcode Inventory, Scanner 564 Support & Piece-Level Consignments
-- =========================================================================
-- Implements:
-- 1. Two-Code System: Model QR Code (JF-M-xxxx) + Weight Linear Barcode (e.g. 14.52g)
-- 2. Physical jewelry piece-level tracking in `consignment_pieces`
-- 3. High-throughput atomic consignment from Scanner 564 (`rpc_issue_barcode_consignment`)
-- 4. Mobile piece-level sale deduction (`rpc_record_barcode_piece_sale`)
-- 5. Independent quantity and physical gram reconciliation
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Enhance Jewelry Models with Multi-Tenant Support & BarTender Code Index
-- -------------------------------------------------------------------------
alter table public.jewelry_models
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_jewelry_models_tenant_code
  on public.jewelry_models (organization_id, model_code);

-- -------------------------------------------------------------------------
-- 2. Enhance Seller Consignments with Piece Breakdown
-- -------------------------------------------------------------------------
alter table public.seller_consignments
  add column if not exists pieces jsonb default '[]'::jsonb,
  add column if not exists model_id uuid references public.jewelry_models(id) on delete set null;

-- -------------------------------------------------------------------------
-- 3. Dedicated Consignment Pieces Table (Individual Physical Units)
-- -------------------------------------------------------------------------
create table if not exists public.consignment_pieces (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  consignment_id    uuid not null references public.seller_consignments(id) on delete cascade,
  model_id          uuid references public.jewelry_models(id) on delete set null,
  model_code        text not null,
  model_name        text not null,
  category          text default 'Серьги',
  purity            numeric(6, 2) not null default 585 check (purity > 0 and purity <= 1000),
  weight_grams      numeric(14, 4) not null check (weight_grams > 0),
  status            text not null default 'held_by_seller'
                    check (status in ('in_factory', 'held_by_seller', 'sold', 'returned_to_factory')),
  seller_id         uuid not null references public.employees(id) on delete restrict,
  sale_id           uuid references public.jewelry_sales(id) on delete set null,
  sold_at           timestamptz,
  raw_barcode       text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.consignment_pieces is 'Physical individual jewelry pieces scanned via Scanner 564 and consigned to sellers.';

create index if not exists idx_consignment_pieces_lookup
  on public.consignment_pieces (organization_id, seller_id, status);

create index if not exists idx_consignment_pieces_consignment
  on public.consignment_pieces (consignment_id);

create index if not exists idx_consignment_pieces_model
  on public.consignment_pieces (organization_id, model_id, weight_grams);

create index if not exists idx_consignment_pieces_sale
  on public.consignment_pieces (sale_id);

-- -------------------------------------------------------------------------
-- 4. Row Level Security for Consignment Pieces
-- -------------------------------------------------------------------------
alter table public.consignment_pieces enable row level security;

create policy "consignment_pieces_select_policy"
  on public.consignment_pieces for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'warehouse', 'omborchi')
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

create policy "consignment_pieces_manage_policy"
  on public.consignment_pieces for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'warehouse', 'omborchi')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'warehouse', 'omborchi')
  );

-- -------------------------------------------------------------------------
-- 5. RPC: rpc_issue_barcode_consignment (Scanner 564 Consignment Transfer)
-- -------------------------------------------------------------------------
create or replace function public.rpc_issue_barcode_consignment(
  p_seller_id          uuid,
  p_factory_markup_pct numeric default 0,
  p_pieces             jsonb default '[]'::jsonb,
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
  v_markup_pct        numeric(6, 2) := round(coalesce(p_factory_markup_pct, 0)::numeric, 2);
  v_total_base_weight numeric(14, 4) := 0;
  v_total_qty         integer := 0;
  v_factory_due       numeric(14, 4) := 0;
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
  v_inserted_pieces   jsonb := '[]'::jsonb;
  v_payload           jsonb;
  v_existing          jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'warehouse', 'omborchi'
  ]);

  if jsonb_array_length(p_pieces) = 0 then
    raise exception 'Kamida 1 ta mahsulot dona skaner qilinishi shart';
  end if;

  if v_markup_pct < 0 then
    raise exception 'Zavod ustama foizi manfiy bo''lishi mumkin emas';
  end if;

  v_payload := jsonb_build_object(
    'action', 'issue_barcode_consignment',
    'seller_id', p_seller_id,
    'factory_markup_pct', v_markup_pct,
    'piece_count', jsonb_array_length(p_pieces)
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

  -- First pass: calculate total base weight and validate every piece
  for v_piece_elem in select * from jsonb_array_elements(p_pieces) loop
    v_weight := round(coalesce((v_piece_elem->>'weight_grams')::numeric, 0), 4);
    if v_weight <= 0 or v_weight > 1000.0 then
      raise exception 'Noto''g''ri mahsulot vazni aniqlandi: % g (ruxsat: 0.05g - 1000g)', v_weight;
    end if;
    v_total_base_weight := v_total_base_weight + v_weight;
    v_total_qty := v_total_qty + 1;
  end loop;

  v_total_base_weight := round(v_total_base_weight, 4);
  -- Non-compounding: Factory gold due = base_weight * (1 + factory_markup / 100)
  v_factory_due := round((v_total_base_weight * (1.0 + v_markup_pct / 100.0))::numeric, 4);

  v_consignment_no := 'CONS-BC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- Insert parent consignment record
  insert into public.seller_consignments (
    organization_id, consignment_no, seller_id, product_id, product_name,
    quantity, base_weight_grams, proba, factory_markup_pct,
    factory_gold_due_grams, factory_settled_gold_grams, factory_remaining_gold_grams,
    sold_quantity, status, idempotency_key, notes, pieces
  ) values (
    v_caller_org, v_consignment_no, v_seller.id, null,
    'Skanerlangan Partiya (' || v_total_qty || ' dona)',
    v_total_qty, v_total_base_weight, 585.00, v_markup_pct,
    v_factory_due, 0, v_factory_due,
    0, 'held_by_seller', nullif(btrim(p_idempotency_key), ''), p_notes, p_pieces
  ) returning id into v_consignment_id;

  -- Second pass: insert each individual piece with unique ID
  for v_piece_elem in select * from jsonb_array_elements(p_pieces) loop
    v_piece_id := gen_random_uuid();
    v_model_id := nullif(v_piece_elem->>'model_id', '')::uuid;
    v_model_code := coalesce(v_piece_elem->>'model_code', 'M-GENERIC');
    v_model_name := coalesce(v_piece_elem->>'model_name', 'Zargarlik Buyumi');
    v_category := coalesce(v_piece_elem->>'category', 'Серьги');
    v_purity := coalesce((v_piece_elem->>'purity')::numeric, 585.00);
    v_weight := round((v_piece_elem->>'weight_grams')::numeric, 4);
    v_raw_barcode := coalesce(v_piece_elem->>'raw_barcode', v_piece_elem->>'weight_grams');

    insert into public.consignment_pieces (
      id, organization_id, consignment_id, model_id, model_code, model_name,
      category, purity, weight_grams, status, seller_id, raw_barcode, notes
    ) values (
      v_piece_id, v_caller_org, v_consignment_id, v_model_id, v_model_code, v_model_name,
      v_category, v_purity, v_weight, 'held_by_seller', v_seller.id, v_raw_barcode, p_notes
    );

    v_inserted_pieces := v_inserted_pieces || jsonb_build_object(
      'id', v_piece_id,
      'model_code', v_model_code,
      'model_name', v_model_name,
      'weight_grams', v_weight
    );
  end loop;

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
    'seller_name', coalesce(v_seller.full_name, v_seller.name),
    'quantity', v_total_qty,
    'base_weight_grams', v_total_base_weight,
    'factory_markup_pct', v_markup_pct,
    'factory_gold_due_grams', v_factory_due,
    'pieces', v_inserted_pieces
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_issue_barcode_consignment', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 6. RPC: rpc_record_barcode_piece_sale (Seller Mobile Piece Sale)
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
  v_client_pct        numeric(6, 2) := round(coalesce(p_client_markup_pct, 0)::numeric, 2);
  v_base_w            numeric(14, 4);
  v_factory_due       numeric(14, 4);
  v_client_due        numeric(14, 4);
  v_spread            numeric(14, 4);
  v_sale_id           uuid;
  v_sale_no           text;
  v_payload           jsonb;
  v_existing          jsonb;
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

  -- Ensure seller can only sell their own pieces
  if public.current_employee_role_text() not in ('admin', 'director', 'owner', 'direktor', 'rahbar') then
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

  -- Locate piece: by piece_id or (model_id + weight_grams)
  if p_piece_id is not null then
    select * into v_piece
      from public.consignment_pieces
     where id = p_piece_id
       and seller_id = v_seller.id
       and status = 'held_by_seller'
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
    raise exception 'Tanlangan mahsulot (dona) sotuvchi omborida topilmadi yoki allaqachon sotilgan';
  end if;

  -- Fetch parent consignment for factory markup
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;
  if not found then
    raise exception 'Konsignatsiya yozuvi topilmadi';
  end if;

  v_base_w := v_piece.weight_grams;
  v_factory_due := round((v_base_w * (1.0 + v_consign.factory_markup_pct / 100.0))::numeric, 4);
  v_client_due  := round((v_base_w * (1.0 + v_client_pct / 100.0))::numeric, 4);
  v_spread      := v_client_due - v_factory_due;

  v_sale_no := 'SALE-BC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- Insert sale record
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
    v_spread, 0, v_client_due,
    'open_debt', current_date, nullif(btrim(p_idempotency_key), ''), p_notes
  ) returning id into v_sale_id;

  -- Update piece status to sold
  update public.consignment_pieces
     set status = 'sold',
         sale_id = v_sale_id,
         sold_at = now(),
         updated_at = now()
   where id = v_piece.id;

  -- Update parent consignment counts
  update public.seller_consignments
     set sold_quantity = sold_quantity + 1,
         status = case when sold_quantity + 1 >= quantity then 'fully_sold' else 'partially_sold' end,
         updated_at = now()
   where id = v_consign.id;

  -- Update client running debt
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams, current_debt_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, v_client_due, v_client_due, now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_due)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_client_due)::numeric, 4),
    seller_id                  = coalesce(client_gold_accounts.seller_id, v_seller.id),
    updated_at                 = now();

  -- Update seller total client debt in seller_gold_accounts
  insert into public.seller_gold_accounts (
    seller_id, organization_id, total_client_debt_grams, updated_at
  ) values (
    v_seller.id, v_caller_org, v_client_due, now()
  )
  on conflict (seller_id) do update set
    total_client_debt_grams = round((seller_gold_accounts.total_client_debt_grams + v_client_due)::numeric, 4),
    updated_at              = now();

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code,
    'model_name', v_piece.model_name,
    'weight_grams', v_base_w,
    'factory_markup_pct', v_consign.factory_markup_pct,
    'factory_gold_due_grams', v_factory_due,
    'client_markup_pct', v_client_pct,
    'client_gold_due_grams', v_client_due,
    'markup_spread_grams', v_spread,
    'customer_name', v_customer.contact_name
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_barcode_piece_sale', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_record_barcode_piece_sale(uuid, uuid, uuid, uuid, numeric, numeric, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 7. View & Helper for Per-Seller Inventory Reconciliation
-- -------------------------------------------------------------------------
create or replace view public.view_seller_piece_inventory as
select
  p.organization_id,
  p.seller_id,
  e.name as seller_name,
  e.full_name as seller_full_name,
  p.model_code,
  p.model_name,
  p.category,
  count(p.id) as total_consigned_qty,
  sum(p.weight_grams) as total_consigned_grams,
  count(p.id) filter (where p.status = 'sold') as sold_qty,
  coalesce(sum(p.weight_grams) filter (where p.status = 'sold'), 0) as sold_grams,
  count(p.id) filter (where p.status = 'held_by_seller') as available_qty,
  coalesce(sum(p.weight_grams) filter (where p.status = 'held_by_seller'), 0) as available_grams
from public.consignment_pieces p
join public.employees e on e.id = p.seller_id
group by p.organization_id, p.seller_id, e.name, e.full_name, p.model_code, p.model_name, p.category;

-- -------------------------------------------------------------------------
-- 8. Seed Default Malika Model if missing
-- -------------------------------------------------------------------------
insert into public.jewelry_models (
  model_code, name, category, ring_size, loops_count, locks_count, decorations, reference_weight_grams, is_active
)
values (
  'JF-M-0001', 'Malika', 'Серьги', null, 0, 0, 'Дорика', 14.500, true
)
on conflict (model_code) do update set
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  decorations = EXCLUDED.decorations,
  reference_weight_grams = EXCLUDED.reference_weight_grams,
  is_active = true;
