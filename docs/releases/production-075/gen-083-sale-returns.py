#!/usr/bin/env python3
# Generates supabase/migrations/20260101000083_goldia_partial_sale_returns.sql and its rollback.
# New objects are written here; every changed existing function is taken from its LATEST repository definition and
# patched with exact, asserted replacements (each patch must match exactly once), so nothing else in those bodies moves.
import re, glob, pathlib
REPO = pathlib.Path(__file__).resolve().parents[3]
FILES = sorted(glob.glob(str(REPO / "supabase/migrations/*.sql")))
FILES = [f for f in FILES if "20260101000083_" not in f]

def latest(fn):
    body = src = None
    for f in FILES:
        s = pathlib.Path(f).read_text(encoding="utf-8").replace("\r\n", "\n")
        for m in re.finditer(r"create\s+or\s+replace\s+function\s+public\." + re.escape(fn) + r"\s*\(", s, re.I):
            st = m.start()
            tag = re.search(r"\bas\s+(\$[a-z_]*\$)", s[st:st + 4000], re.I).group(1)
            e = s.find(tag, s.find(tag, st) + len(tag)) + len(tag)
            body, src = s[st:e], pathlib.Path(f).name
    assert body, fn
    return body, src

def patch(body, pairs, fn):
    for old, new in pairs:
        n = body.count(old)
        assert n == 1, (fn, n, old[:100])
        body = body.replace(old, new)
    return body

R = "public.jewelry_sale_returns"
P = {}   # fn -> list of (old, new)
P["recalc_seller_gold_account"] = [(
"""  SELECT COALESCE(SUM(base_weight_grams), 0)
  INTO v_total_sold
  FROM public.jewelry_sales
  WHERE seller_id = p_seller_id AND organization_id = p_org_id
    AND status NOT IN ('cancelled', 'reversed');""",
"""  SELECT COALESCE(SUM(base_weight_grams), 0)
  INTO v_total_sold
  FROM public.jewelry_sales
  WHERE seller_id = p_seller_id AND organization_id = p_org_id
    AND status NOT IN ('cancelled', 'reversed');
  -- 083: grams of confirmed customer returns are back on the seller (a return to the manager then leaves through
  -- rpc_return_piece_to_manager, which lowers the consignment like any other returned piece)
  v_total_sold := v_total_sold - COALESCE((SELECT SUM(returned_weight_grams) FROM public.jewelry_sale_returns
                                            WHERE seller_id = p_seller_id AND organization_id = p_org_id AND status = 'confirmed'), 0);""")]
P["get_seller_available_stock_grams"] = [(
"""  select coalesce(sum(base_weight_grams), 0) into v_sold
    from public.jewelry_sales
   where seller_id = p_seller_id and organization_id = v_org_id
     and status not in ('cancelled', 'reversed');""",
"""  select coalesce(sum(base_weight_grams), 0) into v_sold
    from public.jewelry_sales
   where seller_id = p_seller_id and organization_id = v_org_id
     and status not in ('cancelled', 'reversed');
  -- 083: confirmed customer returns are back on the seller
  v_sold := v_sold - coalesce((select sum(returned_weight_grams) from public.jewelry_sale_returns
                                where seller_id = p_seller_id and organization_id = v_org_id and status = 'confirmed'), 0);""")]
P["rpc_get_unified_customer_ledger"] = [(
"""    select coalesce(sum(client_gold_due_grams), 0)
    into v_gross_sales
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';""",
"""    select coalesce(sum(client_gold_due_grams), 0)
    into v_gross_sales
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';
    -- 083: minus the 585 value of confirmed partial / full returns
    v_gross_sales := round(v_gross_sales - coalesce((select sum(client_gold_due_returned_g) from public.jewelry_sale_returns
                       where customer_id = v_cust_rec.id and organization_id = v_caller_org and status = 'confirmed'), 0), 4);""")]
