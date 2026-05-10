export const WEB_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YamX Web</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="app-shell" id="app-shell">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="sidebar-brand">
        <div class="brand">YamX</div>
        <div class="brand-tag">Web</div>
      </div>
      <div class="sidebar-meta">
        <div class="sub" id="cwd" title="Working directory">cwd: .</div>
        <span class="ver" id="app-ver"></span>
      </div>
      <nav class="sidebar-nav" role="tablist" aria-orientation="vertical">
        <button type="button" class="nav-item active" data-panel="terminal" role="tab" aria-selected="true">
          <span class="nav-ico" aria-hidden="true">▸</span>
          <span class="nav-label">Shell</span>
        </button>
        <button type="button" class="nav-item" data-panel="settings" role="tab" aria-selected="false">
          <span class="nav-ico" aria-hidden="true">◎</span>
          <span class="nav-label">Settings</span>
        </button>
        <button type="button" class="nav-item" data-panel="sessions" role="tab" aria-selected="false">
          <span class="nav-ico" aria-hidden="true">◇</span>
          <span class="nav-label">Sessions</span>
        </button>
        <button type="button" class="nav-item" data-panel="tools" role="tab" aria-selected="false">
          <span class="nav-ico" aria-hidden="true">⌘</span>
          <span class="nav-label">Tools &amp; API</span>
        </button>
      </nav>
      <p class="sidebar-hint muted">Local control plane · bind stays on loopback</p>
    </aside>
    <div class="sidebar-backdrop" id="sidebar-backdrop" aria-hidden="true"></div>

    <div class="main">
      <header class="mainbar">
        <button type="button" class="menu-toggle" id="menu-toggle" aria-expanded="false" aria-controls="sidebar" title="Menu">
          <span class="burger" aria-hidden="true"></span>
          <span class="sr-only">Open navigation</span>
        </button>
        <div class="mainbar-title" id="mainbar-title">Shell</div>
        <div class="mainbar-actions">
          <div class="pill" id="state">offline</div>
        </div>
      </header>

      <div class="main-body">
        <section id="panel-terminal" class="panel panel-shell active" role="tabpanel" aria-labelledby="tab-terminal-label">
          <span id="tab-terminal-label" class="sr-only">Shell</span>
          <div class="shell-stage">
            <div class="shell-card" role="region" aria-label="YamX shell">
              <div class="terminal-workspace">
                <div class="terminal-chrome">
                  <span class="chrome-title">Conversation</span>
                  <span class="chrome-hint muted">You · instant · reply when ready</span>
                </div>
                <main class="terminal" id="terminal" aria-live="polite">
              <div class="terminal-empty" id="terminal-empty">
                <div class="empty-icon" aria-hidden="true">◇</div>
                <p class="empty-title">Start a turn</p>
                <p class="muted empty-hint">Your message appears here right away. YamX or the shell replies below when ready.</p>
              </div>
            </main>
                <form class="commandbar" id="command-form">
                  <span class="prompt" aria-hidden="true">&gt;</span>
                  <input id="command-input" name="command" autocomplete="off" spellcheck="false" placeholder="Message YamX…" autofocus aria-label="Message or command">
                  <button type="submit" title="Send to YamX">Send</button>
                </form>
              </div>
            </div>
          </div>
        </section>

        <section id="panel-settings" class="panel panel-settings" role="tabpanel" aria-labelledby="tab-settings-label">
          <span id="tab-settings-label" class="sr-only">Settings</span>
          <div class="panel-scroll">
            <div class="panel-inner panel-inner-settings">
              <p class="lead">Read/write <code>~/.yamx/config.json</code>. API keys are masked in the browser; leave a key blank to keep the saved value, or enter a new key to replace.</p>
              <div id="settings-status" class="status"></div>
              <div id="settings-mount"></div>
              <div class="btn-row">
                <button type="button" id="btn-save-config" class="primary">Save configuration</button>
                <button type="button" id="btn-reload-runtime">Reload agent cache</button>
                <button type="button" id="btn-reset-config" class="danger">Reset to defaults</button>
              </div>
            </div>
          </div>
        </section>

        <section id="panel-sessions" class="panel" role="tabpanel" aria-labelledby="tab-sessions-label">
          <span id="tab-sessions-label" class="sr-only">Sessions</span>
          <div class="panel-scroll">
            <div class="panel-inner">
              <p class="lead">Chat sessions in <code>~/.yamx/sessions/</code>. Full CRUD via this UI or the API. Changing the active session reloads the web agent on the next message.</p>
              <div id="sessions-status" class="status"></div>
              <div class="sessions-toolbar">
                <button type="button" id="btn-new-session" class="primary">New session</button>
                <button type="button" id="btn-refresh-sessions">Refresh</button>
              </div>
              <div class="table-wrap">
                <div id="sessions-mount"></div>
              </div>
            </div>
          </div>
        </section>

        <section id="panel-tools" class="panel" role="tabpanel" aria-labelledby="tab-tools-label">
          <span id="tab-tools-label" class="sr-only">Tools and API</span>
          <div class="panel-scroll">
            <div class="panel-inner panel-inner-wide">
              <div class="split-cards">
                <div class="card api-doc-card">
                  <h3 class="h3">HTTP API reference</h3>
                  <p class="muted">Grouped endpoints. Row copies the path. Expand for raw OpenAPI-style export.</p>
                  <div id="api-doc-mount" class="api-doc-mount"></div>
                  <details class="raw-api-details">
                    <summary>Raw <code>/api/routes</code> JSON</summary>
                    <pre id="routes-pre" class="code code-tight"></pre>
                  </details>
                </div>
                <div class="card tools-card">
                  <h3 class="h3">Tool registry</h3>
                  <label class="tool-filter-label">Filter <input type="search" id="tool-filter" class="tool-filter" placeholder="Name or description…" autocomplete="off"></label>
                  <div id="tools-mount"></div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
  <script src="/app.js"></script>
