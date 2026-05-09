/**
 * YamX - Configuration Manager
 * Manages API keys, model preferences, and session settings.
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export interface YamConfig {
  defaultProvider: string;
  defaultModel: string;
  providers: {
    openai?: { apiKey: string; model?: string };
    anthropic?: { apiKey: string; model?: string };
    gemini?: { apiKey: string; model?: string };
    openrouter?: { apiKey: string; model?: string };
    ollama?: { baseUrl?: string; model?: string };
  };
  settings: {
    autoApprove: boolean;
    streamOutput: boolean;
    maxTokens: number;
    temperature: number;
    autoCommit: boolean;
    /** Approx. total JSON size of history before auto-summarization (chars) */
    contextBudgetChars: number;
    permissionMode: 'default' | 'ask' | 'read-only' | 'auto-safe';
    allowedShellCommands: string[];
    deniedShellPatterns: string[];
    hooksEnabled: boolean;
    modelCouncil: {
      enabled: boolean;
      mode?: 'adaptive' | 'always' | 'off';
    };
    maxToolResultChars: number;
    subagents: {
      enabled: boolean;
      defaultModel?: string;
    };
    /** When true: neural-status lines, fancy tool banners, turn timing. Default off = quieter CLI. */
    verboseCli?: boolean;
    /** Max assistant markdown chars shown and persisted per reply (hard UX/token guard). */
    maxAssistantMarkdownChars?: number;
    /** Read-only runtime probes auto-run before agent turn for install/PATH-style asks (default on). */
    preflightRuntimeProbes?: boolean;
  };
}

const DEFAULT_CONFIG: YamConfig = {
  defaultProvider: 'openrouter',
  defaultModel: 'deepseek-chat',
  providers: {},
  settings: {
    autoApprove: false,
    streamOutput: true,
    maxTokens: 16384,
    temperature: 0.1,
    autoCommit: false,
    contextBudgetChars: 280_000,
    permissionMode: 'default',
    allowedShellCommands: [],
    deniedShellPatterns: [],
    hooksEnabled: true,
    modelCouncil: {
      enabled: false,
      mode: 'adaptive',
    },
    maxToolResultChars: 24_000,
    subagents: {
      enabled: true,
    },
    verboseCli: false,
    maxAssistantMarkdownChars: 3200,
    preflightRuntimeProbes: true,
  },
};

export class Config {
  private configDir: string;
  private configPath: string;
  private config: YamConfig;

  constructor() {
    this.configDir = path.join(os.homedir(), '.yamx');
    this.configPath = path.join(this.configDir, 'config.json');
    this.config = DEFAULT_CONFIG;
  }

  async load(): Promise<YamConfig> {
    try {
      if (await fs.pathExists(this.configPath)) {
        const data = await fs.readJSON(this.configPath);
        this.config = { ...DEFAULT_CONFIG, ...data, settings: { ...DEFAULT_CONFIG.settings, ...data.settings } };
      }
    } catch {
      // Use defaults
    }

    // Override defaults with env vars
    if (process.env.DEFAULT_PROVIDER) {
      this.config.defaultProvider = process.env.DEFAULT_PROVIDER;
    }
    if (process.env.DEFAULT_MODEL) {
      this.config.defaultModel = process.env.DEFAULT_MODEL;
    }

    // Override with env vars
    if (process.env.OPENAI_API_KEY) {
      this.config.providers.openai = {
        ...this.config.providers.openai,
        apiKey: process.env.OPENAI_API_KEY,
      };
    }
    if (process.env.ANTHROPIC_API_KEY) {
      this.config.providers.anthropic = {
        ...this.config.providers.anthropic,
        apiKey: process.env.ANTHROPIC_API_KEY,
      };
    }
    if (process.env.GEMINI_API_KEY) {
      this.config.providers.gemini = {
        ...this.config.providers.gemini,
        apiKey: process.env.GEMINI_API_KEY,
      };
    }
    if (process.env.OPENROUTER_API_KEY) {
      this.config.providers.openrouter = {
        ...this.config.providers.openrouter,
        apiKey: process.env.OPENROUTER_API_KEY,
      };
    }

    return this.config;
  }

  async save(): Promise<void> {
    await fs.ensureDir(this.configDir);
    await fs.writeJSON(this.configPath, this.config, { spaces: 2 });
  }

  get(): YamConfig {
    return this.config;
  }

  set(key: string, value: any) {
    const keys = key.split('.');
    let obj: any = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] === undefined) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
  }

  /** Replace on-disk config with defaults (sessions under ~/.yamx/sessions are kept). */
  async resetToDefaults(): Promise<void> {
    this.config = {
      ...DEFAULT_CONFIG,
      providers: {},
      settings: { ...DEFAULT_CONFIG.settings },
    };
    await this.save();
  }
}
