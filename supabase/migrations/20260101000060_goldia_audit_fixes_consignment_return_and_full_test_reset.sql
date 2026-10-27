-- =========================================================================
-- JewelryFlow ERP — Migration 060
-- Goldia Sales: Consignment Return Check Constraint Resolution,
-- Financial Transaction RPC Parameter Parity, Factory Receipt Assay Parity,
-- Refining Reversal Parity, and Full Test Account Reset Workflow
-- =========================================================================

-- -------------------------------------------------------------------------
-- PART 1: SELLER CONSIGNMENTS CHECK CONSTRAINT & AUDIT HISTORY PRESERVATION
-- -------------------------------------------------------------------------

-- 1. Ensure original document history columns exist
alter table public.seller_consignments
  add column if not exists original_quantity integer not null default 1,
  add column if not exists original_base_weight_grams numeric(14, 4) not null default 0,
  add column if not exists original_seller_obligation_g numeric(14, 4) not null default 0;

-- Backfill original values if not set
update public.seller_consignments
   set original_quantity = greatest(1, quantity + coalesce(returned_quantity, 0)),
       original_base_weight_grams = round((base_weight_grams + coalesce(returned_weight_grams, 0))::numeric, 4),
       original_seller_obligation_g = round((coalesce(seller_obligation_g, factory_gold_due_grams) + coalesce(returned_seller_obligation_g, 0))::numeric, 4)
 where original_base_weight_grams = 0;

-- 2. Drop the restrictive (> 0) check constraints that crash on complete returns
alter table public.seller_consignments
  drop constraint if exists seller_consignments_base_weight_grams_check,
  drop constraint if exists seller_consignments_quantity_check,
  drop constraint if exists seller_consignments_status_check,
  drop constraint if exists seller_consignments_returned_weight_check,
  drop constraint if exists seller_consignments_returned_qty_check,
  drop constraint if exists seller_consignments_weight_integrity_check;

