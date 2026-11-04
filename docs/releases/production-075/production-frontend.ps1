<#
  GOLDIA SALES - PRODUCTION frontend guard (pure ASCII file: Windows PowerShell 5.1 reads a .ps1 without BOM as Windows-1252) (Vercel project goldia-sales-production, Supabase vrozlllcaxinavzxueif).
  Windows PowerShell 5.1 / PowerShell 7. Native commands run through System.Diagnostics.Process (stderr is not fatal).

  DEFAULT = CHECK ONLY (nothing in Vercel or Supabase changes):
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\production-frontend.ps1
      1. Vercel login; link this folder to goldia-sales-production (only .vercel/project.json is written locally)
      2. reads the Production environment of the project into a temporary file, validates it and deletes it at once:
         NEXT_PUBLIC_SUPABASE_URL = https://vrozlllcaxinavzxueif.supabase.co, NEXT_PUBLIC_APP_ENV = production,
         NEXT_PUBLIC_STAGING_MODE not "true", both Supabase keys belong to vrozlllcaxinavzxueif (JWT ref),
         no staging (vouehtlmsunebracahon), JFS demo (yvvbdoqncubtwlzskgml) or ERP (hbbuskyifxkowlozsaym) value anywhere
      3. the live https://goldia-sales-production.vercel.app/api/version (supabase_ref, env, commit)

  -Apply (ONLY after the owner's written approval and after production is at 075):
    ... -Apply -ReleaseCandidate <sha>
      same checks; the clean checkout must be the release candidate; the owner types the production ref;
      then `vercel deploy --prod` with NEXT_PUBLIC_GIT_COMMIT_SHA=<sha>; the old deployment stays live until the new one
      is ready; /api/version must then show <sha>, vrozlllcaxinavzxueif, production.
      Environment values are NOT changed by this script (set them in the Vercel dashboard; this script verifies them).
      The checkout must be clean BEFORE `vercel link`; the only change the script undoes is the Vercel CLI appending
      ".vercel" (or ".env*.local") to the end of .gitignore - any other change stops the deploy untouched.
#>
param(
  [switch]$Apply,
  [string]$ReleaseCandidate = "",
  [string]$ExpectedProjectId = "",
  [string]$Scope = "",
  [string]$VercelVersion = "latest"
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Continue"
$ProjectName = "goldia-sales-production"
$ProdRef = "vrozlllcaxinavzxueif"
$ProdUrl = "https://$ProdRef.supabase.co"
$Forbidden = @{ "vouehtlmsunebracahon" = "STAGING"; "yvvbdoqncubtwlzskgml" = "JFS demo"; "hbbuskyifxkowlozsaym" = "ERP"; "vrozlilcaxinavzxueif" = "typo of the production ref" }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$problems = New-Object System.Collections.ArrayList

function Stop-Now([string]$m) { Write-Host "`nSTOP: $m" -ForegroundColor Red; Write-Host "Nothing was changed." -ForegroundColor Green; exit 1 }
function Note-Problem([string]$m) { [void]$problems.Add($m); Write-Host "  PROBLEM: $m" -ForegroundColor Red }
function Quote-Arg([string]$a) { if ($a -match '[\s"&|<>^]') { return '"' + ($a -replace '"', '\"') + '"' }; return $a }
function Invoke-Native([string]$Exe, [string[]]$Arguments, [string]$StdIn = $null) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = '/d /s /c "' + ((@($Exe) + $Arguments | ForEach-Object { Quote-Arg $_ }) -join ' ') + '"'
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true; $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
  if ($StdIn) { $p.StandardInput.Write($StdIn) }
  $p.StandardInput.Close(); $p.WaitForExit()
  return @{ Code = $p.ExitCode; Out = $o.Result; Err = $e.Result }
}
function Invoke-Vercel([string[]]$Arguments) {
  $scopeArgs = @(); if ($Scope) { $scopeArgs = @("--scope", $Scope) }
  return Invoke-Native "npx.cmd" (@("--yes", "vercel@$VercelVersion") + $Arguments + $scopeArgs)
}
function Get-JwtRef([string]$Jwt) {
  $parts = $Jwt.Split("."); if ($parts.Length -ne 3) { return $null }
  $b = $parts[1].Replace("-", "+").Replace("_", "/"); while ($b.Length % 4) { $b += "=" }
  try { $c = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) | ConvertFrom-Json } catch { return $null }
  if ($c.PSObject.Properties.Name -contains "ref") { return [string]$c.ref }; return ""
}

