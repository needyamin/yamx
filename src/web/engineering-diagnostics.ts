import os from 'node:os';
import { getSmartShell, getWorkspaceCwd, getWorkspaceRelativeCwd, runProcess } from '../tools/utils.js';

export type EngineeringSuite = 'all' | 'vm' | 'fullstack' | 'devops' | 'network' | 'security';
export type EngineeringProfile = 'standard' | 'deep';
export type EngineeringStatus = 'pass' | 'warn' | 'fail';

type EngineeringDomain = Exclude<EngineeringSuite, 'all'>;

type PlatformCommand =
  | string
  | {
      win32?: string;
      linux?: string;
      darwin?: string;
      default?: string;
    };

interface ProbeDefinition {
  id: string;
  title: string;
  command: PlatformCommand;
  successPattern?: RegExp;
  timeoutMs?: number;
}

interface CheckDefinition {
  id: string;
  title: string;
  domains: EngineeringDomain[];
  required: boolean;
  profile: EngineeringProfile;
  mode: 'any' | 'all';
  probes: ProbeDefinition[];
  recommendation: string;
}

export interface EngineeringProbeResult {
  id: string;
  title: string;
  command: string;
  shell: string;
  ok: boolean;
  code: number | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
}

export interface EngineeringCheckResult {
  id: string;
  title: string;
  domains: EngineeringDomain[];
  required: boolean;
  status: EngineeringStatus;
  summary: string;
  recommendation: string;
  probeIds: string[];
}

export interface EngineeringReport {
  suite: EngineeringSuite;
  profile: EngineeringProfile;
  ok: boolean;
  generatedAt: string;
  platform: NodeJS.Platform;
  arch: string;
  node: string;
  cwd: string;
  overallScore: number;
  domainScores: Record<EngineeringDomain, number>;
  counts: {
    pass: number;
    warn: number;
    fail: number;
    requiredFail: number;
  };
  vmHint: {
    likelyVirtualized: boolean;
    evidence: string[];
  };
  checks: EngineeringCheckResult[];
  probes: EngineeringProbeResult[];
  recommendations: string[];
}

const CACHE_TTL_MS = 45_000;
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_CHARS = 2_600;
const VM_SIGNAL = /\b(virtual|vmware|hyper-v|virtualbox|kvm|qemu|xen|parallels|bhyve)\b/i;
const SUITES: EngineeringSuite[] = ['all', 'vm', 'fullstack', 'devops', 'network', 'security'];
const PROFILES: EngineeringProfile[] = ['standard', 'deep'];
const DOMAINS: EngineeringDomain[] = ['vm', 'fullstack', 'devops', 'network', 'security'];

