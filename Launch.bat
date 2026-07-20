@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title WACMAKR Launcher

echo ============================================
echo   WACMAKR - Local Launch
echo ============================================
echo.

if not exist "backend\.venv\Scripts\python.exe" goto NEED_SETUP
if not exist "frontend\node_modules" goto NEED_SETUP
goto START_APP

:NEED_SETUP
echo First-time setup required. Installing local dependencies...
echo.
call "%~dp0setup-local.bat"
if errorlevel 1 (
  echo.
  echo Setup failed. Fix the errors above, then run this launcher again.
  pause
  exit /b 1
)
echo.

:START_APP
echo Stopping any stale API/UI processes on ports 8000 and 5173...
powershell -NoProfile -Command ^
  "$ports = 8000,5173; foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }; Start-Sleep -Seconds 1" >nul 2>&1

echo Starting API  -^> http://127.0.0.1:8000
start "WAC API" cmd /k call "%~dp0start-backend.bat"

echo Starting UI   -^> http://localhost:5173
start "WAC UI" cmd /k call "%~dp0start-frontend.bat"

echo.
echo Waiting for the UI to become ready...
set /a tries=0

:WAIT_UI
set /a tries+=1
if %tries% GTR 40 goto OPEN_ANYWAY
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  ping -n 2 127.0.0.1 >nul
  goto WAIT_UI
)

echo Opening http://localhost:5173
REM Cache-bust so a broken prior HMR session cannot stick
for /f %%i in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set TS=%%i
start "" "http://localhost:5173/?v=%TS%"
goto DONE

:OPEN_ANYWAY
echo UI is still starting. Opening the browser anyway...
start "" "http://localhost:5173"

:DONE
echo.
echo Application launched.
echo   - Keep the "WAC API" and "WAC UI" windows open while using the app.
echo   - Close those windows to stop the application.
echo   - Sign in: admin / ChangeMeAdmin1!
echo.
pause
endlocal
