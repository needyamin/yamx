import fs from 'fs-extra';
import path from 'node:path';
import { getCommandMemoryRecords } from './command-memory.js';
import { getLocalFirstPathEntries, PROJECT_ROOT } from './tools/utils.js';

type Domain =
  | 'software'
  | 'devops'
  | 'network'
  | 'security'
  | 'system'
  | 'database'
  | 'cloud'
  | 'mobile'
  | 'observability'
  | 'ai';

interface CommandKnowledge {
  command: string;
  domain: Domain;
  tags: string[];
  description: string;
  platforms?: NodeJS.Platform[];
}

interface CommandIntelligenceFile {
  version: 1;
  commands: CommandKnowledge[];
}

export interface CommandSuggestion {
  command: string;
  score: number;
  source: 'database' | 'memory' | 'project';
  reason: string;
}

export interface CommandFixSuggestion extends CommandSuggestion {
  confidence: number;
}

const DB_PATH = path.join(process.env.YAMX_HOME || path.join(PROJECT_ROOT, '.yamx'), 'command-intelligence.json');

type IntelligenceTier = 'balanced' | 'advanced' | 'top';

const INTELLIGENCE_TIER: IntelligenceTier = resolveIntelligenceTier();
const TOP_TIER = INTELLIGENCE_TIER === 'top';
const ADVANCED_TIER = TOP_TIER || INTELLIGENCE_TIER === 'advanced';
const MEMORY_SUGGESTION_WINDOW = TOP_TIER ? 140 : ADVANCED_TIER ? 110 : 80;
const PROJECT_SOURCE_BOOST = TOP_TIER ? 52 : ADVANCED_TIER ? 44 : 36;
const LOCAL_FIRST_SAFETY_BOOST = TOP_TIER ? 10 : ADVANCED_TIER ? 8 : 6;
const CAPABILITY_CACHE_TTL_MS = TOP_TIER ? 45_000 : ADVANCED_TIER ? 35_000 : 25_000;
const CAPABILITY_MAX_DIRS = TOP_TIER ? 36 : ADVANCED_TIER ? 28 : 20;
const CAPABILITY_MAX_FILES = TOP_TIER ? 6_000 : ADVANCED_TIER ? 4_500 : 3_000;

function resolveIntelligenceTier(): IntelligenceTier {
  const raw = String(
    process.env.YAMX_INTELLIGENCE_LEVEL
    || process.env.YAMX_INTELLIGENCE_TIER
    || process.env.YAMX_OFFLINE_INTELLIGENCE
    || 'top'
  ).toLowerCase().trim();
  if (['balanced', 'normal', 'default', 'base', 'low'].includes(raw)) return 'balanced';
  if (['advanced', 'adv', 'high'].includes(raw)) return 'advanced';
  return 'top';
}

/* ── Suggestion cache layer (eliminates disk I/O on every keystroke) ────── */
let _cachedDbCommands: CommandKnowledge[] | null = null;
let _cachedDbMtime = 0;
let _cachedProjectCwd = '';
let _cachedProjectKnowledge: CommandKnowledge[] | null = null;
let _cachedProjectAt = 0;
const PROJECT_CACHE_TTL_MS = 8_000; // re-scan project files every 8s max
let _cachedAvailableBinsCwd = '';
let _cachedAvailableBins: Set<string> | null = null;
let _cachedAvailableBinsAt = 0;

const SHELL_BUILTINS = new Set([
  'cd', 'pwd', 'dir', 'ls', 'echo', 'set', 'export', 'unset', 'history',
  'type', 'alias', 'unalias', 'pushd', 'popd', 'where',
]);

async function getCachedDbCommands(): Promise<CommandKnowledge[]> {
  try {
    const stat = await fs.stat(DB_PATH).catch(() => null);
    if (!stat) {
      // File doesn't exist — invalidate cache and return seed commands
      _cachedDbCommands = null;
      _cachedDbMtime = 0;
      return ALL_SEED_COMMANDS;
    }
    const mtime = stat.mtimeMs;
    if (_cachedDbCommands && mtime === _cachedDbMtime) return _cachedDbCommands;
    const file = await readCommandIntelligenceFile();
    _cachedDbCommands = file.commands;
    _cachedDbMtime = mtime;
    return _cachedDbCommands;
  } catch {
    return ALL_SEED_COMMANDS;
  }
}

async function getCachedProjectKnowledge(cwd: string): Promise<CommandKnowledge[]> {
  const now = Date.now();
  if (_cachedProjectKnowledge && _cachedProjectCwd === cwd && now - _cachedProjectAt < PROJECT_CACHE_TTL_MS) {
    return _cachedProjectKnowledge;
  }
  _cachedProjectKnowledge = await projectCommandKnowledge(cwd).catch((): CommandKnowledge[] => []);
  _cachedProjectCwd = cwd;
  _cachedProjectAt = now;
  return _cachedProjectKnowledge;
}

async function getCachedAvailableBinaries(cwd: string): Promise<Set<string>> {
  const now = Date.now();
  if (_cachedAvailableBins && _cachedAvailableBinsCwd === cwd && now - _cachedAvailableBinsAt < CAPABILITY_CACHE_TTL_MS) {
    return _cachedAvailableBins;
  }
  _cachedAvailableBins = await collectAvailableBinaries(cwd).catch(() => new Set<string>());
  _cachedAvailableBinsCwd = cwd;
  _cachedAvailableBinsAt = now;
  return _cachedAvailableBins;
}

async function collectAvailableBinaries(cwd: string): Promise<Set<string>> {
  const bins = new Set<string>();
  for (const builtin of SHELL_BUILTINS) bins.add(builtin);

  const rawDirs = getLocalFirstPathEntries(cwd) || [];
  const seenDirs = new Set<string>();
  const dirs: string[] = [];
  for (const dir of rawDirs) {
    const key = path.resolve(dir);
    if (seenDirs.has(key)) continue;
    seenDirs.add(key);
    dirs.push(key);
    if (dirs.length >= CAPABILITY_MAX_DIRS) break;
  }

  const localNodeBin = path.join(cwd, 'node_modules', '.bin');
  if (!seenDirs.has(path.resolve(localNodeBin))) dirs.unshift(localNodeBin);

  let scannedFiles = 0;
  for (const dir of dirs) {
    if (scannedFiles >= CAPABILITY_MAX_FILES) break;
    let entries: fs.Dirent[] = [];
    try {
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) continue;
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name.toLowerCase();
      if (!name) continue;
      scannedFiles += 1;
      bins.add(name);
      bins.add(name.replace(/\.(cmd|exe|bat|ps1|com|sh)$/i, ''));
      if (scannedFiles >= CAPABILITY_MAX_FILES) break;
    }
  }

  return bins;
}

