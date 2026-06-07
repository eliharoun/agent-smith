import { homedir } from "node:os";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { type SkillCatalog, SkillFrontmatter, type SkillSummary } from "gui-shared";
import * as yaml from "js-yaml";
import { isProtectedSkill } from "../../../../src/core/protected-bundles";

const SKILL_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Mirror of `bootstrapAtlassianSkillsCatalog()` in
 * `src/io/skill-registry.ts`. Inlined here because gui/server cannot
 * cross-import from src/ (rootDir boundary) — same pattern as
 * `defaultAgentSmithHome()` in cache-paths.ts.
 *
 * Constants kept in lockstep with src/io/skill-registry.ts:
 *   ATLASSIAN_SKILLS_GIT_URL = https://github.com/langpingxue/atlassian-skills.git
 *   ATLASSIAN_SKILLS_LABEL   = atlassian-skills
 */
function bootstrapAtlassianSkillsCatalog(): SkillCatalog {
  const xdg = process.env.XDG_STATE_HOME;
  const stateRoot = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "state");
  const cloneDir = join(
    stateRoot,
    "agent-smith",
    "remote",
    "github.com",
    "langpingxue",
    "atlassian-skills",
  );
  return {
    kind: "team-shared",
    label: "atlassian-skills",
    rootPath: cloneDir,
    gitRemote: "https://github.com/langpingxue/atlassian-skills.git",
    remote: { url: "https://github.com/langpingxue/atlassian-skills.git", ref: "HEAD" },
    protected: true,
  };
}

export interface ScanSkillCatalogsDeps {
  /** Absolute path to skill-catalogs.json */
  registryPath: string;
  /**
   * When true (default), the bootstrap atlassian-skills catalog is
   * spliced in if missing from disk — mirrors the CLI's
   * loadSkillRegistry behavior. Tests that need to assert on the raw
   * persisted shape pass `false`.
   *
   * The `SMITH_DISABLE_SKILL_BOOTSTRAP=1` env var also forces opt-out
   * (used by the test preload to keep fixture-based tests hermetic).
   */
  includeBootstrap?: boolean;
}

export async function loadSkillCatalogs(deps: ScanSkillCatalogsDeps): Promise<SkillCatalog[]> {
  const explicitOptOut = deps.includeBootstrap === false;
  const envOptOut = process.env.SMITH_DISABLE_SKILL_BOOTSTRAP === "1";
  const includeBootstrap = !explicitOptOut && !envOptOut;

  const persisted = await loadPersistedSkillCatalogs(deps.registryPath);

  if (!includeBootstrap) return persisted;

  // Splice the protected atlassian-skills bootstrap if it's not already
  // listed. Matches src/io/skill-registry.ts:loadSkillRegistry behavior.
  const bootstrap = bootstrapAtlassianSkillsCatalog();
  if (persisted.some((c) => c.label === bootstrap.label)) return persisted;
  return [bootstrap, ...persisted];
}

async function loadPersistedSkillCatalogs(registryPath: string): Promise<SkillCatalog[]> {
  let raw: string;
  try {
    raw = await readFile(registryPath, "utf8");
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
    !Array.isArray((parsed as { catalogs?: unknown }).catalogs)
  ) {
    return [];
  }
  return (parsed as { catalogs: unknown[] }).catalogs.filter(
    (c): c is SkillCatalog =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as SkillCatalog).label === "string" &&
      typeof (c as SkillCatalog).rootPath === "string" &&
      typeof (c as SkillCatalog).kind === "string",
  );
}

export async function discoverSkills(catalog: SkillCatalog): Promise<SkillSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(catalog.rootPath);
  } catch {
    return [];
  }
  const out: SkillSummary[] = [];
  const visited = new Set<string>();

  async function walk(parentPath: string, dirEntries: string[]): Promise<void> {
    for (const entry of dirEntries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const entryPath = join(parentPath, entry);
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(entryPath);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      let resolved: string;
      try {
        resolved = await realpath(entryPath);
      } catch {
        continue;
      }
      if (visited.has(resolved)) continue;
      visited.add(resolved);

      const skillMd = join(entryPath, "SKILL.md");
      let raw: string | null = null;
      try {
        raw = await readFile(skillMd, "utf8");
      } catch {
        // No SKILL.md — recurse.
      }

      if (raw !== null) {
        const fm = extractFrontmatter(raw);
        if (!fm) continue;
        const parsed = SkillFrontmatter.safeParse(fm);
        if (!parsed.success) continue;
        if (!SKILL_NAME_RE.test(parsed.data.name)) continue;
        out.push({
          name: parsed.data.name,
          description: parsed.data.description.slice(0, 1000),
          catalogLabel: catalog.label,
          path: entryPath,
          protected: isProtectedSkill(parsed.data.name),
        });
        // Do NOT descend into skill directories.
      } else {
        try {
          const subEntries = await readdir(entryPath);
          await walk(entryPath, subEntries);
        } catch {
          continue;
        }
      }
    }
  }

  await walk(catalog.rootPath, entries);
  return out;
}

function extractFrontmatter(raw: string): unknown | null {
  if (!raw.startsWith("---\n")) return null;
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return null;
  const body = raw.slice(4, end);
  try {
    return yaml.load(body);
  } catch {
    return null;
  }
}
