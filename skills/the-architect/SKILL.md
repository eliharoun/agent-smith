---
name: the-architect
description: Use when the user wants to create, modify, or clone an agent for OpenCode, Claude Code, or Codex, or describes a recurring AI helper they want to package as a persistent agent. Triggers on phrases like "create an agent that...", "build me a code reviewer", "make an agent for X", "edit the X agent", "clone the X agent and tweak it". Builds 4-file persona bundles (IDENTITY/EXPERTISE/SOUL/USER + agent.config.json) that the `smith` CLI installs across all three platforms. Uses `smith` for all filesystem and validation work — the skill itself only orchestrates.
---

# the-architect

## Overview

Brainstorm-first meta-skill for creating, modifying, and cloning persona-driven agent-smith bundles. **Core principle: the validator is a non-negotiable gate.** Brainstorm first, draft second, validate always — no bundle ships without `smith agent validate <name>` exiting 0.

## When to use this skill

Use this skill when:

- The user says "create an agent that…", "build me a code reviewer", "make an agent for X", or any variation
- The user says "edit / modify / fix / improve the X agent" or names an existing agent that needs changes
- The user says "clone X to make Y" or "make a Y like X"
- The user describes a recurring AI helper or workflow they want to package as a persistent agent across sessions
- The user asks how to add an agent to OpenCode / Claude Code / Codex

Do NOT use this skill when:

- The user wants to register a source repo of agents → that's `smith agent register`, not this skill
- The user wants to install an existing bundle they already wrote → that's `smith agent install`, not this skill
- The user wants to manage the agent-smith daemon → that's `smith daemon`, not this skill
- The user is asking general "how do I prompt-engineer" or "how do I write a system prompt" questions without committing to package the result as a persistent bundle

## Prerequisites — verify before starting any flow

No version check is needed: the skill and the `smith` binary ship from
the same repo clone, so they are always in lockstep and the binary
already supports every capability this skill uses. The one prerequisite
is best-effort — if USER.md is missing, the skill degrades gracefully
and the runtime self-bootstraps when needed.

```bash
ls ~/.config/agent-smith/USER.md         # optional — enables persona/catalog defaults
```

If `~/.config/agent-smith/USER.md` is missing or empty, print this
single line — `no USER.md found; catalog and persona will use defaults`
— and continue to Phase A1. Do NOT stop the flow. The runtime
(installer Step 8b, `smith init-user`, and `smith agent init`) seeds
USER.md automatically when needed.

## Pick your flow

Match the user's request to one of three flows:

| User said... | Flow |
|---|---|
| "create…", "build me…", "make an agent that…" | **A. Create** |
| "edit X", "modify X", "X is too verbose" | **B. Modify** |
| "clone X", "make a Y like X" | **C. Clone** |

If ambiguous, ask: "Are you creating a new agent, modifying an existing one, or cloning one to tweak it?"

---

## Flow A — Create a new agent

### Catalog intent detection (pre-Phase A1)

Before asking Q1, scan the user's opening request and `~/.config/agent-smith/USER.md` for catalog intent. This determines where the bundle is scaffolded (the `--catalog` flag on `smith agent init`). Without it, scaffolding falls back to the user-global default at `~/.config/agent-smith/agents/`.

**Source 1: USER.md preference (read once per session).** You already read USER.md for the `agent-smith persona:` line. Also look for `agent-smith default catalog: <label>`. If present, run `smith agent catalogs` to confirm the label resolves to a registered catalog. If it does, that catalog becomes the default scaffold target for every agent created this session. If it doesn't resolve, print a one-line warning before asking Q1 and proceed as if the preference were unset.

**Source 2: Opening request signals.** Look for two trigger patterns:

*Pattern A — explicit catalog reference.* The user names a catalog by label or path (e.g. "Create a code-reviewer in `team-agents`", "put it in `~/work/team-agents/agents`"). Run `smith agent catalogs` and match by label OR by resolved path (prefix or suffix match against `rootPath` is acceptable — the user may name the repo root, not the `/agents` subdir; when multiple catalogs match, disambiguate interactively). Confirm: "I'll scaffold this into the `<label>` catalog at `<rootPath>`. Correct?" If the named path resolves to no registered catalog, tell the user, suggest `smith agent register`, and ask whether to register now or scaffold somewhere else.

