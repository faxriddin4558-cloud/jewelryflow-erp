<#
  GOLDIA SALES - set NEW passwords for the STAGING demo / smoke test accounts (Windows PowerShell 5.1 / 7, pure ASCII).

    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\staging-075\reset-staging-test-passwords.ps1

  * Staging only: Supabase project vouehtlmsunebracahon. The service role key is typed HIDDEN and must be the staging
    service key (its JWT says ref=vouehtlmsunebracahon, role=service_role); a production / JFS demo / ERP key or URL is
    refused before any request.
  * Only the listed accounts (default: director@goldia.uz, manager@goldia.uz, seller@goldia.uz) and only when the account
    is an employee of the organization "Goldia Jewelry Demo Staging". Nothing is deleted; e-mail, identity, employee row,
    role and organization are not changed.
  * For each account: shows the state (exists / banned_until / confirmed / identities / employee) WITHOUT secrets, asks the
    new password HIDDEN twice (min. 12 characters), sets it through the Supabase Auth admin API, then proves it with a real
    password login (HTTP status only). -Unban also lifts a ban (ban_duration "none") when the account is banned.
  * Passwords and the key exist only in memory of this PowerShell process: never printed, never written to a file or to
    the transcript, not put in an environment variable. Store the new passwords in your password manager; the smoke test
    (scripts\goldia-prod-smoke-readonly.js --target staging) asks for them hidden.
