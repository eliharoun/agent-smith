// Parse the --platform-conventions CLI flag value. v1 ships scalar-only
// values per design Q11 simplification (per-target syntax deferred until
// >= 2 platforms register conventions).

import { SmithError } from "../core/smith-error";
import type { DefaultStrategy } from "../io/conventions";

const VALID: ReadonlySet<DefaultStrategy> = new Set([
  "accept-all",
  "reject-all",
  "use-defaults",
  "prompt",
]);

/**
 * Parse the `--platform-conventions <value>` flag. Returns the strategy
 * literal or `undefined` when the flag is absent. Throws SmithError on
 * unknown values so the user gets a clean error before any downstream work.
 *
 * Per-target syntax (e.g. `kiro=workspace-steering,gs;claude-code=...`)
 * is deferred until >= 2 platforms register conventions.
 */
export function parsePlatformConventions(
  value: string | undefined,
): DefaultStrategy | undefined {
  if (value === undefined) return undefined;
  if (VALID.has(value as DefaultStrategy)) return value as DefaultStrategy;
  throw new SmithError({
    code: "usage-error",
    message: `--platform-conventions: unknown value '${value}'. Valid: ${[...VALID].join(", ")}`,
  });
}
