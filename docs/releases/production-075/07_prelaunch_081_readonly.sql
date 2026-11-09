-- GOLDIA PRODUCTION PRE-RELEASE CHECK for 081 (seller legacy advance; production at 080) - READ ONLY.
-- One read-only transaction, rolled back. Aggregates only - no names, phones or customer data, no ids.
-- Output: PRE|<key>|<state>|<detail>  (INFO, OK, WARN = owner looks first, STOP = blocks) and RESULT|prelaunch_081|OK|WARN|STOP.
begin transaction read only;
set local statement_timeout = '120s';

with
hist as (select max(version) as latest from supabase_migrations.schema_migrations),
fn as (select prosrc from pg_proc where oid = 'public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure),
leg as (select balance_type, status, created_by from public.client_legacy_debts),
g(k, st, d) as (
  select 'history_latest', case when latest = '20260101000080' then 'OK' else 'STOP' end, 'latest=' || coalesce(latest, '-') || ' (expected 080 before 081)' from hist
  union all
  select 'legacy_function_at_076_rules', case when (select position('Avansni faqat menejer yoki direktor kiritadi' in prosrc) > 0 from fn) then 'OK' else 'STOP' end,
         'seller advance refused today (081 not applied yet, no drift)'
  union all
  select 'legacy_rows', 'INFO', 'debt=' || count(*) filter (where balance_type = 'debt') || ' advance=' || count(*) filter (where balance_type = 'advance')
           || ' reversed=' || count(*) filter (where status = 'reversed') from leg
  union all
  select 'customers_debt_and_advance_at_once', case when count(*) = 0 then 'OK' else 'WARN' end,
         'client accounts with debt > 0 AND advance > 0 = ' || count(*) from public.client_gold_accounts where current_debt_grams > 0 and advance_balance_grams > 0
  union all
  select 'negative_customer_balances', case when count(*) = 0 then 'OK' else 'STOP' end,
         'client accounts with a negative debt or advance = ' || count(*) from public.client_gold_accounts where current_debt_grams < 0 or advance_balance_grams < 0
  union all
  select 'legacy_obligation_drift', case when count(*) = 0 then 'OK' else 'WARN' end,
         'sellers whose legacy obligation <> max(0, active debt deltas) = ' || count(*)
    from public.seller_gold_accounts s
   where abs(coalesce(s.seller_legacy_debt_obligation_g, 0) - greatest(0, coalesce((select sum(d.delta_585_g) from public.client_legacy_debts d
            where d.seller_id = s.seller_id and d.organization_id = s.organization_id and d.balance_type = 'debt' and d.status <> 'reversed'), 0))) > 0.00005
)
select 'PRE|' || k || '|' || st || '|' || d from g
union all
select 'RESULT|prelaunch_081|' || case when bool_or(st = 'STOP') then 'STOP' when bool_or(st = 'WARN') then 'WARN' else 'OK' end from g
order by 1;

rollback;
