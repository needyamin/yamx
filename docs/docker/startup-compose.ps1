# Bring up the YamX + Ollama stack (same folder as docker-compose.yml).
# Use with Task Scheduler at logon, or run manually after reboot.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path ".\docker-compose.yml")) {
  Write-Error "docker-compose.yml not found in $PSScriptRoot"
  exit 1
}
docker compose up -d @args
