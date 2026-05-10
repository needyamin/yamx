import fs from 'fs-extra';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { formatBytes } from './utils.js';

export interface TextFileSnapshot {
  content: string;
  lineCount: number;
  size: number;
  eol: '\n' | '\r\n';
  finalNewline: boolean;
}

export interface TextEditSummary {
  oldLines: number;
  newLines: number;
  beforeLines: number;
  afterLines: number;
  changedLines: number;
  sizeBefore: number;
  sizeAfter: number;
}

export async function readTextFileSnapshot(filePath: string, displayPath: string): Promise<TextFileSnapshot | string> {
  if (!await fs.pathExists(filePath)) return `Error: File not found: ${displayPath}`;
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return `Error: Not a file: ${displayPath}`;
  if (await looksBinary(filePath)) return `Error: Refusing to edit likely binary file: ${displayPath} (${formatBytes(stat.size)})`;

  const content = await fs.readFile(filePath, 'utf-8');
  return {
    content,
    lineCount: countLines(content),
    size: stat.size,
    eol: content.includes('\r\n') ? '\r\n' : '\n',
    finalNewline: /\r?\n$/.test(content),
  };
}

export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.yamx-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
  );
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.move(tmp, filePath, { overwrite: true });
}

export function normalizeNewTextForFile(text: string, snapshot?: Pick<TextFileSnapshot, 'eol'>): string {
  if (!snapshot || snapshot.eol === '\n') return text;
  return text.replace(/\r?\n/g, '\r\n');
}

/** SHA-256 fingerprint prefix for stale-write detection and batch coordination. */
export function contentFingerprint(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16)}`;
}

const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python', pyi: 'python',
  rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby', php: 'php', swift: 'swift', scala: 'scala',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', fs: 'fsharp', vb: 'vbnet',
  md: 'markdown', mdx: 'mdx', json: 'json', jsonc: 'jsonc',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  sql: 'sql', gql: 'graphql',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  ps1: 'powershell', psd1: 'powershell', psm1: 'powershell',
  dockerfile: 'docker',
};

export function inferFileLanguageLabel(displayPath: string): string {
  const base = path.basename(displayPath).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'docker';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return 'unknown';
  const ext = base.slice(dot + 1);
  return EXT_LANGUAGE[ext] || ext || 'unknown';
}

export interface MultiEditEntry {
  old_text: string;
  new_text: string;
  occurrence?: number;
  replace_all?: boolean;
}

/** First match position of needle, or -1. */
export function firstMatchIndex(content: string, needle: string): number {
  if (!needle) return -1;
  const i = content.indexOf(needle);
  return i;
}

function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return Math.max(a[0], b[0]) < Math.min(a[1], b[1]);
}

/**
 * Reorder edit indices by ascending position of the first match in `content` (stable).
 * Edits with no match sort last.
 */
export function orderMultiEditIndicesByPosition(
  content: string,
  normalizedOldTexts: string[],
): number[] {
  const scored = normalizedOldTexts.map((t, i) => ({
    i,
    pos: firstMatchIndex(content, t),
  }));
  return scored
    .sort((a, b) => {
      if (a.pos < 0 && b.pos < 0) return a.i - b.i;
      if (a.pos < 0) return 1;
      if (b.pos < 0) return -1;
      if (a.pos !== b.pos) return a.pos - b.pos;
      return a.i - b.i;
    })
    .map((x) => x.i);
}

/**
 * Warn when non-replace_all edits target overlapping regions in the original file.
 */
export function multiEditOverlapWarnings(
  content: string,
  edits: { old_text?: string; replace_all?: boolean }[],
  normalizedOldTexts: string[],
): string[] {
  const warnings: string[] = [];
  const ranges: { index: number; range: [number, number] }[] = [];
  for (let i = 0; i < edits.length; i++) {
    if (edits[i].replace_all) continue;
    const t = normalizedOldTexts[i];
    const start = firstMatchIndex(content, t);
    if (start < 0) continue;
    ranges.push({ index: i + 1, range: [start, start + t.length] });
  }
  for (let a = 0; a < ranges.length; a++) {
    for (let b = a + 1; b < ranges.length; b++) {
      if (rangesOverlap(ranges[a].range, ranges[b].range)) {
        warnings.push(
          `Edits #${ranges[a].index} and #${ranges[b].index} overlap in the original file (${ranges[a].range[0]}-${ranges[a].range[1]} vs ${ranges[b].range[0]}-${ranges[b].range[1]}); application order matters.`,
        );
      }
    }
  }
  return warnings;
}

/**
 * Simulate applying edits in order on a copy; catches cases where an earlier edit
 * removes text a later edit still expects.
 */
