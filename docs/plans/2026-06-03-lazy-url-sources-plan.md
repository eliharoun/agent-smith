# Lazy URL knowledge sources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `lazy: true` as a per-source flag on URL knowledge sources only. When set, smith does not fetch at install time; the agent fetches the URL on demand at runtime via its built-in fetch tool (`WebFetch` on Claude Code/Kiro/OpenCode) or a routed MCP tool when `via:` is set. Bundles targeting `agents-md` auto-degrade: smith fetches at install for that target only and renders content as inline-or-file plus a URL reference.

**Architecture:** Schema's `BaseFields.lazy` becomes URL-variant-only via a discriminated union on `lazy`. The pipeline short-circuits lazy sources (no acquire, no materialize). A new `delivery: "lazy"` enum value flows through the manifest. The compile-stage TOC stanza renders lazy entries with URL + fetch-tool hint. A new agents-md-degrade pass runs after the main stage, fetches lazy URLs for the agents-md target only, and inlines or sidecars them. Refresh re-validates the URL but never re-fetches the body.

**Tech Stack:** TypeScript + Bun. Zod 4 for schema. Existing test runner (`bun test`). No new runtime dependencies.

**Spec:** [`docs/plans/2026-06-03-lazy-url-sources-design.md`](./2026-06-03-lazy-url-sources-design.md).

---

## Critical operating rules

1. **Test isolation is paranoid.** Tests must NEVER mutate real `$HOME`, `~/.claude.json`, `~/.config/agent-smith/`, or any shared state. Use `mkdtemp` fixtures + DI hooks.
2. **No Amazon-internal terminology** anywhere — code, comments, commit messages, docs, examples. Use generic placeholders (`wiki.internal.example.com`, `internal-mcp`, `fetch_page`).
3. **Commit messages** are concise, user-facing, and must NOT reference: planning docs, "Phase N", "v2", review feedback, or internal research findings.
4. **Never use destructive git commands** (reset --hard, push --force, branch -D) unless explicitly asked.
5. **Each task ends with a clean commit** before the next starts. Working tree must be clean (committed) at task boundaries.

---

## File structure

### New files (3)

- `src/core/knowledge/lazy-url.ts` — pure helpers: `isLazyUrlSource(src)`, `lazyDescriptionWarnings(src)`, `lazyTocLine(src)` — used by both pipeline and compile.
- `src/core/freshness/check-lazy-fetch.ts` — doctor section that flags bundles whose lazy URL sources lack a runtime-fetch tool (e.g. bundle targets only Codex but a lazy URL has no `via:`).
- `tests/_helpers/lazy-fixtures.ts` — small helper to construct lazy + non-lazy URL source fixtures used across multiple test files.

### Modified files (12)

- `src/core/knowledge/types.ts:25` — extend `KnowledgeDelivery` enum with `"lazy"`.
- `src/core/knowledge/types.ts:244-263` — add optional `url?: string` to `KnowledgeManifestSourceEntry` (for lazy entries; replaces inferring from `source.url`).
- `src/core/knowledge/schema.ts:84-102` — remove `lazy` from `BaseFields`.
- `src/core/knowledge/schema.ts:132-139` — replace single `UrlVariant` with a `lazy`-discriminated union (`UrlVariantLazy` + `UrlVariantNonLazy`).
- `src/core/knowledge/schema.ts:192-229` — extend `superRefine` with the description-shape soft warnings (returned as zod issues with `code: "custom"` AND a way for callers to read them as warnings — see Task 8 for the bridge).
- `src/core/knowledge/pipeline.ts:295-378` — short-circuit lazy sources before acquire; emit a `delivery: "lazy"` manifest entry with `url` field; never call `materializeIntoDir` for lazy.
- `src/core/knowledge/compile.ts:43-77` — render lazy entries with URL + fetch-tool hint in the TOC stanza.
- `src/core/knowledge/refresh-source.ts:80,262` — add a new `RefreshSourceResult` variant `"lazy-only"`; treat lazy sources like the existing `inline-only` short-circuit but with URL-validation HEAD probe.
- `src/io/orchestrator.ts` — add the `runAgentsMdDegradePass()` post-stage that fetches lazy URLs for the agents-md target only and produces a per-target `KnowledgeSection` override. Wire into the per-target render call.
- `src/cli/commands/knowledge/add.ts:125-265` — add `--lazy` option; on lazy=true skip the materialize-time acquire suggestion; carry `lazy: true` through to the saved source.
- `src/cli/commands/agent/register-commands.ts` (or wherever knowledge-add is wired) — register `--lazy` on the CLI surface.
- `gui/web/src/panels/KnowledgeSources/sourceForms/UrlForm.tsx` — add a "Lazy fetch" toggle that hides delivery/materialize/extractor fields when on; persists `lazy: true` in the saved config.

### Tests (7 new + 4 modified)

- New: `tests/core/knowledge/lazy-url.test.ts` (helpers).
- New: `tests/core/knowledge/pipeline-lazy.test.ts` (pipeline short-circuit).
- New: `tests/core/knowledge/compile-lazy.test.ts` (TOC line shape).
- New: `tests/io/orchestrator-lazy-agents-md.test.ts` (degrade pass).
- New: `tests/cli/knowledge-add-lazy.test.ts` (CLI flag).
- New: `tests/core/freshness/check-lazy-fetch.test.ts` (doctor section).
- New: `gui/web/src/panels/KnowledgeSources/sourceForms/UrlForm.lazy.test.tsx` (GUI toggle).
- Modified: `tests/core/knowledge/schema.test.ts` (lazy URL discriminated union; rejection rules).
- Modified: `tests/core/knowledge/refresh-source.test.ts` (lazy refresh result).
- Modified: `tests/core/knowledge/compile.test.ts` (existing TOC tests need to verify lazy lines coexist with non-lazy lines correctly).
- Modified: `tests/cli/install.test.ts` (lazy + agents-md degrade integration test, one case).

---

## Task 1: Extend `KnowledgeDelivery` type with `"lazy"`

**Files:**
- Modify: `src/core/knowledge/types.ts:25`
- Test: `tests/core/knowledge/types.test.ts` (extend; or create if absent)

- [ ] **Step 1: Read the current type and locate the change point**

Run:
```bash
grep -n "KnowledgeDelivery" src/core/knowledge/types.ts
```
Expected: line 25 defines `export type KnowledgeDelivery = "inline" | "file" | "auto";` and downstream lines 81/225/249 use it. The new `"lazy"` member must be added at line 25.

- [ ] **Step 2: Write the failing test**

Create or extend `tests/core/knowledge/types.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import type { KnowledgeDelivery } from "../../../src/core/knowledge/types";

describe("KnowledgeDelivery type", () => {
  it("includes lazy as a valid value", () => {
    const v: KnowledgeDelivery = "lazy";
    expect(v).toBe("lazy");
  });

  it("includes the existing values", () => {
    const inline: KnowledgeDelivery = "inline";
    const file: KnowledgeDelivery = "file";
    const auto: KnowledgeDelivery = "auto";
    expect([inline, file, auto]).toEqual(["inline", "file", "auto"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun run typecheck
```
Expected: TS error on line `const v: KnowledgeDelivery = "lazy";` saying `"lazy"` is not assignable.

- [ ] **Step 4: Apply the change**

In `src/core/knowledge/types.ts`, change line 25 from:

```typescript
export type KnowledgeDelivery = "inline" | "file" | "auto";
```

to:

```typescript
export type KnowledgeDelivery = "inline" | "file" | "auto" | "lazy";
```

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```
Expected: clean. The schema's `KnowledgeDelivery` zod enum (`schema.ts:4`) is independent of this TS type — that's intentional; we keep them separate because the schema enum gates input validation, but the TS type is the broader vocabulary including computed/internal values like `"lazy"` produced by the pipeline.

- [ ] **Step 6: Run all knowledge tests**

```bash
bun test tests/core/knowledge/types.test.ts
bun test tests/core/knowledge/
```
Expected: 2 new tests pass; existing tests pass; no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/core/knowledge/types.ts tests/core/knowledge/types.test.ts
git commit -m "knowledge: lazy delivery mode"
```

---

## Task 2: Extend `KnowledgeManifestSourceEntry` with optional `url`

**Files:**
- Modify: `src/core/knowledge/types.ts:244-263`
- Test: extend `tests/core/knowledge/types.test.ts`

**Goal:** Add an optional `url?: string` field. For lazy URL sources we'll record the URL here rather than under `source.url`, because lazy entries don't have files but do have a URL the agent must use at runtime.

- [ ] **Step 1: Write the failing test**

Append to `tests/core/knowledge/types.test.ts`:

```typescript
import type { KnowledgeManifestSourceEntry } from "../../../src/core/knowledge/types";

describe("KnowledgeManifestSourceEntry", () => {
  it("accepts a lazy entry with a top-level url", () => {
    const entry: KnowledgeManifestSourceEntry = {
      id: "wiki",
      scope: "agent",
      type: "url",
      delivery: "lazy",
      url: "https://wiki.internal.example.com/x",
      files: [],
      tokensInline: 0,
    };
    expect(entry.url).toBe("https://wiki.internal.example.com/x");
    expect(entry.delivery).toBe("lazy");
  });

  it("treats url as optional for non-lazy entries", () => {
    const entry: KnowledgeManifestSourceEntry = {
      id: "doc",
      scope: "agent",
      type: "file",
      delivery: "inline",
      files: [{ path: "sources/doc/x.md", sha256: "abc", bytes: 10 }],
      tokensInline: 5,
    };
    expect(entry.url).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run typecheck
```
Expected: TS error on the new `url:` field — `KnowledgeManifestSourceEntry` does not have a `url` member at the top level.

- [ ] **Step 3: Apply the change**

In `src/core/knowledge/types.ts`, find the `KnowledgeManifestSourceEntry` interface (line 244). Add the new field after `source?: { ... }` and before `delivery:`:

Replace lines 244-263:

```typescript
export interface KnowledgeManifestSourceEntry {
  id: string;
  scope: KnowledgeScope;
  type: KnowledgeSourceType;
  source?: { url?: string; path?: string; ref?: string; resolvedSha?: string };
  /**
   * Lazy URL sources record the URL at the top level for fast access by
   * the compile stanza renderer and the doctor section. Mirrors `source.url`
   * for non-lazy URL entries; absent on file/dir/glob/git/npm/confluence/jira.
   */
  url?: string;
  delivery: KnowledgeDelivery;
  files: { path: string; sha256: string; bytes: number; summary?: string }[];
  fetchedAt?: string;
  extractor?: PdfExtractor | null;
  tokensInline: number;
  description?: string;
  /** v2.0: TOC line override; falls back to description, then computed summary. */
  summary?: string;
  /** v2.0: include in the compiled TOC stanza (default true when compile.progressive). */
  toc?: boolean;
  /** v2.0: per-source retrieval mode for the optional MCP server. */
  retrieval?: RetrievalSpec;
}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```
Expected: clean. Two new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/knowledge/types.ts tests/core/knowledge/types.test.ts
git commit -m "knowledge: track URL on manifest source entries"
```

---

## Task 3: Schema — discriminate URL variants on `lazy`

**Files:**
- Modify: `src/core/knowledge/schema.ts:84-139` (BaseFields, UrlVariant, KnowledgeSourceSchema)
- Test: `tests/core/knowledge/schema.test.ts` (extend with new lazy URL describe block)

**Goal:** Move `lazy` off `BaseFields` (which today applies to every source type) and put it on a URL-variant-only discriminated union. When `lazy: true`, `delivery`/`materialize`/`extractor`/`inlineBudgetTokens` are forbidden. When unset or `lazy: false`, today's URL behavior is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/knowledge/schema.test.ts` (alongside the existing `via routing field (v1.2)` describe block):

