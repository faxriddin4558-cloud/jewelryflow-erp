-- GOLDIA SALES - production VERSION DRIFT AUDIT (READ ONLY). Generated 2026-11-09 for the frontend 2b48df9.
-- Run only through docs/releases/production-075/run-readonly-checks.ps1 -Target production-drift-audit
-- (explicit BEGIN TRANSACTION READ ONLY wrapper + guard). One SELECT, no writes, no transaction control.
-- Output: DRIFT|<key>|<state>|<detail>   state INFO / OK / WARN (owner looks) / STOP (incompatible or unsafe)
--         RESULT|drift_audit|OK|WARN|STOP
-- No e-mail, password, token or customer name is printed (counts and roles only).
with
repo_versions(v) as (select unnest(array['20260101000001', '20260101000002', '20260101000003', '20260101000004', '20260101000005', '20260101000006', '20260101000007', '20260101000008', '20260101000009', '20260101000010', '20260101000011', '20260101000012', '20260101000013', '20260101000014', '20260101000015', '20260101000016', '20260101000017', '20260101000018', '20260101000019', '20260101000020', '20260101000021', '20260101000022', '20260101000023', '20260101000024', '20260101000025', '20260101000026', '20260101000027', '20260101000028', '20260101000029', '20260101000030', '20260101000031', '20260101000032', '20260101000033', '20260101000034', '20260101000035', '20260101000036', '20260101000037', '20260101000038', '20260101000039', '20260101000040', '20260101000041', '20260101000042', '20260101000043', '20260101000044', '20260101000045', '20260101000046', '20260101000047', '20260101000048', '20260101000049', '20260101000050', '20260101000051', '20260101000052', '20260101000053', '20260101000054', '20260101000055', '20260101000056', '20260101000057', '20260101000058', '20260101000059', '20260101000060', '20260101000061', '20260101000062', '20260101000063', '20260101000064', '20260101000065', '20260101000066', '20260101000067', '20260101000068', '20260101000069', '20260101000070', '20260101000071', '20260101000072', '20260101000073', '20260101000074', '20260101000075', '20260101000076', '20260101000077', '20260101000078', '20260101000079', '20260101000080', '20260101000081']::text[])),
hist as (select version from supabase_migrations.schema_migrations),
lvl as (select max(version) as latest, count(*) as n from hist),
gaps as (select string_agg(right(r.v, 3), ',' order by r.v) as g from repo_versions r, lvl where r.v < lvl.latest and not exists (select 1 from hist h where h.version = r.v)),
unknown as (select string_agg(h.version, ',' order by h.version) as u from hist h where not exists (select 1 from repo_versions r where r.v = h.version)),
-- every RPC the 2b48df9 frontend calls (src/ at 2b48df9), with the migration that first creates it
fe_rpc(name, since) as (values
  ('current_employee_id', '015'),
  ('current_employee_role_text', '015'),
  ('get_seller_available_stock_grams', '045'),
  ('rpc_accept_stage_handover', '019'),
  ('rpc_archive_customer', '051'),
  ('rpc_close_report_period', '077'),
  ('rpc_complete_qc_rework', '024'),
  ('rpc_confirm_accounting_baseline', '047'),
  ('rpc_create_batch_with_gold_issue', '016'),
  ('rpc_create_customer_with_code', '034'),
  ('rpc_create_jewelry_model', '030'),
  ('rpc_create_order_with_advance', '016'),
  ('rpc_create_product_with_bom', '016'),
  ('rpc_dispatch_stage_handover', '019'),
  ('rpc_execute_affinaj_transaction', '016'),
  ('rpc_execute_alloy_transaction', '016'),
  ('rpc_execute_full_test_reset', '060'),
  ('rpc_execute_selective_test_cleanup', '051'),
  ('rpc_execute_sheets_historical_import', '033'),
  ('rpc_generate_telegram_link_code', '033'),
  ('rpc_get_accounting_profit_summary', '047'),
  ('rpc_get_active_sales_markups', '027'),
  ('rpc_get_company_rate_difference_report', '066'),
  ('rpc_get_customer_monthly_report', '034'),
  ('rpc_get_daily_sales_ledger', '034'),
  ('rpc_get_factory_settings', '023'),
  ('rpc_get_manager_available_stock_grams', '071'),
  ('rpc_get_period_report', '077'),
  ('rpc_get_seller_markup_difference_report', '067'),
  ('rpc_get_seller_rates', '072'),
  ('rpc_get_seller_reconciliation_statement', '034'),
  ('rpc_get_unified_customer_ledger', '040'),
  ('rpc_inventory_transaction', '016'),
  ('rpc_issue_barcode_consignment', '028'),
  ('rpc_issue_seller_consignment', '026'),
  ('rpc_launch_order_production_chain', '016'),
  ('rpc_manage_sales_markup_preset', '027'),
  ('rpc_move_partial_wip', '016'),
  ('rpc_override_stage_handover', '019'),
  ('rpc_preview_full_test_reset', '060'),
  ('rpc_preview_selective_test_cleanup', '051'),
  ('rpc_reclassify_capital_transaction', '056'),
  ('rpc_record_barcode_piece_sale', '028'),
  ('rpc_record_client_currency_settlement', '077'),
  ('rpc_record_client_jewelry_sale', '026'),
  ('rpc_record_client_legacy_debt', '051'),
  ('rpc_record_client_settlement', '026'),
  ('rpc_record_currency_sale', '077'),
  ('rpc_record_debt_repayment', '016'),
  ('rpc_record_factory_gold_handover', '032'),
  ('rpc_record_factory_receipt', '032'),
  ('rpc_record_financial_transaction', '047'),
  ('rpc_record_gold_purchase', '032'),
  ('rpc_record_login_audit', '033'),
  ('rpc_record_qc_inspection', '023'),
  ('rpc_record_refining_batch', '032'),
  ('rpc_record_salary_transaction', '016'),
  ('rpc_record_sale_with_stock_deduction', '016'),
  ('rpc_record_seller_to_manager_settlement', '032'),
  ('rpc_record_stage_consumption', '016'),
  ('rpc_record_weight_sale', '045'),
  ('rpc_register_or_get_customer', '026'),
  ('rpc_reopen_report_period', '078'),
  ('rpc_return_piece_to_manager', '034'),
  ('rpc_return_sprue_to_scrap_inventory', '016'),
  ('rpc_reverse_barcode_consignment', '039'),
  ('rpc_reverse_client_currency_settlement', '077'),
  ('rpc_reverse_client_legacy_debt', '051'),
  ('rpc_reverse_client_sale', '045'),
  ('rpc_reverse_client_settlement', '039'),
  ('rpc_reverse_factory_gold_handover', '051'),
  ('rpc_reverse_factory_receipt', '039'),
  ('rpc_reverse_financial_transaction', '051'),
  ('rpc_reverse_gold_purchase', '051'),
  ('rpc_reverse_refining_batch', '051'),
  ('rpc_reverse_seller_to_manager_settlement', '039'),
  ('rpc_set_daily_gold_rate', '026'),
  ('rpc_set_my_seller_rates', '072'),
  ('rpc_split_batch', '016'),
  ('rpc_unlink_telegram', '033'),
  ('rpc_update_factory_settings', '023'),
  ('rpc_update_jewelry_model_photo', '031'),
  ('rpc_verify_and_link_telegram', '033')),