const CHECKS: CheckDefinition[] = [
  {
    id: 'shell_exec',
    title: 'Shell execution baseline',
    domains: ['vm'],
    required: true,
    profile: 'standard',
    mode: 'all',
    probes: [{ id: 'echo_probe', title: 'Echo probe', command: 'echo yamx_probe_ok', successPattern: /yamx_probe_ok/i }],
    recommendation: 'If this fails, fix shell/runtime permissions for the current user before running YamX.',
  },
  {
    id: 'node_runtime',
    title: 'Node.js runtime',
    domains: ['vm', 'fullstack', 'devops'],
    required: true,
    profile: 'standard',
    mode: 'all',
    probes: [{ id: 'node_v', title: 'Node version', command: 'node -v', successPattern: /^v\d+\./i }],
    recommendation: 'Install Node.js LTS and ensure `node` resolves from PATH.',
  },
  {
    id: 'npm_runtime',
    title: 'Package manager runtime',
    domains: ['fullstack', 'devops'],
    required: true,
    profile: 'standard',
    mode: 'all',
    probes: [{ id: 'npm_v', title: 'npm version', command: 'npm -v' }],
    recommendation: 'Install npm (bundled with Node.js) and verify `npm -v` works in the same shell.',
  },
  {
    id: 'git_runtime',
    title: 'Git operations',
    domains: ['devops', 'fullstack', 'security'],
    required: true,
    profile: 'standard',
    mode: 'all',
    probes: [{ id: 'git_v', title: 'Git version', command: 'git --version' }],
    recommendation: 'Install Git CLI and ensure PATH visibility for non-interactive shell sessions.',
  },
  {
    id: 'http_tooling',
    title: 'HTTP client tooling',
    domains: ['network', 'fullstack', 'security'],
    required: true,
    profile: 'standard',
    mode: 'all',
    probes: [{ id: 'curl_v', title: 'curl version', command: 'curl --version' }],
    recommendation: 'Install curl or provide an equivalent local HTTP client in PATH.',
  },
  {
    id: 'dns_local',
    title: 'Local DNS resolution',
    domains: ['network'],
    required: true,
    profile: 'standard',
    mode: 'any',
    probes: [
      {
        id: 'dns_getent',
        title: 'Resolve localhost (native)',
        command: {
          win32: 'nslookup localhost',
          linux: 'getent hosts localhost',
          darwin: 'dscacheutil -q host -a name localhost',
          default: 'nslookup localhost',
        },
      },
      { id: 'dns_nslookup', title: 'Resolve localhost (nslookup)', command: 'nslookup localhost' },
    ],
    recommendation: 'Repair local DNS resolver config before debugging external network paths.',
  },
  {
    id: 'process_observability',
    title: 'Process observability',
    domains: ['devops', 'network', 'security'],
    required: true,
    profile: 'standard',
    mode: 'all',
    probes: [
      {
        id: 'process_list',
        title: 'Process list',
        command: { win32: 'tasklist', default: 'ps -ef' },
      },
    ],
    recommendation: 'Ensure process inspection commands work so incident triage can start from process state.',
  },
  {
    id: 'socket_observability',
    title: 'Socket/listener observability',
    domains: ['network', 'security'],
    required: true,
    profile: 'standard',
    mode: 'any',
    probes: [
      {
        id: 'socket_primary',
        title: 'Active listeners (primary)',
        command: { win32: 'netstat -ano', linux: 'ss -tuln', darwin: 'netstat -an', default: 'netstat -an' },
      },
      {
        id: 'socket_fallback',
        title: 'Active listeners (fallback)',
        command: { win32: 'netstat -ano', default: 'netstat -tuln' },
      },
    ],
    recommendation: 'Install/enable listener inspection tooling (`ss`/`netstat`) for port and exposure debugging.',
  },
  {
    id: 'docker_ops',
    title: 'Container runtime',
    domains: ['devops'],
    required: false,
    profile: 'standard',
    mode: 'all',
    probes: [{ id: 'docker_v', title: 'Docker version', command: 'docker --version' }],
    recommendation: 'Install Docker CLI/Engine if this environment is expected to run containerized workflows.',
  },
  {
    id: 'docker_compose_ops',
    title: 'Compose orchestration',
    domains: ['devops', 'fullstack'],
    required: false,
    profile: 'standard',
    mode: 'any',
    probes: [
      { id: 'compose_v2', title: 'docker compose', command: 'docker compose version' },
      { id: 'compose_v1', title: 'docker-compose', command: 'docker-compose --version' },
    ],
    recommendation: 'Install Docker Compose v2 plugin (preferred) for local stack orchestration.',
  },
  {
    id: 'k8s_ops',
    title: 'Kubernetes client',
    domains: ['devops'],
    required: false,
    profile: 'standard',
    mode: 'all',
    probes: [{ id: 'kubectl_v', title: 'kubectl client version', command: 'kubectl version --client' }],
    recommendation: 'Install `kubectl` for Kubernetes operations in this environment.',
  },
  {
    id: 'iac_ops',
    title: 'Infrastructure-as-code client',
    domains: ['devops'],
    required: false,
    profile: 'standard',
    mode: 'any',
    probes: [
      { id: 'terraform_v', title: 'terraform version', command: 'terraform version' },
      { id: 'tofu_v', title: 'tofu version', command: 'tofu version' },
    ],
    recommendation: 'Install Terraform or OpenTofu for IaC validation/deploy flows.',
  },
  {
    id: 'python_tooling',
    title: 'Python runtime',
    domains: ['fullstack', 'security'],
    required: false,
    profile: 'standard',
    mode: 'any',
    probes: [
      { id: 'python3_v', title: 'python3 version', command: { win32: 'python --version', default: 'python3 --version' } },
      { id: 'python_v', title: 'python version', command: 'python --version' },
    ],
    recommendation: 'Install Python 3 when security tooling or backend scripts depend on it.',
  },
  {
    id: 'tls_tooling',
    title: 'TLS inspection tools',
    domains: ['network', 'security'],
    required: false,
    profile: 'standard',
    mode: 'all',
    probes: [{ id: 'openssl_v', title: 'OpenSSL version', command: 'openssl version' }],
    recommendation: 'Install OpenSSL CLI for certificate and TLS troubleshooting.',
  },
  {
    id: 'security_scanners',
    title: 'Defensive scanners',
    domains: ['security'],
    required: false,
    profile: 'deep',
    mode: 'any',
    probes: [
      { id: 'gitleaks_v', title: 'gitleaks', command: 'gitleaks version' },
      { id: 'trivy_v', title: 'trivy', command: 'trivy --version' },
      { id: 'semgrep_v', title: 'semgrep', command: 'semgrep --version' },
      { id: 'bandit_v', title: 'bandit', command: 'bandit --version' },
      { id: 'pipaudit_v', title: 'pip-audit', command: 'pip-audit --version' },
      { id: 'npmaudit_v', title: 'npm audit', command: 'npm audit --version' },
    ],
    recommendation: 'Add at least one scanner (gitleaks/trivy/semgrep/bandit/pip-audit/npm audit) for defensive checks.',
  },
  {
    id: 'vm_platform_snapshot',
    title: 'VM/host platform fingerprint',
    domains: ['vm', 'devops'],
    required: false,
    profile: 'deep',
    mode: 'all',
    probes: [
      {
        id: 'host_snapshot',
        title: 'Host fingerprint',
        command: {
          win32: 'powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Model)"',
          linux: 'uname -a',
          darwin: 'sw_vers',
          default: 'uname -a',
        },
        timeoutMs: 10_000,
      },
    ],
    recommendation: 'Capture host/VM fingerprint in runbooks for reproducible troubleshooting across environments.',
  },
];

