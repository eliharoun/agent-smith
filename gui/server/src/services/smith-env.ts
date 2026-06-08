import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SmithEnv } from "../../../shared/src/index";
import { parseEnvFile, upsertEnvLines } from "./dotenv-roundtrip";

/**
 * Daemon tunables persisted in `~/.config/agent-smith/.env`. Read/written
 * by the Daemon panel's env-tuning form; consumed by `daemon run` at
 * src/index.ts:614-615.
 *
 * Note: process env is intentionally NOT inspected. The form shows what
 * is persisted in the .env file — what the currently-spawned daemon
 * actually inherited is a separate concern (and visible via `smith
 * doctor`).
 */

const KEY_PULL = "SMITH_PULL_INTERVAL_MS";
const KEY_HEART = "SMITH_HEARTBEAT_INTERVAL_MS";

export interface SmithEnvDeps {
  /** Defaults to ~/.config/agent-smith/.env */
  envPath?: string;
}

function path(deps: SmithEnvDeps): string {
  return deps.envPath ?? join(homedir(), ".config", "agent-smith", ".env");
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function readSmithEnv(deps: SmithEnvDeps = {}): Promise<SmithEnv> {
  const p = path(deps);
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  const parsed = parseEnvFile(raw);
  const out: SmithEnv = {};
  const pull = parsePositiveInt(parsed[KEY_PULL]);
  const heart = parsePositiveInt(parsed[KEY_HEART]);
  if (pull !== undefined) out.pullIntervalMs = pull;
  if (heart !== undefined) out.heartbeatIntervalMs = heart;
  return out;
}

/**
 * Write the supplied keys to the .env file, preserving comments + unknown
 * keys. The update object is interpreted as follows:
 *
 *   - property absent       → leave existing line untouched
 *   - property set to value → upsert
 *   - property set to undefined → remove the line entirely
 *
 * The file is written with mode 0600 since the same file holds Atlassian
 * tokens (see atlassian-env.ts).
 */
export async function writeSmithEnv(
  update: { pullIntervalMs?: number | undefined; heartbeatIntervalMs?: number | undefined },
  deps: SmithEnvDeps = {},
): Promise<void> {
  const p = path(deps);
  let existing = "";
  try {
    existing = await readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const updates: Record<string, string | null> = {};
  if ("pullIntervalMs" in update) {
    updates[KEY_PULL] = update.pullIntervalMs === undefined ? null : String(update.pullIntervalMs);
  }
  if ("heartbeatIntervalMs" in update) {
    updates[KEY_HEART] =
      update.heartbeatIntervalMs === undefined ? null : String(update.heartbeatIntervalMs);
  }
  const next = upsertEnvLines(existing, updates);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, next, { mode: 0o600 });
}
