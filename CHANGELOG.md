# Changelog

All notable changes to `agent-smith` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.19.0] — 2026-06-13

### Added

- **Hybrid (semantic + lexical) knowledge search.** A knowledge source can opt
  into `retrieval: { mode: "hybrid" }` to add on-device semantic vector ranking
  on top of the lexical BM25 index, fused via Reciprocal Rank Fusion. Lexical
  BM25 remains the default; hybrid degrades to BM25 when the embedding model is
  unavailable. Set it with the new `--retrieval` flag on `smith knowledge add`
  or the retrieval-mode dropdown in the GUI. Git sources are also acquired with
  a blobless, sparse clone instead of a full checkout.
- **Per-kind embedding models.** Hybrid sources now embed code chunks with a
  code-specialized model and prose/JSON chunks with a text-specialized model,
  chosen automatically by chunk kind — so semantic search over documentation is
  no longer handicapped by a code model. Fully automatic; no new setting. Each
  model's vectors stay in their own space and are never compared across models,
  with queries searching each space separately before fusing.
- **`smith knowledge info <agent>`** — index diagnostics reporting whether
  hybrid retrieval is active, which model embedded each source, vector coverage,
  and per-source retrieval modes. Supports `--json`.
- **`knowledge.explain` MCP tool** (hybrid-only) — decomposes a query into its
  lexical and per-model semantic arms with per-arm ranks, making the fused
  ranking auditable.
- **`knowledge.map` MCP tool** — a ranked structural map of code symbols across
  a source's files (tree-sitter + PageRank), advertised when code is indexed.

### Changed

- The `knowledge.search` tool description now reflects whether hybrid or lexical
  ranking is active. The CLI and GUI advise restarting the knowledge MCP server
  after a retrieval-mode change (the server reads its index and model once at
  spawn), and warn when a hybrid source has no auto-refresh (its embeddings can
  drift) or when `--retrieval` is combined with `--lazy` (a no-op on lazy
  sources). Lazy sources disable their inert retrieval/refresh fields in the GUI.
- **Index schema upgrade.** The on-disk knowledge index gains per-chunk model
  tagging; an index built by an earlier version is rebuilt once automatically on
  the next `smith agent install`/`knowledge fetch` (no action required, no data
  loss). Hybrid-prose sources download a text embedding model on first use.

### Fixed

- Reading a knowledge index built by an older version no longer crashes
  `smith knowledge info` or the knowledge MCP server: a stale on-disk schema is
  detected and degrades cleanly (lexical fallback / "not materialized") until
  the next install/refresh rebuilds it.
- The prose/JSON embedding model now loads correctly. It previously pointed at a
  model repo without quantized ONNX weights, so it silently failed to load and
  prose sources got no semantic vectors.

## [1.18.1] — 2026-06-09

### Changed

- Refreshed the vendored OpenCode config schema so `smith doctor`'s schema-drift
  check compares against the latest upstream definition.

## [1.18.0] — 2026-06-08

### Fixed

- agent-smith installed from a package manager (`npm`/`bun`/`pnpm i -g
  @eliharoun/agent-smith`) is now fully supported alongside source installs.
  `smith update` is the single upgrade command for either install type:
  - from a source checkout it runs the git pipeline (pull + `bun install` +
    GUI rebuild + knowledge refresh + doctor) exactly as before; from a global
    install it runs the matching package-manager upgrade (`npm`/`bun`/`pnpm`),
    then refreshes and verifies — no more cryptic "fatal: not a git repository".
    If the package manager can't be determined, it prints the command to run
    instead of guessing.
  - the `smith` binary now resolves `bun` by absolute path, so it works when
    launched from MCP clients, Spotlight/dock, cron, and launchd (previously
    failed with `env: bun: No such file or directory`). Global installs also get
    the hardened `~/.local/bin/smith` launcher written at install time.
  - `smith doctor` and the GUI Update page recognize a packaged install and
    point you at `smith update` instead of showing a bare "not a git checkout".

## [1.17.0] — 2026-06-08

### Fixed

- `smith agent install --from <git-url>` now finds agent bundles that live in a
  subdirectory such as `agents/<name>/` (at any depth), instead of reporting
  "no bundles" for repositories laid out that way. Agent discovery is now
  recursive — matching how skills are already found — and skips `.git` and
  `node_modules`, stops at the first `agent.config.json` it finds in a
  directory, and is guarded against symlink cycles. The same fix applies in the
  GUI's "Install from URL" flow and agent listing. Catalogs are still registered
  at the repository root, so `smith agent sync`, `smith doctor`, and
  `smith agent unregister --purge-clone` keep working, and `smith doctor` no
  longer reports "contains no agent bundles" for these repositories.
- `smith agent register <dir>` now accepts a directory that is itself a single
  agent bundle, consistent with how URL installs register single-bundle repos.

### Changed

- In the GUI, the "Add Knowledge Source" forms now auto-format the id field to
  kebab-case as you type, and the URL form pre-fills the id from the URL until
  you edit it yourself.

## [1.16.0] — 2026-06-08

### Added

- `smith gui` now works from npm installs. The prebuilt GUI bundle and the
  raw-TypeScript GUI server ship in the package, so launching the local
  browser control panel no longer requires cloning from source (Bun is still
  required, as for the rest of the CLI). Source installs are unaffected —
  they continue to provide editable GUI source and auto-rebuild on `git pull`.

## [1.15.1] — 2026-06-07

Fixes a class of confusing failures when installing agents or skills from a
URL, and clarifies the install/register forms.

### Fixed

- `smith {agent,skill} install --from <url>` (and the GUI "Install from URL"
  discover flow) no longer crash with the generic "This is a bug in
  agent-smith" message on foreseeable bad input. Bad/unreachable URLs, missing
  branches, malformed URLs, and clone-directory collisions now produce a
  friendly, actionable error (network / not-found / usage) across every agent
  and skill install/discover/sync path.
- GitHub "web" URLs like `https://github.com/owner/repo/tree/<branch>/<subpath>`
  (what you get by copying the browser address bar) now work: smith strips the
  `/tree|blob/<branch>/<subpath>` suffix to the cloneable repo URL and uses the
  branch as the ref when one isn't supplied.

### Changed

- GUI: install/register/create inputs now show concrete example placeholders
  (e.g. `https://github.com/owner/repo`, `~/my-agents`, `bundle.tgz`) and an
  info `(?)` tooltip explaining what each field accepts.
- GUI: the "register catalog" form now detects a pasted URL/archive in its
  local-path field and points you at "Install from URL" instead of the
  confusing "not a git repo" message.

## [1.15.0] — 2026-06-07

Protects `agent-smith` (the agent), `agent-smith-self` (the synthetic
catalog), and the bundled skills (`the-architect`, `the-keymaker`) from
accidental deletion or mutation. These are part of the smith product
surface; uninstall / destroy / reconfigure / edit now refuse with a
friendly message pointing at `smith update` (to refresh) or your package
manager (to remove smith entirely).

Maintainers running smith from a local clone of its own repo get a
confirmation prompt instead of a hard refusal, so smith's own development
workflow still works (set `SMITH_CLONE_CONFIRM_ALL=1` to auto-confirm).

### Added

- `smith doctor` lists protected entities under a new `protected-bundles`
  section (agent-smith + bundled skills, with their installed paths and a
  clone-mode note).
- GUI: a "Bundled" badge marks protected agents and skills.
- GUI: a clone-mode banner appears on a maintainer's machine, dismissable
  per session.
- GUI: `/api/status` now reports `cloneMode`.

### Changed

- `smith agent uninstall|destroy|reconfigure agent-smith`,
  `smith knowledge add|remove` on agent-smith, and
  `smith skill uninstall the-architect|the-keymaker` now refuse on user
  machines (confirmation prompt in clone mode).
- GUI: `PUT /api/agents/:name/persona/:file` and
  `PUT /api/agents/:name/config` return HTTP 403 (`PROTECTED_BUNDLE`) for
  protected agents.
