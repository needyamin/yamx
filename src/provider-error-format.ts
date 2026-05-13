/**
 * Normalize provider/stream errors into a readable shape (OpenRouter/OpenAI-like JSON payloads).
 */

import { isAxiosError, type AxiosError } from 'axios';

export type ApiFailureView = {
  headline: string;
  detailLines: string[];
  hints: string[];
  /** Dim line for debugging, e.g. BadRequest · 400 */
  technical?: string;
};

/** Axios often leaves `message` empty while the useful text lives on `response.data`. */
function formatAxiosError(err: AxiosError): string {
  const bits: string[] = [];
  if (err.message?.trim()) bits.push(err.message.trim());
  const code = err.code;
  if (code && !bits.some((b) => b.includes(code))) bits.push(`code=${code}`);
  const st = err.response?.status;
  const statusText = err.response?.statusText;
  if (st != null) bits.push(statusText ? `HTTP ${st} ${statusText}` : `HTTP ${st}`);
  const data = err.response?.data;
  if (data != null) {
    if (typeof data === 'string') {
      const t = data.trim();
      if (t) bits.push(t.length > 600 ? `${t.slice(0, 597)}...` : t);
    } else if (typeof data === 'object') {
      const o = data as Record<string, unknown>;
      const inner = o.error ?? o.message;
      if (typeof inner === 'string' && inner.trim()) bits.push(inner.trim());
      else {
        try {
          const j = JSON.stringify(data);
          if (j && j !== '{}') bits.push(j.length > 500 ? `${j.slice(0, 497)}...` : j);
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (!err.response && err.request) {
    bits.push('(no HTTP response — host down, wrong URL/port, firewall, or TLS/proxy)');
  }
  return bits.join(' — ') || 'HTTP request failed (no details from client).';
}

function messageFromUnknown(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (isAxiosError(err)) {
    return formatAxiosError(err);
  }
  if (err instanceof Error) {
    const errno = err as NodeJS.ErrnoException;
    const base =
      err.message?.trim()
      || (errno.code ? `${errno.code}${errno.syscall ? ` (${errno.syscall})` : ''}` : '')
      || '(no message)';
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause) {
      const inner = messageFromUnknown(cause);
      if (inner && inner !== '(no message)') return `${base} | ${inner}`;
    }
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
  const svcErr =
    parsed && typeof parsed.error === 'string' ? (parsed.error as string) : null;
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

  const combined = `${flat} ${svcMsg || ''} ${svcErr || ''}`;
  const isContextOverflow =
    /max_num_tokens|max[_\s-]?tokens|maximum context|context length|too many tokens/i.test(combined) ||
    /prompt length.*should not exceed|exceed.*token/i.test(combined);
  const isOllamaSystemRam =
    /requires more system memory|more system memory.*gib|not enough memory|insufficient memory|system memory.*available/i.test(
      combined
    );

  let headline =
    svcMsg ||
    svcErr ||
    flat.slice(0, 240) ||
    'Something went wrong while talking to the model provider.';
  headline = headline.replace(/\s+/g, ' ').trim();

  if (isContextOverflow) {
    headline =
      'This chat + system prompt is larger than your model accepts (context / max tokens limit).';
  } else if (isOllamaSystemRam) {
    headline =
      'This Ollama model needs more free RAM than the host (or Docker VM) currently has for inference.';
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
  if (isOllamaSystemRam) {
    hints.push(
      'Pick a smaller Ollama tag: `ollama pull qwen2.5-coder:3b` or `llama3.2:3b`, then set that as default model (web Settings or ~/.yamx/config.json defaultModel / providers.ollama.model).'
    );
    hints.push(
      'Docker: set `OLLAMA_MODEL=qwen2.5-coder:3b` (or `gemma4:e2b`) in `docs/docker/.env`, then `docker compose down -v && docker compose up -d --build`.'
    );
    hints.push('Gemma `e4b` often needs ~10 GiB free RAM for inference; `e2b` is smaller if you want Gemma on ~8 GiB.');
  }

  const lower = combined.toLowerCase();
  if (/rate.?limit|429|too many requests/i.test(lower)) {
    hints.push('Wait briefly and retry (rate limited).');
  }
  if (/401|unauthorized|invalid api key|api key/i.test(lower) && hints.length === 0) {
    hints.push('Check ~/.yamx/config.json keys or env (OPENROUTER_*, OPENAI_*, MOONSHOT_*/KIMI_*, XAI_*, …).');
  }
  if (/402|billing|quota|credit/i.test(lower) && hints.length === 0) {
    hints.push('Check provider billing / quota.');
  }
  if (
    !isContextOverflow
    && /(ECONNREFUSED|ENOTFOUND|ECONNRESET|no http response|11434|ollama)/i.test(combined)
  ) {
    hints.push(
      'Ollama: ensure the app or `ollama serve` is running; run `ollama list` and set providers.ollama.model to an installed tag (e.g. deepseek-r1:8b, not an OpenAI-style id unless you created that tag).'
    );
  }

  if (hints.length === 0 && !isContextOverflow && !isOllamaSystemRam) {
    hints.push('Retry once; if it persists, run: yamx --diagnose');
  }

  return { headline, detailLines, hints, technical };
}
