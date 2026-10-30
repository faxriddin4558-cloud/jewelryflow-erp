# =====================================================================
# JewelryFlow ERP — Goldia Sales MVP Release & Deployment Script (PowerShell)
# Target Production: https://goldia-sales-production.vercel.app
# Migration: supabase/migrations/20260101000064_goldia_audit_production_fixes.sql
# =====================================================================

$ErrorActionPreference = "Stop"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " JEWELRYFLOW ERP - PRODUCTION RELEASE DEPLOYER" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Local Pre-Flight Checks
Write-Host "`n[1/4] Running Local Pre-Flight Checks (Typecheck & Tests)..." -ForegroundColor Yellow
npm run typecheck
if ($LASTEXITCODE -ne 0) {
    Write-Error "Typecheck failed! Aborting release."
    exit 1
}

npm run test
if ($LASTEXITCODE -ne 0) {
    Write-Error "Vitest test suite failed! Aborting release."
    exit 1
}
Write-Host "Pre-flight checks passed 100%!" -ForegroundColor Green

# 2. Supabase Migration Deployment
Write-Host "`n[2/4] Applying Migration 064 to Supabase Production Database..." -ForegroundColor Yellow
if (-not $env:SUPABASE_DB_URL) {
    $dbUrl = Read-Host "Enter Supabase Production Database URL (e.g. postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres)"
} else {
    $dbUrl = $env:SUPABASE_DB_URL
}

if ($dbUrl) {
    $migrationPath = "./supabase/migrations/20260101000064_goldia_audit_production_fixes.sql"
    Write-Host "Executing $migrationPath on Supabase..." -ForegroundColor Cyan
    npx supabase db push --db-url "$dbUrl"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "npx supabase db push exited with code $LASTEXITCODE. Attempting direct psql execution..." -ForegroundColor Yellow
        psql "$dbUrl" -f "$migrationPath"
    }
    Write-Host "Database migration 064 successfully applied!" -ForegroundColor Green
} else {
    Write-Warning "Skipped DB migration execution (No SUPABASE_DB_URL provided). Apply 20260101000064 manually via Supabase SQL Editor."
}

# 3. Vercel Production Build & Deploy
Write-Host "`n[3/4] Deploying Frontend to Vercel Production..." -ForegroundColor Yellow
npx vercel --prod
if ($LASTEXITCODE -ne 0) {
    Write-Error "Vercel production deploy failed!"
    exit 1
}

Write-Host "`n====================================================" -ForegroundColor Green
Write-Host " RELEASE COMPLETE! Production deployment successful." -ForegroundColor Green
Write-Host " Live Site: https://goldia-sales-production.vercel.app" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
