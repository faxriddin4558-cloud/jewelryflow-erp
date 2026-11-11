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
    new password HIDDEN twice (min. 14 characters since 2026-11-11), sets it through the Supabase Auth admin API, then proves it with a real
    password login (HTTP status only). -Unban also lifts a ban (ban_duration "none") when the account is banned.
  * Passwords and the key exist only in memory of this PowerShell process: never printed, never written to a file or to
    the transcript, not put in an environment variable. Store the new passwords in your password manager; the smoke test
    (scripts\goldia-prod-smoke-readonly.js --target staging) asks for them hidden.
#>
  2026-11-11 hardening:
  * Allow-list: ONLY director@goldia.uz (admin), manager@goldia.uz (production_manager), seller@goldia.uz (sales); any
    other account, or a different employee role / inactive employee / second employee row, is refused before any change.
  * -DryRun: shows the state and stops (no change). Without it the script asks you to type the confirmation phrase
    "STAGING vouehtlmsunebracahon" after the state table; anything else stops before the first change.
  * The admin request changes ONLY the password. An unconfirmed or banned account STOPS (nothing is set) unless -Unban.
  * Password rules: min. 14 characters, at least 3 of lower / upper / digit / symbol, must not contain the e-mail name,
    typed twice hidden, the three passwords must differ.
  * The key may be the legacy service_role JWT (ref checked) or a new sb_secret_ key; the URL is fixed to staging, so a
    key of any other project is refused by Supabase (HTTP 401) before anything is changed.
  * After the change: the Auth id / e-mail / confirmation / ban state and the employee role / organization / active flag
    are read again and must be unchanged; the proof login's session is signed out again.
