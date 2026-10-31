#!/usr/bin/env bash
# Concurrency check for rpc_record_weight_sale on a throwaway local PostgreSQL (never remote).
# Two sessions try to sell 7 g each from a seller holding 10 g. Expected: one sale succeeds,
# the other fails with ERR_INSUFFICIENT_SELLER_STOCK (total sold 7 g, never 14 g).
#
# Usage: scripts/verify-weight-sale-concurrency-local.sh [pg_bin_dir]
set -euo pipefail

PG_BIN="${1:-/usr/lib/postgresql/16/bin}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PGPORT_LOCAL:-54331}"
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
insert into public.organizations (id, code, name, status) values ('00000000-0000-0000-0000-00000000c0c0','conc','Conc','ACTIVE');
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','dir@c.uz'),('22222222-2222-2222-2222-222222222222','sel@c.uz');
insert into public.employees (id, organization_id, user_id, name, full_name, role, is_active) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c0c0','11111111-1111-1111-1111-111111111111','Dir','Dir','director',true),
 ('aaaaaaaa-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000c0c0','22222222-2222-2222-2222-222222222222','Sel','Sel','sales',true);
insert into public.customers (id, organization_id, customer_code, contact_name, phone, seller_id) values
 ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000c0c0','CC1','Mijoz','+998','aaaaaaaa-0000-0000-0000-000000000002');
insert into public.factory_receipts (organization_id, receipt_no, product_name, original_physical_g, available_physical_g, proba, factory_markup_pct, factory_obligation_g, status)
 values ('00000000-0000-0000-0000-00000000c0c0','ZVD-C','p',100,100,585,8,108,'in_manager_stock');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select (public.rpc_issue_barcode_consignment(p_seller_id := 'aaaaaaaa-0000-0000-0000-000000000002', p_factory_markup_pct := 8,
  p_pieces := '[{"weight_grams":10,"model_code":"C","purity":585}]'::jsonb, p_notes := 'c', p_seller_markup_pct := 12))->>'status' as issued;
SQL

SALE_SQL="$WORK/sale.sql"
cat > "$SALE_SQL" <<'SQL'
\set ON_ERROR_STOP 0
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
begin;
select 'sale ' || coalesce((public.rpc_record_weight_sale(p_customer_id := 'bbbbbbbb-0000-0000-0000-000000000001', p_weight_grams := 7, p_client_markup_pct := 10))->>'status','?') as result;
select pg_sleep(:hold);
commit;
SQL
chmod 644 "$SALE_SQL"

"${PSQL[@]}" -v hold=3 -f "$SALE_SQL" > "$WORK/s1.out" 2>&1 &
sleep 0.8
"${PSQL[@]}" -v hold=0 -f "$SALE_SQL" > "$WORK/s2.out" 2>&1 &
wait

sold=$("${PSQL[@]}" -c "select coalesce(sum(base_weight_grams), 0)::numeric(14,4) from public.jewelry_sales where status not in ('reversed', 'cancelled')")
ok_count=$(cat "$WORK/s1.out" "$WORK/s2.out" | grep -c '^sale ok' || true)
rejected=$(cat "$WORK/s1.out" "$WORK/s2.out" | grep -c 'ERR_INSUFFICIENT_SELLER_STOCK' || true)
echo "successful sales: $ok_count, rejected: $rejected, sold grams: $sold (stock 10 g)"
if [ "$ok_count" = "1" ] && [ "$rejected" = "1" ] && [ "$sold" = "7.0000" ]; then
  echo "PASS: no oversell under concurrency"
else
  echo "FAIL: concurrent weight sales oversold the seller stock"
  exit 1
fi
