/**
 * Cross-platform process-tree kill (Windows: taskkill /T for cmd → child.exe chains).
 */
import { spawnSync, type ChildProcess } from 'node:child_process';

export function killProcessTreeBestEffort(child: ChildProcess): void {
  const pid = child.pid;
  if (pid == null || !Number.isFinite(pid) || pid <= 0) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    return;
  }
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}