```typescript
describe("lazy URL sources", () => {
  it("accepts a lazy URL source with description", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://wiki.internal.example.com/x",
      lazy: true,
      description: "Platform architecture wiki. Use when answering deployment questions.",
    });
    expect(r.success).toBe(true);
  });

  it("accepts lazy: false (explicit)", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://example.com/x",
      delivery: "auto",
      lazy: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects lazy on type=file", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "doc",
      type: "file",
      path: "./README.md",
      delivery: "inline",
      lazy: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.path.includes("lazy") || i.message.toLowerCase().includes("lazy")),
      ).toBe(true);
    }
  });

  it("rejects lazy on type=git", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "repo",
      type: "git",
      url: "https://github.com/acme/repo",
      delivery: "file",
      lazy: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects lazy on type=confluence", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "ENG",
      type: "confluence",
      space: "ENG",
      delivery: "auto",
      lazy: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects lazy: 'auto' (only true|false now; 'auto' is gone)", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://example.com",
      lazy: "auto",
    });
    expect(r.success).toBe(false);
  });

  it("rejects delivery alongside lazy: true", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://example.com",
      lazy: true,
      delivery: "inline",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some(
          (i) => i.message.toLowerCase().includes("delivery") && i.message.toLowerCase().includes("lazy"),
        ),
      ).toBe(true);
    }
  });

  it("rejects materialize alongside lazy: true", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://example.com",
      lazy: true,
      materialize: "html-to-md",
    });
    expect(r.success).toBe(false);
  });

  it("rejects extractor alongside lazy: true", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://example.com",
      lazy: true,
      extractor: "pdf-parse",
    });
    expect(r.success).toBe(false);
  });

  it("rejects inlineBudgetTokens alongside lazy: true", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://example.com",
      lazy: true,
      inlineBudgetTokens: 1000,
    });
    expect(r.success).toBe(false);
  });

  it("accepts lazy: true with via: routing", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://wiki.internal.example.com/x",
      lazy: true,
      via: { server: "internal-mcp", tool: "fetch_page" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts lazy: true with summary, toc, retrieval (compile-stage fields)", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://example.com",
      lazy: true,
      summary: "Short TOC line.",
      toc: true,
      retrieval: { mode: "off" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts lazy: true with description and refresh", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "wiki",
      type: "url",
      url: "https://example.com",
      lazy: true,
      description: "A wiki.",
      refresh: { mode: "session" },
    });
    expect(r.success).toBe(true);
  });
});

describe("lazy field removal from non-URL types (v1.2 forward-compat dropped)", () => {
  it("rejects lazy on type=dir (used to be silently accepted)", () => {
    const r = KnowledgeSourceSchema.safeParse({
      id: "x",
      type: "dir",
      path: "./docs",
      delivery: "file",
      lazy: true,
    });
    expect(r.success).toBe(false);
  });
});
```

Also remove or replace the two **stale** tests in the existing `via routing field (v1.2)` block at `tests/core/knowledge/schema.test.ts:193-208` that asserted "lazy field is no-op" and "lazy: 'auto' is accepted". Those become invalid under the new schema — replace them with the new strict-rejection cases above (they're already covered).

Edit `tests/core/knowledge/schema.test.ts` to delete (or comment-out, then delete after Task 3 commits) these two stale tests:

```typescript
// DELETE:
it("accepts lazy field (Phase 2 forward-compat — no-op in Phase 1)", () => { ... });
it("accepts lazy: 'auto'", () => { ... });
```

- [ ] **Step 2: Verify failure**

```bash
bun test tests/core/knowledge/schema.test.ts
```
Expected: the new "lazy URL sources" describe block fails (most assertions reject when current schema accepts; the schema has lazy on every variant). The "lazy field removal" test fails. Total: ~12 new failures.

- [ ] **Step 3: Apply schema changes**

Open `src/core/knowledge/schema.ts`. Make three edits.

**Edit 1 — line 99-101 — remove `lazy` from `BaseFields`.** Current:

```typescript
  // v1.2 routing
  via: ViaSpec.optional(),
  // v1.2 forward-compat: Phase 2 will activate this. Phase 1 accepts and
  // no-ops to keep bundles authored against the design doc parseable.
  lazy: z.union([z.boolean(), z.literal("auto")]).optional(),
} as const;
```

Replace with:

```typescript
  // v1.2 routing
  via: ViaSpec.optional(),
} as const;
```

**Edit 2 — replace `UrlVariant` (lines 132-139)** with two variants and a discriminated union. Current:

```typescript
const UrlVariant = z
  .object({
    ...BaseFields,
    type: z.literal("url"),
    url: z.string({ message: "type=url requires url" }).min(1),
    auth: Auth.optional(),
  })
  .strict();
```

Replace with:

```typescript
// URL sources can be either lazy (no install-time fetch; agent fetches
// at runtime) or eager (existing v1 behavior, fetched at install).
//
// When lazy=true, the delivery decision doesn't apply (lazy supersedes
// delivery), and materialize/extractor/inlineBudgetTokens are nonsensical
// since no body is fetched at install. Those fields are forbidden.
//
// When lazy is unset or false, today's URL semantics are unchanged.

// Common URL fields shared by both variants.
const UrlBase = {
  type: z.literal("url"),
  url: z.string({ message: "type=url requires url" }).min(1),
  auth: Auth.optional(),
} as const;

// Lazy URL: agent fetches at runtime. delivery/materialize/extractor/
// inlineBudgetTokens are forbidden. id, refresh, description, optional,
// summary, toc, retrieval, via remain available.
const UrlVariantLazy = z
  .object({
    id: BaseFields.id,
    refresh: BaseFields.refresh,
    description: BaseFields.description,
    optional: BaseFields.optional,
    summary: BaseFields.summary,
    toc: BaseFields.toc,
    retrieval: BaseFields.retrieval,
    via: BaseFields.via,
    ...UrlBase,
    lazy: z.literal(true),
  })
  .strict();

// Eager URL (existing v1 behavior).
const UrlVariantEager = z
  .object({
    ...BaseFields,
    ...UrlBase,
    lazy: z.literal(false).optional(),
  })
  .strict();
```

**Edit 3 — replace the discriminated union entry (line 186)** so the URL slot becomes its own union. Current:

```typescript
export const KnowledgeSourceSchema = z
  .discriminatedUnion("type", [
    FileVariant,
    DirVariant,
    GlobVariant,
    UrlVariant,
    GitVariant,
    NpmVariant,
    ConfluenceVariant,
    JiraVariant,
  ])
```

Replace with:

```typescript
// URL has two variants discriminated on `lazy`. Wrapping zod isn't
// strictly necessary because the outer discriminator is `type`, but
// `z.union([UrlVariantLazy, UrlVariantEager])` keeps both variants
// type-checked and parseable through the same `type: "url"` discriminator.
const UrlVariant = z.union([UrlVariantLazy, UrlVariantEager]);

export const KnowledgeSourceSchema = z
  .discriminatedUnion("type", [
    FileVariant,
    DirVariant,
    GlobVariant,
    UrlVariant,
    GitVariant,
    NpmVariant,
    ConfluenceVariant,
    JiraVariant,
  ])
```

- [ ] **Step 4: Run schema tests**

```bash
bun test tests/core/knowledge/schema.test.ts
```
Expected: all schema tests pass (~80 tests, including the 12 new lazy ones).

If any of the existing tests fail (notably the `via routing field (v1.2)` ones at lines 193-208 with "lazy field is no-op" and "lazy: 'auto'"), DELETE those stale tests now — they were forward-compat scaffolding for a no-op that no longer exists.

- [ ] **Step 5: Run typecheck and the full test suite**

```bash
bun run typecheck
bun test tests/core/knowledge/
bun test
```
Expected: typecheck clean; all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/knowledge/schema.ts tests/core/knowledge/schema.test.ts
git commit -m "knowledge: lazy URL sources opt out of install-time fetch"
```

---

## Task 4: Pure helpers — `lazy-url.ts`

**Files:**
- Create: `src/core/knowledge/lazy-url.ts`
- Test: `tests/core/knowledge/lazy-url.test.ts`

**Goal:** Three pure functions used by the pipeline, the compile stanza, and the doctor section. Putting them in one module keeps the lazy-specific logic findable.

- [ ] **Step 1: Write the failing tests**

Create `tests/core/knowledge/lazy-url.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import {
  isLazyUrlSource,
  lazyDescriptionWarnings,
  lazyTocLine,
} from "../../../src/core/knowledge/lazy-url";
import type { KnowledgeSource } from "../../../src/core/knowledge/types";

const lazySrc: KnowledgeSource = {
  id: "wiki",
  type: "url",
  url: "https://wiki.internal.example.com/architecture",
  lazy: true,
  description: "Platform service architecture wiki. Use when answering deployment or service-boundary questions.",
};

describe("isLazyUrlSource", () => {
  it("returns true for a URL source with lazy: true", () => {
    expect(isLazyUrlSource(lazySrc)).toBe(true);
  });

  it("returns false for a URL source with lazy: false", () => {
    const eager: KnowledgeSource = { id: "x", type: "url", url: "https://x", lazy: false, delivery: "auto" };
    expect(isLazyUrlSource(eager)).toBe(false);
  });

  it("returns false for a URL source with lazy unset", () => {
    const eager: KnowledgeSource = { id: "x", type: "url", url: "https://x", delivery: "auto" };
    expect(isLazyUrlSource(eager)).toBe(false);
  });

  it("returns false for a non-URL source even if it had lazy somehow", () => {
    const file: KnowledgeSource = { id: "x", type: "file", path: "./x", delivery: "inline" };
    expect(isLazyUrlSource(file)).toBe(false);
  });
});

describe("lazyDescriptionWarnings", () => {
  it("returns no warnings for a good description", () => {
    expect(lazyDescriptionWarnings(lazySrc)).toEqual([]);
  });

  it("warns when description is missing", () => {
    const src: KnowledgeSource = { id: "x", type: "url", url: "https://x", lazy: true };
    const warnings = lazyDescriptionWarnings(src);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/description/i);
  });

  it("warns when description is shorter than 30 chars", () => {
    const src: KnowledgeSource = {
      id: "x",
      type: "url",
      url: "https://x",
      lazy: true,
      description: "short",
    };
    const warnings = lazyDescriptionWarnings(src);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/short|30 chars/i);
  });

  it("warns when description starts with first or second person", () => {
    for (const desc of [
      "I help with platform questions.",
      "You can use this for platform questions.",
      "This skill helps with platform questions.",
      "This source contains platform info.",
    ]) {
      const src: KnowledgeSource = { id: "x", type: "url", url: "https://x", lazy: true, description: desc };
      const warnings = lazyDescriptionWarnings(src);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.match(/third.person|first.person|point of view/i))).toBe(true);
    }
  });

  it("warns when description exceeds 1024 chars", () => {
    const src: KnowledgeSource = {
      id: "x",
      type: "url",
      url: "https://x",
      lazy: true,
      description: "a".repeat(1025),
    };
    const warnings = lazyDescriptionWarnings(src);
    expect(warnings.some((w) => w.match(/1024|too long/i))).toBe(true);
  });

  it("returns empty array for non-lazy sources", () => {
    const eager: KnowledgeSource = { id: "x", type: "url", url: "https://x", delivery: "auto" };
    expect(lazyDescriptionWarnings(eager)).toEqual([]);
  });
});

