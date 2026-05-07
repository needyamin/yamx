const DIRECT_COMMANDS = new Set([
  // identity/env/process
  'whoami', 'hostname', 'id', 'uname', 'ver', 'date', 'time', 'where', 'which', 'whereis',
  'env', 'printenv', 'set', 'sleep', 'timeout', 'watch',

  // filesystem inspection
  'pwd', 'cd', 'pushd', 'popd', 'ls', 'll', 'la', 'dir', 'tree', 'echo', 'cat', 'type',
  'head', 'tail', 'more', 'less', 'find', 'findstr', 'grep', 'egrep', 'fgrep', 'rg',
  'sed', 'awk', 'wc', 'sort', 'uniq', 'cut', 'tr', 'tee', 'xargs', 'realpath', 'readlink',
  'stat', 'file', 'du', 'df', 'touch', 'mkdir', 'rmdir', 'cp', 'copy', 'xcopy', 'robocopy',
  'mv', 'move', 'ren', 'rename', 'rm', 'del', 'erase',

  // system/network diagnostics
  'ipconfig', 'ifconfig', 'ping', 'tracert', 'traceroute', 'nslookup', 'netstat', 'tasklist',
  'taskkill', 'ps', 'top', 'htop', 'btop', 'kill', 'killall', 'pkill', 'pgrep', 'lsof', 'ss',
  'ip', 'route', 'arp', 'dig', 'host', 'nmap', 'nc', 'netcat',
  'curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'telnet', 'rsync',

  // macOS / Linux package and system tools
  'brew', 'port', 'softwareupdate', 'sw_vers', 'open', 'launchctl', 'defaults', 'xcodebuild',
  'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk', 'snap', 'flatpak',
  'systemctl', 'service', 'journalctl', 'dmesg', 'loginctl', 'crontab',

  // Windows shell/tools
  'cls', 'chdir', 'md', 'rd', 'attrib', 'icacls', 'reg', 'sc', 'wmic', 'winget', 'choco',
  'scoop', 'msbuild', 'devenv', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'wsl', 'wsl.exe',

  // dev tools and package managers
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'corepack',
  'vite', 'webpack', 'rollup', 'parcel', 'turbo', 'nx', 'next', 'nuxt', 'astro', 'remix',
  'svelte-kit', 'storybook', 'ts-node', 'tsx',
  'git', 'python', 'python3', 'py', 'pip', 'pip3', 'uv', 'poetry',
  'pytest', 'ruff', 'black', 'mypy', 'pyright', 'tox', 'pipenv', 'conda', 'jupyter', 'ipython',
  'cargo', 'rustup', 'rustc', 'rustfmt', 'clippy', 'go', 'gofmt', 'goimports',
  'java', 'javac', 'mvn', 'mvnw', 'gradle', 'gradlew',
  'dotnet', 'php', 'composer', 'artisan', 'pest', 'phpunit', 'symfony',
  'ruby', 'gem', 'bundle', 'bundler', 'rake', 'rails',
  'make', 'cmake', 'ninja', 'meson', 'bazel', 'buck', 'gcc', 'g++', 'clang', 'clang++',
  'tsc', 'eslint', 'prettier', 'biome', 'vitest', 'jest', 'mocha', 'playwright', 'cypress',
  'prisma', 'drizzle-kit', 'sequelize', 'knex', 'typeorm',

  // mobile / desktop / native
  'expo', 'react-native', 'flutter', 'dart', 'adb', 'emulator', 'pod', 'fastlane',
  'electron', 'tauri', 'cargo-tauri',

  // containers, infra, cloud
  'docker', 'podman', 'docker-compose', 'kubectl', 'helm', 'terraform', 'tofu', 'ansible',
  'vagrant', 'aws', 'az', 'gcloud', 'gh', 'vercel', 'netlify', 'flyctl', 'wrangler', 'firebase',
  'supabase', 'railway', 'pulumi', 'serverless', 'sam',

  // databases and services
  'psql', 'mysql', 'mariadb', 'sqlite3', 'redis-cli', 'mongosh', 'mongo', 'createdb', 'dropdb',
  'pg_dump', 'pg_restore', 'mysqldump', 'dockerize',

  // AI/local model tooling
  'ollama', 'llama', 'llama-cli', 'llama-server', 'huggingface-cli',

  // shells
  'cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'fish',
]);

