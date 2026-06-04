import pc from "picocolors";
import { catalogMode } from "../../../core/source-mode";
import { canonicalRegistryPath, loadRegistry } from "../../../io/registry";

export interface AgentCatalogsPaths {
  /** Override for tests. Defaults to canonicalRegistryPath(). */
  registryPath?: string;
}

/**
 * Lists every registered agent catalog (source) from the agent registry.
 * Mirrors `smith skill catalogs`. Output format is intentionally identical
 * so users can scan both with the same eye:
 *
 *   <label> [<kind>] [managed|linked] → <rootPath> [git: <remote>]
 *
 * The mode chip (RC2-6) makes the smith-owned-clone vs user-owned-path
 * distinction explicit at a glance — critical for the --purge-clone
 * decision (RC2-9): only [managed] catalogs are eligible.
 */
export async function agentCatalogs(paths: AgentCatalogsPaths = {}): Promise<number> {
  const registryPath = paths.registryPath ?? canonicalRegistryPath();
  const reg = await loadRegistry(registryPath);
  if (reg.sources.length === 0) {
    console.log(pc.dim("(no catalogs registered)"));
    return 0;
  }
  for (const s of reg.sources) {
    const gitSuffix = s.gitRemote ? pc.dim(` (git: ${s.gitRemote})`) : "";
    const kindAnnotation = s.importedArchive ? "imported-archive" : s.kind;
    console.log(
      pc.bold(s.label),
      pc.dim(`[${kindAnnotation}]`),
      pc.dim(`[${catalogMode(s)}]`),
      pc.dim("→"),
      s.rootPath + gitSuffix,
    );
  }
  return 0;
}
