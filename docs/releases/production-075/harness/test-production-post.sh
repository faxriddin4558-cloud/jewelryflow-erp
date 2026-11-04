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
cp "$OUT/b.orig" "$B"; sed -i -E 's/^BASELINE \| history latest \| .*/BASELINE | history latest | 20260101000071/' "$B"; c=$(run); t T4_no_072_baseline_REVIEW 2 $c 'NOT compared'
cp "$OUT/b.orig" "$B"; c=$(run -BaselineBefore "$OUT/nope.txt"); t T5_missing_BaselineBefore_FAIL 1 $c 'file not found'
$P -c "create policy zz_leak on public.customers for select to authenticated using (true)"; c=$(run); t T6_rls_leak_FAIL 1 $c 'LEAK\|read\|customers'; $P -c "drop policy zz_leak on public.customers"
$P -c "alter table public.customers disable trigger trg_goldia_guard_customer_code"; c=$(run); t T7_postflight_false_column_FAIL 1 $c 'false: code_guard_trigger'; $P -c "alter table public.customers enable trigger trg_goldia_guard_customer_code"
$P -c "alter table public.jewelry_models disable row level security"; c=$(run); t T8_table_without_rls_FAIL 1 $c 'false: rls_enabled'; $P -c "alter table public.jewelry_models enable row level security"
$P -c "update supabase_migrations.schema_migrations set version='20260101000099' where version='20260101000075'"; c=$(run); t T9_history_not_075_FAIL 1 $c 'expects migration history at 20260101000075'; $P -c "update supabase_migrations.schema_migrations set version='20260101000075' where version='20260101000099'"
c=$(run); t T10_restored_PASS 0 $c 'RESULT: PASS'
echo "TOTAL ok=$pass bad=$fail"
