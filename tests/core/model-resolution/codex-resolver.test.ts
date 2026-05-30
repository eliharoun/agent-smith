// tests/core/model-resolution/codex-resolver.test.ts
import { describe, expect, test } from "bun:test";
import { resolveCodexModel } from "../../../src/core/model-resolution/codex";
import { makeWarningCollector } from "../../../src/core/model-resolution/types";

const authedDetect = async () => ({
  platform: "codex" as const,
  cliInstalled: true,
  status: "authenticated" as const,
});
const env = {
  getOpenCodeModels: async () => undefined,
  warnings: makeWarningCollector(),
  detectCodexAuth: authedDetect,
};

describe("resolveCodexModel", () => {
  test("returns a tier literal for each non-inherit tier when authenticated", async () => {
    // Note: the codex translator does NOT actually consume this value
    // (codex.ts intentionally omits `model:` from frontmatter), so the
    // returned literal is informational — surfaced in the doctor's tier
    // preview so users see what the platform would resolve to.
    for (const t of ["high", "balanced", "fast"] as const) {
      const r = await resolveCodexModel(
        {
          schemaVersion: 1,
          name: "x",
          description: "Use proactively",
          targets: ["codex"],
          modelTier: t,
        },
        env,
      );
      expect(typeof r).toBe("string");
      expect(r?.length).toBeGreaterThan(0);
    }
  });

  test("returns undefined for tier 'inherit'", async () => {
    const r = await resolveCodexModel(
      {
        schemaVersion: 1,
        name: "x",
        description: "Use proactively",
        targets: ["codex"],
        modelTier: "inherit",
      },
      env,
    );
    expect(r).toBeUndefined();
  });

  test("honors canonical.model override (parity with siblings)", async () => {
    const r = await resolveCodexModel(
      {
        schemaVersion: 1,
        name: "x",
        description: "Use proactively",
        targets: ["codex"],
        modelTier: "high",
        model: "gpt-5-pro-2026",
      },
      env,
    );
    expect(r).toBe("gpt-5-pro-2026");
  });
});
