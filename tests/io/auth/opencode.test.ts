import { describe, expect, it } from "bun:test";
import { detectOpenCodeAuth } from "../../../src/io/auth/opencode";

describe("detectOpenCodeAuth", () => {
  it("reports authenticated when auth.json contains providers", async () => {
    const result = await detectOpenCodeAuth({
      whichOpenCode: async () => "/usr/local/bin/opencode",
      readAuthFile: async () =>
        JSON.stringify({
          anthropic: { type: "oauth" },
          "github-copilot": { type: "oauth" },
        }),
      getModels: async () => undefined,
    });
    expect(result.platform).toBe("opencode");
    expect(result.status).toBe("authenticated");
    expect(result.cliInstalled).toBe(true);
    expect(result.availableModels).toBeUndefined();
    expect(result.detail).toContain("anthropic");
    expect(result.detail).toContain("github-copilot");
  });

  it("reports authenticated when only the live models list resolves", async () => {
    const result = await detectOpenCodeAuth({
      whichOpenCode: async () => "/usr/local/bin/opencode",
      readAuthFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      getModels: async () => ["anthropic/claude-opus-4-7", "openai/gpt-5"],
    });
    expect(result.status).toBe("authenticated");
    expect(result.availableModels).toEqual([
      "anthropic/claude-opus-4-7",
      "openai/gpt-5",
    ]);
    expect(result.detail).toMatch(/anthropic.*openai|openai.*anthropic/);
  });

  it("reports unauthenticated when CLI is on PATH but no creds anywhere", async () => {
    const result = await detectOpenCodeAuth({
      whichOpenCode: async () => "/usr/local/bin/opencode",
      readAuthFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      getModels: async () => undefined,
    });
    expect(result.status).toBe("unauthenticated");
    expect(result.cliInstalled).toBe(true);
    expect(result.detail).toContain("opencode auth login");
  });

  it("reports cli-not-installed when binary is missing from PATH", async () => {
    const result = await detectOpenCodeAuth({
      whichOpenCode: async () => undefined,
      readAuthFile: async () => "{}",
      getModels: async () => undefined,
    });
    expect(result.status).toBe("cli-not-installed");
    expect(result.cliInstalled).toBe(false);
  });

  it("reports unauthenticated when auth.json is empty {}", async () => {
    const result = await detectOpenCodeAuth({
      whichOpenCode: async () => "/usr/local/bin/opencode",
      readAuthFile: async () => "{}",
      getModels: async () => undefined,
    });
    expect(result.status).toBe("unauthenticated");
  });

  it("treats unparseable auth.json as unauthenticated, not unknown", async () => {
    const result = await detectOpenCodeAuth({
      whichOpenCode: async () => "/usr/local/bin/opencode",
      readAuthFile: async () => "not json",
      getModels: async () => undefined,
    });
    expect(result.status).toBe("unauthenticated");
  });
});
