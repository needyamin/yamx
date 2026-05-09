# YamX

**YamX** is a **terminal-first coding and ops agent**: it is built to help you run and fix things **from the command line**—scripts, package managers, installs, git, builds, logs, and local diagnostics—without turning every answer into a tutorial.

**Requirements:** Node.js **18+**.

---

## Purpose

YamX exists to be the **fast path between your intent and your machine**:

- **Concrete work** (run this, read that log, fix this error) should move through **commands and tools**, not long prose.
- **Repeated work** should land in **persisted sessions** so you can resume the same thread instead of re-explaining context.
- **Risky actions** should respect **permissions and policy**, not run silently.

It is not a general-purpose chat widget: the system behavior, defaults, and tooling are aligned with **developers and operators who live in a shell**.

---

## Goals (what “good” looks like)

| Goal | What YamX does toward it |
|------|---------------------------|
| **CLI-native** | Plain shell-like input can run **without an LLM round-trip** when it is clearly a command. |
| **Current intent first** | Each turn is classified as conversation, unclear follow-up, direct command, or task. YamX does not blindly continue old work when the user greets, changes topic, or sends small talk. |
| **Fix loops** | Failures from `run_command` and similar tools are meant to drive **diagnose → change something → retry**, not copy-paste essays. |
| **Short user-facing answers** | Prompting and UI bias toward **dense** replies. Assistant markdown is **hard-capped** per message (see Configuration) so huge generations do not flood the terminal or bloat saved history. |
| **Local facts first** | Detected local tooling (e.g. Python, Node, ripgrep) is surfaced in context so the model reaches for **your** environment before inventing steps. |
| **Ops preflight** | For install/PATH/version asks about runtimes, YamX injects `yamx_local_preflight`; for vague local ops asks like **“install it”** or **“diagnose it”**, it injects `yamx_project_preflight` with nearby manifests, scripts, lockfiles, git/runtime probes, local bins, and candidate commands. |
| **Cross-platform shell intelligence** | `auto` shell mode detects and translates common Windows/Unix/PowerShell command shapes for local inspection, diagnostics, package scripts, and network probes. |
| **Senior ops domains** | Built-in context modes guide DevOps/full-stack operations, network engineering, and defensive cybersecurity work with read-only probes first and explicit approval for risky mutation. |
| **One-terminal workflow** | YamX keeps a guarded shell working directory, so `cd src` affects the next command while staying inside the project. Use `/pwd` and `/cd`, or just type normal shell lines. |
| **AI shell recovery** | If a direct shell command fails, YamX feeds the command, cwd, and output back into the agent so the model can diagnose, fix, and retry in the same terminal. |
| **Command memory** | YamX records successful and failed project commands in project-local `.yamx/command-memory.json` by default (override with `YAMX_HOME`) and feeds recent patterns into future diagnosis/setup turns. |
| **Safe automation** | Hooks, approval modes, and optional allow/deny shell patterns support controlled automation. |
| **Terminal-friendly output** | Wrapping respects **left and right gutters** (scrollbar/host padding) so long lines and boxed **tool/results** panels are less likely to clip at the edges. **`run_command`** panels show **much more output** before summarizing—full text still reaches the agent. |
| **REPL readability** | After bulk output (↑/↓ **history replay** included), YamX resets ANSI styling and emits a newline **cue** so the next **`YamX ›`** prompt sits on a clean line in narrow or Windows-hosted terminals. |

---

## What it is (and is not)

**It is**

- A REPL-style **agent** with **built-in tools** (files, shell, git, logs, light web fetch, project intelligence).
- **Multi-provider**: OpenAI, Anthropic, Gemini, Kimi/Moonshot, Grok (xAI), OpenRouter, Ollama (local).
- **Session-based**: config and chat snapshots under `~/.yamx` (on Windows, `%USERPROFILE%\.yamx`).

**It is not**

