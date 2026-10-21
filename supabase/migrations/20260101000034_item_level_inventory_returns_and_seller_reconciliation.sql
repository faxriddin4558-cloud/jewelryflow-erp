-- =========================================================================
-- JewelryFlow ERP — Migration 034
-- Item-Level Inventory, Unsold Piece Returns to Manager,
-- Seller Reconciliation (Sections A-G), and Customer Sheets (Daily & Monthly)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Enhance Consignment Pieces Status & Tracking
-- -------------------------------------------------------------------------
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
    'reconciled'
  ));

alter table public.consignment_pieces
  add column if not exists returned_to_manager_at timestamptz,
  add column if not exists seller_markup_pct numeric(6, 2) default 12.00,
  add column if not exists seller_obligation_grams numeric(14, 4);

create index if not exists idx_consignment_pieces_status_seller
  on public.consignment_pieces (organization_id, seller_id, status);

-- -------------------------------------------------------------------------
-- 2. Enhance Seller Consignments with Return Tracking
-- -------------------------------------------------------------------------
alter table public.seller_consignments
  add column if not exists returned_quantity integer not null default 0,
  add column if not exists returned_weight_grams numeric(14, 4) not null default 0,
  add column if not exists returned_seller_obligation_g numeric(14, 4) not null default 0;

