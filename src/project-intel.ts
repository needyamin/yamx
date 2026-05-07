import fs from 'fs-extra';
import path from 'node:path';
import fg from 'fast-glob';

interface IntelOptions {
  cwd?: string;
  goal?: string;
  maxFiles?: number;
}

const IMPORTANT_FILES = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'next.config.js',
  'next.config.mjs',
  'src/index.ts',
  'src/main.ts',
  'src/app.ts',
  'src/server.ts',
  'README.md',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
];

export async function buildProjectIntel(options: IntelOptions = {}): Promise<string> {
  const cwd = options.cwd || process.cwd();
  const goal = options.goal?.trim() || 'general problem solving';
  const maxFiles = Math.max(10, Math.min(options.maxFiles || 40, 120));
  const packageInfo = await readPackageInfo(cwd);
  const files = await listImportantFiles(cwd, maxFiles);
  const recommended = recommendCommands(packageInfo);
  const focus = inferFocus(goal);

  return [
    `Project Intel (${path.basename(cwd)})`,
    `Goal: ${goal}`,
    '',
    'Recommended agent workflow:',
    '1. Use this intel packet to choose the smallest useful inspection path.',
    '2. For bugs/errors: search exact error text first, then read the smallest relevant file ranges.',
    '3. For features: identify entry points and nearby patterns before editing.',
    '4. Prefer targeted verification before full builds. Escalate only if the narrow check passes or is unavailable.',
    '5. Keep outputs small: cap searches, read ranges, summarize command output, avoid full-file dumps.',
    '',
    'Recommended commands:',
    ...recommended.map((cmd) => `- ${cmd}`),
    '',
    'Focus hints:',
    ...focus.map((hint) => `- ${hint}`),
    '',
    'Package scripts:',
    ...formatScripts(packageInfo.scripts),
    '',
    'Key files:',
    ...files.map((file) => `- ${file}`),
    '',
    'Dependency signals:',
    ...formatDeps(packageInfo),
  ].join('\n');
}

export function shouldAttachProjectIntel(input: string): boolean {
  const text = input.trim();
  if (!text || text.startsWith('/')) return false;
  if (text.length < 12) return false;

  const lower = text.toLowerCase();
  if (/^(what|why|how|explain|tell me|describe)\b/.test(lower) && !/(repo|code|project|bug|error|fix|implement|test|build|command|agent)/.test(lower)) {
    return false;
  }

  return /\b(fix|bug|error|fail|crash|issue|problem|implement|add|create|build|refactor|improve|advance|smart|agent|tool|command|shell|cross.?platform|windows|linux|mac|bash|cmd|powershell|test|lint|typecheck|review|analy[sz]e|codebase|repo)\b/.test(lower);
}

export async function buildAgentInputWithProjectIntel(input: string, cwd = process.cwd()): Promise<string> {
  const intel = await buildProjectIntel({ cwd, goal: input, maxFiles: 32 });
  return [
    '<yamx_auto_project_intel>',
    intel,
    '</yamx_auto_project_intel>',
    '',
    'User request:',
    input,
  ].join('\n');
}

async function readPackageInfo(cwd: string): Promise<{
  manager: string;
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
}> {
  const pkgPath = path.join(cwd, 'package.json');
  const manager = await detectPackageManager(cwd);
  if (!await fs.pathExists(pkgPath)) {
    return { manager, scripts: {}, dependencies: [], devDependencies: [] };
  }
  try {
    const pkg = await fs.readJSON(pkgPath);
    return {
      manager,
      scripts: pkg.scripts || {},
      dependencies: Object.keys(pkg.dependencies || {}).sort(),
      devDependencies: Object.keys(pkg.devDependencies || {}).sort(),
    };
  } catch {
    return { manager, scripts: {}, dependencies: [], devDependencies: [] };
  }
}

async function detectPackageManager(cwd: string): Promise<string> {
  if (await fs.pathExists(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await fs.pathExists(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (await fs.pathExists(path.join(cwd, 'bun.lockb'))) return 'bun';
  if (await fs.pathExists(path.join(cwd, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

async function listImportantFiles(cwd: string, maxFiles: number): Promise<string[]> {
  const seen = new Set<string>();
  for (const file of IMPORTANT_FILES) {
    if (await fs.pathExists(path.join(cwd, file))) seen.add(file);
  }

  const discovered = await fg([
    'src/**/*.{ts,tsx,js,jsx,py,go,rs}',
    'app/**/*.{ts,tsx,js,jsx}',
    'lib/**/*.{ts,tsx,js,jsx,py}',
    'tests/**/*.{ts,tsx,js,jsx,py}',
    'test/**/*.{ts,tsx,js,jsx,py}',
  ], {
    cwd,
    onlyFiles: true,
    suppressErrors: true,
    ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**', 'coverage/**', '*.map'],
  });

  for (const file of discovered.sort((a, b) => scoreFile(b) - scoreFile(a))) {
    seen.add(file);
    if (seen.size >= maxFiles) break;
  }
  return [...seen].slice(0, maxFiles);
}

function scoreFile(file: string): number {
  let score = 0;
  if (/(index|main|app|server|cli|config|route|controller|service|agent|context|registry|tool)/i.test(file)) score += 4;
  if (/test|spec/i.test(file)) score += 2;
  if (file.startsWith('src/')) score += 2;
  score -= file.split('/').length * 0.1;
  return score;
}

function recommendCommands(pkg: Awaited<ReturnType<typeof readPackageInfo>>): string[] {
  const run = pkg.manager === 'npm' ? 'npm.cmd run' : pkg.manager === 'unknown' ? 'npm run' : pkg.manager;
  const scripts = pkg.scripts;
  const out: string[] = [];

  out.push('git_status');
  out.push('shell_diagnostics if command execution fails or shell syntax is uncertain');

  for (const name of ['typecheck', 'check', 'lint', 'test', 'build']) {
    if (scripts[name]) out.push(`${run} ${name}`);
  }
  if (!scripts.test) out.push('No test script detected; use the narrowest available build/typecheck/readback verification.');
  if (!scripts.build) out.push('No build script detected; verify with targeted command or code inspection.');
  return [...new Set(out)];
}

function inferFocus(goal: string): string[] {
  const lower = goal.toLowerCase();
  const hints: string[] = [];
  if (/bug|error|fail|fix|crash|exception|stack|trace/.test(lower)) {
    hints.push('Bug path: search exact error text, inspect callers/callees, reproduce with narrow command, then patch.');
  }
  if (/command|shell|cross.?platform|windows|linux|mac|bash|cmd|powershell/.test(lower)) {
    hints.push('Command path: inspect shell utilities, command parser, policy/risk, and tests around platform syntax.');
  }
  if (/test|build|lint|type/.test(lower)) {
    hints.push('Verification path: run the smallest named script first; avoid full test suites until needed.');
  }
  if (/feature|add|implement|make|create/.test(lower)) {
    hints.push('Feature path: find existing pattern, edit the closest owning module, add focused tests.');
  }
  if (hints.length === 0) hints.push('General path: map entry points, search relevant identifiers, read focused ranges, then decide.');
  return hints;
}

function formatScripts(scripts: Record<string, string>): string[] {
  const entries = Object.entries(scripts);
  if (entries.length === 0) return ['- none detected'];
  return entries.map(([name, script]) => `- ${name}: ${script}`);
}

function formatDeps(pkg: Awaited<ReturnType<typeof readPackageInfo>>): string[] {
  const deps = [...pkg.dependencies, ...pkg.devDependencies];
  if (deps.length === 0) return ['- none detected'];
  return deps.slice(0, 30).map((dep) => `- ${dep}`);
}
