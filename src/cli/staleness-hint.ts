import type { BundleLoadFailure } from "./load-all";

/**
 * Detect failures that look like a stale schema rejecting a forward-incompatible
 * config. Pattern-matches the formatted reason string for Zod's two signature
 * shapes:
 *   - "Unrecognized key" — schema doesn't know a top-level/nested key (e.g. a
 *     daemon running pre-v1.9.0 code rejecting a `lazy: true` URL source).
 *   - "Invalid input" inside a discriminated union path — a `via:` route doesn't
 *     match any variant the loaded schema knows about.
 */
function looksStaleShaped(reason: string): boolean {
  return (
    reason.includes("Unrecognized key") ||
    /\.via.*Invalid input/.test(reason) ||
    reason.includes("Invalid discriminator value")
  );
}

export function inspectFailuresForStaleness(
  failures: BundleLoadFailure[],
): string | null {
  if (!failures.some((f) => looksStaleShaped(f.reason))) return null;
  return (
    "→ this may be a daemon that hasn't restarted since the last smith upgrade; " +
    "run `smith daemon stop && smith daemon start` to refresh"
  );
}
