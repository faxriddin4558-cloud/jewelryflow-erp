-- 090 - Goldia Sales (2026-11-19): one final package on top of 089. Nothing existing is rewritten in place; opening
-- documents (LOCK), 088 / 089 rules, payments, handovers and factory accounts keep every row.
--
-- 1. Consignment cancellation (rpc_reverse_barcode_consignment, unchanged since 039):
--    * a FIFO consignment can take goods from several factory receipts (e.g. an opening A receipt and a later one),
--      but only the first receipt was remembered: a cancellation put ALL grams back on that receipt (its available
--      grams could exceed what it ever had). Now every issue records consignment_receipt_allocations and a
--      cancellation / a returned piece goes back to exactly those receipts (newest first). A legacy consignment
--      without allocations is restored to its receipt only up to what that receipt gave out; anything more STOPS
--      (manual review) - nothing is guessed.
--    * the restored weight was base - returned although base is already net of returns: now the held pieces' grams.
--    * a cancellation marked the pieces "returned_to_manager" AND cancelled the consignment, so the period report and
--      the 089 stock movements took the grams off the seller TWICE (consignment_cancelled + return_to_manager). The
--      pieces are now "cancelled"; historic cancellations (same timestamp) are no longer counted twice.
--    * the seller's account is recalculated and the manager stock refreshed; an opening B consignment (LOCK), a 089
--      old-sale return lot (own reversal) and a consignment without factory receipt are refused.
-- 2. Manager -> factory goods return (factory_goods_returns, rpc_return_goods_to_factory / reverse): partial or full
--    grams of ONE factory receipt (opening A or later), valued at that receipt's own factory % (088 rule: grams x
--    (1 + A %)): manager stock - grams, factory net - value (booked as handed over, so an existing factory advance
--    grows correctly). Seller obligations, customer debts and profit are not touched. Pieces without a factory
--    receipt are not accepted (no approved rule). Idempotent, audited, reversible, in the period report.
-- 3. A seller cancelling his own sale: new sales remember who recorded them (jewelry_sales.recorded_by); a seller
--    may cancel only a sale that is his AND that he recorded, with a reason, while no payment / advance of that
--    customer came after it and its date is not inside a closed report period. Other cases go through the manager's
--    existing reversal. The existing reversal functions do the work (atomic, row locks, double-cancel refused).

-- ------------------------------------------------------------------ tables / columns
-- every factory receipt a consignment took goods from (grams), and how much of it went back (pieces / cancellation)
create table if not exists public.consignment_receipt_allocations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  consignment_id     uuid not null references public.seller_consignments(id) on delete cascade,
  factory_receipt_id uuid not null references public.factory_receipts(id),
  seq                integer not null,
  grams              numeric(14, 4) not null check (grams > 0),
  restored_grams     numeric(14, 4) not null default 0 check (restored_grams >= 0),
  created_at         timestamptz not null default now(),
  constraint consignment_receipt_allocations_restored check (restored_grams <= grams)
);
create index if not exists idx_consignment_receipt_allocations_con on public.consignment_receipt_allocations (consignment_id);
alter table public.consignment_receipt_allocations enable row level security;
drop policy if exists consignment_receipt_allocations_select_policy on public.consignment_receipt_allocations;
create policy consignment_receipt_allocations_select_policy on public.consignment_receipt_allocations for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text()) or public.current_employee_role_text() in ('accountant', 'buxgalter')));
revoke all on public.consignment_receipt_allocations from anon;
revoke insert, update, delete, truncate on public.consignment_receipt_allocations from authenticated;
grant select on public.consignment_receipt_allocations to authenticated;

-- finished goods back from the manager to the factory: a factory handover of its own source type (so the factory
-- cards, the period report and the opening audit count it exactly like every other handover) + its receipt link
alter table public.factory_gold_handovers drop constraint if exists factory_gold_handovers_source_type_check;
alter table public.factory_gold_handovers add constraint factory_gold_handovers_source_type_check
  check (source_type in ('capital_pure_gold', 'refined_gold', 'purchased_gold', 'scrap_gold', 'finished_goods_return'));
create table if not exists public.factory_goods_returns (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  handover_id         uuid not null unique references public.factory_gold_handovers(id),
  factory_receipt_id  uuid not null references public.factory_receipts(id),
  opening_document_id uuid references public.opening_documents(id),
  grams               numeric(14, 4) not null check (grams > 0),
  factory_markup_pct  numeric(6, 2) not null check (factory_markup_pct >= 0),
  factory_value_g     numeric(14, 4) not null check (factory_value_g > 0),
  reason              text not null check (length(btrim(reason)) > 0),
  idempotency_key     text not null unique,
  status              text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  created_by          uuid references public.employees(id),
  created_at          timestamptz not null default now(),
  reversed_at         timestamptz,
  reversed_by         uuid references public.employees(id),
  reversal_reason     text
);
create index if not exists idx_factory_goods_returns_receipt on public.factory_goods_returns (factory_receipt_id);
alter table public.factory_goods_returns enable row level security;
drop policy if exists factory_goods_returns_select_policy on public.factory_goods_returns;
create policy factory_goods_returns_select_policy on public.factory_goods_returns for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text()) or public.current_employee_role_text() in ('accountant', 'buxgalter')));
revoke all on public.factory_goods_returns from anon;
revoke insert, update, delete, truncate on public.factory_goods_returns from authenticated;
grant select on public.factory_goods_returns to authenticated;

-- who recorded a sale (new sales; the existing sale functions fill it through the default - the caller)
alter table public.jewelry_sales add column if not exists recorded_by uuid references public.employees(id) default public.current_employee_id();


-- 090: a sale EDIT = the original sale reversed + the corrected sale recorded, in ONE transaction; the pair is kept here
create table if not exists public.sale_edits (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  original_sale_id uuid not null unique references public.jewelry_sales(id),
  new_sale_id      uuid not null unique references public.jewelry_sales(id),
  edited_by        uuid references public.employees(id),
  edited_role      text,
  reason           text not null check (length(btrim(reason)) > 0),
  old_values       jsonb not null,
  new_values       jsonb not null,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now()
);
create index if not exists idx_sale_edits_new_sale on public.sale_edits (new_sale_id);
alter table public.sale_edits enable row level security;
drop policy if exists sale_edits_select_policy on public.sale_edits;
create policy sale_edits_select_policy on public.sale_edits for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or public.current_employee_role_text() in ('accountant', 'buxgalter')
              or exists (select 1 from public.jewelry_sales s where s.id = sale_edits.new_sale_id and s.seller_id = public.current_employee_id())));
revoke all on public.sale_edits from anon;
revoke insert, update, delete, truncate on public.sale_edits from authenticated;
grant select on public.sale_edits to authenticated;


-- ===== rpc_issue_barcode_consignment (from 20260101000064_goldia_audit_production_fixes.sql)
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
  v_alloc             jsonb := '[]'::jsonb; -- 090: grams taken from each factory receipt
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
    v_alloc := jsonb_build_array(jsonb_build_object('r', v_receipt_id, 'g', v_total_base_weight));
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
      IF v_take_g > 0 THEN v_alloc := v_alloc || jsonb_build_object('r', v_cur_receipt.id, 'g', v_take_g); END IF;

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
  INSERT INTO public.consignment_receipt_allocations (organization_id, consignment_id, factory_receipt_id, grams, seq)
  SELECT v_caller_org, v_consignment_id, (x.e ->> 'r')::uuid, (x.e ->> 'g')::numeric, x.n
    FROM jsonb_array_elements(v_alloc) WITH ORDINALITY AS x(e, n);

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

-- ===== rpc_return_piece_to_manager (from 20260101000064_goldia_audit_production_fixes.sql)
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
  -- 090: back to the receipt(s) the consignment really took the goods from (never above what a receipt gave out)
  IF v_consign.factory_receipt_id IS NOT NULL THEN
    PERFORM public._goldia_restore_consignment_receipts(v_consign.id, v_piece.weight_grams, false);
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

