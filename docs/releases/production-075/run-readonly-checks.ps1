<#
  GOLDIA - READ-ONLY database checks (Windows PowerShell 5.1 and PowerShell 7; this file is pure ASCII on purpose:
  PowerShell 5.1 reads a .ps1 without BOM as Windows-1252, where UTF-8 dashes/quotes break the parser).

  Nothing is written: every psql session runs with default_transaction_read_only=on and every SQL file runs inside
  "begin transaction read only ... rollback". The password is asked once (hidden) and handed only to the psql child
  process environment; it is never printed, logged or stored.

  Production (Supabase vrozlllcaxinavzxueif): 072 -> 075 preflight + business baseline
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production
  Staging (vouehtlmsunebracahon): CRLF-tolerant function-body parity of 075
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target staging -PoolerHost aws-0-<region>.pooler.supabase.com

  Result (last line and exit code):  RESULT: PASS (0)  |  RESULT: REVIEW (2, WARN gates)  |  RESULT: FAIL (1)
  Any connection problem, SQL error, missing result line, STOP gate or parity difference gives FAIL - never PASS.
  Output folder: %USERPROFILE%\GoldiaBackups\readonly-<target>-<time>\ (aggregates only, no customer data).

  -LocalRehearsal: test mode against a disposable LOCAL PostgreSQL (127.0.0.1/localhost only, user postgres,
  no TLS, no password). It can never reach a Supabase host.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("production", "staging")][string]$Target,
  [string]$PoolerHost = "",
  [int]$Port = 5432,
  [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin",
  [string]$OutRoot = "",
  [switch]$LocalRehearsal
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
foreach ($c in $checks) {
  $full = Join-Path $repo $c.File
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
  $psi.EnvironmentVariables["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=120000"
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
$probeSql = "select current_setting('transaction_read_only') || '|' || current_user || '|' || (to_regprocedure('public.deployment_environment()') is null)::text || '|' || coalesce((select max(version) from supabase_migrations.schema_migrations), '-')"
$probe = Invoke-Psql @("-X", "-q", "-A", "-t", "-w", "-v", "ON_ERROR_STOP=1", "-c", $probeSql)
if ($probe.Code -ne 0) { Finish "FAIL" ("connection/identity probe failed: " + (First-Error $probe)) }
$probeLine = @($probe.Out -split "`r?`n" | Where-Object { $_ -match '\|' }) | Select-Object -Last 1
if (-not $probeLine) { Finish "FAIL" "identity probe returned no row" }
$pp = $probeLine.Trim().Split("|")
if ($pp.Count -lt 4) { Finish "FAIL" ("unexpected identity row: " + $probeLine) }
$idLine = "identity: read_only=" + $pp[0] + " user=" + $pp[1] + " not_jfs=" + $pp[2] + " latest_migration=" + $pp[3]
Write-Host ("  " + $idLine)
Add-Content -Path $script:SummaryFile -Value $idLine -Encoding ASCII
if ($pp[0] -ne "on") { Finish "FAIL" "session is not read-only" }
if ($pp[2] -ne "true") { Finish "FAIL" "deployment_environment() exists - this is a JewelryFlow SaaS demo database" }

# ---------------------------------------------------------------- checks
$overall = "PASS"; $why = New-Object System.Collections.ArrayList
foreach ($c in $checks) {
  $r = Invoke-Psql @("-X", "-q", "-A", "-t", "-w", "-F", " | ", "-v", "ON_ERROR_STOP=1", "-f", $c.Path)
  $outFile = Join-Path $outDir ($c.Name + ".txt")
  Set-Content -Path $outFile -Value ($r.Out + "`n--- stderr ---`n" + $r.Err) -Encoding UTF8
  if ($r.Code -ne 0) {
    $overall = "FAIL"; [void]$why.Add($c.Name + ": psql exit " + $r.Code + " - " + (First-Error $r))
    Write-Host ("  " + $c.Name + ": FAIL (psql exit " + $r.Code + ") -> " + $outFile) -ForegroundColor Red
    continue
  }
  $lines = @($r.Out -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
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
  if ($verdict -eq "FAIL") { $overall = "FAIL"; [void]$why.Add($c.Name + ": " + $detail) }
  elseif ($verdict -eq "REVIEW" -and $overall -eq "PASS") { $overall = "REVIEW"; [void]$why.Add($c.Name + ": " + $detail) }
}
$password = $null
if ($overall -eq "PASS") { Finish "PASS" ("all read-only checks passed; files in " + $outDir) }
Finish $overall (($why -join "; ") + "; files in " + $outDir)
