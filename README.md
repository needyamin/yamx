# YamX

YamX is a terminal-first coding and operations agent designed for practical local work:

- debug and repair build/package issues
- inspect logs and run shell workflows
- edit repositories safely
- support DevOps, full-stack ops, network diagnostics, and defensive security tasks

YamX is optimized for "do the work now" execution, not tutorial-style long answers.

<img width="80" height="80" alt="YamX" src="https://github.com/user-attachments/assets/0d327064-4213-46c3-b2cf-5f69d0f87664" />
<img width="1919" height="909" alt="Image" src="https://github.com/user-attachments/assets/34a9336e-e428-4edf-b63b-067eb1a6d7ce" />

## Requirements

- Node.js 18+

## Documentation

- Combined docs site: [docs/docs.html](docs/docs.html)
- Project engineering memory: [docs/context-memory.md](docs/context-memory.md)
- Publish notes: [docs/publish.txt](docs/publish.txt)

Note: `docs/docs.html` uses Bootstrap CDN assets. Open directly or serve `docs/` locally.

## Who YamX is for

- Developers: code changes, package scripts, test/build errors, repository workflows
- DevOps and full-stack operators: process/log/config/network checks before risky mutation
- Network engineers: DNS, routes, listeners, reachability, protocol-level diagnostics
- Defensive security engineers: secure review, CVE triage, secrets and posture checks

## Core behavior

- Offline-first: prefer local files, local tools, local logs, local process state
- Intent-aware: greeting/chat does not trigger heavy diagnostics
- Command-first: direct shell-like input can execute without model round-trips
- Session-based: persistent history and memory under `~/.yamx` and project `.yamx`
- Safety-first: risky/destructive actions require explicit allowance

## Install

Global:

```bash
npm install -g @needyamin/yamx@latest
yamx
```

From this repository:

```bash
git clone https://github.com/needyamin/yamx.git
cd yamx
npm install
npm link
```

No global install:

```bash
npx @needyamin/yamx
```

Uninstall:

```bash
npm uninstall -g @needyamin/yamx
```

Delete all YamX local data:

```bash
# macOS / Linux
rm -rf ~/.yamx

# Windows PowerShell
Remove-Item -Recurse -Force $HOME\.yamx
```

## First run

```bash
yamx --onboard
yamx --diagnose
yamx
```

If `~/.yamx/config.json` is missing, or the selected cloud provider has no API key, YamX auto-starts onboarding before normal chat.

## Daily workflows

1. Debug package/build errors:
- run project command
- inspect exact failing output
- apply smallest fix
- rerun narrow verification command

2. Repository edits:
- inspect files first
- patch minimally
- preserve existing style and structure

3. Ops and infrastructure:
- process -> logs -> config -> ports/network -> permissions -> dependencies -> runtime mismatch

4. Defensive security:
- authorized and defensive scope only
- prioritize detection, triage, hardening, and remediation guidance

## Web UI

Start:

```bash
yamx web
yamx web --host 127.0.0.1 --port 8765
yamx web --allow-dangerous
```

Default bind is loopback (`127.0.0.1`). Keep it local unless you add your own auth/proxy controls.

**Shell** (conversation) uses a responsive two-column layout on wide viewports (~8×4 proportions): the conversation fills the wider column; a scrollable **Sessions** rail sits beside it with **New**, **Refresh**, and **Expand** (opens the Sessions tab); each row exposes **Use**, **Rename**, and **Delete**. It mirrors `/api/sessions` with the Sessions tab. On narrower viewports those regions stack vertically.

Inside the Conversation card:

- **Execution mode · Provider** is a collapsible row (expanded with `[+]` / `[-]` like Execution lab). It configures execution mode (**auto**, **shell**, **agent**) and **Provider**, which PATCHes **`defaultProvider`**—the runtime cache resets on save so the next message picks it up.
- A **provider readiness strip** reports whether an API key is required, whether YamX sees credentials (config or env vars), readiness for agent turns versus a warmed agent session, and a short remediation hint—the same server logic as credential checks in onboarding.
- **Execution lab** remains a separate expandable block (shell runtime, timeouts, profiles, runbook).

**Navigation panels**:

- Shell
- Settings
- Sessions
- Tools & API
- Engineering readiness card (offline diagnostics and challenge suites)

