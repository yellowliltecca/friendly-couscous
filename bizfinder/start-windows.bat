@echo off
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
start "BIZFINDER" cmd /k "node server.js"
timeout /t 2 >nul
start http://localhost:8787
