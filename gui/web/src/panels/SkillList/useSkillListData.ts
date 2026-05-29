import { useInstalledSkills } from "@/hooks/useInstalledSkills";
import { useSkills } from "@/hooks/useSkills";

/**
 * Joins /api/skills (catalog scan) with /api/installed-skills
 * (installed-skills.json) so each row can render per-platform installed
 * status chips. Joins by skill name (skill names are globally unique
 * across catalogs by CLI contract).
 *
 * Returns `byCatalog` groups so the UI can render section headers and
 * preserve disk grouping.
 */
export function useSkillListData() {
  const skillsQ = useSkills();
  const installedQ = useInstalledSkills();
  const skills = skillsQ.data ?? [];
  const installed = installedQ.data ?? [];
  const byName = new Map(installed.map((i) => [i.name, i]));
  const grouped = new Map<string, typeof skills>();
  for (const s of skills) {
    const arr = grouped.get(s.catalogLabel) ?? [];
    arr.push(s);
    grouped.set(s.catalogLabel, arr);
  }
  return {
    byCatalog: Array.from(grouped.entries()).map(([catalogLabel, rows]) => ({
      catalogLabel,
      rows,
    })),
    installedByName: byName,
    loading: skillsQ.isLoading || installedQ.isLoading,
    total: skills.length,
  };
}
