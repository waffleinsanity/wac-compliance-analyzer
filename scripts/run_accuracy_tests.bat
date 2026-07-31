@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

echo ============================================
echo   WACMAKR - IR accuracy tests (curated)
echo ============================================
echo.

if not exist "backend\.venv\Scripts\python.exe" (
  echo ERROR: backend\.venv not found. Run setup-local.bat first.
  exit /b 1
)

call backend\.venv\Scripts\python.exe -m pip install -q pytest
pushd backend
call .venv\Scripts\python.exe -m pytest -q --tb=short ^
  tests/test_subsection_ranking.py ^
  tests/test_allegation_selection.py ^
  tests/test_allegation_source.py ^
  tests/test_golden_selection.py ^
  tests/test_subsection_ancestors.py ^
  tests/test_quote_verify.py ^
  tests/test_investigate_api.py ^
  tests/test_application_strength_bands.py ^
  tests/test_ir_docx_format.py ^
  tests/test_privacy_gate.py
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
