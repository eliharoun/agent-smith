# Lazy URL knowledge sources — design

## Problem

A bundle author wants to attach an internal wiki page, a runbook, a published spec, or any other URL as a knowledge source. Today smith only offers two install-time-fetch modes:

- `delivery: inline` — content embedded in the rendered prompt forever.
- `delivery: file` — content materialized to a sidecar file on disk; agent reads via filesystem.
- `delivery: auto` — smart-default smart-picks between the two by token budget.

All three **fetch at install time, once**. That hurts when:

1. **Content drifts.** An incident runbook changes weekly. The bundle ships with a stale snapshot.
2. **Per-user permissions vary.** Same Confluence page; different teammates see different content. A bundle author can only ship their own view.
3. **Auth is interactive.** Atlassian's scoped tokens, GitHub Enterprise SAML, etc. need the recipient's session — but smith can only use the author's at install time.
4. **Content is long-tail.** Twenty internal links a bundle could *reference*, but only one or two are relevant per conversation. Inlining all twenty bloats the prompt; sidecars all twenty bloats the disk.

## Goal

Add a third option for URL sources: **`lazy: true`**. The bundle carries the URL + a description; nothing is fetched at install time. At runtime, the agent fetches on demand using its built-in `WebFetch` tool (Claude Code, Kiro) or a routed MCP tool (when `via:` is set).

URL sources only. All other source types — file, dir, glob, git, npm, confluence, jira — keep their existing behavior. The schema rejects `lazy` on those types.

## Non-goals

- **No stale-cache fallback.** When a runtime fetch fails, the agent sees the error and decides what to do. We're not building a per-source fallback cache — that's a separate decision after lazy ships and produces real usage signal.
- **No new field for L1 metadata.** Reuse the existing `description` with a soft length warning.
- **No git-blob lazy.** Git URLs (single-file or full clone) keep their existing semantics.
- **No automatic URL discovery.** The author writes `lazy: true` explicitly. Smart-defaulting `delivery: auto` to lazy was tempting; we reject it because lazy has runtime cost the author should opt into knowingly.

## Non-decisions (already settled in earlier work)

- The `via:` field already exists for explicit MCP routing. Lazy URLs reuse it unchanged.
- The routing registry (`src/core/knowledge/routing-registry.ts`) already suggests `via:` for known patterns. Lazy can use it too.
- The MCP client pool, `acquire-via.ts`, and the per-bundle `mcp.required[]`/`peer[]` declarations are all in place. Lazy uses them.

## Research grounding

Industry research conducted 2026-06-03 (full report available on request). Highlights driving the design:

