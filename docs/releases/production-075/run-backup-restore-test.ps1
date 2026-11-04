<#
  GOLDIA - PRODUCTION backup + LOCAL restore test (Windows PowerShell 5.1 / 7; pure ASCII file on purpose).

  Production (Supabase vrozlllcaxinavzxueif) is only READ:
    - pg_dump / pg_dumpall (read-only snapshots), every query and SQL file in an explicit
      BEGIN TRANSACTION READ ONLY with a guard (the Supabase pooler ignores PGOPTIONS);
    - migration 073 and the 073 -> 074 -> 075 chain run ONLY on a disposable LOCAL PostgreSQL 17 restored
      from the fresh backup; production is never changed.
  The password is asked by the Node script in a hidden prompt and lives only in child process environments.

    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-backup-restore-test.ps1

  PASS only when every gate is true (exit 0): backup, baseline, recovery, preflight, compat073, accounting, chain.
  Output: %USERPROFILE%\GoldiaBackups\goldia-prod-<time>\ (SUMMARY.txt and GATES.json have no secrets and no
  customer data; the *.dump files DO contain customer data - keep the folder private, never commit it).
#>
param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin",
  [string]$OutRoot = "",
  [string]$PoolerHost = "aws-0-ap-southeast-1.pooler.supabase.com",
  [switch]$KeepRestore
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Continue"
$ProdRef = "vrozlllcaxinavzxueif"
function Fail([string]$m) { Write-Host ""; Write-Host ("RESULT: FAIL - " + $m) -ForegroundColor Red; exit 1 }

foreach ($bad in @("vouehtlmsunebracahon", "yvvbdoqncubtwlzskgml", "hbbuskyifxkowlozsaym", "vrozlilcaxinavzxueif")) { if ($PoolerHost.Contains($bad)) { Fail ("host contains another project's ref (" + $bad + ")") } }
if (-not ($PoolerHost -match '^[a-z0-9-]+\.pooler\.supabase\.com$') -and $PoolerHost -ne ("db." + $ProdRef + ".supabase.co")) { Fail ("unexpected host " + $PoolerHost) }
foreach ($t in @("pg_dump", "pg_dumpall", "pg_restore", "psql", "initdb", "pg_ctl")) {
  if (-not (Test-Path -LiteralPath (Join-Path $PgBin ($t + ".exe")))) { Fail ($t + ".exe not found in " + $PgBin + " (install PostgreSQL 17 or pass -PgBin)") }
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js 20+ not found" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$script = Join-Path $repo "scripts\goldia-prod-backup-and-preflight.js"
foreach ($f in @($script, (Join-Path $repo "docs\releases\production-075\01_baseline_readonly.sql"), (Join-Path $repo "docs\releases\production-075\00_preflight_072_to_075_readonly.sql"))) {
  if (-not (Test-Path -LiteralPath $f)) { Fail ("missing " + $f + " - run from the release branch checkout") }
}
if (-not $OutRoot) { $OutRoot = Join-Path $env:USERPROFILE "GoldiaBackups" }
$OutRoot = [System.IO.Path]::GetFullPath($OutRoot)
if ($OutRoot.ToLowerInvariant().StartsWith($repo.ToLowerInvariant())) { Fail "the backup folder must be outside the repository" }
if (Test-Path Env:PGPASSWORD) { Remove-Item Env:PGPASSWORD }   # the Node script asks for it (hidden)

Write-Host ("GOLDIA production backup + local restore test - " + $ProdRef + " via " + $PoolerHost) -ForegroundColor Cyan
$nodeArgs = @($script, "--fresh", "--migration", "073", "--chain", "--host", $PoolerHost, "--user", ("postgres." + $ProdRef), "--sslmode", "require", "--pg-bin", $PgBin, "--out", $OutRoot)
if ($KeepRestore) { $nodeArgs += "--keep-restore" }
& $node.Source @nodeArgs
$code = $LASTEXITCODE

$latest = Get-ChildItem -LiteralPath $OutRoot -Directory -Filter "goldia-prod-*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $latest) { Fail ("no backup folder in " + $OutRoot + " (exit " + $code + ")") }
$gatesFile = Join-Path $latest.FullName "GATES.json"
if (-not (Test-Path -LiteralPath $gatesFile)) { Fail ("the run stopped before the gates (exit " + $code + "); see " + (Join-Path $latest.FullName "SUMMARY.txt")) }
$g = Get-Content -LiteralPath $gatesFile -Raw | ConvertFrom-Json
Write-Host ""
Write-Host "Gates:"
$need = @("backup", "baseline", "recovery", "preflight", "compat", "accounting", "chain")
$allTrue = $true
foreach ($k in $need) {
  $v = $false
  if ($g.PSObject.Properties.Name -contains $k) { $v = [bool]$g.$k }
  if (-not $v) { $allTrue = $false }
  $col = "Green"; if (-not $v) { $col = "Red" }
  Write-Host ("  " + $k.PadRight(11) + " " + $v) -ForegroundColor $col
}
Write-Host ("Folder: " + $latest.FullName)
if ($code -eq 0 -and $allTrue -and [bool]$g.ready) {
  Write-Host ""
  Write-Host "RESULT: PASS - backup verified, restored copy identical to production (rows + baseline), recovery to 072 and forward path 073-075 proven on the copy. Production was only read." -ForegroundColor Green
  exit 0
}
Fail ("exit " + $code + ", ready=" + [bool]$g.ready + " - see SUMMARY.txt in " + $latest.FullName)
