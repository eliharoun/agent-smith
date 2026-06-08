// scripts/gui-pack-prune.ts
// Removes test artifacts (*.test.ts, *.test.tsx, __snapshots__ dirs) from the
// given roots, plus any explicitly-listed extra files. Used by `prepack` so the
// published tarball never ships tests or dev-only docs. Pure + arg-driven so it
// is unit-testable; the CLI entry prunes the GUI source trees + gui/README.md.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export function pruneGuiTests(roots: string[], extraFiles: string[] = []): string[] {
  const removed: string[] = [];
  for (const root of roots) {
    walk(root, removed);
  }
  // npm force-includes README* files it encounters while walking `files` path
  // components, ignoring .npmignore (verified). gui/README.md is dev-only, so
  // remove it here at pack time; postpack restores it via git checkout.
  for (const file of extraFiles) {
    if (existsSync(file)) {
      rmSync(file, { force: true });
      removed.push(file);
    }
  }
  return removed;
}

function readEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // missing dir — nothing to prune
  }
}

function walk(dir: string, removed: string[]): void {
  for (const entry of readEntries(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__snapshots__") {
        rmSync(full, { recursive: true, force: true });
        removed.push(full);
      } else {
        walk(full, removed);
      }
    } else if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) {
      rmSync(full, { force: true });
      removed.push(full);
    }
  }
}

if (import.meta.main) {
  // Safety: refuse to prune unless the target trees are pristine. `postpack`
  // restores via `git checkout -- <targets>`, which only recreates files
  // tracked at HEAD. So `git diff --quiet` (working-tree-vs-index only) is NOT
  // enough — it would pass with a staged-but-uncommitted edit (silently
  // discarded on restore) or, worse, an UNTRACKED new test file (permanently
  // lost, since checkout can't recreate it). `git status --porcelain` reports
  // modified, staged, AND untracked entries, so any output means "not safe to
  // prune". This trades convenience for zero risk of data loss.
  const targets = ["gui/server/src", "gui/shared/src"];
  const extraFiles = ["gui/README.md"];
  // Guard every path we delete-and-restore, so postpack's `git checkout` can
  // always recreate exactly what was removed.
  const guarded = [...targets, ...extraFiles];
  const proc = Bun.spawnSync(["git", "status", "--porcelain", "--", ...guarded]);
  if (proc.stdout.toString().trim() !== "") {
    console.error(
      `prepack: refusing to prune — uncommitted or untracked changes under ${guarded.join(", ")}. ` +
        "Commit, stash, or remove them first (postpack restores only files tracked at HEAD).",
    );
    process.exit(1);
  }
  const removed = pruneGuiTests(targets, extraFiles);
  console.error(
    `prepack: pruned ${removed.length} artifact(s) from the GUI trees. ` +
      "If pack is interrupted, restore with: git checkout -- gui/server/src gui/shared/src gui/README.md",
  );
}
