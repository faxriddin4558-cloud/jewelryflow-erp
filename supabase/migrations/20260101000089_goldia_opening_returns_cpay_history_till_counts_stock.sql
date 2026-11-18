-- 089 - Goldia Sales (2026-11-18): the remaining post-launch functions in ONE release. Nothing existing is rewritten in
-- place: opening documents (LOCK), sales, payments, handovers and factory accounts keep every row; 088 rules unchanged.
--
-- 1. "Eski savdodan vozvrat" (opening_sale_returns): goods sold BEFORE T0 come back. There is no sale document, so no sale
--    is invented: the document points at the customer's locked opening debt (E = 585 g, F = UZS / USD).
--      value   585 debt : grams x (1 + the ORIGINAL customer %, entered explicitly) - the 083 rule (grams x original markup)
--              UZS / USD: the original currency value of the returned goods, entered explicitly (never re-priced)
--      split   debt part = min(value, open debt); the rest is an advance (083 decision); nothing is refunded in cash
--      seller  only the part that pays the OPENING debt releases the seller's opening obligation (E: its grams; rated F:
--              its share of the document's rate snapshot; unrated F: 0 - it was never in the obligation); a later payment
--              takes only what is left of the opening debt (rated snapshot / unrated value) - counted once
--      goods   a new return lot on the seller's shelf (seller obligation grams x (1 + the seller %, entered explicitly)),
--              or straight to the manager through the existing rpc_return_piece_to_manager (seller net 0, manager stock
--              +grams); never a factory receipt / factory obligation (pre-T0 goods were settled before T0, 088)
--    Management only, mandatory idempotency key, reason and explicit confirmation, audited; reversible
--    (rpc_reverse_opening_sale_return) while the returned piece is untouched. The opening documents are never changed.
-- 2. CPAY (UZS / USD debt payments) and opening returns appear in the daily / customer journal as their own types
--    (currency_payment / opening_return, 0 g in the gram columns - never added to SETTL grams); the unified ledger
--    gives each customer's UZS / USD debt and CPAY totals next to the 585 numbers (585 math unchanged, the old-return
--    585 credit is part of it).
-- 3. rpc_correct_client_payment: a payment entered in the wrong currency is reversed and entered again in the right one
--    in ONE transaction through the existing reversal / record functions (all their checks stay; either both happen or
--    nothing), audited with both document ids.
-- 4. seller_till_counts: an audited count of the cash a seller really holds against the till he must hand over; only a
--    record (difference = personal use / shortage / surplus) - the till and the obligation are not changed, no debt is
--    created (the till already is the obligation).
-- 5. rpc_get_seller_stock_movements (read only): per seller and date range the opening goods, consignments, sales,
--    customer returns, old-sale returns, returns to the manager and cancellations, the closing balance against the
--    stored stock and the held pieces, and possible duplicates - nothing is corrected automatically.

-- ------------------------------------------------------------------ tables
create table if not exists public.opening_sale_returns (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organizations(id) on delete cascade,
  return_no                     text not null,
  opening_document_id           uuid not null references public.opening_documents(id) on delete restrict,
  customer_id                   uuid not null references public.customers(id) on delete restrict,
  seller_id                     uuid not null references public.employees(id) on delete restrict,
  return_date                   date not null default public._goldia_business_date(),
  unit                          text not null check (unit in ('G585', 'UZS', 'USD')),
  returned_weight_grams         numeric(14, 4) not null check (returned_weight_grams > 0),
  customer_markup_pct           numeric(6, 2) check (customer_markup_pct is null or (customer_markup_pct >= 0 and customer_markup_pct <= 100)),
  credit_amount                 numeric(18, 4) not null check (credit_amount > 0),
  debt_reduced                  numeric(18, 4) not null check (debt_reduced >= 0),
  advance_created               numeric(18, 4) not null check (advance_created >= 0),
  opening_part                  numeric(18, 4) not null default 0 check (opening_part >= 0),
  seller_obligation_released_g  numeric(14, 4) not null default 0 check (seller_obligation_released_g >= 0),
  receiver                      text not null check (receiver in ('seller', 'manager')),
  receiver_seller_markup_pct    numeric(6, 2) check (receiver_seller_markup_pct is null or (receiver_seller_markup_pct >= 0 and receiver_seller_markup_pct <= 100)),
  consignment_id                uuid references public.seller_consignments(id),
  piece_id                      uuid references public.consignment_pieces(id),
  customer_net_before           numeric(18, 4) not null,
  customer_net_after            numeric(18, 4) not null,
  formula                       text not null,
  reason                        text not null check (length(btrim(reason)) > 0),
  idempotency_key               text not null unique,
  status                        text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  created_by                    uuid references public.employees(id),
  created_at                    timestamptz not null default now(),
  reversed_at                   timestamptz,
  reversed_by                   uuid references public.employees(id),
  reversal_reason               text,
  constraint uq_opening_sale_returns_tenant_no unique (organization_id, return_no),
  constraint opening_sale_returns_value_split check (debt_reduced + advance_created = credit_amount),
  constraint opening_sale_returns_opening_part check (opening_part <= debt_reduced),
  constraint opening_sale_returns_markup check ((unit = 'G585') = (customer_markup_pct is not null))
);
create index if not exists idx_opening_sale_returns_doc on public.opening_sale_returns (opening_document_id);
create index if not exists idx_opening_sale_returns_customer on public.opening_sale_returns (customer_id);
create index if not exists idx_opening_sale_returns_seller on public.opening_sale_returns (seller_id);
alter table public.opening_sale_returns enable row level security;
drop policy if exists opening_sale_returns_select_policy on public.opening_sale_returns;
create policy opening_sale_returns_select_policy on public.opening_sale_returns for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or public.current_employee_role_text() in ('accountant', 'buxgalter')
              or seller_id in (select e.id from public.employees e where e.user_id = auth.uid())));
