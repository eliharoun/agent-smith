# Agent Smith — Bug Bash

A structured 90-minute session where new-to-the-project engineers exercise `smith` and OpenCode together to surface bugs before release. Pick an area, run the scenarios, file findings as GitHub issues. Done.

---

## TL;DR

- **What:** Manual bug bash. 8 areas, ~90 min/tester.
- **Where to file:** [GitHub Issues → "Bug bash report" template](https://github.com/eliharoun/agent-smith/issues/new?template=bug-bash.md). Title prefix `[bug-bash]`, label `bug-bash`.
- **In scope:** every `smith` command + verifying installed agents work inside OpenCode.
- **Out of scope:** Claude Code installer, Codex installer, third-party MCP server bugs, perf benchmarking. (Smith *writes* to `~/.claude/` and `~/.agents/skills/` — checking that's fine. Verifying Claude/Codex *runs* the agents is not.)
- **Severity rubric:** S1 data loss, S2 command broken, S3 wrong output but recoverable, S4 polish.

---

## Table of contents

- [Before you start (15 min — do this *before* the session)](#before-you-start-15-min--do-this-before-the-session)
- [How to file a bug](#how-to-file-a-bug)
- [Pick your area](#pick-your-area)
- [Area A — First-time setup & init](#area-a--first-time-setup--init)
- [Area B — Install / uninstall lifecycle](#area-b--install--uninstall-lifecycle)
- [Area C — Knowledge sources](#area-c--knowledge-sources)
- [Area D — Doctor / Update / Status](#area-d--doctor--update--status)
- [Area E — Daemon](#area-e--daemon)
- [Area F — OpenCode runtime verification](#area-f--opencode-runtime-verification)
- [Area G — Skill lifecycle](#area-g--skill-lifecycle)
- [Area H — Companion-agent runtime (`agent-smith` itself)](#area-h--companion-agent-runtime-agent-smith-itself)
- [Wrap-up (last 15 min)](#wrap-up-last-15-min)
- [Facilitator checklist](#facilitator-checklist-delete-this-section-before-sharing-the-doc-with-testers-if-you-want-a-clean-copy)

---

## Before you start (15 min — do this *before* the session)

You need a clean machine state, a working build, and `gh` authenticated. Budget 15 minutes; don't burn session time on setup.

### 1. Install

```bash
gh repo clone eliharoun/agent-smith ~/.agent-smith
cd ~/.agent-smith
bash bin/install
bun run typecheck   # must pass
bun test            # must pass
```

If any of those commands fails, stop and post in the bug-bash channel — that's a pre-existing issue, not a bug-bash finding.

### 2. Snapshot existing state (so you can restore after)

If you already use `agent-smith` or OpenCode, **back up first**. The bash will install/uninstall agents and may leave residue.

```bash
# Snapshot
mkdir -p ~/bug-bash-backup
[ -d ~/.config/agent-smith ]   && cp -R ~/.config/agent-smith   ~/bug-bash-backup/agent-smith.bak
[ -d ~/.config/opencode/agent ] && cp -R ~/.config/opencode/agent ~/bug-bash-backup/opencode-agent.bak
[ -d ~/.config/opencode/agents ] && cp -R ~/.config/opencode/agents ~/bug-bash-backup/opencode-agents.bak
[ -d ~/.config/opencode/skills ] && cp -R ~/.config/opencode/skills ~/bug-bash-backup/opencode-skills.bak

# Wipe (skip if you're on a fresh machine)
rm -rf ~/.config/agent-smith
rm -rf ~/.config/opencode/agent ~/.config/opencode/agents ~/.config/opencode/skills
```

After the bash, restore from `~/bug-bash-backup/` if you need to.

### 3. Verify `smith` is invocable

The installer in step 1 created `~/.local/bin/smith` and added `~/.local/bin` to your PATH. Open a new shell (so the rc-file change takes effect), then verify:

```bash
smith --version
```

Expected: `0.10.0` (or whatever the current `package.json:version` is).

### 4. Install OpenCode

```bash
# Follow https://opencode.ai/docs/install — typical: curl -fsSL https://opencode.ai/install | bash
opencode --version   # confirm it's installed
```

### 5. Authenticate `gh` (for filing reports)

```bash
gh auth status   # if not authed: gh auth login
```

### 6. Open the issue template in a browser tab

Pre-load this so reporting is one click during the session:
**https://github.com/eliharoun/agent-smith/issues/new?template=bug-bash.md**

---

## How to file a bug

1. Open the [Bug bash report template](https://github.com/eliharoun/agent-smith/issues/new?template=bug-bash.md).
2. Fill in **every section** — area, severity, environment, repro, expected, actual, logs.
3. Title format: `[bug-bash] <area-letter>: <one-line summary>` — e.g. `[bug-bash] B: install-all double-installs the-architect skill`.
4. If the failure was silent or the message was unhelpful, **re-run with `SMITH_DEBUG=1`** to get the underlying JS stack trace from `wrap()`, and paste the extra output. (`AGENT_SMITH_DEBUG=1` is a separate, doctor-only flag that surfaces spinner-internal debug lines while sections are running — useful for `smith doctor` reproductions.)
   ```bash
   SMITH_DEBUG=1 smith agent install some-agent       # any command
   AGENT_SMITH_DEBUG=1 smith doctor              # doctor only
   ```
5. Submit. Don't wait for triage — keep testing.

### Severity rubric

| Code | Meaning | Examples |
|------|---------|----------|
| **S1** | Data loss / unrecoverable state | `jack-out` removed wrong directory; registry corrupted with no recovery; install overwrote user files |
| **S2** | Command is broken | Crashes uncaught; returns wrong exit code; fails its core job |
| **S3** | Wrong output but recoverable | Misleading error message; doctor reports stale info; install succeeded but `agent list` doesn't show it |
| **S4** | Polish / UX | Typo; confusing wording; missing `--help` text; cosmetic spinner glitch |

When in doubt, file lower (S3 over S2). Triage will bump if needed.

---

## Pick your area

Coordinate with the facilitator so two testers don't pick the same area unless coverage demands it. Each area is sized for ≈75 min of testing + 15 min of reporting.

| # | Area | Focus | Pre-req agent state |
|---|------|-------|---------------------|
| **A** | First-time setup & init | `init`, `init-user`, `agent init`, `agent register`, `agent unregister` | Clean (no `~/.config/agent-smith`) |
| **B** | Install / uninstall lifecycle | `agent install`, `agent install-all`, `agent uninstall`, `agent uninstall-all`, `agent validate`, `jack-out`, `skill bootstrap` | After Area A (or run `smith init` first) |
| **C** | Knowledge sources | `knowledge add/list/fetch/install/validate` | At least one agent installed (e.g. `smith agent install agent-smith` finished) |
| **D** | Doctor / Update / Status | `doctor`, `update`, `status`, `agent list` | At least one agent installed |
| **E** | Daemon | `daemon start/stop/status`, watch behavior | After Area A |
| **F** | OpenCode runtime verification | Installed agents actually invoke; skills load; MCP warnings; USER.md surfaces | At least `smith agent install agent-smith` complete |
| **G** | Skill lifecycle | `skill list/register/unregister/install/update/uninstall`; `requires.skills`; doctor skill sections | After Area A (or run `smith init` first) |
| **H** | Companion-agent runtime (`agent-smith` itself) | `agent-smith` discoverable without `agent register`; bundled knowledge dir materialized; `smith update` reinstall step; in-platform invocation answers from `guide/` | `bash bin/install` complete (or `smith agent install agent-smith`) |

Each area below is self-contained: do the prereqs, work the scenarios in order, then attempt the "try to break it" subsection.

---

## Area A — First-time setup & init

**Prereq:** `rm -rf ~/.config/agent-smith` (you backed it up in setup, right?).

Each scenario: run the steps, compare to **Expected**, mark ✅ or ❌. File a `[bug-bash] A: …` issue for every ❌.

### A-1. `smith init` from scratch
```bash
smith init
```
- **Expected:** Exit 0. Creates `~/.config/agent-smith/` with `registry.json` (containing `{"version":1, "sources":[...]}` — the JSON key is still `sources`; user-facing copy now calls these "agent catalogs") with one default `user-global` catalog pointing at `~/.config/agent-smith/agents`, and `USER.md` (template content). Prints what it did.

### A-2. `smith init` is idempotent
```bash
smith init
smith init    # second run
ls -la ~/.config/agent-smith
```
- **Expected:** Both runs exit 0. Second run does not overwrite `USER.md` (mtime unchanged); does not duplicate catalogs in `registry.json`. ✅ if file count and contents are stable.

### A-3. `smith init-user` opens the editor
```bash
EDITOR=vi smith init-user    # use whatever editor you prefer; vi is safest
```
- **Expected:** Opens `~/.config/agent-smith/USER.md` in `$EDITOR`. Save and exit (`:wq` for vi). Exit 0.

### A-4. `smith status` after init
```bash
smith status
```
- **Expected:** Prints registry path, USER.md path, two-section listing — `Agent catalogs (N):` and `Skill catalogs (N):`. No errors. Exit 0.

### A-5. `smith agent init` happy path
```bash
smith agent init acme-helper \
  --description "Test agent for bug bash" \
  --targets opencode \
  --model-tier sonnet \
  --mode primary \
  --permission read-edit
```
- **Expected:** Creates `~/.config/agent-smith/agents/acme-helper/` with `IDENTITY.md`, `EXPERTISE.md`, `SOUL.md`, `USER.md` (symlink → canonical), `agent.config.json`. Exit 0.

### A-6. `smith agent init` clones from an example
```bash
# Negative case: invalid --description must fail fast pointing at the flag
#   → exit 2, "--description validation failed", NO directory created
smith agent init bad-debugger --description "test" --from incident-debugger

# Positive case: valid description, clone succeeds
smith agent init my-debugger --description "Use proactively for incident debugging on production systems" --from incident-debugger
ls ~/.config/agent-smith/agents/my-debugger/

# Inheritance case: omit --description, inherit from source
smith agent init inherit-debugger --from incident-debugger
ls ~/.config/agent-smith/agents/inherit-debugger/
```
- **Expected:**
  - **Negative case** exits 2 with `--description validation failed` and lists schema reasons (min length, action phrase). No `bad-debugger/` directory is created. The `ls` line in the negative case is intentionally omitted — there is nothing to list.
  - **Positive case** exits 0; `ls` shows `agent.config.json`, `IDENTITY.md`, `EXPERTISE.md`, `SOUL.md`, `USER.md`.
  - **Inheritance case** exits 0; bundle mirrors `examples/incident-debugger/` shape, description inherited from source config.

### A-7. `smith agent register` a project-scoped agent catalog
```bash
mkdir -p /tmp/bb-project-agents
# Empty dir — register should reject without --allow-empty
smith agent register /tmp/bb-project-agents --kind project --label "bug bash test project"
# Re-run with the escape hatch
smith agent register /tmp/bb-project-agents --kind project --label "bug bash test project" --allow-empty
smith status
```
- **Expected:** First call exits 2 (validation-failed) with a "contains no agent bundles" error mentioning `--allow-empty`. Second call succeeds; `smith status` lists `/tmp/bb-project-agents` under `Agent catalogs` as a project catalog.

### A-8. `smith agent unregister` removes the agent catalog
```bash
smith agent unregister /tmp/bb-project-agents
smith status
```
- **Expected:** Status no longer lists it. Exit 0.

### A-7b. `smith agent register` rejects a path that looks like a skill catalog
```bash
mkdir -p /tmp/bb-skill-shaped/my-skill
echo "# fake skill" > /tmp/bb-skill-shaped/my-skill/SKILL.md
smith agent register /tmp/bb-skill-shaped --kind project
```
- **Expected:** Exit 2 (validation-failed). Error message identifies the skill-shaped layout and suggests `smith skill register` instead.

### A-9. `smith agent list` shows scaffolded agents
```bash
smith agent list
```
- **Expected:** Shows `acme-helper` and `my-debugger`. Exit 0.

### Try to break it (Area A)

- A-X1. Run `smith agent init acme-helper` again (same name) → should fail cleanly with exit 1, not crash.
- A-X2. Run `smith agent init` with no `--description` → should fail cleanly with exit 2.
- A-X3. Run `smith agent register /nonexistent/path --kind project` — exit 2, "path does not exist".
- A-X4. Run `smith agent register /tmp/bb-project-agents --kind banana` — exit 2 with Commander choice-validation error: `option '--kind <kind>' argument 'banana' is invalid. Allowed choices are user-global, project, registered.` (Validation must reject at Commander level so a typo never writes an unrecognized `kind` to the registry — see commit fixing this regression in `src/index.ts`.)
- A-X5. **Skip `smith init` and run `smith agent init foo --description x` directly.** Per `init-agent.ts:166`, this only warns about missing USER.md. Try `smith agent install foo` afterward — does it fail informatively or confusingly?
- A-X6. Manually edit `~/.config/agent-smith/registry.json` to set `"version": 2`, then run any command. Per `registry.ts:30`, this should error clearly. Does it?
- A-X7. Manually corrupt `registry.json` to invalid JSON. Run `smith status`. Expect a clear parse error, not a stack trace.

---

## Area B — Install / uninstall lifecycle

**Prereq:** Area A complete OR run `smith init` and `smith agent init acme-helper --description x --targets opencode --model-tier sonnet --mode primary --permission read-edit`.

### B-1. `smith skill bootstrap` installs the bundled architect and keymaker
```bash
smith skill bootstrap
ls ~/.config/opencode/skills/the-architect/
ls ~/.config/opencode/skills/the-keymaker/
```
- **Expected:** Both skill directories exist with `SKILL.md`. Exit 0. Note: `smith skill bootstrap` installs *only* the bundled skills (`the-architect`, `the-keymaker`); it does **not** install the `agent-smith` persona — that path goes through `smith agent install agent-smith` (also driven by `bash bin/install` Step 9 and `smith update` Step 4). For the deeper companion-agent runtime exercise see [Area H](#area-h--companion-agent-runtime-agent-smith-itself).

### B-2. `smith skill bootstrap --dry-run` is non-destructive
```bash
rm -rf ~/.config/opencode/skills/the-architect ~/.config/opencode/skills/the-keymaker
smith skill bootstrap --dry-run
ls ~/.config/opencode/skills/ 2>&1
```
- **Expected:** Dry-run prints what it would do. The two skill directories are NOT created. Exit 0.
- (Then run `smith skill bootstrap` for real to restore for later scenarios.)

### B-3. `smith agent install <name>` for the agent you scaffolded
```bash
# acme-helper was created with stubs — install rejects TODO markers.
# Either edit the persona files first, or test with my-debugger (cloned via --from).
smith agent install my-debugger
ls ~/.config/opencode/agents/my-debugger.md

# Verify acme-helper fails with stubs (expected):
smith agent install acme-helper
```
- **Expected:**
  - `my-debugger` installs successfully (exit 0). Targets produce platform-specific files (e.g. `~/.config/opencode/agents/my-debugger.md` — a flat file, not a directory).
  - `acme-helper` exits non-zero with TODO-marker validation errors. This is correct — `agent init` stubs are placeholders that must be edited before install.
  - If the scaffolded bundle has any `knowledge.sources`, the install output also contains `→ knowledge <id> (N files, X.XKB, <delivery>)` lines and a `N changed, M unchanged · …` tally below the per-target block. Tester should sanity-check that the file count and delivery match `agent.config.json`. See [guide/03-installing-and-rendering.md#knowledge-materialization-summary](../guide/03-installing-and-rendering.md#knowledge-materialization-summary).

### B-4. `smith agent install` of an unknown agent
```bash
smith agent install nonexistent-agent
echo $?
```
- **Expected:** Clear error message naming the agent. Exit 1.

### B-4b. Bare `smith agent install` (no agent name)
```bash
smith agent install
```
- **Expected:** Exit 2 (usage error, NOT a raw commander `missing required argument 'name'` stack). Output is a `SmithError` listing all known agents alphabetically and suggesting `smith agent install-all` (or `smith agent init <name>` if no agents are registered yet).

### B-5. `smith agent install-all`
```bash
smith agent install-all
```
- **Expected:** Installs every registered agent. Reports per-agent status. Exit 0 if all succeeded, 1 if any failed.

### B-6. `smith agent validate` on scaffolded bundles
```bash
smith agent validate my-debugger     # cloned from example — should pass
smith agent validate acme-helper     # has stubs — should fail with TODO markers
smith agent validate                 # all bundles — mixed results
```
- **Expected:**
  - `my-debugger` exits 0 (possibly with warnings about USER.md line count — non-fatal).
  - `acme-helper` exits non-zero, listing TODO-marker errors and line-count warnings.
  - Bare `smith agent validate` reports per-agent summary; exit 0 only if ALL pass, non-zero if any fail.

### B-7. `smith agent uninstall <name>` round-trip
```bash
smith agent uninstall my-debugger --dry-run
smith agent uninstall my-debugger
ls ~/.config/opencode/agents/my-debugger.md 2>&1
```
- **Expected:** Dry-run lists target paths it would remove. Real run removes them (prints `✓ removed:`). `ls` shows file is gone. Bundle source under `~/.config/agent-smith/agents/my-debugger/` is **untouched** (uninstall removes only install targets). Exit 0.
- **Note:** If agent was never installed, dry-run still lists computed paths (without existence check — cosmetic UX gap), and real run reports `- not found:` per file. Both exit 0.

### B-8. `smith agent uninstall` of an unknown agent
```bash
smith agent uninstall who-dis
echo $?
```
- **Expected:** Clear error, exit 1.

### B-9. `smith agent uninstall-all` requires confirmation
```bash
smith agent uninstall-all
# At prompt, type 'n' or just press enter
```
- **Expected:** Prompt before destruction. Declining exits 1, no files removed. Then re-run with `--yes` to skip the prompt.

### B-10. `smith jack-out --dry-run` previews everything
```bash
smith jack-out --dry-run
```
- **Expected:** Lists every install target across opencode/claude/codex AND `~/.config/agent-smith` itself, the `~/.local/bin/smith` symlink, the rc-file marker block, and the `~/.agent-smith/` source clone. Exit 0. Nothing actually removed.

### B-11. `smith agent install` resolves `requires.skills` interactively (default `prompt` mode)
```bash
# Scaffold an agent declaring a skill it doesn't yet have installed.
smith agent init skill-needer \
  --description "Test agent that requires the-architect skill" \
  --targets opencode --model-tier sonnet --mode primary \
  --permission read-only \
  --requires-skills the-architect

# Pretend the-architect isn't installed:
smith skill uninstall the-architect 2>/dev/null
smith agent install skill-needer
```
- **Expected:** Build prints first, then required-skills summary, then per-missing-skill prompt. Answering `y` installs the-architect into all 3 platforms. Answering `n` skips with a warning. Either way the agent install completes (skill failures NEVER abort agent install). Try also `smith agent install skill-needer --no-skills` (skip silently) and `smith agent install skill-needer --with-skills` (auto-install).

### B-12. Ambiguous answers re-prompt
- During B-11, type `maybe` at the prompt → should re-prompt up to 3 times, then default to skip.

### B-13. Non-TTY install (CI mode)
```bash
echo | smith agent install skill-needer       # pipe empty stdin
```
- **Expected:** No hang. Detects non-TTY, warns, skips required-skill installs. Exit 0.

### Try to break it (Area B)

- B-X1. `smith agent install acme-helper` twice in a row. Second run should be idempotent — does it duplicate symlinks?
- B-X2. After installing, **manually delete** `~/.config/opencode/agents/acme-helper/SKILL.md` (or another file). Re-run `smith agent install acme-helper`. Does it heal? Does it warn?
- B-X3. After installing, **`chmod 000`** one of the installed files. Run `smith agent uninstall acme-helper`. Per recent migration (commit `431ff0f`), file-removal failures should yield exit **3 (EXIT_PARTIAL)**, not exit 2. Does it?
- B-X4. `smith jack-out` then type `JACK-OUT` (uppercase) at the prompt. Per `jack-out.ts:67`, only the literal lowercase `jack-out` should proceed. Does anything else abort?
- B-X5. **`Ctrl-C` mid-install** of a multi-agent `agent install-all`. Does the next `smith status` / `smith agent list` still work? Are there partial installs?
- B-X6. Pre-create a junk file at `~/.config/opencode/agents/acme-helper/junk.txt` then `smith agent install acme-helper`. Does install preserve it, overwrite it, or refuse?
- B-X7. Reference an MCP server in your scaffold (`--mcp-servers fake-server`) that isn't configured anywhere. Per `mcp-availability.ts`, install should *warn* but still succeed with exit 0. Does it?
- B-X8. **`smith agent install --with-skills`:** scaffold an agent declaring `requires.skills` in `agent.config.json` without the skill installed. Run `smith agent install <agent> --with-skills`. Expected: required skills auto-install non-interactively (distinct from `--yes` which only suppresses prompts; `--no-skills` skips with warning). Compare exit codes for all three flag modes.
- B-X9. **Byte-identical install skip:** run `smith agent install <agent>` twice in succession (no edits between). Expected: second run reports unchanged files as "skipped" per commit `d2e6ce9`. Verify `stat -f "%m" <installed-file>` returns the same mtime after the second install. Code ref: `installer.ts:76-82`. If the agent has knowledge sources, the second run should also flip every `→ knowledge <id>` line to `· knowledge <id> (unchanged)` and the knowledge tally to `0 changed, N unchanged · …` — the contract grew to cover knowledge materialization byte-state, not just rendered-agent files. To verify the changed→unchanged transition explicitly: `rm ~/.config/agent-smith/knowledge/<agent>/_manifest.json && smith agent install <agent>` should re-show `→ knowledge` lines for every source; a subsequent re-run with no further edits flips them all back to `· (unchanged)`.
- B-X10. **Partial-failure envelope:** register an agent catalog with 3+ bundles. Corrupt one bundle (e.g. `echo not-json > <bundle>/agent.config.json`). Run `smith agent install-all`. Expected: other bundles install successfully; corrupted one prints warning to stderr; exit code 3 (EXIT_PARTIAL). Then `smith doctor` flags the issue. Per envelope migration (commit `b66d30b`).

---

## Area C — Knowledge sources

**Prereq:** `smith agent install agent-smith` (so `agent-smith` exists as an installed agent to attach knowledge to).

### C-1. `smith knowledge add` with a URL source (auto-materializes)
```bash
smith knowledge add agent-smith url https://opencode.ai/docs --id opencode-docs --description "Live OpenCode docs"
cat ~/.config/agent-smith/agents/agent-smith/agent.config.json | grep -A 3 knowledge
ls ~/.config/agent-smith/knowledge/agent-smith/
cat ~/.config/agent-smith/knowledge/agent-smith/_manifest.json
```

- **Expected:** Exit 0. Two-line output: `→ added knowledge source opencode-docs (url)` then `materializing via 'smith agent install agent-smith'…` followed by the install pipeline output. The install pipeline output now includes a knowledge block with `→ knowledge opencode-docs (1 file, ~XKB, inline)` (or `file`/`url` delivery depending on resolution) and a `1 changed, 0 unchanged · 1 file, ~XKB · inline tokens U/B` tally line — the per-source `→` confirms materialization succeeded and the inline-tokens clause appears because this source's content was inlined into agent prompts. Re-running `smith agent install agent-smith` immediately afterward should flip that line to `· knowledge opencode-docs (1 file, ~XKB, inline) (unchanged)` and the tally to `0 changed, 1 unchanged · …`. Source written to `knowledge.sources[]` AND materialized under `~/.config/agent-smith/knowledge/agent-smith/` with a populated `_manifest.json` — all in one command. (Earlier versions materialized under per-target paths; the layout moved under agent-smith's state home shortly after v0.12.0 — see CHANGELOG.md and `src/io/knowledge-paths.ts:6-11`.) See [guide/03-installing-and-rendering.md#knowledge-materialization-summary](../guide/03-installing-and-rendering.md#knowledge-materialization-summary) for the full output contract.
- **Config-first guarantee:** if materialize fails (network down, fetch error, etc.), the config write still succeeds and the output ends with `warn materialize failed: <reason>. Source was saved. Retry: smith agent install agent-smith`. Verify by temporarily disabling network before re-running with a different `--id`.

### C-2. `smith knowledge add --no-install` defers materialization
```bash
smith knowledge add agent-smith url https://example.com/other --id deferred-test --no-install
cat ~/.config/agent-smith/agents/agent-smith/agent.config.json | grep deferred-test
# Manifest should NOT yet list deferred-test:
cat ~/.config/agent-smith/knowledge/agent-smith/_manifest.json | grep deferred-test
# Now materialize on demand:
smith agent install agent-smith
```
- **Expected:** With `--no-install`, output is `→ added knowledge source deferred-test (url)` then `run 'smith agent install agent-smith' to materialize` (no install pipeline output). The grep for `deferred-test` in the manifest returns nothing until `smith agent install agent-smith` runs.

### C-3. `smith knowledge list <agent>` — 4 states
`knowledge list` distinguishes four distinct states with accurate hints. Verify each:

```bash
# State A: agent does not exist
smith knowledge list nonexistent-agent ; echo "exit=$?"

# State B: agent exists but declares no knowledge sources (use a freshly scaffolded agent or one with no sources)
smith agent init empty-helper --description "test agent with no knowledge"
smith agent install empty-helper                       # may fail on stubs — that's fine, list still works on the bundle
smith knowledge list empty-helper ; echo "exit=$?"

# State C: agent declares sources but they are not yet materialized (use --no-install path)
smith knowledge add empty-helper url https://example.com/x --id pending --no-install
smith knowledge list empty-helper ; echo "exit=$?"

# State D: full manifest (after materialization)
smith knowledge list agent-smith ; echo "exit=$?"
```
- **Expected:**
  - **State A** — exit 1, `not-found(agent)` error naming the agent + hint `Try: smith agent init <name> --description ...`.
  - **State B** — exit 0, message `<agent> declares no knowledge sources` + hint `Try: smith knowledge add <agent> <type> <path-or-url>`.
  - **State C** — exit 0, message `<agent> declares N source(s) but none are materialized yet` + hint `Try: smith agent install <agent>`.
  - **State D** — exit 0, table of sources with file counts and token totals (the original happy-path output).
- **What this fixes:** previously, *any* missing manifest produced `installed knowledge not found: <agent>` with `Try: smith agent install <agent>` — even when the agent didn't exist or genuinely had zero sources. The new states give accurate, actionable hints.

### C-4. `smith knowledge fetch <agent>` (no `--source`)
```bash
smith knowledge fetch agent-smith
```
- **Expected:** Re-runs install. Does NOT clear the cache. Exit 0.

### C-5. `smith knowledge fetch --source <id>` clears cache
```bash
ls ~/.config/agent-smith/knowledge/agent-smith/.cache/
smith knowledge fetch agent-smith --source opencode-docs
ls ~/.config/agent-smith/knowledge/agent-smith/.cache/
```
- **Expected:** Exit 0. **⚠ Known footgun (`fetch.ts:24`):** the `--source` flag clears the *entire* `.cache/` directory, not just that source's cache. Verify this happens. If the message implies otherwise, that's an S3 bug.

### C-6. `smith knowledge validate`
```bash
smith knowledge validate agent-smith
smith knowledge validate                # all
```
- **Expected:** Exit 0 if no validation errors.

### C-7. Add a file source
```bash
echo "# Test knowledge" > /tmp/bb-knowledge.md
smith knowledge add agent-smith file /tmp/bb-knowledge.md --id local-test
ls ~/.config/agent-smith/knowledge/agent-smith/
```
- **Expected:** `add` auto-materializes (no separate `smith agent install` needed). Local file is listed in the install pipeline output and present in the knowledge directory.

### C-8. Add a git source
```bash
smith knowledge add agent-smith git https://github.com/octocat/Hello-World.git --id octocat-hello --description "tiny test repo"
cat ~/.config/agent-smith/knowledge/agent-smith/_manifest.json | jq '.sources[] | select(.id=="octocat-hello")'
```
- **Expected:** `add` auto-materializes — repo cloned (uses your local git config / SSH agent — smith never handles credentials directly) and `_manifest.json` records the resolved sha in one command. Re-running `smith agent install agent-smith` reuses the cached clone unless `smith knowledge fetch` is run first.

### C-9. Add a confluence source by editing config (no CLI scaffolding for confluence yet)
```bash
# `knowledge add` only accepts <path-or-url> shaped sources. Add confluence by editing the bundle config:
cat >> /tmp/cf-source.json <<'EOF'
{ "id": "eng-handbook", "type": "confluence", "space": "ENG", "maxPages": 5, "delivery": "file" }
EOF
# Manually merge that into ~/.config/agent-smith/agents/agent-smith/agent.config.json under knowledge.sources[]

# Then provide credentials (any one of these tiers works — see C-X11 for full precedence):
export SMITH_ATLASSIAN_EMAIL=you@example.com
export SMITH_ATLASSIAN_API_TOKEN=...           # or SMITH_JIRA_API_TOKEN as fallback
# Required: your Atlassian Cloud workspace URL, e.g. https://acme.atlassian.net
# (Atlassian Cloud is workspace-scoped — there is no global default.)
export SMITH_ATLASSIAN_BASE_URL=https://yourco.atlassian.net

smith knowledge validate agent-smith
smith agent install agent-smith
```
- **Expected:** Validate passes. Install fetches up to 5 pages from the ENG space and writes them as markdown under `knowledge/sources/eng-handbook/`. Missing creds yield a clear error naming the missing env vars.

### C-10. Add a jira source
- Same shape as C-9 but `"type": "jira", "jql": "project = ENG AND status = Open", "fields": ["summary","status"], "maxResults": 10`.
- **Expected:** Each issue rendered as one markdown file with summary + status. Default fields are `summary`/`description`/`status` if `fields` omitted.

### C-11. Validator rejects unsupported types
```bash
# Manually add an npm source to agent.config.json:
#   { "id": "x", "type": "npm", "package": "lodash", "delivery": "file" }
smith knowledge validate agent-smith
```
- **Expected:** Exit 1. Error message: `type=npm is not supported yet`. Same for `materialize: "pdf-extract"`.

### Try to break it (Area C)

- C-X1. `smith knowledge add` with no positional args → exit 2, usage message.
- C-X2. `smith knowledge add agent-smith url not-a-valid-url` → expect a clear error before writing anything.
- C-X3. `smith knowledge add agent-smith url <url>` twice with the same `--id` — does it error or silently overwrite?
- C-X4. `smith knowledge add agent-smith url <url> --no-install` then `smith knowledge list agent-smith` — should print State C ("declares N source(s) but none are materialized yet"), exit 0. No ENOENT, no stack trace.
- C-X5. **Manually edit a file** under `~/.config/agent-smith/knowledge/agent-smith/` then run `smith agent install agent-smith`. Per `pipeline.ts:111`, the directory is `rm -rf`'d before rebuild. Confirm your edit is silently lost. Is there any warning?
- C-X6. Add a URL source pointing to a 404. Run `smith agent install agent-smith`. Does install fail, partial-succeed, or silently succeed with empty content?
- C-X7. Add a file source pointing to a path that doesn't exist. Same question.
- C-X8. **Git auth failure:** add a git source pointing to a private repo your machine can't access. Per `acquire.ts`, the spawner inherits your env so failures bubble up via stderr. Confirm the error is informative and doesn't expose secrets.
- C-X9. **SSH-style git URL:** `smith knowledge add agent-smith git git@github.com:octocat/Hello-World.git --id ssh-test`. Schema accepts SCP-style refs (`git@host:path`). Validate + install should succeed if your SSH agent has the key.
- C-X10. **Per-source cache clear is broken-by-design (currently):** the `--source <id>` arg to `smith knowledge fetch` clears the entire `.cache/` dir, not just that source. Confirm + file as S4 if the help text or output implies otherwise.
- C-X11. **Atlassian creds precedence (2 tiers, first complete `email + token` pair wins):** (1) `SMITH_ATLASSIAN_EMAIL` + (`SMITH_ATLASSIAN_API_TOKEN` ‖ `SMITH_JIRA_API_TOKEN`) env, (2) `~/.config/agent-smith/.env` (same `SMITH_*` keys). Confirm by setting both and inspecting `smith doctor`'s `atlassian-auth` section's `source` field. Then unset tier 1 to verify fall-through to tier 2. See `src/io/atlassian-auth.ts:36-71`.
- C-X12. **Env-var bridge for atlassian-skills:** When `SMITH_ATLASSIAN_*` vars are configured, verify `smith doctor`'s `atlassian-auth` section reports bridge status for `JIRA_*`/`CONFLUENCE_*` per-product env vars. The bridge auto-writes these for the Python-based atlassian-skills bundles.

---

## Area D — Doctor / Update / Status

**Prereq:** At least `smith agent install agent-smith` complete.

### D-1. `smith doctor` — happy path online
```bash
smith doctor
```
- **Expected:** Streaming spinners (TTY) for each detected-platform section, in canonical order: `opencode` (live diff), `claude-code` (manual provenance), `codex` (manual provenance), `model-resolution` (only when OpenCode is on PATH), then the cross-cutting sections: `workspace`, `atlassian-auth`, `skill-drift`, `agent-required-skills`, `registry-hygiene`. **Platform sections are filtered to the CLIs on your PATH** (`opencode`/`claude`/`codex`); absent platforms are silently omitted and listed in `report.skippedPlatforms` (visible in `--json`). Exit 0 if all fresh.

### D-2. `smith doctor --offline`
```bash
smith doctor --offline
```
- **Expected:** Skips OpenCode live fetch (status `offline-skipped`). Other sections still run. Exit 0.

### D-3. `smith doctor --json`
```bash
smith doctor --json | jq .
```
- **Expected:** Machine-readable JSON, no spinners. Same exit code as non-JSON.

### D-4. `smith doctor --no-cache`
```bash
smith doctor --no-cache
```
- **Expected:** Forces fresh OpenCode fetch (bypasses 24h cache). Slower. Exit 0.

### D-5. `smith doctor --skip-model-resolution`
```bash
smith doctor --skip-model-resolution
```
- **Expected:** Suppresses the model-resolution section. Exit 0. **Note:** when `opencode` is not on `PATH`, the model-resolution section is already auto-suppressed by platform detection, so this flag is a no-op on that host.

### D-6. `smith update --dry-run`
```bash
smith update --dry-run
```
- **Expected:** Fetches `origin/main`, reports `would pull N commit(s)` (or `Already up to date`). Does NOT pull. Does NOT run `bun install`. Does NOT run doctor. Exit 0.

### D-7. `smith update` on dirty workspace
```bash
cd ~/.agent-smith
echo "junk" > /tmp/bb-junk-in-tree.txt && cp /tmp/bb-junk-in-tree.txt ./bb-junk.txt
smith update
git status                # confirm dirty
```
- **Expected:** Exit 1. Message says "uncommitted changes". Shows the porcelain output. Cleanup: `rm bb-junk.txt`.

### D-8. `smith status`
```bash
smith status
```
- **Expected:** Lists registry path, USER.md path, both `Agent catalogs (N):` and `Skill catalogs (N):` sections. Exit 0.

### D-9. `smith agent list`
```bash
smith agent list
```
- **Expected:** Lists every agent across every catalog with target info. Exit 0.

### D-10. `smith doctor` output verbosity

- [ ] `smith doctor` on a healthy install prints ≤15 lines total and ends
      with the 3-line footer hints.
- [ ] `smith doctor` on a system with OpenCode drift auto-expands the
      OpenCode section (and only that section).
- [ ] `smith doctor --verbose` matches the pre-v0.13 full output.
- [ ] `smith doctor --quiet` prints nothing; exit code matches the
      default-mode run.
- [ ] `smith doctor --verbose --quiet` exits 2 with a usage error.
- [ ] `smith doctor --quiet --json` still emits the full JSON envelope.
- [ ] `smith doctor | cat` (pipe) emits the same content as the TTY run
      (no spinner, but same summary + auto-expand + footer).

### Try to break it (Area D)

- D-X1. **Network down** during `smith doctor`. Disable WiFi or block `api.opencode.ai`. Expected: opencode section reports `network-error`, exit 2. Other sections still complete.
- D-X2. **Corrupt the doctor cache:** `echo not-json > ~/.cache/agent-smith/opencode-schema-cache.json && smith doctor`. Expect graceful re-fetch, not a parse-error crash.
- D-X3. Set `XDG_CACHE_HOME=/tmp/bb-xdg && smith doctor`. Expect cache to land at `/tmp/bb-xdg/agent-smith/...` per `doctor.ts:27-31`.
- D-X4. `AGENT_SMITH_DEBUG=1 smith doctor`. Doctor-internal spinner debug lines should appear on stderr. (For non-doctor commands use `SMITH_DEBUG=1` instead.) File a bug if debug mode is unhelpful.
- D-X5. Run `smith update` while another `smith update` is already running. Expected: filesystem-level race; either second fails cleanly or both succeed safely. Document what happens.
- D-X6. Run `smith doctor --offline --json --no-cache`. Conflicting-ish flags; should still produce sane JSON.
- D-X7. **Doctor `registry-hygiene` section:** register an agent catalog at a path, then `rm -rf` that path. Run `smith doctor`. Expected: `registry-hygiene` section flags the missing catalog (informational; doesn't bump exit code per `run-doctor.ts:267-279`). Cleanup: `smith agent unregister <path>`.
- D-X8. **Doctor `model-resolution` section offline mode:** run `AGENT_SMITH_DISABLE_LIVE_RESOLUTION=1 smith doctor`. Expected: `model-resolution` section uses vendored data only (no `opencode models` CLI call). Compare with a normal `smith doctor` run to see the difference. File a bug if vendored data is stale (>30 days old).
- D-X9. **Deepen `--json` doctor verification:** run `smith doctor --json | jq 'keys'`. Expected: top-level keys match the `DoctorReport` schema (`generatedAt`, `platforms`, `skippedPlatforms`, `modelResolution`, `workspace`, `atlassianAuth`, `skillDrift`, `agentRequiredSkills`, `registryHygiene`, `exitCode`). Verify all sections present (some `undefined` if disabled). `skippedPlatforms` is always present (empty array when all three platforms are on PATH). Confirm `exitCode` matches process exit code.
- D-X10. **`smith update` Step 4 reinstall hook:** confirm `smith update` (not `--dry-run`) prints `Refreshing agent-smith knowledge...` between the `bun install` step and the doctor step. For the deeper failure-mode coverage of this step, see [Area H scenarios H-6 and H-7](#area-h--companion-agent-runtime-agent-smith-itself).
- D-X11. **No supported platform on PATH.** Force an empty platform-detection probe by stripping all the platform CLIs from PATH. The simplest way is a one-shot with a minimal PATH that excludes wherever `opencode`, `claude`, and `codex` are installed — e.g. `BUN=$(which bun) && PATH=/usr/bin:/bin "$BUN" $(which smith) doctor`. Expected: prints the refusal message with all three install hints (OpenCode docs URL + npm one-liners for Claude Code and Codex), exits `2`. No platform sections run, no cross-cutting sections run, no spinners. Repeat with `--json` and verify the envelope `{ "error": "no-platform-detected", "message": "...", "exitCode": 2 }`. File a bug if the message wording drifts from `NO_PLATFORM_REFUSAL_MESSAGE` exported from `src/cli/commands/doctor.ts`.

---

## Area E — Daemon

**Prereq:** Area A complete; no daemon already running (`smith daemon stop` first if unsure).

### E-1. `smith daemon status` when not running
```bash
smith daemon stop 2>/dev/null
smith daemon status
```
- **Expected:** Reports `not running`. Exit 0.

### E-2. `smith daemon start` then `status`
```bash
smith daemon start
sleep 2
smith daemon status
ls ~/.config/agent-smith/daemon.pid ~/.config/agent-smith/daemon.log
```
- **Expected:** Status reports `running` with PID. Both files exist. Exit 0.

### E-3. `smith daemon stop`
```bash
smith daemon stop
ls ~/.config/agent-smith/daemon.pid 2>&1
smith daemon status
```
- **Expected:** PID file removed. Status reports `not running`. Exit 0.

### E-4. Daemon log captures activity
```bash
smith daemon start
sleep 5
cat ~/.config/agent-smith/daemon.log
smith daemon stop
```
- **Expected:** Log has at least startup messages. No stack traces.

### E-5. `smith daemon run` (foreground) — Ctrl-C clean exit
```bash
smith daemon run
# ...wait a few seconds, then Ctrl-C
```
- **Expected:** Clean exit on SIGINT. No orphaned PID file written.

### Try to break it (Area E)

- E-X1. **Stale PID file:** `smith daemon start && smith daemon status` (note the PID), then `kill -9 <pid>`, then `smith daemon status`. Expected: `stale pid file` per `daemon.ts:23`. File a bug if it claims `running`.
- E-X2. After stale, run `smith daemon start` again. Per the code, it should write a new PID without warning. Is the absence of warning OK or worth an S4?
- E-X3. `smith daemon start; smith daemon start` — double start. What happens?
- E-X4. `chmod 000 ~/.config/agent-smith/daemon.pid` then `smith daemon stop`. Should fail informatively, not crash. Cleanup: `chmod 644 ...` and rm.
- E-X5. While daemon is running, `rm ~/.config/agent-smith/daemon.pid` manually. Then `smith daemon stop`. What happens to the actual process?
- E-X6. While daemon is running, `cd ~/workspace/agent-smith && touch agents/agent-smith/IDENTITY.md` (modify a watched file). Daemon should react in the log. Does it?
- E-X7. **Daemon wedged-process detection:** start the daemon (`smith daemon start`), get its PID (`smith daemon status` or `cat ~/.config/agent-smith/daemon.pid`), then `kill -STOP <pid>` to freeze it. Wait 30s, then `smith daemon status`. Expected: status reports stale heartbeat (the heartbeat file mtime is older than ~3× heartbeatIntervalMs per `daemon.ts:405-461` and commit `1689a38`). Cleanup: `kill -CONT <pid> && smith daemon stop`.
- E-X8. **Custom daemon intervals via env:** run `SMITH_PULL_INTERVAL_MS=60000 SMITH_HEARTBEAT_INTERVAL_MS=1000 smith daemon start`. Verify by tailing `~/.config/agent-smith/daemon.log` (heartbeat ticks every 1s, pulls every 60s). Then test invalid values: `SMITH_PULL_INTERVAL_MS=abc smith daemon start` — expected: silently falls back to defaults (15min/5s) per `parsePositiveInt` in `index.ts:381-384`.

---

## Area F — OpenCode runtime verification

**Prereq:** `smith agent install agent-smith` complete (so `agent-smith` is installed to OpenCode).

This area verifies the *real* end goal: that an installed persona actually shows up and runs in OpenCode.

### F-1. OpenCode lists the agent
```bash
opencode --help          # check OpenCode's own command for listing agents
# Or open OpenCode, list agents in the UI
```
- **Expected:** `agent-smith` shows up in OpenCode's agent list.

### F-2. OpenCode loads the bundled skills
- Open OpenCode and check whether `the-architect` and `the-keymaker` skills are available.
- **Expected:** Both skills are loadable. SKILL.md content matches what's in `~/.config/opencode/skills/the-architect/SKILL.md` and `~/.config/opencode/skills/the-keymaker/SKILL.md`.

### F-3. Invoke the agent
- Start an OpenCode session with `agent-smith` as the active agent.
- Ask it: "What is your name and what do you do?"
- **Expected:** Response reflects the IDENTITY.md/EXPERTISE.md/SOUL.md content, not generic Claude/GPT defaults.

### F-4. USER.md surfaces in conversation
- Edit `~/.config/agent-smith/USER.md` to include a unique marker like "I prefer banana smoothies in code reviews."
- Re-run `smith agent install agent-smith` (USER.md is symlinked, so this might be unnecessary — verify both behaviors).
- Start a fresh OpenCode session with `agent-smith`.
- Ask: "What do you know about my preferences?"
- **Expected:** Agent references the banana smoothie marker.

### F-5. MCP availability warning
```bash
smith agent init mcp-test --description "test mcp warn" --targets opencode --model-tier sonnet --mode primary --permission read-only --mcp-servers fake-mcp-server
smith agent install mcp-test
```
- **Expected:** Install succeeds (exit 0) but prints a warning like `MCP server 'fake-mcp-server' referenced but not configured for opencode`. Per `mcp-availability.ts`, this is non-fatal.

### F-6. Skill invocation inside OpenCode
- In an OpenCode session with `agent-smith`, ask it to "use the the-architect skill to design a CLI tool" and "use the the-keymaker skill to create a new skill".
- **Expected:** Agent acknowledges both skills, follows their workflows.

### Try to break it (Area F)

- F-X1. Remove `~/.config/opencode/agents/agent-smith/USER.md` (which is a symlink). Start OpenCode session. Does it crash, warn, or silently use no USER context?
- F-X2. Edit `agent.config.json` of an installed agent to claim a permission preset that doesn't exist. Re-run install. Expected: validate fails or install warns.
- F-X3. Run `smith agent uninstall agent-smith` while OpenCode has an active session with that agent. What happens to the session? Does anything in `~/.config/opencode/` get partially removed?
- F-X4. Install an agent with `--targets opencode,claude-code,codex` — confirm knowledge materializes once under `~/.config/agent-smith/knowledge/<name>/` regardless of targets, per `src/io/knowledge-paths.ts:6-19` (interface JSDoc: "Knowledge is materialized under agent-smith's own state home — NOT under any platform's agent-discovery scope"). Each target frontmatter should carry a read-grant (`permission.read.<dir>/**: allow` for OpenCode; `additionalDirectories` for Claude; `allowed_external_directories` for Codex). Confirm the comment matches reality.
- F-X5. Install a file source (Area C-7), then ask the agent to reference its content. Does OpenCode actually expose `knowledge/` to the model?

---

## Area G — Skill lifecycle

**Prereq:** Area A complete (`smith init` done). Optionally `smith skill bootstrap` to start with the-architect already installed.

This area exercises `smith skill {list,register,unregister,install,update,uninstall}` plus the `requires.skills` ↔ doctor integration.

### G-1. `smith skill list` after a clean install
```bash
smith skill list
```
- **Expected:** Shows the-architect and the-keymaker (if `bootstrap` ran) and any atlassian-skills catalog skills. Each row shows status (`ok` / `drift` / `missing` / `source-missing`). Exit 0.

### G-2. `smith skill register` a local skill catalog
```bash
mkdir -p /tmp/bb-skills/my-skill
cat > /tmp/bb-skills/my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: Test skill for bug bash. Use when verifying skill registration.
---

# my-skill

This is a bug bash test skill.
EOF
smith skill register /tmp/bb-skills --as bb-test
smith skill list
```
- **Expected:** Catalog `bb-test` written to `~/.config/agent-smith/skill-catalogs.json`. List shows `my-skill` as discoverable but not yet installed.

### G-3. `smith skill install` from the registered catalog
```bash
smith skill install bb-test/my-skill
ls ~/.config/opencode/skills/my-skill/
ls ~/.claude/skills/my-skill/
ls ~/.agents/skills/my-skill/
cat ~/.config/agent-smith/installed-skills.json | jq '.installed[] | select(.name=="my-skill")'
```
- **Expected:** Skill copied to all 3 platform skill dirs. `installed-skills.json` records the install with a content hash. Exit 0.

### G-4. `smith skill install <name>` (bare ref) when unambiguous
```bash
smith skill uninstall my-skill
smith skill install my-skill           # bare name; should resolve uniquely
```
- **Expected:** Resolves to bb-test/my-skill. Installs. Exit 0. Add a second catalog with the same skill name then re-run — should fail with an "ambiguous" error naming both candidates.

### G-5. `smith skill update` after editing source
```bash
echo "extra paragraph" >> /tmp/bb-skills/my-skill/SKILL.md
smith skill update my-skill
diff /tmp/bb-skills/my-skill/SKILL.md ~/.config/opencode/skills/my-skill/SKILL.md
```
- **Expected:** Installed copy now matches source. Pre-update hash printed so user knows what was overwritten. Exit 0.

### G-6. Drift detection
```bash
echo "manual edit" >> ~/.config/opencode/skills/my-skill/SKILL.md
smith skill list
smith doctor
```
- **Expected:** `skill list` shows `my-skill` as `drift`. Doctor's `skill-drift` section reports the drift. Informational only — exit code unaffected.

### G-7. Ad-hoc install via `--from`
```bash
mkdir -p /tmp/bb-adhoc-skill
cat > /tmp/bb-adhoc-skill/SKILL.md <<'EOF'
---
name: adhoc-skill
description: Ad-hoc test skill. Use when verifying --from install.
---

# adhoc-skill
EOF
smith skill install --from /tmp/bb-adhoc-skill --as bb-adhoc
smith skill list
cat ~/.config/agent-smith/skill-catalogs.json | jq '.catalogs[] | select(.label=="bb-adhoc")'
```
- **Expected:** Auto-creates catalog `bb-adhoc`, installs `adhoc-skill` into all 3 platforms.

### G-8. `smith skill uninstall` removes from all platforms
```bash
smith skill uninstall adhoc-skill
ls ~/.config/opencode/skills/adhoc-skill/ 2>&1   # ENOENT
ls ~/.claude/skills/adhoc-skill/ 2>&1            # ENOENT
ls ~/.agents/skills/adhoc-skill/ 2>&1            # ENOENT
cat ~/.config/agent-smith/skill-catalogs.json | jq '.catalogs[] | select(.label=="bb-adhoc")'
```
- **Expected:** All 3 dirs gone. `installed-skills.json` entry removed. Auto-unregisters the `bb-adhoc` catalog (no skills remain).

### G-9. `smith skill unregister` refuses if skills still installed
```bash
smith skill unregister bb-test
```
- **Expected:** Exit 1 with message naming the still-installed `my-skill`. Then `smith skill uninstall my-skill && smith skill unregister bb-test` succeeds.

### G-10. `requires.skills` doctor section
```bash
# Scaffold an agent that requires a skill not currently installed:
smith agent init doctor-test \
  --description "Tests doctor agent-required-skills section" \
  --targets opencode --model-tier sonnet --mode primary \
  --permission read-only \
  --requires-skills nonexistent-skill
smith doctor
```
- **Expected:** Doctor's `agent-required-skills` section names `doctor-test` as having `nonexistent-skill` missing, with a `smith skill install nonexistent-skill` remediation. Informational only — exit code unaffected.

### G-11. Atlassian skills credential check via doctor
```bash
# When atlassian-skills catalog skills are installed:
smith doctor | grep -A 5 atlassian-auth
```
- **Expected:** The `atlassian-auth` section reports credential status (`configured` with source tier, or `missing` with remediation hint). When atlassian-skills is installed, also reports bridge status (whether `JIRA_*`/`CONFLUENCE_*` per-product env vars are available) and Python runtime availability.

### G-12. `smith skill catalogs`
```bash
smith skill catalogs
```
- **Expected:** Lists all registered skill catalogs. Shows at least `atlassian-skills` (default-registered, marked `protected`). Any user-registered catalogs also appear. Exit 0.

### G-13. `smith skill list --all` includes ad-hoc installs
```bash
smith skill install --from /tmp/bb-skills/my-skill --as adhoc-test   # ad-hoc install from Area G-7
smith skill list         # default: hides ad-hoc catalogs
smith skill list --all   # should include them
```
- **Expected:** Without `--all`, ad-hoc-installed skills are hidden (per `list.ts:17`). With `--all`, they appear. Verify the list grows.

### G-14. `smith skill update --all`
```bash
# Install 2+ skills from registered catalogs first (e.g. from Area G-3, G-7)
smith skill update --all
```
- **Expected:** Every installed skill is re-synced from source. Output enumerates each skill. No interactive prompts. Exit 0 unless a skill's source is missing or unreadable. Code ref: `install-cmd.ts:221-264`.

### Try to break it (Area G)

- G-X1. **Codex requirement enforcement:** create a SKILL.md *file* (not directory) and try `smith skill install --from <that-file>`. Codex requires SKILL.md to be in a directory; install should fail clearly before partial-installing to the other platforms.
- G-X2. **Path traversal:** create a skill with a `SKILL.md` containing relative paths like `../etc/passwd`. Install should refuse — `skill-installer.ts` was hardened against traversal.
- G-X3. **Symlink hostility:** in your skill source dir, add a symlink pointing outside the skill (e.g. `ln -s /etc/passwd inside-skill/leak`). Install should still succeed but the symlink is recorded as `<rel>:SYMLINK` in the hash, never followed. Confirm `installed-skills.json` shows the hash without leaking content.
- G-X4. **Install partial failure rollback:** chmod 000 one of the platform skill dirs (e.g. `chmod 000 ~/.config/opencode/skills`), then `smith skill install bb-test/my-skill`. Install should fail and roll back the others. Cleanup: `chmod 755 ~/.config/opencode/skills`.
- G-X5. **Concurrent install:** run two `smith skill install` calls in parallel for the same skill. What happens? File-system race documented as known footgun if not handled.
- G-X6. **JSON file corruption recovery:** `echo not-json > ~/.config/agent-smith/installed-skills.json && smith skill list`. Should fail with a friendly parse-error message, not a stack trace.
- G-X7. **Missing source dir:** `rm -rf /tmp/bb-skills/my-skill && smith skill list`. Should report `source-missing` for `my-skill`. Then `smith skill update my-skill` should fail informatively.
- G-X8. **Bundled-architect and keymaker drift:** edit `~/.config/opencode/skills/the-architect/SKILL.md` and `~/.config/opencode/skills/the-keymaker/SKILL.md`. Run `smith skill bootstrap`. The bootstrap warns before overwriting hand-edited the-architect and the-keymaker (per the `bootstrap()` bundled-skills install loop in `scripts/bootstrap.ts`). Confirm warning surfaces for both; confirm `--dry-run` skips the overwrite.

---

## Area H — Companion-agent runtime (`agent-smith` itself)

**Prereq:** `bash bin/install` ran cleanly (Step 9 succeeded), or `smith agent install agent-smith` ran cleanly. The `agent-smith` bundle is rendered into at least OpenCode.

This area exercises the companion agent's *runtime* — the synthetic self-source mechanism, the bundled knowledge dir, the cross-platform read-grants, and the `smith update` reinstall hook (Step 4 of the update pipeline — see [guide/12-error-handling.md → Update pipeline](../guide/12-error-handling.md#update-pipeline)). Distinct from Area F (which covers any installed agent's runtime); this area is specifically about `agent-smith` dogfooding its own pipeline.

### H-1. Synthetic self-source is discoverable

```bash
smith agent list
```
- **Expected:** Output includes a line like `agent-smith (agent-smith-self, registered) → opencode ✓, claude-code ✓, codex ✓`. The `(agent-smith-self, registered)` tag identifies the synthetic source from `resolveAllSources` (`src/io/registry.ts:296`). No `smith agent register` was needed for this entry. See [guide/08-registries-and-catalogs.md → The synthetic self-source](../guide/08-registries-and-catalogs.md#the-synthetic-self-source).

### H-2. `smith status` does NOT show the synthetic source

```bash
smith status
```
- **Expected:** The `Agent catalogs (N)` table shows only persisted sources (typically just `user-global`). The synthetic `agent-smith-self` source is *not* listed there — that asymmetry with `smith agent list` is documented and intentional.

### H-3. Bundled knowledge dir is materialized

```bash
ls -la ~/.config/agent-smith/knowledge/agent-smith/
cat ~/.config/agent-smith/knowledge/agent-smith/_manifest.json | head -40
ls ~/.config/agent-smith/knowledge/agent-smith/sources/agent-smith-guide/ 2>/dev/null | head
```
- **Expected:** A `knowledge/` directory exists. `_manifest.json` lists at least one source (id `agent-smith-guide`) pointing at the in-repo `guide/` directory (relative path `../../guide`). `sources/agent-smith-guide/` contains 7 materialized markdown files matching the curated `include` list in `agents/agent-smith/agent.config.json` (`02`, `04`, `06`, `11`, `12`, `13`, `14`). The per-source subdir name is the source's `id`, not the source's path. See [guide/13-paths-and-state.md#per-agent-knowledge-directories](../guide/13-paths-and-state.md#per-agent-knowledge-directories).

### H-3b. Install-time knowledge stanza for agent-smith (file-only, no inline-tokens clause)

```bash
smith agent install agent-smith 2>&1 | tail -5
```
- **Expected:** The output ends with a knowledge stanza for `agent-smith-guide`: typically `· knowledge agent-smith-guide (7 files, ~XKB, file) (unchanged)` on a repeat run, or `→ knowledge agent-smith-guide (7 files, ~XKB, file)` if `_manifest.json` was just regenerated. The tally line reads `N changed, M unchanged · 7 files, X.XKB` — **without** the trailing `· inline tokens U/B` clause, because agent-smith uses file-delivery only (`hasInline=false`). To verify the changed→unchanged transition: `rm ~/.config/agent-smith/knowledge/agent-smith/_manifest.json && smith agent install agent-smith 2>&1 | tail -3` should show `→ knowledge agent-smith-guide …` and `1 changed, 0 unchanged · …`; a subsequent re-run flips back to `· (unchanged)` and `0 changed, 1 unchanged`. See [guide/03-installing-and-rendering.md#knowledge-materialization-summary](../guide/03-installing-and-rendering.md#knowledge-materialization-summary).

### H-4. Cross-platform read-grants are injected

```bash
grep additionalDirectories  ~/.claude/agents/agent-smith.md
grep allowed_external_directories ~/.agents/skills/agent-smith/agent-smith.md 2>/dev/null \
  || grep allowed_external_directories ~/.agents/agent-smith.md
```
- **Expected:** Claude Code's frontmatter contains `additionalDirectories` listing the knowledge path. Codex's frontmatter contains `allowed_external_directories` listing the same path. OpenCode's frontmatter carries `permission.read.<dir>/**: allow` for the same path. All three point at `~/.config/agent-smith/knowledge/agent-smith/` — knowledge lives under agent-smith's state home regardless of target. See [guide/04-knowledge.md → Cross-platform read-grants](../guide/04-knowledge.md#cross-platform-read-grants).

### H-5. In-platform invocation answers from `guide/`

- Start an OpenCode session with `agent-smith`: `opencode --agent agent-smith` (or use the platform's UI to select it).
- Ask: "How does the smith update pipeline handle a failure in the bun install step?"
- **Expected:** Answer references `EXIT_PARTIAL` (3) and the half-applied state, drawn from `guide/12-error-handling.md`. Generic-LLM-knowledge answers (e.g. "smith is a build tool…") indicate the knowledge dir is not being read.

### H-6. `smith update` reinstall step refreshes knowledge

- Make a trivial edit to one of the `guide/` files that ships in the knowledge include list (e.g. add a UNIQUE marker line at the bottom of `guide/14-cli-reference.md`).
- Commit it locally so `git pull --ff-only` succeeds (or skip ahead and just stage it temporarily; the dirty-tree check will refuse — for a real test, push to a branch and `git pull` from that).
- Run `smith update`.
- **Expected:** Pipeline output includes `Refreshing agent-smith knowledge...` and the line `Dependencies up to date.` from Step 3 (`bun install`). After completion, `grep <UNIQUE_MARKER> ~/.config/agent-smith/knowledge/agent-smith/sources/agent-smith-guide/14-cli-reference.md` returns the marker. Knowledge dir picked up the guide change.

### H-7. Reinstall failure surfaces as `EXIT_PARTIAL`

```bash
chmod 000 ~/.config/opencode/agents/agent-smith
smith update    # or: smith agent install agent-smith
echo "exit: $?"
chmod 755 ~/.config/opencode/agents/agent-smith   # restore
```
- **Expected (via `smith update`):** Pipeline prints `agent-smith reinstall failed: <error>` followed by `(Other update steps succeeded. Re-run: smith agent install agent-smith)`. Doctor still runs. If doctor passes clean, exit code is `3` (`EXIT_PARTIAL`). If doctor fails, that exit code wins. See [guide/12-error-handling.md → Update pipeline](../guide/12-error-handling.md#update-pipeline) row "`smith agent install agent-smith` failure, doctor clean".

### Try to break it (Area H)

- H-X1. **Clone-into-config collision:** `git clone` agent-smith into `~/.config/agent-smith/agents/agent-smith` so the bundle exists at both the synthetic-source path AND a `user-global` path. Run `smith agent install agent-smith`. Expected: the `collision` check inside `resolveAllSources` (`src/io/registry.ts:304-307`) drops the synthetic source; bundle installed exactly once; no double-install warning needed.
- H-X2. **Validator-shape thresholds:** `smith agent validate agent-smith`. The bundle's IDENTITY/SOUL/USER files are deliberately shorter or longer than the heuristic length thresholds. Validator should warn (not error) on shape; install should still succeed. Capture the exact wording so the validator-threshold-override work (Item 2) can quote it.
- H-X3. **Knowledge dir removed by uninstall:** `smith agent uninstall agent-smith`, then `ls ~/.config/agent-smith/knowledge/agent-smith/`. Expected: directory is gone (uninstall now resolves the knowledge dir via `defaultKnowledgePaths()` and removes it, including the `.cache/` subtree — see [guide/13-paths-and-state.md#per-agent-knowledge-directories](../guide/13-paths-and-state.md#per-agent-knowledge-directories) and `CHANGELOG.md`). `smith agent install agent-smith` rebuilds the dir cleanly from the bundle's `knowledge.sources[]`.
- H-X4. **Stale knowledge after manual `git checkout`:** in `~/.agent-smith/`, `git checkout HEAD~5 -- guide/`. Run `smith agent install agent-smith`. Expected: knowledge dir reflects the 5-commits-back content. Confirms re-install always rebuilds from the current `guide/` snapshot.
- H-X5. **Bundle-not-found refusal:** `mv ~/.agent-smith/agents/agent-smith ~/.agent-smith/agents/agent-smith.bak`, then `smith agent install agent-smith`. Expected: clear error pointing at the missing bundle (not a generic `not-found` stack trace). Restore: `mv` back.

---

## Wrap-up (last 15 min)

1. **Submit any in-flight reports** before time's up. Half-finished issues are worse than no issues.
2. **Self-check coverage:** did you complete all numbered scenarios in your area? If you skipped any, note why in the bug-bash channel.
3. **Restore your environment:**
   ```bash
   smith jack-out --yes 2>/dev/null   # if you're done with smith entirely
   # OR restore your snapshot:
   rm -rf ~/.config/agent-smith ~/.config/opencode/{agent,agents,skills}
   cp -R ~/bug-bash-backup/agent-smith.bak     ~/.config/agent-smith     2>/dev/null
   cp -R ~/bug-bash-backup/opencode-agent.bak  ~/.config/opencode/agent  2>/dev/null
   cp -R ~/bug-bash-backup/opencode-agents.bak ~/.config/opencode/agents 2>/dev/null
   cp -R ~/bug-bash-backup/opencode-skills.bak ~/.config/opencode/skills 2>/dev/null
   ```
4. **Join the live triage** — facilitator pulls all `[bug-bash]` issues, walks through severity/dedup, votes top-3 must-fix-before-release.

---

## Facilitator checklist (delete this section before sharing the doc with testers if you want a clean copy)

Before:
- [ ] Pin the issue template URL in the bug-bash channel.
- [ ] Assign each tester an area (or two areas if fewer than 6 testers; B+D combine well, A+E combine well).
- [ ] Confirm everyone completed the **Before you start** block.

During:
- [ ] Stay available for "is this expected behavior?" questions.
- [ ] Watch the issue stream; tag obvious dupes early.

After:
- [ ] Run live triage: project board column for S1/S2 (must-fix), S3 (next sprint), S4 (backlog).
- [ ] Schedule retro within 48 hr while memory is fresh.
- [ ] Capture process feedback into `QA/bug-bash.md` itself for the next round.
