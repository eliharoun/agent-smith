import { describe, expect, it } from "bun:test";
import { detectKiroAuth } from "../../../src/io/auth/kiro";

describe("detectKiroAuth", () => {
  it("reports authenticated when SSO token cache has non-empty accessToken and unexpired", async () => {
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({
          accessToken: "tok-abc",
          expiresAt: "2099-01-01T00:00:00Z",
          authMethod: "IdC",
          startUrl: "https://amzn.awsapps.com/start",
        }),
    });
    expect(result.platform).toBe("kiro");
    expect(result.cliInstalled).toBe(true);
    expect(result.status).toBe("authenticated");
    expect(result.detail).toContain("IdC");
  });

  it("reports unauthenticated when token cache is missing", async () => {
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    expect(result.status).toBe("unauthenticated");
    expect(result.detail).toContain("kiro-cli");
  });

  it("reports unauthenticated when accessToken is empty string", async () => {
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({ accessToken: "", expiresAt: "2099-01-01T00:00:00Z" }),
    });
    expect(result.status).toBe("unauthenticated");
  });

  it("reports unauthenticated when token has expired", async () => {
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({
          accessToken: "tok",
          expiresAt: "2000-01-01T00:00:00Z",
        }),
    });
    expect(result.status).toBe("unauthenticated");
    expect(result.detail).toMatch(/expired/i);
  });

  it("reports cli-not-installed when neither kiro nor kiro-cli is on PATH", async () => {
    const result = await detectKiroAuth({
      whichKiro: async () => undefined,
      readTokenCache: async () => "{}",
    });
    expect(result.status).toBe("cli-not-installed");
    expect(result.cliInstalled).toBe(false);
  });

  it("treats unparseable token cache as unauthenticated", async () => {
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () => "not json",
    });
    expect(result.status).toBe("unauthenticated");
  });

  it("accepts a token without expiresAt (treats as still valid)", async () => {
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({ accessToken: "tok", authMethod: "IdC" }),
    });
    expect(result.status).toBe("authenticated");
  });
});
