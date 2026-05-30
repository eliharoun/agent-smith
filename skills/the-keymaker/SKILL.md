---
name: the-keymaker
description: Use when the user wants to create a new agent skill, capture a repeatable workflow as a skill, edit or improve an existing skill, debug why a skill isn't triggering, validate a SKILL.md, or learn how skills work. Triggers on phrases like "create a skill", "write a SKILL.md", "turn this into a skill", "my skill isn't loading", "validate this skill", or when the user describes a multi-step workflow they want to package for agents. Applies to any framework that supports the Agent Skills format (OpenCode, Claude Code, Codex, Gemini CLI, etc.).
license: MIT
---

# The Keymaker

A meta-skill that forges and unlocks new agent capabilities. The Keymaker guides you through creating, improving, validating, and debugging agent skills — the keys that unlock new possibilities for your agents. The output is a `SKILL.md` file (plus optional supporting files) that conforms to the [Agent Skills](https://agentskills.io) open standard and works across OpenCode, Claude Code, Codex, and any other framework that adopts it.

## Core principle

**A skill is a reference guide for a proven technique, pattern, or tool — not a narrative about how you solved a problem once.** Skills are loaded on demand into an agent's context, so they must be:

- **Discoverable** — a description that triggers reliably
- **Scannable** — clear structure, quick reference tables
- **Bulletproof** — explanations that resist rationalization
- **Validated** — passes `scripts/validate-skill.sh` before shipping

**Iron Law: no skill ships without a failing test first.** You cannot know whether your skill teaches the right thing if you have not first watched an agent fail without it. This applies to new skills *and* edits to existing skills.

## When to use this skill

Trigger when the user says any of:

- "Create a skill for…" / "Turn this workflow into a skill"
- "Improve / edit / fix the X skill"
- "My skill isn't triggering" / "the agent ignores my skill"
- "Validate this skill" / "is this SKILL.md valid?"
- "How do I write a skill?"
- "Package this as a skill"

Also trigger proactively when the user describes a multi-step workflow they keep repeating across sessions or projects — that's a skill waiting to happen.

## The workflow

```
RED      Phase 1 — Capture intent + run baseline (agent without skill)
         Phase 2 — Choose structural approach
GREEN    Phase 3 — Draft SKILL.md (+ optional bundled files)
GATE     Phase 4 — Validate (HARD GATE: validator must pass)
REFACTOR Phase 5 — Sanity-test with realistic prompts; iterate
DEPLOY   Phase 6 — Place in correct directory; smoke test
```

Use TodoWrite (or your agent's todo equivalent) to track each phase. Enter at whichever phase matches the user's current state — not necessarily Phase 1.

---

## Phase 1 — RED: Capture intent and baseline

### 1a. Interview the user

Ask every question below in order. For questions where the conversation already supplied an answer, present that answer as a **suggested default** alongside the question — but require the user's explicit confirmation before moving on. Never silently skip a question because you think you know the answer; silent inference produces skills the user didn't actually agree to. Prefer multiple choice.

1. **Purpose.** What should this skill enable the agent to do? (one or two sentences)
2. **Triggers.** When should it trigger? List user phrases, file types, error symptoms, situations.
3. **Type.** Is this a **discipline** skill (a rule/process), a **technique** (how-to), a **pattern** (mental model), or a **reference** (docs/API)? This determines testing strategy.
4. **Bundled resources.** Will this need scripts, references, or assets, or is a single SKILL.md enough?
5. **Target directory.** Where should it live? Default: `skills/<name>/` in the current repo. Never under `~/.claude/`, `~/.config/opencode/`, or `~/.agents/` — those are install paths.

For workflows the user already demonstrated in conversation, *extract* the candidate steps, tools used, corrections made, and input/output formats — then present them back **per question** as suggested defaults the user explicitly confirms or corrects. Do not collapse multiple questions into a single "here's what I extracted, OK to proceed?" confirmation block; ask each question, surface the extracted answer as the suggested default, and wait for an answer.

### 1b. Run the baseline

**Before writing a single line of the skill**, prove the failure mode exists. Pick 2–3 realistic prompts a user would actually type. Run an agent on them *without* the skill and document verbatim:

- What did the agent do?
- What rationalizations did it use? ("This is just a simple…", "I'll skip this because…")
- Which prompts triggered the worst behavior?

If the agent already does the right thing without your skill, **stop**. You don't need a skill — the model already handles it.

Save baseline notes; you will use them in Phase 3 to target your skill at *specific* observed failures, not hypothetical ones.

---

## Phase 2 — Choose a structural approach

Pick the structure based on Phase 1 answers. Recommend one, confirm with the user.

| Structure | Best for | Layout |
|---|---|---|
| **Single-file** | Skills under ~300 lines of total content | Just `SKILL.md` |
| **SKILL.md + references/** | Total content > ~300 lines, or distinct sub-domains | `SKILL.md` (workflow) + `references/<topic>.md` (detail) |
| **Workflow-based** | Multi-step procedures | `SKILL.md` is a phase sequence; one reference per phase |
| **Task-based** | Tool collections / menu of operations | `SKILL.md` is a task index; one reference per task |
| **Reference-based** | Navigation skills, large knowledge bases | `SKILL.md` is a thin router; references hold the knowledge |

Whichever structure you pick, keep `SKILL.md` under **500 lines** (validator hard limit) and aim for **< 400 lines** (validator warning).

---

## Phase 3 — GREEN: Draft

### 3a. Scaffold

Use the bundled scaffolder to create the directory structure:

```bash
./scripts/scaffold-skill.sh <skill-name>
```

This creates `<target>/<skill-name>/` with `SKILL.md` (from template), `scripts/`, and `references/`. It refuses to write into install paths (`~/.claude/`, `~/.config/opencode/`, `~/.agents/`).

### 3b. Write the frontmatter

```yaml
---
name: skill-name-with-hyphens
description: Use when [specific triggering conditions, symptoms, contexts]
license: MIT
---
```

**Required:** `name`, `description`. Everything else is optional.

**`name` rules** (validator-enforced):
- 1–64 characters
- Lowercase alphanumeric with single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`)
- Must match the directory name exactly

**`description` rules:**
- 1–1024 characters total
- Written in **third person**, starts with "Use when…"
- Describes **WHEN to use**, not **HOW the skill works internally** — descriptions that summarize workflow create a shortcut the agent takes instead of reading the body

**When drafting or revising the description**, read [references/writing-effective-descriptions.md](references/writing-effective-descriptions.md). The four principles + before/after rewrites in that file are the difference between a skill that triggers and one that sits dormant.

**For client-specific frontmatter fields** (`disable-model-invocation`, `allowed-tools`, `paths`, etc.), read [references/frontmatter-reference.md](references/frontmatter-reference.md). It's a 14-field × 4-client matrix — load it when you need anything beyond `name` + `description`.

### 3c. Write the body

Use this skeleton as a starting point; adapt to skill type:

```markdown
# Skill Name

## Overview
What this is, in 1–2 sentences. State the core principle.

## When to use this skill
Bulleted symptoms / triggers (mirrors and expands the description).
"Do NOT use when…" clauses for adjacent-but-different cases.

## Core concepts (optional)
2–5 domain ideas the agent needs before executing. Skip if self-explanatory.

## Workflow / The pattern
The actual technique. Inline code for short examples; link to a file for long ones.

## Quick reference
Table or short bullets for the most common operations. Optimize for scanning.

## Common mistakes
What goes wrong + how to fix it. Pulled directly from baseline observations.

## Gotchas (optional)
Non-obvious facts that defy reasonable assumptions. Often the highest-value section.

## Red flags (for discipline skills)
Thoughts that mean STOP — the agent is rationalizing.
```

### 3d. Writing principles

- **Imperative voice.** "Run the baseline." Not "You should consider running…"
- **Explain WHY, not just WHAT.** Modern LLMs have good theory of mind. A two-sentence rationale beats five `MUST`s.
- **One excellent example beats five mediocre ones.** Don't port to multiple languages. Pick the most relevant language; agents port well on demand.
- **Procedures over declarations.** General approaches the agent can apply, not specific one-off answers.
- **Keywords for discoverability.** Sprinkle the words an agent would search for: error messages, library names, symptoms, synonyms.
- **No narrative storytelling.** "In session 2025-04-30 we discovered…" is wrong. Skills are reference material, not war stories.
- **Cross-reference, don't duplicate.** Link to other skills by name. Never `@`-link or force-load other skills' content — it burns context.
- **Address baseline failures specifically.** For each rationalization observed in Phase 1b, add an explicit counter — not generic discipline.

### 3e. Bundled scripts

Add scripts to `scripts/` only when they pull their weight: deterministic logic the agent would otherwise rewrite each run, validation, safety checks, or token-heavy utilities. **Before writing a script**, read [references/script-guidelines.md](references/script-guidelines.md) for portability rules (no `jq`, cross-platform `sed`, executable bit, etc.) and templates.

Every bundled script **must** be documented in SKILL.md with: what it does, when to use it, parameters, example invocation, and expected output. The validator does not enforce this, but undocumented scripts get ignored by the agent.

---

## Phase 4 — GATE: Validate

This is a **hard gate**. Run the validator against the new skill:

```bash
./scripts/validate-skill.sh <path-to-skill-dir-or-SKILL.md>
```

The validator runs 15 checks across structure, frontmatter, body, supporting files, and safety. Any ❌ blocks progression. Common failures and fixes:

| Error | Fix |
|---|---|
| `name does not match directory` | Rename either the directory or the frontmatter field so they agree |
| `description is N chars; must be 1-1024` | Tighten the description; move details to body |
| `body is N lines; must be ≤ 500` | Extract content into `references/<topic>.md` |
| `referenced script not executable` | `chmod +x scripts/<name>.sh` |
| `referenced file missing` | Create the file or remove the reference |
| `broken markdown link` | Fix the path or remove the link |
| `possible secret detected in body` | Remove the secret; use a placeholder or env var |
| `first body line must be an H1 heading` | Add `# Skill Name` after the closing `---` |

Fix every ❌ and re-run until exit code is 0. Warnings (⚠️) are advisory but worth addressing.

### scripts/validate-skill.sh

Validates a SKILL.md against the Agent Skills spec.

**When to use:** Phase 4 (gate), after every revision in Phase 5, and before commit.

**Usage:** `./scripts/validate-skill.sh <path-to-SKILL.md-or-skill-dir>`

**Output:** line-per-check with ✅/⚠️/❌ icons, summary line at the end. Exit 0 on pass (warnings allowed), 1 on error, 2 on usage failure.

### scripts/scaffold-skill.sh

Creates a new skill directory from the template.

**When to use:** Phase 3a, to create a new skill skeleton.

**Usage:** `./scripts/scaffold-skill.sh [-y] <skill-name> [target-parent-dir]`

**Output:** creates `<target>/<skill-name>/` with `SKILL.md`, `scripts/`, `references/`. Refuses to write under agent install paths.

---

## Phase 5 — REFACTOR: Sanity-test and iterate

### 5a. Generate test prompts

Save 2–3 realistic test prompts to `<skill>/evals.json` using `assets/evals.json.template`. Each prompt should be something a real user would plausibly type, varying in phrasing and explicitness.

### 5b. Run them

**With subagent support:** dispatch one subagent per prompt using the host's subagent mechanism (OpenCode `task` tool, Claude Code subagent system, etc.). The subagent must load the new skill and produce output you can inspect.

**Without subagent support:** run each prompt in the current session and warn the user that isolation is weaker (you have the drafting context in your head). Proceed with qualitative review.

For discipline skills, combine pressures (time + sunk cost + authority + exhaustion) — that's where loopholes hide.

### 5c. Iterate based on feedback

Four guiding principles:

1. **Generalize from feedback.** The skill will be used far more than 3 times. Don't overfit to the test prompts — find the general pattern behind each piece of feedback.
2. **Keep the body lean.** Remove instructions that aren't pulling their weight. Unnecessary prose competes for the agent's attention.
3. **Explain the *why*.** Reframe heavy-handed `MUST` directives into reasoned guidance. LLMs follow well-explained *why*s more reliably than blunt mandates.
4. **Extract reusable scripts.** If multiple test runs caused the agent to write the same helper, bundle it in `scripts/` once.

For each new rationalization the agent finds, add an explicit counter to a "Common rationalizations" table. **Re-run Phase 4 (validate) after every revision.** Loop Phases 5a–5c until either the user is satisfied, feedback is empty, or three iterations go by without meaningful improvement.

---

## Phase 6 — DEPLOY: Place and smoke-test

### 6a. Place the skill

| Platform | Project (per-repo) | Global (per-user) |
|---|---|---|
| OpenCode | `.opencode/skills/<name>/SKILL.md` | `~/.config/opencode/skills/<name>/SKILL.md` |
| Claude Code | `.claude/skills/<name>/SKILL.md` | `~/.claude/skills/<name>/SKILL.md` |
| Codex | `.agents/skills/<name>/SKILL.md` | `~/.agents/skills/<name>/SKILL.md` |

**Cross-platform tip:** OpenCode reads from all three project paths and the matching global paths. Placing your skill under `.claude/skills/` makes it usable by both Claude Code and OpenCode without duplication.

**Always edit in your source repo** and symlink (or copy) into install paths. Never edit `SKILL.md` files inside `~/.claude/` or `~/.config/opencode/` directly — they're consumption locations and may be overwritten by package managers.

### 6b. Smoke-test

Open a fresh agent session. Verify:

1. The skill appears in the agent's available skills list
2. A natural-language prompt matching the description loads the skill
3. The agent follows the skill's instructions

**If the skill doesn't appear:** check `SKILL.md` is uppercase, run the validator, ensure the directory name matches `name`.

**If it appears but doesn't trigger:** the description is wrong. Add the user's actual phrasing as a trigger keyword. Repeat until it triggers reliably. See `references/writing-effective-descriptions.md` for rewriting strategies.

---

## Quick reference

| Task | Action |
|---|---|
| Create a new skill | Run all six phases. Don't skip the baseline. |
| Edit existing skill | Re-run baseline scenarios first to confirm the new behavior is needed. Re-validate after. |
| Skill not triggering | Description problem. Read `references/writing-effective-descriptions.md`. Add user's actual words. |
| Skill triggers too often | Description too broad. Add "Do NOT use when…" or split into two skills. |
| Long reference material | Move to `references/<topic>.md`, link from SKILL.md with a one-line "load when…" hint. |
| Reusable code logic | Put in `scripts/`, document in SKILL.md with usage block. |
| Need cross-client field info | `references/frontmatter-reference.md` |
| Need script portability rules | `references/script-guidelines.md` |
| Validate before committing | `./scripts/validate-skill.sh <path>` |
| Scaffold a fresh skill | `./scripts/scaffold-skill.sh <name>` |

## Common mistakes

| Mistake | Fix |
|---|---|
| Description summarizes workflow | Rewrite as triggers only ("Use when X, Y, Z"). The body teaches the workflow. |
| Skill name has uppercase / underscores | Use lowercase + single hyphens only. The validator enforces this. |
| Directory name ≠ `name` field | Make them identical. The validator enforces this. |
| Frontmatter > 1024 chars | Trim description; move details to body. |
| Multi-language code examples | Pick one language; the agent ports on demand. |
| `MUST` / `NEVER` everywhere with no rationale | Replace with one-sentence explanations of *why*. |
| Skill written without baseline | Delete it. Run baseline. Start over. |
| Edited a skill without re-validating | An edit is a new skill. Re-run validator. |
| Forgot to document a bundled script | Add a script-doc block to SKILL.md. Without it, the agent ignores the script. |
| Editing `~/.claude/skills/<name>/` directly | Edit in source repo. Symlink into install path. |
| Body grew past 400 lines | Extract sections into `references/`. The validator warns at 400, errors at 500. |

## Red flags — STOP and start over

If you catch yourself thinking any of these, you are about to ship a bad skill:

- "I don't need to baseline, the failure is obvious"
- "This is just a small edit, no need to re-validate"
- "The description is fine, the agent will figure it out"
- "I'll add more examples instead of fixing the structure"
- "It works for me, ship it"
- "I know what the agent does without running it"
- "The validator's wrong about this one, I'll skip it"

**All of these mean: run the baseline. Validate. Test. Then ship.**

## When NOT to create a skill

- The behavior is project-specific → put it in `CLAUDE.md` / `AGENTS.md` / `opencode.md` instead
- It's a one-off solution → just do it inline
- It's a mechanical constraint enforceable by a linter or hook → automate it deterministically
- The agent already does the right thing without it (verified by baseline)
- It duplicates an existing skill → improve the existing one

## The bottom line

**Creating skills is TDD applied to documentation.** Same iron law (no skill without a failing test first), same cycle (RED → GREEN → REFACTOR → DEPLOY), same gate (the validator must pass).

If you follow TDD for code, follow it for skills. Same discipline, different artifact — and a real validator standing between drafts and shipping.
