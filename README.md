# YamX

Terminal assistant built around **commands, packages, scripts, logs, git, and quick local analysis**. It runs eligible input **straight on your shell** (no API call). When you ask in natural language, the model replies **short**, picks tools or shell commands, and follows **error → diagnose → fix → retry** instead of long chat.

**Providers:** OpenAI, Anthropic, Google Gemini, OpenRouter (many models), Ollama (local).

Needs **Node.js 18+**.

---

## Install

```bash
npm install -g @needyamin/yamx@latest
yamx
```

**From source**

```bash
git clone https://github.com/needyamin/yamx.git
cd yamx
npm install && npm link
```

**Without global install**

```bash
npx @needyamin/yamx
```

**Uninstall**

```bash
npm uninstall -g @needyamin/yamx
```

Remove data (config + sessions):

- Windows (PowerShell): `Remove-Item -Recurse -Force $HOME\.yamx`
- macOS / Linux: `rm -rf ~/.yamx`

---

## First steps

```bash
yamx --onboard    # provider, API key, default model, runtime options
yamx --diagnose   # Node, keys, git, Ollama, sessions, detected CLIs
yamx              # start; sessions live under ~/.yamx/sessions/
```

Without `~/.yamx/config.json`, the first **`yamx`** run walks through onboarding.

---

## Design: CLI first, minimal noise

Out of the box YamX behaves like a **quiet command-line assistant**:

- **`verboseCli`** defaults to **`false`**: fewer status lines and compact tool banners. Set **`true`** in `~/.yamx/config.json` for the older “verbose” telemetry.
- **Hidden model council** defaults to **`off`** (`settings.modelCouncil.enabled: false`). Turn it **`true`** only if you want an extra reasoning pass before the main reply (more tokens).

The **system prompt** tells every model to: stay on **one goal per turn**, **execute** (`run_command`, git, reads) ahead of narration, reply in **few lines**, ask **`Need:`** only when blocked, and **never repeat the same failing command** without changing something meaningful.

Natural language still gets **29 agent tools** (files, git, shell, URLs, codebase intel, logs) when a task needs them.

---

## Direct shell commands (zero LLM tokens)

If the input looks like a normal shell invocation, YamX runs it locally—**no provider call**.

Examples:

```text
git status
npm run build
python -c "print(2+3)"
jq .scripts package.json
systeminfo         # Windows
```

Prefixes that force passthrough:

```text
$ npm ls
! ls -la
> pwd
run: dotnet --info
```

Open-ended prompts (`fix login`, `explain this repo`, `add a retry`) route to the agent.

---

## Local tools YamX discovers

Startup probes common binaries (`python`, `node`, `jq`, `rg`, …) on **Windows** (`where.exe`) and Unix (`command -v`). The model receives which helpers exist so it can shell out for JSON, grep, hashing, archives, instead of rewriting that logic in prose.

`/run shell_diagnostics` or asking for **shell diagnostics** prints environment and shell behavior when commands act odd.

---

## Logs and failures

- **`/log`** / **`/log <file>`** with modes such as **`auto`**, **`latest-error`**, **`summary`**, **`tail`**, **`head`**, **`errors`**, **`full`**.
- Agent tool **`log_inspect`** aligns with those modes.

When **`run_command`** fails, the guided behavior is: use stderr/stdout, adjust command, cwd, shell, `.cmd` on Windows npm, deps, etc., then retry—without dumping giant logs unless needed.

---

## Configuration

Environment (optional `.env` in cwd):

| Variable | Role |
|---------|------|
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Provider keys |
| `DEFAULT_PROVIDER`, `DEFAULT_MODEL` | Override defaults |

Files under **`~/.yamx/`**:

| Path | Contents |
|------|----------|
| `config.json` | Providers, defaults, **`settings.verboseCli`**, **`settings.modelCouncil`**, stream, budgets, approvals, hooks, subagents |
| `state.json` | Active session id |
| `sessions/<uuid>.json` | Chat history |

Commands:

```text
yamx config          # interactive: wizard, council, budgets, keys
yamx --reset-config  # reset config.json defaults (sessions kept)
```

Relevant **`settings`** fields (defaults in code; merged with your saved `config.json`):

- **`verboseCli`** — extra UI telemetry when `true`.
- **`modelCouncil.enabled`** / **`modelCouncil.mode`** — `adaptive` \| `always` \| `off` (only matters if enabled).
- **`streamOutput`**, **`maxTokens`**, **`temperature`**, **`autoApprove`**, **`permissionMode`**, **`contextBudgetChars`**, **`maxToolResultChars`**, **`hooksEnabled`**, **`subagents.enabled`**.

