#!/bin/sh
# Bring up the YamX + Ollama stack (same directory as this script / docker-compose.yml).
# Point systemd ExecStart= at this script after chmod +x.
set -eu
cd "$(dirname "$0")"
test -f ./docker-compose.yml || { echo "docker-compose.yml not found in $(pwd)" >&2; exit 1; }
exec docker compose up -d "$@"