const cache = new Map<string, { at: number; report: EngineeringReport }>();

export function normalizeEngineeringSuite(value: unknown): EngineeringSuite {
  const text = String(value || '').trim().toLowerCase() as EngineeringSuite;
  return SUITES.includes(text) ? text : 'all';
}

export function normalizeEngineeringProfile(value: unknown): EngineeringProfile {
  const text = String(value || '').trim().toLowerCase() as EngineeringProfile;
  return PROFILES.includes(text) ? text : 'standard';
}

export async function getEngineeringReadiness(force = false): Promise<EngineeringReport> {
  return runEngineeringChallenge({ suite: 'all', profile: 'standard', force });
}

export async function runEngineeringChallenge(options: {
  suite?: EngineeringSuite;
  profile?: EngineeringProfile;
  force?: boolean;
} = {}): Promise<EngineeringReport> {
  const suite = normalizeEngineeringSuite(options.suite);
  const profile = normalizeEngineeringProfile(options.profile);
  const key = `${suite}:${profile}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (!options.force && cached && now - cached.at < CACHE_TTL_MS) return cached.report;

  const selected = CHECKS.filter((check) => matchesSuite(check, suite) && allowsProfile(check, profile));
  const probes: EngineeringProbeResult[] = [];
  const checks: EngineeringCheckResult[] = [];

  for (const check of selected) {
    const result = await runCheck(check);
    checks.push(result.check);
    probes.push(...result.probes);
  }

  const counts = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    requiredFail: checks.filter((c) => c.status === 'fail' && c.required).length,
  };

  const domainScores = computeDomainScores(checks);
  const overallScore = computeOverallScore(checks);
  const vmHint = detectVmHint(probes);
  const recommendations = collectRecommendations(checks);

  const report: EngineeringReport = {
    suite,
    profile,
    ok: counts.requiredFail === 0,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cwd: getWorkspaceRelativeCwd(),
    overallScore,
    domainScores,
    counts,
    vmHint,
    checks,
    probes,
    recommendations,
  };

  cache.set(key, { at: now, report });
  return report;
}

function matchesSuite(check: CheckDefinition, suite: EngineeringSuite): boolean {
  if (suite === 'all') return true;
  return check.domains.includes(suite);
}

function allowsProfile(check: CheckDefinition, profile: EngineeringProfile): boolean {
  return profile === 'deep' || check.profile === 'standard';
}

async function runCheck(check: CheckDefinition): Promise<{ check: EngineeringCheckResult; probes: EngineeringProbeResult[] }> {
  const probeResults: EngineeringProbeResult[] = [];
  for (const probe of check.probes) {
    const r = await runProbe(probe);
    probeResults.push(r);
    if (check.mode === 'any' && r.ok) break;
  }

  const passed = check.mode === 'all' ? probeResults.every((p) => p.ok) : probeResults.some((p) => p.ok);
  const status: EngineeringStatus = passed ? 'pass' : check.required ? 'fail' : 'warn';
  const firstFail = probeResults.find((p) => !p.ok);
  const summary = passed
    ? `Passed via ${probeResults.filter((p) => p.ok).map((p) => p.title).join(', ')}.`
    : firstFail
      ? `Failed on ${firstFail.title} (${firstFail.timedOut ? 'timed out' : `exit ${firstFail.code ?? '?'}`}).`
      : 'Failed.';

  return {
    check: {
      id: check.id,
      title: check.title,
      domains: check.domains,
      required: check.required,
      status,
      summary,
      recommendation: check.recommendation,
      probeIds: probeResults.map((p) => p.id),
    },
    probes: probeResults,
  };
}

async function runProbe(probe: ProbeDefinition): Promise<EngineeringProbeResult> {
  const command = pickCommand(probe.command);
  const smart = getSmartShell(command, 'auto');
  const started = Date.now();
  const result = await runProcess(smart.shell.command, [...smart.shell.args, smart.command], {
    cwd: getWorkspaceCwd(),
    timeoutMs: probe.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxChars: DEFAULT_MAX_CHARS,
  });

  let output = String(result.text || '').trim();
  if (!output) output = result.code === 0 ? '(no output)' : `(exit ${result.code ?? '?'}, no output)`;
  if (result.timedOut) output = `${output}\n(timed out)`;
  output = truncate(output, DEFAULT_MAX_CHARS);

  const codeOk = result.code === 0 && !result.timedOut;
  const ok = codeOk && (!probe.successPattern || probe.successPattern.test(output));
  return {
    id: probe.id,
    title: probe.title,
    command: smart.command,
    shell: smart.shell.label,
    ok,
    code: result.code,
    timedOut: result.timedOut,
    durationMs: Date.now() - started,
    output,
  };
}

function pickCommand(command: PlatformCommand): string {
  if (typeof command === 'string') return command;
  if (process.platform === 'win32' && command.win32) return command.win32;
  if (process.platform === 'linux' && command.linux) return command.linux;
  if (process.platform === 'darwin' && command.darwin) return command.darwin;
  return command.default || command.linux || command.darwin || command.win32 || 'echo no-command';
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 24)}\n...(truncated)`;
}

