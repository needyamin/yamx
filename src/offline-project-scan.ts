import fs from 'fs-extra';
import path from 'node:path';
import { buildCodebaseAnalysis, listProjectSourcePaths } from './project-intel.js';

export interface OfflineProjectScanIntent {
  depth: 'quick' | 'standard' | 'deep';
  /** Preserved as the analysis "goal" line in project-summary.md */
  goalNote?: string;
}

/** Rambling / filler is OK; very long paste should not hijack the whole message as a scan. */
const MAX_INPUT_LEN = 2800;

export function parseScanDepthFromArgs(rest: string): OfflineProjectScanIntent['depth'] {
  const r = rest.toLowerCase();
  if (/\bdeep\b/.test(r)) return 'deep';
  if (/\bquick\b/.test(r)) return 'quick';
  return 'standard';
}

function hasCompoundTaskEscalation(lower: string): boolean {
  return (
    /\b(and then|after that)\b/i.test(lower)
    || /\balso\s+(add|implement|fix|create|write|change|delete|remove)\b/i.test(lower)
    || /\bthen\s+(add|implement|fix|create|write|change)\b/i.test(lower)
  );
}

/** Non-repo meanings of "scan" / medical / inbox — only block if no clear dev/repo anchor. */
function looksLikeNonCodebaseScan(lower: string): boolean {
  return /\b(qr\s*code|barcode|virus\s+scan|antivirus|malware\s+scan|mri|ct\s+scan|body\s+scan|email|inbox|receipt|document\s+id)\b/i.test(
    lower
  );
}

/** Repo / dev context anywhere in the line (pairs with scan verbs even with filler in between). */
function hasRepoOrDevAnchor(lower: string): boolean {
  return /\b(project|codebase|repo|repos|repository|workspace|monorepo|package\.json|tsconfig|eslint|prettier|typescript|javascript|python|node|npm|pnpm|yarn|bun|git|working\s+tree|source\s*code|\.yamx|yamx)\b/i.test(
    lower
  )
    || /\b(my|the|this|our|your)\s+(project|codebase|repo|repos|code|codes|sources?|files?|tree|app|package|module|folder|directory)\b/i.test(
      lower
    )
    || /\b(all|everything)\s+(the\s+)?(code|files|sources?)\b/i.test(lower)
    || /\b(code|codes|sources?)\s+(here|base|tree)\b/i.test(lower)
    || /\b(in|into|of|across)\s+(the\s+|this\s+|my\s+|our\s+)?(repo|codebase|project|folder|directory|workspace)\b/i.test(
      lower
    )
    || /(?:^|[\s/])src\/[\w.-]+/i.test(lower);
}

/**
 * Natural phrases like "scan my project" run fully offline: write `.yamx/project-summary.md`,
 * print a short CLI reply, and skip cloud tokens for the scan itself.
 * Intent is **loose**: filler ("not your pinpoint world …") is fine as long as scan + scope
 * signals both appear somewhere in the message.
 */
export function detectOfflineProjectScanIntent(input: string): OfflineProjectScanIntent | null {
  const t = input.trim();
  if (!t || t.startsWith('/')) return null;
  if (t.length > MAX_INPUT_LEN) return null;

  const lower = t.toLowerCase().replace(/\s+/g, ' ');
  if (hasCompoundTaskEscalation(lower)) return null;

  const depth: OfflineProjectScanIntent['depth'] = /\b(deep|thorough|exhaustive)\b/i.test(lower)
    ? 'deep'
    : /\b(quick|fast|shallow)\b/i.test(lower)
      ? 'quick'
      : 'standard';

  const hasScanVerb = /\b(re-?scan|rescan|scanning|scanned|scan|analy[sz]ing|analy[sz]e|analyse|analyze|mapping|map\b|catalog(?:ue|ing)?|inventory|index(?:ing)?|survey|digest|take\s+stock|size\s+up)\b/i.test(
    lower
  );
  const summarize = /\b(summariz|summaris|overview)\w*\b/i.test(lower);
  const projectNoun = /\b(project|codebase|repo|repository|workspace|source\s*code)\b/i.test(lower);
  const myProject = /\b(my|the|this|our)\s+(project|codebase|repo)\b/i.test(lower);
  const projectScan = /\b(project|codebase|repo)\s+(scan|summary|map)\b/i.test(lower);
  const offlinePhrase =
    /\b(offline|local(?:\s+only)?)\b/i.test(lower) && /\b(scan|analysis|snapshot|summary)\b/i.test(lower);

  const hasScope =
    projectNoun
    || myProject
    || projectScan
    || /\b(the|this|my|our)\s+(code|codes|sources?|files?|tree|app|package|module)\b/i.test(lower)
    || /\b(all|everything)\s+(the\s+)?(code|files|sources?)\b/i.test(lower);

  if (looksLikeNonCodebaseScan(lower) && !hasRepoOrDevAnchor(lower)) return null;

  if (offlinePhrase || projectScan) {
    return { depth, goalNote: t };
  }
  if (summarize && hasScope) {
    return { depth, goalNote: t };
  }
  if (hasScanVerb && hasScope) {
    return { depth, goalNote: t };
  }
  if (hasScanVerb && /\b(entire|whole|full|complete)\b/i.test(lower) && (projectNoun || /\b(code|workspace)\b/i.test(lower))) {
    return { depth, goalNote: t };
  }
  if (hasScanVerb && hasRepoOrDevAnchor(lower)) {
    return { depth, goalNote: t };
  }

  return null;
}

const READ_CAP = 96 * 1024;
const SYMBOLS_PER_FILE = 35;

