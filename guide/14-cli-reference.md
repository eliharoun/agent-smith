# CLI reference

> The canonical manual for every `smith` subcommand. Each entry lists
> the synopsis, arguments, flags, exit codes, and one or two short
> examples — no narrative. For mental models, walkthroughs, and
> caveats, follow the **See also** links to the topic spokes.

Every command is registered in `src/index.ts`. The exit-code constants
(`EXIT_OK`/`EXIT_RUNTIME`/`EXIT_USAGE`/`EXIT_PARTIAL` = `0`/`1`/`2`/`3`)
live in `src/cli/exit-codes.ts`. Errors thrown as `SmithError` propagate
through the `wrap()` shim in `src/cli/wrap.ts`, which renders them in the
`✗ smith <subcommand>: <headline>` format and maps the error code to the
exit-code taxonomy via `exitCodeFor()` (see
[Error handling](./12-error-handling.md)).

Two paths in `src/index.ts` bypass `wrap()`:

- Commander's own usage errors (unknown command, missing required option,
  malformed flag) exit `2` after the catch block formats them.
- `--help` and `--version` exit `0` from the same catch block.

A handful of commands print a green success message via `console.log`
even when their inner function returned `0` already; this is harmless
duplication and surfaces only in tests, not user-visible output.

---

## Command index

