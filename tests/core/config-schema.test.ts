import { describe, expect, it, test } from "bun:test";
import {
  CanonicalConfigSchema,
  formatZodError,
  parseConfig,
} from "../../src/core/config-schema";

describe("core/config-schema", () => {
  test("accepts a minimal valid config", () => {
    const result = parseConfig({
      name: "my-agent",
      description: "Use proactively to do X",
      targets: ["opencode"],
      modelTier: "balanced",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("my-agent");
  });

  test("rejects non-kebab-case names", () => {
    const result = parseConfig({
      name: "MyAgent",
      description: "x",
      targets: ["opencode"],
      modelTier: "balanced",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.startsWith("name:"))).toBe(true);
    }
  });

  test("rejects empty targets array", () => {
    const result = parseConfig({
      name: "x",
      description: "y",
      targets: [],
      modelTier: "balanced",
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown target", () => {
    const result = parseConfig({
      name: "x",
      description: "y",
      targets: ["windsurf"],
      modelTier: "balanced",
    });
    expect(result.success).toBe(false);
  });

  test("rejects modelTier outside the allowed set", () => {
    const result = parseConfig({
      name: "x",
      description: "y",
      targets: ["opencode"],
      modelTier: "gpt-5",
    });
    expect(result.success).toBe(false);
  });

  test("temperature must be 0..1 if present", () => {
    const ok = parseConfig({
      name: "x",
      description: "Use proactively to do X",
      targets: ["opencode"],
      modelTier: "balanced",
      temperature: 0.7,
    });
    expect(ok.success).toBe(true);

    const bad = parseConfig({
      name: "x",
      description: "y",
      targets: ["opencode"],
      modelTier: "balanced",
      temperature: 1.5,
    });
    expect(bad.success).toBe(false);
  });

  test("description must start with action phrase (heuristic: starts with capital verb)", () => {
    const bad = parseConfig({
      name: "x",
      description: "for doing things",
      targets: ["opencode"],
      modelTier: "balanced",
    });
    expect(bad.success).toBe(false);
  });

  test("CanonicalConfigSchema is exported and is a zod schema", () => {
    expect(typeof CanonicalConfigSchema.parse).toBe("function");
  });

  test("accepts permission with bare action values", () => {
    const result = parseConfig({
      name: "x",
      description: "Use proactively to do X",
      targets: ["opencode"],
      modelTier: "balanced",
      permission: { read: "allow", bash: "deny" },
    });
    expect(result.success).toBe(true);
  });

  test("accepts permission with per-pattern record values", () => {
    const result = parseConfig({
      name: "x",
      description: "Use proactively to do X",
      targets: ["opencode"],
      modelTier: "balanced",
      permission: { bash: { "git *": "allow", "*": "deny" } },
    });
    expect(result.success).toBe(true);
  });

  test("accepts 'ask' as a permission action", () => {
    const result = parseConfig({
      name: "x",
      description: "Use proactively to do X",
      targets: ["opencode"],
      modelTier: "balanced",
      permission: { edit: "ask" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects permission with an invalid action string", () => {
    const result = parseConfig({
      name: "x",
      description: "Use proactively to do X",
      targets: ["opencode"],
      modelTier: "balanced",
      permission: { read: "yes" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("read"))).toBe(true);
    }
  });

  test("rejects permission with array value", () => {
    const result = parseConfig({
      name: "x",
      description: "Use proactively to do X",
      targets: ["opencode"],
      modelTier: "balanced",
      permission: { read: ["a", "b"] },
    });
    expect(result.success).toBe(false);
  });

  test("permission is optional and absent on the parsed result when omitted", () => {
    const result = parseConfig({
      name: "x",
      description: "Use proactively to do X",
      targets: ["opencode"],
      modelTier: "balanced",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.permission).toBeUndefined();
  });
});

describe("mcp dependency block", () => {
  // Round-trip: bundles declaring v1.2 mcp.required[]/mcp.peer[] must
  // survive parseConfig. Before this test the schema silently stripped
  // the block (zod's default behavior on unknown top-level keys), so
  // every recipient of a shared bundle saw `config.mcp === undefined`
  // and the install pipeline never enforced declared dependencies.
  it("preserves mcp.required and mcp.peer through parseConfig", () => {
    const result = parseConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["claude-code"],
      modelTier: "balanced",
      mode: "all",
      permission: { read: "allow" },
      mcp: { required: ["a"], peer: ["b"] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcp).toEqual({ required: ["a"], peer: ["b"] });
    }
  });

  it("rejects unknown keys inside the mcp block (strict object)", () => {
    const result = parseConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["opencode"],
      modelTier: "balanced",
      mcp: { required: ["a"], unknownKey: "oops" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty server names inside mcp.required", () => {
    const result = parseConfig({
      name: "x",
      description: "Use to test things.",
      targets: ["opencode"],
      modelTier: "balanced",
      mcp: { required: [""] },
    });
    expect(result.success).toBe(false);
  });
});

describe("CanonicalConfigSchema with knowledge", () => {
  const base = {
    name: "x",
    description: "Use to do things.",
    targets: ["opencode"],
    modelTier: "balanced",
  };

  it("accepts a config with no knowledge block", () => {
    const r = parseConfig(base);
    expect(r.success).toBe(true);
  });

  it("accepts a config with a valid knowledge block", () => {
    const r = parseConfig({
      ...base,
      knowledge: {
        inlineBudget: { totalTokens: 4000 },
        sources: [{ id: "schema", type: "file", path: "./x.md", delivery: "inline" }],
      },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.knowledge?.sources?.[0]?.id).toBe("schema");
  });

  it("rejects a config with an invalid knowledge source", () => {
    const r = parseConfig({
      ...base,
      knowledge: { sources: [{ id: "x", type: "file", delivery: "inline" }] }, // missing path
    });
    expect(r.success).toBe(false);
  });
});

describe("parseConfig flattened result", () => {
  it("returns errors as string[] formatted '<path>: <message>'", () => {
    const result = parseConfig({ name: "Bad Name", description: "x" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(Array.isArray(result.errors)).toBe(true);
    const joined = result.errors.join("\n");
    expect(joined).toContain("name:");
    expect(joined).toContain("description:");
    for (const e of result.errors) {
      expect(e).toMatch(/^[a-zA-Z0-9_.()-]+: /);
    }
  });

  it("uses '(root)' for top-level shape errors", () => {
    const result = parseConfig("not an object");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errors.some((e) => e.startsWith("(root):"))).toBe(true);
  });
});

describe("formatZodError", () => {
  it("formats issues identically to parseConfig.errors", () => {
    const parsed = CanonicalConfigSchema.safeParse({ name: "Bad Name" });
    if (parsed.success) throw new Error("expected failure");
    const formatted = formatZodError(parsed.error);
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted[0]).toMatch(/^[a-zA-Z0-9_.()-]+: /);
  });
});

describe("thresholds field", () => {
  // Match the inline-base pattern used by `CanonicalConfigSchema with knowledge`
  // above (line 167+). description satisfies the action-phrase regex.
  const base = {
    schemaVersion: 1,
    name: "test",
    description: "Use to do things.",
    targets: ["opencode"],
    modelTier: "balanced",
  };

  it("accepts a config without thresholds", () => {
    const result = CanonicalConfigSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts thresholds as an empty object", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid lineRanges.identity tuple", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { lineRanges: { identity: [10, 20] } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts lineRanges.identity when min === max (boundary)", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { lineRanges: { identity: [1, 1] } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects lineRanges.identity when max < min", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { lineRanges: { identity: [25, 15] } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error)).toContain("max must be >= min");
    }
  });

  it("rejects lineRanges.identity when min < 1", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { lineRanges: { identity: [0, 10] } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects lineRanges.identity when values are non-integers", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { lineRanges: { identity: [10.5, 20] } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects lineRanges.identity when array length != 2", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { lineRanges: { identity: [10] } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects lineRanges.identity when array length > 2", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { lineRanges: { identity: [10, 20, 30] } },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid warnChars value", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { warnChars: 10_000 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects warnChars = 0", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { warnChars: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects warnChars when negative", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { warnChars: -100 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects warnChars when non-integer", () => {
    const result = CanonicalConfigSchema.safeParse({
      ...base,
      thresholds: { warnChars: 100.5 },
    });
    expect(result.success).toBe(false);
  });
});
