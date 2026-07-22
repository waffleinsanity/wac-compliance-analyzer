@echo off
setlocal
cd /d "%~dp0"
title WACMAKR Keep-Alive
echo Keeping API (:8000) and UI (:5173) healthy. Close this window to stop watching.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-stack.ps1" -Watch -IntervalSeconds 20 -OpenBrowser
endlocal
