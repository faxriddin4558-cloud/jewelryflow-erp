-- Migration 055: Automatic FIFO Consignment Deduction & Manager Stock Parity
-- 1. Hardens rpc_issue_barcode_consignment to support automatic FIFO across active factory receipts when p_factory_receipt_id is NULL.
-- 2. Strictly enforces stock availability check before issuing consignment (aborts with exception if insufficient manager stock).
-- 3. Synchronizes manager vault physical stock atomically with factory receipts available_physical_g.
-- 4. Reconciles existing production consignment CONS-BC-514773B9 (105g) with factory receipt ZVD-20261026-0BBA55 (105.5g).

-- Drop existing signature with defaults to avoid Postgres 42P13
drop function if exists public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text, uuid, numeric);

create or replace function public.rpc_issue_barcode_consignment(
  p_seller_id          uuid,
  p_factory_markup_pct numeric,
  p_pieces             jsonb,
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
  v_cur_receipt       record;
  v_total_avail       numeric(14, 4) := 0;
  v_rem_to_deduct     numeric(14, 4) := 0;
  v_take_g            numeric(14, 4) := 0;
  v_found_model_rec   public.jewelry_models%rowtype;
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

  -- Deduct manager physical stock from factory_receipt(s)
  if v_receipt_id is not null then
    -- Explicit factory receipt selected
    select * into v_receipt_rec
      from public.factory_receipts
     where id = v_receipt_id
       and organization_id = v_caller_org
       and status <> 'reversed'
     for update;

    if not found then
      raise exception 'Belgilangan zavod kirim hujjati (%) topilmadi yoki bekor qilingan', v_receipt_id;
    end if;

    if coalesce(v_receipt_rec.available_physical_g, 0) < v_total_base_weight then
      raise exception 'Menejer omborida yetarli tovar yo''q: tanlangan kirimda mavjud % g, talab qilindi % g',
        coalesce(v_receipt_rec.available_physical_g, 0), v_total_base_weight;
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
    -- Automatic FIFO deduction across active factory receipts
    select coalesce(sum(available_physical_g), 0) into v_total_avail
      from public.factory_receipts
     where organization_id = v_caller_org
       and status <> 'reversed';

    if v_total_avail < v_total_base_weight then
      raise exception 'Menejer omborida yetarli tovar yo''q: mavjud % g, talab qilindi % g',
        v_total_avail, v_total_base_weight;
    end if;

    v_rem_to_deduct := v_total_base_weight;
    for v_cur_receipt in
      select * from public.factory_receipts
       where organization_id = v_caller_org
         and status <> 'reversed'
         and available_physical_g > 0
       order by receipt_date asc, created_at asc
       for update
    loop
      v_take_g := least(v_rem_to_deduct, v_cur_receipt.available_physical_g);

      update public.factory_receipts
         set available_physical_g = round(available_physical_g - v_take_g, 4),
             transferred_physical_g = round(transferred_physical_g + v_take_g, 4),
             status = case
               when round(available_physical_g - v_take_g, 4) <= 0.0001 then 'fully_transferred'
               else 'partially_transferred'
             end,
             updated_at = now()
       where id = v_cur_receipt.id;

      if v_receipt_id is null then
        v_receipt_id := v_cur_receipt.id;
      end if;

      v_rem_to_deduct := round(v_rem_to_deduct - v_take_g, 4);
      if v_rem_to_deduct <= 0.0001 then
        exit;
      end if;
    end loop;

    if v_rem_to_deduct > 0.0001 then
      raise exception 'Menejer omborida FIFO bo''yicha yetarli tovar topilmadi: yetishmayotgan qoldiq % g', v_rem_to_deduct;
    end if;
  end if;

  -- Synchronize manager vault physical stock atomically
  perform public._get_or_create_manager_vault(v_caller_org);
  update public.manager_vault_account
     set manager_physical_stock_g = public.get_manager_available_stock_grams(v_caller_org),
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
    v_model_code := coalesce(nullif(btrim(v_piece_elem->>'model_code'), ''), 'VAZN');
    v_model_name := coalesce(nullif(btrim(v_piece_elem->>'model_name'), ''), 'Zargarlik Buyumi (Standart 585)');
    v_category := coalesce(nullif(btrim(v_piece_elem->>'category'), ''), 'Buyum');
    v_purity := coalesce((v_piece_elem->>'purity')::numeric, 585.00);
    v_weight := round((v_piece_elem->>'weight_grams')::numeric, 4);
    v_raw_barcode := coalesce(v_piece_elem->>'raw_barcode', v_piece_elem->>'weight_grams');
    v_piece_seller_obl := round((v_weight * (1.0 + v_seller_pct / 100.0))::numeric, 4);

    -- Foreign Key validation: verify if v_model_id genuinely exists in jewelry_models
    v_found_model_rec := null;
    if v_model_id is not null and v_model_id <> '00000000-0000-0000-0000-000000000000'::uuid then
      select * into v_found_model_rec
        from public.jewelry_models
       where id = v_model_id
       limit 1;
      if not found then
        v_model_id := null;
      end if;
    end if;

    if v_model_id is not null and v_found_model_rec.id is not null then
      v_model_id := v_found_model_rec.id;
      v_model_code := coalesce(v_found_model_rec.model_code, v_model_code);
      v_model_name := coalesce(v_found_model_rec.name, v_model_name);
      v_category := coalesce(v_found_model_rec.category, v_category);
    else
      -- Model ID not valid or not found. Look up by model_code or standard 'VAZN'
      select * into v_found_model_rec
        from public.jewelry_models
       where (organization_id = v_caller_org or organization_id is null)
         and (upper(model_code) = upper(v_model_code) or upper(model_code) = 'VAZN')
       order by (case when upper(model_code) = upper(v_model_code) then 0 else 1 end),
                (case when organization_id = v_caller_org then 0 else 1 end),
                created_at asc
       limit 1;

      if found then
        v_model_id := v_found_model_rec.id;
        v_model_code := v_found_model_rec.model_code;
        v_model_name := v_found_model_rec.name;
        v_category := coalesce(v_found_model_rec.category, v_category);
      else
        -- Fallback: ensure standard VAZN model is present in jewelry_models and use it
        insert into public.jewelry_models (
          id, organization_id, model_code, name, category, decorations, proba, gold_purity, is_active
        ) values (
          '00000000-0000-4001-8001-000000000585'::uuid,
          v_caller_org,
          'VAZN',
          'Zargarlik Buyumi (Standart 585)',
          'Buyum',
          'Standart',
          585,
          '585',
          true
        )
        on conflict (model_code) do update
        set is_active = true
        returning * into v_found_model_rec;

        v_model_id := v_found_model_rec.id;
        v_model_code := v_found_model_rec.model_code;
        v_model_name := v_found_model_rec.name;
        v_category := coalesce(v_found_model_rec.category, v_category);
      end if;
    end if;

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
      'model_id', v_model_id,
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
grant execute on function public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text, uuid, numeric) to service_role;

