# Security policy

## Reporting a vulnerability

**Do not file public GitHub issues for security reports.** Public issues become indexed and discoverable before a fix is available.

Instead, report privately through GitHub's Security Advisories:

**[Open a private security advisory →](https://github.com/eliharoun/agent-smith/security/advisories/new)**

Include in your report:

- A clear description of the vulnerability and its impact
- Steps to reproduce, or a minimal proof-of-concept
- Affected versions (run `smith --version`)
- Your environment (OS, Bun version, platform CLIs in use)
- Any suggested mitigations or fixes, if you have them

You should expect an initial acknowledgement within a few days. Subsequent updates depend on severity — high-impact issues get prioritized.

## Scope

In scope:

- The `smith` CLI itself (anything under `src/`, `bin/install`, `scripts/`)
- The `smith gui` server (`gui/server/`) and its API endpoints
- The bundled skills `the-architect` and `the-keymaker`
- The companion agent `agent-smith` and its rendered outputs
- Anything that affects user data on disk (`~/.config/agent-smith/`, `~/.local/state/agent-smith/`) or installed agents in platform dirs

Out of scope:

- Vulnerabilities in the underlying platforms (OpenCode, Claude Code, Codex, Kiro) — report those upstream
- Vulnerabilities in third-party MCP servers
- Vulnerabilities in user-authored agent bundles or skills
- Issues that require an attacker to already have local code-execution on the user's machine

## Disclosure

When a fix is ready, the advisory becomes public. If a CVE is appropriate, GitHub's CNA can assign one. Reporters who request credit will be acknowledged in the advisory and release notes.

## What this tool does that's worth thinking about

`agent-smith` writes files to several locations on the user's machine:

- `~/.agent-smith/` (the source clone)
- `~/.config/agent-smith/` (state: registry, bundles, USER.md, manifests)
- `~/.local/bin/smith` (CLI symlink)
- `~/.config/opencode/agents/`, `~/.claude/agents/`, `~/.agents/skills/`, `~/.kiro/agents/` (rendered agents)

It also runs `git pull` (via `smith update` and the daemon) and can fetch knowledge sources from arbitrary HTTP, git, Confluence, and Jira URLs declared in agent bundles.

The threat model treats user-authored bundles as trusted (you wrote them, or you registered the catalog) but expects bundle *content* to be reviewed before install. Bundles imported from a `--from <url>` install go through schema validation but not deep semantic review — the user is expected to inspect what they're installing, the same as with any `npm install` or `git clone && bash install.sh` workflow.

If you find a way for a malicious bundle, knowledge source, or registered catalog to escape these boundaries — for example by writing outside the documented paths, executing arbitrary code without user consent, or exfiltrating credentials — that's exactly the kind of issue this policy is for.
