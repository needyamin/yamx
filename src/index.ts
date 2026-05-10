#!/usr/bin/env node

/**
 * YamX CLI v1.0.0 - coding agent with persistent sessions
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import readline from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import os from 'node:os';
import nodePath from 'node:path';
import { createRequire } from 'node:module';
import { stdin, stdout } from 'node:process';
import { Agent } from './agent.js';
import { Config, type YamConfig } from './config/index.js';
import { ContextEngine } from './context.js';
import { UI } from './ui.js';
import { Provider, Message } from './providers/base.js';
import { createProvider, normalizeProviderName, resolveCloudApiKey, type ProviderName } from './providers/factory.js';
import { execSync } from 'child_process';
import { SessionStore, type ChatSession } from './session-store.js';
import { getToolCount } from './tools/registry.js';
import { parseDirectCommand } from './direct-command.js';
import { isDirectShellFailure, isDirectShellUserCancelled } from './direct-shell-diagnose.js';
import { runCommand } from './tools/shell.js';
import { handleCommand } from './commands/index.js';
import { buildAgentInputWithProjectIntel, shouldAttachProjectIntel } from './project-intel.js';
import { REPL_HISTORY_PATH, printReplHistory } from './repl-history.js';
import { DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS } from './assistant-output-cap.js';
import { ttyResetBeforeReplPrompt } from './tty-repl-cue.js';
import {
  setRunCommandAbortCheck,
  interruptShellChildForUser,
  clearShellInterruptState,
} from './shell-abort-context.js';
import { maybePromptCliUpdate } from './cli-update-check.js';
import { startYamxWebServer } from './web/server.js';
import { ensureCommandIntelligenceDatabase, suggestCommandFix, suggestCommands, type CommandSuggestion } from './command-intelligence.js';

dotenv.config({ quiet: true });

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version?: string };
const VERSION = packageJson.version || '0.0.0';
const program = new Command();

/** Bracket glyphs: readable on legacy Windows consoles that are not UTF-8 (code page issues). */
const TERM = {
  ok: chalk.green('[+]'),
  idle: chalk.dim('[-]'),
  bad: chalk.red('[x]'),
  warn: chalk.yellow('[!]'),
} as const;

const PROVIDER_CHOICES: Array<{ name: string; value: ProviderName }> = [
  { name: 'OpenRouter  (100+ models: DeepSeek, Llama, Claude, GPT, Gemini)', value: 'openrouter' },
  { name: 'OpenAI      (GPT-5.5 / GPT-5.4 / reasoning models)', value: 'openai' },
  { name: 'Anthropic   (Claude Sonnet / Opus 4.x)', value: 'anthropic' },
  { name: 'Gemini      (Gemini 3 / 2.5 Flash & Pro)', value: 'gemini' },
  { name: 'Kimi        (Moonshot — Kimi K2.5 / K2.6, OpenAI-compatible)', value: 'kimi' },
  { name: 'Grok        (xAI — Grok 4.x, OpenAI-compatible chat)', value: 'grok' },
  { name: 'Ollama      (local models: Qwen, DeepSeek, Llama)', value: 'ollama' },
];

const KEY_HINTS: Record<Exclude<ProviderName, 'ollama'>, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  kimi: 'https://platform.kimi.ai/',
  grok: 'https://console.x.ai/team/default/api-keys',
  openrouter: 'https://openrouter.ai/keys',
};

