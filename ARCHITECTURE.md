# How agent-smith works — a visual tour

You author one bundle. Smith renders five platform-specific outputs. The diagrams below show where each step lives, what data moves between the parts, and what happens when you run the single most important command in the system.

> **What's new in v2.** v2.0 added a **compile stage** (progressive-disclosure TOC + sidecars) between materialize and translate, a fifth install target — **AGENTS.md** (Cursor / Windsurf / Aider / Copilot / Codex CLI / Junie / Roo / Zed / Warp / Gemini CLI) — and an optional per-agent **BM25 retrieval MCP server** (`smith knowledge serve`). v2.1 made compile the smart default (auto-flips when the corpus overflows the inline budget) and added a GUI per-source editor + MCP-wiring toggle. Operational depth lives in [`guide/16 — Knowledge compiler`](./guide/16-knowledge-compiler.md) and the v2 design plan (`docs/plans/2026-05-31-knowledge-compiler-v2-design.md`); this doc is a summary refresh.

> **30-second mental model**
>
> - **Bundle** = source. Four files: `IDENTITY.md`, `EXPERTISE.md`, `SOUL.md`, `agent.config.json` (plus `USER.md`).
> - **Catalog** = a directory of bundles, registered with smith.
> - **Install** = render a bundle into one or more platforms (OpenCode, Claude Code, Codex, Kiro, AGENTS.md).
>
> Everything else in this doc elaborates on those three nouns.

If you're going to run one command first, run `smith status` — it shows you what state smith owns on your machine, with no side-effects.

---

## Core vocabulary (read this first)