-- -------------------------------------------------------------------------
-- 3. Enhance rpc_issue_barcode_consignment to populate seller markup
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
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'warehouse', 'omborchi', 'inventory_manager'
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
  v_factory_due := round((v_total_base_weight * (1.0 + v_factory_pct / 100.0))::numeric, 4);
  -- Seller obligation = base_weight * (1 + seller_markup / 100)
  v_seller_due  := round((v_total_base_weight * (1.0 + v_seller_pct / 100.0))::numeric, 4);

  v_consignment_no := 'CONS-BC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- Insert parent consignment record
  insert into public.seller_consignments (
    organization_id, consignment_no, seller_id, product_id, product_name,
    quantity, base_weight_grams, proba, factory_markup_pct,
    factory_gold_due_grams, factory_settled_gold_grams, factory_remaining_gold_grams,
    seller_markup_pct, seller_obligation_g,
    sold_quantity, status, idempotency_key, notes, pieces
  ) values (
    v_caller_org, v_consignment_no, v_seller.id, null,
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
    'pieces', v_inserted_pieces
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_issue_barcode_consignment', v_existing, v_payload);
  return v_existing;
end;
$$;

-- -------------------------------------------------------------------------
-- 4. RPC: rpc_return_piece_to_manager (Sotuvchidan Boshqaruvchiga Sotilmagan Donani Qaytarish)
-- -------------------------------------------------------------------------
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
  v_caller_org       uuid := public.current_organization_id();
  v_caller_role      text := public.current_employee_role_text();
  v_piece            public.consignment_pieces%rowtype;
  v_consign          public.seller_consignments%rowtype;
  v_seller           public.employees%rowtype;
  v_seller_markup    numeric(6, 2);
  v_deduct_obl       numeric(14, 4);
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'action', 'return_piece_to_manager',
    'piece_id', p_piece_id,
    'notes', p_notes
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

  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'warehouse', 'omborchi', 'inventory_manager') then
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
     set returned_quantity           = returned_quantity + 1,
         returned_weight_grams       = round((returned_weight_grams + v_piece.weight_grams)::numeric, 4),
         returned_seller_obligation_g= round((returned_seller_obligation_g + v_deduct_obl)::numeric, 4),
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

  -- 7. Read updated seller gold account (synced by fn_sync_seller_gold_account trigger)
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_piece.seller_id;

  -- 8. Record audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) values (
    v_caller_org, 'consignment_pieces', v_piece.id::text, 'RETURN_PIECE_TO_MANAGER', auth.uid(),
    jsonb_build_object(
      'piece_id', v_piece.id,
      'model_code', v_piece.model_code,
      'weight_grams', v_piece.weight_grams,
      'seller_markup_pct', v_seller_markup,
      'seller_obligation_deducted', v_deduct_obl,
      'seller_id', v_piece.seller_id,
      'new_seller_owes_manager_g', v_seller_acc.seller_owes_manager_g,
      'new_bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
      'notes', p_notes
    )
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code,
    'weight_grams', v_piece.weight_grams,
    'seller_markup_pct', v_seller_markup,
    'seller_obligation_deducted_g', v_deduct_obl,
    'seller_id', v_piece.seller_id,
    'seller_owes_manager_g', v_seller_acc.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'notes', p_notes
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_return_piece_to_manager', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_return_piece_to_manager(uuid, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 4.B Hardened rpc_record_seller_to_manager_settlement (Foreign Key Safe)
-- -------------------------------------------------------------------------
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
      v_rate := 900000;
    end if;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  end if;

  v_total_settled := round(v_scrap_w + v_cash_equiv, 4);

  -- Resolve employee ID for recorded_by (avoid foreign key violation on auth.uid())
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

-- -------------------------------------------------------------------------
-- 5. RPC: rpc_get_seller_reconciliation_statement (Sections A through G)
-- -------------------------------------------------------------------------
create or replace function public.rpc_get_seller_reconciliation_statement(
  p_seller_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_seller_acc        public.seller_gold_accounts%rowtype;

  -- Section A: Received from Manager
  v_sec_a_orig_g      numeric(14, 4) := 0;
  v_sec_a_obl_g       numeric(14, 4) := 0;
  v_sec_a_count       integer := 0;

  -- Section B: Goods Unsold
  v_sec_b_count       integer := 0;
  v_sec_b_orig_g      numeric(14, 4) := 0;
  v_sec_b_equiv_g     numeric(14, 4) := 0;

  -- Section C: Goods Sold to Customers
  v_sec_c_count       integer := 0;
  v_sec_c_orig_g      numeric(14, 4) := 0;
  v_sec_c_equiv_g     numeric(14, 4) := 0;

  -- Section D: Customer Receivables
  v_sec_d_client_obl  numeric(14, 4) := 0;
  v_sec_d_scrap_rec   numeric(14, 4) := 0;
  v_sec_d_cash_rec    numeric(18, 2) := 0;
  v_sec_d_cash_eq     numeric(14, 4) := 0;
  v_sec_d_cust_debt   numeric(14, 4) := 0;

  -- Section E: Seller Holdings
  v_sec_e_cash_uzs    numeric(18, 2) := 0;
  v_sec_e_scrap_g     numeric(14, 4) := 0;

  -- Section F: Seller-to-Manager Settlements & Returns
  v_sec_f_scrap_g     numeric(14, 4) := 0;
  v_sec_f_cash_uzs    numeric(18, 2) := 0;
  v_sec_f_cash_eq     numeric(14, 4) := 0;
  v_sec_f_ret_count   integer := 0;
  v_sec_f_ret_orig_g  numeric(14, 4) := 0;
  v_sec_f_ret_obl_g   numeric(14, 4) := 0;

  -- Section G: Signed Bozor Qarzi
  v_sec_g_signed_g    numeric(14, 4) := 0;
  v_sec_g_owes_m_g    numeric(14, 4) := 0;
  v_sec_g_m_owes_s_g  numeric(14, 4) := 0;
  v_discrepancy       numeric(14, 4) := 0;
  v_is_reconciled     boolean := true;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  select * into v_seller
    from public.employees
   where id = p_seller_id and organization_id = v_caller_org;

  if not found then
    raise exception 'Sotuvchi topilmadi (%)', p_seller_id;
  end if;

  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = p_seller_id and organization_id = v_caller_org;

  -- Section A: All Consigned Goods
  select
    coalesce(sum(base_weight_grams + returned_weight_grams), 0),
    coalesce(sum(coalesce(seller_obligation_g, 0) + returned_seller_obligation_g), 0),
    coalesce(sum(quantity + returned_quantity), 0)
  into v_sec_a_orig_g, v_sec_a_obl_g, v_sec_a_count
  from public.seller_consignments
  where seller_id = p_seller_id and organization_id = v_caller_org;

  -- Section B: Unsold Pieces
  select
    count(*),
    coalesce(sum(weight_grams), 0),
    coalesce(sum(round((weight_grams * (1.0 + coalesce(seller_markup_pct, 12.0) / 100.0))::numeric, 4)), 0)
  into v_sec_b_count, v_sec_b_orig_g, v_sec_b_equiv_g
  from public.consignment_pieces
  where seller_id = p_seller_id and organization_id = v_caller_org
    and status = 'held_by_seller';

  -- Section C: Sold Pieces
  select
    count(*),
    coalesce(sum(weight_grams), 0),
    coalesce(sum(round((weight_grams * (1.0 + coalesce(seller_markup_pct, 12.0) / 100.0))::numeric, 4)), 0)
  into v_sec_c_count, v_sec_c_orig_g, v_sec_c_equiv_g
  from public.consignment_pieces
  where seller_id = p_seller_id and organization_id = v_caller_org
    and status = 'sold';

  -- Section D: Customer Receivables
  select
    coalesce(sum(client_gold_due_grams), 0)
  into v_sec_d_client_obl
  from public.jewelry_sales
  where seller_id = p_seller_id and organization_id = v_caller_org
    and status <> 'reversed';

  select
    coalesce(sum(scrap_weight_grams), 0),
    coalesce(sum(cash_paid_amount), 0),
    coalesce(sum(cash_equivalent_grams), 0)
  into v_sec_d_scrap_rec, v_sec_d_cash_rec, v_sec_d_cash_eq
  from public.gold_settlements
  where seller_id = p_seller_id and organization_id = v_caller_org
    and direction = 'client_to_seller';

  select
    coalesce(sum(current_debt_grams), 0)
  into v_sec_d_cust_debt
  from public.client_gold_accounts
  where seller_id = p_seller_id and organization_id = v_caller_org;

  -- Section E: Seller Holdings
  v_sec_e_cash_uzs := coalesce(v_seller_acc.seller_till_cash_amount, 0);
  v_sec_e_scrap_g  := coalesce(v_seller_acc.seller_till_scrap_grams, 0);

  -- Section F: Seller to Manager Settlements & Returned Unsold Goods
  select
    coalesce(sum(scrap_weight_grams), 0),
    coalesce(sum(cash_paid_amount), 0),
    coalesce(sum(cash_equivalent_grams), 0)
  into v_sec_f_scrap_g, v_sec_f_cash_uzs, v_sec_f_cash_eq
  from public.gold_settlements
  where seller_id = p_seller_id and organization_id = v_caller_org
    and direction = 'seller_to_manager';

  select
    count(*),
    coalesce(sum(weight_grams), 0),
    coalesce(sum(round((weight_grams * (1.0 + coalesce(seller_markup_pct, 12.0) / 100.0))::numeric, 4)), 0)
  into v_sec_f_ret_count, v_sec_f_ret_orig_g, v_sec_f_ret_obl_g
  from public.consignment_pieces
  where seller_id = p_seller_id and organization_id = v_caller_org
    and status in ('returned_to_manager', 'returned_to_factory');

  -- Section G: Current Signed Bozor Qarzi
  v_sec_g_owes_m_g   := coalesce(v_seller_acc.seller_owes_manager_g, 0);
  v_sec_g_m_owes_s_g := coalesce(v_seller_acc.manager_owes_seller_g, 0);
  v_sec_g_signed_g   := coalesce(v_seller_acc.bozor_qarzi_signed_g, 0);

  -- Reconciliation Invariant Check:
  -- Expected liability = Total consigned obligation - Returned obligation - Total settled to manager
  v_discrepancy := round(abs(v_sec_g_owes_m_g - greatest(0, (v_sec_a_obl_g - v_sec_f_ret_obl_g) - (v_sec_f_scrap_g + v_sec_f_cash_eq))), 4);
  v_is_reconciled := (v_discrepancy < 0.001);

  return jsonb_build_object(
    'seller_id', p_seller_id,
    'seller_name', coalesce(v_seller.full_name, v_seller.name),
    'section_a', jsonb_build_object(
      'title', 'A. Boshqaruvchidan qabul qilingan tovarlar',
      'original_grams', v_sec_a_orig_g,
      'seller_markup_obligation_grams', v_sec_a_obl_g,
      'item_count', v_sec_a_count
    ),
    'section_b', jsonb_build_object(
      'title', 'B. Sotilmagan tovarlar (Sotuvchi javonida)',
      'item_count', v_sec_b_count,
      'original_grams', v_sec_b_orig_g,
      'seller_markup_equivalent_grams', v_sec_b_equiv_g
    ),
    'section_c', jsonb_build_object(
      'title', 'C. Mijozlarga sotilgan tovarlar',
      'item_count', v_sec_c_count,
      'original_grams', v_sec_c_orig_g,
      'seller_markup_equivalent_grams', v_sec_c_equiv_g
    ),
    'section_d', jsonb_build_object(
      'title', 'D. Mijozlar qarzdorligi (Nasiya)',
      'customer_markup_obligation_grams', v_sec_d_client_obl,
      'scrap_collected_grams', v_sec_d_scrap_rec,
      'cash_collected_uzs', v_sec_d_cash_rec,
      'cash_equivalent_grams', v_sec_d_cash_eq,
      'outstanding_customer_debt_grams', v_sec_d_cust_debt
    ),
    'section_e', jsonb_build_object(
      'title', 'E. Sotuvchi g''aznasi (Holdings)',
      'cash_uzs', v_sec_e_cash_uzs,
      'scrap_grams', v_sec_e_scrap_g
    ),
    'section_f', jsonb_build_object(
      'title', 'F. Boshqaruvchiga to''lovlar va qaytgan tovarlar',
      'settlements_scrap_grams', v_sec_f_scrap_g,
      'settlements_cash_uzs', v_sec_f_cash_uzs,
      'settlements_cash_equivalent_grams', v_sec_f_cash_eq,
      'returned_unsold_items_count', v_sec_f_ret_count,
      'returned_unsold_original_grams', v_sec_f_ret_orig_g,
      'returned_unsold_seller_obligation_grams', v_sec_f_ret_obl_g
    ),
    'section_g', jsonb_build_object(
      'title', 'G. Joriy Bozor Qarzi (Imzolangan)',
      'bozor_qarzi_signed_grams', v_sec_g_signed_g,
      'seller_owes_manager_grams', v_sec_g_owes_m_g,
      'manager_owes_seller_grams', v_sec_g_m_owes_s_g,
      'discrepancy_grams', v_discrepancy,
      'is_reconciled', v_is_reconciled
    )
  );
end;
$$;

grant execute on function public.rpc_get_seller_reconciliation_statement(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 6. RPC: rpc_get_daily_sales_ledger ("Лист1" — Kundalik savdo jurnali)
-- -------------------------------------------------------------------------
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
  v_from       date := coalesce(p_start_date, current_date - interval '30 days');
  v_to         date := coalesce(p_end_date, current_date);
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
    0::numeric as total_payment_g,
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

-- -------------------------------------------------------------------------
-- 7. RPC: rpc_get_customer_monthly_report ("Oylik Hisobot" — Oylik Mijozlar Hisoboti)
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
  v_row_rec      record;
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
    -- 1. Opening debt: Sales before v_start_date minus Settlements before v_start_date
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
      and settlement_date < v_start_date;

    v_open_debt := round(greatest(0, v_open_debt), 4);

    -- 2. Sales during selected month
    select
      coalesce(sum(client_gold_due_grams), 0)
    into v_month_sales
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and sale_date between v_start_date and v_end_date
      and status <> 'reversed';

    -- 3. Payments during selected month
    select
      coalesce(sum(scrap_weight_grams), 0),
      coalesce(sum(cash_paid_amount), 0),
      coalesce(sum(cash_equivalent_grams), 0),
      coalesce(sum(total_settled_grams), 0)
    into v_month_scrap, v_month_cash, v_month_cash_g, v_month_settle
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and direction = 'client_to_seller'
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

grant execute on function public.rpc_get_customer_monthly_report(uuid, integer, integer) to authenticated;

-- -------------------------------------------------------------------------
-- 8. RPC: rpc_create_customer_with_code (Mijoz yaratish va avtomatik CUST-xxxx kod)
-- -------------------------------------------------------------------------
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

  -- Generate sequential customer code
  select coalesce(max(nullif(regexp_replace(customer_code, '\D', '', 'g'), '')::integer), 0) + 1
  into v_next_seq
  from public.customers
  where organization_id = v_caller_org;

  v_cust_code := 'CUST-' || lpad(v_next_seq::text, 4, '0');

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
