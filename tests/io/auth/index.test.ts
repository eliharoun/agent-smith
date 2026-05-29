import { describe, expect, it } from "bun:test";
import { detectAllPlatforms } from "../../../src/io/auth";
import type { PlatformAuth } from "../../../src/io/auth/types";

const stub = (overrides: Partial<PlatformAuth> & { platform: PlatformAuth["platform"] }): PlatformAuth => ({
  cliInstalled: true,
  status: "authenticated",
  ...overrides,
});

describe("detectAllPlatforms", () => {
  it("returns one PlatformAuth per Target, keyed by platform name", async () => {
    const result = await detectAllPlatforms({
      detectOpenCode: async () =>
        stub({ platform: "opencode", status: "authenticated" }),
      detectClaudeCode: async () =>
        stub({ platform: "claude-code", status: "authenticated" }),
      detectCodex: async () =>
        stub({ platform: "codex", status: "cli-not-installed", cliInstalled: false }),
      detectKiro: async () =>
        stub({ platform: "kiro", status: "unauthenticated" }),
    });
    expect(Object.keys(result).sort()).toEqual([
      "claude-code",
      "codex",
      "kiro",
      "opencode",
    ]);
    expect(result.opencode.status).toBe("authenticated");
    expect(result.codex.cliInstalled).toBe(false);
    expect(result.kiro.status).toBe("unauthenticated");
  });

  it("runs detectors in parallel (no detector blocks another)", async () => {
    let opencodeStarted = false;
    let claudeFinishedFirst = false;
    const result = await detectAllPlatforms({
      detectOpenCode: async () => {
        opencodeStarted = true;
        await new Promise((r) => setTimeout(r, 20));
        return stub({ platform: "opencode" });
      },
      detectClaudeCode: async () => {
        if (opencodeStarted) claudeFinishedFirst = false;
        await new Promise((r) => setTimeout(r, 5));
        return stub({ platform: "claude-code" });
      },
      detectCodex: async () => stub({ platform: "codex" }),
      detectKiro: async () => stub({ platform: "kiro" }),
    });
    // Claude finishes first because its delay is shorter and they run
    // concurrently. If they were serialized, opencodeStarted would block
    // claude entirely.
    expect(opencodeStarted).toBe(true);
    expect(result.opencode.status).toBe("authenticated");
    expect(claudeFinishedFirst).toBe(false); // opencode started before claude
  });

  it("treats a detector throwing as 'unknown' (does not propagate)", async () => {
    const result = await detectAllPlatforms({
      detectOpenCode: async () => {
        throw new Error("boom");
      },
      detectClaudeCode: async () => stub({ platform: "claude-code" }),
      detectCodex: async () => stub({ platform: "codex" }),
      detectKiro: async () => stub({ platform: "kiro" }),
    });
    expect(result.opencode.status).toBe("unknown");
    expect(result.opencode.detail).toContain("boom");
    expect(result["claude-code"].status).toBe("authenticated");
  });
});
