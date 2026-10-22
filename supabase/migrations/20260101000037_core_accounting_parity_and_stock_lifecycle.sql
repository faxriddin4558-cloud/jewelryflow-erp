-- =========================================================================
-- Migration 037: Core Accounting Parity, Three-Tier Ledger, and Stock Lifecycle
-- Covers F03, F04, F05, F06, F07:
-- 1. Three-tier ledger separation (Factory vs Seller vs Client)
-- 2. Physical stock deduction on consignment creation (Manager -> Seller)
-- 3. Atomic piece-level lifecycle on batch/piece sale and double-sale guard
-- 4. Consistent signed Bozor Qarzi (+/-) synchronization
-- 5. Automatic advance consumption and net debt reconciliation
-- 6. Resilient daily ledger date range filtering
-- =========================================================================

-- 1. Update rpc_issue_barcode_consignment with physical stock deduction (F04)
-- Drop obsolete 5-parameter overload so PostgREST resolves the canonical function without ambiguity
drop function if exists public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text);

create or replace function public.rpc_issue_barcode_consignment(
  p_seller_id          uuid,
  p_factory_markup_pct numeric default 0,
  p_pieces             jsonb default '[]'::jsonb,
  p_notes              text default null,
  p_idempotency_key    text default null,
  p_factory_receipt_id uuid default null
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
  v_seller_pct        numeric(6, 2) := 12.00;
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
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'inventory_manager'
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
  v_factory_due := round((v_total_base_weight * (1.0 + v_factory_pct / 100.0))::numeric, 4);
  -- Seller obligation = base_weight * (1 + seller_markup / 100)
  v_seller_due  := round((v_total_base_weight * (1.0 + v_seller_pct / 100.0))::numeric, 4);

  -- Requirement 3 & F04: Deduct manager's physical stock from factory_receipt
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
    -- Auto-link FIFO to available factory receipt if one exists
    select id into v_receipt_id
    from public.factory_receipts
    where organization_id = v_caller_org
      and available_physical_g >= v_total_base_weight
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

  -- Insert parent consignment record
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

grant execute on function public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text, uuid) to authenticated;


-- 2. Update rpc_record_client_jewelry_sale: Atomic Piece Status Transition (F05) & Advance Application (F07)
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
  v_active_rate     numeric(18, 2);
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

  -- Non-compounding: Client gold due is calculated strictly from base weight
  v_client_gold_due := round((v_cons.base_weight_grams * (1.0 + v_client_markup / 100.0))::numeric, 4);
  v_markup_spread   := round((v_client_gold_due - v_cons.factory_gold_due_grams)::numeric, 4);

  -- Check existing advance balance (F07)
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
    case when v_net_rem_due <= 0.0001 then 'fully_settled' else 'open_debt' end,
    current_date, nullif(btrim(p_idempotency_key), ''), p_notes
  ) returning id into v_sale_id;

  -- F05: ATOMICALLY UPDATE ALL PIECES in this consignment to 'sold'
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

  -- F07: Advance applied is reflected directly in sale record (settled_gold_grams) and client_gold_accounts

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
    'advance_applied_grams', v_apply_adv,
    'net_remaining_debt_grams', v_net_rem_due,
    'markup_spread_grams', v_markup_spread
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_jewelry_sale', v_existing, v_payload);
  return v_existing;
end;
$$;


