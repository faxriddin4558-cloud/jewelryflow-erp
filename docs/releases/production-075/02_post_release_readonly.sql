-- GOLDIA PRODUCTION POST-RELEASE SMOKE (after 073 -> 074 -> 075) - READ ONLY (one read-only transaction, rolled back).
-- Aggregates and catalog facts only (no names, phones or customer data).
-- Output: POST|<gate>|PASS|<detail>  POST|<gate>|WARN|<detail>  POST|<gate>|FAIL|<detail>  POST|<info>|INFO|<detail>
-- and one line RESULT|post_release|PASS|WARN|FAIL. FAIL = the release is not in the expected state.
begin transaction read only;
set local statement_timeout = '120s';

with
hist as (
  select max(version) as latest, count(*) as n,
         count(*) filter (where version in ('20260101000073', '20260101000074', '20260101000075')) as new_n
    from supabase_migrations.schema_migrations
),
-- read RPCs the UI smoke test lets through its write guard: their bodies must not write. NOT in the list on purpose:
-- rpc_get_unified_customer_ledger (refreshes the client_gold_accounts debt cache with an upsert since 069) and
-- rpc_get_factory_settings (inserts a settings row when an organization has none) - the UI smoke blocks both.
ui_read_rpcs(name) as (values
  ('current_employee_id'), ('current_employee_role_text'), ('get_manager_available_stock_grams'), ('get_seller_available_stock_grams'),
  ('rpc_get_accounting_profit_summary'), ('rpc_get_active_sales_markups'), ('rpc_get_company_rate_difference_report'),
  ('rpc_get_customer_monthly_report'), ('rpc_get_daily_sales_ledger'), ('rpc_get_manager_available_stock_grams'),
  ('rpc_get_seller_markup_difference_report'), ('rpc_get_seller_rates'), ('rpc_get_seller_reconciliation_statement')
),
-- 077 read RPCs (only checked when they exist)
ui_read_rpcs_077(name) as (values ('rpc_get_period_report'), ('_goldia_period_effects')),
ui_rpc_facts as (
  select u.name,
         count(p.oid) as overloads,
         bool_or(regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\m(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from|truncate|perform\s+set_config)\M') as has_dml
    from ui_read_rpcs u
    left join pg_proc p on p.proname = u.name and p.pronamespace = 'public'::regnamespace
   group by u.name
),
g(gate, state, detail) as (
  select 'history_latest_075_to_083', case when latest in ('20260101000075', '20260101000076', '20260101000077', '20260101000078', '20260101000079', '20260101000080', '20260101000081', '20260101000082', '20260101000083') then 'PASS' else 'FAIL' end, 'latest=' || coalesce(latest, '-') || ' count=' || n from hist
  union all
  select 'history_073_074_075', case when new_n = 3 then 'PASS' else 'FAIL' end, 'present=' || new_n || '/3' from hist
  union all
  select 'rls_on_every_public_table',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         'tables_without_rls=' || count(*) || coalesce(' ' || string_agg(c.relname, ',' order by c.relname), '')
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
  union all
  select 'no_anon_security_definer_rpc',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         'definer_rpcs_executable_by_anon=' || count(*) || coalesce(' ' || string_agg(p.proname, ',' order by p.proname), '')
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')
  union all
  select 'ui_read_rpcs_077_do_not_write', case when count(*) filter (where regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\m(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from|truncate)\M') = 0 then 'PASS' else 'FAIL' end,
         'present=' || count(*) || ' with_dml=' || count(*) filter (where regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\m(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from|truncate)\M')
    from ui_read_rpcs_077 u join pg_proc p on p.proname = u.name and p.pronamespace = 'public'::regnamespace
  union all
  select 'ui_read_rpcs_exist', case when count(*) filter (where overloads = 0) = 0 then 'PASS' else 'FAIL' end,
         'missing=' || count(*) filter (where overloads = 0) || coalesce(' ' || string_agg(name, ',' order by name) filter (where overloads = 0), '')
    from ui_rpc_facts
  union all
  select 'ui_read_rpcs_do_not_write', case when count(*) filter (where has_dml) = 0 then 'PASS' else 'FAIL' end,
         'with_dml=' || count(*) filter (where has_dml) || coalesce(' ' || string_agg(name, ',' order by name) filter (where has_dml), '')
    from ui_rpc_facts
  union all
  -- balances that can never be negative (grams in stock / held pieces)
  select 'no_negative_stock',
         case when (select count(*) from public.seller_gold_accounts where current_physical_stock_g < 0) = 0
               and (select count(*) from public.manager_vault_account where manager_physical_stock_g < 0) = 0
               and (select count(*) from public.consignment_pieces where status = 'held_by_seller' and weight_grams <= 0) = 0 then 'PASS' else 'WARN' end,
         'seller_stock_lt0=' || (select count(*) from public.seller_gold_accounts where current_physical_stock_g < 0)
           || ' manager_stock_lt0=' || (select count(*) from public.manager_vault_account where manager_physical_stock_g < 0)
           || ' held_pieces_le0=' || (select count(*) from public.consignment_pieces where status = 'held_by_seller' and weight_grams <= 0)
  union all
  select 'no_negative_client_balances',
         case when (select count(*) from public.client_gold_accounts where current_debt_grams < 0 or advance_balance_grams < 0) = 0 then 'PASS' else 'WARN' end,
         'client_accounts_lt0=' || (select count(*) from public.client_gold_accounts where current_debt_grams < 0 or advance_balance_grams < 0)
  union all
  -- 075: customer codes unique inside each organization
  select 'customer_codes_unique_per_org',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, 'duplicate_codes=' || count(*)
    from (select organization_id, customer_code from public.customers where customer_code is not null group by 1, 2 having count(*) > 1) d
  union all
  -- every organization with active employees already has its factory settings row, so rpc_get_factory_settings only reads
  select 'factory_settings_rows', 'INFO',
         'orgs_with_employees_without_settings=' || count(*)
    from (select distinct e.organization_id from public.employees e where e.is_active and e.organization_id is not null) o
   where not exists (select 1 from public.organization_factory_settings s where s.organization_id = o.organization_id)
  union all
  select 'customer_ledger_rpc_writes_cache', 'INFO',
         case when bool_or(regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'insert\s+into\s+public\.client_gold_accounts')
              then 'yes: opening the customers page upserts client_gold_accounts (pre-release behaviour since 069; blocked by the UI smoke)'
              else 'no' end
    from pg_proc p where p.proname = 'rpc_get_unified_customer_ledger' and p.pronamespace = 'public'::regnamespace
  union all
  select 'active_logins', 'INFO',
         'active_employees_with_login=' || count(*) || ' orgs=' || count(distinct e.organization_id)
    from public.employees e join auth.users u on u.id = e.user_id where e.is_active
)
select 'POST|' || gate || '|' || state || '|' || detail from g
union all
select 'RESULT|post_release|' || case when bool_or(state = 'FAIL') then 'FAIL' when bool_or(state = 'WARN') then 'WARN' else 'PASS' end from g
order by 1;

rollback;
