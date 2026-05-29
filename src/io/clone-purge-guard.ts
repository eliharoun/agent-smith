// src/io/clone-purge-guard.ts
//
// [v1-task RC2-9] Single source of truth for the safety checks that gate
// `smith {agent,skill} unregister --purge-clone`. Both unregister entry
// points delegate here so the policy lives in one place — no drift
// between agent and skill registries.
//
// Pre-rm sanity ladder (all must pass; first failure throws SmithError):
//
//   1. mode === 'managed' — the source/catalog MUST carry a `remote{}`
//      block. Linked catalogs (user-owned paths) are never purged via
//      this flag even if their rootPath happens to live under
//      defaultRemoteRoot() (defensive: a hand-edited registry could
//      otherwise turn this flag into an arbitrary `rm -rf`).
//
//   2. cloneDir is inside defaultRemoteRoot() — even a managed catalog
//      whose rootPath was relocated outside the smith-owned clone tree
//      (e.g. by a rename, or by an older smith version that wrote
//      elsewhere) is refused. This is the same containment check the
//      pre-RC2-9 unregister already performed; kept here for layered
//      defense.
//
//   3. cloneDir/.git exists — a managed catalog whose .git was deleted
//      out from under us is suspicious. Refuse rather than risk wiping
//      something the user moved files into.
//
//   4. The repo's `origin` URL matches the recorded `remote.url` after
//      normalization. Catches the case where the user did
//      `git remote set-url origin ...` to point at a different repo
//      after smith cloned it — that other repo's files are no longer
//      what smith is authorized to delete.
//
// All failures throw SmithError{ code: 'usage-error' } with an actionable
// message. The caller (unregister) wraps this in a try/catch so the
// registry mutation is never persisted when the guard refuses.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { SmithError } from "../core/smith-error";
import { catalogMode } from "../core/source-mode";
import { getOriginRemote } from "./git";
import { sameGitRemote } from "./git-url";
import { defaultRemoteRoot } from "./remote-root";

/**
 * Test seam for the `getOriginRemote` lookup so unit tests can stub the
 * git subprocess. Production callers pass nothing and the real helper
 * (with its 2s timeout) is used.
 */
export interface ClonePurgeGuardDeps {
  remoteRoot?: string;
  /** Returns the `origin` URL of the repo at `cwd`, or undefined. */
  readOrigin?: (cwd: string) => Promise<string | undefined>;
}

/**
 * Throws a SmithError{usage-error} if the pre-rm checks fail.
 *
 * @param source — the Source or SkillCatalog whose clone we're about to
 *   rm -rf. We need the `remote` field (mode discriminator + URL to
 *   compare) and the `rootPath` (the dir we're about to delete).
 */
export async function assertSafeToPurgeClone(
  source: { rootPath: string; remote?: { url: string } | undefined },
  deps: ClonePurgeGuardDeps = {},
): Promise<void> {
  // 1. mode check.
  if (catalogMode(source) !== "managed") {
    throw new SmithError({
      code: "usage-error",
      message:
        `purge-clone refused: catalog is linked (no remote{} provenance). ` +
        `--purge-clone is only valid for catalogs cloned by smith via ` +
        `install --from <url>. Remove the directory yourself if intended.`,
    });
  }

  // 2. containment.
  const root = deps.remoteRoot ?? defaultRemoteRoot();
  if (!isInside(source.rootPath, root)) {
    throw new SmithError({
      code: "usage-error",
      message:
        `purge-clone refused: ${source.rootPath} is outside remote-clones root ${root}. ` +
        `Only catalogs cloned under <stateHome>/remote can be purged via this flag.`,
    });
  }

  // 3. .git existence sanity.
  const gitDir = join(source.rootPath, ".git");
  let gitExists = false;
  try {
    const st = await stat(gitDir);
    gitExists = st.isDirectory() || st.isFile(); // gitfile / submodule shape
  } catch {
    gitExists = false;
  }
  if (!gitExists) {
    throw new SmithError({
      code: "usage-error",
      message:
        `purge-clone refused: ${source.rootPath} has no .git directory. ` +
        `Refusing to wipe a non-repo path — the directory may have been ` +
        `replaced or recovered manually. Use unregister without --purge-clone, ` +
        `then delete the directory yourself if intended.`,
    });
  }

  // 4. origin URL sanity. Use the test-injectable readOrigin so unit
  // tests can avoid spawning git; production uses the real helper with
  // its 2s timeout. getOriginRemote returns undefined on any failure
  // (no origin, hung process, no git binary) — we treat that as a hard
  // refuse so a broken repo can't slip past.
  const readOrigin = deps.readOrigin ?? ((cwd: string) => getOriginRemote(cwd));
  const actualOrigin = await readOrigin(source.rootPath);
  // `source.remote` is guaranteed defined by check 1 above; assert via
  // a narrowing local so TS knows.
  const recorded = source.remote;
  if (!recorded) {
    // Unreachable given check 1, but be explicit.
    throw new SmithError({ code: "usage-error", message: "purge-clone: missing remote{} block" });
  }
  if (!actualOrigin) {
    throw new SmithError({
      code: "usage-error",
      message:
        `purge-clone refused: could not read 'origin' URL from ${source.rootPath}. ` +
        `The repo may be broken or 'origin' was removed. Run ` +
        `\`git -C ${source.rootPath} remote -v\` to inspect, then unregister ` +
        `without --purge-clone if you still want to remove the registry entry.`,
    });
  }
  if (!sameGitRemote(actualOrigin, recorded.url)) {
    throw new SmithError({
      code: "usage-error",
      message:
        `purge-clone refused: 'origin' URL (${actualOrigin}) does not match ` +
        `registered remote.url (${recorded.url}). The clone may have been ` +
        `repointed via 'git remote set-url'. Refusing to delete a directory ` +
        `that tracks a different repo than smith recorded.`,
    });
  }
}

function isInside(target: string, root: string): boolean {
  const rootWithSep = root.endsWith("/") ? root : `${root}/`;
  return target === root || target.startsWith(rootWithSep);
}
