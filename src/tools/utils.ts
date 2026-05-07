import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const PROJECT_ROOT = path.resolve(process.cwd());

export function resolveProjectPath(inputPath = '.'): string {
  return path.resolve(PROJECT_ROOT, inputPath);
}

export function isWithinProjectPath(resolvedPath: string): boolean {
  const relative = path.relative(PROJECT_ROOT, resolvedPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function ensureInsideProject(inputPath = '.'): { ok: true; path: string } | { ok: false; error: string } {
  const resolved = resolveProjectPath(inputPath);
  if (!isWithinProjectPath(resolved)) {
    return { ok: false, error: 'Error: Path outside project directory.' };
  }
  return { ok: true, path: resolved };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `[Truncated]\n${text.slice(0, maxChars)}\n...${text.length - maxChars} more chars`;
}

export interface ShellSpec {
  command: string;
  args: string[];
  label: string;
}

export interface SmartShellCommand {
  shell: ShellSpec;
  command: string;
  reason: string;
}

export function getDefaultShell(): ShellSpec {
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec || 'cmd.exe';
    return { command: shell, args: ['/d', '/s', '/c'], label: 'cmd' };
  }

  const shell = process.env.SHELL || (os.platform() === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return { command: shell, args: ['-lc'], label: path.basename(shell) };
}

export function getShell(shellName?: string): ShellSpec {
  const normalized = shellName?.trim().toLowerCase();
  if (!normalized || normalized === 'auto' || normalized === 'default') {
    return getDefaultShell();
  }

  switch (normalized) {
    case 'cmd':
    case 'cmd.exe':
      return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c'], label: 'cmd' };
    case 'powershell':
    case 'powershell.exe':
      return {
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'],
        label: 'powershell',
      };
    case 'pwsh':
      return { command: 'pwsh', args: ['-NoLogo', '-NoProfile', '-Command'], label: 'pwsh' };
    case 'bash':
      return { command: 'bash', args: ['-lc'], label: 'bash' };
    case 'sh':
      return { command: 'sh', args: ['-lc'], label: 'sh' };
    default:
      return getDefaultShell();
  }
}

export function getSmartShell(command: string, shellName?: string): SmartShellCommand {
  const requested = shellName?.trim().toLowerCase();
  if (requested && requested !== 'auto' && requested !== 'default') {
    const shell = getShell(requested);
    return {
      shell,
      command: normalizeCommandForShell(command, shell.label),
      reason: `explicit shell: ${shell.label}`,
    };
  }

  if (process.platform !== 'win32') {
    const shell = getDefaultShell();
    return { shell, command, reason: `default shell: ${shell.label}` };
  }

  if (looksLikePowerShell(command)) {
    const shell = shellAvailable('pwsh') ? getShell('pwsh') : getShell('powershell');
    return { shell, command: normalizeCommandForShell(command, shell.label), reason: 'PowerShell syntax detected' };
  }

  if (looksLikeUnixShell(command) && shellAvailable('bash')) {
    const shell = getShell('bash');
    return { shell, command, reason: 'Unix shell syntax detected and bash is available' };
  }

  const shell = getShell('cmd');
  return {
    shell,
    command: normalizeCommandForShell(command, shell.label),
    reason: looksLikeUnixShell(command)
      ? 'Unix-like command translated for cmd because bash was not detected'
      : 'Windows cmd default',
  };
}

export function getShellDiagnostics(): string {
  const rows = [
    ['platform', `${process.platform} ${process.arch}`],
    ['default', getDefaultShell().label],
    ['cmd', process.platform === 'win32' ? String(shellAvailable('cmd')) : 'n/a'],
    ['powershell', process.platform === 'win32' ? String(shellAvailable('powershell')) : 'n/a'],
    ['pwsh', String(shellAvailable('pwsh'))],
    ['bash', String(shellAvailable('bash'))],
    ['sh', process.platform === 'win32' ? String(shellAvailable('sh')) : String(shellAvailable('sh'))],
  ];
  return rows.map(([k, v]) => `${k.padEnd(12)} ${v}`).join('\n');
}

function normalizeCommandForShell(command: string, shellLabel: string): string {
  let out = command.trim();
  if (process.platform === 'win32' && ['cmd', 'powershell', 'pwsh'].includes(shellLabel)) {
    out = normalizePackageBinsForWindows(out);
    if (shellLabel === 'cmd') out = translateSimpleUnixInspectionForCmd(out);
  }
  return out;
}

function normalizePackageBinsForWindows(command: string): string {
  return command.replace(/^(\s*)(npm|npx|pnpm|yarn|bun)(?=\s|$)/i, (_m, lead, bin) => {
    const lower = String(bin).toLowerCase();
    return `${lead}${lower}.cmd`;
  });
}

function translateSimpleUnixInspectionForCmd(command: string): string {
  const c = command.trim();
  if (/^pwd\s*$/i.test(c)) return 'cd';
  if (/^ls(\s+(-la|-al|-l|-a))?\s*$/i.test(c)) return 'dir';
  if (/^ll\s*$/i.test(c) || /^la\s*$/i.test(c)) return 'dir';
  if (/^cat\s+([^\s|&<>]+)\s*$/i.test(c)) return `type ${c.replace(/^cat\s+/i, '')}`;
  if (/^touch\s+([^\s|&<>]+)\s*$/i.test(c)) return `copy /b NUL ${c.replace(/^touch\s+/i, '')}`;
  if (/^rm\s+([^\s|&<>]+)\s*$/i.test(c)) return `del ${c.replace(/^rm\s+/i, '')}`;
  if (/^cp\s+([^\s|&<>]+)\s+([^\s|&<>]+)\s*$/i.test(c)) return c.replace(/^cp\s+/i, 'copy ');
  if (/^mv\s+([^\s|&<>]+)\s+([^\s|&<>]+)\s*$/i.test(c)) return c.replace(/^mv\s+/i, 'move ');
  if (/^clear\s*$/i.test(c)) return 'cls';
  return command;
}

function looksLikePowerShell(command: string): boolean {
  return /\b(Get-ChildItem|Select-String|Set-Location|Test-Path|New-Item|Remove-Item|Copy-Item|Move-Item|Rename-Item|Get-Content|Set-Content|Start-Process|Stop-Process|Get-Process|Get-Service|Set-ExecutionPolicy|Invoke-WebRequest|Invoke-RestMethod)\b/i.test(command)
    || /\$env:/i.test(command)
    || /\b-(Recursive|Recurse|LiteralPath|ExecutionPolicy|NoProfile|NoLogo|Command)\b/i.test(command);
}

function looksLikeUnixShell(command: string): boolean {
  return /^\s*(export|source|sudo|chmod|chown|grep|sed|awk|cat|ls|ll|la|pwd|touch|mkdir\s+-p|rm\s+-|cp\s+-|mv\s+-|find\s+.*\s-name|brew|apt|apt-get|dnf|yum|pacman|zypper|systemctl|journalctl|open)\b/i.test(command)
    || /^\s*(\.\/|~\/|bash\s+|sh\s+|zsh\s+|fish\s+)/i.test(command)
    || /\$\(|`[^`]+`|\${[^}]+}/.test(command)
    || /\|\s*(grep|sed|awk|xargs|tee|head|tail|sort|uniq|wc|cut|tr)\b/i.test(command)
    || /\s(2>|1>|>>|<)\s*\S+/.test(command);
}

function shellAvailable(shellName: string): boolean {
  try {
    if (process.platform === 'win32') {
      const target = shellName === 'cmd' ? 'cmd.exe' : shellName === 'powershell' ? 'powershell.exe' : shellName;
      const result = spawnSync('where.exe', [target], { stdio: 'ignore', windowsHide: true });
      return result.status === 0;
    }
    const result = spawnSync('command', ['-v', shellName], { shell: true, stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function runProcess(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    maxChars?: number;
    env?: NodeJS.ProcessEnv;
  } = {}
): Promise<{ text: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const maxChars = options.maxChars ?? 100_000;
    let child;
    try {
      child = spawn(file, args, {
        cwd: options.cwd ?? PROJECT_ROOT,
        env: { ...process.env, ...options.env },
        windowsHide: true,
      });
    } catch (err: any) {
      resolve({ text: `Spawn error: ${err.message}`, code: 1, timedOut: false });
      return;
    }

    let out = '';
    let timedOut = false;
    let settled = false;

    const append = (chunk: string) => {
      if (out.length < maxChars + 1024) out += chunk;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
      } catch {
        child.kill();
      }
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ text: truncateOutput(out.trim(), maxChars), code, timedOut });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ text: `Spawn error: ${err.message}`, code: 1, timedOut });
    });
  });
}
