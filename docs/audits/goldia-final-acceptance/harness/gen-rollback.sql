\pset format unaligned
\pset tuples_only on
with f as (
  select p.oid, p.oid::regprocedure::text sig from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (
   'rpc_get_accounting_profit_summary','rpc_reverse_client_sale','rpc_record_client_settlement','rpc_record_client_jewelry_sale',
   'rpc_record_factory_receipt','rpc_record_financial_transaction','rpc_record_weight_sale','rpc_get_financial_reconciliation_summary',
   'rpc_get_three_tier_ledger_summary','rpc_get_seller_available_pieces','prevent_employee_privilege_escalation','rpc_set_daily_gold_rate')
)
select string_agg(pg_get_functiondef(f.oid) || ';' || chr(10)
  || 'revoke all on function public.' || f.sig || ' from public, anon, authenticated, service_role;' || chr(10)
  || coalesce((select string_agg('grant execute on function public.' || f.sig || ' to ' ||
        case when a.grantee = 0 then 'public' else quote_ident(r.rolname) end || ';', chr(10))
      from pg_proc p2, aclexplode(coalesce(p2.proacl, acldefault('f', p2.proowner))) a left join pg_roles r on r.oid = a.grantee
      where p2.oid = f.oid and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname in ('anon','authenticated','service_role'))), ''),
  chr(10) || chr(10) order by f.sig) from f;
select string_agg(format('drop policy if exists %I on public.%I;', policyname, tablename) || chr(10) ||
  format('create policy %I on public.%I as %s for %s to %s', policyname, tablename, permissive, cmd,
         (select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ') from unnest(roles) x))
  || coalesce(' using (' || qual || ')', '') || coalesce(' with check (' || with_check || ')', '') || ';', chr(10) order by tablename, policyname)
from pg_policies where schemaname = 'public' and (tablename, policyname) in (
  ('employees','admin manage employees'), ('employees','employees_select_own_or_authorized'),
  ('audit_logs','Only admins and managers can read audit logs'), ('idempotency_keys','Authenticated users can read own idempotency keys'),
  ('client_legacy_debts','client_legacy_debts_select_policy'));
