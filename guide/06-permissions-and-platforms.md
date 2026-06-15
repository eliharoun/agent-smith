# Permissions and platforms

> Permissions decide which tools an agent may use. agent-smith holds a single
> canonical permission model and translates it for each target platform — and
> each platform supports a different subset. This spoke covers the canonical
> model, the three presets, the per-platform translator behavior, the tool-map
> machinery, and the documentation-only `mcpServers` declaration. Read this
> when you're authoring `permission` blocks, debugging a missing tool on a
> specific platform, or wondering why `mcpServers` doesn't seem to "do"
> anything.

## Mental model

Three things travel together in this part of the system:

1. **The canonical permission block.** A field on `agent.config.json` that
   describes, in agent-smith's own vocabulary, what tools the agent may use.
2. **Per-platform translators.** Each platform has different permission
   semantics. The translators take the canonical block and emit
   platform-native permission information (or warn when a feature has no
   equivalent).
3. **The `mcpServers` declaration.** A documentation-only list. agent-smith
   never installs MCP servers and never writes platform MCP config; it only
   reads each platform's MCP config to surface advisory warnings when a
   declared server isn't present.

OpenCode is the reference platform — its permission model is a strict
superset of the others. Anything you can express in `agent.config.json`
maps cleanly to OpenCode. Claude Code and Codex are positive-allowlist
systems with no `ask` or `deny` semantics; the translators downgrade
gracefully and warn. Kiro is a positive-allowlist system but, uniquely
among non-OpenCode targets, has a first-class `ask` semantic (a tool can
be advertised in `tools[]` but withheld from `allowedTools[]`, prompting
the user at invocation time).

## The canonical permission model

The `permission` field on `agent.config.json` is a record keyed by
**capability group** (e.g. `read`, `edit`, `bash`, `task`, `skill`). The
value of each group is either a bare action or a per-pattern record.

The three permitted **actions** are defined at `src/core/types.ts`:

```ts
export const PERMISSION_ACTIONS = ["allow", "ask", "deny"] as const;
```

The structural schema is at `src/core/config-schema.ts`:

```ts
const PermissionAction = z.enum(PERMISSION_ACTIONS);
const PermissionGroupValue = z.union([
  PermissionAction,
  z.record(z.string(), PermissionAction),
]);
```

That is: each group value is either an action string or a `Record<pattern,
action>`. The schema does not constrain the set of group names. At
translation time, groups in the canonical `KNOWN_PERMISSION_GROUPS` set
(`src/core/permission-mapping.ts`) that have no mapping on the current
platform — e.g., `external_directory` on Claude Code — are silently
skipped. Groups *not* in `KNOWN_PERMISSION_GROUPS` are treated as typos
and produce a warning listing the supported group names.

Example mixing both forms:

```json
{
  "permission": {
    "read": "allow",
    "edit": "allow",
    "bash": { "git *": "allow", "npm *": "allow", "*": "deny" },
    "skill": { "brainstorming": "allow", "*": "deny" },
    "webfetch": "ask"
  }
}
```

