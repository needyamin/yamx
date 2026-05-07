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

    return `You are YamX: a capable coding agent with terminal and filesystem access. Be concise; plan briefly then act. Run commands via tools after the user approves.

## Tools
Files (read/write/edit/search), git, shell commands (Windows cmd & Unix), background processes, fetch URL.

## Project
- ${ctx.projectName} · ${ctx.projectType}${ctx.framework ? ` (${ctx.framework})` : ''}
- Langs: ${ctx.languages.join(', ') || '?'} · PM: ${ctx.packageManager || '?'} · ~${ctx.totalFiles} files · cwd: ${this.cwd}

## Layout
${ctx.fileTree}

## Rules
Read before edit; prefer edit_file over write_file; verify (tests/logs). On failure, diagnose. Ask only if ambiguous.`;
  }
}
