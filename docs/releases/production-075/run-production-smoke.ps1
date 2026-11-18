<#
  GOLDIA SALES - READ-ONLY production smoke test in a real browser (Windows PowerShell 5.1 / 7; pure ASCII file on purpose).

  Balances (B3, 2026-11-18): the director's API balances are compared with the database of the SAME moment - a read-only
  snapshot (run-readonly-checks.ps1 -Target production-balance-snapshot, asks the database password) is taken right
  before and right after the browser run. An old baseline (opening / release day) is never the expected value: real sales
  change the balances. Database quiet during the run -> every API value must equal it (else FAIL); database moved (live
  sales) -> API values within before..after are the natural result (PASS), others REVIEW. -Baseline <file> keeps the old
  single-file comparison (only a file younger than 20 min is compared); -NoLiveBalances skips the snapshots (B3 REVIEW).
  Nothing is written: every browser request that is not a read is aborted before it leaves the computer (see
  scripts\goldia-prod-smoke-readonly.js). Asks the director, manager and seller e-mail and password (hidden; never stored).

    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-production-smoke.ps1

  Uses the installed Microsoft Edge (-Channel chrome for Google Chrome). Needs Node.js 20+ and the repository's
  node_modules (npm ci - touches no database). Output: %USERPROFILE%\GoldiaBackups\smoke-production-<time>\
  (SUMMARY.txt / RESULT.json: aggregates only; screenshots\*.png show real screens - keep the folder private).
  Exit / last line:  RESULT: PASS (0)  |  RESULT: REVIEW (2)  |  RESULT: FAIL (1)
#>
param(
  [string]$ExpectCommit = "fec64ec",
  [ValidateSet("msedge", "chrome")][string]$Channel = "msedge",
  [string]$OutRoot = "",
  [string]$Baseline = "",
  [string]$Roles = "director,manager,seller",
  [switch]$NoScreenshots,
  [switch]$NoLiveBalances,
  [string]$PoolerHost = ""
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Continue"
function Fail([string]$m) { Write-Host ""; Write-Host ("RESULT: FAIL - " + $m) -ForegroundColor Red; exit 1 }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js 20+ not found" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$script = Join-Path $repo "scripts\goldia-prod-smoke-readonly.js"
if (-not (Test-Path -LiteralPath $script)) { Fail ("missing " + $script + " - run from the release branch checkout") }
if (-not (Test-Path -LiteralPath (Join-Path $repo "node_modules\playwright\package.json"))) { Fail ("Playwright not installed - run: cd """ + $repo + """ ; npm ci   (installs packages only, touches no database)") }
if (-not $OutRoot) { $OutRoot = Join-Path $env:USERPROFILE "GoldiaBackups" }
$OutRoot = [System.IO.Path]::GetFullPath($OutRoot)
if ($OutRoot.ToLowerInvariant().StartsWith($repo.ToLowerInvariant())) { Fail "the output folder must be outside the repository" }

# read-only database snapshot of this moment (aggregates only) -> $script:SnapFile = path of its 01_baseline.txt
# (the child's output goes straight to the console - it asks the password - so the path is not returned through the pipeline)
$ro = Join-Path $repo "docs\releases\production-075\run-readonly-checks.ps1"
function Take-Snapshot([string]$label) {
  Write-Host ("Database balance snapshot " + $label + " the browser run (read only; asks the database password)") -ForegroundColor Cyan
  $since = Get-Date
  $a = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ro, "-Target", "production-balance-snapshot", "-OutRoot", $OutRoot)
  if ($PoolerHost) { $a += @("-PoolerHost", $PoolerHost) }
  & powershell @a
  if ($LASTEXITCODE -ne 0) { Fail ("read-only balance snapshot " + $label + " the run did not PASS (exit " + $LASTEXITCODE + ")") }
  $d = Get-ChildItem -LiteralPath $OutRoot -Directory -Filter "readonly-production-balance-snapshot-*" -ErrorAction SilentlyContinue |
    Where-Object { $_.CreationTime -ge $since.AddSeconds(-2) -and (Test-Path -LiteralPath (Join-Path $_.FullName "01_baseline.txt")) } | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $d) { Fail ("balance snapshot " + $label + " the run: 01_baseline.txt not found under " + $OutRoot) }
  $script:SnapFile = Join-Path $d.FullName "01_baseline.txt"
}

$live = -not $Baseline -and -not $NoLiveBalances
$nodeArgs = @($script, "--target", "production", "--expect-commit", $ExpectCommit, "--channel", $Channel, "--out", $OutRoot, "--roles", $Roles)
$before = $null
if ($Baseline) {
  if (-not (Test-Path -LiteralPath $Baseline)) { Fail ("-Baseline file not found: " + $Baseline) }
  Write-Host ("SQL baseline (single file, compared only if younger than 20 min): " + $Baseline)
  $nodeArgs += @("--baseline", $Baseline)
} elseif ($live) {
  Take-Snapshot "BEFORE"; $before = $script:SnapFile
  $nodeArgs += "--defer-balances"
} else {
  Write-Host "-NoLiveBalances: the balance comparison (B3) will be REVIEW." -ForegroundColor Yellow
}
if ($NoScreenshots) { $nodeArgs += "--no-screenshots" }
if (Test-Path Env:GOLDIA_SMOKE_CREDS_FILE) { Remove-Item Env:GOLDIA_SMOKE_CREDS_FILE }   # test-only (staging); production always asks

Write-Host "GOLDIA SALES production smoke - READ ONLY (writes are blocked in the browser)" -ForegroundColor Cyan
$runStart = Get-Date
& $node.Source @nodeArgs
$code = $LASTEXITCODE
if ($live -and $code -ne 1) {
  $smokeDir = Get-ChildItem -LiteralPath $OutRoot -Directory -Filter "smoke-production-*" -ErrorAction SilentlyContinue |
    Where-Object { $_.CreationTime -ge $runStart.AddSeconds(-2) -and (Test-Path -LiteralPath (Join-Path $_.FullName "RESULT.json")) } | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $smokeDir) { Fail "smoke folder of this run not found" }
  Take-Snapshot "AFTER"; $after = $script:SnapFile
  & $node.Source @($script, "--target", "production", "--compare-balances", $smokeDir.FullName, "--baseline", $before, "--baseline-after", $after)
  $code = $LASTEXITCODE
}
if ($code -eq 0) { Write-Host "Smoke test PASS" -ForegroundColor Green }
elseif ($code -eq 2) { Write-Host "Smoke test REVIEW - read the REVIEW lines above / SUMMARY.txt" -ForegroundColor Yellow }
else { Write-Host ("Smoke test FAIL (exit " + $code + ")") -ForegroundColor Red }
exit $code
