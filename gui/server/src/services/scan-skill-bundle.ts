import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { type Platform, type SkillDetail, SkillFrontmatter, type SkillResource } from "gui-shared";
import * as yaml from "js-yaml";

export interface ScanSkillBundleInput {
  /** Absolute path to the skill directory containing SKILL.md. */
  path: string;
  catalogLabel: string;
  /** Optional list of platforms this skill is currently installed on. */
  installedOn: Platform[];
}

export async function scanSkillBundle(input: ScanSkillBundleInput): Promise<SkillDetail> {
  const skillMd = join(input.path, "SKILL.md");
  const raw = await readFile(skillMd, "utf8");
  if (!raw.startsWith("---\n")) {
    throw new Error(`SKILL.md missing YAML frontmatter at ${skillMd}`);
  }
  const end = raw.indexOf("\n---", 4);
  if (end < 0) throw new Error(`SKILL.md frontmatter not closed at ${skillMd}`);
  const fmRaw = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const fmObj = yaml.load(fmRaw);
  const fm = SkillFrontmatter.parse(fmObj);
  const resources = await walkResources(input.path);
  return {
    name: fm.name,
    catalogLabel: input.catalogLabel,
    path: input.path,
    frontmatter: fm,
    body,
    resources,
    installedOn: input.installedOn,
  };
}

async function walkResources(root: string): Promise<SkillResource[]> {
  const out: SkillResource[] = [];
  async function rec(d: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = join(d, name);
      const rel = relative(root, abs);
      // Skip the SKILL.md itself; everything else is a resource.
      if (rel === "SKILL.md") continue;
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) {
        out.push({ relPath: rel, isDirectory: true });
        await rec(abs);
      } else {
        out.push({ relPath: rel, isDirectory: false, bytes: st.size });
      }
    }
  }
  await rec(root);
  return out;
}
