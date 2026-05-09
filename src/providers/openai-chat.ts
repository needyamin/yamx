/**
 * Shared OpenAI-compatible Chat Completions provider (used by OpenAI, Kimi/Moonshot, Grok/xAI, etc.)
 */

import OpenAI from 'openai';
import { Provider, CompletionOptions, CompletionResult, StreamChunk, ToolCall, toOpenAIToolCalls } from './base.js';

export interface OpenAIChatProviderOptions {
  /** YamX provider id shown in UI (`openai`, `kimi`, `grok`, …). */
  name: string;
  apiKey: string;
  model: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string | undefined>;
  /** Milliseconds; Grok reasoning workloads often need a long client timeout. */
  timeout?: number;
}

export class OpenAIChatProvider implements Provider {
  name: string;
  modelId: string;
  private client: OpenAI;
  private usesOfficialOpenAI: boolean;

  constructor(opts: OpenAIChatProviderOptions) {
    const headers = opts.defaultHeaders;
    const cleanedHeaders =
      headers &&
      Object.fromEntries(Object.entries(headers).filter(([, v]) => v != null && v !== '')) as
        | Record<string, string>
        | undefined;

    this.name = opts.name;
    this.modelId = opts.model;
    this.usesOfficialOpenAI = opts.name === 'openai' && !opts.baseURL;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      defaultHeaders: cleanedHeaders,
      timeout: opts.timeout,
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
    const tokenLimit = this.usesOfficialOpenAI
      ? { max_completion_tokens: options.maxTokens ?? 16384 }
      : { max_tokens: options.maxTokens ?? 16384 };
    const response = await this.client.chat.completions.create({
      model: this.modelId,
      messages: options.messages.map(m => ({
        role: m.role as any,
        content: m.content || '',
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls ? { tool_calls: toOpenAIToolCalls(m.tool_calls) } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      tools: this.formatTools(options.tools),
      temperature: options.temperature ?? 0.1,
      ...tokenLimit,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content,
      tool_calls: choice.message.tool_calls as ToolCall[] | undefined,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const tokenLimit = this.usesOfficialOpenAI
      ? { max_completion_tokens: options.maxTokens ?? 16384 }
      : { max_tokens: options.maxTokens ?? 16384 };
    const stream = await this.client.chat.completions.create({
      model: this.modelId,
      messages: options.messages.map(m => ({
        role: m.role as any,
        content: m.content || '',
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls ? { tool_calls: toOpenAIToolCalls(m.tool_calls) } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      tools: this.formatTools(options.tools),
      temperature: options.temperature ?? 0.1,
      ...tokenLimit,
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