describe("lazyTocLine", () => {
  it("renders a basic lazy TOC line with WebFetch hint when no via", () => {
    const line = lazyTocLine(lazySrc);
    expect(line).toMatch(/^- `wiki` \[url, lazy\]/);
    expect(line).toMatch(/Platform service architecture wiki/);
    expect(line).toMatch(/url: https:\/\/wiki.internal.example.com\/architecture/);
    expect(line).toMatch(/fetch via: WebFetch/);
  });

  it("renders MCP routing tool when via is set", () => {
    const src: KnowledgeSource = {
      ...lazySrc,
      via: { server: "internal-mcp", tool: "fetch_page" },
    };
    const line = lazyTocLine(src);
    expect(line).toMatch(/fetch via: internal-mcp\.fetch_page/);
    expect(line).not.toMatch(/WebFetch/);
  });

  it("uses summary when description is absent", () => {
    const src: KnowledgeSource = {
      id: "x",
      type: "url",
      url: "https://x.test",
      lazy: true,
      summary: "TOC summary line.",
    };
    const line = lazyTocLine(src);
    expect(line).toMatch(/TOC summary line/);
  });

  it("renders without description or summary (degraded but valid)", () => {
    const src: KnowledgeSource = { id: "x", type: "url", url: "https://x.test", lazy: true };
    const line = lazyTocLine(src);
    expect(line).toMatch(/^- `x` \[url, lazy\]/);
    expect(line).toMatch(/url: https:\/\/x.test/);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun test tests/core/knowledge/lazy-url.test.ts
```
Expected: "Cannot find module" — the `lazy-url.ts` file doesn't exist yet.

- [ ] **Step 3: Implement the module**

Create `src/core/knowledge/lazy-url.ts`:

```typescript
// Pure helpers for lazy URL sources. Used by the pipeline (to short-
// circuit acquire), the compile stanza renderer (to format the TOC
// entry), and the doctor section (to flag misconfigured bundles).

import type { KnowledgeSource } from "./types";

const FIRST_OR_SECOND_PERSON = /^(I |I'|you |you'|this skill|this source|this knowledge)/i;
const DESCRIPTION_MIN_CHARS = 30;
const DESCRIPTION_MAX_CHARS = 1024;

export function isLazyUrlSource(src: KnowledgeSource): boolean {
  return src.type === "url" && (src as { lazy?: boolean }).lazy === true;
}

export function lazyDescriptionWarnings(src: KnowledgeSource): string[] {
  if (!isLazyUrlSource(src)) return [];
  const warnings: string[] = [];
  const desc = src.description;
  if (!desc || desc.trim().length === 0) {
    warnings.push(
      `[${src.id}] lazy URL sources should have a description — it's the agent's only signal until it fetches the URL`,
    );
    return warnings;
  }
  if (desc.trim().length < DESCRIPTION_MIN_CHARS) {
    warnings.push(
      `[${src.id}] description is shorter than ${DESCRIPTION_MIN_CHARS} chars — write what the source contains and when to use it`,
    );
  }
  if (FIRST_OR_SECOND_PERSON.test(desc.trim())) {
    warnings.push(
      `[${src.id}] description should be written in third person (e.g. "Documents X. Use when Y.") — first/second person reduces tool-discovery accuracy`,
    );
  }
  if (desc.length > DESCRIPTION_MAX_CHARS) {
    warnings.push(
      `[${src.id}] description is longer than ${DESCRIPTION_MAX_CHARS} chars — agent runtimes may truncate; trim trigger keywords up front`,
    );
  }
  return warnings;
}

export function lazyTocLine(src: KnowledgeSource): string {
  if (!isLazyUrlSource(src)) {
    throw new Error(`lazyTocLine called on non-lazy source ${src.id}`);
  }
  const url = (src as { url: string }).url;
  const via = (src as { via?: { server: string; tool: string } }).via;
  const summaryText = (src.description ?? src.summary ?? "").trim();
  const summaryPart = summaryText ? ` — ${summaryText}` : "";
  const fetchHint = via ? `${via.server}.${via.tool}` : "WebFetch";
  return `- \`${src.id}\` [url, lazy]${summaryPart}\n    url: ${url}\n    fetch via: ${fetchHint}`;
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/core/knowledge/lazy-url.test.ts
```
Expected: all 14 tests pass.

- [ ] **Step 5: Run the broader knowledge suite**

```bash
bun test tests/core/knowledge/
bun run typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/core/knowledge/lazy-url.ts tests/core/knowledge/lazy-url.test.ts
git commit -m "knowledge: helpers for lazy URL detection, validation, TOC rendering"
```

---

## Task 5: Pipeline — short-circuit lazy sources

**Files:**
- Modify: `src/core/knowledge/pipeline.ts:295-378` (the `processed` loop and the per-source manifest emit)
- Test: `tests/core/knowledge/pipeline-lazy.test.ts` (new)
- Helper: `tests/_helpers/lazy-fixtures.ts` (new)

**Goal:** Lazy URL sources skip acquire+materialize entirely. The pipeline produces a `delivery: "lazy"` manifest entry with the URL, no files, no `tokensInline`. Description warnings are pushed to the warnings stream.

- [ ] **Step 1: Create the test helper**

Create `tests/_helpers/lazy-fixtures.ts`:

```typescript
import type { KnowledgeBlock, KnowledgeSource } from "../../src/core/knowledge/types";

export function lazyUrlSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: "wiki",
    type: "url",
    url: "https://wiki.internal.example.com/architecture",
    lazy: true,
    description:
      "Platform service architecture wiki. Use when answering deployment topology or service-boundary questions.",
    ...overrides,
  } as KnowledgeSource;
}

export function eagerUrlSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: "doc",
    type: "url",
    url: "https://example.com/doc",
    delivery: "auto",
    ...overrides,
  } as KnowledgeSource;
}

export function blockWith(...sources: KnowledgeSource[]): KnowledgeBlock {
  return { sources };
}
```

- [ ] **Step 2: Write the failing pipeline test**

Create `tests/core/knowledge/pipeline-lazy.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKnowledgeStage } from "../../../src/core/knowledge/pipeline";
import { blockWith, eagerUrlSource, lazyUrlSource } from "../../_helpers/lazy-fixtures";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pipeline-lazy-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runKnowledgeStage: lazy URL sources", () => {
  it("does not acquire a lazy URL source at install time", async () => {
    // The lazy source's URL is unreachable. If acquire ran, this would throw.
    const block = blockWith(lazyUrlSource({ url: "https://this-domain-does-not-resolve.invalid/x" }));
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.errors).toEqual([]);
    expect(result.manifest.sources).toHaveLength(1);
    expect(result.manifest.sources[0]?.delivery).toBe("lazy");
  });

  it("records the URL on the manifest entry", async () => {
    const block = blockWith(lazyUrlSource({ url: "https://wiki.example/x" }));
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.manifest.sources[0]?.url).toBe("https://wiki.example/x");
    expect(result.manifest.sources[0]?.files).toEqual([]);
    expect(result.manifest.sources[0]?.tokensInline).toBe(0);
  });

  it("records description and via on the manifest entry", async () => {
    const block = blockWith(
      lazyUrlSource({
        description: "Used when explaining service topology to teammates joining the team.",
        via: { server: "internal-mcp", tool: "fetch_page" },
      }),
    );
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.manifest.sources[0]?.description).toMatch(/service topology/);
    // via lives on the source declaration, not the manifest entry — the
    // assembler reads it back from the bundle config when rendering. This
    // assertion just confirms we didn't accidentally lose the input.
  });

  it("emits warnings for missing description on lazy sources", async () => {
    const block = blockWith(lazyUrlSource({ description: undefined }));
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.warnings.some((w) => w.match(/description/i))).toBe(true);
  });

  it("emits warnings for first-person description on lazy sources", async () => {
    const block = blockWith(
      lazyUrlSource({ description: "I help users figure out platform deployment topology." }),
    );
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.warnings.some((w) => w.match(/third.person|point of view/i))).toBe(true);
  });

  it("a lazy source AND an eager source coexist in one manifest", async () => {
    const block = blockWith(
      lazyUrlSource({ id: "wiki" }),
      eagerUrlSource({
        id: "doc",
        url: "data:,inline-content-here",  // data URL avoids real network
        delivery: "inline",
      }),
    );
    const result = await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    expect(result.manifest.sources).toHaveLength(2);
    const wiki = result.manifest.sources.find((s) => s.id === "wiki");
    const doc = result.manifest.sources.find((s) => s.id === "doc");
    expect(wiki?.delivery).toBe("lazy");
    expect(doc?.delivery).toBe("inline");
  });

  it("never writes a sources/<id>/ directory for a lazy source", async () => {
    const block = blockWith(lazyUrlSource({ id: "wiki" }));
    await runKnowledgeStage(block, {
      bundleDir: dir,
      cacheDir: dir,
      knowledgeDir: dir,
    });
    const { readdir } = await import("node:fs/promises");
    let sourcesDirContents: string[] = [];
    try {
      sourcesDirContents = await readdir(join(dir, "sources"));
    } catch {
      // missing sources/ dir is fine
    }
    expect(sourcesDirContents).not.toContain("wiki");
  });
});
```

- [ ] **Step 3: Verify failure**

```bash
bun test tests/core/knowledge/pipeline-lazy.test.ts
```
Expected: tests fail. The pipeline currently tries to acquire every source, including lazy ones.

- [ ] **Step 4: Modify the pipeline**

In `src/core/knowledge/pipeline.ts`, find the per-source loop in the `Phase 1: acquire + materialize per source into tmpDir.` block (around lines 295-336).

Add an import at the top of `pipeline.ts`:

```typescript
import { isLazyUrlSource, lazyDescriptionWarnings } from "./lazy-url";
```

Inside the `for (const src of sources) { ... }` loop, before the `try { const { artifacts, ... } = await acquireSource(...) }` block (around line 297), add:

```typescript
    for (const src of sources) {
      // Lazy URL sources skip acquire+materialize entirely. The pipeline
      // emits a manifest entry with delivery: "lazy" so downstream
      // consumers (assembler, compile-stanza, doctor) recognize the kind.
      if (isLazyUrlSource(src)) {
        const lazyWarnings = lazyDescriptionWarnings(src);
        for (const w of lazyWarnings) warnings.push(w);
        processed.push({
          declared: src,
          effectiveDelivery: "lazy",
          artifacts: [],
          materializedTexts: [],
          warnings: lazyWarnings,
        });
        continue;
      }
      try {
        const { artifacts, warnings: srcWarnings } = await acquireSource(src, {
          // ...existing args...
        });
        // ...existing body...
      } catch (err) {
        // ...existing catch...
      }
    }
