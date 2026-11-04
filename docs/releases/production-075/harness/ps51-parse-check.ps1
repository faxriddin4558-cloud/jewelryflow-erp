# Simulates how Windows PowerShell 5.1 reads a .ps1 WITHOUT a BOM: as the ANSI code page (Windows-1252).
param([string]$FileList)
$Files = $FileList.Split(",")
$cp = [System.Text.CodePagesEncodingProvider]::Instance; [System.Text.Encoding]::RegisterProvider($cp)
$ansi = [System.Text.Encoding]::GetEncoding(1252)
foreach ($f in $Files) {
  $bytes = [System.IO.File]::ReadAllBytes($f)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $text = if ($hasBom) { [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3) } else { $ansi.GetString($bytes) }
  $t = $null; $e = $null
  [void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$t, [ref]$e)
  "{0}: bom={1} parse_errors_as_PS51={2}" -f (Split-Path $f -Leaf), $hasBom, $e.Count
  $e | Select-Object -First 4 | ForEach-Object { "   line {0}: {1}" -f $_.Extent.StartLineNumber, $_.Message }
}
