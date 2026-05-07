import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import { ContextEngine } from './context.js';
import { Provider, Message } from './providers/base.js';

export type BuiltinSubagent = 'explorer' | 'planner' | 'reviewer';

interface SubagentSpec {
  name: string;
  title: string;
  prompt: string;
  maxTokens: number;
  path?: string;
}

const SPECS: Record<BuiltinSubagent, SubagentSpec> = {
  explorer: {
    name: 'explorer',
    title: 'Explorer',
    maxTokens: 4096,
    prompt: [
      'You are YamX Explorer, a read-only codebase analysis subagent.',
      'Answer with concrete file paths, symbols, and likely next inspection targets.',
      'Do not propose edits unless the user explicitly asks for implementation planning.',
      'Be concise but specific.',
    ].join('\n'),
  },
  planner: {
    name: 'planner',
    title: 'Planner',
    maxTokens: 4096,
    prompt: [
      'You are YamX Planner, a read-only implementation planning subagent.',
      'Produce a practical ordered plan for the requested change.',
      'Include files to inspect/edit, verification commands, risks, and rollback notes.',
      'Do not write code. Do not claim implementation is complete.',
    ].join('\n'),
  },
  reviewer: {
    name: 'reviewer',
    title: 'Reviewer',
    maxTokens: 4096,
    prompt: [
      'You are YamX Reviewer, a strict code-review subagent.',
      'Prioritize bugs, regressions, security issues, missing tests, and risky behavior.',
      'Lead with findings ordered by severity. If no issues are found, say so clearly.',
      'Use file paths and diff evidence where possible.',
    ].join('\n'),
  },
};

export class SubagentRunner {
  constructor(private provider: Provider, private cwd = process.cwd()) {}

  async run(name: BuiltinSubagent | string, task: string): Promise<string> {
    const spec = await this.resolveSpec(name);
    if (!spec) {
      return `Unknown subagent: ${name}. Use /agents to list available subagents.`;
    }
    const projectContext = await new ContextEngine(this.cwd).buildSystemPrompt();
    const extra = name === 'reviewer' ? this.gitDiffContext() : '';
    const messages: Message[] = [
      { role: 'system', content: spec.prompt },
      {
        role: 'user',
        content: [
          `Project context:\n${projectContext.slice(0, 80_000)}`,
          extra ? `\nReview context:\n${extra}` : '',
          `\nTask:\n${task || this.defaultTask(spec.name)}`,
        ].join('\n'),
      },
    ];

    const result = await this.provider.complete({
      messages,
      maxTokens: spec.maxTokens,
      temperature: 0.1,
    });

    return result.content || `${spec.title} returned no content.`;
  }

  async describe(): Promise<string> {
    const custom = await this.loadCustomAgents();
    return [...Object.values(SPECS), ...custom]
      .map((spec) => `${spec.name}\n  ${spec.prompt.split('\n')[0]}`)
      .join('\n\n');
  }

  async loadCustomAgents(): Promise<SubagentSpec[]> {
    const roots = [
      path.join(this.cwd, '.yamx', 'agents'),
      path.join(os.homedir(), '.yamx', 'agents'),
    ];

    const agents: SubagentSpec[] = [];
    for (const root of roots) {
      const files = await fg('*.md', {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        suppressErrors: true,
      });
      for (const file of files.sort()) {
        const spec = await this.readAgent(file);
        if (spec) agents.push(spec);
      }
    }

    const byName = new Map<string, SubagentSpec>();
    for (const agent of agents) byName.set(agent.name, agent);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async resolveSpec(name: string): Promise<SubagentSpec | null> {
    if (name in SPECS) return SPECS[name as BuiltinSubagent];
    const custom = await this.loadCustomAgents();
    return custom.find((agent) => agent.name === name) || null;
  }

  private async readAgent(file: string): Promise<SubagentSpec | null> {
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const frontmatter = this.parseFrontmatter(raw);
      const body = raw.startsWith('---') ? raw.slice(raw.indexOf('\n---', 3) + 4).trim() : raw.trim();
      const name = String(frontmatter.name || path.basename(file, '.md')).trim();
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) return null;
      return {
        name,
        title: String(frontmatter.title || name),
        prompt: body || String(frontmatter.prompt || 'You are a focused YamX subagent.'),
        maxTokens: Number(frontmatter.maxTokens || frontmatter.max_tokens || 4096),
        path: file,
      };
    } catch {
      return null;
    }
  }

  private parseFrontmatter(raw: string): Record<string, string> {
    if (!raw.startsWith('---')) return {};
    const end = raw.indexOf('\n---', 3);
    if (end === -1) return {};
    const body = raw.slice(3, end).trim();
    const out: Record<string, string> = {};
    for (const line of body.split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
    return out;
  }

  private gitDiffContext(): string {
    try {
      const status = execSync('git status --short', { cwd: this.cwd, encoding: 'utf-8', timeout: 10_000 }).trim();
      const diff = execSync('git diff --stat && git diff --', { cwd: this.cwd, encoding: 'utf-8', timeout: 20_000 });
      return [`Git status:\n${status || '(clean)'}`, `Git diff:\n${diff || '(no diff)'}`].join('\n\n').slice(0, 80_000);
    } catch (error: any) {
      return `Could not read git diff: ${error.message}`;
    }
  }

  private defaultTask(name: string): string {
    switch (name) {
      case 'explorer':
        return 'Explore this project and summarize the most important architecture and entry points.';
      case 'planner':
        return 'Create an implementation plan for the current user goal.';
      case 'reviewer':
        return 'Review current uncommitted changes.';
      default:
        return 'Complete the requested subagent task.';
    }
  }
}
