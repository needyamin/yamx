/**
 * Persistent multi-session chat storage under ~/.yamx/sessions/
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { randomUUID } from 'node:crypto';
import type { Message } from './providers/base.js';

export interface ChatSession {
  id: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

const STATE_VERSION = 1;

interface AppState {
  version: number;
  activeSessionId: string | null;
}

export class SessionStore {
  private root: string;
  private sessionsDir: string;
  private statePath: string;

  constructor() {
    this.root = path.join(os.homedir(), '.yamx');
    this.sessionsDir = path.join(this.root, 'sessions');
    this.statePath = path.join(this.root, 'state.json');
  }

  async init(): Promise<void> {
    await fs.ensureDir(this.sessionsDir);
  }

  private async readState(): Promise<AppState> {
    try {
      if (await fs.pathExists(this.statePath)) {
        const s = await fs.readJSON(this.statePath);
        return {
          version: s.version ?? STATE_VERSION,
          activeSessionId: s.activeSessionId ?? null,
        };
      }
    } catch {
      /* ignore */
    }
    return { version: STATE_VERSION, activeSessionId: null };
  }

  private async writeState(state: AppState): Promise<void> {
    await fs.ensureDir(this.root);
    await fs.writeJSON(this.statePath, { ...state, version: STATE_VERSION }, { spaces: 2 });
  }

  async getActiveSessionId(): Promise<string | null> {
    return (await this.readState()).activeSessionId;
  }

  async setActiveSessionId(id: string | null): Promise<void> {
    const s = await this.readState();
    s.activeSessionId = id;
    await this.writeState(s);
  }

  sessionPath(id: string): string {
    return path.join(this.sessionsDir, `${id}.json`);
  }

  async createSession(cwd: string, systemMessage: Message, opts?: { activate?: boolean }): Promise<ChatSession> {
    await this.init();
    const id = randomUUID();
    const now = new Date().toISOString();
    const session: ChatSession = {
      id,
      title: 'New chat',
      cwd,
      createdAt: now,
      updatedAt: now,
      messages: [systemMessage],
    };
    await this.saveSession(session);
    if (opts?.activate !== false) {
      await this.setActiveSessionId(id);
    }
    return session;
  }

  async loadSession(id: string): Promise<ChatSession | null> {
    const p = this.sessionPath(id);
    if (!(await fs.pathExists(p))) return null;
    try {
      return await fs.readJSON(p) as ChatSession;
    } catch {
      return null;
    }
  }

  async saveSession(session: ChatSession): Promise<void> {
    await this.init();
    session.updatedAt = new Date().toISOString();
    await fs.writeJSON(this.sessionPath(session.id), session, { spaces: 0 });
  }

  async deleteSession(id: string): Promise<boolean> {
    const p = this.sessionPath(id);
    if (!(await fs.pathExists(p))) return false;
    await fs.remove(p);
    const state = await this.readState();
    if (state.activeSessionId === id) {
      state.activeSessionId = null;
      await this.writeState(state);
    }
    return true;
  }

  async listSessions(): Promise<ChatSession[]> {
    await this.init();
    const files = await fs.readdir(this.sessionsDir).catch(() => [] as string[]);
    const out: ChatSession[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.replace(/\.json$/, '');
      const s = await this.loadSession(id);
      if (s) out.push(s);
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return out;
  }

  /** Promote first user line to title */
  updateTitleFromFirstMessage(session: ChatSession): void {
    const firstUser = session.messages.find((m) => m.role === 'user' && m.content?.trim());
    if (firstUser?.content) {
      const t = firstUser.content.trim().replace(/\s+/g, ' ');
      session.title = t.length > 48 ? `${t.slice(0, 45)}…` : t;
    }
  }
}
