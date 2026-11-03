<#
  GOLDIA SALES - deploy the 075 release-candidate frontend to the STAGING Vercel project only.
  Works with Windows PowerShell 5.1 and PowerShell 7, and with current Vercel CLI versions.

  Run from a clean checkout of the release candidate, AFTER staging is at 075:
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\staging-075\deploy-staging-frontend.ps1 -ReleaseCandidate <RC_SHA>

  Safety design
  * Native commands (npx/vercel/git) never throw on stderr output (the "Vercel CLI x.y.z" banner is stderr):
    each runs through System.Diagnostics.Process and only its EXIT CODE decides success.
  * Phase 1 (read only, nothing in Vercel changes): checkout = RC, Vercel login, link to jewelryflow-sales-staging,
    CLI supports `env add --force`, and BOTH new keys are validated before anything is written:
      - JWT keys: payload ref must be vouehtlmsunebracahon, role anon / service_role;
      - live check against the staging API: the anon key is accepted by staging Auth but refused by the admin API,
        the service key is accepted by the admin API (a production or JFS key is refused by the staging project).
  * Phase 2: every variable is REPLACED in place with `vercel env add <name> production --force` (value via stdin,
    never on the command line). Nothing is removed first, so an interruption leaves each variable either at its old
    or at its new (validated, staging) value - never missing.
  * Phase 3: `vercel deploy --prod`. Environment changes only affect new builds; until the new deployment is ready
    the current staging deployment keeps serving. An interrupted or failed deploy leaves the old deployment live.
  * Only the staging Supabase ref and only the Vercel project jewelryflow-sales-staging are accepted. Values of
    production (vrozlllcaxinavzxueif) or the JFS demo (yvvbdoqncubtwlzskgml) stop the script before any write.
#>
param(
  [Parameter(Mandatory = $true)][string]$ReleaseCandidate,
  [string]$ExpectedProjectId = "",
  [string]$Scope = "",
  [string]$VercelVersion = "latest"
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Continue"   # native stderr must never be fatal; failures are decided by exit codes
$ProjectName = "jewelryflow-sales-staging"
$StagingRef = "vouehtlmsunebracahon"
$StagingUrl = "https://$StagingRef.supabase.co"
$ForbiddenRefs = @("vrozlllcaxinavzxueif", "yvvbdoqncubtwlzskgml")
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Stop-Deploy([string]$Message, [bool]$Changed = $false) {
  Write-Host ""
  Write-Host "STOP: $Message" -ForegroundColor Red
  if ($Changed) {
    Write-Host "Vercel environment variables may already hold the NEW validated staging values; the running staging deployment is unchanged." -ForegroundColor Yellow
    Write-Host "Re-running this script is safe (it only replaces values in place)." -ForegroundColor Yellow
  } else {
    Write-Host "Nothing was changed in Vercel." -ForegroundColor Green
  }
  exit 1
}

function Quote-Arg([string]$a) {
  if ($a -match '[\s"&|<>^]') { return '"' + ($a -replace '"', '\"') + '"' }
  return $a
}

# Runs a native command; returns @{ Code; Out; Err }. Never throws because of stderr.
function Invoke-Native([string]$Exe, [string[]]$Arguments, [string]$StdIn = $null, [switch]$Show) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = '/d /s /c "' + ((@($Exe) + $Arguments | ForEach-Object { Quote-Arg $_ }) -join ' ') + '"'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  if ($StdIn) { $p.StandardInput.Write($StdIn) }
  $p.StandardInput.Close()
  $p.WaitForExit()
  $res = @{ Code = $p.ExitCode; Out = $outTask.Result; Err = $errTask.Result }
  if ($Show) {
    if ($res.Out) { Write-Host $res.Out.TrimEnd() }
    if ($res.Err) { Write-Host $res.Err.TrimEnd() -ForegroundColor DarkGray }
  }
  return $res
}

$VercelPkg = "vercel@$VercelVersion"
function Invoke-Vercel([string[]]$Arguments, [string]$StdIn = $null, [switch]$Show) {
  $scopeArgs = @(); if ($Scope) { $scopeArgs = @("--scope", $Scope) }
  return Invoke-Native "npx.cmd" (@("--yes", $VercelPkg) + $Arguments + $scopeArgs) $StdIn -Show:$Show
}

function Get-JwtClaims([string]$Jwt) {
  $parts = $Jwt.Split(".")
  if ($parts.Length -ne 3) { return $null }
  $b = $parts[1].Replace("-", "+").Replace("_", "/")
  while ($b.Length % 4) { $b += "=" }
  try { return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) | ConvertFrom-Json) } catch { return $null }
}

