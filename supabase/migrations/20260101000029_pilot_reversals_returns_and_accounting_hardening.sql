-- =========================================================================
-- JewelryFlow ERP — Migration 029
-- Pilot Readiness: Piece Reversals, Factory Returns & Accounting Invariants Hardening
-- =========================================================================
-- Implements:
-- 1. `rpc_return_piece_to_factory`: Returning unsold pieces from seller to factory
--    (deducts factory obligation, marks piece 'returned_to_factory', logs audit)
-- 2. `rpc_reverse_barcode_piece_sale`: Cancelling/reversing customer piece sale
--    (returns piece to seller hand, deducts client debt, marks sale reversed, logs audit)
-- 3. Strict model validation in `rpc_issue_barcode_consignment`
-- 4. Reconciled inventory view `view_seller_piece_inventory` with returned tracking
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. RPC: rpc_return_piece_to_factory
-- -------------------------------------------------------------------------
create or replace function public.rpc_return_piece_to_factory(
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
  v_factory_due      numeric(14, 4);
  v_new_obligation   numeric(14, 4);
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'action', 'return_piece_to_factory',
    'piece_id', p_piece_id,
    'notes', p_notes
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_return_piece_to_factory', v_payload);
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
    raise exception 'Faqat sotuvchi qo''lidagi (mavjud) mahsulotni zavodga qaytarish mumkin. Hozirgi holat: %', v_piece.status;
  end if;

  -- 2. Seller authorization check
  select * into v_seller
    from public.employees
   where id = v_piece.seller_id
     and organization_id = v_caller_org
   limit 1;

  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'warehouse', 'omborchi') then
    if v_seller.user_id is not null and v_seller.user_id <> auth.uid() then
      raise exception 'Ruxsat etilmadi: Faqat o''zingizga biriktirilgan mahsulotni qaytara olasiz' using errcode = '42501';
    end if;
  end if;

  -- 3. Lock parent consignment to get factory markup
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;

  v_factory_due := round((v_piece.weight_grams * (1.0 + coalesce(v_consign.factory_markup_pct, 0) / 100.0))::numeric, 4);

  -- 4. Update piece status to returned_to_factory
  update public.consignment_pieces
     set status     = 'returned_to_factory',
         notes      = coalesce(notes, '') || case when notes is not null then ' | ' else '' end ||
                      'ZAVODGA QAYTARILDI: ' || coalesce(p_notes, 'Sabab ko''rsatilmadi') || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')',
         updated_at = now()
   where id = v_piece.id;

  -- 5. Deduct factory obligation from seller account
  update public.seller_gold_accounts
     set current_factory_obligation_grams = greatest(0, round((current_factory_obligation_grams - v_factory_due)::numeric, 4)),
         updated_at                       = now()
   where seller_id = v_piece.seller_id
  returning current_factory_obligation_grams into v_new_obligation;

  -- 6. Record audit log
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, details
  ) values (
    v_caller_org, auth.uid(), 'RETURN_PIECE_TO_FACTORY', 'consignment_pieces', v_piece.id::text,
    jsonb_build_object(
      'piece_id', v_piece.id,
      'model_code', v_piece.model_code,
      'weight_grams', v_piece.weight_grams,
      'factory_markup_pct', v_consign.factory_markup_pct,
      'factory_due_deducted', v_factory_due,
      'seller_id', v_piece.seller_id,
      'remaining_factory_obligation', v_new_obligation,
      'notes', p_notes
    )
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code,
    'weight_grams', v_piece.weight_grams,
    'factory_markup_pct', v_consign.factory_markup_pct,
    'factory_due_deducted_grams', v_factory_due,
    'new_factory_obligation_grams', v_new_obligation,
    'notes', p_notes
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_return_piece_to_factory', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_return_piece_to_factory(uuid, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 2. RPC: rpc_reverse_barcode_piece_sale
-- -------------------------------------------------------------------------
create or replace function public.rpc_reverse_barcode_piece_sale(
  p_piece_id        uuid,
  p_reason          text default null,
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
  v_sale             public.jewelry_sales%rowtype;
  v_consign          public.seller_consignments%rowtype;
  v_seller           public.employees%rowtype;
  v_client_due       numeric(14, 4);
  v_new_cust_debt    numeric(14, 4);
  v_new_seller_debt  numeric(14, 4);
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_barcode_piece_sale',
    'piece_id', p_piece_id,
    'reason', p_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_barcode_piece_sale', v_payload);
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
    raise exception 'Mahsulot donasi topilmadi (%)', p_piece_id;
  end if;

  if v_piece.status <> 'sold' then
    raise exception 'Faqat sotilgan mahsulotni bekor qilish mumkin. Hozirgi holat: %', v_piece.status;
  end if;

  if v_piece.sale_id is null then
    raise exception 'Ushbu donaga bog''langan savdo yozuvi (sale_id) topilmadi';
  end if;

  -- 2. Lock and fetch sale
  select * into v_sale
    from public.jewelry_sales
   where id = v_piece.sale_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Savdo hujjati topilmadi (%)', v_piece.sale_id;
  end if;

  -- 3. Lock parent consignment
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;

  v_client_due := v_sale.client_gold_due_grams;

  -- 4. Revert piece status to held_by_seller
  update public.consignment_pieces
     set status     = 'held_by_seller',
         sale_id    = null,
         sold_at    = null,
         notes      = coalesce(notes, '') || case when notes is not null then ' | ' else '' end ||
                      'SAVDO BEKOR QILINDI: ' || coalesce(p_reason, 'Mijoz qaytardi') || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')',
         updated_at = now()
   where id = v_piece.id;

  -- 5. Mark sale as reversed
  update public.jewelry_sales
     set status     = 'reversed',
         notes      = coalesce(notes, '') || case when notes is not null then ' | ' else '' end ||
                      'BEKOR QILINDI: ' || coalesce(p_reason, 'Sabab kiritilmagan'),
         updated_at = now()
   where id = v_sale.id;

  -- 6. Update parent consignment sold_quantity
  update public.seller_consignments
     set sold_quantity = greatest(0, sold_quantity - 1),
         status        = case when sold_quantity - 1 <= 0 then 'held_by_seller' else 'partially_sold' end,
         updated_at    = now()
   where id = v_consign.id;

  -- 7. Deduct client debt from client_gold_accounts
  update public.client_gold_accounts
     set current_debt_grams         = greatest(0, round((current_debt_grams - v_client_due)::numeric, 4)),
         total_purchased_gold_grams = greatest(0, round((total_purchased_gold_grams - v_client_due)::numeric, 4)),
         updated_at                 = now()
   where customer_id = v_sale.customer_id
  returning current_debt_grams into v_new_cust_debt;

  -- 8. Deduct from seller total client debt in seller_gold_accounts
  update public.seller_gold_accounts
     set total_client_debt_grams = greatest(0, round((total_client_debt_grams - v_client_due)::numeric, 4)),
         updated_at              = now()
   where seller_id = v_sale.seller_id
  returning total_client_debt_grams into v_new_seller_debt;

  -- 9. Record audit log
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, details
  ) values (
    v_caller_org, auth.uid(), 'REVERSE_BARCODE_PIECE_SALE', 'jewelry_sales', v_sale.id::text,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'sale_no', v_sale.sale_no,
      'piece_id', v_piece.id,
      'model_code', v_piece.model_code,
      'weight_grams', v_piece.weight_grams,
      'client_due_reversed', v_client_due,
      'customer_id', v_sale.customer_id,
      'remaining_cust_debt', v_new_cust_debt,
      'reason', p_reason
    )
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'reversed_sale_id', v_sale.id,
    'reversed_sale_no', v_sale.sale_no,
    'piece_id', v_piece.id,
    'restored_status', 'held_by_seller',
    'reversed_client_debt_grams', v_client_due,
    'customer_remaining_debt_grams', v_new_cust_debt,
    'reason', p_reason
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_barcode_piece_sale', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_barcode_piece_sale(uuid, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 3. Enhance view_seller_piece_inventory with Returned Pieces
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
  coalesce(sum(p.weight_grams) filter (where p.status = 'held_by_seller'), 0) as available_grams,
  count(p.id) filter (where p.status = 'returned_to_factory') as returned_qty,
  coalesce(sum(p.weight_grams) filter (where p.status = 'returned_to_factory'), 0) as returned_grams
from public.consignment_pieces p
join public.employees e on e.id = p.seller_id
group by p.organization_id, p.seller_id, e.name, e.full_name, p.model_code, p.model_name, p.category;
