# Paths and state

> Reference. Every file and directory `agent-smith` reads or writes — where it lives, who owns it, when it appears, when it's removed. Other spokes link here whenever the question is "where does X live?".

This is the canonical inventory. Per-file *semantics* (what's inside, when it changes, what it's used for) live in the spoke that owns the topic; this spoke documents location, lifecycle, and atomicity. Cross-links to the owning spoke appear in every section.

---

## The three roots

Every path `agent-smith` touches belongs to one of three roots:

| Root | Purpose | Removed by `smith jack-out`? |
|---|---|---|
| `~/.config/agent-smith/` (or `${XDG_CONFIG_HOME}/agent-smith/`) | smith's config dir — registries, persona, `.env` | yes (entirely) |
| `~/.local/state/agent-smith/` (or `${XDG_STATE_HOME}/agent-smith/`) | daemon runtime files (pid, log, heartbeat), GUI job history, remote-backed catalog clones | partially (daemon files survive — see [What `smith jack-out` removes](#what-smith-jack-out-removes-vs-doesnt-remove)) |
| `~/.cache/agent-smith/` (or `${XDG_CACHE_HOME}/agent-smith/`) | doctor schema cache + per-source refresh bookkeeping | **no** |
| Per-platform dirs (`~/.config/opencode/`, `~/.claude/`, `~/.agents/`, `~/.kiro/`) | rendered agents, installed skills, per-agent knowledge | partially: agent files removed; skills + knowledge dirs left orphaned |

The single fact that drives this spoke: **the smith config dir is not the only place smith writes**. Per-platform agent files, per-platform skill installs, per-agent knowledge dirs, and the doctor cache all live elsewhere. Spokes that reason about "what survives jack-out" depend on that distinction.

---

## XDG variable handling

`agent-smith` honors **`XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `XDG_STATE_HOME`**. The config (registries, agents/, USER.md) and cache (doctor schema, knowledge .cache/) roots follow the first two respectively; remote-backed catalog clones live under the third. An unset or empty value falls back to the conventional default. Resolution is lazy — each call site re-reads `process.env` at call time, so subprocess overrides take effect immediately.

| Variable | Honored? | Default when unset/empty | Source |
|---|---|---|---|
| `XDG_CONFIG_HOME` | **yes** | `~/.config` | `src/io/state-home.ts` (`stateHome()` — single resolver for the config root) |
| `XDG_CACHE_HOME` | **yes** (doctor schema cache + knowledge `.cache/` bookkeeping) | `~/.cache` | `src/cli/commands/doctor.ts`, `src/io/cache-root.ts` |
| `XDG_STATE_HOME` | **yes** (since v1.0.0-rc.2) — root for remote-backed catalog clones; daemon runtime files (`daemon.{pid,log,heartbeat.json}`) and GUI job history (since v1.0.0-rc.5) | `~/.local/state` | `src/io/xdg-state-home.ts`, `src/io/runtime-state-home.ts` (`runtimeStateHome()`), consumed by `src/io/remote-root.ts` (`defaultRemoteRoot()`) |
| `XDG_DATA_HOME` | **no** | n/a | not referenced anywhere in `src/` |

If you set `XDG_CONFIG_HOME=/somewhere/else`, smith writes the config root at `/somewhere/else/agent-smith/` — `smith init` initializes it there, `smith jack-out` removes it from there, and every internal config-path-composing function (`canonicalRegistryPath()`, `canonicalUserPath()`, `canonicalSkillRegistryPath()`, `defaultAgentSmithHome()`, etc.) resolves through `stateHome()`. Daemon runtime files (`daemon.{pid,log,heartbeat.json}`) and GUI job history (`gui-jobs.jsonl`, `gui-jobs-output/`) follow `XDG_STATE_HOME` instead — `heartbeatPath()`, the daemon's `pidFile()` / `logFile()` / `heartbeatFile()` helpers, and the GUI's `defaultStateRoot()` all resolve through `runtimeStateHome()`. Per-platform install dirs (`~/.config/opencode/`, `~/.claude/`, `~/.agents/`, `~/.kiro/`) are NOT affected — those follow each platform's own conventions and are outside smith's control.

> **Breaking change in v1.0.0-rc.2 — remote clone location moved.** Through rc.1, `agent install --from <url>` and `skill install --from <url>` placed managed clones under `$XDG_CONFIG_HOME/agent-smith/remote/<host>/<owner>/<repo>`. As of rc.2 they live under `$XDG_STATE_HOME/agent-smith/remote/<host>/<owner>/<repo>` (typically `~/.local/state/agent-smith/remote/...`) to comply with [XDG Base Directory](https://specifications.freedesktop.org/basedir-spec/latest/) semantics — config = user-edited declarative state; state = machine-generated working data.
>
> **rc.4 adds `smith migrate-clones`** — a one-shot helper that walks both registries, finds any `rootPath` still pointing at the rc.1 location, validates the clone (`.git/` exists, origin URL matches), moves the directory to the rc.2+ location, and updates the registry entry's `rootPath`. Per-entry safety guards skip entries whose target already exists, whose origin URL drifted, or whose `.git/` was deleted, leaving the registry untouched for those entries. `smith status` surfaces a one-line nudge when rc.1 clones are detected. See [`smith migrate-clones`](./14-cli-reference.md#smith-migrate-clones) for the full command reference. = user-edited declarative state; state = machine-generated working data. Existing rc.1 clones are **not** migrated automatically; their registry entries still point at the old `~/.config/agent-smith/remote/...` paths and remain functional in place. To consolidate: `smith {agent,skill} unregister <label> --purge-clone` (the rc.2 layered guard refuses cross-mount or off-root targets, so the purge is safe) and re-install via `--from <url>` to land in the new location.

The rest of this document writes paths in the `~/.config/agent-smith/...` form for readability. Read these as "the state root, resolved via `stateHome()`" — they become `${XDG_CONFIG_HOME}/agent-smith/...` when `XDG_CONFIG_HOME` is set. Paths under `remote/` are the sole exception: those resolve through `defaultRemoteRoot()` (`$XDG_STATE_HOME`-rooted as of rc.2).

---

## `~/.config/agent-smith/` — the state root

The directory `smith init` creates and `smith jack-out` removes wholesale. Every file under this root is owned and managed by smith.

| Path | Created by | Created when | Format | Atomic write? |
|---|---|---|---|---|
| `agents/` | `smith init` | always (eagerly) | directory | n/a |
| `agents/<name>/` | `smith agent init <name>` | per agent | directory containing the bundle | n/a |
| `registry.json` | `smith init` | always (eagerly) | JSON `{schemaVersion:2, sources:[...]}` | **yes** (`atomicWriteJson`: temp + rename) |
| `USER.md` | `smith init` | only when missing | markdown | n/a (single-shot) |
| `skill-catalogs.json` | first skill mutation | lazy | JSON `{schemaVersion:2, catalogs:[]}` | **yes** (temp + rename) |
| `installed-skills.json` | first `smith skill install` | lazy | JSON `{schemaVersion:2, installed:[]}` | **yes** (temp + rename) |
| `installed-agents.json` | first `smith agent install` | lazy | JSON `{schemaVersion:1, installed:[{name, target, path, sha256, ...}]}` | **yes** (temp + rename, under `withFileLock`) |
| `conventions.json` | first GUI `/system/conventions` write or manual edit | lazy | JSON `{schemaVersion:1, platformConventions:{ <target>:{explicit?[],denied?[]} }}` | **yes** (temp + rename) |
| `.env` | you (manually) | optional | dotenv (`SMITH_*` keys) | n/a |
| `agents/<name>/refresh-manifest.json` | `smith agent install <name>` (when knowledge sources opt into refresh) | per consenting agent | JSON `RefreshManifest` (`refresh_consent.platforms`, per-source policy) | **yes** (temp + rename) |

Daemon runtime files (`daemon.pid`, `daemon.log`, `daemon.heartbeat.json`) live under `~/.local/state/agent-smith/` since v1.0.0-rc.5 — see [The runtime state root](#-localstateagent-smith--the-runtime-state-root) below. Earlier versions wrote them under this config root; `smith daemon start` performs a one-shot migration that moves any leftover legacy files to the new location.

There is **no `daemon.sock`**. Earlier specs mentioned a unix socket; the daemon does not open one. Inter-process visibility is achieved entirely through the heartbeat file plus `kill(pid, 0)` liveness checks. (`src/cli/commands/daemon.ts:12-23` for the path helpers.)

### `agents/` and `agents/<name>/`

The default user-global agent catalog. `smith init` creates the empty directory; the registry's first entry points at it (`src/io/registry.ts:20-31`). `smith agent init <name>` creates `agents/<name>/` with the persona files and `agent.config.json`. (Pass `--catalog <label>` to scaffold into a different registered catalog.) Bundle anatomy: see [02-bundle-anatomy.md](./02-bundle-anatomy.md).

### `registry.json`

The agent registry. Document shape (`src/io/registry.ts:13-16`):

```ts
interface Registry {
  schemaVersion: 2;
  sources: Source[];   // Source defined in src/core/types.ts
}
```

Each `Source` carries `{kind, rootPath, label, gitRemote?}`. `kind` is one of `user-global | project | registered`. `rootPath` is an absolute filesystem path to a directory of bundles.

**Atomicity:** `saveRegistry` writes via `atomicWriteJson` (temp file + rename) (`src/io/registry.ts:179-180`), so a crash mid-write cannot leave a half-written file. Symmetric with the skill registry below.

**Uniqueness:** `addSource` deduplicates only by `(kind, rootPath)` (`src/io/registry.ts:144-157`). Two catalogs with the same `label` but different paths can coexist; commands that look up by label have no defined behavior in that case. (Asymmetric with skill registry, which rejects duplicate labels.)

Owning spoke: [08-registries-and-catalogs.md](./08-registries-and-catalogs.md).

### `USER.md`

The canonical user persona file. Symlinked into every bundle's `<bundle>/USER.md` for personal catalogs; for `registered` catalogs the bundle ships a stub instead. See [Bundle anatomy § USER.md and catalog kind](./02-bundle-anatomy.md#usermd-and-catalog-kind). `smith init` seeds a placeholder *only when the file does not already exist* (`src/cli/commands/init.ts:27-32`); re-running `init` over an existing `USER.md` is a no-op. `smith init-user` opens the file in `$EDITOR`.

The canonical path is resolved by `canonicalUserPath()` (`src/io/registry.ts:323`), which composes `USER.md` onto `stateHome()`.

Owning spoke: [02-bundle-anatomy.md](./02-bundle-anatomy.md#usermd).

### `skill-catalogs.json`

The skill registry. Document shape (`src/io/skill-registry.ts:52-55`):

```ts
interface SkillRegistry {
  schemaVersion: 2;
  catalogs: SkillCatalog[];
}

interface SkillCatalog {
  kind: "user-global" | "user-local" | "team-shared";
  rootPath: string;
  label: string;          // unique within registry
  gitRemote?: string;
  adhoc?: boolean;        // true for catalogs created by `skill install --from`
  protected?: boolean;    // true for atlassian-skills; refuses unregister
}
```

**Lazy creation:** the file does not exist after `smith init` — it's created on the first mutation (`smith skill register`, `smith skill install`, etc.). When absent, `loadSkillRegistry` returns `defaultSkillRegistry()` containing the single `atlassian-skills` entry (`src/io/skill-registry.ts:143-145`).

**Atomic writes:** `saveSkillRegistry` writes to `<path>.tmp.<pid>` and renames over the target (`src/io/skill-registry.ts:171-178`). `rename(2)` is atomic on POSIX same-filesystem renames, so a crash mid-write cannot leave the file half-written.

**Defensive `atlassian-skills` re-injection:** when loading, if the on-disk file lacks the `atlassian-skills` catalog (because a user hand-edited it out), `loadSkillRegistry` splices it back in-memory but **does not re-save** (`src/io/skill-registry.ts:160-166`). The next mutating command will persist the corrected state. Until then, `cat skill-catalogs.json` and `smith skill catalogs` can disagree.

Canonical path resolver: `canonicalSkillRegistryPath()` (`src/io/skill-registry.ts:262`), which composes `skill-catalogs.json` onto `stateHome()`.

Owning spoke: [05-skills.md](./05-skills.md), with catalog-level commands in [08-registries-and-catalogs.md](./08-registries-and-catalogs.md).

### `installed-skills.json`

Records every skill installed by `smith skill install` (and bootstrap's the-architect). Document shape (`src/io/installed-skills.ts:12-33`):

```ts
interface InstalledSkillsFile {
  schemaVersion: 2;
  installed: InstalledSkill[];
}

interface InstalledSkill {
  name: string;
  sourceCatalogLabel: string;     // the catalog the skill was sourced from
  sourcePath: string;             // absolute path to the source skill dir at install time
  installedPaths: {
    opencode?: string;
    claudeCode?: string;
    codex?: string;
  };
  contentHash: string;            // sha256 over recursive sorted dirent contents
  installedAt: string;            // ISO 8601
}
```

**Lazy creation:** absent after `smith init`. Created on first `smith skill install`. When absent, `loadInstalledSkills` returns `{schemaVersion:2, installed:[]}` (`src/io/installed-skills.ts:46-53`).

**Atomic writes:** same temp-file-plus-rename pattern as `skill-catalogs.json` (`src/io/installed-skills.ts:81-95`).

**Drift detection:** `contentHash` is recomputed at doctor time over the *source* skill dir; if it differs from the recorded hash, the skill is reported as `drift`. The hash skips symlinks (recorded as `SYMLINK`) and files larger than 10 MB (recorded as `SKIPPED-LARGE`) so a hostile symlink can't be slurped and a binary asset can't blow memory (`src/io/installed-skills.ts:116-184`).

Owning spoke: [05-skills.md](./05-skills.md#drift-and-doctor).

### `.env`

Optional dotenv file. Read by the Atlassian credential resolver (tier 2 — see [Atlassian credentials](#atlassian-credentials) below). **Not** created by any smith command; you create it by hand if you prefer file-based credentials over environment variables.

Recommended permissions: `chmod 600 ~/.config/agent-smith/.env`. Smith does not enforce or check this — file mode is your responsibility. (`src/io/atlassian-auth.ts:85-92` reads via `readFileSync` with no mode validation.)

### `daemon.pid`, `daemon.log`, `daemon.heartbeat.json`

Daemon state lives under `~/.local/state/agent-smith/` (the runtime state root — see [§ Runtime state root](#-localstateagent-smith--the-runtime-state-root) below). Created on `smith daemon start`; `pid` and `heartbeat` are removed on clean shutdown; `log` is append-only and never truncated by smith. Stale `pid` files (process gone but file remains after a crash) are detected and cleaned up on the next `daemon start`.

Pre-v1.0.0-rc.5, these files lived under `~/.config/agent-smith/`. `smith daemon start` performs a best-effort one-shot migration: if any of `daemon.{pid,log,heartbeat.json}` exists in the legacy location and the new location does not have a same-named file, it's moved. Failures are swallowed; manual cleanup with `rm -f ~/.config/agent-smith/daemon.{pid,log,heartbeat.json}` is always safe.

Heartbeat shape (`src/daemon/index.ts:116-121`):

```ts
interface HeartbeatSnapshot {
  pid: number;
  startedAt: number;             // ms epoch
  lastBeatAt: number;            // ms epoch — staleness = now - lastBeatAt
  sources: Record<string, SourceState>;   // per-source pull state
}
```

Owning spoke: [09-daemon.md](./09-daemon.md#files-the-daemon-owns).

---

## `~/.local/state/agent-smith/` — the runtime state root

The directory `agent-smith` uses for ephemeral runtime artifacts (daemon pid/log/heartbeat, GUI job history, remote-backed catalog clones). Honors `XDG_STATE_HOME` (empty-as-unset XDG semantics), falling back to `~/.local/state/agent-smith/`. Resolved by `runtimeStateHome()` in `src/io/runtime-state-home.ts` (CLI side) and `defaultStateRoot()` in `gui/server/src/services/cache-paths.ts` (GUI side); the two are kept in sync.

This is the correct XDG bucket for runtime state per the [XDG Base Directory spec](https://specifications.freedesktop.org/basedir-spec/latest/) — `pid` files, sockets, log files, and other machine-generated working data belong here, not under `XDG_CONFIG_HOME`. Pre-v1.0.0-rc.5, daemon files lived under the config root and the GUI's status route looked at the state root, causing a split-brain where the GUI never saw what the CLI wrote. Resolved in v1.0.0-rc.5 by converging both sides on `runtimeStateHome()`.

| Path | Created by | Created when | Format | Atomic write? |
|---|---|---|---|---|
| `daemon.pid` | `smith daemon start` | lazy | plain-text PID | overwrite |
| `daemon.log` | `smith daemon start` | lazy | append-only stdio log | append |
| `daemon.heartbeat.json` | running daemon | every 5 s while running | JSON `HeartbeatSnapshot` | **yes** (temp + rename) |
| `gui-jobs.jsonl` | `smith gui` | first GUI job | append-only NDJSON | append |
| `gui-jobs-output/` | `smith gui` | per stored job | per-job stdout/stderr files | n/a |
| `remote/<host>/<owner>/<repo>/` | `smith {agent,skill} install --from <url>` | per remote-backed catalog | git clone working tree | n/a |

There is **no `daemon.sock`**. Earlier specs mentioned a unix socket; the daemon does not open one. Inter-process visibility is achieved entirely through the heartbeat file plus `kill(pid, 0)` liveness checks. (`src/cli/commands/daemon.ts:12-23` for the path helpers; `src/daemon/heartbeat.ts:heartbeatPath()` for the heartbeat writer.)

### Migration from pre-rc.5 layout

`smith daemon start` runs a one-shot best-effort migration on every invocation: if `~/.config/agent-smith/daemon.{pid,log,heartbeat.json}` exists and the corresponding file under `~/.local/state/agent-smith/` does not, the legacy file is renamed across directories. Failures are swallowed (network filesystems, permission edge cases); the next start retries. To force-clear any vestigial legacy files: `rm -f ~/.config/agent-smith/daemon.{pid,log,heartbeat.json}`.

Owning spoke: [09-daemon.md](./09-daemon.md#files-the-daemon-owns).

---

## `~/.cache/agent-smith/` — the doctor cache and refresh bookkeeping

Two distinct sub-trees live here. Both honor `XDG_CACHE_HOME` and both survive `smith jack-out` (small, regenerable, outside the smith state root).

| Path | Purpose | TTL | Bust with |
|---|---|---|---|
| `${XDG_CACHE_HOME:-~/.cache}/agent-smith/opencode-schema-cache.json` | Cached upstream OpenCode config schema | 24 h | `smith doctor --no-cache` |
| `${XDG_CACHE_HOME:-~/.cache}/agent-smith/agents/<name>/sources/<source-id>.meta.json` | Per-source refresh bookkeeping: `last_refreshed_at`, `etag`/`last_modified` (for `url` sources). Shared by the daemon TTL tick, `smith knowledge refresh-session`, and `smith knowledge fetch`. | none (refreshed in-place) | `rm` the file (or the whole `agents/<name>/` subtree) |

Note: this is **not** the legacy per-agent fetch cache. The byte-cache that backs `url`/`git` materialization lives next to the knowledge content at `~/.config/agent-smith/knowledge/<name>/.cache/` (see [Per-agent knowledge directories](#per-agent-knowledge-directories) below). The `~/.cache/agent-smith/agents/.../sources/*.meta.json` files are bookkeeping only — they record *when* a source was last refreshed and the conditional-GET headers to send next time, not the response body.

Path resolution (`src/cli/commands/doctor.ts:32-36`):

```ts
function defaultCachePath(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache");
  return join(base, "agent-smith", "opencode-schema-cache.json");
}
```

Empty `XDG_CACHE_HOME` is treated as unset. If `XDG_CACHE_HOME=/tmp/cache`, the file lands at `/tmp/cache/agent-smith/opencode-schema-cache.json`.

**Not removed by `smith jack-out`.** This is intentional: the cache is small, regenerable, and lives outside the smith state root. If you want a true clean slate, remove it manually:

```bash
rm -rf ~/.cache/agent-smith/   # or "${XDG_CACHE_HOME}/agent-smith/" if you set XDG_CACHE_HOME
```

Owning spoke: [10-doctor.md](./10-doctor.md#schema-cache).

---

## Per-platform agent install dirs

Where `smith agent install <name>` writes the rendered agent files. There is **no centralized smith agents directory** — every agent file lands directly in the destination platform's agents dir.

Source: `src/cli/install-paths.ts:7-13` (`defaultInstallPaths`).

| Platform | Path | File shape |
|---|---|---|
| OpenCode | `~/.config/opencode/agents/<name>.md` | YAML-fronted markdown |
| Claude Code | `~/.claude/agents/<name>.md` | YAML-fronted markdown |
| Codex | `~/.agents/skills/<name>/SKILL.md` | directory wrapper around `SKILL.md` |
| Kiro | `~/.kiro/agents/<name>.json` | strict JSON document (no markdown body) |

**Codex shares its directory with skills.** Both Codex agents and Codex skills live under `~/.agents/skills/`. Both are `<name>/SKILL.md`-shaped. A name collision between an agent and a skill is the user's responsibility; smith does not detect it. (`src/cli/commands/skill/bootstrap.ts` (the `allPlatforms` literal in `runSkillBootstrapCli`) documents the shared root and enumerates the cross-platform skill targets; `scripts/bootstrap.ts` carries the same `platforms` literal for the postinstall entry point.)

**Removal asymmetry on Codex.** `smith agent uninstall <name>` removes the *file* `~/.agents/skills/<name>/SKILL.md` but leaves the empty `<name>/` directory wrapper behind. `src/io/uninstaller.ts:22-25` calls `rm` on the file path without `recursive: true`. Empty dirs accumulate over the lifetime of an install. Cosmetic, not functional.

Owning spoke: [03-installing-and-rendering.md](./03-installing-and-rendering.md), with per-platform translator behavior in [06-permissions-and-platforms.md](./06-permissions-and-platforms.md).

---

## Per-platform skill install dirs

Where `smith skill install <ref>` and `smith skill bootstrap` write installed skills. **Per-platform, not centralized** — there is no `~/.config/agent-smith/skills/`.

Source: `src/cli/commands/skill/bootstrap.ts` (CLI wrapper) and `scripts/bootstrap.ts` (`bootstrap()` function — bundled-skills install loop).

| Platform | Path |
|---|---|
| OpenCode | `~/.config/opencode/skills/<name>/SKILL.md` (+ companion files) |
| Claude Code | `~/.claude/skills/<name>/SKILL.md` (+ companion files) |
| Codex | `~/.agents/skills/<name>/SKILL.md` (+ companion files) |
| Kiro | `~/.kiro/skills/<name>/SKILL.md` (+ companion files) |

The Codex skills dir is the **same directory** as the Codex agents dir. See the agent table above.

**Skills are copied, not symlinked.** Editing the installed copy does not propagate back to the source catalog, and the doctor `skill-drift` section will report the change. Re-`install` from source to flatten the drift. (See [05-skills.md](./05-skills.md).)

**Not removed by `smith jack-out`.** Jack-out removes `~/.config/agent-smith/` only. Per-platform skill installs survive — but `installed-skills.json` (the bookkeeping that tracks them) is gone, so the skills are effectively orphaned. To remove them after a jack-out, hand-delete each platform's `<platform-skills-dir>/<name>/`. (`src/cli/commands/jack-out.ts:97-114` removes only the config dir.)

Owning spoke: [05-skills.md](./05-skills.md).

---

## Per-platform refresh integrations

When a bundle has knowledge sources whose `refresh.mode` is `session` or `always` and the operator consents at install time, smith installs a per-platform refresh integration. These are the only files smith writes outside the smith state root + per-platform agent/skill dirs.

| Platform | Path | Created by | Removed by |
|---|---|---|---|
| Claude Code | `hooks.SessionStart` block inside `~/.claude/agents/<name>.md` (the rendered agent file itself) | `smith agent install <name>` with consent | `smith agent uninstall <name>` (file is deleted wholesale) |
| Codex | `~/.codex/hooks.json` (global; smith-managed via a `_smith_managed` ownership marker; entry per consenting agent) | `smith agent install <name>` with consent — refuses if a pre-existing `hooks.json` lacks the marker | `smith agent uninstall <name>` (entry removed; file deleted when last entry goes) |
| OpenCode | `~/.config/opencode/plugins/agent-smith-refresh/` (shared plugin dir: `index.ts`, `package.json`, `.smith-managed` sentinel listing consenting agents) plus an entry in `~/.config/opencode/opencode.json`'s `plugin` array | `smith agent install <name>` with consent | `smith agent uninstall <name>` removes the agent from `.smith-managed`; the plugin dir + `opencode.json` entry are deleted when the last consenting agent is uninstalled |

The per-agent **consent record** that drives all three integrations lives at `~/.config/agent-smith/agents/<name>/refresh-manifest.json` (listed in the state root table above). The integrations themselves are state — they're recreated from the manifest on install and torn down on uninstall.

`smith jack-out` removes every agent (which triggers the uninstall-side teardown for each integration above) before deleting `~/.config/agent-smith/`. The Codex `hooks.json` and OpenCode plugin dir are removed by that teardown path, not by jack-out directly.

Owning spoke: [04-knowledge.md § Consent and the refresh manifest](./04-knowledge.md#consent-and-the-refresh-manifest).

---

## Per-agent knowledge directories

Where `smith agent install <name>` materializes knowledge sources for an agent.

Source: `src/io/knowledge-paths.ts:13-19`.

| Path | Contents |
|---|---|
| `~/.config/agent-smith/knowledge/<name>/` | The knowledge dir for `<name>`. Always under agent-smith's own state home, regardless of which targets `<name>` declares. |
| `~/.config/agent-smith/knowledge/<name>/_manifest.json` | Per-source manifest: id, scope, type, delivery, file list, token counts. |
| `~/.config/agent-smith/knowledge/<name>/sources/<id>/` | Materialized files for one source. |
| `~/.config/agent-smith/knowledge/<name>/.cache/` | URL/git fetch cache. |

**Always under agent-smith's state home.** Even when `<name>` does not target OpenCode (e.g. `targets: ["claude-code"]`), the knowledge dir lives at `~/.config/agent-smith/knowledge/<name>/`. Every target — OpenCode, Claude Code, Codex, Kiro — reaches it via cross-platform read-grants injected into per-target rendered output at install time (`permission.read.<dir>/**: allow` for OpenCode; `additionalDirectories` for Claude; `allowed_external_directories` for Codex; `resources: ["file://<dir>/**"]` for Kiro). Earlier versions materialized under `~/.config/opencode/agents/<name>/knowledge/`, but OpenCode's agent picker globs that directory recursively and treated every knowledge `.md` as a selectable agent — see `src/io/knowledge-paths.ts:6-11` for the migration rationale. See [04-knowledge.md](./04-knowledge.md#cross-platform-read-grants).

**Example: `agent-smith` dogfoods this layout.** The companion agent's bundle declares `../../guide` as a knowledge source with `id: "agent-smith-guide"`, so `bin/install` (Step 9) and `smith update` (Step 4 of the pipeline — see [12-error-handling.md#update-pipeline](./12-error-handling.md#update-pipeline)) materialize the in-repo `guide/` files into `~/.config/agent-smith/knowledge/agent-smith/sources/agent-smith-guide/` (the per-source subdir takes the source's `id`, not the source's path). Cross-platform read-grants make the same dir visible from a `claude --agent agent-smith` or `codex --agent agent-smith` session. The `smith agent install agent-smith` step keeps that knowledge dir in lockstep with whatever `guide/` shipped in the same commit.

**Removed by `smith agent uninstall <name>` and `smith agent uninstall-all`.** Both commands resolve the knowledge dir via `defaultKnowledgePaths()` and remove `~/.config/agent-smith/knowledge/<name>/` (including the `.cache/` subtree) as part of normal uninstallation. `smith jack-out` removes the whole `~/.config/agent-smith/` root, so per-agent knowledge dirs go with it. (Pre-fix, knowledge dirs were left behind on uninstall and accumulated as stale state — that gap is now closed; see `CHANGELOG.md`.)

Owning spoke: [04-knowledge.md](./04-knowledge.md#where-knowledge-lives-on-disk).

---

## What `smith init` creates vs. what's lazy

`smith init` is deliberately minimal. It creates only the files smith needs to operate at all; everything else appears on first use.

| Path | `smith init`? | Created by |
|---|---|---|
| `~/.config/agent-smith/agents/` | yes (eager) | `src/cli/commands/init.ts:22` |
| `~/.config/agent-smith/registry.json` | yes (eager) | `src/cli/commands/init.ts:25-26` |
| `~/.config/agent-smith/USER.md` | only when missing | `src/cli/commands/init.ts:27-32` |
| `~/.config/agent-smith/skill-catalogs.json` | **no** | first skill mutation |
| `~/.config/agent-smith/installed-skills.json` | **no** | first `smith skill install` |
| `~/.config/agent-smith/.env` | **no** | you, by hand |
| `~/.local/state/agent-smith/daemon.{pid,log,heartbeat.json}` | **no** | `smith daemon start` |
| `~/.config/agent-smith/agents/<name>/refresh-manifest.json` | **no** | `smith agent install <name>` with refresh consent |
| `~/.cache/agent-smith/opencode-schema-cache.json` | **no** | `smith doctor` (with network) |
| `~/.cache/agent-smith/agents/<name>/sources/<source-id>.meta.json` | **no** | daemon TTL tick, `smith knowledge refresh-session`, or `smith knowledge fetch` (whichever runs first) |

Re-running `smith init` over an initialized config dir is safe. Only missing files are written; the registry round-trips through `loadRegistry` → `saveRegistry` (preserving existing content); `USER.md` is left alone if present.

---

## What `smith jack-out` removes vs. doesn't remove

`smith jack-out` is the only command that removes the entire smith state root. It is **not** a full system clean — three categories of paths survive.

### Removed

- Every installed agent file at every target the bundle declared. Same scope as `smith agent uninstall-all`. Source: `src/cli/commands/jack-out.ts:88-95`. Per-agent refresh integrations (Claude Code in-file hooks, Codex `~/.codex/hooks.json` entries, OpenCode plugin entries in `~/.config/opencode/plugins/agent-smith-refresh/.smith-managed`) are torn down by the per-agent uninstall path that runs here — see [Per-platform refresh integrations](#per-platform-refresh-integrations).
- The entire `~/.config/agent-smith/` directory. Source: `src/cli/commands/jack-out.ts:101`. This includes:
  - `agents/` (every source bundle)
  - `knowledge/<name>/` for every agent that ever materialized knowledge (manifest, sources, `.cache/`)
  - `registry.json`, `skill-catalogs.json`, `installed-skills.json`
  - `USER.md`, `.env`
  - any other file under that root (subdirs, hand-created files, etc.)
- The `~/.local/bin/smith` symlink that `bin/install` created. Source: `src/cli/commands/jack-out.ts:280-291` (default at `:127`).
- Daemon runtime files and GUI job history under `~/.local/state/agent-smith/` (or `${XDG_STATE_HOME}/agent-smith/`):
  - `daemon.pid`, `daemon.log`, `daemon.heartbeat.json`
  - `gui-jobs.jsonl`, `gui-jobs-output/`
  
  The `remote/` subdirectory of the runtime state root is **not** removed — see [Not removed](#not-removed). Source: `src/cli/commands/jack-out.ts` (the `RUNTIME_STATE_FILES_TO_REMOVE` and `RUNTIME_STATE_DIRS_TO_REMOVE` constants).
- The agent-smith marker block from your shell rc file (the `# >>> agent-smith installer >>>` ... `# <<< agent-smith installer <<<` lines `bin/install` appended for PATH). Source: `src/cli/commands/jack-out.ts:71-78` (`removeMarkerBlock`) + `:301`.
- The `~/.agent-smith/` source clone itself, removed last so the rest of the run can still read its on-disk resources. Source: `src/cli/commands/jack-out.ts:318-323` (default at `:126`).

### Not removed

- **`~/.local/state/agent-smith/remote/`** (or `${XDG_STATE_HOME}/agent-smith/remote/`). Remote-backed catalog clones. Managed individually via `smith {agent,skill} unregister <label> --purge-clone`. Removing them in bulk would surprise operators who use a shared XDG state home across multiple smith installs (or who have the registry pointing at clones outside the default location). Manual cleanup is safe: `rm -rf ~/.local/state/agent-smith/remote/`.
- **`~/.cache/agent-smith/`** (or `${XDG_CACHE_HOME}/agent-smith/`). The doctor schema cache. Outside the state root.
- **Per-platform skill installs.** `~/.config/opencode/skills/<name>/`, `~/.claude/skills/<name>/`, `~/.agents/skills/<name>/`, `~/.kiro/skills/<name>/`. Orphaned because `installed-skills.json` is gone too.
- **Empty Codex per-agent dir wrappers** from earlier `smith agent uninstall <name>` runs. The wrappers are not under `~/.config/agent-smith/` and were never removed (see [Per-platform agent install dirs](#per-platform-agent-install-dirs)).
- **MCP server configs on each platform.** `~/.config/opencode/opencode.json`, `~/.claude.json`, `~/.codex/config.toml`. Smith only ever reads these — never writes, never removes.

For the typed-token confirmation flow and the per-section preview, see [11-update-and-uninstall.md](./11-update-and-uninstall.md#smith-jack-out).

---

## Files smith READS but never writes

These paths belong to other tools. `agent-smith` reads them (or fails silently if absent) and never modifies them.

| Path | Read for |
|---|---|
| `~/.config/opencode/opencode.json` | OpenCode MCP server registry, OpenCode model resolution |
| `~/.claude.json` | Claude Code MCP server registry (user scope + per-project scope) |
| `~/.codex/config.toml` | Codex MCP server registry (`[mcp_servers.<name>]` tables) |
| `~/.kiro/agents-hooks.json` | Kiro spawnable-agent hooks (smith merges its agentSpawn entries surgically — see `src/io/kiro-hooks.ts`) |

If any of these are absent, smith treats it as "the user doesn't use that platform" and proceeds silently. None of them is required.

MCP-related reads: see [06-permissions-and-platforms.md](./06-permissions-and-platforms.md). Atlassian credential reads: see [Atlassian credentials](#atlassian-credentials) below.

---

## Atlassian credentials

Source: `src/io/atlassian-auth.ts:36-71`.

`agent-smith` resolves Atlassian credentials in two-tier priority order. The first tier with both `email` and a token wins; the lower tier is not consulted.

| Tier | Source | Email key | Token keys (first wins) |
|---|---|---|---|
| 1 | process env | `SMITH_ATLASSIAN_EMAIL` | `SMITH_ATLASSIAN_API_TOKEN`, `SMITH_JIRA_API_TOKEN` |
| 2 | `~/.config/agent-smith/.env` | `SMITH_ATLASSIAN_EMAIL` | `SMITH_ATLASSIAN_API_TOKEN`, `SMITH_JIRA_API_TOKEN` |

The base URL is **required** — Atlassian Cloud instances are workspace-scoped (`https://<workspace>.atlassian.net`), so there is no global default. Set `SMITH_ATLASSIAN_BASE_URL` to your workspace URL (e.g. `https://acme.atlassian.net`); see `src/io/atlassian-auth.ts:resolveAtlassianBaseUrl`.

**File permissions.** The `.env` file contains API tokens. Smith does not validate or enforce file mode. Recommended:

```bash
chmod 600 ~/.config/agent-smith/.env
```

If the file is unreadable (EACCES), the dotenv parser silently returns `{}` and the resolver falls through to the next tier (`src/io/atlassian-auth.ts:85-92`). There is no warning — to verify which tier is being used, run `smith doctor` and inspect the `Atlassian auth` section's `source` field (one of `env-smith`, `file-smith`, or `none`).

Owning spoke: [04-knowledge.md](./04-knowledge.md#atlassian-authenticated-sources).

---

## Permissions summary

Smith does not chmod or chown anything it writes. Defaults are whatever `Bun.write`, `mkdir`, and `rename` produce on your filesystem (typically `0644` for files and `0755` for dirs, masked by your `umask`).

| Path | Recommended permission | Why |
|---|---|---|
| `~/.config/agent-smith/.env` | `0600` | contains API tokens |
| Everything else under `~/.config/agent-smith/` | default | no secrets |

If you need a stricter posture, set it yourself once with `chmod`. Smith preserves existing modes on overwrite (the temp-file-plus-rename pattern inherits the original file's mode through the rename).

---

## State-file shape quick reference

For exhaustive types, see the source file referenced in each row.

| File | Top-level shape | Source |
|---|---|---|
| `registry.json` | `{schemaVersion: 2, sources: Source[]}` | `src/io/registry.ts:25-36` |
| `skill-catalogs.json` | `{schemaVersion: 2, catalogs: SkillCatalog[]}` | `src/io/skill-registry.ts:52-55` |
| `installed-skills.json` | `{schemaVersion: 2, installed: InstalledSkill[]}` | `src/io/installed-skills.ts:30-33` |
| `daemon.pid` | plain text PID, no trailing newline guarantee | `src/cli/commands/daemon.ts` |
| `daemon.log` | append-only stdio (mixed stdout + stderr) | `src/cli/commands/daemon.ts` |
| `daemon.heartbeat.json` | `HeartbeatSnapshot` | `src/daemon/index.ts:116-121` |
| `opencode-schema-cache.json` | `SchemaCache = {fetchedAt: string, schema: object}` | `src/cli/commands/doctor.ts:38-54` |
| `<knowledge-dir>/_manifest.json` | per-source manifest written at install time | `src/core/knowledge/manifest.ts` (see [04-knowledge.md](./04-knowledge.md)) |

All JSON files written by smith are formatted with `JSON.stringify(value, null, 2)` plus a trailing newline.

---

## Where else this is discussed

Per-path semantics live in the spoke that owns the topic. This spoke owns location and lifecycle; consult these for everything else.

| Topic | Spoke |
|---|---|
| Bundle directory contents and `agent.config.json` schema | [02-bundle-anatomy.md](./02-bundle-anatomy.md) |
| `USER.md` symlink semantics, resolution, broadcast effect | [02-bundle-anatomy.md](./02-bundle-anatomy.md#usermd) |
| Render pipeline: how rendered agent files get to the per-platform dirs | [03-installing-and-rendering.md](./03-installing-and-rendering.md) |
| Knowledge dir contents, `_manifest.json` shape, cross-platform read-grants | [04-knowledge.md](./04-knowledge.md#where-knowledge-lives-on-disk) |
| Atlassian credential consumers (Confluence, Jira, `auth: atlassian` URLs) | [04-knowledge.md](./04-knowledge.md#atlassian-authenticated-sources) |
| Skill catalog model, drift detection, install/update lifecycle | [05-skills.md](./05-skills.md) |
| Per-platform translator behavior; MCP config consumers | [06-permissions-and-platforms.md](./06-permissions-and-platforms.md) |
| Agent registry `agent register`/`agent unregister`/`status`/`agent list` commands | [08-registries-and-catalogs.md](./08-registries-and-catalogs.md) |
| Daemon files (`daemon.pid`, `daemon.log`, `daemon.heartbeat.json`) | [09-daemon.md](./09-daemon.md#files-the-daemon-owns) |
| Doctor cache TTL, `--no-cache` / `--offline` | [10-doctor.md](./10-doctor.md#schema-cache) |
| `smith jack-out` confirmation flow and manual cleanup | [11-update-and-uninstall.md](./11-update-and-uninstall.md#smith-jack-out) |
