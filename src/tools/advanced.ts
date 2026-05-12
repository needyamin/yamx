/**
 * YamX - Advanced File Tools
 * Multi-edit, patch, copy, move, tree, grep, and batch operations.
 */

import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';
import { Tool } from './registry.js';
import { ensureInsideProject, formatBytes } from './utils.js';
import {
  atomicWriteText,
  closestTextHints,
  countOccurrences,
  formatTextEditSummary,
  lineColumnForIndex,
  multiEditOverlapWarnings,
  normalizeNewTextForFile,
  orderMultiEditIndicesByPosition,
  previewTextChange,
  readTextFileSnapshot,
  replaceOccurrence,
  simulateMultiEditSequence,
  summarizeTextChange,
} from './file-editing.js';

export const multiEdit: Tool = {
  definition: {
    name: 'multi_edit',
    description: `Apply multiple exact search-and-replace edits to one file as a single transaction.
By default every edit must match before the file is written, so failed edits do not leave half-applied changes. Supports occurrence targeting, replace_all, dry_run previews, and optional allow_partial mode.

**Intelligence:** set smart_order=true to apply edits in ascending source order (reduces failures when the model lists edits bottom-to-up). Yamx runs a full-sequence simulation when allow_partial is false to catch "edit 3 invalidated by edit 1" before writing. Overlapping single replacements emit yamx_edit_intel warnings.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        smart_order: {
          type: 'boolean',
          description: 'Reorder edits by first match position in the original file (stable). Helps when edits are listed in arbitrary order.',
        },
        edits: {
          type: 'array',
          description: 'Array of edits to apply',
          items: {
            type: 'object',
            properties: {
              old_text: { type: 'string', description: 'Exact text to find' },
              new_text: { type: 'string', description: 'Replacement text' },
              occurrence: { type: 'number', description: 'Which occurrence to replace for this edit (1-indexed, default 1)' },
              replace_all: { type: 'boolean', description: 'Replace every occurrence for this edit' },
            },
            required: ['old_text', 'new_text'],
          },
        },
        dry_run: { type: 'boolean', description: 'Preview all edits without writing the file' },
        allow_partial: { type: 'boolean', description: 'Apply edits that match even if other edits fail. Default false.' },
      },
      required: ['path', 'edits'],
    },
  },
  needsApproval: true,
  async execute(args) {
    const target = ensureInsideProject(args.path);
    if (!target.ok) return target.error;
    const filePath = target.path;
    const snapshot = await readTextFileSnapshot(filePath, args.path);
    if (typeof snapshot === 'string') return snapshot;
    if (!Array.isArray(args.edits) || args.edits.length === 0) {
      return 'Error: edits must be a non-empty array.';
    }
    if (args.edits.length > 80) {
      return 'Error: too many edits for one multi_edit call. Split into smaller batches of 80 or fewer edits.';
    }

    type EditEntry = { old_text?: string; new_text?: string; occurrence?: number; replace_all?: boolean };
    let edits: EditEntry[] = args.edits.slice();
    const allowPartial = Boolean(args.allow_partial);
    const smartOrder = Boolean(args.smart_order);

    const normalizedOldTexts = edits.map((e) => normalizeNewTextForFile(String(e.old_text ?? ''), snapshot));
    const overlapWarnings = multiEditOverlapWarnings(snapshot.content, edits, normalizedOldTexts);

    if (smartOrder) {
      const order = orderMultiEditIndicesByPosition(snapshot.content, normalizedOldTexts);
      edits = order.map((i) => edits[i]);
    }

    const simEdits = edits.map((e) => ({
      old_text: String(e.old_text ?? ''),
      new_text: String(e.new_text ?? ''),
      occurrence: e.occurrence,
      replace_all: e.replace_all,
    }));
    const simulation = simulateMultiEditSequence(snapshot.content, snapshot, simEdits);
    if (!simulation.ok && !allowPartial) {
      return [
        `Error: multi_edit preflight failed for ${args.path}; no changes written.`,
        ...simulation.failures.map((f) => `Simulation edit ${f.index}: ${f.reason}`),
        ...overlapWarnings.map((w) => `yamx_edit_intel: ${w}`),
        ...(smartOrder ? ['Note: smart_order was applied before simulation.'] : []),
      ].join('\n');
    }

    let content = snapshot.content;
    const original = content;
    const results: string[] = [];
    const failures: string[] = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const oldText = normalizeNewTextForFile(String(edit.old_text ?? ''), snapshot);
      const newText = normalizeNewTextForFile(String(edit.new_text ?? ''), snapshot);
      if (!oldText) {
        failures.push(`Edit ${i + 1}: old_text must not be empty.`);
        continue;
      }

      const count = countOccurrences(content, oldText);
      if (count === 0) {
        const hints = closestTextHints(content, oldText, 2);
        failures.push(`Edit ${i + 1}: old_text not found${hints.length ? `; closest lines: ${hints.join(' | ')}` : ''}.`);
        continue;
      }

      const replaceAll = Boolean(edit.replace_all);
      const occurrence = boundedNumber(edit.occurrence, 1, 1, Math.max(1, count));
      const firstIndex = content.indexOf(oldText);
      const loc = lineColumnForIndex(content, firstIndex);
      content = replaceAll
        ? content.split(oldText).join(newText)
        : replaceOccurrence(content, oldText, newText, occurrence);
      const applied = replaceAll ? count : 1;
      results.push(`Edit ${i + 1}: applied ${applied}/${count} match${count === 1 ? '' : 'es'} near ${loc.line}:${loc.column}.`);
    }
    if (failures.length && !allowPartial) {
      return [
        `Error: multi_edit aborted for ${args.path}; no changes were written because ${failures.length} edit${failures.length === 1 ? '' : 's'} failed.`,
        ...failures,
      ].join('\n');
    }
    if (content === original) {
      return `No changes: all matched replacements for ${args.path} were identical to current content.`;
    }

    const summary = summarizeTextChange(original, content);
    const intelHeader =
      overlapWarnings.length || smartOrder || (!simulation.ok && allowPartial)
        ? [
          'yamx_edit_intel:',
          ...overlapWarnings.map((w) => `  - ${w}`),
          smartOrder ? '  - smart_order: applied edits in ascending source position.' : '',
          !simulation.ok && allowPartial
            ? `  - preflight simulation had ${simulation.failures.length} issue(s); allow_partial will skip failing steps.`
            : '',
        ].filter(Boolean).join('\n')
        : '';

    if (args.dry_run) {
      return [
        intelHeader,
        `Dry run: would apply ${results.length} edit${results.length === 1 ? '' : 's'} to ${args.path}${failures.length ? ` (${failures.length} skipped)` : ''}.`,
        ...results,
        ...failures,
        formatTextEditSummary(summary),
        previewTextChange(original, content),
      ].filter(Boolean).join('\n');
    }

    await atomicWriteText(filePath, content);
    return [
      intelHeader,
      `Applied ${results.length} edit${results.length === 1 ? '' : 's'} to ${args.path}${failures.length ? ` (${failures.length} skipped by allow_partial)` : ''}.`,
      ...results,
      ...failures,
      formatTextEditSummary(summary),
    ].filter(Boolean).join('\n');
  },
};

export const copyFile: Tool = {
  definition: {
    name: 'copy_file',
    description: 'Copy a file or directory to a new location.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path' },
        destination: { type: 'string', description: 'Destination path' },
      },
      required: ['source', 'destination'],
    },
  },
  needsApproval: true,
  async execute(args) {
    try {
      const source = ensureInsideProject(args.source);
      if (!source.ok) return source.error;
      const destination = ensureInsideProject(args.destination);
      if (!destination.ok) return destination.error;
      await fs.copy(source.path, destination.path);
      return `Copied ${args.source} → ${args.destination}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  },
};

