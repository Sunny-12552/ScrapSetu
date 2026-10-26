@echo off
REM Starts the ScrapSetu web dev server in its own console window.
REM Used by start-scrapsetu.bat. You can also run it directly.
setlocal EnableExtensions
chcp 65001 >nul
title ScrapSetu Web - http://localhost:5173
cd /d "%~dp0..\frontend"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js/npm was not found on PATH.
  echo Install Node.js 20 or newer from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo  ScrapSetu Web
echo  App    : http://localhost:5173
echo  Stop   : press Ctrl+C in this window
echo ============================================================
echo.

call npm run dev

echo.
echo Web process stopped.
pause
