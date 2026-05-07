#!/usr/bin/env node

/**
 * YamX CLI v1.0.0 — coding agent with persistent sessions
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { Agent } from './agent.js';
import { Config } from './config.js';
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
import { getToolCount, getToolsByCategory } from './tools/registry.js';

dotenv.config();

const VERSION = '1.0.5';
const program = new Command();

program
  .name('yamx')
  .description('YamX — agent CLI with persistent chat sessions')
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
  .option('--onboard', 'First-time setup (keys, provider, model)', false)
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
          { name: 'Set API Key', value: 'apikey' },
          { name: 'Set Default Provider', value: 'provider' },
          { name: 'Set Default Model', value: 'model' },
          { name: 'Set context budget (chars for auto-summarize)', value: 'budget' },
          { name: 'Toggle Auto-Approve', value: 'autoapprove' },
          { name: 'View Current Config', value: 'view' },
        ],
      },
    ]);

    if (action === 'apikey') {
      const { provider } = await inquirer.prompt([
        {
          type: 'rawlist',
          name: 'provider',
          message: 'Select provider:',
          choices: ['openai', 'anthropic', 'gemini', 'openrouter'],
        },
      ]);
      const { key } = await inquirer.prompt([
        { type: 'password', name: 'key', message: `Enter ${provider} API key:` },
      ]);
      config.set(`providers.${provider}.apiKey`, key);
      await config.save();
      console.log(chalk.green(`✓ ${provider} API key saved.`));
    } else if (action === 'provider') {
      const { provider } = await inquirer.prompt([
        {
          type: 'rawlist',
          name: 'provider',
          message: 'Select default provider:',
          choices: ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama'],
        },
      ]);
      config.set('defaultProvider', provider);
      await config.save();
      console.log(chalk.green(`✓ Default provider set to ${provider}.`));
    } else if (action === 'model') {
      const { model } = await inquirer.prompt([
        { type: 'input', name: 'model', message: 'Enter default model name:' },
      ]);
      config.set('defaultModel', model);
      await config.save();
      console.log(chalk.green(`✓ Default model set to ${model}.`));
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
        console.log(chalk.green(`✓ contextBudgetChars = ${v}`));
      } else {
        console.log(chalk.yellow('Value too small; unchanged.'));
      }
    } else if (action === 'autoapprove') {
      const current = config.get().settings.autoApprove;
      const { approve } = await inquirer.prompt([
        { type: 'confirm', name: 'approve', message: `Enable auto-approve by default? (Currently: ${current})`, default: current },
      ]);
      config.set('settings.autoApprove', approve);
      await config.save();
      console.log(chalk.green(`✓ Auto-approve set to ${approve}.`));
    } else if (action === 'view') {
      const cfg = config.get();
      const safe = JSON.parse(JSON.stringify(cfg));
      // Mask API keys for display
      for (const p of Object.values(safe.providers || {})) {
        if (p && typeof p === 'object' && 'apiKey' in p) {
          const k = (p as any).apiKey as string;
          (p as any).apiKey = k ? `${k.slice(0, 8)}…${k.slice(-4)}` : '(not set)';
        }
      }
      console.log(JSON.stringify(safe, null, 2));
    }
  });

program.action(async (options) => {
  const config = new Config();
  const cfg = await config.load();
  const ui = new UI();
  const store = new SessionStore();
  await store.init();

  if (options.resetConfig) {
    await config.resetToDefaults();
    console.log(chalk.green('Config reset. Session files in ~/.yamx/sessions/ were not deleted.'));
    process.exit(0);
  }

  if (options.onboard) {
    await runOnboard(config);
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

  if (!configExists && !isCommandRun) {
    console.log(chalk.yellow('\nWelcome to YamX! Let\'s do a quick first-time setup.'));
    await runOnboard(config);
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
      console.log(chalk.hex('#FF4136').bold(`\n  ⚠ ${error.message.split('.')[0]}`)); // Just the first sentence

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
        await runOnboard(config);
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
        console.log(chalk.green(`\n  ✓ Saved to ${envPath}`));

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
  ui.startThinking('Scanning project…');
  const systemPrompt = await contextEngine.buildSystemPrompt();
  ui.stopSpinner();
  ui.info(`Project scanned · ${getToolCount()} tools loaded · ~/.yamx/sessions/\n`);

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
  });

  ui.banner(provider.name, provider.modelId, {
    title: currentSession.title,
    id: currentSession.id,
  });

  if (currentSession.messages.length === 1) {
    console.log(chalk.dim('\n  💡 Need ideas? Try:'));
    console.log(chalk.dim('  - "Create a new react app" or "Find all console.logs"'));
    console.log(chalk.dim('  - Type /tools to see what actions I can perform'));
    console.log(chalk.dim('  - Type /help for a list of all commands\n'));
  } else {
    console.log(); // Just a spacer if resuming chat
  }

  process.on('SIGINT', async () => {
    try {
      await saveToDisk();
    } catch {
      /* ignore */
    }
    console.log(chalk.dim('\nSaved. Bye.'));
    process.exit(0);
  });

  while (true) {
    let input: string;
    try {
      const response = await inquirer.prompt([
        {
          type: 'input',
          name: 'prompt',
          message: `${chalk.hex('#41FF70').bold('⚡ YamX')} ${chalk.hex('#00FF41')('›')}`,
          validate: (i: string) => i.trim().length > 0 || 'Type a task or /help',
        },
      ]);
      input = response.prompt.trim();
    } catch {
      await saveToDisk();
      console.log(chalk.dim('\nGoodbye.'));
      process.exit(0);
    }

    if (input.startsWith('/')) {
      await handleCommand(input, agent, provider, { store, session: currentSession, agent });
      continue;
    }

    try {
      await agent.chat(input);
    } catch (error: any) {
      agent.getUI().error(`Fatal error: ${error.message}`);
    }
  }
});

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

