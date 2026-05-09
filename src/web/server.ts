import http from 'node:http';
import type { AddressInfo } from 'node:net';
import stripAnsi from 'strip-ansi';
import { Agent } from '../agent.js';
import { Config, type YamConfig } from '../config/index.js';
import { ContextEngine } from '../context.js';
import { SessionStore, type ChatSession } from '../session-store.js';
import type { Provider } from '../providers/base.js';
import { createProvider } from '../providers/factory.js';
import {
  changeWorkspaceDirectory,
  ensureInsideProject,
  getSmartShell,
  getWorkspaceCwd,
  getWorkspaceRelativeCwd,
  PROJECT_ROOT,
  runProcess,
} from '../tools/utils.js';
import { classifyShellCommand } from '../tool-risk.js';
import { pseudoShellAdviceMessage } from '../tools/shell.js';
import { recordCommandRun } from '../command-memory.js';
import { parseDirectCommand } from '../direct-command.js';
import { classifyUserIntent } from '../intent.js';
import { WEB_CSS, WEB_HTML, WEB_JS } from './ui.js';

export interface WebServerOptions {
  host?: string;
  port?: number;
  allowDangerous?: boolean;
  providerName?: string;
  modelName?: string;
  providerOverride?: Provider;
}

export interface WebCommandOptions {
  command: string;
  cwd?: string;
  shell?: string;
  timeoutMs?: number;
  maxChars?: number;
  allowDangerous?: boolean;
}

export interface WebCommandResult {
  ok: boolean;
  blocked: boolean;
  kind?: 'command' | 'chat';
  command: string;
  executedCommand?: string;
  output: string;
  code: number | null;
  timedOut: boolean;
  durationMs: number;
  shell?: string;
  reason?: string;
  risk?: string;
  cwd: string;
  allowDangerous: boolean;
  provider?: string;
  model?: string;
  sessionId?: string;
}

