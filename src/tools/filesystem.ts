/**
 * Yam Agent - File System Tools
 * Read, write, edit, search, and manage files with surgical precision.
 */

import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';
import { Tool } from './registry.js';
import { ensureInsideProject, formatBytes } from './utils.js';

const DEFAULT_MAX_READ_CHARS = 120_000;
const DEFAULT_MAX_LIST_RESULTS = 300;
const DEFAULT_MAX_SEARCH_RESULTS = 50;
const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.next/**',
  '.nuxt/**',
  '__pycache__/**',
  '*.pyc',
  '*.lock',
  '*.map',
  '*.min.js',
  '*.min.css',
];

export const readFile: Tool = {
  definition: {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the full content with line numbers. Use this to understand existing code before editing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file from project root' },
        start_line: { type: 'number', description: 'Optional start line (1-indexed)' },
        end_line: { type: 'number', description: 'Optional end line (1-indexed, inclusive)' },
        max_chars: { type: 'number', description: 'Maximum characters returned (default 120000, max 500000)' },
        tail: { type: 'boolean', description: 'Read from the end of the file. Useful for logs and large generated files.' },
      },
      required: ['path'],
    },
  },
  async execute(args) {
    const target = ensureInsideProject(args.path);
    if (!target.ok) return target.error;
    const filePath = target.path;
    if (!await fs.pathExists(filePath)) return `Error: File not found: ${args.path}`;
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return `Error: Not a file: ${args.path}`;
    if (await looksBinary(filePath)) return `Error: Refusing to read likely binary file: ${args.path} (${formatBytes(stat.size)})`;

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const maxChars = boundedNumber(args.max_chars, DEFAULT_MAX_READ_CHARS, 1000, 500_000);
    const requestedEnd = args.end_line || lines.length;
    const requestedStart = args.tail
      ? Math.max(1, requestedEnd - Math.max(1, Number(args.start_line || 200)) + 1)
      : Number(args.start_line || 1);
    const start = Math.max(0, requestedStart - 1);
    const end = Math.min(lines.length, requestedEnd);
    const slice = lines.slice(start, end);

    const numbered = slice.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
    const truncated = truncate(numbered, maxChars);
    const meta = [
      `File: ${args.path}`,
      `Size: ${formatBytes(stat.size)} · Lines: ${lines.length} · Showing: ${start + 1}-${Math.max(start, end)}`,
      truncated.truncated ? `Truncated: returned ${formatBytes(truncated.text.length)} of selected range` : '',
    ].filter(Boolean).join('\n');
    return `${meta}\n${truncated.text}`;
  },
};

export const writeFile: Tool = {
  definition: {
    name: 'write_file',
    description: 'Write content to a file. Creates parent directories automatically. Use for new files or full rewrites.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        content: { type: 'string', description: 'The complete content to write' },
      },
      required: ['path', 'content'],
    },
  },
  needsApproval: true,
  async execute(args) {
    const target = ensureInsideProject(args.path);
    if (!target.ok) return target.error;
    const filePath = target.path;

    await fs.ensureDir(path.dirname(filePath));
    const existed = await fs.pathExists(filePath);
    await fs.writeFile(filePath, args.content, 'utf-8');

    const lineCount = args.content.split('\n').length;
    return `${existed ? 'Updated' : 'Created'} file: ${args.path} (${lineCount} lines)`;
  },
};

export const editFile: Tool = {
  definition: {
    name: 'edit_file',
    description: `Edit a file by replacing specific text. This is a surgical edit tool — provide the EXACT old text to find and the new text to replace it with. 
Use this instead of write_file when you only need to change part of a file. The old_text must match EXACTLY (including whitespace/indentation).`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        old_text: { type: 'string', description: 'The exact text to find and replace (must match exactly)' },
        new_text: { type: 'string', description: 'The replacement text' },
        occurrence: { type: 'number', description: 'Which occurrence to replace when old_text appears multiple times (1-indexed, default 1)' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences instead of one' },
        dry_run: { type: 'boolean', description: 'Preview whether the edit would apply without writing the file' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  needsApproval: true,
  async execute(args) {
    const target = ensureInsideProject(args.path);
    if (!target.ok) return target.error;
    const filePath = target.path;
    if (!await fs.pathExists(filePath)) return `Error: File not found: ${args.path}`;

    const content = await fs.readFile(filePath, 'utf-8');
    const count = content.split(args.old_text).length - 1;

    if (count === 0) {
      return `Error: Could not find the specified text in ${args.path}. Make sure old_text matches EXACTLY, including whitespace and indentation. Use read_file to check the current content.`;
    }
    const occurrence = boundedNumber(args.occurrence, 1, 1, Math.max(1, count));
    const replaceAll = Boolean(args.replace_all);
    const newContent = replaceAll
      ? content.split(args.old_text).join(args.new_text)
      : replaceOccurrence(content, args.old_text, args.new_text, occurrence);

    const changedCount = replaceAll ? count : 1;
    if (args.dry_run) {
      return `Dry run: ${args.path} has ${count} match${count === 1 ? '' : 'es'}; would replace ${changedCount}.`;
    }
    await fs.writeFile(filePath, newContent, 'utf-8');

    return `Edited ${args.path}: replaced ${changedCount} occurrence${changedCount === 1 ? '' : 's'} (${args.old_text.split('\n').length} lines -> ${args.new_text.split('\n').length} lines).`;
  },
};

export const listFiles: Tool = {
  definition: {
    name: 'list_files',
    description: 'List files and directories in a path. Respects .gitignore patterns. Shows file types and sizes.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (default: ".")' },
        recursive: { type: 'boolean', description: 'If true, list recursively (default: false)' },
        pattern: { type: 'string', description: 'Glob pattern to filter (e.g., "**/*.ts")' },
        max_results: { type: 'number', description: 'Maximum entries to return (default 300, max 2000)' },
        show_hidden: { type: 'boolean', description: 'Include hidden files and directories' },
      },
    },
  },
  async execute(args) {
    const target = ensureInsideProject(args.path || '.');
    if (!target.ok) return target.error;
    const dirPath = target.path;
    if (!await fs.pathExists(dirPath)) return `Error: Directory not found: ${args.path || '.'}`;
    const maxResults = boundedNumber(args.max_results, DEFAULT_MAX_LIST_RESULTS, 1, 2000);

    if (args.pattern || args.recursive) {
      const pattern = args.pattern || '**/*';
      const entries = await fg(pattern, {
        cwd: dirPath,
        dot: Boolean(args.show_hidden),
        ignore: IGNORE_PATTERNS,
        onlyFiles: false,
        stats: true,
      });
      const lines = entries
        .sort((a: any, b: any) => String(a.path).localeCompare(String(b.path)))
        .slice(0, maxResults)
        .map((e: any) => {
        const isDir = e.stats?.isDirectory();
        const size = isDir ? '' : ` (${formatBytes(e.stats?.size || 0)})`;
        return `${isDir ? '[dir]' : '[file]'} ${e.path}${size}`;
      });
      const suffix = entries.length > maxResults ? `\n... ${entries.length - maxResults} more items` : '';
      return `${entries.length} items in ${args.path || '.'}:\n${lines.join('\n')}${suffix}`;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const lines = entries
      .filter(e => (args.show_hidden || !e.name.startsWith('.')) && e.name !== 'node_modules')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, maxResults)
      .map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`);
    return `${lines.length} items in ${args.path || '.'}:\n${lines.join('\n')}`;
  },
};

export const searchFiles: Tool = {
  definition: {
    name: 'search_files',
    description: 'Search for a text pattern across files in the project (like grep). Returns matching lines with file paths and line numbers. Extremely useful for understanding codebases.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The text or regex pattern to search for' },
        path: { type: 'string', description: 'Directory to search in (default: ".")' },
        include: { type: 'string', description: 'Glob pattern for files to include (e.g., "*.ts")' },
        max_results: { type: 'number', description: 'Maximum number of results (default: 50)' },
        case_sensitive: { type: 'boolean', description: 'Case-sensitive search (default false)' },
        context_lines: { type: 'number', description: 'Optional context lines around each match' },
      },
      required: ['pattern'],
    },
  },
  async execute(args) {
    const target = ensureInsideProject(args.path || '.');
    if (!target.ok) return target.error;
    const searchDir = target.path;
    const includePattern = args.include || '**/*';
    const maxResults = boundedNumber(args.max_results, DEFAULT_MAX_SEARCH_RESULTS, 1, 500);
    const contextLines = boundedNumber(args.context_lines, 0, 0, 10);

    const files = await fg(includePattern, {
      cwd: searchDir,
      ignore: IGNORE_PATTERNS,
      onlyFiles: true,
    });

    const results: string[] = [];
    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.case_sensitive ? 'g' : 'gi');
    } catch (error: any) {
      return `Error: Invalid search regex: ${error.message}`;
    }

    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const content = await fs.readFile(path.join(searchDir, file), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            if (contextLines > 0) {
              const start = Math.max(0, i - contextLines);
              const end = Math.min(lines.length - 1, i + contextLines);
              results.push([
                `-- ${file}:${i + 1} --`,
                ...lines.slice(start, end + 1).map((line, offset) => {
                  const lineNo = start + offset + 1;
                  return `${lineNo === i + 1 ? '>' : ' '} ${lineNo}: ${line}`;
                }),
              ].join('\n'));
            } else {
              results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
            }
            if (results.length >= maxResults) break;
          }
          regex.lastIndex = 0;
        }
      } catch {
        // skip binary files
      }
    }

    if (results.length === 0) return `No matches found for "${args.pattern}"`;
    return `Found ${results.length} matches:\n${results.join('\n')}`;
  },
};

export const deleteFile: Tool = {
  definition: {
    name: 'delete_file',
    description: 'Delete a file or empty directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file or directory to delete' },
      },
      required: ['path'],
    },
  },
  needsApproval: true,
  async execute(args) {
    const target = ensureInsideProject(args.path);
    if (!target.ok) return target.error;
    const filePath = target.path;
    if (!await fs.pathExists(filePath)) return `Error: Not found: ${args.path}`;

    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await fs.rmdir(filePath);
      return `Deleted directory: ${args.path}`;
    } else {
      await fs.unlink(filePath);
      return `Deleted file: ${args.path}`;
    }
  },
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`, truncated: true };
}

function replaceOccurrence(content: string, oldText: string, newText: string, occurrence: number): string {
  let index = -1;
  let from = 0;
  for (let i = 0; i < occurrence; i++) {
    index = content.indexOf(oldText, from);
    if (index === -1) return content;
    from = index + oldText.length;
  }
  return `${content.slice(0, index)}${newText}${content.slice(index + oldText.length)}`;
}

async function looksBinary(filePath: string): Promise<boolean> {
  const buf = await fs.readFile(filePath, { encoding: null });
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  return sample.includes(0);
}
