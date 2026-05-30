import { readdir, stat } from "node:fs/promises";
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

export async function listAgentDirs(source: Source): Promise<string[]> {
  if (!(await exists(source.rootPath))) return [];
  const out: string[] = [];
  // Single-bundle layout: a rootPath that IS the bundle (its top level holds
  // agent.config.json). This is the natural shape of `git clone <url>` for
  // a single-agent repo and is what the C-series remote install (see
  // `src/core/install-from-url.ts`) registers. Without this branch a remote
  // install succeeds at the clone+register step but the bundle is invisible
  // to `loadAllBundles`, and `agent install <name>` then fails 'not-found'.
  if (await exists(join(source.rootPath, "agent.config.json"))) {
    out.push(source.rootPath);
  }
  // Catalog layout: rootPath contains one bundle per subdirectory. This is
  // the user-global / project / hand-registered catalog shape.
  const entries = await readdir(source.rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(source.rootPath, entry.name);
    if (await exists(join(dir, "agent.config.json"))) {
      out.push(dir);
    }
  }
  return out.sort();
}
