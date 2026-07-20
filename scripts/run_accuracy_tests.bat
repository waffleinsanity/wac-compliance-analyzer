@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

echo ============================================
echo   WACMAKR - IR accuracy tests (pytest)
echo ============================================
echo.

if not exist "backend\.venv\Scripts\python.exe" (
  echo ERROR: backend\.venv not found. Run setup-local.bat first.
  exit /b 1
)

call backend\.venv\Scripts\python.exe -m pip install -q pytest
pushd backend
call .venv\Scripts\python.exe -m pytest -q
set ERR=%ERRORLEVEL%
popd
if %ERR% NEQ 0 (
  echo.
  echo Accuracy tests FAILED.
  exit /b %ERR%
)
echo.
echo Accuracy tests PASSED.
exit /b 0
