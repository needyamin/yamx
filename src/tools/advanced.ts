/**
 * YamX - Advanced File Tools
 * Multi-edit, patch, copy, move, tree, grep, and batch operations.
 */

import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';
import { Tool } from './registry.js';
import { ensureInsideProject, formatBytes } from './utils.js';

export const multiEdit: Tool = {
  definition: {
    name: 'multi_edit',
    description: `Apply multiple search-and-replace edits to a single file in one operation. 
Each edit has an old_text (exact match) and new_text (replacement). Edits are applied sequentially.
Use this when you need to make several non-adjacent changes to the same file — much faster than calling edit_file multiple times.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        edits: {
          type: 'array',
          description: 'Array of edits to apply',
          items: {
            type: 'object',
            properties: {
              old_text: { type: 'string', description: 'Exact text to find' },
              new_text: { type: 'string', description: 'Replacement text' },
            },
            required: ['old_text', 'new_text'],
          },
        },
      },
      required: ['path', 'edits'],
    },
  },
  needsApproval: true,
  async execute(args) {
    const target = ensureInsideProject(args.path);
    if (!target.ok) return target.error;
    const filePath = target.path;
    if (!await fs.pathExists(filePath)) return `Error: File not found: ${args.path}`;

    let content = await fs.readFile(filePath, 'utf-8');
    const results: string[] = [];

    for (let i = 0; i < args.edits.length; i++) {
      const edit = args.edits[i];
      if (content.includes(edit.old_text)) {
        content = content.replace(edit.old_text, edit.new_text);
        results.push(`Edit ${i + 1}: ✓ applied`);
      } else {
        results.push(`Edit ${i + 1}: ✗ old_text not found`);
      }
    }

    await fs.writeFile(filePath, content, 'utf-8');
    return `Applied edits to ${args.path}:\n${results.join('\n')}`;
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
      },
      required: ['path', 'start_line', 'end_line', 'new_content'],
    },
  },
  needsApproval: true,
  async execute(args) {
    const target = ensureInsideProject(args.path);
    if (!target.ok) return target.error;
    const filePath = target.path;
    if (!await fs.pathExists(filePath)) return `Error: File not found: ${args.path}`;

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = args.start_line - 1;
    const end = args.end_line;

    if (start < 0 || end > lines.length || start >= end) {
      return `Error: Invalid line range ${args.start_line}-${args.end_line} (file has ${lines.length} lines)`;
    }

    const removedCount = end - start;
    const newLines = args.new_content.split('\n');
    lines.splice(start, removedCount, ...newLines);
    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');

    return `Patched ${args.path}: replaced lines ${args.start_line}-${args.end_line} (${removedCount} lines) with ${newLines.length} lines. File now has ${lines.length} lines.`;
  },
};
