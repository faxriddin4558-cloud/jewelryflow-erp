<#
  GOLDIA SALES - deploy a release-candidate frontend to the STAGING Vercel project only (jewelryflow-sales-staging,
  Supabase vouehtlmsunebracahon). Pure ASCII (Windows PowerShell 5.1 reads a .ps1 without BOM as Windows-1252).
  Works with Windows PowerShell 5.1 and PowerShell 7, and with current Vercel CLI versions.

  DEPLOY (default; existing Vercel environment values are only READ, never changed):
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\staging-075\deploy-staging-frontend.ps1 -ReleaseCandidate <RC_SHA>

  DIAGNOSE ONLY (nothing is written anywhere; use it when `vercel deploy` stops with "Error: fetch failed"):
    ... deploy-staging-frontend.ps1 -Diagnose

  Safety design
  * Native commands (npx/vercel/git) never throw on stderr output (the "Vercel CLI x.y.z" banner is stderr):
    each runs through System.Diagnostics.Process and only its EXIT CODE decides success.
  * The checkout must be clean BEFORE `vercel link`. The only change undone automatically is the Vercel CLI appending
    ".vercel", ".env*.local" or ".env*" to the END of .gitignore (on Windows it cannot match the existing CRLF line):
      - during this run: the original .gitignore bytes are written back after every Vercel CLI step;
      - left over from an earlier stopped run: only if .gitignore is the single modified tracked file, HEAD's lines are
        unchanged at the top and every extra line is one of the Vercel lines -> `git checkout -- .gitignore`.
    Any other change stops the script untouched.
  * Environment (default): the Production environment of the project is pulled into %TEMP%, validated and deleted at
    once: NEXT_PUBLIC_SUPABASE_URL = staging, NEXT_PUBLIC_APP_ENV = staging, NEXT_PUBLIC_STAGING_MODE = true, readable
    Supabase keys belong to vouehtlmsunebracahon, no production / JFS demo / ERP value anywhere. Nothing is added,
    replaced or removed. The release SHA reaches the build with `--build-env NEXT_PUBLIC_GIT_COMMIT_SHA=<sha>`.
    -ReplaceEnv (explicit opt-in only) keeps the former behaviour: prompt for both keys, validate them live, replace
    the six variables in place with `vercel env add --force`.
  * Before deploying, the staging database must already have migration -RequireMigration (default 078): checked with a
    read-only PostgREST call that an anon key cannot execute (missing function = HTTP 404).
  * Deploy: `vercel deploy --prod`. The current staging deployment keeps serving until the new one is ready; a failed
    or interrupted deploy leaves it live. A network failure of the CLI ("fetch failed", ECONNRESET, ETIMEDOUT, UND_ERR)
    is retried at most twice (IPv4 first, then a single .tgz archive upload); every retry creates a new deployment,
    so retrying is safe.
  * Only the staging Supabase ref and only the Vercel project jewelryflow-sales-staging are accepted.