P["rpc_get_customer_monthly_report"] = [
("""  v_month_legacy_adv numeric(14, 4);""", """  v_month_legacy_adv numeric(14, 4);
  v_month_returns numeric(14, 4);
  v_tot_returns   numeric(14, 4) := 0;"""),
("""    select v_open_debt + coalesce(sum(client_gold_due_grams), 0) into v_open_debt
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and sale_date < v_start_date
      and status <> 'reversed';""",
"""    select v_open_debt + coalesce(sum(client_gold_due_grams), 0) into v_open_debt
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and sale_date < v_start_date
      and status <> 'reversed';
    -- 083: confirmed returns before the month lower the opening balance
    v_open_debt := v_open_debt - coalesce((select sum(client_gold_due_returned_g) from public.jewelry_sale_returns
                     where customer_id = v_cust_rec.id and return_date < v_start_date and status = 'confirmed'), 0);"""),
("""    -- 4. Payments during selected month (EXCLUDE REVERSED!)""",
"""    -- 3b. 083: 585 value of confirmed returns in the month
    select coalesce(sum(client_gold_due_returned_g), 0) into v_month_returns
    from public.jewelry_sale_returns
    where customer_id = v_cust_rec.id and status = 'confirmed'
      and return_date between v_start_date and v_end_date;

    -- 4. Payments during selected month (EXCLUDE REVERSED!)"""),
("""    v_close_net  := round(v_open_net + v_month_legacy - v_month_legacy_adv + v_month_sales - v_month_settle, 4);""",
 """    v_close_net  := round(v_open_net + v_month_legacy - v_month_legacy_adv + v_month_sales - v_month_returns - v_month_settle, 4);"""),
("""or v_month_sales <> 0 or v_month_settle <> 0 or v_close_net <> 0 then""",
 """or v_month_sales <> 0 or v_month_returns <> 0 or v_month_settle <> 0 or v_close_net <> 0 then"""),
("""        'sales_in_month_g', v_month_sales,""", """        'sales_in_month_g', v_month_sales,
        'returns_in_month_g', v_month_returns,"""),
("""      v_tot_dist := v_tot_dist + v_month_sales;""", """      v_tot_dist := v_tot_dist + v_month_sales;
      v_tot_returns := v_tot_returns + v_month_returns;"""),
("""      'total_distributed_month_g', v_tot_dist,""", """      'total_distributed_month_g', v_tot_dist,
      'total_returns_month_g', v_tot_returns,"""),
]
P["rpc_get_daily_sales_ledger"] = [(
"""  UNION ALL

  -- 2. Payment/Settlement entries""",
"""  UNION ALL

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

  -- 2. Payment/Settlement entries""")]
P["_goldia_period_effects"] = [(
"""    from sales where status in ('reversed', 'cancelled')""",
"""    from sales where status in ('reversed', 'cancelled')
  -- 083: customer returns: the returned grams come back to the seller, the debt in 585 g or in the sale's currency goes
  --      down by the returned value (debt part + new advance part); the original sale stays in its own period
  union all
  select case r.sale_currency when 'XAU585' then 'return_gram' when 'UZS' then 'return_uzs' else 'return_usd' end, r.return_date, r.seller_id, 1,
         case when r.sale_currency = 'XAU585' then -r.client_gold_due_returned_g else 0 end,
         case when r.sale_currency = 'UZS' then -r.sale_amount_returned else 0 end, case when r.sale_currency = 'USD' then -r.sale_amount_returned else 0 end,
         r.returned_weight_grams, 0, 0, 0, 0, 0, 0,
         r.returned_weight_grams, r.client_gold_due_returned_g, r.sale_amount_returned, r.advance_created
    from public.jewelry_sale_returns r where r.organization_id = p_org and r.status = 'confirmed'""")]
