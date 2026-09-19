@echo off
cd /d "%~dp0\.."
where py >nul 2>nul
if %errorlevel%==0 (
  py tools\time_reviewer.py
) else (
  python tools\time_reviewer.py
)
pause
