/**
 * YamX - Context Engine
 * Scans the project, builds a map, and provides relevant context to the LLM.
 */

import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';

export interface ProjectContext {
  projectName: string;
  projectType: string;
  fileTree: string;
  totalFiles: number;
  languages: string[];
  framework?: string;
  packageManager?: string;
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

  /** Scan the project and build context */
  async scan(): Promise<ProjectContext> {
    const projectName = path.basename(this.cwd);

    // Get all files
    const files = await fg('**/*', {
      cwd: this.cwd,
      ignore: [
        'node_modules/**', '.git/**', 'dist/**', 'build/**',
        '__pycache__/**', '*.pyc', '.venv/**', 'venv/**',
        '.next/**', '.nuxt/**', 'coverage/**', '*.lock',
        '.DS_Store', 'Thumbs.db',
      ],
      onlyFiles: true,
    });

    // Detect languages
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

    // Detect project type
    const projectType = await this.detectProjectType();
    const framework = await this.detectFramework();
    const packageManager = await this.detectPackageManager();

    // Build file tree (limited depth)
    const fileTree = await this.buildFileTree(3);

    return {
      projectName,
      projectType,
      fileTree,
      totalFiles: files.length,
      languages,
      framework,
      packageManager,
    };
  }

  /** Build a visual file tree */
  private async buildFileTree(maxDepth: number, dir = '', depth = 0): Promise<string> {
    if (depth >= maxDepth) return '';

    const fullPath = path.join(this.cwd, dir);
    if (!await fs.pathExists(fullPath)) return '';

    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const filtered = entries.filter(e =>
      !e.name.startsWith('.') &&
      !['node_modules', 'dist', 'build', '__pycache__', '.git', 'coverage', '.next'].includes(e.name)
    );

    const lines: string[] = [];
    for (const entry of filtered) {
      const prefix = '  '.repeat(depth);
      const icon = entry.isDirectory() ? '📁' : '📄';
      lines.push(`${prefix}${icon} ${entry.name}`);

      if (entry.isDirectory()) {
        const subTree = await this.buildFileTree(maxDepth, path.join(dir, entry.name), depth + 1);
        if (subTree) lines.push(subTree);
      }
    }

    return lines.join('\n');
  }

  /** Detect project type */
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

  /** Detect framework */
  private async detectFramework(): Promise<string | undefined> {
    try {
      const pkgPath = path.join(this.cwd, 'package.json');
      if (await fs.pathExists(pkgPath)) {
        const pkg = await fs.readJSON(pkgPath);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['next']) return 'Next.js';
        if (deps['react']) return 'React';
        if (deps['vue']) return 'Vue';
        if (deps['@angular/core']) return 'Angular';
        if (deps['svelte']) return 'Svelte';
        if (deps['express']) return 'Express';
        if (deps['fastify']) return 'Fastify';
        if (deps['nestjs'] || deps['@nestjs/core']) return 'NestJS';
        if (deps['hono']) return 'Hono';
        if (deps['astro']) return 'Astro';
      }
    } catch {}
    return undefined;
  }

  /** Detect package manager */
  private async detectPackageManager(): Promise<string | undefined> {
    if (await fs.pathExists(path.join(this.cwd, 'pnpm-lock.yaml'))) return 'pnpm';
    if (await fs.pathExists(path.join(this.cwd, 'yarn.lock'))) return 'yarn';
    if (await fs.pathExists(path.join(this.cwd, 'bun.lockb'))) return 'bun';
    if (await fs.pathExists(path.join(this.cwd, 'package-lock.json'))) return 'npm';
    return undefined;
  }

  /** Generate the system prompt with project context */
  async buildSystemPrompt(): Promise<string> {
    const ctx = await this.scan();
    const os = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';

    return `You are YamX — a senior-level coding agent with full filesystem and shell access. You solve real engineering problems end-to-end.

## Behavior
- Plan briefly, then act. Don't over-explain — show results.
- Read files before editing. Use edit_file (or multi_edit/patch_file) instead of write_file when possible.
- Run commands via tools. The user will see and approve them.
- When you encounter errors, diagnose root causes — don't guess.
- Ask only when genuinely ambiguous. Otherwise make a reasonable default choice and proceed.
- Use markdown in your responses for readability (code blocks, headers, lists).

## Tools (22)
**Files**: read_file, write_file, edit_file, multi_edit, patch_file, list_files, search_files, grep_search, delete_file, copy_file, move_file, file_info, directory_tree
**Shell**: run_command (cross-platform: ${os}), run_command_background
**Git**: git_status, git_diff, git_commit, git_log, git_branch, git_stash
**Web**: fetch_url

## Project
- **${ctx.projectName}** · ${ctx.projectType}${ctx.framework ? ` (${ctx.framework})` : ''}
- Languages: ${ctx.languages.join(', ') || '?'} · Package manager: ${ctx.packageManager || '?'}
- ~${ctx.totalFiles} files · OS: ${os} · cwd: ${this.cwd}

## Layout
${ctx.fileTree}

## Rules
1. Read before edit — always understand current code first
2. Prefer surgical edits (edit_file, multi_edit) over full file writes
3. After changes, verify via tests, build, or reading the result
4. On failure, diagnose — don't repeat the same failing action
5. Respect project conventions (formatting, naming, structure)`;
  }
}