P["rpc_get_seller_markup_difference_report"] = [
("""    select js.*, (js.status in ('reversed', 'cancelled')) as is_reversed,""",
 """    select js.*, (js.status in ('reversed', 'cancelled')) as is_reversed,
           -- 083: markup difference of the returned share leaves the report
           coalesce((select sum(r.markup_difference_returned_g) from public.jewelry_sale_returns r
                      where r.sale_id = js.id and r.status = 'confirmed'), 0) as returned_markup_difference_g,"""),
("""  active as (select * from s where not is_reversed and markup_difference_g is not null)""",
 """  active as (select s.id, s.seller_id, s.paid_ratio, round(s.markup_difference_g - s.returned_markup_difference_g, 4) as markup_difference_g
               from s where not is_reversed and markup_difference_g is not null)"""),
("""'markup_difference_g', x.markup_difference_g,""", """'markup_difference_g', x.markup_difference_g, 'returned_markup_difference_g', x.returned_markup_difference_g,"""),
]
P["rpc_get_seller_reconciliation_statement"] = [
("""         - COALESCE((SELECT SUM(base_weight_grams) FROM public.jewelry_sales
                      WHERE seller_id = p_seller_id AND organization_id = v_caller_org
                        AND status NOT IN ('cancelled', 'reversed')), 0)), 4)""",
 """         - COALESCE((SELECT SUM(base_weight_grams) FROM public.jewelry_sales
                      WHERE seller_id = p_seller_id AND organization_id = v_caller_org
                        AND status NOT IN ('cancelled', 'reversed')), 0)
         -- 083: confirmed customer returns are back on the seller
         + COALESCE((SELECT SUM(returned_weight_grams) FROM public.jewelry_sale_returns
                      WHERE seller_id = p_seller_id AND organization_id = v_caller_org AND status = 'confirmed'), 0)), 4)"""),
("""  WHERE s.seller_id = p_seller_id
    AND s.organization_id = v_caller_org
    AND s.status NOT IN ('cancelled', 'reversed');

  -- Section D: Customer Receivables & Payments""",
 """  WHERE s.seller_id = p_seller_id
    AND s.organization_id = v_caller_org
    AND s.status NOT IN ('cancelled', 'reversed');
  -- 083: returned grams are no longer sold (equivalent with the returned piece's own markup)
  SELECT v_sec_c_orig_g - COALESCE(SUM(r.returned_weight_grams), 0),
         v_sec_c_equiv_g - COALESCE(SUM(ROUND(r.returned_weight_grams * (1.0 + COALESCE(cp.seller_markup_pct, 12.0) / 100.0), 4)), 0)
    INTO v_sec_c_orig_g, v_sec_c_equiv_g
    FROM public.jewelry_sale_returns r
    LEFT JOIN public.consignment_pieces cp ON cp.id = r.piece_id
   WHERE r.seller_id = p_seller_id AND r.organization_id = v_caller_org AND r.status = 'confirmed';

  -- Section D: Customer Receivables & Payments"""),
("""  INTO v_sec_d_client_obl
  FROM public.jewelry_sales s
  WHERE s.seller_id = p_seller_id AND s.organization_id = v_caller_org AND s.status NOT IN ('cancelled', 'reversed');""",
 """  INTO v_sec_d_client_obl
  FROM public.jewelry_sales s
  WHERE s.seller_id = p_seller_id AND s.organization_id = v_caller_org AND s.status NOT IN ('cancelled', 'reversed');
  v_sec_d_client_obl := v_sec_d_client_obl - COALESCE((SELECT SUM(client_gold_due_returned_g) FROM public.jewelry_sale_returns
                          WHERE seller_id = p_seller_id AND organization_id = v_caller_org AND status = 'confirmed'), 0);"""),
]
P["rpc_get_three_tier_ledger_summary"] = [(
"""  select coalesce(sum(client_gold_due_grams), 0)
  into v_tier3_sales_due
  from public.jewelry_sales
  where organization_id = v_caller_org and status <> 'reversed';""",
"""  select coalesce(sum(client_gold_due_grams), 0)
  into v_tier3_sales_due
  from public.jewelry_sales
  where organization_id = v_caller_org and status <> 'reversed';
  -- 083: minus confirmed customer returns
  v_tier3_sales_due := v_tier3_sales_due - coalesce((select sum(client_gold_due_returned_g) from public.jewelry_sale_returns
                         where organization_id = v_caller_org and status = 'confirmed'), 0);""")]
P["rpc_execute_full_test_reset"] = [(
"""  -- A. Reverse sales""",
"""  -- A0. 083: returns are marked reversed first (their sales are reversed next; the sale-reversal guard allows it)
  update public.jewelry_sale_returns set status = 'reversed'
   where organization_id = v_caller_org and status = 'confirmed';

  -- A. Reverse sales""")]

