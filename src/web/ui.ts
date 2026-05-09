export const WEB_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YamX Web</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div>
        <div class="brand">YamX Web</div>
        <div class="sub" id="cwd">cwd: .</div>
      </div>
      <div class="pill" id="state">offline</div>
    </header>
    <main class="terminal" id="terminal" aria-live="polite"></main>
    <form class="commandbar" id="command-form">
      <span class="prompt">&gt;</span>
      <input id="command-input" name="command" autocomplete="off" spellcheck="false" placeholder="Ask YamX or type a command" autofocus>
      <button type="submit" title="Send to YamX">Send</button>
    </form>
  </div>
  <script src="/app.js"></script>
</body>
</html>`;

export const WEB_CSS = `:root {
  color-scheme: dark;
  --bg: #111312;
  --panel: #171a19;
  --panel-2: #1d211f;
  --line: #303733;
  --text: #e6ece8;
  --muted: #93a099;
  --accent: #7ee787;
  --warn: #f2cc60;
  --bad: #ff7b72;
  --shadow: rgba(0, 0, 0, .28);
}

* { box-sizing: border-box; }

html, body {
  height: 100%;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}

body {
  min-width: 320px;
}

.app {
  min-height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.topbar {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 1px 10px var(--shadow);
}

.brand {
  font-weight: 700;
  letter-spacing: 0;
}

.sub {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.pill {
  flex: 0 0 auto;
  min-width: 72px;
  text-align: center;
  padding: 5px 9px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  border-radius: 6px;
  font-size: 12px;
}

.pill.ok { color: var(--accent); }
.pill.bad { color: var(--bad); }

.terminal {
  overflow: auto;
  padding: 14px 16px 24px;
  background: var(--bg);
}

.entry {
  margin: 0 0 14px;
  border-bottom: 1px solid rgba(48, 55, 51, .55);
  padding-bottom: 14px;
}

.cmdline {
  display: flex;
  gap: 8px;
  color: var(--accent);
  overflow-wrap: anywhere;
}

.meta {
  margin: 6px 0 8px;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.meta.fail { color: var(--bad); }
.meta.warn { color: var(--warn); }

pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
}

.commandbar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: var(--panel);
}

.prompt {
  color: var(--accent);
  font-weight: 700;
}

input {
  width: 100%;
  min-width: 0;
  height: 38px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--text);
  border-radius: 6px;
  padding: 0 11px;
  font: inherit;
  outline: none;
}

input:focus {
  border-color: var(--accent);
}

button {
  height: 38px;
  min-width: 64px;
  border: 1px solid #4d5a52;
  border-radius: 6px;
  background: #243128;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

button:disabled {
  opacity: .55;
  cursor: wait;
}

@media (max-width: 560px) {
  .topbar { align-items: flex-start; flex-direction: column; }
  .pill { text-align: left; }
  .commandbar { grid-template-columns: auto 1fr; }
  button { grid-column: 2; justify-self: end; }
}`;

export const WEB_JS = `const terminal = document.getElementById('terminal');
const form = document.getElementById('command-form');
const input = document.getElementById('command-input');
const state = document.getElementById('state');
const cwd = document.getElementById('cwd');

function text(value) {
  return String(value == null ? '' : value);
}

function setState(label, cls) {
  state.textContent = label;
  state.className = 'pill' + (cls ? ' ' + cls : '');
}

function addEntry(command, result) {
  const entry = document.createElement('section');
  entry.className = 'entry';

  const line = document.createElement('div');
  line.className = 'cmdline';
  const prompt = document.createElement('span');
  prompt.textContent = '>';
  const commandText = document.createElement('span');
  commandText.textContent = command;
  line.append(prompt, commandText);

  const meta = document.createElement('div');
  const failed = result.blocked || result.code !== 0 || result.timedOut;
  meta.className = 'meta ' + (result.blocked ? 'warn' : failed ? 'fail' : '');
  meta.textContent = result.kind === 'chat'
    ? [
        result.provider ? 'provider=' + result.provider : '',
        result.model ? 'model=' + result.model : '',
        result.cwd ? 'cwd=' + result.cwd : '',
        Number.isFinite(result.durationMs) ? result.durationMs + 'ms' : ''
      ].filter(Boolean).join(' | ')
    : [
        result.shell ? 'shell=' + result.shell : '',
        result.cwd ? 'cwd=' + result.cwd : '',
        Number.isFinite(result.durationMs) ? result.durationMs + 'ms' : '',
        result.blocked ? 'blocked' : 'exit=' + result.code
      ].filter(Boolean).join(' | ');

  const pre = document.createElement('pre');
  pre.textContent = text(result.output);

  entry.append(line, meta, pre);
  terminal.append(entry);
  terminal.scrollTop = terminal.scrollHeight;
}

async function refreshState() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('state failed');
  const data = await res.json();
  cwd.textContent = 'cwd: ' + data.cwd + (data.provider ? ' | ' + data.provider + (data.model ? ' / ' + data.model : '') : '');
  setState(data.allowDangerous ? 'danger on' : 'ready', data.allowDangerous ? 'bad' : 'ok');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const command = input.value.trim();
  if (!command) return;
  input.value = '';
  input.disabled = true;
  form.querySelector('button').disabled = true;
  setState('running', '');
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command })
    });
    const data = await res.json();
    addEntry(command, data);
    cwd.textContent = 'cwd: ' + (data.cwd || '.') + (data.provider ? ' | ' + data.provider + (data.model ? ' / ' + data.model : '') : '');
    setState(data.allowDangerous ? 'danger on' : 'ready', data.allowDangerous ? 'bad' : 'ok');
  } catch (error) {
    addEntry(command, { code: 1, output: 'Request failed: ' + error.message });
    setState('error', 'bad');
  } finally {
    input.disabled = false;
    form.querySelector('button').disabled = false;
    input.focus();
  }
});

refreshState().catch(() => setState('error', 'bad'));`;