- A guarantee that the remote model will never *attempt* a long reply—it can still stream tokens—but YamX **clips** what is shown and what is **persisted** beyond a configurable limit.
- A replacement for your IDE’s refactor engine; it is optimized for **terminal workflows** and **repository + shell** tasks.

---

## Install

```bash
npm install -g @needyamin/yamx@latest
yamx
```

**From this repository**

```bash
git clone https://github.com/needyamin/yamx.git && cd yamx
npm install && npm link
```

**Without a global install**

```bash
npx @needyamin/yamx
```

**Uninstall**

```bash
npm uninstall -g @needyamin/yamx
```

Remove all YamX data:

```bash
# macOS / Linux
rm -rf ~/.yamx

# Windows PowerShell
Remove-Item -Recurse -Force $HOME\.yamx
```

---

## First run

```bash
yamx --onboard    # provider, API key, default model, core settings
yamx --diagnose   # config, keys (masked), connectivity, sessions
yamx              # start the REPL (sessions persist)
```

If `~/.yamx/config.json` is missing—or your default cloud provider has **no** API key in config and no matching env var—a normal `yamx` run starts the **same onboarding flow** before the REPL. Use `yamx --onboard` anytime to change setup.

---

## How input is handled

- **Current intent guard** — Every agent turn gets a `yamx_current_intent` block: `conversation`, `clarification`, `direct-command`, or `task`. Greetings and acknowledgements stay brief and do **not** trigger preflight, project intel, model council, old task output, or commands. Unclear follow-ups like **"more"** or **"do it"** ask one short clarification instead of guessing from stale context.
- **Direct shell** — Lines that look like real shell commands can execute **locally with no LLM call** (zero tokens for that line). To force shell execution and skip routing, you can use prefixes such as `$ cmd`, `! cmd`, `> cmd`, or `run: cmd`.
- **Persistent cwd** — Direct shell commands and `run_command` share a YamX working directory. `cd src` / `/cd src` changes where later shell commands run; attempts to leave the launch project are blocked.
- **Direct shell recovery** — If a direct command or `/run ...` fails, YamX converts that failure into an agent repair turn with the original command and output, so diagnosis and fixes continue without opening another terminal.
- **Command memory** — YamX learns which commands worked or failed in this project/cwd and uses that evidence in later `install it`, `diagnose it`, `run it`, and fix turns.
- **Ops preflight** — Phrases like **“install python”** are not valid shell lines, so they go to the agent. Before that turn’s model call, YamX may already have run **`where` / `py -0` / `python --version`** (and similar) on **your OS** and appended `yamx_local_preflight`. Vague project-local asks like **“install it”**, **“diagnose it”**, or **“run this project”** append `yamx_project_preflight` with nearby scripts, lockfiles, package manager, git status, local bins, runtime probes, and candidate next commands. The model is instructed to use that evidence and propose concrete `run_command` steps on this machine, not generic setup prose. Disable via `settings.preflightRuntimeProbes` (see Configuration).
- **Agent** — Natural-language requests go to the configured model with **tool calling**: the agent is steered toward **run / inspect / fix** rather than platform-wide install guides.

---

## Domain intelligence

YamX is tuned for terminal-heavy engineering domains, but it still starts with local evidence and policy checks.

| Domain | Safe default behavior |
|--------|------------------------|
| **Software development** | Inspect manifests/code/logs, run existing scripts, patch narrowly, and verify with the cheapest useful command before broad builds. |
| **DevOps / full-stack operations** | Prefer `docker --version`, `docker compose config`, `kubectl version --client`, `helm lint`, `terraform validate`, `ansible-playbook --syntax-check`, and dry-run/status/plan-style commands before mutation. |
| **Network engineering** | Inspect interfaces, routes, DNS, listeners, targeted reachability, and HTTP/TLS layers first. Avoid route/firewall/DNS/VPN/interface changes unless explicitly requested and approved. |
| **Defensive cybersecurity** | Support secure code review, dependency/CVE triage, secrets detection, SAST, container/IaC/Kubernetes hardening, and incident/log triage. Authorized local scope is assumed; active probing outside local/owned scope requires explicit authorization. |