NEW = r"""
-- ------------------------------------------------------------------ 1. return documents
create table if not exists public.jewelry_sale_returns (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organizations(id) on delete cascade,
  return_no                     text not null,
  sale_id                       uuid not null references public.jewelry_sales(id) on delete restrict,
  customer_id                   uuid not null references public.customers(id) on delete restrict,
  seller_id                     uuid not null references public.employees(id) on delete restrict,
  return_date                   date not null default public._goldia_business_date(),
  sale_type                     text not null,
  sale_currency                 text not null check (sale_currency in ('XAU585', 'UZS', 'USD')),
  returned_weight_grams         numeric(14, 4) not null check (returned_weight_grams > 0),
  client_gold_due_returned_g    numeric(14, 4) not null default 0 check (client_gold_due_returned_g >= 0),
  factory_gold_due_returned_g   numeric(14, 4) not null default 0 check (factory_gold_due_returned_g >= 0),
  markup_spread_returned_g      numeric(14, 4) not null default 0,
  markup_difference_returned_g  numeric(14, 4) not null default 0,
  sale_amount_returned          numeric(18, 2) not null default 0 check (sale_amount_returned >= 0),
  debt_reduced                  numeric(18, 4) not null default 0 check (debt_reduced >= 0),
  advance_created               numeric(18, 4) not null default 0 check (advance_created >= 0),
  customer_debt_after           numeric(18, 4) not null default 0,
  customer_advance_after        numeric(18, 4) not null default 0,
  destination                   text not null check (destination in ('seller', 'manager')),
  received_by                   uuid references public.employees(id),
  piece_id                      uuid references public.consignment_pieces(id),
  reason                        text not null check (length(btrim(reason)) > 0),
  idempotency_key               text unique,
  status                        text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  created_by                    uuid references public.employees(id),
  created_at                    timestamptz not null default now(),
  constraint uq_jewelry_sale_returns_tenant_no unique (organization_id, return_no),
  -- the returned value is split exactly into debt reduction + new advance (advance-only rule, decision 2026-11-09)
  constraint jewelry_sale_returns_value_split check (
    debt_reduced + advance_created = case when sale_currency = 'XAU585' then client_gold_due_returned_g else sale_amount_returned end)
);
create index if not exists idx_jewelry_sale_returns_sale on public.jewelry_sale_returns (sale_id);
create index if not exists idx_jewelry_sale_returns_customer on public.jewelry_sale_returns (customer_id);
create index if not exists idx_jewelry_sale_returns_seller on public.jewelry_sale_returns (seller_id);

alter table public.jewelry_sale_returns enable row level security;
drop policy if exists jewelry_sale_returns_select_policy on public.jewelry_sale_returns;
create policy jewelry_sale_returns_select_policy on public.jewelry_sale_returns for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or public.current_employee_role_text() in ('accountant', 'buxgalter')
              or seller_id in (select e.id from public.employees e where e.user_id = auth.uid())));
revoke all on public.jewelry_sale_returns from anon;
revoke insert, update, delete, truncate on public.jewelry_sale_returns from authenticated;
grant select on public.jewelry_sale_returns to authenticated;

-- ------------------------------------------------------------------ 2. a sale with returns cannot be reversed as a whole
create or replace function public._goldia_guard_sale_reversal_with_returns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.status in ('reversed', 'cancelled') and old.status not in ('reversed', 'cancelled')
     and exists (select 1 from public.jewelry_sale_returns r where r.sale_id = new.id and r.status = 'confirmed') then
    raise exception 'ERR_SALE_HAS_RETURNS: Ushbu savdodan vozvrat qilingan (%) - butun savdoni bekor qilib bo''lmaydi; qolgan qismini vozvrat qiling', new.sale_no;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_goldia_guard_sale_reversal_with_returns on public.jewelry_sales;
create trigger trg_goldia_guard_sale_reversal_with_returns before update of status on public.jewelry_sales
  for each row execute function public._goldia_guard_sale_reversal_with_returns();
revoke execute on function public._goldia_guard_sale_reversal_with_returns() from public, anon, authenticated;

-- ------------------------------------------------------------------ 3. the return operation
CREATE OR REPLACE FUNCTION public.rpc_record_sale_return(p_sale_id uuid, p_weight_grams numeric, p_reason text,
  p_destination text DEFAULT 'seller'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org        uuid := public.current_organization_id();
  v_role       text := public.current_employee_role_text();
  v_emp        uuid := public.current_employee_id();
  v_reason     text := nullif(btrim(p_reason), '');
  v_dest       text := coalesce(nullif(btrim(p_destination), ''), 'seller');
  v_key        text := nullif(btrim(p_idempotency_key), '');
  v_w          numeric(14, 4) := round(coalesce(p_weight_grams, 0)::numeric, 4);
  v_sale       public.jewelry_sales%rowtype;
  v_cur        text;
  v_prev_n     integer;
  v_prev_w     numeric(14, 4);
  v_prev_due   numeric(14, 4);
  v_prev_fdue  numeric(14, 4);
  v_prev_spr   numeric(14, 4);
  v_prev_mdif  numeric(14, 4);
  v_prev_amt   numeric(18, 2);
  v_rem_w      numeric(14, 4);
  v_last       boolean;
  v_due        numeric(14, 4);
  v_fdue       numeric(14, 4);
  v_spr        numeric(14, 4);
  v_mdif       numeric(14, 4);
  v_amt        numeric(18, 2);
  v_value      numeric(18, 4);
  v_net        numeric(18, 4);
  v_new_net    numeric(18, 4);
  v_debt_red   numeric(18, 4);
  v_adv_new    numeric(18, 4);
  v_piece      public.consignment_pieces%rowtype;
  v_src        public.consignment_pieces%rowtype;
  v_consign    public.seller_consignments%rowtype;
  v_piece_id   uuid;
  v_markup     numeric;
  v_return_id  uuid;
  v_return_no  text;
  v_payload    jsonb;
  v_existing   jsonb;
  v_mgr        jsonb;
  v_res        jsonb;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  -- same rights as a sale reversal (decision 2026-11-09): seller only his own sale, manager / director any sale
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi']);
  if v_reason is null then
    raise exception 'Vozvrat sababi kiritilishi shart';
  end if;
  if v_key is null then
    raise exception 'Vozvrat uchun takrorlanmas so''rov kaliti (idempotency key) majburiy';
  end if;
  if v_w <= 0 then
    raise exception 'Qaytariladigan vazn 0 dan katta bo''lishi shart';
  end if;
  if v_dest not in ('seller', 'manager') then
    raise exception 'Qabul qiluvchi faqat "seller" (sotuvchi ombori) yoki "manager" (menejer) bo''lishi mumkin';
  end if;
  if v_dest = 'manager' and not public._goldia_is_management_role(v_role) then
    raise exception 'Ruxsat etilmadi: mahsulotni menejer qabul qilganini faqat menejer yoki direktor tasdiqlaydi' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object('action', 'record_sale_return', 'sale_id', p_sale_id, 'weight_grams', v_w, 'destination', v_dest);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_record_sale_return', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. the sale row lock serializes every return of this sale (parallel requests, double clicks)
  select * into v_sale from public.jewelry_sales where id = p_sale_id and organization_id = v_org for update;
  if not found then
    raise exception 'Savdo hujjati topilmadi (%)', p_sale_id;
  end if;
  if v_sale.status in ('reversed', 'cancelled') then
    raise exception 'Bekor qilingan savdodan vozvrat qilib bo''lmaydi (%)', v_sale.sale_no;
  end if;
  if public._goldia_is_seller_role(v_role) and v_sale.seller_id is distinct from v_emp then
    raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''zi amalga oshirgan savdodan vozvrat qila oladi' using errcode = '42501';
  end if;
  v_cur := coalesce(v_sale.sale_currency, 'XAU585');

  select count(*), coalesce(sum(returned_weight_grams), 0), coalesce(sum(client_gold_due_returned_g), 0),
         coalesce(sum(factory_gold_due_returned_g), 0), coalesce(sum(markup_spread_returned_g), 0),
         coalesce(sum(markup_difference_returned_g), 0), coalesce(sum(sale_amount_returned), 0)
    into v_prev_n, v_prev_w, v_prev_due, v_prev_fdue, v_prev_spr, v_prev_mdif, v_prev_amt
    from public.jewelry_sale_returns where sale_id = v_sale.id and status = 'confirmed';

  -- double clicks / parallel requests: the mandatory idempotency key (replay) + the sale row lock above; two separate
  -- identical returns (e.g. two 1 g rings) are legitimate and are NOT refused by a time window

  v_rem_w := round(v_sale.base_weight_grams - v_prev_w, 4);
  if v_rem_w <= 0 then
    raise exception 'Ushbu savdo to''liq qaytarilgan (%)', v_sale.sale_no;
  end if;
  if v_w > v_rem_w then
    raise exception 'Qaytariladigan vazn (% g) savdoning qaytarilmagan qismidan (% g) oshadi', v_w, v_rem_w;
  end if;
  if v_sale.sale_type = 'piece' and (v_prev_n > 0 or v_w <> round(v_sale.base_weight_grams, 4)) then
    raise exception 'Barcode (dona) savdo faqat butun dona sifatida qaytariladi: % g', round(v_sale.base_weight_grams, 4);
  end if;

  -- 2. value of the returned share: proportional to the ORIGINAL sale (grams x original markup, or the original UZS / USD
  --    amount); never re-priced at today's rate. The return that completes the sale takes the exact remainder, so the
  --    returns of one sale always add up to the sale itself (no rounding drift).
  v_last := (v_w = v_rem_w);
  if v_last then
    v_due  := round(v_sale.client_gold_due_grams - v_prev_due, 4);
    v_fdue := round(v_sale.factory_gold_due_grams - v_prev_fdue, 4);
    v_spr  := round(coalesce(v_sale.markup_spread_grams, 0) - v_prev_spr, 4);
    v_mdif := round(coalesce(v_sale.markup_difference_g, 0) - v_prev_mdif, 4);
    v_amt  := case when v_cur = 'XAU585' then 0 else round(coalesce(v_sale.sale_amount, 0) - v_prev_amt, 2) end;
  else
    v_due  := round(v_sale.client_gold_due_grams * v_w / v_sale.base_weight_grams, 4);
    v_fdue := round(v_sale.factory_gold_due_grams * v_w / v_sale.base_weight_grams, 4);
    v_spr  := round(coalesce(v_sale.markup_spread_grams, 0) * v_w / v_sale.base_weight_grams, 4);
    v_mdif := round(coalesce(v_sale.markup_difference_g, 0) * v_w / v_sale.base_weight_grams, 4);
    v_amt  := case when v_cur = 'XAU585' then 0 else round(coalesce(v_sale.sale_amount, 0) * v_w / v_sale.base_weight_grams, 2) end;
  end if;
  if v_due < 0 or v_amt < 0 or v_prev_due + v_due > v_sale.client_gold_due_grams
     or (v_cur <> 'XAU585' and v_prev_amt + v_amt > coalesce(v_sale.sale_amount, 0)) then
    raise exception 'Vozvrat qiymati savdo qiymatidan oshib ketadi - to''xtatildi (%)', v_sale.sale_no;
  end if;
  v_value := case when v_cur = 'XAU585' then v_due else v_amt end;

  -- 3. the customer's balance in the sale's own unit: the open debt goes down first, the rest becomes an advance
  --    (no negative debt, no cash refund - decision 2026-11-09)
  if v_cur = 'XAU585' then
    select current_debt_grams - advance_balance_grams into v_net
      from public.client_gold_accounts where customer_id = v_sale.customer_id and organization_id = v_org for update;
    if not found then
      raise exception 'Mijozning 585 hisobi topilmadi (%)', v_sale.customer_id;
    end if;
  else
    select debt_amount - advance_amount into v_net
      from public.client_currency_accounts where customer_id = v_sale.customer_id and organization_id = v_org and currency = v_cur for update;
    if not found then
      raise exception 'Mijozning % hisobi topilmadi (%)', v_cur, v_sale.customer_id;
    end if;
  end if;
  v_debt_red := least(v_value, greatest(v_net, 0));
  v_adv_new  := v_value - v_debt_red;
  v_new_net  := v_net - v_value;
  if v_cur = 'XAU585' then
    update public.client_gold_accounts
       set current_debt_grams = round(greatest(v_new_net, 0), 4),
           advance_balance_grams = round(greatest(-v_new_net, 0), 4),
           total_purchased_gold_grams = round(greatest(0, total_purchased_gold_grams - v_due), 4),
           updated_at = now()
     where customer_id = v_sale.customer_id and organization_id = v_org;
  else
    update public.client_currency_accounts
       set debt_amount = round(greatest(v_new_net, 0), 2),
           advance_amount = round(greatest(-v_new_net, 0), 2),
           total_sold_amount = greatest(0, total_sold_amount - v_amt),
           updated_at = now()
     where customer_id = v_sale.customer_id and organization_id = v_org and currency = v_cur;
  end if;

  -- 4. the physical goods come back onto the seller's shelf as a held piece (stock = held pieces stays true)
  v_return_no := v_sale.sale_no || '-V' || (v_prev_n + 1);
  select * into v_piece from public.consignment_pieces
   where sale_id = v_sale.id and organization_id = v_org and status = 'sold'
   order by updated_at desc limit 1 for update;
  if v_sale.sale_type = 'piece' and found then
    -- barcode piece: the very piece goes back (whole piece only)
    if round(v_piece.weight_grams, 4) <> v_w then
      raise exception 'Dona og''irligi (% g) savdo vazniga (% g) teng emas - vozvrat to''xtatildi', v_piece.weight_grams, v_w;
    end if;
    update public.consignment_pieces
       set status = 'held_by_seller', sale_id = null, sold_at = null,
           notes = coalesce(notes, '') || ' [VOZVRAT ' || v_return_no || ']', updated_at = now()
     where id = v_piece.id;
    v_piece_id := v_piece.id;
    select * into v_consign from public.seller_consignments where id = v_piece.consignment_id and organization_id = v_org for update;
  else
    -- weight / UZS / USD sale: a new piece with the returned weight in the consignment the sale took its gold from
    select p.* into v_src from public.weight_sale_allocations a join public.consignment_pieces p on p.id = a.piece_id
     where a.sale_id = v_sale.id and a.reversed_at is null order by a.created_at desc, a.id desc limit 1;
    if v_src.id is null and v_sale.source_piece_id is not null then
      select * into v_src from public.consignment_pieces where id = v_sale.source_piece_id;
    end if;
    select * into v_consign from public.seller_consignments
     where id = coalesce(v_src.consignment_id, v_sale.consignment_id) and organization_id = v_org for update;
    if not found then
      raise exception 'Savdoning manba konsignatsiyasi topilmadi - vozvrat qayd etilmadi (%)', v_sale.sale_no;
    end if;
    v_markup := coalesce(v_src.seller_markup_pct, v_consign.seller_markup_pct, 0);
    insert into public.consignment_pieces (organization_id, consignment_id, model_id, model_code, model_name, category,
                                           purity, proba, weight_grams, status, seller_id, seller_markup_pct,
                                           seller_obligation_grams, notes)
    values (v_org, v_consign.id, v_src.model_id, coalesce(v_src.model_code, v_sale.model_code, 'VOZVRAT'),
            coalesce(v_src.model_name, v_sale.model_name, v_sale.product_name, 'Vozvrat'), coalesce(v_src.category, v_sale.category),
            coalesce(v_src.purity, v_sale.purity, 585), coalesce(v_src.proba, v_sale.proba, 585), v_w, 'held_by_seller',
            v_sale.seller_id, v_markup, round(v_w * (1 + v_markup / 100.0), 4),
            'VOZVRAT ' || v_return_no || ' (' || v_sale.sale_no || ')')
    returning id into v_piece_id;
  end if;
  if v_consign.seller_id is distinct from v_sale.seller_id then
    raise exception 'Manba konsignatsiya boshqa sotuvchiga tegishli - vozvrat to''xtatildi (%)', v_sale.sale_no;
  end if;
  if v_consign.status not in ('held_by_seller', 'partially_sold', 'fully_sold') then
    raise exception 'Manba konsignatsiya holati (%) vozvratga ruxsat bermaydi', v_consign.status;
  end if;
  update public.seller_consignments set status = 'partially_sold', updated_at = now()
   where id = v_consign.id and status = 'fully_sold';

  -- 5. the return document (the sale row is not touched: its history stays exactly as it was)
  insert into public.jewelry_sale_returns (organization_id, return_no, sale_id, customer_id, seller_id, sale_type, sale_currency,
         returned_weight_grams, client_gold_due_returned_g, factory_gold_due_returned_g, markup_spread_returned_g,
         markup_difference_returned_g, sale_amount_returned, debt_reduced, advance_created, customer_debt_after,
         customer_advance_after, destination, received_by, piece_id, reason, idempotency_key, created_by)
  values (v_org, v_return_no, v_sale.id, v_sale.customer_id, v_sale.seller_id, v_sale.sale_type, v_cur,
          v_w, case when v_cur = 'XAU585' then v_due else 0 end, v_fdue, v_spr, v_mdif, v_amt, v_debt_red, v_adv_new,
          greatest(v_new_net, 0), greatest(-v_new_net, 0), v_dest,
          case when v_dest = 'manager' then v_emp else v_sale.seller_id end, v_piece_id, v_reason, v_key, v_emp)
  returning id into v_return_id;

  perform public.recalc_seller_gold_account(v_sale.seller_id, v_org);

  -- 6. received by the manager: the returned piece leaves the seller through the existing audited flow
  --    (consignment weight and seller obligation go down, manager stock up) - the gold is counted once
  if v_dest = 'manager' then
    v_mgr := public.rpc_return_piece_to_manager(v_piece_id, 'VOZVRAT ' || v_return_no || ' - menejer qabul qildi', null);
  end if;

  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'jewelry_sale_returns', v_return_id::text, 'RECORD_SALE_RETURN', auth.uid(),
          jsonb_build_object('sale_id', v_sale.id, 'sale_no', v_sale.sale_no, 'base_weight_grams', v_sale.base_weight_grams,
                             'returned_before_g', v_prev_w, 'customer_net_before', v_net, 'unit', v_cur),
          jsonb_build_object('return_no', v_return_no, 'returned_weight_grams', v_w, 'value', v_value, 'debt_reduced', v_debt_red,
                             'advance_created', v_adv_new, 'destination', v_dest, 'piece_id', v_piece_id, 'customer_net_after', v_new_net),
          v_reason);

  v_res := jsonb_build_object('status', 'ok', 'return_id', v_return_id, 'return_no', v_return_no, 'sale_id', v_sale.id,
             'sale_no', v_sale.sale_no, 'unit', v_cur, 'returned_weight_g', v_w, 'remaining_sale_weight_g', round(v_rem_w - v_w, 4),
             'returned_value', v_value, 'returned_due_g585', case when v_cur = 'XAU585' then v_due else 0 end,
             'returned_amount', v_amt, 'debt_reduced', v_debt_red, 'advance_created', v_adv_new,
             'customer_debt_after', greatest(v_new_net, 0), 'customer_advance_after', greatest(-v_new_net, 0),
             'destination', v_dest, 'piece_id', v_piece_id, 'manager', v_mgr);
  perform public.save_idempotency_response(v_key, 'rpc_record_sale_return', v_res, v_payload);
  return v_res;
end;
$function$;
revoke execute on function public.rpc_record_sale_return(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.rpc_record_sale_return(uuid, numeric, text, text, text) to authenticated, service_role;
"""

