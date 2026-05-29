import { describe, expect, test } from "bun:test";
import {
  formatAge,
  formatRefreshSummary,
} from "../../../src/cli/commands/knowledge/format-refresh-summary";
import type { RefreshCacheEntry } from "../../../src/core/knowledge/refresh-cache";
import type { RefreshSpec } from "../../../src/core/knowledge/types";

describe("formatAge", () => {
  const cases: Array<[number, string, string]> = [
    [0, "0s", "zero"],
    [30_000, "30s", "30 seconds"],
    [59_999, "59s", "just under a minute"],
    [60_000, "1m", "one minute boundary"],
    [59 * 60_000, "59m", "59 minutes"],
    [60 * 60_000, "1h", "one hour boundary"],
    [23 * 60 * 60_000, "23h", "23 hours"],
    [24 * 60 * 60_000, "1d", "one day boundary"],
    [6 * 24 * 60 * 60_000, "6d", "6 days"],
    [7 * 24 * 60 * 60_000, "1w", "one week boundary"],
    [30 * 24 * 60 * 60_000, "4w", "30 days = 4 weeks"],
    [-5000, "0s", "negative clamps to zero"],
  ];

  for (const [ms, expected, label] of cases) {
    test(`${label}: ${ms}ms → "${expected}"`, () => {
      expect(formatAge(ms)).toBe(expected);
    });
  }
});

describe("formatRefreshSummary", () => {
  // Pin "now" to a fixed point. All cache timestamps are relative offsets from this.
  const NOW = Date.parse("2026-05-19T12:00:00.000Z");
  const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

  const okCache = (lastOkMinutesAgo: number): RefreshCacheEntry => ({
    schemaVersion: 1,
    last_refreshed_at: minutesAgo(lastOkMinutesAgo),
    last_attempt_at: minutesAgo(lastOkMinutesAgo),
    last_error: null,
  });

  const failedCache = (
    lastOkMinutesAgo: number,
    lastAttemptMinutesAgo: number,
    err: string,
  ): RefreshCacheEntry => ({
    schemaVersion: 1,
    last_refreshed_at: minutesAgo(lastOkMinutesAgo),
    last_attempt_at: minutesAgo(lastAttemptMinutesAgo),
    last_error: err,
  });

  test("refresh undefined → install only", () => {
    expect(formatRefreshSummary({ refresh: undefined, cache: undefined, now: NOW })).toEqual({
      line: "refresh: install only (no auto-refresh)",
      failed: false,
    });
  });

  test("mode install → install only", () => {
    expect(
      formatRefreshSummary({
        refresh: { mode: "install" },
        cache: undefined,
        now: NOW,
      }),
    ).toEqual({ line: "refresh: install only (no auto-refresh)", failed: false });
  });

  test("ttl + no cache → never refreshed", () => {
    expect(
      formatRefreshSummary({ refresh: "1h" as RefreshSpec, cache: undefined, now: NOW }),
    ).toEqual({ line: "refresh: ttl 1h, never refreshed", failed: false });
  });

  test("ttl + ok + age < ttl → next in <remaining>", () => {
    // 1h ttl, last refreshed 12m ago, remaining = 48m
    expect(
      formatRefreshSummary({ refresh: "1h" as RefreshSpec, cache: okCache(12), now: NOW }),
    ).toEqual({ line: "refresh: ttl 1h, last 12m ago, ok (next in 48m)", failed: false });
  });

  test("ttl + ok + age == ttl → due now", () => {
    // 1h ttl, last refreshed exactly 60m ago
    expect(
      formatRefreshSummary({ refresh: "1h" as RefreshSpec, cache: okCache(60), now: NOW }),
    ).toEqual({ line: "refresh: ttl 1h, last 1h ago, ok (due now)", failed: false });
  });

  test("ttl + ok + age > ttl → due now", () => {
    // 1h ttl, last refreshed 90m ago
    expect(
      formatRefreshSummary({ refresh: "1h" as RefreshSpec, cache: okCache(90), now: NOW }),
    ).toEqual({ line: "refresh: ttl 1h, last 1h ago, ok (due now)", failed: false });
  });

  test("ttl + failed → uses attempt age, red", () => {
    // 1d ttl, last ok 25h ago, last attempt 5m ago
    expect(
      formatRefreshSummary({
        refresh: "1d" as RefreshSpec,
        cache: failedCache(25 * 60, 5, "network timeout"),
        now: NOW,
      }),
    ).toEqual({
      line: "refresh: ttl 1d, last 5m ago, FAILED: network timeout",
      failed: true,
    });
  });

  test("session + no cache → never refreshed", () => {
    expect(
      formatRefreshSummary({
        refresh: { mode: "session" },
        cache: undefined,
        now: NOW,
      }),
    ).toEqual({ line: "refresh: session, never refreshed", failed: false });
  });

  test("session + ok → last <age> ago, ok", () => {
    expect(
      formatRefreshSummary({
        refresh: { mode: "session" },
        cache: okCache(3),
        now: NOW,
      }),
    ).toEqual({ line: "refresh: session, last 3m ago, ok", failed: false });
  });

  test("session + failed → red", () => {
    expect(
      formatRefreshSummary({
        refresh: { mode: "session" },
        cache: failedCache(120, 1, "boom"),
        now: NOW,
      }),
    ).toEqual({ line: "refresh: session, last 1m ago, FAILED: boom", failed: true });
  });

  test("always + ok → install + session, last <age> ago, ok", () => {
    expect(
      formatRefreshSummary({
        refresh: { mode: "always" },
        cache: okCache(2),
        now: NOW,
      }),
    ).toEqual({
      line: "refresh: install + session, last 2m ago, ok",
      failed: false,
    });
  });

  test("always + no cache → never refreshed", () => {
    expect(
      formatRefreshSummary({
        refresh: { mode: "always" },
        cache: undefined,
        now: NOW,
      }),
    ).toEqual({ line: "refresh: install + session, never refreshed", failed: false });
  });

  test("error message > 80 chars → truncated to 80 with ellipsis", () => {
    const longErr = "x".repeat(200);
    const result = formatRefreshSummary({
      refresh: "1h" as RefreshSpec,
      cache: failedCache(120, 1, longErr),
      now: NOW,
    });
    // 79 x's + ellipsis = 80 chars total in the error portion
    const expectedErr = `${"x".repeat(79)}…`;
    expect(result.line).toBe(`refresh: ttl 1h, last 1m ago, FAILED: ${expectedErr}`);
    expect(result.failed).toBe(true);
    // Sanity: count of trailing chars after "FAILED: "
    const errPart = result.line.split("FAILED: ")[1];
    expect(errPart).toHaveLength(80);
  });

  test("ttl mode with no ttl field (defense-in-depth) → '(no interval)'", () => {
    expect(
      formatRefreshSummary({
        refresh: { mode: "ttl" }, // ttl missing — validator should reject, but defensive
        cache: undefined,
        now: NOW,
      }),
    ).toEqual({ line: "refresh: ttl (no interval), never refreshed", failed: false });
  });
});
