// PURPOSE: prevent silent drift of CURATED_FALLBACK_V0_6_0.
// If you change the values, update CHANGELOG.md and rename the constant
// (e.g. CURATED_FALLBACK_V0_7_0). The pin protects users from a fallback
// that no longer resolves in their environments.
import { describe, expect, test } from "bun:test";
import { CURATED_FALLBACK_V0_6_0 } from "../../../src/core/model-resolution/types";

describe("CURATED_FALLBACK_V0_6_0 (pinned for release)", () => {
  test("high pin", () => {
    expect(CURATED_FALLBACK_V0_6_0.high).toBe("github-copilot/claude-opus-4.7");
  });
  test("balanced pin", () => {
    expect(CURATED_FALLBACK_V0_6_0.balanced).toBe("github-copilot/claude-sonnet-4.6");
  });
  test("fast pin", () => {
    expect(CURATED_FALLBACK_V0_6_0.fast).toBe("github-copilot/claude-haiku-4.5");
  });
});
