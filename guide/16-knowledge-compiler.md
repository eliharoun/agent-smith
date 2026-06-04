# Knowledge compiler

> The progressive knowledge pipeline turns a bundle's `knowledge.sources` block into a tight table-of-contents stanza in the rendered prompt plus on-disk sidecar files the agent reads on demand. This spoke covers the smart-default compile heuristic, the `compile` block overrides, the `agents-md` install target, the optional BM25 retrieval server (`smith knowledge serve`), the GUI per-source editor + MCP toggle, and the APM importer (`smith agent init --from-apm`). Read this when you're declaring a knowledge-heavy bundle, overriding the smart default, deciding whether to emit AGENTS.md, or wiring the retrieval MCP server.

> **Status.** Progressive disclosure is the smart default: small corpora stay inline, large corpora auto-compile. No opt-in flag required. Explicit `compile.progressive: true/false` overrides the heuristic; explicit `delivery: "inline"` on any source pins the bundle to inline mode. This spoke is operational reference, not design narrative.

---

## Why progressive disclosure

The v1 default was: materialize every source, concatenate the bytes into the prompt body up to an 8000-token budget, silently drop anything that didn't fit. That works for short style guides and one-page rubrics; it fails badly for a Confluence space, a 50k-line repo, or a multi-page Jira query — what gets dropped is invisible at the prompt site, and the model has to grep blindly through what survives.

The cross-tool consensus has moved on. The Linux Foundation's AGENTS.md spec (~28+ runtimes, ~60k repos as of 2026-05-31) and Anthropic's `code-execution-with-mcp` work converged on the same shape: a structured pointer index in the system prompt, plus on-demand fetch when the agent needs the bytes. Anthropic measured 150K → 2K token reductions; Augment's 2,500-repo study found AGENTS.md-listed files are read ~100% of the time vs. <10% for orphan files.

`smith knowledge` implements that pattern as a **compile stage** that runs after the existing `materialize` stage. Bundles auto-compile when their materialized corpus would overflow the inline budget, and stay inline otherwise — no opt-in flag required. The compile stage rewrites the prompt body's `## Knowledge` section as a TOC and lets the agent fetch on demand.

---

## Smart default and overrides

**Default behaviour.** The pipeline picks compile vs. inline automatically. Threshold: total materialized corpus exceeds `knowledge.inlineBudget.totalTokens` (default 8000, capped at 16000 — the same knob that gates inline truncation). Below the threshold, the bundle stays inline (cheap, always-resident); above it, the compile stage runs and the agent fetches on demand instead of getting silently truncated. Estimated as `manifest.totals.bytes / 4` (a 4-bytes-per-token heuristic). See `shouldAutoCompile` in `src/core/knowledge/pipeline.ts`.

**Two overrides.** Both live in the `knowledge` block:

| Override | Effect |
|---|---|
| `compile.progressive: true` | Force compile regardless of corpus size. Useful when you want the TOC pointer shape even for a small corpus, or to lock the rendering shape so a smaller corpus doesn't silently flip back to inline mode. |
| `compile.progressive: false` | Pin v1-inline even for a large corpus. The validator's hard-limit warning still fires when an inline source overflows its share of the budget. |
| any source with explicit `delivery: "inline"` | Pins the **whole bundle** to v1 mode (author intent wins; the validator's hard-limit check is the right place to surface overflow). |

The `compile` block:

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
| `progressive` | boolean | smart-default (auto) | When omitted, the pipeline picks based on the threshold above. `true` forces compile; `false` pins v1-inline. |
| `tocMaxLines` | integer (1–400) | `150` | Hard cap on the TOC stanza. Sources beyond the cap are dropped from the rendered prompt with a warning naming the dropped ids. The cap of 150 is anchored on Augment's read-rate cliff. |
| `emitAgentsMd` | boolean | `false` | Shorthand: when `true` and the `agents-md` target isn't already declared, the importer adds it. Most authors set this directly in `targets`; the flag exists for the APM importer (see below). |

Schema: `src/core/knowledge/schema.ts` (`KnowledgeBlockSchema`). Every field is optional; bundles without a `compile` block route through the smart default.

**When to override.** Most bundles don't need to. Reach for `compile.progressive: true` only if you want compile-shape rendering for a small corpus (e.g. you're prototyping on a small `dir` and want to see the TOC stanza without padding it). Reach for `compile.progressive: false` or explicit `delivery: "inline"` only when the corpus is small enough to live in working memory and you want every byte resident every turn — see [When NOT to compile](#when-not-to-compile).

---

## Per-source fields: `summary`, `toc`, `retrieval`

Three optional fields layer on top of every source variant. They only affect rendering when the bundle compiles (smart default or explicit `compile.progressive: true`); they parse cleanly in v1 mode but are ignored. Edit them by hand in `agent.config.json` or via the GUI per-source editor (see [GUI](#gui-per-source-editor-and-mcp-toggle)).

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
| `retrieval` | object | `{ mode: "off" \| "bm25" \| "external-mcp", mcpUrl?: string }`. Default mode is `bm25`. When `mode != "off"`, the TOC line gets a `(searchable: <mode>)` suffix telling the agent to prefer search-style queries over scanning the file. `external-mcp` requires `mcpUrl` (validated by the schema). |

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
smith knowledge compile <name>      # force compile for one bundle
smith knowledge compile --all       # force compile for every bundle with knowledge sources
```

Forces a compile regardless of opt-in or smart-default thresholds — the user explicitly asked for it. Reads the materialized files produced by the most recent `smith knowledge fetch` or `smith agent install`, builds the TOC stanza, and writes `compile-manifest.json` next to the materialized cache:

```
~/.config/agent-smith/knowledge/<agent>/
├── _manifest.json            # v1 materialization manifest (unchanged)
├── compile-manifest.json     # v2 compile manifest (written)
└── sources/<id>/...          # materialized files (unchanged)
```

`compile-manifest.json` records per-source TOC line, on-disk path, retrieval mode, and a content sha; `contentHash` over the sorted manifest is what `doctor` will diff for drift detection.

The command is **entirely offline**: it never re-acquires sources from the network, never spawns MCP servers, and never mutates the `sources/` tree. It only reads `_manifest.json` and the materialized files, runs `compile()`, and writes `compile-manifest.json`. Sources that have never been materialized produce a per-source error pointing the user at `smith knowledge fetch <agent>`. Compile is idempotent — re-running with the same materialized inputs produces the same `contentHash`.

`smith agent install` runs compile under the smart default (or honours the explicit `compile.progressive` override) at install time, when the source bytes are already in hand from the acquire+materialize pass. Manual invocation of `smith knowledge compile` is for offline iteration (you're editing `summary` / `toc` / `delivery` / `compile.tocMaxLines` and want to re-render the TOC without paying for a network refetch), CI drift checks, or pre-warming the manifest. Schema reference for the command lives in [CLI reference — `smith knowledge compile`](./14-cli-reference.md#smith-knowledge-compile-name).

The command exits `2` only when the named bundle has no `knowledge` block or no sources to compile — i.e. there's nothing to do regardless of mode. It exits `1` when one or more sources have never been materialized (run `smith knowledge fetch <agent>` first). `--all` skips bundles without sources (one warn line per skipped bundle) and only exits non-zero when every bundle was skipped.

---

## `smith knowledge serve --stdio`

```bash
smith knowledge serve <name> --stdio
```

Spawns a stdio MCP server backed by an in-memory BM25 index over the agent's materialized knowledge dir. Two tools:

- **`knowledge.search(query, k=5)`** — top-`k` `(path, score, snippet)` matches over the file tree. Pure lexical (no embeddings).
- **`knowledge.fetch(path, start?, end?)`** — read a file under the agent's knowledge dir; range-bounded to 64KB per response to avoid blowing the context window on a single fetch. Path traversal is rejected.

Wire it into a bundle's `mcpServers` declaration so each platform spawns the server at session start. The key is **per-agent** — derived as `<agent>-knowledge` so multiple bundles wired into the same AI client coexist without clobbering each other:

```jsonc
{
  // for the `agent-smith` bundle: "agent-smith-knowledge"
  // for an `agg-layer-expert` bundle: "agg-layer-expert-knowledge"
  "mcpServers": ["<agent>-knowledge"]
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

## GUI: per-source editor and MCP toggle

The browser GUI's `/knowledge/:agent` route (Knowledge tab) is the pointing-and-clicking equivalent of editing `agent.config.json` by hand:

- **Edit** button per source row — opens a modal exposing every v1+v2 field: `delivery` (auto / inline / file), `retrieval` (off / bm25 / external-mcp + `mcpUrl`), `summary`, `toc`, `materialize`, `extractor`, `refresh.mode` / `refresh.ttl` / `refresh.timeout`, `optional`, `inlineBudgetTokens`. Save writes the whole `knowledge` block back via `PUT /api/agents/:name/config` (server re-validates against the canonical schema). Confirm-on-cancel guards dirty state.
- **MCP wiring toggle** at the top of the tab — adds or removes the per-agent key `<agent>-knowledge` (e.g. `agg-layer-expert-knowledge` for the `agg-layer-expert` bundle, `agent-smith-knowledge` for the `agent-smith` bundle) from the bundle's `mcpServers: string[]`. Per-agent keys mean two different bundles wired into the same AI client never collide. The toggle's banner explains the **two-step wiring** every author needs to do once: (1) `smith agent install <agent>` to rebuild the bundle so the rendered output advertises the dependency, (2) add the spawn config to the AI client's own MCP settings (per-platform paths in the banner). The CLI equivalents are `smith knowledge wire <agent>` and `smith knowledge unwire <agent>`. Smith's `mcpServers` field is documentation-only — agent-smith does **not** write spawn configs into platform MCP files.

The same `PUT /api/agents/:name/config` endpoint accepts `knowledge` and `mcpServers` patches alongside the existing `targets` and `modelTier` arms. Source: `gui/web/src/panels/KnowledgeSources/`.

There is no "Serve" button — the earlier fire-and-forget GUI Serve was removed because it spawned a debug process unrelated to how AI clients actually consume the MCP server. The CLI `smith knowledge serve <agent> --stdio` still exists for AI clients to spawn directly.

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

There is no migration step. Existing inline bundles continue to render byte-identically when their corpus fits in the inline budget, and auto-flip to compile mode the next time they overflow it. Re-running `smith agent install <agent>` is enough — no config edit required.

If you want to force compile-shape rendering for a small corpus (e.g. you're prototyping the TOC layout), add the explicit override:

```jsonc
{
  "knowledge": {
    "sources": [...],
    "compile": { "progressive": true }
  }
}
```

To reach every AGENTS.md-aware runtime in one install, add `agents-md` to `targets`:

```jsonc
{
  "targets": ["opencode", "claude-code", "codex", "kiro", "agents-md"]
}
```

Re-run `smith agent install <agent>`; AGENTS.md lands at `~/AGENTS.md` (override with `targetOptions.agentsMd.path`) and CLAUDE.md becomes a 1-line pointer. `installed-agents.json` hash refusal keeps subsequent installs idempotent — a re-run with no upstream changes is a no-op.

---

## When NOT to compile

The smart default already keeps small corpora out of compile mode. Use the **explicit inline** escape hatch — `delivery: "inline"` on the relevant sources, or `compile.progressive: false` on the block — only when:

- **Short style guides.** A 50-line "we use 2-space indents and TS-strict" rubric belongs inline, in working memory, on every turn. Set `delivery: "inline"` explicitly. **Any source with explicit `delivery: "inline"` pins the whole bundle to v1 mode** (author intent wins; the smart default does not auto-flip the bundle to compile in this case — the validator's hard-limit check is the right place to surface overflow).
- **Single-page glossaries.** Domain vocabulary the agent needs to disambiguate user input. Same as above: `delivery: "inline"`.
- **One-shot rubrics.** A code-review rubric the agent applies on every PR. Inline. The cost of a tool-call round trip to fetch a 200-token file every turn is silly.

The general rule: if a source is *consulted on every turn anyway*, inline beats compile. If a source is *occasionally relevant*, compile (TOC pointer + on-demand fetch) wins by an order of magnitude on tokens. The Augment / Anthropic / Cognition data is about what wins **by default** — not about banning inline.

`auto` delivery is the v1 mode that silently truncates once the budget is hit. Under compile mode, `auto` resolves to `file` instead of inline, fixing the silent failure mode. Explicit `inline` still inlines, regardless of mode.

---

## Doctor: drift detection and auto-repair

`smith doctor` includes a `knowledge-compile` section (v2) that audits any agent whose `compile-manifest.json` exists on disk OR whose bundle declares `compile.progressive: true`, and surfaces two finding kinds:

| Finding | Meaning |
|---|---|
| `missing-manifest` | The bundle is in scope (explicit opt-in) but `<agentSmithHome>/knowledge/<agent>/compile-manifest.json` is absent — or present but unparseable / off-schema (corrupt manifests are conflated with missing because the remedy is identical). |
| `drift` | The persisted `contentHash` in `compile-manifest.json` does not match a fresh `compile()` over the agent's current `_manifest.json` materialized sources. Means the bundle's knowledge has changed since the last compile and the TOC stanza in the rendered prompt is stale. |

Manifest-presence detection makes the section correct under the smart-default compile. Bundles that auto-compiled at install (because the materialized corpus exceeded the inline budget) are audited via their on-disk manifest even though they never set `progressive: true`. The same path catches drift-after-shrink (a bundle that auto-compiled at install but has since had sources trimmed below the threshold — the manifest is now stale) and stale-manifest-after-opt-out (a bundle that flipped `progressive: false` after an earlier compile left a manifest behind). Bundles with no knowledge sources and no `compile-manifest.json` on disk are silently skipped — no false positives against inline-only bundles.

Both findings are informational only — the section never affects doctor's exit code. Repair runs through `--fix-knowledge-compile`:

```bash
$ smith doctor                          # diagnose only
$ smith doctor --fix-knowledge-compile  # re-runs `smith knowledge compile <agent>` for each finding
```

The fix path re-invokes the same `runKnowledgeCompile` entry point as the standalone CLI — an offline read of the existing `_manifest.json` plus a fresh compile pass. When the underlying source bytes have changed, run `smith knowledge fetch <agent>` first to re-materialize, then `smith doctor --fix-knowledge-compile` to refresh `compile-manifest.json`. Per-agent errors print and the loop continues — one bad repair does not abort sibling repairs.

In the GUI, the `/system/doctor` page renders the section like every other doctor section; running the `doctor` job with `fixKnowledgeCompile: true` triggers the same repair (see [`gui/server/src/jobs/argv-builders/doctor.ts`](../gui/server/src/jobs/argv-builders/doctor.ts)).

---

## See also

- [Knowledge](./04-knowledge.md) — the v1 source-type taxonomy (file/dir/glob/url/git/confluence/jira), delivery semantics, refresh modes, and Atlassian credentials. Everything in spoke 04 still applies under v2; the compile stage runs *after* materialization.
- [Bundle anatomy](./02-bundle-anatomy.md#knowledge) — where the `compile` and `targetOptions` blocks fit in the schema overview.
- [Installing and rendering](./03-installing-and-rendering.md) — what `smith agent install` does end-to-end; the compile stage is now part of step 4.
- [Sharing and distribution](./15-sharing-and-distribution.md) — AGENTS.md as a publishing surface.
- [CLI reference](./14-cli-reference.md#knowledge) — `smith knowledge compile`, `smith knowledge serve`, and `smith agent init --from-apm` synopses, flags, and exit codes.
- [Doctor — `knowledge-compile` section](./10-doctor.md#sections-by-id) and the [`--fix-knowledge-compile` flag reference](./14-cli-reference.md#knowledge-compile-drift-and-auto-repair) — drift detection and auto-repair for compiled bundles.
