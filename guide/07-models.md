# Models and tier resolution

> How `agent-smith` translates a portable `modelTier` into the right
> per-platform `model:` literal at install time. Read this when you need to
> know what ends up in your installed agent's frontmatter, why a fallback
> model showed up, or how to debug a stale resolution.

## Mental model

A bundle declares one portable tier in its `agent.config.json`:

```json
{
  "modelTier": "balanced"
}
```

`modelTier` accepts semantic names (`high`, `balanced`, `fast`) or their
Claude-era aliases (`opus`, `sonnet`, `haiku`), plus `inherit`. Aliases
normalize to the canonical name at parse time
(`src/core/config-schema.ts`).

| Canonical   | Alias    | Intent                        |
|-------------|----------|-------------------------------|
| `high`      | `opus`   | Frontier reasoning, expensive |
| `balanced`  | `sonnet` | Default workhorse             |
| `fast`      | `haiku`  | Cheap and quick               |
| `inherit`   | —        | Use platform default          |

Existing bundles with `modelTier: "opus"` keep working — `opus` is an
alias for `high`. New bundles should prefer the semantic names.

At install time the orchestrator runs a per-target resolver
(`src/io/orchestrator.ts`) and hands the result to each translator as
`resolvedModels[target]`. Every translator decides for itself whether to
emit a `model:` line, and what to write there:

| Target      | What it does with the resolved literal                                  |
|-------------|-------------------------------------------------------------------------|
| OpenCode    | Writes the literal verbatim into frontmatter `model:`.                  |
| Claude Code | Normalizes `high`→`opus`, `balanced`→`sonnet`, `fast`→`haiku` and writes that into frontmatter `model:`. |
| Codex       | Drops it. No `model:` field is emitted. No warning is printed.          |
| Kiro        | Resolves to a static literal (`high`→`claude-opus-4.6`, `balanced`→`claude-sonnet-4.6`, `fast`→`claude-haiku-4.5`); writes it into the JSON document's `modelId` field. |

The orchestrator never writes back into the bundle — `agent.config.json`
is the single source of truth, and resolution is a per-install
computation.

There is no model fallback chain across tiers. Each tier resolves
independently; if resolution fails entirely the resolver throws a
`model-resolution-failed` error with actionable remediation steps.

## Per-platform resolution

The four target resolvers live in `src/core/model-resolution/` and are
wired by `RESOLVERS` in `src/core/model-resolution/index.ts`.

### OpenCode

`resolveOpenCodeModel` (`src/core/model-resolution/opencode.ts`)
implements a layered resolution algorithm:

1. **Explicit override.** If `agent.config.json` has a `model` field, it
   is returned verbatim (no validation, no live check). This is how you
   pin a specific model id when you know exactly what you want.
2. **`inherit`.** If `modelTier === "inherit"`, the resolver returns
   `undefined`. The OpenCode translator then emits no `model:` line at
   all, and OpenCode's runtime falls back to whatever default the user
   has configured.
3. **Per-tier env override.** If `SMITH_TIER_<TIER>` is set (e.g.
   `SMITH_TIER_HIGH=openai/gpt-5`), that value is returned verbatim. A
   warning is emitted if the literal is not in the live model list, but
   it is still used — operator's choice.
