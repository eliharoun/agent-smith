# Agent Smith — Cheat sheet

Reference for the `smith` CLI. Every command, every flag, every allowed value, in one file.

For concepts, narrative, and design rationale see [`GUIDE.md`](./GUIDE.md).

---

## Table of contents

- [Quick start](#quick-start)
- [Installation & update](#installation--update)
- [GUI](#gui)
- [Commands](#commands)
  - [Setup commands](#setup-commands)
  - [Install & uninstall](#install--uninstall)
  - [Health & maintenance](#health--maintenance)
  - [Configuration](#configuration)
  - [Knowledge](#knowledge)
  - [Skills](#skills)
  - [Daemon](#daemon)
- [Required skills (`requires.skills`)](#required-skills-requiresskills)
- [Platform conventions (`platformConventions`)](#platform-conventions-platformconventions)
- [Error output format](#error-output-format)
- [Exit codes](#exit-codes)
- [Paths reference](#paths-reference)
- [Environment variables](#environment-variables)
- [Debugging](#debugging)

---

## Quick start

**Requires [Bun](https://bun.sh) >= 1.1.0** (the runtime; not just for install).

```bash
npm install -g @eliharoun/agent-smith                           # install the CLI from npm
smith init                                           # create ~/.config/agent-smith and registry
smith init-user                                      # edit ~/.config/agent-smith/USER.md ($EDITOR)
smith agent init my-agent --description "Reviews PRs for style and bugs"
smith agent install my-agent                         # render + install to opencode/claude/codex/kiro
smith doctor                                         # verify installation health (reports only on platforms whose CLI is on PATH: opencode/claude/codex/kiro-cli|kiro; exits 2 + install hint if none)
```

---

## Installation & update

| Step | Command | Notes |
|---|---|---|
| Install (recommended) | `npm install -g @eliharoun/agent-smith` | Ships the CLI, the bundled skills, AND the GUI (`smith gui` works out of the box). Postinstall hook copies `the-architect` + `the-keymaker` into per-platform skill dirs when `bun` is on PATH; otherwise prints a hint and exits cleanly. **Requires `bun >= 1.1.0`** at runtime. |
| Install (from source — for development / live GUI source) | `gh repo clone eliharoun/agent-smith ~/.agent-smith && bash ~/.agent-smith/bin/install` | Clones to `~/.agent-smith/`, runs `bun install` (which fires `scripts/bootstrap.ts` postinstall to install bundled skills), installs the `agent-smith` persona, builds the GUI SPA bundle, and symlinks `~/.local/bin/smith` → `~/.agent-smith/src/index.ts`. Use this to develop `agent-smith` itself or hack on the GUI source (editable source + auto-rebuild on `git pull`); `smith gui` itself is available from the npm install too. Also requires `gh` (or substitute `git clone`). |
| First-time setup | `smith init && smith init-user` | `smith init` creates `~/.config/agent-smith/` and the registry. `smith init-user` opens `USER.md` in `$EDITOR`. Both are idempotent. |
| Update (recommended, both install types) | `smith update` | One upgrade command for source and packaged installs. Source: `git pull --ff-only` + `bun install` + `gui:build` + persona reinstall + doctor. Packaged (npm/bun/pnpm): runs the matching global upgrade (re-firing the postinstall bootstrap hook) then refresh + doctor. If the install manager can't be determined, prints the command instead. |
| Re-install bundled skills | `smith skill bootstrap` | Re-installs `the-architect` + `the-keymaker` skills (normally fired by the postinstall hook). |
| Re-install agent-smith persona | `smith agent install agent-smith` | Re-installs the companion agent (normally part of the from-source `bin/install` and `smith update`). |

Dev invocation (no install): `bun run src/index.ts <cmd>` or `./src/index.ts <cmd>` from inside an `agent-smith` checkout.

The from-source clone at `~/.agent-smith/` IS the install for the source path. There is no separate "user install" vs "dev install" — `cd ~/.agent-smith && git pull` (or `smith update`) updates the running CLI. (Packaged installs have no clone: `smith update` runs the package-manager upgrade instead.)

---

## GUI

```bash
smith gui                   # launch the browser GUI (default port 7777)
smith gui --port 9000       # override port
smith gui --no-open         # don't auto-open browser
smith gui --bind 127.0.0.1  # bind address (localhost-only by default)
```

Browser tab opens with a one-time token in the URL — keep it; reloading without
the token requires the token from the launch output. The GUI wraps every
daily-workflow command; every action shells out to `smith` and streams stdout
back to the page over SSE.

**Routes** (paths under the launched URL):

| Section | Route | Wraps |
|---|---|---|
| Construct | `/` | dashboard (system summary + recent jobs) |
| Onboarding | `/onboarding` | first-run setup wizard |
| Construct | `/agents` | `smith agent list` + per-platform install grid |
| Construct | `/agents?add=true` | unified Add Agent modal (create / install / register agents) |
| Construct | `/agents/install-matrix` | bulk `smith agent install` across platforms |
| Construct | `/agents/:name` | bundle editor (persona files + `agent.config.json`) |
| Construct | `/skills` | `smith skill list` with drift status |
| Construct | `/skills?add=true` | unified Add Skill modal (install existing / register catalog) |
| Construct | `/skills/:name` | skill editor + **Validate** button (→ `smith skill validate <name>`) |
| Construct | `/catalogs` | `smith {agent,skill} catalogs` |
| Construct | `/catalogs?add=register` | deep-link to unified Add Agent modal for `smith {agent,skill} register` |
| Knowledge | `/knowledge` | `smith knowledge list` across agents |
| Knowledge | `/knowledge/:agent` | per-agent knowledge sources (add/fetch/validate); **Edit** modal exposes every per-source field (delivery, retrieval—default `bm25` for search-style queries; see [guide/04](./guide/04-knowledge.md#retrieval-mode)—summary, toc, materialize, extractor, refresh, optional, inlineBudgetTokens) and an **MCP wiring toggle** writes/removes the per-agent key `<agent>-knowledge` from the bundle's `mcpServers`. CLI parity: `smith knowledge wire <agent>` / `smith knowledge unwire <agent>`. |
| Knowledge | `/knowledge/refresh-history` | refresh-mode timeline across agents |
| Knowledge | `/knowledge/:agent/refresh-history` | per-agent refresh history |
| Knowledge | `/system/atlassian-setup` | Atlassian credential setup (Confluence/Jira) |
| System | `/system/doctor` | `smith doctor` + one-click `--fix-knowledge-refresh` + Codex-hooks migration banner |
| System | `/system/daemon` | `smith daemon {start,stop,status}` + live log tail (SSE) + `pullIntervalMs` / `heartbeatIntervalMs` tuning |
| System | `/system/update` | preview commits behind `origin/main` (source installs) + run `smith update` with streamed progress (packaged installs: `smith update` runs the package-manager upgrade) |
| System | `/system/history` | persistent job history with debounced regex search across past output |
| System | `/system/model-config` | per-target model configuration overrides |
| System | `/system/settings` | GUI settings |
| System | `/system/jack-out` | `smith jack-out` with typed-phrase confirm (`jack-out`), MatrixRain runtime, disconnect-as-success semantic |

> **v1.13.0–v1.14.0:** The GUI consolidates agent and skill creation entry points into unified modals. `+ Add agent` (Dashboard, Agents page, Catalogs page) and `+ Add skill` (Dashboard, Skills page) each open a single modal. `/agents/new`, `/catalogs/register`, and `/skills/new` redirect to their modal equivalents automatically — existing bookmarks and docs links continue to work.

**New job commands surfaced only by the GUI:** `daemon.start`, `daemon.stop`,
`update`, `knowledge.migrate-codex`, `skill.validate`, `jack-out`, plus the
extended `doctor` variant with `fixKnowledgeRefresh: boolean`.

**Read-only endpoints (no job spawned):** `GET /api/daemon/{status,env,log/stream}`,
`GET /api/update/preview`, `GET /api/history{,/:id/output,/search}`,
`GET /api/jack-out/dry-run`.

Long-running jobs (`knowledge.refresh`, `update`, `doctor`, etc.) stream output
over SSE; the server uses `idleTimeout: 255` so the stream stays alive for the
full job duration.

---

## Commands

### Setup commands

#### `smith init`

Initialize `~/.config/agent-smith/` with an empty `agents/` dir, a fresh `registry.json`, and a starter `USER.md`. Safe to re-run; will overwrite a version-skewed registry.

**Synopsis:** `smith init`

#### `smith init-user`

Open `USER.md` in your editor. Used to record cross-agent user context (name, role, preferences) that every installed agent inherits.

**Synopsis:** `smith init-user`

**Notes:**
- Editor is `$EDITOR` (defaults to `vi`).

#### `smith agent init <name>`

Scaffold a new agent bundle. Defaults to `~/.config/agent-smith/agents/<name>/`; pass `--catalog <label>` to scaffold into a registered catalog instead. `USER.md` is symlinked to `~/.config/agent-smith/USER.md` for personal catalogs, or written as a stub for `registered` catalogs (safe to commit). Use `--from <bundle>` to clone an existing bundle as a starting point.

**Synopsis:** `smith agent init [flags] <name>`

**Args:**
| Arg | Required | Description |
|---|---|---|
| `<name>` | yes | Bundle name. Must be kebab-case (lowercase letters, digits, hyphens; matches `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`). Becomes the directory name and the agent identifier in every install target. Invalid names exit `2`. |

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--description <text>` | string, 10–200 chars | — (**required** unless `--from` is given) | One-line description shown in agent pickers. Must start with an action phrase (e.g. `Use proactively...`, `Reviews...`, `Builds...`) per the `^(Use\b\|[A-Z][a-z]+s?\b)` regex. |
| `--targets <list>` | comma-list of `opencode\|claude-code\|codex\|kiro\|agents-md` | `opencode,claude-code,codex,kiro` | Which platforms this agent installs to. `agents-md` emits a single AGENTS.md (Cursor / Windsurf / Copilot / Aider / Codex CLI / Devin / Junie / Roo / Zed / Warp / Gemini CLI all consume it). See [guide/16 — Knowledge compiler](./guide/16-knowledge-compiler.md#the-agents-md-target). |
| `--model-tier <tier>` | enum: `balanced\|fast\|high\|inherit` (aliases: `opus`, `sonnet`, `haiku`) | `balanced` | Capability tier the agent expects. `inherit` defers to the calling agent's model. See [Models](./guide/07-models.md). |
| `--mode <mode>` | enum: `primary\|subagent\|all` | (unset) | `primary` = user-facing, picker-listed. `subagent` = invocable only via Task tool. `all` = both. When unset, downstream platform translators decide picker visibility. |
| `--permission <preset>` | enum: `read-only\|read-edit\|full` | (unset) | Pre-built permission preset. `read-only` denies write/exec. `read-edit` allows file edits but no shell. `full` allows everything. When unset, the bundle inherits the platform's default permission set. |
| `--permission-json <json>` | raw `PermissionConfig` JSON | — | Custom permission map. **Overrides `--permission`** if both are given. |
| `--mcp-servers <list>` | comma-list | empty | MCP server names to wire into the agent. |
| `--skills <list>` | comma-list | empty | Bundled skill names to bake into the agent's prompt. |
| `--requires-skills <list>` | comma-list of `name` or `catalog/name` | empty | Runtime skill dependencies. `smith agent install` auto-checks and offers to install missing ones. See [Required skills](#required-skills-requiresskills). |
| `--from <bundle>` | bundle name | — | Clone an existing bundle's files (IDENTITY/EXPERTISE/SOUL) as the new starting point. Inherits `--description` from the source if not overridden. Mutually exclusive with `--from-apm`. |
| `--from-apm <path>` | path to `apm.yml` | — | Import a Microsoft APM bundle (`apm.yml`) as the starting point. Maps APM `runtimes` to smith `targets`, converts `references[]` to knowledge sources, forces `compile.progressive=true` and `compile.emitAgentsMd=true`. One-way. See [guide/16 — APM import](./guide/16-knowledge-compiler.md#apm-import-smith-agent-init---from-apm). |
| `--catalog <label-or-path>` | string | — | Scaffold into a registered agent catalog by label or absolute path; refused if not registered. See [Sharing & distribution § 2.2](./guide/15-sharing-and-distribution.md#22-scaffold-into-the-catalog-directory). |

**Notes:**
- Invalid enum values exit `2` with the accepted list printed.
- A `<name>` already in use exits `2`. To reuse the name, run `smith agent destroy <name>` first (NOT `agent uninstall`, which leaves the source bundle in place). An unregistered `--catalog` value also exits `1` (`not-found`); run `smith agent catalogs` to list valid labels.

**Example:**
```bash
smith agent init code-reviewer \
  --description "Reviews PRs for style and bugs" \
  --targets opencode,claude-code \
  --mode subagent \
  --permission read-only \
  --requires-skills the-architect
```

#### `smith agent register <path>`

Add an agent catalog (a directory containing one or more agent bundles) to the registry. Validates that the path exists, contains agent bundles, and (if `--git-remote` is set) is a git repo whose remotes match.

**Synopsis:** `smith agent register --kind <kind> [flags] <path>`

**Args:**
| Arg | Required | Description |
|---|---|---|
| `<path>` | yes | Absolute or relative path to the catalog directory. |

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--kind <kind>` | enum: `user-global\|project\|registered` (**required**) | — | `user-global` = your `~/.config/agent-smith/agents/`. `project` = a per-repo `.agent-smith/` dir. `registered` = a shared/team catalog tracked in git. |
| `--label <label>` | string | derived from path | Display label for `smith agent list` / `smith status`. |
| `--git-remote <url>` | URL | — | Required-remote URL for `kind=registered`. Validated against actual git remotes. When the URL matches a catalog already in either registry, smith prints a one-line warning (does NOT refuse — duplicate links are sometimes legitimate). Use `smith doctor` (`duplicate-catalogs` section) to audit the resulting clusters. |
| `--allow-empty` | bool | `false` | Allow registering a catalog dir that contains zero bundles. |
| `--skip-git-check` | bool | `false` | Skip the git-remote validation. |

**Example:**
```bash
smith agent register ~/work/team-agents --kind registered --git-remote git@github.com:acme/team-agents.git
```

> See [guide/15 — Sharing and distribution](./guide/15-sharing-and-distribution.md) for the end-to-end publisher + consumer flow, knowledge portability matrix, and team patterns.

#### `smith agent unregister <path>`

Remove an agent catalog from the registry. Path is normalized identically to `agent register`.

**Synopsis:** `smith agent unregister [--purge-clone] <path>`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--purge-clone` | bool | `false` | Also `rm -rf` the on-disk clone. Layered safety guard: refused unless **all four** hold — catalog mode is `managed`, `rootPath` is contained under `<stateHome>/remote/`, target contains a `.git/`, and `git remote get-url origin` matches the registered `remote.url` (modulo URL normalization). Failure surfaces the exact guard that tripped. Use when you want to fully retire a catalog installed via `agent install --from <url>`. |

**Notes:**
- Exits `1` if the path isn't a registered catalog.
- `--purge-clone` on a non-`<stateHome>/remote/` path exits `2` (`usage-error`) with a hint.

#### `smith agent list`

Print every bundle across every registered agent catalog, with target-install status.

**Synopsis:** `smith agent list`

#### `smith agent catalogs`

List registered agent catalogs. Parity with `smith skill catalogs`. Each row carries a dim `[managed]` or `[linked]` badge: **managed** catalogs are smith-owned clones (installed via `agent install --from <url>`, located under `<stateHome>/remote/`) — eligible for `sync` and `unregister --purge-clone`; **linked** catalogs are user-owned working copies (registered via `agent register`) — smith never modifies them.

**Synopsis:** `smith agent catalogs`

#### `smith agent sync [name]`

Pull updates from the upstream git remote for one or all remote-backed agent catalogs (catalogs registered with a `remote` block — typically those installed via `agent install --from <url>`). Catalogs without a `remote` are skipped silently. Updates `lastPulledSha`, `lastRemoteSha`, and timestamps in `registry.json` after each successful pull.

**Synopsis:** `smith agent sync [--check] [--all] [name]`

**Args:**
| Arg | Required | Description |
|---|---|---|
| `[name]` | conditional | Catalog label OR rootPath. Required unless `--all`. Mutually exclusive with `--all` (exits `2`). |

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--all` | bool | `false` | Sync every remote-backed catalog. Partial failure (some pulls fail, some succeed) exits `3` (`EXIT_PARTIAL`); the successful pulls still persist their SHAs. |
| `--check` | bool | `false` | Probe remote HEAD via `git ls-remote` only — do not touch the working tree or `lastPulledSha`. Updates only `lastRemoteSha` + `lastCheckedAt`. Use as a cheap "anything to pull?" check; pair with `smith doctor` to surface drift. |

**Exit codes:** `0` all pulls succeeded · `2` usage error (no name and no `--all`, or both) · `2` no remote-backed catalog matched · `3` partial (some succeeded, some failed) · `1` all attempted pulls failed.

**Examples:**
```bash
smith agent sync acme/team-agents              # pull one catalog by label
smith agent sync ~/.local/state/agent-smith/remote/github.com/acme/team-agents  # by path
smith agent sync --all                         # pull every remote-backed catalog
smith agent sync --all --check                 # offline probe; refresh lastRemoteSha
```

#### `smith agent validate [name]`

Lint one or all agent bundles against the schema. Exits `1` if any fail.

**Synopsis:** `smith agent validate [name]`

**Args:**
| Arg | Required | Description |
|---|---|---|
| `[name]` | no | If omitted, validates every bundle in the registry. |

#### `smith status`

Print canonical paths plus an `Agent catalogs (N)` and `Skill catalogs (N)` summary.

**Synopsis:** `smith status`

**Notes:** When any registered catalog still resides at the rc.1 clone location (`<configDir>/remote/...`), `status` appends a one-line yellow nudge directing you to `smith migrate-clones`.

---

### Install & uninstall

#### `smith agent install [name]`

Build the agent and write rendered files to all target platforms (opencode/claude-code/codex/kiro). Resolves `requires.skills` per the chosen mode. Without `<name>`, prints the list of available agents plus install hints and exits `2`.

**Synopsis:** `smith agent install [flags] [name]`

**Args:**
| Arg | Required | Description |
|---|---|---|
| `[name]` | no | Bundle name. Without it, prints available agents + hint and exits `2`. |

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--yes` | bool | `false` | Auto-accept required-skill prompts (equivalent to `--with-skills` for skills). Does **not** auto-accept the refresh-hook consent prompt — use `--refresh-consent yes` for that. |
| `--with-skills` | bool | `false` | Auto-install missing required skills without prompting. |
| `--no-skills` | bool | `false` | Skip required-skill installs entirely; warn at end. |
| `--no-refresh-hooks` | bool | `false` | Skip refresh hook install; no consent prompt, no `SessionStart` block written, no `refresh-manifest.json`. Refresh stays manual via `smith knowledge fetch`. |
| `--refresh-consent <yn>` | enum: `y\|yes\|n\|no` (case-insensitive) | — | Pre-answer the refresh-hook consent prompt. Required in non-TTY/CI when you want hooks (default in non-TTY is *no* with a warning). See [guide/04 — Consent and the refresh manifest](./guide/04-knowledge.md#consent-and-the-refresh-manifest). |
| `--from <url-or-path>` | git URL **or** archive path/HTTPS URL **or** local directory path | — | Three modes. **Git URL:** clone the repo, register it under `<stateHome>/remote/<host>/<owner>/<repo>`, then install. **Archive (`.smith-bundle.tgz`):** verify, hash-check, stage under `<stateHome>/imported/<sha-prefix>/<name>/`, register as an imported-archive catalog, then install. **Local directory path:** register-as-catalog, then install. HTTPS URLs are downloaded with a 200 MB cap; loopback / link-local / RFC1918 hosts are refused. The local-directory mode prints a one-line stderr hint when the directory is a git repo, suggesting `smith agent register --git-remote` to enable `smith agent sync`. Skips local lookup; `[name]` becomes optional when the source contains exactly one bundle. See [guide/15 — Sharing & distribution](./guide/15-sharing-and-distribution.md#9-sharing-via-direct-url). |
| `--ref <ref>` | git ref | remote HEAD | Git branch, tag, or SHA to check out after cloning with `--from`. Ignored without `--from`. |
| `--force` | bool | `false` | Bypass smith's would-clobber refusal: write the rendered file even if the destination exists and isn't claimed by smith's `installed-agents.json` manifest. Also re-claims a manifest entry whose recorded path no longer matches the new render's relativePath (rename / translator change). |
| `--allow-missing-mcp` | bool | `false` | Demote missing-MCP-server errors to warnings (install blocks by default). |
| `--allow-missing-cli` | bool | `false` | Demote missing-platform-CLI errors to warnings; resolver emits the static tier literal instead of dropping the target. |
| `--platforms <list>` | comma-list of `opencode\|claude-code\|codex\|kiro\|agents-md` | all declared targets | Restrict install to specific platforms (subset of the agent's declared targets). |
| `--all` | bool | `false` | Install every agent discovered in `--from <url>`. |
| `--agents <list>` | comma-list | — | Comma-separated agent names to install from `--from <url>`. |
| `--json` | bool | `false` | Discover agents from `--from <url>`, print JSON, do not install. |
| `--verbose` | bool | `false` | Show info-level warnings (pattern fallbacks, platform truisms). |
| `--platform-conventions <strategy>` | enum: `accept-all\|reject-all\|use-defaults\|prompt` | (3-tier resolver) | Convention-injection strategy. Per-bundle `platformConventions` field wins (tier 1); else `~/.config/agent-smith/conventions.json` saved prefs (tier 2); else this flag → interactive prompt (TTY) → fail-safe-reject (non-TTY). `accept-all` emits every registered convention for every target; `use-defaults` emits only those marked `promptDefault: true`. |
| `--no-platform-conventions` | bool | `false` | Alias for `--platform-conventions=reject-all` (this run only; doesn't persist to `conventions.json`). |
| `--force-unlock` | bool | `false` | Drop a stuck per-agent install lock (left by a killed run) before installing. |

**Notes:**
- Skill-mode precedence: `--no-skills` wins, then `--yes`/`--with-skills` (auto-install), else default `prompt`.
- Skill install failures NEVER abort the agent install — they degrade to warnings.
- On non-TTY environments without `--yes`, skill prompts auto-skip with a warning.
- Refresh-hook consent fires for agents with at least one Claude-Code- or Codex-targeted `session`/`always` knowledge source. The manifest at `~/.config/agent-smith/agents/<name>/refresh-manifest.json` records granted platforms and is written after a successful install; `smith agent uninstall` removes it cleanly.
- For codex consents, smith also writes a `SessionStart` entry to `~/.codex/hooks.json` (smith-managed via a `_smith_managed` ownership marker) and prints a one-line advisory: open codex and type `/hooks` to trust the entry. Install fails if `~/.codex/hooks.json` already exists without the marker (smith refuses to overwrite user-owned hook config). Uninstall removes the agent's entry and deletes the file when the last codex-consenting agent is removed.
- For opencode consents, smith installs a global plugin at `~/.config/opencode/plugins/agent-smith-refresh/` and registers it in `opencode.json`. It refreshes the superset of installed opencode-targeted agents on every `session.created` (no per-session-agent scoping). Uninstalling the last consenting opencode agent removes the plugin entirely.
- `--refresh-consent <yn>` broadcasts to every consent-eligible platform on the install — there is no per-platform variant.

**Example:**
```bash
smith agent install code-reviewer --with-skills
```

#### `smith agent install-all`

Install every bundle in every registered catalog. Same flag set as `agent install` (including `--force`, `--platform-conventions`, `--no-platform-conventions`, `--platforms`, `--allow-missing-mcp`, `--allow-missing-cli`, `--refresh-consent`).

**Synopsis:** `smith agent install-all [--yes] [--with-skills] [--no-skills] [--force] [--platform-conventions <strategy>] [--no-platform-conventions] [--platforms <list>] [--allow-missing-mcp] [--allow-missing-cli] [--refresh-consent <yn>]`

#### `smith agent export <name>`

Package a bundle into a single `.smith-bundle.tgz` archive that a recipient can install via `smith agent install --from <archive>`. Embeds local knowledge (`type: file` / `dir` / `glob`) and — by default — every skill in `requires.skills[]`. Does NOT contain MCP servers, credentials, or remote knowledge content; those are declared in the manifest and the recipient brings or fetches them at install time.

**Synopsis:** `smith agent export [--format <archive|directory>] [--to <path>] [--stdout] [--include-skills | --no-include-skills] [--user-md <stub|keep|reject>] [--compression <gzip|none>] [--with-readme] [--no-manifest] [--force] [--json] [--dry-run] <name>`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--to <path>` | path | `.` | Output directory or file path. Directory targets produce `<name>-<sha>.smith-bundle.tgz`. |
| `--stdout` | bool | `false` | Stream archive bytes to stdout (logs go to stderr). Mutually exclusive with `--to`. |
| `--include-skills` / `--no-include-skills` | bool | embed | When on, embed required skill source dirs under `skills/<name>/`. When off, declare in `requires.skills[]` and let the recipient resolve from their own catalogs. |
| `--user-md <policy>` | enum | `stub` | `stub` always emits the canonical `USER.md` stub; `keep` ships verbatim; `reject` refuses if not already a stub. |
| `--compression <gzip\|none>` | enum | `gzip` | Use `none` to skip gzip wrapping when streaming through your own compression layer. |
| `--json` | bool | `false` | Emit machine-readable progress on stderr; artifact path on stdout. |
| `--dry-run` | bool | `false` | Plan and validate; print the manifest; write nothing to disk. |
| `--format <mode>` | enum: `archive\|directory` | `archive` | Output format. `directory` writes loose files at `<--to>/<name>/` for committing into a git repo. |
| `--with-readme` | bool | `false` | Directory mode: include the auto-generated README.md (off by default; the README's content is intended for archive recipients). |
| `--no-manifest` | bool | `false` | Directory mode: drop `_smith-export.json`. Default keeps the manifest so downstream `smith` commands can read it. |
| `--force` | bool | `false` | Directory mode: replace `<--to>/<name>/` if it already exists (full replace, not merge). |

**Notes:**
- Refuses bundles whose knowledge sources use absolute paths or paths that escape the bundle directory — the producer fixes the source declarations and re-exports.
- Re-running with the same inputs produces a byte-identical archive (modulo timestamps, which are ms-stripped for determinism).
- Recipient side: `smith agent install --from <path-or-https-url-to-archive>` accepts both local paths and HTTPS URLs ending in `.smith-bundle.tgz`. Imported catalogs surface as `(imported-archive)` in `smith agent list` / `smith agent catalogs`; `smith agent sync` against an imported-archive label prints an advisory and exits `0` instead of attempting a git pull.

**Example:**
```bash
smith agent export code-reviewer --to ~/Downloads/
# → ~/Downloads/code-reviewer-abc1234.smith-bundle.tgz
# Hand the archive (or its HTTPS URL) to a teammate; they run:
smith agent install --from ~/Downloads/code-reviewer-abc1234.smith-bundle.tgz
```

See [guide/15 — Sharing via exported archive](./guide/15-sharing-and-distribution.md#98-sharing-via-exported-archive) for the full publisher / consumer flow.

#### `smith agent uninstall <name>`

Remove rendered files for one agent from every target platform. **Source bundle in `~/.config/agent-smith/agents/<name>` is left intact** — use `agent destroy` to remove that too.

**Synopsis:** `smith agent uninstall [--dry-run] [--force] [--platforms <list>] <name>`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | bool | `false` | Print what would be removed without touching the filesystem. |
| `--force` | bool | `false` | Bypass smith's hash-mismatch refusal: delete the smith-installed file even if its on-disk hash no longer matches the recorded `installed-agents.json` `contentHash` (file was modified externally). Without `--force`, externally-modified files are preserved as a safety guard. |
| `--platforms <list>` | comma-list of `opencode\|claude-code\|codex\|kiro` | all four | Restrict uninstall to specific platforms (intersected with the bundle's declared targets). |

**Notes:**
- Exits `3` (partial-failure) if some platform removals fail; `1` on unrecoverable error (including a hash-mismatch refusal — surfaced as `SmithError("already-exists")` with a `--force` suggestion in `suggestedCommand`).
- Also removes any per-agent knowledge directory under each platform.
- Hash-mismatch refusals are aggregated across platforms in `UninstallResult.refused[]`; `--force` empties the array and deletes anyway.

#### `smith agent uninstall-all`

Remove every registered agent's rendered files from every target. Prompts unless `--yes`.

**Synopsis:** `smith agent uninstall-all [--dry-run] [--yes] [--force] [--platforms <list>]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | bool | `false` | Print planned removals without touching the filesystem. |
| `--yes` | bool | `false` | Skip the `y/yes` confirmation prompt. |
| `--force` | bool | `false` | Bypass hash-mismatch refusal across every bundle in the run. Same semantics as `agent uninstall --force`. |
| `--platforms <list>` | comma-list of `opencode\|claude-code\|codex\|kiro` | all four | Restrict uninstall to specific platforms across every bundle. |

#### `smith agent destroy <name>`

Inverse of `agent init`: remove the source bundle from `~/.config/agent-smith/agents/<name>`. Refuses if rendered files still exist (use `--force` to chain `agent uninstall` first). Only operates on `user-global` bundles.

**Synopsis:** `smith agent destroy [--dry-run] [--yes] [--force] <name>`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | bool | `false` | Print planned changes without touching the filesystem. |
| `--yes` | bool | `false` | Skip the typed-token confirmation (you'd otherwise have to retype `<name>`). |
| `--force` | bool | `false` | Run `agent uninstall <name>` first if rendered files still exist AND bypass the hash-mismatch refusal on the chained uninstall (destroy is irrevocable by design — any drift on smith-installed files is overridden). |

**Notes:**
- Exits `1` if `<name>` is not a `user-global` bundle (project / registered bundles are owned by their catalogs, not by smith).

#### `smith agent reconfigure <name>`

Grant or revoke per-platform knowledge-refresh consent on an already-installed agent. Updates `~/.config/agent-smith/agents/<name>/refresh-manifest.json` and installs/removes the platform's session_start hook (claude-code frontmatter block, codex `hooks.json` entry, or opencode plugin registration) accordingly. Idempotent — re-granting an already-granted platform is a no-op.

**Synopsis:** `smith agent reconfigure <name> [--grant <platform>...] [--revoke <platform>...] [--yes]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--grant <platform>` | repeatable; one of `opencode\|claude-code\|codex\|kiro` | — | Add refresh consent for the named platform. Platform must be a target of the installed agent. |
| `--revoke <platform>` | repeatable; same enum | — | Remove refresh consent for the named platform. |
| `--yes` | bool | `false` | Grant refresh hooks for every platform the agent is installed for (non-interactive). Mutually exclusive with `--grant`/`--revoke`. |

**Notes:**
- Use when you installed the agent before the consent flow shipped (pre-0.15), or want to add a newly-added platform to refresh consent.
- Exits `2` on unknown agent / unknown platform / agent not installed on the requested platform.

**Example:**
```bash
smith agent reconfigure my-agent --grant opencode
smith agent reconfigure my-agent --revoke claude-code
smith agent reconfigure my-agent --grant codex --revoke opencode    # combo
```

#### `smith jack-out`

Full offboarding. Delegates per-bundle cleanup to `agent destroy --yes --force` for every bundle owned by smith (i.e. `user-global` bundles under `<configDir>/agents/`), then uninstalls every entry in `installed-skills.json`, removes `<configDir>/`, removes runtime-state files (`daemon.{pid,log,heartbeat.json}`, `gui-jobs.jsonl`, `gui-jobs-output/`) from `<runtimeStateHome>/`, removes the CLI symlink at `~/.local/bin/smith`, strips the agent-smith marker block from your shell rc (`.zshrc`/`.bash_profile`/`.bashrc`), then removes the source clone at `~/.agent-smith/`. Preserves: `<runtimeStateHome>/remote/` (managed via `unregister --purge-clone`) and any catalogs registered outside `<configDir>`. Requires the typed token `jack-out` for confirmation.

**Synopsis:** `smith jack-out [--dry-run] [--yes]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | bool | `false` | Print everything that would be removed. |
| `--yes` | bool | `false` | Skip the typed-token confirmation. |

**Notes:**
- Exits `1` on confirmation mismatch / unrecoverable error; `3` if some removals succeed but others fail.

---

### Health & maintenance

#### `smith doctor`

Health check across up to 17 sections: `opencode`, `claude-code`, `codex`, `kiro`, `model-resolution`, `workspace`, `atlassian-auth`, `skill-drift`, `agent-required-skills`, `registry-hygiene`, `remote-catalogs`, `duplicate-catalogs`, `mcp-deps`, `knowledge-refresh`, `knowledge-compile`, `knowledge-prompt-disk-consistency`, `agent-drift`. Platform sections (`opencode`/`claude-code`/`codex`/`kiro`) and the OpenCode-specific `model-resolution` section are auto-filtered to the platforms whose CLI binary (`opencode`/`claude`/`codex`/`kiro-cli` or `kiro`) is detected on PATH. The `remote-catalogs` section is offline-safe — it reports drift recorded by prior `sync --check` runs (`lastPulledSha` vs. `lastRemoteSha`) and entries whose `lastCheckedAt` is older than 7 days; live drift detection requires running `smith agent sync --check --all`. The `duplicate-catalogs` section groups both registries by normalized git URL (scheme/case/`.git`-suffix insensitive) and warns on clusters of size ≥ 2 so users can clean up duplicate registrations accumulated under rc.1 (which did not refuse duplicate `install --from` runs); informational only — never affects exit code.

**Synopsis:** `smith doctor [-v|--verbose] [-q|--quiet] [--json] [--offline] [--no-cache] [--skip-model-resolution] [--fix-knowledge-refresh] [--fix-knowledge-compile] [--fix-mcp-commands]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `-v, --verbose` | bool | `false` | Print full per-section detail report (the pre-v0.13 default). |
| `-q, --quiet` | bool | `false` | Suppress all human output; preserve exit code. For CI scripts (`smith doctor -q \|\| alert`). Mutually exclusive with `--verbose` (exits `2`). |
| `--offline` | bool | `false` | Skip the live OpenCode schema fetch; report vendored-only. Use this on an unreliable network. |
| `--no-cache` | bool | `false` | Bypass the 24-hour OpenCode schema cache and re-fetch fresh. |
| `--json` | bool | `false` | Machine-readable JSON output; disables spinners. Includes a `skippedPlatforms: PlatformId[]` field (always present, empty when all four are installed). |
| `--skip-model-resolution` | bool | `false` | Skip the v0.6.0 model-resolution check (faster but less complete). Auto-skipped when OpenCode is not on PATH. |
| `--fix-knowledge-refresh` | bool | `false` | Auto-repair drift in the `knowledgeRefresh` section: `missing-hook` and `orphaned-consent` route through `smith agent reconfigure`; `corrupt-cache` removes the bad meta file (next refresh repopulates). `unmanaged-codex-hooks` is **not** auto-fixed — prints a hint to run `smith knowledge migrate-codex`. See [guide/14 — Knowledge-refresh drift](./guide/14-cli-reference.md#knowledge-refresh-drift-and-auto-repair). |
| `--fix-knowledge-compile` | bool | `false` | Auto-repair drift in the `knowledgeCompile` section: re-runs `smith knowledge compile <agent>` for every `missing-manifest` or `drift` finding. Both kinds repair via the same path because a re-compile rebuilds the TOC stanza and overwrites a stale or corrupt `compile-manifest.json` from the already-materialized files. See [guide/14 — Knowledge-compile drift](./guide/14-cli-reference.md#knowledge-compile-drift-and-auto-repair). |
| `--fix-mcp-commands` | bool | `false` | Auto-repair fragile MCP server `command` fields by rewriting bare names (e.g. `smith`) to absolute paths so GUI launches from Spotlight/dock spawn correctly. Use after a doctor `mcp-deps` section flags fragile-command findings. |

**Notes:**
- Exit code is its own taxonomy: `0` = clean, `1` = drift detected, `2` = network error. `smith update` propagates this verbatim.
- When **no** supported platform CLI is on PATH, `smith doctor` refuses to run, prints install hints for OpenCode/Claude Code/Codex/Kiro, and exits `2`. In `--json` mode the refusal emits `{ error: "no-platform-detected", message, exitCode: 2 }`.
- Set `SMITH_DEBUG=1` to print spinner-internal debug lines while running.

**Example:**
```bash
smith doctor --offline --no-cache              # full diagnostic, no network
smith doctor --verbose                          # full per-section detail (the pre-v0.13 default)
smith doctor --json | jq '.sections[].status'  # quick status check
smith doctor --fix-knowledge-refresh           # auto-repair refresh-hook drift
smith doctor --fix-knowledge-compile           # auto-repair compile-manifest drift
```

#### `smith update`

Pull the latest `agent-smith` from `origin/main`, run `bun install`, refresh the bundled `agent-smith` knowledge dir, and verify with `doctor`.

**Synopsis:** `smith update [--dry-run]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | bool | `false` | Show what update would do without pulling, installing, or running doctor. |

**Notes:**
- **Pipeline (7 steps):** resolve workspace → `git pull --ff-only` → `bun install` → rewrite `~/.local/bin/smith` launcher (idempotent; same shape as `bin/install` Step 6) → `bun run gui:build` → `smith agent install agent-smith` (refreshes knowledge dir) → `smith doctor`. Launcher / GUI-build / reinstall failures are warn-and-continue; final exit is `3` (EXIT_PARTIAL) if any of them failed and doctor passed.
- Workspace dirty (`git status` not clean) inside `~/.agent-smith/` exits `1`.
- Workspace not resolvable from `import.meta.url` (running from outside the clone) exits `1` with a reinstall hint.
- `git pull` / `bun install` / `git fetch` / `gui:build` / `agent-smith` reinstall failures emit `3` (EXIT_PARTIAL).
- `update` propagates `doctor`'s exit code verbatim as the final pipeline step — so an `update` exit of `2` after a successful pull means doctor saw a network error.

---

### Configuration

#### `smith config get [key]`

Read a model-resolution config value from `~/.config/agent-smith/.env`. When a key is given, prints the value (or `(unset)` if valid but absent). When no key is given, prints a full config overview.

**Synopsis:** `smith config get [key]`

**Keys:** `model.providers`, `model.tier.high`, `model.tier.balanced`, `model.tier.fast`

**Exit codes:** `0` — value printed (including `(unset)`), or full overview. `1` — invalid key.

#### `smith config set <key> <value>`

Write a model-resolution config value to `~/.config/agent-smith/.env`.

**Synopsis:** `smith config set <key> <value>`

**Keys:** `model.providers`, `model.tier.high`, `model.tier.balanced`, `model.tier.fast`

**Examples:**
```bash
smith config set model.providers "anthropic,github-copilot,openrouter"
smith config set model.tier.high "anthropic/claude-opus-4"
```

**Exit codes:** `0` — written. `1` — invalid key.

#### `smith config unset <key>`

Remove a model-resolution config value from `~/.config/agent-smith/.env` (reverts to auto-detection).

**Synopsis:** `smith config unset <key>`

**Exit codes:** `0` — removed (or was already absent). `1` — invalid key.

**See also:** [Models](./guide/07-models.md) for the full resolution pipeline.

---

### Knowledge

`smith knowledge <subcommand>` — manage per-agent knowledge sources (URLs, files, directories, git repos, Confluence spaces, Jira queries).

Bare `smith knowledge` exits `2` with a hint to pass a subcommand.

**Knowledge source types:**

| Type | What it fetches |
|---|---|
| `file` | A single file from disk |
| `dir` | All files in a folder (optionally filtered) |
| `glob` | Files matching a wildcard pattern across folders |
| `webpage` | A single web page |
| `web` | Multiple pages from a website (crawl links, read llms.txt, or parse an OpenAPI spec) |
| `git` | Selected files from a cloned git repo |
| `npm` | *(not yet implemented)* |
| `confluence` | Pages from a Confluence wiki space |
| `jira` | Issues from a Jira search query |
| `mcp` | Data from an external tool (Notion, Slack, GitHub, …) via an MCP connector |

Materialized URL sources land as `.html` / `.md` files with YAML frontmatter (`title`, `source_url`, `fetched_at`). Use this metadata to cite sources or audit when a corpus was last refreshed.

#### `smith knowledge list <agent>`

Print materialized knowledge for one agent, or — if the agent declares sources but hasn't been installed — print the unmaterialized list with a hint to run `smith agent install <agent>`.

**Synopsis:** `smith knowledge list [--json] <agent>`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--json` | bool | `false` | Emit machine-readable JSON instead of human output. |

**Notes:**
- Exits `0` for declared-but-unmaterialized agents (with the install hint). Only exits `1` when the agent itself isn't registered.

#### `smith knowledge info <agent>`

Read-only index diagnostics — is hybrid retrieval active (vs BM25-only)? Shows the embedder, total chunks, vector count + coverage %, code-mapped path count, and per-source retrieval modes (lazy webpage sources show as "not indexed (runtime fetch)").

**Synopsis:** `smith knowledge info [--json] <agent>`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--json` | bool | `false` | Emit machine-readable JSON instead of human output. |

**Notes:**
- Reads the on-disk index, so it reports what a fresh knowledge-server spawn would serve — restart a running server to pick up changes.

#### `smith knowledge fetch <agent>`

Re-acquire `<agent>`'s knowledge sources and re-render its prompts. With `--source <id>`, surgically refreshes only that source — other sources' caches and content are untouched. After every successful refresh, writes `~/.cache/agent-smith/agents/<agent>/sources/<id>.meta.json` so the GUI's refresh-history view has data.

**Synopsis:** `smith knowledge fetch [--source <id>] [--force-unlock] <agent>`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--source <id>` | string | — | Surgically refresh ONLY this source: clears just that source's URL/git acquirer cache (other sources' caches stay intact), re-acquires it, and writes its `.meta.json`. Without the flag, every source is re-fetched. |
| `--force-unlock` | bool | `false` | Drop a stuck per-agent install lock left by a killed earlier run. ENOENT is silent. Same contract as `smith agent install --force-unlock`. |

**Example:**
```bash
smith knowledge fetch code-reviewer --source api-docs
```

#### `smith knowledge compile [name]`

Force-compile a bundle's already-materialized knowledge sources into a TOC stanza + `compile-manifest.json` (progressive disclosure). Reads the materialized files written by the most recent `smith knowledge fetch` / `smith agent install` — does **not** re-fetch from the network or spawn MCP servers. Exits with a "run smith knowledge fetch first" hint if a source has never been materialized. Compiles regardless of the smart-default threshold or an explicit `compile.progressive` opt-in/opt-out (the user explicitly typed it). `smith agent install` makes the implicit decision via the smart default; this command is for offline iteration, CI drift checks, or pre-warming the manifest.

**Synopsis:** `smith knowledge compile [name] [--all]`

**Args:**
| Arg | Required | Description |
|---|---|---|
| `[name]` | conditional | Bundle name. Required unless `--all`. Mutually exclusive with `--all`. |

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--all` | bool | `false` | Force compile for every registered bundle that has at least one knowledge source. Bundles with no knowledge block / no sources are skipped (one warn line per bundle); exits non-zero only if all targeted bundles were skipped. |

**Exit codes:** `0` — compiled. `1` — runtime error. `2` — usage (no name and no `--all`, or both; named bundle has no knowledge block / no sources; `--all` matched no bundles with sources).

**Example:**
```bash
smith knowledge compile my-agent
smith knowledge compile --all
```

See [guide/16 — Knowledge compiler](./guide/16-knowledge-compiler.md).

#### `smith knowledge serve <name>`

Serve an agent's knowledge over MCP via a persistent index (SQLite FTS5). Three tools exposed:

- `knowledge.search(query, k=5)` — lexical BM25 by default; `retrieval: hybrid` sources also fuse semantic vector ranking when the on-device embedding model is available.
- `knowledge.fetch(path, start?, end?)` — range-bounded file read.
- `knowledge.map(focus?, mapTokens?)` — ranked structural symbol map (tree-sitter + PageRank). **Capability-gated: advertised only when code sources are indexed.**

Stdio transport. Wire into a platform's MCP config: `command: smith`, `args: ["knowledge", "serve", "<name>", "--stdio"]`.
  - **Changing `retrieval.mode` (e.g. hybrid)?** Restart the knowledge MCP server to apply — reconnect `<agent>-knowledge` in your client (`/mcp` → reconnect) or start a new session. The server loads the index + embedder once at spawn.

**Synopsis:** `smith knowledge serve <name> [--stdio]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--stdio` | bool | `true` | Serve over stdio (MCP). Currently the only transport. |

**Exit codes:** `0` — server exited cleanly on stdin EOF. `1` — runtime error. `2` — agent not registered; `--stdio false` passed.

**Retrieval modes** (`retrieval.mode` per source in `agent.config.json`):

| Mode | Effect |
|---|---|
| `off` | Source excluded from search TOC annotation; still readable via `knowledge.fetch`. |
| `bm25` *(default)* | Lexical FTS5 index; TOC annotated `(searchable: bm25)`. |
| `hybrid` | Lexical + semantic vector ranking (RRF fusion); degrades to `bm25` when embedding model unavailable. |
| `external-mcp` | Declares an external MCP URL for search; local index still built. Requires `mcpUrl`. |

See [guide/16 — `smith knowledge serve --stdio`](./guide/16-knowledge-compiler.md#smith-knowledge-serve---stdio).

#### `smith knowledge wire <agent>`

Wire a bundle's knowledge MCP server into the AI client configs that smith detects (Claude Code, OpenCode, Codex, Kiro). Adds the per-agent key (`<agent>-knowledge`) to the bundle's `mcpServers[]` and writes the spawn entry into each platform's MCP config. Mirrors the GUI MCP-wiring toggle.

**Synopsis:** `smith knowledge wire <agent> [--platforms <list>]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--platforms <list>` | string | all detected | Comma-separated subset of `claude-code,opencode,codex,kiro`. |

**Example:**
```bash
smith knowledge wire billing-expert
smith knowledge wire billing-expert --platforms claude-code,codex
```

#### `smith knowledge unwire <agent>`

Inverse of `wire`: removes the per-agent key from the bundle's `mcpServers[]` and deletes the spawn entry from each AI client's MCP config.

**Synopsis:** `smith knowledge unwire <agent> [--platforms <list>]`

**Example:**
```bash
smith knowledge unwire billing-expert
```

#### `smith knowledge route <agent>`

Run the interactive MCP server/tool picker against existing URL knowledge sources and persist the chosen route as `via: { server, tool }` in `agent.config.json`. By default, iterates every URL source that does NOT already have `via:` set, skipping already-routed sources to avoid double-prompting. With `--source <id>`, runs the picker against that single source whether or not it already has `via:`. Designed for retroactively routing internal/auth-gated URL sources through an MCP fetcher (e.g. an internal-wiki MCP) without hand-editing JSON.

**Synopsis:** `smith knowledge route <agent> [--source <id>] [--clear-via]`

**Flags:**

| Flag | Type | Default | Description |
|---|---|---|---|
| `--source <id>` | string | — | Route only the source with this id (default: every URL source without `via:`). |
| `--clear-via` | bool | `false` | Remove `via:` from the source identified by `--source`, switching it back to direct-HTTP fetching. Requires `--source`. `mcpServers[]` and `mcp.required[]` are left intact. |

**Notes:**
- Non-interactive sessions (no TTY) skip the picker silently.
- See [guide/04 — Routing URL fetches through MCP servers](./guide/04-knowledge.md#routing-url-fetches-through-mcp-servers).

#### `smith knowledge remove <agent> <source-id>`

Remove a knowledge source from an agent's `agent.config.json` by its `id`. Does not auto-materialize — installed knowledge files remain until the next `smith agent install`.

**Synopsis:** `smith knowledge remove <agent> <source-id>`

**Exit codes:** `0` — removed. `1` — source id not found. `2` — config missing.

**Example:**
```bash
smith knowledge remove my-agent api-docs
```

#### `smith knowledge migrate-codex`

Upgrade helper for users with a hand-written `~/.codex/hooks.json` from before v0.15. Claims ownership of the file (writes the `_smith_managed` sentinel) iff every existing hook command is already smith-compatible (`smith knowledge refresh-session`). Otherwise refuses with `conflict` and leaves the file untouched.

**Synopsis:** `smith knowledge migrate-codex [--path <path>]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--path <path>` | path | `~/.codex/hooks.json` | Alternate hooks file to operate on. Useful for dry-testing against a sample. |

**Outcomes:**
- `noop` — file missing, already smith-managed, or has an empty `hooks: {}` block. Exits `0`.
- `claimed` — every existing hook matches smith's expected command; rewritten with the sentinel and an empty `agents: []`. Exits `0`.
- `conflict` — unrelated hook commands found OR an event group has a malformed shape (e.g. `hooks: { SessionStart: "stringnotarray" }`). File left untouched, each offending entry printed as `event[matcher]: command` with a manual-merge hint. Exits non-zero.

**Example:**
```bash
smith knowledge migrate-codex                            # default ~/.codex/hooks.json
smith knowledge migrate-codex --path /tmp/hooks.json    # dry-test against a sample
```

#### `smith knowledge refresh-session`

Refresh installed agents' knowledge sources whose `refresh.mode` is `session` or `always`. Designed for `SessionStart` hooks — always exits 0; failures go to stderr.

**Synopsis:** `smith knowledge refresh-session [--agent <name>] [--platform <id>] [--timeout <ms>] [--json]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--agent <name>` | string | — | Restrict to one agent's sources. |
| `--platform <id>` | enum: `claude-code\|codex\|kiro\|opencode` | — | Platform that invoked us. When `codex` is given without `--agent`, smith sniffs the parent process for `codex --profile <name>` to scope refresh to one agent; on miss, refreshes the superset of installed codex-targeted agents. Unknown values silently drop. |
| `--timeout <ms>` | number | `5000` | Override global wall-clock budget. |
| `--json` | flag | — | Emit `{ refreshed, failed, skipped, totalDurationMs }` on stdout. |

**Refresh modes** (in `knowledge.yml` `refresh:` field):
- `install` (default) — only at install time
- `ttl` + `ttl: 30m` — daemon poll
- `session` — every agent session
- `always` — install ∪ session

See [guide/04 — Refresh modes](./guide/04-knowledge.md#refresh-modes).

#### `smith knowledge add <agent> <type-or-url> [path-or-url]`

Append a knowledge source to `agent.config.json` and (by default) auto-run `smith agent install <agent>` to materialize it.

**Synopsis (generic):** `smith knowledge add [flags] <agent> <type-or-url> [path-or-url]`

Two invocation forms:
- **Flag form:** second positional is a known `<type>` (`file`, `dir`, `glob`, `webpage`, `web`, `git`, `confluence`, `jira`, `mcp`); third positional is the type-specific identifier and is required.
- **URL shortcut:** second positional is a full `http(s)://...` URL; smith infers the type from the URL shape, third positional is omitted. See [URL shortcut](#url-shortcut) below.

**Args:**
| Arg | Required | Description |
|---|---|---|
| `<agent>` | yes | Bundle name. |
| `<type-or-url>` | yes | Either a `<type>` keyword (see below) or a full `http(s)://` URL (triggers the URL shortcut). |
| `<path-or-url>` | only with flag form | Type-specific identifier. For `file`/`dir`/`glob` a path; for `webpage`/`web`/`git` a URL; for `confluence` a space key; for `jira` a JQL query; for `mcp` omitted (use flags). Omit when using the URL shortcut. |

**Allowed `<type>` values:**
| Type | Identifier shape | Notes |
|---|---|---|
| `file` | path | Single file. |
| `dir` | path | Directory; recursed. |
| `glob` | glob pattern | e.g. `src/**/*.ts`. |
| `webpage` | URL | Single page fetched + cached. |
| `web` | URL | Crawl / llms-txt / openapi structured fetch. |
| `mcp` | — | MCP server connector. |
| `git` | git URL | Cloned + cached. |
| `confluence` | space key | See [confluence-specific flags](#smith-knowledge-add-confluence) below. |
| `jira` | JQL query | See [jira-specific flags](#smith-knowledge-add-jira) below. |
| `npm` | — | Declared in the schema but rejected by the validator; not implemented. |

**Generic flags (apply to every type):**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--id <id>` | string | slugified from `<path-or-url>` | Stable identifier for the source. Use this in `--source` flags later. |
| `--delivery <mode>` | enum: `auto\|inline\|file` | `auto` | `auto` = smith picks based on size budget. `inline` = embed the content directly in the agent's prompt. `file` = write a sidecar file in the agent's `knowledge/` dir and reference it. |
| `--description <text>` | string | empty | Human-readable note shown in `smith knowledge list`. |
| `--optional` | bool | `false` | Demote this source's runtime/IO failures (network, missing file, git auth) to warnings instead of aborting `smith agent install`. Mirrors npm `optionalDependencies`. Author bugs (schema violations) still abort. |
| `--no-install` | bool | `false` (i.e. install runs) | Skip the auto-`smith agent install <agent>` step that normally runs after `add`. Use this when you're staging multiple sources before materializing. |
| `--lazy` | bool | `false` | URL sources only (`type=webpage`). Skip materialization at install; the agent fetches at runtime via WebFetch or its configured `via:` MCP tool. Rejected with a SmithError on non-URL types. |

> Schema fields like `summary`, `toc`, `materialize`, `extractor`, `refresh`, `retrieval`, `retrievalMcpUrl`, `inlineBudgetTokens`, and `via` are **not** CLI flags on `knowledge add`. Edit them via the GUI's per-source Edit modal (`/knowledge/:agent`), via `smith knowledge route` (for `via:` only), or by hand-editing `agent.config.json` and re-running `smith agent install <agent>`.

**Notes:**
- Schema accepts `materialize: "pdf-extract"` but the validator rejects it. Same status as `npm` — declared, not yet implemented.
- The `refresh` field on a source drives runtime re-materialization: `ttl: <duration>` is polled by the daemon's 5-minute tick; `session`/`always` fire on every platform session_start (claude-code hooks / codex `~/.codex/hooks.json` / opencode `agent-smith-refresh` plugin) when the user grants consent at install time. See `smith knowledge refresh-session`, `smith doctor --fix-knowledge-refresh`, and [guide/04 — Refresh modes](./guide/04-knowledge.md#refresh-modes).
- For `confluence`/`jira` sources, if credentials are missing at install time the source's fetch will fail and abort the install. Mark the source `--optional` to keep `agent install` running through the failure.

**Example:**
```bash
smith knowledge add code-reviewer webpage https://opencode.ai/docs --description "Live OpenCode docs"
smith knowledge add code-reviewer git git@github.com:acme/coding-standards.git --optional
smith knowledge add code-reviewer dir ~/work/runbooks --no-install   # stage; install later
smith knowledge add code-reviewer web https://docs.stripe.com/ --mode crawl --max-pages 50 --depth 3
smith knowledge add code-reviewer web https://example.com/llms.txt --mode llms-txt
smith knowledge add code-reviewer mcp --server notion --tool search --arg query="onboarding" --preset notion
```

##### `smith knowledge add <agent> confluence <space>`

Add a Confluence space (or specific pages) as a knowledge source.

**Synopsis:** `smith knowledge add [generic flags] [confluence flags] <agent> confluence <space>`

**Confluence-specific flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--pages <list>` | comma-list of titles or `id:N` refs | (whole space) | Restrict to specific pages. Each entry is either a literal page title (e.g. `"Onboarding"`) or `id:<page-id>` (e.g. `"id:12345"`). Mix freely: `"Onboarding,id:12345,Runbook"`. |
| `--max-pages <n>` | int, **1–100** | `25` (applied at fetch time in `src/io/confluence.ts`) | Maximum page count to fetch. Schema rejects values outside 1–100. |
| `--include-children` | bool | `false` | When fetching a page (via `--pages`), also fetch every descendant in the page tree. |
| `--format <fmt>` | enum: `storage\|view\|markdown` | `markdown` | Body format. `storage` = Confluence's raw XHTML storage format. `view` = rendered HTML. `markdown` = converted to Markdown (most useful for LLM prompts). |

**Notes:**
- Source id is derived from the space key (e.g. `ENG` → `eng`). If `--pages` has a single literal entry, the page slug is appended (`eng-onboarding`). Override with `--id`.
- Auth: see [Atlassian credentials](#atlassian-credentials) below. `add` prints a warning if no credentials are found, but does NOT block — you can configure creds before running `smith agent install`.

**Example:**
```bash
smith knowledge add code-reviewer confluence ENG --pages "Onboarding,id:12345" --format markdown
```

##### `smith knowledge add <agent> jira <jql>`

Add a JQL query as a knowledge source. Each matching issue becomes a knowledge entry.

**Synopsis:** `smith knowledge add [generic flags] [jira flags] <agent> jira <jql>`

**Jira-specific flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--fields <list>` | comma-list of field names, or `*all` | `summary,description,status` (applied at fetch time in `src/io/jira.ts`) | Which Jira fields to include per issue. `*all` returns every field (large response). |
| `--max-results <n>` | int, **1–500** | `100` (applied at fetch time in `src/io/jira.ts`) | Maximum issues to fetch. Schema rejects values outside 1–500. |

**Notes:**
- Source id is derived from the JQL (slugified, truncated to 60 chars). Override with `--id`.
- Auth: see [Atlassian credentials](#atlassian-credentials) below. `add` warns but doesn't block on missing creds.

**Example:**
```bash
smith knowledge add code-reviewer jira "project = ENG AND status = 'In Progress'" --max-results 100
```

##### URL shortcut

Paste any Atlassian URL straight from your browser as the second positional argument; `smith` parses it and fills the right flags.

**Synopsis**

    smith knowledge add <agent> <url> [--id <id>] [--delivery <d>] [--description <text>]
                                       [--optional] [--no-install]
                                       [--format <fmt>] [--pages <list>] [--max-pages <n>]
                                       [--include-children]
                                       [--fields <list>] [--max-results <n>]

**Recognised URL shapes**

| URL pattern                                                    | Becomes                                            |
| -------------------------------------------------------------- | -------------------------------------------------- |
| `/wiki/spaces/<SPACE>/pages/<ID>/...`                          | `confluence` (pages: `id:<ID>`, format: markdown)  |
| `/wiki/spaces/<SPACE>(/overview)?`                             | `confluence` (whole space, format: markdown)       |
| `/wiki/spaces/<SPACE>/blog/YYYY/MM/DD/<ID>/...`                | `confluence` (pages: `id:<ID>`, format: markdown)  |
| `/browse/<KEY-N>`                                              | `jira` (jql: `key = <KEY-N>`)                      |
| `/issues/?jql=<urlencoded>`                                    | `jira` (jql: decoded)                              |
| any other http(s) URL                                          | `webpage` (plain web fetch)                        |

The success line tells you which kind was created, e.g. `→ added Confluence page knowledge source ...`. If a typo'd Atlassian URL falls through to `plain web URL`, you'll see it immediately.

**Flag override rule.** Any explicit flag (`--pages`, `--format`, `--fields`, `--id`, etc.) wins over the URL-derived default. So a space URL plus `--pages id:99,id:100` selects only those pages; a page URL plus `--format storage` uses storage instead of markdown.

**Examples**

    # Confluence page (markdown by default)
    smith knowledge add security-reviewer \
      "https://acme.atlassian.net/wiki/spaces/SNXEXIT/pages/368024588/Power+BI+Desktop+-+Security+Model"

    # Same page, but force storage format
    smith knowledge add security-reviewer \
      "https://acme.atlassian.net/wiki/spaces/SNXEXIT/pages/368024588/..." \
      --format storage

    # Jira issue
    smith knowledge add planner "https://example.atlassian.net/browse/ENG-1234"

    # Plain web URL (auto-fallback)
    smith knowledge add researcher "https://example.com/docs/intro"

**Not yet supported (v1 limitations).** Confluence tinylinks (`/wiki/x/...`), Jira boards and dashboards, and the newer `/jira/software/projects/.../issues/KEY-N` path all fall through to `plain web URL`. Use the long-form flag command if you need those routed correctly.

##### Atlassian credentials

Confluence and Jira sources resolve credentials in this order; first complete `email + token` pair wins:

1. `SMITH_ATLASSIAN_EMAIL` + (`SMITH_ATLASSIAN_API_TOKEN` ‖ `SMITH_JIRA_API_TOKEN`) — process env
2. `~/.config/agent-smith/.env` — same `SMITH_*` keys

Default base URL is **required** — Atlassian Cloud instances are workspace-scoped (`https://<workspace>.atlassian.net`), so there is no global default. Set `SMITH_ATLASSIAN_BASE_URL` to your workspace URL, e.g. `https://acme.atlassian.net`.

#### `smith knowledge validate [agent]`

Lint knowledge configuration. Validates every source's schema fields and (for git/url) URL well-formedness.

**Synopsis:** `smith knowledge validate [agent]`

**Args:**
| Arg | Required | Description |
|---|---|---|
| `[agent]` | no | If omitted, validates every registered agent's knowledge block. |

#### Routing URL sources through MCP (`via`)

Source URLs that need credentials smith can't supply (internal wikis, ticketing, document stores) can be fetched via a declared MCP server's tool instead of direct HTTP. Add `via` to the source:

```json
{ "id": "internal-wiki", "type": "webpage", "url": "https://wiki.internal.example.com/page",
  "delivery": "file", "via": { "server": "internal-mcp", "tool": "fetch_page" } }
```

`smith knowledge fetch` and `smith agent install` then call `<server>.<tool>` over MCP, passing `{ url, ...via.args }`. See [guide/04 — Routing URL fetches through MCP servers](./guide/04-knowledge.md#routing-url-fetches-through-mcp-servers).

#### Bundle MCP dependencies (`mcp.required` / `mcp.peer`)

Declare the MCP servers a bundle needs so `smith agent install` can preflight them:

```json
{ "mcp": { "required": ["internal-mcp"], "peer": ["search-mcp"] } }
```

Semantics mirror npm: `required` blocks install when missing (exit `1`; `--allow-missing-mcp` demotes to a warning), `peer` warns only. Resolution scans every targeted platform's MCP config; a server present on at least one passes. The `mcp-deps` section of `smith doctor` audits installed agents post-hoc. See [guide/04 — Bundle MCP dependencies](./guide/04-knowledge.md#bundle-mcp-dependencies).

---

### Skills

`smith skill <subcommand>` — manage skills (the open Anthropic Agent Skills format) across all platforms.

#### `smith skill list`

Print discovered skills with their drift status.

**Synopsis:** `smith skill list [--all]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--all` | bool | `false` | Include skills from ad-hoc catalogs (those auto-created by `smith skill install --from <path>`). Without `--all`, only registered + bundled catalogs are shown. |

**Drift statuses:**
- `ok` — installed copy matches source.
- `drift` — recorded hash mismatched (source changed since install).
- `missing` — destination file gone.
- `source-missing` — catalog gone (e.g. unregistered).

#### `smith skill catalogs`

List every registered skill catalog (including the default-registered `atlassian-skills`). Rows carry the same `[managed]` / `[linked]` badges as `agent catalogs`; a `(git: <url>)` suffix is appended for any catalog with a `gitRemote` so the upstream is visible at a glance.

**Synopsis:** `smith skill catalogs`

#### `smith skill register <path>`

Add a skill catalog (a directory of `SKILL.md`-rooted skills) to `~/.config/agent-smith/skill-catalogs.json`. Same validation rules as `smith agent register`.

**Synopsis:** `smith skill register --kind <kind> [flags] <path>`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--kind <kind>` | enum: `user-global\|user-local\|team-shared` (**required**) | — | `user-global` = personal skills in `~/`. `user-local` = per-machine skills. `team-shared` = shared/team catalog tracked in git. (Note: different value set than `smith agent register`'s `--kind`.) |
| `--label <label>` | string | `<kind>:<absPath>` | Display label. |
| `--git-remote <url>` | URL | — | Required-remote URL for `kind=team-shared`. Same duplicate-warn behavior as `agent register`. |
| `--allow-empty` | bool | `false` | Allow registering a catalog with zero skills. |
| `--skip-git-check` | bool | `false` | Skip git-remote validation. |

**Notes:**
- The `atlassian-skills` catalog is protected and cannot be registered manually — it's the built-in catalog.

#### `smith skill unregister <path-or-label>`

Remove a skill catalog. Refuses only `protected` catalogs. Removing a catalog whose skills are still installed leaves them in `source-missing` drift state.

**Synopsis:** `smith skill unregister [--purge-clone] <path-or-label>`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--purge-clone` | bool | `false` | Also `rm -rf` the on-disk clone. Layered safety guard: refused unless catalog mode is `managed`, `rootPath` is under `<stateHome>/remote/`, target contains `.git/`, and origin URL matches the registered `remote.url`. Use to fully retire a catalog installed via `skill install --from <url>`. |

**Notes:**
- Exits `1` if the catalog isn't registered.
- `--purge-clone` on a non-`<stateHome>/remote/` path exits `2` (`usage-error`) with a hint.

#### `smith skill sync [name]`

Pull updates from the upstream git remote for one or all remote-backed skill catalogs. Mirror of `agent sync` — same semantics, same flags, separate registry (`skill-catalogs.json`).

**Synopsis:** `smith skill sync [--check] [--all] [name]`

**Args:**
| Arg | Required | Description |
|---|---|---|
| `[name]` | conditional | Skill catalog label OR rootPath. Required unless `--all`. Mutually exclusive with `--all`. |

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--all` | bool | `false` | Sync every remote-backed skill catalog. Partial failure exits `3`. |
| `--check` | bool | `false` | Probe remote HEAD only; update `lastRemoteSha` + `lastCheckedAt`; leave the working tree alone. |

**Exit codes:** identical to `agent sync` (`0` clean / `2` usage / `3` partial / `1` all-failed).

**Examples:**
```bash
smith skill sync acme/team-skills
smith skill sync --all
smith skill sync --all --check
```

#### `smith skill install [<ref>]`

Install a skill into all platform skill directories. `<ref>` is `<catalog>/<name>` or bare `<name>` (when unambiguous across catalogs).

**Synopsis:** `smith skill install [--from <pathOrUrl>] [--as <name>] [--targets <list>] [--git-ref <ref>] [--all] [--skills <list>] [--json] [<ref>]`

**Args:**
| Arg | Required | Description |
|---|---|---|
| `[<ref>]` | no (if `--from` given) | Skill ref like `the-architect` or `atlassian-skills/atlassian-readonly-skills`. With `--from <url>` it disambiguates when the cloned repo contains more than one skill. |

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--from <pathOrUrl>` | path or git URL | — | Ad-hoc install. **Local path** — auto-creates a catalog; tilde expansion is supported (`~/path/to/skill`). **Git URL** (https://, ssh://, git@, file://) — clones into `<stateHome>/remote/<host>/<owner>/<repo>`, registers, then installs. URL form detected by scheme. See [guide/15 — Sharing via direct URL](./guide/15-sharing-and-distribution.md#9-sharing-via-direct-url). |
| `--as <name>` | string | derived | Catalog label for the auto-created ad-hoc catalog (local-path branch only). |
| `--targets <list>` | comma-list of `opencode\|claude-code\|codex\|kiro` | all four | Restrict installation to specific platforms. |
| `--git-ref <ref>` | git ref | remote HEAD | Branch, tag, or SHA to check out after cloning with `--from <url>`. Ignored for local paths. |
| `--all` | bool | `false` | Install every skill discovered in `--from <url>` (URL form only). Mutually exclusive with `<ref>` and `--skills`. |
| `--skills <list>` | comma-list | — | Restrict install to specific skills discovered in `--from <url>` (URL form only). Mutually exclusive with `<ref>` and `--all`. |
| `--json` | bool | `false` | Discover skills from `--from <url>`, print JSON, do not install. |

**Notes:**
- Codex skills must be `SKILL.md` *directories* (not single files); the installer enforces this.
- `<ref>` validation: paths starting with `/` exit `2` with a `--from` hint. Bare names must be kebab-case, ≤64 chars, contain no `/`, no `..`, and no leading `.`. Catalog-qualified refs (`<catalog>/<name>`) accept exactly one `/`.
- With `--from <url>` and a multi-skill remote, omitting `<ref>` exits `2` with a disambiguation hint listing every discovered skill.

**Example:**
```bash
smith skill install atlassian-skills/atlassian-readonly-skills
smith skill install --from ~/dev/my-skill --as my-skills
smith skill install --from git@github.com:acme/team-skills.git    # single-skill remote
smith skill install codex-helper --from https://github.com/acme/team-skills.git --git-ref v1.2.0
```

#### `smith skill update [<name>]`

Overwrite the installed copy of a skill from its current source.

**Synopsis:** `smith skill update [--all] [<name>]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--all` | bool | `false` | Update every installed skill. |

**Notes:**
- Without `<name>` and without `--all`, exits `2` with a hint to pass one or the other.

#### `smith skill uninstall <name>`

Remove a skill from every install target. Auto-unregisters the catalog if it becomes empty.

**Synopsis:** `smith skill uninstall <name>`

**Notes:**
- Takes only a bare name (not `<catalog>/<name>`).

#### `smith skill bootstrap`

Install the bundled `the-architect` and `the-keymaker` skills. Normally fired by the `bun install` postinstall, so you only need this when re-bootstrapping a broken install.

**Synopsis:** `smith skill bootstrap [--dry-run] [--targets <list>]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | bool | `false` | Print what would be installed without touching the filesystem. |
| `--targets <list>` | comma-list of `opencode\|claude-code\|codex\|kiro` | all four | Restrict bootstrap to specific platforms. |

#### `smith skill validate <name>`

Validate a registered skill's SKILL.md frontmatter.

**Synopsis:** `smith skill validate <name>`

**Exit codes:** `0` — valid. `1` — not found. `2` — invalid frontmatter or ambiguous.

#### `smith agent catalog rename <old> <new>`

Rename an agent catalog label in `registry.json`.

**Synopsis:** `smith agent catalog rename <old-label> <new-label>`

**Exit codes:** `0` — renamed. `1` — old label not found. `2` — new label already in use.

#### `smith skill catalog rename <old> <new>`

Rename a skill catalog label in `skill-catalogs.json`.

**Synopsis:** `smith skill catalog rename <old-label> <new-label>`

**Exit codes:** `0` — renamed. `1` — old label not found. `2` — new label already in use.

#### `smith migrate-clones`

One-shot helper to migrate rc.1 external-repo clones from `$XDG_CONFIG_HOME` to `$XDG_STATE_HOME`.

**Synopsis:** `smith migrate-clones [--dry-run]`

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | bool | `false` | Classify each entry without moving files or updating registries. |

State files used by skill commands:
- `~/.config/agent-smith/skill-catalogs.json` — registered catalogs
- `~/.config/agent-smith/installed-skills.json` — what's installed where, with content hashes for drift detection

---

### Daemon

Background watcher that periodically `git pull`s `~/.agent-smith/` and writes a heartbeat file.

#### `smith daemon start`

Detached background watcher. Writes `daemon.pid` + `daemon.log`.

**Synopsis:** `smith daemon start`

#### `smith daemon stop`

Send SIGTERM and remove the pid file.

**Synopsis:** `smith daemon stop`

#### `smith daemon status`

Print one of: `running <pid>`, `stale pid file`, `not running`.

**Synopsis:** `smith daemon status`

#### `smith daemon run`

Run the watcher in the foreground. Used internally by `daemon start`; not normally user-facing.

**Synopsis:** `smith daemon run`

**Notes:**
- Cadence is overridable via two env vars (positive ints, milliseconds). Invalid values are silently ignored:
  - `SMITH_PULL_INTERVAL_MS` — git-pull cadence (default `900000` = 15 min)
  - `SMITH_HEARTBEAT_INTERVAL_MS` — heartbeat write cadence (default `5000` = 5 s)
- The daemon also runs a separate 5-minute TTL refresh tick: any `ttl`-mode knowledge source whose cache age exceeds its declared TTL is re-fetched. Shares cache state at `~/.cache/agent-smith/agents/<name>/sources/<source-id>.meta.json` with `smith knowledge refresh-session` and `smith knowledge fetch`. See [guide/09 — Knowledge TTL refresh](./guide/09-daemon.md#knowledge-ttl-refresh).

PID + log live at `~/.local/state/agent-smith/daemon.{pid,log}`.

---

## Required skills (`requires.skills`)

Agents declare runtime skill dependencies in `agent.config.json`:

```json
{
  "requires": { "skills": ["the-architect", "atlassian-skills/atlassian-readonly-skills"] }
}
```

`smith agent install <agent>` and `smith agent install-all` check each entry against `installed-skills.json` and act per the `agent install` flag mode:

| Flag | Mode | Behavior |
|---|---|---|
| (default) | `prompt` | Y/n per missing skill (auto-skip + warn on non-TTY). |
| `--with-skills` / `--yes` | auto-install | Install all missing without prompting. |
| `--no-skills` | skip | Warn at end; do not install. |

Failures NEVER abort the agent install — skill issues degrade to warnings.

The `doctor` `agent-required-skills` section reports unsatisfied requirements with `smith skill install <ref>` remediation.

---

## Platform conventions (`platformConventions`)

Some platforms have native context-loading conventions that built-in agents auto-load but custom (smith-rendered) agents must opt into. Bundles can declare which conventions they want injected at install time:

```jsonc
// agent.config.json
{
  "platformConventions": {
    "kiro": ["workspace-steering", "global-steering"]
  }
}
```

**Registered conventions (v1):**

| Platform | Convention ID | Scope | Default | URI(s) emitted |
|---|---|---|---|---|
| `kiro` | `workspace-steering` | workspace | on (`promptDefault: true`) | `file://.kiro/steering/**/*.md` |
| `kiro` | `global-steering` | user-global | off | `file://~/.kiro/steering/**/*.md` |

Other platforms have empty registries in v1; future commits register `CLAUDE.md`, `AGENTS.md`, etc. as data-only updates.

**Resolution (3-tier; first match wins):**

1. **Bundle declaration** — `agent.config.json:platformConventions[<target>]`. Author's intent wins; passes through user prefs and CLI flags.
2. **User-global preference** — `~/.config/agent-smith/conventions.json`. `explicit` (exact ID list) bypasses `default` (`accept-all|reject-all|use-defaults|prompt`).
3. **CLI flag** — `--platform-conventions <strategy>` or `--no-platform-conventions` (alias for `reject-all`). When unset and TTY, prompts; when unset and non-TTY, falls through to fail-safe-reject (never inject convention URIs in CI without consent).

**Strategies:**
- `accept-all` — emit every registered convention for every target
- `reject-all` — emit none
- `use-defaults` — emit only conventions marked `promptDefault: true`
- `prompt` — defer to TTY prompt

**Where the URIs land:** for Kiro, smith appends them to `data.resources` in the rendered JSON, deduped and sorted alongside any `skill://` URIs and the per-agent knowledge dir grant.

---

## Error output format

On any non-zero exit, smith prints to stderr:

```
✗ smith <subcommand>: <headline>

  Try: <suggested-command>      (when applicable)
```

Optional body lines (validation reasons, partial-failure details) appear above the `Try:` line. Set `SMITH_DEBUG=1` to additionally print the underlying JavaScript error and stack trace (read by `wrap()` in every CLI command). `AGENT_SMITH_DEBUG=1` is a deprecated alias and behaves identically (with a one-shot deprecation warning on stderr).

---

## Exit codes

Smith uses a four-tier taxonomy across every command:

| Code | Meaning |
|---|---|
| `0` | success / dry-run / no work |
| `1` | runtime error — the operation could not complete (read the headline + `Try:` remediation) |
| `2` | usage error — missing/invalid argument or unknown command/flag; **also** schema validation failures (e.g. `knowledge add --max-pages 200` exceeds the 1–100 bound) |
| `3` | partial failure — some items succeeded, some failed; only emitted by batch commands (`update`, `agent uninstall`, `agent uninstall-all`, `jack-out`) |

Common triage:

- `1` from `agent install` / `agent validate` → run `smith agent validate <name>` for the failure list.
- `1` from `update` → workspace dirty (`git status` inside `~/.agent-smith/`) or `~/.agent-smith/` is not a git workspace. `git pull` / `bun install` / `git fetch` failures emit `3`, not `1`.
- `1` from `agent unregister` / `skill unregister` → catalog isn't registered (check `smith status`).
- `1` from `agent init` → an agent of that name already exists — exit `2` (`smith agent destroy <name>` first), OR `--catalog` value is not a registered catalog (`not-found`; run `smith agent catalogs`).
- `2` from `knowledge add` schema rejection → check the bounds (e.g. `--max-pages` 1–100, `--max-results` 1–500, `--format` enum).
- `2` from `knowledge` (or any subcommand) → missing positional arg or unknown subcommand (the headline names what's missing).
- `2` from `agent install` / `knowledge fetch` for a git-source failure (clone / fetch / reset / lock-timeout) — these surface as `validation-failed`.
- `3` from a batch command → re-run with `--dry-run` to see planned paths; read stderr for per-item failures.

`smith doctor` has its own internal exit-code semantics (`0`/`1`/`2` keyed to clean / drift / network-error) and is propagated verbatim by `smith update`.

---

## Paths reference

### Smith-owned (`~/.config/agent-smith/` — or `${XDG_CONFIG_HOME}/agent-smith/` when set)

All smith state lives under one root resolved by `stateHome()` (`src/io/state-home.ts`). `XDG_CONFIG_HOME` is honored at every call site; an unset or empty value falls back to `~/.config`. See [guide § XDG variable handling](./guide/13-paths-and-state.md#xdg-variable-handling).

| Path | Role |
|---|---|
| `agents/` | default user-global bundles |
| `agents/<name>/{IDENTITY,EXPERTISE,SOUL}.md` | persona files |
| `agents/<name>/USER.md` | symlink (personal catalogs) or stub file (registered catalogs) — see [guide § 02](./guide/02-bundle-anatomy.md#usermd-and-catalog-kind) |
| `agents/<name>/agent.config.json` | bundle config |
| `registry.json` | source registry (resolved by `canonicalRegistryPath()`) |
| `skill-catalogs.json` | registered skill catalogs (resolved by `canonicalSkillRegistryPath()`) |
| `installed-skills.json` | installed skills + content hashes for drift detection |
| `installed-agents.json` | manifest of every (name, platform) smith installed, with `contentHash` for would-clobber refusal on install + hash-mismatch refusal on uninstall (both `--force`-bypassable). Lazy-created on first install. Schema: `{ schemaVersion: 1, installed: InstalledAgent[] }`. |
| `installed-agents.json.lock` | sibling lockfile that serializes concurrent manifest read-modify-write cycles (`withFileLock`); held for milliseconds during the install/uninstall manifest update. |
| `conventions.json` | per-platform-convention preferences for the 3-tier resolver (workspace-steering / global-steering for Kiro). Lazy-created on first persistence. Schema: `{ schemaVersion: 1, platformConventions: { <Target>: { default?, explicit? } } }`. |
| `gui-state.json` | GUI server state (tour completion, preferences). Lazy-created. |
| `USER.md` | shared user context (resolved by `canonicalUserPath()`) |

### Runtime state (`~/.local/state/agent-smith/` — or `${XDG_STATE_HOME}/agent-smith/`)

| Path | Role |
|---|---|
| `daemon.pid` | daemon PID file |
| `daemon.log` | daemon log output |
| `daemon.heartbeat.json` | daemon heartbeat (schemaVersion, pid, lastBeatAt, status) |
| `remote/` | managed clones from `--from <url>` installs |

### Caches (`~/.cache/agent-smith/` — or `${XDG_CACHE_HOME}/agent-smith/`)

| Path | Role |
|---|---|
| `locks/<safe>.lock` | per-source file locks for concurrent refresh serialization |

### Install targets

| Platform | Agents dir | Skills dir | Config |
|---|---|---|---|
| OpenCode | `~/.config/opencode/agents` | `~/.config/opencode/skills` | `~/.config/opencode/opencode.json` |
| Claude Code | `~/.claude/agents` | `~/.claude/skills` | `~/.claude.json` |
| Codex | `~/.agents/skills` † | `~/.agents/skills` † | `~/.codex/config.toml` |
| Kiro | `~/.kiro/agents` | `~/.kiro/skills` | `~/.kiro/settings/mcp.json` (smith does NOT manage; reads optionally) |

† Codex agents and skills share the same root (`~/.agents/skills/`) per the [Codex spec](https://developers.openai.com/codex/skills). Both are directory-with-`SKILL.md` shaped; name collisions are only possible if a skill and an agent share a name.

**Kiro file shape:** unlike the YAML-frontmatter `*.md` used by the other targets, Kiro's agent file is a single JSON document at `~/.kiro/agents/<name>.json` (vendored schema at `data/kiro.agent-v1.schema.json`). Skills follow the standard `SKILL.md` directory shape under `~/.kiro/skills/<name>/`. Both Kiro CLI (`kiro-cli`) and Kiro IDE (`kiro`) read from these locations.

### Caches

| Path | Role | Bust with |
|---|---|---|
| `${XDG_CACHE_HOME:-~/.cache}/agent-smith/opencode-schema-cache.json` | doctor schema (24h TTL) | `smith doctor --no-cache` |
| `~/.config/agent-smith/knowledge/<agent>/.cache/` | knowledge URL/git cache | `smith knowledge fetch <agent> --source <id>` |

---

## Environment variables

| Var | Read by | Effect |
|---|---|---|
| `SMITH_BIN` | GUI MCP-config writers, refresh-hook installers | Override for the resolved `smith` binary path; honored by GUI MCP-config writers and refresh-hook installers when smith can't be found via PATH heuristics. |
| `SMITH_DEBUG` | `wrap()` (every command) | when truthy, prints the underlying error and stack trace below the formatted error block |
| `SMITH_DOCTOR_PROBE_META` | `smith doctor` | `=1` enables URL-routing `_meta` probe in `smith doctor`'s `url-routing` section. Experimental. Default off. |
| `SMITH_HINT_PENDING` | post-install hint banner | `=1` triggers a one-shot post-install hint banner about pending platform-detection sync operations. Default off. |
| `SMITH_PROBE_META` | `smith agent install`, `smith knowledge fetch` | `=1` enables Layer 2 `_meta` self-claim collection during `smith agent install` and `smith knowledge fetch`. Experimental; spawns every declared MCP server up front. Default off. |
| `SMITH_MCP_VERBOSE` | every smith command that spawns child MCP servers | `=1` restores the old behavior of inheriting child MCP server stderr to the terminal. Default off (stderr piped to per-server log files under `<runtimeStateHome>/mcp-logs/`). |
| `AGENT_SMITH_DEBUG` | every command (via `isDebug()`) | **deprecated alias for `SMITH_DEBUG`**; setting it triggers a one-shot deprecation warning on stderr. Use `SMITH_DEBUG` instead. |
| `EDITOR` | `init-user` | editor for `USER.md` (default `vi`) |
| `XDG_CONFIG_HOME` | every smith command (via `stateHome()`) | base dir for smith's state root; resolves to `${XDG_CONFIG_HOME}/agent-smith/...` when set, `~/.config/agent-smith/...` when unset/empty |
| `XDG_CACHE_HOME` | `doctor` | base dir for schema cache (falls back to `~/.cache`) |
| `XDG_STATE_HOME` | daemon, `migrate-clones` | base dir for runtime state (`daemon.pid`, `daemon.log`, `daemon.heartbeat.json`, managed clones); falls back to `~/.local/state` |
| `AGENT_SMITH_DISABLE_LIVE_RESOLUTION=1` | `doctor`, orchestrator | force vendored-only OpenCode model resolution |
| `AGENT_SMITH_SKIP_POSTINSTALL=1` | `scripts/bootstrap.ts` | skip the `bun install` postinstall hook |
| `CI=true` | `scripts/bootstrap.ts` | skip postinstall in CI environments |
| `NODE_ENV=test` | model resolver | suppresses logging |
| `SMITH_MODEL_PROVIDERS` | model resolver | comma-separated provider preference order (e.g. `anthropic,github-copilot,openrouter`); see [Models](./guide/07-models.md) |
| `SMITH_TIER_HIGH` | model resolver | per-tier override for `high` (format: `<provider>/<model>`) |
| `SMITH_TIER_BALANCED` | model resolver | per-tier override for `balanced` (format: `<provider>/<model>`) |
| `SMITH_TIER_FAST` | model resolver | per-tier override for `fast` (format: `<provider>/<model>`) |
| `SMITH_CLAUDE_TIER_HIGH`, `…_BALANCED`, `…_FAST` | Claude Code model resolver | per-platform per-tier override (format: `<model>`) |
| `SMITH_CODEX_TIER_HIGH`, `…_BALANCED`, `…_FAST` | Codex model resolver | per-platform per-tier override (format: `<model>`) |
| `SMITH_KIRO_TIER_HIGH`, `…_BALANCED`, `…_FAST` | Kiro model resolver | per-platform per-tier override (format: `<model>`) |
| `SMITH_GUI_NO_AUTOBUILD` | `smith gui` | when `1`, skip the automatic GUI bundle rebuild on launch |
| `SMITH_PULL_INTERVAL_MS` | `smith daemon run` | override default git-pull cadence (ms); invalid values silently ignored |
| `SMITH_HEARTBEAT_INTERVAL_MS` | `smith daemon run` | override default heartbeat write cadence (ms); invalid values silently ignored |
| `SMITH_ATLASSIAN_EMAIL` | atlassian-auth | SMITH-tier Atlassian email (highest precedence) |
| `SMITH_ATLASSIAN_API_TOKEN` | atlassian-auth | SMITH-tier Atlassian API token (preferred) |
| `SMITH_JIRA_API_TOKEN` | atlassian-auth | SMITH-tier fallback when `SMITH_ATLASSIAN_API_TOKEN` is unset |
| `SMITH_ATLASSIAN_BASE_URL` | atlassian-auth | **required** for Confluence/Jira sources — your workspace URL, e.g. `https://acme.atlassian.net`. No default (Atlassian Cloud is workspace-scoped). |
| `JIRA_URL` | atlassian-skills | Bridged automatically from `SMITH_ATLASSIAN_BASE_URL` when you save credentials. Used by atlassian-skills Python scripts. |
| `JIRA_USERNAME`, `JIRA_API_TOKEN` | atlassian-skills | Bridged from `SMITH_ATLASSIAN_EMAIL` and `SMITH_ATLASSIAN_API_TOKEN`. |
| `CONFLUENCE_URL` | atlassian-skills | Bridged from `SMITH_ATLASSIAN_BASE_URL` with `/wiki` appended for Cloud. |
| `CONFLUENCE_USERNAME`, `CONFLUENCE_API_TOKEN` | atlassian-skills | Bridged from `SMITH_ATLASSIAN_EMAIL` and `SMITH_ATLASSIAN_API_TOKEN`. |
| `BITBUCKET_URL`, `BITBUCKET_PAT_TOKEN` | atlassian-skills | **Optional**. Set manually for Bitbucket Server/Data Center (Bitbucket Cloud unsupported by upstream). Smith does not bridge these. |

External files read by smith:

| Path | Read by | Purpose |
|---|---|---|
| `~/.config/agent-smith/.env` | atlassian-auth | tier 2 SMITH-scoped credentials (same `SMITH_*` keys) |

---

## Debugging

### Knobs

| Knob | Where | Use when |
|---|---|---|
| `--dry-run` | `agent uninstall`, `agent uninstall-all`, `jack-out`, `agent destroy`, `skill bootstrap`, `update` | preview changes before committing |
| `--json` | `doctor` | machine-readable output; disables spinners |
| `--offline` | `doctor` | skip live OpenCode schema fetch |
| `--no-cache` | `doctor` | bypass 24h schema cache |
| `--skip-model-resolution` | `doctor` | skip the model-resolution check |
| `AGENT_SMITH_DISABLE_LIVE_RESOLUTION=1` | env | force vendored-only resolution everywhere |
| `--yes` | `agent uninstall-all`, `jack-out`, `agent destroy` | non-interactive |

### Recipes

```bash
# See exactly what jack-out would delete
smith jack-out --dry-run

# Diagnose stale schema or model drift
smith doctor --no-cache --json | jq

# Fully offline diagnostic (no network)
smith doctor --offline --no-cache

# Re-fetch a specific knowledge URL after upstream change
smith knowledge fetch my-agent --source api-docs

# Inspect daemon
smith daemon status
tail -f ~/.local/state/agent-smith/daemon.log

# Verify install integrity for one agent
smith agent validate my-agent && smith agent install my-agent && smith doctor

# Dry-run an update before pulling
smith update --dry-run

# Publish a bundle into a catalog repo (directory mode)
smith agent export <name> --format directory --to <dir>/agents/   # publish into a catalog repo

# Install from a local checkout
smith agent install --from <local-dir>                            # install from a local checkout
```

### Exit-code recipes

See the top-level [Exit codes](#exit-codes) section for the full taxonomy and triage table.
