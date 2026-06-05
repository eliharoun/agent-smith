import { describe, expect, it } from "bun:test";
import { resolveExecutionPlatforms, renderSkippedPlatforms } from "../../src/io/platform-execution";

describe("resolveExecutionPlatforms", () => {
  it("returns intersection when no force filter is set", () => {
    const r = resolveExecutionPlatforms({
      manifestTargets: ["opencode", "claude-code", "codex", "kiro"],
      installed: new Set(["claude-code", "kiro"]),
    });
    expect(r.execution).toEqual(["claude-code", "kiro"]);
    expect(r.skipped).toEqual(["opencode", "codex"]);
    expect(r.forced).toEqual([]);
  });

  it("preserves manifest order in execution and skipped", () => {
    const r = resolveExecutionPlatforms({
      manifestTargets: ["kiro", "claude-code", "opencode", "codex"],
      installed: new Set(["opencode", "kiro"]),
    });
    expect(r.execution).toEqual(["kiro", "opencode"]);
    expect(r.skipped).toEqual(["claude-code", "codex"]);
  });

  it("treats forceFilter as the desired set; undetected forced go to forced AND execution", () => {
    const r = resolveExecutionPlatforms({
      manifestTargets: ["opencode", "claude-code", "codex", "kiro"],
      installed: new Set(["claude-code"]),
      forceFilter: ["opencode", "claude-code"],
    });
    expect(r.execution).toEqual(["opencode", "claude-code"]);
    expect(r.forced).toEqual(["opencode"]);
    expect(r.skipped).toEqual([]);
  });

  it("empty manifestTargets returns all-empty plan", () => {
    const r = resolveExecutionPlatforms({
      manifestTargets: [],
      installed: new Set(["claude-code"]),
    });
    expect(r.execution).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.forced).toEqual([]);
  });

  it("forceFilter narrows manifestTargets — anything outside both lists is dropped", () => {
    const r = resolveExecutionPlatforms({
      manifestTargets: ["claude-code", "kiro"],
      installed: new Set(["claude-code", "kiro"]),
      forceFilter: ["claude-code"],
    });
    expect(r.execution).toEqual(["claude-code"]);
    expect(r.skipped).toEqual([]);
  });

  it("empty installed set: everything goes to skipped (no force)", () => {
    const r = resolveExecutionPlatforms({
      manifestTargets: ["opencode", "claude-code"],
      installed: new Set(),
    });
    expect(r.execution).toEqual([]);
    expect(r.skipped).toEqual(["opencode", "claude-code"]);
  });
});

describe("renderSkippedPlatforms", () => {
  it("returns empty string when no skips", () => {
    expect(renderSkippedPlatforms({ execution: ["claude-code"], skipped: [], forced: [] })).toBe("");
  });

  it("renders one line per skipped platform", () => {
    const out = renderSkippedPlatforms({
      execution: ["claude-code"],
      skipped: ["opencode", "codex"],
      forced: [],
    });
    expect(out).toContain("opencode: not detected — skipped");
    expect(out).toContain("codex: not detected — skipped");
    expect(out).toContain("--platform");
  });

  it("renders advisory for forced platforms", () => {
    const out = renderSkippedPlatforms({
      execution: ["opencode"],
      skipped: [],
      forced: ["opencode"],
    });
    expect(out).toContain("forced");
    expect(out).toContain("opencode");
  });
});