const PROVIDER_MODELS: Record<ProviderName, { name: string; value: string }[]> = {
  openai: [
    { name: 'GPT-5.2 (recommended)', value: 'gpt-5.2' },
    { name: 'GPT-5.1', value: 'gpt-5.1' },
    { name: 'GPT-5', value: 'gpt-5' },
    { name: 'GPT-5 mini', value: 'gpt-5-mini' },
    { name: 'GPT-5 nano', value: 'gpt-5-nano' },
    { name: 'GPT-4.1', value: 'gpt-4.1' },
    { name: 'o3', value: 'o3' },
    { name: 'o4-mini', value: 'o4-mini' },
    { name: 'GPT-4o', value: 'gpt-4o' },
  ],
  anthropic: [
    { name: 'Claude Opus 4.1', value: 'claude-opus-4-1-20250805' },
    { name: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
    { name: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
    { name: 'Claude 3.7 Sonnet', value: 'claude-3-7-sonnet-20250219' },
    { name: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
  ],
  gemini: [
    { name: 'Gemini 3 Flash Preview', value: 'gemini-3-flash-preview' },
    { name: 'Gemini 3 Pro Preview', value: 'gemini-3-pro-preview' },
    { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
    { name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
  ],
  kimi: [
    { name: 'Kimi K2.6 (recommended)', value: 'kimi-k2.6' },
    { name: 'Kimi K2.5', value: 'kimi-k2.5' },
    { name: 'Kimi K2 Thinking', value: 'kimi-k2-thinking' },
  ],
  grok: [
    { name: 'Grok 4.3', value: 'grok-4.3' },
    { name: 'Grok 4 latest', value: 'grok-4-latest' },
    { name: 'Grok 4', value: 'grok-4' },
  ],
  openrouter: [
    { name: 'DeepSeek Chat V3.1 (recommended)', value: 'deepseek-chat' },
    { name: 'DeepSeek R1', value: 'deepseek-r1' },
    { name: 'Claude Sonnet 4.6', value: 'claude-sonnet-4' },
    { name: 'GPT-5.2', value: 'gpt-5.2' },
    { name: 'Gemini 3 Flash Preview', value: 'gemini-3-flash' },
    { name: 'Kimi K2.6', value: 'kimi-k2.6' },
    { name: 'Grok 4.3', value: 'grok-4.3' },
    { name: 'Llama 4 Maverick', value: 'llama-4-maverick' },
  ],
  ollama: [
    { name: 'Qwen 2.5 Coder', value: 'qwen2.5-coder' },
    { name: 'Qwen 3 Coder', value: 'qwen3-coder' },
    { name: 'DeepSeek R1', value: 'deepseek-r1' },
    { name: 'Llama 3.3', value: 'llama3.3' },
  ],
};

/** Env var name YamX writes for .env quick-setup (matches official SDK docs). */
function envKeyForProvider(providerId: string): string {
  switch (String(providerId || '').toLowerCase()) {
    case 'kimi':
      return 'MOONSHOT_API_KEY';
    case 'grok':
      return 'XAI_API_KEY';
    default:
      return `${String(providerId).toUpperCase()}_API_KEY`;
  }
}

/** Cloud providers need an API key; local Ollama does not by default. */
function providerUsesApiKey(p: ProviderName): boolean {
  return p !== 'ollama';
}

function hasCloudApiKey(cfg: YamConfig, provider: ProviderName): boolean {
  if (!providerUsesApiKey(provider)) return true;
  const key = resolveCloudApiKey(cfg, provider as Exclude<ProviderName, 'ollama'>);
  return !!String(key || '').trim();
}

/**
 * True when the user needs interactive setup before a normal chat run:
 * no ~/.yamx/config.json yet, or no key (config + env) for the resolved default/cloud provider.
 */
function needsAutoOnboarding(
  configFileExists: boolean,
  cfg: YamConfig,
  cliProviderFlag?: string
): boolean {
  if (!configFileExists) return true;
  const p = normalizeProviderName(cliProviderFlag || cfg.defaultProvider || 'openrouter');
  return !hasCloudApiKey(cfg, p);
}

function parseWebPort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Port must be an integer between 0 and 65535.');
  }
  return port;
}

program
  .name('yamx')
  .description('YamX - agent CLI with persistent chat sessions')
  .version(VERSION)
  .option(
    '-p, --provider <provider>',
    'LLM provider (openai, anthropic, gemini, kimi, grok, openrouter, ollama)',
    ''
  )
  .option('-m, --model <model>', 'Model name')
  .option('--auto-approve', 'Auto-approve all tool actions (dangerous!)', false)
  .option('--no-stream', 'Disable streaming output')
  .option('-t, --temperature <temp>', 'Temperature (0-1)', '0.1')
  .option('--max-tokens <tokens>', 'Max output tokens', '16384')
  .option('--new-chat', 'Start a fresh conversation (new session)', false)
  .option('--clear-chat', 'Clear active session history on disk, then exit', false)
  .option('--history', 'List saved conversations, then exit', false)
  .option('--resume <id>', 'Resume a session (full UUID or unique prefix)')
  .option('--delete-chat <id>', 'Delete a session by id or prefix, then exit', '')
  .option('--onboard', 'Setup or switch provider, API key, model, and core settings', false)
  .option('--reset-config', 'Reset ~/.yamx/config.json to defaults, then exit', false)
  .option('--diagnose', 'Check configuration, API keys, and connectivity', false);

program
  .command('config')
  .description('Configure YamX (API keys, defaults)')
  .action(async () => {
    const config = new Config();
    await config.load();

    const { action } = await inquirer.prompt([
      {
        type: 'rawlist',
        name: 'action',
        message: 'What would you like to configure?',
        choices: [
          { name: 'Setup / Switch Provider + Model + API Key', value: 'wizard' },
          { name: 'Set API Key', value: 'apikey' },
          { name: 'Set Default Provider', value: 'provider' },
          { name: 'Set Default Model', value: 'model' },
          { name: 'Set context budget (chars for auto-summarize)', value: 'budget' },
          { name: 'Set max tool-result history size', value: 'toolresults' },
          { name: 'Toggle Auto-Approve', value: 'autoapprove' },
          { name: 'Toggle Model Council', value: 'council' },
          { name: 'Toggle npm update check (new YamX versions)', value: 'updates' },
          { name: 'View Current Config', value: 'view' },
        ],
      },
    ]);

    if (action === 'wizard') {
      await runOnboard(config, { title: 'YamX · Setup / Switch Provider' });
    } else if (action === 'apikey') {
      const { provider } = await inquirer.prompt([
        {
          type: 'rawlist',
          name: 'provider',
          message: 'Select provider:',
          choices: PROVIDER_CHOICES.filter((choice) => choice.value !== 'ollama'),
        },
      ]);
      await configureProviderAccess(config, normalizeProviderName(provider));
      await config.save();
      console.log(chalk.green(`[+] ${provider} API key saved.`));
    } else if (action === 'provider') {
      const { provider } = await inquirer.prompt([
        {
          type: 'rawlist',
          name: 'provider',
          message: 'Select default provider:',
          default: config.get().defaultProvider || 'openrouter',
          choices: PROVIDER_CHOICES,
        },
      ]);
      config.set('defaultProvider', normalizeProviderName(provider));
      await config.save();
      console.log(chalk.green(`[+] Default provider set to ${normalizeProviderName(provider)}.`));
    } else if (action === 'model') {
      const provider = (config.get().defaultProvider || 'openrouter') as ProviderName;
      const model = await chooseModel(provider, config.get().defaultModel || (provider === 'openrouter' ? 'deepseek-chat' : undefined));
      config.set('defaultModel', model);
      config.set(`providers.${provider}.model`, model);
      await config.save();
      console.log(chalk.green(`[+] Default model set to ${model}.`));
    } else if (action === 'budget') {
      const { n } = await inquirer.prompt([
        {
          type: 'input',
          name: 'n',
          message: 'Max total history size (chars) before auto-summarization:',
          default: String(config.get().settings.contextBudgetChars),
        },
      ]);
      const v = parseInt(n, 10);
      if (v > 10_000) {
        config.set('settings.contextBudgetChars', v);
        await config.save();
        console.log(chalk.green(`[+] contextBudgetChars = ${v}`));
      } else {
        console.log(chalk.yellow('Value too small; unchanged.'));
      }
    } else if (action === 'toolresults') {
      const { n } = await inquirer.prompt([
        {
          type: 'input',
          name: 'n',
          message: 'Max tool-result chars kept in model history:',
          default: String(config.get().settings.maxToolResultChars || 24_000),
        },
      ]);
      const v = parseInt(n, 10);
      if (v >= 4000 && v <= 100_000) {
        config.set('settings.maxToolResultChars', v);
        await config.save();
        console.log(chalk.green(`[+] maxToolResultChars = ${v}`));
      } else {
        console.log(chalk.yellow('Use a value between 4000 and 100000; unchanged.'));
      }
    } else if (action === 'autoapprove') {
      const current = config.get().settings.autoApprove;
      const { approve } = await inquirer.prompt([
        { type: 'confirm', name: 'approve', message: `Enable auto-approve by default? (Currently: ${current})`, default: current },
      ]);
      config.set('settings.autoApprove', approve);
      await config.save();
      console.log(chalk.green(`[+] Auto-approve set to ${approve}.`));
    } else if (action === 'council') {
      const current = config.get().settings.modelCouncil?.enabled === true;
      const { enabled, mode } = await inquirer.prompt([
        { type: 'confirm', name: 'enabled', message: `Enable hidden model council before agent replies? (Currently: ${current})`, default: current },
        {
          type: 'rawlist',
          name: 'mode',
          message: 'Model council token mode:',
          default: config.get().settings.modelCouncil?.mode || 'adaptive',
          choices: [
            { name: 'adaptive (recommended)', value: 'adaptive' },
            { name: 'always (higher token cost)', value: 'always' },
            { name: 'off (lowest cost)', value: 'off' },
          ],
        },
      ]);
      config.set('settings.modelCouncil.enabled', enabled);
      config.set('settings.modelCouncil.mode', enabled ? mode : 'off');
      await config.save();
      console.log(chalk.green(`[+] Model council set to ${enabled ? mode : 'off'}.`));
    } else if (action === 'updates') {
      const current = config.get().settings.checkForUpdates === true;
      const { enabled } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'enabled',
          message:
            'When enabled, YamX checks npm for a newer release (at most once per 24h) and asks before running npm install -g.',
          default: current,
        },
      ]);
      config.set('settings.checkForUpdates', enabled);
      await config.save();
      console.log(chalk.green(`[+] checkForUpdates = ${enabled}`));
    } else if (action === 'view') {
      const cfg = config.get();
      const safe = JSON.parse(JSON.stringify(cfg));
      // Mask API keys for display
      for (const p of Object.values(safe.providers || {})) {
        if (p && typeof p === 'object' && 'apiKey' in p) {
          const k = (p as any).apiKey as string;
          (p as any).apiKey = k ? `${k.slice(0, 8)}...${k.slice(-4)}` : '(not set)';
        }
      }
      console.log(JSON.stringify(safe, null, 2));
    }
  });

