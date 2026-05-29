import { describe, expect, it } from "bun:test";
import { detectCodexAuth } from "../../../src/io/auth/codex";

describe("detectCodexAuth", () => {
  it("reports authenticated when ~/.codex/auth.json contains an OPENAI_API_KEY", async () => {
    const result = await detectCodexAuth({
      whichCodex: async () => "/usr/local/bin/codex",
      readAuthFile: async () =>
        JSON.stringify({ OPENAI_API_KEY: "sk-test-abc123" }),
    });
    expect(result.platform).toBe("codex");
    expect(result.cliInstalled).toBe(true);
    expect(result.status).toBe("authenticated");
    expect(result.detail).toContain("OPENAI_API_KEY");
  });

  it("reports authenticated when auth.json has tokens.access_token (ChatGPT-style auth)", async () => {
    const result = await detectCodexAuth({
      whichCodex: async () => "/usr/local/bin/codex",
      readAuthFile: async () =>
        JSON.stringify({
          tokens: { access_token: "ya29.a0Ad..." },
        }),
    });
    expect(result.status).toBe("authenticated");
    expect(result.detail).toContain("ChatGPT");
  });

  it("falls back to OPENAI_API_KEY env var when auth.json missing", async () => {
    const result = await detectCodexAuth({
      whichCodex: async () => "/usr/local/bin/codex",
      readAuthFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      env: { OPENAI_API_KEY: "sk-from-env" },
    });
    expect(result.status).toBe("authenticated");
    expect(result.detail).toContain("env");
  });

  it("reports unauthenticated when neither auth.json nor env var", async () => {
    const result = await detectCodexAuth({
      whichCodex: async () => "/usr/local/bin/codex",
      readAuthFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      env: {},
    });
    expect(result.status).toBe("unauthenticated");
    expect(result.detail).toContain("codex login");
  });

  it("reports cli-not-installed when codex binary missing", async () => {
    const result = await detectCodexAuth({
      whichCodex: async () => undefined,
      readAuthFile: async () => "{}",
      env: {},
    });
    expect(result.status).toBe("cli-not-installed");
    expect(result.cliInstalled).toBe(false);
  });

  it("treats unparseable auth.json as missing", async () => {
    const result = await detectCodexAuth({
      whichCodex: async () => "/usr/local/bin/codex",
      readAuthFile: async () => "not json",
      env: {},
    });
    expect(result.status).toBe("unauthenticated");
  });

  it("treats empty {} auth.json as no credentials", async () => {
    const result = await detectCodexAuth({
      whichCodex: async () => "/usr/local/bin/codex",
      readAuthFile: async () => "{}",
      env: {},
    });
    expect(result.status).toBe("unauthenticated");
  });
});
