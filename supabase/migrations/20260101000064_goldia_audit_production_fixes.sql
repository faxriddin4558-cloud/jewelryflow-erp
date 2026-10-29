-- JewelryFlow ERP Migration 20260101000064
-- GOLDIA SALES MVP: AUDIT PRODUCTION FIXES & CONCURRENCY HARDENING
--
-- Fixes:
-- 1. Consignment return double-counting on manager available stock & double deduction on seller physical stock.
-- 2. Function overload collision resolution on rpc_reverse_refining_batch & all reversal RPCs.
-- 3. Block reversing gold purchases when linked active factory handovers exist (purchase_id, source_purchase_id & notes reference).
-- 4. Sale reversal consignment and piece status retention parity & client account column key fix.
-- 5. Daily sales ledger USD payment breakdown parity.
-- 6. Seller reconciliation Section A initial consignment count & Section C seller obligation parity.
-- 7. Automatic FIFO consignment deduction & stock availability validation in rpc_issue_barcode_consignment.
-- 8. Complete multi-source restoration (purchased_gold, refined_gold, scrap_gold, capital_pure_gold) and factory advance/obligation recalculation in rpc_reverse_factory_gold_handover.

-- Add missing column to factory_gold_handovers if needed
ALTER TABLE public.factory_gold_handovers ADD COLUMN IF NOT EXISTS source_purchase_id uuid REFERENCES public.gold_purchases(id) ON DELETE SET NULL;

-- -------------------------------------------------------------------------
-- PART 1: CONSIGNMENT RETURN DOUBLE COUNTING & DOUBLE DEDUCTION FIX
-- -------------------------------------------------------------------------