const SEED_COMMANDS: CommandKnowledge[] = [
  { command: 'git status --short', domain: 'software', tags: ['git', 'status', 'repo', 'check'], description: 'Compact repository status.' },
  { command: 'git diff --stat', domain: 'software', tags: ['git', 'diff', 'changes', 'review'], description: 'Summarize changed files.' },
  { command: 'git diff', domain: 'software', tags: ['git', 'diff', 'review'], description: 'Inspect unstaged changes.' },
  { command: 'git log --oneline -n 10', domain: 'software', tags: ['git', 'history', 'commits'], description: 'Recent commit history.' },
  { command: 'rg --files', domain: 'software', tags: ['files', 'search', 'repo'], description: 'Fast project file listing.' },
  { command: 'rg TODO src', domain: 'software', tags: ['search', 'code', 'todo'], description: 'Search source TODOs.' },
  { command: 'npm install', domain: 'software', tags: ['node', 'npm', 'install', 'deps'], description: 'Install Node dependencies.' },
  { command: 'npm run build', domain: 'software', tags: ['node', 'npm', 'build', 'verify'], description: 'Run project build script.' },
  { command: 'npm test', domain: 'software', tags: ['node', 'npm', 'test', 'verify'], description: 'Run default npm tests.' },
  { command: 'npm run test', domain: 'software', tags: ['node', 'npm', 'test'], description: 'Run test script.' },
  { command: 'npm run lint', domain: 'software', tags: ['node', 'npm', 'lint'], description: 'Run lint script.' },
  { command: 'npm run dev', domain: 'software', tags: ['node', 'npm', 'dev', 'serve'], description: 'Start dev server.' },
  { command: 'node -v', domain: 'software', tags: ['node', 'version', 'runtime'], description: 'Check Node.js version.' },
  { command: 'npm -v', domain: 'software', tags: ['npm', 'version', 'runtime'], description: 'Check npm version.' },
  { command: 'where python', domain: 'software', tags: ['python', 'where', 'path', 'runtime'], description: 'Locate Python executable on Windows.', platforms: ['win32'] },
  { command: 'where py', domain: 'software', tags: ['python', 'launcher', 'where', 'path'], description: 'Locate Python launcher on Windows.', platforms: ['win32'] },
  { command: 'py -0', domain: 'software', tags: ['python', 'launcher', 'version', 'runtime'], description: 'List installed Python launcher targets.', platforms: ['win32'] },
  { command: 'py -V', domain: 'software', tags: ['python', 'launcher', 'version', 'runtime'], description: 'Show Python launcher version.', platforms: ['win32'] },
  { command: 'where node', domain: 'software', tags: ['node', 'where', 'path', 'runtime'], description: 'Locate Node executable on Windows.', platforms: ['win32'] },
  { command: 'where docker', domain: 'software', tags: ['docker', 'where', 'path', 'runtime'], description: 'Locate Docker executable on Windows.', platforms: ['win32'] },
  { command: 'where git', domain: 'software', tags: ['git', 'where', 'path', 'runtime'], description: 'Locate Git executable on Windows.', platforms: ['win32'] },
  { command: 'command -v python3', domain: 'software', tags: ['python', 'which', 'path', 'runtime'], description: 'Locate Python executable on Unix.', platforms: ['linux', 'darwin', 'freebsd', 'openbsd'] },
  { command: 'command -v node', domain: 'software', tags: ['node', 'which', 'path', 'runtime'], description: 'Locate Node executable on Unix.', platforms: ['linux', 'darwin', 'freebsd', 'openbsd'] },
  { command: 'command -v docker', domain: 'software', tags: ['docker', 'which', 'path', 'runtime'], description: 'Locate Docker executable on Unix.', platforms: ['linux', 'darwin', 'freebsd', 'openbsd'] },
  { command: 'command -v git', domain: 'software', tags: ['git', 'which', 'path', 'runtime'], description: 'Locate Git executable on Unix.', platforms: ['linux', 'darwin', 'freebsd', 'openbsd'] },
  { command: 'python --version', domain: 'software', tags: ['python', 'version', 'runtime'], description: 'Check Python version.' },
  { command: 'python -m pytest', domain: 'software', tags: ['python', 'test', 'pytest'], description: 'Run Python tests.' },
  { command: 'pip install -r requirements.txt', domain: 'software', tags: ['python', 'pip', 'install', 'deps'], description: 'Install Python requirements.' },
  { command: 'cargo test', domain: 'software', tags: ['rust', 'cargo', 'test'], description: 'Run Rust tests.' },
  { command: 'cargo build', domain: 'software', tags: ['rust', 'cargo', 'build'], description: 'Build Rust project.' },
  { command: 'go test ./...', domain: 'software', tags: ['go', 'test'], description: 'Run Go tests.' },
  { command: 'go build ./...', domain: 'software', tags: ['go', 'build'], description: 'Build Go packages.' },
  { command: 'composer install', domain: 'software', tags: ['php', 'composer', 'install', 'deps'], description: 'Install PHP dependencies.' },
  { command: 'php artisan test', domain: 'software', tags: ['php', 'laravel', 'test'], description: 'Run Laravel tests.' },
  { command: 'docker --version', domain: 'devops', tags: ['docker', 'version', 'container'], description: 'Check Docker client version.' },
  { command: 'docker compose config', domain: 'devops', tags: ['docker', 'compose', 'validate'], description: 'Validate Compose configuration.' },
  { command: 'docker compose ps', domain: 'devops', tags: ['docker', 'compose', 'status'], description: 'List Compose services.' },
  { command: 'docker ps', domain: 'devops', tags: ['docker', 'container', 'status'], description: 'List running containers.' },
  { command: 'kubectl version --client', domain: 'devops', tags: ['kubernetes', 'kubectl', 'version'], description: 'Check kubectl client.' },
  { command: 'kubectl config current-context', domain: 'devops', tags: ['kubernetes', 'kubectl', 'context'], description: 'Show active kube context.' },
  { command: 'kubectl get pods', domain: 'devops', tags: ['kubernetes', 'kubectl', 'pods', 'status'], description: 'List pods.' },
  { command: 'helm lint .', domain: 'devops', tags: ['helm', 'lint', 'kubernetes'], description: 'Lint local Helm chart.' },
  { command: 'terraform validate', domain: 'devops', tags: ['terraform', 'iac', 'validate'], description: 'Validate Terraform files.' },
  { command: 'terraform plan', domain: 'devops', tags: ['terraform', 'iac', 'plan'], description: 'Preview Terraform changes.' },
  { command: 'terraform fmt -check', domain: 'devops', tags: ['terraform', 'iac', 'format'], description: 'Check Terraform formatting.' },
  { command: 'ansible-playbook --syntax-check playbook.yml', domain: 'devops', tags: ['ansible', 'syntax', 'validate'], description: 'Syntax-check Ansible playbook.' },
  { command: 'systemctl status nginx', domain: 'devops', tags: ['linux', 'service', 'nginx', 'status'], description: 'Inspect nginx service.', platforms: ['linux'] },
  { command: 'journalctl -u nginx -n 100', domain: 'devops', tags: ['linux', 'logs', 'nginx', 'service'], description: 'Recent nginx service logs.', platforms: ['linux'] },
  { command: 'ipconfig /all', domain: 'network', tags: ['windows', 'network', 'dns', 'interface'], description: 'Windows interface and DNS details.', platforms: ['win32'] },
  { command: 'route print', domain: 'network', tags: ['windows', 'network', 'route'], description: 'Windows route table.', platforms: ['win32'] },
  { command: 'netstat -ano', domain: 'network', tags: ['windows', 'network', 'listeners', 'ports'], description: 'Windows ports and listeners.', platforms: ['win32'] },
  { command: 'netsh wlan show interfaces', domain: 'network', tags: ['windows', 'wifi', 'network'], description: 'Windows Wi-Fi interface status.', platforms: ['win32'] },
  { command: 'ip addr', domain: 'network', tags: ['linux', 'network', 'interface'], description: 'Linux interface addresses.', platforms: ['linux'] },
  { command: 'ip route', domain: 'network', tags: ['linux', 'network', 'route'], description: 'Linux route table.', platforms: ['linux'] },
  { command: 'ss -tulpen', domain: 'network', tags: ['linux', 'network', 'listeners', 'ports'], description: 'Linux listening sockets.', platforms: ['linux'] },
  { command: 'cat /etc/resolv.conf', domain: 'network', tags: ['linux', 'dns', 'resolver'], description: 'Linux resolver config.', platforms: ['linux'] },
  { command: 'nslookup localhost', domain: 'network', tags: ['dns', 'network', 'probe'], description: 'Test DNS resolver.' },
  { command: 'ping 127.0.0.1', domain: 'network', tags: ['network', 'ping', 'local'], description: 'Local TCP/IP sanity check.' },
  { command: 'curl -I http://localhost', domain: 'network', tags: ['http', 'localhost', 'headers'], description: 'Check local HTTP headers.' },
  { command: 'openssl version', domain: 'security', tags: ['openssl', 'crypto', 'version'], description: 'Check OpenSSL version.' },
  { command: 'gitleaks detect --source .', domain: 'security', tags: ['security', 'secrets', 'git'], description: 'Scan repository for leaked secrets.' },
  { command: 'trivy fs .', domain: 'security', tags: ['security', 'vulnerability', 'scan'], description: 'Scan filesystem for vulnerabilities.' },
  { command: 'semgrep scan', domain: 'security', tags: ['security', 'sast', 'scan'], description: 'Run Semgrep SAST scan.' },
  { command: 'npm audit --audit-level=moderate', domain: 'security', tags: ['security', 'npm', 'audit', 'cve'], description: 'Audit npm dependencies.' },
  { command: 'pip-audit', domain: 'security', tags: ['security', 'python', 'audit', 'cve'], description: 'Audit Python dependencies.' },
  { command: 'cargo audit', domain: 'security', tags: ['security', 'rust', 'audit', 'cve'], description: 'Audit Rust dependencies.' },
  { command: 'hadolint Dockerfile', domain: 'security', tags: ['security', 'dockerfile', 'lint'], description: 'Lint Dockerfile hardening issues.' },
  { command: 'checkov -d .', domain: 'security', tags: ['security', 'iac', 'scan'], description: 'Scan IaC misconfigurations.' },
  { command: 'whoami', domain: 'system', tags: ['identity', 'user'], description: 'Current OS user.' },
  { command: 'pwd', domain: 'system', tags: ['cwd', 'directory'], description: 'Current directory.' },
  { command: 'Get-ChildItem -Force', domain: 'system', tags: ['powershell', 'files', 'list'], description: 'List files including hidden items.', platforms: ['win32'] },
  { command: 'Get-Process', domain: 'system', tags: ['powershell', 'process', 'status'], description: 'List Windows processes.', platforms: ['win32'] },
  { command: 'tasklist', domain: 'system', tags: ['windows', 'process', 'status'], description: 'List Windows processes.', platforms: ['win32'] },
  { command: 'ls -la', domain: 'system', tags: ['files', 'list'], description: 'List files including hidden items.' },
  { command: 'ps aux', domain: 'system', tags: ['process', 'status'], description: 'List Unix processes.', platforms: ['linux', 'darwin', 'freebsd', 'openbsd'] },
];

