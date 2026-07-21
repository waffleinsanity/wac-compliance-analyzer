@echo off
setlocal
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
  echo Python venv missing. Run setup-local.bat first.
  exit /b 1
)

powershell -NoProfile -Command ^
  "$ErrorActionPreference='SilentlyContinue'; " ^
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'uvicorn(\.exe)? .*app\.main:app' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; " ^
  "Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; " ^
  "Start-Sleep -Seconds 1" >nul 2>&1

set PYTHONPATH=%CD%
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
endlocal
