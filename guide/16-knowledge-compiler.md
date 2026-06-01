# Knowledge compiler

> The v2 knowledge pipeline turns a bundle's `knowledge.sources` block into a tight table-of-contents stanza in the rendered prompt plus on-disk sidecar files the agent reads on demand. This spoke covers the `compile` block, the `agents-md` install target, the optional BM25 retrieval server (`smith knowledge serve`), and the APM importer (`smith agent init --from-apm`). Read this when you're enabling progressive disclosure on an existing bundle, deciding whether to emit AGENTS.md, or wiring the retrieval MCP server.

> **Status.** v2 ships alongside v1 — bundles without a `compile` block render byte-identically to before. The architecture and rationale live in `docs/plans/2026-05-31-knowledge-compiler-v2-design.md`; this spoke is operational reference, not design narrative.

---

## Why progressive disclosure

The v1 default was: materialize every source, concatenate the bytes into the prompt body up to an 8000-token budget, silently drop anything that didn't fit. That works for short style guides and one-page rubrics; it fails badly for a Confluence space, a 50k-line repo, or a multi-page Jira query — what gets dropped is invisible at the prompt site, and the model has to grep blindly through what survives.

The cross-tool consensus has moved on. The Linux Foundation's AGENTS.md spec (~28+ runtimes, ~60k repos as of 2026-05-31) and Anthropic's `code-execution-with-mcp` work converged on the same shape: a structured pointer index in the system prompt, plus on-demand fetch when the agent needs the bytes. Anthropic measured 150K → 2K token reductions; Augment's 2,500-repo study found AGENTS.md-listed files are read ~100% of the time vs. <10% for orphan files.

`smith knowledge` v2 implements that pattern as a **compile stage** that runs after the existing `materialize` stage. Bundles opt in by adding a `compile` block. Materialization, sidecar emission, and refresh hooks are unchanged; the new stage rewrites the prompt body's `## Knowledge` section as a TOC and lets the agent fetch on demand.

---

## The `compile` block

Add `compile` to the `knowledge` block in `agent.config.json`:

```jsonc
{
  "knowledge": {
    "sources": [
      { "id": "team-runbook", "type": "url", "url": "https://wiki/runbook", "delivery": "file" }
    ],
    "compile": {
      "progressive": true,
      "tocMaxLines": 150,
      "emitAgentsMd": true
    }
  }
}
```

| Field | Type | Default | Effect |
|---|---|---|---|
| `progressive` | boolean | `true` | Enable the compile stage. When omitted (no `compile` block at all), the pipeline runs in v1 mode. When set to `false`, the block is parsed but the stage is a no-op. |
| `tocMaxLines` | integer (1–400) | `150` | Hard cap on the TOC stanza. Sources beyond the cap are dropped from the rendered prompt with a warning naming the dropped ids. The cap of 150 is anchored on Augment's read-rate cliff. |
| `emitAgentsMd` | boolean | `false` | Shorthand: when `true` and the `agents-md` target isn't already declared, the importer adds it. Most authors set this directly in `targets`; the flag exists for the APM importer (see below). |

Schema: `src/core/knowledge/schema.ts` (`KnowledgeBlockSchema`). Every field is optional; bundles without a `compile` block parse green and render in v1 mode.

**When to enable.** Any bundle whose materialized knowledge would exceed the v1 inline budget — a `dir` source pointed at `docs/`, a `git` source over a real repo, a Confluence space, or any URL that returns more than ~30KB of content. **When NOT to enable** — see the last section of this spoke.

---

## Per-source fields: `summary`, `toc`, `retrieval`

Three optional fields layer on top of every source variant when `compile.progressive` is on:

```jsonc
{
  "id": "stripe-api",
  "type": "url",
  "url": "https://stripe.com/docs/api",
  "delivery": "file",
  "summary": "Stripe REST API reference",
  "toc": true,
  "retrieval": { "mode": "bm25" }
}
```

