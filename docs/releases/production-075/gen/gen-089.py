"""Generates supabase/migrations/20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql and its rollback
from the CURRENT bodies (the newest definition of each changed function in migrations <= 088: exact copies + the listed,
asserted replacements). Run: python3 -I gen-089.py"""
import os, re, glob
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..')
MIG = sorted(glob.glob(os.path.join(R, 'supabase/migrations/2026010100*.sql')))
MIG = [m for m in MIG if os.path.basename(m) < '20260101000089']


def latest(name):
    """the newest 'create or replace function public.<name>(' body (through its closing dollar tag + ';')"""
    pat = re.compile(r'create\s+or\s+replace\s+function\s+public\."?%s"?\s*\(' % re.escape(name), re.I)
    best = None
    for f in MIG:
        s = open(f, encoding='utf-8').read()
        for m in pat.finditer(s):
            best = (f, s, m.start())
    assert best, name
    f, s, i = best
    tm = re.compile(r'\bas\s+(\$[a-z_]*\$)', re.I).search(s, i)
    tag = tm.group(1)
    j = s.index(tag, tm.end()) + len(tag)
    assert s[j] == ';', (name, s[j:j + 10])
    return s[i:j + 1], os.path.basename(f)


def rep(s, a, b, n=1):
    assert s.count(a) == n, (a[:100], s.count(a))
    return s.replace(a, b)


CHANGED = ['_goldia_opening_seller_obligation', 'rpc_record_client_currency_settlement', '_goldia_period_effects',
           'rpc_get_unified_customer_ledger', 'rpc_get_daily_sales_ledger']
ORIG = {n: latest(n) for n in CHANGED}

out = ['''-- 089 - Goldia Sales (2026-11-18): the remaining post-launch functions in ONE release. Nothing existing is rewritten in
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
--      goods   kept by the seller: his OLD obligation of that debt (from the documents) moves unchanged onto a return
--              lot - his total obligation does not change (refused when part of the value has no documented obligation);
--              to the manager: through the existing rpc_return_piece_to_manager, the seller loses the old obligation,
--              manager stock +grams; never a factory receipt / factory obligation (pre-T0 goods were settled before T0, 088)
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
''']

out.append('''
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
  -- goods kept by the seller: his OLD obligation (from the documents) moved onto the return lot; 0 for the manager
  seller_lot_obligation_g       numeric(14, 4) not null default 0 check (seller_lot_obligation_g >= 0),
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
''')

