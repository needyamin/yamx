/**
 * YamX - Core Agent Loop
 * Production-grade ReAct agent with streaming, tool calling, approval flow,
 * and multi-turn reasoning.
 */

import { Provider, Message, ToolCall, CompletionResult } from './providers/base.js';
import { allTools, getToolDefinitions, getTool } from './tools/registry.js';
import { UI } from './ui.js';
import inquirer from 'inquirer';

const MAX_TOOL_ITERATIONS = 40; // Safety: prevent infinite loops
const MAX_RETRIES = 3; // Retry on transient API failures
const RETRY_DELAYS = [1000, 3000, 8000]; // Exponential backoff (ms)

export interface AgentOptions {
  autoApprove?: boolean;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Restored from disk; if set, overrides fresh system-only bootstrap */
  initialHistory?: Message[] | null;
  onPersist?: () => void | Promise<void>;
  /** Total serialized history size (chars) before auto-compression */
  contextBudgetChars?: number;
}

export class Agent {
  private provider: Provider;
  private history: Message[] = [];
  private ui: UI;
  private options: AgentOptions;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private fileChanges: Array<{ path: string; oldContent: string; action: string }> = [];

  /** Retry wrapper for API calls */
  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const isRetryable =
          error.status === 429 ||
          error.status === 500 ||
          error.status === 502 ||
          error.status === 503 ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT';