Security mode avoids malware, credential theft, persistence, evasion, destructive payloads, unauthorized scanning, exploit chaining, and bypass instructions. Secret findings should be redacted to path/type/fingerprint and followed by rotation/removal guidance.

---

## Configuration

**Environment** (optional `.env` in the current working directory):

| Variable | Role |
|----------|------|
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY`/`KIMI_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY` | Provider secrets |
| `DEFAULT_PROVIDER`, `DEFAULT_MODEL` | Defaults |

**Filesystem layout:**

| Path | Role |
|------|------|
| `~/.yamx/config.json` | Providers, keys, `settings` |
| `~/.yamx/state.json` | Active session id |
| `~/.yamx/sessions/*.json` | Chat history |
| `.yamx/command-memory.json` | Project-local command outcomes (override base directory with `YAMX_HOME`) |

Interactive editor:

```bash
yamx config
yamx --reset-config   # reset config file to defaults (sessions kept)
```

**Notable `settings` keys:**

| Key | Role |
|-----|------|
| `streamOutput` | Streaming vs batched model output |
| `maxTokens`, `temperature` | Generation limits |
| `autoApprove`, `permissionMode` | Tool execution policy |
| `contextBudgetChars` | When long history triggers in-agent summarization |
| `maxToolResultChars` | How much tool output is kept in model-visible history |
| `maxAssistantMarkdownChars` | **Hard cap** on assistant markdown **rendered and stored** per assistant message (default **3200**). Raise in `config.json` when you need longer explanations. |
| `preflightRuntimeProbes` | When **`true`** (default), install/PATH/version-style runtime messages and vague local ops messages trigger **automatic read-only probes** before the model reply. Set **`false`** to skip injection of `yamx_local_preflight` / `yamx_project_preflight`. |
| `verboseCli` | Extra status / decorative output (default off) |
| `modelCouncil.enabled` / `.mode` | Optional hidden “council” planning pass |
| `hooksEnabled` | Hook scripts around agent events |
| `subagents.enabled` | Built-in subagent slash commands |

---

## Sessions and context

Histories autosave while you work.

| Need | Command / flag |
|------|----------------|
| Shrink this conversation in place | `/compact` |
| New thread | `yamx --new-chat` |
| List saved threads | `yamx --history` |
| Resume a thread | `yamx --resume <id>` |
| Clear active thread to bootstrap, exit | `yamx --clear-chat` |
| Delete one snapshot | `yamx --delete-chat <id>` |

If the provider rejects a request for **context limits**, YamX tries to surface a readable error; proactively use **`/compact`**, **`--new-chat`**, or a larger-context **model**.

---

## Slash commands (in-session)

Examples: `/help`, `/exit` | `/quit`, `/clear`, `/compact`, `/undo`, `/model`, `/cost`, `/diff`, `/status`, `/pwd`, `/cd …`, `/log` | `/logs`, `/tools`, `/run …`, `/init`, `/remember`, `/memory`, `/skills`, `/agents`, `/agent …`, `/explore`, `/plan`, `/review`.

Use `/help` in the REPL for the authoritative list.

---

## Built-in tools (29)

**Files:** `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `delete_file`, `multi_edit`, `copy_file`, `move_file`, `file_info`, `grep_search`, `directory_tree`, `patch_file`.

**Shell:** `run_command`, `run_command_background`, `shell_diagnostics`, `task_list`, `task_tail`, `task_stop`.

**Git:** `git_status`, `git_diff`, `git_commit`, `git_log`, `git_branch`, `git_stash`.

**Web:** `fetch_url`.

**Intel / logs:** `project_intel`, `codebase_analysis`, `log_inspect`.

---

## Develop and contribute

```text
src/index.ts               CLI entry, flags, onboarding, persistence
src/agent.ts               Streaming, tools, compaction, approvals
src/context.ts             Workspace scan + system prompt
src/direct-command.ts      Shell routing vs agent
src/intent.ts              Current-turn intent classification and metadata
src/ui.ts                  Terminal Markdown and layout
src/assistant-output-cap.ts Limits on assistant markdown
src/terminal-layout.ts     Viewport widths, gutters, panel wrap math
src/tty-repl-cue.ts        TTY reset + newline cue before prompts after output
src/runtime-preflight.ts   Auto local probes before agent turn (install/PATH intents)
src/tools/                 Built-in tool implementations
```

```bash
npm install
npm run build
npm test
npm run dev          # ts-node ESM boot
yamx --diagnose
```

On Windows, if PowerShell execution policy blocks `npm` scripts, prefer **`npm.cmd run …`**.

---

## CLI flags

```text
yamx [options]

  -p, --provider <name>     openai | anthropic | gemini | kimi | grok | openrouter | ollama
  -m, --model <name>
  -t, --temperature <n>
  --max-tokens <n>
  --auto-approve
  --no-stream
  --new-chat
  --resume <id>
  --history
  --clear-chat
  --delete-chat <id>
  --onboard
  --reset-config
  --diagnose

yamx config               interactive configuration
```

---

## Troubleshooting

**`yamx`: command not found** — Ensure npm’s global `bin` directory is on `PATH`; open a new terminal after `npm install -g`.

**Box drawing / glyphs look wrong on Windows** — Prefer **Windows Terminal**, or run `chcp 65001` for UTF‑8 code page before starting YamX.

**Assistant replies cut off** — Raise `settings.maxAssistantMarkdownChars` in `~/.yamx/config.json` (defaults are intentionally aggressive for CLI-style answers).

**Model still writes install essays** — Confirm `settings.preflightRuntimeProbes` is not `false`; `yamx_local_preflight` should appear for turns like “install python,” and `yamx_project_preflight` should appear for turns like “install it.” If a model ignores it, switch model or lower temperature; YamX cannot fully control remote model behavior.

**Extra user message in saved chats** — Preflight adds a second `user` role message with probe output. That is intentional so the thread stays auditable and the model stays grounded.

**YamX continues old work after small talk** — Recent versions inject `yamx_current_intent` and skip project intel/preflight/model council for greetings and acknowledgements. Run `yamx --diagnose` to confirm version, then start a new chat with `yamx --new-chat` if an old session is polluted.

**`npm whoami` → 401** — Run `npm login` and verify `npm whoami`.

**Publishing scope errors** — The logged-in npm user must be allowed to publish the package **`name`** in `package.json` (see npm docs for scopes and org publishing).

**Provider context / token limit errors** — Use `/compact`, `yamx --new-chat`, or a model with a larger context window.

**Stale global version** — `npm uninstall -g @needyamin/yamx && npm install -g @needyamin/yamx@latest`.

**Publishing “cannot publish over previously published versions”** — Bump **`version`** in `package.json` (and reinstall / republish); npm never replaces an existing semver.

**Long lines touch the edges or prompt looks stuck** — YamX trims wrap width from `stdout.columns`; very narrow terminals, split editor panels, or exotic Unicode widths can still mis-measure host-side. Try a wider pane or **Windows Terminal**; increase terminal width slightly if glyphs clip.

**Huge tool stderr/stdout still summarized in the panel** — The on-screen panel can cap **characters and line count** while the **full string** stays in agent context (`maxToolResultChars` still applies to history). Raise limits or skim the transcript in **`~/.yamx/sessions/`** if needed.

**Git scan `EPERM` under Windows profile folders** — Prefer recent YamX versions when scanning permissive directories.

---

## License
**ISC** — [Yamin](https://github.com/needyamin)