const ADVANCED_COMMANDS: CommandKnowledge[] = [
  // Project and repo intelligence
  { command: 'git status --branch --short', domain: 'software', tags: ['git', 'branch', 'status', 'repo'], description: 'Compact status with current branch.' },
  { command: 'git diff --name-only', domain: 'software', tags: ['git', 'changed', 'files', 'diff'], description: 'List changed files only.' },
  { command: 'git diff --check', domain: 'software', tags: ['git', 'whitespace', 'lint', 'diff'], description: 'Check diff for whitespace errors.' },
  { command: 'git ls-files --others --exclude-standard', domain: 'software', tags: ['git', 'untracked', 'files'], description: 'List untracked files.' },
  { command: 'git branch --show-current', domain: 'software', tags: ['git', 'branch', 'current'], description: 'Show current branch.' },
  { command: 'git remote -v', domain: 'software', tags: ['git', 'remote', 'origin'], description: 'List git remotes.' },
  { command: 'git stash list', domain: 'software', tags: ['git', 'stash', 'changes'], description: 'List stashes.' },
  { command: 'rg -n "TODO|FIXME|HACK" .', domain: 'software', tags: ['search', 'todo', 'fixme', 'code'], description: 'Search common code markers.' },
  { command: 'rg -n "console\\.log|debugger" src', domain: 'software', tags: ['javascript', 'debug', 'search'], description: 'Find debug leftovers.' },
  { command: 'findstr /S /N /I "TODO FIXME HACK" *', domain: 'software', tags: ['windows', 'search', 'todo', 'fixme'], description: 'Windows recursive marker search.', platforms: ['win32'] },
  { command: 'npm outdated', domain: 'software', tags: ['node', 'npm', 'dependencies', 'updates'], description: 'Show outdated npm dependencies.' },
  { command: 'npm explain', domain: 'software', tags: ['node', 'npm', 'dependency', 'why'], description: 'Explain dependency tree entry.' },
  { command: 'npm ls --depth=0', domain: 'software', tags: ['node', 'npm', 'dependencies', 'list'], description: 'List top-level npm packages.' },
  { command: 'pnpm install', domain: 'software', tags: ['node', 'pnpm', 'install', 'deps'], description: 'Install pnpm dependencies.' },
  { command: 'pnpm run build', domain: 'software', tags: ['node', 'pnpm', 'build'], description: 'Run pnpm build script.' },
  { command: 'pnpm test', domain: 'software', tags: ['node', 'pnpm', 'test'], description: 'Run pnpm tests.' },
  { command: 'yarn install', domain: 'software', tags: ['node', 'yarn', 'install', 'deps'], description: 'Install Yarn dependencies.' },
  { command: 'yarn test', domain: 'software', tags: ['node', 'yarn', 'test'], description: 'Run Yarn tests.' },
  { command: 'bun install', domain: 'software', tags: ['node', 'bun', 'install', 'deps'], description: 'Install Bun dependencies.' },
  { command: 'bun test', domain: 'software', tags: ['node', 'bun', 'test'], description: 'Run Bun tests.' },
  { command: 'npx tsc --noEmit', domain: 'software', tags: ['typescript', 'typecheck', 'verify'], description: 'Run TypeScript type-check without emit.' },
  { command: 'npx eslint .', domain: 'software', tags: ['javascript', 'lint', 'eslint'], description: 'Run ESLint on the project.' },
  { command: 'npx prettier . --check', domain: 'software', tags: ['format', 'prettier', 'check'], description: 'Check formatting with Prettier.' },
  { command: 'npx vitest run', domain: 'software', tags: ['javascript', 'test', 'vitest'], description: 'Run Vitest once.' },
  { command: 'npx jest --runInBand', domain: 'software', tags: ['javascript', 'test', 'jest'], description: 'Run Jest serially.' },
  { command: 'npx playwright test', domain: 'software', tags: ['browser', 'test', 'e2e', 'playwright'], description: 'Run Playwright tests.' },
  { command: 'python -m pip list --outdated', domain: 'software', tags: ['python', 'pip', 'dependencies', 'updates'], description: 'Show outdated Python packages.' },
  { command: 'python -m pip check', domain: 'software', tags: ['python', 'pip', 'dependencies', 'verify'], description: 'Verify installed package dependencies.' },
  { command: 'python -m ruff check .', domain: 'software', tags: ['python', 'lint', 'ruff'], description: 'Run Ruff linter.' },
  { command: 'python -m mypy .', domain: 'software', tags: ['python', 'typecheck', 'mypy'], description: 'Run Mypy type-check.' },
  { command: 'python -m pip install -e .', domain: 'software', tags: ['python', 'editable', 'install'], description: 'Install Python project editable.' },
  { command: 'poetry install', domain: 'software', tags: ['python', 'poetry', 'install', 'deps'], description: 'Install Poetry dependencies.' },
  { command: 'poetry run pytest', domain: 'software', tags: ['python', 'poetry', 'test'], description: 'Run pytest through Poetry.' },
  { command: 'uv sync', domain: 'software', tags: ['python', 'uv', 'install', 'sync'], description: 'Sync Python environment with uv.' },
  { command: 'uv run pytest', domain: 'software', tags: ['python', 'uv', 'test'], description: 'Run pytest through uv.' },
  { command: 'cargo clippy --all-targets --all-features', domain: 'software', tags: ['rust', 'lint', 'clippy'], description: 'Run strict Rust lint checks.' },
  { command: 'cargo fmt --check', domain: 'software', tags: ['rust', 'format', 'check'], description: 'Check Rust formatting.' },
  { command: 'go test -race ./...', domain: 'software', tags: ['go', 'test', 'race'], description: 'Run Go tests with race detector.' },
  { command: 'go vet ./...', domain: 'software', tags: ['go', 'vet', 'lint'], description: 'Run Go vet.' },
  { command: 'mvn test', domain: 'software', tags: ['java', 'maven', 'test'], description: 'Run Maven tests.' },
  { command: 'mvn -q -DskipTests package', domain: 'software', tags: ['java', 'maven', 'build'], description: 'Build Maven package without tests.' },
  { command: 'gradle test', domain: 'software', tags: ['java', 'gradle', 'test'], description: 'Run Gradle tests.' },
  { command: 'dotnet test', domain: 'software', tags: ['dotnet', 'test'], description: 'Run .NET tests.' },
  { command: 'dotnet build', domain: 'software', tags: ['dotnet', 'build'], description: 'Build .NET project.' },
  { command: 'composer validate', domain: 'software', tags: ['php', 'composer', 'validate'], description: 'Validate composer.json.' },
  { command: 'vendor/bin/phpunit', domain: 'software', tags: ['php', 'test', 'phpunit'], description: 'Run PHPUnit from vendor bin.' },
  { command: 'php artisan migrate:status', domain: 'software', tags: ['php', 'laravel', 'database', 'migration'], description: 'Show Laravel migration status.' },

  // DevOps and containers
  { command: 'docker compose up -d', domain: 'devops', tags: ['docker', 'compose', 'start', 'service'], description: 'Start Compose services detached.' },
  { command: 'docker compose logs --tail=100', domain: 'devops', tags: ['docker', 'compose', 'logs'], description: 'Tail recent Compose logs.' },
  { command: 'docker compose down', domain: 'devops', tags: ['docker', 'compose', 'stop'], description: 'Stop Compose services.' },
  { command: 'docker compose pull', domain: 'devops', tags: ['docker', 'compose', 'update', 'images'], description: 'Pull Compose images.' },
  { command: 'docker system df', domain: 'devops', tags: ['docker', 'disk', 'usage'], description: 'Show Docker disk usage.' },
  { command: 'docker image prune', domain: 'devops', tags: ['docker', 'cleanup', 'images'], description: 'Prune dangling Docker images.' },
  { command: 'docker logs --tail=100', domain: 'devops', tags: ['docker', 'logs', 'container'], description: 'Tail container logs.' },
  { command: 'docker inspect', domain: 'devops', tags: ['docker', 'inspect', 'container'], description: 'Inspect Docker object JSON.' },
  { command: 'kubectl get nodes -o wide', domain: 'devops', tags: ['kubernetes', 'nodes', 'status'], description: 'List Kubernetes nodes with details.' },
  { command: 'kubectl get pods -A -o wide', domain: 'devops', tags: ['kubernetes', 'pods', 'all', 'status'], description: 'List pods across namespaces.' },
  { command: 'kubectl describe pod', domain: 'devops', tags: ['kubernetes', 'pod', 'describe', 'debug'], description: 'Describe a pod.' },
  { command: 'kubectl logs --tail=100', domain: 'devops', tags: ['kubernetes', 'logs', 'pod'], description: 'Tail Kubernetes pod logs.' },
  { command: 'kubectl events --sort-by=.lastTimestamp', domain: 'devops', tags: ['kubernetes', 'events', 'debug'], description: 'Show recent Kubernetes events.' },
  { command: 'kubectl rollout status deployment', domain: 'devops', tags: ['kubernetes', 'deployment', 'rollout'], description: 'Check deployment rollout.' },
  { command: 'kubectl diff -f .', domain: 'devops', tags: ['kubernetes', 'diff', 'dry-run'], description: 'Diff local manifests against cluster.' },
  { command: 'helm template .', domain: 'devops', tags: ['helm', 'render', 'template'], description: 'Render Helm chart locally.' },
  { command: 'helm upgrade --install', domain: 'devops', tags: ['helm', 'deploy', 'release'], description: 'Install or upgrade Helm release.' },
  { command: 'kustomize build .', domain: 'devops', tags: ['kubernetes', 'kustomize', 'render'], description: 'Render Kustomize manifests.' },
  { command: 'terraform init', domain: 'devops', tags: ['terraform', 'init', 'iac'], description: 'Initialize Terraform working directory.' },
  { command: 'terraform plan -out=tfplan', domain: 'devops', tags: ['terraform', 'plan', 'iac'], description: 'Create saved Terraform plan.' },
  { command: 'terraform show -json tfplan', domain: 'devops', tags: ['terraform', 'plan', 'json'], description: 'Inspect saved Terraform plan as JSON.' },
  { command: 'terraform providers lock', domain: 'devops', tags: ['terraform', 'providers', 'lock'], description: 'Update provider lock file.' },
  { command: 'tofu validate', domain: 'devops', tags: ['opentofu', 'tofu', 'validate'], description: 'Validate OpenTofu files.' },
  { command: 'ansible-inventory --list', domain: 'devops', tags: ['ansible', 'inventory', 'debug'], description: 'Render Ansible inventory.' },
  { command: 'ansible-playbook --check --diff playbook.yml', domain: 'devops', tags: ['ansible', 'dry-run', 'diff'], description: 'Dry-run Ansible playbook with diff.' },
  { command: 'vagrant status', domain: 'devops', tags: ['vagrant', 'vm', 'status'], description: 'Show Vagrant VM status.' },
  { command: 'pm2 status', domain: 'devops', tags: ['node', 'pm2', 'process', 'status'], description: 'Show PM2 process status.' },
  { command: 'pm2 logs --lines 100', domain: 'devops', tags: ['node', 'pm2', 'logs'], description: 'Tail PM2 logs.' },

  // Cloud CLIs
  { command: 'gh auth status', domain: 'cloud', tags: ['github', 'gh', 'auth', 'status'], description: 'Check GitHub CLI auth.' },
  { command: 'gh repo view --web', domain: 'cloud', tags: ['github', 'repo', 'open'], description: 'Open current GitHub repo.' },
  { command: 'gh pr status', domain: 'cloud', tags: ['github', 'pull-request', 'status'], description: 'Show pull request status.' },
  { command: 'gh run list --limit 10', domain: 'cloud', tags: ['github', 'actions', 'ci', 'runs'], description: 'List recent GitHub Actions runs.' },
  { command: 'gh run watch', domain: 'cloud', tags: ['github', 'actions', 'ci', 'watch'], description: 'Watch a GitHub Actions run.' },
  { command: 'aws sts get-caller-identity', domain: 'cloud', tags: ['aws', 'auth', 'identity'], description: 'Show current AWS identity.' },
  { command: 'aws configure list', domain: 'cloud', tags: ['aws', 'config', 'profile'], description: 'Show AWS config resolution.' },
  { command: 'aws s3 ls', domain: 'cloud', tags: ['aws', 's3', 'storage'], description: 'List S3 buckets.' },
  { command: 'gcloud auth list', domain: 'cloud', tags: ['gcp', 'gcloud', 'auth'], description: 'List gcloud accounts.' },
  { command: 'gcloud config list', domain: 'cloud', tags: ['gcp', 'gcloud', 'config'], description: 'Show gcloud config.' },
  { command: 'az account show', domain: 'cloud', tags: ['azure', 'az', 'account'], description: 'Show Azure account.' },
  { command: 'az group list -o table', domain: 'cloud', tags: ['azure', 'resource-group', 'list'], description: 'List Azure resource groups.' },
  { command: 'vercel whoami', domain: 'cloud', tags: ['vercel', 'auth', 'deploy'], description: 'Check Vercel identity.' },
  { command: 'vercel logs', domain: 'cloud', tags: ['vercel', 'logs', 'deploy'], description: 'Show Vercel logs.' },
  { command: 'netlify status', domain: 'cloud', tags: ['netlify', 'auth', 'deploy'], description: 'Check Netlify status.' },
  { command: 'wrangler whoami', domain: 'cloud', tags: ['cloudflare', 'wrangler', 'auth'], description: 'Check Cloudflare Wrangler auth.' },
  { command: 'fly status', domain: 'cloud', tags: ['fly', 'deploy', 'status'], description: 'Show Fly app status.' },
  { command: 'railway status', domain: 'cloud', tags: ['railway', 'deploy', 'status'], description: 'Show Railway status.' },

  // Network diagnostics
  { command: 'curl -v http://localhost', domain: 'network', tags: ['http', 'debug', 'localhost'], description: 'Verbose local HTTP request.' },
  { command: 'curl -I https://example.com', domain: 'network', tags: ['http', 'headers', 'tls'], description: 'Fetch response headers.' },
  { command: 'curl --resolve example.com:443:127.0.0.1 https://example.com', domain: 'network', tags: ['http', 'dns', 'resolve', 'tls'], description: 'Override DNS for one HTTPS request.' },
  { command: 'openssl s_client -connect example.com:443 -servername example.com', domain: 'network', tags: ['tls', 'ssl', 'certificate', 'debug'], description: 'Inspect TLS handshake.' },
  { command: 'dig example.com', domain: 'network', tags: ['dns', 'lookup'], description: 'DNS lookup with dig.' },
  { command: 'dig +trace example.com', domain: 'network', tags: ['dns', 'trace', 'delegation'], description: 'Trace DNS delegation.' },
  { command: 'nslookup example.com', domain: 'network', tags: ['dns', 'lookup'], description: 'DNS lookup with nslookup.' },
  { command: 'tracert example.com', domain: 'network', tags: ['windows', 'route', 'trace'], description: 'Windows route trace.', platforms: ['win32'] },
  { command: 'traceroute example.com', domain: 'network', tags: ['route', 'trace'], description: 'Route trace.', platforms: ['linux', 'darwin', 'freebsd', 'openbsd'] },
  { command: 'mtr example.com', domain: 'network', tags: ['route', 'latency', 'packet-loss'], description: 'Interactive route quality probe.', platforms: ['linux', 'darwin', 'freebsd', 'openbsd'] },
  { command: 'Test-NetConnection example.com -Port 443', domain: 'network', tags: ['powershell', 'tcp', 'port', 'windows'], description: 'Windows TCP reachability test.', platforms: ['win32'] },
  { command: 'nc -vz example.com 443', domain: 'network', tags: ['tcp', 'port', 'probe'], description: 'TCP port reachability probe.', platforms: ['linux', 'darwin', 'freebsd', 'openbsd'] },
  { command: 'lsof -i -P -n', domain: 'network', tags: ['ports', 'listeners', 'process'], description: 'List open network files.' },
  { command: 'Get-NetTCPConnection', domain: 'network', tags: ['powershell', 'tcp', 'connections'], description: 'List Windows TCP connections.', platforms: ['win32'] },
  { command: 'Get-NetIPConfiguration', domain: 'network', tags: ['powershell', 'network', 'ip', 'dns'], description: 'Show Windows network interface configuration.', platforms: ['win32'] },
  { command: 'netsh interface ip show config', domain: 'network', tags: ['windows', 'network', 'ip', 'config'], description: 'Show Windows IP interface config.', platforms: ['win32'] },
  { command: 'Get-NetRoute -AddressFamily IPv4', domain: 'network', tags: ['powershell', 'network', 'route'], description: 'Show Windows IPv4 routing table.', platforms: ['win32'] },

  // Security and supply chain
  { command: 'gitleaks detect --source . --redact', domain: 'security', tags: ['security', 'secrets', 'redact', 'git'], description: 'Scan secrets with redacted output.' },
  { command: 'trivy fs --scanners vuln,secret,misconfig .', domain: 'security', tags: ['security', 'vulnerability', 'secret', 'misconfig'], description: 'Run broad Trivy filesystem scan.' },
  { command: 'trivy image', domain: 'security', tags: ['security', 'container', 'image', 'cve'], description: 'Scan container image.' },
  { command: 'semgrep scan --config auto', domain: 'security', tags: ['security', 'sast', 'semgrep'], description: 'Run Semgrep auto config.' },
  { command: 'npm audit signatures', domain: 'security', tags: ['npm', 'supply-chain', 'signature'], description: 'Verify npm registry signatures.' },
  { command: 'npm audit fix --dry-run', domain: 'security', tags: ['npm', 'audit', 'dry-run'], description: 'Preview npm audit fixes.' },
  { command: 'osv-scanner -r .', domain: 'security', tags: ['security', 'osv', 'cve', 'dependencies'], description: 'Recursive OSV dependency scan.' },
  { command: 'grype dir:.', domain: 'security', tags: ['security', 'vulnerability', 'scan'], description: 'Scan directory with Grype.' },
  { command: 'syft dir:.', domain: 'security', tags: ['security', 'sbom', 'inventory'], description: 'Generate SBOM from directory.' },
  { command: 'bandit -r .', domain: 'security', tags: ['python', 'security', 'sast'], description: 'Run Bandit Python security scan.' },
  { command: 'pip-audit -r requirements.txt', domain: 'security', tags: ['python', 'security', 'audit', 'requirements'], description: 'Audit Python requirements.' },
  { command: 'govulncheck ./...', domain: 'security', tags: ['go', 'security', 'vulnerability'], description: 'Run Go vulnerability checker.' },
  { command: 'cargo deny check', domain: 'security', tags: ['rust', 'security', 'license', 'advisory'], description: 'Run cargo-deny checks.' },
  { command: 'cargo audit', domain: 'security', tags: ['rust', 'security', 'advisory'], description: 'Run RustSec audit.' },
  { command: 'checkov -d . --quiet', domain: 'security', tags: ['iac', 'security', 'checkov'], description: 'Quiet Checkov IaC scan.' },
  { command: 'tfsec .', domain: 'security', tags: ['terraform', 'security', 'iac'], description: 'Run tfsec on Terraform.' },
  { command: 'kube-linter lint .', domain: 'security', tags: ['kubernetes', 'security', 'lint'], description: 'Lint Kubernetes manifests.' },
  { command: 'kubescape scan framework nsa *.yaml', domain: 'security', tags: ['kubernetes', 'security', 'nsa'], description: 'Scan manifests with Kubescape NSA framework.' },
  { command: 'docker scout cves', domain: 'security', tags: ['docker', 'security', 'cve'], description: 'Inspect Docker Scout CVEs.' },

  // Databases
  { command: 'psql -c "\\conninfo"', domain: 'database', tags: ['postgres', 'psql', 'connection'], description: 'Show PostgreSQL connection info.' },
  { command: 'psql -c "\\l"', domain: 'database', tags: ['postgres', 'psql', 'databases'], description: 'List PostgreSQL databases.' },
  { command: 'pg_isready', domain: 'database', tags: ['postgres', 'health', 'ready'], description: 'Check PostgreSQL readiness.' },
  { command: 'pg_dump --schema-only', domain: 'database', tags: ['postgres', 'schema', 'backup'], description: 'Dump PostgreSQL schema only.' },
  { command: 'mysqladmin ping', domain: 'database', tags: ['mysql', 'health', 'ready'], description: 'Check MySQL server readiness.' },
  { command: 'mysql -e "SHOW DATABASES;"', domain: 'database', tags: ['mysql', 'databases', 'list'], description: 'List MySQL databases.' },
  { command: 'sqlite3 database.sqlite ".tables"', domain: 'database', tags: ['sqlite', 'tables', 'list'], description: 'List SQLite tables.' },
  { command: 'redis-cli ping', domain: 'database', tags: ['redis', 'health', 'ping'], description: 'Check Redis readiness.' },
  { command: 'redis-cli info server', domain: 'database', tags: ['redis', 'info', 'server'], description: 'Show Redis server info.' },
  { command: 'mongosh --eval "db.runCommand({ ping: 1 })"', domain: 'database', tags: ['mongodb', 'mongo', 'health'], description: 'Ping MongoDB.' },

  // Observability and logs
  { command: 'tail -n 100 app.log', domain: 'observability', tags: ['logs', 'tail', 'app'], description: 'Tail local app log.', platforms: ['linux', 'darwin', 'freebsd', 'openbsd'] },
  { command: 'Get-Content -Tail 100 app.log', domain: 'observability', tags: ['powershell', 'logs', 'tail'], description: 'Tail local app log in PowerShell.', platforms: ['win32'] },
  { command: 'journalctl -xe', domain: 'observability', tags: ['linux', 'logs', 'systemd', 'errors'], description: 'Show recent systemd errors.', platforms: ['linux'] },
  { command: 'journalctl -f', domain: 'observability', tags: ['linux', 'logs', 'follow'], description: 'Follow systemd journal.', platforms: ['linux'] },
  { command: 'dmesg -T | tail -n 100', domain: 'observability', tags: ['linux', 'kernel', 'logs'], description: 'Recent kernel logs.', platforms: ['linux'] },
  { command: 'wevtutil qe Application /c:50 /f:text', domain: 'observability', tags: ['windows', 'eventlog', 'application'], description: 'Read recent Windows Application events.', platforms: ['win32'] },
  { command: 'Get-EventLog -LogName Application -Newest 50', domain: 'observability', tags: ['powershell', 'eventlog', 'windows'], description: 'Read recent Windows Application events.', platforms: ['win32'] },
  { command: 'Get-Service | Sort-Object Status,DisplayName', domain: 'observability', tags: ['powershell', 'windows', 'service', 'status'], description: 'List Windows services sorted by status.', platforms: ['win32'] },
  { command: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 20', domain: 'observability', tags: ['powershell', 'process', 'cpu', 'performance'], description: 'Top CPU processes (Windows).', platforms: ['win32'] },
  { command: 'Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 20', domain: 'observability', tags: ['powershell', 'process', 'memory', 'performance'], description: 'Top memory processes (Windows).', platforms: ['win32'] },
  { command: 'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,LastBootUpTime', domain: 'system', tags: ['windows', 'system', 'version', 'uptime'], description: 'Show Windows version and last boot time.', platforms: ['win32'] },
  { command: 'Get-Item Env:Path', domain: 'system', tags: ['windows', 'path', 'environment'], description: 'Show Windows PATH environment variable.', platforms: ['win32'] },

  // Mobile, desktop, AI
  { command: 'adb devices', domain: 'mobile', tags: ['android', 'adb', 'devices'], description: 'List Android devices.' },
  { command: 'adb logcat -d -t 200', domain: 'mobile', tags: ['android', 'adb', 'logs'], description: 'Read recent Android logcat.' },
  { command: 'flutter doctor -v', domain: 'mobile', tags: ['flutter', 'doctor', 'diagnose'], description: 'Verbose Flutter diagnostics.' },
  { command: 'flutter test', domain: 'mobile', tags: ['flutter', 'test'], description: 'Run Flutter tests.' },
  { command: 'expo doctor', domain: 'mobile', tags: ['expo', 'react-native', 'doctor'], description: 'Diagnose Expo project.' },
  { command: 'npx react-native doctor', domain: 'mobile', tags: ['react-native', 'doctor'], description: 'Diagnose React Native environment.' },
  { command: 'xcrun simctl list', domain: 'mobile', tags: ['ios', 'simulator', 'xcode'], description: 'List iOS simulators.', platforms: ['darwin'] },
  { command: 'ollama list', domain: 'ai', tags: ['ai', 'llm', 'ollama', 'models'], description: 'List local Ollama models.' },
  { command: 'ollama ps', domain: 'ai', tags: ['ai', 'llm', 'ollama', 'running'], description: 'List running Ollama models.' },
  { command: 'ollama pull', domain: 'ai', tags: ['ai', 'llm', 'ollama', 'download'], description: 'Pull an Ollama model.' },
];

const ALL_SEED_COMMANDS = [...SEED_COMMANDS, ...ADVANCED_COMMANDS];

const QUERY_ALIASES: Record<string, string[]> = {
  k8s: ['kubernetes', 'kubectl', 'pods', 'deployment'],
  kube: ['kubernetes', 'kubectl'],
  pods: ['kubectl get pods', 'kubernetes'],
  compose: ['docker compose'],
  dc: ['docker compose'],
  container: ['docker', 'podman'],
  iac: ['terraform', 'tofu', 'checkov', 'tfsec'],
  tf: ['terraform'],
  ci: ['github actions', 'gh run', 'test', 'build'],
  cd: ['deploy', 'release'],
  deps: ['dependencies', 'install', 'audit', 'outdated'],
  dependency: ['dependencies', 'install', 'audit', 'outdated'],
  vuln: ['vulnerability', 'cve', 'audit', 'scan'],
  cves: ['cve', 'vulnerability', 'audit'],
  secrets: ['secret', 'gitleaks', 'redact'],
  secret: ['gitleaks', 'redact', 'scan'],
  sast: ['semgrep', 'bandit', 'security'],
  sbom: ['syft', 'inventory', 'supply-chain'],
  logs: ['log', 'tail', 'journalctl', 'docker compose logs', 'kubectl logs'],
  prod: ['deploy', 'logs', 'status', 'cloud'],
  http: ['curl', 'headers', 'tls'],
  ssl: ['tls', 'openssl', 'certificate'],
  port: ['netstat', 'ss', 'Test-NetConnection', 'nc'],
  db: ['database', 'postgres', 'mysql', 'sqlite', 'redis', 'mongodb'],
  pg: ['postgres', 'psql'],
  mongo: ['mongodb', 'mongosh'],
  types: ['typecheck', 'typescript', 'mypy'],
  typecheck: ['tsc', 'mypy', 'pyright'],
  format: ['prettier', 'fmt', 'ruff', 'cargo fmt'],
  android: ['adb', 'flutter', 'react-native'],
  ios: ['xcrun', 'simctl', 'flutter'],
  llm: ['ollama', 'ai', 'model'],
  git: ['git', 'status', 'diff', 'branch'],
  gti: ['git', 'status', 'diff', 'branch'],
  statsu: ['status', 'show', 'list'],
  status: ['status', 'show', 'list'],
  build: ['build', 'compile'],
  test: ['test', 'verify'],
  lint: ['lint', 'check'],
  pub: ['publish', 'release', 'npm publish'],
  rel: ['release', 'deploy', 'publish'],
  diag: ['diagnose', 'doctor', 'status', 'check'],
  doctor: ['diagnose', 'health', 'check'],
  docotr: ['doctor', 'diagnose', 'health', 'check'],
  cicd: ['github actions', 'gh run', 'pipeline', 'workflow'],
  pipeline: ['gh run', 'actions', 'ci', 'workflow'],
  monorepo: ['nx', 'turbo', 'workspace', 'packages'],
  nx: ['monorepo', 'workspace'],
  turbo: ['monorepo', 'build', 'cache'],
  peer: ['npm', 'pnpm', 'install', 'dependencies'],
  flaky: ['test', 'retry', 'jest', 'vitest'],
  server: ['service', 'status', 'logs', 'process', 'port', 'config'],
  service: ['status', 'logs', 'process', 'port', 'config', 'dependencies'],
  offline: ['local', 'status', 'version', 'diagnose', 'logs'],
  local: ['status', 'version', 'which', 'where', 'check'],
  diagnose: ['doctor', 'status', 'logs', 'check', 'verify'],
  repair: ['diagnose', 'fix', 'verify', 'test'],
  incident: ['status', 'logs', 'describe', 'netstat', 'ss'],
  runtime: ['version', 'which', 'where', 'path'],
  path: ['which', 'where', 'version', 'runtime'],
  eperm: ['permissions', 'icacls', 'chmod', 'chown', 'status'],
  eaddrinuse: ['netstat', 'ss', 'lsof', 'port', 'process'],
  refused: ['port', 'netstat', 'curl', 'logs', 'status'],
  timeout: ['ping', 'curl', 'traceroute', 'dns', 'logs'],
  dockerized: ['docker', 'compose', 'container', 'logs', 'status'],
  k3s: ['kubernetes', 'kubectl', 'pods', 'nodes'],
  brew: ['install', 'version', 'status'],
  winget: ['install', 'search', 'version'],
};

let cachedKnownTerms: string[] | null = null;

export function commandIntelligencePath(): string {
  return DB_PATH;
}

export async function ensureCommandIntelligenceDatabase(): Promise<string> {
  const file = await readCommandIntelligenceFile();
  const known = new Map(file.commands.map((entry) => [entry.command, entry]));
  for (const entry of ALL_SEED_COMMANDS) {
    if (!known.has(entry.command)) known.set(entry.command, entry);
  }
  const next: CommandIntelligenceFile = {
    version: 1,
    commands: [...known.values()].sort((a, b) => a.command.localeCompare(b.command)),
  };
  await writeCommandIntelligenceFile(next);
  return DB_PATH;
}

export async function suggestCommands(input: string, cwd = process.cwd(), limit = 12): Promise<CommandSuggestion[]> {
  const query = normalizeQuery(input);
  if (!query || query.startsWith('/')) return [];

  const [dbCommands, memory, project, availableBins] = await Promise.all([
    getCachedDbCommands(),
    getCommandMemoryRecords(cwd, MEMORY_SUGGESTION_WINDOW).catch(() => []),
    getCachedProjectKnowledge(cwd),
    getCachedAvailableBinaries(cwd),
  ]);
  const suggestions = new Map<string, CommandSuggestion>();

  // Pre-compute expensive query analysis ONCE (not per-entry)
  const queryLower = query.toLowerCase();
  const expandedQuery = expandQuery(query);
  const queryDomain = inferDomain(expandedQuery);
  const cliIntentBlob = `${queryLower} ${expandedQuery.toLowerCase()}`;
  const cliIntent = inferCliIntentMode(cliIntentBlob);
  const runtimeProbeTarget = inferRuntimeProbeTarget(cliIntentBlob);
  const queryTokens = expandedQuery.split(/\s+/).filter(Boolean);
  const lowSignalQuery = queryTokens.length <= 1 && queryLower.length < 8;
  const serverIncidentHint = isServerIncidentIntent(cliIntentBlob);
  const isProjectEntry = new Set(project);
  const cwdRel = workspaceRelCwd(cwd);

  for (const entry of [...dbCommands, ...project]) {
    if (entry.platforms?.length && !entry.platforms.includes(process.platform)) continue;
    const cmdLower = entry.command.toLowerCase();
    // Fast path: direct prefix match gets high score — always outranks fuzzy
    if (cmdLower.startsWith(queryLower)) {
      const source: 'project' | 'database' = isProjectEntry.has(entry) ? 'project' : 'database';
      // Coverage ratio: how much of the command the user has typed (0..1)
      const coverage = queryLower.length / cmdLower.length;
      // Base prefix score high enough to always outrank fuzzy (which maxes ~140)
      // Coverage bonus rewards longer typed prefixes, exact match gets +40
      const prefixScore = 160 + Math.round(coverage * 60) + (cmdLower === queryLower ? 40 : 0)
        + (source === 'project' ? PROJECT_SOURCE_BOOST : 0)
        + (entry.platforms?.includes(process.platform) ? 10 : 0)
        + commandAvailabilityBoost(entry.command, availableBins)
        + intentModeScoreBoost(cliIntent, entry.command, entry.description)
        + runtimeProbeBoost(runtimeProbeTarget, entry.command)
        + serverIncidentStageBoost(serverIncidentHint, entry.command)
        - incidentDomainPenalty(serverIncidentHint, entry.domain)
        - runtimeTargetMismatchPenalty(runtimeProbeTarget, entry.command)
        - commandRiskPenalty(entry.command, cliIntent, lowSignalQuery, serverIncidentHint, queryTokens);
      const existing = suggestions.get(entry.command);
      if (!existing || prefixScore > existing.score) {
        suggestions.set(entry.command, {
          command: entry.command,
          score: prefixScore,
          source,
          reason: source === 'project' ? entry.description : commandCategoryLabel(entry),
        });
      }
      continue;
    }
    const score = scoreKnowledge(entry, query, expandedQuery, queryDomain, cliIntent);
    if (score <= 0) continue;
    const source: 'project' | 'database' = isProjectEntry.has(entry) ? 'project' : 'database';
    const sourceBoost = source === 'project' ? PROJECT_SOURCE_BOOST : 0;
    const capabilityBoost = commandAvailabilityBoost(entry.command, availableBins);
    const safetyBoost = lowSignalQuery && isReadOnlyCommand(entry.command) ? LOCAL_FIRST_SAFETY_BOOST : 0;
    const runtimeBoost = runtimeProbeBoost(runtimeProbeTarget, entry.command);
    const incidentBoost = serverIncidentStageBoost(serverIncidentHint, entry.command);
    const incidentPenalty = incidentDomainPenalty(serverIncidentHint, entry.domain);
    const runtimeMismatchPenalty = runtimeTargetMismatchPenalty(runtimeProbeTarget, entry.command);
    const riskPenalty = commandRiskPenalty(entry.command, cliIntent, lowSignalQuery, serverIncidentHint, queryTokens);
    const existing = suggestions.get(entry.command);
    const total = score + sourceBoost + capabilityBoost + safetyBoost + runtimeBoost + incidentBoost - incidentPenalty - runtimeMismatchPenalty - riskPenalty;
    if (!existing || total > existing.score) {
      suggestions.set(entry.command, {
        command: entry.command,
        score: total,
        source,
        reason: source === 'project' ? entry.description : commandCategoryLabel(entry),
      });
    }
  }

  for (const record of memory) {
    const baseScore = Math.max(scoreText(record.command, query), scoreText(record.command, expandedQuery));
    if (baseScore <= 0) continue;
    const affinity = memoryCwdAffinity(record.cwd, cwdRel);
    const ageMs = Date.now() - Date.parse(record.lastRunAt);
    const recencyBoost = ageMs < 3_600_000 ? 22 : ageMs < 86_400_000 ? 14 : 6;
    const successRate = record.runs > 0 ? record.successes / record.runs : 0.5;
    const reliabilityBoost = Math.round(successRate * 24) + Math.min(14, Math.log1p(record.runs) * 3);
    const affinityBoost = Math.round(affinity * 42);
    const streakPenalty = record.failures > record.successes && record.runs >= 3 ? 10 : 0;
    const intentMemBoost = intentModeScoreBoost(cliIntent, record.command, '');
    const signalBoost = memorySignalBoost(record.lastSignal, queryTokens);
    const capabilityBoost = commandAvailabilityBoost(record.command, availableBins);
    const safetyBoost = lowSignalQuery && isReadOnlyCommand(record.command) ? LOCAL_FIRST_SAFETY_BOOST : 0;
    const runtimeBoost = runtimeProbeBoost(runtimeProbeTarget, record.command);
    const incidentBoost = serverIncidentStageBoost(serverIncidentHint, record.command);
    const runtimeMismatchPenalty = runtimeTargetMismatchPenalty(runtimeProbeTarget, record.command);
    const repeatFailurePenalty = memoryFailurePenalty(record.successes, record.failures, record.runs, cliIntent);
    const riskPenalty = commandRiskPenalty(record.command, cliIntent, lowSignalQuery, serverIncidentHint, queryTokens);
    const score =
      baseScore
      + affinityBoost
      + recencyBoost
      + reliabilityBoost
      - streakPenalty
      + intentMemBoost
      + signalBoost
      + capabilityBoost
      + safetyBoost
      + runtimeBoost
      + incidentBoost
      + 15;
    const total = score - runtimeMismatchPenalty - repeatFailurePenalty - riskPenalty;
    const existing = suggestions.get(record.command);
    const candidate: CommandSuggestion = {
      command: record.command,
      score: total,
      source: 'memory',
      reason: record.lastExit === 0 ? 'worked before' : 'seen before',
    };
    if (!existing || candidate.score > existing.score) suggestions.set(record.command, candidate);
  }

  return [...suggestions.values()]
    .sort((a, b) => b.score - a.score || a.command.localeCompare(b.command))
    .slice(0, limit);
}

export async function suggestCommandFix(command: string, cwd = process.cwd()): Promise<CommandFixSuggestion | null> {
  const original = command.trim();
  if (!original || original.startsWith('/')) return null;
  const suggestions = await suggestCommands(original, cwd, 8);
  if (suggestions.length === 0) return null;

  const originalNorm = normalizeComparableCommand(original);
  const ranked = suggestions
    .filter((item) => normalizeComparableCommand(item.command) !== originalNorm)
    .map((item) => {
      const similarity = commandSimilarity(original, item.command);
      const executableBoost = firstTokenSimilarity(original, item.command) * 0.22;
      const scoreConfidence = Math.min(1, item.score / 140) * 0.35;
      const confidence = Math.min(1, similarity * 0.43 + executableBoost + scoreConfidence);
      return { ...item, confidence };
    })
    .sort((a, b) => b.confidence - a.confidence || b.score - a.score);

  const best = ranked[0];
  if (!best) return null;
  return best.confidence >= 0.52 || best.score >= 110 ? best : null;
}

export async function readlineCommandCompleter(line: string): Promise<[string[], string]> {
  const suggestions = await suggestCommands(line, process.cwd(), 14);
  return [suggestions.map((item) => item.command), line];
}

async function readCommandIntelligenceFile(): Promise<CommandIntelligenceFile> {
  try {
    const data = await fs.readJSON(DB_PATH);
    if (data?.version === 1 && Array.isArray(data.commands)) {
      return { version: 1, commands: data.commands.filter(isCommandKnowledge) };
    }
  } catch {
    // Seed on first use.
  }
  return { version: 1, commands: ALL_SEED_COMMANDS };
}

async function writeCommandIntelligenceFile(file: CommandIntelligenceFile): Promise<void> {
  await fs.ensureDir(path.dirname(DB_PATH));
  await fs.writeJSON(DB_PATH, file, { spaces: 2 });
}

function isCommandKnowledge(value: any): value is CommandKnowledge {
  return typeof value?.command === 'string'
    && typeof value?.domain === 'string'
    && Array.isArray(value?.tags)
    && typeof value?.description === 'string';
}

function normalizeQuery(input: string): string {
  return input.trim().replace(/^\$ |^> |^!/, '').toLowerCase();
}

function scoreKnowledge(
  entry: CommandKnowledge,
  query: string,
  expandedQuery: string,
  queryDomain: Domain | null,
  cliIntent: CliIntentMode,
): number {
  const commandScore = Math.max(scoreText(entry.command, query), scoreText(entry.command, expandedQuery));
  // Build searchable text (cheap string concat, no regex)
  const text = `${entry.command} ${entry.domain} ${entry.tags.join(' ')} ${entry.description}`.toLowerCase();
  const textScore = Math.max(scoreText(text, query), scoreText(text, expandedQuery));
  const coverageBoost = tokenCoverageBoost(text, expandedQuery);
  const domainBoost = queryDomain && entry.domain === queryDomain ? 28 : 0;
  const platformBoost = entry.platforms?.includes(process.platform) ? 10 : 0;
  const safetyBoost = /\b(status|list|show|check|validate|lint|test|logs?|describe|diff|dry-run|plan|version)\b/i.test(entry.command) ? 6 : 0;
  const intentBoost = intentModeScoreBoost(cliIntent, entry.command, entry.description);
  return commandScore + textScore + coverageBoost + domainBoost + platformBoost + safetyBoost + intentBoost;
}

function scoreText(text: string, query: string): number {
  const lower = text.toLowerCase();
  if (lower === query) return 120;
  if (lower.startsWith(query)) return 100;
  if (lower.includes(query)) return 60;

  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const token of tokens) {
    const idx = lower.indexOf(token);
    if (idx >= 0) {
      const before = idx === 0 || !/[a-z0-9]/i.test(lower[idx - 1]);
      const afterIdx = idx + token.length;
      const after = afterIdx >= lower.length || !/[a-z0-9]/i.test(lower[afterIdx]);
      if (before && after) score += 34;       // whole-word match
      else if (before) score += 24;           // word-start match
      else if (idx === 0) score += 18;        // text-start match
      else score += 8;                        // substring match
    } else {
      score += fuzzyTokenScore(lower, token); // fuzzy fallback
    }
  }
  return score >= Math.max(14, Math.min(40, tokens.length * 10)) ? score : 0;
}

