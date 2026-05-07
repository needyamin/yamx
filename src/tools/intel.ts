import { Tool } from './registry.js';
import { buildProjectIntel } from '../project-intel.js';

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
