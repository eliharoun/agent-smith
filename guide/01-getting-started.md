# Getting started

> The on-ramp. Read this once when setting up a fresh machine. It walks the minimal path from "no smith on disk" to "first agent installed and verified", points at the right spoke for each next step, and lists the things smith touches on your filesystem.

If you already know the system and just need a command-by-command reference, jump straight to [14-cli-reference.md](./14-cli-reference.md). If you want to know what a bundle is or how install actually works, this spoke summarizes those concepts and links to the full treatment in [02-bundle-anatomy.md](./02-bundle-anatomy.md) and [03-installing-and-rendering.md](./03-installing-and-rendering.md).

## What agent-smith is

`agent-smith` is an lifecycle manager for AI coding agents. It treats an agent as a portable bundle (one directory of markdown plus a JSON config) and installs that bundle into the platforms you actually use: OpenCode, Claude Code, Codex, Kiro, and any AGENTS.md-aware tool (the fifth `agents-md` target requires no CLI). Each platform gets a native, idiomatic agent file rendered from the same canonical source. The CLI also manages skills (the open Anthropic Agent Skills format), per-agent knowledge sources, and a background daemon that re-installs when bundles change and refreshes `ttl`-mode knowledge sources on a 5-minute tick.

The CLI binary is named `smith`. Throughout this guide every command starts with that name.

## Prerequisites

You need:

