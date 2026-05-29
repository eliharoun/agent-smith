import { describe, expect, test } from "bun:test";
import { resolveRefreshScope } from "../../src/cli/commands/knowledge/refresh-session";

describe("resolveRefreshScope (platform=codex)", () => {
  test("uses sniffed profile when present", async () => {
    const scope = await resolveRefreshScope({
      platform: "codex",
      sniff: async () => "my-agent",
    });
    expect(scope).toEqual({ agent: "my-agent", platformFilter: "codex" });
  });

  test("falls back to undefined agent when sniff returns undefined", async () => {
    const scope = await resolveRefreshScope({
      platform: "codex",
      sniff: async () => undefined,
    });
    expect(scope).toEqual({ agent: undefined, platformFilter: "codex" });
  });

  test("explicit --agent overrides sniff entirely", async () => {
    let sniffCalled = false;
    const scope = await resolveRefreshScope({
      agent: "forced",
      platform: "codex",
      sniff: async () => {
        sniffCalled = true;
        return "other";
      },
    });
    expect(sniffCalled).toBe(false);
    expect(scope).toEqual({ agent: "forced", platformFilter: "codex" });
  });

  test("no platform flag: no sniff, no filter", async () => {
    let sniffCalled = false;
    const scope = await resolveRefreshScope({
      sniff: async () => {
        sniffCalled = true;
        return "x";
      },
    });
    expect(sniffCalled).toBe(false);
    expect(scope).toEqual({ agent: undefined, platformFilter: undefined });
  });

  test("--platform claude-code: no sniff, passes filter through", async () => {
    let sniffCalled = false;
    const scope = await resolveRefreshScope({
      platform: "claude-code",
      sniff: async () => {
        sniffCalled = true;
        return "x";
      },
    });
    expect(sniffCalled).toBe(false);
    expect(scope).toEqual({ agent: undefined, platformFilter: "claude-code" });
  });

  test("--platform opencode: no sniff, passes filter through", async () => {
    let sniffCalled = false;
    const scope = await resolveRefreshScope({
      platform: "opencode",
      sniff: async () => {
        sniffCalled = true;
        return "x";
      },
    });
    expect(sniffCalled).toBe(false);
    expect(scope).toEqual({ agent: undefined, platformFilter: "opencode" });
  });
});
