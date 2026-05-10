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

const DB_PATH = path.join(process.env.YAMX_HOME || path.join(PROJECT_ROOT, '.yamx'), 'command-intelligence.json');

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
};

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

  const [file, memory, project] = await Promise.all([
    readCommandIntelligenceFile(),
    getCommandMemoryRecords(cwd, 80).catch(() => []),
    projectCommandKnowledge(cwd).catch((): CommandKnowledge[] => []),
  ]);
  const suggestions = new Map<string, CommandSuggestion>();

  for (const entry of [...file.commands, ...project]) {
    if (entry.platforms?.length && !entry.platforms.includes(process.platform)) continue;
    const score = scoreKnowledge(entry, query);
    if (score <= 0) continue;
    const source = project.includes(entry) ? 'project' : 'database';
    suggestions.set(entry.command, {
      command: entry.command,
      score,
      source,
      reason: source === 'project' ? entry.description : entry.domain,
    });
  }

  for (const record of memory) {
    const baseScore = Math.max(scoreText(record.command, query), scoreText(record.command, expandQuery(query)));
    if (baseScore <= 0) continue;
    const score = baseScore + Math.min(40, record.successes * 8 + record.runs * 2) - record.failures * 3;
    const existing = suggestions.get(record.command);
    const candidate: CommandSuggestion = {
      command: record.command,
      score: score + 15,
      source: 'memory',
      reason: record.lastExit === 0 ? 'worked before' : 'seen before',
    };
    if (!existing || candidate.score > existing.score) suggestions.set(record.command, candidate);
  }

  return [...suggestions.values()]
    .sort((a, b) => b.score - a.score || a.command.localeCompare(b.command))
    .slice(0, limit);
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

function scoreKnowledge(entry: CommandKnowledge, query: string): number {
  const expandedQuery = expandQuery(query);
  const commandScore = Math.max(scoreText(entry.command, query), scoreText(entry.command, expandedQuery));
  const text = `${entry.command} ${entry.domain} ${entry.tags.join(' ')} ${entry.description}`.toLowerCase();
  const textScore = Math.max(scoreText(text, query), scoreText(text, expandedQuery));
  const domainBoost = entry.domain === inferDomain(expandedQuery) ? 28 : 0;
  const platformBoost = entry.platforms?.includes(process.platform) ? 10 : 0;
  const safetyBoost = /\b(status|list|show|check|validate|lint|test|logs?|describe|diff|dry-run|plan|version)\b/i.test(entry.command) ? 6 : 0;
  return commandScore + textScore + domainBoost + platformBoost + safetyBoost;
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
    if (lower.startsWith(token)) score += 24;
    else if (lower.includes(token)) score += 14;
    else score += fuzzyTokenScore(lower, token);
  }
  return score >= Math.max(14, Math.min(40, tokens.length * 10)) ? score : 0;
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

function expandQuery(query: string): string {
  const tokens = query.split(/\s+/).filter(Boolean);
  const additions: string[] = [];
  for (const token of tokens) {
    additions.push(...(QUERY_ALIASES[token] || []));
  }
  const phraseAliases: Array<[RegExp, string]> = [
    [/\bsecret\s+scan\b/, 'gitleaks secrets security redact'],
    [/\bvuln(erability)?\s+scan\b/, 'trivy osv grype cve audit'],
    [/\bprod\s+logs?\b/, 'logs status cloud deploy'],
    [/\btype\s+check\b/, 'typecheck tsc mypy pyright'],
    [/\bdocker\s+logs?\b/, 'docker compose logs container'],
    [/\bkube\s+logs?\b|\bk8s\s+logs?\b/, 'kubectl logs kubernetes pod'],
    [/\bdb\s+status\b/, 'database health ping ready'],
  ];
  for (const [pattern, alias] of phraseAliases) {
    if (pattern.test(query)) additions.push(alias);
  }
  return [...tokens, ...additions.flatMap((item) => item.split(/\s+/))].join(' ');
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
  }

  if (pkg) {
    add(projectInstallCommand(manager), ['install', 'dependencies', 'deps'], `install dependencies with ${manager}`);
    if (!scripts.test) add(manager === 'npm' ? 'npm test' : `${runPrefix} test`, ['test'], 'default project test command');
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
