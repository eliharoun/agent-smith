/**
 * Pure-by-DI unit tests for `checkLazyFetch`. Asserts the six branches the
 * doctor section needs to surface:
 *
 *   1. non-lazy bundle → no findings (skip).
 *   2. lazy URL on a target with WebFetch + no via → no findings.
 *   3. lazy URL on a target without WebFetch + no via → error finding.
 *   4. lazy URL with mixed targets where at least one has WebFetch → no findings.
 *   5. lazy URL with `via.server` not in `readAvailable` → warning finding.
 *   6. lazy URL with `via.server` in `readAvailable` → no findings.
 *
 * No real homedir / `~/.claude.json` reads — the `readAvailable` seam returns
 * an in-memory map.
 */
import { describe, expect, it } from "bun:test";
import { checkLazyFetch } from "../../../src/core/freshness/check-lazy-fetch";

const lazyUrlSrc = {
  id: "wiki",
  type: "webpage" as const,
  url: "https://example.com/x",
  lazy: true,
  description: "A wiki.",
};

describe("checkLazyFetch", () => {
  it("returns no findings for a non-lazy bundle", async () => {
    const findings = await checkLazyFetch({
      bundles: [
        { name: "agent-a", targets: ["claude-code"], sources: [], mcp: { required: [] } },
      ],
      readAvailable: async () => ({}),
    });
    expect(findings).toEqual([]);
  });

  it("returns no findings when target has webfetch and source has no via", async () => {
    const findings = await checkLazyFetch({
      bundles: [
        { name: "agent-a", targets: ["claude-code"], sources: [lazyUrlSrc], mcp: { required: [] } },
      ],
      readAvailable: async () => ({}),
    });
    expect(findings).toEqual([]);
  });

  it("flags when ALL targets lack webfetch AND source has no via", async () => {
    const findings = await checkLazyFetch({
      bundles: [
        { name: "agent-a", targets: ["codex"], sources: [lazyUrlSrc], mcp: { required: [] } },
      ],
      readAvailable: async () => ({}),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.agent).toBe("agent-a");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toMatch(/codex|fetch tool|runtime fetch/i);
  });

  it("does not flag when at least one target supports webfetch", async () => {
    const findings = await checkLazyFetch({
      bundles: [
        {
          name: "agent-a",
          targets: ["codex", "claude-code"],
          sources: [lazyUrlSrc],
          mcp: { required: [] },
        },
      ],
      readAvailable: async () => ({}),
    });
    expect(findings).toEqual([]);
  });

  it("flags when via.server is not installed", async () => {
    const withVia = { ...lazyUrlSrc, via: { server: "internal-mcp", tool: "fetch_page" } };
    const findings = await checkLazyFetch({
      bundles: [
        {
          name: "agent-a",
          targets: ["claude-code"],
          sources: [withVia],
          mcp: { required: ["internal-mcp"] },
        },
      ],
      readAvailable: async () => ({}),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toMatch(/internal-mcp.*not installed/i);
  });

  it("does not flag when via.server is installed", async () => {
    const withVia = { ...lazyUrlSrc, via: { server: "internal-mcp", tool: "fetch_page" } };
    const findings = await checkLazyFetch({
      bundles: [
        {
          name: "agent-a",
          targets: ["claude-code"],
          sources: [withVia],
          mcp: { required: ["internal-mcp"] },
        },
      ],
      readAvailable: async () => ({
        "internal-mcp": { command: "/usr/bin/internal-mcp", args: [] },
      }),
    });
    expect(findings).toEqual([]);
  });
});
