-- ROLLBACK of 076: restores the 056 bodies of rpc_record_client_legacy_debt / rpc_reverse_client_legacy_debt (director /
-- admin / accountant only). Legacy debt rows written while 076 was active stay (they are valid data); only the functions
-- change. Remove the history row so the migration can be re-applied.
CREATE OR REPLACE FUNCTION public.rpc_record_client_legacy_debt(p_customer_id uuid, p_balance_type text, p_amount_585_g numeric, p_as_of_date date, p_notes text DEFAULT NULL::text, p_entry_type text DEFAULT 'initial'::text, p_target_final_balance numeric DEFAULT NULL::numeric, p_idempotency_key text DEFAULT NULL::text, p_seller_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org           uuid := public.current_organization_id();
  v_caller_emp_id        uuid := public.current_employee_id();
  v_customer             public.customers%rowtype;
  v_seller_id            uuid;
  v_client_acc           public.client_gold_accounts%rowtype;
  v_cur_debt             numeric(14, 4) := 0;
  v_cur_adv              numeric(14, 4) := 0;
  v_target               numeric(14, 4);
  v_delta                numeric(14, 4) := 0;
  v_new_debt             numeric(14, 4) := 0;
  v_new_adv              numeric(14, 4) := 0;
  v_amt                  numeric(14, 4);
  v_entry_type           text := coalesce(nullif(btrim(p_entry_type), ''), 'initial');
  v_bal_type             text := coalesce(nullif(btrim(p_balance_type), ''), 'debt');
  v_legacy_id            uuid;
  v_payload              jsonb;
  v_existing             jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter'
  ]);

  if p_customer_id is null then
    raise exception 'Mijoz tanlanishi shart';
  end if;

  if p_as_of_date is null then
    raise exception 'Qarz qaysi sanadagi holat ekani ko''rsatilishi shart';
  end if;

  if v_bal_type not in ('debt', 'advance') then
    raise exception 'Qoldiq turi faqat "debt" (qarz) yoki "advance" (avans) bo''lishi mumkin';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Mijoz topilmadi: %', p_customer_id;
  end if;

  v_seller_id := coalesce(p_seller_id, v_customer.seller_id);

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    v_payload := jsonb_build_object(
      'action', 'record_client_legacy_debt',
      'customer_id', p_customer_id,
      'balance_type', v_bal_type,
      'amount_585_g', p_amount_585_g,
      'target_balance', p_target_final_balance,
      'as_of_date', p_as_of_date
    );

    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_legacy_debt', v_payload);
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = p_customer_id and organization_id = v_caller_org
  for update;

  if found then
    v_cur_debt := coalesce(v_client_acc.current_debt_grams, 0);
    v_cur_adv  := coalesce(v_client_acc.advance_balance_grams, 0);
  end if;

  if p_target_final_balance is not null then
    v_target := round(greatest(0, p_target_final_balance)::numeric, 4);

    if v_bal_type = 'debt' then
      v_new_debt := v_target;
      v_new_adv  := 0;
      v_delta    := round(v_new_debt - (v_cur_debt - v_cur_adv), 4);
    else
      v_new_debt := 0;
      v_new_adv  := v_target;
      v_delta    := round((-v_new_adv) - (v_cur_debt - v_cur_adv), 4);
    end if;

    v_amt := abs(v_delta);
    if abs(v_delta) < 0.0001 then
      return jsonb_build_object(
        'status', 'ok',
        'no_change_needed', true,
        'current_debt_585_g', v_cur_debt,
        'current_advance_585_g', v_cur_adv,
        'target_balance', v_target,
        'delta_585_g', 0
      );
    end if;

  else
    v_amt := round(greatest(0, coalesce(p_amount_585_g, 0))::numeric, 4);
    if v_amt <= 0 then
      raise exception 'Qarz yoki avans miqdori 0 dan katta bo''lishi shart';
    end if;

    if v_bal_type = 'debt' then
      v_delta := v_amt;
      if v_cur_adv > 0 then
        if v_cur_adv >= v_amt then
          v_new_adv  := round(v_cur_adv - v_amt, 4);
          v_new_debt := v_cur_debt;
        else
          v_new_debt := round(v_cur_debt + (v_amt - v_cur_adv), 4);
          v_new_adv  := 0;
        end if;
      else
        v_new_debt := round(v_cur_debt + v_amt, 4);
        v_new_adv  := 0;
      end if;
    else
      v_delta := -v_amt;
      if v_cur_debt > 0 then
        if v_cur_debt >= v_amt then
          v_new_debt := round(v_cur_debt - v_amt, 4);
          v_new_adv  := v_cur_adv;
        else
          v_new_adv  := round(v_cur_adv + (v_amt - v_cur_debt), 4);
          v_new_debt := 0;
        end if;
      else
        v_new_adv  := round(v_cur_adv + v_amt, 4);
        v_new_debt := 0;
      end if;
    end if;
  end if;

  insert into public.client_legacy_debts (
    organization_id, customer_id, seller_id, balance_type,
    amount_585_g, previous_debt_585_g, previous_advance_585_g, delta_585_g,
    new_debt_585_g, new_advance_585_g, as_of_date, notes,
    entry_type, status, created_by
  ) values (
    v_caller_org, p_customer_id, v_seller_id, v_bal_type,
    v_amt, v_cur_debt, v_cur_adv, v_delta,
    v_new_debt, v_new_adv, p_as_of_date, p_notes,
    v_entry_type, 'confirmed', v_caller_emp_id
  ) returning id into v_legacy_id;

  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id,
    total_purchased_gold_grams, total_scrap_paid_grams,
    total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    p_customer_id, v_caller_org, v_seller_id,
    0, 0, 0, 0, 0,
    v_new_debt, v_new_adv, now()
  )
  on conflict (customer_id) do update set
    seller_id = coalesce(client_gold_accounts.seller_id, excluded.seller_id),
    current_debt_grams = v_new_debt,
    advance_balance_grams = v_new_adv,
    updated_at = now();

  if v_seller_id is not null then
    perform public.recalc_seller_gold_account(v_seller_id, v_caller_org);
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'legacy_debt_id', v_legacy_id,
    'customer_id', p_customer_id,
    'seller_id', v_seller_id,
    'balance_type', v_bal_type,
    'delta_585_g', v_delta,
    'previous_debt_585_g', v_cur_debt,
    'previous_advance_585_g', v_cur_adv,
    'new_debt_585_g', v_new_debt,
    'new_advance_585_g', v_new_adv,
    'as_of_date', p_as_of_date
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_legacy_debt', v_existing, v_payload);
  return v_existing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_reverse_client_legacy_debt(p_legacy_debt_id uuid, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := nullif(btrim(p_reason), '');
  v_rec             public.client_legacy_debts%rowtype;
  v_client_acc      public.client_gold_accounts%rowtype;
  v_cur_debt        numeric(14, 4);
  v_cur_adv         numeric(14, 4);
  v_rev_net         numeric(14, 4);
  v_rev_debt        numeric(14, 4);
  v_rev_adv         numeric(14, 4);
  v_payload         jsonb;
  v_existing        jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter'
  ]);

  if v_clean_reason is null then
    raise exception 'Eski qarzni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_client_legacy_debt',
    'legacy_debt_id', p_legacy_debt_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_client_legacy_debt', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_rec
  from public.client_legacy_debts
  where id = p_legacy_debt_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Eski qarz yozuvi topilmadi: %', p_legacy_debt_id;
  end if;

  if v_rec.status = 'reversed' then
    raise exception 'Ushbu eski qarz yozuvi allaqachon bekor qilingan';
  end if;

  -- Lock client gold account
  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = v_rec.customer_id and organization_id = v_caller_org
  for update;

  v_cur_debt := coalesce(v_client_acc.current_debt_grams, 0);
  v_cur_adv  := coalesce(v_client_acc.advance_balance_grams, 0);

  -- Reversing delta mathematically: Net position = (debt - advance) - delta
  v_rev_net := round((v_cur_debt - v_cur_adv) - v_rec.delta_585_g, 4);
  if v_rev_net >= 0 then
    v_rev_debt := v_rev_net;
    v_rev_adv  := 0;
  else
    v_rev_debt := 0;
    v_rev_adv  := abs(v_rev_net);
  end if;

  -- Update client_gold_accounts
  update public.client_gold_accounts
     set current_debt_grams = v_rev_debt,
         advance_balance_grams = v_rev_adv,
         updated_at = now()
   where customer_id = v_rec.customer_id and organization_id = v_caller_org;

  -- Mark legacy debt row as reversed
  update public.client_legacy_debts
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason,
         updated_at = now()
   where id = p_legacy_debt_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'client_legacy_debts', p_legacy_debt_id::text,
    'REVERSE_CLIENT_LEGACY_DEBT', auth.uid(),
    jsonb_build_object('status', 'confirmed', 'debt_g', v_cur_debt, 'advance_g', v_cur_adv),
    jsonb_build_object('status', 'reversed', 'debt_g', v_rev_debt, 'advance_g', v_rev_adv),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'legacy_debt_id', p_legacy_debt_id,
    'customer_id', v_rec.customer_id,
    'reversed_delta_g', v_rec.delta_585_g,
    'new_debt_585_g', v_rev_debt,
    'new_advance_585_g', v_rev_adv,
    'reason', v_clean_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_legacy_debt', v_existing, v_payload);
  end if;

  return v_existing;
