// Factory for the `smith agent <verb>` command group. Pulled out of
// src/index.ts so tests can mount the same wiring on a fresh Commander
// program, matching the pattern used by registerSkillInstallCommands.
//
// Implementation files for each verb stay at their original
// src/cli/commands/<verb>.ts paths — only the Commander surface relocates.
// This keeps `git blame` useful and minimizes diff churn.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Command, Option } from "commander";
import { stateHome } from "../../../io/state-home";
import { initAgent } from "../init-agent";
import { install } from "../install";
import { installAll } from "../install-all";
import { list } from "../list";
import { register } from "../register";
import { unregister } from "../unregister";
import { validate } from "../validate";
import { parseInitAgentFlags } from "../../parse-init-agent-flags";
import { wrap, type WrapDeps } from "../../wrap";
import {
  canonicalRegistryPath,
  canonicalUserPath,
  loadRegistry,
  type Registry,
} from "../../../io/registry";
import { PLATFORM_IDS, type PlatformId } from "../../../io/platform-detect";
import { SmithError } from "../../../core/smith-error";
import type { Source, SourceKind } from "../../../core/types";
import { agentCatalogs } from "./catalogs";

/**
 * Parse a comma-separated `--grant`/`--revoke` value into a validated
 * `PlatformId[]`. Each entry is checked against {@link PLATFORM_IDS};
 * invalid ids throw `SmithError(usage-error)` at CLI parse time so the
 * caller sees a clean error before any downstream work begins.
 *
 * Returns `[]` for `undefined` or empty input. Whitespace around entries
 * is trimmed; empty splits ("a,,b") are dropped.
 *
 * Note: `reconfigureAgent` performs the same validation as a
 * defense-in-depth check for programmatic callers that bypass the CLI —
 * do not remove it.
 */
function parsePlatformList(value: string | undefined): PlatformId[] {
  if (value === undefined || value === "") return [];
  const out: PlatformId[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (entry.length === 0) continue;
    if (!(PLATFORM_IDS as readonly string[]).includes(entry)) {
      throw new SmithError({
        code: "usage-error",
        message: `invalid platform '${entry}' (expected one of: ${PLATFORM_IDS.join(", ")})`,
      });
    }
    out.push(entry as PlatformId);
  }
  return out;
}

export interface RegisterAgentCommandsOpts {
  /**
   * Test seam: override `wrap()`'s deps for action handlers registered
   * here. In particular, tests that drive these subcommands via
   * `program.parseAsync(...)` need `rethrow: true` (and an `exit` no-op)
   * so the bun-test process isn't killed mid-suite and the original
   * SmithError surfaces for assertion. Production callers leave unset.
   */
  wrapDepsOverride?: WrapDeps;
}

/**
 * Resolve a `--catalog` argument (label or path) against an agent
 * registry. Returns the matching {@link Source} or throws a
 * `SmithError(not-found)`.
 *
 * Resolution rules:
 *   - If the value starts with `/`, `.`, or contains a `/`, treat it as
 *     a path. Resolve it to an absolute path and look up by `rootPath`.
 *   - Otherwise treat it as a label and look up by exact label match.
 *
 * Exported for unit testing.
 */
export function resolveCatalogArg(value: string, registry: Registry): Source {
  const looksLikePath = value.startsWith("/") || value.startsWith(".") || value.includes("/");
  let matched: Source | undefined;
  if (looksLikePath) {
    const abs = resolve(value);
    matched = registry.sources.find((s) => s.rootPath === abs);
  } else {
    matched = registry.sources.find((s) => s.label === value);
  }
  if (!matched) {
    throw new SmithError({
      code: "not-found",
      what: "agent catalog",
      identifier: value,
      suggestedCommand: "smith agent catalogs",
    });
  }
  return matched;
}

