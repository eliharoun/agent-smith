import { z } from "zod";
import { Platform } from "./agents";
import { RemoteBlock } from "./remote";

export const SkillCatalogKind = z.enum(["user-global", "user-local", "team-shared"]);
export type SkillCatalogKind = z.infer<typeof SkillCatalogKind>;

export const SkillCatalog = z.object({
  kind: SkillCatalogKind,
  rootPath: z.string(),
  label: z.string(),
  gitRemote: z.string().optional(),
  // [v1-task RC2-7] Provenance for catalogs cloned via
  // `smith skill install --from <url>`. Presence drives mode=managed.
  remote: RemoteBlock.optional(),
  adhoc: z.boolean().optional(),
  protected: z.boolean().optional(),
});
export type SkillCatalog = z.infer<typeof SkillCatalog>;

export const SkillSummary = z.object({
  name: z.string(),
  description: z.string(),
  catalogLabel: z.string(),
  // Absolute path to the skill directory containing SKILL.md.
  path: z.string(),
  // C4.1.2: optional remote{} block surfacing registry drift state for
  // catalogs installed via `smith skill install --from <url>`. Absent for
  // locally-authored skills.
  remote: RemoteBlock.optional(),
});
export type SkillSummary = z.infer<typeof SkillSummary>;

export const InstalledSkill = z.object({
  name: z.string(),
  sourceCatalogLabel: z.string(),
  sourcePath: z.string(),
  installedPaths: z.object({
    opencode: z.string().optional(),
    claudeCode: z.string().optional(),
    codex: z.string().optional(),
  }),
  contentHash: z.string(),
  installedAt: z.string(),
});
export type InstalledSkill = z.infer<typeof InstalledSkill>;

// Frontmatter is freeform YAML; we lock down only what the GUI renders.
export const SkillFrontmatter = z
  .object({
    name: z.string(),
    description: z.string(),
  })
  .passthrough();
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

export const SkillResource = z.object({
  // Path relative to the skill root.
  relPath: z.string(),
  isDirectory: z.boolean(),
  bytes: z.number().int().nonnegative().optional(),
});
export type SkillResource = z.infer<typeof SkillResource>;

export const SkillDetail = z.object({
  name: z.string(),
  catalogLabel: z.string(),
  path: z.string(),
  frontmatter: SkillFrontmatter,
  body: z.string(),
  resources: z.array(SkillResource),
  // Whether the skill currently appears in installed-skills.json.
  installedOn: z.array(Platform),
  // C4.9.2: optional remote{} block for catalogs cloned via
  // `smith skill install --from <url>`. Mirrors AgentDetail's coverage so
  // the SkillEditor chrome can render the drift chip + Sync now affordance.
  remote: RemoteBlock.optional(),
});
export type SkillDetail = z.infer<typeof SkillDetail>;
