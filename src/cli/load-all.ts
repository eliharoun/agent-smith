import { basename } from "node:path";
import pc from "picocolors";
import { SmithError } from "../core/smith-error";
import { toMessage } from "../core/to-message";
import type { AgentBundle, Source, SourceKind } from "../core/types";
import { loadBundle } from "../io/bundle-loader";
import { canonicalUserPath, resolveAllSources, type Registry } from "../io/registry";
import { listAgentDirs } from "../io/sources";

export interface BundleLoadFailure {
  sourceKind: SourceKind;
  sourceLabel: string;
  bundlePath: string;
  reason: string;
}

export interface LoadAllBundlesResult {
  bundles: AgentBundle[];
  failures: BundleLoadFailure[];
}

/**
 * Optional dependency injection point for `loadAllBundles`. Mirrors the
 * `ResolveAllSourcesDeps` pattern used by `resolveAllSources` itself.
 *
 * `resolveSources` defaults to `resolveAllSources`, which contributes the
 * synthetic `agent-smith-self` source (see `SELF_SOURCE_LABEL` in
 * `src/io/registry.ts`). Tests that want to assert only on the registry's
 * explicit sources can inject `(reg) => Promise.resolve(reg.sources)` to
 * skip the synthetic source entirely.
 */
export interface LoadAllBundlesDeps {
  resolveSources?: (registry: Registry) => Promise<Source[]>;
}

export async function loadAllBundles(
  registry: Registry,
  deps: LoadAllBundlesDeps = {},
): Promise<LoadAllBundlesResult> {
  const resolve = deps.resolveSources ?? resolveAllSources;
  const bundles: AgentBundle[] = [];
  const failures: BundleLoadFailure[] = [];
  for (const source of await resolve(registry)) {
    const dirs = await listAgentDirs(source);
    for (const dir of dirs) {
      try {
        const bundle = await loadBundle(dir, source, {
          canonicalUserPath: canonicalUserPath(),
        });
        bundles.push(bundle);
      } catch (err) {
        failures.push({
          sourceKind: source.kind,
          sourceLabel: source.label,
          bundlePath: dir,
          reason: toMessage(err),
        });
      }
    }
  }
  return { bundles, failures };
}

/**
 * Authoritative format for a single load failure as a human-readable detail
 * line. Used by both `findBundleOrFail` (single-item details array) and
 * `aggregateLoadFailures` (multi-item details array). Downstream callers
 * depend on this exact shape via the SmithError `partial-failure` payload.
 */
function formatFailureDetail(f: BundleLoadFailure): string {
  return `[${f.sourceLabel}] ${f.bundlePath}: ${f.reason}`;
}

/**
 * Look up a bundle by name in a load result. If the bundle is not present
 * but a load failure has a matching directory basename, surface that failure
 * as a `partial-failure` SmithError (the bundle exists on disk but couldn't
 * be loaded). Otherwise, throw `not-found`.
 *
 * The basename heuristic is intentional: bundles conventionally live in
 * directories named after themselves (`<catalog>/<name>/agent.config.json`).
 */
export function findBundleOrFail(
  result: LoadAllBundlesResult,
  name: string,
): AgentBundle {
  const hit = result.bundles.find((b) => b.config.name === name);
  if (hit) return hit;

  const failure = result.failures.find((f) => basename(f.bundlePath) === name);
  if (failure) {
    throw new SmithError({
      code: "partial-failure",
      operation: "load bundle",
      succeeded: 0,
      failed: 1,
      skipped: 0,
      details: [formatFailureDetail(failure)],
    });
  }

  throw new SmithError({
    code: "not-found",
    what: "agent",
    identifier: name,
    suggestedCommand: "smith agent list",
  });
}

/**
 * Print a warning for each load failure whose bundle directory basename
 * does NOT match `targetName`. Pairs with `findBundleOrFail`: the matching
 * failure is intentionally skipped here so it can be re-surfaced as a
 * partial-failure SmithError by `findBundleOrFail` instead of double-printed.
 *
 * The basename comparison must stay in lockstep with findBundleOrFail's
 * lookup heuristic (see findBundleOrFail above).
 */
export function warnUnrelatedLoadFailures(
  failures: BundleLoadFailure[],
  targetName: string,
  printErr: (msg: string) => void,
): void {
  for (const f of failures) {
    if (basename(f.bundlePath) !== targetName) {
      printErr(pc.yellow(`warn: [${f.sourceLabel}] ${f.bundlePath}: ${f.reason}`));
    }
  }
}

/**
 * Print a warning for EVERY load failure (no name filter). Used by callers
 * that operate on the entire catalog (install-all, uninstall-all, jack-out,
 * list, doctor) and need to surface every parse failure before proceeding
 * with the loaded subset.
 *
 * Distinct from warnUnrelatedLoadFailures, which has a target-name filter
 * to pair with findBundleOrFail. This helper has no target.
 *
 * The `printer` arg lets callers route output to stdout or stderr per
 * their existing convention (uninstall-all/jack-out use `print`; list,
 * doctor, install-all use `printErr`/console.error).
 */
export function warnAllLoadFailures(
  failures: BundleLoadFailure[],
  printer: (msg: string) => void,
): void {
  for (const f of failures) {
    printer(pc.yellow(`warn: [${f.sourceLabel}] ${f.bundlePath}: ${f.reason}`));
  }
}

/**
 * Combine per-bundle load failures with caller-provided extra details into
 * a single `partial-failure` SmithError. Returns null when there's nothing
 * to aggregate (no load failures and no extras), so callers can fall through
 * to the success path.
 */
export function aggregateLoadFailures(
  operation: string,
  succeededCount: number,
  failures: BundleLoadFailure[],
  extraDetails: string[] = [],
  extraFailedCount = 0,
): SmithError | null {
  if (failures.length === 0 && extraDetails.length === 0) return null;
  return new SmithError({
    code: "partial-failure",
    operation,
    succeeded: succeededCount,
    failed: failures.length + extraFailedCount,
    skipped: 0,
    details: [
      ...failures.map(formatFailureDetail),
      ...extraDetails,
    ],
  });
}
