# YamX Context Memory

Last updated: 2026-05-11

## 1) Project identity

- Name: **YamX** (`@needyamin/yamx`)
- Type: terminal-first coding and ops agent with local Web UI + local HTTP API
- Runtime: Node.js ESM + TypeScript
- Core goal: **offline-first**, local evidence first, minimal-token practical execution

## 2) Main architecture

- CLI entry: `src/index.ts`
- Agent loop + tools orchestration: `src/agent.ts`
- System prompt/context builder: `src/context.ts`
- Local ops preflight probes: `src/runtime-preflight.ts`
- Direct command routing: `src/direct-command.ts`
- Web server/API: `src/web/server.ts`
- Web UI static app bundle source: `src/web/ui.ts`
- Tool registry and implementations: `src/tools/`
- Provider factory: `src/providers/factory.ts`

## 3) Runtime behavior contracts

- Direct shell-like input routes to command execution quickly.
- Non-command input routes to model + tools.
- Intent guard exists so greetings/chitchat do not trigger heavy ops flows.
- Sessions persist under `~/.yamx/sessions`.
- Config lives at `~/.yamx/config.json`.
- Project-local memory/intel is kept under `.yamx/` in the repo.

## 4) Offline-first intelligence (current high-level behavior)

- Local preflight probes are injected for runtime/install/diagnose intents.
- Vague ops asks (like "install it" / "diagnose it") use project preflight probes.
- Command suggestions combine:
  - Seeded `.yamx/command-intelligence.json`
  - Learned `.yamx/command-memory.json`
- Ranking is capability-aware and incident-aware (prefers locally-valid commands).

## 5) Recent major engineering upgrades (this cycle)

- `src/context.ts` strengthened for stricter offline-first and incident-order behavior.
- `src/index.ts` startup help/noise lines were removed (less annoying prompt output).
- `src/command-intelligence.ts` upgraded with top-tier ranking logic:
  - tier resolver (`top` default)
  - capability/risk/safety scoring
  - probe-first behavior for runtime/install checks
  - better typo tolerance and memory weighting
- `src/agent.ts` upgraded for elite engineering mode behavior:
  - stronger failure protocol packets
  - stricter retry discipline and escalation hints
- README expanded to document elite/top behavior and operating modes.

## 6) New Web engineering diagnostics (added now)

### New source module

- `src/web/engineering-diagnostics.ts`
  - Suite runner: `all | vm | fullstack | devops | network | security`
  - Profiles: `standard | deep`
  - Produces:
    - required/optional check results
    - probe outputs
    - overall + per-domain scores
    - VM signal hints
    - prioritized recommendations

### New API endpoints

- `GET /api/engineering/readiness`
  - Returns cached readiness snapshot (offline local probes)
  - `?force=1` bypasses cache
- `POST /api/engineering/challenge`
  - Body: `{ suite?, profile?, force? }`
  - Runs selected suite/profile and returns full report

### Web UI updates

- Tools & API panel now includes **Engineering readiness** card:
  - Suite selector
  - Profile selector
  - "Readiness snapshot" button
  - "Run challenge" button
  - status + summary + raw JSON report

## 7) Build/test reality in this environment

- Type-check succeeds: `npx.cmd tsc -p config/tsconfig.json --noEmit`
- Full build to `dist/` currently can fail on Windows with `EPERM` file locks in `dist/*`.
- Practical workaround used:
  - compile to temp outDir
  - copy changed compiled files into `dist/`

## 8) Security posture (intended)

- Default flow is defensive and local-first.
- Risky/destructive actions should remain blocked unless explicitly allowed.
- Web UI bind is loopback by default (`127.0.0.1`).
- Defensive cybersecurity support is in scope; offensive misuse is out of scope.

## 9) Quick operator commands

```bash
# Start CLI
yamx

# Start web panel
yamx web --host 127.0.0.1 --port 8765

# Type-check
npx.cmd tsc -p config/tsconfig.json --noEmit
```

## 10) Suggested next maintenance tasks

- Keep the context-memory link visible from the combined docs page (`docs/docs.html`).
- Add automated tests for `/api/engineering/readiness` and `/api/engineering/challenge`.
- Resolve the Windows `dist` file lock source so normal `npm run build` is reliable.
