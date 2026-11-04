-- 076 - Legacy debt for managers and sellers (incident: a seller entering 206.83 g got "permission denied").
--
-- Before 076 rpc_record_client_legacy_debt / rpc_reverse_client_legacy_debt allowed only director / admin / accountant,
-- while the "Eski qarz" button is shown to every role (the customers page of managers and sellers).
-- 076, minimal and fail-closed:
--   * record: + manager and seller. A SELLER: only his own customers (customers.seller_id = caller), the debt is booked
--     on himself, only balance_type 'debt' and only a positive change (an addition or a reconciliation upwards).
--     Lowering a debt or entering an advance lowers the seller's own obligation -> manager / director only.
--   * record: p_seller_id must be an employee of the caller's organization (before 076 any uuid was accepted and
--     recalc_seller_gold_account could overwrite another organization's seller account).
--   * record: the idempotency key is stored on the row (unique index exists); the same addition (customer, grams,
--     type, date, author) is refused for 10 minutes when sent again with another key (double click / retry).
--   * reverse: + manager (not seller); the seller account is recalculated after a reversal (before 076 the seller's
--     obligation kept the reversed grams); an entry with a newer reconciliation on top is refused (reverse that first).
--   * rpc_record_weight_sale: choosing the source piece is optional again (business decision 2026-11-04). Without
--     p_piece_ids the grams come from the seller's held pieces oldest first (existing 068 helper); 073's
--     ERR_PIECE_REQUIRED refusal is removed, every other 073 check of explicitly chosen pieces stays.
--   * rpc_reverse_financial_transaction: the 051 overload (uuid, text, text) is dropped. With it PostgREST could not
--     choose between (uuid, text) and (uuid, text, text) for the UI call {p_transaction_id, p_reason} and answered
--     HTTP 300 PGRST203 to EVERY role - no cash / capital operation could be reversed. The 060 body (uuid, text),
--     which is the current logic, stays unchanged.
--   * rpc_record_weight_sale / rpc_record_barcode_piece_sale / rpc_record_client_jewelry_sale: a seller may sell only to
--     his own or to unassigned customers (payments have had this rule since 065; through the API a seller could book a
--     sale - and debt - on another seller's customer).
--   * _goldia_consume_weight_sale_pieces / _goldia_consume_selected_pieces: a 0.0001 g remainder no longer consumes the whole
--     piece (found by the stress model: a 20.7665 g sale consumed 20.7666 g of pieces).
-- Legacy debt: stock, factory obligation, vault and profit are not touched (unchanged from 056: only client_legacy_debts,
-- client_gold_accounts and recalc_seller_gold_account). Signatures and grants are unchanged.

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
  v_caller_role          text := public.current_employee_role_text();
  v_is_seller            boolean;
  v_key                  text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- 076: managers and sellers may record legacy debts (sellers: own customers, additions only - see below)
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);
  v_is_seller := public._goldia_is_seller_role(v_caller_role);

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

  -- 076: a seller works only with his own customers and books the debt on himself
  if v_is_seller then
    if v_caller_emp_id is null or v_customer.seller_id is distinct from v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Ushbu mijoz sizga biriktirilmagan (eski qarzni faqat o''z mijozingizga kiritasiz)' using errcode = '42501';
    end if;
    if p_seller_id is not null and p_seller_id <> v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Sotuvchi eski qarzni faqat o''z nomiga kirita oladi' using errcode = '42501';
    end if;
    v_seller_id := v_caller_emp_id;
    if v_bal_type <> 'debt' then
      raise exception 'Ruxsat etilmadi: Avansni faqat menejer yoki direktor kiritadi' using errcode = '42501';
    end if;
  end if;

  -- 076: the seller the debt is booked on must be an employee of the caller's organization
  if v_seller_id is not null and not exists (
    select 1 from public.employees e where e.id = v_seller_id and e.organization_id = v_caller_org
  ) then
    raise exception 'Ruxsat etilmadi: Sotuvchi boshqa tashkilotga tegishli' using errcode = '42501';
  end if;

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

  -- 076: a seller may only ADD debt; lowering a debt (it lowers the seller's own obligation) needs a manager
  if v_is_seller and v_delta <= 0 then
    raise exception 'Ruxsat etilmadi: Qarzni kamaytirishni faqat menejer yoki direktor bajaradi (hozirgi qarz: % g)', round(v_cur_debt - v_cur_adv, 4) using errcode = '42501';
  end if;

  -- 076: the same addition sent again (double click / retry with a new key) is refused for 10 minutes
  if exists (
    select 1 from public.client_legacy_debts d
     where d.organization_id = v_caller_org and d.customer_id = p_customer_id and d.status <> 'reversed'
       and d.delta_585_g = v_delta and d.entry_type = v_entry_type and d.as_of_date = p_as_of_date
       and d.created_by is not distinct from v_caller_emp_id
       and d.created_at > clock_timestamp() - interval '10 minutes'
       and (v_key is null or d.idempotency_key is distinct from v_key)
  ) then
    raise exception 'Takroriy so''rov: shu mijozga xuddi shu eski qarz (% g) 10 daqiqa ichida kiritilgan. Ikki marta qo''shilmadi.', v_delta using errcode = '23505';
  end if;

  insert into public.client_legacy_debts (
    organization_id, customer_id, seller_id, balance_type,
    amount_585_g, previous_debt_585_g, previous_advance_585_g, delta_585_g,
    new_debt_585_g, new_advance_585_g, as_of_date, notes,
    entry_type, status, created_by, idempotency_key
  ) values (
    v_caller_org, p_customer_id, v_seller_id, v_bal_type,
    v_amt, v_cur_debt, v_cur_adv, v_delta,
    v_new_debt, v_new_adv, p_as_of_date, p_notes,
    v_entry_type, 'confirmed', v_caller_emp_id, v_key
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

  -- 076: managers may reverse legacy debts too; sellers may not (a reversal lowers the seller's obligation)
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi'
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

  -- 076: a later reconciliation fixed the absolute notebook balance; reversing an older entry under it would invent an
  -- advance or a debt. Reverse the newer reconciliation first.
  if exists (
    select 1 from public.client_legacy_debts d
     where d.organization_id = v_caller_org and d.customer_id = v_rec.customer_id and d.id <> v_rec.id
       and d.status <> 'reversed' and d.entry_type = 'reconciliation_adjustment' and d.created_at > v_rec.created_at
  ) then
    raise exception 'Avval shu mijozning keyingi qayta solishtirish yozuvini bekor qiling (u daftardagi qoldiqni belgilagan)';
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

  -- 076: the seller's obligation includes his legacy debts - recalculate it (before 076 it stayed stale)
  if v_rec.seller_id is not null then
    perform public.recalc_seller_gold_account(v_rec.seller_id, v_caller_org);
  end if;

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

  -- 076: a seller sells only to his own or to unassigned customers (same rule as payments since 065)
  if public._goldia_is_seller_role(public.current_employee_role_text())
     and v_customer.seller_id is not null and v_customer.seller_id is distinct from public.current_employee_id() then
    raise exception 'Ruxsat etilmadi: Ushbu mijoz boshqa sotuvchiga biriktirilgan' using errcode = '42501';
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

  -- 076 (business decision: choosing the product is NOT mandatory for now): without p_piece_ids the sold grams are
  -- taken automatically from the seller's held pieces, oldest first (_goldia_consume_weight_sale_pieces: whole pieces
  -- become 'sold', only the last one is cut; serialized by the per-seller lock above, so no piece is sold twice and the
  -- grams of the held pieces always equal the seller's gram stock). With p_piece_ids the 073 checks below apply.
  if p_piece_ids is not null and cardinality(p_piece_ids) > 0 then
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

drop function if exists public.rpc_reverse_financial_transaction(uuid, text, text);

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
  v_caller_role       text := public.current_employee_role_text();
  v_caller_emp_id     uuid := public.current_employee_id();
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

  -- 076: a seller sells only to his own or to unassigned customers (same rule as payments since 065)
  if public._goldia_is_seller_role(public.current_employee_role_text())
     and v_customer.seller_id is not null and v_customer.seller_id is distinct from public.current_employee_id() then
    raise exception 'Ruxsat etilmadi: Ushbu mijoz boshqa sotuvchiga biriktirilgan' using errcode = '42501';
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
  if public._goldia_is_seller_role(v_caller_role) and (v_caller_emp_id is null or v_seller.id <> v_caller_emp_id) then
    raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''z nomidan sotuv qila oladi' using errcode = '42501';
  end if;
  -- 065: markup must be explicit (no hidden 15% server default) and within 0..100
  if p_client_markup_pct is null then
    raise exception 'ERR_MARKUP_REQUIRED: Mijoz ustama foizi aniq ko''rsatilishi shart';
  end if;
  v_client_pct := round(p_client_markup_pct::numeric, 2);
  if v_client_pct < 0 or v_client_pct > 100 then
    raise exception 'ERR_MARKUP_OUT_OF_RANGE: Mijoz ustama foizi 0 dan 100 gacha bo''lishi shart (kiritildi: %)', v_client_pct;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('goldia_seller_stock:' || v_seller.id::text, 0));

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
       and sc.status not in ('returned_to_manager', 'cancelled', 'reversed')
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
  if v_piece.seller_id is distinct from v_seller.id then
    raise exception 'Ruxsat etilmadi: Ushbu mahsulot donasi boshqa sotuvchiga biriktirilgan' using errcode = '42501';
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
    public._goldia_business_date(), p_notes, 'piece', v_piece.model_id, v_piece.model_code,
    v_piece.category, v_piece.purity, v_spread
  ) returning id into v_sale_id;

  update public.consignment_pieces
     set status = 'sold',
         sale_id = v_sale_id,
         sold_at = now(),
         updated_at = now()
   where id = v_piece.id;

  -- Update consignment sold quantity
  select count(*)::int into v_remaining_pieces
    from public.consignment_pieces
   where consignment_id = v_consign.id and status = 'held_by_seller';
  update public.seller_consignments
     set sold_quantity = coalesce(sold_quantity, 0) + 1,
         status = case
                    when v_remaining_pieces = 0 then 'fully_sold'
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
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_barcode_piece_sale', v_existing, v_payload);
  end if;

  return v_existing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_record_client_jewelry_sale(p_customer_id uuid, p_consignment_id uuid, p_client_markup_pct numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- 070: only an untouched consignment may be sold as a whole; any weight sale, return or partial piece
  -- consumption means base_weight_grams no longer matches what the seller physically holds.
  if p_client_markup_pct is null or p_client_markup_pct < 0 or p_client_markup_pct > 100 then
    raise exception 'ERR_MARKUP_OUT_OF_RANGE: Mijoz ustama foizi 0 dan 100 gacha aniq ko''rsatilishi shart (kiritildi: %)', p_client_markup_pct;
  end if;
  if v_cons.status <> 'held_by_seller'
     or exists (select 1 from public.weight_sale_allocations w where w.consignment_id = v_cons.id and w.reversed_at is null)
     or exists (select 1 from public.jewelry_sales js where js.consignment_id = v_cons.id and js.status not in ('reversed', 'cancelled'))
     or (exists (select 1 from public.consignment_pieces p where p.consignment_id = v_cons.id)
         and abs(coalesce((select sum(p.weight_grams) from public.consignment_pieces p
                            where p.consignment_id = v_cons.id and p.status = 'held_by_seller'), 0) - v_cons.base_weight_grams) > 0.0001) then
    raise exception 'ERR_CONSIGNMENT_PARTIALLY_USED: Partiya % qisman sotilgan yoki qaytarilgan; donalab yoki vazn bo''yicha sotuvdan foydalaning', v_cons.consignment_no;
  end if;
  if v_cons.status in ('fully_sold', 'returned_to_factory', 'closed') or coalesce(v_cons.sold_quantity, 0) >= coalesce(v_cons.quantity, 0) then
    raise exception 'Consignment % is already closed or fully sold', v_cons.consignment_no;
  end if;

  -- P0-2: Check if pieces exist for this consignment in consignment_pieces and whether any piece was already sold
  if exists (
    select 1 from public.consignment_pieces
    where consignment_id = v_cons.id
      and status in ('sold', 'returned_to_factory', 'returned_to_manager')
  ) then
    raise exception 'Ushbu partiyadagi donalardan ayrimlari allaqachon sotilgan yoki qaytarilgan. Donalab sotuvdan foydalaning.';
  end if;

  -- Ensure seller owns this consignment unless privileged
  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi') then
    if v_cons.seller_id <> v_caller_emp_id then
      raise exception 'Cross-seller violation: You can only sell consignments allocated to your account' using errcode = '42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('goldia_seller_stock:' || v_cons.seller_id::text, 0));
  -- Verify customer
  select * into v_cust
    from public.customers
   where id = p_customer_id
     and organization_id = v_caller_org
   limit 1;
  if not found then
    raise exception 'Customer (%) not found in your organization', p_customer_id;
  end if;

  -- 076: a seller sells only to his own or to unassigned customers (same rule as payments since 065)
  if public._goldia_is_seller_role(public.current_employee_role_text())
     and v_cust.seller_id is not null and v_cust.seller_id is distinct from public.current_employee_id() then
    raise exception 'Ruxsat etilmadi: Ushbu mijoz boshqa sotuvchiga biriktirilgan' using errcode = '42501';
  end if;

  -- Non-compounding: Client gold due is calculated strictly from base weight
  v_client_gold_due := round((v_cons.base_weight_grams * (1.0 + v_client_markup / 100.0))::numeric, 4);
  v_markup_spread   := round((v_client_gold_due - v_cons.factory_gold_due_grams)::numeric, 4);

  -- Check existing advance balance
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
    case when v_net_rem_due <= 0.0001 then 'fully_paid' else 'open_debt' end,
    public._goldia_business_date(), nullif(btrim(p_idempotency_key), ''), p_notes
  ) returning id into v_sale_id;

  -- P0-2: ATOMICALLY UPDATE ALL PIECES in this consignment to 'sold' with sale_id
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
    'client_gold_due_grams', v_client_gold_due,
    'advance_applied_grams', v_apply_adv,
    'net_remaining_debt_grams', v_net_rem_due,
    'remaining_gold_grams', v_net_rem_due,
    'markup_spread_grams', v_markup_spread
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_jewelry_sale', v_existing, v_payload);
  return v_existing;
end;
$function$;

revoke execute on function public.rpc_record_barcode_piece_sale(uuid, uuid, uuid, uuid, numeric, numeric, text, text) from public, anon;
grant execute on function public.rpc_record_barcode_piece_sale(uuid, uuid, uuid, uuid, numeric, numeric, text, text) to authenticated, service_role;
revoke execute on function public.rpc_record_client_jewelry_sale(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.rpc_record_client_jewelry_sale(uuid, uuid, numeric, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public._goldia_consume_weight_sale_pieces(p_sale_id uuid, p_seller_id uuid, p_consignment_id uuid, p_grams numeric, p_org_id uuid, p_source text DEFAULT 'sale'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_left  numeric(14, 4) := round(coalesce(p_grams, 0)::numeric, 4);
  v_piece public.consignment_pieces%rowtype;
begin
  for v_piece in
    select cp.*
      from public.consignment_pieces cp
      join public.seller_consignments sc on sc.id = cp.consignment_id
     where cp.seller_id = p_seller_id and cp.organization_id = p_org_id
       and cp.status = 'held_by_seller' and cp.sale_id is null
       and sc.status in ('held_by_seller', 'partially_sold', 'fully_sold')
     order by (cp.consignment_id = p_consignment_id) desc nulls last, sc.created_at, cp.created_at, cp.id
     for update of cp
  loop
    exit when v_left <= 0.00005;
    -- 076: any remainder of a 4-decimal weight is >= 0.0001 g; before 076 a 0.0001 g remainder consumed the whole piece
    -- (held pieces lost 0.0001 g more than the gram stock)
    if v_piece.weight_grams - v_left > 0.00005 then
      update public.consignment_pieces
         set weight_grams = round((weight_grams - v_left)::numeric, 4), updated_at = now()
       where id = v_piece.id;
      insert into public.weight_sale_allocations (organization_id, sale_id, piece_id, consignment_id, grams,
        piece_weight_before, fully_consumed, source)
      values (p_org_id, p_sale_id, v_piece.id, v_piece.consignment_id, v_left, v_piece.weight_grams, false, p_source);
      update public.jewelry_sales set source_piece_id = coalesce(source_piece_id, v_piece.id) where id = p_sale_id;
      v_left := 0;
    else
      update public.consignment_pieces
         set status = 'sold', sale_id = p_sale_id, sold_at = now(), updated_at = now()
       where id = v_piece.id;
      insert into public.weight_sale_allocations (organization_id, sale_id, piece_id, consignment_id, grams,
        piece_weight_before, fully_consumed, source)
      values (p_org_id, p_sale_id, v_piece.id, v_piece.consignment_id, v_piece.weight_grams, v_piece.weight_grams, true, p_source);
      v_left := round(v_left - v_piece.weight_grams, 4);
    end if;
  end loop;

  -- Pieces may run out for consignments issued without pieces (pre-barcode); that weight stays unallocated.
  update public.seller_consignments sc
     set status = case when exists (select 1 from public.consignment_pieces p
                                     where p.consignment_id = sc.id and p.status = 'held_by_seller')
                       then 'partially_sold' else 'fully_sold' end,
         updated_at = now()
   where p_source = 'sale'
     and sc.id in (select consignment_id from public.weight_sale_allocations where sale_id = p_sale_id);
  return greatest(v_left, 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public._goldia_consume_selected_pieces(p_sale_id uuid, p_seller_id uuid, p_piece_ids uuid[], p_grams numeric, p_org_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_left  numeric(14, 4) := round(coalesce(p_grams, 0)::numeric, 4);
  v_piece public.consignment_pieces%rowtype;
  v_id    uuid;
begin
  foreach v_id in array p_piece_ids loop
    exit when v_left <= 0.00005;
    select * into v_piece from public.consignment_pieces
     where id = v_id and seller_id = p_seller_id and organization_id = p_org_id
       and status = 'held_by_seller' and sale_id is null
     for update;
    if not found then
      raise exception 'ERR_PIECE_NOT_AVAILABLE: Tanlangan dona (%) sotuvchida mavjud emas yoki allaqachon sotilgan', v_id;
    end if;
    -- 076: any remainder of a 4-decimal weight is >= 0.0001 g; before 076 a 0.0001 g remainder consumed the whole piece
    -- (held pieces lost 0.0001 g more than the gram stock)
    if v_piece.weight_grams - v_left > 0.00005 then
      update public.consignment_pieces
         set weight_grams = round((weight_grams - v_left)::numeric, 4), updated_at = now()
       where id = v_piece.id;
      insert into public.weight_sale_allocations (organization_id, sale_id, piece_id, consignment_id, grams,
        piece_weight_before, fully_consumed, source)
      values (p_org_id, p_sale_id, v_piece.id, v_piece.consignment_id, v_left, v_piece.weight_grams, false, 'sale');
      update public.jewelry_sales set source_piece_id = coalesce(source_piece_id, v_piece.id) where id = p_sale_id;
      v_left := 0;
    else
      update public.consignment_pieces
         set status = 'sold', sale_id = p_sale_id, sold_at = now(), updated_at = now()
       where id = v_piece.id;
      insert into public.weight_sale_allocations (organization_id, sale_id, piece_id, consignment_id, grams,
        piece_weight_before, fully_consumed, source)
      values (p_org_id, p_sale_id, v_piece.id, v_piece.consignment_id, v_piece.weight_grams, v_piece.weight_grams, true, 'sale');
      update public.jewelry_sales set source_piece_id = coalesce(source_piece_id, v_piece.id) where id = p_sale_id;
      v_left := round(v_left - v_piece.weight_grams, 4);
    end if;
  end loop;
  if v_left > 0.00005 then
    raise exception 'ERR_PIECES_TOO_LIGHT: Tanlangan donalar sotilayotgan vazndan yengil (yetishmaydi: % g)', v_left;
  end if;
  update public.seller_consignments sc
     set status = case when exists (select 1 from public.consignment_pieces p
                                     where p.consignment_id = sc.id and p.status = 'held_by_seller')
                       then 'partially_sold' else 'fully_sold' end,
         updated_at = now()
   where sc.id in (select consignment_id from public.weight_sale_allocations where sale_id = p_sale_id);
  return 0;
end;
$function$;
