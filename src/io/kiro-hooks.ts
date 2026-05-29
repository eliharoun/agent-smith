/**
 * Surgical add/remove of smith's refresh-session entry inside a kiro agent
 * JSON file's `hooks.agentSpawn[]` array. Adapted from
 * src/io/claude-code-hooks.ts for JSON instead of YAML+frontmatter.
 *
 * Co-resident entries (AIM telemetry hooks, kiro-lens auto-injection,
 * user-authored hooks) are preserved byte-for-byte. Smith only touches
 * its own entries — identified by an ownership signature on the
 * `command` field.
 *
 * Ownership signature: an entry is smith-owned iff its `command` field
 * contains BOTH substrings:
 *   - "smith knowledge refresh-session"
 *   - "--agent <name>"  (matches the specific agent — prevents collateral
 *                        removal when multiple smith-managed kiro agents
 *                        share the file by accident)
 *
 * Mirrors the signature pattern in claude-code-hooks.ts.
 */

import { readFile, writeFile } from "node:fs/promises";
import { SmithError } from "../core/smith-error";

const REFRESH_COMMAND_PREFIX = "smith knowledge refresh-session";

/**
 * Deep-sort object keys for deterministic JSON output. Matches the
 * sortKeysDeep used by installer.ts so re-registering a hook produces the
 * same on-disk bytes the installer would have produced.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
  }
  return out;
}

function serializeKiroAgent(data: Record<string, unknown>): string {
  return `${JSON.stringify(sortKeysDeep(data), null, 2)}\n`;
}

function isSmithOwned(entry: unknown, agent: string): boolean {
  if (!entry || typeof entry !== "object") return false;
  const cmd = (entry as { command?: unknown }).command;
  if (typeof cmd !== "string") return false;
  return cmd.includes(REFRESH_COMMAND_PREFIX) && cmd.includes(`--agent ${agent}`);
}

function findSmithEntryIndex(data: Record<string, unknown>, agent: string): number | null {
  const hooks = data.hooks as Record<string, unknown> | undefined;
  const agentSpawn = hooks?.agentSpawn;
  if (!Array.isArray(agentSpawn)) return null;
  for (let i = 0; i < agentSpawn.length; i++) {
    if (isSmithOwned(agentSpawn[i], agent)) return i;
  }
  return null;
}

function buildSmithEntry(agent: string): Record<string, unknown> {
  return { command: `smith knowledge refresh-session --agent ${agent} --platform kiro` };
}

/**
 * Add the smith refresh-session hook to `<agentJsonPath>` if not already
 * present. Idempotent on re-register — duplicate signature → no-op.
 *
 * Throws `SmithError("not-found")` when the file is absent. Defense-in-
 * depth for direct callers; the install path catches non-installed agents
 * earlier so this only fires on programmatic misuse.
 */
export async function registerKiroRefreshHook(
  agentJsonPath: string,
  agent: string,
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(agentJsonPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SmithError({
        code: "not-found",
        what: "kiro agent file",
        identifier: agentJsonPath,
      });
    }
    throw err;
  }

  const data = JSON.parse(raw) as Record<string, unknown>;
  if (findSmithEntryIndex(data, agent) !== null) {
    // Idempotent: smith entry already present.
    return;
  }

  // Lazy-init the nested containers. The kiro schema accepts a missing
  // `hooks` field; we add only what we need.
  const hooks = (data.hooks ??= {} as Record<string, unknown>) as Record<string, unknown>;
  const agentSpawn = (hooks.agentSpawn ??= [] as unknown[]) as unknown[];
  agentSpawn.push(buildSmithEntry(agent));

  await writeFile(agentJsonPath, serializeKiroAgent(data), "utf8");
}

/**
 * Remove the smith refresh-session hook from `<agentJsonPath>` if present.
 * No-op on missing file or missing smith entry. Surgical: only the matching
 * entry is removed; co-resident hooks are preserved.
 *
 * Drains empty containers: if `agentSpawn[]` becomes empty, deletes the
 * key; if `hooks{}` becomes empty, deletes the field. This keeps re-
 * register/unregister cycles producing the same on-disk shape as a fresh
 * install (no orphan empty arrays).
 */
export async function unregisterKiroRefreshHook(
  agentJsonPath: string,
  agent: string,
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(agentJsonPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  const data = JSON.parse(raw) as Record<string, unknown>;
  const idx = findSmithEntryIndex(data, agent);
  if (idx === null) return; // idempotent

  const hooks = data.hooks as Record<string, unknown>;
  const agentSpawn = hooks.agentSpawn as unknown[];
  agentSpawn.splice(idx, 1);

  if (agentSpawn.length === 0) {
    delete hooks.agentSpawn;
  }
  if (Object.keys(hooks).length === 0) {
    delete data.hooks;
  }

  await writeFile(agentJsonPath, serializeKiroAgent(data), "utf8");
}
