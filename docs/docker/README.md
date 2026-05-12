# YamX Full Power Web Setup (Local AI)

This directory contains everything you need to run the YamX Web interface in **Full Power Mode**, fully offline, powered by a local Ollama instance running Google's **Gemma** model.

## Features Included
1. **Fully Local AI**: Automatically pulls and configures the `gemma` model via Ollama. No API keys or internet connection required after the initial model download.
2. **YamX Web UI**: Runs the local Web-based command runner and chat interface (`yamx web`).
3. **Full Power Mode**: Pre-configured with `YAMX_INTELLIGENCE_LEVEL=top`, `YAMX_AUTO_APPROVE=true`, and `--allow-dangerous` flags so the agent has maximum capabilities and doesn't constantly ask for permission.
4. **Volume Mounts**: The current workspace (your `cli-agent` repo) is mapped into the container at `/workspace`, meaning YamX can read, edit, and interact with the host's files directly!

## How to Start

Open your terminal in this directory (`docs/docker`) and run:

```bash
docker-compose up -d --build
```

**What happens next?**
1. Docker builds the YamX image using the local codebase.
2. The Ollama container starts up.
3. An `ollama-init` container runs automatically to execute `ollama pull gemma` (this will take a few minutes depending on your internet connection).
4. The YamX Web container starts up and connects to Ollama automatically.

## Accessing the Web UI

Once everything is running, open your browser and navigate to:

```
http://localhost:8765
```

YamX is now running in full power mode!

## (Optional) Enabling GPU Support

Running local LLMs on a CPU can be slow. If you have an NVIDIA GPU and the NVIDIA Container Toolkit installed, you can drastically speed up the Gemma model by uncommenting the `deploy` block under the `ollama` service in `docker-compose.yml`.

```yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```
