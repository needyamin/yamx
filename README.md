# YamX

A terminal coding agent that reads and edits your project, runs shell commands, uses Git and the web, and analyzes logs — without burning your model tokens. **29 built-in tools**, direct-command execution, persistent chat sessions, and multi-provider LLM support.

Providers: **OpenAI**, **Anthropic**, **Google Gemini**, **OpenRouter** (100+ models), **Ollama** (local).

---

## What makes YamX different

- **Local first, model second.** When you type a command like `systeminfo`, `lscpu`, `tar`, `jq`, or `python`, YamX runs it directly on your shell. No model call, no token cost.
- **Auto-detected helpers.** YamX probes ~70 common tools cross-platform on startup (python, node, jq, yq, awk, sed, rg, openssl, sha256sum, etc.) and tells the model exactly what's installed and where.
- **Local compute first.** For analysis, parsing, counting, math, JSON/CSV/YAML inspection, the agent prefers running a small one-liner with `python` / `jq` / `awk` / `node` instead of doing the work in chat. Smaller context, lower cost, deterministic results.
- **Failure-aware.** When commands or services fail, YamX inspects task output and logs (`auto`, `latest-error`, `summary`, `tail`, `head`, `errors`, `full`) and follows an internal failure protocol before applying a fix.
- **Safe by default.** Sensitive, destructive, privileged, publishing, package-install, credential, and permission-changing commands are classified and require approval — or are blocked outright if they look like exfiltration.

---

## Install