- **Anthropic Skills** uses three-tier progressive disclosure: L1 (description always loaded, ≤1024 chars), L2 (skill body fetched on demand), L3 (referenced files). Lazy URLs map cleanly to this pattern: description is L1, URL body is L2.
- **Codex Skills** caps initial skill list at ~2% of context (≤8000 chars). Front-loaded trigger keywords survive truncation.
- **Anthropic best practices** mandate third-person `<does X>. Use when Y.` description shape; reject first/second person.
- **Continue's `URLContextProvider`** runs lazy at every call (no caching). Failure surfaces as a thrown HTTP error — no fallback. We follow this on failure.
- **MCP Resources** (the spec's L2 primitive) ships `resources/list` with `name`/`title`/`description`/`mimeType`/`size`/`annotations`. Auth via OAuth 2.1 + PKCE is the cleanest first-fetch path; smith's existing routing already gets us there for Atlassian/GitHub/etc.

## Architecture

### Schema additions

```ts
// src/core/knowledge/schema.ts

const UrlVariant = z.discriminatedUnion("lazy", [
  // lazy: true — no install-time fetch; agent fetches at runtime.
  z.object({
    ...BaseFields,
    type: z.literal("url"),
    url: z.string().min(1),
    lazy: z.literal(true),
    auth: Auth.optional(),  // hint for routing-registry suggestion at add time
  }).strict(),
  // lazy: false / unset — existing v1 behavior.
  z.object({
    ...BaseFields,
    type: z.literal("url"),
    url: z.string().min(1),
    lazy: z.literal(false).optional(),
    auth: Auth.optional(),
  }).strict(),
]);
```

When `lazy: true`:
- `delivery` is **forbidden** (a `superRefine` rejects it). Lazy supersedes the delivery decision.
- `inlineBudgetTokens` is meaningless and ignored.
- `materialize` and `extractor` are forbidden (no body to materialize).
- `summary` and `toc` continue to work (used by the compile-stage stanza).
- `retrieval` continues to work (a lazy source could still be indexed in BM25 if its description is enough).
- `via` continues to work (declares the MCP tool the agent should call at runtime).

The schema removes the dead `lazy: z.union([z.boolean(), z.literal("auto")]).optional()` placeholder from `BaseFields` and makes lazy URL-only.

### Per-target effective behavior

When `runKnowledgeStage` processes a lazy URL source, the **effective delivery is computed per-target**:

| Target | Effective behavior |
|---|---|
| `claude-code`, `opencode`, `codex`, `kiro` | Pure lazy: TOC entry only. Body fetched at runtime by agent. |
| `agents-md` | Auto-degrade: smith fetches at install time and chooses between inline (small, fits inline budget) or file (sidecar) using existing logic. Plus the URL is rendered as a `> source: <url>` reference so capable agent runtimes (Cursor, Windsurf, Copilot) can re-fetch. |

This is per-target effective behavior, not per-source. A single bundle targeting both Claude Code AND AGENTS.md will render different output to each — Claude Code sees the lazy TOC entry; the AGENTS.md file gets the full content + URL reference. Both bundles share the same author config; the author writes one bundle.

The pipeline already varies output per-target via the translator layer, so this isn't a new mechanism. It's a new branch in the existing per-target rendering.

### TOC entry shape

For a lazy URL source, the `compile-manifest.json` entry and the rendered TOC stanza include enough for the agent to decide whether to fetch.

Manifest:

```json
{
  "id": "platform-architecture",
  "scope": "agent",
  "type": "url",
  "delivery": "lazy",
  "url": "https://wiki.internal.example.com/architecture",
  "description": "Platform service architecture: data flow, auth model, deployment topology. Use when answering questions about system layout or service boundaries.",
  "via": { "server": "internal-mcp", "tool": "fetch_page" },
  "fetchedAt": null,
  "files": []
}
```

Rendered TOC stanza (Claude Code / OpenCode / Codex / Kiro):

```markdown
- `platform-architecture` [url, lazy] — Platform service architecture: data flow, auth model, deployment topology. Use when answering questions about system layout or service boundaries.
    url: https://wiki.internal.example.com/architecture
    fetch via: internal-mcp.fetch_page  (or WebFetch if no via: declared)
```

When `via` is unset, the line says `fetch via: WebFetch` (Claude Code/OpenCode/Kiro) or omits it (Codex — no `webfetch` tool mapped).

For `agents-md` (auto-degrade):

```markdown
### platform-architecture — Platform service architecture: data flow, auth model, deployment topology.

> source: https://wiki.internal.example.com/architecture (last fetched 2026-06-03)

[full materialized body inlined here, OR a "see file: sources/platform-architecture/architecture.md" pointer]
```

### Description as L1 metadata

Following Anthropic Skills research: `description` is the agent's only window into a lazy source until it fetches. Smith adds a soft validator at install time:

- **Warn** when description is empty or shorter than 30 chars.
- **Warn** when description starts with `^(I |You |This skill|This source)` (first/second person — the research-validated anti-pattern).
- **Warn** when description exceeds 1024 chars (Anthropic's published cap).
- Never block install on these warnings; the bundle still installs.

The cap is 1024, not 280 (the existing `summary` cap). For lazy sources, description is the entire signal — being terse hurts. Authors who want to keep things tight can ignore the cap; it's a guideline, not a wall.

### Refresh semantics for lazy sources

`smith knowledge fetch <agent>` and `smith knowledge fetch <agent> --source <id>`:

- **For `lazy: true` URL sources:** smith re-validates the URL still resolves (HEAD request, OR a routed-MCP probe if `via:` is set). Updates `fetchedAt`. Does NOT inline body. Does NOT auto-derive description (author owns it).
- **For non-lazy sources:** existing behavior unchanged.

The intent: refresh is a freshness signal for the routing/URL still working, not a content ingestion.

### Validation rules

The schema's `superRefine` block adds:

```ts
// lazy is incompatible with delivery / materialize / extractor / inlineBudgetTokens
if (src.type === "url" && src.lazy === true) {
  if (src.delivery !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "lazy URL sources cannot specify delivery — lazy supersedes the delivery decision",
      path: ["delivery"],
    });
  }
  if (src.materialize !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "lazy URL sources cannot specify materialize — no body is fetched at install time",
      path: ["materialize"],
    });
  }
  // ... extractor, inlineBudgetTokens similar
}
```

### `smith knowledge add` flow

When the user runs `smith knowledge add <agent> <url> --lazy`:

1. Same flow as today, plus the `lazy: true` field gets set in the saved source.
2. The routing registry suggestion (existing v1.4 behavior) still runs. If the URL matches a known pattern, the user is asked whether to wire `via:`.
3. The interactive picker still runs for `via:` if the user has MCP servers configured.
4. Description is prompted for if missing (matches existing UX for `--description`).

When the user runs `smith knowledge add <agent> <url>` (no `--lazy`), behavior is unchanged from today.

### `smith knowledge route`, `--clear-via`

Already exist. Lazy doesn't change them — `route`/`--clear-via` operate on `via:` and are orthogonal to `lazy:`.

### GUI add/edit modal

Adds a single "Lazy fetch" toggle on URL-type sources (only). When toggled on:

- The `delivery` dropdown is hidden/disabled.
- The `inlineBudgetTokens`, `materialize`, `extractor` fields are hidden.
- The description field gets a "tip" label: "Used as the agent's L1 metadata — write what the source contains and when to use it."

When toggled off, all existing fields return.

### Per-target translator changes

The translators don't directly care about lazy — they render `RenderedAgent` outputs from `CanonicalConfig` plus a knowledge `KnowledgeSection` that the pipeline computed. The pipeline does the per-target effective-delivery decision and produces a different `KnowledgeSection` per target.

The smallest change: `runKnowledgeStage` accepts an optional `target: Target` and varies the lazy handling. The orchestrator already calls `runKnowledgeStage` once and shares output across all targets — that needs to change to per-target rendering. Alternatively, the orchestrator runs `runKnowledgeStage` once with default lazy semantics (TOC entry only), then a separate "agents-md auto-degrade" pass fetches and inlines for that target. The latter is a smaller delta against the existing code; we'll start there.

### Doctor

Today's `url-routing` doctor section already enumerates routes. We add a small section to flag:

- Lazy URL sources whose `via.server` isn't installed (preflight overlap with existing `mcp-deps`).
- Lazy URL sources where the runtime target stack doesn't include any tool that can fetch (e.g., bundle targets only Codex but Codex has no `webfetch` tool mapped — the agent has no way to actually fetch).

These flags are warnings, not errors.

## Phasing

Lazy mode lands as a single coherent feature, not phased. The work is small enough (about 12 tasks of TDD-style work).

Phase 4 (stale-cache fallback for runtime fetch failures) stays deferred per user direction. We revisit after lazy ships and we have real usage data.

## Open questions

None blocking. Two cosmetic decisions to lock during implementation:

1. **CLI flag name on `knowledge add`.** Options: `--lazy`, `--no-fetch`, `--reference`. Recommend `--lazy` — it matches the schema field, is short, and sets a clear expectation.
2. **The "mention the URL as a reference in agents-md output" rendering.** Recommend a `> source: <url>` blockquote line directly under the heading, mirroring how academic citations work in Markdown. Subject to revision after first user sees it.

## Trade-offs and known limits

| Trade-off | Decision |
|---|---|
| Author writes lazy explicitly (no `delivery: auto` → lazy migration) | Author opts in knowingly; runtime cost is real |
| AGENTS.md auto-degrade renders different content per target | Acceptable — bundles already render differently per target |
| Description-driven L1 with no required summary | Reuse existing field; soft warnings only |
| No stale-cache fallback at runtime | Phase 4 territory; revisit later |
| `inlineBudgetTokens` ignored for lazy | Field semantics narrowed for clarity |
| No automatic URL discovery / no `lazy: auto` mode | Reduces surprise; author signals intent |

## See also

- v1.4.x release commits — `via:` declaration, routing registry, probe-on-failure (already shipped)
- v1.6.0 — per-agent MCP wire/unwire (already shipped)
- `src/core/knowledge/pipeline.ts:339-378` — current `delivery: auto` smart-default decision (lazy is a sibling, not a replacement)
- `data/claude-code-tool-map.json:17` — `webfetch: ["WebFetch"]` (the runtime fetch tool)
- `data/kiro-tool-map.json:16` — `webfetch: ["web_fetch"]`
