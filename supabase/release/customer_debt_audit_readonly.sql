-- READ ONLY. Customer debt audit (e.g. «Гулнора 99»): candidate cards by Cyrillic / Latin spelling and "99", then for
-- every candidate the full document timeline with the running balance before / after each document, who entered it,
-- seller changes, and the balance rebuilt from the documents vs the stored balance.
-- No personal data: names are masked (first 3 letters), no phones / addresses; ids, codes, times, grams, statuses.
-- Usage: psql ... -v name_like="'%гулнор%'" -v name_like2="'%gulnor%'" -v digits="'99'" -f this_file
--        (all three are optional; the defaults below are for «Гулнора 99»)
\if :{?name_like}
\else
\set name_like '''%гулнор%'''
\endif
\if :{?name_like2}
\else
\set name_like2 '''%gulnor%'''
\endif
\if :{?digits}
\else
\set digits '''99'''
\endif
begin transaction read only;
set local timezone = 'Asia/Tashkent';

\echo === 1. Candidate cards (all spellings; "99" marked) - duplicates show up here ===
with _cand as (
select c.id, c.organization_id, c.customer_code, c.seller_id, c.created_at, c.is_archived, c.is_active,
       left(coalesce(c.contact_name, c.company_name, ''), 3) || '***' masked_name,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like)) cyr,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like2)) lat,
       (coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like '%' || :digits || '%' has_digits
  from public.customers c
 where lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like any (array[lower(:name_like), lower(:name_like2),
         '%гульнор%', '%gul''nor%', '%gulnar%', '%гулнар%'])
), _ev as (
select * from (
  -- opening customer balances (E: 585 grams, F: UZS / USD); a cancelled document is undone at its cancel time
  select d.customer_id, d.created_at at_, 'OPENING ' || d.kind || ' ' || coalesce(d.side, '') kind, d.document_no doc, d.status,
         case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end unit,
         case when d.side = 'advance' then -d.amount else d.amount end delta, d.created_by who, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency')
  union all
  select d.customer_id, d.cancelled_at, 'OPENING CANCELLED ' || d.kind, d.document_no, d.status, case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end,
         case when d.side = 'advance' then d.amount else -d.amount end, d.cancelled_by, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency') and d.cancelled_at is not null
  -- old (legacy) debts / advances
  union all
  select l.customer_id, l.created_at, 'LEGACY ' || l.entry_type || ' ' || l.balance_type, l.id::text, l.status, 'G585', l.delta_585_g, l.created_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand)
  union all
  select l.customer_id, l.reversed_at, 'LEGACY REVERSED', l.id::text, l.status, 'G585', -l.delta_585_g, l.reversed_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand) and l.status = 'reversed' and l.reversed_at is not null
  -- sales (585 or UZS / USD price) and their reversals (incl. the original of a 090 edit)
  union all
  select s.customer_id, s.created_at, 'SALE' || case when coalesce(s.sale_currency, 'XAU585') <> 'XAU585' then ' ' || s.sale_currency else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end, s.recorded_by, s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand)
  union all
  select s.customer_id, coalesce((select max(l.created_at) from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%'), s.updated_at),
         'SALE REVERSED' || case when exists (select 1 from public.sale_edits x where x.original_sale_id = s.id) then ' (EDIT)' else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         -case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end,
         (select l.actor_id from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%' order by l.created_at desc limit 1), s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand) and s.status in ('reversed', 'cancelled')
  -- 585 payments (cash / USD / LOM -> grams) and their reversals
  union all
  select g.customer_id, g.created_at, 'PAYMENT 585', g.settlement_no, g.status, 'G585', -g.total_settled_grams, g.recorded_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
  union all
  select g.customer_id, g.reversed_at, 'PAYMENT 585 REVERSED', g.settlement_no, g.status, 'G585', g.total_settled_grams, g.reversed_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- UZS / USD debt payments (CPAY)
  union all
  select c.customer_id, c.created_at, 'CPAY ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, -c.credited_amount, c.recorded_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand)
  union all
  select c.customer_id, c.reversed_at, 'CPAY REVERSED ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, c.credited_amount, c.reversed_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand) and c.status = 'reversed' and c.reversed_at is not null
  -- returns (083) and old-sale returns (089)
  union all
  select r.customer_id, r.created_at, 'RETURN', r.return_no, r.status, case when r.sale_currency = 'XAU585' then 'G585' else r.sale_currency end,
         -case when r.sale_currency = 'XAU585' then r.client_gold_due_returned_g else r.sale_amount_returned end, r.created_by, r.seller_id
    from public.jewelry_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.created_at, 'OLD-SALE RETURN', r.return_no, r.status, r.unit, -r.credit_amount, r.created_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.reversed_at, 'OLD-SALE RETURN REVERSED', r.return_no, r.status, r.unit, r.credit_amount, r.reversed_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand) and r.status = 'reversed' and r.reversed_at is not null
) e where e.at_ is not null
)
select c.id customer_id, o.name tashkilot, c.customer_code kod, c.masked_name ism, c.cyr kirill, c.lat lotin, c.has_digits raqam_99,
       e.full_name sotuvchi, c.created_at yaratilgan, c.is_active faol, c.is_archived arxiv,
       a.current_debt_grams qarz_585_g, a.advance_balance_grams avans_585_g,
       (select string_agg(x.currency || '=' || round(x.debt_amount - x.advance_amount, 2), ', ') from public.client_currency_accounts x where x.customer_id = c.id) valyuta_net
  from _cand c join public.organizations o on o.id = c.organization_id
  left join public.employees e on e.id = c.seller_id
  left join public.client_gold_accounts a on a.customer_id = c.id
 order by c.has_digits desc, o.name, c.created_at;

