# YamX Full Power Web Setup (Low CPU / Local AI)

This directory contains everything you need to run the YamX Web interface in **Full Power Mode**, fully offline, powered by a local **Ollama** instance. The default model tag is **`qwen2.5-coder:3b`** so typical **~8 GiB** machines can run without Ollama's "requires more system memory" failure. You can opt into **Google Gemma 4** (for example **`gemma4:e4b`**) in **`.env`** when the host has enough free RAM (often **~10 GiB** or more for E4B inference).

## Features Included
1. **Local AI via Ollama**: **`ollama-init`** pulls **`OLLAMA_MODEL`** (default **`qwen2.5-coder:3b`**, overridable via **`.env`**). For edge-style efficiency with Gemma, set **`OLLAMA_MODEL=gemma4:e4b`** or **`gemma4:e2b`** when your machine can spare the RAM.
2. **YamX Web UI**: Runs the local Web-based command runner and chat interface (`yamx web`).
3. **Full Power Mode**: Pre-configured with `YAMX_INTELLIGENCE_LEVEL=top`, `YAMX_AUTO_APPROVE=true`, and `--allow-dangerous` flags so the agent has maximum capabilities and doesn't constantly ask for permission.
4. **Volume Mounts**: The current workspace (your `cli-agent` repo) is mapped into the container at `/workspace`, meaning YamX can read, edit, and interact with the host's files directly!

## How to Start

Optional: copy `.env.example` to `.env` in this folder and set **`OLLAMA_MODEL`** (for example **`gemma4:e4b`** when you have enough RAM, or **`llama3.2:3b`** on very tight hosts).

```bash
docker compose up -d --build
```

**What happens next?**
1. Docker builds the YamX image using the local codebase.
2. The Ollama container starts (**`ollama/ollama:latest`**, `pull_policy: always`).
3. **`ollama-init`** runs **`ollama-pull.sh`**: exports **`OLLAMA_HOST=http://ollama:11434`** and **`ollama pull`** for **`OLLAMA_MODEL`** (default **`qwen2.5-coder:3b`**, overridable via `.env`), with retries.
4. The YamX Web container starts and uses the same model in **`DEFAULT_MODEL`** / **`YAMX_MODEL`**.

## Accessing the Web UI

Once everything is running, open your browser and navigate to:

```
http://localhost:8765
```

YamX is now running in full power mode!

## Ollama and YamX API (Docker reference)

### Services

| Service | Role |
|--------|------|
| **`ollama`** | Runs the Ollama daemon. Models live in the **`ollama_data`** volume (`/root/.ollama` in that container). Port **`11434`** is published to the host as **`localhost:11434`**. |
| **`ollama-init`** | One-shot job: uses the Ollama **CLI** with **`OLLAMA_HOST=http://ollama:11434`** so pulls go to the **`ollama`** container (Docker DNS name **`ollama`**, not `localhost`). |
| **`yamx-web`** | YamX **`web`** UI. Talks to Ollama using the **OpenAI-compatible** HTTP API. |

### URLs (from your machine vs inside Compose)

| Where | URL | Purpose |
|-------|-----|---------|
| **Host browser** | `http://localhost:8765` | YamX Web UI. |
| **Host** | `http://localhost:11434` | Native Ollama HTTP API (same daemon, port mapped from `ollama`). |
| **Inside `yamx-web` container** | `http://ollama:11434` | Reach the Ollama service by **Compose service name** (works on the Docker network only). |

YamX is configured for the **OpenAI Chat Completions**-compatible path: **`http://ollama:11434/v1`** (note the **`/v1`** suffix). That is what **`OPENAI_BASE_URL`** / **`YAMX_OPENAI_BASE_URL`** set on **`yamx-web`**.

### Environment on `yamx-web` (what YamX reads)

These are set in **`docker-compose.yml`** and merged **after** `/root/.yamx/config.json` when the app starts, so they override a stale config on the **`yamx_data`** volume:

| Variable | Typical value | Meaning |
|----------|----------------|--------|
| **`DEFAULT_PROVIDER`** / **`YAMX_PROVIDER`** | `openai` | Use the OpenAI-compatible client (pointed at Ollama, not api.openai.com). |
| **`DEFAULT_MODEL`** / **`YAMX_MODEL`** | `${OLLAMA_MODEL:-qwen2.5-coder:3b}` | Model tag Ollama must have pulled (same as init). |
| **`OPENAI_API_KEY`** / **`YAMX_OPENAI_API_KEY`** | `ollama` | Placeholder string; Ollama does not require a real cloud key. |
| **`OPENAI_BASE_URL`** / **`YAMX_OPENAI_BASE_URL`** | `http://ollama:11434/v1` | Base URL for chat completions against the **`ollama`** service. |
| **`YAMX_INTELLIGENCE_LEVEL`** | `top` | YamX behavior preset. |
| **`YAMX_AUTO_APPROVE`** | `true` | Auto-approve tool policy in this demo stack. |

Override **only the model tag** without editing YAML: create **`.env`** next to `docker-compose.yml` (see **`.env.example`**) and set **`OLLAMA_MODEL=...`**. Compose substitutes it into **`DEFAULT_MODEL`** / **`YAMX_MODEL`** and into **`ollama-init`**.

### Volumes

| Volume | Used by | Contents |
|--------|---------|----------|
| **`ollama_data`** | `ollama` | Downloaded models and Ollama state. |
| **`yamx_data`** | `yamx-web` | `/root/.yamx` (sessions, config cache, etc.). |
| **Bind mount** | `yamx-web` | Repo → **`/workspace`** for the agent. |

## Troubleshooting (Docker)

**Chat returns HTTP 500 / "model requires more system memory … GiB"**  
The selected Ollama tag needs more **free RAM** than Docker or the host can give that process. Use a smaller tag (default **`qwen2.5-coder:3b`**, or **`gemma4:e2b`** instead of **`gemma4:e4b`**), set **`OLLAMA_MODEL`** in **`.env`**, then **`docker compose down -v && docker compose up -d --build`**. On Windows, also raise **Docker Desktop → Settings → Resources → Memory** if you need a larger model.

**API errors or wrong model inside the container**  
The `yamx_data` volume keeps `/root/.yamx/config.json`. Older images did not apply compose `environment` to that file, so YamX could still use **localhost** or a **host-only model** (for example `deepseek-chat`) instead of the bundled Ollama service.

Current YamX merges **`DEFAULT_PROVIDER`**, **`DEFAULT_MODEL`**, **`OPENAI_API_KEY`**, **`OPENAI_BASE_URL`**, and the **`YAMX_*`** equivalents **after** loading config, so the compose file wins.

If problems persist, reset the named volume and rebuild:

```bash
docker compose down -v
docker compose up -d --build
```

**Ollama not ready**  
`yamx-web` waits for the `ollama` service healthcheck and for `ollama-init` to finish pulling the model. First start can take several minutes on slow networks or CPUs.

**`ollama-init` exits with code 1**  
1. Inspect logs: `docker compose logs ollama-init` (or the name from `docker compose ps`).  
2. If logs show **`unknown command "sh" for "ollama"`**: the `ollama/ollama` image uses **`ENTRYPOINT`** so that plain `command: [sh, …]` becomes `ollama sh …`. This stack sets **`entrypoint: ["/bin/sh"]`** on **`ollama-init`** so `/ollama-pull.sh` runs under the shell (update `docker-compose.yml` if you copied an older file).  
3. **`OLLAMA_HOST`** must be a URL (**`http://ollama:11434`**); the pull script sets this.  
4. **Gemma 4** needs a recent Ollama build and several GB of disk. If pull fails, set **`OLLAMA_MODEL`** in `.env` (see `.env.example`), then `docker compose down -v && docker compose up -d --build`.  
5. Ensure enough free disk space for the model blob.
