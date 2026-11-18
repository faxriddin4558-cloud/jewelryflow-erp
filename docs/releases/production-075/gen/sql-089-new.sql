
-- ------------------------------------------------------------------ 1. old-sale return: one computation for preview and record
-- Reads only. p_customer_pct is required for a 585 (E) debt, p_credit_amount for a UZS / USD (F) debt; nothing is guessed.
create or replace function public._goldia_opening_return_calc(p_org uuid, p_customer uuid, p_unit text, p_weight numeric,
  p_customer_pct numeric, p_credit_amount numeric)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare
  v_unit   text := upper(btrim(coalesce(p_unit, '')));
  v_w      numeric(14, 4) := round(coalesce(p_weight, 0)::numeric, 4);
  v_doc    public.opening_documents%rowtype;
  v_credit numeric(18, 4);
  v_net    numeric(18, 4);
  v_debt   numeric(18, 4);
  v_adv    numeric(18, 4);
  v_rem    numeric(18, 4);
  v_open   numeric(18, 4);
  v_rel    numeric(14, 4) := 0;
  v_snap   numeric(14, 4);
  v_ret    record;
  v_leg    numeric(18, 4);
  v_contrib numeric(18, 4);
  v_keep   text;
  v_formula text;
begin
  if v_unit not in ('G585', 'UZS', 'USD') then raise exception 'Qarz birligi: G585 (585 gramm), UZS yoki USD' using errcode = '22023'; end if;
  if v_w <= 0 then raise exception 'Qaytarilgan vazn 0 dan katta bo''lishi shart' using errcode = '22023'; end if;
  -- the customer's opening debt of this unit in a LOCKED opening (the reference of the old sale - no sale is invented)
  select d.* into v_doc from public.opening_documents d join public.opening_periods p on p.id = d.opening_period_id
   where d.organization_id = p_org and d.customer_id = p_customer and d.status = 'active' and d.side = 'debt'
     and d.kind = case when v_unit = 'G585' then 'customer_gram' else 'customer_currency' end and d.unit = v_unit
     and p.status <> 'draft'
   order by d.created_at desc limit 1;
  if v_doc.id is null then
    raise exception 'ERR_NO_OPENING_DEBT: mijozning tasdiqlangan boshlang''ich % qarzi yo''q - eski savdodan vozvrat faqat boshlang''ich qarzga yoziladi', v_unit using errcode = '22023';
  end if;
  if v_doc.seller_id is null then raise exception 'Boshlang''ich qarz sotuvchiga biriktirilmagan' using errcode = '22023'; end if;
  select * into v_ret from public._goldia_opening_returned(v_doc.id);

  if v_unit = 'G585' then
    if p_customer_pct is null or p_customer_pct < 0 or p_customer_pct > 100 then
      raise exception 'ERR_PCT_REQUIRED: mijozga sotilgan asl foiz (0 - 100) kiritilishi shart - taxmin qilinmaydi' using errcode = '22023';
    end if;
    if p_credit_amount is not null then raise exception '585 qarz uchun qiymat serverda hisoblanadi (vazn x (1 + foiz))' using errcode = '22023'; end if;
    v_credit := round(v_w * (1 + p_customer_pct / 100.0), 4);
    select coalesce(current_debt_grams, 0) - coalesce(advance_balance_grams, 0) into v_net
      from public.client_gold_accounts where customer_id = p_customer and organization_id = p_org;
    -- what is left of the opening (old) 585 debt: the document minus earlier old returns, never more than the old
    -- (legacy) balance still open after reconciliations
    select coalesce(sum(delta_585_g), 0) into v_leg from public.client_legacy_debts
     where customer_id = p_customer and organization_id = p_org and balance_type = 'debt' and status <> 'reversed';
    v_rem := least(v_doc.amount - v_ret.amount, v_leg - v_ret.amount);
    v_formula := v_w || ' g x (1 + ' || p_customer_pct || ' %) = ' || v_credit || ' g (585)';
  else
    if p_credit_amount is null or p_credit_amount <= 0 then
      raise exception 'ERR_AMOUNT_REQUIRED: qaytarilgan tovarning asl % qiymati kiritilishi shart - kurs bilan taxmin qilinmaydi', v_unit using errcode = '22023';
    end if;
    if p_customer_pct is not null then raise exception '% qarz uchun foiz emas, asl summa kiritiladi', v_unit using errcode = '22023'; end if;
    v_credit := round(p_credit_amount::numeric, 2);
    select coalesce(debt_amount, 0) - coalesce(advance_amount, 0) into v_net
      from public.client_currency_accounts where customer_id = p_customer and organization_id = p_org and currency = v_unit;
    v_rem := v_doc.amount - coalesce((select sum(coalesce(c.opening_applied_amount, c.applied_to_debt)) from public.client_currency_settlements c
                                        where c.opening_document_id = v_doc.id and c.status <> 'reversed'), 0) - v_ret.amount;
    v_formula := v_credit || ' ' || v_unit || ' (asl qiymat)';
  end if;
  v_net := coalesce(v_net, 0);
  v_debt := least(v_credit, greatest(v_net, 0));
  v_adv := v_credit - v_debt;
  v_open := least(v_debt, greatest(coalesce(v_rem, 0), 0));
  if v_unit = 'G585' then
    -- the seller's OLD obligation of this debt, from the documents: what the E document's legacy row put into this
    -- seller's obligation (076 rule; 0 when the row is not booked on this seller), pro rata of the paid opening part
    select coalesce(sum(l.delta_585_g), 0) into v_contrib from public.client_legacy_debts l
     where l.id = v_doc.legacy_debt_id and l.seller_id = v_doc.seller_id and l.status <> 'reversed' and l.balance_type = 'debt';
    v_rel := case when v_open <= 0 or v_contrib <= 0 then 0 else round(v_open * least(v_contrib, v_doc.amount) / v_doc.amount, 4) end;
  elsif v_doc.equiv_585_g is not null and coalesce(v_doc.seller_obligation_g, 0) > 0 then
    -- rated F: the paid part's share of the document's rate snapshot (the whole rest when it pays the opening debt off)
    v_snap := greatest(0, v_doc.seller_obligation_g - coalesce((select sum(c.snapshot_released_g) from public.client_currency_settlements c
                where c.opening_document_id = v_doc.id and c.status <> 'reversed'), 0) - v_ret.released_g);
    v_rel := case when v_open <= 0 then 0 when v_open >= v_rem then v_snap
                  else least(v_snap, round(v_open * v_doc.seller_obligation_g / v_doc.amount, 4)) end;
  else
    v_rel := 0; -- unrated F: the unpaid opening debt was never in the seller's obligation
  end if;
  -- goods kept by the seller: his old obligation moves unchanged from the opening debt onto the returned goods - allowed
  -- only when the whole value is covered by the documented opening obligation (no advance, no part without obligation)
  v_keep := case when v_rel <= 0 then 'hujjatda bu qarz bo''yicha sotuvchi majburiyati yo''q (kurssiz qarz yoki sotuvchiga yozilmagan)'
                 when v_adv > 0 or v_open < v_credit then 'qiymatning ' || (v_credit - v_open) || ' qismi ochiq boshlang''ich qarzdan tashqarida (avans / to''langan qism) - uning sotuvchi majburiyati hujjatda yo''q'
            end;
  v_formula := v_formula || '; qarzdan ' || v_debt || ', avansga ' || v_adv
               || '; boshlang''ich qarz qismi ' || v_open || '; hujjatdagi eski sotuvchi majburiyati ' || v_rel || ' g';
  return jsonb_build_object('opening_document_id', v_doc.id, 'opening_document_no', v_doc.document_no, 'seller_id', v_doc.seller_id,
    'unit', v_unit, 'weight_g', v_w, 'customer_pct', p_customer_pct, 'credit', v_credit, 'customer_net_before', v_net,
    'debt_reduced', v_debt, 'advance_created', v_adv, 'customer_net_after', v_net - v_credit,
    'opening_remaining', v_rem, 'opening_part', v_open, 'seller_obligation_released_g', v_rel, 'old_obligation_g', v_rel,
    'seller_keep_allowed', v_keep is null, 'seller_keep_refusal', v_keep,
    'rated', (v_unit = 'G585' or v_doc.equiv_585_g is not null), 'formula', v_formula);
