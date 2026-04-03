# ═══════════════════════════════════════════
# DataForge — Local Development Launcher
# ═══════════════════════════════════════════
# Usage: .\dev.ps1 [command]
#   .\dev.ps1          — Start everything
#   .\dev.ps1 infra    — Only Docker infra
#   .\dev.ps1 migrate  — Run migrations + seed
#   .\dev.ps1 cp       — Only CP backend
#   .\dev.ps1 wn       — Only Worker backend
#   .\dev.ps1 fe       — Only Frontend
#   .\dev.ps1 stop     — Stop everything

param([string]$Command = "all")

$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot

function Fallback($val, $default) { if ($val) { $val } else { $default } }

# ── Load .env ──
$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $val = $matches[2].Trim().Trim('"')
            [Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
    Write-Host "[OK] .env loaded" -ForegroundColor Green
}

$CpPort = Fallback $env:CP_PORT "4000"
$WnPort = Fallback $env:WN_PORT "4001"
$FePort = Fallback $env:FRONTEND_PORT "3000"

# ── Env builders ──
function Set-CpEnv {
    $env:NODE_ENV = "development"
    $env:PORT = $CpPort
    $env:HOST = "0.0.0.0"
    $env:DATABASE_URL = $env:CP_DATABASE_URL
    $env:CORS_ORIGIN = "http://localhost:$FePort"
}

function Set-WnEnv {
    $env:NODE_ENV = "development"
    $env:PORT = $WnPort
    $env:HOST = "0.0.0.0"
    $env:DATABASE_URL = $env:WN_DATABASE_URL
    $env:NODE_API_KEY = $env:WORKER_NODE_API_KEY
    $env:CONTROL_PLANE_URL = "http://127.0.0.1:$CpPort"
    $env:NODE_ID = "worker-local-1"
    $env:CORS_ORIGIN = "*"
}

function Start-Infra {
    Write-Host "`n[INFRA] Starting PostgreSQL + Redis..." -ForegroundColor Cyan
    Set-Location $Root
    docker compose up -d postgres-control postgres-worker redis
    Write-Host "[INFRA] Waiting 5s..." -ForegroundColor Cyan
    Start-Sleep 5
    docker compose ps
}

function Run-Migrations {
    Write-Host "`n[MIGRATE] CP migrations..." -ForegroundColor Cyan
    Set-CpEnv
    Set-Location (Join-Path $Root "control-plane\backend")
    node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest

    Write-Host "[MIGRATE] CP seed..." -ForegroundColor Cyan
    node --import tsx/esm node_modules/knex/bin/cli.js seed:run

    Write-Host "[MIGRATE] WN migrations..." -ForegroundColor Cyan
    Set-WnEnv
    Set-Location (Join-Path $Root "worker-node\backend")
    node --import tsx/esm node_modules/knex/bin/cli.js migrate:latest

    Set-Location $Root
    Write-Host "[MIGRATE] Done!" -ForegroundColor Green
}

function Start-CP {
    Write-Host "`n[CP] Starting on :$CpPort..." -ForegroundColor Yellow
    Set-CpEnv
    $cpDir = Join-Path $Root "control-plane\backend"
    Start-Process -NoNewWindow -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$cpDir`" && npx tsx src/index.ts"
}

function Start-WN {
    Write-Host "`n[WN] Starting on :$WnPort..." -ForegroundColor Magenta
    Set-WnEnv
    $wnDir = Join-Path $Root "worker-node\backend"
    Start-Process -NoNewWindow -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$wnDir`" && npx tsx src/index.ts"
}

function Start-Frontend {
    Write-Host "`n[FE] Starting on :$FePort..." -ForegroundColor Blue
    $feDir = Join-Path $Root "control-plane\frontend"
    Start-Process -NoNewWindow -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$feDir`" && npx vite --port $FePort"
}

function Stop-All {
    Write-Host "`n[STOP] Stopping all node processes..." -ForegroundColor Red
    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "[STOP] Done" -ForegroundColor Red
}

# ── Main ──
switch ($Command) {
    "infra"   { Start-Infra }
    "migrate" { Run-Migrations }
    "cp"      { Start-CP }
    "wn"      { Start-WN }
    "fe"      { Start-Frontend }
    "stop"    { Stop-All }
    "all" {
        Start-Infra
        Start-Sleep 3
        Run-Migrations
        Start-Sleep 2
        Start-CP
        Start-Sleep 5
        Start-WN
        Start-Sleep 5
        Start-Frontend
        Start-Sleep 3

        Write-Host ""
        Write-Host "===========================================" -ForegroundColor Green
        Write-Host "  DataForge is running!" -ForegroundColor Green
        Write-Host "===========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Frontend:   http://localhost:$FePort" -ForegroundColor White
        Write-Host "  CP Backend: http://localhost:$CpPort" -ForegroundColor White
        Write-Host "  WN Backend: http://localhost:$WnPort" -ForegroundColor White
        Write-Host ""
        Write-Host "  Login: $env:ADMIN_EMAIL / $env:ADMIN_PASSWORD" -ForegroundColor White
        Write-Host ""
        Write-Host "  Stop: .\dev.ps1 stop" -ForegroundColor DarkGray
        Write-Host "===========================================" -ForegroundColor Green
    }
    default {
        Write-Host "Usage: .\dev.ps1 [all|infra|migrate|cp|wn|fe|stop]"
    }
}
