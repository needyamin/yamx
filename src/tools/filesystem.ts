/**
 * Yam Agent - File System Tools
 * Read, write, edit, search, and manage files with surgical precision.
 */

import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';
import { Tool } from './registry.js';
import { ensureInsideProject, formatBytes } from './utils.js';
import {
  atomicWriteText,
  closestTextHints,
  contentFingerprint,
  countOccurrences,
  formatTextEditSummary,
  inferFileLanguageLabel,
  lineColumnForIndex,
  looksBinary,
  normalizeNewTextForFile,
  previewTextChange,
  readTextFileSnapshot,
  replaceOccurrence,
  summarizeTextChange,
} from './file-editing.js';

const DEFAULT_MAX_READ_CHARS = 120_000;
const DEFAULT_BATCH_READ_MAX_FILES = 30;
const DEFAULT_BATCH_READ_TOTAL_CHARS = 200_000;
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
    description: `Read file contents with line numbers. Emits yamx_file_intel (language guess, EOL, content fingerprint) so follow-up edits can use edit_file/multi_edit confidently or detect staleness via write_file if_match_fingerprint.
Use center_line + context_lines to pull a tight window around one line. For several paths in one call, prefer read_files.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file from project root' },
        start_line: { type: 'number', description: 'Optional start line (1-indexed). Ignored when center_line is set.' },
        end_line: { type: 'number', description: 'Optional end line (1-indexed, inclusive). Ignored when center_line is set.' },
        center_line: { type: 'number', description: 'Optional 1-indexed line to center the view on; uses context_lines above/below. Overrides start_line/end_line when set.' },
        context_lines: { type: 'number', description: 'Half-window (approximately) when center_line is set; lines to show above and below center (default 28, max 500).' },
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
    const center = Number(args.center_line);
    const useCenter = Number.isFinite(center) && center >= 1;
    const halfWindow = boundedNumber(args.context_lines, 28, 1, 500);

    let requestedStart: number;
    let requestedEnd: number;
    if (useCenter) {
      const c = Math.min(Math.max(Math.trunc(center), 1), lines.length);
      requestedStart = Math.max(1, c - halfWindow);
      requestedEnd = Math.min(lines.length, c + halfWindow);
    } else {
      requestedEnd = args.end_line || lines.length;
      requestedStart = args.tail
        ? Math.max(1, requestedEnd - Math.max(1, Number(args.start_line || 200)) + 1)
        : Number(args.start_line || 1);
    }

    const start = Math.max(0, requestedStart - 1);
    const end = Math.min(lines.length, requestedEnd);
    const slice = lines.slice(start, end);

    const numbered = slice.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
    const truncated = truncate(numbered, maxChars);
    const eolHint = content.includes('\r\n') ? 'CRLF' : 'LF';
    const lang = inferFileLanguageLabel(args.path);
    const fp = contentFingerprint(content);
    const meta = [
      `File: ${args.path}`,
      `Size: ${formatBytes(stat.size)} · Lines: ${lines.length} · Showing: ${start + 1}-${Math.max(start, end)}`,
      `yamx_file_intel: language=${lang}; eol=${eolHint}; fingerprint=${fp}`,
      truncated.truncated ? `Truncated: returned ${formatBytes(truncated.text.length)} of selected range` : '',
    ].filter(Boolean).join('\n');
    return `${meta}\n${truncated.text}`;
  },
};

export const readFiles: Tool = {
  definition: {
    name: 'read_files',
    description: `Batch-read multiple text files in one tool call (dedupes paths, shares a total character budget). Each slice includes yamx_file_intel with fingerprint — pair with write_file(if_match_fingerprint) or multi_edit after read_file for safer concurrent edits.`,
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Relative paths to read fully (subject to per-file and total caps). Ignored if `files` is non-empty.',
        },
        files: {
          type: 'array',
          description: 'Advanced entries: { path, start_line?, end_line?, center_line?, context_lines?, tail?, max_chars? }',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              start_line: { type: 'number' },
              end_line: { type: 'number' },
              center_line: { type: 'number' },
              context_lines: { type: 'number' },
              tail: { type: 'boolean' },
              max_chars: { type: 'number' },
            },
            required: ['path'],
          },
        },
        total_max_chars: { type: 'number', description: 'Max characters across ALL files in this call (default 200000, max 600000)' },
        max_files: { type: 'number', description: 'Maximum distinct paths (default 30, max 60)' },
      },
    },
  },
  async execute(args) {
    const maxFiles = boundedNumber(args.max_files, DEFAULT_BATCH_READ_MAX_FILES, 1, 60);
    let totalBudget = boundedNumber(args.total_max_chars, DEFAULT_BATCH_READ_TOTAL_CHARS, 5000, 600_000);

    type Entry = {
      path: string;
      start_line?: number;
      end_line?: number;
      center_line?: number;
      context_lines?: number;
      tail?: boolean;
      max_chars?: number;
    };

    const rawEntries: Entry[] = [];
    if (Array.isArray(args.files) && args.files.length > 0) {
      for (const f of args.files) {
        if (f && typeof f.path === 'string') rawEntries.push(f as Entry);
      }
    } else if (Array.isArray(args.paths)) {
      for (const p of args.paths) {
        if (typeof p === 'string' && p.trim()) rawEntries.push({ path: p.trim() });
      }
    }

    if (rawEntries.length === 0) {
      return 'Error: Provide non-empty `paths` or `files` for read_files.';
    }

    const seen = new Set<string>();
    const entries: Entry[] = [];
    for (const e of rawEntries) {
      const target = ensureInsideProject(e.path);
      if (!target.ok) continue;
      const key = path.normalize(target.path);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ ...e, path: e.path });
      if (entries.length >= maxFiles) break;
    }

    if (entries.length === 0) return 'Error: No valid project paths in read_files request.';

    const parts: string[] = [];
    parts.push(`read_files: ${entries.length} path(s), total budget ${formatBytes(totalBudget)} chars\n`);

    for (let i = 0; i < entries.length; i++) {
      const ent = entries[i];
      const target = ensureInsideProject(ent.path);
      if (!target.ok) {
        parts.push(`════ ${ent.path} ════\n${target.error}\n`);
        continue;
      }
      const filePath = target.path;
      if (!await fs.pathExists(filePath)) {
        parts.push(`════ ${ent.path} ════\nError: File not found\n`);
        continue;
      }
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        parts.push(`════ ${ent.path} ════\nError: Not a file\n`);
        continue;
      }
      if (await looksBinary(filePath)) {
        parts.push(`════ ${ent.path} ════\nError: Refusing to read likely binary (${formatBytes(stat.size)})\n`);
        continue;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const perFileCap = boundedNumber(ent.max_chars, Math.min(DEFAULT_MAX_READ_CHARS, totalBudget), 1000, 500_000);
      const sliceCap = Math.min(perFileCap, totalBudget);
      if (sliceCap < 500) {
        parts.push(`════ ${ent.path} ════\nSkipped: remaining total character budget too small.\n`);
        break;
      }

      const center = Number(ent.center_line);
      const useCenter = Number.isFinite(center) && center >= 1;
      const halfWindow = boundedNumber(ent.context_lines, 28, 1, 500);

      let requestedStart: number;
      let requestedEnd: number;
      if (useCenter) {
        const c = Math.min(Math.max(Math.trunc(center), 1), lines.length);
        requestedStart = Math.max(1, c - halfWindow);
        requestedEnd = Math.min(lines.length, c + halfWindow);
      } else {
        requestedEnd = ent.end_line || lines.length;
        requestedStart = ent.tail
          ? Math.max(1, requestedEnd - Math.max(1, Number(ent.start_line || 200)) + 1)
          : Number(ent.start_line || 1);
      }

      const start = Math.max(0, requestedStart - 1);
      const end = Math.min(lines.length, requestedEnd);
      const slice = lines.slice(start, end);
      const numbered = slice.map((line, j) => `${start + j + 1}: ${line}`).join('\n');
      const truncated = truncate(numbered, sliceCap);
      totalBudget -= truncated.text.length;

      const eolHint = content.includes('\r\n') ? 'CRLF' : 'LF';
      const lang = inferFileLanguageLabel(ent.path);
      const fp = contentFingerprint(content);

      const meta = [
        `════ ${ent.path} ════`,
        `Size: ${formatBytes(stat.size)} · Lines: ${lines.length} · Showing: ${start + 1}-${Math.max(start, end)}`,
        `yamx_file_intel: language=${lang}; eol=${eolHint}; fingerprint=${fp}`,
        truncated.truncated ? `Truncated: returned ${formatBytes(truncated.text.length)} of selected range` : '',
      ].filter(Boolean).join('\n');

      parts.push(`${meta}\n${truncated.text}\n`);
    }

    return parts.join('\n');
  },
};

export const writeFile: Tool = {
  definition: {
    name: 'write_file',
    description: `Write content to a file. Creates parent directories automatically. Use for new files or full rewrites.
