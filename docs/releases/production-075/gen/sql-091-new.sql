-- ------------------------------------------------------------------ seller buys LOM at the bazaar with his till UZS
-- An exchange INSIDE the seller's till: UZS cash -> LOM (physical + 585 equivalent kept apart). Not a sale, not an
-- expense, not capital: customer debt, seller obligation, factory account and profit are not touched. The UZS that
-- left takes its share of the valued cash pool (072) with it, so a later cash handover closes exactly the grams the
-- remaining cash carries, and the LOM later closes the obligation with its 585 equivalent (existing handover rule).
create table if not exists public.seller_lom_purchases (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  purchase_no      text not null,
  seller_id        uuid not null references public.employees(id),
  purchase_date    date not null,
  physical_g       numeric(14, 4) not null check (physical_g > 0),
  proba            numeric(6, 2) not null check (proba between 300 and 1000),
  equiv_585_g      numeric(14, 4) not null check (equiv_585_g > 0),
  uzs_amount       numeric(18, 2) not null check (uzs_amount > 0),
  price_per_g_uzs  numeric(18, 2) not null check (price_per_g_uzs > 0),
  counterparty     text,
  notes            text,
  pool_cash_uzs    numeric(18, 2) not null default 0 check (pool_cash_uzs >= 0),
  pool_cash_585_g  numeric(18, 6) not null default 0 check (pool_cash_585_g >= 0),
  idempotency_key  text not null unique,
  status           text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  created_by       uuid references public.employees(id),
  created_at       timestamptz not null default now(),
  reversed_at      timestamptz,
  reversed_by      uuid references public.employees(id),
  reversal_reason  text,
  constraint seller_lom_purchases_equiv check (abs(equiv_585_g - round(physical_g * proba / 585.0, 4)) < 0.00005),
  constraint seller_lom_purchases_reversal check ((status = 'reversed') = (reversed_at is not null))
);
create index if not exists idx_seller_lom_purchases_seller on public.seller_lom_purchases (seller_id, purchase_date);
alter table public.seller_lom_purchases enable row level security;
drop policy if exists seller_lom_purchases_select_policy on public.seller_lom_purchases;
create policy seller_lom_purchases_select_policy on public.seller_lom_purchases for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or public.current_employee_role_text() in ('accountant', 'buxgalter')
              or seller_id = public.current_employee_id()));
revoke all on public.seller_lom_purchases from anon;
revoke insert, update, delete, truncate on public.seller_lom_purchases from authenticated;
grant select on public.seller_lom_purchases to authenticated;

-- @@@ FUNCTIONS @@@

