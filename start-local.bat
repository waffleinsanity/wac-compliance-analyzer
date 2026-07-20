@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo Local environment not set up yet. Running setup-local.bat...
  call setup-local.bat
  if errorlevel 1 exit /b 1
)

if not exist "frontend\node_modules" (
  echo Frontend dependencies missing. Running setup-local.bat...
  call setup-local.bat
  if errorlevel 1 exit /b 1
)

echo Starting local WACMAKR...
echo   API: http://127.0.0.1:8000
echo   UI:  http://127.0.0.1:5173
echo.

start "WAC API" cmd /k "%~dp0start-backend.bat"
ping -n 4 127.0.0.1 >nul
start "WAC UI" cmd /k "%~dp0start-frontend.bat"

echo Both local servers launched in separate windows.
echo Close those windows to stop the app.
endlocal
