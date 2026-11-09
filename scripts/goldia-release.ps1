<#
  GOLDIA SALES - one-command release (Windows PowerShell 5.1 / PowerShell 7; pure ASCII on purpose: PowerShell 5.1 reads a
  .ps1 without BOM as Windows-1252).

  STAGING (one command; database + frontend + smoke):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target staging
  PRODUCTION (owner-approved; only a commit that is live on staging):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target production -ApprovedCommit <sha>

  What it does
  * Separate Git worktrees, never the folder you work in: %USERPROFILE%\GoldiaRelease\staging and ...\production.
    Each run fetches -Branch, checks the worktree out DETACHED at that exact commit and refuses a dirty worktree.
    node_modules are installed in the worktree with "npm ci" (packages only, touches no database) when missing or when
    package-lock.json changed.
  * Every step below is an existing gated script of this repository, run FROM THE WORKTREE (the code of that commit).
    The first step that fails STOPS the release (exit code checked); no step or test is skipped. The scripts keep all
    their own guards (Supabase ref / Vercel project / JFS demo / ERP refusals, typed confirmations, hidden passwords).
    staging:    1 scripts\goldia-staging-release.js            (dry run: backup, restore copy, chain, rollback, RLS)
                2 scripts\goldia-staging-release.js --apply    (one transaction + postflight)       [-SkipStagingDatabase]
                3 docs\releases\staging-075\deploy-staging-frontend.ps1 -ReleaseCandidate <sha>   (Vercel project
                  jewelryflow-sales-staging only; env read-only; /api/version must show the sha, sha_source=build)
                4 scripts\goldia-prod-smoke-readonly.js --target staging --expect-commit <sha>   (read-only browser smoke)
    production: 0 the commit must be live on staging (/api/version of jewelryflow-sales-staging = <sha>, build) and the
                  owner types "PRODUCTION <sha7>"
                1 run-readonly-checks.ps1 -Target production-prelaunch        (read only)
                2 scripts\goldia-prod-release.js --migration <first> --chain-to <last>   (fresh backup, restore copy,
                  same chain + emergency rollback + re-apply on the copy, read-only gates, typed ref, ONE transaction
                  with per-migration postflight + business fingerprint, read-only postflight)   [-SkipProductionDatabase]
                3 docs\releases\production-075\production-frontend.ps1 -Apply -ReleaseCandidate <sha>   (Vercel project
                  goldia-sales-production only; env verified read-only)
                4 run-readonly-checks.ps1 -Target production-post             (read only)
                5 docs\releases\production-075\run-production-smoke.ps1 -ExpectCommit <sha7>   (read-only browser smoke)
  * Log of the whole run: %USERPROFILE%\GoldiaBackups\release-<target>-<time>.log (no passwords: they are typed hidden
    into the child scripts and never echoed).
  -FirstMigration / -LastMigration: default = the newest migration file of the commit (one-migration release). The
  production release script itself checks that production is exactly at FirstMigration - 1 and stops otherwise.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("staging", "production")][string]$Target,
  [string]$Branch = "claude/goldia-sales-077-parity-period-currency",
  [string]$ApprovedCommit = "",
  [string]$WorktreeRoot = "",
  [string]$FirstMigration = "",
  [string]$LastMigration = "",
  [switch]$SkipStagingDatabase,
  [switch]$SkipProductionDatabase
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Continue"
$StagingUrl = "https://jewelryflow-sales-staging.vercel.app"
$StagingRef = "vouehtlmsunebracahon"

function Stop-Release([string]$Why) {
  Write-Host ""
  Write-Host ("RELEASE STOPPED: " + $Why) -ForegroundColor Red
  Write-Host "Nothing after this step was run. Fix the cause and run the same command again." -ForegroundColor Yellow
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
function Step([string]$Title) { Write-Host ""; Write-Host ("==== " + $Title) -ForegroundColor Cyan }
function Run-Git([string[]]$GitArgs) {
  $out = & git @GitArgs 2>&1
  if ($LASTEXITCODE -ne 0) { Stop-Release ("git " + ($GitArgs -join " ") + " failed: " + (($out | Out-String).Trim())) }
  return (($out | Out-String).Trim())
}
function Run-Node([string[]]$NodeArgs, [string]$What) {
  & node @NodeArgs
  if ($LASTEXITCODE -ne 0) { Stop-Release ($What + " failed (exit " + $LASTEXITCODE + ")") }
}
function Run-Ps1([string]$File, [string[]]$PsArgs, [string]$What, [int[]]$OkCodes = @(0)) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $File @PsArgs
  if ($OkCodes -notcontains $LASTEXITCODE) { Stop-Release ($What + " failed (exit " + $LASTEXITCODE + ")") }
}

