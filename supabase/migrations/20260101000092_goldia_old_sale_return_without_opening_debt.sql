-- 092 - Goldia Sales (2026-11-19), on top of 091: old-sale return (089) without an opening debt.
-- Rule (owner): the 585 value of the returned goods first lowers THIS customer's old (opening) debt, then his new debt,
-- the rest becomes his advance; an old debt of 0 (or no opening debt document at all) does not block the return.
-- 089 already applied that order when an opening debt document existed (opening_part -> rest of the debt -> advance);
-- it refused the return when the customer had no opening debt document of that unit (ERR_NO_OPENING_DEBT). 092:
--   * no opening debt document: old part 0, the value goes to the new debt, the rest to the advance; the goods belong
--     to the customer's own seller and, without a documented old obligation, go to the manager (seller keep refused -
--     no obligation is invented); the seller's obligation does not change;
--   * opening_sale_returns.new_debt_part (stored, = debt_reduced - opening_part): old / new / advance parts are kept apart;
--   * the customer ledger shows the parts where they belong (old column - old part only; sales - new part; advance part
--     on the paid side): the net balance is exactly the same as before, only the split is right.
-- No business row changes; opening documents (LOCK) untouched.
alter table public.opening_sale_returns alter column opening_document_id drop not null;
alter table public.opening_sale_returns add column if not exists new_debt_part numeric(18, 4) generated always as (debt_reduced - opening_part) stored;

-- ===== _goldia_opening_return_calc (from 20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql)
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
  v_seller  uuid;           -- 092: the opening document's seller, or (no document) the customer's own seller
  v_ret_amt numeric(18, 4) := 0;
  v_ret_rel numeric(14, 4) := 0;
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
    -- 092: no (confirmed) opening debt of this unit does NOT block the return: old part 0, the value lowers the new debt,
    -- the rest becomes an advance; the goods are the customer's own seller's
    select c.seller_id into v_seller from public.customers c where c.id = p_customer and c.organization_id = p_org;
    if v_seller is null then raise exception 'ERR_CUSTOMER_NO_SELLER: mijozga sotuvchi biriktirilmagan' using errcode = '22023'; end if;
  else
    if v_doc.seller_id is null then raise exception 'Boshlang''ich qarz sotuvchiga biriktirilmagan' using errcode = '22023'; end if;
    v_seller := v_doc.seller_id;
    select * into v_ret from public._goldia_opening_returned(v_doc.id);
    v_ret_amt := coalesce(v_ret.amount, 0); v_ret_rel := coalesce(v_ret.released_g, 0);
  end if;

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
    v_rem := case when v_doc.id is null then 0 else least(v_doc.amount - v_ret_amt, v_leg - v_ret_amt) end;
    v_formula := v_w || ' g x (1 + ' || p_customer_pct || ' %) = ' || v_credit || ' g (585)';
  else
    if p_credit_amount is null or p_credit_amount <= 0 then
      raise exception 'ERR_AMOUNT_REQUIRED: qaytarilgan tovarning asl % qiymati kiritilishi shart - kurs bilan taxmin qilinmaydi', v_unit using errcode = '22023';
    end if;
    if p_customer_pct is not null then raise exception '% qarz uchun foiz emas, asl summa kiritiladi', v_unit using errcode = '22023'; end if;
    v_credit := round(p_credit_amount::numeric, 2);
    select coalesce(debt_amount, 0) - coalesce(advance_amount, 0) into v_net
      from public.client_currency_accounts where customer_id = p_customer and organization_id = p_org and currency = v_unit;
    v_rem := case when v_doc.id is null then 0 else
             v_doc.amount - coalesce((select sum(coalesce(c.opening_applied_amount, c.applied_to_debt)) from public.client_currency_settlements c
                                        where c.opening_document_id = v_doc.id and c.status <> 'reversed'), 0) - v_ret_amt end;
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
                where c.opening_document_id = v_doc.id and c.status <> 'reversed'), 0) - v_ret_rel);
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
               || '; eski (boshlang''ich) qarzdan ' || v_open || ', yangi qarzdan ' || (v_debt - v_open)
               || case when v_doc.id is null then ' (boshlang''ich qarz hujjati yo''q)' else '' end
               || '; hujjatdagi eski sotuvchi majburiyati ' || v_rel || ' g';
  return jsonb_build_object('opening_document_id', v_doc.id, 'opening_document_no', v_doc.document_no, 'seller_id', v_seller,
    'unit', v_unit, 'weight_g', v_w, 'customer_pct', p_customer_pct, 'credit', v_credit, 'customer_net_before', v_net,
    'debt_reduced', v_debt, 'advance_created', v_adv, 'customer_net_after', v_net - v_credit,
    'opening_remaining', v_rem, 'opening_part', v_open, 'new_debt_part', v_debt - v_open, 'has_opening_document', v_doc.id is not null, 'seller_obligation_released_g', v_rel, 'old_obligation_g', v_rel,
    'seller_keep_allowed', v_keep is null, 'seller_keep_refusal', v_keep,
    'rated', (v_unit = 'G585' or v_doc.equiv_585_g is not null), 'formula', v_formula);