function extractLineSymbols(line: string, ext: string): string[] {
  const out: string[] = [];
  const trimmed = line.replace(/\/\/.*$/, '').trim();
  if (!trimmed) return out;

  if (/\.py$/i.test(ext)) {
    let m = trimmed.match(/^\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(/);
    if (m) out.push(`def ${m[1]}`);
    m = trimmed.match(/^\s*class\s+([a-zA-Z_]\w*)\b/);
    if (m) out.push(`class ${m[1]}`);
    return out;
  }

  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/^\s*export\s+default\s+(?:async\s+)?function\s+(\w+)/, (m) => `export default function ${m[1]}`],
    [/^\s*export\s+default\s+class\s+(\w+)/, (m) => `export default class ${m[1]}`],
    [/^\s*export\s+(?:async\s+)?function\s+(\w+)/, (m) => `export function ${m[1]}`],
    [/^\s*export\s+const\s+(\w+)\s*=/, (m) => `export const ${m[1]}`],
    [/^\s*export\s+let\s+(\w+)\s*=/, (m) => `export let ${m[1]}`],
    [/^\s*export\s+class\s+(\w+)/, (m) => `export class ${m[1]}`],
    [/^\s*export\s+interface\s+(\w+)/, (m) => `export interface ${m[1]}`],
    [/^\s*export\s+type\s+(\w+)\b/, (m) => `export type ${m[1]}`],
    [/^\s*export\s+enum\s+(\w+)/, (m) => `export enum ${m[1]}`],
    [/^\s*export\s*\{([^}]+)\}/, (m) => `export { ${m[1].trim().slice(0, 96)} }`],
    [/^\s*export\s+(?:async\s+)?function\s*\*\s*(\w+)/, (m) => `export function* ${m[1]}`],
    [/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/, (m) => `function ${m[1]}`],
    [/^\s*export\s+abstract\s+class\s+(\w+)/, (m) => `export abstract class ${m[1]}`],
    [/^\s*(?:export\s+)?abstract\s+class\s+(\w+)/, (m) => `abstract class ${m[1]}`],
    [/^\s*(?:export\s+)?class\s+(\w+)/, (m) => `class ${m[1]}`],
  ];

  for (const [re, fmt] of patterns) {
    const m = trimmed.match(re);
    if (m) {
      out.push(fmt(m));
      break;
    }
  }
  return out;
}

async function buildSymbolOutlineSection(cwd: string, depth: OfflineProjectScanIntent['depth']): Promise<string> {
  const maxFiles = depth === 'deep' ? 48 : depth === 'quick' ? 18 : 30;
  const paths = await listProjectSourcePaths(cwd, maxFiles);
  const lines: string[] = [
    '',
    '## Symbol outline (sampled)',
    '',
    'Heuristic exports / top-level functions / classes from ranked source files (not a full AST).',
    '',
  ];

  let totalSymbols = 0;
  for (const rel of paths) {
    const abs = path.join(cwd, rel);
    const ext = path.extname(rel);
    if (!/\.(ts|tsx|js|jsx|py)$/i.test(ext)) continue;

    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf-8');
    } catch {
      continue;
    }
    if (raw.length > READ_CAP) raw = raw.slice(0, READ_CAP);

    const fileSyms: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      for (const s of extractLineSymbols(line, ext)) {
        if (!fileSyms.includes(s)) fileSyms.push(s);
        if (fileSyms.length >= SYMBOLS_PER_FILE) break;
      }
      if (fileSyms.length >= SYMBOLS_PER_FILE) break;
    }
    if (fileSyms.length === 0) continue;

    lines.push(`### ${rel.replace(/\\/g, '/')}`);
    for (const s of fileSyms) lines.push(`- \`${s}\``);
    lines.push('');
    totalSymbols += fileSyms.length;
    if (totalSymbols > 900) break;
  }

  if (lines.length <= 6) {
    lines.push('_No symbol heuristics matched in sampled files._', '');
  }

  return lines.join('\n');
}

function depthMaxFiles(depth: OfflineProjectScanIntent['depth']): number {
  if (depth === 'deep') return 140;
  if (depth === 'quick') return 55;
  return 90;
}

export interface OfflineProjectScanResult {
  summaryPath: string;
  shortLines: string[];
  bytesWritten: number;
  depth: OfflineProjectScanIntent['depth'];
}

export async function runOfflineProjectScanAndSave(
  cwd: string,
  intent: OfflineProjectScanIntent
): Promise<OfflineProjectScanResult> {
  const goal = (intent.goalNote || 'Offline project scan').trim();
  const depth = intent.depth;
  const maxFiles = depthMaxFiles(depth);

  const analysis = await buildCodebaseAnalysis({
    cwd,
    goal,
    depth,
    maxFiles,
  });

  const outline = await buildSymbolOutlineSection(cwd, depth);
  const footer = [
    '',
    '---',
    '*Generated offline by YamX (no cloud tokens for this step). The CLI/web session system prompt is refreshed when supported so follow-ups stay cheap. Ask the cloud model only when you need reasoning beyond this snapshot.*',
    '',
  ].join('\n');

  const full = `${analysis}${outline}${footer}`;
  const summaryPath = path.join(cwd, '.yamx', 'project-summary.md');
  await fs.ensureDir(path.dirname(summaryPath));
  await fs.writeFile(summaryPath, full, 'utf-8');
  const bytesWritten = Buffer.byteLength(full, 'utf-8');

  const rel = path.relative(cwd, summaryPath) || '.yamx/project-summary.md';
  const shortLines = [
    `Offline scan done (${depth}).`,
    `Wrote ${rel} (${(bytesWritten / 1024).toFixed(1)} KB).`,
    'Cloud follow-ups: ask normally; the saved summary is injected into the system prompt to reduce token use.',
  ];

  return { summaryPath, shortLines, bytesWritten, depth };
}
