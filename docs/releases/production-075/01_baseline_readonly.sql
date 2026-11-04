-- GOLDIA PRODUCTION BASELINE before 073/074/075 — READ ONLY (one read-only transaction, rolled back).
-- Aggregates only (no names, phones or customer data). Run it before the release and after each migration:
-- 073, 074 and 075 change no business row, so every line except the migration history must stay identical.
-- Output: BASELINE | <key> | <value>   (keys sorted; compare two runs with Compare-Object, see README)
begin transaction read only;
set local statement_timeout = '120s';

with org_lines as (
  select o.id as org,
    -- customers and their gold accounts
    (select count(*) from public.customers c where c.organization_id = o.id) as customers,
    (select coalesce(sum(a.current_debt_grams), 0) from public.client_gold_accounts a join public.customers c on c.id = a.customer_id where c.organization_id = o.id) as client_debt_g,
    (select coalesce(sum(a.advance_balance_grams), 0) from public.client_gold_accounts a join public.customers c on c.id = a.customer_id where c.organization_id = o.id) as client_advance_g,
    -- sellers: obligation, debt, stock, till (cash / USD / scrap) and the 072 valued pool
    (select coalesce(sum(s.total_seller_obligation_g), 0) from public.seller_gold_accounts s where s.organization_id = o.id) as seller_obligation_g,
    (select coalesce(sum(s.seller_owes_manager_g), 0) from public.seller_gold_accounts s where s.organization_id = o.id) as seller_owes_g,
    (select coalesce(sum(s.current_physical_stock_g), 0) from public.seller_gold_accounts s where s.organization_id = o.id) as seller_stock_g,
    (select coalesce(sum(s.seller_till_cash_amount), 0) from public.seller_gold_accounts s where s.organization_id = o.id) as seller_till_uzs,
    (select coalesce(sum(s.seller_till_usd_amount), 0) from public.seller_gold_accounts s where s.organization_id = o.id) as seller_till_usd,
    (select coalesce(sum(s.seller_till_scrap_grams), 0) from public.seller_gold_accounts s where s.organization_id = o.id) as seller_till_scrap_g,
    (select coalesce(sum(s.till_valued_cash_585_g), 0) + coalesce(sum(s.till_valued_usd_585_g), 0) from public.seller_gold_accounts s where s.organization_id = o.id) as seller_till_valued_g,
    -- manager vault and factory
    (select coalesce(sum(v.manager_physical_stock_g), 0) from public.manager_vault_account v where v.organization_id = o.id) as manager_stock_g,
    (select coalesce(sum(v.manager_cash_amount), 0) from public.manager_vault_account v where v.organization_id = o.id) as manager_uzs,
    (select coalesce(sum(v.manager_usd_amount), 0) from public.manager_vault_account v where v.organization_id = o.id) as manager_usd,
    (select coalesce(sum(v.current_factory_obligation_g), 0) from public.manager_vault_account v where v.organization_id = o.id) as factory_obligation_g,
    (select coalesce(sum(v.total_factory_received_g), 0) from public.manager_vault_account v where v.organization_id = o.id) as factory_received_g,
    -- documents
    (select count(*) from public.jewelry_sales j where j.organization_id = o.id and j.status not in ('reversed', 'cancelled')) as active_sales,
    (select count(*) from public.gold_settlements g where g.organization_id = o.id) as settlements,
    (select count(*) from public.factory_receipts r where r.organization_id = o.id and r.status not in ('reversed', 'cancelled')) as active_receipts,
    (select count(*) from public.consignment_pieces p where p.organization_id = o.id and p.status = 'held_by_seller') as pieces_held,
    (select coalesce(sum(p.weight_grams), 0) from public.consignment_pieces p where p.organization_id = o.id and p.status = 'held_by_seller') as pieces_held_g
  from public.organizations o
),
kv(k, v) as (
  select 'org ' || org::text, concat_ws(' ',
    'cust=' || customers, 'debt_g=' || client_debt_g, 'adv_g=' || client_advance_g,
    'sel_obl_g=' || seller_obligation_g, 'sel_owes_g=' || seller_owes_g, 'sel_stock_g=' || seller_stock_g,
    'till_uzs=' || seller_till_uzs, 'till_usd=' || seller_till_usd, 'till_scrap_g=' || seller_till_scrap_g, 'till_valued_g=' || seller_till_valued_g,
    'mgr_stock_g=' || manager_stock_g, 'mgr_uzs=' || manager_uzs, 'mgr_usd=' || manager_usd,
    'fac_obl_g=' || factory_obligation_g, 'fac_recv_g=' || factory_received_g,
    'sales=' || active_sales, 'settl=' || settlements, 'rcpt=' || active_receipts, 'held=' || pieces_held, 'held_g=' || pieces_held_g)
  from org_lines
  union all select 'total client_debt_g', sum(client_debt_g)::text from org_lines
  union all select 'total client_advance_g', sum(client_advance_g)::text from org_lines
  union all select 'total seller_owes_g', sum(seller_owes_g)::text from org_lines
  union all select 'total seller_stock_g', sum(seller_stock_g)::text from org_lines
  union all select 'total seller_till_uzs', sum(seller_till_uzs)::text from org_lines
  union all select 'total seller_till_usd', sum(seller_till_usd)::text from org_lines
  union all select 'total manager_stock_g', sum(manager_stock_g)::text from org_lines
  union all select 'total manager_uzs', sum(manager_uzs)::text from org_lines
  union all select 'total manager_usd', sum(manager_usd)::text from org_lines
  union all select 'total factory_obligation_g', sum(factory_obligation_g)::text from org_lines
  union all select 'total pieces_held_g', sum(pieces_held_g)::text from org_lines
  -- row counts of every public base table (a migration of this release must not add or remove business rows)
  union all
  select 'rows ' || table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
    from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
  union all select 'history latest', (select max(version) from supabase_migrations.schema_migrations)
  union all select 'history count', (select count(*)::text from supabase_migrations.schema_migrations)
)
select 'BASELINE', k, v from kv
union all
-- one fingerprint over all organization and total lines (history lines excluded) for a quick equality check
select 'BASELINE', 'fingerprint business', md5(string_agg(k || '=' || v, ';' order by k)) from kv where k not like 'history %' and k <> 'rows audit_logs' and k <> 'rows idempotency_keys'
order by 2;

rollback;
