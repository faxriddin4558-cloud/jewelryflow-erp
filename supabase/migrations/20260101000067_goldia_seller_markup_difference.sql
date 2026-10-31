-- JewelryFlow ERP Migration 20260101000067
-- GOLDIA SALES: SIGNED SELLER MARKUP DIFFERENCE ("Ustama farqi")
--
-- A seller receives goods with an assigned seller markup and may sell to the customer at a lower or
-- higher markup (never blocked). Per sale:
--   difference_g = original base weight * (actual customer markup % - assigned seller markup %) / 100
-- e.g. 100 g, assigned 15 %, sold 12 % -> -3 g; sold 20 % -> +5 g; cumulative +2 g (grams, not %).
--
-- Accounting: the difference belongs to GOLDIA (company), not to the seller or the manager. It is a
-- pricing variance, NOT a new obligation: seller obligations, customer debts, settlements and stock are
-- not touched. It is already inside the net assets of rpc_get_accounting_profit_summary (customer
-- receivables are booked at the actual markup), so the report shows it and never adds it to profit.
-- It is "realized" only in proportion to what the customer has actually paid on that sale.
--
-- Data: two snapshot columns on jewelry_sales, written once at sale time. Historical sales are filled
-- only where the assigned markup is provable from the booked seller obligation (see backfill below);
-- everything else stays NULL and is reported as "unknown". No markup value is ever guessed.

alter table public.jewelry_sales
  add column if not exists assigned_seller_markup_pct numeric(6, 2),
  add column if not exists markup_difference_g        numeric(14, 4),
  add column if not exists markup_snapshot_source     text;

alter table public.jewelry_sales drop constraint if exists jewelry_sales_markup_snapshot_source_check;
alter table public.jewelry_sales add constraint jewelry_sales_markup_snapshot_source_check
  check (markup_snapshot_source is null or markup_snapshot_source in ('sale_time', 'reconstructed'));

-- -------------------------------------------------------------------------
-- 1. Snapshot at sale time (every RPC that inserts a sale is covered)
-- -------------------------------------------------------------------------
create or replace function public.trg_goldia_sale_markup_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pct numeric(6, 2);
begin
  if new.assigned_seller_markup_pct is null and new.consignment_id is not null then
    select seller_markup_pct into v_pct from public.seller_consignments where id = new.consignment_id;
    if v_pct is not null then
      new.assigned_seller_markup_pct := v_pct;
      new.markup_snapshot_source := 'sale_time';
    end if;
  end if;
  if new.assigned_seller_markup_pct is not null and new.client_markup_pct is not null then
    new.markup_difference_g := round(coalesce(new.base_weight_grams, 0)
      * (new.client_markup_pct - new.assigned_seller_markup_pct) / 100.0, 4);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_goldia_sale_markup_snapshot on public.jewelry_sales;
create trigger trg_goldia_sale_markup_snapshot
  before insert on public.jewelry_sales
  for each row execute function public.trg_goldia_sale_markup_snapshot();

-- A piece sale links the piece right after inserting the sale (same transaction); the piece's own
-- assigned markup is the most precise snapshot, so it replaces the consignment-level value.
create or replace function public.trg_goldia_piece_markup_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.sale_id is not null and old.sale_id is null and new.seller_markup_pct is not null then
    update public.jewelry_sales s
       set assigned_seller_markup_pct = new.seller_markup_pct,
           markup_difference_g = round(coalesce(s.base_weight_grams, 0) * (s.client_markup_pct - new.seller_markup_pct) / 100.0, 4),
           markup_snapshot_source = 'sale_time'
     where s.id = new.sale_id
       and s.client_markup_pct is not null
       and coalesce(s.markup_snapshot_source, 'sale_time') = 'sale_time'
       and s.assigned_seller_markup_pct is distinct from new.seller_markup_pct
       and s.created_at > now() - interval '1 minute';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_goldia_piece_markup_snapshot on public.consignment_pieces;
create trigger trg_goldia_piece_markup_snapshot
  after update of sale_id on public.consignment_pieces
  for each row execute function public.trg_goldia_piece_markup_snapshot();

-- -------------------------------------------------------------------------
-- 2. Verified one-time backfill for historical sales
-- -------------------------------------------------------------------------
-- The seller_markup_pct columns were added with DEFAULT 12 (migrations 032/034), so a stored value
-- alone does not prove what was assigned. A historical sale is reconstructed ONLY when:
--   * its consignment's booked seller obligation equals original base * (1 + pct / 100) within
--     0.001 g, i.e. that percentage is exactly what the seller was charged, and
--   * the sold piece (if any) carries the same percentage.
-- All other historical sales stay NULL ("unknown") and are excluded from the totals.
create or replace function public._goldia_backfill_markup_difference()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with candidates as (
    select s.id as sale_id, s.base_weight_grams, s.client_markup_pct,
           coalesce(cp.seller_markup_pct, sc.seller_markup_pct) as pct
      from public.jewelry_sales s
      left join lateral (select p.consignment_id, p.seller_markup_pct from public.consignment_pieces p
                          where p.sale_id = s.id limit 1) cp on true
      join public.seller_consignments sc on sc.id = coalesce(cp.consignment_id, s.consignment_id)
     where s.assigned_seller_markup_pct is null
       and s.client_markup_pct is not null
       and sc.seller_markup_pct is not null
       and (cp.seller_markup_pct is null or cp.seller_markup_pct = sc.seller_markup_pct)
       and sc.original_base_weight_grams > 0
       and abs(sc.original_seller_obligation_g
               - round(sc.original_base_weight_grams * (1 + sc.seller_markup_pct / 100.0), 4)) <= 0.001
  )
  update public.jewelry_sales s
     set assigned_seller_markup_pct = c.pct,
         markup_difference_g = round(coalesce(c.base_weight_grams, 0) * (c.client_markup_pct - c.pct) / 100.0, 4),
         markup_snapshot_source = 'reconstructed'
    from candidates c
   where s.id = c.sale_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public._goldia_backfill_markup_difference() from public, anon, authenticated;