-- 3. Trigger to initialize original_* fields on insert
create or replace function public._sync_seller_consignments_original_fields()
returns trigger
language plpgsql
as $$
begin
  if new.original_quantity is null or new.original_quantity = 0 then
    new.original_quantity := greatest(1, coalesce(new.quantity, 1));
  end if;
  if new.original_base_weight_grams is null or new.original_base_weight_grams = 0 then
    new.original_base_weight_grams := coalesce(new.base_weight_grams, 0);
  end if;
  if new.original_seller_obligation_g is null or new.original_seller_obligation_g = 0 then
    new.original_seller_obligation_g := coalesce(new.seller_obligation_g, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_seller_consignments_original_fields on public.seller_consignments;
create trigger trg_sync_seller_consignments_original_fields
  before insert on public.seller_consignments
  for each row
  execute function public._sync_seller_consignments_original_fields();

-- 4. Add robust non-negative and integrity check constraints (allowing 0 when fully returned/sold)
alter table public.seller_consignments
  add constraint seller_consignments_base_weight_grams_check
    check (base_weight_grams >= 0),
  add constraint seller_consignments_quantity_check
    check (quantity >= 0),
  add constraint seller_consignments_status_check
    check (status in ('held_by_seller', 'partially_sold', 'fully_sold', 'returned_to_manager', 'returned_to_factory', 'closed', 'cancelled')),
  add constraint seller_consignments_returned_weight_check
    check (returned_weight_grams >= 0),
  add constraint seller_consignments_returned_qty_check
    check (returned_quantity >= 0),
  add constraint seller_consignments_weight_integrity_check
    check (original_base_weight_grams = 0 or base_weight_grams + returned_weight_grams <= original_base_weight_grams + 0.0002);

-- Fix inconsistent status on CONS-BC-82044FBF if piece is held_by_seller
update public.seller_consignments sc
   set status = 'held_by_seller',
       sold_quantity = 0
 where sc.consignment_no = 'CONS-BC-82044FBF'
   and sc.status = 'fully_sold'
   and exists (
     select 1 from public.consignment_pieces cp
      where cp.consignment_id = sc.id and cp.status = 'held_by_seller'
   );

-- -------------------------------------------------------------------------
-- PART 2: HARDENED rpc_return_piece_to_manager
-- -------------------------------------------------------------------------
drop function if exists public.rpc_return_piece_to_manager(uuid, text, text);

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
  v_new_rem_qty   integer;
  v_new_rem_w     numeric(14, 4);
  v_new_rem_obl   numeric(14, 4);
  v_new_status    text;
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
    raise exception 'Faqat sotuvchi javonidagi (sotilmagan) mahsulotni boshqaruvchiga qaytarish mumkin. Hozirgi holat: %', v_piece.status;
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

  -- 3. Lock parent consignment
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;

  if not found then
    raise exception 'Ushbu donaga tegishli konsignatsiya yozuvi topilmadi';
  end if;

  -- Dynamic seller markup from piece or consignment (NOT hardcoded 12%)
  v_seller_markup := coalesce(v_piece.seller_markup_pct, v_consign.seller_markup_pct, 12.00);
  v_deduct_obl := round((v_piece.weight_grams * (1.0 + v_seller_markup / 100.0))::numeric, 4);

  -- 4. Update piece status to returned_to_manager
  update public.consignment_pieces
     set status                 = 'returned_to_manager',
         returned_to_manager_at = now(),
         notes                  = coalesce(notes, '') || case when notes is not null then ' | ' else '' end ||
                                  'BOSHQARUVCHIGA QAYTARILDI: ' || coalesce(p_notes, 'Sotilmagan tovar qaytarildi') || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')',
         updated_at             = now()
   where id = v_piece.id;

  -- 5. Calculate new active balances for parent consignment
  v_new_rem_qty := greatest(0, coalesce(v_consign.quantity, 1) - 1);
  v_new_rem_w   := round(greatest(0, coalesce(v_consign.base_weight_grams, 0) - v_piece.weight_grams)::numeric, 4);
  v_new_rem_obl := round(greatest(0, coalesce(v_consign.seller_obligation_g, 0) - v_deduct_obl)::numeric, 4);

  if v_new_rem_qty = 0 and coalesce(v_consign.sold_quantity, 0) = 0 then
    v_new_status := 'returned_to_manager';
  elsif v_new_rem_qty = 0 and coalesce(v_consign.sold_quantity, 0) > 0 then
    v_new_status := 'fully_sold';
  elsif coalesce(v_consign.sold_quantity, 0) > 0 then
    v_new_status := 'partially_sold';
  else
    v_new_status := 'held_by_seller';
  end if;

  update public.seller_consignments
     set returned_quantity              = coalesce(returned_quantity, 0) + 1,
         returned_to_factory_quantity   = coalesce(returned_to_factory_quantity, 0) + 1,
         returned_weight_grams          = round((coalesce(returned_weight_grams, 0) + v_piece.weight_grams)::numeric, 4),
         returned_to_factory_gold_grams = round((coalesce(returned_to_factory_gold_grams, 0) + v_piece.weight_grams)::numeric, 4),
         returned_seller_obligation_g   = round((coalesce(returned_seller_obligation_g, 0) + v_deduct_obl)::numeric, 4),
         base_weight_grams              = v_new_rem_w,
         seller_obligation_g            = v_new_rem_obl,
         quantity                       = v_new_rem_qty,
         status                         = v_new_status,
         updated_at                     = now()
   where id = v_consign.id;

  -- 6. Restore manager physical stock on factory receipt (if linked)
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

  -- 7. Atomically synchronize manager physical vault stock
  perform public._get_or_create_manager_vault(v_caller_org);
  update public.manager_vault_account
     set manager_physical_stock_g = public.get_manager_available_stock_grams(v_caller_org),
         updated_at = now()
   where organization_id = v_caller_org;

  -- 8. Recalculate seller responsibility atomically
  perform public.recalc_seller_gold_account(v_piece.seller_id, v_caller_org);

  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_piece.seller_id and organization_id = v_caller_org;

  -- 9. Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) values (
    v_caller_org, 'consignment_pieces', v_piece.id::text, 'RETURN_PIECE_TO_MANAGER', auth.uid(),
    jsonb_build_object(
      'piece_id', v_piece.id,
      'model_code', v_piece.model_code,
      'model_name', v_piece.model_name,
      'weight_grams', v_piece.weight_grams,
      'seller_markup_pct', v_seller_markup,
      'seller_obligation_deducted_g', v_deduct_obl,
      'seller_id', v_piece.seller_id,
      'new_seller_owes_manager_g', coalesce(v_seller_acc.seller_owes_manager_g, 0),
      'new_bozor_qarzi_signed_g', coalesce(v_seller_acc.bozor_qarzi_signed_g, 0),
      'consignment_new_status', v_new_status,
      'notes', p_notes
    )
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code,
    'model_name', v_piece.model_name,
    'weight_grams', v_piece.weight_grams,
    'seller_markup_pct', v_seller_markup,
    'seller_obligation_deducted_g', v_deduct_obl,
    'seller_id', v_piece.seller_id,
    'seller_owes_manager_g', coalesce(v_seller_acc.seller_owes_manager_g, 0),
    'bozor_qarzi_signed_g', coalesce(v_seller_acc.bozor_qarzi_signed_g, 0),
    'new_status', 'returned_to_manager',
    'consignment_status', v_new_status
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_return_piece_to_manager', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_return_piece_to_manager(uuid, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- PART 3: HARDEN rpc_reverse_jewelry_sale (Consignment Status Sync)
-- -------------------------------------------------------------------------
-- When a sale is reversed, ensure the parent consignment is reopened from fully_sold
create or replace function public.rpc_reverse_jewelry_sale(
  p_sale_id         uuid,
  p_reversal_reason text default null,
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
  v_sale          public.jewelry_sales%rowtype;
  v_client_acc    public.client_gold_accounts%rowtype;
  v_reason        text := nullif(btrim(p_reversal_reason), '');
  v_piece         public.consignment_pieces%rowtype;
  v_consign       public.seller_consignments%rowtype;
  v_applied_sett  public.gold_settlements%rowtype;
  v_existing      jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi',
    'accountant', 'buxgalter'
  ]);

  if v_reason is null then
    raise exception 'Savdoni bekor qilish sababi (reversal reason) kiritilishi shart';
  end if;

  select * into v_sale
    from public.jewelry_sales
   where id = p_sale_id and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Bekor qilinadigan savdo yozuvi topilmadi (%)', p_sale_id;
  end if;

  if v_sale.status in ('cancelled', 'reversed') then
    raise exception 'Ushbu savdo allaqachon bekor qilingan (Holat: %)', v_sale.status;
  end if;

  -- 1. Check if customer made active payments specifically applied to this sale
  for v_applied_sett in
    select * from public.gold_settlements
     where sale_id = v_sale.id
       and organization_id = v_caller_org
       and status not in ('reversed', 'cancelled')
  loop
    raise exception 'Savdoni bekor qilib bo''lmaydi: Ushbu savdoga to''lov bog''langan (% — % g). Avval to''lovni bekor qiling.',
      v_applied_sett.settlement_no, v_applied_sett.applied_to_debt_grams;
  end loop;

  -- 2. Deduct customer debt generated by this sale
  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_sale.customer_id and organization_id = v_caller_org
   for update;

  if found then
    update public.client_gold_accounts
       set current_debt_grams = round(greatest(0, current_debt_grams - v_sale.remaining_gold_grams)::numeric, 4),
           total_purchased_gold_grams = round(greatest(0, total_purchased_gold_grams - v_sale.client_gold_due_grams)::numeric, 4),
           updated_at = now()
     where id = v_client_acc.id;
  end if;

  -- 3. If a physical piece was sold, restore it to seller hand
  select * into v_piece
    from public.consignment_pieces
   where sale_id = v_sale.id and organization_id = v_caller_org
   for update;

  if found then
    update public.consignment_pieces
       set status = 'held_by_seller',
           sale_id = null,
           sold_at = null,
           updated_at = now()
     where id = v_piece.id;

    -- Reopen parent consignment if it was marked fully_sold
    if v_piece.consignment_id is not null then
      select * into v_consign
        from public.seller_consignments
       where id = v_piece.consignment_id
       for update;

      if found then
        update public.seller_consignments
           set sold_quantity = greatest(0, coalesce(sold_quantity, 1) - 1),
               status = case
                          when coalesce(sold_quantity, 1) - 1 <= 0 then 'held_by_seller'
                          else 'partially_sold'
                        end,
               updated_at = now()
         where id = v_consign.id;
      end if;
    end if;
  end if;

  -- 4. Mark sale as reversed
  update public.jewelry_sales
     set status = 'reversed',
         notes = coalesce(notes, '') || ' [BEKOR QILINDI: ' || v_reason || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')]',
         updated_at = now()
   where id = v_sale.id;

  -- 5. Recalculate seller responsibility
  perform public.recalc_seller_gold_account(v_sale.seller_id, v_caller_org);

  -- 6. Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) values (
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

  return jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale.id,
    'sale_no', v_sale.sale_no,
    'reversed_debt_g', v_sale.remaining_gold_grams,
    'restored_piece_id', v_piece.id,
    'message', 'Savdo muvaffaqiyatli bekor qilindi'
  );
