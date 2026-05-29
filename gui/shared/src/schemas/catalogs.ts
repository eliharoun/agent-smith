import { z } from "zod";
import { RemoteBlock } from "./remote";

export const RegistryKind = z.enum(["agent", "skill"]);
export type RegistryKind = z.infer<typeof RegistryKind>;

// Union of agent + skill kinds. The GUI displays this as the catalog "type".
export const CatalogKindAny = z.enum([
  // skill kinds:
  "user-global",
  "user-local",
  "team-shared",
  // agent-only kinds (user-global already shared above):
  "project",
  "registered",
]);
export type CatalogKindAny = z.infer<typeof CatalogKindAny>;

// [v1-task RC2-7] Smith ownership of the on-disk clone.
//   'managed' — clone was created by `smith ... install --from <url>`
//               (Source/SkillCatalog carries a `remote{}` block). Smith
//               owns the directory; `unregister --purge-clone` is safe.
//   'linked'  — user-owned path; smith never wrote into it. No `remote{}`
//               block. `--purge-clone` is rejected for this mode.
export const CatalogMode = z.enum(["managed", "linked"]);
export type CatalogMode = z.infer<typeof CatalogMode>;

export const CatalogEntry = z.object({
  registryKind: RegistryKind,
  kind: CatalogKindAny,
  // [v1-task RC2-7] Required. Computed server-side: 'managed' iff the
  // on-disk Source/SkillCatalog has a `remote{}` block, else 'linked'.
  mode: CatalogMode,
  label: z.string(),
  rootPath: z.string(),
  gitRemote: z.string().optional(),
  // [v1-task RC2-7] Mirror of on-disk Remote block for managed catalogs.
  // Absent for linked catalogs. Lets the GUI render drift state without
  // a second round-trip (parity with AgentSummary.remote / SkillSummary.remote).
  remote: RemoteBlock.optional(),
  adhoc: z.boolean().optional(),
  protected: z.boolean().optional(),
  // Lightweight on-disk health reading at fetch time.
  health: z.object({
    exists: z.boolean(),
    isGitRepo: z.boolean().optional(),
    bundleCount: z.number().int().nonnegative().optional(),
    skillCount: z.number().int().nonnegative().optional(),
  }),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

export const CatalogList = z.array(CatalogEntry);
export type CatalogList = z.infer<typeof CatalogList>;
