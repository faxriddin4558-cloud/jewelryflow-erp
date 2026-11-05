-- GOLDIA PRODUCTION PRE-RELEASE CHECK for 077 (production at 076) - READ ONLY.
-- One read-only transaction, rolled back. Aggregates only: no names, phones or customer data (ids are not printed).
-- Output: PRE|<key>|<state>|<detail>   state: INFO, OK, WARN (needs a look before workers start), STOP (blocks 076)
-- and RESULT|prelaunch_076|OK|WARN|STOP.
begin transaction read only;
set local statement_timeout = '120s';

with
emp as (
  select e.id, e.organization_id, e.is_active, e.user_id,
         case
           when public.normalize_erp_role_token(e.role_type) is not null and public.normalize_erp_role_token(e.role_type) not in ('worker', 'viewer') then public.normalize_erp_role_token(e.role_type)
           when public.normalize_erp_role_token(e.role::text) is not null and public.normalize_erp_role_token(e.role::text) not in ('worker', 'viewer') then public.normalize_erp_role_token(e.role::text)
           else coalesce(public.normalize_erp_role_token(e.role_type), public.normalize_erp_role_token(e.role::text), public.normalize_erp_role_token(e.position), 'viewer') end as nrole
    from public.employees e
),
logins as (select emp.* from emp join auth.users u on u.id = emp.user_id where emp.is_active),
leg as (select d.*, (select nrole from emp where emp.id = d.created_by) as creator_role from public.client_legacy_debts d),
dup as (
  select a.id from leg a join leg b on a.organization_id = b.organization_id and a.customer_id = b.customer_id and a.id < b.id
     and a.delta_585_g = b.delta_585_g and a.entry_type = b.entry_type and a.as_of_date = b.as_of_date
     and a.status <> 'reversed' and b.status <> 'reversed' and abs(extract(epoch from (b.created_at - a.created_at))) < 600
),
drift as (
  select s.seller_id, s.seller_legacy_debt_obligation_g as stored,
         coalesce((select sum(d.delta_585_g) from public.client_legacy_debts d where d.seller_id = s.seller_id and d.organization_id = s.organization_id
                    and d.balance_type = 'debt' and d.status <> 'reversed'), 0) as model
    from public.seller_gold_accounts s
),
stock as (
  select s.seller_id,
         coalesce((select sum(base_weight_grams) from public.seller_consignments c where c.seller_id = s.seller_id and c.organization_id = s.organization_id
                    and c.status in ('held_by_seller', 'partially_sold', 'fully_sold')), 0)
       - coalesce((select sum(base_weight_grams) from public.jewelry_sales j where j.seller_id = s.seller_id and j.organization_id = s.organization_id
                    and j.status not in ('cancelled', 'reversed')), 0) as raw_stock,
         coalesce((select sum(p.weight_grams) from public.consignment_pieces p where p.seller_id = s.seller_id and p.organization_id = s.organization_id
                    and p.status = 'held_by_seller'), 0) as held_pieces_g
    from public.seller_gold_accounts s
),
g(k, st, d) as (
  select 'history_latest', case when max(version) = '20260101000076' then 'OK' else 'STOP' end, 'latest=' || max(version) from supabase_migrations.schema_migrations
  union all
  -- the incident operation: a denied call leaves no row (the transaction is rolled back)
  select 'legacy_206_83_rows', 'INFO', 'rows with 206.83 g (amount or delta)=' || count(*)
         || ' active=' || count(*) filter (where status <> 'reversed') || coalesce(' created_by_roles=' || string_agg(distinct coalesce(creator_role, '?'), ','), '')
         || coalesce(' dates=' || string_agg(distinct as_of_date::text, ','), '')
    from leg where amount_585_g = 206.83 or delta_585_g = 206.83
  union all
  select 'legacy_rows_by_creator_role', 'INFO', coalesce(string_agg(creator_role || '=' || n, ' '), 'none')
    from (select coalesce(creator_role, '?') as creator_role, count(*) as n from leg group by 1 order by 1) x
  union all
  select 'legacy_duplicate_pairs_10min', case when count(*) = 0 then 'OK' else 'WARN' end, 'pairs=' || count(*) from dup
  union all
  select 'customers_with_debt_206_83', 'INFO', 'customers whose current debt is 206.83 g=' || count(*) from public.client_gold_accounts where current_debt_grams = 206.83
  union all
  -- who the real logins are for the database (assert_erp_permission normalizes like this)
  select 'active_logins_by_role', 'INFO', coalesce(string_agg(nrole || '=' || n, ' '), 'none')
    from (select nrole, count(*) as n from logins group by 1 order by 1) x
  union all
  select 'logins_with_unusable_role', case when count(*) = 0 then 'OK' else 'WARN' end,
         'active logins whose role is not admin / production_manager / seller / accountant / inventory_manager=' || count(*)
         || coalesce(' roles=' || string_agg(distinct nrole, ','), '')
    from logins where nrole not in ('admin', 'production_manager', 'seller', 'accountant', 'inventory_manager')
  union all
  select 'logins_without_organization', case when count(*) = 0 then 'OK' else 'WARN' end, 'active logins without organization=' || count(*) from logins where organization_id is null
  union all
  -- 077 impact
  select 'management_logins_id_differs_from_login', case when count(*) = 0 then 'OK' else 'WARN' end,
         'director / manager logins whose employee id <> login id=' || count(*) || ' (at 076 their cash-operation reversal fails: reversed_by FK; fixed in 077)'
    from logins where nrole in ('admin', 'production_manager') and id <> user_id
  union all
  select 'reclassified_capital_operations', case when count(*) filter (where status = 'reversed') = 0 then 'INFO' else 'WARN' end,
         'reclassified capital operations=' || count(*) || ' of them reversed later=' || count(*) filter (where status = 'reversed')
         || ' (before 077 the document kept the old-currency amount; a reversal used it in the new till - check those vaults)'
    from public.financial_transactions where reclassification_reason is not null
  union all
  select 'director_only_actions_used_by_director', 'INFO',
         'accounting baselines=' || (select count(*) from public.audit_logs where action ilike '%BASELINE%')
         || ' markup presets=' || (select count(*) from public.sales_markup_presets)
    from (select 1) x
  union all
  select 'seller_legacy_obligation_drift', case when count(*) = 0 then 'OK' else 'WARN' end,
         'sellers whose stored legacy obligation <> active debt entries=' || count(*) || ' max_diff_g=' || coalesce(max(abs(stored - model))::text, '0')
    from drift where abs(coalesce(stored, 0) - model) > 0.00005
  union all
  select 'seller_stock_negative_hidden', case when count(*) = 0 then 'OK' else 'WARN' end,
         'sellers whose consigned minus sold grams is negative (shown as 0)=' || count(*) || ' min_g=' || coalesce(min(raw_stock)::text, '0')
    from stock where raw_stock < -0.00005
  union all
  select 'seller_pieces_vs_gram_stock', 'INFO',
         'sellers whose held piece grams <> gram stock=' || count(*) filter (where abs(held_pieces_g - greatest(raw_stock, 0)) > 0.0001 and held_pieces_g > 0)
    from stock
  union all
  select 'failed_logins_last_48h', 'INFO', 'failed=' || count(*) filter (where status <> 'success') || ' success=' || count(*) filter (where status = 'success')
    from public.sales_login_audit_logs where created_at > now() - interval '48 hours'
)
select 'PRE|' || k || '|' || st || '|' || d from g
union all
select 'RESULT|prelaunch_077|' || case when bool_or(st = 'STOP') then 'STOP' when bool_or(st = 'WARN') then 'WARN' else 'OK' end from g
order by 1;

rollback;
