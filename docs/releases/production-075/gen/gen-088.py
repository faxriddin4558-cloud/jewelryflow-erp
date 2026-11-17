"""Generates supabase/migrations/20260101000088_goldia_factory_settled_and_unrated_currency.sql from the 085 bodies
(exact copies + the listed, asserted replacements). Run: python3 -I gen-088.py"""
import os, re
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..')
SRC = open(os.path.join(R, 'supabase/migrations/20260101000085_goldia_financial_restart_and_opening_accounting.sql'), encoding='utf-8').read()

def body(name, end):
    i = SRC.lower().index(('create or replace function public.' + name + '(').lower())
    j = SRC.index(end, i) + len(end)
    return SRC[i:j]

def rep(s, a, b, n=1):
    assert s.count(a) == n, (a[:90], s.count(a))
    return s.replace(a, b)

out = []
out.append('''-- 088 - Goldia Sales (2026-11-17): two business corrections of the OPENING, nothing rewritten in place.
--
-- 1. factory_settled (new opening document kind, "Zavod bilan oldin hisob-kitob qilingan sotuvchi tovari"): goods a
--    SELLER holds at T0 were already settled with the factory by the manager before T0. They stay on the seller (stock,
--    the seller's own obligation, his customers' debts: unchanged) but must not be a new factory obligation. One document
--    per seller-inventory (B) document; the SERVER computes its grams:
--      B with its own opening receipt  -> that receipt's factory obligation (grams x (1 + its factory %));
--      B taken from a manager A        -> B grams x (1 + the A document's factory %).
--    Effect: the factory account (vault) is lowered by exactly that amount; C2 / C / A and every receipt are untouched;
--    cancelling the document puts it back. Future factory receipts follow the normal rule.
-- 2. UZS / USD opening customer debt (F) without a rate: the amount and currency are required, the 585 rate and the USD
--    rate are optional. Without them the debt stays in its currency, is NOT valued (equiv_585_g null, no seller grams,
--    never 0 / 1 / today's rate) and is shown as "not yet valued". On each payment of such a debt the paid part is
--    valued at THAT payment's rates (the 084 operation-rate rule) and only then enters the seller's 585 obligation (and
--    the valued till pool, so the handover closes it); a reversal takes it out again. Rated debts keep the 085 rule.
''')

# 0. kind constraint + one settlement per B
out.append('''
do $c$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.opening_documents'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%manager_inventory%seller_inventory%' loop
    execute format('alter table public.opening_documents drop constraint %I', r.conname);
  end loop;
end $c$;
alter table public.opening_documents add constraint opening_documents_kind_check check (kind in ('manager_inventory', 'seller_inventory',
  'factory_obligation', 'factory_advance', 'factory_settled', 'seller_obligation', 'customer_gram', 'customer_currency', 'manager_cash',
  'manager_scrap', 'manager_fine_gold', 'other'));
create unique index if not exists opening_documents_one_factory_settled on public.opening_documents (source_document_id)
  where kind = 'factory_settled' and status = 'active';
''')

# 1. helpers
fn = body('_goldia_opening_factory_net', '$f$;')
fn = rep(fn, "select coalesce(sum(case kind when 'factory_obligation' then amount else -amount end), 0)::numeric from public.opening_documents\n   where organization_id = p_org and status = 'active' and kind in ('factory_obligation', 'factory_advance')",
         "-- 088: factory_settled (seller goods settled with the factory before T0) lowers it like an advance, but is its own kind\n  select coalesce(sum(case kind when 'factory_obligation' then amount else -amount end), 0)::numeric from public.opening_documents\n   where organization_id = p_org and status = 'active' and kind in ('factory_obligation', 'factory_advance', 'factory_settled')")