\echo === 2. Timeline per customer and unit: balance (debt - advance) before / after every document, who entered it ===
with _cand as (
select c.id, c.organization_id, c.customer_code, c.seller_id, c.created_at, c.is_archived, c.is_active,
       left(coalesce(c.contact_name, c.company_name, ''), 3) || '***' masked_name,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like)) cyr,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like2)) lat,
       (coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like '%' || :digits || '%' has_digits
  from public.customers c
 where lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like any (array[lower(:name_like), lower(:name_like2),
         '%гульнор%', '%gul''nor%', '%gulnar%', '%гулнар%'])
), _ev as (
select * from (
  -- opening customer balances (E: 585 grams, F: UZS / USD); a cancelled document is undone at its cancel time
  select d.customer_id, d.created_at at_, 'OPENING ' || d.kind || ' ' || coalesce(d.side, '') kind, d.document_no doc, d.status,
         case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end unit,
         case when d.side = 'advance' then -d.amount else d.amount end delta, d.created_by who, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency')
  union all
  select d.customer_id, d.cancelled_at, 'OPENING CANCELLED ' || d.kind, d.document_no, d.status, case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end,
         case when d.side = 'advance' then d.amount else -d.amount end, d.cancelled_by, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency') and d.cancelled_at is not null
  -- old (legacy) debts / advances
  union all
  select l.customer_id, l.created_at, 'LEGACY ' || l.entry_type || ' ' || l.balance_type, l.id::text, l.status, 'G585', l.delta_585_g, l.created_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand)
  union all
  select l.customer_id, l.reversed_at, 'LEGACY REVERSED', l.id::text, l.status, 'G585', -l.delta_585_g, l.reversed_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand) and l.status = 'reversed' and l.reversed_at is not null
  -- sales (585 or UZS / USD price) and their reversals (incl. the original of a 090 edit)
  union all
  select s.customer_id, s.created_at, 'SALE' || case when coalesce(s.sale_currency, 'XAU585') <> 'XAU585' then ' ' || s.sale_currency else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end, s.recorded_by, s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand)
  union all
  select s.customer_id, coalesce((select max(l.created_at) from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%'), s.updated_at),
         'SALE REVERSED' || case when exists (select 1 from public.sale_edits x where x.original_sale_id = s.id) then ' (EDIT)' else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         -case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end,
         (select l.actor_id from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%' order by l.created_at desc limit 1), s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand) and s.status in ('reversed', 'cancelled')
  -- 585 payments (cash / USD / LOM -> grams) and their reversals
  union all
  select g.customer_id, g.created_at, 'PAYMENT 585', g.settlement_no, g.status, 'G585', -g.total_settled_grams, g.recorded_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
  union all
  select g.customer_id, g.reversed_at, 'PAYMENT 585 REVERSED', g.settlement_no, g.status, 'G585', g.total_settled_grams, g.reversed_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- UZS / USD debt payments (CPAY)
  union all
  select c.customer_id, c.created_at, 'CPAY ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, -c.credited_amount, c.recorded_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand)
  union all
  select c.customer_id, c.reversed_at, 'CPAY REVERSED ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, c.credited_amount, c.reversed_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand) and c.status = 'reversed' and c.reversed_at is not null
  -- returns (083) and old-sale returns (089)
  union all
  select r.customer_id, r.created_at, 'RETURN', r.return_no, r.status, case when r.sale_currency = 'XAU585' then 'G585' else r.sale_currency end,
         -case when r.sale_currency = 'XAU585' then r.client_gold_due_returned_g else r.sale_amount_returned end, r.created_by, r.seller_id
    from public.jewelry_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.created_at, 'OLD-SALE RETURN', r.return_no, r.status, r.unit, -r.credit_amount, r.created_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.reversed_at, 'OLD-SALE RETURN REVERSED', r.return_no, r.status, r.unit, r.credit_amount, r.reversed_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand) and r.status = 'reversed' and r.reversed_at is not null
) e where e.at_ is not null
)
select c.customer_code kod, e.unit, e.at_ vaqt, case when e.at_ < t.t0 then 'T0 dan oldin' else 'T0 dan keyin' end davr,
       e.kind hujjat_turi, e.doc hujjat, e.status holat, round(e.delta, 4) ozgarish,
       round(coalesce(sum(e.delta) over w, 0) - e.delta, 4) oldin, round(sum(e.delta) over w, 4) keyin,
       coalesce(w1.full_name, w2.full_name, '-') kiritgan, s.full_name sotuvchi
  from _ev e join _cand c on c.id = e.customer_id
  left join (select organization_id, max(created_at) t0 from public.opening_periods where status in ('locked', 'closed') group by 1) t on t.organization_id = c.organization_id
  left join public.employees w1 on w1.id = e.who
  left join public.employees w2 on w2.user_id = e.who
  left join public.employees s on s.id = e.seller_id
