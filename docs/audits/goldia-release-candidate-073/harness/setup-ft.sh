#!/usr/bin/env bash
# Disposable PG16 cluster whose clock is controlled by libfaketime through a timestamp file. $1 = max migration (optional)
set -euo pipefail
PG_BIN=/usr/lib/postgresql/16/bin; W=/opt/goldia-audit/pgft; REPO=/home/user/jewelryflow-erp
runuser -u postgres -- $PG_BIN/pg_ctl -D $W/data -m immediate stop >/dev/null 2>&1 || true
rm -rf $W; mkdir -p $W; chown postgres $W
echo "@2026-11-02 12:00:00" > $W/clock; chmod 666 $W/clock
runuser -u postgres -- $PG_BIN/initdb -D $W/data -U postgres -A trust >/dev/null
runuser -u postgres -- env TZ=UTC LD_PRELOAD=/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1 FAKETIME_TIMESTAMP_FILE=$W/clock FAKETIME_NO_CACHE=1 \
  $PG_BIN/pg_ctl -D $W/data -o "-p 55433 -k $W -c listen_addresses='' -c timezone=UTC" -l $W/pg.log -w start >/dev/null
P="$PG_BIN/psql -h $W -p 55433 -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
sed -n '/^\$P <<.SQL.$/,/^SQL$/p' /opt/goldia-audit/setup.sh | sed '1d;$d' | $P
n=0; for f in $REPO/supabase/migrations/*.sql; do
  if [ -n "${1:-}" ] && [[ "$(basename $f)" > "$1" ]]; then continue; fi
  $P -f "$f" >/dev/null 2>&1 || { echo "FAILED $(basename $f)"; exit 1; }; n=$((n+1)); done
$P -f /opt/goldia-audit/seed.sql
echo "faketime cluster: $n migrations, now() = $($P -tAc 'select now()')"
