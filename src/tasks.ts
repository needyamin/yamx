import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { getShell, truncateOutput } from './tools/utils.js';

export interface TaskRecord {
  id: string;
  command: string;
  cwd: string;
  shell: string;
  pid?: number;
  status: 'running' | 'exited' | 'failed' | 'stopped';
  exitCode?: number | null;
  startedAt: string;
  updatedAt: string;
  logPath: string;
  error?: string;
}

export class TaskManager {
  private root = path.join(os.homedir(), '.yamx', 'tasks');

  async start(args: { command: string; cwd: string; shell?: string; reason?: string }): Promise<string> {
    await fs.ensureDir(this.root);
    const id = randomUUID().slice(0, 12);
    const selectedShell = getShell(args.shell);
    const logPath = path.join(this.root, `${id}.log`);
    const now = new Date().toISOString();
    const record: TaskRecord = {
      id,
      command: args.command,
      cwd: args.cwd,
      shell: selectedShell.label,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      logPath,
    };

    try {
      const fd = openSync(logPath, 'a');
      const child = spawn(selectedShell.command, [...selectedShell.args, args.command], {
        cwd: args.cwd,
        env: process.env,
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
      });
      record.pid = child.pid;
      child.unref();
      await this.save(record);
      closeSync(fd);
      return `Task ${id} started (pid ${child.pid}, ${selectedShell.label})${args.reason ? `\n${args.reason}` : ''}\n${args.command}`;
    } catch (error: any) {
      record.status = 'failed';
      record.error = error.message;
      await this.save(record);
      return `Task ${id} failed to start: ${error.message}`;
    }
  }

  async list(): Promise<TaskRecord[]> {
    await fs.ensureDir(this.root);
    const files = await fs.readdir(this.root).catch(() => [] as string[]);
    const records: TaskRecord[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        records.push(await fs.readJSON(path.join(this.root, file)) as TaskRecord);
      } catch {
        // skip malformed task record
      }
    }
    return records.sort((a, b) => a.startedAt < b.startedAt ? 1 : -1);
  }

  async formatList(): Promise<string> {
    const tasks = await this.list();
    if (tasks.length === 0) return 'No background tasks.';
    return tasks.map((task) => [
      `${task.id}  ${task.status}  pid=${task.pid ?? '-'}  shell=${task.shell}`,
      `  cwd: ${task.cwd}`,
      `  cmd: ${task.command}`,
      task.error ? `  error: ${task.error}` : '',
    ].filter(Boolean).join('\n')).join('\n\n');
  }

  async tail(id: string, chars = 4000): Promise<string> {
    const task = await this.load(id);
    if (!task) return `Error: No task matching ${id}`;
    if (!await fs.pathExists(task.logPath)) return `(no log output yet for ${task.id})`;
    const content = await fs.readFile(task.logPath, 'utf-8');
    return truncateOutput(content.slice(-Math.max(100, Math.min(chars, 40_000))).trim() || '(no output)', chars);
  }

  async stop(id: string): Promise<string> {
    const task = await this.load(id);
    if (!task) return `Error: No task matching ${id}`;
    if (!task.pid) return `Task ${task.id} has no pid.`;
    try {
      process.kill(task.pid);
      task.status = 'stopped';
      task.updatedAt = new Date().toISOString();
      await this.save(task);
      return `Stopped task ${task.id} (pid ${task.pid})`;
    } catch (error: any) {
      return `Error stopping task ${task.id}: ${error.message}`;
    }
  }

  private async load(id: string): Promise<TaskRecord | null> {
    const tasks = await this.list();
    const matches = tasks.filter((task) => task.id === id || task.id.startsWith(id));
    return matches.length === 1 ? matches[0] : null;
  }

  private async save(record: TaskRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await fs.ensureDir(this.root);
    await fs.writeJSON(path.join(this.root, `${record.id}.json`), record, { spaces: 2 });
  }
}
