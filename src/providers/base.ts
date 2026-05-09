/**
 * Yam Agent - Provider Abstraction Layer
 * Unified interface for all LLM providers (cloud + local).
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  providerMetadata?: {
    gemini?: {
      thought?: boolean;
      thoughtSignature?: string;
    };
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface CompletionOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResult {
  content: string | null;
  tool_calls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface StreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done';
  content?: string;
  toolCall?: Partial<ToolCall>;
}

export function toOpenAIToolCalls(toolCalls?: ToolCall[]): ToolCall[] | undefined {
  if (!toolCalls) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: tc.type,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));
}

export interface Provider {
  name: string;
  modelId: string;
  complete(options: CompletionOptions): Promise<CompletionResult>;
  stream(options: CompletionOptions): AsyncGenerator<StreamChunk>;
}
