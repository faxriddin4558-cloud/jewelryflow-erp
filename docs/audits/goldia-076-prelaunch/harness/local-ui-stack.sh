#!/usr/bin/env bash
# LOCAL full stack for UI tests of 076 (never staging / production): PG17 + GoTrue (stack-db.sh, already running),
# PostgREST 12.2.3 on 3010, Kong-like gateway on 54321, the real Next.js frontend built against the gateway on 3300.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
SECRET=${LOCAL_JWT_SECRET:-local-only-jwt-secret-goldia-075-at-least-32-chars}
docker rm -f g76-rest >/dev/null 2>&1 || true
docker run -d --name g76-rest --network host \
  -e PGRST_DB_URI="postgres://authenticator:local-only@127.0.0.1:55437/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" -e PGRST_SERVER_PORT=3010 -e PGRST_DB_POOL=20 \
  mirror.gcr.io/postgrest/postgrest:v12.2.3 >/dev/null
pkill -f "staging-075/harness/gateway.js" >/dev/null 2>&1 || true
(node "$REPO/docs/releases/staging-075/harness/gateway.js" > /tmp/g76-gateway.log 2>&1 &)
ANON=$(node "$REPO/docs/releases/staging-075/harness/gateway.js" keys | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).anon))')
for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" http://127.0.0.1:54321/rest/v1/ | grep -q 200 && break; sleep 1; done
if [ "${BUILD:-1}" = "1" ]; then
  cd "$REPO" && NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" NEXT_PUBLIC_STAGING_MODE=true \
    NEXT_PUBLIC_APP_ENV=staging NEXT_PUBLIC_GIT_COMMIT_SHA=$(git rev-parse HEAD) npx next build > /tmp/g76-build.log 2>&1
fi
pkill -f next-server >/dev/null 2>&1 || true
cd "$REPO" && (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" npx next start -p 3300 > /tmp/g76-next.log 2>&1 &)
for i in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3300/api/version | grep -q 200 && break; sleep 1; done
echo "local UI stack: rest $(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" http://127.0.0.1:54321/rest/v1/) frontend $(curl -s http://127.0.0.1:3300/api/version)"
