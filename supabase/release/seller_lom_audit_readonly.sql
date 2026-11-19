-- READ ONLY. One seller's LOM (scrap) till since the opening T0: every document that moved it, PHYSICAL grams and
-- 585-EQUIVALENT grams kept apart, the running totals against the stored till columns, and the documents whose
-- physical weight and 585 value differ (proba <> 585) or whose handover took the 585 value as the physical weight.
-- No customer data (no names, phones or customer ids). Usage: psql ... -v seller_name="'%Sanatbek%'" -f this file
begin transaction read only;
set local timezone = 'Asia/Tashkent';

with s as (
  select e.id, e.organization_id from public.employees e where e.full_name ilike :seller_name or e.name ilike :seller_name
), t0 as (
  select coalesce(max(r.t0), '-infinity'::timestamptz) t0 from public.financial_restarts r join s on s.organization_id = r.organization_id
), docs as (
  -- customer 585 payments with LOM (SETTL): + into the till; a reversed one: - on its reversal date
  select 'SETTL' kind, g.settlement_no doc, g.created_at at_, g.status, coalesce(g.physical_scrap_grams, g.scrap_weight_grams, 0) phys,
         g.scrap_proba proba, coalesce(g.scrap_585_equiv_grams, 0) eq585, 1 sign
    from public.gold_settlements g join s on s.id = g.seller_id
   where g.direction = 'client_to_seller' and g.reversal_of_id is null and coalesce(g.scrap_585_equiv_grams, g.scrap_weight_grams, 0) > 0
  union all
  select 'SETTL-BEKOR', g.settlement_no, g.reversed_at, g.status, coalesce(g.physical_scrap_grams, g.scrap_weight_grams, 0), g.scrap_proba, coalesce(g.scrap_585_equiv_grams, 0), -1
    from public.gold_settlements g join s on s.id = g.seller_id
   where g.direction = 'client_to_seller' and g.reversal_of_id is null and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
     and coalesce(g.scrap_585_equiv_grams, g.scrap_weight_grams, 0) > 0
  -- UZS / USD debt payments with LOM (CPAY)
  union all
  select 'CPAY', c.settlement_no, c.created_at, c.status, c.scrap_physical_g, c.scrap_proba, c.scrap_585_g, 1
    from public.client_currency_settlements c join s on s.id = c.seller_id where coalesce(c.scrap_585_g, 0) > 0
  union all
  select 'CPAY-BEKOR', c.settlement_no, c.reversed_at, c.status, c.scrap_physical_g, c.scrap_proba, c.scrap_585_g, -1
    from public.client_currency_settlements c join s on s.id = c.seller_id where coalesce(c.scrap_585_g, 0) > 0 and c.status = 'reversed' and c.reversed_at is not null
  -- seller -> manager handovers: - out of the till; a reversed one: + back
  union all
  select 'TOPSHIRISH', g.settlement_no, g.created_at, g.status, coalesce(g.physical_scrap_grams, g.scrap_weight_grams, 0), g.scrap_proba, coalesce(g.scrap_585_equiv_grams, g.scrap_weight_grams, 0), -1
    from public.gold_settlements g join s on s.id = g.seller_id
   where g.direction = 'seller_to_manager' and g.reversal_of_id is null and coalesce(g.scrap_585_equiv_grams, g.scrap_weight_grams, 0) > 0
  union all
  select 'TOPSHIRISH-BEKOR', g.settlement_no, g.reversed_at, g.status, coalesce(g.physical_scrap_grams, g.scrap_weight_grams, 0), g.scrap_proba, coalesce(g.scrap_585_equiv_grams, g.scrap_weight_grams, 0), 1
    from public.gold_settlements g join s on s.id = g.seller_id
   where g.direction = 'seller_to_manager' and g.reversal_of_id is null and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
     and coalesce(g.scrap_585_equiv_grams, g.scrap_weight_grams, 0) > 0
  -- capital / expense operations on the seller's LOM till (listed; sign from the operation type)
  union all
  select 'KAPITAL/XARAJAT:' || f.transaction_type, f.id::text, f.created_at, f.status, f.physical_weight_grams, f.gold_proba, f.equiv_585_grams, 0
    from public.financial_transactions f join s on s.id = f.seller_id where 'seller_till_scrap' in (f.source_till, f.reclassified_from_till)
), d as (select docs.*, (select t0 from t0) t0 from docs where at_ >= (select t0 from t0))
select 'DOC' as line, kind, doc, to_char(at_, 'YYYY-MM-DD HH24:MI:SS') vaqt, status, round(phys, 4) fizik_g, proba, round(eq585, 4) ekv585_g,
       round(phys - eq585, 4) fizik_minus_585, sign,
       round(sum(sign * phys) over (order by at_, doc, kind), 4) jami_fizik, round(sum(sign * eq585) over (order by at_, doc, kind), 4) jami_585,
       case when kind like 'TOPSHIRISH%' and abs(phys - eq585) < 0.00005 and coalesce(proba, 585) = 585 then 'fizik vazn = 585 qiymat (fizik alohida yuborilmagan)'
            when coalesce(proba, 585) <> 585 then 'proba ' || proba || ': fizik va 585 farqli' end izoh
  from d
union all
select 'JAMI', 'T0 dan beri (T0 da kassa 0)', null, to_char(min(t0), 'YYYY-MM-DD HH24:MI'), null, round(sum(sign * phys), 4), null, round(sum(sign * eq585), 4), round(sum(sign * (phys - eq585)), 4), null, null, null,
       'faqat 18.11: kirim fizik ' || round(coalesce(sum(phys) filter (where sign = 1 and at_::date = date '2026-11-18'), 0), 4) || ' / 585 ' || round(coalesce(sum(eq585) filter (where sign = 1 and at_::date = date '2026-11-18'), 0), 4)
       || '; chiqim fizik ' || round(coalesce(sum(phys) filter (where sign = -1 and at_::date = date '2026-11-18'), 0), 4) || ' / 585 ' || round(coalesce(sum(eq585) filter (where sign = -1 and at_::date = date '2026-11-18'), 0), 4)
  from d
union all
select 'KASSA', 'dasturdagi qiymatlar', null, null, null, a.seller_till_scrap_physical_g, null, a.seller_till_scrap_grams, round(coalesce(a.seller_till_scrap_physical_g, 0) - a.seller_till_scrap_grams, 4), null, null, null,
       'seller_till_scrap_grams (585) = ' || a.seller_till_scrap_grams || '; seller_till_scrap_585_eq_g = ' || coalesce(a.seller_till_scrap_585_eq_g::text, '-') || '; fizik = ' || coalesce(a.seller_till_scrap_physical_g::text, '-')
       || '; sotuvchilar topildi: ' || (select count(*) from s)
  from public.seller_gold_accounts a join s on s.id = a.seller_id
order by 1 desc, 4;

rollback;
