-- Goldia schema signature (read only): one line per function (F), function body hash (H), column (C), policy (P),
-- trigger (T) and RLS-enabled table (R) in schema public. Extension-owned functions are excluded. Used by scripts/goldia-staging-release.js.
select coalesce(string_agg(s, E'\n' order by s), '') from (
  select 'F ' || p.oid::regprocedure::text || ' -> ' || pg_get_function_result(p.oid) || case when p.prosecdef then ' SECDEF' else '' end as s
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  union all
  select 'C ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' NOT NULL' else '' end
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v') and a.attnum > 0 and not a.attisdropped
     and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  union all
  select 'P ' || tablename || ' ' || policyname || ' ' || cmd from pg_policies where schemaname = 'public'
  union all
  select 'T ' || c.relname || ' ' || t.tgname || case when t.tgenabled = 'D' then ' DISABLED' else '' end
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
  union all
  select 'H ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc)
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  union all
  select 'R ' || c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
) x;
