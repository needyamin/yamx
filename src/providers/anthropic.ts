/**
 * YamX - Anthropic Provider (Claude 4.x / Sonnet / Opus, etc.)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Provider, CompletionOptions, CompletionResult, StreamChunk, ToolCall, Message } from './base.js';

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  modelId: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey });
    this.modelId = model;
  }

  private convertMessages(messages: Message[]) {
    // Anthropic uses a separate system parameter, not a system message in the array
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    const converted: any[] = [];
    for (const msg of nonSystem) {
      if (msg.role === 'tool') {
        converted.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content || '',
            },
          ],
        });
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        const content: any[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
        converted.push({ role: 'assistant', content });
      } else {
        converted.push({
          role: msg.role,
          content: msg.content || '',
        });
      }
    }

    return { system: systemMsg?.content || '', messages: converted };
  }

  private formatTools(tools?: import('./base.js').ToolDefinition[]) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const { system, messages } = this.convertMessages(options.messages);

    const response = await this.client.messages.create({
      model: this.modelId,
      system,
      messages,
      tools: this.formatTools(options.tools) as any,
      max_tokens: options.maxTokens ?? 16384,
      temperature: options.temperature ?? 0.1,
    });

    let content: string | null = null;
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content = (content || '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const { system, messages } = this.convertMessages(options.messages);

    const stream = this.client.messages.stream({
      model: this.modelId,
      system,
      messages,
      tools: this.formatTools(options.tools) as any,
      max_tokens: options.maxTokens ?? 16384,
      temperature: options.temperature ?? 0.1,
    });

    let currentToolId = '';
    let currentToolName = '';
    let currentToolArgs = '';

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolArgs = '';
          yield {
            type: 'tool_call_start',
            toolCall: { id: currentToolId, type: 'function', function: { name: currentToolName, arguments: '' } },
          };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', content: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          currentToolArgs += event.delta.partial_json;
          yield {
            type: 'tool_call_delta',
            toolCall: {
              id: currentToolId,
              type: 'function',
              function: { name: currentToolName, arguments: event.delta.partial_json },
            },
          };
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolId) {
          yield {
            type: 'tool_call_end',
            toolCall: {
              id: currentToolId,
              type: 'function',
              function: { name: currentToolName, arguments: currentToolArgs },
            },
          };
          currentToolId = '';
          currentToolName = '';
          currentToolArgs = '';
        }
      }
    }

    yield { type: 'done' };
  }
}
