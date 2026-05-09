/**
 * YamX - shell execution tools.
 */

import { Tool } from './registry.js';
import { ensureInsideProject, getShellDiagnostics, getSmartShell, runProcess } from './utils.js';
import { TaskManager } from '../tasks.js';
import { isDangerousShellCommand } from '../tool-risk.js';

const DEFAULT_MAX_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Reject obvious English intent passed as a shell line (e.g. "install python").
 * Real CLIs put the program first: winget install …, pip install …, py -0, etc.
 */
function rejectNaturalLanguagePseudoCommand(command: string): string | null {
  const t = command.trim();
  if (!t) return null;
  if (/[|&;<>]/.test(t)) return null;
  if (/^["'].*["']$/.test(t) && t.split(/\s+/).length === 1) return null;

  const words = t.split(/\s+/).filter(Boolean);
  /** English "verb + target" mistakes are typically 2–3 tokens; skip longer lines (posix `install`, scripts). */
  if (words.length < 2 || words.length > 3) return null;

  const first = words[0].toLowerCase();
  const naiveVerbs = new Set([
    'install',
    'uninstall',
    'setup',
    'configure',
    'upgrade',
    'update',
    'download',
    'get',
    'want',
    'need',
  ]);
  if (!naiveVerbs.has(first)) return null;

  const rest = words.slice(1);
  if (rest.some((w) => /^-/.test(w) || /[/\\]/.test(w) || /^["']/.test(w))) return null;

  const os = process.platform === 'win32' ? 'Windows' : process.platform;
  return (
    `Error: Not a valid shell command: ${JSON.stringify(t)}\n` +
    `You passed plain English ("${t}") to run_command. The first token must be a real program (winget, choco, scoop, py, python, pip, brew, apt, …), not a verb like "${first}".\n` +
    `Examples (${os}): check \`py -0\` / \`python --version\`; install with \`winget search Python\` then \`winget install Python.Python.3.12\`, or python.org installer; use \`pip install <pkg>\` only after Python works.\n` +
    `Fix the command and retry — do not repeat this exact phrase.`
  );
}

/** True when the phrase should be routed through model-assisted normalization before executing. */
export function isPseudoEnglishShellIntent(command: string): boolean {
  return rejectNaturalLanguagePseudoCommand(command) !== null;
}

/** Guidance when normalization fails (same body as execution guard returns). */
export function pseudoShellAdviceMessage(command: string): string | null {
  return rejectNaturalLanguagePseudoCommand(command);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export const runCommand: Tool = {
  definition: {
    name: 'run_command',
    description:
      'Execute one shell line in the project cwd. System/runtime tooling (Python, Node, Docker, …): YamX prompts require PATH/version probes first, then installers if missing. YamX may normalize one mistaken English-shaped line via the backend before executing.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'Executable-first: where/python --version BEFORE winget/apt install … for system installs. Prefer npm/cmd/pnpm per project docs for repo deps.',
        },
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

    const pseudoErr = rejectNaturalLanguagePseudoCommand(args.command);
    if (pseudoErr) return pseudoErr;

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
        command: {
          type: 'string',
          description:
            'Executable-first shell line (same rules as run_command): e.g. npm run dev, not bare English like "install python".',
        },
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

    const pseudoErr = rejectNaturalLanguagePseudoCommand(args.command);
    if (pseudoErr) return pseudoErr;

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
