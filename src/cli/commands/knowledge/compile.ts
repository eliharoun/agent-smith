import pc from "picocolors";
import { runKnowledgeStage } from "../../../core/knowledge/pipeline";
import { SmithError } from "../../../core/smith-error";
import { toMessage } from "../../../core/to-message";
import type { AgentBundle } from "../../../core/types";
import { cacheDirFor, type KnowledgePaths, knowledgeDirFor } from "../../../io/knowledge-paths";
import { canonicalRegistryPath, loadRegistry } from "../../../io/registry";
import { defaultKnowledgePaths } from "../../install-paths";
import { findBundleOrFail, loadAllBundles, warnAllLoadFailures } from "../../load-all";

/**
 * Dependency-injection seams for `runKnowledgeCompile`. Production callers
 * omit these; tests pass `loadBundle` + `listAllBundles` to feed in-memory
 * fixtures without writing a registry file.
 *
 * `loadBundle(name)` resolves a single bundle by config name. Returns `null`
 * when the agent is not registered (so the CLI surfaces a `not-found`).
 *
 * `listAllBundles()` returns every loadable bundle. Used by `--all`. The
 * default reads `registry.json` and walks every catalog via the same
 * `loadAllBundles` pipeline that `agent install-all` uses.
 */
export interface KnowledgeCompileDeps {
  paths?: KnowledgePaths;
  loadBundle?: (name: string) => Promise<AgentBundle | null>;
  listAllBundles?: () => Promise<AgentBundle[]>;
}

export interface KnowledgeCompileOptions extends KnowledgeCompileDeps {
  name?: string;
  all?: boolean;
}

/**
 * `smith knowledge compile [name] [--all]`
 *
 * Re-runs the knowledge pipeline for one or every bundle that opts in to
 * progressive compile (`knowledge.compile.progressive: true`) and persists
 * `compile-manifest.json` under the agent's knowledge dir.
 *
 * Exit codes follow agent-smith conventions:
 *   - 0  success (every targeted bundle compiled, or `--all` had at least one)
 *   - 1  runtime error during compile
 *   - 2  usage error — bundle has no `compile.progressive=true`
 *
 * `--all` skips bundles without a compile block (with a warn line) and only
 * elevates to a non-zero exit code when EVERY bundle was skipped.
 */
export async function runKnowledgeCompile(
  opts: KnowledgeCompileOptions,
): Promise<number> {
  if (!opts.name && !opts.all) {
    throw new SmithError({
      code: "usage-error",
      message: "smith knowledge compile requires <name> or --all",
      suggestedCommand: "smith knowledge compile <name>",
    });
  }
  if (opts.name && opts.all) {
    throw new SmithError({
      code: "usage-error",
      message: "smith knowledge compile: pass <name> or --all, not both",
      suggestedCommand: "smith knowledge compile --all",
    });
  }

  const paths = opts.paths ?? defaultKnowledgePaths();
  const loadOne = opts.loadBundle ?? defaultLoadBundle;
  const listAll = opts.listAllBundles ?? defaultListAllBundles;

  const bundles: AgentBundle[] = opts.all
    ? await listAll()
    : await (async () => {
        const b = await loadOne(opts.name as string);
        if (!b) {
          throw new SmithError({
            code: "not-found",
            what: "agent",
            identifier: opts.name as string,
            suggestedCommand: `smith agent init ${opts.name}`,
          });
        }
        return [b];
      })();

  let exitCode = 0;
  let compiledCount = 0;
  let skippedCount = 0;

  for (const bundle of bundles) {
    const name = bundle.config.name;
    const block = bundle.config.knowledge;
    if (!block?.compile?.progressive) {
      // Single-name path: this is a usage error — caller should add the block.
      // --all path: skip silently with a warn so a mixed catalog still works.
      if (opts.all) {
        console.warn(
          pc.yellow(
            `skip ${name}: no knowledge.compile.progressive=true`,
          ),
        );
        skippedCount += 1;
        continue;
      }
      console.error(
        `${name}: no knowledge.compile.progressive=true in agent.config.json — add it to enable progressive compile.`,
      );
      console.error(
        `  Edit agent.config.json under "knowledge" and add:`,
      );
      console.error(`    "compile": { "progressive": true }`);
      return 2;
    }

    try {
      const result = await runKnowledgeStage(block, {
        bundleDir: bundle.bundlePath,
        knowledgeDir: knowledgeDirFor(name, paths),
        cacheDir: cacheDirFor(name, paths),
      });
      if (result.errors.length > 0) {
        for (const e of result.errors) console.error(pc.red(`  error: ${e}`));
        exitCode = Math.max(exitCode, 1);
        continue;
      }
      if (!result.compiled) {
        console.error(
          pc.red(`${name}: compile produced no output (compile block ignored?)`),
        );
        exitCode = Math.max(exitCode, 1);
        continue;
      }
      const m = result.compiled.manifest;
      console.log(
        pc.green(
          `compiled ${name}: ${m.totals.sourcesShown} source(s), ${m.totals.tocLines} TOC line(s), hash ${m.contentHash.slice(0, 8)}`,
        ),
      );
      for (const w of result.warnings) console.warn(pc.yellow(`  warn: ${w}`));
      compiledCount += 1;
    } catch (err) {
      if (err instanceof SmithError) throw err;
      console.error(pc.red(`${name}: compile failed: ${toMessage(err)}`));
      exitCode = Math.max(exitCode, 1);
    }
  }

  if (opts.all && compiledCount === 0) {
    // Every targeted bundle was skipped — surface a usage hint so the user
    // knows --all matched nothing actionable.
    if (skippedCount > 0) {
      console.error(
        `no bundles had knowledge.compile.progressive=true; ` +
          `add it to at least one agent.config.json to enable progressive compile.`,
      );
      return 2;
    }
    console.log(pc.dim("no agents registered"));
  }

  return exitCode;
}

/**
 * Default `loadBundle`: walks the registry and matches by config name. Mirrors
 * the resolution path used by `smith agent install <name>` so behaviour stays
 * in lockstep — same registry, same catalog walk, same load-failure surface.
 */
async function defaultLoadBundle(name: string): Promise<AgentBundle | null> {
  const reg = await loadRegistry(canonicalRegistryPath());
  const all = await loadAllBundles(reg);
  warnAllLoadFailures(all.failures, (m) => console.error(m));
  try {
    return findBundleOrFail(all, name);
  } catch (err) {
    if (err instanceof SmithError && err.payload.code === "not-found") return null;
    throw err;
  }
}

/**
 * Default `listAllBundles`: every loadable bundle in the registry, mirroring
 * `installAll()` (src/cli/commands/install-all.ts). Load failures are warned
 * to stderr but do not abort the run — `--all` is best-effort across catalogs.
 */
async function defaultListAllBundles(): Promise<AgentBundle[]> {
  const reg = await loadRegistry(canonicalRegistryPath());
  const all = await loadAllBundles(reg);
  warnAllLoadFailures(all.failures, (m) => console.error(m));
  return all.bundles;
}