-- ===== _goldia_period_effects (from 20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql)
create or replace function public._goldia_period_effects(p_org uuid)
returns table (
  kind text, d date, seller_id uuid, cnt int,
  cust_g numeric, cur_uzs numeric, cur_usd numeric, stock_g numeric,
  till_uzs numeric, till_usd numeric, till_scrap_g numeric,
  mgr_uzs numeric, mgr_usd numeric, factory_g numeric,
  phys_g numeric, due_g numeric, amount numeric, extra numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with sales as (
    select s.*, coalesce(s.sale_currency, 'XAU585') as cur, rv.rev_at
      from public.jewelry_sales s
      -- 080: one grouped pass over the reversal audit rows (was a correlated subquery per sale)
      left join (select a.record_id, min(a.created_at) as rev_at
                   from public.audit_logs a
                  where a.table_name = 'jewelry_sales' and a.action in ('REVERSE_CLIENT_SALE', 'REVERSE_JEWELRY_SALE', 'REVERSE_SALE')
                  group by a.record_id) rv on rv.record_id = s.id::text
     where s.organization_id = p_org
  )
  -- sales (gram + %, UZS, USD): physical grams leave the seller stock; debt in 585 g or in the currency
  select case cur when 'XAU585' then 'sale_gram' when 'UZS' then 'sale_uzs' else 'sale_usd' end, sale_date, seller_id, 1,
         case when cur = 'XAU585' then client_gold_due_grams else 0 end,
         case when cur = 'UZS' then sale_amount else 0 end, case when cur = 'USD' then sale_amount else 0 end,
         -base_weight_grams, 0, 0, 0, 0, 0, 0,
         base_weight_grams, case when cur = 'XAU585' then client_gold_due_grams else 0 end, coalesce(sale_amount, 0), 0
    from sales
  union all
  select 'reversal_sale', public._goldia_business_date(coalesce(rev_at, updated_at)), seller_id, 1,
         case when cur = 'XAU585' then -client_gold_due_grams else 0 end,
         case when cur = 'UZS' then -sale_amount else 0 end, case when cur = 'USD' then -sale_amount else 0 end,
         base_weight_grams, 0, 0, 0, 0, 0, 0,
         base_weight_grams, case when cur = 'XAU585' then client_gold_due_grams else 0 end, coalesce(sale_amount, 0), 0
    from sales where status in ('reversed', 'cancelled')
  -- 083: customer returns: the returned grams come back to the seller, the debt in 585 g or in the sale's currency goes
  --      down by the returned value (debt part + new advance part); the original sale stays in its own period
  union all
  select case r.sale_currency when 'XAU585' then 'return_gram' when 'UZS' then 'return_uzs' else 'return_usd' end, r.return_date, r.seller_id, 1,
         case when r.sale_currency = 'XAU585' then -r.client_gold_due_returned_g else 0 end,
         case when r.sale_currency = 'UZS' then -r.sale_amount_returned else 0 end, case when r.sale_currency = 'USD' then -r.sale_amount_returned else 0 end,
         r.returned_weight_grams, 0, 0, 0, 0, 0, 0,
         r.returned_weight_grams, r.client_gold_due_returned_g, r.sale_amount_returned, r.advance_created
    from public.jewelry_sale_returns r where r.organization_id = p_org and r.status = 'confirmed'
  -- customer payments of 585 debts (cash / USD / scrap at the rate recorded on the payment)
  union all
  select 'payment_gram', g.settlement_date, g.seller_id, 1,
         -g.total_settled_grams, 0, 0, 0,
         coalesce(g.cash_paid_amount, 0), coalesce(g.usd_paid_amount, 0), coalesce(g.scrap_585_equiv_grams, 0), 0, 0, 0,
         coalesce(g.physical_scrap_grams, 0), g.total_settled_grams, 0, coalesce(g.excess_gold_grams, 0)
    from public.gold_settlements g where g.organization_id = p_org and g.direction = 'client_to_seller' and g.reversal_of_id is null
  union all
  select 'reversal_payment_gram', public._goldia_business_date(g.reversed_at), g.seller_id, 1,
         g.total_settled_grams, 0, 0, 0,
         -coalesce(g.cash_paid_amount, 0), -coalesce(g.usd_paid_amount, 0), -coalesce(g.scrap_585_equiv_grams, 0), 0, 0, 0,
         coalesce(g.physical_scrap_grams, 0), g.total_settled_grams, 0, 0
    from public.gold_settlements g where g.organization_id = p_org and g.direction = 'client_to_seller' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- legacy debts / advances / reconciliations (entered on the day they were recorded, not on the notebook date)
  union all
  select 'legacy_' || l.entry_type || '_' || l.balance_type, public._goldia_business_date(l.created_at), l.seller_id, 1,
         l.delta_585_g, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, l.delta_585_g, 0, 0
    from public.client_legacy_debts l where l.organization_id = p_org
  union all
  select 'reversal_legacy', public._goldia_business_date(l.reversed_at), l.seller_id, 1,
         -l.delta_585_g, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, l.delta_585_g, 0, 0
    from public.client_legacy_debts l where l.organization_id = p_org and l.status = 'reversed' and l.reversed_at is not null
  -- payments of UZS / USD debts
  union all
  select 'payment_' || lower(c.debt_currency), c.settlement_date, c.seller_id, 1,
         0, case when c.debt_currency = 'UZS' then -c.credited_amount else 0 end, case when c.debt_currency = 'USD' then -c.credited_amount else 0 end, 0,
         c.cash_uzs, c.usd_amount, c.scrap_585_g, 0, 0, 0,
         c.scrap_physical_g, c.scrap_585_g, c.credited_amount, c.to_advance
    from public.client_currency_settlements c where c.organization_id = p_org
  union all
  select 'reversal_payment_' || lower(c.debt_currency), public._goldia_business_date(c.reversed_at), c.seller_id, 1,
         0, case when c.debt_currency = 'UZS' then c.credited_amount else 0 end, case when c.debt_currency = 'USD' then c.credited_amount else 0 end, 0,
         -c.cash_uzs, -c.usd_amount, -c.scrap_585_g, 0, 0, 0,
         c.scrap_physical_g, c.scrap_585_g, c.credited_amount, 0
    from public.client_currency_settlements c where c.organization_id = p_org and c.status = 'reversed' and c.reversed_at is not null
  -- seller -> manager handovers (till -> manager vault)
  union all
  select 'handover', g.settlement_date, g.seller_id, 1,
         0, 0, 0, 0,
         -coalesce(g.cash_paid_amount, 0), -coalesce(g.usd_paid_amount, 0), -coalesce(g.scrap_585_equiv_grams, 0),
         coalesce(g.cash_paid_amount, 0), coalesce(g.usd_paid_amount, 0), 0,
         coalesce(g.physical_scrap_grams, 0), g.total_settled_grams, 0, 0
    from public.gold_settlements g where g.organization_id = p_org and g.direction = 'seller_to_manager' and g.reversal_of_id is null
  union all
  select 'reversal_handover', public._goldia_business_date(g.reversed_at), g.seller_id, 1,
         0, 0, 0, 0,
         coalesce(g.cash_paid_amount, 0), coalesce(g.usd_paid_amount, 0), coalesce(g.scrap_585_equiv_grams, 0),
         -coalesce(g.cash_paid_amount, 0), -coalesce(g.usd_paid_amount, 0), 0,
         coalesce(g.physical_scrap_grams, 0), g.total_settled_grams, 0, 0
    from public.gold_settlements g where g.organization_id = p_org and g.direction = 'seller_to_manager' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- distribution to sellers, returns, cancellations
  union all
  select 'consignment', public._goldia_business_date(coalesce(c.issued_at, c.created_at)), c.seller_id, 1,
         0, 0, 0, coalesce(c.original_base_weight_grams, c.base_weight_grams + coalesce(c.returned_weight_grams, 0)),
         0, 0, 0, 0, 0, 0,
         coalesce(c.original_base_weight_grams, c.base_weight_grams + coalesce(c.returned_weight_grams, 0)),
         coalesce(c.original_seller_obligation_g, c.seller_obligation_g, 0), 0, 0
    from public.seller_consignments c where c.organization_id = p_org
  union all
  select 'consignment_cancelled', public._goldia_business_date(c.cancelled_at), c.seller_id, 1,
         0, 0, 0, -c.base_weight_grams, 0, 0, 0, 0, 0, 0, c.base_weight_grams, 0, 0, 0
    from public.seller_consignments c where c.organization_id = p_org and c.status = 'cancelled' and c.cancelled_at is not null
  union all
  select 'return_to_manager', public._goldia_business_date(p.returned_to_manager_at), p.seller_id, 1,
         0, 0, 0, -p.weight_grams, 0, 0, 0, 0, 0, 0, p.weight_grams, 0, 0, 0
    from public.consignment_pieces p where p.organization_id = p_org and p.returned_to_manager_at is not null
     -- 090: pieces put back by a consignment CANCELLATION (same timestamp) are already in consignment_cancelled
     and not exists (select 1 from public.seller_consignments c where c.id = p.consignment_id and c.status = 'cancelled' and c.cancelled_at = p.returned_to_manager_at)
  -- 090: a manager -> factory goods return is booked as a factory_gold_handovers row (source finished_goods_return),
  -- so it is already in the factory_handover / reversal_factory_handover rows below (no extra row: no double count)
  -- factory
  union all
  select 'factory_receipt', r.receipt_date, null::uuid, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, r.factory_obligation_g,
         r.original_physical_g, r.factory_obligation_g, 0, coalesce(r.factory_markup_pct, 0)
    from public.factory_receipts r where r.organization_id = p_org
  union all
  select 'reversal_factory_receipt', public._goldia_business_date(r.reversed_at), null, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, -r.factory_obligation_g,
         r.original_physical_g, r.factory_obligation_g, 0, 0
    from public.factory_receipts r where r.organization_id = p_org and r.status in ('reversed', 'cancelled') and r.reversed_at is not null
  union all
  select 'factory_handover', h.handover_date, null, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, -h.agreed_equivalent_g,
         h.physical_weight_g, h.agreed_equivalent_g, 0, 0
    from public.factory_gold_handovers h where h.organization_id = p_org
  union all
  select 'reversal_factory_handover', public._goldia_business_date(h.reversed_at), null, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, h.agreed_equivalent_g,
         h.physical_weight_g, h.agreed_equivalent_g, 0, 0
    from public.factory_gold_handovers h where h.organization_id = p_org and h.status in ('reversed', 'cancelled') and h.reversed_at is not null
  -- capital / expenses (manager tills, seller tills); a reclassified operation: its original effect on its own date,
  -- then the move (minus original, plus new) on the reclassification date
  union all
  select 'fin_' || f.transaction_type || '_' || coalesce(f.reclassified_from_till, f.source_till), f.transaction_date, f.seller_id, 1,
         0, 0, 0, 0, o.till_uzs, o.till_usd, 0, o.mgr_uzs, o.mgr_usd, 0,
         coalesce(f.physical_weight_grams, 0), coalesce(f.equiv_585_grams, 0), coalesce(f.reclassified_from_amount, f.amount_num), 0
    from public.financial_transactions f
    cross join lateral public._goldia_fin_cash_effect(f.transaction_type, coalesce(f.reclassified_from_till, f.source_till), coalesce(f.reclassified_from_amount, f.amount_num)) o
   where f.organization_id = p_org
  union all
  select 'fin_reclassify', public._goldia_business_date(f.reclassified_at), f.seller_id, 1,
         0, 0, 0, 0, n.till_uzs - o.till_uzs, n.till_usd - o.till_usd, 0, n.mgr_uzs - o.mgr_uzs, n.mgr_usd - o.mgr_usd, 0,
         0, coalesce(f.equiv_585_grams, 0), f.amount_num, 0
    from public.financial_transactions f
    cross join lateral public._goldia_fin_cash_effect(f.transaction_type, f.reclassified_from_till, f.reclassified_from_amount) o
    cross join lateral public._goldia_fin_cash_effect(f.transaction_type, f.source_till, f.amount_num) n
   where f.organization_id = p_org and f.reclassified_at is not null
  union all
  select 'reversal_fin', public._goldia_business_date(f.reversed_at), f.seller_id, 1,
         0, 0, 0, 0, -n.till_uzs, -n.till_usd, 0, -n.mgr_uzs, -n.mgr_usd, 0, 0, 0, f.amount_num, 0
    from public.financial_transactions f
    cross join lateral public._goldia_fin_cash_effect(f.transaction_type, f.source_till, f.amount_num) n
   where f.organization_id = p_org and f.status = 'reversed' and f.reversed_at is not null
  -- cash gold purchases
  union all
  select 'purchase', p.purchase_date, null, 1, 0, 0, 0, 0, 0, 0, 0, -coalesce(p.cash_spent_uzs, 0), -coalesce(p.usd_spent, 0), 0,
         coalesce(p.gold_weight_grams, 0), coalesce(p.equiv_585_grams, 0), 0, 0
    from public.gold_purchases p where p.organization_id = p_org
  union all
  select 'reversal_purchase', public._goldia_business_date(p.reversed_at), null, 1, 0, 0, 0, 0, 0, 0, 0, coalesce(p.cash_spent_uzs, 0), coalesce(p.usd_spent, 0), 0,
         coalesce(p.gold_weight_grams, 0), coalesce(p.equiv_585_grams, 0), 0, 0
    from public.gold_purchases p where p.organization_id = p_org and p.status in ('reversed', 'cancelled') and p.reversed_at is not null
  -- 089: old-sale returns: the customer's 585 / UZS / USD balance goes down by the value (debt + advance part); the goods
  --      come in through the return lot (a consignment row above) and, for the manager, its return_to_manager row
  union all
  select 'opening_return_' || lower(r.unit), r.return_date, r.seller_id, 1,
         case when r.unit = 'G585' then -r.credit_amount else 0 end,
         case when r.unit = 'UZS' then -r.credit_amount else 0 end, case when r.unit = 'USD' then -r.credit_amount else 0 end,
         0, 0, 0, 0, 0, 0, 0,
         r.returned_weight_grams, case when r.unit = 'G585' then r.credit_amount else 0 end, r.credit_amount, r.advance_created
    from public.opening_sale_returns r where r.organization_id = p_org
  union all
  select 'reversal_opening_return_' || lower(r.unit), public._goldia_business_date(r.reversed_at), r.seller_id, 1,
         case when r.unit = 'G585' then r.credit_amount else 0 end,
         case when r.unit = 'UZS' then r.credit_amount else 0 end, case when r.unit = 'USD' then r.credit_amount else 0 end,
         0, 0, 0, 0, 0, 0, 0,
         r.returned_weight_grams, case when r.unit = 'G585' then r.credit_amount else 0 end, r.credit_amount, 0
    from public.opening_sale_returns r where r.organization_id = p_org and r.status = 'reversed' and r.reversed_at is not null
  -- 085: opening documents that have no row of their own (customer UZS / USD, manager cash, factory without goods);
  -- the other opening kinds are a factory receipt, a consignment or a legacy row and appear through those
  union all
  select 'opening_' || o.kind || coalesce('_' || lower(o.unit), '') || coalesce('_' || o.side, ''),
         public._goldia_business_date(o.effective_t0), o.seller_id, 1, 0,
         case when o.kind = 'customer_currency' and o.unit = 'UZS' then (case o.side when 'debt' then o.amount else -o.amount end) else 0 end,
         case when o.kind = 'customer_currency' and o.unit = 'USD' then (case o.side when 'debt' then o.amount else -o.amount end) else 0 end,
         0, 0, 0, 0,
         case when o.kind = 'manager_cash' and o.unit = 'UZS' then o.amount else 0 end,
         case when o.kind = 'manager_cash' and o.unit = 'USD' then o.amount else 0 end,
         case o.kind when 'factory_obligation' then o.amount when 'factory_advance' then -o.amount when 'factory_settled' then -o.amount else 0 end,
         coalesce(o.physical_g, 0), coalesce(o.equiv_585_g, 0), o.amount, 0
    from public.opening_documents o
   where o.organization_id = p_org and o.kind in ('customer_currency', 'manager_cash', 'factory_obligation', 'factory_advance', 'factory_settled')
  union all
  select 'reversal_opening_' || o.kind || coalesce('_' || lower(o.unit), '') || coalesce('_' || o.side, ''),
         public._goldia_business_date(o.cancelled_at), o.seller_id, 1, 0,
         case when o.kind = 'customer_currency' and o.unit = 'UZS' then (case o.side when 'debt' then -o.amount else o.amount end) else 0 end,
         case when o.kind = 'customer_currency' and o.unit = 'USD' then (case o.side when 'debt' then -o.amount else o.amount end) else 0 end,
         0, 0, 0, 0,
         case when o.kind = 'manager_cash' and o.unit = 'UZS' then -o.amount else 0 end,
         case when o.kind = 'manager_cash' and o.unit = 'USD' then -o.amount else 0 end,
         case o.kind when 'factory_obligation' then -o.amount when 'factory_advance' then o.amount when 'factory_settled' then o.amount else 0 end,
         coalesce(o.physical_g, 0), coalesce(o.equiv_585_g, 0), o.amount, 0
    from public.opening_documents o
   where o.organization_id = p_org and o.kind in ('customer_currency', 'manager_cash', 'factory_obligation', 'factory_advance', 'factory_settled')
     and o.status = 'cancelled' and o.cancelled_at is not null
$$;

-- ===== rpc_get_seller_stock_movements (from 20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql)
create or replace function public.rpc_get_seller_stock_movements(p_seller_id uuid default null, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare
  v_org    uuid := public.current_organization_id();
  v_role   text := public.current_employee_role_text();
  v_seller uuid := p_seller_id;
  v_from   date := coalesce(p_from, date '2000-01-01');
  v_to     date := coalesce(p_to, public._goldia_business_date());
  v_res    jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi']);
  if public._goldia_is_seller_role(v_role) then
    if p_seller_id is not null and p_seller_id is distinct from public.current_employee_id() then
      raise exception 'Ruxsat etilmadi: sotuvchi faqat o''z ombor harakatini ko''radi' using errcode = '42501';
    end if;
    v_seller := public.current_employee_id();
  end if;
  if v_from > v_to then raise exception 'Sana oralig''i noto''g''ri'; end if;
  with mv as (
    -- goods in: opening seller inventory (B), consignments, old-sale return lots
    select c.seller_id, public._goldia_business_date(coalesce(c.issued_at, c.created_at)) d, coalesce(c.issued_at, c.created_at) ts,
           case when od.id is not null then 'opening_inventory' when osr.id is not null then 'old_sale_return' else 'consignment' end kind,
           coalesce(od.document_no, osr.return_no, c.consignment_no) doc_no,
           coalesce(c.original_base_weight_grams, c.base_weight_grams + coalesce(c.returned_weight_grams, 0)) g, c.id ref_id
      from public.seller_consignments c
      left join public.opening_documents od on od.consignment_id = c.id and od.kind = 'seller_inventory'
      left join public.opening_sale_returns osr on osr.consignment_id = c.id
     where c.organization_id = v_org
    union all
    select c.seller_id, public._goldia_business_date(c.cancelled_at), c.cancelled_at, 'consignment_cancelled', c.consignment_no, -c.base_weight_grams, c.id
      from public.seller_consignments c where c.organization_id = v_org and c.status = 'cancelled' and c.cancelled_at is not null
       and c.base_weight_grams > 0
    union all
    select p.seller_id, public._goldia_business_date(p.returned_to_manager_at), p.returned_to_manager_at, 'return_to_manager',
           coalesce(p.raw_barcode, p.model_code), -p.weight_grams, p.id
      from public.consignment_pieces p where p.organization_id = v_org and p.returned_to_manager_at is not null
       -- 090: pieces put back by a consignment cancellation are already in consignment_cancelled
       and not exists (select 1 from public.seller_consignments c where c.id = p.consignment_id and c.status = 'cancelled' and c.cancelled_at = p.returned_to_manager_at)
    union all
    select s.seller_id, s.sale_date, s.created_at, 'sale', s.sale_no, -s.base_weight_grams, s.id
      from public.jewelry_sales s where s.organization_id = v_org
    union all
    select s.seller_id, public._goldia_business_date(s.updated_at), s.updated_at, 'sale_reversed', s.sale_no, s.base_weight_grams, s.id
      from public.jewelry_sales s where s.organization_id = v_org and s.status in ('reversed', 'cancelled')
    union all
    select r.seller_id, r.return_date, r.created_at, 'customer_return', r.return_no, r.returned_weight_grams, r.id
      from public.jewelry_sale_returns r where r.organization_id = v_org and r.status = 'confirmed'
  ), f as (
    select * from mv where seller_id is not null and (v_seller is null or seller_id = v_seller)
  ), per as (
    select e.id seller_id, coalesce(e.full_name, e.name) seller_name,
           coalesce((select sum(g) from f where f.seller_id = e.id and f.d < v_from), 0) opening_g,
           coalesce((select sum(g) from f where f.seller_id = e.id and f.d between v_from and v_to and g > 0), 0) in_g,
           coalesce((select sum(g) from f where f.seller_id = e.id and f.d between v_from and v_to and g < 0), 0) out_g,
           coalesce((select sum(g) from f where f.seller_id = e.id), 0) all_time_g,
           (select a.current_physical_stock_g from public.seller_gold_accounts a where a.seller_id = e.id) stored_g,
           coalesce((select sum(p.weight_grams) from public.consignment_pieces p join public.seller_consignments c on c.id = p.consignment_id
                      where p.seller_id = e.id and p.status = 'held_by_seller' and c.status in ('held_by_seller', 'partially_sold', 'fully_sold')), 0) held_g
      from public.employees e
     where e.organization_id = v_org and (v_seller is null or e.id = v_seller)
       and (exists (select 1 from f where f.seller_id = e.id) or exists (select 1 from public.seller_gold_accounts a where a.seller_id = e.id))
  ), dup as (
    -- the same document kind, seller and grams twice within 10 minutes (shown, never corrected)
    select a.seller_id, a.kind, a.g, a.doc_no a_no, b.doc_no b_no, a.ts
      from f a join f b on b.seller_id = a.seller_id and b.kind = a.kind and b.g = a.g and b.ref_id > a.ref_id
                       and abs(extract(epoch from (b.ts - a.ts))) <= 600
     where a.kind in ('consignment', 'old_sale_return', 'customer_return', 'sale') and a.d between v_from and v_to
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('seller_id', seller_id, 'seller_name', seller_name, 'opening_g', round(opening_g, 4),
        'in_g', round(in_g, 4), 'out_g', round(out_g, 4), 'closing_g', round(opening_g + in_g + out_g, 4),
        'all_time_g', round(all_time_g, 4), 'stored_stock_g', stored_g, 'held_pieces_g', round(held_g, 4),
        'difference_to_stored_g', round(greatest(all_time_g, 0) - coalesce(stored_g, 0), 4),
        'difference_to_pieces_g', round(greatest(all_time_g, 0) - held_g, 4),
        'ok', abs(greatest(all_time_g, 0) - coalesce(stored_g, 0)) < 0.0005) order by seller_name) from per), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('seller_id', seller_id, 'date', d, 'at', ts, 'kind', kind, 'document', doc_no,
        'grams', round(g, 4)) order by d, ts, kind) from f where d between v_from and v_to), '[]'::jsonb),
    'duplicates', coalesce((select jsonb_agg(jsonb_build_object('seller_id', seller_id, 'kind', kind, 'grams', g, 'first', a_no, 'second', b_no, 'at', ts)) from dup), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $f$;


-- ------------------------------------------------------------------ 1. consignment -> factory receipts restore
-- Puts p_grams back on the receipts the consignment took them from (allocations, newest first). A legacy consignment
-- (before 090, no allocations) goes back only to its remembered receipt and never above what that receipt gave out;
-- anything more is refused (the other receipts are unknown - nothing is guessed).
create or replace function public._goldia_restore_consignment_receipts(p_con uuid, p_grams numeric, p_adjust_transferred boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_rem  numeric(14, 4) := round(coalesce(p_grams, 0)::numeric, 4);
  v_take numeric(14, 4);
  v_cap  numeric(14, 4);
  a      record;
  c      public.seller_consignments%rowtype;
  r      public.factory_receipts%rowtype;
begin
  if v_rem <= 0 then return; end if;
  select * into c from public.seller_consignments where id = p_con;
  if exists (select 1 from public.consignment_receipt_allocations where consignment_id = p_con) then
    for a in select * from public.consignment_receipt_allocations where consignment_id = p_con order by seq desc for update loop
      v_take := least(v_rem, a.grams - a.restored_grams);
      continue when v_take <= 0;
      update public.consignment_receipt_allocations set restored_grams = round(restored_grams + v_take, 4) where id = a.id;
      update public.factory_receipts
         set available_physical_g = round(available_physical_g + v_take, 4),
             transferred_physical_g = case when p_adjust_transferred then round(greatest(0, transferred_physical_g - v_take), 4) else transferred_physical_g end,
             status = case when round(available_physical_g + v_take, 4) >= original_physical_g then 'in_manager_stock' else 'partially_transferred' end,
             updated_at = now()
       where id = a.factory_receipt_id;
      v_rem := round(v_rem - v_take, 4);
      exit when v_rem <= 0;
    end loop;
    if v_rem > 0.00005 then
      raise exception 'ERR_CONSIGNMENT_RESTORE_EXCEEDS: konsignatsiya kirimlardan olganidan % g ko''p qaytarilmoqda', v_rem using errcode = '22023';
    end if;
  else
    select * into r from public.factory_receipts where id = c.factory_receipt_id for update;
    if r.id is null then raise exception 'ERR_CONSIGNMENT_NO_RECEIPT: konsignatsiyaning zavod kirimi topilmadi' using errcode = '22023'; end if;
    -- room on this receipt for THIS consignment: what the receipt gave out, minus goods returned to the factory, minus
    -- what OTHER active consignments still hold from it, minus what this one keeps after the restore
    v_cap := greatest(0, r.original_physical_g - r.available_physical_g
             - coalesce((select sum(x.grams) from public.factory_goods_returns x where x.factory_receipt_id = r.id and x.status = 'confirmed'), 0)
             - coalesce((select sum(case when exists (select 1 from public.consignment_receipt_allocations a2 where a2.consignment_id = o.id)
                                         then (select coalesce(sum(a2.grams - a2.restored_grams), 0) from public.consignment_receipt_allocations a2 where a2.consignment_id = o.id and a2.factory_receipt_id = r.id)
                                         else (case when o.factory_receipt_id = r.id then o.base_weight_grams else 0 end) end)
                           from public.seller_consignments o
                          where o.organization_id = c.organization_id and o.id <> c.id and o.status in ('held_by_seller', 'partially_sold', 'fully_sold')), 0)
             - case when p_adjust_transferred then 0 else c.base_weight_grams end);
    if v_rem > v_cap + 0.00005 then
      raise exception 'ERR_CONSIGNMENT_RECEIPT_UNKNOWN: eski (090 dan oldingi) konsignatsiya: % g, lekin % kirimi bergan qolgani % g - qolgan qismi qaysi kirimdan olingani noma''lum, qo''lda tekshirish kerak (hech narsa o''zgarmadi)',
        v_rem, r.receipt_no, v_cap using errcode = '22023';
    end if;
    update public.factory_receipts
       set available_physical_g = round(available_physical_g + v_rem, 4),
           transferred_physical_g = case when p_adjust_transferred then round(greatest(0, transferred_physical_g - v_rem), 4) else transferred_physical_g end,
           status = case when round(available_physical_g + v_rem, 4) >= original_physical_g then 'in_manager_stock' else 'partially_transferred' end,
           updated_at = now()
     where id = r.id;
  end if;
end $f$;
revoke all on function public._goldia_restore_consignment_receipts(uuid, numeric, boolean) from public, anon, authenticated;

create or replace function public.rpc_reverse_barcode_consignment(p_consignment_id uuid, p_reason text default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_emp      uuid := public.current_employee_id();
  v_reason   text := nullif(btrim(p_reason), '');
  c          public.seller_consignments%rowtype;
  v_w        numeric(14, 4);
  v_n        integer;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_reason is null then raise exception 'Konsignatsiyani bekor qilish sababi kiritilishi shart'; end if;
  v_payload := jsonb_build_object('action', 'reverse_barcode_consignment', 'consignment_id', p_consignment_id);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_barcode_consignment', v_payload);
  if v_existing is not null then return v_existing; end if;
  select * into c from public.seller_consignments where id = p_consignment_id and organization_id = v_org for update;
  if c.id is null then raise exception 'Konsignatsiya topilmadi (%)', p_consignment_id; end if;
  if c.status = 'cancelled' then raise exception 'Ushbu konsignatsiya allaqachon bekor qilingan (%)', c.consignment_no; end if;
  if exists (select 1 from public.opening_documents d where d.consignment_id = c.id and d.status = 'active') then
    raise exception 'ERR_OPENING_CONSIGNMENT: bu boshlang''ich (B) konsignatsiya - boshlang''ich hisob qulflangan, oddiy bekor qilinmaydi' using errcode = '55000';
  end if;
  if exists (select 1 from public.opening_sale_returns x where x.consignment_id = c.id) then
    raise exception 'ERR_RETURN_LOT: bu eski savdo vozvrati loti - uni vozvratni bekor qilish orqali bekor qiling' using errcode = '55000';
  end if;
  if c.factory_receipt_id is null then
    raise exception 'ERR_CONSIGNMENT_NO_RECEIPT: zavod kirimisiz konsignatsiya - tovar menejer omboriga qaytadigan kirim yo''q' using errcode = '55000';
  end if;
  select count(*) into v_n from public.consignment_pieces where consignment_id = c.id and status in ('sold', 'returned_to_factory');
  if v_n > 0 then
    raise exception 'Konsignatsiyani bekor qilib bo''lmaydi: % ta mahsulot allaqachon sotilgan yoki zavodga qaytarilgan. Avval savdolarni bekor qiling.', v_n;
  end if;
  -- 090: the grams still on the seller (base is already net of earlier returns): the held pieces
  select coalesce(sum(weight_grams), 0) into v_w from public.consignment_pieces where consignment_id = c.id and status = 'held_by_seller';
  v_w := round(v_w, 4);
  perform public._goldia_restore_consignment_receipts(c.id, v_w, true);
  -- the pieces are CANCELLED (not "returned to manager": the consignment_cancelled line already takes them off the seller)
  update public.consignment_pieces
     set status = 'cancelled', notes = coalesce(notes, '') || ' | KONSIGNATSIYA BEKOR QILINDI: ' || v_reason, updated_at = now()
   where consignment_id = c.id and status = 'held_by_seller';
  update public.seller_consignments
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_emp, cancellation_reason = v_reason, updated_at = now()
   where id = c.id;
  perform public.recalc_seller_gold_account(c.seller_id, v_org);
  perform public._get_or_create_manager_vault(v_org);
  update public.manager_vault_account set manager_physical_stock_g = public.get_manager_available_stock_grams(v_org), updated_at = now() where organization_id = v_org;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'seller_consignments', c.id::text, 'CANCEL_CONSIGNMENT', auth.uid(),
    jsonb_build_object('consignment_no', c.consignment_no, 'seller_id', c.seller_id, 'base_weight_g', c.base_weight_grams, 'pieces_count', c.quantity),
    jsonb_build_object('status', 'cancelled', 'restored_physical_g', v_w,
      'receipts', (select jsonb_agg(jsonb_build_object('receipt_id', a.factory_receipt_id, 'grams', a.grams, 'restored', a.restored_grams)) from public.consignment_receipt_allocations a where a.consignment_id = c.id)),
    v_reason);
  v_res := jsonb_build_object('status', 'ok', 'consignment_id', c.id, 'consignment_no', c.consignment_no, 'restored_weight_grams', v_w, 'reason', v_reason);
  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_barcode_consignment', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_reverse_barcode_consignment(uuid, text, text) from public, anon;
grant execute on function public.rpc_reverse_barcode_consignment(uuid, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ 2. manager -> factory goods return
-- grams of ONE receipt still in the manager's stock go back to the factory, valued at that receipt's own factory %
-- (an opening A receipt: the A document's %, the 088 rule grams x (1 + A %)). Booked as a factory handover of source
-- 'finished_goods_return' (the factory net goes down by the value; with an advance the advance grows). Goods of an
-- opening receipt that were settled with the factory before T0 (factory_settled) are refused (no approved rule).
create or replace function public.rpc_return_goods_to_factory(p_receipt_id uuid, p_grams numeric, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_emp      uuid := public.current_employee_id();
  v_key      text := nullif(btrim(p_idempotency_key), '');
  v_reason   text := nullif(btrim(p_reason), '');
  v_g        numeric(14, 4) := round(coalesce(p_grams, 0)::numeric, 4);
  r          public.factory_receipts%rowtype;
  d          public.opening_documents%rowtype;
  v_pct      numeric(6, 2);
  v_value    numeric(14, 4);
  v_settled  numeric(14, 4) := 0;
  v_new_av   numeric(14, 4);
  v_hid      uuid;
  v_id       uuid;
  v_no       text;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_key is null then raise exception 'Takrorlanmas so''rov kaliti (idempotency key) majburiy'; end if;
  if v_reason is null then raise exception 'Qaytarish sababi kiritilishi shart'; end if;
  if v_g <= 0 then raise exception 'Qaytariladigan vazn 0 dan katta bo''lishi shart' using errcode = '22023'; end if;
  v_payload := jsonb_build_object('action', 'return_goods_to_factory', 'receipt_id', p_receipt_id, 'grams', v_g);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_return_goods_to_factory', v_payload);
  if v_existing is not null then return v_existing; end if;
  select * into r from public.factory_receipts where id = p_receipt_id and organization_id = v_org for update;
  if r.id is null or r.status in ('reversed', 'cancelled') then raise exception 'Zavod kirimi topilmadi yoki bekor qilingan'; end if;
  if v_g > r.available_physical_g + 0.00005 then
    raise exception 'ERR_NOT_IN_STOCK: kirimda menejer omborida % g bor, % g so''raldi', r.available_physical_g, v_g using errcode = '22023';
  end if;
  select * into d from public.opening_documents where id = r.opening_document_id;
  if d.id is not null and d.kind = 'seller_inventory' then
    raise exception 'ERR_SETTLED_GOODS: bu sotuvchining boshlang''ich (B) kirimi - qaytarish qoidasi tasdiqlanmagan' using errcode = '55000';
  end if;
  if d.id is not null and d.kind = 'manager_inventory' then
    if d.factory_markup_pct is distinct from r.factory_markup_pct then
      raise exception 'ERR_PCT_MISMATCH: A hujjati foizi (%) kirim foizidan (%) farq qiladi - qo''lda tekshirish kerak', d.factory_markup_pct, r.factory_markup_pct using errcode = '55000';
    end if;
    -- goods of B documents taken from this A and settled with the factory before T0 that came back to the manager
    -- carry no factory obligation any more: they are not returnable here
    select coalesce(sum(c.returned_weight_grams), 0) into v_settled
      from public.opening_documents b join public.seller_consignments c on c.id = b.consignment_id
     where b.source_document_id = d.id and b.kind = 'seller_inventory' and b.status = 'active'
       and exists (select 1 from public.opening_documents fs where fs.source_document_id = b.id and fs.kind = 'factory_settled' and fs.status = 'active');
    if v_g > r.available_physical_g - v_settled + 0.00005 then
      raise exception 'ERR_SETTLED_GOODS: % kirimidagi % g zavod bilan T0 dan oldin hisob-kitob qilingan (factory_settled) tovar - qaytarish mumkin: % g', r.receipt_no, v_settled, greatest(0, r.available_physical_g - v_settled) using errcode = '55000';
    end if;
  end if;
  v_pct := r.factory_markup_pct;
  v_value := round(v_g * (1 + v_pct / 100.0), 4);
  v_new_av := round(r.available_physical_g - v_g, 4);
  update public.factory_receipts
     set available_physical_g = v_new_av,
         status = case when v_new_av <= 0.00005 then (case when transferred_physical_g > 0 then 'fully_transferred' else 'returned_to_factory' end)
                       else (case when transferred_physical_g > 0 then 'partially_transferred' else 'in_manager_stock' end) end,
         updated_at = now()
   where id = r.id;
  v_no := 'FGR-' || to_char(public._goldia_business_date(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
  insert into public.factory_gold_handovers (organization_id, handover_no, source_type, physical_weight_g, proba, agreed_equivalent_g,
    factory_recipient, handover_date, notes, idempotency_key, recorded_by)
  values (v_org, v_no, 'finished_goods_return', v_g, 585, v_value, 'Zavod', public._goldia_business_date(),
    'TAYYOR MAHSULOT ZAVODGA QAYTARILDI: ' || r.receipt_no || ' ' || v_g || ' g x (1 + ' || v_pct || ' %) = ' || v_value || ' g. ' || v_reason, v_key || ':hnd', v_emp)
  returning id into v_hid;
  insert into public.factory_goods_returns (organization_id, handover_id, factory_receipt_id, opening_document_id, grams, factory_markup_pct,
    factory_value_g, reason, idempotency_key, created_by)
  values (v_org, v_hid, r.id, case when d.kind = 'manager_inventory' then d.id end, v_g, v_pct, v_value, v_reason, v_key, v_emp)
  returning id into v_id;
  -- the factory net goes down by the value (delta: the opening C / C2 / factory_settled parts are kept)
  perform public._goldia_vault_factory_add(v_org, 0, v_value);
  update public.manager_vault_account set manager_physical_stock_g = public.get_manager_available_stock_grams(v_org), updated_at = now() where organization_id = v_org;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, new_data, reason)
  values (v_org, 'factory_goods_returns', v_id::text, 'RETURN_GOODS_TO_FACTORY', auth.uid(),
    jsonb_build_object('receipt_no', r.receipt_no, 'grams', v_g, 'factory_markup_pct', v_pct, 'factory_value_g', v_value, 'handover_no', v_no,
                       'opening_document', d.document_no, 'available_after_g', v_new_av), v_reason);
  v_res := jsonb_build_object('status', 'ok', 'return_id', v_id, 'handover_id', v_hid, 'handover_no', v_no, 'receipt_no', r.receipt_no,
    'grams', v_g, 'factory_markup_pct', v_pct, 'factory_value_g', v_value, 'available_after_g', v_new_av,
    'factory_net_after_g', (select current_factory_obligation_g - current_factory_advance_g from public.manager_vault_account where organization_id = v_org));
  perform public.save_idempotency_response(v_key, 'rpc_return_goods_to_factory', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_return_goods_to_factory(uuid, numeric, text, text) from public, anon;
grant execute on function public.rpc_return_goods_to_factory(uuid, numeric, text, text) to authenticated, service_role;

create or replace function public.rpc_reverse_factory_goods_return(p_return_id uuid, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_key      text := nullif(btrim(p_idempotency_key), '');
  v_reason   text := nullif(btrim(p_reason), '');
  x          public.factory_goods_returns%rowtype;
  r          public.factory_receipts%rowtype;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_key is null then raise exception 'Takrorlanmas so''rov kaliti (idempotency key) majburiy'; end if;
  if v_reason is null then raise exception 'Bekor qilish sababi kiritilishi shart'; end if;
  v_payload := jsonb_build_object('action', 'reverse_factory_goods_return', 'return_id', p_return_id);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_reverse_factory_goods_return', v_payload);
  if v_existing is not null then return v_existing; end if;
  select * into x from public.factory_goods_returns where id = p_return_id and organization_id = v_org for update;
  if x.id is null then raise exception 'Zavodga qaytarish hujjati topilmadi'; end if;
  if x.status <> 'confirmed' then raise exception 'Bu qaytarish allaqachon bekor qilingan'; end if;
  select * into r from public.factory_receipts where id = x.factory_receipt_id for update;
  if r.available_physical_g + x.grams > r.original_physical_g + 0.00005 then
    raise exception 'ERR_RECEIPT_OVERFLOW: kirimga % g qaytarilsa asl vazndan oshadi' , x.grams using errcode = '55000';
  end if;
  update public.factory_receipts
     set available_physical_g = round(available_physical_g + x.grams, 4),
         status = case when round(available_physical_g + x.grams, 4) >= original_physical_g then 'in_manager_stock' else 'partially_transferred' end,
         updated_at = now()
   where id = r.id;
  perform set_config('goldia.fgr_reverse', txid_current()::text, true);
  update public.factory_gold_handovers set status = 'reversed', reversed_at = clock_timestamp() where id = x.handover_id;
  update public.factory_goods_returns set status = 'reversed', reversed_at = clock_timestamp(), reversed_by = public.current_employee_id(), reversal_reason = v_reason where id = x.id;
  perform public._goldia_vault_factory_add(v_org, 0, -x.factory_value_g);
  update public.manager_vault_account set manager_physical_stock_g = public.get_manager_available_stock_grams(v_org), updated_at = now() where organization_id = v_org;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'factory_goods_returns', x.id::text, 'REVERSE_GOODS_TO_FACTORY', auth.uid(),
    jsonb_build_object('status', 'confirmed', 'grams', x.grams, 'factory_value_g', x.factory_value_g), jsonb_build_object('status', 'reversed'), v_reason);
  v_res := jsonb_build_object('status', 'ok', 'return_id', x.id, 'grams', x.grams, 'factory_value_g', x.factory_value_g);
  perform public.save_idempotency_response(v_key, 'rpc_reverse_factory_goods_return', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_reverse_factory_goods_return(uuid, text, text) from public, anon;
grant execute on function public.rpc_reverse_factory_goods_return(uuid, text, text) to authenticated, service_role;

-- a finished-goods handover is reversed only by its own function (the generic gold-handover reversal would put metal
-- back into the manager's scrap / refined stock)
create or replace function public._goldia_guard_finished_goods_handover()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  if old.source_type = 'finished_goods_return' and new.status is distinct from old.status
     and current_setting('goldia.fgr_reverse', true) is distinct from txid_current()::text then
    raise exception 'ERR_FINISHED_GOODS_HANDOVER: tayyor mahsulot qaytarishini "Zavodga qaytarishni bekor qilish" orqali bekor qiling' using errcode = '55000';
  end if;
  return new;
end $f$;
revoke all on function public._goldia_guard_finished_goods_handover() from public, anon, authenticated;
drop trigger if exists trg_goldia_guard_finished_goods_handover on public.factory_gold_handovers;
create trigger trg_goldia_guard_finished_goods_handover before update on public.factory_gold_handovers
  for each row execute function public._goldia_guard_finished_goods_handover();

-- ------------------------------------------------------------------ 3. a seller cancelling his own sale
-- Every sale reversal path (rpc_reverse_client_sale, rpc_reverse_jewelry_sale, piece-sale reversal) sets the sale's
-- status; when the CALLER is a seller this guard adds the seller rules. The reversal functions keep doing the work
-- (customer debt, pieces, seller account, stock) in one transaction - a refusal here rolls all of it back.
create or replace function public._goldia_guard_seller_sale_cancel()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_emp uuid; v_role text;
begin
  if not (new.status in ('reversed', 'cancelled') and old.status not in ('reversed', 'cancelled')) or auth.uid() is null then return new; end if;
  v_role := public.current_employee_role_text();
  if not public._goldia_is_seller_role(v_role) then return new; end if;
  v_emp := public.current_employee_id();
  if old.seller_id is distinct from v_emp then
    raise exception 'ERR_NOT_OWN_SALE: sotuvchi faqat o''z savdosini bekor qila oladi' using errcode = '42501';
  end if;
  if old.recorded_by is not null and old.recorded_by is distinct from v_emp then
    raise exception 'ERR_NOT_RECORDED_BY_SELLER: bu savdoni boshqa xodim kiritgan - menejer bekor qiladi' using errcode = '42501';
  end if;
  if coalesce(old.settled_gold_grams, 0) > 0
     or exists (select 1 from public.gold_settlements g where g.customer_id = old.customer_id and g.direction = 'client_to_seller'
                 and g.reversal_of_id is null and coalesce(g.status, 'confirmed') not in ('reversed', 'cancelled') and g.created_at >= old.created_at)
     or exists (select 1 from public.client_currency_settlements c where c.customer_id = old.customer_id and c.status <> 'reversed' and c.created_at >= old.created_at) then
    raise exception 'ERR_SALE_HAS_PAYMENTS: savdodan keyin mijoz to''lov (pul / LOM / avans) qilgan - bekor qilishni menejer bajaradi' using errcode = '55000';
  end if;
  if exists (select 1 from public.goldia_report_periods p where p.organization_id = old.organization_id and old.sale_date between p.period_start and p.period_end) then
    raise exception 'ERR_PERIOD_CLOSED: savdo sanasi yopilgan hisobot davrida - bekor qilishni menejer bajaradi' using errcode = '55000';
  end if;
  return new;
end $f$;
revoke all on function public._goldia_guard_seller_sale_cancel() from public, anon, authenticated;
drop trigger if exists trg_goldia_guard_seller_sale_cancel on public.jewelry_sales;
create trigger trg_goldia_guard_seller_sale_cancel before update of status on public.jewelry_sales
  for each row execute function public._goldia_guard_seller_sale_cancel();


-- ------------------------------------------------------------------ 4. sale EDIT (seller: own sale only; management: any sale of the org)
-- Built only from the existing, tested operations, in ONE transaction:
--   rpc_reverse_client_sale (customer debt / advance, pieces or weight allocations, seller account, currency debt)
--   + rpc_record_weight_sale / rpc_record_barcode_piece_sale / rpc_record_currency_sale with the corrected values.
-- The original stays in the history as 'reversed', the corrected sale is a new document; sale_edits + audit_logs keep
-- who / when / why / old / new. Any failure (not enough stock, wrong piece, ...) rolls the whole edit back.
-- For a SELLER the 090 guard of the reversal applies: own sale, recorded by him, no payment after it, open period.
-- For everyone: no customer return on the sale (083), no closed report period, not before the opening lock (T0),
-- every piece of the sale still where the sale left it. (T0: sales between the opening draft and its lock are refused
-- by the draft / freeze guard, so 'before the opening period' = before T0.)
create or replace function public.rpc_edit_client_sale(
  p_sale_id uuid, p_reason text, p_idempotency_key text,
  p_weight_grams numeric default null, p_client_markup_pct numeric default null,
  p_piece_id uuid default null, p_piece_ids uuid[] default null, p_sale_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org uuid := public.current_organization_id();
  v_role text := public.current_employee_role_text();
  v_emp uuid := public.current_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_key text := nullif(btrim(p_idempotency_key), '');
  s public.jewelry_sales%rowtype;
  v_kind text; v_cur text; v_w numeric; v_pct numeric; v_amt numeric; v_piece uuid; v_pieces uuid[];
  v_old_piece uuid; v_old_pieces uuid[]; v_acc numeric; x record;
  v_payload jsonb; v_existing jsonb; v_new jsonb; v_old jsonb; v_newv jsonb; v_res jsonb; v_new_id uuid;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi']);
  if v_reason is null then raise exception 'ERR_REASON_REQUIRED: tahrirlash sababi kiritilishi shart'; end if;
  if v_key is null then raise exception 'ERR_IDEMPOTENCY_REQUIRED: idempotency kaliti majburiy'; end if;
  v_payload := jsonb_build_object('action', 'edit_client_sale', 'sale_id', p_sale_id, 'weight_grams', p_weight_grams, 'markup_pct', p_client_markup_pct,
    'piece_id', p_piece_id, 'piece_ids', to_jsonb(p_piece_ids), 'sale_amount', p_sale_amount, 'reason', v_reason);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_edit_client_sale', v_payload);
  if v_existing is not null then return v_existing; end if;

  -- one edit at a time per sale: the row lock serializes parallel edits / reversals; the second one sees 'reversed'
  select * into s from public.jewelry_sales where id = p_sale_id and organization_id = v_org for update;
  if not found then raise exception 'ERR_SALE_NOT_FOUND: savdo topilmadi'; end if;
  if s.status in ('reversed', 'cancelled') then raise exception 'ERR_SALE_ALREADY_REVERSED: bu savdo allaqachon bekor qilingan yoki tahrirlangan (%)', s.sale_no; end if;
  if public._goldia_is_seller_role(v_role) and s.seller_id is distinct from v_emp then
    raise exception 'ERR_NOT_OWN_SALE: sotuvchi faqat o''z savdosini tahrirlay oladi' using errcode = '42501';
  end if;
  if exists (select 1 from public.goldia_report_periods p where p.organization_id = v_org and s.sale_date between p.period_start and p.period_end) then
    raise exception 'ERR_PERIOD_CLOSED: savdo sanasi yopilgan hisobot davrida - tahrirlab bo''lmaydi';
  end if;
  if exists (select 1 from public.opening_periods p where p.organization_id = v_org and p.status in ('locked', 'closed') and s.created_at < p.created_at) then
    raise exception 'ERR_BEFORE_OPENING_LOCK: savdo boshlang''ich hisob (T0) qulflanishidan oldin - tahrirlab bo''lmaydi';
  end if;
  if exists (select 1 from public.jewelry_sale_returns r where r.sale_id = s.id and r.status = 'confirmed') then
    raise exception 'ERR_SALE_HAS_RETURNS: savdo bo''yicha vozvrat bor - tahrirlab bo''lmaydi';
  end if;

  v_cur := coalesce(s.sale_currency, 'XAU585');
  v_kind := case when v_cur <> 'XAU585' then 'currency' when s.sale_type = 'piece' then 'piece' when s.sale_type = 'weight' then 'weight' else null end;
  if v_kind is null then raise exception 'ERR_EDIT_UNSUPPORTED: bu turdagi savdoni (%) tahrirlab bo''lmaydi - menejer bekor qilib qayta kiritadi', coalesce(s.sale_type, '?'); end if;

  -- the pieces of the sale must still be where the sale left them (else the reversal could not put them back exactly)
  if v_kind = 'piece' then
    select id into v_old_piece from public.consignment_pieces where sale_id = s.id and organization_id = v_org;
    if v_old_piece is null or exists (select 1 from public.consignment_pieces cp join public.seller_consignments c on c.id = cp.consignment_id
                                       where cp.id = v_old_piece and (cp.status <> 'sold' or c.status in ('cancelled', 'reversed'))) then
      raise exception 'ERR_SALE_LINKED_PIECE_MOVED: savdo donasi joyida emas - tahrirlab bo''lmaydi';
    end if;
  else
    select array_agg(a.piece_id order by a.created_at, a.id) into v_old_pieces from public.weight_sale_allocations a where a.sale_id = s.id and a.reversed_at is null;
    if exists (select 1 from public.weight_sale_allocations a join public.consignment_pieces cp on cp.id = a.piece_id join public.seller_consignments c on c.id = cp.consignment_id
                where a.sale_id = s.id and a.reversed_at is null
                  and (cp.status not in ('held_by_seller', 'sold') or c.status in ('cancelled', 'reversed') or cp.seller_id is distinct from s.seller_id)) then
      raise exception 'ERR_SALE_LINKED_PIECE_MOVED: savdo donalaridan biri sotuvchida emas - tahrirlab bo''lmaydi';
    end if;
  end if;

  -- corrected values (a value not given stays as it was)
  v_w := round(coalesce(p_weight_grams, s.base_weight_grams)::numeric, 4);
  v_pct := round(coalesce(p_client_markup_pct, s.client_markup_pct)::numeric, 2);
  v_amt := round(coalesce(p_sale_amount, s.sale_amount)::numeric, 2);
  v_piece := coalesce(p_piece_id, v_old_piece);
  if v_kind = 'piece' and p_weight_grams is not null then raise exception 'ERR_PIECE_WEIGHT_FIXED: dona savdosida vazn donaning o''zidan olinadi - boshqa donani tanlang'; end if;
  if v_kind = 'currency' and p_client_markup_pct is not null then raise exception 'ERR_CURRENCY_NO_MARKUP: valyuta narxidagi savdoda foiz yo''q - narxni tahrirlang'; end if;
  if v_kind <> 'currency' and p_sale_amount is not null then raise exception 'ERR_GRAM_SALE_NO_AMOUNT: gramm savdosida narx foiz bilan beriladi'; end if;
  if v_w <= 0 or (v_kind = 'currency' and coalesce(v_amt, 0) <= 0) then raise exception 'ERR_VALUE_NOT_POSITIVE: vazn va narx 0 dan katta bo''lishi shart'; end if;
  if v_kind = 'piece' and v_piece = v_old_piece and v_pct = s.client_markup_pct
     or v_kind = 'weight' and v_w = s.base_weight_grams and v_pct = s.client_markup_pct and p_piece_ids is null
     or v_kind = 'currency' and v_w = s.base_weight_grams and v_amt = s.sale_amount and p_piece_ids is null then
    raise exception 'ERR_EDIT_NO_CHANGE: hech narsa o''zgarmadi';
  end if;

  v_old := jsonb_build_object('sale_no', s.sale_no, 'kind', v_kind, 'sale_date', s.sale_date, 'weight_g', s.base_weight_grams, 'markup_pct', s.client_markup_pct,
    'client_due_g', s.client_gold_due_grams, 'currency', v_cur, 'amount', s.sale_amount, 'piece_id', v_old_piece, 'piece_ids', to_jsonb(v_old_pieces),
    'product', s.product_name, 'model_code', s.model_code);

  -- 1. the original out (its own rules, the seller guard included)
  perform public.rpc_reverse_client_sale(s.id, 'TAHRIR: ' || v_reason, v_key || ':rev');
  if v_kind <> 'piece' then
    if p_piece_ids is not null then v_pieces := p_piece_ids;
    elsif v_old_pieces is not null then
      -- the same pieces as before (now back with the seller), as many as the corrected weight needs
      v_acc := 0; v_pieces := array[]::uuid[];
      for x in select cp.id, cp.weight_grams w from unnest(v_old_pieces) with ordinality u(pid, n) join public.consignment_pieces cp on cp.id = u.pid
                where cp.status = 'held_by_seller' and cp.sale_id is null order by u.n loop
        exit when v_acc >= v_w - 0.00005;
        v_pieces := v_pieces || x.id; v_acc := v_acc + x.w;
      end loop;
      if v_acc < v_w - 0.00005 then v_pieces := null; end if; -- more grams than those pieces: the sale picks pieces as usual (FIFO)
    end if;
  end if;
  -- 2. the corrected sale in, for the same customer and seller
  if v_kind = 'weight' then
    v_new := public.rpc_record_weight_sale(p_customer_id := s.customer_id, p_seller_id := s.seller_id, p_weight_grams := v_w, p_client_markup_pct := v_pct,
      p_notes := 'TAHRIR ' || s.sale_no || ': ' || v_reason, p_idempotency_key := v_key || ':new', p_piece_ids := v_pieces);
  elsif v_kind = 'piece' then
    v_new := public.rpc_record_barcode_piece_sale(p_customer_id := s.customer_id, p_seller_id := s.seller_id, p_piece_id := v_piece, p_client_markup_pct := v_pct,
      p_notes := 'TAHRIR ' || s.sale_no || ': ' || v_reason, p_idempotency_key := v_key || ':new');
  else
    v_new := public.rpc_record_currency_sale(p_customer_id := s.customer_id, p_currency := v_cur, p_amount := v_amt, p_weight_grams := v_w, p_piece_ids := v_pieces,
      p_seller_id := s.seller_id, p_notes := 'TAHRIR ' || s.sale_no || ': ' || v_reason, p_idempotency_key := v_key || ':new');
  end if;
  v_new_id := (v_new ->> 'sale_id')::uuid;
  if v_new_id is null then raise exception 'ERR_EDIT_FAILED: yangi savdo yozilmadi'; end if;

  select jsonb_build_object('sale_no', n.sale_no, 'kind', v_kind, 'sale_date', n.sale_date, 'weight_g', n.base_weight_grams, 'markup_pct', n.client_markup_pct,
    'client_due_g', n.client_gold_due_grams, 'currency', coalesce(n.sale_currency, 'XAU585'), 'amount', n.sale_amount,
    'piece_id', (select id from public.consignment_pieces where sale_id = n.id limit 1),
    'piece_ids', (select to_jsonb(array_agg(a.piece_id order by a.created_at, a.id)) from public.weight_sale_allocations a where a.sale_id = n.id and a.reversed_at is null),
    'product', n.product_name, 'model_code', n.model_code)
    into v_newv from public.jewelry_sales n where n.id = v_new_id;

  insert into public.sale_edits (organization_id, original_sale_id, new_sale_id, edited_by, edited_role, reason, old_values, new_values, idempotency_key)
  values (v_org, s.id, v_new_id, v_emp, v_role, v_reason, v_old, v_newv, v_key);
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'jewelry_sales', s.id::text, 'EDIT_CLIENT_SALE', auth.uid(), v_old, v_newv || jsonb_build_object('new_sale_id', v_new_id), v_reason);

  v_res := jsonb_build_object('status', 'ok', 'original_sale_id', s.id, 'original_sale_no', s.sale_no, 'new_sale_id', v_new_id,
    'new_sale_no', v_new ->> 'sale_no', 'old', v_old, 'new', v_newv);
  perform public.save_idempotency_response(v_key, 'rpc_edit_client_sale', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_edit_client_sale(uuid, text, text, numeric, numeric, uuid, uuid[], numeric) from public, anon;
grant execute on function public.rpc_edit_client_sale(uuid, text, text, numeric, numeric, uuid, uuid[], numeric) to authenticated;

notify pgrst, 'reload schema';
