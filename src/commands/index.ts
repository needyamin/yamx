import chalk from 'chalk';
import { execSync } from 'child_process';
import { Agent } from '../agent.js';
import { MemoryManager } from '../memory.js';
import { Provider } from '../providers/base.js';
import { SessionStore, type ChatSession } from '../session-store.js';
import { SkillManager } from '../skills.js';
import { BuiltinSubagent, SubagentRunner } from '../subagents.js';
import { getToolsByCategory } from '../tools/registry.js';
import { UI } from '../ui.js';

export type PersistCtx = { store: SessionStore; session: ChatSession; agent: Agent };

export async function handleCommand(
  input: string,
  agent: Agent,
  provider: Provider,
  persistCtx: PersistCtx | undefined,
  cfg: any,
  runShellCommand: (command: string, ui: UI, autoApprove: boolean) => Promise<void>
): Promise<void> {
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
    case '/run': {
      const command = input.slice('/run'.length).trim();
      if (!command) {
        ui.warn('Usage: /run <command>');
        break;
      }
      await runShellCommand(command, ui, cfg?.settings?.autoApprove || false);
      break;
    }
    case '/init': {
      const memory = new MemoryManager();
      const created = await memory.initProjectMemory();
      if (created.length === 0) {
        ui.info('YamX memory files already exist.');
      } else {
        ui.success(`Initialized YamX memory:\n${created.map((p) => `  ${p}`).join('\n')}`);
      }
      break;
    }
    case '/memory':
      console.log(await new MemoryManager().describeMemoryFiles());
      break;
    case '/remember': {
      const rest = input.slice('/remember'.length).trim();
      if (!rest) {
        ui.warn('Usage: /remember <note> or /remember user:<note>');
        break;
      }
      const scope = rest.toLowerCase().startsWith('user:') ? 'user' : 'project';
      const text = scope === 'user' ? rest.slice('user:'.length).trim() : rest;
      const file = await new MemoryManager().remember(text, scope);
      ui.success(`Remembered in ${file}`);
      break;
    }
    case '/model':
      ui.info(`Provider: ${provider.name} | Model: ${provider.modelId}`);
      break;
    case '/cost': {
      const stats = agent.getUsageStats();
      ui.info(`Session tokens: up ${stats.totalInputTokens.toLocaleString()} down ${stats.totalOutputTokens.toLocaleString()}`);
      ui.info(`History: ${stats.historyLength} messages; ${(stats.historyChars / 1000).toFixed(0)}k chars`);
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
    case '/skills':
      console.log(await new SkillManager().describe());
      break;
    case '/agents':
      console.log(await new SubagentRunner(provider).describe());
      break;
    case '/agent':
      await runNamedSubagent(input, provider, ui, cfg);
      break;
    case '/explore':
    case '/plan':
    case '/review':
      await runBuiltinSubagent(cmd, input, provider, ui, cfg);
      break;
    default:
      ui.warn(`Unknown command: ${cmd}. Type /help for available commands.`);
  }
}

async function runNamedSubagent(input: string, provider: Provider, ui: UI, cfg: any): Promise<void> {
  if (cfg?.settings?.subagents?.enabled === false) {
    ui.warn('Subagents are disabled in config.');
    return;
  }
  const rest = input.slice('/agent'.length).trim();
  const [name, ...taskParts] = rest.split(/\s+/);
  if (!name) {
    ui.warn('Usage: /agent <name> <task>');
    return;
  }
  await runSubagent(name, taskParts.join(' '), provider, ui);
}

async function runBuiltinSubagent(cmd: string, input: string, provider: Provider, ui: UI, cfg: any): Promise<void> {
  if (cfg?.settings?.subagents?.enabled === false) {
    ui.warn('Subagents are disabled in config.');
    return;
  }
  const name = cmd === '/explore' ? 'explorer' : cmd === '/plan' ? 'planner' : 'reviewer';
  const task = input.slice(cmd.length).trim();
  await runSubagent(name as BuiltinSubagent, task, provider, ui);
}

async function runSubagent(name: string, task: string, provider: Provider, ui: UI): Promise<void> {
  ui.startThinking(`Running ${name} subagent...`);
  try {
    const result = await new SubagentRunner(provider).run(name, task);
    ui.stopSpinner();
    console.log('\n' + ui.renderMarkdown(result));
  } catch (error: any) {
    ui.stopSpinner();
    ui.error(`Subagent failed: ${error.message}`);
  }
}
