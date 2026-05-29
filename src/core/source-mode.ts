// src/core/source-mode.ts
//
// Single source of truth for the "managed vs linked" derivation that
// surfaces in CLI badges, GUI chips, doctor checks, and the
// --purge-clone guard.
//
// Definitions:
//   - "managed" — smith owns the on-disk clone. Source has a `remote`
//     block; smith manages clone/update/purge. Typical: catalogs added
//     via `smith install --from <url>`.
//   - "linked"  — user owns the on-disk path. `remote` is undefined.
//     smith only tracks the path; never deletes it via --purge-clone.
//     Typical: `smith agent register /path/to/local/repo` without
//     --git-remote, or any user-global / project-local fixture path.
//
// The discriminator is structural — purely the presence of `remote` —
// so this helper works equally for Source (agent registry) and
// SkillCatalog (skill registry) inputs. Any future shape with an
// optional `{ remote?: { url: string } }` field gets the same treatment
// for free.

export type CatalogMode = "managed" | "linked";

export function catalogMode(s: { remote?: { url: string } | undefined }): CatalogMode {
  return s.remote ? "managed" : "linked";
}
