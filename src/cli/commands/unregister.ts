import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import pc from "picocolors";
import { isProtectedCatalog, refusalMessage } from "../../core/protected-bundles";
import { SmithError } from "../../core/smith-error";
import { assertSafeToPurgeClone } from "../../io/clone-purge-guard";
import { canonicalRegistryPath, loadRegistry, removeSource, saveRegistry } from "../../io/registry";

export interface UnregisterPaths {
  /** Override for tests. Defaults to canonicalRegistryPath(). */
  registryPath?: string;
  /**
   * C3.13: also delete the on-disk clone after removing the registry
   * entry. Guarded: the rootPath MUST be inside defaultRemoteRoot() —
   * arbitrary user dirs cannot be wiped via this flag.
   */
  purgeClone?: boolean;
}

/**
 * Resolve a user-supplied identifier to a registry lookup key.
 *
 * Three cases:
 *   1. Unambiguous path prefix (`/`, `./`, `../`) → resolve and look up
 *      against `rootPath`.
 *   2. Bare label (no `/` anywhere) → look up by label verbatim.
 *   3. Ambiguous (`owner/repo` shape — contains `/` but no path prefix)
 *      → try label first, then fall back to resolved-path lookup. This
 *      handles remote-installed catalogs whose auto-derived labels
 *      naturally contain `/` (DW-8).
 *
 * Returns the lookup key (label or absolute path) and whether the
 * caller should describe a failure as `looked up by label` vs `by path`.
 */
function resolveLookupKey(
  input: string,
  sources: ReadonlyArray<{ label: string; rootPath: string }>,
): { key: string; how: "label" | "path" } {
  const hasPathPrefix = input.startsWith("/") || input.startsWith(".");
  if (hasPathPrefix) {
    return { key: resolve(input), how: "path" };
  }
  const labelHit = sources.some((s) => s.label === input);
  if (labelHit) {
    return { key: input, how: "label" };
  }
  if (input.includes("/")) {
    // Looked like a path, but no label matched — fall back to path lookup.
    return { key: resolve(input), how: "path" };
  }
  // Pure bare token, no label match — still describe as label lookup so
  // the error tells the user we treated it as a label.
  return { key: input, how: "label" };
}

export async function unregister(
  pathOrLabel: string,
  paths: UnregisterPaths = {},
): Promise<number> {
  // Refuse protected catalogs (agent-smith-self) up front, before the registry
  // lookup — otherwise the synthetic source's absence from registry.json would
  // surface as an incidental not-found rather than an explicit refusal.
  if (isProtectedCatalog(pathOrLabel)) {
    throw new SmithError({
      code: "protected-bundle",
      message: refusalMessage({ entity: pathOrLabel, kind: "catalog", verb: "unregister" }),
    });
  }
  const registryPath = paths.registryPath ?? canonicalRegistryPath();
  const before = await loadRegistry(registryPath);
  // DW-8: label-first resolution so 'owner/repo'-shaped labels (the
  // auto-derived shape for remote-installed catalogs) aren't silently
  // misrouted to the path branch.
  const { key: lookupKey, how } = resolveLookupKey(pathOrLabel, before.sources);

  // For purge-clone we need the rootPath AND remote{} of the source
  // being removed. Resolve it BEFORE mutating the registry so the guard
  // (and an early SmithError if it refuses) doesn't leave behind a
  // half-applied state.
  let toPurge: { rootPath: string; remote?: { url: string } } | undefined;
  if (paths.purgeClone) {
    const matched =
      before.sources.find((s) => s.rootPath === lookupKey) ??
      before.sources.find((s) => s.label === lookupKey);
    if (matched) {
      toPurge = matched.remote
        ? { rootPath: matched.rootPath, remote: { url: matched.remote.url } }
        : { rootPath: matched.rootPath };
    }
  }

  const after = removeSource(before, lookupKey);

  if (after.sources.length === before.sources.length) {
    // Surface the registered set on the no-op path so users with
    // fat-fingered input (relative-vs-absolute, trailing slash,
    // wrong-cased label) can see the actual candidates instead of
    // debugging blind. Listing goes to stdout — it's informational
    // context, not an error stream entry. The SmithError thrown
    // immediately after carries the failure signal.
    console.log("Currently registered:");
    for (const src of before.sources) {
      console.log(`  ${src.rootPath}`);
    }
    const description = how === "path" ? "looked up by path" : "looked up by label";
    throw new SmithError({
      code: "not-found",
      what: `agent catalog (${description})`,
      identifier: lookupKey,
      suggestedCommand: "smith agent list",
    });
  }

  // [v1-task RC2-9] Layered purge-clone safety. Delegates to the
  // shared helper so agent + skill paths can never drift. Throws on
  // any refusal BEFORE we persist the registry mutation — a refused
  // purge leaves zero observable change.
  if (paths.purgeClone) {
    if (!toPurge) {
      throw new SmithError({
        code: "usage-error",
        message: "purge-clone: could not resolve clone directory",
      });
    }
    await assertSafeToPurgeClone(toPurge);
  }

  await saveRegistry(registryPath, after);

  if (paths.purgeClone && toPurge) {
    await rm(toPurge.rootPath, { recursive: true, force: true });
    console.log(pc.green("Purged clone"), toPurge.rootPath);
  }

  console.log(pc.green("Unregistered"), lookupKey);
  return 0;
}
