import { readFile } from "node:fs/promises";
import { RefreshConsentManifest } from "../../../shared/src/index";
import { refreshManifestPathFor } from "./cache-paths";

export async function loadRefreshConsent(
  agent: string,
  agentSmithHome?: string,
): Promise<ReturnType<typeof RefreshConsentManifest.parse> | undefined> {
  const p = refreshManifestPathFor(agent, agentSmithHome);
  try {
    const raw = await readFile(p, "utf8");
    return RefreshConsentManifest.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
