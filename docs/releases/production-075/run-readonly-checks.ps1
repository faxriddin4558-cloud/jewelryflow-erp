<#
  GOLDIA — READ-ONLY database checks. Nothing is written: every psql session is opened with
  default_transaction_read_only=on and every SQL file runs inside "begin transaction read only ... rollback".
  The password is asked by psql (hidden) and never stored.

  Production (Supabase vrozlllcaxinavzxueif): 072 -> 075 preflight + business baseline
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production
  Staging (vouehtlmsunebracahon): CRLF-tolerant function-body parity of 075 (the "69 bodies differ" question)
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target staging -PoolerHost aws-0-<region>.pooler.supabase.com

  Output folder: %USERPROFILE%\GoldiaBackups\readonly-<target>-<time>\ (aggregates only, no customer data).
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("production", "staging")][string]$Target,
  [string]$PoolerHost = "",
  [int]$Port = 5432,
  [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin"
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Continue"
$Refs = @{ production = "vrozlllcaxinavzxueif"; staging = "vouehtlmsunebracahon" }
$Never = @("yvvbdoqncubtwlzskgml", "hbbuskyifxkowlozsaym")   # JFS demo, manufacturing ERP
$Ref = $Refs[$Target]
if (-not $PoolerHost) {
  if ($Target -eq "production") { $PoolerHost = "aws-0-ap-southeast-1.pooler.supabase.com" }  # same default as scripts/goldia-prod-release.js
  else { Write-Host "STOP: -PoolerHost is required for staging (Supabase Dashboard -> Connect -> Session pooler)" -ForegroundColor Red; exit 1 }
}
foreach ($bad in $Never + ($Refs.Values | Where-Object { $_ -ne $Ref })) { if ($PoolerHost -match $bad) { Write-Host "STOP: host contains another project's ref ($bad)" -ForegroundColor Red; exit 1 } }
if ($PoolerHost -notmatch '\.pooler\.supabase\.com$' -and $PoolerHost -ne "db.$Ref.supabase.co") { Write-Host "STOP: unexpected host $PoolerHost" -ForegroundColor Red; exit 1 }
$psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path $psql)) { Write-Host "STOP: $psql not found (install PostgreSQL 17 client or pass -PgBin)" -ForegroundColor Red; exit 1 }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$files = if ($Target -eq "production") {
  @(@("00_preflight", "docs\releases\production-075\00_preflight_072_to_075_readonly.sql"), @("01_baseline", "docs\releases\production-075\01_baseline_readonly.sql"))
} else {
  @(@("function_body_parity_075", "supabase\release\function_body_parity_075_readonly.sql"))
}
$out = Join-Path $env:USERPROFILE ("GoldiaBackups\readonly-$Target-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $out | Out-Null
$conn = "host=$PoolerHost port=$Port dbname=postgres user=postgres.$Ref sslmode=require application_name=goldia-readonly-checks"
$env:PGOPTIONS = "-c default_transaction_read_only=on -c statement_timeout=120000"
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
Write-Host "GOLDIA read-only checks — target $Target ($Ref), host $PoolerHost" -ForegroundColor Cyan
Write-Host "psql will ask for the database password of postgres.$Ref (hidden)."
# one identity probe first: refuses a JFS demo database and prints what we are connected to
$probe = & $psql $conn -X -A -t -v ON_ERROR_STOP=1 -c "select current_setting('transaction_read_only') || '|' || current_user || '|' || (to_regprocedure('public.deployment_environment()') is null)::text || '|' || (select max(version) from supabase_migrations.schema_migrations)" 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host "STOP: connection failed: $probe" -ForegroundColor Red; exit 1 }
$p = ($probe | Select-Object -Last 1).ToString().Split("|")
Write-Host "  read_only=$($p[0]) user=$($p[1]) not_jfs=$($p[2]) latest_migration=$($p[3])"
if ($p[0] -ne "on" -or $p[1] -ne "postgres" -or $p[2] -ne "true") { Write-Host "STOP: session is not read-only or this is not the Goldia database" -ForegroundColor Red; exit 1 }
foreach ($f in $files) {
  $target = Join-Path $out ($f[0] + ".txt")
  & $psql $conn -X -A -t -F " | " -v ON_ERROR_STOP=1 -f (Join-Path $repo $f[1]) 2>&1 | Out-File -Encoding utf8 $target
  $code = $LASTEXITCODE
  Write-Host ("  {0}: exit {1} -> {2}" -f $f[0], $code, $target)
  Get-Content $target | Where-Object { $_ -match '^(RESULT|crlf_only|identical|DIFFERENT|MISSING)|\| STOP \||\| WARN \||fingerprint|history latest' } | ForEach-Object { Write-Host "    $_" }
}
Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue
Write-Host "`nDone. Send the files in $out (no customer data inside)." -ForegroundColor Green
