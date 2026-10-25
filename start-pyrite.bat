@echo off
rem Runs pyrite at http://localhost:8080 (serve.py makes sure the browser never shows stale files).
cd /d "%~dp0"
title pyrite
echo pyrite is running at http://localhost:8080  (close this window to stop it)
start "" cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8080"
where python >nul 2>nul
if %errorlevel%==0 (python serve.py 8080) else (py serve.py 8080)
