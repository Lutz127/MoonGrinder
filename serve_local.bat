@echo off
cd /d "%~dp0"
echo MoonGrinder is available at http://localhost:8000
echo Press Ctrl+C to stop the local server.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server 8000
) else (
  python -m http.server 8000
)
