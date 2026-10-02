@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js が入っていません。開いたページから LTS 版を入れてから、もう一度起動してください。
  start "" https://nodejs.org/
  goto end
)
node -e "const [a, b] = process.versions.node.split('.').map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)"
if errorlevel 1 (
  echo Node.js が古いです（必要: 22.18 以上）。開いたページから LTS 版を入れ直してください。
  node -v
  start "" https://nodejs.org/
  goto end
)
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
