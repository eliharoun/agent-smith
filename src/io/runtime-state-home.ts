import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolver for XDG_STATE_HOME-rooted runtime artifacts:
 *   - <runtimeStateHome>/daemon.pid
 *   - <runtimeStateHome>/daemon.heartbeat.json
 *   - <runtimeStateHome>/daemon.log
 *   - <runtimeStateHome>/gui-jobs.jsonl
 *   - <runtimeStateHome>/gui-jobs-output/
 *   - <runtimeStateHome>/remote/
 *
 * Honors `XDG_STATE_HOME` (empty-as-unset XDG semantics), falls back to
 * `~/.local/state/agent-smith`. Mirrors `defaultStateRoot()` in
 * `gui/server/src/services/cache-paths.ts` — keep in sync.
 *
 * Distinct from `stateHome()` in `src/io/state-home.ts`, which resolves
 * the XDG_CONFIG_HOME root for persistent configuration (registry.json,
 * USER.md, .env, agents/, knowledge/). The naming collision is
 * intentional historical scar tissue — see plan recommendation Change 6
 * (out of scope for this commit).
 */
export function runtimeStateHome(): string {
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "agent-smith");
  return join(homedir(), ".local", "state", "agent-smith");
}
