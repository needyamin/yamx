/**
 * YamX — terminal UI
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import boxen from 'boxen';

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

export class UI {
  private spinner: Ora | null = null;
  private streamBuffer = '';

  banner(provider: string, model: string, session?: { title?: string; id?: string }) {
    if (process.stdout.isTTY) console.clear();

    const threadTitle = session?.title ?? 'untitled';
    const threadId = session?.id?.slice(0, 8) ?? '--------';

    const inner = [
      ` ${MX_CORE('+')}${MX('==============[')} ${MX.bold('NEURAL LINK')} ${MX(']==============')}${MX_CORE('+')}`,
      ` ${MX_CORE('|')}  ${MX.bold('Y A M X')}   ${MX_DIM('terminal coding agent')}                   ${MX_CORE('|')}`,
      ` ${MX_CORE('|')}  ${MX_DIM('encrypted session')} ${MX_DIM('|')} ${MX_DIM('local-first tools')}             ${MX_CORE('|')}`,
      ` ${MX_CORE('+')}${MX('--------------')} ${MX_DIM('------------')} ${MX('--------------')}${MX_CORE('+')}`,
      '',
      `   ${MX_DIM('provider')} ${MX(provider)} ${MX_DIM('|')} ${MX_DIM('model')} ${MX(model)}`,
      `   ${MX_DIM('thread')} ${MX(threadTitle)} ${MX_DIM('|')} ${MX_DIM(threadId)}...`,
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

  help() {
    const commands: [string, string][] = [
      ['/help', 'This list'],
      ['/clear', 'Clear history'],
      ['/model', 'Provider & model'],
      ['/compact', 'Summarize old context'],
      ['/cost', 'Token usage'],
      ['/undo', 'Revert last file edits'],
      ['/diff', 'git diff'],
      ['/exit', 'Quit'],
    ];
    console.log(chalk.bold('\n  Commands\n'));
    for (const [cmd, desc] of commands) {
      console.log(`  ${GOLD(cmd.padEnd(12))} ${DIM(desc)}`);
    }
    console.log();
  }

  startThinking(text = 'Thinking…') {
    this.spinner = ora({
      text: DIM(text),
      color: 'green',
      spinner: 'dots',
    }).start();
  }

  updateSpinner(text: string) {
    if (this.spinner) this.spinner.text = DIM(text);
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

  toolCall(name: string, args: Record<string, unknown>) {
    this.stopSpinner();
    const argsStr = Object.entries(args)
      .map(([k, v]) => {
        const val =
          typeof v === 'string' && v.length > 80 ? `${v.slice(0, 77)}…` : v;
        return `${DIM(k)}=${chalk.white(JSON.stringify(val))}`;
      })
      .join(' ');
    console.log(`\n  ${TOOL_COLOR('▸')} ${TOOL_COLOR.bold(name)} ${argsStr}`);
  }

  toolResult(name: string, result: string, duration: number) {
    const preview = result.length > 500 ? `${result.slice(0, 497)}…` : result;
    const lines = preview.split('\n');
    const displayLines =
      lines.length > 15
        ? [...lines.slice(0, 12), DIM(`  … ${lines.length - 12} more lines`)]
        : lines;

    console.log(`  ${SUCCESS('✓')} ${DIM(`${name} · ${duration}ms`)}`);
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
}
