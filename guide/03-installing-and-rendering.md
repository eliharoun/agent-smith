# Installing and rendering

> What `smith agent install` actually does. This spoke is the canonical reference for the render pipeline — how a bundle becomes per-platform agent files on disk, what each translator emits, how the knowledge directory grant is injected, how required-skills resolution interacts with the install, and the full flag/exit-code surface for `smith agent install` and `smith agent install-all`.

If you only want to know which command to run, read [01-getting-started.md](./01-getting-started.md). If you want to know what the bundle on disk looks like, read [02-bundle-anatomy.md](./02-bundle-anatomy.md). If you want to know how the rendered output is removed, read [11-update-and-uninstall.md](./11-update-and-uninstall.md). This spoke is for everything in between: the rendering itself.

## Mental model

Install takes a bundle (a directory containing `agent.config.json` plus persona files) and turns it into per-platform agent files:

```
bundle (one canonical source)
  │
  ├─► assembled body (IDENTITY → EXPERTISE → SOUL → USER → KNOWLEDGE → SKILLS)
  │
  └─► per-target output (translator-specific)
        │
        ├─► OpenCode      ~/.config/opencode/agents/<name>.md       (markdown + frontmatter)
        ├─► Claude Code   ~/.claude/agents/<name>.md                 (markdown + frontmatter)
        ├─► Codex         ~/.agents/skills/<name>/SKILL.md           (markdown + frontmatter)
        └─► Kiro          ~/.kiro/agents/<name>.json                 (JSON document)
```

Two side effects sit alongside the file writes:

- For each agent that declares knowledge sources, a per-agent knowledge directory is materialized under agent-smith's own state home (`~/.config/agent-smith/knowledge/<name>/`) regardless of which platforms the agent targets. Every target — OpenCode, Claude Code, Codex, Kiro — gets a read grant injected into its rendered output so it can reach that directory at runtime.
- For each entry in `requires.skills`, smith either prompts to install, auto-installs, or skips with a warning depending on the flag mode.

Both effects happen *after* every agent's body has been built and rendered. If any build fails, install aborts before either side effect runs.

