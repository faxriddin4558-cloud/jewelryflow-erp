#!/usr/bin/env bash
# Business-date boundary check for migration 073 on a throwaway local PostgreSQL whose clock is driven by
# libfaketime (never remote). At each instant the director sets the 585 rate, seller A sells one barcode piece and
# records a cash payment; rate_date / sale_date / settlement_date must equal the Asia/Tashkent calendar date.
# Expected after 073: all PASS. Before 073 the 00:00-04:59 Tashkent instants land on the previous day.
#
# Usage: scripts/verify-073-business-date-local.sh [pg_bin_dir]     (needs: apt-get install faketime)
set -euo pipefail
PG_BIN="${1:-/usr/lib/postgresql/16/bin}"
LIBFT=$(ls /usr/lib/*/faketime/libfaketimeMT.so.1 2>/dev/null | head -1 || true)
[ -n "$LIBFT" ] || { echo "SKIP: libfaketime not installed (apt-get install faketime)"; exit 0; }
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PGPORT_LOCAL:-54334}"
WORK="$(mktemp -d)"; RUN_AS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUN_AS=(runuser -u postgres --); fi
cleanup() { "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
echo "2026-11-20 06:00:00" > "$WORK/clock"; chmod 666 "$WORK/clock"
"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" env TZ=UTC LD_PRELOAD="$LIBFT" FAKETIME_TIMESTAMP_FILE="$WORK/clock" FAKETIME_NO_CACHE=1 \
  "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses='' -c timezone=UTC" -l "$WORK/pg.log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -q -tA -v ON_ERROR_STOP=1)
sed -n '/^"\${PSQL\[@\]}" <<.SQL./,/^SQL$/p' "$REPO_DIR/scripts/validate-migrations-local-postgres.sh" | sed '1d;$d' | "${PSQL[@]}"
for f in "$REPO_DIR"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null 2>&1 || { echo "migration failed: $(basename "$f")"; exit 1; }; done

"${PSQL[@]}" >/dev/null <<'SQL'
insert into public.organizations (id, code, name, status) values ('00000000-0000-0000-0000-00000000d073','d073','D073','ACTIVE');
insert into auth.users (id, email) values ('11111111-1111-1111-1111-11111111d073','dir@d073.uz'),('22222222-2222-2222-2222-22222222d073','mgr@d073.uz'),('33333333-3333-3333-3333-33333333d073','sel@d073.uz');
insert into public.employees (id, organization_id, user_id, name, full_name, role, is_active) values
 ('11111111-1111-1111-1111-11111111d073','00000000-0000-0000-0000-00000000d073','11111111-1111-1111-1111-11111111d073','Dir','Dir','director',true),
 ('22222222-2222-2222-2222-22222222d073','00000000-0000-0000-0000-00000000d073','22222222-2222-2222-2222-22222222d073','Mgr','Mgr','production_manager',true),
 ('33333333-3333-3333-3333-33333333d073','00000000-0000-0000-0000-00000000d073','33333333-3333-3333-3333-33333333d073','Sel','Sel','sales',true);
insert into public.customers (id, organization_id, customer_code, contact_name, seller_id) values
 ('bbbbbbbb-0000-0000-0000-00000000d073','00000000-0000-0000-0000-00000000d073','D073','Mijoz','33333333-3333-3333-3333-33333333d073');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-11111111d073',false);
select public.rpc_set_daily_gold_rate(p_rate_per_gram := 900000);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-22222222d073',false);
select public.rpc_issue_barcode_consignment(p_seller_id := '33333333-3333-3333-3333-33333333d073', p_factory_markup_pct := 8, p_seller_markup_pct := 12,
  p_factory_receipt_id := ((public.rpc_record_factory_receipt(p_product_name := 'd', p_original_physical_g := 20, p_factory_markup_pct := 8))->>'receipt_id')::uuid,
  p_pieces := (select jsonb_agg(jsonb_build_object('weight_grams', 1)) from generate_series(1, 12)));
SQL

fail=0
check() { # $1 label, $2 UTC instant, $3 expected Tashkent date
  echo "$2" > "$WORK/clock"
  local out
  out=$("${PSQL[@]}" <<SQL
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-11111111d073',false) \gset
select public.rpc_set_daily_gold_rate(p_rate_per_gram := 900000 + (random() * 1000)::int)->>'rate_date' as rate \gset
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-33333333d073',false) \gset
select public.rpc_record_barcode_piece_sale(p_customer_id := 'bbbbbbbb-0000-0000-0000-00000000d073', p_client_markup_pct := 10,
  p_piece_id := (select id from public.consignment_pieces where status = 'held_by_seller' order by id limit 1))->>'sale_id' as sale \gset
select public.rpc_record_client_settlement(p_customer_id := 'bbbbbbbb-0000-0000-0000-00000000d073', p_cash_amount := 100000)->>'settlement_id' as st \gset
select :'rate' || ' ' || (select sale_date from public.jewelry_sales where id = :'sale') || ' ' || (select settlement_date from public.gold_settlements where id = :'st');
SQL
)
  if [ "$out" = "$3 $3 $3" ]; then echo "PASS $1 ($2 UTC) -> $3"; else echo "FAIL $1 ($2 UTC) expected $3, got rate/sale/payment: $out"; fail=1; fi
}
check "23:59 Tashkent"       "2026-11-25 18:59:00" 2026-11-25
check "00:00 Tashkent"       "2026-11-25 19:00:00" 2026-11-26
check "00:01 Tashkent"       "2026-11-25 19:01:00" 2026-11-26
check "04:59 Tashkent"       "2026-11-25 23:59:00" 2026-11-26
check "05:00 Tashkent"       "2026-11-26 00:00:00" 2026-11-26
check "month end 23:59"      "2026-11-30 18:59:00" 2026-11-30
check "new month 00:00"      "2026-11-30 19:00:00" 2026-12-01
check "year end 23:59"       "2026-12-31 18:59:00" 2026-12-31
check "new year 00:00"       "2026-12-31 19:00:00" 2027-01-01
check "new year 04:59"       "2026-12-31 23:59:00" 2027-01-01
check "new year 05:00"       "2027-01-01 00:00:00" 2027-01-01
[ "$fail" = 0 ] && echo "PASS: business date is the Asia/Tashkent calendar date at every boundary" || { echo "FAIL: business date boundary"; exit 1; }