function tokenCoverageBoost(text: string, query: string): number {
  const tokens = query.split(/\s+/).filter((token) => token.length >= 3);
  if (tokens.length === 0) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (lower.includes(token)) hits++;
  }
  if (hits === 0) return -8;
  const ratio = hits / tokens.length;
  return Math.round(ratio * 22);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferDomain(query: string): Domain | null {
  if (/\b(docker|compose|kubectl|k8s|helm|terraform|tofu|ansible|deploy|release|service|journalctl)\b/.test(query)) return 'devops';
  if (/\b(aws|gcloud|azure|az|github|gh|vercel|netlify|wrangler|cloudflare|fly|railway)\b/.test(query)) return 'cloud';
  if (/\b(network|dns|route|ping|traceroute|tracert|netstat|ss|ipconfig|ifconfig|curl|tls|ssl|port)\b/.test(query)) return 'network';
  if (/\b(security|secret|audit|cve|vulnerab|sast|gitleaks|trivy|semgrep|hardening|checkov|hadolint)\b/.test(query)) return 'security';
  if (/\b(database|postgres|psql|mysql|sqlite|redis|mongo|mongodb)\b/.test(query)) return 'database';
  if (/\b(logs?|observability|journal|eventlog|dmesg)\b/.test(query)) return 'observability';
  if (/\b(android|ios|flutter|expo|react-native|adb|simctl)\b/.test(query)) return 'mobile';
  if (/\b(ai|llm|ollama|model)\b/.test(query)) return 'ai';
  if (/\b(git|npm|node|python|pip|cargo|go|composer|php|build|test|lint|dev)\b/.test(query)) return 'software';
  if (/\b(files?|process|where|which|version|pwd|whoami|system)\b/.test(query)) return 'system';
  return null;
}

