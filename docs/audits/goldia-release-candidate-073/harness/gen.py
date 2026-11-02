import re, sys, glob, os
D = '/opt/goldia-audit/fix073/'
def load(n): return open(D + n + '.sql').read().rstrip()
def rep(s, old, new, n=1):
    c = s.count(old)
    if c != n: sys.exit(f'PATCH FAIL ({c}): {old[:100]!r}')
    return s.replace(old, new)
BD = 'public._goldia_business_date()'
def dates(s):
    out, k = re.subn(r'(?i)\bcurrent_date\b', BD, s)
    return out, k
parts = []

parts.append(f"""-- ------------------------------------------------------------------ A. one business-date rule
-- The Goldia business date is the calendar date in Asia/Tashkent (UTC+5, no daylight saving) at the moment the
-- operation runs, independent of the server / session time zone. 23:59 Tashkent stays on the same day; 00:00 Tashkent
-- (= 19:00 UTC of the previous UTC day) starts the next business day.
create or replace function public._goldia_business_date(p_at timestamptz default now())
returns date
language sql
stable
set search_path = pg_catalog, pg_temp
as $$ select (p_at at time zone 'Asia/Tashkent')::date $$;
revoke execute on function public._goldia_business_date(timestamptz) from public, anon;
grant execute on function public._goldia_business_date(timestamptz) to authenticated, service_role;

-- Column defaults of Goldia Sales documents (existing rows are not touched).
alter table public.daily_gold_rates       alter column rate_date        set default public._goldia_business_date();
alter table public.factory_gold_handovers alter column handover_date    set default public._goldia_business_date();
alter table public.factory_receipts       alter column receipt_date     set default public._goldia_business_date();
alter table public.financial_transactions alter column transaction_date set default public._goldia_business_date();
alter table public.gold_purchases         alter column purchase_date    set default public._goldia_business_date();
alter table public.gold_settlements       alter column settlement_date  set default public._goldia_business_date();
alter table public.jewelry_sales          alter column sale_date        set default public._goldia_business_date();
alter table public.refining_batches       alter column batch_date       set default public._goldia_business_date();
""")

# B. reset clears the 072 seller valued till pool (PR #13)
s = load('rpc_execute_full_test_reset')
s = rep(s, """         seller_till_usd_amount = 0,
         seller_legacy_debt_obligation_g = 0,""", """         seller_till_usd_amount = 0,
         -- 073: empty the 072 valued till pool together with the till (the reset reverses handovers, whose grams
         -- would otherwise flow back into the pool and mix with the first post-reset collection).
         till_valued_cash_uzs = 0,
         till_valued_cash_585_g = 0,
         till_valued_usd = 0,
         till_valued_usd_585_g = 0,
         seller_legacy_debt_obligation_g = 0,""")
s, _ = dates(s)
parts.append('-- ------------------------------------------------------------------ B. full test reset empties the seller valued till pool\n' + s + ';\n')

# A2. business date in every Goldia Sales RPC that stamped CURRENT_DATE (UTC)
names = ['rpc_create_jewelry_sale', 'rpc_get_company_rate_difference_report', 'rpc_get_customer_monthly_report',
         'rpc_get_seller_markup_difference_report', 'rpc_record_barcode_piece_sale', 'rpc_record_client_jewelry_sale',
         'rpc_record_client_settlement', 'rpc_record_factory_gold_handover', 'rpc_record_manager_seller_settlement',
         'rpc_record_seller_to_factory_settlement', 'rpc_record_seller_to_manager_settlement',
         'rpc_reverse_seller_to_manager_settlement', 'rpc_set_daily_gold_rate', 'rpc_transfer_to_seller'] + \
        [os.path.basename(f)[:-4] for f in sorted(glob.glob(D + 'rpc_record_refining_batch_*.sql'))]
total = 0
for n in names:
    s, k = dates(load(n))
    if k == 0: sys.exit('no current_date in ' + n)
    total += k
    parts.append(f'-- ------------------------------------------------------------------ A2. business date: {n} ({k}x)\n' + s + ';\n')

# C. weight sale: the operator names the physical piece(s); ambiguous partial cuts are refused
parts.append("""-- ------------------------------------------------------------------ C. explicit physical pieces for weight sales
create or replace function public._goldia_consume_selected_pieces(p_sale_id uuid, p_seller_id uuid, p_piece_ids uuid[],
  p_grams numeric, p_org_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    if v_piece.weight_grams - v_left > 0.0001 then
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
$$;
revoke execute on function public._goldia_consume_selected_pieces(uuid, uuid, uuid[], numeric, uuid) from public, anon, authenticated;
grant execute on function public._goldia_consume_selected_pieces(uuid, uuid, uuid[], numeric, uuid) to service_role;

drop function if exists public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text);
""")
s = load('rpc_record_weight_sale')
s = rep(s, "p_idempotency_key text DEFAULT NULL::text)\n", "p_idempotency_key text DEFAULT NULL::text, p_piece_ids uuid[] DEFAULT NULL::uuid[])\n")
s = rep(s, "    'weight_grams', v_weight, 'markup_pct', v_markup));", "    'weight_grams', v_weight, 'markup_pct', v_markup, 'piece_ids', to_jsonb(p_piece_ids)));")
s = rep(s, """    'weight_grams', v_weight,
    'markup_pct', v_markup
  );""", """    'weight_grams', v_weight,
    'markup_pct', v_markup,
    'piece_ids', to_jsonb(p_piece_ids)
  );""")
s = rep(s, """      v_avail_stock, v_weight;
  end if;
""", """      v_avail_stock, v_weight;
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
""")
s = rep(s, """  -- FIFO: Link sale to seller's active consignment
  select * into v_consign""", """  -- FIFO: Link sale to seller's active consignment (073: the consignment of the first selected piece)
  if p_piece_ids is not null and cardinality(p_piece_ids) > 0 then
    select sc.* into v_consign from public.seller_consignments sc
      join public.consignment_pieces cp on cp.consignment_id = sc.id
     where cp.id = p_piece_ids[1]
     for update of sc;
  else
  select * into v_consign""")
s = rep(s, """   order by created_at asc
   limit 1
   for update;
""", """   order by created_at asc
   limit 1
   for update;
  end if;
""")
s = rep(s, "    perform public._goldia_consume_weight_sale_pieces(v_sale_id, v_seller.id, v_consign.id, v_weight, v_caller_org);",
"""    if p_piece_ids is not null and cardinality(p_piece_ids) > 0 then
      perform public._goldia_consume_selected_pieces(v_sale_id, v_seller.id, p_piece_ids, v_weight, v_caller_org);
    else
      perform public._goldia_consume_weight_sale_pieces(v_sale_id, v_seller.id, v_consign.id, v_weight, v_caller_org);
    end if;""")
s, k = dates(s)
parts.append(s + ';\n')
parts.append("""revoke execute on function public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text, uuid[]) from public, anon;
grant execute on function public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text, uuid[]) to authenticated, service_role;
""")

hdr = open(D + 'header.sql').read()
body = hdr + '\n'.join(parts) + "\nnotify pgrst, 'reload schema';\n"
open('/home/user/jewelryflow-erp/supabase/migrations/20260101000073_goldia_release_candidate_stabilization.sql', 'w').write(body)
print('ok, business-date replacements:', total + k)
