import type { CanonicalConfig } from "./types";

export type FileSlot = "identity" | "expertise" | "soul" | "user";

export interface Thresholds {
  lineRanges: Record<FileSlot, [number, number]>;
  warnChars: number;
}

/**
 * The validator's global threshold defaults. A bundle can override any of
 * these via its `agent.config.json` `thresholds` field; see
 * `getEffectiveThresholds()` for the merge semantics.
 *
 * History note: these were inline constants in `src/core/validator.ts`
 * (`FILE_LINE_RANGES` and `WARN_CHARS`) before being centralized here.
 * `FAIL_CHARS` (the hard error gate) intentionally stays in validator.ts
 * because it is not overridable.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  lineRanges: {
    identity: [15, 25],
    expertise: [40, 100],
    soul: [15, 30],
    user: [20, 40],
  },
  warnChars: 32_000,
};

/**
 * Merge a bundle's optional `thresholds` config with the global defaults.
 * Returns the effective thresholds the validator should use for this bundle.
 *
 * Semantics:
 * - If `config.thresholds` is absent or `{}`, the result equals
 *   `DEFAULT_THRESHOLDS`.
 * - Within `lineRanges`, each slot is merged independently — overriding
 *   `identity` does not affect `expertise`, `soul`, or `user`.
 * - `warnChars` is replaced as a scalar.
 * - Defaults are never mutated. The returned object is fully fresh: both
 *   the top-level shape AND the inner per-slot arrays are deep-copied,
 *   so a downstream consumer that mutates the result cannot leak back
 *   into `DEFAULT_THRESHOLDS` or into the caller's user config.
 */
export function getEffectiveThresholds(config: CanonicalConfig): Thresholds {
  const override = config.thresholds;
  if (!override) {
    return {
      lineRanges: cloneRanges(DEFAULT_THRESHOLDS.lineRanges),
      warnChars: DEFAULT_THRESHOLDS.warnChars,
    };
  }

  const merged = cloneRanges(DEFAULT_THRESHOLDS.lineRanges);
  const overrideRanges = override.lineRanges ?? {};
  for (const slot of ["identity", "expertise", "soul", "user"] as const) {
    const value = overrideRanges[slot];
    if (value !== undefined) merged[slot] = [value[0], value[1]];
  }

  return {
    lineRanges: merged,
    warnChars: override.warnChars ?? DEFAULT_THRESHOLDS.warnChars,
  };
}

function cloneRanges(
  ranges: Record<FileSlot, [number, number]>,
): Record<FileSlot, [number, number]> {
  return {
    identity: [ranges.identity[0], ranges.identity[1]],
    expertise: [ranges.expertise[0], ranges.expertise[1]],
    soul: [ranges.soul[0], ranges.soul[1]],
    user: [ranges.user[0], ranges.user[1]],
  };
}
