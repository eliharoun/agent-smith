# Sharing and distribution

> The end-to-end story for getting an agent bundle (or a skill) from one developer's machine onto a teammate's. Covers the publisher side (preparing a bundle, putting it in a catalog, telling the team), the consumer side (registering, installing, staying current), what travels with a bundle and what doesn't (knowledge sources, credentials), and the team patterns that actually work in practice. Read this when a teammate hands you a git URL and says "register this," or when you're about to share something you built.

This chapter is the end-to-end narrative. The registration mechanics it references — flag inventories, validation rules, error shapes — are documented in [08 — Registries and catalogs](./08-registries-and-catalogs.md). The CLI surface is in [14 — CLI reference](./14-cli-reference.md).

---

## Mental model

A **catalog** is a directory of bundles. Sharing means making that directory reachable by other people and having each of them register it locally. There are two transports:

- **Filesystem path** — works for everyone on the same machine, on a shared NFS mount, or for a single user organizing their own bundles.
- **Git remote** — the only realistic transport for a team. Each consumer clones the repo (manually or via the daemon) and registers the local working copy.

That's the entire idea. Everything in this chapter is detail on top of those two facts.

---

## 1. The kind vocabulary, decoded

Sharing-relevant catalog kinds, side by side:

| Registry | Personal | Per-project | Team / external |
|---|---|---|---|
| Agent (`smith agent register --kind`) | `user-global` | `project` | **`registered`** |
| Skill (`smith skill register --kind`) | `user-global` | `user-local` | **`team-shared`** |

The two registries deliberately use different vocabularies. The agent registry has `project` because per-repo agent bundles are a real workflow; the skill registry has `user-local` because skills are usually personal-machine scoped and don't have a project equivalent. Source: `src/core/types.ts` (agents), `src/io/skill-registry.ts` (skills). Background: [08 — Registries and catalogs, "Mental model"](./08-registries-and-catalogs.md#mental-model).

**For sharing, the two values you care about are `registered` (agents) and `team-shared` (skills).** Everything else in this chapter is built around those two kinds.

Agent kinds also have a strict **precedence order** when two catalogs define an agent with the same name (`src/io/orchestrator.ts`):

| Kind | Precedence |
|---|---|
| `project` | 0 (wins) |
| `user-global` | 1 |
| `registered` | 2 (loses) |

Lower number wins. The losing catalog's bundle is shadowed and smith warns at install time. This is the mechanic behind [Pattern C](#83-pattern-c--personal-override-of-team-bundle).

---

# Publisher track

## 2. Sharing an agent bundle

### 2.1 Prepare the bundle

Author and test your bundle locally first using the normal `smith agent init` → iterate flow ([01 — Getting started](./01-getting-started.md)). Before you publish, audit it for three classes of portability problem:

- **Absolute machine-local paths.** A knowledge source declaring `type: dir, path: /Users/you/notes/` will fail on every consumer's machine. Replace with a path relative to the bundle directory, or switch to `type: git` / `type: webpage` if the content is hosted somewhere fetchable.
- **Embedded secrets.** Never commit API tokens, passwords, or `.env` files into a bundle. The bundle directory ships verbatim to consumers. (Credentials for `confluence` / `jira` knowledge sources resolve from each consumer's local environment — see [§7](#7-credentials-when-sharing-knowledge-that-requires-auth).)
- **Knowledge sources consumers cannot resolve.** A `type: git` source pointing at a private repo your teammates cannot clone, or a `type: confluence` source against a space they cannot read, will fail at *their* `smith agent install` time. Either grant the access or use a different source.

Repo layout decision: **one bundle per repo or multi-bundle?** For teams sharing more than two bundles, a single multi-bundle "team agents" repo is almost always the right call. One registration covers all bundles, the daemon updates them together, and additions don't require every consumer to register a new remote.

```
team-agents/
├── README.md
├── code-reviewer/
│   ├── agent.config.json
│   ├── IDENTITY.md
│   ├── EXPERTISE.md
│   ├── SOUL.md
│   └── USER.md
├── incident-debugger/
│   └── ...
└── migration-surgeon/
    └── ...
```

### 2.2 Scaffold into the catalog directory

The cleanest flow is to register your catalog directory first, then scaffold bundles straight into it with `smith agent init --catalog`:

```bash
# 1. Create + register the catalog (one time, per repo)
mkdir -p ~/work/team-agents
cd ~/work/team-agents
git init && git remote add origin git@github.com:acme/team-agents.git

smith agent register ~/work/team-agents \
  --kind registered \
  --git-remote git@github.com:acme/team-agents.git \
  --label team-agents \
  --allow-empty    # the directory is empty until you add a bundle

# 2. Scaffold bundles directly into the registered catalog
smith agent init code-reviewer --catalog team-agents \
  --description "Reviews PRs" --model-tier balanced --permission read-edit

# 3. Edit, validate, install, commit
cd ~/work/team-agents/code-reviewer
# edit IDENTITY.md, EXPERTISE.md, SOUL.md
smith agent validate code-reviewer
smith agent install code-reviewer
git add . && git commit -m "Add code-reviewer agent" && git push
```

`--catalog` accepts either the registered label (`team-agents`) or an absolute path (`~/work/team-agents`); see [14 — CLI reference, `smith agent init`](./14-cli-reference.md#smith-agent-init-name) for the resolution rules. Because the resolved catalog has `kind: registered`, smith writes a stub `USER.md` instead of a per-user-machine symlink; the bundle is safe to commit. ([See why](./02-bundle-anatomy.md#usermd-and-catalog-kind).) Each consumer's `smith agent install` symlinks their own `USER.md` correctly at their install time.

#### Manual workflow (no `--catalog`)

If you already scaffolded into the default `user-global` catalog (`~/.config/agent-smith/agents/<name>/`) and want to move the bundle into a team-shared repo by hand, the equivalent two-step flow is:

```bash
mkdir -p ~/work/team-agents
mv ~/.config/agent-smith/agents/code-reviewer ~/work/team-agents/
# Replace the per-user USER.md symlink with a stub so consumers don't
# inherit a path that only exists on your machine:
rm ~/work/team-agents/code-reviewer/USER.md
printf '# USER context\n\nThis file is a placeholder.\n' \
  > ~/work/team-agents/code-reviewer/USER.md
cd ~/work/team-agents
git init && git add . && git commit -m "Add code-reviewer agent"
git remote add origin git@github.com:acme/team-agents.git && git push -u origin main
```

The `--catalog` flow above eliminates both the `mv` step and the USER.md symlink footgun in one shot.

### 2.3 Register your own working copy

Even as the publisher, you register the catalog locally so your daemon keeps it pulled and your `smith agent install` resolves from it:

```bash
smith agent register ~/work/team-agents \
  --kind registered \
  --git-remote git@github.com:acme/team-agents.git \
  --label team-agents
```

Verify:

```bash
smith agent catalogs
# Should list: [registered] /Users/you/work/team-agents (team-agents)

smith agent list
# Should show: code-reviewer (registered) → opencode, claude-code, codex, kiro
```

The `--git-remote` flag tells smith to verify the working copy is a git repo whose remotes include the URL (`src/cli/commands/register.ts`). It does **not** make smith do the clone — that's still your job. The flag is the contract that lets the daemon do `git pull` later (`src/daemon/git-pull.ts`).

If you previously had the bundle installed from `user-global`, run `smith agent uninstall <name>` then `smith agent install <name>` so the rendered files now come from the `registered` catalog. (You can verify by re-checking `smith agent list` — the parenthetical kind annotation will switch from `user-global` to `registered`.)

### 2.4 Tell your team

Give your teammates two facts:

1. **The git URL** — `git@github.com:acme/team-agents.git`
2. **A suggested label** — `team-agents`, so everyone's `smith agent catalogs` output looks the same and your daemon docs / runbooks can reference one canonical name.

That's the entire handoff. The [Consumer track](#consumer-track) below is what they do next.

---

## 3. Sharing skills

The skill-sharing flow is structurally identical, with three differences worth knowing:

- **Different kind.** `--kind team-shared` (not `registered`).
- **Different registry.** State file `~/.config/agent-smith/skill-catalogs.json`; commands under `smith skill ...` not `smith agent ...`.
- **No per-platform install at register time.** Skills are referenced in place when an agent that declares them in `requires.skills[]` is installed. Registering a team-shared skill catalog doesn't drop files on disk; it just makes the skills *discoverable* so that any agent declaring `requires.skills: [{ name: "my-team-skill" }]` resolves correctly.

Publisher commands:

```bash
mkdir -p ~/work/team-skills
# ... arrange skills, each in its own directory with SKILL.md at the root ...
cd ~/work/team-skills
git init && git add . && git commit -m "initial" && git remote add origin <url> && git push -u origin main

smith skill register ~/work/team-skills \
  --kind team-shared \
  --git-remote git@github.com:acme/team-skills.git \
  --label team-skills
```

Verify:

```bash
smith skill catalogs
smith skill list
```

See [05 — Skills, "Skill catalogs"](./05-skills.md#skill-catalogs) for the skill registry's parallel commands and [§5](#5-using-shared-skills) below for the consumer side.

---

# Consumer track

## 4. Installing a shared agent bundle

Your teammate has handed you `git@github.com:acme/team-agents.git`. Here's the full flow.

### 4.1 Clone and register

Smith does not clone for you on `agent register` — clone first, register the working copy:

```bash
git clone git@github.com:acme/team-agents.git ~/work/team-agents
smith agent register ~/work/team-agents \
  --kind registered \
  --git-remote git@github.com:acme/team-agents.git \
  --label team-agents
```

The `--git-remote` flag lets the daemon do `git pull` on your behalf. The `--label` should match what your team agreed on so commands and runbooks read consistently across machines.

If `register` rejects the path with a "looks like a skill catalog" error, you've cloned the skills repo by mistake — switch to `smith skill register` (`src/cli/commands/register.ts`).

### 4.2 Discover what's available

```bash
smith agent catalogs
# [registered] /Users/you/work/team-agents (team-agents)

smith agent list
# code-reviewer (registered) → opencode, claude-code, codex, kiro
# incident-debugger (registered) → opencode, claude-code, codex, kiro
# migration-surgeon (registered) → opencode, claude-code, codex, kiro
```

`agent list` shows everything *discoverable*. Nothing is installed onto your platforms yet — that's the next step.

### 4.3 Install

Single bundle:

```bash
smith agent install code-reviewer
```

Or every available bundle (your own user-global, project, and registered):

```bash
smith agent install-all
```

What ends up where, and the full render pipeline (knowledge materialization, required-skill resolution, per-platform translation), is documented in [03 — Installing and rendering](./03-installing-and-rendering.md).

### 4.4 Stay current

When the publisher pushes a new commit to the team-agents repo, you need three things to happen: pull the catalog, re-render, re-install. There are three options:

- **Manual, hand-managed clone** — `cd ~/work/team-agents && git pull && smith agent install <name>` (or `install-all`). Use this when you cloned the catalog yourself and prefer to manage the working tree directly.
- **Manual, smith-managed clone** — `smith agent sync <label>` (or `--all`) pulls every remote-backed catalog (those registered with a `remote` block, typically installed via `agent install --from <url>`), then re-run `smith agent install <name>` to render the new content. `smith agent sync --check` is a cheap "anything to pull?" probe that updates `lastRemoteSha` without touching the working tree; pair it with `smith doctor` (the `remote-catalogs` section reports `catalog-behind-remote` findings offline).
- **Automatic** — run `smith daemon start`. The daemon pulls every registered git-backed catalog every 15 minutes and re-installs anything whose source content changed (`src/daemon/git-pull.ts`, [09 — The daemon](./09-daemon.md)). It also refreshes `ttl`-mode knowledge sources every 5 minutes — see [04 — Knowledge § Refresh modes](./04-knowledge.md#refresh-modes).

The daemon is the recommended path for active team use. It is not required — everything it does, you can do by hand.

---

## 5. Using shared skills

Skills behave differently from agents at the consumer end. There is no `smith skill install-all` parallel to `smith agent install-all`, and registering a skill catalog doesn't drop files on disk by itself.

The full flow:

```bash
# 1. Clone and register (mechanics same as agents)
git clone git@github.com:acme/team-skills.git ~/work/team-skills
smith skill register ~/work/team-skills \
  --kind team-shared \
  --git-remote git@github.com:acme/team-skills.git \
  --label team-skills

# 2. Verify discoverability
smith skill catalogs
smith skill list

# 3. Install when needed
smith skill install <skill-name>
```

The third step is what actually copies files into per-platform skill directories (`~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`, `~/.kiro/skills/`). For an installed agent that declares the skill in `requires.skills[]`, `smith agent install <agent>` will also auto-install missing required skills if you pass `--with-skills` (or `--yes`, which implies it on agent installs).

See [05 — Skills, "Required skills"](./05-skills.md#required-skills-requiresskills) for the full `requires.skills` semantics and [03 — Installing and rendering, "Required skills behavior during install"](./03-installing-and-rendering.md#required-skills-behavior-during-install) for what happens at install time.

---

# Reference

## 6. Knowledge portability — what travels, what doesn't

This is the single biggest source of "my agent works for me but not my teammate" confusion. The rule is simple:

> The **`knowledge` block in `agent.config.json` travels with the bundle.** The **materialized content** (the actual file contents, fetched pages, cloned repos) is re-resolved on **each consumer's** `smith agent install`.

That is: your knowledge *declarations* are part of what you ship. Whether the *content* those declarations point at can be fetched depends on the consumer's machine, network, and credentials.

### 6.1 Per-source-type matrix

| `type` | Declaration travels with bundle? | What happens on consumer's `smith agent install` | Consumer requirements |
|---|---|---|---|
| `file` | ✓ yes | Read from the bundle directory | None (file is in the cloned repo) |
| `dir` | ✓ yes | Read from the bundle directory | None |
| `glob` | ✓ yes | Read from the bundle directory | None |
| `webpage` | ✓ yes | HTTP GET at install time | Network reachability to the URL |
| `web` | ✓ yes | Crawl / llms-txt / openapi fetch at install time | Network reachability to the URL |
| `mcp` | ✓ yes | MCP server query at install time | Running MCP server |
| `git` | ✓ yes | `git clone` at install time | Read access to the remote |
| `confluence` | ✓ yes | API fetch at install time | Atlassian credentials in env (see [§7](#7-credentials-when-sharing-knowledge-that-requires-auth)) |
| `jira` | ✓ yes | API fetch at install time | Atlassian credentials in env (see [§7](#7-credentials-when-sharing-knowledge-that-requires-auth)) |

Materialization happens in `src/core/knowledge/pipeline.ts` and lives under each consumer's own state home (`~/.config/agent-smith/...`), never inside the bundle directory. See [04 — Knowledge](./04-knowledge.md) for the materialization pipeline and [13 — Paths and state, "Knowledge materialization"](./13-paths-and-state.md) for where it goes.

### 6.2 Implications for publishers

- **Bundle-local sources (`file` / `dir` / `glob`) are the most portable.** If the content is small (<~1 MB), stable, and a fixed snapshot is fine, prefer these. Consumers need nothing except the bundle itself.
- **Remote sources (`webpage` / `web` / `git`) are stale-resistant but require network.** They re-fetch on every install, so consumers always get the current version. They fail if the consumer is offline or behind a firewall.
- **Atlassian sources (`confluence` / `jira`) require credentials on every consumer's machine.** Document this prominently in your bundle's `IDENTITY.md` or `EXPERTISE.md`, and link to [§7](#7-credentials-when-sharing-knowledge-that-requires-auth) of this chapter.
- **Don't commit secrets to bundled `file` sources.** A `file: secrets.env` declaration ships the file's contents to every teammate's checkout.

### 6.3 Implications for consumers

- If `smith agent install` fails with a knowledge acquisition error, you almost certainly need network access, repo access, or credentials that the publisher's machine had but yours doesn't.
- **Re-materialization happens on `install` by default.** Static sources need a manual `smith agent install <name>` (or `smith knowledge fetch <name>`) to pick up upstream content changes. The daemon does this automatically for *catalog* source changes; it does **not** poll the content that knowledge sources point at.
- **Bundle authors can opt sources into auto-refresh.** Sources whose `refresh.mode` is `session` or `always` are eligible for per-platform refresh hooks; sources whose mode is `ttl` are refreshed by the daemon on a 5-minute tick (see [guide/09-daemon.md § Knowledge TTL refresh](./09-daemon.md#knowledge-ttl-refresh)). As of v0.15, Claude Code, Codex, OpenCode, and Kiro are all wired up for session/always refresh. On first install of an agent with `session`/`always` sources targeting any of those platforms, smith prompts you for consent to install the refresh integration. For claude-code, smith adds a `hooks.SessionStart` block to the rendered agent file; for codex, smith writes a global `SessionStart` entry to `~/.codex/hooks.json` (smith-managed via a `_smith_managed` ownership marker) and prints a one-line advisory to run `/hooks` inside codex to trust it; for opencode, smith installs a shared session-start plugin at `~/.config/opencode/plugins/agent-smith-refresh/` and registers it in `~/.config/opencode/opencode.json`'s `plugin` array (tracked via a `.smith-managed` sentinel that lists every consenting agent — the plugin and opencode.json entry are removed automatically when the last consenting agent is uninstalled). If `~/.codex/hooks.json` pre-exists without smith's marker, install fails — smith never overwrites user-owned hook config. You can pre-answer with `--refresh-consent yes|no` (broadcasts to every consent-eligible platform; required for CI / non-TTY) or skip the prompt entirely with `--no-refresh-hooks`. See [guide/04-knowledge.md § Consent and the refresh manifest](./04-knowledge.md#consent-and-the-refresh-manifest) for the prompt UX, the manifest shape, and the per-source advisory lock that prevents concurrent sessions from double-fetching.
- **Declining consent (or passing `--no-refresh-hooks`) keeps refresh manual.** No hook block is written and `smith knowledge fetch <name>` remains the way to pick up content changes. Re-running `smith agent install <name>` later will re-prompt.

---

## 7. Credentials when sharing knowledge that requires auth

`confluence` and `jira` knowledge sources reach Atlassian APIs that require authentication. **Credentials are never bundled.** They resolve at install time from each consumer's local environment.

### 7.1 The four-tier resolution chain

The canonical resolver is `src/io/atlassian-auth.ts`. It tries these locations in order and uses the first complete pair it finds:

1. **`SMITH_ATLASSIAN_*` environment variables** (`SMITH_ATLASSIAN_BASE_URL`, `SMITH_ATLASSIAN_EMAIL`, `SMITH_ATLASSIAN_API_TOKEN`).
2. **`~/.config/agent-smith/.env`** — same variable names; loaded if step 1 is incomplete.

Canonical documentation is in [04 — Knowledge, "Credential resolution order"](./04-knowledge.md#credential-resolution-order); paths are in [13 — Paths and state, "Atlassian credentials"](./13-paths-and-state.md#atlassian-credentials).

### 7.2 Recommendations for shared bundles

- **Document the required env vars in the bundle's `IDENTITY.md` or `EXPERTISE.md`,** plus a one-liner pointing at this chapter and chapter 04. Consumers should not have to read code to discover what credentials they need.
- **Commit an example `.env.template` in the catalog repo's `README.md`** — variable names only, no values:
  ```bash
  # ~/.config/agent-smith/.env (consumer fills these in)
  SMITH_ATLASSIAN_BASE_URL=https://acme.atlassian.net
  SMITH_ATLASSIAN_EMAIL=you@acme.com
  SMITH_ATLASSIAN_API_TOKEN=
  ```
- **Never commit a populated `.env` to the catalog repo.** Use `.gitignore`.
- **For org-wide bundles, use `SMITH_ATLASSIAN_*` env vars** — they're the canonical credential source and the only supported tier.

---

## Sharing bundles that route knowledge through MCP

Bundles can declare URL knowledge sources that fetch through a configured MCP server's tool instead of direct HTTP — a `via: { server, tool, args? }` field on the source. This is how a bundle reaches an internal wiki, a ticketing system, or any source whose credentials are held by an MCP server you've already wired up. The shared-bundle story for these is its own thing: the bundle declares the *route*, the recipient brings the *credentials*. This section walks through what changes for publishers and consumers.

Full background on the `via:` field, the curated routing-suggestion registry, and the `mcp.required[]` / `mcp.peer[]` declaration is in [04 — Routing URL fetches through MCP servers](./04-knowledge.md#routing-url-fetches-through-mcp-servers).

### What travels with the bundle

A bundle that uses MCP routing carries two pieces of new metadata, both committed in `agent.config.json`:

- **`via:` declarations on URL sources** — the server name and the tool name the fetcher should call (`{ "server": "internal-mcp", "tool": "fetch_page" }`).
- **`mcp.required[]` and `mcp.peer[]`** at the bundle root — the list of servers the bundle expects on the recipient's machine, with npm-style semantics (`required` blocks install when missing, `peer` warns).

What does **not** travel: credentials, MCP server processes, MCP server configuration. Those live exclusively in each recipient's per-platform MCP config (`~/.config/opencode/opencode.json`, `~/.claude/settings.json`, `~/.codex/config.toml`, `~/.kiro/settings/mcp.json`). The bundle says "this source goes through `internal-mcp.fetch_page`"; whether `internal-mcp` is installed, how it authenticates, and what tenant it sees is the recipient's own setup.

### Recipient experience

When a teammate runs `smith agent install <name>` against your shared bundle, smith preflights `mcp.required[]` and `mcp.peer[]` against *their* MCP config before render:

- **Every `required` server present** — install proceeds normally; routed sources fetch through MCP at materialize time.
- **A `required` server is missing** — install refuses (exit `1`) and prints which server(s) need to be added to which platform's config. `--allow-missing-mcp` demotes the refusal to a warning when the recipient knows they're staging a bundle ahead of the server rollout.
- **A `peer` server is missing** — install proceeds with a warning. The bundle still works for sources that don't go through that server; routed sources targeting it will fail at acquire time with an actionable error.

The `mcp-deps` section of `smith doctor` audits installed agents the same way, post-hoc — useful when a recipient adds a bundle, then later removes a server from their MCP config.

### Different auth, same source

The bundle declares the *tool*, not the *credential*. When two recipients install the same bundle and both have the named MCP server configured against different workspace tenants, each gets their own view of the source through their own credentials. The `url` field in the source record is what the MCP tool receives as input; whatever scope or permission the recipient's server applies is what they see. There is no way (and no need) for the publisher to pre-bake auth into the bundle.

This is the same separation `confluence` / `jira` sources have today (the bundle ships the space key or JQL; each consumer brings their own `SMITH_ATLASSIAN_*` credentials), generalized: any MCP server can play the auth-holder role.

### What to tell teammates

When you hand a teammate a bundle that routes through MCP, give them three facts:

1. **Which MCP server(s) the bundle requires** — read these off the bundle's `mcp.required[]` array.
2. **How to install each one** — most MCP servers ship as a package the recipient adds to a platform's MCP config (e.g. an entry under `mcpServers` in `~/.claude/settings.json`, the `mcp_servers` block in `~/.codex/config.toml`, or the `mcp` block in `~/.config/opencode/opencode.json`). Link them to the upstream server's install instructions.
3. **The install command** — once the server is configured, `smith agent install <name>` (or `smith agent install --from <url>`) should preflight clean and render normally.

Recipient-side checklist:

```bash
# 1. Add the required MCP server to the relevant platform config(s).
#    Follow the server's own install docs; smith does not install MCP servers.

# 2. Verify smith sees it:
smith doctor                         # mcp-deps section reports any gaps

# 3. Install the bundle:
smith agent install <name>            # or: smith agent install --from <url>
```

If a recipient is staging a bundle before they've configured the server, `--allow-missing-mcp` lets them render the bundle anyway; the routed sources will fail at acquire time until the server is in place, which is usually the desired behavior (visible failure rather than silent miss).

---

## 8. Team patterns

Three patterns cover the realistic cases. They're not mutually exclusive — A is the starting point; B and C are extensions.

### 8.1 Pattern A — Single shared catalog (recommended starting point)

One `team-agents` git repo, every team member registers it as `registered`. The daemon keeps it current on each machine. Concrete commands:

**Publisher (once):**
```bash
# from §2 above
smith agent register ~/work/team-agents --kind registered \
  --git-remote git@github.com:acme/team-agents.git --label team-agents
```

**Each consumer (once):**
```bash
git clone git@github.com:acme/team-agents.git ~/work/team-agents
smith agent register ~/work/team-agents --kind registered \
  --git-remote git@github.com:acme/team-agents.git --label team-agents
smith agent install-all
smith daemon start
```

This pattern is enough for most teams. Resist adding more catalogs until you have a concrete reason.

### 8.2 Pattern B — Tiered catalogs (org + team)

When your organization wants org-wide agents *and* per-team agents, register both:

```bash
# Org-wide (lower-priority defaults)
smith agent register ~/work/org-agents --kind registered \
  --git-remote git@github.com:acme/org-agents.git --label org

# Your team's catalog (also registered; same precedence tier)
smith agent register ~/work/team-agents --kind registered \
  --git-remote git@github.com:acme/team-agents.git --label team
```

Both catalogs sit at the same precedence tier (`registered`, precedence 2; see [§1](#1-the-kind-vocabulary-decoded)). If both define an agent with the same name, smith warns at install time and the resolver picks one deterministically based on registry order. This is rarely what you want — coordinate naming across catalogs (e.g., prefix org agents with `org-`, team agents with `team-`) so collisions don't happen.

For an org-default that one specific team wants to override locally, use Pattern C instead.

### 8.3 Pattern C — Personal override of team bundle

You want to customize the team's `code-reviewer` for your own use without affecting anyone else. Register your fork at a higher-precedence kind:

```bash
# Team's bundle is at `registered` (precedence 2)
# Register your fork at `project` (precedence 0 — wins)
smith agent register ~/code/my-overrides --kind project --label personal
smith agent install code-reviewer
# Smith warns: "code-reviewer in 'team-agents' (registered) shadowed by 'personal' (project)"
# Installs from your fork.
```

The team catalog stays registered and current; your local override takes precedence at resolve time. Remove your override (`smith agent unregister personal`) and you're back on the team version. See [08 — Registries and catalogs, "Kinds and precedence"](./08-registries-and-catalogs.md#kinds-and-precedence) for the full precedence table.

**Caveat:** the fork still lives in a separate directory under your control. You're responsible for occasional rebases against the upstream bundle's changes. There is no `smith agent fork` command that tracks the upstream automatically.

---

## 9. Sharing via direct URL

The flows in §2–§5 assume a publisher prepares a catalog repo and tells the team `git clone` + `smith agent register`. That works well when the catalog is established and many people use it. For ad-hoc sharing — "try out my agent," one-off external bundles, demos — it's heavyweight.

The C-series (v0.25.0) added a shortcut: **`smith agent install --from <url>`** and the matching **`smith skill install --from <url>`**. One command clones the repo, registers it, and installs the bundle.

### 9.1 The consumer flow

```bash
# Agent (single command — no separate register step)
smith agent install --from git@github.com:acme/team-agents.git

# Skill (same shape)
smith skill install --from git@github.com:acme/team-skills.git

# Skill — multi-bundle flags for catalogs with multiple skills
smith skill install --all --from git@github.com:acme/team-skills.git
smith skill install --skills lint-rules,format-output --from git@github.com:acme/team-skills.git
smith skill install --json --from git@github.com:acme/team-skills.git   # discover only, print JSON
smith skill install --from git@github.com:acme/team-skills.git --git-ref v2.0  # pin to branch/tag/SHA
```

> **Register-on-install:** `--from <url>` registers the cloned catalog only after a successful install. Discovery alone (e.g. `--json`) does NOT persist a registry entry.

What happens under the hood:

1. URL is normalized into a deterministic clone path under `<stateHome>/remote/<host>/<owner>/<repo>` (typically `~/.local/state/agent-smith/remote/github.com/acme/team-agents`). Re-running with the same URL is idempotent — same path, fetch-or-clone.
2. The clone is registered as a remote-backed catalog. The registry entry records a `remote` block: URL, ref, `lastPulledSha`, `lastPulledAt`. This is what distinguishes it from a hand-cloned catalog.
3. Bundle discovery walks the clone for `agent.config.json` (or `SKILL.md` for skills). If exactly one is found, `[name]` becomes optional. If more than one is found, you'll be asked to disambiguate: `smith agent install <name> --from <url>`.
4. The bundle is built and installed exactly as if it had been local.

### 9.2 Catalog vs. remote bundle — when to use which

| | Registered catalog | Remote-backed catalog (`--from <url>`) |
|---|---|---|
| **Created by** | `git clone` + `smith agent register` | `smith agent install --from <url>` |
| **Clone location** | Wherever you put it (`~/work/team-agents`) | `<stateHome>/remote/<host>/<owner>/<repo>` (smith-managed) |
| **Working tree** | You own it — `git pull`, edit, push | Smith-managed — `agent sync` does the pulling; manual edits are clobbered |
| **Discovery** | `smith agent catalogs` shows it as `registered` | Same listing, distinguished by the `remote` block |
| **Update workflow** | `git pull` + `smith agent install` (or daemon) | `smith agent sync <label>` + `smith agent install` (or daemon) |
| **Cleanup** | `smith agent unregister` (working tree stays) | `smith agent unregister --purge-clone` (working tree deleted) |
| **Best for** | Catalogs your team owns and contributes to | One-off external bundles, demos, third-party agents |

The mental model: a **registered catalog** is your repo on disk that smith knows about; a **remote-backed catalog** is smith's clone of someone else's repo.

### 9.3 Staying current

`smith agent sync <label>` (or `--all`) pulls the upstream into smith's clone and updates the recorded SHAs. Re-run `smith agent install <name>` afterwards to render any new content.

For drift detection without pulling:

```bash
smith agent sync --all --check     # git ls-remote only; updates lastRemoteSha
smith doctor                        # reports `catalog-behind-remote` findings
```

The `doctor remote-catalogs` section is offline — it surfaces drift previously observed by `sync --check` (or by the daemon's 15-minute pull tick). It also reports `catalog-stale-check` for entries whose `lastCheckedAt` is older than 7 days, prompting you to run a fresh check.

### 9.4 Cleanup

```bash
smith agent unregister acme/team-agents              # leaves the clone on disk
smith agent unregister acme/team-agents --purge-clone # also rm -rf the clone
```

The `--purge-clone` flag is refused for catalogs whose `rootPath` is not under `<stateHome>/remote/`. This is a safety guard — hand-managed working copies under `~/work/` are off-limits to smith's cleanup, even when registered.

### 9.5 URL forms accepted

`isLikelyGitUrl()` accepts:

- `https://github.com/owner/repo.git`
- `git@github.com:owner/repo.git`
- `ssh://git@github.com/owner/repo.git`
- `ssh://github.com/owner/repo.git` (user-less SSH — any `ssh://[user@]host/…` form is accepted)
- `file:///abs/path/to/bare.git` (intended for fixtures and integration tests; production use is allowed but unusual — local URLs are routed to `<stateHome>/remote/_local/<8-char-hash>-<basename>`)

Rejected:

- Plain `http://` (no TLS).
- Smart transports (`ext::`).
- URL segments starting with `-` (git option-injection guard).
- `..` segments anywhere in the path.
- URLs that don't contain a host/owner/repo triple.

The `--ref <ref>` flag (agent) or `--git-ref <ref>` flag (skill) pins the checkout to a specific branch, tag, or SHA — useful when you want a known-good version rather than tracking HEAD.

### 9.6 Trade-offs vs. catalog flow

Use `--from <url>` when:

- You're trying out an external bundle and don't want to manage a clone.
- A publisher distributes a single bundle as a standalone repo.
- You're scripting a CI/devbox bootstrap where one-command-install is simpler than clone-then-register.

Stick with `register` when:

- Your team owns the catalog and contributors edit it locally.
- You want the working tree under your direct control (`~/work/team-agents`).
- The catalog holds many bundles and you want a single shared clone everyone re-renders against.

The two flows coexist — registering a catalog you already cloned does not conflict with another teammate using `--from <url>` to install the same repo into smith's managed clone area. Each side gets its own working tree.

### 9.7 AGENTS.md as a sharing surface

The flows above are git-based: a publisher hosts a catalog repo, consumers `register` or `--from` it. There's also a one-file sharing surface: declare `agents-md` as a target and `smith agent install` writes a single `AGENTS.md` (default `~/AGENTS.md`; override via `targetOptions.agentsMd.path`) that Cursor, Windsurf, GitHub Copilot, Aider, Codex CLI, Devin, Junie, Roo, Zed, Warp, and Gemini CLI all read natively. AGENTS.md emission is automatic when `agents-md` is in `targets` — no extra knobs. As of v2.1, large knowledge corpora auto-compile into a TOC pointing into the materialized knowledge dir rather than inlined-and-truncated prose; small corpora stay inline. Force compile-shape rendering with `compile.progressive: true` if you want it for a small corpus.

This is useful when:

- You're publishing for an audience that uses one of the AGENTS.md-aware tools above and you don't want to maintain a per-runtime translator.
- A teammate is on a runtime smith doesn't render natively (e.g. Cursor, Windsurf) and you want them to consume the same canonical bundle the rest of the team installs into smith.
- You want a single file you can commit to a project root for an open-source repo, so contributors who use any AGENTS.md-aware tool get sensible defaults.

The Microsoft APM ecosystem (`smith agent init --from-apm`) treats AGENTS.md the same way — APM bundles targeting `copilot` / `cursor` / `gemini` / `windsurf` are folded into the single `agents-md` target on import. See [16 — Knowledge compiler](./16-knowledge-compiler.md#the-agents-md-target) for placement rules, the CLAUDE.md pointer interaction, and the runtime list.

### 9.8 Sharing via exported archive

For one-off sharing — handing a single bundle to a colleague, an external collaborator, or staging a bundle for an offline / air-gapped environment — `smith agent export` packages the bundle into a single `.smith-bundle.tgz` file the recipient consumes with `smith agent install --from <archive>`.

```bash
# Producer
$ smith agent export code-reviewer --to ~/Downloads/

# Recipient
$ smith agent install --from ~/Downloads/code-reviewer-abc1234.smith-bundle.tgz
```

The archive contains the bundle files, all local knowledge (`type: file` / `dir` / `glob`), and (by default) the source of every skill in `requires.skills[]`. It does NOT contain MCP servers, credentials, or remote knowledge — those are declared in the manifest and the recipient brings or fetches them at install time.

To share without embedding skills (e.g. when the recipient already has your team-skills catalog registered):

```bash
$ smith agent export code-reviewer --no-include-skills --to ~/Downloads/
```

The recipient sees a one-line summary of what the artifact will need from their machine before install proceeds. Imported-archive catalogs appear in `smith agent list` and `smith agent catalogs` with the `imported-archive` annotation; running `smith agent sync <imported-label>` prints an advisory instead of attempting a git pull (imported archives have no upstream).

**Portability checks:** `smith agent export` refuses to package bundles whose knowledge sources use absolute paths or paths that escape the bundle directory — the producer fixes the source declarations and re-exports.

**See also:** [`smith agent export`](./14-cli-reference.md#smith-agent-export-name) and [`smith agent install --from`](./14-cli-reference.md#smith-agent-install-name) in the CLI reference.

### 9.9 Producing a catalog repo with `--format directory`

For producers who maintain a shared catalog repo (the [Pattern A](#81-pattern-a--single-shared-catalog-recommended-starting-point) layout), `smith agent export --format directory` writes the bundle's loose files directly into the repo's `agents/` directory:

```bash
$ smith agent export code-reviewer --format directory --to ~/work/team-agents/agents/
✓ wrote 7 files to /Users/me/work/team-agents/agents/code-reviewer/
next:
  cd /Users/me/work/team-agents && git add agents/code-reviewer && git commit -m "Add code-reviewer agent"
```

The destination path follows the [Helm convention](https://helm.sh/docs/helm/helm_pull/) — `--to` is treated as the *parent* of the bundle dir. Files land at `<--to>/<name>/`. If `<name>/` already exists in the destination, smith refuses with exit 1; pass `--force` to replace it (full replace, no merge).

The directory output is shaped exactly like the catalog layout the install pipeline already discovers: `<repo>/agents/<name>/agent.config.json`. Recipients install via the existing `smith agent install --from <git-url>` or via `smith agent install --from <local-checkout>` (see §9.10 below).

By default, the directory output contains the bundle files + `_smith-export.json` (the manifest) and *omits* the auto-generated `README.md` (its content references "extract this archive", which is wrong inside a git checkout). Pass `--with-readme` to include it; pass `--no-manifest` to drop the manifest.

### 9.10 Installing from a local checkout

If you've already cloned a catalog repo for editing, you can install bundles directly from your working copy without re-cloning:

```bash
$ smith agent install --from ~/work/team-agents/
```

Smith registers the directory as a catalog and installs the bundle(s). When the directory is a git repo, smith prints a one-line hint after install showing how to register the remote URL for `smith agent sync`:

```
hint: this directory is a git repo. To enable `smith agent sync`, register the remote:
      smith agent register /Users/me/work/team-agents --git-remote git@github.com:acme/team-agents.git
```

The hint is informational; the install completed successfully without it.

The `--from <local-dir>` flow accepts the same flags as `--from <git-url>`: `--all` to install every bundle in the directory, `--agents <list>` for a subset, `[name]` for a single bundle, `--json` for machine-readable discovery output.

---

## 10. Gotchas and common mistakes

- **"I deleted the bundle from my team-agents directory but it came back."** The daemon re-pulled the upstream commit. To stop using the team catalog locally, use `smith agent unregister team-agents` — not file deletion. To remove a bundle from the team for everyone, delete it in the upstream repo and push. See [11 — Update and uninstall, "`smith agent destroy`"](./11-update-and-uninstall.md#smith-agent-destroy-name) for why `agent destroy` refuses non-`user-global` catalogs.

- **"My teammate sees stale Confluence content."** Knowledge re-materializes on `smith agent install`, not on agent invocation. After upstream content changes, the teammate needs to re-install (`smith agent install <name>`) or re-fetch (`smith knowledge fetch <name>`). The daemon re-installs when *bundle* source files change in the catalog, but does not poll the remote content that knowledge sources point at.

- **"Credentials work on my machine but not my teammate's."** Each consumer needs their own entry in the four-tier credential chain. There is no way to bundle credentials. See [§7](#7-credentials-when-sharing-knowledge-that-requires-auth).

- **"Two catalogs define the same agent and the wrong one wins."** Lower precedence number wins (`project=0`, `user-global=1`, `registered=2`). If you want the team version, unregister your local override. If you want the override, that's already what's happening. Smith warns at install time when shadowing occurs — read those warnings.

- **"`smith agent register` refused my path as 'looks like a skill catalog.'"** You cloned the wrong repo, or you're conflating agents and skills. The error includes a ready-to-paste `smith skill register` command. See [08 — Registries and catalogs, `smith agent register`](./08-registries-and-catalogs.md#smith-agent-register-path).

- **"My label clashes with someone else's catalog."** Label uniqueness is enforced per machine. Different teammates can use different labels for the same git remote, but within one machine, labels must be unique. Use `--label` deliberately and document the team-wide convention.

- **"My team-shared skill installed for me but my teammate's agent doesn't see it."** Each consumer must register the skill catalog **and** install the skill (`smith skill install`) — registration alone doesn't drop files. If the agent declares the skill in `requires.skills[]`, installing the agent with `--with-skills` (or `--yes` on agent installs) does both in one step.

- **Codex skill/agent name collisions.** Codex agents and skills share `~/.agents/skills/`. A skill and an agent with the same name will collide on install. Coordinate naming. See [05 — Skills, "Caveats and gotchas"](./05-skills.md#caveats-and-gotchas).

---

## 11. Related chapters

- [08 — Registries and catalogs](./08-registries-and-catalogs.md). Registration commands, validation rules, precedence table, error shapes, ad-hoc catalogs.
- [04 — Knowledge](./04-knowledge.md). Knowledge source types, materialization pipeline, credential resolution canonical home.
- [09 — The daemon](./09-daemon.md). Automatic git pull cadence, reinstall triggers, heartbeat.
- [11 — Update and uninstall](./11-update-and-uninstall.md). Why `smith agent destroy` refuses non-`user-global` catalogs; the right tool for "stop using this team catalog."
- [14 — CLI reference](./14-cli-reference.md). Every flag, every exit code, for `smith agent register` / `unregister` / `catalogs` / `list` / `install` and their skill counterparts.

---

← [Back to GUIDE](../GUIDE.md)