#>
param(
  [string[]]$Accounts = @("director@goldia.uz", "manager@goldia.uz", "seller@goldia.uz"),
  [switch]$DryRun,
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
  $h = @{ apikey = $Key }
  if (-not $Key.StartsWith("sb_")) { $h.Authorization = ("Bearer " + $Key) }   # sb_secret_ keys go in apikey only
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
$Accounts = @($Accounts | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | Select-Object -Unique)
if (-not $Accounts.Count) { Stop-Now "no accounts" }
$Allowed = @{ "director@goldia.uz" = "admin"; "manager@goldia.uz" = "production_manager"; "seller@goldia.uz" = "sales" }
foreach ($a in $Accounts) { if (-not $Allowed.ContainsKey($a)) { Stop-Now ($a + " is not on the allow-list (director@ / manager@ / seller@goldia.uz)") } }
function Test-Strong([string]$pw, [string]$email) {
  if ($pw.Length -lt 14) { return "shorter than 14 characters" }
  $cls = 0
  if ($pw -cmatch '[a-z]') { $cls++ }; if ($pw -cmatch '[A-Z]') { $cls++ }; if ($pw -match '[0-9]') { $cls++ }; if ($pw -match '[^A-Za-z0-9]') { $cls++ }
  if ($cls -lt 3) { return "needs at least 3 of: lower case, upper case, digit, symbol" }
  $name = $email.Split("@")[0]
  if ($pw.ToLowerInvariant().Contains($name)) { return "must not contain the e-mail name" }
  if ($pw.ToLowerInvariant().Contains("goldia")) { return "must not contain 'goldia'" }
  return $null
}

# ---------------------------------------------------------------- key (hidden)
if ($PasswordsFromEnvForTest) { $key = $env:GOLDIA_TEST_KEY } else { $key = Plain (Read-Host -AsSecureString ("Staging SERVICE ROLE key (" + $StagingRef + ", Dashboard > Settings > API; hidden)")) }
if (-not $key) { Stop-Now "no key" }
foreach ($f in $Forbidden) { if ($key.Contains($f)) { Stop-Now "the key mentions a forbidden project" } }
if ($key.StartsWith("sb_secret_")) {
  Write-Host "key format: sb_secret_ (project proven by the staging URL accepting it below)"
} elseif ($key.StartsWith("sb_publishable_")) {
  Stop-Now "this is the publishable key; the secret / service_role key is needed"
} else {
  $pl = JwtPayload $key
  if (-not $pl) { Stop-Now "the key is neither a Supabase JWT nor an sb_secret_ key" }
  if (-not $test -and ($pl.ref -ne $StagingRef)) { Stop-Now ("the key belongs to project " + $pl.ref + ", not staging " + $StagingRef) }
  if ($pl.role -ne "service_role") { Stop-Now ("the key role is " + $pl.role + ", the service_role key is needed") }
}

# ---------------------------------------------------------------- read-only state
$all = @()
for ($page = 1; $page -le 50; $page++) {
  $r = Call "GET" ("/auth/v1/admin/users?page=" + $page + "&per_page=200") $null $key
  if ($r.Code -eq 401 -or $r.Code -eq 403) { Stop-Now ("staging refused the key (HTTP " + $r.Code + "): it is not the staging secret key") }
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
  $emp = Call "GET" ("/rest/v1/employees?select=id,role,is_active,organization_id&user_id=eq." + $u.id) $null $key
  if ($emp.Code -ne 200) { Stop-Now ("cannot read the employee row of " + $a + " (HTTP " + $emp.Code + ")") }
  if (@($emp.Json).Count -ne 1) { Stop-Now ($a + " has " + @($emp.Json).Count + " employee rows, exactly 1 expected - refused") }
  $e = @($emp.Json | Where-Object { $_.organization_id -eq $orgId })
  $ban = $(if ($u.PSObject.Properties["banned_until"] -and $u.banned_until) { [string]$u.banned_until } else { "-" })
  $ids = $(if ($u.PSObject.Properties["identities"]) { @($u.identities).Count } else { 0 })
  $conf = [bool]($u.PSObject.Properties["email_confirmed_at"] -and $u.email_confirmed_at)
  $empTxt = $(if ($e.Count -eq 1) { $e[0].role + "/active=" + $e[0].is_active } else { "NOT IN " + $DemoOrg })
  Write-Host ("{0,-32} yes    {1,-21} {2,-9} {3,-10} {4}" -f $a, $ban, $conf, $ids, $empTxt)
  if ($e.Count -ne 1) { Stop-Now ($a + " is not an employee of '" + $DemoOrg + "' - refused (only demo staging accounts)") }
  if ([string]$e[0].role -ne $Allowed[$a]) { Stop-Now ($a + " has role " + $e[0].role + ", expected " + $Allowed[$a] + " - refused") }
  if (-not $e[0].is_active) { Stop-Now ($a + " employee is not active - refused") }
  $isBanned = ($ban -ne "-" -and ([datetime]$ban) -gt (Get-Date).ToUniversalTime())
  if ($isBanned -and -not $Unban) { Stop-Now ($a + " is banned; nothing was changed (lifting a ban needs -Unban and your explicit decision)") }
  if (-not $conf) { Stop-Now ($a + " e-mail is not confirmed; nothing was changed (the script changes only passwords)") }
  $plan += @{ Email = $a; Id = $u.id; Banned = $isBanned; Confirmed = $conf; EmpId = $e[0].id; Role = [string]$e[0].role; Ban = $ban }
}
Write-Host ("Auth users in staging: " + $all.Count + "; only the " + $plan.Count + " account(s) above can be changed.")
if ($DryRun) { Write-Host ""; Write-Host "DRY RUN: nothing was changed." -ForegroundColor Green; exit 0 }
if (-not $test) {
  Write-Host ""
  $phrase = Read-Host ("To set NEW passwords for these " + $plan.Count + " staging account(s) type exactly: STAGING " + $StagingRef)
  if ($phrase -cne ("STAGING " + $StagingRef)) { Stop-Now "confirmation phrase not typed - nothing was changed" }
}
$seen = @()

# ---------------------------------------------------------------- set + verify
$results = @()
foreach ($p in $plan) {
  Write-Host ""
  Write-Host ("== " + $p.Email) -ForegroundColor Cyan
  if ($p.Banned -and -not $Unban) { Write-Host "  banned - run again with -Unban to lift the ban" -ForegroundColor Yellow }
  if ($PasswordsFromEnvForTest) { $pw = $env:GOLDIA_TEST_PW; $pw2 = $pw } else {
    $pw = Plain (Read-Host -AsSecureString "  new password (hidden, min. 14 characters, 3 of: lower / upper / digit / symbol)")
    $pw2 = Plain (Read-Host -AsSecureString "  repeat the new password (hidden)")
  }
  if ($pw -cne $pw2) { $pw = $null; $pw2 = $null; Stop-Now ("passwords for " + $p.Email + " do not match") }
  $weak = Test-Strong $pw $p.Email
  if ($weak) { $pw = $null; $pw2 = $null; Stop-Now ("password for " + $p.Email + " refused: " + $weak) }
  if (-not $PasswordsFromEnvForTest) {
    $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($pw)))
    if ($seen -contains $hash) { $pw = $null; $pw2 = $null; Stop-Now "each account needs its own password" }
    $seen += $hash; $hash = $null
  }
  $body = @{ password = $pw }
  if ($p.Banned -and $Unban) { $body.ban_duration = "none" }
  $set = Call "PUT" ("/auth/v1/admin/users/" + $p.Id) $body $key
  $body = $null
  $login = @{ Code = -1; Json = $null }
  if ($set.Code -eq 200) { $login = Call "POST" "/auth/v1/token?grant_type=password" @{ email = $p.Email; password = $pw } $key }
  $pw = $null; $pw2 = $null
  $ok = ($set.Code -eq 200 -and $login.Code -eq 200 -and $login.Json -and $login.Json.access_token)
  $sub = $null; if ($ok) { $sub = (JwtPayload $login.Json.access_token).sub }
  $ok = $ok -and ($sub -eq $p.Id)
  if ($login.Json -and $login.Json.access_token) {
    # sign the proof session out again (revokes its refresh token); the token itself is never printed
    try { Invoke-WebRequest -Method POST -Uri ($Base + "/auth/v1/logout?scope=local") -Headers @{ apikey = $key; Authorization = ("Bearer " + $login.Json.access_token) } -UseBasicParsing -TimeoutSec 30 | Out-Null } catch { }
  }
  $loginCode = $login.Code; $login = $null
  # nothing but the password may have changed
  $after = Call "GET" ("/auth/v1/admin/users/" + $p.Id) $null $key
  $empA = Call "GET" ("/rest/v1/employees?select=id,role,is_active,organization_id&user_id=eq." + $p.Id) $null $key
  $ea = @($empA.Json)
  $same = ($after.Code -eq 200 -and $after.Json.id -eq $p.Id -and $after.Json.email.ToLowerInvariant() -eq $p.Email -and [bool]$after.Json.email_confirmed_at -and
           $empA.Code -eq 200 -and $ea.Count -eq 1 -and $ea[0].id -eq $p.EmpId -and [string]$ea[0].role -eq $p.Role -and $ea[0].organization_id -eq $orgId -and $ea[0].is_active)
  if (-not ($p.Banned -and $Unban)) {
    $banA = $(if ($after.Json -and $after.Json.PSObject.Properties["banned_until"] -and $after.Json.banned_until) { [string]$after.Json.banned_until } else { "-" })
    $same = $same -and ($banA -eq $p.Ban)
  }
  $ok = $ok -and $same
  Write-Host ("  password set: HTTP " + $set.Code + "; real login: HTTP " + $(if ($set.Code -eq 200) { [string]$loginCode } else { "skipped" }) + $(if ($ok) { " (token for this account, signed out again)" } else { "" }) +
              "; id / e-mail / role / organization unchanged: " + $same + " -> " + $(if ($ok) { "PASS" } else { "FAIL" })) -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
  $results += $ok
}
$key = $null
[GC]::Collect()
Write-Host ""
if ($results -contains $false) { Write-Host "RESULT: FAIL - see the lines above" -ForegroundColor Red; exit 1 }
Write-Host ("RESULT: PASS - " + $results.Count + " account(s) have the new password and log in. Run the staging smoke next.") -ForegroundColor Green
exit 0
