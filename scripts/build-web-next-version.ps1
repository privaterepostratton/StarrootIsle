# Emits "version|snapshotPath" for build-web.bat (minor bump per successful build).
# Snapshot path is builds\ (flat — index.html at folder root, no Build-X.Y.Z subfolder).
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$buildsDir = Join-Path $root 'builds'
$versionFile = Join-Path $buildsDir '.version'

if (-not (Test-Path -LiteralPath $buildsDir)) {
  New-Item -ItemType Directory -Path $buildsDir | Out-Null
}

$last = $null
if (Test-Path -LiteralPath $versionFile) {
  $last = (Get-Content -LiteralPath $versionFile -Raw).Trim()
}

if ([string]::IsNullOrWhiteSpace($last)) {
  $next = '1.0.0'
} elseif ($last -match '^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$') {
  $major = [int]$Matches[1]
  $minor = [int]$Matches[2] + 1
  $next = '{0}.{1}.0' -f $major, $minor
} else {
  Write-Error "Invalid builds\.version: '$last' (expected semver like 1.2.0)"
}

# Keep every Build-*.zip — bump patch if this filename already exists.
$zipCandidate = Join-Path $buildsDir ("Build-{0}.zip" -f $next)
while (Test-Path -LiteralPath $zipCandidate) {
  if ($next -match '^(\d+)\.(\d+)\.(\d+)$') {
    $patch = [int]$Matches[3] + 1
    $next = '{0}.{1}.{2}' -f [int]$Matches[1], [int]$Matches[2], $patch
    $zipCandidate = Join-Path $buildsDir ("Build-{0}.zip" -f $next)
  } else {
    Write-Error "Cannot resolve zip name conflict for version '$next'"
  }
}

Write-Output ('{0}|{1}' -f $next, $buildsDir)
