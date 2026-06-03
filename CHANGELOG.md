# Changelog

All notable changes to `agent-smith` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
