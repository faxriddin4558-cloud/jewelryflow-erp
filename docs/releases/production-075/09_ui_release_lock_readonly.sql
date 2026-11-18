-- READ ONLY. UI-only production release (no database change): the opening / financial protections of the current
-- level are in place and no restart window is open. Every column must be true (run-readonly-checks kind "postflight").
begin transaction read only;

select
  -- no opening in draft: the opening of every organization that has one is locked (or closed)
  not exists (select 1 from public.opening_periods where status = 'draft') as opening_not_in_draft,
  -- no financial write freeze is active (no backup -> restart window in progress)
  not exists (select 1 from public.financial_write_freezes f where f.released_at is null and public._goldia_active_freeze(f.organization_id) is not null) as no_active_freeze,
  -- the draft / freeze guard on the 12 financial tables, the restart gate and the baseline gate are in place
  (select count(distinct c.relname) = 12 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where tg.tgname = 'trg_goldia_opening_draft_guard' and not tg.tgisinternal and tg.tgenabled = 'O')
    and exists (select 1 from pg_trigger where tgname = 'trg_goldia_restart_freeze_t0' and not tgisinternal and tgenabled = 'O')
    and exists (select 1 from pg_trigger where tgname = 'trg_goldia_baseline_freeze' and not tgisinternal and tgenabled = 'O') as guards_enabled,
  -- signed-in users still cannot write the protected opening / restart tables
  not has_table_privilege('authenticated', 'public.opening_documents', 'INSERT') and not has_table_privilege('authenticated', 'public.opening_periods', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.financial_write_freezes', 'INSERT') and not has_table_privilege('authenticated', 'public.financial_backup_verifications', 'INSERT') as protected_tables_locked;

rollback;
