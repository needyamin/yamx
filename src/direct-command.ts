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
  'taskkill', 'ps', 'top', 'htop', 'kill', 'killall', 'lsof', 'ss', 'ip', 'route', 'arp',
  'curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'telnet',

  // macOS / Linux package and system tools
  'brew', 'port', 'softwareupdate', 'sw_vers', 'open', 'launchctl', 'defaults', 'xcodebuild',
  'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk', 'snap', 'flatpak',
  'systemctl', 'service', 'journalctl', 'dmesg',

  // Windows shell/tools
  'cls', 'chdir', 'md', 'rd', 'attrib', 'icacls', 'reg', 'sc', 'wmic', 'winget', 'choco',
  'scoop', 'msbuild', 'devenv',

  // dev tools and package managers
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno',
  'git', 'python', 'python3', 'py', 'pip', 'pip3', 'uv', 'poetry',
  'pytest', 'ruff', 'black', 'mypy', 'tox', 'pipenv', 'conda',
  'cargo', 'rustup', 'rustc', 'go', 'gofmt', 'java', 'javac', 'mvn', 'gradle', 'gradlew',
  'dotnet', 'php', 'composer', 'ruby', 'gem', 'bundle', 'rails',
  'make', 'cmake', 'ninja', 'meson', 'bazel', 'buck', 'gcc', 'g++', 'clang', 'clang++',
  'tsc', 'eslint', 'prettier', 'vitest', 'jest',

  // containers, infra, cloud
  'docker', 'podman', 'docker-compose', 'kubectl', 'helm', 'terraform', 'tofu', 'ansible',
  'vagrant', 'aws', 'az', 'gcloud', 'gh',

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
  const first = commandName(firstRaw);
  if (!DIRECT_COMMANDS.has(first)) return false;

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
    .replace(/\.(exe|cmd|bat|ps1|psm1|sh|bash|zsh|fish)$/i, '')
    .toLowerCase();
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
