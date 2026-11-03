<#
  GOLDIA SALES — deploy the 075 release-candidate frontend to the STAGING Vercel project only.

  Run from a clean checkout of the release candidate, AFTER staging is at 075 (scripts/goldia-staging-release.js --apply):
    git fetch origin claude/goldia-sales-staging-audit-qtrq1d
    git checkout --detach <RC_SHA>
    powershell -ExecutionPolicy Bypass -File docs/releases/staging-075/deploy-staging-frontend.ps1 -ReleaseCandidate <RC_SHA>

  Secrets are never passed on the command line: the Vercel CLI asks for the staging anon key and the staging
  service-role key interactively (Supabase Dashboard -> project vouehtlmsunebracahon -> Settings -> API).
  Production (vrozlllcaxinavzxueif) and JFS demo (yvvbdoqncubtwlzskgml) values are refused.
#>
param(
  [Parameter(Mandatory = $true)][string]$ReleaseCandidate,
  [string]$Project = "jewelryflow-sales-staging",
  [string]$Scope = "",
  [string]$VercelVersion = "39.1.1"
)
$ErrorActionPreference = "Stop"
$StagingRef = "vouehtlmsunebracahon"
$StagingUrl = "https://$StagingRef.supabase.co"
$Forbidden = @("vrozlllcaxinavzxueif", "yvvbdoqncubtwlzskgml")
function Stop-Deploy($msg) { Write-Host "STOP: $msg" -ForegroundColor Red; exit 1 }
if ($Project -ne "jewelryflow-sales-staging") { Stop-Deploy "only the staging project jewelryflow-sales-staging can be targeted" }

# 1. the checkout is exactly the release candidate, clean
$head = (git rev-parse HEAD).Trim()
if (-not $head.StartsWith($ReleaseCandidate)) { Stop-Deploy "HEAD $head is not the release candidate $ReleaseCandidate" }
if ((git status --porcelain) -ne $null) { Stop-Deploy "working tree is not clean" }
if (-not (Test-Path "supabase/migrations/20260101000075_goldia_customer_codes_per_org_and_factory_settings_isolation.sql")) { Stop-Deploy "075 migration not in this checkout" }

$vc = @("--yes", "vercel@$VercelVersion")
$scopeArgs = @(); if ($Scope) { $scopeArgs = @("--scope", $Scope) }

# 2. link this folder to the staging project
npx @vc link --yes --project $Project @scopeArgs
if ($LASTEXITCODE -ne 0) { Stop-Deploy "vercel link failed" }
$linked = Get-Content ".vercel/project.json" -Raw | ConvertFrom-Json
Write-Host "linked project id: $($linked.projectId)"

# 3. environment for Production and Preview (NEXT_PUBLIC_* are baked in at build time)
foreach ($target in @("production", "preview")) {
  foreach ($pair in @(@("NEXT_PUBLIC_SUPABASE_URL", $StagingUrl), @("NEXT_PUBLIC_APP_ENV", "staging"), @("NEXT_PUBLIC_STAGING_MODE", "true"))) {
    npx @vc env rm $pair[0] $target --yes @scopeArgs 2>$null | Out-Null
    $pair[1] | npx @vc env add $pair[0] $target @scopeArgs
    if ($LASTEXITCODE -ne 0) { Stop-Deploy "could not set $($pair[0]) ($target)" }
  }
  # the hand-written commit (da6e930) is removed: /api/version shows the real commit from --build-env below
  npx @vc env rm NEXT_PUBLIC_GIT_COMMIT_SHA $target --yes @scopeArgs 2>$null | Out-Null
  foreach ($secret in @("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY")) {
    Write-Host "`n$secret ($target): paste the STAGING ($StagingRef) value when the Vercel CLI asks." -ForegroundColor Yellow
    npx @vc env rm $secret $target --yes @scopeArgs 2>$null | Out-Null
    npx @vc env add $secret $target @scopeArgs
    if ($LASTEXITCODE -ne 0) { Stop-Deploy "could not set $secret ($target)" }
  }
}

# 4. guard: pulled production env must point at staging only
npx @vc env pull ".vercel/.env.staging-check" --environment=production --yes @scopeArgs | Out-Null
$envText = Get-Content ".vercel/.env.staging-check" -Raw
Remove-Item ".vercel/.env.staging-check" -Force
foreach ($ref in $Forbidden) { if ($envText -match $ref) { Stop-Deploy "a production/JFS value ($ref) is configured in the staging project" } }
if ($envText -notmatch [regex]::Escape($StagingUrl)) { Stop-Deploy "NEXT_PUBLIC_SUPABASE_URL is not the staging URL" }
foreach ($line in ($envText -split "`n" | Where-Object { $_ -match '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' })) {
  $jwt = ($line -split "=", 2)[1].Trim('"', "`r", " ")
  $part = $jwt.Split(".")[1]; $part = $part.Replace("-", "+").Replace("_", "/"); while ($part.Length % 4) { $part += "=" }
  $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part)) | ConvertFrom-Json
  if ($claims.ref -ne $StagingRef) { Stop-Deploy "$(($line -split '=')[0]) belongs to '$($claims.ref)', not staging" }
}
Write-Host "env check: staging only" -ForegroundColor Green

# 5. production deployment of the staging project from this exact commit
npx @vc deploy --prod --yes --build-env "NEXT_PUBLIC_GIT_COMMIT_SHA=$head" @scopeArgs
if ($LASTEXITCODE -ne 0) { Stop-Deploy "vercel deploy failed" }

# 6. verify
Start-Sleep -Seconds 10
$v = Invoke-RestMethod "https://$Project.vercel.app/api/version"
$v | Format-List
if ($v.full_commit -ne $head -or $v.supabase_ref -ne $StagingRef -or $v.env -ne "staging") { Stop-Deploy "/api/version does not show $head / $StagingRef / staging" }
Write-Host "RESULT: STAGING FRONTEND $($head.Substring(0,7)) DEPLOYED (supabase_ref=$StagingRef)" -ForegroundColor Green
