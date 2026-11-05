#!/usr/bin/env bash
# Behavioural tests of run-readonly-checks.ps1 -Target production-post on a disposable LOCAL PostgreSQL 17 at 075
# (127.0.0.1:55437, e.g. MAX_MIGRATION=20260101000075_zzz.sql docs/releases/staging-075/harness/stack-db.sh + standin-seed.js).
# A synthetic pre-release baseline (history 072) is made from the current data; each test breaks one thing locally,
# expects PASS / REVIEW / FAIL, and restores it.
set -u
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
PWSH=${PWSH:-/opt/pwsh/pwsh}; PGBIN=${PGBIN:-/opt/goldia-audit/pg17root/wrap}; OUT=${OUT:-/tmp/goldia-post-tests}
export PATH=$PGBIN:$PATH DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
P="psql -h 127.0.0.1 -p 55437 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1"
# start at 075 (a previous rehearsal may have left 076 applied)
if [ "$($P -tAc "select max(version) from supabase_migrations.schema_migrations")" = "20260101000076" ]; then
  $P --single-transaction -f "$REPO/docs/releases/production-075/emergency/rollback_076_with_history.sql" >/dev/null; fi
rm -rf "$OUT"; mkdir -p "$OUT/runs/readonly-production-20261101-000000"
B="$OUT/runs/readonly-production-20261101-000000/01_baseline.txt"
psql -h 127.0.0.1 -p 55437 -U postgres -d postgres -X -A -t -F ' | ' -f "$REPO/docs/releases/production-075/01_baseline_readonly.sql" | grep '^BASELINE' \
  | sed -E 's/^BASELINE \| history latest \| .*/BASELINE | history latest | 20260101000072/; s/^BASELINE \| history count \| .*/BASELINE | history count | 72/' > "$B"
cp "$B" "$OUT/b.orig"
run() { "$PWSH" -NoProfile -NonInteractive -File "$REPO/docs/releases/production-075/run-readonly-checks.ps1" -Target production-post -LocalRehearsal -Port 55437 -PgBin "$PGBIN" -OutRoot "$OUT/runs" "$@" > "$OUT/last.log" 2>&1; echo $?; }
pass=0; fail=0
t() { local res; res=$(grep -a "RESULT:" "$OUT/last.log" | tail -1 | cut -c1-170); if [ "$2" == "$3" ] && grep -qE "$4" "$OUT/last.log"; then pass=$((pass+1)); echo "ok   $1 exit=$3 | $res"; else fail=$((fail+1)); echo "BAD  $1 exit=$3 (expected $2, /$4/) | $res"; fi; }
c=$(run); t T1_identical_business_PASS 0 $c 'business lines IDENTICAL'
sed -i -E 's/^(BASELINE \| total client_debt_g \| )([0-9.]+)/\1999999.0000/' "$B"; c=$(run); t T2_business_total_differs_REVIEW 2 $c 'BUSINESS total client_debt_g'
cp "$OUT/b.orig" "$B"; sed -i -E 's/^(BASELINE \| rows sales_login_audit_logs \| )([0-9]+)/\1123456/' "$B"; c=$(run); t T3_only_login_audit_rows_differ_PASS 0 $c 'non-business rows sales_login_audit_logs'
cp "$OUT/b.orig" "$B"; sed -i -E 's/^BASELINE \| history latest \| .*/BASELINE | history latest | 20260101000075/' "$B"; c=$(run); t T4_no_earlier_baseline_REVIEW 2 $c 'NOT compared'
cp "$OUT/b.orig" "$B"; c=$(run -BaselineBefore "$OUT/nope.txt"); t T5_missing_BaselineBefore_FAIL 1 $c 'file not found'
$P -c "create policy zz_leak on public.customers for select to authenticated using (true)"; c=$(run); t T6_rls_leak_FAIL 1 $c 'LEAK\|read\|customers'; $P -c "drop policy zz_leak on public.customers"
$P -c "alter table public.customers disable trigger trg_goldia_guard_customer_code"; c=$(run); t T7_postflight_false_column_FAIL 1 $c 'false: code_guard_trigger'; $P -c "alter table public.customers enable trigger trg_goldia_guard_customer_code"
$P -c "alter table public.jewelry_models disable row level security"; c=$(run); t T8_table_without_rls_FAIL 1 $c 'false: rls_enabled'; $P -c "alter table public.jewelry_models enable row level security"
$P -c "update supabase_migrations.schema_migrations set version='20260101000099' where version='20260101000075'"; c=$(run); t T9_history_not_075_FAIL 1 $c 'expects migration history at 075, 076 or 077'; $P -c "update supabase_migrations.schema_migrations set version='20260101000075' where version='20260101000099'"
c=$(run); t T10_restored_PASS 0 $c 'RESULT: PASS'
# after 076: the 075 baseline is the "before" file, the 076 postflight runs as well
B75="$OUT/runs/readonly-production-post-20261103-000000/01_baseline.txt"; mkdir -p "$(dirname "$B75")"
psql -h 127.0.0.1 -p 55437 -U postgres -d postgres -X -A -t -F ' | ' -f "$REPO/docs/releases/production-075/01_baseline_readonly.sql" | grep '^BASELINE' > "$B75"
touch -d '2026-11-03 00:00' "$B75"
$P --single-transaction -f "$REPO/supabase/migrations/20260101000076_goldia_legacy_debt_manager_and_seller.sql" >/dev/null 2>&1
$P -c "insert into supabase_migrations.schema_migrations(version, name) values ('20260101000076', 'goldia_legacy_debt_manager_and_seller')"
c=$(run); t T11_after_076_PASS_with_076_postflight 0 $c '076_postflight: PASS'
BF=$(grep -a "pre-release baseline:" "$OUT/last.log" | sed 's/.*pre-release baseline: //' | tr -d '\r')
grep -q "^BASELINE | history latest | 20260101000075" "$BF" && echo "ok   T12 the newest 075 baseline was the before file ($BF)" && pass=$((pass+1)) || { echo "BAD  T12 before file is not a 075 baseline: $BF"; fail=$((fail+1)); }
$P --single-transaction -f "$REPO/docs/releases/production-075/emergency/rollback_076_with_history.sql" >/dev/null
echo "TOTAL ok=$pass bad=$fail"
