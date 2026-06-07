# Registries and catalogs

> How smith discovers agent bundles and skill bundles. Two parallel registries, two state files, two sets of commands. Read this when you need to add an external source of agents or skills, understand the precedence rules, or recover from a missing-source drift.

---

## Mental model

Smith keeps **two registries** on disk. They are structurally parallel but intentionally separate.

| Registry | State file | What it lists | Consumers |
|---|---|---|---|
| Agent registry | `~/.config/agent-smith/registry.json` | Directories of agent bundles (each subdir holds an `agent.config.json`) | `smith agent install`, `smith agent install-all`, `smith agent list`, daemon |
| Skill registry | `~/.config/agent-smith/skill-catalogs.json` | Directories of skill bundles (each subdir holds a `SKILL.md`) | `smith skill install`, `smith skill list`, doctor's skill checks |

The two registries are decoupled because their schemas, lifecycles, and consumers differ:

- **Agent bundles** are rendered and installed (per-platform `.md` files). The agent registry feeds the install pipeline.
- **Skill bundles** are referenced in place by `smith skill install`, then **copied** (not symlinked) into per-platform skill directories. The skill registry feeds skill discovery.

A **catalog** is a single registered entry — a directory containing one or more bundles. The terms "source" (older code) and "catalog" (current user-facing copy) refer to the same thing in the agent half. The skill half uses "catalog" everywhere.

```
                            ┌────────────────────────────┐
   register a directory ──> │ registry.json (agents)     │ ──> smith agent install
                            │ skill-catalogs.json (skill)│ ──> smith skill install
                            └────────────────────────────┘
```

The two registries even use **different kind vocabularies**, which is the most common point of confusion:

| Registry | Allowed `kind` values | Source |
|---|---|---|
| Agent | `user-global`, `project`, `registered` | `src/core/types.ts` |
| Skill | `user-global`, `user-local`, `team-shared` | `src/io/skill-registry.ts` |

`atlassian-skills` is the default-registered protected catalog and cannot be assigned by `smith skill register` (`src/cli/commands/skill/register.ts`).

---

# Part one — the agent registry

## What it is

The agent registry tracks every directory smith should scan for `agent.config.json` bundles. On a fresh install (after `smith init`), the persisted registry contains one entry: the user-global directory at `~/.config/agent-smith/agents`. At resolve time, `resolveAllSources` (`src/io/registry.ts`) appends a **synthetic self-source** pointing at the running CLI's bundled `agents/` directory, so `agent-smith` itself is always discoverable without manual `smith agent register`. See [The synthetic self-source](#the-synthetic-self-source) below.

State file: `~/.config/agent-smith/registry.json`. Schema: `{ schemaVersion: 2, sources: Source[] }` where `Source` is `{ kind, rootPath, label, gitRemote?, remote? }` (`src/io/registry.ts`, `src/core/types.ts`). Legacy `version: 1` is accepted on read only; the writer always emits `schemaVersion: 2`.

The default seed is created in-memory by `defaultRegistry()` (`src/io/registry.ts`); the file is only written once you run an actual mutation (`smith agent register`, `smith init`, etc.).

### The synthetic self-source

`resolveAllSources` is the resolver every install/list/validate path goes through. It returns the persisted registry's sources **plus** one synthetic `Source` carrying the fixed label `agent-smith-self` (`SELF_SOURCE_LABEL`, `src/io/registry.ts`) and `rootPath` set to the running CLI's bundled `agents/` directory (typically `~/.agent-smith/agents`). The synthetic is computed on the fly and **never persisted** to `registry.json`.

Consequences:

