/**
 * Shared resolver for the agent-smith on-disk cache root.
 *
 * Returns the absolute path that holds:
 *   - `<cacheRoot>/locks/<safe>.lock`                      (refresh-lock.ts)
 *   - `<cacheRoot>/agents/<agent>/sources/<id>.meta.json`  (refresh-cache.ts)
 *
 * Honors `XDG_CACHE_HOME` (empty-as-unset, matching XDG semantics) and falls
 * back to `~/.cache/agent-smith`. No I/O on import; the path is computed
 * lazily on each call so test environments that mutate env vars between
 * tests see the change.
 *
 * Consumers: refresh-session-runner.ts, doctor.ts, knowledge/list.ts.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultCacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "agent-smith");
  return join(homedir(), ".cache", "agent-smith");
}
