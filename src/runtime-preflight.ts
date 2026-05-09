/**
 * Read-only shell probes fired before certain runtime/install-style user turns.
 * Grounds the model in local facts so it cannot substitute generic multi-OS tutorials.
 */

import { isPseudoEnglishShellIntent } from './tools/shell.js';
import { getLocalFirstPathEntries, getSmartShell, getWorkspaceCwd, PROJECT_ROOT, runProcess } from './tools/utils.js';
import { formatCommandMemoryForPrompt } from './command-memory.js';
import { classifyUserIntent } from './intent.js';
import fs from 'node:fs/promises';
import path from 'node:path';

type RuntimeTopic =
  | 'python'
  | 'node'
  | 'docker'
  | 'git'
  | 'rust'
  | 'java'
  | 'go'
  | 'kubectl'
  | 'terraform'
  | 'ansible'
  | 'cloud'
  | 'network'
  | 'security';

const SKIP_TUTORIAL = /\b(tutorial|essay|explain\s+(everything|step|how)|documentation\s+for\s+every|all\s+platforms)\b|^explain\b/i;

const ACTIONISH = /\b(install|uninstall|reinstall|setup|set\s*up|configure|upgrade\b|missing|don'?t have|do i have|which\b|where is|need\b|have to\b|want to\b|PATH|path\b|environment variable|broken|won'?t run|won'?t work|detect|probe|verify|check\b|debug|fix\b|deploy|release|rollback|logs?|status|doctor|diagnose|trace|resolve|dns|latency|packet|port|socket|route|audit|scan|secrets?|vulnerab|cve|cwe|sast|dast|sbom|threat|hardening|forensic|incident|venv|conda\b|pypi|npm i\b|pnpm|cargo\b|rustc\b|javac\b|jdk|sdkman)\b/i;

const PER_CMD_TIMEOUT_MS = 18_000;
const PER_CMD_MAX_CHARS = 3_600;
/** Total budget for injected preflight transcript */
const TOTAL_MAX_CHARS = 9_500;
const OPS_TOTAL_MAX_CHARS = 11_500;

/** Line-only user messages rarely need preflight markdown detection. */
const CODEISH = /[\r\n]`{3,}|^\s*#{1,3}\s/m;

function preflightIntentText(text: string): string {
  const marker = /\nUser request:\s*\n([\s\S]+)$/i.exec(text);
  return (marker?.[1] || text).trim();
}

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
                  : /\b(terraform|tfvars|tofu|opentofu)\b/.test(lower)
                    ? 'terraform'
                    : /\b(ansible|ansible-playbook|playbook\.ya?ml|inventory)\b/.test(lower)
                      ? 'ansible'
                      : /\b(aws|gcloud|azure|az\s+|cloudflare|wrangler|vercel|netlify|flyctl|pulumi)\b/.test(lower)
                        ? 'cloud'
                        : /\b(network|internet|wifi|ethernet|dns|dhcp|gateway|route|routing|latency|packet|port|socket|firewall|proxy|vpn|tcp|udp|http|tls|ssl|ping|traceroute|tracert|nslookup|dig|netstat|ss|ipconfig|ifconfig|netsh|nmap|tcpdump|tshark)\b/.test(lower)
                          ? 'network'
                          : /\b(cyber|cybersecurity|security|infosec|ethical\s+hacking|pentest|penetration|vulnerab|cves?|cwe|exploit|hardening|threat|forensic|incident|malware|secrets?|credential|token|sast|dast|sbom|gitleaks|trivy|semgrep|bandit|pip-audit|cargo-audit|govulncheck|osv|snyk|checkov|tfsec|hadolint|kube-linter|kubescape)\b/.test(lower)
                            ? 'security'
                            : null;

  if (!topic) return null;
  if (ACTIONISH.test(lower) || isPseudoEnglishShellIntent(lower)) return topic;

  /** Version / presence checks (“which python”) without verbs still warrant probes. */
  if (/\bwhich\b|\bcommand -v\b|where\b|version\b|have\b.+\binstalled\b|installed\b.+\?\s*$/i.test(lower)) return topic;

  return null;
}

function inferProjectOpsPreflight(text: string): boolean {
  const t = text.trim();
  if (!t.length || t.length > 2_800) return false;
  if (SKIP_TUTORIAL.test(t) || CODEISH.test(t)) return false;

  const lower = t.toLowerCase();
  const action =
    /\b(install|setup|set\s*up|bootstrap|init|diagnose|doctor|debug|fix|repair|run|start|serve|build|test|lint|check|verify|deploy|release|rollback|logs?|status)\b/.test(
      lower
    );
  if (!action) return false;

  const localTarget =
    /\b(it|this|that|here|repo|project|app|agent|tool|workspace|codebase|package|deps?|dependencies|scripts?|locally)\b/.test(
      lower
    );
  const vagueAction = /^(install|setup|set\s*up|diagnose|doctor|fix|run|start|build|test|check|verify)\s+(it|this|that|here|repo|project|app|agent|tool)\b/.test(
    lower
  );
  const packageAction = /\b(npm|pnpm|yarn|bun|pip|poetry|composer|cargo|go|make|docker|compose|kubectl|helm|terraform|tofu|ansible|aws|gcloud|az|wrangler|vercel|netlify|flyctl|ping|tracert|traceroute|nslookup|dig|netstat|ss|ipconfig|ifconfig|netsh|nmap|tcpdump|tshark|gitleaks|trivy|semgrep|bandit|pip-audit|cargo-audit|govulncheck|osv-scanner|snyk|checkov|tfsec|hadolint|kube-linter|kubescape)\b/.test(lower);

  return localTarget || vagueAction || packageAction;
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
    extra = plat === 'win32' ? ['where docker', 'docker --version', 'docker compose version'] : ['command -v docker || true', 'docker --version', 'docker compose version'];
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
  } else if (topic === 'terraform') {
    extra =
      plat === 'win32'
        ? ['where terraform', 'where tofu', 'terraform version', 'tofu version']
        : ['command -v terraform || true', 'terraform version', 'command -v tofu || true', 'tofu version'];
  } else if (topic === 'ansible') {
    extra =
      plat === 'win32'
        ? ['where ansible', 'where ansible-playbook', 'ansible --version', 'ansible-playbook --version']
        : ['command -v ansible || true', 'ansible --version', 'command -v ansible-playbook || true', 'ansible-playbook --version'];
  } else if (topic === 'cloud') {
    extra =
      plat === 'win32'
        ? ['where aws', 'where gcloud', 'where az', 'where gh', 'where wrangler', 'aws --version', 'gcloud --version', 'az version']
        : ['command -v aws || true', 'aws --version', 'command -v gcloud || true', 'gcloud --version', 'command -v az || true', 'az version', 'command -v gh || true'];
  } else if (topic === 'network') {
    extra =
      plat === 'win32'
        ? ['ipconfig /all', 'route print', 'nslookup localhost', 'netstat -ano', 'where ping', 'where tracert', 'where curl']
        : ['ip addr || ifconfig', 'ip route || netstat -rn', 'cat /etc/resolv.conf', 'nslookup localhost || true', 'ss -tulpen || netstat -tulpen || true', 'command -v ping || true', 'command -v traceroute || true', 'command -v curl || true'];
  } else if (topic === 'security') {
    extra =
      plat === 'win32'
        ? ['where git', 'where gitleaks', 'where trivy', 'where semgrep', 'where bandit', 'where pip-audit', 'where npm', 'npm audit --version']
        : ['command -v git || true', 'command -v gitleaks || true', 'command -v trivy || true', 'command -v semgrep || true', 'command -v bandit || true', 'command -v pip-audit || true', 'command -v npm || true', 'npm audit --version'];
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

async function runOneShellLine(shellLine: string, cwd = PROJECT_ROOT): Promise<{ line: string; text: string; code: number | null }> {
  const smart = getSmartShell(shellLine, 'auto');
  try {
    const r = await runProcess(smart.shell.command, [...smart.shell.args, smart.command], {
      cwd,
      timeoutMs: PER_CMD_TIMEOUT_MS,
      maxChars: PER_CMD_MAX_CHARS,
    });
    const tail = r.timedOut ? '\n(preflight probe timed out)' : '';
    return { line: smart.command, text: `${r.text}${tail}`, code: r.code };
  } catch (e: any) {
    return { line: shellLine, text: `(preflight error: ${e?.message ?? e})`, code: 1 };
  }
}

async function pathExists(rel: string, cwd = PROJECT_ROOT): Promise<boolean> {
  return fs.access(path.join(cwd, rel)).then(() => true).catch(() => false);
}

async function detectPackageManager(cwd = PROJECT_ROOT): Promise<string> {
  if (await pathExists('pnpm-lock.yaml', cwd)) return 'pnpm';
  if (await pathExists('yarn.lock', cwd)) return 'yarn';
  if (await pathExists('bun.lockb', cwd)) return 'bun';
  if (await pathExists('package-lock.json', cwd)) return 'npm';
  if (await pathExists('package.json', cwd)) return 'npm';
  if (await pathExists('poetry.lock', cwd)) return 'poetry';
  if (await pathExists('pyproject.toml', cwd)) return 'python';
  if (await pathExists('requirements.txt', cwd)) return 'pip';
  if (await pathExists('composer.lock', cwd) || await pathExists('composer.json', cwd)) return 'composer';
  if (await pathExists('Cargo.lock', cwd) || await pathExists('Cargo.toml', cwd)) return 'cargo';
  if (await pathExists('go.mod', cwd)) return 'go';
  if (await pathExists('Makefile', cwd)) return 'make';
  return 'unknown';
}

async function readPackageJson(cwd = PROJECT_ROOT): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function nearbyFiles(cwd = PROJECT_ROOT): Promise<string[]> {
  const names = [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'pyproject.toml',
    'requirements.txt',
    'poetry.lock',
    'Cargo.toml',
    'go.mod',
    'composer.json',
    'Makefile',
    'Dockerfile',
    '.dockerignore',
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
    'kubernetes.yaml',
    'k8s.yaml',
    'helmfile.yaml',
    'Chart.yaml',
    'values.yaml',
    'terraform.tf',
    'main.tf',
    'variables.tf',
    'outputs.tf',
    'terraform.tfvars',
    'ansible.cfg',
    'playbook.yml',
    'playbook.yaml',
    '.github/workflows',
    '.gitlab-ci.yml',
    'Jenkinsfile',
    'Procfile',
    'vercel.json',
    'netlify.toml',
    'wrangler.toml',
    'fly.toml',
    'nginx.conf',
    'Caddyfile',
    'haproxy.cfg',
    'traefik.yml',
    'traefik.yaml',
    'hosts',
    '.gitleaks.toml',
    '.semgrep.yml',
    '.semgrep.yaml',
    '.trivyignore',
    '.snyk',
    'osv-scanner.toml',
    'bandit.yml',
    'bandit.yaml',
    'SECURITY.md',
    '.env',
    'config/.env.example',
    '.env.example',
    'README.md',
  ];
  const found: string[] = [];
  for (const name of names) {
    if (await pathExists(name, cwd)) found.push(name);
  }
  return found;
}

function commandCandidates(manager: string, scripts: Record<string, string>, userInput: string): string[] {
  const lower = userInput.toLowerCase();
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = manager === 'npm' ? `${npmBin} run` : manager === 'pnpm' ? 'pnpm run' : manager === 'yarn' ? 'yarn' : manager === 'bun' ? 'bun run' : 'npm run';
  const install =
    manager === 'pnpm'
      ? 'pnpm install'
      : manager === 'yarn'
        ? 'yarn install'
        : manager === 'bun'
          ? 'bun install'
          : manager === 'poetry'
            ? 'poetry install'
            : manager === 'pip'
              ? 'pip install -r requirements.txt'
              : manager === 'composer'
                ? 'composer install'
                : manager === 'cargo'
                  ? 'cargo fetch'
                  : manager === 'go'
                    ? 'go mod download'
                    : manager === 'make'
                      ? 'make'
                      : `${npmBin} install`;

  const candidates: string[] = [];
  if (/\b(install|setup|bootstrap|deps?|dependencies)\b/.test(lower)) candidates.push(install);
  for (const name of ['doctor', 'diagnose', 'check', 'typecheck', 'lint', 'test', 'build', 'dev', 'start', 'deploy', 'release']) {
    if (scripts[name]) candidates.push(`${run} ${name}`);
  }
  if (/\b(run|start|serve)\b/.test(lower) && scripts.dev && !candidates.includes(`${run} dev`)) candidates.push(`${run} dev`);
  if (/\b(build|verify|check)\b/.test(lower) && scripts.build && !candidates.includes(`${run} build`)) candidates.push(`${run} build`);
  if (/\b(test|fix|bug|repair)\b/.test(lower) && scripts.test && !candidates.includes(`${run} test`)) candidates.push(`${run} test`);
  if (/\b(deploy|release)\b/.test(lower) && scripts.deploy && !candidates.includes(`${run} deploy`)) candidates.push(`${run} deploy`);
  if (manager === 'make') candidates.push('make help', 'make test');
  if (/\bdocker|compose|container\b/.test(lower)) candidates.push('docker --version', 'docker compose config');
  if (/\bkubectl|k8s|kubernetes\b/.test(lower)) candidates.push('kubectl version --client', 'kubectl config current-context');
  if (/\bhelm\b/.test(lower)) candidates.push('helm version');
  if (/\bterraform|tofu|iac\b/.test(lower)) candidates.push('terraform version', 'terraform validate');
  if (/\bansible\b/.test(lower)) candidates.push('ansible --version', 'ansible-playbook --syntax-check playbook.yml');
  if (/\b(network|dns|route|gateway|latency|packet|port|socket|firewall|proxy|vpn|tcp|udp|http|tls|ssl|ping|traceroute|tracert|nslookup|dig|netstat|ss|ipconfig|ifconfig|netsh)\b/.test(lower)) {
    candidates.push(
      process.platform === 'win32' ? 'ipconfig /all' : 'ip addr || ifconfig',
      process.platform === 'win32' ? 'route print' : 'ip route || netstat -rn',
      'nslookup localhost',
      process.platform === 'win32' ? 'netstat -ano' : 'ss -tulpen || netstat -tulpen'
    );
  }
  if (/\b(cyber|cybersecurity|security|infosec|audit|scan|secrets?|vulnerab|cves?|cwe|sast|sbom|hardening|gitleaks|trivy|semgrep|bandit|pip-audit|cargo-audit|govulncheck|osv|checkov|tfsec|hadolint)\b/.test(lower)) {
    candidates.push(
      'git status --short',
      process.platform === 'win32' ? 'where gitleaks' : 'command -v gitleaks || true',
      process.platform === 'win32' ? 'where trivy' : 'command -v trivy || true',
      process.platform === 'win32' ? 'where semgrep' : 'command -v semgrep || true',
      'npm audit --audit-level=moderate'
    );
  }
  return [...new Set(candidates)].slice(0, 10);
}

function opsProbeCommands(manager: string): string[] {
  const base = process.platform === 'win32'
    ? ['git status --short', 'where git', 'where node', 'node -v', 'where npm', 'npm -v']
    : ['git status --short', 'command -v git || true', 'command -v node || true', 'node -v', 'command -v npm || true', 'npm -v'];
  const extra: string[] = [];
  if (manager === 'pnpm') extra.push(process.platform === 'win32' ? 'where pnpm' : 'command -v pnpm || true', 'pnpm -v');
  if (manager === 'yarn') extra.push(process.platform === 'win32' ? 'where yarn' : 'command -v yarn || true', 'yarn -v');
  if (manager === 'bun') extra.push(process.platform === 'win32' ? 'where bun' : 'command -v bun || true', 'bun -v');
  if (manager === 'poetry') extra.push(process.platform === 'win32' ? 'where poetry' : 'command -v poetry || true', 'poetry --version');
  if (manager === 'pip' || manager === 'python') extra.push(process.platform === 'win32' ? 'where python' : 'command -v python3 || true', process.platform === 'win32' ? 'python --version' : 'python3 --version');
  if (manager === 'composer') extra.push(process.platform === 'win32' ? 'where composer' : 'command -v composer || true', 'composer --version');
  if (manager === 'cargo') extra.push(process.platform === 'win32' ? 'where cargo' : 'command -v cargo || true', 'cargo --version');
  if (manager === 'go') extra.push(process.platform === 'win32' ? 'where go' : 'command -v go || true', 'go version');
  if (manager === 'make') extra.push(process.platform === 'win32' ? 'where make' : 'command -v make || true', 'make --version');
  extra.push(
    process.platform === 'win32' ? 'where docker' : 'command -v docker || true',
    'docker --version',
    process.platform === 'win32' ? 'where kubectl' : 'command -v kubectl || true',
    process.platform === 'win32' ? 'where terraform' : 'command -v terraform || true',
    process.platform === 'win32' ? 'ipconfig /all' : 'ip addr || ifconfig',
    process.platform === 'win32' ? 'route print' : 'ip route || netstat -rn',
    'nslookup localhost',
    process.platform === 'win32' ? 'where gitleaks' : 'command -v gitleaks || true',
    process.platform === 'win32' ? 'where trivy' : 'command -v trivy || true',
    process.platform === 'win32' ? 'where semgrep' : 'command -v semgrep || true'
  );
  return [...new Set([...base, ...extra])];
}

async function projectOpsPreflightMessage(userInput: string): Promise<string> {
  const cwd = getWorkspaceCwd();
  const pkg = await readPackageJson(cwd);
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts as Record<string, string> : {};
  const deps = Object.keys({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }).sort();
  const manager = await detectPackageManager(cwd);
  const files = await nearbyFiles(cwd);
  const candidates = commandCandidates(manager, scripts, userInput);
  const localBins = getLocalFirstPathEntries(cwd).map((entry) => path.relative(cwd, entry) || '.');
  const commandMemory = await formatCommandMemoryForPrompt(cwd, 12);
  const runs = await Promise.all(opsProbeCommands(manager).map((c) => runOneShellLine(c, cwd)));

  const lines: string[] = [
    '<yamx_project_preflight>',
    `platform=${process.platform} arch=${process.arch} cwd=${cwd}`,
    'Read-only project and system probes run by YamX before the model replies.',
    'Use this as PRIMARY evidence for vague local ops requests like "install it", "diagnose it", "fix it", or "run it".',
    'Pick the smallest correct local command from scripts/manifests/probes; do not answer with generic setup prose.',
    '',
    `package_manager=${manager}`,
    `nearby_files=${files.length ? files.join(', ') : '(none)'}`,
    `local_path_bins=${localBins.length ? localBins.join(', ') : '(none)'}`,
    `package_name=${pkg?.name || '(none)'}`,
    `scripts=${Object.keys(scripts).length ? Object.entries(scripts).map(([k, v]) => `${k}: ${v}`).join(' | ') : '(none)'}`,
    `dependency_count=${deps.length}`,
    `candidate_next_commands=${candidates.length ? candidates.join(' | ') : '(none detected; inspect manifests or ask one Need: question)'}`,
    '',
    'Command memory for this project/cwd:',
    commandMemory,
    '',
  ];

  let used = lines.join('\n').length + 128;
  for (const row of runs) {
    let block = `\n### run: ${row.line}\nexit ${row.code ?? '?'}\n${row.text.trimEnd()}`;
    const room = OPS_TOTAL_MAX_CHARS - used;
    if (room <= 80) {
      lines.push('\n...(project preflight truncated)');
      break;
    }
    if (block.length > room) block = block.slice(0, room - 48) + '\n...(truncated)\n';
    lines.push(block);
    used += block.length;
  }

  lines.push('', '</yamx_project_preflight>');
  return lines.join('\n').trimEnd();
}

/** Returns an extra user-role message blob, or null when no probes ran. */
export async function maybeRuntimePreflightMessage(userInput: string): Promise<string | null> {
  const intentText = preflightIntentText(userInput);
  const intent = classifyUserIntent(intentText);
  if (intent.kind === 'conversation' || intent.kind === 'empty') return null;
  const topic = inferRuntimeTopic(intentText);
  if (!topic) {
    if (!inferProjectOpsPreflight(intentText)) return null;
    return projectOpsPreflightMessage(intentText);
  }

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