| Command | Summary | Spoke |
|---|---|---|
| [`agent catalogs`](#smith-agent-catalogs) | List registered agent catalogs (sources) | [08](./08-registries-and-catalogs.md) |
| [`agent catalog rename <old> <new>`](#smith-agent-catalog-rename-old-new) | Rename an agent catalog label | [08](./08-registries-and-catalogs.md) |
| [`agent destroy <name>`](#smith-agent-destroy-name) | Inverse of `agent init`: remove a user-global source bundle from `~/.config/agent-smith/agents/` | [11](./11-update-and-uninstall.md) |
| [`agent init <name>`](#smith-agent-init-name) | Scaffold a new agent bundle (optionally `--from` an existing one, optionally `--catalog` into a registered catalog) | [01](./01-getting-started.md) |
| [`agent install <name>`](#smith-agent-install-name) | Build and render an agent to its targets | [03](./03-installing-and-rendering.md) |
| [`agent install-all`](#smith-agent-install-all) | Build and render every known agent | [03](./03-installing-and-rendering.md) |
| [`agent list`](#smith-agent-list) | List every agent discovered across registered catalogs | [08](./08-registries-and-catalogs.md) |
| [`agent reconfigure <name>`](#smith-agent-reconfigure-name) | Grant or revoke per-platform knowledge-refresh consent on an installed agent | [04](./04-knowledge.md) |
| [`agent register <path>`](#smith-agent-register-path) | Register a directory as an agent catalog | [08](./08-registries-and-catalogs.md) |
| [`agent uninstall <name>`](#smith-agent-uninstall-name) | Remove an installed agent from every target it was installed to | [11](./11-update-and-uninstall.md) |
| [`agent uninstall-all`](#smith-agent-uninstall-all) | Remove every registered agent from every target | [11](./11-update-and-uninstall.md) |
| [`agent unregister <path-or-label>`](#smith-agent-unregister-path-or-label) | Remove a registered agent catalog | [08](./08-registries-and-catalogs.md) |
| [`agent validate [name]`](#smith-agent-validate-name) | Validate one or all agent bundles | [02](./02-bundle-anatomy.md) |
| [`config get [key]`](#smith-config-get-key) | Read a model-resolution config value (or full overview) | [07](./07-models.md) |
| [`config set <key> <value>`](#smith-config-set-key-value) | Write a model-resolution config value | [07](./07-models.md) |
| [`config unset <key>`](#smith-config-unset-key) | Remove a model-resolution config value (revert to auto-detection) | [07](./07-models.md) |
| [`daemon run`](#smith-daemon-run) | Run the daemon in foreground (internal; used by `daemon start`) | [09](./09-daemon.md) |
| [`daemon start`](#smith-daemon-start) | Start the background watcher detached, verifying via heartbeat poll | [09](./09-daemon.md) |
| [`daemon status`](#smith-daemon-status) | Report whether the daemon is running, stale, or absent | [09](./09-daemon.md) |
| [`daemon stop`](#smith-daemon-stop) | Stop the daemon (SIGTERM with SIGKILL fallback) | [09](./09-daemon.md) |
| [`doctor`](#smith-doctor) | Run the 12-section health check across schemas, skills, models, registry, remote catalogs, and duplicate detection | [10](./10-doctor.md) |
| [`gui`](#smith-gui) | Launch the smith browser GUI | — |
| [`init`](#smith-init) | Initialize `~/.config/agent-smith` (idempotent) | [01](./01-getting-started.md) |
| [`init-user`](#smith-init-user) | Open `USER.md` in `$EDITOR` | [01](./01-getting-started.md) |
| [`jack-out`](#smith-jack-out) | Full offboarding: uninstall everything and remove `~/.config/agent-smith` | [11](./11-update-and-uninstall.md) |
| [`knowledge add`](#smith-knowledge-add-agent-type-or-url-path-or-url) | Add a knowledge source to an agent's config | [04](./04-knowledge.md) |
| [`knowledge compile`](#smith-knowledge-compile-name) | Compile a bundle's knowledge sources into a TOC stanza + manifest (v2) | [16](./16-knowledge-compiler.md) |
| [`knowledge fetch`](#smith-knowledge-fetch-agent) | Re-acquire knowledge sources for an agent and re-install | [04](./04-knowledge.md) |
| [`knowledge migrate-codex`](#smith-knowledge-migrate-codex) | Take ownership of a pre-existing `~/.codex/hooks.json` (upgrade helper) | [04](./04-knowledge.md) |
| [`knowledge refresh-session`](#smith-knowledge-refresh-session) | Refresh session-mode sources for installed agents (soft-fail; for hook use) | [04](./04-knowledge.md) |
| [`knowledge list`](#smith-knowledge-list-agent) | Show installed knowledge for an agent (from the manifest) | [04](./04-knowledge.md) |
| [`knowledge remove`](#smith-knowledge-remove-agent-source-id) | Remove a knowledge source from an agent's bundle | [04](./04-knowledge.md) |
| [`knowledge serve`](#smith-knowledge-serve-name) | Serve an agent's knowledge over MCP (BM25 search + fetch, stdio) | [16](./16-knowledge-compiler.md) |
| [`knowledge validate`](#smith-knowledge-validate-agent) | Lint knowledge blocks for one or all agents | [04](./04-knowledge.md) |
| [`migrate-clones`](#smith-migrate-clones) | Migrate rc.1 external-repo clones from config to state dir | [13](./13-paths-and-state.md) |
| [`skill bootstrap`](#smith-skill-bootstrap) | Install the bundled `the-architect` and `the-keymaker` skills to all platforms | [01](./01-getting-started.md) |
| [`skill catalogs`](#smith-skill-catalogs) | List registered skill catalogs (including protected/adhoc) | [05](./05-skills.md) |
| [`skill catalog rename <old> <new>`](#smith-skill-catalog-rename-old-new) | Rename a skill catalog label | [05](./05-skills.md) |
| [`skill install`](#smith-skill-install-ref) | Install a skill from a catalog ref or `--from <path>` | [05](./05-skills.md) |
| [`skill list`](#smith-skill-list) | List skills discovered across registered (non-adhoc) catalogs | [05](./05-skills.md) |
| [`skill register <path>`](#smith-skill-register-path) | Register a directory as a skill catalog | [05](./05-skills.md) |
| [`skill uninstall <name>`](#smith-skill-uninstall-name) | Remove an installed skill from all platforms | [05](./05-skills.md) |
| [`skill unregister <path-or-label>`](#smith-skill-unregister-path-or-label) | Remove a registered skill catalog | [05](./05-skills.md) |
| [`skill update [name]`](#smith-skill-update-name) | Re-copy installed skill(s) from their source catalogs | [05](./05-skills.md) |
| [`skill validate <name>`](#smith-skill-validate-name) | Validate a registered skill's frontmatter | [05](./05-skills.md) |
| [`status`](#smith-status) | Print registry locations and registered catalog summary | [08](./08-registries-and-catalogs.md) |
| [`update`](#smith-update) | Pull latest agent-smith from `origin/main`, install deps, run doctor | [11](./11-update-and-uninstall.md) |

---

## Setup

### `smith init`

**Synopsis:** `smith init`

**Description:** Initialize the agent-smith state root (`$XDG_CONFIG_HOME/agent-smith`, defaulting to `~/.config/agent-smith` when `XDG_CONFIG_HOME` is unset) by creating
`agents/`, writing `registry.json` (round-tripped through `loadRegistry`/
`saveRegistry` so an empty `{ schemaVersion: 2, sources: [...] }` document is
persisted via `atomicWriteJson` — temp file + rename), and seeding
`USER.md` with a stub if it does not already exist. Idempotent —
re-running over a seeded directory leaves all existing files untouched.
The installer (`bash bin/install`) calls this automatically as Step 8b
on every install. Manual invocation is only needed for recovery from a
corrupt or version-skewed registry. Source: `src/cli/commands/init.ts`.

**Arguments:** none.

**Flags:** none.

**Exit codes:**

- `0` — initialized (or already initialized).
- `1` — filesystem error (mkdir/write failure).

**Examples:**

```bash
$ smith init
Initialized agent-smith at /Users/you/.config/agent-smith
```

**See also:** [Getting started](./01-getting-started.md), [Paths and state](./13-paths-and-state.md).

---

### `smith init-user`

**Synopsis:** `smith init-user`

**Description:** Spawn `$EDITOR` (default `vi`) on `USER.md` at the
canonical path. Inherits stdio so the editor takes over the terminal.
**Self-bootstraps a missing manifest** — if `~/.config/agent-smith/USER.md`
doesn't exist (rare, since the installer's Step 8b runs `smith init`),
the command creates the parent directory and seeds the canonical
"About me" template before opening `$EDITOR`. If `$EDITOR` is set to
a binary that isn't on `PATH`, surfaces a `usage-error` with a
`suggestedCommand` to set `EDITOR`. Source:
`src/cli/commands/init-user.ts`.

**Arguments:** none.

**Flags:** none.

**Exit codes:**

- `0` — editor exited cleanly.
- `1` — editor exited non-zero.
- `2` — `$EDITOR` not found on `PATH`.

**Examples:**

```bash
$ EDITOR=nvim smith init-user
```

**See also:** [Getting started](./01-getting-started.md), [Paths and state](./13-paths-and-state.md).

---

### `smith migrate-clones`

**Synopsis:** `smith migrate-clones [--dry-run]`

**Description:** One-shot helper for users upgrading from rc.1. Through
rc.1, external-repo clones (created by `smith agent install --from <url>`
and `smith skill install --from <url>`) lived under
`$XDG_CONFIG_HOME/agent-smith/remote/`. rc.2 moved managed clones to
`$XDG_STATE_HOME/agent-smith/remote/` to comply with the
[XDG Base Directory specification](https://specifications.freedesktop.org/basedir-spec/)
— `state` is machine-generated working data, distinct from `config`.
Existing rc.1 clones were intentionally left in place (the rc.2 release
notes documented this as a known limitation), still functional via
their stale `rootPath` registry entries.

`smith migrate-clones` walks both `registry.json` and
`skill-catalogs.json`, finds entries whose `rootPath` is under the
rc.1 location, validates each clone (must have `.git/`, must have an
`origin` URL that matches the recorded `remote.url` or legacy
`gitRemote`), moves the directory to the rc.2+ location, and updates
the registry entry's `rootPath` to point at the new path. Both
agent catalogs and skill catalogs are migrated in a single sweep.

Per-entry safety guards (any failure skips the entry, leaves the
registry unchanged for that entry, and continues with the rest):

- entry must have a recoverable URL (`remote.url` or `gitRemote`)
- `.git/` must exist at the clone path
- `git remote get-url origin` must match the recorded URL (modulo
  scheme, case, and trailing `.git` — same canonical equality used
  by the install pipeline's duplicate-URL guard)
- target path under the new root must NOT already exist (a manual
  re-install via `--from` would have created one — resolve manually
  before re-running migrate-clones)

Source: `src/cli/commands/migrate-clones.ts`.

**Arguments:** none.

**Flags:**

- `--dry-run` — classify each entry without moving files or updating
  the registry. Output format identical to a real run; use to audit
  before committing.

**Exit codes:**

- `0` — all entries processed (including skips). `migrate-clones` is
  best-effort per-entry — partial migrations don't abort.
- `1` — registry IO failure (read, write, or atomic rename).

**Examples:**

```bash
$ smith migrate-clones --dry-run
✓ would migrate agent 'foo-bar'
    from: /Users/you/.config/agent-smith/remote/github.com/foo/bar
    to:   /Users/you/.local/state/agent-smith/remote/github.com/foo/bar

would migrate: 1    would skip: 0    already-rc.2: 3

$ smith migrate-clones
✓ migrated agent 'foo-bar'
    from: /Users/you/.config/agent-smith/remote/github.com/foo/bar
    to:   /Users/you/.local/state/agent-smith/remote/github.com/foo/bar

migrated: 1    skipped: 0    already-rc.2: 3
```

`smith status` surfaces a one-line nudge when rc.1 clones are detected
in the registry — point of discoverability for users who didn't read
the rc.3 release notes.

**See also:** [Paths and state](./13-paths-and-state.md), [Registries and catalogs](./08-registries-and-catalogs.md).

---

### `smith agent init <name>`

**Synopsis:** `smith agent init <name> [--description <text>] [--targets <list>] [--model-tier <tier>] [--mode <mode>] [--permission <preset>] [--permission-json <json>] [--mcp-servers <list>] [--skills <list>] [--requires-skills <list>] [--from <source>] [--from-apm <path>] [--catalog <label-or-path>]`

**Description:** Scaffold a new agent bundle. By default lands under
`~/.config/agent-smith/agents/<name>/` (the `user-global` catalog); use
`--catalog` to scaffold directly into any registered agent catalog
instead (see flag below). With `--from`, clones an
existing bundle's config and persona files (resolves `--from` against
`agentsDir` first, then falls back to the bundled `examples/` directory
— local copies always win on collision). Without `--from`, writes
intentionally-failing TODO stub persona files so the next
`smith agent validate` flags them. USER.md handling is kind-aware —
symlink for personal catalogs (`user-global`, `project`), stub file for
`registered` catalogs; see [Bundle anatomy — USER.md and catalog kind](./02-bundle-anatomy.md#usermd-and-catalog-kind).
Source: `src/cli/commands/init-agent.ts` and `src/cli/commands/agent/register-commands.ts`.

**Arguments:**

- `<name>` — required. Kebab-case agent name; validated by the config
  schema before any files are written.

**Flags:**

- `--description <text>` — one-line description; required unless inherited
  via `--from`.
- `--targets <list>` — comma-separated subset of
  `opencode,claude-code,codex,kiro`; default `opencode,claude-code,codex,kiro`.
- `--model-tier <tier>` — one of `balanced|fast|high|inherit` (legacy
  aliases: `opus`, `sonnet`, `haiku`); default `balanced`. See
  [Models](./07-models.md) for the full resolution pipeline.
- `--mode <mode>` — one of `primary|subagent|all`; default unset
  (assembler picks per-platform default).
- `--permission <preset>` — one of `read-only|read-edit|full`. Rejected
  with a `usage-error` listing valid presets if unknown.
- `--permission-json <json>` — raw JSON `PermissionConfig`; overrides
  `--permission` when both are present. Parse failures raise
  `usage-error`.
- `--mcp-servers <list>` — comma-separated MCP server names.
- `--skills <list>` — comma-separated skill names baked into the
  per-platform persona.
- `--requires-skills <list>` — comma-separated skill refs. Each entry is
  either `<name>` or `<catalog>/<name>`. Empty entries are dropped.
- `--from <source>` — clone an existing bundle by name. Resolved against
  the user's agents dir first, then `examples/`. Mutually exclusive with
  `--from-apm`.
- `--from-apm <path>` — import a Microsoft APM (`microsoft/apm`) `apm.yml`
  file as the starting point. Maps APM `runtimes` to smith `targets`
  (claude-code/opencode/codex/kiro pass through 1:1; copilot/cursor/gemini/
  windsurf collapse into `agents-md`; unknown runtimes silently dropped),
  converts `references[]` into knowledge sources, and forces
  `compile.progressive: true` + `compile.emitAgentsMd: true` on the
  imported bundle. `mcp:` references are dropped (configure them
  separately in `mcpServers`). One-way; smith → APM export is out of
  scope. Mutually exclusive with `--from`. See
  [Knowledge compiler — APM import](./16-knowledge-compiler.md#apm-import-smith-agent-init---from-apm).
- `--catalog <label-or-path>` — scaffold into a registered agent catalog
  instead of the default user-global catalog. Accepts a catalog label
  (e.g. `team-agents`) or an absolute path; values containing a `/` are
  treated as paths (resolved to absolute), otherwise as labels. The
  catalog must already be registered via `smith agent register` —
  unregistered values are refused with a `not-found` SmithError that
  suggests `smith agent catalogs`. See
  [Bundle anatomy — USER.md and catalog kind](./02-bundle-anatomy.md#usermd-and-catalog-kind)
  for USER.md handling.

**Exit codes:**

- `0` — bundle created.
- `1` — source not found.
- `2` — agent already exists (`already-exists`); `--catalog` value did
  not match any registered catalog (`not-found`); source config invalid;
  merged config invalid; missing `--description`; invalid `--permission`
  value or malformed `--permission-json`.

**Examples:**

```bash
$ smith agent init my-agent --description "Reviews pull requests" \
    --model-tier balanced --permission read-edit
$ smith agent init my-agent --from the-architect --description "Variant A"
$ smith agent init code-reviewer --catalog team-agents \
    --description "Reviews PRs against team conventions"
# → bundle created at <team-agents rootPath>/code-reviewer with a stub USER.md
$ smith agent init my-agent --from-apm ./apm.yml
# → smith bundle from a Microsoft APM apm.yml; compile.progressive=true,
#   emitAgentsMd=true, persona stubs that you'll need to edit
```

**See also:** [Getting started](./01-getting-started.md#agent-init-flags), [Bundle anatomy](./02-bundle-anatomy.md), [Permissions and platforms](./06-permissions-and-platforms.md), [Models](./07-models.md).

---

### `smith agent reconfigure <name>`

**Synopsis:** `smith agent reconfigure <name> [--grant <platform>...] [--revoke <platform>...] [--yes]`

**Description:** Update per-platform knowledge-refresh consent on an
already-installed agent. Use this when:

- you installed the agent before the consent flow shipped (pre-0.15) and
  want to opt it into session-mode refresh; or
- you added a new install target after the fact and want refresh to fire
  on that platform too; or
- you want to opt one platform back out without uninstalling the agent.

The command writes/updates
`~/.config/agent-smith/agents/<name>/refresh-manifest.json` and
installs (on grant) or removes (on revoke) the corresponding
session_start hook for each platform — the Claude Code
`hooks.SessionStart` block in the installed agent file, the codex entry
in `~/.codex/hooks.json` (under the `_smith_managed` sentinel), or the
opencode `agent-smith-refresh` plugin registration. Re-granting an
already-granted platform (or revoking an already-revoked one) is a
no-op. Multiple `--grant`/`--revoke` flags may be combined in a single
invocation. Source: `src/cli/commands/agent/reconfigure.ts`.

**Arguments:**

- `<name>` — agent name. Must be an already-installed agent.

**Flags:**

- `--grant <platform>` — grant refresh consent for the named platform.
  Repeatable. One of `opencode`, `claude-code`, `codex`, `kiro`. Platform must
  be a target of the installed agent.
- `--revoke <platform>` — revoke refresh consent for the named platform.
  Repeatable. Same accepted values as `--grant`.
- `--yes` — grant refresh hooks for every platform the agent is installed
  for (non-interactive). Mutually exclusive with `--grant`/`--revoke`.

**Exit codes:**

- `0` — manifest + hooks updated (or no-op).
- `2` — unknown agent; unknown platform value; agent is not installed on
  a requested platform (`validation-failed`).
- Other — standard SmithError → exit-code mapping.

**Examples:**

```bash
# Add opencode refresh to an agent that only had claude-code consent
$ smith agent reconfigure my-agent --grant opencode

# Stop refreshing on claude-code (e.g. moving to manual refresh there)
$ smith agent reconfigure my-agent --revoke claude-code

# Combine: grant codex, revoke opencode in one shot
$ smith agent reconfigure my-agent --grant codex --revoke opencode
```

**See also:** [Knowledge — Consent and the refresh manifest](./04-knowledge.md#consent-and-the-refresh-manifest), [`smith doctor --fix-knowledge-refresh`](#smith-doctor).

---

## Agent registry

### `smith agent register <path>`

**Synopsis:** `smith agent register <path> --kind <kind> [--label <label>] [--git-remote <url>] [--allow-empty] [--skip-git-check]`

**Description:** Register an agent catalog directory. Sniffs the path:
if it contains zero `agent.config.json` files but at least one
`SKILL.md`, refuses with a `validation-failed` error and a suggested
`smith skill register` command. Empty directories also refuse unless
`--allow-empty` is set. When `--git-remote` is supplied, runs
`git remote -v` against the directory and verifies the URL matches one
of the remotes (bypass with `--skip-git-check`). On success, appends a
new source to `registry.json`. Source: `src/cli/commands/register.ts`.

**Arguments:**

- `<path>` — directory to register. Resolved to an absolute path.

**Flags:**

- `--kind <kind>` — required. One of `user-global|project|registered`.
- `--label <label>` — display label. Default `<kind>:<absPath>`.
- `--git-remote <url>` — git remote URL for `kind=registered`. When the
  URL matches a catalog already in either registry, smith prints a
  one-line warning (does NOT refuse — duplicate links are sometimes
  legitimate, e.g. one managed clone for daemon-pull plus a linked
  checkout for editing; v1-task RC2-5). Use `smith doctor`
  (`duplicate-catalogs` section) to audit the resulting clusters.
- `--allow-empty` — register even if no agent bundles are present.
- `--skip-git-check` — bypass git-repo and remote-URL validation.

**Exit codes:**

- `0` — registered.
- `1` — registry write failure.
- `2` — path missing, looks like a skill catalog, empty without
  `--allow-empty`, not a git repo (when `--git-remote` set), or
  `--git-remote` does not match (`validation-failed`).

**Examples:**

```bash
$ smith agent register ~/work/agents --kind user-global
$ smith agent register ./team-agents --kind registered \
    --git-remote git@github.com:acme/team-agents.git
```

**See also:** [Registries and catalogs](./08-registries-and-catalogs.md); [Sharing and distribution](./15-sharing-and-distribution.md) for the end-to-end publisher + consumer flow.

---

### `smith agent unregister <path-or-label>`

**Synopsis:** `smith agent unregister [--purge-clone] <path-or-label>`

**Description:** Remove a registered agent catalog. The argument is
treated as a label first; if no label matches, smith falls back to a
path lookup. Path-shaped inputs (absolute, `./` / `../` prefixed, or
containing a `/`) are normalized via `resolve()` so that
`register <path>` and `unregister <path>` round-trip regardless of
relative vs absolute spelling. Symmetric with
`smith skill unregister <path-or-label>`. Source:
`src/cli/commands/unregister.ts`.

**Arguments:**

- `<path-or-label>` — catalog label OR catalog path used at registration.

**Flags:**

- `--purge-clone` — also `rm -rf` the on-disk clone after unregistering
  (v1-task C3.13). Layered safety guard (v1-task RC2-9): refused unless
  **all four** hold — catalog mode is `managed` (its `remote` block is
  present), `rootPath` is contained under `<stateHome>/remote/`
  (typically `~/.local/state/agent-smith/remote/`), the target contains
  a `.git/` directory, and `git remote get-url origin` matches the
  registered `remote.url` (modulo URL normalization). The error message
  names the exact guard that tripped. The guards exist so a corrupted
  registry, a moved clone, or a re-targeted git remote can never lead
  to `rm -rf` of a hand-cloned working tree. Use this when you want to
  fully retire a catalog that was installed via `agent install --from
  <url>` and no longer need its bundles on disk.

**Exit codes:**

- `0` — removed.
- `1` — no source matches the input, OR registry write failure
  (`not-found`).
- `2` — `--purge-clone` passed on a catalog whose `rootPath` is not
  under `<stateHome>/remote/` (`usage-error`); hint points at the
  safety rationale.

**Examples:**

```bash
$ smith agent unregister team-agents          # by label
$ smith agent unregister ~/work/agents        # by path (resolved)
$ smith agent unregister acme/team-agents --purge-clone
                                              # remove + delete the clone
```

**See also:** [`smith agent sync`](#smith-agent-sync-name),
[Registries and catalogs](./08-registries-and-catalogs.md),
[Sharing & distribution § 9](./15-sharing-and-distribution.md#9-sharing-via-direct-url).

---

### `smith agent list`

**Synopsis:** `smith agent list`

**Description:** List every agent discovered across all registered
catalogs. Each line shows `<name> (<source-kind>) → <comma-separated targets>`.
Empty registry prints `(no agents found in any catalog)`. Source:
`src/cli/commands/list.ts`.

**Arguments:** none.

**Flags:** none.

**Exit codes:**

- `0` — listed (including the empty case).
- `1` — registry read failure or per-catalog discovery failure.

**Examples:**

```bash
$ smith agent list
the-architect (user-global) → opencode, claude-code, codex, kiro
my-agent      (user-global) → opencode
```

**See also:** [Registries and catalogs](./08-registries-and-catalogs.md).

---

### `smith agent catalogs`

**Synopsis:** `smith agent catalogs`

Lists every registered agent catalog (source). Mirrors `smith skill catalogs`. Each line shows:

```
<label> [<kind>] [<mode>] → <rootPath> [git: <remote-url>]
```

- `<kind>` is one of `user-global`, `project`, `registered`.
- `<mode>` (v1-task RC2-6) is a dim `[managed]` or `[linked]` badge:
  **managed** ⇒ smith-owned clone under `<stateHome>/remote/` (installed via
  `agent install --from <url>`; eligible for `sync` and `unregister --purge-clone`);
  **linked** ⇒ user-owned working copy (registered via `agent register`;
  smith never modifies the tree).
- `git: <remote-url>` appears only for catalogs cloned from a git remote.

Use this to audit which agent bundle directories `smith` discovers when running `smith agent list`, `smith agent install`, etc.

See also: [`smith agent register`](#smith-agent-register-path), [`smith agent unregister`](#smith-agent-unregister-path-or-label).

---

### `smith agent catalog rename <old> <new>`

**Synopsis:** `smith agent catalog rename <old-label> <new-label>`

**Description:** Rename an agent catalog's label in `registry.json`.
Source: `src/cli/commands/agent/catalog-rename.ts`.

**Arguments:**

- `<old-label>` — current catalog label.
- `<new-label>` — new catalog label.

**Flags:** none.

**Exit codes:**

- `0` — renamed.
- `1` — no catalog with `<old-label>` found (`not-found`).
- `2` — `<new-label>` already in use (`already-exists`).

**Examples:**

```bash
$ smith agent catalog rename team-agents acme-agents
```

**See also:** [Registries and catalogs](./08-registries-and-catalogs.md).

---

### `smith agent sync [name]`

**Synopsis:** `smith agent sync [--check] [--all] [name]`

**Description:** Pull updates from the upstream git remote for one or
all remote-backed agent catalogs (those whose `registry.json` entry
carries a `remote` block — typically catalogs cloned by
`smith agent install --from <url>`). Catalogs without a `remote` block
are ignored. v1-task C3.11. Source: `src/cli/commands/agent/sync.ts`.

Three modes:

- `sync <name>` — resolve `<name>` as a catalog label first, then as a
  rootPath; perform `git fetch` + hard reset to the configured ref;
  update `lastPulledSha`, `lastRemoteSha`, `lastPulledAt`, and
  `lastCheckedAt` in `registry.json`.
- `sync --check` — `git ls-remote` only. Updates `lastRemoteSha` and
  `lastCheckedAt`; does not touch the working tree or `lastPulledSha`.
  Use this as a cheap "anything to pull?" probe, then run
  `smith doctor` (which reports drift via the `remote-catalogs`
  section) to surface what needs syncing.
- `sync --all` — iterate every remote-backed catalog. Partial failure
  (some pulls succeed, some fail) exits `3` (`EXIT_PARTIAL`); the
  successful pulls still persist their updated SHAs.

**Arguments:**

- `[name]` — catalog label OR rootPath. Required unless `--all`.
  Mutually exclusive with `--all` (specifying both exits `2`).

**Flags:**

- `--all` — sync every remote-backed catalog.
- `--check` — probe only; no working-tree mutation.

**Exit codes:**

- `0` — all targeted pulls succeeded.
- `2` (`usage-error`) — neither `<name>` nor `--all` was given; or both
  were; or no remote-backed catalog matched `<name>`; or `--all`
  matched zero remote-backed catalogs.
- `1` (`EXIT_RUNTIME`) — every attempted pull failed (no successes).
- `3` (`EXIT_PARTIAL`) — at least one pull succeeded and at least one
  failed; per-catalog error lines go to stderr.

**Examples:**

```bash
$ smith agent sync acme/team-agents
smith: acme/team-agents synced to 3a1f9c0e

$ smith agent sync --all --check
smith: acme/team-agents → remote at 3a1f9c0e
smith: team/agents → remote at 7b2d11ff
```

**See also:** [`smith doctor`](#smith-doctor) (`remote-catalogs`
section reports drift offline),
[`smith agent install --from`](#smith-agent-install-name),
[Sharing & distribution § 9](./15-sharing-and-distribution.md#9-sharing-via-direct-url).

---

### `smith status`

**Synopsis:** `smith status`

**Description:** Print canonical state-file paths and a summary of
registered agent catalogs and skill catalogs. Each catalog row shows
`[<kind>] <rootPath> (<label>)` plus optional `[protected]`/`[adhoc]`
flags. Source: `src/cli/commands/status.ts`.

**Arguments:** none.

**Flags:** none.

**Exit codes:**

- `0` — printed.
- `1` — registry read failure.

**Examples:**

```bash
$ smith status
agent-smith status
Registry: /Users/you/.config/agent-smith/registry.json
USER.md:  /Users/you/.config/agent-smith/USER.md
Agent catalogs (1):
  - [user-global] /Users/you/.config/agent-smith/agents (user-global:/Users/you/.config/agent-smith/agents)
Skill catalogs (1):
  - [team-shared] (atlassian-skills) [protected] (not yet cloned)
```

**See also:** [Registries and catalogs](./08-registries-and-catalogs.md), [Paths and state](./13-paths-and-state.md).

---

## Skill catalogs

### `smith skill register <path>`

**Synopsis:** `smith skill register <path> --kind <kind> [--label <label>] [--git-remote <url>] [--allow-empty] [--skip-git-check]`

**Description:** Register a directory as a skill catalog. Commander's
`.choices()` restricts `--kind` to user-creatable values; the
`atlassian-skills` label is reserved and rejected at the CLI surface and again
programmatically as defense-in-depth (`src/cli/commands/skill/register.ts`).
Sniffs the path: if zero `SKILL.md` files but at least one
`agent.config.json`, refuses with a hint to use `smith agent register`. Empty
directories also refuse unless `--allow-empty` is set. Label collisions
raise `already-exists`. Source: `src/cli/commands/skill/register.ts`.

**Arguments:**

- `<path>` — directory to register.

**Flags:**

- `--kind <kind>` — required. One of `user-global|user-local|team-shared`.
- `--label <label>` — display label. Default `<kind>:<absPath>`.
- `--git-remote <url>` — git remote URL. Same duplicate-warn behavior
  as `agent register --git-remote` (v1-task RC2-5): prints a one-line
  warning when the URL already matches a catalog in either registry;
  never refuses.
- `--allow-empty` — register even if no `SKILL.md` directories are present.
- `--skip-git-check` — bypass git-repo and remote-URL validation.

**Exit codes:**

- `0` — registered.
- `2` — label collision (`already-exists`); path missing, looks like an
  agent catalog, empty without `--allow-empty`, reserved kind, not a git
  repo, or `--git-remote` mismatch.

**Examples:**

```bash
$ smith skill register ~/skills/team --kind team-shared --label team
```

**See also:** [Skills](./05-skills.md); [Sharing and distribution](./15-sharing-and-distribution.md) for the end-to-end skill-sharing flow.

---

### `smith skill unregister <path-or-label>`

**Synopsis:** `smith skill unregister [--purge-clone] <path-or-label>`

**Description:** Remove a registered skill catalog. Input shaped like a
path (starts with `/`, `.`, or contains `/`) is resolved and looked up
by `rootPath`; everything else is treated as a label. The
`atlassian-skills` catalog and any other `protected` catalogs are
refused by `removeCatalog()`. The command does **not** check for
installed skills sourced from the catalog — removing a catalog whose
skills are still installed leaves them as `source-missing` drift in
`installed-skills.json`. Source: `src/cli/commands/skill/unregister.ts`.

**Arguments:**

- `<path-or-label>` — catalog path (resolved) or label.

**Flags:**

- `--purge-clone` — also `rm -rf` the on-disk clone after unregistering
  (v1-task C3.13). Same layered safety guard as `agent unregister
  --purge-clone` (v1-task RC2-9): refused unless catalog mode is
  `managed`, `rootPath` is under `<stateHome>/remote/`, the target
  contains `.git/`, and `git remote get-url origin` matches the
  registered `remote.url`. Use this when retiring a catalog installed
  via `skill install --from <url>`.

**Exit codes:**

- `0` — removed.
- `1` — no catalog matches the path or label (`not-found`); registry write
  failure; or refusal of a `protected` catalog.
- `2` — `--purge-clone` passed on a catalog whose `rootPath` is not
  under `<stateHome>/remote/` (`usage-error`).

**Examples:**

```bash
$ smith skill unregister team
$ smith skill unregister ~/skills/team
$ smith skill unregister acme/team-skills --purge-clone
```

**See also:** [`smith skill sync`](#smith-skill-sync-name), [Skills](./05-skills.md).

---

### `smith skill sync [name]`

**Synopsis:** `smith skill sync [--check] [--all] [name]`

**Description:** Pull updates from the upstream git remote for one or
all remote-backed skill catalogs. Mirror of
[`smith agent sync`](#smith-agent-sync-name) — same semantics, same
flags, same exit codes — operating on `skill-catalogs.json` instead of
`registry.json`. v1-task C3.12. Source:
`src/cli/commands/skill/sync.ts`.

The agent and skill variants are deliberately kept as parallel files
(rather than abstracted to a shared core) because they read from and
write to different registries and a shared helper would obscure the
simple per-catalog loop. If a third sync variant ever appears, the
abstraction is worth revisiting.

**Arguments:**

- `[name]` — skill catalog label OR rootPath. Required unless `--all`.

**Flags:**

- `--all` — sync every remote-backed skill catalog.
- `--check` — `git ls-remote` only; update `lastRemoteSha` +
  `lastCheckedAt`; leave the working tree alone.

**Exit codes:** identical to `agent sync` (`0` clean / `2` usage / `1`
all-failed / `3` partial).

**Examples:**

```bash
$ smith skill sync acme/team-skills
$ smith skill sync --all
$ smith skill sync --all --check
```

**See also:** [`smith agent sync`](#smith-agent-sync-name),
[`smith doctor`](#smith-doctor),
[Sharing & distribution § 9](./15-sharing-and-distribution.md#9-sharing-via-direct-url).

---

### `smith skill list`

**Synopsis:** `smith skill list [--all]`

**Description:** List skills discovered across registered catalogs.
Without `--all`, ad-hoc catalogs (those auto-created by
`smith skill install --from <path>`) are filtered out. The
`atlassian-skills` catalog is **not** filtered. Each row prints
`<name> [<catalog-label>] — <description-excerpt>`. Per-catalog
discovery errors are reported as warnings to stderr but do not abort.
Source: `src/cli/commands/skill/list.ts`.

**Arguments:** none.

**Flags:**

- `--all` — include skills from ad-hoc catalogs.

**Exit codes:**

- `0` — listed.
- `1` — skill registry read failure.

**Examples:**

```bash
$ smith skill list
$ smith skill list --all
```

**See also:** [Skills](./05-skills.md).

---

### `smith skill catalogs`

**Synopsis:** `smith skill catalogs`

**Description:** List every registered skill catalog, including the
auto-injected `atlassian-skills` catalog. Each row prints
`<label> [<kind>] [<mode>] → <rootPath>` plus optional
`(protected, adhoc)` flags, and a `(git: <url>)` suffix for any
catalog with a `gitRemote`. The `[<mode>]` chip (v1-task RC2-6) is a
dim `[managed]` for smith-owned clones under `<stateHome>/remote/`
(`skill install --from <url>`) or `[linked]` for user-owned working
copies (`skill register`); same semantics as `agent catalogs`. Source:
`src/cli/commands/skill/catalogs.ts`.

**Arguments:** none.

**Flags:** none.

**Exit codes:**

- `0` — printed (including the empty case).
- `1` — skill registry read failure.

**Examples:**

```bash
$ smith skill catalogs
atlassian-skills [team-shared] → (not yet cloned) (protected)
team           [team-shared]      → /Users/you/skills/team
```

**See also:** [Skills](./05-skills.md).

---

### `smith skill catalog rename <old> <new>`

**Synopsis:** `smith skill catalog rename <old-label> <new-label>`

**Description:** Rename a skill catalog's label in `skill-catalogs.json`.
Source: `src/cli/commands/skill/catalog-rename.ts`.

**Arguments:**

- `<old-label>` — current catalog label.
- `<new-label>` — new catalog label.

**Flags:** none.

**Exit codes:**

- `0` — renamed.
- `1` — no catalog with `<old-label>` found (`not-found`).
- `2` — `<new-label>` already in use (`already-exists`).

**Examples:**

```bash
$ smith skill catalog rename team-skills acme-skills
```

**See also:** [Skills](./05-skills.md).

---

## Skill installs

### `smith skill install [ref]`

**Synopsis:** `smith skill install [ref] [--from <pathOrUrl>] [--as <name>] [--targets <list>] [--git-ref <ref>] [--all] [--skills <list>] [--json]`

**Description:** Install a skill onto one or more platforms. Three modes:

- **By ref:** `<name>` (search all registered catalogs) or
  `<catalog>/<name>` (pin to a specific catalog). Refs starting with `/`
  are intercepted with a hint to use `--from`. Refs containing `..`,
  backslashes, leading dots, or more than one `/` are rejected. Names
  are validated against `SAFE_SKILL_NAME_RE` (kebab-case, max 64 chars).
- **Ad-hoc local path:** `--from <path>` resolves a local skill directory
  into a synthetic catalog. Leading `~` and `~/` are expanded. The
  catalog is registered (failing on label collision with a hint to use
  `--as`) before the install runs.
- **Remote git URL:** `--from <url>` where `<url>` is `https://`,
  `ssh://[user@]host/...`, `git@host:`, or `file://`. The repo is cloned via the
  shared `installFromUrl` orchestrator into
  `<stateHome>/remote/<host>/<owner>/<repo>`, registered as a
  remote-backed skill catalog, then the install proceeds through the
  normal `<catalog>/<name>` path. When the cloned repo contains a
  single skill, `[ref]` is optional; when it contains more than one,
  pass `[ref]`, `--skills`, or `--all` to select which skills to
  install (omitting all three in a TTY opens an interactive picker;
  in non-TTY it exits `2` with the list).
  Refuses (exit 2, `already-exists`) when the URL is already registered
  under a different label in either registry — the error names the
  existing catalog and points at `smith {agent,skill} sync <label>`
  for updates (v1-task RC2-4). The same-URL idempotency case (re-run
  with the same label) still succeeds and fetches incrementally.
  v1-task C3.10.

Source: `src/cli/commands/skill/install-cmd.ts`.

**Arguments:**

- `[ref]` — optional. Required unless `--from` is given. With
  `--from <url>` it disambiguates a multi-skill remote (mutually
  exclusive with `--all` and `--skills`).

**Flags:**

- `--from <pathOrUrl>` — install from a local path OR a git URL. The
  scheme is detected by `isLikelyGitUrl()`; anything else is treated as
  a local path.
- `--as <name>` — catalog label for the auto-created ad-hoc catalog
  (local-path branch only; ignored for URLs, where the label is derived
  from the URL).
- `--targets <list>` — comma-separated subset of
  `opencode,claude-code,codex,kiro`. Default: all four.
- `--git-ref <ref>` — branch, tag, or SHA to check out after cloning
  with `--from <url>`. Defaults to the remote's HEAD. Ignored for local
  paths. (Note: the agent equivalent is `--ref`, not `--git-ref` — this
  asymmetry is deliberate because `smith skill install` already uses
  `[ref]` as a positional argument for the skill name.)
- `--all` — install every skill discovered in `--from <url>`. Mutually
  exclusive with `[ref]` and `--skills`.
- `--skills <list>` — comma-separated skill names to install from
  `--from <url>`. Mutually exclusive with `[ref]` and `--all`.
- `--json` — discover skills from `--from <url>`, print the discovery
  payload as JSON, and exit without installing or registering the
  catalog. Useful for scripting and CI introspection.

**Exit codes:**

- `0` — installed.
- `2` — ad-hoc catalog label collision (`already-exists`); installer
  failed (`validation-failed`); unknown `--targets` value;
  missing ref/`--from`; invalid ref format; invalid name; absolute-path
  ref intercepted; multi-skill remote without disambiguating ref;
  malformed URL or invalid scheme rejected by `deriveRemotePath`.

**Examples:**

```bash
$ smith skill install the-architect
$ smith skill install atlassian-skills/atlassian-readonly-skills
$ smith skill install --from ~/work/my-skill --as my-skill
$ smith skill install my-skill --targets opencode,claude-code
$ smith skill install --from git@github.com:acme/team-skills.git
$ smith skill install codex-helper \
    --from https://github.com/acme/team-skills.git --git-ref v1.2.0
```

**See also:** [`smith skill sync`](#smith-skill-sync-name),
[Skills](./05-skills.md#smith-skill-install-ref),
[Sharing & distribution § 9](./15-sharing-and-distribution.md#9-sharing-via-direct-url).

---

### `smith skill update [name]`

**Synopsis:** `smith skill update [name] [--all]`

**Description:** Re-copy installed skill(s) from their source catalogs.
With `--all`, iterates the entire `installed-skills.json` file. Without
`--all`, requires a name. The first failure aborts iteration in `--all`
mode. Source: `src/cli/commands/skill/install-cmd.ts`.

**Arguments:**

- `[name]` — optional. Required unless `--all` is given.

**Flags:**

- `--all` — update every installed skill.

**Exit codes:**

- `0` — all updates succeeded.
- `2` — any update failed (`validation-failed`); or neither name nor
  `--all` provided (`usage-error`).

**Examples:**

```bash
$ smith skill update the-architect
$ smith skill update --all
```

**See also:** [Skills](./05-skills.md).

---

### `smith skill uninstall <name>`

**Synopsis:** `smith skill uninstall <name>`

**Description:** Remove an installed skill from every platform it was
installed to. Auto-prunes its source catalog if it was an ad-hoc catalog
with no remaining installs. Source: `src/cli/commands/skill/install-cmd.ts`.

**Arguments:**

- `<name>` — bare skill name (no catalog prefix).

**Flags:** none.

**Exit codes:**

- `0` — removed.
- `2` — skill not installed or removal failed (`validation-failed`).

**Examples:**

```bash
$ smith skill uninstall my-skill
```

**See also:** [Skills](./05-skills.md).

---

### `smith skill validate <name>`

**Synopsis:** `smith skill validate <name>`

**Description:** Validate a single registered skill's frontmatter
(SKILL.md YAML block). Resolves the skill by name across all registered
catalogs. Source: `src/cli/commands/skill/validate.ts`.

**Arguments:**

- `<name>` — skill name.

**Flags:** none.

**Exit codes:**

- `0` — valid.
- `1` — skill not found in any registered catalog.
- `2` — invalid frontmatter; or ambiguous (name appears in multiple
  catalogs).

**Examples:**

```bash
$ smith skill validate the-architect
```

**See also:** [Skills](./05-skills.md).

---

### `smith skill bootstrap`

**Synopsis:** `smith skill bootstrap [--dry-run] [--targets <list>]`

**Description:** Install the bundled `the-architect` and `the-keymaker`
skills to all four platforms (`opencode`, `claude-code`, `codex`, `kiro`).
Resolves the repo root from this command file's own location (so it
works from a checked-out source tree). Honors
`AGENT_SMITH_SKIP_POSTINSTALL=1` and `CI=true` when invoked from
postinstall context (skipped, not failed). Source: `scripts/bootstrap.ts`.

> Note: this command no longer installs the `agent-smith` persona. The
> persona is installed separately by `bin/install` Step 9, by `smith
> update` Step 4, and on demand via `smith agent install agent-smith` (which
> resolves the persona through the synthetic `agent-smith-self` source
> registered in `src/io/registry.ts`). Recovery after a wipe is two
> commands: `smith skill bootstrap` and `smith agent install agent-smith`.

**Arguments:** none.

**Flags:**

- `--dry-run` — print what would happen without modifying anything.
- `--targets <list>` — comma-separated subset of
  `opencode,claude-code,codex,kiro`. Default: all four.

**Exit codes:**

- `0` — succeeded (skip-counts and warnings allowed).
- `3` — at least one error reported by `bootstrap()`.

**Examples:**

```bash
$ smith skill bootstrap --dry-run
$ smith skill bootstrap --targets opencode,claude-code
```

**See also:** [Getting started](./01-getting-started.md), [Skills](./05-skills.md).

---

## Validation

### `smith agent validate [name]`

**Synopsis:** `smith agent validate [name]`

**Description:** Validate one bundle (when `name` is given) or every
bundle across registered catalogs. Runs `runValidate()` against each:
schema check, line-count windows for `IDENTITY.md`/`EXPERTISE.md`/
`SOUL.md`, TODO-marker hard fail, and `WARN_CHARS`/`FAIL_CHARS`
thresholds against the assembled body. Prints `PASS`/`FAIL` per agent
with errors and warnings. Source: `src/cli/commands/validate.ts`.

**Arguments:**

- `[name]` — optional. Restrict to a single agent.

**Flags:** none.

**Exit codes:**

- `0` — every validated bundle passed.
- `1` — at least one bundle failed (when a name is given); or no agents
  found (or no agent matched `name`).
- `3` — partial failure (when no name is given and there are load or
  validation failures).

**Examples:**

```bash
$ smith agent validate
$ smith agent validate the-architect
```

**See also:** [Bundle anatomy — `thresholds`](./02-bundle-anatomy.md#thresholds--per-bundle-validator-threshold-overrides) for per-bundle threshold overrides (line-range and `warnChars`; the hard error gate `FAIL_CHARS` is not overridable). [Bundle anatomy](./02-bundle-anatomy.md).

---

## Install and remove

### `smith agent install <name>`

**Synopsis:** `smith agent install [name] [--yes] [--with-skills | --no-skills] [--no-refresh-hooks] [--refresh-consent <yn>] [--from <url> [--ref <ref>]] [--all] [--agents <list>] [--json] [--force] [--allow-missing-mcp] [--allow-missing-cli] [--platforms <list>] [--verbose] [--platform-conventions <scalar>] [--no-platform-conventions]`

**Description:** Build and render an agent bundle to its targets. Build
runs first; if any agent build fails, the entire install aborts before
required-skill resolution touches the user's skill set. After a
successful build, the per-agent `requires.skills` list is reconciled
according to `--with-skills`/`--no-skills`/`--yes`. Required-skill
failures **never abort** install — they surface as warnings.

Two acquisition modes:

- **Local (default):** resolve `<name>` against currently registered
  agent catalogs, then build and install.
- **Remote `--from <url>` (v1-task C3.9):** clone an external git
  repository into `<stateHome>/remote/<host>/<owner>/<repo>` via the
  shared `installFromUrl` orchestrator, register it as a remote-backed
  catalog (with a `remote` block recording the URL, ref, and pulled
  SHA), then install. `<name>` is optional when the cloned repo
  contains exactly one bundle; when it contains more than one, pass
  `<name>`, `--agents`, or `--all` to select which agents to install
  (omitting all three in a TTY opens an interactive picker; in non-TTY
  it exits `2` with the list).
  `--from` skips the local-catalog lookup entirely — local agents with
  the same name are not consulted. Refuses (exit 2, `already-exists`)
  when the URL is already registered under a different label in either
  registry — the error message names the existing catalog and points
  at `smith agent sync` (v1-task RC2-4). Re-running with the same URL
  is still idempotent (same path; fetch-or-clone).

When invoked without `<name>` **and without `--from`**, `smith agent
install` exits `2` (`usage-error`) with a sorted list of registered
agents and a suggestion to run `smith agent install-all` (or
`smith agent init` if no agents are registered yet). Source:
`src/cli/commands/install.ts`.

**Arguments:**

- `[name]` — agent name. Optional with `--from`; otherwise omitting it
  triggers the helpful-error listing described above.

**Flags:**

- `--yes` — auto-accept prompts (including required-skill installs;
  implies `--with-skills`).
- `--with-skills` — install required skills without prompting.
- `--no-skills` — skip required-skill installs (warn instead). Wins if
  combined with `--yes` or `--with-skills` because Commander turns
  `--no-skills` into `opts.skills === false` and the dispatch checks
  that branch first.
- `--no-refresh-hooks` — skip refresh hook installation entirely. The
  consent prompt is not shown and no `hooks.SessionStart` block is
  written into the rendered agent file; refresh becomes manual-only
  via `smith knowledge fetch`. No `refresh-manifest.json` is written.
- `--refresh-consent <yn>` — pre-answer the refresh consent prompt for
  agents with `session`/`always` knowledge sources. Accepts `y`, `yes`,
  `n`, `no` (case-insensitive); any other value raises a `usage-error`.
  Required in non-TTY contexts (CI) when refresh hooks are wanted —
  without it, smith defaults to *no* and prints a warning telling you
  how to opt in. The decision broadcasts to every consent-eligible
  platform on this install (claude-code, codex) — there is no
  per-platform variant. See
  [guide/04-knowledge.md § Consent and the refresh manifest](./04-knowledge.md#consent-and-the-refresh-manifest)
  for the full flow and the manifest shape.
- `--from <url>` — clone-and-install branch. Accepts `https://`,
  `ssh://[user@]host/...`, `git@host:`, and `file://` URLs. URL normalization
  (`src/io/remote-path.ts:deriveRemotePath`) rejects plain `http://`,
  smart-transport schemes (`ext::`), URL segments starting with `-`
  (git option-injection guard), `..` segments, and host/owner/repo
  triples with fewer than three components. The clone directory is
  deterministic and idempotent — re-running with the same URL fetches
  into the same path. Local URLs (`file://`) are routed to
  `<stateHome>/remote/_local/<8-char-hash>-<basename>`. See
  [Sharing & distribution § 9](./15-sharing-and-distribution.md#9-sharing-via-direct-url).
- `--ref <ref>` — branch, tag, or SHA to check out after cloning with
  `--from`. Defaults to the remote's HEAD. Ignored without `--from`.
  (Note: the skill equivalent is `--git-ref`, not `--ref` — this
  asymmetry is deliberate because `smith skill install` uses `[ref]` as
  a positional argument for the skill name, so `--ref` would be
  confusing there.)
- `--all` — install every agent discovered in `--from <url>`. Mutually
  exclusive with `[name]` and `--agents`.
- `--agents <list>` — comma-separated agent names to install from
  `--from <url>`. Mutually exclusive with `[name]` and `--all`.
- `--json` — discover agents from `--from <url>`, print the discovery
  payload as JSON, and exit without installing or registering the
  catalog. Useful for scripting and CI introspection.
- `--force` — bypass manifest's would-clobber refusal: smith will
  overwrite a rendered file at any target even when it isn't recorded in
  `installed-agents.json` or its on-disk hash differs from the manifest.
  Use after intentionally diverging a rendered file.
- `--allow-missing-mcp` — demote missing-MCP-server errors to warnings.
  Without this flag, install blocks when a declared MCP server cannot be
  resolved.
- `--allow-missing-cli` — demote missing-platform-CLI errors to warnings.
  Without this flag, a target whose platform CLI is absent throws
  `PlatformUnavailableError` and the orchestrator drops that target. With
  the flag, the resolver emits the static tier literal (e.g. `opus` for
  Claude Code high, `gpt-5-codex` for Codex high) plus a warning, and
  the agent still installs. OpenCode is unaffected (it uses a curated
  fallback). See [07-models.md § Missing platform CLI](./07-models.md#missing-platform-cli-allow-missing-cli).
- `--platforms <list>` — comma-separated list of platforms to install to
  (subset of the agent's declared targets). Restricts which platform
  files are written.
- `--verbose` — show info-level warnings (pattern fallbacks, platform
  truisms) that are normally suppressed.
- `--platform-conventions <scalar>` — answer the platform-conventions
  prompt non-interactively. Accepts `accept-all`, `reject-all`,
  `use-defaults`, or `prompt`. See [06 — Permissions and platforms](./06-permissions-and-platforms.md#platform-conventions).
- `--no-platform-conventions` — equivalent to
  `--platform-conventions reject-all`: reject every requested
  convention. Useful in CI.

**Codex hooks.** Installing a codex-targeted bundle with `session` or
`always` knowledge sources prompts for consent (unless
`--refresh-consent yes|no` is passed). On consent, smith writes a
global `SessionStart` hook entry (matcher `startup|resume`, command
`smith knowledge refresh-session --platform codex`, 5s timeout) to
`~/.codex/hooks.json` and takes ownership of the file via a
`_smith_managed` sentinel listing the consenting agent names.

If `~/.codex/hooks.json` pre-exists without the smith ownership marker,
install fails with a `validation-failed` error
(`codex hooks.json at <path> already exists and is not managed by smith`)
and instructs the user to move the file aside or merge its contents
manually before re-running registration. Smith never overwrites a
user-owned codex hook config.

After install, smith prints a one-line advisory: open codex and type
`/hooks` to trust the smith entry. The entry is silently ignored by
codex until trusted. See [guide/04-knowledge.md § What triggers the actual refresh](./04-knowledge.md#what-triggers-the-actual-refresh).

**OpenCode plugin.** Installing an opencode-targeted bundle with
`session` or `always` knowledge sources (after the consent prompt
resolves to yes) writes a global plugin at
`~/.config/opencode/plugins/agent-smith-refresh/index.ts` and
registers it in `~/.config/opencode/opencode.json` (top-level `plugin`
array). The plugin is **global, not per-agent** — there is one
plugin for all consenting opencode agents, and it refreshes the
**superset** of installed opencode-targeted agents with
`session`/`always` sources on every `session.created` event (OpenCode
has no per-session-agent scoping equivalent to codex's `--profile`).
A `.smith-managed` sentinel file inside the plugin dir tracks which
agents opted in; when the last consenting opencode agent is removed,
`smith agent uninstall` deletes the plugin directory and removes the
`opencode.json` entry. The same `--refresh-consent` /
`--no-refresh-hooks` flags govern opencode consent. See
[guide/04-knowledge.md § Consent and the refresh manifest](./04-knowledge.md#consent-and-the-refresh-manifest).

**Exit codes:**

- `0` — install succeeded (skill warnings allowed).
- `1` — agent not found; build error.
- `2` — `<name>` omitted (helpful error printed).
- `3` — agent exists but failed to load (partial failure).

**Examples:**

```bash
$ smith agent install the-architect
$ smith agent install the-architect --with-skills
$ smith agent install the-architect --no-skills
$ smith agent install --from git@github.com:acme/team-agents.git
                                                  # single-bundle remote
$ smith agent install code-reviewer \
    --from https://github.com/acme/team-agents.git --ref v1.4.0
```

**See also:** [`smith agent sync`](#smith-agent-sync-name),
[Installing and rendering](./03-installing-and-rendering.md),
[Skills](./05-skills.md#required-skills-requiresskills),
[Sharing & distribution § 9](./15-sharing-and-distribution.md#9-sharing-via-direct-url).

---

### `smith agent install-all`

**Synopsis:** `smith agent install-all [--yes] [--with-skills | --no-skills] [--force] [--allow-missing-mcp] [--allow-missing-cli] [--platforms <list>] [--platform-conventions <scalar>] [--no-platform-conventions]`

**Description:** Build and render every known agent. Iterates by
delegating each agent to `install()` (so `requires.skills` resolution
runs once per agent), reusing the already-loaded registry and bundle
list to avoid re-reading per agent. Returns the last non-zero per-agent
exit code if any installs failed. Source: `src/cli/commands/install-all.ts`.

**Arguments:** none.

**Flags:** same as `install`.

**Exit codes:**

- `0` — every agent installed successfully (or registry was empty).
- `1` — at least one agent's install returned `1`.
- `3` — partial failure (bundle load errors when all installs succeeded).

**Examples:**

```bash
$ smith agent install-all --with-skills
```

**See also:** [Installing and rendering](./03-installing-and-rendering.md).

---

### `smith agent uninstall <name>`

**Synopsis:** `smith agent uninstall <name> [--dry-run] [--force] [--platforms <list>]`

**Description:** Remove an installed agent from every target it was
installed to. Output ordering is fixed: removed paths first, then
not-found paths, then errors. The uninstaller consults
`installed-agents.json` and refuses any path whose on-disk hash differs
from the recorded manifest hash (reported under `refused[]`); pass
`--force` to bypass that refusal. Source: `src/cli/commands/uninstall.ts`.

**Arguments:**

- `<name>` — agent name.

**Flags:**

- `--dry-run` — preview without removing files.
- `--force` — bypass manifest hash-mismatch refusal: delete the file
  even when the on-disk hash differs from the manifest.
- `--platforms <list>` — comma-separated list of platforms to uninstall
  from (intersected with the agent's declared targets).

**Exit codes:**

- `0` — every target file removed (or absent).
- `1` — agent not found.
- `3` — partial failure: one or more files could not be removed.

**Examples:**

```bash
$ smith agent uninstall my-agent --dry-run
$ smith agent uninstall my-agent
```

**See also:** [Update and uninstall](./11-update-and-uninstall.md).

---

### `smith agent uninstall-all`

**Synopsis:** `smith agent uninstall-all [--dry-run] [--yes] [--force] [--platforms <list>]`

**Description:** Remove every registered agent from every target.
Without `--yes`, prompts `Continue? [y/N]` and aborts on anything other
than `y` or `yes`. Source bundles in their catalogs remain registered
— this command only removes the rendered installs. Manifest
hash-mismatch refusal applies the same as single-agent uninstall;
`--force` bypasses it. Source: `src/cli/commands/uninstall-all.ts`.

**Arguments:** none.

**Flags:**

- `--dry-run` — preview without removing files.
- `--yes` — skip the confirmation prompt.
- `--force` — bypass manifest hash-mismatch refusal across every agent.
- `--platforms <list>` — comma-separated list of platforms to uninstall
  from across every agent.

**Exit codes:**

- `0` — every file removed (or nothing to remove).
- `1` — user declined the confirmation prompt.
- `3` — partial failure.

**Examples:**

```bash
$ smith agent uninstall-all --dry-run
$ smith agent uninstall-all --yes
```

**See also:** [Update and uninstall](./11-update-and-uninstall.md).

---

### `smith agent destroy <name>`

**Synopsis:** `smith agent destroy <name> [--dry-run] [--yes] [--force]`

**Description:** Inverse of `smith agent init`. Permanently removes the
source bundle directory at `~/.config/agent-smith/agents/<name>/`. By
design only operates on bundles inside the `user-global` catalog rooted
at `~/.config/agent-smith/agents/` — bundles in registered or project
catalogs (whose source-of-truth lives elsewhere, often a git repo) are
refused with a `usage-error` pointing at `smith agent unregister`. Refuses if
rendered files still exist on any platform unless `--force` is given,
which chains a full uninstall before removing the source. Confirmation
requires typing the literal token `<name>` (the agent name itself);
skip with `--yes`. Output mirrors `jack-out`: per-target install table
with `~`-relative paths, color symbols (●/✗/⚠), and an action column.
Source: `src/cli/commands/destroy-agent.ts`.

**Arguments:**

- `<name>` — agent name. Must resolve to a `user-global` bundle.

**Flags:**

- `--dry-run` — preview the source removal and (with `--force`) the
  cascading uninstall plan. No files touched.
- `--yes` — skip the typed-token confirmation prompt. Required on
  non-TTY environments.
- `--force` — chain `smith agent uninstall <name>` before removing the source.
  Without `--force`, the command refuses if rendered files remain on
  any platform and prints a `Try: smith agent uninstall <name>` suggestion.

**Exit codes:**

- `0` — source bundle removed (or dry-run completed).
- `1` — confirmation token mismatch (typed something other than the
  agent name).
- `2` — agent not found; bundle is not in the `user-global` catalog
  (`usage-error`); rendered files exist and `--force` was not passed
  (`usage-error`).

**Examples:**

```bash
$ smith agent destroy my-debugger --dry-run
Agent: my-debugger
  Located at: ~/.config/agent-smith/agents/my-debugger
  Installed in:
    ✗ opencode     not installed  → no action
    ✗ claude-code  not installed  → no action
    ✗ codex        not installed  → no action
  Source files:
    ⚠ would be permanently removed
DRY RUN — no changes made.

$ smith agent destroy my-debugger
Type 'my-debugger' to confirm: my-debugger

$ smith agent destroy my-debugger --force --yes   # CI-friendly
```

**See also:** [Update and uninstall](./11-update-and-uninstall.md#smith-agent-destroy-name), [`smith agent init`](#smith-agent-init-name), [`smith agent uninstall`](#smith-agent-uninstall-name).

---

### `smith jack-out`

**Synopsis:** `smith jack-out [--dry-run] [--yes]`

**Description:** Full offboarding. Plans the removal of every installed
agent file, the entire `~/.config/agent-smith/` directory, the
`~/.local/bin/smith` symlink, the agent-smith marker block from your
shell rc file, and the `~/.agent-smith/` source clone itself, then
executes after confirmation. Confirmation requires the user to type the
literal token `jack-out` — `y` is **not** accepted. The source clone is
removed last so the rest of the run can still read its on-disk
resources. Source: `src/cli/commands/jack-out.ts`.

**Arguments:** none.

**Flags:**

- `--dry-run` — preview without removing anything.
- `--yes` — skip the typed-token confirmation.

**Exit codes:**

- `0` — everything removed.
- `1` — confirmation declined.
- `3` — partial failure (file removal errors or config-dir removal failed).

**Examples:**

```bash
$ smith jack-out --dry-run
$ smith jack-out
Type 'jack-out' to confirm: jack-out
```

**See also:** [Update and uninstall](./11-update-and-uninstall.md#smith-jack-out).

---

## Knowledge

The `knowledge` parent command groups four real Commander subcommands
(`list`, `fetch`, `add`, `validate`) defined in `src/index.ts`. Commander
rejects unknown flags and prints per-subcommand `--help`. Every
subcommand is invoked as `smith knowledge <sub> ...`.

### `smith knowledge add <agent> <type-or-url> [path-or-url]`

**Synopsis:** `smith knowledge add <agent> <type-or-url> [path-or-url] [--id <id>] [--delivery <delivery>] [--description <text>] [--optional] [--no-install] [--pages <list>] [--max-pages <n>] [--include-children] [--format <fmt>] [--fields <list>] [--max-results <n>]`

**Description:** Add a knowledge source to an agent's
`agent.config.json`, then auto-run `smith agent install <agent>` to materialize
it (the source isn't usable to the agent until materialized). Derives an
`id` from the path basename or the URL host+path if not given
(lowercased, kebab-cased, capped at 60 chars). Validates the merged
config and the new knowledge block before writing; both checks raise
`validation-failed` on failure. The config write is *config-first*: if
materialization fails after the config is saved, `add` still returns
exit `0` with a warning telling you to retry `smith agent install <agent>` —
your declaration is never lost. Pass `--no-install` to skip
materialization. Source: `src/cli/commands/knowledge/add.ts`.

**Arguments:**

- `<agent>` — agent name.
- `<type>` — one of `file|dir|glob|url|git|confluence|jira`. For `confluence`, `<path-or-url>` is the space key; for `jira`, it's a JQL query — see the Atlassian sources section below for per-type flags. (`npm` is declared in the schema but rejected by the validator.)
- `<path-or-url>` — source path (for `file`/`dir`/`glob`) or URL (for
  `url`/`git`).

**Flags:**

- `--id <id>` — explicit source id (skip derivation).
- `--delivery <delivery>` — one of `inline|file|auto`. Default `auto`.
- `--description <text>` — human-readable description.
- `--optional` — set `optional: true` on the new source. At install time, runtime/IO failures (network, missing file, git auth) on this source degrade to warnings instead of aborting. `validation-failed` SmithErrors still abort regardless. See [guide/04-knowledge.md § Optional sources](./04-knowledge.md#optional-sources).
- `--no-install` — skip the auto-materialize step. The source is still saved to `agent.config.json`; run `smith agent install <agent>` later to materialize.

**Exit codes:**

- `0` — added (and materialized, unless `--no-install` or materialize warned).
- `1` — agent not found, config read/write failure.
- `2` — missing required positional argument; merged config or knowledge
  block fails validation.

**Examples:**

```bash
$ smith knowledge add my-agent file ~/notes/runbook.md \
    --description "Production runbook"
$ smith knowledge add my-agent url https://internal-wiki.example.com/runbook \
    --delivery file --optional
$ smith knowledge add my-agent url https://docs.example.com --no-install
```

**Atlassian sources (confluence and jira):**

`smith knowledge add <agent> confluence <space>` and `smith knowledge add <agent> jira <jql>` work end-to-end as of v0.12.0. The third positional is the type's required identifier:
- `confluence <space>` — the Confluence space key, e.g. `ENG`
- `jira <jql>` — a JQL query string, e.g. `"project=ENG AND status='To Do'"`

Per-type flags map directly to schema fields:

| Flag | Types | Maps to | Notes |
|---|---|---|---|
| `--pages <list>` | confluence | `pages[]` | Comma-separated page titles or `id:N` refs (e.g. `"Onboarding,id:123"`) |
| `--max-pages <n>` | confluence | `maxPages` | Integer 1-100 (schema-enforced) |
| `--include-children` | confluence | `includeChildren` | Recurse into child pages |
| `--format <fmt>` | confluence | `format` | One of `storage`, `view`, `markdown` |
| `--fields <list>` | jira | `fields[]` | Comma-separated field names; `*all` requests every field |
| `--max-results <n>` | jira | `maxResults` | Integer 1-500 (schema-enforced) |

Examples:

```bash
$ smith knowledge add my-agent confluence ENG \
    --pages "Onboarding,Runbook" --format markdown --description "Eng wiki"
$ smith knowledge add my-agent jira "project=ENG AND resolved=null" \
    --fields summary,description,status --max-results 200
$ smith knowledge add my-agent confluence DEVOPS --include-children --max-pages 50
```

**Auth:** Both types require Atlassian credentials. `smith knowledge add` checks at add time and warns (does not block) if `SMITH_ATLASSIAN_EMAIL` and a token (`SMITH_ATLASSIAN_API_TOKEN` or `SMITH_JIRA_API_TOKEN`) are missing. The auto-materialize step (`smith agent install`) will fail until credentials are configured. See [src/io/atlassian-auth.ts](../src/io/atlassian-auth.ts) for the full credential resolution order (env, then `~/.config/agent-smith/.env`).

**URL shortcut (atlassian + plain web):**

As of v0.12.0, you can paste any Atlassian URL straight from your browser as the second positional and skip `<type>` entirely:

```bash
$ smith knowledge add <agent> <atlassian-or-web-url>
```

Smith parses the URL and fills the right flags. Six URL shapes are recognised:

| URL shape | Parsed as | Notes |
|---|---|---|
| `/wiki/spaces/<SPACE>/pages/<ID>/...` | `confluence` (single page) | `pages: [id:<ID>]`, format defaults to `markdown` |
| `/wiki/spaces/<SPACE>/blog/YYYY/MM/DD/<ID>/...` | `confluence` (single blog post) | `pages: [id:<ID>]`, format defaults to `markdown` |
| `/wiki/spaces/<SPACE>(/overview)?` | `confluence` (whole space) | format defaults to `markdown` |
| `/browse/<KEY-N>` | `jira` (single issue) | `jql: "key = <KEY-N>"` |
| `/issues/?jql=<urlencoded>` | `jira` (search query) | jql decoded from the query string |
| any other http(s) URL | `url` (plain web fetch) | fallback for non-Atlassian URLs |

The success line tells you which kind was created (e.g. `→ added Confluence page knowledge source ...`) so a typo'd Atlassian URL falling through to `plain web URL` is caught immediately.

**Flag override rule.** Any explicit flag (`--pages`, `--format`, `--fields`, `--id`, etc.) wins over the URL-derived default. A space URL plus `--pages id:99,id:100` selects only those pages; a page URL plus `--format storage` uses storage instead of markdown.

Examples:

```bash
$ smith knowledge add my-agent \
    "https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Onboarding"
$ smith knowledge add my-agent \
    "https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Onboarding" \
    --format storage   # override default markdown
$ smith knowledge add my-agent "https://acme.atlassian.net/browse/ENG-42"
$ smith knowledge add my-agent "https://example.com/docs/intro"   # plain url fallback
```

**v1 limitations.** Confluence tinylinks (`/wiki/x/...`), Jira boards and dashboards, and the newer `/jira/software/projects/.../issues/KEY-N` path are NOT recognised — they fall through to `plain web URL`. Use the long-form flag command (`smith knowledge add <agent> confluence <space>` or `... jira <jql>`) if you need those routed as structured atlassian sources.

**Garbage input.** Strings that start with `http://` or `https://` but don't parse (e.g. `"http://not a url with spaces"`) exit `2` (`validation-failed`) with a clear error. The handler only enters URL-shortcut mode when the second positional starts with `http(s)://`; everything else routes to the flag-form path unchanged.

**See also:** [Knowledge](./04-knowledge.md).

---

### `smith knowledge list <agent>`

**Synopsis:** `smith knowledge list [--json] <agent>`

**Description:** Show the state of an agent's knowledge in one of four
shapes:

1. **Agent not found** — exits `1` (`not-found`), suggests `smith agent init <agent>`.
2. **Agent exists, no sources declared** — exits `0`, prints "no
   knowledge sources declared yet" with a hint to `smith knowledge add`.
3. **Sources declared but not yet materialized** — exits `0`, lists each
   declaration (`id`, type, ref, description) with a hint to
   `smith agent install <agent>` to materialize.
4. **Materialized** — exits `0`, prints render time, inline token usage
   vs budget, totals, and per-source file lists from
   `<knowledgeDir>/_manifest.json`.

Source: `src/cli/commands/knowledge/list.ts`.

**Arguments:**

- `<agent>` — agent name.

**Flags:**

- `--json` — emit machine-readable JSON instead of human output.

**Exit codes:**

- `0` — printed (any of states 2, 3, or 4).
- `1` — agent not found; manifest read error other than `ENOENT`.
- `2` — missing `<agent>` (`usage-error`).

**Examples:**

```bash
$ smith knowledge list my-agent
```

**See also:** [Knowledge](./04-knowledge.md).

---

### `smith knowledge fetch <agent>`

**Synopsis:** `smith knowledge fetch <agent> [--source <id>]`

**Description:** Re-acquire knowledge sources for an agent and re-run
`install`. When `--source <id>` is given, currently clears the
**entire** `<knowledgeDir>/.cache/` directory (not just the targeted
source) before re-installing. Source: `src/cli/commands/knowledge/fetch.ts`.

**Arguments:**

- `<agent>` — agent name.

**Flags:**

- `--source <id>` — clear cache for URL sources before re-install.
  (Currently clears the whole cache.)

**Exit codes:** same as `smith agent install <agent>`.

- `0` — re-fetched and installed.
- `1` — agent not found; build error.
- `2` — missing `<agent>` argument.
- `3` — agent exists but failed to load; cache removal error (partial
  failure).

**Examples:**

```bash
$ smith knowledge fetch my-agent
$ smith knowledge fetch my-agent --source runbook
```

**See also:** [Knowledge](./04-knowledge.md).

---

### `smith knowledge compile [name]`

**Synopsis:** `smith knowledge compile [name] [--all]`

**Description:** Forces the v2 compile stage for one or every registered
bundle that has knowledge sources, regardless of v2.1 smart-default
thresholds or the explicit `compile.progressive` opt-in/opt-out. The
user explicitly typed the command; honour that. Persists
`compile-manifest.json` under the agent's knowledge dir. Reads the
materialized cache produced by the last `smith agent install`; offline
(no acquire, no network). Use this for offline iteration on summaries /
TOC tuning, CI drift checks, or pre-warming the manifest. The smart
auto-compile default in `runKnowledgeStage` governs `smith agent install`'s
implicit decisions, not this command. Source:
`src/cli/commands/knowledge/compile.ts`.

**Arguments:**

- `[name]` — optional. Required unless `--all` is given. Mutually
  exclusive with `--all`.

**Flags:**

- `--all` — force compile for every registered bundle that has at
  least one knowledge source. Bundles with no knowledge block / no
  sources are skipped (one warn line per skipped bundle); the command
  only exits non-zero when every targeted bundle was skipped.

**Exit codes:**

- `0` — every targeted bundle compiled successfully.
- `1` — runtime error inside a compile.
- `2` — usage error: neither `[name]` nor `--all` given; both given;
  named bundle has no `knowledge` block or no sources; or `--all`
  matched no bundles with sources.

**Examples:**

```bash
$ smith knowledge compile my-agent
compiled my-agent: 7 source(s), 7 TOC line(s), hash 3a1f9c0e

$ smith knowledge compile --all
compiled my-agent: 7 source(s), 7 TOC line(s), hash 3a1f9c0e
skip other-agent: no knowledge sources to compile
```

**See also:** [Knowledge compiler](./16-knowledge-compiler.md).

---

### `smith knowledge serve <name>`

**Synopsis:** `smith knowledge serve <name> [--stdio]`

**Description:** Spawns a stdio MCP server backed by an in-memory BM25
index over the agent's materialized knowledge dir. Two tools:
`knowledge.search(query, k=5)` returns top-k `(path, score, snippet)`
matches; `knowledge.fetch(path, start?, end?)` returns file contents
range-bounded to 64KB per response (path traversal rejected). The index
is rebuilt on every spawn. Validates that the agent exists before
opening stdio so an unknown name doesn't silently serve an empty index.
Source: `src/cli/commands/knowledge/serve.ts`.

Wire it into a platform's MCP config (the same way you'd wire any other
MCP server) by pointing at:

```
command: smith
args:    knowledge serve <name> --stdio
```

**Arguments:**

- `<name>` — agent name. Must be registered.

**Flags:**

- `--stdio` — serve over stdio (MCP). Default and currently the only
  transport; the flag exists for forward compat with a future
  `--http <port>` mode.

**Exit codes:**

- `0` — server exited cleanly (stdin EOF).
- `1` — runtime error inside the server.
- `2` — agent not registered (`not-found`); `--stdio false` passed
  (`usage-error`).

**Examples:**

```bash
$ smith knowledge serve my-agent --stdio    # MCP-aware tool spawns this
```

**See also:** [Knowledge compiler — `smith knowledge serve --stdio`](./16-knowledge-compiler.md#smith-knowledge-serve---stdio).

---

### `smith knowledge refresh-session`

**Synopsis:** `smith knowledge refresh-session [--agent <name>] [--platform <id>] [--timeout <ms>] [--json]`

**Description:** Refresh all installed agents' knowledge sources whose
`refresh.mode` is `session` or `always`. Designed to be called from
platform `SessionStart` hooks; always exits 0 (soft-fail). Failures are
surfaced on stderr; the session proceeds with the last successfully-
materialized content. Source: `src/cli/commands/knowledge/refresh-session.ts`.

**Flags:**

- `--agent <name>` — restrict to one agent's sources only (used by Claude
  Code per-agent hooks).
- `--platform <id>` — platform that invoked us (`claude-code`, `codex`,
  `kiro`, or `opencode`). When set, refresh is scoped to agents that target
  this platform. When `--platform codex` is given without `--agent`,
  smith sniffs the parent process command line for `--profile <name>`
  (codex's per-profile flag) and scopes refresh to that single agent;
  on miss (e.g. bare `codex`), refresh runs over the superset of
  installed codex-targeted agents with `session`/`always` sources.
  Unknown values are silently dropped (a typo'd `--platform` should
  not fail the hook); behaviour then matches `--platform` omitted.
- `--timeout <ms>` — override the 5000ms global wall-clock budget.
- `--json` — emit structured result on stdout:
  `{ refreshed, failed, skipped, totalDurationMs }`.

**Exit codes:**

- `0` — always (including when individual sources fail; failures go to stderr).
- non-zero — only when CLI argument parsing fails.

**Examples:**

```bash
# Used by hook: refresh everything that's due
$ smith knowledge refresh-session

# Used by Claude Code per-agent hook
$ smith knowledge refresh-session --agent my-agent --timeout 5000

# Used by the codex hook in ~/.codex/hooks.json — sniffs the parent
# `codex --profile <name>` to scope refresh to one agent.
$ smith knowledge refresh-session --platform codex

# Used by the opencode plugin at ~/.config/opencode/plugins/agent-smith-refresh/
# on every session.created — refreshes the superset of installed
# opencode-targeted agents (no per-session-agent scoping in opencode).
$ smith knowledge refresh-session --platform opencode

# Used by orchestrators that need the result
$ smith knowledge refresh-session --json
```

**See also:** [Knowledge — Refresh modes](./04-knowledge.md#refresh-modes).

---

### `smith knowledge migrate-codex`

**Synopsis:** `smith knowledge migrate-codex [--path <path>]`

**Description:** One-shot upgrade helper for users who installed
codex-targeted agents before v0.15 and already have a hand-written
`~/.codex/hooks.json`. Smith refuses to overwrite a user-owned hooks
file during install (it would silently delete the user's hooks); this
command resolves the standoff by claiming ownership of the file iff its
contents are compatible. The decision is one of three outcomes:

- **`noop`** — the file is missing, OR already carries the
  `_smith_managed` sentinel, OR has an empty `hooks: {}` block. Nothing
  to migrate; exits `0`.
- **`claimed`** — every existing hook command across every event group
  matches `smith knowledge refresh-session` (i.e. the user's hooks are
  semantically equivalent to what smith would install). Smith rewrites
  the file with the `_smith_managed` sentinel and an empty
  `agents: []` list, then a normal `smith agent install` will populate
  the agent list. Exits `0`.
- **`conflict`** — at least one hook command is unrelated to smith, OR
  one of the event groups has a malformed shape (e.g.
  `hooks: { SessionStart: "not-an-array" }`). The file is **left
  untouched**, the command prints each offending entry as
  `event[matcher]: command` and a manual-merge hint, and exits non-zero.
  Resolve the conflict by hand (move or merge the unrelated hooks) and
  re-run.

Source: `src/cli/commands/knowledge/migrate-codex.ts`.

**Arguments:** none.

**Flags:**

- `--path <path>` — alternate hooks file path. Default
  `~/.codex/hooks.json`. Mostly useful for testing against a sample
  file before touching the real one.

**Exit codes:**

- `0` — `noop` or `claimed`.
- non-zero — `conflict` (or unrecoverable I/O error). The file is
  guaranteed untouched in the conflict case.

**Examples:**

```bash
# Default path — most users
$ smith knowledge migrate-codex
~/.codex/hooks.json: claimed (was compatible with smith refresh hooks)

# Dry-test against a sample file
$ smith knowledge migrate-codex --path /tmp/hooks-sample.json
/tmp/hooks-sample.json: noop (already smith-managed)

# Conflict — file left untouched
$ smith knowledge migrate-codex
~/.codex/hooks.json: conflict — file left untouched
  SessionStart[startup]: /usr/local/bin/my-custom-script.sh
  SessionEnd[*]: /opt/team/log-hook.sh

Resolve by hand: move or merge the unrelated hooks, then re-run.
$ echo $?
1
```

**See also:** [Knowledge — Troubleshooting](./04-knowledge.md#troubleshooting), [`smith doctor --fix-knowledge-refresh`](#smith-doctor) (reports the same drift as `unmanaged-codex-hooks`).

---

### `smith knowledge validate [agent]`

**Synopsis:** `smith knowledge validate [agent]`

**Description:** Lint the `knowledge` block of one bundle (or all
bundles when no agent is given). Reports errors and warnings per agent;
silent when a bundle has no knowledge issues. Source:
`src/cli/commands/knowledge/validate.ts`.

**Arguments:**

- `[agent]` — optional filter.

**Flags:** none.

**Exit codes:**

- `0` — every bundle's knowledge block is valid (warnings allowed).
- `3` — at least one bundle has knowledge errors (partial failure).

**Examples:**

```bash
$ smith knowledge validate
$ smith knowledge validate my-agent
```

**See also:** [Knowledge](./04-knowledge.md).

---

### `smith knowledge remove <agent> <source-id>`

**Synopsis:** `smith knowledge remove <agent> <source-id>`

**Description:** Remove a knowledge source from an agent's
`agent.config.json` by its `id` field. Does NOT auto-materialize — the
installed knowledge files remain on disk until the next
`smith agent install`. Source: `src/cli/commands/knowledge/remove.ts`.

**Arguments:**

- `<agent>` — agent name.
- `<source-id>` — the `id` of the source to remove.

**Flags:** none.

**Exit codes:**

- `0` — source removed from config.
- `1` — agent not found; source id not found in the agent's knowledge
  block (`not-found`).
- `2` — `config-missing` (agent has no `agent.config.json`).

**Examples:**

```bash
$ smith knowledge remove my-agent api-docs
```

**See also:** [Knowledge](./04-knowledge.md).

---

## Maintenance

### `smith gui`

**Synopsis:** `smith gui [--port <n>] [--bind <addr>] [--no-open]`

**Description:** Launch the smith browser GUI. Serves a local SPA that
wraps every daily-workflow command. Auto-rebuilds `gui/web/dist/` when
the source is newer than the bundle (skip with `SMITH_GUI_NO_AUTOBUILD=1`).
A one-time auth token is generated and appended to the URL. Source:
`src/cli/commands/gui.ts`.

**Arguments:** none.

**Flags:**

- `--port <n>` — port to bind (default `7777`; auto-increments on conflict).
- `--bind <addr>` — address to bind (default `127.0.0.1`).
- `--no-open` — do not auto-open the browser.

**Exit codes:**

- `0` — server stopped cleanly (SIGINT).
- `1` — GUI bundle rebuild failed; server startup error.

**Examples:**

```bash
$ smith gui
$ smith gui --port 9000 --no-open
```

---

### `smith doctor`

**Synopsis:** `smith doctor [-v|--verbose] [-q|--quiet] [--json] [--offline] [--no-cache] [--skip-model-resolution] [--fix-knowledge-refresh] [--fix-knowledge-compile]`

**Description:** Run the health check, auto-filtered to the platform
CLIs detected on `PATH` (`opencode`, `claude`, `codex`). Sections that
correspond to a missing CLI — and `model-resolution`, which depends on
OpenCode — are omitted from both human and JSON output. Cross-cutting
sections (`workspace`, `atlassian-auth`, `skill-drift`,
`agent-required-skills`, `registry-hygiene`,
`remote-catalogs`, `duplicate-catalogs`) always run when at least one platform is present.
When stdout is a TTY and `--json` is unset, streams per-section
progress with `ora` spinners. Honors `XDG_CACHE_HOME` for the schema
cache (24h TTL). Source: `src/cli/commands/doctor.ts`.

**Remote-catalogs section (v1-task C3.14):** offline-safe diagnostic
that reports drift recorded in `registry.json` and
`skill-catalogs.json` for catalogs with a `remote` block (typically
those installed via `agent install --from <url>` or
`skill install --from <url>`). Two finding kinds:

- `catalog-behind-remote` — `lastPulledSha !== lastRemoteSha`. Means a
  prior `sync --check` saw a newer SHA upstream than the local clone.
  Run `smith agent sync <label>` (or `smith skill sync <label>`) to
  pull.
- `catalog-stale-check` — `lastCheckedAt` is more than 7 days old. The
  drift state is unknown; run `smith agent sync --all --check` to
  refresh.

The section does **not** make network calls. Live drift detection is
the job of `sync --check`; doctor's role is to surface drift that
prior `sync --check` runs (or a daemon) have already observed. Source:
`src/core/freshness/remote-catalogs.ts`.

**Duplicate-catalogs section (v1-task RC2-10):** offline pure check
that walks both registries and groups entries by
`normalizeGitUrl(remote.url)` — scheme (https/ssh/git@), case (host,
owner, repo), and trailing `.git` are normalized away. Clusters of
size ≥ 2 are reported as `warn` findings; severity never affects exit
code (duplicate links are sometimes legitimate — e.g. one managed
clone for daemon-pull plus one linked checkout for hot-editing). Each
finding lists the normalized URL plus every member's registry kind
(`agent` / `skill`), label, and `rootPath` so the user can pick which
copy to drop with `smith {agent,skill} unregister <label>`. Source:
`src/core/freshness/duplicate-catalogs.ts`.

This section primarily exists to clean up back-catalog: rc.1 did not
refuse duplicate `install --from <url>` runs, so users may have
accumulated several catalogs pointing at the same upstream. RC2-4
closes the forward door (install hard-errors); this check audits the
existing state. Malformed URLs (e.g. registry hand-edits) are silently
excluded from clustering rather than aborting the run — they still
surface in `registry-hygiene`.

**No-platform refusal:** if zero platform CLIs are on `PATH`, doctor
refuses to run, prints three install one-liners (one per platform), and
exits `2`. `--json` emits `{"error":"no-platform-detected", "message",
"exitCodeFor":2}` instead of a report envelope.

**Doctor uses an internal exit-code system distinct from the CLI
taxonomy:** `0`/`1`/`2` map to `clean`/`drift`/`network-error-or-refusal`.
This exit code is propagated verbatim from `runDoctor()` and bypasses
the `exitCodeFor()` mapping. **Doctor's `2` is NOT a usage error** —
see [Error handling](./12-error-handling.md#subsystem-exit-codes-that-dont-fit-the-taxonomy).
When OpenCode is not on `PATH`, drift and network-error sources are
unreachable, so the only routes to `2` are the no-platform refusal and
the (rare) cross-cutting network failures; without OpenCode, drift can
never raise `1`.

**Arguments:** none.

**Flags:**

- `-v, --verbose` — print full per-section detail report (pre-v0.13 default).
- `-q, --quiet` — suppress all human output; preserve exit code. Useful in CI. Mutually exclusive with `--verbose` (Commander exits with `EXIT_USAGE` = `2` if both are passed). Allowed with `--json`: `--quiet --json` still emits the full JSON envelope.
- `--offline` — skip the live OpenCode fetch; report on vendored data only.
- `--no-cache` — force a fresh fetch (bypass the 24h cache). Commander
  inverts to `opts.cache === false`.
- `--json` — emit machine-readable JSON instead of human-formatted text.
  Always includes `skippedPlatforms: PlatformId[]` listing the platforms
  whose CLIs were not on `PATH` (empty array when all four were
  detected).
- `--skip-model-resolution` — skip the model-resolution section
  (curated fallbacks + installed agents). No-op when OpenCode is absent
  (the section is already auto-suppressed).
- `--fix-knowledge-refresh` — auto-repair drift findings reported by the
  `knowledgeRefresh` section. See [Knowledge-refresh drift and auto-repair](#knowledge-refresh-drift-and-auto-repair) below.
- `--fix-knowledge-compile` — auto-repair drift findings reported by the
  `knowledgeCompile` section (re-run `smith knowledge compile <agent>`
  for each `missing-manifest` or `drift` finding). See
  [Knowledge-compile drift and auto-repair](#knowledge-compile-drift-and-auto-repair) below.

**Exit codes (doctor's internal taxonomy):**

- `0` — clean (or OpenCode absent: drift and network-error are
  unreachable without OpenCode on `PATH`).
- `1` — drift detected (requires OpenCode on `PATH`).
- `2` — network error preventing a meaningful diagnosis, **or**
  no-platform refusal (zero CLIs detected). The `--json` envelope
  distinguishes the two: refusal emits `{"error":"no-platform-detected"}`.

**Examples:**

```bash
$ smith doctor
$ smith doctor --offline
$ smith doctor --verbose                          # full audit dump (good for bug reports)
$ smith doctor --quiet || alert "doctor failed"
$ smith doctor --json | jq .skippedPlatforms     # ["claude-code","codex"]
$ env -i PATH=/usr/bin:/bin smith doctor          # refusal path, exit 2
```

**See also:** [Doctor](./10-doctor.md), [Error handling](./12-error-handling.md#subsystem-exit-codes-that-dont-fit-the-taxonomy).

#### Knowledge-refresh drift and auto-repair

The `knowledgeRefresh` section of `smith doctor` surfaces four kinds of
drift between an agent's recorded refresh consent and what is actually
installed on disk:

| Finding | Meaning | Auto-fixable by `--fix-knowledge-refresh`? |
|---|---|---|
| `missing-hook` | `refresh-manifest.json` records consent for a platform, but the corresponding hook (claude-code frontmatter block / codex `hooks.json` entry / opencode plugin registration) is not installed. | yes — internally calls `smith agent reconfigure <name> --grant <platform>`. |
| `orphaned-consent` | `refresh-manifest.json` lists a platform the agent is no longer installed on. | yes — internally calls `smith agent reconfigure <name> --revoke <platform>`. |
| `corrupt-cache` | `<cacheRoot>/agents/<agent>/sources/<source>.meta.json` is unreadable or malformed JSON. | yes — removes the bad meta file; the next refresh will repopulate it. |
| `unmanaged-codex-hooks` | `~/.codex/hooks.json` exists without the `_smith_managed` sentinel; smith refuses to touch user-owned hook config. | **no** — prints a hint to run [`smith knowledge migrate-codex`](#smith-knowledge-migrate-codex). |

The first three are repaired by routing through the existing
`reconfigureAgent` path (so the same validation and idempotency rules
apply) or, for `corrupt-cache`, by unlinking the meta file. The fourth
is intentionally manual: smith will not overwrite a hand-written hooks
file even with `--fix-…` set. Run `smith knowledge migrate-codex` to
review and claim it explicitly.

`--fix-knowledge-refresh` exits `0` when there are no findings OR all
fixable findings repaired successfully; it exits non-zero (via doctor's
internal taxonomy) if any findings remain after the repair pass —
typically a leftover `unmanaged-codex-hooks` finding.

```bash
# Diagnose only
$ smith doctor

# Diagnose and auto-repair the first three drift kinds
$ smith doctor --fix-knowledge-refresh
```

#### Knowledge-compile drift and auto-repair

The `knowledgeCompile` section of `smith doctor` (v2) audits every
registered agent that opts in to progressive compile
(`knowledge.compile.progressive: true`) and reports two kinds of drift
between the persisted `compile-manifest.json` and a fresh `compile()`
over the agent's current materialized sources. Bundles that
auto-compile under the v2.1 smart default (large corpora without an
explicit override) are not yet drift-checked here; extending coverage
is tracked as follow-up.

| Finding | Meaning | Auto-fixable by `--fix-knowledge-compile`? |
|---|---|---|
| `missing-manifest` | Bundle declares `compile.progressive: true` but `<agentSmithHome>/knowledge/<agent>/compile-manifest.json` is absent — or present but unparseable / off-schema (corrupt). The "corrupt" sub-case is conflated because the remedy (re-compile) is identical. | yes — runs `smith knowledge compile <agent>` for the affected agent. |
| `drift` | Manifest exists and parses, but its recorded `contentHash` does not match a fresh `compile()` over the agent's current `_manifest.json` materialized sources (i.e. the bundle's knowledge has changed since the last compile). | yes — runs `smith knowledge compile <agent>`. |

Both findings repair through the same path: re-run
[`smith knowledge compile <agent>`](#smith-knowledge-compile-name)
which both re-materializes sources (so any underlying source change is
picked up) and overwrites `compile-manifest.json` with a fresh hash.
Per-agent errors print and the loop continues — one bad repair does not
abort sibling repairs.

The section is informational only; findings never affect doctor's exit
code. Use the GUI's `/system/doctor` route or the CLI flag below to
trigger repair.

```bash
# Diagnose only
$ smith doctor

# Diagnose and auto-repair every missing-manifest / drift finding
$ smith doctor --fix-knowledge-compile
```

---

### `smith update`

**Synopsis:** `smith update [--dry-run]`

**Description:** Pull the latest agent-smith from `origin/main`,
install dependencies, rebuild the GUI bundle, refresh agent-smith's
knowledge directory, and run `smith doctor` to verify. Refuses to
run from a corrupt install (when `import.meta.url` does not resolve
to a workspace — should not happen under the single-mode install
where every clone lives at `~/.agent-smith/`) with a pointer to a
clean reinstall (`gh repo clone eliharoun/agent-smith ~/.agent-smith
&& bash ~/.agent-smith/bin/install`). Refuses to pull when the git
workspace is dirty (any porcelain output). Doctor's exit code is
propagated verbatim, so post-update drift surfaces. Source:
`src/cli/commands/update.ts`.

**Arguments:** none.

**Flags:**

- `--dry-run` — run `git fetch origin main` and `git rev-list --count
  HEAD..origin/main` to report how many commits would be pulled, then
  exit. Skips `bun install` and `doctor`.

**Exit codes:**

- `0` — update completed and `doctor` is clean (or `--dry-run` succeeded).
- `1` — corrupt install (workspace not resolvable); workspace is dirty;
  doctor reported drift (`1`).
- `2` — doctor reported a network error or refused to run because no
  platform CLI was detected on `PATH` (both surface as doctor exit `2`).
- `3` — partial failure. Sources: `git pull`, `git fetch`, `bun
  install`, or `bun run gui:build` failed (pipeline aborted before
  doctor ran); or the post-pull `smith agent install agent-smith`
  reinstall failed (knowledge dir refresh) but doctor returned 0; or
  the GUI build failed but doctor returned 0. The reinstall failure
  prints `Re-run: smith agent install agent-smith`; doctor's non-zero
  exit always takes precedence over a reinstall partial.

> **Migration note:** earlier versions returned `2` for `git pull` /
> `bun install` failures. The `2` → `3` move aligns with the
> partial-failure category (the pipeline is sequential, so a step
> failing mid-way leaves the system in a half-applied state). See
> [Error handling](./12-error-handling.md#update-pipeline).

**Examples:**

```bash
$ smith update --dry-run
$ smith update
```

**See also:** [Update and uninstall](./11-update-and-uninstall.md), [Doctor](./10-doctor.md).

---

## Configuration

### `smith config get [key]`

**Synopsis:** `smith config get [key]`

**Description:** Read a model-resolution config value from `~/.config/agent-smith/.env`. When a key is given, prints the raw value to stdout (or `(unset)` if the key is valid but has no value). When no key is given, prints a full config overview (detected providers, preference order, per-tier overrides).

**Args:**
| Arg | Required | Description |
|---|---|---|
| `[key]` | no | One of: `model.providers`, `model.tier.high`, `model.tier.balanced`, `model.tier.fast`. If omitted, prints the full overview. |

**Exit codes:**

- `0` — value printed (including `(unset)` for valid-but-absent keys), or full overview printed.
- `1` — invalid key.

**Example:**
```bash
$ smith config get model.providers
anthropic,github-copilot,openrouter
```

---

### `smith config set <key> <value>`

**Synopsis:** `smith config set <key> <value>`

**Description:** Write a model-resolution config value to `~/.config/agent-smith/.env`. Creates the file if absent. Overwrites existing value for the key.

**Args:**
| Arg | Required | Description |
|---|---|---|
| `<key>` | yes | One of: `model.providers`, `model.tier.high`, `model.tier.balanced`, `model.tier.fast`. |
| `<value>` | yes | Value to set. For `model.providers`: comma-separated provider names (valid: `anthropic`, `github-copilot`, `openrouter`, `amazon-bedrock`, `google-vertex-ai`, `openai`). For tier keys: `<provider>/<model>` literal. |

**Exit codes:**

- `0` — written.
- `1` — invalid key.

**Examples:**
```bash
$ smith config set model.providers "anthropic,github-copilot,openrouter"
$ smith config set model.tier.high "anthropic/claude-opus-4"
$ smith config set model.tier.balanced "github-copilot/claude-sonnet-4"
```

---

### `smith config unset <key>`

**Synopsis:** `smith config unset <key>`

**Description:** Remove a model-resolution config value from `~/.config/agent-smith/.env`. Reverts the key to auto-detection behavior. No-op if the key was already absent.

**Args:**
| Arg | Required | Description |
|---|---|---|
| `<key>` | yes | One of: `model.providers`, `model.tier.high`, `model.tier.balanced`, `model.tier.fast`. |

**Exit codes:**

- `0` — removed (or was already absent).
- `1` — invalid key.

**Example:**
```bash
$ smith config unset model.tier.high
```

**See also:** [Models](./07-models.md) for the full resolution pipeline, provider table, and curated fallbacks.

---

## Daemon

### `smith daemon start`

**Synopsis:** `smith daemon start`

**Description:** Spawn the daemon detached and verify startup before
returning. If `~/.local/state/agent-smith/daemon.pid` exists and that
process is alive, prints `Daemon already running <pid>` and exits `0`.
A stale pid file is overwritten. After spawning, polls
`daemon.heartbeat.json` every 100ms for up to 10s; success requires the
heartbeat's `pid` to match the spawned child and `lastBeatAt` to be no
older than 7s. If the child dies during polling or the deadline
elapses, the daemon is killed (SIGTERM on timeout) and the pid file
removed. Source: `src/cli/commands/daemon.ts` (`daemonStartImpl` + `daemonStart`).

**Arguments:** none.

**Flags:** none.

**Exit codes:**

- `0` — started (or already running).
- `1` — spawn failed; child exited during startup; startup timeout.

**Examples:**

```bash
$ smith daemon start
Daemon started 91823
```

**See also:** [Daemon](./09-daemon.md).

---

### `smith daemon stop`

**Synopsis:** `smith daemon stop`

**Description:** Stop the daemon politely, then forcefully if it does
not cooperate. Algorithm: send `SIGTERM`, poll `isAlive` for up to 10s,
then `SIGKILL` if still running plus a 500ms grace before removing the
pid file. **Always exits `0`** — from the operator's perspective, a
force-killed daemon is still a stopped daemon. The `Daemon force-killed`
message goes to stderr so it stays visible. Source:
`src/cli/commands/daemon.ts` (`daemonStop` + `daemonStopImpl`).

**Arguments:** none.

**Flags:** none.

**Exit codes:**

- `0` — daemon stopped (gracefully or via SIGKILL); not running; stale
  pid file removed.

**Examples:**

```bash
$ smith daemon stop
Daemon stopped 91823
```

**See also:** [Daemon](./09-daemon.md).

---

### `smith daemon status`

**Synopsis:** `smith daemon status`

**Description:** Three-state report: `not running` (no pid file),
`running <pid>` (pid file exists and the process answers signal `0`),
or `stale pid file <pid>` (pid file exists but the process is gone).
Source: `src/cli/commands/daemon.ts` (`daemonStatus` + `daemonStatusImpl`).

**Arguments:** none.

**Flags:** none.

**Exit codes:**

- `0` — status printed.

**Examples:**

```bash
$ smith daemon status
running 91823
```

**See also:** [Daemon](./09-daemon.md).

---

### `smith daemon run`

**Internal — not for direct user invocation.** Used by `smith daemon
start` to spawn the foreground worker. Documented here for completeness.

**Synopsis:** `smith daemon run`

**Description:** Run the daemon in the foreground. Honors two
environment overrides for operator smoke-testing:

- `SMITH_PULL_INTERVAL_MS` — git-pull cadence in ms (default 15min).
- `SMITH_HEARTBEAT_INTERVAL_MS` — heartbeat write cadence in ms.

Invalid or non-positive values are silently ignored, leaving production
defaults in force (`src/index.ts`).

**Arguments:** none.

**Flags:** none.

**Exit codes:**

- `0` — daemon exited cleanly.
- `1` — runtime error inside the daemon loop.

**Examples:**

```bash
$ SMITH_PULL_INTERVAL_MS=5000 smith daemon run
```

**See also:** [Daemon](./09-daemon.md).

---

## See also

- [Error handling](./12-error-handling.md) — exit-code taxonomy, the
  `✗ smith <subcommand>: <headline>` format, and the `wrap()` shim.
- [Paths and state](./13-paths-and-state.md) — every file each command
  reads or writes.
- [Registries and catalogs](./08-registries-and-catalogs.md) — how
  `register`/`skill register` are different and why.