export interface RunningWebServer {
  server: http.Server;
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

const DEFAULT_PORT = 8765;
const DEFAULT_HOST = '127.0.0.1';

export async function startYamxWebServer(options: WebServerOptions = {}): Promise<RunningWebServer> {
  const host = options.host || DEFAULT_HOST;
  const port = normalizePort(options.port, DEFAULT_PORT);
  const allowDangerous = options.allowDangerous === true;
  const runtime = new WebAgentRuntime(options);

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, { allowDangerous, runtime });
    } catch (error: any) {
      sendJson(res, 500, { error: error?.message || 'Internal server error' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const actualPort = address?.port || port;
  return {
    server,
    host,
    port: actualPort,
    url: `http://${formatHostForUrl(host)}:${actualPort}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export async function executeWebCommand(options: WebCommandOptions): Promise<WebCommandResult> {
  const started = Date.now();
  const command = String(options.command || '').trim();
  const allowDangerous = options.allowDangerous === true;
  if (!command) {
    return failure(command, 'Error: command is required.', started, allowDangerous);
  }

  const directCommand = parseDirectCommand(command);
  if (!directCommand) {
    const intent = classifyUserIntent(command);
    const message =
      intent.kind === 'conversation'
        ? 'Hi. This web panel runs local shell commands. Try `node -v`, `npm test`, `git status`, or use the YamX terminal REPL for chat.'
        : intent.kind === 'clarification'
          ? 'Need a concrete shell command here, for example `npm test` or `git status`.'
          : 'This web panel only executes command-like input. Use a real command, or prefix one with `run:`.';
    return {
      ok: true,
      blocked: false,
      command,
      output: message,
      code: 0,
      timedOut: false,
      durationMs: Date.now() - started,
      cwd: getWorkspaceRelativeCwd(),
      allowDangerous,
    };
  }

  const risk = classifyShellCommand(directCommand);
  if ((risk.destructive || risk.risk === 'sensitive') && !allowDangerous) {
    return {
      ...failure(command, `Blocked: ${risk.reason}. Restart with --allow-dangerous to enable this from the web UI.`, started, allowDangerous),
      blocked: true,
      risk: risk.risk,
    };
  }

  const pseudo = pseudoShellAdviceMessage(directCommand);
  if (pseudo) return failure(command, pseudo, started, allowDangerous);

  const cdTarget = parsePersistentCd(directCommand);
  if (!options.cwd && cdTarget !== undefined) {
    const rel = cdTarget ? changeWorkspaceDirectory(cdTarget) : getWorkspaceRelativeCwd();
    return {
      ok: !rel.startsWith('Error:'),
      blocked: false,
      command,
      executedCommand: directCommand,
      output: rel.startsWith('Error:') ? rel : `cwd: ${rel}`,
      code: rel.startsWith('Error:') ? 1 : 0,
      timedOut: false,
      durationMs: Date.now() - started,
      cwd: getWorkspaceRelativeCwd(),
      allowDangerous,
    };
  }

  const cwd = options.cwd
    ? ensureInsideProject(options.cwd)
    : { ok: true as const, path: getWorkspaceCwd() };
  if (!cwd.ok) return failure(command, cwd.error, started, allowDangerous);

  const smart = getSmartShell(directCommand, options.shell || 'auto');
  const timeoutMs = boundedNumber(options.timeoutMs, 120_000, 1_000, 600_000);
  const maxChars = boundedNumber(options.maxChars, 80_000, 1_000, 500_000);
  const result = await runProcess(smart.shell.command, [...smart.shell.args, smart.command], {
    cwd: cwd.path,
    timeoutMs,
    maxChars,
  });

  await recordCommandRun({
    command: smart.command,
    cwd: cwd.path,
    code: result.code,
    timedOut: result.timedOut,
    output: result.text,
  });

  let output = result.text;
  if (result.timedOut) output = output ? `${output}\n(timed out after ${timeoutMs}ms)` : `(timed out after ${timeoutMs}ms)`;
  if (result.code !== 0 && result.code !== null) output = output ? `${output}\n(exit ${result.code})` : `(exit ${result.code})`;
  if (!output) output = result.code === 0 ? '(no output)' : `(exit ${result.code}, no output)`;

  return {
    ok: result.code === 0 && !result.timedOut,
    blocked: false,
    command,
    executedCommand: smart.command,
    output,
    code: result.code,
    timedOut: result.timedOut,
    durationMs: Date.now() - started,
    shell: smart.shell.label,
    reason: smart.reason,
    risk: risk.risk,
    cwd: getWorkspaceRelativeCwd(),
    allowDangerous,
  };
}

class WebAgentRuntime {
  private readonly allowDangerous: boolean;
  private readonly providerName?: string;
  private readonly modelName?: string;
  private readonly providerOverride?: Provider;
  private agentEnv?: {
    agent: Agent;
    cfg: YamConfig;
    store: SessionStore;
    session: ChatSession;
    provider: Provider;
  };
  private cfg?: YamConfig;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: WebServerOptions) {
    this.allowDangerous = options.allowDangerous === true;
    this.providerName = options.providerName;
    this.modelName = options.modelName;
    this.providerOverride = options.providerOverride;
  }

  async state(): Promise<{ provider: string; model: string; sessionId?: string }> {
    if (this.agentEnv) {
      return {
        provider: this.agentEnv.provider.name,
        model: this.agentEnv.provider.modelId,
        sessionId: this.agentEnv.session.id,
      };
    }
    const cfg = await this.loadConfig();
    return {
      provider: this.providerName || cfg.defaultProvider || 'openrouter',
      model: this.modelName || cfg.defaultModel || '',
    };
  }

  async handleInput(options: Omit<WebCommandOptions, 'allowDangerous'>): Promise<WebCommandResult> {
    if (parseDirectCommand(options.command)) {
      return executeWebCommand({ ...options, allowDangerous: this.allowDangerous });
    }
    return this.chat(options.command);
  }

  async chat(message: string): Promise<WebCommandResult> {
    return this.enqueue(() => this.chatNow(message));
  }

  private async chatNow(message: string): Promise<WebCommandResult> {
    const started = Date.now();
    const command = String(message || '').trim();
    if (!command) return failure(command, 'Error: message is required.', started, this.allowDangerous);

    try {
      const env = await this.getAgentEnv();
      const output = await captureConsoleOutput(async () => {
        await env.agent.chat(command);
      });
      const fallback = latestAssistantText(env.agent.getHistory()) || '(no response)';
      return {
        ok: true,
        blocked: false,
        kind: 'chat',
        command,
        output: output || fallback,
        code: 0,
        timedOut: false,
        durationMs: Date.now() - started,
        cwd: getWorkspaceRelativeCwd(),
        allowDangerous: this.allowDangerous,
        provider: env.provider.name,
        model: env.provider.modelId,
        sessionId: env.session.id,
      };
    } catch (error: any) {
      return {
        ...failure(command, `AI error: ${error?.message || 'Unable to run YamX agent.'}`, started, this.allowDangerous),
        kind: 'chat',
      };
    }
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async loadConfig(): Promise<YamConfig> {
    if (this.cfg) return this.cfg;
    const config = new Config();
    this.cfg = await config.load();
    return this.cfg;
  }

  private async getAgentEnv(): Promise<NonNullable<WebAgentRuntime['agentEnv']>> {
    if (this.agentEnv) return this.agentEnv;

    const cfg = await this.loadConfig();
    const provider = this.providerOverride || createProvider(
      this.providerName || cfg.defaultProvider || 'openrouter',
      this.modelName || cfg.defaultModel,
      cfg
    );
    const contextEngine = new ContextEngine();
    const systemPrompt = await contextEngine.buildSystemPrompt();
    const store = new SessionStore();
    await store.init();

    let session: ChatSession | null = null;
    const activeId = await store.getActiveSessionId();
    if (activeId) session = await store.loadSession(activeId);
    if (!session) {
      session = await store.createSession(process.cwd(), { role: 'system', content: systemPrompt });
    }

    const saveToDisk = async () => {
      if (!this.agentEnv) return;
      this.agentEnv.session.messages = this.agentEnv.agent.getHistory();
      this.agentEnv.store.updateTitleFromFirstMessage(this.agentEnv.session);
      await this.agentEnv.store.saveSession(this.agentEnv.session);
    };

    const agent = new Agent(provider, systemPrompt, {
      autoApprove: true,
      stream: false,
      maxTokens: cfg.settings?.maxTokens || 16384,
      temperature: cfg.settings?.temperature ?? 0.1,
      initialHistory: session.messages,
      onPersist: saveToDisk,
      contextBudgetChars: cfg.settings?.contextBudgetChars ?? 280_000,
      permissionMode: cfg.settings?.permissionMode ?? 'default',
      allowedShellCommands: cfg.settings?.allowedShellCommands ?? [],
      deniedShellPatterns: cfg.settings?.deniedShellPatterns ?? [],
      hooksEnabled: cfg.settings?.hooksEnabled !== false,
      modelCouncilEnabled: cfg.settings?.modelCouncil?.enabled === true,
      modelCouncilMode: cfg.settings?.modelCouncil?.mode ?? 'adaptive',
      maxToolResultChars: cfg.settings?.maxToolResultChars ?? 24_000,
      verboseCli: false,
      maxAssistantMarkdownChars: cfg.settings?.maxAssistantMarkdownChars ?? 3200,
      preflightRuntimeProbes: cfg.settings?.preflightRuntimeProbes !== false,
      nonInteractiveApprovals: this.allowDangerous ? 'allow' : 'deny',
    });

    this.agentEnv = { agent, cfg, store, session, provider };
    return this.agentEnv;
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: { allowDangerous: boolean; runtime: WebAgentRuntime }
): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') return sendText(res, 200, WEB_HTML, 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/style.css') return sendText(res, 200, WEB_CSS, 'text/css; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/app.js') return sendText(res, 200, WEB_JS, 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const agentState = await options.runtime.state();
    return sendJson(res, 200, {
      ok: true,
      cwd: getWorkspaceRelativeCwd(),
      root: PROJECT_ROOT,
      platform: process.platform,
      allowDangerous: options.allowDangerous,
      provider: agentState.provider,
      model: agentState.model,
      sessionId: agentState.sessionId,
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/command') {
    const body = await readJsonBody(req);
    const result = await options.runtime.handleInput({
      command: String(body.command || ''),
      shell: typeof body.shell === 'string' ? body.shell : undefined,
      cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
    });
    return sendJson(res, 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await readJsonBody(req);
    const result = await options.runtime.chat(String(body.message || body.command || ''));
    return sendJson(res, 200, result);
  }
  sendJson(res, 404, { error: 'Not found' });
}

function parsePersistentCd(command: string): string | undefined {
  const match = /^(?:cd|chdir|pushd)(?:\s+(.+))?$/i.exec(command.trim());
  if (!match) return undefined;
  return (match[1] || '').trim().replace(/^["']|["']$/g, '');
}

async function captureConsoleOutput(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrorWrite = process.stderr.write.bind(process.stderr);

  const push = (...args: unknown[]) => {
    chunks.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };

  console.log = (...args: unknown[]) => push(...args);
  console.warn = (...args: unknown[]) => push(...args);
  console.error = (...args: unknown[]) => push(...args);
  (process.stdout.write as any) = (chunk: any, ..._args: any[]) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  };
  (process.stderr.write as any) = (chunk: any, ..._args: any[]) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  };

  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    (process.stdout.write as any) = originalWrite;
    (process.stderr.write as any) = originalErrorWrite;
  }

  return stripAnsi(chunks.join('\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function latestAssistantText(history: Array<{ role: string; content: string | null }>): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role === 'assistant' && message.content?.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function normalizePort(value: unknown, fallback: number): number {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return fallback;
  return port;
}

function failure(command: string, output: string, started: number, allowDangerous: boolean): WebCommandResult {
  return {
    ok: false,
    blocked: false,
    command,
    output,
    code: 1,
    timedOut: false,
    durationMs: Date.now() - started,
    cwd: getWorkspaceRelativeCwd(),
    allowDangerous,
  };
}

function formatHostForUrl(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.includes('application/json')) throw new Error('Expected application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error('Request body too large.');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function sendText(res: http.ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'",
  });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, body: any): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}
