@echo off
rem ============================================================
rem  Plan A - Add Y3 fruit editor test tab.
rem  THIS FILE IS 100% ASCII ON PURPOSE.
rem  cmd.exe parses .bat as GBK(936); any UTF-8 Chinese byte in
rem  an echo line swallows the first letter of the NEXT line
rem  (pause -> ause, exit -> xit). Keep this file ASCII only.
rem  Chinese messages live in install.ps1 (UTF-8 with BOM).
rem ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" "%~dp0"
echo.
pause