end $f$;
revoke all on function public._goldia_opening_return_calc(uuid, uuid, text, numeric, numeric, numeric) from public, anon, authenticated;

-- preview (read only): exactly what the record would do, so the operator confirms the numbers before writing
create or replace function public.rpc_preview_opening_sale_return(p_customer_id uuid, p_unit text, p_weight_grams numeric,
  p_customer_markup_pct numeric default null, p_credit_amount numeric default null, p_receiver text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare v_org uuid := public.current_organization_id(); v_c jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if not exists (select 1 from public.customers where id = p_customer_id and organization_id = v_org) then raise exception 'Mijoz topilmadi'; end if;
  v_c := public._goldia_opening_return_calc(v_org, p_customer_id, p_unit, p_weight_grams, p_customer_markup_pct, p_credit_amount);
  -- the seller's obligation: unchanged when he keeps the goods (old obligation moves onto them), minus the old
  -- obligation when the manager takes them
  return v_c || jsonb_build_object('receiver', lower(p_receiver),
    'seller_obligation_change_g', case lower(coalesce(p_receiver, '')) when 'seller' then 0 when 'manager' then -(v_c ->> 'old_obligation_g')::numeric end);
end $f$;
revoke all on function public.rpc_preview_opening_sale_return(uuid, text, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.rpc_preview_opening_sale_return(uuid, text, numeric, numeric, numeric, text) to authenticated, service_role;

create or replace function public.rpc_record_opening_sale_return(
  p_customer_id          uuid,
  p_unit                 text,
  p_weight_grams         numeric,
  p_customer_markup_pct  numeric,
  p_credit_amount        numeric,
  p_receiver             text,
  p_seller_markup_pct    numeric,
  p_reason               text,
  p_confirmed            boolean,
  p_idempotency_key      text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_emp      uuid := public.current_employee_id();
  v_key      text := nullif(btrim(p_idempotency_key), '');
  v_reason   text := nullif(btrim(p_reason), '');
  v_recv     text := lower(btrim(coalesce(p_receiver, '')));
  v_unit     text := upper(btrim(coalesce(p_unit, '')));
  v_spct     numeric(6, 2);
  v_c        jsonb;
  v_cust     public.customers%rowtype;
  v_seller   uuid;
  v_credit   numeric(18, 4);
  v_w        numeric(14, 4);
  v_net_after numeric(18, 4);
  v_id       uuid := gen_random_uuid();
  v_no       text;
  v_con_id   uuid;
  v_piece_id uuid;
  v_sobl     numeric(14, 4);
  v_mgr      jsonb;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  -- a lower old debt lowers the seller's own obligation: only the manager / director (076 rule)
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_key is null then raise exception 'Vozvrat uchun takrorlanmas so''rov kaliti (idempotency key) majburiy'; end if;
  if v_reason is null then raise exception 'Vozvrat sababi kiritilishi shart'; end if;
  if v_recv not in ('seller', 'manager') then raise exception 'Qabul qiluvchi: seller (sotuvchi javoni) yoki manager (menejer ombori)'; end if;
  if p_confirmed is distinct from true then
    raise exception 'ERR_CONFIRM_REQUIRED: avval hisob-kitobni (rpc_preview_opening_sale_return) ko''rib tasdiqlang' using errcode = '22023';
  end if;
  -- the seller's obligation for the returned goods is taken from the documents (never from an entered %)
  if p_seller_markup_pct is not null then
    raise exception 'ERR_SELLER_PCT_NOT_USED: sotuvchi foizi kiritilmaydi - eski majburiyat hujjatdan olinadi' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object('action', 'record_opening_sale_return', 'customer_id', p_customer_id, 'unit', v_unit,
    'weight_grams', p_weight_grams, 'customer_pct', p_customer_markup_pct, 'credit_amount', p_credit_amount,
    'receiver', v_recv, 'seller_pct', p_seller_markup_pct);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_record_opening_sale_return', v_payload);
  if v_existing is not null then return v_existing; end if;

  select * into v_cust from public.customers where id = p_customer_id and organization_id = v_org for update;
  if v_cust.id is null then raise exception 'Mijoz topilmadi'; end if;
  if v_unit = 'G585' then
    perform 1 from public.client_gold_accounts where customer_id = v_cust.id and organization_id = v_org for update;
  else
    perform 1 from public.client_currency_accounts where customer_id = v_cust.id and organization_id = v_org and currency = v_unit for update;
  end if;
  v_c := public._goldia_opening_return_calc(v_org, v_cust.id, v_unit, p_weight_grams, p_customer_markup_pct, p_credit_amount);
  v_seller := (v_c ->> 'seller_id')::uuid;
  if v_recv = 'seller' and not (v_c ->> 'seller_keep_allowed')::boolean then
    raise exception 'ERR_SELLER_KEEP_NOT_DOCUMENTED: tovarni sotuvchida qoldirib bo''lmaydi: % - menejer omboriga qabul qiling', v_c ->> 'seller_keep_refusal' using errcode = '22023';
  end if;
  v_credit := (v_c ->> 'credit')::numeric;
  v_w := (v_c ->> 'weight_g')::numeric;
  v_net_after := (v_c ->> 'customer_net_after')::numeric;
  perform 1 from public.opening_documents where id = (v_c ->> 'opening_document_id')::uuid for update;
  if not exists (select 1 from public.employees e where e.id = v_seller and e.organization_id = v_org) then
    raise exception 'Boshlang''ich qarz sotuvchisi topilmadi';
  end if;
  perform 1 from public.seller_gold_accounts where seller_id = v_seller for update;

  -- the customer: the value lowers the debt, the rest is an advance (083)
  if v_unit = 'G585' then
    insert into public.client_gold_accounts (customer_id, organization_id, seller_id, total_purchased_gold_grams, total_scrap_paid_grams,
      total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams, current_debt_grams, advance_balance_grams, updated_at)
    values (v_cust.id, v_org, v_seller, 0, 0, 0, 0, 0, greatest(v_net_after, 0), greatest(-v_net_after, 0), now())
    on conflict (customer_id) do update set current_debt_grams = round(greatest(v_net_after, 0), 4),
      advance_balance_grams = round(greatest(-v_net_after, 0), 4), updated_at = now();
  else
    perform public._goldia_currency_account_add(v_org, v_cust.id, v_seller, v_unit, -v_credit);
  end if;

  -- the goods: a return lot on the seller (no factory receipt, no factory obligation)
  v_no := 'OSR-' || to_char(public._goldia_business_date(), 'YYYYMMDD') || '-' || upper(substr(replace(v_id::text, '-', ''), 1, 6));
  if v_recv = 'seller' then
    -- the old obligation (documents) moves unchanged onto the returned goods: released from the opening debt below, the
    -- same grams on the lot - the seller's total obligation does not change; a later sale / return uses these grams
    v_sobl := (v_c ->> 'old_obligation_g')::numeric;
    v_spct := round((v_sobl / v_w - 1) * 100, 2); -- display only (the obligation itself is v_sobl)
    if v_spct < 0 or v_spct > 100 then v_spct := null; end if;
  else
    -- straight on to the manager: the lot's obligation is added and removed again (net 0); the seller loses his old one
    v_sobl := v_w; v_spct := 0;
  end if;
  insert into public.seller_consignments (organization_id, consignment_no, seller_id, factory_receipt_id, product_name, quantity,
    base_weight_grams, proba, factory_markup_pct, factory_gold_due_grams, factory_remaining_gold_grams, seller_markup_pct,
    seller_obligation_g, status, notes, issued_at)
  -- factory_gold_due_grams must be > 0 (table check): grams x (1 + 0 %) for display only - there is no factory receipt, the
  -- factory account (vault) is not touched; the seller's obligation is seller_obligation_g
  values (v_org, 'CONS-' || v_no, v_seller, null, 'Eski savdodan vozvrat', 1, v_w, 585, 0, v_w, v_w, coalesce(v_spct, 0), v_sobl, 'held_by_seller',
    'ESKI SAVDODAN VOZVRAT ' || v_no || ' (' || (v_c ->> 'opening_document_no') || ')', clock_timestamp())
  returning id into v_con_id;
  insert into public.consignment_pieces (organization_id, consignment_id, model_code, model_name, category, purity, proba, weight_grams,
    status, seller_id, seller_markup_pct, seller_obligation_grams, notes)
  values (v_org, v_con_id, 'VOZVRAT', 'Eski savdodan vozvrat', 'Buyum', 585, 585, v_w, 'held_by_seller', v_seller, coalesce(v_spct, 0), v_sobl,
    'ESKI SAVDODAN VOZVRAT ' || v_no)
  returning id into v_piece_id;

  insert into public.opening_sale_returns (id, organization_id, return_no, opening_document_id, customer_id, seller_id, unit,
    returned_weight_grams, customer_markup_pct, credit_amount, debt_reduced, advance_created, opening_part, seller_obligation_released_g,
    receiver, receiver_seller_markup_pct, seller_lot_obligation_g, consignment_id, piece_id, customer_net_before, customer_net_after, formula, reason,
    idempotency_key, created_by)
  values (v_id, v_org, v_no, (v_c ->> 'opening_document_id')::uuid, v_cust.id, v_seller, v_unit, v_w,
    case when v_unit = 'G585' then round(p_customer_markup_pct::numeric, 2) end, v_credit, (v_c ->> 'debt_reduced')::numeric,
    (v_c ->> 'advance_created')::numeric, (v_c ->> 'opening_part')::numeric, (v_c ->> 'seller_obligation_released_g')::numeric,
    v_recv, case when v_recv = 'seller' then v_spct end, case when v_recv = 'seller' then v_sobl else 0 end, v_con_id, v_piece_id, (v_c ->> 'customer_net_before')::numeric, v_net_after,
    (v_c ->> 'formula') || case when v_recv = 'seller' then '; sotuvchida qoldi: eski majburiyat ' || v_sobl || ' g tovarga o''tdi (sotuvchi majburiyati o''zgarmadi)'
                                else '; menejer omboriga ' || v_w || ' g; sotuvchi majburiyati -' || (v_c ->> 'old_obligation_g') || ' g' end,
    v_reason, v_key, v_emp);
  perform public.recalc_seller_gold_account(v_seller, v_org);
  if v_recv = 'manager' then
    v_mgr := public.rpc_return_piece_to_manager(v_piece_id, 'ESKI SAVDODAN VOZVRAT ' || v_no || ' - menejer qabul qildi', null);
  end if;

  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'opening_sale_returns', v_id::text, 'RECORD_OPENING_SALE_RETURN', auth.uid(),
    jsonb_build_object('customer_net_before', v_c -> 'customer_net_before', 'opening_document_id', v_c -> 'opening_document_id'),
    v_c || jsonb_build_object('return_no', v_no, 'receiver', v_recv, 'seller_pct', v_spct, 'consignment_id', v_con_id, 'piece_id', v_piece_id),
    v_reason);
  v_res := v_c || jsonb_build_object('status', 'ok', 'return_id', v_id, 'return_no', v_no, 'receiver', v_recv,
    'consignment_id', v_con_id, 'piece_id', v_piece_id, 'seller_goods_obligation_g', case when v_recv = 'seller' then v_sobl else 0 end,
    'seller_obligation_change_g', case when v_recv = 'seller' then 0 else -(v_c ->> 'old_obligation_g')::numeric end,
    'manager', v_mgr);
  perform public.save_idempotency_response(v_key, 'rpc_record_opening_sale_return', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_record_opening_sale_return(uuid, text, numeric, numeric, numeric, text, numeric, text, boolean, text) from public, anon;
grant execute on function public.rpc_record_opening_sale_return(uuid, text, numeric, numeric, numeric, text, numeric, text, boolean, text) to authenticated, service_role;

create or replace function public.rpc_reverse_opening_sale_return(p_return_id uuid, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_key      text := nullif(btrim(p_idempotency_key), '');
  v_reason   text := nullif(btrim(p_reason), '');
  v_r        public.opening_sale_returns%rowtype;
  v_p        public.consignment_pieces%rowtype;
  v_k        public.seller_consignments%rowtype;
  v_net      numeric(18, 4);
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_key is null then raise exception 'Takrorlanmas so''rov kaliti (idempotency key) majburiy'; end if;
  if v_reason is null then raise exception 'Bekor qilish sababi kiritilishi shart'; end if;
  v_payload := jsonb_build_object('action', 'reverse_opening_sale_return', 'return_id', p_return_id);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_reverse_opening_sale_return', v_payload);
  if v_existing is not null then return v_existing; end if;
  select * into v_r from public.opening_sale_returns where id = p_return_id and organization_id = v_org for update;
  if v_r.id is null then raise exception 'Eski savdo vozvrati topilmadi'; end if;
  if v_r.status <> 'confirmed' then raise exception 'Vozvrat allaqachon bekor qilingan (%)', v_r.return_no; end if;
  select * into v_p from public.consignment_pieces where id = v_r.piece_id for update;
  select * into v_k from public.seller_consignments where id = v_r.consignment_id for update;
  -- only while the returned goods are untouched (not sold, not moved on, not given to another seller)
  if v_r.receiver = 'seller' and (v_p.status <> 'held_by_seller' or v_k.status <> 'held_by_seller' or v_p.sale_id is not null) then
    raise exception 'ERR_RETURN_GOODS_USED: qaytarilgan tovar sotilgan yoki ko''chirilgan (%) - vozvratni bekor qilib bo''lmaydi', v_p.status using errcode = '55000';
  end if;
  if v_r.receiver = 'manager' and v_p.status <> 'returned_to_manager' then
    raise exception 'ERR_RETURN_GOODS_USED: menejerdagi qaytarilgan tovar ishlatilgan (%) - vozvratni bekor qilib bo''lmaydi', v_p.status using errcode = '55000';
  end if;
  update public.consignment_pieces set status = 'cancelled', updated_at = clock_timestamp() where id = v_p.id;
  update public.seller_consignments set status = 'cancelled', cancelled_at = clock_timestamp(), updated_at = clock_timestamp() where id = v_k.id;
  if v_r.unit = 'G585' then
    select coalesce(current_debt_grams, 0) - coalesce(advance_balance_grams, 0) into v_net
      from public.client_gold_accounts where customer_id = v_r.customer_id and organization_id = v_org for update;
    v_net := coalesce(v_net, 0) + v_r.credit_amount;
    update public.client_gold_accounts set current_debt_grams = round(greatest(v_net, 0), 4), advance_balance_grams = round(greatest(-v_net, 0), 4),
           updated_at = now() where customer_id = v_r.customer_id and organization_id = v_org;
  else
    perform public._goldia_currency_account_add(v_org, v_r.customer_id, v_r.seller_id, v_r.unit, v_r.credit_amount);
  end if;
  update public.opening_sale_returns set status = 'reversed', reversed_at = clock_timestamp(), reversed_by = public.current_employee_id(),
         reversal_reason = v_reason where id = v_r.id;
  perform public.recalc_seller_gold_account(v_r.seller_id, v_org);
  update public.manager_vault_account set manager_physical_stock_g = public.get_manager_available_stock_grams(v_org), updated_at = now()
   where organization_id = v_org;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'opening_sale_returns', v_r.id::text, 'REVERSE_OPENING_SALE_RETURN', auth.uid(),
    jsonb_build_object('status', 'confirmed', 'credit_amount', v_r.credit_amount, 'unit', v_r.unit, 'released_g', v_r.seller_obligation_released_g),
    jsonb_build_object('status', 'reversed'), v_reason);
  v_res := jsonb_build_object('status', 'ok', 'return_id', v_r.id, 'return_no', v_r.return_no, 'restored_credit', v_r.credit_amount, 'unit', v_r.unit);
  perform public.save_idempotency_response(v_key, 'rpc_reverse_opening_sale_return', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_reverse_opening_sale_return(uuid, text, text) from public, anon;
grant execute on function public.rpc_reverse_opening_sale_return(uuid, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ 3. a payment in the wrong currency: reverse + re-enter at once
-- p_kind / p_new_kind: 'SETTL' (585 gram debt, rpc_record_client_settlement) or 'CPAY' (UZS / USD debt,
-- rpc_record_client_currency_settlement). p_new holds the corrected amounts (same customer, same seller). Every check of
-- the existing reversal and record functions applies; if any step fails nothing is written.
create or replace function public.rpc_correct_client_payment(p_kind text, p_payment_id uuid, p_new_kind text, p_new jsonb,
  p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_kind     text := upper(btrim(coalesce(p_kind, '')));
  v_new_kind text := upper(btrim(coalesce(p_new_kind, '')));
  v_key      text := nullif(btrim(p_idempotency_key), '');
  v_reason   text := nullif(btrim(p_reason), '');
  v_n        jsonb := coalesce(p_new, '{}'::jsonb);
  v_cust     uuid;
  v_seller   uuid;
  v_old_no   text;
  v_rev      jsonb;
  v_new      jsonb;
  v_new_id   uuid;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  if v_key is null then raise exception 'Takrorlanmas so''rov kaliti (idempotency key) majburiy'; end if;
  if v_reason is null then raise exception 'Tuzatish sababi kiritilishi shart'; end if;
  if v_kind not in ('SETTL', 'CPAY') or v_new_kind not in ('SETTL', 'CPAY') then raise exception 'To''lov turi: SETTL yoki CPAY'; end if;
  v_payload := jsonb_build_object('action', 'correct_client_payment', 'kind', v_kind, 'payment_id', p_payment_id, 'new_kind', v_new_kind, 'new', v_n);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_correct_client_payment', v_payload);
  if v_existing is not null then return v_existing; end if;
  if v_kind = 'SETTL' then
    select customer_id, seller_id, coalesce(settlement_no, id::text) into v_cust, v_seller, v_old_no from public.gold_settlements
     where id = p_payment_id and organization_id = v_org and direction = 'client_to_seller' and coalesce(status, 'confirmed') not in ('reversed', 'cancelled');
  else
    select customer_id, seller_id, settlement_no into v_cust, v_seller, v_old_no from public.client_currency_settlements
     where id = p_payment_id and organization_id = v_org and status <> 'reversed';
  end if;
  if v_cust is null then raise exception 'Tuzatiladigan to''lov topilmadi yoki allaqachon bekor qilingan'; end if;
  -- 1. the existing reversal (its own permission, pool-order and freeze checks)
  if v_kind = 'SETTL' then
    v_rev := public.rpc_reverse_client_settlement(p_payment_id, 'VALYUTA TUZATISH: ' || v_reason, v_key || ':rev');
  else
    v_rev := public.rpc_reverse_client_currency_settlement(p_payment_id, 'VALYUTA TUZATISH: ' || v_reason, v_key || ':rev');
  end if;
  -- 2. the same payment entered again in the right currency / dialog
  if v_new_kind = 'SETTL' then
    v_new := public.rpc_record_client_settlement(p_customer_id := v_cust,
      p_scrap_weight := coalesce((v_n ->> 'scrap_weight')::numeric, 0), p_scrap_proba := (v_n ->> 'scrap_proba')::numeric,
      p_cash_amount := coalesce((v_n ->> 'cash_uzs')::numeric, 0), p_rate_per_gram := (v_n ->> 'lom_rate')::numeric,
      p_notes := concat_ws(' | ', 'TUZATISH ' || v_old_no, v_n ->> 'notes'), p_idempotency_key := v_key || ':new',
      p_seller_id := v_seller, p_usd_amount := coalesce((v_n ->> 'usd_amount')::numeric, 0), p_usd_rate := (v_n ->> 'usd_rate')::numeric);
  else
    v_new := public.rpc_record_client_currency_settlement(p_customer_id := v_cust, p_currency := v_n ->> 'currency',
      p_cash_uzs := coalesce((v_n ->> 'cash_uzs')::numeric, 0), p_usd_amount := coalesce((v_n ->> 'usd_amount')::numeric, 0),
      p_scrap_weight := coalesce((v_n ->> 'scrap_weight')::numeric, 0), p_scrap_proba := (v_n ->> 'scrap_proba')::numeric,
      p_usd_rate := (v_n ->> 'usd_rate')::numeric, p_lom_rate := (v_n ->> 'lom_rate')::numeric, p_seller_id := v_seller,
      p_notes := concat_ws(' | ', 'TUZATISH ' || v_old_no, v_n ->> 'notes'), p_idempotency_key := v_key || ':new');
  end if;
  v_new_id := coalesce((v_new ->> 'settlement_id')::uuid, (v_new ->> 'id')::uuid);
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, case v_kind when 'SETTL' then 'gold_settlements' else 'client_currency_settlements' end, p_payment_id::text,
    'CORRECT_CLIENT_PAYMENT', auth.uid(), jsonb_build_object('kind', v_kind, 'payment_id', p_payment_id, 'payment_no', v_old_no),
    jsonb_build_object('new_kind', v_new_kind, 'new_payment_id', v_new_id, 'new', v_n), v_reason);
  v_res := jsonb_build_object('status', 'ok', 'reversed_payment_id', p_payment_id, 'reversed', v_rev, 'new_kind', v_new_kind,
    'new_payment_id', v_new_id, 'new', v_new);
  perform public.save_idempotency_response(v_key, 'rpc_correct_client_payment', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_correct_client_payment(text, uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.rpc_correct_client_payment(text, uuid, text, jsonb, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ 4. seller till count (record only)
create or replace function public.rpc_record_seller_till_count(p_seller_id uuid, p_counted_uzs numeric, p_counted_usd numeric,
  p_explanation text, p_notes text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_key      text := nullif(btrim(p_idempotency_key), '');
  v_cu       numeric(18, 2) := round(coalesce(p_counted_uzs, -1)::numeric, 2);
  v_cd       numeric(18, 2) := round(coalesce(p_counted_usd, -1)::numeric, 2);
  v_eu       numeric(18, 2);
  v_ed       numeric(18, 2);
  v_exp      text := lower(btrim(coalesce(p_explanation, '')));
  v_id       uuid;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_key is null then raise exception 'Takrorlanmas so''rov kaliti (idempotency key) majburiy'; end if;
  if v_cu < 0 or v_cd < 0 then raise exception 'Sanalgan so''m va dollar (0 yoki undan katta) kiritilishi shart' using errcode = '22023'; end if;
  if not exists (select 1 from public.employees e where e.id = p_seller_id and e.organization_id = v_org and public._goldia_is_seller_role(e.role::text)) then
    raise exception 'Sotuvchi topilmadi (shu tashkilot sotuvchisi)';
  end if;
  v_payload := jsonb_build_object('action', 'record_seller_till_count', 'seller_id', p_seller_id, 'uzs', v_cu, 'usd', v_cd, 'explanation', v_exp);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_record_seller_till_count', v_payload);
  if v_existing is not null then return v_existing; end if;
  select coalesce(seller_till_cash_amount, 0), coalesce(seller_till_usd_amount, 0) into v_eu, v_ed
    from public.seller_gold_accounts where seller_id = p_seller_id and organization_id = v_org for share;
  v_eu := coalesce(v_eu, 0); v_ed := coalesce(v_ed, 0);
  if v_cu = v_eu and v_cd = v_ed then v_exp := 'match';
  elsif v_cu < v_eu or v_cd < v_ed then
    if v_exp not in ('personal_use', 'shortage') then
      raise exception 'ERR_EXPLANATION_REQUIRED: kassada kam pul - sababini tanlang: personal_use (shaxsiy ishlatilgan) yoki shortage (yetishmovchilik)' using errcode = '22023';
    end if;
  else v_exp := 'surplus';
  end if;
  if v_exp <> 'match' and nullif(btrim(p_notes), '') is null then raise exception 'Farq bor: izoh kiritilishi shart' using errcode = '22023'; end if;
  insert into public.seller_till_counts (organization_id, seller_id, counted_uzs, counted_usd, expected_uzs, expected_usd, diff_uzs, diff_usd,
    explanation, notes, idempotency_key, created_by)
  values (v_org, p_seller_id, v_cu, v_cd, v_eu, v_ed, v_cu - v_eu, v_cd - v_ed, v_exp, nullif(btrim(p_notes), ''), v_key, public.current_employee_id())
  returning id into v_id;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, new_data, reason)
  values (v_org, 'seller_till_counts', v_id::text, 'RECORD_SELLER_TILL_COUNT', auth.uid(),
    jsonb_build_object('seller_id', p_seller_id, 'counted_uzs', v_cu, 'counted_usd', v_cd, 'expected_uzs', v_eu, 'expected_usd', v_ed,
                       'diff_uzs', v_cu - v_eu, 'diff_usd', v_cd - v_ed, 'explanation', v_exp), nullif(btrim(p_notes), ''));
  v_res := jsonb_build_object('status', 'ok', 'count_id', v_id, 'expected_uzs', v_eu, 'expected_usd', v_ed, 'counted_uzs', v_cu,
    'counted_usd', v_cd, 'diff_uzs', v_cu - v_eu, 'diff_usd', v_cd - v_ed, 'explanation', v_exp);
  perform public.save_idempotency_response(v_key, 'rpc_record_seller_till_count', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_record_seller_till_count(uuid, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.rpc_record_seller_till_count(uuid, numeric, numeric, text, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ 5. stock movements (read only)
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
    union all
    select p.seller_id, public._goldia_business_date(p.returned_to_manager_at), p.returned_to_manager_at, 'return_to_manager',
           coalesce(p.raw_barcode, p.model_code), -p.weight_grams, p.id
      from public.consignment_pieces p where p.organization_id = v_org and p.returned_to_manager_at is not null
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
revoke all on function public.rpc_get_seller_stock_movements(uuid, date, date) from public, anon;
grant execute on function public.rpc_get_seller_stock_movements(uuid, date, date) to authenticated, service_role;
