# Agent Smith — Guide

`agent-smith` is a tool for authoring and operating AI coding agents. You write a single canonical bundle (persona files plus an `agent.config.json`) and the `smith` CLI renders it into the platform-specific files that OpenCode, Claude Code, Codex, Kiro, and any AGENTS.md-aware tool each expect. The same machinery installs reusable **skills** (Anthropic open Agent Skills format) and per-agent **knowledge** (files, repos, Confluence pages, Jira issues) across these targets from one source of truth. This guide is the source of truth for everything `smith` does.

This document is a router. It orients you, points at the right spoke, and answers "where do I find X?" The depth lives in the spokes under [`guide/`](./guide/).

---

## Mental model

The system has four moving parts:

- **Bundle** — a directory containing `agent.config.json` and four persona files (`IDENTITY.md`, `EXPERTISE.md`, `SOUL.md`, `USER.md`). The canonical, platform-agnostic definition of an agent.
- **Catalog** — a registered directory containing one or more bundles (agent catalog) or one or more `SKILL.md`-rooted skill directories (skill catalog). Two registries, two vocabularies — see [Registries and catalogs](./guide/08-registries-and-catalogs.md). A catalog you `git clone` and `smith agent register` is **hand-managed** (working tree is yours); a catalog that smith clones for you via `smith agent install --from <url>` is **remote-backed** (working tree lives under `<stateHome>/remote/`; `smith agent sync` pulls; `smith agent unregister --purge-clone` cleans up).
- **Render + install** — `smith agent install <name>` reads a bundle, resolves model tier and required skills, materializes knowledge, and writes platform-native files into each declared target's directory.
- **Daemon** (optional) — a background watcher that re-installs when bundle files change, pulls registered git-backed catalogs every 15 minutes, and refreshes `ttl`-mode knowledge sources every 5 minutes.

Two surfaces drive the same machinery:

- **`smith` CLI** — every command documented in the spokes below.
- **`smith gui`** (optional) — a local browser interface that wraps every daily-workflow command (agents, skills, knowledge, daemon, doctor, update, jack-out, persistent job history). Every action shells out to `smith` and streams stdout back to the page over SSE. See [README → Browser GUI](./README.md#browser-gui-smith-gui) for the route map and screenshots, [`gui/README.md`](./gui/README.md) for the developer setup.

Knowledge, skills, and permissions are **orthogonal concerns** layered on top:

- **Knowledge** is materialized once into smith's own state home (`~/.config/agent-smith/knowledge/<agent>/`); every translator emits a permission grant or sidecar pointer to that location, so all targets read the same bytes.
- **Skills** install per-platform (`~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`, `~/.kiro/skills/`) and are referenced from a bundle either as `requires.skills` (delivery — install these for me) or `permission.skill` (runtime — let me invoke these via the `Skill` tool).
- **Permissions** are declared once in the canonical `permission` block; each platform translator drops the groups its target doesn't support and warns appropriately.
- **Platform conventions** are non-bundle context paths (e.g. `.kiro/steering/**/*.md` for Kiro) that the bundle can request and the user can govern globally; resolved at render time and injected into the platform-native output. See [06 — Permissions and platforms](./guide/06-permissions-and-platforms.md).

```
                              canonical bundle
                                      │
        ┌─────────────┬────────────┬────────────┬────────────┬────────────┐
        ▼             ▼            ▼            ▼            ▼            ▼
   OpenCode .md  Claude Code .md  Codex SKILL.md  Kiro .json     AGENTS.md
~/.config/opencode/  ~/.claude/   ~/.agents/skills/  ~/.kiro/      ~/AGENTS.md
   agents/<n>.md   agents/<n>.md   <n>/SKILL.md    agents/<n>.json  (or project root)
```

---

## Spoke map

The 16 spokes are grouped by intent. Each one is a self-contained reference for its topic.

### Getting started

- [01 — Getting started](./guide/01-getting-started.md). Install `smith` (the installer auto-runs `init`), scaffold and install your first agent.

### Authoring (you're writing a bundle)

- [02 — Bundle anatomy](./guide/02-bundle-anatomy.md). The five files inside a bundle, the complete `agent.config.json` schema, validation rules.
- [04 — Knowledge](./guide/04-knowledge.md). Per-agent knowledge sources: file, dir, glob, url, git, confluence, jira. Delivery (inline / file / auto), inline budget, sidecar `knowledge.json`, Atlassian credential resolution.
- [16 — Knowledge compiler](./guide/16-knowledge-compiler.md). Progressive disclosure: smart-default compile + overrides, `agents-md` target, `smith knowledge compile` / `smith knowledge serve`, GUI per-source editor + MCP toggle, APM import.
- [05 — Skills](./guide/05-skills.md). The skill catalog model, the eleven `smith skill` subcommands, `requires.skills` semantics (canonical home), drift detection.
- [06 — Permissions and platforms](./guide/06-permissions-and-platforms.md). Permission presets and JSON, per-platform translator behavior, capability gaps, MCP server declarations.
- [07 — Models](./guide/07-models.md). Tier resolution (`balanced|fast|high|inherit`; legacy aliases `opus|sonnet|haiku`), per-platform handling, OpenCode live-resolution opt-out.

### Operating (smith is installed; you're using it)

- [03 — Installing and rendering](./guide/03-installing-and-rendering.md). What `smith agent install` actually does. Build pipeline, per-platform output, cross-platform knowledge grants, the dual meaning of `--yes`.
- [08 — Registries and catalogs](./guide/08-registries-and-catalogs.md). The two registries (agents vs skills), kind vocabularies, ad-hoc catalogs, registry hygiene.
- [09 — The daemon](./guide/09-daemon.md). What it watches, reinstall triggers, git pull cadence, heartbeat file, lifecycle commands.
- [10 — Doctor](./guide/10-doctor.md). The 15 health-check sections, internal exit codes (the trap), `--json` output, schema cache.
- [11 — Update and uninstall](./guide/11-update-and-uninstall.md). `smith update` pipeline, `agent uninstall` / `agent uninstall-all` / `agent destroy` / `jack-out` — when to use which.

### Reference (look something up)

- [12 — Error handling](./guide/12-error-handling.md). The `✗ smith <subcommand>: <headline>` format, the four-tier exit-code taxonomy, every `SmithError` variant, `SMITH_DEBUG=1`.
- [13 — Paths and state](./guide/13-paths-and-state.md). Every file `smith` reads or writes; environment variables; XDG handling; what `init` creates vs. what's lazy; what `jack-out` removes vs. doesn't.
- [14 — CLI reference](./guide/14-cli-reference.md). Every command, every flag, every exit code. Synopsis + arguments + flags + exit codes + examples per command.

### Sharing (distributing bundles to teammates)

- [15 — Sharing and distribution](./guide/15-sharing-and-distribution.md). End-to-end publisher and consumer flows for agent bundles and skills, knowledge portability matrix, Atlassian credentials when sharing, team patterns (single shared catalog, tiered catalogs, personal override), the v0.25.0 direct-URL flow (`smith agent install --from <url>` + `smith agent sync` for one-command installs of external bundles), and the v1.8.0 archive flow (`smith agent export` produces a `.smith-bundle.tgz` that recipients install via `smith agent install --from <archive>`).

---

## Reading order recommendations

You don't have to read this top-to-bottom. Pick a path:

**First-time user** (you've just been told to install `smith`):
[01 — Getting started](./guide/01-getting-started.md) → [02 — Bundle anatomy](./guide/02-bundle-anatomy.md) → [14 — CLI reference](./guide/14-cli-reference.md) when you need to look up a flag.

**Bundle author** (you're writing or maintaining agents):
[02 — Bundle anatomy](./guide/02-bundle-anatomy.md) → [04 — Knowledge](./guide/04-knowledge.md) → [05 — Skills](./guide/05-skills.md) → [06 — Permissions and platforms](./guide/06-permissions-and-platforms.md) → [07 — Models](./guide/07-models.md) → [03 — Installing and rendering](./guide/03-installing-and-rendering.md) to understand what your config produces on disk.

**Operator** (you run `smith` in a CI loop or on a long-lived workstation):
[09 — The daemon](./guide/09-daemon.md) → [10 — Doctor](./guide/10-doctor.md) → [11 — Update and uninstall](./guide/11-update-and-uninstall.md) → [12 — Error handling](./guide/12-error-handling.md) → [13 — Paths and state](./guide/13-paths-and-state.md).

---

## Command index

Every `smith` command, alphabetical. Follow the link for full synopsis, flags, exit codes, and examples in [spoke 14](./guide/14-cli-reference.md).

| Command | Purpose |
|---|---|
| [`smith skill bootstrap`](./guide/14-cli-reference.md#smith-skill-bootstrap) | Install bundled `the-architect` and `the-keymaker` skills to all platforms |
| [`smith daemon run`](./guide/14-cli-reference.md#smith-daemon-run) | Run the daemon loop in the foreground (internal; spawned by `daemon start`) |
| [`smith daemon start`](./guide/14-cli-reference.md#smith-daemon-start) | Spawn the daemon detached and verify startup via heartbeat poll |
| [`smith daemon status`](./guide/14-cli-reference.md#smith-daemon-status) | Report daemon liveness: not running, running, or stale pid file |
| [`smith daemon stop`](./guide/14-cli-reference.md#smith-daemon-stop) | Stop the daemon (SIGTERM with SIGKILL fallback); always exits `0` |
| [`smith doctor`](./guide/14-cli-reference.md#smith-doctor) | Run the 15-section health check (includes offline `remote-catalogs` drift report and per-platform detection) |
| [`smith init`](./guide/14-cli-reference.md#smith-init) | Initialize `~/.config/agent-smith/` (idempotent) |
| [`smith agent init <name>`](./guide/14-cli-reference.md#smith-agent-init-name) | Scaffold a new bundle (clone with `--from`, or scaffold into a registered catalog with `--catalog`) |
| [`smith init-user`](./guide/14-cli-reference.md#smith-init-user) | Open `USER.md` in `$EDITOR` |
| [`smith agent install <name>`](./guide/14-cli-reference.md#smith-agent-install-name) | Build and render an agent to its targets (use `--from <url>` to clone + install in one shot) |
| [`smith agent install-all`](./guide/14-cli-reference.md#smith-agent-install-all) | Build and render every registered agent |
| [`smith agent destroy <name>`](./guide/14-cli-reference.md#smith-agent-destroy-name) | Inverse of `agent init`: remove a user-global source bundle (refuses non-`user-global` catalogs) |
| [`smith jack-out`](./guide/14-cli-reference.md#smith-jack-out) | Full offboarding: uninstall all agents and remove `~/.config/agent-smith/` |
| [`smith knowledge add`](./guide/14-cli-reference.md#smith-knowledge-add-agent-type-path-or-url) | Add a knowledge source to an agent's config and auto-materialize via `smith agent install` (use `--no-install` to skip) |
| [`smith knowledge compile`](./guide/14-cli-reference.md#smith-knowledge-compile-name) | Offline re-derive the TOC stanza + `compile-manifest.json` from already-materialized files |
| [`smith knowledge fetch`](./guide/14-cli-reference.md#smith-knowledge-fetch-agent) | Re-acquire knowledge sources and re-install (`--source <id>` for surgical per-source refresh) |
| [`smith knowledge list`](./guide/14-cli-reference.md#smith-knowledge-list-agent) | Show knowledge state for an agent: not-found, no sources, declared-but-not-materialized, or full manifest |
| [`smith knowledge remove`](./guide/14-cli-reference.md#smith-knowledge-remove-agent-source-id) | Remove a knowledge source by id from an agent's `agent.config.json` |
| [`smith knowledge route`](./guide/14-cli-reference.md#smith-knowledge-route) | Inspect or invalidate the URL → MCP-tool route resolver cache |
| [`smith knowledge serve`](./guide/14-cli-reference.md#smith-knowledge-serve-name) | Stdio MCP server (BM25 search + range-bounded fetch) — wired into AI clients |
| [`smith knowledge validate`](./guide/14-cli-reference.md#smith-knowledge-validate-agent) | Lint knowledge blocks for one or all agents |
| [`smith knowledge wire`](./guide/14-cli-reference.md#smith-knowledge-wire-agent) | Wire the bundle's `<agent>-knowledge` MCP server into every detected AI client |
| [`smith knowledge unwire`](./guide/14-cli-reference.md#smith-knowledge-unwire-agent) | Inverse of `wire`: remove the per-agent key from the bundle and the spawn entry from each AI client |
| [`smith agent list`](./guide/14-cli-reference.md#smith-agent-list) | List every agent across registered catalogs |
| [`smith agent register <path>`](./guide/14-cli-reference.md#smith-agent-register-path) | Register a directory as an agent catalog |
| [`smith agent sync [name]`](./guide/14-cli-reference.md#smith-agent-sync-name) | Pull updates for one or all remote-backed agent catalogs (use `--check` for an offline drift probe) |
| [`smith skill catalogs`](./guide/14-cli-reference.md#smith-skill-catalogs) | List registered skill catalogs (including protected and ad-hoc) |
| [`smith skill install [ref]`](./guide/14-cli-reference.md#smith-skill-install-ref) | Install a skill from a catalog ref, `--from <path>`, or `--from <url>` |
| [`smith skill list`](./guide/14-cli-reference.md#smith-skill-list) | List skills across registered (non-adhoc) catalogs |
| [`smith skill register <path>`](./guide/14-cli-reference.md#smith-skill-register-path) | Register a directory as a skill catalog |
| [`smith skill sync [name]`](./guide/14-cli-reference.md#smith-skill-sync-name) | Pull updates for one or all remote-backed skill catalogs (mirror of `agent sync`) |
| [`smith skill uninstall <name>`](./guide/14-cli-reference.md#smith-skill-uninstall-name) | Remove an installed skill from all platforms |
| [`smith skill unregister`](./guide/14-cli-reference.md#smith-skill-unregister-path-or-label) | Remove a registered skill catalog (refuses protected catalogs; `--purge-clone` deletes a `--from <url>` clone) |
| [`smith skill update [name]`](./guide/14-cli-reference.md#smith-skill-update-name) | Re-copy installed skill(s) from their source catalogs |
| [`smith status`](./guide/14-cli-reference.md#smith-status) | Print canonical paths and a summary of registered catalogs |
| [`smith agent uninstall <name>`](./guide/14-cli-reference.md#smith-agent-uninstall-name) | Remove an installed agent from every target it was installed to |
| [`smith agent uninstall-all`](./guide/14-cli-reference.md#smith-agent-uninstall-all) | Remove every registered agent from every target |
| [`smith agent unregister <path-or-label>`](./guide/14-cli-reference.md#smith-agent-unregister-path-or-label) | Remove a registered agent catalog (add `--purge-clone` to also delete a `--from <url>` clone) |
| [`smith update`](./guide/14-cli-reference.md#smith-update) | Pull `agent-smith` from `origin/main`, install deps, run `doctor` |
| [`smith agent validate [name]`](./guide/14-cli-reference.md#smith-agent-validate-name) | Validate one or all bundles |

---

## Cross-cutting topics

A few topics touch every spoke. If you're hunting one of these, here's the canonical home:

- **Exit codes** — the four-tier taxonomy (`0/1/2/3`) and the per-command matrix live in [12 — Error handling, "Exit code taxonomy"](./guide/12-error-handling.md#exit-code-taxonomy). `smith doctor` has its own internal `0/1/2` system that does not align with the taxonomy — see [10 — Doctor, "Internal exit codes"](./guide/10-doctor.md#internal-exit-codes-the-trap).
- **The `update` pipeline's exit-code mapping** — including the breaking-change migration from `2` → `3` — is in [12 — Error handling, "Update pipeline"](./guide/12-error-handling.md#update-pipeline).
- **Paths and state files** — every file `smith` reads or writes, with format and ownership, is in [13 — Paths and state](./guide/13-paths-and-state.md).
- **The dual meaning of `--yes`** — `--yes` on `agent install` / `agent install-all` implies `--with-skills`; `--yes` on `agent uninstall-all` / `agent destroy` / `jack-out` skips the confirmation prompt (no install semantics). Documented in [03 — Installing and rendering, "`smith agent install <name>`"](./guide/03-installing-and-rendering.md#smith-agent-install-name) and noted again in [11 — Update and uninstall](./guide/11-update-and-uninstall.md).
- **Atlassian credential resolution** — the two-tier order (env-SMITH → file-SMITH) is canonical in [04 — Knowledge, "Credential resolution order"](./guide/04-knowledge.md#credential-resolution-order); cross-referenced from [13 — Paths and state, "Atlassian credentials"](./guide/13-paths-and-state.md#atlassian-credentials).
- **Required skills (`requires.skills`)** — canonical home is [05 — Skills, "Required skills"](./guide/05-skills.md#required-skills-requiresskills); install-time behavior is summarized in [03](./guide/03-installing-and-rendering.md#required-skills-behavior-during-install).
- **MCP servers** — the canonical "documentation only, smith does not install" rule and per-platform install commands are in [06 — Permissions and platforms, "MCP server dependencies"](./guide/06-permissions-and-platforms.md#mcp-server-dependencies).

A note on accuracy: earlier drafts of this guide contained several inaccuracies that were corrected during the spoke restructure (for example: claims about byte-identical install skips, about per-agent model fallback chains, about a `daemon.sock` file). The spokes are the source of truth. If you find a contradiction between a spoke and any other document (this hub, README, CHEATSHEET, code comments), the spoke wins; please file the discrepancy.

---

## What's NOT in this guide

- **[README.md](./README.md)** — installation quickstart and the project's external pitch. Read this first if you've never run `smith`.
- **[CHEATSHEET.md](./CHEATSHEET.md)** — terse one-line reference. Use it when you know what you want and just need the syntax.
- **`docs/`** — design specs, audit reports, follow-up tracking. Internal working documents, not user-facing reference.
- **Source code** — for any behavior detail not covered by a spoke, every command is registered in `src/index.ts` and implemented under `src/cli/commands/`. Spokes routinely cite `file:line` for verifiable claims.

---

## Glossary

Definitions for the vocabulary used across the spokes. Each entry links to the spoke that owns the concept.

- **Ad-hoc catalog** — a synthetic skill catalog auto-created by `smith skill install --from <path>` to track an out-of-tree install. Filtered out of `smith skill list` by default; auto-pruned when the last skill from it is uninstalled. See [05 — Skills, "Ad-hoc registration"](./guide/08-registries-and-catalogs.md#ad-hoc-registration-via-smith-skill-install-from).
- **Advisory warning** — a stderr message that does not change exit code or block the operation. Used for missing MCP servers, drift status, missing required skills, etc. See [06 — Permissions and platforms](./guide/06-permissions-and-platforms.md#mcp-server-dependencies).
- **Agent** — an AI assistant defined by a bundle and installed onto one or more platforms. See [02 — Bundle anatomy](./guide/02-bundle-anatomy.md).
- **Bootstrap** — `scripts/bootstrap.ts`. Installs the bundled skills (`the-architect`, `the-keymaker`) and the `agent-smith` persona onto every detected platform. Runs automatically as a `bun install` postinstall hook (skipped when `AGENT_SMITH_SKIP_POSTINSTALL=1` or `CI=true`). Also fires as part of `bin/install`'s `bun install` step during a fresh install or `smith update`. Idempotent. See [01 — Getting started](./guide/01-getting-started.md).
- **Bundle** — a directory containing `agent.config.json` and the persona files (`IDENTITY.md`, `EXPERTISE.md`, `SOUL.md`, `USER.md`). The canonical agent definition. See [02 — Bundle anatomy](./guide/02-bundle-anatomy.md).
- **Catalog** — a registered directory containing one or more bundles (agent catalog) or one or more `SKILL.md`-rooted directories (skill catalog). Tracked in `registry.json` (agents) or `skill-catalogs.json` (skills). See [08 — Registries and catalogs](./guide/08-registries-and-catalogs.md).
- **Daemon** — the optional background watcher (`smith daemon start`) that re-installs on bundle changes, pulls git-backed catalogs every 15 minutes, and refreshes `ttl`-mode knowledge sources on an independent 5-minute tick. See [09 — The daemon](./guide/09-daemon.md).
- **Doctor** — the 15-section health check (`smith doctor`) covering schema drift, model resolution, skill drift, registry hygiene, per-platform detection (opencode, claude-code, codex, kiro), and more. Has its own internal exit-code system. See [10 — Doctor](./guide/10-doctor.md).
- **Drift** — the recorded source-content hash for an installed skill no longer matches the source on disk. Reported by `smith skill list` and `smith doctor`; never blocks operations. See [05 — Skills, "Drift and doctor"](./guide/05-skills.md#drift-and-doctor).
- **Heartbeat** — the JSON file `~/.local/state/agent-smith/daemon.heartbeat.json` that the daemon rewrites atomically every few seconds. `smith daemon start` polls it to confirm successful startup; `smith daemon status` does not consult it. See [09 — The daemon, "Heartbeat"](./guide/09-daemon.md#heartbeat).
- **Install** — `smith agent install <name>` builds the bundle, resolves required skills and the model tier, materializes knowledge, and writes per-platform files. See [03 — Installing and rendering](./guide/03-installing-and-rendering.md).
- **Jack-out** — `smith jack-out`. Full offboarding in a single command: uninstalls every agent and every installed skill, removes `~/.config/agent-smith/`, the `~/.local/bin/smith` symlink, the agent-smith marker block from your shell rc, and the `~/.agent-smith/` source clone itself. Does NOT remove the doctor schema cache (`~/.cache/agent-smith/`). See [11 — Update and uninstall, "`smith jack-out`"](./guide/11-update-and-uninstall.md#smith-jack-out).
- **Knowledge sidecar** — an optional `knowledge.json` file alongside `agent.config.json` whose contents merge into the bundle's `knowledge` block (per-source-id, sidecar wins on collision). See [02 — Bundle anatomy, "`knowledge.json` sidecar"](./guide/02-bundle-anatomy.md#knowledgejson-sidecar).
- **Knowledge source** — a per-agent declaration of where to fetch reference material from: `file`, `dir`, `glob`, `url`, `git`, `confluence`, or `jira`. Materialized once into smith's own state home (`~/.config/agent-smith/knowledge/<agent>/`) at install time; every translator emits a permission grant or sidecar pointer to that location, so all targets read the same bytes. See [04 — Knowledge](./guide/04-knowledge.md).
- **MCP** — Model Context Protocol. `mcpServers` in a bundle is normally documentation-only; the per-agent knowledge MCP server is the one exception — `smith knowledge wire <agent>` and the GUI toggle write spawn entries into the detected AI-client configs. See [06 — Permissions and platforms, "MCP server dependencies"](./guide/06-permissions-and-platforms.md#mcp-server-dependencies).
- **modelTier** — the portable tier name (`balanced`, `fast`, `high`, `inherit`; legacy aliases `opus`, `sonnet`, `haiku`) declared in `agent.config.json`. Resolved per platform at install time. See [07 — Models](./guide/07-models.md).
- **Permission preset** — one of `read-only`, `read-edit`, `full`. Expands at validation time to a `PermissionConfig` block; each platform translator drops the groups it doesn't support. See [06 — Permissions and platforms, "The three permission presets"](./guide/06-permissions-and-platforms.md#the-three-permission-presets).
- **Persona** — the four bundle files that define an agent's voice and capability: `IDENTITY.md` (who), `EXPERTISE.md` (what), `SOUL.md` (how), `USER.md` (your shared context, symlinked from canonical). See [02 — Bundle anatomy, "Persona files"](./guide/02-bundle-anatomy.md#persona-files).
- **Protected catalog** — a skill catalog that `smith skill unregister` refuses to remove. Currently only `atlassian-skills` is protected. See [08 — Registries and catalogs, "The `atlassian-skills` catalog"](./guide/08-registries-and-catalogs.md#the-atlassian-skills-catalog).
- **Registry** — `registry.json` (agents) or `skill-catalogs.json` (skills). The on-disk record of registered catalogs. The two registries have different kind vocabularies (`user-global|project|registered` vs `user-global|user-local|team-shared`). See [08 — Registries and catalogs](./guide/08-registries-and-catalogs.md).
- **Render** — the build step that concatenates `IDENTITY → EXPERTISE → SOUL → USER → KNOWLEDGE → SKILLS` into a single system prompt body, then hands the result to a per-platform translator. See [03 — Installing and rendering, "What 'build' means"](./guide/03-installing-and-rendering.md#what-build-means).
- **Skill** — a reusable instruction/workflow unit identified by a `SKILL.md` file at the root of its directory. Installed across platforms by `smith skill install`. See [05 — Skills](./guide/05-skills.md).
- **`source-missing`** — a drift status indicating that the catalog an installed skill came from is no longer registered (or was removed without first uninstalling the skill). Recorded in `installed-skills.json`; remediated by re-registering the catalog or uninstalling the skill. See [05 — Skills, "Drift and doctor"](./guide/05-skills.md#drift-and-doctor).
- **Target** — one of `opencode`, `claude-code`, `codex`, `kiro`, `agents-md`. Declared per-bundle in `targets`; controls which translators run at install time. See [03 — Installing and rendering, "Per-platform output"](./guide/03-installing-and-rendering.md#per-platform-output).
- **Manifest (installed-agents.json)** — the per-host record of which agents `smith` has installed and the SHA-256 of each rendered file. Used for hash-mismatch refusal (`smith` won't overwrite a file it doesn't recognize without `--force`), lazy-claim on hash-match, and idempotent reinstall. See [03 — Installing and rendering](./guide/03-installing-and-rendering.md) and [13 — Paths and state](./guide/13-paths-and-state.md).
- **Platform convention** — a non-bundle context path (e.g. Kiro's `.kiro/steering/**/*.md`) that the bundle can request and the user can govern via `~/.config/agent-smith/conventions.json`. Resolved at render time via a 3-tier precedence (bundle declaration → user-global override → CLI/prompt) and injected into the platform-native output. See [06 — Permissions and platforms](./guide/06-permissions-and-platforms.md).
- **`--force`** — install/uninstall flag that bypasses the manifest's hash-mismatch refusal. Always opt-in: never silent, never default. See [11 — Update and uninstall](./guide/11-update-and-uninstall.md) and [14 — CLI reference](./guide/14-cli-reference.md).
- **Translator** — the per-platform module under `src/core/translators/` that turns the rendered canonical body plus config into a platform-native file. Each translator drops capability groups its target doesn't support and emits warnings for surprising omissions. See [06 — Permissions and platforms, "Per-platform translator behavior"](./guide/06-permissions-and-platforms.md#per-platform-translator-behavior).

---

← [Back to README](./README.md)
