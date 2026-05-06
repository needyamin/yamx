/**
 * Yam Agent - Ollama Provider (Local LLMs: Qwen, DeepSeek, Llama, etc.)
 */

import axios from 'axios';
import { Provider, CompletionOptions, CompletionResult, StreamChunk, ToolCall, Message } from './base.js';

export class OllamaProvider implements Provider {
  name = 'ollama';
  modelId: string;
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'qwen2.5-coder') {
    this.baseUrl = baseUrl;
    this.modelId = model;
  }

  private formatMessages(messages: Message[]) {
    return messages.map(m => ({
      role: m.role === 'tool' ? 'user' : m.role,
      content: m.role === 'tool'
        ? `[Tool Result for ${m.name}]: ${m.content}`
        : (m.content || ''),
    }));
  }

  private formatTools(tools?: import('./base.js').ToolDefinition[]) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const response = await axios.post(`${this.baseUrl}/api/chat`, {
      model: this.modelId,
      messages: this.formatMessages(options.messages),
      tools: this.formatTools(options.tools),
      stream: false,
      options: {
        temperature: options.temperature ?? 0.1,
        num_predict: options.maxTokens ?? 16384,
      },
    });

    const msg = response.data.message;
    const toolCalls: ToolCall[] = [];

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCalls.push({
          id: `ollama_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: JSON.stringify(tc.function.arguments),
          },
        });
      }
    }

    return {
      content: msg.content || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.data.prompt_eval_count ? {
        inputTokens: response.data.prompt_eval_count || 0,
        outputTokens: response.data.eval_count || 0,
      } : undefined,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const response = await axios.post(
      `${this.baseUrl}/api/chat`,
      {
        model: this.modelId,
        messages: this.formatMessages(options.messages),
        tools: this.formatTools(options.tools),
        stream: true,
        options: {
          temperature: options.temperature ?? 0.1,
          num_predict: options.maxTokens ?? 16384,
        },
      },
      { responseType: 'stream' },
    );

    let buffer = '';
    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            yield { type: 'text', content: data.message.content };
          }
          if (data.message?.tool_calls) {
            for (const tc of data.message.tool_calls) {
              const toolCall: ToolCall = {
                id: `ollama_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                type: 'function',
                function: {
                  name: tc.function.name,
                  arguments: JSON.stringify(tc.function.arguments),
                },
              };
              yield { type: 'tool_call_start', toolCall };
              yield { type: 'tool_call_end', toolCall };
            }
          }
          if (data.done) {
            yield { type: 'done' };
          }
        } catch {
          // skip malformed JSON
        }
      }
    }

    yield { type: 'done' };
  }
}
