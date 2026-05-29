// gui/server/src/services/load-remotes.ts
//
// C4.1.4 (v1-task): build rootPath→RemoteBlock lookups for the agent and
// skill registries. Used by the list/detail routes to feed the projections
// (agentWithRemote / skillWithRemote).
//
// Design choices:
//   - Reads the on-disk CLI shape directly rather than going through
//     parseRegistry (which translates to GUI shape and drops `remote`).
//   - Validates each remote block with RemoteBlock.safeParse so a single
//     malformed entry doesn't poison the whole map; instead it's silently
//     skipped and we log a warning. This matches the defensive posture of
//     parse-registry.ts (Project Rule #8).
//   - Returns an empty Map on any failure (missing file, JSON error,
//     schema mismatch). The GUI degrades to "no remote info shown" — never
//     to a 5xx — when the registry is wedged.

import { readFile } from "node:fs/promises";
import { RemoteBlock, type RemoteBlock as RemoteBlockType } from "gui-shared";

export type RemoteLookup = Map<string, RemoteBlockType>;

interface Source {
  rootPath: unknown;
  remote?: unknown;
}

async function readJson(path: string): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[load-remotes] could not read ${path}: ${(err as Error).message}`);
    }
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[load-remotes] invalid JSON in ${path}: ${(err as Error).message}`);
    return null;
  }
}

function collect(items: unknown, label: string): RemoteLookup {
  const out: RemoteLookup = new Map();
  if (!Array.isArray(items)) return out;
  for (const raw of items as Source[]) {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.rootPath !== "string" ||
      raw.remote === undefined
    ) {
      continue;
    }
    const parsed = RemoteBlock.safeParse(raw.remote);
    if (!parsed.success) {
      console.warn(
        `[load-remotes] ${label}: skip malformed remote at ${raw.rootPath}: ${parsed.error.message}`,
      );
      continue;
    }
    out.set(raw.rootPath, parsed.data);
  }
  return out;
}

/** Read agent registry.json (CLI shape v2) and return rootPath → RemoteBlock. */
export async function loadAgentRemotes(registryPath: string): Promise<RemoteLookup> {
  const json = await readJson(registryPath);
  if (!json || typeof json !== "object") return new Map();
  return collect((json as { sources?: unknown }).sources, "agents");
}

/** Read skill-catalogs.json (CLI shape v2) and return rootPath → RemoteBlock. */
export async function loadSkillRemotes(catalogsPath: string): Promise<RemoteLookup> {
  const json = await readJson(catalogsPath);
  if (!json || typeof json !== "object") return new Map();
  return collect((json as { catalogs?: unknown }).catalogs, "skills");
}
