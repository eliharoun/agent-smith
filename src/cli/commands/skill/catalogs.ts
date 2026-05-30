import { stat } from "node:fs/promises";
import pc from "picocolors";
import { catalogMode } from "../../../core/source-mode";
import { canonicalSkillRegistryPath, loadSkillRegistry } from "../../../io/skill-registry";

export interface SkillCatalogsPaths {
  /** Override for tests. Defaults to canonicalSkillRegistryPath(). */
  registryPath?: string;
}

/**
 * Lists registered skill catalogs. Mirrors agent format:
 *
 *   <label> [<kind>] [managed|linked] → <rootPath> [(git: <url>)] [(adhoc|protected)]
 *
 * RC2-6 additions:
 *   - [managed]/[linked] chip via catalogMode() (single source of truth
 *     with agent catalogs and the GUI).
 *   - (git: <url>) suffix to match agent output (previously agent-only).
 */
export async function skillCatalogs(paths: SkillCatalogsPaths = {}): Promise<number> {
  const registryPath = paths.registryPath ?? canonicalSkillRegistryPath();
  const reg = await loadSkillRegistry(registryPath);
  if (reg.catalogs.length === 0) {
    console.log(pc.dim("(no catalogs registered)"));
    return 0;
  }
  for (const c of reg.catalogs) {
    const flags: string[] = [];
    if (c.protected) flags.push("protected");
    if (c.adhoc) flags.push("adhoc");
    const flagStr = flags.length ? pc.dim(` (${flags.join(", ")})`) : "";
    const gitSuffix = c.remote?.url
      ? pc.dim(` (git: ${c.remote.url})`)
      : c.gitRemote
        ? pc.dim(` (git: ${c.gitRemote})`)
        : "";
    let cloneAnnotation = "";
    if (c.gitRemote) {
      try {
        await stat(c.rootPath);
      } catch {
        cloneAnnotation = pc.dim(" (not yet cloned)");
      }
    }
    console.log(
      pc.bold(c.label),
      pc.dim(`[${c.kind}]`),
      pc.dim(`[${catalogMode(c)}]`),
      pc.dim("→"),
      c.rootPath + gitSuffix + flagStr + cloneAnnotation,
    );
  }
  return 0;
}
