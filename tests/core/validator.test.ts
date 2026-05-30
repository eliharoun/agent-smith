import { describe, expect, it, test } from "bun:test";
import { DEFAULT_THRESHOLDS } from "../../src/core/thresholds";
import type { CanonicalConfig } from "../../src/core/types";
import { FAIL_CHARS, validate, validateAssembledTotal } from "../../src/core/validator";

const WARN_CHARS = DEFAULT_THRESHOLDS.warnChars;

const goodConfig: CanonicalConfig = {
  schemaVersion: 1,
  name: "x",
  description: "Use to validate things",
  targets: ["opencode"],
  modelTier: "balanced",
};
const goodFiles = {
  identity: "You are a careful reviewer.\n".repeat(20),
  expertise: "You analyze code for issues.\n".repeat(60),
  soul: "You speak directly.\n".repeat(20),
  user: "You report findings clearly.\n".repeat(25),
};

describe("core/validator", () => {
  test("a well-formed bundle passes", () => {
    const result = validate({
      config: goodConfig,
      files: goodFiles,
      assembledBody: Object.values(goodFiles).join("\n---\n"),
    });
    expect(result.ok).toBe(true);
  });

  test("empty file produces an error", () => {
    const result = validate({
      config: goodConfig,
      files: { ...goodFiles, identity: "" },
      assembledBody: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("identity"))).toBe(true);
    }
  });

  test("oversized assembled body produces an error", () => {
    const huge = "x".repeat(70_000);
    const result = validate({
      config: goodConfig,
      files: goodFiles,
      assembledBody: huge,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.toLowerCase().includes("length"))).toBe(true);
    }
  });

  test("body between warn and fail thresholds is ok with a warning", () => {
    const medium = "x".repeat(40_000);
    const result = validate({
      config: goodConfig,
      files: goodFiles,
      assembledBody: medium,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.toLowerCase().includes("length"))).toBe(true);
    }
  });

  test("missing 'You ' in IDENTITY produces a warning", () => {
    const result = validate({
      config: goodConfig,
      files: { ...goodFiles, identity: "The agent reviews things." },
      assembledBody: "ok",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.includes("identity"))).toBe(true);
    }
  });

  test("'As an AI' triggers a warning", () => {
    const result = validate({
      config: goodConfig,
      files: { ...goodFiles, soul: "As an AI, You are concise." },
      assembledBody: "ok",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.toLowerCase().includes("ai"))).toBe(true);
    }
  });

  test("file outside per-file line range produces a warning, not error", () => {
    const result = validate({
      config: goodConfig,
      files: { ...goodFiles, identity: "You exist.\n" }, // 1 line, below 15
      assembledBody: "ok",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.includes("identity"))).toBe(true);
    }
  });

  test("TODO marker in IDENTITY produces an error (stub bundle must fail)", () => {
    const result = validate({
      config: goodConfig,
      files: {
        ...goodFiles,
        identity: "<!-- TODO: write second-person IDENTITY.md content -->\n",
      },
      assembledBody: "ok",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("IDENTITY.md") && e.includes("TODO"))).toBe(true);
    }
  });
});

