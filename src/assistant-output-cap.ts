/**
 * Hard limit on assistant markdown shown and stored per message (token / UX guard).
 */

export const DEFAULT_MAX_ASSISTANT_MARKDOWN_CHARS = 3200;

/** Appended to stored assistant content when truncated (model sees this on the next turn). */
export const ASSISTANT_TRUNCATION_HISTORY_NOTE =
  '\n\n[YamX: prior assistant text was truncated at maxAssistantMarkdownChars to save tokens. Prefer tools + short facts; user can raise the limit in ~/.yamx/config.json.]';

/**
 * Shrink assistant markdown before render / history. Tries paragraph boundary, then line, then hard cut.
 */
export function capAssistantMarkdownSource(
  raw: string,
  maxChars: number
): { text: string; truncated: boolean; originalLength: number } {
  const t = raw.replace(/\s+$/, '');
  const max = Math.max(400, Math.min(200_000, Math.trunc(maxChars)));
  if (!t.length || t.length <= max) {
    return { text: t, truncated: false, originalLength: t.length };
  }

  const head = t.slice(0, max);
  let cut = head.lastIndexOf('\n\n');
  if (cut < max * 0.35) cut = head.lastIndexOf('\n');
  if (cut < max * 0.25) cut = max;

  const text = head.slice(0, cut).trimEnd();
  return { text: text.length ? text : head.trimEnd(), truncated: true, originalLength: t.length };
}
