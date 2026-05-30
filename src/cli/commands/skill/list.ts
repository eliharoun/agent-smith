import pc from "picocolors";
import { toMessage } from "../../../core/to-message";
import { ensureCloneExists } from "../../../io/lazy-clone";
import { type DiscoveredSkill, discoverSkills } from "../../../io/skill-discovery";
import { canonicalSkillRegistryPath, loadSkillRegistry } from "../../../io/skill-registry";

export interface SkillListPaths {
  /** Override for tests. Defaults to canonicalSkillRegistryPath(). */
  registryPath?: string;
}

export async function skillList(
  opts: { all?: boolean } = {},
  paths: SkillListPaths = {},
): Promise<number> {
  const registryPath = paths.registryPath ?? canonicalSkillRegistryPath();
  const reg = await loadSkillRegistry(registryPath);
  const visible = reg.catalogs.filter((c) => opts.all || !c.adhoc);

  const all: DiscoveredSkill[] = [];
  for (const cat of visible) {
    try {
      await ensureCloneExists(cat);
      const found = await discoverSkills(cat);
      all.push(...found);
    } catch (err) {
      console.error(pc.yellow(`warning: catalog '${cat.label}': ${toMessage(err)}`));
    }
  }
  if (all.length === 0) {
    console.log(pc.dim("(no skills found)"));
    return 0;
  }
  all.sort((a, b) => a.name.localeCompare(b.name));
  for (const s of all) {
    const desc = String(s.frontmatter["description"] ?? "");
    const excerpt = desc.length > 60 ? `${desc.slice(0, 57)}...` : desc;
    console.log(pc.bold(s.name), pc.dim(`[${s.catalogLabel}]`), pc.dim("—"), excerpt);
  }
  return 0;
}