- GUI: `POST /api/jobs` rejects mutating commands targeting protected names
  with HTTP 403.
- GUI: persona + targets/model editors render read-only for protected
  bundles; destroy / add-source / edit / remove controls are hidden (not
  disabled).

### Fixed

- `smith agent unregister agent-smith-self` (and the skill equivalent) now
  refuse with an explicit protected error instead of failing incidentally
  with `not-found`.
- `smith jack-out` now removes agent-smith's rendered files on every
  installed platform. They were previously orphaned: agent-smith's
  synthetic source lives outside `configDir`, so the rendered files were
  left behind pointing at a smith that jack-out had just deleted. (jack-out
  remains the deliberate "remove everything" command — protection guards do
  not apply to it.)

## [1.14.4] — 2026-06-07

Pin `publishConfig.access: "public"` in `package.json` so scoped-package
publishes default to public access. Without it, `npm publish` errored
with `402 Payment Required — You must sign up for private packages`,
because npm defaults scoped packages to private (a paid feature).

This is the smallest possible fix to make `npm publish` work without
the `--access public` flag on every release. v1.14.3 was tagged but
never reached the registry; v1.14.4 is the first version actually
published to npm.

### Changed

- `package.json` adds `"publishConfig": {"access": "public"}`.

## [1.14.3] — 2026-06-07

Second rename to a scoped npm package name: `agent-smith-cli` →
`@eliharoun/agent-smith`. npm rejected `agent-smith-cli` for the same
similarity-check reason (this time matching an existing `agentsmith-cli`
package). Scoped names (`@user/name`) bypass the unscoped-name
similarity check entirely, so this is the publish-stable name. The
project, brand, GitHub repo, and CLI binary (`smith`) are unchanged.

### Changed

- npm package name: `agent-smith-cli` → `@eliharoun/agent-smith`.
  Install with `npm install -g @eliharoun/agent-smith`. The `smith`
  command on PATH is unchanged.
- `WORKSPACE_PKG_NAMES` now accepts `agent-smith` (source clones) and
  `@eliharoun/agent-smith` (npm tarballs). The transient
  `agent-smith-cli` entry from v1.14.2 was never published, so it's
  removed from the set.

## [1.14.2] — 2026-06-07

Renamed the npm package from `agent-smith` to `agent-smith-cli` because
npm refused the original name as too similar to an existing `agentsmith`
package. (Superseded by v1.14.3 — this rename was rejected too and
never made it onto the registry.)

### Changed

- npm package name: `agent-smith` → `agent-smith-cli` (rejected by npm,
  see v1.14.3 for the final scoped name).
- `WORKSPACE_PKG_NAMES` (in `src/io/workspace-version.ts` and
  `gui/server/src/services/self-source.ts`) now accepts both names so
  source-clone installs (where `package.json:name` is still
  `agent-smith`) and npm installs resolve self-source correctly.

## [1.14.1] — 2026-06-06