</body>
</html>`;

export const WEB_CSS = `:root {
  color-scheme: dark;
  --bg: #0d0f0e;
  --panel: #141816;
  --panel-2: #1a1f1c;
  --line: #2d3632;
  --text: #e8eeea;
  --muted: #8a9a91;
  --accent: #5ee17a;
  --accent-dim: #3fb95c;
  --warn: #e6c86e;
  --bad: #f07178;
  --shadow: rgba(0, 0, 0, .35);
  --sidebar-w: 248px;
  --mainbar-h: 52px;
}

* { box-sizing: border-box; }

html, body {
  height: 100%;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 system-ui, Segoe UI, Roboto, Ubuntu, sans-serif;
}

body { min-width: 280px; }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

code {
  font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--panel-2);
  padding: 1px 6px;
  border-radius: 4px;
}

/* App shell: sidebar + main */
.app-shell {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: stretch;
}

.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 14px;
  background: var(--panel);
  border-right: 1px solid var(--line);
  box-shadow: 4px 0 24px var(--shadow);
}

.sidebar-brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.brand { font-weight: 800; font-size: 1.15rem; letter-spacing: -0.02em; }
.brand-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: var(--accent);
  opacity: .9;
}

.sidebar-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sub {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.ver { font-size: 10px; color: var(--muted); opacity: .85; }

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  flex: 1;
  min-height: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-height: 42px;
  transition: background .12s, color .12s, border-color .12s;
}
.nav-item:hover {
  color: var(--text);
  background: rgba(94, 225, 122, .08);
  border-color: rgba(45, 54, 50, .6);
}
.nav-item.active {
  color: var(--accent);
  background: var(--panel-2);
  border-color: var(--line);
  font-weight: 600;
}
.nav-ico {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 13px;
  width: 1.25rem;
  opacity: .75;
}
.nav-item.active .nav-ico { opacity: 1; }
.nav-label { flex: 1; min-width: 0; }

.sidebar-hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(0, 0, 0, .45);
  opacity: 0;
  transition: opacity .2s ease;
}
.sidebar-backdrop.show {
  display: block;
  opacity: 1;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}

.mainbar {
  flex-shrink: 0;
  height: var(--mainbar-h);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px 0 10px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 1px 10px var(--shadow);
}

.menu-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  padding: 0;
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  cursor: pointer;
}
.menu-toggle:hover { border-color: var(--accent-dim); }
.burger {
  display: block;
  width: 18px;
  height: 2px;
  background: var(--text);
  border-radius: 1px;
  box-shadow: 0 -6px 0 var(--text), 0 6px 0 var(--text);
}

.mainbar-title {
  flex: 1;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: -0.02em;
  min-width: 0;
}
.mainbar-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.pill {
  min-width: 72px;
  text-align: center;
  padding: 5px 10px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
}
.pill.ok { color: var(--accent); border-color: var(--accent-dim); }
.pill.bad { color: var(--bad); }

.main-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.panel {
  display: none;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.panel.active { display: flex; }

.panel-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.panel-inner {
  padding: 20px 22px 32px;
  max-width: 960px;
  margin: 0 auto;
}
.panel-inner-wide { max-width: 1200px; }
.panel-inner-settings { max-width: 920px; }

.panel-shell {
  background: radial-gradient(ellipse 120% 80% at 50% -20%, rgba(94, 225, 122, 0.06), transparent 55%),
    var(--bg);
}

/* Centered shell card — scroll happens inside .terminal only */
.shell-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: stretch;
  padding: clamp(12px, 2.5vw, 22px) clamp(12px, 3vw, 26px) clamp(14px, 2.5vh, 26px);
  overflow: hidden;
}

