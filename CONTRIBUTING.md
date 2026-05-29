# Contributing to agent-smith

## Updating tool maps

agent-smith's translation from capability presets (`read-edit`, `full`, ...) to platform tool allow-lists is driven by static maps in `data/`:

- `data/opencode.config.schema.json` — vendored from <https://opencode.ai/config.json>
- `data/claude-code-tool-map.json` — capability group → claude-code tool names
- `data/codex-tool-map.json` — capability group → codex tool names
- `data/kiro-tool-map.json` — capability group → kiro tool names
- `data/kiro.agent-v1.schema.json` — vendored kiro agent JSON schema (strict; `additionalProperties: false`)

Each file carries a `_meta` block (provenance) so users running `smith doctor` see when it was last verified and against which platform version.

### Refreshing the OpenCode schema

1. `bun run check-drift` — see what changed in the upstream schema.
2. Review the printed diff. If the changes are agent-facing (new permission groups, renamed fields), continue. If purely cosmetic (reordered enums), you can either skip or accept.
3. `bun run refresh-schemas` — overwrite the vendored copy and update the meta sidecar.
4. If the schema added new permission groups, update `data/claude-code-tool-map.json` and `data/codex-tool-map.json` to include their cross-platform equivalents (or add a `notes` entry explaining why a mapping is intentionally omitted).
5. `bun test` — contract tests catch breakages.
6. Commit, open a PR.

### Refreshing the Claude Code tool map

1. Read <https://docs.anthropic.com/en/docs/claude-code/sdk/agents/tools> (or whatever URL is stored in `data/claude-code-tool-map.json` `_meta.sourceUrl`).
2. Edit `data/claude-code-tool-map.json`:
   - Adjust `mapping` to reflect any added/renamed/removed tools.
   - Bump `_meta.lastVerifiedDate` to today (`YYYY-MM-DD`).
   - Update `_meta.verifiedAgainstVersion` (e.g. `"claude-code v0.45.0"`).
   - Update `_meta.notes` if the verification surfaced anything noteworthy.
3. `bun test` — the contract tests will fail loudly if the new shape breaks anything.
4. Open a PR.

### Refreshing the Codex tool map

Same as Claude Code, but edit `data/codex-tool-map.json`. Codex's tool vocabulary is still evolving (the source is currently <https://github.com/openai/codex>, with no published tool registry), so it's normal for the map to be best-effort with a `notes` entry explaining current uncertainty.

### Refreshing the Kiro tool map and agent schema

Two files travel together:

1. Edit `data/kiro-tool-map.json` — same shape as the claude-code/codex maps. Bump `_meta.lastVerifiedDate` and `_meta.verifiedAgainstVersion`.
2. If kiro's agent JSON schema changed, refresh `data/kiro.agent-v1.schema.json` from upstream. Bump the matching `data/kiro.agent-v1.schema.meta.json` provenance fields.
3. The kiro translator emits strict-schema JSON (`additionalProperties: false`) — any new agent-config field on kiro's side must be added to the translator (`src/core/translators/kiro.ts`) at the same time, or kiro will reject installed agents.
4. `bun run check-drift` includes `runCheckKiroDrift`, which filters known divergences. If a divergence becomes intentional, add it there.
5. `bun test` and open a PR.

## Local development

```bash
bun install
bun test           # 3000+ tests across 300+ files
bun run typecheck
bun run lint
```

## Release workflow

Tags + CHANGELOG + MIGRATION (if breaking). All maintainer automation is local — there is no CI in the deployment environment.
