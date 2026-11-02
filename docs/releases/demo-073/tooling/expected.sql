-- expected Goldia objects at 073 (non-extension public functions, Goldia policies, Goldia table columns)
\pset format unaligned
\pset tuples_only on
select json_build_object(
 'functions', (select json_agg(json_build_object('sig', p.oid::regprocedure::text, 'name', p.proname, 'def', pg_get_functiondef(p.oid),
     'fp', md5(p.prosrc || '|' || pg_get_function_identity_arguments(p.oid) || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || p.provolatile::text || '|' || p.prorettype::regtype::text),
     'acl', (select coalesce(string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname end, ',' order by case when a.grantee = 0 then 'PUBLIC' else r.rolname end), '')
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles r on r.oid = a.grantee
             where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname in ('anon','authenticated','service_role')))
   ) order by p.oid::regprocedure::text)
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
 'policies', (select json_agg(json_build_object('t', tablename, 'n', policyname, 'cmd', cmd, 'perm', permissive, 'roles', roles::text,
     'using', qual, 'check', with_check) order by tablename, policyname) from pg_policies where schemaname = 'public'),
 'columns', (select json_object_agg(t, c) from (select c.relname t, string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attname) c
     from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' group by c.relname) x),
 'rls', (select json_agg(relname order by relname) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity)
);