function Get-HttpStatus([string]$Url, [hashtable]$Headers) {
  try {
    $r = Invoke-WebRequest -Uri $Url -Headers $Headers -Method Get -UseBasicParsing -TimeoutSec 30
    return [int]$r.StatusCode
  } catch {
    $prop = $_.Exception.PSObject.Properties["Response"]
    if ($prop -and $prop.Value) { return [int]$prop.Value.StatusCode }
    return -1
  }
}

function Read-Secret([string]$Prompt) {
  $sec = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Test-StagingKey([string]$Name, [string]$Key, [string]$Role) {
  if (-not $Key) { Stop-Deploy "$Name is empty" }
  foreach ($ref in $ForbiddenRefs) { if ($Key.Contains($ref)) { Stop-Deploy "$Name contains a production/JFS reference" } }
  $claims = Get-JwtClaims $Key
  if ($claims) {
    $claimRef = $null; $claimRole = $null
    if ($claims.PSObject.Properties.Name -contains "ref") { $claimRef = $claims.ref }
    if ($claims.PSObject.Properties.Name -contains "role") { $claimRole = $claims.role }
    if ($ForbiddenRefs -contains $claimRef) { Stop-Deploy "$Name belongs to a production/JFS project ($claimRef)" }
    if ($claimRef -ne $StagingRef) { Stop-Deploy "$Name belongs to '$claimRef', not staging ($StagingRef)" }
    if ($claimRole -ne $Role) { Stop-Deploy "$Name has role '$claimRole', expected '$Role'" }
  } elseif ($Role -eq "anon" -and -not $Key.StartsWith("sb_publishable_")) {
    Stop-Deploy "$Name is neither a JWT nor an sb_publishable_ key"
  } elseif ($Role -eq "service_role" -and -not $Key.StartsWith("sb_secret_")) {
    Stop-Deploy "$Name is neither a JWT nor an sb_secret_ key"
  }
  # live proof that the key belongs to the staging project (a key of another project is refused here)
  $settings = Get-HttpStatus "$StagingUrl/auth/v1/settings" @{ apikey = $Key }
  if ($settings -ne 200) { Stop-Deploy "$Name is not accepted by staging Auth (HTTP $settings)" }
  $admin = Get-HttpStatus "$StagingUrl/auth/v1/admin/users?per_page=1" @{ apikey = $Key; Authorization = "Bearer $Key" }
  if ($Role -eq "anon" -and $admin -eq 200) { Stop-Deploy "$Name has admin rights - this is a service key, not the anon key" }
  if ($Role -eq "service_role" -and $admin -ne 200) { Stop-Deploy "$Name is not a staging service key (admin API HTTP $admin)" }
  Write-Host "  $Name : staging $Role key verified (JWT ref + live staging API)" -ForegroundColor Green
}

Write-Host "GOLDIA SALES - staging frontend deploy ($ProjectName, Supabase $StagingRef)" -ForegroundColor Cyan
Write-Host "PowerShell $($PSVersionTable.PSVersion)"

# ---------------- Phase 1: read-only checks (nothing in Vercel changes) ----------------
Write-Host "`n[1/6] release-candidate checkout"
$g = Invoke-Native "git" @("rev-parse", "HEAD")
if ($g.Code -ne 0) { Stop-Deploy "git rev-parse failed: $($g.Err)" }
$head = $g.Out.Trim()
if (-not $ReleaseCandidate -or -not $head.StartsWith($ReleaseCandidate.Trim())) { Stop-Deploy "HEAD $head is not the release candidate $ReleaseCandidate" }
$st = Invoke-Native "git" @("status", "--porcelain", "--untracked-files=no")
if ($st.Code -ne 0 -or $st.Out.Trim()) { Stop-Deploy "tracked files are modified - use a clean checkout of the release candidate" }
if (-not (Test-Path "supabase\migrations\20260101000075_goldia_customer_codes_per_org_and_factory_settings_isolation.sql")) { Stop-Deploy "075 migration is not in this checkout" }
Write-Host "  HEAD $head (clean)" -ForegroundColor Green

Write-Host "`n[2/6] Vercel CLI and login"
$ver = Invoke-Vercel @("--version")
if ($ver.Code -ne 0) { Stop-Deploy "Vercel CLI did not start (exit $($ver.Code)): $($ver.Err.Trim())" }
$verText = (($ver.Out + " " + $ver.Err) -replace '\s+', ' ').Trim()
Write-Host "  $verText"
$help = Invoke-Vercel @("env", "add", "--help")
if ((($help.Out + $help.Err) -notmatch "--force")) { Stop-Deploy "this Vercel CLI has no 'env add --force' (needed to replace values without deleting them); run with -VercelVersion latest" }
$who = Invoke-Vercel @("whoami")
if ($who.Code -ne 0) { Stop-Deploy "not logged in to Vercel (run: npx vercel@latest login)" }
Write-Host "  logged in as: $($who.Out.Trim())" -ForegroundColor Green

Write-Host "`n[3/6] link to $ProjectName"
$before = $null
if (Test-Path ".vercel\project.json") { $before = (Get-Content ".vercel\project.json" -Raw | ConvertFrom-Json) }
$link = Invoke-Vercel @("link", "--yes", "--project", $ProjectName)
if ($link.Code -ne 0) { Stop-Deploy "vercel link failed (exit $($link.Code)): $($link.Err.Trim())" }
$linked = Get-Content ".vercel\project.json" -Raw | ConvertFrom-Json
if ($linked.PSObject.Properties.Name -contains "projectName" -and $linked.projectName -and $linked.projectName -ne $ProjectName) { Stop-Deploy "linked project is '$($linked.projectName)', not $ProjectName" }
if ($ExpectedProjectId -and $linked.projectId -ne $ExpectedProjectId) { Stop-Deploy "linked project id $($linked.projectId) differs from -ExpectedProjectId $ExpectedProjectId" }
if ($before -and $before.projectId -ne $linked.projectId) { Stop-Deploy "this folder was linked to project $($before.projectId), now $($linked.projectId) - check the project before deploying" }
Write-Host "  project $ProjectName id=$($linked.projectId)" -ForegroundColor Green

Write-Host "`n[4/6] new values (validated before anything is written)"
$anon = Read-Secret "Staging ANON key ($StagingRef) - Supabase Dashboard > Settings > API"
Test-StagingKey "NEXT_PUBLIC_SUPABASE_ANON_KEY" $anon "anon"
$service = Read-Secret "Staging SERVICE ROLE key ($StagingRef)"
Test-StagingKey "SUPABASE_SERVICE_ROLE_KEY" $service "service_role"
if ($anon -eq $service) { Stop-Deploy "anon and service keys are identical" }
$values = [ordered]@{
  "NEXT_PUBLIC_SUPABASE_URL"      = $StagingUrl
  "NEXT_PUBLIC_APP_ENV"           = "staging"
  "NEXT_PUBLIC_STAGING_MODE"      = "true"
  "NEXT_PUBLIC_GIT_COMMIT_SHA"    = $head      # replaces the stale hand-written da6e930
  "NEXT_PUBLIC_SUPABASE_ANON_KEY" = $anon
  "SUPABASE_SERVICE_ROLE_KEY"     = $service
}
foreach ($k in $values.Keys) { foreach ($ref in $ForbiddenRefs) { if ([string]$values[$k] -match $ref) { Stop-Deploy "$k contains a production/JFS reference" } } }

# ---------------- Phase 2: replace values in place (no deletion) ----------------
Write-Host "`n[5/6] Production environment of $ProjectName (replace in place, nothing removed)"
$changed = $false
foreach ($k in $values.Keys) {
  $r = Invoke-Vercel @("env", "add", $k, "production", "--force") ([string]$values[$k])
  if ($r.Code -ne 0) { Stop-Deploy "could not set $k (exit $($r.Code)): $(($r.Err + $r.Out).Trim())" $changed }
  $changed = $true
  Write-Host "  $k : set" -ForegroundColor Green
}
$ls = Invoke-Vercel @("env", "ls", "production")
if ($ls.Code -ne 0) { Stop-Deploy "vercel env ls failed (exit $($ls.Code))" $changed }
foreach ($k in $values.Keys) { if (($ls.Out + $ls.Err) -notmatch [regex]::Escape($k)) { Stop-Deploy "$k is not listed after setting it" $changed } }
Write-Host "  all 6 variables present" -ForegroundColor Green
$anon = $null; $service = $null; $values = $null

# ---------------- Phase 3: deploy and verify ----------------
Write-Host "`n[6/6] production deployment of $ProjectName from $head (the current deployment stays live until this one is ready)"
$dep = Invoke-Vercel @("deploy", "--prod", "--yes", "--build-env", "NEXT_PUBLIC_GIT_COMMIT_SHA=$head") -Show
if ($dep.Code -ne 0) { Stop-Deploy "vercel deploy failed (exit $($dep.Code)); the previous staging deployment is still live" $changed }

$ok = $false
for ($i = 0; $i -lt 12 -and -not $ok; $i++) {
  Start-Sleep -Seconds 10
  try {
    $v = Invoke-RestMethod -Uri "https://$ProjectName.vercel.app/api/version" -UseBasicParsing -TimeoutSec 30
    $ok = ($v.full_commit -eq $head -and $v.supabase_ref -eq $StagingRef -and $v.env -eq "staging")
  } catch { $v = $null }
}
if ($v) { $v | Format-List | Out-String | Write-Host }
if (-not $ok) { Stop-Deploy "/api/version does not show $head / $StagingRef / staging yet - check the deployment in the Vercel dashboard" $changed }
Write-Host "RESULT: STAGING FRONTEND $($head.Substring(0, 7)) DEPLOYED (project $ProjectName, supabase_ref $StagingRef)" -ForegroundColor Green
exit 0
