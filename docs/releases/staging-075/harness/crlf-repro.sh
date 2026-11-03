#!/usr/bin/env bash
# Reproduces the "function bodies differ" parity report: repository 001..MAX applied on a disposable PostgreSQL 17,
# with migrations > CRLF_FROM converted to Windows line endings (as a Windows checkout with core.autocrlf would).
# Usage: PORT=55438 CRLF_FROM=20260101000062 MAX=20260101000075 crlf-repro.sh <out.txt>
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
P="psql -h 127.0.0.1 -p ${PORT:-55438} -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists repro" -c "create database repro" >/dev/null
P="psql -h 127.0.0.1 -p ${PORT:-55438} -U postgres -d repro -v ON_ERROR_STOP=1 -q"
$P -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls; create role authenticator login noinherit password 'local-only'; grant anon, authenticated, service_role to authenticator; end if; end \$\$" >/dev/null
grep -vE "^create role|^grant anon, authenticated, service_role to authenticator" "$(dirname "$0")/pg17-bootstrap.sql" | $P >/dev/null
TMP=$(mktemp -d)
for f in "$REPO"/supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -c1-14)
  [[ "$v" > "${MAX:-20260101000075}" ]] && continue
  if [[ -n "${CRLF_FROM:-}" && "$v" > "$CRLF_FROM" ]]; then sed 's/$/\r/' "$f" > "$TMP/m.sql"; else cp "$f" "$TMP/m.sql"; fi
  $P -f "$TMP/m.sql" >/dev/null 2>"$TMP/err" || { echo "FAILED $(basename "$f")"; head -5 "$TMP/err"; exit 1; }
done
sed -e 's/^\s*--.*$//' "$REPO/supabase/release/staging-073/signature.sql" | $P -tA | sort > "$1"
echo "signature written: $1 ($(wc -l < "$1") lines)"
