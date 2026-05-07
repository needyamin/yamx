# YamX

A terminal coding agent with **27 tools**, **persistent chat sessions**, **markdown rendering**, and multi-provider LLM support. It reads and edits your project, runs shell commands (with your approval), uses Git and the web, and renders rich output with syntax-highlighted code blocks.

Providers: **OpenAI**, **Anthropic**, **Google Gemini**, **OpenRouter** (100+ models), **Ollama** (local).

---

## Global command `yamx`

Install once (needs **[Node.js 18+](https://nodejs.org/)** and npm):

```bash
npm install -g @needyamin/yamx@latest
```

Then from **any folder**, in **Terminal** (macOS/Linux), **CMD**, or **PowerShell** (Windows):

```bash
yamx
```

### Uninstallation (Remove Everything)
To completely remove YamX and all its data from your system:

1. **Remove the global package**:
   ```bash
   npm uninstall -g @needyamin/yamx
   ```

2. **Delete the configuration and sessions folder**:
   YamX stores your API keys and chat history in your home directory.
   - **Windows (PowerShell)**: `Remove-Item -Recurse -Force ~/.yamx`
   - **Windows (CMD)**: `rmdir /s /q %USERPROFILE%\.yamx`
   - **macOS/Linux**: `rm -rf ~/.yamx`

npm registers the CLI via the package [`bin`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bin) field.

**Without installing globally**, you can still run (after the package is on the npm registry):

```bash
npx @needyamin/yamx
```

**From a git clone** (developers):

```bash
cd yamx && npm install && npm link
```

After `npm link`, `yamx` is on your PATH like a global install.

### If `yamx` is not recognized

- Run `npm bin -g` (older npm) or check where global binaries go: `npm prefix -g` → add `\bin` (Windows) or `/bin` (Unix) to your **PATH**.
- On Windows, reopen CMD/PowerShell after installing Node/npm.

### Publishing (`npm publish` returns 403)

npm requires **two-factor authentication** (or a **granular access token** that can publish) for package uploads.

1. Enable **2FA** on your account: [npm → Profile → Two-Factor Authentication](https://www.npmjs.com/settings/~YOUR_USERNAME/profile) (mode that allows **publishing**).
2. Run `npm login` again.
3. **Bump the version**: npm never allows republishing the same version (even if deleted). Increase the `version` in `package.json` before each publish.
4. Run `npm publish --access public` and enter the **OTP** when npm asks.

Or create a [**Granular Access Token**](https://www.npmjs.com/settings/~YOUR_USERNAME/tokens) with **Publish packages** for `yamx` and authenticate with that token.

---

## Quick start

### Install from npm

```bash
npm install -g @needyamin/yamx@latest
```

### Install from source

```bash
git clone https://github.com/needyamin/yamx.git
cd yamx
npm install
npm run build
npm link
```

`npm install` runs `prepare` and builds `dist/` so the `yamx` binary is ready.

### First-time setup

```bash
yamx --onboard
```

The onboarding process is **100% terminal-native**. It will print the link to get your API key (e.g., [OpenRouter keys](https://openrouter.ai/keys)), but it won't force-open your browser.

Or set keys in `.env` / environment and use `yamx config`.

### Check your setup

```bash
yamx --diagnose
```

Shows Node version, API key status, Git availability, Ollama connectivity, and session count.

### Run

```bash
yamx
```

Conversations are **saved automatically** under `~/.yamx/sessions/`. The last active session is restored the next time you start YamX (unless you start a new chat).

---

## Configuration

- **Env / `.env`**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, optional `DEFAULT_PROVIDER`, `DEFAULT_MODEL`
- **Interactive**: `yamx config` (API keys, default provider/model, **context budget** for auto-summarization, auto-approve, view config)
- **Reset only app settings** (keeps session files): `yamx --reset-config`

---

## Session & memory

| Command / flag | What it does |
|----------------|----------------|
| `yamx` | Continue last session (or most recent saved chat) |
| `yamx --new-chat` | New thread and session file |
| `yamx --history` | List saved conversations (`*` = active) |
| `yamx --resume <id>` | Resume by full UUID or unique prefix |
| `yamx --clear-chat` | Clear **active** session to system prompt only, then exit |
| `yamx --delete-chat <id>` | Delete one saved session by id or prefix |

- **Auto-save**: After each completed turn, on `/exit`, and on Ctrl+C (SIGINT)
- **Long threads**: When stored history size exceeds **context budget** (chars, default in config), old turns are **summarized internally** while keeping the system message and recent messages—no extra user action required
- **Manual compress**: `/compact` in the REPL

State files:

- `~/.yamx/config.json` — keys and preferences  
- `~/.yamx/state.json` — active session id  
- `~/.yamx/sessions/<uuid>.json` — message history per chat  

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
| `/tools` | List all 27 tools by category |
| `/run <cmd>` | Execute a shell command directly |
| `/init` | Initialize YamX memory files for the project |
| `/remember` | Save a persistent note (user or project scope) |
| `/memory` | Show active memory files and notes |
| `/agents` | List available subagents |
| `/agent <n> <t>`| Run a specific subagent with a task |
| `/skills` | List available logic skills |
| `/exit` | Save and quit |

---

## Features

- **27 Built-in Tools**: Files, shell, Git, web, and intelligence — see table below
- **Project Intelligence**: Automatic file recommendations and framework detection
- **Direct Command Execution**: Type shell commands directly in chat (no prefix needed)
- **Subagent Delegation**: Delegate complex tasks to specialized agents (`/explore`, `/plan`, `/review`)
- **Persistent Memory**: Keep long-term project notes and user preferences across sessions
- **Markdown rendering**: AI responses are rendered with syntax highlighting in the terminal
- **Safety**: Destructive or privileged commands ask for confirmation unless `--auto-approve`
- **Auto-retry**: Transient API failures (429, 5xx, timeouts) retry with exponential backoff
- **JSON repair**: Malformed tool call arguments are auto-repaired before execution
- **Turn timing**: Each turn shows elapsed time and iteration count
- **Diagnostics**: `yamx --diagnose` checks keys, connectivity, and environment

---

## Built-in tools (27)

| Area | Tools |
|------|-------|
| Files (core) | `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `delete_file` |
| Advanced Files | `multi_edit`, `copy_file`, `move_file`, `file_info`, `grep_search`, `directory_tree`, `patch_file` |
| Shell | `run_command`, `run_command_background`, `shell_diagnostics`, `task_list`, `task_tail`, `task_stop` |
| Git | `git_status`, `git_diff`, `git_commit`, `git_log`, `git_branch`, `git_stash` |
| Web | `fetch_url` |
| Intelligence | `project_intel` |

---

## Troubleshooting

### `EPERM` error on Windows
If you run `yamx` from your home directory (`C:\Users\<user>`) and see `EPERM: operation not permitted`, ensure you are using **v1.0.4+**. 
Windows has protected junction points (like `Application Data`) in the home folder that crash standard file scanners. YamX v1.0.4+ includes a specialized scanner that handles these permissions gracefully.

### Version Mismatch
If the banner shows an old version after a global update, run:
```bash
npm uninstall -g @needyamin/yamx
npm install -g @needyamin/yamx@latest
```

---

## CLI reference

```text
yamx [options]

Options:
  -p, --provider <name>     openai | anthropic | gemini | openrouter | ollama
  -m, --model <id>         Model id
  -t, --temperature <n>    0–1 (default 0.1)
  --max-tokens <n>         Max output tokens
  --auto-approve           Approve all tool calls (unsafe)
  --no-stream              Disable streaming

  --new-chat               Start a new conversation
  --clear-chat             Clear active session history, exit
  --history                List saved conversations, exit
  --resume <id>            Resume session (uuid or prefix)
  --delete-chat <id>       Delete a session, exit
  --onboard                First-time setup wizard
  --reset-config           Reset ~/.yamx/config.json defaults, exit
  --diagnose               Check config, keys, connectivity

Commands:
  yamx config              Interactive settings (incl. context budget)
```

---

## License

ISC · **Made by [Yamin](https://github.com/needyamin)**
