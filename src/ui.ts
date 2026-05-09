/**
 * YamX — terminal UI with rich markdown rendering
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import boxen from 'boxen';
import stripAnsi from 'strip-ansi';
import wrapAnsi from 'wrap-ansi';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { summarizeApiFailure } from './provider-error-format.js';
import {
  capAssistantMarkdownSource,
  DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS,
} from './assistant-output-cap.js';
import {
  BODY_LEFT_GUTTER,
  BODY_RIGHT_GUTTER,
  terminalBodyWidthChars,
  wrapIndentedBodyBlock,
  wrapWidthForIndentedBody,
  panelInnerWrapWidth,
} from './terminal-layout.js';
import { ttyCueAfterBulkOutput, ttyResetBeforeReplPrompt } from './tty-repl-cue.js';

const DIM = chalk.dim;

/** YamX-aligned terminal Markdown (streaming & static render share this preset). */
function yamxMarkedTerminal() {
  return markedTerminal({
    reflowText: false,
    width: Math.max(32, wrapWidthForIndentedBody()),
    tab: 2,
    showSectionPrefix: false,
    emoji: false,
    paragraph: chalk.reset,
    heading: chalk.hex('#6EE89F').bold,
    firstHeading: chalk.hex('#00FF41').bold,
    hr: (line: string) => DIM(typeof line === 'string' ? line.trimEnd() : line),
    blockquote: chalk.hex('#93C5FD').italic,
    html: DIM,
    link: chalk.cyan,
    href: chalk.cyan.underline,
    strong: chalk.white.bold,
    em: chalk.italic.hex('#C7F9D8'),
    codespan: chalk.hex('#FDE047'),
    code: chalk.hex('#FACC15'),
    listitem: chalk.hex('#DCFCE7'),
  }) as any;
}

marked.use(yamxMarkedTerminal());

const GOLD = chalk.hex('#E8C547');
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

function visLen(s: string): number {
  return stripAnsi(s).length;
}

/** Right-pad ANSI string to a visible width (no truncation here — clip inputs beforehand). */
function padVis(ans: string, w: number): string {
  const n = visLen(ans);
  if (n >= w) return ans;
  return ans + ' '.repeat(w - n);
}

