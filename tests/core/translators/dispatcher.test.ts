import { describe, expect, test } from "bun:test";
import { renderForTargets } from "../../../src/core/translators";
import type { CanonicalConfig } from "../../../src/core/types";

describe("translators/dispatcher", () => {
  test("renders one entry per target", () => {
    const cfg: CanonicalConfig = {
      schemaVersion: 1,
      name: "x",
      description: "Use to do x",
      targets: ["opencode", "claude-code", "codex"],
      modelTier: "balanced",
    };
    const out = renderForTargets(cfg, "BODY", {
      opencode: undefined,
      "claude-code": undefined,
      codex: undefined,
      kiro: undefined,
    });
    expect(out).toHaveLength(3);
    const targets = out.map((r) => r.target).sort();
    expect(targets).toEqual(["claude-code", "codex", "opencode"]);
  });

  test("respects target subset", () => {
    const cfg: CanonicalConfig = {
      schemaVersion: 1,
      name: "x",
      description: "Use to do x",
      targets: ["opencode"],
      modelTier: "balanced",
    };
    const out = renderForTargets(cfg, "BODY", {
      opencode: undefined,
      "claude-code": undefined,
      codex: undefined,
      kiro: undefined,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.target).toBe("opencode");
  });
});
