/**
 * Padding and wrap widths for TTY bodies (responsive to cols).
 */

import wrapAnsi from 'wrap-ansi';

/**
 * Horizontal “air” on both sides of the main column so text doesn’t touch the
 * terminal edge or get clipped when the host draws scrollbars or padding.
 */
const EDGE_GUTTER = 6;

/** Left indent (spaces) before assistant / plain status lines. */
export const BODY_LEFT_GUTTER = 2;

/** Right margin so wraps don’t hug the last column (scrollbar / frame chrome). */
export const BODY_RIGHT_GUTTER = 4;

const SCROLLBAR_RESERVE_CHARS = 2;

function columns(): number {
  const c = process.stdout.columns;
  return typeof c === 'number' && c >= 24 ? c : 80;
}

/** Inner width excluding symmetric edge gutters and narrow-host reserve. */
export function terminalBodyWidthChars(): number {
  const c = columns();
  return Math.max(28, c - EDGE_GUTTER * 2 - SCROLLBAR_RESERVE_CHARS);
}

/**
 * Max visible width for normal wrapped output (left gutter + right gutter).
 */
export function wrapWidthForIndentedBody(): number {
  const inner = terminalBodyWidthChars();
  return Math.max(18, inner - BODY_LEFT_GUTTER - BODY_RIGHT_GUTTER);
}

/**
 * Text width inside rounded `boxen` panels (tool / result): margin, border,
 * padding, and slack so long lines don’t clip on the right.
 */
export function panelInnerWrapWidth(): number {
  const c = columns();
  const reserved =
    BODY_LEFT_GUTTER + // box margin.left (UI)
    3 + // box margin.right (printPanel / apiFailure)
    4 + // border + inner padding (both sides)
    BODY_RIGHT_GUTTER +
    SCROLLBAR_RESERVE_CHARS +
    4; // ANSI / ambiguous wide-char slack
  return Math.max(18, c - reserved);
}

const padSpaces = ' '.repeat(BODY_LEFT_GUTTER);

/** Apply left gutter + wrap a single paragraph line preserving ANSI codes. */
export function wrapIndentedBodyLine(line: string): string {
  const w = wrapWidthForIndentedBody();
  if (!line.trim()) return '';
  const trimmedEnd = line.replace(/\s+$/, '');
  const folded = wrapAnsi(trimmedEnd, w, { trim: false, wordWrap: true });
  const parts = folded.split('\n').map((l) => `${padSpaces}${l}`);
  return parts.join('\n');
}

/** Wrap entire assistant/markdown-rendered blocks for display. */
export function wrapIndentedBodyBlock(raw: string): string {
  const lines = raw.replace(/\s+$/, '').split('\n');
  return lines.map((line) => wrapIndentedBodyLine(line)).join('\n');
}
