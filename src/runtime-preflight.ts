/**
 * Read-only shell probes fired before certain runtime/install-style user turns.
 * Grounds the model in local facts so it cannot substitute generic multi-OS tutorials.
 */

import { isPseudoEnglishShellIntent } from './tools/shell.js';
import { getSmartShell, PROJECT_ROOT, runProcess } from './tools/utils.js';

type RuntimeTopic = 'python' | 'node' | 'docker' | 'git' | 'rust' | 'java' | 'go' | 'kubectl';

const SKIP_TUTORIAL = /\b(tutorial|essay|explain\s+(everything|step|how)|documentation\s+for\s+every|all\s+platforms)\b|^explain\b/i;

const ACTIONISH = /\b(install|uninstall|reinstall|setup|set\s*up|configure|upgrade\b|missing|don'?t have|do i have|which\b|where is|need\b|have to\b|want to\b|PATH|path\b|environment variable|broken|won'?t run|won'?t work|detect|probe|verify|check\b|debug|fix\b|venv|conda\b|pypi|npm i\b|pnpm|cargo\b|rustc\b|javac\b|jdk|sdkman)\b/i;

const PER_CMD_TIMEOUT_MS = 18_000;
const PER_CMD_MAX_CHARS = 3_600;
/** Total budget for injected preflight transcript */
const TOTAL_MAX_CHARS = 9_500;

/** Line-only user messages rarely need preflight markdown detection. */
const CODEISH = /[\r\n]`{3,}|^\s*#{1,3}\s/m;

function inferRuntimeTopic(text: string): RuntimeTopic | null {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (!t.length || t.length > 2_800) return null;
  if (SKIP_TUTORIAL.test(t) || CODEISH.test(t)) return null;

  const topic: RuntimeTopic | null = /\b(python3?|pypi|ipython|jupyter|anaconda|venv|virtualenv)\b|\bpipx?\b|\bpip3\b|\B\.venv\b/.test(
    lower
  )
    ? 'python'
    : /\b(node(\.js)?|npm\b|npx\b|pnpm\b|yarn\b|bun\b|package\.json|node_modules)\b/.test(lower)
      ? 'node'
      : /\bdocker\b|dockerfile|\bcompose\.ya?ml\b|podman\b|containerd?\b/.test(lower)
        ? 'docker'
        : /\bgit\b|gitlab\b|gitlab-ci|stash\b|pull request|\bcommits?\b|\bcheckout\b|\brebase\b|\bbranch\b/.test(lower)
          ? 'git'
          : /\brust\b|rustup|\brustc\b|\bcargo\b/.test(lower)
            ? 'rust'
            : /\bjava\b|openjdk\b|\bjdk\b|\bjre\b|\bjavac\b|\bmvnw?\b|\bgradle\b|\bgradle\.kts\b/.test(lower)
              ? 'java'
              : /\bgolang\b|go\s+(install|mod|version|env)|\bGOROOT\b|\bGOPATH\b/.test(lower)
                ? 'go'
                : /\bkubectl\b|kubernetes|\bk8s\b|\bhelm\b/.test(lower)
                  ? 'kubectl'
                  : null;

  if (!topic) return null;
  if (ACTIONISH.test(lower) || isPseudoEnglishShellIntent(lower)) return topic;

  /** Version / presence checks (“which python”) without verbs still warrant probes. */
  if (/\bwhich\b|\bcommand -v\b|where\b|version\b|have\b.+\binstalled\b|installed\b.+\?\s*$/i.test(lower)) return topic;

  return null;
}

function osFingerprintCommands(): string[] {
  if (process.platform === 'win32') {
    return ['ver', 'echo %PROCESSOR_ARCHITECTURE%'];
  }
  return ['uname -sr', 'uname -m'];
}

/** Distinct probes for one topic (+ OS snapshot). Deduped deterministically. */
function probeCommandsFor(topic: RuntimeTopic): string[] {
  const base = osFingerprintCommands();
  const plat = process.platform;

  let extra: string[] = [];
  if (topic === 'python') {
    if (plat === 'win32') {
      extra = [
        'where python',
        'where python3',
        'where py',
        'py -0',
        'python --version',
        'python3 --version',
        'pip --version',
        'pip3 --version',
        'where winget',
        'winget --version',
      ];
    } else {
      extra = [
        'command -v python3 || true',
        'python3 --version',
        'command -v python || true',
        'python --version',
        'command -v pip3 || true',
        'pip3 --version',
        'command -v pip || true',
        'pip --version',
      ];
    }
  } else if (topic === 'node') {
    if (plat === 'win32') {
      extra = ['where node', 'where npm', 'where pnpm', 'where yarn', 'node -v', 'npm -v'];
    } else {
      extra = ['command -v node || true', 'node -v', 'command -v npm || true', 'npm -v'];
    }
  } else if (topic === 'docker') {
    extra = plat === 'win32' ? ['where docker', 'docker version'] : ['command -v docker || true', 'docker version'];
  } else if (topic === 'git') {
    extra = plat === 'win32' ? ['where git', 'git --version'] : ['command -v git || true', 'git --version'];
  } else if (topic === 'rust') {
    extra =
      plat === 'win32'
        ? ['where rustc', 'where cargo', 'rustc --version', 'cargo --version']
        : ['command -v rustc || true', 'rustc --version', 'cargo --version'];
  } else if (topic === 'java') {
    extra =
      plat === 'win32'
        ? ['where java', 'where javac', 'java --version', 'javac --version']
        : ['command -v java || true', 'java --version', 'javac --version'];
  } else if (topic === 'go') {
    extra = plat === 'win32' ? ['where go', 'go version'] : ['command -v go || true', 'go version'];
  } else if (topic === 'kubectl') {
    extra =
      plat === 'win32' ? ['where kubectl', 'kubectl version --client'] : ['command -v kubectl || true', 'kubectl version --client'];
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  const pushCmd = (c: string) => {
    const k = c.trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    ordered.push(k);
  };
  base.forEach(pushCmd);
  extra.forEach(pushCmd);
  return ordered;
}

async function runOneShellLine(shellLine: string): Promise<{ line: string; text: string; code: number | null }> {
  const smart = getSmartShell(shellLine, 'auto');
  try {
    const r = await runProcess(smart.shell.command, [...smart.shell.args, smart.command], {
      cwd: PROJECT_ROOT,
      timeoutMs: PER_CMD_TIMEOUT_MS,
      maxChars: PER_CMD_MAX_CHARS,
    });
    const tail = r.timedOut ? '\n(preflight probe timed out)' : '';
    return { line: smart.command, text: `${r.text}${tail}`, code: r.code };
  } catch (e: any) {
    return { line: shellLine, text: `(preflight error: ${e?.message ?? e})`, code: 1 };
  }
}

/** Returns an extra user-role message blob, or null when no probes ran. */
export async function maybeRuntimePreflightMessage(userInput: string): Promise<string | null> {
  const topic = inferRuntimeTopic(userInput);
  if (!topic) return null;

  const commands = probeCommandsFor(topic);
  /** Parallel is fine — separate processes, read-only probes. */
  const runs = await Promise.all(commands.map((c) => runOneShellLine(c)));

  const lines: string[] = [
    '<yamx_local_preflight>',
    `topic=${topic} platform=${process.platform} arch=${process.arch}`,
    'Read-only probes run by YamX on this machine before the model replies.',
    'Use these outputs as PRIMARY evidence about what is installed and where.',
    'Do NOT answer with generic multi-OS install guides; propose executable next steps for THIS OS only, using tools as needed.',
    '',
  ];

  let used = lines.join('\n').length + 128;
  for (const row of runs) {
    let block =
      `\n### run: ${row.line}\n` + `exit ${row.code ?? '?'}\n` + row.text.trimEnd();

    const room = TOTAL_MAX_CHARS - used;
    if (room <= 80) {
      lines.push('\n...(preflight truncated: raise limits in runtime-preflight if needed)');
      break;
    }
    if (block.length > room) {
      block = block.slice(0, room - 48) + '\n...(truncated)\n';
    }
    lines.push(block);
    used += block.length;
  }

  lines.push('', '</yamx_local_preflight>');
  return lines.join('\n').trimEnd();
}
