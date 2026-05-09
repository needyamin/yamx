/**
 * Normalize provider/stream errors into a readable shape (OpenRouter/OpenAI-like JSON payloads).
 */

export type ApiFailureView = {
  headline: string;
  detailLines: string[];
  hints: string[];
  /** Dim line for debugging, e.g. BadRequest · 400 */
  technical?: string;
};

function messageFromUnknown(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const base = err.message || '(no message)';
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause) return `${base} | ${messageFromUnknown(cause)}`;
    return base;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Balanced-json slice starting at first `{`. */
export function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export function summarizeApiFailure(err: unknown): ApiFailureView {
  const flat = messageFromUnknown(err).replace(/\s+/g, ' ').trim();

  let parsed: Record<string, unknown> | null = null;
  const blob = extractFirstJsonObject(flat);
  if (blob) {
    try {
      parsed = JSON.parse(blob) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }

  const svcMsg =
    parsed && typeof parsed.message === 'string'
      ? (parsed.message as string)
      : null;
  const svcType =
    parsed && typeof parsed.type === 'string' ? String(parsed.type) : null;
  const svcCode =
    parsed && parsed.code !== null && parsed.code !== undefined
      ? parsed.code
      : null;

  const technicalParts: string[] = [];
  if (svcType) technicalParts.push(svcType);
  if (svcCode !== null) technicalParts.push(String(svcCode));
  const technical = technicalParts.length ? technicalParts.join(' · ') : undefined;

  const combined = `${flat} ${svcMsg || ''}`;
  const isContextOverflow =
    /max_num_tokens|max[_\s-]?tokens|maximum context|context length|too many tokens/i.test(combined) ||
    /prompt length.*should not exceed|exceed.*token/i.test(combined);

  let headline =
    svcMsg ||
    flat.slice(0, 240) ||
    'Something went wrong while talking to the model provider.';
  headline = headline.replace(/\s+/g, ' ').trim();

  if (isContextOverflow) {
    headline =
      'This chat + system prompt is larger than your model accepts (context / max tokens limit).';
  }

  const detailLines: string[] = [];
  if (svcMsg && isContextOverflow && svcMsg !== headline) {
    const clipped = svcMsg.length > 200 ? svcMsg.slice(0, 197) + '...' : svcMsg;
    detailLines.push(`Details: ${clipped}`);
  } else if (svcMsg && !isContextOverflow && headline !== svcMsg) {
    detailLines.push(svcMsg.length > 300 ? svcMsg.slice(0, 297) + '...' : svcMsg);
  }

  const hints: string[] = [];

  if (isContextOverflow) {
    hints.push('Run /compact to summarize older turns and shrink history.');
    hints.push('Or start fresh: exit and run with --new-chat.');
    hints.push(
      'If the project prompt is huge, use a shorter session or a model with a larger window.'
    );
  }

  const lower = combined.toLowerCase();
  if (/rate.?limit|429|too many requests/i.test(lower)) {
    hints.push('Wait briefly and retry (rate limited).');
  }
  if (/401|unauthorized|invalid api key|api key/i.test(lower) && hints.length === 0) {
    hints.push('Check ~/.yamx/config.json keys or env OPENROUTER_* / provider API key.');
  }
  if (/402|billing|quota|credit/i.test(lower) && hints.length === 0) {
    hints.push('Check provider billing / quota.');
  }

  if (hints.length === 0 && !isContextOverflow) {
    hints.push('Retry once; if it persists, run: yamx --diagnose');
  }

  return { headline, detailLines, hints, technical };
}