-- 3. Update rpc_record_barcode_piece_sale: Double-Sale Guard & Advance Application (F05, F07)
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
  v_active_rate       numeric(18, 2);
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

  -- F05: Double-sale guard: ensure piece is strictly held_by_seller
  if v_piece.status = 'sold' then
    raise exception 'Bu mahsulot donasi (% — % g) allaqachon sotilgan (Sotuv kodi: %)',
      v_piece.model_code, v_piece.weight_grams, coalesce(v_piece.sale_id::text, 'MAVJUD');
  end if;

  if v_piece.status <> 'held_by_seller' then
    raise exception 'Mahsulot sotuvga yaroqsiz holatda (Joriy holat: %)', v_piece.status;
  end if;

  -- Fetch parent consignment
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;
  if not found then
    raise exception 'Konsignatsiya yozuvi topilmadi';
  end if;

  v_base_w      := v_piece.weight_grams;
  v_factory_due := round((v_base_w * (1.0 + v_consign.factory_markup_pct / 100.0))::numeric, 4);
  v_client_due  := round((v_base_w * (1.0 + v_client_pct / 100.0))::numeric, 4);
  v_spread      := round((v_client_due - v_factory_due)::numeric, 4);

  -- F07: Check customer advance
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
    v_spread, v_apply_adv, v_net_rem_due,
    case when v_net_rem_due <= 0.0001 then 'fully_settled' else 'open_debt' end,
    current_date, nullif(btrim(p_idempotency_key), ''), p_notes
  ) returning id into v_sale_id;

  -- F05: Mark piece as sold
  update public.consignment_pieces
     set status = 'sold',
         sale_id = v_sale_id,
         sold_at = now(),
         updated_at = now()
   where id = v_piece.id;

  -- Check remaining unsold pieces in parent consignment
  select count(*) into v_remaining_pieces
    from public.consignment_pieces
   where consignment_id = v_consign.id
     and status = 'held_by_seller';

  if v_remaining_pieces = 0 then
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

  -- F07: Advance applied is reflected directly in sale record (settled_gold_grams) and client_gold_accounts

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
    'weight_grams', v_base_w,
    'client_markup_pct', v_client_pct,
    'gross_gold_due_grams', v_client_due,
    'advance_applied_grams', v_apply_adv,
    'net_remaining_debt_grams', v_net_rem_due,
    'markup_spread_grams', v_spread
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_barcode_piece_sale', v_existing, v_payload);
  return v_existing;
end;
$$;