program
  .command('web')
  .description('Start the local YamX web command UI')
  .option('-P, --port <port>', 'Port to listen on', '8765')
  .option('--host <host>', 'Host to bind', '127.0.0.1')
  .option('-p, --provider <provider>', 'LLM provider for web chat')
  .option('-m, --model <model>', 'Model for web chat')
  .option('--allow-dangerous', 'Allow destructive or sensitive commands from the web UI', false)
  .action(async (options) => {
    const port = parseWebPort(options.port);
    const host = String(options.host || '127.0.0.1').trim() || '127.0.0.1';
    const app = await startYamxWebServer({
      port,
      host,
      allowDangerous: options.allowDangerous === true,
      providerName: options.provider,
      modelName: options.model,
    });
    console.log(chalk.green(`[+] YamX web UI: ${app.url}`));
    console.log(chalk.dim(`    cwd: ${process.cwd()}`));
    console.log(chalk.dim(`    dangerous commands: ${options.allowDangerous ? 'allowed' : 'blocked'}`));

    process.on('SIGINT', async () => {
      await app.close().catch(() => undefined);
      console.log(chalk.dim('\nStopped YamX web UI.'));
      process.exit(0);
    });
  });

program.action(async (options) => {
  const config = new Config();
  const cfg = await config.load();
  const verboseCli = cfg.settings?.verboseCli === true;
  const councilOn = cfg.settings?.modelCouncil?.enabled === true;
  const assistantMdCap =
    cfg.settings?.maxAssistantMarkdownChars ?? DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS;
  const ui = new UI({ verbose: verboseCli, maxAssistantMarkdownChars: assistantMdCap });
  const store = new SessionStore();
  await store.init();

  if (options.resetConfig) {
    await config.resetToDefaults();
    console.log(chalk.green('Config reset. Session files in ~/.yamx/sessions/ were not deleted.'));
    process.exit(0);
  }

  if (options.onboard) {
    await runOnboard(config, { title: 'YamX · Setup / Switch Provider' });
    process.exit(0);
  }

  if (options.diagnose) {
    await runDiagnose(config, cfg);
    process.exit(0);
  }

  const delArg = options.deleteChat != null ? String(options.deleteChat).trim() : '';

  // Auto-onboard for first-time users
  const fs = await import('fs-extra');
  const path = await import('path');
  const os = await import('os');
  const configPath = path.default.join(os.default.homedir(), '.yamx', 'config.json');
  const configExists = await fs.default.pathExists(configPath);

  const isCommandRun = options.onboard || options.diagnose || options.history || options.clearChat || options.resetConfig || delArg;

  const cliProvider = typeof options.provider === 'string' && options.provider.trim() ? options.provider : undefined;

  if (!isCommandRun && needsAutoOnboarding(configExists, cfg, cliProvider)) {
    console.log(
      chalk.yellow(
        configExists
          ? '\nYamX needs an API key for your default provider — starting setup.'
          : "\nWelcome to YamX — starting first-time setup (same as `yamx --onboard`)."
      )
    );
    await runOnboard(config, {
      title: configExists ? 'YamX · Complete setup' : 'YamX · First-time setup',
      firstRun: !configExists,
    });
    Object.assign(cfg, config.get());
  }

  if (options.history) {
    const sessions = await store.listSessions();
    if (sessions.length === 0) {
      console.log(chalk.dim('No saved conversations yet.'));
      process.exit(0);
    }
    console.log(chalk.bold('\nSaved conversations\n'));
    for (const s of sessions) {
      const active = (await store.getActiveSessionId()) === s.id ? chalk.green('* ') : '  ';
      const msgCount = s.messages.length;
      console.log(
        `${active}${chalk.cyan(s.id.slice(0, 8))}  ${chalk.dim(s.updatedAt.slice(0, 16))}  ${chalk.dim(`${msgCount}msg`)}  ${s.title}`
      );
    }
    console.log(chalk.dim('\nResume: yamx --resume <id>\n'));
    process.exit(0);
  }

  if (delArg) {
    const r = await resolveSessionRef(store, delArg);
    if (r === 'ambiguous') {
      console.log(chalk.red('Multiple sessions match. Use a longer id: yamx --history'));
      process.exit(1);
    }
    if (!r) {
      console.log(chalk.red(`No session matching: ${delArg}`));
      process.exit(1);
    }
    await store.deleteSession(r);
    console.log(chalk.green(`Deleted session ${r}`));
    process.exit(0);
  }

  if (options.clearChat) {
    const activeId = await store.getActiveSessionId();
    if (!activeId) {
      console.log(chalk.yellow('No active session.'));
      process.exit(1);
    }
    const sess = await store.loadSession(activeId);
    if (!sess || sess.messages.length === 0) {
      console.log(chalk.yellow('Nothing to clear.'));
      process.exit(1);
    }
    const sys = sess.messages[0];
    if (sys.role !== 'system') {
      console.log(chalk.red('Invalid session file (first message must be system).'));
      process.exit(1);
    }
    sess.messages = [sys];
    await store.saveSession(sess);
    console.log(chalk.green('Active conversation cleared (system prompt kept).'));
    process.exit(0);
  }

  let providerName = options.provider || cfg.defaultProvider || 'openai';
  let modelName = options.model || cfg.defaultModel;
  let provider: Provider;
  try {
    provider = createProvider(providerName, modelName, cfg);
  } catch (error: any) {
    if (error.message.includes('API key not found')) {
      console.log(chalk.hex('#FF4136').bold(`\n  ${TERM.warn} ${error.message.split('.')[0]}`)); // Just the first sentence

      const { choice } = await inquirer.prompt([
        {
          type: 'rawlist',
          name: 'choice',
          message: 'How would you like to configure your API key?',
          choices: [
            { name: '1) Run interactive global setup (Recommended)', value: 'global' },
            { name: '2) Create a .env file in this directory', value: 'env' },
            { name: '3) Exit', value: 'exit' },
          ]
        }
      ]);

      if (choice === 'global') {
        await runOnboard(config, { title: 'YamX · Setup / Switch Provider' });
        Object.assign(cfg, config.get());
        providerName = options.provider || cfg.defaultProvider || 'openai';
        modelName = options.model || cfg.defaultModel;
        provider = createProvider(providerName, modelName, cfg);
      } else if (choice === 'env') {
        const envVar = envKeyForProvider(providerName);
        const { key } = await inquirer.prompt([
          {
            type: 'password',
            name: 'key',
            message: `Enter your API key (stored as ${envVar}; pasting is hidden):`,
            mask: '*'
          }
        ]);
        const fs = await import('fs-extra');
        const envPath = path.resolve(process.cwd(), '.env');
        let envContent = '';
        if (await fs.pathExists(envPath)) {
          envContent = await fs.readFile(envPath, 'utf-8');
          if (!envContent.endsWith('\n')) envContent += '\n';
        }
        envContent += `${envVar}=${key}\n`;
        await fs.writeFile(envPath, envContent, 'utf-8');
        console.log(chalk.green(`\n  [+] Saved to ${envPath}`));

        process.env[envVar] = key;
        provider = createProvider(providerName, modelName, cfg);
      } else {
        console.log(chalk.dim('\nGoodbye.'));
        process.exit(0);
      }
    } else {
      ui.error(error.message);
      process.exit(1);
    }
  }

  if (cfg.settings?.checkForUpdates === true) {
    await maybePromptCliUpdate(VERSION);
  }

  const contextEngine = new ContextEngine();
  ui.startThinking('Scanning project...');
  const systemPrompt = await contextEngine.buildSystemPrompt();
  ui.stopSpinner();
  ui.info(`Project scanned | ${getToolCount()} tools loaded | ~/.yamx/sessions/\n`);

  let currentSession: ChatSession;

  if (options.newChat) {
    currentSession = await store.createSession(process.cwd(), {
      role: 'system',
      content: systemPrompt,
    });
  } else if (options.resume) {
    const r = await resolveSessionRef(store, String(options.resume).trim());
    if (r === 'ambiguous') {
      ui.error('Multiple sessions match this prefix. Use a longer id: yamx --history');
      process.exit(1);
    }
    if (!r) {
      ui.error(`No session matching "${options.resume}". Use: yamx --history`);
      process.exit(1);
    }
    const loaded = await store.loadSession(r);
    if (!loaded) {
      ui.error('Session file missing.');
      process.exit(1);
    }
    await store.setActiveSessionId(loaded.id);
    currentSession = loaded;
  } else {
    const activeId = await store.getActiveSessionId();
    if (activeId) {
      const loaded = await store.loadSession(activeId);
      if (loaded) {
        currentSession = loaded;
      } else {
        currentSession = await store.createSession(process.cwd(), {
          role: 'system',
          content: systemPrompt,
        });
      }
    } else {
      const list = await store.listSessions();
      if (list.length > 0) {
        currentSession = list[0];
        await store.setActiveSessionId(currentSession.id);
      } else {
        currentSession = await store.createSession(process.cwd(), {
          role: 'system',
          content: systemPrompt,
        });
      }
    }
  }

  const initialMessages: Message[] =
    currentSession.messages.length > 0
      ? (JSON.parse(JSON.stringify(currentSession.messages)) as Message[])
      : [{ role: 'system', content: systemPrompt }];

  const stream =
    options.stream === false ? false : cfg.settings?.streamOutput !== false;

  let agent: Agent;
  const saveToDisk = async () => {
    currentSession.messages = agent.getHistory();
    store.updateTitleFromFirstMessage(currentSession);
    await store.saveSession(currentSession);
  };

  agent = new Agent(provider, systemPrompt, {
    autoApprove: options.autoApprove || cfg.settings?.autoApprove || false,
    stream,
    maxTokens: parseInt(String(options.maxTokens), 10) || cfg.settings?.maxTokens || 16384,
    temperature: parseFloat(String(options.temperature)) || cfg.settings?.temperature || 0.1,
    initialHistory: initialMessages,
    onPersist: saveToDisk,
    contextBudgetChars: cfg.settings?.contextBudgetChars ?? 280_000,
    permissionMode: cfg.settings?.permissionMode ?? 'default',
    allowedShellCommands: cfg.settings?.allowedShellCommands ?? [],
    deniedShellPatterns: cfg.settings?.deniedShellPatterns ?? [],
    hooksEnabled: cfg.settings?.hooksEnabled !== false,
    modelCouncilEnabled: councilOn,
    modelCouncilMode: cfg.settings?.modelCouncil?.mode ?? 'adaptive',
    maxToolResultChars: cfg.settings?.maxToolResultChars ?? 24_000,
    verboseCli,
    maxAssistantMarkdownChars: assistantMdCap,
    preflightRuntimeProbes: cfg.settings?.preflightRuntimeProbes !== false,
  });

  ui.banner(provider.name, provider.modelId, {
    title: currentSession.title,
    id: currentSession.id,
  }, getToolCount(), VERSION, councilOn);

  const intelligencePath = await ensureCommandIntelligenceDatabase();

  if (currentSession.messages.length === 1) {
    console.log(chalk.dim('  /help — slash commands | history or /history [n] — ~/.yamx/history'));
    console.log(chalk.dim(`  Live suggestions (${nodePath.relative(process.cwd(), intelligencePath) || intelligencePath}) after 3 chars · ↑/↓ choose row · Tab/Enter apply · Ctrl+↑/↓ session history · Esc dismiss\n`));
  } else {
    console.log(); // Just a spacer if resuming chat
  }

  const inputSession = await createInputSession();
  let activeWork = false;
  /**
   * Ctrl+C while work is active:
   * 1st (logical) press — kill the shell tree immediately + cooperative stop.
   * 2nd press — exit YamX (save first).
   * One physical key can emit SIGINT twice on Windows; debounce + min gap avoid treating that as two presses.
   */
  let workSigintLastEventAt = 0;
  let workSigintBurstStart = 0;
  let workSigintBurstCount = 0;
  const SIGINT_DEBOUNCE_MS = 95;
  /** Min ms after first counted Ctrl+C before a second counts as "exit YamX" (filters Windows echo-SIGINT). */
  const FORCE_EXIT_MIN_GAP_MS = 320;
  const FORCE_EXIT_WINDOW_MS = 8000;

  const endReplActiveWork = () => {
    activeWork = false;
    workSigintLastEventAt = 0;
    workSigintBurstStart = 0;
    workSigintBurstCount = 0;
    clearShellInterruptState();
  };

  process.on('SIGINT', async () => {
    if (activeWork) {
      inputSession.clearPrompt?.();
      const now = Date.now();
      if (now - workSigintLastEventAt < SIGINT_DEBOUNCE_MS) return;
      workSigintLastEventAt = now;

      if (workSigintBurstCount === 0 || now - workSigintBurstStart > FORCE_EXIT_WINDOW_MS) {
        workSigintBurstStart = now;
        workSigintBurstCount = 0;
      }
      workSigintBurstCount += 1;

      interruptShellChildForUser();

      if (workSigintBurstCount >= 2 && now - workSigintBurstStart >= FORCE_EXIT_MIN_GAP_MS) {
        console.log(chalk.dim('\nSecond interrupt: exiting YamX…'));
        endReplActiveWork();
        await saveToDisk().catch(() => undefined);
        inputSession.close();
        process.exit(130);
      }

      const stopAlreadyPending = agent.isStopRequested();
      agent.requestStop();
      if (stopAlreadyPending) {
        agent.getUI().replForceExitHint();
      }
      return;
    }

    workSigintLastEventAt = 0;
    workSigintBurstStart = 0;
    workSigintBurstCount = 0;
    try {
      await saveToDisk();
      inputSession.close();
    } catch {
      inputSession.close();
      /* ignore */
    }
    console.log(chalk.dim('\nSaved. Bye.'));
    process.exit(0);
  });

  while (true) {
    let input: string;
    try {
      input = (await inputSession.question(`${chalk.hex('#41FF70').bold('YamX')} ${chalk.hex('#00FF41')('›')} `)).trim();
      if (!input) continue;
      await inputSession.save(input);
    } catch {
      inputSession.close();
      await saveToDisk();
      console.log(chalk.dim('\nGoodbye.'));
      process.exit(0);
    }

    if (input.startsWith('/')) {
      activeWork = true;
      try {
        await handleCommand(input, agent, provider, { store, session: currentSession, agent }, cfg, executeDirectCommand);
        agent.getUI().cueTTYAfterBulkOutput();
      } finally {
        endReplActiveWork();
      }
      continue;
    }

    const histExec = /^history(?:\s+(\d+))?\s*$/i.exec(input);
    if (histExec) {
      const cap = histExec[1] ? parseInt(histExec[1], 10) : NaN;
      await printReplHistory(Number.isFinite(cap) && cap > 0 ? cap : undefined);
      agent.getUI().cueTTYAfterBulkOutput();
      continue;
    }

    const directCommand = parseDirectCommand(input);
    if (directCommand) {
      activeWork = true;
      try {
        await executeDirectCommand(directCommand, agent, options.autoApprove || cfg.settings?.autoApprove || false, true);
      } finally {
        endReplActiveWork();
      }
      continue;
    }

    try {
      activeWork = true;
      const agentInput = shouldAttachProjectIntel(input)
        ? await buildAgentInputWithProjectIntel(input)
        : input;
      await agent.chat(agentInput);
    } catch (error: any) {
      agent.getUI().error(`Fatal error: ${error.message}`);
    } finally {
      endReplActiveWork();
    }
  }
});

