-- GOLDIA PRODUCTION PRE-RELEASE CHECK for 078 + 079 (production at 076 before the 077 -> 078 -> 079 chain, or at 077 / 078)
-- READ ONLY: one read-only transaction, rolled back. Aggregates only - no names, phones or customer data, no ids.
-- Output: PRE|<key>|<state>|<detail>   state: INFO, OK, WARN (owner looks before the release), STOP (blocks the release)
-- and RESULT|prelaunch_078_079|OK|WARN|STOP.
-- What 078 / 079 change for existing data:
--   078  customers.archived_at / archived_by added (empty); sellers may archive their own customers; the archive guard
--        trigger applies to direct writes of the archive columns. Customers ALREADY archived (076 rpc_archive_customer,
--        director-only) stay archived.
--   079  D-A1: NO new sale to an archived customer -> customers that are archived today and still buy would be blocked
--        at once (restore them first); their old debt stays collectible. D-A2: sellers cannot change customers.seller_id.
begin transaction read only;
set local statement_timeout = '120s';

with
hist as (select max(version) as latest from supabase_migrations.schema_migrations),
arch as (
  select c.organization_id, c.id,
         coalesce(g.current_debt_grams, 0) as debt_g, coalesce(g.advance_balance_grams, 0) as adv_g,
         (select max(s.created_at) from public.jewelry_sales s where s.customer_id = c.id) as last_sale
    from public.customers c left join public.client_gold_accounts g on g.customer_id = c.id
   where coalesce(c.is_archived, false)
),
g(k, st, d) as (
  select 'history_latest', case when latest in ('20260101000076', '20260101000077', '20260101000078') then 'OK' else 'STOP' end,
         'latest=' || coalesce(latest, '-') || ' (expected 076 before the chain; 077 / 078 only if a chain step already ran)' from hist
  union all
  select 'objects_078_079_absent_or_consistent',
         case when (to_regprocedure('public.rpc_reopen_report_period(uuid,text)') is not null) = exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000078')
               and exists (select 1 from pg_trigger where tgname = 'trg_goldia_guard_sale_archived_customer') = exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000079')
              then 'OK' else 'STOP' end,
         'reopen_rpc=' || (to_regprocedure('public.rpc_reopen_report_period(uuid,text)') is not null)
           || ' sale_guard=' || exists (select 1 from pg_trigger where tgname = 'trg_goldia_guard_sale_archived_customer')
           || ' (an object without its history row = drift -> STOP)'
  union all
  select 'customers_archive_column', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'is_archived') then 'OK' else 'STOP' end,
         'customers.is_archived present (051)'
  union all
  select 'archived_customers_now', 'INFO', 'archived=' || count(*) || ' orgs=' || count(distinct organization_id) from arch
  union all
  -- 079 blocks new sales to these at once: the owner decides to restore them before or after the release
  select 'archived_customers_with_recent_sales', case when count(*) filter (where last_sale > now() - interval '30 days') > 0 then 'WARN' else 'OK' end,
         'archived customers with a sale in the last 30 days=' || count(*) filter (where last_sale > now() - interval '30 days')
           || ' (after 079 they can no longer buy until restored; payments keep working)' from arch
  union all
  select 'archived_customers_with_open_debt', 'INFO',
         'archived with 585 debt>0: ' || count(*) filter (where debt_g > 0) || ' total_g=' || round(coalesce(sum(debt_g), 0), 4)
           || '; with advance>0: ' || count(*) filter (where adv_g > 0) || ' (kept and collectible after 078 / 079)' from arch
  union all
  select 'unassigned_customers', 'INFO',
         'customers without seller=' || count(*) || ' (after 079 only director / manager assign them; sellers can still sell to them)'
    from public.customers where seller_id is null
  union all
  select 'customers_assigned_to_non_seller_or_other_org',
         case when count(*) = 0 then 'OK' else 'WARN' end,
         'customers whose seller is missing / inactive / in another organization=' || count(*)
    from public.customers c
   where c.seller_id is not null and not exists (select 1 from public.employees e where e.id = c.seller_id and e.organization_id = c.organization_id and e.is_active)
  union all
  select 'report_periods_table', 'INFO',
         case when to_regclass('public.goldia_report_periods') is null then 'absent (077 creates it)' else 'present' end
  union all
  select 'currency_tables', 'INFO',
         case when to_regclass('public.client_currency_accounts') is null then 'absent (077 creates them)' else 'present' end
)
select 'PRE|' || k || '|' || st || '|' || d from g
union all
select 'RESULT|prelaunch_078_079|' || case when bool_or(st = 'STOP') then 'STOP' when bool_or(st = 'WARN') then 'WARN' else 'OK' end from g
order by 1;

rollback;