# ---------------------------------------------------------------- 1. seller obligation: minus the released grams of old returns
fn, src = ORIG['_goldia_opening_seller_obligation']
fn = rep(fn, """        and c.status <> 'reversed'), 0)::numeric
$f$;""", """        and c.status <> 'reversed'), 0)::numeric
  -- 089: an old-sale return that paid (part of) an opening debt released that part of the seller's opening obligation
  - coalesce((select sum(r.seller_obligation_released_g) from public.opening_sale_returns r
      where r.organization_id = p_org and r.seller_id = p_seller and r.status = 'confirmed'), 0)::numeric
$f$;""")
out.append('\n-- ===== ' + CHANGED[0] + ' (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- 2. CPAY: what is left of the opening debt excludes old returns
fn, src = ORIG['rpc_record_client_currency_settlement']
fn = rep(fn, """    v_od_rem := v_od.amount - coalesce((select sum(coalesce(c.opening_applied_amount, c.applied_to_debt)) from public.client_currency_settlements c
                  where c.opening_document_id = v_od.id and c.status <> 'reversed'), 0);""",
         """    v_od_rem := v_od.amount - coalesce((select sum(coalesce(c.opening_applied_amount, c.applied_to_debt)) from public.client_currency_settlements c
                  where c.opening_document_id = v_od.id and c.status <> 'reversed'), 0)
                - (select x.amount from public._goldia_opening_returned(v_od.id) x); -- 089: old-sale returns paid that part""")
fn = rep(fn, """    v_snap_g := least(greatest(0, v_od.seller_obligation_g - coalesce((select sum(c.snapshot_released_g) from public.client_currency_settlements c
                        where c.opening_document_id = v_od.id and c.status <> 'reversed'), 0)),""",
         """    v_snap_g := least(greatest(0, v_od.seller_obligation_g - coalesce((select sum(c.snapshot_released_g) from public.client_currency_settlements c
                        where c.opening_document_id = v_od.id and c.status <> 'reversed'), 0)
                        - (select x.released_g from public._goldia_opening_returned(v_od.id) x)),""")
out.append('\n-- ===== ' + CHANGED[1] + ' (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- 3. period effects: old-sale returns (customer side; the lot is a consignment row)
fn, src = ORIG['_goldia_period_effects']
fn = rep(fn, """  -- 085: opening documents that have no row of their own""", """  -- 089: old-sale returns: the customer's 585 / UZS / USD balance goes down by the value (debt + advance part); the goods
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
  -- 085: opening documents that have no row of their own""")
out.append('\n-- ===== ' + CHANGED[2] + ' (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- 4. unified ledger: old-return 585 credit + currency columns
fn, src = ORIG['rpc_get_unified_customer_ledger']
fn = rep(fn, """  v_rows           jsonb := '[]'::jsonb;
begin""", """  v_rows           jsonb := '[]'::jsonb;
  v_old_ret_g      numeric(14, 4);
  v_cur            jsonb;
begin""")
fn = rep(fn, """    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';

    -- 3. Total Unreversed Scrap Gold Paid""", """    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';
    -- 089: an old-sale return (pre-T0 goods) lowers the opening (old) 585 balance by its value
    select coalesce(sum(credit_amount), 0) into v_old_ret_g from public.opening_sale_returns
     where customer_id = v_cust_rec.id and organization_id = v_caller_org and status = 'confirmed' and unit = 'G585';
    v_legacy_debt := round(v_legacy_debt - v_old_ret_g, 4);

    -- 3. Total Unreversed Scrap Gold Paid""")
fn = rep(fn, """      'net_debt_g', v_net_debt
    );""", """      'net_debt_g', v_net_debt,
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
    );""")
out.append('\n-- ===== ' + CHANGED[3] + ' (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- 5. daily / customer journal: CPAY and old-sale return rows
fn, src = ORIG['rpc_get_daily_sales_ledger']
fn = rep(fn, """  ORDER BY tx_date DESC, tx_id DESC;""", """
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
  ORDER BY tx_date DESC, tx_id DESC;""")
out.append('\n-- ===== ' + CHANGED[4] + ' (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- new functions
out.append(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sql-089-new.sql'), encoding='utf-8').read())
out.append("\nnotify pgrst, 'reload schema';\n")
dst = os.path.join(R, 'supabase/migrations/20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql')
open(dst, 'w', encoding='utf-8').write(''.join(out))
print('written', dst, sum(1 for _ in open(dst, encoding='utf-8')))

# ---------------------------------------------------------------- rollback 089 (back to exactly 088)
rb = ['''-- Rollback of 089: back to exactly 088 (the previous bodies of the changed functions; the new functions and tables
-- dropped). Refused once an old-sale return or a till count exists (their effect exists only in 089).
do $g$ begin
  if exists (select 1 from public.opening_sale_returns) then raise exception 'ROLLBACK 089 REFUSED: old-sale return documents exist'; end if;
  if exists (select 1 from public.seller_till_counts) then raise exception 'ROLLBACK 089 REFUSED: seller till counts exist'; end if;
end $g$;
drop function if exists public.rpc_record_opening_sale_return(uuid, text, numeric, numeric, numeric, text, numeric, text, boolean, text);
drop function if exists public.rpc_reverse_opening_sale_return(uuid, text, text);
drop function if exists public.rpc_preview_opening_sale_return(uuid, text, numeric, numeric, numeric, text);
drop function if exists public.rpc_correct_client_payment(text, uuid, text, jsonb, text, text);
drop function if exists public.rpc_record_seller_till_count(uuid, numeric, numeric, text, text, text);
drop function if exists public._goldia_opening_return_calc(uuid, uuid, text, numeric, numeric, numeric);
drop function if exists public.rpc_get_seller_stock_movements(uuid, date, date);
''']
for n in CHANGED:
    rb.append('\n' + ORIG[n][0] + '\n')
rb.append('''
drop function if exists public._goldia_opening_returned(uuid);
drop table if exists public.seller_till_counts;
drop table if exists public.opening_sale_returns;
notify pgrst, 'reload schema';
''')
open(os.path.join(R, 'supabase/rollback/20260101000089_rollback.sql'), 'w', encoding='utf-8').write(''.join(rb))
print('written rollback')
