# smith GUI

Browser-based interface for the smith CLI. Wraps every daily-workflow command — agents, skills, knowledge, daemon, doctor, update, jack-out, persistent job history — over the same machinery: every action shells out to `smith` and streams stdout back to the page over SSE.

> Looking for the **user-facing intro** with screenshots and the route map? See [README → Browser GUI](../README.md#browser-gui-smith-gui) at the repo root.
>
> This file is the **developer-facing reference**: dev server, architecture, tests, local CI gates.

## Launch

```bash
smith gui                       # default port 7777, auto-opens browser
smith gui --port 9000           # custom port
smith gui --no-open             # don't auto-open browser
smith gui --bind 127.0.0.1      # bind address (localhost-only by default)
```

The launch line prints a one-time token in the URL — keep the tab open; reloading without the token requires re-pasting it from the terminal.

## Run in development

```bash
# from repo root
bun run gui:dev          # starts Vite dev server on :5173 (proxies /api → :7777)
bun run src/index.ts gui --no-open --port 7777   # starts the server
```

Then open http://localhost:5173 (the dev server proxies API calls to the smith server).

## Run the bundled production build

```bash
bun run gui:build
bun run src/index.ts gui   # launches the server, opens your browser
```

## Architecture

- `gui/server/` — Hono HTTP server, job manager, CLI spawn wrappers, filesystem readers. Bound to `Bun.serve` with `idleTimeout: 255` so long-running SSE streams (knowledge refresh, update, doctor, etc.) survive.
- `gui/web/` — Vite + React + Tailwind frontend. React Router v6, React Query for server state, Zustand for local UI state.
- `gui/shared/` — Zod schemas + types imported by both. The `JobRequest` discriminated union is the contract between web and server for every spawnable command.

All writes flow through `Bun.spawn("smith", argv)`. Reads parse the filesystem directly.

## Testing

```bash
bun test gui/            # server + shared unit tests
cd gui/web && bun run test     # web unit tests (requires Node ≥18 — see below)
cd gui/web && bun run e2e      # playwright happy path (slow)
```

## Storybook

```bash
cd gui/web && bun run storybook
```

## Local CI gates

The repo has no GitHub Actions workflow. Before pushing GUI work, run these gates
locally — they are the same checks a CI workflow would run:

```bash
# from repo root
bun run gui:check       # biome lint + format (gui/)
bun run gui:typecheck   # tsc --noEmit for gui/web
bun test gui/           # server + shared unit tests

# from gui/web (vitest + vite need Node; Bun cannot run them)
bun run --filter gui-web test    # web unit tests
bun run --filter gui-web build   # production bundle
```

> Note: **Node ≥18 is required for vitest and vite.** The `gui/web` scripts
> route through `scripts/run-with-node.sh`, which prefers nvm-managed Node 20
> if available and otherwise uses whatever `node` is on `PATH` (any version
> ≥18 works). The server side (`bun test gui/`) and `gui:check` /
> `gui:typecheck` run under Bun.

## Phase 3 surfaces (Power & Admin)

| Route | Purpose |
|---|---|
| `/system/daemon` | Start/stop the smith daemon, tail its log over SSE, and tune `pullIntervalMs` / `heartbeatIntervalMs` in `$SMITH_HOME/.env` |
| `/system/update` | Preview commits behind `origin/main` (dry-run); run `smith update` with streamed progress |
| `/system/history` | Browse persistent job history, open captured per-job output, regex-search past output |
| `/system/jack-out` | Destructive uninstall with typed-phrase confirm (`jack-out`), MatrixRain UI, disconnect-as-success semantic |
| `/system/doctor` | (extended) Codex-hooks migration banner + `--fix-knowledge-refresh` one-click repair |
| `/skills/:name` | (extended) "validate" button in the header → `smith skill validate <name>` |

**New job commands:** `daemon.start`, `daemon.stop`, `update`, `knowledge.migrate-codex`, `skill.validate`, `jack-out`, plus the extended `doctor` variant with `fixKnowledgeRefresh: boolean`.

**Read-only endpoints (no job spawned):** `GET /api/daemon/status`, `GET /api/daemon/log/stream` (SSE), `GET /api/daemon/env`, `GET /api/update/preview`, `GET /api/history`, `GET /api/history/:id/output`, `GET /api/history/search`, `GET /api/jack-out/dry-run`.

## Persistent state

| Path | Owner | Purpose |
|---|---|---|
| `$XDG_STATE_HOME/agent-smith/gui-jobs.jsonl` | `JobManager.historyWriter` | append-only summary of every completed job (id, argv, exit code, durations, ended-at) |
| `$XDG_STATE_HOME/agent-smith/gui-jobs-output/<id>.log` | `JobManager.historyWriter` | per-job stdout+stderr capture, rotating with the JSONL |
| `$SMITH_HOME/.env` | user-editable | daemon env tunables surfaced by `/system/daemon` (`pullIntervalMs`, `heartbeatIntervalMs`) |