out.append('\n' + fn + '\n')
fn = body('_goldia_opening_seller_obligation', '$f$;')
fn = rep(fn, "  select coalesce(sum(seller_obligation_g), 0)::numeric from public.opening_documents\n   where organization_id = p_org and seller_id = p_seller and status = 'active' and kind in ('seller_obligation', 'customer_currency')",
         "  select coalesce((select sum(seller_obligation_g) from public.opening_documents\n   where organization_id = p_org and seller_id = p_seller and status = 'active' and kind in ('seller_obligation', 'customer_currency')), 0)::numeric\n"
         "  -- 088: the paid parts of an UNRATED opening UZS / USD debt, valued at each payment's rates (reversed payments excluded)\n"
         "  + coalesce((select sum(c.snapshot_released_g) from public.client_currency_settlements c join public.opening_documents d on d.id = c.opening_document_id\n"
         "      where d.organization_id = p_org and d.seller_id = p_seller and d.status = 'active' and d.kind = 'customer_currency' and d.equiv_585_g is null\n"
         "        and c.status <> 'reversed'), 0)::numeric")
out.append('\n' + fn + '\n')

# 2. rpc_record_opening_document
fn = body('rpc_record_opening_document', '$function$;')
fn = rep(fn, """        if v_seller is null then raise exception 'Mijozga sotuvchi biriktirilmagan: valyuta qarzi sotuvchi majburiyatini yaratadi' using errcode = '22023'; end if;
        if coalesce(p_lom_rate, 0) <= 0 then raise exception 'ERR_RATE_REQUIRED: 585 kursi (so''m / g) kiritilishi shart' using errcode = '22023'; end if;
        if v_unit = 'USD' and coalesce(p_usd_rate, 0) <= 0 then raise exception 'ERR_RATE_REQUIRED: USD kursi (so''m) kiritilishi shart' using errcode = '22023'; end if;
        v_sobl := round(case when v_unit = 'UZS' then v_amt else v_amt * p_usd_rate end / p_lom_rate, 4);
        v_eq := v_sobl;
        v_formula := case when v_unit = 'UZS' then v_amt || ' so''m / ' || p_lom_rate || ' = ' || v_sobl || ' g'
                          else v_amt || ' USD x ' || p_usd_rate || ' / ' || p_lom_rate || ' = ' || v_sobl || ' g' end;""",
"""        if v_seller is null then raise exception 'Mijozga sotuvchi biriktirilmagan: valyuta qarzi sotuvchi majburiyatini yaratadi' using errcode = '22023'; end if;
        if coalesce(p_lom_rate, 0) < 0 or coalesce(p_usd_rate, 0) < 0 then raise exception 'Kurs manfiy bo''lishi mumkin emas' using errcode = '22023'; end if;
        if coalesce(p_lom_rate, 0) > 0 and (v_unit = 'UZS' or coalesce(p_usd_rate, 0) > 0) then
          v_sobl := round(case when v_unit = 'UZS' then v_amt else v_amt * p_usd_rate end / p_lom_rate, 4);
          v_eq := v_sobl;
          v_formula := case when v_unit = 'UZS' then v_amt || ' so''m / ' || p_lom_rate || ' = ' || v_sobl || ' g'
                            else v_amt || ' USD x ' || p_usd_rate || ' / ' || p_lom_rate || ' = ' || v_sobl || ' g' end;
        else
          -- 088: no (complete) rate: kept in its currency, NOT valued - no 0, 1 or today's rate is put in its place;
          -- each payment values its own part at that payment's rates
          p_lom_rate := null; p_usd_rate := null;
          v_sobl := 0; v_eq := null;
          v_formula := v_amt || ' ' || v_unit || ': kurs kiritilmagan - 585 g hali hisoblanmagan (har bir to''lov o''z kursi bilan grammga aylanadi)';
        end if;""")
