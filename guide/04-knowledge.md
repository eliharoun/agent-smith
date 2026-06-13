# Knowledge

> Knowledge sources let an agent ship with static reference content — schemas, runbooks, API docs, glossaries, ticket queues — that `agent-smith` fetches at install time, converts to text, and either inlines into the prompt or writes to a per-agent knowledge directory the agent has implicit read access to. This is the canonical reference for the knowledge model: every source type, every field, the inline budget, Atlassian credentials, and every `smith knowledge` subcommand.

Read this when you're declaring a `knowledge` block in `agent.config.json`, debugging why a knowledge source didn't materialize (fetch and convert to text) the way you expected, configuring Atlassian credentials, or operating the `smith knowledge` CLI.

> **Inline vs. progressive.** Everything in this spoke describes the inline/file pipeline. Smith chooses between inline rendering and the progressive-disclosure compile stage automatically: small corpora (total estimated tokens under `inlineBudget.totalTokens`, default 8000) stay inline; larger corpora auto-compile. Explicit `compile.progressive: true/false` overrides the heuristic; explicit `delivery: "inline"` on any source pins the bundle to inline mode. The progressive surface also adds an `agents-md` install target and a BM25 retrieval MCP server. See [16 — Knowledge compiler](./16-knowledge-compiler.md) for the smart default, overrides, and the compile-stage surface.

> **Tip — browser GUI.** `/knowledge/:agent` in `smith gui` wraps `smith knowledge {list,add,fetch,validate}` with a per-source view, a one-click refresh button (job streamed live over SSE), and a `/system/atlassian-setup` route for the credential walk-through. `/knowledge/refresh-history` shows the refresh-mode timeline across agents. See [README → Browser GUI](../README.md#browser-gui-smith-gui).

---

## What are knowledge sources?

Knowledge sources are reference material you attach to an agent — documentation, files, wiki pages, tickets — so it can read them while helping you. You list them in `agent.config.json` and smith fetches and prepares them automatically.

### Source types at a glance

| Type | What it does | Example use |
|---|---|---|
| `file` | Reads a single file from your computer | A config file or schema |
| `dir` | Reads all files in a folder (optionally filtered) | A folder of runbooks |
| `glob` | Reads files matching a pattern across folders | All `.json` under `examples/` |
| `webpage` | Fetches a single web page | An API reference page |
| `web` | Fetches content from a whole website — crawl links, read an llms.txt list, or parse an API spec | A docs site with many pages |
| `git` | Clones a git repo and reads selected files | Your team's standards repo |
| `npm` | *(not yet available — reserved for a future release)* | — |
| `confluence` | Fetches pages from a Confluence wiki | Your team's wiki space |
| `jira` | Fetches issues from Jira via a search query | Open tickets for your project |
| `mcp` | Pulls data from an external tool (Notion, Slack, GitHub, …) through a connector | Onboarding pages in Notion |

> **Which should I pick?** File on your machine → `file`, `dir`, or `glob`. A single web page → `webpage`. A whole docs site → `web`. Confluence or Jira → use those types directly. Another tool like Notion or Slack → `mcp`.

---

## Mental model — three orthogonal dimensions

Every knowledge source has three independent dimensions. Get them straight and the rest of this spoke is mechanical.

| Dimension | Question it answers | Values |
|---|---|---|
| **type** | Where do the bytes come from? | `file`, `dir`, `glob`, `webpage`, `web`, `git`, `confluence`, `jira`, `mcp` |
| **materializer** | How do the raw bytes become text? | `passthrough`, `markdown`, `text`, `html-to-md`, `json` (also `pdf-extract` — declared but not implemented) |
| **delivery** | Where does the text land? | `inline`, `file`, `auto` |

The pipeline runs them in order: **acquire** (type) → **materialize** (materializer) → **deliver** (delivery).

```
agent.config.json (+ knowledge.json sidecar)
            │
            ▼
   ┌─────────────────┐
   │     acquire     │   type=file/dir/glob/webpage/web/git/confluence/jira/mcp
   │  → AcquiredArt. │   bytes + filename + (contentType?)
   └────────┬────────┘
            ▼
   ┌─────────────────┐
   │   materialize   │   passthrough | markdown | text | html-to-md | json
   │   → text        │   inferred from extension/content-type if not set
   └────────┬────────┘
            ▼
   ┌─────────────────┐
   │     deliver     │   inline → embedded in prompt body
   │                 │   file   → written to knowledge dir + indexed
   │                 │   auto   → heuristic (single artifact + fits budget → inline)
   └─────────────────┘
```

The materializer is inferred from filename extension and HTTP `Content-Type` when not specified — so most bundles only set `type` and `delivery` and let the rest fall through. The `html-to-md` materializer is wiki-aware: it dispatches to a wiki-direct path (no Readability) when the HTML matches a known wiki signature (XWiki, Confluence, MediaWiki, SharePoint), and to the Readability path otherwise. Wiki-mode uses per-platform CSS selectors to locate the content root before turndown runs (`.xwikicontent` for XWiki, `#confluence-content, #main-content` for Confluence, `.mw-parser-output` for MediaWiki, `.ms-rtestate-field` for SharePoint) and strips a small allowlist of platform-specific noise selectors (edit-section anchors, breadcrumbs, command bars). Both paths run turndown with GFM tables. Relative links resolve against the source URL.

---

## Common source fields

Every source carries the same envelope. Type-specific fields layer on top.

| Field | Type | Meaning | Notes |
|---|---|---|---|
| `id` | string | Stable identifier within the bundle | Must match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` (kebab-case). See `src/core/knowledge/schema.ts`. |
| `type` | enum | Where bytes come from | `file`, `dir`, `glob`, `webpage`, `web`, `git`, `confluence`, `jira`, `mcp`. `url` is accepted as a deprecated alias for `webpage` (emits a migration warning). `npm` is declared but rejected by the validator. |
| `delivery` | enum | Where text lands | `inline`, `file`, `auto`. **Required.** |
| `materialize` | enum | Override inferred materializer | `passthrough`, `markdown`, `text`, `html-to-md`, `json`. `pdf-extract` is declared but rejected. |
| `extractor` | enum | PDF extractor | Only valid when `materialize=pdf-extract`; both are forward-compat. |
| `inlineBudgetTokens` | int | Per-source inline cap | 1–16000. Falls back to remaining global budget when omitted. |
| `refresh` | enum or object | Refresh policy (`install`/`ttl`/`session`/`always`) — legacy shorthands `1h`/`1d`/`1w`/`never` still accepted | See [Refresh modes](#refresh-modes). `ttl` mode is driven by the daemon at a 5-minute poll cadence; `session`/`always` require platform hooks. |
| `description` | string | Human-readable summary | Surfaced in `knowledge list` output and the prompt's knowledge index. |
| `include` | string[] | picomatch include patterns (familiar wildcards — `**/*.md` = all `.md` files in any subfolder) | Only meaningful for `dir`, `git`, and `web` (mode: crawl). |
| `exclude` | string[] | picomatch exclude patterns | Only meaningful for `dir` and `web` (mode: crawl). |
| `auth` | enum | Auth provider | `atlassian`, `none`. **Only valid on `type=webpage`.** Validator rejects on any other type (`src/core/knowledge/schema.ts`). |
| `optional` | boolean | Demote runtime failures to warnings | When `true`, runtime/IO failures (network, missing file, git auth, etc.) are demoted to warnings and the source is skipped. Author bugs (`validation-failed` SmithErrors) still abort. See [Optional sources](#optional-sources). |

Unknown fields are dropped silently; required fields per type are listed below.

---

## Per-type schemas

### `file`

```json
{ "id": "schema", "type": "file", "path": "./db/schema.sql", "delivery": "inline" }
```

Reads the file at `path` verbatim into a single `AcquiredArtifact`. `path` may be relative (resolved against the bundle directory) or absolute. The materializer is inferred from the extension when not specified.

Required: `path`. See `src/core/knowledge/acquire.ts`.

### `dir`

```json
{
  "id": "runbooks",
  "type": "dir",
  "path": "./docs/runbooks",
  "include": ["**/*.md"],
  "exclude": ["**/draft-*.md"],
  "delivery": "file"
}
```

Recursively walks `path`, applying picomatch `include` (default: match all) and `exclude` (default: match none). Patterns are matched against POSIX-style relative paths from `path`. Output is sorted by `relPath` for determinism.

Required: `path`. Optional: `include`, `exclude`. See `src/core/knowledge/acquire.ts`.

### `glob`

```json
{ "id": "examples", "type": "glob", "path": "examples/**/*.json", "delivery": "file" }
```

Like `dir`, but `path` IS the picomatch pattern (rooted at `bundleDir`). Useful when you want a wider sweep than a single subdirectory.

Required: `path` (the pattern). See `src/core/knowledge/acquire.ts`.

### `webpage`

Point smith at any web page and it downloads the content for your agent to read. It only re-downloads later if the page actually changed.

> **Deprecation note.** The type name `url` is still accepted as an alias for `webpage` and works identically at runtime. However, `smith validate` emits a migration warning when it encounters `type: url`. New bundles should use `type: webpage`.

<!-- Fetch the Stripe API reference as a single page -->
```json
{
  "id": "stripe-api",
  "type": "webpage",
  "url": "https://stripe.com/docs/api",
  "delivery": "auto",
  "auth": "none"
}
```

Fetches `url` once and caches the response body plus `ETag`/`Last-Modified` for revalidation. Subsequent fetches send `If-None-Match` / `If-Modified-Since`; on a `304` the cached body is reused. The cache lives at `<knowledgeDir>/.cache/<sha256(url)>.bin` with sibling `.json` for headers. See `src/core/knowledge/acquire.ts`.

Required: `url` (must be RFC-parseable — `new URL(url)` succeeds). Validator rejects non-RFC URLs on `type=webpage` (`src/core/knowledge/schema.ts`).

`auth: "atlassian"` is only valid here. When set, smith resolves Atlassian Cloud credentials and injects a `Basic` header — see [Atlassian-authenticated sources](#atlassian-authenticated-sources).

### `git`

```yaml
sources:
  - id: team-docs
    type: git
    url: git@github.com:acme/team-skills.git
    ref: main
    subpath: docs/
    include: ["**/*.md"]
    delivery: file
```

Both ssh (`git@host:path` SCP shorthand or `ssh://...`) and https (`https://...`) URLs are accepted. The validator accepts either form for `type=git`; `type=webpage` requires a strict RFC URL (`src/core/knowledge/schema.ts`). Pick whichever your environment is already configured for.

**Caching & refresh.** Clones land in `<cacheDir>/git/<sha256(url)>/`. On re-run, `smith` checks whether `ref` is a branch — if yes, it `git fetch`es and hard-resets to `origin/<ref>`. If `ref` is a tag or commit SHA, the existing clone is reused unchanged (immutable). Re-run `smith agent install <agent>` or `smith knowledge fetch <agent>` to refresh branch refs.

