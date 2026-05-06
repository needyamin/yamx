/**
 * Yam Agent - Google Gemini Provider
 */

import { GoogleGenerativeAI, FunctionCallingMode } from '@google/generative-ai';
import { Provider, CompletionOptions, CompletionResult, StreamChunk, ToolCall, Message } from './base.js';

export class GeminiProvider implements Provider {
  name = 'gemini';
  modelId: string;
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelId = model;
  }

  private convertHistory(messages: Message[]) {
    const system = messages.find(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    const history: any[] = [];
    for (const msg of nonSystem) {
      if (msg.role === 'user') {
        history.push({ role: 'user', parts: [{ text: msg.content || '' }] });
      } else if (msg.role === 'assistant') {
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments),
              },
            });
          }
        }
        history.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        history.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.name || 'unknown',
                response: { result: msg.content || '' },
              },
            },
          ],
        });
      }
    }

    return { systemInstruction: system?.content || '', history };
  }

  private formatTools(tools?: import('./base.js').ToolDefinition[]): any {
    if (!tools || tools.length === 0) return undefined;
    return [
      {
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters as any,
        })),
      },
    ];
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const { systemInstruction, history } = this.convertHistory(options.messages);

    const model = this.genAI.getGenerativeModel({
      model: this.modelId,
      systemInstruction,
      tools: this.formatTools(options.tools),
      toolConfig: options.tools?.length
        ? { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
        : undefined,
    });

    // Use last user message as the prompt, prior messages as history
    const lastMsg = history.pop();
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastMsg?.parts || []);
    const response = result.response;

    let content: string | null = null;
    const toolCalls: ToolCall[] = [];

    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.text) {
          content = (content || '') + part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            },
          });
        }
      }
    }

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usageMetadata ? {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
      } : undefined,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const { systemInstruction, history } = this.convertHistory(options.messages);

    const model = this.genAI.getGenerativeModel({
      model: this.modelId,
      systemInstruction,
      tools: this.formatTools(options.tools),
      toolConfig: options.tools?.length
        ? { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
        : undefined,
    });

    const lastMsg = history.pop();
    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMsg?.parts || []);

    for await (const chunk of result.stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts || []) {
        if (part.text) {
          yield { type: 'text', content: part.text };
        }
        if (part.functionCall) {
          const tc: ToolCall = {
            id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            },
          };
          yield { type: 'tool_call_start', toolCall: tc };
          yield { type: 'tool_call_end', toolCall: tc };
        }
      }
    }

    yield { type: 'done' };
  }
}