function computeOverallScore(checks: EngineeringCheckResult[]): number {
  if (checks.length === 0) return 0;
  const total = checks.reduce((sum, check) => sum + statusWeight(check.status), 0);
  return Math.round(total / checks.length);
}

function computeDomainScores(checks: EngineeringCheckResult[]): Record<EngineeringDomain, number> {
  const byDomain = Object.fromEntries(DOMAINS.map((domain) => [domain, [] as EngineeringCheckResult[]])) as Record<
    EngineeringDomain,
    EngineeringCheckResult[]
  >;
  for (const check of checks) {
    for (const domain of check.domains) byDomain[domain].push(check);
  }
  const scores = {} as Record<EngineeringDomain, number>;
  for (const domain of DOMAINS) {
    const domainChecks = byDomain[domain];
    if (domainChecks.length === 0) {
      scores[domain] = 0;
      continue;
    }
    const raw = domainChecks.reduce((sum, check) => sum + statusWeight(check.status), 0) / domainChecks.length;
    scores[domain] = Math.round(raw);
  }
  return scores;
}

function statusWeight(status: EngineeringStatus): number {
  if (status === 'pass') return 100;
  if (status === 'warn') return 65;
  return 0;
}

function detectVmHint(probes: EngineeringProbeResult[]): { likelyVirtualized: boolean; evidence: string[] } {
  const evidence: string[] = [];
  for (const probe of probes) {
    if (VM_SIGNAL.test(probe.output)) {
      evidence.push(`${probe.title}: ${extractFirstVmLine(probe.output)}`);
      if (evidence.length >= 4) break;
    }
  }

  if (evidence.length === 0) {
    const host = `${os.type()} ${os.release()} ${os.arch()}`;
    return { likelyVirtualized: false, evidence: [`No explicit VM signature found; host=${host}`] };
  }
  return { likelyVirtualized: true, evidence };
}

function extractFirstVmLine(output: string): string {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value && VM_SIGNAL.test(value));
  return line || output.split(/\r?\n/).find((value) => value.trim()) || '(no line)';
}

function collectRecommendations(checks: EngineeringCheckResult[]): string[] {
  const ordered = checks
    .filter((check) => check.status !== 'pass')
    .sort((a, b) => {
      const ar = a.status === 'fail' && a.required ? 0 : a.status === 'fail' ? 1 : 2;
      const br = b.status === 'fail' && b.required ? 0 : b.status === 'fail' ? 1 : 2;
      return ar - br;
    })
    .map((check) => check.recommendation);
  return [...new Set(ordered)].slice(0, 8);
}