A third side effect, the **install manifest** (`~/.config/agent-smith/installed-agents.json`), is updated at the moment of every file write. It records the SHA-256 of every rendered file along with the agent name, target, and absolute path. The manifest is the basis for hash-mismatch refusal (smith won't overwrite an unrecognized file without `--force`), idempotent reinstall (matching hashes skip the write), and lazy-claim (a previously-unmanaged file whose contents already match the render is silently adopted into the manifest). See [Manifest-aware install](#manifest-aware-install) below.

## The install pipeline

`buildAndInstall()` in `src/io/orchestrator.ts` runs these steps for every bundle, in order:

1. **Load the bundle.** `loadAllBundles` walks every registered catalog (`src/cli/load-all.ts`), reads each `agent.config.json`, loads the persona files, resolves the `USER.md` symlink (falling back to the canonical path under `~/.config/agent-smith/USER.md`, then to an empty string if neither exists). Bundles that fail to load print `Skipping <dir>: <message>` to stderr and are dropped from the run — they do not abort `install-all`.
2. **Run the validator.** `validate()` in `src/core/validator.ts` runs against the parsed config, the loaded files, and a first-pass assembled body. Any errors land in the `errors` array and the bundle is skipped (the install exits non-zero at the end). Warnings are accumulated and printed.
3. **Run the knowledge stage.** If the bundle (merged with any `knowledge.json` sidecar) has sources, `runKnowledgeStage()` acquires each source, materializes it under `~/.config/agent-smith/knowledge/<name>/`, writes `_manifest.json`, and returns the inline payload + file index that the body assembler will splice in. Knowledge errors are fatal for the bundle; warnings flow through prefixed `[<agent>/knowledge] ...`. See [04-knowledge.md](./04-knowledge.md) for the full pipeline.
4. **Assemble the body.** `assembleBody()` in `src/core/assembler.ts` concatenates persona files in fixed order — `IDENTITY → EXPERTISE → SOUL → USER → KNOWLEDGE → SKILLS` — joined with the literal separator `\n\n---\n\n` and terminated with a trailing newline. Any stale frontmatter at the top of a persona file is stripped first (regex `/^---\n[\s\S]*?\n---\n?/`, `src/core/assembler.ts`). The assembled body is the same string for every target — translators only differ in frontmatter.
5. **Translate per target.** For each target in `config.targets`, the bundle's resolver picks a model literal (see [07-models.md](./07-models.md)), `renderForTargets()` (`src/core/translators/index.ts`) calls the platform translator to produce a `RenderedAgent` (a discriminated union — `format: "markdown-frontmatter"` for opencode/claude-code/codex, `format: "json"` for kiro), then `injectKnowledgeIntoRender()` injects the knowledge dir grant into the rendered output. `injectPlatformConventions()` runs immediately after to splice in any resolved platform-convention paths (kiro steering, etc. — see [06-permissions-and-platforms.md § Platform conventions](./06-permissions-and-platforms.md#platform-conventions)). Per-target warnings are accumulated, prefixed `[<agent>/<target>] ...`.
6. **Write to disk.** `installRendered()` in `src/io/installer.ts` serializes each rendered agent according to its `format` field — markdown-frontmatter renders as `---\n<yaml>---\n\n<body>` (YAML via `js-yaml` `dump` with sorted keys for stable diffs), json renders via `JSON.stringify(data, null, 2)` — and writes it to the per-target path declared by the translator (`relativePath`). The installer consults `installed-agents.json` to refuse hash-mismatch overwrites (see [Manifest-aware install](#manifest-aware-install)), then writes and records the new hash.

After every bundle has been processed, the install command (`src/cli/commands/install.ts`) walks each bundle's `requires.skills` and runs the skill resolver per the active mode. Build failures abort before this step; required-skill failures degrade to warnings and never abort an agent install.

## What "build" means

The cheatsheet uses "build" and "install" loosely. They map to distinct internals:

- **Build** = "render the bundle into per-platform files". Runs the validator, the knowledge stage, the assembler, the model resolver, and each translator. The output is an in-memory list of `RenderedAgent` records — a discriminated union keyed on `format`: `{ target, format: "markdown-frontmatter", relativePath, frontmatter, body }` for opencode/claude-code/codex; `{ target, format: "json", relativePath, data }` for kiro.
- **Install** = "write the build output to disk + run required-skills". Adds the file writes plus the post-build skill resolver loop.

You never invoke build separately. Every command surface that renders a persona bundle (`smith agent install`, `smith agent install-all`, the daemon's reinstall trigger) goes through `buildAndInstall()` and runs both phases as one operation. (`smith skill bootstrap` is *not* part of this set: it installs the bundled `the-architect` and `the-keymaker` skills via `installSkill`/`updateSkill` directly and never builds an agent — see `scripts/bootstrap.ts` and [05-skills.md](./05-skills.md).) The distinction matters when reading error output: a "render failed for <agent>" headline points at the build phase (translator/validator/knowledge), while an `ENOENT`/`EACCES`-style headline points at the disk write.

## Per-platform output

The four translators emit the same body but very different frontmatter (or, for kiro, a JSON document instead of frontmatter). The table below summarizes; the per-platform sections that follow give the source-of-truth detail.

| Behavior | OpenCode | Claude Code | Codex | Kiro |
|---|---|---|---|---|
| Install path | `<opencodeAgents>/<name>.md` | `<claudeAgents>/<name>.md` | `<codexSkills>/<name>/SKILL.md` | `<kiroAgents>/<name>.json` |
| Output format | markdown + YAML frontmatter | markdown + YAML frontmatter | markdown + YAML frontmatter | strict JSON document |
| Frontmatter `name` | omitted (uses filename) | emitted | emitted | `name` field in JSON |
| `description` | always | always | always | always (in JSON) |
| `mode`, `temperature`, `color` | when set in config | dropped | dropped | dropped (no native field) |
| `model` | when resolved | when resolved | never (no per-agent model) | resolved to static literal (claude-opus/sonnet/haiku) |
| Permission representation | full `permission` object emitted verbatim | `allowed-tools` comma-string | `allowed_tools` array | two-tier `tools[]` + `allowedTools[]` |
| `permission.<group>: ask` | honored | omits the tool + warns per tool | omits the tool + warns per tool | tool surfaced in `tools[]` but absent from `allowedTools[]` (native ask) |
| `permission.<group>: deny` | honored | tool simply absent + 1 summary warning | tool simply absent + 1 summary warning | tool absent from `tools[]` |
| `permission.skill` | honored (per-skill rules supported) | collapses pattern map + warns | warned + ignored (no skill-tool runtime) | emitted as `skill://` resource URIs (allow / ask / deny per skill) |
| Pattern-based rules (e.g. `{"git *": "allow"}`) | honored | collapses + warns | collapses + warns | collapses + warns (kiro has no pattern-grade rules) |
| Knowledge dir grant | `permission.read.<dir>/**: allow` | `additionalDirectories: [<dir>]` | `allowed_external_directories: [<dir>]` | added to `resources[]` as `file://<dir>/**` |

YAML is serialized with sorted keys via `js-yaml` `dump` (`src/io/installer.ts`) so a re-render of an unchanged bundle produces a byte-identical file ordering.

### OpenCode (`src/core/translators/opencode.ts`)

- Path: `~/.config/opencode/agents/<name>.md`
- Frontmatter keys (when set): `description`, `mode`, `model`, `temperature`, `color`, `permission`
- **Omits `name`.** OpenCode uses the filename as the agent identifier.
- Permission block emitted verbatim. OpenCode is the only platform with full fidelity for `ask`/`deny`/per-pattern records.
- Knowledge dir grant: injected into `permission.read` as `<knowledgeDir>/**: allow`. If `permission.read` is already a string the translator promotes it to a record (`{ "**": <prev>, "<dir>/**": "allow" }`). See `src/core/knowledge/permission-grant.ts`.

### Claude Code (`src/core/translators/claude-code.ts`)

- Path: `~/.claude/agents/<name>.md`
- Frontmatter keys (when set): `name`, `description`, `model`, `allowed-tools`, `additionalDirectories`
- Permission collapsed to a positive `allowed-tools` comma-separated string via `CLAUDE_CODE_TOOL_MAP` (`data/claude-code-tool-map.json`).
- `permission.<group>: "ask"` — Claude Code has no `ask` semantic, so each tool in the `ask` bucket is omitted from `allowed-tools` and a per-tool warning is emitted: `Permission action 'ask' has no claude-code equivalent for tool '<tool>'; omitting. Use 'allow' or 'deny'.`
- `permission.<group>: "deny"` — Claude Code uses a positive allowlist, so denied tools are omitted by being absent. One summary warning fires: `claude-code has no deny semantic; denied tools are simply omitted from allowed-tools.`
- `additionalDirectories: [<knowledgeDir>]` injected when the bundle has knowledge sources.

### Codex (`src/core/translators/codex.ts`)

- Path: `~/.agents/skills/<name>/SKILL.md` (per-agent subdirectory; Codex requires a `SKILL.md`-rooted layout — `src/io/installer.ts`).
- Frontmatter keys (when set): `name`, `description`, `allowed_tools`, `allowed_external_directories`
- **No per-agent model.** Codex doesn't accept a per-agent `model:` field; the translator never emits one. Any `model:` declared in the bundle is ignored for this target. (Tier resolution still runs for the resolver's bookkeeping.)
- Permission collapsed to a positive `allowed_tools` array via `CODEX_TOOL_MAP` (`data/codex-tool-map.json`).
- `permission.<group>: "ask"` — same per-tool warning as Claude Code, with the message naming `codex` instead.
- `permission.<group>: "deny"` — same one-line summary warning, naming `codex`.
- `permission.skill` — Codex has no native skill-tool runtime. An explicit warning fires: `permission.skill: codex has no native skill-tool runtime; permission ignored.` The `skill` group is also absent from `CODEX_TOOL_MAP`, so no `allowed_tools` entries are emitted for it regardless.
- `allowed_external_directories: [<knowledgeDir>]` injected when the bundle has knowledge sources.

Codex's tool vocabulary isn't fully finalized upstream; groups outside `CODEX_TOOL_MAP` are silently skipped by `expandPermissionToToolList`. See [06-permissions-and-platforms.md](./06-permissions-and-platforms.md) for the full mapping detail.

### Kiro (`src/core/translators/kiro.ts`)

- Path: `~/.kiro/agents/<name>.json`
- **Output format is JSON, not markdown.** The translator returns `{ format: "json", data: { ... } }` and the installer serializes via `JSON.stringify(data, null, 2)`. There is no body/frontmatter split — the assembled persona body is placed in the `systemPrompt` field of the JSON document.
- **Schema is strict.** Kiro's agent schema sets `additionalProperties: false`; emitting an unknown field would cause Kiro to reject the file at load time. The translator only emits fields documented in the vendored `data/kiro.agent-v1.schema.json`.
- **Two-tier tool surface.** Kiro distinguishes `tools[]` (the set of tools the agent *knows about*) from `allowedTools[]` (the subset that runs without confirmation). The translator emits both: a tool with action `allow` lands in both arrays; a tool with action `ask` lands in `tools[]` only (Kiro's native ask semantic — the user is prompted at invocation time); a tool with action `deny` is omitted from both. This is the only target with a first-class `ask` semantic; Claude Code and Codex have to drop ask-tools entirely.
- **Native model field, static resolution.** Kiro accepts a `modelId` field with the canonical literal (`claude-opus-4.6`, `claude-sonnet-4.6`, `claude-haiku-4.5`). Tier resolution is static (no live registry call) — see [07-models.md](./07-models.md).
- **`permission.skill` becomes `skill://` URIs.** Kiro's resource grant model uses URI prefixes; the translator emits `skill://allow/<name>`, `skill://ask/<name>`, or `skill://deny/<name>` entries in `resources[]` per skill rule.
- **Knowledge dir grant**: appended to `resources[]` as `file://<knowledgeDir>/**`.
- **Surgical agentSpawn hook merge.** Kiro's `~/.kiro/agents-hooks.json` lists which agents are spawnable. `installRendered` merges in an entry for the just-installed agent without disturbing AIM- or kiro-lens-managed entries already in the file. See `src/io/kiro-hooks.ts`.

## Manifest-aware install

`installed-agents.json` (`~/.config/agent-smith/installed-agents.json`) is the per-host record of which agents `smith` has installed and the SHA-256 of every rendered file. It is read-modify-written under a file lock (`withFileLock`) so concurrent installs don't race.

The installer (`src/io/installer.ts`) consults the manifest before every write to enforce three rules:

| Pre-write state | Behavior |
|---|---|
| Path is absent on disk | Write file; record hash in manifest. |
| Path is present, hash matches manifest entry | Skip write (idempotent); manifest already correct. |
| Path is present, hash matches the *new* render | Skip write; lazy-claim into manifest if entry was missing. |
| Path is present, hash mismatches both manifest and new render | **Refuse** with `manifest-mismatch` error unless `--force` is set. |
| Path is present, manifest hash differs from on-disk hash | **Refuse** (would clobber tampered/external file) unless `--force` is set. |

This gives smith strong "what I wrote, I own" semantics: a hand-edited agent file is never silently overwritten. The error message names the agent, the target, the path, and the `--force` flag. See [11-update-and-uninstall.md](./11-update-and-uninstall.md) for the inverse rules during uninstall.

## Knowledge dir cross-platform grants

Knowledge content for an agent is materialized in exactly one place: `~/.config/agent-smith/knowledge/<name>/`. This is true regardless of which platforms the agent targets. The orchestrator (`src/io/orchestrator.ts`) computes the knowledge directory via `knowledgeDirFor(agentName, paths)`, which joins `agentSmithHome` (`~/.config/agent-smith`) with `knowledge/<name>/` (`src/io/knowledge-paths.ts`). Earlier versions of smith materialized knowledge under `~/.config/opencode/agents/<name>/knowledge/`, but OpenCode's agent picker globs that directory recursively and treated every knowledge `.md` as a selectable agent — see the docstring on `KnowledgePaths` (`src/io/knowledge-paths.ts`) for the migration rationale.

Each target then needs its runtime to be allowed to read that directory. `injectKnowledgeReadAllow()` does this at translation time:

| Target | Mutation |
|---|---|
| OpenCode | adds `<knowledgeDir>/**: allow` under `permission.read` (promotes a string read action to a record if needed) |
| Claude Code | appends `<knowledgeDir>` to `additionalDirectories` |
| Codex | appends `<knowledgeDir>` to `allowed_external_directories` |
| Kiro | appends `file://<knowledgeDir>/**` to `resources[]` |

The grant cannot be disabled from the bundle — if the bundle has knowledge sources, the grant is injected for every target including OpenCode. The orchestrator records each granted directory in `OrchestratorResult.grantedKnowledgeDirs` (read-grant wiring) and per-source materialization byte-state in `OrchestratorResult.knowledge: KnowledgeSummary[]` (changed/unchanged diff against the prior `_manifest.json`). The install summary renders both: `grantedKnowledgeDirs` underpins the per-target permission entries; `knowledge` drives the per-source `→ knowledge <id>` / `· knowledge <id> (unchanged)` lines and aggregate tally documented under [Idempotency](#idempotency) below. Bundles with no knowledge sources skip both the injection and the summary block entirely.

For the materialization detail (where files land, manifest format, cache layout) see [04-knowledge.md](./04-knowledge.md).

## Idempotency

Re-running `smith agent install <name>` with no source changes re-renders the bundle and compares the result against the destination file. The serializer's sorted-key YAML and the body assembler's deterministic block order mean an unchanged bundle produces byte-identical file content on every run. The installer (`src/io/installer.ts`) reads the existing file before writing: when content matches, the `Bun.write` is skipped entirely so file `mtime` does NOT change.

The CLI summary distinguishes the two cases:

```text
→ opencode /Users/you/.config/opencode/agents/foo.md
· opencode /Users/you/.config/opencode/agents/bar.md (unchanged)
2 installed, 1 unchanged
```

The `→` lines are freshly written; `·` lines were already byte-identical and the installer left them alone. The summary aggregates both counts so the user can confirm the install attempt visited every expected target without losing the "what actually changed" signal.

If you have downstream tooling that watches install files by `mtime`, only `→` lines (the `installed[]` set) will fire change notifications. The `skipped[]` set is reported but no syscall touches the file.

### Knowledge materialization summary

When a bundle has knowledge sources, the per-target block is followed by one line per knowledge source and a knowledge tally:

```text
→ opencode /Users/you/.config/opencode/agents/foo.md
1 installed, 0 unchanged
→ knowledge guide (15 files, 312.0KB, file)
· knowledge cheat (1 file, 8.0KB, inline) (unchanged)
1 changed, 1 unchanged · 16 files, 320.0KB · inline tokens 980/4000
```

The `→` / `·` per-source convention mirrors the rendered-agent lines: `→` for sources whose materialized bytes changed since the prior install (new files, edited files, delivery flips, set membership changes), `·` for sources whose every file is byte-identical to the previous `_manifest.json`. The tally reports `<changed>, <unchanged> · <total-files>, <total-bytes>`. The trailing `inline tokens <used>/<budget>` clause is **conditional**: it only appears when at least one source has `delivery=inline`. File-only agents (including `agent-smith` itself) omit it to avoid a misleading `0/<budget>` indicator.

The diff is computed by `summarizeKnowledgeStage` (`src/io/knowledge-summary.ts`) which reads the prior `_manifest.json` *before* the knowledge pipeline overwrites it, then keys each source by `(relPath, sha256)` set membership. A first-time install (no prior manifest, ENOENT) reports every source as changed. The block is suppressed entirely for agents without knowledge sources, so existing install output for non-knowledge agents is unchanged.

The renderer is `formatKnowledgeLines` (`src/cli/format.ts`); the install CLI calls it after the rendered-agent tally and before the required-skills loop (`src/cli/commands/install.ts`).

What re-running install *is* safe for: the destination is fully replaced from the canonical bundle whenever content differs, so accidental edits to the rendered files are reverted on the next install. This is the property the daemon's reinstall-on-source-change behavior depends on.

## `smith agent install <name>`

Build and install one agent.

```text
smith agent install <name> [--yes] [--with-skills] [--no-skills]
```

**Arguments:**
- `<name>` — required. Must match the `name` field of exactly one registered bundle.

**Flags (skill-mode trio):**
- `--yes` — auto-accept all prompts. On install, the only prompt is the required-skills `[Y/n]`, so this is equivalent to `--with-skills`.
- `--with-skills` — auto-install required skills without prompting.
- `--no-skills` — skip required-skill installs and emit a warning. Wins over the others if combined.

The flag-to-mode resolution is in `src/index.ts`:

| Flags supplied | Resolved skill mode |
|---|---|
| (none) | `prompt` |
| `--yes` | `with-skills` |
| `--with-skills` | `with-skills` |
| `--yes --with-skills` | `with-skills` |
| `--no-skills` | `no-skills` |
| `--yes --no-skills` | `no-skills` (no-skills wins) |
| `--with-skills --no-skills` | `no-skills` (no-skills wins) |

**The dual meaning of `--yes`.** On `smith agent install` and `smith agent install-all`, `--yes` means "auto-install required skills". On `smith agent uninstall-all` and `smith jack-out`, `--yes` means "skip the confirmation prompt" (a typed-token confirmation in the `jack-out` case). The flag name is the same but the semantic is different — there is no required-skill prompt to suppress on the uninstall side, and there is no destructive-confirmation prompt on the install side. Cross-link: [11-update-and-uninstall.md](./11-update-and-uninstall.md) for the uninstall side.

**Exit codes:**
- `0` — bundle built, files written, required-skills resolved (warnings about skipped/failed required-skills do not affect the exit code).
- `1` — agent name not found, validation failed, knowledge stage failed, render failed, or any disk write failed.

**Examples:**

```bash
smith agent install triage-bot
smith agent install triage-bot --with-skills    # auto-install required skills
smith agent install triage-bot --no-skills      # skip required skills with warning
smith agent install triage-bot --yes            # equivalent to --with-skills
```

## `smith agent install-all`

Build and install every registered bundle.

```text
smith agent install-all [--yes] [--with-skills] [--no-skills]
```

**Arguments:** none.

**Flags:** identical to `smith agent install` (same skill-mode trio).

**Behavior:** `installAll()` in `src/cli/commands/install-all.ts` loads the registry once, loads every bundle once, then iterates and **delegates each bundle to `install()`** with the already-loaded registry/bundles injected via DI seams. This means:

- Required-skills resolution runs **per agent**, not once at the end.
- A failure in one bundle does not abort the run; the loop continues for the remaining bundles.
- The exit code is the worst-case across all per-bundle exit codes (`exitCode = code if code !== 0`).

**Exit codes:**
- `0` — every bundle installed cleanly.
- `1` — at least one bundle failed (validation/render/write); the rest still ran.

**Examples:**

```bash
smith agent install-all
smith agent install-all --with-skills    # auto-install all required skills across all agents
smith agent install-all --no-skills      # skip every required-skill install with warnings
```

## Required-skills behavior during install

Required-skills are part of install but documented canonically in [05-skills.md](./05-skills.md#required-skills-requiresskills). The install-side specifics:

- **Build first, skills second.** Each `install()` call runs `buildAndInstall()` to completion before touching the user's skill set (`src/cli/commands/install.ts`). If any agent build fails, the command returns 1 and no required-skill installs are attempted. This avoids leaving partial state where a skill was installed for an agent that didn't actually ship.
- **Per-bundle iteration.** Within `install()`, every bundle has its `requires.skills` walked and the resolver invoked (`src/cli/commands/install.ts`). Skills already in `installed-skills.json` are skipped without prompting.
- **Failures degrade to warnings.** `installRequiredSkills()` (`src/io/install-required-skills.ts`) catches install failures, records the ref in `skipped`, and emits a warning naming the ref and the manual remediation command. The agent install's exit code is unaffected. Doctor's `agent-required-skills` section reports unsatisfied requirements after the fact.
- **Non-TTY guard.** In `prompt` mode on a non-TTY stdin (CI, piped input), the resolver degrades to `no-skills` mode and emits one actionable warning per agent naming every missing skill and the flags that would override (`src/io/install-required-skills.ts`). CI pipelines should always pass `--with-skills` or `--no-skills` explicitly rather than relying on the implicit non-TTY behavior.
- **Prompt forgiveness.** Unclear answers (anything not `y`/`yes`/`n`/`no`/empty) re-prompt up to 3 times before treating the input as a skip with an explanatory warning (`src/io/install-required-skills.ts`).

## `--targets` semantics

There is no `--targets` flag on `smith agent install` or `smith agent install-all`. The bundle's `targets` array (set in `agent.config.json` and editable via `smith agent init --targets`) is the single source of truth for which platforms get written to. If a bundle's `targets` is `["opencode"]`, only the OpenCode file is rendered and written; Claude Code, Codex, and Kiro paths are not touched.

(`smith skill bootstrap` and `smith skill install` *do* have `--targets` flags. They control which platforms the bundled-asset / skill-copy operation writes to — valid values are `opencode`, `claude-code`, `codex`, and `kiro`. When `--targets` is passed explicitly, the platform's skill directory is created if absent; without `--targets`, platforms whose skill directory doesn't already exist are silently skipped. See [01-getting-started.md](./01-getting-started.md) and [05-skills.md](./05-skills.md).)

A consequence: if you remove a target from a bundle's `targets` array and re-install, the file at the previously-targeted platform is **not deleted**. You have to `smith agent uninstall <name>` first to clean up the stale install, then re-install with the new targets list. See [11-update-and-uninstall.md](./11-update-and-uninstall.md).

## Caveats and gotchas

- **Byte-identical writes are skipped.** The installer reads the existing file before writing and compares to the rendered output; matching content is reported as `skipped[]` and no `Bun.write` syscall fires. If you depend on `mtime` for change detection, only freshly written files (the `installed[]` set, the `→` lines in the summary) update `mtime`. See [Idempotency](#idempotency) above for the user-visible output.
- **YAML keys are sorted.** Frontmatter is dumped with `sortKeys: true` (`src/io/installer.ts`) so re-renders produce deterministic content. Don't rely on a specific frontmatter key order.
- **Block separator is fixed.** The body assembler joins sections with the literal `\n\n---\n\n` and adds one trailing `\n` (`src/core/assembler.ts`). Persona files that end in trailing whitespace have it stripped by `clean()` before joining.
- **Frontmatter strip.** Any frontmatter at the top of a persona file is removed before assembly (regex `/^---\n[\s\S]*?\n---\n?/`, `src/core/assembler.ts`). This means a stale frontmatter block left in `IDENTITY.md` won't appear in the rendered output — but anything *between* `---` fences is silently dropped, so don't put real content there.
- **Codex per-agent subdirectory.** Codex agents land at `<codexSkillsDir>/<name>/SKILL.md`, not as flat `.md` files. The subdirectory name is the agent name; the file inside is always `SKILL.md`. This shares the directory with Codex skills (also installed under `~/.agents/skills/`), so an agent and a skill with the same name will collide. See [05-skills.md](./05-skills.md) and [06-permissions-and-platforms.md](./06-permissions-and-platforms.md).
- **Per-target skip.** If a bundle's `targets` array doesn't include a platform, that platform's file isn't written *and isn't deleted*. `smith agent uninstall` is the only way to remove a stale install.
- **Higher-precedence shadowing.** `installRendered()` deduplicates by `<target>:<filename>` and warns on collisions: `Skipped duplicate <name>.md for target <target> (already installed by higher-precedence source)`. Precedence order is `project > user-global > registered` (`src/io/orchestrator.ts`).
- **Bundle-load soft errors.** `loadAllBundles` (`src/cli/load-all.ts`) catches bundle-load exceptions and prints `Skipping <dir>: <message>` to stderr without aborting `install-all`. A typo'd `agent.config.json` in one bundle won't stop the others from installing.
- **Knowledge dir always under agent-smith's state home.** Even an agent whose targets are `["claude-code"]` will have its knowledge materialized under `~/.config/agent-smith/knowledge/<name>/`. The grant injection ensures the Claude Code runtime can reach it. If you uninstall OpenCode but keep using Claude Code, this directory still gets created in the same place. See [04-knowledge.md](./04-knowledge.md).
- **The granted knowledge dir is recorded only after success.** `OrchestratorResult.grantedKnowledgeDirs` is appended to *after* every per-bundle check passes (`src/io/orchestrator.ts`), so a build failure mid-pipeline won't leave a phantom grant entry in the install summary. The same is true of `OrchestratorResult.knowledge` (the per-source materialization summary): if `runKnowledgeStage` fails, the orchestrator pushes the error and `continue`s, so no entry lands in `knowledge` for the failed bundle and no `→ knowledge` line is printed for it.

## See also

- [01-getting-started.md](./01-getting-started.md) — worked example: install your first agent end-to-end.
- [02-bundle-anatomy.md](./02-bundle-anatomy.md) — `agent.config.json` schema and persona file structure.
- [04-knowledge.md](./04-knowledge.md) — knowledge stage detail, materialization, manifest format.
- [05-skills.md](./05-skills.md) — canonical home for `requires.skills` schema and behavior.
- [06-permissions-and-platforms.md](./06-permissions-and-platforms.md) — permission preset → per-platform translation, full tool-map detail.
- [07-models.md](./07-models.md) — model resolution per platform.
- [11-update-and-uninstall.md](./11-update-and-uninstall.md) — the inverse pipeline: removing what install wrote.
- [14-cli-reference.md](./14-cli-reference.md) — `install` and `install-all` reference cards.
