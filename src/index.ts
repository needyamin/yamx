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
import os from 'node:os';
import nodePath from 'node:path';
import { createRequire } from 'node:module';
import { stdin, stdout } from 'node:process';
import { Agent } from './agent.js';
import { Config, type YamConfig } from './config.js';
import { ContextEngine } from './context.js';
import { UI } from './ui.js';
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GeminiProvider } from './providers/gemini.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { Provider, Message } from './providers/base.js';
import { execSync } from 'child_process';
import { SessionStore, type ChatSession } from './session-store.js';
import { getToolCount } from './tools/registry.js';
import { parseDirectCommand } from './direct-command.js';
import { runCommand } from './tools/shell.js';
import { handleCommand } from './commands/index.js';
import { buildAgentInputWithProjectIntel, shouldAttachProjectIntel } from './project-intel.js';
import { REPL_HISTORY_PATH, printReplHistory } from './repl-history.js';
import { DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS } from './assistant-output-cap.js';
import { ttyResetBeforeReplPrompt } from './tty-repl-cue.js';

dotenv.config();

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

type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'ollama';
const PROVIDER_NAMES = new Set<ProviderName>(['openai', 'anthropic', 'gemini', 'openrouter', 'ollama']);

const PROVIDER_CHOICES: Array<{ name: string; value: ProviderName }> = [
  { name: 'OpenRouter  (100+ models: DeepSeek, Llama, Claude, GPT, Gemini)', value: 'openrouter' },
  { name: 'OpenAI      (GPT-4o, GPT-4.1, o-series)', value: 'openai' },
  { name: 'Anthropic   (Claude Sonnet/Opus)', value: 'anthropic' },
  { name: 'Gemini      (Gemini Flash/Pro)', value: 'gemini' },
  { name: 'Ollama      (local models: Qwen, DeepSeek, Llama)', value: 'ollama' },
];

const KEY_HINTS: Record<Exclude<ProviderName, 'ollama'>, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
};

