export type ToolRisk = 'read-only' | 'project-write' | 'shell-safe' | 'shell-network' | 'destructive' | 'external';

const WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'multi_edit',
  'patch_file',
  'delete_file',
  'copy_file',
  'move_file',
  'git_commit',
  'git_branch',
  'git_stash',
  'run_command_background',
  'task_stop',
]);

const READ_TOOLS = new Set([
  'read_file',
  'list_files',
  'search_files',
  'grep_search',
  'file_info',
  'directory_tree',
  'git_status',
  'git_diff',
  'git_log',
  'fetch_url',
  'shell_diagnostics',
  'task_list',
  'task_tail',
  'project_intel',
]);

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\b/i,
  /\brmdir\s+(\/s|\/q|\s+\/s)\b/i,
  /\bdel\s+(\/f|\/s|\/q)\b/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+/i,
  /\bchmod\s+777\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\b.*\b--force\b/i,
  /\bdrop\s+(database|table)\b/i,
  /\btruncate\s+table\b/i,
  /\bnpm\s+publish\b/i,
];

const NETWORK_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnpm\s+(i|install|add)\b/i,
  /\bpnpm\s+(i|install|add)\b/i,
  /\byarn\s+(add|install)\b/i,
  /\bbun\s+(add|install)\b/i,
  /\bpip\s+install\b/i,
  /\bpoetry\s+add\b/i,
  /\bcargo\s+install\b/i,
];

const SAFE_SHELL_PATTERNS = [
  /^\s*npm(\.cmd)?\s+run\s+(build|test|lint|typecheck|check)\b/i,
  /^\s*(pnpm|yarn|bun)\s+(build|test|lint|typecheck|check)\b/i,
  /^\s*node\s+(-v|--version)\s*$/i,
  /^\s*(git\s+)?status\b/i,
  /^\s*git\s+(diff|log|branch|status)\b/i,
  /^\s*(dir|ls|pwd|cd)\b/i,
];

export interface ToolRiskResult {
  risk: ToolRisk;
  destructive: boolean;
  reason: string;
}

export function classifyToolCall(name: string, args: any): ToolRiskResult {
  if (READ_TOOLS.has(name)) {
    return { risk: 'read-only', destructive: false, reason: 'read-only tool' };
  }

  if (name === 'run_command') {
    const command = String(args?.command || '');
    if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) {
      return { risk: 'destructive', destructive: true, reason: 'destructive shell command pattern' };
    }
    if (NETWORK_PATTERNS.some((pattern) => pattern.test(command))) {
      return { risk: 'shell-network', destructive: false, reason: 'network or dependency-changing shell command' };
    }
    if (SAFE_SHELL_PATTERNS.some((pattern) => pattern.test(command))) {
      return { risk: 'shell-safe', destructive: false, reason: 'known safe diagnostic/build command' };
    }
    return { risk: 'shell-safe', destructive: false, reason: 'shell command' };
  }

  if (WRITE_TOOLS.has(name)) {
    return { risk: name === 'delete_file' ? 'destructive' : 'project-write', destructive: name === 'delete_file', reason: 'project write tool' };
  }

  return { risk: 'external', destructive: false, reason: 'unknown or external tool surface' };
}
