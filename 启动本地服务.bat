@echo off
setlocal

echo ============================================
echo   XuanJi Pinball - Local Dev Server
echo ============================================
echo.

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node" || (
  for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%D\node.exe" set "NODE_EXE=%%D\node.exe"
  )
)
if not defined NODE_EXE (
  echo [ERROR] node.exe not found. Install Node.js or run inside WorkBuddy.
  pause
  exit /b 1
)

cd /d "%~dp0"

echo node found: %NODE_EXE%
echo working dir: %CD%
echo.
echo Starting local server on port 8787 ...
echo It will open: http://127.0.0.1:8787/launcher.html
echo.
echo To stop: close this window, or click "Stop Service" in the page.
echo ============================================
echo.

"%NODE_EXE%" server.js

echo.
echo ============================================
echo Server stopped.
echo ============================================
pause
endlocal
