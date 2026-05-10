import { isPseudoEnglishShellIntent } from './tools/shell.js';

const DIRECT_COMMANDS = new Set([
  // identity/env/process
  'whoami', 'hostname', 'id', 'uname', 'ver', 'date', 'time', 'where', 'which', 'whereis',
  'env', 'printenv', 'set', 'sleep', 'timeout', 'watch', 'uptime', 'who', 'users', 'last',
  'lastlog', 'w', 'tty', 'logname', 'groups', 'getent', 'nice', 'renice', 'ionice', 'chrt',
  'nohup', 'disown', 'jobs', 'fg', 'bg', 'wait', 'screen', 'tmux', 'byobu', 'zellij',

  // filesystem inspection
  'pwd', 'cd', 'pushd', 'popd', 'ls', 'll', 'la', 'dir', 'tree', 'echo', 'cat', 'type',
  'head', 'tail', 'more', 'less', 'find', 'findstr', 'grep', 'egrep', 'fgrep', 'rg', 'ag',
  'sed', 'awk', 'wc', 'sort', 'uniq', 'cut', 'tr', 'tee', 'xargs', 'realpath', 'readlink',
  'stat', 'file', 'du', 'df', 'touch', 'mkdir', 'rmdir', 'cp', 'copy', 'xcopy', 'robocopy',
  'mv', 'move', 'ren', 'rename', 'rm', 'del', 'erase', 'chmod', 'chown', 'chgrp', 'umask',
  'mount', 'umount', 'fdisk', 'parted', 'blkid', 'lsblk', 'lsof',
  'ln', 'link', 'unlink', 'install', 'mktemp', 'basename', 'dirname', 'pathchk',

  // text processing and data
  'diff', 'cmp', 'patch', 'comm', 'paste', 'fmt', 'expand', 'unexpand', 'nl', 'pr',
  'split', 'csplit', 'join', 'rev', 'shuf', 'hexdump', 'xxd', 'od', 'base64', 'base32',
  'jq', 'yq', 'xq', 'fx', 'jp', 'mlr', 'duckdb', 'csvkit', 'csvcut', 'csvgrep', 'csvlook',
  'sd', 'choose', 'htmlq',

  // archives / compression
  'tar', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', 'lzma', 'unlzma',
  'zip', 'unzip', '7z', '7za', 'rar', 'unrar', 'zstd', 'unzstd', 'compress', 'uncompress',

  // editors
  'vi', 'vim', 'nvim', 'emacs', 'emacsclient', 'nano', 'pico', 'micro', 'hx', 'kak', 'joe',
  'ed', 'code', 'codium', 'subl',

  // crypto / security / hashing
  'openssl', 'gpg', 'gpg2', 'age', 'sops', 'mkcert', 'certbot', 'htpasswd', 'pwgen', 'keytool',
  'ssh-keygen', 'ssh-keyscan', 'ssh-add', 'ssh-agent', 'ssh-copy-id',
  'shasum', 'md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'b2sum', 'cksum', 'sum',
  'gitleaks', 'trivy', 'grype', 'snyk', 'semgrep', 'codeql',

  // system inspection (cross-platform)
  'systeminfo', 'sw_vers', 'hostnamectl', 'timedatectl', 'localectl', 'lsb_release',
  'lscpu', 'lsmem', 'lsmod', 'lsusb', 'lspci', 'lsscsi', 'lshw', 'dmidecode', 'hwinfo',
  'nproc', 'arch', 'free', 'vmstat', 'iostat', 'mpstat', 'sar', 'getconf', 'ulimit',
  'driverquery', 'gpresult', 'getmac', 'powercfg', 'winsat', 'wevtutil', 'vssadmin',
  'bcdedit', 'fsutil', 'manage-bde', 'cipher', 'defrag', 'mountvol', 'shutdown', 'logoff',
  'reboot', 'halt', 'poweroff', 'systemd-analyze', 'machinectl', 'networkctl', 'resolvectl',
  'busctl', 'modprobe', 'insmod', 'rmmod', 'depmod', 'udevadm', 'udisksctl',
  'sync', 'swapon', 'swapoff', 'hdparm', 'smartctl',
  'fsck', 'e2fsck', 'btrfs', 'zfs', 'zpool', 'cryptsetup', 'losetup',
  'lvcreate', 'lvremove', 'vgcreate', 'pvcreate',

  // monitoring / benchmarking
  'atop', 'glances', 'dstat', 'collectd', 'telegraf', 'gtop', 'bottom',
  'ab', 'wrk', 'hey', 'siege', 'vegeta', 'k6', 'stress', 'stress-ng', 'fio', 'sysbench',
  'iperf', 'iperf3', 'qperf', 'speedtest', 'speedtest-cli',

  // system/network diagnostics
  'ipconfig', 'ifconfig', 'ping', 'tracert', 'traceroute', 'nslookup', 'netstat', 'tasklist',
  'taskkill', 'ps', 'top', 'htop', 'btop', 'kill', 'killall', 'pkill', 'pgrep', 'ss',
  'ip', 'route', 'arp', 'dig', 'host', 'nmap', 'nc', 'netcat', 'tcpdump', 'tshark', 'wireshark',
  'curl', 'wget', 'http', 'httpie', 'xh', 'mosh',
  'ssh', 'scp', 'sftp', 'ftp', 'telnet', 'rsync',
  'iotop', 'nethogs', 'bmon', 'iftop', 'tracepath', 'mtr', 'pathping', 'nbtstat', 'nltest',
  'quser', 'qwinsta', 'query',
  'iptables', 'ip6tables', 'ufw', 'firewall-cmd', 'fail2ban-client',
  'ethtool', 'mii-tool', 'brctl', 'bridge', 'nmcli', 'nmtui', 'iw', 'iwconfig', 'iwlist',
  'wpa_cli', 'wpa_supplicant',

  // macOS / Linux package and system tools
  'brew', 'port', 'softwareupdate', 'open', 'launchctl', 'defaults', 'xcodebuild',
  'apt', 'apt-get', 'aptitude', 'dnf', 'yum', 'pacman', 'zypper', 'apk', 'snap', 'flatpak',
  'sudo', 'doas', 'systemctl', 'service', 'journalctl', 'dmesg', 'loginctl', 'crontab',

  // Windows shell/tools
  'cls', 'chdir', 'md', 'rd', 'attrib', 'icacls', 'cacls', 'takeown', 'net', 'netsh',
  'reg', 'sc', 'wmic', 'winget', 'choco', 'scoop', 'msbuild', 'devenv',
  'chkdsk', 'sfc', 'dism', 'auditpol', 'klist', 'eventcreate', 'tzutil', 'whynot',
  'powershell.exe', 'pwsh.exe', 'cmd.exe', 'wsl', 'wsl.exe',

  // dev tools and package managers
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'corepack', 'nodemon', 'pm2', 'forever',
  'vite', 'webpack', 'rollup', 'parcel', 'turbo', 'nx', 'next', 'nuxt', 'astro', 'remix',
  'svelte-kit', 'storybook', 'ts-node', 'tsx',
  'git', 'hg', 'svn', 'jj', 'fossil', 'bzr',
  'python', 'python3', 'py', 'pip', 'pip3', 'pipx', 'uv', 'poetry',
  'pytest', 'ruff', 'black', 'mypy', 'pyright', 'tox', 'pipenv', 'conda', 'mamba',
  'jupyter', 'ipython', 'gunicorn', 'uvicorn', 'daphne', 'hypercorn', 'uwsgi',
  'cargo', 'rustup', 'rustc', 'rustfmt', 'clippy', 'go', 'gofmt', 'goimports',
  'java', 'javac', 'jar', 'jdb', 'jstack', 'jmap', 'jstat', 'jconsole', 'jcmd', 'jps',
  'javap', 'jshell', 'jpackage', 'jlink', 'jhsdb',
  'mvn', 'mvnw', 'gradle', 'gradlew',
  'dotnet', 'nuget', 'paket', 'php', 'composer', 'artisan', 'pest', 'phpunit', 'symfony',
  'ruby', 'gem', 'bundle', 'bundler', 'rake', 'rails',
  'make', 'cmake', 'ninja', 'meson', 'bazel', 'buck', 'xmake', 'scons', 'qmake', 'premake5',
  'gcc', 'g++', 'clang', 'clang++', 'clang-format', 'shellcheck', 'shfmt', 'hadolint',
  'tsc', 'eslint', 'prettier', 'biome', 'vitest', 'jest', 'mocha', 'playwright', 'cypress',
  'prisma', 'drizzle-kit', 'sequelize', 'knex', 'typeorm',
  'pre-commit', 'sonar-scanner',

  // mobile / desktop / native
  'expo', 'react-native', 'flutter', 'dart', 'adb', 'fastboot', 'sdkmanager', 'avdmanager',
  'bundletool', 'aapt', 'aapt2', 'apksigner', 'zipalign', 'emulator', 'pod', 'fastlane',
  'electron', 'tauri', 'cargo-tauri', 'carthage', 'swift', 'swiftc', 'swift-format',
  'xcrun', 'simctl', 'ios-deploy',

  // containers, infra, cloud
  'docker', 'podman', 'docker-compose', 'compose', 'docker-buildx', 'buildx',
  'buildah', 'skopeo', 'crictl', 'ctr', 'runc', 'lazydocker', 'dive',
  'kubectl', 'kubectx', 'kubens', 'kustomize', 'kubeadm', 'minikube', 'kind', 'k3s', 'k3d',
  'eksctl', 'k9s', 'krew', 'argocd', 'flux', 'fluxctl', 'skaffold', 'tilt', 'telepresence',
  'istioctl', 'linkerd', 'calicoctl', 'ciliumctl',
  'helm', 'terraform', 'tofu', 'ansible', 'ansible-playbook', 'ansible-vault', 'vagrant',
  'aws', 'az', 'gcloud', 'gh', 'glab', 'vercel', 'netlify', 'flyctl', 'fly', 'wrangler',
  'firebase', 'supabase', 'railway', 'pulumi', 'serverless', 'sam',
  'doctl', 'linode-cli', 'hcloud', 'civo', 'ibmcloud', 'oci', 'sf', 'sfdx', 'heroku',

  // databases and services
  'psql', 'pgcli', 'mycli', 'litecli', 'mysql', 'mariadb', 'sqlite3', 'redis-cli',
  'mongosh', 'mongo', 'mongoimport', 'mongoexport', 'mongodump', 'mongorestore',
  'createdb', 'dropdb', 'pg_dump', 'pg_restore', 'mysqldump', 'cqlsh', 'influx', 'dockerize',

  // AI/local model tooling
  'ollama', 'llama', 'llama-cli', 'llama-server', 'huggingface-cli', 'transformers-cli',
  'litellm', 'vllm', 'ray',

  // audio / video / image
  'ffmpeg', 'ffprobe', 'ffplay', 'mpv', 'mplayer', 'vlc', 'sox',
  'convert', 'magick', 'mogrify', 'identify', 'composite', 'montage',
  'exiftool', 'jpegtran', 'pngcrush', 'optipng', 'jpegoptim', 'gifsicle',

  // crypto / blockchain dev
  'geth', 'forge', 'anvil', 'cast', 'hardhat', 'anchor', 'solana', 'bitcoin-cli',

  // docs / help
  'man', 'info', 'apropos', 'whatis', 'tldr',

  // modern CLI replacements
  'bat', 'exa', 'eza', 'fd', 'dust', 'duf', 'broot', 'fzf', 'zoxide', 'lsd',
  'delta', 'difftastic', 'atuin', 'starship', 'mcfly',

  // fun / utility
  'cowsay', 'fortune', 'sl', 'lolcat', 'neofetch', 'pfetch', 'fastfetch', 'screenfetch',
  'archey', 'figlet', 'toilet', 'banner', 'bc', 'dc', 'expr', 'factor', 'seq',

  // shells
  'cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'fish', 'nu', 'xonsh', 'elvish',
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
  'continue', 'make', 'write', 'show', 'tell', 'describe', 'help', 'give',
  'improve', 'enhance', 'optimize', 'refactor', 'debug', 'troubleshoot', 'investigate',
  'configure', 'setup', 'generate', 'migrate', 'summarize',
  'is', 'are', 'does', 'did', 'will', 'shall', 'may', 'might', 'want',
  'need', 'try', 'let', 'suggest', 'recommend', 'verify', 'validate',
];

const NATURAL_OBJECT_WORDS = new Set([
  'my', 'the', 'this', 'that', 'a', 'an', 'your', 'our', 'agent', 'app', 'project', 'code',
  'feature', 'bug', 'issue', 'thing', 'tools', 'file', 'files', 'function', 'class', 'method',
  'module', 'component', 'service', 'server', 'client', 'api', 'endpoint', 'database',
  'test', 'tests', 'error', 'errors', 'warning', 'warnings', 'problem', 'problems',
  'performance', 'memory', 'security', 'config', 'configuration', 'settings', 'something',
  'everything', 'anything', 'nothing', 'it', 'them', 'these', 'those', 'me',
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
  if (explicit) {
    if (isPseudoEnglishShellIntent(explicit)) return null;
    return explicit;
  }

  if (looksLikeQuestionOrTask(trimmed)) return null;
  if (isPseudoEnglishShellIntent(trimmed)) return null;
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