Pass if_match_fingerprint from the latest read_file / read_files yamx_file_intel line to refuse the write when the file changed on disk (optimistic concurrency).`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        content: { type: 'string', description: 'The complete content to write' },
        dry_run: { type: 'boolean', description: 'Preview the write without changing the file' },
        if_match_fingerprint: {
          type: 'string',
          description: 'If set, only write when current file fingerprint matches (see yamx_file_intel from read_file). Skip for brand-new files.',
        },
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
    const oldContent = existed ? await fs.readFile(filePath, 'utf-8').catch(() => '') : '';
    const newContent = String(args.content ?? '');
    const lock = args.if_match_fingerprint != null && String(args.if_match_fingerprint).trim() !== ''
      ? String(args.if_match_fingerprint).trim()
      : null;

    if (existed && lock) {
      const curFp = contentFingerprint(oldContent);
      if (curFp !== lock) {
        return [
          `Error: fingerprint mismatch for ${args.path} — file changed on disk or fingerprint stale.`,
          `Expected if_match_fingerprint: ${lock}`,
          `Current ${curFp}; re-read the file and merge before writing.`,
        ].join('\n');
      }
    }
    if (!existed && lock) {
      return `Error: if_match_fingerprint was set but ${args.path} does not exist yet. Omit the lock for creates.`;
    }
    if (existed && oldContent === newContent) {
      return `No changes: ${args.path} already has the requested content.`;
    }
    const summary = summarizeTextChange(oldContent, newContent);

    if (args.dry_run) {
      return [
        `Dry run: would ${existed ? 'update' : 'create'} ${args.path}`,
        existed ? `yamx_file_intel: fingerprint_after=${contentFingerprint(newContent)}` : '',
        formatTextEditSummary(summary),
        previewTextChange(oldContent, newContent),
      ].filter(Boolean).join('\n');
    }

    await atomicWriteText(filePath, newContent);

    const afterFp = contentFingerprint(newContent);
    return `${existed ? 'Updated' : 'Created'} file: ${args.path}; ${formatTextEditSummary(summary)}; yamx_file_intel: fingerprint=${afterFp}`;
  },
};

export const writeFiles: Tool = {
  definition: {
    name: 'write_files',
    description: `Atomically apply many file writes in one tool call (validates fingerprints first, then writes). Default atomic=all-or-nothing with rollback on failure. Use dry_run to preview aggregate diff stats.`,
    parameters: {
      type: 'object',
      properties: {
        writes: {
          type: 'array',
          description: 'Each entry: { path, content, if_match_fingerprint? }',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              if_match_fingerprint: { type: 'string', description: 'Optimistic lock from last read' },
            },
            required: ['path', 'content'],
          },
        },
        dry_run: { type: 'boolean' },
        atomic: { type: 'boolean', description: 'When true (default), rollback all writes if any fails after writes begin.' },
      },
      required: ['writes'],
    },
  },
  needsApproval: true,
  async execute(args) {
    if (!Array.isArray(args.writes) || args.writes.length === 0) {
      return 'Error: writes must be a non-empty array.';
    }
    if (args.writes.length > 40) {
      return 'Error: At most 40 files per write_files batch — split into smaller calls.';
    }

    const atomic = args.atomic !== false;
    type Prepared = {
      displayPath: string;
      filePath: string;
      existed: boolean;
      oldContent: string;
      newContent: string;
      lock: string | null;
    };

    const prepared: Prepared[] = [];
    const seen = new Set<string>();

    for (const w of args.writes) {
      if (!w || typeof w.path !== 'string') continue;
      const target = ensureInsideProject(w.path);
      if (!target.ok) return target.error;
      const key = path.normalize(target.path);
      if (seen.has(key)) return `Error: duplicate path in write_files: ${w.path}`;
      seen.add(key);

      const filePath = target.path;
      const existed = await fs.pathExists(filePath);
      if (existed) {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) return `Error: Not a file: ${w.path}`;
        if (await looksBinary(filePath)) return `Error: Refusing to overwrite likely binary: ${w.path}`;
      }

      const oldContent = existed ? await fs.readFile(filePath, 'utf-8').catch(() => '') : '';
      const newContent = String(w.content ?? '');
      const lock = w.if_match_fingerprint != null && String(w.if_match_fingerprint).trim() !== ''
        ? String(w.if_match_fingerprint).trim()
        : null;

      if (existed && lock) {
        const curFp = contentFingerprint(oldContent);
        if (curFp !== lock) {
          return [
            `Error: fingerprint mismatch for ${w.path} in write_files batch.`,
            `Expected if_match_fingerprint: ${lock}; current ${curFp}.`,
          ].join('\n');
        }
      }
      if (!existed && lock) {
        return `Error: if_match_fingerprint set for new file ${w.path}. Omit lock for creates.`;
      }

      prepared.push({
        displayPath: w.path,
        filePath,
        existed,
        oldContent,
        newContent,
        lock,
      });
    }

    if (prepared.length === 0) return 'Error: No valid writes in write_files.';

    const lines: string[] = [];
    let wouldChange = 0;
    for (const p of prepared) {
      if (p.oldContent !== p.newContent) wouldChange++;
      lines.push(
        `${p.displayPath}: ${p.existed ? 'update' : 'create'}; ${formatTextEditSummary(summarizeTextChange(p.oldContent, p.newContent))}`,
      );
    }

    if (args.dry_run) {
      return [`Dry run: ${prepared.length} file(s), ${wouldChange} would change content`, ...lines].join('\n');
    }

    const snapshots = new Map<string, string | null>();
    for (const p of prepared) {
      snapshots.set(p.filePath, p.existed ? p.oldContent : null);
    }

    const done: string[] = [];
    try {
      for (const p of prepared) {
        if (p.oldContent === p.newContent) {
          done.push(p.filePath);
          continue;
        }
        await fs.ensureDir(path.dirname(p.filePath));
        await atomicWriteText(p.filePath, p.newContent);
        done.push(p.filePath);
      }
    } catch (err: any) {
      if (atomic) {
        for (const fp of done.reverse()) {
          const prev = snapshots.get(fp);
          try {
            if (prev === null) await fs.remove(fp).catch(() => {});
            else if (typeof prev === 'string') await atomicWriteText(fp, prev);
          } catch { /* best-effort rollback */ }        }
      }
      return `Error: write_files failed mid-batch: ${err?.message || err}${atomic ? ' (rolled back prior writes in this batch)' : ''}`;
    }

    return [
      `write_files: ${prepared.length} file(s) OK (${wouldChange} content updates).`,
      ...prepared.map((p) =>
        `${p.displayPath}: fingerprint=${contentFingerprint(p.newContent)}`,
      ),
    ].join('\n');
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
    const snapshot = await readTextFileSnapshot(filePath, args.path);
    if (typeof snapshot === 'string') return snapshot;

    const content = snapshot.content;
    const oldText = normalizeNewTextForFile(String(args.old_text ?? ''), snapshot);
    const newText = normalizeNewTextForFile(String(args.new_text ?? ''), snapshot);
    if (!oldText) return 'Error: old_text must not be empty.';
    const count = countOccurrences(content, oldText);

    if (count === 0) {
      const hints = closestTextHints(content, oldText);
      return [
        `Error: Could not find the specified text in ${args.path}. old_text must match EXACTLY, including whitespace and indentation.`,
        hints.length ? `Closest current lines:\n${hints.join('\n')}` : 'Use read_file to inspect the current content.',
      ].join('\n');
    }
    const occurrence = boundedNumber(args.occurrence, 1, 1, Math.max(1, count));
    const replaceAll = Boolean(args.replace_all);
    const newContent = replaceAll
      ? content.split(oldText).join(newText)
      : replaceOccurrence(content, oldText, newText, occurrence);

    const changedCount = replaceAll ? count : 1;
    if (newContent === content) {
      return `No changes: replacement for ${args.path} is identical to the current content.`;
    }
    const firstIndex = content.indexOf(oldText);
    const loc = lineColumnForIndex(content, firstIndex);
    const summary = summarizeTextChange(content, newContent, oldText, newText);
    if (args.dry_run) {
      return [
        `Dry run: ${args.path} has ${count} match${count === 1 ? '' : 'es'}; would replace ${changedCount}. First match at ${loc.line}:${loc.column}.`,
        `yamx_file_intel: fingerprint_after=${contentFingerprint(newContent)}`,
        formatTextEditSummary(summary),
        previewTextChange(content, newContent),
      ].join('\n');
    }
    await atomicWriteText(filePath, newContent);

    return `Edited ${args.path}: replaced ${changedCount} occurrence${changedCount === 1 ? '' : 's'}; first match ${loc.line}:${loc.column}; ${formatTextEditSummary(summary)}. yamx_file_intel: fingerprint=${contentFingerprint(newContent)}`;
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