const POWERSHELL_VERBS = [
  'Get', 'Set', 'New', 'Remove', 'Copy', 'Move', 'Rename', 'Test', 'Start', 'Stop', 'Restart',
  'Invoke', 'Select', 'Where', 'ForEach', 'Out', 'Write', 'Read', 'Clear', 'Import', 'Export',
  'ConvertTo', 'ConvertFrom', 'Push', 'Pop', 'Join', 'Split', 'Resolve',
];

const POWERSHELL_ALIASES = new Set([
  'gci', 'ls', 'dir', 'cat', 'gc', 'sc', 'ni', 'ri', 'rm', 'cp', 'mv', 'pwd', 'cd',
  'sl', 'select', 'where', 'foreach', 'curl', 'wget', 'irm', 'iwr',
]);

const NATURAL_LANGUAGE_STARTERS = [
  'can', 'could', 'would', 'should', 'please', 'fix', 'create', 'build', 'add', 'change',
  'update', 'explain', 'why', 'how', 'what', 'analyze', 'analyse', 'review', 'implement',
  'continue', 'make',
];

const NATURAL_OBJECT_WORDS = new Set([
  'my', 'the', 'this', 'that', 'a', 'an', 'your', 'our', 'agent', 'app', 'project', 'code',
  'feature', 'bug', 'issue', 'thing', 'tools',
]);

const COMMAND_SUBCOMMAND_WORDS = new Set([
  'add', 'apply', 'build', 'check', 'clean', 'compile', 'deploy', 'dev', 'doctor', 'exec',
  'format', 'generate', 'help', 'init', 'install', 'lint', 'list', 'login', 'logout', 'migrate',
  'publish', 'run', 'serve', 'start', 'status', 'stop', 'sync', 'test', 'update', 'upgrade',
  'version', 'watch', 'create', 'destroy', 'down', 'dump', 'fix', 'info', 'logs', 'open',
  'pull', 'push', 'restore', 'restart', 'shell', 'up',
]);

export function parseDirectCommand(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const explicit = parseExplicitCommand(trimmed);
  if (explicit) return explicit;

  if (looksLikeQuestionOrTask(trimmed)) return null;
  if (looksLikePowerShellCommand(trimmed)) return trimmed;
  if (looksLikeScriptInvocation(trimmed)) return trimmed;
  if (looksLikeAssignmentCommand(trimmed)) return trimmed;
  if (looksLikeQuotedExecutable(trimmed)) return trimmed;
  if (looksLikeCompoundCommand(trimmed)) return startsWithCommand(trimmed) ? trimmed : null;
  if (startsWithCommand(trimmed)) return trimmed;
  if (looksLikeGenericCommand(trimmed)) return trimmed;

  return null;
}

function parseExplicitCommand(input: string): string | null {
  const markers = ['$ ', '> ', '!'];
  for (const marker of markers) {
    if (input.startsWith(marker)) {
      const command = input.slice(marker.length).trim();
      return command || null;
    }
  }

  const runPrefix = input.match(/^(run|exec|execute|shell|cmd):\s*(.+)$/i);
  return runPrefix?.[2]?.trim() || null;
}

function startsWithCommand(input: string): boolean {
  const [firstRaw, secondRaw] = input.split(/\s+/, 2);
  const first = baseCommandName(firstRaw);
  if (!DIRECT_COMMANDS.has(first) && !DIRECT_COMMANDS.has(commandName(firstRaw))) return false;

  if (first === 'make') {
    const second = secondRaw?.toLowerCase();
    if (!second) return true;
    return !NATURAL_OBJECT_WORDS.has(second);
  }

  return true;
}

