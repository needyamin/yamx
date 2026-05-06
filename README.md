# ⚡ YamX

A powerful coding agent that lives in your terminal. Talk to it, and it reads your code, edits files, runs commands, and manages git — all by itself.

Works with **OpenAI**, **Anthropic (Claude)**, **Google Gemini**, **OpenRouter** (100+ models), and **Ollama** (local/offline).

---

## Setup

### 1. Install

```bash
git clone https://github.com/needyamin/yamx.git
cd yamx
npm install
npm run build
```

### 2. Add your API key

Create a `.env` file in the project root:

```env
# Pick one (or all):
OPENAI_API_KEY=sk-your-key-here
ANTHROPIC_API_KEY=sk-ant-your-key-here
GEMINI_API_KEY=your-key-here
OPENROUTER_API_KEY=sk-or-your-key-here
```

No key needed for Ollama — just have it running locally.

### 3. Run

```bash
node dist/index.js
```

That's it. You'll see the prompt:

```
yamx ❯
```

Type what you want and YamX does it.

---

## Picking a Provider

```bash
# OpenAI (default)
node dist/index.js

# Anthropic Claude
node dist/index.js -p anthropic

# Google Gemini
node dist/index.js -p gemini

# OpenRouter (access 100+ models with one key)
node dist/index.js -p openrouter -m deepseek-chat
node dist/index.js -p openrouter -m llama-4-maverick
node dist/index.js -p openrouter -m qwen-3-235b
node dist/index.js -p openrouter -m claude-sonnet-4

# Ollama (local, no internet needed)
node dist/index.js -p ollama -m qwen2.5-coder
```

### OpenRouter Model Shortcuts

| Shortcut | Full Model |
|----------|-----------|
| `deepseek-chat` | deepseek/deepseek-chat-v3-0324 |
| `deepseek-r1` | deepseek/deepseek-r1 |
| `llama-4-maverick` | meta-llama/llama-4-maverick |
| `llama-4-scout` | meta-llama/llama-4-scout |
| `qwen-3-235b` | qwen/qwen3-235b-a22b |
| `qwen-3-30b` | qwen/qwen3-30b-a3b |
| `gemini-2.5-pro` | google/gemini-2.5-pro-preview |
| `claude-sonnet-4` | anthropic/claude-sonnet-4 |
| `gpt-4o` | openai/gpt-4o |
| `gpt-4.1` | openai/gpt-4.1 |
| `o3` | openai/o3 |
| `codestral` | mistralai/codestral-2501 |

Or use any full model ID from [openrouter.ai/models](https://openrouter.ai/models).

---

## What Can It Do?

Just ask in plain English. Examples:

```
yamx ❯ read the package.json and tell me what framework this uses
yamx ❯ find all TODO comments in the codebase
yamx ❯ add a login route to server.ts
yamx ❯ run the tests and fix any failures
yamx ❯ create a .gitignore file
yamx ❯ show me the git status and commit everything
yamx ❯ fetch the docs from https://example.com/api and summarize them
```

### Built-in Tools (20)

| Tool | What it does |
|------|-------------|
| `read_file` | Read any file with line numbers |
| `write_file` | Create or overwrite a file |
| `edit_file` | Change part of a file (search & replace) |
| `multi_edit` | Multiple edits in one file at once |
| `list_files` | List directory contents |
| `search_files` | Search text across files (like grep) |
| `delete_file` | Delete a file |
| `copy_file` | Copy a file or directory |
| `move_file` | Move or rename a file |
| `file_info` | Get file metadata (size, dates, lines) |
| `run_command` | Run a terminal command |
| `run_command_background` | Start a long-running process |
| `git_status` | Check git status |
| `git_diff` | See what changed |
| `git_commit` | Stage and commit |
| `git_log` | View commit history |
| `git_branch` | List/create/switch branches |
| `git_stash` | Save/restore work in progress |
| `fetch_url` | Fetch web pages and API docs |

---

## Slash Commands

Type these during a conversation:

| Command | What it does |
|---------|-------------|
| `/help` | Show all commands |
| `/clear` | Reset conversation |
| `/undo` | Undo last file changes |
| `/diff` | Show git diff |
| `/compact` | Shrink conversation to save tokens |
| `/cost` | Show token usage |
| `/model` | Show current provider/model |
| `/exit` | Quit |

---

## Options

```bash
node dist/index.js [options]

  -p, --provider <name>    openai, anthropic, gemini, openrouter, ollama
  -m, --model <name>       Model name
  -t, --temperature <n>    Creativity (0-1, default: 0.1)
  --max-tokens <n>         Max response length (default: 16384)
  --auto-approve           Skip approval prompts (use carefully)
  --no-stream              Disable streaming output
```

---

## Global Install (Optional)

To use `yamx` from anywhere on your system:

```bash
npm link
```

Now just type `yamx` in any project folder.

---

## Safety

- YamX asks for permission before writing files or running commands
- Dangerous commands (like `rm -rf`) get an extra warning
- Files outside your project folder are blocked
- Commands have a 60-second timeout
- API failures auto-retry with exponential backoff

---

## License

ISC

**Made by [Yamin](https://github.com/needyamin)**
