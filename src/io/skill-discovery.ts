import type { Dirent } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import yaml from "js-yaml";
import { SmithError } from "../core/smith-error";
import { toMessage } from "../core/to-message";
import { deriveDefaultCatalogLabel } from "./catalog-label";
import { classifyFsError } from "./fs-error";
import type { SkillCatalog, SkillRegistry } from "./skill-registry";

/** Looser than agent name regex — per spec, leading digits allowed. */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

/**
 * Maximum length for a skill's frontmatter description. Descriptions get
 * surfaced in CLI listings and (eventually) injected into agent system
 * prompts; an overlong description bloats the context for every consumer.
 * Values longer than this are silently truncated with an ellipsis rather
 * than rejected — being lenient here keeps third-party catalogs working
 * even if their authors get verbose.
 */
const MAX_DESCRIPTION_LEN = 1000;

export interface DiscoveredSkill {
  /** From frontmatter.name. */
  name: string;
  /** Absolute path to the skill's directory (parent of SKILL.md). */
  path: string;
  /** Parsed frontmatter as a generic record. */
  frontmatter: Record<string, unknown>;
  /** The catalog this skill was discovered in. */
  catalogLabel: string;
}

export function validateSkillName(name: unknown): name is string {
  return typeof name === "string" && SKILL_NAME_RE.test(name);
}