type CliIntentMode = 'diagnose' | 'verify' | 'mutate' | 'discover' | null;

function inferCliIntentMode(blob: string): CliIntentMode {
  const lower = blob.toLowerCase().trim();
  if (!lower) return null;
  if (/\b(broken|failing|fail|failure|errors?|crash|cannot|can't|cant|won'?t|wont|doesn'?t work|doesnt work|doesn'?t run|hang|stuck|timeout|debug|traceback|stack trace)\b/.test(lower)) {
    return 'diagnose';
  }
  if (/\b(uninstall|reinstall|\brm\s+-rf\b|prune|purge|nuke\s+|drop\s+database|clean\s+install)\b/.test(lower)
    || /\b(install|add \S|remove \S)\b/.test(lower)) {
    return 'mutate';
  }
  if (/\b(build|compile|bundle|typecheck|\btsc\b|testing?\b|\btest\b|lint|fmt|format|verify|validate|audit|coverage|clippy|\bvet\b)\b/.test(lower)) {
    return 'verify';
  }
  if (/\b(list|show|status|which|where|whoami|version|logs?|watch|tail|head|describe)\b/.test(lower)) {
    return 'discover';
  }
  return null;
}

function intentModeScoreBoost(mode: CliIntentMode, cmd: string, description: string): number {
  if (!mode) return 0;
  const blob = `${cmd} ${description}`.toLowerCase();
  switch (mode) {
    case 'diagnose':
      if (/\b(log|logs|status|describe|inspect|diff|doctor|events|journal|trace|verbose|audit|errors?|dmesg|tail)\b/.test(blob)) return 16;
      return 0;
    case 'verify':
      if (/\b(test|lint|check|validate|audit|fmt|typecheck|build|coverage|clippy|vet|fmt)\b/.test(blob)) return 16;
      return 0;
    case 'mutate':
      if (/\b(install|uninstall|add |remove |prune|clean |compose up|compose down|apply|destroy|migrate)\b/.test(blob)) return 12;
      return 0;
    case 'discover':
      if (/\b(list|ls\b|status|show|get |describe|version|whoami|branch|remote|conninfo|ping)\b/.test(blob)) return 12;
      return 0;
    default:
      return 0;
  }
}