rpc_state as (
  select f.name, f.since,
         exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name) as present,
         coalesce((select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name), false) as granted
    from fe_rpc f),
fe_tab(t) as (values ('client_currency_accounts'), ('client_currency_settlements'), ('goldia_report_periods'), ('customers'), ('jewelry_sales'), ('client_gold_accounts'), ('client_legacy_debts'), ('financial_transactions'), ('manager_vault_account'), ('seller_gold_accounts')),
tab_state as (
  select t, to_regclass('public.' || t) is not null as present,
         coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || t)), false) as rls
    from fe_tab),
fn as (select p.proname, p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace),
emp as (select e.role, e.is_active, u.banned_until, u.email_confirmed_at, u.deleted_at
          from public.employees e left join auth.users u on u.id = e.user_id),
g(ord, k, st, d) as (
  select 10, 'not_jfs_demo', case when to_regprocedure('public.deployment_environment()') is null then 'OK' else 'STOP' end, 'deployment_environment() absent = Goldia'
  union all select 11, 'read_only', case when current_setting('transaction_read_only') = 'on' then 'OK' else 'STOP' end, 'transaction_read_only=' || current_setting('transaction_read_only')
  -- 1. migration history
  union all select 20, 'history_latest', 'INFO', 'latest=' || coalesce(latest, '-') || ' rows=' || n from lvl
  union all select 21, 'history_latest_known', case when (select latest from lvl) in (select v from repo_versions) then 'OK' else 'STOP' end, 'latest is a repository migration'
  union all select 22, 'history_gaps', case when (select g from gaps) is null then 'OK' else 'WARN' end, 'unrecorded repository versions below the level: ' || coalesce((select g from gaps), 'none')
  union all select 23, 'history_unknown', case when (select u from unknown) is null then 'OK' else 'WARN' end, 'recorded versions unknown to the repository: ' || coalesce((select u from unknown), 'none')
  union all select 24, 'history_077_080', 'INFO', (select string_agg(right(version, 3), ',' order by version) from hist where version > '20260101000076')
  -- 2. frontend 2b48df9 contract
  union all select 30, 'fe_rpc_present', case when bool_and(present) then 'OK' else 'STOP' end,
         count(*) filter (where present) || '/' || count(*) || ' present' || coalesce('; MISSING: ' || string_agg(name || '(' || since || ')', ',') filter (where not present), '') from rpc_state
  union all select 31, 'fe_rpc_execute_grant', case when bool_and(granted or not present) then 'OK' else 'STOP' end,
         count(*) filter (where granted) || '/' || count(*) || ' executable by authenticated' || coalesce('; NOT GRANTED: ' || string_agg(name, ',') filter (where present and not granted), '') from rpc_state
  union all select 32, 'fe_tables', case when bool_and(present and rls) then 'OK' else 'STOP' end,
         count(*) filter (where present) || '/' || count(*) || ' present, RLS on: ' || count(*) filter (where rls) || coalesce('; MISSING: ' || string_agg(t, ',') filter (where not present), '') from tab_state
  union all select 33, 'fe_customers_archive_columns', case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name in ('is_archived', 'archived_at', 'archived_by')) = 3 then 'OK' else 'STOP' end, 'customers.is_archived / archived_at / archived_by (078)'
  union all select 34, 'fe_sale_currency_column', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jewelry_sales' and column_name = 'sale_currency') then 'OK' else 'STOP' end, 'jewelry_sales.sale_currency (077)'
  -- 3. rules in the live function bodies (what the server actually enforces)
  union all select 40, 'parity_management_helper', case when exists (select 1 from fn where proname = '_goldia_is_management_role') then 'OK' else 'STOP' end, '_goldia_is_management_role (077: director = manager)'
  union all select 41, 'parity_functions_using_helper', 'INFO', (select count(*)::text from fn where prosrc like '%_goldia_is_management_role%') || ' functions check management through the helper'
  union all select 42, 'archive_rpc_seller_rule', case when (select bool_or(prosrc like '%_goldia_is_seller_role%') from fn where proname = 'rpc_archive_customer') then 'OK' else 'WARN' end, 'rpc_archive_customer has the 078 seller-own-customer branch'
  union all select 43, 'archived_sale_guard', case when exists (select 1 from pg_trigger where tgname = 'trg_goldia_guard_sale_archived_customer') then 'OK' else 'WARN' end, '079 D-A1 trigger (archived customer: no new sale)'
  union all select 44, 'assignment_guard', case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'customers' and t.tgname like '%assignment%') then 'OK' else 'WARN' end, '079 D-A2 trigger (only management assigns sellers)'
  union all select 45, 'period_report_080', case when exists (select 1 from pg_type where typname = '_goldia_period_effect' and typnamespace = 'public'::regnamespace) then 'OK' else 'WARN' end, '080 performance type present (report timeout fix)'
  union all select 46, 'legacy_advance_rule', 'INFO', case when (select bool_or(position('Avansni faqat menejer yoki direktor kiritadi' in prosrc) > 0) from fn where proname = 'rpc_record_client_legacy_debt') then '076 rule: seller cannot enter an advance (081 not applied) - matches the 2b48df9 UI' else '081 rule present (seller advance allowed) - the 2b48df9 UI does not offer it' end
  union all select 47, 'test_reset_director_only', 'INFO', 'rpc_execute_full_test_reset present=' || exists (select 1 from fn where proname = 'rpc_execute_full_test_reset')::text || ' (D-P1: director-only by decision)'
  -- 4. accounting / business sanity (read only, counts and sums only)
  union all select 50, 'negative_gold_balances', case when (select count(*) from public.client_gold_accounts where current_debt_grams < 0 or advance_balance_grams < 0) = 0 then 'OK' else 'STOP' end, (select count(*)::text from public.client_gold_accounts where current_debt_grams < 0 or advance_balance_grams < 0) || ' customer gold accounts below 0'
  union all select 51, 'debt_and_advance_at_once', case when (select count(*) from public.client_gold_accounts where current_debt_grams > 0 and advance_balance_grams > 0) = 0 then 'OK' else 'WARN' end, (select count(*)::text from public.client_gold_accounts where current_debt_grams > 0 and advance_balance_grams > 0) || ' customers with gold debt AND advance'
  union all select 52, 'seller_obligation_negative', case when (select count(*) from public.seller_gold_accounts where seller_owes_manager_g < 0 or current_physical_stock_g < 0) = 0 then 'OK' else 'STOP' end, (select count(*)::text from public.seller_gold_accounts where seller_owes_manager_g < 0 or current_physical_stock_g < 0) || ' seller accounts below 0'
  union all select 53, 'vault_negative', case when (select count(*) from public.manager_vault_account where manager_cash_amount < 0 or manager_usd_amount < 0) = 0 then 'OK' else 'STOP' end, (select count(*)::text from public.manager_vault_account where manager_cash_amount < 0 or manager_usd_amount < 0) || ' vaults with negative UZS / USD'
  union all select 54, 'currency_activity', 'INFO', case when to_regclass('public.client_currency_accounts') is null then 'no currency tables (pre-077)' else
         'currency sales by currency: ' || coalesce((xpath('/row/c/text()', query_to_xml($q$select string_agg(sale_currency || '=' || n, ' ') as c from (select sale_currency, count(*) n from public.jewelry_sales where sale_currency in ('UZS', 'USD') group by sale_currency) s$q$, false, true, '')))[1]::text, 'none')
         || '; currency accounts: ' || (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.client_currency_accounts$q$, false, true, '')))[1]::text || '; currency payments: ' || (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.client_currency_settlements$q$, false, true, '')))[1]::text end
  union all select 55, 'currency_negative', case when to_regclass('public.client_currency_accounts') is null then 'INFO' when (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.client_currency_accounts where debt_amount < 0 or advance_amount < 0$q$, false, true, '')))[1]::text = '0' then 'OK' else 'STOP' end,
         case when to_regclass('public.client_currency_accounts') is null then '-' else (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.client_currency_accounts where debt_amount < 0 or advance_amount < 0$q$, false, true, '')))[1]::text || ' currency accounts below 0' end
  union all select 56, 'archived_customers', 'INFO', (select count(*) filter (where is_archived)::text || ' archived of ' || count(*) from public.customers)
  union all select 57, 'archived_with_open_gold', 'INFO', (select count(*)::text from public.customers c join public.client_gold_accounts a on a.customer_id = c.id where c.is_archived and (a.current_debt_grams <> 0 or a.advance_balance_grams <> 0)) || ' archived customers still with gold debt / advance (allowed: payments stay possible)'
  union all select 58, 'report_periods', 'INFO', case when to_regclass('public.goldia_report_periods') is null then 'no table (pre-077)' else (xpath('/row/c/text()', query_to_xml($q$select count(*) || ' stored periods, latest end ' || coalesce(max(period_end)::text, '-') as c from public.goldia_report_periods$q$, false, true, '')))[1]::text end
  union all select 59, 'legacy_advances_by_role', 'INFO', (select count(*)::text from public.client_legacy_debts where balance_type = 'advance' and status = 'confirmed') || ' confirmed legacy advances'
  union all select 60, 'activity_since_2026_11_06', 'INFO', 'sales=' || (select count(*) from public.jewelry_sales where created_at >= '2026-11-06') || ' payments=' || (select count(*) from public.gold_settlements where created_at >= '2026-11-06') || ' financial=' || (select count(*) from public.financial_transactions where created_at >= '2026-11-06')
  -- 5. staff accounts (explains login failures; no e-mails)
  union all select 70, 'staff_accounts', 'INFO', (select string_agg(role || ': ' || n || ' active, banned ' || b || ', unconfirmed ' || uc, '; ' order by role) from (
         select role, count(*) filter (where is_active) n, count(*) filter (where banned_until > now()) b, count(*) filter (where email_confirmed_at is null and deleted_at is null) uc
           from emp group by role) x)
  union all select 71, 'management_accounts_usable', case when (select count(*) from emp where role in ('admin', 'production_manager') and is_active and (banned_until is null or banned_until < now()) and email_confirmed_at is not null) >= 1 then 'OK' else 'WARN' end,
         (select count(*)::text from emp where role = 'production_manager' and is_active and (banned_until is null or banned_until < now()) and email_confirmed_at is not null) || ' active, unbanned, confirmed managers; ' ||
         (select count(*)::text from emp where role = 'admin' and is_active and (banned_until is null or banned_until < now()) and email_confirmed_at is not null) || ' directors'
)
select line from (
  select ord, 'DRIFT|' || k || '|' || st || '|' || d as line from g
  union all
  select 999, 'RESULT|drift_audit|' || case when bool_or(st = 'STOP') then 'STOP' when bool_or(st = 'WARN') then 'WARN' else 'OK' end from g
) z order by ord;
