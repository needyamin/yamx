/**
 * Yam Agent - Git Integration Tools
 * Full git workflow: status, diff, commit, branch, log, stash.
 */

import { execSync } from 'child_process';
import { Tool } from './registry.js';

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf-8', cwd: process.cwd(), timeout: 30000 }).trim();
  } catch (error: any) {
    return `Git error: ${error.stderr?.toString() || error.message}`;
  }
}

export const gitStatus: Tool = {
  definition: {
    name: 'git_status',
    description: 'Show the current git status: modified files, staged changes, untracked files, current branch.',
    parameters: { type: 'object', properties: {} },
  },
  async execute() {
    const branch = git('branch --show-current');
    const status = git('status --short');
    const ahead = git('rev-list --count @{upstream}..HEAD 2>/dev/null || echo "N/A"');
    return `Branch: ${branch}\nAhead by: ${ahead} commits\n\n${status || '(working tree clean)'}`;
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
    const staged = args.staged ? '--cached' : '';
    const file = args.file || '';
    const diff = git(`diff ${staged} ${file}`.trim());
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
    if (args.add_all !== false) {
      git('add -A');
    }
    const result = git(`commit -m "${args.message.replace(/"/g, '\\"')}"`);
    return result;
  },
};

export const gitLog: Tool = {
  definition: {
    name: 'git_log',
    description: 'Show recent git commit history.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of commits to show (default: 10)' },
        oneline: { type: 'boolean', description: 'Compact one-line format (default: true)' },
      },
    },
  },
  async execute(args) {
    const count = args.count || 10;
    const format = args.oneline !== false ? '--oneline' : '';
    return git(`log -n ${count} ${format}`);
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
        return git('branch -a');
      case 'create':
        if (!args.name) return 'Error: Branch name required';
        return git(`checkout -b ${args.name}`);
      case 'switch':
        if (!args.name) return 'Error: Branch name required';
        return git(`checkout ${args.name}`);
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
  async execute(args) {
    switch (args.action) {
      case 'save':
        return git(`stash push -m "${args.message || 'yam-agent stash'}"`);
      case 'pop':
        return git('stash pop');
      case 'list':
        return git('stash list') || '(no stashes)';
      default:
        return `Unknown action: ${args.action}`;
    }
  },
};
