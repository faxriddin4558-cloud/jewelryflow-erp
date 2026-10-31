-- PRODUCTION POSTFLIGHT for migration 066 — READ ONLY.

begin transaction read only;

-- Q1. 066 recorded
select version from supabase_migrations.schema_migrations where version = '20260101000066';

-- Q2. Ledger, triggers and report exist (expected: t, 3, t)
select to_regclass('public.company_rate_differences') is not null as ledger_table,
       (select count(*) from pg_trigger where tgname in ('trg_goldia_rate_difference_from_purchase',
          'trg_goldia_valued_cash_from_settlement', 'trg_goldia_cap_valued_pool') and not tgisinternal) as triggers,
       to_regprocedure('public.rpc_get_company_rate_difference_report(date,date)') is not null as report_rpc;

-- Q3. Nothing historical changed: valued pool starts empty, ledger starts empty (expected: 0, 0, 0)
select (select count(*) from public.company_rate_differences) as ledger_rows,
       (select coalesce(sum(valued_cash_uzs), 0) from public.manager_vault_account) as valued_cash_uzs,
       (select coalesce(sum(valued_usd), 0) from public.manager_vault_account) as valued_usd;

-- Q4. Clients cannot write the ledger (expected: 0 rows)
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'company_rate_differences'
   and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

rollback;
