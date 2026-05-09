# YamX

**YamX** is a terminal assistant centered on **shell commands**, **packages and scripts**, **git**, **logs**, and fast local facts. Matching input runs **directly on your machine** with **no LLM call**. Natural-language prompts use a connected model plus **29 built-in tools**; replies are biased toward **short answers**, **few questions**, and **run / fix / retry** on errors.

Requires **Node.js 18+**.

**Providers:** OpenAI, Anthropic, Google Gemini, OpenRouter (wide model choice), Ollama (local).

---

## Install

```bash
npm install -g @needyamin/yamx@latest
yamx
```

**From Git**

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

Config and chats live under `~/.yamx` (`%USERPROFILE%\.yamx` on Windows). To remove everything:

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
yamx --diagnose   # Node, registry, keys (mask), git, Ollama, sessions, probes
yamx              # REPL (sessions persist under ~/.yamx/sessions/)
```

If **`~/.yamx/config.json`** is missing, or your **default (or `-p`) cloud provider** has **no API key** in config and no matching env var (`OPENROUTER_API_KEY`, etc.), a normal **`yamx`** run starts **the same interactive flow as `yamx --onboard`** before the REPL. Use **`yamx --onboard`** anytime to redo setup explicitly.

---

## Highlights

| Topic | Behavior |
|--------|-----------|
| **Local first** | Lines that look like shell commands bypass the API (zero tokens). |
| **CLI detection** | Common tools (`python`, `node`, `jq`, `rg`, …) are probed per OS and surfaced in context. |
| **Quiet UI** | `verboseCli` defaults to `false`. Model council defaults to **off**. |
| **Provider errors** | Many API/stream failures are shown in a **boxed**, readable summary plus suggested next steps (e.g. context too large → `/compact` or `--new-chat`). |
| **Safety** | Risky tooling can require confirmation; destructive patterns can be blocked. |

Forced shell prefixes when you want to avoid the router: `$ cmd`, `! cmd`, `> cmd`, or `run: cmd`.

---

## Configuration

Environment (optional `.env` in cwd):

| Variable | Purpose |
|-----------|---------|
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Provider secrets |
| `DEFAULT_PROVIDER`, `DEFAULT_MODEL` | Defaults |

Filesystem:

| Path | Purpose |
|------|---------|
| `~/.yamx/config.json` | Providers, keys, `settings.*` |
| `~/.yamx/state.json` | Active session id |
| `~/.yamx/sessions/*.json` | Chat history |

```bash
yamx config         # wizard and toggles
yamx --reset-config # wipe config defaults only (sessions kept)
```

Important **`settings`** keys: `verboseCli`, `modelCouncil.enabled` / `.mode`, `streamOutput`, `maxTokens`, `temperature`, `autoApprove`, `permissionMode`, `contextBudgetChars`, `maxToolResultChars`, `hooksEnabled`, `subagents.enabled`.

---

## Sessions & context

If the combined **system prompt + chat** exceeds what the provider allows, YamX tries to summarize that failure clearly. To avoid it proactively:

| Action | Effect |
|---------|--------|
| `/compact` | Summarize older turns in-session |
| `yamx --new-chat` | New thread (smaller history) |

| Flag | Effect |
|------|--------|
| `yamx` | Resume latest / active chat |
| `yamx --new-chat` | New session file |
| `yamx --history` | List saved threads |
| `yamx --resume <id>` | UUID or prefix |
| `yamx --clear-chat` | Trim active thread to bootstrap, exit |
| `yamx --delete-chat <id>` | Drop one snapshot |

Histories autosave during use. Long threads align with **`contextBudgetChars`** (internal summarization).

---

## Slash commands (in-session)

`/help`, `/exit` | `/quit`, `/clear`, `/compact`, `/undo`, `/model`, `/cost`, `/diff`, `/status`, `/log` | `/logs`, `/tools`, `/run ...`, `/init`, `/remember`, `/memory`, `/skills`, `/agents`, `/agent ...`, `/explore`, `/plan`, `/review`.

---

## Agent tools (29)

**Files:** `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `delete_file`, `multi_edit`, `copy_file`, `move_file`, `file_info`, `grep_search`, `directory_tree`, `patch_file`.

**Shell:** `run_command`, `run_command_background`, `shell_diagnostics`, `task_list`, `task_tail`, `task_stop`.

**Git:** `git_status`, `git_diff`, `git_commit`, `git_log`, `git_branch`, `git_stash`.

**Web:** `fetch_url`.

**Intel / logs:** `project_intel`, `codebase_analysis`, `log_inspect`.

---

## Contribute / build

```text
src/index.ts               CLI flags, onboarding, persistence
src/agent.ts               Stream, tools, compaction, approvals
src/context.ts             Project scan + system prompt
src/provider-error-format.ts
src/direct-command.ts      Shell vs routed input
src/tools/                  Built-in tooling
```

```bash
npm install
npm run build
npm test
npm run dev               # TS dev boot
yamx --diagnose
```

PowerShell blocking `npm` scripts → use **`npm.cmd run ...`**.

---

## CLI flags

```text
yamx [options]

-p, --provider <name>     openai | anthropic | gemini | openrouter | ollama
-m, --model <name>
-t, --temperature <n>
--max-tokens <n>
--auto-approve
--no-stream
--new-chat, --resume, --history, --clear-chat, --delete-chat
--onboard, --reset-config, --diagnose

yamx config              interactive configurator
```

---

## Troubleshooting

**`yamx`: command not found** — Put npm’s global `bin` on `PATH`; open a fresh terminal after `npm install -g`.

**Diagnose glyphs look wrong on Windows** — Prefer **Windows Terminal**, or run **`chcp 65001`** before YamX so UTF‑8 glyphs render; alternatively ignore cosmetic markers-only lines.

**`npm whoami` → 401 Unauthorized** — Not logged in or token expired:

```bash
npm login
npm whoami
```

Check `~/.npmrc` for an old `_authToken` and redo login if publishing fails.

**`npm publish` → 404 for `@scope/name`** — The logged-in **`npm`** user must **own that scope**. For **`@needyamin/yamx`**, `npm whoami` should be **`needyamin`** (or you must be an org **`@needyamin`** publisher). Otherwise rename `package.json` **`name`** to `@yourusername/yamx` and publish with **`"publishConfig": { "access": "public" }`**.

**Context / token limit errors from the provider** — Use **`/compact`**, **`--new-chat`**, or a larger-context **model**.

**Stale banner version** — Reinstall globals: **`npm uninstall -g @needyamin/yamx && npm install -g @needyamin/yamx@latest`**.

**Git scan `EPERM` under Windows user profile folders** — Use YamX **1.0.4+** when scanning noisy home dirs.

---

## License

**ISC** — [Yamin](https://github.com/needyamin)
