import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';

const MAX_MEMORY_CHARS = 60_000;

export class MemoryManager {
  private cwd: string;
  private userRoot: string;

  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
    this.userRoot = path.join(os.homedir(), '.yamx');
  }

  async loadContext(): Promise<string> {
    const entries: Array<{ label: string; file: string }> = [
      { label: 'User memory', file: path.join(this.userRoot, 'YAMX.md') },
      { label: 'User auto memory', file: path.join(this.userRoot, 'memory', 'global.md') },
      { label: 'Project memory', file: path.join(this.cwd, 'YAMX.md') },
      { label: 'Project memory', file: path.join(this.cwd, '.yamx', 'YAMX.md') },
      { label: 'Project auto memory', file: path.join(this.cwd, '.yamx', 'memory', 'project.md') },
      { label: 'Today memory', file: path.join(this.cwd, '.yamx', 'memory', `${this.today()}.md`) },
    ];

    const ruleFiles = await fg('*.md', {
      cwd: path.join(this.cwd, '.yamx', 'rules'),
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
    });
    for (const file of ruleFiles.sort()) {
      entries.push({ label: `Project rule: ${path.basename(file)}`, file });
    }

    const blocks: string[] = [];
    let total = 0;
    for (const entry of entries) {
      if (!await fs.pathExists(entry.file)) continue;
      const content = (await fs.readFile(entry.file, 'utf-8')).trim();
      if (!content) continue;

      const remaining = MAX_MEMORY_CHARS - total;
      if (remaining <= 0) break;
      const clipped = content.length > remaining ? `${content.slice(0, remaining)}\n[truncated]` : content;
      blocks.push(`### ${entry.label}\nPath: ${entry.file}\n${clipped}`);
      total += clipped.length;
    }

    return blocks.join('\n\n');
  }

  async initProjectMemory(): Promise<string[]> {
    const yamxPath = path.join(this.cwd, 'YAMX.md');
    const localPath = path.join(this.cwd, '.yamx', 'YAMX.md');
    const rulesDir = path.join(this.cwd, '.yamx', 'rules');
    const memoryDir = path.join(this.cwd, '.yamx', 'memory');

    await fs.ensureDir(rulesDir);
    await fs.ensureDir(memoryDir);

    const created: string[] = [];
    if (!await fs.pathExists(yamxPath)) {
      await fs.writeFile(
        yamxPath,
        [
          '# YamX Project Memory',
          '',
          'Use this file for durable project instructions, architecture notes, and common commands.',
          '',
          '## Commands',
          '- Build: npm.cmd run build',
          '',
          '## Conventions',
          '- Keep changes scoped.',
          '- Read existing code before editing.',
          '',
        ].join('\n'),
        'utf-8'
      );
      created.push(yamxPath);
    }

    if (!await fs.pathExists(localPath)) {
      await fs.writeFile(
        localPath,
        [
          '# Local YamX Notes',
          '',
          'Use this file for machine-specific notes that should stay local.',
          '',
        ].join('\n'),
        'utf-8'
      );
      created.push(localPath);
    }

    const projectMemory = path.join(memoryDir, 'project.md');
    if (!await fs.pathExists(projectMemory)) {
      await fs.writeFile(projectMemory, '# Project Auto Memory\n\n', 'utf-8');
      created.push(projectMemory);
    }

    return created;
  }

  async remember(text: string, scope: 'project' | 'user' = 'project'): Promise<string> {
    const clean = text.trim();
    if (!clean) return 'Error: memory text is required.';

    const file = scope === 'user'
      ? path.join(this.userRoot, 'memory', 'global.md')
      : path.join(this.cwd, '.yamx', 'memory', 'project.md');

    await fs.ensureDir(path.dirname(file));
    if (!await fs.pathExists(file)) {
      await fs.writeFile(file, `# ${scope === 'user' ? 'User' : 'Project'} Auto Memory\n\n`, 'utf-8');
    }

    const line = `- ${new Date().toISOString()}: ${clean.replace(/\s+/g, ' ')}\n`;
    await fs.appendFile(file, line, 'utf-8');
    return file;
  }

  async describeMemoryFiles(): Promise<string> {
    const files = [
      path.join(this.userRoot, 'YAMX.md'),
      path.join(this.userRoot, 'memory', 'global.md'),
      path.join(this.cwd, 'YAMX.md'),
      path.join(this.cwd, '.yamx', 'YAMX.md'),
      path.join(this.cwd, '.yamx', 'memory', 'project.md'),
      path.join(this.cwd, '.yamx', 'memory', `${this.today()}.md`),
    ];

    const lines: string[] = [];
    for (const file of files) {
      const exists = await fs.pathExists(file);
      lines.push(`${exists ? 'yes' : 'no '}  ${file}`);
    }
    return lines.join('\n');
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