        if (isRetryable && attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAYS[attempt];
          this.ui.warn(`${label} failed (${error.message}). Retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  constructor(provider: Provider, systemPrompt: string, options: AgentOptions = {}) {
    this.provider = provider;
    this.ui = new UI();
    this.options = {
      autoApprove: false,
      stream: true,
      maxTokens: 16384,
      temperature: 0.1,
      ...options,
    };
    if (this.options.initialHistory && this.options.initialHistory.length > 0) {
      this.history = JSON.parse(JSON.stringify(this.options.initialHistory)) as Message[];
    } else {
      this.history.push({ role: 'system', content: systemPrompt });
    }
  }

  getHistory(): Message[] {
    return JSON.parse(JSON.stringify(this.history)) as Message[];
  }

  private estimateHistoryChars(): number {
    return this.history.reduce((n, m) => n + JSON.stringify(m).length, 0);
  }

  private async ensureContextBudget(): Promise<void> {
    const budget = this.options.contextBudgetChars ?? 280_000;
    let guard = 0;
    while (this.estimateHistoryChars() > budget && this.history.length > 4 && guard < 10) {
      guard++;
      await this.compactMiddle(16, true);
    }
  }

  /** Summarize the middle of history; keep system + last `keepLast` messages. Preserves system. */
  private async compactMiddle(keepLast: number, silent = false): Promise<void> {
    if (this.history.length <= 2 + keepLast) return;

    const systemPrompt = this.history[0];
    const recentMessages = this.history.slice(-keepLast);
    const oldMessages = this.history.slice(1, -keepLast);

    if (oldMessages.length === 0) return;

    if (!silent) this.ui.startThinking('Compacting conversation...');
    else this.ui.startThinking('Optimizing context (long conversation)…');

    const oldText = oldMessages
      .map((m) => {
        const c = m.content ?? '';
        const toolInfo =
          m.role === 'tool'
            ? `[tool ${m.name ?? ''}]: ${c.slice(0, 2000)}`
            : m.tool_calls
              ? `[assistant tool_calls]`
              : `[${m.role}]: ${c.slice(0, 1500)}`;
        return toolInfo;
      })
      .join('\n---\n');

    const summaryResult = await this.withRetry(
      () =>
        this.provider.complete({
          messages: [
            {
              role: 'system',
              content:
                'Summarize the following chat segment for a coding assistant. Preserve: user goals, file paths touched, commands run, errors, and decisions. Be dense.',
            },
            { role: 'user', content: oldText.slice(0, 120_000) },
          ],
          maxTokens: 4096,
          temperature: 0.2,
        }),
      'Summarize'
    );

    this.ui.stopSpinner();

    const summary = summaryResult.content || 'Prior context summarized.';
    this.history = [
      systemPrompt,
      {
        role: 'user',
        content: `[Compressed thread memory — retain facts below for continuity]\n${summary}`,
      },
      {
        role: 'assistant',
        content:
          'Understood. I treat that summary as authoritative background for the recent messages that follow.',
      },
      ...recentMessages,
    ];

    if (!silent) {
      this.ui.success(`Compacted ${oldMessages.length} messages. History: ${this.history.length} messages.`);
    } else {
      this.ui.info('Context compressed to stay within model limits.');
    }

    await Promise.resolve(this.options.onPersist?.());
  }

  /** Main chat entry point */
  async chat(userInput: string): Promise<void> {
    await this.ensureContextBudget();
    this.history.push({ role: 'user', content: userInput });
    this.fileChanges = []; // Reset undo buffer per turn

    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      if (this.options.stream) {
        const result = await this.streamResponse();
        if (!result.tool_calls || result.tool_calls.length === 0) {
          break; // No more tools, done
        }

        // Process tool calls
        const shouldContinue = await this.processToolCalls(result.tool_calls);
        if (!shouldContinue) break;
      } else {
        const result = await this.completeResponse();
        if (!result.tool_calls || result.tool_calls.length === 0) {
          break;
        }

        const shouldContinue = await this.processToolCalls(result.tool_calls);
        if (!shouldContinue) break;
      }
    }

    if (iterations >= MAX_TOOL_ITERATIONS) {
      this.ui.warn(`Reached maximum tool iterations (${MAX_TOOL_ITERATIONS}). Stopping.`);
    }

    await Promise.resolve(this.options.onPersist?.());
  }

  /** Non-streaming completion */
  private async completeResponse(): Promise<CompletionResult> {
    this.ui.startThinking();

    try {
      const result = await this.withRetry(() => this.provider.complete({
        messages: this.history,
        tools: getToolDefinitions(),
        maxTokens: this.options.maxTokens,
        temperature: this.options.temperature,
      }), 'API call');

      this.ui.stopSpinner();

      if (result.usage) {
        this.totalInputTokens += result.usage.inputTokens;
        this.totalOutputTokens += result.usage.outputTokens;
      }

      // Add assistant message to history
      const assistantMsg: Message = {
        role: 'assistant',
        content: result.content,
        tool_calls: result.tool_calls,
      };
      this.history.push(assistantMsg);

      if (result.content) {
        console.log('\n' + result.content);
      }

      return result;
    } catch (error: any) {
      this.ui.stopSpinner();
      this.ui.error(`Provider error: ${error.message}`);
      return { content: null };
    }
  }

  /** Streaming completion */
  private async streamResponse(): Promise<CompletionResult> {
    this.ui.startThinking();

    try {
      let fullContent = '';
      const toolCalls: ToolCall[] = [];
      const toolCallBuffers: Record<string, { id: string; name: string; args: string }> = {};
      let firstText = true;

      const stream = this.provider.stream({
        messages: this.history,
        tools: getToolDefinitions(),
        maxTokens: this.options.maxTokens,
        temperature: this.options.temperature,
      });

      for await (const chunk of stream) {
        switch (chunk.type) {
          case 'text':
            if (firstText) {
              this.ui.stopSpinner();
              process.stdout.write('\n');
              firstText = false;
            }
            process.stdout.write(chunk.content || '');
            fullContent += chunk.content || '';
            break;

          case 'tool_call_start':
            if (chunk.toolCall?.id) {
              toolCallBuffers[chunk.toolCall.id] = {
                id: chunk.toolCall.id,
                name: chunk.toolCall.function?.name || '',
                args: '',
              };
            }
            break;

          case 'tool_call_delta':
            if (chunk.toolCall?.id && toolCallBuffers[chunk.toolCall.id]) {
              if (chunk.toolCall.function?.name) {
                toolCallBuffers[chunk.toolCall.id].name = chunk.toolCall.function.name;
              }
              if (chunk.toolCall.function?.arguments) {
                toolCallBuffers[chunk.toolCall.id].args += chunk.toolCall.function.arguments;
              }
            }
            break;

          case 'tool_call_end':
            if (chunk.toolCall?.id) {
              const buf = toolCallBuffers[chunk.toolCall.id];
              if (buf) {
                toolCalls.push({
                  id: buf.id,
                  type: 'function',
                  function: { name: buf.name, arguments: buf.args },
                });
              } else if (chunk.toolCall.function) {
                toolCalls.push(chunk.toolCall as ToolCall);
              }
            }
            break;

          case 'done':
            break;
        }
      }

      if (fullContent) {
        console.log(); // newline after stream
      }

      this.ui.stopSpinner();

      // Add assistant message to history
      const assistantMsg: Message = {
        role: 'assistant',
        content: fullContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      this.history.push(assistantMsg);

      return {
        content: fullContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error: any) {
      this.ui.stopSpinner();
      this.ui.error(`Stream error: ${error.message}`);
      return { content: null };
    }
  }

  /** Process tool calls with approval flow */
  private async processToolCalls(toolCalls: ToolCall[]): Promise<boolean> {
    for (const tc of toolCalls) {
      const tool = getTool(tc.function.name);
      if (!tool) {
        this.ui.error(`Unknown tool: ${tc.function.name}`);
        this.history.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: `Error: Unknown tool "${tc.function.name}"`,
        });
        continue;
      }

      let args: any;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }

      // Check if approval is needed
      if (tool.needsApproval && !this.options.autoApprove) {
        const isDangerous = tool.isDangerous?.(args) ?? false;

        this.ui.approvalNeeded(tc.function.name, args);

        const { approved } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'approved',
            message: isDangerous
              ? '⚠️  This is a DANGEROUS operation. Proceed?'
              : 'Allow this action?',
            default: !isDangerous,
          },
        ]);

        if (!approved) {
          this.history.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: 'Action was DENIED by the user. Try a different approach or ask for clarification.',
          });
          continue;
        }
      }

      // Execute the tool
      this.ui.toolCall(tc.function.name, args);
      const startTime = Date.now();

      try {
        // Track file changes for undo
        if (['write_file', 'edit_file', 'delete_file'].includes(tc.function.name) && args.path) {
          await this.trackFileChange(args.path);
        }

        const result = await tool.execute(args);
        const duration = Date.now() - startTime;
        this.ui.toolResult(tc.function.name, result, duration);

        this.history.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: result,
        });
      } catch (error: any) {
        const duration = Date.now() - startTime;
        const errorMsg = `Error executing ${tc.function.name}: ${error.message}`;
        this.ui.error(`${errorMsg} (${duration}ms)`);

        this.history.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: errorMsg,
        });
      }
    }

    return true; // continue the loop
  }

  /** Track file changes for undo */
  private async trackFileChange(filePath: string) {
    const fs = await import('fs-extra');
    const path = await import('path');
    const fullPath = path.resolve(process.cwd(), filePath);
    try {
      if (await fs.default.pathExists(fullPath)) {
        const content = await fs.default.readFile(fullPath, 'utf-8');
        this.fileChanges.push({ path: filePath, oldContent: content, action: 'modified' });
      } else {
        this.fileChanges.push({ path: filePath, oldContent: '', action: 'created' });
      }
    } catch {}
  }

  /** Undo last turn's file changes */
  async undo(): Promise<void> {
    if (this.fileChanges.length === 0) {
      this.ui.warn('No file changes to undo.');
      return;
    }

    const fs = await import('fs-extra');
    const path = await import('path');

    for (const change of this.fileChanges.reverse()) {
      const fullPath = path.resolve(process.cwd(), change.path);
      if (change.action === 'created') {
        await fs.default.unlink(fullPath).catch(() => {});
        this.ui.info(`Removed: ${change.path}`);
      } else {
        await fs.default.writeFile(fullPath, change.oldContent, 'utf-8');
        this.ui.info(`Reverted: ${change.path}`);
      }
    }

    this.fileChanges = [];
    this.ui.success('Changes undone.');
  }

  /** Clear history */
  clearHistory() {
    const system = this.history[0];
    this.history = [system];
    this.ui.success('Conversation history cleared.');
    void this.options.onPersist?.();
  }

  /** Compact history — summarize old messages to save tokens */
  async compact() {
    if (this.history.length <= 3) {
      this.ui.warn('Not enough history to compact.');
      return;
    }
    await this.compactMiddle(6, false);
  }

  /** Get usage stats */
  getUsageStats() {
    return {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      historyLength: this.history.length,
    };
  }

  getUI(): UI {
    return this.ui;
  }
}