.shell-card {
  width: 100%;
  max-width: 880px;
  flex: 1 1 auto;
  min-height: min(420px, 52vh);
  max-height: min(86vh, calc(100dvh - var(--mainbar-h) - 48px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow:
    0 4px 6px rgba(0, 0, 0, 0.12),
    0 16px 48px rgba(0, 0, 0, 0.38),
    inset 0 1px 0 rgba(255, 255, 255, 0.045);
  overflow: hidden;
}

/* Terminal workspace inside shell card */
.terminal-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.terminal-chrome {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  font-size: 11px;
}
.chrome-title { font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.chrome-hint { font-size: 11px; }

.table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin-top: 4px;
}

.split-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 18px;
  align-items: start;
}
.card {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px 18px;
  background: var(--panel);
}
.card .h3 { margin: 0 0 8px; }

/* Settings: horizontal section tabs */
.settings-shell {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
}

.settings-tablist {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 4px 14px;
  margin: 0 -4px 4px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.settings-tab {
  flex: 0 0 auto;
  margin: 0;
  padding: 9px 16px;
  height: auto;
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.settings-tab:hover {
  color: var(--text);
  border-color: rgba(94, 225, 122, 0.35);
  background: rgba(94, 225, 122, 0.06);
}

.settings-tab.active {
  color: var(--accent);
  border-color: var(--accent-dim);
  background: rgba(94, 225, 122, 0.1);
  font-weight: 600;
}

.settings-panels {
  min-height: 0;
}

.settings-tab-panel {
  display: none;
  padding: 4px 2px 8px;
}

.settings-tab-panel.active {
  display: block;
}

.settings-tab-panel .form-section {
  margin: 0;
}

.settings-tab-panel .form-section + .form-section {
  margin-top: 14px;
}

.lead { color: var(--muted); margin: 0 0 16px; max-width: 70ch; }
.h3 { margin: 24px 0 8px; font-size: 1rem; }
.muted { color: var(--muted); font-size: 13px; }

.status {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  display: none;
}
.status.show { display: block; }
.status.ok { background: rgba(94, 225, 122, .12); color: var(--accent); }
.status.err { background: rgba(240, 113, 120, .12); color: var(--bad); }

.form-grid {
  display: grid;
  gap: 14px;
}
.form-section {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--panel);
}
.form-section h4 {
  margin: 0 0 12px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--muted);
}
.provider-block {
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.provider-block:last-child {
  border-bottom: 0;
  margin-bottom: 0;
  padding-bottom: 0;
}
.field {
  margin-bottom: 12px;
}
.field:last-child { margin-bottom: 0; }
.field label {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.settings-tab-panel .field input[type="text"],
.settings-tab-panel .field input[type="password"],
.settings-tab-panel .field input[type="number"],
.settings-tab-panel .field select,
.settings-tab-panel .field textarea {
  max-width: 100%;
}
.field input[type="text"],
.field input[type="password"],
.field input[type="number"],
.field select,
.field textarea {
  width: 100%;
  max-width: min(560px, 100%);
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--text);
  font: 13px ui-monospace, Menlo, Consolas, monospace;
}
.field textarea { min-height: 64px; resize: vertical; }
.field input[type="checkbox"] {
  width: auto;
  margin-right: 8px;
}
.inline-check label { display: inline; }

.btn-row {
  margin-top: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
button.primary {
  background: #1e4d2e;
  border-color: var(--accent-dim);
  color: var(--text);
}
button.danger {
  background: #4a2226;
  border-color: #8b4048;
  color: #ffc9cc;
}
button.small {
  padding: 6px 12px;
  font-size: 12px;
  margin-bottom: 12px;
}

table.sessions {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
table.sessions th, table.sessions td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}
table.sessions tr.active { background: rgba(94, 225, 122, .08); }
table.sessions button {
  padding: 4px 10px;
  font-size: 12px;
}
table.sessions td.session-actions {
  vertical-align: middle;
}
.session-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.session-actions button {
  height: auto;
  min-height: 32px;
  min-width: 0;
}

.sessions-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  align-items: center;
}

button.danger-text {
  background: rgba(74, 34, 38, 0.6);
  border-color: #8b4048;
  color: #ffc9cc;
}

.api-doc-mount { margin-top: 10px; }
.api-group { margin-bottom: 18px; }
.api-group-title {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
}
.api-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.api-table th, .api-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
.api-table th {
  color: var(--muted);
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.api-row { cursor: pointer; }
.api-row:hover { background: rgba(94, 225, 122, 0.06); }
.http-method {
  display: inline-block;
  min-width: 54px;
  padding: 3px 8px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 10px;
  text-align: center;
  font-family: ui-monospace, monospace;
}
.http-method.m-get { background: rgba(126, 184, 255, 0.14); color: #9dc8ff; }
.http-method.m-post { background: rgba(94, 225, 122, 0.14); color: var(--accent); }
.http-method.m-patch { background: rgba(230, 200, 110, 0.14); color: var(--warn); }
.http-method.m-delete { background: rgba(240, 113, 120, 0.14); color: #ff9a9a; }
.api-path code { font-size: 12px; word-break: break-all; }
.api-body-hint { font-size: 11px; color: var(--muted); }
.raw-api-details { margin-top: 14px; }
.raw-api-details summary { cursor: pointer; color: var(--muted); }
.code-tight { max-height: 220px; margin-top: 8px; }

.tool-filter-label {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--muted);
}
.tool-filter {
  flex: 1;
  min-width: 140px;
  max-width: 320px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
}

details.tool-block {
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 8px;
  background: var(--panel);
}
details.tool-block summary {
  padding: 10px 12px;
  cursor: pointer;
  list-style: none;
}
details.tool-block summary::-webkit-details-marker { display: none; }
.tool-name { font-weight: 600; color: var(--accent); }
.tool-desc { font-size: 12px; color: var(--muted); margin-top: 4px; font-weight: 400; }
.tool-schema { margin: 0 12px 12px; max-height: 200px; font-size: 11px; }
.tool-hidden { display: none !important; }

pre.code {
  background: var(--panel-2);
  border: 1px solid var(--line);
  padding: 12px;
  border-radius: 8px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.4;
  max-height: min(50vh, 360px);
}

.terminal {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px 16px 24px;
  background: var(--bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  -webkit-overflow-scrolling: touch;
}

.terminal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 20px 48px;
  min-height: 120px;
  color: var(--muted);
}
.terminal-empty.is-hidden { display: none; }
.empty-icon {
  font-size: 1.75rem;
  opacity: 0.35;
  margin-bottom: 10px;
}
.empty-title {
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
}
.empty-hint { margin: 0; max-width: 36ch; font-size: 13px; line-height: 1.45; }

.entry {
  margin: 0 0 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(45, 54, 50, .55);
}
.entry.turn {
  margin: 0 0 14px;
  padding: 14px 14px 16px;
  border-bottom: none;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: rgba(26, 31, 28, 0.5);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
}

.user-prompt {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.user-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
  font-family: system-ui, Segoe UI, Roboto, sans-serif;
}
.user-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--text);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  padding: 10px 12px;
  background: var(--panel-2);
  border-radius: 8px;
  border-left: 3px solid var(--accent-dim);
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.assistant { position: relative; }

.pending-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: rgba(94, 225, 122, 0.07);
  border-radius: 8px;
  border: 1px dashed rgba(94, 225, 122, 0.28);
  color: var(--muted);
  font-size: 13px;
  font-family: system-ui, Segoe UI, Roboto, sans-serif;
}

.spinner {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: yamx-spin 0.65s linear infinite;
}
@keyframes yamx-spin {
  to { transform: rotate(360deg); }
}

.pending-text { flex: 1; min-width: 100px; }
.pending-elapsed {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  opacity: 0.9;
}

.result-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}
.kind-chip {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(94, 225, 122, 0.12);
  border: 1px solid rgba(94, 225, 122, 0.35);
  color: var(--accent);
  font-family: system-ui, Segoe UI, Roboto, sans-serif;
}
.kind-chip.shell {
  color: #8ec5ff;
  background: rgba(126, 184, 255, 0.1);
  border-color: rgba(126, 184, 255, 0.35);
}
.kind-chip.err {
  color: var(--bad);
  background: rgba(240, 113, 120, 0.12);
  border-color: rgba(240, 113, 120, 0.4);
}

/* Legacy single-block layout (if ever used) */
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
}
.meta.fail { color: var(--bad); }
.meta.warn { color: var(--warn); }
pre.out {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.commandbar {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: var(--panel);
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.prompt { color: var(--accent); font-weight: 700; }
.commandbar input {
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
.commandbar input:focus { border-color: var(--accent); }

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
button:disabled { opacity: .55; cursor: wait; }

.settings-tablist .settings-tab {
  height: auto;
}

.menu-toggle { min-width: unset; }

@media (max-width: 900px) {
  .split-cards {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .app-shell { position: relative; }
  .menu-toggle { display: flex; }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 100;
    width: min(300px, 88vw);
    max-width: 100%;
    transform: translateX(-102%);
    transition: transform 0.22s ease;
    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.45);
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .sidebar-backdrop.show {
    display: block;
  }

  .mainbar-title { font-size: 0.95rem; }
  .pill { min-width: 0; padding: 5px 8px; font-size: 11px; }

  .panel-inner {
    padding: 16px 14px 28px;
  }

  table.sessions {
    font-size: 12px;
  }
  table.sessions th,
  table.sessions td {
    padding: 6px 8px;
  }

  .chrome-hint { display: none; }

  .shell-stage {
    padding: 10px 12px 14px;
    overflow: hidden;
  }
  .shell-card {
    max-width: 100%;
    max-height: min(82vh, calc(100dvh - var(--mainbar-h) - 44px));
    border-radius: 12px;
    min-height: min(300px, 48vh);
  }
}

@media (max-width: 560px) {
  .commandbar {
    grid-template-columns: auto 1fr;
    padding: 10px 12px;
    gap: 8px;
  }
  .commandbar button {
    grid-column: 1 / -1;
    justify-self: stretch;
    width: 100%;
  }
  .btn-row button {
    width: 100%;
    justify-self: stretch;
  }
}`;

export const WEB_JS = `
(function () {
  const terminal = document.getElementById('terminal');
  const form = document.getElementById('command-form');
  const input = document.getElementById('command-input');
  const state = document.getElementById('state');
  const cwd = document.getElementById('cwd');
  const appVer = document.getElementById('app-ver');
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const menuToggle = document.getElementById('menu-toggle');
  const mainbarTitle = document.getElementById('mainbar-title');
  const settingsMount = document.getElementById('settings-mount');
  const settingsStatus = document.getElementById('settings-status');
  const sessionsMount = document.getElementById('sessions-mount');
  const sessionsStatus = document.getElementById('sessions-status');
  const apiDocMount = document.getElementById('api-doc-mount');
  const routesPre = document.getElementById('routes-pre');
  const toolsMount = document.getElementById('tools-mount');
  const toolFilter = document.getElementById('tool-filter');
  var toolsListCache = [];

  const PANEL_TITLES = {
    terminal: 'Shell',
    settings: 'Settings',
    sessions: 'Sessions',
    tools: 'Tools & API'
  };

  const PROVIDERS = ['openai', 'anthropic', 'gemini', 'kimi', 'grok', 'openrouter', 'ollama'];

  function text(value) {
    return String(value == null ? '' : value);
  }

  function setState(label, cls) {
    state.textContent = label;
    state.className = 'pill' + (cls ? ' ' + cls : '');
  }

  function setSettingsStatus(msg, kind) {
    settingsStatus.textContent = msg || '';
    settingsStatus.className = 'status show ' + (kind || '');
    if (!msg) settingsStatus.className = 'status';
  }

  function setSessionsStatus(msg, kind) {
    if (!sessionsStatus) return;
    sessionsStatus.textContent = msg || '';
    sessionsStatus.className = 'status show ' + (kind || '');
    if (!msg) sessionsStatus.className = 'status';
  }

  function getPath(obj, path) {
    const parts = path.split('.');
    let v = obj;
    for (const p of parts) {
      if (v == null) return undefined;
      v = v[p];
    }
    return v;
  }

  function closeMobileNav() {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('show');
    sidebarBackdrop.setAttribute('aria-hidden', 'true');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  }

  function openMobileNav() {
    sidebar.classList.add('open');
    sidebarBackdrop.classList.add('show');
    sidebarBackdrop.setAttribute('aria-hidden', 'false');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
  }

  function toggleMobileNav() {
    if (sidebar.classList.contains('open')) closeMobileNav();
    else openMobileNav();
  }

  function showPanel(name) {
    document.querySelectorAll('.nav-item').forEach(function (t) {
      var on = t.dataset.panel === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    if (mainbarTitle) mainbarTitle.textContent = PANEL_TITLES[name] || name;
    closeMobileNav();

    if (name === 'settings') loadSettings();
    if (name === 'sessions') loadSessions();
    if (name === 'tools') loadToolsApi();
    if (name === 'terminal') input.focus();
  }

  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showPanel(btn.dataset.panel);
    });
  });

  if (menuToggle) {
    menuToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMobileNav();
    });
  }
  sidebarBackdrop.addEventListener('click', closeMobileNav);
  window.addEventListener('resize', function () {
    if (window.matchMedia('(min-width: 769px)').matches) closeMobileNav();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeMobileNav();
  });

  function hideTerminalEmpty() {
    var el = document.getElementById('terminal-empty');
    if (el) el.classList.add('is-hidden');
  }

  function pendingLabelFor(cmd) {
    var t = String(cmd || '').trim();
    if (/^(npm|npx|pnpm|yarn|git|node|cd|dir|ls|pwd|curl|wget|python|py|go\\s|cargo\\s|dotnet\\s|docker\\s)/i.test(t)) return 'Running command…';
    if (/^[a-zA-Z0-9_.\\/~+-]+$/.test(t) && t.length < 72 && !/\\s/.test(t)) return 'Running command…';
    if (t.length > 96 || /[?]/.test(t) || /^(why|how|what|explain|write|create|fix|help|show|list|describe)\\b/i.test(t)) return 'YamX is responding…';
    return 'Working…';
  }

  function metaLineText(result) {
    if (result.kind === 'error') return '';
    var failed = result.blocked || result.code !== 0 || result.timedOut;
    return result.kind === 'chat'
      ? ['provider=' + (result.provider || ''), 'model=' + (result.model || ''), 'cwd=' + (result.cwd || ''), (result.durationMs != null ? result.durationMs + 'ms' : '')].filter(Boolean).join(' | ')
      : ['shell=' + (result.shell || ''), 'cwd=' + (result.cwd || ''), (result.durationMs != null ? result.durationMs + 'ms' : ''), result.blocked ? 'blocked' : 'exit=' + result.code].filter(Boolean).join(' | ');
  }

  function startTurn(command) {
    hideTerminalEmpty();
    var entry = document.createElement('section');
    entry.className = 'entry turn';

    var userRow = document.createElement('div');
    userRow.className = 'user-prompt';
    var ul = document.createElement('span');
    ul.className = 'user-label';
    ul.textContent = 'You';
    var ut = document.createElement('p');
    ut.className = 'user-text';
    ut.textContent = command;
    userRow.appendChild(ul);
    userRow.appendChild(ut);

    var assist = document.createElement('div');
    assist.className = 'assistant';

    var pending = document.createElement('div');
    pending.className = 'pending-line';
    pending.setAttribute('aria-busy', 'true');
    var spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    var pt = document.createElement('span');
    pt.className = 'pending-text';
    pt.textContent = pendingLabelFor(command);
    var pe = document.createElement('span');
    pe.className = 'pending-elapsed';
    pe.textContent = '0 ms';
    pending.appendChild(spinner);
    pending.appendChild(pt);
    pending.appendChild(pe);
    assist.appendChild(pending);
    entry.appendChild(userRow);
    entry.appendChild(assist);
    terminal.appendChild(entry);

    var t0 = Date.now();
    var iv = setInterval(function () {
      if (!entry.isConnected) { clearInterval(iv); return; }
      var dt = Date.now() - t0;
      pe.textContent = dt < 1000 ? dt + ' ms' : (dt / 1000).toFixed(1) + ' s';
    }, 100);

    terminal.setAttribute('aria-busy', 'true');
    terminal.scrollTop = terminal.scrollHeight;

    function finishResult(result) {
      clearInterval(iv);
      if (pending.parentNode) pending.remove();
      terminal.setAttribute('aria-busy', 'false');

      var head = document.createElement('div');
      head.className = 'result-head';
      var chip = document.createElement('span');
      chip.className = 'kind-chip' + (result.kind === 'chat' ? '' : result.kind === 'error' ? ' err' : ' shell');
      chip.textContent = result.kind === 'chat' ? 'YamX' : result.kind === 'error' ? 'Error' : 'Shell';
      head.appendChild(chip);
      var metaStr = metaLineText(result);
      if (metaStr) {
        var meta = document.createElement('div');
        var failed = result.blocked || result.code !== 0 || result.timedOut;
        meta.className = 'meta ' + (result.blocked ? 'warn' : failed ? 'fail' : '');
        meta.textContent = metaStr;
        head.appendChild(meta);
      }
      var pre = document.createElement('pre');
      pre.className = 'out';
      pre.textContent = text(result.output);
      assist.appendChild(head);
      assist.appendChild(pre);
      terminal.scrollTop = terminal.scrollHeight;
    }

    return { finish: finishResult };
  }

  async function refreshState() {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('state failed');
    const data = await res.json();
    cwd.textContent = 'cwd: ' + data.cwd + (data.provider ? ' | ' + data.provider + (data.model ? ' / ' + data.model : '') : '');
    setState(data.allowDangerous ? 'danger on' : 'ready', data.allowDangerous ? 'bad' : 'ok');
  }

  async function refreshInfo() {
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        const j = await res.json();
        appVer.textContent = 'v' + j.version + ' · ' + j.node;
      }
    } catch (e) {}
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var command = input.value.trim();
    if (!command) return;
    input.value = '';
    input.disabled = true;
    var sendBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
    sendBtn.disabled = true;
    setState('running', '');
    var turn = startTurn(command);
    try {
      var res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: command })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        turn.finish({
          ok: false,
          kind: 'error',
          blocked: false,
          code: 1,
          output: (data && data.error) ? String(data.error) : 'HTTP ' + res.status,
          cwd: '.',
          allowDangerous: false
        });
        setState('error', 'bad');
      } else {
        turn.finish(data);
        cwd.textContent = 'cwd: ' + (data.cwd || '.') + (data.provider ? ' | ' + data.provider + (data.model ? ' / ' + data.model : '') : '');
        setState(data.allowDangerous ? 'danger on' : 'ready', data.allowDangerous ? 'bad' : 'ok');
      }
    } catch (error) {
      turn.finish({
        ok: false,
        kind: 'error',
        blocked: false,
        code: 1,
        output: 'Request failed: ' + (error && error.message ? error.message : String(error)),
        cwd: '.',
        allowDangerous: false
      });
      setState('error', 'bad');
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  });

  function renderSettingsForm(cfg) {
    settingsMount.innerHTML = '';

    var shell = document.createElement('div');
    shell.className = 'settings-shell';
    var tablist = document.createElement('div');
    tablist.className = 'settings-tablist';
    tablist.setAttribute('role', 'tablist');
    var panelsRoot = document.createElement('div');
    panelsRoot.className = 'settings-panels';

    var firstTabId = null;

    function addSettingsTab(id, label, fill) {
      if (!firstTabId) firstTabId = id;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-tab';
      btn.dataset.settingsTab = id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('aria-controls', 'settings-panel-' + id);
      btn.textContent = label;
      var pan = document.createElement('div');
      pan.className = 'settings-tab-panel';
      pan.id = 'settings-panel-' + id;
      pan.dataset.settingsTab = id;
      pan.setAttribute('role', 'tabpanel');
      fill(pan);
      tablist.appendChild(btn);
      panelsRoot.appendChild(pan);
    }

    function showSettingsTab(id) {
      tablist.querySelectorAll('.settings-tab').forEach(function (b) {
        var on = b.dataset.settingsTab === id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panelsRoot.querySelectorAll('.settings-tab-panel').forEach(function (p) {
        var on = p.dataset.settingsTab === id;
        p.classList.toggle('active', on);
      });
    }

    tablist.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.settings-tab');
      if (!t || !tablist.contains(t)) return;
      showSettingsTab(t.dataset.settingsTab);
    });

    function addField(parent, label, child) {
      var f = document.createElement('div');
      f.className = 'field';
      var l = document.createElement('label');
      l.textContent = label;
      f.appendChild(l);
      f.appendChild(child);
      parent.appendChild(f);
    }

    var s = cfg.settings || {};

    addSettingsTab('general', 'General', function (pan) {
      var box = document.createElement('div');
      box.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Default model';
      box.appendChild(h);
      var inpDefProv = document.createElement('input');
      inpDefProv.type = 'text';
      inpDefProv.dataset.cfgPath = 'defaultProvider';
      inpDefProv.value = cfg.defaultProvider || '';
      addField(box, 'Default provider', inpDefProv);
      var inpDefMod = document.createElement('input');
      inpDefMod.type = 'text';
      inpDefMod.dataset.cfgPath = 'defaultModel';
      inpDefMod.value = cfg.defaultModel || '';
      addField(box, 'Default model id', inpDefMod);
      pan.appendChild(box);
    });

    addSettingsTab('providers', 'Providers', function (pan) {
      var box = document.createElement('div');
      box.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'API keys & models';
      box.appendChild(h);
      PROVIDERS.forEach(function (name) {
        var prov = (cfg.providers && cfg.providers[name]) || {};
        var sub = document.createElement('div');
        sub.className = 'provider-block';
        var ph = document.createElement('strong');
        ph.textContent = name;
        sub.appendChild(ph);
        var keyIn = document.createElement('input');
        keyIn.type = 'password';
        keyIn.autocomplete = 'new-password';
        keyIn.placeholder = (prov.apiKeyPresent || prov.apiKey === '********') ? '•••••••• (enter new key to replace)' : 'API key (optional)';
        keyIn.dataset.cfgPath = 'providers.' + name + '.apiKey';
        keyIn.dataset.optionalSecret = '1';
        addField(sub, 'API key', keyIn);
        var modIn = document.createElement('input');
        modIn.type = 'text';
        modIn.dataset.cfgPath = 'providers.' + name + '.model';
        modIn.value = prov.model || '';
        addField(sub, 'Model override', modIn);
        if (name === 'ollama') {
          var urlIn = document.createElement('input');
          urlIn.type = 'text';
          urlIn.dataset.cfgPath = 'providers.' + name + '.baseUrl';
          urlIn.value = prov.baseUrl || '';
          addField(sub, 'Base URL', urlIn);
        }
        box.appendChild(sub);
      });
      pan.appendChild(box);
    });

    addSettingsTab('behavior', 'Behavior', function (pan) {
      var st = document.createElement('div');
      st.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Runtime & permissions';
      st.appendChild(h);

      function boolField(path, label) {
        var wrap = document.createElement('div');
        wrap.className = 'field inline-check';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.cfgPath = path;
        cb.checked = !!getPath(cfg, path);
        var lab = document.createElement('label');
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(' ' + label));
        wrap.appendChild(lab);
        st.appendChild(wrap);
      }
      boolField('settings.autoApprove', 'Auto-approve tools');
      boolField('settings.streamOutput', 'Stream output (CLI; web chat is non-streaming)');
      boolField('settings.autoCommit', 'Auto-commit');
      boolField('settings.hooksEnabled', 'Hooks enabled');
      boolField('settings.verboseCli', 'Verbose CLI');
      boolField('settings.preflightRuntimeProbes', 'Preflight runtime probes');
      boolField('settings.checkForUpdates', 'Check for CLI updates');

      function numField(path, label, min, max, step) {
        var i = document.createElement('input');
        i.type = 'number';
        i.dataset.cfgPath = path;
        i.min = min;
        i.max = max;
        i.step = step || 1;
        i.value = String(getPath(cfg, path) ?? '');
        addField(st, label, i);
      }
      numField('settings.maxTokens', 'Max tokens', 256, 200000, 1);
      numField('settings.temperature', 'Temperature', 0, 2, 0.05);
      numField('settings.contextBudgetChars', 'Context budget (chars)', 10000, 2000000, 1000);
      numField('settings.maxToolResultChars', 'Max tool result chars', 1000, 500000, 500);
      numField('settings.maxAssistantMarkdownChars', 'Max assistant markdown chars', 500, 100000, 100);

      var pm = document.createElement('select');
      pm.dataset.cfgPath = 'settings.permissionMode';
      ['default', 'ask', 'read-only', 'auto-safe'].forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        pm.appendChild(o);
      });
      pm.value = s.permissionMode || 'default';
      addField(st, 'Permission mode', pm);

      pan.appendChild(st);
    });

    addSettingsTab('council', 'Model council', function (pan) {
      var mc = document.createElement('div');
      mc.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Council';
      mc.appendChild(h);
      var mcRow = document.createElement('div');
      mcRow.className = 'field inline-check';
      var mcEn = document.createElement('input');
      mcEn.type = 'checkbox';
      mcEn.dataset.cfgPath = 'settings.modelCouncil.enabled';
      mcEn.checked = !!(s.modelCouncil && s.modelCouncil.enabled);
      var mcLab = document.createElement('label');
      mcLab.appendChild(mcEn);
      mcLab.appendChild(document.createTextNode(' Enable council'));
      mcRow.appendChild(mcLab);
      mc.appendChild(mcRow);
      var mcMode = document.createElement('select');
      mcMode.dataset.cfgPath = 'settings.modelCouncil.mode';
      ['adaptive', 'always', 'off'].forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        mcMode.appendChild(o);
      });
      mcMode.value = (s.modelCouncil && s.modelCouncil.mode) || 'adaptive';
      addField(mc, 'Council mode', mcMode);
      pan.appendChild(mc);
    });

    addSettingsTab('subagents', 'Subagents', function (pan) {
      var sa = document.createElement('div');
      sa.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Subagents';
      sa.appendChild(h);
      var saRow = document.createElement('div');
      saRow.className = 'field inline-check';
      var saEn = document.createElement('input');
      saEn.type = 'checkbox';
      saEn.dataset.cfgPath = 'settings.subagents.enabled';
      saEn.checked = !!(s.subagents && s.subagents.enabled);
      var saLab = document.createElement('label');
      saLab.appendChild(saEn);
      saLab.appendChild(document.createTextNode(' Enable subagents'));
      saRow.appendChild(saLab);
      sa.appendChild(saRow);
      var saMod = document.createElement('input');
      saMod.type = 'text';
      saMod.dataset.cfgPath = 'settings.subagents.defaultModel';
      saMod.value = (s.subagents && s.subagents.defaultModel) || '';
      addField(sa, 'Default subagent model', saMod);
      pan.appendChild(sa);
    });

    addSettingsTab('shell', 'Shell policy', function (pan) {
      var arr = document.createElement('div');
      arr.className = 'form-section';
      var h = document.createElement('h4');
      h.textContent = 'Allow / deny lists';
      arr.appendChild(h);
      var al = document.createElement('textarea');
      al.dataset.cfgPath = 'settings.allowedShellCommands';
      al.value = Array.isArray(s.allowedShellCommands) ? s.allowedShellCommands.join('\\n') : '';
      addField(arr, 'Allowed shell commands (newline or comma; empty = no extra allowlist)', al);
      var dn = document.createElement('textarea');
      dn.dataset.cfgPath = 'settings.deniedShellPatterns';
      dn.value = Array.isArray(s.deniedShellPatterns) ? s.deniedShellPatterns.join('\\n') : '';
      addField(arr, 'Denied shell patterns', dn);
      pan.appendChild(arr);
    });

    shell.appendChild(tablist);
    shell.appendChild(panelsRoot);
    settingsMount.appendChild(shell);
    showSettingsTab(firstTabId);
  }

  function buildPatchFromForm() {
    var patch = { settings: {}, providers: {} };
    settingsMount.querySelectorAll('[data-cfg-path]').forEach(function (el) {
      var path = el.dataset.cfgPath;
      var parts = path.split('.');
      var val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.type === 'number') {
        val = parseFloat(el.value);
        if (!isFinite(val)) return;
      } else val = el.value;

      if (el.dataset.optionalSecret && (!val || !String(val).trim())) return;

      if (path === 'settings.allowedShellCommands' || path === 'settings.deniedShellPatterns') {
        var raw = String(val || '').split(/[\\n,]+/).map(function (x) { return x.trim(); }).filter(Boolean);
        val = raw;
      }

      if (parts[0] === 'providers') {
        var pname = parts[1];
        var key = parts[2];
        if (!patch.providers[pname]) patch.providers[pname] = {};
        patch.providers[pname][key] = val;
        return;
      }
      if (parts[0] === 'settings') {
        var k = parts.slice(1);
        var cur = patch.settings;
        for (var i = 0; i < k.length - 1; i++) {
          if (!cur[k[i]]) cur[k[i]] = {};
          cur = cur[k[i]];
        }
        cur[k[k.length - 1]] = val;
        return;
      }
      if (path === 'defaultProvider') patch.defaultProvider = val;
      if (path === 'defaultModel') patch.defaultModel = val;
    });
    if (Object.keys(patch.providers).length === 0) delete patch.providers;
    if (Object.keys(patch.settings).length === 0) delete patch.settings;
    return patch;
  }

  var settingsLoaded = false;
  async function loadSettings() {
    setSettingsStatus('', '');
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('config GET failed');
      const data = await res.json();
      renderSettingsForm(data.config || {});
      settingsLoaded = true;
    } catch (e) {
      setSettingsStatus('Failed to load config: ' + e.message, 'err');
    }
  }

  document.getElementById('btn-save-config').addEventListener('click', async function () {
    setSettingsStatus('Saving…', 'ok');
    try {
      const patch = buildPatchFromForm();
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'save failed');
      renderSettingsForm(data.config || {});
      setSettingsStatus('Saved. Agent cache cleared for next chat.', 'ok');
      refreshState().catch(function () {});
    } catch (e) {
      setSettingsStatus('Save failed: ' + e.message, 'err');
    }
  });

  document.getElementById('btn-reload-runtime').addEventListener('click', async function () {
    try {
      const res = await fetch('/api/runtime/reload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const data = await res.json();
      setSettingsStatus(data.message || 'OK', 'ok');
    } catch (e) {
      setSettingsStatus(e.message, 'err');
    }
  });

  document.getElementById('btn-reset-config').addEventListener('click', async function () {
    if (!confirm('Reset ~/.yamx/config.json to defaults?')) return;
    try {
      const res = await fetch('/api/config/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'reset failed');
      renderSettingsForm(data.config || {});
      setSettingsStatus('Reset to defaults.', 'ok');
      refreshState().catch(function () {});
    } catch (e) {
      setSettingsStatus(e.message, 'err');
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function httpMethodClass(m) {
    var u = String(m || '').toUpperCase();
    if (u === 'GET') return 'http-method m-get';
    if (u === 'POST') return 'http-method m-post';
    if (u === 'PATCH') return 'http-method m-patch';
    if (u === 'DELETE') return 'http-method m-delete';
    return 'http-method';
  }

  function renderToolsList(filter) {
    var q = (filter || '').trim().toLowerCase();
    var shown = 0;
    var html = '';
    toolsListCache.forEach(function (t) {
      var hay = (t.name + ' ' + (t.description || '')).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      shown++;
      var paramsJson = '';
      try { paramsJson = JSON.stringify(t.parameters, null, 2); } catch (e) { paramsJson = '{}'; }
      html += '<details class="tool-block">';
      html += '<summary><div class="tool-name">' + escapeHtml(t.name) + '</div>';
      html += '<div class="tool-desc">' + escapeHtml(t.description || '') + '</div></summary>';
      html += '<pre class="code tool-schema">' + escapeHtml(paramsJson) + '</pre>';
      html += '</details>';
    });
    toolsMount.innerHTML = '<p class="muted tools-count">' + shown + ' / ' + toolsListCache.length + ' tools</p>' + html;
  }

  async function sessionRowAction(ev) {
    var btn = ev.currentTarget;
    var act = btn.dataset.act;
    var id = btn.dataset.sid;
    setSessionsStatus('', '');
    if (act === 'active') {
      var r = await fetch('/api/sessions/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
      if (r.ok) loadSessions();
      else {
        var ej = await r.json().catch(function () { return {}; });
        setSessionsStatus((ej && ej.error) || 'Could not set active', 'err');
      }
      return;
    }
    if (act === 'rename') {
      var sessionRes = await fetch('/api/sessions/' + encodeURIComponent(id));
      var sj = await sessionRes.json();
      var cur = (sj.session && sj.session.title) || '';
      var nt = prompt('Session title:', cur);
      if (nt === null) return;
      var patch = await fetch('/api/sessions/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: nt })
      });
      var pj = await patch.json().catch(function () { return {}; });
      if (patch.ok) loadSessions();
      else setSessionsStatus((pj && pj.error) || 'Rename failed', 'err');
      return;
    }
    if (act === 'delete') {
      if (!confirm('Delete this session permanently?')) return;
      var d = await fetch('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
      var dj = await d.json().catch(function () { return {}; });
      if (d.ok) loadSessions();
      else setSessionsStatus((dj && dj.error) || 'Delete failed', 'err');
    }
  }

  async function loadSessions() {
    sessionsMount.innerHTML = 'Loading…';
    setSessionsStatus('', '');
    try {
      var res = await fetch('/api/sessions');
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'sessions failed');
      var rows = '';
      (data.sessions || []).forEach(function (s) {
        var isActive = s.id === data.activeSessionId;
        rows += '<tr' + (isActive ? ' class="active"' : '') + '>';
        rows += '<td>' + escapeHtml(s.title) + '</td>';
        rows += '<td>' + s.messageCount + '</td>';
        rows += '<td>' + escapeHtml(s.updatedAt) + '</td>';
        rows += '<td class="session-actions">';
        rows += '<button type="button" data-act="active" data-sid="' + escapeHtml(s.id) + '"' + (isActive ? ' disabled' : '') + '>Use</button>';
        rows += '<button type="button" data-act="rename" data-sid="' + escapeHtml(s.id) + '">Rename</button>';
        rows += '<button type="button" class="danger-text" data-act="delete" data-sid="' + escapeHtml(s.id) + '">Delete</button>';
        rows += '</td></tr>';
      });
      if (!data.sessions || data.sessions.length === 0) {
        sessionsMount.innerHTML = '<p class="muted">No sessions yet. Create one with <strong>New session</strong>.</p>';
      } else {
        sessionsMount.innerHTML = '<table class="sessions"><thead><tr><th>Title</th><th>Msgs</th><th>Updated</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table>';
        sessionsMount.querySelectorAll('button[data-act]').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            sessionRowAction(e).catch(function (err) {
              setSessionsStatus(err.message || String(err), 'err');
            });
          });
        });
      }
    } catch (e) {
      sessionsMount.innerHTML = '';
      setSessionsStatus('Error: ' + e.message, 'err');
    }
  }

  document.getElementById('btn-new-session').addEventListener('click', async function () {
    var title = prompt('Optional title for the new session:', '');
    if (title === null) return;
    setSessionsStatus('Creating…', 'ok');
    try {
      var r = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title ? title : undefined, activate: true })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error((j && j.error) || 'Create failed');
      setSessionsStatus('Session created.', 'ok');
      loadSessions();
    } catch (e) {
      setSessionsStatus(e.message, 'err');
    }
  });

  document.getElementById('btn-refresh-sessions').addEventListener('click', loadSessions);

  async function loadToolsApi() {
    if (apiDocMount) apiDocMount.innerHTML = 'Loading…';
    routesPre.textContent = 'Loading…';
    toolsMount.innerHTML = '';
    try {
      var r1 = await fetch('/api/routes');
      var j1 = await r1.json();
      routesPre.textContent = JSON.stringify(j1, null, 2);
      if (apiDocMount && j1.groups) {
        var docHtml = '';
        j1.groups.forEach(function (g) {
          docHtml += '<div class="api-group"><h4 class="api-group-title">' + escapeHtml(g.name) + '</h4>';
          docHtml += '<table class="api-table"><thead><tr><th></th><th>Path</th><th>Body</th><th>Note</th></tr></thead><tbody>';
          (g.endpoints || []).forEach(function (e) {
            docHtml += '<tr class="api-row" data-path="' + escapeHtml(e.path) + '">';
            docHtml += '<td><span class="' + httpMethodClass(e.method) + '">' + escapeHtml(e.method) + '</span></td>';
            docHtml += '<td class="api-path"><code>' + escapeHtml(e.path) + '</code></td>';
            docHtml += '<td class="api-body-hint">' + (e.body ? '<code>' + escapeHtml(e.body) + '</code>' : '—') + '</td>';
            docHtml += '<td>' + escapeHtml(e.note || '') + '</td>';
            docHtml += '</tr>';
          });
          docHtml += '</tbody></table></div>';
        });
        apiDocMount.innerHTML = docHtml;
      } else if (apiDocMount) {
        apiDocMount.textContent = 'No grouped routes in response.';
      }
      var r2 = await fetch('/api/tools');
      var j2 = await r2.json();
      toolsListCache = j2.tools || [];
      renderToolsList(toolFilter ? toolFilter.value : '');
    } catch (e) {
      if (apiDocMount) apiDocMount.textContent = 'Error: ' + e.message;
      routesPre.textContent = 'Error: ' + e.message;
    }
  }

  if (toolFilter) {
    toolFilter.addEventListener('input', function () {
      renderToolsList(toolFilter.value);
    });
  }

  if (apiDocMount) {
    apiDocMount.addEventListener('click', function (e) {
      var row = e.target.closest('tr.api-row');
      if (!row || !apiDocMount.contains(row)) return;
      var path = row.getAttribute('data-path');
      if (path && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(path).catch(function () {});
      }
    });
  }

  refreshState().catch(function () { setState('error', 'bad'); });
  refreshInfo().catch(function () {});
})();
`;
