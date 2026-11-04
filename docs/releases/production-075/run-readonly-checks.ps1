<#
  GOLDIA - READ-ONLY database checks (Windows PowerShell 5.1 and PowerShell 7; this file is pure ASCII on purpose:
  PowerShell 5.1 reads a .ps1 without BOM as Windows-1252, where UTF-8 dashes/quotes break the parser).

  Nothing is written. The Supabase pooler (Supavisor) does NOT forward PGOPTIONS / startup "options" to the database,
  so the session default cannot be trusted. Every query therefore runs in an EXPLICIT "BEGIN TRANSACTION READ ONLY":
  the identity probe and every SQL file (wrapped by this script: BEGIN TRANSACTION READ ONLY -> guard that raises unless
  transaction_read_only = on inside that same transaction -> file body -> ROLLBACK, with ON_ERROR_STOP). The first
  failure stops everything; no further SQL is sent. The password is asked once (hidden) and handed only to the psql
  child process environment; it is never printed, logged or stored.

  Production (Supabase vrozlllcaxinavzxueif): 072 -> 075 preflight + business baseline
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production
  Staging (vouehtlmsunebracahon): CRLF-tolerant function-body parity of 075
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target staging -PoolerHost aws-0-<region>.pooler.supabase.com

  Result (last line and exit code):  RESULT: PASS (0)  |  RESULT: REVIEW (2, WARN gates)  |  RESULT: FAIL (1)
  Any connection problem, SQL error, missing result line, STOP gate or parity difference gives FAIL - never PASS.
  Output folder: %USERPROFILE%\GoldiaBackups\readonly-<target>-<time>\ (aggregates only, no customer data).

  -LocalRehearsal: test mode against a disposable LOCAL PostgreSQL (127.0.0.1/localhost only, user postgres,
  no TLS, no password). It can never reach a Supabase host. Test-only switches (accepted only with -LocalRehearsal):
  -SimulatePoolerWithoutOptions (do not send PGOPTIONS, like the Supabase pooler) and -ExtraCheckFile <sql> (one more
  file through the same read-only wrapper, used to prove that a write attempt fails).
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("production", "staging")][string]$Target,
  [string]$PoolerHost = "",
  [int]$Port = 5432,
  [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin",
  [string]$OutRoot = "",
  [switch]$LocalRehearsal,
  [switch]$SimulatePoolerWithoutOptions,
  [string]$ExtraCheckFile = ""
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$script:SummaryFile = $null

$Refs = @{ production = "vrozlllcaxinavzxueif"; staging = "vouehtlmsunebracahon" }
$Never = @("yvvbdoqncubtwlzskgml", "hbbuskyifxkowlozsaym", "vrozlilcaxinavzxueif")   # JFS demo, ERP, typo of prod ref
$Ref = $Refs[$Target]

function Finish([string]$Result, [string]$Why) {
  $color = "Green"; $code = 0
  if ($Result -eq "FAIL") { $color = "Red"; $code = 1 }
  elseif ($Result -eq "REVIEW") { $color = "Yellow"; $code = 2 }
  $line = "RESULT: $Result - $Why"
  if ($script:SummaryFile) { Add-Content -Path $script:SummaryFile -Value $line -Encoding ASCII }
  Write-Host ""
  Write-Host $line -ForegroundColor $color
  exit $code
}

# ---------------------------------------------------------------- target guard (before any connection)
if (($SimulatePoolerWithoutOptions -or $ExtraCheckFile) -and -not $LocalRehearsal) { Finish "FAIL" "test-only switches require -LocalRehearsal" }
if ($LocalRehearsal) {
  if (-not $PoolerHost) { $PoolerHost = "127.0.0.1" }
  if ($PoolerHost -ne "127.0.0.1" -and $PoolerHost -ne "localhost") { Finish "FAIL" "-LocalRehearsal only accepts 127.0.0.1 or localhost" }
  $DbUser = "postgres"; $SslMode = "disable"
} else {
  if (-not $PoolerHost) {
    if ($Target -eq "production") { $PoolerHost = "aws-0-ap-southeast-1.pooler.supabase.com" }   # default of scripts/goldia-prod-release.js
    else { Finish "FAIL" "-PoolerHost is required for staging (Supabase Dashboard > Connect > Session pooler)" }
  }
  $others = @($Never) + @($Refs.Values | Where-Object { $_ -ne $Ref })
  foreach ($bad in $others) { if ($PoolerHost.Contains($bad)) { Finish "FAIL" "host contains another project's ref ($bad)" } }
  if (-not ($PoolerHost -match '^[a-z0-9-]+\.pooler\.supabase\.com$') -and $PoolerHost -ne "db.$Ref.supabase.co") { Finish "FAIL" "unexpected host $PoolerHost" }
  $DbUser = "postgres.$Ref"; $SslMode = "require"
}

$psqlExe = Join-Path $PgBin "psql.exe"
if (-not (Test-Path -LiteralPath $psqlExe)) { $psqlExe = Join-Path $PgBin "psql" }
if (-not (Test-Path -LiteralPath $psqlExe)) { Finish "FAIL" "psql not found in $PgBin (install the PostgreSQL 17 client or pass -PgBin)" }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
if ($Target -eq "production") {
  $checks = @(
    @{ Name = "00_preflight"; File = "docs/releases/production-075/00_preflight_072_to_075_readonly.sql"; Kind = "preflight" },
    @{ Name = "01_baseline";  File = "docs/releases/production-075/01_baseline_readonly.sql";             Kind = "baseline" }
  )
} else {
  $checks = @(@{ Name = "function_body_parity_075"; File = "supabase/release/function_body_parity_075_readonly.sql"; Kind = "parity" })
}
if ($ExtraCheckFile) { $checks += @{ Name = "extra_check"; File = $ExtraCheckFile; Kind = "extra" } }
foreach ($c in $checks) {
  $full = $c.File
  if (-not [System.IO.Path]::IsPathRooted($full)) { $full = Join-Path $repo $c.File }
  if (-not (Test-Path -LiteralPath $full)) { Finish "FAIL" "missing $($c.File) - run from the release branch checkout" }
  $c.Path = $full
}

if (-not $OutRoot) {
  $home2 = $env:USERPROFILE; if (-not $home2) { $home2 = $env:HOME }
  $OutRoot = Join-Path $home2 "GoldiaBackups"
}
$outDir = Join-Path $OutRoot ("readonly-" + $Target + "-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$script:SummaryFile = Join-Path $outDir "SUMMARY.txt"
Set-Content -Path $script:SummaryFile -Value ("GOLDIA read-only checks target=" + $Target + " ref=" + $Ref + " host=" + $PoolerHost + " local=" + [bool]$LocalRehearsal + " at=" + (Get-Date -Format o)) -Encoding ASCII

# ---------------------------------------------------------------- password (once, hidden, child process only)
$password = ""
if (-not $LocalRehearsal) {
  $sec = Read-Host -Prompt ("Database password for " + $DbUser + " (hidden)") -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if (-not $password) { Finish "FAIL" "empty password" }
}

function Quote-Arg([string]$a) {
  if ($a -match '[\s"]') { return '"' + ($a -replace '"', '\"') + '"' }
  return $a
}

# Runs psql with the given arguments; returns @{ Code; Out; Err }. Never throws on stderr output.
function Invoke-Psql([string[]]$PsqlArgs) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $psqlExe
  $psi.Arguments = (($PsqlArgs | ForEach-Object { Quote-Arg $_ }) -join " ")
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables["PGHOST"] = $PoolerHost
  $psi.EnvironmentVariables["PGPORT"] = [string]$Port
  $psi.EnvironmentVariables["PGUSER"] = $DbUser
  $psi.EnvironmentVariables["PGDATABASE"] = "postgres"
  $psi.EnvironmentVariables["PGSSLMODE"] = $SslMode
  $psi.EnvironmentVariables["PGAPPNAME"] = "goldia-readonly-checks"
  $psi.EnvironmentVariables["PGCONNECT_TIMEOUT"] = "20"
  # extra layer only - the Supabase pooler drops it; safety comes from the explicit read-only transactions below
  if (-not $SimulatePoolerWithoutOptions) { $psi.EnvironmentVariables["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=120000" }
  $psi.EnvironmentVariables["PGCLIENTENCODING"] = "UTF8"
  $psi.EnvironmentVariables["PGPASSWORD"] = $password
  $p = [System.Diagnostics.Process]::Start($psi)
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  $p.StandardInput.Close()
  if (-not $p.WaitForExit(600000)) { try { $p.Kill() } catch { }; return @{ Code = -1; Out = ""; Err = "psql timed out after 10 minutes" } }
  $p.WaitForExit()
  return @{ Code = $p.ExitCode; Out = $outTask.Result; Err = $errTask.Result }
}

function First-Error([hashtable]$r) {
  $lines = @(($r.Err + "`n" + $r.Out) -split "`r?`n" | Where-Object { $_ -match 'ERROR|FATAL|error|failed|timed out' })
  if ($lines.Count -gt 0) { return $lines[0].Trim() }
  return ("exit code " + $r.Code)
}

Write-Host ("GOLDIA read-only checks - target " + $Target + " (" + $Ref + "), host " + $PoolerHost) -ForegroundColor Cyan

# ---------------------------------------------------------------- identity probe
$probeSql = "select 'GOLDIA_ID|' || current_setting('transaction_read_only') || '|' || current_user || '|' || (to_regprocedure('public.deployment_environment()') is null)::text || '|' || coalesce((select max(version) from supabase_migrations.schema_migrations), '-') || '|' || current_setting('default_transaction_read_only')"
# three statements in ONE session: the select runs inside the explicit read-only transaction
$probe = Invoke-Psql @("-X", "-q", "-A", "-t", "-w", "-v", "ON_ERROR_STOP=1", "-c", "begin transaction read only", "-c", $probeSql, "-c", "rollback")
if ($probe.Code -ne 0) { Finish "FAIL" ("connection/identity probe failed: " + (First-Error $probe)) }
$probeLine = @($probe.Out -split "`r?`n" | Where-Object { $_ -match '^GOLDIA_ID\|' }) | Select-Object -Last 1
if (-not $probeLine) { Finish "FAIL" "identity probe returned no row" }
$pp = $probeLine.Trim().Split("|")
if ($pp.Count -lt 6) { Finish "FAIL" ("unexpected identity row: " + $probeLine) }
$idLine = "identity: transaction_read_only=" + $pp[1] + " (explicit BEGIN TRANSACTION READ ONLY) user=" + $pp[2] + " not_jfs=" + $pp[3] + " latest_migration=" + $pp[4] + " session_default_read_only=" + $pp[5] + " (informational; the pooler ignores PGOPTIONS)"
Write-Host ("  " + $idLine)
Add-Content -Path $script:SummaryFile -Value $idLine -Encoding ASCII
if ($pp[1] -ne "on") { Finish "FAIL" "the explicit read-only transaction is not read-only (transaction_read_only=" + $pp[1] + ")" }
if ($pp[3] -ne "true") { Finish "FAIL" "deployment_environment() exists - this is a JewelryFlow SaaS demo database" }

# Wraps a read-only SQL file: its own BEGIN/ROLLBACK lines are replaced by the script's explicit transaction and a guard
# that raises (ON_ERROR_STOP -> psql exits, nothing else runs) unless the SAME transaction is read-only.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function New-ReadOnlyWrapper([hashtable]$c) {
  $body = [System.IO.File]::ReadAllText($c.Path, [System.Text.Encoding]::UTF8)
  $kept = @($body -split "`r?`n" | Where-Object { $_.Trim().ToLowerInvariant() -ne "begin transaction read only;" -and $_.Trim().ToLowerInvariant() -ne "rollback;" -and $_.Trim().ToLowerInvariant() -ne "begin;" -and $_.Trim().ToLowerInvariant() -ne "commit;" })
  # any other transaction control could leave the read-only transaction (the pooler session default is NOT read-only)
  $tc = @($kept | Where-Object { $_ -match '^\s*(commit|end|abort|rollback|begin|start\s+transaction|savepoint|release|prepare\s+transaction|set\s+(session\s+)?(characteristics|transaction)|set\s+default_transaction_read_only|reset\s+(all|default_transaction_read_only)|\\(c|connect|i|ir|include))\b' })
  if ($tc.Count -gt 0) { Finish "FAIL" ($c.Name + ": transaction control or psql meta command in the SQL file (" + $tc[0].Trim() + ") - refused before running") }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("\set ON_ERROR_STOP on")
  [void]$sb.AppendLine("begin transaction read only;")
  [void]$sb.AppendLine("do `$goldia_ro`$ begin if current_setting('transaction_read_only') <> 'on' then raise exception 'GOLDIA_RO_GUARD: transaction is not read-only - stopped before any check'; end if; end `$goldia_ro`$;")
  [void]$sb.AppendLine("select 'GOLDIA_RO_GUARD|' || current_setting('transaction_read_only');")
  foreach ($l in $kept) { [void]$sb.AppendLine($l) }
  [void]$sb.AppendLine(";")
  [void]$sb.AppendLine("select 'GOLDIA_RO_END|' || current_setting('transaction_read_only');")
  [void]$sb.AppendLine("rollback;")
  $w = Join-Path $outDir ("wrapped-" + $c.Name + ".sql")
  [System.IO.File]::WriteAllText($w, $sb.ToString(), $utf8NoBom)
  return $w
}

# ---------------------------------------------------------------- checks
$overall = "PASS"; $why = New-Object System.Collections.ArrayList
foreach ($c in $checks) {
  $wrapped = New-ReadOnlyWrapper $c
  $r = Invoke-Psql @("-X", "-q", "-A", "-t", "-w", "-F", " | ", "-v", "ON_ERROR_STOP=1", "-f", $wrapped)
  $outFile = Join-Path $outDir ($c.Name + ".txt")
  Set-Content -Path $outFile -Value ($r.Out + "`n--- stderr ---`n" + $r.Err) -Encoding UTF8
  if ($r.Code -ne 0) {
    Write-Host ("  " + $c.Name + ": FAIL (psql exit " + $r.Code + ") -> " + $outFile) -ForegroundColor Red
    Add-Content -Path $script:SummaryFile -Value ($c.Name + ": FAIL - psql exit " + $r.Code + " - " + (First-Error $r)) -Encoding ASCII
    Finish "FAIL" ($c.Name + ": psql exit " + $r.Code + " - " + (First-Error $r) + " (remaining checks not run)")
  }
  $lines = @($r.Out -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $guardOk = (@($lines | Where-Object { $_ -eq "GOLDIA_RO_GUARD|on" }).Count -eq 1) -and (@($lines | Where-Object { $_ -eq "GOLDIA_RO_END|on" }).Count -eq 1)
  if (-not $guardOk) { Finish "FAIL" ($c.Name + ": read-only guard lines missing - output not trusted (remaining checks not run)") }
  $verdict = "PASS"; $detail = ""
  switch ($c.Kind) {
    "preflight" {
      $res = @($lines | Where-Object { $_ -match '^RESULT \| preflight_072_to_075 \| ' })
      if ($res.Count -ne 1) { $verdict = "FAIL"; $detail = "no RESULT line" }
      else {
        $state = ($res[0] -split '\s\|\s')[2]
        if ($state -eq "PASS") { $detail = $res[0] }
        elseif ($state -eq "WARN") { $verdict = "REVIEW"; $detail = $res[0] }
        else { $verdict = "FAIL"; $detail = $res[0] }
      }
      foreach ($g in @($lines | Where-Object { $_ -match '\| (STOP|WARN) \|' })) { Write-Host ("    " + $g) -ForegroundColor Yellow }
    }
    "baseline" {
      $fp = @($lines | Where-Object { $_ -match '^BASELINE \| fingerprint business \| [0-9a-f]{32}$' })
      $n = @($lines | Where-Object { $_ -match '^BASELINE \| ' }).Count
      if ($fp.Count -ne 1 -or $n -lt 20) { $verdict = "FAIL"; $detail = "baseline incomplete (" + $n + " lines, fingerprint " + $fp.Count + ")" }
      else { $detail = [string]$n + " lines, " + $fp[0] }
    }
    "extra" { $detail = "extra check file ran read-only" }
    "parity" {
      $stat = @{}
      foreach ($l in $lines) { if ($l -match '^(identical|crlf_only|DIFFERENT|MISSING) \| (\d+)$') { $stat[$Matches[1]] = [int]$Matches[2] } }
      if ($stat.Count -eq 0) { $verdict = "FAIL"; $detail = "no parity summary rows" }
      else {
        $diff = 0; if ($stat.ContainsKey("DIFFERENT")) { $diff += $stat["DIFFERENT"] }; if ($stat.ContainsKey("MISSING")) { $diff += $stat["MISSING"] }
        $detail = (($stat.Keys | Sort-Object | ForEach-Object { $_ + "=" + $stat[$_] }) -join " ")
        if ($diff -gt 0) { $verdict = "FAIL"; foreach ($d in @($lines | Where-Object { $_ -match '^DETAIL (DIFFERENT|MISSING) ' })) { Write-Host ("    " + $d) -ForegroundColor Red } }
      }
    }
  }
  $col = "Green"; if ($verdict -eq "FAIL") { $col = "Red" } elseif ($verdict -eq "REVIEW") { $col = "Yellow" }
  Write-Host ("  " + $c.Name + ": " + $verdict + " - " + $detail + " -> " + $outFile) -ForegroundColor $col
  Add-Content -Path $script:SummaryFile -Value ($c.Name + ": " + $verdict + " - " + $detail) -Encoding ASCII
  if ($verdict -eq "FAIL") { Finish "FAIL" ($c.Name + ": " + $detail + " (remaining checks not run)") }
  elseif ($verdict -eq "REVIEW" -and $overall -eq "PASS") { $overall = "REVIEW"; [void]$why.Add($c.Name + ": " + $detail) }
}
$password = $null
if ($overall -eq "PASS") { Finish "PASS" ("all read-only checks passed; files in " + $outDir) }
Finish $overall (($why -join "; ") + "; files in " + $outDir)