async function createInputSession(): Promise<{
  question(prompt: string): Promise<string>;
  save(line: string): Promise<void>;
  clearPrompt?: () => void;
  close(): void;
}> {
  const historyPath = REPL_HISTORY_PATH;
  await fs.ensureDir(nodePath.dirname(historyPath));
  const history = await fs.readFile(historyPath, 'utf-8')
    .then((s) => s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .catch(() => [] as string[]);

  async function save(line: string): Promise<void> {
    const existing = await fs.readFile(historyPath, 'utf-8')
      .then((s) => s.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))
      .catch(() => [] as string[]);
    const next = [...existing.filter((item) => item !== line), line].slice(-500);
    await fs.writeFile(historyPath, `${next.join('\n')}\n`, 'utf-8');
    history.splice(0, history.length, ...next);
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    const rl = readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
      historySize: 500,
      removeHistoryDuplicates: true,
    });

    // readline keeps the newest entry first internally.
    (rl as any).history = [...history].reverse();

    return {
      question: async (prompt: string) => {
        ttyResetBeforeReplPrompt();
        return rl.question(prompt);
      },
      save,
      close: () => rl.close(),
    };
  }

  let closed = false;
  let renderedRows = 0;

  function clearDropdown(rows: number): void {
    if (rows <= 0) return;
    stdout.write('\r\x1b[J');
  }

  function renderPrompt(prompt: string, buffer: string, cursor: number, suggestions: CommandSuggestion[], selectedIndex: number, selectionActive: boolean): number {
    const visible = suggestions.slice(0, 7);
    stdout.write('\r\x1b[0J\x1b[2K');
    stdout.write(`${prompt}${buffer}`);
    if (visible.length === 0) {
      stdout.write(`\x1b[${stripAnsi(prompt).length + cursor + 1}G`);
      return 0;
    }

    stdout.write('\n');
    /** Entire row (indent + command + reason) uses ANSI gray — works without truecolor; rgb was often ignored on Windows. */
    visible.forEach((item, index) => {
      const source = item.source === 'memory' ? 'memory' : item.reason;
      const fullLine = `  ${item.command}  (${source})`;
      if (selectionActive && index === selectedIndex) {
        stdout.write(`${chalk.inverse(fullLine)}\n`);
      } else {
        stdout.write(`${chalk.gray(fullLine)}\n`);
      }
    });
    stdout.write(`\x1b[${visible.length + 1}A`);
    stdout.write(`\x1b[${stripAnsi(prompt).length + cursor + 1}G`);
    return visible.length + 1;
  }

  return {
    question: (prompt: string) => new Promise<string>((resolve, reject) => {
      ttyResetBeforeReplPrompt();
      emitKeypressEvents(stdin);
      stdin.setRawMode(true);

      let buffer = '';
      let cursor = 0;
      let suggestions: CommandSuggestion[] = [];
      let selectedIndex = 0;
      let selectionActive = false;
      let acceptedSuggestionPrefix = '';
      let historyIndex = history.length;
      /** While true, hide intelligence rows so ↑/↓ behaves like shell history only. */
      let suppressSuggestionsForHistory = false;
      let refreshSeq = 0;

      const cleanup = () => {
        stdin.off('keypress', onKeypress);
        stdin.setRawMode(false);
      };

      const redraw = () => {
        clearDropdown(renderedRows);
        renderedRows = renderPrompt(prompt, buffer, cursor, suggestions, selectedIndex, selectionActive);
      };

      const markEdit = () => {
        if (acceptedSuggestionPrefix && cursor <= acceptedSuggestionPrefix.length) {
          acceptedSuggestionPrefix = '';
        }
      };

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const refreshSuggestions = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        if (suppressSuggestionsForHistory) {
          suggestions = [];
          selectedIndex = 0;
          selectionActive = false;
          redraw();
          return;
        }

        if (acceptedSuggestionPrefix && buffer.startsWith(acceptedSuggestionPrefix)) {
          suggestions = [];
          selectedIndex = 0;
          selectionActive = false;
          redraw();
          return;
        }
        if (acceptedSuggestionPrefix && !buffer.startsWith(acceptedSuggestionPrefix)) {
          acceptedSuggestionPrefix = '';
        }
        if (buffer.trim().length < 3) {
          suggestions = [];
          selectedIndex = 0;
          selectionActive = false;
          redraw();
          return;
        }

        // Debounce: wait 30ms of idle time before computing suggestions
        // This prevents redundant scoring runs during rapid typing
        // but keeps responsiveness high (scoring itself is ~2ms)
        const seq = ++refreshSeq;
        const delay = suggestions.length === 0 ? 0 : 30; // instant first appearance
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          suggestCommands(buffer, process.cwd(), 7)
            .then((next) => {
              if (seq !== refreshSeq || closed) return;
              suggestions = next;
              selectedIndex = Math.min(selectedIndex, Math.max(0, suggestions.length - 1));
              selectionActive = false;
              redraw();
            })
            .catch(() => {
              if (seq !== refreshSeq || closed) return;
              suggestions = [];
              selectedIndex = 0;
              selectionActive = false;
              redraw();
            });
        }, delay);
      };

      const finish = (value: string) => {
        clearDropdown(renderedRows);
        stdout.write('\r\x1b[2K');
        stdout.write(`${prompt}${value}\n`);
        cleanup();
        resolve(value);
      };

      const cancelSuggestDebounce = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        refreshSeq++;
      };

      /** ~/.yamx/history — hides suggestion rows while browsing. */
      const historyStepPrev = () => {
        if (history.length === 0) return;
        cancelSuggestDebounce();
        historyIndex = Math.max(0, historyIndex - 1);
        buffer = history[historyIndex] ?? buffer;
        cursor = buffer.length;
        acceptedSuggestionPrefix = '';
        suggestions = [];
        selectedIndex = 0;
        selectionActive = false;
        suppressSuggestionsForHistory = true;
        redraw();
      };

      const historyStepNext = () => {
        if (history.length === 0) return;
        cancelSuggestDebounce();
        historyIndex = Math.min(history.length, historyIndex + 1);
        buffer = historyIndex >= history.length ? '' : (history[historyIndex] ?? '');
        cursor = buffer.length;
        acceptedSuggestionPrefix = '';
        suggestions = [];
        selectedIndex = 0;
        selectionActive = false;
        if (buffer.trim().length < 3) {
          suppressSuggestionsForHistory = false;
          refreshSuggestions();
        } else {
          suppressSuggestionsForHistory = true;
          redraw();
        }
      };

      const onKeypress = (str: string, key: any) => {
        if (key?.ctrl && key?.name === 'c') {
          cleanup();
          reject(new Error('interrupted'));
          return;
        }
        if (key?.name === 'return' || key?.name === 'enter') {
          if (selectionActive && suggestions[selectedIndex]) {
            buffer = suggestions[selectedIndex].command;
            cursor = buffer.length;
            acceptedSuggestionPrefix = buffer;
            suggestions = [];
            selectedIndex = 0;
            selectionActive = false;
            redraw();
            return;
          }
          finish(buffer);
          return;
        }
        if (key?.name === 'backspace') {
          if (cursor <= 0) return;
          suppressSuggestionsForHistory = false;
          markEdit();
          buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
          cursor--;
          selectionActive = false;
          historyIndex = history.length;
          refreshSuggestions();
          return;
        }
        if (key?.name === 'delete') {
          if (cursor >= buffer.length) return;
          suppressSuggestionsForHistory = false;
          markEdit();
          buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1);
          selectionActive = false;
          historyIndex = history.length;
          refreshSuggestions();
          return;
        }
        if (key?.name === 'tab') {
          if (suppressSuggestionsForHistory && buffer.trim().length >= 3) {
            suppressSuggestionsForHistory = false;
            refreshSuggestions();
            return;
          }
          if (suggestions[selectedIndex]) {
            buffer = suggestions[selectedIndex].command;
            cursor = buffer.length;
            acceptedSuggestionPrefix = buffer;
            suggestions = [];
            selectedIndex = 0;
            selectionActive = false;
            redraw();
          }
          return;
        }
        if (key?.ctrl && key?.name === 'n' && suggestions.length > 0) {
          suppressSuggestionsForHistory = false;
          selectedIndex = selectionActive ? (selectedIndex + 1) % suggestions.length : 0;
          selectionActive = true;
          redraw();
          return;
        }
        if (key?.ctrl && key?.name === 'p' && suggestions.length > 0) {
          suppressSuggestionsForHistory = false;
          selectedIndex = selectionActive
            ? (selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1)
            : 0;
          selectionActive = true;
          redraw();
          return;
        }

        if (key?.ctrl && key?.name === 'up') {
          historyStepPrev();
          return;
        }
        if (key?.ctrl && key?.name === 'down') {
          historyStepNext();
          return;
        }
        if (key?.name === 'up') {
          if (!suppressSuggestionsForHistory && suggestions.length > 0) {
            selectedIndex = selectionActive
              ? (selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1)
              : 0;
            selectionActive = true;
            redraw();
            return;
          }
          historyStepPrev();
          return;
        }
        if (key?.name === 'down') {
          if (!suppressSuggestionsForHistory && suggestions.length > 0) {
            selectedIndex = selectionActive ? (selectedIndex + 1) % suggestions.length : 0;
            selectionActive = true;
            redraw();
            return;
          }
          historyStepNext();
          return;
        }
        if (key?.name === 'left') {
          cursor = Math.max(0, cursor - 1);
          selectionActive = false;
          redraw();
          return;
        }
        if (key?.name === 'right') {
          cursor = Math.min(buffer.length, cursor + 1);
          selectionActive = false;
          redraw();
          return;
        }
        if (key?.name === 'home' || (key?.ctrl && key?.name === 'a')) {
          cursor = 0;
          selectionActive = false;
          redraw();
          return;
        }
        if (key?.name === 'end' || (key?.ctrl && key?.name === 'e')) {
          cursor = buffer.length;
          selectionActive = false;
          redraw();
          return;
        }
        if (key?.ctrl && key?.name === 'u') {
          buffer = buffer.slice(cursor);
          cursor = 0;
          acceptedSuggestionPrefix = '';
          selectionActive = false;
          suppressSuggestionsForHistory = false;
          historyIndex = history.length;
          refreshSuggestions();
          return;
        }
        if (key?.name === 'escape') {
          if (suggestions.length > 0 || selectionActive) {
            suggestions = [];
            selectedIndex = 0;
            selectionActive = false;
            suppressSuggestionsForHistory = false;
            refreshSeq++;
            if (debounceTimer) {
              clearTimeout(debounceTimer);
              debounceTimer = null;
            }
            redraw();
          }
          return;
        }
        if (typeof str === 'string' && str >= ' ' && !str.includes('\r') && !str.includes('\n')) {
          suppressSuggestionsForHistory = false;
          markEdit();
          buffer = buffer.slice(0, cursor) + str + buffer.slice(cursor);
          cursor += str.length;
          selectionActive = false;
          historyIndex = history.length;
          refreshSuggestions();
        }
      };

      stdin.on('keypress', onKeypress);
      redraw();
    }),
    save,
    close: () => {
      closed = true;
      clearDropdown(renderedRows);
      if (stdin.isTTY) stdin.setRawMode(false);
    },
    clearPrompt: () => {
      clearDropdown(renderedRows);
      stdout.write('\r\x1b[2K');
      renderedRows = 0;
    },
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

