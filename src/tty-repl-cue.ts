/**
 * Keep readline prompts visible after chunked stdout (box drawing, ora, markdown).
 */

/** Strip lingering SGR so the prompt line isn't dimmed/colored incorrectly. */
export function ttyResetBeforeReplPrompt(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[0m');
}

/**
 * Run after panels / assistant output so terminals scroll forward and the next `question()`
 * redraw starts on a clean line (helps Windows shells + replayed history).
 */
export function ttyCueAfterBulkOutput(): void {
  if (!process.stdout.isTTY) return;
  ttyResetBeforeReplPrompt();
  process.stdout.write('\n');
}