revoke all on public.opening_sale_returns from anon;
revoke insert, update, delete, truncate on public.opening_sale_returns from authenticated;
grant select on public.opening_sale_returns to authenticated;

create table if not exists public.seller_till_counts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  seller_id        uuid not null references public.employees(id) on delete restrict,
  counted_uzs      numeric(18, 2) not null check (counted_uzs >= 0),
  counted_usd      numeric(18, 2) not null check (counted_usd >= 0),
  expected_uzs     numeric(18, 2) not null,
  expected_usd     numeric(18, 2) not null,
  diff_uzs         numeric(18, 2) not null,
  diff_usd         numeric(18, 2) not null,
  explanation      text not null check (explanation in ('match', 'personal_use', 'shortage', 'surplus')),
  notes            text,
  idempotency_key  text not null unique,
  created_by       uuid references public.employees(id),
  created_at       timestamptz not null default now(),
  constraint seller_till_counts_diff check (diff_uzs = counted_uzs - expected_uzs and diff_usd = counted_usd - expected_usd),
  constraint seller_till_counts_note check (explanation = 'match' or length(btrim(coalesce(notes, ''))) > 0)
);
create index if not exists idx_seller_till_counts_seller on public.seller_till_counts (seller_id, created_at desc);
alter table public.seller_till_counts enable row level security;
drop policy if exists seller_till_counts_select_policy on public.seller_till_counts;
create policy seller_till_counts_select_policy on public.seller_till_counts for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or public.current_employee_role_text() in ('accountant', 'buxgalter')
              or seller_id in (select e.id from public.employees e where e.user_id = auth.uid())));
revoke all on public.seller_till_counts from anon;
revoke insert, update, delete, truncate on public.seller_till_counts from authenticated;
grant select on public.seller_till_counts to authenticated;

-- no own draft / freeze trigger (the guard stays on exactly its 12 tables, as 086 / the UI-release lock check expect):
-- every write of an old-sale return or its reversal also writes seller_consignments / consignment_pieces, which are
-- guarded - a draft opening or an active freeze refuses the whole transaction. A till count changes no balance.

-- what earlier old-sale returns took from one opening document: its debt part (in the document unit) and released grams
create or replace function public._goldia_opening_returned(p_doc uuid)
returns table (amount numeric, released_g numeric)
language sql stable security definer set search_path = public, pg_temp as $f$
  select coalesce(sum(r.opening_part), 0)::numeric, coalesce(sum(r.seller_obligation_released_g), 0)::numeric
    from public.opening_sale_returns r where r.opening_document_id = p_doc and r.status = 'confirmed'
$f$;
revoke all on function public._goldia_opening_returned(uuid) from public, anon, authenticated;

