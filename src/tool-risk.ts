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
  'codebase_analysis',
  'log_inspect',
]);

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-rf?|--recursive|.*\*)\b/i,
  /\brmdir\s+(\/s|\/q|\s+\/s)\b/i,
  /\bdel\s+(\/f|\/s|\/q|\*)\b/i,
  /\bRemove-Item\b.*\s-(Recurse|Force)\b/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+/i,
  /\bchmod\s+777\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\b.*\b--force\b/i,
  /\bgit\s+clean\b.*\b-f\b/i,
  /\bdrop\s+(database|table)\b/i,
  /\btruncate\s+table\b/i,
  /\bnpm\s+publish\b/i,
  /\b(sudo|doas)\b/i,
  /\b(systemctl|service)\s+(start|stop|restart|reload|enable|disable)\b/i,
];

const NETWORK_PATTERNS = [
  /\bcurl\b(?!.*\|\s*(ba)?sh)/i,
  /\bwget\b(?!.*\|\s*(ba)?sh)/i,
  /\bInvoke-WebRequest\b/i,
  /\bInvoke-RestMethod\b/i,
  /\biwr\b/i,
  /\birm\b/i,
  /\bnpm\s+(i|install|add)\b/i,
  /\bnpx\b/i,
  /\bpnpm\s+(i|install|add)\b/i,
  /\byarn\s+(add|install)\b/i,
  /\bbun\s+(add|install)\b/i,
  /\bpip\s+install\b/i,
  /\bpoetry\s+add\b/i,
  /\bcargo\s+install\b/i,
  /\bapt(-get)?\s+(install|update|upgrade|remove)\b/i,
  /\b(dnf|yum|pacman|zypper|apk)\s+(install|update|upgrade|remove|add)\b/i,
  /\b(winget|choco|scoop|brew)\s+(install|upgrade|uninstall|remove)\b/i,
];

const SAFE_SHELL_PATTERNS = [
  /^\s*npm(\.cmd)?\s+(run\s+)?(build|test|lint|typecheck|check)\b/i,
  /^\s*(pnpm|yarn|bun)(\.cmd)?\s+(run\s+)?(build|test|lint|typecheck|check)\b/i,
  /^\s*(node|python|python3|py|go|cargo|rustc|tsc|eslint|prettier|vitest|jest|pytest|ruff|mypy)\s+.*$/i,
  /^\s*node\s+(-v|--version)\s*$/i,
  /^\s*(npm|pnpm|yarn|bun)(\.cmd)?\s+(-v|--version|--help)\s*$/i,
  /^\s*(git\s+)?status\b/i,
  /^\s*git\s+(diff|log|branch|status|show|rev-parse|remote)\b/i,
  /^\s*(dir|ls|pwd|cd|type|cat|head|tail|more|rg|grep|findstr|where|which|tree)\b/i,
  /^\s*(Get-ChildItem|Get-Content|Select-String|Test-Path|Resolve-Path|Get-Location)\b/i,
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
    return classifyShellCommand(command);
  }

  if (WRITE_TOOLS.has(name)) {
    return { risk: name === 'delete_file' ? 'destructive' : 'project-write', destructive: name === 'delete_file', reason: 'project write tool' };
  }

  return { risk: 'external', destructive: false, reason: 'unknown or external tool surface' };
}

export function classifyShellCommand(command: string): ToolRiskResult {
  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) {
    return { risk: 'destructive', destructive: true, reason: 'destructive or privileged shell command pattern' };
  }
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(command))) {
    return { risk: 'shell-network', destructive: false, reason: 'network, package, or dependency-changing shell command' };
  }
  if (SAFE_SHELL_PATTERNS.some((pattern) => pattern.test(command))) {
    return { risk: 'shell-safe', destructive: false, reason: 'known safe diagnostic/build/test command' };
  }
  return { risk: 'shell-safe', destructive: false, reason: 'ordinary shell command' };
}

export function isDangerousShellCommand(command: string): boolean {
  return classifyShellCommand(command).destructive;
}
