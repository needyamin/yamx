#!/bin/sh
# Run inside ollama-init container. Pulls the model into the remote Ollama server (OLLAMA_HOST).
set -eu

export OLLAMA_HOST="${OLLAMA_HOST:-http://ollama:11434}"
MODEL="${OLLAMA_MODEL:-qwen2.5-coder:3b}"
START_DELAY="${OLLAMA_INIT_START_DELAY:-5}"
RETRIES="${OLLAMA_INIT_PULL_RETRIES:-8}"
RETRY_SEC="${OLLAMA_INIT_PULL_RETRY_SECONDS:-30}"

echo "[ollama-init] OLLAMA_HOST=${OLLAMA_HOST}"
echo "[ollama-init] model=${MODEL}"
echo "[ollama-init] retries=${RETRIES} retry_sleep_s=${RETRY_SEC} start_delay_s=${START_DELAY}"

# Brief pause: healthcheck can pass a moment before pull API is stable on some hosts.
echo "[ollama-init] waiting ${START_DELAY}s before contacting Ollama..."
sleep "${START_DELAY}"

echo "[ollama-init] ollama version:"
ollama --version 2>&1 || true

echo "[ollama-init] remote models (ollama list):"
if ! ollama list; then
  echo "[ollama-init] ERROR: ollama list failed — check OLLAMA_HOST (must be like http://ollama:11434) and that the ollama service is reachable."
  exit 1
fi

dump_debug() {
  echo "[ollama-init] --- debug (disk / memory) ---"
  df -h 2>/dev/null || true
  free -h 2>/dev/null || true
  echo "[ollama-init] --- ollama list ---"
  ollama list 2>&1 || true
}

n=0
while [ "$n" -lt "$RETRIES" ]; do
  n=$((n + 1))
  echo "[ollama-init] pull attempt ${n}/${RETRIES}: ollama pull ${MODEL}"
  if ollama pull "${MODEL}"; then
    echo "[ollama-init] pull command exited 0; verifying model is listed..."
    if ollama list 2>/dev/null | grep -Fq "${MODEL}"; then
      echo "[ollama-init] success (model present in ollama list)."
      exit 0
    fi
    echo "[ollama-init] WARN: pull exited 0 but '${MODEL}' not found in ollama list; retrying..."
  else
    echo "[ollama-init] pull failed (exit $?)."
    dump_debug
  fi
  if [ "$n" -lt "$RETRIES" ]; then
    echo "[ollama-init] sleeping ${RETRY_SEC}s before retry..."
    sleep "${RETRY_SEC}"
  fi
done

echo "[ollama-init] all attempts failed."
dump_debug
echo ""
echo "[ollama-init] Next steps:"
echo "  1) docker compose logs ollama-init   # full pull output"
echo "  2) df -h on the host — need several GB free for model blobs"
echo "  3) Try a smaller tag in .env: OLLAMA_MODEL=llama3.2:3b"
echo "  4) Increase retries: OLLAMA_INIT_PULL_RETRIES=12 OLLAMA_INIT_PULL_RETRY_SECONDS=45"
exit 1
