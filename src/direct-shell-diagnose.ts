/**
 * Heuristics for YamX `YamX ›` direct shell lines — when to run offline fix / agent recovery.
 */

/** User hit Ctrl+C (cooperative stop); not a "failed command" to diagnose. */
export function isDirectShellUserCancelled(result: string): boolean {
  return /\bstopped by user\b/i.test(result);
}

export function isDirectShellFailure(result: string): boolean {
  if (isDirectShellUserCancelled(result)) return false;
  return /\(exit\s+[1-9]\d*|timed out after|Spawn error:|Error:|not recognized as an internal or external command|command not found|No such file or directory|cannot find the path|bad option|fatal:|Traceback|TypeError|SyntaxError|ReferenceError/i.test(
    result
  );
}