Publish-readiness pass: smith is now installable via `npm install -g
@eliharoun/agent-smith` (after installing bun from https://bun.sh).

### Fixed

- `data/` and `guide/` directories now ship in the npm tarball. Without
  them, every `smith` command crashed at module-load (the data files
  are statically imported by translators) and `smith agent install
  agent-smith` failed because the bundled persona's knowledge source
  pointed at a missing path.
- The `npm install` postinstall step now does a node-compatible bun
  preflight instead of hard-failing for users without bun. When bun
  isn't on PATH, smith prints a one-line hint pointing at https://bun.sh
  and exits 0 so the install succeeds. Set `AGENT_SMITH_SKIP_POSTINSTALL=1`
  to skip the bootstrap entirely.
- The postinstall now detects transitive-dependency installs and skips
  silently. Previously, any package that depended on `agent-smith`
  would trigger smith's full bootstrap (skill copies, daemon restart)
  during its consumer's `npm install` — now reserved for the user's
  own explicit global install.

### Added

- `bin` field in package.json mapping `smith` to `./bin/smith.js`. After
  `npm install -g @eliharoun/agent-smith`, the `smith` command is
  available on PATH.
- `license: "MIT"` metadata in package.json (the LICENSE file already
  existed; this just declares the metadata).

### Removed

- `*.test.ts` files no longer ship in the npm tarball.

## [1.14.0] — 2026-06-06

### GUI

**Unified Add Skill modal** — mirrors the v1.13.0 agent unification for the skill surface.

Before:

| Where | Buttons / links |
|---|---|
| Dashboard | `+ Add skill` (navigated to `/skills/new`) |
| Skills page | `Install from URL` (pulse-dot button) + `+ Register` (link to `/skills/new`) |
| `/skills/new` | full-page two-tab screen (Register catalog / Quick install) |

After:

| Where | Action |
|---|---|
| Dashboard | `+ Add skill` (navigates to Skills page, opens modal) |
| Skills page | `+ Add skill` (opens modal) |

**Smart input:** paste a git URL, local path, `.tgz` archive, or `catalog/name` reference — the modal auto-routes to the correct sub-form. A `catalog/name` ref (e.g. `default/tdd`) is recognized as a new `catalog-ref` kind distinct from paths.

**Install by catalog ref preserved:** the `/skills/new` "Quick install" capability (install a skill by `catalog/name` reference) is folded into the Install existing card as a dedicated ref field, dispatching `skill.install { name }`.

**Catalog registration upgraded:** the Register catalog card embeds `CatalogRegisterForm` with radio-button kind selector (subtitles, debounced auto-verify, advanced disclosure) — replaces `/skills/new`'s plain `<select>` + manual Verify button.

**Local-directory skill install:** new `POST /api/skills/discover-from-dir` endpoint + client wiring let the GUI install a skill from a local directory (previously CLI-only).

**Deep-link compatibility:** `/skills/new` → `/skills?add=true`. Existing bookmarks and doc links continue to work.

## [1.13.0] — 2026-06-06

### GUI

**Unified Add Agent modal** — replaces 9 scattered entry points with one `+ Add agent` modal accessible from the Dashboard, Agents page, and Catalogs page.

Before:

| Where | Buttons / links |
|---|---|
| Dashboard | `+ New agent`, `Install matrix` |
| Agents page | `+ New agent`, `Install from URL`, `Install matrix` |
| `/agents/new` | full-page create wizard + quick-install card |
| Catalogs page | `+ Register` (links to `/catalogs/register`) |

After:

| Where | Action |
|---|---|
| Dashboard | `+ Add agent` (navigates to Agents page, opens modal) |
| Agents page | `+ Add agent` (opens modal); `Install across platforms ↗` secondary link |
| Catalogs page | `+ Register` (opens modal, pre-jumped to register sub-form) |

**Smart input:** paste a git URL, local path, or `.tgz` archive into the modal's input field and it auto-routes to the correct sub-form. SSH URLs (e.g. `git@host:repo.tgz`) correctly route to git-url, not archive.

**Sub-form improvements:**
- `AgentCreateWizard`: 3-card template gallery with descriptions; live char counter; constraints shown upfront.
- `InstallExistingForm` (renamed from `InstallFromUrlModal`): conditional git-ref field; plain-English toggle labels.
- `CatalogRegisterForm`: plain-English kind radio buttons with subtitles; debounced auto-verify; advanced toggles collapsed by default; explainer header.

**Deep-link compatibility:** `/agents/new` → `/agents?add=true`; `/catalogs/register` → `/catalogs?add=register` (query params preserved). Existing bookmarks and docs links continue to work.

## [1.12.0] — 2026-06-05

Every fire-and-forget GUI job now surfaces toast feedback: sticky progress
on dispatch, timed success on clean exit, sticky error with stderr tail and
Retry/View-logs actions on failure. Three ambient monitoring toasts cover
daemon health, daemon restart-after-upgrade, and pending-ops replay when a
new platform CLI is installed.

### Added

- `useJobToast` hook (`gui/web/src/hooks/useJobToast.ts`): generic
  progress→success/error toast lifecycle for any `useStartJob` dispatch. Uses
  the v1.11.0 `notify`/`update`/`dedupKey` API; mirrors `useReinstall.ts`'s
  SSE-driven exit pattern.
- Install feedback: `InstallFromUrlModal` (agent.install / skill.install) now
  shows progress and result toasts.
- Sync feedback: `RemoteSyncConfirm` (agent.sync / skill.sync) now shows
  progress and result toasts.
- Knowledge feedback: `KnowledgeSources` compile, fetch (all and per-source),
  and remove operations now show progress and result toasts.
- Skill feedback: `SkillNew` register and install, `SkillValidate` validate
  operations now show progress and result toasts.
- `useDaemonStalenessToast`: fires a sticky error toast when the daemon is
  stuck or has a stale pid; recovers to a timed success toast when the daemon
  becomes healthy again. Includes a "Restart daemon" action button.
- `useDaemonRestartToast`: fires a timed info toast when the daemon's PID
  changes (indicating a self-restart after `smith` binary upgrade). No server
  changes needed — uses the existing `DaemonStatus.pid` field.
- `useDetectPlatformCli`: polls `/api/platforms/detected` every 30 s; when a
  previously-absent CLI appears, fetches pending ops and fires an info toast
  with a "Replay N installs" action.
- `GET /api/pending-ops` server endpoint: reads `~/.local/state/agent-smith/
  pending/` via `listPendingOps` and returns the full list as `{ ops: PendingOp[] }`.

## [1.11.1] — 2026-06-04

### Changed

- Child MCP server stderr no longer floods the terminal that ran
  `smith gui` (or any smith command that spawns MCP servers). Each
  child's stderr is now piped to `<runtimeStateHome>/mcp-logs/<server>.log`
  (typically `~/.local/state/agent-smith/mcp-logs/`) with size-based
  rotation: `.log` → `.log.1` → ... → `.log.3` once the active file
  exceeds 10MB. On first MCP spawn per session, smith prints a single
  dim line pointing at the log directory.

### Added

- `SMITH_MCP_VERBOSE=1` env var: when set, restores the old behavior
  of inheriting stderr from child MCP processes. Useful when actively
  debugging an MCP server that won't initialize.
- New `src/io/mcp-stderr-log.ts` helper: per-server log writer with
  fire-and-forget semantics (writes never throw or block) and graceful
  degradation when the log dir can't be created.

## [1.11.0] — 2026-06-05

Producer side gains a directory-mode export for publishing bundles
into shared catalog repos; recipient side gains a local-directory
install path for working from already-cloned catalogs. The GUI's
Export modal grows a format toggle, recents dropdown, and collision
preflight; the Install modal grows a live source-type badge and a
sticky info toast that surfaces git-remote registration when the
target is a git checkout.

### Added

- `smith agent export <name> --format directory --to <dir>`: writes
  loose files at `<dir>/<name>/` instead of a `.smith-bundle.tgz`
  archive. Refuses if `<name>/` exists; `--force` overrides with full
  replace. New flags `--with-readme` (off by default — the
  auto-generated README's content is wrong inside a git checkout)
  and `--no-manifest` (default keeps the manifest).
- `smith agent install --from <local-dir>`: register-and-install from
  a local directory. Refuses paths inside `<XDG_STATE_HOME>/.../remote/`
  (use the upstream URL instead) and re-registration of the same
  path. Prints a one-line stderr hint when the directory is a git
  checkout, suggesting `smith agent register --git-remote` to enable
  `smith agent sync`.
- GUI Export modal: segmented format toggle on the Plan step
  (Archive | Directory) with a one-time dismissible hint; editable
  path field with a per-format recents dropdown on Confirm; collision
  preflight + Overwrite toggle on Confirm; format-aware Run+Result
  with a "Copy git commit command" CTA in directory mode.
- GUI Install modal: live `[archive]`/`[local directory]`/`[git url]`
  badge below the URL field; folder-drop friendly error.
- GUI sync-hint toast: sticky info toast fires after a local-dir
  install when the directory has a detected git remote, with a
  "Register for sync" action button. Dismissed paths persist in
  localStorage.
- New endpoint `POST /api/agents/:name/export/preflight-collision`
  for the modal's collision check.
- New endpoint `POST /api/agents/discover-from-dir` for the install
  modal's local-directory discovery.
- New helpers in `src/io/`: `local-dir-detect.ts` and
  `git-remote-detect.ts` (parses `.git/config` directly, no shell-out
  to `git`).

### Changed

- The export plan endpoint accepts a `format` query param so the
  preview adapts (file list vs single archive size).
- `formatExportSummary` and friends now branch on format; directory
  mode prints a "next steps" hint with the git commit command on TTY.

### Documentation

- `guide/14-cli-reference.md` gains full reference entries for
  `--format directory` and `--from <local-dir>`.
- `guide/15-sharing-and-distribution.md` gains §9.9 (directory-mode
  publishing) and §9.10 (installing from a local checkout).
- `README.md`, `CHEATSHEET.md`, and `GUIDE.md` updated.

## [1.10.2] — 2026-06-05

Hotfix release that hardens long-running daemons against staleness after
a smith upgrade. Three coordinated layers prevent users from seeing
spurious "agent.config.json validation failed" warnings caused by a
daemon process holding a frozen-in-memory schema.

### Fixed

- `bun install` now auto-restarts a running smith daemon, so an upgrade
  always brings the daemon's in-memory schema back in sync with the
  on-disk binary. A 60-second recency guard avoids killing a daemon the
  user just started. Set `SMITH_NO_DAEMON_AUTO_RESTART=1` to opt out
  (e.g. when the daemon is supervised by launchd or systemd).
- The smith daemon now stats its own binary on each reinstall tick and
  exits cleanly when the mtime moves past startup. This catches upgrade
  paths that bypass the postinstall hook (manual `git pull && bun
  install` with a silently-failing hook, or a binary swap by the OS
  package manager). Set `SMITH_NO_DAEMON_SELF_RESTART=1` to opt out.
- Bundle-load warnings now point at the daemon when the failure shape
  matches a forward-incompatible config (Zod's `Unrecognized key` /
  `Invalid input` patterns). Users no longer have to reason from "the
  config field looks fine" to "the daemon's schema is out of date" on
  their own — the warning suggests `smith daemon stop && smith daemon
  start` directly.

## [1.10.1] — 2026-06-05

Hotfix release for five `smith doctor` correctness bugs surfaced by
real-user dogfooding.

### Fixed

- `smith doctor --fix-*` flags now re-render the affected section after
  applying fixes, so the printed report reflects the post-fix state.
  Previously the report cached the pre-fix state, making the user think
  the fix didn't work even when it had. Affects
  `--fix-knowledge-refresh`, `--fix-knowledge-compile`, and
  `--fix-mcp-commands`.
- `smith doctor --fix-knowledge-compile` now converges on the first run
  for bundles with lazy URL knowledge sources. The doctor's drift
  detector and the CLI compile path now share a single
  `buildCompileOptionsFromBundle` helper so they produce identical
  `contentHash` values for the same bundle.
- `smith doctor` now distinguishes "consent recorded but no
  session-refresh sources today" (info-level `consent-without-need`)
  from "consent recorded and hook missing" (warn-level `missing-hook`).
  The new finding kind is suppressed in default output. The
  corresponding `--fix-knowledge-refresh` revokes the stale consent
  rather than re-registering an orphan hook.
- `smith agent reconfigure <agent> --grant <platform>` now refuses
  when the bundle has zero `refresh: session/always` sources, so the
  consent-without-need state can't be (re-)created.
- `smith agent init <name>` is now atomic: if any post-mkdir step
  fails (validation, file copy, symlink), the bundle directory is
  cleaned up before the error propagates. No more orphan empty dirs
  from aborted inits.
- The registry-hygiene warning for a stale catalog (rootPath no longer
  exists on disk) now suggests `smith agent unregister <label>` (or
  `smith skill unregister`) so users don't have to know the cleanup
  command by heart.

## [1.10.0] — 2026-06-04

Major UX consistency pass for multi-platform behavior. Every command
now treats `targets[]` as aspirational and the user's installed CLIs
as the execution set, with one canonical primitive driving the
decision. Doctor stops warning about healthy "platform not installed"
state.

### Changed

- `smith agent install` writes only to detected platform CLIs.
  Declared targets whose CLI isn't on PATH are skipped with a single
  `~ <platform>: not detected — skipped` line instead of being
  silently dropped or speculatively written.
- `smith agent init` defaults `targets` to your detected platforms
  plus `agents-md`. Authors creating bundles for sharing can still
  override with `--targets`.
- `smith agent uninstall` now distinguishes "platform not installed"
  from "file missing" — clearer output when you uninstall an agent
  on a system that never had a target's CLI.
- The GUI's "Authorize and refresh" banner grants consent only for
  detected platforms, eliminating the orphaned-consent state that
  caused doctor warnings on healthy systems.

### Added

- New `--platform <list>` flag is consistent across commands. Forces
  writes to a named platform regardless of detection (with a printed
  advisory). Replaces ad-hoc per-command behavior.
- New `<stateHome>/pending/` directory records skipped operations.
  When a previously-missing platform later appears, future smith
  commands have the breadcrumbs to replay (full sync command lands
  in a follow-up release).
- `GET /api/platforms/detected` GUI server endpoint exposes the
  detected set so the consent banner and other UI panels can filter.

### Fixed

- `smith doctor` no longer warns about consent records or hooks files
  for platforms whose CLI isn't installed. Findings on undetected
  platforms reclassify to info-level and are suppressed in the
  default report (visible under `--verbose`).
- The unmanaged-codex-hooks check no longer fires when codex isn't
  installed (the file isn't smith's to manage in that case).

### Migration

No bundle config or manifest changes needed. Existing manifests with
consent for now-uninstalled platforms get reclassified as info on
next `smith doctor` run; `--fix-knowledge-refresh` cleans them up.

## [1.9.2] — 2026-06-04

Two fixes for v1.9.0/v1.9.1 lazy URL and drift-check behavior.

### Fixed

- The rendered `## Knowledge` preamble now explicitly explains the
  `[url, lazy]` entry shape — that those URLs are NOT downloaded and
  must be fetched at runtime via the tool listed under `fetch via:`.
  The clause only appears when at least one lazy entry is present, so
  bundles without lazy URLs are unchanged. Previously, agents had to
  infer this from the `[url, lazy]` tag and the absence of an on-disk
  path, which not all models did reliably.
- The GUI drift-check service now reproduces the same render pipeline
  the installer uses, including resolved model tiers, the agent's
  knowledge directory and compiled knowledge index, and platform
  conventions. Drift is no longer reported for agents whose installed
  bytes are byte-identical to a fresh re-render. Two limitations
  remain: bundles whose user consented to refresh hooks
  (claude-code/kiro session/always sources) and bundles with lazy URL
  sources targeting agents-md formats — install-time URL fetches
  cannot be cheaply reproduced without a network roundtrip.

## [1.9.1] — 2026-06-04

GUI improvements: a re-install button on the agent detail page, the
ability to flip existing URL knowledge sources between non-lazy and
lazy fetch from the Edit modal, and a generic notification system that
surfaces save outcomes and re-install progress.

### Added

- **Re-install button** on the agent detail page. Re-renders and
  re-installs only on the platforms where the agent is currently
  installed. A green drift indicator appears when the on-disk render
  no longer matches the current config, with per-platform dots showing
  exactly which targets are out of date. Drift detection re-runs the
  same render+serialize+hash chain the installer uses, so a positive
  signal genuinely means re-install would change bytes on disk.
- **Lazy fetch toggle in the Edit knowledge source modal.** Existing
  URL sources can now switch between non-lazy and lazy fetch from the
  GUI. Switching to lazy on a source with cached install-time
  artifacts triggers a confirm dialog asking whether to keep or delete
  those files. The four fields the schema forbids alongside lazy
  fetch (delivery, materialize, extractor, inlineBudgetTokens) are
  visually disabled and dropped from the saved config.
- **Notification system** (success / info / warning / error /
  progress) with WAI-ARIA live regions, hover-pause, dedup by key,
  and mutation by id for progress-to-result transitions. Used by the
  re-install flow and by the knowledge-source save flow.
- After saving a knowledge source change, the GUI now confirms the
  save and, when applicable, prompts the user to re-install with an
  inline "Re-install now" action.
- New endpoints: `GET /api/agents/:name/install-state`,
  `GET /api/agents/:name/drift-check`,
  `DELETE /api/agents/:name/knowledge/sources/:id/cache`,
  `GET /api/agents/:name/knowledge/sources/:id/cache-status`.

## [1.9.0] — 2026-06-04

URL knowledge sources can now opt out of install-time fetching. With
`lazy: true` set on a `type: url` source, the bundle ships only the
URL and a description; the agent fetches the page on demand at runtime
through its built-in fetch tool, or through an MCP tool when `via:` is
set. Bundles that also target `agents-md` (Cursor, Windsurf, Aider) —
which have no runtime fetch surface — auto-degrade for that target
only: smith fetches each lazy URL at install time and renders the body
inline (or as a sidecar file for large content) with a source URL
reference.

### Added

- `lazy: true` on URL knowledge sources. When set, smith skips acquire
  and materialize for that source; the compiled prompt's knowledge
  index renders the URL plus the fetch tool the agent should call.
  `delivery`, `materialize`, `extractor`, and `inlineBudgetTokens` are
  forbidden alongside `lazy: true` (the schema rejects them with a
  clear error).
- `smith knowledge add <agent> <url> --lazy` flag for adding a lazy
  URL source from the CLI. The installer warns when the description
  is missing, too short, written in first or second person, or longer
  than 1024 characters — lazy sources show only their description in
  the agent's prompt until it fetches, so description quality matters.
- "Lazy fetch" toggle on the URL knowledge source form in the browser
  GUI. When enabled, the delivery / materialize / extractor fields are
  hidden (since the schema forbids them on lazy sources).
- `smith doctor` now includes a `lazy-fetch` section that flags lazy
  URL sources whose targets lack a runtime fetch tool AND have no
  `via:` routing to fall back on.
- `smith knowledge fetch` for a lazy source revalidates that the URL
  still resolves but never re-fetches the body — every conversation
  fetches fresh content at runtime.

## [1.8.1] — 2026-06-04

GUI export polish: configurable default export directory and a real
completion view, plus a CLI fix where the success summary was being
written to stderr (and thus appeared red in some terminals).

### Added

- New `exportDir` setting in `gui-state.json` (default: empty string,
  resolved to `~/Downloads` server-side). Configurable via a new field on the
  Settings page (next to the Port control).
- GUI Export modal: Confirm step now shows the resolved save path
  read-only with a "Change default" link to Settings, instead of
  asking the user to type a path. Run step replaces its placeholder
  with a live completion view that shows filename + size + sha256 +
  "Copy install command" and "Show in folder" buttons.
  The Cancel / Continue footer is hidden on the completion
  step — the operation is done, so only Close remains.
- New `POST /api/fs/show?path=...` route opens the parent directory
  of an artifact in the OS file explorer (`open -R` / `explorer
  /select,` / `xdg-open`). The path is required to live under the
  user's home directory; any other path is refused.

### Fixed

- `smith agent export <name>`: success summary now goes to stdout
  instead of stderr. Some terminals render stderr in red regardless
  of the actual escape codes, making a successful export look like
  an error.

## [1.8.0] — 2026-06-04

Bundle archive export and import: produce a single `.smith-bundle.tgz`
file that packages a bundle plus its required skills and local
knowledge, and consume it with `smith agent install --from <archive>`.
The archive declares MCP-server and credential needs in the manifest so
the recipient sees them up-front; remote knowledge sources are
re-fetched at install time using the recipient's own credentials.

### Added

- `smith agent export <name>`: package a bundle into a deterministic
  `.smith-bundle.tgz` archive. Embeds local knowledge (`type: file` /
  `dir` / `glob`) by default and required skills opt-in
  (`--include-skills`, default on). Flags: `--to <path>`, `--stdout`,
  `--user-md <stub|keep|reject>`, `--compression <gzip|none>`,
  `--json`, `--dry-run`.
- `smith agent install --from <path-or-url>`: now accepts
  `.smith-bundle.tgz` archives in addition to git URLs. HTTPS URLs are
  downloaded with a 200 MB cap and a host-allowlist that refuses
  loopback / link-local / RFC1918 addresses.
- GUI: **Export** button on the agent detail view opens a three-step
  modal (plan → confirm → run) that surfaces the manifest preview and
  dispatches the export job.
- GUI: **Install from URL** modal accepts archive paths in the URL
  field and adds a drag-and-drop zone that uploads the archive to a
  new `POST /api/import/stage` endpoint with size + filename
  sanitization.
- New manifest schema (`_smith-export.json`) declares MCP-server
  requirements, credential needs, remote-knowledge endpoints, and
  embedded-vs-declared skill list. Recipients verify per-file sha256
  hashes before staging.
- Recipient catalog distinction: imported-archive catalogs surface as
  `imported-archive` in `smith agent list` / `smith agent catalogs`.
  Running `smith agent sync` against an imported-archive label prints
  an advisory and exits `0` instead of attempting a git pull.

### Changed

- Producer-side determinism: archive bytes are stable across machines
  for the same logical inputs (lexicographic entry sort, epoch-pinned
  mtimes, `userAgent` strips host platform, manifest `contents.files`
  sorted by path). Re-running `smith agent export <name>` produces a
  byte-identical archive.

### Security

- Archive importer enforces path-containment before every filesystem
  write; manifest-driven staging refuses entries the manifest doesn't
  list; `bundle.name` schema rejects path-traversal sequences before
  any disk work; `ZERO_HASH` skip restricted to the manifest
  self-entry only; `readArchive` caps decompressed size and entry
  count to defend against tar bombs; symlinks in knowledge sources
  are refused at export time so producers can't accidentally embed
  files outside the bundle directory.

## [1.7.3] — 2026-06-04

### Changed

- `retrieval.mode` on a knowledge source now defaults to `bm25` instead
  of `off`, both in the GUI's per-source edit modal and in the compile
  step that writes the TOC annotation. This matches what the local BM25
  server actually does today: `smith knowledge serve` builds an
  in-memory BM25 index over every `.md`/`.txt`/`.json` file in the
  materialized knowledge tree on startup, regardless of any per-source
  setting. Setting `bm25` (now the default) adds a `(searchable: bm25)`
  hint to the source's compiled TOC line, priming the agent toward
  `knowledge.search` queries; `off` omits the hint (advisory marker
  that the source isn't search-friendly); `external-mcp` declares a
  remote MCP for retrieval (annotation only today; runtime delegation
  is forward work).

- The GUI no longer persists a `retrieval` block when the user picks
  `bm25` (the implicit default). Existing bundles with explicit
  `retrieval: { mode: "bm25" }` continue to work; new bundles stay
  clean.

### Help text

- The retrieval-mode tooltip in the GUI is rewritten to explain that
  the BM25 index is rebuilt per session in the server's process
  memory (no persistent reverse-index file), that the field today
  controls only the TOC annotation (a prompt-engineering hint),
  and that runtime gating per source is forward work.

## [1.7.2] — 2026-06-04

### Fixed

- HTML sources that pass through the `html-to-md` materializer now land
  on disk with `.md` extensions instead of `.html`. The bytes have been
  transformed to markdown after turndown; the extension now matches.
  Side effect: BM25 search via `smith knowledge serve` now sees these
  files (the indexer's allowlist already includes `.md` but not `.html`,
  so wiki content was previously unsearchable via `knowledge.search` —
  agents had to fall through to direct-by-path `knowledge.fetch`).

### Migration

Existing `.html` files on disk keep working until the next
`smith knowledge fetch <agent>` (or `--source <id>`), which re-acquires
through the new pipeline and writes `.md` files. To force the rewrite
without waiting, run `smith knowledge fetch <agent>`.

## [1.7.1] — 2026-06-03

Two fixes for knowledge-source refresh, both of which prevented the
materializer from ever seeing the real content:

### Fixed

- `smith knowledge fetch <agent> --source <id>` is no longer a silent
  no-op for sources whose `delivery` is `"auto"`. The surgical refresh
  path was returning early as if `auto` had no on-disk artifact, so
  the file would stay frozen at whatever it was when last installed.
  Now `auto` falls through to the full acquire+materialize chain and
  the post-acquire size check decides inline-vs-file as intended.
- HTML pages that embed their real content inside a content-bearing
  element (e.g. a `<textarea>` carrying the source HTML, common in
  static-HTML wrappers and source-view modes) now have that inner
  document extracted before materialization. Previously the outer
  page's chrome would land on disk and the embedded content was
  invisible to turndown (which skips form-field elements entirely).

### Added

- New `tryUnwrapEmbeddedHtml(html)` helper that detects this pattern
  via a two-tier algorithm: a class-signal tier for elements
  explicitly marked with idioms like `wiki-code` / `source-code` /
  `raw-content`, and a shape-fallback tier that compares the embedded
  element's content size against the rest of the body (swap when the
  embedded content is at least 2× larger). Wiki-platform detection
  re-runs on the unwrapped HTML, so the dispatcher routes the inner
  document to wiki-mode or article-mode based on its own shape.

## [1.7.0] — 2026-06-03

Wiki content from MCP-routed knowledge sources now materializes as
clean markdown with tables, code blocks, and headings preserved.
Previously, JSON-wrapped HTML from MCP tool results was written
verbatim as `.txt`, leaving the agent to mentally parse 30KB+ of
envelope-wrapped HTML on every read. The fix is content-type aware
and consistent: the same input shape always produces the same output.

### Changed

- HTML materializer now loads `turndown-plugin-gfm`. Tables in
  wiki, news, and blog content are preserved as GFM pipe tables
  instead of silently flattened to whitespace-separated text.
- Wiki-shaped HTML (XWiki, Confluence, MediaWiki, SharePoint —
  detected by HTML signature) is converted directly with turndown,
  skipping Mozilla Readability. The wiki backend already strips
  chrome server-side; running an extractor on it would only drop
  content (the previous behavior silently dropped tables and code
  blocks Readability scored as boilerplate).
- Non-wiki HTML still uses Readability + turndown for chrome
  stripping, with GFM added so news-article tables survive too.
- Materialized HTML files now begin with a YAML frontmatter block
  (title, source_url, fetched_at) so the agent has provenance and
  a skim-friendly title without paying tokens to re-derive them.
- HTML materializer now resolves relative links against the real
  source URL instead of `http://localhost/` (a longstanding latent
  bug that produced bogus `http://localhost/...` links in markdown).

### Added

- New `sniffArtifact(bytes, hints)` helper: unwraps known JSON
  envelope shapes (`{content: {content}}`, `{content}`, `{html}`,
  `{body}`, `{text}`, `{markdown}`, `{result}`, `{data}`) returned
  by MCP tools, then content-type-sniffs the inner bytes and
  picks an honest filename extension.
- New `detectWikiPlatform(html)` helper: substring-based detection
  for the four supported wiki platforms; cheap (~8KB scan) so it
  runs on every HTML artifact without measurable overhead.

### Fixed

- via-routed knowledge sources no longer write JSON envelopes
  verbatim to disk. The user-visible result: refreshing a routed
  wiki source produces ~70% fewer tokens in the materialized file
  (measured: 10,533 → 2,885 tokens on a representative 33KB page).
- Files materialized from `text/html` content now have `.html` /
  `.md` extensions instead of `.txt`. The BM25 indexer in
  `smith knowledge serve` continues to index them (`.md` was
  already in the allowlist).

### Migration

Existing materialized corpora persist on disk until the next
`smith knowledge fetch <agent>` (or `--source <id>`), which
re-acquires through the new pipeline. No schema changes; no CLI
surface changes; no GUI changes. The existing per-source
`materialize` override field continues to work as a manual escape
hatch for advanced cases.

## [1.6.0] — 2026-06-03

Per-agent knowledge MCP keys: each bundle's knowledge MCP server now
uses a unique per-agent key (`<agent>-knowledge`) so multiple bundles
can be wired into the same AI client without clobbering each other.

### Added

- smith knowledge wire <agent> [--platforms ...]: wire a bundle's
  knowledge MCP server into detected AI client configs (claude.json,
  opencode.json, codex/config.toml, kiro/.../mcp.json) and add the
  per-agent key to the bundle's mcpServers[]. Mirrors the GUI toggle.
- smith knowledge unwire <agent> [--platforms ...]: removes the
  per-agent key from bundle config and AI client configs.

### Changed

- Knowledge MCP server key: was the singleton "agent-smith-knowledge";
  now derived per-agent as "<agent>-knowledge". For the agent-smith
  bundle the key is unchanged ("agent-smith-knowledge"). For other
  bundles, the key is unique (e.g. "billing-expert-knowledge").
- The MCP server's serverInfo.name advertised over JSON-RPC is now
  also the per-agent key. AI clients see distinct servers per agent.
- The "wire MCP" GUI modal now skips bundle-config writes and the
  follow-up reinstall when the saved state already matches the
  desired state. The button is replaced with a Close action when
  every platform AND the bundle config are already in the desired
  state, eliminating the previous "wire 0 platforms" no-op.

### Migration

If you previously wired the agent-smith bundle, no migration is
needed — the key for that bundle is unchanged. If you have multiple
bundles whose knowledge you want exposed as MCP servers, run
`smith knowledge wire <agent>` for each one; the per-agent keys
coexist without overwriting.

## [1.5.0] — 2026-06-03

Major change to `smith knowledge compile`: it now operates entirely
on already-materialized sources instead of re-fetching from network/
MCP. Authors iterating on compile and delivery settings no longer
burn fetches per iteration.

### Changed

- `smith knowledge compile` reads materialized files from
  `<stateHome>/agents/<agent>/knowledge/sources/` instead of
  re-acquiring. The command no longer requires network access, MCP
  server spawning, or routing config.
- Compile fails cleanly with "run smith knowledge fetch first" when
  a source has never been materialized.
- Compile is now idempotent and safe to re-run repeatedly.

### Removed

- The MCP-pool wiring added to compile in v1.4.4 is no longer needed
  and has been removed. Routed knowledge sources are still resolved
  during `smith knowledge fetch` and `smith agent install`, where
  the wiring lives.

## [1.4.4] — 2026-06-03

### Fixed

- smith knowledge compile now resolves MCP routing for sources that
  declare `via:`. Previously the compile path failed with an internal
  error because the MCP client pool and spawn-options resolver were
  not wired in.

## [1.4.3] — 2026-06-03

Edit-time control over knowledge-source routing.

### Added

- The Edit Knowledge Source modal in the GUI now exposes the same
  routing dropdown as Add. URL sources show their current `via:`
  server and tool pre-selected; users can switch servers, switch
  tools on the same server, or revert to direct HTTP. Servers
  declared on the source but absent from the user's MCP config show
  with a `[not configured]` badge.
- `smith knowledge route <agent> --source <id> --clear-via` removes
  the `via:` declaration from a routed source, switching it back to
  direct HTTP. The flag requires `--source` and is non-interactive;
  switching to a different server still uses the picker.

### Changed

- The Edit modal's `mcpServers[]` is auto-extended when a user picks
  a server from their AI client config that wasn't yet in the
  bundle. `mcp.required[]` is left untouched on Edit (it's an Add
  concern).

## [1.4.2] — 2026-06-03

Polish release on top of v1.4.1's routing picker — retrofitting existing sources, lock recovery, and clearer errors.

### Added

- `smith knowledge route <agent> [--source <id>]` — invoke the routing
  picker against URL sources already in a bundle, without removing and
  re-adding. Sources that already have `via:` set are skipped unless
  you target them with `--source`.
- `--force-unlock` flag on `smith agent install` and `smith knowledge
  fetch` — removes a held `.install.lock` (typically left by a killed
  prior run) and proceeds. Logs the lock's mtime so you see when it
  was acquired.

### Changed

- When a routed `via.tool` doesn't exist on the server, smith now
  lists the URL-shaped tools the server DOES expose so you can pick a
  real name without consulting the server's docs separately.
- The lock-contention error message now surfaces the lock path along
  with the `--force-unlock` hint.

### Internal

- `saveRouteCache` is now injectable for tests, replacing the prior
  `XDG_CONFIG_HOME` env-mutation pattern.
- gui-server `tsconfig.json` no longer enforces a per-workspace
  `rootDir`, so cross-rootDir static imports compile cleanly without
  the previous string-variable indirection workaround.

## [1.4.1] — 2026-06-03

### Fixed

- The MCP routing picker added in v1.4.0 now actually runs in the
  production CLI; the prompt and TTY detection were not wired in.
- Bundle config schema now persists mcp.required and mcp.peer
  through parsing. v1.3 sharing-time dependency declarations were
  silently stripped before this fix.
- gui-server typechecks again after the new MCP picker route.
- Picker auto-marks the chosen server as required in mcp.required[]
  so recipients of the bundle refuse install if missing.
- Picker prints a "loading tools from <server>…" status line during
  the tools/list call so authentication-coupled servers don't look
  hung.

## [1.4.0] — 2026-06-03

v1.4 makes routed knowledge sources easy to author: at add time you
pick the MCP server you want for this URL, and smith records the
via: for you. Auto-detection still applies if you skip the picker.

### Added

- Interactive MCP server/tool picker in `smith knowledge add` for
  URL sources. Lists servers from the bundle and from your AI client
  config; smith auto-extends mcpServers[] when you pick a new one.
- Smart-default tool selection: when the chosen server has exactly
  one URL-shaped tool smith uses it silently; multiple tools prompt
  once; zero raises a clear error with no abort-without-explanation.

### Changed

- The curated routing-suggestion registry now runs only when the
  picker is skipped (non-interactive run, or user chose "skip").

## [1.3.3] — 2026-06-03

### Fixed

- Probe-on-failure now recognizes URL-fetcher tools that accept the
  URL as an array of strings (inputs, urls, targets, etc.), not just
  a single string parameter. Routed fetches automatically wrap the
  URL in an array when the tool's input schema expects one.

## [1.3.2] — 2026-06-02

### Fixed

- Probe-on-failure now restricts candidate tools to those whose
  inputSchema declares a url parameter, preventing prompts about
  unrelated read-shaped tools (issue trackers, search APIs, etc.) on
  bundles that declare many MCP servers. Candidate prompts are also
  capped at 5 per fetch — if more applicable tools exist, set via:
  on the source explicitly.

## [1.3.1] — 2026-06-02

### Fixed

- smith knowledge fetch and smith agent install no longer pre-spawn
  every declared MCP server on each invocation. Self-claim probing is
  now opt-in via SMITH_PROBE_META=1 — the on-demand fallback covers
  the cases users hit in practice without the upfront cost.
- MCP server name-mismatch warnings (server declared in the bundle
  but registered under a different name in the platform's MCP config)
  no longer block install. The warning prints; install proceeds.

## [1.3.0] — 2026-06-02

Three-layer URL routing. URL knowledge sources without an explicit
`via:` now resolve through curated patterns, server self-claims, and
a per-user learned cache before falling back to direct HTTP. When
HTTP fails, smith offers to probe the bundle's MCP servers and
remembers the user's choice — auth-coupled internal URLs become
discoverable rather than hand-configured.

### Added

- `_meta` self-claim parsing on MCP `tools/list`. Servers can
  advertise URL patterns they handle by including
  `_meta: { "dev.agent-smith/fetchDomains": ["wiki.internal.example.com"] }`
  on a tool descriptor. Smith picks up the claim during install and
  uses it as Layer 2 of the routing resolver.
- Probe-on-failure prompt. When a URL source without `via:` fails the
  direct HTTP fetch, smith asks `Try via <server>.<tool>?` for each
  server declared in `mcpServers`. Skipped silently in non-TTY runs
  (cron, daemon, CI) so unattended workloads never block on stdin.
- Per-user routing cache at `~/.config/agent-smith/url-routing.json`.
  Confirmed probe results persist there; the next install with the
  same URL skips the prompt and routes through the cached
  `<server>.<tool>` pair.
- `url-routing` doctor section. Enumerates every pattern smith would
  auto-route, grouped by source layer (`curated` / `advertised` /
  `learned`), and flags any pattern claimed by more than one
  server/tool pair as ambiguous. Read-only; informational.
- `SMITH_DOCTOR_PROBE_META=1` env var. Gates the spawn loop the
  `url-routing` section uses to discover Layer 2 (`advertised`)
  claims. Off by default — probing every declared server is slow and
  side-effecting (auth tokens, multi-second handshakes), so the
  section omits the advertised layer unless you opt in.

### Changed

- URL knowledge sources without a `via:` field now consult the
  three-layer resolver (cache → advertised → curated) before
  falling back to direct HTTP. Previously, only an explicit `via:`
  on the source — or a curated suggestion accepted at
  `smith knowledge add` time — could route a fetch through MCP.
- On HTTP failure for a URL source, smith offers to probe the
  bundle's declared MCP servers and remembers the user's choice in
  `~/.config/agent-smith/url-routing.json`. Subsequent installs of
  the same source skip the prompt.

### Documentation

- New section in `guide/04-knowledge.md`: "How smith picks a route" —
  walks through the three resolution layers and the probe-on-failure
  UX.
- `guide/14-cli-reference.md`: `url-routing` doctor section
  description plus the `SMITH_DOCTOR_PROBE_META` env-var note.

## [1.2.0] — 2026-06-02

MCP-routed knowledge sources. URLs in knowledge sources can now be
fetched through declared MCP servers' tools, enabling auth-coupled
internal sources (corporate wikis, ticketing, document stores) without
embedding auth schemes into smith. Bundles declare MCP dependencies
explicitly; `smith agent install` checks them at install time.

### Added

- `via: { server, tool, args? }` field on URL knowledge sources.
  Routes the fetch through `<server>.<tool>` over MCP instead of HTTP;
  `args` merges into the tool call payload alongside the auto-supplied
  `{ url }`.
- Curated routing-suggestion registry: known patterns
  (`*.atlassian.net/wiki/`, `*.sharepoint.com`, `*.notion.so`,
  `github.com/<owner>/<repo>/blob/...`) trigger a confirmation prompt
  during `smith knowledge add`. Suggestion-only — smith never auto-sets
  `via` without explicit user `y`, because tool names vary by MCP
  server distribution.
- `mcp.required[]` / `mcp.peer[]` on the bundle config. Semantics
  mirror npm: required blocks install when missing; peer warns.
- `smith agent install` runs an MCP preflight before render. Refuses
  on a missing required server (exit `1`); warns on a missing peer.
  `--allow-missing-mcp` demotes the refusal to a warning.
- `smith doctor` `mcp-deps` section auditing installed agents'
  declared MCP dependencies against the union of platform MCP configs.
  Read-only, informational, no auto-repair flag.
- Internal: `McpClient`, `McpClientPool`, `acquireViaMcp` for stdio
  MCP RPC at acquire time. The pool is shared across knowledge
  fetches in a single run so each declared server starts at most once
  per `smith knowledge fetch` invocation.

### Changed

- `smith agent install` exit code `1` (`EXIT_RUNTIME`) now also
  covers a missing required MCP server. Previously the install would
  fail later at acquire time with a less actionable error.
- `acquireSource` for `type: "url"` now consults `via` (explicit) or
  the curated registry (via the auto-resolved route, when the user
  has saved the source with `via`) before falling through to direct
  HTTP.
- `smith knowledge fetch` reuses the same MCP client pool as install,
  so refresh runs no longer re-spawn a server process per source.

### Documentation

- New sections in `guide/04-knowledge.md`: "Routing URL fetches through
  MCP servers" + "Bundle MCP dependencies".
- `guide/14-cli-reference.md`: `mcp-deps` doctor section description;
  `smith agent install` exit-code update for required-MCP refusal.

## [1.1.1] — 2026-06-02

Patch release fixing GUI regressions in the `agents-md` render target shipped in v1.1.0, plus a knowledge-modal UX fix.

### Fixed

- GUI no longer drops agents whose `targets` include `agents-md`. The shared `AgentSummary` schema's target enum was a 4-value subset (`opencode | claude-code | codex | kiro`); under v1.1.0's 5-value canonical `Target` (which adds `agents-md`), strict-mode parsing rejected any such agent at registry-walk time and the GUI silently skipped it with `[agents] skip <name>: invalid agent.config.json`. The fix covers both the gui-shared schema and the duplicate `ConfigSchema` in `gui/server/src/services/scan-bundle.ts` that actually parses bundles off disk.
- The `targets` checkbox group in the agent editor now offers `agents-md` alongside the four runtime platforms, with an `• emit-only` annotation to signal it has no install/refresh-hook story.
- Refresh-hook consent UI and per-platform install/uninstall reconcile-nudges correctly skip `agents-md`.
- New `Target` enum exposed from gui-shared (5-value), distinct from `Platform` (4-value, runtime-only). Parity tests (`target.parity.test.ts` for the schema; `scan-bundle.test.ts` regression for the bundle parser) read `src/core/types.ts` directly and assert the GUI-side enums match, so the next render target won't drift silently.
- Knowledge modals — the **Refresh all** and **Remove source** flows used the destructive typed-token modal (red border, "Destroy" button, type-the-agent-name-to-confirm gate), which mismatched the action: refreshing is non-destructive and removing only edits the manifest (cached files stay on disk, source can be re-added). Both now use a regular `ConfirmModal` with action-shaped labels (`Refresh all`, `Remove`). The typed-token modal is reserved for actually destructive ops (`smith jack-out`, catalog unregister).

## [1.1.0] — 2026-06-01

Knowledge compiler, AGENTS.md target, MCP retrieval server, and a richer GUI knowledge surface.

### Added

- **Knowledge compiler (v2).** Bundles can deliver large knowledge corpora via progressive disclosure: a tight TOC stanza in the rendered prompt + sidecar files on disk + an optional local BM25-over-MCP retrieval server. New `compile: { progressive, tocMaxLines, emitAgentsMd }` block on bundles; per-source `summary` / `toc` / `retrieval` fields. v1 bundles render byte-identically when they don't opt in.
- **Smart-default compile (v2.1).** Bundles auto-compile when their materialized content exceeds `inlineBudget` (default 8k tokens). Small corpora stay v1-inline; large corpora avoid silent truncation. Explicit `compile.progressive` true/false overrides; explicit `delivery: "inline"` on a source pins v1 mode.
- **`agents-md` install target.** First-class target emitting an `AGENTS.md` file consumable by Cursor, Windsurf, Copilot, Aider, Devin, Junie, Roo, Zed, Warp, Codex CLI, Gemini CLI, and other AGENTS.md-aware tools. When both `claude-code` and `agents-md` are targeted, Claude Code emits a one-line `See AGENTS.md.` pointer to avoid duplication.
- **`smith knowledge compile [--all]`** — force-compile an agent's knowledge.
- **`smith knowledge serve <agent> --stdio`** — boot an in-memory BM25 retrieval server exposing `knowledge.search` and `knowledge.fetch` over MCP.
- **`smith agent init --from-apm <path>`** — one-way Microsoft APM bundle import.
- **Per-agent MCP emission per platform.** Bundles declaring `mcpServers: string[]` now translate idiomatically: Claude Code emits frontmatter subset scoping (opt out via `targetOptions.claudeCode.scopeMcpServers: false`); Kiro emits `mcpServers: {}` + `includeMcpJson: true` + `tools` / `allowedTools` with `@<server>` entries; Codex emits an `<bundle>/agents/openai.yaml` sidecar with `dependencies.tools[]`; OpenCode keeps default inherit-all.
- **GUI per-source knowledge editor.** New modal exposes every v1+v2 field per source (delivery, retrieval, summary, TOC, materialize, extractor, refresh, optional, `inlineBudgetTokens`). Server re-validates the whole knowledge block on save.
- **GUI MCP wiring toggle.** Single click writes/removes the `agent-smith-knowledge` server from the bundle's `mcpServers` and from the AI client's MCP config (Claude Code, OpenCode, Codex, Kiro), then runs `agent install` — no terminal commands required.
- **GUI tooltip system.** Generic `Tooltip` + `FieldHelp` primitives + canonical-id help registry, adopted in the knowledge modals plus 14 high-impact fields across agent editor, model config, refresh consent, catalog register form, install matrix, daemon controls, and permissions view.
- **Doctor `mcp-spawn-commands` section + `smith doctor --fix-mcp-commands`.** Audits MCP configs for non-absolute `command` entries that fail to spawn under stripped-PATH contexts (Spotlight/dock-launched GUIs); the fix flag rewrites them to absolute paths.
- **Doctor `knowledge-compile` section.** Detects drift between an agent's declared knowledge and its `compile-manifest.json`; `smith doctor --fix-knowledge-compile` re-runs the compile.

### Changed

- **Doctor `knowledge-compile` audits any agent with a manifest on disk** (was: only bundles with explicit `compile.progressive: true`). Catches drift on auto-compiled bundles, opt-out flips, and trimmed corpora that no longer need compiling.
- **`smith knowledge compile <agent>`** no longer errors on bundles without an opt-in flag — it now means "force compile this", which is what the user explicitly asked for.
- **`~/.local/bin/smith` launcher** is now a small bash wrapper that hardcodes bun's absolute path (was: a symlink to a `#!/usr/bin/env bun` script that failed under Spotlight/dock launches and MCP-spawn contexts where `env` cannot find `bun`). Re-rewritten on every fresh install and every `smith update` so a moved bun is picked up.
- **`agent init --from <bundle>`** now passes through the source's `knowledge` block (was: silently dropped during merge).
- **Per-agent refresh state** moved from `<stateHome>/agents/<name>/refresh-manifest.json` to `<stateHome>/refresh/<name>/refresh-manifest.json` so the synthetic self-source no longer creates phantom bundle dirs that doctor misclassified as aborted-init leftovers.

### Fixed

- OpenCode resolver no longer suggests `opencode auth login` when OpenCode is not installed at all — it throws `PlatformUnavailableError` (orchestrator silently drops the target, matching Kiro/Claude/Codex semantics) or, with `--allow-missing-cli`, returns the curated tier literal plus a "not installed" warning.
- MCP knowledge server treats id-less requests as notifications (no reply), unblocking Kiro CLI's tool-listing handshake which previously stopped at "running, 0 tools" because the server replied with an error to `notifications/initialized`.
- MCP knowledge server advertises `capabilities.tools.listChanged: false` so Kiro CLI issues the `tools/list` call (was: bare `{ tools: {} }`, which Kiro interpreted as "no tools").
- GUI MCP toggle writes the absolute `smith` path so Spotlight/dock-launched AI clients can spawn the MCP server on stripped PATH.
- GUI per-source editor honors type-validity rules (refresh modes, extractor field eligibility) so invalid combinations can't be saved.
- Compiled `## Knowledge` TOC names the knowledge root and points multi-file sources at the directory (with file count) instead of the first file alone.
- Shared `KnowledgeSource` schema now accepts the v2 `summary` / `toc` / `retrieval` fields, fixing a regression where edited sources "disappeared" from the GUI right after a save.
- GUI is no longer blind to the synthetic self-source on per-agent routes that resolve by registry walk.
- `agent.config.json` validation reasons surface in CLI output instead of being collapsed into a one-line headline (registry-walking commands).
- ARCHITECTURE.md mermaid diagrams now render cleanly (two flowchart/sequence-diagram parser issues fixed).
- Flaky watcher (FSEvents kernel batching) and heavy git-spawn tests stabilized with realistic timeouts.

### Documentation

- New spoke: `guide/16-knowledge-compiler.md`.
- ARCHITECTURE.md refreshed for v2/v2.1 with three new sections (compile internals, AGENTS.md target deep-dive, APM import) and four new mermaid diagrams (data flow, compile inputs/outputs, knowledge loading pipeline, retrieval-server lifecycle).
- Updates across guide/02 (bundle anatomy), guide/04 (knowledge), guide/10 (doctor), guide/14 (CLI reference), guide/15 (sharing), CHEATSHEET, GUIDE, and README.

## [1.0.0] — 2026-05-29

Initial public release. `agent-smith` is a lifecycle manager for AI coding agents:
author once as a four-file bundle, validate against a strict schema, and install
into OpenCode, Claude Code, Codex, and Kiro.

### Features

- `smith` CLI: scaffold, validate, install, update, and uninstall agent bundles across OpenCode, Claude Code, Codex, and Kiro.
- Companion agent `agent-smith` with the eight-question authoring workflow (`the-architect` skill) and a skill-authoring workflow (`the-keymaker` skill).
- Skill lifecycle management: `smith skill {register, install, update, uninstall, sync, validate, bootstrap}`, with recursive skill-catalog discovery.
- Multi-bundle install from a git URL: `smith {skill,agent} install --from <url>` discovers every bundle in a repo, lets you pick one or more (and which platform targets), and installs them together — same experience in the CLI (interactive picker) and the GUI (two-step modal). Flags: `--all`, `--skills`/`--agents`, `--git-ref`, `--json`.
- Per-agent knowledge sources: files, directories, globs, URLs, git repos, Confluence pages, and Jira issues, with per-platform refresh hooks (including Kiro).
- Catalog system with three kinds for agents (`user-global`, `project`, `registered`) and three for skills (`user-global`, `user-local`, `team-shared`).
- Manifest-based ownership tracking via `installed-agents.json` and `installed-skills.json` (idempotent reinstall, hash-mismatch refusal on uninstall).
- Optional background daemon for catalog sync and TTL-mode knowledge refresh.
- Health-check command (`smith doctor`) with an actionable-only default view (full detail under `--verbose`): platform schema-drift detection, model-resolution readiness, installed-skill and installed-agent drift checks, registry hygiene, knowledge-refresh integrity, and relevance-gated Atlassian credential checks.
- Browser GUI (`smith gui`) wrapping every CLI surface with persistent job history.
- Four bundled example agents: `incident-debugger`, `security-threat-modeler`, `repo-cartographer`, and `knowledge-demo`.

[1.3.0]: https://github.com/eliharoun/agent-smith/releases/tag/v1.3.0
[1.2.0]: https://github.com/eliharoun/agent-smith/releases/tag/v1.2.0
[1.1.1]: https://github.com/eliharoun/agent-smith/releases/tag/v1.1.1
[1.1.0]: https://github.com/eliharoun/agent-smith/releases/tag/v1.1.0
[1.0.0]: https://github.com/eliharoun/agent-smith/releases/tag/v1.0.0
