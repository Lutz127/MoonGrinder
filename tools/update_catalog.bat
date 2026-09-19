@echo off
setlocal
if "%~1"=="" (
  echo Usage: drag website_catalog.json onto this file
  echo or run: update_catalog.bat "C:\path\to\website_catalog.json"
  pause
  exit /b 1
)
py -3.11 "%~dp0update_data.py" --source "%~1"
if errorlevel 1 (
  echo.
  echo Catalog update failed.
  pause
  exit /b 1
)
echo.
echo Public catalog updated successfully.
pause