4. **Provider preference walk.** The resolver determines your provider
   preference order (see [Provider preferences](#provider-preferences)),
   then for each preferred provider, checks the live `opencode models`
   output against the provider table's tier pattern. The first provider
   with a matching model wins; `pickHighestVersion` selects the latest
   when multiple versions match.
5. **Curated fallback walk.** If no live match was found, the resolver
   walks the same preference order and checks whether any provider's
   curated literal exists in the live list. If found, it is used with a
   warning.
6. **Fail loudly.** If nothing resolves, the resolver throws
   `SmithError("model-resolution-failed")` with the tier, preference
   order, authenticated providers, and three actionable fix paths. See
   [Troubleshooting model-resolution-failed](#troubleshooting-model-resolution-failed).

The resolved literal is written verbatim into frontmatter `model:` by
the OpenCode translator (`src/core/translators/opencode.ts`).

The literal that ends up in the file is **frozen at install time**.
A later `opencode` release adding a newer model in the same tier does
not auto-propagate; you have to re-run `smith agent install <name>` (or
`smith agent install-all`) to pick it up.

### Claude Code

`resolveClaudeCodeModel`
(`src/core/model-resolution/claude-code.ts`) implements a layered
resolution algorithm analogous to OpenCode's:

1. **`inherit`.** If `modelTier === "inherit"`, returns `undefined` (no
   `model:` line).
2. **Per-bundle `model` override.** If `agent.config.json` has a `model`
   field, it is returned verbatim.
3. **Per-tier env override.** If `SMITH_CLAUDE_TIER_<TIER>` is set (e.g.
   `SMITH_CLAUDE_TIER_HIGH=opus`), that value is returned verbatim.
4. **Auth detection.** `detectClaudeCodeAuth()` probes the local Claude
   Code CLI:
   - **CLI not installed** → throws `PlatformUnavailableError` (the
     orchestrator catches this and skips the target).
   - **Unauthenticated** → returns `undefined` with a warning suggesting
     `claude auth login` or the env override.
   - **Authenticated with `availableModels`** → prefers the legacy tier
     name (`opus`/`sonnet`/`haiku`); if absent, substitutes the closest
     available family with a warning.
   - **Authenticated without `availableModels`** → returns the legacy
     tier name. Claude Code's runtime resolves it natively.

The Claude Code translator writes the resolved string verbatim into
frontmatter `model:`.

### Codex

`resolveCodexModel` (`src/core/model-resolution/codex.ts`) implements a
layered resolution algorithm:

1. **`inherit`.** If `modelTier === "inherit"`, returns `undefined`.
2. **Per-bundle `model` override.** If `agent.config.json` has a `model`
   field and the bundle targets codex, it is returned verbatim.
3. **Per-tier env override.** If `SMITH_CODEX_TIER_<TIER>` is set (e.g.
   `SMITH_CODEX_TIER_HIGH=gpt-5-codex`), that value is returned verbatim.
4. **Auth detection.** `detectCodexAuth()` probes the local Codex CLI:
   - **CLI not installed** → throws `PlatformUnavailableError` (the
     orchestrator catches this and skips the target).
   - **Unauthenticated** → returns `undefined` with a warning suggesting
     `codex login`, `OPENAI_API_KEY`, or the env override.
   - **Authenticated** → returns the static tier literal.

Static tier table:

| `modelTier` | Resolved literal |
|---|---|
| `high` | `gpt-5-codex` |
| `balanced` | `gpt-5` |
| `fast` | `gpt-5-mini` |

The resolver returns a real model literal. The Codex **translator**
drops the field — no `model:` line is emitted in the rendered Codex
frontmatter. This separation means the resolver can still be tested and
inspected (e.g. by `smith doctor`'s tier preview) even though the
translator suppresses the output.

### Kiro

`resolveKiroModel` (`src/core/model-resolution/kiro.ts`) implements a
layered resolution algorithm:

1. **`inherit`.** If `modelTier === "inherit"`, returns `undefined` (no
   `modelId` field emitted; Kiro uses its workspace default).
2. **Per-bundle `model` override.** If `agent.config.json` has a `model`
   field and the bundle targets kiro, it is returned verbatim.
3. **Per-tier env override.** If `SMITH_KIRO_TIER_<TIER>` is set (e.g.
   `SMITH_KIRO_TIER_HIGH=claude-opus-4.6`), that value is returned
   verbatim.
4. **Auth detection.** `detectKiroAuth()` probes the local kiro-cli:
   - **CLI not installed** → throws `PlatformUnavailableError` (the
     orchestrator catches this and skips the target).
   - **Unauthenticated** → returns `undefined` with a warning suggesting
     `kiro-cli login` or the env override.
   - **Authenticated** → returns the static tier literal.

Static tier table:

| `modelTier` | Resolved `modelId` |
|---|---|
| `high` (alias `opus`) | `claude-opus-4.6` |
| `balanced` (alias `sonnet`) | `claude-sonnet-4.6` |
| `fast` (alias `haiku`) | `claude-haiku-4.5` |

The Kiro translator writes the resolved literal into the JSON document's `modelId` field.

## What ends up on disk

Concrete example — a bundle with `modelTier: "high"` and four targets,
on a machine where the user is authenticated against `anthropic`:

```yaml
# ~/.config/opencode/agents/<name>.md
---
description: ...
mode: primary
model: anthropic/claude-opus-4-7-20260101
permission: { ... }
---
```

```yaml
# ~/.claude/agents/<name>.md
---
name: <name>
description: ...
model: opus
allowed-tools: ...
---
```

```yaml
# ~/.agents/skills/<name>/<name>.md
---
name: <name>
description: ...
allowed_tools: [...]
---
```

```json
// ~/.kiro/agents/<name>.json
{
  "name": "<name>",
  "description": "...",
  "modelId": "claude-opus-4.6",
  "systemPrompt": "...",
  "tools": [...],
  "allowedTools": [...],
  "resources": [...]
}
```

The same canonical bundle, four different model treatments. Re-running
`smith agent install` overwrites these files; the OpenCode literal is the
only one that depends on which models your local CLI reports and which
provider you authenticate against.

## Per-agent override

`agent.config.json` accepts an optional `model` field
(`src/core/types.ts`). It exists for one reason: pinning a specific
OpenCode model id when tier-based resolution would pick the wrong thing.

```json
{
  "modelTier": "high",
  "model": "anthropic/claude-opus-4-7-20260101"
}
```

Behavior:

- **OpenCode:** the `model` value is returned verbatim by step 1 of
  `resolveOpenCodeModel`. No live query happens; no warning is emitted;
  no provider preference walk occurs.
- **Claude Code:** the `model` value is returned verbatim by step 2 of
  `resolveClaudeCodeModel`. No auth detection occurs.
- **Codex:** the `model` value is returned verbatim by step 2 of
  `resolveCodexModel` (when the bundle targets codex). The Codex
  translator still drops the field from rendered output.
- **Kiro:** the `model` value is returned verbatim by step 2 of
  `resolveKiroModel` (when the bundle targets kiro).

If a bundle sets `model` but does not list any platform in `targets`
that would use it, the validator emits an info-note — the field has no
effect on output for platforms that aren't targeted.

## Provider preferences

The resolver needs to know which providers you have access to and in
what order to try them. Three sources, highest precedence first:

### 1. `SMITH_MODEL_PROVIDERS` environment variable

```bash
export SMITH_MODEL_PROVIDERS=anthropic,openai
```

Comma-separated list of provider IDs. Can also be set in
`~/.config/agent-smith/.env` via `smith config set`.

### 2. Auto-detection from `~/.local/share/opencode/auth.json`

If no explicit preference is set, the resolver reads OpenCode's auth
file to discover which providers you've authenticated against
(`src/io/opencode-auth.ts`). The detected providers are sorted by
OpenCode's documented precedence.

### 3. OpenCode's default precedence

When multiple providers are detected, they are ordered per OpenCode's
documented priority (`src/core/model-resolution/provider-table.ts`):

1. `github-copilot`
2. `anthropic`
3. `openai`
4. `openrouter`
5. `amazon-bedrock`
6. `google-vertex-ai`

If no providers are detected at all (no auth.json, no env var), the
resolver still attempts the curated fallback walk and ultimately fails
loudly if nothing resolves.

## Tier overrides

For power-user control, set a per-tier environment variable to bypass
the entire provider preference walk for that tier:

```bash
# OpenCode-specific (used by resolveOpenCodeModel)
export SMITH_TIER_HIGH=openai/gpt-5
export SMITH_TIER_BALANCED=anthropic/claude-sonnet-4-6-20260101
export SMITH_TIER_FAST=anthropic/claude-haiku-4-5-20260101

# Claude Code-specific (used by resolveClaudeCodeModel)
export SMITH_CLAUDE_TIER_HIGH=opus
export SMITH_CLAUDE_TIER_BALANCED=sonnet
export SMITH_CLAUDE_TIER_FAST=haiku

# Codex-specific (used by resolveCodexModel)
export SMITH_CODEX_TIER_HIGH=gpt-5-codex
export SMITH_CODEX_TIER_BALANCED=gpt-5
export SMITH_CODEX_TIER_FAST=gpt-5-mini

# Kiro-specific (used by resolveKiroModel)
export SMITH_KIRO_TIER_HIGH=claude-opus-4.6
export SMITH_KIRO_TIER_BALANCED=claude-sonnet-4.6
export SMITH_KIRO_TIER_FAST=claude-haiku-4.5
```

The OpenCode overrides can also be set in `~/.config/agent-smith/.env`:

```bash
smith config set model.tier.high openai/gpt-5
```

When a tier override is set:
- The value is used verbatim as the resolved literal.
- A warning is emitted if the literal is not in the live `opencode
  models` output, but it is still written — operator's choice.
- The provider preference walk is skipped entirely for that tier.

## `inherit`

Setting `modelTier: "inherit"` returns `undefined` from both the
OpenCode and Claude Code resolvers. Neither translator writes a `model:`
line — the platform's runtime falls back to whatever default the user
has configured for that platform (the OpenCode default model, the
Claude Code default model). Codex behavior is unchanged (it never
writes `model:` regardless of tier).

Use `inherit` when you want the agent to ride along with whatever the
user has chosen as their global default rather than pinning a tier.

## Provider table and curated fallbacks

The provider table (`src/core/model-resolution/provider-table.ts`)
defines a 2D structure: for each tier × provider combination, it stores
a regex pattern (for live matching) and a curated literal (for fallback).

Six providers are supported:

| Provider | Example resolved literal (tier `high`) |
|---|---|
| `anthropic` | `anthropic/claude-opus-4-7-20260101` |
| `github-copilot` | `github-copilot/claude-opus-4.7` |
| `openrouter` | `openrouter/anthropic/claude-opus-4.7` |
| `amazon-bedrock` | `amazon-bedrock/us.anthropic.claude-opus-4-7-v1:0` |
| `google-vertex-ai` | `google-vertex-ai/claude-opus-4-7@20260101` |
| `openai` | `openai/gpt-5` |

The table is pinned per release (`PROVIDER_TABLE_V1_0_0_RC_5`). To see
the full table with all tiers and patterns, inspect the source at
`src/core/model-resolution/provider-table.ts`.

The curated literal for a provider is used when:
- The live model list is unavailable (opencode CLI not on PATH or
  errored), OR
- The live list contains the curated literal but no version-sorted match
  was found via the pattern.

Unlike the old single-provider fallback, the resolver walks your
preference order and picks the first provider whose curated literal
exists in the live list. If no curated literal is found either, the
resolver fails loudly.

## Configuring smith

The `smith config` command manages model-resolution settings stored in
`~/.config/agent-smith/.env`:

```bash
# View effective configuration (detected providers, preference order, overrides)
smith config get

# Get a specific key
smith config get model.providers
smith config get model.tier.high

# Set provider preference order
smith config set model.providers anthropic,openai

# Set a per-tier override
smith config set model.tier.high anthropic/claude-opus-4-7-20260101
smith config set model.tier.balanced openai/gpt-5-mini

# Remove a setting (revert to auto-detection)
smith config unset model.providers
smith config unset model.tier.high
```

Valid keys:

| Key | Env var | Effect |
|---|---|---|
| `model.providers` | `SMITH_MODEL_PROVIDERS` | Provider preference order |
| `model.tier.high` | `SMITH_TIER_HIGH` | Override for `high` tier (OpenCode) |
| `model.tier.balanced` | `SMITH_TIER_BALANCED` | Override for `balanced` tier (OpenCode) |
| `model.tier.fast` | `SMITH_TIER_FAST` | Override for `fast` tier (OpenCode) |

Per-platform tier overrides (`SMITH_CLAUDE_TIER_*`, `SMITH_CODEX_TIER_*`,
`SMITH_KIRO_TIER_*`) are read from the process environment only — they
are not managed by `smith config`.

`smith config get` (no key) prints a full overview:

```
Model resolution
  Detected providers:
    anthropic, github-copilot
  Preference order:
    1. anthropic  (from .env)
    2. github-copilot
  Per-tier overrides:
    model.tier.high           (unset)
    model.tier.balanced       (unset)
    model.tier.fast           (unset)
```

The GUI exposes the same settings at `/system/model-config` — a drag-to-
reorder provider list, per-tier override fields, and a live resolution
preview.

## Opt-out: `AGENT_SMITH_DISABLE_LIVE_RESOLUTION`

Set `AGENT_SMITH_DISABLE_LIVE_RESOLUTION=1` in the environment to skip
the `opencode models` spawn entirely and force the curated-fallback
path for every OpenCode resolution.

```bash
AGENT_SMITH_DISABLE_LIVE_RESOLUTION=1 smith agent install my-agent
AGENT_SMITH_DISABLE_LIVE_RESOLUTION=1 smith doctor
```

When set, the live model list is treated as unavailable, which triggers
the curated fallback walk using your detected provider's curated literal
(not a hardcoded provider — the resolver still respects your preference
order).

Use this when:

- You are on a machine without `opencode` installed and don't want the
  warning noise, or
- You want byte-deterministic installs across machines (curated
  fallbacks are pinned per release).

Note that the env var only affects OpenCode resolution. Claude Code,
Codex, and Kiro resolvers don't query a live model list, though they do
perform auth detection (CLI presence and login status).

## Doctor's model-resolution check

`smith doctor` includes a `model-resolution` section **when `opencode`
is on `PATH`**. On a host without `opencode`, the section is omitted
entirely. See [10-doctor.md](./10-doctor.md#platform-auto-detection)
for the platform-detection rules.

When the section runs, it audits:

1. **Detected providers** — which providers were found in
   `~/.local/share/opencode/auth.json` or inferred from the live model
   list.
2. **Preference order** — the effective provider order with source
   annotation (env, .env file, or auto-detected default).
3. **Tier resolution preview** — for each tier (`high`, `balanced`,
   `fast`), what literal would be resolved right now.
4. **Curated-fallback freshness:** for each tier × preferred provider,
   is the curated fallback literal present in the live model list?
5. **Installed-agent staleness:** for each installed agent file with a
   `model:` line, is that literal still in the live list?

Stale agents or drifted curated fallbacks contribute to doctor's exit
code `1`. The model-resolution section itself only contributes warnings,
not errors.

The summary line reads `Model resolution: <N> installed agents verified`
on a clean run, or `Model resolution: <N> stale agents, <M> fallbacks
drifted` when something is off.

### When the live model list query fails

If `opencode models` exits non-zero or throws, `liveModelCount` is
`null` and every curated fallback is reported with `inLiveList: false`.
The section status is `warn`, the summary reads `Model resolution: live
model list unavailable`.

Two ways to suppress that signal:

```bash
smith doctor --skip-model-resolution                  # skip the check entirely
AGENT_SMITH_DISABLE_LIVE_RESOLUTION=1 smith doctor    # forces fallback path
```

## Troubleshooting model-resolution-failed

When the resolver cannot find any model for a tier, it throws
`model-resolution-failed` with an actionable error message:

```
✗ model-resolution-failed
  smith couldn't resolve modelTier 'high' for agent 'my-agent' (target: opencode).
  Authenticated providers: anthropic, github-copilot
  Preference order: anthropic, github-copilot
  No model in your authenticated providers matched any tier 'high' pattern.
```

Three fix paths:

### 1. Authenticate a provider

```bash
opencode auth login <provider>
```

Adds the provider to your auth.json so the resolver can find models for
it.

### 2. Set a per-tier override

```bash
smith config set model.tier.high anthropic/claude-opus-4-7-20260101
# or directly:
echo 'SMITH_TIER_HIGH=anthropic/claude-opus-4-7-20260101' >> ~/.config/agent-smith/.env
```

Bypasses the provider walk entirely for that tier.

### 3. Pin per-bundle

Edit `~/.config/agent-smith/agents/<name>/agent.config.json`:

```json
{
  "model": "anthropic/claude-opus-4-7-20260101"
}
```

The `model` field is returned verbatim — no resolution occurs.

## Caveats and gotchas

- **Failure caching is per-process for successes only.**
  `getOpenCodeModels` memoizes a successful query for the lifetime of
  the process. Failures are NOT cached — each call re-spawns.
- **No 24h disk cache for the model list.** Doctor's 24h disk cache is
  for the OpenCode JSON schema, not the model list. Each `smith doctor`
  invocation re-runs `opencode models` from scratch.
- **No model-resolution result on disk.** The resolver writes nothing
  back to the bundle. The only persistent record of which model was
  picked is the `model:` line in the installed `.md` file.
- **Codex translator silently drops the model.** The resolver produces a
  real literal, but the translator does not emit it in rendered output.
- **Unknown tier names are rejected at config-parse time.** The
  validator schema constrains `modelTier` to the semantic names, their
  aliases, and `inherit`. A typo like `"sonet"` produces a validation
  error during `smith agent validate`, not a resolution-time fallback.
- **Missing `modelTier` is also a validation error.** The field is
  required on `CanonicalConfig`. `smith agent init` defaults it to
  `"balanced"`.
- **Provider table is pinned per release.** To pick up new providers or
  model naming changes, run `smith update`.
- **Claude Code aliases are automatic.** If your bundle uses
  `modelTier: "high"`, the Claude Code translator writes `model: opus`.
  You don't need to set anything Claude-specific.

## Where this surfaces

| Command            | Behavior                                                            |
|--------------------|---------------------------------------------------------------------|
| `smith agent install`    | Runs the resolver per target; writes the literal into the rendered file. Warnings appear in the install summary. |
| `smith agent install-all`| Same per agent, in registry-precedence order.                       |
| `smith agent init` | Accepts `--model-tier <tier>` (semantic names + aliases); writes to the new bundle's `agent.config.json`. Defaults to `balanced`. |
| `smith config get` | Shows detected providers, preference order, per-tier overrides, and resolution preview. |
| `smith doctor`     | Runs the model-resolution check (unless `--skip-model-resolution`). Reports provider detection, preference order, tier preview, curated-fallback drift, and stale agents. |
| `smith agent validate`   | Rejects unknown tier values; emits an info-note when `model` is set without `opencode` in `targets`. |

There is no `--model` flag on `smith agent install`, no per-install tier
override, and no way to force a specific resolved literal at install
time without editing the bundle's `model` field or setting a
`SMITH_TIER_*` env var.

## What `agent-smith` does NOT do

- **No model fallback chain across tiers.** If `high` resolution fails
  it does not "downgrade" to `balanced`.
- **No write-back to bundle config.** The resolver never edits
  `agent.config.json` to record what it picked.
- **No Codex model in rendered output.** The Codex translator drops the
  resolved model — no `model:` line appears in Codex frontmatter, even
  though the resolver produces a real literal internally.
- **No live Claude Code or Kiro model query.** Those resolvers consult
  auth state (CLI presence and login status) but do not query a live
  model list — they resolve to static tier names.
- **No persistent model-resolution cache.** Each install re-spawns
  `opencode models`. Within a single CLI invocation the result is
  memoized; across invocations it is not.

## See also

- [02-bundle-anatomy.md](./02-bundle-anatomy.md) — the
  `agent.config.json` schema (where `modelTier` and `model` live).
- [03-installing-and-rendering.md](./03-installing-and-rendering.md) —
  the full install pipeline; model resolution is step 5.
- [06-permissions-and-platforms.md](./06-permissions-and-platforms.md#per-platform-translator-behavior) —
  per-platform translator comparison table (model row).
- [10-doctor.md](./10-doctor.md) — full doctor exit-code matrix and the
  model-resolution section's contribution to it.
- [14-cli-reference.md](./14-cli-reference.md#smith-agent-init-name) —
  `--model-tier` flag on `smith agent init`.
- `src/core/model-resolution/` — the resolver, provider table, and
  preference logic.
- `src/core/model-resolution/provider-table.ts` — the full 6-provider ×
  3-tier table with patterns and curated literals.
- `src/core/translators/` — the three translators and how each handles
  the resolved literal.
