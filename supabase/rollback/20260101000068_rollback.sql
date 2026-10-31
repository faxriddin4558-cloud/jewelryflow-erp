-- ROLLBACK for migration 20260101000068_goldia_weight_sale_pieces_and_factory_counters.sql
-- NOT a migration (never applied automatically). Restores the 067 definitions of the four changed
-- functions and removes the 068 helpers. Kept on purpose: weight_sale_allocations rows, the repaired
-- piece records and the rebuilt factory counters (they are correct data, and audit_logs holds the
-- before/after values). After a rollback, sales recorded with allocations reverse with the old logic.

begin;

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

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'sales', 'seller', 'sotuvchi', 'manager', 'production_manager', 'boshqaruvchi'
  ]);
  v_weight := round(greatest(0, coalesce(p_weight_grams, 0))::numeric, 4);
  if p_client_markup_pct is null then
    raise exception 'ERR_MARKUP_REQUIRED: Mijoz ustama foizi aniq ko''rsatilishi shart';
  end if;
  v_markup := round(p_client_markup_pct::numeric, 2);
  if v_markup < 0 or v_markup > 100 then
    raise exception 'ERR_MARKUP_OUT_OF_RANGE: Mijoz ustama foizi 0 dan 100 gacha bo''lishi shart (kiritildi: %)', v_markup;
  end if;

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

  -- Check available physical stock via canonical helper.
  -- 065: serialize stock-changing sales per seller before checking availability
  perform pg_advisory_xact_lock(hashtextextended('goldia_seller_stock:' || v_seller.id::text, 0));
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
        update public.jewelry_sales set source_piece_id = v_piece.id where id = v_sale_id;
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
    -- 065: the parent consignment must give back the sold count as well
    UPDATE public.seller_consignments
       SET sold_quantity = GREATEST(0, COALESCE(sold_quantity, 1) - 1),
           status = CASE
                      WHEN GREATEST(0, COALESCE(sold_quantity, 1) - 1) <= 0 THEN 'held_by_seller'
                      ELSE 'partially_sold'
                    END,
           updated_at = NOW()
     WHERE id = v_piece.consignment_id;
  ELSIF v_sale.consignment_id IS NOT NULL THEN
    -- 065: restore weight onto the exact piece the weight sale reduced, when known
    SELECT * INTO v_piece
      FROM public.consignment_pieces
     WHERE consignment_id = v_sale.consignment_id AND status = 'held_by_seller'
     ORDER BY (id = v_sale.source_piece_id) DESC, updated_at DESC
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
    -- 065: restore weight onto the exact piece the weight sale reduced, when known
    SELECT * INTO v_piece
      FROM public.consignment_pieces
     WHERE consignment_id = v_sale.consignment_id AND status = 'held_by_seller'
     ORDER BY (id = v_sale.source_piece_id) DESC, updated_at DESC
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
  IF public._goldia_is_seller_role(public.current_employee_role_text())
     AND p_seller_id IS DISTINCT FROM public.current_employee_id() THEN
    RAISE EXCEPTION 'Ruxsat etilmadi: Sotuvchi faqat o''z hisobotini ko''ra oladi' USING errcode = '42501';
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

drop function if exists public._goldia_restore_weight_sale_allocations(uuid);
drop function if exists public._goldia_consume_weight_sale_pieces(uuid, uuid, uuid, numeric, uuid, text);
drop function if exists public._goldia_repair_weight_sale_pieces();
drop function if exists public._goldia_repair_factory_counters();

commit;
