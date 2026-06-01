# Bundle anatomy

> A bundle is a directory of `agent.config.json` plus persona files — the canonical, platform-independent definition of an agent. This spoke is the schema reference: every field, every regex, every validator rule, and the `smith agent validate` command. Read this when you are hand-editing a bundle, debugging a validator failure, or deciding what belongs in which file.

## Mental model

The same bundle is the source of truth for every platform smith installs to. Translators read it; the validator gates it; the renderer assembles it; the daemon watches it. The directory and the `name` field in `agent.config.json` must agree, and the same bundle directory layout is used whether the bundle lives in your user-global catalog, a project-local catalog, or a registered git catalog.

## Bundle directory structure

A bundle is a directory whose name matches `agent.config.json`'s `name` field, containing exactly five files (one of them a symlink), plus an optional knowledge sidecar:

```
<name>/
├── agent.config.json     canonical config (this spoke)
├── IDENTITY.md           who the agent is (15–25 lines)
├── EXPERTISE.md          what it knows / can do (40–100 lines)
├── SOUL.md               voice, tone, working style (15–30 lines)
├── USER.md               symlink → ~/.config/agent-smith/USER.md (or stub)
└── knowledge.json        optional sidecar; merged into config.knowledge
```

The four markdown files are concatenated in the order `IDENTITY → EXPERTISE → SOUL → USER` (plus `KNOWLEDGE` and `SKILLS` sections if present) into the assembled body. Per-platform translators wrap that body in idiomatic frontmatter; see [Installing and rendering](./03-installing-and-rendering.md).

## `agent.config.json` complete schema

The schema is enforced by zod in `src/core/config-schema.ts` and the underlying TypeScript shape lives in `src/core/types.ts`. Top-level fields:

