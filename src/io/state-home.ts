/**
 * Shared resolver for the agent-smith on-disk CONFIG root.
 *
 * Returns the absolute path that holds:
 *   - <stateHome>/registry.json            (agent registry)
 *   - <stateHome>/USER.md                  (user manifest)
 *   - <stateHome>/skill-catalogs.json      (skill registry)
 *   - <stateHome>/agents/<name>/           (per-agent state)
 *   - <stateHome>/installed-skills.json    (skill install state)
 *   - <stateHome>/.env                     (atlassian creds)
 *   - <stateHome>/gui-state.json           (GUI state)
 *
 * Daemon runtime files (`daemon.pid`, `daemon.heartbeat.json`,
 * `daemon.log`) are NOT hosted here — they live under
 * `runtimeStateHome()` (XDG_STATE_HOME, `~/.local/state/agent-smith/`).
 * That's the correct XDG bucket for ephemeral runtime state. See
 * `src/io/runtime-state-home.ts` and the docs/2026-05-27 design note.
 *
 * Note: the function name says "stateHome" but resolves XDG_CONFIG_HOME.
 * This is historical scar tissue; renaming it is tracked separately.
 *
 * Honors `XDG_CONFIG_HOME` (empty-as-unset, matching XDG semantics) and falls
 * back to `~/.config/agent-smith`. No I/O on import; the path is computed
 * lazily on each call so test environments that mutate env vars between
 * tests see the change. Mirrors `defaultCacheRoot()` in `cache-root.ts`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export function stateHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "agent-smith");
  return join(homedir(), ".config", "agent-smith");
}
