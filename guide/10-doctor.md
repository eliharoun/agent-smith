# Doctor

> `smith doctor` runs fifteen health checks against your agent-smith install — schema drift (per platform), model resolution, workspace freshness, credentials, installed-skill drift, installed-agent drift, registry hygiene. It's a read-only diagnostic. Run it after `smith agent install`, after `smith update`, when something feels off, and in CI to gate deployments.
>
> As of v0.13, `smith doctor` defaults to a **compact summary** (one line per check; failing sections auto-expand). Use `--verbose` for the pre-v0.13 full per-section detail report, or `--quiet` to suppress all human output while preserving the exit code.

> **Tip — browser GUI.** `/system/doctor` in `smith gui` runs the same check, surfaces a one-click `--fix-knowledge-refresh` button when a fixable kind is reported (`missing-hook` / `orphaned-consent` / `corrupt-cache`), and shows a banner with a one-click `smith knowledge migrate-codex` when unmanaged Codex hooks are detected. See [README → Browser GUI](../README.md#browser-gui-smith-gui).

## Mental model

Doctor walks fifteen sections sequentially, each producing a structured row in the report. Sections fall into two buckets:

- **Exit-code-affecting** — the `opencode` schema check and the `model-resolution` check. These can bump the exit code to `1` (drift) or `2` (network error).
- **Informational** — every other section (workspace, atlassian-auth, skill-drift, agent-required-skills, registry-hygiene, claude-code/codex tool maps). They report status, surface remediation hints, but never affect the exit code.

The orchestrator lives in `src/core/freshness/run-doctor.ts` (the `runDoctor` function); the CLI wiring (real fetch, real disk cache, spinner UI, exit propagation) lives in `src/cli/commands/doctor.ts` (`runDoctorCli`). The two are split so tests can drive the pure orchestrator hermetically.

## Platform auto-detection

`smith doctor` only reports on platforms whose CLI binary is on PATH. Detection is a one-shot probe of the user's `PATH` (`Bun.which`) at the top of `runDoctorCli`, before any other work:

| Platform | Binary probed | Install |
|---|---|---|
| OpenCode | `opencode` | https://opencode.ai/docs |
| Claude Code | `claude` | `npm i -g @anthropic-ai/claude-code` |
| Codex | `codex` | `npm i -g @openai/codex` |
| Kiro | `kiro-cli` (preferred) or `kiro` | `curl -fsSL https://cli.kiro.dev/install \| bash` (CLI) / `https://kiro.dev/downloads/` (IDE) |

When a platform is absent from PATH:

- Its section (and the OpenCode-specific `model-resolution` section when OpenCode is absent) is silently omitted from human output — no entry, no spinner, no events.
- The omitted platform id appears in `report.skippedPlatforms` (always present in `--json` output, even when empty).
- The exit code is computed over the platforms that **did** run, so a host without OpenCode never sees the OpenCode-drift-or-network-error branches.

The detection signal is intentionally the binary on PATH, not agent-smith's own installed-skills state — a user who deleted the runtime but kept smith's state files should see "platform gone", not a stale section. The probe is injectable for tests via `DoctorCliOptions.detectInstalledPlatforms`.

### Refusal: no supported platform detected

When the detection probe returns an empty set, `smith doctor` refuses to run, prints install hints for all four platforms, and exits **2** (environment misconfiguration). Cross-cutting sections (workspace, atlassian-auth, skill-drift, required skills, registry-hygiene) are also skipped — the user's environment is not set up enough for those checks to be meaningful.

In `--json` mode the refusal emits a canonical envelope:

```json
{
  "error": "no-platform-detected",
  "message": "No supported AI coding platform detected on PATH.\n\nInstall one of:\n  OpenCode:    https://opencode.ai/docs\n  Claude Code: npm i -g @anthropic-ai/claude-code\n  Codex:       npm i -g @openai/codex\n  Kiro:        curl -fsSL https://cli.kiro.dev/install | bash  (CLI)  /  https://kiro.dev/downloads/  (IDE)\n\nThen re-run `smith doctor`.",
  "exitCode": 2
}
```

The exact message string is exported from `src/cli/commands/doctor.ts` as `NO_PLATFORM_REFUSAL_MESSAGE` for downstream consumers and integration tests.

## The fifteen sections

| # | Section id | What it checks | Exit-code contribution |
|---|---|---|---|
| 1 | `opencode` | Vendored `data/opencode.config.schema.json` against the upstream schema fetched from `https://opencode.ai/config.json`. 24h cache. | Network error → `2` (dominates everything); drift → `1`; clean → `0` |
| 2 | `claude-code` | `data/claude-code-tool-map.json` provenance metadata. No live fetch — Claude Code has no published tool surface to diff against. | Informational |
| 3 | `codex` | `data/codex-tool-map.json` provenance metadata. Same shape as `claude-code`. | Informational |
| 4 | `kiro` | `data/kiro-tool-map.json` and `data/kiro.agent-v1.schema.json` provenance metadata. Same shape as `claude-code`. | Informational |
| 5 | `model-resolution` | For every installed agent: does the `model:` literal in the per-platform output still appear in `opencode models`? Curated fallback (`CURATED_FALLBACK_V0_6_0`) is also checked against the live list. | Stale agent → `1`; curated-fallback drift alone is informational |
| 6 | `workspace` | `git status`-equivalent of the agent-smith checkout against `origin/main`: current / ahead / behind / diverged / unknown. | **Informational, including `unknown:network-error`** — see Caveats |
| 7 | `atlassian-auth` | Reports which of the two credential resolution tiers produced a hit (`env-smith` / `file-smith`) or `missing`. Reports `not-applicable` (event status `skipped`) when credentials are absent AND no `atlassian-skills` is installed AND no agent has a Confluence/Jira knowledge source. When atlassian-skills is installed, also checks the env-var bridge (`JIRA_*`/`CONFLUENCE_*`) and Python runtime availability. | Informational |
| 8 | `skill-drift` | For each skill in `installed-skills.json`: hash the dest dir and compare to the recorded `contentHash`. Reports `ok` / `drift` / `missing` / `source-missing`. | Informational |
| 9 | `agent-required-skills` | For each agent that declares `requires.skills`, diff against the installed-skills list; report unsatisfied entries with a `smith skill install <ref>` hint. | Informational |
| 10 | `registry-hygiene` | For every registered agent or skill catalog, confirm `rootPath` exists, contains bundles, and (if `gitRemote` is set) a matching git remote is configured. The protected `atlassian-skills` skill catalog is exempt (lazy-cloned). | Informational |
| 11 | `remote-catalogs` | For every remote-backed catalog (those with a `remote` block), compare `lastPulledSha` against `lastRemoteSha` and report `catalog-behind-remote` when they diverge or `catalog-stale-check` when `lastCheckedAt` is older than 7 days. Offline-safe — surfaces drift previously observed by `sync --check` runs without performing live `git ls-remote`. v1-task C3.14. | Informational |
| 12 | `duplicate-catalogs` | Walks both registries, groups entries by `normalizeGitUrl(remote.url)` (scheme/case/`.git`-suffix insensitive), and warns on clusters of size ≥ 2. Surfaces back-catalog duplicates accumulated under rc.1 — RC2-4 closes the forward door (`install --from` hard-errors on duplicates) but pre-existing duplicates need this audit to discover. Pure check; no IO beyond reading registry files. v1-task RC2-10. | Informational |
| 13 | `knowledge-refresh` | Knowledge-refresh hook integrity (per-platform): missing hook, orphaned consent record, corrupt cache. `--fix-knowledge-refresh` repairs. | Informational |
| 14 | `knowledge-compile` | Audits any agent whose `compile-manifest.json` exists on disk OR whose bundle declares `compile.progressive: true`. Reads `compile-manifest.json` and compares its `contentHash` against a fresh `compile()` over the materialized `_manifest.json` sources. Reports `missing-manifest` (file absent or unparseable) and `drift` (hash mismatch). Manifest-presence detection covers v2.1 auto-compiled bundles (the dominant case under the smart default), drift-after-shrink (manifest left behind when sources were trimmed below the threshold), and stale manifests under explicit `progressive: false` opt-out. Bundles with no knowledge sources and no manifest on disk are silently skipped. `--fix-knowledge-compile` re-runs `smith knowledge compile <agent>` for each finding. v2. | Informational |
| 15 | `knowledge-prompt-disk-consistency` | Cross-checks each agent's prompt frontmatter against the materialized knowledge dir on disk to catch out-of-sync state. | Informational |
| 16 | `agent-drift` | For each agent in `installed-agents.json`: hash the installed file and compare to the recorded `contentHash`. Reports `ok` / `drift` / `missing`. | Informational |

The section ids in this table match the values you'll see in `--json` output and in the `DoctorSectionId` union (`src/core/freshness/run-doctor.ts`).

## Internal exit codes (the trap)

Doctor uses its own three-value exit-code system that pre-dates the unified CLI taxonomy:

| Doctor exit | Meaning |
|---|---|
| `0` | All checks clean, or skipped via `--offline` with no model-resolution staleness |
| `1` | OpenCode schema drift detected, OR an installed OpenCode agent's `model:` literal is no longer in the live model list |
| `2` | Network error fetching the live OpenCode schema (dominates `1` if both occur) |

The exit-code logic is computed near the end of `runDoctor` in `src/core/freshness/run-doctor.ts`:

```text
baseExitCode = !opencode                              ? 0    # OpenCode not detected on PATH
              : opencode.status === "drift"           ? 1
              : opencode.status === "network-error"   ? 2
              : 0
exitCode     = baseExitCode === 2                     ? 2
              : modelStale                            ? 1
              : baseExitCode
```

When OpenCode isn't on PATH, the `opencode` section is omitted entirely (see [Platform auto-detection](#platform-auto-detection)) and `baseExitCode` collapses to `0` — drift and network-error are unreachable, so doctor's `2` can only come from the OpenCode-installed path.

**Doctor's `2` is NOT the same as the global CLI taxonomy's `2`.** They share a number but mean different things:

| Code | Meaning under the global CLI taxonomy | Meaning when emitted by `smith doctor` |
|---|---|---|
| `0` | success | all checks clean |
| `1` | runtime failure | drift detected |
| `2` | usage error (bad flags, missing args) | **network error** fetching the OpenCode schema, **or** the no-platform refusal (zero platform CLIs detected on `PATH`) |
| `3` | partial failure (some items succeeded, others didn't) | not used by doctor |

This asymmetry matters for two reasons:

1. **Scripts that key on `$? == 2`** from `smith doctor` will misclassify either a network error or the no-platform refusal as a usage error if they apply the global taxonomy. Either treat doctor's `2` specifically (it means "couldn't fetch the schema, or no supported platform is installed" — the `--json` envelope distinguishes the two: refusal emits `{"error":"no-platform-detected"}`), or always combine doctor with `--offline --no-cache --skip-model-resolution` in environments without network.
2. **`smith update` propagates `smith doctor`'s exit code verbatim** as its final pipeline step. So a `2` from `smith update` post-pull means doctor saw a network error or the no-platform refusal, not that you passed bad flags to `update`. See [guide/11-update-and-uninstall.md](./11-update-and-uninstall.md) and the canonical exit-code coverage in [guide/12-error-handling.md](./12-error-handling.md).

## Verbosity

By default, `smith doctor` prints a one-line summary per check and
auto-expands only sections that warn or error. This keeps a healthy run
to ~12 lines.

| Mode | Flag | What you see |
| --- | --- | --- |
| Default | (none) | One-line summary per section; failing/warning sections auto-expand with full detail; 3-line footer with hints. |
| Verbose | `-v`, `--verbose` | Full per-section detail report (pre-v0.13 default). |
| Quiet | `-q`, `--quiet` | Nothing on stdout; exit code preserved. For CI scripts that only need pass/fail. |

`--verbose` and `--quiet` are mutually exclusive (`smith doctor` exits
with code 2 if both are passed).

`--json` is unchanged: the JSON envelope is always the full
`DoctorReport`, regardless of `--verbose` or `--quiet`.

## Streaming TTY UI

When `process.stdout.isTTY === true` and `--json` is not set, doctor renders per-section `ora` spinners that resolve to ✅/⚠️/❌/⏳ markers as each section completes (see the `useStreaming` block in `src/cli/commands/doctor.ts`). The same structured report is then printed below the streaming overview.

Spinner failures are caught defensively — a broken `ora` call must not crash doctor. To surface those swallowed errors during debugging, set `SMITH_DEBUG=1` (or the deprecated `AGENT_SMITH_DEBUG`):

```bash
SMITH_DEBUG=1 smith doctor
```

Output to a pipe, or invocations with `--json`, never stream — they print the final report once.

## Flags

| Flag | Effect |
|---|---|
| `--offline` | Skip the live OpenCode schema fetch. The `opencode` section reports `offline-skipped` (status `skipped`, no exit-code contribution). The cache is still consulted and the rest of the sections still run. |
| `--no-cache` | Bypass the 24h schema cache; force a fresh HTTPS fetch of `https://opencode.ai/config.json`. Ignored when `--offline` is also set. |
| `--json` | Emit machine-readable JSON to stdout. Disables spinners and color. The exit code is still set normally. |
| `--skip-model-resolution` | Skip section 5 entirely. The report omits the `modelResolution` field and that section can't bump the exit code. (When OpenCode is not on PATH the section is auto-skipped anyway — see [Platform auto-detection](#platform-auto-detection); this flag is for the case where OpenCode is installed but you still want a hermetic pass.) |
| `-v`, `--verbose` | Full per-section detail report (pre-v0.13 default behavior). |
| `-q`, `--quiet` | Suppress all human output; preserve exit code. JSON still emits when combined with `--json`. For CI scripts that only need pass/fail. |
| `--fix-knowledge-refresh` | After running the `knowledge-refresh` detection section, auto-repair each finding: re-register missing hooks, delete corrupt cache entries, clear orphaned consent records. `unmanaged-codex-hooks` findings are not auto-fixed (requires `smith knowledge migrate-codex`). |
| `--fix-knowledge-compile` | After running the `knowledge-compile` detection section, re-run `smith knowledge compile <agent>` for every `missing-manifest` or `drift` finding. Both kinds repair via the same path because a re-compile both re-materializes sources and overwrites a stale or corrupt `compile-manifest.json`. v2. |

### Flag combinations

- `--offline --no-cache` — `--offline` wins; the live fetch is skipped and the cache is not touched. Functionally equivalent to `--offline` alone.
- `--json --no-cache` — common in CI: machine-readable output with a guaranteed-fresh schema fetch.
- `--offline --skip-model-resolution` — fully hermetic; the only remaining I/O is local file reads and (if `opencode` is on PATH) the model-resolution skip avoids spawning it. Useful when you want a doctor pass without any network or subprocess activity:

```bash
smith doctor --offline --no-cache --skip-model-resolution
```

## `--json` output

The JSON shape is the `DoctorReport` interface in `src/core/freshness/types.ts`. Top-level fields:

```json
{
  "generatedAt": "2026-05-04T...",
  "exitCode": 0,
  "platforms": [
    { "platform": "opencode", "vendoredDate": "2026-...", "status": "fresh", ... },
    { "platform": "claude-code", "lastVerifiedDate": "2026-...", "status": "manual", ... },
    { "platform": "codex", "lastVerifiedDate": "2026-...", "status": "manual", ... },
    { "platform": "kiro", "lastVerifiedDate": "2026-...", "status": "manual", ... }
  ],
  "skippedPlatforms": [],
  "modelResolution": { "opencodeCliPath": "/usr/local/bin/opencode", "liveModelCount": 47, ... },
  "workspace": { "status": "current" },
  "atlassianAuth": { "status": "configured", "source": "file-smith" },
  "skillDrift": { "entries": [ { "name": "the-architect", "status": "ok", "checkedDest": "..." } ] },
  "agentRequiredSkills": { "status": "ok", "agents": [] },
  "registryHygiene": { "warnings": [], "errors": [] }
}
```

Field semantics:

- `generatedAt` — ISO-8601 timestamp from `deps.now()` at the start of the run.
- `exitCode` — literal `0 | 1 | 2`. Same value the process exits with.
- `platforms` — entries in canonical order `opencode`, `claude-code`, `codex`, `kiro`, **filtered to only the platforms detected on PATH**. A host with only `codex` installed produces a single-entry array.
- `skippedPlatforms` — always present; lists the canonical ids of platforms that were probed and not found on PATH. Empty array when all four are installed.
- `modelResolution` — present when both (a) `--skip-model-resolution` was not passed and (b) OpenCode was detected on PATH. The section is OpenCode-specific (it shells out to `opencode models` and inspects installed OpenCode agents), so it's also omitted when OpenCode is absent.
- `workspace` — present unless the workspace path can't be resolved from `import.meta.url` (unusual install layout).
- `atlassianAuth`, `registryHygiene` — always present in the CLI's invocation.
- `skillDrift`, `agentRequiredSkills` — always present in the CLI's invocation; may have empty entry arrays.

**Refusal envelope.** When the platform-detection probe returns an empty set, the JSON output is the refusal envelope (`{ error, message, exitCode }`) documented in [Platform auto-detection → Refusal](#refusal-no-supported-platform-detected), not the `DoctorReport` shape above.

The JSON output is the **machine-readable contract**. The human-readable output (rendered by `formatReport` in `src/core/freshness/format.ts`) is not stable and can change between releases — never script against it.

## Schema cache

Doctor caches the upstream OpenCode schema for 24 hours to keep repeated runs fast and quiet:

- **Path**: `~/.cache/agent-smith/opencode-schema-cache.json`, or under `$XDG_CACHE_HOME/agent-smith/` when that variable is set.
- **TTL**: 24 hours, computed from the cache file's `fetchedAt` timestamp against `deps.now()`.
- **`XDG_CACHE_HOME` resolution**: an unset OR empty value falls back to `~/.cache/` (see `defaultCachePath` in `src/cli/commands/doctor.ts`). Whitespace-only is treated as a value (not unset).
- **Invalidation**: `--no-cache` forces a fresh fetch and writes a new cache file. A malformed cache file (bad JSON, wrong shape) silently returns null and triggers a re-fetch (see `readCacheFromDisk` in the same file).
- **Schema shape**: `{ fetchedAt: ISO-8601, schema: {...} }` (`SchemaCache` in `src/core/freshness/types.ts`).

To invalidate the cache by hand:

```bash
rm ~/.cache/agent-smith/opencode-schema-cache.json
```

## Network footprint

Doctor's network surface is small and well-defined:

| Source | What it fetches | When |
|---|---|---|
| OpenCode upstream schema | One HTTPS GET to `https://opencode.ai/config.json` | Cache miss or `--no-cache`; suppressed by `--offline` |
| `opencode models` | One subprocess invocation | Only if `opencode` is on PATH and not `--skip-model-resolution`; suppressed by `AGENT_SMITH_DISABLE_LIVE_RESOLUTION=1` |
| Claude Code tool map | Nothing | Tool map is local (`data/claude-code-tool-map.json`) |
| Codex tool map | Nothing | Tool map is local (`data/codex-tool-map.json`) |
| `skill-drift` | Nothing | Hashes computed locally |
| `registry-hygiene` | Nothing | Local `git remote -v` only |
| `remote-catalogs` | Nothing | Reads recorded `lastPulledSha` / `lastRemoteSha` only — live drift detection requires `smith agent sync --check --all` |
| `duplicate-catalogs` | Nothing | Pure cluster on normalized URLs from registry files |
| `workspace` | One `git ls-remote` | Suppressed by `--offline` |

To run fully offline with no subprocess invocations:

```bash
smith doctor --offline --no-cache --skip-model-resolution
```

## Common drift remediations

| Drift | Remediation |
|---|---|
| `opencode` schema drift | `smith update` to pull the latest commits from `origin/main` (the vendored schema refresh ships there when upstream OpenCode changes). If drift persists after `smith update`, file an issue at https://github.com/eliharoun/agent-smith/issues. **Maintainers** (push access to `origin/main`): run `bun run refresh-schemas`, review the regenerated `data/opencode.config.schema.json`, update `CHANGELOG`/`MIGRATION` if any agent-facing fields changed, commit, push. |
| `claude-code` tool map drift | Update `data/claude-code-tool-map.json` manually (no upstream API to diff against). See `CONTRIBUTING.md`. |
| `codex` tool map drift | Update `data/codex-tool-map.json` manually. |
| `kiro` tool map / agent schema drift | Update `data/kiro-tool-map.json` and `data/kiro.agent-v1.schema.json` manually; bump `_meta.lastVerifiedDate`. |
| Stale model resolution (agent's `model:` literal not in live list) | `smith agent install-all` — re-resolves every agent's tier against the current `opencode models` output. |
| Stale curated fallback | Update `CURATED_FALLBACK_V0_6_0` in `src/core/model-resolution/types.ts`. |
| Skill drift (`drift` status) | `smith skill update <name>` — overwrites local edits with the source. |
| Skill `missing` (dest gone) | `smith skill update <name>` — same command, recreates the dest. |
| Skill `source-missing` (catalog gone) | Re-register the source catalog with `smith skill register <path>`, or remove the install record with `smith skill uninstall <name>`. |
| Agent drift (`drift` status) | `smith agent install <name>` — re-renders and overwrites the installed file. |
| Agent `missing` (installed file gone) | `smith agent install <name>` — same command, recreates the file. |
| Required-skill missing | `smith skill install <ref>` for each entry the report lists. |
| `atlassian-auth: missing` | Create `~/.config/agent-smith/.env` with `SMITH_ATLASSIAN_EMAIL` + `SMITH_ATLASSIAN_API_TOKEN`. See [guide/04-knowledge.md](./04-knowledge.md#atlassian-authenticated-sources). |
| `atlassian-auth: not-applicable` | No action needed — Atlassian credentials are not relevant because no `atlassian-skills` is installed and no agent has a Confluence/Jira knowledge source. |
| `registry-hygiene` warning: `rootPath does not exist` | `smith agent register <new-path>` then `smith agent unregister <old-path>`. See [guide/08-registries-and-catalogs.md](./08-registries-and-catalogs.md). |
| `registry-hygiene` warning: `gitRemote does not match` | `git remote add` the expected URL, or unregister and re-register without `--git-remote`. |

## Environment overrides

| Variable | Effect | Read at |
|---|---|---|
| `XDG_CACHE_HOME` | Base directory for the schema cache. Unset or empty falls back to `~/.cache`. | `src/cli/commands/doctor.ts` |
| `AGENT_SMITH_DISABLE_LIVE_RESOLUTION` | Set to `1` to disable the live `opencode models` query in the model-resolution section, forcing the curated-fallback path. Useful in CI sandboxes and when reproducing legacy resolution behavior. | `src/cli/commands/doctor.ts` |
| `SMITH_DEBUG` | Set to `1` (or `true`/`yes`) to surface defensive `try/catch` failures in the spinner UI to stderr, plus all other smith debug output. Off by default. Legacy `AGENT_SMITH_DEBUG` accepted as a deprecated alias; emits a one-shot stderr warning when used. | `src/cli/debug-flag.ts` |
| `NODE_ENV` | When set to `test`, allows the `_setSpawnForTesting` test seam in `src/io/opencode-models.ts`. Not for end users. | `src/io/opencode-models.ts` |

The atlassian-auth section also reads the credential env vars (`SMITH_ATLASSIAN_*`); see [guide/04-knowledge.md](./04-knowledge.md#atlassian-authenticated-sources) for the canonical 2-tier resolution.

## Caveats and gotchas

- **`workspace: unknown:network-error` does NOT bump the exit code.** This is an explicit exception — the workspace section is informational even when the underlying `git ls-remote` fails. Documented at `src/core/freshness/run-doctor.ts`. Network failures from the workspace check appear in the report but never affect `$?`.
- **Doctor is primarily read-only, with two repair flags.** Most drift requires the corresponding remediation command. The exceptions are `--fix-knowledge-refresh` (missing hooks, corrupt caches, orphaned consent) and `--fix-knowledge-compile` (re-runs `smith knowledge compile <agent>` for missing-manifest / drift findings on any bundle whose `compile-manifest.json` exists on disk or which explicitly opts in via `compile.progressive: true`). See [Flags](#flags).
- **The exit-code policy is asymmetric on purpose.** OpenCode schema (section 1) > model-resolution (section 5) > everything-else-is-informational. Skill drift, required-skills, registry-hygiene, atlassian-auth, and the Claude Code / Codex tool map sections cannot affect the exit code, no matter how many warnings they raise. If you want CI to fail on, say, missing required skills, parse the `--json` output and key on `agentRequiredSkills.status === "warn"`.
- **The default view is actionable-only.** Non-actionable findings (curated-fallback drift, unused Atlassian auth) render as a one-line summary in the default output; only sections with `warn` or `error` status auto-expand with full detail. Pass `--verbose` to see the full per-section report regardless of status.
- **The model-resolution section is auto-skipped when `opencode` is not on PATH.** The section is OpenCode-specific (it shells out to `opencode models` and inspects installed OpenCode agents). When OpenCode is absent, the section is omitted entirely and cannot affect the exit code. If you have OpenCode installed but still want to skip the section, pass `--skip-model-resolution`.
- **The `atlassian-skills` skill catalog is exempt from `registry-hygiene` checks** because it is lazy-cloned and may not exist on disk until first use (`run-doctor.ts`).
- **Failures from `getOpenCodeModels` are not memoized** for the lifetime of the process (`src/io/opencode-models.ts`). A transient failure during one doctor run does not poison subsequent runs in the same process — relevant for the daemon's 15-minute reinstall loop, less so for one-shot CLI invocations.
- **`skill-drift` checks only one dest path per skill.** The installer copies identical content to all platforms, so the report samples the first present dest in the order opencode → claude-code → codex → kiro. If the user edited only one platform's copy, the check might miss it.
- **`agent-required-skills` is name-only, not catalog-aware.** A required skill recorded as `the-architect/brainstorming` matches any installed skill named `brainstorming`, regardless of which catalog it came from. See [guide/05-skills.md](./05-skills.md#required-skills-requiresskills) for the canonical coverage.
- **The `--json` output is the contract.** The human-readable output may change between releases; the JSON shape is locked in `src/core/freshness/types.ts`.

## See also

- [guide/03-installing-and-rendering.md](./03-installing-and-rendering.md) — what the OpenCode schema check is validating, and how the model literal in each per-platform output gets there.
- [guide/05-skills.md](./05-skills.md) — canonical coverage of skill drift statuses, required-skill semantics, and the bundled `the-architect` and `the-keymaker` skills.
- [guide/07-models.md](./07-models.md) — model-resolution detail: tier → literal pipeline, curated fallback, `AGENT_SMITH_DISABLE_LIVE_RESOLUTION`.
- [guide/08-registries-and-catalogs.md](./08-registries-and-catalogs.md) — what `registry-hygiene` is checking, and how to register/unregister catalogs.
- [guide/09-daemon.md](./09-daemon.md) — the workspace section also reflects what the daemon's 15-minute git pull would see.
- [guide/11-update-and-uninstall.md](./11-update-and-uninstall.md) — `smith update` propagates doctor's exit code verbatim.
- [guide/12-error-handling.md](./12-error-handling.md) — canonical home for the global exit-code taxonomy and the troubleshooting recipes referenced above.
- [guide/14-cli-reference.md](./14-cli-reference.md) — terse reference for `smith doctor` synopsis, flags, exit codes.
