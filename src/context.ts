/**
 * YamX - Context Engine
 * Scans the project, builds a map, and provides relevant context to the LLM.
 */

import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';
import { MemoryManager } from './memory.js';
import { SkillManager } from './skills.js';

export interface ProjectContext {
  projectName: string;
  projectType: string;
  fileTree: string;
  totalFiles: number;
  languages: string[];
  framework?: string;
  packageManager?: string;
  packageScripts?: Record<string, string>;
  dependencies?: string[];
  devDependencies?: string[];
}

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript React',
  '.js': 'JavaScript', '.jsx': 'JavaScript React',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go',
  '.java': 'Java', '.c': 'C', '.cpp': 'C++', '.h': 'C/C++ Header',
  '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP',
  '.swift': 'Swift', '.kt': 'Kotlin',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
  '.md': 'Markdown', '.sql': 'SQL',
  '.sh': 'Shell', '.bash': 'Bash', '.ps1': 'PowerShell',
  '.dockerfile': 'Docker', '.toml': 'TOML',
  '.vue': 'Vue', '.svelte': 'Svelte',
  '.zig': 'Zig', '.lua': 'Lua', '.dart': 'Dart',
};

export class ContextEngine {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async scan(): Promise<ProjectContext> {
    const projectName = path.basename(this.cwd);

    const files = await fg('**/*', {
      cwd: this.cwd,
      ignore: [
        'node_modules/**', '.git/**', 'dist/**', 'build/**',
        '__pycache__/**', '*.pyc', '.venv/**', 'venv/**',
        '.next/**', '.nuxt/**', 'coverage/**', '*.lock',
        '.DS_Store', 'Thumbs.db',
        'Application Data/**', 'Local Settings/**', 'My Documents/**',
        'NetHood/**', 'PrintHood/**', 'Recent/**', 'SendTo/**',
        'Start Menu/**', 'Templates/**', 'Cookies/**',
      ],
      onlyFiles: true,
      suppressErrors: true,
      followSymbolicLinks: false,
    });

    const extCount: Record<string, number> = {};
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (ext) extCount[ext] = (extCount[ext] || 0) + 1;
    }

