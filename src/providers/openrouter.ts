/**
 * YamX - OpenRouter Provider
 * Access many models through a single OpenAI-compatible API — DeepSeek,
 * Llama, Claude, GPT, Gemini, Moonshot/Kimi, xAI Grok, and others.
 * through a single API key. Uses OpenAI-compatible API format.
 * 
 * Get your key at: https://openrouter.ai/keys
 */

import OpenAI from 'openai';
import { Provider, CompletionOptions, CompletionResult, StreamChunk, ToolCall } from './base.js';

// Popular models available on OpenRouter (shorthand → provider/model slug)
export const OPENROUTER_MODELS: Record<string, string> = {
  'deepseek-chat': 'deepseek/deepseek-chat-v3.1',
  'deepseek-chat-v3': 'deepseek/deepseek-chat-v3-0324',
  'deepseek-r1': 'deepseek/deepseek-r1',
  'llama-4-maverick': 'meta-llama/llama-4-maverick',
  'llama-4-scout': 'meta-llama/llama-4-scout',
  'qwen-3-235b': 'qwen/qwen3-235b-a22b',
  'qwen-3-30b': 'qwen/qwen3-30b-a3b',
  'gemini-3-flash': 'google/gemini-3-flash-preview',
  'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
  'gemini-3-pro': 'google/gemini-3-pro-preview',
  'gemini-3-pro-preview': 'google/gemini-3-pro-preview',
  'gemini-flash-latest': 'google/gemini-3-flash-preview',
  'gemini-pro-latest': 'google/gemini-3-pro-preview',
  'gemini-2.5-pro': 'google/gemini-2.5-pro-preview',
  'gemini-2.5-flash': 'google/gemini-2.5-flash-preview',
  'claude-sonnet-4': 'anthropic/claude-sonnet-4',
  'claude-sonnet-4.0': 'anthropic/claude-sonnet-4',
  'claude-opus-4.1': 'anthropic/claude-opus-4.1',
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  'gpt-5.2': 'openai/gpt-5.2',
  'gpt-5.1': 'openai/gpt-5.1',
  'gpt-5': 'openai/gpt-5',
  'gpt-5-mini': 'openai/gpt-5-mini',
  'gpt-5-nano': 'openai/gpt-5-nano',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4.1': 'openai/gpt-4.1',
  'o3': 'openai/o3',
  'o4-mini': 'openai/o4-mini',
  'mistral-large': 'mistralai/mistral-large-2411',
  'codestral': 'mistralai/codestral-2501',
  'kimi-k2.5': 'moonshotai/kimi-k2.5',
  'kimi-k2-thinking': 'moonshotai/kimi-k2-thinking',
  'kimi-k2.6': 'moonshotai/kimi-k2.6',
  'grok-4.3': 'x-ai/grok-4.3',
  'grok-4-latest': 'x-ai/grok-4-latest',
  'grok-4': 'x-ai/grok-4',
};

export class OpenRouterProvider implements Provider {
  name = 'openrouter';
  modelId: string;
  private client: OpenAI;
  private rawModel: string;

  constructor(apiKey: string, model: string = 'deepseek/deepseek-chat-v3.1') {
    // Resolve shorthand model names
    this.rawModel = OPENROUTER_MODELS[model] || model;
    this.modelId = model;

    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/needyamin/yamx',
        'X-Title': 'YamX CLI',
      },
    });
  }

  private formatTools(tools?: import('./base.js').ToolDefinition[]) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.rawModel,
      messages: options.messages.map(m => ({
        role: m.role as any,
        content: m.content || '',
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      tools: this.formatTools(options.tools),
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 16384,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content,
      tool_calls: choice.message.tool_calls as ToolCall[] | undefined,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.rawModel,
      messages: options.messages.map(m => ({
        role: m.role as any,
        content: m.content || '',
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      tools: this.formatTools(options.tools),
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 16384,
      stream: true,
    });

    const toolCalls: Record<number, { id: string; name: string; args: string }> = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: 'text', content: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (tc.id) {
            toolCalls[idx] = { id: tc.id, name: '', args: '' };
            yield { type: 'tool_call_start', toolCall: { id: tc.id, type: 'function' } };
          }
          if (tc.function?.name && toolCalls[idx]) {
            toolCalls[idx].name += tc.function.name;
          }
          if (tc.function?.arguments && toolCalls[idx]) {
            toolCalls[idx].args += tc.function.arguments;
            yield {
              type: 'tool_call_delta',
              toolCall: {
                id: toolCalls[idx].id,
                type: 'function',
                function: { name: toolCalls[idx].name, arguments: tc.function.arguments },
              },
            };
          }
        }
      }

      if (chunk.choices[0]?.finish_reason === 'tool_calls') {
        for (const [, tc] of Object.entries(toolCalls)) {
          yield {
            type: 'tool_call_end',
            toolCall: {
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.args },
            },
          };
        }
      }
    }

    yield { type: 'done' };
  }
}