function isServerIncidentIntent(blob: string): boolean {
  return /\b(server|service|api|backend|frontend|nginx|apache|worker|daemon|unreachable|down|latency|timeout|500|502|503|504|connection refused)\b/.test(blob);
}

type RuntimeProbeTarget = 'python' | 'node' | 'docker' | 'git' | 'java' | 'rust' | null;

function inferRuntimeProbeTarget(blob: string): RuntimeProbeTarget {
  const b = blob.toLowerCase();
  const wantsRuntimeHelp =
    /\b(install|get|setup|set up|do i have|which|version|path|not found|not recognized|missing)\b/.test(b)
    || fuzzyTokenMatch(b, ['install', 'setup', 'version', 'which', 'path', 'missing', 'recognized']);
  if (!wantsRuntimeHelp) return null;
  if (/\b(python|py)\b/.test(b) || fuzzyTokenMatch(b, ['python', 'py'])) return 'python';
  if (/\b(node|npm)\b/.test(b) || fuzzyTokenMatch(b, ['node', 'npm'])) return 'node';
  if (/\b(docker|compose)\b/.test(b) || fuzzyTokenMatch(b, ['docker', 'compose'])) return 'docker';
  if (/\bgit\b/.test(b) || fuzzyTokenMatch(b, ['git'])) return 'git';
  if (/\b(java|jdk|javac)\b/.test(b) || fuzzyTokenMatch(b, ['java', 'jdk', 'javac'])) return 'java';
  if (/\b(rust|rustc|cargo)\b/.test(b) || fuzzyTokenMatch(b, ['rust', 'rustc', 'cargo'])) return 'rust';
  return null;
}

function runtimeProbeBoost(target: RuntimeProbeTarget, command: string): number {
  if (!target) return 0;
  const c = command.toLowerCase();
  const targetMatch =
    (target === 'python' && /\b(python|py)\b/.test(c))
    || (target === 'node' && /\b(node|npm)\b/.test(c))
    || (target === 'docker' && /\bdocker\b/.test(c))
    || (target === 'git' && /\bgit\b/.test(c))
    || (target === 'java' && /\b(java|javac|jdk)\b/.test(c))
    || (target === 'rust' && /\b(rust|rustc|cargo)\b/.test(c));
  if (!targetMatch) {
    if (/\binstall\b/.test(c)) return -36;
    return 0;
  }
  const probe = /\b(where|which|command -v|--version|-v\b|version|py -0|py -v|status)\b/.test(c);
  const installish = /\b(install|setup|uninstall|upgrade|update)\b/.test(c);
  const destructive = /\b(remove|delete|destroy|drop|prune)\b/.test(c);
  if (probe) return 46;
  if (installish) return -120;
  if (destructive) return -36;
  return 8;
}