#>
param(
  [string[]]$Accounts = @("director@goldia.uz", "manager@goldia.uz", "seller@goldia.uz"),
  [switch]$Unban,
  [string]$LocalRehearsalUrl = "",        # test only: http://127.0.0.1:<port> (disposable local stack)
  [switch]$PasswordsFromEnvForTest        # test only, with -LocalRehearsalUrl: GOLDIA_TEST_KEY / GOLDIA_TEST_PW
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
$StagingRef = "vouehtlmsunebracahon"
$DemoOrg = "Goldia Jewelry Demo Staging"
$Forbidden = @("vrozlllcaxinavzxueif", "vrozlilcaxinavzxueif", "yvvbdoqncubtwlzskgml", "hbbuskyifxkowlozsaym")

function Stop-Now([string]$Why) { Write-Host ""; Write-Host ("STOPPED: " + $Why) -ForegroundColor Red; Write-Host "Nothing more was changed."; exit 1 }
function Plain([Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function JwtPayload([string]$jwt) {
  $p = $jwt.Split(".")
  if ($p.Count -lt 2) { return $null }
  $s = $p[1].Replace("-", "+").Replace("_", "/"); while ($s.Length % 4) { $s += "=" }
  try { return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) | ConvertFrom-Json) } catch { return $null }
}
function Call([string]$Method, [string]$Path, $Body, [string]$Key) {
  $h = @{ apikey = $Key; Authorization = ("Bearer " + $Key) }
  $args1 = @{ Method = $Method; Uri = ($Base + $Path); Headers = $h; ContentType = "application/json"; UseBasicParsing = $true; TimeoutSec = 60 }
  if ($null -ne $Body) { $args1.Body = ($Body | ConvertTo-Json -Compress -Depth 5) }
  try { $r = Invoke-WebRequest @args1; return @{ Code = [int]$r.StatusCode; Json = $(if ($r.Content) { $r.Content | ConvertFrom-Json } else { $null }) } }
  catch {
    $code = -1; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    return @{ Code = $code; Json = $null }
  }
}

# ---------------------------------------------------------------- target
$test = [bool]$LocalRehearsalUrl
if ($test) {
  if ($LocalRehearsalUrl -notmatch '^http://127\.0\.0\.1:\d+$') { Stop-Now "-LocalRehearsalUrl must be http://127.0.0.1:<port>" }
  $Base = $LocalRehearsalUrl
} else {
  if ($PasswordsFromEnvForTest) { Stop-Now "-PasswordsFromEnvForTest is accepted only with -LocalRehearsalUrl" }
  $Base = "https://" + $StagingRef + ".supabase.co"
}
foreach ($f in $Forbidden) { if ($Base -like ("*" + $f + "*")) { Stop-Now ($f + " is never a target") } }
Write-Host ("GOLDIA staging test-account passwords - target " + $Base) -ForegroundColor Cyan
$Accounts = @($Accounts | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
if (-not $Accounts.Count) { Stop-Now "no accounts" }

# ---------------------------------------------------------------- key (hidden)
if ($PasswordsFromEnvForTest) { $key = $env:GOLDIA_TEST_KEY } else { $key = Plain (Read-Host -AsSecureString ("Staging SERVICE ROLE key (" + $StagingRef + ", Dashboard > Settings > API; hidden)")) }
$pl = JwtPayload $key
if (-not $pl) { Stop-Now "the key is not a Supabase JWT" }
if (-not $test -and ($pl.ref -ne $StagingRef)) { Stop-Now ("the key belongs to project " + $pl.ref + ", not staging " + $StagingRef) }
if ($pl.role -ne "service_role") { Stop-Now ("the key role is " + $pl.role + ", the service_role key is needed") }

# ---------------------------------------------------------------- read-only state
$all = @()
for ($page = 1; $page -le 50; $page++) {
  $r = Call "GET" ("/auth/v1/admin/users?page=" + $page + "&per_page=200") $null $key
  if ($r.Code -ne 200) { Stop-Now ("cannot list Auth users (HTTP " + $r.Code + ")") }
  $u = @($r.Json.users); $all += $u
  if ($u.Count -lt 200) { break }
}
$org = Call "GET" ("/rest/v1/organizations?select=id,name&name=eq." + [Uri]::EscapeDataString($DemoOrg)) $null $key
if ($org.Code -ne 200 -or @($org.Json).Count -ne 1) { Stop-Now ("organization '" + $DemoOrg + "' not found exactly once") }
$orgId = @($org.Json)[0].id
$plan = @()
Write-Host ""
Write-Host "account                          exists banned_until          confirmed identities employee"
foreach ($a in $Accounts) {
  $u = @($all | Where-Object { $_.email -and $_.email.ToLowerInvariant() -eq $a })
  if ($u.Count -ne 1) { Write-Host ("{0,-32} NO" -f $a) -ForegroundColor Red; Stop-Now ($a + " does not exist exactly once in staging Auth") }
  $u = $u[0]
  $emp = Call "GET" ("/rest/v1/employees?select=role,is_active,organization_id&user_id=eq." + $u.id) $null $key
  $e = @($emp.Json | Where-Object { $_.organization_id -eq $orgId })
  $ban = $(if ($u.PSObject.Properties["banned_until"] -and $u.banned_until) { [string]$u.banned_until } else { "-" })
  $ids = $(if ($u.PSObject.Properties["identities"]) { @($u.identities).Count } else { 0 })
  $conf = [bool]($u.PSObject.Properties["email_confirmed_at"] -and $u.email_confirmed_at)
  $empTxt = $(if ($e.Count -eq 1) { $e[0].role + "/active=" + $e[0].is_active } else { "NOT IN " + $DemoOrg })
  Write-Host ("{0,-32} yes    {1,-21} {2,-9} {3,-10} {4}" -f $a, $ban, $conf, $ids, $empTxt)
  if ($e.Count -ne 1) { Stop-Now ($a + " is not an employee of '" + $DemoOrg + "' - refused (only demo staging accounts)") }
  $plan += @{ Email = $a; Id = $u.id; Banned = ($ban -ne "-" -and ([datetime]$ban) -gt (Get-Date).ToUniversalTime()); Confirmed = $conf }
}

# ---------------------------------------------------------------- set + verify
$results = @()
foreach ($p in $plan) {
  Write-Host ""
  Write-Host ("== " + $p.Email) -ForegroundColor Cyan
  if ($p.Banned -and -not $Unban) { Write-Host "  banned - run again with -Unban to lift the ban" -ForegroundColor Yellow }
  if ($PasswordsFromEnvForTest) { $pw = $env:GOLDIA_TEST_PW; $pw2 = $pw } else {
    $pw = Plain (Read-Host -AsSecureString "  new password (hidden, min. 12 characters)")
    $pw2 = Plain (Read-Host -AsSecureString "  repeat the new password (hidden)")
  }
  if ($pw -ne $pw2) { $pw = $null; $pw2 = $null; Stop-Now ("passwords for " + $p.Email + " do not match") }
  if ($pw.Length -lt 12) { $pw = $null; $pw2 = $null; Stop-Now "password shorter than 12 characters" }
  $body = @{ password = $pw }
  if (-not $p.Confirmed) { $body.email_confirm = $true }
  if ($p.Banned -and $Unban) { $body.ban_duration = "none" }
  $set = Call "PUT" ("/auth/v1/admin/users/" + $p.Id) $body $key
  $body = $null
  $login = Call "POST" "/auth/v1/token?grant_type=password" @{ email = $p.Email; password = $pw } $key
  $pw = $null; $pw2 = $null
  $ok = ($set.Code -eq 200 -and $login.Code -eq 200 -and $login.Json -and $login.Json.access_token)
  $sub = $null; if ($ok) { $sub = (JwtPayload $login.Json.access_token).sub }
  $ok = $ok -and ($sub -eq $p.Id)
  Write-Host ("  password set: HTTP " + $set.Code + "; real login: HTTP " + $login.Code + $(if ($ok) { " (token for this account)" } else { "" }) + " -> " + $(if ($ok) { "PASS" } else { "FAIL" })) -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
  $results += $ok
}
$key = $null
[GC]::Collect()
Write-Host ""
if ($results -contains $false) { Write-Host "RESULT: FAIL - see the lines above" -ForegroundColor Red; exit 1 }
Write-Host ("RESULT: PASS - " + $results.Count + " account(s) have the new password and log in. Run the staging smoke next.") -ForegroundColor Green
exit 0
