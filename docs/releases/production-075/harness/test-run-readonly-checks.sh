#!/usr/bin/env bash
# Behavioural tests of run-readonly-checks.ps1 on a disposable LOCAL PostgreSQL 17 (127.0.0.1:55437) with pwsh.
# Expected: PASS only on a clean 072 copy; every error / STOP / guard case FAIL; WARN -> REVIEW.
set -u
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
PWSH=${PWSH:-/opt/pwsh/pwsh}
PGBIN=${PGBIN:-/opt/goldia-audit/pg17root/wrap}
OUT=${OUT:-/tmp/goldia-ro-tests}
P="psql -h 127.0.0.1 -p 55437 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1"
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
mkdir -p "$OUT"
pass=0; fail=0
run() { # name expected_exit expected_reason_regex args...
  local name=$1 exp=$2 why=$3; shift 3
  local log="$OUT/$name.log"
  "$PWSH" -NoProfile -NonInteractive -File "$REPO/docs/releases/production-075/run-readonly-checks.ps1" "$@" -PgBin "$PGBIN" -OutRoot "$OUT/runs" > "$log" 2>&1
  local code=$?
  local res; res=$(grep -a "RESULT:" "$log" | tail -1)
  if [ "$code" = "$exp" ] && echo "$res" | grep -qE "$why"; then pass=$((pass+1)); echo "ok   $name exit=$code | $res"; else fail=$((fail+1)); echo "BAD  $name exit=$code (expected $exp, reason /$why/) | $res"; tail -5 "$log"; fi
}
latest=$($P -tAc "select max(version) from supabase_migrations.schema_migrations")
echo "local db at $latest"
# bring the copy to exactly 072 (emergency rollbacks are guarded and remove history rows)
for v in 075 074 073; do
  if [[ "$latest" > "20260101000${v}" || "$latest" == "20260101000${v}" ]]; then $P --single-transaction -f "$REPO/docs/releases/production-075/emergency/rollback_${v}_with_history.sql" >/dev/null 2>&1; latest=$($P -tAc "select max(version) from supabase_migrations.schema_migrations"); fi
