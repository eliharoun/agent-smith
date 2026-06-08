import { readFile } from "node:fs/promises";
import type { InstalledSkill } from "../../../shared/src/index";

export interface InstalledSkillsDeps {
  /** Absolute path to ~/.config/agent-smith/installed-skills.json */
  path: string;
}

export async function loadInstalledSkills(deps: InstalledSkillsDeps): Promise<InstalledSkill[]> {
  let raw: string;
  try {
    raw = await readFile(deps.path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { installed?: unknown }).installed)
  ) {
    return [];
  }
  // Best-effort filter — entries are loose because they were written by the CLI.
  return (parsed as { installed: unknown[] }).installed.filter(
    (e): e is InstalledSkill =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as InstalledSkill).name === "string" &&
      typeof (e as InstalledSkill).sourceCatalogLabel === "string",
  );
}
