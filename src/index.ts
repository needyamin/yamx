#!/usr/bin/env node

/**
 * YamX CLI — coding agent with persistent sessions
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

dotenv.config();

const program = new Command();

program
  .name('yamx')
  .description('YamX — agent CLI with persistent chat sessions')
  .version('2.0.0')
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
  .option('--reset-config', 'Reset ~/.yamx/config.json to defaults, then exit', false);

program
  .command('config')
  .description('Configure YamX (API keys, defaults)')
  .action(async () => {
    const config = new Config();
    await config.load();

    const { action } = await inquirer.prompt([
      {
        type: 'list',
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
          type: 'list',
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
          type: 'list',
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
      console.log(JSON.stringify(config.get(), null, 2));
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

  if (options.history) {
    const sessions = await store.listSessions();
    if (sessions.length === 0) {
      console.log(chalk.dim('No saved conversations yet.'));
      process.exit(0);
    }
    console.log(chalk.bold('\nSaved conversations\n'));
    for (const s of sessions) {
      const active = (await store.getActiveSessionId()) === s.id ? chalk.green('* ') : '  ';
      console.log(
        `${active}${chalk.cyan(s.id)}  ${chalk.dim(s.updatedAt)}  ${s.title}`
      );
    }
    console.log(chalk.dim('\nResume: yamx --resume <id>\n'));
    process.exit(0);
  }

  const delArg = options.deleteChat != null ? String(options.deleteChat).trim() : '';
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

  const providerName = options.provider || cfg.defaultProvider || 'openai';
  const modelName = options.model || cfg.defaultModel;
  let provider: Provider;
  try {
    provider = createProvider(providerName, modelName, cfg);
  } catch (error: any) {
    ui.error(error.message);
    process.exit(1);
  }

  const contextEngine = new ContextEngine();
  ui.startThinking('Scanning project…');
  const systemPrompt = await contextEngine.buildSystemPrompt();
  ui.stopSpinner();
  ui.info(`Project scanned. Session storage: ~/.yamx/sessions/\n`);

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
      ui.error(`No session matching “${options.resume}”. Use: yamx --history`);
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

  const persistCtx = { store, session: currentSession, agent };

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
          message: `${chalk.hex('#41FF70').bold('yamx')} ${chalk.hex('#00FF41')('›')}`,
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
      await handleCommand(input, agent, provider, persistCtx);
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

async function runOnboard(config: Config) {
  await config.load();
  const { provider } = await inquirer.prompt<{ provider: string }>([
    {
      type: 'list',
      name: 'provider',
      message: 'Default LLM provider:',
      choices: ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama'],
    },
  ]);

  if (provider !== 'ollama') {
    const { key } = await inquirer.prompt<{ key: string }>([
      { type: 'password', name: 'key', message: `API key for ${provider}:` },
    ]);
    config.set(`providers.${provider}.apiKey`, key);
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

  const modelDefaults: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    gemini: 'gemini-2.5-flash',
    openrouter: 'deepseek-chat',
    ollama: 'qwen2.5-coder',
  };
  const { model } = await inquirer.prompt<{ model: string }>([
    {
      type: 'input',
      name: 'model',
      message: 'Default model:',
      default: modelDefaults[provider],
    },
  ]);

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
  console.log(chalk.green('\nSaved. Run `yamx` to start.\n'));
}

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
      ui.info(`Session tokens: ↑${stats.totalInputTokens} ↓${stats.totalOutputTokens}`);
      ui.info(`History length: ${stats.historyLength} messages`);
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
    default:
      ui.warn(`Unknown command: ${cmd}. Type /help for available commands.`);
  }
}

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
      throw new Error(`Unknown provider: ${name}`);
  }
}

program.parse();
