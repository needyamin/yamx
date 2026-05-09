/**
 * YamX — terminal UI with rich markdown rendering
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import boxen from 'boxen';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { summarizeApiFailure } from './provider-error-format.js';

// Configure marked with terminal renderer for rich markdown output
marked.use(markedTerminal({
  reflowText: true,
  width: Math.min(process.stdout.columns || 100, 120),
  tab: 2,
}) as any);

const GOLD = chalk.hex('#E8C547');
const DIM = chalk.dim;
const SUCCESS = chalk.green;
const ERROR = chalk.red;
const WARNING = chalk.yellow;
const INFO = chalk.cyan;
const ACCENT = chalk.hex('#7CB9E8');
const TOOL_COLOR = chalk.magenta;

/** Banner greens */
const MX = chalk.hex('#00FF41');
const MX_DIM = chalk.hex('#008F11');
const MX_CORE = chalk.hex('#41FF70');

export type UIOptions = { verbose?: boolean };

export class UI {
  private spinner: Ora | null = null;
  private streamBuffer = '';
  private verbose = false;

  constructor(opts?: UIOptions) {
    this.verbose = opts?.verbose === true;
  }

  banner(provider: string, model: string, session?: { title?: string; id?: string }, toolCount = 0, version = 'dev', councilOn = false) {
    if (process.stdout.isTTY) console.clear();

    const threadTitle = session?.title ?? 'untitled';
    const threadId = session?.id?.slice(0, 8) ?? '--------';

    const inner = [
      ` ${MX_CORE('+')}${MX('==============[')} ${MX.bold('NEURAL LINK')} ${MX(']==============')}${MX_CORE('+')}`,
      ` ${MX_CORE('|')}  ${MX.bold('Y A M X')}  ${chalk.hex('#00FF41').dim(`v${version}`)}  ${MX_DIM('coding agent')}               ${MX_CORE('|')}`,
      ` ${MX_CORE('|')}  ${MX_DIM('encrypted session')} ${MX_DIM('|')} ${MX_DIM(`${toolCount || '?'} tools`)} ${MX_DIM('|')} ${MX_DIM('local-first powerhouse')} ${MX_CORE('|')}`,
      ` ${MX_CORE('+')}${MX('--------------')} ${MX_DIM('------------')} ${MX('--------------')}${MX_CORE('+')}`,
      '',
      `   ${MX_DIM('provider')} ${MX(provider)} ${MX_DIM('|')} ${MX_DIM('model')} ${MX(model)}`,
      `   ${MX_DIM('thread')} ${MX(threadTitle)} ${MX_DIM('|')} ${MX_DIM(threadId)}...`,
      `   ${MX_DIM('signal')} ${MX('online')} ${MX_DIM('|')} ${MX_DIM('council')} ${MX(councilOn ? 'on' : 'off')} ${MX_DIM('|')} ${MX_DIM('logs')} ${MX('ready')}`,
    ].join('\n');

    console.log('');
    console.log(
      boxen(inner, {
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        margin: { top: 0, bottom: 1 },
        borderStyle: 'single',
        borderColor: '#00FF41',
      })
    );
    console.log();
  }

  neuralStatus(stage: string, detail: string) {
    if (!this.verbose) return;
    console.log(`  ${MX('◈')} ${MX_DIM('[')}${MX(stage.toUpperCase())}${MX_DIM(']')} ${DIM(detail)}`);
  }

  help() {
    const sections: [string, [string, string][]][] = [
      ['Session', [
        ['/clear', 'Clear chat history'],
        ['/compact', 'Compress old context'],
        ['/exit', 'Save and quit'],
      ]],
      ['Memory', [
        ['/init', 'Create YamX memory files'],
        ['/memory', 'Show memory file status'],
        ['/remember', 'Save a durable note'],
      ]],
      ['Inspect', [
        ['/model', 'Provider & model'],
        ['/cost', 'Token usage & history'],
        ['/diff', 'Git diff'],
        ['/run', 'Execute shell command'],
        ['/log', 'Inspect logs: /log [file] --mode latest-error'],
        ['/status', 'Runtime/session snapshot'],
        ['/tools', 'List all tools'],
        ['/skills', 'List loaded skills'],
      ]],
      ['Subagents', [
        ['/agents', 'List built-in subagents'],
        ['/agent', 'Run custom subagent'],
        ['/explore', 'Read-only codebase analysis'],
        ['/plan', 'Read-only implementation plan'],
        ['/review', 'Review current changes'],
      ]],
      ['Edit', [
        ['/undo', 'Revert last file edits'],
      ]],
    ];

    console.log(chalk.bold('\n  ⌘ Commands\n'));
    for (const [category, commands] of sections) {
      console.log(`  ${ACCENT(category)}`);
      for (const [cmd, desc] of commands) {
        console.log(`    ${GOLD(cmd.padEnd(14))} ${DIM(desc)}`);
      }
      console.log();
    }
  }

  startThinking(text = 'Thinking…') {
    const prefix = this.verbose ? `${MX_DIM('[neural-link]')} ` : '';
    this.spinner = ora({
      text: `${prefix}${DIM(text)}`,
      color: 'green',
      spinner: 'dots',
    }).start();
  }

