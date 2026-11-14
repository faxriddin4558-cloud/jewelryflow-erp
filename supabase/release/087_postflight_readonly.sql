-- POSTFLIGHT for migration 087 (backup verification inside the active freeze; one restart per freeze) - READ ONLY.
-- Every column must be true. 087 changes one function body only; no business row.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000087') as recorded,
  -- the restart gate keeps every 086 rule and adds the two 087 refusals
  (select position('ERR_FREEZE_REQUIRED' in prosrc) > 0 and position('ERR_T0_FUTURE' in prosrc) > 0 and position('ERR_T0_TOO_OLD' in prosrc) > 0
          and position('ERR_T0_BEFORE_FREEZE' in prosrc) > 0 and position('Asia/Tashkent' in prosrc) > 0
          and position('ERR_BACKUP_BEFORE_FREEZE' in prosrc) > 0 and position('ERR_FREEZE_ALREADY_USED' in prosrc) > 0
          and position('v_bv_at < v_frozen' in prosrc) > 0 and prosecdef
     from pg_proc where oid = 'public._goldia_guard_restart_t0()'::regprocedure) as restart_needs_backup_inside_freeze,
  exists (select 1 from pg_trigger where tgname = 'trg_goldia_restart_freeze_t0' and tgrelid = 'public.financial_restarts'::regclass and not tgisinternal and tgenabled = 'O') as restart_trigger_enabled,
  not has_function_privilege('authenticated', 'public._goldia_guard_restart_t0()', 'EXECUTE')
    and not has_function_privilege('anon', 'public._goldia_guard_restart_t0()', 'EXECUTE') as gate_private;

rollback;
