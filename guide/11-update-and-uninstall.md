# Update and uninstall

> Updating agent-smith itself, removing rendered agent files, and fully offboarding. This spoke covers the five commands that mutate (or remove) state outside any one bundle: `smith update`, `smith agent uninstall`, `smith agent uninstall-all`, `smith agent destroy`, and `smith jack-out`. All five are destructive in some way — `update` rewrites your source checkout and dependencies, the four removal commands delete files. Read carefully.

If you only want to know which command to run, the short answer:

- **Update agent-smith from a source checkout** → `smith update`.
- **Remove one rendered agent** (keep the source bundle) → `smith agent uninstall <name>`.
- **Remove every rendered agent** (keep the source bundles) → `smith agent uninstall-all`.
- **Remove one source bundle** (the inverse of `smith agent init`) → `smith agent destroy <name>`.
- **Nuke the whole agent-smith install** (configs, bundles, everything) → `smith jack-out`.

The terse reference for each command (synopsis, every flag, every exit code) lives in [14-cli-reference.md](./14-cli-reference.md). This spoke is the narrative — what each command actually does, what it leaves behind, and how the exit codes propagate.

> **Tip — browser GUI.** Two of these commands have dedicated GUI surfaces: `/system/update` previews commits behind `origin/main` and runs `smith update` with streamed progress; `/system/jack-out` walks the destructive uninstall with a dry-run preview, typed-phrase confirm (`jack-out`), MatrixRain runtime stage, and a disconnect-as-success state machine (the GUI server dies mid-uninstall — disconnect after stdout means the work ran). See [README → Browser GUI](../README.md#browser-gui-smith-gui).

## Mental model

Three of the five commands (`agent uninstall`, `agent uninstall-all`, `jack-out`) operate on the rendered/installed copies. `agent destroy` operates partially on the source (removes the user-global bundle dir) and partially on the rendered copies. `smith update` operates on the source clone (`git pull`).

```
                                ┌─ smith agent uninstall <name>      → remove rendered files for one bundle
source bundles                  │
~/.config/agent-smith/  ────►   ├─ smith agent uninstall-all         → remove rendered files for every bundle
        +                       │
registered catalogs             ├─ smith agent destroy <name>  → remove ONE source bundle (user-global only)
                                │
                                ├─ smith jack-out              → remove rendered files + ~/.config/agent-smith/
                                │
                                └─ smith update                → git pull + bun install + smith doctor
```

`smith agent destroy` is the only single-bundle command that touches the source side of the diagram — it's the inverse of `smith agent init`. `smith agent uninstall` only removes the rendered output; the source bundle survives and a follow-up `smith agent install <name>` rebuilds the rendered files. `smith agent destroy` removes the source itself, so it cannot be undone with `smith agent install`.

`smith update` is different in kind — it doesn't touch installed agent files at all. It updates the agent-smith source workspace at `~/.agent-smith/` (the git clone the installer created), reinstalls dependencies, then runs doctor to verify the result. See `src/cli/commands/update.ts` for the pipeline.

## `smith update`

Updates the agent-smith source clone in place. Specific to the from-source install (`bash bin/install`); equivalent to re-running `bash ~/.agent-smith/bin/install` in update mode, but invokable from anywhere on PATH. If you installed via `npm install -g agent-smith`, use `npm update -g agent-smith` instead — `smith update` exits `1` with a hint when no source workspace is found.

What it does:

1. Resolves the workspace path from the running source's location (i.e. wherever `~/.local/bin/smith` resolves to). With the single-mode install, this is always `~/.agent-smith/`.
2. Refuses if the workspace has uncommitted changes (`git status` shows porcelain output).
3. `git pull --ff-only origin main`. Refuses on non-fast-forward (e.g. you've made local commits that haven't been pushed).
4. `bun install` to sync any updated dependencies. The bundled-skill bootstrap postinstall hook fires and installs any new bundled skills.
5. Rewrite `~/.local/bin/smith` launcher (`writeLauncher` in `src/io/launcher.ts`). Older installs whose launcher was a symlink to `src/index.ts` get refreshed to the bun-path-hardcoded wrapper so future updates run consistently. Warn-and-continue on failure.
6. Rebuilds the GUI SPA bundle (`bun run gui:build`). Warn-and-continue on failure — the CLI still works and the user can retry `bun run gui:build` manually.
7. Re-installs the agent-smith bundle in-process (`smith agent install agent-smith`) to refresh its knowledge directory. The bundle declares the curated guide files as a `dir` knowledge source pointing at `../../guide`, so re-installing picks up any guide updates that shipped in the same pull and re-materializes them under `~/.config/agent-smith/knowledge/agent-smith/sources/agent-smith-guide/`. If this step fails (rare — would mean the bundle's config or the guide files themselves are broken), `smith update` records the failure and continues to doctor; doctor's exit code wins, and only if doctor returns 0 does the reinstall failure surface as `EXIT_PARTIAL` (3) with `Re-run: smith agent install agent-smith`.
8. Runs `smith doctor` to verify the install is healthy. Doctor's exit code is propagated, so any drift, schema mismatch, or auth issue surfaces immediately.

Flags:
- `--dry-run`: prints what would happen (`git fetch` + commit count) without mutating anything.

Exit codes:
- 0: success, doctor clean.
- 1: refusal (dirty tree, non-fast-forward, corrupt install) — also propagated from doctor when doctor reports drift.
- 2: doctor reported a transient/network error fetching schemas, **or** doctor refused to run because no platform CLI (`opencode`/`claude`/`codex`/`kiro`) was detected on `PATH`; the pull + install succeeded. The `--json` envelope distinguishes the two cases — refusal emits `{"error":"no-platform-detected"}`. See [Doctor](./10-doctor.md#refusal-no-supported-platform-detected) for the refusal contract.
- 3: partial failure — `git pull`, `git fetch`, or `bun install` failed before doctor ran; or the launcher refresh failed; or the GUI build failed; or the post-pull `smith agent install agent-smith` reinstall failed (knowledge dir refresh) and doctor returned 0. See `src/cli/exit-codes.ts` for the canonical taxonomy.

Recovery from doctor schema drift: `smith update` is the recovery path. Re-run after a `bun run refresh-schemas` upstream lands.

## `smith agent uninstall <name>`

Removes the rendered/installed copies of one agent from every target it declares. The source bundle in `~/.config/agent-smith/agents/<name>/` (or wherever it lives in its catalog) stays put — `smith agent install <name>` will rebuild and rewrite the rendered files.

```bash
smith agent uninstall my-agent              # remove from every target
smith agent uninstall my-agent --dry-run    # show what would be removed
```

No confirmation prompt. Single-agent scope is small and the command is the symmetric inverse of `smith agent install <name>`.

### Per-target removal scope

`smith agent uninstall` walks `bundle.config.targets` and computes the install path for each. The path computation mirrors what the installer wrote — `~/.config/opencode/agents/<name>.md`, `~/.claude/agents/<name>.md`, `~/.agents/skills/<name>/SKILL.md` for Codex, or `~/.kiro/agents/<name>.json` for Kiro (`src/io/uninstaller.ts`).

The implication: **if a bundle's `targets` list excluded a platform, that platform's file was never written and won't appear in the removal plan.** A bundle with `"targets": ["opencode"]` produces only the OpenCode `.md` to remove; Claude Code, Codex, and Kiro paths are not even checked. This matches install symmetry — you can't uninstall what was never installed. See [03-installing-and-rendering.md#per-platform-output](./03-installing-and-rendering.md#per-platform-output) for the install-side path table.

If you previously installed an agent on four platforms, then edited its `agent.config.json` to drop a target before uninstalling, the file on the dropped platform will be left behind. Re-add the target to the config first, then uninstall — or remove the orphaned file by hand.

### Manifest-aware refusal and `--force`

The uninstaller consults `~/.config/agent-smith/installed-agents.json` before deleting any rendered file. If the on-disk file's hash differs from what the manifest recorded, the uninstaller **refuses** that path and reports it under a `refused[]` field in the result — the assumption is that the file has been edited or replaced by a tool other than smith, and silently deleting it would be data loss. The refusal lists the agent, target, path, and the `--force` flag.

`--force` bypasses the refusal: smith will delete the file regardless of hash. Use it when you've intentionally diverged the rendered file (e.g. hand-edited frontmatter for testing) and want to clean up anyway.

```bash
smith agent uninstall my-agent --force            # delete even if hash mismatch
smith agent uninstall-all --force --yes           # bulk version, fully non-interactive
smith agent destroy my-agent --force              # also chains the uninstall
```

The same flag exists on `agent uninstall-all` and `agent destroy`. Install also accepts `--force` — there it bypasses would-clobber refusal (smith will overwrite a file it doesn't own in the manifest).

### What gets removed

Per target file in the bundle's declared `targets`. That's it. Specifically the uninstaller:

- Removes `<install-path>/<name>.md` (or `<install-path>/<name>/SKILL.md` for Codex).
- Categorises each path as `removed`, `notFound` (ENOENT), or `errors` (any other failure). Source: `src/io/uninstaller.ts`.
- Tears down any per-platform refresh integration the agent opted into at install time: removes the agent's entry in `~/.codex/hooks.json` (deleting the file when the last entry goes) and unregisters the agent from the shared `~/.config/opencode/plugins/agent-smith-refresh/.smith-managed` sentinel (deleting the plugin dir and the `opencode.json` `plugin` entry when the last consenting agent goes). Claude Code refresh hooks live inside the agent file that was just deleted, so no extra cleanup is needed. Driven by `~/.config/agent-smith/agents/<name>/refresh-manifest.json`, which is removed last. See [13-paths-and-state.md § Per-platform refresh integrations](./13-paths-and-state.md#per-platform-refresh-integrations).

### What does NOT get removed

The uninstaller is narrow on purpose. It does **not** touch:

- **The source bundle.** `~/.config/agent-smith/agents/<name>/` (and its `IDENTITY.md`, `EXPERTISE.md`, `SOUL.md`, `USER.md` (symlink or stub), `agent.config.json`) is left intact. The bundle stays registered. Run `smith agent unregister <path>` separately if you want to remove the source.
- **Per-agent knowledge directories.** `~/.config/agent-smith/knowledge/<name>/` (where materialized knowledge for the agent landed) **is** removed by `smith agent uninstall`, including the `.cache/` subtree. (This was a gap fixed shortly after v0.12.0 — see `CHANGELOG.md` under the relevant release for the migration note.)
- **The Codex per-agent subdirectory wrapper.** `smith agent uninstall` removes `~/.agents/skills/<name>/SKILL.md` but **not** the enclosing `~/.agents/skills/<name>/` directory. After uninstall the directory is left empty. The same is true of any companion files Codex would have read alongside the `SKILL.md`. Source: `src/io/uninstaller.ts` (only `SKILL.md` is in the path; `rm` is `node:fs/promises rm` without `recursive: true`).
- **Required skills.** Skills the agent declared in `requires.skills` and that smith installed during `smith agent install` stay installed. They may be required by other agents; uninstall has no view of cross-agent dependencies. Use `smith skill uninstall <name>` to remove a skill explicitly.
- **MCP server configurations.** `mcpServers` is documentation-only at install time and produces no state to remove. See [06-permissions-and-platforms.md](./06-permissions-and-platforms.md).
- **Registry entries, `installed-skills.json` records, daemon state, USER.md, the schema cache, anything else under `~/.config/agent-smith/`.**

If you want to remove all of it, use `smith jack-out`.

### Output ordering

The output is grouped: first every `removed` line, then every `not found` line, then every `failed` line. Source: `src/cli/commands/uninstall.ts`. The grouping is intentional — easier to scan than per-target interleaving.

```
✓ removed: ~/.config/opencode/agents/my-agent.md
✓ removed: ~/.claude/agents/my-agent.md
- not found: ~/.agents/skills/my-agent/SKILL.md
```

`not found` is **not** an error. The post-condition for uninstall is "this path does not exist", and a missing file already satisfies that.

### Exit codes

| Code | Cause |
|---|---|
| `0` | Every target file removed (or absent) — including dry-run. |
| `1` | Agent not found in any registered catalog. |
| `3` | Partial failure: at least one path could not be removed (permission denied, file is a directory, etc.). |

See [12-error-handling.md](./12-error-handling.md#exit-code-taxonomy) for the canonical taxonomy.

## `smith agent uninstall-all`

Bulk-removes the rendered files for every registered agent across every target. Symmetric inverse of `smith agent install-all`.

```bash
smith agent uninstall-all              # prompts for confirmation
smith agent uninstall-all --dry-run    # show the full plan, no changes
smith agent uninstall-all --yes        # skip the confirmation prompt
```

### Behavior

The command:

1. Loads the agent registry and enumerates every bundle in every catalog. If the registry is empty, prints `No agents registered.` and exits `0` (not an error). Source: `src/cli/commands/uninstall-all.ts`.
2. Computes the full removal plan via `planUninstallPaths()` and prints it: `Will remove N agents across M files:` followed by every path. Source: `src/cli/commands/uninstall-all.ts`.
3. Unless `--yes` is set, prompts `Continue? [y/N] `. Anything other than `y` or `yes` (case-insensitive) aborts with `Aborted.` and exits `1`. Source: `src/cli/commands/uninstall-all.ts`.
4. Removes each file. Output groups (`removed` / `not found` / `failed`) follow the same ordering as single-agent uninstall.
5. Prints `Removed N files. Source bundles remain registered.`

### `--yes`: skip confirmation, NOT auto-install

`--yes` on `agent uninstall-all` skips the `Continue? [y/N]` prompt. That's its only effect. **It does not behave like `--yes` on `smith agent install`.** On the install side, `--yes` means "auto-install required skills without prompting" — there is no destructive-confirmation prompt to suppress because install is non-destructive. On the uninstall side, there are no required skills to install (you're removing things) and the prompt is the destructive-confirmation prompt.

This is the dual meaning of `--yes` documented in [03-installing-and-rendering.md#smith-agent-install-name](./03-installing-and-rendering.md#smith-agent-install-name). The flag name is the same; the semantic is platform-specific. Cross-link this section if you find yourself confused by a script that uses `--yes` on both sides of the install/uninstall pair — they're doing different things.

### What gets removed

Same per-bundle scope as `smith agent uninstall` (just multiplied across every bundle): the rendered file at every declared target for every registered bundle. Same `not found` semantics.

### What does NOT get removed

Same exclusions as `smith agent uninstall`. Notably:

- **Source bundles remain registered.** The trailing message `Source bundles remain registered.` exists to make this explicit. The next `smith agent install-all` will rebuild every rendered file. Source: `src/cli/commands/uninstall-all.ts`.
- **All other smith state.** Registry, skill catalogs, installed-skills records, daemon state, USER.md, schema cache — untouched. (Per-agent knowledge dirs at `~/.config/agent-smith/knowledge/<name>/` **are** removed, in line with single-bundle `smith agent uninstall`.)

### Exit codes

| Code | Cause |
|---|---|
| `0` | Every file removed (or registry empty, or `--dry-run` succeeded). |
| `1` | User declined the confirmation prompt. |
| `3` | Partial failure: at least one path could not be removed. |

## `smith agent destroy <name>`

The inverse of `smith agent init`. Permanently removes the source bundle directory at `~/.config/agent-smith/agents/<name>/`. This is the missing single-bundle counterpart to `smith jack-out` (which removes everything) — when you only want to retire one agent and reclaim the directory, `agent destroy` is the right command. `smith agent uninstall` is *not* this command — it only removes the rendered output, leaving the source intact.

```bash
smith agent destroy my-debugger              # typed-token confirmation
smith agent destroy my-debugger --dry-run    # show plan, no changes
smith agent destroy my-debugger --yes        # skip the prompt
smith agent destroy my-debugger --force      # chain `agent uninstall` first if rendered files remain
```

### Behavior

The command:

1. Resolves the bundle name against the registry. If no bundle matches, exits `2` (`usage-error`) with `Try: smith agent list` to surface available names.
2. **Verifies catalog ownership.** Only bundles inside the `user-global` catalog rooted at `~/.config/agent-smith/agents/` may be destroyed. A bundle living in a registered, project, or git-backed catalog is refused with a `usage-error` pointing at `smith agent unregister` — the source-of-truth for those bundles lives elsewhere (often a shared git repo) and `agent destroy` is not the right tool to mutate it. Source: `src/cli/commands/destroy-agent.ts`.
3. **Checks for rendered installs.** If any platform target still has a rendered file on disk (`~/.config/opencode/agents/<name>.md`, `~/.claude/agents/<name>.md`, `~/.agents/skills/<name>/SKILL.md`, or `~/.kiro/agents/<name>.json`), the command refuses with a `usage-error` and a `Try: smith agent uninstall <name>` suggestion — unless `--force` was passed, in which case the uninstall is chained automatically before removing the source.
4. Prints the plan: per-target install table (matching `jack-out`'s output style — `●`/`✗`/`⚠` symbols, `~`-relative paths via `tildify()`, action column showing `→ would be uninstalled` / `→ no action`) followed by the `Source files:` block.
5. If `--dry-run`, prints `DRY RUN — no changes made.` and exits `0`.
6. Unless `--yes` is set, prompts `Type '<name>' to confirm: ` and reads a line. The token is the agent's own name (not the literal string `destroy <name>`). Anything else aborts with `Aborted. No changes made.` and exits `1`.
7. With `--force`, removes every rendered platform file first (delegating to the same uninstaller `smith agent uninstall` uses).
8. Removes `~/.config/agent-smith/agents/<name>/` recursively. ENOENT during removal is treated as success.

### Output sample (clean state, dry run)

```
$ smith agent destroy my-debugger --dry-run
Agent: my-debugger
  Located at: ~/.config/agent-smith/agents/my-debugger
  Installed in:
    ✗ opencode     not installed  → no action
    ✗ claude-code  not installed  → no action
    ✗ codex        not installed  → no action
    ✗ kiro         not installed  → no action
  Source files:
    ⚠ would be permanently removed
DRY RUN — no changes made.
```

The `Located at:` and the per-target paths use `~`-relative form so the output is readable without a wide terminal. When rendered files exist, the corresponding row shows `● installed   → would be uninstalled` (with `--force`) or `● installed   → no action (use --force)` (without).

### Why typed-token confirmation

The token is the agent's own name (`my-debugger`), not the literal string `agent destroy` and not `y`. The reasoning mirrors `jack-out`: this is a destructive, irreversible single-bundle operation (`smith agent install` cannot put a destroyed bundle back — only the original `agent init` flags or a backup can). Forcing the operator to retype the bundle name catches the most common mistake — running the command against the wrong bundle from a shell history.

### `--force` semantics

Without `--force`, `agent destroy` refuses to operate on a bundle whose rendered files still exist on any platform. The reasoning: deleting the source while leaving orphaned platform files behind produces stale agents that the model will still invoke, but which can no longer be re-rendered, audited, or uninstalled by name. The two valid recovery paths are (a) run `smith agent uninstall <name>` first then `smith agent destroy <name>`, or (b) use `--force` to do both in one step.

`--force` does **not** suppress the typed-token confirmation. Pair it with `--yes` for fully non-interactive use:

```bash
smith agent destroy my-debugger --force --yes
```

### Catalog ownership refusal

`agent destroy` only operates on bundles inside `~/.config/agent-smith/agents/`. A bundle whose `rootPath` resolves to a different catalog raises `usage-error` immediately:

```
$ smith agent destroy shared-reviewer
✗ smith agent destroy: bundle 'shared-reviewer' is in catalog 'team-agents' (not user-global). Refusing to remove.

  Try: smith agent unregister team-agents
```

This restriction exists because the source of truth for non-`user-global` bundles is somewhere other than `~/.config/agent-smith/` — typically a shared git repository registered via `smith agent register --kind registered`. Removing a single bundle from that working copy would either be silently overwritten by the next daemon pull, or it would mutate the shared repo in a way the operator probably didn't intend. The right tool for "stop using this team catalog" is `smith agent unregister <label>`, which removes the *registration* without touching the catalog directory.

### What gets removed

- The directory `~/.config/agent-smith/agents/<name>/` and everything inside it: `IDENTITY.md`, `EXPERTISE.md`, `SOUL.md`, `agent.config.json`, the `USER.md` symlink, any `knowledge.json` sidecar, and any local edits you made.
- With `--force`: every rendered platform file (same scope as `smith agent uninstall`).

### What does NOT get removed

- **Rendered files (without `--force`).** The command refuses rather than orphans them.
- **The `USER.md` target.** `~/.config/agent-smith/USER.md` is shared across all bundles; only the per-bundle symlink inside the destroyed directory goes away.
- **Per-agent knowledge directories.** Same as `smith agent uninstall` — `~/.config/agent-smith/knowledge/<name>/` is removed.
- **Required skills.** Skills the bundle declared in `requires.skills` are not removed. They may be required by other agents.
- **Registry entries for other catalogs.** `agent destroy` only mutates the `user-global` catalog directory; `registry.json` itself is not modified (the `user-global` source remains registered, just empty of this bundle).

### Exit codes

| Code | Cause |
|---|---|
| `0` | Source bundle removed (or `--dry-run` succeeded). |
| `1` | Confirmation token mismatch (typed something other than the agent name). |
| `2` | Agent not found; bundle is in a non-`user-global` catalog; rendered files exist and `--force` was not passed. |

Note `agent destroy` does not emit `3` — there's no partial-failure mode because the rendered-file uninstall (when `--force` is set) runs to completion before the source removal is attempted, and any uninstall failures abort the source removal.

## `smith jack-out`

Fully uninstalls agent-smith. Single command — no "after this command finishes, run..." coda.

What it removes:

1. All installed agent files (whatever's in your registry) and all skills `agent-smith` ever installed (per `installed-skills.json`).
2. `~/.config/agent-smith/` (the entire config directory).
3. Daemon runtime files and GUI job history under `~/.local/state/agent-smith/`:
   - `daemon.pid`, `daemon.log`, `daemon.heartbeat.json`
   - `gui-jobs.jsonl`, `gui-jobs-output/`
   
   The `remote/` subdirectory of the runtime state root is **not** removed — those are remote-backed catalog clones managed individually via `smith {agent,skill} unregister <label> --purge-clone`.
4. `~/.local/bin/smith` (the CLI symlink).
5. The agent-smith marker block from your shell rc file (`~/.zshrc`, `~/.bash_profile`, or `~/.bashrc`). The block is bounded by:
   ```
   # >>> agent-smith installer >>>
   ...
   # <<< agent-smith installer <<<
   ```
   Any content between those markers is removed regardless of whether you edited it; if you want to keep custom PATH additions, put them outside the marker block.
6. `~/.agent-smith/` (the source clone — last, so the binary keeps working through the earlier steps).

Confirmation: `jack-out` requires the user to type the literal token `jack-out` at the prompt. Anything else (including `y`, `yes`, `JACK-OUT`, etc.) aborts cleanly with no changes.

Flags:
- `--dry-run`: prints the plan but removes nothing. Useful for previewing.
- `--yes`: skips the typed-token confirmation. **Use with care** — there is no undo.

Exit codes:
- 0: clean uninstall.
- 1: aborted at the confirmation prompt.
- 3: completed with one or more partial failures (a file or directory could not be removed; the rest of the uninstall continued).

Idempotency: each removal is no-op-on-missing. Re-running `jack-out` on a partially-uninstalled system completes the cleanup.

## When to use which

| Situation | Command |
|---|---|
| New version of agent-smith landed in `origin/main` | `smith update` |
| Want to know whether an update is pending | `smith update --dry-run` |
| Removing one rendered agent (keep the source so you can `smith agent install` later) | `smith agent uninstall <name>` |
| Removing one agent including its source bundle (the inverse of `smith agent init`) | `smith agent destroy <name> --force` |
| Removing a bundle from a shared catalog | `smith agent unregister <label>` (don't use `agent destroy` — it refuses) |
| Cleaning up rendered files across all platforms (keeping source bundles for re-install) | `smith agent uninstall-all` |
| Resetting before a fresh `smith skill bootstrap` / `smith agent install-all` cycle | `smith agent uninstall-all --yes` |
| Fully removing agent-smith from this machine | `smith jack-out` (single command — removes agents, config, symlink, rc-file block, and source clone) |
| Scripting any of the above in CI | always pass `--yes`; check the per-command exit codes above |

## Scripting and CI

All four commands are CI-friendly when invoked correctly:

```bash
# Non-interactive bulk uninstall
smith agent uninstall-all --yes
echo "exit=$?"

# Non-interactive single-bundle teardown (source + rendered)
smith agent destroy my-experimental-agent --force --yes
echo "exit=$?"

# Non-interactive nuke (CI cleanup between test runs)
smith jack-out --yes
echo "exit=$?"

# Update in a CI workspace; treat doctor network errors / refusal as soft failures
smith update
case $? in
  0) echo "clean" ;;
  1) echo "dirty workspace, non-fast-forward, or doctor drift"; exit 1 ;;
  2) echo "doctor saw network error OR refused (no platform CLI on PATH); update itself succeeded"; exit 0 ;;
  3) echo "pipeline aborted (git/bun install) or knowledge reinstall failed"; exit 1 ;;
esac
```

Two common CI mistakes:

- **Forgetting `--yes` on `agent uninstall-all`, `agent destroy`, or `jack-out`.** All three block on the prompt and CI hangs until the runner times out. The prompt reader uses `readToken()` which reads from stdin; closed stdin on a non-TTY may produce an empty string (which counts as "not `y`/`yes`" and as "not `jack-out`") — both abort with exit `1`. Either way, always pass `--yes`.
- **Treating `update`'s `2` as a usage error.** It isn't. It's either doctor's network error or doctor's no-platform refusal (no `opencode`/`claude`/`codex`/`kiro` on `PATH`). If your CI doesn't have outbound access to the OpenCode model API, also pass `--offline` to a manual `smith doctor` step instead of running `smith update`. If your CI image has no platform CLI installed and you only want the source pull, skip `smith update` and run `git pull` + `bun install` directly.

## Caveats and gotchas

- **`smith agent uninstall` removes per-agent knowledge directories.** `~/.config/agent-smith/knowledge/<name>/` (including the `.cache/` subtree) is wiped alongside the rendered platform files. (This was a gap fixed shortly after v0.12.0; pre-fix, knowledge persisted on disk and accumulated as stale state.)
- **`smith agent uninstall` does not remove the Codex per-agent directory wrapper.** Only the `SKILL.md` inside it. The empty parent directory is left behind.
- **`agent uninstall-all` returns exit `1` on user-declined confirmation, not `2`.** Declining a prompt is treated as a runtime outcome, not a usage error. Source: `src/cli/commands/uninstall-all.ts`.
- **`jack-out` prints the symlink-cleanup instructions twice on success: once before the prompt and once after the removal.** This is intentional — the second print is the one you act on, but the first lets you copy the commands before confirming.
- **`update`'s exit codes don't fit cleanly into the global CLI taxonomy.** The pipeline composes `git`, `bun install`, and `doctor` exits, and doctor's `2` (network error) collides with the global meaning of `2` (usage error). When scripting around `smith update`'s exit code, treat `2` specifically as "doctor saw a network error" rather than applying the global definition. See [10-doctor.md](./10-doctor.md#internal-exit-codes-the-trap).
- **`update` exits `3` (partial failure) when `git pull`, `git fetch`, or `bun install` fail, or when the GUI build fails, or when the post-pull `smith agent install agent-smith` refresh fails and doctor returns 0.** This is a recent migration from earlier `2`/`1` behavior — the pipeline is sequential, so a step failing mid-way leaves the system in a half-applied state, which fits the partial-failure category. See [12-error-handling.md](./12-error-handling.md#update-pipeline) and [14-cli-reference.md](./14-cli-reference.md#smith-update) for the migration note.
- **Dry-run does not require any state to be writable.** `smith agent uninstall --dry-run`, `smith agent uninstall-all --dry-run`, and `smith jack-out --dry-run` all print plans without touching disk. Use them freely to preview.
- **`smith jack-out` does not remove your `~/.cache/agent-smith/` schema cache.** Small, but worth knowing if you're trying to reproduce a fresh-install bug.

## See also

- [03-installing-and-rendering.md](./03-installing-and-rendering.md) — the install side of the install/uninstall symmetry; canonical home for the dual meaning of `--yes`.
- [10-doctor.md](./10-doctor.md) — doctor's internal exit codes, propagated verbatim by `smith update`.
- [12-error-handling.md](./12-error-handling.md) — canonical exit-code taxonomy and per-command matrix.
- [13-paths-and-state.md](./13-paths-and-state.md) — full inventory of every file smith touches; useful when deciding what jack-out does and doesn't reach.
- [14-cli-reference.md](./14-cli-reference.md) — terse synopsis/flags/exit-codes for `update`, `agent uninstall`, `agent uninstall-all`, `agent destroy`, `jack-out`.