export const moveFile: Tool = {
  definition: {
    name: 'move_file',
    description: 'Move or rename a file or directory.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Current path' },
        destination: { type: 'string', description: 'New path' },
      },
      required: ['source', 'destination'],
    },
  },
  needsApproval: true,
  async execute(args) {
    try {
      const source = ensureInsideProject(args.source);
      if (!source.ok) return source.error;
      const destination = ensureInsideProject(args.destination);
      if (!destination.ok) return destination.error;
      await fs.move(source.path, destination.path);
      return `Moved ${args.source} → ${args.destination}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  },
};

export const fileInfo: Tool = {
  definition: {
    name: 'file_info',
    description: 'Get metadata about a file: size, creation date, permissions, line count.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
      },
      required: ['path'],
    },
  },
  async execute(args) {
    try {
      const target = ensureInsideProject(args.path);
      if (!target.ok) return target.error;
      const filePath = target.path;
      const stat = await fs.stat(filePath);
      const lines = stat.isFile()
        ? (await fs.readFile(filePath, 'utf-8')).split('\n').length
        : null;

      return [
        `File: ${args.path}`,
        `Type: ${stat.isDirectory() ? 'Directory' : 'File'}`,
        `Size: ${formatBytes(stat.size)}`,
        lines !== null ? `Lines: ${lines}` : '',
        `Created: ${stat.birthtime.toISOString()}`,
        `Modified: ${stat.mtime.toISOString()}`,
        `Permissions: ${stat.mode.toString(8).slice(-3)}`,
      ].filter(Boolean).join('\n');
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  },
};

export const grepSearch: Tool = {
  definition: {
    name: 'grep_search',
    description: `Search for a regex pattern across project files with context lines. Like ripgrep/grep. Returns matching lines with surrounding context. More powerful than search_files for understanding code flow.`,
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory to search in (default: ".")' },
        include: { type: 'string', description: 'Glob pattern for files to include (e.g., "**/*.ts")' },
        context_lines: { type: 'number', description: 'Lines of context to show around each match (default: 2)' },
        case_sensitive: { type: 'boolean', description: 'Case-sensitive search (default: false)' },
        max_results: { type: 'number', description: 'Maximum matches to return (default: 30)' },
      },
      required: ['pattern'],
    },
  },
  async execute(args) {
    const target = ensureInsideProject(args.path || '.');
    if (!target.ok) return target.error;
    const searchDir = target.path;
    const includePattern = args.include || '**/*';
    const maxResults = args.max_results || 30;
    const contextLines = args.context_lines ?? 2;
    const flags = args.case_sensitive ? 'g' : 'gi';

    const files = await fg(includePattern, {
      cwd: searchDir,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '*.lock', '*.map', '*.min.js', '*.min.css'],
      onlyFiles: true,
    });

    const results: string[] = [];
    let matchCount = 0;

    for (const file of files) {
      if (matchCount >= maxResults) break;
      try {
        const content = await fs.readFile(path.join(searchDir, file), 'utf-8');
        const lines = content.split('\n');
        const regex = new RegExp(args.pattern, flags);

        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            matchCount++;
            if (matchCount > maxResults) break;

            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);
            const block: string[] = [`── ${file}:${i + 1} ──`];
            for (let j = start; j <= end; j++) {
              const marker = j === i ? '▸' : ' ';
              block.push(`${marker} ${j + 1}: ${lines[j]}`);
            }
            results.push(block.join('\n'));
          }
        }
      } catch {
        // skip binary/unreadable files
      }
    }

    if (results.length === 0) return `No matches found for /${args.pattern}/${flags}`;
    return `Found ${matchCount} match${matchCount > 1 ? 'es' : ''}:\n\n${results.join('\n\n')}`;
  },
};

export const treeTool: Tool = {
  definition: {
    name: 'directory_tree',
    description: 'Show a visual directory tree with file sizes and depth control. Great for understanding project structure at a glance.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Root directory (default: ".")' },
        max_depth: { type: 'number', description: 'Maximum depth to traverse (default: 4)' },
        show_hidden: { type: 'boolean', description: 'Show hidden files/dirs (default: false)' },
        show_sizes: { type: 'boolean', description: 'Show file sizes (default: true)' },
      },
    },
  },
  async execute(args) {
    const target = ensureInsideProject(args.path || '.');
    if (!target.ok) return target.error;
    const rootDir = target.path;
    const maxDepth = args.max_depth ?? 4;
    const showHidden = args.show_hidden ?? false;
    const showSizes = args.show_sizes ?? true;

    if (!await fs.pathExists(rootDir)) return `Error: Directory not found: ${args.path || '.'}`;

    const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.nuxt', 'coverage', '.venv', 'venv']);
    let fileCount = 0;
    let dirCount = 0;

    async function buildTree(dir: string, prefix: string, depth: number): Promise<string> {
      if (depth > maxDepth) return '';

      const entries = await fs.readdir(dir, { withFileTypes: true });
      const filtered = entries
        .filter(e => {
          if (!showHidden && e.name.startsWith('.')) return false;
          if (IGNORE.has(e.name)) return false;
          return true;
        })
        .sort((a, b) => {
          // Directories first, then files
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

      const lines: string[] = [];

      for (let i = 0; i < filtered.length; i++) {
        const entry = filtered[i];
        const isLast = i === filtered.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';

        if (entry.isDirectory()) {
          dirCount++;
          lines.push(`${prefix}${connector}📁 ${entry.name}/`);
          const sub = await buildTree(path.join(dir, entry.name), prefix + childPrefix, depth + 1);
          if (sub) lines.push(sub);
        } else {
          fileCount++;
          let sizeStr = '';
          if (showSizes) {
            try {
              const stat = await fs.stat(path.join(dir, entry.name));
              sizeStr = ` (${formatBytes(stat.size)})`;
            } catch { /* skip */ }
          }
          lines.push(`${prefix}${connector}${entry.name}${sizeStr}`);
        }
      }

      return lines.join('\n');
    }

    const rootName = path.basename(rootDir);
    const tree = await buildTree(rootDir, '', 0);
    return `📁 ${rootName}/\n${tree}\n\n${dirCount} directories, ${fileCount} files`;
  },
};

export const patchFile: Tool = {
  definition: {
    name: 'patch_file',
    description: `Apply a patch to a file by specifying a line range to replace. More precise than edit_file for large changes.
Provide the start_line and end_line (1-indexed, inclusive) and the new content to replace those lines with.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        start_line: { type: 'number', description: 'First line to replace (1-indexed)' },
        end_line: { type: 'number', description: 'Last line to replace (1-indexed, inclusive)' },
        new_content: { type: 'string', description: 'New content to insert in place of the specified line range' },
        dry_run: { type: 'boolean', description: 'Preview the patch without changing the file' },
      },
      required: ['path', 'start_line', 'end_line', 'new_content'],
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
    const lines = content.split(/\r?\n/);
    const startLine = boundedNumber(args.start_line, 1, 1, Math.max(1, lines.length));
    const endLine = boundedNumber(args.end_line, startLine, startLine, Math.max(startLine, lines.length));
    const start = startLine - 1;
    const end = endLine;

    if (start < 0 || end > lines.length || start >= end) {
      return `Error: Invalid line range ${args.start_line}-${args.end_line} (file has ${lines.length} lines)`;
    }

    const removedCount = end - start;
    const normalizedNewContent = normalizeNewTextForFile(String(args.new_content ?? ''), snapshot);
    const newLines = normalizedNewContent.split(snapshot.eol);
    lines.splice(start, removedCount, ...newLines);
    let newContent = lines.join(snapshot.eol);
    if (snapshot.finalNewline && !newContent.endsWith(snapshot.eol)) {
      newContent += snapshot.eol;
    }
    if (newContent === content) {
      return `No changes: patch for ${args.path} is identical to current content.`;
    }

    const summary = summarizeTextChange(content, newContent);
    if (args.dry_run) {
      return [
        `Dry run: would patch ${args.path} lines ${startLine}-${endLine} (${removedCount} line${removedCount === 1 ? '' : 's'}) with ${newLines.length} line${newLines.length === 1 ? '' : 's'}.`,
        formatTextEditSummary(summary),
        previewTextChange(content, newContent),
      ].join('\n');
    }

    await atomicWriteText(filePath, newContent);

    return `Patched ${args.path}: replaced lines ${startLine}-${endLine} (${removedCount} line${removedCount === 1 ? '' : 's'}) with ${newLines.length} line${newLines.length === 1 ? '' : 's'}; ${formatTextEditSummary(summary)}.`;
  },
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.min(max, Math.max(min, fallback));
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export const findReferences: Tool = {
  definition: {
    name: 'find_references',
    description: `Advanced Code Reasoning Engine: Search for symbol references, imports, and usages across the codebase. 
Use this BEFORE making multi-file edits, changing function signatures, or moving files. 
It analyzes import chains, identifies type propagation risks, and detects consumers of a specific module/symbol.`,
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'The exact class, function, variable, or type name to find.' },
        path: { type: 'string', description: 'Directory to search in (default: ".")' },
        include: { type: 'string', description: 'Glob pattern for files to include (e.g., "**/*.{ts,tsx,js,jsx}")' },
        is_import_path: { type: 'boolean', description: 'Set to true if searching for an import path (e.g. "./utils") rather than a symbol name.' },
      },
      required: ['symbol'],
    },
  },
  async execute(args) {
    const target = ensureInsideProject(args.path || '.');
    if (!target.ok) return target.error;
    const searchDir = target.path;
    const includePattern = args.include || '**/*.{ts,tsx,js,jsx,py,go,rs,java,cs,php,rb}';
    
    const files = await fg(includePattern, {
      cwd: searchDir,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '*.lock', '*.map', '*.min.js'],
      onlyFiles: true,
    });

    const symbol = args.symbol.trim();
    if (!symbol) return 'Error: symbol cannot be empty.';

    // Safely escape the symbol/path for regex
    const escaped = symbol.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
    
    // For import paths, match strings. For symbols, match word boundaries.
    const regexPattern = args.is_import_path 
      ? `['"\`]${escaped}['"\`]` 
      : `\\\\b${escaped}\\\\b`;
      
    const regex = new RegExp(regexPattern, 'g');
    const importRegex = new RegExp(`^\\\\s*import.*\\\\b${escaped}\\\\b.*from|^\\\\s*(from|import).*['"\`].*${escaped}.*['"\`]`, 'im');
    const exportRegex = new RegExp(`^\\\\s*export.*\\\\b${escaped}\\\\b`, 'im');

    let totalMatches = 0;
    const filesWithMatches: Array<{ file: string, type: 'import' | 'export' | 'usage', count: number }> = [];

    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(searchDir, file), 'utf-8');
        regex.lastIndex = 0;
        const matches = content.match(regex);
        if (matches && matches.length > 0) {
          totalMatches += matches.length;
          
          let matchType: 'import' | 'export' | 'usage' = 'usage';
          if (exportRegex.test(content)) matchType = 'export';
          else if (importRegex.test(content)) matchType = 'import';

          filesWithMatches.push({ file, type: matchType, count: matches.length });
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (filesWithMatches.length === 0) {
      return `No references found for '${symbol}' in the scanned files.`;
    }

    // Sort by type: exports first, then imports, then usages
    filesWithMatches.sort((a, b) => {
      const rank = { export: 0, import: 1, usage: 2 };
      return rank[a.type] - rank[b.type] || b.count - a.count;
    });

    const lines = [
      `Advanced Code Reasoning: ${totalMatches} reference(s) found for '${symbol}' across ${filesWithMatches.length} file(s).`,
      ``,
      `### Dependency Graph Hints:`,
      filesWithMatches.some(f => f.type === 'export') 
        ? `- Source Definition likely in: ${filesWithMatches.filter(f => f.type === 'export').map(f => f.file).join(', ')}` 
        : `- Source Definition not directly detected via export keyword.`,
      filesWithMatches.some(f => f.type === 'import') 
        ? `- Direct Consumers: ${filesWithMatches.filter(f => f.type === 'import').length} file(s) import this.` 
        : '',
      ``,
      `### Multi-File Edit Strategy:`,
      `1. Modify the source definition(s) first.`,
      `2. Update the direct consumers (imports/usages).`,
      `3. Run typecheck and tests to verify propagation.`,
      ``,
      `### Affected Files:`
    ];

    for (const fw of filesWithMatches) {
      const typeLabel = fw.type === 'export' ? '[Definition/Export]' : fw.type === 'import' ? '[Import/Consumer]' : '[Usage]';
      lines.push(`  ${typeLabel} ${fw.file} (${fw.count} matches)`);
    }

    return lines.filter(Boolean).join('\n');
  },
};
