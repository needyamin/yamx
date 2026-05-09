/**
 * YamX - Google Gemini Provider (Gemini Developer API via `@google/genai`)
 */

import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  createPartFromFunctionResponse,
  type Content,
} from '@google/genai';
import { Provider, CompletionOptions, CompletionResult, StreamChunk, ToolCall, Message } from './base.js';

function parseToolArgs(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json || '{}');
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class GeminiProvider implements Provider {
  name = 'gemini';
  modelId: string;
  private ai: GoogleGenAI;

  constructor(apiKey: string, model: string = 'gemini-3-flash-preview') {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelId = model;
  }

  private buildContents(messages: Message[]): { systemInstruction?: string; contents: Content[] } {
    const system = messages.find(m => m.role === 'system');
    const contents: Content[] = [];

    for (const msg of messages.filter(m => m.role !== 'system')) {
      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content || '' }] });
      } else if (msg.role === 'assistant') {
        const parts: NonNullable<Content['parts']> = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            parts.push({
              functionCall: {
                id: tc.id,
                name: tc.function.name,
                args: parseToolArgs(tc.function.arguments),
              },
            });
          }
        }
        if (parts.length > 0) contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        const id = msg.tool_call_id || `gemini_tool_${contents.length}`;
        const name = msg.name || 'unknown';
        contents.push({
          role: 'user',
          parts: [createPartFromFunctionResponse(id, name, { result: msg.content || '' })],
        });
      }
    }

    return {
      systemInstruction: system?.content || undefined,
      contents,
    };
  }

  private formatTools(tools?: import('./base.js').ToolDefinition[]) {
    if (!tools || tools.length === 0) return undefined;
    return [
      {
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.parameters,
        })),
      },
    ];
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const { systemInstruction, contents } = this.buildContents(options.messages);
    const hasTools = (options.tools?.length ?? 0) > 0;

    const response = await this.ai.models.generateContent({
      model: this.modelId,
      contents,
      config: {
        systemInstruction,
        tools: this.formatTools(options.tools),
        toolConfig: hasTools
          ? { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }
          : undefined,
        temperature: options.temperature ?? 0.1,
        maxOutputTokens: options.maxTokens ?? 16384,
      },
    });

    let content: string | null = null;
    const toolCalls: ToolCall[] = [];

    for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) content = (content || '') + part.text;
        if (part.functionCall?.name) {
          const fid =
            part.functionCall.id || `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          toolCalls.push({
            id: fid,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            },
          });
        }
      }
    }

    const um = response.usageMetadata;
    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: um
        ? {
            inputTokens: um.promptTokenCount ?? 0,
            outputTokens: um.candidatesTokenCount ?? 0,
          }
        : undefined,
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const { systemInstruction, contents } = this.buildContents(options.messages);
    const hasTools = (options.tools?.length ?? 0) > 0;

    const stream = await this.ai.models.generateContentStream({
      model: this.modelId,
      contents,
      config: {
        systemInstruction,
        tools: this.formatTools(options.tools),
        toolConfig: hasTools
          ? { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }
          : undefined,
        temperature: options.temperature ?? 0.1,
        maxOutputTokens: options.maxTokens ?? 16384,
      },
    });

    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) yield { type: 'text', content: part.text };
        if (part.functionCall?.name) {
          const tc: ToolCall = {
            id:
              part.functionCall.id || `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
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