**How files are fetched.** Clones are shallow (`--depth=1 --single-branch`). When you scope a source with `subpath` or `include` whose patterns have a static path prefix, `smith` additionally uses a **blobless, sparse** checkout (`--filter=blob:none` + `git sparse-checkout set --no-cone`), downloading only the files under those prefixes instead of the whole repository. The set of indexed files is unchanged — `include` globs are still applied precisely (via picomatch) after checkout; sparse checkout only avoids downloading files that would be discarded anyway. If the remote doesn't support partial clone (some older or self-hosted servers), `smith` automatically falls back to a full shallow clone — coverage is identical either way. See `src/core/knowledge/sparse-paths.ts` and `src/core/knowledge/acquire.ts`.

**Concurrency.** Clone/refresh is serialized per-URL with an exclusive `O_EXCL` lock at `<cacheDir>/git/<sha256(url)>.lock`. Concurrent calls poll every 100ms for up to 30s. Stale locks (mtime > 5 minutes) are recovered automatically with a warning. See `src/core/knowledge/acquire.ts`.

**Authentication.** None added by `agent-smith`. The git acquirer uses `Bun.spawn` with the parent process's environment, so git inherits your SSH agent socket, credential helper config, `gh auth` state, and so on without smith setting anything explicitly. There is no `agent-smith`-specific config to set; if a clone fails with `fatal: Authentication failed`, configure git the way you would for a manual `git clone`. See `src/core/knowledge/acquire.ts`.

**Failure modes:**

