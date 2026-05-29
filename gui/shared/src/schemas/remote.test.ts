// C4.1.1 (v1-task): RemoteBlock — shared schema for the registry remote{}
// block exposed on AgentSummary/SkillSummary so the GUI can render drift
// state. Mirrors the on-disk Remote interface in src/core/types.ts but
// lives in gui-shared so both server and web import a single source of
// truth.

import { describe, expect, it } from "bun:test";
import { RemoteBlock } from "./remote";

describe("RemoteBlock (C4.1.1)", () => {
  it("accepts minimal shape (url + ref string)", () => {
    const r = RemoteBlock.parse({ url: "https://x/y/z.git", ref: "main" });
    expect(r.url).toBe("https://x/y/z.git");
    expect(r.ref).toBe("main");
    expect(r.lastPulledSha).toBeUndefined();
  });

  it("accepts full shape with all optional fields populated", () => {
    const r = RemoteBlock.parse({
      url: "https://x/y/z.git",
      ref: "main",
      lastPulledSha: "a".repeat(40),
      lastPulledAt: "2026-05-25T10:00:00.000Z",
      lastRemoteSha: "b".repeat(40),
      lastCheckedAt: "2026-05-25T10:05:00.000Z",
    });
    expect(r.lastPulledSha).toBe("a".repeat(40));
    expect(r.lastRemoteSha).toBe("b".repeat(40));
  });

  it("rejects null ref (Remote.ref is a required string per src/core/types.ts)", () => {
    expect(() => RemoteBlock.parse({ url: "https://x/y/z.git", ref: null })).toThrow();
  });

  it("rejects empty url", () => {
    expect(() => RemoteBlock.parse({ url: "", ref: "main" })).toThrow();
  });

  it("rejects non-ISO date strings", () => {
    expect(() =>
      RemoteBlock.parse({
        url: "https://x/y/z.git",
        ref: "main",
        lastPulledAt: "yesterday",
      }),
    ).toThrow();
  });

  it("rejects non-40-hex SHA", () => {
    expect(() =>
      RemoteBlock.parse({
        url: "https://x/y/z.git",
        ref: "main",
        lastPulledSha: "not-a-sha",
      }),
    ).toThrow();
  });
});
