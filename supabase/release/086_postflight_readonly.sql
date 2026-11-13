-- POSTFLIGHT for migration 086 (financial write freeze + server-side T0) - READ ONLY. Every column must be true.
-- The migration creates schema and functions only: right after it no freeze exists and nothing is frozen.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000086') as recorded,
  -- the freeze table: RLS on, no write for signed-in users, nothing for anon, one active freeze per organization
  (select c.relrowsecurity from pg_class c where c.oid = 'public.financial_write_freezes'::regclass)
    and not has_table_privilege('authenticated', 'public.financial_write_freezes', 'INSERT')
    and not has_table_privilege('authenticated', 'public.financial_write_freezes', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.financial_write_freezes', 'DELETE')
    and not has_table_privilege('anon', 'public.financial_write_freezes', 'SELECT')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'financial_write_freezes_one_active') as freeze_table_locked,
  -- only the release tooling sets / releases a freeze; it waits for in-flight writers under the exclusive restart lock
  (select prosecdef and position('pg_advisory_xact_lock(hashtext(''goldia_financial_restart'')' in prosrc) > 0 and position('lock_timeout' in prosrc) > 0
     from pg_proc where oid = 'public._goldia_financial_freeze(uuid,text,boolean)'::regprocedure)
    and not has_function_privilege('authenticated', 'public._goldia_financial_freeze(uuid,text,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public._goldia_financial_freeze(uuid,text,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._goldia_active_freeze(uuid)', 'EXECUTE') as freeze_functions_private,
  -- the 085 draft guard keeps its rules and adds the freeze refusal (on all 12 tables, unchanged triggers)
  (select position('pg_try_advisory_xact_lock_shared' in prosrc) > 0 and position('ERR_OPENING_DRAFT' in prosrc) > 0
          and position('ERR_FINANCIAL_FREEZE' in prosrc) > 0 and position('goldia.opening_write' in prosrc) > 0
     from pg_proc where oid = 'public._goldia_guard_opening_draft()'::regprocedure)
    and (select count(distinct c.relname) = 12 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where tg.tgname = 'trg_goldia_opening_draft_guard' and not tg.tgisinternal)
    -- F3 audit: a baseline during a freeze only to lock the restart's opening
    and exists (select 1 from pg_trigger where tgname = 'trg_goldia_baseline_freeze' and tgrelid = 'public.accounting_baselines'::regclass and not tgisinternal) as guard_refuses_frozen_writes,
  -- a restart needs an active freeze and a server-checked T0
  exists (select 1 from pg_trigger where tgname = 'trg_goldia_restart_freeze_t0' and tgrelid = 'public.financial_restarts'::regclass and not tgisinternal)
    and (select position('ERR_FREEZE_REQUIRED' in prosrc) > 0 and position('ERR_T0_FUTURE' in prosrc) > 0 and position('ERR_T0_TOO_OLD' in prosrc) > 0
                and position('ERR_T0_BEFORE_FREEZE' in prosrc) > 0 and position('Asia/Tashkent' in prosrc) > 0
           from pg_proc where oid = 'public._goldia_guard_restart_t0()'::regprocedure) as restart_needs_freeze_and_t0,
  -- right after the migration nothing is frozen
  not exists (select 1 from public.financial_write_freezes) as nothing_frozen;

rollback;
