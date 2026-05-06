/**
 * Yam Agent - Shell & Command Execution Tools
 * Run commands with safety checks and interactive approval.
 */

import { execSync, spawn } from 'child_process';
import { Tool } from './registry.js';

/** Dangerous command patterns that always require approval */
const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)/i,
  /del\s+/i,
  /rmdir\s+/i,
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
];

export const runCommand: Tool = {
  definition: {
    name: 'run_command',
    description: `Execute a shell command and return the output. Use this for: running tests, installing packages, building projects, checking git status, running linters, etc.
Commands run in the project root directory. Timeout is 60 seconds.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (relative to project root, default: ".")' },
      },
      required: ['command'],
    },
  },
  needsApproval: true,
  isDangerous(args) {
    return DANGEROUS_PATTERNS.some(p => p.test(args.command));
  },
  async execute(args) {
    try {
      const cwd = args.cwd
        ? require('path').resolve(process.cwd(), args.cwd)
        : process.cwd();

      const output = execSync(args.command, {
        encoding: 'utf-8',
        cwd,
        timeout: 60000,
        maxBuffer: 1024 * 1024 * 5, // 5MB
        env: { ...process.env },
      });

      const trimmed = output.trim();
      if (trimmed.length > 10000) {
        return `[Output truncated to 10000 chars]\n${trimmed.slice(0, 10000)}\n...[${trimmed.length - 10000} more chars]`;
      }
      return trimmed || '(command completed with no output)';
    } catch (error: any) {
      const stdout = error.stdout?.toString() || '';
      const stderr = error.stderr?.toString() || '';
      return `Command failed (exit code ${error.status || 'unknown'}):\n${stderr || stdout || error.message}`.slice(0, 10000);
    }
  },
};

export const runCommandBackground: Tool = {
  definition: {
    name: 'run_command_background',
    description: 'Start a long-running command in the background (e.g., dev server). Returns immediately with process info.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to run in background' },
        cwd: { type: 'string', description: 'Working directory (default: ".")' },
      },
      required: ['command'],
    },
  },
  needsApproval: true,
  async execute(args) {
    const parts = args.command.split(/\s+/);
    const proc = spawn(parts[0], parts.slice(1), {
      cwd: args.cwd || process.cwd(),
      stdio: 'ignore',
      detached: true,
      shell: true,
    });
    proc.unref();

    return `Started background process: PID ${proc.pid}\nCommand: ${args.command}`;
  },
};