head = """-- 083 — Goldia Sales: partial / full customer returns ("↩️ Vozvrat") as their own audited documents (2026-11-09).
-- Generated by docs/releases/production-075/gen-083-sale-returns.py.
-- Business rules (owner decisions 2026-11-09): a return lowers the customer's balance by the returned share of the
-- ORIGINAL sale (grams x original markup, or the original UZS / USD amount; last return takes the exact remainder);
-- what exceeds the open debt becomes an ADVANCE (no cash refund); a barcode piece is returned as a whole piece only;
-- same rights as a sale reversal (seller own sale, manager / director any sale; "received by the manager" only by
-- manager / director). The goods come back to the seller's shelf as a held piece (stock = held pieces); "manager"
-- hands that piece over with rpc_return_piece_to_manager (consignment weight + seller obligation down, manager stock up).
-- The original sale row is never changed; a sale with returns cannot be reversed as a whole (guard trigger).
-- Aggregates that sum sales now subtract confirmed returns: seller stock, unified ledger, monthly report, daily ledger,
-- period report effects, markup difference report, seller reconciliation statement, three-tier summary; the test
-- reset marks returns reversed before it reverses sales. No existing row is changed by this migration.
"""
changed = []
rollback_parts = []
for fn, pairs in P.items():
    body, src = latest(fn)
    changed.append(f"\n-- ===== {fn} (from {src})\n" + patch(body, pairs, fn) + ";\n")
    rollback_parts.append(f"\n-- ===== {fn} (restore the body of {src})\n" + body + ";\n")
mig = head + NEW + "\n-- ------------------------------------------------------------------ 4. aggregates subtract confirmed returns\n" + "".join(changed)
(REPO / "supabase/migrations/20260101000083_goldia_partial_sale_returns.sql").write_text(mig, encoding="utf-8")
rb = """-- Rollback of 083. REFUSED while any return document exists (their effects on balances, stock and pieces would stay
-- without a document). Restores the previous bodies of the changed functions.
do $guard$ begin
  if exists (select 1 from public.jewelry_sale_returns) then
    raise exception 'ROLLBACK 083 REFUSED: customer return documents exist (jewelry_sale_returns)';
  end if;
end $guard$;
drop trigger if exists trg_goldia_guard_sale_reversal_with_returns on public.jewelry_sales;
drop function if exists public._goldia_guard_sale_reversal_with_returns();
drop function if exists public.rpc_record_sale_return(uuid, numeric, text, text, text);
""" + "".join(rollback_parts) + "\ndrop table if exists public.jewelry_sale_returns;\n"
(REPO / "supabase/rollback/20260101000083_rollback.sql").write_text(rb, encoding="utf-8")
print("ok", len(mig.splitlines()), "lines;", len(P), "functions patched")
