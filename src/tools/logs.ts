import fs from 'fs-extra';
import path from 'node:path';
import fg from 'fast-glob';
import { Tool } from './registry.js';
import { ensureInsideProject, formatBytes } from './utils.js';

const DEFAULT_LINES = 120;
const DEFAULT_MAX_CHARS = 80_000;
const ERROR_PATTERN = /(error|exception|fatal|failed|failure|panic|traceback|stack trace|uncaught|unhandled|segfault|timeout|eaddrinuse|econnrefused|etimedout|enoent|eacces|eperm|syntaxerror|typeerror|referenceerror|warning|warn|cannot find module|module not found|permission denied|address already in use|port .* in use|migration.*failed|sqlstate|constraint violation)/i;
const SEVERITY_PATTERNS: Array<[string, RegExp]> = [
  ['fatal', /\b(fatal|panic|segfault|crash)\b/i],
  ['error', /\b(error|exception|failed|failure|uncaught|unhandled|traceback|syntaxerror|typeerror|referenceerror)\b/i],
  ['warning', /\b(warn|warning|deprecated)\b/i],
  ['timeout', /\b(timeout|timed out|eaddrinuse|econnrefused|etimedout)\b/i],
];

export const logInspect: Tool = {
  definition: {
    name: 'log_inspect',
    description:
      'Inspect application, test, build, or server logs with head/tail/full/error-context modes. Use when a command fails, a server is broken, or the user asks to analyze logs before fixing code.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to a log file. If omitted, returns likely log files in the project.' },
        mode: { type: 'string', enum: ['auto', 'tail', 'head', 'full', 'errors', 'summary', 'latest-error'], description: 'How to inspect the log (default: auto)' },
        lines: { type: 'number', description: 'Number of lines for head/tail/errors context (default 120, max 1000)' },
        pattern: { type: 'string', description: 'Optional regex to search for instead of the built-in error pattern' },
        context_lines: { type: 'number', description: 'Lines before and after each error/pattern match (default 3, max 20)' },
        max_chars: { type: 'number', description: 'Maximum output characters (default 80000, max 300000)' },
      },
    },
  },
  async execute(args: {
    path?: string;
    mode?: 'auto' | 'tail' | 'head' | 'full' | 'errors' | 'summary' | 'latest-error';
    lines?: number;
    pattern?: string;
    context_lines?: number;
    max_chars?: number;
  }) {
    if (!args.path?.trim()) {
      return discoverLogs();
    }

    const target = ensureInsideProject(args.path);
    if (!target.ok) return target.error;
    if (!await fs.pathExists(target.path)) return `Error: Log file not found: ${args.path}`;
    const stat = await fs.stat(target.path);
    if (!stat.isFile()) return `Error: Not a file: ${args.path}`;

    const maxChars = bounded(args.max_chars, DEFAULT_MAX_CHARS, 1000, 300_000);
    const lineCount = bounded(args.lines, DEFAULT_LINES, 1, 1000);
    const contextLines = bounded(args.context_lines, 3, 0, 20);
    const mode = args.mode || 'auto';
    const content = await fs.readFile(target.path, 'utf-8');
    const lines = content.split(/\r?\n/);

    let body: string;
    if (mode === 'auto') {
      body = [
        summarizeLog(lines, args.pattern),
        '',
        formatLatestError(lines, args.pattern, Math.max(contextLines, 6)),
        '',
        'Recent tail:',
        formatLines(lines.slice(Math.max(0, lines.length - Math.min(lineCount, 80))), Math.max(1, lines.length - Math.min(lineCount, 80) + 1)),
      ].join('\n');
    } else if (mode === 'head') {
      body = formatLines(lines.slice(0, lineCount), 1);
    } else if (mode === 'full') {
      body = formatLines(lines, 1);
    } else if (mode === 'summary') {
      body = summarizeLog(lines, args.pattern);
    } else if (mode === 'latest-error') {
      body = formatLatestError(lines, args.pattern, contextLines);
    } else if (mode === 'errors') {
      body = formatErrorContext(lines, args.pattern, contextLines, lineCount);
    } else {
      const start = Math.max(0, lines.length - lineCount);
      body = formatLines(lines.slice(start), start + 1);
    }

    return truncate([
      `Log: ${args.path}`,
      `Mode: ${mode} · Size: ${formatBytes(stat.size)} · Lines: ${lines.length}`,
      `Signals: ${formatSignals(lines)}`,
      '',
      body || '(no log content)',
    ].join('\n'), maxChars);
  },
};

