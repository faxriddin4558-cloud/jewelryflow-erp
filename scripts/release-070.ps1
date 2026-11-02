# GOLDIA — migration 070 production release (owner runs this; nothing here merges or deploys).
# Gates, in order, stopping at the first failure (production unchanged on any stop):
#   fresh pg_dump backup -> restore test on a local PostgreSQL -> 070 + rollback + re-apply on the restored copy
#   -> read-only accounting investigation -> read-only historical damage scan -> 070 in ONE transaction
#   -> postflight (17 checks) + unchanged row counts and balances.
# The DB password is asked in a hidden prompt; it is never printed or saved.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

git fetch origin ccr-fb8951ce-65agfo
git checkout ccr-fb8951ce-65agfo
git pull --ff-only origin ccr-fb8951ce-65agfo
if (-not (Test-Path "supabase/migrations/20260101000070_goldia_acceptance_audit_fixes.sql")) { throw "070 migration file missing" }
if (-not (Test-Path "supabase/rollback/20260101000070_rollback.sql")) { throw "070 rollback file missing" }

npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "typecheck failed - release stopped" }
npx vitest run src/lib/__tests__/goldia-acceptance-audit-fixes.test.ts --hookTimeout=120000
if ($LASTEXITCODE -ne 0) { throw "070 regression tests failed - release stopped" }

node scripts/goldia-prod-release.js --migration 070
if ($LASTEXITCODE -ne 0) { Write-Host "RELEASE STOPPED - production database not changed unless the output says MIGRATION applied (then see rollback line)." -ForegroundColor Red; exit 1 }

Write-Host "070 APPLIED + POSTFLIGHT PASS. Send RELEASE-070-RESULT.txt and damage-scan-070.txt (from the newest GoldiaBackups folder) for review; then merge the PR." -ForegroundColor Green