window w as (partition by e.customer_id, e.unit order by e.at_, e.kind rows between unbounded preceding and current row)
 order by c.customer_code, e.unit, e.at_, e.kind;

\echo === 3. Rebuilt from the documents vs stored (585 grams and each currency); farq <> 0 -> look at section 2 ===
with _cand as (
select c.id, c.organization_id, c.customer_code, c.seller_id, c.created_at, c.is_archived, c.is_active,
       left(coalesce(c.contact_name, c.company_name, ''), 3) || '***' masked_name,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like)) cyr,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like2)) lat,
       (coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like '%' || :digits || '%' has_digits
  from public.customers c
 where lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like any (array[lower(:name_like), lower(:name_like2),
         '%гульнор%', '%gul''nor%', '%gulnar%', '%гулнар%'])
), _ev as (
select * from (
  -- opening customer balances (E: 585 grams, F: UZS / USD); a cancelled document is undone at its cancel time
  select d.customer_id, d.created_at at_, 'OPENING ' || d.kind || ' ' || coalesce(d.side, '') kind, d.document_no doc, d.status,
         case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end unit,
         case when d.side = 'advance' then -d.amount else d.amount end delta, d.created_by who, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency')
  union all
  select d.customer_id, d.cancelled_at, 'OPENING CANCELLED ' || d.kind, d.document_no, d.status, case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end,
         case when d.side = 'advance' then d.amount else -d.amount end, d.cancelled_by, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency') and d.cancelled_at is not null
  -- old (legacy) debts / advances
  union all
  select l.customer_id, l.created_at, 'LEGACY ' || l.entry_type || ' ' || l.balance_type, l.id::text, l.status, 'G585', l.delta_585_g, l.created_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand)
  union all
  select l.customer_id, l.reversed_at, 'LEGACY REVERSED', l.id::text, l.status, 'G585', -l.delta_585_g, l.reversed_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand) and l.status = 'reversed' and l.reversed_at is not null
  -- sales (585 or UZS / USD price) and their reversals (incl. the original of a 090 edit)
  union all
  select s.customer_id, s.created_at, 'SALE' || case when coalesce(s.sale_currency, 'XAU585') <> 'XAU585' then ' ' || s.sale_currency else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end, s.recorded_by, s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand)
  union all
  select s.customer_id, coalesce((select max(l.created_at) from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%'), s.updated_at),
         'SALE REVERSED' || case when exists (select 1 from public.sale_edits x where x.original_sale_id = s.id) then ' (EDIT)' else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         -case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end,
         (select l.actor_id from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%' order by l.created_at desc limit 1), s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand) and s.status in ('reversed', 'cancelled')
  -- 585 payments (cash / USD / LOM -> grams) and their reversals
  union all
  select g.customer_id, g.created_at, 'PAYMENT 585', g.settlement_no, g.status, 'G585', -g.total_settled_grams, g.recorded_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
  union all
  select g.customer_id, g.reversed_at, 'PAYMENT 585 REVERSED', g.settlement_no, g.status, 'G585', g.total_settled_grams, g.reversed_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- UZS / USD debt payments (CPAY)
  union all
  select c.customer_id, c.created_at, 'CPAY ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, -c.credited_amount, c.recorded_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand)
  union all
  select c.customer_id, c.reversed_at, 'CPAY REVERSED ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, c.credited_amount, c.reversed_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand) and c.status = 'reversed' and c.reversed_at is not null
  -- returns (083) and old-sale returns (089)
  union all
  select r.customer_id, r.created_at, 'RETURN', r.return_no, r.status, case when r.sale_currency = 'XAU585' then 'G585' else r.sale_currency end,
         -case when r.sale_currency = 'XAU585' then r.client_gold_due_returned_g else r.sale_amount_returned end, r.created_by, r.seller_id
    from public.jewelry_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.created_at, 'OLD-SALE RETURN', r.return_no, r.status, r.unit, -r.credit_amount, r.created_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.reversed_at, 'OLD-SALE RETURN REVERSED', r.return_no, r.status, r.unit, r.credit_amount, r.reversed_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand) and r.status = 'reversed' and r.reversed_at is not null
) e where e.at_ is not null
)
select c.customer_code kod, u.unit, round(coalesce(sum(e.delta), 0), 4) hujjatlardan,
       case when u.unit = 'G585' then round(coalesce(a.current_debt_grams, 0) - coalesce(a.advance_balance_grams, 0), 4)
            else (select round(x.debt_amount - x.advance_amount, 2) from public.client_currency_accounts x where x.customer_id = c.id and x.currency = u.unit) end saqlangan,
       round(coalesce(sum(e.delta), 0) - case when u.unit = 'G585' then coalesce(a.current_debt_grams, 0) - coalesce(a.advance_balance_grams, 0)
            else coalesce((select x.debt_amount - x.advance_amount from public.client_currency_accounts x where x.customer_id = c.id and x.currency = u.unit), 0) end, 4) farq
  from _cand c
  cross join (values ('G585'), ('UZS'), ('USD')) u(unit)
  left join _ev e on e.customer_id = c.id and e.unit = u.unit
  left join public.client_gold_accounts a on a.customer_id = c.id
 group by c.id, c.customer_code, u.unit, a.current_debt_grams, a.advance_balance_grams
