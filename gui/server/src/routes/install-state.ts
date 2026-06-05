import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { HttpError } from "../middleware/error";

export interface InstallStateDeps {
  /** Directory containing `installed-agents.json`. Tests inject a tmpdir. */
  agentSmithHome: string;
}

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface InstallStateEntry {
  platform: string;
  path: string;
  contentHash: string;
  installedAt: string;
  kind: "main" | "sidecar";
}

export interface InstallStateResponse {
  entries: InstallStateEntry[];
}

export function registerInstallStateRoute(app: Hono, deps: InstallStateDeps) {
  app.get("/api/agents/:name/install-state", async (c) => {
    const name = c.req.param("name");
    if (!NAME_PATTERN.test(name)) {
      throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${name}`);
    }
    const entries = await loadAndFilter(deps.agentSmithHome, name);
    const response: InstallStateResponse = { entries };
    return c.json(response);
  });
}

interface RawEntry {
  name: string;
  platform: string;
  path: string;
  contentHash: string;
  installedAt: string;
  kind?: "main" | "sidecar";
}

/**
 * Read `<agentSmithHome>/installed-agents.json` and return only entries
 * matching `agentName`. ENOENT and malformed JSON degrade to an empty list
 * so the GUI doesn't 500 on a fresh install or a corrupted manifest.
 */
async function loadAndFilter(
  agentSmithHome: string,
  agentName: string,
): Promise<InstallStateEntry[]> {
  const path = join(agentSmithHome, "installed-agents.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let parsed: { installed?: unknown } | null = null;
  try {
    parsed = JSON.parse(raw) as { installed?: unknown };
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.installed)) return [];
  const entries: InstallStateEntry[] = [];
  for (const e of parsed.installed as unknown[]) {
    if (
      typeof e !== "object" ||
      e === null ||
      typeof (e as RawEntry).name !== "string" ||
      typeof (e as RawEntry).platform !== "string" ||
      typeof (e as RawEntry).path !== "string" ||
      typeof (e as RawEntry).contentHash !== "string" ||
      typeof (e as RawEntry).installedAt !== "string"
    ) {
      continue;
    }
    const re = e as RawEntry;
    if (re.name !== agentName) continue;
    entries.push({
      platform: re.platform,
      path: re.path,
      contentHash: re.contentHash,
      installedAt: re.installedAt,
      // `kind` was added alongside sidecars; pre-sidecar manifests lack it.
      // Default to "main" so older entries surface as the canonical render.
      kind: re.kind ?? "main",
    });
  }
  return entries;
}

// Re-export the helper for re-use by drift-check, which needs the same
// filter logic to know which platforms have an active install entry.
export { loadAndFilter as loadInstallStateEntries };
