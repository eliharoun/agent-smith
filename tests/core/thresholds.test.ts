import { describe, expect, it } from "bun:test";

import type { CanonicalConfig } from "../../src/core/types";
import {
  DEFAULT_THRESHOLDS,
  getEffectiveThresholds,
} from "../../src/core/thresholds";

// Minimal fixture: only the fields validator actually reads matter; the merge
// helper only touches `config.thresholds`. Cast through `as` to avoid having
// to construct a full bundle config for every test.
const baseConfig = (overrides: Partial<CanonicalConfig> = {}): CanonicalConfig =>
  ({
    schemaVersion: 1,
    name: "x",
    description: "x",
    targets: ["opencode"],
    modelTier: "balanced",
    ...overrides,
  }) as CanonicalConfig;

describe("getEffectiveThresholds", () => {
  it("returns DEFAULT_THRESHOLDS when no override is present", () => {
    const result = getEffectiveThresholds(baseConfig());
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("returns DEFAULT_THRESHOLDS when thresholds is an empty object", () => {
    const result = getEffectiveThresholds(baseConfig({ thresholds: {} }));
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("overrides only the slots present in lineRanges", () => {
    const result = getEffectiveThresholds(
      baseConfig({ thresholds: { lineRanges: { identity: [5, 10] } } }),
    );
    expect(result.lineRanges.identity).toEqual([5, 10]);
    expect(result.lineRanges.expertise).toEqual(
      DEFAULT_THRESHOLDS.lineRanges.expertise,
    );
    expect(result.lineRanges.soul).toEqual(
      DEFAULT_THRESHOLDS.lineRanges.soul,
    );
    expect(result.lineRanges.user).toEqual(
      DEFAULT_THRESHOLDS.lineRanges.user,
    );
  });

  it("overrides all four lineRanges slots when fully specified", () => {
    const result = getEffectiveThresholds(
      baseConfig({
        thresholds: {
          lineRanges: {
            identity: [1, 2],
            expertise: [3, 4],
            soul: [5, 6],
            user: [7, 8],
          },
        },
      }),
    );
    expect(result.lineRanges).toEqual({
      identity: [1, 2],
      expertise: [3, 4],
      soul: [5, 6],
      user: [7, 8],
    });
  });

  it("overrides warnChars in isolation", () => {
    const result = getEffectiveThresholds(
      baseConfig({ thresholds: { warnChars: 12345 } }),
    );
    expect(result.warnChars).toBe(12345);
    expect(result.lineRanges).toEqual(DEFAULT_THRESHOLDS.lineRanges);
  });

  it("overrides lineRanges and warnChars together", () => {
    const result = getEffectiveThresholds(
      baseConfig({
        thresholds: {
          lineRanges: { user: [50, 60] },
          warnChars: 50_000,
        },
      }),
    );
    expect(result.lineRanges.user).toEqual([50, 60]);
    expect(result.lineRanges.identity).toEqual(
      DEFAULT_THRESHOLDS.lineRanges.identity,
    );
    expect(result.warnChars).toBe(50_000);
  });

  it("does not mutate DEFAULT_THRESHOLDS", () => {
    const before = JSON.stringify(DEFAULT_THRESHOLDS);
    getEffectiveThresholds(
      baseConfig({ thresholds: { lineRanges: { identity: [1, 2] } } }),
    );
    expect(JSON.stringify(DEFAULT_THRESHOLDS)).toBe(before);
  });

  it("returned arrays do not share references with DEFAULT_THRESHOLDS (no-override path)", () => {
    const result = getEffectiveThresholds(baseConfig());
    result.lineRanges.expertise.push(999);
    expect(DEFAULT_THRESHOLDS.lineRanges.expertise).toEqual([40, 100]);
  });

  it("returned arrays do not share references with DEFAULT_THRESHOLDS (override path)", () => {
    const result = getEffectiveThresholds(
      baseConfig({ thresholds: { lineRanges: { identity: [5, 10] } } }),
    );
    // Mutating an un-overridden slot must not leak.
    result.lineRanges.expertise.push(999);
    expect(DEFAULT_THRESHOLDS.lineRanges.expertise).toEqual([40, 100]);
    // Mutating an overridden slot must not leak back to the user's config.
    result.lineRanges.identity.push(777);
    // Re-derive and confirm fresh: a second call returns clean values.
    const second = getEffectiveThresholds(
      baseConfig({ thresholds: { lineRanges: { identity: [5, 10] } } }),
    );
    expect(second.lineRanges.identity).toEqual([5, 10]);
  });
});

describe("DEFAULT_THRESHOLDS", () => {
  it("matches the historical hardcoded values from validator.ts", () => {
    // These are the values formerly at src/core/validator.ts:20-25 and the
    // WARN_CHARS at line 4. Locked here so an accidental edit to one half
    // (defaults vs. validator usage) is caught.
    expect(DEFAULT_THRESHOLDS).toEqual({
      lineRanges: {
        identity: [15, 25],
        expertise: [40, 100],
        soul: [15, 30],
        user: [20, 40],
      },
      warnChars: 32_000,
    });
  });
});