- **[Bun](https://bun.sh) >= 1.1.0.** Smith runs on the Bun runtime; it does not work under Node. Verify with `bun --version`. Source: `package.json:24-26`. The npm postinstall and the from-source `bin/install` both expect bun on PATH; the npm postinstall prints a hint and exits cleanly when bun is missing so the package install itself succeeds.
- **At least one of the four runtime platform CLIs (the fifth target, `agents-md`, requires no CLI).** Smith targets OpenCode (`~/.config/opencode/`), Claude Code (`~/.claude/`), Codex (`~/.codex/` and `~/.agents/`), and Kiro (`~/.kiro/`). You do not need all four — bundles can declare any subset of `opencode`, `claude-code`, `codex`, `kiro` in their `targets` field. Platforms whose install directories don't exist are skipped silently.
- **Write access to your home directory.** Smith owns `~/.config/agent-smith/` for its registry, source bundles, and USER.md. Daemon runtime files live under `~/.local/state/agent-smith/`. It writes per-platform agent files into the directories above and skill files into `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`, and `~/.kiro/skills/`.

If you intend to use Atlassian-backed knowledge sources (Confluence, Jira) or the bundled atlassian-skills catalog (Jira/Confluence/Bitbucket runtime tools), see [04-knowledge.md#atlassian-authenticated-sources](./04-knowledge.md#atlassian-authenticated-sources) for credential setup. None of that is required to start.

## Installing the `smith` CLI

There are two supported install paths:

- **From npm (recommended).** `npm install -g @eliharoun/agent-smith` ships the CLI plus the bundled skills. Fastest way to start using `smith`.
- **From source.** A `git clone` + `bash bin/install` flow. Pick this if you intend to develop `agent-smith` itself or hack on the GUI source.

Both paths land at the same `smith` command on your PATH.

### Quickstart (recommended): from npm

**Requires [Bun](https://bun.sh) >= 1.1.0.** `agent-smith` runs on the Bun runtime; it does not work under Node. Verify with `bun --version`.

```bash
# Install bun if you don't have it
curl -fsSL https://bun.sh/install | bash

# Install agent-smith from npm
npm install -g @eliharoun/agent-smith

# Initialize state and verify
smith init
smith status
```

The npm package's postinstall hook copies the bundled skills (`the-architect`, `the-keymaker`) into the per-platform skill directories. When `bun` is not on your PATH at install time, the hook prints a one-line hint and exits cleanly — the package installs but doesn't bootstrap until bun is available, after which you can run `smith skill bootstrap` manually. Set `AGENT_SMITH_SKIP_POSTINSTALL=1` to skip the hook entirely.

The npm install **includes** the GUI — the prebuilt SPA bundle and the raw-TypeScript GUI server both ship in the package, so `smith gui` works out of the box (Bun is required at runtime, as for the rest of the CLI). The from-source path below adds nothing for running the GUI; it only gives you editable GUI source and auto-rebuild on `git pull`.

### From source (for development)

Use this path if you want to develop `agent-smith` itself, hack on the GUI source (editable source + auto-rebuild), or need full control over the install layout.

**Prerequisites**

- [`gh`](https://cli.github.com/) CLI, authenticated. Verify with `gh auth status`. (Or substitute `git clone`.)
- Bash 3.2+ (macOS system bash is fine).
- The installer will offer to install [Bun](https://bun.sh) (>= 1.1.0) if missing.

**Install**

```bash
gh repo clone eliharoun/agent-smith ~/.agent-smith && bash ~/.agent-smith/bin/install
```

The installer:
1. Sanity-checks that you're inside an agent-smith clone.
2. Detects whether this is a fresh install or an update of an existing `~/.agent-smith/` install (or refuses with migration hints if a conflicting `smith` is on PATH).
3. Installs Bun if needed (with a consent prompt).
4. (Update mode) `git pull --ff-only origin main`. Refuses on a dirty tree.
5. Runs `bun install`, which fires the postinstall hook. The hook installs only the bundled skills (`the-architect` and `the-keymaker`) into the per-platform skill dirs; it does **not** install the `agent-smith` persona. Persona installation happens separately in Step 10 below (or, for manual recovery, via `smith agent install agent-smith`).
6. (Fresh and update) Builds the GUI SPA bundle (`bun run gui:build`). Warn-and-continue on failure — the CLI works regardless, but `smith gui` will 404 until you run `bun run gui:build` manually.
7. (Fresh install) Creates the symlink `~/.local/bin/smith` → `~/.agent-smith/src/index.ts`.
8. Adds `~/.local/bin` to your PATH via a marker block in your shell rc (`~/.zshrc`, `~/.bash_profile`, or `~/.bashrc`). Use `--no-modify-path` to skip this.
9. Prints a summary.
10. Runs `smith agent install agent-smith` so the in-platform companion agent is rendered into every detected platform (OpenCode, Claude Code, Codex, Kiro) with its bundled knowledge dir materialized from `guide/`. A failure here prints a warning and continues — the rest of the install (binary, PATH wiring, state init) is already complete.

### Verify

Open a new shell (so the PATH change takes effect), then:

```bash
smith doctor
```

This runs the health check, auto-filtered to the platform CLIs on your `PATH` (`opencode`, `claude`, `codex`, `kiro`/`kiro-cli`): schema-drift checks for whichever of those you have installed, plus cross-cutting sections (atlassian auth, agent-required-skills audit, etc.). A clean run exits `0`. If you haven't yet installed any of the four platform CLIs, doctor refuses to run and exits `2` with install one-liners — install at least one platform CLI and re-run. See [Doctor](./10-doctor.md) for full details.

> **Tip — browser GUI.** `smith gui` launches a local browser interface that wraps every command in this guide (`smith init`, `smith init-user`, `smith agent install`, `smith doctor`, etc.) plus a guided first-run onboarding flow. It works straight from an `npm install -g @eliharoun/agent-smith` — the GUI ships in the package (Bun required at runtime). See [README → Browser GUI](../README.md#browser-gui-smith-gui).

### What got installed where

From an `npm install -g @eliharoun/agent-smith`:

- `<npm prefix>/lib/node_modules/agent-smith/` — package source (managed by npm).
- `<npm prefix>/bin/smith` — entry point on your PATH.
- `~/.config/agent-smith/` — runtime config (registry, knowledge state, etc.). Created on first `smith init`.
- Bundled skills (`the-architect`, `the-keymaker`) materialized into the per-platform skill dirs by the postinstall hook (when `bun` is on PATH).

From the source path (`bash bin/install`):

- `~/.agent-smith/` — source clone (your dev workspace if you contribute).
- `~/.local/bin/smith` — symlink to `~/.agent-smith/src/index.ts`.
- `~/.config/agent-smith/` — runtime config (registry, knowledge state, etc).
- `~/.local/bin` on PATH — added via the marker block in your shell rc.

### Re-running the installer (from-source path)

`bash ~/.agent-smith/bin/install` is idempotent. Re-running it on an existing install switches to update mode: `git pull` + `bun install`. The PATH wiring is checked and skipped if already present.

### Update later

```bash
smith update
```

Upgrades agent-smith for both source and packaged installs. For source installs, equivalent to `bin/install` in update mode; for npm/bun/pnpm installs, runs the package manager's global upgrade and then refreshes + runs doctor. Works from anywhere on PATH.

### Uninstall

```bash
smith jack-out
```

Removes installed agents, `~/.config/agent-smith/`, the `~/.local/bin/smith` symlink, the marker block from your shell rc, and the `~/.agent-smith/` source clone. Single command. No "after this command finishes, run..." coda.

## The first three commands (mostly automatic now)

The installer's Step 8b runs `smith init` for you, so on a fresh install `~/.config/agent-smith/` is already initialized when the installer returns. The two `init*` commands below are now **optional** — useful for inspecting the install or re-seeding state if `~/.config/agent-smith/` ever gets corrupted.

### 1. `smith init` — (optional) re-seed the config dir

```bash
smith init
```

`smith init` is idempotent — re-running on an already-initialized install only writes files that are missing. The installer (`bash bin/install` Step 8b) calls this automatically; you only run it manually for recovery from a corrupt-shape or version-skewed registry. Source: `src/cli/commands/init.ts`.

| Path | Purpose |
|---|---|
| `~/.config/agent-smith/agents/` | empty directory; default user-global agent catalog |
| `~/.config/agent-smith/registry.json` | catalog list with one entry: `user-global` → `agents/` |
| `~/.config/agent-smith/USER.md` | placeholder file with a comment block |

For the full reference, see [`smith init`](./14-cli-reference.md#smith-init).

### 2. `smith init-user` — write your shared context

```bash
smith init-user
```

Opens `~/.config/agent-smith/USER.md` in `$EDITOR` (default `vi`). Edit the file to describe yourself, your role, your environment, and any preferences you want every agent to see. Every installed bundle reads this file via a symlink, so it functions as a small global system prompt. See [02-bundle-anatomy.md#usermd](./02-bundle-anatomy.md#usermd) for the symlink mechanics.

If `$EDITOR` resolves to a binary that doesn't exist on your `PATH`, `smith init-user` exits `1` with a `usage-error` and a `Try: export EDITOR=...` suggestion (`src/cli/commands/init-user.ts`). Set `$EDITOR` to your preferred editor and re-run.

You can also edit the file directly without going through `init-user` — the command exists for convenience.

### 3. `smith status` — confirm the layout

```bash
smith status
```

Prints the canonical paths smith reads (registry, USER.md, skill catalogs file, installed-skills file, daemon files) plus two registry tables — `Agent catalogs (N)` and `Skill catalogs (N)`. Use `status` whenever you want to confirm smith is reading the config dir you expect. See [`smith status`](./14-cli-reference.md#smith-status).

## Your first agent

The fastest path to a working installed agent is to clone one of the bundled examples with `--from`. The four examples that ship in `examples/` are documented in the [README](../README.md#examples). Pick one — `incident-debugger` is a good starting point.

```bash
smith agent init my-debugger --from incident-debugger
smith agent validate my-debugger
smith agent install my-debugger
smith doctor
```

What each step does:

1. **`agent init`** copies the example bundle into `~/.config/agent-smith/agents/my-debugger/`. The original example in the package is untouched. Pass `--catalog <label>` to scaffold into a registered catalog instead. See [`agent init` flags](#agent-init-flags) below, or [14-cli-reference.md#smith-agent-init-name](./14-cli-reference.md#smith-agent-init-name) for the full reference.
2. **`agent validate`** runs the bundle linter against the persona files and config. See [02-bundle-anatomy.md#smith-agent-validate](./02-bundle-anatomy.md#smith-agent-validate).
3. **`agent install`** renders the bundle for each platform in `targets` and writes the rendered agent file to disk. See [03-installing-and-rendering.md](./03-installing-and-rendering.md) for the full pipeline.
4. **`doctor`** runs the platform-side health check (schema drift, model resolution, installed agents, registry hygiene, etc.). See [10-doctor.md](./10-doctor.md).

A successful install prints one line per `target × file written` plus a summary. If the bundle has knowledge sources, the summary is followed by a per-source `→ knowledge <id>` / `· knowledge <id> (unchanged)` block and a knowledge tally — see [03-installing-and-rendering.md#knowledge-materialization-summary](./03-installing-and-rendering.md#knowledge-materialization-summary). If any platform target failed, the command exits `1` and the headline tells you which agent and which target.

### `agent init` flags

`smith agent init <name>` is the canonical scaffold command. The minimum invocation requires `--description`:

```bash
smith agent init triage-bot --description "Routes new GitHub issues to the right team"
```

`--description` must be at least 10 characters (and ≤200) and must start with an action verb (e.g. `Routes`, `Reviews`, `Drafts`, or the literal word `Use`). The full regex is documented in [02-bundle-anatomy.md#description-regex-action_phrase](./02-bundle-anatomy.md#description-regex-action_phrase).

Without other flags, the bundle defaults to all four targets, `balanced` model tier, `primary` mode, and the `read-edit` permission preset.

| Flag | Format | Effect |
|---|---|---|
| `--description <text>` | string (10–200 chars, action phrase) | required |
| `--targets <list>` | comma-separated `opencode,claude-code,codex,kiro,agents-md` | defaults to the four runtime platforms; add `agents-md` for a documentation-target rendering |
| `--model-tier <tier>` | `balanced` \| `fast` \| `high` \| `inherit` (aliases: `opus`, `sonnet`, `haiku`) | default `balanced` |
| `--mode <mode>` | `primary` \| `subagent` \| `all` | default `primary` |
| `--permission <preset>` | `read-only` \| `read-edit` \| `full` | default `read-edit` |
| `--permission-json <json>` | raw `PermissionConfig` JSON object | overrides `--permission` |
| `--mcp-servers <list>` | comma-separated server names | populates `mcpServers`; advisory only — see [06](./06-permissions-and-platforms.md#mcp-server-dependencies) |
| `--skills <list>` | comma-separated skill names | populates the `## Default Skills` section in the assembled body |
| `--requires-skills <list>` | comma-separated skill refs (`<catalog>/<name>` or `<name>`) | populates `requires.skills` (controls install-time delivery) |
| `--from <bundle>` | local bundle name OR bundled-example name | clone an existing bundle as the starting point |
| `--catalog <label-or-path>` | registered catalog label or absolute path | scaffold into a registered catalog (instead of the default `~/.config/agent-smith/agents/`); see [CLI reference](./14-cli-reference.md#smith-agent-init-name) |

Three flags are easily confused — they sound similar but address different concerns:

- **`--mcp-servers`** is documentation only. It produces no allowlist, no per-server gating; the only observable effect is an advisory warning at install time when a named server is not configured on a target. See [06-permissions-and-platforms.md#what-mcpservers-actually-does](./06-permissions-and-platforms.md#what-mcpservers-actually-does).
- **`--skills`** populates a prose-level `## Default Skills` section appended to the assembled body. It is a hint to the model. It does not gate runtime access (that is `permission.skill`) and it does not arrange for the skills to be installed (that is `requires.skills`).
- **`--requires-skills`** is the delivery declaration. At install time smith checks each entry against `~/.config/agent-smith/installed-skills.json` and either prompts to install, auto-installs (`--with-skills`/`--yes`), or skips with a warning (`--no-skills`). See [05-skills.md#required-skills-requiresskills](./05-skills.md#required-skills-requiresskills).

`--from` resolves the source bundle in this order: your local agents catalogs (registered via `smith agent register`) first, then the package's bundled `examples/` directory. Local copies always win on collision.

`smith agent init` exits `1` if a bundle of that name already exists in your default catalog, or if `--catalog` resolves to no registered catalog (`not-found` — run `smith agent catalogs` to list valid labels). To start over with the same name, use `smith agent destroy <name> --force` (the inverse of `agent init` — removes both the rendered installs and the source bundle in one step), then re-run `agent init`. See [11-update-and-uninstall.md#smith-agent-destroy-name](./11-update-and-uninstall.md#smith-agent-destroy-name).

After scaffolding, edit the four persona files. They are concatenated into the rendered agent in fixed order — `IDENTITY → EXPERTISE → SOUL → USER` — joined with `---` separators, and per-platform translators wrap that body in idiomatic frontmatter. See [02-bundle-anatomy.md#persona-files](./02-bundle-anatomy.md#persona-files) for what belongs in each file and the line-count windows the validator warns on.

## Where things land

After `smith agent install my-debugger`, files exist in several places. This is the short version; the full reference is [13-paths-and-state.md](./13-paths-and-state.md).

### Smith-owned (`~/.config/agent-smith/`)

| Path | Purpose |
|---|---|
| `agents/my-debugger/{IDENTITY,EXPERTISE,SOUL}.md` | source persona files (yours to edit) |
| `agents/my-debugger/USER.md` | symlink to `~/.config/agent-smith/USER.md` (personal catalogs) or stub file (registered catalogs) — see [Bundle anatomy § USER.md and catalog kind](./02-bundle-anatomy.md#usermd-and-catalog-kind) |
| `agents/my-debugger/agent.config.json` | bundle config |
| `registry.json` | known agent catalogs |
| `skill-catalogs.json` | known skill catalogs |
| `installed-skills.json` | what skills are installed where, with hashes for drift detection |
| `installed-agents.json` | what agents are installed where, with hashes for hash-mismatch refusal and lazy-claim |
| `conventions.json` | user-global platform-conventions overrides (kiro steering paths, etc.) — see [06-permissions-and-platforms.md](./06-permissions-and-platforms.md) |
| `USER.md` | shared user context, symlinked into every bundle |

### Per-platform agent files

| Platform | Agents dir | Skills dir | MCP/agent config |
|---|---|---|---|
| OpenCode | `~/.config/opencode/agents/<name>.md` | `~/.config/opencode/skills/<name>/SKILL.md` | `~/.config/opencode/opencode.json` |
| Claude Code | `~/.claude/agents/<name>.md` | `~/.claude/skills/<name>/SKILL.md` | `~/.claude.json` |
| Codex | `~/.agents/skills/<name>/SKILL.md` | `~/.agents/skills/<name>/SKILL.md` | `~/.codex/config.toml` |
| Kiro | `~/.kiro/agents/<name>.json` | `~/.kiro/skills/<name>/SKILL.md` | `~/.kiro/agents-hooks.json` (agentSpawn merge) |

Codex agents and skills share `~/.agents/skills/`. Both are directory-with-`SKILL.md` shaped; name collisions are only possible if a skill and an agent share a name. See [05-skills.md#caveats-and-gotchas](./05-skills.md#caveats-and-gotchas).

### Per-agent knowledge directory

If your bundle declares `knowledge.sources`, smith materializes each source under agent-smith's own state home (`~/.config/agent-smith/knowledge/<name>/`) regardless of which platforms the agent targets:

```
~/.config/agent-smith/knowledge/<name>/
├── _manifest.json
├── sources/<id>/...
└── .cache/
```

Every target (OpenCode, Claude Code, Codex, Kiro) gets a read grant injected into its rendered output so it can reach this directory at runtime. See [04-knowledge.md#where-knowledge-lives-on-disk](./04-knowledge.md#where-knowledge-lives-on-disk).

## What a bundle looks like

If you want to understand what `agent init` produced, here is the minimum a bundle directory contains:

```
my-debugger/
├── agent.config.json     canonical config (name, targets, modelTier, permissions, ...)
├── IDENTITY.md           who the agent is (15–25 lines)
├── EXPERTISE.md          what it knows / can do (40–100 lines)
├── SOUL.md               voice, tone, working style (15–30 lines)
└── USER.md               symlink → ~/.config/agent-smith/USER.md (or stub for registered catalogs)
```

Plus an optional `knowledge.json` sidecar that merges into `agent.config.json`'s `knowledge` field. The directory name must equal the `name` field inside `agent.config.json` (both follow the `KEBAB` regex). The full schema, validator behavior, and per-file rules live in [02-bundle-anatomy.md](./02-bundle-anatomy.md).

## Where to go next

Once you have one agent installed, the rest of the guide is organized by topic. Read in this order if you want a thorough orientation; otherwise jump to the spoke that matches the task you have in front of you.

| Read this when... | Spoke |
|---|---|
| You want to understand what's inside a bundle and what each field means | [02-bundle-anatomy.md](./02-bundle-anatomy.md) |
| You want to understand what `smith agent install` actually does, per platform | [03-installing-and-rendering.md](./03-installing-and-rendering.md) |
| You want to add per-agent knowledge sources (files, URLs, Confluence, Jira, git) | [04-knowledge.md](./04-knowledge.md) |
| You want to install or author skills, or use `requires.skills` | [05-skills.md](./05-skills.md) |
| You want to tune permissions, declare MCP server dependencies, or understand per-platform behavior | [06-permissions-and-platforms.md](./06-permissions-and-platforms.md) |
| You want the daemon to re-install bundles when they change | [09-daemon.md](./09-daemon.md) |
| `smith doctor` is reporting drift or you want to understand what it checks | [10-doctor.md](./10-doctor.md) |
| You need every command, every flag, every exit code | [14-cli-reference.md](./14-cli-reference.md) |

To remove an agent (or smith itself), see [11-update-and-uninstall.md](./11-update-and-uninstall.md). For the exit-code taxonomy and troubleshooting recipes, see [12-error-handling.md](./12-error-handling.md). For the complete filesystem layout, see [13-paths-and-state.md](./13-paths-and-state.md).

## See also

- [GUIDE.md](../GUIDE.md) — the hub: task index, command index, glossary
- [README.md](../README.md) — the overview, including the bundled-examples table
- [CHEATSHEET.md](../CHEATSHEET.md) — mechanical command reference
- [02-bundle-anatomy.md](./02-bundle-anatomy.md) — bundle schema and validation
- [03-installing-and-rendering.md](./03-installing-and-rendering.md) — render pipeline
- [14-cli-reference.md](./14-cli-reference.md) — every command and flag
