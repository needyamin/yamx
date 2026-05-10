import { spawn } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { getShell, truncateOutput, killProcessTreeBestEffort } from './tools/utils.js';

export type HookEvent =
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop'
  | 'PreCompact'
  | 'SessionStart'
  | 'SessionEnd';

interface HookCommand {
  type?: 'command';
  command: string;
  timeout?: number;
  shell?: string;
}

interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
}

interface HookConfig {
  hooks?: Partial<Record<HookEvent, HookMatcher[]>>;
}

export interface HookResult {
  blocked: boolean;
  output: string;
  errors: string[];
}

export class HookManager {
  private cwd: string;

  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  async run(event: HookEvent, payload: Record<string, unknown>, toolName?: string): Promise<HookResult> {
    const config = await this.loadConfig();
    const matchers = config.hooks?.[event] || [];
    const selected = matchers.flatMap((entry) => {
      if (!this.matches(entry.matcher, toolName)) return [];
      return entry.hooks || [];
    });

    const outputs: string[] = [];
    const errors: string[] = [];
    let blocked = false;

    for (const hook of selected) {
      if (!hook.command?.trim()) continue;
      const result = await this.runCommand(hook, { hook_event_name: event, cwd: this.cwd, ...payload });
      if (result.text) outputs.push(result.text);
      if (result.code === 2) {
        blocked = true;
        errors.push(result.text || `Hook blocked ${event}: ${hook.command}`);
      } else if (result.code && result.code !== 0) {
        errors.push(result.text || `Hook failed (${result.code}): ${hook.command}`);
      }
    }

    return {
      blocked,
      output: outputs.join('\n').trim(),
      errors,
    };
  }

  private async loadConfig(): Promise<HookConfig> {
    const files = [
      path.join(os.homedir(), '.yamx', 'settings.json'),
      path.join(this.cwd, '.yamx', 'settings.json'),
      path.join(this.cwd, '.yamx', 'settings.local.json'),
    ];

    const merged: HookConfig = { hooks: {} };
    for (const file of files) {
      if (!await fs.pathExists(file)) continue;
      try {
        const data = await fs.readJSON(file) as HookConfig;
        for (const [event, entries] of Object.entries(data.hooks || {})) {
          const key = event as HookEvent;
          merged.hooks![key] = [...(merged.hooks![key] || []), ...(entries || [])];
        }
      } catch {
        // Ignore malformed hook config; diagnostics can surface this later.
      }
    }
    return merged;
  }

  private matches(matcher: string | undefined, toolName: string | undefined): boolean {
    if (!toolName) return !matcher || matcher === '*';
    if (!matcher || matcher === '*') return true;
    if (matcher === toolName) return true;
    try {
      return new RegExp(matcher).test(toolName);
    } catch {
      return false;
    }
  }

  private runCommand(
    hook: HookCommand,
    payload: Record<string, unknown>
  ): Promise<{ text: string; code: number | null }> {
    return new Promise((resolve) => {
      const timeoutMs = Math.max(1000, Math.min((hook.timeout || 60) * 1000, 300_000));
      const shell = getShell(hook.shell);
      let child;
      try {
        child = spawn(shell.command, [...shell.args, hook.command], {
          cwd: this.cwd,
          env: { ...process.env, YAMX_PROJECT_DIR: this.cwd },
          windowsHide: true,
        });
      } catch (error: any) {
        resolve({ text: `Hook spawn error: ${error.message}`, code: 1 });
        return;
      }

      let out = '';
      let settled = false;
      const append = (chunk: string) => {
        if (out.length < 40_000) out += chunk;
      };

      const timer = setTimeout(() => {
        try {
          killProcessTreeBestEffort(child);
        } catch {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
        }
      }, timeoutMs);

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.stdin?.end(JSON.stringify(payload));

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ text: truncateOutput(out.trim(), 40_000), code });
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ text: `Hook error: ${error.message}`, code: 1 });
      });
    });
  }
}