export function registerAgentCommands(parent: Command, opts: RegisterAgentCommandsOpts = {}): void {
  const wrapDeps = opts.wrapDepsOverride;
  parent
    .command("init <name>")
    .description("Scaffold a new agent bundle")
    .option("--description <text>", "One-line description of the agent")
    .option("--targets <list>", "Comma-separated targets: opencode,claude-code,codex,kiro")
    .option(
      "--model-tier <tier>",
      "high | balanced | fast | inherit (aliases: opus, sonnet, haiku)",
    )
    .option("--mode <mode>", "primary | subagent | all")
    .option("--permission <preset>", "Permission preset: read-only | read-edit | full")
    .option("--permission-json <json>", "Custom permission as JSON (overrides --permission)")
    .option("--mcp-servers <list>", "Comma-separated MCP server names")
    .option("--skills <list>", "Comma-separated skill names")
    .option(
      "--requires-skills <list>",
      "Comma-separated skills the agent requires to be installed (each entry: name OR catalog/name)",
    )
    .option("--from <source>", "Clone an existing bundle")
    .option(
      "--from-apm <path>",
      "Import a Microsoft APM bundle (apm.yml) as the starting point",
    )
    .option(
      "--catalog <labelOrPath>",
      "Scaffold into a registered agent catalog (by label or path). Default: user-global.",
    )
    .action(
      wrap("agent init", async (name: string, raw: Record<string, string | undefined>) => {
        const opts = parseInitAgentFlags(raw);

        // Default scaffold target is the user-global catalog. When
        // --catalog is set, resolve it against the registry and override.
        let agentsDir = join(stateHome(), "agents");
        let catalogKind: SourceKind = "user-global";

        if (raw.catalog !== undefined) {
          const registry = await loadRegistry(canonicalRegistryPath());
          const matched = resolveCatalogArg(raw.catalog, registry);
          agentsDir = matched.rootPath;
          catalogKind = matched.kind;
        }

        return await initAgent(name, opts, {
          agentsDir,
          canonicalUserPath: canonicalUserPath(),
          examplesDir: join(
            dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
            "..",
            "..",
            "examples",
          ),
          catalogKind,
          ...(raw.from ? { from: raw.from } : {}),
          ...(raw.fromApm ? { fromApm: raw.fromApm } : {}),
        });
      }),
    );

  parent
    .command("register <path>")
    .description("Register an agent catalog directory")
    .addOption(
      new Option("--kind <kind>", "user-global | project | registered")
        .choices(["user-global", "project", "registered"])
        .makeOptionMandatory(true),
    )
    .option("--label <label>", "Display label")
    .option("--git-remote <url>", "Git remote (for kind=registered)")
    .option("--allow-empty", "Register even if the path contains no agent bundles")
    .option("--skip-git-check", "Bypass git-repo and remote-URL validation")
    .action(
      wrap(
        "agent register",
        (
          path: string,
          opts: {
            kind: import("../register").RegisterOptions["kind"];
            label?: string;
            gitRemote?: string;
            allowEmpty?: boolean;
            skipGitCheck?: boolean;
          },
        ) =>
          register(path, {
            kind: opts.kind,
            ...(opts.label !== undefined ? { label: opts.label } : {}),
            ...(opts.gitRemote !== undefined ? { gitRemote: opts.gitRemote } : {}),
            ...(opts.allowEmpty !== undefined ? { allowEmpty: opts.allowEmpty } : {}),
            ...(opts.skipGitCheck !== undefined ? { skipGitCheck: opts.skipGitCheck } : {}),
          }),
      ),
    );

  parent
    .command("unregister <path>")
    .description("Remove a registered agent catalog. Path is normalized like `register`.")
    .option(
      "--purge-clone",
      "Also delete the on-disk clone (only allowed for catalogs under <stateHome>/remote) [v1-task C3.13]",
    )
    .action(
      wrap("agent unregister", (path: string, opts: { purgeClone?: boolean }) =>
        unregister(path, opts.purgeClone ? { purgeClone: true } : {}),
      ),
    );

  parent.command("list").description("List all known agents").action(wrap("agent list", list));

  parent
    .command("catalogs")
    .description("List registered agent catalogs")
    .action(wrap("agent catalogs", () => agentCatalogs()));

  parent
    .command("validate [name]")
    .description("Validate one or all agents")
    .action(wrap("agent validate", validate));

  parent
    .command("install [name]")
    .description("Build and install an agent to its targets")
    .option("--yes", "Auto-accept prompts (including required-skill installs)")
    .option("--with-skills", "Auto-install required skills without prompting")
    .option("--no-skills", "Skip required-skill installs (warn instead)")
    .option("--no-refresh-hooks", "Skip refresh hook installation (refresh becomes manual-only)")
    .option("--refresh-consent <yn>", "Pre-answer the refresh consent prompt (yes|no)")
    .option(
      "--platforms <list>",
      "Comma-separated list of platforms to install to (subset of agent's declared targets)",
    )
    .option(
      "--allow-missing-mcp",
      "Demote missing-MCP-server errors to warnings (v1: install blocks by default)",
    )
    .option(
      "--allow-missing-cli",
      "Render targets whose platform CLI is absent (emit tier literal + warning) instead of failing",
    )
    .option(
      "--from <url>",
      "Clone an external git repo containing the bundle, register it, then install. Skips local lookup. (v1-task C3.9)",
    )
    .option(
      "--ref <ref>",
      "Git branch/tag/SHA to clone with --from. Defaults to the remote's HEAD.",
    )
    .option("--all", "install every agent discovered in --from <url>")
    .option("--agents <list>", "comma-separated agents to install from --from <url>")
    .option("--json", "discover agents from --from <url>, print JSON, do not install")
    .option(
      "--force",
      "Overwrite a pre-existing destination file that smith doesn't recognize as its own (would-clobber bypass)",
    )
    .option(
      "--platform-conventions <strategy>",
      "Platform conventions strategy (accept-all|reject-all|use-defaults|prompt)",
    )
    .option(
      "--no-platform-conventions",
      "Alias for --platform-conventions=reject-all (this run only; doesn't persist)",
    )
    .option("--verbose", "Show info-level warnings (pattern fallbacks, platform truisms)")
    .action(
      wrap(
        "agent install",
        async (
          name: string | undefined,
          opts: {
            yes?: boolean;
            withSkills?: boolean;
            skills?: boolean;
            refreshHooks?: boolean;
            refreshConsent?: string;
            platforms?: string;
            allowMissingMcp?: boolean;
            allowMissingCli?: boolean;
            from?: string;
            ref?: string;
            all?: boolean;
            agents?: string;
            json?: boolean;
            force?: boolean;
            platformConventions?: string | false;
            verbose?: boolean;
          },
        ) => {
          // --from supersedes the "missing name" early-error: the install
          // verb will infer the bundle name from the cloned repo when
          // exactly one bundle is found, and emit a disambiguation hint
          // otherwise.
          if (!name && !opts.from) {
            const { installBareHelpfulError } = await import("../install");
            await installBareHelpfulError();
            return 2;
          }
          let skillMode: import("../../../io/install-required-skills").InstallRequiredSkillsMode =
            "prompt";
          if (opts.skills === false) skillMode = "no-skills";
          else if (opts.yes || opts.withSkills) skillMode = "with-skills";
          const { parseRefreshConsent, resolveInstallRefreshConsent } = await import(
            "../../parse-refresh-consent"
          );
          const explicit = parseRefreshConsent(opts.refreshConsent);
          // v1-task B1: --yes cascades into refresh-consent unless the
          // user explicitly passed --refresh-consent, in which case the
          // explicit flag wins. See resolveInstallRefreshConsent.
          const refreshConsent = resolveInstallRefreshConsent({ yes: opts.yes, explicit });
          const { parsePlatforms } = await import("../../parse-platforms");
          const platformFilter = parsePlatforms(opts.platforms);
          // Parse --platform-conventions / --no-platform-conventions.
          // Commander turns --no-platform-conventions into `false`; we
          // translate that to the explicit reject-all strategy.
          const { parsePlatformConventions } = await import(
            "../../parse-platform-conventions"
          );
          const conventionsStrategy =
            opts.platformConventions === false
              ? ("reject-all" as const)
              : parsePlatformConventions(
                  typeof opts.platformConventions === "string"
                    ? opts.platformConventions
                    : undefined,
                );
          return install({
            ...(name ? { name } : {}),
            skillMode,
            noRefreshHooks: opts.refreshHooks === false,
            ...(refreshConsent !== undefined ? { refreshConsent } : {}),
            ...(platformFilter ? { platformFilter } : {}),
            ...(opts.allowMissingMcp ? { allowMissingMcp: true } : {}),
            ...(opts.allowMissingCli ? { allowMissingCli: true } : {}),
            ...(opts.from ? { from: opts.from } : {}),
            ...(opts.ref ? { ref: opts.ref } : {}),
            ...(opts.all ? { all: true } : {}),
            ...(opts.agents ? { agents: opts.agents } : {}),
            ...(opts.json ? { json: true } : {}),
            ...(opts.force ? { force: true } : {}),
            ...(conventionsStrategy ? { platformConventions: conventionsStrategy } : {}),
            ...(opts.verbose ? { verbose: true } : {}),
          });
        },
      ),
    );

  parent
    .command("install-all")
    .description("Build and install every known agent")
    .option("--yes", "Auto-accept prompts (including required-skill installs)")
    .option("--with-skills", "Auto-install required skills without prompting)")
    .option("--no-skills", "Skip required-skill installs (warn instead)")
    .option("--refresh-consent <yn>", "Pre-answer the refresh consent prompt (yes|no)")
    .option("--platforms <list>", "Comma-separated list of platforms to install to")
    .option(
      "--allow-missing-mcp",
      "Demote missing-MCP-server errors to warnings (v1: install blocks by default)",
    )
    .option(
      "--allow-missing-cli",
      "Render targets whose platform CLI is absent (emit tier literal + warning) instead of failing",
    )
    .option(
      "--force",
      "Overwrite pre-existing destination files that smith doesn't recognize as its own",
    )
    .option(
      "--platform-conventions <strategy>",
      "Platform conventions strategy (accept-all|reject-all|use-defaults|prompt)",
    )
    .option(
      "--no-platform-conventions",
      "Alias for --platform-conventions=reject-all (this run only)",
    )
    .action(
      wrap(
        "agent install-all",
        async (opts: {
          yes?: boolean;
          withSkills?: boolean;
          skills?: boolean;
          refreshConsent?: string;
          platforms?: string;
          allowMissingMcp?: boolean;
          allowMissingCli?: boolean;
          force?: boolean;
          platformConventions?: string | false;
        }) => {
          let skillMode: import("../../../io/install-required-skills").InstallRequiredSkillsMode =
            "prompt";
          if (opts.skills === false) skillMode = "no-skills";
          else if (opts.yes || opts.withSkills) skillMode = "with-skills";
          const { parseRefreshConsent, resolveInstallRefreshConsent } = await import(
            "../../parse-refresh-consent"
          );
          const explicit = parseRefreshConsent(opts.refreshConsent);
          const refreshConsent = resolveInstallRefreshConsent({ yes: opts.yes, explicit });
          const { parsePlatforms } = await import("../../parse-platforms");
          const platformFilter = parsePlatforms(opts.platforms);
          const { parsePlatformConventions } = await import(
            "../../parse-platform-conventions"
          );
          const conventionsStrategy =
            opts.platformConventions === false
              ? ("reject-all" as const)
              : parsePlatformConventions(
                  typeof opts.platformConventions === "string"
                    ? opts.platformConventions
                    : undefined,
                );
          return installAll({
            skillMode,
            ...(refreshConsent !== undefined ? { refreshConsent } : {}),
            ...(platformFilter ? { platformFilter } : {}),
            ...(opts.allowMissingMcp ? { allowMissingMcp: true } : {}),
            ...(opts.allowMissingCli ? { allowMissingCli: true } : {}),
            ...(opts.force ? { force: true } : {}),
            ...(conventionsStrategy
              ? { platformConventions: conventionsStrategy }
              : {}),
          });
        },
      ),
    );

  parent
    .command("uninstall <name>")
    .description("Remove an installed agent from all targets it was installed to")
    .option("--dry-run", "Preview without removing files")
    .option("--yes", "Auto-accept any prompts (currently a no-op; reserved for future use)")
    .option("--platforms <list>", "Comma-separated list of platforms to uninstall from")
    .option(
      "--force",
      "Delete a smith-installed file even if it has been modified externally (hash-mismatch bypass)",
    )
    .action(
      wrap(
        "agent uninstall",
        async (
          name: string,
          opts: {
            dryRun?: boolean;
            yes?: boolean;
            platforms?: string;
            force?: boolean;
          },
        ) => {
          const { runUninstallCli } = await import("../uninstall");
          const { parsePlatforms } = await import("../../parse-platforms");
          const platformFilter = parsePlatforms(opts.platforms);
          return runUninstallCli({
            name,
            ...(opts.dryRun ? { dryRun: true } : {}),
            ...(platformFilter ? { platformFilter } : {}),
            ...(opts.force ? { force: true } : {}),
          });
        },
      ),
    );

  parent
    .command("uninstall-all")
    .description("Remove every registered agent from all targets")
    .option("--dry-run", "Preview without removing files")
    .option("--yes", "Skip the confirmation prompt")
    .option("--platforms <list>", "Comma-separated list of platforms to uninstall from")
    .option(
      "--force",
      "Delete smith-installed files even if any have been modified externally (hash-mismatch bypass)",
    )
    .action(
      wrap(
        "agent uninstall-all",
        async (opts: {
          dryRun?: boolean;
          yes?: boolean;
          platforms?: string;
          force?: boolean;
        }) => {
          const { runUninstallAllCli } = await import("../uninstall-all");
          const { parsePlatforms } = await import("../../parse-platforms");
          const platformFilter = parsePlatforms(opts.platforms);
          return runUninstallAllCli({
            ...(opts.dryRun ? { dryRun: true } : {}),
            ...(opts.yes ? { yes: true } : {}),
            ...(platformFilter ? { platformFilter } : {}),
            ...(opts.force ? { force: true } : {}),
          });
        },
      ),
    );

  parent
    .command("reconfigure <name>")
    .description(
      "Grant or revoke refresh hooks for an installed agent (interactive when no flags + TTY)",
    )
    .option("--grant <list>", "Comma-separated platforms to grant refresh hooks for")
    .option("--revoke <list>", "Comma-separated platforms to revoke refresh hooks for")
    .option(
      "--yes",
      "Grant refresh hooks for every platform the agent is installed for (non-interactive)",
    )
    .action(
      wrap(
        "agent reconfigure",
        async (name: string, opts: { grant?: string; revoke?: string; yes?: boolean }) => {
          const { SmithError } = await import("../../../core/smith-error");
          const { reconfigureAgent } = await import("./reconfigure");
          const { PLATFORM_IDS } = await import("../../../io/platform-detect");

          // --yes: grant every platform the agent is installed for.
          // Resolved entirely in the action handler (kept out of
          // reconfigureAgent's signature) by enumerating installed
          // platforms and passing them as --grant.
          if (opts.yes && opts.grant === undefined && opts.revoke === undefined) {
            const { stat } = await import("node:fs/promises");
            const { defaultInstallPaths } = await import("../../install-paths");
            const { join } = await import("node:path");
            const paths = defaultInstallPaths();
            const installed: import("../../../io/platform-detect").PlatformId[] = [];
            for (const p of PLATFORM_IDS) {
              const candidate =
                p === "codex" ? join(paths.codex, name, "SKILL.md") : join(paths[p], `${name}.md`);
              try {
                await stat(candidate);
                installed.push(p);
              } catch {
                // Not installed for this platform — skip.
              }
            }
            if (installed.length === 0) {
              throw new SmithError({
                code: "not-found",
                what: "agent installation",
                identifier: name,
                suggestedCommand: `smith agent install ${name}`,
              });
            }
            await reconfigureAgent(name, { grant: installed, revoke: [] });
            return 0;
          }

          // Bare invocation (neither flag, no --yes) → interactive flow
          // when TTY, usage-error when not. The TTY/non-TTY decision is
          // pushed into reconfigureAgent so the same code path handles
          // both — keeps the policy single-sourced.
          if (opts.grant === undefined && opts.revoke === undefined) {
            // Non-TTY guard mirrors install.ts:226 conventions. We check
            // here so we can produce a usage-error with --grant/--revoke
            // hints (matching the pre-B1 behavior), rather than the
            // generic "interactive requires a TTY" message that
            // reconfigureAgent emits when called with interactive:true
            // in non-TTY.
            if (!process.stdin.isTTY) {
              throw new SmithError({
                code: "usage-error",
                message: "must pass --grant <list> and/or --revoke <list>",
                suggestedCommand: `smith agent reconfigure ${name} --grant opencode`,
              });
            }
            await reconfigureAgent(name, { grant: [], revoke: [], interactive: true });
            return 0;
          }
          await reconfigureAgent(name, {
            grant: parsePlatformList(opts.grant),
            revoke: parsePlatformList(opts.revoke),
          });
          return 0;
        },
        wrapDeps,
      ),
    );

  parent
    .command("destroy <name>")
    .description(
      "Remove a user-global agent bundle (created by 'agent init') and its rendered files",
    )
    .option("--dry-run", "Preview without removing anything")
    .option("--yes", "Skip the typed-token confirmation")
    .option("--force", "Also uninstall rendered files if any are still installed")
    .action(
      wrap(
        "agent destroy",
        async (name: string, opts: { dryRun?: boolean; yes?: boolean; force?: boolean }) => {
          const { runDestroyAgentCli } = await import("../destroy-agent");
          return runDestroyAgentCli({
            name,
            ...(opts.dryRun ? { dryRun: true } : {}),
            ...(opts.yes ? { yes: true } : {}),
            ...(opts.force ? { force: true } : {}),
          });
        },
      ),
    );

  parent
    .command("sync [name]")
    .description("Pull updates for one or all remote-backed agent catalogs (v1-task C3.11)")
    .option("--all", "Sync every remote-backed catalog")
    .option("--check", "Only probe remote HEAD (git ls-remote); do not touch working tree")
    .action(
      wrap(
        "agent sync",
        async (name: string | undefined, opts: { all?: boolean; check?: boolean }) => {
          const { runAgentSync } = await import("./sync");
          return runAgentSync({
            ...(name ? { name } : {}),
            ...(opts.all ? { all: true } : {}),
            ...(opts.check ? { check: true } : {}),
          });
        },
        wrapDeps,
      ),
    );
}