// ─── Onboard ────────────────────────────────────────────────────────

async function runOnboard(config: Config) {
  await config.load();

  console.log(chalk.hex('#00FF41').bold('\n  ╔══════════════════════════════════════╗'));
  console.log(chalk.hex('#00FF41').bold('  ║       YamX · First-Time Setup        ║'));
  console.log(chalk.hex('#00FF41').bold('  ╚══════════════════════════════════════╝\n'));

  const { provider } = await inquirer.prompt<{ provider: string }>([
    {
      type: 'rawlist',
      name: 'provider',
      message: 'Default LLM provider:',
      default: config.get().defaultProvider || 'openai',
      choices: [
        { name: 'OpenRouter  (100+ models: DeepSeek, Llama, Claude, GPT, Gemini)', value: 'openrouter' },
        { name: 'OpenAI     (GPT-4o, o3, GPT-4.1)', value: 'openai' },
        { name: 'Anthropic  (Claude Sonnet 4, Claude Opus 4)', value: 'anthropic' },
        { name: 'Gemini     (Gemini 2.5 Flash/Pro)', value: 'gemini' },
        { name: 'Ollama     (local: Qwen, DeepSeek, Llama)', value: 'ollama' },
      ],
    },
  ]);

  if (provider !== 'ollama') {
    const keyHints: Record<string, string> = {
      openai: 'https://platform.openai.com/api-keys',
      anthropic: 'https://console.anthropic.com/settings/keys',
      gemini: 'https://aistudio.google.com/apikey',
      openrouter: 'https://openrouter.ai/keys',
    };
    console.log(chalk.dim(`  Get your key: ${keyHints[provider]}`));

    const existingKey = (config.get().providers as any)?.[provider]?.apiKey || process.env[`${provider.toUpperCase()}_API_KEY`] || '';
    const { key } = await inquirer.prompt<{ key: string }>([
      {
        type: 'password',
        name: 'key',
        message: `API key for ${provider} (pasting is hidden):`,
        mask: '*',
        default: existingKey,
        validate: (k: string) => {
          const val = k || existingKey;
          return val.trim().length > 8 || 'Key looks too short';
        },
      },
    ]);
    const finalKey = key || existingKey;
    config.set(`providers.${provider}.apiKey`, finalKey.trim());
  } else {
    const { url } = await inquirer.prompt<{ url: string }>([
      {
        type: 'input',
        name: 'url',
        message: 'Ollama base URL:',
        default: 'http://localhost:11434',
      },
    ]);
    config.set('providers.ollama.baseUrl', url);
  }

  const providerModels: Record<string, { name: string, value: string }[]> = {
    openai: [
      { name: 'GPT-4o', value: 'gpt-4o' },
      { name: 'o3-mini', value: 'o3-mini' },
      { name: 'GPT-4.5 Preview', value: 'gpt-4.5-preview' }
    ],
    anthropic: [
      { name: 'Claude 3.7 Sonnet', value: 'claude-3-7-sonnet-20250219' },
      { name: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-latest' },
      { name: 'Claude 3 Opus', value: 'claude-3-opus-latest' }
    ],
    gemini: [
      { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
      { name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' }
    ],
    openrouter: [
      { name: 'DeepSeek Chat V3', value: 'deepseek/deepseek-chat' },
      { name: 'DeepSeek R1', value: 'deepseek/deepseek-r1' },
      { name: 'Claude 3.7 Sonnet', value: 'anthropic/claude-3.7-sonnet' },
      { name: 'GPT-4o', value: 'openai/gpt-4o' },
      { name: 'Llama 3 (70B)', value: 'meta-llama/llama-3-70b-instruct' }
    ],
    ollama: [
      { name: 'Qwen 2.5 Coder', value: 'qwen2.5-coder' },
      { name: 'DeepSeek R1', value: 'deepseek-r1' },
      { name: 'Llama 3', value: 'llama3' }
    ]
  };

  const choices = [...providerModels[provider], { name: 'Other (type manually)', value: 'other' }];

  const { selectedModel } = await inquirer.prompt<{ selectedModel: string }>([
    {
      type: 'rawlist',
      name: 'selectedModel',
      message: 'Default model:',
      choices,
    },
  ]);

  let model = selectedModel;
  if (selectedModel === 'other') {
    const { customModel } = await inquirer.prompt<{ customModel: string }>([
      { type: 'input', name: 'customModel', message: 'Enter custom model name:' }
    ]);
    model = customModel.trim();
  }

  const { autoApprove } = await inquirer.prompt<{ autoApprove: boolean }>([
    {
      type: 'confirm',
      name: 'autoApprove',
      message: 'Auto-approve tool runs by default? (unsafe)',
      default: false,
    },
  ]);

  const { streamOut } = await inquirer.prompt<{ streamOut: boolean }>([
    {
      type: 'confirm',
      name: 'streamOut',
      message: 'Stream model output?',
      default: true,
    },
  ]);

  config.set('defaultProvider', provider);
  config.set('defaultModel', model);
  config.set('settings.autoApprove', autoApprove);
  config.set('settings.streamOutput', streamOut);
  await config.save();

  console.log(chalk.green('\n  ✓ Configuration saved to ~/.yamx/config.json'));
  console.log(chalk.dim(`  Provider: ${provider} · Model: ${model}`));
  console.log(chalk.dim(`  Tools: ${getToolCount()} · Streaming: ${streamOut}`));
  console.log(chalk.hex('#00FF41')('\n  Run `yamx` to start coding.\n'));
}

// ─── Diagnose ───────────────────────────────────────────────────────

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
  console.log(`  ${configExists ? chalk.green('✓') : chalk.red('✗')} Config file ${configExists ? 'exists' : 'missing'}: ${configPath}`);

  // Provider keys
  const providers = ['openai', 'anthropic', 'gemini', 'openrouter'] as const;
  for (const p of providers) {
    const key = (cfg.providers as any)?.[p]?.apiKey || process.env[`${p.toUpperCase()}_API_KEY`];
    const has = !!key;
    const mark = has ? chalk.green('✓') : chalk.dim('○');
    console.log(`  ${mark} ${p.padEnd(12)} ${has ? `key: ${key.slice(0, 6)}…` : chalk.dim('not configured')}`);
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
    console.log(`  ${chalk.green('✓')} ollama       reachable at ${ollamaUrl}`);
  } catch {
    console.log(`  ${chalk.dim('○')} ollama       ${chalk.dim(`not reachable at ${ollamaUrl}`)}`);
  }

  // Git
  try {
    const gitVer = execSync('git --version', { encoding: 'utf-8' }).trim();
    console.log(`  ${chalk.green('✓')} git          ${gitVer}`);
  } catch {
    console.log(`  ${chalk.red('✗')} git          not found`);
  }

  // Sessions
  const sessDir = path.default.join(os.default.homedir(), '.yamx', 'sessions');
  const sessionFiles = await fs.default.readdir(sessDir).catch(() => []);
  console.log(`  ${chalk.cyan('Sessions')}   ${sessionFiles.length} saved`);

  console.log(chalk.dim('\n  Default: ') + chalk.white(`${cfg.defaultProvider || 'openai'} / ${cfg.defaultModel || 'gpt-4o'}`));
  console.log();
}

// ─── Commands ───────────────────────────────────────────────────────

type PersistCtx = { store: SessionStore; session: ChatSession; agent: Agent };

async function handleCommand(
  input: string,
  agent: Agent,
  provider: Provider,
  persistCtx?: PersistCtx
) {
  const ui = agent.getUI();
  const cmd = input.split(' ')[0].toLowerCase();

  const save = async () => {
    if (!persistCtx) return;
    persistCtx.session.messages = agent.getHistory();
    persistCtx.store.updateTitleFromFirstMessage(persistCtx.session);
    await persistCtx.store.saveSession(persistCtx.session);
  };

  switch (cmd) {
    case '/help':
      ui.help();
      break;
    case '/exit':
    case '/quit':
      await save();
      console.log(chalk.dim('\nGoodbye.'));
      process.exit(0);
    case '/clear':
      agent.clearHistory();
      break;
    case '/compact':
      await agent.compact();
      break;
    case '/undo':
      await agent.undo();
      break;
    case '/model':
      ui.info(`Provider: ${provider.name} | Model: ${provider.modelId}`);
      break;
    case '/cost': {
      const stats = agent.getUsageStats();
      ui.info(`Session tokens: ↑${stats.totalInputTokens.toLocaleString()} ↓${stats.totalOutputTokens.toLocaleString()}`);
      ui.info(`History: ${stats.historyLength} messages · ${(stats.historyChars / 1000).toFixed(0)}k chars`);
      break;
    }
    case '/diff':
      try {
        const diff = execSync('git diff', { encoding: 'utf-8', cwd: process.cwd() });
        console.log(diff || chalk.dim('  (no changes)'));
      } catch {
        ui.warn('Not a git repository or git not available.');
      }
      break;
    case '/tools':
      ui.toolsList(getToolsByCategory());
      break;
    default:
      ui.warn(`Unknown command: ${cmd}. Type /help for available commands.`);
  }
}

// ─── Provider factory ───────────────────────────────────────────────

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
