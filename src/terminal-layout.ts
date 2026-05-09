/**
 * Padding and wrap widths for TTY bodies (responsive to cols).
 */

import wrapAnsi from 'wrap-ansi';

/** Characters reserved on each horizontal side of the viewport (combined with left indent). */
const EDGE_GUTTER = 4;

/** Left gutter (spaces) before assistant / markdown bodies. */
export const BODY_LEFT_GUTTER = 2;

function columns(): number {
  const c = process.stdout.columns;
  return typeof c === 'number' && c >= 24 ? c : 80;
}

/** Inner width excluding left+right gutters (text must not extend to terminal edges). */
export function terminalBodyWidthChars(): number {
  const c = columns();
  return Math.max(32, c - EDGE_GUTTER * 2);
}

/** Max characters per line inside the indented body column. */
export function wrapWidthForIndentedBody(): number {
  const inner = terminalBodyWidthChars();
  return Math.max(24, inner - BODY_LEFT_GUTTER);
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
