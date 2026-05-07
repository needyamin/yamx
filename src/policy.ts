import { classifyToolCall, ToolRisk } from './tool-risk.js';

export type PermissionMode = 'default' | 'ask' | 'read-only' | 'auto-safe';

export interface PolicyOptions {
  permissionMode?: PermissionMode;
  autoApprove?: boolean;
  allowedShellCommands?: string[];
  deniedShellPatterns?: string[];
}

export interface PolicyDecision {
  risk: ToolRisk;
  needsApproval: boolean;
  blocked: boolean;
  reason: string;
}

const BLOCKED_SENSITIVE_SHELL = [
  /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b.*(\.env|id_rsa|\.pem|token|secret|password)/i,
  /\b(cat|type|Get-Content)\s+.*(id_rsa|\.pem)\b/i,
];

export function evaluateToolCall(name: string, args: any, options: PolicyOptions = {}): PolicyDecision {
  const mode = options.permissionMode || 'default';
  const classified = classifyToolCall(name, args);

  if (mode === 'read-only' && classified.risk !== 'read-only') {
    return {
      risk: classified.risk,
      needsApproval: false,
      blocked: true,
      reason: `Blocked by read-only permission mode (${classified.reason}).`,
    };
  }

  if (name === 'run_command' || name === 'run_command_background') {
    const command = String(args?.command || '');
    if (classified.risk === 'sensitive' && BLOCKED_SENSITIVE_SHELL.some((pattern) => pattern.test(command))) {
      return {
        risk: classified.risk,
        needsApproval: false,
        blocked: true,
        reason: 'Blocked sensitive credential exfiltration/read pattern.',
      };
    }

    for (const pattern of options.deniedShellPatterns || []) {
      try {
        if (new RegExp(pattern, 'i').test(command)) {
          return {
            risk: classified.risk,
            needsApproval: false,
            blocked: true,
            reason: `Blocked by deniedShellPatterns: ${pattern}`,
          };
        }
      } catch {
        // Ignore invalid user-configured patterns instead of breaking the agent loop.
      }
    }

    if ((options.allowedShellCommands || []).length > 0) {
      const allowed = options.allowedShellCommands!.some((prefix) => command.trim().startsWith(prefix));
      if (!allowed) {
        return {
          risk: classified.risk,
          needsApproval: true,
          blocked: false,
          reason: 'Shell command is not in allowedShellCommands.',
        };
      }
    }
  }

  if (classified.destructive) {
    return {
      risk: classified.risk,
      needsApproval: true,
      blocked: false,
      reason: classified.reason,
    };
  }

  if (classified.risk === 'sensitive') {
    return {
      risk: classified.risk,
      needsApproval: true,
      blocked: false,
      reason: classified.reason,
    };
  }

  if (mode === 'ask') {
    return { risk: classified.risk, needsApproval: classified.risk !== 'read-only', blocked: false, reason: classified.reason };
  }

  if (mode === 'auto-safe' && ['read-only', 'shell-safe'].includes(classified.risk)) {
    return { risk: classified.risk, needsApproval: false, blocked: false, reason: classified.reason };
  }

  if (classified.risk === 'shell-safe') {
    return {
      risk: classified.risk,
      needsApproval: false,
      blocked: false,
      reason: classified.reason,
    };
  }

  return {
    risk: classified.risk,
    needsApproval: !options.autoApprove && classified.risk !== 'read-only',
    blocked: false,
    reason: classified.reason,
  };
}
