#!/usr/bin/env python3
"""Generates supabase/release/function_body_parity_<NNN>_readonly.sql from a FRESH local PostgreSQL 17 that has the
repository migrations 001..NNN applied from LF files (docs/releases/staging-075/harness/stack-db.sh). The function list
is the one of the 075 parity file (the Goldia Sales functions); hashes are md5(prosrc) of the fresh copy.
Usage: python3 gen-function-parity.py 076   (local stack on 127.0.0.1:55437 must be exactly at NNN)"""
import os, re, subprocess, sys
v = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__)); repo = os.path.abspath(os.path.join(here, '..', '..', '..'))
base = open(os.path.join(repo, 'supabase/release/function_body_parity_075_readonly.sql')).read()
sigs = re.findall(r"^  \('([^']+)', '[0-9a-f]{32}'\)", base, re.M)
env = {**os.environ, 'PATH': '/opt/goldia-audit/pg17root/wrap:' + os.environ['PATH']}
q = lambda sql: subprocess.run(['psql', '-h', '127.0.0.1', '-p', '55437', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-F', '|', '-c', sql], capture_output=True, text=True, env=env, check=True).stdout
latest = q("select max(version) from supabase_migrations.schema_migrations").strip()
assert latest == f'20260101000{v}', f'local stack is at {latest}, not {v}'
rows = dict(l.split('|') for l in q("select p.oid::regprocedure::text, md5(p.prosrc) from pg_proc p where p.pronamespace = 'public'::regnamespace").strip().splitlines())
missing = [s for s in sigs if s not in rows]
# functions a later migration dropped on purpose (076: the ambiguous rpc_reverse_financial_transaction(uuid,text,text))
DROPPED = {'rpc_reverse_financial_transaction(uuid,text,text)'}
assert set(missing) <= DROPPED, f'functions missing on the fresh copy: {sorted(set(missing) - DROPPED)}'
sigs = [s for s in sigs if s in rows]
if missing: print('dropped by a later migration (not checked):', ', '.join(missing))
vals = ',\n'.join(f"  ('{s}', '{rows[s]}')" for s in sigs)
out = re.sub(r"with expected\(sig, h\) as \(values\n.*?\n\), actual as", lambda m: f"with expected(sig, h) as (values\n{vals}\n), actual as", base, flags=re.S)
out = out.replace('(001..075)', f'(001..{v})')
open(os.path.join(repo, f'supabase/release/function_body_parity_{v}_readonly.sql'), 'w').write(out)
print(f'written function_body_parity_{v}_readonly.sql ({len(sigs)} functions)')