| Field | Type | Required | Default | Constraint |
|---|---|---|---|---|
| `schemaVersion` | number | yes | — | must be `1` (auto-migrated from legacy configs without it) |
| `name` | string | yes | — | matches `KEBAB` regex; must equal bundle dirname |
| `description` | string | yes | — | 10–200 chars; matches `ACTION_PHRASE` regex |
| `targets` | array | yes | — | non-empty; each entry one of `opencode`, `claude-code`, `codex`, `kiro`, `agents-md` |
| `modelTier` | enum | yes | — | `balanced` \| `fast` \| `high` \| `inherit` (legacy aliases: `opus`, `sonnet`, `haiku`) |
| `model` | string | no | omitted | non-empty; OpenCode-only override |
| `mode` | enum | no | omitted | `primary` \| `subagent` \| `all` |
| `temperature` | number | no | omitted | 0.0–1.0 |
| `color` | string | no | omitted | platform-dependent display hint |
| `permission` | object | no | omitted | see [Permissions](./06-permissions-and-platforms.md) |
| `mcpServers` | string[] | no | omitted | each entry non-empty |
| `skills` | string[] | no | omitted | populates the appended `## Default Skills` section |
| `knowledge` | object | no | omitted | see [Knowledge](./04-knowledge.md) |
| `requires` | object | no | omitted | container for `requires.skills` |
| `platformConventions` | object | no | omitted | per-platform context paths the bundle requests; resolved via 3-tier precedence — see [Permissions and platforms — Platform conventions](./06-permissions-and-platforms.md#platform-conventions) |
| `targetOptions` | object | no | omitted | per-target rendering options (`agentsMd.path`, `claudeCode.deferToAgentsMd`); see [Knowledge compiler](./16-knowledge-compiler.md#the-agents-md-target) |
| `thresholds` | object | no | omitted | [per-bundle overrides for validator line-range and warn-char defaults](#thresholds) |

The schema is `z.object({...})`, so unknown top-level keys are stripped silently. If you misspell a field you will not get a validator error — you will get a silently-ignored field. Run `smith agent validate` after editing.

### `permission`

A record of group-name → action or group-name → pattern-record. Actions are `allow`, `ask`, `deny` (`src/core/types.ts`). Per-platform translator behavior varies — Claude Code drops `lsp`/`external_directory`, Codex drops `task`/`webfetch`/`websearch`/`lsp`/`external_directory`, and pattern maps are honored only by OpenCode. Full schema, presets (`read-only`, `read-edit`, `full`), and platform translation tables are in [Permissions and platforms](./06-permissions-and-platforms.md).

### `mcpServers`

Array of MCP server names this agent expects to be available on each target platform. Documentation only — declaring a server here does not install it, allowlist it, or write any per-server gating into the rendered agent file. The only observable effect is an advisory warning at install time when a named server is not configured on a target platform. See [Permissions and platforms — MCP](./06-permissions-and-platforms.md#mcp-server-dependencies).

### `skills`

Array of skill names that populate the appended `## Default Skills` section in the assembled body. This is a prose-level hint to the model; it does not gate runtime access (that is `permission.skill`) and it does not arrange for the skills to be installed (that is `requires.skills`).

### `requires.skills`

Array of `{ catalog?, name }` entries declaring skills that must be installed for the agent to function. `catalog` is optional; `name` is required and must match `SKILL_NAME_KEBAB` (lowercase letters, digits, hyphens — note this differs from the agent `KEBAB` regex by allowing names that start with a digit). Schema in `src/core/config-schema.ts`. Full install behavior, prompt semantics, and `--with-skills` / `--no-skills` flags are documented in [Skills — Required skills](./05-skills.md#required-skills-requiresskills).

### `knowledge`

Object with `packs?`, `inlineBudget?: { totalTokens }`, `sources?` array, and an optional `compile?` block. The `inlineBudget.totalTokens` defaults to 8000 and is capped at 16000 (`src/core/knowledge/schema.ts`). For the full source-type taxonomy (`file`, `dir`, `glob`, `url`, `git`, `confluence`, `jira`), materializer rules, and per-source schemas, see [Knowledge sources](./04-knowledge.md).

The optional `compile` block overrides the v2.1 smart default:

```jsonc
{
  "knowledge": {
    "sources": [...],
    "compile": {
      "progressive": true,    // override smart default; force compile (or false to pin v1)
      "tocMaxLines": 150,     // 1–400; truncates the TOC stanza
      "emitAgentsMd": false   // shorthand used by the APM importer
    }
  }
}
```

When `compile` is absent the pipeline picks compile vs. v1-inline based on the corpus size against `inlineBudget.totalTokens` (default 8000) — see [Smart default and overrides](./16-knowledge-compiler.md#smart-default-and-overrides). Per-source `summary`, `toc`, and `retrieval` fields layer on every source variant; they parse cleanly in v1 mode but only affect rendering when the bundle compiles. Full reference: [Knowledge compiler](./16-knowledge-compiler.md).

### `thresholds`

Optional. A bundle that legitimately ships content outside the validator's global defaults can override the relevant thresholds here, declaring the override alongside the bundle so it is reviewable and travels with the content.

Two knobs are available:

- **`thresholds.lineRanges`** — overrides the per-file non-blank-line range for any of `identity`, `expertise`, `soul`, `user`. Each value is a `[min, max]` tuple of integers (`min >= 1`, `max >= min`). Slots are individually optional; omitted slots fall back to the global defaults (identity 15-25, expertise 40-100, soul 15-30, user 20-40).
- **`thresholds.warnChars`** — overrides the assembled-body warning limit (global default `32 000` chars). Positive integer.

`thresholds.failChars` is intentionally NOT supported. The 64 000-char hard error gate is a project-level cap; bundles that legitimately need a larger assembled body open a project-level conversation, not a per-bundle flag.

Example (the bundled `agent-smith` persona uses these overrides because its IDENTITY/SOUL/USER files are deliberately terse pointers to companion docs and a dense persona file, sitting outside the defaults by design):

```json
{
  "thresholds": {
    "lineRanges": {
      "identity": [8, 12],
      "soul": [40, 60],
      "user": [5, 10]
    }
  }
}
```

When applying an override, declare it because the content's natural shape sits outside the global defaults — not to silence a warning that points at a real problem (bloat in `SOUL.md`, an under-developed `IDENTITY.md`, etc.). The override is visible in `agent.config.json` git history, so reviewers see it on every bundle change. Source: `src/core/thresholds.ts`.

## Naming and validation rules

### Agent name regex (`KEBAB`)

```
/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
```

Source: `src/core/config-schema.ts`. Names must start with a lowercase letter, contain only lowercase letters / digits / hyphens, and may not start or end with a hyphen or contain consecutive hyphens. The bundle's directory name must equal the `name` field — they cannot diverge. Loaders identify bundles by their directory name and use that name in install paths; a mismatch produces a confusing "agent not found" error during install rather than a clean validator failure.

### Description regex (`ACTION_PHRASE`)

```
/^(Use\b|[A-Z][a-z]+s?\b)/
```

Source: `src/core/config-schema.ts`. Descriptions must start with either the literal `Use` (e.g. `Use proactively when...`) or a capitalized verb in third-person singular or plural (`Reviews PRs...`, `Builds release artifacts...`, `Drives incident response runbooks...`). The 10–200 char length window is enforced separately. The reason for this rule: the description is what platforms surface to users and to delegating agents when picking which agent to invoke. Vague descriptions ("AI assistant for stuff") suppress auto-delegation; imperative phrases give the routing model something concrete to match against.

### Skill name regex (`SKILL_NAME_KEBAB`)

```
/^[a-z0-9]+(-[a-z0-9]+)*$/
```

Source: `src/core/config-schema.ts`. Used for `requires.skills[].name`. Accepts a leading digit (unlike `KEBAB`) because some skill catalogs distribute skills whose names start with a number.

## Persona files

The four markdown files together form the agent's system prompt. They are concatenated by `assembleBody()` with horizontal-rule separators, in the order `IDENTITY → EXPERTISE → SOUL → USER → KNOWLEDGE → SKILLS`.

### What goes where

- **`IDENTITY.md`** — one tight paragraph naming the agent and its purpose. Read first by the model, so it sets the frame.
- **`EXPERTISE.md`** — bulleted lists of what the agent knows, what tools it uses, what problems it owns. Anchors the model in domain.
- **`SOUL.md`** — voice, tone, mannerisms, working style. Defines *how* the agent communicates — not what it knows.
- **`USER.md`** — your shared user context (see below). Symlinked for personal catalogs (`user-global`, `project`); a stub file for team-shared `registered` catalogs.

### Line-count windows (warnings only)

The validator (`src/core/validator.ts`, with defaults from `src/core/thresholds.ts`) enforces a recommended line range for each file:

| File | Min lines | Max lines |
|---|---|---|
| `IDENTITY.md` | 15 | 25 |
| `EXPERTISE.md` | 40 | 100 |
| `SOUL.md` | 15 | 30 |
| `USER.md` | 20 | 40 |

Files outside the range produce a warning, not an error. Lines counted are non-blank lines. The windows reflect what produces good model behavior across the four target platforms — much shorter and the persona is thin; much longer and the model starts ignoring later content.

### File-size hard rules

Two character thresholds apply to the *assembled body* (all four files concatenated, including separators), not to any single file:

| Threshold | Constant | Behavior |
|---|---|---|
| 32,000 chars | `WARN_CHARS` | warning emitted; install proceeds |
| 64,000 chars | `FAIL_CHARS` | error emitted; validator fails |

Source: `WARN_CHARS` is defined in `src/core/thresholds.ts`; `FAIL_CHARS` remains in `src/core/validator.ts`. When a knowledge block declares an `inlineBudget`, the renderer applies a separate length check (`validateAssembledTotal()` in `src/core/validator.ts`) that allows the body to grow by `inlineBudgetTokens × 4` characters. The prose-only check above still runs against author-written content; the knowledge-aware check guards the final rendered output.

### Empty-file rule

Each persona file must contain at least 5 non-whitespace characters (`src/core/validator.ts`). Emptier than that fails the validator.

### TODO marker rule

Any persona file containing a `<!-- TODO` comment (case-insensitive) fails the validator (`src/core/validator.ts`). This is intentional: `smith agent init` writes deliberately-failing stubs so a freshly-scaffolded agent cannot accidentally be installed before a human edits the personas. The architect skill relies on this — its workflow assumes `smith agent validate` will fail until the stubs are replaced.

```text
<!-- TODO: write second-person IDENTITY.md content; this stub will fail the validator -->
```

If you ever want a stub that passes validation, you must replace this comment with real content (≥5 non-whitespace chars, no `TODO` marker).

### Voice warnings

The validator also fires non-fatal warnings on the three prompt files (not `USER.md`) when:

- the file does not contain the word `You` — agent prompts should be in second person.
- the file contains `I am` or `As an AI` — these phrases trigger model roleplay/disclaimer modes.

See `src/core/validator.ts`.

## USER.md

`USER.md` is your personal context — name, role, environment notes, project context, preferences. It lives at one canonical path (`~/.config/agent-smith/USER.md`) and every bundle's `USER.md` is a symlink to it.

### Why a symlink

Edit the canonical file once and every installed agent picks up the change on its next install. There is no per-bundle copy to keep in sync. `smith agent init` creates the symlink at scaffold time (`src/cli/commands/init-agent.ts`) for bundles landing in personal catalogs (`user-global` or `project`); see the next subsection for the `registered`-catalog stub branch. Bundles distributed in catalogs (the bundled `agent-smith` persona, anything in `examples/`) ship with a placeholder file that the install pipeline replaces.

### USER.md and catalog kind

`smith agent init`'s handling of the bundle's `USER.md` file depends on the kind of catalog the bundle is being scaffolded into. The branch is controlled by the `--catalog` flag — without `--catalog`, behavior defaults to user-global (symlink).

| Catalog kind | USER.md handling | Reason |
|---|---|---|
| `user-global` (default) | Symlink to `~/.config/agent-smith/USER.md` | Bundle is local to one user; the symlink keeps global preferences in one canonical place. |
| `project` | Symlink to `~/.config/agent-smith/USER.md` | Same as user-global. |
| `registered` | Stub file with placeholder content | Symlinks point at per-user-machine paths and would break for every teammate who clones the catalog repo. |

The stub content names itself as a placeholder, points readers at this section, and is harmless on disk — installs render their own per-platform USER.md independently of the bundled file. See [Sharing and distribution § 2.2](./15-sharing-and-distribution.md#22-scaffold-into-the-catalog-directory) for the team-shared scaffold workflow.

### Resolution order

When the bundle loader reads `USER.md` (`src/io/bundle-loader.ts`), it tries three things in order:

1. Read `<bundle>/USER.md`. `readFile` follows the symlink transparently, so this is the normal path.
2. If `<bundle>/USER.md` does not exist (no file, no symlink) and a `canonicalUserPath` was provided to the loader, read that path instead.
3. If both reads fail, substitute the empty string. The bundle loads cleanly; the agent simply has no user context.

The empty-string fallback is also used when the canonical file is missing or the symlink is broken (e.g. you moved your config dir). This means a missing `USER.md` produces an agent with no user context, not a crash. Run `smith status` to confirm the canonical path resolves to a real file.

### Init-time warning

When `smith agent init` is about to create the canonical symlink (i.e. for `user-global` and `project` catalogs), it checks whether the canonical `USER.md` exists; if it does not, the command **seeds it automatically** with the canonical "About me" template (`src/cli/commands/init-agent.ts`) before creating the symlink. The bundle's `USER.md` symlink therefore always points at a real file. Re-running `smith init-user` later opens the seeded file in `$EDITOR` so you can replace the placeholder content.

For `registered` catalogs (`--catalog <registered-label>`), no symlink is created and no canonical seeding happens: the stub USER.md committed in the bundle is self-contained and does not depend on the canonical file.

### Broadcast effect

Because every (personal-catalog) bundle resolves to the same canonical file, anything you write in `USER.md` is read by every installed agent. Treat it as a small global system prompt. Per-agent settings should go in the agent's own `agent.config.json` and persona files, not `USER.md`. (For `registered`-catalog bundles, see the kind table above.)

## `knowledge.json` sidecar

For long source lists or environment-specific overrides, you can place a `knowledge.json` next to `agent.config.json` in the bundle. Same shape as the inline `knowledge` block (`packs?`, `inlineBudget?`, `sources?`).

Merge rules (sidecar wins on collision):

- `packs` — sidecar replaces the inline value entirely if present.
- `inlineBudget` — sidecar replaces the inline value entirely if present.
- `sources` — merged by `id`; on id collision, the sidecar entry wins.

Use the sidecar when the source list is longer than is comfortable inside `agent.config.json`, or when you want to keep the canonical config under version control while overlaying local-only sources from a sidecar that's gitignored. Per-source schemas live in [Knowledge sources](./04-knowledge.md).

## `smith agent validate`

Runs the bundle linter against one or every bundle smith knows about. This is a hard gate for `smith agent install` — if validate fails, install will fail too with a less helpful error.

```bash
smith agent validate        # validate every bundle in every registered catalog
smith agent validate <name> # validate one bundle
```

### What it checks

`smith agent validate` (`src/cli/commands/validate.ts`) iterates every bundle returned by `loadAllBundles()` (or just the named one) and runs `runValidate()` on each. The validator covers:

- **Schema** — every rule in `src/core/config-schema.ts` (name regex, description regex+length, targets non-empty, modelTier enum, etc.).
- **Persona files** — empty-file, TODO marker, line-count window, voice warnings, hard char limits.
- **Info-notes** — `model` set without `opencode` in `targets`; both `model` and `modelTier` set with `claude-code` in targets.
- **Knowledge** — calls `validateKnowledge()` on the knowledge block (duplicate ids, unsupported source types, missing required fields, oversized inline budget). Full coverage in [Knowledge — Validating](./04-knowledge.md#verifying).

### What it does not check

- Does **not** fetch knowledge sources. URL/git/Confluence/Jira sources are validated structurally (URL well-formedness, required fields present); the bytes are not pulled.
- Does **not** render or translate. Per-platform translator warnings (e.g. Claude Code dropping `lsp`) only surface at install time.
- Does **not** check that `requires.skills` entries actually exist in any registered catalog. `smith agent install` performs that check and prompts; doctor reports drift.
- Does **not** verify MCP server availability. That is also install-time / doctor-time.

### Output format

```text
PASS triage-bot
  warn File expertise has 35 non-blank lines; recommended range is 40-100
PASS researcher
FAIL release-coordinator
  error description must be at least 10 characters
  warn info: 'model' override set; 'modelTier' will be used for claude-code only.
```

Each bundle prints one of `PASS` or `FAIL` followed by indented `error` lines (only for FAIL) and indented `warn` lines (always shown).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Every bundle passed (warnings do not affect exit) |
| `1` | At least one bundle failed, or no bundle matched the requested name |

The full taxonomy lives in [Error handling](./12-error-handling.md#exit-code-taxonomy).

## Caveats and gotchas

### `--from` cloning validates the source up front

`smith agent init --from <bundle>` schema-validates the source bundle's `agent.config.json` before merging anything into the new bundle (`src/cli/commands/init-agent.ts`). Legacy v0.1.x bundles whose configs use the dropped `tools` field surface a clear migration error here rather than silently losing fields during the merge. If `--from` fails with a list of zod issues, the source bundle itself needs to be brought up to current schema.

The resolver checks the local agents directory first and the bundled `examples/` directory second — local wins on collision so users' edits remain authoritative.

### init-agent stubs deliberately fail validate

`smith agent init` (without `--from`) writes IDENTITY/EXPERTISE/SOUL files containing only a `<!-- TODO -->` marker. These intentionally fail the TODO rule above. Running `smith agent validate` immediately after `agent init` is supposed to fail; the failure is the cue to edit the personas. The architect skill expects this and uses validate output as its signal that authoring is incomplete.

### Info-notes for `model`

Two info-level warnings (still emitted as warnings — `info:` is just a prefix in the message text) fire on the `model` override field:

- `info: 'model' field has no effect because targets do not include opencode.` — you set a `model` literal but `opencode` is not a target. The field will be ignored entirely.
- `info: 'model' override set; 'modelTier' will be used for claude-code only.` — both `model` and `modelTier` are set, and `claude-code` is a target. Claude Code resolves `modelTier` natively and ignores the OpenCode-specific `model` override. This is informational, not an error.

See `src/core/validator.ts` and [Models](./07-models.md) for the full resolution pipeline.

### The bundle dirname must equal `name`

Bundle discovery uses the directory name as the agent identifier. The validator does not currently check that `agent.config.json`'s `name` field matches the dirname — but install paths, uninstall lookups, and the daemon's reinstall trigger all use the dirname. A mismatch produces install-time errors that are difficult to read. If you rename a bundle directory, update `agent.config.json` to match.

### Unknown top-level keys are silently dropped

zod's `z.object({...})` strips unknown keys before refinements run. If you misspell `targets` as `target`, the parser accepts the config (with `targets` set to the schema default — except there is no default, so this fails on a different error). If you add a future field smith does not know about, it silently disappears. Always run `smith agent validate` after editing.

### Knowledge sidecar precedence is per-field, not whole-file

If both inline `knowledge` and a `knowledge.json` sidecar are present, the merge is per-top-level-field. The sidecar does not need to declare `packs` and `inlineBudget` and `sources` to "win" — it can declare just the sources it wants to add or override. Sources collide on `id`.

## See also

- [Getting started](./01-getting-started.md) — how to scaffold a new bundle with `smith agent init`.
- [Installing and rendering](./03-installing-and-rendering.md) — how the bundle is translated into per-platform files.
- [Knowledge](./04-knowledge.md) — the full schema for `knowledge.sources` and the `knowledge.json` sidecar.
- [Skills](./05-skills.md) — the full schema and runtime semantics for `requires.skills`.
- [Permissions and platforms](./06-permissions-and-platforms.md) — the `permission` block schema and per-platform translation.
- [Models](./07-models.md) — `modelTier` and `model` resolution.
- [CLI reference — `smith agent validate`](./14-cli-reference.md#smith-agent-validate-name) — every flag and exit code.
