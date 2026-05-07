/**
 * YamX - shell execution tools.
 */

import { Tool } from './registry.js';
import { ensureInsideProject, getShellDiagnostics, getSmartShell, runProcess } from './utils.js';
import { TaskManager } from '../tasks.js';
import { isDangerousShellCommand } from '../tool-risk.js';

const DEFAULT_MAX_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export const runCommand: Tool = {
  definition: {
    name: 'run_command',
    description:
      'Run a shell command in the project directory. In auto mode, YamX chooses cmd, PowerShell, pwsh, bash, or sh from command syntax and platform.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Full command line, e.g. npm test, dir, ls -la, ./script.sh' },
        cwd: { type: 'string', description: 'Subdirectory relative to project root (default ".")' },
        shell: { type: 'string', description: 'Shell to use: auto, cmd, powershell, pwsh, bash, or sh (default auto)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 120000, max 600000)' },
        max_chars: { type: 'number', description: 'Maximum output characters (default 100000, max 500000)' },
      },
      required: ['command'],
    },
  },
  needsApproval: true,
  isDangerous(args) {
    return typeof args.command === 'string' && isDangerousShellCommand(args.command);
  },
  async execute(args: { command: string; cwd?: string; shell?: string; timeout_ms?: number; max_chars?: number }) {
    if (!args.command?.trim()) return 'Error: command is required.';

    const cwd = ensureInsideProject(args.cwd || '.');
    if (!cwd.ok) return cwd.error;

    const smart = getSmartShell(args.command, args.shell);
    const timeoutMs = boundedNumber(args.timeout_ms, DEFAULT_TIMEOUT_MS, 1000, 600_000);
    const maxChars = boundedNumber(args.max_chars, DEFAULT_MAX_CHARS, 1000, 500_000);
    const { text, code, timedOut } = await runProcess(smart.shell.command, [...smart.shell.args, smart.command], {
      cwd: cwd.path,
      timeoutMs,
      maxChars,
    });

    let body = text;
    if (timedOut) body = body ? `${body}\n(timed out after ${timeoutMs}ms)` : `(timed out after ${timeoutMs}ms)`;
    if (code !== 0 && code !== null) body = body ? `${body}\n(exit ${code})` : `(exit ${code})`;
    if (!body) body = code === 0 ? '(no output)' : `(exit ${code}, no output)`;
    if (code !== 0 || timedOut) {
      body += `\n(shell: ${smart.shell.label}; ${smart.reason}; executed: ${smart.command})`;
    }
    return body;
  },
};

export const runCommandBackground: Tool = {
  definition: {
    name: 'run_command_background',
    description: 'Start a long-running command in the background (dev server, watch).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        cwd: { type: 'string', description: 'Working directory relative to project root (default ".")' },
        shell: { type: 'string', description: 'Shell to use: auto, cmd, powershell, pwsh, bash, or sh (default auto)' },
      },
      required: ['command'],
    },
  },
  needsApproval: true,
  isDangerous(args) {
    return typeof args.command === 'string' && isDangerousShellCommand(args.command);
  },
  async execute(args: { command: string; cwd?: string; shell?: string }) {
    if (!args.command?.trim()) return 'Error: command is required.';

    const cwd = ensureInsideProject(args.cwd || '.');
    if (!cwd.ok) return cwd.error;

    const smart = getSmartShell(args.command, args.shell);
    return new TaskManager().start({
      command: smart.command,
      cwd: cwd.path,
      shell: smart.shell.label,
      reason: smart.reason,
    });
  },
};

export const shellDiagnostics: Tool = {
  definition: {
    name: 'shell_diagnostics',
    description: 'Show YamX shell detection details for cross-platform command execution.',
    parameters: { type: 'object', properties: {} },
  },
  async execute() {
    return getShellDiagnostics();
  },
};

export const taskList: Tool = {
  definition: {
    name: 'task_list',
    description: 'List YamX-managed background tasks.',
    parameters: { type: 'object', properties: {} },
  },
  async execute() {
    return new TaskManager().formatList();
  },
};

export const taskTail: Tool = {
  definition: {
    name: 'task_tail',
    description: 'Show recent output from a YamX-managed background task.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id or unique prefix' },
        chars: { type: 'number', description: 'Maximum characters to show (default 4000)' },
      },
      required: ['id'],
    },
  },
  async execute(args: { id: string; chars?: number }) {
    return new TaskManager().tail(args.id, args.chars || 4000);
  },
};

export const taskStop: Tool = {
  definition: {
    name: 'task_stop',
    description: 'Stop a YamX-managed background task by id or unique prefix.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id or unique prefix' },
      },
      required: ['id'],
    },
  },
  needsApproval: true,
  async execute(args: { id: string }) {
    return new TaskManager().stop(args.id);
  },
};