revoke all on function public.trg_goldia_sale_markup_snapshot() from public, anon, authenticated;
revoke all on function public.trg_goldia_piece_markup_snapshot() from public, anon, authenticated;

-- The backfill only writes the three new analytic columns. The seller-account sync trigger is
-- paused for this statement so that no stored balance is recalculated by the migration itself.
alter table public.jewelry_sales disable trigger trg_sync_seller_gold_account_sales;
select public._goldia_backfill_markup_difference();
alter table public.jewelry_sales enable trigger trg_sync_seller_gold_account_sales;

-- -------------------------------------------------------------------------
-- 3. Report: seller sees only own sales; director/manager see per seller and company total
-- -------------------------------------------------------------------------
create or replace function public.rpc_get_seller_markup_difference_report(
  p_seller_id uuid default null,
  p_from      date default null,
  p_to        date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid := public.current_organization_id();
  v_role    text := public.current_employee_role_text();
  v_emp     uuid := public.current_employee_id();
  v_seller  uuid := p_seller_id;
  v_from    date := coalesce(p_from, date '2000-01-01');
  v_to      date := coalesce(p_to, current_date);
  v_res     jsonb;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi']);
  if public._goldia_is_seller_role(v_role) then
    if v_seller is not null and v_seller is distinct from v_emp then
      raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''z ustama farqini ko''ra oladi' using errcode = '42501';
    end if;
    v_seller := v_emp;
  end if;

  with s as (
    select js.*, (js.status in ('reversed', 'cancelled')) as is_reversed,
           case when coalesce(js.client_gold_due_grams, 0) > 0
                then least(1, greatest(0, coalesce(js.settled_gold_grams, 0) / js.client_gold_due_grams)) else 0 end as paid_ratio
      from public.jewelry_sales js
     where js.organization_id = v_org
       and (v_seller is null or js.seller_id = v_seller)
       and js.sale_date between v_from and v_to
  ),
  active as (select * from s where not is_reversed and markup_difference_g is not null)
  select jsonb_build_object(
    'status', 'ok',
    'seller_id', v_seller,
    'period_from', v_from,
    'period_to', v_to,
    'total_difference_g', coalesce((select round(sum(markup_difference_g), 4) from active), 0),
    'positive_g', coalesce((select round(sum(markup_difference_g), 4) from active where markup_difference_g > 0), 0),
    'negative_g', coalesce((select round(sum(markup_difference_g), 4) from active where markup_difference_g < 0), 0),
    'realized_g', coalesce((select round(sum(markup_difference_g * paid_ratio), 4) from active), 0),
    'unrealized_g', coalesce((select round(sum(markup_difference_g * (1 - paid_ratio)), 4) from active), 0),
    'active_sales', (select count(*) from active),
    'reversed_sales', (select count(*) from s where is_reversed),
    'unknown_sales', (select count(*) from s where not is_reversed and markup_difference_g is null),
    'included_in_profit_summary', true,
    'note', 'Ustama farqi kompaniyaga tegishli; mijoz qarzi va sotuvchi majburiyatini o''zgartirmaydi, foyda hisobotida allaqachon bor — qayta qo''shilmaydi. Amalga oshgan qism mijoz to''lagan ulushga teng.',
    'by_seller', case when public._goldia_is_seller_role(v_role) then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('seller_id', a.seller_id,
                 'seller_name', coalesce(e.full_name, e.name), 'total_difference_g', a.total, 'positive_g', a.pos,
                 'negative_g', a.neg, 'sales', a.cnt) order by a.total desc)
          from (select seller_id, round(sum(markup_difference_g), 4) total,
                       round(sum(markup_difference_g) filter (where markup_difference_g > 0), 4) pos,
                       round(sum(markup_difference_g) filter (where markup_difference_g < 0), 4) neg, count(*) cnt
                  from active group by seller_id) a
          left join public.employees e on e.id = a.seller_id), '[]'::jsonb) end,
    'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sale_id', x.id, 'sale_no', x.sale_no, 'sale_date', x.sale_date, 'seller_id', x.seller_id,
                 'customer_name', c.contact_name, 'model', coalesce(x.model_code, x.product_name),
                 'base_weight_grams', x.base_weight_grams, 'assigned_seller_markup_pct', x.assigned_seller_markup_pct,
                 'client_markup_pct', x.client_markup_pct, 'markup_difference_g', x.markup_difference_g,
                 'snapshot_source', x.markup_snapshot_source, 'status', x.status, 'reversed', x.is_reversed)
               order by x.sale_date desc, x.created_at desc)
          from (select * from s order by sale_date desc, created_at desc limit 500) x
          left join public.customers c on c.id = x.customer_id), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;

grant execute on function public.rpc_get_seller_markup_difference_report(uuid, date, date) to authenticated;

-- -------------------------------------------------------------------------
-- 4. rpc_record_barcode_piece_sale: a retried request was answered with "idempotency key conflict"
--    because the response was stored as the request payload. Current (065) definition with only that
--    argument corrected, so a retry now returns the original sale instead of an error.
-- -------------------------------------------------------------------------
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
    current_date, p_notes, 'piece', v_piece.model_id, v_piece.model_code,
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
