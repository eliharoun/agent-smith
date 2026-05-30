import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REFRESH,
  DEFAULT_TIMEOUT_SECONDS,
  isModeAllowedForType,
  parseRefresh,
  parseTtlToMs,
} from "../../../src/core/knowledge/refresh-spec";

describe("parseRefresh", () => {
  test("undefined → default (install mode)", () => {
    expect(parseRefresh(undefined)).toEqual({ mode: "install" });
  });

  test("DEFAULT_REFRESH is install mode", () => {
    expect(DEFAULT_REFRESH).toEqual({ mode: "install" });
  });

  test("string 'never' → { mode: 'install' }", () => {
    expect(parseRefresh("never")).toEqual({ mode: "install" });
  });

  test.each([
    ["1h", 60 * 60 * 1000],
    ["1d", 24 * 60 * 60 * 1000],
    ["1w", 7 * 24 * 60 * 60 * 1000],
  ] as const)("string '%s' → { mode: 'ttl', ttl: '%s', ttlMs }", (raw, ms) => {
    expect(parseRefresh(raw)).toEqual({ mode: "ttl", ttl: raw, ttlMs: ms });
  });

  test("object form passes through with defaults", () => {
    expect(parseRefresh({ mode: "session" })).toEqual({ mode: "session" });
  });

  test("object form preserves ttl and timeout and attaches ttlMs", () => {
    expect(parseRefresh({ mode: "ttl", ttl: "30m", timeout: 10 })).toEqual({
      mode: "ttl",
      ttl: "30m",
      timeout: 10,
      ttlMs: 30 * 60 * 1000,
    });
  });

  test("string shorthand '30m' → ttlMs 1800000", () => {
    expect(parseRefresh("30m" as never)).toEqual({
      mode: "ttl",
      ttl: "30m",
      ttlMs: 30 * 60 * 1000,
    });
  });

  test("object form { mode: 'ttl', ttl: '1h' } attaches ttlMs", () => {
    expect(parseRefresh({ mode: "ttl", ttl: "1h" })).toEqual({
      mode: "ttl",
      ttl: "1h",
      ttlMs: 60 * 60 * 1000,
    });
  });

  test("object form with mode=always preserves all fields", () => {
    expect(parseRefresh({ mode: "always", timeout: 3 })).toEqual({
      mode: "always",
      timeout: 3,
    });
  });

  test("DEFAULT_TIMEOUT_SECONDS is 5", () => {
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(5);
  });
});

describe("parseTtlToMs", () => {
  test.each([
    ["30s", 30_000],
    ["5m", 5 * 60_000],
    ["1h", 60 * 60_000],
    ["2d", 2 * 24 * 60 * 60_000],
    ["1w", 7 * 24 * 60 * 60_000],
  ] as const)("'%s' → %d ms", (input, expected) => {
    expect(parseTtlToMs(input)).toBe(expected);
  });

  test.each([
    "30",
    "30x",
    "h",
    "1.5h",
    "",
    "1 h",
    "-1h",
  ])("rejects invalid format '%s'", (input) => {
    expect(() => parseTtlToMs(input)).toThrow(/invalid ttl format/);
  });
});

describe("isModeAllowedForType", () => {
  test.each(["file", "dir", "glob"] as const)("static type '%s' only allows install", (type) => {
    expect(isModeAllowedForType(type, "install")).toBe(true);
    expect(isModeAllowedForType(type, "ttl")).toBe(false);
    expect(isModeAllowedForType(type, "session")).toBe(false);
    expect(isModeAllowedForType(type, "always")).toBe(false);
  });

  test.each([
    "url",
    "git",
    "confluence",
    "jira",
  ] as const)("remote type '%s' allows all modes", (type) => {
    expect(isModeAllowedForType(type, "install")).toBe(true);
    expect(isModeAllowedForType(type, "ttl")).toBe(true);
    expect(isModeAllowedForType(type, "session")).toBe(true);
    expect(isModeAllowedForType(type, "always")).toBe(true);
  });
});
