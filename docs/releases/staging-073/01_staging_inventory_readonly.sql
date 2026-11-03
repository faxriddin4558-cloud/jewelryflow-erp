-- GOLDIA STAGING INVENTORY — READ ONLY.
-- Run in the Supabase SQL Editor of the STAGING project (vouehtlmsunebracahon) only.
-- It only reads catalog objects and row COUNTS. It returns no names, phones, amounts or e-mails.
-- One result grid: check | value. Paste the grid back (it contains no secrets).
begin transaction read only;

with
mig as (
  select
    case when to_regclass('supabase_migrations.schema_migrations') is null then null
         else (xpath('/row/v/text()', query_to_xml(
           'select string_agg(version || coalesce('' '' || name, ''''), '' | '' order by version) as v
              from supabase_migrations.schema_migrations where version >= ''20260101000060''', false, true, '')))[1]::text
    end as tail,
    case when to_regclass('supabase_migrations.schema_migrations') is null then null
         else (xpath('/row/v/text()', query_to_xml(
           'select count(*)::text || '' rows, max '' || max(version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text
    end as summary
),
tbl(t) as (
  values ('organizations'), ('employees'), ('factory_receipts'), ('seller_consignments'), ('consignment_pieces'),
         ('jewelry_sales'), ('weight_sale_allocations'), ('gold_settlements'), ('two_party_handovers'),
         ('factory_gold_handovers'), ('daily_gold_rates'), ('seller_rate_history'), ('gold_purchases'),
         ('refining_batches'), ('financial_transactions'), ('client_gold_accounts'), ('seller_gold_accounts'),
         ('client_legacy_debts'), ('idempotency_keys'), ('audit_logs')
),
counts as (
  select t,
         case when to_regclass('public.' || t) is null then 'MISSING'
              else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text
         end as c
  from tbl
)
select '00 database' as check, current_database() || ' / pg ' || current_setting('server_version') as value
union all select '02 deployment_environment()',
  case when to_regprocedure('public.deployment_environment()') is null then 'function absent' else 'function present' end
union all select '03 migrations summary', coalesce((select summary from mig), 'supabase_migrations.schema_migrations ABSENT')
union all select '04 migrations >= 060', coalesce((select tail from mig), '-')
union all select '10 m069 no anon SECURITY DEFINER rpc',
  (select (count(*) = 0)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname like 'rpc\_%' and has_function_privilege('anon', p.oid, 'EXECUTE'))
union all select '11 m070 consignment oversell guard',
  coalesce((select (position('ERR_CONSIGNMENT_PARTIALLY_USED' in p.prosrc) > 0)::text from pg_proc p
     where p.oid = to_regprocedure('public.rpc_record_client_jewelry_sale(uuid,uuid,numeric,text,text)')), 'function absent')
union all select '12 m071 rpc_get_manager_available_stock_grams',
  (exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'rpc_get_manager_available_stock_grams'))::text
union all select '13 m072 seller_gold_accounts.till_valued_cash_uzs',
  (exists (select 1 from information_schema.columns where table_schema = 'public'
     and table_name = 'seller_gold_accounts' and column_name = 'till_valued_cash_uzs'))::text
union all select '14 m073 _goldia_business_date',
  (to_regprocedure('public._goldia_business_date(timestamptz)') is not null)::text
union all select '15 m073 weight sale with p_piece_ids',
  (to_regprocedure('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text,uuid[])') is not null)::text
union all select '20 public tables / rpc functions',
  (select count(*)::text from pg_tables where schemaname = 'public') || ' / ' ||
  (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname like 'rpc\_%')
union all select '21 non-Goldia public tables',
  coalesce((select string_agg(tablename, ', ' order by tablename) from pg_tables where schemaname = 'public'
     and tablename in ('deployment_settings', 'organization_profiles', 'currency_rates')), 'none')
union all select '30 auth.users (count)', (select count(*)::text from auth.users)
union all select '31 employees by role (count)',
  coalesce((select string_agg(r || '=' || n, ', ' order by r) from (
     select coalesce(role::text, '?') as r, count(*)::text as n from public.employees group by 1) x), '-')
union all select '32 last business activity',
  coalesce((select max(created_at)::text from public.jewelry_sales), 'no sales')
union all select '40 rows ' || t, c from counts
order by 1;

rollback;
