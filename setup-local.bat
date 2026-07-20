@echo off
setlocal
cd /d "%~dp0"

echo === WACMAKR - local setup ===
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo ERROR: Python not found on PATH.
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found on PATH.
  exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  python -m venv backend\.venv
  if errorlevel 1 (
    echo ERROR: Failed to create venv.
    exit /b 1
  )
)

echo Installing backend dependencies...
call backend\.venv\Scripts\python.exe -m pip install --upgrade pip
call backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if errorlevel 1 (
  echo ERROR: Backend dependency install failed.
  exit /b 1
)

if not exist "backend\.env" (
  if exist "backend\.env.example" (
    copy /Y "backend\.env.example" "backend\.env" >nul
    echo Created backend\.env from .env.example
  )
)

echo Installing frontend dependencies...
pushd frontend
call npm install
if errorlevel 1 (
  popd
  echo ERROR: Frontend dependency install failed.
  exit /b 1
)
popd

echo.
echo Local setup complete.
echo   start-local.bat     - run API + UI together
echo   start-backend.bat   - API only  http://127.0.0.1:8000
echo   start-frontend.bat  - UI only   http://127.0.0.1:5173
echo.
endlocal
