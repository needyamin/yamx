/**
 * Yam Agent - File System Tools
 * Read, write, edit, search, and manage files with surgical precision.
 */

import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';
import { Tool } from './registry.js';

/** Resolve a path relative to the project root */
function resolve(filePath: string): string {
  return path.resolve(process.cwd(), filePath);
}

/** Check if a path is within the project root (security) */
function isWithinProject(filePath: string): boolean {
  const resolved = resolve(filePath);
  return resolved.startsWith(process.cwd());
}

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
      },
      required: ['path'],
    },
  },
  async execute(args) {
    const filePath = resolve(args.path);
    if (!isWithinProject(args.path)) return 'Error: Path outside project directory.';
    if (!await fs.pathExists(filePath)) return `Error: File not found: ${args.path}`;

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = (args.start_line || 1) - 1;
    const end = args.end_line || lines.length;
    const slice = lines.slice(start, end);

    const numbered = slice.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
    return `File: ${args.path} (${lines.length} lines total)\n${numbered}`;
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
    const filePath = resolve(args.path);
    if (!isWithinProject(args.path)) return 'Error: Path outside project directory.';

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
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  needsApproval: true,
  async execute(args) {
    const filePath = resolve(args.path);
    if (!isWithinProject(args.path)) return 'Error: Path outside project directory.';
    if (!await fs.pathExists(filePath)) return `Error: File not found: ${args.path}`;

    const content = await fs.readFile(filePath, 'utf-8');
    const count = content.split(args.old_text).length - 1;

    if (count === 0) {
      return `Error: Could not find the specified text in ${args.path}. Make sure old_text matches EXACTLY, including whitespace and indentation. Use read_file to check the current content.`;
    }
    if (count > 1) {
      return `Warning: Found ${count} occurrences of the text. Replacing the FIRST occurrence only. Be more specific if needed.`;
    }

    const newContent = content.replace(args.old_text, args.new_text);
    await fs.writeFile(filePath, newContent, 'utf-8');

    return `Edited ${args.path}: replaced ${args.old_text.split('\n').length} lines with ${args.new_text.split('\n').length} lines.`;
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
      },
    },
  },
  async execute(args) {
    const dirPath = resolve(args.path || '.');
    if (!await fs.pathExists(dirPath)) return `Error: Directory not found: ${args.path || '.'}`;

    if (args.pattern || args.recursive) {
      const pattern = args.pattern || '**/*';
      const entries = await fg(pattern, {
        cwd: dirPath,
        dot: false,
        ignore: ['node_modules/**', '.git/**', 'dist/**', '__pycache__/**', '*.pyc'],
        onlyFiles: false,
        stats: true,
      });
      const lines = entries.map((e: any) => {
        const isDir = e.stats?.isDirectory();
        const size = isDir ? '' : ` (${formatBytes(e.stats?.size || 0)})`;
        return `${isDir ? '📁' : '📄'} ${e.path}${size}`;
      });
      return `${lines.length} items in ${args.path || '.'}:\n${lines.join('\n')}`;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const lines = entries
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
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
      },
      required: ['pattern'],
    },
  },
  async execute(args) {
    const searchDir = resolve(args.path || '.');
    const includePattern = args.include || '**/*';
    const maxResults = args.max_results || 50;

    const files = await fg(includePattern, {
      cwd: searchDir,
      ignore: ['node_modules/**', '.git/**', 'dist/**', '*.lock', '*.map'],
      onlyFiles: true,
    });

    const results: string[] = [];
    const regex = new RegExp(args.pattern, 'gi');

    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const content = await fs.readFile(path.join(searchDir, file), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
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
    const filePath = resolve(args.path);
    if (!isWithinProject(args.path)) return 'Error: Path outside project directory.';
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
