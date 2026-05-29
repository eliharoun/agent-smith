# Frontmatter reference — cross-client compatibility

This reference maps every known SKILL.md frontmatter field across the agent-skill clients we target: the open [Agent Skills spec](https://agentskills.io/specification), OpenCode, Claude Code, and Codex (`.agents/`). Load this when you need to decide which optional fields to use, or when a field you see in another skill is unfamiliar.

## Cross-client field matrix

| Field | Open Spec | OpenCode | Claude Code | Codex | If unknown |
|---|---|---|---|---|---|
| `name` | required | required | optional (falls back to dir) | required | — |
| `description` | required | required | recommended | required | — |
| `license` | optional | optional | ignored | optional | silently ignored |
| `compatibility` | optional (≤500 chars) | optional | ignored | optional | silently ignored |
| `metadata` | optional (k/v) | optional (string→string) | ignored | optional | silently ignored |
| `allowed-tools` | experimental | ignored | optional | ignored | silently ignored |
| `disable-model-invocation` | — | — | optional | — | silently ignored |
| `user-invocable` | — | — | optional | — | silently ignored |
| `when_to_use` | — | — | optional | — | silently ignored |
| `paths` | — | — | optional (glob) | — | silently ignored |
| `model` | — | — | optional | — | silently ignored |
| `effort` | — | — | optional | — | silently ignored |
| `arguments` | — | — | optional | — | silently ignored |
| `argument-hint` | — | — | optional | — | silently ignored |

**Key property:** unknown fields are silently ignored across all four clients. This means you can mix in client-specific fields without breaking portability — they're inert wherever they aren't recognized.

## The portable default

For maximum portability across OpenCode, Claude Code, and Codex, use only the two universally-required fields:

```yaml
---
name: my-skill
description: Use when [specific triggers]. Triggers on phrases like "X" or "Y", or when the user encounters Z.
---
```

Add `license` and `compatibility` if the skill has redistribution or environmental constraints — these are recognized by the open spec, OpenCode, and Codex (and harmlessly ignored by Claude Code).

## When to use Claude Code extensions

Claude Code has the richest extension surface. Use these only when you specifically want Claude Code's behavior — they're inert in OpenCode and Codex.

### `disable-model-invocation: true`

Prevents the model from loading the skill automatically. The user must invoke it explicitly (`/my-skill`). Use when the skill has side effects you don't want triggered by the model's judgment:

- `/commit` — committing code
- `/deploy` — deploying to an environment
- `/send-email` — sending a message

Other clients silently ignore this field, so on OpenCode the skill can still auto-trigger from its description. If you need that behavior everywhere, omit this field and instead rely on a tightly scoped description that only matches explicit user intent (e.g., "Use **only** when the user explicitly asks to deploy").

### `allowed-tools`

Pre-approves tools the skill can use without prompting for permission. Claude Code supports a fine-grained syntax: `Bash(git:*) Bash(jq:*) Read`. Use when the skill runs the same few commands every time and you want to skip permission friction for the user.

### `when_to_use`

A longer explanation of when the skill should trigger. Appended to `description` in Claude Code's skill listing. Counts toward the 1536-char cap Claude Code imposes across the combined text.

**Recommendation:** prefer a single rich `description` over splitting across `description` + `when_to_use`. The combined value transfers to other clients that don't recognize `when_to_use`.

### `paths`

Restricts automatic activation to files matching a glob pattern. Used when a skill only makes sense for specific file types:

```yaml
paths:
  - "**/*.tsx"
  - "**/*.jsx"
```

Claude Code only. Other clients ignore it and the skill can match any context.

### `model` / `effort`

Override the active model or reasoning effort while the skill is active. Useful for skills that need extra reasoning depth (`effort: high`) or a specific model. Claude Code only.

### `arguments` / `argument-hint`

Define named positional arguments for `$name` substitution in the skill body, plus an autocomplete hint. Claude Code only.

## When to use `compatibility` (open spec, OpenCode, Codex)

The `compatibility` field (≤500 chars) documents environment requirements:

```yaml
compatibility: Requires python3, pyyaml. Tested on macOS and Linux.
```

Claude Code ignores this; OpenCode and Codex surface it in skill metadata.

## When to use `metadata` (open spec, OpenCode, Codex)

A string-to-string map for additional data the spec doesn't define:

```yaml
metadata:
  audience: maintainers
  workflow: github
  owner: team-foo
```

Clients that recognize the field can use these for filtering or display. Useful for organizational taxonomy that isn't part of the skill's behavior.

## OpenCode-specific notes

OpenCode reads skills from **all three** project locations:

- `.opencode/skills/<name>/SKILL.md`
- `.claude/skills/<name>/SKILL.md`
- `.agents/skills/<name>/SKILL.md`

…and the matching global paths (`~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`). Placing a skill under `.claude/skills/` makes it usable by both OpenCode and Claude Code without duplication — that's the recommended portable path.

OpenCode also enforces the `name` regex strictly: `^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 chars, must match the directory name. The validator in `the-keymaker/scripts/validate-skill.sh` enforces the same rules.

## Safety-additive principle

The "unknown fields are ignored" rule has two practical consequences:

1. **Adding extensions doesn't break portability.** A `disable-model-invocation: true` skill works in Claude Code as expected and works in OpenCode as a normal auto-triggered skill.
2. **Never rely on a field absent across your target set to convey meaning.** If your skill only behaves correctly in Claude Code because of `disable-model-invocation`, document that constraint in the body — don't assume another client will enforce it.

## Validation caveats

The `validate-skill.sh` script in this skill checks the spec-required fields (`name`, `description`) strictly, validates the `name` regex and 1024-char `description` cap, and ignores all other fields. It will not catch a typo in `disabled-model-invocation` (wrong field name) because the spec permits arbitrary extra fields. Proofread client-specific fields manually or rely on the target client's own validator.
