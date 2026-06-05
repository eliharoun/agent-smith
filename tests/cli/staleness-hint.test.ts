import { describe, expect, test } from "bun:test";
import { inspectFailuresForStaleness } from "../../src/cli/staleness-hint";
import type { BundleLoadFailure } from "../../src/cli/load-all";

const mk = (reason: string): BundleLoadFailure => ({
  sourceKind: "user-global",
  sourceLabel: "user-global",
  bundlePath: "/x/y/z",
  reason,
});

describe("inspectFailuresForStaleness", () => {
  test("returns null for empty failures", () => {
    expect(inspectFailuresForStaleness([])).toBe(null);
  });

  test("returns null when no failure looks schema-shaped", () => {
    expect(inspectFailuresForStaleness([mk("not valid JSON: Unexpected token")])).toBe(null);
  });

  test("flags an unrecognized-key Zod message", () => {
    const hint = inspectFailuresForStaleness([
      mk("agent.config.json validation failed: knowledge.sources.0: Unrecognized key: \"lazy\""),
    ]);
    expect(hint).toContain("daemon");
    expect(hint).toContain("smith daemon stop && smith daemon start");
  });

  test("flags an invalid_union Zod message", () => {
    const hint = inspectFailuresForStaleness([
      mk("agent.config.json validation failed: knowledge.sources.0.via: Invalid input"),
    ]);
    expect(hint).toContain("daemon");
  });

  test("only emits one hint even with multiple stale-shaped failures", () => {
    const hint = inspectFailuresForStaleness([
      mk("agent.config.json validation failed: a: Unrecognized key: \"x\""),
      mk("agent.config.json validation failed: b: Unrecognized key: \"y\""),
    ]);
    expect(hint).not.toBeNull();
    expect((hint ?? "").match(/smith daemon stop/g)?.length).toBe(1);
  });
});
