# YamX Full Power Web Setup (Low CPU / Local AI)

This directory runs YamX Web in Full Power Mode with a local Ollama server.
Default model is `qwen2.5-coder:0.5b`, which is a practical choice for very low-memory systems.

## What this stack does
1. Starts Ollama in Docker.
2. Runs `ollama-init` one time to ensure the configured model exists.
3. Starts YamX Web and points it to Ollama through the OpenAI-compatible API.
4. Persists model files in a Docker volume so they survive reboot.

## Current defaults
- `OLLAMA_MODEL=qwen2.5-coder:0.5b`
- `pull_policy: missing` for Ollama images (avoid unnecessary image re-pulls)
- `restart: unless-stopped` for `ollama` and `yamx-web`
- `YAMX_CONTEXT_BUDGET_CHARS=50000` (aggressive summarize threshold)
- `YAMX_CONTEXT_KEEP_LAST_MESSAGES=6`
- `YAMX_CONTEXT_ROLLOVER_MODE=summary-next-session` (roll forward with compact summary)
- `YAMX_WEB_USERNAME` + `YAMX_WEB_PASSWORD` required (HTTP Basic auth)

## Quick start
From this folder:

```bash
cp .env.example .env
# edit .env and set YAMX_WEB_USERNAME / YAMX_WEB_PASSWORD first
docker compose up -d --build
```

Then open:

```text
http://localhost:8765
```

## Model behavior (important)
- Models are stored in volume `ollama_data`.
- `ollama-init` now checks `ollama show <model>` first.
- If model already exists, init skips `ollama pull`.
- Result: reboot/startup does not repeatedly re-download the model.
- YamX context is compacted automatically when it grows, then rolled into a lightweight summarized thread for the next turns.

## Change model tag
Edit `.env` in this folder:

```env
OLLAMA_MODEL=qwen2.5-coder:0.5b
```

Examples:
- `gemma4:e4b` (heavier, needs more RAM)
- `qwen2.5-coder:3b` (code-focused)
- `llama3.2:3b`

## Services
- `ollama`: Ollama daemon at port `11434`
- `ollama-init`: one-shot model ensure/pull job
- `yamx-web`: YamX web UI at port `8765`

## Environment used by yamx-web
- `DEFAULT_PROVIDER=openai`
- `DEFAULT_MODEL=${OLLAMA_MODEL:-qwen2.5-coder:0.5b}`
- `OPENAI_API_KEY=ollama`
- `OPENAI_BASE_URL=http://ollama:11434/v1`
- `YAMX_WEB_USERNAME` / `YAMX_WEB_PASSWORD` (required; login for all routes)
- `YAMX_WEB_AUTH_REALM` (optional, label shown in the login prompt)
- `YAMX_INTELLIGENCE_LEVEL=top`
- `YAMX_AUTO_APPROVE=true`
- `DEFAULT_PROVIDER` / `DEFAULT_MODEL` are bootstrap defaults (used when no saved config exists yet).
- Later provider/model changes from YamX web or CLI config persist normally.

## Web authentication behavior
- YamX web now enforces HTTP Basic auth for UI + API when credentials are configured.
- Docker compose intentionally blocks startup if `YAMX_WEB_USERNAME` or `YAMX_WEB_PASSWORD` is missing.
- Put HTTPS in front of this container (Nginx/Caddy/Cloudflare Tunnel) so credentials are encrypted in transit.

## Volumes
- `ollama_data`: model files and Ollama state
- `yamx_data`: `/root/.yamx` data
- bind mount: repo to `/workspace`

## Auto-start after VPS reboot
- `ollama` and `yamx-web` use `restart: unless-stopped`.
- After first successful `docker compose up -d`, Docker normally auto-starts them when daemon restarts.

For host-level startup:
- Windows: enable Docker Desktop auto-start and optionally schedule `startup-compose.ps1`.
- Linux: use `yamx-docker.service.example` with `startup-compose.sh`.

## Useful commands

```bash
docker compose ps
docker compose logs -f ollama-init
docker compose logs -f yamx-web
docker compose down
docker compose down -v
```

## Troubleshooting

### "model requires more system memory"
- Your selected model is too heavy for available RAM.
- Keep `qwen2.5-coder:0.5b` or choose a smaller tag.

### CPU reaches 100% on simple chat
- On CPU-only local inference this is normal during generation.
- Tiny web messages like `hi` are handled directly by YamX (no model call), with a command-focused hint.
- For real prompts, CPU can still spike to 100% briefly on weak hardware.

### `ollama-init` fails
1. Check logs: `docker compose logs ollama-init`
2. Verify free disk space.
3. Increase retries in `.env` if network is slow:
   - `OLLAMA_INIT_PULL_RETRIES=12`
   - `OLLAMA_INIT_PULL_RETRY_SECONDS=45`

### Wrong model or API target
- `yamx-web` is configured to use `http://ollama:11434/v1`.
- If you suspect stale cached config, reset volumes:

```bash
docker compose down -v
docker compose up -d --build
```

## API reference
- YamX Web (host): `http://localhost:8765`
- Ollama API (host): `http://localhost:11434`
- YamX -> Ollama (inside Docker network): `http://ollama:11434/v1`
