#!/bin/sh
# Run inside ollama-init container. Pulls the model into the remote Ollama server (OLLAMA_HOST).
set -eu

# Strip Windows CRLF and whitespace from env (common when .env is edited on Windows).
trim_env() {
  printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
OLLAMA_HOST=$(trim_env "$OLLAMA_HOST")
export OLLAMA_HOST

MODEL_RAW="${OLLAMA_MODEL:-qwen2.5-coder:3b}"
MODEL=$(trim_env "$MODEL_RAW")

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
  echo "[ollama-init] ERROR: ollama list failed — check OLLAMA_HOST (e.g. http://127.0.0.1:11434 with network_mode: service:ollama, or http://ollama:11434 on the Compose network)."
  exit 1
fi

dump_debug() {
  echo "[ollama-init] --- debug (disk / memory) ---"
  df -h 2>/dev/null || true
  free -h 2>/dev/null || true
  echo "[ollama-init] --- ollama list ---"
  ollama list 2>&1 || true
  echo "[ollama-init] --- ollama show (if available) ---"
  ollama show "${MODEL}" 2>&1 || true
}

n=0
while [ "$n" -lt "$RETRIES" ]; do
  n=$((n + 1))
  echo "[ollama-init] pull attempt ${n}/${RETRIES}: ollama pull ${MODEL}"
  if ollama pull "${MODEL}"; then
    # Do not gate success on parsing `ollama list` text (format differs across Ollama versions).
    if ollama show "${MODEL}" >/dev/null 2>&1; then
      echo "[ollama-init] success (ollama show ${MODEL} ok)."
    else
      echo "[ollama-init] WARN: ollama pull exited 0 but ollama show failed; treating as success."
    fi
    exit 0
  fi
  echo "[ollama-init] pull failed (exit $?)."
  dump_debug
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
