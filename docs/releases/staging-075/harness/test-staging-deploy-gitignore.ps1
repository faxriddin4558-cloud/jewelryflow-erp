# Functional test (pwsh, Linux or Windows) of the .gitignore restoration in deploy-staging-frontend.ps1.
# Loads ONLY the restoration functions from the script's AST (nothing of the deploy runs, no Vercel, no network) and
# exercises them in throw-away git repositories. Run: pwsh -NoProfile -File docs/releases/staging-075/harness/test-staging-deploy-gitignore.ps1
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "..\deploy-staging-frontend.ps1"
$errs = $null; $ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $script), [ref]$null, [ref]$errs)
if ($errs) { throw "parse errors: $errs" }
$want = @("Read-FileBytes", "Test-BytePrefix", "Restore-VercelGitignore", "Repair-LeftoverVercelGitignore", "Test-NetworkFailure")
$defs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $want -contains $n.Name }, $true)
if ($defs.Count -ne $want.Count) { throw "expected $($want.Count) functions, found $($defs.Count)" }
foreach ($d in $defs) { . ([ScriptBlock]::Create($d.Extent.Text)) }
$allowedAst = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$AllowedVercelGitignoreLines' }, $true)
. ([ScriptBlock]::Create($allowedAst[0].Extent.Text))
# test doubles: Stop-Deploy throws instead of exiting; Invoke-Native runs the command directly (no cmd.exe on Linux)
function Stop-Deploy([string]$m) { throw "STOP: $m" }
function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  $out = & $Exe @Arguments 2>$null | Out-String; return @{ Code = $LASTEXITCODE; Out = $out; Err = "" }
}
$pass = 0; $fail = 0
function Check([string]$name, [scriptblock]$body) {
  try { & $body; Write-Host "PASS $name"; $script:pass++ } catch { Write-Host "FAIL $name : $($_.Exception.Message)"; $script:fail++ }
}
function New-Repo([string]$gi) {
  $d = Join-Path ([IO.Path]::GetTempPath()) ("gi-test-" + [Guid]::NewGuid().ToString("N")); New-Item -ItemType Directory $d | Out-Null
  Set-Location $d; git init -q; git config user.email t@t; git config user.name t
  [IO.File]::WriteAllText((Join-Path $d ".gitignore"), $gi); "x" | Set-Content a.txt; git add -A; git commit -qm init
  $script:GitignorePath = Join-Path $d ".gitignore"; return $d
}
$crlf = "node_modules`r`n.env`r`n.env.*`r`n.vercel`r`n"

Check "same-run append of .vercel + .env*.local is restored byte-for-byte (CRLF file)" {
  New-Repo $crlf | Out-Null
  $script:GitignoreOriginal = Read-FileBytes $GitignorePath
  [IO.File]::AppendAllText($GitignorePath, "`n.vercel`n.env*.local`n")
  Restore-VercelGitignore "vercel link"
  if ([IO.File]::ReadAllText($GitignorePath) -ne $crlf) { throw "not restored" }
  if ((git status --porcelain --untracked-files=no)) { throw "tree not clean" }
}
Check "unchanged .gitignore: nothing done" {
  New-Repo $crlf | Out-Null
  $script:GitignoreOriginal = Read-FileBytes $GitignorePath
  Restore-VercelGitignore "vercel env pull"
  if ([IO.File]::ReadAllText($GitignorePath) -ne $crlf) { throw "changed" }
}
Check "same-run append of an unexpected line: STOP, file left as found" {
  New-Repo $crlf | Out-Null
  $script:GitignoreOriginal = Read-FileBytes $GitignorePath
  [IO.File]::AppendAllText($GitignorePath, "secret.txt`n")
  $stopped = $false; try { Restore-VercelGitignore "vercel link" } catch { $stopped = $_.Exception.Message -like "STOP:*unexpected line 'secret.txt'*" }
  if (-not $stopped) { throw "no STOP" }
  if (-not ([IO.File]::ReadAllText($GitignorePath)).EndsWith("secret.txt`n")) { throw "file was touched" }
}
Check "same-run edit inside the file (not an append): STOP" {
  New-Repo $crlf | Out-Null
  $script:GitignoreOriginal = Read-FileBytes $GitignorePath
  [IO.File]::WriteAllText($GitignorePath, $crlf.Replace("node_modules", "node_module") + ".vercel`n")
  $stopped = $false; try { Restore-VercelGitignore "vercel link" } catch { $stopped = $_.Exception.Message -like "STOP:*edited*" }
  if (-not $stopped) { throw "no STOP" }
}
Check "leftover from an earlier run (only Vercel lines appended): repaired with git checkout, tree clean" {
  New-Repo $crlf | Out-Null
  [IO.File]::AppendAllText($GitignorePath, ".vercel`n.env*.local`n")
  Repair-LeftoverVercelGitignore
  if ([IO.File]::ReadAllText($GitignorePath) -ne $crlf) { throw "not restored" }
  if ((git status --porcelain --untracked-files=no)) { throw "tree not clean" }
}
Check "leftover plus another modified tracked file: not repaired (the clean check then stops)" {
  New-Repo $crlf | Out-Null
  [IO.File]::AppendAllText($GitignorePath, ".vercel`n"); "y" | Set-Content a.txt
  Repair-LeftoverVercelGitignore
  if (-not ([IO.File]::ReadAllText($GitignorePath)).EndsWith(".vercel`n")) { throw ".gitignore was touched" }
}
Check "leftover with a non-Vercel extra line: STOP, untouched" {
  New-Repo $crlf | Out-Null
  [IO.File]::AppendAllText($GitignorePath, ".vercel`nfoo`n")
  $stopped = $false; try { Repair-LeftoverVercelGitignore } catch { $stopped = $_.Exception.Message -like "STOP:*'foo'*" }
  if (-not $stopped) { throw "no STOP" }
  if (-not ([IO.File]::ReadAllText($GitignorePath)).EndsWith("foo`n")) { throw "touched" }
}
Check "leftover where a committed line was changed: STOP, untouched" {
  New-Repo $crlf | Out-Null
  [IO.File]::WriteAllText($GitignorePath, $crlf.Replace(".env.*", ".env.x") + ".vercel`n")
  $stopped = $false; try { Repair-LeftoverVercelGitignore } catch { $stopped = $_.Exception.Message -like "STOP:*differs from HEAD*" }
  if (-not $stopped) { throw "no STOP" }
}
Check "clean tree: Repair does nothing" {
  New-Repo $crlf | Out-Null
  Repair-LeftoverVercelGitignore
  if ([IO.File]::ReadAllText($GitignorePath) -ne $crlf) { throw "changed" }
}
Check "network failure detection: 'Error: fetch failed' retried, a build error is not" {
  if (-not (Test-NetworkFailure "Uploading [====] (2.2MB/2.2MB)`nError: fetch failed")) { throw "fetch failed not detected" }
  if (-not (Test-NetworkFailure "Error: request to https://api.vercel.com failed, reason: read ECONNRESET")) { throw "ECONNRESET not detected" }
  if (Test-NetworkFailure "Error: Command `"npm run build`" exited with 1") { throw "build error treated as network" }
}
Write-Host "TOTAL $pass/$($pass + $fail)"
if ($fail) { exit 1 }