Detailed UI docs: [docs/docs.html#web](docs/docs.html#web)

## HTTP API

Base URL is the web server URL (default `http://127.0.0.1:8765`).

Route discovery:

- `GET /api/routes`

Core endpoints:

- `GET /api/state` (cwd, resolved provider/model, optional `sessionId`, `allowDangerous`, plus readiness: `providerUsesApiKey`, `providerApiKeyConfigured`, `agentCanRun`, optional `providerHint`, `sessionWarm`)
- `GET /api/info`
- `GET /api/config`
- `PATCH /api/config`
- `POST /api/config/reset`
- `POST /api/runtime/reload`

Session CRUD:

- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:id`
- `PATCH /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `POST /api/sessions/active`

Agent and tools:

- `GET /api/tools`
- `POST /api/command`
- `POST /api/chat`

Engineering diagnostics:

- `GET /api/engineering/readiness` (`?force=1` optional)
- `POST /api/engineering/challenge`
  - body: `{ "suite": "all|vm|fullstack|devops|network|security", "profile": "standard|deep", "force": true|false }`

Detailed API docs: [docs/docs.html#api](docs/docs.html#api)

## Offline-first intelligence and engineering modes

YamX includes two important runtime layers:

- Engineering loop mode (`YAMX_ENGINEERING_MODE`)
  - `balanced | advanced | elite` (default `elite`)
  - affects repair discipline, escalation hints, and retry strategy

- Command intelligence tier (`YAMX_INTELLIGENCE_LEVEL` or `YAMX_INTELLIGENCE_TIER`)
  - `balanced | advanced | top` (default `top`)
  - affects local command ranking, typo tolerance, capability weighting, and probe-first scoring

Project-local data:

- `.yamx/command-intelligence.json`
- `.yamx/command-memory.json`

## Input routing model

- Conversational input: short assistant response, no unnecessary heavy workflows
- Direct command input: shell execution path
- Ambiguous/task input: agent + tools path
- Runtime/install/diagnose style asks: optional automatic preflight probes (`settings.preflightRuntimeProbes`)

## Safety and permissions

- Destructive/sensitive behavior is blocked by default in normal operation.
- Web mode with `--allow-dangerous` can permit risky execution from browser controls.
- Permission and policy controls are configurable in `settings.permissionMode`.
- Cybersecurity support is defensive-only and authorized-scope oriented.

## Providers

Supported providers:

- openrouter
- openai
- anthropic
- gemini
- kimi
- grok
- ollama (local)

Cloud API key environment variables:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `MOONSHOT_API_KEY` or `KIMI_API_KEY`
- `XAI_API_KEY`
- `OPENROUTER_API_KEY`

Optional defaults:

- `DEFAULT_PROVIDER`
- `DEFAULT_MODEL`

## Configuration

Primary config file:

- `~/.yamx/config.json`

Other state files:

- `~/.yamx/state.json`
- `~/.yamx/sessions/*.json`

Important settings:

- `autoApprove`
- `streamOutput`
- `maxTokens`
- `temperature`
- `contextBudgetChars`
- `permissionMode`
- `allowedShellCommands`
- `deniedShellPatterns`
- `hooksEnabled`
- `modelCouncil.enabled`
- `modelCouncil.mode`
- `maxToolResultChars`
- `subagents.enabled`
- `subagents.defaultModel`
- `verboseCli`
- `maxAssistantMarkdownChars`
- `preflightRuntimeProbes`
- `checkForUpdates`

Interactive config:

```bash
yamx config
yamx --reset-config
```

## CLI reference

Main command:

```text
yamx [options]
```

Options:

- `-p, --provider <provider>`
- `-m, --model <model>`
- `-t, --temperature <temp>`
- `--max-tokens <tokens>`
- `--auto-approve`
- `--no-stream`
- `--new-chat`
- `--resume <id>`
- `--history`
- `--clear-chat`
- `--delete-chat <id>`
- `--onboard`
- `--reset-config`
- `--diagnose`

Subcommands:

- `yamx config`
- `yamx web [--host 127.0.0.1] [--port 8765] [-p provider] [-m model] [--allow-dangerous]`

In-session commands:

- Use `/help` for the authoritative slash-command list in your running version.

## Built-in tools (32)

Files:

- `read_file`, `read_files`, `write_file`, `write_files`, `edit_file`, `list_files`, `search_files`, `delete_file`

Advanced files:

- `multi_edit`, `copy_file`, `move_file`, `file_info`, `grep_search`, `directory_tree`, `patch_file`

Shell:

- `run_command`, `run_command_background`, `shell_diagnostics`, `task_list`, `task_tail`, `task_stop`

Git:

- `git_status`, `git_diff`, `git_commit`, `git_log`, `git_branch`, `git_stash`

Web:

- `fetch_url`

Intelligence and logs:

- `project_intel`, `codebase_analysis`, `log_inspect`, `find_references`

## Develop and contribute

Useful local commands:

```bash
npm install
npx tsc -p config/tsconfig.json --noEmit
npm run build
npm test
npm run dev
yamx --diagnose
yamx web --port 8765
```

Windows note: if script invocation is blocked, use `npm.cmd ...`.

Project map:

```text
config/tsconfig.json
config/.env.example
docs/docs.html
docs/context-memory.md
docs/publish.txt
src/index.ts
src/agent.ts
src/context.ts
src/runtime-preflight.ts
src/tools/
src/web/server.ts
src/web/ui.ts
src/web/engineering-diagnostics.ts
src/providers/factory.ts
```

## Troubleshooting

`yamx` not found:

- ensure npm global `bin` is on `PATH`
- restart terminal after global install

Provider key errors:

- run `yamx --onboard`
- check `~/.yamx/config.json` and env vars

Long replies are clipped:

- raise `settings.maxAssistantMarkdownChars` in config

Model gives generic install essays:

- keep `settings.preflightRuntimeProbes=true`
- use a stronger model and lower temperature if needed

Command suggestions feel weak:

- keep `.yamx/command-memory.json` in project
- use `YAMX_INTELLIGENCE_LEVEL=top`

Build fails on Windows with `EPERM` in `dist/*`:

- this can happen when files are locked by another process
- close watchers/processes using `dist`, then rerun build
- as a workaround, build to alternate outDir and copy artifacts

Stale global version:

```bash
npm uninstall -g @needyamin/yamx
npm install -g @needyamin/yamx@latest
```

## License

ISC - [Yamin](https://github.com/needyamin)

<img width="50" height="50" alt="YamX" src="https://github.com/user-attachments/assets/0d327064-4213-46c3-b2cf-5f69d0f87664" />
