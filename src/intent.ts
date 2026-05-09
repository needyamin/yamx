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
}

export function extractCurrentUserRequest(input: string): string {
  const marker = /\nUser request:\s*\n([\s\S]+)$/i.exec(input);
  return (marker?.[1] || input || '').trim();
}

export function classifyUserIntent(input: string): UserIntent {
  const text = extractCurrentUserRequest(input);
  const lower = text.toLowerCase().trim();
  if (!lower) return { kind: 'empty', text, reason: 'empty input' };

  if (isExplicitCommand(text)) {
    return { kind: 'direct-command', text, reason: 'explicit command marker or executable-shaped input' };
  }

  if (isConversationOnly(lower)) {
    return { kind: 'conversation', text, reason: 'greeting, acknowledgement, or small talk' };
  }

  if (isClarificationOnly(lower)) {
    return { kind: 'clarification', text, reason: 'ambiguous short follow-up without actionable object' };
  }

  return { kind: 'task', text, reason: 'actionable request' };
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

  return [
    '<yamx_current_intent>',
    `kind=${intent.kind}`,
    `reason=${oneLine(intent.reason)}`,
    `current_request=${request || '(empty)'}`,
    `instruction=${instruction}`,
    '</yamx_current_intent>',
  ].join('\n');
}

function isConversationOnly(lower: string): boolean {
  return /^(hi|hello|hey|yo|sup|thanks|thank you|thx|ok|okay|k|cool|great|nice|awesome|good|got it|understood|sounds good|bye|goodbye)[.!?]*$/i.test(lower)
    || /^(good morning|good afternoon|good evening|how are you|how's it going)[.!?]*$/i.test(lower);
}

function isClarificationOnly(lower: string): boolean {
  return /^(more|continue|go on|again|do it|that one|this one|same|what about it|fix it|run it|install it)[.!?]*$/i.test(lower);
}

function isExplicitCommand(text: string): boolean {
  const trimmed = text.trim();
  if (/^(\$ |> |!|run:|exec:|execute:|shell:|cmd:)/i.test(trimmed)) return true;
  return /^\s*(npm|pnpm|yarn|node|python|python3|py|git|docker|kubectl|helm|terraform|tofu|ansible|make|cargo|go|java|mvn|gradle|curl|ping|tracert|traceroute|nslookup|ipconfig|ifconfig|netstat|ss|rg|grep)\b/i.test(trimmed);
}

function oneLine(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