The terms below appear in every diagram. Long-tail terms live in the [full glossary](#full-glossary) at the end.

| Term | What it is |
|---|---|
| **Bundle** | The 4-file source-of-truth for an agent: `IDENTITY.md` + `EXPERTISE.md` + `SOUL.md` + `agent.config.json`, plus a `USER.md` (symlink or stub). |
| **Catalog** | A directory of bundles, registered with smith. Three kinds: `user-global` (your default `~/.config/agent-smith/agents/`), `project` (per-repo), `registered` (typically a shared git remote). |
| **Install target** | A platform smith can render into: **OpenCode**, **Claude Code**, **Codex**, **Kiro**, or **AGENTS.md**. Each target has its own file layout and frontmatter shape; AGENTS.md is the cross-tool plain-markdown convention read by Cursor / Windsurf / Aider / Copilot / Codex CLI / Junie / Roo / Zed / Warp / Gemini CLI. |
| **Knowledge source** | External content (file, URL, git repo, Confluence page, Jira issue) attached to an agent in `agent.config.json`. Fetched once, cached, then inlined, written as a sidecar, or rolled into a compiled TOC at install time. |
| **Compile stage** | The v2 pipeline step between materialize and translate. Turns the materialized knowledge cache into a TOC stanza (≤150 lines) + sidecars + `compile-manifest.json`. Smart-default in v2.1: flips on automatically when the corpus would overflow the inline budget. See [`guide/16`](./guide/16-knowledge-compiler.md). |
| **Retrieval server** | Optional per-agent stdio MCP server (`smith knowledge serve <agent> --stdio`) that exposes `knowledge.search` (BM25) and `knowledge.fetch` over the materialized cache. Off by default; opted into via the bundle's `mcpServers` block. |
| **Translator** | The platform-specific code that converts the canonical assembled agent into the right shape for one target. One translator per platform (5 total), in `src/core/translators/`. |
| **USER.md** | Your shared cross-agent context. Symlinked into personal bundles so every agent on your machine inherits it; stubbed in shared catalogs so the bundle is safe to commit. |

---

## 1. Component map — what's in the system

The system has four zones: **what you type** (the CLI), **what smith owns** (state on disk), **what gets written** (install targets), and **what smith reaches out to** (external services).

```mermaid
flowchart TB
    subgraph CLI["smith CLI — what you type"]
        L["Lifecycle<br/>init, status, doctor,<br/>update, daemon, gui, jack-out,<br/>config"]
        A["smith agent<br/>init, install, register,<br/>validate, list, uninstall,<br/>reconfigure, sync, ..."]
        S["smith skill<br/>install, register, list,<br/>sync, validate, ..."]
        K["smith knowledge<br/>add, fetch, list,<br/>validate, ..."]
    end

    subgraph State["Smith-owned state — ~/.config/agent-smith/"]
        Reg["registry.json<br/>agent catalogs"]
        SReg["skill-catalogs.json<br/>skill catalogs"]
        Manifest["installed-agents.json<br/>installed-skills.json<br/>(paths + content hashes)"]
        UserMD["USER.md<br/>cross-agent context"]
        Bundles["agents/&lt;name&gt;/<br/>bundle source files"]
        Knowledge["knowledge/&lt;agent&gt;/<br/>materialized sources<br/>+ compile-manifest.json"]
    end

    subgraph Targets["Install targets — rendered agents"]
        OC["OpenCode<br/>~/.config/opencode/"]
        CC["Claude Code<br/>~/.claude/"]
        CX["Codex<br/>~/.agents/skills/"]
        KR["Kiro<br/>~/.kiro/agents/"]
        AM["AGENTS.md<br/>~/AGENTS.md<br/>(or project-root)"]
    end

    subgraph External["External services — optional"]
        Git["Git remotes<br/>(catalogs, knowledge)"]
        Web["HTTP(S)<br/>(URL sources, schema)"]
        Atlassian["Atlassian<br/>(Confluence, Jira)"]
    end

    CLI -->|reads / writes| State
    CLI -->|renders to| Targets
    CLI -.->|optional fetch| External
    State -.->|cached from| External
    Targets -.->|inherits| UserMD

    classDef cli fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
    classDef state fill:#fff8e1,stroke:#f57c00,color:#e65100
    classDef target fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
    classDef ext fill:#fce4ec,stroke:#c2185b,color:#880e4f
    class L,A,S,K cli
    class Reg,SReg,Manifest,UserMD,Bundles,Knowledge state
    class OC,CC,CX,KR,AM target
    class Git,Web,Atlassian ext
```

**What this tells you:**
- The CLI has four flavors of command (lifecycle + three namespaces). Each verb either reads/writes state, renders to targets, or both.
- Smith owns one directory (`~/.config/agent-smith/`). Everything else is either user input (commands) or output (rendered files on platforms).
- External calls are dashed because they're optional — you can run the whole system offline once knowledge is cached.
- Each platform has its own file layout: OpenCode and Claude Code use `agents/` + `skills/` directories; Codex installs agents *as* skills (`<name>/SKILL.md`); Kiro consumes a single JSON file per agent; AGENTS.md is a single plain-markdown file at the project or home root that Cursor / Windsurf / Aider / Copilot / Codex CLI / Junie / Roo / Zed / Warp / Gemini CLI all read.
- The five targets are reached from one bundle: `targets: ["opencode", "claude-code", "codex", "kiro", "agents-md"]`. When AGENTS.md is on the list and `claude-code` is too, the claude-code translator emits a 1-line CLAUDE.md pointer instead of a duplicate body.
- `knowledge/<agent>/` holds the materialized cache plus (for compiled bundles) `compile-manifest.json` — the v2 record of what TOC line each source produced and the hash that drives drift detection.

> **Want detail?** [`guide/13-paths-and-state.md`](./guide/13-paths-and-state.md) — every path smith reads or writes. [`guide/03-installing-and-rendering.md`](./guide/03-installing-and-rendering.md) — what each translator emits.

---

## 2. Data-flow — what moves through the system

Smith is a **content-translation pipeline**: author bundles in one canonical shape; render to five platform-specific shapes.

```mermaid
flowchart LR
    %% Inputs from author/user
    Author(("👤 You"))
    GitSrc[("📡 Git remote<br/>shared catalog")]
    URLSrc[("🌐 URL / API")]

    %% Smith-owned canonical layer
    subgraph Smith["💾 Canonical state (~/.config/agent-smith)"]
        direction TB
        BundleData["Bundle source<br/>(IDENTITY/EXPERTISE/SOUL/<br/>USER + config.json)"]
        KnowledgeData["Materialized knowledge<br/>(files, fetched docs, git clones)"]
        Compiled["Compile stage (v2)<br/>TOC stanza + sidecars<br/>+ compile-manifest.json"]
        RegistryData["Catalogs<br/>(agent + skill)"]
    end

    %% Rendered, per-platform outputs
    subgraph Rendered["📦 Rendered outputs (per platform)"]
        direction TB
        OCOut["OpenCode<br/>markdown +<br/>frontmatter"]
        CCOut["Claude Code<br/>markdown +<br/>frontmatter"]
        CXOut["Codex<br/>SKILL.md<br/>directory"]
        KROut["Kiro<br/>JSON agent<br/>file"]
        AMOut["AGENTS.md<br/>plain markdown<br/>(cross-tool)"]
    end

    Author -->|smith agent init / add| BundleData
    Author -->|smith agent / skill register| RegistryData
    GitSrc -.->|smith knowledge add git| KnowledgeData
    URLSrc -.->|smith knowledge add url/confluence/jira| KnowledgeData
    GitSrc -.->|catalog pull| RegistryData

    KnowledgeData -->|compile<br/>(smart-default v2.1)| Compiled

    BundleData -->|assembler + translator| OCOut
    BundleData -->|assembler + translator| CCOut
    BundleData -->|assembler + translator| CXOut
    BundleData -->|assembler + translator| KROut
    BundleData -->|assembler + translator| AMOut
    Compiled -->|TOC + sidecar| OCOut
    Compiled -->|TOC + sidecar| CCOut
    Compiled -->|TOC + sidecar| CXOut
    Compiled -->|TOC + sidecar| KROut
    Compiled -->|TOC + sidecar| AMOut

    classDef src fill:#fff,stroke:#999,color:#333,stroke-dasharray: 4 2
    classDef canonical fill:#fff8e1,stroke:#f57c00,color:#e65100
    classDef rendered fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
    class Author,GitSrc,URLSrc src
    class BundleData,KnowledgeData,Compiled,RegistryData canonical
    class OCOut,CCOut,CXOut,KROut,AMOut rendered
```

**What this tells you:**
- You write **one** bundle. Smith renders **five** outputs (one per supported platform: OpenCode, Claude Code, Codex, Kiro, and AGENTS.md).
- Knowledge sources come from anywhere (local files, the web, Confluence, Jira, git repos) — they get *materialized* into smith's state directory first. The v2 **compile stage** (smart-default in v2.1) then turns the cache into a TOC stanza + sidecars; small corpora skip compile and stay v1-inline.
- The same compiled output feeds every translator — translators don't know whether they're consuming a v1 inline body or a v2 TOC.
- Shared agent catalogs are versioned in git. Smith pulls them just like any other source.

> **Want detail?** [`guide/02-bundle-anatomy.md`](./guide/02-bundle-anatomy.md) — the bundle file format. [`guide/04-knowledge.md`](./guide/04-knowledge.md) — knowledge sources end-to-end. [`guide/06-permissions-and-platforms.md`](./guide/06-permissions-and-platforms.md) — translator differences.

---

## 3. Install lifecycle — `smith agent install <name>`

The single most important command in the system. Understanding what happens when you run it explains 80% of the codebase.

```mermaid
sequenceDiagram
    autonumber
    actor U as You
    participant CLI as smith CLI
    participant Reg as registry.json
    participant BL as Bundle loader
    participant Val as Validator
    participant Skl as Required-skills<br/>resolver
    participant K as Knowledge<br/>pipeline
    participant Cmp as Compile<br/>(TOC + manifest)
    participant Asm as Assembler<br/>+ translators
    participant Ext as External<br/>(git/url/atlassian)
    participant Plt as Platform dirs<br/>(OpenCode/Claude/Codex/<br/>Kiro/AGENTS.md)
    participant Man as installed-agents.json

    U->>CLI: smith agent install code-reviewer
    CLI->>Reg: Find which catalog owns "code-reviewer"
    Reg-->>CLI: user-global / project / registered
    CLI->>BL: Load bundle files
    BL-->>CLI: IDENTITY + EXPERTISE + SOUL + USER + config

    CLI->>Val: Validate bundle (schema + shape)
    alt invalid
        Val-->>U: ✗ exit 1 with reasons
    end

    CLI->>Skl: Check requires.skills
    alt missing skills
        Skl-->>U: prompt / auto-install / warn<br/>(per --yes / --with-skills / --no-skills)
    end

    loop for each knowledge source in config
        CLI->>K: Acquire source
        K->>Ext: Fetch (git / url / confluence / jira)
        Ext-->>K: raw content (cached)
        K-->>CLI: materialized + token-budgeted
    end

    CLI->>Cmp: Compile (smart-default v2.1)
    Note over Cmp: When corpus > inline budget<br/>(or compile.progressive=true):<br/>build TOC stanza + sidecars,<br/>write compile-manifest.json
    Cmp-->>CLI: CompiledKnowledge (TOC + sidecars)

    CLI->>Asm: Assemble final agent body
    Note over Asm: Merge persona files,<br/>inline knowledge or splice<br/>compiled TOC stanza,<br/>apply permission preset

    loop for each target platform
        Asm->>Plt: Translate to platform-specific shape
        Note over Plt: OpenCode/Claude = markdown + frontmatter<br/>Codex = SKILL.md directory<br/>Kiro = JSON agent file<br/>AGENTS.md = plain markdown (cross-tool)
    end

    Plt-->>Man: Record path + content hash
    Man-->>U: ✓ rendered to N platforms<br/>(byte-for-byte idempotent on rerun)
```

### Concrete trace: `smith agent install code-reviewer` with all five targets

`targets: [opencode, claude-code, codex, kiro, agents-md]`

```
1. Reg lookup       →  ~/.config/agent-smith/agents/code-reviewer/  (user-global)
2. Bundle load      →  IDENTITY.md, EXPERTISE.md, SOUL.md, USER.md (symlink), agent.config.json
3. Validate         →  ✓ schema OK, action-phrase description OK, all 5 targets supported
4. Required skills  →  declares the-architect → already installed, skip
5. Knowledge fetch  →  no sources declared, skip
6. Compile          →  no sources → no TOC stanza; skip (smart-default falls through)
7. Assemble         →  merged body (persona + USER.md + permission preset "read-edit")
8. Translate        →  OpenCode:    ~/.config/opencode/agents/code-reviewer.md
                       Claude Code: ~/.claude/agents/code-reviewer.md   (1-line "See AGENTS.md.")
                       Codex:       ~/.agents/skills/code-reviewer/SKILL.md
                       Kiro:        ~/.kiro/agents/code-reviewer.json
                       AGENTS.md:   ~/AGENTS.md
9. Manifest         →  installed-agents.json: 5 entries, each {path, sha256}
10. Result          →  ✓ installed to 5 platforms
```

When the bundle declares knowledge sources large enough to overflow the inline budget, step 6 produces a TOC stanza + sidecars + `compile-manifest.json`; the assembler splices the TOC into the body and the sidecars are written next to (or symlinked into) each target's per-agent knowledge dir.

**What this tells you:**
- Install is a **pipeline**: lookup → load → validate → resolve deps → fetch knowledge → assemble → translate → write manifest. Each stage has clear inputs and outputs.
- Knowledge fetching is the slow part. Everything else is local file I/O.
- The same pipeline runs for one agent (`install`) or all of them (`install-all`).
- The **manifest write** at the end is what makes uninstall safe: smith only deletes files it recorded, and refuses if the on-disk hash doesn't match (you or another tool edited it).

> **Want detail?** [`guide/03-installing-and-rendering.md`](./guide/03-installing-and-rendering.md) — manifest semantics, idempotency, `--force` rules. [`guide/12-error-handling.md`](./guide/12-error-handling.md) — every exit code and `SmithError` variant on this path.

---

## 4. Full glossary

Every term that appears in this document, alphabetized. The first six are summarized at the top under [Core vocabulary](#core-vocabulary-read-this-first); the rest live here.

| Term | What it is | Where it lives |
|---|---|---|
| **Agent** | A persistent AI assistant persona with its own identity, expertise, and knowledge. The thing you actually use day-to-day in OpenCode / Claude Code / Codex / Kiro / any AGENTS.md-aware tool. | Authored in a *bundle*; rendered to platform dirs. |
| **agent.config.json** | Per-bundle config: description, targets, model tier, permission preset, knowledge sources, required skills, optional `compile` block, `mcpServers` declarations. | Inside each bundle. |
| **agents-md** | The fifth install target. Translator emits a single plain-markdown `AGENTS.md` consumed by Cursor / Windsurf / Aider / Copilot / Codex CLI / Junie / Roo / Zed / Warp / Gemini CLI. Default install root is `$HOME` (override via `targetOptions.agentsMd.path`). When both `claude-code` and `agents-md` target a project root, the claude-code translator emits a 1-line CLAUDE.md pointer. | `src/core/translators/agents-md.ts`; output at `~/AGENTS.md` or a configured path. |
| **APM import** | One-way importer (`smith agent init --from-apm <path-or-url>`) that turns a Microsoft `apm.yml` into a smith bundle. APM runtimes map onto smith targets (copilot/cursor/gemini/windsurf collapse to `agents-md`); APM `references[]` become smith knowledge sources. | `src/core/apm-import.ts` |
| **Assembler** | The function that merges IDENTITY + EXPERTISE + SOUL + USER + knowledge (inline body or compiled TOC stanza) into the final agent body before translation. | `src/core/assembler.ts` |
| **BM25 index** | Lexical-only (no embeddings) ranking index built in-memory at retrieval-server startup over the agent's materialized knowledge dir. ~200 LOC, ms-scale build, no model dependency. | `src/core/knowledge/bm25.ts` |
| **Bundle** | A folder with the four persona files (IDENTITY/EXPERTISE/SOUL/USER) and `agent.config.json`. The canonical source-of-truth for an agent. | `~/.config/agent-smith/agents/<name>/` (user-global) or any registered catalog. |
| **Catalog** | A directory containing one or more bundles, registered with smith. Agent kinds: `user-global`, `project`, `registered`. Skill kinds: `user-global`, `user-local`, `team-shared`. | Anywhere on disk; tracked in `registry.json` / `skill-catalogs.json`. |
| **Compile stage** | The v2 pipeline step between materialize and translate. Produces a TOC stanza (≤150 lines), sidecars, and `compile-manifest.json`. Smart-default in v2.1: flips on automatically when the materialized corpus would overflow the inline budget; explicit `compile.progressive: true/false` overrides; explicit `delivery: "inline"` on any source pins the bundle to v1. Manual entry point: `smith knowledge compile <agent>`. | `src/core/knowledge/compile.ts`; `src/core/knowledge/pipeline.ts` (`shouldAutoCompile`). |
| **compile-manifest.json** | Per-source TOC line, on-disk path, retrieval mode, content hash, byte / token totals — the v2 record of "what compiled to what." Drives idempotency, doctor's `knowledge-compile` drift detection, and the GUI's per-source preview. | `~/.config/agent-smith/knowledge/<agent>/compile-manifest.json` |
| **Daemon** | Optional background watcher. On a 15-minute tick, it `git pull`s every `registered` catalog (agents and skills); on a separate 5-minute tick, it refreshes `ttl`-mode knowledge sources. Writes a heartbeat file to `~/.local/state/agent-smith/daemon.heartbeat.json`. Does **not** pull the agent-smith install itself — that's `smith update`. | `smith daemon start/stop/status` |
| **Doctor** | Health-check command. Verifies platform installs, model resolution, skill drift, registry hygiene, Atlassian credentials, knowledge-refresh hooks, knowledge-prompt-disk-consistency, remote-catalogs, and duplicate-catalogs. | `smith doctor` |
| **EXPERTISE.md** | One of the four persona files. Domain knowledge, methodology, techniques the agent applies. | Inside each bundle. |
| **IDENTITY.md** | One of the four persona files. The agent's role and primary purpose ("you are a code reviewer who…"). | Inside each bundle. |
| **installed-agents.json** | Manifest of every rendered agent file: path + content hash per platform. Drives idempotent reinstall, `would-clobber` refusal, and hash-mismatch refusal on uninstall. | `~/.config/agent-smith/installed-agents.json` |
| **installed-skills.json** | Same manifest pattern, for skills. | `~/.config/agent-smith/installed-skills.json` |
| **Install target** | A platform smith renders agents into: **OpenCode**, **Claude Code**, **Codex**, **Kiro**, or **AGENTS.md** (cross-tool). Each has its own file layout and frontmatter shape. | `~/.config/opencode/agents/`, `~/.claude/agents/`, `~/.agents/skills/<name>/SKILL.md`, `~/.kiro/agents/<name>.json`, `~/AGENTS.md` (or configured path). |
| **Knowledge source** | External content (file, dir, glob, URL, git repo, Confluence space, Jira query) attached to an agent. Fetched once, cached, then either inlined (v1 / explicit `delivery: "inline"`), written as a sidecar (v1 / `delivery: "file"`), or rolled into a compiled TOC + sidecar (v2 compile stage). | Declared in `agent.config.json`; materialized to `~/.config/agent-smith/knowledge/<agent>/`. |
| **Permission preset** | One of `read-only`, `read-edit`, `full`. Maps to platform-specific permission JSON during translation. Custom rules via `--permission-json`. | Set per bundle; applied by translators. |
| **Platform conventions** | Optional per-platform context smith can inject at install time. Kiro is the first registered case (workspace + global steering files). Bundles opt-in via `platformConventions` in config. | `src/core/platform-conventions.ts`; user-global preference at `~/.config/agent-smith/conventions.json`. |
| **registry.json** | Smith's record of every agent catalog it knows about. | `~/.config/agent-smith/registry.json` |
| **Rendered files** | The platform-specific agent file(s) smith writes into install targets. Re-derivable from the bundle at any time. | Platform agent dirs. |
| **Required skills** | Runtime skill dependencies an agent needs (`requires.skills` in config). Resolved at install time (prompt / auto-install / warn). | Declared in `agent.config.json`. |
| **Retrieval server** | Optional per-agent stdio MCP server (`smith knowledge serve <agent> --stdio`) that exposes `knowledge.search(query, k)` (BM25) and `knowledge.fetch(path, range?)` (range-bounded read) over the materialized cache. Off by default; opted into via the bundle's `mcpServers` block + the AI client's own MCP config. Foreground per-session — MCP stdio handles lifecycle. | `src/core/knowledge/serve-mcp.ts` |
| **Skill** | A standalone capability (Anthropic Agent Skills format) installable across platforms. Independent from agents; agents can require skills, but skills don't require agents. | `skills/<name>/SKILL.md`; installed to platform skill dirs. |
| **skill-catalogs.json** | Smith's record of every skill catalog. Parallel to `registry.json` but for skills. | `~/.config/agent-smith/skill-catalogs.json` |
| **SOUL.md** | One of the four persona files. Tone, voice, values — how the agent communicates. | Inside each bundle. |
| **Status** | Quick summary of where smith's state lives and what's registered. | `smith status` |
| **Translator** | Platform-specific code that converts the canonical assembled agent into OpenCode / Claude Code / Codex / Kiro / AGENTS.md shape. One translator per platform (5 total). | `src/core/translators/` |
| **USER.md** | One of the four persona files — but unlike the others, it's typically a *symlink* to your shared `~/.config/agent-smith/USER.md`. For bundles in personal catalogs (`user-global`, `project`) it's a symlink; for bundles in `registered` catalogs (created with `--catalog`) it's a stub file so the bundle is safe to commit. Every agent automatically inherits your cross-agent context (name, role, preferences). | `~/.config/agent-smith/USER.md` (canonical); symlinked into personal bundles, stubbed in registered ones. |

---

## Future work

This refresh updates the diagrams and glossary for v2/v2.1 factual accuracy but keeps the doc summary-level. Dedicated sections that would deepen coverage — and are tracked as follow-up work, not part of this MVP refresh:

- **Compile stage — progressive disclosure** — full walkthrough of the smart-default heuristic, the TOC algorithm, and the `inline` vs. `file` vs. `compile` decision tree. For now: see [`guide/16 — Knowledge compiler`](./guide/16-knowledge-compiler.md) and `docs/plans/2026-05-31-knowledge-compiler-v2-design.md`.
- **Retrieval MCP server lifecycle** — a sequence diagram for `smith knowledge serve` showing index build, `knowledge.search` / `knowledge.fetch`, and how the AI client spawns the server. Operational reference is in [`guide/16`](./guide/16-knowledge-compiler.md#smith-knowledge-serve---stdio).
- **AGENTS.md as a fifth target** — placement rules, the CLAUDE.md pointer interaction, and the per-runtime read patterns. See [`guide/16 — AGENTS.md target`](./guide/16-knowledge-compiler.md#the-agents-md-target).
- **APM import** — the `apm.yml` → smith bundle mapping (runtimes, references, defaults applied). See [`guide/16 — APM import`](./guide/16-knowledge-compiler.md#apm-import-smith-agent-init---from-apm).
