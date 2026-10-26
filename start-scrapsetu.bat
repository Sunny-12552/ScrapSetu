@echo off
setlocal EnableExtensions
chcp 65001 >nul
title ScrapSetu - one-click launcher
cd /d "%~dp0"

set "ROOT=%CD%"
set "VENV=%ROOT%\.venv"
set "PY=%VENV%\Scripts\python.exe"
set "FORCE=0"
if /i "%~1"=="--update" set "FORCE=1"

echo.
echo  ============================================================
echo    ScrapSetu - local development launcher
echo  ============================================================
echo  Repository : %ROOT%
echo.

REM ---------------------------------------------------------------------------
REM 1. Python
REM ---------------------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  echo         Install Node.js 20.19+ or 22.12+ from https://nodejs.org/
  goto :fail
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=12)||(v[0]===20&&v[1]>=19)?0:1)"
if errorlevel 1 (
  echo [ERROR] Node.js 20.19+ or 22.12+ is required by Vite 7.
  echo         Your version:
  node --version
  goto :fail
)

if exist "%PY%" goto :python_ready

set "BOOT="
where py >nul 2>nul && set "BOOT=py -3"
if not defined BOOT (
  where python >nul 2>nul && set "BOOT=python"
)
if not defined BOOT (
  echo [ERROR] Python 3.11+ was not found on PATH.
  echo         Install Python 3.12 from https://www.python.org/downloads/windows/
  echo         and tick "Add python.exe to PATH" during setup.
  goto :fail
)

%BOOT% -c "import sys;sys.exit(0 if sys.version_info>=(3,11) else 1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python 3.11+ is required. Found:
  %BOOT% --version
  goto :fail
)

echo [1/6] Creating the Python virtual environment in .venv ...
%BOOT% -m venv "%VENV%"
if errorlevel 1 (
  echo [ERROR] Could not create the virtual environment.
  goto :fail
)

:python_ready

REM ---------------------------------------------------------------------------
REM 2. Environment file
REM ---------------------------------------------------------------------------
if not exist "%ROOT%\.env" (
  copy /y "%ROOT%\.env.example" "%ROOT%\.env" >nul
  echo [2/6] Created .env from .env.example ^(development defaults^).
) else (
  echo [2/6] Using the existing .env file.
)

REM ---------------------------------------------------------------------------
REM 3. Python dependencies
REM ---------------------------------------------------------------------------
if "%FORCE%"=="1" goto :install_python_deps
if not exist "%VENV%\.scrapsetu-deps" goto :install_python_deps
echo [3/6] Python dependencies already installed.
goto :python_deps_done

:install_python_deps
echo [3/6] Installing Python dependencies ^(first run can take a few minutes^) ...
"%PY%" -m pip install --disable-pip-version-check --quiet --upgrade pip
"%PY%" -m pip install --disable-pip-version-check -r "%ROOT%\backend\requirements.txt"
if errorlevel 1 (
  echo [ERROR] Python dependency installation failed.
  goto :fail
)
> "%VENV%\.scrapsetu-deps" echo installed
:python_deps_done

REM ---------------------------------------------------------------------------
REM 4. Frontend dependencies
REM ---------------------------------------------------------------------------
if "%FORCE%"=="1" goto :install_web_deps
if not exist "%ROOT%\frontend\node_modules" goto :install_web_deps
echo [4/6] Frontend dependencies already installed.
goto :web_deps_done

:install_web_deps
echo [4/6] Installing frontend dependencies ^(first run can take a few minutes^) ...
pushd "%ROOT%\frontend"
if exist package-lock.json (
  call npm ci --no-audit --no-fund
) else (
  call npm install --no-audit --no-fund
)
if errorlevel 1 (
  popd
  echo [ERROR] Frontend dependency installation failed.
  goto :fail
)
popd
:web_deps_done

REM ---------------------------------------------------------------------------
REM 5. Database migrations + demo data (idempotent)
REM ---------------------------------------------------------------------------
echo [5/6] Applying database migrations and demo data ...
pushd "%ROOT%\backend"
"%PY%" -m alembic upgrade head
if errorlevel 1 (
  popd
  echo [ERROR] Database migration failed. Check DATABASE_URL in .env.
  goto :fail
)
"%PY%" -m app.cli seed-demo
if errorlevel 1 (
  echo [WARN] Demo seeding was skipped or failed. The app can still start.
  echo        Run "python -m app.cli seed-demo" in backend\ for details.
)
popd

REM ---------------------------------------------------------------------------
REM 6. Start API and web app
REM ---------------------------------------------------------------------------
echo [6/6] Starting the API and web app ...
echo.

netstat -ano | findstr /C:":8000" | findstr /C:"LISTENING" >nul
if errorlevel 1 (
  start "ScrapSetu API" "%COMSPEC%" /k call "%ROOT%\scripts\run-api.bat"
) else (
  echo   An API is already listening on port 8000; reusing it.
)

netstat -ano | findstr /C:":5173" | findstr /C:"LISTENING" >nul
if errorlevel 1 (
  start "ScrapSetu Web" "%COMSPEC%" /k call "%ROOT%\scripts\run-web.bat"
) else (
  echo   A web server is already listening on port 5173; reusing it.
)

echo.
echo   Waiting for the API and web app to become ready ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(120); while((Get-Date) -lt $deadline){ $ok=$true; foreach($u in @('http://127.0.0.1:8000/health','http://localhost:5173/')){ try{ $r=Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 2; if($r.StatusCode -ne 200){ $ok=$false } }catch{ $ok=$false } }; if($ok){ exit 0 }; Start-Sleep -Milliseconds 750 }; exit 1"

if errorlevel 1 (
  echo.
  echo [WARN] The servers did not report ready within 120 seconds.
  echo        Look at the "ScrapSetu API" and "ScrapSetu Web" windows for errors.
  echo        Opening the web app anyway...
)

start "" "http://localhost:5173"

echo.
echo  ============================================================
echo    ScrapSetu is running
echo  ============================================================
echo    Web app  : http://localhost:5173
echo    API docs : http://127.0.0.1:8000/docs
echo    Health   : http://127.0.0.1:8000/health
echo.
echo    Demo sign-in ^(development OTP is shown in the browser^):
echo      Customer : 9000000001  or  9000000002
echo      Dealer   : 9000000101  or  9000000102  ^(approved^)
echo      Dealer   : 9000000103  ^(pending verification^)
echo      Admin    : 9000000999
echo.
echo    Keep the "ScrapSetu API" and "ScrapSetu Web" windows open.
echo    Close them (or press Ctrl+C in each) to stop ScrapSetu.
echo.
echo    Re-run with  start-scrapsetu.bat --update  after changing
echo    requirements.txt or package.json.
echo  ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo  Setup failed. Fix the error above and run this file again.
echo.
pause
exit /b 1