end;
$function$;

revoke execute on function public.rpc_record_client_legacy_debt(uuid, text, numeric, date, text, text, numeric, text, uuid) from public, anon;
grant execute on function public.rpc_record_client_legacy_debt(uuid, text, numeric, date, text, text, numeric, text, uuid) to authenticated, service_role;
revoke execute on function public.rpc_reverse_client_legacy_debt(uuid, text, text) from public, anon;
grant execute on function public.rpc_reverse_client_legacy_debt(uuid, text, text) to authenticated, service_role;
CREATE OR REPLACE FUNCTION public.rpc_record_weight_sale(p_customer_id uuid, p_seller_id uuid DEFAULT NULL::uuid, p_weight_grams numeric DEFAULT NULL::numeric, p_client_markup_pct numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_piece_ids uuid[] DEFAULT NULL::uuid[])
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
  -- 070: a retried request (same key) must return the original result even when the stock is now used up
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_weight_sale', jsonb_build_object(
    'action', 'record_weight_sale', 'customer_id', p_customer_id, 'seller_id', v_seller.id,
    'weight_grams', v_weight, 'markup_pct', v_markup, 'piece_ids', to_jsonb(p_piece_ids)));
  if v_existing is not null then
    return v_existing;
  end if;
  v_avail_stock := public.get_seller_available_stock_grams(v_seller.id);

  if v_avail_stock < v_weight then
    raise exception 'ERR_INSUFFICIENT_SELLER_STOCK: Sotuvchi omborida yetarli oltin mavjud emas (Mavjud: % g, Talab: % g)',
      v_avail_stock, v_weight;
  end if;

  -- 073: a weight sale must name the physical piece(s) it is cut from whenever the seller holds barcode pieces.
  -- Model code + weight cannot identify an individual item, so an unspecified partial cut is refused.
  if p_piece_ids is null or cardinality(p_piece_ids) = 0 then
    if exists (select 1 from public.consignment_pieces cp
                where cp.seller_id = v_seller.id and cp.organization_id = v_caller_org
                  and cp.status = 'held_by_seller' and cp.sale_id is null) then
      raise exception 'ERR_PIECE_REQUIRED: Vazn bo''yicha sotuvda qaysi donadan sotilayotganini tanlang';
    end if;
  else
    if cardinality(p_piece_ids) <> (select count(distinct x) from unnest(p_piece_ids) x) then
      raise exception 'ERR_PIECE_DUPLICATE: Bir dona ikki marta tanlangan';
    end if;
    perform 1 from public.consignment_pieces cp
      where cp.id = any(p_piece_ids) order by cp.id for update;
    if (select count(*) from public.consignment_pieces cp
         where cp.id = any(p_piece_ids) and cp.seller_id = v_seller.id and cp.organization_id = v_caller_org
           and cp.status = 'held_by_seller' and cp.sale_id is null) <> cardinality(p_piece_ids) then
      raise exception 'ERR_PIECE_NOT_AVAILABLE: Tanlangan donalardan biri sotuvchida mavjud emas yoki allaqachon sotilgan';
    end if;
    if (select coalesce(sum(cp.weight_grams), 0) from public.consignment_pieces cp where cp.id = any(p_piece_ids)) < v_weight - 0.00005 then
      raise exception 'ERR_PIECES_TOO_LIGHT: Tanlangan donalar jami vazni sotilayotgan vazndan kam';
    end if;
    if cardinality(p_piece_ids) > 1 and (select coalesce(sum(cp.weight_grams), 0) from public.consignment_pieces cp
         where cp.id = any(p_piece_ids[1:cardinality(p_piece_ids) - 1])) >= v_weight - 0.00005 then
      raise exception 'ERR_PIECE_EXTRA: Oxirgi tanlangan dona kerak emas — faqat oxirgi dona qisman kesilishi mumkin';
    end if;
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_weight_sale',
    'customer_id', p_customer_id,
    'seller_id', v_seller.id,
    'weight_grams', v_weight,
    'markup_pct', v_markup,
    'piece_ids', to_jsonb(p_piece_ids)
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

  -- FIFO: Link sale to seller's active consignment (073: the consignment of the first selected piece)
  if p_piece_ids is not null and cardinality(p_piece_ids) > 0 then
    select sc.* into v_consign from public.seller_consignments sc
      join public.consignment_pieces cp on cp.consignment_id = sc.id
     where cp.id = p_piece_ids[1]
     for update of sc;
  else
  select * into v_consign
    from public.seller_consignments
   where seller_id = v_seller.id and organization_id = v_caller_org
     and status in ('held_by_seller', 'partially_sold')
   order by created_at asc
   limit 1
   for update;
  end if;

  v_sale_no := 'SALE-W-' || to_char(public._goldia_business_date(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

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
    public._goldia_business_date(), nullif(btrim(p_idempotency_key), ''), p_notes, 'weight'
  ) returning id into v_sale_id;

  -- If a consignment was linked, update sold info and pieces
  if v_consign.id is not null then
    update public.seller_consignments
       set status = 'partially_sold',
           sold_quantity = coalesce(sold_quantity, 0) + 1,
           updated_at = now()
     where id = v_consign.id;

    -- 068: consume the full sold weight across every held piece (this consignment first)
    if p_piece_ids is not null and cardinality(p_piece_ids) > 0 then
      perform public._goldia_consume_selected_pieces(v_sale_id, v_seller.id, p_piece_ids, v_weight, v_caller_org);
    else
      perform public._goldia_consume_weight_sale_pieces(v_sale_id, v_seller.id, v_consign.id, v_weight, v_caller_org);
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
$function$;

revoke execute on function public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text, uuid[]) from public, anon;
grant execute on function public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text, uuid[]) to authenticated, service_role;
CREATE OR REPLACE FUNCTION public.rpc_reverse_financial_transaction(p_transaction_id uuid, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := nullif(btrim(p_reason), '');
  v_tx              public.financial_transactions%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_payload         jsonb;
  v_existing        jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter'
  ]);

  if v_clean_reason is null then
    raise exception 'Moliyaviy operatsiyani bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_financial_transaction',
    'transaction_id', p_transaction_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_financial_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_tx
  from public.financial_transactions
  where id = p_transaction_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Moliyaviy operatsiya topilmadi: %', p_transaction_id;
  end if;

  if v_tx.status = 'reversed' then
    raise exception 'Ushbu moliyaviy operatsiya allaqachon bekor qilingan (%s)', v_tx.transaction_no;
  end if;

  -- Lock manager vault
  perform public._get_or_create_manager_vault(v_caller_org);
  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_caller_org
  for update;

  -- Reversal math based on transaction type
  if v_tx.transaction_type = 'capital_contribution' then
    -- Original injected capital into till -> reversal DEDUCTS from till!
    if v_tx.source_till = 'manager_uzs' then
      if v_vault.manager_cash_amount < v_tx.amount_num then
        raise exception 'Operatsiyani bekor qilib bo''lmaydi: seyfda yetarli naqd pul (UZS) mavjud emas (Mavjud: % UZS, Talab: % UZS)',
          v_vault.manager_cash_amount, v_tx.amount_num;
      end if;
      update public.manager_vault_account
         set manager_cash_amount = round((manager_cash_amount - v_tx.amount_num)::numeric, 2), updated_at = now()
       where organization_id = v_caller_org;

    elsif v_tx.source_till = 'manager_usd' then
      if coalesce(v_vault.manager_usd_amount, 0) < v_tx.amount_num then
        raise exception 'Operatsiyani bekor qilib bo''lmaydi: seyfda yetarli dollar (USD) mavjud emas (Mavjud: % USD, Talab: % USD)',
          coalesce(v_vault.manager_usd_amount, 0), v_tx.amount_num;
      end if;
      update public.manager_vault_account
         set manager_usd_amount = round((coalesce(manager_usd_amount, 0) - v_tx.amount_num)::numeric, 2), updated_at = now()
       where organization_id = v_caller_org;

    elsif v_tx.source_till = 'manager_vault_gold' then
      if v_vault.manager_refined_gold_grams < v_tx.equiv_585_grams then
        raise exception 'Operatsiyani bekor qilib bo''lmaydi: seyfda yetarli oltin mavjud emas (Mavjud: % g, Talab: % g)',
          v_vault.manager_refined_gold_grams, v_tx.equiv_585_grams;
      end if;
      update public.manager_vault_account
         set manager_refined_gold_grams = round((manager_refined_gold_grams - v_tx.equiv_585_grams)::numeric, 4), updated_at = now()
       where organization_id = v_caller_org;
    end if;

  elsif v_tx.transaction_type in ('capital_distribution', 'business_expense') then
    -- Original deducted cash/gold from till -> reversal RESTORES to till!
    if v_tx.source_till = 'manager_uzs' then
      update public.manager_vault_account
         set manager_cash_amount = round((manager_cash_amount + v_tx.amount_num)::numeric, 2), updated_at = now()
       where organization_id = v_caller_org;
    elsif v_tx.source_till = 'manager_usd' then
      update public.manager_vault_account
         set manager_usd_amount = round((coalesce(manager_usd_amount, 0) + v_tx.amount_num)::numeric, 2), updated_at = now()
       where organization_id = v_caller_org;
    elsif v_tx.source_till = 'manager_vault_gold' then
      update public.manager_vault_account
         set manager_refined_gold_grams = round((manager_refined_gold_grams + v_tx.equiv_585_grams)::numeric, 4), updated_at = now()
       where organization_id = v_caller_org;
    end if;
  end if;

  -- Mark financial transaction as reversed
  update public.financial_transactions
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = p_transaction_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'financial_transactions', p_transaction_id::text,
    'REVERSE_FINANCIAL_TRANSACTION', auth.uid(),
    jsonb_build_object('tx_no', v_tx.transaction_no, 'amount', v_tx.amount_num, 'type', v_tx.transaction_type),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'transaction_id', p_transaction_id,
    'transaction_no', v_tx.transaction_no,
    'transaction_type', v_tx.transaction_type,
    'amount_num', v_tx.amount_num,
    'currency', v_tx.currency,
    'reason', v_clean_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_financial_transaction', v_existing, v_payload);
  end if;

  return v_existing;
end;
$function$;

revoke execute on function public.rpc_reverse_financial_transaction(uuid, text, text) from public, anon;
grant execute on function public.rpc_reverse_financial_transaction(uuid, text, text) to authenticated, service_role;
delete from supabase_migrations.schema_migrations where version = '20260101000076';
