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
  "$ErrorActionPreference='SilentlyContinue'; " ^
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'uvicorn(\.exe)? .*app\.main:app|vite\.js.*--port 5173' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; " ^
  "foreach ($port in 8000,5173) { Get-NetTCPConnection -LocalPort $port -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } }; " ^
  "Start-Sleep -Seconds 2" >nul 2>&1

echo Starting API  -^> http://127.0.0.1:8000
start "WAC API" cmd /k call "%~dp0start-backend.bat"

echo Starting UI   -^> http://localhost:5173
start "WAC UI" cmd /k call "%~dp0start-frontend.bat"

echo.
echo Waiting for the API to become ready...
set API_READY=0
set TRASH_OK=0
set /a api_tries=0

:WAIT_API
set /a api_tries+=1
if %api_tries% GTR 40 goto API_TIMEOUT
powershell -NoProfile -Command "try { $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2; if ($h.status -eq 'ok') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  ping -n 2 127.0.0.1 >nul
  goto WAIT_API
)
set API_READY=1
echo API health check passed.

powershell -NoProfile -Command "try { $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 5; if ($h.features.case_trash -eq $true) { exit 0 }; $o = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 5; if ($o.paths.'/api/cases/{case_id}/trash') { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto API_TRASH_FAIL
set TRASH_OK=1
goto WAIT_UI

:API_TIMEOUT
echo.
echo ============================================================
echo   ERROR: API did not become ready on http://127.0.0.1:8000
echo ============================================================
echo   Close any other "WAC API" or uvicorn windows, then re-run Launch.bat.
echo   The UI may still start, but the app will not work until the API is healthy.
echo ============================================================
echo.
goto WAIT_UI

:API_TRASH_FAIL
echo.
echo ============================================================
echo   ERROR: API is running but case-trash capability is missing
echo ============================================================
echo   You may have a stale API process on port 8000.
echo   Close ALL other "WAC API" or uvicorn windows, then re-run Launch.bat.
echo   Expected: GET /api/health features.case_trash=true
echo ============================================================
echo.
goto WAIT_UI

:WAIT_UI
echo Waiting for the UI to become ready...
set /a tries=0

:WAIT_UI_LOOP
set /a tries+=1
if %tries% GTR 40 goto OPEN_ANYWAY
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  ping -n 2 127.0.0.1 >nul
  goto WAIT_UI_LOOP
)

if "%API_READY%"=="0" goto SKIP_BROWSER
if "%TRASH_OK%"=="0" (
  echo.
  echo WARNING: Opening UI, but the API is not fully healthy — see errors above.
  echo.
)
echo Opening http://localhost:5173
REM Cache-bust so a broken prior HMR session cannot stick
for /f %%i in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set TS=%%i
start "" "http://localhost:5173/?v=%TS%"
goto DONE

:OPEN_ANYWAY
if "%API_READY%"=="0" (
  echo.
  echo UI is still starting, but the API never became ready — not opening the browser.
  echo Fix the API errors above, then open http://localhost:5173 manually or re-run Launch.bat.
  echo.
  goto DONE
)
echo UI is still starting. Opening the browser anyway...
if "%TRASH_OK%"=="0" (
  echo WARNING: API case-trash capability was not verified — see errors above.
)
start "" "http://localhost:5173"

:SKIP_BROWSER
if "%API_READY%"=="0" goto DONE

:DONE
echo.
echo Application launched.
echo   - Keep the "WAC API" and "WAC UI" windows open while using the app.
echo Starting keep-alive watcher (single instance; auto-restarts if API/UI die)...
start "WAC KeepAlive" /MIN cmd /c call "%~dp0KeepAlive.bat"
echo   - Sign in: admin / ChangeMeAdmin1!
echo.
pause
endlocal