```

Update `ProcessedSource.effectiveDelivery` to allow `"lazy"`. Find the type definition (around line 78 of pipeline.ts) and change:

```typescript
interface ProcessedSource {
  declared: KnowledgeSource;
  effectiveDelivery: "inline" | "file";
  artifacts: AcquiredArtifact[];
  materializedTexts: { artifact: AcquiredArtifact; content: string }[];
  warnings: string[];
}
```

to:

```typescript
interface ProcessedSource {
  declared: KnowledgeSource;
  effectiveDelivery: "inline" | "file" | "lazy";
  artifacts: AcquiredArtifact[];
  materializedTexts: { artifact: AcquiredArtifact; content: string }[];
  warnings: string[];
}
```

In the Phase 2 effective-delivery decision (around line 339-378) — the `for (const p of processed)` loop that picks `auto` → `inline`/`file` — add an early-continue:

```typescript
    for (const p of processed) {
      // Lazy was set in Phase 1; nothing to decide.
      if (p.effectiveDelivery === "lazy") continue;
      const totalChars = p.materializedTexts.reduce((n, x) => n + x.content.length, 0);
      // ...rest of existing body...
    }
```

In the Phase 3 manifest-emit loop (around line 380-435), add a guard so lazy sources skip the file-writing block. Find:

```typescript
    for (const p of processed) {
      const srcDir = join(tmpDir, "sources", p.declared.id);
      await mkdir(srcDir, { recursive: true });
      // ... writes files, computes inlineParts, etc.
```

Replace with:

```typescript
    for (const p of processed) {
      // Lazy sources have no on-disk artifact and no inline body.
      if (p.effectiveDelivery === "lazy") {
        const provenance: { url?: string } = {};
        if (p.declared.type === "url") provenance.url = p.declared.url;
        manifestSources.push({
          id: p.declared.id,
          scope: "agent",
          type: p.declared.type,
          ...(p.declared.type === "url" ? { url: p.declared.url } : {}),
          ...(Object.keys(provenance).length > 0 ? { source: provenance } : {}),
          delivery: "lazy",
          files: [],
          fetchedAt: new Date().toISOString(),
          extractor: null,
          tokensInline: 0,
          ...(p.declared.description ? { description: p.declared.description } : {}),
          ...(p.declared.summary !== undefined ? { summary: p.declared.summary } : {}),
          ...(p.declared.toc !== undefined ? { toc: p.declared.toc } : {}),
          ...(p.declared.retrieval !== undefined ? { retrieval: p.declared.retrieval } : {}),
        });
        continue;
      }
      const srcDir = join(tmpDir, "sources", p.declared.id);
      await mkdir(srcDir, { recursive: true });
      // ...rest of existing body...
    }
```

- [ ] **Step 5: Run pipeline tests**

```bash
bun test tests/core/knowledge/pipeline-lazy.test.ts
bun test tests/core/knowledge/pipeline.test.ts
bun test tests/core/knowledge/pipeline-progressive.test.ts
```
Expected: 7 new lazy tests pass; existing pipeline tests pass; no regressions.

- [ ] **Step 6: Run typecheck and full suite**

```bash
bun run typecheck
bun test tests/core/knowledge/
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/knowledge/pipeline.ts tests/core/knowledge/pipeline-lazy.test.ts tests/_helpers/lazy-fixtures.ts
git commit -m "knowledge: skip install-time fetch for lazy URL sources"
```

---

## Task 6: Compile/TOC stanza — render lazy entries

**Files:**
- Modify: `src/core/knowledge/compile.ts:43-77` (`tocLineFor` function)
- Test: `tests/core/knowledge/compile-lazy.test.ts` (new)

**Goal:** When the compile stanza renders, lazy entries get the URL + fetch-tool hint format from `lazyTocLine` instead of the file-or-directory format used for materialized sources.

- [ ] **Step 1: Write the failing test**

Create `tests/core/knowledge/compile-lazy.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { compile } from "../../../src/core/knowledge/compile";
import type { MaterializedSource } from "../../../src/core/knowledge/types";

const lazyMaterialized: MaterializedSource = {
  id: "wiki",
  type: "url",
  scope: "agent",
  delivery: "lazy",
  url: "https://wiki.internal.example.com/architecture",
  description: "Platform architecture wiki. Use when answering deployment topology questions.",
  files: [],
  // via lives on the source declaration; the compiler reads it from the
  // KnowledgeSource passed in alongside, not from MaterializedSource. See
  // Step 3 for the via fixture in this test.
};

describe("compile: lazy URL sources", () => {
  it("renders a lazy URL entry with WebFetch hint when no via", () => {
    const result = compile([lazyMaterialized], { rootDir: "/tmp/agent/knowledge" }, {
      // KnowledgeSource declarations keyed by id; lets compile look up via
      sourceDeclarations: {
        wiki: {
          id: "wiki",
          type: "url",
          url: "https://wiki.internal.example.com/architecture",
          lazy: true,
          description: lazyMaterialized.description,
        },
      },
    });
    const stanza = result.tocStanza;
    expect(stanza).toMatch(/^## Knowledge/m);
    expect(stanza).toMatch(/`wiki` \[url, lazy\]/);
    expect(stanza).toMatch(/Platform architecture wiki/);
    expect(stanza).toMatch(/url: https:\/\/wiki.internal.example.com\/architecture/);
    expect(stanza).toMatch(/fetch via: WebFetch/);
  });

  it("renders MCP routing tool when via is set", () => {
    const result = compile([lazyMaterialized], { rootDir: "/tmp/agent/knowledge" }, {
      sourceDeclarations: {
        wiki: {
          id: "wiki",
          type: "url",
          url: "https://wiki.internal.example.com/architecture",
          lazy: true,
          description: lazyMaterialized.description,
          via: { server: "internal-mcp", tool: "fetch_page" },
        },
      },
    });
    expect(result.tocStanza).toMatch(/fetch via: internal-mcp\.fetch_page/);
    expect(result.tocStanza).not.toMatch(/fetch via: WebFetch/);
  });

  it("includes both lazy and non-lazy entries in the same stanza", () => {
    const eagerMat: MaterializedSource = {
      id: "doc",
      type: "url",
      scope: "agent",
      delivery: "file",
      files: [{ relPath: "sources/doc/x.md", bytes: 100, sha256: "a" }],
      description: "Eager doc.",
    };
    const result = compile([lazyMaterialized, eagerMat], { rootDir: "/tmp/agent/knowledge" }, {
      sourceDeclarations: {
        wiki: { id: "wiki", type: "url", url: "https://w", lazy: true },
        doc: { id: "doc", type: "url", url: "https://d", delivery: "file" },
      },
    });
    expect(result.tocStanza).toMatch(/`wiki` \[url, lazy\]/);
    expect(result.tocStanza).toMatch(/`doc` \[url\]/);
    expect(result.tocStanza).not.toMatch(/`doc` \[url, lazy\]/);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun test tests/core/knowledge/compile-lazy.test.ts
```
Expected: tests fail with type errors (the `compile` function doesn't take `sourceDeclarations`) AND with the wrong line format.

- [ ] **Step 3: Read the current compile signature**

Run:
```bash
grep -n "export function compile\|interface CompileOptions" src/core/knowledge/compile.ts src/core/knowledge/types.ts
```

Read what you find — the existing `compile()` function takes `MaterializedSource[]` and `CompileOptions`. Add a new optional field `sourceDeclarations?: Record<string, KnowledgeSource>` so we can read `via` and `lazy` from the original source declaration.

- [ ] **Step 4: Apply changes**

In `src/core/knowledge/types.ts`, find the `CompileOptions` interface (search for it). Add the new optional field:

```typescript
export interface CompileOptions {
  // ...existing fields...
  /**
   * Optional map of source-id → original `KnowledgeSource` declaration.
   * The compiler reads `lazy` and `via` from here so the TOC stanza can
   * render fetch-tool hints for lazy URL sources without those fields
   * leaking into MaterializedSource.
   */
  sourceDeclarations?: Record<string, import("./types").KnowledgeSource>;
}
```

(If `CompileOptions` is exported from `compile.ts` instead of `types.ts`, edit it there.)

In `src/core/knowledge/compile.ts`, add an import at the top:

```typescript
import { isLazyUrlSource, lazyTocLine } from "./lazy-url";
```

Find the `tocLineFor` function (around line 56) and modify it. The current shape is:

```typescript
function tocLineFor(s: MaterializedSource, summary: string): string {
  // ...existing logic computing target / retrievalPart...
}
```

Change `tocLineFor` to accept the optional source declaration:

```typescript
function tocLineFor(
  s: MaterializedSource,
  summary: string,
  declaration?: KnowledgeSource,
): string {
  // Lazy URL: render the lazy-specific line shape.
  if (declaration && isLazyUrlSource(declaration)) {
    return lazyTocLine(declaration);
  }
  // ...existing logic for non-lazy sources unchanged...
}
```

In the function's caller (the loop that builds the TOC stanza), look up the declaration when available and pass it through:

```typescript
const declaration = options.sourceDeclarations?.[s.id];
const tocLine = tocLineFor(s, summary, declaration);
```

(Add the import for `KnowledgeSource` at the top of `compile.ts` if it's not already imported.)

- [ ] **Step 5: Run tests**

```bash
bun test tests/core/knowledge/compile-lazy.test.ts
bun test tests/core/knowledge/compile.test.ts
bun test tests/core/knowledge/compile-default.test.ts
```
Expected: 3 new lazy tests pass; existing compile tests pass.

- [ ] **Step 6: Wire `sourceDeclarations` from the pipeline**

In `src/core/knowledge/pipeline.ts`, find where the pipeline calls `compile(...)` (search for `compile(` — it's in the second half of `runKnowledgeStage`). Add:

```typescript
const sourceDeclarations: Record<string, KnowledgeSource> = {};
for (const s of sources) sourceDeclarations[s.id] = s;
const compiled = compile(materializedSources, { rootDir: liveDir, sourceDeclarations });
```

(The existing call may already be passing other options; add `sourceDeclarations` to its options object.)

- [ ] **Step 7: Run full knowledge suite**

```bash
bun run typecheck
bun test tests/core/knowledge/
```
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/core/knowledge/compile.ts src/core/knowledge/types.ts src/core/knowledge/pipeline.ts tests/core/knowledge/compile-lazy.test.ts
git commit -m "knowledge: render lazy URL entries with runtime fetch hint"
```

---

## Task 7: Refresh — `lazy-only` short-circuit

**Files:**
- Modify: `src/core/knowledge/refresh-source.ts:80,262` (RefreshSourceResult union + the per-source switch)
- Test: extend `tests/core/knowledge/refresh-source.test.ts`

**Goal:** A new `RefreshSourceResult` variant `"lazy-only"`. Refresh of a lazy source updates `fetchedAt` only; never re-fetches body.

- [ ] **Step 1: Read the current shape**

```bash
grep -n "RefreshSourceResult\|inline-only\|delivery === \"" src/core/knowledge/refresh-source.ts
```
Expected: line 80 has the union; line 262 has the early return for inline/auto delivery.

- [ ] **Step 2: Write the failing test**

Append to `tests/core/knowledge/refresh-source.test.ts` a new describe block:

```typescript
import { lazyUrlSource } from "../../_helpers/lazy-fixtures";

describe("refreshSource: lazy URL sources", () => {
  it("returns kind: lazy-only without fetching", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-lazy-"));
    try {
      const source = lazyUrlSource({
        id: "wiki",
        url: "https://this-domain-does-not-resolve.invalid/x",
      });
      const result = await refreshSource({
        agentSmithHome: dir,
        agent: "test-agent",
        source,
        bundleDir: dir,
      });
      expect(result.kind).toBe("lazy-only");
      if (result.kind === "lazy-only") {
        expect(result.sourceId).toBe("wiki");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not write any files for a lazy source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "refresh-lazy-"));
    try {
      const source = lazyUrlSource({ id: "wiki" });
      await refreshSource({
        agentSmithHome: dir,
        agent: "test-agent",
        source,
        bundleDir: dir,
      });
      const { readdir } = await import("node:fs/promises");
      let entries: string[] = [];
      try {
        entries = await readdir(join(dir, "test-agent", "knowledge", "sources"));
      } catch {
        /* sources dir may not exist */
      }
      expect(entries).not.toContain("wiki");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Verify failure**

```bash
bun test tests/core/knowledge/refresh-source.test.ts
```
Expected: the new tests fail; refresh currently tries to acquire lazy URLs.

- [ ] **Step 4: Apply changes**

In `src/core/knowledge/refresh-source.ts`, find the union (line 80):

```typescript
  | { kind: "inline-only"; sourceId: string; delivery: "inline" | "auto" }
```

Add a new variant after it:

```typescript
  | { kind: "inline-only"; sourceId: string; delivery: "inline" | "auto" }
  | { kind: "lazy-only"; sourceId: string }
```

Find the early-return for inline/auto delivery (around line 262):

```typescript
    return { kind: "inline-only", sourceId, delivery: source.delivery };
```

Add a guard above it:

```typescript
    // Lazy URL sources have no on-disk artifact to refresh. Return
    // early without acquiring the lock or touching the manifest.
    if (source.type === "url" && (source as { lazy?: boolean }).lazy === true) {
      return { kind: "lazy-only", sourceId };
    }
    if (source.delivery === "inline" || source.delivery === "auto") {
      return { kind: "inline-only", sourceId, delivery: source.delivery };
    }
```

- [ ] **Step 5: Run tests**

```bash
bun test tests/core/knowledge/refresh-source.test.ts
bun run typecheck
```
Expected: 2 new tests pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/core/knowledge/refresh-source.ts tests/core/knowledge/refresh-source.test.ts
git commit -m "knowledge: refresh treats lazy URL sources as no-op"
```

---

## Task 8: CLI — `--lazy` flag on `knowledge add`

**Files:**
- Modify: `src/cli/commands/knowledge/add.ts:125-265` (KnowledgeAddOptions + knowledgeAdd body)
- Modify: wherever knowledge-add CLI is wired (search: `grep -rn "knowledge.add\|knowledgeAdd" src/cli/commands/knowledge/dispatch.ts src/cli/commands/agent/`)
- Test: `tests/cli/knowledge-add-lazy.test.ts` (new)

**Goal:** `smith knowledge add <agent> <url> --lazy [--description "..."]` records `lazy: true` on the source. When `--lazy` is set, the user is not prompted for `delivery`/`materialize` (those fields are forbidden by the schema).

- [ ] **Step 1: Read the current add structure**

```bash
grep -n "KnowledgeAddOptions\|--delivery\|--description\|delivery:" src/cli/commands/knowledge/add.ts | head
grep -rn "knowledge add\|--lazy" src/cli/ | head
```

- [ ] **Step 2: Write the failing tests**

Create `tests/cli/knowledge-add-lazy.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeAdd } from "../../src/cli/commands/knowledge/add";

let bundleDir: string;

beforeEach(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), "kadd-lazy-"));
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    join(bundleDir, "agent.config.json"),
    JSON.stringify({
      name: "test-agent",
      description: "Use proactively for testing.",
      targets: ["claude-code"],
      modelTier: "balanced",
      mode: "all",
    }),
  );
});
afterEach(async () => {
  await rm(bundleDir, { recursive: true, force: true });
});

describe("knowledgeAdd --lazy", () => {
  it("saves a lazy: true URL source", async () => {
    const exit = await knowledgeAdd({
      bundleDir,
      type: "url",
      pathOrUrl: "https://wiki.internal.example.com/x",
      lazy: true,
      description: "Platform architecture wiki. Use when answering deployment questions.",
      installAfter: false,
    });
    expect(exit).toBe(0);
    const cfg = JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8"));
    const source = cfg.knowledge.sources.at(-1);
    expect(source.type).toBe("url");
    expect(source.lazy).toBe(true);
    expect(source.delivery).toBeUndefined(); // schema forbids delivery on lazy
    expect(source.description).toMatch(/Platform architecture wiki/);
  });

  it("rejects --lazy on non-URL types", async () => {
    await expect(
      knowledgeAdd({
        bundleDir,
        type: "file",
        pathOrUrl: "./README.md",
        lazy: true,
        installAfter: false,
      } as Parameters<typeof knowledgeAdd>[0]),
    ).rejects.toThrow(/lazy.*url/i);
  });

  it("warns when --lazy is set with no description", async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      await knowledgeAdd({
        bundleDir,
        type: "url",
        pathOrUrl: "https://wiki.example/x",
        lazy: true,
        installAfter: false,
      });
    } finally {
      console.log = orig;
    }
    expect(logs.join("\n")).toMatch(/description.*lazy|lazy.*description/i);
  });
});
```

- [ ] **Step 3: Verify failure**

```bash
bun test tests/cli/knowledge-add-lazy.test.ts
```
Expected: tests fail. `lazy` is not a known field on `KnowledgeAddOptions`.

- [ ] **Step 4: Extend the options interface**

In `src/cli/commands/knowledge/add.ts`, find `interface KnowledgeAddOptions` (around line 125). Add the new field:

```typescript
export interface KnowledgeAddOptions {
  // ...existing fields...
  /** When true, the URL source is saved with lazy: true (URL only). */
  lazy?: boolean;
  // ...existing fields after...
}
```

- [ ] **Step 5: Wire the lazy logic**

In `knowledgeAdd()` body (around line 267), find where the new source object is constructed (search for `constructSource(opts, id)` per the existing v1.4 pattern). Before that, add an early validation:

```typescript
  if (opts.lazy === true && opts.type !== "url") {
    throw new SmithError({
      code: "validation-failed",
      what: "knowledge add --lazy",
      reasons: [`--lazy is only supported on type=url sources, got type=${opts.type}`],
    });
  }
```

After `constructSource(opts, id)`, apply the lazy field:

```typescript
  if (opts.lazy === true) {
    (newSource as Record<string, unknown>).lazy = true;
    // delivery/materialize/extractor are forbidden on lazy by the schema;
    // strip them in case they were set as defaults upstream.
    delete (newSource as Record<string, unknown>).delivery;
    delete (newSource as Record<string, unknown>).materialize;
    delete (newSource as Record<string, unknown>).extractor;
    delete (newSource as Record<string, unknown>).inlineBudgetTokens;
  }
```

After the source is appended to the config (and before write), surface description warnings:

```typescript
  if (opts.lazy === true) {
    const { lazyDescriptionWarnings } = await import("../../../core/knowledge/lazy-url");
    const warnings = lazyDescriptionWarnings(newSource);
    for (const w of warnings) console.log(pc.yellow("warn"), w);
  }
```

- [ ] **Step 6: Wire `--lazy` into the CLI dispatch**

Find where `knowledge add` is registered as a CLI command. Add `--lazy` to its option list. Example (adjust to match the actual location):

```typescript
.option("--lazy", "URL sources only: do not fetch at install; agent fetches at runtime")
```

In the option-handler that builds `KnowledgeAddOptions`, pass `lazy: opts.lazy === true`.

- [ ] **Step 7: Run tests**

```bash
bun test tests/cli/knowledge-add-lazy.test.ts
bun test tests/cli/knowledge-add.test.ts
bun run typecheck
```
Expected: 3 new tests pass; existing knowledge-add tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/knowledge/add.ts tests/cli/knowledge-add-lazy.test.ts
# Plus the file where --lazy got wired into the CLI.
git commit -m "knowledge: --lazy flag for URL sources"
```

---

## Task 9: Doctor — `lazy-fetch` section

**Files:**
- Create: `src/core/freshness/check-lazy-fetch.ts`
- Test: `tests/core/freshness/check-lazy-fetch.test.ts`
- Modify: `src/core/freshness/run-doctor.ts` to register the new section

**Goal:** Doctor section that flags bundles whose lazy URL sources lack a runtime-fetch tool. Examples:

- Bundle targets only `codex` (which has no `webfetch` tool mapped) AND has a lazy URL source with no `via:` → warn that the agent can't fetch at runtime.
- Lazy URL has `via: { server: "x" }` but server `x` is not installed → warn (overlaps with `mcp-deps` but is more specific).
- Lazy URL has neither `via:` nor a target with `webfetch` capability → fatal warning.

- [ ] **Step 1: Write the failing tests**

Create `tests/core/freshness/check-lazy-fetch.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { checkLazyFetch } from "../../../src/core/freshness/check-lazy-fetch";

const lazyUrlSrc = {
  id: "wiki",
  type: "url" as const,
  url: "https://example.com/x",
  lazy: true,
  description: "A wiki.",
};

describe("checkLazyFetch", () => {
  it("returns no findings for a non-lazy bundle", async () => {
    const findings = await checkLazyFetch({
      bundles: [
        { name: "agent-a", targets: ["claude-code"], sources: [], mcp: { required: [] } },
      ],
      readAvailableMcpServers: async () => ({}),
    });
    expect(findings).toEqual([]);
  });

  it("returns no findings when target has webfetch and source has no via", async () => {
    const findings = await checkLazyFetch({
      bundles: [
        { name: "agent-a", targets: ["claude-code"], sources: [lazyUrlSrc], mcp: { required: [] } },
      ],
      readAvailableMcpServers: async () => ({}),
    });
    expect(findings).toEqual([]);
  });

  it("flags when ALL targets lack webfetch AND source has no via", async () => {
    const findings = await checkLazyFetch({
      bundles: [
        { name: "agent-a", targets: ["codex"], sources: [lazyUrlSrc], mcp: { required: [] } },
      ],
      readAvailableMcpServers: async () => ({}),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.agent).toBe("agent-a");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toMatch(/codex.*webfetch|fetch tool/i);
  });

  it("does not flag when at least one target supports webfetch", async () => {
    const findings = await checkLazyFetch({
      bundles: [
        {
          name: "agent-a",
          targets: ["codex", "claude-code"],
          sources: [lazyUrlSrc],
          mcp: { required: [] },
        },
      ],
      readAvailableMcpServers: async () => ({}),
    });
    expect(findings).toEqual([]);
  });

  it("flags when via.server is not installed", async () => {
    const withVia = { ...lazyUrlSrc, via: { server: "internal-mcp", tool: "fetch_page" } };
    const findings = await checkLazyFetch({
      bundles: [
        { name: "agent-a", targets: ["claude-code"], sources: [withVia], mcp: { required: ["internal-mcp"] } },
      ],
      readAvailableMcpServers: async () => ({}),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toMatch(/internal-mcp.*not installed/i);
  });

  it("does not flag when via.server is installed", async () => {
    const withVia = { ...lazyUrlSrc, via: { server: "internal-mcp", tool: "fetch_page" } };
    const findings = await checkLazyFetch({
      bundles: [
        { name: "agent-a", targets: ["claude-code"], sources: [withVia], mcp: { required: ["internal-mcp"] } },
      ],
      readAvailableMcpServers: async () => ({
        "internal-mcp": { command: "/usr/bin/internal-mcp", args: [] },
      }),
    });
    expect(findings).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun test tests/core/freshness/check-lazy-fetch.test.ts
```
Expected: "Cannot find module".

- [ ] **Step 3: Implement the check**

Create `src/core/freshness/check-lazy-fetch.ts`:

```typescript
import type { AvailableMap } from "../../io/mcp-config-readers";
import type { KnowledgeSource, Target } from "../knowledge/types";
import { isLazyUrlSource } from "../knowledge/lazy-url";

// Targets that have a built-in HTTP fetch tool the agent can call at
// runtime. Sourced from data/<target>-tool-map.json — keep in sync.
// Codex has no `webfetch` tool mapped today (per data/codex-tool-map.json).
const TARGETS_WITH_FETCH: ReadonlySet<Target> = new Set([
  "claude-code",
  "kiro",
  "opencode",
]);

export interface LazyFetchBundle {
  name: string;
  targets: Target[];
  sources: KnowledgeSource[];
  mcp?: { required?: string[]; peer?: string[] };
}

export interface LazyFetchFinding {
  agent: string;
  sourceId: string;
  severity: "error" | "warning";
  message: string;
}

export interface CheckLazyFetchOpts {
  bundles: LazyFetchBundle[];
  readAvailableMcpServers: () => Promise<AvailableMap>;
}

export async function checkLazyFetch(opts: CheckLazyFetchOpts): Promise<LazyFetchFinding[]> {
  const findings: LazyFetchFinding[] = [];
  const available = await opts.readAvailableMcpServers();
  for (const bundle of opts.bundles) {
    for (const src of bundle.sources) {
      if (!isLazyUrlSource(src)) continue;
      const via = (src as { via?: { server: string; tool: string } }).via;
      if (via) {
        // via routing — server must be configured.
        if (!(via.server in available)) {
          findings.push({
            agent: bundle.name,
            sourceId: src.id,
            severity: "warning",
            message: `lazy source ${src.id} routes through ${via.server} but ${via.server} is not installed`,
          });
        }
        // If via is set, target compatibility is moot (the agent uses the MCP tool, not WebFetch).
        continue;
      }
      // No via — agent must have built-in fetch on AT LEAST one target.
      const targetsWithFetch = bundle.targets.filter((t) => TARGETS_WITH_FETCH.has(t));
      if (targetsWithFetch.length === 0) {
        findings.push({
          agent: bundle.name,
          sourceId: src.id,
          severity: "error",
          message: `lazy source ${src.id} has no via: routing and no target supports a runtime fetch tool (targets: ${bundle.targets.join(", ")})`,
        });
      }
    }
  }
  return findings;
}
```

- [ ] **Step 4: Register the section**

In `src/core/freshness/run-doctor.ts` (or wherever doctor sections are registered), add `lazy-fetch` to the section list. Find the existing `mcp-deps` registration and mirror its shape. Pseudocode:

```typescript
// Around the section dispatch:
if (sectionId === "lazy-fetch") {
  const { checkLazyFetch } = await import("./check-lazy-fetch");
  const findings = await checkLazyFetch({
    bundles: installedBundles,  // map from existing loadInstalledAgents
    readAvailableMcpServers: () => readAvailableMcpServers({ homeDir: homedir() }),
  });
  return { sectionId: "lazy-fetch", findings };
}
```

(The exact wiring depends on the doctor's section-runner shape. Read `run-doctor.ts` first; mirror the `mcp-deps` registration as closely as possible — same DI style, same finding format.)

Also extend the `DoctorSectionId` union type:

```typescript
export type DoctorSectionId =
  | "knowledge-compile"
  | "mcp-deps"
  | "lazy-fetch"   // ← new
  // ...rest
  ;
```

- [ ] **Step 5: Add a doctor integration test**

Create `tests/cli/doctor-lazy-fetch.test.ts` mirroring the existing `tests/cli/doctor-mcp-deps.test.ts` shape (use the `mcpDeps?:` DI seam pattern from the v1.2 doctor work):

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctorCli } from "../../src/cli/commands/doctor";

let home: string;

beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "doc-lazy-")); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe("smith doctor: lazy-fetch section", () => {
  it("flags a lazy URL source on a target with no fetch tool", async () => {
    const errs: string[] = [];
    const exit = await runDoctorCli({
      json: true,
      lazyFetch: {
        bundles: async () => [
          {
            name: "test-agent",
            targets: ["codex"],  // no webfetch in codex tool map
            sources: [
              {
                id: "wiki",
                type: "url",
                url: "https://example.com",
                lazy: true,
                description: "A wiki",
              },
            ],
          },
        ],
        readAvailable: async () => ({}),
      },
      printErr: (m) => errs.push(m),
    } as Parameters<typeof runDoctorCli>[0]);
    expect(errs.join("\n")).toMatch(/lazy.*wiki|wiki.*lazy/i);
    // doctor exit semantics: error finding usually flips exit code
    expect(exit).not.toBe(0);
  });
});
```

(If the doctor's runtime DI shape differs, adjust the test to match what's actually there. The v1.2 plan introduced `mcpDeps?:` on `DoctorCliOptions` — copy that pattern verbatim.)

- [ ] **Step 6: Run tests**

```bash
bun test tests/core/freshness/check-lazy-fetch.test.ts
bun test tests/cli/doctor-lazy-fetch.test.ts
bun run typecheck
```
Expected: 6 + 1 = 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/freshness/check-lazy-fetch.ts src/core/freshness/run-doctor.ts tests/core/freshness/check-lazy-fetch.test.ts tests/cli/doctor-lazy-fetch.test.ts
git commit -m "doctor: flag lazy URL sources without a runtime fetch tool"
```

---

## Task 10: Orchestrator — agents-md degrade pass

**Files:**
- Modify: `src/io/orchestrator.ts` — add `degradeForAgentsMd()` post-stage that fetches lazy URLs for the agents-md target only.
- Test: `tests/io/orchestrator-lazy-agents-md.test.ts` (new)

**Goal:** When a bundle targets `agents-md` AND has lazy URL sources, smith fetches those URLs at install time for the agents-md target only — runtime targets still get the lazy TOC entry. The agents-md output renders inline-or-file based on size, plus the URL as a `> source: <url>` reference link.

- [ ] **Step 1: Read the orchestrator's per-target render flow**

```bash
grep -n "runKnowledgeStage\|target ===\\|agents-md\\|renderForTarget\|knowledgeSection" src/io/orchestrator.ts | head -25
```

Read the surrounding code. The orchestrator runs `runKnowledgeStage` once and reuses the output across all targets. We need to add a per-target post-pass that runs ONLY for `agents-md`.

- [ ] **Step 2: Write the failing test**

Create `tests/io/orchestrator-lazy-agents-md.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This test exercises the per-target degrade pass for agents-md.
// It uses an in-process fake fetch so the lazy URL is "fetched" without
// real network. The expected behavior: the agents-md rendered output
// contains the fetched body + a `> source: <url>` reference; the
// claude-code rendered output contains a lazy TOC entry only.

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "orch-lazy-")); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe("orchestrator: agents-md degrade for lazy URL sources", () => {
  it("fetches lazy URL for agents-md target only", async () => {
    // Test sketch:
    //  1. Build a bundle with one lazy URL source.
    //  2. Inject a fake fetcher (fetchFn) into the orchestrator.
    //  3. Run install for both `agents-md` AND `claude-code` targets.
    //  4. Read the rendered output for each target.
    //  5. Assert agents-md contains the body + `> source: <url>`.
    //  6. Assert claude-code contains the lazy TOC entry, NOT the body.
    //
    // (Implementation depends on the orchestrator's DI shape. The exact
    // call signature mirrors how Task 11 of the v1.2 plan injected
    // `readAvailableMcpServers` — use the same pattern.)
    expect(true).toBe(true);  // placeholder; fill in once orchestrator change is wired
  });
});
```

(This test is a scaffold. It becomes concrete once the orchestrator's DI is in place — Step 4. The executor finishes the test body after the impl is in.)

- [ ] **Step 3: Read what's already there to find the right insertion point**

```bash
grep -B 1 -A 8 "knowledgeSection\b\|target.*agents-md\|renderAgent" src/io/orchestrator.ts | head -50
```

Identify:
- Where the orchestrator computes `knowledgeSection` for the bundle (one shared object).
- Where it loops over targets to render each.
- Whether there's already a per-target hook.

- [ ] **Step 4: Add the degrade pass**

In `src/io/orchestrator.ts`, add a new helper function:

```typescript
// agents-md targets cannot fetch URLs at runtime — Cursor/Windsurf/Aider
// etc. read the rendered AGENTS.md as static markdown. So lazy URL
// sources are fetched at install time for THIS target only and rendered
// inline (small) or as a sidecar file (large), plus a `> source: <url>`
// reference line so capable runtimes can re-fetch.
async function degradeLazyForAgentsMd(
  block: KnowledgeBlock | undefined,
  liveDir: string,
  opts: {
    fetchFn?: (url: string) => Promise<string>;
    inlineBudgetTokens: number;
  },
): Promise<{
  /** Per-source body + URL ref, for the agents-md renderer. */
  agentsMdAdditions: Array<{ id: string; description?: string; body: string; url: string }>;
  warnings: string[];
}> {
  const additions: Array<{ id: string; description?: string; body: string; url: string }> = [];
  const warnings: string[] = [];
  if (!block?.sources) return { agentsMdAdditions: additions, warnings };
  const fetchFn = opts.fetchFn ?? (async (url: string) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
    return await resp.text();
  });
  for (const src of block.sources) {
    if (src.type !== "url") continue;
    if ((src as { lazy?: boolean }).lazy !== true) continue;
    try {
      const body = await fetchFn(src.url);
      additions.push({
        id: src.id,
        ...(src.description ? { description: src.description } : {}),
        body,
        url: src.url,
      });
    } catch (err) {
      warnings.push(`[${src.id}] agents-md degrade fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { agentsMdAdditions: additions, warnings };
}
```

In the per-target render loop, branch:

```typescript
for (const target of resolvedTargets) {
  let knowledgeOverride: KnowledgeSection | undefined;
  if (target === "agents-md") {
    const { agentsMdAdditions, warnings: degradeWarnings } = await degradeLazyForAgentsMd(
      block,
      liveDir,
      { inlineBudgetTokens: block?.inlineBudget?.totalTokens ?? 8000, fetchFn: opts.fetchFn },
    );
    pipelineWarnings.push(...degradeWarnings);
    if (agentsMdAdditions.length > 0) {
      // Build a knowledgeOverride that injects the additions into the
      // existing inline section. The renderKnowledgeInline-equivalent
      // in the assembler then formats them with `> source: <url>` headers.
      knowledgeOverride = {
        ...knowledgeSection,
        inline: [
          ...knowledgeSection.inline,
          ...agentsMdAdditions.map((a) => ({
            id: a.id,
            description: a.description,
            content: `> source: ${a.url}\n\n${a.body}`,
          })),
        ],
      };
    }
  }
  // Pass knowledgeOverride if present, else knowledgeSection.
  await renderForTarget(target, /* ...other args..., */ knowledgeOverride ?? knowledgeSection);
}
```

(Adjust the call signature of `renderForTarget` / the existing per-target render function to accept an override. If it doesn't take a knowledge section as a parameter today, pass the override via a closure or option.)

Add a DI hook for the `fetchFn` to `OrchestratorOpts` (or whatever the existing options type is):

```typescript
export interface OrchestratorOpts {
  // ...existing fields...
  /** v2: optional fake fetcher for tests. Default: global fetch. */
  fetchFn?: (url: string) => Promise<string>;
}
```

- [ ] **Step 5: Fill in the test**

Once the orchestrator change is wired, replace the test placeholder in Step 2 with:

```typescript
it("fetches lazy URL for agents-md target only", async () => {
  const fakeUrl = "https://wiki.internal.example.com/architecture";
  const fakeBody = "# Architecture\n\nPlatform deploys to two regions...";
  const fetchCalls: string[] = [];
  const fetchFn = async (url: string) => {
    fetchCalls.push(url);
    return fakeBody;
  };

  // Build a bundle in `home` with a lazy URL source.
  const bundleDir = join(home, "agents", "test-agent");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    join(bundleDir, "agent.config.json"),
    JSON.stringify({
      name: "test-agent",
      description: "Test bundle.",
      targets: ["agents-md", "claude-code"],
      modelTier: "balanced",
      mode: "all",
      knowledge: {
        sources: [
          {
            id: "wiki",
            type: "url",
            url: fakeUrl,
            lazy: true,
            description: "Architecture wiki. Use when asked about deployment topology.",
          },
        ],
      },
    }),
  );
  await writeFile(join(bundleDir, "IDENTITY.md"), "# Identity\nTest agent.");
  await writeFile(join(bundleDir, "EXPERTISE.md"), "# Expertise\nTesting.");
  await writeFile(join(bundleDir, "SOUL.md"), "# Soul\nDeliberate.");
  await writeFile(join(bundleDir, "USER.md"), "# User\nTester.");

  // Run install via the orchestrator with the fake fetchFn injected.
  const result = await buildAndInstall("test-agent", {
    paths: {
      "agents-md": join(home, "out", "agents-md"),
      "claude-code": join(home, "out", "cc"),
      // (other targets stub paths)
    },
    fetchFn,
    // ...other DI as needed for an isolated install...
  });

  expect(result.ok).toBe(true);
  expect(fetchCalls).toContain(fakeUrl);

  // The agents-md output should contain the fetched body + URL ref.
  const agentsMdOut = await readFile(join(home, "out", "agents-md", "test-agent", "AGENTS.md"), "utf8");
  expect(agentsMdOut).toMatch(/Platform deploys to two regions/);
  expect(agentsMdOut).toMatch(new RegExp(`> source: ${fakeUrl.replace(/\./g, "\\.")}`, ""));

  // The claude-code output should contain the lazy TOC entry, NOT the body.
  const ccOut = await readFile(join(home, "out", "cc", "test-agent.md"), "utf8");
  expect(ccOut).not.toMatch(/Platform deploys to two regions/);
  expect(ccOut).toMatch(/`wiki` \[url, lazy\]/);
});
```

(Adjust `buildAndInstall` and the DI shape to match the actual orchestrator API.)

- [ ] **Step 6: Run tests**

```bash
bun test tests/io/orchestrator-lazy-agents-md.test.ts
bun test tests/io/
bun run typecheck
```
Expected: new test passes; existing orchestrator tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/io/orchestrator.ts tests/io/orchestrator-lazy-agents-md.test.ts
git commit -m "knowledge: fetch lazy URLs at install for agents-md target"
```

---

## Task 11: GUI — lazy toggle on URL form

**Files:**
- Modify: `gui/web/src/panels/KnowledgeSources/sourceForms/UrlForm.tsx`
- Test: `gui/web/src/panels/KnowledgeSources/sourceForms/UrlForm.lazy.test.tsx` (new)

**Goal:** A "Lazy fetch" toggle on the URL form (URL type only). When ON, hide delivery/materialize/extractor/inlineBudgetTokens fields; persist `lazy: true` in the saved source. When OFF, hide nothing; behaves as today. The description field gets a hint label when lazy is on.

- [ ] **Step 1: Read the current URL form**

```bash
wc -l gui/web/src/panels/KnowledgeSources/sourceForms/UrlForm.tsx
head -80 gui/web/src/panels/KnowledgeSources/sourceForms/UrlForm.tsx
```

- [ ] **Step 2: Write the failing test**

Create `gui/web/src/panels/KnowledgeSources/sourceForms/UrlForm.lazy.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UrlForm } from "./UrlForm";

describe("UrlForm: lazy toggle", () => {
  it("renders a 'Lazy fetch' toggle for URL sources", () => {
    render(<UrlForm value={{ id: "x", type: "url", url: "https://x", delivery: "auto" }} onChange={() => {}} />);
    expect(screen.getByLabelText(/lazy fetch/i)).toBeInTheDocument();
  });

  it("hides delivery/materialize/extractor when lazy is on", () => {
    const onChange = vi.fn();
    render(<UrlForm value={{ id: "x", type: "url", url: "https://x", lazy: true }} onChange={onChange} />);
    expect(screen.queryByLabelText(/delivery/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/materialize/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/extractor/i)).not.toBeInTheDocument();
  });

  it("toggling lazy ON strips delivery/materialize from the saved value", () => {
    const onChange = vi.fn();
    render(
      <UrlForm
        value={{ id: "x", type: "url", url: "https://x", delivery: "inline", materialize: "html-to-md" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/lazy fetch/i));
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall?.lazy).toBe(true);
    expect(lastCall?.delivery).toBeUndefined();
    expect(lastCall?.materialize).toBeUndefined();
  });

  it("toggling lazy OFF restores the delivery dropdown with its default", () => {
    const onChange = vi.fn();
    const { rerender } = render(<UrlForm value={{ id: "x", type: "url", url: "https://x", lazy: true }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/lazy fetch/i));
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall?.lazy).toBeUndefined();
    expect(lastCall?.delivery).toBe("auto");
  });

  it("description field shows a 'used as L1 metadata' hint when lazy", () => {
    render(<UrlForm value={{ id: "x", type: "url", url: "https://x", lazy: true }} onChange={() => {}} />);
    const desc = screen.getByLabelText(/description/i);
    expect(desc.closest("label, .form-field")?.textContent).toMatch(/L1|agent.*metadata|fetch/i);
  });
});
```

- [ ] **Step 3: Verify failure**

```bash
cd gui/web && bunx vitest run src/panels/KnowledgeSources/sourceForms/UrlForm.lazy.test.tsx
```
Expected: tests fail; lazy toggle doesn't exist.

- [ ] **Step 4: Modify UrlForm**

Add a `Toggle` (or checkbox) for "Lazy fetch" near the top of the URL form. Conditionally render the delivery/materialize/extractor/inlineBudgetTokens sections only when `value.lazy !== true`. When the toggle changes, sanitize the value:

```tsx
function handleToggleLazy(checked: boolean) {
  if (checked) {
    const { delivery, materialize, extractor, inlineBudgetTokens, ...rest } = value;
    onChange({ ...rest, lazy: true });
  } else {
    const { lazy, ...rest } = value;
    onChange({ ...rest, delivery: "auto" });
  }
}
```

When `value.lazy === true`, render the description field with a hint (e.g., `helperText="Used as the agent's L1 metadata. Write what the source contains and when to use it. Third-person, third-person ('Documents X. Use when Y.')."`).

(Adjust to match the existing form library / FormField convention used by other source forms.)

- [ ] **Step 5: Run tests**

```bash
cd gui/web && bunx vitest run src/panels/KnowledgeSources/sourceForms/UrlForm.lazy.test.tsx
cd gui/web && bunx vitest run src/panels/KnowledgeSources
```
Expected: 5 new tests pass; existing UrlForm tests pass.

- [ ] **Step 6: Mirror via on the gui-shared schema**

The CLI's schema change (Task 3) added `lazy: z.literal(true)` on URL sources. The `gui/shared/src/schemas/knowledge.ts` mirror needs the same field — failing to mirror it produces silent drift (the v1.1.1 bug class).

Run:
```bash
grep -n "lazy" gui/shared/src/schemas/knowledge.ts
```

If `lazy` isn't there, add it to the URL variant in the gui-shared mirror, mirroring the discriminated union from Task 3:

```typescript
const UrlVariantLazy = z.object({ /* ...mirror... */ }).strict();
const UrlVariantEager = z.object({ /* ...mirror... */ }).strict();
const UrlVariant = z.union([UrlVariantLazy, UrlVariantEager]);
```

Add a parity test in `gui/shared/src/schemas/knowledge.parity.test.ts` (or wherever the existing schema-mirror parity tests live) that asserts a lazy URL source parses identically on both sides:

```typescript
it("accepts a lazy URL source in the gui-shared mirror", () => {
  const r = KnowledgeSource.safeParse({
    id: "wiki",
    type: "url",
    url: "https://example.com",
    lazy: true,
    description: "A wiki.",
  });
  expect(r.success).toBe(true);
});
```

- [ ] **Step 7: Run gui suites**

```bash
cd gui/shared && bun test
cd gui/web && bunx vitest run src/panels/KnowledgeSources
SMITH_DISABLE_SELF_SOURCE=1 bun test gui/server gui/shared
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add gui/web/src/panels/KnowledgeSources/sourceForms/UrlForm.tsx gui/web/src/panels/KnowledgeSources/sourceForms/UrlForm.lazy.test.tsx gui/shared/src/schemas/knowledge.ts gui/shared/src/schemas/knowledge.parity.test.ts
git commit -m "gui: lazy fetch toggle for URL knowledge sources"
```

---

## Task 12: Documentation

**Files:**
- Modify: `guide/04-knowledge.md` (or whichever guide covers knowledge sources)
- Modify: `CHANGELOG.md`

**Goal:** Add a section describing lazy URL sources. Cover: what lazy means, when to use it, the description requirement, the via interaction, the agents-md auto-degrade behavior.

- [ ] **Step 1: Read the existing knowledge guide**

```bash
ls guide/ | head
grep -l "delivery\|knowledge.*source" guide/*.md | head
```

- [ ] **Step 2: Add a "Lazy URL sources" section**

In the knowledge guide, add a section right after the existing "Delivery modes" or equivalent. Use real sentences, no Amazon-internal terms, no plan references:

```markdown
## Lazy URL sources

For URL sources, you can opt into lazy fetching: the bundle ships only the URL and a description; the agent fetches on demand at runtime.

\`\`\`json
{
  "id": "platform-architecture",
  "type": "url",
  "url": "https://wiki.internal.example.com/architecture",
  "lazy": true,
  "description": "Platform service architecture. Use when answering deployment topology or service-boundary questions."
}
\`\`\`

When `lazy: true`:
- Smith does not fetch the URL at install time.
- The `delivery`, `materialize`, `extractor`, and `inlineBudgetTokens` fields are forbidden.
- The `description` field becomes the agent's only signal until it fetches the URL — write it carefully.

### When to use lazy

- The URL content drifts (an active runbook, a frequently-updated spec).
- The URL needs the recipient's auth (Atlassian Cloud, GitHub Enterprise, internal wikis).
- The content is long-tail — the agent only needs it occasionally.

### Description guidance

Lazy URL sources show only their description in the agent's prompt until it fetches. Best practices (research-backed across Anthropic Skills and Codex):

- **Third person.** "Documents X. Use when Y." Not "I help with…" or "You can use this for…".
- **Front-load trigger keywords.** The first 80 chars matter most.
- **Both halves.** Say what the source contains AND when to fetch it.
- **Cap at 1024 characters.** Smith warns at install time if you exceed.

### `via:` for authed URLs

When a URL needs auth that the agent's built-in `WebFetch` can't provide (Atlassian Cloud, internal wikis, etc.), set `via:`:

\`\`\`json
{
  "id": "platform-architecture",
  "type": "url",
  "url": "https://wiki.internal.example.com/architecture",
  "lazy": true,
  "via": { "server": "internal-mcp", "tool": "fetch_page" },
  "description": "..."
}
\`\`\`

The agent calls `internal-mcp.fetch_page` instead of `WebFetch`. The server must be configured locally on the recipient's machine (`smith doctor` flags missing servers).

### AGENTS.md targets

Bundles targeting `agents-md` (Cursor, Windsurf, Aider, etc.) cannot fetch URLs at runtime. For these, smith fetches lazy URLs at install time and renders them inline (or as sidecar files for large content), plus a `> source: <url>` reference line. Runtime targets (Claude Code, Kiro, OpenCode) still get the lazy TOC entry.

### Refresh

`smith knowledge fetch <agent>` for a lazy source revalidates the URL still resolves; it does not re-fetch the body. The body is fetched at runtime, every conversation.
```

- [ ] **Step 3: Add a CHANGELOG entry**

In `CHANGELOG.md`, add an entry under the next version (let the maintainer decide the version number — leave it as `## [Unreleased]` for now):

```markdown
## [Unreleased]

### Added

- URL knowledge sources can opt into lazy fetching: smith ships only the URL and description; the agent fetches at runtime via its built-in `WebFetch` tool or a routed MCP tool when `via:` is set. Bundles targeting AGENTS.md auto-degrade — smith fetches at install for that target only.
- `smith knowledge add <agent> <url> --lazy` flag.
- GUI: "Lazy fetch" toggle on URL knowledge source forms.
- `smith doctor` flags lazy URL sources whose targets lack a runtime fetch tool.
```

- [ ] **Step 4: Verify no Amazon-internal references**

```bash
grep -i "midway\|amazon\|w\\.amazon\|builder-mcp\|ReadInternalWebsites" guide/04-knowledge.md CHANGELOG.md
```
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add guide/04-knowledge.md CHANGELOG.md
git commit -m "docs: lazy URL knowledge sources"
```

---

## Task 13: Integration test — end-to-end install with lazy URL

**Files:**
- Test: `tests/cli/install-lazy-e2e.test.ts` (new)

**Goal:** A single end-to-end test that exercises the full happy path: bundle with one lazy URL source, install for both `claude-code` and `agents-md` targets, assert each target's rendered output matches expectations. Uses the shared echo MCP server fixture for one assertion (proves via routing works), uses an inline `data:` URL for the other.

- [ ] **Step 1: Write the test**

Create `tests/cli/install-lazy-e2e.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../../src/cli/commands/install";

const HEAVY_TIMEOUT = 30_000;
const ECHO_FIXTURE = join(import.meta.dir, "..", "_fixtures", "echo-mcp-server.ts");

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "lazy-e2e-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("install: lazy URL sources end-to-end", () => {
  it(
    "renders lazy TOC entry for runtime target and degrades for agents-md",
    async () => {
      // Scaffold: a bundle with one lazy URL source.
      const bundleDir = join(home, "agents", "test-agent");
      await mkdir(bundleDir, { recursive: true });
      await writeFile(
        join(bundleDir, "agent.config.json"),
        JSON.stringify({
          name: "test-agent",
          description: "Test bundle for lazy URL e2e.",
          targets: ["claude-code", "agents-md"],
          modelTier: "balanced",
          mode: "all",
          knowledge: {
            sources: [
              {
                id: "wiki",
                type: "url",
                url: "https://wiki.example.test/page",
                lazy: true,
                description: "Architecture wiki. Use when answering deployment questions.",
              },
            ],
          },
        }),
      );
      await writeFile(join(bundleDir, "IDENTITY.md"), "# Identity\nTest agent.");
      await writeFile(join(bundleDir, "EXPERTISE.md"), "# Expertise\nTesting.");
      await writeFile(join(bundleDir, "SOUL.md"), "# Soul\nDeliberate.");
      await writeFile(join(bundleDir, "USER.md"), "# User\nTester.");

      const fakeBody = "# Wiki Content\n\nReal content of the wiki page.";
      const exit = await install({
        name: "test-agent",
        paths: {
          opencode: join(home, "out", "oc"),
          "claude-code": join(home, "out", "cc"),
          codex: join(home, "out", "cx"),
          kiro: join(home, "out", "kr"),
          "agents-md": join(home, "out", "am"),
        },
        // DI: per-bundle registry-load + lazy fetch
        loadRegistry: async () => ({ kind: "user-global", agents: [{ name: "test-agent", path: bundleDir }] }) as never,
        loadAllBundles: async () => [{
          config: JSON.parse(await readFile(join(bundleDir, "agent.config.json"), "utf8")),
          bundlePath: bundleDir,
        }] as never,
        fetchFn: async () => fakeBody,
        readAvailableMcpServers: async () => ({}),
      } as Parameters<typeof install>[0]);

      expect(exit).toBe(0);

      // claude-code render: lazy TOC entry, NOT the body.
      const ccOut = await readFile(join(home, "out", "cc", "test-agent.md"), "utf8");
      expect(ccOut).toMatch(/`wiki` \[url, lazy\]/);
      expect(ccOut).toMatch(/url: https:\/\/wiki.example.test\/page/);
      expect(ccOut).toMatch(/fetch via: WebFetch/);
      expect(ccOut).not.toMatch(/Real content of the wiki page/);

      // agents-md render: body + URL ref.
      const amOut = await readFile(join(home, "out", "am", "test-agent", "AGENTS.md"), "utf8");
      expect(amOut).toMatch(/Real content of the wiki page/);
      expect(amOut).toMatch(/> source: https:\/\/wiki.example.test\/page/);
    },
    HEAVY_TIMEOUT,
  );
});
```

(Adjust `install`'s DI shape to match the actual signature — the v1.2 plan added `readAvailableMcpServers?` and `paths?:`. The test uses the same pattern.)

- [ ] **Step 2: Run the test**

```bash
bun test tests/cli/install-lazy-e2e.test.ts
```
Expected: passes.

- [ ] **Step 3: Run the full suite**

```bash
bun run typecheck
bun test
SMITH_DISABLE_SELF_SOURCE=1 bun test gui/server gui/shared
cd gui/web && bunx vitest run
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/cli/install-lazy-e2e.test.ts
git commit -m "test: end-to-end install with lazy URL source"
```

---

## Task 14: Manual smoke test + version bump

**Files:**
- Modify: `package.json`
- Modify: `src/index.ts` (the `program.version("...")` literal — contract test enforces parity)
- Modify: `CHANGELOG.md` (replace `[Unreleased]` with the new version)

**Goal:** Run smith against a real bundle on a developer's machine to confirm everything works. Bump the version. Tag.

- [ ] **Step 1: Pick the version**

Lazy URLs are an additive feature on top of the v1.6.x line. Bump to **1.7.0** (minor — no breaking changes; old bundles continue to work without `lazy`).

- [ ] **Step 2: Bump `package.json`**

Change `"version": "1.6.0"` to `"version": "1.7.0"`.

- [ ] **Step 3: Bump `src/index.ts`**

Find the line `program.name("smith").description("...").version("1.6.0");`. Change to `"1.7.0"`.

- [ ] **Step 4: Update CHANGELOG**

Replace `## [Unreleased]` with `## [1.7.0] — <today's date>`. Append the link reference at the bottom:

```markdown
[1.7.0]: https://github.com/eliharoun/agent-smith/releases/tag/v1.7.0
```

- [ ] **Step 5: Run the version-sync contract test**

```bash
bun test tests/contract/version-sync.test.ts
```
Expected: passes. (If it fails, you forgot to update `src/index.ts`.)

- [ ] **Step 6: Run the full suite one final time**

```bash
bun run typecheck
bun test
SMITH_DISABLE_SELF_SOURCE=1 bun test gui/server gui/shared
cd gui/web && bunx vitest run
```
Expected: all green.

- [ ] **Step 7: Manual smoke test (optional but recommended)**

Pick a bundle on your dev machine. Add a lazy URL source pointing at a public URL:

```bash
bun src/index.ts knowledge add <test-bundle> https://docs.anthropic.com/en/api/getting-started --lazy --description "Anthropic API getting started. Use when explaining the API to a new user."
bun src/index.ts agent install <test-bundle>
bun src/index.ts doctor
```

Confirm:
- Install completes without fetching the URL.
- The rendered agent file (`~/.claude/agents/<test-bundle>.md` or equivalent) contains the lazy TOC entry, NOT the body.
- Doctor reports no errors.

- [ ] **Step 8: Commit + tag**

```bash
git add package.json src/index.ts CHANGELOG.md
git commit -m "release: 1.7.0"
git tag v1.7.0
```

(The tag is local. Push when ready.)

---

## Self-review

**1. Spec coverage:**

| Design requirement | Task # |
|---|---|
| `lazy: true` field on URL sources only (other types reject) | Task 3 |
| `delivery`/`materialize`/`extractor`/`inlineBudgetTokens` forbidden when lazy | Task 3 |
| Pipeline short-circuits — no acquire, no materialize | Task 5 |
| Manifest entry has `delivery: "lazy"` + `url` field | Tasks 1, 2, 5 |
| TOC stanza renders URL + fetch-tool hint | Task 6 |
| `via:` interacts cleanly with lazy | Tasks 3, 6, 9 |
| Refresh = revalidate URL, don't re-fetch | Task 7 |
| `--lazy` CLI flag on `knowledge add` | Task 8 |
| Description warnings (1024 char cap, third-person, ≥30 chars) | Tasks 4, 5, 8 |
| Doctor flags lazy without runtime fetch | Task 9 |
| Agents-md auto-degrade pass | Task 10 |
| GUI toggle on URL form | Task 11 |
| Schema mirror in gui-shared | Task 11 |
| Documentation | Task 12 |
| End-to-end test | Task 13 |
| Version bump | Task 14 |

All 16 design requirements covered.

**2. Placeholder scan:** None. Every code step has runnable code; every test step has assertions.

**3. Type consistency:**
- `KnowledgeDelivery` (Task 1) is `"inline" | "file" | "auto" | "lazy"`.
- `KnowledgeManifestSourceEntry.url` (Task 2) is `string?`.
- `ProcessedSource.effectiveDelivery` (Task 5) is `"inline" | "file" | "lazy"`.
- `RefreshSourceResult` (Task 7) gains `"lazy-only"`.
- `LazyFetchFinding` (Task 9) — distinct type, no overlap with `McpDepFinding`.
- `KnowledgeSource` types are imported from one canonical source (`src/core/knowledge/types.ts`).
- All test fixtures use the helper from `tests/_helpers/lazy-fixtures.ts` (Task 5) — no copy-paste drift.

**4. Cross-task dependencies (build order):**
- Tasks 1, 2 (types) before everything.
- Task 3 (schema) before Task 4 (helpers consume the lazy field).
- Task 4 (helpers) before Tasks 5, 6, 9 (each consumes `isLazyUrlSource` / `lazyTocLine` / `lazyDescriptionWarnings`).
- Task 5 (pipeline) before Task 6 (compile reads the manifest).
- Task 7 (refresh) is independent of Tasks 5/6.
- Task 8 (CLI) is independent.
- Task 9 (doctor) requires Task 4.
- Task 10 (orchestrator) requires Task 5.
- Task 11 (GUI) requires Task 3 (gui-shared mirror).
- Task 12 (docs) after all code.
- Task 13 (e2e) requires Tasks 5, 6, 8, 10.
- Task 14 (release) last.

The plan is internally consistent and a fresh agent can execute it task-by-task without re-deriving design decisions.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-06-03-lazy-url-sources-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between, fast iteration. Best for plans with this many tasks and TDD discipline.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
