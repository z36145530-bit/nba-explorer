@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=python"
where python >nul 2>nul || set "PY=py -3"
if not exist "data\meta.json" echo [提示] 未找到 data\meta.json，请先运行: python prefetch.py 2026 2025 2024
start "" "http://127.0.0.1:8600"
%PY% server.py --port 8600
pause
