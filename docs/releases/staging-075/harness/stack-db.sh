#!/usr/bin/env bash
# Disposable LOCAL "Supabase-like" stack for the 075 work: PostgreSQL 17 + real GoTrue (Supabase Auth) in Docker.
# Never points at staging/production. Usage: MAX_MIGRATION=20260101000074_zzz.sql ./stack-db.sh
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
PORT=${PGPORT_LOCAL:-55437}
JWT_SECRET=${LOCAL_JWT_SECRET:-local-only-jwt-secret-goldia-075-at-least-32-chars}
docker rm -f g75-pg g75-auth >/dev/null 2>&1 || true
docker run -d --name g75-pg --network host -e POSTGRES_HOST_AUTH_METHOD=trust mirror.gcr.io/library/postgres:17 \
  -c port=$PORT -c listen_addresses=127.0.0.1 -c max_connections=300 >/dev/null
P="psql -h 127.0.0.1 -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
for i in $(seq 1 60); do $P -c 'select 1' >/dev/null 2>&1 && break; sleep 1; done
$P <<'SQL'
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'local-only';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole password 'local-only';
create role supabase_admin nologin;
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create schema auth authorization supabase_auth_admin;
grant create on database postgres to supabase_auth_admin;
create schema storage;
create table storage.buckets (id text primary key, name text, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL
docker run -d --name g75-auth --network host \
  -e GOTRUE_API_HOST=127.0.0.1 -e PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:local-only@127.0.0.1:$PORT/postgres?search_path=auth&sslmode=disable" \
  -e GOTRUE_SITE_URL=http://127.0.0.1:3300 -e GOTRUE_JWT_SECRET="$JWT_SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_DISABLE_SIGNUP=true \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_LOG_LEVEL=warn \
  supabase/gotrue:v2.177.0 >/dev/null
for i in $(seq 1 90); do curl -sf http://127.0.0.1:9999/health >/dev/null 2>&1 && break; sleep 1; done
curl -sf http://127.0.0.1:9999/health >/dev/null || { docker logs g75-auth | tail -20; exit 1; }
$P <<'SQL'
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
SQL
n=0
for f in $REPO/supabase/migrations/*.sql; do
  if [ -n "${MAX_MIGRATION:-}" ] && [[ "$(basename $f)" > "$MAX_MIGRATION" ]]; then continue; fi
  if ! out=$($P -f "$f" 2>&1 >/dev/null); then echo "FAILED: $(basename $f)"; echo "$out" | grep -v NOTICE | head; exit 1; fi
  n=$((n+1))
done
$P -c "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text)"
for f in $REPO/supabase/migrations/*.sql; do
  if [ -n "${MAX_MIGRATION:-}" ] && [[ "$(basename $f)" > "$MAX_MIGRATION" ]]; then continue; fi
  b=$(basename $f .sql); $P -c "insert into supabase_migrations.schema_migrations(version,name) values ('${b%%_*}','${b#*_}')"
done
echo "PG17 + GoTrue up; applied $n migrations; latest $($P -tAc 'select max(version) from supabase_migrations.schema_migrations')"