having count(e.*) > 0 or u.unit = 'G585'
 order by 1, 2;

\echo === 4. Seller assignment / card changes and documents of these customers under ANOTHER seller ===
with _cand as (
select c.id, c.organization_id, c.customer_code, c.seller_id, c.created_at, c.is_archived, c.is_active,
       left(coalesce(c.contact_name, c.company_name, ''), 3) || '***' masked_name,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like)) cyr,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like2)) lat,
       (coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like '%' || :digits || '%' has_digits
  from public.customers c
 where lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like any (array[lower(:name_like), lower(:name_like2),
         '%гульнор%', '%gul''nor%', '%gulnar%', '%гулнар%'])
), _ev as (
select * from (
  -- opening customer balances (E: 585 grams, F: UZS / USD); a cancelled document is undone at its cancel time
  select d.customer_id, d.created_at at_, 'OPENING ' || d.kind || ' ' || coalesce(d.side, '') kind, d.document_no doc, d.status,
         case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end unit,
         case when d.side = 'advance' then -d.amount else d.amount end delta, d.created_by who, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency')
  union all
  select d.customer_id, d.cancelled_at, 'OPENING CANCELLED ' || d.kind, d.document_no, d.status, case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end,
         case when d.side = 'advance' then d.amount else -d.amount end, d.cancelled_by, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency') and d.cancelled_at is not null
  -- old (legacy) debts / advances
  union all
  select l.customer_id, l.created_at, 'LEGACY ' || l.entry_type || ' ' || l.balance_type, l.id::text, l.status, 'G585', l.delta_585_g, l.created_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand)
  union all
  select l.customer_id, l.reversed_at, 'LEGACY REVERSED', l.id::text, l.status, 'G585', -l.delta_585_g, l.reversed_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand) and l.status = 'reversed' and l.reversed_at is not null
  -- sales (585 or UZS / USD price) and their reversals (incl. the original of a 090 edit)
  union all
  select s.customer_id, s.created_at, 'SALE' || case when coalesce(s.sale_currency, 'XAU585') <> 'XAU585' then ' ' || s.sale_currency else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end, s.recorded_by, s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand)
  union all
  select s.customer_id, coalesce((select max(l.created_at) from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%'), s.updated_at),
         'SALE REVERSED' || case when exists (select 1 from public.sale_edits x where x.original_sale_id = s.id) then ' (EDIT)' else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         -case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end,
         (select l.actor_id from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%' order by l.created_at desc limit 1), s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand) and s.status in ('reversed', 'cancelled')
  -- 585 payments (cash / USD / LOM -> grams) and their reversals
  union all
  select g.customer_id, g.created_at, 'PAYMENT 585', g.settlement_no, g.status, 'G585', -g.total_settled_grams, g.recorded_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
  union all
  select g.customer_id, g.reversed_at, 'PAYMENT 585 REVERSED', g.settlement_no, g.status, 'G585', g.total_settled_grams, g.reversed_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- UZS / USD debt payments (CPAY)
  union all
  select c.customer_id, c.created_at, 'CPAY ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, -c.credited_amount, c.recorded_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand)
  union all
  select c.customer_id, c.reversed_at, 'CPAY REVERSED ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, c.credited_amount, c.reversed_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand) and c.status = 'reversed' and c.reversed_at is not null
  -- returns (083) and old-sale returns (089)
  union all
  select r.customer_id, r.created_at, 'RETURN', r.return_no, r.status, case when r.sale_currency = 'XAU585' then 'G585' else r.sale_currency end,
         -case when r.sale_currency = 'XAU585' then r.client_gold_due_returned_g else r.sale_amount_returned end, r.created_by, r.seller_id
    from public.jewelry_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.created_at, 'OLD-SALE RETURN', r.return_no, r.status, r.unit, -r.credit_amount, r.created_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.reversed_at, 'OLD-SALE RETURN REVERSED', r.return_no, r.status, r.unit, r.credit_amount, r.reversed_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand) and r.status = 'reversed' and r.reversed_at is not null
) e where e.at_ is not null
)
select c.customer_code kod, l.created_at vaqt, l.table_name, l.action, l.actor_name kiritgan,
       l.old_data ->> 'seller_id' eski_sotuvchi_id, l.new_data ->> 'seller_id' yangi_sotuvchi_id, l.reason sabab
  from public.audit_logs l join _cand c on l.record_id = c.id::text
 order by c.customer_code, l.created_at;
