@echo off
REM Starts the ScrapSetu API in its own console window.
REM Used by start-scrapsetu.bat. You can also run it directly.
setlocal EnableExtensions
chcp 65001 >nul
title ScrapSetu API - http://127.0.0.1:8000
cd /d "%~dp0..\backend"
set "PYTHONIOENCODING=utf-8"

if not exist "..\.venv\Scripts\python.exe" (
  echo [ERROR] Python virtual environment not found.
  echo Run start-scrapsetu.bat from the repository root first.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo  ScrapSetu API
echo  Docs   : http://127.0.0.1:8000/docs
echo  Health : http://127.0.0.1:8000/health
echo  Stop   : press Ctrl+C in this window
echo ============================================================
echo.

"..\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000

echo.
echo API process stopped.
pause
