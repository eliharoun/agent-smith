import { describe, expect, it } from "bun:test";
import { detectClaudeCodeAuth } from "../../../src/io/auth/claude-code";

describe("detectClaudeCodeAuth", () => {
  it("reports authenticated when settings.json has non-empty availableModels", async () => {
    const result = await detectClaudeCodeAuth({
      whichClaude: async () => "/usr/local/bin/claude",
      readSettings: async () =>
        JSON.stringify({
          model: "opus",
          availableModels: ["opus", "sonnet"],
        }),
      runAuthStatus: async () => undefined,
    });
    expect(result.platform).toBe("claude-code");
    expect(result.cliInstalled).toBe(true);
    expect(result.status).toBe("authenticated");
    expect(result.availableModels).toEqual(["opus", "sonnet"]);
    expect(result.detail).toContain("opus");
  });

  it("falls back to `claude auth status --json` when settings.json lacks availableModels", async () => {
    const result = await detectClaudeCodeAuth({
      whichClaude: async () => "/usr/local/bin/claude",
      readSettings: async () => JSON.stringify({ model: "opus" }),
      runAuthStatus: async () => ({
        loggedIn: true,
        authMethod: "third_party",
        apiProvider: "bedrock",
      }),
    });
    expect(result.status).toBe("authenticated");
    expect(result.detail).toContain("bedrock");
  });

  it("reports unauthenticated when settings.json is missing AND `claude auth status` says loggedIn=false", async () => {
    const result = await detectClaudeCodeAuth({
      whichClaude: async () => "/usr/local/bin/claude",
      readSettings: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      runAuthStatus: async () => ({ loggedIn: false }),
    });
    expect(result.status).toBe("unauthenticated");
    expect(result.detail).toContain("claude auth login");
  });

  it("reports unauthenticated when both settings.json and auth status fail", async () => {
    const result = await detectClaudeCodeAuth({
      whichClaude: async () => "/usr/local/bin/claude",
      readSettings: async () => {
        throw new Error("ENOENT");
      },
      runAuthStatus: async () => undefined,
    });
    expect(result.status).toBe("unauthenticated");
  });

  it("reports cli-not-installed when binary missing", async () => {
    const result = await detectClaudeCodeAuth({
      whichClaude: async () => undefined,
      readSettings: async () => "{}",
      runAuthStatus: async () => undefined,
    });
    expect(result.status).toBe("cli-not-installed");
    expect(result.cliInstalled).toBe(false);
  });

  it("treats empty availableModels array as not-yet-authenticated", async () => {
    const result = await detectClaudeCodeAuth({
      whichClaude: async () => "/usr/local/bin/claude",
      readSettings: async () => JSON.stringify({ availableModels: [] }),
      runAuthStatus: async () => ({ loggedIn: false }),
    });
    expect(result.status).toBe("unauthenticated");
  });

  it("reports availableModels even when source is auth-status only (no settings.json list)", async () => {
    const result = await detectClaudeCodeAuth({
      whichClaude: async () => "/usr/local/bin/claude",
      readSettings: async () => JSON.stringify({ model: "opus" }),
      runAuthStatus: async () => ({
        loggedIn: true,
        authMethod: "console",
        apiProvider: "anthropic",
      }),
    });
    // No availableModels list available, but auth.status says loggedIn:
    // status is authenticated, availableModels is undefined.
    expect(result.status).toBe("authenticated");
    expect(result.availableModels).toBeUndefined();
  });

  it("treats unparseable settings.json as missing", async () => {
    const result = await detectClaudeCodeAuth({
      whichClaude: async () => "/usr/local/bin/claude",
      readSettings: async () => "not json",
      runAuthStatus: async () => ({ loggedIn: false }),
    });
    expect(result.status).toBe("unauthenticated");
  });
});
