# Changelog

All notable changes to `agent-smith` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.1]: https://github.com/eliharoun/agent-smith/releases/tag/v1.1.1
[1.1.0]: https://github.com/eliharoun/agent-smith/releases/tag/v1.1.0
[1.0.0]: https://github.com/eliharoun/agent-smith/releases/tag/v1.0.0
