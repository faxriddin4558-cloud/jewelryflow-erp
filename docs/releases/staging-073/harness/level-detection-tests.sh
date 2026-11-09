#!/bin/bash
# Level detection / version-gap tests of scripts/goldia-staging-release.js against the LOCAL stand-in (127.0.0.1:55437).
# No remote connection. Precondition: the stand-in is at 081 (e.g. after the 076 -> 081 rehearsal).
# Builds the REAL staging shape found read-only on 2026-11-09 (level 080, history rows 057 + 058 missing although their
# objects exist, function bodies with Windows CR) and checks that every wrong state STOPs and only the exact,
# verified repair passes.
cd "$(dirname "$0")/../../../.."
O=${O:-/opt/goldia-audit/level-tests}; mkdir -p $O; chown g76 $O
P="psql -X -h 127.0.0.1 -p 55437 -U postgres -At -v ON_ERROR_STOP=1"
RUN="runuser -u g76 -- env -u DATABASE_URL HOME=$O node scripts/goldia-staging-release.js --local-rehearsal --host 127.0.0.1 --port 55437 --pg-bin ${PG_BIN:-/opt/goldia-audit/pg17root/wrap} --out $O"
hist() { $P -c "select count(*) || ' rows, latest ' || max(version) from supabase_migrations.schema_migrations"; }
res() { grep -E '^(STOP|RESULT)' "$1" | tr '\n' ' '; }

echo "== setup: 081 -> 080 (emergency rollback), drop history rows 057 + 058, CR in 3 function bodies (like staging)"
$P -q --single-transaction -f docs/releases/production-075/emergency/rollback_081_with_history.sql >/dev/null
$P -c "delete from supabase_migrations.schema_migrations where version in ('20260101000057','20260101000058')" >/dev/null
$P -c "update pg_proc set prosrc = replace(prosrc, E'\n', E'\r\n') where pronamespace = 'public'::regnamespace and proname in ('rpc_get_period_report','rpc_record_client_legacy_debt','rpc_archive_customer')" >/dev/null
echo "   history: $(hist); bodies with CR: $($P -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and prosrc like '%'||chr(13)||'%'")"

echo "G1 gap, no flag                 : $($RUN > $O/g1.txt 2>&1; res $O/g1.txt) | history $(hist)"
grep -E 'gaps\)|STOP REASON' $O/g1.txt | sed 's/^/     /'
echo "G2 --repair-history 057 only    : $($RUN --repair-history 057 > $O/g2.txt 2>&1; res $O/g2.txt)"
echo "G3 --repair-history 057,058,059 : $($RUN --repair-history 057,058,059 > $O/g3.txt 2>&1; res $O/g3.txt)"
echo "G4 --repair-history abc         : $($RUN --repair-history abc > $O/g4.txt 2>&1; res $O/g4.txt)"

$P -c "insert into supabase_migrations.schema_migrations(version, name) values ('20251231000001', 'not_in_repo')" >/dev/null
echo "G5 unknown recorded version     : $($RUN --repair-history 057,058 > $O/g5.txt 2>&1; res $O/g5.txt)"
$P -c "delete from supabase_migrations.schema_migrations where version = '20251231000001'" >/dev/null

$P -c "alter table public.accounting_baselines drop column factory_advance_585_g" >/dev/null
echo "G6 058 object really missing    : $($RUN --repair-history 057,058 > $O/g6.txt 2>&1; res $O/g6.txt) | history $(hist)"
$P -c "alter table public.accounting_baselines add column factory_advance_585_g numeric(14,4) not null default 0" >/dev/null

DEF=$($P -c "select pg_get_functiondef('public.rpc_reverse_factory_receipt'::regproc)" 2>/dev/null)
if [ -n "$DEF" ]; then
  printf '%s\n' "$DEF" | sed 's/^CREATE OR REPLACE FUNCTION/create or replace function/' > $O/orig-fn.sql
  $P -c "update pg_proc set prosrc = replace(prosrc, 'begin', 'begin perform 1;') where oid = 'public.rpc_reverse_factory_receipt'::regproc" >/dev/null
  echo "G7 real code change in a body   : $($RUN --repair-history 057,058 > $O/g7.txt 2>&1; res $O/g7.txt)"
  $P -q -f $O/orig-fn.sql >/dev/null
fi

echo "G8 exact verified repair, dry   : $($RUN --repair-history 057,058 > $O/g8.txt 2>&1; res $O/g8.txt) | history $(hist)"
grep -E 'RELEASE PLAN|history repair|CR-tolerant' $O/g8.txt | sed 's/^/     /'
echo "G9 exact verified repair, apply : $($RUN --repair-history 057,058 --apply --yes > $O/g9.txt 2>&1; res $O/g9.txt) | history $(hist)"
grep -E 'history rows|history after|postflights' $O/g9.txt | sed 's/^/     /'
echo "G10 re-run after the release    : $($RUN > $O/g10.txt 2>&1; res $O/g10.txt)"
echo "G11 repair flag with no gap     : $($RUN --repair-history 057,058 > $O/g11.txt 2>&1; res $O/g11.txt)"
