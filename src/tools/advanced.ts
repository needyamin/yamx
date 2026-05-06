/**
 * YamX - Advanced File Tools
 * Multi-edit, patch, and batch operations for power users.
 */

import fs from 'fs-extra';
import path from 'path';
import { Tool } from './registry.js';

function resolve(filePath: string): string {
  return path.resolve(process.cwd(), filePath);
}

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
    const filePath = resolve(args.path);
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
      await fs.copy(resolve(args.source), resolve(args.destination));
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
      await fs.move(resolve(args.source), resolve(args.destination));
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
      const filePath = resolve(args.path);
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