function clipField(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

/** Show large command output (e.g. ipconfig) without chopping mid-line; model still receives full text. */
const TOOL_RESULT_DISPLAY_MAX_CHARS = 48_000;
const TOOL_RESULT_MAX_LINES_NORMAL = 250;
const TOOL_RESULT_MAX_LINES_VERBOSE = 500;

/** Prefer cutting at newline so boxed panels stay readable */
function truncateToolTextAtNewline(raw: string, maxChars: number): { text: string; truncatedChars: boolean } {
  if (raw.length <= maxChars) return { text: raw, truncatedChars: false };
  let head = raw.slice(0, maxChars);
  const nl = head.lastIndexOf('\n');
  if (nl > maxChars * 0.35) head = head.slice(0, nl);
  return {
    text:
      head +
      `\n[yamx] …preview truncated (${raw.length.toLocaleString()} chars; full tool output is still sent to the agent.)`,
    truncatedChars: true,
  };
}

export type UIOptions = { verbose?: boolean; maxAssistantMarkdownChars?: number };

export class UI {
  private spinner: Ora | null = null;
  private streamBuffer = '';
  private verbose = false;
  /** Accumulated assistant Markdown while streaming (rendered once on finalize). */
  private assistantMarkdownDraft = '';
  /** Subtle spinner while streamed tokens arrive before Markdown is painted. */
  private assistantStreamOra: Ora | null = null;
  /** Hard cap on assistant markdown source characters (terminal + session alignment). */
  private assistantMarkdownCap: number;

  constructor(opts?: UIOptions) {
    this.verbose = opts?.verbose === true;
    this.assistantMarkdownCap = Math.max(
      400,
      opts?.maxAssistantMarkdownChars ?? DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS
    );
  }

  /** Reset dangling SGR before readline redraws the prompt (↑/↓ history, next question). */
  resetTTYBeforeReplPrompt(): void {
    ttyResetBeforeReplPrompt();
  }

  /** After panels / streamed output so the viewport moves forward before the REPL resumes. */
  cueTTYAfterBulkOutput(): void {
    ttyCueAfterBulkOutput();
  }

  /** Discard partial streamed assistant output (API error mid-stream). */
  cancelAssistantMarkdownStream() {
    if (this.assistantStreamOra) {
      this.assistantStreamOra.stop();
      this.assistantStreamOra = null;
    }
    this.assistantMarkdownDraft = '';
  }

  private printPanel(titleStrip: string, body: string, borderColor: string) {
    const innerW = panelInnerWrapWidth();
    const wrapped = wrapAnsi(body.trimEnd(), innerW, { trim: false, wordWrap: true });
    console.log(
      '\n' +
        boxen(wrapped, {
          title: titleStrip,
          titleAlignment: 'left',
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          margin: { top: 0, bottom: 0, left: BODY_LEFT_GUTTER, right: 3 },
          borderStyle: 'round',
          borderColor,
          dimBorder: true,
        }) +
        '\n'
    );
  }

  banner(provider: string, model: string, session?: { title?: string; id?: string }, toolCount = 0, version = 'dev', councilOn = false) {
    if (process.stdout.isTTY) console.clear();

    const cols =
      typeof process.stdout.columns === 'number' && process.stdout.columns >= 48 ? process.stdout.columns : 80;
    const pad = BODY_LEFT_GUTTER;
    const boxInner = Math.min(Math.max(cols - pad - BODY_RIGHT_GUTTER - 4, 52), 78);

    const threadTitleRaw = clipField(session?.title ?? 'untitled', Math.max(28, Math.floor(boxInner * 0.48)));
    const threadId = session?.id?.slice(0, 8) ?? '--------';
    const tc = `${toolCount || '?'}`;
    const provClip = clipField(provider, Math.max(14, Math.floor(boxInner * 0.32)));
    const modelClip = clipField(model, Math.max(14, Math.floor(boxInner * 0.38)));

    const labelPlain = '[ NEURAL LINK ]';
    const eqSlot = Math.max(6, boxInner - labelPlain.length - 2);
    const a = Math.floor(eqSlot / 2);
    const b = eqSlot - a;
    const ribbon =
      MX_CORE('+') +
      MX('='.repeat(a)) +
      MX('[') +
      MX.bold(' NEURAL LINK ') +
      MX(']') +
      MX('='.repeat(b)) +
      MX_CORE('+');

    const sep = MX_CORE('+') + MX_DIM('─'.repeat(Math.max(4, boxInner - 2))) + MX_CORE('+');

    /** Inner-matrix pipe deco (inside the outer Unicode frame). */
    const deco = MX('|') + '  ';
    const footPad = '   ';

    const line1 = padVis(ribbon, boxInner);
    const line2 = padVis(
      `${deco}${MX.bold('Y A M X')}  ${MX_DIM(`v${version}`)}  ${MX_DIM('coding agent')}`,
      boxInner
    );
    const triple =
      MX_DIM('encrypted session') +
      ' ' +
      MX_DIM('|') +
      ' ' +
      MX_DIM(`${tc} tools`) +
      ' ' +
      MX_DIM('|') +
      ' ' +
      MX_DIM('local-first powerhouse');
    const line3 = padVis(`${deco}${triple}`, boxInner);
    const line4 = padVis(sep, boxInner);

    const provLine =
      MX_DIM('provider') +
      ' ' +
      MX(provClip) +
      ' ' +
      MX_DIM('|') +
      ' ' +
      MX_DIM('model') +
      ' ' +
      MX(modelClip);
    const thrLine =
      MX_DIM('thread') + ' ' + MX(threadTitleRaw) + ' ' + MX_DIM('|') + ' ' + MX_DIM(`${threadId}…`);
    const sigLine =
      MX_DIM('signal') +
      ' ' +
      MX('online') +
      ' ' +
      MX_DIM('|') +
      ' ' +
      MX_DIM('council') +
      ' ' +
      MX(councilOn ? 'on' : 'off') +
      ' ' +
      MX_DIM('|') +
      ' ' +
      MX_DIM('logs') +
      ' ' +
      MX('ready');

    const line5 = padVis('', boxInner);
    const line6 = padVis(`${footPad}${provLine}`, boxInner);
    const line7 = padVis(`${footPad}${thrLine}`, boxInner);
    const line8 = padVis(`${footPad}${sigLine}`, boxInner);

    const hz = MX_DIM('─'.repeat(boxInner + 2));
    const indent = ' '.repeat(pad);
    const mxFrame = chalk.hex('#00FF41');

    const rows = [
      '',
      `${indent}${mxFrame('┌')}${hz}${mxFrame('┐')}`,
      `${indent}${mxFrame('│')} ${line1} ${mxFrame('│')}`,
      `${indent}${mxFrame('│')} ${line2} ${mxFrame('│')}`,
      `${indent}${mxFrame('│')} ${line3} ${mxFrame('│')}`,
      `${indent}${mxFrame('│')} ${line4} ${mxFrame('│')}`,
      `${indent}${mxFrame('│')} ${line5} ${mxFrame('│')}`,
      `${indent}${mxFrame('│')} ${line6} ${mxFrame('│')}`,
      `${indent}${mxFrame('│')} ${line7} ${mxFrame('│')}`,
      `${indent}${mxFrame('│')} ${line8} ${mxFrame('│')}`,
      `${indent}${mxFrame('└')}${hz}${mxFrame('┘')}`,
      '',
    ];
    console.log(rows.join('\n'));
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
        ['/history [n]', 'Numbered YamX prompts (~/.yamx/history); last n lines'],
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
        ['/pwd', 'Show YamX shell cwd'],
        ['/cd', 'Change YamX shell cwd'],
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

  /** Start assistant markdown stream with optional blank line above first token. */
  beginAssistantMarkdownStream(withLeadingNl: boolean) {
    this.cancelAssistantMarkdownStream(); // clears draft + stray stream spinner
    if (withLeadingNl) console.log('');
  }

  /** Stream one Markdown chunk — buffered until finalize (so headings/lists/code fences render). */
  appendAssistantMarkdownChunk(fragment: string) {
    const f = fragment ?? '';
    if (!f.length) return;
    this.assistantMarkdownDraft += f;

    const ttyOut = typeof process.stdout.isTTY === 'boolean' ? process.stdout.isTTY : true;
    if (ttyOut && !this.assistantStreamOra) {
      this.assistantStreamOra = ora({
        text: DIM('Receiving reply…'),
        color: 'green',
      }).start();
    }
  }

  /** Emit any leftover text after chunks end (no trailing newline assumed). */
  finalizeAssistantMarkdownStream() {
    if (this.assistantStreamOra) {
      this.assistantStreamOra.stop();
      this.assistantStreamOra = null;
    }
    const draftRaw = this.assistantMarkdownDraft.replace(/\s+$/, '');
    this.assistantMarkdownDraft = '';
    if (!draftRaw.length) return;

    const capped = capAssistantMarkdownSource(draftRaw, this.assistantMarkdownCap);
    const draft = capped.text;
    if (capped.truncated) {
      console.log(
        DIM(
          `[yamx] Reply truncated (${capped.text.length}/${capped.originalLength} chars). Raise settings.maxAssistantMarkdownChars in ~/.yamx/config.json.`
        )
      );
    }

    try {
      const rendered = marked.parse(draft);
      const ansi = typeof rendered === 'string' ? rendered.trimEnd() : draft;
      const block = wrapIndentedBodyBlock(ansi);
      if (block.trim().length) console.log(block + '\n');
    } catch {
      console.log(wrapIndentedBodyBlock(draft) + '\n');
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
  renderMarkdown(text: string, opts?: { bypassCap?: boolean }): string {
    try {
      let src = text;
      if (!opts?.bypassCap) {
        const c = capAssistantMarkdownSource(src, this.assistantMarkdownCap);
        src = c.text;
        if (c.truncated) {
          console.log(
            DIM(
              `[yamx] Output truncated (${c.text.length}/${c.originalLength} chars). Raise settings.maxAssistantMarkdownChars in ~/.yamx/config.json.`
            )
          );
        }
      }
      const rendered = marked.parse(src);
      const ansi = typeof rendered === 'string' ? rendered.trimEnd() : src;
      return wrapIndentedBodyBlock(ansi);
    } catch {
      const fallback = opts?.bypassCap ? text : capAssistantMarkdownSource(text, this.assistantMarkdownCap).text;
      return wrapIndentedBodyBlock(String(fallback).trimEnd());
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
    const innerBody = this.verbose ? argsStr : `${TOOL_COLOR.bold(name)}\n${argsStr}`;
    if (this.verbose) {
      console.log(`\n  ${MX('◈')} ${MX_DIM('[TOOL LINK]')} ${TOOL_COLOR.bold(name)}`);
    }
    this.printPanel(DIM(' tool '), innerBody, '#2563EB');
  }

  toolResult(name: string, result: string, duration: number) {
    const normalized = String(result ?? '').replace(/\r\n/g, '\n');
    const maxLines = this.verbose ? TOOL_RESULT_MAX_LINES_VERBOSE : TOOL_RESULT_MAX_LINES_NORMAL;

    const { text: capped, truncatedChars } = truncateToolTextAtNewline(normalized, TOOL_RESULT_DISPLAY_MAX_CHARS);
    const lines = capped.split('\n');

    let lineTrunc = false;
    let displayLines: string[];
    if (lines.length > maxLines) {
      const kept = Math.max(4, maxLines - 2);
      displayLines = [
        ...lines.slice(0, kept),
        DIM(
          `  … ${lines.length - kept} more lines (preview limit; full output is still sent to the agent.)`
        ) as string,
      ];
      lineTrunc = true;
    } else {
      displayLines = lines;
    }

    const header = `${SUCCESS('✓')} ${name} · ${duration}ms`;
    const dimBody = displayLines.map((ln) => DIM(ln)).join('\n');
    const hints: string[] = [];
    if (truncatedChars || lineTrunc) {
      hints.push(DIM('  (panel preview limited; full tool output is still in agent context)'));
    }
    const bodyForBox = [header, dimBody, ...hints].filter(Boolean).join('\n').trimEnd();

    if (normalized.trim()) {
      this.printPanel(DIM(' result '), bodyForBox, '#059669');
    } else {
      this.printPanel(DIM(' result '), DIM(`✓ ${name} · ${duration}ms — empty output`), '#047857');
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
    const w = wrapWidthForIndentedBody();
    const head = `${ERROR('✗')} ${ERROR(msg)}`;
    const folded = wrapAnsi(head, w, { trim: false, wordWrap: true });
    const text = `\n${folded
      .split('\n')
      .map((l) => `${' '.repeat(BODY_LEFT_GUTTER)}${l}`)
      .join('\n')}\n`;
    console.log(text);
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
    const wrapW = panelInnerWrapWidth();
    const inner = wrapAnsi(lines.join('\n').trimEnd(), wrapW, { trim: false, wordWrap: true });
    console.log(
      '\n' +
        boxen(inner, {
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          margin: { top: 0, bottom: 1, left: 2, right: 3 },
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
    const w = wrapWidthForIndentedBody();
    const line = `${INFO('○')} ${DIM(msg)}`;
    console.log(
      wrapAnsi(line, w, { trim: false, wordWrap: true })
        .split('\n')
        .map((l) => `${' '.repeat(BODY_LEFT_GUTTER)}${l}`)
        .join('\n')
    );
  }

  warn(msg: string) {
    const w = wrapWidthForIndentedBody();
    const line = `${WARNING('⚠')} ${WARNING(msg)}`;
    console.log(
      wrapAnsi(line, w, { trim: false, wordWrap: true })
        .split('\n')
        .map((l) => `${' '.repeat(BODY_LEFT_GUTTER)}${l}`)
        .join('\n')
    );
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
