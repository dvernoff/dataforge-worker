@echo off
chcp 65001 >nul
title DataForge Dev
color 0A

echo ═══════════════════════════════════════════
echo   DataForge — Development Launcher
echo ═══════════════════════════════════════════
echo.

cd /d "%~dp0"

:: ── Load .env ──
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    set "line=%%A"
    if not "!line:~0,1!"=="#" (
        set "%%A=%%B"
    )
)
:: Re-read with delayed expansion
setlocal enabledelayedexpansion
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    set "firstchar=%%A"
    set "firstchar=!firstchar:~0,1!"
    if not "!firstchar!"=="#" if not "%%A"=="" (
        set "%%A=%%B"
    )
)

if "%CP_PORT%"=="" set CP_PORT=4000
if "%WN_PORT%"=="" set WN_PORT=4001
if "%FRONTEND_PORT%"=="" set FRONTEND_PORT=3000

:: ── Handle arguments ──
if "%1"=="stop" goto :stop
if "%1"=="infra" goto :infra
if "%1"=="migrate" goto :migrate
if "%1"=="cp" goto :cp
if "%1"=="wn" goto :wn
if "%1"=="fe" goto :fe
if "%1"=="restart" goto :restart

:: ── Default: start all ──

:: 1. Infrastructure
echo [INFRA] Starting PostgreSQL + Redis...
docker compose up -d postgres-control postgres-worker redis
echo [INFRA] Waiting 5s...
timeout /t 5 /nobreak >nul

:: 2. Migrations
echo.
echo [MIGRATE] Running migrations...
call :run_migrations

:: 3. Start services
echo.
call :start_cp
timeout /t 4 /nobreak >nul
call :start_wn
timeout /t 4 /nobreak >nul
call :start_fe
timeout /t 3 /nobreak >nul

echo.
echo ═══════════════════════════════════════════
echo   DataForge is running!
echo ═══════════════════════════════════════════
echo.
echo   Frontend:   http://localhost:%FRONTEND_PORT%
echo   CP Backend: http://localhost:%CP_PORT%
echo   WN Backend: http://localhost:%WN_PORT%
echo.
echo   Login: %ADMIN_EMAIL% / %ADMIN_PASSWORD%
echo.
echo   Commands:
echo     dev.bat stop     — Stop all
echo     dev.bat restart  — Restart backends
echo     dev.bat cp       — Restart CP only
echo     dev.bat wn       — Restart WN only
echo ═══════════════════════════════════════════
echo.
pause
goto :eof

:: ═══════════════════════════════════════════
:: Functions
:: ═══════════════════════════════════════════

:infra
echo [INFRA] Starting PostgreSQL + Redis...
docker compose up -d postgres-control postgres-worker redis
timeout /t 5 /nobreak >nul
docker compose ps
goto :eof

:migrate
call :run_migrations
goto :eof

:run_migrations
set NODE_ENV=development
set DATABASE_URL=%CP_DATABASE_URL%
cd /d "%~dp0control-plane\backend"
echo [MIGRATE] CP migrations + seed...
call npx knex migrate:latest --esm 2>nul || node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest
call npx knex seed:run --esm 2>nul || node --import tsx/esm node_modules/knex/bin/cli.js seed:run
set DATABASE_URL=%WN_DATABASE_URL%
cd /d "%~dp0worker-node\backend"
echo [MIGRATE] WN migrations...
call npx knex migrate:latest --esm 2>nul || node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest
cd /d "%~dp0"
echo [MIGRATE] Done!
goto :eof

:cp
echo [CP] Starting on :%CP_PORT%...
call :start_cp
goto :eof

:start_cp
set NODE_ENV=development
set PORT=%CP_PORT%
set HOST=0.0.0.0
set DATABASE_URL=%CP_DATABASE_URL%
set CORS_ORIGIN=http://localhost:%FRONTEND_PORT%
start "DataForge-CP" cmd /c "cd /d "%~dp0control-plane\backend" && npx tsx src/index.ts"
goto :eof

:wn
echo [WN] Starting on :%WN_PORT%...
call :start_wn
goto :eof

:start_wn
set NODE_ENV=development
set PORT=%WN_PORT%
set HOST=0.0.0.0
set DATABASE_URL=%WN_DATABASE_URL%
set NODE_API_KEY=%WORKER_NODE_API_KEY%
set CONTROL_PLANE_URL=http://127.0.0.1:%CP_PORT%
set NODE_ID=worker-local-1
set CORS_ORIGIN=*
start "DataForge-WN" cmd /c "cd /d "%~dp0worker-node\backend" && npx tsx src/index.ts"
goto :eof

:fe
echo [FE] Starting on :%FRONTEND_PORT%...
call :start_fe
goto :eof

:start_fe
start "DataForge-FE" cmd /c "cd /d "%~dp0control-plane\frontend" && npx vite --port %FRONTEND_PORT%"
goto :eof

:restart
echo [RESTART] Stopping backends...
taskkill /fi "WINDOWTITLE eq DataForge-CP" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq DataForge-WN" /f >nul 2>&1
timeout /t 2 /nobreak >nul
echo [RESTART] Starting backends...
call :start_cp
timeout /t 4 /nobreak >nul
call :start_wn
echo [RESTART] Done!
goto :eof

:stop
echo [STOP] Stopping all DataForge processes...
taskkill /fi "WINDOWTITLE eq DataForge-CP" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq DataForge-WN" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq DataForge-FE" /f >nul 2>&1
echo [STOP] Done!
goto :eof