*Pattern B — shared-intent phrasing without a named catalog.* "Create an agent for my team", "build a reviewer the team can share", "...so my coworkers can use it". Run `smith agent catalogs` and filter to `kind: registered`. Zero registered → explain none are registered, offer (a) user-global anyway or (b) register a team catalog first. Exactly one → "I see one registered catalog: `<label>`. Scaffold there? (yes / no / different)". Multiple → present a numbered list and ask which.

**Source 3: No-trigger default.** Neither Source 1 nor Source 2 fires → scaffold to user-global. No new question, no friction.

### Phase A1 — Brainstorm config (8 short Q&A turns)

**How to run Phase A1:** ask the questions one at a time, in order. Each question has a brief framing, the available options with concrete examples, and a recommended default. The user can answer specifically OR say "use defaults" at any point — that takes the recommendation for the current question and all subsequent ones, and you skip straight to summarizing.

**Always ask every question. Never skip a question because you think you can infer the answer from the user's opening prompt.** The user must see and confirm each decision — silent inference produces agents the user didn't actually agree to.

**If the user gave a detailed prompt up front** (e.g., "build me an agent that reviews TypeScript, finds N+1, speaks tersely, uses github MCP"), still ask each Phase A1 question in order. For questions where the prompt suggests an answer, present that answer as a **suggested default** alongside the recommended default, like this:

> "Q4 of 8 — Model tier. Your prompt suggests **high** (you mentioned 'gnarly architecture decisions'). Recommended default for this kind of agent: **balanced**. Which do you want? (a) balanced, (b) high — suggested from your prompt, (c) fast, (d) inherit."

The user must give an explicit answer per question (including "go with the suggested default" or "use defaults from here"). Never collapse multiple questions into a single confirmation block.