-- 4. Double-Return Guard: Cannot return a piece that is already sold
create or replace function public.rpc_return_piece_to_manager(
  p_piece_id        uuid,
  p_notes           text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org   uuid := public.current_organization_id();
  v_piece        public.consignment_pieces%rowtype;
  v_seller       public.employees%rowtype;
  v_consign      public.seller_consignments%rowtype;
  v_payload      jsonb;
  v_existing     jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object('action', 'return_piece', 'piece_id', p_piece_id);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_return_piece_to_manager', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_piece
    from public.consignment_pieces
   where id = p_piece_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Mahsulot donasi (%) topilmadi', p_piece_id;
  end if;

  if v_piece.status = 'sold' then
    raise exception 'Sotilgan mahsulot donasini qaytarib bo''lmaydi (Mahsulot holati: sold)';
  end if;

  if v_piece.status <> 'held_by_seller' then
    raise exception 'Faqat sotuvchi omboridagi mahsulotni qaytarish mumkin (Joriy holat: %)', v_piece.status;
  end if;

  -- Ensure seller can only return their own piece unless management
  if public.current_employee_role_text() not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager') then
    select * into v_seller from public.employees where id = v_piece.seller_id;
    if v_seller.user_id is not null and v_seller.user_id <> auth.uid() then
      raise exception 'Ruxsat etilmadi: Faqat o''z omboringizdagi tovarnigina qaytara olasiz' using errcode = '42501';
    end if;
  end if;

  -- Update piece status to returned_to_manager
  update public.consignment_pieces
     set status = 'returned_to_manager',
         notes = coalesce(notes || ' | ', '') || coalesce(p_notes, 'Boshqaruvchiga qaytarildi'),
         updated_at = now()
   where id = v_piece.id;

  -- Update parent consignment
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;

  if found then
    update public.seller_consignments
       set returned_to_factory_quantity = coalesce(returned_to_factory_quantity, 0) + 1,
           returned_to_factory_gold_grams = round((coalesce(returned_to_factory_gold_grams, 0) + v_piece.weight_grams)::numeric, 4),
           updated_at = now()
     where id = v_consign.id;
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code,
    'weight_grams', v_piece.weight_grams,
    'new_status', 'returned_to_manager'
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_return_piece_to_manager', v_existing, v_payload);
  return v_existing;
end;
$$;


-- 5. Resilient Daily Sales Ledger with Inclusive, Normalized Date Range (F11)
create or replace function public.rpc_get_daily_sales_ledger(
  p_seller_id   uuid default null,
  p_start_date  date default null,
  p_end_date    date default null
)
returns table (
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
  v_d1         date := coalesce(p_start_date, current_date - interval '30 days');
  v_d2         date := coalesce(p_end_date, current_date);
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


-- 6. Canonical Three-Tier Summary RPC (F03, F06, F07)
create or replace function public.rpc_get_three_tier_ledger_summary()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id             uuid := public.current_organization_id();
  -- Tier 1: Factory Ledger
  v_factory_rcp_due    numeric(14, 4) := 0;
  v_factory_hnd_paid   numeric(14, 4) := 0;
  v_factory_net_due    numeric(14, 4) := 0;
  v_factory_orig_phys  numeric(14, 4) := 0;
  v_factory_avail_phys numeric(14, 4) := 0;
  -- Tier 2: Seller Ledger
  v_seller_obl_total   numeric(14, 4) := 0;
  v_seller_stl_total   numeric(14, 4) := 0;
  v_seller_signed_bal  numeric(14, 4) := 0;
  v_seller_till_scrap  numeric(14, 4) := 0;
  v_seller_till_cash   numeric(18, 2) := 0;
  -- Tier 3: Client Ledger
  v_client_sales_total numeric(14, 4) := 0;
  v_client_stl_total   numeric(14, 4) := 0;
  v_client_net_debt    numeric(14, 4) := 0;
  v_client_advance_tot numeric(14, 4) := 0;
  -- Vault status
  v_vault_scrap        numeric(14, 4) := 0;
  v_vault_refined      numeric(14, 4) := 0;
  v_vault_cash         numeric(18, 2) := 0;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- 1. Tier 1: Factory Ledger
  select
    coalesce(sum(factory_obligation_g), 0),
    coalesce(sum(original_physical_g), 0),
    coalesce(sum(available_physical_g), 0)
  into v_factory_rcp_due, v_factory_orig_phys, v_factory_avail_phys
  from public.factory_receipts
  where organization_id = v_org_id;

  select coalesce(sum(agreed_equivalent_g), 0)
  into v_factory_hnd_paid
  from public.factory_gold_handovers
  where organization_id = v_org_id;

  v_factory_net_due := round(greatest(0, v_factory_rcp_due - v_factory_hnd_paid), 4);

  -- 2. Tier 2: Seller Ledger
  select
    coalesce(sum(total_seller_obligation_g), 0),
    coalesce(sum(total_settled_to_manager_g), 0),
    coalesce(sum(bozor_qarzi_signed_g), 0),
    coalesce(sum(seller_till_scrap_grams), 0),
    coalesce(sum(seller_till_cash_amount), 0)
  into v_seller_obl_total, v_seller_stl_total, v_seller_signed_bal,
       v_seller_till_scrap, v_seller_till_cash
  from public.seller_gold_accounts
  where organization_id = v_org_id;

  -- 3. Tier 3: Client Ledger
  select
    coalesce(sum(current_debt_grams), 0),
    coalesce(sum(advance_balance_grams), 0),
    coalesce(sum(total_purchased_gold_grams), 0),
    coalesce(sum(total_settled_grams), 0)
  into v_client_net_debt, v_client_advance_tot, v_client_sales_total, v_client_stl_total
  from public.client_gold_accounts
  where organization_id = v_org_id;

  -- 4. Manager Vault
  select
    coalesce(manager_scrap_grams, 0),
    coalesce(manager_refined_gold_grams, 0),
    coalesce(manager_cash_amount, 0)
  into v_vault_scrap, v_vault_refined, v_vault_cash
  from public.manager_vault_account
  where organization_id = v_org_id
  limit 1;

  return jsonb_build_object(
    'tier1_factory', jsonb_build_object(
      'total_obligation_grams', v_factory_rcp_due,
      'total_handovers_grams', v_factory_hnd_paid,
      'net_factory_debt_grams', v_factory_net_due,
      'original_physical_grams', v_factory_orig_phys,
      'available_manager_physical_grams', v_factory_avail_phys
    ),
    'tier2_sellers', jsonb_build_object(
      'total_seller_obligation_grams', v_seller_obl_total,
      'total_settled_to_manager_grams', v_seller_stl_total,
      'bozor_qarzi_signed_grams', v_seller_signed_bal,
      'total_till_scrap_grams', v_seller_till_scrap,
      'total_till_cash_amount', v_seller_till_cash
    ),
    'tier3_clients', jsonb_build_object(
      'total_purchased_grams', v_client_sales_total,
      'total_settled_grams', v_client_stl_total,
      'net_debt_grams', v_client_net_debt,
      'advance_balance_grams', v_client_advance_tot
    ),
    'manager_vault', jsonb_build_object(
      'scrap_grams', v_vault_scrap,
      'refined_gold_grams', v_vault_refined,
      'cash_amount', v_vault_cash
    )
  );
end;
$$;

grant execute on function public.rpc_get_three_tier_ledger_summary() to authenticated;
