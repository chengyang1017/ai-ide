param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl
)

$ErrorActionPreference = 'Stop'

$Normalized = $ServerUrl.Trim().TrimEnd('/')

if ($Normalized -notmatch '^wss://[A-Za-z0-9.-]+(?::[0-9]+)?(?:/.*)?$') {
  throw 'ServerUrl must start with wss:// and contain a valid public hostname.'
}

Write-Host ('Public collaboration server: ' + $Normalized)

$env:VITE_COLLAB_SERVER_URL = $Normalized

Write-Host '[1/3] TypeScript check'
npm run typecheck
if ($LASTEXITCODE -ne 0) {
  throw 'typecheck failed.'
}

Write-Host '[2/3] Production build'
npm run build
if ($LASTEXITCODE -ne 0) {
  throw 'build failed.'
}

Write-Host '[3/3] Sync Android'
npx cap sync android
if ($LASTEXITCODE -ne 0) {
  throw 'Capacitor sync failed.'
}

Write-Host ''
Write-Host 'DONE'
Write-Host ('Android web assets now default to ' + $Normalized)
Write-Host 'Run: npx cap run android'
