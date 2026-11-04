<#
  GOLDIA SALES - READ-ONLY production smoke test in a real browser (Windows PowerShell 5.1 / 7; pure ASCII file on purpose).

  Run AFTER "run-readonly-checks.ps1 -Target production-post" (its 01_baseline.txt is used to compare the director's
  balances with the database). Nothing is written: every browser request that is not a read is aborted before it leaves
  the computer (see scripts\goldia-prod-smoke-readonly.js). Asks the director, manager and seller e-mail and password
  (password hidden; never printed or stored).

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
  [switch]$NoScreenshots
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

if (-not $Baseline) {
  $post = Get-ChildItem -LiteralPath $OutRoot -Directory -Filter "readonly-production-post-*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "01_baseline.txt") } | Select-Object -First 1
  if ($post) { $Baseline = Join-Path $post.FullName "01_baseline.txt" }
}
$nodeArgs = @($script, "--target", "production", "--expect-commit", $ExpectCommit, "--channel", $Channel, "--out", $OutRoot, "--roles", $Roles)
if ($Baseline) {
  if (-not (Test-Path -LiteralPath $Baseline)) { Fail ("-Baseline file not found: " + $Baseline) }
  Write-Host ("Post-release SQL baseline: " + $Baseline)
  $nodeArgs += @("--baseline", $Baseline)
} else {
  Write-Host "No post-release SQL baseline found (run run-readonly-checks.ps1 -Target production-post first); the balance comparison will be REVIEW." -ForegroundColor Yellow
}
if ($NoScreenshots) { $nodeArgs += "--no-screenshots" }
if (Test-Path Env:GOLDIA_SMOKE_CREDS_FILE) { Remove-Item Env:GOLDIA_SMOKE_CREDS_FILE }   # test-only (staging); production always asks

Write-Host "GOLDIA SALES production smoke - READ ONLY (writes are blocked in the browser)" -ForegroundColor Cyan
& $node.Source @nodeArgs
$code = $LASTEXITCODE
if ($code -eq 0) { Write-Host "Smoke test PASS" -ForegroundColor Green }
elseif ($code -eq 2) { Write-Host "Smoke test REVIEW - read the REVIEW lines above / SUMMARY.txt" -ForegroundColor Yellow }
else { Write-Host ("Smoke test FAIL (exit " + $code + ")") -ForegroundColor Red }
exit $code
