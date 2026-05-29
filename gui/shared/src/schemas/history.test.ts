import { describe, expect, it } from "bun:test";
import { JobHistoryEntry, JobHistorySearchHit } from "./history";

describe("JobHistoryEntry", () => {
  it("accepts a well-formed entry", () => {
    const r = JobHistoryEntry.safeParse({
      id: "abc-123",
      command: "doctor",
      argvPreview: "smith doctor --json",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_001_000,
      exitCode: 0,
      durationMs: 1000,
      outputAvailable: true,
    });
    expect(r.success).toBe(true);
  });
  it("rejects negative durations", () => {
    const r = JobHistoryEntry.safeParse({
      id: "x",
      command: "doctor",
      argvPreview: "smith doctor",
      startedAt: 1,
      endedAt: 0,
      exitCode: 0,
      durationMs: -1,
      outputAvailable: false,
    });
    expect(r.success).toBe(false);
  });

  it("accepts optional degraded and warnings fields", () => {
    const r = JobHistoryEntry.safeParse({
      id: "abc-123",
      command: "knowledge.fetch",
      argvPreview: "smith knowledge fetch",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_001_000,
      exitCode: 0,
      durationMs: 1000,
      outputAvailable: true,
      degraded: true,
      warnings: ["warn: page not reachable"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.degraded).toBe(true);
      expect(r.data.warnings).toEqual(["warn: page not reachable"]);
    }
  });

  it("accepts entries without degraded/warnings (backward compat)", () => {
    const r = JobHistoryEntry.safeParse({
      id: "abc-123",
      command: "doctor",
      argvPreview: "smith doctor",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_001_000,
      exitCode: 0,
      durationMs: 1000,
      outputAvailable: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.degraded).toBeUndefined();
      expect(r.data.warnings).toBeUndefined();
    }
  });
});

describe("JobHistorySearchHit", () => {
  it("accepts a hit with optional context", () => {
    expect(
      JobHistorySearchHit.safeParse({
        jobId: "j1",
        lineNumber: 42,
        matchedLine: "ERROR: oops",
        contextBefore: ["info"],
        contextAfter: ["trace"],
      }).success,
    ).toBe(true);
    expect(
      JobHistorySearchHit.safeParse({
        jobId: "j1",
        lineNumber: 1,
        matchedLine: "x",
      }).success,
    ).toBe(true);
  });
});
