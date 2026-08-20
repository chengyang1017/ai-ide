param(
  [string]$ServerUrl = 'wss://ai-ide-collab.onrender.com'
)

$ErrorActionPreference = 'Stop'

$Normalized = $ServerUrl.Trim().TrimEnd('/')

if ($Normalized -notmatch '^wss://[A-Za-z0-9.-]+(?::[0-9]+)?(?:/.*)?$') {
  throw 'ServerUrl must be a valid wss:// URL.'
}

Write-Host ('Windows installer collaboration server: ' + $Normalized)

$env:VITE_COLLAB_SERVER_URL = $Normalized

Write-Host '[1/3] TypeScript check'
npm run typecheck
if ($LASTEXITCODE -ne 0) {
  throw 'typecheck failed.'
}

Write-Host '[2/3] Production web build'
npm run build
if ($LASTEXITCODE -ne 0) {
  throw 'Vite build failed.'
}

Write-Host '[3/3] Build Windows NSIS installer'
npm run package:win
if ($LASTEXITCODE -ne 0) {
  throw 'Windows installer build failed.'
}

$Setup = Get-ChildItem `
  -LiteralPath 'release' `
  -Filter 'Code-Tutor-IDE-Setup-*.exe' `
  -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Setup) {
  throw 'Installer build completed but setup EXE was not found.'
}

Write-Host ''
Write-Host 'DONE WINDOWS INSTALLER'
Write-Host ('Installer: ' + $Setup.FullName)