    const languages = Object.entries(extCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext]) => LANGUAGE_MAP[ext] || ext)
      .filter(Boolean);

    const projectType = await this.detectProjectType();
    const framework = await this.detectFramework();
    const packageManager = await this.detectPackageManager();
    const packageInfo = await this.readPackageInfo();
    const fileTree = await this.buildFileTree(3);

    return {
      projectName,
      projectType,
      fileTree,
      totalFiles: files.length,
      languages,
      framework,
      packageManager,
      packageScripts: packageInfo.scripts,
      dependencies: packageInfo.dependencies,
      devDependencies: packageInfo.devDependencies,
    };
  }

  private async readPackageInfo(): Promise<{
    scripts: Record<string, string>;
    dependencies: string[];
    devDependencies: string[];
  }> {
    try {
      const pkgPath = path.join(this.cwd, 'package.json');
      if (!await fs.pathExists(pkgPath)) {
        return { scripts: {}, dependencies: [], devDependencies: [] };
      }

      const pkg = await fs.readJSON(pkgPath);
      return {
        scripts: pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {},
        dependencies: Object.keys(pkg.dependencies || {}).sort(),
        devDependencies: Object.keys(pkg.devDependencies || {}).sort(),
      };
    } catch {
      return { scripts: {}, dependencies: [], devDependencies: [] };
    }
  }

  private async buildFileTree(maxDepth: number, dir = '', depth = 0): Promise<string> {
    if (depth >= maxDepth) return '';

    const fullPath = path.join(this.cwd, dir);
    if (!await fs.pathExists(fullPath)) return '';

    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.readdir(fullPath, { withFileTypes: true });
    } catch {
      return '';
    }

    const ignored = new Set(['node_modules', 'dist', 'build', '__pycache__', '.git', 'coverage', '.next']);
    const filtered = entries.filter((e) => !e.name.startsWith('.') && !ignored.has(e.name));

    const lines: string[] = [];
    for (const entry of filtered) {
      const prefix = '  '.repeat(depth);
      const marker = entry.isDirectory() ? '[dir]' : '[file]';
      lines.push(`${prefix}${marker} ${entry.name}`);

      if (entry.isDirectory()) {
        const subTree = await this.buildFileTree(maxDepth, path.join(dir, entry.name), depth + 1);
        if (subTree) lines.push(subTree);
      }
    }

    return lines.join('\n');
  }

  private async detectProjectType(): Promise<string> {
    const checks = [
      { file: 'package.json', type: 'Node.js' },
      { file: 'requirements.txt', type: 'Python' },
      { file: 'pyproject.toml', type: 'Python' },
      { file: 'Cargo.toml', type: 'Rust' },
      { file: 'go.mod', type: 'Go' },
      { file: 'pom.xml', type: 'Java Maven' },
      { file: 'build.gradle', type: 'Java Gradle' },
      { file: 'Gemfile', type: 'Ruby' },
      { file: 'composer.json', type: 'PHP' },
      { file: 'Makefile', type: 'Make' },
      { file: 'CMakeLists.txt', type: 'CMake' },
    ];

    for (const { file, type } of checks) {
      if (await fs.pathExists(path.join(this.cwd, file))) return type;
    }
    return 'Unknown';
  }

  private async detectFramework(): Promise<string | undefined> {
    try {
      const pkgPath = path.join(this.cwd, 'package.json');
      if (await fs.pathExists(pkgPath)) {
        const pkg = await fs.readJSON(pkgPath);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.next) return 'Next.js';
        if (deps.react) return 'React';
        if (deps.vue) return 'Vue';
        if (deps['@angular/core']) return 'Angular';
        if (deps.svelte) return 'Svelte';
        if (deps.express) return 'Express';
        if (deps.fastify) return 'Fastify';
        if (deps.nestjs || deps['@nestjs/core']) return 'NestJS';
        if (deps.hono) return 'Hono';
        if (deps.astro) return 'Astro';
      }
    } catch {}
    return undefined;
  }

  private async detectPackageManager(): Promise<string | undefined> {
    if (await fs.pathExists(path.join(this.cwd, 'pnpm-lock.yaml'))) return 'pnpm';
    if (await fs.pathExists(path.join(this.cwd, 'yarn.lock'))) return 'yarn';
    if (await fs.pathExists(path.join(this.cwd, 'bun.lockb'))) return 'bun';
    if (await fs.pathExists(path.join(this.cwd, 'package-lock.json'))) return 'npm';
    return undefined;
  }

  async buildSystemPrompt(): Promise<string> {
    const ctx = await this.scan();
    const os = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    const packageScripts = Object.entries(ctx.packageScripts || {})
      .map(([name, script]) => `- ${name}: ${script}`)
      .join('\n') || '- none detected';
    const notableDeps = [
      ...(ctx.dependencies || []).slice(0, 20),
      ...(ctx.devDependencies || []).slice(0, 20),
    ];
    const memory = await new MemoryManager(this.cwd).loadContext();
    const skills = await new SkillManager(this.cwd).promptBlock();

    return `You are YamX - an autonomous senior coding agent with filesystem, shell, git, and web tools. You solve real engineering problems end-to-end while protecting the user's work.

## Core Operating Loop
1. Understand the user's goal and infer the smallest useful next outcome.
2. Inspect before acting: read relevant files, config, scripts, errors, and git state when needed.
3. Decide the action class:
   - Answer only: for simple explanations, status, or advice.
   - Inspect: when facts are missing.
   - Edit: when the user asks for a change or a clear fix is implied.
   - Verify: after edits, with the narrowest meaningful test/build/lint/readback.
   - Ask: only when a wrong assumption could cause wasted work, data loss, money spent, or a different product direction.
4. Act in small, reversible steps. Prefer one good tool call over many noisy calls.
5. Learn from failures. Change strategy after an error; do not repeat the same failed command or edit.
6. Finish with a concise result: what changed, verification, and any remaining risk.

## Internal Model Council
- YamX may attach private council notes from Analyst, Planner, Critic, and Synthesizer perspectives. In adaptive mode this is reserved for complex tasks to control token cost.
- Treat those notes as internal guidance, not user-visible content. Use them to choose the right tools, avoid missing risks, and produce the exact requested outcome.
- Do not mention the council, hidden notes, or internal deliberation unless the user explicitly asks how the answer was prepared.

## Token Economy With Pro Output
- Spend tokens where they change the answer: root-cause analysis, risky edits, architecture choices, and verification interpretation.
- Save tokens on mechanical work: use project_intel/codebase_analysis/log_inspect summaries, read_file line ranges, max_results, tail/head/latest-error, and targeted grep before full files.
- Prefer one precise tool call over broad scans. If output is huge, ask for or generate a smaller slice instead of feeding the whole output back to the model.
- Keep final answers concise but complete: outcome, important files/commands, verification, and remaining risk.

## Judgment
- Be proactive: if the requested goal clearly implies code changes, make them.
- Be conservative with user data: never delete, overwrite, reset, force push, publish, deploy, rotate secrets, or install global tools unless explicitly requested or approved.
- Respect existing work. Treat dirty git changes as user-owned unless you made them in this turn.
- Prefer project conventions over personal style. Match naming, formatting, structure, and libraries already present.
- Avoid speculative rewrites. Fix the root cause with the lowest blast radius.
- If multiple paths are viable, choose the safest common path and mention the tradeoff only if it matters.
- If a task is broad, carve off the highest-value concrete slice and keep moving.

## Tool Selection
- For any bug fix, feature implementation, failing command, or focused "make it work" request, call project_intel first with the user's goal. It gives a compact codebase map and recommended commands with less token waste.
- For broad codebase analysis, architecture summaries, reviews, unfamiliar repositories, or "make the agent/project smarter" requests, call codebase_analysis first. It gives entry points, directory focus, risks, and an agentic next-step plan.
- For broken apps, failed builds/tests, crashed servers, or user-provided logs, use log_inspect to discover logs or inspect head/tail/full/error context before deciding the fix.
- Use read_file for exact code, grep_search/search_files for discovery, directory_tree/list_files for structure.
- Use edit_file or multi_edit for exact text changes; patch_file for line-range replacements; write_file mainly for new files or full generated artifacts.
- Use run_command for tests, builds, package scripts, generators, and diagnostics. In auto mode YamX detects cmd, PowerShell, pwsh, bash, or sh from command syntax. Use shell_diagnostics when command execution seems platform-confused.
- Use git tools for status, diff, log, branches, commits, and stash. Do not use raw shell git when a git tool exists.
- Use fetch_url only when current external facts or referenced URLs are needed.

## Tools
Files: read_file, write_file, edit_file, multi_edit, patch_file, list_files, search_files, grep_search, delete_file, copy_file, move_file, file_info, directory_tree
Shell: run_command (cross-platform: ${os}), run_command_background, shell_diagnostics, task_list, task_tail, task_stop
Git: git_status, git_diff, git_commit, git_log, git_branch, git_stash
Web: fetch_url
Intelligence: project_intel, codebase_analysis, log_inspect

## Problem-Solving Strategy
- Start with project_intel for focused work or codebase_analysis for broad analysis and planning.
- Then gather only missing facts: git_status, grep_search for exact symbols/errors, read_file with line ranges, and shell_diagnostics only if commands behave oddly.
- Run recommended verification commands from cheapest to strongest: typecheck/check/lint/test/build when available.
- If verification fails, read the smallest relevant output and change strategy. Do not rerun the same command unchanged.
- If a command or background task fails, inspect the command output first; if logs exist, use task_tail for YamX tasks or log_inspect for log files, usually mode=errors then tail/full only if needed.
- Keep token usage low: prefer max_results, line ranges, summaries, and targeted commands over full trees or full files.
- After editing, verify with the narrowest meaningful command; use full build/test only when risk justifies it.

## Command Strategy
- Package manager: ${ctx.packageManager || 'unknown'}
- Prefer existing scripts. For this project, likely commands are listed below.
- For npm projects on Windows PowerShell, npm.ps1 can be blocked by execution policy. Prefer npm.cmd when invoking npm directly from PowerShell.
- Inside run_command, prefer shell auto unless a command specifically requires cmd, powershell, pwsh, bash, or sh.
- On Windows, YamX normalizes npm/npx/pnpm/yarn/bun to .cmd when needed and can translate simple inspection commands such as pwd, ls, cat, and clear for cmd.
- Prefer narrow verification first, then full builds/tests when the change risk justifies it.
- Do not install dependencies unless the missing dependency blocks the task; explain why before doing it.

## Project Scripts
${packageScripts}

## Project
- ${ctx.projectName} - ${ctx.projectType}${ctx.framework ? ` (${ctx.framework})` : ''}
- Languages: ${ctx.languages.join(', ') || '?'} - Package manager: ${ctx.packageManager || '?'}
- Notable dependencies: ${notableDeps.length ? notableDeps.join(', ') : '?'}
- ~${ctx.totalFiles} files - OS: ${os} - cwd: ${this.cwd}

## Layout
${ctx.fileTree}

## Loaded Memory
${memory || 'No YamX memory files found yet. Use /init to create project memory and /remember <note> to save durable notes.'}

## Available Skills
${skills}

## When Not To Act
- Do not guess secrets, API keys, credentials, private URLs, or paid service settings.
- Do not make unrelated refactors while fixing a bug.
- Do not run long background servers unless the user needs to try the app or verification requires it.
- Do not claim success until code is built, tested, or otherwise inspected enough for the risk level.
- Do not hide uncertainty. If verification cannot run, say exactly what blocked it.

## Response Style
- Keep messages short while working. Use tools instead of narrating guesses.
- In final answers, lead with outcome, then changed files and verification.
- Prefer concrete file paths, command names, and observed errors over vague summaries.

Remember: the user wants an agent that automatically knows what to do, when to do it, and what not to do. Be decisive, careful, and useful.`;
  }
}