const PROVIDER_MODELS: Record<ProviderName, { name: string; value: string }[]> = {
  openai: [
    { name: 'GPT-4o', value: 'gpt-4o' },
    { name: 'GPT-4.1', value: 'gpt-4.1' },
    { name: 'o3', value: 'o3' },
    { name: 'o4-mini', value: 'o4-mini' },
  ],
  anthropic: [
    { name: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
    { name: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
    { name: 'Claude 3.7 Sonnet', value: 'claude-3-7-sonnet-20250219' },
  ],
  gemini: [
    { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
    { name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
    { name: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro' },
  ],
  openrouter: [
    { name: 'DeepSeek Chat V3 (recommended)', value: 'deepseek-chat' },
    { name: 'DeepSeek R1', value: 'deepseek-r1' },
    { name: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
    { name: 'GPT-4o', value: 'gpt-4o' },
    { name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
    { name: 'Llama 4 Maverick', value: 'llama-4-maverick' },
  ],
  ollama: [
    { name: 'Qwen 2.5 Coder', value: 'qwen2.5-coder' },
    { name: 'DeepSeek R1', value: 'deepseek-r1' },
    { name: 'Llama 3.1', value: 'llama3.1' },
    { name: 'CodeLlama', value: 'codellama' },
  ],
};

function normalizeProviderName(value: unknown): ProviderName {
  const provider = String(value || '').trim().toLowerCase() as ProviderName;
  return PROVIDER_NAMES.has(provider) ? provider : 'openrouter';
}

/** Cloud providers need an API key; local Ollama does not by default. */
function providerUsesApiKey(p: ProviderName): boolean {
  return p !== 'ollama';
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
  if (!providerUsesApiKey(p)) return false;
  const pk = cfg.providers?.[p] as { apiKey?: string } | undefined;
  const fromCfg = pk?.apiKey;
  const fromEnv = process.env[`${p.toUpperCase()}_API_KEY`];
  return !String(fromCfg || fromEnv || '').trim();
}

program
  .name('yamx')
  .description('YamX - agent CLI with persistent chat sessions')
  .version(VERSION)
  .option('-p, --provider <provider>', 'LLM provider (openai, anthropic, gemini, openrouter, ollama)', '')
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
        const pName = providerName.toUpperCase();
        const { key } = await inquirer.prompt([
          {
            type: 'password',
            name: 'key',
            message: `Enter your ${providerName} API key (pasting is hidden):`,
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
        envContent += `${pName}_API_KEY=${key}\n`;
        await fs.writeFile(envPath, envContent, 'utf-8');
        console.log(chalk.green(`\n  [+] Saved to ${envPath}`));

        // Inject into process.env so it works immediately
        process.env[`${pName}_API_KEY`] = key;
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

  if (currentSession.messages.length === 1) {
    console.log(chalk.dim('  /help — slash commands | history or /history [n] — ~/.yamx/history\n'));
  } else {
    console.log(); // Just a spacer if resuming chat
  }

  const inputSession = await createInputSession();

  process.on('SIGINT', async () => {
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
      await handleCommand(input, agent, provider, { store, session: currentSession, agent }, cfg, executeDirectCommand);
      agent.getUI().cueTTYAfterBulkOutput();
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
      await executeDirectCommand(directCommand, agent.getUI(), options.autoApprove || cfg.settings?.autoApprove || false);
      continue;
    }

    try {
      const agentInput = shouldAttachProjectIntel(input)
        ? await buildAgentInputWithProjectIntel(input)
        : input;
      await agent.chat(agentInput);
    } catch (error: any) {
      agent.getUI().error(`Fatal error: ${error.message}`);
    }
  }
});

async function createInputSession(): Promise<{
  question(prompt: string): Promise<string>;
  save(line: string): Promise<void>;
  close(): void;
}> {
  const historyPath = REPL_HISTORY_PATH;
  await fs.ensureDir(nodePath.dirname(historyPath));
  const history = await fs.readFile(historyPath, 'utf-8')
    .then((s) => s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .catch(() => [] as string[]);

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
    historySize: 500,
    removeHistoryDuplicates: true,
  });

  // readline keeps the newest entry first internally.
  (rl as any).history = [...history].reverse();

  async function save(line: string): Promise<void> {
    const existing = await fs.readFile(historyPath, 'utf-8')
      .then((s) => s.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))
      .catch(() => [] as string[]);
    const next = [...existing.filter((item) => item !== line), line].slice(-500);
    await fs.writeFile(historyPath, `${next.join('\n')}\n`, 'utf-8');
  }

  return {
    question: async (prompt: string) => {
      ttyResetBeforeReplPrompt();
      return rl.question(prompt);
    },
    save,
    close: () => rl.close(),
  };
}

async function executeDirectCommand(command: string, ui: UI, autoApprove: boolean): Promise<void> {
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
  const result = await runCommand.execute(args);
  ui.toolResult('run_command', result, Date.now() - started);
  ui.cueTTYAfterBulkOutput();
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
  ]);

  config.set('settings.autoApprove', answers.autoApprove);
  config.set('settings.streamOutput', answers.streamOut);
  config.set('settings.modelCouncil.enabled', answers.modelCouncil);
  config.set('settings.modelCouncil.mode', answers.councilMode);
  config.set('settings.maxToolResultChars', Number(answers.maxToolResultChars));
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
  const providers = ['openai', 'anthropic', 'gemini', 'openrouter'] as const;
  for (const p of providers) {
    const key = (cfg.providers as any)?.[p]?.apiKey || process.env[`${p.toUpperCase()}_API_KEY`];
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

  console.log(chalk.dim('\n  Default: ') + chalk.white(`${cfg.defaultProvider || 'openai'} / ${cfg.defaultModel || 'gpt-4o'}`));
  console.log();
}

// --- createProvider ---

function createProvider(name: string, model: string | undefined, cfg: any): Provider {
  switch (name) {
    case 'openai': {
      const key = cfg.providers?.openai?.apiKey || process.env.OPENAI_API_KEY;
      if (!key) throw new Error('OpenAI API key not found. Set OPENAI_API_KEY or run: yamx --onboard');
      return new OpenAIProvider(key, model || cfg.providers?.openai?.model || 'gpt-4o');
    }
    case 'anthropic': {
      const key = cfg.providers?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('Anthropic API key not found. Set ANTHROPIC_API_KEY or run: yamx --onboard');
      return new AnthropicProvider(key, model || cfg.providers?.anthropic?.model || 'claude-sonnet-4-20250514');
    }
    case 'gemini': {
      const key = cfg.providers?.gemini?.apiKey || process.env.GEMINI_API_KEY;
      if (!key) throw new Error('Gemini API key not found. Set GEMINI_API_KEY or run: yamx --onboard');
      return new GeminiProvider(key, model || cfg.providers?.gemini?.model || 'gemini-2.5-flash');
    }
    case 'ollama': {
      const baseUrl = cfg.providers?.ollama?.baseUrl || 'http://localhost:11434';
      return new OllamaProvider(baseUrl, model || cfg.providers?.ollama?.model || 'qwen2.5-coder');
    }
    case 'openrouter': {
      const key = cfg.providers?.openrouter?.apiKey || process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error('OpenRouter API key not found. Set OPENROUTER_API_KEY or run: yamx --onboard');
      return new OpenRouterProvider(key, model || cfg.providers?.openrouter?.model || 'deepseek-chat');
    }
    default:
      throw new Error(`Unknown provider: ${name}. Use: openai, anthropic, gemini, openrouter, ollama`);
  }
}

program.parse();