# ---------------------------------------------------------------- preconditions
if ($Target -eq "production" -and -not $ApprovedCommit) { Stop-Release "-ApprovedCommit <sha> is required for production (the owner's written approval names the commit)" }
$git = Get-Command git -ErrorAction SilentlyContinue; if (-not $git) { Stop-Release "git not found" }
$node = Get-Command node -ErrorAction SilentlyContinue; if (-not $node) { Stop-Release "Node.js 20+ not found" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $WorktreeRoot) { $WorktreeRoot = Join-Path $env:USERPROFILE "GoldiaRelease" }
$WorktreeRoot = [System.IO.Path]::GetFullPath($WorktreeRoot)
if ($WorktreeRoot.ToLowerInvariant().StartsWith($repo.ToLowerInvariant())) { Stop-Release "-WorktreeRoot must be outside the repository folder" }
$logRoot = Join-Path $env:USERPROFILE "GoldiaBackups"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$log = Join-Path $logRoot ("release-" + $Target + "-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
try { Start-Transcript -Path $log | Out-Null } catch { }
Write-Host ("GOLDIA SALES release - target " + $Target + ", branch " + $Branch) -ForegroundColor Cyan

# ---------------------------------------------------------------- worktree at the exact commit
Step "worktree"
Push-Location $repo
[void](Run-Git @("fetch", "origin", $Branch))
$commit = Run-Git @("rev-parse", "FETCH_HEAD")
if ($Target -eq "production") {
  $want = $ApprovedCommit.Trim().ToLowerInvariant()
  if ($want.Length -lt 7 -or -not $commit.ToLowerInvariant().StartsWith($want)) { Pop-Location; Stop-Release ("the branch head " + $commit + " is not the approved commit " + $ApprovedCommit) }
}
$wt = Join-Path $WorktreeRoot $Target
$listed = Run-Git @("worktree", "list", "--porcelain")
$known = @($listed -split "`r?`n" | Where-Object { $_ -like "worktree *" } | ForEach-Object { [System.IO.Path]::GetFullPath($_.Substring(9).Trim()) })
if (-not ($known -contains $wt)) {
  if (Test-Path -LiteralPath $wt) { Pop-Location; Stop-Release ($wt + " exists but is not a worktree of this repository - move it away") }
  New-Item -ItemType Directory -Force -Path $WorktreeRoot | Out-Null
  [void](Run-Git @("worktree", "add", "--detach", $wt, $commit))
}
Pop-Location
Push-Location $wt
$dirty = Run-Git @("status", "--porcelain", "--untracked-files=no")
if ($dirty) { Pop-Location; Stop-Release ("the " + $Target + " worktree has modified tracked files:`n" + $dirty) }
[void](Run-Git @("checkout", "--detach", $commit))
$head = Run-Git @("rev-parse", "HEAD")
if ($head -ne $commit) { Pop-Location; Stop-Release ("worktree HEAD " + $head + " <> " + $commit) }
$sha7 = $head.Substring(0, 7)
Write-Host ("  " + $wt + " at " + $head + " (clean)") -ForegroundColor Green
# node_modules for the smoke tests (packages only - no database)
$lockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $wt "package-lock.json")).Hash
$stamp = Join-Path $wt "node_modules\.goldia-lock-sha256"
$needCi = -not (Test-Path -LiteralPath (Join-Path $wt "node_modules\playwright\package.json")) -or -not (Test-Path -LiteralPath $stamp) -or ((Get-Content -LiteralPath $stamp -Raw).Trim() -ne $lockHash)
if ($needCi) {
  Write-Host "  npm ci (packages only)..."
  & npm.cmd ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Release "npm ci failed" }
  Set-Content -LiteralPath $stamp -Value $lockHash -Encoding ASCII
}
# migration range of this commit
$migs = @(Get-ChildItem -LiteralPath (Join-Path $wt "supabase\migrations") -Filter "20260101000*.sql" | ForEach-Object { $_.Name.Substring(11, 3) } | Sort-Object)
if (-not $LastMigration) { $LastMigration = $migs[$migs.Count - 1] }
if (-not $FirstMigration) { $FirstMigration = $LastMigration }
if (-not ($migs -contains $FirstMigration) -or -not ($migs -contains $LastMigration) -or [int]$FirstMigration -gt [int]$LastMigration) { Pop-Location; Stop-Release ("invalid migration range " + $FirstMigration + ".." + $LastMigration) }
Write-Host ("  migrations of this release: " + $FirstMigration + ".." + $LastMigration)

