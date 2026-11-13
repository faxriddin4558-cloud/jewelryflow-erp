-- READ ONLY. PHASE F2: independent breakdown of the OLD seller obligations / customer debts / factory obligation BEFORE
-- the 085 restart, so the owner can see which part of the recorded numbers is explained by documents and which is not.
-- Aggregates per seller (employee name) and totals only: no customer name, phone or code is printed.
-- Output:
--   RECON|seller|<name>|held_g=..|held_obl_g=..|sold_obl_g=..|legacy_obl_g=..|settled_g=..|recorded_owes_g=..|recomputed_owes_g=..|cust_debt_g=..|cust_adv_g=..|cust_uzs=..|cust_usd=..|till_uzs=..|till_usd=..|till_lom_g=..|unexplained_g=..
--   RECON|factory|receipts_due_g=..|handovers_g=..|recorded_g=..
--   RECON|risk|<key>|<count>
--   RESULT|opening_recon|OK|REVIEW   (REVIEW = a recorded seller obligation differs from the independent recomputation: the
--   stored balance is stale; unexplained grams are information for the owner, not a failure)
-- Definitions (585 g):
--   held_obl_g   = obligation of the pieces still held by the seller (unsold inventory)
--   sold_obl_g   = consignment obligation of everything else (sold, cut by weight sales) = consignment obligation - held_obl_g
--   legacy_obl_g = unreversed legacy customer debts assigned to the seller (never below 0)
--   settled_g    = everything the seller handed over (seller -> manager / factory, not reversed)
--   opening_obl_g = 085 opening obligations (0 before the restart)
--   recomputed   = max(0, held_obl + sold_obl + legacy_obl + opening_obl - settled)   (the formula of recalc_seller_gold_account)
--   unexplained  = recomputed - held_obl - customers' 585 debt of HIS customers.
--                  > 0: obligation for sold goods that is neither a customer 585 debt nor handed over: the till (cash / USD /
--                       LOM not yet handed over), customer UZS / USD debts (not in grams here), or money / goods to be found.
--                  < 0 (small): the customers owe more than the seller's obligation: the company's markup difference.
with s as (
  select e.id, e.organization_id, coalesce(e.full_name, e.name, 'sotuvchi') as name,
         coalesce(public._goldia_opening_seller_obligation(e.id, e.organization_id), 0) as opening_obl
    from public.employees e where e.role::text in ('sales', 'seller')
),
cons as (
  select seller_id, coalesce(sum(coalesce(seller_obligation_g, factory_gold_due_grams)), 0) as obl
    from public.seller_consignments where status in ('held_by_seller', 'partially_sold', 'fully_sold') group by 1
),
held as (
  select seller_id, coalesce(sum(weight_grams), 0) as g, coalesce(sum(seller_obligation_grams), 0) as obl
    from public.consignment_pieces where status = 'held_by_seller' group by 1
),
leg as (
  select seller_id, greatest(0, coalesce(sum(delta_585_g), 0)) as g
    from public.client_legacy_debts where balance_type = 'debt' and status <> 'reversed' group by 1
),
stl as (
  select seller_id, coalesce(sum(total_settled_grams), 0) as g
    from public.gold_settlements
   where direction in ('seller_to_manager', 'seller_to_factory') and (status is null or status not in ('reversed', 'cancelled')) and reversal_of_id is null
   group by 1
),
cust as (
  select c.seller_id, coalesce(sum(a.current_debt_grams), 0) as debt, coalesce(sum(a.advance_balance_grams), 0) as adv
    from public.customers c join public.client_gold_accounts a on a.customer_id = c.id where c.seller_id is not null group by 1
),
cur as (
  select c.seller_id,
         coalesce(sum(x.debt_amount - x.advance_amount) filter (where x.currency = 'UZS'), 0) as uzs,
         coalesce(sum(x.debt_amount - x.advance_amount) filter (where x.currency = 'USD'), 0) as usd
    from public.customers c join public.client_currency_accounts x on x.customer_id = c.id where c.seller_id is not null group by 1
),
acc as (select seller_id, seller_owes_manager_g as owes, seller_till_cash_amount as tu, seller_till_usd_amount as tusd, seller_till_scrap_grams as tl from public.seller_gold_accounts),
rows as (
  select s.name, coalesce(h.g, 0) held_g, coalesce(h.obl, 0) held_obl,
         greatest(0, coalesce(cn.obl, 0) - coalesce(h.obl, 0)) sold_obl, coalesce(l.g, 0) legacy_obl, coalesce(st.g, 0) settled,
         coalesce(a.owes, 0) recorded, greatest(0, coalesce(cn.obl, 0) + coalesce(l.g, 0) + s.opening_obl - coalesce(st.g, 0)) recomputed, s.opening_obl,
         coalesce(cu.debt, 0) cdebt, coalesce(cu.adv, 0) cadv, coalesce(cr.uzs, 0) cuzs, coalesce(cr.usd, 0) cusd,
         coalesce(a.tu, 0) tu, coalesce(a.tusd, 0) tusd, coalesce(a.tl, 0) tl
    from s left join cons cn on cn.seller_id = s.id left join held h on h.seller_id = s.id left join leg l on l.seller_id = s.id
           left join stl st on st.seller_id = s.id left join cust cu on cu.seller_id = s.id left join cur cr on cr.seller_id = s.id
           left join acc a on a.seller_id = s.id
   where coalesce(cn.obl, 0) + coalesce(l.g, 0) + coalesce(st.g, 0) + coalesce(cu.debt, 0) + coalesce(cu.adv, 0) + abs(coalesce(cr.uzs, 0)) + abs(coalesce(cr.usd, 0))
         + coalesce(a.owes, 0) + coalesce(a.tu, 0) + coalesce(a.tusd, 0) > 0
),
fac as (
  select (select coalesce(sum(factory_obligation_g), 0) from public.factory_receipts where status not in ('reversed', 'cancelled')) as due,
         (select coalesce(sum(agreed_equivalent_g), 0) from public.factory_gold_handovers where status not in ('reversed', 'cancelled')) as paid,
         (select coalesce(sum(current_factory_obligation_g), 0) from public.manager_vault_account) as rec
),
lines(k, l) as (
  select 'a ' || name, 'RECON|seller|' || name || '|held_g=' || round(held_g, 4) || '|held_obl_g=' || round(held_obl, 4) || '|sold_obl_g=' || round(sold_obl, 4)
         || '|legacy_obl_g=' || round(legacy_obl, 4) || '|opening_obl_g=' || round(opening_obl, 4) || '|settled_g=' || round(settled, 4) || '|recorded_owes_g=' || round(recorded, 4) || '|recomputed_owes_g=' || round(recomputed, 4)
         || '|cust_debt_g=' || round(cdebt, 4) || '|cust_adv_g=' || round(cadv, 4) || '|cust_uzs=' || round(cuzs, 2) || '|cust_usd=' || round(cusd, 2)
         || '|till_uzs=' || round(tu, 2) || '|till_usd=' || round(tusd, 2) || '|till_lom_g=' || round(tl, 4) || '|unexplained_g=' || round(recomputed - held_obl - cdebt, 4)
    from rows
  union all select 'b total', 'RECON|total|held_g=' || round(sum(held_g), 4) || '|held_obl_g=' || round(sum(held_obl), 4) || '|sold_obl_g=' || round(sum(sold_obl), 4)
         || '|legacy_obl_g=' || round(sum(legacy_obl), 4) || '|settled_g=' || round(sum(settled), 4) || '|recorded_owes_g=' || round(sum(recorded), 4)
         || '|recomputed_owes_g=' || round(sum(recomputed), 4) || '|cust_debt_g=' || round(sum(cdebt), 4) || '|cust_adv_g=' || round(sum(cadv), 4)
         || '|till_uzs=' || round(sum(tu), 2) || '|till_usd=' || round(sum(tusd), 2) || '|unexplained_g=' || round(sum(recomputed - held_obl - cdebt), 4) from rows
  union all select 'c factory', 'RECON|factory|receipts_due_g=' || round(due, 4) || '|handovers_g=' || round(paid, 4) || '|recorded_g=' || round(rec, 4) from fac
  union all select 'd customers without seller', 'RECON|risk|customers_without_seller_with_balance|' || count(*) from public.customers c join public.client_gold_accounts a on a.customer_id = c.id
            where c.seller_id is null and (a.current_debt_grams > 0 or a.advance_balance_grams > 0)
  union all select 'd debt and advance', 'RECON|risk|customers_with_debt_and_advance_at_once|' || count(*) from public.client_gold_accounts where current_debt_grams > 0 and advance_balance_grams > 0
  union all select 'd gram and currency', 'RECON|risk|customers_with_585_and_currency_balance|' || count(*) from public.client_gold_accounts a
            where (a.current_debt_grams > 0 or a.advance_balance_grams > 0)
              and exists (select 1 from public.client_currency_accounts x where x.customer_id = a.customer_id and (x.debt_amount > 0 or x.advance_amount > 0))
  union all select 'd recorded vs recomputed', 'RECON|risk|sellers_recorded_differs_from_recomputed|' || count(*) from rows where abs(recorded - recomputed) > 0.00005
)
select l from lines
union all
select 'RESULT|opening_recon|' || case when exists (select 1 from rows where abs(recorded - recomputed) > 0.00005) then 'REVIEW' else 'OK' end
order by 1;
