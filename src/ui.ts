/**
 * YamX - Terminal UI
 * Rich terminal interface with markdown rendering, spinners, diffs, and styled output.
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import boxen from 'boxen';

const BRAND = chalk.hex('#FFB800'); // Yam Gold
const DIM = chalk.dim;
const SUCCESS = chalk.green;
const ERROR = chalk.red;
const WARNING = chalk.yellow;
const INFO = chalk.cyan;
const TOOL_COLOR = chalk.magenta;

export class UI {
  private spinner: Ora | null = null;
  private streamBuffer = '';

  /** Show the startup banner */
  banner(provider: string, model: string) {
    const title = BRAND.bold('  ⚡ YamX  ');
    const subtitle = DIM(`Provider: ${provider} | Model: ${model}`);
    console.log(boxen(`${title}\n${subtitle}`, {
      padding: 1,
      margin: { top: 1, bottom: 0, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'yellow',
    }));
    console.log(DIM('  Type your request. Commands: /help, /clear, /model, /exit\n'));
  }

  /** Show help text */
  help() {
    const commands = [
      ['/help', 'Show this help message'],
      ['/clear', 'Clear conversation history'],
      ['/model', 'Show current model info'],
      ['/compact', 'Summarize history to save context'],
      ['/cost', 'Show token usage & estimated cost'],
      ['/undo', 'Undo last file changes'],
      ['/diff', 'Show git diff of recent changes'],
      ['/exit', 'Exit Yam Agent'],
    ];

    console.log(chalk.bold('\n  Available Commands:\n'));
    for (const [cmd, desc] of commands) {
      console.log(`  ${BRAND(cmd.padEnd(14))} ${DIM(desc)}`);
    }
    console.log();
  }

  /** Start thinking spinner */
  startThinking(text = 'Thinking...') {
    this.spinner = ora({
      text: DIM(text),
      color: 'yellow',
      spinner: 'dots',
    }).start();
  }

  /** Update spinner text */
  updateSpinner(text: string) {
    if (this.spinner) this.spinner.text = DIM(text);
  }

  /** Stop spinner */
  stopSpinner() {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  /** Stream a text chunk to stdout */
  streamText(text: string) {
    this.stopSpinner();
    process.stdout.write(text);
    this.streamBuffer += text;
  }

  /** End streaming and add newline */
  endStream() {
    if (this.streamBuffer) {
      console.log(); // newline after stream
      this.streamBuffer = '';
    }
  }

  /** Show a tool being called */
  toolCall(name: string, args: any) {
    this.stopSpinner();
    const argsStr = Object.entries(args)
      .map(([k, v]) => {
        const val = typeof v === 'string' && v.length > 80
          ? v.slice(0, 77) + '...'
          : v;
        return `${DIM(k)}=${chalk.white(JSON.stringify(val))}`;
      })
      .join(' ');
    console.log(`\n  ${TOOL_COLOR('⚡')} ${TOOL_COLOR.bold(name)} ${argsStr}`);
  }

  /** Show tool result */
  toolResult(name: string, result: string, duration: number) {
    const preview = result.length > 500
      ? result.slice(0, 497) + '...'
      : result;
    const lines = preview.split('\n');
    const displayLines = lines.length > 15
      ? [...lines.slice(0, 12), DIM(`  ... (${lines.length - 12} more lines)`)]
      : lines;

    console.log(`  ${SUCCESS('✓')} ${DIM(`${name} completed in ${duration}ms`)}`);
    for (const line of displayLines) {
      console.log(`    ${DIM(line)}`);
    }
  }

  /** Show approval prompt for dangerous actions */
  approvalNeeded(toolName: string, args: any): string {
    const msg = `\n  ${WARNING('⚠')} ${chalk.bold('Approval needed:')} ${TOOL_COLOR(toolName)}`;
    console.log(msg);
    for (const [k, v] of Object.entries(args)) {
      const val = typeof v === 'string' && v.length > 200
        ? v.slice(0, 197) + '...'
        : v;
      console.log(`    ${DIM(k)}: ${chalk.white(String(val))}`);
    }
    return '';
  }

  /** Show token usage */
  usage(input: number, output: number, totalInput: number, totalOutput: number) {
    console.log(DIM(`\n  Tokens: ↑${input} ↓${output} | Session: ↑${totalInput} ↓${totalOutput}`));
  }

  /** Show error */
  error(msg: string) {
    this.stopSpinner();
    console.log(`\n  ${ERROR('✗')} ${ERROR(msg)}`);
  }

  /** Show success */
  success(msg: string) {
    console.log(`\n  ${SUCCESS('✓')} ${msg}`);
  }

  /** Show info */
  info(msg: string) {
    console.log(`  ${INFO('ℹ')} ${DIM(msg)}`);
  }

  /** Show a warning */
  warn(msg: string) {
    console.log(`  ${WARNING('⚠')} ${WARNING(msg)}`);
  }

  /** Separator */
  separator() {
    console.log(DIM('  ─'.repeat(40)));
  }
}