end;
$$;

grant execute on function public.rpc_reverse_jewelry_sale(uuid, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- PART 4: RPC RECORD FINANCIAL TRANSACTION PARAMETER PARITY
-- -------------------------------------------------------------------------
-- Drop old signatures to avoid PostgREST 42P13
drop function if exists public.rpc_record_financial_transaction(text, text, numeric, text, text, text, numeric, numeric, text);
drop function if exists public.rpc_record_financial_transaction(text, text, numeric, text, text, text, numeric, numeric, text, numeric, numeric, uuid, uuid, text, integer);

-- Relax/update till-currency check constraint to support all valid gold and cash representations
alter table public.financial_transactions drop constraint if exists chk_financial_transactions_till_currency;
alter table public.financial_transactions
  add constraint chk_financial_transactions_till_currency check (
    (source_till in ('manager_uzs', 'seller_till_uzs') and currency in ('UZS', 'CASH_UZS')) or
    (source_till in ('manager_usd', 'seller_till_usd') and currency in ('USD', 'CASH_USD')) or
    (source_till in ('manager_vault_gold') and currency in ('585_GOLD', 'GRAMS_585')) or
    (source_till in ('manager_scrap', 'seller_till_scrap') and currency in ('SCRAP_GOLD', '585_GOLD', 'FINE_GOLD', 'GRAMS_585')) or
    (source_till in ('manager_fine_gold') and currency in ('FINE_GOLD', '585_GOLD', 'SCRAP_GOLD', 'PURE_GOLD', 'GRAMS_585', 'GRAMS_FINE')) or
    (source_till in ('manager_finished') and currency in ('FINISHED_GOODS', '585_GOLD', 'GRAMS_585'))
  );

-- Enhanced signature accepting BOTH p_physical_weight AND p_physical_weight_g
create or replace function public.rpc_record_financial_transaction(
  p_transaction_type  text,
  p_source_till       text,
  p_amount            numeric,
  p_currency          text,
  p_category          text default null,
  p_notes             text default null,
  p_gold_rate         numeric default null,
  p_usd_rate          numeric default null,
  p_idempotency_key   text default null,
  p_physical_weight   numeric default null,
  p_physical_weight_g numeric default null,
  p_gold_proba        numeric default null,
  p_seller_id         uuid default null,
  p_model_id          uuid default null,
  p_product_name      text default null,
  p_quantity          integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id          uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_today           date := (timezone('Asia/Tashkent', now()))::date;
  v_tx_id           uuid;
  v_tx_no           text;
  v_amt             numeric(18, 4);
  v_cur             text := upper(btrim(p_currency));
  v_type            text := lower(btrim(p_transaction_type));
  v_till            text := lower(btrim(p_source_till));
  v_rate_585        numeric(18, 2);
  v_rate_usd        numeric(18, 2);
  v_equiv_585       numeric(14, 4);
  v_fine_g          numeric(14, 4);
  v_phys_w          numeric(14, 4);
  v_proba           numeric(6, 2);
  v_vault           public.manager_vault_account%rowtype;
  v_existing        jsonb;
  v_payload         jsonb;
  v_rec_no          text;
  v_receipt_id      uuid;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- Normalize currency representations
  if v_cur in ('GRAMS_585', '585', 'G585') then
    v_cur := '585_GOLD';
  elsif v_cur in ('GRAMS_FINE', 'FINE', '995', '9999', 'PURE', 'PURE_GOLD') then
    v_cur := 'FINE_GOLD';
  elsif v_cur in ('SCRAP', 'LOM') then
    v_cur := 'SCRAP_GOLD';
  elsif v_cur in ('FINISHED') then
    v_cur := 'FINISHED_GOODS';
  elsif v_cur in ('CASH_UZS') then
    v_cur := 'UZS';
  elsif v_cur in ('CASH_USD') then
    v_cur := 'USD';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id from public.employees where user_id = auth.uid() and organization_id = v_org_id limit 1;
  end if;

  v_amt := round(coalesce(p_amount, 0)::numeric, 4);
  if v_amt <= 0 then
    raise exception 'Tranzaksiya summasi yoki miqdori 0 dan katta bo''lishi shart';
  end if;

  -- Unified physical weight resolution (accepts both p_physical_weight and p_physical_weight_g)
  v_phys_w := round(coalesce(p_physical_weight, p_physical_weight_g, v_amt)::numeric, 4);
  v_proba  := round(coalesce(p_gold_proba, 585.0)::numeric, 2);

  v_payload := jsonb_build_object(
    'type', v_type,
    'source_till', v_till,
    'amount', v_amt,
    'currency', v_cur,
    'physical_weight', v_phys_w,
    'gold_proba', v_proba
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_financial_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Gold and USD rate resolution
  if p_gold_rate is not null and p_gold_rate > 0 then
    v_rate_585 := round(p_gold_rate::numeric, 2);
  else
    select rate_per_gram into v_rate_585
      from public.daily_gold_rates
     where organization_id = v_org_id
     order by rate_date desc, created_at desc limit 1;
    v_rate_585 := coalesce(v_rate_585, 880000);
  end if;

  if p_usd_rate is not null and p_usd_rate > 0 then
    v_rate_usd := round(p_usd_rate::numeric, 2);
  else
    select rate_to_uzs into v_rate_usd
      from public.currency_rates
     where organization_id = v_org_id and from_currency = 'USD'
     order by rate_date desc, created_at desc limit 1;
    v_rate_usd := coalesce(v_rate_usd, 12800);
  end if;

  -- 585 Gold Equivalent Calculation
  if v_cur in ('UZS', 'CASH_UZS') then
    v_equiv_585 := round((v_amt / v_rate_585)::numeric, 4);
    v_fine_g    := round((v_equiv_585 * 0.585)::numeric, 4);
  elsif v_cur in ('USD', 'CASH_USD') then
    v_equiv_585 := round(((v_amt * v_rate_usd) / v_rate_585)::numeric, 4);
    v_fine_g    := round((v_equiv_585 * 0.585)::numeric, 4);
  elsif v_cur in ('SCRAP_GOLD', '585_GOLD') then
    v_equiv_585 := round(v_phys_w * (v_proba / 585.0), 4);
    v_fine_g    := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);
  elsif v_cur in ('FINE_GOLD', 'PURE_GOLD', '995_GOLD', '999_GOLD') then
    v_proba     := coalesce(p_gold_proba, 995.0);
    v_fine_g    := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);
    v_equiv_585 := round((v_phys_w * (v_proba / 585.0))::numeric, 4);
  elsif v_cur in ('FINISHED_GOODS') then
    v_equiv_585 := round(v_phys_w * (v_proba / 585.0), 4);
    v_fine_g    := round((v_phys_w * (v_proba / 1000.0))::numeric, 4);
  else
    v_equiv_585 := round(v_amt::numeric, 4);
    v_fine_g    := round((v_equiv_585 * 0.585)::numeric, 4);
  end if;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  -- 1. Apply asset balance updates atomically (No fake profit!)
  if v_type in ('capital_in', 'capital_contribution') then
    if v_till in ('manager_fine_gold', 'manager_capital_pure_gold', 'manager_vault_pure_gold') or v_cur in ('FINE_GOLD', 'PURE_GOLD') then
      -- Pure cast gold goes to pure gold capital safe (NOT affinage output!)
      update public.manager_vault_account
         set manager_capital_pure_gold_g      = round(manager_capital_pure_gold_g + v_equiv_585, 4),
             manager_capital_pure_gold_fine_g = round(manager_capital_pure_gold_fine_g + v_phys_w, 4),
             updated_at                       = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_scrap', 'manager_vault_scrap') then
      update public.manager_vault_account
         set manager_scrap_grams    = round(manager_scrap_grams + v_equiv_585, 4),
             manager_scrap_physical_g = round(coalesce(manager_scrap_physical_g, 0) + v_phys_w, 4),
             manager_scrap_585_eq_g   = round(coalesce(manager_scrap_585_eq_g, 0) + v_equiv_585, 4),
             updated_at             = now()
       where organization_id = v_org_id;

    elsif v_till in ('seller_till_scrap') and p_seller_id is not null then
      update public.seller_gold_accounts
         set seller_till_scrap_grams      = round(seller_till_scrap_grams + v_equiv_585, 4),
             seller_till_scrap_physical_g = round(coalesce(seller_till_scrap_physical_g, 0) + v_phys_w, 4),
             seller_till_scrap_585_eq_g   = round(coalesce(seller_till_scrap_585_eq_g, 0) + v_equiv_585, 4),
             updated_at                   = now()
       where seller_id = p_seller_id and organization_id = v_org_id;

    elsif v_till in ('manager_finished', 'manager_stock') or v_cur = 'FINISHED_GOODS' then
      v_rec_no := 'CAP-FIN-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      insert into public.factory_receipts (
        organization_id, receipt_no, product_name, quantity, original_physical_g,
        available_physical_g, transferred_physical_g, proba, factory_markup_pct,
        factory_obligation_g, status, notes
      ) values (
        v_org_id, v_rec_no, coalesce(p_product_name, 'Kapital Tayyor Mahsulot'),
        greatest(1, coalesce(p_quantity, 1)), v_phys_w, v_phys_w, 0,
        v_proba, 0.0, 0.0, 'in_manager_stock',
        'KAPITAL KIRIMI: Ta''sischi hissasi sifatida kiritilgan mahsulot (Zavod qarzi yaratilmaydi)'
      ) returning id into v_receipt_id;

      update public.manager_vault_account
         set manager_finished_capital_g = round(coalesce(manager_finished_capital_g, 0) + v_phys_w, 4),
             manager_physical_stock_g   = public.get_manager_available_stock_grams(v_org_id),
             updated_at                 = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_uzs', 'manager_cash') then
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount + v_amt, 2),
             updated_at          = now()
       where organization_id = v_org_id;

    elsif v_till in ('seller_till_uzs') and p_seller_id is not null then
      update public.seller_gold_accounts
         set seller_till_cash_amount = round(seller_till_cash_amount + v_amt, 2),
             updated_at              = now()
       where seller_id = p_seller_id and organization_id = v_org_id;

    elsif v_till in ('manager_usd') then
      update public.manager_vault_account
         set manager_usd_amount = round(manager_usd_amount + v_amt, 2),
             updated_at         = now()
       where organization_id = v_org_id;

    elsif v_till in ('seller_till_usd') and p_seller_id is not null then
      update public.seller_gold_accounts
         set seller_till_usd_amount = round(coalesce(seller_till_usd_amount, 0) + v_amt, 2),
             updated_at             = now()
       where seller_id = p_seller_id and organization_id = v_org_id;

    else
      -- Default to manager vault gold
      update public.manager_vault_account
         set manager_capital_pure_gold_g = round(manager_capital_pure_gold_g + v_equiv_585, 4),
             updated_at                  = now()
       where organization_id = v_org_id;
    end if;

  elsif v_type in ('capital_out', 'capital_distribution', 'expense', 'business_expense') then
    if v_till in ('manager_uzs', 'manager_cash') then
      if v_vault.manager_cash_amount < v_amt then
        raise exception 'Boshqaruvchi kassasida yetarli naqd pul yo''q (Mavjud: % UZS, Talab: % UZS)',
          v_vault.manager_cash_amount, v_amt;
      end if;
      update public.manager_vault_account
         set manager_cash_amount = round(manager_cash_amount - v_amt, 2),
             updated_at          = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_usd') then
      if v_vault.manager_usd_amount < v_amt then
        raise exception 'Boshqaruvchi kassasida yetarli USD yo''q (Mavjud: $% , Talab: $%)',
          v_vault.manager_usd_amount, v_amt;
      end if;
      update public.manager_vault_account
         set manager_usd_amount = round(manager_usd_amount - v_amt, 2),
             updated_at         = now()
       where organization_id = v_org_id;

    elsif v_till in ('manager_scrap') then
      if v_vault.manager_scrap_grams < v_equiv_585 then
        raise exception 'Boshqaruvchi seyfida yetarli lom yo''q (Mavjud: % g, Talab: % g)',
          v_vault.manager_scrap_grams, v_equiv_585;
      end if;
      update public.manager_vault_account
         set manager_scrap_grams = round(manager_scrap_grams - v_equiv_585, 4),
             updated_at          = now()
       where organization_id = v_org_id;
    end if;
  end if;

  -- 2. Insert transaction record
  v_tx_no := 'FTX-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.financial_transactions (
    organization_id, transaction_no, transaction_date, transaction_type,
    source_till, amount_num, currency, gold_rate_applied, usd_rate_applied,
    equiv_585_grams, category, notes, recorded_by, idempotency_key,
    physical_weight_grams, gold_proba, seller_id, status
  ) values (
    v_org_id, v_tx_no, v_today, v_type,
    v_till, v_amt, v_cur, v_rate_585, v_rate_usd,
    v_equiv_585, p_category, p_notes, v_caller_emp_id, p_idempotency_key,
    v_phys_w, v_proba, p_seller_id, 'confirmed'
  ) returning id into v_tx_id;

  -- 3. Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) values (
    v_org_id, 'financial_transactions', v_tx_id::text, 'RECORD_FINANCIAL_TRANSACTION', auth.uid(),
    jsonb_build_object(
      'transaction_no', v_tx_no,
      'type', v_type,
      'source_till', v_till,
      'amount', v_amt,
      'currency', v_cur,
      'equiv_585_grams', v_equiv_585,
      'physical_weight_grams', v_phys_w,
      'gold_proba', v_proba
    )
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'id', v_tx_id,
    'transaction_id', v_tx_id,
    'transaction_no', v_tx_no,
    'equiv_585_grams', v_equiv_585,
    'fine_gold_grams', v_fine_g,
    'physical_weight_g', v_phys_w,
    'gold_proba', v_proba
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_financial_transaction', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_record_financial_transaction(text, text, numeric, text, text, text, numeric, numeric, text, numeric, numeric, numeric, uuid, uuid, text, integer) to authenticated, service_role, anon;

-- Reversal of financial transactions
create or replace function public.rpc_reverse_financial_transaction(
  p_transaction_id uuid,
  p_reason         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
         reversed_by = auth.uid(),
         reversal_reason = v_reason,
         updated_at = now()
   where id = v_tx.id;

  return jsonb_build_object(
    'status', 'ok',
    'transaction_id', v_tx.id,
    'message', 'Operatsiya bekor qilindi'
  );
end;
$$;

grant execute on function public.rpc_reverse_financial_transaction(uuid, text) to authenticated;

-- -------------------------------------------------------------------------
-- PART 5: FACTORY RECEIPT ASSAY (PROBA) PARITY
-- -------------------------------------------------------------------------
drop function if exists public.rpc_record_factory_receipt(text, integer, numeric, numeric, numeric, uuid, uuid, text, text);

create or replace function public.rpc_record_factory_receipt(
  p_product_name        text,
  p_quantity            integer default 1,
  p_original_physical_g numeric default 0,
  p_proba               numeric default 585,
  p_factory_markup_pct  numeric default 8.0,
  p_product_id          uuid default null,
  p_model_id            uuid default null,
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
  v_caller_role     text := public.current_employee_role_text();
  v_receipt_no      text;
  v_receipt_id      uuid;
  v_phys_g          numeric(14, 4);
  v_pr              numeric(6, 2);
  v_base_585_g      numeric(14, 4);
  v_f_pct           numeric(6, 2);
  v_f_due_g         numeric(14, 4);
  v_vault           public.manager_vault_account;
  v_existing        jsonb;
  v_new_obligation  numeric(14, 4);
  v_net_balance     numeric(14, 4);
  v_cur_obligation  numeric(14, 4);
  v_cur_advance     numeric(14, 4);
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_caller_role in ('seller', 'sotuvchi', 'sales', 'worker', 'viewer') or v_caller_role is null then
    raise exception 'Ruxsat etilmadi: Sotuvchi yoki begona foydalanuvchi zavod tovar kirimini saqlay olmaydi (Rol: %)', v_caller_role
      using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'action', 'record_factory_receipt',
      'product_name', p_product_name,
      'physical_weight_g', round(coalesce(p_original_physical_g, 0)::numeric, 4),
      'proba', coalesce(p_proba, 585)
    ) into v_existing;
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_factory_receipt', v_existing);
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_phys_g := round(coalesce(p_original_physical_g, 0)::numeric, 4);
  if v_phys_g <= 0 then
    raise exception 'Zavod kirimi fizik vazni 0 dan katta bo''lishi shart';
  end if;

  v_pr := round(coalesce(p_proba, 585.0)::numeric, 2);
  if v_pr < 375.0 or v_pr > 1000.0 then
    raise exception 'Noto''g''ri proba kiritildi: %. Ruxsat etilgan proba: 375 dan 1000 gacha.', v_pr;
  end if;

  -- Unified 585 equivalent formula: base_585 = physical * (proba / 585.0)
  v_base_585_g := round(v_phys_g * (v_pr / 585.0), 4);

  -- Factory gold due (obligation) based on 585 equivalent
  v_f_pct   := round(coalesce(p_factory_markup_pct, 8.0)::numeric, 2);
  v_f_due_g := round((v_base_585_g * (1.0 + v_f_pct / 100.0))::numeric, 4);

  v_receipt_no := 'ZVD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.factory_receipts (
    organization_id, receipt_no, product_id, model_id, product_name,
    quantity, original_physical_g, available_physical_g, transferred_physical_g,
    proba, factory_markup_pct, factory_obligation_g, status, notes
  ) values (
    v_org_id, v_receipt_no, p_product_id, p_model_id, p_product_name,
    greatest(1, coalesce(p_quantity, 1)), v_phys_g, v_phys_g, 0,
    v_pr, v_f_pct, v_f_due_g, 'in_manager_stock', p_notes
  ) returning id into v_receipt_id;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  v_new_obligation := round(v_vault.total_factory_obligation_g + v_f_due_g, 4);
  v_net_balance := round(v_new_obligation - v_vault.total_factory_handed_over_g, 4);

  if v_net_balance >= 0 then
    v_cur_obligation := v_net_balance;
    v_cur_advance := 0;
  else
    v_cur_obligation := 0;
    v_cur_advance := round(abs(v_net_balance), 4);
  end if;

  update public.manager_vault_account
     set total_factory_received_g     = round(total_factory_received_g + v_phys_g, 4),
         total_factory_obligation_g   = v_new_obligation,
         current_factory_obligation_g = v_cur_obligation,
         current_factory_advance_g    = v_cur_advance,
         manager_physical_stock_g     = public.get_manager_available_stock_grams(v_org_id),
         updated_at                   = now()
   where organization_id = v_org_id
   returning * into v_vault;

  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) values (
    v_org_id, 'factory_receipts', v_receipt_id::text, 'RECORD_RECEIPT', auth.uid(),
    jsonb_build_object(
      'receipt_no', v_receipt_no,
      'product_name', p_product_name,
      'physical_weight_g', v_phys_g,
      'proba', v_pr,
      'base_585_equivalent_g', v_base_585_g,
      'markup_pct', v_f_pct,
      'factory_obligation_g', v_f_due_g,
      'current_factory_obligation_g', v_vault.current_factory_obligation_g,
      'current_factory_advance_g', v_vault.current_factory_advance_g
    )
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'physical_weight_g', v_phys_g,
    'proba', v_pr,
    'base_585_equivalent_g', v_base_585_g,
    'factory_markup_pct', v_f_pct,
    'factory_obligation_g', v_f_due_g,
    'current_factory_obligation_g', v_vault.current_factory_obligation_g,
    'current_factory_advance_g', v_vault.current_factory_advance_g,
    'manager_physical_stock_g', v_vault.manager_physical_stock_g
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_factory_receipt', v_existing, v_existing);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_factory_receipt(text, integer, numeric, numeric, numeric, uuid, uuid, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- PART 6: REFINING (AFINAJ) REVERSAL & PARITY HARDENING
-- -------------------------------------------------------------------------
alter table public.refining_batches
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.employees(id) on delete set null,
  add column if not exists reversal_reason text,
  add column if not exists updated_at timestamptz default now();

alter table public.refining_batches drop constraint if exists refining_batches_status_check;
alter table public.refining_batches
  add constraint refining_batches_status_check
  check (status in ('pending', 'completed', 'cancelled', 'reversed'));

create or replace function public.rpc_reverse_refining_batch(
  p_batch_id uuid,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_batch      public.refining_batches%rowtype;
  v_vault      public.manager_vault_account%rowtype;
  v_reason     text := nullif(btrim(p_reason), '');
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if v_reason is null then
    raise exception 'Afinajni bekor qilish sababi (reason) kiritilishi shart';
  end if;

  select * into v_batch
    from public.refining_batches
   where id = p_batch_id and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Bekor qilinadigan afinaj partiyasi topilmadi (%)', p_batch_id;
  end if;

  if v_batch.status in ('reversed', 'cancelled') then
    raise exception 'Ushbu afinaj partiyasi allaqachon bekor qilingan';
  end if;

  perform public._get_or_create_manager_vault(v_caller_org);
  select * into v_vault from public.manager_vault_account where organization_id = v_caller_org for update;

  if coalesce(v_vault.manager_refined_gold_grams, 0) < v_batch.output_585_equiv_grams then
    raise exception 'Afinajni bekor qilib bo''lmaydi: Seyfda yetarli toza oltin yo''q (Mavjud: % g, Talab: % g)',
      v_vault.manager_refined_gold_grams, v_batch.output_585_equiv_grams;
  end if;

  -- Restore input scrap, deduct produced fine gold and 585 eq.
  -- Pateriya is reversed by restoring exactly what went in!
  update public.manager_vault_account
     set manager_scrap_grams             = round(manager_scrap_grams + v_batch.input_scrap_grams, 4),
         manager_scrap_physical_g        = round(coalesce(manager_scrap_physical_g, 0) + v_batch.input_scrap_grams, 4),
         manager_scrap_585_eq_g          = round(coalesce(manager_scrap_585_eq_g, 0) + coalesce(v_batch.input_585_equiv_grams, v_batch.input_scrap_grams), 4),
         manager_refined_gold_grams      = round(greatest(0, manager_refined_gold_grams - v_batch.output_585_equiv_grams), 4),
         manager_refined_gold_fine_grams = round(greatest(0, coalesce(manager_refined_gold_fine_grams, 0) - v_batch.output_fine_grams), 4),
         updated_at                      = now()
   where organization_id = v_caller_org;

  update public.refining_batches
     set status          = 'reversed',
         reversed_at     = now(),
         reversed_by     = auth.uid(),
         reversal_reason = v_reason,
         updated_at      = now()
   where id = v_batch.id;

  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) values (
    v_caller_org, 'refining_batches', v_batch.id::text, 'REVERSE_REFINING_BATCH', auth.uid(),
    jsonb_build_object(
      'batch_no', v_batch.batch_no,
      'reversed_loss_grams', v_batch.total_loss_grams,
      'restored_scrap_grams', v_batch.input_scrap_grams,
      'deducted_refined_grams', v_batch.output_585_equiv_grams,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch.id,
    'batch_no', v_batch.batch_no,
    'reversed_loss_grams', v_batch.total_loss_grams,
    'message', 'Afinaj partiyasi muvaffaqiyatli bekor qilindi va lom seyfga qaytarildi'
  );
end;
$$;

grant execute on function public.rpc_reverse_refining_batch(uuid, text) to authenticated;

-- -------------------------------------------------------------------------
-- PART 7: BARCODE PIECE SALE RETURN PAYLOAD PARITY
-- -------------------------------------------------------------------------
-- Drop existing overloads to avoid Postgres 42725
drop function if exists public.rpc_record_barcode_piece_sale(uuid, uuid, numeric, text, text);
drop function if exists public.rpc_record_barcode_piece_sale(uuid, uuid, numeric, text, text, uuid, numeric);
drop function if exists public.rpc_record_barcode_piece_sale(uuid, uuid, numeric, text, text, uuid, numeric, uuid);
drop function if exists public.rpc_record_barcode_piece_sale(uuid, uuid, uuid, uuid, numeric, numeric, text, text);

create or replace function public.rpc_record_barcode_piece_sale(
  p_customer_id       uuid,
  p_seller_id         uuid default null,
  p_piece_id          uuid default null,
  p_model_id          uuid default null,
  p_weight_grams      numeric default null,
  p_client_markup_pct numeric default null,
  p_notes             text default null,
  p_idempotency_key   text default null
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
  v_client_pct        numeric(6, 2);
  v_base_w            numeric(14, 4);
  v_factory_due       numeric(14, 4);
  v_client_due        numeric(14, 4);
  v_spread            numeric(14, 4);
  v_client_acc        public.client_gold_accounts%rowtype;
  v_avail_adv         numeric(14, 4) := 0;
  v_apply_adv         numeric(14, 4) := 0;
  v_net_rem_due       numeric(14, 4);
  v_sale_id           uuid;
  v_sale_no           text;
  v_existing          jsonb;
  v_payload           jsonb;
  v_remaining_pieces  int;
  v_avail_stock       numeric(14, 4);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'sales', 'seller', 'sotuvchi', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  v_payload := jsonb_build_object(
    'action', 'record_barcode_piece_sale',
    'customer_id', p_customer_id,
    'piece_id', p_piece_id,
    'model_id', p_model_id,
    'weight_grams', p_weight_grams,
    'seller_id', p_seller_id
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_barcode_piece_sale', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_customer
    from public.customers
   where id = p_customer_id and organization_id = v_caller_org;
  if not found then
    raise exception 'Mijoz topilmadi (%)', p_customer_id;
  end if;

  -- Resolve seller
  if p_seller_id is not null then
    select * into v_seller from public.employees where id = p_seller_id and organization_id = v_caller_org limit 1;
  else
    select * into v_seller from public.employees where user_id = auth.uid() and organization_id = v_caller_org limit 1;
  end if;

  if v_seller.id is null and v_customer.seller_id is not null then
    select * into v_seller from public.employees where id = v_customer.seller_id and organization_id = v_caller_org limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  v_client_pct := round(coalesce(p_client_markup_pct, 15.00)::numeric, 2);

  -- Fetch piece
  if p_piece_id is not null then
    select * into v_piece
      from public.consignment_pieces
     where id = p_piece_id and organization_id = v_caller_org
     for update;
  elsif p_model_id is not null and p_weight_grams is not null then
    select cp.* into v_piece
      from public.consignment_pieces cp
      join public.seller_consignments sc on sc.id = cp.consignment_id
     where cp.model_id = p_model_id
       and cp.weight_grams = round(p_weight_grams::numeric, 4)
       and cp.seller_id = v_seller.id
       and cp.status = 'held_by_seller'
       and cp.sale_id is null
       and sc.status not in ('fully_sold', 'returned_to_manager', 'cancelled')
       and coalesce(sc.sold_quantity, 0) < sc.original_quantity
       and cp.organization_id = v_caller_org
     order by cp.created_at asc
     limit 1
     for update of cp;
  else
    raise exception 'Mahsulot donasini aniqlash uchun piece_id yoki (model_id + weight_grams) talab qilinadi';
  end if;

  if not found or v_piece.id is null then
    raise exception 'Tanlangan mahsulot donasi sotuvchi javonida mavjud emas yoki allaqachon sotilgan';
  end if;

  if v_piece.sale_id is not null or v_piece.status = 'sold' then
    raise exception 'Bu mahsulot donasi (% — % g) allaqachon sotilgan (Sotuv ID: %)',
      v_piece.model_code, v_piece.weight_grams, coalesce(v_piece.sale_id::text, 'MAVJUD');
  end if;

  if v_piece.status <> 'held_by_seller' then
    raise exception 'Mahsulot sotuvga yaroqsiz holatda (Joriy holat: %)', v_piece.status;
  end if;

  v_base_w := v_piece.weight_grams;

  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;

  if not found then
    raise exception 'Konsignatsiya yozuvi topilmadi';
  end if;

  v_factory_due := round((v_base_w * (1.0 + coalesce(v_consign.factory_markup_pct, 0) / 100.0))::numeric, 4);
  v_client_due  := round((v_base_w * (1.0 + v_client_pct / 100.0))::numeric, 4);
  v_spread      := round((v_client_due - v_factory_due)::numeric, 4);

  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_customer.id and organization_id = v_caller_org
   for update;

  v_avail_adv := coalesce(v_client_acc.advance_balance_grams, 0);
  v_apply_adv := round(least(v_avail_adv, v_client_due), 4);
  v_net_rem_due := round(v_client_due - v_apply_adv, 4);

  v_sale_no := 'SALE-BC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.jewelry_sales (
    organization_id, sale_no, seller_id, customer_id, consignment_id,
    product_name, quantity, base_weight_grams, proba, factory_markup_pct,
    factory_gold_due_grams, client_markup_pct, client_gold_due_grams,
    markup_spread_grams, settled_gold_grams, remaining_gold_grams,
    status, sale_date, notes, sale_type, model_id, model_code,
    category, purity, seller_profit_spread_grams
  ) values (
    v_caller_org, v_sale_no, v_seller.id, v_customer.id, v_consign.id,
    v_piece.model_name, 1, v_base_w, coalesce(v_piece.purity, 585), coalesce(v_consign.factory_markup_pct, 0),
    v_factory_due, v_client_pct, v_client_due,
    v_spread, v_apply_adv, v_net_rem_due,
    case when v_net_rem_due <= 0 then 'fully_paid' when v_apply_adv > 0 then 'partially_paid' else 'open_debt' end,
    current_date, p_notes, 'piece', v_piece.model_id, v_piece.model_code,
    v_piece.category, v_piece.purity, v_spread
  ) returning id into v_sale_id;

  update public.consignment_pieces
     set status = 'sold',
         sale_id = v_sale_id,
         sold_at = now(),
         updated_at = now()
   where id = v_piece.id;

  -- Update consignment sold quantity
  update public.seller_consignments
     set sold_quantity = coalesce(sold_quantity, 0) + 1,
         status = case
                    when coalesce(sold_quantity, 0) + 1 >= quantity and quantity > 0 then 'fully_sold'
                    else 'partially_sold'
                  end,
         updated_at = now()
   where id = v_consign.id;

  -- Recalculate seller responsibility
  perform public.recalc_seller_gold_account(v_seller.id, v_caller_org);

  -- Update client account
  insert into public.client_gold_accounts (
    organization_id, customer_id, seller_id, total_purchased_gold_grams,
    total_settled_grams, current_debt_grams, advance_balance_grams, updated_at
  ) values (
    v_caller_org, v_customer.id, v_seller.id, v_client_due,
    v_apply_adv, v_net_rem_due, round(greatest(0, v_avail_adv - v_apply_adv), 4), now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_due)::numeric, 4),
    total_settled_grams        = round((client_gold_accounts.total_settled_grams + v_apply_adv)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_net_rem_due)::numeric, 4),
    advance_balance_grams      = round(greatest(0, client_gold_accounts.advance_balance_grams - v_apply_adv)::numeric, 4),
    updated_at                 = now();

  -- Return complete payload with model_name, weight_grams, and client_markup_pct
  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'model_name', v_piece.model_name,
    'model_code', v_piece.model_code,
    'weight_grams', v_base_w,
    'client_markup_pct', v_client_pct,
    'client_gold_due_grams', v_client_due,
    'gross_gold_due_grams', v_client_due,
    'advance_applied_grams', v_apply_adv,
    'net_remaining_debt_grams', v_net_rem_due,
    'remaining_gold_grams', v_net_rem_due,
    'piece_id', v_piece.id
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_barcode_piece_sale', v_existing, v_existing);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_barcode_piece_sale(uuid, uuid, uuid, uuid, numeric, numeric, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- PART 8: FULL TEST ACCOUNT RESET & RESTART FRESH WORKFLOW
-- -------------------------------------------------------------------------

alter table public.factory_gold_handovers
  add column if not exists status text not null default 'completed',
  add column if not exists updated_at timestamptz default now();

alter table public.factory_gold_handovers drop constraint if exists factory_gold_handovers_status_check;
alter table public.factory_gold_handovers
  add constraint factory_gold_handovers_status_check
  check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'reversed'));

