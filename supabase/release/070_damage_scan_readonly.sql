-- GOLDIA 070 — historical damage scan. READ ONLY. Aggregates only: no names, phones or customer rows
-- are printed. Output format: check|count|grams (or amount)|severity
-- severity: OK, REVIEW (owner must look at it before the pilot continues), INFO.
begin transaction read only;
set local statement_timeout = '120s';

with org as (select id from public.organizations),
-- D1 (F2/F3): cached customer balances vs documents (sales + legacy - payments) = debt - advance
cust as (
  select a.customer_id,
         round((a.current_debt_grams - a.advance_balance_grams)
           - ( coalesce((select sum(s.client_gold_due_grams) from public.jewelry_sales s
                          where s.customer_id = a.customer_id and s.status not in ('reversed','cancelled')), 0)
             + coalesce((select sum(l.delta_585_g) from public.client_legacy_debts l
                          where l.customer_id = a.customer_id and l.status <> 'reversed'), 0)
             - coalesce((select sum(g.total_settled_grams) from public.gold_settlements g
                          where g.customer_id = a.customer_id and g.direction = 'client_to_seller'
                            and coalesce(g.status,'confirmed') not in ('reversed','cancelled') and g.reversal_of_id is null), 0)), 4) as diff
    from public.client_gold_accounts a),
-- D2 (F2, INFO): reversed sales of customers who had paid before the reversal; D1 shows whether a payment is still missing
rev as (
  select s.id, s.client_gold_due_grams from public.jewelry_sales s
   where s.status = 'reversed'
     and exists (select 1 from public.gold_settlements g where g.customer_id = s.customer_id and g.direction = 'client_to_seller'
                   and coalesce(g.status,'confirmed') = 'confirmed' and g.created_at < s.updated_at)),
-- D3 (F5): possible duplicate factory receipts (same product, weight, markup within 10 minutes)
dup as (
  select r1.id, r1.original_physical_g from public.factory_receipts r1
   where r1.status not in ('reversed','cancelled')
     and exists (select 1 from public.factory_receipts r2 where r2.id <> r1.id and r2.organization_id = r1.organization_id
                   and r2.status not in ('reversed','cancelled') and r2.product_name is not distinct from r1.product_name
                   and r2.original_physical_g = r1.original_physical_g and r2.factory_markup_pct = r1.factory_markup_pct
                   and r2.created_at between r1.created_at - interval '10 minutes' and r1.created_at)),
-- D4 (F4): per seller, sold base weight above everything consigned to them
sell as (
  select e.id,
         coalesce((select sum(s.base_weight_grams) from public.jewelry_sales s where s.seller_id = e.id and s.status not in ('reversed','cancelled')), 0) sold,
         coalesce((select sum(cp.weight_grams) from public.consignment_pieces cp where cp.seller_id = e.id and cp.status = 'held_by_seller'), 0) held,
         coalesce((select sum(c.base_weight_grams) from public.seller_consignments c where c.seller_id = e.id
                     and c.status in ('held_by_seller','partially_sold','fully_sold')), 0) consigned
    from public.employees e),
-- D5 (F4): whole-consignment sales whose consignment also fed a weight sale
whole as (
  select s.id, s.base_weight_grams from public.jewelry_sales s
   where s.status not in ('reversed','cancelled') and coalesce(s.sale_type, '') <> 'weight'
     and (select count(*) from public.consignment_pieces p where p.sale_id = s.id) > 1
     and exists (select 1 from public.weight_sale_allocations w where w.consignment_id = s.consignment_id and w.sale_id <> s.id and w.reversed_at is null)),
-- D6: physical conservation per organization
phys as (
  select o.id,
    coalesce((select sum(original_physical_g) from public.factory_receipts r where r.organization_id = o.id and r.status not in ('reversed','cancelled')), 0)
    - public.get_manager_available_stock_grams(o.id)
    - coalesce((select sum(weight_grams) from public.consignment_pieces p where p.organization_id = o.id and p.status = 'held_by_seller'), 0)
    - coalesce((select sum(base_weight_grams) from public.jewelry_sales s where s.organization_id = o.id and s.status not in ('reversed','cancelled')), 0)
    - coalesce((select sum(weight_grams) from public.consignment_pieces p where p.organization_id = o.id and p.status = 'returned_to_factory'), 0) as diff
  from org o),
