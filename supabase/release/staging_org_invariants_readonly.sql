-- READ ONLY. Per-organization fingerprint of every financial table (all columns of every row) plus row counts.
-- PHASE D: before / after the integration tests every organization except the test organization must be identical
-- (any write, even a timestamp, changes the fingerprint -> STOP). audit_logs is included: a login audit row also counts.
-- Output: INV|<organization id>|<rows>|<md5 over its per-table lines>   and   INVT|<org>|<table>|<rows>|<md5>
begin transaction read only;
with per_table as (
  select q.j->>'organization_id' org, q.tbl, count(*) n, md5(string_agg(q.j::text, ';' order by q.j::text)) h
    from (
    select 'client_gold_accounts' tbl, to_jsonb(r) j from public.client_gold_accounts r union all
    select 'client_currency_accounts' tbl, to_jsonb(r) j from public.client_currency_accounts r union all
    select 'seller_gold_accounts' tbl, to_jsonb(r) j from public.seller_gold_accounts r union all
    select 'manager_vault_account' tbl, to_jsonb(r) j from public.manager_vault_account r union all
    select 'customers' tbl, to_jsonb(r) j from public.customers r union all
    select 'employees' tbl, to_jsonb(r) j from public.employees r union all
    select 'jewelry_sales' tbl, to_jsonb(r) j from public.jewelry_sales r union all
    select 'jewelry_sale_returns' tbl, to_jsonb(r) j from public.jewelry_sale_returns r union all
    select 'gold_settlements' tbl, to_jsonb(r) j from public.gold_settlements r union all
    select 'client_currency_settlements' tbl, to_jsonb(r) j from public.client_currency_settlements r union all
    select 'client_legacy_debts' tbl, to_jsonb(r) j from public.client_legacy_debts r union all
    select 'seller_consignments' tbl, to_jsonb(r) j from public.seller_consignments r union all
    select 'consignment_pieces' tbl, to_jsonb(r) j from public.consignment_pieces r union all
    select 'factory_receipts' tbl, to_jsonb(r) j from public.factory_receipts r union all
    select 'factory_gold_handovers' tbl, to_jsonb(r) j from public.factory_gold_handovers r union all
    select 'refining_batches' tbl, to_jsonb(r) j from public.refining_batches r union all
    select 'financial_transactions' tbl, to_jsonb(r) j from public.financial_transactions r union all
    select 'gold_purchases' tbl, to_jsonb(r) j from public.gold_purchases r union all
    select 'accounting_baselines' tbl, to_jsonb(r) j from public.accounting_baselines r union all
    select 'opening_periods' tbl, to_jsonb(r) j from public.opening_periods r union all
    select 'opening_documents' tbl, to_jsonb(r) j from public.opening_documents r union all
    select 'financial_restarts' tbl, to_jsonb(r) j from public.financial_restarts r union all
    select 'daily_gold_rates' tbl, to_jsonb(r) j from public.daily_gold_rates r union all
    select 'audit_logs' tbl, to_jsonb(r) j from public.audit_logs r
    ) q
   where q.j->>'organization_id' is not null
   group by 1, 2)
select 'INV|' || org || '|' || sum(n) || '|' || md5(string_agg(tbl || ':' || n || ':' || h, ';' order by tbl)) as line from per_table group by org
union all
select 'INVT|' || org || '|' || tbl || '|' || n || '|' || h from per_table
order by 1;
rollback;
