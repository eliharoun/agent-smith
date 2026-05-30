# Skills

> Skill catalogs, skill installs, and the `requires.skills` declaration that
> ties an agent to its runtime skill dependencies. Read this when you want to
> register a directory of skills, install or update individual skills across
> the four platforms, diagnose drift, or wire an agent's `agent.config.json`
> to require specific skills at install time.

Skills follow the [Anthropic open Agent Skills format](https://www.anthropic.com/news/agent-skills):
a directory rooted on a `SKILL.md` file with optional companion files
(`scripts/`, `references/`, `assets/`, etc.). Smith manages skills as
first-class lifecycle objects — registered, listed, installed, updated,
uninstalled — and ships them across all four platforms (OpenCode, Claude
Code, Codex, Kiro) from a single source of truth.

> **Tip — browser GUI.** `/skills` in `smith gui` lists installed skills with drift status; `/skills/:name` opens an editor for `SKILL.md` and surfaces a **Validate** button that runs `smith skill validate <name>`. See [README → Browser GUI](../README.md#browser-gui-smith-gui).

## Mental model

A **skill catalog** is a directory containing one or more skills. Discovery
is recursive: `discoverSkills` walks subdirectories depth-first, stops at any
directory containing a `SKILL.md` (treating it as a skill boundary — it won't
descend further), and skips `.git`/`node_modules`. This means nested layouts
like `catalog/group/<skill>/SKILL.md` are discovered correctly. A typical
catalog layout:

```
my-skills/
├── analyze-logs/
│   ├── SKILL.md
│   └── helper.py
├── format-output/
│   └── SKILL.md
└── runbook-template/
    ├── SKILL.md
    └── templates/
        └── pager.md
```

Smith keeps two state files for skills:

| File | Role |
|---|---|
| `~/.config/agent-smith/skill-catalogs.json` | registered catalogs (where skills come from) |
| `~/.config/agent-smith/installed-skills.json` | install records with content hashes (where they ended up + drift detection) |

The schema for each is at `src/io/skill-registry.ts`
(`SkillCatalog` / `SkillRegistry`) and `src/io/installed-skills.ts`
(`InstalledSkill` / `InstalledSkillsFile`). Both files are version-tagged
(`schemaVersion: 2` for `skill-catalogs.json`; legacy `version: 1` accepted
on read only) and atomically rewritten on mutation
(stage-to-temp + `rename(2)` — see `src/io/skill-registry.ts`).

`installed-skills.json` returns an empty document when missing
(`src/io/installed-skills.ts`) so a fresh install never has to seed it.

### The `atlassian-skills` catalog

`loadSkillRegistry()` always re-injects the `atlassian-skills` catalog into
the in-memory registry on read (`src/io/skill-registry.ts`). It is
default-registered, lazy-cloned from https://github.com/langpingxue/atlassian-skills
(MIT-licensed), and marked `protected: true`. Two bundles are available:
`atlassian-skills` (full read/write, 45 functions) and `atlassian-readonly-skills`
(27 read-only functions, recommended). Three consequences:

- It is never written to disk by smith on load (only persisted if a real
  mutation happens later).
- `smith skill register` rejects registering a catalog with the same label
  (`src/cli/commands/skill/register.ts`) — defense-in-depth on top of
  the commander `.choices()` filter.
- `smith skill unregister` refuses to remove the catalog (`removeCatalog`
  throws on `protected`, `src/io/skill-registry.ts`).

`smith skill catalogs` lists every catalog including `atlassian-skills`
(it shows up flagged `(protected)`). `smith skill list` filters out
ad-hoc catalogs by default — pass `--all` to include skills from
catalogs auto-created by `smith skill install --from`.

**Python prerequisite:** The atlassian-skills bundles require Python 3.9+
and `pip install requests python-dotenv`. `smith doctor` checks for the
Python runtime when atlassian-skills is installed.

### Bundled skills

Agent-smith ships with two bundled skills installed by `smith skill bootstrap` (and by the `bun install` postinstall hook):

- **`the-architect`** — the eight-question authoring workflow for designing new agent bundles (identity, expertise, voice, targets, model, mode, permissions, skills). Used by the `agent-smith` companion agent and available to any agent that requests it.
- **`the-keymaker`** — the skill-authoring workflow for creating, improving, and validating agent skills. Installed alongside `the-architect` and available to any agent that needs to author or refine skills.

### Skill refs

A skill **ref** is one of:

- `<catalog>/<name>` — explicit, always unambiguous.
- `<name>` alone — only valid when the name resolves to exactly one skill
  across all registered catalogs.

Most subcommands accept either form. `smith skill uninstall` accepts only
the bare name: once a skill is installed it is identified by its install
record (`installed-skills.json`), not by the catalog it came from.

The kind vocabulary for skill catalogs (`user-global | user-local |
team-shared`) differs from the agent registry's vocabulary (`user-global |
project | registered`). They are independent taxonomies; see
[guide/08-registries-and-catalogs.md](./08-registries-and-catalogs.md) for the
explanation.

## Subcommands

### `smith skill register <path>`

Registers a directory as a skill catalog.

```bash
smith skill register ~/code/team-skills --kind team-shared --label team
smith skill register ~/code/personal-skills --kind user-local
smith skill register ~/code/empty-catalog --kind user-local --allow-empty
smith skill register ~/code/from-git --kind team-shared \
    --git-remote git@github.com:yourcompany/team-skills.git
```

Required flag: `--kind <user-global | user-local | team-shared>`. The
The `atlassian-skills` label is reserved for the built-in catalog.

| Flag | Default | Effect |
|---|---|---|
| `--label <str>` | `<kind>:<absPath>` | human-readable label used everywhere; must be unique within the registry |
| `--git-remote <url>` | none | path must be a git repo whose remotes include this URL |
| `--allow-empty` | off | bypass the "catalog has no skills" rejection |
| `--skip-git-check` | off | bypass `--git-remote` verification (still records the remote) |

Validation (`src/cli/commands/skill/register.ts`):

- Path must exist (`sniffPath` rejects missing).
- Sniff-path disambiguation: if the path has 0 immediate `SKILL.md`-rooted
  subdirs but ≥1 `agent.config.json`-rooted subdirs, the error suggests
  `smith agent register ... --kind registered` instead — likely the user reached
  for the wrong subcommand.
- Path with 0 skills is rejected unless `--allow-empty`.
- `--git-remote` requires the path to be a git repo with a matching remote
  unless `--skip-git-check` is set.
- Label collision throws (`addCatalog`, `src/io/skill-registry.ts`).

Exit codes: 0 on success; 1 on validation failure or label collision; 2 on
unknown `--kind` value (commander usage error).

### `smith skill unregister <path-or-label>`

Removes a registered catalog by label or by absolute path.

```bash
smith skill unregister team
smith skill unregister ~/code/team-skills
smith skill unregister ./local-skills
```

Path-vs-label heuristic (`src/cli/commands/skill/unregister.ts`):
the input is treated as a path if it starts with `/`, starts with `.`, or
contains `/`. Anything else is a label lookup. This keeps a bare identifier
like `atlassian-skills` from being mis-resolved as `./atlassian-skills`
relative to CWD.

Refuses to remove the `atlassian-skills` catalog and any other catalog
marked `protected` (`removeCatalog` throws — `src/io/skill-registry.ts`).

There is currently **no check** that prevents unregistering a catalog
whose skills are still installed. The installed skills remain in
`installed-skills.json` and on the platform-side skill dirs; they will
report `source-missing` drift on the next `smith doctor` run. If you
want to remove the catalog cleanly, uninstall its skills first:

```bash
smith skill list                       # find skills from the catalog
smith skill uninstall <name>           # for each
smith skill unregister <label-or-path>
```

Exit codes: 0 on success; 1 if the catalog isn't found or is protected.

### `smith skill list`

Walks every visible catalog and prints one line per discovered skill,
sorted by skill name.

```
analyze-logs [team] — Tails recent log files and surfaces error lines
format-output [personal] — Renders structured output as fenced markdown
the-architect [atlassian-skills] — Designs new agent bundles
```

Format: `<name> [<catalogLabel>] — <description>` (description truncated to
60 chars; from the skill's frontmatter — `src/cli/commands/skill/list.ts`).

| Flag | Default | Effect |
|---|---|---|
| `--all` | off | also show skills from ad-hoc catalogs (those auto-created by `smith skill install --from`) |

Per-catalog discovery errors are reported as yellow warnings to stderr and
are non-fatal — `list` continues with the remaining catalogs
(`src/cli/commands/skill/list.ts`).

Exit code: always 0 (warnings don't change the exit).

### `smith skill catalogs`

Lists registered catalogs only (no skills walking).

```
team [team-shared] → /Users/me/code/team-skills
personal [user-local] → /Users/me/code/personal-skills (adhoc)
the-architect-source [user-local] → /Users/me/code/architect (protected)
```

Format: `<label> [<kind>] → <rootPath>` plus a `(protected, adhoc)` flag
suffix where applicable. `atlassian-skills` is included in this listing —
unlike most other commands — because it's the canonical place to confirm
what's registered. (Older versions filtered it; the current implementation
does not — see `src/cli/commands/skill/catalogs.ts`.)

Exit code: always 0.

### `smith skill install [ref]`

Installs a skill into every (or selected) platform's skill directory.

```bash
# Catalog-resolved install
smith skill install the-architect              # bare name (must be unambiguous)
smith skill install atlassian-skills/atlassian-readonly-skills           # explicit catalog/name

# Ad-hoc install from a local path
smith skill install --from ~/code/my-skill --as personal
smith skill install --from ~/code/my-skill     # auto-derives catalog label

# Restrict to specific platforms
smith skill install the-architect --targets opencode,codex
```

| Flag | Default | Effect |
|---|---|---|
| `[ref]` (positional) | — | `<name>` or `<catalog>/<name>`; mutually exclusive with `--from` |
| `--from <pathOrUrl>` | — | install from a local path or a git URL (`https://`, `ssh://`, `git@`, `file://`); auto-creates an ad-hoc catalog. For git URLs, clones the repo, registers it, and discovers skills. |
| `--as <name>` | derived | label for the auto-created ad-hoc catalog (only meaningful with `--from`) |
| `--targets <list>` | all 4 platforms | comma-separated subset of `opencode,claude-code,codex,kiro` |
| `--git-ref <ref>` | remote HEAD | Git branch/tag/SHA to clone when `--from` is a URL |
| `--all` | off | install every skill discovered in `--from <url>` |
| `--skills <list>` | — | comma-separated skill names to install from `--from <url>` |
| `--json` | off | discover skills from `--from <url>`, print JSON, do not install |

> **Note:** `--from <url>` registers the cloned catalog on install (register-on-install). Discovery alone (e.g. `--json`) does NOT register the catalog; only a successful install persists the registry entry.

Path-traversal guards on the ref (`src/cli/commands/skill/install-cmd.ts`):

- Absolute path → suggests `--from <path>` (the user almost certainly meant
  ad-hoc install).
- Contains `..`, `\`, leading `.`, or more than one `/` → rejected as an
  invalid skill name.

Skill names (the post-`/` segment) must satisfy `SAFE_SKILL_NAME_RE`
(`src/io/skill-installer.ts`):

```
^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$ | ^[a-z0-9]$
```

That is: kebab-case, max 64 chars, no leading/trailing hyphen, no slashes,
no dots, no backslashes, no `..`. The installer revalidates the name
internally even if the CLI already passed it (defense in depth — see
`isSafeSkillName`, `src/io/skill-installer.ts`).

What `installSkill()` does (`src/io/skill-installer.ts`):

1. **Resolve the source.** Either looks up `<name>` (or `<catalog>/<name>`)
   in registered catalogs, or — with `--from <path>` — calls
   `resolveAdHocSource()` to inspect the local path and synthesize a
   one-skill catalog. Ad-hoc installs auto-register the synthetic catalog
   so subsequent `update`/`uninstall` calls can find the source.
2. **Reject duplicate installs.** If the skill name is already in
   `installed-skills.json`, returns an "already installed" error and
   suggests `smith skill update`.
3. **Copy to each platform's skill directory.** OpenCode →
   `~/.config/opencode/skills/<name>/`. Claude Code →
   `~/.claude/skills/<name>/`. Codex → `~/.agents/skills/<name>/`. Kiro →
   `~/.kiro/skills/<name>/`. Defaults from `defaultPlatformSkillDirs()`
   (`src/io/skill-installer.ts`). Platforms whose base dir doesn't exist
   are silently skipped (so a single-platform machine doesn't error).
4. **Codex SKILL.md-directory requirement.** Codex agents and skills must
   be `SKILL.md`-rooted directories (Codex spec). Single-file skills are
   rejected. Codex shares `~/.agents/skills/` for both — see the caveat
   below.
5. **Atomic across platforms.** If any per-platform copy fails, every
   destination written so far is removed (`copyToPlatforms`,
   `src/io/skill-installer.ts`) — no half-installed states.
6. **Symlinks in the source are preserved as symlinks**, not followed
   (`cp` with `verbatimSymlinks: true, dereference: false`). Prevents a
   hostile `secret -> /etc/passwd` symlink in the source from being deep-
   copied into a platform skill dir.
7. **Record the install.** Writes the per-platform paths plus a sha256
   `contentHash` of the source dir to `installed-skills.json`. The hash
   walks the entire skill directory (sorted, symlinks recorded as
   `SYMLINK`, files >10MB recorded as `SKIPPED-LARGE` —
   `src/io/installed-skills.ts`).

Skills are **copied, not symlinked.** This is intentional: drift detection
compares the source dir's current hash to the recorded hash, so a symlink
would always read as "ok" even after the source changed.

`--from` can collide with an existing catalog label. The CLI surfaces the
collision with the `--as <other-name>` remediation
(`src/cli/commands/skill/install-cmd.ts`).

Exit codes: 0 on success; 1 on validation failure, ambiguous resolution,
duplicate install, or copy failure; 2 on unknown `--targets` value.

### `smith skill update [name]`

Re-copies the source over the installed copy on every recorded platform.

```bash
smith skill update the-architect
smith skill update --all
```

| Flag | Default | Effect |
|---|---|---|
| `--all` | off | update every entry in `installed-skills.json` |

Behavior (`src/io/skill-installer.ts`):

- Reads the recorded `sourcePath` from `installed-skills.json`.
- If the source no longer exists, returns an error suggesting re-register
  or reinstall.
- Re-copies to the same destinations (the same `installedPaths` map),
  recomputes the content hash, updates `installedAt`.
- Local platform-side edits are overwritten. The pre-update hash is what
  was recorded — if you wanted to see what you're losing, run `smith
  doctor` (or `smith skill list`) before updating.

In `--all` mode, per-skill failures are reported but the loop continues.

Exit codes: 0 on success; 1 on any per-skill failure.

### `smith skill uninstall <name>`

Removes the skill from every platform it was installed to and clears its
`installed-skills.json` entry.

```bash
smith skill uninstall the-architect
```

Bare name only — collisions across catalogs aren't possible at this stage,
because `installed-skills.json` is keyed by name (only one entry per name
can exist at any time). This resolves cheatsheet ambiguity #13: install-
time enforcement prevents the situation entirely.

Behavior (`src/io/skill-installer.ts`):

1. Removes every recorded destination directory (`rm -rf` semantics).
2. Removes the entry from `installed-skills.json`.
3. **Auto-prunes the source catalog if it's ad-hoc and now empty.** If the
   skill came from an `adhoc: true` catalog and no other installed skills
   reference that catalog label, the catalog is unregistered too. Keeps
   the registry tidy after one-off `--from` installs. The
   `atlassian-skills` catalog is `protected` and re-injected on every load,
   so this auto-prune can never remove it.

Exit codes: 0 on success; 1 if the skill isn't installed.

## Drift and doctor

The hash recorded at install time enables `smith doctor` and `smith skill
list` to flag drift. Resolves cheatsheet ambiguity #14:

| Status | Meaning | Remediation |
|---|---|---|
| `ok` | source content hash matches the recorded hash | none |
| `drift` | source has changed since install | `smith skill update <name>` |
| `missing` | platform-side install file is gone | `smith skill install <name>` to repair |
| `source-missing` | source catalog no longer contains this skill | `smith skill uninstall <name>` or re-register the catalog |

Drift detection is **informational only** — it never affects the `smith
doctor` exit code. Use it as a reminder system; smith won't auto-update.
See [guide/10-doctor.md](./10-doctor.md#the-ten-sections) for the doctor
section that surfaces drift, and `src/io/installed-skills.ts` for
the hash semantics (whole-directory recursive sha256, symlinks recorded
but not followed, files >10MB skipped).

## Required skills (`requires.skills`)

This is the canonical home for `requires.skills`. The deprecated copy
under "Capability mapping" in the old single-file GUIDE was a back-link;
in the new structure that section in
[guide/06-permissions-and-platforms.md](./06-permissions-and-platforms.md)
points here.

### Schema

Agents that depend on specific runtime skills declare them in
`agent.config.json`:

```json
{
  "requires": {
    "skills": [
      { "catalog": "atlassian-skills", "name": "atlassian-readonly-skills" },
      { "name": "the-architect" }
    ]
  }
}
```

Each entry is a `RequiredSkillEntry` (`src/io/required-skills.ts`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | kebab-case: `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `catalog` | string | no | restricts resolution to one catalog when present |

A bare `{ "name": "the-architect" }` resolves across all registered
catalogs at install time and fails if ambiguous.

### Distinction from `permission.skill`

`requires.skills` is the **delivery declaration** — which skills must be
installed for the agent to function.

`permission.skill` (in the agent's permission block) gates **runtime**
`Skill` tool calls — which installed skills the agent is allowed to invoke.

Both can coexist. A typical sandboxed agent declares the same skills in
both: `requires.skills` so smith installs them, `permission.skill` so the
runtime allows the agent to call them. See
[guide/06-permissions-and-platforms.md](./06-permissions-and-platforms.md)
for the permission cookbook.

### What `smith agent install <agent>` does

`src/cli/commands/install.ts`:

1. Builds and installs the agent first (see "build-then-skills ordering"
   below).
2. Reads the bundle's `requires.skills` field.
3. Loads `installed-skills.json` to find which entries are already
   satisfied (`diffRequiredSkills` matches by name).
4. For each missing entry, behaves per the chosen mode (see flag
   interactions).

### Flag interactions

This is also where the `--yes` dual meaning is resolved (cheatsheet
ambiguity #3 — `--yes` means "auto-confirm" here, but on `uninstall-all`
it confirms a destructive action; see
[guide/03-installing-and-rendering.md](./03-installing-and-rendering.md)
and [guide/11-update-and-uninstall.md](./11-update-and-uninstall.md)).

| Mode | Triggered by | Behavior |
|---|---|---|
| `prompt` | default | `Install? [Y/n]` per missing skill (default yes; up to 3 attempts on ambiguous input, then skip with warning) |
| `with-skills` | `--yes` OR `--with-skills` | auto-install every missing skill, no prompt |
| `no-skills` | `--no-skills` | skip all missing skills, warn at end. Always wins if combined with the others. |

Non-TTY behavior: in `prompt` mode on a non-interactive stream (CI, piped
stdin), the prompt loop would block forever. Smith degrades to `no-skills`
+ a single warning naming every missing skill plus the override flags
(`src/io/install-required-skills.ts`). Pipelines should pass
`--with-skills` or `--no-skills` explicitly rather than relying on the
degradation.

### Build-then-skills ordering

`smith agent install` builds and installs the agent first (`build()` call at
`src/cli/commands/install.ts`). If any agent build fails, the command
returns exit 1 **before** touching the skill set — installing a required
skill for an agent that didn't ship would leave a confusing partial
state. Cross-link: [guide/03-installing-and-rendering.md](./03-installing-and-rendering.md).

### Never-aborts rule

Required-skill failures **never** abort the agent install. After a
successful build, every per-skill failure is captured as a warning
(`installRequiredSkills` returns a result object; the install command
prints warnings but doesn't propagate them to the exit code —
`src/cli/commands/install.ts` and
`src/io/install-required-skills.ts`).

The agent install still reports exit 0 if the build succeeded. Doctor's
`agent-required-skills` section reports any agent whose required skills
are missing afterward, with a `smith skill install <ref>` remediation
per missing entry. See [guide/10-doctor.md](./10-doctor.md#the-ten-sections).

## Caveats and gotchas

- **Skills are copied, not symlinked.** Drift detection depends on
  comparing the source's current hash to the recorded hash; a symlink
  would always read as "ok" even after the source changed.
- **Codex agents and skills share `~/.agents/skills/`** per the Codex
  spec. A skill and an agent that share the same name will collide on
  Codex (cheatsheet ambiguity #15). Smith does not currently detect this
  cross-registry collision; choose distinct names for skills and agents
  if you target Codex.
- **Codex requires the SKILL.md directory shape.** Single-file skills
  (a bare `SKILL.md` not in its own directory) are rejected.
- **Ad-hoc catalogs auto-register on `--from` install** and **auto-
  unregister when the last installed skill from them is removed.** Avoids
  registry crud after one-off installs.
- **Discovery is recursive but stops at skill boundaries.** `discoverSkills`
  recurses into non-skill subdirectories, stops at any directory containing
  `SKILL.md`, and skips `.git`/`node_modules`. Nested layouts like
  `catalog/group/<skill>/SKILL.md` are discovered correctly.
- **Path-traversal guards run at three layers**: the CLI input check
  (`src/cli/commands/skill/install-cmd.ts`), the installer's
  `validateSkillName` (`src/io/skill-installer.ts`), and the
  schema regex on `requires.skills[].name` in the bundle config schema.
  All three must pass for an install to proceed — defense in depth.
- **`installed-skills.json` is keyed by name.** This means name collisions
  across catalogs aren't possible after install — only one entry can
  exist per name at any time. The first install wins; the second errors
  out as "already installed".
- **`atlassian-skills` is re-injected on every load** even if the on-disk
  registry doesn't list it. This means a hand-edited `catalogs: []`
  cannot accidentally erase it. Smith does not eagerly re-save on
  read; the next genuine mutation will persist the injection
  (`src/io/skill-registry.ts`).

## See also

- [guide/01-getting-started.md](./01-getting-started.md) — `smith skill bootstrap`, also fired by the `bun install` postinstall hook, installs `the-architect` and `the-keymaker` skills on every detected platform (OpenCode, Claude Code, Codex, Kiro).
- [guide/03-installing-and-rendering.md](./03-installing-and-rendering.md)
  — build-then-skills ordering in the broader install pipeline; `--yes`
  / `--with-skills` / `--no-skills` flag interactions in context.
- [guide/06-permissions-and-platforms.md](./06-permissions-and-platforms.md)
  — `permission.skill` cookbook and how it relates to `requires.skills`.
- [guide/08-registries-and-catalogs.md](./08-registries-and-catalogs.md)
  — kind vocabulary differences between agent and skill catalogs;
  `smith agent register` vs `smith skill register`.
- [guide/10-doctor.md](./10-doctor.md) — `skill-drift` and
  `agent-required-skills` doctor sections.
- [guide/13-paths-and-state.md](./13-paths-and-state.md) — every file
  smith writes, per platform, including the per-platform skill dirs.
- [guide/14-cli-reference.md](./14-cli-reference.md) — full reference
  for every `smith skill` subcommand.
