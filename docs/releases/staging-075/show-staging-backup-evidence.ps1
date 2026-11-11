<#
  GOLDIA SALES - READ ONLY: show the evidence of the staging release backup (no network, no database, nothing written).
    powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\staging-075\show-staging-backup-evidence.ps1 [-Folder <release folder>]
  Finds the newest %USERPROFILE%\GoldiaBackups\goldia-staging-* folder whose STAGING-*-RESULT.txt says "APPLIED, POSTFLIGHT PASS",
  prints the SHA256SUMS.txt line of staging-full.dump, recomputes the dump's SHA-256 and size, and prints the backup /
  restore-test / balance / postflight lines of the result file. Copy the output into the chat; it contains no secret.
#>
param([string]$Folder = "")
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
if (-not $Folder) {
  $root = Join-Path $env:USERPROFILE "GoldiaBackups"
  if (-not (Test-Path $root)) { Write-Host "STOPPED: $root not found"; exit 1 }
  $cand = Get-ChildItem $root -Directory -Filter "goldia-staging-*" | Sort-Object LastWriteTime -Descending | Where-Object {
    $r = Get-ChildItem $_.FullName -Filter "STAGING-*-RESULT.txt" -ErrorAction SilentlyContinue | Select-Object -First 1
    $r -and (Select-String -Path $r.FullName -SimpleMatch "APPLIED, POSTFLIGHT PASS" -Quiet)
  } | Select-Object -First 1
  if (-not $cand) { Write-Host "STOPPED: no release folder with 'APPLIED, POSTFLIGHT PASS' under $root"; exit 1 }
  $Folder = $cand.FullName
}
$result = Get-ChildItem $Folder -Filter "STAGING-*-RESULT.txt" | Select-Object -First 1
$dump = Join-Path $Folder "staging-full.dump"
$sums = Join-Path $Folder "SHA256SUMS.txt"
Write-Host ("folder:        " + $Folder)
Write-Host ("result file:   " + $(if ($result) { $result.Name } else { "MISSING" }))
if (-not (Test-Path $dump)) { Write-Host "STOPPED: staging-full.dump is missing"; exit 1 }
$item = Get-Item $dump
$hash = (Get-FileHash -Algorithm SHA256 -Path $dump).Hash.ToLowerInvariant()
$line = $(if (Test-Path $sums) { Select-String -Path $sums -SimpleMatch "staging-full.dump" | Select-Object -First 1 } else { $null })
$listed = $(if ($line) { $line.Line.Split(" ")[0].ToLowerInvariant() } else { "" })
Write-Host ("dump:          staging-full.dump  " + $item.Length + " bytes  written " + $item.LastWriteTimeUtc.ToString("yyyy-MM-ddTHH:mm:ssZ"))
Write-Host ("sha256 now:    " + $hash)
Write-Host ("SHA256SUMS:    " + $(if ($line) { $line.Line } else { "MISSING" }))
Write-Host ("sha256 match:  " + $(if ($listed -and $listed -eq $hash) { "YES" } else { "NO" }))
if ($result) {
  Write-Host "result lines:"
  Select-String -Path $result.FullName -Pattern "full backup", "staging-full.dump", "restored copy vs staging", "BACKUP: VERIFIED", "per-organization balances", "business row counts changed", "POSTFLIGHT", "RESULT:" |
    ForEach-Object { Write-Host ("  " + $_.Line.Trim()) }
}
