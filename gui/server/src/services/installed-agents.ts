// Read-only access to ~/.config/agent-smith/installed-agents.json for the GUI.
// Mirrors gui/server/src/services/installed-skills.ts for the agents manifest
// introduced in Task 1.1. Best-effort: returns [] on missing or malformed file
// so the GUI never bricks on a corrupted manifest.

import { readFile } from "node:fs/promises";

export interface InstalledAgentEntry {
  name: string;
  platform: string;
  path: string;
  contentHash: string;
  installedAt: string;
}

export interface InstalledAgentsDeps {
  /** Absolute path to ~/.config/agent-smith/installed-agents.json */
  path: string;
}

export async function loadInstalledAgents(
  deps: InstalledAgentsDeps,
): Promise<InstalledAgentEntry[]> {
  let raw: string;
  try {
    raw = await readFile(deps.path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { installed?: unknown }).installed)
  ) {
    return [];
  }
  return (parsed as { installed: unknown[] }).installed.filter(
    (e): e is InstalledAgentEntry =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as InstalledAgentEntry).name === "string" &&
      typeof (e as InstalledAgentEntry).platform === "string" &&
      typeof (e as InstalledAgentEntry).path === "string" &&
      typeof (e as InstalledAgentEntry).contentHash === "string" &&
      typeof (e as InstalledAgentEntry).installedAt === "string",
  );
}
