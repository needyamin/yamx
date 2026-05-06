# Yam Agent CLI Implementation Plan

Yam Agent is a next-generation coding assistant CLI designed for speed, flexibility, and deep codebase understanding. It bridges the gap between cloud intelligence and local privacy.

## 1. Project Architecture
- **Language**: TypeScript (Node.js)
- **CLI Framework**: `commander` or `yargs` for base commands.
- **UI**: `ink` (React for CLI) or `blops` for interactive elements.
- **Providers**: Unified adapter for OpenAI, Anthropic, Gemini, and Ollama.
- **Context Engine**: 
    - File indexing using `ignore` patterns.
    - Local vector storage (e.g., `vector-db` or simple JSON-based for MVP) for RAG.
- **Tools**:
    - `read_file`, `write_file`, `list_files`.
    - `run_command` (with safety confirmation).
    - `git_manager`.

## 2. Core Modules

### A. Provider Layer
Define a standard `ModelProvider` interface:
```typescript
interface CompletionOptions {
  prompt: string;
  systemPrompt?: string;
  tools?: any[];
  stream?: boolean;
}

interface Provider {
  name: string;
  complete(options: CompletionOptions): Promise<string | AsyncIterable<string>>;
}
```

### B. Agent Loop
A standard ReAct (Reason + Act) loop:
1. Receive user input.
2. Formulate plan (Thought).
3. Select Tool (Action).
4. Execute Tool (Observation).
5. Update state and repeat until finished.

### C. Context Strategy
- **Initial Scan**: Index all non-ignored files.
- **Context Window Management**: Truncate/summarize history to fit provider limits.
- **Relevance Ranking**: Use BM25 or embeddings to find relevant files for a query.

## 3. Tech Stack
- **Runtime**: Node.js (v20+)
- **Storage**: `conf` for configuration, `lowdb` for history.
- **Styling**: `chalk`, `ora` (spinners), `boxen`.
- **Search**: `ripgrep` (if available) or `fast-glob`.

## 4. Phase-wise Development

### Phase 1: MVP
- [ ] Basic CLI setup.
- [ ] OpenAI/Anthropic provider implementation.
- [ ] Simple file read/write tools.
- [ ] Basic chat loop.

### Phase 2: Intelligence & Context
- [ ] Gemini & Ollama support.
- [ ] Local indexing (file structure + contents).
- [ ] Better terminal UI with streaming and markdown rendering.

### Phase 3: Advanced Features
- [ ] Git auto-commit.
- [ ] Command execution with approval.
- [ ] Multi-file editing (Search & Replace).
- [ ] MCP (Model Context Protocol) integration.

## 5. Security
- Configuration stored in OS-specific user data dirs.
- API keys masked.
- Interactive prompts for potentially destructive commands (e.g., `rm -rf`).