export function simulateMultiEditSequence(
  initialContent: string,
  snapshot: Pick<TextFileSnapshot, 'eol'>,
  edits: MultiEditEntry[],
): { ok: boolean; failures: { index: number; reason: string }[] } {
  let content = initialContent;
  const failures: { index: number; reason: string }[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const oldText = normalizeNewTextForFile(String(edit.old_text ?? ''), snapshot);
    const newText = normalizeNewTextForFile(String(edit.new_text ?? ''), snapshot);
    if (!oldText) {
      failures.push({ index: i + 1, reason: 'old_text is empty.' });
      continue;
    }
    const count = countOccurrences(content, oldText);
    if (count === 0) {
      failures.push({ index: i + 1, reason: 'old_text not found in current simulated content (earlier edit may have invalidated this match).' });
      continue;
    }
    const replaceAll = Boolean(edit.replace_all);
    const occurrence = Math.min(Math.max(Math.floor(Number(edit.occurrence) || 1), 1), count);
    content = replaceAll
      ? content.split(oldText).join(newText)
      : replaceOccurrence(content, oldText, newText, occurrence);
  }

  return { ok: failures.length === 0, failures };
}

export function countOccurrences(content: string, needle: string): number {
  if (!needle) return 0;
  return content.split(needle).length - 1;
}

export function replaceOccurrence(content: string, oldText: string, newText: string, occurrence: number): string {
  let index = -1;
  let from = 0;
  for (let i = 0; i < occurrence; i++) {
    index = content.indexOf(oldText, from);
    if (index === -1) return content;
    from = index + oldText.length;
  }
  return `${content.slice(0, index)}${newText}${content.slice(index + oldText.length)}`;
}

export function lineColumnForIndex(content: string, index: number): { line: number; column: number } {
  const prefix = content.slice(0, Math.max(0, index));
  const lines = prefix.split(/\r?\n/);
  return { line: lines.length, column: (lines.at(-1)?.length || 0) + 1 };
}

export function summarizeTextChange(before: string, after: string, oldText = '', newText = ''): TextEditSummary {
  return {
    oldLines: oldText ? countLines(oldText) : 0,
    newLines: newText ? countLines(newText) : 0,
    beforeLines: countLines(before),
    afterLines: countLines(after),
    changedLines: changedLineEstimate(before, after),
    sizeBefore: Buffer.byteLength(before, 'utf-8'),
    sizeAfter: Buffer.byteLength(after, 'utf-8'),
  };
}

export function formatTextEditSummary(summary: TextEditSummary): string {
  const sizeDelta = summary.sizeAfter - summary.sizeBefore;
  const lineDelta = summary.afterLines - summary.beforeLines;
  return [
    `lines ${summary.beforeLines} -> ${summary.afterLines} (${formatSigned(lineDelta)})`,
    `size ${formatBytes(summary.sizeBefore)} -> ${formatBytes(summary.sizeAfter)} (${formatSigned(sizeDelta)} B)`,
    `estimated changed lines: ${summary.changedLines}`,
  ].join('; ');
}

export function previewTextChange(before: string, after: string, maxLines = 18): string {
  if (before === after) return '(no textual changes)';
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const beforeChunk = oldLines.slice(start, oldEnd + 1).slice(0, maxLines);
  const afterChunk = newLines.slice(start, newEnd + 1).slice(0, maxLines);
  const lines = [`@@ line ${start + 1} @@`];
  beforeChunk.forEach((line) => lines.push(`- ${line}`));
  afterChunk.forEach((line) => lines.push(`+ ${line}`));
  if ((oldEnd - start + 1) > maxLines || (newEnd - start + 1) > maxLines) {
    lines.push('... preview truncated ...');
  }
  return lines.join('\n');
}

export function closestTextHints(content: string, needle: string, limit = 3): string[] {
  const compactNeedle = normalizeForHint(needle);
  if (!compactNeedle) return [];
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line, index, score: hintScore(normalizeForHint(line), compactNeedle) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => `${item.index + 1}: ${item.line.trim().slice(0, 220)}`);
}

export async function looksBinary(filePath: string): Promise<boolean> {
  const buf = await fs.readFile(filePath, { encoding: null });
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  return sample.includes(0);
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}

function changedLineEstimate(before: string, after: string): number {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let samePrefix = 0;
  while (samePrefix < a.length && samePrefix < b.length && a[samePrefix] === b[samePrefix]) samePrefix++;
  let sameSuffix = 0;
  while (
    sameSuffix + samePrefix < a.length &&
    sameSuffix + samePrefix < b.length &&
    a[a.length - 1 - sameSuffix] === b[b.length - 1 - sameSuffix]
  ) sameSuffix++;
  return Math.max(a.length - samePrefix - sameSuffix, b.length - samePrefix - sameSuffix, 0);
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function normalizeForHint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hintScore(line: string, needle: string): number {
  if (!line || !needle) return 0;
  if (line.includes(needle) || needle.includes(line)) return Math.min(line.length, needle.length);
  const needleWords = new Set(needle.split(/\W+/).filter((word) => word.length > 2));
  let score = 0;
  for (const word of line.split(/\W+/)) {
    if (needleWords.has(word)) score += word.length;
  }
  return score;
}
