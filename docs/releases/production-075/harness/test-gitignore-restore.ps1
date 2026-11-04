param([string]$Script, [string]$Dir)
Set-StrictMode -Version 2.0
$t = $null; $e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$t, [ref]$e)
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
  if ($f.Name -in @("Read-FileBytes", "Test-BytePrefix", "Restore-VercelGitignore")) { . ([scriptblock]::Create($f.Extent.Text)) }
}
$assign = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$AllowedVercelGitignoreLines' }, $true) | Select-Object -First 1
. ([scriptblock]::Create($assign.Extent.Text))
"allowed lines loaded from the script: " + ($AllowedVercelGitignoreLines -join ", ")
function Stop-Now([string]$m) { throw "STOP: $m" }
$GitignorePath = Join-Path $Dir ".gitignore"
$crlf = [Text.Encoding]::ASCII.GetBytes("node_modules`r`n.next`r`n.env`r`n.env.*`r`n.vercel`r`n")
$lf = [Text.Encoding]::ASCII.GetBytes("node_modules`n.next`n.env`n.env.*`n.vercel`n")
function Case([string]$name, [byte[]]$orig, [string]$append, [string]$expect, [switch]$Edit) {
  if ($null -eq $orig) { if (Test-Path $GitignorePath) { Remove-Item -Force $GitignorePath } } else { [IO.File]::WriteAllBytes($GitignorePath, $orig) }
  $script:GitignoreOriginal = Read-FileBytes $GitignorePath
  if ($Edit) { [IO.File]::WriteAllBytes($GitignorePath, [Text.Encoding]::ASCII.GetBytes("node_modules`r`n.nextX`r`n.env`r`n.env.*`r`n.vercel`r`n")) }
  elseif ($append) { $cur = Read-FileBytes $GitignorePath; if ($null -eq $cur) { $cur = [byte[]]@() }; [IO.File]::WriteAllBytes($GitignorePath, [byte[]]($cur + [Text.Encoding]::ASCII.GetBytes($append))) }
  $afterApp = Read-FileBytes $GitignorePath
  $got = "restored"
  try { Restore-VercelGitignore "test" 6>$null } catch { $got = "STOP" }
  $final = Read-FileBytes $GitignorePath
  $state = "unchanged-by-script"
  if ($got -eq "restored") {
    if ($null -eq $orig) { if ($null -eq $final) { $state = "original (no file)" } else { $state = "FILE LEFT" } }
    elseif ([Convert]::ToBase64String($final) -eq [Convert]::ToBase64String($orig)) { $state = "original bytes" } else { $state = "DIFFERENT" }
  } else { if ([Convert]::ToBase64String($final) -eq [Convert]::ToBase64String($afterApp)) { $state = "left as found (nothing restored)" } else { $state = "MODIFIED BY SCRIPT" } }
  $ok = ($got -eq $expect) -and ($state -notmatch "DIFFERENT|FILE LEFT|MODIFIED")
  "{0} {1,-46} expected={2,-8} got={3,-8} {4}" -f ($(if ($ok) { "ok " } else { "BAD" })), $name, $expect, $got, $state
}
Case "CRLF + .vercel + .env* (Vercel CLI, Windows)" $crlf ".vercel`r`n.env*`r`n" "restored"
Case "CRLF + only .env*" $crlf "`r`n.env*`r`n" "restored"
Case "LF + .env*.local + .env*" $lf ".env*.local`n.env*`n" "restored"
Case "LF + .vercel/ (trailing slash)" $lf ".vercel/`n" "restored"
Case "no change" $crlf "" "restored"
Case "no .gitignore; CLI creates .vercel + .env*" $null ".vercel`n.env*`n" "restored"
Case "CRLF + .env (not the exact Vercel line)" $crlf ".env*`r`n.env`r`n" "STOP"
Case "CRLF + !.env.production (negation)" $crlf ".env*`r`n!.env.production`r`n" "STOP"
Case "CRLF + user line src/" $crlf ".vercel`r`nsrc/`r`n" "STOP"
Case "owner edited an existing line" $crlf "" "STOP" -Edit
Case "CRLF + '.env* ' spacing variant" $crlf ".env* `r`n" "restored"
