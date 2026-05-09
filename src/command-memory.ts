import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_ROOT } from './tools/utils.js';

interface CommandRecord {
  command: string;
  cwd: string;
  runs: number;
  successes: number;
  failures: number;
  lastExit: number | null;
  lastRunAt: string;
  lastSignal: string;
}

interface CommandMemoryFile {
  version: 1;
  projects: Record<string, CommandRecord[]>;
}

const MEMORY_PATH = path.join(os.homedir(), '.yamx', 'command-memory.json');
const MAX_PROJECT_RECORDS = 160;

export function commandMemoryPath(): string {
  return MEMORY_PATH;
}

export async function recordCommandRun(args: {
  command: string;
  cwd: string;
  code: number | null;
  timedOut?: boolean;
  output?: string;
}): Promise<void> {
  const command = normalizeCommand(args.command);
  if (!command || shouldSkipCommand(command)) return;

  const file = await readMemoryFile();
  const projectKey = PROJECT_ROOT;
  const relCwd = relativeProjectPath(args.cwd);
  const records = file.projects[projectKey] || [];
  const existing = records.find((record) => record.command === command && record.cwd === relCwd);
  const success = args.code === 0 && !args.timedOut;
  const signal = extractSignal(args.output || '', args.timedOut);

  if (existing) {
    existing.runs += 1;
    existing.successes += success ? 1 : 0;
    existing.failures += success ? 0 : 1;
    existing.lastExit = args.code;
    existing.lastRunAt = new Date().toISOString();
    existing.lastSignal = signal;
  } else {
    records.push({
      command,
      cwd: relCwd,
      runs: 1,
      successes: success ? 1 : 0,
      failures: success ? 0 : 1,
      lastExit: args.code,
      lastRunAt: new Date().toISOString(),
      lastSignal: signal,
    });
  }

  file.projects[projectKey] = records
    .sort((a, b) => Date.parse(b.lastRunAt) - Date.parse(a.lastRunAt))
    .slice(0, MAX_PROJECT_RECORDS);
  await writeMemoryFile(file);
}

export async function formatCommandMemoryForPrompt(cwd: string, limit = 14): Promise<string> {
  const file = await readMemoryFile();
  const records = file.projects[PROJECT_ROOT] || [];
  if (records.length === 0) return '(no command memory for this project yet)';

  const rel = relativeProjectPath(cwd);
  const focused = records
    .filter((record) => record.cwd === rel || record.cwd === '.')
    .slice(0, limit);
  const list = focused.length ? focused : records.slice(0, limit);

  return list.map((record) => {
    const mark = record.lastExit === 0 ? 'ok' : `fail:${record.lastExit ?? '?'}`;
    const signal = record.lastSignal ? ` | ${record.lastSignal}` : '';
    return `- [${mark}] cwd=${record.cwd} runs=${record.runs} ok=${record.successes} fail=${record.failures} :: ${record.command}${signal}`;
  }).join('\n');
}

async function readMemoryFile(): Promise<CommandMemoryFile> {
  try {
    const data = await fs.readJSON(MEMORY_PATH);
    if (data?.version === 1 && data.projects && typeof data.projects === 'object') {
      return data as CommandMemoryFile;
    }
  } catch {
    // Fresh file.
  }
  return { version: 1, projects: {} };
}

async function writeMemoryFile(file: CommandMemoryFile): Promise<void> {
  await fs.ensureDir(path.dirname(MEMORY_PATH));
  await fs.writeJSON(MEMORY_PATH, file, { spaces: 2 });
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ').slice(0, 700);
}

function shouldSkipCommand(command: string): boolean {
  return /\b(token|secret|password|passwd|apikey|api_key|authorization)\b/i.test(command)
    || /^echo\s+.+(=|:)/i.test(command);
}

function relativeProjectPath(cwd: string): string {
  const rel = path.relative(PROJECT_ROOT, path.resolve(cwd));
  return rel || '.';
}

function extractSignal(output: string, timedOut?: boolean): string {
  if (timedOut) return 'timed out';
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const signal = lines.find((line) =>
    /(error|exception|fatal|failed|failure|traceback|typeerror|syntaxerror|referenceerror|not recognized|command not found|no such file|cannot find)/i.test(line)
  ) || lines[0] || '';
  return signal.replace(/\s+/g, ' ').slice(0, 260);
}
