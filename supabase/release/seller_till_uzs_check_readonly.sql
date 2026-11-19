-- READ ONLY. One seller's UZS till: is money a customer paid (and the seller spent / brought back) still in the system
-- till? Every UZS movement since T0 with the running till, the stored till, till counts, and whether a second customer
-- payment or a capital entry of the same amount exists (double-entry risk). No customer data (codes only).
-- Usage: psql ... -v seller_name="'%Sanatbek%'" -v amount=5000000 -v day="'2026-11-18'" -f this_file
\if :{?amount}
\else
\set amount 5000000
\endif
\if :{?day}
\else
\set day '''2026-11-18'''
\endif
begin transaction read only;
set local timezone = 'Asia/Tashkent';

\echo === 1. Stored till of the seller (UZS cash, its valued pool, obligation) ===
select e.full_name sotuvchi, a.seller_till_cash_amount kassa_uzs, a.till_valued_cash_uzs pool_uzs, round(a.till_valued_cash_585_g, 4) pool_585_g,
       a.seller_owes_manager_g majburiyat_g, a.updated_at
  from public.seller_gold_accounts a join public.employees e on e.id = a.seller_id
 where e.full_name ilike :seller_name or e.name ilike :seller_name;

\echo === 2. Every UZS movement of the till since T0, running total (payments +, handovers -, purchases -, capital / expense) ===
with s as (select e.id, e.organization_id from public.employees e where e.full_name ilike :seller_name or e.name ilike :seller_name),
t0 as (select max(p.created_at) t0 from public.opening_periods p join s on s.organization_id = p.organization_id where p.status in ('locked', 'closed')),
m as (
  select g.created_at at_, 'SETTL (585 qarz to''lovi)' kind, g.settlement_no doc, g.status, c.customer_code mijoz, coalesce(g.cash_paid_amount, 0) uzs
    from public.gold_settlements g join s on s.id = g.seller_id left join public.customers c on c.id = g.customer_id
   where g.direction = 'client_to_seller' and g.reversal_of_id is null and coalesce(g.cash_paid_amount, 0) > 0
  union all
  select g.reversed_at, 'SETTL bekor', g.settlement_no, g.status, c.customer_code, -coalesce(g.cash_paid_amount, 0)
    from public.gold_settlements g join s on s.id = g.seller_id left join public.customers c on c.id = g.customer_id
   where g.direction = 'client_to_seller' and g.reversal_of_id is null and g.status in ('reversed', 'cancelled') and g.reversed_at is not null and coalesce(g.cash_paid_amount, 0) > 0
  union all
  select x.created_at, 'CPAY (UZS/USD qarz to''lovi)', x.settlement_no, x.status, c.customer_code, coalesce(x.cash_uzs, 0)
    from public.client_currency_settlements x join s on s.id = x.seller_id left join public.customers c on c.id = x.customer_id where coalesce(x.cash_uzs, 0) > 0
  union all
  select x.reversed_at, 'CPAY bekor', x.settlement_no, x.status, c.customer_code, -coalesce(x.cash_uzs, 0)
    from public.client_currency_settlements x join s on s.id = x.seller_id left join public.customers c on c.id = x.customer_id
   where coalesce(x.cash_uzs, 0) > 0 and x.status = 'reversed' and x.reversed_at is not null
  union all
  select g.created_at, 'TOPSHIRISH menejerga', g.settlement_no, g.status, null, -coalesce(g.cash_paid_amount, 0)
    from public.gold_settlements g join s on s.id = g.seller_id
   where g.direction = 'seller_to_manager' and g.reversal_of_id is null and coalesce(g.cash_paid_amount, 0) > 0
  union all
  select g.reversed_at, 'TOPSHIRISH bekor', g.settlement_no, g.status, null, coalesce(g.cash_paid_amount, 0)
    from public.gold_settlements g join s on s.id = g.seller_id
   where g.direction = 'seller_to_manager' and g.reversal_of_id is null and g.status in ('reversed', 'cancelled') and g.reversed_at is not null and coalesce(g.cash_paid_amount, 0) > 0
  union all
  select f.created_at, 'KAPITAL/XARAJAT ' || f.transaction_type, f.transaction_no, f.status, null,
         case when f.transaction_type = 'capital_contribution' then f.amount_num else -f.amount_num end
    from public.financial_transactions f join s on s.id = f.seller_id where 'seller_till_uzs' in (f.source_till, f.reclassified_from_till)
)
select to_char(m.at_, 'YYYY-MM-DD HH24:MI') vaqt, m.kind, m.doc, m.status, m.mijoz, m.uzs,
       sum(m.uzs) over (order by m.at_, m.doc rows between unbounded preceding and current row) kassa_keyin
  from m where m.at_ >= (select t0 from t0) order by m.at_, m.doc;
\echo (091 LOM purchases reduce the UZS till too: see seller_lom_purchases if any)

\echo === 3. Payments of exactly this amount from the given day on (a second payment for the same money = double entry) ===
select to_char(x.at_, 'YYYY-MM-DD HH24:MI') vaqt, x.kind, x.doc, x.status, x.mijoz, x.uzs
  from (select g.created_at at_, 'SETTL' kind, g.settlement_no doc, g.status, c.customer_code mijoz, g.cash_paid_amount uzs
          from public.gold_settlements g join public.employees e on e.id = g.seller_id left join public.customers c on c.id = g.customer_id
         where (e.full_name ilike :seller_name or e.name ilike :seller_name) and g.direction = 'client_to_seller' and g.cash_paid_amount = :amount
        union all
        select x.created_at, 'CPAY', x.settlement_no, x.status, c.customer_code, x.cash_uzs
          from public.client_currency_settlements x join public.employees e on e.id = x.seller_id left join public.customers c on c.id = x.customer_id
         where (e.full_name ilike :seller_name or e.name ilike :seller_name) and x.cash_uzs = :amount) x
 where x.at_ >= (:day)::date
 order by 1;

\echo === 4. Till counts of the seller (089: counted vs expected; "personal_use" = money taken for himself) ===
select to_char(t.created_at, 'YYYY-MM-DD HH24:MI') vaqt, t.expected_uzs kutilgan_uzs, t.counted_uzs sanalgan_uzs, t.diff_uzs farq_uzs, t.explanation izoh
  from public.seller_till_counts t join public.employees e on e.id = t.seller_id
 where e.full_name ilike :seller_name or e.name ilike :seller_name
 order by t.created_at;
rollback;
