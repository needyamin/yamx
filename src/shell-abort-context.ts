/**
 * Cooperative cancel + REPL Ctrl+C: `runProcess` can register the live shell child so
 * the first SIGINT kills the process tree immediately (not only on poll interval).
 */
import type { ChildProcess } from 'node:child_process';
import { killProcessTreeBestEffort } from './process-tree-kill.js';

let abortCheck: (() => boolean) | null = null;
/** Single shell child for the current `run_command` (REPL/agent runs tools sequentially). */
let activeShellChild: ChildProcess | null = null;

export function setRunCommandAbortCheck(fn: (() => boolean) | null): void {
  abortCheck = fn;
}

export function getRunCommandAbortCheck(): (() => boolean) | null {
  return abortCheck;
}

export function registerShellChildForInterrupt(child: ChildProcess): void {
  activeShellChild = child;
}

export function unregisterShellChildIfMatches(child: ChildProcess): void {
  if (activeShellChild === child) activeShellChild = null;
}

/** Drop any stale ref (e.g. work ended abnormally). */
export function clearShellInterruptState(): void {
  activeShellChild = null;
}

/**
 * Kill the registered shell + subprocess tree synchronously (Windows: taskkill /T).
 * Returns true if a process was registered.
 */
export function interruptShellChildForUser(): boolean {
  const ch = activeShellChild;
  if (!ch) return false;
  killProcessTreeBestEffort(ch);
  return true;
}
