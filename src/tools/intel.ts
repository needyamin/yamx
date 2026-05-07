import { Tool } from './registry.js';
import { buildCodebaseAnalysis, buildProjectIntel } from '../project-intel.js';

export const projectIntel: Tool = {
  definition: {
    name: 'project_intel',
    description:
      'Return a compact, low-token project intelligence packet with key files, package scripts, recommended verification commands, and task-specific investigation hints. Use first for bug fixing, feature work, and unfamiliar repos.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Current user goal or problem statement' },
        max_files: { type: 'number', description: 'Maximum key files to include (default 40, max 120)' },
      },
    },
  },
  async execute(args: { goal?: string; max_files?: number }) {
    return buildProjectIntel({
      goal: args.goal,
      maxFiles: args.max_files,
    });
  },
};

export const codebaseAnalysis: Tool = {
  definition: {
    name: 'codebase_analysis',
    description:
      'Return a deterministic architecture and codebase analysis packet: entry points, language mix, directory focus, scripts, dependencies, risks, and an agentic next-step plan. Use for broad requests to understand, summarize, review, improve, or plan work in an unfamiliar codebase.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Current user goal or analysis question' },
        depth: {
          type: 'string',
          enum: ['quick', 'standard', 'deep'],
          description: 'Analysis depth. quick is small, standard is balanced, deep samples more files.',
        },
        max_files: { type: 'number', description: 'Maximum source files to sample (default depends on depth, max 180)' },
      },
    },
  },
  async execute(args: { goal?: string; depth?: 'quick' | 'standard' | 'deep'; max_files?: number }) {
    return buildCodebaseAnalysis({
      goal: args.goal,
      depth: args.depth,
      maxFiles: args.max_files,
    });
  },
};
