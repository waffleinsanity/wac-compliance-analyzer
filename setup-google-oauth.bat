@echo off
cd /d "%~dp0"
set PYTHONPATH=%~dp0backend
set PYTHONUNBUFFERED=1
echo.
echo This will open Google Cloud Console and wait until Sign in with Google works.
echo.
"%~dp0backend\.venv\Scripts\python.exe" -u "%~dp0scripts\setup_google_oauth.py"
echo.
pause
