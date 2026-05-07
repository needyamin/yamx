/**
 * YamX - Git integration tools.
 */

import { Tool } from './registry.js';
import { ensureInsideProject, runProcess } from './utils.js';

async function git(args: string[], timeoutMs = 30_000): Promise<string> {
  const result = await runProcess('git', args, { timeoutMs, maxChars: 120_000 });
  if (result.code === 0) return result.text.trim();
  const suffix = result.timedOut ? `\n(timed out after ${timeoutMs}ms)` : '';
  return `Git error: ${result.text || `exit ${result.code}`}${suffix}`;
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.trunc(n), max);
}

function validRefName(name: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(name) && !name.includes('..') && !name.endsWith('/') && !name.endsWith('.');
}

export const gitStatus: Tool = {
  definition: {
    name: 'git_status',
    description: 'Show the current git status: modified files, staged changes, untracked files, current branch.',
    parameters: { type: 'object', properties: {} },
  },
  async execute() {
    const branch = await git(['branch', '--show-current']);
    const status = await git(['status', '--short']);
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    const ahead = upstream.startsWith('Git error')
      ? 'N/A'
      : await git(['rev-list', '--count', `${upstream}..HEAD`]);
    return `Branch: ${branch || '(detached)'}\nAhead by: ${ahead} commits\n\n${status || '(working tree clean)'}`;
  },
};

export const gitDiff: Tool = {
  definition: {
    name: 'git_diff',
    description: 'Show git diff of changes. Shows what has been modified but not yet staged, or staged changes.',
    parameters: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'Show staged changes instead (default: false)' },
        file: { type: 'string', description: 'Specific file to diff (optional)' },
      },
    },
  },
  async execute(args) {
    const cmd = ['diff'];
    if (args.staged) cmd.push('--cached');
    if (args.file) {
      const file = ensureInsideProject(args.file);
      if (!file.ok) return file.error;
      cmd.push('--', args.file);
    }
    const diff = await git(cmd);
    return diff || '(no changes)';
  },
};

export const gitCommit: Tool = {
  definition: {
    name: 'git_commit',
    description: 'Stage all changes and create a git commit with the given message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The commit message' },
        add_all: { type: 'boolean', description: 'Stage all changes first (default: true)' },
      },
      required: ['message'],
    },
  },
  needsApproval: true,
  async execute(args) {
    const message = String(args.message || '').trim();
    if (!message) return 'Error: Commit message is required.';
    if (args.add_all !== false) {
      const added = await git(['add', '-A']);
      if (added.startsWith('Git error')) return added;
    }
    return git(['commit', '-m', message], 60_000);
  },
};

export const gitLog: Tool = {
  definition: {
    name: 'git_log',
    description: 'Show recent git commit history.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of commits to show (default: 10, max 100)' },
        oneline: { type: 'boolean', description: 'Compact one-line format (default: true)' },
      },
    },
  },
  async execute(args) {
    const count = positiveInt(args.count, 10, 100);
    const cmd = ['log', '-n', String(count)];
    if (args.oneline !== false) cmd.push('--oneline');
    return git(cmd);
  },
};

export const gitBranch: Tool = {
  definition: {
    name: 'git_branch',
    description: 'List, create, or switch git branches.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '"list", "create", or "switch"' },
        name: { type: 'string', description: 'Branch name (for create/switch)' },
      },
      required: ['action'],
    },
  },
  needsApproval: true,
  async execute(args) {
    switch (args.action) {
      case 'list':
        return git(['branch', '-a']);
      case 'create':
        if (!args.name) return 'Error: Branch name required';
        if (!validRefName(args.name)) return 'Error: Invalid branch name.';
        return git(['checkout', '-b', args.name]);
      case 'switch':
        if (!args.name) return 'Error: Branch name required';
        if (!validRefName(args.name)) return 'Error: Invalid branch name.';
        return git(['checkout', args.name]);
      default:
        return `Unknown action: ${args.action}. Use "list", "create", or "switch".`;
    }
  },
};

export const gitStash: Tool = {
  definition: {
    name: 'git_stash',
    description: 'Stash or restore uncommitted changes.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '"save", "pop", or "list"' },
        message: { type: 'string', description: 'Optional message for save' },
      },
      required: ['action'],
    },
  },
  needsApproval: true,
  async execute(args) {
    switch (args.action) {
      case 'save':
        return git(['stash', 'push', '-m', String(args.message || 'yamx stash')]);
      case 'pop':
        return git(['stash', 'pop']);
      case 'list': {
        const list = await git(['stash', 'list']);
        return list || '(no stashes)';
      }
      default:
        return `Unknown action: ${args.action}. Use "save", "pop", or "list".`;
    }
  },
};
