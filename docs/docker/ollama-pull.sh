#!/bin/sh
# Run inside ollama-init container. Pulls the model into the remote Ollama server (OLLAMA_HOST).
set -eu

export OLLAMA_HOST="${OLLAMA_HOST:-http://ollama:11434}"
MODEL="${OLLAMA_MODEL:-qwen2.5-coder:3b}"

echo "[ollama-init] OLLAMA_HOST=${OLLAMA_HOST}"
echo "[ollama-init] model=${MODEL}"
echo "[ollama-init] remote models (ollama list):"
ollama list || echo "[ollama-init] ollama list failed — check OLLAMA_HOST (must be like http://ollama:11434)"

n=0
while [ "$n" -lt 5 ]; do
  n=$((n + 1))
  echo "[ollama-init] pull attempt ${n}/5: ollama pull ${MODEL}"
  if ollama pull "${MODEL}"; then
    echo "[ollama-init] success."
    exit 0
  fi
  echo "[ollama-init] pull failed; sleeping 20s before retry..."
  sleep 20
done

echo "[ollama-init] all attempts failed."
ollama --version 2>/dev/null || true
ollama list 2>/dev/null || true
echo ""
echo "[ollama-init] Tip: set OLLAMA_MODEL to a smaller tag (e.g. qwen2.5-coder:3b) in a .env file next to docker-compose.yml, then docker compose up -d --build."
exit 1
