/**
 * YamX REPL prompt history (~/.yamx/history): bash-style numbered listing.
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

export const REPL_HISTORY_PATH = path.join(os.homedir(), '.yamx', 'history');

/** Lines as stored on disk (order: oldest → newest within the capped file). */
export async function readReplHistoryEntries(): Promise<string[]> {
  if (!(await fs.pathExists(REPL_HISTORY_PATH))) return [];
  const raw = await fs.readFile(REPL_HISTORY_PATH, 'utf-8');
  return raw.split(/\r?\n/).map((s) => s.trim()).filter((l) => l.length > 0);
}

/**
 * Print numbered history like bash `history`.
 * @param lastN If set &gt; 0, only the last N entries (still numbered by original index).
 */
export async function printReplHistory(lastN?: number): Promise<void> {
  const entries = await readReplHistoryEntries();
  if (!entries.length) {
    console.log(chalk.dim('  (no entries yet — each YamX prompt line is appended here)'));
    console.log(chalk.dim(`  ${REPL_HISTORY_PATH}`));
    return;
  }

  const n = typeof lastN === 'number' && Number.isFinite(lastN) ? Math.trunc(lastN) : 0;
  const slice = n > 0 ? entries.slice(-n) : entries;
  const startNum = entries.length - slice.length + 1;

  console.log('');
  console.log(
    chalk.bold(`  Prompt history (${slice.length}${n > 0 ? ` newest of ${entries.length}` : ''} lines)`)
  );
  console.log('');
  for (let i = 0; i < slice.length; i++) {
    const idx = chalk.dim(`${String(startNum + i).padStart(6)}`);
    console.log(`${idx}  ${slice[i]}`);
  }
  console.log('');
  console.log(chalk.dim(`  ${REPL_HISTORY_PATH}`));
  console.log('');
}