with _cand as (
select c.id, c.organization_id, c.customer_code, c.seller_id, c.created_at, c.is_archived, c.is_active,
       left(coalesce(c.contact_name, c.company_name, ''), 3) || '***' masked_name,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like)) cyr,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like2)) lat,
       (coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like '%' || :digits || '%' has_digits
  from public.customers c
 where lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like any (array[lower(:name_like), lower(:name_like2),
         '%гульнор%', '%gul''nor%', '%gulnar%', '%гулнар%'])
), _ev as (
select * from (
  -- opening customer balances (E: 585 grams, F: UZS / USD); a cancelled document is undone at its cancel time
  select d.customer_id, d.created_at at_, 'OPENING ' || d.kind || ' ' || coalesce(d.side, '') kind, d.document_no doc, d.status,
         case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end unit,
         case when d.side = 'advance' then -d.amount else d.amount end delta, d.created_by who, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency')
  union all
  select d.customer_id, d.cancelled_at, 'OPENING CANCELLED ' || d.kind, d.document_no, d.status, case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end,
         case when d.side = 'advance' then d.amount else -d.amount end, d.cancelled_by, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency') and d.cancelled_at is not null
  -- old (legacy) debts / advances
  union all
  select l.customer_id, l.created_at, 'LEGACY ' || l.entry_type || ' ' || l.balance_type, l.id::text, l.status, 'G585', l.delta_585_g, l.created_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand)
  union all
  select l.customer_id, l.reversed_at, 'LEGACY REVERSED', l.id::text, l.status, 'G585', -l.delta_585_g, l.reversed_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand) and l.status = 'reversed' and l.reversed_at is not null
  -- sales (585 or UZS / USD price) and their reversals (incl. the original of a 090 edit)
  union all
  select s.customer_id, s.created_at, 'SALE' || case when coalesce(s.sale_currency, 'XAU585') <> 'XAU585' then ' ' || s.sale_currency else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end, s.recorded_by, s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand)
  union all
  select s.customer_id, coalesce((select max(l.created_at) from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%'), s.updated_at),
         'SALE REVERSED' || case when exists (select 1 from public.sale_edits x where x.original_sale_id = s.id) then ' (EDIT)' else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         -case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end,
         (select l.actor_id from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%' order by l.created_at desc limit 1), s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand) and s.status in ('reversed', 'cancelled')
  -- 585 payments (cash / USD / LOM -> grams) and their reversals
  union all
  select g.customer_id, g.created_at, 'PAYMENT 585', g.settlement_no, g.status, 'G585', -g.total_settled_grams, g.recorded_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
  union all
  select g.customer_id, g.reversed_at, 'PAYMENT 585 REVERSED', g.settlement_no, g.status, 'G585', g.total_settled_grams, g.reversed_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- UZS / USD debt payments (CPAY)
  union all
  select c.customer_id, c.created_at, 'CPAY ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, -c.credited_amount, c.recorded_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand)
  union all
  select c.customer_id, c.reversed_at, 'CPAY REVERSED ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, c.credited_amount, c.reversed_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand) and c.status = 'reversed' and c.reversed_at is not null
  -- returns (083) and old-sale returns (089)
  union all
  select r.customer_id, r.created_at, 'RETURN', r.return_no, r.status, case when r.sale_currency = 'XAU585' then 'G585' else r.sale_currency end,
         -case when r.sale_currency = 'XAU585' then r.client_gold_due_returned_g else r.sale_amount_returned end, r.created_by, r.seller_id
    from public.jewelry_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.created_at, 'OLD-SALE RETURN', r.return_no, r.status, r.unit, -r.credit_amount, r.created_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.reversed_at, 'OLD-SALE RETURN REVERSED', r.return_no, r.status, r.unit, r.credit_amount, r.reversed_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand) and r.status = 'reversed' and r.reversed_at is not null
) e where e.at_ is not null
)
select c.customer_code kod, e.kind, e.doc, e.at_ vaqt, s.full_name hujjat_sotuvchisi, cs.full_name karta_sotuvchisi
  from _ev e join _cand c on c.id = e.customer_id
  left join public.employees s on s.id = e.seller_id left join public.employees cs on cs.id = c.seller_id
 where e.seller_id is distinct from c.seller_id
 order by 1, 4;