| Field | Type | Effect |
|---|---|---|
| `summary` | string (1–280 chars) | One-line TOC entry. Falls back to `description`, then to the first sentence of the materialized content, then to `<id>: <type>`. |
| `toc` | boolean | Default `true`. Set `false` to materialize the source (sidecar file is still written, refresh hooks still fire) but exclude it from the TOC stanza — useful for sources the agent should be able to fetch when explicitly asked but shouldn't see in working memory. |
| `retrieval` | object | `{ mode: "off" \| "bm25" \| "external-mcp", mcpUrl?: string }`. When `mode != "off"`, the TOC line gets a `(searchable: <mode>)` suffix telling the agent to prefer the MCP search tool over scanning the file. `external-mcp` requires `mcpUrl` (validated by the schema). |

Schema: `src/core/knowledge/schema.ts` (`BaseFields`). The TOC line shape is:

```
- `<source-id>` [<type>] — <summary> → `<relative-path>` (searchable: <mode>)
```

Sources are emitted in declared order. The truncation warning is `compile: TOC truncated at <N> lines; dropped ids: <list>`.

---

## The `agents-md` target

`agents-md` is a fifth install target alongside `opencode` / `claude-code` / `codex` / `kiro`. Its translator (`src/core/translators/agents-md.ts`) emits a single plain-markdown file:

```jsonc
{
  "targets": ["claude-code", "agents-md"],
  "targetOptions": {
    "agentsMd": { "path": "AGENTS.md" },
    "claudeCode": { "deferToAgentsMd": true }
  }
}
```

**Placement.** The translator emits the relative path from `targetOptions.agentsMd.path` (default `AGENTS.md`); the installer joins it with the AGENTS.md install root, currently `$HOME` (so a bare `AGENTS.md` lands at `~/AGENTS.md`). For a project-root install, set `targetOptions.agentsMd.path` to an absolute path. See the comment in `src/cli/install-paths.ts` for the bundle-aware default tracked as a follow-up.

**CLAUDE.md interaction.** When both `claude-code` and `agents-md` are declared, the claude-code translator emits a one-line pointer body (`See AGENTS.md.`) instead of the full assembled body — same frontmatter, same model and permission resolution, just no duplicated prose. Override with `targetOptions.claudeCode.deferToAgentsMd: false` to keep the full claude-code body.

**Idempotency.** AGENTS.md goes through the same `installed-agents.json` manifest, hash-mismatch refusal, and `--force` semantics as every other target. A hand-edited AGENTS.md is never overwritten without `--force`.

**Runtimes that read AGENTS.md.** Cursor, Windsurf, GitHub Copilot, Aider, Codex CLI, Devin, Junie, Roo, Zed, Warp, and Gemini CLI all consume the standard. Emitting AGENTS.md is the single-target way to reach all of them; per-runtime `.cursor/rules` / `.windsurfrules` translators are deliberately out of scope for v2 because AGENTS.md covers them.

---

## `smith knowledge compile`

```bash
smith knowledge compile <name>      # one bundle
smith knowledge compile --all       # every bundle with compile.progressive=true
```

Runs the compile stage offline (no acquire, no network). Reads the materialized cache produced by the most recent `smith agent install`, builds the TOC stanza, and writes `compile-manifest.json` next to the materialized cache:

```
~/.config/agent-smith/knowledge/<agent>/
├── _manifest.json            # v1 materialization manifest (unchanged)
├── compile-manifest.json     # v2 compile manifest (new)
└── sources/<id>/...          # materialized files (unchanged)
```

`compile-manifest.json` records per-source TOC line, on-disk path, retrieval mode, and a content sha; `contentHash` over the sorted manifest is what `doctor` will diff for drift detection.