function runtimeTargetMismatchPenalty(target: RuntimeProbeTarget, command: string): number {
  if (!target) return 0;
  const c = command.toLowerCase();
  const installish = /\b(install|setup|uninstall|upgrade|update|add)\b/.test(c);
  if (!installish) return 0;
  if (commandMentionsRuntimeTarget(target, c)) return 0;
  if (isReadOnlyCommand(c)) return 0;
  return TOP_TIER ? 72 : ADVANCED_TIER ? 56 : 40;
}

function commandMentionsRuntimeTarget(target: RuntimeProbeTarget, lowerCommand: string): boolean {
  if (target === 'python') return /\b(python|py|pip|pytest)\b/.test(lowerCommand);
  if (target === 'node') return /\b(node|npm|pnpm|yarn|bun)\b/.test(lowerCommand);
  if (target === 'docker') return /\b(docker|compose|container)\b/.test(lowerCommand);
  if (target === 'git') return /\bgit\b/.test(lowerCommand);
  if (target === 'java') return /\b(java|javac|jdk|mvn|gradle)\b/.test(lowerCommand);
  if (target === 'rust') return /\b(rust|rustc|cargo)\b/.test(lowerCommand);
  return false;
}

function commandAvailabilityBoost(command: string, availableBins: Set<string>): number {
  const binary = commandPrimaryBinary(command);
  if (!binary) return 0;
  if (SHELL_BUILTINS.has(binary)) return 3;
  return availableBins.has(binary) ? (TOP_TIER ? 14 : ADVANCED_TIER ? 11 : 8) : 0;
}

