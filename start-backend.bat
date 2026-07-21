@echo off
setlocal
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
  echo Python venv missing. Run setup-local.bat first.
  exit /b 1
)

REM Clear stale uvicorn/reload workers so this process owns port 8000 alone
powershell -NoProfile -Command ^
  "$ErrorActionPreference='SilentlyContinue'; " ^
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'uvicorn(\.exe)? .*app\.main:app' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; " ^
  "Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; " ^
  "Start-Sleep -Seconds 1" >nul 2>&1

set PYTHONPATH=%CD%
REM Single worker (no --reload) for a stable local launch; use start-backend-dev.bat for reload
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
endlocal
