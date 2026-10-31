#!/usr/bin/env bash
# Applies every migration in supabase/migrations to a throwaway local PostgreSQL
# cluster (never a remote database) and fails on the first SQL error.
#
# Usage: scripts/validate-migrations-local-postgres.sh [pg_bin_dir]
# The cluster lives in a temp dir and is destroyed on exit.
set -euo pipefail

PG_BIN="${1:-/usr/lib/postgresql/16/bin}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PGPORT_LOCAL:-54329}"
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

PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

# Minimal Supabase platform stubs (roles, auth, storage) so migrations compile.
"${PSQL[@]}" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true)) $$;
create schema storage;
create table storage.buckets (id text primary key, name text, owner uuid, public boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
grant usage on schema auth to anon, authenticated, service_role;
SQL

count=0
for f in "$REPO_DIR"/supabase/migrations/*.sql; do
  if ! out=$("${PSQL[@]}" -f "$f" 2>&1 >/dev/null); then
    echo "FAILED: $(basename "$f")"
    echo "$out" | grep -v '^psql:.*NOTICE' | head -20
    exit 1
  fi
  count=$((count + 1))
done

echo "OK: $count migrations applied cleanly on PostgreSQL $("${PSQL[@]}" -tAc 'show server_version')"
"${PSQL[@]}" -tAc "select 'functions=' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'"