function commandPrimaryBinary(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let token = tokens[0].replace(/^['"]|['"]$/g, '');
  if (token === 'sudo' || token === 'env' || token === 'time') token = (tokens[1] || '').replace(/^['"]|['"]$/g, '');
  if (!token) return null;
  token = token.replace(/\\/g, '/');
  token = path.basename(token).toLowerCase();
  token = token.replace(/\.(cmd|exe|bat|ps1|com|sh)$/i, '');
  return token || null;
}

function fuzzyTokenMatch(blob: string, candidates: string[]): boolean {
  const tokens = blob.split(/[^a-z0-9.+#-]+/).filter((token) => token.length >= 2);
  for (const token of tokens) {
    for (const candidate of candidates) {
      const threshold = Math.max(0.72, typoSimilarityThreshold(candidate) - 0.04);
      if (stringSimilarity(token, candidate) >= threshold) return true;
    }
  }
  return false;
}

function serverIncidentStageBoost(serverIncident: boolean, command: string): number {
  if (!serverIncident) return 0;
  const cmd = command.toLowerCase();
  if (/\b(get-process|tasklist|ps aux|systemctl status|docker ps|docker compose ps|kubectl get pods|pm2 status)\b/.test(cmd)) return 28;
  if (/\b(log|logs|journalctl|tail|kubectl logs|docker logs|compose logs|eventlog|dmesg)\b/.test(cmd)) return 24;
  if (/\b(config|validate|lint|describe|inspect|show)\b/.test(cmd)) return 20;
  if (/\b(netstat|ss |ss -|lsof|test-netconnection|nc -v|curl -i|curl -v|ping|traceroute|tracert)\b/.test(cmd)) return 16;
  if (/\b(whoami|id|ls -l|icacls|chmod|chown)\b/.test(cmd)) return 12;
  if (/\b(install|npm ls|pip check|cargo audit|go mod|composer install)\b/.test(cmd)) return 10;
  if (/\b(version|--version|runtime|node -v|python --version|java -version)\b/.test(cmd)) return 8;
  return 0;
}

function incidentDomainPenalty(serverIncident: boolean, domain: Domain): number {
  if (!serverIncident) return 0;
  return (domain === 'devops' || domain === 'observability' || domain === 'network' || domain === 'system') ? 0 : 18;
}

function commandRiskPenalty(
  command: string,
  mode: CliIntentMode,
  lowSignalQuery: boolean,
  serverIncident: boolean,
  queryTokens: string[],
): number {
  let penalty = 0;
  if (isPotentiallyDestructive(command)) {
    if (mode === 'mutate') penalty += lowSignalQuery ? 8 : 5;
    else if (mode === 'verify' || mode === 'diagnose' || mode === 'discover') penalty += lowSignalQuery ? 34 : 24;
    else penalty += lowSignalQuery ? 30 : 20;
  }
  if (serverIncident && !isReadOnlyCommand(command)) penalty += 14;
  penalty += queryTemplatePenalty(command, queryTokens);
  return penalty;
}

function isPotentiallyDestructive(command: string): boolean {
  const c = command.toLowerCase();
  return /\b(rm\s+-rf|del\s+\/[sqf]|remove-item\b.*-recurse|git reset --hard|git clean -fd|drop\s+database|truncate\s+table|terraform destroy|helm uninstall|kubectl delete|docker system prune|docker image prune|npm uninstall|pip uninstall|cargo clean)\b/.test(c);
}

function isReadOnlyCommand(command: string): boolean {
  const c = command.toLowerCase();
  return /\b(status|list|show|get |describe|inspect|which|where|whoami|version|check|validate|lint|test|logs?|tail|diff|plan|doctor|ping|conninfo|dry-run)\b/.test(c);
}

function queryTemplatePenalty(command: string, queryTokens: string[]): number {
  const cmd = command.toLowerCase();
  let penalty = 0;
  if (/\b(example\.com|playbook\.yml|tfplan|database\.sqlite)\b/.test(cmd)) penalty += 14;
  if (/<[^>]+>/.test(cmd) || /\*\.(ya?ml|json|log)\b/.test(cmd)) penalty += 8;
  if (queryTokens.some((token) => token.length >= 3 && cmd.includes(token))) penalty = Math.max(0, penalty - 8);
  return penalty;
}

function memorySignalBoost(signal: string, queryTokens: string[]): number {
  if (!signal) return 0;
  const blob = signal.toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (token.length < 3) continue;
    if (blob.includes(token)) hits++;
  }
  if (hits === 0) return 0;
  return Math.min(18, hits * 5 + 3);
}

function memoryFailurePenalty(successes: number, failures: number, runs: number, mode: CliIntentMode): number {
  if (runs < 3) return 0;
  const rate = runs > 0 ? successes / runs : 0.5;
  if (rate >= 0.45) return 0;
  if (mode === 'diagnose') return Math.round((0.45 - rate) * 12);
  return Math.round((0.45 - rate) * 20) + (failures > successes ? 6 : 0);
}

function commandCategoryLabel(entry: CommandKnowledge): string {
  const orderedTags = ['diagnose', 'doctor', 'status', 'logs', 'verify', 'test', 'lint', 'build', 'install', 'deploy', 'security', 'network', 'database'];
  const tag = orderedTags.find((t) => entry.tags.some((x) => x.toLowerCase() === t));
  return tag ? `${entry.domain}:${tag}` : entry.domain;
}

function workspaceRelCwd(cwd: string): string {
  const rel = path.relative(PROJECT_ROOT, path.resolve(cwd));
  if (!rel) return '.';
  return rel.split(path.sep).join('/');
}

function memoryCwdAffinity(memCwd: string, currentRel: string): number {
  const m = memCwd.replace(/\\/g, '/');
  const c = currentRel.replace(/\\/g, '/');
  if (m === c) return 1;
  if (m === '.') return 0.55;
  if (c === '.') return 0.45;
  if (c.startsWith(`${m}/`) || m.startsWith(`${c}/`)) return 0.72;
  return 0.18;
}

let _lastExpandQuery = '';
let _lastExpandResult = '';

function expandQuery(query: string): string {
  if (query === _lastExpandQuery) return _lastExpandResult;
  _lastExpandResult = expandQueryInner(query);
  _lastExpandQuery = query;
  return _lastExpandResult;
}

function expandQueryInner(query: string): string {
  const tokens = query.split(/\s+/).filter(Boolean);
  const additions: string[] = [];
  const knownTerms = getKnownQueryTerms();
  for (const token of tokens) {
    const directAliases = QUERY_ALIASES[token] || [];
    additions.push(...directAliases);
    if (directAliases.length === 0) {
      for (const [alias, values] of Object.entries(QUERY_ALIASES)) {
        if (alias !== token && stringSimilarity(token, alias) >= 0.67) {
          additions.push(alias, ...values);
        }
      }
    }
    if (token.length >= 3 && directAliases.length === 0) {
      const nearTerms = knownTerms
        .map((term) => ({ term, similarity: stringSimilarity(token, term) }))
        .filter((item) =>
          item.term !== token
          && item.similarity >= typoSimilarityThreshold(token)
          && !(item.term.startsWith(token) && item.term.length - token.length >= 4)
        )
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3)
        .map((item) => item.term);
      additions.push(...nearTerms);
    }
  }
  const phraseAliases: Array<[RegExp, string]> = [
    [/\bsecret\s+scan\b/, 'gitleaks secrets security redact'],
    [/\bvuln(erability)?\s+scan\b/, 'trivy osv grype cve audit'],
    [/\bprod\s+logs?\b/, 'logs status cloud deploy'],
    [/\btype\s+check\b/, 'typecheck tsc mypy pyright'],
    [/\bdocker\s+logs?\b/, 'docker compose logs container'],
    [/\bkube\s+logs?\b|\bk8s\s+logs?\b/, 'kubectl logs kubernetes pod'],
    [/\bdb\s+status\b/, 'database health ping ready'],
    [/\b(won'?t|wont|doesn'?t|doesnt)\s+(build|compile|run|start|work)\b/, 'build test lint typecheck logs diagnose'],
    [/\bcompile\s+error\b|\bsyntax\s+error\b/, 'lint typecheck tsc eslint build'],
    [/\bport\s+in\s+use\b|\bEADDRINUSE\b/, 'netstat ss lsof process listeners kill'],
    [/\bclean\s+install\b|\bfresh\s+deps?\b|\bnode_modules\b.*\b(deleted|delete|rm)\b/, 'install ci npm pnpm'],
    [/\bpeer\s+dep(endency)?\b/, 'npm ls pnpm why install'],
    [/\bflaky\s+test\b/, 'test vitest jest retry'],
    [/\bcicd\b|\bpipeline\b|\bgithub\s+actions\b/, 'gh run actions ci workflow'],
    [/\boffline\b|\blocal[-\s]?first\b/, 'status version diagnose logs local'],
    [/\binstall\s+(python|node|docker|git|java|jdk|rust)\b/, 'where which version path runtime'],
    [/\bserver\s+(down|error|failing|crash|issue)\b|\bservice\s+(down|error|failing|issue)\b/, 'status logs config netstat port dependency runtime'],
    [/\bcommand\s+not\s+found\b|\bnot\s+recognized\b/, 'where which path install runtime'],
    [/\bpermission\s+denied\b|\beperm\b|\beacces\b/, 'permissions ownership whoami icacls chmod'],
    [/\bconnection\s+refused\b|\bconnection\s+reset\b/, 'port netstat ss curl logs status'],
    [/\bslow\b|\blatency\b|\btimeout\b/, 'ping traceroute curl dns logs status'],
  ];
  for (const [pattern, alias] of phraseAliases) {
    if (pattern.test(query)) additions.push(alias);
  }
  return [...tokens, ...additions.flatMap((item) => item.split(/\s+/))].join(' ');
}

function getKnownQueryTerms(): string[] {
  if (cachedKnownTerms) return cachedKnownTerms;
  const terms = new Set<string>();
  for (const entry of ALL_SEED_COMMANDS) {
    const text = `${entry.command} ${entry.domain} ${entry.tags.join(' ')} ${entry.description}`;
    for (const token of text.toLowerCase().split(/[^a-z0-9.+#-]+/)) {
      if (token.length >= 3 && token.length <= 24) terms.add(token);
    }
  }
  for (const [alias, values] of Object.entries(QUERY_ALIASES)) {
    if (alias.length >= 3) terms.add(alias);
    for (const value of values) {
      for (const token of value.toLowerCase().split(/[^a-z0-9.+#-]+/)) {
        if (token.length >= 3 && token.length <= 24) terms.add(token);
      }
    }
  }
  cachedKnownTerms = [...terms];
  return cachedKnownTerms;
}

function typoSimilarityThreshold(token: string): number {
  if (token.length <= 4) return 0.74;
  if (token.length <= 7) return 0.64;
  return 0.62;
}

function fuzzyTokenScore(text: string, token: string): number {
  if (token.length < 3) return 0;
  const compactText = text.replace(/[^a-z0-9]/g, '');
  const compactToken = token.replace(/[^a-z0-9]/g, '');
  if (!compactToken) return 0;
  if (compactText.includes(compactToken)) return 10;

  let ti = 0;
  let streak = 0;
  let bestStreak = 0;
  for (const ch of compactToken) {
    const found = compactText.indexOf(ch, ti);
    if (found < 0) return 0;
    streak = found === ti ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak);
    ti = found + 1;
  }
  return compactToken.length >= 4 ? Math.min(12, 4 + bestStreak * 2) : 0;
}

function normalizeComparableCommand(command: string): string {
  return command.toLowerCase().replace(/\.(cmd|exe|ps1|sh)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function firstTokenSimilarity(a: string, b: string): number {
  return stringSimilarity(a.trim().split(/\s+/, 1)[0] || '', b.trim().split(/\s+/, 1)[0] || '');
}

function commandSimilarity(a: string, b: string): number {
  const aTokens = normalizeComparableCommand(a).split(/\s+/).filter(Boolean);
  const bTokens = normalizeComparableCommand(b).split(/\s+/).filter(Boolean);
  if (!aTokens.length || !bTokens.length) return 0;

  let total = 0;
  for (const token of aTokens) {
    total += Math.max(...bTokens.map((candidate) => stringSimilarity(token, candidate)));
  }
  const tokenSimilarity = total / aTokens.length;
  const joinedSimilarity = stringSimilarity(aTokens.join(' '), bTokens.join(' '));
  return tokenSimilarity * 0.65 + joinedSimilarity * 0.35;
}

function stringSimilarity(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (right.includes(left) || left.includes(right)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (isSingleAdjacentTransposition(left, right)) return 0.9;

  const distance = levenshtein(left, right);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}

function isSingleAdjacentTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diffs.push(i);
  }
  return diffs.length === 2
    && diffs[1] === diffs[0] + 1
    && a[diffs[0]] === b[diffs[1]]
    && a[diffs[1]] === b[diffs[0]];
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

async function projectCommandKnowledge(cwd: string): Promise<CommandKnowledge[]> {
  const [pkg, manager, files, localBins] = await Promise.all([
    readJson(path.join(cwd, 'package.json')),
    detectProjectManager(cwd),
    nearbyProjectFiles(cwd),
    Promise.resolve(getLocalFirstPathEntries(cwd).map((entry) => path.basename(entry))),
  ]);
  const out: CommandKnowledge[] = [];
  const add = (command: string, tags: string[], description: string, domain: Domain = 'software') => {
    out.push({ command, domain, tags: ['project', manager, ...tags], description });
  };

  const runPrefix = scriptRunPrefix(manager);
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts as Record<string, string> : {};
  for (const [name, body] of Object.entries(scripts)) {
    add(`${runPrefix} ${name}`, [name, ...scriptTags(name, body)], `package script: ${name}`);
    const short = packageScriptShortcut(manager, name);
    if (short) add(short, [name, ...scriptTags(name, body)], `package shortcut: ${name}`);
  }

  if (pkg) {
    const deps = dependencyNames(pkg);
    add(projectInstallCommand(manager), ['install', 'dependencies', 'deps'], `install dependencies with ${manager}`);
    if (!scripts.test) add(manager === 'npm' ? 'npm test' : `${runPrefix} test`, ['test'], 'default project test command');
    if (deps.has('typescript')) {
      const tsconfig = files.includes('config/tsconfig.json') ? 'config/tsconfig.json' : files.includes('tsconfig.json') ? 'tsconfig.json' : '';
      add(tsconfig ? `npx tsc -p ${tsconfig} --noEmit` : 'npx tsc --noEmit', ['typescript', 'typecheck', 'tsc'], 'project TypeScript type-check');
    }
    if (deps.has('eslint')) add('npx eslint .', ['eslint', 'lint', 'javascript'], 'project ESLint lint');
    if (deps.has('prettier')) add('npx prettier . --check', ['prettier', 'format', 'check'], 'project Prettier check');
    if (deps.has('vitest')) add('npx vitest run', ['vitest', 'test'], 'project Vitest tests');
    if (deps.has('jest')) add('npx jest --runInBand', ['jest', 'test'], 'project Jest tests');
    if (deps.has('@playwright/test')) add('npx playwright test', ['playwright', 'e2e', 'browser', 'test'], 'project Playwright tests');
    if (deps.has('ts-node')) add('npx ts-node --esm src/index.ts', ['typescript', 'dev', 'run'], 'run project TypeScript entry with ts-node');
    if (deps.has('commander')) add('node dist/index.js --help', ['cli', 'help', 'dist'], 'run built CLI help');
  }

  if (files.includes('Dockerfile')) add('docker build -t local-app .', ['docker', 'build', 'image'], 'project Dockerfile build', 'devops');
  if (files.some((file) => /compose\.ya?ml$|docker-compose\.ya?ml$/.test(file))) {
    add('docker compose config', ['docker', 'compose', 'validate'], 'validate project Compose config', 'devops');
    add('docker compose up -d', ['docker', 'compose', 'start'], 'start project Compose services', 'devops');
    add('docker compose logs --tail=100', ['docker', 'compose', 'logs'], 'tail project Compose logs', 'devops');
  }
  if (files.some((file) => /(^|\/)(main|variables|outputs)\.tf$|\.tfvars$/.test(file))) {
    add('terraform validate', ['terraform', 'validate', 'iac'], 'validate project Terraform', 'devops');
    add('terraform plan', ['terraform', 'plan', 'iac'], 'plan project Terraform', 'devops');
  }
  if (files.includes('go.mod')) add('go test ./...', ['go', 'test'], 'project Go tests');
  if (files.includes('Cargo.toml')) add('cargo test', ['rust', 'test'], 'project Rust tests');
  if (files.includes('pyproject.toml')) add('python -m pytest', ['python', 'test'], 'project Python tests');
  if (files.includes('requirements.txt')) add('pip install -r requirements.txt', ['python', 'install', 'requirements'], 'install project Python requirements');
  if (files.includes('composer.json')) add('composer install', ['php', 'install', 'dependencies'], 'install project PHP dependencies');
  if (files.includes('artisan')) add('php artisan test', ['php', 'laravel', 'test'], 'run Laravel tests');
  if (localBins.includes('.bin')) add('npx --no-install', ['local', 'bin'], 'run project-local npm binary');

  return dedupeKnowledge(out);
}

async function readJson(file: string): Promise<any | null> {
  try {
    return await fs.readJSON(file);
  } catch {
    return null;
  }
}

async function detectProjectManager(cwd: string): Promise<string> {
  const exists = async (name: string) => fs.pathExists(path.join(cwd, name));
  if (await exists('pnpm-lock.yaml')) return 'pnpm';
  if (await exists('yarn.lock')) return 'yarn';
  if (await exists('bun.lockb')) return 'bun';
  if (await exists('package-lock.json') || await exists('package.json')) return 'npm';
  if (await exists('poetry.lock')) return 'poetry';
  if (await exists('uv.lock')) return 'uv';
  return 'npm';
}

async function nearbyProjectFiles(cwd: string): Promise<string[]> {
  const names = [
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb',
    'tsconfig.json', 'config/tsconfig.json',
    'pyproject.toml', 'requirements.txt', 'poetry.lock', 'uv.lock',
    'Cargo.toml', 'go.mod', 'composer.json', 'artisan',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml',
    'main.tf', 'variables.tf', 'outputs.tf', 'terraform.tfvars',
  ];
  const found: string[] = [];
  for (const name of names) {
    if (await fs.pathExists(path.join(cwd, name))) found.push(name);
  }
  return found;
}

function scriptRunPrefix(manager: string): string {
  if (manager === 'pnpm') return 'pnpm run';
  if (manager === 'yarn') return 'yarn';
  if (manager === 'bun') return 'bun run';
  return 'npm run';
}

function projectInstallCommand(manager: string): string {
  if (manager === 'pnpm') return 'pnpm install';
  if (manager === 'yarn') return 'yarn install';
  if (manager === 'bun') return 'bun install';
  return 'npm install';
}

function packageScriptShortcut(manager: string, name: string): string | null {
  if (manager !== 'npm') return null;
  if (['test', 'start', 'stop', 'restart'].includes(name)) return `npm ${name}`;
  return null;
}

function dependencyNames(pkg: any): Set<string> {
  return new Set(Object.keys({
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
    ...(pkg?.optionalDependencies || {}),
    ...(pkg?.peerDependencies || {}),
  }));
}

function scriptTags(name: string, body: string): string[] {
  const text = `${name} ${body}`.toLowerCase();
  const tags = new Set<string>();
  for (const key of ['build', 'test', 'lint', 'dev', 'start', 'serve', 'typecheck', 'deploy', 'release', 'format', 'storybook', 'playwright', 'vitest', 'jest', 'eslint', 'prettier', 'tsc']) {
    if (text.includes(key)) tags.add(key);
  }
  return [...tags];
}

function dedupeKnowledge(items: CommandKnowledge[]): CommandKnowledge[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.command)) return false;
    seen.add(item.command);
    return true;
  });
}