done
echo "local db now at $latest"
run T01_production_072_PASS 0 'RESULT: PASS' -Target production -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437
# T02 WARN -> REVIEW: an idle-in-transaction session from another client
( $P -c "begin; select 1;" -c "select pg_sleep(25);" >/dev/null 2>&1 & )
( psql -h 127.0.0.1 -p 55437 -U postgres -d postgres -X -q <<'SQL' >/dev/null 2>&1 &
begin; select 1;
\! sleep 25
commit;
SQL
)
sleep 3
run T02_idle_in_transaction_REVIEW 2 'REVIEW.*WARN' -Target production -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437
sleep 23
# T03 STOP -> FAIL: 073 already recorded
$P -c "insert into supabase_migrations.schema_migrations(version) values ('20260101000073')"
run T03_history_after_072_FAIL 1 '00_preflight.*STOP' -Target production -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437
$P -c "delete from supabase_migrations.schema_migrations where version = '20260101000073'"
# T04 connection failure -> FAIL
run T04_connection_refused_FAIL 1 'connection/identity probe failed' -Target production -LocalRehearsal -Port 59999
# T05 SQL error -> FAIL (history table temporarily unreachable)
$P -c "alter schema supabase_migrations rename to supabase_migrations_off"
run T05_sql_error_FAIL 1 'identity probe failed.*(ERROR|schema_migrations)' -Target production -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437
$P -c "alter schema supabase_migrations_off rename to supabase_migrations"
# T06/T07/T08 guards -> FAIL before any connection
run T06_guard_staging_ref_in_host_FAIL 1 'another project' -Target production -PoolerHost db.vouehtlmsunebracahon.supabase.co
run T07_guard_jfs_ref_FAIL 1 'another project' -Target staging -PoolerHost db.yvvbdoqncubtwlzskgml.supabase.co
run T08_guard_local_with_remote_host_FAIL 1 'only accepts 127.0.0.1' -Target production -LocalRehearsal -PoolerHost aws-0-ap-southeast-1.pooler.supabase.com
run T09_guard_unexpected_host_FAIL 1 'unexpected host' -Target production -PoolerHost evil.example.com
# T10 a real function-body difference at 072 -> FAIL
$P -c "create or replace function public.rpc_get_factory_settings(p_organization_id uuid default null) returns jsonb language plpgsql security definer set search_path = public, pg_temp as \$\$ begin return '{}'::jsonb; end; \$\$"
run T10_function_body_different_FAIL 1 '00_preflight.*STOP' -Target production -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437
awk 'tolower($0) ~ /^create or replace function public.rpc_get_factory_settings\(/{p=1} p{print} p&&/^\$\$;/{exit}' "$REPO/supabase/migrations/20260101000023_factory_settings_persistence_and_qc_rework.sql" | $P
run T11_production_072_PASS_again 0 'RESULT: PASS' -Target production -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437
# --- explicit read-only transaction (pooler simulation: PGOPTIONS not sent) ---
run T14_pooler_without_options_PASS 0 'RESULT: PASS' -Target production -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437
grep -q "transaction_read_only=on (explicit BEGIN TRANSACTION READ ONLY)" "$OUT/T14_pooler_without_options_PASS.log" && grep -q "session_default_read_only=off" "$OUT/T14_pooler_without_options_PASS.log" && { pass=$((pass+1)); echo "ok   T14b session default off, explicit transaction on"; } || { fail=$((fail+1)); echo "BAD  T14b identity line"; }
before=$($P -tAc "select count(*) from public.organizations")
printf "insert into public.organizations(id, code, name, status) values (gen_random_uuid(), 'ro-test', 'ro-test', 'ACTIVE');\n" > "$OUT/write-attempt.sql"
run T15_write_attempt_FAIL 1 'extra_check.*read-only transaction' -Target production -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437 -ExtraCheckFile "$OUT/write-attempt.sql"
printf "select 1;\nend;\ninsert into public.organizations(id, code, name, status) values (gen_random_uuid(), 'escape', 'escape', 'ACTIVE');\n" > "$OUT/escape-attempt.sql"
run T16_transaction_escape_refused_FAIL 1 'transaction control' -Target production -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437 -ExtraCheckFile "$OUT/escape-attempt.sql"
after=$($P -tAc "select count(*) from public.organizations")
[ "$before" = "$after" ] && { pass=$((pass+1)); echo "ok   T17 database unchanged by T15/T16 (organizations $before -> $after)"; } || { fail=$((fail+1)); echo "BAD  T17 organizations $before -> $after"; }
run T18_test_switch_without_local_FAIL 1 'require -LocalRehearsal' -Target production -SimulatePoolerWithoutOptions
# staging parity on a 075 schema: identical -> PASS, changed body -> FAIL
for v in 073 074 075; do $P --single-transaction -f "$REPO"/supabase/migrations/20260101000${v}_*.sql >/dev/null 2>&1; $P -c "insert into supabase_migrations.schema_migrations(version) values ('20260101000${v}')"; done
run T12_staging_parity_075_PASS 0 'RESULT: PASS' -Target staging -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437
$P -c "create or replace function public._goldia_business_date(p_at timestamptz default now()) returns date language sql stable set search_path = pg_catalog, pg_temp as \$\$ select (p_at at time zone 'UTC')::date \$\$"
run T13_staging_parity_DIFFERENT_FAIL 1 'parity.*DIFFERENT=1' -Target staging -LocalRehearsal -SimulatePoolerWithoutOptions -Port 55437
awk 'tolower($0) ~ /^create or replace function public._goldia_business_date\(/{p=1} p{print} p&&/\$\$;/{exit}' "$REPO/supabase/migrations/20260101000073_goldia_release_candidate_stabilization.sql" | $P

echo "TOTAL ok=$pass bad=$fail"
[ "$fail" = 0 ]
