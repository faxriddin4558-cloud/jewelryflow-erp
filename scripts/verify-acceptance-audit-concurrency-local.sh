#!/usr/bin/env bash
# Concurrency check for migration 070 (F3) on a throwaway local PostgreSQL (never remote).
# Three sessions pay 1,000,000 UZS at the same time for a customer that has no account row yet.
# Expected after 070: advance 3.0 g (before 070 the concurrent upserts overwrote each other -> 1.0 g).
#
# Usage: scripts/verify-acceptance-audit-concurrency-local.sh [pg_bin_dir]
set -euo pipefail

PG_BIN="${1:-/usr/lib/postgresql/16/bin}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PGPORT_LOCAL:-54332}"
WORK="$(mktemp -d)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$WORK"
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

# Same platform stubs as validate-migrations-local-postgres.sh
sed -n '/^"\${PSQL\[@\]}" <<.SQL./,/^SQL$/p' "$REPO_DIR/scripts/validate-migrations-local-postgres.sh" | sed '1d;$d' \
  | "${PSQL[@]}" -v ON_ERROR_STOP=1
for f in "$REPO_DIR"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "migration failed: $(basename "$f")"; exit 1; }
done

"${PSQL[@]}" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.organizations (id, code, name, status) values ('00000000-0000-0000-0000-00000000c070','c070','C070','ACTIVE');
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111110070','dir@c070.uz'),('22222222-2222-2222-2222-222222220070','sel@c070.uz');
insert into public.employees (id, organization_id, user_id, name, full_name, role, is_active) values
 ('11111111-1111-1111-1111-111111110070','00000000-0000-0000-0000-00000000c070','11111111-1111-1111-1111-111111110070','Dir','Dir','director',true),
 ('22222222-2222-2222-2222-222222220070','00000000-0000-0000-0000-00000000c070','22222222-2222-2222-2222-222222220070','Sel','Sel','sales',true);
insert into public.customers (id, organization_id, customer_code, contact_name, seller_id) values
 ('bbbbbbbb-0000-0000-0000-000000000070','00000000-0000-0000-0000-00000000c070','C070','Mijoz','22222222-2222-2222-2222-222222220070');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111110070',false);
select public.rpc_set_daily_gold_rate(p_rate_per_gram := 1000000);
SQL

PAY_SQL="$WORK/pay.sql"
cat > "$PAY_SQL" <<'SQL'
\set ON_ERROR_STOP 1
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222220070',false);
begin;
select 'pay ' || ((public.rpc_record_client_settlement(p_customer_id := 'bbbbbbbb-0000-0000-0000-000000000070', p_cash_amount := 1000000))->>'status');
select pg_sleep(1);
commit;
SQL
chmod 644 "$PAY_SQL"

for i in 1 2 3; do "${PSQL[@]}" -f "$PAY_SQL" > "$WORK/p$i.out" 2>&1 & done
wait


advance=$("${PSQL[@]}" -c "select advance_balance_grams::numeric(14,4) from public.client_gold_accounts where customer_id = 'bbbbbbbb-0000-0000-0000-000000000070'")
till=$("${PSQL[@]}" -c "select seller_till_cash_amount::numeric(18,2) from public.seller_gold_accounts where seller_id = '22222222-2222-2222-2222-222222220070'")
ok=$(cat "$WORK"/p*.out | grep -c '^pay ok' || true)
echo "payments ok: $ok, seller till: $till UZS, customer advance: $advance g (expected 3.0000)"
if [ "$ok" = "3" ] && [ "$advance" = "3.0000" ] && [ "$till" = "3000000.00" ]; then
  echo "PASS: concurrent first payments are all credited to the customer"
else
  echo "FAIL: concurrent payments lost customer credit"
  exit 1
fi