#>
param(
  [string]$ReleaseCandidate = "",
  [string]$ExpectedProjectId = "",
  [string]$Scope = "",
  [string]$VercelVersion = "latest",
  [string]$RequireMigration = "20260101000078",
  [switch]$ReplaceEnv,
  [switch]$Diagnose
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Continue"   # native stderr must never be fatal; failures are decided by exit codes
$ProjectName = "jewelryflow-sales-staging"
$StagingRef = "vouehtlmsunebracahon"
$StagingUrl = "https://$StagingRef.supabase.co"
$Forbidden = @{ "vrozlllcaxinavzxueif" = "PRODUCTION"; "vrozlilcaxinavzxueif" = "typo of the production ref"; "yvvbdoqncubtwlzskgml" = "JFS demo"; "hbbuskyifxkowlozsaym" = "ERP" }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$script:EnvChanged = $false

function Stop-Deploy([string]$Message) {
  Write-Host ""
  Write-Host "STOP: $Message" -ForegroundColor Red
  if ($script:EnvChanged) {
    Write-Host "Vercel environment variables may already hold the NEW validated staging values; the running staging deployment is unchanged." -ForegroundColor Yellow
  } else {
    Write-Host "Vercel environment variables were not changed; the running staging deployment is unchanged." -ForegroundColor Green
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

function Get-HttpStatus([string]$Url, [hashtable]$Headers, [string]$Method = "Get", [string]$Body = $null) {
  try {
    if ($Body) { $r = Invoke-WebRequest -Uri $Url -Headers $Headers -Method $Method -Body $Body -ContentType "application/json" -UseBasicParsing -TimeoutSec 30 }
    else { $r = Invoke-WebRequest -Uri $Url -Headers $Headers -Method $Method -UseBasicParsing -TimeoutSec 30 }
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

function Test-ForbiddenValue([string]$Name, [string]$Value) {
  foreach ($ref in $Forbidden.Keys) { if ($Value -and $Value.Contains($ref)) { Stop-Deploy "$Name contains the $($Forbidden[$ref]) reference ($ref)" } }
}

function Test-StagingKey([string]$Name, [string]$Key, [string]$Role) {
  if (-not $Key) { Stop-Deploy "$Name is empty" }
  Test-ForbiddenValue $Name $Key
  $claims = Get-JwtClaims $Key
  if ($claims) {
    $claimRef = $null; $claimRole = $null
    if ($claims.PSObject.Properties.Name -contains "ref") { $claimRef = $claims.ref }
    if ($claims.PSObject.Properties.Name -contains "role") { $claimRole = $claims.role }
    if ($Forbidden.ContainsKey([string]$claimRef)) { Stop-Deploy "$Name belongs to a $($Forbidden[[string]$claimRef]) project ($claimRef)" }
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

# ---------------- .gitignore restoration (same rules as production-075\production-frontend.ps1) ----------------
$GitignorePath = Join-Path (Get-Location).Path ".gitignore"
$AllowedVercelGitignoreLines = @(".vercel", ".vercel/", "/.vercel", "/.vercel/", ".env*.local", ".env*")
function Read-FileBytes([string]$Path) { if (Test-Path -LiteralPath $Path) { return ,([IO.File]::ReadAllBytes($Path)) }; return $null }
function Test-BytePrefix([byte[]]$Prefix, [byte[]]$Full) {
  if ($Prefix.Length -gt $Full.Length) { return $false }
  for ($i = 0; $i -lt $Prefix.Length; $i++) { if ($Prefix[$i] -ne $Full[$i]) { return $false } }
  return $true
}
# Undo ONLY an append of Vercel lines made during this run (original bytes written back); anything else: STOP.
function Restore-VercelGitignore([string]$Step) {
  $orig = $script:GitignoreOriginal
  $now = Read-FileBytes $GitignorePath
  if ($null -eq $orig -and $null -eq $now) { return }
  if ($null -ne $orig -and $null -ne $now -and $orig.Length -eq $now.Length -and (Test-BytePrefix $orig $now)) { return }
  if ($null -eq $now) { Stop-Deploy ".gitignore disappeared after $Step - inspect the folder" }
  $prefix = [byte[]]@(); if ($null -ne $orig) { $prefix = $orig }
  if (-not (Test-BytePrefix $prefix $now)) { Stop-Deploy ".gitignore was edited (not only appended) after $Step - inspect it; nothing was restored" }
  $added = [Text.Encoding]::UTF8.GetString($now, $prefix.Length, $now.Length - $prefix.Length)
  $lines = @($added -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
  foreach ($l in $lines) { if ($AllowedVercelGitignoreLines -notcontains $l) { Stop-Deploy "after $Step .gitignore got an unexpected line '$l' - inspect it; nothing was restored" } }
  if ($null -eq $orig) { Remove-Item -LiteralPath $GitignorePath -Force } else { [IO.File]::WriteAllBytes($GitignorePath, $orig) }
  $what = "blank lines"; if ($lines.Count -gt 0) { $what = ($lines -join ", ") }
  Write-Host "  .gitignore: Vercel CLI appended ($what) during $Step; original restored byte-for-byte" -ForegroundColor Yellow
}
# Repair what an EARLIER stopped run left behind (see header). Anything else: return / STOP, untouched.
function Repair-LeftoverVercelGitignore {
  $st = Invoke-Native "git" @("status", "--porcelain", "--untracked-files=no")
  if ($st.Code -ne 0) { Stop-Deploy "git status failed: $($st.Err.Trim())" }
  $changed = @($st.Out -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
  if ($changed.Count -ne 1 -or $changed[0].Trim() -ne "M .gitignore") { return }
  $headGi = Invoke-Native "git" @("show", "HEAD:.gitignore")
  if ($headGi.Code -ne 0) { Stop-Deploy "cannot read HEAD:.gitignore" }
  $headLines = @($headGi.Out -split "`r?`n")
  while ($headLines.Count -gt 0 -and $headLines[$headLines.Count - 1] -eq "") { $headLines = @($headLines[0..($headLines.Count - 2)]) }
  $nowLines = @([IO.File]::ReadAllText($GitignorePath) -split "`r?`n")
  if ($nowLines.Count -lt $headLines.Count) { Stop-Deploy ".gitignore differs from HEAD (lines removed) - inspect it with git diff; nothing was changed" }
  for ($i = 0; $i -lt $headLines.Count; $i++) { if ($nowLines[$i] -ne $headLines[$i]) { Stop-Deploy ".gitignore line $($i + 1) differs from HEAD - inspect it with git diff; nothing was changed" } }
  $extra = @()
  if ($nowLines.Count -gt $headLines.Count) { $extra = @($nowLines[$headLines.Count..($nowLines.Count - 1)] | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }) }
  foreach ($l in $extra) { if ($AllowedVercelGitignoreLines -notcontains $l) { Stop-Deploy ".gitignore has an extra line '$l' that Vercel does not add - inspect it with git diff; nothing was changed" } }
  Write-Host "  .gitignore differs from HEAD only by lines Vercel CLI appended in an earlier run:" -ForegroundColor Yellow
  foreach ($l in $extra) { Write-Host "    + $l" -ForegroundColor Yellow }
  $co = Invoke-Native "git" @("checkout", "--", ".gitignore")
  if ($co.Code -ne 0) { Stop-Deploy "git checkout -- .gitignore failed: $($co.Err.Trim())" }
  Write-Host "  .gitignore restored from HEAD (git checkout -- .gitignore)" -ForegroundColor Yellow
}

# ---------------- network diagnostics (read only; prints no token, no key, no proxy credentials) ----------------
function Invoke-NetworkDiagnostics {
  Write-Host "`n[diagnose] Vercel API reachability as the Vercel CLI sees it (Node fetch, no token sent)" -ForegroundColor Cyan
  $node = Invoke-Native "node" @("--version")
  Write-Host "  node $($node.Out.Trim())  (Vercel CLI uses Node's built-in fetch / undici, NOT the Windows proxy settings)"
  foreach ($n in @("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED")) {
    $val = [Environment]::GetEnvironmentVariable($n)
    if ($val) { Write-Host "  env $n is SET (value not printed)" -ForegroundColor Yellow } else { Write-Host "  env $n not set" }
  }
  try { $sys = [Net.WebRequest]::GetSystemWebProxy().GetProxy([Uri]"https://api.vercel.com"); if ($sys.Host -ne "api.vercel.com") { Write-Host "  Windows system proxy for api.vercel.com: $($sys.Host):$($sys.Port) (Node does not use it)" -ForegroundColor Yellow } else { Write-Host "  Windows system proxy: none" } } catch { }
  try { $ips = [Net.Dns]::GetHostAddresses("api.vercel.com") | ForEach-Object { "$($_.AddressFamily)=$($_)" }; Write-Host "  DNS api.vercel.com: $($ips -join ', ')" } catch { Write-Host "  DNS lookup failed: $($_.Exception.Message)" -ForegroundColor Red }
  # Node probes: unauthenticated GET (expect HTTP 403) and an 8 MB POST (expect 4xx) - default order and IPv4 first
  $probe = @'
const big = Buffer.alloc(8 * 1024 * 1024, 97);
const one = async (label, init) => { const t = Date.now(); try { const r = await fetch('https://api.vercel.com/v2/files', init); console.log(label + ': HTTP ' + r.status + ' in ' + (Date.now() - t) + ' ms'); }
  catch (e) { const c = e && e.cause ? e.cause : {}; console.log(label + ': FAILED ' + (e && e.message) + ' cause=' + (c.code || c.name || '-') + ' ' + (c.message || '') + ' after ' + (Date.now() - t) + ' ms'); } };
(async () => { await one('GET  small', { method: 'GET' }); await one('POST 8 MB', { method: 'POST', body: big, headers: { 'content-type': 'application/octet-stream' } }); })();
'@
  $tmpJs = Join-Path $env:TEMP ("goldia-vercel-probe-" + [Guid]::NewGuid().ToString("N") + ".js")
  [IO.File]::WriteAllText($tmpJs, $probe, (New-Object Text.UTF8Encoding($false)))
  try {
    foreach ($mode in @("default", "ipv4first")) {
      $old = $env:NODE_OPTIONS
      if ($mode -eq "ipv4first") { $env:NODE_OPTIONS = (("" + $old) + " --dns-result-order=ipv4first").Trim() }
      $r = Invoke-Native "node" @($tmpJs)
      $env:NODE_OPTIONS = $old
      foreach ($l in (($r.Out + $r.Err) -split "`r?`n" | Where-Object { $_.Trim() })) { Write-Host "  [$mode] $l" }
    }
  } finally { Remove-Item -LiteralPath $tmpJs -Force -ErrorAction SilentlyContinue }
  Write-Host "  How to read it: 403 / 4xx = Vercel API reachable (no token was sent). FAILED with cause ECONNRESET /"
  Write-Host "  UND_ERR_SOCKET on the 8 MB POST only = something on the path (antivirus HTTPS scanning, firewall, VPN)"
  Write-Host "  cuts larger uploads; ETIMEDOUT / UND_ERR_CONNECT_TIMEOUT only in [default] = broken IPv6 route (the deploy"
  Write-Host "  retry uses IPv4 first); SELF_SIGNED_CERT / UNABLE_TO_GET_ISSUER = TLS inspection (set NODE_EXTRA_CA_CERTS"
  Write-Host "  to the company root certificate, never NODE_TLS_REJECT_UNAUTHORIZED=0)."
  $ver = Invoke-Vercel @("--version")
  Write-Host ("  Vercel CLI: " + ((($ver.Out + " " + $ver.Err) -replace '\s+', ' ').Trim()))
  $who = Invoke-Vercel @("whoami")
  if ($who.Code -eq 0) { Write-Host "  Vercel login: $($who.Out.Trim())" -ForegroundColor Green } else { Write-Host "  Vercel login: NOT logged in (npx vercel@latest login)" -ForegroundColor Red }
}

function Test-NetworkFailure([string]$Text) { return ($Text -match "fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR|socket hang up|network") }

Write-Host "GOLDIA SALES - staging frontend $(if ($Diagnose) { 'DIAGNOSE (read only)' } else { 'deploy' }) ($ProjectName, Supabase $StagingRef)" -ForegroundColor Cyan
Write-Host "PowerShell $($PSVersionTable.PSVersion)"
if ($Diagnose) {
  Invoke-NetworkDiagnostics
  Write-Host "`nRESULT: DIAGNOSE DONE - nothing was changed (no link, no env, no deploy)." -ForegroundColor Green
  exit 0
}
if (-not $ReleaseCandidate) { Stop-Deploy "-ReleaseCandidate <sha> is required (or use -Diagnose)" }

# ---------------- Phase 1: read-only checks ----------------
Write-Host "`n[1/6] release-candidate checkout"
$g = Invoke-Native "git" @("rev-parse", "HEAD")
if ($g.Code -ne 0) { Stop-Deploy "git rev-parse failed: $($g.Err)" }
$head = $g.Out.Trim()
if (-not $head.StartsWith($ReleaseCandidate.Trim())) { Stop-Deploy "HEAD $head is not the release candidate $ReleaseCandidate" }
Repair-LeftoverVercelGitignore
$st = Invoke-Native "git" @("status", "--porcelain", "--untracked-files=no")
if ($st.Code -ne 0 -or $st.Out.Trim()) { Stop-Deploy "tracked files are modified - use a clean checkout of the release candidate:`n$($st.Out.Trim())" }
$mig = @(Get-ChildItem -Path "supabase\migrations" -Filter "$($RequireMigration)_*.sql" -ErrorAction SilentlyContinue)
if ($mig.Count -ne 1) { Stop-Deploy "migration $RequireMigration is not in this checkout" }
Write-Host "  HEAD $head (clean), contains $($mig[0].Name)" -ForegroundColor Green

Write-Host "`n[2/6] Vercel CLI and login"
$ver = Invoke-Vercel @("--version")
if ($ver.Code -ne 0) { Stop-Deploy "Vercel CLI did not start (exit $($ver.Code)): $($ver.Err.Trim())" }
Write-Host ("  " + ((($ver.Out + " " + $ver.Err) -replace '\s+', ' ').Trim()))
if ($ReplaceEnv) {
  $help = Invoke-Vercel @("env", "add", "--help")
  if ((($help.Out + $help.Err) -notmatch "--force")) { Stop-Deploy "this Vercel CLI has no 'env add --force'; run with -VercelVersion latest" }
}
$who = Invoke-Vercel @("whoami")
if ($who.Code -ne 0) { Stop-Deploy "not logged in to Vercel (run: npx vercel@latest login)" }
Write-Host "  logged in as: $($who.Out.Trim())" -ForegroundColor Green

Write-Host "`n[3/6] link to $ProjectName"
$before = $null
if (Test-Path ".vercel\project.json") { $before = (Get-Content ".vercel\project.json" -Raw | ConvertFrom-Json) }
$script:GitignoreOriginal = Read-FileBytes $GitignorePath
$link = Invoke-Vercel @("link", "--yes", "--project", $ProjectName)
Restore-VercelGitignore "vercel link"
if ($link.Code -ne 0) { Stop-Deploy "vercel link failed (exit $($link.Code)): $($link.Err.Trim())" }
$linked = Get-Content ".vercel\project.json" -Raw | ConvertFrom-Json
if ($linked.PSObject.Properties.Name -contains "projectName" -and $linked.projectName -and $linked.projectName -ne $ProjectName) { Stop-Deploy "linked project is '$($linked.projectName)', not $ProjectName" }
if ($ExpectedProjectId -and $linked.projectId -ne $ExpectedProjectId) { Stop-Deploy "linked project id $($linked.projectId) differs from -ExpectedProjectId $ExpectedProjectId" }
if ($before -and $before.projectId -ne $linked.projectId) { Stop-Deploy "this folder was linked to project $($before.projectId), now $($linked.projectId) - check the project before deploying" }
Write-Host "  project $ProjectName id=$($linked.projectId)" -ForegroundColor Green

Write-Host "`n[4/6] staging environment (read, validated, temp file deleted - nothing changed)"
$tmp = Join-Path $env:TEMP ("goldia-stg-env-" + [Guid]::NewGuid().ToString("N") + ".env")
$vars = @{}
try {
  $pull = Invoke-Vercel @("env", "pull", $tmp, "--environment=production", "--yes")
  if ($pull.Code -ne 0 -or -not (Test-Path $tmp)) { Stop-Deploy "vercel env pull failed: $(($pull.Err + $pull.Out).Trim())" }
  foreach ($line in (Get-Content $tmp)) { if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim().Trim('"') } }
} finally { if (Test-Path $tmp) { Remove-Item $tmp -Force } }
Restore-VercelGitignore "vercel env pull"
Write-Host "  temporary env file removed"
foreach ($k in @($vars.Keys)) { Test-ForbiddenValue $k ([string]$vars[$k]) }
$get = { param($n) if ($vars.ContainsKey($n)) { [string]$vars[$n] } else { "" } }
if ((& $get "NEXT_PUBLIC_SUPABASE_URL") -ne $StagingUrl) { Stop-Deploy "NEXT_PUBLIC_SUPABASE_URL is '$(& $get "NEXT_PUBLIC_SUPABASE_URL")', expected $StagingUrl" }
if ((& $get "NEXT_PUBLIC_APP_ENV") -ne "staging") { Stop-Deploy "NEXT_PUBLIC_APP_ENV is '$(& $get "NEXT_PUBLIC_APP_ENV")', expected staging" }
if ((& $get "NEXT_PUBLIC_STAGING_MODE") -ne "true") { Stop-Deploy "NEXT_PUBLIC_STAGING_MODE is '$(& $get "NEXT_PUBLIC_STAGING_MODE")', expected true" }
Write-Host "  URL / APP_ENV / STAGING_MODE = staging" -ForegroundColor Green
$anonForCheck = ""
foreach ($pair in @(@("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"), @("SUPABASE_SERVICE_ROLE_KEY", "service_role"))) {
  $k = $pair[0]; $val = & $get $k
  if (-not $vars.ContainsKey($k)) { if (-not $ReplaceEnv) { Stop-Deploy "$k is not defined in the Production environment of $ProjectName" }; continue }
  if (-not $val) { Write-Host "  $k : defined, value not readable (sensitive) - kept as it is" -ForegroundColor Yellow; continue }
  $c = Get-JwtClaims $val
  if ($c -and ($c.PSObject.Properties.Name -contains "ref") -and $c.ref -ne $StagingRef) { Stop-Deploy "$k belongs to '$($c.ref)', not staging" }
  if ($c -and ($c.PSObject.Properties.Name -contains "role") -and $c.role -ne $pair[1]) { Stop-Deploy "$k has role '$($c.role)', expected '$($pair[1])'" }
  Write-Host "  $k : staging $($pair[1]) key (kept)" -ForegroundColor Green
  if ($pair[1] -eq "anon") { $anonForCheck = $val }
}
$oldSha = & $get "NEXT_PUBLIC_GIT_COMMIT_SHA"
if ($oldSha -and $oldSha -ne $head) { Write-Host "  NEXT_PUBLIC_GIT_COMMIT_SHA in the project = $($oldSha.Substring(0, [Math]::Min(7, $oldSha.Length))) (kept); this build gets $($head.Substring(0, 7)) via --build-env" }
$vars = $null

# staging database must already be at -RequireMigration (read only: anon cannot execute the function -> 401/403;
# a missing function -> 404). Uses the pulled anon key, or the public anon key of the live staging site if sensitive.
if ($RequireMigration -eq "20260101000078") {
  $probeKey = $anonForCheck
  if (-not $probeKey) { Write-Host "  (anon key not readable - skipping the database 078 probe; the release script postflight covers it)" -ForegroundColor Yellow }
  else {
    $code = Get-HttpStatus "$StagingUrl/rest/v1/rpc/rpc_reopen_report_period" @{ apikey = $probeKey; Authorization = "Bearer $probeKey" } "Post" '{"p_period_id":"00000000-0000-0000-0000-000000000000"}'
    if ($code -eq 404) { Stop-Deploy "staging database has no 078 function rpc_reopen_report_period (HTTP 404) - apply 078 first" }
    if ($code -lt 0) { Stop-Deploy "cannot reach the staging API for the 078 probe" }
    Write-Host "  staging database: 078 function present (anon refused with HTTP $code, nothing executed)" -ForegroundColor Green
  }
}
$anonForCheck = $null

# ---------------- Phase 2 (opt-in only): replace values in place ----------------
if ($ReplaceEnv) {
  Write-Host "`n[5/6] -ReplaceEnv: new values (validated before anything is written)"
  $anon = Read-Secret "Staging ANON key ($StagingRef) - Supabase Dashboard > Settings > API"
  Test-StagingKey "NEXT_PUBLIC_SUPABASE_ANON_KEY" $anon "anon"
  $service = Read-Secret "Staging SERVICE ROLE key ($StagingRef)"
  Test-StagingKey "SUPABASE_SERVICE_ROLE_KEY" $service "service_role"
  if ($anon -eq $service) { Stop-Deploy "anon and service keys are identical" }
  $values = [ordered]@{
    "NEXT_PUBLIC_SUPABASE_URL"      = $StagingUrl
    "NEXT_PUBLIC_APP_ENV"           = "staging"
    "NEXT_PUBLIC_STAGING_MODE"      = "true"
    "NEXT_PUBLIC_GIT_COMMIT_SHA"    = $head
    "NEXT_PUBLIC_SUPABASE_ANON_KEY" = $anon
    "SUPABASE_SERVICE_ROLE_KEY"     = $service
  }
  foreach ($k in $values.Keys) { Test-ForbiddenValue $k ([string]$values[$k]) }
  foreach ($k in $values.Keys) {
    $r = Invoke-Vercel @("env", "add", $k, "production", "--force") ([string]$values[$k])
    Restore-VercelGitignore "vercel env add $k"
    if ($r.Code -ne 0) { Stop-Deploy "could not set $k (exit $($r.Code)): $(($r.Err + $r.Out).Trim())" }
    $script:EnvChanged = $true
    Write-Host "  $k : set" -ForegroundColor Green
  }
  $anon = $null; $service = $null; $values = $null
} else {
  Write-Host "`n[5/6] environment variables: kept unchanged (no -ReplaceEnv)" -ForegroundColor Green
}

# ---------------- Phase 3: deploy (retried only on network failures) and verify ----------------
Write-Host "`n[6/6] production deployment of $ProjectName from $head (the current deployment stays live until this one is ready)"
Restore-VercelGitignore "deploy pre-check"
$dirty = (Invoke-Native "git" @("status", "--porcelain", "--untracked-files=no")).Out.Trim()
if ($dirty) { Stop-Deploy "tracked files are modified before deploy:`n$dirty" }
$attempts = @(
  @{ Label = "attempt 1"; Ipv4 = $false; Extra = @() },
  @{ Label = "attempt 2 (IPv4 first)"; Ipv4 = $true; Extra = @() },
  @{ Label = "attempt 3 (IPv4 first, one .tgz archive upload)"; Ipv4 = $true; Extra = @("--archive=tgz") }
)
$dep = $null
foreach ($a in $attempts) {
  Write-Host "  $($a.Label)"
  $oldNodeOptions = $env:NODE_OPTIONS
  if ($a.Ipv4) { $env:NODE_OPTIONS = (("" + $oldNodeOptions) + " --dns-result-order=ipv4first").Trim() }
  $dep = Invoke-Vercel (@("deploy", "--prod", "--yes", "--build-env", "NEXT_PUBLIC_GIT_COMMIT_SHA=$head") + $a.Extra) -Show
  $env:NODE_OPTIONS = $oldNodeOptions
  Restore-VercelGitignore "vercel deploy ($($a.Label))"
  if ($dep.Code -eq 0) { break }
  if (-not (Test-NetworkFailure ($dep.Err + " " + $dep.Out))) { Stop-Deploy "vercel deploy failed (exit $($dep.Code)), not a network error; the previous staging deployment is still live" }
  Write-Host "  network failure of the Vercel CLI; the previous staging deployment is still live" -ForegroundColor Yellow
  Start-Sleep -Seconds 15
}
if ($dep.Code -ne 0) { Stop-Deploy "vercel deploy failed 3 times with a network error; run this script with -Diagnose and send its output" }

$ok = $false; $v = $null
for ($i = 0; $i -lt 18 -and -not $ok; $i++) {
  Start-Sleep -Seconds 10
  try {
    $v = Invoke-RestMethod -Uri "https://$ProjectName.vercel.app/api/version" -UseBasicParsing -TimeoutSec 30
    # the SHA must be the release candidate baked into THIS build (sha_source "build"), not a fallback
    $ok = ($v.full_commit -eq $head -and $v.supabase_ref -eq $StagingRef -and $v.env -eq "staging" -and $v.sha_source -eq "build")
  } catch { $v = $null }
}
if ($v) { $v | Format-List | Out-String | Write-Host }
if (-not $ok) {
  if ($v -and $oldSha -and $v.full_commit -eq $oldSha) { Stop-Deploy "/api/version still shows the project's NEXT_PUBLIC_GIT_COMMIT_SHA $oldSha - the new build may not be live yet; check the Vercel dashboard" }
  Stop-Deploy "/api/version does not show $head / $StagingRef / staging yet - check the deployment in the Vercel dashboard"
}
Write-Host "RESULT: STAGING FRONTEND $($head.Substring(0, 7)) DEPLOYED (project $ProjectName, supabase_ref $StagingRef; environment unchanged)" -ForegroundColor Green
exit 0
