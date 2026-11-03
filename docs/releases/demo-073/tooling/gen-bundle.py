import json, sys
E = json.load(open('/opt/goldia-audit/demo/expected-073.json'))
REPO = '/home/user/jewelryflow-erp/'
OUT = REPO + 'docs/releases/demo-073/'
MIG = ['20260101000070_goldia_acceptance_audit_fixes.sql', '20260101000071_goldia_seller_company_stock_guard.sql',
       '20260101000072_goldia_independent_seller_rates.sql', '20260101000073_goldia_release_candidate_stabilization.sql']
q = lambda s: "'" + s.replace("'", "''") + "'"
funcs = E['functions']; pols = E['policies']; cols = E['columns']; rls = E['rls']
goldia_names = sorted({f['name'] for f in funcs})
goldia_tables = sorted(cols.keys())

def expected_values():
    fv = ',\n'.join(f"  ({q(f['sig'])}, {q(f['fp'])}, {q(f['acl'])})" for f in funcs)
    pv = ',\n'.join(f"  ({q(p['t'])}, {q(p['n'])}, {q(p['cmd'])}, {q(p['perm'])}, {q(p['roles'])})" for p in pols)
    cv = ',\n'.join(f"  ({q(t)}, {q(c)})" for t, c in sorted(cols.items()))
    return fv, pv, cv

VERIFY = """
-- ===================================================== parity verification (shared by bundle and postflight)
with exp_f(sig, fp, acl) as (values
{FV}
), act_f as (
  select p.oid::regprocedure::text sig,
         md5(p.prosrc || '|' || pg_get_function_identity_arguments(p.oid) || '|' || p.prosecdef::text || '|' ||
             coalesce(array_to_string(p.proconfig, ','), '') || '|' || p.provolatile::text || '|' || p.prorettype::regtype::text) fp,
         (select coalesce(string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname end, ',' order by case when a.grantee = 0 then 'PUBLIC' else r.rolname end), '')
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles r on r.oid = a.grantee
           where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname in ('anon','authenticated','service_role'))) acl
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname = any (array[{GN}]::text[])
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
), exp_p(t, n, cmd, perm, roles) as (values
{PV}
), act_p as (
  select tablename t, policyname n, cmd, permissive perm, roles::text roles from pg_policies
   where schemaname = 'public' and tablename = any (array[{GT}]::text[])
), exp_c(t, c) as (values
{CV}
), act_c as (
  select c.relname t, string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attname) c
    from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any (array[{GT}]::text[]) group by c.relname
), diff as (
            select 'function missing: ' || e.sig d from exp_f e where not exists (select 1 from act_f a where a.sig = e.sig)
  union all select 'function extra overload: ' || a.sig from act_f a where not exists (select 1 from exp_f e where e.sig = a.sig)
  union all select 'function body/attributes differ: ' || e.sig from exp_f e join act_f a using (sig) where a.fp <> e.fp
  union all select 'function grants differ: ' || e.sig || ' expected [' || e.acl || '] got [' || a.acl || ']' from exp_f e join act_f a using (sig) where a.acl <> e.acl
  union all select 'policy missing: ' || e.t || '.' || e.n from exp_p e where not exists (select 1 from act_p a where a.t = e.t and a.n = e.n)
  union all select 'policy extra: ' || a.t || '.' || a.n from act_p a where not exists (select 1 from exp_p e where e.t = a.t and e.n = a.n)
  union all select 'policy differs: ' || e.t || '.' || e.n from exp_p e join act_p a on a.t = e.t and a.n = e.n where (a.cmd, a.perm, a.roles) is distinct from (e.cmd, e.perm, e.roles)
  union all select 'table missing: ' || e.t from exp_c e where not exists (select 1 from act_c a where a.t = e.t)
  union all select 'columns differ: ' || e.t from exp_c e join act_c a using (t) where a.c <> e.c
  union all select 'RLS disabled: ' || x from unnest(array[{RLS}]::text[]) x
     where not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = x and c.relrowsecurity)
)
"""

def build_verify():
    fv, pv, cv = expected_values()
    gn = ','.join(q(n) for n in goldia_names); gt = ','.join(q(t) for t in goldia_tables); rl = ','.join(q(t) for t in rls)
    return VERIFY.replace('{FV}', fv).replace('{PV}', pv).replace('{CV}', cv).replace('{GN}', gn).replace('{GT}', gt).replace('{RLS}', rl)