describe("core/validator validateAssembledTotal", () => {
  it("returns ok: true for body within budget", () => {
    const body = "x".repeat(WARN_CHARS - 100);
    const result = validateAssembledTotal(body, 8000, goodConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings).toHaveLength(0);
  });

  it("returns ok: true with warning for body in soft-warn band", () => {
    // body length must be > WARN_CHARS + 8000*4 (warn threshold)
    // and <= FAIL_CHARS + 8000*4 (fail threshold)
    const body = "x".repeat(WARN_CHARS + 8000 * 4 + 1000); // just into warn band
    const result = validateAssembledTotal(body, 8000, goodConfig);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/exceeds soft limit/);
  });

  it("returns ok: false for body exceeding fail threshold", () => {
    const body = "x".repeat(FAIL_CHARS + 8000 * 4 + 100);
    const result = validateAssembledTotal(body, 8000, goodConfig);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected fail");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/exceeds hard limit/);
    expect(result.errors[0]).toMatch(/knowledge allowance/);
  });

  it("honors a per-bundle warnChars override on the assembled body", () => {
    const overriddenConfig: CanonicalConfig = {
      ...goodConfig,
      thresholds: { warnChars: 1000 },
    };
    // body is between the override (1000) and the global default (32_000).
    const body = "x".repeat(1500);
    const result = validateAssembledTotal(body, 0, overriddenConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // Emission format: "Assembled body (with knowledge) length 1500 exceeds
    // soft limit 1000 (prose budget 1000 + knowledge allowance 0)" — both
    // the body length and the override value appear.
    expect(
      result.warnings.some((w) => w.includes("1500") && w.includes("1000")),
    ).toBe(true);
  });

  it("a body within the per-bundle warnChars override produces no warning", () => {
    const overriddenConfig: CanonicalConfig = {
      ...goodConfig,
      thresholds: { warnChars: 50_000 },
    };
    // body is over the GLOBAL default (32_000) but under the override
    // (50_000). With inlineBudgetTokens=0 there is no knowledge allowance,
    // so the effective warn threshold is exactly the override.
    const body = "x".repeat(40_000);
    const result = validateAssembledTotal(body, 0, overriddenConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const charsWarnings = result.warnings.filter((w) =>
      w.toLowerCase().includes("soft limit"),
    );
    expect(charsWarnings).toEqual([]);
  });
});

describe("threshold overrides via config.thresholds", () => {
  it("suppresses an identity line-range warning when overridden", () => {
    const result = validate({
      config: {
        ...goodConfig,
        thresholds: { lineRanges: { identity: [5, 10] } },
      },
      files: {
        ...goodFiles,
        // 7 non-blank lines — within override range [5, 10] but well outside
        // the global [15, 25].
        identity: "You line1\nYou line2\nYou line3\nYou line4\nYou line5\nYou line6\nYou line7",
      },
      assembledBody: "x".repeat(100),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const identityRangeWarnings = result.warnings.filter(
      (w) => w.includes("identity") && w.includes("recommended range"),
    );
    expect(identityRangeWarnings).toEqual([]);
  });

  it("emits an identity warning with the OVERRIDDEN range in the message", () => {
    const result = validate({
      config: {
        ...goodConfig,
        thresholds: { lineRanges: { identity: [5, 10] } },
      },
      files: {
        ...goodFiles,
        // 12 non-blank lines — outside override range [5, 10]; should warn
        // with the OVERRIDE range printed, not the global default.
        identity: Array.from({ length: 12 }, (_, i) => `You line${i + 1}`).join("\n"),
      },
      assembledBody: "x".repeat(100),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const identityRangeWarnings = result.warnings.filter(
      (w) => w.includes("identity") && w.includes("recommended range"),
    );
    expect(identityRangeWarnings.length).toBe(1);
    expect(identityRangeWarnings[0]).toContain("5-10");
    expect(identityRangeWarnings[0]).not.toContain("15-25");
  });

  it("does not affect non-overridden slots", () => {
    const result = validate({
      config: {
        ...goodConfig,
        thresholds: { lineRanges: { identity: [5, 10] } },
      },
      files: {
        ...goodFiles,
        identity: Array.from({ length: 7 }, (_, i) => `You line${i + 1}`).join("\n"),
        // 5 non-blank lines, outside global soul range [15, 30].
        soul: Array.from({ length: 5 }, (_, i) => `You s${i + 1}`).join("\n"),
      },
      assembledBody: "x".repeat(100),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const soulRangeWarnings = result.warnings.filter(
      (w) => w.includes("soul") && w.includes("recommended range"),
    );
    expect(soulRangeWarnings.length).toBe(1);
    expect(soulRangeWarnings[0]).toContain("15-30");
  });

  it("emits warnChars warning at the OVERRIDDEN char limit", () => {
    const result = validate({
      config: {
        ...goodConfig,
        thresholds: { warnChars: 1000 },
      },
      files: goodFiles,
      assembledBody: "x".repeat(1500), // > overridden 1000, < global 32_000
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const charsWarnings = result.warnings.filter(
      (w) => w.toLowerCase().includes("length") && w.includes("soft limit"),
    );
    expect(charsWarnings.length).toBeGreaterThan(0);
  });

  it("does not emit a warnChars warning when override is absent and body is small", () => {
    const result = validate({
      config: goodConfig,
      files: goodFiles,
      assembledBody: "x".repeat(500),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const charsWarnings = result.warnings.filter(
      (w) => w.toLowerCase().includes("length") && w.includes("soft limit"),
    );
    expect(charsWarnings).toEqual([]);
  });
});
