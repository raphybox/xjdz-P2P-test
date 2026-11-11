@echo off
rem ============================================================
rem  Plan A rollback. 100% ASCII ON PURPOSE (cmd.exe + GBK issue).
rem  Usage:  uninstall.bat            restore admin.html only
rem          uninstall.bat --purge    also remove the y3/ folder
rem ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul
if /i "%~1"=="--purge" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rollback.ps1" "%~dp0" -Purge
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rollback.ps1" "%~dp0"
)
echo.
pause
