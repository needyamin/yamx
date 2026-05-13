# YamX Full Power Web Setup (Low CPU / Local AI)

This directory contains everything you need to run the YamX Web interface in **Full Power Mode**, fully offline, powered by a local Ollama instance running Google's **Gemma 4 E4B** model.

## Features Included
1. **Edge-Optimized AI**: Automatically pulls and configures the `gemma4:e4b` model via Ollama. This "Effective 4B" model is specifically engineered for high efficiency on edge devices and lower CPU hardware while maintaining excellent reasoning capabilities.
2. **YamX Web UI**: Runs the local Web-based command runner and chat interface (`yamx web`).
3. **Full Power Mode**: Pre-configured with `YAMX_INTELLIGENCE_LEVEL=top`, `YAMX_AUTO_APPROVE=true`, and `--allow-dangerous` flags so the agent has maximum capabilities and doesn't constantly ask for permission.
4. **Volume Mounts**: The current workspace (your `cli-agent` repo) is mapped into the container at `/workspace`, meaning YamX can read, edit, and interact with the host's files directly!

## How to Start

Optional: copy `.env.example` to `.env` in this folder and set **`OLLAMA_MODEL`** if the default tag will not pull (for example `qwen2.5-coder:3b` on tight disk or older hosts).

```bash
docker compose up -d --build
```

**What happens next?**
1. Docker builds the YamX image using the local codebase.
2. The Ollama container starts (**`ollama/ollama:latest`**, `pull_policy: always`).
3. **`ollama-init`** runs **`ollama-pull.sh`**: exports **`OLLAMA_HOST=http://ollama:11434`** and **`ollama pull`** for **`OLLAMA_MODEL`** (default **`gemma4:e4b`**, overridable via `.env`), with retries.
4. The YamX Web container starts and uses the same model in **`DEFAULT_MODEL`** / **`YAMX_MODEL`**.

## Accessing the Web UI

Once everything is running, open your browser and navigate to:

```
http://localhost:8765
```

YamX is now running in full power mode!

## Troubleshooting (Docker)

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
1. Inspect logs: `docker compose logs ollama-init` (or the container name shown by `docker compose ps`).  
2. **`OLLAMA_HOST` must include `http://`** (the init script sets `http://ollama:11434`). A bare `ollama:11434` value can break the CLI.  
3. **Gemma 4** needs a **recent** Ollama release and several GB of disk. If pull fails, set in `.env`: `OLLAMA_MODEL=qwen2.5-coder:3b` (or `llama3.2:3b`), then `docker compose down -v && docker compose up -d --build` so the init step and YamX use the same tag.  
4. Ensure enough free disk space for the model blob.