export async function discoverSkills(catalog: SkillCatalog): Promise<DiscoveredSkill[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(catalog.rootPath, { withFileTypes: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return [];
    throw classifyFsError(err, catalog.rootPath, "list");
  }

  const skills: DiscoveredSkill[] = [];
  const visited = new Set<string>();

  async function walk(parentPath: string, dirEntries: Dirent[]): Promise<void> {
    for (const entry of dirEntries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const entryPath = join(parentPath, entry.name);
      let isDir = false;
      let resolved = entryPath;
      if (entry.isDirectory()) {
        isDir = true;
      } else if (entry.isSymbolicLink()) {
        try {
          const st = await stat(entryPath);
          isDir = st.isDirectory();
          if (isDir) resolved = await realpath(entryPath);
        } catch {
          continue;
        }
      }
      if (!isDir) continue;
      if (visited.has(resolved)) continue;
      visited.add(resolved);

      // Check if this directory contains a SKILL.md — if so, it's a skill; don't descend.
      const skillFile = join(entryPath, "SKILL.md");
      let raw: string | null = null;
      try {
        raw = await readFile(skillFile, "utf8");
      } catch {
        // No SKILL.md here — recurse into this directory.
      }

      if (raw !== null) {
        const fm = parseFrontmatter(raw, skillFile);
        if (!validateSkillName(fm["name"])) {
          throw new SmithError({
            code: "validation-failed",
            what: "SKILL.md frontmatter",
            reasons: [
              `${skillFile}: invalid skill name '${String(fm["name"])}' (must match ${SKILL_NAME_RE})`,
            ],
          });
        }
        if (typeof fm["description"] !== "string" || fm["description"].length === 0) {
          throw new SmithError({
            code: "validation-failed",
            what: "SKILL.md frontmatter",
            reasons: [`${skillFile}: missing required 'description'`],
          });
        }
        if ((fm["description"] as string).length > MAX_DESCRIPTION_LEN) {
          fm["description"] = `${(fm["description"] as string).slice(0, MAX_DESCRIPTION_LEN - 1)}…`;
        }
        skills.push({
          name: fm["name"],
          path: entryPath,
          frontmatter: fm,
          catalogLabel: catalog.label,
        });
        // Do NOT descend into skill directories.
      } else {
        // Recurse into non-skill subdirectory.
        try {
          const subEntries = await readdir(entryPath, { withFileTypes: true });
          await walk(entryPath, subEntries);
        } catch {
          continue; // permission error or similar — skip silently
        }
      }
    }
  }

  await walk(catalog.rootPath, entries);
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

function parseFrontmatter(raw: string, file: string): Record<string, unknown> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new SmithError({
      code: "validation-failed",
      what: "SKILL.md frontmatter",
      reasons: [`${file}: missing YAML frontmatter delimiters`],
    });
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(match[1] ?? "");
  } catch (err) {
    throw new SmithError({
      code: "validation-failed",
      what: "SKILL.md frontmatter",
      reasons: [`${file}: invalid YAML: ${toMessage(err)}`],
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SmithError({
      code: "validation-failed",
      what: "SKILL.md frontmatter",
      reasons: [`${file}: frontmatter must be a YAML object`],
    });
  }
  return parsed as Record<string, unknown>;
}

/**
 * Result of {@link findSkillByName}. Either a unique discovered skill, a
 * not-found marker, or a list of catalogs that all expose the same name
 * (caller must disambiguate with `<catalog>/<name>`).
 */
export type FindSkillResult =
  | DiscoveredSkill
  | { error: "not-found" }
  | { error: "ambiguous"; matches: DiscoveredSkill[] };

/**
 * Walk every catalog in the registry, run discoverSkills, and find the
 * single skill matching `name`. If `opts.catalog` is set, restrict the
 * search to the catalog with that label.
 *
 * Catalogs with `adhoc: true` are included — adhoc-installed skills are
 * still installable / updatable by name.
 */
export async function findSkillByName(
  registry: SkillRegistry,
  name: string,
  opts?: { catalog?: string },
): Promise<FindSkillResult> {
  const catalogs = opts?.catalog
    ? registry.catalogs.filter((c) => c.label === opts.catalog)
    : registry.catalogs;
  const matches: DiscoveredSkill[] = [];
  for (const cat of catalogs) {
    let found: DiscoveredSkill[] = [];
    try {
      found = await discoverSkills(cat);
    } catch {
      continue; // a broken catalog shouldn't blind the rest of the lookup
    }
    for (const s of found) {
      if (s.name === name) matches.push(s);
    }
  }
  if (matches.length === 0) return { error: "not-found" };
  if (matches.length === 1) return matches[0]!;
  return { error: "ambiguous", matches };
}

/**
 * Result of {@link resolveAdHocSource}. The caller uses this to register
 * the synthetic catalog AND install the single skill it contains. Only
 * local-path sources are supported today; git URL acquisition is not yet
 * implemented.
 */
export interface ResolvedAdHocSource {
  catalog: SkillCatalog;
  skill: DiscoveredSkill;
}

/**
 * Resolve a `--from <path>` ad-hoc skill reference. The reference is the
 * absolute path to a single skill directory containing a SKILL.md (NOT a
 * catalog root). The synthetic catalog has `kind: "user-local"`,
 * `adhoc: true`, and a `rootPath` set to the skill's parent directory so
 * `discoverSkills` can find it. The catalog's `label` defaults to the
 * skill's frontmatter name; pass `opts.as` to override.
 */
export async function resolveAdHocSource(
  ref: string,
  opts?: { as?: string },
): Promise<ResolvedAdHocSource> {
  if (!isAbsolute(ref) && !ref.startsWith(".") && !ref.startsWith("/")) {
    // Treat anything else (e.g. https://github.com/foo/bar.git) as a
    // git URL — git acquisition is not yet implemented for ad-hoc skill
    // sources. Fail clearly.
    throw new SmithError({
      code: "usage-error",
      message: `Ad-hoc skill source '${ref}' is not a local path. Git URL sources are not yet supported here.`,
    });
  }
  const absSkillDir = resolve(ref);
  const st = await stat(absSkillDir).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw new SmithError({
      code: "not-found",
      what: "ad-hoc skill source",
      identifier: absSkillDir,
    });
  }
  // The skill name comes from frontmatter; the catalog's rootPath is the
  // *parent* dir so discoverSkills walks one level.
  const skillFile = join(absSkillDir, "SKILL.md");
  const raw = await readFile(skillFile, "utf8").catch(() => null);
  if (raw === null) {
    throw new SmithError({
      code: "not-found",
      what: "SKILL.md",
      identifier: skillFile,
    });
  }
  const fm = parseFrontmatter(raw, skillFile);
  if (!validateSkillName(fm["name"])) {
    throw new SmithError({
      code: "validation-failed",
      what: "SKILL.md frontmatter",
      reasons: [`${skillFile}: invalid skill name '${String(fm["name"])}'`],
    });
  }
  const skillName = fm["name"];
  const rootPath = dirname(absSkillDir);
  const catalogLabel = opts?.as ?? deriveDefaultCatalogLabel(rootPath);
  const catalog: SkillCatalog = {
    kind: "user-local",
    rootPath,
    label: catalogLabel,
    adhoc: true,
  };
  // Discover from the synthetic catalog so we exercise the same validation
  // discoverSkills applies to registered catalogs, AND so siblings of the
  // skill dir don't accidentally get pulled in (we filter by name below).
  const all = await discoverSkills(catalog);
  const skill = all.find((s) => s.name === skillName && basename(s.path) === basename(absSkillDir));
  if (!skill) {
    throw new SmithError({
      code: "validation-failed",
      what: "ad-hoc skill resolution",
      reasons: [`discoverSkills did not surface '${skillName}' at ${absSkillDir}`],
    });
  }
  return { catalog, skill };
}