fn = rep(fn, """  elsif v_kind = 'seller_obligation' then""", """  elsif v_kind = 'factory_settled' then
    -- 088: the goods of ONE seller-inventory (B) document were settled with the factory before T0: not a factory obligation
    if nullif(btrim(p_notes), '') is null then raise exception 'Asos (izoh) kiritilishi shart' using errcode = '22023'; end if;
    select * into v_src from public.opening_documents where id = p_source_document_id and organization_id = v_org
       and opening_period_id = v_per.id and kind = 'seller_inventory' and status = 'active' for update;
    if v_src.id is null then raise exception 'ERR_FACTORY_SETTLED_SOURCE: sotuvchi ombori (B) hujjati tanlanishi shart' using errcode = '22023'; end if;
    if exists (select 1 from public.opening_documents s where s.source_document_id = v_src.id and s.kind = 'factory_settled' and s.status = 'active') then
      raise exception 'ERR_OPENING_DUPLICATE: bu B hujjati zavod bilan hisob-kitob qilingan deb allaqachon belgilangan (%)', v_src.document_no using errcode = '23505';
    end if;
    v_phys := v_src.physical_g; v_proba := 585; v_unit := 'G585'; v_seller := v_src.seller_id;
    if v_src.source_document_id is null then
      select round(r.factory_obligation_g, 4), r.factory_markup_pct into v_amt, v_eq from public.factory_receipts r
       where r.id = v_src.factory_receipt_id and r.status <> 'reversed';
      v_formula := 'B ' || v_src.document_no || ': ' || v_phys || ' g x (1 + ' || coalesce(v_eq, 0) || ' %) = ' || coalesce(v_amt, 0)
                   || ' g (o''z boshlang''ich kirimi) - zavod bilan T0 dan oldin hisob-kitob qilingan';
    else
      select a.factory_markup_pct into v_eq from public.opening_documents a where a.id = v_src.source_document_id;
      v_amt := round(v_phys * (1 + coalesce(v_eq, 0) / 100.0), 4);
      v_formula := 'B ' || v_src.document_no || ' (A ' || (select a.document_no from public.opening_documents a where a.id = v_src.source_document_id)
                   || ' dan): ' || v_phys || ' g x (1 + ' || coalesce(v_eq, 0) || ' %) = ' || v_amt || ' g - zavod bilan T0 dan oldin hisob-kitob qilingan';
    end if;
    if coalesce(v_amt, 0) <= 0 then raise exception 'ERR_FACTORY_SETTLED_ZERO: bu B hujjatining zavod qiymati 0' using errcode = '22023'; end if;
    v_eq := v_amt;
    v_formula := v_formula || '; zavod hisobidan chiqarildi, sotuvchi ombori va majburiyati o''zgarmaydi';
    perform public._goldia_vault_factory_add(v_org, -v_amt, 0);

  elsif v_kind = 'seller_obligation' then""")
out.append('\n' + fn + '\n')

# 3. cancel
fn = body('rpc_cancel_opening_document', '$function$;')
fn = rep(fn, """  elsif v_d.kind = 'seller_inventory' then
    select * into v_con""", """  elsif v_d.kind = 'seller_inventory' then
    if exists (select 1 from public.opening_documents s where s.source_document_id = v_d.id and s.kind = 'factory_settled' and s.status = 'active') then
      raise exception 'Avval bu B hujjatining "zavod bilan hisob-kitob qilingan" belgisini bekor qiling' using errcode = '55000';
    end if;
    select * into v_con""")
fn = rep(fn, """  elsif v_d.kind = 'customer_gram' then""", """  elsif v_d.kind = 'factory_settled' then
    perform public._goldia_vault_factory_add(v_org, v_d.amount, 0);
  elsif v_d.kind = 'customer_gram' then""")
fn = rep(fn, """  elsif v_d.kind = 'customer_currency' then
    perform""", """  elsif v_d.kind = 'customer_currency' then
    if exists (select 1 from public.client_currency_settlements c where c.opening_document_id = v_d.id and c.status <> 'reversed') then
      raise exception 'Bu qarz bo''yicha to''lov bor - avval to''lovni bekor qiling' using errcode = '55000';
    end if;
    perform""")
