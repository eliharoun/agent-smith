import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Source } from "../core/types";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively discover agent bundle directories under `rootPath`.
 *
 * Mirrors discoverSkills (src/io/skill-discovery.ts): descend from rootPath,
 * skip .git/node_modules, guard symlink cycles via a visited set keyed on
 * realpath, swallow permission errors, and STOP descending the instant a
 * directory holds an agent.config.json (leaf-on-manifest). Gives agents the
 * same depth-independence skills already have, while the registered catalog
 * rootPath stays the git clone root (never a subdir).
 *
 * The root itself may be a single-bundle (rootPath/agent.config.json). We
 * record it when present BUT still walk its children, so a hybrid
 * root+children layout surfaces both (see tests/io/sources.test.ts).
 *
 * Note: a symlinked agent.config.json is followed (parity with how
 * discoverSkills reads SKILL.md). Directory-cycle protection is preserved.
 */
export async function discoverAgentBundleDirs(rootPath: string): Promise<string[]> {
  const out: string[] = [];
  const visited = new Set<string>();

  async function walk(parentPath: string, dirEntries: Dirent[]): Promise<void> {
    for (const entry of dirEntries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const entryPath = join(parentPath, entry.name);
      let isDir = false;
      let resolved = entryPath;
      if (entry.isDirectory()) {
        isDir = true;
        resolved = await realpath(entryPath).catch(() => entryPath);
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

      if (await exists(join(entryPath, "agent.config.json"))) {
        out.push(entryPath); // leaf-on-manifest: do not descend
      } else {
        try {
          const subEntries = await readdir(entryPath, { withFileTypes: true });
          await walk(entryPath, subEntries);
        } catch {
          continue; // permission error or similar — skip silently
        }
      }
    }
  }

  // Root-is-bundle: record rootPath if it holds a manifest, then STILL walk
  // its children (hybrid root+children must surface both).
  if (await exists(join(rootPath, "agent.config.json"))) {
    out.push(rootPath);
  }
  let rootEntries: Dirent[];
  try {
    rootEntries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return out;
  }
  visited.add(await realpath(rootPath).catch(() => rootPath));
  await walk(rootPath, rootEntries);
  return out;
}

export async function listAgentDirs(source: Source): Promise<string[]> {
  // ENOENT → [] (a registered clone may not exist yet); otherwise recursively
  // discover bundle dirs. discoverAgentBundleDirs handles single-bundle,
  // flat-catalog, and nested agents/<name>/ (any depth) layouts uniformly —
  // parity with discoverSkills. The source rootPath stays the git clone root.
  if (!(await exists(source.rootPath))) return [];
  return (await discoverAgentBundleDirs(source.rootPath)).sort();
}
