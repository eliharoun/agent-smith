# Persona Files Rubric

Reference for drafting IDENTITY, EXPERTISE, SOUL, and USER content for an agent-smith bundle. Loaded by the-architect skill during Phase 3 (persona drafting).

## Per-file role

| File | Role | Length budget (lines) | Voice |
|---|---|---|---|
| **IDENTITY.md** | Who the agent IS — name, background, stance toward the user | 15-25 | Second person ("You are…") |
| **EXPERTISE.md** | What the agent KNOWS and DOES — capabilities, distinctions, failure modes flagged | 40-100 | Second person ("You spot…", "You distinguish…") |
| **SOUL.md** | The agent's VOICE and STYLE — how it speaks, what it never says | 15-30 | Second person ("You speak tersely", "You never apologize") |
| **USER.md** | "About me" — facts about the human user that all this user's agents should know | 20-40 | Second person ("You note…") — *but never edit per-agent; for personal catalogs it's a symlink to canonical, for `registered` catalogs it's a stub file* |

## Why second person

The validator hard-checks for `\bYou\b` and warns on `\bI am\b`. Second-person framing ("You are a senior reviewer") puts the model in role. First-person ("I am a senior reviewer") creates a confused narrator-vs-actor split that produces hedged, third-wall-broken output. Stick to "You" for every file.

**Examples of agent speech are themselves checked.** If you want to illustrate something the agent might say, paraphrase in third person ("You acknowledge uncertainty plainly") rather than quoting first-person ("You say 'I'm not sure whether…'"). The validator scans the whole file; it doesn't know your `I'm` is inside a quoted example.

## Length budgets — why each range exists

**Important:** the validator counts **non-blank lines** (sentences/bullets that occupy their own line), not visual paragraphs or wrapped prose. Three flowing paragraphs that look 15 lines long in a wrapped editor may only be 3 non-blank lines to the validator. Break sentences onto their own lines or use bullets so the count matches the budget.



- **IDENTITY 15-25:** A single tight paragraph or two. Identity should be evocative, not exhaustive. Under 15 → too thin to anchor the model's role. Over 25 → starts dictating capabilities (that's EXPERTISE's job).

- **EXPERTISE 40-100:** Bullet list or short subsections. This is the largest file because it carries the agent's entire workload. Under 40 → vague capabilities. Over 100 → bloat; the model's attention budget thins out.

- **SOUL 15-30:** Three to seven voice rules. Short. Under 15 → no consistent voice. Over 30 → contradictory rules; the model gets confused about what to prioritize.

- **USER 20-40:** Facts about the human user. Set once via `smith init-user`; shared across all agents.

The validator warns (does not error) on out-of-budget files. Treat warnings as gentle nudges; address before install if reasonable.

## Recency-weighted assembly

The assembled body order is: IDENTITY → EXPERTISE → SOUL → USER → (Default Skills section if any). The model attends most strongly to the most recent context. USER goes last because the user's "About me" is the most situational ("for THIS person") information; the model should keep it in working memory.

This is why per-agent USER content is the wrong move: every agent the user creates ends up with a different "About me," and the model loses the most-recently-attended-to anchor.

## Drafting heuristics

- **One example per claim.** "You spot N+1 queries" is fine. "You spot N+1 queries, missing indexes, slow joins, sequential scans, and inappropriate eager loading" is bloat. Pick the most representative example; the model generalizes.

- **Negative space matters.** "You never apologize" is more memorable than "You speak directly." The negation creates a sharper boundary.

- **Framing-vs-mechanics distinction.** IDENTITY frames the role ("You are a senior reviewer who has seen every flavor of bad code"). EXPERTISE describes mechanics ("You distinguish between cosmetic style issues and substantive correctness bugs"). Don't mix them.

- **No cross-file duplication.** If a fact about the agent appears in IDENTITY, don't repeat it in EXPERTISE or SOUL. Each fact lives in exactly one file.

- **Concrete techniques over generic adjectives.** "You write thorough code reviews" is generic. "You name the line, the rule, and the suggested fix in every comment" is concrete. The model executes concrete instructions; it ignores generic ones.

## Brainstorming question templates per file

### IDENTITY (ask 1-3)

1. "In one sentence, who is this agent? (e.g. 'A senior code reviewer who has seen every flavor of bad code.')"
2. "What's their background or training, if any? (Optional — adds depth.)"
3. "What's their stance toward the user? (a) peer collaborator, (b) mentor / teacher, (c) specialist on call, (d) sparring partner."

### EXPERTISE (ask 2-3)

1. "What are 5-10 things this agent should be unmistakably good at? (Bullet list.)"
2. "For each capability, name one concrete technique, distinction, or failure mode they would flag."
3. "Are there things this agent explicitly should NOT do? (e.g. 'never refactor production code', 'never speculate about untested behavior')"

### SOUL (ask 2-3)

1. "Pick three voice rules. Examples: 'concise over thorough', 'direct over diplomatic', 'one example per claim', 'no preamble', 'admits uncertainty out loud'."
2. "Anything they specifically don't say? (e.g. 'never starts with \"great question\"', 'never uses emoji', 'never says sorry')"
3. "Is there a tone you want them to avoid? (e.g. cheerleading, bureaucratic, academic)"

### USER

Skip. USER.md is canonical and shared across agents (in personal catalogs; `registered` catalogs ship a stub). If the user wants to update their canonical "About me," direct them to `smith init-user`.

## Anti-patterns (with before/after)

### Anti-pattern 1 — Personality essay instead of voice rules

**SOUL.md, before:**

```
You are a passionate code reviewer who deeply cares about quality. You believe that great software comes from attention to detail and a willingness to question assumptions. You bring warmth and rigor in equal measure to every review.
```

**SOUL.md, after:**

```
You are direct and concise. You name the line, the rule, the suggested fix.
You never start with praise.
You admit uncertainty out loud when a judgment is ambiguous.
You never apologize for finding issues.
```

The "before" is feel-good marketing copy; the model can't act on it. The "after" is a checklist of behaviors the model can imitate.

### Anti-pattern 2 — Resume bullet list instead of second-person framing

**EXPERTISE.md, before:**

```
- TypeScript expert
- Familiar with React patterns
- Knows N+1 query problems
- Experienced with PostgreSQL
```

**EXPERTISE.md, after:**

```
You read TypeScript fluently. You distinguish type-narrowing bugs from genuine
type errors. You spot N+1 queries by looking for `await` inside `.map()`,
`.forEach()`, or any loop. You flag missing error handling — every external
call should have explicit failure paths. You suggest the smallest fix that
addresses the rule, not a wholesale rewrite.
```

The "before" is a resume; the model treats it as background fluff. The "after" describes specific things "you" do — actionable.

### Anti-pattern 3 — Capability dump instead of distinctions and methods

**EXPERTISE.md, before:**

```
You know about performance, security, code quality, accessibility, internationalization, testing, documentation, deployment, monitoring, error handling, and database design.
```

**EXPERTISE.md, after:**

```
You focus on three things and do them well:
1. **Correctness bugs.** Off-by-one errors, missing null checks, race conditions
   in async code. You name the failing input.
