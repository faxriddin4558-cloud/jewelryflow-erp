#!/usr/bin/env bash
# Proves that a production backup file is actually restorable, without touching production.
# Restores a pg_dump custom-format file (-Fc) into a throwaway local PostgreSQL cluster and
# prints row counts for the Goldia ledger tables, to compare with the counts printed by
# supabase/release/065_preflight_readonly.sql (section G6).
#
# Create the dump (direct connection string from Supabase: Settings -> Database):
#   pg_dump "$PROD_DB_URL" -Fc --no-owner --no-acl -f goldia-prod-YYYYMMDD.dump
# Then:
#   scripts/verify-backup-restore-local.sh goldia-prod-YYYYMMDD.dump [pg_bin_dir]
#
# The pg_bin_dir major version must be >= the production server major version.
set -euo pipefail

DUMP="${1:?usage: $0 <dump-file> [pg_bin_dir]}"
PG_BIN="${2:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_LOCAL:-54332}"
WORK="$(mktemp -d)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$WORK"
  cp "$DUMP" "$WORK/backup.dump" && chown postgres "$WORK/backup.dump"
  DUMP="$WORK/backup.dump"
  RUN_AS=(runuser -u postgres --)
fi
cleanup() {
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -q -tA)

"${PSQL[@]}" -c "create role anon nologin; create role authenticated nologin; create role service_role nologin;" >/dev/null

# Supabase-only extensions/roles may fail to restore locally; business tables must not.
"${RUN_AS[@]}" "$PG_BIN/pg_restore" -h "$WORK" -p "$PORT" -U postgres -d postgres \
  --no-owner --no-acl "$DUMP" > "$WORK/restore.log" 2>&1 || true
echo "restore warnings/errors (Supabase platform objects are expected here): $(grep -c 'error:' "$WORK/restore.log" || true)"

echo "--- row counts (compare with preflight G6) ---"
for t in factory_receipts seller_consignments consignment_pieces jewelry_sales gold_settlements \
         client_gold_accounts seller_gold_accounts audit_logs; do
  printf '%-22s %s\n' "$t" "$("${PSQL[@]}" -c "select count(*) from public.$t" 2>/dev/null || echo MISSING)"
done
echo "--- latest migration in backup ---"
"${PSQL[@]}" -c "select max(version) from supabase_migrations.schema_migrations" 2>/dev/null || echo "schema_migrations MISSING"
echo "--- public functions restored ---"
"${PSQL[@]}" -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace"
