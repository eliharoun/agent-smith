// src/cli/commands/skill/sync.ts
//
// C3.12 (v1-task): `smith skill sync` — mirror of `agent sync` (C3.11).
// Pulls remote-catalog updates for skill catalogs.
//
// Same three modes as the agent variant:
//   sync <name>     → resolve <name> as catalog label or path → fetch+reset
//   sync --check    → git ls-remote only; lastRemoteSha + lastCheckedAt
//   sync --all      → iterate every remote-backed skill catalog
//
// Cross-reference: src/cli/commands/agent/sync.ts. The two files are
// deliberately parallel rather than abstracted into a single core helper
// — they read from and write to different registries (registry.json vs
// skill-catalogs.json) and a shared helper would require either a
// closure-over-registry-fns or a tagged-union dispatch, both of which
// obscure the simple per-catalog loop. If a third sync variant ever
// appears, revisit.

import { resolve } from "node:path";
import { cloneOrFetch, lsRemoteHead } from "../../../io/git-clone";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  saveSkillRegistry,
  type SkillCatalog,
} from "../../../io/skill-registry";
import { EXIT_OK, EXIT_PARTIAL, EXIT_RUNTIME, EXIT_USAGE } from "../../exit-codes";

export interface SkillSyncOptions {
  name?: string;
  all?: boolean;
  check?: boolean;
  registryPath?: string;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}

export async function runSkillSync(opts: SkillSyncOptions): Promise<number> {
  const print = opts.print ?? ((m) => console.log(m));
  const printErr = opts.printErr ?? ((m) => console.error(m));

  if (!opts.name && !opts.all) {
    printErr("smith: 'skill sync' requires <name> or --all");
    return EXIT_USAGE;
  }
  if (opts.name && opts.all) {
    printErr("smith: 'skill sync' accepts <name> OR --all, not both");
    return EXIT_USAGE;
  }

  const registryPath = opts.registryPath ?? canonicalSkillRegistryPath();
  const reg = await loadSkillRegistry(registryPath);

  const targets = opts.all
    ? reg.catalogs.filter((c) => c.remote !== undefined)
    : reg.catalogs.filter(
        (c) => c.remote !== undefined && matchesNameOrPath(c, opts.name!),
      );

  if (targets.length === 0) {
    if (opts.all) {
      printErr("smith: no remote-backed skill catalogs registered (nothing to sync)");
    } else {
      const remoteLabels = reg.catalogs
        .filter((c) => c.remote !== undefined)
        .map((c) => c.label);
      const hint =
        remoteLabels.length === 0
          ? "  no remote-backed skill catalogs are registered yet"
          : `  registered remote skill catalogs: ${remoteLabels.join(", ")}`;
      printErr(
        [
          `smith: no remote-backed skill catalog matches '${opts.name}'`,
          "  '<name>' must be a CATALOG label (or its rootPath), not a skill name.",
          hint,
        ].join("\n"),
      );
    }
    return EXIT_USAGE;
  }

  let successes = 0;
  let failures = 0;
  for (const catalog of targets) {
    try {
      if (opts.check) {
        const sha = await lsRemoteHead({
          url: catalog.remote!.url,
          ref: catalog.remote!.ref,
        });
        const now = new Date().toISOString();
        catalog.remote = {
          ...catalog.remote!,
          lastRemoteSha: sha,
          lastCheckedAt: now,
        };
        print(`smith: ${catalog.label} → remote at ${sha.slice(0, 8)}`);
      } else {
        const result = await cloneOrFetch({
          url: catalog.remote!.url,
          ref: catalog.remote!.ref,
          targetDir: catalog.rootPath,
        });
        const now = new Date().toISOString();
        catalog.remote = {
          ...catalog.remote!,
          lastPulledSha: result.sha,
          lastPulledAt: now,
          lastRemoteSha: result.sha,
          lastCheckedAt: now,
        };
        print(`smith: ${catalog.label} synced to ${result.sha.slice(0, 8)}`);
      }
      successes++;
    } catch (err) {
      printErr(
        `smith: sync ${catalog.label} failed: ${(err as Error).message}`,
      );
      failures++;
    }
  }

  await saveSkillRegistry(registryPath, reg);

  if (failures === 0) return EXIT_OK;
  if (successes === 0) return EXIT_RUNTIME;
  return EXIT_PARTIAL;
}

function matchesNameOrPath(catalog: SkillCatalog, value: string): boolean {
  if (catalog.label === value) return true;
  return catalog.rootPath === resolve(value);
}