-- D7: factory counters vs documents
fac as (
  select v.organization_id,
         round(v.current_factory_obligation_g - v.current_factory_advance_g
           - (coalesce((select sum(factory_obligation_g) from public.factory_receipts r where r.organization_id = v.organization_id and r.status not in ('reversed','cancelled')), 0)
            - coalesce((select sum(agreed_equivalent_g) from public.factory_gold_handovers h where h.organization_id = v.organization_id and h.status <> 'reversed'), 0)), 4) diff,
         round(v.manager_physical_stock_g - public.get_manager_available_stock_grams(v.organization_id), 4) stock_diff
    from public.manager_vault_account v)
select 'D1_customer_cache_vs_documents' chk, count(*) filter (where abs(diff) > 0.0005), coalesce(sum(abs(diff)) filter (where abs(diff) > 0.0005), 0),
       case when count(*) filter (where abs(diff) > 0.0005) = 0 then 'OK' else 'REVIEW' end from cust
union all select 'D2_reversed_sales_after_payment', count(*), coalesce(sum(client_gold_due_grams), 0), 'INFO' from rev
union all select 'D3_possible_duplicate_receipts', count(*), coalesce(sum(original_physical_g), 0), case when count(*) = 0 then 'OK' else 'REVIEW' end from dup
union all select 'D4_sellers_sold_more_than_consigned', count(*) filter (where sold + held - consigned > 0.0005), coalesce(sum(sold + held - consigned) filter (where sold + held - consigned > 0.0005), 0),
       case when count(*) filter (where sold + held - consigned > 0.0005) = 0 then 'OK' else 'REVIEW' end from sell
union all select 'D5_whole_consignment_sale_after_weight_sale', count(*), coalesce(sum(base_weight_grams), 0), case when count(*) = 0 then 'OK' else 'REVIEW' end from whole
union all select 'D6_physical_conservation_gap', count(*) filter (where abs(diff) > 0.0005), coalesce(sum(diff), 0), case when count(*) filter (where abs(diff) > 0.0005) = 0 then 'OK' else 'REVIEW' end from phys
union all select 'D7_factory_obligation_vs_documents', count(*) filter (where abs(diff) > 0.0005), coalesce(sum(diff), 0), case when count(*) filter (where abs(diff) > 0.0005) = 0 then 'OK' else 'REVIEW' end from fac
union all select 'D8_stored_manager_stock_vs_canonical', count(*) filter (where abs(stock_diff) > 0.0005), coalesce(sum(stock_diff), 0), 'INFO' from fac
union all select 'D9_business_expenses_added_back_to_profit_585g', count(*), coalesce(sum(equiv_585_grams), 0), 'INFO'
  from public.financial_transactions f where f.status <> 'reversed' and f.transaction_type in ('expense','business_expense')
   and f.created_at > coalesce((select max(created_at) from public.accounting_baselines b where b.status = 'active' and b.organization_id = f.organization_id), 'infinity')
union all select 'D10_currency_rates_table_exists', (to_regclass('public.currency_rates') is not null)::int, 0, 'INFO'
union all select 'D11_organizations', count(*), 0, case when count(*) = 1 then 'INFO' else 'REVIEW' end from public.organizations
union all select 'D12_employees_outside_their_org_scope', count(*), 0, case when count(*) = 0 then 'OK' else 'REVIEW' end
  from public.employees e where e.organization_id is null and coalesce(e.is_active, true)
union all select 'D13_cross_seller_customer_sales', count(*), coalesce(sum(s.client_gold_due_grams), 0), case when count(*) = 0 then 'OK' else 'INFO' end
  from public.jewelry_sales s join public.customers c on c.id = s.customer_id
 where s.status not in ('reversed','cancelled') and c.seller_id is not null and c.seller_id <> s.seller_id;

rollback;
