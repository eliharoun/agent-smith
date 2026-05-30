import { refreshSource as realRefreshSource } from "../../../core/knowledge/refresh-source";
import type { KnowledgeSource } from "../../../core/knowledge/types";
import { canonicalRegistryPath, loadRegistry } from "../../../io/registry";
import { defaultAgentSmithHome } from "../../install-paths";
import { findBundleOrFail, loadAllBundles } from "../../load-all";
import { install as realInstall } from "../install";

/** Per-source refresh primitive wrapper used by the session hook. Resolves
 *  the agent's bundle, dispatches to `refreshSource` (single-source primitive)
 *  for file-delivery sources, and falls back to a full `install()` rebuild
 *  for cases the primitive can't handle on its own (inline/auto delivery,
 *  missing source ids, primitive throws).
 *
 *  Result-kind → wrapper-behavior mapping:
 *    - `refreshed`               → { ok: true }            (no fallback)
 *    - `inline-only`             → install() fallback      (inline rebuild)
 *    - `lock-held`               → { ok: true }            (another refresh in flight)
 *    - `skipped: unsupported`    → { ok: false, error }    (install wouldn't help)
 *    - thrown                    → install() fallback      (last-resort recovery)
 *    - sourceId not in bundle    → install() fallback      (bundle drift)
 *    - bundle load fails         → { ok: false, error }    (install would re-fail)
 *
 *  Hook-safe `install()` options:
 *    - `skillMode: "no-skills"` — never prompt for required-skill install
 *      (sessions are non-interactive; a TTY-detected prompt would freeze
 *      the hook until the 5s budget expires).
 *    - `print: () => {}` — suppress install's per-agent stdout chatter so
 *      `--json` output stays parseable. Failures still flow via printErr.
 */

export interface LoadedBundle {
  bundleDir: string;
  sources: KnowledgeSource[];
}

export interface RefreshOneSourceDeps {
  refreshSourceImpl?: typeof realRefreshSource;
  installImpl?: typeof realInstall;
  loadBundleImpl?: (agent: string) => Promise<LoadedBundle>;
  agentSmithHome?: string;
}

async function defaultLoadBundle(agent: string): Promise<LoadedBundle> {
  const reg = await loadRegistry(canonicalRegistryPath());
  const loadResult = await loadAllBundles(reg);
  const bundle = findBundleOrFail(loadResult, agent);
  return {
    bundleDir: bundle.bundlePath,
    sources: bundle.config.knowledge?.sources ?? [],
  };
}

async function runInstallFallback(
  agent: string,
  installImpl: typeof realInstall,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const exitCode = await installImpl({
      name: agent,
      skillMode: "no-skills",
      print: () => {},
    });
    if (exitCode === 0) return { ok: true };
    return { ok: false, error: `install exited with code ${exitCode}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function refreshOneSource(
  agent: string,
  sourceId: string,
  deps: RefreshOneSourceDeps = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const refreshImpl = deps.refreshSourceImpl ?? realRefreshSource;
  const installImpl = deps.installImpl ?? realInstall;
  const loadBundleFn = deps.loadBundleImpl ?? defaultLoadBundle;
  const agentSmithHome = deps.agentSmithHome ?? defaultAgentSmithHome();

  // 1. Load the bundle. Failure here is terminal: re-running install would
  //    hit the same bundle-load error.
  let bundle: LoadedBundle;
  try {
    bundle = await loadBundleFn(agent);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 2. Find the requested source. If it's gone (bundle drift between
  //    session start and hook fire), fall back to a full install which
  //    will reconcile the on-disk state.
  const source = bundle.sources.find((s) => s.id === sourceId);
  if (!source) {
    return runInstallFallback(agent, installImpl);
  }

  // 3. Dispatch to the per-source primitive. Errors from the primitive
  //    fall back to install (last-resort recovery); typed result kinds
  //    map per the table above.
  let result: Awaited<ReturnType<typeof realRefreshSource>>;
  try {
    result = await refreshImpl({
      agentSmithHome,
      agent,
      source,
      bundleDir: bundle.bundleDir,
    });
  } catch {
    return runInstallFallback(agent, installImpl);
  }

  switch (result.kind) {
    case "refreshed":
      return { ok: true };
    case "lock-held":
      // Another refresh is in flight on the same source — let it finish.
      // Surfacing this as ok keeps the runner from logging a spurious
      // failure for what is actually a coordination event.
      return { ok: true };
    case "inline-only":
      // Inline/auto delivery has no per-source on-disk artifact for the
      // primitive to swap; a full install rebuilds the prompt context.
      return runInstallFallback(agent, installImpl);
    case "skipped":
      // Currently only one skipped reason exists; switch in case more
      // arrive later so TypeScript flags unhandled additions.
      switch (result.reason) {
        case "unsupported-source-type":
          return {
            ok: false,
            error: `source type ${source.type} is not refreshable`,
          };
      }
  }
}
