# Writing effective skill descriptions

The `description` field in frontmatter is the **only** thing most clients see until the skill is invoked. It carries the entire burden of triggering. Bad description → skill never loads, no matter how good the body is. Load this reference when drafting or revising the description field.

## Why the description matters

Agent Skills use three-stage progressive disclosure:

1. **Metadata** (`name` + `description`) — always in context (~100 tokens)
2. **SKILL.md body** — loaded only when the skill is triggered
3. **Bundled resources** — loaded on demand

The agent's decision to invoke the skill is based entirely on stage 1. If the description doesn't convey when to use the skill, the body never runs.

One additional nuance: most clients only consult skills for tasks that exceed what the model can trivially do alone. "Read this PDF" may not trigger a PDF skill even if the description matches, because the model can handle it with basic tools. Specialized, multi-step, or domain-specific tasks are where a well-written description earns its keep.

## The four principles

### 1. Use imperative, intent-focused phrasing

Frame the description as an instruction to the agent. Start with "Use when…":

| Bad | Good |
|---|---|
| "This skill helps with PDF extraction." | "Use when the user needs to extract text, tables, or form fields from a PDF." |
| "A tool for data visualization." | "Use when the user wants a chart, dashboard, or visual summary of tabular data." |

The agent is deciding whether to act. Tell it when to act.

### 2. Focus on user intent, not implementation

Describe what the user is trying to achieve, not what the skill does internally:

| Bad | Good |
|---|---|
| "Uses pdfplumber and pdf2image to handle PDFs." | "Use when the user has a PDF and wants text, tables, or filled fields — even for scanned documents." |
| "Runs `git log --pretty` to summarize commits." | "Use when the user asks to summarize recent changes, generate a changelog, or review what happened on a branch." |

The agent matches against the user's phrasing, not the skill's internals.

### 3. Err on the side of pushy

Explicitly list trigger contexts, including cases where the user doesn't name the domain directly. **Undertriggering is the more common failure mode** — the agent being too cautious about loading a skill when it would have helped:

> "Use when the user wants to create a skill, turn a repeated workflow into a skill, capture domain expertise as reusable agent instructions, or convert a prompt or playbook into a skill folder. Triggers on phrases like 'create a skill', 'make this into a skill', 'write a SKILL.md', 'turn this workflow into a skill', or when the user describes a repetitive task they want to package for agents."

Notice how this covers: explicit noun ("a skill"), synonymous verbs ("create", "make", "turn into", "capture", "convert"), and implicit intent ("a repetitive task they want to package"). That breadth is intentional.

### 4. Describe WHEN, not WHAT — and stay under 1024 chars

The Agent Skills spec (and OpenCode) caps `description` at 1024 chars. Claude Code truncates the combined skill listing per skill at ~1536 chars, stripping late content first. Consequence: the first ~500 chars carry most of the triggering weight.

**Critical trap:** descriptions that summarize the skill's *workflow* create a shortcut the agent will take instead of reading the skill body. If your description says "reviews code in two passes," the agent may do one pass and assume it complied. Describe triggering conditions only — let the body teach the workflow.

| ❌ Workflow summary | ✅ Triggers only |
|---|---|
| "Reviews code in two passes — spec compliance then quality" | "Use when completing a task, before merging, or when verifying work meets requirements" |
| "TDD: write test first, watch it fail, write minimal code, refactor" | "Use when implementing any feature or bugfix, before writing implementation code" |

Put your clearest trigger phrases first. Save edge cases and disambiguation for the tail.

## Anatomy of a good description

Four components, in this order:

1. **What it does (high level)** — one clause on purpose
2. **Concrete trigger phrases** — literal words the user is likely to say
3. **Symptom triggers** — situations that indicate a need even without keyword match
4. **Adjacent-but-different disambiguation** — say what it's *not* if the boundary is fuzzy

**Example for a hypothetical `pr-review` skill:**

> "Review a pull request on GitHub or GitLab. Use when the user asks to review a PR, give feedback on a merge request, check a diff for issues, or says 'look at this PR' or 'review this change'. Triggers on PR/MR URLs. Does *not* cover local uncommitted changes — use standard git tooling for those."

Four components, ~370 chars.

## Before and after rewrites

### Too generic → scoped

```
Before: "Helps with data."
After:  "Use when the user has a CSV, TSV, or Excel file and wants to explore,
         transform, summarize, or visualize the data — even if they don't
         explicitly say 'CSV' or 'analysis'."
```

### Missing trigger phrases → pushy

```
Before: "PDF extraction skill."
After:  "Use when the user needs text, tables, or form-field values out of a
         PDF. Triggers on 'extract from PDF', 'read this PDF', 'pull text out
         of this doc', and on any .pdf file attachment."
```

### Mixed intent → split into two skills

```
Before: "Database operations — queries, migrations, backups, performance
         tuning, schema design."
After:  (This is two skills. Split into `db-query` and `db-admin`. Each gets
         a focused description.)
```

When the description lists 4+ independent use cases, suspect you need to split.

### Over-narrow → broadened

```
Before: "Use when the user pastes a CloudWatch metric query expression."
After:  "Use when the user is debugging service performance, checking alarms,
         reading CloudWatch logs, or analyzing metrics — whether or not they
         paste an explicit query. Covers metric math, log queries, and
         dashboard composition."
```

### Overfit keywords → generalized to intent

```
Before: "Triggers on 'extract', 'parse', 'extract_text', 'pdfplumber'."
After:  "Use when the user has a document they need content from — text,
         tables, form fields, or structured data. Works for PDF, DOCX, XLSX,
         and scanned images."
```

Listing library names or method names as triggers is overfitting. The user typically doesn't know or care about your implementation.

## DIY sanity check

Before trusting the description, generate 6-8 realistic user prompts yourself and eyeball whether the description would plausibly match each:

- 3-4 should-trigger prompts with varying phrasing (formal, casual, with typos)
- 3-4 near-miss should-not-trigger prompts that share keywords but need something different

If more than one should-trigger prompt fails, the description is too narrow. If more than one should-not-trigger prompt hits, it's too broad.

The full train/validation/optimization loop (automated trigger-rate measurement) is out of scope for the basic workflow. For authors who need the heavy version, see [Anthropic's optimizing-descriptions guide](https://agentskills.io/skill-creation/optimizing-descriptions).