`smith agent install` runs compile **automatically** when `compile.progressive: true` is set — manual invocation is for offline iteration (you're editing summaries and want to re-render the TOC without paying for a network refetch) and CI checks. Schema reference for the command lives in [CLI reference — `smith knowledge compile`](./14-cli-reference.md#smith-knowledge-compile-name).

`--all` skips bundles without a compile block (one warn line per skipped bundle) and only exits non-zero when every bundle was skipped (`2`, usage hint to add the block to at least one).

---

## `smith knowledge serve --stdio`

```bash
smith knowledge serve <name> --stdio
```

Spawns a stdio MCP server backed by an in-memory BM25 index over the agent's materialized knowledge dir. Two tools:

- **`knowledge.search(query, k=5)`** — top-`k` `(path, score, snippet)` matches over the file tree. Pure lexical (no embeddings).
- **`knowledge.fetch(path, start?, end?)`** — read a file under the agent's knowledge dir; range-bounded to 64KB per response to avoid blowing the context window on a single fetch. Path traversal is rejected.

Wire it into a bundle's `mcpServers` declaration so each platform spawns the server at session start:

```jsonc
{
  "mcpServers": ["agent-smith-knowledge"]
}
```

The `mcpServers` field in `agent.config.json` is documentation-only ([06 — Permissions and platforms](./06-permissions-and-platforms.md#mcp-server-dependencies)) — you still configure the actual server in each platform's MCP config the same way you'd configure any other MCP server, pointing at:

```
command: smith
args: [knowledge, serve, <agent>, --stdio]
```

**Why BM25, not embeddings.** Cognition's SWE-grep, Anthropic's Tool Search Tool work, and Augment's read-rate study all converge on lexical retrieval being the right shape for coding agents — the bottleneck is *discoverability* (does the agent know the file exists?), not similarity matching. BM25 fits in <200 lines, has no model dependency, and re-indexes in milliseconds. The `retrieval.mode = "external-mcp"` escape hatch lets you point a source at any embedding-based MCP server (Recall, Captain, DeepWiki) without changes to the compile stage.

**Operational note.** The server runs in the foreground per-session — MCP's stdio model handles lifecycle. There is no daemon-managed multi-agent serving in v2; cold-start latency is on the order of milliseconds because BM25 indexes the file tree at spawn time.

---

## APM import: `smith agent init --from-apm`

```bash
smith agent init my-agent --from-apm ./apm.yml
```

Reads a Microsoft APM (`microsoft/apm`) `apm.yml` once and produces a normal smith bundle. One-way; smith → APM export is out of scope.

**Runtime mapping** (`src/core/apm-import.ts`):

| APM runtime | smith target |
|---|---|
| `claude-code` | `claude-code` |
| `opencode` | `opencode` |
| `codex` | `codex` |
| `kiro` | `kiro` |
| `copilot` / `cursor` / `gemini` / `windsurf` | `agents-md` (folded into one target) |
| anything else | silently dropped |

**References mapping.** APM `references[]` entries become smith `knowledge[]` sources: `url:` → `type: url`, `file:` → `type: file`. Each source is `delivery: file`. `mcp:` references are dropped (smith MCP servers live in `mcpServers`, configured separately).

**Defaults applied to the imported bundle:**
- `compile.progressive: true`
- `compile.emitAgentsMd: true`
- `modelTier: "balanced"`
- Persona stubs: `IDENTITY.md` from `name + description`, `EXPERTISE.md` from APM's `instructions` field if present, `SOUL.md` left as a TODO stub for the user to fill in.

**What you'll likely need to edit after import.** APM bundles often have descriptions shorter than smith's 10-char minimum (the importer pads with ` (imported)`) or that don't match smith's action-phrase regex; `smith agent validate` surfaces both. The `SOUL.md` stub fails the TODO marker rule by design — a freshly-imported bundle won't pass validate until you write voice + tone content.

`--from-apm` and `--from <bundle>` are mutually exclusive.

---

## Migration recipe

Flip an existing v1 bundle to v2:

```bash
# 1. Edit agent.config.json: add `"compile": { "progressive": true }` to the knowledge block.
# 2. Compile the TOC stanza + manifest.
smith knowledge compile <agent>
# 3. Re-render the agent file with the compiled TOC stanza in the body.
smith agent install <agent>
```

Adding the `agents-md` target afterwards is a one-line edit to `targets`:

```jsonc
{
  "targets": ["opencode", "claude-code", "codex", "kiro", "agents-md"]
}
```

Re-run `smith agent install <agent>`; AGENTS.md lands at `~/AGENTS.md` (override with `targetOptions.agentsMd.path`) and CLAUDE.md becomes a 1-line pointer.

The first install after the flip rewrites every rendered file. `installed-agents.json` hash refusal then keeps subsequent installs idempotent — a re-run with no upstream changes is a no-op.

---

## When NOT to use compile

`compile.progressive` is the right answer for sources whose bytes don't fit comfortably in working memory. It is the wrong answer for:

- **Short style guides.** A 50-line "we use 2-space indents and TS-strict" rubric belongs inline, in working memory, on every turn. Set `delivery: "inline"` explicitly. The compile stage respects it — `inline` sources still inline when `compile.progressive` is on.
- **Single-page glossaries.** Domain vocabulary the agent needs to disambiguate user input. Same as above: `delivery: "inline"`.
- **One-shot rubrics.** A code-review rubric the agent applies on every PR. Inline. The cost of a tool-call round trip to fetch a 200-token file every turn is silly.

The general rule: if a source is *consulted on every turn anyway*, inline beats compile. If a source is *occasionally relevant*, compile (TOC pointer + on-demand fetch) wins by an order of magnitude on tokens. The Augment / Anthropic / Cognition data is about what wins **by default** — not about banning inline.

`auto` delivery does the wrong thing here under v1: it falls back to inline once the budget is hit, silently truncating. Under v2 (`compile.progressive: true`), `auto` resolves to `file` instead of inline, fixing the silent failure mode. Explicit `inline` still inlines.

---

## Doctor: drift detection and auto-repair

`smith doctor` includes a `knowledge-compile` section (v2) that audits every registered agent with `knowledge.compile.progressive: true` and surfaces two finding kinds:

| Finding | Meaning |
|---|---|
| `missing-manifest` | The bundle declares progressive compile but `<agentSmithHome>/knowledge/<agent>/compile-manifest.json` is absent — or present but unparseable / off-schema (corrupt manifests are conflated with missing because the remedy is identical). |
| `drift` | The persisted `contentHash` in `compile-manifest.json` does not match a fresh `compile()` over the agent's current `_manifest.json` materialized sources. Means the bundle's knowledge has changed since the last compile and the TOC stanza in the rendered prompt is stale. |

Both findings are informational only — the section never affects doctor's exit code. Repair runs through `--fix-knowledge-compile`:

```bash
$ smith doctor                          # diagnose only
$ smith doctor --fix-knowledge-compile  # re-runs `smith knowledge compile <agent>` for each finding
```

The fix path re-invokes the same `runKnowledgeCompile` entry point as the standalone CLI (so refetch + materialization + compile run together), which both repairs a missing or corrupt manifest and clears drift in one pass. Per-agent errors print and the loop continues — one bad repair does not abort sibling repairs.

In the GUI, the `/system/doctor` page renders the section like every other doctor section; running the `doctor` job with `fixKnowledgeCompile: true` triggers the same repair (see [`gui/server/src/jobs/argv-builders/doctor.ts`](../gui/server/src/jobs/argv-builders/doctor.ts)).

---

## See also

- [Knowledge](./04-knowledge.md) — the v1 source-type taxonomy (file/dir/glob/url/git/confluence/jira), delivery semantics, refresh modes, and Atlassian credentials. Everything in spoke 04 still applies under v2; the compile stage runs *after* materialization.
- [Bundle anatomy](./02-bundle-anatomy.md#knowledge) — where the `compile` and `targetOptions` blocks fit in the schema overview.
- [Installing and rendering](./03-installing-and-rendering.md) — what `smith agent install` does end-to-end; the compile stage is now part of step 4.
- [Sharing and distribution](./15-sharing-and-distribution.md) — AGENTS.md as a publishing surface.
- [CLI reference](./14-cli-reference.md#knowledge) — `smith knowledge compile`, `smith knowledge serve`, and `smith agent init --from-apm` synopses, flags, and exit codes.
- [Doctor — `knowledge-compile` section](./10-doctor.md#sections-by-id) and the [`--fix-knowledge-compile` flag reference](./14-cli-reference.md#knowledge-compile-drift-and-auto-repair) — drift detection and auto-repair for compiled bundles.
