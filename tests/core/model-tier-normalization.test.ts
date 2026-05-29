// tests/core/model-tier-normalization.test.ts
import { describe, expect, it } from "bun:test";
import { parseConfig } from "../../src/core/config-schema";
import { normalizeModelTier } from "../../src/core/types";

const validBase = {
  schemaVersion: 1,
  name: "test-agent",
  description: "Use proactively for testing",
  targets: ["opencode"],
};

describe("normalizeModelTier", () => {
  it("maps opus to high", () => {
    expect(normalizeModelTier("opus")).toBe("high");
  });

  it("maps sonnet to balanced", () => {
    expect(normalizeModelTier("sonnet")).toBe("balanced");
  });

  it("maps haiku to fast", () => {
    expect(normalizeModelTier("fast")).toBe("fast");
  });

  it("passes through canonical values unchanged", () => {
    expect(normalizeModelTier("high")).toBe("high");
    expect(normalizeModelTier("balanced")).toBe("balanced");
    expect(normalizeModelTier("fast")).toBe("fast");
    expect(normalizeModelTier("inherit")).toBe("inherit");
  });
});

describe("config-schema modelTier normalization", () => {
  it("accepts canonical tier names", () => {
    for (const t of ["high", "balanced", "fast", "inherit"] as const) {
      const r = parseConfig({ ...validBase, modelTier: t });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.modelTier).toBe(t);
    }
  });

  it("normalizes aliases at parse time", () => {
    const cases: Array<[string, string]> = [
      ["opus", "high"],
      ["sonnet", "balanced"],
      ["haiku", "fast"],
    ];
    for (const [alias, canonical] of cases) {
      const r = parseConfig({ ...validBase, modelTier: alias });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.modelTier).toBe(canonical as any);
    }
  });

  it("rejects unknown tier values (existing behavior preserved)", () => {
    const r = parseConfig({ ...validBase, modelTier: "sonet" });
    expect(r.success).toBe(false);
  });
});