if ($Target -eq "staging") {
  if (-not $SkipStagingDatabase) {
    Step "1/4 staging database: dry run (backup, restore copy, chain, rollback, RLS - staging only read)"
    Run-Node @("scripts\goldia-staging-release.js") "staging dry run"
    Step "2/4 staging database: apply (one transaction) + postflight"
    Run-Node @("scripts\goldia-staging-release.js", "--apply") "staging apply"
  } else {
    Write-Host "  -SkipStagingDatabase: database steps not run (use only when staging is already at this migration level)" -ForegroundColor Yellow
  }
  Step "3/4 staging frontend (Vercel jewelryflow-sales-staging)"
  Run-Ps1 (Join-Path $wt "docs\releases\staging-075\deploy-staging-frontend.ps1") @("-ReleaseCandidate", $head) "staging frontend deploy"
  Step "4/4 staging read-only browser smoke"
  & node scripts\goldia-prod-smoke-readonly.js --target staging --expect-commit $sha7 --out $logRoot
  if ($LASTEXITCODE -eq 1) { Stop-Release "staging smoke FAIL" }
  if ($LASTEXITCODE -eq 2) { Write-Host "  smoke REVIEW (no SQL baseline for staging is expected); read SUMMARY.txt" -ForegroundColor Yellow }
  Pop-Location
  Write-Host ""
  Write-Host ("RELEASE STAGING " + $sha7 + " DONE. Production may only take this commit: -ApprovedCommit " + $head) -ForegroundColor Green
  try { Stop-Transcript | Out-Null } catch { }
  exit 0
}

# ---------------------------------------------------------------- production
Step "0/5 approval: the commit must be live on staging"
try { $sv = Invoke-RestMethod -Uri ($StagingUrl + "/api/version") -UseBasicParsing -TimeoutSec 30 } catch { $sv = $null }
if (-not $sv -or $sv.full_commit -ne $head -or $sv.supabase_ref -ne $StagingRef -or $sv.sha_source -ne "build") { Pop-Location; Stop-Release ("staging does not run " + $head + " (staging /api/version: " + $(if ($sv) { $sv.full_commit } else { "unreachable" }) + ") - release it on staging first") }
Write-Host ("  staging runs " + $head + " (build)") -ForegroundColor Green
$typed = Read-Host ("Type PRODUCTION " + $sha7 + " to release migrations " + $FirstMigration + ".." + $LastMigration + " and the frontend to production")
if ($typed.Trim() -ne ("PRODUCTION " + $sha7)) { Pop-Location; Stop-Release "confirmation did not match" }
$ro = Join-Path $wt "docs\releases\production-075\run-readonly-checks.ps1"
if (-not $SkipProductionDatabase) {
  Step "1/5 production read-only prelaunch checks"
  Run-Ps1 $ro @("-Target", "production-prelaunch") "production-prelaunch" @(0)
  Step ("2/5 production database " + $FirstMigration + ".." + $LastMigration + " (backup, copy chain, gates, typed ref, one transaction, postflight)")
  Run-Node @("scripts\goldia-prod-release.js", "--migration", $FirstMigration, "--chain-to", $LastMigration) "production database release"
} else {
  Write-Host "  -SkipProductionDatabase: database steps not run (use only when production is already at this migration level)" -ForegroundColor Yellow
}
Step "3/5 production frontend (Vercel goldia-sales-production)"
Run-Ps1 (Join-Path $wt "docs\releases\production-075\production-frontend.ps1") @("-Apply", "-ReleaseCandidate", $head) "production frontend deploy"
Step "4/5 production read-only post-release checks"
Run-Ps1 $ro @("-Target", "production-post") "production-post" @(0)
Step "5/5 production read-only browser smoke"
Run-Ps1 (Join-Path $wt "docs\releases\production-075\run-production-smoke.ps1") @("-ExpectCommit", $sha7) "production smoke" @(0)
Pop-Location
Write-Host ""
Write-Host ("RELEASE PRODUCTION " + $sha7 + " DONE (migrations " + $FirstMigration + ".." + $LastMigration + ", frontend, post-checks, smoke PASS). Log: " + $log) -ForegroundColor Green
try { Stop-Transcript | Out-Null } catch { }
exit 0