out.append('\n' + fn + '\n')

# 4. opening state
fn = body('rpc_get_opening_state', '$function$;')
fn = rep(fn, """          - ((select coalesce(sum(r.factory_obligation_g), 0) from public.factory_receipts r
               where r.organization_id = v_org and r.status <> 'reversed' and r.opening_document_id is not null)
             + (select coalesce(sum(case kind when 'factory_obligation' then amount else -amount end), 0) from d
                 where kind in ('factory_obligation', 'factory_advance') and status = 'active'))) < 0.0001,""",
"""          - ((select coalesce(sum(r.factory_obligation_g), 0) from public.factory_receipts r
               where r.organization_id = v_org and r.status <> 'reversed' and r.opening_document_id is not null)
             -- 088: C - C2 - factory_settled
             + public._goldia_opening_factory_net(v_org))) < 0.0001,""")
fn = rep(fn, """      'factory_advance_documents_g', (select coalesce(sum(amount), 0) from d where kind = 'factory_advance' and status = 'active'),""",
"""      'factory_advance_documents_g', (select coalesce(sum(amount), 0) from d where kind = 'factory_advance' and status = 'active'),
      -- 088
      'factory_settled_seller_goods_g', (select coalesce(sum(amount), 0) from d where kind = 'factory_settled' and status = 'active'),
      'factory_net_g', (select current_factory_obligation_g - current_factory_advance_g from public.manager_vault_account where organization_id = v_org),
      'customers_uzs_unvalued', (select coalesce(sum(x.amount - x.paid), 0) from (select d2.amount, coalesce((select sum(c.applied_to_debt) from public.client_currency_settlements c
           where c.opening_document_id = d2.id and c.status <> 'reversed'), 0) paid from d d2 where d2.kind = 'customer_currency' and d2.unit = 'UZS' and d2.side = 'debt'
           and d2.status = 'active' and d2.equiv_585_g is null) x),
      'customers_usd_unvalued', (select coalesce(sum(x.amount - x.paid), 0) from (select d2.amount, coalesce((select sum(c.applied_to_debt) from public.client_currency_settlements c
           where c.opening_document_id = d2.id and c.status <> 'reversed'), 0) paid from d d2 where d2.kind = 'customer_currency' and d2.unit = 'USD' and d2.side = 'debt'
           and d2.status = 'active' and d2.equiv_585_g is null) x),
      'customers_unvalued_documents', (select count(*) from d where kind = 'customer_currency' and side = 'debt' and status = 'active' and equiv_585_g is null),""")
out.append('\n' + fn + '\n')

# 5. period effects (factory column)
fn = body('_goldia_period_effects', '\n$$;')
fn = rep(fn, "case o.kind when 'factory_obligation' then o.amount when 'factory_advance' then -o.amount else 0 end,",
         "case o.kind when 'factory_obligation' then o.amount when 'factory_advance' then -o.amount when 'factory_settled' then -o.amount else 0 end,")
fn = rep(fn, "case o.kind when 'factory_obligation' then -o.amount when 'factory_advance' then o.amount else 0 end,",
         "case o.kind when 'factory_obligation' then -o.amount when 'factory_advance' then o.amount when 'factory_settled' then o.amount else 0 end,")
fn = rep(fn, "o.kind in ('customer_currency', 'manager_cash', 'factory_obligation', 'factory_advance')",
         "o.kind in ('customer_currency', 'manager_cash', 'factory_obligation', 'factory_advance', 'factory_settled')", 2)
out.append('\n' + fn + '\n')

