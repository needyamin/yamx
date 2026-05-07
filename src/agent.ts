/**
 * YamX - Core Agent Loop
 * Production-grade ReAct agent with streaming, tool calling, approval flow,
 * markdown rendering, auto-retry, and multi-turn reasoning.
 */

import { Provider, Message, ToolCall, CompletionResult } from './providers/base.js';
import { allTools, getToolDefinitions, getTool } from './tools/registry.js';
import { ensureInsideProject } from './tools/utils.js';
import { evaluateToolCall, PermissionMode } from './policy.js';
import { HookManager } from './hooks.js';
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
  permissionMode?: PermissionMode;
  allowedShellCommands?: string[];
  deniedShellPatterns?: string[];
  hooksEnabled?: boolean;
  /** Run a hidden expert discussion before the main tool-capable response */
  modelCouncilEnabled?: boolean;
  /** Council mode: adaptive saves tokens, always maximizes planning, off disables it */
  modelCouncilMode?: 'adaptive' | 'always' | 'off';
  /** Maximum tool-result characters kept in model history */
  maxToolResultChars?: number;
}

export class Agent {
  private provider: Provider;
  private history: Message[] = [];
  private ui: UI;
  private options: AgentOptions;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private fileChanges: Array<{ path: string; oldContent: string; action: string }> = [];
  private turnStartTime = 0;
  private toolCallCounts = new Map<string, number>();
  private hooks = new HookManager();

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
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
          error.message?.includes('timeout') ||
          error.message?.includes('ECONNRESET');

        if (isRetryable && attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAYS[attempt];
          this.ui.warn(`${label} failed (${error.message}). Retrying in ${delay / 1000}s… (${attempt + 1}/${MAX_RETRIES})`);
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
      modelCouncilEnabled: true,
      modelCouncilMode: 'adaptive',
      maxToolResultChars: 24_000,
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
    this.toolCallCounts.clear();
    this.turnStartTime = Date.now();

    this.ui.neuralStatus('input', 'request received; preparing model context');
    await this.runModelCouncil(userInput);

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

    // Show turn timing
    const elapsed = ((Date.now() - this.turnStartTime) / 1000).toFixed(1);
    this.ui.info(`Turn completed in ${elapsed}s · ${iterations} iteration${iterations > 1 ? 's' : ''}`);

    await Promise.resolve(this.options.onPersist?.());
  }

  private async runModelCouncil(userInput: string): Promise<void> {
    if (this.options.modelCouncilEnabled === false || this.options.modelCouncilMode === 'off') return;
    if (this.options.modelCouncilMode !== 'always' && !this.shouldRunModelCouncil(userInput)) {
      this.ui.neuralStatus('council', 'adaptive token saver skipped council for this simple turn');
      return;
    }

    this.ui.neuralStatus('council', 'Analyst · Planner · Critic · Synthesizer discussing request');
    this.ui.startThinking('Consulting model council...');
    try {
      const recentContext = this.history
        .slice(-8)
        .map((message) => {
          const label = message.role.toUpperCase();
          const content = message.content || (message.tool_calls ? '[tool calls]' : '');
          return `${label}: ${content.slice(0, 3000)}`;
        })
        .join('\n\n');

      const result = await this.withRetry(
        () =>
          this.provider.complete({
            messages: [
              {
                role: 'system',
                content: [
                  'You are the hidden YamX model council. Discuss the user request before the main coding agent acts.',
                  'Use four concise expert perspectives:',
                  'Analyst: clarify intent and required outcome.',
                  'Planner: identify the smallest practical execution path.',
                  'Critic: identify risks, missing evidence, safety concerns, and likely failure modes.',
                  'Synthesizer: give final private guidance the main agent should follow.',
                  'Keep the whole council response under 900 tokens.',
                  'Do not ask the user questions unless the task is genuinely blocked.',
                  'Do not claim work is done. Do not include public-facing filler.',
                ].join('\n'),
              },
              {
                role: 'user',
                content: [
                  'Recent conversation and auto context:',
                  recentContext.slice(0, 30_000),
                  '',
                  'Current user request:',
                  userInput,
                ].join('\n'),
              },
            ],
            maxTokens: Math.min(1400, this.options.maxTokens || 1400),
            temperature: Math.max(0.1, Math.min(0.3, this.options.temperature ?? 0.1)),
          }),
        'Model council'
      );

      this.ui.stopSpinner();
      if (result.usage) {
        this.totalInputTokens += result.usage.inputTokens;
        this.totalOutputTokens += result.usage.outputTokens;
      }

      const notes = result.content?.trim();
      if (!notes) return;
      this.history.push({
        role: 'user',
        content: `<yamx_internal_model_council private="true">\n${notes.slice(0, 6_000)}\n</yamx_internal_model_council>\n\nUse these private notes to answer the original user request exactly. Do not mention the council unless the user asks how you reasoned.`,
      });
    } catch (error: any) {
      this.ui.stopSpinner();
      this.ui.warn(`Model council skipped: ${error.message}`);
    }
  }

