-- POSTFLIGHT for migration 079 (D-A1 no new sale to an archived customer; D-A2 seller cannot reassign customers) - READ ONLY.
-- Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000079') as recorded,
  exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgrelid = 'public.jewelry_sales'::regclass and t.tgname = 'trg_goldia_guard_sale_archived_customer'
             and t.tgenabled <> 'D' and p.prosrc like '%ERR_CUSTOMER_ARCHIVED%') as sale_block_trigger,
  exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgrelid = 'public.customers'::regclass and t.tgname = 'trg_goldia_guard_customer_assignment'
             and t.tgenabled <> 'D' and not p.prosecdef) as assignment_guard_invoker,
  not has_function_privilege('authenticated', 'public._goldia_guard_sale_archived_customer()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._goldia_guard_customer_assignment()', 'EXECUTE') as guard_functions_private,
  -- payments are not sales: the guard is on jewelry_sales only
  not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
               where p.proname = '_goldia_guard_sale_archived_customer' and t.tgrelid <> 'public.jewelry_sales'::regclass) as payments_unaffected,
  -- 078 still in place
  exists (select 1 from pg_trigger where tgrelid = 'public.customers'::regclass and tgname = 'trg_goldia_guard_customer_archive') as archive_guard_kept;

rollback;
