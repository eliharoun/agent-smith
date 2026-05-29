# Changelog

All notable changes to `agent-smith` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Multi-bundle `smith {skill,agent} install --from <url>`: discover bundles, pick one or
  more (and which platforms), install together. CLI picker + GUI two-step modal. New flags
  `--all`, `--skills`/`--agents`, `--json`.

### Fixed
- `kiro` is now a valid `--targets` value for skills and installs to `~/.kiro/skills`
  (the GUI install matrix's kiro toggle previously failed).
- `skill install --targets <p>` now creates a missing platform skill dir instead of
  silently skipping it.

## [1.0.0] — 2026-05-28

Initial public release.

### Features

- `smith` CLI: scaffold, validate, install, update, and uninstall agent bundles across OpenCode, Claude Code, Codex, and Kiro
- Companion agent `agent-smith` with the eight-question authoring workflow (`the-architect` skill)
- Skill-authoring workflow (`the-keymaker` skill)
- Skill lifecycle management: `smith skill {register, install, update, uninstall, sync, validate, bootstrap}`
- Per-agent knowledge sources: files, directories, globs, URLs, git repos, Confluence pages, Jira issues
- Catalog system with three kinds for agents (`user-global`, `project`, `registered`) and three for skills (`user-global`, `user-local`, `team-shared`)
- Manifest-based ownership tracking via `installed-agents.json` and `installed-skills.json` (idempotent reinstall, hash-mismatch refusal on uninstall)
- Optional background daemon for catalog sync and TTL-mode knowledge refresh
- Health-check command (`smith doctor`) with platform schema drift detection, registry hygiene, and Atlassian credential checks
- Browser GUI (`smith gui`) wrapping every CLI surface with persistent job history
- Four bundled example agents: `incident-debugger`, `security-threat-modeler`, `repo-cartographer`, `knowledge-demo`

[Unreleased]: https://github.com/eliharoun/agent-smith/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/eliharoun/agent-smith/releases/tag/v1.0.0