  private shouldRunModelCouncil(userInput: string): boolean {
    const text = userInput.toLowerCase();
    if (text.length > 500) return true;
    return /\b(fix|bug|error|broken|fail|crash|implement|add|create|refactor|review|analy[sz]e|architecture|security|performance|optimi[sz]e|test|build|deploy|database|migration|agent|powerful|advanced|pro|logs?)\b/.test(text);
  }

  /** Non-streaming completion */
  private async completeResponse(): Promise<CompletionResult> {
    this.ui.neuralStatus('model', 'sending context and tools to provider');
    this.ui.startThinking('Waiting for model response...');

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
        // Render markdown
        const rendered = this.ui.renderMarkdown(result.content);
        console.log('\n' + rendered);
      }

      return result;
    } catch (error: any) {
      this.ui.stopSpinner();
      this.ui.error(`Provider error: ${error.message}`);
      return { content: null };
    }
  }

  /** Streaming completion with accumulated markdown rendering */
  private async streamResponse(): Promise<CompletionResult> {
    this.ui.neuralStatus('model', 'streaming provider response');
    this.ui.startThinking('Waiting for model stream...');

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
          content: `Error: Unknown tool "${tc.function.name}". Available tools: ${Object.keys(allTools).join(', ')}`,
        });
        continue;
      }

      let args: any;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        this.ui.warn(`Malformed tool arguments for ${tc.function.name}, attempting repair…`);
        try {
          // Try to fix common JSON issues: trailing commas, single quotes
          const fixed = (tc.function.arguments || '{}')
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .replace(/'/g, '"');
          args = JSON.parse(fixed);
        } catch {
          args = {};
        }
      }

      // Check if approval is needed
      const toolKey = this.toolCallKey(tc.function.name, args);
      const toolCount = (this.toolCallCounts.get(toolKey) || 0) + 1;
      this.toolCallCounts.set(toolKey, toolCount);
      const repeatLimit = this.repeatLimit(tc.function.name);
      if (toolCount > repeatLimit) {
        const msg = `Skipped repeated ${tc.function.name} call with identical arguments. Choose a different diagnostic or implementation strategy.`;
        if (this.isUserVisibleRepeatWarning(tc.function.name)) {
          this.ui.warn(msg);
        } else {
          this.ui.neuralStatus('guard', `avoided duplicate ${tc.function.name}; trying a different path`);
        }
        this.history.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: msg,
        });
        continue;
      }

      const policy = evaluateToolCall(tc.function.name, args, {
        permissionMode: this.options.permissionMode,
        autoApprove: this.options.autoApprove,
        allowedShellCommands: this.options.allowedShellCommands,
        deniedShellPatterns: this.options.deniedShellPatterns,
      });
      if (policy.blocked) {
        const msg = `Policy blocked ${tc.function.name}: ${policy.reason}`;
        this.ui.warn(msg);
        this.history.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: msg,
        });
        continue;
      }

      if (this.options.hooksEnabled !== false) {
        const hook = await this.hooks.run('PreToolUse', {
          tool_name: tc.function.name,
          tool_args: args,
        }, tc.function.name);
        if (hook.blocked) {
          const msg = `PreToolUse hook blocked ${tc.function.name}: ${hook.errors.join('\n') || hook.output}`;
          this.ui.warn(msg);
          this.history.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: msg,
          });
          continue;
        }
      }

      // Check if approval is needed
      if (tool.needsApproval && policy.needsApproval) {
        const isDangerous = policy.risk === 'destructive' || (tool.isDangerous?.(args) ?? false);

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
      this.ui.neuralStatus('action', `executing ${tc.function.name}`);
      this.ui.toolCall(tc.function.name, args);
      const startTime = Date.now();

      try {
        // Track file changes for undo
        if (['write_file', 'edit_file', 'delete_file', 'multi_edit', 'patch_file', 'move_file'].includes(tc.function.name) && (args.path || args.source)) {
          await this.trackFileChange(args.path || args.source);
        }

        const result = await tool.execute(args);
        const duration = Date.now() - startTime;
        this.ui.toolResult(tc.function.name, result, duration);

        if (this.options.hooksEnabled !== false) {
          const hook = await this.hooks.run('PostToolUse', {
            tool_name: tc.function.name,
            tool_args: args,
            result,
            duration_ms: duration,
          }, tc.function.name);
          if (hook.errors.length > 0) {
            this.ui.warn(`PostToolUse hook feedback: ${hook.errors.join('\n')}`);
          }
        }

        this.history.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: this.prepareToolResultForHistory(tc.function.name, result),
        });
      } catch (error: any) {
        const duration = Date.now() - startTime;
        const errorMsg = `Error executing ${tc.function.name}: ${error.message}`;
        this.ui.error(`${errorMsg} (${duration}ms)`);

        if (this.options.hooksEnabled !== false) {
          const hook = await this.hooks.run('PostToolUseFailure', {
            tool_name: tc.function.name,
            tool_args: args,
            error: error.message,
            duration_ms: duration,
          }, tc.function.name);
          if (hook.errors.length > 0 || hook.output) {
            this.ui.warn(`PostToolUseFailure hook feedback: ${hook.errors.join('\n') || hook.output}`);
          }
        }

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

  private toolCallKey(name: string, args: unknown): string {
    return `${name}:${this.stableStringify(args)}`;
  }

  private repeatLimit(name: string): number {
    const readOnlyRepeatable = new Set([
      'read_file',
      'list_files',
      'search_files',
      'grep_search',
      'file_info',
      'directory_tree',
      'git_status',
      'git_diff',
      'git_log',
      'task_list',
      'task_tail',
    ]);
    return readOnlyRepeatable.has(name) ? 2 : 1;
  }

  private isUserVisibleRepeatWarning(name: string): boolean {
    return !new Set([
      'run_command',
      'read_file',
      'search_files',
      'grep_search',
      'log_inspect',
      'task_tail',
      'git_status',
      'git_diff',
    ]).has(name);
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => this.stableStringify(v)).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${this.stableStringify(obj[k])}`).join(',')}}`;
  }

  private compactToolResultForHistory(toolName: string, result: string): string {
    const maxChars = this.options.maxToolResultChars ?? 24_000;
    if (result.length <= maxChars) return result;

    const lines = result.split(/\r?\n/);
    const signalLines = lines.filter((line) => /(error|exception|fatal|failed|failure|warning|warn|traceback|stack|timeout|enoent|eacces|eperm|typeerror|syntaxerror|referenceerror)/i.test(line));
    const head = lines.slice(0, 80).join('\n');
    const tail = lines.slice(-160).join('\n');
    const signals = signalLines.slice(-80).join('\n');

    return [
      `[Tool result compacted for token economy: ${toolName}]`,
      `Original size: ${result.length.toLocaleString()} chars, ${lines.length.toLocaleString()} lines.`,
      signals ? '\nImportant error/warning lines:\n' + signals : '',
      '\nHead:\n' + head,
      '\nTail:\n' + tail,
      '\nUse narrower tool arguments (line ranges, max_results, log_inspect mode=latest-error/summary) if more detail is needed.',
    ].filter(Boolean).join('\n').slice(0, maxChars);
  }

  private prepareToolResultForHistory(toolName: string, result: string): string {
    const base = this.compactToolResultForHistory(toolName, result);
    if (!this.isFailureResult(toolName, result)) return base;

    return [
      base,
      '',
      '<yamx_failure_protocol>',
      'The previous command/tool result indicates a failure. Do not guess a fix from one line only.',
      'Next steps:',
      '1. Identify the exact error message, file path, stack frame, port, missing command, or failing assertion.',
      '2. If a background task or log file may exist, use task_tail or log_inspect mode=auto/latest-error/summary.',
      '3. Search the codebase for the exact symbol/error/config referenced by the logs.',
      '4. Apply the smallest fix, then rerun the narrow failing command.',
      '</yamx_failure_protocol>',
    ].join('\n');
  }

  private isFailureResult(toolName: string, result: string): boolean {
    if (!['run_command', 'run_command_background', 'task_tail', 'log_inspect'].includes(toolName)) return false;
    return /\(exit\s+[1-9]\d*|timed out|error|exception|fatal|failed|failure|traceback|uncaught|unhandled|typeerror|syntaxerror|referenceerror|eaddrinuse|econnrefused|enoent|eacces|eperm/i.test(result);
  }

  /** Track file changes for undo */
  private async trackFileChange(filePath: string) {
    const fs = await import('fs-extra');
    const target = ensureInsideProject(filePath);
    if (!target.ok) return;
    const fullPath = target.path;
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

    for (const change of this.fileChanges.reverse()) {
      const target = ensureInsideProject(change.path);
      if (!target.ok) continue;
      const fullPath = target.path;
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
      historyChars: this.estimateHistoryChars(),
    };
  }

  getUI(): UI {
    return this.ui;
  }
}
