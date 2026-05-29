import { mkdir, open, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertWithin } from "../../io/assert-within";

export interface RefreshLockHandle {
  path: string;
}

const STALE_AFTER_MS = 30_000;

// Install lock has a much longer staleness threshold because full-bundle
// installs can legitimately take tens of minutes for bundles with large
// Confluence trees or many git repos. The 1h threshold matches
// pipeline.ts's cleanupStaleStageDirs threshold for stale staging dirs.
const INSTALL_STALE_AFTER_MS = 60 * 60 * 1000;

function sanitize(name: string): string {
  // Sanitize so weird ids can't escape the lock dir; matches existing
  // sanitization in src/core/knowledge/pipeline.ts (replace non-alphanum
  // with '-'). Keep at most 80 chars to stay well under PATH_MAX.
  return name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
}

function lockPath(cacheRoot: string, agent: string, sourceId: string): string {
  const safe = sanitize(`${agent}-${sourceId}`);
  return join(cacheRoot, "locks", `${safe}.lock`);
}

function manifestLockPath(agentSmithHome: string, agent: string): string {
  const safe = sanitize(agent);
  return join(agentSmithHome, "agents", safe, ".manifest.lock");
}

function installLockPath(agentSmithHome: string, agent: string): string {
  const safe = sanitize(agent);
  return join(agentSmithHome, "agents", safe, ".install.lock");
}

/** Shared try-create-or-take-over logic. Caller must ensure parent dir exists. */
async function tryAcquireAtPath(
  path: string,
  staleAfterMs: number = STALE_AFTER_MS,
): Promise<RefreshLockHandle | undefined> {
  // First try exclusive create.
  try {
    const handle = await open(path, "wx");
    await handle.close();
    return { path };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  // Already exists — check staleness.
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(path);
  } catch {
    // Race: lock vanished between EEXIST and stat. Retry once with create.
    try {
      const handle = await open(path, "wx");
      await handle.close();
      return { path };
    } catch {
      return undefined;
    }
  }
  const ageMs = Date.now() - s.mtimeMs;
  if (ageMs < staleAfterMs) return undefined;

  // Stale — take over by overwriting (refreshes mtime).
  const handle = await open(path, "w");
  await handle.close();
  return { path };
}

/** Atomically try to create a per-source refresh lock. Returns undefined if
 *  another holder has a fresh lock (< 30s old). If the existing lock is stale
 *  (>= 30s), takes it over by overwriting. */
export async function acquireRefreshLock(
  cacheRoot: string,
  agent: string,
  sourceId: string,
): Promise<RefreshLockHandle | undefined> {
  const path = lockPath(cacheRoot, agent, sourceId);
  // Defense-in-depth [v1-task B6]: sanitize() above strips path chars
  // but this is reached from multiple call paths; assert containment
  // before any IO.
  await mkdir(cacheRoot, { recursive: true });
  await assertWithin(path, cacheRoot);
  await mkdir(dirname(path), { recursive: true });
  return tryAcquireAtPath(path);
}

/** Atomically try to create a per-agent manifest lock used to serialize
 *  read-modify-write of an agent's knowledge/_manifest.json. Same staleness
 *  semantics as acquireRefreshLock. Release via releaseRefreshLock. */
export async function acquireManifestLock(
  agentSmithHome: string,
  agent: string,
): Promise<RefreshLockHandle | undefined> {
  const path = manifestLockPath(agentSmithHome, agent);
  // Defense-in-depth [v1-task B6].
  await mkdir(agentSmithHome, { recursive: true });
  await assertWithin(path, agentSmithHome);
  await mkdir(dirname(path), { recursive: true });
  return tryAcquireAtPath(path);
}

/** Acquire a per-agent install lock that serializes full-pipeline
 *  installs (CLI agent install, GUI knowledge fetch, daemon reinstall).
 *  Returns undefined when another holder has a fresh lock (< 1h old).
 *  Stale locks (>= 1h) are taken over.
 *
 *  Release via releaseRefreshLock(handle) — same handle shape. */
export async function acquireInstallLock(
  agentSmithHome: string,
  agent: string,
): Promise<RefreshLockHandle | undefined> {
  const path = installLockPath(agentSmithHome, agent);
  await mkdir(agentSmithHome, { recursive: true });
  await assertWithin(path, agentSmithHome);
  await mkdir(dirname(path), { recursive: true });
  return tryAcquireAtPath(path, INSTALL_STALE_AFTER_MS);
}

export async function releaseRefreshLock(handle: RefreshLockHandle): Promise<void> {
  await rm(handle.path, { force: true });
}
