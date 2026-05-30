import { describe, expect, test } from "bun:test";
import { validate } from "../../src/core/validator";
import type { CanonicalConfig } from "../../src/core/types";

function bundle(over: Partial<CanonicalConfig>): {
  config: CanonicalConfig;
  files: { identity: string; expertise: string; soul: string; user: string };
  assembledBody: string;
} {
  return {
    config: {
      schemaVersion: 1,
      name: "x",
      description: "Use proactively for tests",
      targets: ["opencode"],
      modelTier: "high",
      ...over,
    },
    files: {
      identity: "I am.\n".repeat(15),
      expertise: "I do.\n".repeat(55),
      soul: "I feel.\n".repeat(15),
      user: "I note.\n".repeat(20),
    },
    assembledBody: "x".repeat(200),
  };
}

describe("validator: model field info-notes", () => {
  test("model set on config without opencode target -> info-note", () => {
    const r = validate(
      bundle({
        targets: ["claude-code", "codex"],
        model: "github-copilot/claude-opus-4.7",
      }),
    );
    expect(
      r.warnings.some((w) => /model.*has no effect.*targets do not include opencode/i.test(w)),
    ).toBe(true);
  });

  test("both model and modelTier set -> info-note about claude-code using tier", () => {
    const r = validate(
      bundle({
        targets: ["opencode", "claude-code"],
        model: "github-copilot/claude-opus-4.7",
        modelTier: "high",
      }),
    );
    expect(
      r.warnings.some((w) => /model.*override set.*modelTier.*claude-code only/i.test(w)),
    ).toBe(true);
  });

  test("model set on opencode-only target -> no model-related info-note", () => {
    const r = validate(
      bundle({
        targets: ["opencode"],
        model: "github-copilot/claude-opus-4.7",
      }),
    );
    // No "no effect" note (opencode IS in targets).
    expect(
      r.warnings.some((w) => /model.*has no effect/i.test(w)),
    ).toBe(false);
    // No "claude-code only" note (claude-code NOT in targets).
    expect(
      r.warnings.some((w) => /model.*override.*claude-code/i.test(w)),
    ).toBe(false);
  });

  test("no model field -> no model-related notes", () => {
    const r = validate(bundle({ targets: ["opencode"] }));
    // Match only the model-field info-notes (which use the literal "'model'" prefix),
    // not unrelated warnings that happen to contain the substring "model"
    // (e.g. the "model roleplay/disclaimer modes" warning on persona files).
    expect(r.warnings.some((w) => /'model'/i.test(w))).toBe(false);
  });
});
