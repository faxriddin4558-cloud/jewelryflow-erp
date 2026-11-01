select md5(string_agg(x, '|' order by x)) from (
  select p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a),'') x from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
  union all select tablename||policyname||cmd||roles::text||coalesce(qual,'')||coalesce(with_check,'')||permissive from pg_policies where schemaname='public'
  union all select tgrelid::regclass::text||tgname||tgenabled::text from pg_trigger where not tgisinternal) s;