# fingerprint without defaults (defaults are deparsed text and may be formatted differently by another PG major)
import subprocess
PARTS = []
PARTS.append(f"""-- GOLDIA SALES — DEMO ONLY: bring demo project yvvbdoqncubtwlzskgml to the exact Goldia 073 schema.
-- Run ONCE in the demo project's Dashboard -> SQL Editor (whole file, one run). It is a single transaction:
-- any error (including the final parity check) rolls everything back and nothing changes.
-- * Refuses to run unless public.deployment_environment() = 'demo' and deployment_settings.environment = 'demo'
--   (production has neither, so it can never run there).
-- * Applies Goldia 070, 071, 072, 073 exactly as in the repository (commit 162a377).
-- * Parity: every Goldia function is (re)created with the 073 definition and grants; Goldia-named function overloads
--   and policies that do not exist in 073 are dropped; demo-only objects (organization_profiles, currency_rates,
--   deployment_settings, demo_* / provisioning functions) are left untouched.
-- * Does NOT change any business row, does NOT touch auth users, does NOT write supabase_migrations
--   (the demo history already uses versions 070-072 for other files; that history is left as it is).
-- * Ends with an in-transaction parity check against the 073 fingerprints; a mismatch aborts the whole run.
-- Generated from a PostgreSQL 16 database built from migrations 001-073 (docs/releases/demo-073/README.md).

begin;
set local lock_timeout = '10s';
set local statement_timeout = '10min';

do $guard$
declare v_env text; v_set integer;
begin
  if to_regprocedure('public.deployment_environment()') is null or to_regclass('public.deployment_settings') is null then
    raise exception 'REFUSED: this is not the Goldia demo database (no deployment_environment / deployment_settings)';
  end if;
  execute 'select public.deployment_environment()' into v_env;
  execute 'select count(*) from public.deployment_settings where environment = ''demo''' into v_set;
  if v_env is distinct from 'demo' or v_set = 0 then
    raise exception 'REFUSED: this is not the Goldia demo database (deployment_environment() = %)', coalesce(v_env, 'null');
  end if;
  if to_regclass('public.weight_sale_allocations') is null or to_regprocedure('public.rpc_get_unified_customer_ledger(uuid,uuid)') is null then
    raise exception 'REFUSED: Goldia 068/069 schema not found — this bundle expects a 069-level demo';
  end if;
  raise notice 'demo guard passed';
end
$guard$;
""")
for m in MIG:
    PARTS.append(f"\n-- ===================================================== Goldia {m}\n" + open(REPO + 'supabase/migrations/' + m).read())
# parity: drop Goldia-named overloads not in 073
sigs = ','.join(q(f['sig']) for f in funcs)
PARTS.append(f"""
-- ===================================================== parity: remove Goldia-named overloads that 073 does not have
do $parity$
declare r record;
begin
  for r in select p.oid::regprocedure::text sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and p.proname = any (array[{','.join(q(n) for n in goldia_names)}]::text[])
              and not (p.oid::regprocedure::text = any (array[{sigs}]::text[]))
              and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    raise notice 'dropping overload not present in 073: %', r.sig;
    execute 'drop function ' || r.sig;
  end loop;
end
$parity$;
""")
for f in funcs:
    PARTS.append(f"\n-- parity: {f['sig']}\n" + f['def'].rstrip() + ';\n' +
                 f"revoke all on function {f['sig']} from public, anon, authenticated, service_role;\n" +
                 ''.join(f"grant execute on function {f['sig']} to {g.lower() if g == 'PUBLIC' else g};\n" for g in f['acl'].split(',') if g))
# policies
PARTS.append(f"""
-- ===================================================== parity: policies on Goldia tables
do $pol$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public' and tablename = any (array[{','.join(q(t) for t in goldia_tables)}]::text[])
              and (tablename, policyname) not in (select * from (values {','.join(f"({q(p['t'])},{q(p['n'])})" for p in pols)}) v(t, n))
  loop
    raise notice 'dropping policy not present in 073: %.%', r.tablename, r.policyname;
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$pol$;
""")
for p in pols:
    roles = p['roles'].strip('{}').split(',')
    rl = ', '.join('public' if r == 'public' else '"' + r.strip('"') + '"' for r in roles)
    s = f"drop policy if exists \"{p['n']}\" on public.\"{p['t']}\";\ncreate policy \"{p['n']}\" on public.\"{p['t']}\" as {p['perm']} for {p['cmd']} to {rl}"
    if p['using']: s += f" using ({p['using']})"
    if p['check']: s += f" with check ({p['check']})"
    PARTS.append(s + ';\n')
for t in rls:
    PARTS.append(f"alter table public.\"{t}\" enable row level security;\n")
PARTS.append("""
-- ===================================================== in-transaction parity verification (aborts on any difference)
do $verify$
declare v_n integer; v_list text;
begin
""" + build_verify().replace("\n-- =====================================================", "\n  -- =====================================================") + """
  select count(*), string_agg(d, E'\n' order by d) into v_n, v_list from diff;
  if v_n > 0 then
    raise exception 'PARITY FAILED (% differences) — nothing was changed:%', v_n, E'\n' || v_list;
  end if;
  raise notice 'PARITY OK: demo now matches the Goldia 073 schema (% functions, % policies, % tables)', {NF}, {NP}, {NT};
end
$verify$;

notify pgrst, 'reload schema';
commit;
""".replace('{NF}', str(len(funcs))).replace('{NP}', str(len(pols))).replace('{NT}', str(len(goldia_tables))))
open(OUT + '01_demo_upgrade_to_073.sql', 'w').write(''.join(PARTS))
post = """-- GOLDIA SALES — DEMO parity postflight (READ ONLY). Expected: one row 'PASS | 0 |'.
begin transaction read only;
""" + build_verify() + """select case when count(*) = 0 then 'PASS' else 'FAIL' end as parity, count(*) as differences, string_agg(d, E'\n' order by d) as details from diff;
rollback;
"""
open(OUT + '02_demo_parity_postflight_readonly.sql', 'w').write(post)
print('ok', len(funcs), len(pols), len(goldia_tables))
