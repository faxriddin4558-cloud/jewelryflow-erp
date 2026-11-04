param([string]$Script, [string]$Repo)
Set-StrictMode -Version 2.0
$t = $null; $e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$t, [ref]$e)
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
  if ($f.Name -in @("Repair-LeftoverVercelGitignore")) { . ([scriptblock]::Create($f.Extent.Text)) }
}
$assign = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$AllowedVercelGitignoreLines' }, $true) | Select-Object -First 1
. ([scriptblock]::Create($assign.Extent.Text))
function Stop-Now([string]$m) { throw "STOP: $m" }
# test double for the Windows-only cmd.exe runner: same contract (Code/Out/Err)
function Invoke-Native([string]$Exe, [string[]]$Arguments) { $o = & $Exe @Arguments 2>&1; return @{ Code = $LASTEXITCODE; Out = ($o | Out-String); Err = "" } }
Set-Location $Repo
$GitignorePath = Join-Path $Repo ".gitignore"
$head = [IO.File]::ReadAllText($GitignorePath)
function Reset { git checkout -q -- . ; }
function Case([string]$name, [scriptblock]$setup, [string]$expect) {
  Reset; & $setup
  $before = git status --porcelain --untracked-files=no | Out-String
  $giBefore = [IO.File]::ReadAllText($GitignorePath)
  $got = "returned"; $msg = ""
  try { Repair-LeftoverVercelGitignore 6>$null } catch { $got = "STOP"; $msg = $_.Exception.Message }
  $after = (git status --porcelain --untracked-files=no | Out-String).Trim()
  $giAfter = [IO.File]::ReadAllText($GitignorePath)
  $state = if ($giAfter -eq $head) { ".gitignore = HEAD" } elseif ($giAfter -eq $giBefore) { ".gitignore untouched" } else { ".gitignore CHANGED OTHERWISE" }
  $ok = ($got -eq $expect) -and ($state -ne ".gitignore CHANGED OTHERWISE")
  "{0} {1,-52} expected={2,-8} got={3,-8} {4}; status after: [{5}] {6}" -f ($(if ($ok) { "ok " } else { "BAD" })), $name, $expect, $got, $state, ($after -replace "`r?`n", " "), $msg.Substring(0, [Math]::Min(70, $msg.Length))
}
Case "leftover .vercel + .env* (CRLF append)" { [IO.File]::AppendAllText($GitignorePath, ".vercel`r`n.env*`r`n") } "returned"
Case "leftover only .env*" { [IO.File]::AppendAllText($GitignorePath, ".env*`n") } "returned"
Case "clean checkout" { } "returned"
Case "leftover + owner change in app.txt (not repaired)" { [IO.File]::AppendAllText($GitignorePath, ".env*`n"); [IO.File]::AppendAllText((Join-Path $Repo "app.txt"), "owner edit`n") } "returned"
Case "extra owner line in .gitignore" { [IO.File]::AppendAllText($GitignorePath, ".env*`nmy-notes/`n") } "STOP"
Case "owner edited an existing .gitignore line" { [IO.File]::WriteAllText($GitignorePath, ($head -replace "node_modules", "node_modules2")) } "STOP"
Case "owner removed a .gitignore line" { [IO.File]::WriteAllText($GitignorePath, (($head -split "`n" | Select-Object -Skip 1) -join "`n")) } "STOP"
