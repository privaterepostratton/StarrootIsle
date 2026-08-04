# Mirror dist/ -> builds/ and create a Playgama-safe zip (index.html at archive root, forward slashes only).
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,

  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$dist = Join-Path $root 'dist'
$builds = Join-Path $root 'builds'
$zipPath = Join-Path $builds ("Build-{0}.zip" -f $Version)

if (-not (Test-Path -LiteralPath $dist)) {
  Write-Error 'Missing dist folder - run npm run build:playgama first.'
}

if (-not (Test-Path -LiteralPath $builds)) {
  New-Item -ItemType Directory -Path $builds | Out-Null
}

# Wipe prior snapshot files in builds\; keep .version and all Build-*.zip archives.
Write-Host '[publish-web-build] Clearing old snapshot files in builds\...'

Get-ChildItem -LiteralPath $builds -Force |
  Where-Object { $_.Name -ne '.version' -and $_.Name -notlike 'Build-*.zip' } |
  ForEach-Object {
    $target = $_.FullName
    if ($_.PSIsContainer) {
      cmd /c "attrib -R `"$target\*.*`" /S /D" 2>$null | Out-Null
    } else {
      attrib -R $target 2>$null | Out-Null
    }
    $name = $_.Name
    try {
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    } catch {
      Write-Warning "[publish-web-build] Could not remove locked item: $name - overlaying from dist instead."
    }
  }

Write-Host '[publish-web-build] Copying dist -> builds...'

# /E + /IS overlays files even when a prior snapshot folder could not be deleted.
& robocopy $dist $builds /E /IS /COPY:DAT /DCOPY:DA /R:0 /W:0 /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 16) {
  Write-Error "robocopy failed with exit code $robocopyExit"
} elseif ($robocopyExit -ge 8) {
  Write-Warning "[publish-web-build] robocopy reported partial errors (exit $robocopyExit); continuing to zip from dist."
}

Write-Host '[publish-web-build] Creating zip (index.html at root, forward-slash paths for CDN)...'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Add-FolderToZip {
  param(
    [System.IO.Compression.ZipArchive]$Archive,
    [string]$SourceDir,
    [string]$EntryPrefix = ''
  )

  foreach ($item in Get-ChildItem -LiteralPath $SourceDir -Force) {
    # never ship build metadata / old archives inside the game zip
    if ($item.Name -eq '.version' -or $item.Name -like 'Build-*.zip') { continue }

    $entryName = if ($EntryPrefix) { "$EntryPrefix/$($item.Name)" } else { $item.Name }
    $entryName = $entryName.Replace('\', '/')

    if ($item.PSIsContainer) {
      Add-FolderToZip -Archive $Archive -SourceDir $item.FullName -EntryPrefix $entryName
      continue
    }

    $entry = $Archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    try {
      $fileStream = [System.IO.File]::OpenRead($item.FullName)
      try {
        $fileStream.CopyTo($entryStream)
      } finally {
        $fileStream.Dispose()
      }
    } finally {
      $entryStream.Dispose()
    }
  }
}

if (Test-Path -LiteralPath $zipPath) {
  Write-Error "Refusing to overwrite existing zip: $zipPath (version bump should avoid this)"
}

# Always zip from dist (source of truth) so a locked builds\ snapshot cannot corrupt the archive.
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Add-FolderToZip -Archive $zip -SourceDir $dist
} finally {
  $zip.Dispose()
}

# Sanity: zip must contain index.html at archive root
$check = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $hasIndex = $false
  $hasAssets = $false
  foreach ($e in $check.Entries) {
    if ($e.FullName -eq 'index.html') { $hasIndex = $true }
    if ($e.FullName -like 'assets/*') { $hasAssets = $true }
  }
  if (-not $hasIndex -or -not $hasAssets) {
    Write-Error 'Zip is missing index.html or assets/ — refuse to publish a broken build.'
  }
} finally {
  $check.Dispose()
}

Write-Host ('[publish-web-build] OK -> {0}/index.html' -f $builds)
Write-Host ('[publish-web-build] OK -> {0}' -f $zipPath)
