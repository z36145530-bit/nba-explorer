@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" http://127.0.0.1:8791/
"C:\Users\24031\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" -m http.server 8791 --bind 127.0.0.1