end $f$;

-- ===== rpc_record_opening_sale_return (from 20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql)
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
    'ESKI SAVDODAN VOZVRAT ' || v_no || ' (' || coalesce(v_c ->> 'opening_document_no', 'boshlang''ich qarz hujjatisiz') || ')', clock_timestamp())
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

-- ===== rpc_get_unified_customer_ledger (from 20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql)
CREATE OR REPLACE FUNCTION public.rpc_get_unified_customer_ledger(p_customer_id uuid DEFAULT NULL::uuid, p_seller_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org     uuid := public.current_organization_id();
  v_caller_role    text := public.current_employee_role_text();
  v_caller_emp_id  uuid := public.current_employee_id();
  v_filter_seller  uuid;
  v_cust_rec       record;
  v_gross_sales    numeric(14, 4);
  v_legacy_debt    numeric(14, 4);
  v_paid_scrap     numeric(14, 4);
  v_paid_cash_g    numeric(14, 4);
  v_paid_cash_uzs  numeric(18, 2);
  v_paid_usd_g     numeric(14, 4);
  v_paid_usd       numeric(18, 2);
  v_total_settled_sum numeric(14, 4);
  v_total_paid     numeric(14, 4);
  v_gross_debt     numeric(14, 4);
  v_net_debt       numeric(14, 4);
  v_avail_adv      numeric(14, 4);
  v_applied_adv    numeric(14, 4);
  v_tot_gross      numeric(14, 4) := 0;
  v_tot_paid       numeric(14, 4) := 0;
  v_tot_net        numeric(14, 4) := 0;
  v_tot_adv        numeric(14, 4) := 0;
  v_tot_cash_uzs   numeric(18, 2) := 0;
  v_tot_usd        numeric(18, 2) := 0;
  v_rows           jsonb := '[]'::jsonb;
  v_old_ret_g      numeric(14, 4);
  v_ret_old        numeric(14, 4);
  v_ret_new        numeric(14, 4);
  v_ret_adv        numeric(14, 4);
  v_cur            jsonb;
begin
  -- 069: a signed-in, active employee of this organization is required (no fallbacks)
  if auth.uid() is null then
    raise exception 'Permission denied: authentication required' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi']);
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_caller_role in ('seller', 'sotuvchi', 'sales') then
    if p_seller_id is not null and p_seller_id <> v_caller_emp_id then
      raise exception 'Cross-seller violation: Sotuvchilar faqat o''z mijozlarini ko''ra oladi' using errcode = '42501';
    end if;
    v_filter_seller := v_caller_emp_id;

    if p_customer_id is not null then
      if not exists (
        select 1 from public.customers
        where id = p_customer_id
          and organization_id = v_caller_org
          and (seller_id = v_caller_emp_id or seller_id is null)
      ) then
        raise exception 'Cross-seller violation: Ushbu mijoz sizga biriktirilmagan' using errcode = '42501';
      end if;
    end if;
  else
    v_filter_seller := p_seller_id;
  end if;

  for v_cust_rec in
    select c.id, c.customer_code, c.contact_name, c.phone, c.company_name, c.seller_id,
           coalesce(e.full_name, e.name, 'Biriktirilmagan') as seller_name
    from public.customers c
    left join public.employees e on e.id = c.seller_id
    where c.organization_id = v_caller_org
      and (p_customer_id is null or c.id = p_customer_id)
      and (v_filter_seller is null or c.seller_id = v_filter_seller)
    order by c.contact_name asc
  loop
    -- 1. Total Unreversed Gross Sales Due
    select coalesce(sum(client_gold_due_grams), 0)
    into v_gross_sales
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';
    -- 083: minus the 585 value of confirmed partial / full returns
    v_gross_sales := round(v_gross_sales - coalesce((select sum(client_gold_due_returned_g) from public.jewelry_sale_returns
                       where customer_id = v_cust_rec.id and organization_id = v_caller_org and status = 'confirmed'), 0), 4);

    -- 2. Total Unreversed Legacy Debt / Advance (Signed Delta Sum)
    select coalesce(sum(delta_585_g), 0)
    into v_legacy_debt
    from public.client_legacy_debts
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';
    -- 089: an old-sale return (pre-T0 goods) lowers the opening (old) 585 balance by its value
    -- 092: as booked - the old part off the old balance, the new-debt part off the sales, the advance part on the paid
    --      side below (the net is unchanged; the old column never shows more than was really old)
    select coalesce(sum(credit_amount), 0), coalesce(sum(opening_part), 0), coalesce(sum(new_debt_part), 0), coalesce(sum(advance_created), 0)
      into v_old_ret_g, v_ret_old, v_ret_new, v_ret_adv from public.opening_sale_returns
     where customer_id = v_cust_rec.id and organization_id = v_caller_org and status = 'confirmed' and unit = 'G585';
    v_legacy_debt := round(v_legacy_debt - v_ret_old, 4);
    v_gross_sales := round(v_gross_sales - v_ret_new, 4);

    -- 3. Total Unreversed Scrap Gold Paid
    select coalesce(sum(coalesce(scrap_585_equiv_grams, scrap_weight_grams)), 0)
    into v_paid_scrap
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and direction = 'client_to_seller'
      and status <> 'reversed';

    -- 4. Total Unreversed Cash Equivalent Paid (UZS & USD BOTH INCLUDED!)
    select
      coalesce(sum(cash_equivalent_grams), 0),
      coalesce(sum(cash_paid_amount), 0),
      coalesce(sum(usd_equivalent_grams), 0),
      coalesce(sum(usd_paid_amount), 0),
      coalesce(sum(total_settled_grams), 0)
    into v_paid_cash_g, v_paid_cash_uzs, v_paid_usd_g, v_paid_usd, v_total_settled_sum
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and direction = 'client_to_seller'
      and status <> 'reversed';

    -- Total paid strictly combines Scrap + UZS Gold Eq + USD Gold Eq
    v_total_paid := round(v_paid_scrap + v_paid_cash_g + v_paid_usd_g, 4);

    -- Gross obligation combining sales and legacy debt
    if v_legacy_debt >= 0 then
      v_gross_debt := round(v_gross_sales + v_legacy_debt, 4);
      if v_gross_debt >= (v_total_paid + v_ret_adv) then
        v_net_debt := round((v_gross_debt - (v_total_paid + v_ret_adv))::numeric, 4);
        v_avail_adv := 0;
      else
        v_net_debt := 0;
        v_avail_adv := round(((v_total_paid + v_ret_adv) - v_gross_debt)::numeric, 4);
      end if;
    else
      -- Negative legacy debt means customer had pre-existing advance
      v_gross_debt := v_gross_sales;
      if v_gross_sales >= ((v_total_paid + v_ret_adv) + abs(v_legacy_debt)) then
        v_net_debt := round((v_gross_sales - ((v_total_paid + v_ret_adv) + abs(v_legacy_debt)))::numeric, 4);
        v_avail_adv := 0;
      else
        v_net_debt := 0;
        v_avail_adv := round((((v_total_paid + v_ret_adv) + abs(v_legacy_debt)) - v_gross_sales)::numeric, 4);
      end if;
    end if;

    -- Applied Advance
    select coalesce(sum(settled_gold_grams), 0)
    into v_applied_adv
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';

    v_rows := v_rows || jsonb_build_object(
      'customer_id', v_cust_rec.id,
      'customer_code', v_cust_rec.customer_code,
      'contact_name', v_cust_rec.contact_name,
      'phone', v_cust_rec.phone,
      'company_name', v_cust_rec.company_name,
      'seller_id', v_cust_rec.seller_id,
      'seller_name', v_cust_rec.seller_name,
      'gross_debt_g', v_gross_debt,
      'legacy_debt_g', v_legacy_debt,
      'paid_scrap_equivalent_g', v_paid_scrap,
      'paid_cash_equivalent_g', v_paid_cash_g,
      'paid_cash_amount_uzs', v_paid_cash_uzs,
      'paid_usd_equivalent_g', v_paid_usd_g,
      'paid_usd_amount', v_paid_usd,
      'total_paid_g', v_total_paid,
      'applied_advance_g', v_applied_adv,
      'available_advance_g', v_avail_adv,
      'net_debt_g', v_net_debt,
      'old_sale_return_g', v_old_ret_g,
      -- 089: UZS / USD (CPAY) side of the customer, read only - never mixed into the 585 numbers above
      'currency', coalesce((select jsonb_object_agg(a.currency, jsonb_build_object(
          'debt', a.debt_amount, 'advance', a.advance_amount,
          'cpay_paid', coalesce((select sum(c.credited_amount) from public.client_currency_settlements c
                                  where c.customer_id = v_cust_rec.id and c.debt_currency = a.currency and c.status <> 'reversed'), 0),
          'cpay_count', (select count(*) from public.client_currency_settlements c
                          where c.customer_id = v_cust_rec.id and c.debt_currency = a.currency and c.status <> 'reversed'),
          'cpay_reversed_count', (select count(*) from public.client_currency_settlements c
                                   where c.customer_id = v_cust_rec.id and c.debt_currency = a.currency and c.status = 'reversed')))
        from public.client_currency_accounts a where a.customer_id = v_cust_rec.id and a.organization_id = v_caller_org), '{}'::jsonb)
    );

    v_tot_gross := v_tot_gross + v_gross_debt;
    v_tot_paid  := v_tot_paid + v_total_paid;
    v_tot_net   := v_tot_net + v_net_debt;
    v_tot_adv   := v_tot_adv + v_avail_adv;
    v_tot_cash_uzs := v_tot_cash_uzs + v_paid_cash_uzs;
    v_tot_usd      := v_tot_usd + v_paid_usd;

    -- Sync client_gold_accounts cache accurately
    insert into public.client_gold_accounts (
      customer_id, organization_id, seller_id, total_purchased_gold_grams,
      total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams,
      total_usd_paid_amount, total_usd_equiv_grams, total_settled_grams,
      current_debt_grams, advance_balance_grams, updated_at
    ) values (
      v_cust_rec.id, v_caller_org, v_cust_rec.seller_id, v_gross_debt,
      v_paid_scrap, v_paid_cash_uzs, round(v_paid_cash_g + v_paid_usd_g, 4),
      v_paid_usd, v_paid_usd_g, v_total_paid,
      v_net_debt, v_avail_adv, now()
    )
    on conflict (customer_id) do update set
      seller_id = coalesce(excluded.seller_id, client_gold_accounts.seller_id),
      total_purchased_gold_grams = excluded.total_purchased_gold_grams,
      total_scrap_paid_grams = excluded.total_scrap_paid_grams,
      total_cash_paid_amount = excluded.total_cash_paid_amount,
      total_cash_equiv_grams = excluded.total_cash_equiv_grams,
      total_usd_paid_amount  = excluded.total_usd_paid_amount,
      total_usd_equiv_grams  = excluded.total_usd_equiv_grams,
      total_settled_grams = excluded.total_settled_grams,
      current_debt_grams = excluded.current_debt_grams,
      advance_balance_grams = excluded.advance_balance_grams,
      updated_at = now();
  end loop;

  return jsonb_build_object(
    'items', v_rows,
    'summary', jsonb_build_object(
      'total_gross_debt_g', v_tot_gross,
      'total_paid_g', v_tot_paid,
      'total_net_debt_g', v_tot_net,
      'total_advance_g', v_tot_adv,
      'total_cash_uzs', v_tot_cash_uzs,
      'total_usd', v_tot_usd
    )
  );
end;
$function$;

notify pgrst, 'reload schema';
