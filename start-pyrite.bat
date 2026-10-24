@echo off
rem Serves this folder at http://localhost:8080 so the games can load their files.
cd /d "%~dp0"
title pyrite
echo pyrite is running at http://localhost:8080  (close this window to stop it)
start "" cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8080"
where python >nul 2>nul
if %errorlevel%==0 (python -m http.server 8080) else (py -m http.server 8080)