async function executeDirectCommand(
  command: string,
  agent: Agent,
  autoApprove: boolean,
  diagnoseOnFailure = true
): Promise<void> {
  const ui = agent.getUI();
  const args = { command };
  const isDangerous = runCommand.isDangerous?.(args) ?? false;
  if (isDangerous && !autoApprove) {
    ui.approvalNeeded('run_command', args);
    const { approved } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'approved',
        message: 'This is a dangerous command. Proceed?',
        default: false,
      },
    ]);
    if (!approved) {
      ui.warn('Command denied.');
      ui.cueTTYAfterBulkOutput();
      return;
    }
  }

  ui.toolCall('run_command', args);
  const started = Date.now();
  setRunCommandAbortCheck(() => agent.isStopRequested());
  let result: string;
  try {
    result = await runCommand.execute(args);
  } finally {
    setRunCommandAbortCheck(null);
  }
  ui.toolResult('run_command', result, Date.now() - started);
  ui.cueTTYAfterBulkOutput();

  if (diagnoseOnFailure && isDirectShellFailure(result)) {
    const offlineFix = await suggestCommandFix(command).catch(() => null);
    if (offlineFix && offlineFix.command !== command && !(runCommand.isDangerous?.({ command: offlineFix.command }) ?? false)) {
      ui.info(`Offline command intelligence suggests: ${offlineFix.command}`);
      ui.toolCall('run_command', { command: offlineFix.command });
      const fixStarted = Date.now();
      setRunCommandAbortCheck(() => agent.isStopRequested());
      let fixedResult: string;
      try {
        fixedResult = await runCommand.execute({ command: offlineFix.command });
      } finally {
        setRunCommandAbortCheck(null);
      }
      ui.toolResult('run_command', fixedResult, Date.now() - fixStarted);
      ui.cueTTYAfterBulkOutput();
      if (!isDirectShellFailure(fixedResult)) return;

      await askAgentToRecoverFromDirectShellFailure(agent, command, result, offlineFix.command, fixedResult);
      return;
    }

    await askAgentToRecoverFromDirectShellFailure(agent, command, result);
  }
}

