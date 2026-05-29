// src/io/lazy-clone.ts
//
// rc.5: skill catalogs registered by default in defaultSkillRegistry()
// (currently just atlassian-skills) point at a clone location that may
// not exist on disk yet. ensureCloneExists() clones via cloneOrFetch()
// when called against such a catalog, on first reference by any skill
// command (list, install, sync).
//
// No-op when:
//   - catalog has no gitRemote (linked, never auto-clone)
//   - rootPath already exists on disk (clone already happened)
//
// Throws SmithError on clone failure (network, git auth, etc.) — the
// caller propagates to the user.

import { stat } from "node:fs/promises";
import { cloneOrFetch } from "./git-clone";

export interface EnsureCloneDeps {
  cloneFn?: typeof cloneOrFetch;
  pathExists?: (path: string) => Promise<boolean>;
}

export async function ensureCloneExists(
  catalog: {
    rootPath: string;
    gitRemote?: string;
    remote?: { url: string; ref: string } | undefined;
  },
  deps: EnsureCloneDeps = {},
): Promise<void> {
  if (!catalog.gitRemote) return;
  const exists = deps.pathExists ?? defaultPathExists;
  if (await exists(catalog.rootPath)) return;
  const clone = deps.cloneFn ?? cloneOrFetch;
  await clone({
    url: catalog.gitRemote,
    ref: catalog.remote?.ref ?? "HEAD",
    targetDir: catalog.rootPath,
  });
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