- `smith agent install agent-smith` works on a fresh install, before the user runs any `smith agent register` command. The from-source installer (`bin/install`, Step 9) relies on this; under an `npm install -g @eliharoun/agent-smith`, running `smith agent install agent-smith` manually exercises the same code path against the npm-installed bundle.
- If you have **also** registered the same path as a `user-global` or `project` source — for example by cloning the repo into `~/.config/agent-smith/agents/` — the `collision` check inside `resolveAllSources` (`src/io/registry.ts`) drops the synthetic source so the bundle is not loaded twice. (As of the bootstrap consolidation, `scripts/bootstrap.ts` no longer touches agents at all — it installs only the bundled skills — so the synthetic-source dedup is the sole mechanism preventing double-load of the persona.)
- `smith agent list` shows the synthetic source's bundles tagged `(agent-smith-self, registered)`. The `registered` kind is what the synthetic carries; the label disambiguates it from real `registered` catalogs.
- `smith status` does **not** currently surface the synthetic source in its `Agent catalogs` table — only persisted sources show up there. To see it, run `smith agent list`.

### Kinds and precedence

Three agent-catalog kinds, ordered from highest to lowest precedence (lower number wins):

| Kind | Typical use | Precedence |
|---|---|---|
| `project` | An `agents/` directory inside a project repo | 0 (highest) |
| `user-global` | Your personal `~/.config/agent-smith/agents/` | 1 |
| `registered` | An external git-tracked catalog | 2 (lowest) |

Source: `src/io/orchestrator.ts`.

If two catalogs define an agent with the same `name`, the higher-precedence catalog wins and smith warns at install time. Use this to override a team-shared agent with a personal copy by registering your local directory as `project`.

## Commands

### `smith agent register <path>`

Add a directory to the agent registry.

```bash
# A local directory of bundles
smith agent register ~/code/team-agents --kind project --label "team-agents"

# A git-tracked catalog the daemon can pull
smith agent register ~/code/shared-agents \
  --kind registered \
  --git-remote https://github.com/your-org/shared-agents.git \
  --label "shared"
```

Flags:

- `--kind <user-global|project|registered>` — required.
- `--label <string>` — optional, defaults to `<kind>:<absolutePath>`.
- `--git-remote <url>` — optional. When set, smith verifies the path is a git repo and that one of its remotes matches the URL.
- `--allow-empty` — bypass the "no agent bundles" check.
- `--skip-git-check` — bypass the git-repo / remote-URL match check.

Validation (`src/cli/commands/register.ts`):

- Non-existent paths are rejected.
- If the path looks like a **skill catalog** (has `SKILL.md`-rooted subdirectories and zero `agent.config.json` files), the error suggests `smith skill register` instead and includes a ready-to-paste command (lines 40-50).
- A path with no `agent.config.json` subdirectories is rejected unless `--allow-empty` is set.
- With `--git-remote`, the path must be a git repo whose remotes include the URL. `--skip-git-check` bypasses both checks.

Exit codes: `0` on success, `1` on validation failure.

