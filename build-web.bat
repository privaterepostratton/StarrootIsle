@echo off
REM Launches the web build in its own terminal window (double-click safe).
if /I not "%~1"=="_run" (
  start "Sprout Valley - Web Build" cmd /k "%~f0" _run
  exit /b 0
)

REM Full dist snapshot -> builds\ (index.html at folder root; versioned zip for portal upload).
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [build-web] ERROR: node is not on PATH. Install Node.js, then retry.
  goto :fail
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [build-web] ERROR: npm is not on PATH. Install Node.js, then retry.
  goto :fail
)

if not exist "node_modules\vite" (
  echo [build-web] Installing npm dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

for /f "usebackq tokens=1* delims=|" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-web-next-version.ps1" "%CD%"`) do (
  set "BUILD_VER=%%A"
  set "BUILD_OUT=%%B"
)

if not defined BUILD_VER (
  echo [build-web] ERROR: could not resolve next build version.
  goto :fail
)

echo.
echo [build-web] Version !BUILD_VER! - snapshot: builds\  (index.html at root)
echo [build-web] Typecheck...
echo.

call npx tsc --noEmit -p tsconfig.json
if errorlevel 1 (
  echo [build-web] ERROR: typecheck failed. Fix the errors above before shipping.
  goto :fail
)

echo.
echo [build-web] Tests...
echo.

call npm test
if errorlevel 1 (
  echo [build-web] ERROR: tests failed.
  goto :fail
)

echo.
echo [build-web] Vite production build (web / offline client)...
echo.

call npm run build
if errorlevel 1 goto :fail

if not exist "dist\index.html" (
  echo [build-web] ERROR: dist\index.html missing after vite build.
  goto :fail
)

REM Catch absolute /assets paths - those break portal CDN / subdirectory hosting.
findstr /C:"src=\"/assets/" /C:"href=\"/assets/" "dist\index.html" >nul 2>&1
if not errorlevel 1 (
  echo [build-web] ERROR: dist\index.html still uses absolute /assets/ URLs.
  echo             Set vite base to './' so the zip is runnable off a CDN.
  goto :fail
)

REM And the same for runtime asset URLs. `base` only rewrites what vite owns -
REM a path handed to a loader at runtime is just a string, and an absolute one
REM resolves against the CDN root, so the game loads and the world is empty.
findstr /R /C:"\"/models/" /C:"\"/textures/" /C:"\"/ui/" /C:"\"/audio/" "dist\assets\*.js" >nul 2>&1
if not errorlevel 1 (
  echo [build-web] ERROR: the bundle still fetches assets by absolute path.
  echo             Route them through asset() in src/core/assets.ts.
  goto :fail
)
findstr /C:"url(/" "dist\assets\*.css" >nul 2>&1
if not errorlevel 1 (
  echo [build-web] ERROR: bundled CSS still references absolute url(/...) assets.
  goto :fail
)

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-web-build.ps1" -ProjectRoot "%CD%" -Version "!BUILD_VER!"
if errorlevel 1 goto :fail

if not exist "builds\index.html" (
  echo [build-web] ERROR: builds\index.html missing after publish.
  goto :fail
)
if not exist "builds\Build-!BUILD_VER!.zip" (
  echo [build-web] ERROR: builds\Build-!BUILD_VER!.zip was not created.
  goto :fail
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Content -LiteralPath '%CD%\builds\.version' -Value '!BUILD_VER!' -NoNewline"

echo.
echo [build-web] OK. Working tree export: dist
echo           Snapshot folder: !BUILD_OUT!\  (index.html at root)
echo           Zip archive:     builds\Build-!BUILD_VER!.zip  (new file; older Build-*.zip kept)
echo           builds\.version updated to !BUILD_VER! - next run bumps the minor version.
echo           Preview locally:  npx --yes serve builds
echo.
pause
exit /b 0

:fail
echo.
echo [build-web] FAILED - snapshot, zip, and builds\.version were not updated.
echo.
pause
exit /b 1
