@echo off
cd /d "%~dp0"
fc /b package-lock.json node_modules\.installed-lock >nul 2>&1
if errorlevel 1 (
  call npm ci || goto end
  copy /y package-lock.json node_modules\.installed-lock >nul
)
call npm run build || goto end
start "" http://localhost:8765/
call npm start
:end
pause
