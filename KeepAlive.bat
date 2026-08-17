@echo off
setlocal
cd /d "%~dp0"
title WACMAKR Keep-Alive

REM Single-instance: if another KeepAlive/ensure-stack watch is running, exit.
powershell -NoProfile -Command ^
  "$ErrorActionPreference='SilentlyContinue'; " ^
  "$mine=$PID; " ^
  "$others=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $mine -and $_.CommandLine -match 'ensure-stack\.ps1.*-Watch' }; " ^
  "if ($others) { exit 2 }"
if errorlevel 2 (
  echo Keep-Alive already running. Exiting.
  exit /b 0
)

echo Keeping API (:8000) and UI (:5173) healthy. Close this window to stop watching.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-stack.ps1" -Watch -IntervalSeconds 25
endlocal
