export type UserIntentKind =
  | 'empty'
  | 'conversation'
  | 'clarification'
  | 'direct-command'
  | 'task';

export interface UserIntent {
  kind: UserIntentKind;
  text: string;
  reason: string;
  /** Detected entities in the user text for downstream enrichment. */
  entities?: IntentEntities;
}

export interface IntentEntities {
  filePaths?: string[];
  errorPatterns?: string[];
  urls?: string[];
  commands?: string[];
  /** true when the user text references output from a previous turn */
  referencesContext?: boolean;
  /** Detected package managers (npm, pnpm, pip, …) for CLI routing */
  packageManagers?: string[];
  /** Short hint when npm lifecycle or exit codes appear in pasted output */
  lifecycleHint?: string;
}

export function extractCurrentUserRequest(input: string): string {
  const marker = /\nUser request:\s*\n([\s\S]+)$/i.exec(input);
  return (marker?.[1] || input || '').trim();
}

export function classifyUserIntent(input: string): UserIntent {
  const text = extractCurrentUserRequest(input);
  const lower = text.toLowerCase().trim();
  if (!lower) return { kind: 'empty', text, reason: 'empty input' };

  // Explicit command markers — highest priority
  if (isExplicitCommand(text)) {
    return {
      kind: 'direct-command',
      text,
      reason: 'explicit command marker or executable-shaped input',
      entities: extractEntities(text),
    };
  }

  // Pure conversational patterns
  if (isConversationOnly(lower, text)) {
    return { kind: 'conversation', text, reason: 'greeting, acknowledgement, or small talk' };
  }

  // Ambiguous follow-ups without clear object
  if (isClarificationOnly(lower, text)) {
    // But upgrade to task if there's strong actionable signal in recent words
    if (hasActionableSignal(lower)) {
      return { kind: 'task', text, reason: 'clarification with actionable signal', entities: extractEntities(text) };
    }
    return { kind: 'clarification', text, reason: 'ambiguous short follow-up without actionable object' };
  }

  return { kind: 'task', text, reason: 'actionable request', entities: extractEntities(text) };
}

export function isConversationOnlyInput(input: string): boolean {
  return classifyUserIntent(input).kind === 'conversation';
}

export function isClearlyActionableInput(input: string): boolean {
  const kind = classifyUserIntent(input).kind;
  return kind === 'task' || kind === 'direct-command';
}

export function buildCurrentIntentMessage(intent: UserIntent): string {
  const request = oneLine(intent.text).slice(0, 500);
  const instruction =
    intent.kind === 'conversation'
      ? 'Reply naturally and briefly. Do not use tools, continue previous work, print old command output, or mention old task details.'
      : intent.kind === 'clarification'
        ? 'Ask one short clarification question. Do not guess from previous context unless the user clearly referenced it.'
        : intent.kind === 'empty'
          ? 'Do not act. Ask for the missing request only if a response is required.'
          : 'Act only on this latest request. Use previous context only when clearly relevant.';

  const parts = [
    '<yamx_current_intent>',
    `kind=${intent.kind}`,
    `reason=${oneLine(intent.reason)}`,
    `current_request=${request || '(empty)'}`,
    `instruction=${instruction}`,
  ];

  // Attach entity hints so the agent can skip redundant detection
  if (intent.entities) {
    const e = intent.entities;
    if (e.filePaths?.length) parts.push(`detected_files=${e.filePaths.slice(0, 5).join(', ')}`);
    if (e.errorPatterns?.length) parts.push(`detected_errors=${e.errorPatterns.slice(0, 3).join('; ')}`);
    if (e.commands?.length) parts.push(`detected_commands=${e.commands.slice(0, 3).join('; ')}`);
    if (e.referencesContext) parts.push('references_previous_context=true');
    if (e.packageManagers?.length) parts.push(`detected_package_managers=${e.packageManagers.join(', ')}`);
    if (e.lifecycleHint) parts.push(`cli_lifecycle_hint=${oneLine(e.lifecycleHint)}`);
  }

  parts.push('</yamx_current_intent>');
  return parts.join('\n');
}

