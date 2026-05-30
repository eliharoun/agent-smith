import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import type { CanonicalConfig, Target } from "../core/types";

export interface SkillAvailabilityPaths {
  /**
   * Directories that themselves contain skill subdirectories (each with a
   * `SKILL.md`). NOT agent bundle roots — these are skill-root directories.
   * For example, `~/.config/agent-smith/skills` (which contains
   * `<skill-name>/SKILL.md` entries), not `~/.config/agent-smith/agents`.
   */
  sourceRoots: string[];
  opencodeSkillsDir: string;
  claudeSkillsDir: string;
  codexSkillsDir: string;
}

export interface SkillAvailabilityResult {
  warnings: string[];
  descriptions: Map<string, string>;
}

/**
 * Resolves each declared skill against the supplied skill-root directories.
 * For every skill in `config.skills`, looks up `<root>/<skill>/SKILL.md` in
 * each of `paths.sourceRoots` and the per-platform skill dirs. The first
 * description found wins. Emits warnings for skills not found anywhere or
 * not installed for a target platform the agent uses.
 *
 * Note: `paths.sourceRoots` are SKILL-root directories (each contains
 * `<skill-name>/SKILL.md` subdirectories), not agent bundle roots.
 */
export async function checkSkillAvailability(
  config: CanonicalConfig,
  paths: SkillAvailabilityPaths,
): Promise<SkillAvailabilityResult> {
  const result: SkillAvailabilityResult = { warnings: [], descriptions: new Map() };
  if (!config.skills || config.skills.length === 0) return result;

  for (const skill of config.skills) {
    const lookups: { root: string; target?: Target }[] = [
      ...paths.sourceRoots.map((root) => ({ root })),
      { root: paths.opencodeSkillsDir, target: "opencode" as Target },
      { root: paths.claudeSkillsDir, target: "claude-code" as Target },
      { root: paths.codexSkillsDir, target: "codex" as Target },
    ];

    let foundAnywhere = false;
    const foundInTargets = new Set<Target>();

    for (const { root, target } of lookups) {
      const skillFile = join(root, skill, "SKILL.md");
      const desc = await tryReadSkillDescription(skillFile);
      if (desc === null) continue;
      foundAnywhere = true;
      if (target) foundInTargets.add(target);
      if (!result.descriptions.has(skill) && desc.description !== null) {
        result.descriptions.set(skill, desc.description);
      }
    }

    if (!foundAnywhere) {
      result.warnings.push(
        `skill '${skill}' not found in any agent-smith source or platform skill dir`,
      );
      continue;
    }

    for (const target of config.targets) {
      if (!foundInTargets.has(target)) {
        result.warnings.push(`skill '${skill}' not installed for ${target}`);
      }
    }
  }

  return result;
}

async function tryReadSkillDescription(
  skillFile: string,
): Promise<{ description: string | null } | null> {
  try {
    await stat(skillFile);
  } catch {
    return null;
  }
  try {
    const text = await readFile(skillFile, "utf8");
    const parsed = matter(text);
    const desc = parsed.data?.description;
    return { description: typeof desc === "string" && desc.length > 0 ? desc : null };
  } catch {
    return { description: null };
  }
}