2. **Performance regressions.** N+1 queries (`await` in loops), unbounded
   array growth, leaked event listeners. You estimate the worst case.
3. **Maintainability.** Functions over 50 lines, modules with unclear
   boundaries, names that don't match behavior.

You stay out of: cosmetic style (lint handles it), refactoring suggestions
(scope creep), and architectural rewrites (that's a separate request).
```

The "before" tries to cover everything; the model gets diluted. The "after" picks three things and gives the model a method for each.

### Anti-pattern 4 — First-person leak

**IDENTITY.md, before:**

```
I am a senior code reviewer with 15 years of experience. I focus on TypeScript
and PostgreSQL. I prefer to find issues with concrete examples.
```

**IDENTITY.md, after:**

```
You are a senior code reviewer with the perspective that comes from 15 years of
seeing the same patterns recur. Your specialty is TypeScript and PostgreSQL.
You always pair a flagged issue with a concrete example — the failing input,
the slow query, the leaking handle.
```

Mechanical: replace `I am` → `You are`, `I focus on` → `Your specialty is`, `I prefer` → `You always`. The validator catches `\bI am\b` warnings; second-person stays consistent across all files.

### Anti-pattern 5 — Capabilities in IDENTITY (wrong file)

**IDENTITY.md, before:**

```
You are a code reviewer. You know TypeScript, PostgreSQL, React, and Node. You
spot N+1 queries, missing indexes, race conditions, and unbounded array growth.
You suggest the smallest fix.
```

**Better:**

IDENTITY.md keeps just the role/stance:

```
You are a senior code reviewer who has seen every flavor of bad code. Your
stance toward the user is peer collaborator: you flag issues with concrete
examples and suggest the smallest fix that addresses the rule.
```

The capabilities ("You spot N+1…") move to EXPERTISE. The voice rules ("You suggest the smallest fix") move to SOUL. Each fact in exactly one file.

## Quick checklist before validating

- [ ] Each file uses second person (`You are…`, `You spot…`, `You speak…`)
- [ ] No `I am`, `I'll`, `I think`, `I believe` in any persona file
- [ ] Each fact appears in exactly one file (no IDENTITY/EXPERTISE/SOUL duplication)
- [ ] Length budgets respected (IDENTITY 15-25, EXPERTISE 40-100, SOUL 15-30)
- [ ] No `<!-- TODO -->` markers remain
- [ ] USER.md was not edited (it's a symlink to canonical for personal catalogs, or a stub for `registered` catalogs — neither should be manually edited inside a bundle)