/* ── Conversation detection ─────────────────────────────────────────── */

function isConversationOnly(lower: string, _raw: string): boolean {
  // Single-word greetings and reactions
  if (/^(hi|hello|hey|yo|sup|hola|howdy|bonjour|hej|ciao|salut|ahoy|oi|namaste)[.!?]*$/i.test(lower)) return true;
  // Thanks / acknowledgements
  if (/^(thanks|thank you|thx|ty|cheers|much appreciated|ta|danke|merci|gracias)[.!?,\s]*$/i.test(lower)) return true;
  // Affirmative / close
  if (/^(ok|okay|k|cool|great|nice|awesome|good|got it|understood|sure|yep|yeah|yup|yes|right|correct|exactly|perfect|noted|ack|alright|fine|sounds good|makes sense|fair enough|roger|word|bet)[.!?]*$/i.test(lower)) return true;
  // Farewells
  if (/^(bye|goodbye|see ya|later|peace|cya|ttyl|gn|good night|nite)[.!?]*$/i.test(lower)) return true;
  // Social questions
  if (/^(good morning|good afternoon|good evening|how are you|how's it going|what's up|how do you do|what's good)[.!?]*$/i.test(lower)) return true;
  // Emoji-only or very short reactions
  if (/^[\p{Emoji_Presentation}\p{Emoji}\s👍👎🎉💯🔥✅❌]+$/u.test(lower) && lower.length <= 12) return true;
  // Laughter
  if (/^(ha(ha)+|lol|lmao|rofl|😂+|🤣+)[.!?]*$/i.test(lower)) return true;

  return false;
}

/* ── Clarification detection ────────────────────────────────────────── */

function isClarificationOnly(lower: string, raw: string): boolean {
  // Very short ambiguous follow-ups
  if (/^(more|continue|go on|go ahead|again|do it|that one|this one|same|what about it|and then|next|proceed|keep going|carry on)[.!?]*$/i.test(lower)) return true;

  // "fix it", "run it", "install it", "show me" etc. — but only when very short (no specific object)
  if (/^(fix|run|install|show|try|do|check|test|build|start|stop|restart|deploy|update|upgrade|delete|remove|undo)\s+(it|that|this|them)[.!?]*$/i.test(lower)) {
    // These are clarification ONLY if there's no additional context
    if (raw.trim().split(/\s+/).length <= 3) return true;
  }

  // "yes do it", "yeah go ahead"
  if (/^(yes|yeah|yep|yup|sure|ok|okay)\s+(do it|go ahead|proceed|continue|run it|fix it|go on)[.!?]*$/i.test(lower)) return true;

  return false;
}

/* ── Actionable signal in clarification text ─────────────────────────── */

function hasActionableSignal(lower: string): boolean {
  // If the clarification includes technical words, upgrade to task
  return /\b(error|bug|file|path|port|server|database|api|endpoint|config|module|function|class|package|dependency|version|build|test|deploy|container|docker|git|branch|commit|merge|rebase)\b/.test(lower);
}

/* ── Explicit command detection ─────────────────────────────────────── */

function isExplicitCommand(text: string): boolean {
  const trimmed = text.trim();
  // Explicit shell markers
  if (/^(\$ |> |!|run:|exec:|execute:|shell:|cmd:)/i.test(trimmed)) return true;
  // Env var assignment prefix (KEY=val command)
  if (/^[A-Z_][A-Z0-9_]*=\S+\s+\S/i.test(trimmed)) return true;
  // Backtick-fenced command
  if (/^```\w*\s*\n?.+\n?```$/s.test(trimmed)) return true;
  // Pipe chain with known commands
  if (/\|\s*(grep|awk|sed|sort|uniq|wc|head|tail|cut|tr|xargs|jq|yq|rg)\b/.test(trimmed)) return true;
  // Known executable at start
  if (/^\s*(npm|pnpm|yarn|bun|node|python|python3|py|git|docker|kubectl|helm|terraform|tofu|ansible|make|cargo|go|java|mvn|gradle|curl|wget|ping|tracert|traceroute|nslookup|ipconfig|ifconfig|netstat|ss|rg|grep|cat|ls|dir|cd|mkdir|rm|cp|mv|echo|which|where|whoami|pip|pip3|composer|php|ruby|dotnet|rustup|rustc)\b/i.test(trimmed)) return true;
  // Path-style invocations
  if (/^(\.\/|\.\\|~\/|[a-z]:\\)/i.test(trimmed)) return true;
  return false;
}

/* ── Entity extraction ──────────────────────────────────────────────── */

function extractEntities(text: string): IntentEntities {
  const entities: IntentEntities = {};

  // File paths
  const pathMatches = text.match(/(?:^|\s)((?:\.\/|\.\\|\/|~\/|[a-z]:\\)[\w.\/\\-]+)/gi);
  if (pathMatches?.length) {
    entities.filePaths = pathMatches.map(p => p.trim()).slice(0, 8);
  }
  // Also match quoted paths and common extensions
  const extMatches = text.match(/\b[\w./\\-]+\.(ts|tsx|js|jsx|py|go|rs|java|json|yaml|yml|toml|md|txt|sh|ps1|css|html|sql|c|cpp|h|cs|rb|php)\b/gi);
  if (extMatches?.length) {
    entities.filePaths = [...(entities.filePaths || []), ...extMatches].slice(0, 8);
  }

  // Error patterns
  const errorMatches = text.match(/(?:error|exception|fatal|failed|failure|traceback|TypeError|SyntaxError|ReferenceError|ENOENT|EACCES|EPERM|ECONNREFUSED|EADDRINUSE|Cannot find module|Module not found|command not found|not recognized)[^.!?\n]*/gi);
  if (errorMatches?.length) {
    entities.errorPatterns = errorMatches.map(e => e.trim()).slice(0, 5);
  }

  // URLs
  const urlMatches = text.match(/https?:\/\/\S+/gi);
  if (urlMatches?.length) {
    entities.urls = urlMatches.slice(0, 3);
  }

  // Inline commands (backtick-wrapped)
  const cmdMatches = text.match(/`([^`]{2,80})`/g);
  if (cmdMatches?.length) {
    entities.commands = cmdMatches.map(c => c.replace(/`/g, '')).slice(0, 5);
  }

  // References to previous context
  if (/\b(that error|the output|above|previous|last command|earlier|before|same error|that file|the result)\b/i.test(text)) {
    entities.referencesContext = true;
  }

  const pm = text.match(/\b(npm|pnpm|yarn|bun|pip|pip3|poetry|uv|cargo|composer|gem|go\s+mod|dotnet)\b/gi);
  if (pm?.length) {
    entities.packageManagers = [...new Set(pm.map((s) => s.toLowerCase().replace(/\s+/, '')))].slice(0, 5);
  }

  const exitM = /\bexit\s+(?:code\s+)?(\d{1,3})\b/i.exec(text);
  if (exitM) entities.lifecycleHint = `exit ${exitM[1]}`;
  else if (/\bELIFECYCLE\b/i.test(text)) entities.lifecycleHint = 'npm lifecycle failure';
  else if (/\bEADDRINUSE\b/i.test(text)) entities.lifecycleHint = 'port already in use';
  else if (/\bECONNREFUSED\b/i.test(text)) entities.lifecycleHint = 'connection refused';
  else if (/\bENOENT\b/i.test(text)) entities.lifecycleHint = 'missing file/path (ENOENT)';

  return Object.keys(entities).length > 0 ? entities : {};
}

function oneLine(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
