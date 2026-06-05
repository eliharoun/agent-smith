# Error handling

> Canonical home for the agent-smith error model: the `SmithError` payload union, the four-tier exit-code taxonomy, the per-command exit-code matrix, and the `smith update` pipeline-exit-code map. Read this when you're scripting around `$?`, when you've seen a strange error message, or when you're adding a new command and need to know what code to return.

This spoke is a reference. For *narrative* coverage of any specific command see the spoke that owns it; for the terse synopsis/flags-table form see [14-cli-reference.md](./14-cli-reference.md).

## Mental model

Every command in `smith` runs through the [`wrap()`](#how-wrap-renders-errors) shim in `src/cli/wrap.ts`. The shim calls the command, takes the number it returns, and exits with that number. If the command throws, the shim renders a structured error message to stderr and exits with a code derived from the throw:

- A `SmithError` instance — rendered through `formatSmithError()` (`src/cli/wrap.ts`) and exited via `exitCodeFor(payload.code)` (`src/cli/exit-codes.ts`).
- Anything else (raw `Error`, plain string, undefined) — rendered through `formatUnknownError()` and exited with `EXIT_RUNTIME` (1).

The render path is the same in both directions: the user sees `✗ smith <subcommand>: <headline>`, then optional indented body, then optional indented `Try:` remediation. The exit code is the contract for shells and CI.

The four-tier taxonomy is enforced by named constants in `src/cli/exit-codes.ts`. New commands MUST return through this funnel — direct `process.exit()` calls bypass the renderer and are catalogued as a known limitation below.

## Exit code taxonomy

The taxonomy below is the canonical contract. Every smith command returns one of these four codes. Spokes 11 and 14 link this section as `#exit-code-taxonomy`.

| Code | Constant | Meaning |
|---|---|---|
| `0` | `EXIT_OK` | Success. Operation completed; postconditions hold. For partial-success-tolerant commands (e.g. `agent install-all` with all-bundles-succeeded), this is the all-clean outcome. |
| `1` | `EXIT_RUNTIME` | Runtime failure. The command could not complete its core operation: bad state, missing precondition, OS-level failure, declined confirmation prompt. The default for any unclassified throw. |
| `2` | `EXIT_USAGE` | Bad invocation. Missing or invalid flags, unknown command, malformed arguments. Also: any `validation-failed` SmithError (the user gave smith a bundle/skill/path that fails its own validation). |
| `3` | `EXIT_PARTIAL` | Succeeded with some failures. A bulk operation (e.g. `agent install-all`, `agent uninstall-all`, `update`) where some sub-operations succeeded and others failed. |

### What "partial" means

`EXIT_PARTIAL` is not "the command failed". It's "the command ran every step it intended to run, and a strict subset of those steps failed". The user's recovery is to inspect the `details` block in the error output and re-run the failed sub-operations individually.

For sequential pipelines like `smith update`, `EXIT_PARTIAL` is also used when an early step failed and aborted the rest of the pipeline mid-way — the system is in a half-applied state. It is also used when only the optional `smith agent install agent-smith` step (Step 4 of the pipeline) failed and doctor passed clean — partial-success-after-success. Source: `src/cli/commands/update.ts`. See [Update pipeline](#update-pipeline).

### The `exitCodeFor` mapping

`src/cli/exit-codes.ts` maps every `SmithError` payload code to one of the four exit codes:

```text
usage-error         → 2  (EXIT_USAGE)
validation-failed   → 2  (EXIT_USAGE)
already-exists      → 2  (EXIT_USAGE)
config-missing      → 2  (EXIT_USAGE)
partial-failure     → 3  (EXIT_PARTIAL)
<everything else>   → 1  (EXIT_RUNTIME)
```

The "everything else" bucket — catalog file problems (`registry-version`, `registry-corrupt-json`, `skill-registry-version`, `skill-registry-corrupt-json`), state file corruption (`installed-skills-corrupt`), system-level (`permission-denied`), state preconditions (`not-found`, `protected-catalog`), model resolution (`model-resolution-failed`), network/HTTP errors — all map to `EXIT_RUNTIME`. The reasoning: these are all "operation could not complete" outcomes, distinguishable from each other by the rendered headline but not by the shell-level exit code.

### Subsystem exit codes that don't fit the taxonomy

Two subsystems use exit codes that look like the global taxonomy but mean something different:

1. **Doctor** uses `0/1/2` to mean `clean/drift/network-error-or-refusal` (`src/core/freshness/run-doctor.ts`, `src/cli/commands/doctor.ts`). Doctor's `2` covers two distinct causes: a network failure fetching the OpenCode schema, **and** the no-platform refusal that fires when none of `opencode`/`claude`/`codex`/`kiro` is on `PATH`. The `--json` envelope distinguishes them — refusal emits `{"error":"no-platform-detected"}`. Neither is a usage error. Also: when OpenCode is absent the drift and network-error code paths are unreachable, so `1` cannot fire and the only route to `2` is the refusal. See [10-doctor.md#internal-exit-codes-the-trap](./10-doctor.md#internal-exit-codes-the-trap).
2. **`smith update`** propagates doctor's exit code verbatim as the final pipeline step (`src/cli/commands/update.ts`). So when `update` exits `2` post-pull, it means doctor saw a network error, not that you passed bad flags to `update`. See [Update pipeline](#update-pipeline) below for the full mapping.

This is a deliberate trade-off: doctor's exit-code semantics pre-date the unified CLI taxonomy, and changing them would silently break every CI script that already keys on `smith doctor`'s `$?`. The asymmetry is documented at every site that propagates it.

## SmithError variant catalog

Every classified error in smith is a `SmithError` carrying a discriminated payload. The union has 19 variants (`src/core/smith-error.ts`). For each variant: what triggers it, what the renderer prints, what exit code it maps to, and an example.

The renderer is the same for every variant (`src/cli/wrap.ts`):

```text
✗ smith <subcommand>: <headline>      <- always
  <body>                                <- per-variant; may be empty
                                        <- blank line, only if remediation is non-empty
  <remediation>                         <- per-variant; "Try: ..." or multi-line block
```

`SMITH_DEBUG=1` in the environment appends an indented `Payload:` JSON dump and the cause stack (if any) — useful for filing bug reports.

### `registry-version` → exit `1`

Triggered when `registry.json` (the agent catalog file) on disk has a different schema version than the running smith binary expects. Source: `src/io/registry.ts`.

- **Headline:** `agent catalog file version mismatch`
- **Body:** `Found version <current> in <path> (expected <expected>)`
- **Remediation:** Multi-line recovery: move the file aside, `smith init`, re-`register` external catalogs.
- **Note:** `smith init` itself does NOT throw this error — it catches it, prints a one-line yellow warning citing the old + expected versions, and overwrites with the default registry. Other commands (`agent install`, `agent register`, etc.) still surface the structured error so the user knows the file is stale. To self-heal: just run `smith init`.
- **Example:**

  ```
  ✗ smith agent install: agent catalog file version mismatch
    Found version 0 in /Users/x/.config/agent-smith/registry.json (expected 1)

    This file was written by a different version of agent-smith. To recover:
      1. Move the file aside:  mv /Users/x/.config/agent-smith/registry.json /Users/x/.config/agent-smith/registry.json.bak
      2. Re-initialize:        smith init
      3. Re-register external catalogs:  smith agent register <path> --kind registered --label <label>
  ```

  (Or just run `smith init` — it will overwrite in place and you'll only need step 3 for external catalogs you had registered.)

### `registry-corrupt-json` → exit `1`

The `registry.json` file is not parseable as JSON (manual edit gone wrong, partial write from a crash). Source: `src/io/registry.ts`.

- **Headline:** `agent catalog file is corrupt`
- **Body:** `<path>: <parseError>`
- **Remediation:** Edit the JSON manually OR move it aside and `smith init`.

### `skill-registry-version` → exit `1`

Same shape as `registry-version`, but for `skill-catalogs.json`. Source: `src/io/skill-registry.ts`.

- **Headline:** `skill catalog file version mismatch`
- **Remediation:** Move aside, `smith init`, re-`smith skill register` your catalogs.

### `skill-registry-corrupt-json` → exit `1`

Same shape as `registry-corrupt-json`, but for `skill-catalogs.json`. Source: `src/io/skill-registry.ts`.

- **Headline:** `skill catalog file is corrupt`
- **Body:** `<path>: <parseError>`
- **Remediation:** Edit the JSON manually OR move it aside and `smith init`.

### `installed-skills-corrupt` → exit `1`

The `installed-skills.json` state file is not parseable. Source: `src/io/installed-skills.ts`.

- **Headline:** `installed-skills state file is corrupt`
- **Body:** `<path>: <parseError>`
- **Remediation:** `rm <path>`, then re-run `smith skill install <ref>` for each skill you had installed. (You'll need to remember which ones, since the file that tracked them is what's broken.)

### `config-missing` → exit `2`

A required config file does not exist. The thrower knows the right initialization command to suggest.

- **Headline:** `config file missing`
- **Body:** `<path> does not exist`
- **Remediation:** `Run \`<suggestedCommand>\` to initialize.` Examples:
  - Missing `~/.config/agent-smith/registry.json` → `smith init`.
  - Missing `<bundle>/agent.config.json` (raised by `smith knowledge add` when run against a directory without an agent config) → `smith agent init <basename>`.

### `permission-denied` → exit `1`

Either an OS-level access denial (EACCES, EPERM via `classifyFsError` in `src/io/fs-error.ts`) or an HTTP 401/403 response from an external service (via `httpErrorFor` in `src/io/http-error.ts`). Used for any "you are not allowed to do X" outcome where there's no automatable fix.

- **Headline:** `permission denied`
- **Body:** `<operation> permission denied on <path>` where `<operation>` is a free-form phrase. Real values today include `read`, `write`, `GET page`, `list pages in space ENG`, `search issues`, `list`. For HTTP-sourced cases, `<path>` is the request URL.
- **Remediation:** `Check ownership and permissions on <path>. Current user needs <operation> access.`

The `operation` field was widened from a literal `"read" | "write"` union to `string` in Batch 14 so HTTP callers can pass operation phrases through verbatim. Renderer ergonomics for multi-word operations (`"list pages in space ENG permission denied on …"`) are a known UX wart tracked as a deferred follow-up.

### `http-error` → exit `1`

An HTTP request to an external service (Atlassian/Confluence/Jira, raw URL fetch in `acquireUrl`) returned a non-2xx status that wasn't a 401/403 — those route to `permission-denied` instead. Thrown via the `httpErrorFor` helper in `src/io/http-error.ts`.

- **Headline:** `<service><op>: HTTP <status>` (e.g. `Confluence GET page: HTTP 500`, `raw.githubusercontent.com GET: HTTP 503`, `Atlassian rate-limited after 4 attempts: HTTP 429`)
- **Body:** empty — URL and response-body snippet live on the payload (`payload.url`, `payload.snippet`), not in the rendered output
- **Remediation:** 5xx errors are rendered as transient (suggest retry / check service status); 4xx errors as caller errors (review request shape).
- **Payload fields:** `service: string`, `status: number`, `url: string`, `operation?: string`, `snippet?: string`. The snippet defaults to the first 200 chars of the response body, configurable via `httpErrorFor`'s `snippetMaxLen`.

For known services (`Atlassian`, `Confluence`, `Jira`) the `service` field carries the brand name. For `acquireUrl` (arbitrary URL fetch) the helper derives `service` from the URL hostname.

### `usage-error` → exit `2`

The user's invocation was wrong: missing required arg, unknown subcommand, malformed flag value. The thrower supplies a one-line `message` (used as the headline directly — there is no separate body) and an optional `suggestedCommand`.

- **Headline:** `<message>` (verbatim from the payload)
- **Body:** empty
- **Remediation:** `Try: <suggestedCommand>` if supplied, otherwise empty.

This variant also covers anything bubbling up from `commander` itself: usage failures from `parseAsync` are converted via `formatCommanderError()` (`src/cli/wrap.ts`) into a `usage-error` SmithError so they flow through the same renderer.

**Stylistic deviation in `init-user`:** when `$EDITOR` is unset (or points at a binary not on `PATH`), `smith init-user` throws a `usage-error` whose `suggestedCommand` is `export EDITOR=vim   # or your preferred editor` rather than the typical `smith ...` shell-out form (`src/cli/commands/init-user.ts`). The renderer still prints it as `Try: export EDITOR=vim ...`, which reads slightly oddly — "Try:" implies a command to invoke, but the suggestion is a shell builtin. This is documented here as a known stylistic deviation; the alternative (a separate `missing-editor` variant) was deferred.

### `validation-failed` → exit `2`

A bundle, skill, knowledge source, or other user-supplied artifact failed smith's own validation. The thrower supplies a noun phrase (`what`), a list of failure reasons, and an optional retry command.

- **Headline:** `<what> validation failed` (e.g. `agent catalog validation failed`, `skill bundle validation failed`)
- **Body:** one bulleted line per reason: `- <reason>`
- **Remediation:** `Try: <suggestedCommand>` if supplied, otherwise empty.
- **Example:**

  ```
  ✗ smith agent validate: agent catalog validation failed
    - my-agent: IDENTITY.md exceeds 25-line ceiling (found 31)
    - my-agent: description must be an action phrase (10-200 chars)

    Try: smith agent validate my-agent
  ```

### `partial-failure` → exit `3`

A bulk operation completed every step but some sub-operations failed. The thrower supplies counts and a `details: string[]` of per-item identifiers.

- **Headline:** `<operation> completed with errors`
- **Body:** `<succeeded> succeeded, <failed> failed, <skipped> skipped` followed by one `- <detail>` line per failure.
- **Remediation:** empty (the body already tells the user what to re-run).

This is the variant emitted by `smith agent install-all` when one bundle in a registry of many fails to install, by `smith agent uninstall-all` when one path can't be removed, and so on. The user's recovery path is to scan the details, identify the failed items by their identifiers, and re-run the per-item command (`smith agent install <name>`, `smith agent uninstall <name>`).

### `not-found` → exit `1`

A named entity (agent, skill, catalog, knowledge source) does not exist in the relevant registry/state.

- **Headline:** `<what> not found: <identifier>`
- **Body:** empty (headline conveys it)
- **Remediation:** `Try: <suggestedCommand>` if supplied (e.g. `Try: smith agent list` to enumerate what does exist), otherwise empty.

### `already-exists` → exit `2`

A named entity already exists when the caller expected a fresh slot.

- **Headline:** `<what> already exists: <identifier>`
- **Body:** empty
- **Remediation:** `Try: <suggestedCommand>` if supplied (often the read/inspect form, or a `--force` variant if available), otherwise empty.

This is what `smith agent init <name>` raises when `<name>` already has a bundle directory under `~/.config/agent-smith/agents/`. (Separately, `smith agent init --catalog <ref>` raises `not-found` (exit 1) when `<ref>` doesn't resolve to a registered catalog; suggested remediation is `smith agent catalogs`.)

### `protected-catalog` → exit `1`

The user tried to unregister a catalog that is marked `protected: true` in the on-disk skill registry. Currently this fires for the atlassian-skills catalog, but the variant is keyed by name so any future protected catalog gets the same error. Source: `src/io/skill-registry.ts`.

- **Headline:** `cannot unregister protected catalog '<name>'`
- **Body:** empty
- **Remediation:** None — protected catalogs are protected by design. The variant intentionally omits the `Try:` line.

### `model-resolution-failed` → exit `1`

The layered model resolver exhausted all providers for the requested tier. Thrown when no authenticated model provider can satisfy the bundle's `modelTier` for a given target. Source: `src/core/smith-error.ts`.

- **Headline:** `model resolution failed for tier '<tier>'`
- **Body:** names the agent, tier, preferences tried, and authenticated providers available.
- **Remediation:** a hint string from the resolver (e.g. "Set OPENCODE_MODEL_* or configure a provider").

Note: when a platform CLI is absent, the resolver throws
`PlatformUnavailableError` instead. The orchestrator catches this and
drops the target. If *every* declared target is dropped, the
orchestrator emits a "no targets resolvable" error:

```
no targets resolvable: every declared target (<targets>) is unavailable
(platform CLI not installed or model resolution failed). Install a target
platform's CLI, set SMITH_<PLATFORM>_TIER_<TIER>, add a "model" to the
bundle, or re-run with --allow-missing-cli to render anyway.
```

Pass `--allow-missing-cli` to demote missing-CLI errors to warnings and
use the static tier literal for each platform. See
[07-models.md § Missing platform CLI](./07-models.md#missing-platform-cli-allow-missing-cli).

### Quick reference table

| Variant code | Exit | Headline form | Where thrown (representative) |
|---|---|---|---|
| `registry-version` | 1 | `agent catalog file version mismatch` | `src/io/registry.ts` |
| `registry-corrupt-json` | 1 | `agent catalog file is corrupt` | `src/io/registry.ts` |
| `registry-corrupt-shape` | 1 | `agent catalog file has invalid shape` | `src/io/registry.ts` (Zod-shape rejection) |
| `skill-registry-version` | 1 | `skill catalog file version mismatch` | `src/io/skill-registry.ts` |
| `skill-registry-corrupt-json` | 1 | `skill catalog file is corrupt` | `src/io/skill-registry.ts` |
| `skill-registry-corrupt-shape` | 1 | `skill catalog file has invalid shape` | `src/io/skill-registry.ts` (Zod-shape rejection) |
| `installed-skills-corrupt` | 1 | `installed-skills state file is corrupt` | `src/io/installed-skills.ts` |
| `config-missing` | 2 | `config file missing` | various io-layer load paths |
| `permission-denied` | 1 | `permission denied` | various io-layer write paths; `httpErrorFor` 401/403; `classifyFsError` EACCES/EPERM |
| `http-error` | 1 | `<service><op>: HTTP <status>` | `httpErrorFor` (atlassian-http, confluence, jira, acquire.ts) |
| `network-error` | 1 | `<operation> failed: network error` | `acquireUrl` raw `fetch()` wrap (Batch 16); URL pre-redacted via `redactSecrets` |
| `model-resolution-failed` | 1 | `model resolution failed for tier '<tier>'` | `src/core/smith-error.ts` (layered resolver exhausted) |
| `usage-error` | 2 | `<message>` | `src/cli/commands/*` (30+ sites); `formatCommanderError` |
| `validation-failed` | 2 | `<what> validation failed` | `src/cli/commands/validate.ts`, register/install paths |
| `partial-failure` | 3 | `<operation> completed with errors` | `agent install-all`, `agent uninstall-all`, knowledge fetch, bootstrap, knowledge validate |
| `not-found` | 1 | `<what> not found: <identifier>` | install/uninstall lookup paths, agent init --catalog |
| `already-exists` | 2 | `<what> already exists: <identifier>` | `agent init`, `skill install --from --as` |
| `protected-catalog` | 1 | `cannot unregister protected catalog '<name>'` | `src/io/skill-registry.ts` |

## Update pipeline

`smith update` is a six-step sequential pipeline (`src/cli/commands/update.ts`) and its exit codes don't match a single SmithError variant. Spokes 11 and 14 link this section as `#update-pipeline`.

The pipeline:

1. Resolve the workspace from `import.meta.url`. If `null`, refuse with a reinstall pointer.
2. `git pull --ff-only` (refuses on dirty workspace; fails on network/non-fast-forward).
3. `bun install` to sync dependencies.
4. `bun run gui:build` to rebuild the GUI SPA bundle. Warn-and-continue on failure.
5. `smith agent install agent-smith` to refresh the companion agent's bundled knowledge dir from `guide/`. A failure here prints `Re-run: smith agent install agent-smith` and the pipeline continues — doctor still runs.
6. `smith doctor` to verify the install. Doctor's exit code is propagated **verbatim** as `update`'s exit code, except when reinstall (Step 5) or GUI build (Step 4) failed and doctor passed clean — that combination promotes to `EXIT_PARTIAL`.

Step 1 should not fire under the single-mode install (every clone lives at `~/.agent-smith/`). When it does, the printed pointer is `gh repo clone eliharoun/agent-smith ~/.agent-smith && bash ~/.agent-smith/bin/install` (`src/cli/commands/update.ts`).

Exit code mapping (canonical — spokes 11 and 14 link here):

| Step / outcome | Exit | Source |
|---|---|---|
| Corrupt-install refusal (workspace not resolvable from `import.meta.url`) | `1` (`EXIT_RUNTIME`) | `src/cli/commands/update.ts` |
| Dirty-workspace refusal (`git status --porcelain` non-empty) | `1` (`EXIT_RUNTIME`) | `src/cli/commands/update.ts` |
| `git fetch origin main` failure (during `--dry-run`) | `3` (`EXIT_PARTIAL`) | `src/cli/commands/update.ts` |
| `git pull` error (network, non-fast-forward, etc.) | `3` (`EXIT_PARTIAL`) | `src/cli/commands/update.ts` |
| `bun install` failure | `3` (`EXIT_PARTIAL`) | `src/cli/commands/update.ts` |
| `bun run gui:build` failure, doctor clean | `3` (`EXIT_PARTIAL`) | `src/cli/commands/update.ts` |
| `smith agent install agent-smith` failure, doctor clean | `3` (`EXIT_PARTIAL`) | `src/cli/commands/update.ts` |
| `smith agent install agent-smith` failure, doctor non-zero | propagated from doctor | `src/cli/commands/update.ts` |
| Doctor reports clean (post-pull, reinstall ok) | `0` | propagated from doctor |
| Doctor reports drift (post-pull) | `1` | propagated from doctor |
| Doctor reports network error fetching schema (post-pull) | `2` | propagated from doctor |
| Pipeline succeeded end-to-end (clean doctor, clean reinstall) | `0` (`EXIT_OK`) | `src/cli/commands/update.ts` |
| `--dry-run` succeeded | `0` (`EXIT_OK`) | `src/cli/commands/update.ts` |

### Why these specific codes

- **`1` for refusals** — the pipeline never started (preconditions failed). No partial state on disk; same shape as any other "operation could not complete" outcome.
- **`3` for git/bun failures** — the pipeline started but aborted mid-way. After a failed `bun install` your workspace has the new source code but the old `node_modules`; that's a half-applied state, which fits the partial-failure category. The user's recovery is to re-run `bun install` manually, then re-try `update`.
- **`3` for reinstall-only failures** — git pull and `bun install` succeeded but `smith agent install agent-smith` failed (or the GUI build failed); doctor still passed. The companion-agent bundle on platforms is now stale relative to the just-pulled `guide/`. Re-run `smith agent install agent-smith` (or `bun run gui:build`) to recover.
- **Doctor's verbatim propagation** — see [Subsystem exit codes that don't fit the taxonomy](#subsystem-exit-codes-that-dont-fit-the-taxonomy). Doctor's `2` is a network error, not a usage error. A `2` from `smith update` post-pull means the update technically succeeded, doctor just couldn't verify it. When reinstall *also* failed but doctor returned non-zero, doctor wins (the reinstall partial is shadowed by the more actionable doctor signal).

### Migration note

Earlier versions of `smith update` returned `2` for git/bun failures (matching the pre-taxonomy convention of "anything not 0 or 1 is 2"). The current behavior — `3` for partial pipeline failures — is the source-of-truth and what the per-command matrix below reflects. CI scripts that key on `smith update`'s exit code should treat `2` strictly as "doctor saw a network error" and `3` as "pipeline aborted before doctor ran".

### Scripting recipe

```bash
smith update
case $? in
  0) echo "clean" ;;
  1) echo "corrupt install, dirty workspace, or doctor drift"; exit 1 ;;
  2) echo "doctor saw network error; update itself succeeded"; exit 0 ;;
  3) echo "pipeline aborted (git or bun install failed)"; exit 1 ;;
esac
```

For a richer narrative on each refusal path (with output samples), see [11-update-and-uninstall.md#smith-update](./11-update-and-uninstall.md#smith-update).

## Per-command exit-code matrix

Every smith command, alphabetised. The exit codes listed are the codes the command can actually return — not every code is reachable from every command. For full synopsis, flags, and behavioral detail per command, follow the cross-link to [14-cli-reference.md](./14-cli-reference.md).

| Command | `0` | `1` | `2` | `3` |
|---|---|---|---|---|
| `bootstrap` | success / dry-run / postinstall skip | install failure for the architect skill or persona | bad flag value | one of the bundled artifacts failed to install while others succeeded |
| `daemon run` | (foreground; only on signal) | fatal startup error | bad flag | — |
| `daemon start` | started; heartbeat verified | failed to spawn / stale pid / heartbeat never written | bad flag | — |
| `daemon status` | reported (any state) | could not read pid file due to permissions | bad flag | — |
| `daemon stop` | always (even if no daemon running) | — | bad flag | — |
| `agent destroy` | source bundle removed; dry-run succeeded | confirmation token mismatch | agent not found; non-`user-global` catalog; rendered files exist without `--force`; bad flag | — |
| `config get [key]` | reported (key optional — shows full overview when omitted; shows value or `(unset)` for a valid key) | invalid key name | — | — |
| `config set <key> <value>` | value written | invalid key name | — | — |
| `doctor` | clean (or OpenCode absent) | drift detected (requires OpenCode on `PATH`) | **network error OR no-platform refusal** (NOT usage error — see [10-doctor.md](./10-doctor.md)) | — |
| `init` | success / idempotent re-run | could not write the config dir | bad flag | — |
| `agent init` | bundle scaffolded | write failure | bad flag; invalid name regex; invalid `--permission-json`; name already exists; `--catalog` value not a registered catalog | — |
| `init-user` | editor exited 0 | editor exited non-zero | `$EDITOR` not on PATH | — |
| `agent install` | rendered & written; idempotent re-run | bundle not found; write failure; manifest hash-mismatch refusal (without `--force`) | bad flag | — |
| `agent install-all` | every bundle installed (or registry empty) | unrecoverable failure before any bundle ran | bad flag | at least one bundle failed; others succeeded |
| `jack-out` | full removal succeeded; dry-run succeeded | confirmation token mismatch | bad flag | at least one removal failed |
| `knowledge add` | source added | bundle not found; write failure | bad flag; invalid source schema | — |
| `knowledge fetch` | every source materialised | bundle not found | bad flag | at least one source failed to materialise |
| `knowledge compile` | every requested bundle compiled (or `--all` skipped non-knowledge bundles cleanly) | one or more sources have never been materialised (run `smith knowledge fetch <name>` first); other runtime failure | bundle has no `knowledge` block / no sources to compile; bad flag | — |
| `knowledge list` | reported | bundle not found; manifest unreadable | bad flag | — |
| `knowledge validate` | clean | unrecoverable failure | bad flag; validation failed | — |
| `agent list` | reported (even if registry empty) | could not load registry | bad flag | — |
| `agent register` | catalog added | path missing / not a catalog / git remote mismatch | bad flag | — |
| `skill catalogs` | reported | could not load skill registry | bad flag | — |
| `skill install` | installed | source not found; write failure; protected catalog | bad flag; invalid name | — |
| `skill list` | reported | could not load installed-skills | bad flag | — |
| `skill register` | catalog added | path missing; protected-label collision | bad flag; duplicate label | — |
| `skill uninstall` | removed | not installed | bad flag | — |
| `skill unregister` | removed | catalog not found; protected catalog | bad flag | — |
| `skill update` | updated | source-missing drift | bad flag | (when `--all`) at least one update failed |
| `status` | reported | could not load registries | bad flag | — |
| `agent uninstall` | every target removed (or absent); dry-run | agent not found in any catalog | bad flag | at least one path failed to remove; manifest hash-mismatch refusal (without `--force`) |
| `agent uninstall-all` | every file removed; registry empty; dry-run | declined confirmation prompt | bad flag | at least one path failed to remove; manifest hash-mismatch refusal (without `--force`) |
| `agent unregister` | catalog removed | catalog not registered | bad flag | — |
| `update` | clean pipeline; dry-run | corrupt-install refusal; dirty workspace; doctor drift | doctor network error | git pull / git fetch / bun install / gui-build failed |
| `agent validate` | clean | unrecoverable failure | bad flag; bundle validation failed | — |

For commands that compose subsystems (`update`, `bootstrap`), the per-step mapping is in the spoke that owns the command. Cross-links: [11-update-and-uninstall.md](./11-update-and-uninstall.md) for `update`, [01-getting-started.md](./01-getting-started.md) for `bootstrap`.

## How `wrap()` renders errors

The render contract is the same for every error. Three pieces, in order:

1. **Header line** — always printed:
   `✗ smith <subcommand>: <headline>`
   The `✗` is `pc.red("✗")` (`src/cli/wrap.ts`). `<subcommand>` is the name passed to `wrap()` at registration time. `<headline>` comes from `formatHeadline(payload)` for SmithError, or `"unexpected error"` for unknown throws.
2. **Indented body** — printed only when non-empty. Per-variant:
   - Catalog-file variants: `Found version <n> in <path> (expected <m>)` or `<path>: <parseError>`.
   - `config-missing` / `permission-denied`: a single descriptive line.
   - `validation-failed`: bulleted list of reasons.
   - `partial-failure`: counts summary plus bulleted list of failed-item identifiers.
   - `usage-error`, `not-found`, `already-exists`: empty (the headline says it).
3. **Indented remediation** — printed only when non-empty, separated by a blank line. Per-variant:
   - Multi-step shell recipes for catalog-file recovery.
   - Single-line `Run \`<command>\` to initialize.` for `config-missing`.
   - `Try: <suggestedCommand>` for `usage-error`, `validation-failed`, `not-found`, `already-exists` (when supplied).
   - Empty for `partial-failure` (the body already says what to retry).

### `SMITH_DEBUG=1`

Set `SMITH_DEBUG=1` in the environment to append diagnostic context to every error:

- For `SmithError`: a JSON dump of the payload, plus the `cause` stack trace if `new SmithError(p, { cause: e })` was used.
- For unknown errors: the full stack trace, indented under the message line.

The debug block goes after the remediation, separated by a blank line, in `pc.dim()` (`src/cli/wrap.ts`).

Use `SMITH_DEBUG=1` when:
- You're filing a bug report (paste the payload dump).
- You're debugging a `unexpected error` (the unknown-error renderer points you at this).
- You're working on smith itself and want to see exactly which variant fired.

### What happens when the renderer itself breaks

`handleThrow` in `src/cli/wrap.ts` is defensive. If the formatter throws (rare — a malformed payload that doesn't match the discriminated union, a `picocolors` failure), the user still sees something:

```text
[smith internal] formatter threw: <message>
Original error: <original stack or message>
```

…and the process exits `1`. This is a "break-glass" path, not part of the contract. If you see it, file a bug.

## What is NOT a SmithError

The wrap shim catches everything, but only `SmithError` instances get the structured renderer. Everything else flows through `formatUnknownError()` (`src/cli/wrap.ts`) and exits `1`.

### Raw `throw new Error(...)`

Several call sites still throw raw `Error` (catalogued in [Known limitations](#known-limitations--followups)). They surface as:

```
✗ smith <subcommand>: unexpected error
  <error message>

  This is a bug in agent-smith. Re-run with SMITH_DEBUG=1 for a full
  stack trace, then file at:
  https://github.com/eliharoun/agent-smith/issues
```

The error message comes through, but the structured headline/body/remediation contract doesn't apply. From a user perspective these are indistinguishable from genuine bugs — which is the point: the long-tail migration is to convert every raw throw into a typed `SmithError` so the user sees a proper headline and a real recovery hint.

### Uncaught exceptions outside `wrap()`

If a `SmithError` (or any throw) escapes the wrap shim — which can only happen if something throws *outside* a `.action(wrap(...))` callback — Node's default uncaught-exception handler prints the stack trace to stderr and exits with the platform's default uncaught-exception code (usually `1`). Inside `smith` this is essentially impossible; the only escape paths are the two `process.exit` calls in `src/index.ts` (see below).

### `commander` parse failures

When `commander` itself rejects an invocation (unknown command, missing required argument, bad flag value), it throws before any `.action` runs. Those throws are caught by the `try/catch` around `program.parseAsync` in `src/index.ts`:

```text
try {
  await program.parseAsync(process.argv);
} catch (err) {
  // commander.help / .helpDisplayed / .version → process.exit(0)
  // anything else → formatCommanderError() → ✗ smith: <msg>; process.exit(2)
}
```

This is the *one* place in smith that doesn't go through `wrap()`. The rendered output uses the same `✗ smith: <message>` prefix (without a subcommand, since commander failed before resolving one) and exits `2`. See [Known limitations](#known-limitations--followups) for the implications.

### Panics inside spawned processes

`smith update` spawns `bun install` and `git`, and `smith init-user` spawns `$EDITOR`, as child processes with inherited stdio. If those processes crash, their stderr appears live in the user's terminal, and the parent command surfaces the failure as a `partial-failure` SmithError (for `update`'s `bun install` step) or a `usage-error` (for `init-user`'s editor failure). The original child's stack trace is not captured or re-rendered — you see whatever the child wrote. (`smith skill bootstrap` does *not* spawn `bun install` — it installs bundled skills directly via `installSkill`/`updateSkill`; see `scripts/bootstrap.ts`.)

## Known limitations / followups

The migration from raw `process.exit()` calls and `console.error + return 1` patterns to the unified SmithError pipeline is essentially complete, but a small number of residuals remain. They're catalogued here for cleanup followups; users won't typically encounter them in day-to-day operation.

### Raw `process.exit` calls outside `wrap()`

Two `process.exit` calls in `src/index.ts` sit in the `parseAsync` catch block. Both are intentional (commander's own throw paths cannot route through `wrap()` because they fire before any `.action` callback), but they bypass the structured renderer:

- `process.exit(0)` for `commander.help`, `commander.helpDisplayed`, `commander.version` — when the user passed `--help` or `--version`. Commander prints its own help text; smith just exits cleanly.
- `process.exit(2)` for any other commander throw — wrapped through `formatCommanderError()` which produces a `✗ smith: <message>` line on stderr first.

The cleanup followup is to refactor the parse-loop into a wrap-able command so even these flow through the unified renderer. Low priority; the current behavior is correct, just inconsistent in code shape.

### Raw `1` in `agent uninstall-all` declined-prompt path

Resolved: `src/cli/commands/uninstall-all.ts` now uses the `EXIT_OK`/`EXIT_RUNTIME` named constants throughout.

### Variants without a typed `SmithError`

The known long-tail of raw `throw new Error()` and `console.error(pc.red(…)) + return 1` patterns in CLI command files **and the io layer (atlassian-http, confluence, jira, acquire.ts, bundle-loader, skill-discovery)** has been migrated. The remaining gaps are intentional:

- Commander parse-loop fallthrough at `src/index.ts` (see [Raw `process.exit` in commander parse-loop](#raw-processexit-in-commander-parse-loop) above).
- Result-shape unwraps inside io-layer helpers that bubble up as wrapped SmithErrors at the CLI boundary.
- ~~Raw network errors from `fetch()` in `acquireUrl` (DNS, ECONNREFUSED) — propagate as raw `TypeError`. Tracked for a future Theme-J redaction sweep.~~ **Closed in Batch 16 (`c28de0d`)**: the new `network-error` SmithError variant wraps `acquireUrl`'s raw `fetch()`, with the URL pre-redacted via `redactSecrets`.

If a new code path surfaces "unexpected error" in the field, the fix is the same recipe used here: add a typed variant to `SmithError`, throw it at the source, render it in `formatHeadline`/`formatRemediation`/`bodyFor`, and add a `wrap.test.ts` case.

### Migration note: git-operation exit-code change (Batch 14)

Pre-Batch-14, knowledge-source git failures (clone / fetch / reset / lock-timeout from `src/core/knowledge/acquire.ts`) threw raw `Error` and surfaced as exit `1` (`EXIT_RUNTIME`). Post-Batch-14 they throw `validation-failed` SmithError and surface as exit `2` (`EXIT_USAGE`). Atlassian/Confluence subprocess-style failures (90s wall-clock budget, 30s per-request timeout, budget-exceeded) shifted the same way.

This was an unintended side effect of the typed-error migration — `validation-failed` is the closest existing variant, but its exit-code mapping is wrong for what is really a subprocess/network failure. Restoring the runtime-vs-usage distinction needs a `subprocess-failed` or `network-exhausted` variant; tracked as a deferred follow-up.

Practical impact: CI scripts keying on `$?` from `smith agent install` / `smith knowledge fetch` for git-source failures will now see `2` instead of `1`. Scripts that branch on "any non-zero" are unaffected.

### Cosmetic rendering quirks

- **Double `error:` prefix** in commander-routed output: `✗ smith: error: unknown command 'foo'`. Commander injects its own `error:` prefix that `formatCommanderError` doesn't strip.
- **Headline-prefix duplication** for some `usage-error` payloads where the message starts with `smith <subcommand>` — produces output like `✗ smith knowledge: smith knowledge requires a subcommand: ...`.

Both are catalogued in the followups doc; the fixes are one-liners but were deferred to keep the SmithError batch small.

## See also

- [11-update-and-uninstall.md](./11-update-and-uninstall.md) — narrative coverage of `smith update`'s pipeline; this spoke is the canonical home for the exit-code matrix it links to.
- [10-doctor.md](./10-doctor.md#internal-exit-codes-the-trap) — doctor's internal `0/1/2` semantics and why they collide with the global taxonomy.
- [14-cli-reference.md](./14-cli-reference.md) — terse synopsis/flags/exit-codes for every command; cross-link target for the per-command matrix above.
- [03-installing-and-rendering.md](./03-installing-and-rendering.md) — `smith agent install` and `smith agent install-all` exit-code behavior in narrative form.
- [13-paths-and-state.md](./13-paths-and-state.md) — the state files referenced by catalog-version, registry-corrupt, and installed-skills-corrupt variants.
