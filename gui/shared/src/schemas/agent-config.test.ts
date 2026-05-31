import { describe, expect, it } from "bun:test";
import { AgentConfigPatch, ModelTier } from "./agent-config";

describe("ModelTier", () => {
  it("accepts the four canonical tiers", () => {
    for (const t of ["high", "balanced", "fast", "inherit"]) {
      expect(ModelTier.safeParse(t).success).toBe(true);
    }
  });
  it("rejects aliases and unknowns (GUI normalizes aliases before saving)", () => {
    expect(ModelTier.safeParse("opus").success).toBe(false);
    expect(ModelTier.safeParse("ultra").success).toBe(false);
  });
});

describe("AgentConfigPatch", () => {
  it("accepts a targets-only patch", () => {
    expect(AgentConfigPatch.safeParse({ targets: ["opencode", "kiro"] }).success).toBe(true);
  });
  it("accepts a modelTier-only patch", () => {
    expect(AgentConfigPatch.safeParse({ modelTier: "balanced" }).success).toBe(true);
  });
  it("accepts both fields together", () => {
    expect(AgentConfigPatch.safeParse({ targets: ["codex"], modelTier: "fast" }).success).toBe(
      true,
    );
  });
  it("rejects an empty patch", () => {
    expect(AgentConfigPatch.safeParse({}).success).toBe(false);
  });
  it("rejects an empty targets array", () => {
    expect(AgentConfigPatch.safeParse({ targets: [] }).success).toBe(false);
  });
  it("rejects an invalid platform", () => {
    expect(AgentConfigPatch.safeParse({ targets: ["vscode"] }).success).toBe(false);
  });
  it("rejects an unknown modelTier", () => {
    expect(AgentConfigPatch.safeParse({ modelTier: "ultra" }).success).toBe(false);
  });
});
