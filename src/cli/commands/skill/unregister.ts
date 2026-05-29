import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import pc from "picocolors";
import { SmithError } from "../../../core/smith-error";
import { assertSafeToPurgeClone } from "../../../io/clone-purge-guard";
import {
  canonicalSkillRegistryPath,
  loadSkillRegistry,
  removeCatalog,
  saveSkillRegistry,
} from "../../../io/skill-registry";

export interface SkillUnregisterPaths {
  /** Override for tests. Defaults to canonicalSkillRegistryPath(). */
  registryPath?: string;
  /**
   * C3.13: also rm -rf the on-disk clone after removing the registry
   * entry. Guarded: rootPath must live under defaultRemoteRoot().
   */
  purgeClone?: boolean;
}

/**
 * Resolve a user-supplied identifier to a registry lookup key.
 *
 * Mirror of `agent/unregister.ts:resolveLookupKey`. Three cases:
 *   1. Unambiguous path prefix (`/`, `./`, `../`) → resolve and look up
 *      against `rootPath`.
 *   2. Bare label (no `/` anywhere) → look up by label verbatim.
 *   3. Ambiguous (`owner/repo` shape — contains `/` but no path prefix)
 *      → try label first, then fall back to resolved-path lookup. This
 *      handles remote-installed catalogs whose auto-derived labels
 *      naturally contain `/` (DW-8).
 */
function resolveLookupKey(
  input: string,
  catalogs: ReadonlyArray<{ label: string; rootPath: string }>,
): { key: string; how: "label" | "path" } {
  const hasPathPrefix = input.startsWith("/") || input.startsWith(".");
  if (hasPathPrefix) return { key: resolve(input), how: "path" };
  const labelHit = catalogs.some((c) => c.label === input);
  if (labelHit) return { key: input, how: "label" };
  if (input.includes("/")) return { key: resolve(input), how: "path" };
  return { key: input, how: "label" };
}

export async function skillUnregister(
  pathOrLabel: string,
  paths: SkillUnregisterPaths = {},
): Promise<number> {
  const registryPath = paths.registryPath ?? canonicalSkillRegistryPath();
  const before = await loadSkillRegistry(registryPath);
  const { key: lookupKey, how } = resolveLookupKey(pathOrLabel, before.catalogs);

  // See agent/unregister.ts — resolve the clone dir AND remote{} from
  // the in-memory registry BEFORE removeCatalog mutates it, so the
  // purge guard has the full Source to inspect on the throw path.
  let toPurge: { rootPath: string; remote?: { url: string } } | undefined;
  if (paths.purgeClone) {
    const matched =
      before.catalogs.find((c) => c.rootPath === lookupKey) ??
      before.catalogs.find((c) => c.label === lookupKey);
    if (matched) {
      toPurge = matched.remote
        ? { rootPath: matched.rootPath, remote: { url: matched.remote.url } }
        : { rootPath: matched.rootPath };
    }
  }

  const after = removeCatalog(before, lookupKey);
  if (after.catalogs.length === before.catalogs.length) {
    const description = how === "path" ? "looked up by path" : "looked up by label";
    throw new SmithError({
      code: "not-found",
      what: `skill catalog (${description})`,
      identifier: lookupKey,
      suggestedCommand: "smith skill list",
    });
  }

  // [v1-task RC2-9] Layered purge-clone safety — see agent/unregister.ts.
  if (paths.purgeClone) {
    if (!toPurge) {
      throw new SmithError({
        code: "usage-error",
        message: "purge-clone: could not resolve clone directory",
      });
    }
    await assertSafeToPurgeClone(toPurge);
  }

  await saveSkillRegistry(registryPath, after);

  if (paths.purgeClone && toPurge) {
    await rm(toPurge.rootPath, { recursive: true, force: true });
    try {
      console.log(pc.green("Purged clone"), toPurge.rootPath);
    } catch {
      /* ignore log failures */
    }
  }

  // See register.ts: never let a log failure mask successful state mutation.
  try {
    console.log(pc.green("Unregistered skill catalog"), lookupKey);
  } catch {
    /* ignore log failures after successful state mutation */
  }
  return 0;
}