-- 1. Preview function
create or replace function public.rpc_preview_full_test_reset()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_preview_token text;
  v_active_base   record;
  v_receipt_cnt   int;
  v_receipt_g     numeric(14, 4);
  v_consign_cnt   int;
  v_consign_g     numeric(14, 4);
  v_piece_cnt     int;
  v_sale_cnt      int;
  v_settle_cnt    int;
  v_refining_cnt  int;
  v_fintx_cnt     int;
  v_cust_debt_g   numeric(14, 4);
  v_seller_till_g numeric(14, 4);
  v_mgr_scrap_g   numeric(14, 4);
  v_mgr_fine_g    numeric(14, 4);
  v_mgr_cash      numeric(18, 2);
  v_preserved_emp int;
  v_preserved_cus int;
  v_preserved_mdl int;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  v_preview_token := 'RESET-PREV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- Active baseline
  select * into v_active_base
    from public.accounting_baselines
   where organization_id = v_caller_org and status = 'active'
   limit 1;

  -- Operational records counts
  select count(*), coalesce(sum(original_physical_g), 0)
    into v_receipt_cnt, v_receipt_g
    from public.factory_receipts
   where organization_id = v_caller_org and status <> 'reversed';

  select count(*), coalesce(sum(base_weight_grams), 0)
    into v_consign_cnt, v_consign_g
    from public.seller_consignments
   where organization_id = v_caller_org and status not in ('cancelled', 'returned_to_manager');

  select count(*) into v_piece_cnt
    from public.consignment_pieces
   where organization_id = v_caller_org and status not in ('cancelled', 'returned_to_manager');

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

  select coalesce(sum(current_debt_grams), 0) into v_cust_debt_g
    from public.client_gold_accounts
   where organization_id = v_caller_org;

  select coalesce(sum(seller_till_scrap_grams), 0) into v_seller_till_g
    from public.seller_gold_accounts
   where organization_id = v_caller_org;

  select coalesce(manager_scrap_grams, 0), coalesce(manager_refined_gold_grams, 0), coalesce(manager_cash_amount, 0)
    into v_mgr_scrap_g, v_mgr_fine_g, v_mgr_cash
    from public.manager_vault_account
   where organization_id = v_caller_org;

  -- Preserved master data counts
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
      'customer_active_debt_g', v_cust_debt_g,
      'seller_tills_scrap_g', v_seller_till_g,
      'manager_scrap_vault_g', v_mgr_scrap_g,
      'manager_refined_vault_g', v_mgr_fine_g,
      'manager_cash_vault_uzs', v_mgr_cash
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

-- 2. Execution function
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

  -- E. Return/cancel consignment pieces
  update public.consignment_pieces
     set status = 'returned_to_manager',
         sale_id = null,
         sold_at = null,
         returned_to_manager_at = v_rev_ts,
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status not in ('cancelled', 'returned_to_manager');
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

  -- M. Archive active baseline, unlocking new initial baseline setup
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
      'pieces_returned', v_piece_rev,
      'receipts_reversed', v_rcp_rev,
      'handovers_reversed', v_hnd_rev,
      'refining_reversed', v_ref_rev,
      'fintx_reversed', v_fintx_rev,
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
      'pieces_returned', v_piece_rev,
      'factory_receipts_reversed', v_rcp_rev,
      'factory_handovers_reversed', v_hnd_rev,
      'refining_batches_reversed', v_ref_rev,
      'financial_transactions_reversed', v_fintx_rev,
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

-- Notify postgrest schema cache
notify pgrst, 'reload schema';
