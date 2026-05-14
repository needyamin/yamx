# YamX Full Power Web Setup (Low CPU / Local AI)

This directory contains everything you need to run the YamX Web interface in **Full Power Mode**, fully offline, powered by a local **Ollama** instance. The default model tag is **`qwen2.5:1.5b`** so **RAM and CPU stay modest** on laptops and smaller Docker allocations. For heavier quality (and higher load), set **`OLLAMA_MODEL`** in **`.env`** (for example **`qwen2.5-coder:3b`** for code, **`qwen2.5:3b`** for general chat). **Gemma 4 E4B** (`gemma4:e4b`) can consume most of a **16 GiB** class machine for inference — use only when you deliberately want that cost.

## Features Included
1. **Local AI via Ollama**: **`ollama-init`** pulls **`OLLAMA_MODEL`** (default **`qwen2.5:1.5b`**, overridable via **`.env`**). Larger tags (Gemma, 7B+, etc.) need more RAM and CPU; keep the default unless you know the host can handle it.
2. **YamX Web UI**: Runs the local Web-based command runner and chat interface (`yamx web`).
3. **Full Power Mode**: Pre-configured with `YAMX_INTELLIGENCE_LEVEL=top`, `YAMX_AUTO_APPROVE=true`, and `--allow-dangerous` flags so the agent has maximum capabilities and doesn't constantly ask for permission.
4. **Volume Mounts**: The current workspace (your `cli-agent` repo) is mapped into the container at `/workspace`, meaning YamX can read, edit, and interact with the host's files directly!

## How to Start

Optional: copy `.env.example` to `.env` in this folder and set **`OLLAMA_MODEL`** if you want a different tag (for example **`qwen2.5-coder:3b`** for code, or **`gemma4:e2b`** only when you have spare RAM — avoid **`gemma4:e4b`** on tight machines).

```bash
docker compose up -d --build
```

**What happens next?**
1. Docker builds the YamX image using the local codebase.
2. The Ollama container starts (**`ollama/ollama:latest`**, `pull_policy: always`).
3. **`ollama-init`** runs **`ollama-pull.sh`** against **`OLLAMA_HOST=http://127.0.0.1:11434`** (shared network with **`ollama`**) and **`ollama pull`** for **`OLLAMA_MODEL`** (default **`qwen2.5:1.5b`**, overridable via `.env`), with retries.
4. The YamX Web container starts and uses the same model in **`DEFAULT_MODEL`** / **`YAMX_MODEL`**.

## Accessing the Web UI

Once everything is running, open your browser and navigate to:

```
http://localhost:8765
```

YamX is now running in full power mode!

## Auto-start at boot / login

**Containers:** **`ollama`** and **`yamx-web`** use **`restart: unless-stopped`**, so after you have run **`docker compose up -d`** at least once, Docker will normally bring them back when the Docker daemon restarts (for example after a reboot), as long as you did not run **`docker compose down`** (which removes the project’s containers).

**One-shot `ollama-init`** does not stay running; the model stays in the **`ollama_data`** volume, so you usually do **not** need to re-run init on every boot.

**Docker itself**

- **Windows:** Docker Desktop → **Settings → General →** enable **Start Docker Desktop when you sign in to your computer**.
- **Linux:** `sudo systemctl enable docker` (package name may vary by distro).

**Compose without opening a terminal each time**

- **Windows (Task Scheduler):** Create a task **At log on** (or **At startup** after a short delay). Action: **Start a program** — Program: **`powershell.exe`**, Add arguments: **`-NoProfile -ExecutionPolicy Bypass -File "C:\FULL\PATH\TO\cli-agent\docs\docker\startup-compose.ps1"`** (adjust the path to this repo). Start in: **`C:\FULL\PATH\TO\cli-agent\docs\docker`**. Ensure Docker Desktop starts before this task (add a **1–2 minute delay** if needed).
- **Linux (systemd):** See **`yamx-docker.service.example`** in this folder: copy to **`/etc/systemd/system/`**, set **`WorkingDirectory`** and **`ExecStart`** to your checkout, **`chmod +x startup-compose.sh`**, then **`systemctl enable --now yamx-docker.service`**.