function commandName(raw: string): string {
  return raw
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
}

function baseCommandName(raw: string): string {
  return commandName(raw).replace(/\.(exe|cmd|bat|ps1|psm1|sh|bash|zsh|fish)$/i, '');
}

function looksLikeQuestionOrTask(input: string): boolean {
  const lower = input.toLowerCase();
  if (lower.endsWith('?')) return true;
  const [first, second] = lower.split(/\s+/, 2);
  if (!NATURAL_LANGUAGE_STARTERS.includes(first)) return false;
  if (first === 'make' && second && !NATURAL_OBJECT_WORDS.has(second)) return false;
  return true;
}

function looksLikeScriptInvocation(input: string): boolean {
  return /^\s*(\.\/|\.\\|\/|~\/|[a-z]:\\).+\.(sh|bash|zsh|fish|ps1|psm1|cmd|bat|exe|com|js|mjs|cjs|ts|py|rb|php|pl|go|jar)(\s|$)/i.test(input);
}

function looksLikeAssignmentCommand(input: string): boolean {
  return /^\s*([A-Za-z_][A-Za-z0-9_]*=.+\s+)?[A-Za-z_][A-Za-z0-9_]*=/.test(input)
    || /^\s*\$env:[A-Za-z_][A-Za-z0-9_]*\s*=/.test(input);
}

function looksLikeCompoundCommand(input: string): boolean {
  return /\s(&&|\|\||;|\|)\s/.test(input)
    || /(^|\s)(2>|1>|>>|<)\s*\S+/.test(input);
}

function looksLikeGenericCommand(input: string): boolean {
  const parts = input.split(/\s+/);
  if (parts.length < 2) return false;

  const firstRaw = parts[0].replace(/^["']|["']$/g, '');
  const first = commandName(firstRaw);
  const base = baseCommandName(firstRaw);
  const second = parts[1]?.toLowerCase() || '';

  if (NATURAL_LANGUAGE_STARTERS.includes(base) || NATURAL_OBJECT_WORDS.has(base)) return false;
  if (!/^[a-z0-9_.:@/+\\-]+$/i.test(firstRaw)) return false;

  const executableLike =
    /\.(exe|cmd|bat|ps1|psm1|sh|bash|zsh|fish|py|js|mjs|cjs|ts|rb|php|pl|jar|com)$/i.test(first)
    || first.includes('/')
    || first.includes('\\')
    || first.includes(':');

  const argumentLike =
    /^-{1,2}[a-z0-9][\w-]*/i.test(second)
    || COMMAND_SUBCOMMAND_WORDS.has(second)
    || /^[./~]/.test(second)
    || /^[a-z]:\\/i.test(second)
    || /^[\w./-]+\.(json|toml|yaml|yml|md|txt|ts|tsx|js|jsx|py|go|rs|php|rb|java|cs|sln|csproj|vcxproj)$/i.test(second)
    || /^[\w:-]+=[^\s]+/.test(second);

  return executableLike || argumentLike;
}

function looksLikePowerShellCommand(input: string): boolean {
  const first = input.split(/\s+/, 1)[0].replace(/^["']|["']$/g, '');
  if (POWERSHELL_ALIASES.has(first.toLowerCase()) && /\s-(LiteralPath|Recurse|Force|Filter|Path|Name|Value|InputObject|Pattern)\b/i.test(input)) {
    return true;
  }
  return POWERSHELL_VERBS.some((verb) => new RegExp(`^${verb}-[A-Za-z]+\\b`, 'i').test(first));
}

function looksLikeQuotedExecutable(input: string): boolean {
  return /^"[^"]+\.(exe|cmd|bat|ps1|sh|py|js)"(\s|$)/i.test(input)
    || /^'[^']+\.(exe|cmd|bat|ps1|sh|py|js)'(\s|$)/i.test(input);
}
