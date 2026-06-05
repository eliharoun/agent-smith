import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlatformId } from "./platform-detect";

/**
 * A skipped operation queued for later replay (e.g., by a future
 * `smith sync` command). When a command would have written to a platform
 * that isn't detected, it records a PendingOp so the breadcrumb is
 * preserved.
 */
export interface PendingOp {
  /** Schema version for forward-compat. Bumped when fields change shape. */
  schemaVersion: 1;
  agent: string;
  command: string;
  platform: PlatformId;
  queuedAt: string;
  manifestTargetAtQueue: PlatformId[];
}

/**
 * Write the pending op to:
 *   <stateRoot>/pending/<command>/<agent>/<platform>.json
 *
 * Idempotent: re-recording the same (command, agent, platform) tuple
 * overwrites the previous entry.
 *
 * Concurrency note: writes use `writeFile` which is not atomic against
 * parallel smith processes writing to the same file. The risk is benign —
 * last-writer-wins gives a valid PendingOp either way, just possibly a
 * slightly older queuedAt. If telemetry later shows races causing
 * user-visible problems, swap in an atomic write (write to temp file +
 * rename) wrapper.
 */
export async function recordPendingOp(stateRoot: string, op: PendingOp): Promise<void> {
  const dir = join(stateRoot, "pending", op.command, op.agent);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${op.platform}.json`);
  await writeFile(path, JSON.stringify(op, null, 2));
}

export interface ListOpts {
  platform?: PlatformId;
  agent?: string;
}

/**
 * List all pending ops under <stateRoot>/pending/. Skips malformed JSON
 * files silently. Returns [] when the dir is missing.
 */
export async function listPendingOps(
  stateRoot: string,
  opts: ListOpts = {},
): Promise<PendingOp[]> {
  const root = join(stateRoot, "pending");
  const out: PendingOp[] = [];
  let commands: string[];
  try {
    commands = await readdir(root);
  } catch {
    return [];
  }
  for (const command of commands) {
    const commandDir = join(root, command);
    let agents: string[];
    try {
      agents = await readdir(commandDir);
    } catch {
      continue;
    }
    for (const agent of agents) {
      if (opts.agent && agent !== opts.agent) continue;
      const agentDir = join(commandDir, agent);
      let files: string[];
      try {
        files = await readdir(agentDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const platform = file.slice(0, -5);
        if (opts.platform && platform !== opts.platform) continue;
        try {
          const raw = await readFile(join(agentDir, file), "utf8");
          const parsed = JSON.parse(raw) as PendingOp;
          out.push(parsed);
        } catch {
          // Skip malformed files silently — the runner side will refuse
          // to act on anything it can't validate, so a bad file here is
          // best treated as "doesn't exist."
        }
      }
    }
  }
  return out;
}

/**
 * Remove pending ops matching the filter. Either `platform` or `agent`
 * must be set; clearing everything requires explicit iteration.
 */
export async function clearPendingOps(stateRoot: string, opts: ListOpts): Promise<void> {
  const ops = await listPendingOps(stateRoot, opts);
  for (const op of ops) {
    const path = join(stateRoot, "pending", op.command, op.agent, `${op.platform}.json`);
    await rm(path, { force: true });
  }
}
