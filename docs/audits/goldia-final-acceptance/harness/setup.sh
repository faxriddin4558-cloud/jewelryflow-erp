#!/usr/bin/env bash
# Isolated disposable PG16 cluster with Supabase-like roles + default privileges. Unix socket only.
set -euo pipefail
PG_BIN=/usr/lib/postgresql/16/bin
W=/opt/goldia-audit/pg
REPO=/home/user/jewelryflow-erp
runuser -u postgres -- $PG_BIN/pg_ctl -D $W/data -m immediate stop >/dev/null 2>&1 || true
rm -rf $W; mkdir -p $W; chown postgres $W
runuser -u postgres -- $PG_BIN/initdb -D $W/data -U postgres -A trust >/dev/null
# listen only on unix socket + 127.0.0.1:55432 (for PostgREST)
runuser -u postgres -- $PG_BIN/pg_ctl -D $W/data -o "-p 55432 -k $W -c listen_addresses=127.0.0.1 -c max_connections=200" -l $W/pg.log -w start >/dev/null
P="$PG_BIN/psql -h $W -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$P <<'SQL'
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'local-only';
grant anon, authenticated, service_role to authenticator;
create extension if not exists pgcrypto;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
  encrypted_password text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now());
-- PostgREST sets request.jwt.claims (json); older code reads request.jwt.claim.sub. Support both.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role') $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'role', current_setting('request.jwt.claim.role', true))) $$;
create schema storage;
create table storage.buckets (id text primary key, name text, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
-- Supabase hosted defaults: public schema objects are granted to anon/authenticated/service_role
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL
n=0
for f in $REPO/supabase/migrations/*.sql; do
  if [ -n "${MAX_MIGRATION:-}" ] && [[ "$(basename $f)" > "$MAX_MIGRATION" ]]; then continue; fi
  if ! out=$($P -f "$f" 2>&1 >/dev/null); then echo "FAILED: $(basename $f)"; echo "$out" | grep -v NOTICE | head; exit 1; fi
  n=$((n+1))
done
echo "applied $n migrations"