Needs **[Node.js 18+](https://nodejs.org/)** and npm.

```bash
npm install -g @needyamin/yamx@latest
```

Then from any folder:

```bash
yamx
```

### From source (developers)

```bash
git clone https://github.com/needyamin/yamx.git
cd yamx
npm install
npm link
```

`npm install` runs `prepare` and builds `dist/` so the `yamx` binary is ready.

### Without installing globally

```bash
npx @needyamin/yamx
```

### Uninstall

```bash
npm uninstall -g @needyamin/yamx
```

Then delete config and sessions:
- Windows (PowerShell): `Remove-Item -Recurse -Force ~/.yamx`
- Windows (CMD): `rmdir /s /q %USERPROFILE%\.yamx`
- macOS/Linux: `rm -rf ~/.yamx`

---

## First run

```bash
yamx --onboard
```

Walks you through provider, API key, default model, streaming, auto-approve, and model council settings. Rerun anytime to switch.

```bash
yamx --diagnose
```

Checks Node version, API keys, Git, Ollama connectivity, sessions, and detected local tools.

```bash
yamx
```

Starts the chat. Conversations auto-save under `~/.yamx/sessions/` and resume next launch.

---

## Direct command execution (no token cost)

Type a real shell command and YamX runs it locally without calling the model.

```text
systeminfo
lscpu
free -h
uptime
hostnamectl
docker ps
kubectl get pods
git status
npm run build
python -c "print(1+2)"
jq .scripts package.json
tar -xzf archive.tgz
```

YamX recognizes hundreds of commands across:

- Identity / process: `whoami`, `id`, `uname`, `uptime`, `who`, `ps`, `nice`, `tmux`, `screen`
- Filesystem: `cd`, `ls`, `cat`, `head`, `tail`, `mkdir`, `cp`, `mv`, `chmod`, `mount`, `lsblk`
- System inspection: `systeminfo`, `lscpu`, `lspci`, `free`, `vmstat`, `dmidecode`, `driverquery`, `gpresult`, `powercfg`, `sw_vers`, `hostnamectl`
- Networking: `ipconfig`, `ifconfig`, `ping`, `traceroute`, `dig`, `nmap`, `ss`, `iptables`, `ufw`, `nmcli`, `iperf3`
- Archives & text: `tar`, `zip`, `unzip`, `7z`, `jq`, `yq`, `xxd`, `base64`, `sha256sum`, `awk`, `sed`, `rg`, `fd`, `bat`
- Crypto / security: `openssl`, `gpg`, `ssh-keygen`, `mkcert`, `htpasswd`, `gitleaks`, `trivy`, `semgrep`
- Dev tools: `node`, `python`, `go`, `cargo`, `rustc`, `java`, `mvn`, `gradle`, `dotnet`, `php`, `ruby`, `make`, `cmake`
- Frameworks: `next`, `nuxt`, `vite`, `webpack`, `astro`, `remix`, `storybook`, `flutter`, `react-native`, `expo`
- Containers / cloud / k8s: `docker`, `podman`, `kubectl`, `helm`, `minikube`, `argocd`, `flux`, `terraform`, `aws`, `gcloud`, `az`, `gh`, `vercel`, `netlify`
- Databases: `psql`, `mysql`, `sqlite3`, `mongosh`, `redis-cli`, `pgcli`, `mongoimport`
- AI / blockchain: `ollama`, `llama-cli`, `huggingface-cli`, `forge`, `cast`, `solana`, `geth`
- Modern CLIs: `bat`, `eza`, `fd`, `dust`, `duf`, `fzf`, `zoxide`, `delta`, `zellij`, `tldr`, `man`

Natural-language requests like `fix the login bug`, `make my agent smarter`, or `what is this repo?` still go to the model. YamX detects the difference automatically.

You can also force a direct command with `$ cmd`, `! cmd`, `> cmd`, or `run: cmd`.

---

## Local tool auto-detection

On startup, YamX probes for common helpers using `where.exe` (Windows) or `command -v` (Unix) and injects the results into the system prompt:

- **Runtimes**: python, python3, py, node, deno, bun, ruby, perl, go, java, dotnet, rustc
- **Data**: jq, yq, xq, fx, mlr, duckdb, sqlite3
- **Search**: rg, grep, ag, findstr, fd
- **Text**: awk, sed, tr, sort, uniq, wc, cut, head, tail, paste, comm, diff, patch
- **Archive**: tar, gzip, bzip2, xz, zip, unzip, 7z, zstd
- **Crypto**: openssl, gpg, base64, sha256sum, sha1sum, md5sum, xxd
- **Network**: curl, wget, http, httpie, xh
- **Database**: psql, mysql, mongosh, redis-cli
- **Build**: make, cmake, ninja
- **Container / cloud**: docker, podman, kubectl, helm, aws, gcloud, az, gh, terraform
- **Shells**: bash, zsh, fish, pwsh, powershell, wsl

The model is told the chosen runner per category, e.g. `analysis runner: python | json: jq | yaml: yq | search: rg`. If a preferred tool is missing, the agent falls back automatically (`python` → `python3` → `py` → `node`; `jq` → `python` → `node`; `awk` → `gawk`; `grep` → `rg` → `findstr`).

Inspect everything with the in-chat `/run shell_diagnostics` command or by asking the agent for `shell_diagnostics`.

---

## Local compute first (token saver)

For analysis tasks, the agent is instructed to run a small one-liner locally instead of computing in the model:

```text
python -c "import json;d=json.load(open('package.json'));print(len(d.get('dependencies',{})))"
jq '.scripts | keys | length' package.json
rg -c "TODO" src
awk -F, '{c[$3]++} END {for (k in c) print c[k], k}' data.csv | sort -nr | head
sha256sum dist/*.js
```

Triggers include "how many", "what is the largest", "find all matches of", "summarize this file", "count by", "compare these", "extract X from Y", and similar. The agent feeds only the small result back into chat — not the full file.

---

## Failure and log analysis

When something breaks, YamX inspects command output, running task output, and log files before applying a fix.

```text
/log
/log app.log --mode auto
/log storage/logs/app.log --mode latest-error
/log app.log --mode summary
/log app.log --mode errors --lines 20 --pattern TypeError
```

| Mode | Use |
|------|-----|
| `auto` | Summary + latest error + recent tail. Best first choice. |
| `tail` | Last lines of a log, useful for recent crashes |
| `head` | Startup / header lines |
| `errors` | Error-like lines with nearby context |
| `latest-error` | Most recent error with context |
| `summary` | Counts fatal/error/warning/timeout signals and suggests next steps |
| `full` | Full log; use only when smaller modes are not enough |

For background commands started by YamX, use `/status`, `/tools`, or ask the agent to inspect `task_tail`.

When a command or log shows a failure signal, YamX adds an internal failure protocol for the model: extract the exact error, inspect logs/task output, search referenced code/config, apply the smallest fix, then rerun the narrow failing command.

---

## Token economy

YamX keeps output quality high while avoiding wasted tokens.

- **Direct commands** bypass the model entirely (zero tokens).
- **Adaptive model council** uses extra reasoning only for complex tasks.
- **Compact tool history** truncates large command/log/file outputs while preserving errors, warnings, and head/tail context.
- **Targeted inspection** prefers `read_file` line ranges, `search_files` context, `log_inspect summary/latest-error`, and `max_results` before full dumps.
- **Local compute first** instructs the model to run python/jq/awk locally instead of computing in chat.

Configurable in `yamx config`:

```text
Model council mode: adaptive | always | off
Max tool-result chars kept in history (4000–100000)
Context budget before auto-summary
```

---

## Configuration

- **Env / `.env`**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, optional `DEFAULT_PROVIDER`, `DEFAULT_MODEL`
- **Interactive**: `yamx config` — setup/switch wizard, API keys, default provider/model, context budget, tool-result history size, auto-approve, model council, view config
- **Reset only app settings** (keeps session files): `yamx --reset-config`

State files:

- `~/.yamx/config.json` — keys and preferences
- `~/.yamx/state.json` — active session id
- `~/.yamx/sessions/<uuid>.json` — message history per chat

---

## Sessions

| Command / flag | What it does |
|----------------|--------------|
| `yamx` | Continue last session (or most recent saved chat) |
| `yamx --new-chat` | New thread and session file |
| `yamx --history` | List saved conversations (`*` = active) |
| `yamx --resume <id>` | Resume by full UUID or unique prefix |
| `yamx --clear-chat` | Clear active session to system prompt only, then exit |
| `yamx --delete-chat <id>` | Delete one saved session by id or prefix |

- **Auto-save** after each turn, on `/exit`, and on Ctrl+C.
- **Long threads** are summarized internally when stored history exceeds the context budget; system message and recent messages are kept.
- **Manual compress**: `/compact`.

---

## In-chat commands

| Command | Description |
|---------|-------------|
| `/help` | Categorized help |
| `/clear` | Clear this chat in memory and on disk (system prompt kept) |
| `/compact` | Summarize older messages to save context |
| `/model` | Show provider and model |
| `/cost` | Token usage, history length, and context size |
| `/undo` | Revert last file edits from the current turn |
| `/diff` | `git diff` in cwd |
| `/status` | Runtime snapshot: provider, model, session, history, token counters |
| `/log [file]` | Discover logs or inspect one log file |
| `/tools` | List all 29 tools by category |
| `/run <cmd>` | Execute a shell command directly |
| `/init` | Initialize YamX memory files for the project |
| `/remember` | Save a persistent note (user or project scope) |
| `/memory` | Show active memory files and notes |
| `/agents` | List available subagents |
| `/agent <n> <t>` | Run a specific subagent with a task |
| `/skills` | List available logic skills |
| `/exit` | Save and quit |

---

## Built-in tools (29)

| Area | Tools |
|------|-------|
| Files (core) | `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `delete_file` |
| Advanced files | `multi_edit`, `copy_file`, `move_file`, `file_info`, `grep_search`, `directory_tree`, `patch_file` |
| Shell | `run_command`, `run_command_background`, `shell_diagnostics`, `task_list`, `task_tail`, `task_stop` |
| Git | `git_status`, `git_diff`, `git_commit`, `git_log`, `git_branch`, `git_stash` |
| Web | `fetch_url` |
| Intelligence | `project_intel`, `codebase_analysis`, `log_inspect` |

### Advanced tool notes

- `read_file` supports line ranges, `tail`, and `max_chars`; refuses likely binary files.
- `edit_file` supports `dry_run`, `occurrence`, and `replace_all`.
- `search_files` supports `case_sensitive`, `context_lines`, and `max_results`.
- `list_files` supports recursive/pattern listing, hidden files, and result caps.
- `log_inspect` supports discovery plus `auto`, `head`, `tail`, `errors`, `latest-error`, `summary`, and `full`.
- `run_command` is local-first and cross-platform; on Windows it can translate common Unix-style commands such as `pwd`, `ls`, `cat`, `head`, `tail`, `touch`, `mkdir -p`, `cp`, `mv`, `clear`.

---

## Project architecture

YamX is a TypeScript / Node.js CLI agent.

```text
yamx command
  -> src/index.ts          CLI flags, onboarding, config, REPL
  -> src/context.ts        project scan, memory, skills, system prompt, tool detection
  -> src/agent.ts          model calls, tool loop, approvals, retries, persistence
  -> src/tools/registry.ts all built-in tools exposed to the model
  -> src/providers/*       OpenAI, Anthropic, Gemini, OpenRouter, Ollama
```

| Path | Purpose |
|------|---------|
| `src/agent.ts` | Main agent loop, model council, streaming, tool execution, undo tracking, context compaction |
| `src/context.ts` | Project scan, framework detection, memory/skills loading, system prompt generation |
| `src/tool-detect.ts` | Cross-platform local tool probe (python, node, jq, awk, ...) |
| `src/tools/` | Filesystem, shell, Git, web, intelligence, log inspection tools |
| `src/tools/utils.ts` | Project path safety, shell selection, local-first PATH, command execution |
| `src/direct-command.ts` | Detects when user input is a direct shell command |
| `src/tool-risk.ts` / `src/policy.ts` | Classifies tool risk and decides approval/blocking behavior |
| `src/project-intel.ts` | Compact project intelligence and codebase analysis packets |
| `src/session-store.ts` | Persistent chat sessions under `~/.yamx/sessions/` |
| `src/memory.ts` / `src/skills.ts` / `src/subagents.ts` | Long-term notes, reusable skills, specialist agents |

### Development commands

```bash
npm install        # install dependencies and run prepare/build
npm run build      # compile TypeScript into dist/
npm test           # build and run the test suite
npm link           # expose local yamx globally for development
yamx --diagnose    # check runtime config, keys, git, Ollama, sessions, detected tools
```

On Windows PowerShell, use `npm.cmd run build` or `npm.cmd test` if script execution policy blocks `npm.ps1`.

### Runtime behavior

- **Local-first**: shell commands prefer project binaries from `node_modules/.bin`, `vendor/bin`, virtualenvs, `bin/`, `scripts/`.
- **Tool-aware**: cross-platform probe surfaces python/node/jq/awk/etc. and feeds the chosen runner to the model.
- **Failure-aware**: failed commands are analyzed via command output, `task_tail`, and `log_inspect mode=auto/latest-error/summary` before fixes.
- **Token-aware**: direct commands skip the model; tool history is compacted; analysis is delegated to local one-liners.
- **Safe by default**: normal read/build/test/dev commands run smoothly; sensitive, destructive, privileged, publishing, network-install, permission-changing, and force-push commands ask for approval or are blocked.
- **Persistent**: config, active session id, chat history, memory, and command history are stored under `~/.yamx/`.

---

## CLI reference

```text
yamx [options]

Options:
  -p, --provider <name>     openai | anthropic | gemini | openrouter | ollama
  -m, --model <id>          Model id
  -t, --temperature <n>     0–1 (default 0.1)
  --max-tokens <n>          Max output tokens
  --auto-approve            Approve all tool calls (unsafe)
  --no-stream               Disable streaming

  --new-chat                Start a new conversation
  --clear-chat              Clear active session history, exit
  --history                 List saved conversations, exit
  --resume <id>             Resume session (uuid or prefix)
  --delete-chat <id>        Delete a session, exit
  --onboard                 Setup/switch provider, API key, model, and core settings
  --reset-config            Reset ~/.yamx/config.json defaults, exit
  --diagnose                Check config, keys, connectivity, detected tools

Commands:
  yamx config               Interactive settings, setup wizard, token controls
```

---

## Troubleshooting

### `yamx` command not found
Run `npm prefix -g` and add `\bin` (Windows) or `/bin` (Unix) to your PATH. On Windows, reopen CMD/PowerShell after installing Node/npm.

### `EPERM` error on Windows
If you run `yamx` from your home directory (`C:\Users\<user>`) and see `EPERM: operation not permitted`, ensure you are using v1.0.4+. Windows has protected junction points (like `Application Data`) in the home folder that crash standard file scanners; YamX v1.0.4+ handles them gracefully.

### Banner shows old version after update
```bash
npm uninstall -g @needyamin/yamx
npm install -g @needyamin/yamx@latest
```

### `npm publish` returns 403
npm requires 2FA (or a granular access token with publish permission) for uploads. Bump the version in `package.json`, run `npm login`, then `npm publish --access public` and enter the OTP.

---

## License

ISC · **Made by [Yamin](https://github.com/needyamin)**
