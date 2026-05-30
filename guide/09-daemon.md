# The daemon

> The daemon is an optional background process that watches your registered bundles and skill catalogs for changes, re-installs affected agents automatically, and periodically `git pull`s any catalog you've registered with a git remote. Read this when you're iterating on a bundle and don't want to run `smith agent install` after every save, or when you need to debug a daemon that won't start, won't stop, or is silently failing to pull.

The daemon is **not required**. Everything it does, `smith agent install` and `smith agent install-all` do on demand. The daemon exists to remove the manual step during active development and to keep team-shared catalogs continuously up to date.

> **Tip — browser GUI.** `/system/daemon` in `smith gui` wraps `daemon start` / `stop` / `status`, tails `daemon.log` live over SSE, and offers a form for tuning `pullIntervalMs` / `heartbeatIntervalMs` in `$SMITH_HOME/.env` without dropping to a shell. See [README → Browser GUI](../README.md#browser-gui-smith-gui).

---

## Mental model

```
                 +---------------------------+
                 |  smith daemon (one proc)  |
                 +-------------+-------------+
                               |
       +----------------+------+------+-----------------+
       |                |             |                 |
   chokidar         setInterval   setInterval        heartbeat
   (file watcher)   (every 15min) (every 5min)       (every 5s)
       |                |             |                 |
   bundle/skill     git pull --ff   knowledge TTL    write atomic
   /USER.md edits   in registered   refresh tick     JSON to
       |            catalogs        (ttl-mode        daemon.heartbeat.json
       |                |           sources only)
       +----------+-----+--------------+
                  |
            buildAndInstall
            (same code path
             as `smith agent install-all`)
```

One process. Four concurrent loops (watcher, pull, TTL refresh, heartbeat). All re-installs go through the same `buildAndInstall` orchestrator that powers `smith agent install-all`, so daemon-driven installs are byte-identical to manual ones.

---

## What it watches and what it does

### File watcher

Powered by [chokidar](https://github.com/paulmillr/chokidar) over every registered catalog's `rootPath` plus `~/.config/agent-smith/USER.md`. See `src/daemon/watcher.ts`.

| Setting | Value | Why |
|---|---|---|
| `ignoreInitial` | `true` | Boot-time `add` events would trigger a reinstall on every start; the daemon does an initial install explicitly instead. |
| `awaitWriteFinish` | `100ms` stability + `50ms` poll | Atomic-rename editors (vim, IntelliJ) write a temp file then `rename()`. Without this, the watcher fires mid-write and reads a half-finished file. |
| Debounce | `250ms` | Bursts of events from a single save (or a `git pull` rewriting many files) are coalesced into one reinstall. |
| `ignored` | `.git` and `node_modules` at any depth | Defense against the `git pull` → `FETCH_HEAD` write → reinstall loop, plus future-proofing for catalogs that auto-install JS deps. |

Add, change, and unlink events are all funnelled through the same debounce window (`src/daemon/watcher.ts`).

### Self-write echo suppression

When the daemon's own `buildAndInstall` writes a rendered bundle file, chokidar fires `change` for that path. Without protection, that event would trigger another reinstall, which would write the same file, which would fire chokidar again — an infinite loop bounded only by the 250 ms debounce.

The daemon records every path it writes during install and filters watcher batches where **every** changed path is one we just wrote (`src/daemon/index.ts`). If even one path is outside the install set, the batch is treated as a real user edit and a reinstall runs — so a mixed save (one bundle file edited at the same moment a self-write fires) is never lost.

When suppression activates, the daemon logs `watcher: dropped N self-write echoes` to `daemon.log`.

### Reinstall triggers

The daemon calls `buildAndInstall` (the same code path as `smith agent install-all` — see [./03-installing-and-rendering.md](./03-installing-and-rendering.md)) on three triggers:

1. **Initial start** — once, immediately after `runDaemon` boots. Ensures the on-disk install matches the current bundle state regardless of what changed while the daemon was stopped.
2. **File watcher event** — any add, change, or unlink under a registered catalog or to `USER.md`, after debounce + self-write filtering.
3. **Successful git pull** — only when a fast-forward pull actually advances HEAD. Dirty/error pulls do not reinstall.

A reinstall in flight does **not** queue further reinstalls one-per-event. New triggers set a `rerunPending` flag; on completion, the daemon does at most one more pass that subsumes everything that arrived during the run (`src/daemon/index.ts`). This collapses bursts to at most two passes (the original + one rerun) regardless of how many events fired during the install.

### Git pull cadence

Every 15 minutes by default (`src/daemon/index.ts`), overridable per-process with the `SMITH_PULL_INTERVAL_MS` env var.

For each registered catalog with a `gitRemote` (registered via `smith agent register --git-remote ...`, see [./08-registries-and-catalogs.md](./08-registries-and-catalogs.md)), the daemon runs `pullIfClean` from `src/io/git.ts`:

| Result | Daemon action | Reinstall? |
|---|---|---|
| `clean` (ff-only succeeded) | log `pulled <label>`; if previous tick was non-idle, log `recovered <label>` | yes |
| `dirty` (working tree has uncommitted changes) | log `warn <label>: working tree has uncommitted changes; skipping pull` once on the idle→dirty transition | no |
| `error` (network, auth, non-fast-forward, etc.) | log `pull error <label>: <message>` once on transition | no |

The pull is `--ff-only`. If upstream has diverged from your local HEAD, the daemon will not merge — it logs the error and waits for the next tick. To recover, `cd` into the catalog and reconcile manually (`git fetch && git log --oneline HEAD..@{u}`, then rebase or hard reset as appropriate).

State transitions log **once**, not every tick. A long-running uncommitted change in a registered source produces one warn line, not one every 15 minutes.

### Heartbeat

Every 5 seconds by default (`src/daemon/index.ts`), overridable per-process with `SMITH_HEARTBEAT_INTERVAL_MS`. Each tick rewrites `~/.local/state/agent-smith/daemon.heartbeat.json`:

```json
{
  "schemaVersion": 2,
  "pid": 47213,
  "startedAt": 1759622400000,
  "lastBeatAt": 1759622415000,
  "status": "ready",
  "sources": {
    "team-agents": "idle",
    "team-agents": "dirty"
  }
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Schema version (`1` or `2`). Current daemon writes `2`. |
| `pid` | The daemon's own process id, useful for log correlation. |
| `startedAt` | ms epoch when the daemon process started (set before initial install begins). Stable for the daemon's lifetime. |
| `lastBeatAt` | ms epoch of the most recent heartbeat write. Staleness is `now - lastBeatAt`. |
| `status` | Current daemon phase: `"installing"` (initial install in progress), `"ready"` (last install succeeded), or `"degraded"` (last install had errors). |
| `sources` | Per-source pull state snapshot. Only git-pullable sources appear. Values: `idle`, `pulling`, `dirty`, `error`. |

Writes are atomic: the daemon writes to a tempfile in the same directory, then renames onto the final path (`src/daemon/heartbeat.ts`). Same-directory rename is atomic on POSIX, so concurrent readers (`smith daemon status`, an external monitor `cat`-ing the file) never see a torn JSON document.

The tempfile name is suffixed with `.<pid>.<random>` for defense-in-depth against concurrent daemon starts clobbering each other's tempfiles. Concurrent daemon starts shouldn't happen (the pid file enforces single-instance), but the suffix is cheap insurance.

The heartbeat file is **removed on shutdown** (`src/daemon/index.ts`) so a `daemon status` immediately after `daemon stop` reports cleanly.

### Knowledge TTL refresh

A dedicated `setInterval` ticks every **5 minutes** (separate from — and independent of — the 15-minute git-pull tick above; refresh and pull have different failure modes and tuning needs). Each tick enumerates installed agents, reads every knowledge source whose normalized `refresh.mode` is `ttl`, and refreshes any source whose per-source cache age exceeds its declared TTL (`1h`, `1d`, `1w`, etc.).

Per-source refresh state lives at:

```
~/.cache/agent-smith/agents/<name>/sources/<source-id>.meta.json
```

The same file is read and written by `smith knowledge refresh-session` (the platform hook entrypoint) and `smith knowledge fetch`, so all three refresh paths share consistent last-refreshed bookkeeping and conditional-GET state (ETag / Last-Modified for `url` sources).

Because the poll interval bounds refresh granularity, declared TTLs shorter than 5 minutes effectively behave as 5 minutes — a source with `ttl: 1m` is checked at most once per tick.

Failures are non-fatal: an individual refresh error is logged as `refresh error <agent>/<source-id>: <message>` and the tick continues with the next source; a thrown error from the tick loop itself is caught and logged as `ttl tick error: <message>` so a single refresh call cannot crash the daemon. Both kinds of error go to the daemon's stderr stream, which (when the daemon was started via `smith daemon start`) is appended to `~/.local/state/agent-smith/daemon.log` alongside the rest of the daemon's output.

See [guide/04-knowledge.md § Refresh modes](./04-knowledge.md#refresh-modes) for the source-side configuration (declaring `refresh: { mode: ttl, ttl: 30m }` on a source).

---

## Lifecycle commands

### `smith daemon start`

Spawn a detached `smith daemon run` child, write its pid to `~/.local/state/agent-smith/daemon.pid`, then poll the heartbeat file to verify the child reached steady state.

```
$ smith daemon start
Daemon started 47213
```

Before spawning, `daemon start` runs `migrateLegacyDaemonFiles()` which moves any pre-rc.5 daemon files (`daemon.pid`, `daemon.heartbeat.json`, `daemon.log`) from the legacy `~/.config/agent-smith/` location to `~/.local/state/agent-smith/`. The migration is idempotent and best-effort — failures are swallowed.

Algorithm (`src/cli/commands/daemon.ts`):

1. If pid file exists **and** that pid is alive → log `Daemon already running <pid>`, exit 0. The existing daemon is left alone.
2. If pid file exists but the pid is dead → silently overwrite. The new daemon takes over.
3. Spawn `process.execPath <entry> daemon run` with `detached: true`, stdout/stderr both redirected (append) to `daemon.log`.
4. Write the spawned child's pid to the pid file.
5. Poll the heartbeat file every 100 ms for up to 10 s. Success requires:
   - heartbeat exists,
   - `heartbeat.pid === <spawned child pid>`,
   - `now - heartbeat.lastBeatAt <= 7s`.
6. If the child dies during the poll window → remove pid file, log `Daemon exited during startup (pid <pid>); check log at <log path>`, exit 1.
7. If the poll times out → SIGTERM the child, remove pid file, log `Daemon failed to start within 10000ms`, exit 1.

Steps 5–7 close DAEMON-12 / DAEMON-15: previously, `daemon start` would print "Daemon started" the moment `spawn()` returned, even if the child crashed in `loadRegistry()` milliseconds later. Now the success message means the child is genuinely running and writing heartbeats.

The daemon child establishes its heartbeat **before** running the initial install, so the parent's 10 s poll succeeds even when install takes 40+ seconds (large Confluence/URL knowledge sources). During the initial install, a 30-second watchdog logs `initial install still running after Ns` to `daemon.log` so operators have a debugging trail for stuck installs.

Exit code is always 0 on success or "already running"; 1 on spawn failure, child crash, or timeout.

### `smith daemon stop`

SIGTERM the pid-tracked daemon, wait up to 10 s, SIGKILL if it doesn't cooperate.

```
$ smith daemon stop
Daemon stopped 47213
```

Algorithm (`src/cli/commands/daemon.ts`):

1. No pid file → log `Daemon not running`, exit 0.
2. Pid file exists but contents aren't a valid integer → remove file, log `Daemon not running (invalid pid file removed)`, exit 0.
3. Pid file exists but process is dead → remove file, log `Daemon not running (stale pid file removed)`, exit 0.
4. SIGTERM the process. Poll `kill(pid, 0)` every 100 ms for up to 10 s.
5. Process exits within budget → remove pid file, log `Daemon stopped <pid>`, exit 0.
6. Process still alive after 10 s → SIGKILL, wait 500 ms for the kernel to deliver, remove pid file, log `Daemon force-killed <pid>` to stderr (yellow), exit 0.

**`daemon stop` always exits 0 from the operator's perspective.** The daemon is stopped one way or another. The yellow force-killed message is a signal to investigate why the daemon didn't respond to SIGTERM (typically a wedged install or a stuck network call), not an error code to script against.

### `smith daemon status`

Report whether the pid-tracked daemon is alive and healthy (`src/cli/commands/daemon.ts`).

```
$ smith daemon status
running 47213 (heartbeat 312ms ago, status=ready)
```

The status command checks both process liveness **and** heartbeat freshness. A process that's alive but hasn't written a heartbeat within 7 seconds is reported as `stuck`.

| Output | Meaning | Exit code |
|---|---|---|
| `not running` | No pid file. | 0 |
| `stale pid file <pid> (invalid pid removed)` | Pid file contained garbage; removed. | 0 |
| `stale pid file <pid> (process not alive; removed)` | Pid file exists but process is dead. Run `smith daemon start`. | 0 |
| `running <pid> (no heartbeat yet)` | Process alive, heartbeat file not yet written (very early startup). | 0 |
| `running <pid> (heartbeat from pid X — possible stale heartbeat file)` | Heartbeat belongs to a prior daemon instance. | 0 |
| `running <pid> (installing... heartbeat Xms ago)` | Daemon alive, initial install still in progress. | 0 |
| `running <pid> (heartbeat Xms ago, status=ready)` | Daemon alive and healthy. | 0 |
| `running <pid> (heartbeat Xms ago, status=degraded)` | Daemon alive but last install had errors. | 0 |
| `stuck <pid> (heartbeat Xs ago, threshold 7s)` | Process alive but event loop is blocked — heartbeat is stale. Investigate `daemon.log` and consider `daemon stop && daemon start`. | 0 |

Exit code is always 0 — `status` is informational. Scripts that need to distinguish states should parse the text output or use `--json` (future).

### `smith daemon run`

Foreground mode, used internally by `smith daemon start` to spawn the actual long-running process.

> **Internal subcommand.** `daemon run` is registered publicly so it can be exercised by tests and so `daemon start` can spawn it as `process.execPath <entry> daemon run`. Operators normally use `daemon start`. Invoke `daemon run` directly only if you want to watch the daemon work in your terminal — for debugging, for use under an external supervisor (systemd, launchd, tmux), or when developing the daemon itself. No pid file is written; Ctrl-C stops it.

`daemon run` reads `SMITH_PULL_INTERVAL_MS` and `SMITH_HEARTBEAT_INTERVAL_MS` from the environment (`src/index.ts`). These are parsed by a `parsePositiveInt` helper that silently falls back to defaults on missing, malformed, or non-positive values.

---

## Files the daemon owns

| Path | Purpose | Lifecycle |
|---|---|---|
| `~/.local/state/agent-smith/daemon.pid` | PID of the running daemon (plain text) | Written on start; removed on `daemon stop`; left stale on crash. |
| `~/.local/state/agent-smith/daemon.log` | Combined stdout + stderr from the detached daemon (append-only) | Created on first start; never truncated by smith. Rotate manually if it grows. |
| `~/.local/state/agent-smith/daemon.heartbeat.json` | Liveness + per-source state | Rewritten every 5 s; removed on shutdown; considered stale if `lastBeatAt` is more than ~7 s old. |

Full path inventory in [./13-paths-and-state.md](./13-paths-and-state.md).

---

## Environment overrides

| Variable | Default | Effect |
|---|---|---|
| `SMITH_PULL_INTERVAL_MS` | `900000` (15 min) | Override the git-pull cadence. Useful in dev to test pull behavior without waiting 15 min. |
| `SMITH_HEARTBEAT_INTERVAL_MS` | `5000` (5 s) | Override the heartbeat write cadence. Useful in tests. |

Both are read **only at daemon start** (`src/index.ts`). Changing them in your shell after the daemon is already running has no effect — `daemon stop && daemon start` to apply.

Invalid or non-positive values are silently ignored and the default applies. To verify your override took effect, watch the heartbeat file's `lastBeatAt` field tick at the expected rate.

---

## Debugging recipes

### Is the daemon alive?

```bash
smith daemon status
```

If it reports `stuck <pid>`, the daemon's event loop is blocked. Check `daemon.log` for the cause and consider `daemon stop && daemon start`. You can also inspect the raw heartbeat file:

```bash
cat ~/.local/state/agent-smith/daemon.heartbeat.json
# Compare `lastBeatAt` (ms epoch) to `date +%s%3N`
```

### What is the daemon doing right now?

```bash
tail -f ~/.local/state/agent-smith/daemon.log
```

The log captures stdout and stderr from the detached child. Every reinstall, every pull attempt, every state transition is logged.

### Restart cleanly

```bash
smith daemon stop && smith daemon start
```

`stop` is idempotent and always exits 0, so this works whether the daemon was running, stale, or already gone.

### "Daemon won't start"

`smith daemon start` exited 1. Check the log first:

```bash
tail -20 ~/.local/state/agent-smith/daemon.log
```

Common causes:

- **Write-permission failure on `~/.config/agent-smith/`** — the daemon needs to write the pid file, the log, and the heartbeat. If the directory is owned by another user or read-only, the spawn appears to succeed but the child immediately fails to write the heartbeat and `daemon start` reports timeout.
- **Missing `bun` on PATH** — the spawned child is launched as `process.execPath <entry> daemon run`. If `process.execPath` (the Bun binary that ran `smith daemon start`) is no longer on PATH or has been moved, the child can't find itself for re-exec.
- **Stuck heartbeat from a previous run** — if the previous daemon crashed without removing the heartbeat file, a fresh `daemon start` may briefly read the stale heartbeat. The pid check (`heartbeat.pid === <spawned child pid>`) protects against this; a "Daemon failed to start" timeout in this scenario means the new child genuinely isn't writing heartbeats.
- **Missing `~/.config/agent-smith/registry.json`** — the daemon's first action is `loadRegistry()`. If the registry is missing, `loadRegistry` returns the in-memory default (zero registered sources) and the daemon proceeds with no work to do. To register sources or seed the registry on disk, run `smith init` (the installer also runs this automatically as Step 8b on fresh installs).
- **Registered catalog path no longer exists** — if a registered catalog directory has been deleted or moved, `loadAllBundles` may throw. Run `smith status` to inspect, `smith agent unregister <path>` to remove dead entries.

### "Daemon won't stop"

Almost never — the SIGKILL fallback covers it. If `daemon stop` reports `Daemon force-killed <pid>` and a follow-up `daemon status` still says `running <pid>`, the process is non-killable (kernel-level zombie, uninterruptible disk wait, etc.). At that point, OS-level intervention is needed:

```bash
ps -p <pid>           # confirm it's actually alive
kill -9 <pid>         # try once more
sudo kill -9 <pid>    # if you don't own the process
```

### "Daemon is running but not reinstalling on save"

1. Confirm the file you're editing is under a registered catalog: `smith status` lists every catalog's `rootPath`.
2. Confirm the path doesn't fall under a `.git` or `node_modules` directory at any depth — those are unconditionally ignored.
3. Tail the log while you save: a real edit produces `installed N files` within ~250 ms. If you see `watcher: dropped N self-write echoes`, the daemon thinks your edit was its own write — file a bug.

### "Pulls aren't happening"

1. Confirm the source is `kind: registered` and has a `gitRemote`: `smith status`. Other source kinds (`user-global`, `project`) are file-watched but never pulled.
2. Wait a full pull interval (default 15 min) and check the log for `pulled <label>`, `warn <label>`, or `pull error <label>`.
3. If pulls log `dirty`, `cd` into the catalog and `git status` — uncommitted changes will block pulls indefinitely.
4. If pulls log `error`, the message includes git's failure output (auth, non-ff, network). Reproduce by running `git pull --ff-only` manually in the catalog directory.

---

## Caveats and gotchas

- **The daemon does not replace `smith agent install`.** It runs install on your behalf when files change. To verify behavior independently of the daemon, run `smith agent install <name>` once manually.
- **The daemon only pulls, never pushes.** Local commits in catalog directories are not propagated upstream. If you edit bundles in a registered catalog, push the changes yourself.
- **Pull errors do not crash the daemon.** They're logged and retried on the next tick. Long stretches of pull failures will silently fail to propagate upstream changes; check `daemon.log` periodically or rely on `smith doctor`'s `registry-hygiene` section ([./10-doctor.md](./10-doctor.md)).
- **The watcher ignores `.git` and `node_modules` at any depth.** Files under those directories will not trigger reinstalls. This is intentional: it prevents a `git pull` writing `FETCH_HEAD` from triggering another reinstall, and it future-proofs against catalogs that auto-install JS dependencies.
- **`SMITH_PULL_INTERVAL_MS` and `SMITH_HEARTBEAT_INTERVAL_MS` are read only at daemon start.** Changing them mid-run requires `daemon stop && daemon start`.
- **`daemon.log` is append-only.** Smith never truncates or rotates it. On a long-running daemon with frequent reinstalls, the log grows unboundedly. Rotate or truncate manually:
  ```bash
  smith daemon stop
  : > ~/.local/state/agent-smith/daemon.log
  smith daemon start
  ```
- **`daemon status` reports heartbeat freshness.** A wedged-but-alive daemon is reported as `stuck` with the heartbeat age and threshold. See the status table above for all possible outputs.
- **Heartbeat is removed on graceful shutdown only.** A daemon killed with SIGKILL (or that crashed without running its shutdown handlers) leaves the heartbeat behind. The next `daemon start` will overwrite it; in the meantime, the file's stale `lastBeatAt` is the signal that something went wrong.
- **One daemon per user.** The pid file enforces single-instance. Running `daemon start` while one is already alive is a no-op.

---

## See also

- [./03-installing-and-rendering.md](./03-installing-and-rendering.md) — what the daemon's reinstalls actually do (the install pipeline, byte-identical skip semantics, per-platform output).
- [./08-registries-and-catalogs.md](./08-registries-and-catalogs.md) — how catalogs are registered for the daemon to watch, and how `--git-remote` enables the pull loop.
- [./10-doctor.md](./10-doctor.md) — the `registry-hygiene` and `workspace` sections surface daemon-relevant drift.
- [./12-error-handling.md](./12-error-handling.md) — how to read the error format that appears in `daemon.log`.
- [./13-paths-and-state.md](./13-paths-and-state.md) — full path inventory, including the daemon's three state files.
- [./14-cli-reference.md](./14-cli-reference.md) — `daemon start`, `daemon stop`, `daemon status`, `daemon run` reference entries with all flags and exit codes.