-- ===== _goldia_opening_seller_obligation (from 20260101000088_goldia_factory_settled_and_unrated_currency.sql)
create or replace function public._goldia_opening_seller_obligation(p_seller uuid, p_org uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $f$
  select coalesce((select sum(seller_obligation_g) from public.opening_documents
   where organization_id = p_org and seller_id = p_seller and status = 'active' and kind in ('seller_obligation', 'customer_currency')), 0)::numeric
  -- 088: the paid parts of an UNRATED opening UZS / USD debt, valued at each payment's rates (reversed payments excluded)
  + coalesce((select sum(c.snapshot_released_g) from public.client_currency_settlements c join public.opening_documents d on d.id = c.opening_document_id
      where d.organization_id = p_org and d.seller_id = p_seller and d.status = 'active' and d.kind = 'customer_currency' and d.equiv_585_g is null
        and c.status <> 'reversed'), 0)::numeric
  -- 089: an old-sale return that paid (part of) an opening debt released that part of the seller's opening obligation
  - coalesce((select sum(r.seller_obligation_released_g) from public.opening_sale_returns r
      where r.organization_id = p_org and r.seller_id = p_seller and r.status = 'confirmed'), 0)::numeric
$f$;

-- ===== rpc_record_client_currency_settlement (from 20260101000088_goldia_factory_settled_and_unrated_currency.sql)
create or replace function public.rpc_record_client_currency_settlement(
  p_customer_id     uuid,
  p_currency        text,
  p_cash_uzs        numeric default 0,
  p_usd_amount      numeric default 0,
  p_scrap_weight    numeric default 0,
  p_scrap_proba     numeric default null,
  p_usd_rate        numeric default null,
  p_lom_rate        numeric default null,
  p_seller_id       uuid default null,
  p_notes           text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_caller_emp_id uuid := public.current_employee_id();
  v_is_seller     boolean;
  v_cur           text := upper(btrim(coalesce(p_currency, '')));
  v_cash          numeric(18, 2) := round(coalesce(p_cash_uzs, 0)::numeric, 2);
  v_usd           numeric(18, 2) := round(coalesce(p_usd_amount, 0)::numeric, 2);
  v_scrap         numeric(14, 4) := round(coalesce(p_scrap_weight, 0)::numeric, 4);
  v_proba         numeric(6, 2);
  v_scrap_585     numeric(14, 4) := 0;
  v_usd_rate      numeric(18, 2);
  v_lom_rate      numeric(18, 2);
  v_need_usd_rate boolean;
  v_credit        numeric(18, 2);
  v_customer      public.customers%rowtype;
  v_seller_id     uuid;
  v_rates         public.seller_rates%rowtype;
  v_acc           public.client_currency_accounts%rowtype;
  v_cur_net       numeric(18, 2);
  v_new_net       numeric(18, 2);
  v_applied       numeric(18, 2);
  v_f             numeric;
  v_od            public.opening_documents%rowtype;
  v_snap_g        numeric(14, 4) := 0;
  v_od_rem        numeric(18, 2);
  v_open_applied  numeric(18, 2) := 0;
  v_cash_val      numeric;
  v_usd_val       numeric;
  v_pool_cash     numeric(18, 2) := 0;
  v_pool_usd      numeric(18, 2) := 0;
  v_pool_cash_g   numeric(18, 6) := 0;
  v_pool_usd_g    numeric(18, 6) := 0;
  v_id            uuid;
  v_no            text;
  v_payload       jsonb;
  v_existing      jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);
  v_is_seller := public._goldia_is_seller_role(v_caller_role);
  if v_cur not in ('UZS', 'USD') then
    raise exception 'ERR_CURRENCY: Qarz valyutasi UZS yoki USD bo''lishi shart';
  end if;
  if coalesce(p_cash_uzs, 0) < 0 or coalesce(p_usd_amount, 0) < 0 or coalesce(p_scrap_weight, 0) < 0 then
    raise exception 'To''lov summalari manfiy bo''lishi mumkin emas';
  end if;
  if v_cash <= 0 and v_usd <= 0 and v_scrap <= 0 then
    raise exception 'To''lov summasi kiritilmagan';
  end if;
  select * into v_customer from public.customers where id = p_customer_id and organization_id = v_caller_org;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;
  if v_is_seller then
    if v_customer.seller_id is not null and v_customer.seller_id is distinct from v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Ushbu mijoz sizga biriktirilmagan' using errcode = '42501';
    end if;
    if p_seller_id is not null and p_seller_id <> v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''z kassasiga to''lov qabul qila oladi' using errcode = '42501';
    end if;
    v_seller_id := v_caller_emp_id;
  else
    v_seller_id := coalesce(p_seller_id, v_customer.seller_id);
  end if;
  if v_seller_id is null or not exists (select 1 from public.employees e where e.id = v_seller_id and e.organization_id = v_caller_org) then
    raise exception 'To''lov qaysi sotuvchi kassasiga tushishi aniqlanmadi (mijozga sotuvchi biriktiring)';
  end if;
  if v_scrap > 0 then
    v_proba := round(coalesce(p_scrap_proba, 585)::numeric, 2);
    if v_proba < 300.0 or v_proba > 1000.0 then
      raise exception 'Noto''g''ri proba kiritildi: % (ruxsat: 300 - 1000)', v_proba;
    end if;
    v_scrap_585 := round((v_scrap * (v_proba / 585.0))::numeric, 4);
  end if;

  v_payload := jsonb_build_object('action', 'record_client_currency_settlement', 'customer_id', p_customer_id, 'currency', v_cur,
    'cash_uzs', v_cash, 'usd', v_usd, 'scrap', v_scrap, 'proba', v_proba, 'seller_id', v_seller_id);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_currency_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- operation rates
  v_need_usd_rate := (v_cur = 'USD' and (v_cash > 0 or v_scrap > 0)) or (v_cur = 'UZS' and v_usd > 0);
  -- 084: every role enters the rates of this payment; defaults: a seller's saved rates (LOM: else the official rate),
  -- director / manager: the official LOM rate, USD has no default for them. Snapshotted on the payment.
  if v_is_seller then
    select * into v_rates from public.seller_rates where seller_id = v_caller_emp_id and organization_id = v_caller_org for share;
  end if;
  if v_need_usd_rate then
    v_usd_rate := public._goldia_operation_rate(v_caller_org, 'usd', v_caller_role, p_usd_rate,
                    case when v_is_seller then v_rates.usd_rate_uzs end);
  end if;
  if v_scrap > 0 then
    v_lom_rate := public._goldia_operation_rate(v_caller_org, 'lom', v_caller_role, p_lom_rate,
                    case when v_is_seller then coalesce(v_rates.lom_rate_uzs, public._goldia_official_585_rate(v_caller_org))
                         else public._goldia_official_585_rate(v_caller_org) end);
  end if;

  -- credited amount in the debt currency
  if v_cur = 'UZS' then
    v_credit := round((v_cash + v_usd * coalesce(v_usd_rate, 0) + v_scrap_585 * coalesce(v_lom_rate, 0))::numeric, 2);
  else
    v_credit := round((v_usd + case when v_cash > 0 or v_scrap > 0 then (v_cash + v_scrap_585 * coalesce(v_lom_rate, 0)) / nullif(v_usd_rate, 0) else 0 end)::numeric, 2);
  end if;
  if v_credit is null or v_credit <= 0 then
    raise exception 'To''lov summasi 0 ga teng (kursni tekshiring)';
  end if;

  insert into public.client_currency_accounts (customer_id, currency, organization_id, seller_id)
  values (v_customer.id, v_cur, v_caller_org, coalesce(v_customer.seller_id, v_seller_id))
  on conflict (customer_id, currency) do nothing;
  select * into v_acc from public.client_currency_accounts where customer_id = v_customer.id and currency = v_cur for update;
  v_cur_net := v_acc.debt_amount - v_acc.advance_amount;
  v_applied := least(greatest(v_acc.debt_amount, 0), v_credit);
  v_new_net := v_cur_net - v_credit;
  update public.client_currency_accounts
     set debt_amount = greatest(v_new_net, 0), advance_amount = greatest(-v_new_net, 0),
         total_paid_amount = total_paid_amount + v_credit, updated_at = now()
   where customer_id = v_customer.id and currency = v_cur;

  -- the money / scrap goes into the seller till ONCE (unvalued: converted to 585 grams only at the handover)
  insert into public.seller_gold_accounts (seller_id, organization_id, seller_till_scrap_grams, seller_till_scrap_physical_g,
    seller_till_scrap_585_eq_g, seller_till_cash_amount, seller_till_usd_amount, updated_at)
  values (v_seller_id, v_caller_org, v_scrap_585, v_scrap, v_scrap_585, v_cash, v_usd, now())
  on conflict (seller_id) do update set
    seller_till_scrap_grams      = round((seller_gold_accounts.seller_till_scrap_grams + v_scrap_585)::numeric, 4),
    seller_till_scrap_physical_g = round((coalesce(seller_gold_accounts.seller_till_scrap_physical_g, 0) + v_scrap)::numeric, 4),
    seller_till_scrap_585_eq_g   = round((coalesce(seller_gold_accounts.seller_till_scrap_585_eq_g, 0) + v_scrap_585)::numeric, 4),
    seller_till_cash_amount      = round((seller_gold_accounts.seller_till_cash_amount + v_cash)::numeric, 2),
    seller_till_usd_amount       = round((coalesce(seller_gold_accounts.seller_till_usd_amount, 0) + v_usd)::numeric, 2),
    updated_at = now();

  -- 085 (decisions D-2 / D-3, 2026-11-11). The part applied to an OPENING UZS / USD debt carries that debt's 585 g
  -- snapshot (its seller obligation, created once at the opening rate) into the seller's valued till pool, so the
  -- handover closes exactly that obligation - the difference to the handover rate is the company's and is recorded on
  -- the handover. The advance part enters the pool with 0 g: handing an advance over never lowers the seller's
  -- obligation (D-3). Debts of ordinary UZS / USD sales keep the earlier rule (unvalued, converted at the handover).
  v_f := case when v_credit > 0 then v_applied / v_credit else 0 end;
  select * into v_od from public.opening_documents
   where organization_id = v_caller_org and customer_id = v_customer.id and kind = 'customer_currency' and unit = v_cur
     and side = 'debt' and status = 'active'
   order by created_at limit 1;
  -- 088: a payment takes only what is LEFT of the opening debt (rated or unrated); the rest of it paid an ordinary sale
  -- debt or is an advance. Once the opening debt is paid off, later payments are ordinary (converted at the handover).
  if v_od.id is not null then
    v_od_rem := v_od.amount - coalesce((select sum(coalesce(c.opening_applied_amount, c.applied_to_debt)) from public.client_currency_settlements c
                  where c.opening_document_id = v_od.id and c.status <> 'reversed'), 0)
                - (select x.amount from public._goldia_opening_returned(v_od.id) x); -- 089: old-sale returns paid that part
    v_open_applied := least(v_applied, greatest(v_od_rem, 0));
    if v_open_applied <= 0 then
      v_od := null; v_open_applied := 0;
    elsif v_od.seller_id is distinct from v_seller_id then
      -- the opening debt is part of ANOTHER seller's obligation: its money must go into that seller's till
      raise exception 'ERR_OPENING_DEBT_OTHER_SELLER: bu mijozning boshlang''ich % qarzi boshqa sotuvchi (%) majburiyatida - to''lov o''sha sotuvchi kassasiga qabul qilinadi',
        v_cur, coalesce((select coalesce(e.name, e.full_name) from public.employees e where e.id = v_od.seller_id), '-') using errcode = '42501';
    end if;
  end if;
  if v_od.id is not null and v_open_applied > 0 and v_od.equiv_585_g is null then
    -- 088: UNRATED opening debt: the paid part is valued at THIS payment's rates (084 operation-rate rule) and becomes the
    -- seller's 585 obligation now (recalc below); the valued pool takes it, so the handover closes exactly that
    if v_lom_rate is null then
      v_lom_rate := public._goldia_operation_rate(v_caller_org, 'lom', v_caller_role, p_lom_rate,
                      case when v_is_seller then coalesce(v_rates.lom_rate_uzs, public._goldia_official_585_rate(v_caller_org))
                           else public._goldia_official_585_rate(v_caller_org) end);
    end if;
    if v_cur = 'USD' and v_usd_rate is null then
      v_usd_rate := public._goldia_operation_rate(v_caller_org, 'usd', v_caller_role, p_usd_rate, case when v_is_seller then v_rates.usd_rate_uzs end);
    end if;
    if coalesce(v_lom_rate, 0) <= 0 or (v_cur = 'USD' and coalesce(v_usd_rate, 0) <= 0) then
      raise exception 'ERR_RATE_REQUIRED: kursi kiritilmagan boshlang''ich qarz to''lovida 585 kursi% kiritilishi shart', case when v_cur = 'USD' then ' va USD kursi' else '' end using errcode = '22023';
    end if;
    v_snap_g := round(case when v_cur = 'UZS' then v_open_applied else v_open_applied * v_usd_rate end / v_lom_rate, 4);
  elsif v_od.id is not null and v_applied > 0 and v_od.amount > 0 then
    v_snap_g := least(greatest(0, v_od.seller_obligation_g - coalesce((select sum(c.snapshot_released_g) from public.client_currency_settlements c
                        where c.opening_document_id = v_od.id and c.status <> 'reversed'), 0)
                        - (select x.released_g from public._goldia_opening_returned(v_od.id) x)),
                      case when v_open_applied >= v_od_rem then v_od.seller_obligation_g  -- 088: pays it off: all remaining grams, no rounding residue
                           else round(v_open_applied * v_od.seller_obligation_g / v_od.amount, 4) end);
  end if;
  v_cash_val := case when v_cash <= 0 then 0 when v_cur = 'UZS' then v_cash else v_cash / nullif(v_usd_rate, 0) end;
  v_usd_val  := case when v_usd <= 0 then 0 when v_cur = 'USD' then v_usd else v_usd * v_usd_rate end;
  -- 088: with an opening debt (rated or unrated) only its part (+ the advance part, 0 g) enters the valued pool; a part
  -- that paid an ordinary sale debt stays unvalued and is converted at the handover (085 put the whole payment into the
  -- pool: the seller lost the handover credit for the sale part)
  v_pool_cash := round(v_cash * case when v_od.id is not null then (v_open_applied + (v_credit - v_applied)) / v_credit else 1 - v_f end, 2);
  v_pool_usd  := round(v_usd * case when v_od.id is not null then (v_open_applied + (v_credit - v_applied)) / v_credit else 1 - v_f end, 2);
  v_pool_cash_g := case when v_credit > 0 then round(v_snap_g * coalesce(v_cash_val, 0) / v_credit, 6) else 0 end;
  v_pool_usd_g  := case when v_credit > 0 then round(v_snap_g * coalesce(v_usd_val, 0) / v_credit, 6) else 0 end;
  if v_pool_cash > 0 or v_pool_usd > 0 then
    update public.seller_gold_accounts
       set till_valued_cash_uzs   = round(coalesce(till_valued_cash_uzs, 0) + v_pool_cash, 2),
           till_valued_cash_585_g = round(coalesce(till_valued_cash_585_g, 0) + v_pool_cash_g, 6),
           till_valued_usd        = round(coalesce(till_valued_usd, 0) + v_pool_usd, 2),
           till_valued_usd_585_g  = round(coalesce(till_valued_usd_585_g, 0) + v_pool_usd_g, 6)
     where seller_id = v_seller_id;
  end if;

  v_no := 'CPAY-' || v_cur || '-' || to_char(public._goldia_business_date(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
  insert into public.client_currency_settlements (organization_id, settlement_no, customer_id, seller_id, debt_currency, cash_uzs, usd_amount,
    scrap_physical_g, scrap_proba, scrap_585_g, rate_usd_uzs, rate_lom_uzs, credited_amount, applied_to_debt, to_advance,
    idempotency_key, recorded_by, notes, opening_document_id, snapshot_released_g, pool_cash_uzs, pool_cash_585_g, pool_usd, pool_usd_585_g,
    opening_applied_amount, pool_seq_at_payment)
  values (v_caller_org, v_no, v_customer.id, v_seller_id, v_cur, v_cash, v_usd, v_scrap, v_proba, v_scrap_585, v_usd_rate, v_lom_rate,
    v_credit, v_applied, v_credit - v_applied, nullif(btrim(p_idempotency_key), ''), v_caller_emp_id, p_notes,
    v_od.id, v_snap_g, v_pool_cash, v_pool_cash_g, v_pool_usd, v_pool_usd_g,
    case when v_od.id is not null then v_open_applied end,
    (select a.pool_handover_seq from public.seller_gold_accounts a where a.seller_id = v_seller_id))
  returning id into v_id;
  if v_od.id is not null and v_od.equiv_585_g is null and coalesce(v_snap_g, 0) > 0 then
    perform public.recalc_seller_gold_account(v_seller_id, v_caller_org);
  end if;

  v_existing := jsonb_build_object('status', 'ok', 'settlement_id', v_id, 'unrated_opening_debt_valued_g',
    case when v_od.id is not null and v_od.equiv_585_g is null then v_snap_g end, 'settlement_no', v_no, 'currency', v_cur,
    'credited_amount', v_credit, 'applied_to_debt', v_applied, 'to_advance', v_credit - v_applied,
    'rate_usd_uzs', v_usd_rate, 'rate_lom_uzs', v_lom_rate, 'scrap_585_g', v_scrap_585,
    'new_debt', greatest(v_new_net, 0), 'new_advance', greatest(-v_new_net, 0),
    'opening_snapshot_585_g', v_snap_g, 'valued_pool_cash_uzs', v_pool_cash, 'valued_pool_usd', v_pool_usd);
  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_currency_settlement', v_existing, v_payload);
  return v_existing;
end;
$$;

-- ===== _goldia_period_effects (from 20260101000088_goldia_factory_settled_and_unrated_currency.sql)
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

-- ===== rpc_get_unified_customer_ledger (from 20260101000083_goldia_partial_sale_returns.sql)
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
    select coalesce(sum(credit_amount), 0) into v_old_ret_g from public.opening_sale_returns
     where customer_id = v_cust_rec.id and organization_id = v_caller_org and status = 'confirmed' and unit = 'G585';
    v_legacy_debt := round(v_legacy_debt - v_old_ret_g, 4);

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
      if v_gross_debt >= v_total_paid then
        v_net_debt := round((v_gross_debt - v_total_paid)::numeric, 4);
        v_avail_adv := 0;
      else
        v_net_debt := 0;
        v_avail_adv := round((v_total_paid - v_gross_debt)::numeric, 4);
      end if;
    else
      -- Negative legacy debt means customer had pre-existing advance
      v_gross_debt := v_gross_sales;
      if v_gross_sales >= (v_total_paid + abs(v_legacy_debt)) then
        v_net_debt := round((v_gross_sales - (v_total_paid + abs(v_legacy_debt)))::numeric, 4);
        v_avail_adv := 0;
      else
        v_net_debt := 0;
        v_avail_adv := round(((v_total_paid + abs(v_legacy_debt)) - v_gross_sales)::numeric, 4);
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

-- ===== rpc_get_daily_sales_ledger (from 20260101000083_goldia_partial_sale_returns.sql)
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

  -- 1b. 083: customer returns (partial / full) - own document, negative weight and value; the sale row stays as it was
  SELECT
    r.id AS tx_id,
    'return'::text AS tx_type,
    r.return_date AS tx_date,
    r.customer_id,
    COALESCE(c.customer_code, 'CUST-XXXX') AS customer_code,
    COALESCE(c.contact_name, 'Mijoz') AS customer_name,
    r.seller_id,
    COALESCE(e.full_name, e.name, 'Sotuvchi') AS seller_name,
    ('Vozvrat ' || r.return_no || ': ' || COALESCE(s.product_name, ''))::text AS model_name,
    'RETURN'::text AS model_code,
    NULL::uuid AS item_id,
    -r.returned_weight_grams AS sold_weight_g,
    s.client_markup_pct AS markup_pct,
    -r.client_gold_due_returned_g AS obligation_g,
    0::numeric AS scrap_received_g,
    0::numeric AS cash_received_uzs,
    0::numeric AS rate_per_gram,
    0::numeric AS cash_equiv_g,
    0::numeric AS usd_received,
    0::numeric AS usd_rate,
    0::numeric AS usd_equiv_g,
    0::numeric AS total_payment_g,
    CASE WHEN r.sale_currency = 'XAU585' THEN r.customer_debt_after ELSE 0 END::numeric AS closing_debt_g,
    r.reason AS notes,
    r.status
  FROM public.jewelry_sale_returns r
  JOIN public.jewelry_sales s ON s.id = r.sale_id
  JOIN public.customers c ON c.id = r.customer_id
  JOIN public.employees e ON e.id = r.seller_id
  WHERE r.organization_id = v_caller_org
    AND r.return_date BETWEEN v_from AND v_to
    AND (v_filter_seller IS NULL OR r.seller_id = v_filter_seller)

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

  -- 089: UZS / USD debt payments (CPAY): their own type; the gram columns stay 0 (not a 585 payment - never summed with
  --      SETTL grams); a reversed CPAY keeps its row with status 'reversed' (same as SETTL)
  UNION ALL

  SELECT
    cc.id AS tx_id,
    'currency_payment'::text AS tx_type,
    cc.settlement_date AS tx_date,
    cc.customer_id,
    COALESCE(c.customer_code, 'CUST-XXXX') AS customer_code,
    COALESCE(c.contact_name, 'Mijoz') AS customer_name,
    cc.seller_id,
    COALESCE(e.full_name, e.name, 'Sotuvchi') AS seller_name,
    ('CPAY ' || cc.debt_currency || ' qarz to''lovi: ' || cc.credited_amount || ' ' || cc.debt_currency)::text AS model_name,
    ('CPAY-' || cc.debt_currency)::text AS model_code,
    NULL::uuid AS item_id,
    0::numeric AS sold_weight_g,
    0::numeric AS markup_pct,
    0::numeric AS obligation_g,
    0::numeric AS scrap_received_g,
    COALESCE(cc.cash_uzs, 0)::numeric AS cash_received_uzs,
    COALESCE(cc.rate_lom_uzs, 0)::numeric AS rate_per_gram,
    0::numeric AS cash_equiv_g,
    COALESCE(cc.usd_amount, 0)::numeric AS usd_received,
    COALESCE(cc.rate_usd_uzs, 0)::numeric AS usd_rate,
    0::numeric AS usd_equiv_g,
    0::numeric AS total_payment_g,
    0::numeric AS closing_debt_g,
    concat_ws(' | ', cc.settlement_no, cc.notes, CASE WHEN cc.status = 'reversed' THEN 'BEKOR: ' || COALESCE(cc.reversal_reason, '') END)::text AS notes,
    cc.status
  FROM public.client_currency_settlements cc
  JOIN public.customers c ON c.id = cc.customer_id
  JOIN public.employees e ON e.id = cc.seller_id
  WHERE cc.organization_id = v_caller_org
    AND cc.settlement_date BETWEEN v_from AND v_to
    AND (v_filter_seller IS NULL OR cc.seller_id = v_filter_seller)

  UNION ALL

  -- 089: old-sale (pre-T0) returns: the goods back (negative sold grams) and the 585 value (0 for a UZS / USD value)
  SELECT
    o.id AS tx_id,
    'opening_return'::text AS tx_type,
    o.return_date AS tx_date,
    o.customer_id,
    COALESCE(c.customer_code, 'CUST-XXXX') AS customer_code,
    COALESCE(c.contact_name, 'Mijoz') AS customer_name,
    o.seller_id,
    COALESCE(e.full_name, e.name, 'Sotuvchi') AS seller_name,
    ('Eski savdodan vozvrat ' || o.return_no || ' (' || o.unit || ')')::text AS model_name,
    'OPENING-RETURN'::text AS model_code,
    o.piece_id AS item_id,
    -o.returned_weight_grams AS sold_weight_g,
    o.customer_markup_pct AS markup_pct,
    CASE WHEN o.unit = 'G585' THEN -o.credit_amount ELSE 0 END::numeric AS obligation_g,
    0::numeric AS scrap_received_g,
    0::numeric AS cash_received_uzs,
    0::numeric AS rate_per_gram,
    0::numeric AS cash_equiv_g,
    0::numeric AS usd_received,
    0::numeric AS usd_rate,
    0::numeric AS usd_equiv_g,
    0::numeric AS total_payment_g,
    CASE WHEN o.unit = 'G585' THEN greatest(o.customer_net_after, 0) ELSE 0 END::numeric AS closing_debt_g,
    concat_ws(' | ', o.formula, o.reason, CASE WHEN o.status = 'reversed' THEN 'BEKOR: ' || COALESCE(o.reversal_reason, '') END)::text AS notes,
    o.status
  FROM public.opening_sale_returns o
  JOIN public.customers c ON c.id = o.customer_id
  JOIN public.employees e ON e.id = o.seller_id
  WHERE o.organization_id = v_caller_org
    AND o.return_date BETWEEN v_from AND v_to
    AND (v_filter_seller IS NULL OR o.seller_id = v_filter_seller)
  ORDER BY tx_date DESC, tx_id DESC;
END;
$$;

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
    v_rel := round(v_open, 4);
  elsif v_doc.equiv_585_g is not null and coalesce(v_doc.seller_obligation_g, 0) > 0 then
    -- rated F: the paid part's share of the document's rate snapshot (the whole rest when it pays the opening debt off)
    v_snap := greatest(0, v_doc.seller_obligation_g - coalesce((select sum(c.snapshot_released_g) from public.client_currency_settlements c
                where c.opening_document_id = v_doc.id and c.status <> 'reversed'), 0) - v_ret.released_g);
    v_rel := case when v_open <= 0 then 0 when v_open >= v_rem then v_snap
                  else least(v_snap, round(v_open * v_doc.seller_obligation_g / v_doc.amount, 4)) end;
  else
    v_rel := 0; -- unrated F: the unpaid opening debt was never in the seller's obligation
  end if;
  v_formula := v_formula || '; qarzdan ' || v_debt || ', avansga ' || v_adv
               || '; boshlang''ich qarz qismi ' || v_open || ' -> sotuvchi majburiyatidan ' || v_rel || ' g';
  return jsonb_build_object('opening_document_id', v_doc.id, 'opening_document_no', v_doc.document_no, 'seller_id', v_doc.seller_id,
    'unit', v_unit, 'weight_g', v_w, 'customer_pct', p_customer_pct, 'credit', v_credit, 'customer_net_before', v_net,
    'debt_reduced', v_debt, 'advance_created', v_adv, 'customer_net_after', v_net - v_credit,
    'opening_remaining', v_rem, 'opening_part', v_open, 'seller_obligation_released_g', v_rel,
    'rated', (v_unit = 'G585' or v_doc.equiv_585_g is not null), 'formula', v_formula);
end $f$;
revoke all on function public._goldia_opening_return_calc(uuid, uuid, text, numeric, numeric, numeric) from public, anon, authenticated;

-- preview (read only): exactly what the record would do, so the operator confirms the numbers before writing
create or replace function public.rpc_preview_opening_sale_return(p_customer_id uuid, p_unit text, p_weight_grams numeric,
  p_customer_markup_pct numeric default null, p_credit_amount numeric default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare v_org uuid := public.current_organization_id();
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if not exists (select 1 from public.customers where id = p_customer_id and organization_id = v_org) then raise exception 'Mijoz topilmadi'; end if;
  return public._goldia_opening_return_calc(v_org, p_customer_id, p_unit, p_weight_grams, p_customer_markup_pct, p_credit_amount);
end $f$;
revoke all on function public.rpc_preview_opening_sale_return(uuid, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.rpc_preview_opening_sale_return(uuid, text, numeric, numeric, numeric) to authenticated, service_role;

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
  if v_recv = 'seller' then
    if p_seller_markup_pct is null or p_seller_markup_pct < 0 or p_seller_markup_pct > 100 then
      raise exception 'ERR_PCT_REQUIRED: sotuvchi javoniga qaytsa, sotuvchi majburiyati foizi (0 - 100) kiritilishi shart' using errcode = '22023';
    end if;
    v_spct := round(p_seller_markup_pct::numeric, 2);
  else
    v_spct := 0; -- the lot goes straight on to the manager: the seller's obligation for it is added and removed (net 0)
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
  v_sobl := round(v_w * (1 + v_spct / 100.0), 4);
  insert into public.seller_consignments (organization_id, consignment_no, seller_id, factory_receipt_id, product_name, quantity,
    base_weight_grams, proba, factory_markup_pct, factory_gold_due_grams, factory_remaining_gold_grams, seller_markup_pct,
    seller_obligation_g, status, notes, issued_at)
  -- factory_gold_due_grams must be > 0 (table check): grams x (1 + 0 %) for display only - there is no factory receipt, the
  -- factory account (vault) is not touched; the seller's obligation is seller_obligation_g
  values (v_org, 'CONS-' || v_no, v_seller, null, 'Eski savdodan vozvrat', 1, v_w, 585, 0, v_w, v_w, v_spct, v_sobl, 'held_by_seller',
    'ESKI SAVDODAN VOZVRAT ' || v_no || ' (' || (v_c ->> 'opening_document_no') || ')', clock_timestamp())
  returning id into v_con_id;
  insert into public.consignment_pieces (organization_id, consignment_id, model_code, model_name, category, purity, proba, weight_grams,
    status, seller_id, seller_markup_pct, seller_obligation_grams, notes)
  values (v_org, v_con_id, 'VOZVRAT', 'Eski savdodan vozvrat', 'Buyum', 585, 585, v_w, 'held_by_seller', v_seller, v_spct, v_sobl,
    'ESKI SAVDODAN VOZVRAT ' || v_no)
  returning id into v_piece_id;

  insert into public.opening_sale_returns (id, organization_id, return_no, opening_document_id, customer_id, seller_id, unit,
    returned_weight_grams, customer_markup_pct, credit_amount, debt_reduced, advance_created, opening_part, seller_obligation_released_g,
    receiver, receiver_seller_markup_pct, consignment_id, piece_id, customer_net_before, customer_net_after, formula, reason,
    idempotency_key, created_by)
  values (v_id, v_org, v_no, (v_c ->> 'opening_document_id')::uuid, v_cust.id, v_seller, v_unit, v_w,
    case when v_unit = 'G585' then round(p_customer_markup_pct::numeric, 2) end, v_credit, (v_c ->> 'debt_reduced')::numeric,
    (v_c ->> 'advance_created')::numeric, (v_c ->> 'opening_part')::numeric, (v_c ->> 'seller_obligation_released_g')::numeric,
    v_recv, case when v_recv = 'seller' then v_spct end, v_con_id, v_piece_id, (v_c ->> 'customer_net_before')::numeric, v_net_after,
    (v_c ->> 'formula') || case when v_recv = 'seller' then '; javonga: ' || v_w || ' g x (1 + ' || v_spct || ' %) = ' || v_sobl || ' g sotuvchi majburiyati'
                                else '; menejer omboriga ' || v_w || ' g' end,
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

notify pgrst, 'reload schema';
