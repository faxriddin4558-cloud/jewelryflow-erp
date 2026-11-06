-- POSTFLIGHT for migration 080 (period report performance; results unchanged) - READ ONLY. Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000080') as recorded,
  to_regtype('public._goldia_period_effect') is not null as effect_type,
  -- effects computed once per report: one call of _goldia_period_effects in the report body
  (select (length(prosrc) - length(replace(prosrc, '_goldia_period_effects(', ''))) / length('_goldia_period_effects(') = 1
     from pg_proc where oid = 'public.rpc_get_period_report(date,date,uuid)'::regprocedure) as effects_once,
  -- no correlated audit_logs lookup per sale
  (select position('a.record_id = s.id::text' in prosrc) = 0 and position('group by a.record_id' in prosrc) > 0
     from pg_proc where oid = 'public._goldia_period_effects(uuid)'::regprocedure) as grouped_reversal_join,
  -- rights unchanged: management only, not anon, the effects helper not callable by the API roles
  not has_function_privilege('anon', 'public.rpc_get_period_report(date,date,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_get_period_report(date,date,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._goldia_period_effects(uuid)', 'EXECUTE') as grants_unchanged,
  (select position('_goldia_is_management_role' in prosrc) > 0 and provolatile = 's' and prosecdef
     from pg_proc where oid = 'public.rpc_get_period_report(date,date,uuid)'::regprocedure) as management_only_stable;

rollback;