The helper scripts **`startup-compose.ps1`** and **`startup-compose.sh`** only run **`docker compose up -d`** from this directory (no **`--build`**). Run **`docker compose up -d --build`** yourself when you change the Dockerfile or application code.

## Ollama and YamX API (Docker reference)

### Services

| Service | Role |
|--------|------|
| **`ollama`** | Runs the Ollama daemon. Models live in the **`ollama_data`** volume (`/root/.ollama` in that container). Port **`11434`** is published to the host as **`localhost:11434`**. |
| **`ollama-init`** | One-shot job: uses the Ollama **CLI** with **`OLLAMA_HOST=http://127.0.0.1:11434`** and **`network_mode: service:ollama`** so the pull runs in the **same network namespace** as the **`ollama`** container (reliable loopback to the daemon; blobs still go to the **`ollama_data`** volume on **`ollama`**). |
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
| **`DEFAULT_MODEL`** / **`YAMX_MODEL`** | `${OLLAMA_MODEL:-qwen2.5:1.5b}` | Model tag Ollama must have pulled (same as init). |
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
The selected Ollama tag needs more **free RAM** than Docker or the host can give that process. Use a smaller tag (compose default **`qwen2.5:1.5b`**, or **`qwen2.5:0.5b`**), set **`OLLAMA_MODEL`** in **`.env`**, then **`docker compose down -v && docker compose up -d --build`**. Avoid **`gemma4:e4b`** unless you have plenty of headroom; **`gemma4:e2b`** is lighter than E4B. On Windows, you can also raise **Docker Desktop → Settings → Resources → Memory** if you need a larger model.

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
1. Inspect logs: **`docker compose logs ollama-init`** (or the name from **`docker compose ps`**). The script prints **`ollama pull`** output; look for **connection reset**, **TLS**, **no space left**, **manifest unknown**, or **timeout**.  
2. If logs show **`unknown command "sh" for "ollama"`**: the `ollama/ollama` image uses **`ENTRYPOINT`** so that plain `command: [sh, …]` becomes `ollama sh …`. This stack sets **`entrypoint: ["/bin/sh"]`** on **`ollama-init`** so `/ollama-pull.sh` runs under the shell (update `docker-compose.yml` if you copied an older file).  
3. If **`ollama pull` always exits 0** but init still failed on an **older** copy of this repo: an earlier script retried until **`grep`** matched **`ollama list`**; table formatting changed in newer Ollama builds so **`grep` never matched**. Update **`ollama-pull.sh`** and **`docker-compose.yml`** from this repo (success is now based on **`ollama pull`** exit code, with an optional **`ollama show`** check only for logging).  
4. **`OLLAMA_HOST`** for **`ollama-init`** is **`http://127.0.0.1:11434`** (shared network with **`ollama`** via **`network_mode: service:ollama`**). **`yamx-web`** still uses **`http://ollama:11434/v1`** on the Compose network.  
5. **Disk**: ensure several GB free on the Docker data root (blobs land in the **`ollama_data`** volume). On a full disk, pulls often run a long time then fail.  
6. **Flaky network / slow registry**: increase retries in **`.env`**: **`OLLAMA_INIT_PULL_RETRIES=12`** and **`OLLAMA_INIT_PULL_RETRY_SECONDS=45`**, then **`docker compose up -d`** again (no need to **`down -v`** unless you want a clean volume).  
7. **Gemma 4** needs a recent Ollama build. If pull fails, set **`OLLAMA_MODEL`** in `.env` (see `.env.example`, e.g. **`qwen2.5:1.5b`** or **`llama3.2:3b`**), then **`docker compose down -v && docker compose up -d --build`**.
