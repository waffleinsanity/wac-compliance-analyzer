@echo off
setlocal
cd /d "%~dp0frontend"

if not exist "node_modules" (
  echo Frontend dependencies missing. Run setup-local.bat first.
  exit /b 1
)

REM Free port 5173 if a stale Vite is still holding it
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

REM host 0.0.0.0 so both http://localhost:5173 and http://127.0.0.1:5173 work
call npm run dev -- --host 0.0.0.0 --port 5173
endlocal
