import { describe, expect, it } from "bun:test";
import { detectAuthenticatedProviders } from "../../src/io/opencode-auth";

describe("detectAuthenticatedProviders", () => {
  it("reads providers from auth.json when present", async () => {
    const result = await detectAuthenticatedProviders({
      readAuthFile: async () =>
        JSON.stringify({
          anthropic: { type: "oauth", accessToken: "..." },
          "github-copilot": { type: "oauth", refreshToken: "..." },
        }),
      getModels: async () => undefined,
    });
    expect(result.sort()).toEqual(["anthropic", "github-copilot"]);
  });

  it("falls back to inferring from opencode models when auth.json missing", async () => {
    const result = await detectAuthenticatedProviders({
      readAuthFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      getModels: async () => [
        "anthropic/claude-opus-4-7",
        "openai/gpt-5",
        "anthropic/claude-haiku-4-5",
      ],
    });
    expect(result.sort()).toEqual(["anthropic", "openai"]);
  });

  it("returns empty array when both auth.json and live models unavailable", async () => {
    const result = await detectAuthenticatedProviders({
      readAuthFile: async () => {
        throw new Error("missing");
      },
      getModels: async () => undefined,
    });
    expect(result).toEqual([]);
  });

  it("returns empty array when auth.json is empty {}", async () => {
    const result = await detectAuthenticatedProviders({
      readAuthFile: async () => "{}",
      getModels: async () => undefined,
    });
    expect(result).toEqual([]);
  });

  it("returns empty array when auth.json is unparseable", async () => {
    const result = await detectAuthenticatedProviders({
      readAuthFile: async () => "not json",
      getModels: async () => undefined,
    });
    expect(result).toEqual([]);
  });

  it("falls back to live models when auth.json is empty", async () => {
    const result = await detectAuthenticatedProviders({
      readAuthFile: async () => "{}",
      getModels: async () => ["anthropic/claude-haiku-4-5"],
    });
    expect(result).toEqual(["anthropic"]);
  });
});
