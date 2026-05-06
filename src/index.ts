#!/usr/bin/env node

/**
 * ⚡ YamX CLI
 * An advanced coding agent for the terminal.
 * Supports: OpenAI, Anthropic, Gemini, OpenRouter, Ollama (local)
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
import { OpenRouterProvider, OPENROUTER_MODELS } from './providers/openrouter.js';
import { Provider } from './providers/base.js';
import { execSync } from 'child_process';

dotenv.config();

const program = new Command();

program
  .name('yamx')
  .description('⚡ YamX - Advanced Coding Agent CLI')
  .version('2.0.0')
  .option('-p, --provider <provider>', 'LLM provider (openai, anthropic, gemini, openrouter, ollama)', '')
  .option('-m, --model <model>', 'Model name (e.g., gpt-4o, claude-sonnet-4-20250514, gemini-2.5-flash)')
  .option('--auto-approve', 'Auto-approve all tool actions (dangerous!)', false)
  .option('--no-stream', 'Disable streaming output')
  .option('-t, --temperature <temp>', 'Temperature (0-1)', '0.1')
  .option('--max-tokens <tokens>', 'Max output tokens', '16384');

/** Main chat command (default) */
program.action(async (options) => {
  const config = new Config();
  const cfg = await config.load();
  const ui = new UI();

  // Resolve provider
  const providerName = options.provider || cfg.defaultProvider || 'openai';
  const modelName = options.model || cfg.defaultModel;

  let provider: Provider;

  try {
    provider = createProvider(providerName, modelName, cfg);
  } catch (error: any) {
    ui.error(error.message);
    process.exit(1);
  }

  ui.banner(provider.name, provider.modelId);

  // Build context-aware system prompt
  const contextEngine = new ContextEngine();
  ui.startThinking('Scanning project...');
  const systemPrompt = await contextEngine.buildSystemPrompt();
  ui.stopSpinner();
  ui.info(`Project scanned. Ready to code.\n`);

  const agent = new Agent(provider, systemPrompt, {
    autoApprove: options.autoApprove || false,
    stream: options.stream !== false,
    maxTokens: parseInt(options.maxTokens) || 16384,
    temperature: parseFloat(options.temperature) || 0.1,
  });

  // Main REPL loop
  while (true) {
    let input: string;

    try {
      const response = await inquirer.prompt([
        {
          type: 'input',
          name: 'prompt',
          message: chalk.hex('#FFB800').bold('yamx ❯'),
          validate: (i: string) => i.trim().length > 0 || 'Enter a prompt or /help',
        },
      ]);
      input = response.prompt.trim();
    } catch {
      // Handle Ctrl+C
      console.log(chalk.dim('\nGoodbye! ⚡'));
      process.exit(0);
    }

    // Handle slash commands
    if (input.startsWith('/')) {
      await handleCommand(input, agent, provider);
      continue;
    }

    // Chat with agent
    try {
      await agent.chat(input);
    } catch (error: any) {
      agent.getUI().error(`Fatal error: ${error.message}`);
    }
  }
});

/** Config subcommand */
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
    } else if (action === 'view') {
      console.log(JSON.stringify(config.get(), null, 2));
    }
  });

/** Handle slash commands */
async function handleCommand(input: string, agent: Agent, provider: Provider) {
  const ui = agent.getUI();
  const cmd = input.split(' ')[0].toLowerCase();

  switch (cmd) {
    case '/help':
      ui.help();
      break;
    case '/exit':
    case '/quit':
      console.log(chalk.dim('\nGoodbye! ⚡'));
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

/** Create a provider from name */
function createProvider(name: string, model: string | undefined, cfg: any): Provider {
  switch (name) {
    case 'openai': {
      const key = cfg.providers?.openai?.apiKey || process.env.OPENAI_API_KEY;
      if (!key) throw new Error('OpenAI API key not found. Set OPENAI_API_KEY env var or run: yamx config');
      return new OpenAIProvider(key, model || cfg.providers?.openai?.model || 'gpt-4o');
    }
    case 'anthropic': {
      const key = cfg.providers?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('Anthropic API key not found. Set ANTHROPIC_API_KEY env var or run: yamx config');
      return new AnthropicProvider(key, model || cfg.providers?.anthropic?.model || 'claude-sonnet-4-20250514');
    }
    case 'gemini': {
      const key = cfg.providers?.gemini?.apiKey || process.env.GEMINI_API_KEY;
      if (!key) throw new Error('Gemini API key not found. Set GEMINI_API_KEY env var or run: yamx config');
      return new GeminiProvider(key, model || cfg.providers?.gemini?.model || 'gemini-2.5-flash');
    }
    case 'ollama': {
      const baseUrl = cfg.providers?.ollama?.baseUrl || 'http://localhost:11434';
      return new OllamaProvider(baseUrl, model || cfg.providers?.ollama?.model || 'qwen2.5-coder');
    }
    case 'openrouter': {
      const key = cfg.providers?.openrouter?.apiKey || process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error('OpenRouter API key not found. Set OPENROUTER_API_KEY env var or run: yamx config');
      return new OpenRouterProvider(key, model || cfg.providers?.openrouter?.model || 'deepseek-chat');
    }
    default:
      throw new Error(`Unknown provider: ${name}. Supported: openai, anthropic, gemini, openrouter, ollama`);
  }
}

program.parse();