  updateSpinner(text: string) {
    if (this.spinner) {
      const prefix = this.verbose ? `${MX_DIM('[neural-link]')} ` : '';
      this.spinner.text = `${prefix}${DIM(text)}`;
    }
  }

  stopSpinner() {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  streamText(text: string) {
    this.stopSpinner();
    process.stdout.write(text);
    this.streamBuffer += text;
  }

  endStream() {
    if (this.streamBuffer) {
      console.log();
      this.streamBuffer = '';
    }
  }

  /** Render markdown content to the terminal with rich formatting */
  renderMarkdown(text: string): string {
    try {
      const rendered = marked.parse(text);
      return typeof rendered === 'string' ? rendered.trimEnd() : text;
    } catch {
      return text;
    }
  }

  toolCall(name: string, args: Record<string, unknown>) {
    this.stopSpinner();
    const argsStr = Object.entries(args)
      .map(([k, v]) => {
        const val =
          typeof v === 'string' && v.length > 80 ? `${v.slice(0, 77)}…` : v;
        return `${DIM(k)}=${chalk.white(JSON.stringify(val))}`;
      })
      .join(' ');
    if (!this.verbose) {
      console.log(`${DIM(`  › ${name}`)} ${argsStr}`.slice(0, (process.stdout.columns || 120) - 2));
      return;
    }
    console.log(`\n  ${MX('◈')} ${MX_DIM('[TOOL LINK]')} ${TOOL_COLOR.bold(name)} ${argsStr}`);
  }

  toolResult(name: string, result: string, duration: number) {
    const preview = result.length > 500 ? `${result.slice(0, 497)}…` : result;
    const lines = preview.split('\n');
    const maxLines = this.verbose ? 15 : 8;
    const headLines = this.verbose ? 12 : 6;
    const displayLines =
      lines.length > maxLines
        ? [...lines.slice(0, headLines), DIM(`  … ${lines.length - headLines} more lines`)]
        : lines;

    if (!this.verbose) {
      if (preview.trim()) {
        console.log(DIM(`  (${name} · ${duration}ms)`));
        for (const line of displayLines) {
          console.log(`    ${DIM(line)}`);
        }
      } else {
        console.log(DIM(`  (${name} · ${duration}ms · ok)`));
      }
      return;
    }

    console.log(`  ${SUCCESS('✓')} ${DIM(`[TOOL OK] ${name} · ${duration}ms`)}`);
    for (const line of displayLines) {
      console.log(`    ${DIM(line)}`);
    }
  }

  approvalNeeded(toolName: string, args: Record<string, unknown>): string {
    console.log(`\n  ${WARNING('⚠')} ${chalk.bold('Approve')} ${TOOL_COLOR(toolName)}`);
    for (const [k, v] of Object.entries(args)) {
      const val =
        typeof v === 'string' && v.length > 200 ? `${v.slice(0, 197)}…` : v;
      console.log(`    ${DIM(k)}: ${chalk.white(String(val))}`);
    }
    return '';
  }

  usage(input: number, output: number, totalInput: number, totalOutput: number) {
    console.log(
      DIM(`\n  Tokens ↑${input} ↓${output} · session ↑${totalInput} ↓${totalOutput}`)
    );
  }

  error(msg: string) {
    this.stopSpinner();
    console.log(`\n  ${ERROR('✗')} ${ERROR(msg)}`);
  }

  /**
   * Boxed provider / stream failures (parses embedded JSON bodies instead of dumping one long line).
   */
  apiFailure(kind: 'stream' | 'complete', err: unknown) {
    this.stopSpinner();
    const view = summarizeApiFailure(err);
    const title = kind === 'stream' ? ' Stream failed ' : ' API request failed ';
    const lines: string[] = [`${ERROR.bold(view.headline)}`];
    for (const d of view.detailLines) lines.push('');
    lines.push(...view.detailLines.map((d) => DIM(d)));
    if (view.hints.length) {
      lines.push('', DIM('What to try:'));
      lines.push(...view.hints.map((h) => `  ${WARNING('-')} ${DIM(h)}`));
    }
    if (view.technical) {
      lines.push('', DIM(view.technical));
    }
    const inner = lines.join('\n');
    console.log(
      '\n' +
        boxen(inner, {
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          margin: { top: 0, bottom: 1, left: 0, right: 0 },
          borderStyle: 'round',
          borderColor: '#FF4136',
          dimBorder: true,
          title: ERROR.bold(title.trim()),
          titleAlignment: 'left',
        }) +
        '\n'
    );
  }

  success(msg: string) {
    console.log(`\n  ${SUCCESS('✓')} ${msg}`);
  }

  info(msg: string) {
    console.log(`  ${INFO('○')} ${DIM(msg)}`);
  }

  warn(msg: string) {
    console.log(`  ${WARNING('⚠')} ${WARNING(msg)}`);
  }

  separator() {
    console.log(DIM('  ─'.repeat(28)));
  }

  /** Print a tools list grouped by category */
  toolsList(categories: Record<string, string[]>) {
    console.log(chalk.bold('\n  ⚡ Available Tools\n'));
    for (const [cat, tools] of Object.entries(categories)) {
      console.log(`  ${ACCENT(cat)}`);
      for (const t of tools) {
        console.log(`    ${GOLD(t)}`);
      }
      console.log();
    }
  }
}
