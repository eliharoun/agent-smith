// src/cli/commands/agent/sync.ts
//
// C3.11 (v1-task): `smith agent sync` — pull remote-catalog updates.
//
// Three modes:
//   sync <name>     → resolve <name> as catalog label or path → fetch+reset
//                     → update lastPulledSha + lastRemoteSha + timestamps
//   sync --check    → git ls-remote only; updates lastRemoteSha +
//                     lastCheckedAt; lastPulledSha untouched
//   sync --all      → iterate every remote-backed catalog; partial
//                     failures emit EXIT_PARTIAL rather than aborting
//
// The function is exported as `runAgentSync` (programmatic seam used by
// tests) and wired into Commander via register-commands.ts.

import { resolve } from "node:path";
import type { Source } from "../../../core/types";
import { cloneOrFetch, lsRemoteHead } from "../../../io/git-clone";
import { canonicalRegistryPath, loadRegistry, saveRegistry } from "../../../io/registry";
import { EXIT_OK, EXIT_PARTIAL, EXIT_RUNTIME, EXIT_USAGE } from "../../exit-codes";

export interface SyncOptions {
  /** Catalog label or path. Required unless `all` is true. */
  name?: string;
  /** Sync every remote-backed catalog. Mutually exclusive with `name`. */
  all?: boolean;
  /** ls-remote only; do not mutate working tree or lastPulledSha. */
  check?: boolean;
  /** Test seam — overrides registry path (rarely needed; XDG_CONFIG_HOME
   *  threading suffices for most tests). */
  registryPath?: string;
  /** Sinks for diagnostics. Default to console. */
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}

export async function runAgentSync(opts: SyncOptions): Promise<number> {
  const print = opts.print ?? ((m) => console.log(m));
  const printErr = opts.printErr ?? ((m) => console.error(m));

  if (!opts.name && !opts.all) {
    printErr("smith: 'agent sync' requires <name> or --all");
    return EXIT_USAGE;
  }
  if (opts.name && opts.all) {
    printErr("smith: 'agent sync' accepts <name> OR --all, not both");
    return EXIT_USAGE;
  }

  const registryPath = opts.registryPath ?? canonicalRegistryPath();
  const reg = await loadRegistry(registryPath);

  const targets = opts.all
    ? reg.sources.filter((s) => s.remote !== undefined)
    : reg.sources.filter((s) => s.remote !== undefined && matchesNameOrPath(s, opts.name!));

  // If `name` resolves to an imported-archive catalog, emit a friendly
  // advisory instead of the generic "no remote-backed catalog matches"
  // usage error. Imported archives have no upstream to pull from; the
  // recipient updates them by re-importing a fresh artifact.
  if (opts.name && targets.length === 0) {
    const importedHit = reg.sources.find(
      (s) => s.importedArchive !== undefined && matchesNameOrPath(s, opts.name!),
    );
    if (importedHit) {
      print(
        `${importedHit.label}: imported from archive — re-run \`smith agent install --from <new-artifact>\` to update.`,
      );
      return EXIT_OK;
    }
  }

  if (targets.length === 0) {
    if (opts.all) {
      printErr("smith: no remote-backed catalogs registered (nothing to sync)");
    } else {
      const remoteLabels = reg.sources.filter((s) => s.remote !== undefined).map((s) => s.label);
      const hint =
        remoteLabels.length === 0
          ? "  no remote-backed catalogs are registered yet"
          : `  registered remote catalogs: ${remoteLabels.join(", ")}`;
      printErr(
        [
          `smith: no remote-backed catalog matches '${opts.name}'`,
          "  '<name>' must be a CATALOG label (or its rootPath), not a bundle name.",
          hint,
        ].join("\n"),
      );
    }
    return EXIT_USAGE;
  }

  let successes = 0;
  let failures = 0;
  for (const source of targets) {
    try {
      if (opts.check) {
        const sha = await lsRemoteHead({
          url: source.remote!.url,
          ref: source.remote!.ref,
        });
        const now = new Date().toISOString();
        source.remote = {
          ...source.remote!,
          lastRemoteSha: sha,
          lastCheckedAt: now,
        };
        print(`smith: ${source.label} → remote at ${sha.slice(0, 8)}`);
      } else {
        const result = await cloneOrFetch({
          url: source.remote!.url,
          ref: source.remote!.ref,
          targetDir: source.rootPath,
        });
        const now = new Date().toISOString();
        source.remote = {
          ...source.remote!,
          lastPulledSha: result.sha,
          lastPulledAt: now,
          lastRemoteSha: result.sha,
          lastCheckedAt: now,
        };
        print(`smith: ${source.label} synced to ${result.sha.slice(0, 8)}`);
      }
      successes++;
    } catch (err) {
      printErr(`smith: sync ${source.label} failed: ${(err as Error).message}`);
      failures++;
    }
  }

  // Always persist whatever progress we made — successful syncs in a
  // partial-failure run still need their lastPulledSha/Remote updates.
  await saveRegistry(registryPath, reg);

  if (failures === 0) return EXIT_OK;
  if (successes === 0) return EXIT_RUNTIME;
  return EXIT_PARTIAL;
}

/**
 * Match a registered Source against a user-supplied identifier.
 *
 * Two-pass resolution (more forgiving than resolveCatalogArg in
 * register-commands.ts:86): try an exact label match first, then fall
 * back to treating the value as a path and comparing against rootPath.
 * Label-first handles the common case where the auto-derived label
 * contains `/` (e.g. "owner/repo" from a git URL), which the
 * starts-with-/ heuristic would mis-route to the path branch.
 */
function matchesNameOrPath(source: Source, value: string): boolean {
  if (source.label === value) return true;
  return source.rootPath === resolve(value);
}