- Clone fails (auth, network, ref not found): hard error with git's stderr (URL credentials and secret-bearing query parameters redacted via `redactSecrets`).
- `subpath` doesn't exist: hard error listing the repo's top-level entries.
- `subpath` resolves outside the repo: rejected with a traversal error before any I/O.
- `include` matches zero files: warn but proceed (matches the `glob` source type's behavior).
- Symlinks inside the repo are silently skipped during the walk — they are neither followed nor materialized. Use real files (or commit the resolved content) if a source must include linked targets.

**`subpath` + `include` interaction.** `subpath` is **only valid on `type=git`** (`src/core/knowledge/schema.ts`). When set, `include` patterns are matched against paths **relative to `subpath`**, not relative to the repo root. This trips people up:

```yaml
# WRONG — matches nothing.
# After subpath narrows to docs/, the file list contains "intro.md",
# "guide/setup.md", etc. — not "docs/intro.md". The pattern "docs/**/*.md"
# never matches.
subpath: docs/
include: ["docs/**/*.md"]

# RIGHT — matches every .md file under docs/.
subpath: docs/
include: ["**/*.md"]
```

If you don't set `subpath`, patterns are matched against repo-root-relative paths and `["docs/**/*.md"]` is the right form.

### `npm`

Declared in the schema (`src/core/knowledge/schema.ts`) but **not implemented**. The validator rejects it with: `source '<id>': type=npm is not supported yet.` (`src/core/knowledge/validator.ts`). Treat it as a forward-compat marker.

### `confluence`

Pre-fetch Confluence pages as agent knowledge using a dedicated `confluence` source type:

```yaml
sources:
  - id: wiki-eng
    type: confluence
    space: ENG                          # required
    pages:                              # optional; if omitted, fetches first maxPages in space
      - "Architecture Overview"          # by title (case-sensitive exact match)
      - id: 12345                        # by id
    maxPages: 25                        # optional, default 25, hard ceiling 100
    includeChildren: true               # optional, default false
    format: markdown                    # 'storage' | 'view' | 'markdown'; default 'markdown'
    delivery: file
```

Output: one file per page named `<page-id>-<slug>.md` (or `.html` for `format: storage` / `format: view`). When `pages` is omitted and the space has more pages than `maxPages`, `agent-smith` fetches the first N and emits a warning telling you to set `maxPages` (≤100) or list `pages` explicitly. See `src/io/confluence.ts`.

When `includeChildren: true`, the seed pages are expanded (follows links level by level) via the Confluence v2 children endpoint; the same `maxPages` cap applies to the **total set (seeds + descendants)** and a warning is emitted when the cap is hit (`src/io/confluence.ts`). Use a higher `maxPages` (still capped at 100) if you need more recursion.

**Title lookup is case-sensitive exact match.** When you pass a page reference as a string title, smith pages the space's title→id map (capped at `max(maxPages * 4, 1000)` scanned pages defensively) and looks up the title verbatim. Misspell or mis-case it and you get `Confluence: page titled "..." not found in space ...`. Use the `{ id: 12345 }` form when you have a stable page id.

**429 handling.** Rate-limit responses are retried up to 3 times (4 attempts total), honoring `Retry-After` and capped at 30 seconds per wait (`src/io/atlassian-http.ts`). After exhaustion the call throws a `http-error` SmithError with `operation: "rate-limited after 4 attempts"`. The same retry budget covers transient 5xx responses, which exhaust as `operation: "unavailable after 4 attempts"`.

Required: `space`. Optional: `pages`, `maxPages`, `includeChildren`, `format`. The validator rejects all of those fields on any other type (`src/core/knowledge/schema.ts`).

### `jira`

Pre-fetch Jira issues as agent knowledge using a dedicated `jira` source type:

```yaml
sources:
  - id: tickets
    type: jira
    jql: "project = ENG AND status = 'In Progress'"  # required
    fields: ["summary", "description", "status"]      # optional; this is also the default
    maxResults: 100                                   # optional, default 100, hard ceiling 500
    delivery: file
```

Output: one file per issue named `<issue-key>.md` (e.g. `ENG-1234.md`). Pagination via `nextPageToken` is handled automatically up to `maxResults` (`src/io/jira.ts`). 429 responses are retried once honoring `Retry-After` (capped at 30s).

When `fields` is omitted (or set to `[]`), Smith requests the safe default trio `["summary", "description", "status"]`. The renderer dumps any *additional* fields it receives into a `## Other fields` JSON block, so passing every field can balloon artifact sizes (attachments, ADF descriptions, full changelogs). Pass `fields: ["*all"]` to opt back in to the server-side default of every field.

Required: `jql`. Optional: `fields`, `maxResults`. The validator rejects `jql`, `fields`, and `maxResults` on any other type (`src/core/knowledge/schema.ts`).

### `web`

Crawl a site, fetch an `llms.txt` manifest, or parse an OpenAPI spec (a machine-readable description of a web API) — three modes for structured web content that goes beyond a single page.

**The three modes in plain English:**

- **crawl** — point it at a docs site and smith follows links to collect multiple pages. You set how many (`maxPages`, default 25) and how deep (`depth`, default 2); it stays on the same site by default.
- **llms-txt** — some sites publish an `llms.txt` file listing their key pages. Point smith at it and it reads everything listed.
- **openapi** — if a service publishes an API description (OpenAPI/Swagger), smith reads it so your agent understands the API's endpoints.

```yaml
sources:
  # Crawl up to 50 pages of the Stripe docs, following links 3 levels deep
  - id: stripe-docs
    type: web
    url: https://docs.stripe.com/
    mode: crawl
    delivery: file
    maxPages: 50
    depth: 3

  # llms-txt mode: fetch a site's llms.txt manifest and referenced pages
  - id: project-llms
    type: web
    url: https://example.com/llms.txt
    mode: llms-txt
    delivery: file

  # openapi mode: parse an OpenAPI/Swagger spec
  - id: pets-api
    type: web
    url: https://api.example.com/openapi.json
    mode: openapi
    delivery: file
```

**Modes:**

| Mode | Behavior |
|---|---|
| `crawl` | Starts at `url`, follows same-origin links up to `depth` hops, collecting up to `maxPages` pages. |
| `llms-txt` | Fetches the `llms.txt` file at `url` and materializes the pages it references. |
| `openapi` | Fetches the OpenAPI/Swagger JSON or YAML spec at `url` and materializes it as structured reference. |

**Crawl bounds (mode: crawl only):**

| Field | Type | Default | Constraint |
|---|---|---|---|
| `maxPages` | int | 25 | 1–200 |
| `depth` | int | 2 | 1–5 |
| `sameOrigin` | bool | `true` | When `true`, only follows links on the same origin as `url`. |
| `include` | string[] | (match all) | picomatch path globs — only crawl URLs whose pathname matches. |
| `exclude` | string[] | (match none) | picomatch path globs — skip URLs whose pathname matches. |

`include` and `exclude` are only valid on `mode: crawl`; the validator rejects them on `llms-txt` and `openapi`.

**Install-time only.** Web sources are always materialized at install time. They do not support `lazy: true` — the validator rejects it.

Required: `url`, `mode`. Optional (crawl-only): `maxPages`, `depth`, `sameOrigin`, `include`, `exclude`.

### `mcp`

Connect your agent to external tools — Notion, GitHub, Slack, and others — and pull in their data. Smith talks to these tools through connectors called MCP servers (small programs that know how to talk to a specific service). You tell smith which tool and what to look for.

<!-- Pull onboarding pages from Notion via MCP connector -->
```yaml
sources:
  - id: onboarding-pages
    type: mcp
    server: notion-mcp
    tool: search
    args:
      query: "onboarding guide"
    preset: notion
    delivery: file
```

**Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `server` | string | yes | Name of an MCP server declared in the bundle's `mcp.required` or `mcp.peer`. |
| `tool` | string | yes | Tool name to invoke on the server. |
| `args` | object | no | Arguments passed to the tool. Credential-shaped keys (matching `authorization`, `bearer`, `cookie`, `credential`, `password`, `passwd`, `secret`, `token`, `*_key`, `apikey`) are rejected by the validator. |
| `preset` | enum | no | One of: `notion`, `github`, `slack`, `linear`, `sentry`, `grafana`. Pre-fills `server`/`tool`/`argHints` defaults. |
| `allowWriteTool` | bool | no | Default `false`. By default only tool names starting with a read-shaped prefix (`read`, `get`, `fetch`, `search`, `list`, `describe`, `preview`, `head` — case-insensitive) are allowed; all others are blocked unless this is `true`. |

**Presets:**

| Preset | Default server | Default tool | Docs |
|---|---|---|---|
| `notion` | `notion-mcp` | `search` | [github.com/makenotion/notion-mcp-server](https://github.com/makenotion/notion-mcp-server) |
| `github` | `github-mcp` | `search_repositories` | [github.com/github/github-mcp-server](https://github.com/github/github-mcp-server) |
| `slack` | `slack-mcp` | `search_messages` | [github.com/modelcontextprotocol/servers/tree/main/src/slack](https://github.com/modelcontextprotocol/servers/tree/main/src/slack) |
| `linear` | `linear-mcp` | `search_issues` | [github.com/linear/linear-mcp-server](https://github.com/linear/linear-mcp-server) |
| `sentry` | `sentry-mcp` | `search_issues` | [github.com/getsentry/sentry-mcp-server](https://github.com/getsentry/sentry-mcp-server) |
| `grafana` | `grafana-mcp` | `search_dashboards` | [github.com/grafana/grafana-mcp-server](https://github.com/grafana/grafana-mcp-server) |

**Credential denylist.** The `args` object is scanned for credential-shaped keys. Keys matching `/(authorization|bearer|cookie|credential|password|passwd|secret|token|(^|[_-])(api|access|private|secret)[_-]?key($|[_-])|apikey)/i` are rejected (e.g. `token`, `api_key`, `access_token`, `client_secret`, `refresh_token`, `private_key`, `authorization`, `bearer`, `cookie`, `password`) — note plain `auth` is NOT matched. Credentials belong in the MCP server's own environment/config, not in the bundle.

**Read-tool guard.** By default smith only allows tool names that start with a read-shaped prefix (`read`, `get`, `fetch`, `search`, `list`, `describe`, `preview`, `head` — case-insensitive). All other tool names (including names like `find_`/`query_`/`compute_`) are blocked. Set `allowWriteTool: true` to override when a non-read-prefixed name is actually safe (e.g. a tool named `compute_stats` that only reads data).

**Server declaration.** The `server` field should reference a server declared in the bundle's `mcp.required` or `mcp.peer` array. This ensures `smith agent install` can preflight the dependency and warn when the server is missing from the target platform's MCP config.

---

## Delivery semantics

| Delivery | Behavior |
|---|---|
| `inline` | Materialized text is embedded into the assembled prompt body in the `## Knowledge` section, between USER and SKILLS. Subject to per-source `inlineBudgetTokens` and the global `inlineBudget.totalTokens`. |
| `file` | Materialized text is written under `<knowledgeDir>/sources/<id>/...` and indexed in the prompt's `## Knowledge Index` section with id, relative path, description, and one-line summary. |
| `auto` | The pipeline picks `inline` if the source produced a single artifact AND its token count fits in `min(inlineBudgetTokens-or-2000, remaining-global-budget)`. Otherwise `file`. See `src/core/knowledge/pipeline.ts`. |

The default global inline budget is **8000 tokens** (cl100k_base estimator) with a hard ceiling of **16000** (`src/core/knowledge/validator.ts`). Override per bundle:

```json
{
  "knowledge": {
    "inlineBudget": { "totalTokens": 4000 },
    "sources": []
  }
}
```

When an inline source's tokens exceed its share of the budget — either its own declared `inlineBudgetTokens` cap or the remaining global budget — it's auto-demoted to file delivery and a warning is emitted:

```
[<id>] inline tokens (12450) exceed remaining budget; demoted to file delivery
```

See `src/core/knowledge/pipeline.ts`.

**Cheap pre-check.** Before running the gpt-tokenizer (which is slow on multi-MB content), the pipeline computes a lower-bound token count as `ceil(totalChars / 8)`. If even that lower bound exceeds the per-source cap or remaining budget, the source skips the expensive tokenization and goes straight to file delivery. See `src/core/knowledge/pipeline.ts`.

**Sum-of-budgets warning.** The validator also warns at config time when the sum of declared `inlineBudgetTokens` across inline sources exceeds the global `inlineBudget.totalTokens` — the pipeline will demote oldest-added sources first when the budget is blown at install time (`src/core/knowledge/validator.ts`).

---

## Lazy URL sources

For URL sources, you can opt out of install-time fetching: the bundle ships only the URL and a description, and the agent fetches the page on demand at runtime through its built-in fetch tool (or a routed MCP tool, when `via:` is set).

```json
{
  "id": "platform-architecture",
  "type": "webpage",
  "url": "https://wiki.internal.example.com/architecture",
  "lazy": true,
  "description": "Platform service architecture. Use when answering deployment topology or service-boundary questions."
}
```

When `lazy: true`:

- Smith does not fetch the URL at install time, and `smith knowledge fetch` for that source revalidates only — never re-fetches the body.
- The `delivery`, `materialize`, `extractor`, and `inlineBudgetTokens` fields are forbidden by the schema (they describe install-time materialization, which lazy skips).
- The compiled prompt's knowledge index renders a single line per lazy source — `id`, description, the URL, and the fetch tool the agent should call.
- The `description` field becomes the agent's only signal until it fetches, so write it carefully.

### When to use lazy

- The URL content drifts (an active runbook, a frequently-updated spec) and you want every conversation to see the current version.
- The URL needs the recipient's auth (Atlassian Cloud, GitHub Enterprise, internal wikis) and the fetch tool already has those credentials.
- The content is long-tail — the agent only needs it occasionally and prefetching would burn tokens for nothing.

For URLs the agent will always need, leave `lazy` unset and let the install-time pipeline materialize the body once.

### Description guidance

Lazy sources show only their description in the agent's prompt until it fetches. Smith's installer warns at `smith agent install` time when the description is missing, too short, written in first or second person, or longer than 1024 characters. Best practices:

- **Third person.** "Documents X. Use when Y." Not "I help with…" or "You can use this for…".
- **Front-load trigger keywords.** The first ~80 characters carry the most weight when an agent decides whether to fetch.
- **Cover both halves.** Say what the source contains AND when to reach for it.
- **Stay under 1024 characters.** Smith warns above the cap; some runtimes truncate.

### `via:` for authed URLs

When a URL needs authentication that the agent's built-in fetch tool can't provide, set `via:` and the agent calls the named MCP tool instead:

```json
{
  "id": "platform-architecture",
  "type": "webpage",
  "url": "https://wiki.internal.example.com/architecture",
  "lazy": true,
  "via": { "server": "internal-mcp", "tool": "fetch_page" },
  "description": "Platform service architecture. Use when answering deployment topology questions."
}
```

The same `via:` semantics described in [Routing URL fetches through MCP servers](#routing-url-fetches-through-mcp-servers) apply: the named server must be configured locally, and `mcp.required[]` should list it so recipients of the bundle catch missing dependencies at install time. `smith doctor` includes a `lazy-fetch` section that flags lazy URL sources whose targets ship no built-in fetch tool AND have no `via:` to fall back on.

### AGENTS.md targets

Bundles targeting `agents-md` (Cursor, Windsurf, Aider, etc.) cannot fetch URLs at runtime — those targets render a static prompt file with no tool-call surface. For these, smith auto-degrades: it fetches each lazy URL at install time and appends the body to the rendered AGENTS.md (inline if small, written as a sidecar file if large), with a `> source: <url>` reference so the agent can see where the content came from. Runtime targets in the same bundle (Claude Code, Kiro, OpenCode) keep the lazy TOC entry; only the agents-md output carries the materialized body.

### Refresh

`smith knowledge fetch <agent>` for a lazy source revalidates that the URL still resolves but does not re-fetch the body — refreshing material that the agent will fetch fresh on every call would be wasted work. The `refresh` field is still accepted on lazy sources (it documents intent and feeds into doctor's reporting), but the daemon's TTL poll and the session-start hooks both skip lazy entries.

---

## Optional sources

Set `optional: true` on a source to make `smith agent install` resilient to its runtime/IO failures:

```json
{
  "id": "live-runbook",
  "type": "webpage",
  "url": "https://internal-wiki.example.com/runbook",
  "delivery": "file",
  "optional": true
}
```

When the source's acquire/materialize step throws at install time — network down, file missing, git auth failure, 4xx/5xx HTTP — the pipeline:

1. **Demotes the failure to a warning** of the form `[<id>] optional source failed: <reason>` and surfaces it under the agent's `[<agent>/knowledge]` warning header.
2. **Skips the source.** It is NOT added to `_manifest.json` and no stub artifact is written.
3. **Continues with the other sources.** The agent install completes successfully (`smith agent install` exits `0`).

Mirrors npm's `optionalDependencies`: a missing optional dep doesn't fail the install, but it doesn't pretend to have succeeded either.

**What `optional` does NOT demote.** Author bugs — anything the schema or validator catches as a structured `validation-failed` SmithError — still abort regardless of `optional`. The flag exists to absorb environmental flakiness (network, missing optional files), not to hide misconfiguration. So a misspelled `materialize`, an `auth: atlassian` on a non-`webpage` source, or a `type=npm` placeholder still fail the install.

**When to use it.** Sources that depend on environment-specific availability (an internal wiki you may be off-VPN from; a credential-guarded URL for users who haven't configured Atlassian; a `git` clone that requires SSH agent setup that not every dev has). Don't use it as a workaround for sources that fail in CI but work locally — fix the underlying issue or scope the source to the right environment.

**Defaulting.** The flag defaults to `false` (omitted from persisted config). The CLI flag `--optional` on `smith knowledge add` sets the field to `true`; without the flag, the field is omitted from the written JSON (no `"optional": false` litter).

See `src/core/knowledge/pipeline.ts` (per-source try/catch) and `src/core/knowledge/types.ts` (`KnowledgeSourceBase.optional`).

---

## Where knowledge lives on disk

The per-agent knowledge directory is **always** under agent-smith's own state home (`~/.config/agent-smith/`), regardless of which platforms the agent targets. By design — knowledge content is materialized into one location only, and every target (OpenCode, Claude Code, Codex, Kiro) reaches it via a read grant written into its rendered output at install time.

```
~/.config/agent-smith/knowledge/<agent>/
├── _manifest.json              # rendering metadata: schemaVersion, renderedAt, totals, per-source entries
├── sources/
│   └── <source-id>/
│       └── <relPath>           # one or more materialized files per source
└── .cache/
    ├── git/
    │   ├── <sha256(url)>/      # shallow clone target
    │   └── <sha256(url)>.lock  # exclusive lock for clone/refresh serialization
    ├── <sha256(url)>.bin       # cached HTTP body for url sources
    └── <sha256(url)>.json      # ETag / Last-Modified / Content-Type for the body above
```

See `src/io/knowledge-paths.ts` for path resolution. Earlier versions of smith materialized this directory under `~/.config/opencode/agents/<name>/knowledge/`, but OpenCode's agent picker globs that directory recursively and was treating every knowledge `.md` as a selectable agent — the migration rationale is documented on the `KnowledgePaths` interface (`src/io/knowledge-paths.ts`).

**File extensions and frontmatter.** Materialized HTML lands as `.md` (Readability + turndown + GFM tables) for non-wiki pages. Wiki-shaped HTML (XWiki, Confluence, MediaWiki, SharePoint — detected by HTML signature) skips Readability and converts the wiki body directly via turndown + GFM. Materialized HTML files are prefixed with a YAML frontmatter block (`title`, `source_url`, `fetched_at`) so the agent has provenance metadata without paying tokens to re-derive it. JSON envelopes returned by MCP tools are unwrapped before sniffing — the inner bytes are content-type-detected and written under an honest extension. The sniffer recognizes 8 envelope shapes in priority order: `{content: {content}}`, `{content}`, `{html}`, `{body}`, `{text}`, `{markdown}`, `{result}`, `{data}`. Each path is checked top-to-bottom; first string match wins.

For HTML pages that wrap their real content in a transport element (commonly a `<textarea class="wiki-source">` or `<pre>` carrying source HTML), smith's `tryUnwrapEmbeddedHtml` step extracts the inner content before materialization. Two-tier detection: class-signal first (`wiki-code`, `source-code`, `raw-content`, `embedded-content` in the element's class), then a shape fallback that swaps the element when its content dominates the outer body. Wiki-platform detection re-runs on the unwrapped HTML so the dispatcher routes the inner document to wiki-mode or article-mode based on its own shape.

`_manifest.json` is a single file enumerating every source's id, scope, type, delivery, files (path/sha256/bytes/summary), `tokensInline`, description, and provenance. `smith knowledge list` reads it; the install pipeline writes it (`src/core/knowledge/pipeline.ts`). The install pipeline also *reads* the prior `_manifest.json` snapshot **before** overwriting it — `summarizeKnowledgeStage` (`src/io/knowledge-summary.ts`) diffs each source's `(relPath, sha256)` set against the prior to produce the per-source `→ knowledge` / `· knowledge (unchanged)` lines surfaced in install output. A missing or corrupt prior manifest is treated as "no prior" (every source reports changed); the read is defensive — install never aborts because of a manifest-read error.

### Cross-platform read-grants

Agents installed to any target — OpenCode, Claude Code, Codex, or Kiro — need an explicit read grant for the knowledge directory because it lives outside each platform's own agents/skills dir. The translator injects the grant into per-platform rendered output at install time:

| Platform | Output field | Effect |
|---|---|---|
| OpenCode | `permission.read.<knowledgeDir>/**: allow` | Grants read access to the absolute knowledge path. |
| Claude Code | `additionalDirectories: [...]` | Grants read access to the absolute knowledge path. |
| Codex | `allowed_external_directories: [...]` | Grants read access to the absolute knowledge path. |
| Kiro | `resources: ["file://<knowledgeDir>/**", ...]` | Grants read access to the absolute knowledge path. |

The grant is injected automatically and cannot be disabled from the bundle. The install summary line confirms which dirs were granted. For the full per-platform translator behavior, see [Installing and rendering](./03-installing-and-rendering.md#per-platform-output).

### Full git checkouts: `repos/<source-id>/`

For every `type: git` knowledge source, agent-smith also creates a stable
symlink at `<knowledgeDir>/repos/<source-id>/` pointing at the full local
clone. This lets agents read files that fall outside their declared `include`
patterns (source code, tests, configs) without needing to know the internal
sha256 cache key.

Example: if `agent.config.json` declares

```json
{ "id": "github-com-foo-bar", "type": "git", "url": "https://github.com/foo/bar" }
```

the agent will find:

- `<knowledgeDir>/sources/github-com-foo-bar/` — the materialized, filtered slice
- `<knowledgeDir>/repos/github-com-foo-bar/` — the full repo checkout (symlinked)

The `## Knowledge Index` section of the rendered agent prompt advertises
the `repos/` path automatically; no per-agent configuration required.

---

## `knowledge.json` sidecar

For long source lists or environment-specific overrides, place a `knowledge.json` next to `agent.config.json` in the bundle. Same shape as the `knowledge` field on the config:

```json
{
  "inlineBudget": { "totalTokens": 4000 },
  "sources": [
    { "id": "schema", "type": "file", "path": "./db/schema.sql", "delivery": "inline" }
  ]
}
```

Merge rules (see `src/core/knowledge/sidecar.ts`):

| Field | Behavior |
|---|---|
| `inlineBudget` | Sidecar wins (whole-object replacement). |
| `packs` | Sidecar wins (whole-array replacement). |
| `sources` | Merged by `id`; sidecar wins on collisions. |

The sidecar is parsed and validated against the same `KnowledgeBlockSchema` as the embedded block. A malformed sidecar fails the install with `knowledge.json failed schema validation: <field>: <message>`.

---

## Atlassian-authenticated sources

For URL sources that require Atlassian Cloud credentials (Confluence REST API endpoints, Jira REST API endpoints), set `auth: atlassian` on the source:

```json
{
  "knowledge": {
    "sources": [
      {
        "id": "wiki-runbook",
        "type": "webpage",
        "url": "https://acme.atlassian.net/wiki/rest/api/content/12345",
        "delivery": "file",
        "auth": "atlassian"
      }
    ]
  }
}
```

`auth` is **only valid on `type=webpage`**. The dedicated `confluence` and `jira` source types resolve credentials automatically and reject `auth` (`src/core/knowledge/schema.ts`).

### Credential resolution order

`agent-smith` resolves credentials in this order, returning the first complete `(email, token)` pair (`src/io/atlassian-auth.ts`):

1. **Process env (smith)** — `SMITH_ATLASSIAN_EMAIL` + (`SMITH_ATLASSIAN_API_TOKEN` or `SMITH_JIRA_API_TOKEN`)
2. **`~/.config/agent-smith/.env`** — same `SMITH_*` keys

There's no precedence between `*_ATLASSIAN_API_TOKEN` and `*_JIRA_API_TOKEN` within a tier — the first non-empty one wins.

### Base URL override

Both `confluence`, `jira`, and the `auth: atlassian` URL variant **require** an explicit workspace URL — Atlassian Cloud instances are workspace-scoped (`https://<workspace>.atlassian.net`), so there is no global default. Set `SMITH_ATLASSIAN_BASE_URL` to your workspace URL:

```bash
export SMITH_ATLASSIAN_BASE_URL=https://your-org.atlassian.net
```

### Getting a token

Smith uses Atlassian account API tokens (the same kind you'd use with `curl --user email:token`). Steps mirror Atlassian's [official guidance](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/):

1. Visit <https://id.atlassian.com/manage-profile/security/api-tokens>. You may be asked to verify your identity via a one-time email passcode (if you log in with a password or third-party login).
2. Click **Create API token**.

   > Atlassian also offers **Create API token with scopes** and recommends it for security. Smith does **not** yet support scoped tokens — they're issued for `https://api.atlassian.com/ex/{jira,confluence}/{cloudId}` while smith's fetchers call your workspace URL directly (e.g. `https://acme.atlassian.net/wiki/api/v2/...`). Use the **unscoped** "Create API token" button. Adding scoped-token support is tracked as future work.

3. Give the token a descriptive name like `agent-smith`.
4. Set an expiration date. Atlassian's default is 1 year (max 365 days). **Tokens you create after Dec 15, 2024 always expire** — there's no infinite-lifespan option anymore. Pick a date you're comfortable rotating on.
5. Click **Create**, then **Copy to clipboard**. **The token cannot be recovered after this step** — Atlassian doesn't store the value. Save it in a password manager so you can paste it into your `.env` file (or the GUI's Atlassian credentials panel) later.
6. Paste the token into your `.env` file as `SMITH_ATLASSIAN_API_TOKEN=<token>`, or into the GUI's [Atlassian credentials panel](../README.md#browser-gui-smith-gui).

The same token authenticates against both Confluence and Jira on the workspace you authenticated to. To revoke a token (or rotate before expiry), return to the same URL and click **Revoke**.

### Verifying

Run `smith doctor` to verify your credentials are detected. The atlassian-auth section reports which tier was used (`env-smith` / `file-smith`) or `not-configured`. See [Doctor](./10-doctor.md) for the full output schema.

> This is the canonical home for Atlassian credentials. [Paths and state](./13-paths-and-state.md) cross-links here rather than duplicating the resolution rules.

---

## Routing URL fetches through MCP servers

Some URLs require authentication smith can't provide directly — internal
wikis behind mTLS, ticketing systems behind scoped OAuth tokens, or any
source where the credential is held by an MCP server you've already
configured.

For these, set `via` on the source:

```json
{
  "id": "internal-wiki",
  "type": "webpage",
  "url": "https://wiki.internal.example.com/architecture/",
  "delivery": "file",
  "via": {
    "server": "internal-mcp",
    "tool": "FetchInternalUrl"
  }
}
```

When `via` is set, `smith knowledge fetch` and `smith agent install`
call `<server>.<tool>` over MCP instead of HTTP. The bundle's
`mcp.required` (or `mcp.peer`) list — see
[Bundle MCP dependencies](#bundle-mcp-dependencies) — must include the
named server, and that server must be configured in the target
platform's MCP config (e.g. `~/.claude/settings.json`,
`~/.codex/config.toml`) for the install-time preflight to pass.

`via.args` accepts an object literal merged into the tool call payload.
The fetcher always sends `{ url }` plus any `via.args` keys you supply,
which is how you pass per-call hints (a header bundle, a max-bytes cap,
or a server-specific `format` flag) without baking them into the tool
itself:

```json
{
  "via": {
    "server": "internal-mcp",
    "tool": "FetchInternalUrl",
    "args": { "format": "markdown", "maxBytes": 200000 }
  }
}
```

### Picking the MCP server when you add a URL

When you run `smith knowledge add <agent> <url>` against an http(s)
URL, smith first asks you to point at the MCP server that should fetch
it. The picker unions two sources: the bundle's existing `mcpServers[]`
and every server smith finds in your AI client configs (`~/.claude.json`,
`~/.codex/config.toml`, `~/.config/opencode/opencode.json`,
`~/.kiro/settings/mcp.json`). Each row is labelled by origin, so you
can tell at a glance which servers the bundle author already wired and
which ones come from your local environment:

```text
$ smith knowledge add my-agent https://wiki.internal.example.com/space/page

  Which MCP server fetches this URL? (or skip for direct HTTP)
    1. internal-mcp                 [from bundle]
    2. confluence-mcp               [from your AI client config]
    0. skip — save as direct-HTTP source
  Choice [0]: 2
  loading tools from confluence-mcp…
  → routing through confluence-mcp.fetch_page
→ added confluence-mcp to mcpServers[] and marked as required
→ added knowledge source wiki-internal-example-com-space-page (webpage)
```

After you pick a server smith calls its `tools/list` and filters for
URL-shaped tools (parameters smith recognises as `url`/`uri`/`urls`/
`inputs`/`targets`/etc.). Servers with exactly one URL-shaped tool
pre-select silently; multiple options trigger a second prompt; zero
URL-shaped tools fail loudly so you can pick a different server
instead of saving a `via` smith knows won't resolve.

When the server you pick wasn't already declared in the bundle, smith
appends it in two places: `mcpServers[]` (so the install pipeline
spawns the server on the next materialize) and `mcp.required[]` (so
recipients of the bundle refuse to install when the server is missing
from their MCP config — see [Bundle MCP dependencies](#bundle-mcp-dependencies)).
Pressing **0** or just hitting enter skips the picker entirely; smith
then falls through to the curated-registry suggestion below.

The picker is interactive-only. In non-TTY runs (CI, daemon, piped
stdin) it skips silently — unattended workloads never block on stdin —
and the curated registry runs unchanged. Cross-link:
[How smith picks a route](#how-smith-picks-a-route) covers the full
resolution order once the source is on disk.

### Retrofitting `via:` on existing sources

Already added a batch of URL sources without `via:` and want to wire
them up after the fact? `smith knowledge route <agent>` runs the same
picker against every URL source in the bundle that doesn't already
have `via:` set:

```text
$ smith knowledge route my-agent

Routing source api-docs: https://docs.example.com/api
  Which MCP server fetches this URL? (or skip for direct HTTP)
    1. internal-mcp                 [from bundle]
    2. confluence-mcp               [from your AI client config]
    0. skip — save as direct-HTTP source
  Choice [0]: 1
  loading tools from internal-mcp…
  → routing through internal-mcp.FetchInternalUrl

Routing source runbook: https://wiki.internal.example.com/runbook
  …
→ Routed 2 sources, skipped 0
  run smith knowledge fetch my-agent to materialize the new routes
```

Pass `--source <id>` to target a single source (including ones that
already have `via:`, when you want to re-route). Sources with an
existing `via:` are skipped automatically when no `--source` is given,
so the command is safe to re-run after adding new URL sources.

To switch a routed source **back to direct HTTP**, pass `--clear-via`
together with `--source <id>`:

```text
$ smith knowledge route my-agent --source api-docs --clear-via
→ cleared via: from source api-docs
```

`--clear-via` is non-interactive — no picker is invoked, since your
intent is explicit. It requires `--source <id>` (rejected with exit 2
otherwise), and is idempotent: targeting a source that's already
direct-HTTP prints a brief "nothing to clear" message and exits 0. The
bundle's `mcpServers[]` and `mcp.required[]` are intentionally left
untouched, since other sources may still depend on the same server;
prune those by hand if needed. Switching to a **different** server is
just `smith knowledge route <agent> --source <id>` — the picker re-runs
against the existing route and you choose the new target.

### Authoring shortcut on `smith knowledge add`

For a handful of well-known URL patterns, smith ships a curated routing
registry — Atlassian Confluence (`*.atlassian.net/wiki/`), SharePoint
(`*.sharepoint.com`), Notion (`*.notion.so`), and GitHub blob URLs
(`github.com/<owner>/<repo>/blob/...`). The registry only fires when
the picker above is skipped (you chose 0, or you're in a non-TTY run).
When the URL matches one of the known patterns, smith offers the
matching server/tool pair and waits for confirmation:

```text
$ smith knowledge add my-agent url https://wiki.internal.example.com/space/page
• URL matches a known pattern. Smith can route fetches through:
    internal-mcp.FetchInternalUrl
    (verify the tool name against your server's tools/list)
  use this routing? [y/N] y
→ routing through internal-mcp.FetchInternalUrl
→ added knowledge source wiki-internal-example-com-space-page (webpage)
```

Smith **never** auto-sets `via` without an explicit `y` — tool names
vary by MCP server distribution, so a silent auto-route would produce
`-32601 method-not-found` errors against the wrong server's
`tools/list`. In non-interactive contexts (CI, piped stdin), the
suggestion still prints but the source is saved without `via`; opt in
by hand-editing `agent.config.json`.

For URLs the registry doesn't recognise, set `via` directly on the
source — or skip `via` entirely and let the three-layer resolver pick
the route at install time. See
[How smith picks a route](#how-smith-picks-a-route) for the full
resolution order, including the probe-on-failure prompt smith uses
when direct HTTP fails. Run `smith doctor` (`mcp-deps` section) after
install to see which servers each bundle needs and which the platform
actually has; the `url-routing` section in the same report shows the
resolved routing table grouped by layer.

### Per-agent MCP key

Each bundle's knowledge MCP server is keyed `<agent>-knowledge`
(`keyForAgent(agent)` in `src/io/mcp-wiring.ts`). Two bundles wired
into the same AI client therefore advertise distinct server names —
for an `acme-helper` bundle the key is `acme-helper-knowledge`; for
the bundled `agent-smith` bundle the key is `agent-smith-knowledge`
(that bundle's per-agent key happens to equal the historical bundled
name, so old configs continue to work unchanged). Use `smith
knowledge wire <agent>` to write the spawn entry for `<agent>-knowledge`
into every detected AI client config, and `smith knowledge unwire
<agent>` to remove it. The `mcpServers[]` array in `agent.config.json`
is documentation-only — wiring is what actually puts the server in
front of the platform. See [14 — CLI reference](./14-cli-reference.md#smith-knowledge-wire-agent)
for command flags and exit codes.

---

## How smith picks a route

When a URL knowledge source has no explicit `via:` field, smith
resolves the fetch through three layers in order. Each layer is
independent — any one of them can route the fetch, and the resolver
falls through to the next when none of the entries in a layer match.
If all three layers come up empty, smith fetches the URL directly
over HTTP, and on a hard failure, offers to probe the bundle's MCP
servers and remember the answer.

### The three layers

1. **Learned (per-user cache).** Smith reads
   `~/.config/agent-smith/url-routing.json` first. Entries land here
   when you accept a probe-on-failure prompt (see below). The cache
   is keyed by URL prefix and points at a `<server>.<tool>` pair, so
   the same source on the next install skips the prompt entirely.
   This layer is the highest-priority because it captures an
   explicit user decision.
2. **Advertised (server self-claim).** During install, smith calls
   `tools/list` on every server in the bundle's `mcpServers` and
   reads `_meta["dev.agent-smith/fetchDomains"]` on each tool
   descriptor. A server publishing
   `["wiki.internal.example.com", "docs.internal.example.com"]` on
   its `fetch_page` tool is telling smith "I handle these
   hostnames" — no per-bundle wiring required. Servers that don't
   advertise the key, refuse to start, or don't expose any matching
   tool produce a silent skip; the resolver tolerates an empty
   claim list.
3. **Curated (smith's built-in registry).** The same suggestion
   registry that powers the `smith knowledge add` confirmation
   prompt — Atlassian Confluence, SharePoint, Notion, GitHub blob
   URLs — is the bottom layer. It only fires when the URL matches
   one of those well-known patterns AND the bundle declares the
   matching server in `mcpServers`. Smith ships no global defaults:
   if your bundle doesn't declare the server, the curated entry is
   skipped.

If two layers claim the same URL pattern, the higher layer wins
(learned > advertised > curated). The `url-routing` section of
`smith doctor` lists every entry grouped by layer and flags any
pattern claimed by more than one server/tool pair, so you can audit
the resolution table without running an install.

### Probe-on-failure UX

When all three layers come up empty and direct HTTP fails, smith
offers to probe each MCP server declared in the bundle:

```text
$ smith agent install my-agent
→ fetching https://wiki.internal.example.com/architecture/
  HTTP fetch failed: 401 Unauthorized
  Try via internal-mcp.fetch_page? [y/N] y
→ routed via internal-mcp.fetch_page
→ saved route to ~/.config/agent-smith/url-routing.json
```

The prompt loops over each server in `mcpServers` until you accept
one or exhaust the list. Accepting saves the URL → server/tool
mapping to the per-user cache so the next install of the same source
skips the prompt and routes through the cached pair on the first
try.

The probe is interactive-only. In non-TTY contexts (cron, daemon,
CI, piped stdin) smith never reaches the prompt — the install fails
with the original HTTP error, leaving the source unmaterialized.
Re-run interactively to teach smith the route, or set `via:` on the
source by hand and commit it to the bundle.

### Inspecting the resolved table

`smith doctor` includes a `url-routing` section that walks all three
layers and prints the resolved table. Layer 2 (`advertised`) is gated
behind `SMITH_DOCTOR_PROBE_META=1` because populating it requires
spawning every available MCP server and calling `tools/list` —
expensive and side-effecting (some servers want auth tokens, others
take seconds to start). Without the env var, the section shows only
the curated and learned layers; with it, the advertised layer joins
in. See [14 — `smith doctor`](./14-cli-reference.md#smith-doctor) for
the full section description.

---

## Bundle MCP dependencies

Declare the MCP servers your bundle depends on in an `mcp` block on
`agent.config.json`:

```json
{
  "mcp": {
    "required": ["internal-mcp"],
    "peer": ["atlassian-mcp"]
  }
}
```

Semantics mirror npm's `dependencies` / `peerDependencies`:

- **`required`** — every server in this list must be present in the
  target platform's MCP config at install time. `smith agent install`
  refuses to proceed if any are missing and exits `1` with a list of
  the missing entries. Use `--allow-missing-mcp` to demote the refusal
  to a warning (useful when staging a bundle before the server is
  rolled out, or in offline test runs).
- **`peer`** — expectations rather than hard dependencies. Missing
  peers warn during install but do not block.

Smith resolves servers across the platforms the bundle targets:
OpenCode (`~/.config/opencode/opencode.json`), Claude Code
(`~/.claude/settings.json`), Codex (`~/.codex/config.toml`), and Kiro
(`~/.kiro/settings/mcp.json`). A server is "present" if it is declared
in the config for at least one targeted platform — smith does not
require uniform availability across every target.

The `mcp-deps` section of `smith doctor` audits installed agents and
reports per-bundle which required/peer servers are missing on which
platforms. See the [doctor section list](./10-doctor.md#the-fifteen-sections).

---

## The `smith knowledge` subcommands

Subcommand handlers live under `src/cli/commands/knowledge/`. The family includes `add`, `list`, `fetch`, `validate`, `compile`, `serve`, `wire`, `unwire`, `remove`, `route`, `refresh-session`, and `migrate-codex`. Calling `smith knowledge` without a subcommand fails with exit `2` (`usage-error`).

### `smith knowledge add`

```bash
smith knowledge add <agent> <type> <path-or-url> \
  [--id <id>] [--delivery <inline|file|auto>] [--description <text>] [--optional] [--no-install] \
  [--pages <list>] [--max-pages <n>] [--include-children] [--format <storage|view|markdown>] \
  [--fields <list>] [--max-results <n>]
```

Adds a source to the agent's `agent.config.json`, validates the result, and **auto-runs `smith agent install <agent>`** to materialize it. The materialize step is best-effort and runs *after* the config is saved — if it fails (network down, fetch error), `add` still exits `0` with a warning telling you to retry `smith agent install <agent>`. Your declaration is never lost. Pass `--no-install` to skip materialization.

**Examples:**

```bash
# Inline a local schema (auto-materializes)
smith knowledge add my-agent file ./db/schema.sql

# Add a URL with a stable id and explicit delivery
smith knowledge add my-agent webpage https://stripe.com/docs/api \
  --id stripe-api \
  --delivery auto \
  --description "Stripe API reference"

# Pull in a directory tree
smith knowledge add my-agent dir ./docs/runbooks --delivery file

# Pin a git source
smith knowledge add my-agent git git@github.com:your-org/api-spec.git

# Save the declaration but defer materialization
smith knowledge add my-agent url https://docs.example.com --no-install

# Add a Confluence space (auth: SMITH_ATLASSIAN_EMAIL + SMITH_ATLASSIAN_API_TOKEN)
smith knowledge add my-agent confluence ENG --format markdown

# Add specific Confluence pages
smith knowledge add my-agent confluence ENG --pages "Onboarding,Runbook,id:12345"

# Add a Jira query
smith knowledge add my-agent jira "project=ENG AND status='In Progress'" \
  --fields summary,description,status --max-results 100
```

**id-derivation rules** (`src/cli/commands/knowledge/add.ts`):

| Case | Derivation |
|---|---|
| `--id` is provided | Always wins. |
| `type=webpage` or `type=git` and URL parses | `host + pathname`, lowercased, non-alphanumerics collapsed to `-`, trimmed, max 60 chars. Fallback: `"url-source"`. |
| `type=webpage` or `type=git` and URL doesn't parse | `"url-source"`. |
| `type=file`, `dir`, `glob` | basename minus extension, kebab-case. Fallback: `"source"`. |

**Default delivery** is `auto` when `--delivery` is omitted.

**Validation after add.** Both `parseConfig` (the full config schema) and `validateKnowledge` (the knowledge linter) run after the source is appended. Errors throw a `validation-failed` SmithError; warnings print yellow but still write the file.

**Auto-materialize is config-first.** The flow is:

1. Validate + write the new source to `agent.config.json`.
2. Print `→ added knowledge source <id> (<type>)`.
3. Unless `--no-install`, print `materializing via 'smith agent install <agent>'…` and run install.
4. If install throws, print a yellow `warn` line: `materialize failed: <reason>. Source was saved. Retry: smith agent install <agent>` — and still return `0`.

This guarantees that the human contract ("add this source") and the machine contract ("materialize it") are decoupled: you never have to debate whether your source is "in the config" because the install pipeline broke.

**Output you'll see (success path):**

```
→ added knowledge source stripe-api (webpage)
  materializing via 'smith agent install my-agent'…
→ opencode /Users/you/.config/opencode/agents/my-agent.md
1 installed, 0 unchanged
→ knowledge stripe-api (1 file, 24.0KB, file)
1 changed, 0 unchanged · 1 file, 24.0KB
```

The new `stripe-api` source shows as `→` (changed) because there's no prior manifest entry for it. On a re-run with no upstream changes, the same line flips to `· knowledge stripe-api (1 file, 24.0KB, file) (unchanged)` and the tally to `0 changed, 1 unchanged · …`. The trailing `inline tokens U/B` clause only appears if at least one source uses `delivery: inline` — see [03-installing-and-rendering.md#knowledge-materialization-summary](./03-installing-and-rendering.md#knowledge-materialization-summary) for the full output contract.

**Output with `--no-install`:**

```
→ added knowledge source stripe-api (webpage)
  run 'smith agent install my-agent' to materialize
```

**Structured atlassian sources.** As of v0.12.0, `smith knowledge add` supports `confluence` and `jira` types end-to-end. The third positional is the type's required identifier (`<space>` for confluence, `<jql>` for jira); per-type flags (`--pages`, `--max-pages`, `--include-children`, `--format`, `--fields`, `--max-results`) map to the schema's per-variant fields. Both types require Atlassian credentials (`SMITH_ATLASSIAN_EMAIL` + `SMITH_ATLASSIAN_API_TOKEN` or `SMITH_JIRA_API_TOKEN`); `add` checks at add time and warns (does not block) if creds are missing. Sources still requiring complex hand-tuning (custom `auth` blocks, exotic per-source overrides) can always be edited directly in `agent.config.json` followed by `smith knowledge validate <agent>`.

**URL shortcut.** As of v0.12.0, you can paste any Atlassian URL straight from your browser as the second positional and skip the `<type>` argument entirely: `smith knowledge add <agent> <atlassian-url>`. Smith parses the URL and fills the right flags. Six URL shapes are recognised: Confluence page (`/wiki/spaces/<SPACE>/pages/<ID>/...`), Confluence blog (`/wiki/spaces/<SPACE>/blog/YYYY/MM/DD/<ID>/...`), Confluence whole space (`/wiki/spaces/<SPACE>(/overview)?`), Jira issue (`/browse/<KEY-N>`), Jira JQL search (`/issues/?jql=<urlencoded>`), and any other http(s) URL as a plain web fetch. The success line tells you which kind was created (e.g. `→ added Confluence page knowledge source ...`) so typos that fall through to `plain web URL` are caught immediately. Explicit flags always override URL-derived defaults. See [smith knowledge add in cli-reference](./14-cli-reference.md#smith-knowledge-add-agent-type-or-url-path-or-url) for the full URL-shape table and v1 limitations.

**`--optional` flag.** Adds `optional: true` to the new source. See [Optional sources](#optional-sources) for behavior. Omit the flag and the field is omitted from the persisted config (no `"optional": false` litter).

**`--no-install` flag.** Skips the auto-materialize step. Use this when you want to add several sources in a row (and pay the install cost once at the end), or when working offline.

**Exit codes:** `0` on success (even if materialize warned), `1` on validation failure, `2` on missing arguments.

### `smith knowledge list`

```bash
smith knowledge list <agent>
```

Shows the agent's knowledge state. The output shape depends on which of four states the agent is in:

**State 1 — Agent not registered (exit 1):**

```text
$ smith knowledge list ghost
✗ smith knowledge list: agent not found: ghost

  Try: smith agent init ghost
```

**State 2 — Agent exists, no sources declared (exit 0):**

```text
$ smith knowledge list new-agent
Knowledge for new-agent:
  no knowledge sources declared yet

  Add one:  smith knowledge add new-agent <type> <path-or-url>
```

**State 3 — Sources declared but not yet materialized (exit 0):**

```text
$ smith knowledge list draft-agent
Knowledge for draft-agent:
  1 source(s) declared but not yet materialized

  opencode-docs  (webpage, https://opencode.ai/docs)
    Live OpenCode docs

  Materialize:  smith agent install draft-agent
```

**State 4 — Materialized (exit 0, the rich view from `_manifest.json`):**

```text
$ smith knowledge list stripe-helper
Knowledge for stripe-helper:
  rendered 2026-05-04T12:00:00Z • inline 1843/8000 tokens • 14 files • 28940B

  schema  (per-agent, file, inline)
    DB schema
    files: 1, tokens(inline): 412
      - sources/schema/schema.sql

  stripe-api  (per-agent, url, file)
    Stripe API reference
    files: 13, tokens(inline): 0
      - sources/stripe-api/api/charges.md
      - sources/stripe-api/api/customers.md
      ...
```

The state is determined by reading both `agent.config.json` (declared sources) and `<knowledgeDir>/_manifest.json` (materialization output). State 1 returns `not-found(agent)`; states 2/3/4 all return `0`. Manifest read errors other than `ENOENT` (permission denied, malformed JSON) raise `permission-denied` or `validation-failed` SmithErrors.

**Exit codes:** `0` for any of states 2/3/4, `1` for state 1 (agent not registered) or unrecoverable manifest read errors, `2` on missing `<agent>` argument.

### `smith knowledge fetch`

```bash
smith knowledge fetch <agent> [--source <id>] [--force-unlock]
```

Re-fetches cached content for URL and git sources and re-installs the agent. Use it when an upstream source has changed and you want to pick up the new content without going through a full `install` cycle.

- `--force-unlock` — drops a stuck per-agent install lock (left by a killed earlier run) before fetching. ENOENT is silent. Same contract as `smith agent install --force-unlock`.

```bash
smith knowledge fetch my-agent                       # refresh every URL/git source
smith knowledge fetch my-agent --source stripe-api   # surgically clear and re-fetch one source
```

**`--source <id>` is surgical.** Smith clears only the named source's acquirer cache before re-fetching:

- `type: webpage` — removes `<knowledgeDir>/.cache/<sha256(url)>.bin` and the sibling `.json` headers.
- `type: git` — removes `<knowledgeDir>/.cache/git/<sha256(url)>/` recursively.
- `file`, `dir`, `glob`, `confluence`, `jira`, and `npm`-placeholder types: no on-disk acquirer cache to clear. For `confluence`/`jira`, surgical refresh re-acquires through the API but does not pre-clear any on-disk cache; the broad form (no `--source`) goes through the same path.

Other sources' caches are left untouched, so refreshing one URL no longer invalidates ETag/body data for unrelated URLs. After clearing, smith re-acquires the single source through the same three-layer URL resolver as install, materializes it, re-renders the agent's prompts, and prints a one-line summary on success:

```
refreshed <id>: <N> file(s), <B> byte(s) in <Xms>ms
```

When the surgical refresh is skipped (another fetch holds the install lock for the agent, the source has `delivery: inline` and nothing to materialize on disk, or the source is filtered out), smith prints a corresponding `refresh ... skipped` line and exits `0`. Sources with `delivery: auto` proceed through the full acquire+materialize chain — the post-acquire size check decides inline-vs-file from the rendered bytes. A failed refresh leaves the prior on-disk state intact (`smith` prints `smith: refresh of <id> for <agent> failed: ...` and exits `1`).

Without `--source`, the command re-runs `install`, which uses the existing HTTP cache (ETag/Last-Modified revalidation) and existing git clones (branch refs hard-reset to `origin/<ref>`, tags/SHAs reused unchanged). To force a full re-fetch of every source, delete `<knowledgeDir>/.cache/` directly and re-run `smith agent install <agent>` (or `smith knowledge fetch <agent>`) to re-materialize.

`smith knowledge fetch` is the official cache-bust mechanism.

**Exit codes:** propagated from `smith agent install` — `0` on success, `1` on install failure, `2` on missing `<agent>`.

### `smith knowledge validate`

```bash
smith knowledge validate                # check every registered agent
smith knowledge validate <agent>        # check one
```

Runs the knowledge linter (`src/core/knowledge/validator.ts`) against the agent's `knowledge` block. Catches:

- Duplicate source ids.
- Unknown source types (e.g. `npm` — declared in the schema but not implemented).
- Unknown materializers (e.g. `pdf-extract` — same).
- Missing required fields per type (`space` for confluence, `jql` for jira, `path` for file/dir/glob, `url` for webpage/web/git, `server`/`tool` for mcp).
- `inlineBudget.totalTokens` above the 16000 hard ceiling.
- Sum-of-inline-source-budgets exceeding the global budget (warning, not error).
- Use of `packs` (declared in the schema but not yet implemented — error, not warning).

The same linter runs as part of `smith agent validate`, so you only need to invoke `knowledge validate` directly when iterating on knowledge config in isolation.

**Output:** errors print red (`error: <message>`), warnings yellow (`warn: <message>`), grouped by agent name. Agents with no knowledge issues are silent.

**Exit codes:** `0` if no errors anywhere; `1` if any agent has errors. Warnings alone exit `0`.

---

## Caveats and gotchas

- **`pdf-extract` materializer not implemented.** Declared in `src/core/knowledge/schema.ts` and `types.ts`, rejected by `validator.ts`. If a source somehow bypasses the validator, the pipeline throws a structured `validation-failed` error which surfaces in the per-source error list as `[<id>] knowledge materializer: pdf-extract materializer not yet implemented` — the source is *not* indexed and no 0-byte file is written (`pipeline.ts`).
- **`npm` source type not implemented.** Declared in the schema, rejected by the validator. Forward-compat marker only.
- **`refresh` field is enforced for `ttl`/`session`/`always`.** The smithd daemon drives `ttl`-mode refresh on a 5-minute poll (see [guide/09-daemon.md](./09-daemon.md#knowledge-ttl-refresh)); `session`/`always` modes require per-platform hooks installed at agent-install time (see [Refresh modes](#refresh-modes)). `install` mode (the default) materializes only at `smith agent install` time — re-run install or `smith knowledge fetch` to refresh.
- **`packs` field declared but rejected.** Knowledge packs aren't shipped yet. The validator returns an error referencing the design doc (`validator.ts`).
- **Knowledge dir is always under `~/.config/agent-smith/knowledge/<agent>/`** regardless of the agent's `targets`. By design — single materialization location, cross-platform read-grants in frontmatter (including for OpenCode). See `src/io/knowledge-paths.ts`.
- **`knowledge fetch --source <id>` clears only that source's acquirer cache (URL or git).** `confluence`/`jira` per-source clearing is not yet wired — use `smith knowledge fetch <agent>` (no `--source`) to broadly refresh those.
- **Confluence `includeChildren` enforces `maxPages` as a hard cap on the total expanded set.** Smith emits a warning when the cap is hit during BFS recursion. Bump `maxPages` (still ≤100) for more.
- **Jira default field set is intentionally small.** Three fields (`summary`, `description`, `status`) keep payloads bounded. Pass `fields: ["*all"]` to opt back in to the server-side default — but be ready for ADF blobs, attachments, and full changelogs in the rendered markdown.
- **Confluence page title lookup is case-sensitive.** The title-to-id map stores titles verbatim from the API. Misspell or mis-case it and you get `page titled "..." not found`.
- **Git acquirer inherits the user's git environment for SSH and credentials.** No isolation; whatever your shell can clone, smith can clone. If a clone fails with `fatal: Authentication failed`, the fix is in your git/SSH config, not in smith.
- **Symlinks inside git sources are silently skipped.** Materialize real files, or commit the resolved content.
- **Inline budget demotion is "oldest first".** When the budget is exceeded, the pipeline keeps already-fitted sources and demotes the next one; the warning identifies which source was demoted.
- **Cache invalidation is per-source for URL/git sources.** Pass `--source <id>` to clear and re-fetch one source's URL or git cache; without `--source`, smith re-runs install and reuses the existing cache (ETag revalidation, branch hard-resets). To force a full re-fetch of every source, delete `<knowledgeDir>/.cache/` directly and re-run `smith agent install`.
- **`webpage` requires a strict RFC URL; `git` accepts SCP shorthand.** `https://...` works for both, but `git@host:path` only validates as `type=git`. The validator surfaces a clear error either way (`schema.ts`).
- **`auth`, `subpath`, `space`/`pages`/`includeChildren`/`format`, `maxPages`, `jql`/`fields`, `maxResults` are all type-restricted.** Setting any of them on the wrong source type fails validation with a precise message. Use `smith knowledge validate <agent>` after editing the config by hand.
- **`smith knowledge add confluence|jira ...` is fully supported as of v0.12.0.** The third positional is the type's required identifier (`<space>` for confluence, `<jql>` for jira); optional per-type flags (`--pages`, `--max-pages`, `--include-children`, `--format`, `--fields`, `--max-results`) map to the schema's per-variant fields. The add command checks Atlassian-auth presence and warns (does not block) if credentials are missing. See [smith knowledge add in cli-reference](./14-cli-reference.md#smith-knowledge-add-agent-type-or-url-path-or-url) for full flag docs.
- **`smith knowledge add <agent> <atlassian-url>` URL shortcut is supported as of v0.12.0.** Paste any Atlassian/Confluence/Jira URL directly as the second positional and smith infers the type and fills the right flags (six URL shapes recognised: Confluence page/blog/space, Jira issue, Jira JQL search, plain web URL fallback). The success line labels the kind it created so a typo'd Atlassian URL falling through to `plain web URL` is caught immediately. Explicit flags always override URL-derived defaults. v1 limitations: Confluence tinylinks (`/wiki/x/...`), Jira boards/dashboards, and the newer `/jira/software/projects/.../issues/KEY-N` path fall through to plain URL — use the long-form flag command for those.
- **`optional: true` only demotes runtime errors.** Schema/validator failures (`validation-failed` SmithErrors) still abort the install regardless. The flag is for environment flakiness (network, missing files, git auth), not misconfiguration. See [Optional sources](#optional-sources).

---

## Refresh modes

Knowledge sources declare how often their content should be re-acquired via the
optional `refresh` field. Four modes:

| Mode | Trigger | Typical use |
|---|---|---|
| `install` *(default)* | `smith agent install` only | Static content, local files, anything that never changes |
| `ttl` | Daemon poll (5-min cadence), when cache age > declared TTL | Confluence runbooks updated weekly |
| `session` | Every agent session start (via platform hook) | Live API docs, frequently-edited Jira boards |
| `always` | Both install-time and session-start | Critical references that must be fresh on first session and stay fresh |

### Object form

```yaml
sources:
  - id: confluence-runbooks
    type: confluence
    space: ENG
    refresh:
      mode: session
      timeout: 3      # per-source budget in seconds (default 5, max 60)
  - id: cache-poll
    type: webpage
    url: https://example.com/api/spec
    refresh:
      mode: ttl
      ttl: 30m        # required when mode=ttl
```

The `timeout` field is capped at 60 seconds by the schema (`src/core/knowledge/schema.ts`). Values above 60 fail validation. The runtime default is 5s.

### Legacy shorthand

For backward compatibility, the bare string form is still accepted:

| Shorthand | Equivalent |
|---|---|
| `refresh: never` | `refresh: { mode: install }` |
| `refresh: 1h` | `refresh: { mode: ttl, ttl: 1h }` |
| `refresh: 1d` | `refresh: { mode: ttl, ttl: 1d }` |
| `refresh: 1w` | `refresh: { mode: ttl, ttl: 1w }` |

### Per-type restrictions

Static source types (`file`, `dir`, `glob`) only support `install` mode — refreshing
local content is a no-op. The validator rejects any non-install mode on these types.

### What triggers the actual refresh

- `install` mode: nothing extra — content materializes at install time.
- `ttl` mode: requires `smithd` to be running. The daemon polls every
  5 minutes (a dedicated `setInterval` independent of the 15-minute
  git-pull tick) and refreshes any source whose cache age exceeds its
  declared TTL. Because the poll bounds the granularity, declared TTLs
  shorter than 5 minutes effectively behave as 5 minutes. See
  [guide/09-daemon.md § Knowledge TTL refresh](./09-daemon.md#knowledge-ttl-refresh).
- `session` / `always` mode: requires per-platform hook installation,
  which smith offers automatically during `smith agent install`. The
  user is prompted for consent on first install; the decision is
  recorded in a per-agent `refresh-manifest.json` (see
  [Consent and the refresh manifest](#consent-and-the-refresh-manifest)
  below). Without consent, no hook block is written into the installed
  agent file and refresh stays manual-only.
  - **Claude Code** *(v0.15)*: a `hooks.SessionStart` block is added
    to the installed `~/.claude/agents/<name>.md` frontmatter.
  - **Codex** *(v0.15)*: a global `SessionStart` hook entry is written
    to `~/.codex/hooks.json` with a `_smith_managed` ownership marker.
    On Codex launch (matcher `startup|resume`), the hook calls
    `smith knowledge refresh-session --platform codex`, which sniffs
    the parent `codex --profile <name>` invocation and scopes refresh
    to that one agent. If the `--profile` flag is absent (e.g. bare
    `codex`), refresh runs over the superset of installed
    codex-targeted agents with `session`/`always` sources.

    First-time setup: after installing the first codex-targeted agent
    with refresh hooks, smith prints a one-line advisory. Open codex
    and type `/hooks` to trust the smith entry.

    If `~/.codex/hooks.json` pre-exists without the `_smith_managed`
    marker, install fails — smith refuses to overwrite user-owned hook
    config. Move the file aside (or merge its contents manually) and
    re-run install. See the install advisory and
    [CLI reference for `smith agent install`](./14-cli-reference.md#smith-agent-install-name).
  - **OpenCode**: smith installs a global `agent-smith-refresh` plugin
    at `~/.config/opencode/plugins/agent-smith-refresh/index.ts` and
    registers it in `~/.config/opencode/opencode.json` (top-level
    `plugin` array, entry `"./plugins/agent-smith-refresh"`). The
    plugin listens on the `session.created` event and shells out to
    `smith knowledge refresh-session --platform opencode` with a 5s
    timeout; refresh failures soft-fail so a session never blocks on
    them. OpenCode has no per-session-agent scoping, so the plugin
    refreshes the **superset** of all installed opencode-targeted
    agents with `session`/`always` sources on every `session.created`
    — there is no equivalent to the codex `--profile` sniff.

    The plugin directory contains a `.smith-managed` sentinel file
    (`{ agents: [...], installed_at: ISO }`) listing the consenting
    agents. `smith agent uninstall` updates the sentinel when an
    opencode-consenting agent is removed; when the last consenting
    agent is uninstalled, the plugin directory and the
    `opencode.json` plugin entry are removed entirely.

  - **Kiro** *(v0.25.0)*: smith adds an `agentSpawn` hook entry to the
    installed kiro agent JSON file (`~/.kiro/agents/<name>.json`). The
    hook calls `smith knowledge refresh-session --agent <name> --platform kiro`
    on every agent spawn. The hook entry is identified by an ownership
    signature on the `command` field (same pattern as Claude Code's
    frontmatter hooks). `smith agent uninstall` removes the entry
    surgically; co-resident hooks (AIM telemetry, kiro-lens, user-
    authored) are preserved.

The unified entrypoint that hooks call into is `smith knowledge refresh-session`
— see the [CLI reference](./14-cli-reference.md#smith-knowledge-refresh-session) for details.

The runner takes a per-source advisory lock at
`~/.cache/agent-smith/locks/<agent>-<sourceId>.lock` so two Claude Code
sessions starting within the same ~30s window don't double-fetch the
same source — the second caller finds the lock held and skips.

### Consent and the refresh manifest

The first time `smith agent install <name>` encounters a Claude Code
or Codex target with at least one `session`/`always` source, it
prompts (once per platform that consents will affect):

```text
This agent declares 2 source(s) that refresh at session start:
  - confluence-runbooks (confluence, session)
  - jira-board (jira, always)

To enable auto-refresh on claude-code, smith will inject a SessionStart
hook into the installed agent file.

Allow? [Y/n/details]
```

For codex, the prompt text instead says "smith will add a SessionStart
entry to ~/.codex/hooks.json (smith-managed)." Pick `details` to see
the exact YAML / JSON smith will write.

The prompt can be pre-answered (or suppressed) from the command line:

- `--refresh-consent yes` / `--refresh-consent no` — pre-answer the
  prompt (accepts `y`/`yes`/`n`/`no`, case-insensitive). Required in CI
  / non-TTY contexts. The decision broadcasts to every consent-eligible
  platform on this install — there is no per-platform variant.
- `--no-refresh-hooks` — skip the consent prompt entirely and don't
  write hooks. Refresh becomes manual-only via `smith knowledge fetch`.

On a non-interactive stdin without `--refresh-consent`, smith defaults
to *no* (skip hook install) and prints a warning telling you how to
opt in explicitly. See the [CLI reference for `smith agent install`](./14-cli-reference.md#smith-agent-install-name)
for the full flag table.

When the user grants consent, smith records it in
`~/.config/agent-smith/agents/<name>/refresh-manifest.json`:

```json
{
  "agent": "my-agent",
  "refresh_consent": {
    "granted_at": "2026-05-18T10:23:00Z",
    "platforms": ["claude-code", "codex"],
    "sources": ["confluence-runbooks", "jira-board"]
  }
}
```

The manifest lets `smith agent uninstall` undo the hook installation
cleanly. For claude-code, the hook lives in the agent file itself
(which uninstall removes anyway); for codex, uninstall reads the
manifest and removes the agent's entry from `~/.codex/hooks.json`,
deleting the file entirely when the last codex-consenting agent is
removed. The manifest is written only after a successful
build+install, so a failed install never leaves an orphan manifest.
The file is managed by smith — do not edit it by hand.

If `--no-refresh-hooks` was passed or the user declined, **no manifest
is written and the rendered agent file contains no `hooks` block**.

### Failure behavior

Refresh fetches **never block a session**. Network errors, auth failures, and
timeouts produce a one-line stderr warning; the session proceeds with the
last successfully-materialized content. Use `smith knowledge fetch <agent>`
manually to retry.

---

## Search & retrieval

Once an agent's knowledge is installed, `smith` builds a per-agent search index
and exposes it through the agent's knowledge MCP server:

- `knowledge.search(query, k)` — searches the index built from your sources.
  Lexical (BM25/FTS5) ranking by default; when a source opts into `retrieval:
  hybrid` and the on-device embedding models are available, semantic vector
  ranking is fused in via Reciprocal Rank Fusion. Hybrid embeds each chunk with
  the model suited to its kind — a code-specialized model for code, a
  text-specialized model for prose/JSON — chosen automatically by chunk kind.
  Returns ranked hits with `rel_path` and `start_line`/`end_line` so the agent
  can fetch the exact span.
- `knowledge.fetch(path, start, end)` — range-bounded file read (unchanged).
- `knowledge.map(focus?, mapTokens?)` — a ranked structural map of symbols
  (functions, classes, and where they're referenced) across **code** knowledge
  sources. Advertised only when the agent has indexed code sources.
- `knowledge.explain(query, k)` — decomposes what `knowledge.search` fuses:
  the lexical (BM25) arm's hits, each semantic (vector) arm's hits, and the
  RRF-fused result with each entry's `lexicalRank`, per-arm `vectorRanks`, and
  `fusedScore`. The vector arms are keyed by **role** (`code`, `prose`) rather
  than the raw model id, so a hit shows which model ranked it. Advertised only
  when hybrid retrieval is active (no semantic arm to decompose in lexical-only
  mode).

The index is built when the agent is installed or refreshed — not at query time
— and stored under the agent's knowledge cache (`.cache/index/`). The store uses
Bun's built-in SQLite (no extra dependency). Semantic vectors use an optional
on-device embedding model and the code map uses optional tree-sitter grammars;
when those optional components aren't available, search transparently falls back
to lexical BM25 and `knowledge.map` is simply not offered — nothing else changes.

---

## Retrieval mode

Each knowledge source in a compiled bundle carries an optional `retrieval.mode`
field that controls whether the compiled TOC line hints that the source is
searchable, and (for `hybrid`) whether semantic vectors are computed for it.
The four modes:

- **`bm25`** (default) — the source is lexically searchable via
  `knowledge.search`. The index is built when the agent is installed or
  refreshed and stored on disk under `.cache/index/knowledge.db` (FTS5); the
  serve process opens it read-only. Adds a `(searchable: bm25)` annotation to
  the source's compiled TOC line.

- **`hybrid`** — opts the source into **semantic** vector indexing on top of
  lexical. `knowledge.search` then fuses BM25 and vector results via Reciprocal
  Rank Fusion. Code chunks are embedded with a code-specialized model and
  prose/JSON chunks with a text-specialized model, picked automatically by chunk
  kind. Requires the optional on-device embedding models at build time; when
  they're unavailable, `hybrid` degrades transparently to `bm25` (lexical only).
  Use `knowledge.explain` to audit the fusion — it exposes each arm's ranked
  hits and the per-hit `lexicalRank`/role-labelled `vectorRanks`/`fusedScore`
  that `knowledge.search` hides. See [Search & retrieval](#search--retrieval).

- **`external-mcp`** — declare a remote MCP server (with `mcpUrl`) that the
  agent should query instead of the local search path. Currently the field
  writes the annotation only; the local index still ingests the source's files.
  A future smith release will gate the runtime so the local index skips
  `external-mcp` sources and the agent routes search to the declared URL.

- **`off`** — advisory marker that this source isn't intended for search-style
  access. Today this only omits the TOC annotation — the local index still
  ingests the file. The agent reads `off` sources via direct
  `knowledge.fetch <path>` rather than `knowledge.search <query>`.

**Restart the knowledge server after changing a source's mode.** The `smith knowledge serve` process reads the pre-built index and loads the query embedder **once, at startup** — and your AI client owns that process's lifecycle (it spawns `<agent>-knowledge` on session start). So changing a source's `retrieval.mode` (most notably enabling or disabling `hybrid`) only takes effect after the server restarts: reconnect the `<agent>-knowledge` MCP server in your client (Claude Code: `/mcp` → reconnect) or start a new session. A still-running server keeps serving the mode it loaded at spawn. `smith` can't restart it for you — the client owns it.

The default is `bm25`: every `.md`/`.txt`/`.json` (and indexable code) file in
the materialized knowledge tree is lexically indexed at install/refresh
regardless of any per-source setting. Existing bundles with explicit
`retrieval: { mode: "bm25" }` continue to work; new bundles stay clean because
the GUI no longer persists a `retrieval` block when the user picks `bm25`.

The retrieval-mode field is a compile-time annotation only today — it does not
gate the BM25 index at runtime. Runtime gating per source is forward work.

---

## Inspecting the index

Run `smith knowledge info <agent>` to confirm whether hybrid retrieval is
actually built and active (vs BM25-only), see the per-role embedding models
(`code → …`, `prose → …`) and vector coverage, and check each source's
retrieval mode — each indexed source is tagged with the model role(s) that
embedded its vectors (e.g. `[code]`, `[code+prose]`). It reads the **on-disk**
index, so it reports what a fresh server spawn would serve — a server that's
already running may differ until it restarts (see the restart note above). Pass
`--json` for scripting.

---

## Troubleshooting

When a session-mode source doesn't refresh, or a hook silently fails to
fire, the table below maps the visible symptom to the most likely cause
and the one-command fix. Most rows boil down to `smith doctor
--fix-knowledge-refresh` (auto-repairs the first three drift kinds —
see [CLI reference](./14-cli-reference.md#smith-doctor)) or
`smith knowledge migrate-codex` for the one drift kind smith refuses
to auto-repair (overwriting a user-owned `~/.codex/hooks.json`).

| Symptom | Likely cause | Fix |
|---|---|---|
| `smith knowledge refresh-session` exits non-zero with "missing manifest" | Agent installed before the consent flow ran (pre-0.15) | `smith agent reconfigure <name> --grant <platform>` |
| Hook didn't fire on session start (Claude Code) | Hook block missing from the installed agent's frontmatter | `smith doctor --fix-knowledge-refresh` |
| Hook didn't fire on session start (Codex) | `~/.codex/hooks.json` doesn't list the agent in its `_smith_managed` sentinel | `smith doctor --fix-knowledge-refresh` |
| Hook didn't fire on session start (OpenCode) | Plugin dir / `opencode.json` out of sync with the `.smith-managed` sentinel | `smith doctor --fix-knowledge-refresh` |
| Hook didn't fire on agent spawn (Kiro) | `agentSpawn` hook entry missing from the installed kiro agent JSON | `smith doctor --fix-knowledge-refresh` |
| Daemon never refreshed a TTL source | Cache meta file missing or corrupt | check `~/.cache/agent-smith/agents/<name>/sources/<id>.meta.json`; run `smith doctor` |
| Upgrading from <0.15: `smith agent install --target codex` fails with "hooks.json exists and is not managed by smith" | Pre-existing hand-written `~/.codex/hooks.json` | `smith knowledge migrate-codex` |
| `smith doctor` reports `unmanaged-codex-hooks` | Same as above | `smith knowledge migrate-codex` (review output, then re-run install) |

### Per-platform refresh sequence

The three diagrams below trace what happens from the moment a platform
fires its session-start hook through `smith knowledge refresh-session`
and on to the per-source cache update. The shared tail — `materializeOneSource`
writing both `<id>.content` and `<id>.meta.json` under
`~/.cache/agent-smith/agents/<agent>/sources/` — is the same path the
daemon uses for `ttl`-mode polling.

**Claude Code** (per-agent hook in the installed agent's frontmatter):

```
Claude Code session_start
  └─> reads installed agent frontmatter (~/.claude/agents/<name>.md)
      └─> matches smith-injected hooks.SessionStart block
          └─> spawns: smith knowledge refresh-session --agent <name> --platform claude-code
              └─> reads refresh-manifest.json (consent + source list)
                  └─> per session/always source:
                      materializeOneSource → write <id>.content + <id>.meta.json
```

**Codex** (one global hook for every consenting agent):

```
codex launch (matcher: startup|resume)
  └─> reads ~/.codex/hooks.json (_smith_managed sentinel)
      └─> matches smith SessionStart entry
          └─> spawns: smith knowledge refresh-session --platform codex
              └─> sniffs parent `codex --profile <name>` → scope to that agent
                  (falls back to superset of codex-targeted agents if absent)
                  └─> per session/always source:
                      materializeOneSource → write <id>.content + <id>.meta.json
```

**OpenCode** (global plugin, no per-session-agent scoping):

```
opencode session.created event
  └─> ~/.config/opencode/plugins/agent-smith-refresh/index.ts fires
      └─> reads .smith-managed sentinel (consenting agent list)
          └─> spawns: smith knowledge refresh-session --platform opencode
              └─> superset of installed opencode-targeted agents:
                  per session/always source:
                  materializeOneSource → write <id>.content + <id>.meta.json
```

**Kiro** (per-agent hook in the installed agent's JSON):

```
kiro agent spawn
  └─> reads installed agent JSON (~/.kiro/agents/<name>.json)
      └─> matches smith-injected hooks.agentSpawn entry
          └─> spawns: smith knowledge refresh-session --agent <name> --platform kiro
              └─> reads refresh-manifest.json (consent + source list)
                  └─> per session/always source:
                      materializeOneSource → write <id>.content + <id>.meta.json
```

Refresh failures never block a session — see [Failure behavior](#failure-behavior).

---

## See also

- [Bundle anatomy](./02-bundle-anatomy.md#knowledge) — where the `knowledge` block fits inside `agent.config.json`.
- [Installing and rendering](./03-installing-and-rendering.md#per-platform-output) — how the cross-platform read-grants are injected into Claude Code's `additionalDirectories` and Codex's `allowed_external_directories`.
- [Doctor](./10-doctor.md) — how `smith doctor` reports the resolved Atlassian credential tier.
- [Paths and state](./13-paths-and-state.md#per-agent-knowledge-directories) — every file knowledge writes, with absolute paths and writers.
- [CLI reference](./14-cli-reference.md#knowledge) — `knowledge` subcommand reference (synopsis, flags, exit codes).
