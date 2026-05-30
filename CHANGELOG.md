# Changelog

All notable changes to `agent-smith` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/eliharoun/agent-smith/releases/tag/v1.0.0
