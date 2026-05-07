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

test('shell selection supports explicit Windows and Unix shells', async () => {
  const { getShell } = await import('../dist/tools/utils.js');
  assert.equal(getShell('cmd').label, 'cmd');
  assert.equal(getShell('powershell').label, 'powershell');
  assert.equal(getShell('bash').label, 'bash');
});

test('smart shell normalizes package bins and obvious shell syntax', async () => {
  const { getSmartShell } = await import('../dist/tools/utils.js');
  const explicitCmd = getSmartShell('npm run build', 'cmd');
  if (process.platform === 'win32') {
    assert.equal(explicitCmd.command, 'npm.cmd run build');
  } else {
    assert.equal(explicitCmd.command, 'npm run build');
  }

  const ps = getSmartShell('Get-ChildItem -Force', 'auto');
  if (process.platform === 'win32') {
    assert.match(ps.shell.label, /powershell|pwsh/);
  }

  const pwd = getSmartShell('pwd', 'cmd');
  if (process.platform === 'win32') {
    assert.equal(pwd.command, 'cd');
  }

  const ll = getSmartShell('ll', 'cmd');
  if (process.platform === 'win32') {
    assert.equal(ll.command, 'dir');
  }
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
  assert.equal(parseDirectCommand('ipconfig /all'), 'ipconfig /all');
  assert.equal(parseDirectCommand('tasklist'), 'tasklist');
  assert.equal(parseDirectCommand('xcodebuild -version'), 'xcodebuild -version');
  assert.equal(parseDirectCommand('"C:\\Tools\\app.exe" --help'), '"C:\\Tools\\app.exe" --help');
  assert.equal(parseDirectCommand('fix the login bug'), null);
  assert.equal(parseDirectCommand('what is this repo?'), null);
  assert.equal(parseDirectCommand('make my agent smarter'), null);
});

test('tool risk classification separates safe, network, and destructive commands', async () => {
  const { classifyToolCall } = await import('../dist/tool-risk.js');
  assert.equal(classifyToolCall('read_file', { path: 'package.json' }).risk, 'read-only');
  assert.equal(classifyToolCall('run_command', { command: 'npm run build' }).risk, 'shell-safe');
  assert.equal(classifyToolCall('run_command', { command: 'npm install left-pad' }).risk, 'shell-network');
  assert.equal(classifyToolCall('run_command', { command: 'git reset --hard' }).risk, 'destructive');
});

test('policy blocks writes in read-only mode', async () => {
  const { evaluateToolCall } = await import('../dist/policy.js');
  const decision = evaluateToolCall('write_file', { path: 'x.txt', content: 'x' }, { permissionMode: 'read-only' });
  assert.equal(decision.blocked, true);
});

test('context prompt includes operating loop and memory section', async () => {
  const { ContextEngine } = await import('../dist/context.js');
  const prompt = await new ContextEngine(process.cwd()).buildSystemPrompt();
  assert.match(prompt, /Core Operating Loop/);
  assert.match(prompt, /Loaded Memory/);
  assert.match(prompt, /project_intel/);
});

test('project intel returns compact recommendations', async () => {
  const { buildAgentInputWithProjectIntel, buildProjectIntel, shouldAttachProjectIntel } = await import('../dist/project-intel.js');
  const text = await buildProjectIntel({ cwd: process.cwd(), goal: 'fix cross platform command bug', maxFiles: 20 });
  assert.match(text, /Recommended commands/);
  assert.match(text, /Package scripts/);
  assert.match(text, /Key files/);
  assert.match(text, /Command path/);
  assert.ok(text.length < 12000);
  assert.equal(shouldAttachProjectIntel('fix command cross platform bugs'), true);
  assert.equal(shouldAttachProjectIntel('make my agent smarter'), true);
  assert.equal(shouldAttachProjectIntel('what is the capital of France?'), false);
  const wrapped = await buildAgentInputWithProjectIntel('fix shell commands', process.cwd());
  assert.match(wrapped, /<yamx_auto_project_intel>/);
  assert.match(wrapped, /User request:\nfix shell commands/);
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
