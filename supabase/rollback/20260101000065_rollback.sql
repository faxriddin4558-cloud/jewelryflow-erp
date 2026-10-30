-- ROLLBACK for migration 20260101000065_goldia_blocker_high_audit_fixes.sql
--
-- NOT a migration: lives outside supabase/migrations and is never applied automatically.
-- Restores the exact pre-065 (migration 064) function definitions and RLS write policies,
-- generated from the catalog of a database built from migrations 001-064.
--
-- What it does NOT do:
--   * It does not undo business data written while 065 was live (sales, settlements,
--     reversals). Those rows stay valid and auditable.
--   * It keeps jewelry_sales.source_piece_id (nullable, unused by 064 code) to avoid data loss.
--   * Rolling back the Vercel frontend does NOT run this file; database state only changes
--     when this script is executed explicitly.
--
-- Table/function grants: authenticated INSERT/UPDATE/DELETE is re-granted (064 state). anon
-- write access is NOT restored on purpose. Compare with the ACL snapshot taken by
-- supabase/release/065_preflight_readonly.sql.

begin;

CREATE OR REPLACE FUNCTION public.get_manager_available_stock_grams(p_org_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_seller_available_stock_grams(p_seller_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id    uuid := public.current_organization_id();
  v_consigned numeric(14, 4);
  v_sold      numeric(14, 4);
  v_ret       numeric(14, 4);
begin
  if p_seller_id is null then
    return 0;
  end if;

  select coalesce(sum(base_weight_grams), 0) into v_consigned
    from public.seller_consignments
   where seller_id = p_seller_id and organization_id = v_org_id
     and status in ('held_by_seller', 'partially_sold', 'fully_sold');

  select coalesce(sum(base_weight_grams), 0) into v_sold
    from public.jewelry_sales
   where seller_id = p_seller_id and organization_id = v_org_id
     and status not in ('cancelled', 'reversed');

  -- STRICT: Only count returns from non-cancelled/non-reversed consignments
  select coalesce(sum(cp.weight_grams), 0) into v_ret
    from public.consignment_pieces cp
    join public.seller_consignments sc on cp.consignment_id = sc.id
   where cp.seller_id = p_seller_id and cp.organization_id = v_org_id
     and cp.status in ('returned_to_factory', 'returned_to_manager')
     and sc.status not in ('cancelled', 'reversed');

  return round(greatest(0, v_consigned - v_sold - v_ret), 4);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_seller_reconciliation_statement(p_seller_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_record_barcode_piece_sale(p_customer_id uuid, p_seller_id uuid DEFAULT NULL::uuid, p_piece_id uuid DEFAULT NULL::uuid, p_model_id uuid DEFAULT NULL::uuid, p_weight_grams numeric DEFAULT NULL::numeric, p_client_markup_pct numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_record_client_settlement(p_customer_id uuid, p_sale_id uuid DEFAULT NULL::uuid, p_scrap_weight numeric DEFAULT 0, p_scrap_proba numeric DEFAULT NULL::numeric, p_cash_amount numeric DEFAULT 0, p_rate_per_gram numeric DEFAULT NULL::numeric, p_settlement_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_seller_id uuid DEFAULT NULL::uuid, p_usd_amount numeric DEFAULT 0, p_usd_rate numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_customer          public.customers%rowtype;
  v_rate              numeric(18, 2);
  v_usd_rate          numeric(18, 2);
  v_physical_scrap    numeric(14, 4);
  v_proba             numeric(6, 2);
  v_fine_gold         numeric(14, 4) := 0;
  v_scrap_585_eq      numeric(14, 4) := 0;
  v_cash              numeric(18, 2);
  v_usd               numeric(18, 2);
  v_cash_equiv        numeric(14, 4) := 0;
  v_usd_equiv         numeric(14, 4) := 0;
  v_total_settled     numeric(14, 4);
  v_settle_id         uuid;
  v_settle_no         text;
  v_client_acc        public.client_gold_accounts%rowtype;
  v_prev_debt         numeric(14, 4) := 0;
  v_applied_to_debt   numeric(14, 4) := 0;
  v_excess_advance    numeric(14, 4) := 0;
  v_rem_debt          numeric(14, 4) := 0;
  v_new_advance       numeric(14, 4) := 0;
  v_payload           jsonb;
  v_existing          jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  v_physical_scrap := round(greatest(0, coalesce(p_scrap_weight, 0))::numeric, 4);
  v_cash := round(greatest(0, coalesce(p_cash_amount, 0))::numeric, 2);
  v_usd  := round(greatest(0, coalesce(p_usd_amount, 0))::numeric, 2);

  if v_physical_scrap <= 0 and v_cash <= 0 and v_usd <= 0 then
    raise exception 'To''lov uchun lom vazni, naqd so''m yoki dollar summasi kiritilishi shart';
  end if;

  -- 1. Scrap validation
  if v_physical_scrap > 0 then
    if p_scrap_proba is null or p_scrap_proba <= 0 then
      raise exception 'Lom oltin probasi aniq ko''rsatilishi shart (masalan: 375, 585, 750, 995, 999.9)';
    end if;
    v_proba := round(p_scrap_proba::numeric, 2);
    if v_proba < 300.0 or v_proba > 1000.0 then
      raise exception 'Noto''g''ri proba kiritildi: % (ruxsat: 300 - 1000)', v_proba;
    end if;

    v_fine_gold := round((v_physical_scrap * (v_proba / 1000.0))::numeric, 4);
    v_scrap_585_eq := round((v_physical_scrap * (v_proba / 585.0))::numeric, 4);
  else
    v_proba := 585.0;
    v_fine_gold := 0;
    v_scrap_585_eq := 0;
  end if;

  -- 2. 585 Gold rate determination (NO SILENT 900,000 FALLBACK!)
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_caller_org and proba = 585 and is_confirmed = true
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      select rate_per_gram into v_rate
      from public.daily_gold_rates
      where organization_id = v_caller_org and proba = 585
      order by rate_date desc, created_at desc
      limit 1;
    end if;
  end if;

  if (v_cash > 0 or v_usd > 0) and (v_rate is null or v_rate <= 0) then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Naqd pul yoki dollarni qabul qilish uchun 585 oltin kursi kiritilishi shart! Avval kunlik kursni belgilang.';
  end if;

  -- Sentinel rate for scrap-only to satisfy DB check constraint
  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0;
  end if;

  -- 3. USD rate determination (NO SILENT 12,850 FALLBACK!)
  if v_usd > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) to''lovini hisoblash uchun USD kursi (CBU yoki qo''lda) kiritilishi shart!';
    end if;

    -- USD -> UZS -> 585 Gold Grams
    v_usd_equiv := round(((v_usd * v_usd_rate) / v_rate)::numeric, 4);
  else
    v_usd_rate := null;
    v_usd_equiv := 0;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  else
    v_cash_equiv := 0;
  end if;

  -- 4. Total settled grams = scrap (in 585 eq) + UZS equiv + USD equiv
  v_total_settled := round(v_scrap_585_eq + v_cash_equiv + v_usd_equiv, 4);

  -- 5. Customer lookup
  select * into v_customer
  from public.customers
  where id = p_customer_id and organization_id = v_caller_org
  limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;

  -- 6. Seller lookup
  if p_seller_id is not null then
    select * into v_seller
    from public.employees
    where id = p_seller_id and organization_id = v_caller_org
    limit 1;
  elsif v_customer.seller_id is not null then
    select * into v_seller
    from public.employees
    where id = v_customer.seller_id and organization_id = v_caller_org
    limit 1;
  else
    select * into v_seller
    from public.employees
    where user_id = auth.uid() and organization_id = v_caller_org
    limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_client_settlement',
    'customer_id', p_customer_id,
    'scrap_weight', v_physical_scrap,
    'cash_amount', v_cash,
    'usd_amount', v_usd
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 7. Lock client gold account FOR UPDATE
  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = p_customer_id and organization_id = v_caller_org
  for update;

  if found then
    v_prev_debt := coalesce(v_client_acc.current_debt_grams, 0);
  else
    v_prev_debt := 0;
  end if;

  -- Debt reduction math
  if v_total_settled <= v_prev_debt then
    v_applied_to_debt := v_total_settled;
    v_excess_advance  := 0;
    v_rem_debt        := round((v_prev_debt - v_total_settled)::numeric, 4);
    v_new_advance     := coalesce(v_client_acc.advance_balance_grams, 0);
  else
    v_applied_to_debt := v_prev_debt;
    v_excess_advance  := round((v_total_settled - v_prev_debt)::numeric, 4);
    v_rem_debt        := 0;
    v_new_advance     := round((coalesce(v_client_acc.advance_balance_grams, 0) + v_excess_advance)::numeric, 4);
  end if;

  v_settle_no := 'SETTL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id, customer_id, sale_id,
    settlement_date, gold_rate_applied,
    scrap_weight_grams, physical_scrap_grams, scrap_proba, fine_gold_grams, scrap_585_equiv_grams,
    cash_paid_amount, currency, cash_equivalent_grams,
    usd_paid_amount, applied_usd_rate, usd_equivalent_grams,
    total_settled_grams, applied_to_debt_grams, excess_gold_grams,
    previous_debt_grams, remaining_debt_grams,
    status, notes, recorded_by, idempotency_key
  ) values (
    v_caller_org, v_settle_no, 'client_to_seller', v_seller.id, v_customer.id, p_sale_id,
    coalesce(p_settlement_date, current_date), v_rate,
    v_scrap_585_eq, v_physical_scrap, v_proba, v_fine_gold, v_scrap_585_eq,
    v_cash, 'UZS', v_cash_equiv,
    v_usd, v_usd_rate, v_usd_equiv,
    v_total_settled, v_applied_to_debt, v_excess_advance,
    v_prev_debt, v_rem_debt,
    'confirmed', p_notes, coalesce(public.current_employee_id(), v_seller.id), nullif(btrim(p_idempotency_key), '')
  ) returning id into v_settle_id;

  -- 8. Update client_gold_accounts atomically
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, 0,
    v_scrap_585_eq, v_cash, round(v_cash_equiv + v_usd_equiv, 4), v_total_settled,
    v_rem_debt, v_new_advance, now()
  )
  on conflict (customer_id) do update set
    total_scrap_paid_grams = round((client_gold_accounts.total_scrap_paid_grams + v_scrap_585_eq)::numeric, 4),
    total_cash_paid_amount = round((client_gold_accounts.total_cash_paid_amount + v_cash)::numeric, 2),
    total_cash_equiv_grams = round((client_gold_accounts.total_cash_equiv_grams + v_cash_equiv + v_usd_equiv)::numeric, 4),
    total_settled_grams    = round((client_gold_accounts.total_settled_grams + v_total_settled)::numeric, 4),
    current_debt_grams     = v_rem_debt,
    advance_balance_grams  = v_new_advance,
    updated_at             = now();

  -- 9. Update seller till with received scrap (PHYSICAL and 585 EQ), cash UZS and cash USD
  insert into public.seller_gold_accounts (
    seller_id, organization_id,
    seller_till_scrap_grams, seller_till_scrap_physical_g, seller_till_scrap_585_eq_g,
    seller_till_cash_amount, seller_till_usd_amount, updated_at
  ) values (
    v_seller.id, v_caller_org,
    v_scrap_585_eq, v_physical_scrap, v_scrap_585_eq,
    v_cash, v_usd, now()
  )
  on conflict (seller_id) do update set
    seller_till_scrap_grams        = round((seller_gold_accounts.seller_till_scrap_grams + v_scrap_585_eq)::numeric, 4),
    seller_till_scrap_physical_g   = round((coalesce(seller_gold_accounts.seller_till_scrap_physical_g, 0) + v_physical_scrap)::numeric, 4),
    seller_till_scrap_585_eq_g     = round((coalesce(seller_gold_accounts.seller_till_scrap_585_eq_g, 0) + v_scrap_585_eq)::numeric, 4),
    seller_till_cash_amount        = round((seller_gold_accounts.seller_till_cash_amount + v_cash)::numeric, 2),
    seller_till_usd_amount         = round((coalesce(seller_gold_accounts.seller_till_usd_amount, 0) + v_usd)::numeric, 2),
    updated_at                     = now();

  -- If linked to specific sale, update settled amount on sale
  if p_sale_id is not null then
    update public.jewelry_sales
    set settled_gold_grams = round((coalesce(settled_gold_grams, 0) + v_applied_to_debt)::numeric, 4),
        remaining_gold_grams = round(greatest(0, remaining_gold_grams - v_applied_to_debt)::numeric, 4),
        status = case
          when round(greatest(0, remaining_gold_grams - v_applied_to_debt)::numeric, 4) <= 0.0001 then 'fully_paid'
          else 'partially_paid'
        end,
        updated_at = now()
    where id = p_sale_id and organization_id = v_caller_org;
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'physical_scrap_grams', v_physical_scrap,
    'scrap_weight_grams', v_physical_scrap,
    'scrap_proba', v_proba,
    'fine_gold_grams', v_fine_gold,
    'scrap_585_equiv_grams', v_scrap_585_eq,
    'cash_paid_amount', v_cash,
    'usd_paid_amount', v_usd,
    'usd_rate_applied', v_usd_rate,
    'rate_applied', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'usd_equivalent_grams', v_usd_equiv,
    'total_settled_585_grams', v_total_settled,
    'total_settled_grams', v_total_settled,
    'previous_debt_grams', v_prev_debt,
    'applied_to_debt_grams', v_applied_to_debt,
    'excess_gold_advance_grams', v_excess_advance,
    'excess_gold_grams', v_excess_advance,
    'remaining_debt_grams', v_rem_debt,
    'advance_balance_grams', v_new_advance,
    'seller_id', v_seller.id,
    'customer_id', v_customer.id
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_settlement', v_existing, v_payload);

  return v_existing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_record_seller_to_manager_settlement(p_seller_id uuid, p_scrap_weight_grams numeric DEFAULT 0, p_cash_paid_amount numeric DEFAULT 0, p_rate_per_gram numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_usd_paid_amount numeric DEFAULT 0, p_usd_rate numeric DEFAULT NULL::numeric, p_physical_scrap_g numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id          uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_rate            numeric(18, 2);
  v_usd_rate        numeric(18, 2);
  v_scrap_585_eq    numeric(14, 4);
  v_scrap_phys      numeric(14, 4);
  v_cash            numeric(18, 2);
  v_usd             numeric(18, 2);
  v_cash_equiv      numeric(14, 4) := 0;
  v_usd_equiv       numeric(14, 4) := 0;
  v_total_settled   numeric(14, 4);
  v_settle_no       text;
  v_settle_id       uuid;
  v_seller_acc      public.seller_gold_accounts%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_existing        jsonb;
  v_payload         jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

  v_scrap_585_eq := round(greatest(0, coalesce(p_scrap_weight_grams, 0))::numeric, 4);
  v_scrap_phys   := round(greatest(0, coalesce(p_physical_scrap_g, p_scrap_weight_grams, 0))::numeric, 4);
  v_cash := round(greatest(0, coalesce(p_cash_paid_amount, 0))::numeric, 2);
  v_usd  := round(greatest(0, coalesce(p_usd_paid_amount, 0))::numeric, 2);

  if v_scrap_585_eq <= 0 and v_cash <= 0 and v_usd <= 0 then
    raise exception 'Settlement must include either scrap gold grams, UZS cash, or USD cash';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_seller_to_manager_settlement',
    'seller_id', p_seller_id,
    'scrap_w', v_scrap_585_eq,
    'scrap_phys', v_scrap_phys,
    'cash', v_cash,
    'usd', v_usd
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_seller_to_manager_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. STRICT LOCK ORDER HIERARCHY: Lock Manager Vault FIRST
  perform public._get_or_create_manager_vault(v_org_id);

  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_org_id
  for update;

  -- 2. STRICT LOCK ORDER HIERARCHY: Lock Seller Gold Account SECOND
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id and organization_id = v_org_id
  for update;

  if not found then
    raise exception 'Sotuvchi oltin hisobi topilmadi: %', p_seller_id;
  end if;

  -- 3. HARD BALANCE CHECK (F03):
  if v_scrap_585_eq > 0 and v_seller_acc.seller_till_scrap_grams < v_scrap_585_eq then
    raise exception 'ERR_INSUFFICIENT_SCRAP_BALANCE: Sotuvchi kassasida yetarli lom mavjud emas (Kassada: % g, Talab: % g)',
      v_seller_acc.seller_till_scrap_grams, v_scrap_585_eq;
  end if;

  if v_cash > 0 and v_seller_acc.seller_till_cash_amount < v_cash then
    raise exception 'ERR_INSUFFICIENT_CASH_BALANCE: Sotuvchi kassasida yetarli naqd pul (UZS) mavjud emas (Kassada: % UZS, Talab: % UZS)',
      v_seller_acc.seller_till_cash_amount, v_cash;
  end if;

  if v_usd > 0 and coalesce(v_seller_acc.seller_till_usd_amount, 0) < v_usd then
    raise exception 'ERR_INSUFFICIENT_USD_BALANCE: Sotuvchi kassasida yetarli dollar (USD) mavjud emas (Kassada: % USD, Talab: % USD)',
      coalesce(v_seller_acc.seller_till_usd_amount, 0), v_usd;
  end if;

  -- 4. Gold Rate determination
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_org_id and proba = 585 and is_confirmed = true
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      select rate_per_gram into v_rate
      from public.daily_gold_rates
      where organization_id = v_org_id and proba = 585
      order by rate_date desc, created_at desc
      limit 1;
    end if;

    if (v_cash > 0 or v_usd > 0) and (v_rate is null or v_rate <= 0) then
      raise exception 'ERR_DAILY_RATE_NOT_SET: Bugungi 585 oltin kursi belgilanmagan! Naqd pul topshirish uchun avval kunlik kursni kiriting.';
    end if;
  end if;

  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0; -- Safe sentinel rate for DB check constraint (gold_rate_applied > 0) when cash is 0
  end if;

  -- 5. USD Rate determination
  if v_usd > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) topshirish uchun USD kursi kiritilishi shart!';
    end if;
    v_usd_equiv := round(((v_usd * v_usd_rate) / v_rate)::numeric, 4);
  else
    v_usd_rate := null;
    v_usd_equiv := 0;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  else
    v_cash_equiv := 0;
  end if;

  v_total_settled := round(v_scrap_585_eq + v_cash_equiv + v_usd_equiv, 4);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
    if v_caller_emp_id is null then
      v_caller_emp_id := p_seller_id;
    end if;
  end if;

  -- 6. Deduct exactly from seller till (both physical and 585 eq scrap)
  update public.seller_gold_accounts
  set seller_till_scrap_grams        = round(seller_till_scrap_grams - v_scrap_585_eq, 4),
      seller_till_scrap_585_eq_g     = round(greatest(0, coalesce(seller_till_scrap_585_eq_g, 0) - v_scrap_585_eq), 4),
      seller_till_scrap_physical_g   = round(greatest(0, coalesce(seller_till_scrap_physical_g, 0) - v_scrap_phys), 4),
      seller_till_cash_amount        = round(seller_till_cash_amount - v_cash, 2),
      seller_till_usd_amount         = round(coalesce(seller_till_usd_amount, 0) - v_usd, 2),
      updated_at = now()
  where seller_id = p_seller_id;

  -- 7. Add to manager vault (both physical and 585 eq scrap)
  update public.manager_vault_account
  set manager_scrap_grams        = round(manager_scrap_grams + v_scrap_585_eq, 4),
      manager_scrap_585_eq_g     = round(coalesce(manager_scrap_585_eq_g, 0) + v_scrap_585_eq, 4),
      manager_scrap_physical_g   = round(coalesce(manager_scrap_physical_g, 0) + v_scrap_phys, 4),
      manager_cash_amount        = round(manager_cash_amount + v_cash, 2),
      manager_usd_amount         = round(coalesce(manager_usd_amount, 0) + v_usd, 2),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  -- 8. Insert gold settlement
  v_settle_no := 'STL-MGR-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id,
    settlement_no,
    direction,
    seller_id,
    gold_rate_applied,
    scrap_weight_grams,
    physical_scrap_grams,
    scrap_proba,
    scrap_585_equiv_grams,
    cash_paid_amount,
    currency,
    cash_equivalent_grams,
    usd_paid_amount,
    applied_usd_rate,
    usd_equivalent_grams,
    total_settled_grams,
    applied_to_debt_grams,
    excess_gold_grams,
    previous_debt_grams,
    remaining_debt_grams,
    status,
    notes,
    recorded_by,
    idempotency_key
  ) values (
    v_org_id,
    v_settle_no,
    'seller_to_manager',
    p_seller_id,
    v_rate,
    v_scrap_585_eq,
    v_scrap_phys,
    585,
    v_scrap_585_eq,
    v_cash,
    'UZS',
    v_cash_equiv,
    v_usd,
    v_usd_rate,
    v_usd_equiv,
    v_total_settled,
    v_total_settled,
    0,
    coalesce(v_seller_acc.seller_owes_manager_g, v_seller_acc.current_factory_obligation_grams, 0),
    round(greatest(0, coalesce(v_seller_acc.seller_owes_manager_g, v_seller_acc.current_factory_obligation_grams, 0) - v_total_settled), 4),
    'confirmed',
    p_notes,
    v_caller_emp_id,
    p_idempotency_key
  ) returning id into v_settle_id;

  -- 9. Read synced seller gold account
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'scrap_grams_settled', v_scrap_585_eq,
    'scrap_weight_grams', v_scrap_585_eq,
    'scrap_physical_grams', v_scrap_phys,
    'cash_amount_settled', v_cash,
    'usd_amount_settled', v_usd,
    'applied_usd_rate', v_usd_rate,
    'applied_rate_per_gram', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'usd_equivalent_grams', v_usd_equiv,
    'total_settled_grams', v_total_settled,
    'remaining_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'seller_owes_manager_g', v_seller_acc.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'seller_till_scrap_grams', v_seller_acc.seller_till_scrap_grams,
    'seller_till_scrap_physical_g', v_seller_acc.seller_till_scrap_physical_g,
    'seller_till_cash_amount', v_seller_acc.seller_till_cash_amount,
    'seller_till_usd_amount', v_seller_acc.seller_till_usd_amount,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_scrap_physical_g', v_vault.manager_scrap_physical_g,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_seller_to_manager_settlement', v_existing, v_payload);

  return v_existing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_record_weight_sale(p_customer_id uuid, p_seller_id uuid DEFAULT NULL::uuid, p_weight_grams numeric DEFAULT NULL::numeric, p_client_markup_pct numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_caller_emp_id uuid := public.current_employee_id();
  v_seller        public.employees%rowtype;
  v_customer      public.customers%rowtype;
  v_seller_acc    public.seller_gold_accounts%rowtype;
  v_client_acc    public.client_gold_accounts%rowtype;
  v_weight        numeric(14, 4);
  v_markup        numeric(6, 2);
  v_avail_stock   numeric(14, 4);
  v_client_due    numeric(14, 4);
  v_avail_adv     numeric(14, 4);
  v_apply_adv     numeric(14, 4);
  v_net_rem_due   numeric(14, 4);
  v_sale_no       text;
  v_sale_id       uuid;
  v_existing      jsonb;
  v_payload       jsonb;
  v_consign       public.seller_consignments%rowtype;
  v_piece         public.consignment_pieces%rowtype;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  v_weight := round(greatest(0, coalesce(p_weight_grams, 0))::numeric, 4);
  v_markup := round(coalesce(p_client_markup_pct, 0)::numeric, 2);

  if v_weight <= 0 then
    raise exception 'Sotilayotgan mahsulot vazni 0 dan katta bo''lishi shart';
  end if;

  -- Seller determination
  if v_caller_role in ('seller', 'sotuvchi', 'sales') then
    select * into v_seller from public.employees
    where id = v_caller_emp_id and organization_id = v_caller_org limit 1;
  elsif p_seller_id is not null then
    select * into v_seller from public.employees
    where id = p_seller_id and organization_id = v_caller_org limit 1;
  else
    select * into v_seller from public.employees
    where organization_id = v_caller_org and lower(role::text) in ('seller', 'sotuvchi', 'sales')
    order by created_at asc limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  select * into v_customer from public.customers
   where id = p_customer_id and organization_id = v_caller_org limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;

  -- Check available physical stock via canonical helper
  v_avail_stock := public.get_seller_available_stock_grams(v_seller.id);

  if v_avail_stock < v_weight then
    raise exception 'ERR_INSUFFICIENT_SELLER_STOCK: Sotuvchi omborida yetarli oltin mavjud emas (Mavjud: % g, Talab: % g)',
      v_avail_stock, v_weight;
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_weight_sale',
    'customer_id', p_customer_id,
    'seller_id', v_seller.id,
    'weight_grams', v_weight,
    'markup_pct', v_markup
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_weight_sale', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Math: Client gross gold due = weight * (1 + markup / 100)
  v_client_due := round((v_weight * (1.0 + v_markup / 100.0))::numeric, 4);

  -- Lock client account and check advance
  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_customer.id and organization_id = v_caller_org
   for update;

  v_avail_adv := coalesce(v_client_acc.advance_balance_grams, 0);

  if v_avail_adv > 0 then
    v_apply_adv   := round(least(v_avail_adv, v_client_due)::numeric, 4);
    v_net_rem_due := round((v_client_due - v_apply_adv)::numeric, 4);
  else
    v_apply_adv   := 0;
    v_net_rem_due := v_client_due;
  end if;

  -- FIFO: Link sale to seller's active consignment
  select * into v_consign
    from public.seller_consignments
   where seller_id = v_seller.id and organization_id = v_caller_org
     and status in ('held_by_seller', 'partially_sold')
   order by created_at asc
   limit 1
   for update;

  v_sale_no := 'SALE-W-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.jewelry_sales (
    organization_id, sale_no, seller_id, customer_id, consignment_id,
    product_name, quantity, base_weight_grams, proba,
    factory_markup_pct, factory_gold_due_grams,
    client_markup_pct, client_gold_due_grams,
    markup_spread_grams, settled_gold_grams, remaining_gold_grams,
    status, sale_date, idempotency_key, notes, sale_type
  ) values (
    v_caller_org, v_sale_no, v_seller.id, v_customer.id, v_consign.id,
    'Standart 585 Oltin (Vazn bo''yicha)', 1, v_weight, 585.00,
    0.00, v_weight,
    v_markup, v_client_due,
    round((v_client_due - v_weight)::numeric, 4), v_apply_adv, v_net_rem_due,
    case when v_net_rem_due <= 0.0001 then 'fully_paid' else 'open_debt' end,
    current_date, nullif(btrim(p_idempotency_key), ''), p_notes, 'weight'
  ) returning id into v_sale_id;

  -- If a consignment was linked, update sold info and pieces
  if v_consign.id is not null then
    update public.seller_consignments
       set status = 'partially_sold',
           sold_quantity = coalesce(sold_quantity, 0) + 1,
           updated_at = now()
     where id = v_consign.id;

    -- Also check if a weight-only consignment piece exists to decrement
    select * into v_piece
      from public.consignment_pieces
     where consignment_id = v_consign.id and status = 'held_by_seller'
     order by created_at asc limit 1
     for update;

    if found then
      if v_piece.weight_grams - v_weight > 0.0001 then
        update public.consignment_pieces
           set weight_grams = round((weight_grams - v_weight)::numeric, 4),
               updated_at = now()
         where id = v_piece.id;
      else
        update public.consignment_pieces
           set status = 'sold',
               sale_id = v_sale_id,
               sold_at = now(),
               updated_at = now()
         where id = v_piece.id;
      end if;
    end if;
  end if;

  -- Update client_gold_accounts atomically
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    current_debt_grams, advance_balance_grams, total_settled_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, v_client_due,
    v_net_rem_due, round(greatest(0, v_avail_adv - v_apply_adv)::numeric, 4), v_apply_adv, now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_due)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_net_rem_due)::numeric, 4),
    advance_balance_grams      = round(greatest(0, client_gold_accounts.advance_balance_grams - v_apply_adv)::numeric, 4),
    total_settled_grams        = round((client_gold_accounts.total_settled_grams + v_apply_adv)::numeric, 4),
    seller_id                  = coalesce(client_gold_accounts.seller_id, v_seller.id),
    updated_at                 = now();

  -- Recalculate seller gold account
  perform public.recalc_seller_gold_account(v_seller.id, v_caller_org);

  v_avail_stock := public.get_seller_available_stock_grams(v_seller.id);

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'seller_id', v_seller.id,
    'customer_id', v_customer.id,
    'base_weight_grams', v_weight,
    'weight_grams', v_weight,
    'client_markup_pct', v_markup,
    'client_gold_due_grams', v_client_due,
    'advance_applied_grams', v_apply_adv,
    'remaining_debt_grams', v_net_rem_due,
    'remaining_physical_stock_g', v_avail_stock
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_weight_sale', v_existing, v_payload);
  return v_existing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_return_piece_to_factory(p_piece_id uuid, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_reverse_client_sale(p_sale_id uuid, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_org       uuid := public.current_organization_id();
  v_caller_role      text := public.current_employee_role_text();
  v_caller_emp_id    uuid := public.current_employee_id();
  v_clean_reason     text := NULLIF(btrim(p_reason), '');
  v_sale             public.jewelry_sales%rowtype;
  v_cust_acc         public.client_gold_accounts%rowtype;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_net_sale_debt    numeric(14, 4);
  v_new_cust_debt    numeric(14, 4);
  v_new_cust_adv     numeric(14, 4);
  v_new_seller_debt  numeric(14, 4);
  v_piece            public.consignment_pieces%rowtype;
  v_consign          public.seller_consignments%rowtype;
  v_payload          jsonb;
  v_existing         jsonb;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Permission denied: User must belong to an active organization' USING errcode = '42501';
  END IF;

  PERFORM public.assert_erp_permission(ARRAY[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'Savdoni bekor qilish sababi kiritilishi shart';
  END IF;

  v_payload := jsonb_build_object(
    'action', 'reverse_client_sale',
    'sale_id', p_sale_id,
    'reason', v_clean_reason
  );

  IF p_idempotency_key IS NOT NULL THEN
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_client_sale', v_payload);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- 1. Lock and fetch sale
  SELECT * INTO v_sale
    FROM public.jewelry_sales
   WHERE id = p_sale_id AND organization_id = v_caller_org
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Savdo hujjati topilmadi (%)', p_sale_id;
  END IF;

  IF v_sale.status IN ('reversed', 'cancelled') THEN
    RAISE EXCEPTION 'Ushbu savdo allaqachon bekor qilingan (%s)', v_sale.sale_no;
  END IF;

  -- Cross-seller sale reversal authorization check
  IF v_caller_role IN ('seller', 'sotuvchi', 'sales') THEN
    IF v_sale.seller_id IS DISTINCT FROM v_caller_emp_id THEN
      RAISE EXCEPTION 'Ruxsat etilmadi: Sotuvchilar faqat o''zi amalga oshirgan savdoni bekor qila oladi' USING errcode = '42501';
    END IF;
  END IF;

  -- 2. Lock client_gold_accounts
  SELECT * INTO v_cust_acc
    FROM public.client_gold_accounts
   WHERE customer_id = v_sale.customer_id AND organization_id = v_caller_org
   FOR UPDATE;

  -- 3. Lock seller_gold_accounts
  SELECT * INTO v_seller_acc
    FROM public.seller_gold_accounts
   WHERE seller_id = v_sale.seller_id AND organization_id = v_caller_org
   FOR UPDATE;

  -- Net customer debt that was added by this sale
  v_net_sale_debt := ROUND((v_sale.client_gold_due_grams - COALESCE(v_sale.settled_gold_grams, 0))::numeric, 4);

  -- Adjust customer debt and restore any applied advance
  v_new_cust_debt := ROUND(GREATEST(0, COALESCE(v_cust_acc.current_debt_grams, 0) - v_net_sale_debt)::numeric, 4);
  v_new_cust_adv  := ROUND((COALESCE(v_cust_acc.advance_balance_grams, 0) + COALESCE(v_sale.settled_gold_grams, 0))::numeric, 4);

  UPDATE public.client_gold_accounts
     SET total_purchased_gold_grams = ROUND(GREATEST(0, total_purchased_gold_grams - v_sale.client_gold_due_grams)::numeric, 4),
         current_debt_grams         = v_new_cust_debt,
         advance_balance_grams      = v_new_cust_adv,
         total_settled_grams        = ROUND(GREATEST(0, total_settled_grams - COALESCE(v_sale.settled_gold_grams, 0))::numeric, 4),
         updated_at                 = NOW()
   WHERE customer_id = v_sale.customer_id;

  -- Adjust seller's total client debt
  v_new_seller_debt := ROUND(GREATEST(0, COALESCE(v_seller_acc.total_client_debt_grams, 0) - v_net_sale_debt)::numeric, 4);
  UPDATE public.seller_gold_accounts
     SET total_client_debt_grams = v_new_seller_debt,
         updated_at              = NOW()
   WHERE seller_id = v_sale.seller_id;

  -- Mark sale as reversed
  UPDATE public.jewelry_sales
     SET status          = 'reversed',
         notes           = COALESCE(notes, '') || ' [BEKOR QILINDI: ' || v_clean_reason || ']',
         updated_at      = NOW()
   WHERE id = v_sale.id;

  -- 4. If a physical piece or weight stock was sold, restore it onto consignment_pieces
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
  ELSIF v_sale.consignment_id IS NOT NULL THEN
    SELECT * INTO v_piece
      FROM public.consignment_pieces
     WHERE consignment_id = v_sale.consignment_id AND status = 'held_by_seller'
     ORDER BY updated_at DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.consignment_pieces
         SET weight_grams = ROUND((weight_grams + v_sale.base_weight_grams)::numeric, 4),
             updated_at = NOW()
       WHERE id = v_piece.id;
    ELSE
      -- All pieces in this consignment were marked sold/unassigned. Re-create / re-open an active held piece with restored weight!
      INSERT INTO public.consignment_pieces (
        organization_id, consignment_id, model_code, model_name, category,
        purity, weight_grams, status, seller_id, notes
      ) VALUES (
        v_caller_org, v_sale.consignment_id, COALESCE(v_sale.model_code, 'VAZN'), COALESCE(v_sale.product_name, 'Qaytarilgan VAZN'),
        COALESCE(v_sale.category, 'Buyum'), COALESCE(v_sale.purity, 585), v_sale.base_weight_grams,
        'held_by_seller', v_sale.seller_id, 'Restored from reversed sale ' || v_sale.sale_no
      );
    END IF;

    SELECT * INTO v_consign
      FROM public.seller_consignments
     WHERE id = v_sale.consignment_id
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.seller_consignments
         SET sold_quantity = GREATEST(0, COALESCE(sold_quantity, 1) - 1),
             status = CASE
                        WHEN GREATEST(0, COALESCE(sold_quantity, 1) - 1) <= 0 THEN 'held_by_seller'
                        ELSE 'partially_sold'
                      END,
             updated_at = NOW()
       WHERE id = v_consign.id;
    END IF;
  END IF;

  -- Recalculate seller gold account physical stock
  PERFORM public.recalc_seller_gold_account(v_sale.seller_id, v_caller_org);

  -- Audit log
  INSERT INTO public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) VALUES (
    v_caller_org, 'jewelry_sales', v_sale.id::text, 'REVERSE_CLIENT_SALE', auth.uid(),
    jsonb_build_object(
      'sale_no', v_sale.sale_no,
      'base_weight_grams', v_sale.base_weight_grams,
      'client_gold_due_grams', v_sale.client_gold_due_grams,
      'customer_id', v_sale.customer_id,
      'seller_id', v_sale.seller_id
    ),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale.id,
    'sale_no', v_sale.sale_no,
    'restored_weight_g', v_sale.base_weight_grams,
    'reversed_debt_g', v_net_sale_debt
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_sale', v_existing, v_payload);
  END IF;

  RETURN v_existing;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_reverse_client_settlement(p_settlement_id uuid, p_reason text DEFAULT 'Audited Compensating Reversal'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org       uuid := public.current_organization_id();
  v_caller_emp_id    uuid := public.current_employee_id();
  v_settle           public.gold_settlements%rowtype;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_client_acc       public.client_gold_accounts%rowtype;
  v_payload          jsonb;
  v_existing         jsonb;
  v_scrap_phys       numeric(14, 4);
  v_scrap_585        numeric(14, 4);
  v_cash_uzs         numeric(18, 2);
  v_cash_usd         numeric(18, 2);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  v_payload := jsonb_build_object(
    'action', 'reverse_client_settlement',
    'settlement_id', p_settlement_id,
    'reason', p_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_settle
    from public.gold_settlements
   where id = p_settlement_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'To''lov yozuvi (%) topilmadi', p_settlement_id;
  end if;

  if v_settle.status = 'reversed' then
    return jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'settlement_id', v_settle.id,
      'message', 'To''lov avval bekor qilingan'
    );
  end if;

  v_scrap_phys := round(coalesce(v_settle.physical_scrap_grams, v_settle.scrap_weight_grams, 0)::numeric, 4);
  v_scrap_585  := round(coalesce(v_settle.scrap_585_equiv_grams, v_settle.scrap_weight_grams, 0)::numeric, 4);
  v_cash_uzs   := round(coalesce(v_settle.cash_paid_amount, 0)::numeric, 2);
  v_cash_usd   := round(coalesce(v_settle.usd_paid_amount, 0)::numeric, 2);

  -- Verify seller till has sufficient scrap, UZS cash, and USD
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id
     and organization_id = v_caller_org
   for update;

  if found then
    if v_scrap_phys > 0 and coalesce(v_seller_acc.seller_till_scrap_physical_g, v_seller_acc.seller_till_scrap_grams, 0) < v_scrap_phys then
      raise exception 'To''lovni bekor qilib bo''lmaydi: Sotuvchi kassasidagi fizik lom yetarli emas (Mavjud: % g, Talab: % g). Avval boshqaruvchiga topshirilgan lomni qaytaring.',
        coalesce(v_seller_acc.seller_till_scrap_physical_g, v_seller_acc.seller_till_scrap_grams, 0), v_scrap_phys;
    end if;

    if v_cash_uzs > 0 and coalesce(v_seller_acc.seller_till_cash_amount, 0) < v_cash_uzs then
      raise exception 'To''lovni bekor qilib bo''lmaydi: Sotuvchi kassasidagi naqd so''m yetarli emas (Mavjud: % UZS, Talab: % UZS).',
        v_seller_acc.seller_till_cash_amount, v_cash_uzs;
    end if;

    if v_cash_usd > 0 and coalesce(v_seller_acc.seller_till_usd_amount, 0) < v_cash_usd then
      raise exception 'To''lovni bekor qilib bo''lmaydi: Sotuvchi kassasidagi naqd USD yetarli emas (Mavjud: % USD, Talab: % USD).',
        v_seller_acc.seller_till_usd_amount, v_cash_usd;
    end if;

    -- Deduct ALL till holdings
    update public.seller_gold_accounts
       set seller_till_scrap_grams       = round(greatest(0, seller_till_scrap_grams - coalesce(v_settle.scrap_weight_grams, 0))::numeric, 4),
           seller_till_scrap_physical_g  = round(greatest(0, coalesce(seller_till_scrap_physical_g, 0) - v_scrap_phys)::numeric, 4),
           seller_till_scrap_585_eq_g    = round(greatest(0, coalesce(seller_till_scrap_585_eq_g, 0) - v_scrap_585)::numeric, 4),
           seller_till_cash_amount       = round(greatest(0, seller_till_cash_amount - v_cash_uzs)::numeric, 2),
           seller_till_usd_amount        = round(greatest(0, coalesce(seller_till_usd_amount, 0) - v_cash_usd)::numeric, 2),
           updated_at                    = now()
     where seller_id = v_settle.seller_id;
  end if;

  -- Restore customer debt and reverse excess advance in client_gold_accounts
  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_settle.customer_id
     and organization_id = v_caller_org
   for update;

  if found then
    update public.client_gold_accounts
       set current_debt_grams    = round((current_debt_grams + v_settle.applied_to_debt_grams)::numeric, 4),
           advance_balance_grams = round(greatest(0, advance_balance_grams - v_settle.excess_gold_grams)::numeric, 4),
           total_settled_grams   = round(greatest(0, total_settled_grams - v_settle.total_settled_grams)::numeric, 4),
           total_scrap_paid_grams= round(greatest(0, total_scrap_paid_grams - coalesce(v_settle.scrap_weight_grams, 0))::numeric, 4),
           total_cash_paid_amount= round(greatest(0, total_cash_paid_amount - v_cash_uzs)::numeric, 2),
           total_cash_equiv_grams= round(greatest(0, total_cash_equiv_grams - coalesce(v_settle.cash_equivalent_grams, 0))::numeric, 4),
           updated_at            = now()
     where customer_id = v_settle.customer_id;
  end if;

  -- Also reverse advance on customers table
  update public.customers
     set advance_balance_gold_grams = round(greatest(0, coalesce(advance_balance_gold_grams, 0) - v_settle.excess_gold_grams)::numeric, 4)
   where id = v_settle.customer_id;

  -- If linked to a specific piece sale, restore sale's settled and remaining gold balance
  if v_settle.sale_id is not null then
    update public.jewelry_sales
       set settled_gold_grams   = round(greatest(0, settled_gold_grams - v_settle.applied_to_debt_grams)::numeric, 4),
           remaining_gold_grams = round((remaining_gold_grams + v_settle.applied_to_debt_grams)::numeric, 4),
           status               = case
             when round((remaining_gold_grams + v_settle.applied_to_debt_grams)::numeric, 4) >= (base_weight_grams - 0.0001) then 'unpaid'
             else 'partial'
           end,
           updated_at           = now()
     where id = v_settle.sale_id;
  end if;

  -- Mark settlement as reversed
  update public.gold_settlements
     set status          = 'reversed',
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = p_reason
   where id = p_settlement_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) values (
    v_caller_org, 'gold_settlements', v_settle.id::text, 'REVERSE_CLIENT_SETTLEMENT', auth.uid(),
    jsonb_build_object(
      'settlement_no', v_settle.settlement_no,
      'total_settled_grams', v_settle.total_settled_grams,
      'physical_scrap_grams', v_scrap_phys,
      'cash_paid_amount', v_cash_uzs,
      'usd_paid_amount', v_cash_usd
    ),
    jsonb_build_object('status', 'reversed'),
    p_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle.id,
    'settlement_no', v_settle.settlement_no,
    'restored_debt_grams', v_settle.applied_to_debt_grams,
    'deducted_advance_grams', v_settle.excess_gold_grams,
    'deducted_seller_scrap_g', v_scrap_phys,
    'deducted_seller_cash_uzs', v_cash_uzs,
    'deducted_seller_cash_usd', v_cash_usd,
    'reason', p_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_settlement', v_existing, v_payload);
  end if;

  return v_existing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_reverse_jewelry_sale(p_sale_id uuid, p_reversal_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_caller_emp_id uuid := public.current_employee_id();
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
    'accountant', 'buxgalter', 'sales', 'seller', 'sotuvchi'
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

  -- Cross-seller sale reversal authorization check
  IF v_caller_role IN ('seller', 'sotuvchi', 'sales') THEN
    IF v_sale.seller_id IS DISTINCT FROM v_caller_emp_id THEN
      RAISE EXCEPTION 'Ruxsat etilmadi: Sotuvchilar faqat o''zi amalga oshirgan savdoni bekor qila oladi' USING errcode = '42501';
    END IF;
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

  -- 3. If a physical piece or weight stock was sold, restore it
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
                          WHEN GREATEST(0, COALESCE(sold_quantity, 1) - 1) <= 0 THEN 'held_by_seller'
                          ELSE 'partially_sold'
                        END,
               updated_at = NOW()
         WHERE id = v_consign.id;
      END IF;
    END IF;
  ELSIF v_sale.consignment_id IS NOT NULL THEN
    -- Weight sale partial deduction: restore weight_grams back on active consignment_piece
    SELECT * INTO v_piece
      FROM public.consignment_pieces
     WHERE consignment_id = v_sale.consignment_id AND status = 'held_by_seller'
     ORDER BY updated_at DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.consignment_pieces
         SET weight_grams = ROUND((weight_grams + v_sale.base_weight_grams)::numeric, 4),
             updated_at = NOW()
       WHERE id = v_piece.id;
    ELSE
      -- All pieces in this consignment were marked sold/unassigned. Re-create / re-open an active held piece with restored weight!
      INSERT INTO public.consignment_pieces (
        organization_id, consignment_id, model_code, model_name, category,
        purity, weight_grams, status, seller_id, notes
      ) VALUES (
        v_caller_org, v_sale.consignment_id, COALESCE(v_sale.model_code, 'VAZN'), COALESCE(v_sale.product_name, 'Qaytarilgan VAZN'),
        COALESCE(v_sale.category, 'Buyum'), COALESCE(v_sale.purity, 585), v_sale.base_weight_grams,
        'held_by_seller', v_sale.seller_id, 'Restored from reversed sale ' || v_sale.sale_no
      );
    END IF;

    SELECT * INTO v_consign
      FROM public.seller_consignments
     WHERE id = v_sale.consignment_id
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.seller_consignments
         SET sold_quantity = GREATEST(0, COALESCE(sold_quantity, 1) - 1),
             status = CASE
                        WHEN GREATEST(0, COALESCE(sold_quantity, 1) - 1) <= 0 THEN 'held_by_seller'
                        ELSE 'partially_sold'
                      END,
             updated_at = NOW()
       WHERE id = v_consign.id;
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
$function$
;


-- RLS write policies dropped by 065
drop policy if exists consignment_pieces_manage_policy on public.consignment_pieces;
create policy consignment_pieces_manage_policy on public.consignment_pieces as PERMISSIVE for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'accountant'::text, 'buxgalter'::text, 'warehouse'::text, 'omborchi'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'accountant'::text, 'buxgalter'::text, 'warehouse'::text, 'omborchi'::text]))));
drop policy if exists daily_gold_rates_admin_manage on public.daily_gold_rates;
create policy daily_gold_rates_admin_manage on public.daily_gold_rates as PERMISSIVE for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text]))));
drop policy if exists factory_gold_handovers_modify_policy on public.factory_gold_handovers;
create policy factory_gold_handovers_modify_policy on public.factory_gold_handovers as PERMISSIVE for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))));
drop policy if exists factory_receipts_modify_policy on public.factory_receipts;
create policy factory_receipts_modify_policy on public.factory_receipts as PERMISSIVE for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))));
drop policy if exists gold_purchases_modify_policy on public.gold_purchases;
create policy gold_purchases_modify_policy on public.gold_purchases as PERMISSIVE for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))));
drop policy if exists manager_vault_account_modify_policy on public.manager_vault_account;
create policy manager_vault_account_modify_policy on public.manager_vault_account as PERMISSIVE for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))));
drop policy if exists refining_batches_modify_policy on public.refining_batches;
create policy refining_batches_modify_policy on public.refining_batches as PERMISSIVE for ALL to authenticated
  using (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))))
  with check (((organization_id = current_organization_id()) AND (current_employee_role_text() = ANY (ARRAY['admin'::text, 'director'::text, 'owner'::text, 'direktor'::text, 'rahbar'::text, 'production_manager'::text, 'manager'::text, 'boshqaruvchi'::text, 'accountant'::text, 'buxgalter'::text]))));

-- Grants revoked by 065 (Supabase defaults)
grant insert, update, delete on table
  public.manager_vault_account,
  public.consignment_pieces,
  public.seller_consignments,
  public.factory_receipts,
  public.factory_gold_handovers,
  public.refining_batches,
  public.gold_purchases,
  public.daily_gold_rates,
  public.jewelry_sales,
  public.gold_settlements,
  public.client_gold_accounts,
  public.seller_gold_accounts
to authenticated;
-- anon write access is deliberately NOT restored (064 only had anon INSERT/UPDATE on
-- daily_gold_rates). If the preflight ACL snapshot shows more, restore only what it shows.
-- rpc_set_daily_gold_rate: 064 granted EXECUTE to authenticated only (anon is deliberately not restored).
grant execute on function public.rpc_set_daily_gold_rate(numeric, numeric, date, text, text, text, numeric) to authenticated;
grant execute on function public.recalc_seller_gold_account(uuid, uuid) to public, authenticated, service_role;

-- Helpers introduced by 065 (unused after the restore above)
drop function if exists public._goldia_assert_seller_rate(text, numeric, numeric, boolean);
drop function if exists public._goldia_official_585_rate(uuid);
drop function if exists public._goldia_is_seller_role(text);

commit;