\echo === 5. Debt that may sit on ANOTHER card: documents of other customers that name a candidate in their notes ===
with _cand as (
select c.id, c.organization_id, c.customer_code, c.seller_id, c.created_at, c.is_archived, c.is_active,
       left(coalesce(c.contact_name, c.company_name, ''), 3) || '***' masked_name,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like)) cyr,
       (lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like lower(:name_like2)) lat,
       (coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like '%' || :digits || '%' has_digits
  from public.customers c
 where lower(coalesce(c.contact_name, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_code, '')) like any (array[lower(:name_like), lower(:name_like2),
         '%гульнор%', '%gul''nor%', '%gulnar%', '%гулнар%'])
), _ev as (
select * from (
  -- opening customer balances (E: 585 grams, F: UZS / USD); a cancelled document is undone at its cancel time
  select d.customer_id, d.created_at at_, 'OPENING ' || d.kind || ' ' || coalesce(d.side, '') kind, d.document_no doc, d.status,
         case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end unit,
         case when d.side = 'advance' then -d.amount else d.amount end delta, d.created_by who, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency')
  union all
  select d.customer_id, d.cancelled_at, 'OPENING CANCELLED ' || d.kind, d.document_no, d.status, case when d.unit is null or d.unit = 'G585' then 'G585' else d.unit end,
         case when d.side = 'advance' then d.amount else -d.amount end, d.cancelled_by, d.seller_id
    from public.opening_documents d where d.customer_id in (select id from _cand) and d.kind in ('customer_gram', 'customer_currency') and d.cancelled_at is not null
  -- old (legacy) debts / advances
  union all
  select l.customer_id, l.created_at, 'LEGACY ' || l.entry_type || ' ' || l.balance_type, l.id::text, l.status, 'G585', l.delta_585_g, l.created_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand)
  union all
  select l.customer_id, l.reversed_at, 'LEGACY REVERSED', l.id::text, l.status, 'G585', -l.delta_585_g, l.reversed_by, l.seller_id
    from public.client_legacy_debts l where l.customer_id in (select id from _cand) and l.status = 'reversed' and l.reversed_at is not null
  -- sales (585 or UZS / USD price) and their reversals (incl. the original of a 090 edit)
  union all
  select s.customer_id, s.created_at, 'SALE' || case when coalesce(s.sale_currency, 'XAU585') <> 'XAU585' then ' ' || s.sale_currency else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end, s.recorded_by, s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand)
  union all
  select s.customer_id, coalesce((select max(l.created_at) from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%'), s.updated_at),
         'SALE REVERSED' || case when exists (select 1 from public.sale_edits x where x.original_sale_id = s.id) then ' (EDIT)' else '' end, s.sale_no, s.status,
         case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then 'G585' else s.sale_currency end,
         -case when coalesce(s.sale_currency, 'XAU585') = 'XAU585' then s.client_gold_due_grams else s.sale_amount end,
         (select l.actor_id from public.audit_logs l where l.record_id = s.id::text and l.action ilike '%REVERS%' order by l.created_at desc limit 1), s.seller_id
    from public.jewelry_sales s where s.customer_id in (select id from _cand) and s.status in ('reversed', 'cancelled')
  -- 585 payments (cash / USD / LOM -> grams) and their reversals
  union all
  select g.customer_id, g.created_at, 'PAYMENT 585', g.settlement_no, g.status, 'G585', -g.total_settled_grams, g.recorded_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
  union all
  select g.customer_id, g.reversed_at, 'PAYMENT 585 REVERSED', g.settlement_no, g.status, 'G585', g.total_settled_grams, g.reversed_by, g.seller_id
    from public.gold_settlements g where g.customer_id in (select id from _cand) and g.direction = 'client_to_seller' and g.reversal_of_id is null
     and g.status in ('reversed', 'cancelled') and g.reversed_at is not null
  -- UZS / USD debt payments (CPAY)
  union all
  select c.customer_id, c.created_at, 'CPAY ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, -c.credited_amount, c.recorded_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand)
  union all
  select c.customer_id, c.reversed_at, 'CPAY REVERSED ' || c.debt_currency, c.settlement_no, c.status, c.debt_currency, c.credited_amount, c.reversed_by, c.seller_id
    from public.client_currency_settlements c where c.customer_id in (select id from _cand) and c.status = 'reversed' and c.reversed_at is not null
  -- returns (083) and old-sale returns (089)
  union all
  select r.customer_id, r.created_at, 'RETURN', r.return_no, r.status, case when r.sale_currency = 'XAU585' then 'G585' else r.sale_currency end,
         -case when r.sale_currency = 'XAU585' then r.client_gold_due_returned_g else r.sale_amount_returned end, r.created_by, r.seller_id
    from public.jewelry_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.created_at, 'OLD-SALE RETURN', r.return_no, r.status, r.unit, -r.credit_amount, r.created_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand)
  union all
  select r.customer_id, r.reversed_at, 'OLD-SALE RETURN REVERSED', r.return_no, r.status, r.unit, r.credit_amount, r.reversed_by, r.seller_id
    from public.opening_sale_returns r where r.customer_id in (select id from _cand) and r.status = 'reversed' and r.reversed_at is not null
) e where e.at_ is not null
)
select x.kind, x.doc, x.at_ vaqt, x.customer_code boshqa_karta_kodi
  from (select 'SALE' kind, s.sale_no doc, s.created_at at_, cc.customer_code, s.notes from public.jewelry_sales s join public.customers cc on cc.id = s.customer_id
        union all select 'PAYMENT', g.settlement_no, g.created_at, cc.customer_code, g.notes from public.gold_settlements g join public.customers cc on cc.id = g.customer_id
        union all select 'LEGACY', l.id::text, l.created_at, cc.customer_code, l.notes from public.client_legacy_debts l join public.customers cc on cc.id = l.customer_id) x
 where x.customer_code not in (select customer_code from _cand where customer_code is not null)
   and (lower(coalesce(x.notes, '')) like lower(:name_like) or lower(coalesce(x.notes, '')) like lower(:name_like2))
 order by 3;
rollback;
