import type { AgentBundle } from "../../../core/types";
import { canonicalRegistryPath, loadRegistry, type Registry } from "../../../io/registry";
import { loadAllBundles, warnAllLoadFailures } from "../../load-all";
import type { PlatformFilter, RunnerAgent, RunnerSource } from "./refresh-session-runner";

/** Project a loaded bundle's knowledge sources into the runner's minimal shape.
 *  The runner only needs `{ id, refresh }`; everything else (type, delivery,
 *  materializer, source-type-specific fields) is dropped here. */
function projectBundleToRunnerAgent(bundle: AgentBundle): RunnerAgent {
  const sources: RunnerSource[] = (bundle.config.knowledge?.sources ?? []).map(
    (s) => {
      const r: RunnerSource = { id: s.id };
      if (s.refresh !== undefined) r.refresh = s.refresh;
      return r;
    },
  );
  return { name: bundle.config.name, targets: bundle.config.targets, sources };
}

/** Return all installed agents with the minimal source descriptors the runner needs.
 *  Errors loading individual agents are logged but don't fail the whole enumeration —
 *  refresh-session must remain soft-fail end-to-end.
 *
 *  When `platformFilter` is set, only agents whose `targets` include that platform
 *  are returned. This honours `--platform <id>` scoping at enumeration time so the
 *  runner never sees agents that can't possibly be relevant to the invoking platform.
 *
 *  Implementation: reuses the canonical bundle-loading pipeline (`loadRegistry` +
 *  `loadAllBundles`) so this stays in lockstep with `smith agent list` and friends.
 *  Per-bundle parse failures are surfaced on stderr via `warnAllLoadFailures`; the
 *  refresh-session orchestrator continues with the successfully loaded subset. */
export async function listInstalledAgentsForRefresh(
  platformFilter?: PlatformFilter,
): Promise<RunnerAgent[]> {
  let registry: Registry;
  try {
    registry = await loadRegistry(canonicalRegistryPath());
  } catch (err) {
    // No registry → no agents to refresh. Soft-fail; the runner will produce
    // an empty result and the CLI will exit 0.
    console.error(
      `smith knowledge refresh-session: failed to load registry: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }

  const result = await loadAllBundles(registry);
  // `loadAllBundles` already catches per-bundle parse errors into `failures`.
  // Surface them once on stderr (same pattern as `list`/`install-all`/`doctor`)
  // then continue with the loaded subset.
  warnAllLoadFailures(result.failures, (m) => console.error(m));

  const agents: RunnerAgent[] = [];
  for (const bundle of result.bundles) {
    try {
      agents.push(projectBundleToRunnerAgent(bundle));
    } catch (err) {
      // Projection is pure data shuffling — only conceivable failure is a
      // malformed in-memory bundle. Log and skip rather than abort.
      console.error(
        `smith knowledge refresh-session: failed to project ${bundle.config.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return filterAgentsByPlatform(agents, platformFilter);
}

/** Filter a list of `RunnerAgent`s by platform. Returns the unfiltered list
 *  when `platformFilter` is `undefined`. Extracted as a named export so the
 *  filter contract can be unit-tested without standing up a real registry. */
export function filterAgentsByPlatform(
  agents: RunnerAgent[],
  platformFilter?: PlatformFilter,
): RunnerAgent[] {
  return platformFilter
    ? agents.filter((a) => a.targets.includes(platformFilter))
    : agents;
}