async function askAgentToRecoverFromDirectShellFailure(
  agent: Agent,
  command: string,
  result: string,
  offlineFixCommand?: string,
  offlineFixResult?: string
): Promise<void> {
  if (isDirectShellUserCancelled(result) || (offlineFixResult && isDirectShellUserCancelled(offlineFixResult))) {
    return;
  }
  const ui = agent.getUI();
  ui.neuralStatus('recover', offlineFixCommand
    ? 'offline correction also failed; asking agent to diagnose and continue'
    : 'direct shell command failed; asking agent to diagnose and continue');
    await agent.chat([
      '<yamx_direct_shell_failure>',
      `command=${command}`,
      `cwd=${process.cwd()}`,
      'The user ran this as a direct YamX shell command. It failed.',
      offlineFixCommand
        ? `YamX already tried the best offline command-intelligence correction: ${offlineFixCommand}`
        : 'YamX did not find a confident offline correction.',
      'Diagnose the failure from the output, then take the smallest useful next action inside YamX.',
      'Prefer project-local commands, package scripts, and existing local command intelligence. If the needed command is not present locally, propose or run the correct new command according to policy.',
      'If a fix is safe and local, apply it and rerun the narrow verification. If the next action is destructive, privileged, or network/install related, respect tool approval policy.',
      '',
      'Original output:',
      result.slice(0, 24_000),
      ...(offlineFixCommand && offlineFixResult
        ? [
            '',
            'Offline correction output:',
            offlineFixResult.slice(0, 24_000),
          ]
        : []),
      '</yamx_direct_shell_failure>',
    ].join('\n'));
}

