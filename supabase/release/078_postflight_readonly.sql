-- POSTFLIGHT for migration 078 (seller archives / restores his own customer; reopen the latest report period) - READ ONLY.
-- Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000078') as recorded,
  -- archive RPC: seller allowed only for his own customer, management for all, idempotent, audited
  (select prosecdef and prosrc like '%_goldia_is_seller_role%' and prosrc like '%seller_id is distinct from v_emp%'
          and prosrc like '%''changed'', false%' and prosrc like '%ARCHIVE_CUSTOMER%'
     from pg_proc where oid = 'public.rpc_archive_customer(uuid,boolean)'::regprocedure) as archive_rpc_rule,
  not has_function_privilege('anon', 'public.rpc_archive_customer(uuid,boolean)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_archive_customer(uuid,boolean)', 'EXECUTE') as archive_rpc_grants,
  -- direct table writes follow the same rule (invoker trigger, enabled)
  exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgrelid = 'public.customers'::regclass and t.tgname = 'trg_goldia_guard_customer_archive'
             and t.tgenabled <> 'D' and not p.prosecdef) as archive_guard_trigger,
  (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'customers'
     and column_name in ('archived_at', 'archived_by')) as archive_columns,
  not has_function_privilege('authenticated', 'public._goldia_customer_open_balances(uuid)', 'EXECUTE') as balances_helper_private,
  -- physical delete of a customer with operations still forbidden (051)
  exists (select 1 from pg_trigger where tgrelid = 'public.customers'::regclass and tgname = 'trg_guard_customer_deletion' and tgenabled <> 'D') as delete_guard_kept,
  -- reopen latest period
  to_regprocedure('public.rpc_reopen_report_period(uuid,text)') is not null
    and not has_function_privilege('anon', 'public.rpc_reopen_report_period(uuid,text)', 'EXECUTE') as reopen_rpc;

rollback;
