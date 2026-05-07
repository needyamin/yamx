/**
 * YamX — shell execution (cross-platform: bash/sh, Windows cmd)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { Tool } from './registry.js';

const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)/i,
  /rmdir\s+(\/s|\/q|\s+\/s)/i,
  /\bdel(\s+\/f|\s+\/s|\s+\\\\)/i,
  /format\s+/i,
  /mkfs/i,
  /dd\s+/i,
  />\s*\/dev\//i,
  /chmod\s+777/i,
  /curl.*\|\s*(ba)?sh/i,
  /wget.*\|\s*(ba)?sh/i,
  /npm\s+publish/i,
  /git\s+push\s+.*--force/i,
  /git\s+reset\s+--hard/i,
  /drop\s+database/i,
  /drop\s+table/i,
  /truncate\s+table/i,
  /sudo\s+/i,
  /systemctl\s+/i,
  /apt(-get)?\s+/i,
  /dnf\s+/i,
  /yum\s+/i,
  /pacman\s+/i,
];

const MAX_CHARS = 100_000;
const TIMEOUT_MS = 120_000;

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<{ text: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      env: process.env,
      windowsHide: true,
    });

    let out = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        child.kill();
      }
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      out += c;
    });
    child.stderr?.on('data', (c: string) => {
      out += c;
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ text: out.trim(), code });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ text: `Spawn error: ${err.message}`, code: 1 });
    });
  });
}

export const runCommand: Tool = {
  definition: {
    name: 'run_command',
    description: `Run a shell command in the project directory. Works on Windows (cmd) and Unix. Use for installs, tests, git, build, system tasks.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Full command line (e.g. npm test, dir, ./script.sh)' },
        cwd: { type: 'string', description: 'Subdirectory relative to cwd (default ".")' },
      },
      required: ['command'],
    },
  },
  needsApproval: true,
  isDangerous(args) {
    return DANGEROUS_PATTERNS.some((p) => p.test(args.command));
  },
  async execute(args: { command: string; cwd?: string }) {
    const cwd = args.cwd ? path.resolve(process.cwd(), args.cwd) : process.cwd();
    const { text, code } = await runShell(args.command, cwd, TIMEOUT_MS);

    let body = text;
    if (code !== 0 && code !== null) {
      body = body ? `${body}\n(exit ${code})` : `(exit ${code})`;
    }
    if (!body) body = code === 0 ? '(no output)' : `(exit ${code}, no output)`;

    if (body.length > MAX_CHARS) {
      return `[Truncated]\n${body.slice(0, MAX_CHARS)}\n…${body.length - MAX_CHARS} more chars`;
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
        cwd: { type: 'string', description: 'Working directory (default ".")' },
      },
      required: ['command'],
    },
  },
  needsApproval: true,
  async execute(args: { command: string; cwd?: string }) {
    const cwd = args.cwd ? path.resolve(process.cwd(), args.cwd) : process.cwd();
    const child = spawn(args.command, {
      shell: true,
      cwd,
      env: process.env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return `Background PID ${child.pid}\n${args.command}`;
  },
};
