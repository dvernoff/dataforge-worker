# =====================================================
# DataForge Worker Node Installer (Windows)
# =====================================================
# Usage:
#   .\install-worker.ps1 -Token "TOKEN" -CpUrl "URL"
#   .\install-worker.ps1 -Token "TOKEN" -CpUrl "URL" -Dev
# =====================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Token,

    [Parameter(Mandatory=$true)]
    [string]$CpUrl,

    [switch]$Dev
)

$ErrorActionPreference = "Stop"

function Log($msg) { Write-Host "[DataForge] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[Warning] $msg" -ForegroundColor Yellow }
function Err($msg) { Write-Host "[Error] $msg" -ForegroundColor Red; exit 1 }

Log "DataForge Worker Node Installer (Windows)"
Log "Control Plane: $CpUrl"
if ($Dev) { Log "Mode: Development (local build)" }

# ── Check Docker ─────────────────────────────────────

try {
    $dockerVersion = docker --version 2>&1
    Log "Docker found: $dockerVersion"
} catch {
    Err "Docker is not installed. Install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/"
}

try {
    docker compose version | Out-Null
} catch {
    Err "Docker Compose is not available. Update Docker Desktop."
}

# ── Resolve project root (dev mode) ─────────────────

$ProjectRoot = $null
if ($Dev) {
    # Try to find project root relative to script location
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $candidate = Split-Path -Parent $ScriptDir
    $dockerfile = Join-Path $candidate "worker-node\backend\Dockerfile"
    if (Test-Path $dockerfile) {
        $ProjectRoot = $candidate
        Log "Project root: $ProjectRoot"
    } else {
        Err "Cannot find project root. Run this script from the dataforge/scripts directory with -Dev flag."
    }
}

# ── Create install directory ─────────────────────────

$InstallDir = Join-Path $env:USERPROFILE "dataforge-worker"
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}
Set-Location $InstallDir

Log "Installing to: $InstallDir"

# ── Generate passwords ───────────────────────────────

function RandomHex($bytes) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] $bytes
    $rng.GetBytes($buf)
    return ($buf | ForEach-Object { $_.ToString("x2") }) -join ''
}

$DbPassword = RandomHex 24
$RedisPassword = RandomHex 16
$JwtSecret = RandomHex 32

# ── Detect worker URL ────────────────────────────────

$WorkerPort = 4001
if ($Dev) {
    $WorkerUrl = "http://host.docker.internal:${WorkerPort}"
    Log "Dev mode: using host.docker.internal"
} else {
    try {
        $PublicIp = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 5)
    } catch {
        $PublicIp = "127.0.0.1"
        Warn "Could not detect public IP, using 127.0.0.1"
    }
    $WorkerUrl = "http://${PublicIp}:${WorkerPort}"
}

Log "Worker URL: $WorkerUrl"

# ── Register with Control Plane ──────────────────────

Log "Registering with Control Plane..."

try {
    $body = @{
        setup_token = $Token
        worker_url  = $WorkerUrl
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$CpUrl/internal/node-register" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body
} catch {
    Err "Failed to register with Control Plane. Check your token and URL. Error: $_"
}

$NodeApiKey = $response.api_key
$NodeId = $response.node_id

if (-not $NodeApiKey) {
    Err "Failed to get API key from Control Plane."
}

Log "Registered successfully! Node ID: $NodeId"

# ── Build image (dev mode) ───────────────────────────

$WorkerImage = "ghcr.io/dataforge-platform/dataforge/worker:latest"

if ($Dev) {
    Log "Building worker image from source..."
    docker build -f "$ProjectRoot\worker-node\backend\Dockerfile" -t $WorkerImage $ProjectRoot
    if ($LASTEXITCODE -ne 0) {
        Err "Failed to build worker image."
    }
    Log "Image built successfully."
}

# ── Write .env ───────────────────────────────────────

$envContent = @"
# DataForge Worker Node
NODE_ENV=$(if ($Dev) { "development" } else { "production" })
PORT=$WorkerPort
HOST=0.0.0.0
NODE_ID=$NodeId

# Database
DATABASE_URL=postgres://dataforge:${DbPassword}@postgres:5432/dataforge_worker
BCRYPT_ROUNDS=10

# Redis
REDIS_URL=redis://:${RedisPassword}@redis:6379

# Control Plane
CONTROL_PLANE_URL=$(if ($Dev) { $CpUrl -replace 'localhost','host.docker.internal' } else { $CpUrl })
NODE_API_KEY=$NodeApiKey

# Security
JWT_SECRET=$JwtSecret
JWT_REFRESH_SECRET=$JwtSecret
CORS_ORIGIN=*

# Postgres
POSTGRES_USER=dataforge
POSTGRES_PASSWORD=$DbPassword
POSTGRES_DB=dataforge_worker

# Redis password
REDIS_PASSWORD=$RedisPassword
"@

Set-Content -Path ".env" -Value $envContent -Encoding UTF8
Log "Environment file written: .env"

# ── Write docker-compose.yml ─────────────────────────

if ($Dev) {
$composeContent = @"
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: `${POSTGRES_USER}
      POSTGRES_PASSWORD: `${POSTGRES_PASSWORD}
      POSTGRES_DB: `${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dataforge"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass `${REDIS_PASSWORD}
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "`${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  worker:
    build:
      context: $($ProjectRoot -replace '\\', '/')
      dockerfile: worker-node/backend/Dockerfile
    restart: unless-stopped
    ports:
      - "`${PORT}:`${PORT}"
    env_file: .env
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  pgdata:
  redisdata:
"@
} else {
$composeContent = @'
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dataforge"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  worker:
    image: ghcr.io/dataforge-platform/dataforge/worker:latest
    restart: unless-stopped
    ports:
      - "${PORT}:${PORT}"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    volumes:
      - //var/run/docker.sock:/var/run/docker.sock
    command: --interval 300 --cleanup
    environment:
      - WATCHTOWER_LABEL_ENABLE=true

volumes:
  pgdata:
  redisdata:
'@
}

Set-Content -Path "docker-compose.yml" -Value $composeContent -Encoding UTF8
Log "Docker Compose file written: docker-compose.yml"

# ── Start services ───────────────────────────────────

Log "Starting DataForge Worker Node..."
docker compose up -d

if ($LASTEXITCODE -ne 0) {
    Err "Failed to start services. Check 'docker compose logs' for details."
}

Write-Host ""
Log "DataForge Worker Node is running!"
Log "  Node ID:    $NodeId"
Log "  Worker URL: $WorkerUrl"
Log "  Directory:  $InstallDir"
Write-Host ""
Log "Useful commands:"
Log "  docker compose logs -f worker   # View logs"
Log "  docker compose restart worker   # Restart"
Log "  docker compose down             # Stop all"
if ($Dev) {
    Write-Host ""
    Log "Dev mode: to rebuild after code changes:"
    Log "  docker compose build worker && docker compose up -d worker"
}
if (-not $Dev) {
    Write-Host ""
    Log "Watchtower will auto-update the worker container."
}