Once registered, you can scaffold bundles directly into the catalog with `smith agent init --catalog <label>` (see [CLI reference § smith agent init](./14-cli-reference.md#smith-agent-init-name) and [Sharing & distribution § 2.2](./15-sharing-and-distribution.md#22-scaffold-into-the-catalog-directory)).

### `smith agent unregister <path-or-label>`

Remove an entry by **label** or **path**. The argument is matched as a label first, with a fallback to `rootPath` for path-shaped inputs (`src/cli/commands/unregister.ts`). Path-shaped inputs (absolute, `./` / `../` prefixed, or containing a `/`) are normalized via `path.resolve()` so `register X` and `unregister X` round-trip regardless of relative vs absolute spelling. Symmetric with the long-standing `smith skill unregister <path-or-label>` behavior.

```bash
smith agent unregister team-agents             # by label
smith agent unregister ~/code/team-agents      # by path (resolved)
```

If no entry matches, smith exits `1` with a `not-found` error whose `what` field reports which lookup branch (`agent catalog (looked up by path)` vs `agent catalog (looked up by label)`) tried to match, plus a `Try: smith agent list` suggestion.

`agent unregister` does **not** uninstall any agents that were previously installed from that catalog. Their rendered files remain on each platform; `smith agent list` will simply stop showing them. To remove the rendered files, run `smith agent uninstall <name>` per agent (or `smith agent uninstall-all`) **before** unregistering, while smith can still locate them.

#### Label uniqueness on register

`smith agent register` rejects a duplicate label across distinct paths with an `already-exists` SmithError (`src/io/registry.ts`):

```text
✗ smith agent register: agent catalog label already exists: team
  Try: smith agent register <path> --as <other-label>
```

This is enforced when **adding** a new source. Pre-existing duplicates in `registry.json` (from before this guard was added) are tolerated on load — the validator does not retroactively reject them. Run `smith agent list` to spot any, then `smith agent unregister <label>` + `smith agent register <path> --as <other-label>` to clean up.

### `smith agent list`

Walk every registered catalog, load every bundle, and print one line per agent.

```bash
smith agent list
```

Output format (`src/cli/commands/list.ts`):

```text
my-agent (user-global) → opencode, claude-code, codex, kiro
shared-thing (registered) → opencode
```

Each row: `<name>` `(<kind>)` `→` `<comma-separated targets>`. Empty registry prints `(no agents found in any catalog)` and exits `0`.

`agent list` does not annotate which agents are installed vs which are merely discoverable — see the [doctor spoke](./10-doctor.md) for installed-state checks.

### smith agent catalogs

Lists registered agent catalog sources. See [CLI reference](14-cli-reference.md#smith-agent-catalogs) for full details. Symmetric to `smith skill catalogs`.

### `smith agent catalog rename <old-label> <new-label>`

Rename a registered agent catalog's label without re-registering. Useful when a catalog's display label needs to change after registration. The on-disk path stays the same; only the registry's stored label updates.

```bash
smith agent catalog rename old-name new-name
```

See [guide/14 — agent catalog rename](./14-cli-reference.md) for full details.

### `smith status`

Print both registries side-by-side. This is the canonical way to inspect the registry state without parsing JSON.

```bash
smith status
```

Sample output (`src/cli/commands/status.ts`):

```text
agent-smith status
Registry: /Users/you/.config/agent-smith/registry.json
USER.md:  /Users/you/.config/agent-smith/USER.md
Agent catalogs (2):
  - [user-global] /Users/you/.config/agent-smith/agents (user-global)
  - [registered] /Users/you/code/shared-agents (shared)
Skill catalogs (2):
  - [team-shared] (atlassian-skills) [protected] (not yet cloned)
  - [user-local] /Users/you/code/personal-skills (personal)
```

Field layout per row: `- [<kind>] <rootPath> (<label>)[ [<flags>]]`. Flag annotations (`protected`, `adhoc`) only appear on skill catalogs.

`status` is read-only and never fails on registry content; it only fails if a registry file is corrupt.

---

# Part two — the skill registry

## What it is

The skill registry tracks every directory smith should scan for `SKILL.md`-rooted skill bundles. State file: `~/.config/agent-smith/skill-catalogs.json`. Schema: `{ schemaVersion: 2, catalogs: SkillCatalog[] }` (`src/io/skill-registry.ts`). Legacy `version: 1` is accepted on read only; the writer always emits `schemaVersion: 2`.

A `SkillCatalog` carries:

```ts
{
  kind: "user-global" | "user-local" | "team-shared",
  rootPath: string,
  label: string,        // unique within the registry
  gitRemote?: string,
  adhoc?: boolean,      // auto-created by `smith skill install --from`
  protected?: boolean,  // smith depends on it; unregister rejects
  remote?: {            // git provenance for catalogs cloned via `--from <url>`
    url: string,
    ref: string,
    lastPulledSha?: string,
    lastPulledAt?: string,
    lastRemoteSha?: string,
    lastCheckedAt?: string,
  },
}
```

Source: `src/io/skill-registry.ts`.

For a typical skill-catalog directory layout, the skill-as-resource model, `requires.skills`, and the install/update/uninstall lifecycle, see the [skills spoke](./05-skills.md). This spoke covers only the **registry plumbing**.

### The `atlassian-skills` catalog

Smith ships with one default-registered skill catalog: `atlassian-skills`, lazy-cloned from https://github.com/langpingxue/atlassian-skills (MIT-licensed) (`src/io/skill-registry.ts`). It is:

- **Auto-injected** on every `loadSkillRegistry()` call. Even if you hand-edit `skill-catalogs.json` to remove it, smith splices it back in-memory at load time and the next mutation persists the corrected state (`src/io/skill-registry.ts`).
- **Protected** (`protected: true`). `smith skill unregister atlassian-skills` is rejected with `"Catalog 'atlassian-skills' is protected (smith depends on it) and cannot be unregistered"` (`src/io/skill-registry.ts`).
- **Lazy-cloned**. The clone happens on first reference (e.g. `smith skill install atlassian-skills/atlassian-readonly-skills`). Until then, `smith skill catalogs` shows `(not yet cloned)`.

### Catalog flavors

Beyond the protected built-in, two flags distinguish three operational flavors:

| Flavor | `protected` | `adhoc` | Created by | Visible in `skill catalogs` | Visible in `skill list` |
|---|---|---|---|---|---|
| Built-in | `true` | — | smith itself | yes | yes |
| Regular | — | — | `smith skill register <path> --kind <k>` | yes | yes |
| Ad-hoc | — | `true` | `smith skill install --from <path>` (auto-registers a synthetic catalog) | yes | only with `--all` |
| Remote-backed | — | — | `smith {agent,skill} install --from <url>`; the underlying clone lives at `<runtimeStateHome>/remote/<host>/<owner>/<repo>` and `smith {agent,skill} sync` updates it | yes | yes |

If you have rc.1-era clones at `<configDir>/remote/...`, run `smith migrate-clones` to relocate them to `<runtimeStateHome>/remote/...`. See [guide/13 — Path migration](./13-paths-and-state.md) for the rc.1 → rc.2 history.

## Commands

### `smith skill catalogs`

List **every** registered catalog, including `atlassian-skills` and any ad-hoc catalogs.

```bash
smith skill catalogs
```

Source: `src/cli/commands/skill/catalogs.ts`. The implementation iterates `reg.catalogs` directly with no filtering. Each row prints:

```text
<label> [<kind>] → <rootPath> (<flags>)
```

where `<flags>` is a parenthesized list of any active markers (`protected`, `adhoc`). Empty registry prints `(no catalogs registered)` — note that an empty registry is unusual because `atlassian-skills` is auto-injected on load.

> **Older docs claimed `smith skill catalogs` filters out `atlassian-skills`. That is not true.** It lists every catalog. The flag column is how you tell them apart.

### `smith skill list`

Walk visible catalogs, discover skills, and print one line per skill.

```bash
smith skill list           # default: skip ad-hoc catalogs
smith skill list --all     # include ad-hoc catalogs too
```

Source: `src/cli/commands/skill/list.ts`. The visibility filter is exactly:

```ts
const visible = reg.catalogs.filter((c) => opts.all || !c.adhoc);
```

That is: **the filter checks the `adhoc` boolean flag**. It is **not** keyed on the `atlassian-skills` label, the catalog kind, or the protected flag. The built-in `atlassian-skills` catalog is always visible because its `adhoc` flag is unset.

For each visible catalog, smith calls `discoverSkills(catalog)` and aggregates the results, printing `<name> [<catalogLabel>] — <description excerpt>` per skill, sorted alphabetically. Discovery errors per catalog become a yellow `warning:` line; the command continues with the remaining catalogs and exits `0`.

### `smith skill register <path>`

Add a directory to the skill registry.

```bash
smith skill register ~/code/team-skills --kind team-shared --label team
smith skill register ~/code/personal-skills --kind user-local
```

Flags (`src/cli/commands/skill/register.ts`):

- `--kind <user-global|user-local|team-shared>` — required. `atlassian-skills` is reserved as the protected catalog label.
- `--label <string>` — optional, defaults to `<kind>:<absolutePath>`. Must be unique across the registry; collision throws `Catalog label '<label>' already in use` (`src/io/skill-registry.ts`).
- `--git-remote <url>` — optional remote-URL verification.
- `--allow-empty` — bypass the "no skills" check.
- `--skip-git-check` — bypass git verification.

Validation mirrors the agent side, with reciprocal sniffing: a directory that looks like an **agent catalog** (has `agent.config.json` subdirectories and zero `SKILL.md` files) is rejected with a `Did you mean \`smith agent register\`?` suggestion (`src/cli/commands/skill/register.ts`).

Successful register prints `Registered skill catalog "<label>" at <path>`. Exit `0` on success, `1` on validation failure.

### `smith skill unregister <pathOrLabel>`

Remove a catalog by **label** or **path**. The disambiguation heuristic (`src/cli/commands/skill/unregister.ts`):

- Inputs starting with `/`, `.`, or containing `/` are treated as paths and resolved with `path.resolve()`.
- Everything else is treated as a label.

This means a bare identifier like `atlassian-skills` is always a label lookup, so the protected check fires correctly regardless of CWD.

```bash
smith skill unregister team                    # by label
smith skill unregister ~/code/team-skills      # by path
smith skill unregister atlassian-skills        # rejected: protected
```

The underlying `removeCatalog()` matches by `label === key || rootPath === key` and refuses removal only when the matched catalog is `protected` (`src/io/skill-registry.ts`):

```ts
if (match.protected) {
  throw new Error(
    `Catalog '${match.label}' is protected (smith depends on it) and cannot be unregistered`,
  );
}
```

> **Important — older docs claimed unregister refuses catalogs whose skills are still installed. That is not true.** The only refusal is the `protected` check. If you unregister a regular catalog while skills installed from it remain in `installed-skills.json`, those skills are not deleted from any platform. Their install records simply become **drift** with status `source-missing` (see below).

Exit codes: `0` on success, `1` if no matching catalog (`not-found` SmithError) or if the catalog is protected.

### `smith skill catalog rename <old-label> <new-label>`

Rename a registered skill catalog's label without re-registering. The on-disk path stays the same; only the registry's stored label updates. Mirrors the agent-side `smith agent catalog rename`.

```bash
smith skill catalog rename old-team-skills team-skills
```

See [guide/14 — skill catalog rename](./14-cli-reference.md) for full details.

### Ad-hoc registration via `smith skill install --from`

`smith skill install --from <path>` synthesizes a one-skill catalog and **auto-registers it** with `adhoc: true` so subsequent `update`/`uninstall` calls can find the source again. See the [skills spoke](./05-skills.md#subcommands) for the install command itself; from a registry standpoint, the side-effect to know about is:

- A new catalog appears in `skill-catalogs.json` with `adhoc: true`.
- `smith skill catalogs` shows it (with the `(adhoc)` flag).
- `smith skill list` hides it by default; `--all` reveals it.
- `smith skill uninstall <name>` auto-prunes the synthetic catalog when the last skill from it is uninstalled.

---

## Drift: when the source disappears

Skill installs are recorded in a separate file, `~/.config/agent-smith/installed-skills.json`, with a content hash and the absolute `sourcePath` they were copied from (`src/io/installed-skills.ts`). Removing a skill catalog from `skill-catalogs.json` does **not** touch the install records — it just makes those records unresolvable.

Doctor surfaces this gap via the `skill-drift` section. Each install record gets a status (`src/core/freshness/types.ts`, `src/core/freshness/run-doctor.ts`):

| Status | Meaning |
|---|---|
| `ok` | Source content hash matches the recorded hash. |
| `drift` | Source has changed since install. Run `smith skill update <name>`. |
| `missing` | The platform-side install file is gone (manual delete). Run `smith skill install <name>` to repair. |
| `source-missing` | The source dir referenced by the install record is gone. Update will fail until the source catalog is restored. |

> **Callout — the `source-missing` lifecycle.**
>
> 1. You install a skill from a registered catalog. `installed-skills.json` records the absolute `sourcePath`.
> 2. You run `smith skill unregister <catalog>` (or delete the directory on disk). Smith does **not** prevent this; it does **not** uninstall the platform copies.
> 3. The skill remains on disk under each platform's skill directory. It still works at runtime.
> 4. `smith doctor` reports `source-missing` for that skill.
> 5. `smith skill update <name>` fails because the source is gone.
> 6. To recover, either re-register the original catalog at the original path, or `smith skill uninstall <name>` to drop the install record and the platform copies.

Drift detection is informational only — it never affects the doctor exit code. See the [doctor spoke](./10-doctor.md#the-ten-sections) for the full skill-drift section behavior and the [skills spoke](./05-skills.md#drift-and-doctor) for the skill-side view of remediation.

---

## Caveats and gotchas

- **Two state files, two corruption modes.** A malformed `registry.json` raises `registry-corrupt-json` (`src/io/registry.ts`); a malformed `skill-catalogs.json` raises `Invalid skill registry at <path>: malformed JSON (...)` (`src/io/skill-registry.ts`). Both are fatal — most commands won't run until you fix or delete the file.
- **Version mismatch is fatal.** Both registries pin `schemaVersion: 2` (current). Loading a file with an unrecognized version throws `registry-version` / `skill-registry-version`. Legacy `version: 1` is accepted on read and migrated in-memory; there is no other auto-migration.
- **Atomic writes on both sides.** Both `saveRegistry` and `saveSkillRegistry` use `atomicWriteJson` (stage-to-temp + rename). A crash mid-write cannot leave a half-written registry file.
- **Duplicate-detection symmetry.** Adding the same `(kind, rootPath)` pair is a silent no-op in both registries (the existing entry is kept). Both registries additionally reject duplicate **labels** — the skill registry via `addCatalog` (`src/io/skill-registry.ts`) and the agent registry via `addSource` (`src/io/registry.ts`) which throws `already-exists` on label collision.
- **Path normalization for round-trips.** Both `register` and `unregister` call `path.resolve()` on user input. `register ./foo` followed by `unregister ./foo` works regardless of CWD changes. The skill side's path-vs-label heuristic also resolves paths but never resolves labels.
- **Unregister leaves rendered output behind.** This applies to both halves: `smith agent unregister` doesn't delete agent install files, and `smith skill unregister` doesn't delete skill install files. Use the corresponding `agent uninstall` command first if you want a clean removal.
- **The defensive bootstrap re-injection.** If you delete the `atlassian-skills` entry from `skill-catalogs.json` by hand, smith silently re-injects it on the next load (`src/io/skill-registry.ts`) but does not re-save until the next genuine mutation. This means `cat skill-catalogs.json` can disagree with `smith skill catalogs` until you run a `register`/`unregister`/`install` that triggers a write.

---

## See also

- [Skills](./05-skills.md) — the skill model itself, `requires.skills`, and the install/update/uninstall lifecycle that consumes the skill registry.
- [Installing and rendering](./03-installing-and-rendering.md) — what `smith agent install` does with the agent registry's contents.
- [Doctor](./10-doctor.md#the-ten-sections) — the `registry-hygiene` section that flags catalogs whose path is gone, contains no bundles, or whose `--git-remote` no longer matches.
- [Doctor — skill drift](./10-doctor.md#the-ten-sections) — `source-missing` reporting and remediation guidance.
- [Paths and state](./13-paths-and-state.md) — full file inventory including both registry files and `installed-skills.json`.
- [CLI reference](./14-cli-reference.md) — every flag and exit code for `agent register`, `agent unregister`, `agent list`, `status`, `skill register`, `skill unregister`, `skill list`, `skill catalogs`.
