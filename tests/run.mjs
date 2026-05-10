import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('project path guard rejects parent traversal', async () => {
  const { ensureInsideProject } = await import('../dist/tools/utils.js');
  assert.equal(ensureInsideProject('package.json').ok, true);
  assert.equal(ensureInsideProject('../package.json').ok, false);
});

test('cli update check compares semver-ish versions', async () => {
  const { compareSemver } = await import('../dist/cli-update-check.js');
  assert.equal(compareSemver('1.0.9', '1.0.10'), -1);
  assert.equal(compareSemver('1.0.10', '1.0.9'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
});

test('intent classifier separates conversation, unclear follow-ups, and tasks', async () => {
  const { buildCurrentIntentMessage, classifyUserIntent, extractCurrentUserRequest, isClearlyActionableInput } = await import('../dist/intent.js');
  assert.equal(classifyUserIntent('hi').kind, 'conversation');
  assert.equal(classifyUserIntent('thanks').kind, 'conversation');
  assert.equal(classifyUserIntent('more').kind, 'clarification');
  assert.equal(classifyUserIntent('fix the failing build').kind, 'task');
  assert.equal(classifyUserIntent('npm run build').kind, 'direct-command');
  const wrapped = '<yamx_auto_project_intel>\nold\n</yamx_auto_project_intel>\n\nUser request:\nhello';
  assert.equal(extractCurrentUserRequest(wrapped), 'hello');
  assert.equal(classifyUserIntent(wrapped).kind, 'conversation');
  assert.equal(classifyUserIntent('<yamx_direct_shell_failure>\nfailed\n</yamx_direct_shell_failure>').kind, 'task');
  assert.match(buildCurrentIntentMessage(classifyUserIntent('hello')), /Do not use tools/);
  assert.match(buildCurrentIntentMessage(classifyUserIntent('more')), /Ask one short clarification question/);
  assert.equal(isClearlyActionableInput('ok'), false);
  assert.equal(isClearlyActionableInput('diagnose docker networking'), true);
});

test('shell selection supports explicit Windows and Unix shells', async () => {
  const { getShell } = await import('../dist/tools/utils.js');
  assert.equal(getShell('cmd').label, 'cmd');
  assert.equal(getShell('powershell').label, 'powershell');
  assert.equal(getShell('bash').label, 'bash');
  assert.equal(getShell('zsh').label, 'zsh');
  assert.equal(getShell('fish').label, 'fish');
});

test('smart shell normalizes package bins and obvious shell syntax', async () => {
  const { buildLocalFirstEnv, getLocalFirstPathEntries, getSmartShell } = await import('../dist/tools/utils.js');
  const explicitCmd = getSmartShell('npm run build', 'cmd');
  if (process.platform === 'win32') {
    assert.equal(explicitCmd.command, 'npm.cmd run build');
  } else {
    assert.equal(explicitCmd.command, 'npm run build');
  }

  const ps = getSmartShell('Get-ChildItem -Force', 'auto');
  if (process.platform === 'win32') {
    assert.match(ps.shell.label, /powershell|pwsh/);
  } else if (process.env.PATH && process.env.PATH.includes('pwsh')) {
    assert.equal(ps.shell.label, 'pwsh');
  }

  const pwd = getSmartShell('pwd', 'cmd');
  if (process.platform === 'win32') {
    assert.equal(pwd.command, 'cd');
  }

  const mkdirP = getSmartShell('mkdir -p tmp/devops', 'cmd');
  if (process.platform === 'win32') {
    assert.equal(mkdirP.command, 'mkdir tmp/devops');
  }

  const headFile = getSmartShell('head -n 5 README.md', 'cmd');
  if (process.platform === 'win32') {
    assert.match(headFile.command, /Get-Content -TotalCount 5/);
  }

  const ll = getSmartShell('ll', 'cmd');
  if (process.platform === 'win32') {
    assert.equal(ll.command, 'dir');
  }

  const unixCompound = getSmartShell('export NODE_ENV=test && npm test', 'auto');
  if (process.platform === 'win32') {
    assert.ok(['bash', 'cmd'].includes(unixCompound.shell.label));
  } else {
    assert.ok(['sh', 'bash', 'zsh', 'fish'].includes(unixCompound.shell.label));
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamx-local-path-'));
  await fs.mkdir(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  await fs.mkdir(path.join(dir, 'vendor', 'bin'), { recursive: true });
  const localBins = getLocalFirstPathEntries(dir);
  assert.ok(localBins.some((entry) => entry.endsWith(path.join('node_modules', '.bin'))));
  assert.ok(localBins.some((entry) => entry.endsWith(path.join('vendor', 'bin'))));
  const env = buildLocalFirstEnv(dir, { PATH: 'GLOBAL_PATH' });
  const envPath = env.PATH || env.Path;
  assert.ok(envPath.startsWith(localBins[0]));
});

test('smart shell translates simple platform inspection commands both ways', async () => {
  const { getSmartShell } = await import('../dist/tools/utils.js');

  if (process.platform === 'win32') {
    assert.equal(getSmartShell('ls', 'auto').command, 'dir');
    assert.equal(getSmartShell('cat package.json', 'auto').command, 'type package.json');
    assert.equal(getSmartShell('command -v node', 'auto').command, 'where node');
    assert.equal(getSmartShell('which node', 'auto').command, 'where node');
    assert.equal(getSmartShell('uname -a', 'auto').command, 'ver');
    assert.equal(getSmartShell('ifconfig', 'auto').command, 'ipconfig');
    assert.equal(getSmartShell('ip addr', 'auto').command, 'ipconfig');
    assert.equal(getSmartShell('ip route', 'auto').command, 'route print');
    assert.equal(getSmartShell('traceroute example.com', 'auto').command, 'tracert example.com');
    assert.equal(getSmartShell('ss -tulpen', 'auto').command, 'netstat -ano');
    assert.equal(getSmartShell('ps aux', 'auto').command, 'tasklist');
  } else {
    assert.equal(getSmartShell('dir', 'auto').command, 'ls');
    assert.equal(getSmartShell('type package.json', 'auto').command, 'cat package.json');
    assert.equal(getSmartShell('where node', 'auto').command, 'command -v node');
    assert.equal(getSmartShell('ver', 'auto').command, 'uname -a');
    assert.equal(getSmartShell('systeminfo', 'auto').command, 'uname -a');
    assert.equal(getSmartShell('ipconfig', 'auto').command, 'ifconfig');
    assert.equal(getSmartShell('route print', 'auto').command, 'ip route');
    assert.equal(getSmartShell('tracert example.com', 'auto').command, 'traceroute example.com');
    assert.equal(getSmartShell('netstat -ano', 'auto').command, 'ss -tulpen');
    assert.equal(getSmartShell('tasklist', 'auto').command, 'ps aux');
  }
});

test('run_command keeps a persistent YamX working directory inside the project', async () => {
  const { runCommand } = await import('../dist/tools/shell.js');
  const moved = await runCommand.execute({ command: 'cd src' });
  assert.equal(moved, 'cwd: src');

  const cwd = await runCommand.execute({ command: 'pwd', max_chars: 2000 });
  assert.match(cwd.replace(/\\/g, '/'), /\/src$/);

  const back = await runCommand.execute({ command: 'cd ..' });
  assert.equal(back, 'cwd: .');
  const blocked = await runCommand.execute({ command: 'cd ..' });
  assert.match(blocked, /Path outside project/);
});

test('command memory records shell outcomes for project intelligence', async () => {
  const { runCommand } = await import('../dist/tools/shell.js');
  const { commandMemoryPath, formatCommandMemoryForPrompt } = await import('../dist/command-memory.js');
  await fs.unlink(commandMemoryPath()).catch(() => {});

  await runCommand.execute({ command: 'node -v', max_chars: 2000 });
  const memory = await formatCommandMemoryForPrompt(process.cwd(), 5);
  assert.match(memory, /node -v/);
  assert.match(memory, /\[ok\]/);
});

test('command intelligence seeds local json and suggests offline commands', async () => {
  const { commandIntelligencePath, ensureCommandIntelligenceDatabase, suggestCommands } = await import('../dist/command-intelligence.js');
  await fs.unlink(commandIntelligencePath()).catch(() => {});

  const dbPath = await ensureCommandIntelligenceDatabase();
  const raw = JSON.parse(await fs.readFile(dbPath, 'utf8'));
  assert.equal(raw.version, 1);
  assert.ok(raw.commands.some((entry) => entry.command === 'docker compose config'));
  assert.ok(raw.commands.some((entry) => entry.command === 'gitleaks detect --source .'));

  const docker = await suggestCommands('docker comp', process.cwd(), 5);
  assert.ok(docker.some((entry) => entry.command === 'docker compose config'));

  const security = await suggestCommands('secret scan', process.cwd(), 5);
  assert.ok(security.some((entry) => entry.command === 'gitleaks detect --source .'));

  const k8s = await suggestCommands('k8s pods', process.cwd(), 5);
  assert.ok(k8s.some((entry) => entry.command.includes('kubectl get pods')));

  const project = await suggestCommands('typecheck', process.cwd(), 7);
  assert.ok(project.some((entry) => entry.command === 'npm run build' || entry.command.includes('tsc')));

  const fuzzy = await suggestCommands('dockr cmpse logs', process.cwd(), 7);
  assert.ok(fuzzy.some((entry) => entry.command === 'docker compose logs --tail=100'));
});

test('direct command parser catches commands but not tasks', async () => {
  const { parseDirectCommand } = await import('../dist/direct-command.js');
  assert.equal(parseDirectCommand('whoami'), 'whoami');
  assert.equal(parseDirectCommand('$ npm run build'), 'npm run build');
  assert.equal(parseDirectCommand('!git status'), 'git status');
  assert.equal(parseDirectCommand('run: pnpm test'), 'pnpm test');
  assert.equal(parseDirectCommand('./scripts/build.sh'), './scripts/build.sh');
  assert.equal(parseDirectCommand('rg TODO src && npm test'), 'rg TODO src && npm test');
  assert.equal(parseDirectCommand('make build'), 'make build');
  assert.equal(parseDirectCommand('docker compose ps'), 'docker compose ps');
  assert.equal(parseDirectCommand('kubectl get pods'), 'kubectl get pods');
  assert.equal(parseDirectCommand('brew install ripgrep'), 'brew install ripgrep');
  assert.equal(parseDirectCommand('apt-get update'), 'apt-get update');
  assert.equal(parseDirectCommand('Get-ChildItem -Recurse'), 'Get-ChildItem -Recurse');
  assert.equal(parseDirectCommand('powershell -NoProfile -Command whoami'), 'powershell -NoProfile -Command whoami');
  assert.equal(parseDirectCommand('pwsh.exe -NoProfile -Command Get-Location'), 'pwsh.exe -NoProfile -Command Get-Location');
  assert.equal(parseDirectCommand('ipconfig /all'), 'ipconfig /all');
  assert.equal(parseDirectCommand('tasklist'), 'tasklist');
  assert.equal(parseDirectCommand('chmod 755 script.sh'), 'chmod 755 script.sh');
  assert.equal(parseDirectCommand('chown www-data:www-data storage'), 'chown www-data:www-data storage');
  assert.equal(parseDirectCommand('icacls storage /grant Users:F'), 'icacls storage /grant Users:F');
  assert.equal(parseDirectCommand('takeown /f storage /r'), 'takeown /f storage /r');
  assert.equal(parseDirectCommand('sudo systemctl status nginx'), 'sudo systemctl status nginx');
  assert.equal(parseDirectCommand('journalctl -u nginx -n 100'), 'journalctl -u nginx -n 100');
  assert.equal(parseDirectCommand('ansible-playbook deploy.yml'), 'ansible-playbook deploy.yml');
  assert.equal(parseDirectCommand('k9s'), 'k9s');
  assert.equal(parseDirectCommand('xcodebuild -version'), 'xcodebuild -version');
  assert.equal(parseDirectCommand('systeminfo'), 'systeminfo');
  assert.equal(parseDirectCommand('systeminfo /fo csv'), 'systeminfo /fo csv');
  assert.equal(parseDirectCommand('lscpu'), 'lscpu');
  assert.equal(parseDirectCommand('free -h'), 'free -h');
  assert.equal(parseDirectCommand('uptime'), 'uptime');
  assert.equal(parseDirectCommand('hostnamectl'), 'hostnamectl');
  assert.equal(parseDirectCommand('driverquery /v'), 'driverquery /v');
  assert.equal(parseDirectCommand('powercfg /list'), 'powercfg /list');
  assert.equal(parseDirectCommand('sw_vers'), 'sw_vers');
  assert.equal(parseDirectCommand('lsb_release -a'), 'lsb_release -a');
  assert.equal(parseDirectCommand('tar -xzf archive.tgz'), 'tar -xzf archive.tgz');
  assert.equal(parseDirectCommand('zip -r out.zip dist'), 'zip -r out.zip dist');
  assert.equal(parseDirectCommand('unzip out.zip'), 'unzip out.zip');
  assert.equal(parseDirectCommand('jq .name package.json'), 'jq .name package.json');
  assert.equal(parseDirectCommand('yq .services docker-compose.yml'), 'yq .services docker-compose.yml');
  assert.equal(parseDirectCommand('xxd file.bin'), 'xxd file.bin');
  assert.equal(parseDirectCommand('base64 -d data.txt'), 'base64 -d data.txt');
  assert.equal(parseDirectCommand('sha256sum README.md'), 'sha256sum README.md');
  assert.equal(parseDirectCommand('openssl rand -hex 32'), 'openssl rand -hex 32');
  assert.equal(parseDirectCommand('ssh-keygen -t ed25519'), 'ssh-keygen -t ed25519');
  assert.equal(parseDirectCommand('helm list'), 'helm list');
  assert.equal(parseDirectCommand('minikube status'), 'minikube status');
  assert.equal(parseDirectCommand('argocd app list'), 'argocd app list');
  assert.equal(parseDirectCommand('terraform plan'), 'terraform plan');
  assert.equal(parseDirectCommand('jar tf app.jar'), 'jar tf app.jar');
  assert.equal(parseDirectCommand('jps -l'), 'jps -l');
  assert.equal(parseDirectCommand('fastboot devices'), 'fastboot devices');
  assert.equal(parseDirectCommand('xcrun simctl list'), 'xcrun simctl list');
  assert.equal(parseDirectCommand('swift --version'), 'swift --version');
  assert.equal(parseDirectCommand('ffmpeg -i input.mp4 out.mp4'), 'ffmpeg -i input.mp4 out.mp4');
  assert.equal(parseDirectCommand('convert in.png out.jpg'), 'convert in.png out.jpg');
  assert.equal(parseDirectCommand('mongoimport --db app data.json'), 'mongoimport --db app data.json');
  assert.equal(parseDirectCommand('pgcli postgres://user@host/db'), 'pgcli postgres://user@host/db');
  assert.equal(parseDirectCommand('pm2 status'), 'pm2 status');
  assert.equal(parseDirectCommand('uvicorn app:app'), 'uvicorn app:app');
  assert.equal(parseDirectCommand('gunicorn app:app'), 'gunicorn app:app');
  assert.equal(parseDirectCommand('forge test'), 'forge test');
  assert.equal(parseDirectCommand('cast call 0x...'), 'cast call 0x...');
  assert.equal(parseDirectCommand('iperf3 -s'), 'iperf3 -s');
  assert.equal(parseDirectCommand('nmcli device status'), 'nmcli device status');
  assert.equal(parseDirectCommand('iptables -L'), 'iptables -L');
  assert.equal(parseDirectCommand('shellcheck script.sh'), 'shellcheck script.sh');
  assert.equal(parseDirectCommand('hadolint Dockerfile'), 'hadolint Dockerfile');
  assert.equal(parseDirectCommand('bat README.md'), 'bat README.md');
  assert.equal(parseDirectCommand('fd README'), 'fd README');
  assert.equal(parseDirectCommand('eza -la'), 'eza -la');
  assert.equal(parseDirectCommand('zoxide query yamx'), 'zoxide query yamx');
  assert.equal(parseDirectCommand('tldr tar'), 'tldr tar');
  assert.equal(parseDirectCommand('man rsync'), 'man rsync');
  assert.equal(parseDirectCommand('hg status'), 'hg status');
  assert.equal(parseDirectCommand('svn info'), 'svn info');
  assert.equal(parseDirectCommand('jj log'), 'jj log');
  assert.equal(parseDirectCommand('artisan migrate'), 'artisan migrate');
  assert.equal(parseDirectCommand('prisma migrate dev'), 'prisma migrate dev');
  assert.equal(parseDirectCommand('ollama list'), 'ollama list');
  assert.equal(parseDirectCommand('flutter doctor'), 'flutter doctor');
  assert.equal(parseDirectCommand('adb devices'), 'adb devices');
  assert.equal(parseDirectCommand('psql -d app'), 'psql -d app');
  assert.equal(parseDirectCommand('wrangler dev'), 'wrangler dev');
  assert.equal(parseDirectCommand('wsl ls -la'), 'wsl ls -la');
  assert.equal(parseDirectCommand('next build'), 'next build');
  assert.equal(parseDirectCommand('pytest tests'), 'pytest tests');
  assert.equal(parseDirectCommand('my-tool --version'), 'my-tool --version');
  assert.equal(parseDirectCommand('vendor/bin/phpunit --filter LoginTest'), 'vendor/bin/phpunit --filter LoginTest');
  assert.equal(parseDirectCommand('script.ps1 -ExecutionPolicy Bypass'), 'script.ps1 -ExecutionPolicy Bypass');
  assert.equal(parseDirectCommand('"C:\\Tools\\app.exe" --help'), '"C:\\Tools\\app.exe" --help');
  assert.equal(parseDirectCommand('fix the login bug'), null);
  assert.equal(parseDirectCommand('what is this repo?'), null);
  assert.equal(parseDirectCommand('make my agent smarter'), null);
  assert.equal(parseDirectCommand('project build'), null);
});

test('tool risk classification separates safe, network, and destructive commands', async () => {
  const { classifyToolCall, isDangerousShellCommand } = await import('../dist/tool-risk.js');
  assert.equal(classifyToolCall('read_file', { path: 'package.json' }).risk, 'read-only');
  assert.equal(classifyToolCall('codebase_analysis', { goal: 'review repo' }).risk, 'read-only');
  assert.equal(classifyToolCall('log_inspect', { path: 'app.log' }).risk, 'read-only');
  assert.equal(classifyToolCall('run_command', { command: 'npm run build' }).risk, 'shell-safe');
  assert.equal(classifyToolCall('run_command', { command: 'git status --short' }).risk, 'shell-safe');
  assert.equal(classifyToolCall('run_command', { command: 'rg TODO src' }).risk, 'shell-safe');
  assert.equal(classifyToolCall('run_command', { command: 'npm install left-pad' }).risk, 'shell-network');
  assert.equal(classifyToolCall('run_command', { command: 'curl https://example.com' }).risk, 'shell-network');
  assert.equal(classifyToolCall('run_command', { command: 'git reset --hard' }).risk, 'destructive');
  assert.equal(classifyToolCall('run_command', { command: 'sudo apt install nginx' }).risk, 'destructive');
  assert.equal(classifyToolCall('run_command', { command: 'mkdir tmp' }).risk, 'shell-safe');
  assert.equal(classifyToolCall('run_command', { command: 'chmod -R 777 storage' }).risk, 'destructive');
  assert.equal(classifyToolCall('run_command', { command: 'icacls storage /grant Users:F' }).risk, 'destructive');
  assert.equal(classifyToolCall('run_command', { command: 'ssh user@example.com' }).risk, 'sensitive');
  assert.equal(classifyToolCall('run_command', { command: 'cat .env' }).risk, 'sensitive');
  assert.equal(classifyToolCall('run_command', { command: 'netsh advfirewall show allprofiles' }).risk, 'sensitive');
  assert.equal(classifyToolCall('write_file', { path: '.env', content: 'TOKEN=x' }).risk, 'sensitive');
  assert.equal(isDangerousShellCommand('npm run test'), false);
  assert.equal(isDangerousShellCommand('Remove-Item -Recurse -Force dist'), true);
});

test('filesystem tools support bounded reads, edit dry-run, and search context', async () => {
  const { readFile, editFile, searchFiles } = await import('../dist/tools/filesystem.js');
  const filePath = path.join(process.cwd(), 'tmp-yamx-fs.txt');
  await fs.writeFile(filePath, ['alpha', 'beta target', 'gamma', 'target delta'].join('\n'));
  try {
    const tail = await readFile.execute({ path: 'tmp-yamx-fs.txt', tail: true, start_line: 2 });
    assert.match(tail, /3: gamma/);
    assert.match(tail, /4: target delta/);

    const dryRun = await editFile.execute({ path: 'tmp-yamx-fs.txt', old_text: 'target', new_text: 'TARGET', dry_run: true });
    assert.match(dryRun, /would replace 1/);
    const edited = await editFile.execute({ path: 'tmp-yamx-fs.txt', old_text: 'target', new_text: 'TARGET', occurrence: 2 });
    assert.match(edited, /replaced 1 occurrence/);

    const search = await searchFiles.execute({ path: '.', include: 'tmp-yamx-fs.txt', pattern: 'TARGET', context_lines: 1 });
    assert.match(search, /-- tmp-yamx-fs.txt:4 --/);
    assert.match(search, /> 4: TARGET delta/);
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});

test('policy blocks writes in read-only mode', async () => {
  const { evaluateToolCall } = await import('../dist/policy.js');
  const decision = evaluateToolCall('write_file', { path: 'x.txt', content: 'x' }, { permissionMode: 'read-only' });
  assert.equal(decision.blocked, true);
});

test('policy auto-approves safe shell but still asks for risky shell', async () => {
  const { evaluateToolCall } = await import('../dist/policy.js');
  assert.equal(evaluateToolCall('run_command', { command: 'npm run build' }).needsApproval, false);
  assert.equal(evaluateToolCall('run_command', { command: 'git diff --stat' }).needsApproval, false);
  assert.equal(evaluateToolCall('run_command', { command: 'npm install left-pad' }).needsApproval, true);
  assert.equal(evaluateToolCall('run_command', { command: 'git reset --hard' }).needsApproval, true);
  assert.equal(evaluateToolCall('run_command', { command: 'ssh user@example.com' }).needsApproval, true);
  assert.equal(evaluateToolCall('run_command', { command: 'curl https://example.com/.env' }).blocked, true);
  assert.equal(evaluateToolCall('write_file', { path: '.env', content: 'TOKEN=x' }).needsApproval, true);
});

test('context prompt includes operating loop and memory section', async () => {
  const { ContextEngine } = await import('../dist/context.js');
  const prompt = await new ContextEngine(process.cwd()).buildSystemPrompt();
  assert.match(prompt, /Workflow \(short\)/);
  assert.match(prompt, /Hidden planning/);
  assert.match(prompt, /Current intent first/);
  assert.match(prompt, /If the latest request is not clearly related to the previous task, treat it as a new task/);
  assert.match(prompt, /For unclear requests, ask exactly one short clarification question/);
  assert.match(prompt, /Loaded Memory/);
  assert.match(prompt, /project_intel/);
  assert.match(prompt, /codebase_analysis/);
  assert.match(prompt, /log_inspect/);
  assert.match(prompt, /Local Compute First/);
  assert.match(prompt, /python -c/);
  assert.match(prompt, /jq /);
  assert.match(prompt, /Detected Local Tooling/);
  assert.match(prompt, /Auto-detected helpers on this machine/);
  assert.match(prompt, /DevOps \/ Full-Stack Operations Mode/);
  assert.match(prompt, /terraform validate/);
  assert.match(prompt, /Network Engineering Mode/);
  assert.match(prompt, /ipconfig \/all/);
  assert.match(prompt, /Cybersecurity Engineering Mode/);
  assert.match(prompt, /gitleaks detect --source \./);
});

test('local tool detector finds at least one runtime', async () => {
  const { detectLocalTools, findToolWithFallback, preferredAnalysisRunner, formatLocalToolsForPrompt } = await import('../dist/tool-detect.js');
  const probes = detectLocalTools();
  assert.ok(probes.length > 0);
  assert.ok(probes.some((p) => p.available));
  const node = findToolWithFallback('node');
  assert.ok(node, 'node should be available because we just ran tests with it');
  assert.equal(typeof node.path, 'string');
  const runner = preferredAnalysisRunner();
  assert.ok(runner, 'expect at least one analysis runner (python or node) installed');
  assert.match(formatLocalToolsForPrompt(), /runtimes:/);
});

test('agent runs hidden model council before final response', async () => {
  const { Agent } = await import('../dist/agent.js');
  let calls = 0;
  const provider = {
    name: 'test',
    modelId: 'test-model',
    complete: async () => {
      calls++;
      return { content: calls === 1 ? 'Synthesizer: proceed carefully.' : 'Done.' };
    },
    stream: async function* () {},
  };
  const agent = new Agent(provider, 'system', { stream: false, modelCouncilEnabled: true });
  await agent.chat('fix the thing');
  assert.equal(calls, 2);
  assert.ok(agent.getHistory().some((message) => String(message.content || '').includes('yamx_internal_model_council')));
});

test('agent stop request cancels active model council turn', async () => {
  const { Agent } = await import('../dist/agent.js');
  const provider = {
    name: 'test',
    modelId: 'test-model',
    complete: async () => new Promise(() => {}),
    stream: async function* () {},
  };
  const agent = new Agent(provider, 'system', { stream: false, modelCouncilEnabled: true, modelCouncilMode: 'always' });
  const turn = agent.chat('fix the broken deployment pipeline');
  setTimeout(() => agent.requestStop(), 20);
  await turn;
  assert.equal(agent.isStopRequested(), false);
  assert.ok(agent.getHistory().some((message) => String(message.content || '').includes('Stopped by user')));
});

test('agent skips hidden model council for simple turns in adaptive mode', async () => {
  const { Agent } = await import('../dist/agent.js');
  let calls = 0;
  const provider = {
    name: 'test',
    modelId: 'test-model',
    complete: async () => {
      calls++;
      return { content: 'Hello.' };
    },
    stream: async function* () {},
  };
  const agent = new Agent(provider, 'system', { stream: false, modelCouncilEnabled: true, modelCouncilMode: 'adaptive' });
  await agent.chat('hi');
  assert.equal(calls, 1);
  assert.equal(agent.getHistory().some((message) => String(message.content || '').includes('yamx_internal_model_council')), false);
  assert.ok(agent.getHistory().some((message) => String(message.content || '').includes('<yamx_current_intent>')));
  assert.ok(agent.getHistory().some((message) => String(message.content || '').includes('kind=conversation')));
});

test('agent adds failure protocol after failed command output', async () => {
  const { Agent } = await import('../dist/agent.js');
  let calls = 0;
  const provider = {
    name: 'test',
    modelId: 'test-model',
    complete: async () => {
      calls++;
      if (calls === 1) {
        return {
          content: null,
          tool_calls: [{
            id: 'tc1',
            type: 'function',
            function: { name: 'run_command', arguments: JSON.stringify({ command: 'node --definitely-not-a-real-flag' }) },
          }],
        };
      }
      return { content: 'Investigated failure.' };
    },
    stream: async function* () {},
  };
  const agent = new Agent(provider, 'system', { stream: false, modelCouncilEnabled: false });
  await agent.chat('fix failing command');
  assert.ok(agent.getHistory().some((message) => String(message.content || '').includes('yamx_failure_protocol')));
});

async function runAgentWithToolStream(chunks) {
  const { Agent } = await import('../dist/agent.js');
  let calls = 0;
  const provider = {
    name: 'test',
    modelId: 'test-model',
    complete: async () => ({ content: 'unused' }),
    stream: async function* () {
      calls++;
      if (calls > 1) {
        yield { type: 'text', content: 'Done.' };
        yield { type: 'done' };
        return;
      }
      for (const chunk of chunks) yield chunk;
      yield { type: 'done' };
    },
  };
  const agent = new Agent(provider, 'system', { stream: true, modelCouncilEnabled: false });
  await agent.chat('what node version?');
  return agent.getHistory().find((message) => message.role === 'tool' && message.name === 'run_command')?.content || '';
}

function runCommandToolCall(argumentsJson = JSON.stringify({ command: 'node -v', max_chars: 2000 })) {
  return {
    id: 'tc1',
    type: 'function',
    function: { name: 'run_command', arguments: argumentsJson },
  };
}

test('agent preserves streamed tool-call args from start chunks', async () => {
  const toolCall = runCommandToolCall();
  const commandResult = await runAgentWithToolStream([
    { type: 'tool_call_start', toolCall },
    { type: 'tool_call_end', toolCall },
  ]);
  assert.match(commandResult, /^v?\d+\.\d+\.\d+/);
  assert.doesNotMatch(commandResult, /command is required/);
});

test('agent preserves streamed tool-call args from delta-only chunks', async () => {
  const commandResult = await runAgentWithToolStream([
    { type: 'tool_call_delta', toolCall: runCommandToolCall() },
    { type: 'tool_call_end', toolCall: { id: 'tc1', type: 'function' } },
  ]);
  assert.match(commandResult, /^v?\d+\.\d+\.\d+/);
  assert.doesNotMatch(commandResult, /command is required/);
});

test('agent preserves streamed tool-call args from end-only chunks', async () => {
  const commandResult = await runAgentWithToolStream([
    { type: 'tool_call_end', toolCall: runCommandToolCall() },
  ]);
  assert.match(commandResult, /^v?\d+\.\d+\.\d+/);
  assert.doesNotMatch(commandResult, /command is required/);
});

test('OpenAI-compatible tool-call serialization strips provider metadata', async () => {
  const { toOpenAIToolCalls } = await import('../dist/providers/base.js');
  const [toolCall] = toOpenAIToolCalls([{
    id: 'call-1',
    type: 'function',
    function: { name: 'run_command', arguments: JSON.stringify({ command: 'node -v' }) },
    providerMetadata: { gemini: { thought: true, thoughtSignature: 'opaque-signature' } },
  }]);
  assert.deepEqual(toolCall, {
    id: 'call-1',
    type: 'function',
    function: { name: 'run_command', arguments: JSON.stringify({ command: 'node -v' }) },
  });
});

test('gemini provider round-trips function-call thought signatures', async () => {
  const { GeminiProvider } = await import('../dist/providers/gemini.js');
  const provider = new GeminiProvider('test-key', 'gemini-test');
  const built = provider.buildContents([
    { role: 'system', content: 'system' },
    { role: 'user', content: 'my ip?' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: { name: 'run_command', arguments: JSON.stringify({ command: 'ipconfig' }) },
        providerMetadata: { gemini: { thought: true, thoughtSignature: 'opaque-signature' } },
      }],
    },
  ]);
  const functionCallPart = built.contents[1].parts[0];
  assert.equal(functionCallPart.thought, true);
  assert.equal(functionCallPart.thoughtSignature, 'opaque-signature');
  assert.equal(functionCallPart.functionCall.name, 'run_command');
});

test('project intel returns compact recommendations', async () => {
  const { buildAgentInputWithProjectIntel, buildCodebaseAnalysis, buildProjectIntel, shouldAttachProjectIntel } = await import('../dist/project-intel.js');
  const text = await buildProjectIntel({ cwd: process.cwd(), goal: 'fix cross platform command bug', maxFiles: 20 });
  assert.match(text, /Recommended commands/);
  assert.match(text, /Package scripts/);
  assert.match(text, /Key files/);
  assert.match(text, /Command path/);
  assert.ok(text.length < 12000);
  assert.equal(shouldAttachProjectIntel('fix command cross platform bugs'), true);
  assert.equal(shouldAttachProjectIntel('make my agent smarter'), true);
  assert.equal(shouldAttachProjectIntel('diagnose docker compose deploy issue'), true);
  assert.equal(shouldAttachProjectIntel('fix kubernetes helm terraform pipeline'), true);
  assert.equal(shouldAttachProjectIntel('diagnose DNS route latency network issue'), true);
  assert.equal(shouldAttachProjectIntel('run defensive cybersecurity audit for secrets and CVEs'), true);
  assert.equal(shouldAttachProjectIntel('hello'), false);
  assert.equal(shouldAttachProjectIntel('more'), false);
  assert.equal(shouldAttachProjectIntel('what is the capital of France?'), false);
  const wrapped = await buildAgentInputWithProjectIntel('fix shell commands', process.cwd());
  assert.match(wrapped, /<yamx_auto_project_intel>/);
  assert.match(wrapped, /User request:\nfix shell commands/);

  const analysis = await buildCodebaseAnalysis({ cwd: process.cwd(), goal: 'summarize this agent architecture', depth: 'quick', maxFiles: 30 });
  assert.match(analysis, /Codebase Analysis/);
  assert.match(analysis, /Executive summary/);
  assert.match(analysis, /Agentic operating plan/);
  assert.match(analysis, /Primary entry points/);
  assert.ok(analysis.length < 16000);

  const devops = await buildProjectIntel({ cwd: process.cwd(), goal: 'fix devops docker terraform deploy pipeline', maxFiles: 20 });
  assert.match(devops, /DevOps path/);
  assert.match(devops, /docker --version/);
  assert.match(devops, /terraform validate/);

  const network = await buildProjectIntel({ cwd: process.cwd(), goal: 'fix dns route latency network issue', maxFiles: 20 });
  assert.match(network, /Network path/);
  assert.match(network, /Network diagnostics/);

  const security = await buildProjectIntel({ cwd: process.cwd(), goal: 'defensive cybersecurity secrets cve audit', maxFiles: 20 });
  assert.match(security, /Security path/);
  assert.match(security, /Security audits/);
});

test('runtime preflight also handles vague project ops requests', async () => {
  const { maybeRuntimePreflightMessage } = await import('../dist/runtime-preflight.js');
  assert.equal(await maybeRuntimePreflightMessage('hello'), null);
  assert.equal(await maybeRuntimePreflightMessage('thanks'), null);
  const text = await maybeRuntimePreflightMessage('install it');
  assert.match(text, /<yamx_project_preflight>/);
  assert.match(text, /package_manager=npm/);
  assert.match(text, /nearby_files=.*package\.json/);
  assert.match(text, /candidate_next_commands=.*install/);
  assert.match(text, /### run: git status --short/);

  const wrapped = await maybeRuntimePreflightMessage('<yamx_auto_project_intel>\n...\n</yamx_auto_project_intel>\n\nUser request:\nfix it');
  assert.match(wrapped, /<yamx_project_preflight>/);
});

test('web command server serves UI and executes safe commands', async () => {
  const { startYamxWebServer } = await import('../dist/web/server.js');
  const app = await startYamxWebServer({ host: '127.0.0.1', port: 0 });
  try {
    const html = await fetch(app.url).then((res) => res.text());
    assert.match(html, /YamX Web/);

    const state = await fetch(`${app.url}/api/state`).then((res) => res.json());
    assert.equal(state.cwd, '.');
    assert.equal(state.allowDangerous, false);

    const result = await fetch(`${app.url}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'node -v' }),
    }).then((res) => res.json());
    assert.equal(result.blocked, false);
    assert.equal(result.code, 0);
    assert.match(result.output, /^v?\d+\.\d+\.\d+/);
  } finally {
    await app.close();
  }
});

test('web server routes natural messages to the YamX agent', async () => {
  const { startYamxWebServer } = await import('../dist/web/server.js');
  const provider = {
    name: 'fake',
    modelId: 'fake-web-model',
    complete: async () => ({ content: 'Hello from YamX web agent.' }),
    stream: async function* () {
      yield { type: 'text', content: 'Hello from YamX web agent.' };
      yield { type: 'done' };
    },
  };
  const app = await startYamxWebServer({ host: '127.0.0.1', port: 0, providerOverride: provider });
  try {
    const result = await fetch(`${app.url}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'hi' }),
    }).then((res) => res.json());
    assert.equal(result.kind, 'chat');
    assert.equal(result.code, 0);
    assert.equal(result.provider, 'fake');
    assert.match(result.output, /Hello from YamX web agent/);
    assert.equal(result.executedCommand, undefined);
  } finally {
    await app.close();
  }
});

test('web command runner does not execute greetings or unclear text', async () => {
  const { executeWebCommand } = await import('../dist/web/server.js');
  const greeting = await executeWebCommand({ command: 'hi' });
  assert.equal(greeting.code, 0);
  assert.equal(greeting.blocked, false);
  assert.match(greeting.output, /web panel runs local shell commands/i);
  assert.equal(greeting.executedCommand, undefined);

  const task = await executeWebCommand({ command: 'make my agent smarter' });
  assert.equal(task.code, 0);
  assert.match(task.output, /only executes command-like input/i);
});

test('web command runner blocks destructive and sensitive commands by default', async () => {
  const { executeWebCommand } = await import('../dist/web/server.js');
  const result = await executeWebCommand({ command: 'rm -rf dist' });
  assert.equal(result.blocked, true);
  assert.match(result.output, /Blocked:/);

  const sensitive = await executeWebCommand({ command: 'cat .env' });
  assert.equal(sensitive.blocked, true);
  assert.equal(sensitive.risk, 'sensitive');
});

test('tool registry exposes codebase analysis intelligence tool', async () => {
  const { getTool, getToolCount, getToolsByCategory } = await import('../dist/tools/registry.js');
  assert.ok(getTool('codebase_analysis'));
  assert.ok(getTool('log_inspect'));
  assert.equal(getToolCount(), 29);
  assert.ok(getToolsByCategory().Intelligence.includes('codebase_analysis'));
  assert.ok(getToolsByCategory().Intelligence.includes('log_inspect'));
});

test('log inspector reads tails and error context', async () => {
  const { logInspect } = await import('../dist/tools/logs.js');
  const logPath = path.join(process.cwd(), 'tmp-yamx-test.log');
  await fs.writeFile(logPath, [
    'booting',
    'ready',
    'TypeError: Cannot read properties of undefined',
    '    at handler src/app.ts:10',
    'done',
  ].join('\n'));
  try {
    const tail = await logInspect.execute({ path: 'tmp-yamx-test.log', mode: 'tail', lines: 2 });
    assert.match(tail, /4:     at handler/);
    assert.match(tail, /5: done/);
    const errors = await logInspect.execute({ path: 'tmp-yamx-test.log', mode: 'errors', context_lines: 1 });
    assert.match(errors, /TypeError/);
    assert.match(errors, /handler src\/app\.ts/);
    const latest = await logInspect.execute({ path: 'tmp-yamx-test.log', mode: 'latest-error', context_lines: 1 });
    assert.match(latest, /Latest match at line 3/);
    const summary = await logInspect.execute({ path: 'tmp-yamx-test.log', mode: 'summary' });
    assert.match(summary, /Errors: 1/);
    assert.match(summary, /Recommended next steps/);
    const auto = await logInspect.execute({ path: 'tmp-yamx-test.log', mode: 'auto' });
    assert.match(auto, /Summary:/);
    assert.match(auto, /Latest match at line 3/);
    assert.match(auto, /Recent tail:/);
  } finally {
    await fs.unlink(logPath).catch(() => {});
  }
});

test('skill manager discovers local skills', async () => {
  const { SkillManager } = await import('../dist/skills.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamx-skill-'));
  await fs.mkdir(path.join(dir, 'skills', 'demo'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: Demo skill\nrequired_tools: [read_file]\n---\n# Demo\n'
  );
  const skills = await new SkillManager(dir).load();
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'demo');
});

test('subagent runner describes built-in agents', async () => {
  const { SubagentRunner } = await import('../dist/subagents.js');
  const provider = {
    name: 'test',
    modelId: 'test-model',
    complete: async () => ({ content: 'ok' }),
    stream: async function* () {},
  };
  const text = await new SubagentRunner(provider).describe();
  assert.match(text, /explorer/);
  assert.match(text, /planner/);
  assert.match(text, /reviewer/);
});

test('subagent runner loads custom project agents', async () => {
  const { SubagentRunner } = await import('../dist/subagents.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamx-agent-'));
  await fs.mkdir(path.join(dir, '.yamx', 'agents'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.yamx', 'agents', 'docs.md'),
    '---\nname: docs\n---\nYou are a documentation subagent.\n'
  );
  const provider = {
    name: 'test',
    modelId: 'test-model',
    complete: async () => ({ content: 'ok' }),
    stream: async function* () {},
  };
  const agents = await new SubagentRunner(provider, dir).loadCustomAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, 'docs');
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed++;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failed > 0) process.exit(1);
console.log(`${tests.length} tests passed`);