# Vercel CLI appends ".vercel" to .gitignore on every link when it cannot match the existing line (on Windows the
# file's line endings differ from the CLI's), which then trips the clean-checkout check in [4]. Only that exact,
# append-only change is undone (original bytes written back); any other .gitignore change stops the script untouched.
$GitignorePath = Join-Path (Get-Location).Path ".gitignore"
$AllowedVercelGitignoreLines = @(".vercel", ".vercel/", "/.vercel", "/.vercel/", ".env*.local")
function Read-FileBytes([string]$Path) { if (Test-Path -LiteralPath $Path) { return ,([IO.File]::ReadAllBytes($Path)) }; return $null }
function Test-BytePrefix([byte[]]$Prefix, [byte[]]$Full) {
  if ($Prefix.Length -gt $Full.Length) { return $false }
  for ($i = 0; $i -lt $Prefix.Length; $i++) { if ($Prefix[$i] -ne $Full[$i]) { return $false } }
  return $true
}
function Restore-VercelGitignore([string]$Step) {
  $orig = $script:GitignoreOriginal
  $now = Read-FileBytes $GitignorePath
  if ($null -eq $orig -and $null -eq $now) { return }
  if ($null -ne $orig -and $null -ne $now -and $orig.Length -eq $now.Length -and (Test-BytePrefix $orig $now)) { return }
  if ($null -eq $now) { Stop-Now ".gitignore disappeared after $Step - inspect the folder" }
  $prefix = [byte[]]@(); if ($null -ne $orig) { $prefix = $orig }
  if (-not (Test-BytePrefix $prefix $now)) { Stop-Now ".gitignore was edited (not only appended) after $Step - inspect it; nothing was restored" }
  $added = [Text.Encoding]::UTF8.GetString($now, $prefix.Length, $now.Length - $prefix.Length)
  $lines = @($added -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
  foreach ($l in $lines) { if ($AllowedVercelGitignoreLines -notcontains $l) { Stop-Now "after $Step .gitignore got an unexpected line '$l' - inspect it; nothing was restored" } }
  if ($null -eq $orig) { Remove-Item -LiteralPath $GitignorePath -Force } else { [IO.File]::WriteAllBytes($GitignorePath, $orig) }
  $what = "blank lines"; if ($lines.Count -gt 0) { $what = ($lines -join ", ") }
  Write-Host "  .gitignore: Vercel CLI appended ($what) during $Step; original restored byte-for-byte" -ForegroundColor Yellow
}

Write-Host "GOLDIA SALES - production frontend $(if ($Apply) { 'DEPLOY (-Apply)' } else { 'CHECK ONLY' })" -ForegroundColor Cyan

Write-Host "`n[1] Vercel CLI, login, project link"
$ver = Invoke-Vercel @("--version"); if ($ver.Code -ne 0) { Stop-Now "Vercel CLI did not start: $($ver.Err.Trim())" }
$who = Invoke-Vercel @("whoami"); if ($who.Code -ne 0) { Stop-Now "not logged in to Vercel (npx vercel@latest login)" }
Write-Host "  logged in as $($who.Out.Trim())"
$before = $null; if (Test-Path ".vercel\project.json") { $before = Get-Content ".vercel\project.json" -Raw | ConvertFrom-Json }
if ($before -and -not $Apply) { Write-Host "  (this folder is linked to project $($before.projectId); it will be re-linked to $ProjectName - local file only)" }
if ($Apply) {
  # Clean checkout BEFORE anything writes to the folder, so the owner's own edits are never touched or hidden.
  $pre = (Invoke-Native "git" @("status", "--porcelain", "--untracked-files=no")).Out.Trim()
  if ($pre) { Stop-Now "tracked files are modified before vercel link (commit or stash them first):`n$pre" }
}
$script:GitignoreOriginal = Read-FileBytes $GitignorePath
$link = Invoke-Vercel @("link", "--yes", "--project", $ProjectName)
Restore-VercelGitignore "vercel link"
if ($link.Code -ne 0) { Stop-Now "vercel link failed: $($link.Err.Trim())" }
$linked = Get-Content ".vercel\project.json" -Raw | ConvertFrom-Json
if ($linked.PSObject.Properties.Name -contains "projectName" -and $linked.projectName -and $linked.projectName -ne $ProjectName) { Stop-Now "linked project is $($linked.projectName)" }
if ($ExpectedProjectId -and $linked.projectId -ne $ExpectedProjectId) { Stop-Now "linked project id $($linked.projectId) <> expected $ExpectedProjectId" }
Write-Host "  project $ProjectName id=$($linked.projectId)" -ForegroundColor Green

Write-Host "`n[2] Production environment of $ProjectName (read, validated, temp file deleted)"
$tmp = Join-Path $env:TEMP ("goldia-prod-env-" + [Guid]::NewGuid().ToString("N") + ".env")
try {
  $pull = Invoke-Vercel @("env", "pull", $tmp, "--environment=production", "--yes")
  if ($pull.Code -ne 0 -or -not (Test-Path $tmp)) { Stop-Now "vercel env pull failed: $(($pull.Err + $pull.Out).Trim())" }
  $vars = @{}
  foreach ($line in (Get-Content $tmp)) { if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim().Trim('"') } }
} finally { if (Test-Path $tmp) { Remove-Item $tmp -Force } }
Write-Host "  temporary env file removed"
Restore-VercelGitignore "vercel env pull"
foreach ($k in $vars.Keys) { foreach ($ref in $Forbidden.Keys) { if ($vars[$k] -match $ref) { Note-Problem "$k contains the $($Forbidden[$ref]) reference ($ref)" } } }
$url = if ($vars.ContainsKey("NEXT_PUBLIC_SUPABASE_URL")) { $vars["NEXT_PUBLIC_SUPABASE_URL"] } else { "" }
if ($url -ne $ProdUrl) { Note-Problem "NEXT_PUBLIC_SUPABASE_URL is '$url', expected $ProdUrl" } else { Write-Host "  NEXT_PUBLIC_SUPABASE_URL = production" -ForegroundColor Green }
$appEnv = if ($vars.ContainsKey("NEXT_PUBLIC_APP_ENV")) { $vars["NEXT_PUBLIC_APP_ENV"] } else { "" }
if ($appEnv -ne "production") { Note-Problem "NEXT_PUBLIC_APP_ENV is '$appEnv', expected production" } else { Write-Host "  NEXT_PUBLIC_APP_ENV = production" -ForegroundColor Green }
if ($vars.ContainsKey("NEXT_PUBLIC_STAGING_MODE") -and $vars["NEXT_PUBLIC_STAGING_MODE"] -eq "true") { Note-Problem "NEXT_PUBLIC_STAGING_MODE=true in production" }
foreach ($k in @("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY")) {
  if (-not $vars.ContainsKey($k) -or -not $vars[$k]) { Note-Problem "$k is missing or not readable (sensitive variables cannot be pulled - verify it in the dashboard)"; continue }
  $r = Get-JwtRef $vars[$k]
  if ($r -eq $null) { if ($vars[$k] -match '^sb_(publishable|secret)_') { Write-Host "  $k : new-style key (ref checked live below)" } else { Note-Problem "$k is not a JWT or sb_ key" } }
  elseif ($r -ne $ProdRef) { Note-Problem "$k belongs to '$r', not production" } else { Write-Host "  $k : production ($ProdRef)" -ForegroundColor Green }
}
if ($vars.ContainsKey("NEXT_PUBLIC_SUPABASE_ANON_KEY") -and $vars["NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
  try { $st = (Invoke-WebRequest -Uri "$ProdUrl/auth/v1/settings" -Headers @{ apikey = $vars["NEXT_PUBLIC_SUPABASE_ANON_KEY"] } -UseBasicParsing -TimeoutSec 30).StatusCode } catch { $st = -1 }
  if ($st -ne 200) { Note-Problem "the anon key is not accepted by the production Auth API (HTTP $st)" } else { Write-Host "  anon key accepted by production Auth (read-only settings call)" -ForegroundColor Green }
}
$vars = $null

Write-Host "`n[3] live production frontend"
try {
  $v = Invoke-RestMethod -Uri "https://$ProjectName.vercel.app/api/version" -UseBasicParsing -TimeoutSec 30
  Write-Host ("  commit={0} env={1} supabase_ref={2} staging_mode={3}" -f $v.commit, $v.env, $v.supabase_ref, $v.staging_mode)
  if ($v.supabase_ref -ne $ProdRef) { Note-Problem "live frontend uses supabase_ref '$($v.supabase_ref)'" }
  if ($v.staging_mode -eq $true) { Note-Problem "live frontend runs in staging mode" }
} catch { Note-Problem "cannot read https://$ProjectName.vercel.app/api/version" }

if ($problems.Count) { Write-Host "`nRESULT: $($problems.Count) PROBLEM(S) - fix the Production environment in the Vercel dashboard first." -ForegroundColor Red; if ($Apply) { Stop-Now "deploy refused" }; exit 1 }
if (-not $Apply) { Write-Host "`nRESULT: CHECK PASS - production frontend environment points only to $ProdRef. Nothing was changed." -ForegroundColor Green; exit 0 }

Write-Host "`n[4] deploy (owner-approved)"
if (-not $ReleaseCandidate) { Stop-Now "-ReleaseCandidate <sha> is required with -Apply" }
$head = (Invoke-Native "git" @("rev-parse", "HEAD")).Out.Trim()
if (-not $head.StartsWith($ReleaseCandidate)) { Stop-Now "HEAD $head is not the release candidate" }
Restore-VercelGitignore "deploy pre-check"
$dirty = (Invoke-Native "git" @("status", "--porcelain", "--untracked-files=no")).Out.Trim()
if ($dirty) { Stop-Now "tracked files are modified:`n$dirty" }
$typed = Read-Host "Type the production Supabase ref ($ProdRef) to deploy $($head.Substring(0,7)) to $ProjectName"
if ($typed.Trim() -ne $ProdRef) { Stop-Now "confirmation did not match" }
$dep = Invoke-Vercel @("deploy", "--prod", "--yes", "--build-env", "NEXT_PUBLIC_GIT_COMMIT_SHA=$head")
Write-Host $dep.Out
if ($dep.Code -ne 0) { Write-Host $dep.Err; Write-Host "STOP: deploy failed; the previous production deployment is still live." -ForegroundColor Red; exit 1 }
$ok = $false
for ($i = 0; $i -lt 12 -and -not $ok; $i++) { Start-Sleep -Seconds 10; try { $v = Invoke-RestMethod -Uri "https://$ProjectName.vercel.app/api/version" -UseBasicParsing -TimeoutSec 30; $ok = ($v.full_commit -eq $head -and $v.supabase_ref -eq $ProdRef -and $v.env -eq "production") } catch { } }
if (-not $ok) { Write-Host "STOP: /api/version does not show $head / $ProdRef / production - use Vercel 'Instant Rollback' to the previous deployment if the site is wrong." -ForegroundColor Red; exit 1 }
Write-Host "RESULT: PRODUCTION FRONTEND $($head.Substring(0,7)) DEPLOYED (supabase_ref $ProdRef)" -ForegroundColor Green