async function resolveSessionRef(
  store: SessionStore,
  arg: string
): Promise<string | 'ambiguous' | null> {
  const t = arg.trim();
  if (!t) return null;
  const direct = await store.loadSession(t);
  if (direct) return direct.id;
  const list = await store.listSessions();
  const matches = list.filter((s) => s.id === t || s.id.startsWith(t));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) return 'ambiguous';
  return null;
}

// --- Onboard ---

async function chooseModel(provider: ProviderName, currentModel?: string): Promise<string> {
  const safeProvider = normalizeProviderName(provider);
  const models = PROVIDER_MODELS[safeProvider] || PROVIDER_MODELS.openrouter;
  const defaultModel = currentModel || (safeProvider === 'openrouter' ? 'deepseek-chat' : models[0]?.value);
  const choices = [
    ...models,
    ...(currentModel && !models.some((choice) => choice.value === currentModel)
      ? [{ name: `Keep current (${currentModel})`, value: currentModel }]
      : []),
    { name: 'Other (type manually)', value: 'other' },
  ];

  const { selectedModel } = await inquirer.prompt<{ selectedModel: string }>([
    {
      type: 'rawlist',
      name: 'selectedModel',
      message: `Choose model for ${safeProvider}:`,
      default: defaultModel,
      choices,
    },
  ]);

  if (selectedModel !== 'other') return selectedModel;
  const { customModel } = await inquirer.prompt<{ customModel: string }>([
    {
      type: 'input',
      name: 'customModel',
      message: 'Enter custom model name:',
      default: currentModel || '',
      validate: (value: string) => value.trim().length > 0 || 'Model name is required',
    },
  ]);
  return customModel.trim();
}

async function configureProviderAccess(config: Config, provider: ProviderName): Promise<void> {
  provider = normalizeProviderName(provider);
  if (provider === 'ollama') {
    const currentUrl = config.get().providers.ollama?.baseUrl || 'http://localhost:11434';
    const { url } = await inquirer.prompt<{ url: string }>([
      {
        type: 'input',
        name: 'url',
        message: 'Ollama base URL:',
        default: currentUrl,
        validate: (value: string) => value.trim().length > 0 || 'Base URL is required',
      },
    ]);
    config.set('providers.ollama.baseUrl', url.trim());
    return;
  }

  console.log(chalk.dim(`  Get your key: ${KEY_HINTS[provider]}`));
  const existingKey = (config.get().providers as any)?.[provider]?.apiKey || process.env[`${provider.toUpperCase()}_API_KEY`] || '';
  const { key } = await inquirer.prompt<{ key: string }>([
    {
      type: 'password',
      name: 'key',
      message: existingKey
        ? `API key for ${provider} (press Enter to keep existing):`
        : `API key for ${provider} (pasting is hidden):`,
      mask: '*',
      validate: (value: string) => {
        const finalValue = value || existingKey;
        return finalValue.trim().length > 8 || 'Key looks too short';
      },
    },
  ]);
  config.set(`providers.${provider}.apiKey`, (key || existingKey).trim());
}

