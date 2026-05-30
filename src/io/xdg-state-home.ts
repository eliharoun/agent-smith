/**
 * Shared resolver for the agent-smith XDG state root.
 *
 * Returns the absolute path that holds non-config, non-cache state — most
 * notably cloned external-repo catalogs under `<xdgStateHome>/remote/...`.
 *
 * Honors `XDG_STATE_HOME` (empty-as-unset, matching XDG semantics) and falls
 * back to `~/.local/state/agent-smith` per the XDG Base Directory Specification.
 * No I/O on import; the path is computed lazily on each call so test
 * environments that mutate env vars between tests see the change.
 *
 * Mirrors `defaultCacheRoot()` in `cache-root.ts`. Distinct from `stateHome()`
 * in `state-home.ts`, which is a misnomer reading `XDG_CONFIG_HOME` (kept
 * unchanged this release for blast-radius reasons — see spec §2).
 *
 * Consumers (rc.2): `remote-root.ts`. Future consumers should prefer this
 * over `stateHome()` for any non-config state.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export function xdgStateHome(): string {
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "agent-smith");
  return join(homedir(), ".local", "state", "agent-smith");
}