A bare action applies the action to every tool the group expands to. A
per-pattern record matches against the underlying tool's argument string
(e.g. the bash command line, the skill name) using glob-style patterns;
OpenCode evaluates these natively. Claude Code and Codex have no per-pattern
runtime, so they collapse the map to its broadest action and warn — see
[Per-platform translator behavior](#per-platform-translator-behavior).

## The three permission presets

Three named presets are available via `--permission <name>` on
`agent init`. They are defined at `src/core/permission-presets.ts`.

| Preset | read/glob/grep/list/lsp | edit | bash | task | webfetch / websearch | external_directory | skill |
|---|---|---|---|---|---|---|---|
| `read-only` | allow | deny | deny | deny | deny | deny | **allow** |
| `read-edit` | allow | allow | deny | allow | deny | deny | **allow** |
| `full` | allow | allow | allow | allow | allow | allow | **allow** |

Three things to notice:

- **All three presets default `skill: "allow"`.** An agent created with any
  preset can load skills out of the box. To lock skills down you must
  override explicitly — see [The skill capability cookbook](#the-skill-capability-cookbook).
- **`read-only` denies `task`** (sub-agent dispatch). If you want a
  read-only agent that can still spawn sub-agents, supply a
  `--permission-json` override.
- **`read-edit` allows `task` but denies `bash`.** This is the
  "code-review with hands but no shell" preset.

### `--permission-json` overrides

Both flags are accepted on `agent init`. `--permission-json` overrides
`--permission` if both are supplied.

```bash
# Use a preset
smith agent init reviewer --permission read-edit

# Provide a literal JSON permission block (overrides --permission)
smith agent init runner --permission-json '{
  "read": "allow",
  "edit": "allow",
  "bash": { "git *": "allow", "*": "deny" },
  "skill": "allow"
}'
```

The JSON value must conform to the schema above: each top-level key is a
group name; each value is either an action string (`"allow" | "ask" |
"deny"`) or a `Record<pattern, action>`. The schema permits any group name,
but only groups that appear in the relevant tool map have any effect on
non-OpenCode targets.

## The skill capability cookbook

`skill` controls whether an agent may load installed skills via the `Skill`
tool. All three presets default to `skill: "allow"`, so an agent created
with any preset can load skills out of the box.

OpenCode supports per-skill rules via a pattern map; Claude Code and Codex
have no per-skill granularity, so a pattern map collapses to the broadest
action and emits a warning. Codex has no native skill-tool runtime at all,
so any `permission.skill` declaration produces an explicit warning and is
otherwise ignored — see `src/core/translators/codex.ts`.

```bash
# Allow all skills (default — no need to set explicitly)
smith agent init foo --permission read-edit

# Block all skills
smith agent init foo --permission-json '{"read":"allow","edit":"allow","skill":"deny"}'

# Allow only specific skills (OpenCode honors this; others collapse + warn)
smith agent init foo --permission-json \
  '{"skill":{"brainstorming":"allow","test-driven-development":"allow","*":"deny"}}'

# Allow all skills except specific ones (OpenCode honors this; others collapse + warn)
smith agent init foo --permission-json '{"skill":{"deprecated-skill":"deny","*":"allow"}}'
```

`permission.skill` gates the runtime `Skill` tool. It is distinct from
`requires.skills`, which declares which skills must be installed for the
agent to function. See [guide/05-skills.md](./05-skills.md) for the
canonical home of `requires.skills`.

## Per-platform translator behavior

Each translator takes the same canonical `agent.config.json` and produces
target-native frontmatter plus a markdown body.

| Concept | OpenCode | Claude Code | Codex | Kiro |
|---|---|---|---|---|
| Output format | markdown + YAML frontmatter | markdown + YAML frontmatter | markdown + YAML frontmatter | strict JSON document |
| Top-level fields emitted | `description`, `mode?`, `model?`, `temperature?`, `color?`, `permission?` | `name`, `description`, `model?`, `allowed-tools?` | `name`, `description`, `allowed_tools?` | `name`, `description`, `modelId`, `systemPrompt`, `tools[]`, `allowedTools[]`, `resources[]` |
| Permission model | full canonical (allow / ask / deny + per-pattern) | positive allowlist (`allowed-tools`) | positive allowlist (`allowed_tools`) | two-tier: `tools[]` (advertised) + `allowedTools[]` (auto-allowed); difference is the native ask set |
| `allow` action | preserved verbatim | tool added to `allowed-tools` | tool added to `allowed_tools` | tool in both `tools[]` and `allowedTools[]` |
| `ask` action | preserved verbatim | omitted from output, one warning per tool | omitted from output, one warning per tool | tool in `tools[]`, omitted from `allowedTools[]` (native ask) |
| `deny` action | preserved verbatim | omitted (allowlist semantics), one summary warning if any tools were denied | omitted (allowlist semantics), one summary warning if any tools were denied | tool omitted from both arrays |
| Per-pattern rules | preserved verbatim | collapsed to broadest action, one warning per group | collapsed to broadest action, one warning per group | collapsed to broadest action, one warning per group |
| `permission.skill` | per-skill rules supported | collapsed to broadest action, warning | warning emitted; otherwise ignored (no skill-tool runtime) | emitted as `skill://allow/<name>`, `skill://ask/<name>`, `skill://deny/<name>` URIs in `resources[]` |
| Per-agent model field | supported (`model:` literal in frontmatter) | tier-only via tool map; `model:` is the resolved tier literal | not supported (no per-agent model) | `modelId` is the resolved tier literal (static map) |
| `mode`, `temperature`, `color` | supported | not supported | not supported | not supported |
| Install layout | `<dir>/<name>.md` | `<dir>/<name>.md` | `<dir>/<name>/SKILL.md` (per-agent subdir) | `<dir>/<name>.json` |
| Tool vocabulary source | `data/opencode.config.schema.json` (canonical) | `data/claude-code-tool-map.json` | `data/codex-tool-map.json` | `data/kiro-tool-map.json` |

Source references: `src/core/translators/opencode.ts`,
`src/core/translators/claude-code.ts`,
`src/core/translators/codex.ts`,
`src/core/translators/kiro.ts`.

### OpenCode translator details

The OpenCode translator is a near-pure pass-through
(`src/core/translators/opencode.ts`). The canonical `permission` block
is embedded verbatim into the agent's frontmatter under the `permission`
key. Per-pattern rules, `ask` actions, and per-skill rules all flow through
unchanged. This is why OpenCode is treated as the reference platform: any
gap in expressing canonical permissions on OpenCode would be a bug.

### Claude Code translator details

The Claude Code translator
(`src/core/translators/claude-code.ts`) is positive-allowlist:

1. The canonical permission block is expanded against
   `data/claude-code-tool-map.json` to produce three buckets — `allow`,
   `ask`, `deny`.
2. Pattern-based warnings forwarded from the mapping module are emitted
   first.
3. **`ask` bucket:** Claude Code has no native ask semantic. Each tool in
   the bucket is omitted from `allowed-tools`, with one warning per tool:
   `Permission action 'ask' has no claude-code equivalent for tool '<tool>';
   omitting. Use 'allow' or 'deny'.`
4. **`deny` bucket:** denied tools are simply omitted. If any tools landed
   in the deny bucket, one summary warning is emitted: `claude-code has no
   deny semantic; denied tools are simply omitted from allowed-tools.`
5. `allowed-tools: <comma-list>` is emitted only when the `allow` bucket is
   non-empty.

### Codex translator details

The Codex translator (`src/core/translators/codex.ts`) parallels
Claude Code with two extras:

- **`permission.skill` and `deny` warnings are suppressed:** Codex uses a
  positive allowlist and has no native skill-tool runtime, so the `deny`
  summary warning and the `permission.skill` warning that would fire on
  virtually every install are intentionally suppressed to keep install
  output focused on actionable items.
- **`allowed_tools` is an array,** not a comma-separated string (snake_case
  per existing Codex convention).

The Codex tool vocabulary is not yet finalized upstream — see the `_meta`
note in `data/codex-tool-map.json:6`. Permission groups outside the map
(`task`, `webfetch`, `websearch`, `todowrite`, `skill`) are silently
skipped during expansion.

### Kiro translator details

The Kiro translator (`src/core/translators/kiro.ts`) is the only target
that emits a JSON document instead of markdown + frontmatter. The output
conforms to the vendored `data/kiro.agent-v1.schema.json` (strict —
`additionalProperties: false`) and contains:

- `name`, `description`, `modelId`, `systemPrompt` — direct from the canonical bundle and resolved tier (see [07-models.md](./07-models.md)).
- `tools[]` — the set of tools the agent *knows about*. Includes everything that resolved to `allow` or `ask`. Driven by `data/kiro-tool-map.json`.
- `allowedTools[]` — the subset that runs without confirmation. Includes only tools that resolved to `allow`. The set difference (`tools[] \ allowedTools[]`) is Kiro's native **ask** set: at invocation time, Kiro prompts the user for those tools. This is the only target with a first-class `ask` semantic.
- `resources[]` — knowledge dir read-grant (`file://<knowledgeDir>/**`), platform-conventions paths (e.g. `file://.kiro/steering/**/*.md`), and per-skill `skill://<action>/<name>` URIs from `permission.skill`. The skill URI vocabulary is documented in `src/core/translators/kiro.ts` and uses an agent-smith-specific scheme that Kiro does not natively interpret today; runtime/schema divergence is tracked in the design doc.

Behavior matrix for `permission.<group>: <action>` mapping to Kiro's two-tier surface:

| Action | `tools[]` | `allowedTools[]` |
|---|---|---|
| `allow` | yes | yes |
| `ask` | yes | no (native ask — user prompted at invocation) |
| `deny` | no | no |

Per-pattern records collapse to the broadest action and emit a warning, the same as Claude Code and Codex; Kiro has no native pattern-grade permission rules.

## Per-platform capability gaps

Stick to the six groups every translator supports — `read`, `glob`, `grep`,
`list`, `edit`, `bash` — when you want byte-equivalent permission semantics
across all four platforms. Beyond that:

- **OpenCode** supports the full canonical model: every action, every
  group, per-pattern rules, per-skill rules, and per-agent model overrides.
  Additional OpenCode-only groups (`lsp`, `external_directory`, `question`,
  `doom_loop`) are recognized by `KNOWN_PERMISSION_GROUPS` and silently
  skipped on platforms that have no equivalent.
- **Claude Code** silently drops `lsp` and `external_directory` (no
  equivalent). It additionally exposes an undocumented `todowrite` group
  not used by any preset; declare it via `--permission-json '{"todowrite":
  "allow", ...}'` if you want the `TodoWrite` tool on the allowlist.
  `ask` collapses to omission with a warning. Per-pattern and per-skill
  rules collapse to the broadest action and warn.
- **Codex** silently drops `task`, `webfetch`, `websearch`, `lsp`,
  `external_directory`, `skill`, and `todowrite`. It has no `ask` or `deny`
  runtime semantics (positive-allowlist by omission). It has no per-agent
  model field. Any `permission.skill` declaration emits an explicit
  warning.
- **Kiro** has a native `ask` semantic (the only non-OpenCode target that does).
  Tools mapped to `ask` land in `tools[]` but are absent from `allowedTools[]`,
  prompting the user at invocation time. `permission.skill` is preserved
  per-skill via `skill://` URIs in `resources[]`. Per-pattern records collapse
  to the broadest action with a warning. Schema is strict
  (`additionalProperties: false`); unknown groups are dropped.

## Tool maps and drift detection

Four data files define the per-platform vocabulary:

| File | Purpose |
|---|---|
| `data/opencode.config.schema.json` | The canonical OpenCode config schema (vendored upstream). Doctor's `opencode` section compares it against the live upstream schema. |
| `data/claude-code-tool-map.json` | Group → list of Claude Code tool names. Doctor's `claude-code` section diffs this against upstream docs. |
| `data/codex-tool-map.json` | Group → list of Codex tool names. Doctor's `codex` section diffs this against upstream. |
| `data/kiro-tool-map.json` + `data/kiro.agent-v1.schema.json` | Group → list of Kiro tool names, plus the strict agent JSON schema. Doctor's `kiro` section diffs both against upstream. |

When upstream changes, the on-disk file is "drifted". `smith doctor`
reports drift and remediation in the corresponding section — see
[guide/10-doctor.md](./10-doctor.md) for the full doctor catalog. The
typical remediation is to update the JSON file from the upstream source
and rerun doctor.

Doctor only reports on platforms whose CLI binary is on PATH; see
[guide/10-doctor.md → Platform auto-detection](./10-doctor.md#platform-auto-detection)
for the detection contract and the refusal behavior when no supported
platform is installed.

`agent-smith` ships these maps with `_meta.lastVerifiedDate` and
`_meta.sourceUrl` so the verification baseline is auditable.

## Discovering installed skills per platform

Skills are installed per-platform; `agent-smith` does not centralize a
runtime registry (it does maintain `installed-skills.json` for its own
bookkeeping — see [guide/05-skills.md](./05-skills.md)). To see what's
available at runtime:

- **Codex** — run `/skills` in the CLI or IDE to list user-invocable
  skills, or mention one inline with `$skill-name`. Skill directories are
  searched in this order: `.agents/skills/` (cwd up to repo root),
  `~/.agents/skills/`, `/etc/codex/skills/`, then bundled defaults.
- **Claude Code** — type `/` in the TUI to see user-invocable skills, or
  ask "what skills are available?". Skill directories: `~/.claude/skills/`
  (user) and `.claude/skills/` (project).
- **OpenCode** — run `/skills` in the CLI. Or inspect the filesystem
  directly: `~/.config/opencode/skills/` (user) and `.opencode/skills/`
  (project), plus skills bundled by installed plugins. Agents discover
  skills automatically through OpenCode's `skill` tool when
  `permission.skill` allows.
- **Kiro** — skills are in `~/.kiro/skills/` (user). Per-agent
  `permission.skill` rules are emitted into the agent's `resources[]`
  array as `skill://allow/<name>` / `skill://ask/<name>` /
  `skill://deny/<name>` URIs (an agent-smith convention; kiro's
  runtime URI handling for these is documented in the design doc).

`agent-smith` itself ships skills under
`~/.config/opencode/skills/` (OpenCode), `~/.claude/skills/` (Claude
Code), `~/.agents/skills/` (Codex), and `~/.kiro/skills/` (Kiro). The
`bootstrap` command propagates them to every detected platform; see
[guide/01-getting-started.md](./01-getting-started.md).

## Platform conventions

Some platforms have native context paths the user is expected to honor — Kiro's `.kiro/steering/**/*.md` is the canonical example. The bundle declares which conventions it requests for which targets; the user can override globally; the result is injected into the rendered output at install time.

### The 3-tier resolution

For each target a bundle installs to, agent-smith resolves the requested conventions in this precedence order (`src/core/platform-conventions.ts`):

1. **Bundle declaration** — `agent.config.json`'s `platformConventions: { <target>: ["<conv-id>", ...] }`. Always included; the bundle has expressed an explicit need.
2. **User-global override** — entries in `~/.config/agent-smith/conventions.json`'s `platformConventions.<target>.{explicit,denied}`. The user can pin a convention on or off across every bundle for that target.
3. **CLI / prompt / safe default** — when `--platform-conventions=accept-all` (or `--no-platform-conventions`) is passed, that flag wins; otherwise on a TTY the user is prompted; otherwise the safe default is to **reject** (don't inject — the safest interpretation of "no signal").

The CLI scalar parser (`src/cli/parse-platform-conventions.ts`) accepts four values: `accept-all`, `reject-all`, `use-defaults`, and `prompt`. See [14 — CLI reference](./14-cli-reference.md) for the full flag grammar.

### Rendered effect

Platform conventions resolve to a list of URIs. After the knowledge-grant pass, `injectPlatformConventions()` splices them into the rendered output:

| Target | Splice location | Registered conventions |
|---|---|---|
| Claude Code | (registered for prompt/UX/discovery; not auto-spliced today) | `workspace-memory` (`file://CLAUDE.md`, default on), `global-memory` (`file://~/.claude/CLAUDE.md`, default off) |
| OpenCode | (registered for prompt/UX/discovery; not auto-spliced today) | `workspace-agents-md` (`file://AGENTS.md`, default on), `global-agents-md` (`file://~/.config/opencode/AGENTS.md`, default off) |
| Codex | (registered for prompt/UX/discovery; not auto-spliced today) | `workspace-agents-md` (`file://AGENTS.md`, default on). User-global slot deferred (upstream ambiguous). |
| Kiro | appended to `resources[]` (sorted; deduped) | `workspace-steering` (`file://.kiro/steering/**/*.md`, default on), `global-steering` (`file://~/.kiro/steering/**/*.md`, default off) |
| agents-md | — | none (intentional — the target's output *is* `AGENTS.md`) |

Only Kiro's JSON-resources path is auto-spliced into rendered output today; for the markdown-frontmatter targets (Claude Code / OpenCode / Codex) the registry drives the install-time prompt, the user-global config, the `--platform-conventions` flag, and the GUI — but the URIs are not injected into the rendered file (advisory only).

The list is sorted and deduplicated before write so the manifest hash is idempotent across re-installs.

### User-global config (`conventions.json`)

```json
{
  "schemaVersion": 1,
  "platformConventions": {
    "kiro": {
      "default": "use-defaults",
      "explicit": ["workspace-steering"]
    }
  }
}
```

The `default` field sets the auto-resolution strategy (`accept-all`, `reject-all`, `use-defaults`, or `prompt`). The `explicit` list, when present, bypasses `default` and pins the exact convention IDs to use. The GUI's `/system/conventions` page (`gui/server/src/routes/conventions.ts`) reads/writes this file directly.

Each platform registers its native context-loading paths: Kiro — `workspace-steering` / `global-steering` (`.kiro/steering/**/*.md`); Claude Code — `workspace-memory` / `global-memory` (`CLAUDE.md`, `~/.claude/CLAUDE.md`); OpenCode — `workspace-agents-md` / `global-agents-md` (`AGENTS.md`, `~/.config/opencode/AGENTS.md`); Codex — `workspace-agents-md` (`AGENTS.md`). The `use-defaults` strategy resolves to each platform's `promptDefault: true` conventions (the workspace entry for every platform).

## MCP server dependencies

If your agent relies on [Model Context Protocol](https://modelcontextprotocol.io/)
servers — for example, a Linear MCP for ticket lookups or a GitHub MCP
for PR operations — you can list them in `agent.config.json`:

```json
{
  "name": "release-coordinator",
  "description": "Coordinates release ticketing and PR sweeps",
  "targets": ["opencode", "claude-code", "codex"],
  "modelTier": "balanced",
  "mcpServers": ["linear", "github"]
}
```

### What `mcpServers` actually does

**The `mcpServers` field is documentation only.** It produces exactly one
observable behavior: at install or `smith doctor` time, agent-smith reads
each target platform's MCP config file (read-only) and prints an advisory
warning for each named server that is not configured there.

That is the entire functional impact of the field. Source:
`src/io/mcp-availability.ts`.

### What `mcpServers` does NOT do

To prevent confusion, the field is explicitly **not**:

- **It does not install MCP servers.** You install them yourself, once per
  platform, using each platform's native MCP commands (see below).
- **It does not edit any platform's MCP config.** agent-smith only reads
  these files. Missing or unreadable files are treated as "this user
  doesn't run that platform" and silently skipped
  (`src/io/mcp-availability.ts`).
- **It does not enforce.** Agent install proceeds even when warnings fire.
  No exit code is set on missing servers.
- **It does not allowlist or scope per-agent MCP access.** On every
  supported platform, MCP servers are configured globally and are
  available to every agent that platform runs. Listing `["linear"]` does
  not prevent the agent from calling `github` MCP tools if the platform
  has GitHub MCP installed.
- **It does not validate MCP server health.** Only presence in the config
  is checked; a misconfigured or unreachable server still counts as
  "configured" for this check.
- **It does not write any MCP-related field into the generated agent
  file.** The `.md` files agent-smith emits contain no MCP configuration,
  no `mcp__*` allowlist entries, and no per-server gating.

In short: setting `mcpServers` and omitting it produce **identical
generated agent files**. The only difference is whether `agent-smith`
nags you about missing platform-side configuration.

For real per-agent MCP allowlisting (a feature agent-smith does not
currently provide), the translators would need to emit platform-native
MCP gating into each agent file. That work has not been done.

### Bundle-level MCP dependency declarations

A bundle that depends on MCP servers being available on the recipient's host can declare `mcp.required[]` and `mcp.peer[]` at the bundle root. These are read by `smith agent install` *before* render and produce a hard refusal (or warning, for `peer`) when a named server is absent from every targeted platform's MCP config. Unlike per-agent `mcpServers[]` (advisory-only), `mcp.required[]` gates install. See [02-bundle-anatomy.md § `mcp`](./02-bundle-anatomy.md#mcp) for the schema and [04-knowledge.md](./04-knowledge.md) for use cases involving knowledge source routing.

### Per-platform MCP install commands

Use the platform-native commands to register the MCP server on each
platform you want to use it from. agent-smith does not do this for you.

```bash
# OpenCode — edits ~/.config/opencode/opencode.json under the `mcp` key
opencode mcp add linear --type http https://mcp.linear.app/sse
opencode mcp list

# Claude Code — edits ~/.claude.json (scope: --scope user|project|local)
claude mcp add --transport sse linear https://mcp.linear.app/sse --scope user
claude mcp list

# Codex — edits ~/.codex/config.toml under [mcp_servers.<name>]
codex mcp add linear -- npx -y @linear/mcp-server
codex mcp list
```

Confirm the server is live in the relevant TUI: `/mcp` in Codex shows
active servers; Claude Code's `/mcp` shows status and OAuth state;
OpenCode exposes `opencode mcp list`.

### Where agent-smith looks for installed MCP servers

To produce its warnings, agent-smith reads (never writes) these files. A
missing file is silent — agent-smith assumes you don't use that platform.

| Platform | File | Key smith reads |
|---|---|---|
| OpenCode | `~/.config/opencode/opencode.json` | `mcp.<serverName>` |
| Claude Code | `~/.claude.json` | `mcpServers.<serverName>` (user scope) UNION `projects.<path>.mcpServers.<serverName>` (local scope) — both are checked |
| Codex | `~/.codex/config.toml` | `[mcp_servers.<serverName>]` table sections |

A typical advisory warning:

```
[release-coordinator] MCP server 'linear' referenced but not configured for codex
```

If a warning fires, install the MCP server on that platform with the
relevant command above, then rerun `smith agent install` or `smith doctor` to
clear the warning.

## Caveats and gotchas

- **All three presets default `skill: "allow"`.** To lock down skills you
  must opt out explicitly (`{"skill":"deny"}` or a per-pattern map). This
  is intentional: skills are how agent-smith ships its own runtime
  capabilities (the architect skill, brainstorming, TDD, etc.).
- **OpenCode is the canonical permission model.** Anything not expressible
  in OpenCode (currently nothing) would be a translation gap.
- **`ask` is fully supported on OpenCode and Kiro.** Claude Code and Codex
  have no native ask semantic; the translators emit one warning per ask-tool
  and omit the tool from the allowlist. Authors targeting Claude Code or
  Codex should prefer `allow`/`deny` for ask-marked tools to keep warning
  noise down.
- **Claude Code's `additionalDirectories` and Codex's
  `allowed_external_directories`** are how non-OpenCode platforms reach
  the per-agent knowledge directory (which lives under agent-smith's
  state home at `~/.config/agent-smith/knowledge/<name>/`, not under
  either platform's agents dir). The translators inject these grants
  automatically; you don't write them by hand. OpenCode gets the same
  grant via `permission.read`. See [guide/04-knowledge.md](./04-knowledge.md).
- **Tool map updates require regenerating the JSON files.** When upstream
  Claude Code or Codex tool vocabularies change, edit
  `data/claude-code-tool-map.json` and `data/codex-tool-map.json`, bump
  `_meta.lastVerifiedDate`, and rerun `smith doctor` to confirm drift is
  cleared. See [guide/12-error-handling.md](./12-error-handling.md) for
  doctor remediation patterns.
- **MCP advisory warnings are not blocking.** Agent install proceeds
  regardless. If you want to surface them after install, run `smith
  doctor`.
- **Per-pattern collapse on Claude/Codex picks the broadest action.** A
  permission like `{"bash": {"git *": "allow", "*": "deny"}}` becomes
  `bash: allow` on Claude/Codex with a warning. If you want strict per-
  command bash gating, target OpenCode only.
- **`permission.skill` and `requires.skills` are different things.**
  `permission.skill` gates the runtime `Skill` tool (allow/ask/deny which
  skills the agent may load). `requires.skills` declares which skills
  must be installed on the host. Both can coexist.
- **`--permission-json` overrides `--permission`.** If you supply both,
  the JSON wins. The bare action and per-pattern map forms can be mixed
  freely within the JSON.

## See also

- [guide/02-bundle-anatomy.md](./02-bundle-anatomy.md) — where `permission`
  and `mcpServers` live in `agent.config.json`.
- [guide/03-installing-and-rendering.md](./03-installing-and-rendering.md) —
  how translators fit into the install pipeline.
- [guide/05-skills.md](./05-skills.md) — skill catalog model and the
  canonical home of `requires.skills`.
- [guide/07-models.md](./07-models.md) — how `modelTier` resolves per
  platform.
- [guide/10-doctor.md](./10-doctor.md) — tool-map drift detection and the
  MCP availability section.
- [guide/12-error-handling.md](./12-error-handling.md) — doctor remediation
  patterns when tool maps drift.
- [guide/14-cli-reference.md](./14-cli-reference.md) — `agent init`
  `--permission` and `--permission-json` flag reference.