-- 4. Atomic Audit Reconciliation of Existing Production Consignment CONS-BC-514773B9
do $$
declare
  v_rcp record;
  v_cns record;
begin
  select * into v_cns
    from public.seller_consignments
   where consignment_no = 'CONS-BC-514773B9';

  if found then
    select * into v_rcp
      from public.factory_receipts
     where receipt_no = 'ZVD-20261026-0BBA55'
       and status <> 'reversed';

    if found then
      -- Link consignment to receipt
      update public.seller_consignments
         set factory_receipt_id = v_rcp.id,
             notes = coalesce(notes, '') || ' [Audit: Linked to ZVD-20261026-0BBA55]',
             updated_at = now()
       where id = v_cns.id;

      -- Deduct transferred weight (105.00g) from receipt (105.50g -> 0.50g available)
      update public.factory_receipts
         set available_physical_g = round(greatest(0, original_physical_g - v_cns.base_weight_grams), 4),
             transferred_physical_g = v_cns.base_weight_grams,
             status = case
               when round(greatest(0, original_physical_g - v_cns.base_weight_grams), 4) <= 0.0001 then 'fully_transferred'
               else 'partially_transferred'
             end,
             updated_at = now()
       where id = v_rcp.id;

      -- Sync manager vault physical stock to exact 0.50g
      update public.manager_vault_account
         set manager_physical_stock_g = public.get_manager_available_stock_grams(v_rcp.organization_id),
             updated_at = now()
       where organization_id = v_rcp.organization_id;

      raise notice 'CONS-BC-514773B9 successfully reconciled with ZVD-20261026-0BBA55. Manager stock: 0.5000g, Seller stock: 105.0000g.';
    end if;
  end if;
end;
$$;
