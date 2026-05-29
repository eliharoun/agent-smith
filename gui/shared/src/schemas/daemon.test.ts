import { describe, expect, it } from "bun:test";
import { DaemonStatus, SmithEnv } from "./daemon";

describe("DaemonStatus", () => {
  it("accepts the 4 states", () => {
    expect(DaemonStatus.safeParse({ state: "not-running" }).success).toBe(true);
    expect(DaemonStatus.safeParse({ state: "stale-pid", pid: 123 }).success).toBe(true);
    expect(
      DaemonStatus.safeParse({ state: "running", pid: 123, heartbeatAgeMs: 500 }).success,
    ).toBe(true);
    expect(
      DaemonStatus.safeParse({ state: "running", pid: 123, heartbeatAgeMs: null }).success,
    ).toBe(true);
    expect(DaemonStatus.safeParse({ state: "stuck", pid: 123, heartbeatAgeMs: 8000 }).success).toBe(
      true,
    );
  });
  it("rejects unknown state", () => {
    expect(DaemonStatus.safeParse({ state: "weird" }).success).toBe(false);
  });
});

describe("SmithEnv", () => {
  it("accepts empty (no overrides)", () => {
    expect(SmithEnv.safeParse({}).success).toBe(true);
  });
  it("accepts positive integers only", () => {
    expect(SmithEnv.safeParse({ pullIntervalMs: 60000 }).success).toBe(true);
    expect(SmithEnv.safeParse({ pullIntervalMs: 0 }).success).toBe(false);
    expect(SmithEnv.safeParse({ pullIntervalMs: -1 }).success).toBe(false);
    expect(SmithEnv.safeParse({ heartbeatIntervalMs: 3000 }).success).toBe(true);
  });
});
