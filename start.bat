@echo off
cd /d "%~dp0"
start "" http://localhost:8765/
where py >nul 2>nul && (py -3 serve.py 8765) || (python serve.py 8765)
pause