For each question below, present it to the user roughly as shown (you may rephrase, but keep the options + examples + recommended default, and add a "suggested from your prompt" marker on any option the user's prompt explicitly indicates). Wait for the user's answer before moving on.

#### Q1 of 8 — Name

The bundle's directory name and the filename in every install path. Used everywhere — by the user to invoke (`@<name>`), by `smith` to track it, by the platforms to load it.

Rules: kebab-case, lowercase letters + digits + hyphens. No spaces, underscores, slashes, or `@`.

Examples: `code-reviewer`, `pr-summarizer`, `db-schema-helper`, `release-notes-writer`, `bun-test-runner`.

Pick a verb-or-noun describing the agent's job, 2-4 words. Avoid generic names like `helper` or `assistant` — the name shows up in invocation, so make it readable.

**Ask the user:** "What should this agent be called? (kebab-case, e.g. `code-reviewer`)"

#### Q2 of 8 — Description

The one-line summary the platform shows next to the agent name. For Claude Code subagents, it's also part of how the parent agent decides whether to dispatch this subagent. Goes into `agent.config.json` as `description`.

Rules: at least 10 characters. Should start with an action verb in third-person present (`Reviews`, `Writes`, `Summarizes` — not `I review` or `Review`).

Good examples:
- `Reviews modified TypeScript code for correctness bugs and missing error handling.`
- `Summarizes pull request diffs into 3-bullet release notes.`
- `Drafts SQL migrations for Postgres given a schema-change request.`

Bad examples: `Code reviewer` (no verb, too vague), `Helps with stuff` (generic), `I review code` (first person).

The more specific about input class (TypeScript code, PR diffs, SQL schemas) and output class (review comments, release notes, migration files), the better it triggers in Claude Code's auto-dispatch.

**Ask the user:** "One-sentence description starting with an action verb. (e.g. 'Reviews modified code for bugs and style issues.')"

#### Q3 of 8 — Targets

Which AI coding platforms this agent gets installed into. Each target gets a rendered `.md` file at a different path with platform-specific frontmatter.

| Choice | Installs to | When to use |
|---|---|---|
| `all` | all three | **Recommended default.** You might switch platforms or use multiple. |
| `opencode` | `~/.config/opencode/agents/<name>.md` | OpenCode only |
| `claude-code` | `~/.claude/agents/<name>.md` | Claude Code only |
| `codex` | `~/.agents/skills/<name>/SKILL.md` | Codex only |
| custom mix | the targets you list (comma-separated) | Specific subset |

Installing to a target the user doesn't use is harmless — the file just sits there. Skipping a target they later want means re-running `smith agent install`. Default to `all` unless they have a specific reason.

**Ask the user:** "Which platforms? (a) all three [opencode, claude-code, codex] — recommended, (b) opencode only, (c) claude-code only, (d) codex only, (e) custom mix."

#### Q4 of 8 — Model tier

Which model tier runs this agent. Stored as `modelTier` in `agent.config.json`. The tier is a semantic intent — `smith` resolves it at install time to whichever concrete model your authenticated provider exposes for that tier. You are not locked to any specific provider.

| Tier | Aliases | Cost / Speed | When to use |
|---|---|---|---|
| `balanced` | `sonnet` | moderate cost, good speed | **Recommended default.** Right for code review, drafting, summarization, multi-step reasoning. |
| `fast` | `haiku` | cheapest, fastest | High-volume mechanical work: pre-commit linting, log filtering, simple lookups |
| `high` | `opus` | most expensive, slowest, smartest | Hard reasoning: architecture decisions, gnarly debugging, novel problems |
| `inherit` | — | uses caller's model | Subagents that should match parent's model behavior |

Examples: code reviewer → `balanced`. Architecture-decision agent → `high`. Log-filter helper → `fast`. A subagent invoked by other agents that should run at parent's tier → `inherit`.

After the bundle installs, run `smith doctor` to see what your tier resolves to on this machine.

**Ask the user:** "What model tier? (a) balanced — recommended, (b) high, (c) fast, (d) inherit from caller. (Legacy names opus/sonnet/haiku also accepted.)"

#### Q5 of 8 — Mode

How the agent is meant to be invoked. Stored as `mode` in `agent.config.json`.

| Mode | Meaning | Example |
|---|---|---|
| `subagent` | Invoked by other agents (or via `@`-mention) for specific scoped tasks. Doesn't see the full conversation context. | code-reviewer that the primary agent dispatches when the user says "review this PR" |
| `primary` | Top-level agent the user talks to directly throughout a session. Sees the full conversation. | A "TypeScript pair-programmer" persona for a whole work session |
| `all` | Available as both | When useful in either role and the user doesn't want to pick |

**Recommended default: `subagent`** — it's what most tool-shaped agents (reviewer, summarizer, generator) want. Pick `primary` only if the agent is a persistent companion for an entire session.

**Ask the user:** "How is this agent used? (a) subagent — invoked by other agents/people for specific tasks (recommended), (b) primary — top-level agent the user talks to directly, (c) all — both."

#### Q6 of 8 — Capabilities (permission preset)

What categories of action the agent is allowed to take. Stored as `permission` in `agent.config.json` using opencode's permission model: a map of capability group → `"allow" | "ask" | "deny"`. The capability groups are `read`, `glob`, `grep`, `list`, `lsp`, `edit`, `bash`, `task` (subagent dispatch), `webfetch`, `websearch`, `external_directory`, `skill` (controls loading of installed skills via the `Skill` tool — Q7 covers this in more depth). There is **no separate `write` group** — file creation falls under `edit` (which gates `Edit`, `Write`, `MultiEdit`, `NotebookEdit` together). Each platform translates this differently (opencode passes it through; claude-code and codex derive a tool allow-list from it).

Pick one of three presets, or `custom`:

| Preset | Capability map | When to use |
|---|---|---|
| `read-only` | `read, glob, grep, list, lsp, skill` allow; everything else deny | Reviewers, summarizers, auditors — agents that should never modify state. Includes search/navigation tools and skill loading. |
| `read-edit` | `read-only` + `edit` + `task` (subagent dispatch) allow; `bash`, `webfetch`, `websearch`, `external_directory` deny | **Recommended default.** General-purpose agents that read, search, modify files, dispatch subagents, and load skills — but no shell, no network. |
| `full` | all groups allow | Agents that need shell access or network calls (test runners, scaffolders, release agents) |
| `custom` | the user names the group → decision map | Specialized agents that need an unusual mix |

All three presets default `skill: "allow"`. Q7 (next) will let you tighten or scope skill loading further if you need to.

Custom examples (only use real group names — `read`, `glob`, `grep`, `list`, `lsp`, `edit`, `bash`, `task`, `webfetch`, `websearch`, `external_directory`, `skill`):
- Code reviewer: `{ read: "allow", glob: "allow", grep: "allow", edit: "deny", bash: "deny", webfetch: "deny" }` (read + search only; skill defaults to allow via the preset, or set explicitly)
- Test-runner: `{ read: "allow", glob: "allow", grep: "allow", edit: "deny", bash: "allow", webfetch: "deny" }` (read-only + bash so it can run `bun test`)
- Doc fetcher: `{ read: "allow", edit: "deny", bash: "deny", webfetch: "allow" }` (read-only + network)
- Remote-API explorer: `{ read: "allow", edit: "deny", bash: "deny", webfetch: "allow", websearch: "allow" }`

`"ask"` is also valid (prompt the user before each call) but is only honored by opencode. **Both** claude-code and codex emit a per-tool warning and omit the tool from their allow-list — neither has an interactive ask-gate. Use `"ask"` only if the agent will run primarily under opencode.

If the user picks `custom`: ask which capabilities to allow / ask / deny by enumerating the twelve groups, or have them paste a JSON object directly. Construct the resulting map and pass it via `--permission-json`.

Default: `read-edit`. Tighten to `read-only` if the agent has a clear "shouldn't ever modify" boundary; widen to `full` only if shell or network access is core to the job.

**Ask the user:** "Capability preset? (a) read-only — read, search, navigate; no changes, (b) read-edit — adds editing files and dispatching subagents (recommended), (c) full — adds shell and network access, (d) custom — I'll ask which capabilities to allow / ask / deny."

#### Q7 of 8 — Skills

Which installed skills (under `~/.config/opencode/skills/`, `~/.claude/skills/`, or `~/.config/codex/skills/`) the agent is allowed to load via the `Skill` tool. Stored as `permission.skill` in `agent.config.json`. Q6 already set `skill: "allow"` (the default in every preset) — this question lets you tighten or scope that.

Three modes, asked as a single question:

| Mode | Resulting `permission.skill` | When to use |
|---|---|---|
| **(a) all skills** | `"allow"` (the default) | Most agents. Skills are opt-in by name within the agent's prompt anyway, and OpenCode/Claude Code's own systems gate when each skill activates. |
| **(b) only specific skills** | `{ "<skill1>": "allow", "<skill2>": "allow", "*": "deny" }` (a pattern map) **plus** `requires.skills: [{name: "<skill1>"}, {name: "<skill2>"}]` (a delivery declaration) | Sandboxed agents where you want a tight allow-list — e.g. a code reviewer that should only ever load `brainstorming` and `test-driven-development`. Also use this when you want the recommended-defaults section in IDENTITY.md to mention specific skills (pass them via `--skills` too). |
| **(c) all except specific skills** | `{ "<bad-skill>": "deny", "*": "allow" }` (a pattern map) | Allow everything but specifically block a deprecated or unsafe skill. Rare. |

**Per-platform behavior:**

- **OpenCode** honors per-skill rules natively (the pattern map is passed through verbatim).
- **Claude Code** has no per-skill granularity in `allowed-tools`. Modes (b) and (c) collapse to "Skill is allowed" (broadest action) plus a warning. Mode (a) is exact.
- **Codex** has no native skill-tool runtime. **Any** non-default `permission.skill` declaration produces an explicit warning (`permission.skill: codex has no native skill-tool runtime; permission ignored.`) and is otherwise ignored. If the agent only targets codex, mode (a) is the only one with effect.

**Recommended default: (a) all skills.** Skills are gated by the agent's prompt and the platform's own activation logic; a `permission.skill` allow-list is belt-and-suspenders for sandboxed scenarios, not a routine concern.

For modes (b) and (c), construct the `permission.skill` pattern map yourself and merge it into the existing permission map from Q6. Then pass the combined object via `--permission-json` (which overrides `--permission`).

For mode (b) **only**, also pass `--requires-skills <comma-list>` so the agent's `agent.config.json` carries a `requires.skills` block — this lets `smith agent install <agent>` offer to install the skills if they're not present, and lets `smith doctor` flag them when missing. Use the same comma-list as the allow-list (one entry per skill, e.g. `--requires-skills brainstorming,test-driven-development`). Catalog-qualified entries are also accepted (`atlassian-skills/atlassian-readonly-skills`).

For mode (b), additionally pass `--skills <comma-list>` so the recommended-defaults section in IDENTITY.md gets generated with those skill names.

For mode (c), do NOT pass `--requires-skills`: the agent doesn't depend on the denied skills (or any other specific skill), so there's nothing to declare.

**Ask the user:** "Which skills can this agent load? (a) all skills — recommended (skill: 'allow'); (b) only specific skills (e.g. brainstorming, test-driven-development) — I'll build an allow-list; (c) all except specific skills — I'll build a deny-list."

If (b) or (c): "Which skill names? (comma-separated, exact filenames in the skills directory; e.g. `brainstorming, test-driven-development`)"

#### Q8 of 8 — MCP servers

Model Context Protocol servers the agent depends on for external capability (talking to GitHub, Linear, Slack, a database, etc.). Stored as `mcpServers: ["github", ...]` in `agent.config.json`. Each name must match an MCP server already configured for the target platform — `smith agent install` will warn if not.

Common MCP servers:
- `github` — fetch PRs, post review comments, manage issues, read repo contents (PR-reviewers, issue-triagers, release-notes agents)
- `linear` — read/write Linear issues, projects, cycles (project-management agents)
- `slack` — read channels, post messages (notification agents, summary-posters)
- `playwright` — drive a browser (UI-testing agents, screenshot agents)
- `postgres` / `sqlite` — query a database (data-exploration agents, schema-explainers)
- `fetch` — generic HTTP fetcher (agents that hit arbitrary URLs)

Examples: PR reviewer that posts comments → `github`. Release-notes agent reading Linear + posting Slack → `linear, slack`. Local-only code analyzer → `none`.

**Recommended default: `none`.** Only add MCP servers if the agent's core job requires external service calls.

**Ask the user:** "Does this agent need any MCP servers? List by name (e.g. github, linear, slack), or 'none' — recommended."

#### After all 8 (or after "use defaults")

Summarize the chosen config back to the user in 4-6 lines and ask **"shall I scaffold?"** Wait for confirmation before running `smith agent init`. If catalog intent was detected, include a `catalog: <label> (<rootPath>)` line in the summary so the destination is explicit.

### Phase A2 — Scaffold

Run `smith agent init` with the Phase A1 answers as flags:

```bash
smith agent init <name> \
  --description "<one-sentence>" \
  --targets <comma-list> \
  --model-tier <tier> \
  --mode <mode> \
  [--permission <preset>] \
  [--permission-json '<json>'] \
  [--skills <comma-list>] \
  [--requires-skills <comma-list>] \
  [--mcp-servers <comma-list>] \
  [--catalog <label-or-path>] \
  [--from <source-name>]
```

**`--catalog`:** pass only when catalog intent was detected (see "Catalog intent detection"). Accepts a registered label or absolute path; unregistered values are rejected with a `not-found` SmithError. See USER.md handling below.

**Targets flag:** the CLI requires an explicit comma-list. If the user picked "all" in Q3, expand it to `opencode,claude-code,codex` before invoking. `--targets all` is rejected.

**Permission flag:** pass `--permission <preset>` for `read-only`, `read-edit`, or `full` (these match the Q6 presets). For a custom map, pass `--permission-json '{"read":"allow","edit":"deny",...}'` instead. The two flags are mutually exclusive (if both are set, `--permission-json` wins). Omit both to leave `permission` absent from the config — each platform then applies its own defaults (no schema-injected default).

Expected: exit 0, message "Created <agentsDir>/<name>" (the path reflects `--catalog` when set; otherwise `~/.config/agent-smith/agents/`). Stub IDENTITY/EXPERTISE/SOUL.md files exist (each contains `<!-- TODO -->`); agent.config.json holds the full config.

**USER.md handling depends on where the bundle landed.** For user-global or project catalogs (the default), USER.md is symlinked to the canonical `~/.config/agent-smith/USER.md`. For a `registered` catalog (i.e. `--catalog` resolved to one), USER.md is scaffolded as a stub file — not a symlink — so teammates who clone the repo don't see a broken pointer to your local home. Surface this to the user verbatim when `--catalog` was used against a registered catalog: "USER.md was scaffolded as a stub (not a symlink) so teammates won't see your local path. Each teammate's `smith agent install` will re-link it to their own canonical USER.md."

If exit non-zero: read the error message, fix the flag (most likely description < 10 chars, or `--catalog` value not registered), re-run.

### Phase A3 — Brainstorm and draft persona files

Load the persona-drafting reference now (one-time read this phase):

```
Load references/persona-files-rubric.md
```

That file holds: per-file role table, length budgets, recency-weighted assembly explanation, drafting heuristics, brainstorming question templates per file, and anti-pattern before/after rewrites. Use it as your reference while drafting.

Draft order is **IDENTITY → EXPERTISE → SOUL → USER**. For each of the first three:

1. Ask 1-3 questions from the rubric for that file
2. Draft 5-25 lines (per file's length budget — see rubric)
3. Show the user the draft, ask for approval
4. Use the `Edit` tool to replace the stub `<!-- TODO -->` content with the draft. The bundle directory is `~/.config/agent-smith/agents/<name>/<FILE>.md`.

USER.md: **skip drafting**. It is normally a symlink to the canonical `~/.config/agent-smith/USER.md` (the user's canonical "About me"), or a stub file when the bundle was scaffolded into a registered catalog via `--catalog` (see Phase A2). Either way, editing it through this agent's directory is the wrong path: in the symlink case you'd edit the canonical file for every agent, and in the stub case the stub gets overwritten on each teammate's `smith agent install`. If the user explicitly asks "shouldn't this agent know X about me?" — direct them to `smith init-user` to update the canonical USER.md.

**Do not run `smith agent validate` until all three persona files (IDENTITY, EXPERTISE, SOUL) are drafted.** Validating with stubs in place produces noise about TODO markers in the un-drafted files, which obscures real validation issues.

### Phase A4 — Validator gate

Run:

```bash
smith agent validate <name>
```

Three outcomes:

**Exit 0, no warnings** → proceed to Phase A5.

**Exit 0, with warnings** → surface the warnings to the user verbatim. Ask: "These are advisory and won't block install. Address now or proceed?" If proceed → Phase A5. If address → enter the error-recovery loop (below) treating warnings as targets.

**Exit non-zero (errors)** → enter the error-recovery loop:

1. Read the validator output verbatim — it names the file and the specific rule that failed.
2. Identify the failing file from the error.
3. Use `Read` to read the current file contents.
4. Diagnose the category:
   - Empty / under-length → file has < 5 chars or way under the budget; needs content
   - First-person voice (`'I am'`, `'I'll'`) → rewrite as `'You are'`, `'You will'`
   - Missing `'You'` entirely → the file isn't addressing the agent in second person; restructure
   - TODO marker still present → stub never got drafted; loop back to Phase A3 for that file
   - Length over hard limit (64k chars) → way too long; trim aggressively
5. Apply the **smallest possible fix** that addresses the named rule. Do not rewrite the whole file unless the file is structurally wrong.
6. Re-run `smith agent validate <name>`.
7. If the same error returns: revisit the persona-files-rubric for that file's anti-patterns; the previous fix missed the structural issue.

Loop Phase A4 until exit 0.

### Phase A5 — Install

Run:

```bash
smith agent install <name>
```

Expected output:

- Per-target install lines like `→ opencode /Users/<user>/.config/opencode/agents/<name>.md`.
- A rendered-agent tally: `N installed, M unchanged`.
- **If the agent has knowledge sources** (any entry in `agent.config.json` → `knowledge.sources`), the per-target block is followed by a per-source knowledge stanza: `→ knowledge <source-id> (N files, X.XKB, <delivery>)` for sources whose materialized bytes changed since the last install, or `· knowledge <source-id> (...) (unchanged)` otherwise. Then a knowledge tally: `A changed, B unchanged · X files, Y.YKB` (with a trailing `· inline tokens U/B` clause only if any source has `delivery: inline`).

Report **all** of the above to the user verbatim — not just the per-target install paths. The knowledge stanza confirms that the agent's knowledge actually materialized to disk and is the user's first signal if a source failed to fetch or shipped no files. For agents without knowledge, the stanza is suppressed entirely and the output ends at the rendered-agent tally; that's expected, not a bug.

If `smith agent install` warns about missing skills (`[<name>] skill 'X' not found...`) or missing MCP servers (`[<name>] MCP server 'X' not configured for <target>`), surface those warnings — they don't block install but the user should know.

Done. Tell the user the agent is ready to use in any of the listed targets.

**If the bundle was scaffolded into a `registered` catalog** (via `--catalog`), add team-share next steps. From the catalog root: `git add . && git commit -m "Add <name> agent" && git push`. Then tell the user: "Tell your team they can pull and run `smith agent install <name>`." Don't run git commands yourself unless the user asks.

---

## Flow B — Modify an existing agent

Skip Phases A1 and A2 — the bundle and config already exist. Confirm the agent name with the user; verify it exists:

```bash
smith agent list  # must show <name>
ls ~/.config/agent-smith/agents/<name>/  # must show 4 files
```

### Phase B3 — Targeted edit

Ask the user what should change:

- "Which file? (a) IDENTITY — who the agent is, (b) EXPERTISE — what it knows / does, (c) SOUL — voice and style, (d) config (agent.config.json) — model tier, capabilities (`permission`), MCP servers, etc."
- "What specifically should change?"

Then:

1. `Read` the current file
2. If it's a persona file: load `references/persona-files-rubric.md` and target the specific section the change affects (don't rewrite unrelated parts)
3. Propose the diff to the user
4. `Edit` to apply
5. Proceed to Phase A4 (validate) and Phase A5 (install)

If the user wants to change config (not a persona file): edit `agent.config.json` directly with `Edit`. Validator will catch schema violations. Common config changes: add a skill (`skills: [...]`), add an MCP server (`mcpServers: [...]`), tighten capabilities (`permission: { read: "allow", edit: "deny", ... }`).

---

## Flow C — Clone an existing agent

### Phase C1 — Confirm new name

Ask only: "What should the new agent be called?" Inherit everything else from the source.

If the user wants to override fields at clone time (e.g., "clone code-reviewer to terse-reviewer with model fast"), capture the overrides; pass them as flags in Phase C2.

### Phase C2 — Scaffold from source

```bash
smith agent init <new-name> --from <source-name> \
  [--description "<override>"] \
  [--model-tier <override>] \
  [--targets <override>] \
  [--mode <override>] \
  [--permission <override>] \
  [--permission-json '<override>'] \
  [--mcp-servers <override>] \
  [--skills <override>]
```

This copies IDENTITY/EXPERTISE/SOUL.md verbatim, re-creates USER.md (symlink to the canonical `~/.config/agent-smith/USER.md`, or a stub if the clone landed in a registered catalog), and writes a new agent.config.json with the source's config + any overrides.

### Phase C3 — Targeted edits (like Flow B)

Ask: "What should differ from the source?" Then for each difference, treat it like a Flow B targeted edit. Most clones change SOUL (voice/style), occasionally EXPERTISE (added/removed capabilities), rarely IDENTITY.

### Phase C4 + C5 — Validate and install

Same as A4 + A5.

---

## smith CLI reference

| Command | Purpose | Key flags |
|---|---|---|
| `smith agent init <name>` | Scaffold a new bundle (or `--from` clone) | `--description` (req) `--targets` `--model-tier` `--mode` `--permission` `--permission-json` `--mcp-servers` `--skills` `--requires-skills` `--catalog` `--from` |
| `smith agent validate <name>` | Validate a bundle without installing | exits 0 = ready, 1 = errors |
| `smith agent install <name>` | Validate + render + install to all configured targets; offers to install agent's required skills | exits 0 = installed. Flags: `--yes` (install required skills without prompting), `--with-skills` (alias for `--yes`), `--no-skills` (skip required-skills install) |
| `smith agent list` | List all known agent bundles | — |
| `smith status` | Show install status of each agent per target | — |

Bundles live at `~/.config/agent-smith/agents/<name>/`. Installed (rendered) files are at:

- opencode: `~/.config/opencode/agents/<name>.md`
- claude-code: `~/.claude/agents/<name>.md`
- codex: `~/.agents/skills/<name>/SKILL.md`

**Edit source files only.** Never edit the rendered files in install paths — they are derived from the source bundle every time `smith agent install` runs.

---

## The validator is non-negotiable

**Iron Law:** this skill MUST NOT report success unless `smith agent validate <name>` exits 0.

This is the single most important rule. Everything else in this skill exists to help you reach an exit-0 validator — not to substitute for it.

### Counter-rationalizations

When you catch yourself thinking any of these, stop and run the validator:

| Thought | Reality |
|---|---|
| "It's a small change, no need to validate" | Small changes can introduce first-person voice or break the line budget. Validate. |
| "I know the validator will pass — the files look right" | The validator catches what you can't see. Validate. |
| "Validating again will produce the same warnings as before" | Maybe — but you might have introduced a new error. Validate. |
| "The error is obvious; let me just install and see" | `smith agent install` runs the validator. You'll fail at install instead. Validate first; fix; install. |
| "I'll address the warnings later" | Warnings don't block install. Address now or surface to user; never silently ignore. |
| "The persona is good enough; the user can polish later" | A bundle that doesn't validate isn't usable. The user can't polish what isn't installed. |
| "I can write the rendered file directly" | Source files in `~/.config/agent-smith/agents/<name>/` are the truth. Rendered files are derived. Always edit the source; let `smith agent install` re-render. |

### Forbidden shortcuts

- Do not edit the rendered output files (in `~/.config/opencode/agents`, `~/.claude/agents`, `~/.agents/skills`). They are derived; edits will be overwritten.
- Do not skip `smith agent validate` and go straight to `smith agent install`. (Install runs validate, but the user-visible flow should be validate → review warnings → install.)
- Do not declare the work done before `smith agent install` has actually been called and reported per-target paths.
- Do not draft the persona files outside of the bundle directory and then copy them in. Use `Edit` on the actual source file paths.

---

## Common mistakes

| Mistake | Fix |
|---|---|
| Wrote a persona file in first person ("I am a senior reviewer") | Validator catches missing `\bYou\b`. Rewrite with second-person framing: "You are a senior reviewer who…" |
| Stuffed everything into IDENTITY.md, left EXPERTISE/SOUL as stubs | IDENTITY is who the agent IS (15-25 lines). EXPERTISE is what it KNOWS and DOES (40-100 lines). SOUL is its VOICE (15-30 lines). Move bullets to the right file. |
| Skipped the validator after persona drafts | Run `smith agent validate <name>`. If it fails, you're not done yet. |
| Tried to brainstorm USER.md content per-agent | USER.md is normally a symlink to the canonical `~/.config/agent-smith/USER.md` (or a stub when scaffolded into a registered catalog via `--catalog`). Either way, it is not the place for per-agent content — never edit it via the agent dir. |
| Bypassed `smith agent init` and wrote files directly | Always start with `smith agent init`. It creates the directory, writes the config, and (critically) symlinks or stubs USER.md depending on catalog kind. |
| Scaffolded a team-shared agent without `--catalog` (then committed a USER.md symlink to a shared repo) | Use `--catalog <registered-label>` when scaffolding for sharing. `smith` writes a stub `USER.md` instead of a per-user-machine symlink, eliminating the broken-pointer footgun on teammates' clones. |
| Edited a rendered output file | Find the source at `~/.config/agent-smith/agents/<name>/<FILE>.md`. Edit that. Re-run `smith agent install`. |
| Validator failed; I rewrote the whole file | Read the error; identify the named rule; apply the smallest possible fix. Full rewrites usually introduce new failures. |
| The user gave a detailed prompt and I skipped Phase A1 questions because I "knew" the answers | Always ask every Phase A1 question. Use the prompt to pre-fill **suggested defaults** alongside each question's recommended default — but the user must explicitly confirm each answer. Silent inference produces agents the user didn't agree to. |
| `smith agent install` warned about missing skill/MCP — I didn't tell the user | Surface all warnings. The install succeeded, but the warnings tell the user what to install or configure next. |

## Red flags — STOP and re-check

If you catch yourself thinking any of these, you are about to ship a broken bundle:

- "I'll skip the validator just this once — the file is short"
- "First-person voice is fine for this one"
- "I know what the user wants without asking" (Phase A1 exists for a reason)
- "I'll just rewrite IDENTITY.md from scratch instead of finding the specific issue"
- "USER.md needs custom content for this agent" (it doesn't — never)
- "I'll edit the rendered file directly and copy it back to source later" (no)
- "The user will figure out the validator errors themselves" (you ran the skill; you finish the job)
- "Three iterations on one file is wasteful" (it's not — validator-driven iteration is the entire point)

---

## When the user wants something the skill doesn't cover

- They want to **delete** an agent → no smith subcommand for this yet; tell them to `rm -rf ~/.config/agent-smith/agents/<name>/` and the rendered files in install paths. Do this only if they confirm.
- They want to **rename** an agent → no smith subcommand; clone with `--from` to the new name, then delete the old.
- They want to **share** an agent with another user → re-create via Flow A and pass `--catalog <registered-label>`. If the team catalog isn't registered yet, run `smith agent register <repo>` first, then scaffold with `--catalog`.
- They want a totally non-persona thing (a tool, a script, a hook) → this skill creates persona-driven AI agents; their request belongs elsewhere.