-- a seller records his own purchase; management (manager = director) may record it for a seller of the organization
create or replace function public.rpc_record_seller_lom_purchase(
  p_physical_g numeric, p_proba numeric, p_idempotency_key text,
  p_uzs_amount numeric default null, p_price_per_g_uzs numeric default null,
  p_seller_id uuid default null, p_purchase_date date default null, p_counterparty text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org uuid := public.current_organization_id();
  v_role text := public.current_employee_role_text();
  v_emp uuid := public.current_employee_id();
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_seller uuid; v_phys numeric(14, 4); v_proba numeric(6, 2); v_eq numeric(14, 4); v_uzs numeric(18, 2); v_price numeric(18, 2);
  v_date date := coalesce(p_purchase_date, public._goldia_business_date());
  a public.seller_gold_accounts%rowtype;
  v_pool_uzs numeric(18, 2) := 0; v_pool_g numeric(18, 6) := 0; v_take numeric(18, 2) := 0; v_take_g numeric(18, 6) := 0;
  v_payload jsonb; v_existing jsonb; v_id uuid; v_no text; v_res jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi']);
  if v_key is null then raise exception 'ERR_IDEMPOTENCY_REQUIRED: idempotency kaliti majburiy'; end if;
  if public._goldia_is_seller_role(v_role) then
    if p_seller_id is not null and p_seller_id is distinct from v_emp then
      raise exception 'ERR_NOT_OWN_TILL: sotuvchi faqat o''z kassasidan xarid qila oladi' using errcode = '42501';
    end if;
    v_seller := v_emp;
  elsif public._goldia_is_management_role(v_role) then
    v_seller := p_seller_id;
  else
    raise exception 'Ruxsat etilmadi' using errcode = '42501';
  end if;
  if v_seller is null or not exists (select 1 from public.employees e where e.id = v_seller and e.organization_id = v_org and public._goldia_is_seller_role(e.role::text)) then
    raise exception 'ERR_SELLER_REQUIRED: sotuvchi aniqlanmadi';
  end if;
  v_phys := round(coalesce(p_physical_g, 0)::numeric, 4);
  if v_phys <= 0 then raise exception 'ERR_GRAMS: fizik gramm 0 dan katta bo''lishi shart'; end if;
  if p_proba is null then raise exception 'ERR_PROBA_REQUIRED: lom probasi ko''rsatilishi shart'; end if;
  v_proba := round(p_proba::numeric, 2);
  if v_proba < 300 or v_proba > 1000 then raise exception 'ERR_PROBA: proba 300 - 1000 oralig''ida bo''lishi shart (kiritildi: %)', v_proba; end if;
  v_eq := round(v_phys * v_proba / 585.0, 4);   -- the same formula as LOM payments (rpc_record_client_settlement)
  if p_uzs_amount is null and p_price_per_g_uzs is null then raise exception 'ERR_PRICE_REQUIRED: jami UZS yoki 1 g narxi kiritilishi shart'; end if;
  v_uzs := round(coalesce(p_uzs_amount, p_price_per_g_uzs * v_phys)::numeric, 2);
  if v_uzs <= 0 then raise exception 'ERR_AMOUNT: summa 0 dan katta bo''lishi shart'; end if;
  if p_uzs_amount is not null and p_price_per_g_uzs is not null and abs(round(p_price_per_g_uzs * v_phys, 2) - v_uzs) > 1 then
    raise exception 'ERR_PRICE_MISMATCH: jami summa (%) va 1 g narxi x gramm (%) mos emas', v_uzs, round(p_price_per_g_uzs * v_phys, 2);
  end if;
  v_price := round(v_uzs / v_phys, 2);
  if v_date > public._goldia_business_date() then raise exception 'ERR_FUTURE_DATE: sana kelajakda bo''lishi mumkin emas'; end if;
  if exists (select 1 from public.goldia_report_periods p where p.organization_id = v_org and v_date between p.period_start and p.period_end) then
    raise exception 'ERR_PERIOD_CLOSED: sana yopilgan hisobot davrida';
  end if;
  if exists (select 1 from public.opening_periods p where p.organization_id = v_org and p.status in ('locked', 'closed') and v_date < public._goldia_business_date(p.created_at)) then
    raise exception 'ERR_BEFORE_OPENING_LOCK: sana boshlang''ich hisobdan (T0) oldin';
  end if;
  -- the same write gate as every till operation (_goldia_guard_opening_draft): no opening draft, no backup / restart
  -- freeze (never waits); the opening's own transaction (goldia.opening_write) passes, exactly as in that guard
  if current_setting('goldia.opening_write', true) is distinct from txid_current()::text then
    if not pg_try_advisory_xact_lock_shared(hashtext('goldia_financial_restart'), hashtext(v_org::text)) then
      raise exception 'ERR_OPENING_DRAFT: moliyaviy hisob hozir qayta boshlanmoqda - amalni keyinroq takrorlang' using errcode = '55000';
    end if;
    if exists (select 1 from public.opening_periods where organization_id = v_org and status = 'draft') then
      raise exception 'ERR_OPENING_DRAFT: boshlang''ich hisob tasdiqlanmagan - oddiy moliyaviy amallar qulflangan' using errcode = '55000';
    end if;
    if public._goldia_active_freeze(v_org) is not null then
      raise exception 'ERR_FINANCIAL_FREEZE: moliyaviy yozuvlar vaqtincha to''xtatilgan (backup va qayta boshlash) - amal bajarilmadi' using errcode = '55000';
    end if;
  end if;

  v_payload := jsonb_build_object('action', 'seller_lom_purchase', 'seller_id', v_seller, 'physical_g', v_phys, 'proba', v_proba,
    'uzs_amount', v_uzs, 'purchase_date', v_date);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_record_seller_lom_purchase', v_payload);
  if v_existing is not null then return v_existing; end if;

  -- one till operation at a time per seller: the account row lock serializes parallel purchases / handovers / payments
  select * into a from public.seller_gold_accounts where seller_id = v_seller and organization_id = v_org for update;
  if not found then raise exception 'ERR_TILL_EMPTY: sotuvchi kassasi topilmadi'; end if;
  if coalesce(a.seller_till_cash_amount, 0) < v_uzs then
    raise exception 'ERR_INSUFFICIENT_CASH_BALANCE: sotuvchi kassasida yetarli UZS yo''q (kassada: % UZS, kerak: % UZS)', coalesce(a.seller_till_cash_amount, 0), v_uzs;
  end if;
  -- the spent UZS takes its share of the valued cash pool (same pool average as a cash handover)
  v_pool_uzs := least(coalesce(a.till_valued_cash_uzs, 0), greatest(0, coalesce(a.seller_till_cash_amount, 0)));
  if v_pool_uzs > 0 then
    v_pool_g := a.till_valued_cash_585_g * v_pool_uzs / a.till_valued_cash_uzs;
    v_take := least(v_uzs, v_pool_uzs);
    v_take_g := round(v_pool_g * v_take / v_pool_uzs, 6);
  end if;

  update public.seller_gold_accounts
     set seller_till_cash_amount      = round(seller_till_cash_amount - v_uzs, 2),
         till_valued_cash_uzs         = round(greatest(0, till_valued_cash_uzs - v_take), 2),
         till_valued_cash_585_g       = round(greatest(0, till_valued_cash_585_g - v_take_g), 6),
         seller_till_scrap_grams      = round(coalesce(seller_till_scrap_grams, 0) + v_eq, 4),
         seller_till_scrap_585_eq_g   = round(coalesce(seller_till_scrap_585_eq_g, 0) + v_eq, 4),
         seller_till_scrap_physical_g = round(coalesce(seller_till_scrap_physical_g, 0) + v_phys, 4),
         updated_at = now()
   where seller_id = v_seller;

  v_no := 'LOMX-' || to_char(v_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
  insert into public.seller_lom_purchases (organization_id, purchase_no, seller_id, purchase_date, physical_g, proba, equiv_585_g, uzs_amount,
    price_per_g_uzs, counterparty, notes, pool_cash_uzs, pool_cash_585_g, idempotency_key, created_by)
  values (v_org, v_no, v_seller, v_date, v_phys, v_proba, v_eq, v_uzs, v_price, nullif(btrim(p_counterparty), ''), nullif(btrim(p_notes), ''),
    v_take, v_take_g, v_key, v_emp)
  returning id into v_id;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'seller_lom_purchases', v_id::text, 'SELLER_LOM_PURCHASE', auth.uid(),
    jsonb_build_object('till_uzs', a.seller_till_cash_amount, 'till_lom_physical_g', a.seller_till_scrap_physical_g, 'till_lom_585_g', a.seller_till_scrap_585_eq_g),
    jsonb_build_object('purchase_no', v_no, 'seller_id', v_seller, 'uzs', v_uzs, 'physical_g', v_phys, 'proba', v_proba, 'equiv_585_g', v_eq,
      'price_per_g_uzs', v_price, 'pool_cash_uzs', v_take, 'pool_cash_585_g', v_take_g, 'counterparty', p_counterparty),
    nullif(btrim(p_notes), ''));
  v_res := jsonb_build_object('status', 'ok', 'purchase_id', v_id, 'purchase_no', v_no, 'seller_id', v_seller, 'purchase_date', v_date,
    'physical_g', v_phys, 'proba', v_proba, 'equiv_585_g', v_eq, 'uzs_amount', v_uzs, 'price_per_g_uzs', v_price,
    'pool_cash_uzs', v_take, 'pool_cash_585_g', v_take_g,
    'till_uzs_after', round(a.seller_till_cash_amount - v_uzs, 2),
    'till_lom_physical_after_g', round(coalesce(a.seller_till_scrap_physical_g, 0) + v_phys, 4),
    'till_lom_585_after_g', round(coalesce(a.seller_till_scrap_585_eq_g, 0) + v_eq, 4));
  perform public.save_idempotency_response(v_key, 'rpc_record_seller_lom_purchase', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_record_seller_lom_purchase(numeric, numeric, text, numeric, numeric, uuid, date, text, text) from public, anon;
grant execute on function public.rpc_record_seller_lom_purchase(numeric, numeric, text, numeric, numeric, uuid, date, text, text) to authenticated;

-- reversal: only while the LOM is still in the seller's till (not handed over / used); the UZS and the pool share go back
create or replace function public.rpc_reverse_seller_lom_purchase(p_purchase_id uuid, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org uuid := public.current_organization_id();
  v_role text := public.current_employee_role_text();
  v_emp uuid := public.current_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_key text := nullif(btrim(p_idempotency_key), '');
  x public.seller_lom_purchases%rowtype; a public.seller_gold_accounts%rowtype;
  v_payload jsonb; v_existing jsonb; v_res jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi']);
  if v_reason is null then raise exception 'ERR_REASON_REQUIRED: bekor qilish sababi kiritilishi shart'; end if;
  if v_key is null then raise exception 'ERR_IDEMPOTENCY_REQUIRED: idempotency kaliti majburiy'; end if;
  v_payload := jsonb_build_object('action', 'reverse_seller_lom_purchase', 'purchase_id', p_purchase_id);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_reverse_seller_lom_purchase', v_payload);
  if v_existing is not null then return v_existing; end if;
  if current_setting('goldia.opening_write', true) is distinct from txid_current()::text then
    if not pg_try_advisory_xact_lock_shared(hashtext('goldia_financial_restart'), hashtext(v_org::text)) then
      raise exception 'ERR_OPENING_DRAFT: moliyaviy hisob hozir qayta boshlanmoqda - amalni keyinroq takrorlang' using errcode = '55000';
    end if;
    if public._goldia_active_freeze(v_org) is not null then
      raise exception 'ERR_FINANCIAL_FREEZE: moliyaviy yozuvlar vaqtincha to''xtatilgan (backup va qayta boshlash) - amal bajarilmadi' using errcode = '55000';
    end if;
  end if;
  select * into x from public.seller_lom_purchases where id = p_purchase_id and organization_id = v_org for update;
  if not found then raise exception 'ERR_NOT_FOUND: xarid hujjati topilmadi'; end if;
  if x.status <> 'confirmed' then raise exception 'ERR_ALREADY_REVERSED: xarid allaqachon bekor qilingan (%)', x.purchase_no; end if;
  if public._goldia_is_seller_role(v_role) and x.seller_id is distinct from v_emp then
    raise exception 'ERR_NOT_OWN_TILL: sotuvchi faqat o''z xaridini bekor qila oladi' using errcode = '42501';
  end if;
  if not public._goldia_is_seller_role(v_role) and not public._goldia_is_management_role(v_role) then raise exception 'Ruxsat etilmadi' using errcode = '42501'; end if;
  if exists (select 1 from public.goldia_report_periods p where p.organization_id = v_org and x.purchase_date between p.period_start and p.period_end) then
    raise exception 'ERR_PERIOD_CLOSED: xarid sanasi yopilgan hisobot davrida';
  end if;
  select * into a from public.seller_gold_accounts where seller_id = x.seller_id and organization_id = v_org for update;
  if coalesce(a.seller_till_scrap_physical_g, 0) < x.physical_g - 0.00005 or coalesce(a.seller_till_scrap_585_eq_g, 0) < x.equiv_585_g - 0.00005
     or coalesce(a.seller_till_scrap_grams, 0) < x.equiv_585_g - 0.00005 then
    raise exception 'ERR_LOM_ALREADY_USED: xarid qilingan lom kassada yo''q (menejerga topshirilgan?) - avval o''sha amalni bekor qiling (kassada: % g fizik / % g 585, kerak: % / %)',
      coalesce(a.seller_till_scrap_physical_g, 0), coalesce(a.seller_till_scrap_585_eq_g, 0), x.physical_g, x.equiv_585_g;
  end if;
  update public.seller_gold_accounts
     set seller_till_cash_amount      = round(seller_till_cash_amount + x.uzs_amount, 2),
         till_valued_cash_uzs         = round(coalesce(till_valued_cash_uzs, 0) + x.pool_cash_uzs, 2),
         till_valued_cash_585_g       = round(coalesce(till_valued_cash_585_g, 0) + x.pool_cash_585_g, 6),
         seller_till_scrap_grams      = round(seller_till_scrap_grams - x.equiv_585_g, 4),
         seller_till_scrap_585_eq_g   = round(seller_till_scrap_585_eq_g - x.equiv_585_g, 4),
         seller_till_scrap_physical_g = round(seller_till_scrap_physical_g - x.physical_g, 4),
         updated_at = now()
   where seller_id = x.seller_id;
  update public.seller_lom_purchases set status = 'reversed', reversed_at = now(), reversed_by = v_emp, reversal_reason = v_reason where id = x.id;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'seller_lom_purchases', x.id::text, 'REVERSE_SELLER_LOM_PURCHASE', auth.uid(),
    jsonb_build_object('purchase_no', x.purchase_no, 'uzs', x.uzs_amount, 'physical_g', x.physical_g, 'equiv_585_g', x.equiv_585_g),
    jsonb_build_object('status', 'reversed'), v_reason);
  v_res := jsonb_build_object('status', 'ok', 'purchase_id', x.id, 'purchase_no', x.purchase_no, 'uzs_returned', x.uzs_amount,
    'physical_g', x.physical_g, 'equiv_585_g', x.equiv_585_g);
  perform public.save_idempotency_response(v_key, 'rpc_reverse_seller_lom_purchase', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_reverse_seller_lom_purchase(uuid, text, text) from public, anon;
grant execute on function public.rpc_reverse_seller_lom_purchase(uuid, text, text) to authenticated;
