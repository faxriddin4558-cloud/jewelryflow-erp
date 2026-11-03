#!/bin/bash
# Negative tests of scripts/goldia-staging-release.js against the LOCAL stand-in (port 55437). No remote connection.
cd "$(dirname "$0")/../../../.."
S=scripts/goldia-staging-release.js
P="psql -X -h /opt/goldia-audit/pg17 -p 55437 -U postgres -At"
O=/opt/goldia-audit/stg/neg; rm -rf $O; mkdir -p $O; chown postgres $O
RUN="runuser -u postgres -- env -u DATABASE_URL HOME=/opt/goldia-audit/stg node $S --local-rehearsal --host 127.0.0.1 --port 55437 --user postgres --pg-bin /opt/goldia-audit/pg17w --out $O"
R="env -u DATABASE_URL node $S"
echo "N1a production user/host        : $($R --user postgres.vrozlllcaxinavzxueif --host aws-0-ap-southeast-1.pooler.supabase.com 2>&1 | grep '^STOP')"
echo "N1b JFS demo host               : $($R --host db.yvvbdoqncubtwlzskgml.supabase.co 2>&1 | grep '^STOP')"
echo "N1c JFS demo in DATABASE_URL env: $(DATABASE_URL=postgresql://x@db.yvvbdoqncubtwlzskgml.supabase.co/postgres node $S --host h 2>&1 | grep '^STOP')"
echo "N1d any other user              : $($R --user postgres.someoneelse --host h 2>&1 | grep '^STOP')"
echo "N2  rehearsal on a remote host  : $($R --local-rehearsal --host aws-0-eu-central-1.pooler.supabase.com 2>&1 | grep '^STOP')"
/opt/goldia-audit/stg/reset-standin.sh
C=$($RUN 2>&1 | grep -o 'chain file: chain-063-073.sql' >/dev/null; ls -t $O/*/chain-063-073.sql | head -1)
python3 - "$C" $O/chain-broken.sql <<'PY'
import sys
s=open(sys.argv[1]).read(); i=s.index("-- ===== 20260101000073_")
open(sys.argv[2],'w').write(s[:i]+"select 1/0; -- injected failure before 073\n"+s[i:])
PY
SIG0=$($P -f supabase/release/staging-073/signature.sql | md5sum); H0=$($P -c "select count(*) from supabase_migrations.schema_migrations")
E=$($P -q -v ON_ERROR_STOP=1 --single-transaction -f $O/chain-broken.sql 2>&1 | grep -o 'ERROR:.*' | head -1)
SIG1=$($P -f supabase/release/staging-073/signature.sql | md5sum); H1=$($P -c "select count(*) from supabase_migrations.schema_migrations")
echo "N3  failure inside the chain    : $E; history $H0 -> $H1; schema unchanged: $([ "$SIG0" = "$SIG1" ] && echo yes || echo NO)"
( $P -c "begin; lock table public.jewelry_sales in access exclusive mode; select pg_sleep(30); commit;" >/dev/null 2>&1 & ); sleep 2
t0=$(date +%s); E=$($P -q -v ON_ERROR_STOP=1 --single-transaction -f $C 2>&1 | grep -o 'ERROR:.*' | head -1)
echo "N3b table locked by another user: $E after $(( $(date +%s)-t0 ))s; history: $($P -c "select count(*) from supabase_migrations.schema_migrations")"
sleep 30
/opt/goldia-audit/stg/reset-standin.sh; $P -c "drop function public.rpc_get_director_sales_overview" >/dev/null
echo "N4  staging lacks an RPC        : $($RUN --apply --yes 2>&1 | grep '^STOP') | history after: $($P -c "select max(version) from supabase_migrations.schema_migrations")"
/opt/goldia-audit/stg/reset-standin.sh; $P -c "create function public.deployment_environment() returns text language sql as \$\$ select 'demo' \$\$" >/dev/null
echo "N5  JFS demo marker             : $($RUN --apply --yes 2>&1 | grep '^STOP')"
/opt/goldia-audit/stg/reset-standin.sh; $P -c "delete from supabase_migrations.schema_migrations where version in ('20260101000030','20260101000031')" >/dev/null
echo "N6  2 versions not in history   : $($RUN 2>&1 | grep -E 'not recorded on staging|^RESULT' | tr '\n' ' ')"
/opt/goldia-audit/stg/reset-standin.sh