-- 1a. Canonical Manager Available Stock Function
CREATE OR REPLACE FUNCTION public.get_manager_available_stock_grams(p_org_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      uuid := COALESCE(p_org_id, public.current_organization_id());
  v_receipt_g   numeric(14, 4);
  v_returned_g  numeric(14, 4);
BEGIN
  IF v_org_id IS NULL THEN
    RETURN 0;
  END IF;

  -- 1. Available physical grams in active factory receipts (includes restored weight from returns)
  SELECT COALESCE(SUM(available_physical_g), 0)
  INTO v_receipt_g
  FROM public.factory_receipts
  WHERE organization_id = v_org_id AND status NOT IN ('reversed', 'cancelled');

  -- 2. Consignment pieces returned to manager ONLY from consignments that do NOT have a factory_receipt_id
  -- (Since receipts with a factory_receipt_id already have their available_physical_g updated when returned)
  SELECT COALESCE(SUM(cp.weight_grams), 0)
  INTO v_returned_g
  FROM public.consignment_pieces cp
  JOIN public.seller_consignments sc ON cp.consignment_id = sc.id
  WHERE cp.organization_id = v_org_id
    AND cp.status IN ('in_manager_stock', 'returned_to_manager')
    AND sc.status NOT IN ('cancelled', 'reversed')
    AND sc.factory_receipt_id IS NULL;

  RETURN ROUND(GREATEST(0, v_receipt_g + v_returned_g), 4);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_manager_available_stock_grams(uuid) TO authenticated, service_role;

-- 1b. Canonical Seller Gold Account Recalculator
CREATE OR REPLACE FUNCTION public.recalc_seller_gold_account(
  p_seller_id uuid,
  p_org_id    uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_phys       numeric(14, 4);
  v_consignment_obl  numeric(14, 4);
  v_legacy_debt_obl  numeric(14, 4);
  v_total_obl        numeric(14, 4);
  v_total_stl        numeric(14, 4);
  v_s_owes           numeric(14, 4);
  v_m_owes           numeric(14, 4);
  v_signed           numeric(14, 4);
  v_total_sold       numeric(14, 4);
  v_cur_stock        numeric(14, 4);
BEGIN
  IF p_seller_id IS NULL OR p_org_id IS NULL THEN
    RETURN;
  END IF;

  -- 1. Active Consignments: sum base_weight_grams which represents active remaining physical grams
  SELECT
    COALESCE(SUM(base_weight_grams), 0),
    COALESCE(SUM(COALESCE(seller_obligation_g, factory_gold_due_grams)), 0)
  INTO v_total_phys, v_consignment_obl
  FROM public.seller_consignments
  WHERE seller_id = p_seller_id AND organization_id = p_org_id
    AND status IN ('held_by_seller', 'partially_sold', 'fully_sold');

  -- 1b. Legacy client debts assigned to this seller (unreversed)
  SELECT COALESCE(SUM(delta_585_g), 0)
  INTO v_legacy_debt_obl
  FROM public.client_legacy_debts
  WHERE seller_id = p_seller_id AND organization_id = p_org_id
    AND balance_type = 'debt'
    AND status <> 'reversed';

  v_total_obl := ROUND(v_consignment_obl + v_legacy_debt_obl, 4);

  -- 2. Total non-reversed settlements surrendered to manager/factory
  SELECT COALESCE(SUM(total_settled_grams), 0)
  INTO v_total_stl
  FROM public.gold_settlements
  WHERE seller_id = p_seller_id AND organization_id = p_org_id
    AND direction IN ('seller_to_manager', 'seller_to_factory')
    AND (status IS NULL OR status NOT IN ('reversed', 'cancelled'))
    AND reversal_of_id IS NULL;

  v_s_owes := ROUND(GREATEST(0, v_total_obl - v_total_stl), 4);
  v_m_owes := ROUND(GREATEST(0, v_total_stl - v_total_obl), 4);
  v_signed := ROUND(v_m_owes - v_s_owes, 4);

  -- 3. Total sold physical grams (sales not cancelled or reversed)
  SELECT COALESCE(SUM(base_weight_grams), 0)
  INTO v_total_sold
  FROM public.jewelry_sales
  WHERE seller_id = p_seller_id AND organization_id = p_org_id
    AND status NOT IN ('cancelled', 'reversed');

  -- Note: v_total_phys ALREADY reflects base_weight_grams reduced by returned pieces!
  v_cur_stock := ROUND(GREATEST(0, v_total_phys - v_total_sold), 4);

  INSERT INTO public.seller_gold_accounts (
    seller_id, organization_id,
    total_transferred_physical_g, total_seller_obligation_g,
    total_settled_to_manager_g, seller_owes_manager_g,
    manager_owes_seller_g, bozor_qarzi_signed_g,
    total_consigned_gold_grams, current_factory_obligation_grams,
    current_physical_stock_g, seller_legacy_debt_obligation_g,
    updated_at
  ) VALUES (
    p_seller_id, p_org_id,
    v_total_phys, v_total_obl,
    v_total_stl, v_s_owes,
    v_m_owes, v_signed,
    v_consignment_obl, v_s_owes,
    v_cur_stock, v_legacy_debt_obl,
    NOW()
  )
  ON CONFLICT (seller_id) DO UPDATE SET
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
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_seller_gold_account(uuid, uuid) TO authenticated, service_role;

-- 1c. HARDENED rpc_return_piece_to_manager
DROP FUNCTION IF EXISTS public.rpc_return_piece_to_manager(uuid, text, text);

CREATE OR REPLACE FUNCTION public.rpc_return_piece_to_manager(
  p_piece_id         uuid,
  p_notes            text DEFAULT NULL,
  p_idempotency_key  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  v_payload := jsonb_build_object(
    'action', 'return_piece_to_manager',
    'piece_id', p_piece_id
  );

  IF p_idempotency_key IS NOT NULL THEN
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_return_piece_to_manager', v_payload);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- 1. Lock and fetch piece
  SELECT * INTO v_piece
    FROM public.consignment_pieces
   WHERE id = p_piece_id
     AND organization_id = v_caller_org
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Qaytariladigan mahsulot donasi topilmadi (%)', p_piece_id;
  END IF;

  IF v_piece.status <> 'held_by_seller' THEN
    RAISE EXCEPTION 'Faqat sotuvchi javonidagi (sotilmagan) mahsulotni boshqaruvchiga qaytarish mumkin. Hozirgi holat: %', v_piece.status;
  END IF;

  -- 2. Seller authorization check
  SELECT * INTO v_seller
    FROM public.employees
   WHERE id = v_piece.seller_id
     AND organization_id = v_caller_org
   LIMIT 1;

  IF v_caller_role NOT IN ('admin', 'director', 'owner', 'direktor', 'rahbar', 'warehouse', 'omborchi', 'inventory_manager', 'manager', 'production_manager', 'boshqaruvchi') THEN
    IF v_seller.user_id IS NOT NULL AND v_seller.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Ruxsat etilmadi: Faqat o''zingizga biriktirilgan mahsulotni qaytara olasiz' USING errcode = '42501';
    END IF;
  END IF;

  -- 3. Lock parent consignment
  SELECT * INTO v_consign
    FROM public.seller_consignments
   WHERE id = v_piece.consignment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ushbu donaga tegishli konsignatsiya yozuvi topilmadi';
  END IF;

  -- Dynamic seller markup from piece or consignment
  v_seller_markup := COALESCE(v_piece.seller_markup_pct, v_consign.seller_markup_pct, 12.00);
  v_deduct_obl := ROUND((v_piece.weight_grams * (1.0 + v_seller_markup / 100.0))::numeric, 4);

  -- 4. Update piece status to returned_to_manager
  UPDATE public.consignment_pieces
     SET status                 = 'returned_to_manager',
         returned_to_manager_at = NOW(),
         notes                  = COALESCE(notes, '') || CASE WHEN notes IS NOT NULL THEN ' | ' ELSE '' END ||
                                  'BOSHQARUVCHIGA QAYTARILDI: ' || COALESCE(p_notes, 'Sotilmagan tovar qaytarildi') || ' (' || to_char(NOW(), 'YYYY-MM-DD HH24:MI') || ')',
         updated_at             = NOW()
   WHERE id = v_piece.id;

  -- 5. Calculate new active balances for parent consignment
  v_new_rem_w   := ROUND(GREATEST(0, COALESCE(v_consign.base_weight_grams, 0) - v_piece.weight_grams)::numeric, 4);
  v_new_rem_obl := ROUND(GREATEST(0, COALESCE(v_consign.seller_obligation_g, 0) - v_deduct_obl)::numeric, 4);

  -- Count remaining held pieces in parent consignment
  SELECT COUNT(*)::integer
    INTO v_new_rem_qty
    FROM public.consignment_pieces
   WHERE consignment_id = v_consign.id
     AND status = 'held_by_seller';

  IF v_new_rem_w <= 0 OR v_new_rem_qty = 0 THEN
    IF COALESCE(v_consign.sold_quantity, 0) > 0 THEN
      v_new_status := 'fully_sold';
    ELSE
      v_new_status := 'returned_to_manager';
    END IF;
  ELSIF COALESCE(v_consign.sold_quantity, 0) > 0 THEN
    v_new_status := 'partially_sold';
  ELSE
    v_new_status := 'held_by_seller';
  END IF;

  UPDATE public.seller_consignments
     SET returned_quantity              = COALESCE(returned_quantity, 0) + 1,
         returned_to_factory_quantity   = COALESCE(returned_to_factory_quantity, 0) + 1,
         returned_weight_grams          = ROUND((COALESCE(returned_weight_grams, 0) + v_piece.weight_grams)::numeric, 4),
         returned_to_factory_gold_grams = ROUND((COALESCE(returned_to_factory_gold_grams, 0) + v_piece.weight_grams)::numeric, 4),
         returned_seller_obligation_g   = ROUND((COALESCE(returned_seller_obligation_g, 0) + v_deduct_obl)::numeric, 4),
         base_weight_grams              = v_new_rem_w,
         seller_obligation_g            = v_new_rem_obl,
         quantity                       = v_new_rem_qty,
         status                         = v_new_status,
         updated_at                     = NOW()
   WHERE id = v_consign.id;

  -- 6. Restore manager physical stock on factory receipt (if linked)
  IF v_consign.factory_receipt_id IS NOT NULL THEN
    UPDATE public.factory_receipts
       SET available_physical_g = ROUND((available_physical_g + v_piece.weight_grams)::numeric, 4),
           status = CASE
                      WHEN ROUND((available_physical_g + v_piece.weight_grams)::numeric, 4) >= original_physical_g THEN 'in_manager_stock'
                      ELSE 'partially_transferred'
                    END,
           updated_at = NOW()
     WHERE id = v_consign.factory_receipt_id;
  END IF;

  -- 7. Atomically synchronize manager physical vault stock
  PERFORM public._get_or_create_manager_vault(v_caller_org);
  UPDATE public.manager_vault_account
     SET manager_physical_stock_g = public.get_manager_available_stock_grams(v_caller_org),
         updated_at = NOW()
   WHERE organization_id = v_caller_org;

  -- 8. Recalculate seller responsibility atomically
  PERFORM public.recalc_seller_gold_account(v_piece.seller_id, v_caller_org);

  SELECT * INTO v_seller_acc
    FROM public.seller_gold_accounts
   WHERE seller_id = v_piece.seller_id AND organization_id = v_caller_org;

  -- 9. Audit log
  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) VALUES (
    v_caller_org, 'consignment_pieces', v_piece.id::text, 'RETURN_PIECE_TO_MANAGER', auth.uid(),
    jsonb_build_object(
      'piece_id', v_piece.id,
      'model_code', v_piece.model_code,
      'model_name', v_piece.model_name,
      'weight_grams', v_piece.weight_grams,
      'seller_markup_pct', v_seller_markup,
      'seller_obligation_deducted_g', v_deduct_obl,
      'seller_id', v_piece.seller_id,
      'new_seller_owes_manager_g', COALESCE(v_seller_acc.seller_owes_manager_g, 0),
      'new_bozor_qarzi_signed_g', COALESCE(v_seller_acc.bozor_qarzi_signed_g, 0),
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
    'seller_owes_manager_g', COALESCE(v_seller_acc.seller_owes_manager_g, 0),
    'bozor_qarzi_signed_g', COALESCE(v_seller_acc.bozor_qarzi_signed_g, 0),
    'new_status', 'returned_to_manager',
    'consignment_status', v_new_status
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(p_idempotency_key, 'rpc_return_piece_to_manager', v_existing, v_payload);
  END IF;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_return_piece_to_manager(uuid, text, text) TO authenticated;


-- 1d. HARDENED rpc_record_factory_receipt
DROP FUNCTION IF EXISTS public.rpc_record_factory_receipt(text, integer, numeric, numeric, numeric, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.rpc_record_factory_receipt(
  p_product_name        text,
  p_quantity            integer DEFAULT 1,
  p_original_physical_g numeric DEFAULT 0,
  p_proba               numeric DEFAULT 585,
  p_factory_markup_pct  numeric DEFAULT 8.0,
  p_product_id          uuid DEFAULT NULL,
  p_model_id            uuid DEFAULT NULL,
  p_notes               text DEFAULT NULL,
  p_idempotency_key     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  IF v_caller_role IN ('seller', 'sotuvchi', 'sales', 'worker', 'viewer') OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Ruxsat etilmadi: Sotuvchi yoki begona foydalanuvchi zavod tovar kirimini saqlay olmaydi (Rol: %)', v_caller_role
      USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  v_phys_g := ROUND(COALESCE(p_original_physical_g, 0)::numeric, 4);
  IF v_phys_g <= 0 THEN
    RAISE EXCEPTION 'Zavod kirimi fizik vazni 0 dan katta bo''lishi shart';
  END IF;

  v_pr := ROUND(COALESCE(p_proba, 585.0)::numeric, 2);
  IF v_pr <> 585.0 THEN
    RAISE EXCEPTION 'JewelryFlow Sales tayyor mahsulotlar ombori faqat 585 proba uchun mo''ljallangan. Kiritilgan proba: %. Boshqa probalar (750/999) qabul qilinmaydi.', v_pr;
  END IF;

  v_base_585_g := v_phys_g;
  v_f_pct      := ROUND(COALESCE(p_factory_markup_pct, 8.0)::numeric, 2);
  v_f_due_g    := ROUND((v_base_585_g * (1.0 + v_f_pct / 100.0))::numeric, 4);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT jsonb_build_object(
      'action', 'record_factory_receipt',
      'product_name', p_product_name,
      'physical_weight_g', v_phys_g,
      'original_physical_g', v_phys_g,
      'proba', v_pr
    ) INTO v_existing;
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_factory_receipt', v_existing);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  v_receipt_no := 'ZVD-' || to_char(NOW(), 'YYYYMMDD') || '-' || UPPER(SUBSTR(md5(random()::text || clock_timestamp()::text), 1, 6));

  INSERT INTO public.factory_receipts (
    organization_id, receipt_no, product_id, model_id, product_name,
    quantity, original_physical_g, available_physical_g, transferred_physical_g,
    proba, factory_markup_pct, factory_obligation_g, status, notes
  ) VALUES (
    v_org_id, v_receipt_no, p_product_id, p_model_id, p_product_name,
    GREATEST(1, COALESCE(p_quantity, 1)), v_phys_g, v_phys_g, 0,
    v_pr, v_f_pct, v_f_due_g, 'in_manager_stock', p_notes
  ) RETURNING id INTO v_receipt_id;

  PERFORM public._get_or_create_manager_vault(v_org_id);
  SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_org_id FOR UPDATE;

  v_new_obligation := ROUND(v_vault.total_factory_obligation_g + v_f_due_g, 4);
  v_net_balance := ROUND(v_new_obligation - v_vault.total_factory_handed_over_g, 4);

  IF v_net_balance >= 0 THEN
    v_cur_obligation := v_net_balance;
    v_cur_advance := 0;
  ELSE
    v_cur_obligation := 0;
    v_cur_advance := ROUND(ABS(v_net_balance), 4);
  END IF;

  UPDATE public.manager_vault_account
     SET total_factory_received_g     = ROUND(total_factory_received_g + v_phys_g, 4),
         total_factory_obligation_g   = v_new_obligation,
         current_factory_obligation_g = v_cur_obligation,
         current_factory_advance_g    = v_cur_advance,
         manager_physical_stock_g     = ROUND(manager_physical_stock_g + v_phys_g, 4),
         updated_at                   = clock_timestamp()
   WHERE organization_id = v_org_id;

  -- Audit log
  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) VALUES (
    v_org_id, 'factory_receipts', v_receipt_id::text, 'RECORD_RECEIPT', auth.uid(),
    NULL,
    jsonb_build_object(
      'receipt_no', v_receipt_no,
      'product_name', p_product_name,
      'physical_weight_g', v_phys_g,
      'original_physical_g', v_phys_g,
      'proba', v_pr,
      'factory_markup_pct', v_f_pct,
      'factory_obligation_g', v_f_due_g
    ),
    'Factory finished goods receipt'
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'physical_weight_g', v_phys_g,
    'original_physical_g', v_phys_g,
    'proba', v_pr,
    'factory_markup_pct', v_f_pct,
    'factory_obligation_g', v_f_due_g,
    'new_total_obligation_g', v_new_obligation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_record_factory_receipt(text, integer, numeric, numeric, numeric, uuid, uuid, text, text) TO authenticated;

-- 1e. HARDENED rpc_issue_barcode_consignment (With FIFO Deduction & Manager Stock Validation)
DROP FUNCTION IF EXISTS public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text, uuid, numeric);

CREATE OR REPLACE FUNCTION public.rpc_issue_barcode_consignment(
  p_seller_id          uuid,
  p_factory_markup_pct numeric DEFAULT 0,
  p_pieces             jsonb DEFAULT '[]'::jsonb,
  p_notes              text DEFAULT NULL,
  p_idempotency_key    text DEFAULT NULL,
  p_factory_receipt_id uuid DEFAULT NULL,
  p_seller_markup_pct  numeric DEFAULT 12.00
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_factory_pct       numeric(6, 2) := ROUND(COALESCE(p_factory_markup_pct, 0)::numeric, 2);
  v_seller_pct        numeric(6, 2) := ROUND(COALESCE(p_seller_markup_pct, 12.00)::numeric, 2);
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
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'inventory_manager'
  ]);

  IF JSONB_ARRAY_LENGTH(p_pieces) = 0 THEN
    RAISE EXCEPTION 'Kamida 1 ta mahsulot dona skaner qilinishi shart';
  END IF;

  SELECT * INTO v_seller
    FROM public.employees
   WHERE id = p_seller_id AND organization_id = v_caller_org
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sotuvchi xodimi topilmadi (%)', p_seller_id;
  END IF;

  v_payload := jsonb_build_object(
    'action', 'issue_barcode_consignment',
    'seller_id', p_seller_id,
    'factory_markup_pct', v_factory_pct,
    'seller_markup_pct', v_seller_pct,
    'piece_count', JSONB_ARRAY_LENGTH(p_pieces),
    'factory_receipt_id', p_factory_receipt_id
  );

  IF p_idempotency_key IS NOT NULL THEN
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_issue_barcode_consignment', v_payload);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- Validate pieces weight and calculate totals
  FOR v_piece_elem IN SELECT * FROM jsonb_array_elements(p_pieces) LOOP
    v_weight := ROUND(COALESCE((v_piece_elem->>'weight_grams')::numeric, 0), 4);
    IF v_weight <= 0 OR v_weight > 1000.0 THEN
      RAISE EXCEPTION 'Noto''g''ri mahsulot vazni aniqlandi: % g (ruxsat: 0.05g - 1000g)', v_weight;
    END IF;
    v_total_base_weight := v_total_base_weight + v_weight;
    v_total_qty := v_total_qty + 1;
  END LOOP;

  v_total_base_weight := ROUND(v_total_base_weight, 4);
  v_factory_due := ROUND((v_total_base_weight * (1.0 + v_factory_pct / 100.0))::numeric, 4);
  v_seller_due  := ROUND((v_total_base_weight * (1.0 + v_seller_pct / 100.0))::numeric, 4);

  -- Deduct manager physical stock from factory_receipt(s)
  IF v_receipt_id IS NOT NULL THEN
    SELECT * INTO v_receipt_rec
      FROM public.factory_receipts
     WHERE id = v_receipt_id AND organization_id = v_caller_org AND status <> 'reversed'
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Belgilangan zavod kirim hujjati (%) topilmadi yoki bekor qilingan', v_receipt_id;
    END IF;

    IF COALESCE(v_receipt_rec.available_physical_g, 0) < v_total_base_weight THEN
      RAISE EXCEPTION 'Menejer omborida yetarli tovar yo''q: tanlangan kirimda mavjud % g, talab qilindi % g',
        COALESCE(v_receipt_rec.available_physical_g, 0), v_total_base_weight;
    END IF;

    UPDATE public.factory_receipts
       SET available_physical_g = ROUND((available_physical_g - v_total_base_weight)::numeric, 4),
           transferred_physical_g = ROUND((transferred_physical_g + v_total_base_weight)::numeric, 4),
           status = CASE WHEN ROUND((available_physical_g - v_total_base_weight)::numeric, 4) <= 0.0001 THEN 'fully_transferred' ELSE 'partially_transferred' END,
           updated_at = NOW()
     WHERE id = v_receipt_id;
  ELSE
    -- Automatic FIFO deduction across active factory receipts
    SELECT COALESCE(SUM(available_physical_g), 0) INTO v_total_avail
      FROM public.factory_receipts
     WHERE organization_id = v_caller_org AND status <> 'reversed';

    IF v_total_avail < v_total_base_weight THEN
      RAISE EXCEPTION 'Menejer omborida yetarli tovar yo''q: mavjud % g, talab qilindi % g',
        v_total_avail, v_total_base_weight;
    END IF;

    v_rem_to_deduct := v_total_base_weight;
    FOR v_cur_receipt IN
      SELECT * FROM public.factory_receipts
       WHERE organization_id = v_caller_org AND status <> 'reversed' AND available_physical_g > 0
       ORDER BY receipt_date ASC, created_at ASC
       FOR UPDATE
    LOOP
      v_take_g := LEAST(v_rem_to_deduct, v_cur_receipt.available_physical_g);

      UPDATE public.factory_receipts
         SET available_physical_g = ROUND((available_physical_g - v_take_g)::numeric, 4),
             transferred_physical_g = ROUND((transferred_physical_g + v_take_g)::numeric, 4),
             status = CASE WHEN ROUND((available_physical_g - v_take_g)::numeric, 4) <= 0.0001 THEN 'fully_transferred' ELSE 'partially_transferred' END,
             updated_at = NOW()
       WHERE id = v_cur_receipt.id;

      IF v_receipt_id IS NULL THEN
        v_receipt_id := v_cur_receipt.id;
      END IF;

      v_rem_to_deduct := ROUND((v_rem_to_deduct - v_take_g)::numeric, 4);
      IF v_rem_to_deduct <= 0.0001 THEN
        EXIT;
      END IF;
    END LOOP;

    IF v_rem_to_deduct > 0.0001 THEN
      RAISE EXCEPTION 'Menejer omborida FIFO bo''yicha yetarli tovar topilmadi: yetishmayotgan qoldiq % g', v_rem_to_deduct;
    END IF;
  END IF;

  v_consignment_no := 'CONS-BC-' || UPPER(SUBSTR(md5(random()::text || clock_timestamp()::text), 1, 8));

  INSERT INTO public.seller_consignments (
    organization_id, consignment_no, seller_id, factory_receipt_id, product_name,
    quantity, base_weight_grams, proba, factory_markup_pct, factory_gold_due_grams,
    factory_remaining_gold_grams, seller_markup_pct, seller_obligation_g, status, notes
  ) VALUES (
    v_caller_org, v_consignment_no, p_seller_id, v_receipt_id, 'Konsignatsiya Partiyasi',
    v_total_qty, v_total_base_weight, 585, v_factory_pct, v_factory_due,
    v_factory_due, v_seller_pct, v_seller_due, 'held_by_seller', p_notes
  ) RETURNING id INTO v_consignment_id;

  -- Insert piece rows
  FOR v_piece_elem IN SELECT * FROM jsonb_array_elements(p_pieces) LOOP
    v_piece_id := gen_random_uuid();
    v_model_id := NULLIF(v_piece_elem->>'model_id', '')::uuid;
    v_model_code := COALESCE(NULLIF(BTRIM(v_piece_elem->>'model_code'), ''), 'VAZN');
    v_model_name := COALESCE(NULLIF(BTRIM(v_piece_elem->>'model_name'), ''), 'Zargarlik Buyumi (Standart 585)');
    v_category := COALESCE(NULLIF(BTRIM(v_piece_elem->>'category'), ''), 'Buyum');
    v_purity := COALESCE((v_piece_elem->>'purity')::numeric, 585.00);
    v_weight := ROUND((v_piece_elem->>'weight_grams')::numeric, 4);
    v_raw_barcode := COALESCE(v_piece_elem->>'raw_barcode', v_piece_elem->>'weight_grams');
    v_piece_seller_obl := ROUND((v_weight * (1.0 + v_seller_pct / 100.0))::numeric, 4);

    INSERT INTO public.consignment_pieces (
      id, organization_id, consignment_id, model_id, model_code, model_name,
      category, purity, weight_grams, status, seller_id, raw_barcode, notes,
      seller_markup_pct, seller_obligation_grams
    ) VALUES (
      v_piece_id, v_caller_org, v_consignment_id, v_model_id, v_model_code, v_model_name,
      v_category, v_purity, v_weight, 'held_by_seller', p_seller_id, v_raw_barcode, p_notes,
      v_seller_pct, v_piece_seller_obl
    );

    v_inserted_pieces := v_inserted_pieces || jsonb_build_object(
      'id', v_piece_id,
      'piece_id', v_piece_id,
      'model_code', v_model_code,
      'weight_grams', v_weight,
      'seller_obligation_grams', v_piece_seller_obl
    );
  END LOOP;

  -- Sync seller gold account
  PERFORM public.recalc_seller_gold_account(p_seller_id, v_caller_org);

  -- Sync manager vault
  PERFORM public._get_or_create_manager_vault(v_caller_org);
  UPDATE public.manager_vault_account
     SET manager_physical_stock_g = public.get_manager_available_stock_grams(v_caller_org),
         updated_at = NOW()
   WHERE organization_id = v_caller_org;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'consignment_id', v_consignment_id,
    'consignment_no', v_consignment_no,
    'seller_id', p_seller_id,
    'quantity', v_total_qty,
    'pieces_count', v_total_qty,
    'item_count', v_total_qty,
    'base_weight_grams', v_total_base_weight,
    'factory_markup_pct', v_factory_pct,
    'factory_gold_due_grams', v_factory_due,
    'seller_markup_pct', v_seller_pct,
    'seller_obligation_g', v_seller_due,
    'pieces', v_inserted_pieces
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(p_idempotency_key, 'rpc_issue_barcode_consignment', v_existing, v_payload);
  END IF;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_issue_barcode_consignment(uuid, numeric, jsonb, text, text, uuid, numeric) TO authenticated, service_role;


-- 1f. HARDENED rpc_get_seller_reconciliation_statement (Section A total pieces count & Section C seller obligation parity)
DROP FUNCTION IF EXISTS public.rpc_get_seller_reconciliation_statement(uuid);

CREATE OR REPLACE FUNCTION public.rpc_get_seller_reconciliation_statement(
  p_seller_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_seller_acc        public.seller_gold_accounts%rowtype;

  -- Section A: Received from Manager + Legacy customer debts assigned
  v_sec_a_orig_g      numeric(14, 4) := 0;
  v_sec_a_obl_g       numeric(14, 4) := 0;
  v_sec_a_count       integer := 0;
  v_sec_a_legacy_g    numeric(14, 4) := 0;

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
  v_sec_d_usd_rec     numeric(18, 2) := 0;
  v_sec_d_usd_eq      numeric(14, 4) := 0;
  v_sec_d_cust_debt   numeric(14, 4) := 0;

  -- Section E: Seller Holdings
  v_sec_e_cash_uzs    numeric(18, 2) := 0;
  v_sec_e_cash_usd    numeric(18, 2) := 0;
  v_sec_e_scrap_g     numeric(14, 4) := 0;

  -- Section F: Seller-to-Manager Settlements & Returns
  v_sec_f_scrap_g     numeric(14, 4) := 0;
  v_sec_f_cash_uzs    numeric(18, 2) := 0;
  v_sec_f_cash_eq     numeric(14, 4) := 0;
  v_sec_f_usd_amount  numeric(18, 2) := 0;
  v_sec_f_usd_eq      numeric(14, 4) := 0;
  v_sec_f_ret_count   integer := 0;
  v_sec_f_ret_orig_g  numeric(14, 4) := 0;
  v_sec_f_ret_obl_g   numeric(14, 4) := 0;
  v_sec_f_total_ded   numeric(14, 4) := 0;

  -- Section G: Signed Bozor Qarzi
  v_sec_g_signed_g    numeric(14, 4) := 0;
  v_sec_g_owes_m_g    numeric(14, 4) := 0;
  v_sec_g_m_owes_s_g  numeric(14, 4) := 0;
  v_expected_obl      numeric(14, 4) := 0;
  v_discrepancy       numeric(14, 4) := 0;
  v_is_reconciled     boolean := true;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  SELECT * INTO v_seller
    FROM public.employees
   WHERE id = p_seller_id AND organization_id = v_caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sotuvchi topilmadi (%)', p_seller_id;
  END IF;

  SELECT * INTO v_seller_acc
    FROM public.seller_gold_accounts
   WHERE seller_id = p_seller_id AND organization_id = v_caller_org;

  -- Section A: Consignments (Sum base_weight + returned_weight + sold_weight, and quantity + returned_quantity + sold_quantity)
  SELECT
    COALESCE(SUM(base_weight_grams + returned_weight_grams), 0),
    COALESCE(SUM(COALESCE(seller_obligation_g, 0) + returned_seller_obligation_g), 0),
    COALESCE(SUM(quantity + returned_quantity + COALESCE(sold_quantity, 0)), 0)
  INTO v_sec_a_orig_g, v_sec_a_obl_g, v_sec_a_count
  FROM public.seller_consignments
  WHERE seller_id = p_seller_id
    AND organization_id = v_caller_org
    AND (status IS NULL OR status NOT IN ('cancelled', 'reversed'));

  -- Legacy customer debts assigned to this seller
  SELECT COALESCE(SUM(delta_585_g), 0)
  INTO v_sec_a_legacy_g
  FROM public.client_legacy_debts
  WHERE seller_id = p_seller_id
    AND organization_id = v_caller_org
    AND balance_type = 'debt'
    AND status <> 'reversed';

  -- Section B: Unsold goods
  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(weight_grams), 0),
    COALESCE(SUM(ROUND(weight_grams * (1.0 + COALESCE(seller_markup_pct, 12.0) / 100.0), 4)), 0)
  INTO v_sec_b_count, v_sec_b_orig_g, v_sec_b_equiv_g
  FROM public.consignment_pieces
  WHERE seller_id = p_seller_id
    AND organization_id = v_caller_org
    AND status = 'held_by_seller';

  -- Section C: Sold goods (Calculate seller obligation equivalent)
  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(s.base_weight_grams), 0),
    COALESCE(SUM(ROUND(s.base_weight_grams * (1.0 + COALESCE(cp.seller_markup_pct, sc.seller_markup_pct, 12.0) / 100.0), 4)), 0)
  INTO v_sec_c_count, v_sec_c_orig_g, v_sec_c_equiv_g
  FROM public.jewelry_sales s
  LEFT JOIN public.consignment_pieces cp ON cp.sale_id = s.id
  LEFT JOIN public.seller_consignments sc ON sc.id = cp.consignment_id
  WHERE s.seller_id = p_seller_id
    AND s.organization_id = v_caller_org
    AND s.status NOT IN ('cancelled', 'reversed');

  -- Section D: Customer Receivables & Payments
  SELECT
    COALESCE(SUM(s.client_gold_due_grams), 0)
  INTO v_sec_d_client_obl
  FROM public.jewelry_sales s
  WHERE s.seller_id = p_seller_id AND s.organization_id = v_caller_org AND s.status NOT IN ('cancelled', 'reversed');

  SELECT
    COALESCE(SUM(gs.scrap_weight_grams), 0),
    COALESCE(SUM(gs.cash_paid_amount), 0),
    COALESCE(SUM(gs.cash_equivalent_grams), 0),
    COALESCE(SUM(gs.usd_paid_amount), 0),
    COALESCE(SUM(gs.usd_equivalent_grams), 0)
  INTO v_sec_d_scrap_rec, v_sec_d_cash_rec, v_sec_d_cash_eq, v_sec_d_usd_rec, v_sec_d_usd_eq
  FROM public.gold_settlements gs
  WHERE gs.seller_id = p_seller_id
    AND gs.organization_id = v_caller_org
    AND gs.direction = 'client_to_seller'
    AND (gs.status IS NULL OR gs.status NOT IN ('cancelled', 'reversed'));

  v_sec_d_cust_debt := ROUND(GREATEST(0, (v_sec_d_client_obl + v_sec_a_legacy_g) - (v_sec_d_scrap_rec + v_sec_d_cash_eq + v_sec_d_usd_eq)), 4);

  -- Section E: Seller Holdings
  v_sec_e_cash_uzs := COALESCE(v_seller_acc.seller_till_cash_amount, 0);
  v_sec_e_cash_usd := COALESCE(v_seller_acc.seller_till_usd_amount, 0);
  v_sec_e_scrap_g  := COALESCE(v_seller_acc.seller_till_scrap_grams, 0);

  -- Section F: Settlements & Returns
  SELECT
    COALESCE(SUM(gs.scrap_weight_grams), 0),
    COALESCE(SUM(gs.cash_paid_amount), 0),
    COALESCE(SUM(gs.cash_equivalent_grams), 0),
    COALESCE(SUM(gs.usd_paid_amount), 0),
    COALESCE(SUM(gs.usd_equivalent_grams), 0)
  INTO v_sec_f_scrap_g, v_sec_f_cash_uzs, v_sec_f_cash_eq, v_sec_f_usd_amount, v_sec_f_usd_eq
  FROM public.gold_settlements gs
  WHERE gs.seller_id = p_seller_id
    AND gs.organization_id = v_caller_org
    AND gs.direction IN ('seller_to_manager', 'seller_to_factory')
    AND (gs.status IS NULL OR gs.status NOT IN ('reversed', 'cancelled'));

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(cp.weight_grams), 0),
    COALESCE(SUM(ROUND(cp.weight_grams * (1.0 + COALESCE(cp.seller_markup_pct, 12.0) / 100.0), 4)), 0)
  INTO v_sec_f_ret_count, v_sec_f_ret_orig_g, v_sec_f_ret_obl_g
  FROM public.consignment_pieces cp
  WHERE cp.seller_id = p_seller_id
    AND cp.organization_id = v_caller_org
    AND cp.status IN ('returned_to_manager', 'returned_to_factory');

  v_sec_f_total_ded := ROUND(v_sec_f_scrap_g + v_sec_f_cash_eq + v_sec_f_usd_eq + v_sec_f_ret_obl_g, 4);

  -- Section G: Final Signed Bozor Qarzi
  v_sec_g_signed_g   := COALESCE(v_seller_acc.bozor_qarzi_signed_g, 0);
  v_sec_g_owes_m_g   := COALESCE(v_seller_acc.seller_owes_manager_g, 0);
  v_sec_g_m_owes_s_g := COALESCE(v_seller_acc.manager_owes_seller_g, 0);

  v_expected_obl := ROUND(GREATEST(0, (v_sec_a_obl_g + v_sec_a_legacy_g) - v_sec_f_total_ded), 4);
  v_discrepancy  := ROUND(ABS(v_sec_g_owes_m_g - v_expected_obl), 4);
  v_is_reconciled := v_discrepancy < 0.001;

  RETURN jsonb_build_object(
    'status', 'ok',
    'seller_id', p_seller_id,
    'seller_name', COALESCE(v_seller.full_name, v_seller.name, 'Sotuvchi'),
    'as_of_date', to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
    'section_a', jsonb_build_object(
      'title', 'A. Boshqaruvchidan Qabul Qilingan Tovar & Eski Qarzi',
      'item_count', v_sec_a_count,
      'original_grams', v_sec_a_orig_g,
      'seller_markup_obligation_grams', v_sec_a_obl_g,
      'legacy_debt_obligation_grams', v_sec_a_legacy_g,
      'total_obligation_grams', (v_sec_a_obl_g + v_sec_a_legacy_g)
    ),
    'section_b', jsonb_build_object(
      'title', 'B. Sotilmay Qolgan Tovar (Sotuvchi Javonida)',
      'item_count', v_sec_b_count,
      'original_grams', v_sec_b_orig_g,
      'seller_markup_equivalent_grams', v_sec_b_equiv_g
    ),
    'section_c', jsonb_build_object(
      'title', 'C. Mijozlarga Sotilgan Tovar',
      'item_count', v_sec_c_count,
      'original_grams', v_sec_c_orig_g,
      'seller_markup_equivalent_grams', v_sec_c_equiv_g
    ),
    'section_d', jsonb_build_object(
      'title', 'D. Mijozlar Nasiyasi & Tushumlar',
      'customer_markup_obligation_grams', (v_sec_d_client_obl + v_sec_a_legacy_g),
      'gross_client_obligation_grams', (v_sec_d_client_obl + v_sec_a_legacy_g),
      'scrap_collected_grams', v_sec_d_scrap_rec,
      'cash_collected_uzs', v_sec_d_cash_rec,
      'cash_collected_gold_equiv_grams', v_sec_d_cash_eq,
      'usd_collected_amount', v_sec_d_usd_rec,
      'usd_collected_gold_equiv_grams', v_sec_d_usd_eq,
      'outstanding_customer_debt_grams', v_sec_d_cust_debt,
      'net_client_debt_grams', v_sec_d_cust_debt
    ),
    'section_e', jsonb_build_object(
      'title', 'E. Sotuvchi Kassasidagi Mavjud Naqd & Lom',
      'cash_till_uzs', v_sec_e_cash_uzs,
      'cash_uzs', v_sec_e_cash_uzs,
      'cash_till_usd', v_sec_e_cash_usd,
      'scrap_till_grams', v_sec_e_scrap_g,
      'scrap_grams', v_sec_e_scrap_g
    ),
    'section_f', jsonb_build_object(
      'title', 'F. Boshqaruvchiga Topshirilgan Tushum & Qaytarilgan Tovar',
      'scrap_surrendered_grams', v_sec_f_scrap_g,
      'settlements_scrap_grams', v_sec_f_scrap_g,
      'cash_surrendered_uzs', v_sec_f_cash_uzs,
      'cash_surrendered_gold_equiv_grams', v_sec_f_cash_eq,
      'usd_surrendered_amount', v_sec_f_usd_amount,
      'usd_surrendered_gold_equiv_grams', v_sec_f_usd_eq,
      'returned_pieces_count', v_sec_f_ret_count,
      'returned_unsold_items_count', v_sec_f_ret_count,
      'returned_pieces_original_grams', v_sec_f_ret_orig_g,
      'returned_unsold_original_grams', v_sec_f_ret_orig_g,
      'returned_pieces_seller_obligation_grams', v_sec_f_ret_obl_g,
      'returned_unsold_seller_obligation_grams', v_sec_f_ret_obl_g,
      'returned_unsold_seller_markup_equivalent_grams', v_sec_f_ret_obl_g,
      'total_deducted_from_obligation_grams', v_sec_f_total_ded,
      'total_obligation_deductions_grams', v_sec_f_total_ded
    ),
    'section_g', jsonb_build_object(
      'title', 'G. Yakuniy Bozor Qarzi & Solishtirish',
      'bozor_qarzi_signed_grams', v_sec_g_signed_g,
      'seller_owes_manager_grams', v_sec_g_owes_m_g,
      'manager_owes_seller_grams', v_sec_g_m_owes_s_g,
      'expected_obligation_grams', v_expected_obl,
      'discrepancy_grams', v_discrepancy,
      'is_reconciled', v_is_reconciled
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_seller_reconciliation_statement(uuid) TO authenticated;


-- -------------------------------------------------------------------------
-- PART 2: RESOLVE FUNCTION OVERLOAD COLLISIONS FOR ALL REVERSAL RPCs
-- -------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.rpc_reverse_refining_batch(uuid, text);
DROP FUNCTION IF EXISTS public.rpc_reverse_refining_batch(uuid, text, text);

CREATE OR REPLACE FUNCTION public.rpc_reverse_refining_batch(
  p_batch_id        uuid,
  p_reason          text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org    uuid := public.current_organization_id();
  v_caller_emp_id uuid := public.current_employee_id();
  v_batch         public.refining_batches%rowtype;
  v_vault         public.manager_vault_account%rowtype;
  v_reason        text := NULLIF(btrim(p_reason), '');
  v_payload       jsonb;
  v_existing      jsonb;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Afinajni bekor qilish sababi (reason) kiritilishi shart';
  END IF;

  v_payload := jsonb_build_object(
    'action', 'reverse_refining_batch',
    'batch_id', p_batch_id,
    'reason', v_reason
  );

  IF p_idempotency_key IS NOT NULL THEN
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_refining_batch', v_payload);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT * INTO v_batch
    FROM public.refining_batches
   WHERE id = p_batch_id AND organization_id = v_caller_org
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bekor qilinadigan afinaj partiyasi topilmadi (%)', p_batch_id;
  END IF;

  IF v_batch.status IN ('reversed', 'cancelled') THEN
    RAISE EXCEPTION 'Ushbu afinaj partiyasi allaqachon bekor qilingan';
  END IF;

  PERFORM public._get_or_create_manager_vault(v_caller_org);
  SELECT * INTO v_vault FROM public.manager_vault_account WHERE organization_id = v_caller_org FOR UPDATE;

  IF COALESCE(v_vault.manager_refined_gold_grams, 0) < v_batch.output_585_equiv_grams THEN
    RAISE EXCEPTION 'Afinajni bekor qilib bo''lmaydi: Seyfda yetarli toza oltin yo''q (Mavjud: % g, Talab: % g)',
      v_vault.manager_refined_gold_grams, v_batch.output_585_equiv_grams;
  END IF;

  -- Restore input scrap, deduct produced fine gold and 585 eq.
  UPDATE public.manager_vault_account
     SET manager_scrap_grams             = ROUND(manager_scrap_grams + v_batch.input_scrap_grams, 4),
         manager_scrap_physical_g        = ROUND(COALESCE(manager_scrap_physical_g, 0) + v_batch.input_scrap_grams, 4),
         manager_scrap_585_eq_g          = ROUND(COALESCE(manager_scrap_585_eq_g, 0) + COALESCE(v_batch.input_585_equiv_grams, v_batch.input_scrap_grams), 4),
         manager_refined_gold_grams      = ROUND(GREATEST(0, manager_refined_gold_grams - v_batch.output_585_equiv_grams), 4),
         manager_refined_gold_fine_grams = ROUND(GREATEST(0, COALESCE(manager_refined_gold_fine_grams, 0) - v_batch.output_fine_grams), 4),
         updated_at                      = NOW()
   WHERE organization_id = v_caller_org;

  UPDATE public.refining_batches
     SET status          = 'reversed',
         reversed_at     = NOW(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = v_reason,
         updated_at      = NOW()
   WHERE id = v_batch.id;

  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) VALUES (
    v_caller_org, 'refining_batches', v_batch.id::text, 'REVERSE_REFINING_BATCH', auth.uid(),
    jsonb_build_object(
      'batch_no', v_batch.batch_no,
      'reversed_loss_grams', v_batch.total_loss_grams,
      'restored_scrap_grams', v_batch.input_scrap_grams,
      'deducted_refined_grams', v_batch.output_585_equiv_grams,
      'reason', v_reason
    )
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch.id,
    'batch_no', v_batch.batch_no,
    'reversed_loss_grams', v_batch.total_loss_grams,
    'message', 'Afinaj partiyasi muvaffaqiyatli bekor qilindi va lom seyfga qaytarildi'
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_refining_batch', v_existing, v_payload);
  END IF;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_reverse_refining_batch(uuid, text, text) TO authenticated;


-- -------------------------------------------------------------------------
-- PART 3: HARDEN rpc_reverse_gold_purchase WITH DEPENDENCY GUARD
-- -------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.rpc_reverse_gold_purchase(uuid, text);
DROP FUNCTION IF EXISTS public.rpc_reverse_gold_purchase(uuid, text, text);

CREATE OR REPLACE FUNCTION public.rpc_reverse_gold_purchase(
  p_purchase_id     uuid,
  p_reason          text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := NULLIF(btrim(p_reason), '');
  v_purch           public.gold_purchases%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_active_hnd_no   text;
  v_payload         jsonb;
  v_existing        jsonb;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'Oltin xaridini bekor qilish sababi kiritilishi shart';
  END IF;

  v_payload := jsonb_build_object(
    'action', 'reverse_gold_purchase',
    'purchase_id', p_purchase_id,
    'reason', v_clean_reason
  );

  IF p_idempotency_key IS NOT NULL THEN
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_gold_purchase', v_payload);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT * INTO v_purch
  FROM public.gold_purchases
  WHERE id = p_purchase_id AND organization_id = v_caller_org
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oltin xaridi topilmadi: %', p_purchase_id;
  END IF;

  IF v_purch.status = 'reversed' THEN
    RAISE EXCEPTION 'Ushbu oltin xaridi allaqachon bekor qilingan (%s)', v_purch.purchase_no;
  END IF;

  -- DEPENDENCY CHECK: Check if there are active factory handovers linked to this purchase via purchase_id, source_purchase_id OR notes reference!
  SELECT handover_no INTO v_active_hnd_no
  FROM public.factory_gold_handovers
  WHERE (purchase_id = p_purchase_id OR source_purchase_id = p_purchase_id OR (v_purch.purchase_no IS NOT NULL AND notes LIKE '%' || v_purch.purchase_no || '%'))
    AND organization_id = v_caller_org
    AND status NOT IN ('reversed', 'cancelled')
  LIMIT 1;

  IF v_active_hnd_no IS NOT NULL THEN
    RAISE EXCEPTION 'Oltin xaridini bekor qilib bo''lmaydi: Ushbu oltin xaridi (%s) bo''yicha faol zavodga topshirish (%s) mavjud. Avval ushbu topshirishni bekor qiling.',
      v_purch.purchase_no, v_active_hnd_no;
  END IF;

  -- Lock manager vault
  PERFORM public._get_or_create_manager_vault(v_caller_org);
  SELECT * INTO v_vault
  FROM public.manager_vault_account
  WHERE organization_id = v_caller_org
  FOR UPDATE;

  -- Check if purchased gold is still in vault
  IF COALESCE(v_vault.manager_purchased_gold_grams, 0) < v_purch.equiv_585_grams THEN
    RAISE EXCEPTION 'Oltin xaridini bekor qilib bo''lmaydi: xarid qilingan oltin allaqachon zavodga topshirilgan yoki ishlatilgan (Mavjud: % g, Talab: % g).',
      COALESCE(v_vault.manager_purchased_gold_grams, 0), v_purch.equiv_585_grams;
  END IF;

  -- Revert vault balance: deduct purchased gold, restore BOTH cash and USD
  UPDATE public.manager_vault_account
     SET manager_purchased_gold_grams = ROUND((manager_purchased_gold_grams - v_purch.equiv_585_grams)::numeric, 4),
         manager_cash_amount = ROUND((COALESCE(manager_cash_amount, 0) + COALESCE(v_purch.cash_spent_uzs, 0))::numeric, 2),
         manager_usd_amount = ROUND((COALESCE(manager_usd_amount, 0) + COALESCE(v_purch.usd_spent, 0))::numeric, 2),
         updated_at = NOW()
   WHERE organization_id = v_caller_org;

  -- Mark gold purchase as reversed
  UPDATE public.gold_purchases
     SET status = 'reversed',
         reversed_at = NOW(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason
   WHERE id = p_purchase_id;

  -- Audit log
  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) VALUES (
    v_caller_org, 'gold_purchases', p_purchase_id::text,
    'REVERSE_GOLD_PURCHASE', auth.uid(),
    jsonb_build_object('purchase_no', v_purch.purchase_no, 'equiv_585_g', v_purch.equiv_585_grams, 'currency', v_purch.currency),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'purchase_id', p_purchase_id,
    'purchase_no', v_purch.purchase_no,
    'restored_cash_uzs', COALESCE(v_purch.cash_spent_uzs, 0),
    'restored_usd', COALESCE(v_purch.usd_spent, 0),
    'deducted_purchased_gold_grams', v_purch.equiv_585_grams,
    'reason', v_clean_reason
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_gold_purchase', v_existing, v_payload);
  END IF;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_reverse_gold_purchase(uuid, text, text) TO authenticated;


-- -------------------------------------------------------------------------
-- PART 4: COMPLETE MULTI-SOURCE RESTORATION IN rpc_reverse_factory_gold_handover
-- -------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.rpc_reverse_factory_gold_handover(uuid, text);
DROP FUNCTION IF EXISTS public.rpc_reverse_factory_gold_handover(uuid, text, text);

CREATE OR REPLACE FUNCTION public.rpc_reverse_factory_gold_handover(
  p_handover_id     uuid,
  p_reason          text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := NULLIF(btrim(p_reason), '');
  v_hnd             public.factory_gold_handovers%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_payload         jsonb;
  v_existing        jsonb;
  v_src             text;
  v_new_handed_over numeric(14, 4);
  v_net_balance     numeric(14, 4);
  v_new_obligation  numeric(14, 4);
  v_new_advance     numeric(14, 4);
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'Zavodga topshirishni bekor qilish sababi kiritilishi shart';
  END IF;

  v_payload := jsonb_build_object(
    'action', 'reverse_factory_gold_handover',
    'handover_id', p_handover_id,
    'reason', v_clean_reason
  );

  IF p_idempotency_key IS NOT NULL THEN
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_factory_gold_handover', v_payload);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT * INTO v_hnd
  FROM public.factory_gold_handovers
  WHERE id = p_handover_id AND organization_id = v_caller_org
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zavodga oltin topshirish hujjati topilmadi: %', p_handover_id;
  END IF;

  IF v_hnd.status IN ('reversed', 'cancelled') THEN
    RAISE EXCEPTION 'Ushbu zavodga topshirish hujjati allaqachon bekor qilingan (%s)', v_hnd.handover_no;
  END IF;

  PERFORM public._get_or_create_manager_vault(v_caller_org);
  SELECT * INTO v_vault
  FROM public.manager_vault_account
  WHERE organization_id = v_caller_org
  FOR UPDATE;

  v_src := COALESCE(v_hnd.source_type, 'refined_gold');

  -- Restore handed-over gold to manager vault according to source_type
  IF v_src = 'refined_gold' THEN
    UPDATE public.manager_vault_account
       SET manager_refined_gold_grams = ROUND((manager_refined_gold_grams + v_hnd.agreed_equivalent_g)::numeric, 4),
           manager_refined_gold_fine_grams = ROUND((COALESCE(manager_refined_gold_fine_grams, 0) + COALESCE(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           updated_at = NOW()
     WHERE organization_id = v_caller_org;
  ELSIF v_src = 'purchased_gold' THEN
    UPDATE public.manager_vault_account
       SET manager_purchased_gold_grams = ROUND((manager_purchased_gold_grams + v_hnd.agreed_equivalent_g)::numeric, 4),
           updated_at = NOW()
     WHERE organization_id = v_caller_org;
  ELSIF v_src = 'capital_pure_gold' THEN
    UPDATE public.manager_vault_account
       SET manager_capital_pure_gold_g = ROUND((COALESCE(manager_capital_pure_gold_g, 0) + v_hnd.agreed_equivalent_g)::numeric, 4),
           manager_capital_pure_gold_fine_g = ROUND((COALESCE(manager_capital_pure_gold_fine_g, 0) + ROUND((v_hnd.physical_weight_g * (COALESCE(v_hnd.proba, 999.0) / 1000.0))::numeric, 4))::numeric, 4),
           updated_at = NOW()
     WHERE organization_id = v_caller_org;
  ELSE -- scrap_gold or scrap
    UPDATE public.manager_vault_account
       SET manager_scrap_grams = ROUND((manager_scrap_grams + COALESCE(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           manager_scrap_physical_g = ROUND((COALESCE(manager_scrap_physical_g, 0) + COALESCE(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           manager_scrap_585_eq_g = ROUND((COALESCE(manager_scrap_585_eq_g, 0) + v_hnd.agreed_equivalent_g)::numeric, 4),
           updated_at = NOW()
     WHERE organization_id = v_caller_org;
  END IF;

  -- Atomically recalculate obligation and advance:
  v_new_handed_over := ROUND(GREATEST(0, v_vault.total_factory_handed_over_g - v_hnd.agreed_equivalent_g), 4);
  v_net_balance := ROUND(v_vault.total_factory_obligation_g - v_new_handed_over, 4);

  IF v_net_balance >= 0 THEN
    v_new_obligation := v_net_balance;
    v_new_advance := 0;
  ELSE
    v_new_obligation := 0;
    v_new_advance := ABS(v_net_balance);
  END IF;

  UPDATE public.manager_vault_account
     SET total_factory_handed_over_g = v_new_handed_over,
         current_factory_obligation_g = v_new_obligation,
         current_factory_advance_g = v_new_advance,
         updated_at = NOW()
   WHERE organization_id = v_caller_org;

  UPDATE public.factory_gold_handovers
     SET status = 'reversed',
         reversed_at = NOW(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason
   WHERE id = p_handover_id;

  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) VALUES (
    v_caller_org, 'factory_gold_handovers', p_handover_id::text,
    'REVERSE_FACTORY_GOLD_HANDOVER', auth.uid(),
    jsonb_build_object('handover_no', v_hnd.handover_no, 'agreed_equivalent_g', v_hnd.agreed_equivalent_g),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'handover_id', p_handover_id,
    'handover_no', v_hnd.handover_no,
    'restored_gold_grams', v_hnd.agreed_equivalent_g,
    'reason', v_clean_reason
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_factory_gold_handover', v_existing, v_payload);
  END IF;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_reverse_factory_gold_handover(uuid, text, text) TO authenticated;


-- -------------------------------------------------------------------------
-- PART 5: REOPEN SALE REVERSAL & CLIENT ACCOUNT PRIMARY KEY FIX
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_reverse_jewelry_sale(
  p_sale_id         uuid,
  p_reversal_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_sale          public.jewelry_sales%rowtype;
  v_client_acc    public.client_gold_accounts%rowtype;
  v_reason        text := NULLIF(btrim(p_reversal_reason), '');
  v_piece         public.consignment_pieces%rowtype;
  v_consign       public.seller_consignments%rowtype;
  v_applied_sett  public.gold_settlements%rowtype;
  v_existing      jsonb;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi',
    'accountant', 'buxgalter'
  ]);

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Savdoni bekor qilish sababi (reversal reason) kiritilishi shart';
  END IF;

  SELECT * INTO v_sale
    FROM public.jewelry_sales
   WHERE id = p_sale_id AND organization_id = v_caller_org
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bekor qilinadigan savdo yozuvi topilmadi (%)', p_sale_id;
  END IF;

  IF v_sale.status IN ('cancelled', 'reversed') THEN
    RAISE EXCEPTION 'Ushbu savdo allaqachon bekor qilingan (Holat: %)', v_sale.status;
  END IF;

  -- 1. Check if customer made active payments specifically applied to this sale
  FOR v_applied_sett IN
    SELECT * FROM public.gold_settlements
     WHERE sale_id = v_sale.id
       AND organization_id = v_caller_org
       AND status NOT IN ('reversed', 'cancelled')
  LOOP
    RAISE EXCEPTION 'Savdoni bekor qilib bo''lmaydi: Ushbu savdoga to''lov bog''langan (% — % g). Avval to''lovni bekor qiling.',
      v_applied_sett.settlement_no, v_applied_sett.applied_to_debt_grams;
  END LOOP;

  -- 2. Deduct customer debt generated by this sale
  SELECT * INTO v_client_acc
    FROM public.client_gold_accounts
   WHERE customer_id = v_sale.customer_id AND organization_id = v_caller_org
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.client_gold_accounts
       SET current_debt_grams = ROUND(GREATEST(0, current_debt_grams - v_sale.remaining_gold_grams)::numeric, 4),
           total_purchased_gold_grams = ROUND(GREATEST(0, total_purchased_gold_grams - v_sale.client_gold_due_grams)::numeric, 4),
           updated_at = NOW()
     WHERE customer_id = v_client_acc.customer_id;
  END IF;

  -- 3. If a physical piece was sold, restore it to seller hand
  SELECT * INTO v_piece
    FROM public.consignment_pieces
   WHERE sale_id = v_sale.id AND organization_id = v_caller_org
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.consignment_pieces
       SET status = 'held_by_seller',
           sale_id = NULL,
           sold_at = NULL,
           updated_at = NOW()
     WHERE id = v_piece.id;

    -- Reopen parent consignment if it was marked fully_sold
    IF v_piece.consignment_id IS NOT NULL THEN
      SELECT * INTO v_consign
        FROM public.seller_consignments
       WHERE id = v_piece.consignment_id
       FOR UPDATE;

      IF FOUND THEN
        UPDATE public.seller_consignments
           SET sold_quantity = GREATEST(0, COALESCE(sold_quantity, 1) - 1),
               status = CASE
                          WHEN COALESCE(sold_quantity, 1) - 1 <= 0 THEN 'held_by_seller'
                          ELSE 'partially_sold'
                        END,
               updated_at = NOW()
         WHERE id = v_consign.id;
      END IF;
    END IF;
  END IF;

  -- 4. Mark sale as reversed
  UPDATE public.jewelry_sales
     SET status = 'reversed',
         notes = COALESCE(notes, '') || ' [BEKOR QILINDI: ' || v_reason || ' (' || to_char(NOW(), 'YYYY-MM-DD HH24:MI') || ')]',
         updated_at = NOW()
   WHERE id = v_sale.id;

  -- 5. Recalculate seller responsibility
  PERFORM public.recalc_seller_gold_account(v_sale.seller_id, v_caller_org);

  -- 6. Audit log
  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) VALUES (
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

  RETURN jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale.id,
    'sale_no', v_sale.sale_no,
    'reversed_debt_g', v_sale.remaining_gold_grams,
    'restored_piece_id', v_piece.id,
    'message', 'Savdo muvaffaqiyatli bekor qilindi'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_reverse_jewelry_sale(uuid, text, text) TO authenticated;


-- -------------------------------------------------------------------------
-- PART 6: DAILY SALES LEDGER USD BREAKDOWN PARITY
-- -------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.rpc_get_daily_sales_ledger(uuid, date, date);

CREATE OR REPLACE FUNCTION public.rpc_get_daily_sales_ledger(
  p_seller_id   uuid DEFAULT NULL,
  p_start_date  date DEFAULT NULL,
  p_end_date    date DEFAULT NULL
)
RETURNS TABLE (
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
  usd_received      numeric,
  usd_rate          numeric,
  usd_equiv_g       numeric,
  total_payment_g   numeric,
  closing_debt_g    numeric,
  notes             text,
  status            text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_caller_emp_id uuid := public.current_employee_id();
  v_filter_seller uuid;
  v_today_tkt     date := (timezone('Asia/Tashkent', NOW()))::date;
  v_d1            date;
  v_d2            date;
  v_from          date;
  v_to            date;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  IF v_caller_role IN ('seller', 'sotuvchi', 'sales') THEN
    IF p_seller_id IS NOT NULL AND p_seller_id <> v_caller_emp_id THEN
      RAISE EXCEPTION 'Cross-seller violation: Sotuvchilar faqat o''z savdo jurnalini ko''ra oladi' USING errcode = '42501';
    END IF;
    v_filter_seller := v_caller_emp_id;
  ELSE
    v_filter_seller := p_seller_id;
  END IF;

  IF p_start_date IS NOT NULL AND p_end_date IS NULL THEN
    v_d1 := p_start_date;
    v_d2 := p_start_date;
  ELSIF p_start_date IS NULL AND p_end_date IS NOT NULL THEN
    v_d1 := p_end_date;
    v_d2 := p_end_date;
  ELSIF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    v_d1 := p_start_date;
    v_d2 := p_end_date;
  ELSE
    v_d1 := v_today_tkt - INTERVAL '30 days';
    v_d2 := v_today_tkt;
  END IF;

  v_from := LEAST(v_d1, v_d2);
  v_to   := GREATEST(v_d1, v_d2);

  RETURN QUERY
  -- 1. Sales entries
  SELECT
    s.id AS tx_id,
    'sale'::text AS tx_type,
    s.sale_date AS tx_date,
    s.customer_id,
    COALESCE(c.customer_code, 'CUST-XXXX') AS customer_code,
    COALESCE(c.contact_name, 'Mijoz') AS customer_name,
    s.seller_id,
    COALESCE(e.full_name, e.name, 'Sotuvchi') AS seller_name,
    s.product_name AS model_name,
    COALESCE(cp.model_code, 'M-GENERIC') AS model_code,
    cp.id AS item_id,
    s.base_weight_grams AS sold_weight_g,
    s.client_markup_pct AS markup_pct,
    s.client_gold_due_grams AS obligation_g,
    0::numeric AS scrap_received_g,
    0::numeric AS cash_received_uzs,
    0::numeric AS rate_per_gram,
    0::numeric AS cash_equiv_g,
    0::numeric AS usd_received,
    0::numeric AS usd_rate,
    0::numeric AS usd_equiv_g,
    COALESCE(s.settled_gold_grams, 0)::numeric AS total_payment_g,
    s.remaining_gold_grams AS closing_debt_g,
    s.notes,
    s.status
  FROM public.jewelry_sales s
  JOIN public.customers c ON c.id = s.customer_id
  JOIN public.employees e ON e.id = s.seller_id
  LEFT JOIN public.consignment_pieces cp ON cp.sale_id = s.id
  WHERE s.organization_id = v_caller_org
    AND s.sale_date BETWEEN v_from AND v_to
    AND (v_filter_seller IS NULL OR s.seller_id = v_filter_seller)

  UNION ALL

  -- 2. Payment/Settlement entries
  SELECT
    gs.id AS tx_id,
    'payment'::text AS tx_type,
    gs.settlement_date AS tx_date,
    gs.customer_id,
    COALESCE(c.customer_code, 'CUST-XXXX') AS customer_code,
    COALESCE(c.contact_name, 'Mijoz') AS customer_name,
    gs.seller_id,
    COALESCE(e.full_name, e.name, 'Sotuvchi') AS seller_name,
    'To''lov / Qaytim'::text AS model_name,
    'PAYMENT'::text AS model_code,
    NULL::uuid AS item_id,
    0::numeric AS sold_weight_g,
    0::numeric AS markup_pct,
    0::numeric AS obligation_g,
    gs.scrap_weight_grams AS scrap_received_g,
    gs.cash_paid_amount AS cash_received_uzs,
    gs.gold_rate_applied AS rate_per_gram,
    gs.cash_equivalent_grams AS cash_equiv_g,
    COALESCE(gs.usd_paid_amount, 0)::numeric AS usd_received,
    COALESCE(gs.applied_usd_rate, 0)::numeric AS usd_rate,
    COALESCE(gs.usd_equivalent_grams, 0)::numeric AS usd_equiv_g,
    gs.total_settled_grams AS total_payment_g,
    gs.remaining_debt_grams AS closing_debt_g,
    gs.notes,
    gs.status
  FROM public.gold_settlements gs
  JOIN public.customers c ON c.id = gs.customer_id
  JOIN public.employees e ON e.id = gs.seller_id
  WHERE gs.organization_id = v_caller_org
    AND gs.settlement_date BETWEEN v_from AND v_to
    AND (v_filter_seller IS NULL OR gs.seller_id = v_filter_seller)
  ORDER BY tx_date DESC, tx_id DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_daily_sales_ledger(uuid, date, date) TO authenticated;
