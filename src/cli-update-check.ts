/**
 * Optional CLI self-update: compare local yamx to npm latest and prompt to upgrade.
 */

import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import inquirer from 'inquirer';
import chalk from 'chalk';
import axios from 'axios';

const NPM_SCOPE_PACKAGE = '@needyamin/yamx';
const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${encodeURIComponent(NPM_SCOPE_PACKAGE)}/latest`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_FILENAME = 'update-check-state.json';

export interface UpdateCheckState {
  lastRegistryCheckMs?: number;
  /** When user declines an upgrade to this version, do not prompt again for it. */
  declinedVersion?: string;
}

function statePath(): string {
  return path.join(os.homedir(), '.yamx', STATE_FILENAME);
}

export async function readUpdateCheckState(): Promise<UpdateCheckState> {
  const p = statePath();
  try {
    if (await fs.pathExists(p)) {
      const raw = await fs.readJSON(p);
      if (raw && typeof raw === 'object') return raw as UpdateCheckState;
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function writeUpdateCheckState(patch: Partial<UpdateCheckState>): Promise<void> {
  const p = statePath();
  await fs.ensureDir(path.dirname(p));
  const prev = await readUpdateCheckState();
  await fs.writeJSON(p, { ...prev, ...patch }, { spaces: 2 });
}

/** Semver-ish: compare numeric dot parts; non-numeric tails treated as 0. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => {
    const n = parseInt(/^(\d+)/.exec(x)?.[1] || '0', 10);
    return Number.isFinite(n) ? n : 0;
  });
  const pb = b.split('.').map((x) => {
    const n = parseInt(/^(\d+)/.exec(x)?.[1] || '0', 10);
    return Number.isFinite(n) ? n : 0;
  });
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await axios.get<{ version?: string }>(REGISTRY_LATEST_URL, {
      timeout: 12_000,
      validateStatus: (s) => s === 200,
      headers: { Accept: 'application/json' },
    });
    const v = res.data?.version;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function shouldSkipEnv(): boolean {
  if (process.env.YAMX_SKIP_UPDATE_CHECK === '1' || process.env.YAMX_SKIP_UPDATE_CHECK === 'true') return true;
  if (process.env.CI === 'true' || process.env.CI === '1') return true;
  return false;
}

function runGlobalNpmInstall(): void {
  const isWin = process.platform === 'win32';
  const npmBin = isWin ? 'npm.cmd' : 'npm';
  const r = spawnSync(npmBin, ['install', '-g', NPM_SCOPE_PACKAGE], {
    stdio: 'inherit',
    shell: isWin,
  });
  if (r.error) {
    console.log(chalk.red(`[x] Could not run ${npmBin}: ${r.error.message}`));
    return;
  }
  if (r.status !== 0) {
    console.log(chalk.yellow('[!] npm install exited with a non-zero status. Try: npm install -g @needyamin/yamx'));
  } else {
    console.log(chalk.green('[+] Update finished. Run `yamx` again to use the new version.'));
  }
}

/**
 * When settings.checkForUpdates is true: throttled registry check; prompt if newer than currentVersion.
 */
export async function maybePromptCliUpdate(currentVersion: string): Promise<void> {
  if (!currentVersion?.trim()) return;
  if (shouldSkipEnv()) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  const state = await readUpdateCheckState();
  const now = Date.now();
  if (state.lastRegistryCheckMs != null && now - state.lastRegistryCheckMs < CHECK_INTERVAL_MS) {
    return;
  }

  const latest = await fetchLatestVersion();
  await writeUpdateCheckState({ lastRegistryCheckMs: now });

  if (!latest || compareSemver(currentVersion, latest) >= 0) return;
  if (state.declinedVersion === latest) return;

  console.log(
    chalk.yellow(
      `\n[!] A newer YamX is available: ${chalk.bold(latest)} (you have ${chalk.dim(currentVersion)})\n`
    )
  );

  const { action } = await inquirer.prompt<{ action: 'install' | 'skip' | 'never' }>([
    {
      type: 'list',
      name: 'action',
      message: 'Update now with npm?',
      choices: [
        { name: `Yes — run: npm install -g ${NPM_SCOPE_PACKAGE}`, value: 'install' },
        { name: 'Not now (you may be asked again after the next check, ~24h)', value: 'skip' },
        { name: 'Skip this version (do not ask again until a newer release)', value: 'never' },
      ],
      default: 'install',
    },
  ]);

  if (action === 'never') {
    await writeUpdateCheckState({ declinedVersion: latest });
    return;
  }
  if (action === 'skip') {
    return;
  }

  runGlobalNpmInstall();
  process.exit(0);
}