# 6. payment of an unrated opening debt
fn = body('rpc_record_client_currency_settlement', '\n$$;')
fn = rep(fn, """  if v_od.id is not null and v_applied > 0 and v_od.amount > 0 then
    v_snap_g := least(""", """  if v_od.id is not null and v_applied > 0 and v_od.amount > 0 and v_od.equiv_585_g is null then
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
    v_snap_g := round(case when v_cur = 'UZS' then v_applied else v_applied * v_usd_rate end / v_lom_rate, 4);
  elsif v_od.id is not null and v_applied > 0 and v_od.amount > 0 then
    v_snap_g := least(""")
fn = rep(fn, """  returning id into v_id;

  v_existing := jsonb_build_object('status', 'ok', 'settlement_id', v_id,""", """  returning id into v_id;
  if v_od.id is not null and v_od.equiv_585_g is null and coalesce(v_snap_g, 0) > 0 then
    perform public.recalc_seller_gold_account(v_seller_id, v_caller_org);
  end if;

  v_existing := jsonb_build_object('status', 'ok', 'settlement_id', v_id, 'unrated_opening_debt_valued_g',
    case when v_od.id is not null and v_od.equiv_585_g is null then v_snap_g end,""")
out.append('\n' + fn + '\n')

# 7. its reversal: an unrated debt's valued part leaves the seller's obligation again
fn = body('rpc_reverse_client_currency_settlement', '\n$$;')
fn = rep(fn, """   where id = v_row.id;
  insert into public.audit_logs""", """   where id = v_row.id;
  -- 088: an unrated opening debt's valued part leaves the seller's 585 obligation with the payment
  if v_row.opening_document_id is not null then perform public.recalc_seller_gold_account(v_row.seller_id, v_caller_org); end if;
  insert into public.audit_logs""")
out.append('\n' + fn + '\n')
out.append("\nnotify pgrst, 'reload schema';\n")
dst = os.path.join(R, 'supabase/migrations/20260101000088_goldia_factory_settled_and_unrated_currency.sql')
open(dst, 'w', encoding='utf-8').write(''.join(out))
print('written', dst, sum(1 for _ in open(dst)))

# ---------------------------------------------------------------- rollback 088 (back to exactly 085 / 087)
rb = ['''-- Rollback of 088: back to exactly 087 (the 085 bodies of the changed functions, the 085 kind check, no index).
-- Refused once a factory_settled document or an UNRATED opening currency debt exists (their meaning exists only in 088).
do $g$ begin
  if exists (select 1 from public.opening_documents where kind = 'factory_settled') then
    raise exception 'ROLLBACK 088 REFUSED: factory_settled opening documents exist';
  end if;
  if exists (select 1 from public.opening_documents where kind = 'customer_currency' and side = 'debt' and equiv_585_g is null) then
    raise exception 'ROLLBACK 088 REFUSED: unrated opening currency debts exist';
  end if; end $g$;
drop index if exists public.opening_documents_one_factory_settled;
alter table public.opening_documents drop constraint if exists opening_documents_kind_check;
alter table public.opening_documents add constraint opening_documents_kind_check check (kind in ('manager_inventory', 'seller_inventory', 'factory_obligation', 'factory_advance',
                        'seller_obligation', 'customer_gram', 'customer_currency', 'manager_cash', 'manager_scrap',
                        'manager_fine_gold', 'other'));
''']
for name, end in [('_goldia_opening_factory_net', '$f$;'), ('_goldia_opening_seller_obligation', '$f$;'), ('rpc_record_opening_document', '$function$;'),
                  ('rpc_cancel_opening_document', '$function$;'), ('rpc_get_opening_state', '$function$;'), ('_goldia_period_effects', '\n$$;'),
                  ('rpc_record_client_currency_settlement', '\n$$;'), ('rpc_reverse_client_currency_settlement', '\n$$;')]:
    rb.append('\n' + body(name, end) + '\n')
rb.append("\nnotify pgrst, 'reload schema';\n")
open(os.path.join(R, 'supabase/rollback/20260101000088_rollback.sql'), 'w', encoding='utf-8').write(''.join(rb))
print('written rollback')