---

## Sessions

| Flag / usage | Meaning |
|----------------|--------|
| `yamx` | Resume active session or most recent chat |
| `yamx --new-chat` | New thread |
| `yamx --history` | List saved conversations |
| `yamx --resume <id>` | UUID or unique prefix |
| `yamx --clear-chat` | Clear active session to system-only, exit |
| `yamx --delete-chat <id>` | Delete one session |

Auto-save each turn and on **`/exit`** / **Ctrl+C**. Long histories can be summarized to fit **`contextBudgetChars`**. Use **`/compact`** to summarize older turns manually.

---

## In-chat slash commands

| Command | Meaning |
|---------|--------|
| `/help` | Grouped reference |
| `/exit` \| `/quit` | Save and exit |
| `/clear` | Clear thread (system prompt retained) |
| `/compact` | Compress older messages |
| `/undo` | Revert last file edits this turn |
| `/model` | Provider and model |
| `/cost` | Session token counts + history size |
| `/diff` | `git diff` in cwd |
| `/status` | Session/runtime snapshot |
| `/log …` \| `/logs …` | Log helper (see `--mode`) |
| `/tools` | List tools by category |
| `/run <cmd>` | Run shell via YamX executor |
| `/init` | YamX memory files for this project |
| `/remember …` \| `/memory` | Persistent notes (`user:` prefix → user scope) |
| `/skills` | Loaded skill hints |
| `/agents` | Subagent roster |
| `/agent <name> <task>` | Run named subagent (respects **`subagents.enabled`**) |
| `/explore` \| `/plan` \| `/review` | Builtin read-only/analysis subagents |

---

## Built-in agent tools (29)

| Area | Tools |
|------|--------|
| Files | `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `delete_file`, `multi_edit`, `copy_file`, `move_file`, `file_info`, `grep_search`, `directory_tree`, `patch_file` |
| Shell | `run_command`, `run_command_background`, `shell_diagnostics`, `task_list`, `task_tail`, `task_stop` |
| Git | `git_status`, `git_diff`, `git_commit`, `git_log`, `git_branch`, `git_stash` |
| Web | `fetch_url` |
| Intelligence | `project_intel`, `codebase_analysis`, `log_inspect` |

For purely **CLI / package / script** questions the agent is steered toward **`run_command`** and manifests first; **`project_intel`** / **`codebase_analysis`** when navigating or fixing **application code**.

---

## Project layout (contributors)

```text
src/index.ts           CLI entry, onboarding, sessions, REPL loop
src/agent.ts           Streaming, tools, approvals, council hook, compaction
src/context.ts         Project scan, memory/skills injection, system prompt
src/direct-command.ts  Shell vs NL routing
src/tool-detect.ts     Cross-platform CLI discovery
src/tools/             Filesystem, shell, git, web, intel, logs
src/providers/         openai | anthropic | gemini | openrouter | ollama
src/session-store.ts   ~/.yamx/sessions
src/policy.ts          Permission and risk for tool calls
```

```bash
npm run build       # compile to dist/
npm test            # build + tests
npm run dev         # ts-node ES module dev run
yamx --diagnose
```

Windows: if **`npm`** scripts are blocked, use **`npm.cmd run build`**.

---

## CLI reference

```text
yamx [options]

Options
  -p, --provider <name>       openai | anthropic | gemini | openrouter | ollama
  -m, --model <id>
  -t, --temperature <n>
  --max-tokens <n>
  --auto-approve               approve all tools (dangerous)
  --no-stream
  --new-chat, --resume, --history, --clear-chat, --delete-chat
  --onboard, --reset-config, --diagnose

Subcommand
  yamx config                  interactive configuration
```

---

## Troubleshooting

**`yamx` not found** — Add npm’s global bin to `PATH`; reopen the terminal after `npm install -g`.

**Windows `EPERM` scanning home directory** — Use YamX **1.0.4+** (skips fragile junctions during project scan).

**Banner shows stale version after update** — `npm uninstall -g @needyamin/yamx && npm install -g @needyamin/yamx@latest`

**Publishing** — Bump `package.json` version; use npm 2FA or a publish-capable token; `npm publish --access public`.

---

## License

**ISC** — [Yamin](https://github.com/needyamin)