async function discoverLogs(): Promise<string> {
  const files = await fg([
    '**/*.log',
    '**/logs/**/*',
    '**/log/**/*',
    '**/storage/logs/**/*',
    '**/var/log/**/*',
    '**/.next/**/*.log',
    '**/npm-debug.log*',
    '**/yarn-error.log*',
    '**/pnpm-debug.log*',
  ], {
    cwd: process.cwd(),
    onlyFiles: true,
    suppressErrors: true,
    ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'coverage/**'],
    stats: true,
  });

  const entries = files
    .map((file: any) => ({
      path: file.path || String(file),
      size: file.stats?.size || 0,
      mtime: file.stats?.mtimeMs || 0,
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 40);

  if (entries.length === 0) {
    return 'No obvious log files found. Run the failing command with run_command, inspect task_tail for background tasks, or provide a log path.';
  }

  return [
    'Likely log files (newest first):',
    ...entries.map((entry) => `- ${entry.path} (${formatBytes(entry.size)})`),
    '',
    'Call log_inspect again with a path and mode: auto, tail, head, full, errors, latest-error, or summary.',
  ].join('\n');
}

function formatErrorContext(lines: string[], pattern: string | undefined, contextLines: number, maxMatches: number): string {
  let regex = ERROR_PATTERN;
  if (pattern?.trim()) {
    try {
      regex = new RegExp(pattern, 'i');
    } catch {
      return `Error: Invalid regex pattern: ${pattern}`;
    }
  }

  const blocks: string[] = [];
  for (let i = 0; i < lines.length && blocks.length < maxMatches; i++) {
    if (!regex.test(lines[i])) continue;
    const start = Math.max(0, i - contextLines);
    const end = Math.min(lines.length - 1, i + contextLines);
    const block = [`-- match at line ${i + 1} --`];
    for (let line = start; line <= end; line++) {
      const marker = line === i ? '>' : ' ';
      block.push(`${marker} ${line + 1}: ${lines[line]}`);
    }
    blocks.push(block.join('\n'));
  }

  return blocks.length > 0 ? blocks.join('\n\n') : 'No error-like lines found.';
}

function formatLatestError(lines: string[], pattern: string | undefined, contextLines: number): string {
  let regex = ERROR_PATTERN;
  if (pattern?.trim()) {
    try {
      regex = new RegExp(pattern, 'i');
    } catch {
      return `Error: Invalid regex pattern: ${pattern}`;
    }
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    if (!regex.test(lines[i])) continue;
    const start = Math.max(0, i - contextLines);
    const end = Math.min(lines.length - 1, i + contextLines);
    return [
      `Latest match at line ${i + 1}:`,
      ...lines.slice(start, end + 1).map((line, offset) => {
        const lineNo = start + offset + 1;
        return `${lineNo === i + 1 ? '>' : ' '} ${lineNo}: ${line}`;
      }),
    ].join('\n');
  }
  return 'No error-like lines found.';
}

function summarizeLog(lines: string[], pattern?: string): string {
  const counts = severityCounts(lines);
  const firstError = firstMatchLine(lines, pattern);
  const latestError = latestMatchLine(lines, pattern);
  const noisySources = topSources(lines);

  return [
    'Summary:',
    `- Total lines: ${lines.length}`,
    `- Fatal: ${counts.fatal} · Errors: ${counts.error} · Warnings: ${counts.warning} · Timeouts/network: ${counts.timeout}`,
    firstError ? `- First error-like line: ${firstError}` : '- First error-like line: none found',
    latestError ? `- Latest error-like line: ${latestError}` : '- Latest error-like line: none found',
    noisySources.length ? `- Frequent source prefixes: ${noisySources.join(', ')}` : '- Frequent source prefixes: none detected',
    '',
    'Recommended next steps:',
    latestError
      ? '- Inspect mode=latest-error with context_lines=8, then search code for the referenced file/function/error text.'
      : '- Inspect tail/head or rerun the failing command; no obvious error signal was found in this log.',
  ].join('\n');
}

function formatSignals(lines: string[]): string {
  const counts = severityCounts(lines);
  return `fatal=${counts.fatal}, errors=${counts.error}, warnings=${counts.warning}, timeouts=${counts.timeout}`;
}

function severityCounts(lines: string[]): Record<string, number> {
  const out: Record<string, number> = { fatal: 0, error: 0, warning: 0, timeout: 0 };
  for (const line of lines) {
    for (const [name, regex] of SEVERITY_PATTERNS) {
      if (regex.test(line)) out[name]++;
    }
  }
  return out;
}

function firstMatchLine(lines: string[], pattern?: string): string | null {
  const regex = compilePattern(pattern);
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) return `${i + 1}: ${lines[i].trim()}`;
  }
  return null;
}

function latestMatchLine(lines: string[], pattern?: string): string | null {
  const regex = compilePattern(pattern);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (regex.test(lines[i])) return `${i + 1}: ${lines[i].trim()}`;
  }
  return null;
}

function compilePattern(pattern?: string): RegExp {
  if (!pattern?.trim()) return ERROR_PATTERN;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return ERROR_PATTERN;
  }
}

function topSources(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const match = line.match(/^\s*(\[[^\]]+\]|[A-Za-z0-9_.:/\\-]+\.(ts|tsx|js|jsx|py|php|go|rs|java|cs):\d+|[A-Z][A-Z0-9_-]+:)/);
    if (!match) continue;
    const key = match[1];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => `${key} (${count})`);
}

function formatLines(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${startLine + index}: ${line}`).join('\n');
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}