async function configureRuntimeSettings(config: Config, firstRun: boolean): Promise<void> {
  const { tune } = await inquirer.prompt<{ tune: boolean }>([
    {
      type: 'confirm',
      name: 'tune',
      message: 'Configure runtime behavior now?',
      default: firstRun,
    },
  ]);
  if (!tune) return;

  const current = config.get().settings;
  const answers = await inquirer.prompt<{
    autoApprove: boolean;
    streamOut: boolean;
    modelCouncil: boolean;
    councilMode: 'adaptive' | 'always' | 'off';
    maxToolResultChars: string;
    checkForUpdates: boolean;
  }>([
    {
      type: 'confirm',
      name: 'autoApprove',
      message: 'Auto-approve tool runs by default? (unsafe)',
      default: current.autoApprove,
    },
    {
      type: 'confirm',
      name: 'streamOut',
      message: 'Stream model output?',
      default: current.streamOutput,
    },
    {
      type: 'confirm',
      name: 'modelCouncil',
      message: 'Enable hidden model council before agent replies?',
      default: current.modelCouncil?.enabled === true,
    },
    {
      type: 'rawlist',
      name: 'councilMode',
      message: 'Model council token mode:',
      default: current.modelCouncil?.mode || 'adaptive',
      choices: [
        { name: 'adaptive (recommended: use council only for complex work)', value: 'adaptive' },
        { name: 'always (best planning, higher token cost)', value: 'always' },
        { name: 'off (lowest cost)', value: 'off' },
      ],
    },
    {
      type: 'input',
      name: 'maxToolResultChars',
      message: 'Max tool-result chars kept in model history:',
      default: String(current.maxToolResultChars || 24_000),
      validate: (value: string) => {
        const n = Number(value);
        return (Number.isFinite(n) && n >= 4000 && n <= 100000) || 'Use a number between 4000 and 100000';
      },
    },
    {
      type: 'confirm',
      name: 'checkForUpdates',
      message:
        'Prompt to upgrade when a newer YamX is on npm? (checks at most once per 24h; uses npm install -g if you agree)',
      default: current.checkForUpdates === true,
    },
  ]);

  config.set('settings.autoApprove', answers.autoApprove);
  config.set('settings.streamOutput', answers.streamOut);
  config.set('settings.modelCouncil.enabled', answers.modelCouncil);
  config.set('settings.modelCouncil.mode', answers.councilMode);
  config.set('settings.maxToolResultChars', Number(answers.maxToolResultChars));
  config.set('settings.checkForUpdates', answers.checkForUpdates);
}

async function runOnboard(config: Config, options: { title?: string; firstRun?: boolean } = {}) {
  await config.load();

  const title = options.title || 'YamX · Setup / Switch Provider';
  const firstRun = options.firstRun ?? false;
  console.log(chalk.hex('#00FF41').bold(`\n  +==============[ ${title} ]==============+\n`));
  console.log(chalk.dim('  Change provider, API key, Ollama URL, default model, and runtime behavior.\n'));

  const { provider: selectedProvider } = await inquirer.prompt<{ provider: string }>([
    {
      type: 'rawlist',
      name: 'provider',
      message: 'Choose LLM provider:',
      default: config.get().defaultProvider || 'openrouter',
      choices: PROVIDER_CHOICES,
    },
  ]);
  const provider = normalizeProviderName(selectedProvider);

  await configureProviderAccess(config, provider);
  const model = await chooseModel(
    provider,
    config.get().defaultProvider === provider
      ? config.get().defaultModel || (provider === 'openrouter' ? 'deepseek-chat' : undefined)
      : (config.get().providers as any)?.[provider]?.model
  );
  await configureRuntimeSettings(config, firstRun);

  config.set('defaultProvider', provider);
  config.set('defaultModel', model);
  config.set(`providers.${provider}.model`, model);
  await config.save();

  console.log(chalk.green('\n  [+] Configuration saved to ~/.yamx/config.json'));
  console.log(chalk.dim(`  Provider: ${provider} | Model: ${model}`));
  console.log(chalk.dim(`  Tools: ${getToolCount()} | Streaming: ${config.get().settings.streamOutput} | Model council: ${config.get().settings.modelCouncil?.mode || 'adaptive'}`));
  console.log(chalk.hex('#00FF41')('\n  Run `yamx` to start coding.\n'));
}

// --- Diagnose ---

async function runDiagnose(config: Config, cfg: any) {
  console.log(chalk.bold('\n  YamX Diagnostic Report\n'));

  // Node version
  console.log(`  ${chalk.cyan('Node.js')}    ${process.version}`);
  console.log(`  ${chalk.cyan('Platform')}   ${process.platform} ${process.arch}`);
  console.log(`  ${chalk.cyan('YamX')}       v${VERSION}`);
  console.log(`  ${chalk.cyan('Tools')}      ${getToolCount()}`);
  console.log();

  // Config file
  const fs = await import('fs-extra');
  const path = await import('path');
  const os = await import('os');
  const configPath = path.default.join(os.default.homedir(), '.yamx', 'config.json');
  const configExists = await fs.default.pathExists(configPath);
  console.log(`  ${configExists ? TERM.ok : TERM.bad} Config file ${configExists ? 'exists' : 'missing'}: ${configPath}`);

  // Provider keys
  const providers: Exclude<ProviderName, 'ollama'>[] = [
    'openai',
    'anthropic',
    'gemini',
    'kimi',
    'grok',
    'openrouter',
  ];
  for (const p of providers) {
    const key = resolveCloudApiKey(cfg, p);
    const has = !!key;
    const mark = has ? TERM.ok : TERM.idle;
    console.log(`  ${mark} ${p.padEnd(12)} ${has ? `key: ${key.slice(0, 6)}...` : chalk.dim('not configured')}`);
  }

  // Ollama
  const ollamaUrl = cfg.providers?.ollama?.baseUrl || 'http://localhost:11434';
  try {
    const http = await import('http');
    await new Promise<void>((resolve, reject) => {
      const req = http.default.get(`${ollamaUrl}/api/tags`, { timeout: 3000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    console.log(`  ${TERM.ok} ollama       reachable at ${ollamaUrl}`);
  } catch {
    console.log(`  ${TERM.idle} ollama       ${chalk.dim(`not reachable at ${ollamaUrl}`)}`);
  }

  // Git
  try {
    const gitVer = execSync('git --version', { encoding: 'utf-8' }).trim();
    console.log(`  ${TERM.ok} git          ${gitVer}`);
  } catch {
    console.log(`  ${TERM.bad} git          not found`);
  }

  // Sessions
  const sessDir = path.default.join(os.default.homedir(), '.yamx', 'sessions');
  const sessionFiles = await fs.default.readdir(sessDir).catch(() => []);
  console.log(`  ${chalk.cyan('Sessions')}   ${sessionFiles.length} saved`);

  console.log(chalk.dim('\n  Default: ') + chalk.white(`${cfg.defaultProvider || 'openrouter'} / ${cfg.defaultModel || 'deepseek-chat'}`));
  console.log();
}

program.parse();
