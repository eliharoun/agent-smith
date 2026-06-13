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
      readTokenCache: async () => JSON.stringify({ accessToken: "tok", authMethod: "IdC" }),
    });
    expect(result.status).toBe("authenticated");
  });

  // --- Expired access token + refresh token: verify via `kiro-cli whoami` ---
  //
  // AWS SSO access tokens are short-lived (~hours) while the refresh token in
  // the same cache file lasts far longer; kiro-cli refreshes the access token
  // lazily and does not rewrite the cache file. So an expired on-disk access
  // token with a refresh token present does NOT mean the session is dead — we
  // must ask kiro-cli itself. This holds for both IAM Identity Center and
  // Builder ID, so it is correct for any Kiro user, not just Amazon-internal.

  it("invokes kiro-cli whoami when the access token is expired but a refresh token is present, and reports authenticated on success", async () => {
    let whoamiCli: string | undefined;
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({
          accessToken: "tok-expired",
          expiresAt: "2000-01-01T00:00:00Z",
          refreshToken: "refresh-valid",
          authMethod: "IdC",
        }),
      runWhoami: async (cliPath) => {
        whoamiCli = cliPath;
        return { accountType: "IamIdentityCenter", email: "user@example.com" };
      },
    });
    expect(whoamiCli).toBe("/usr/local/bin/kiro-cli");
    expect(result.status).toBe("authenticated");
    expect(result.detail).toContain("IamIdentityCenter");
  });

  it("reports authenticated for an expired-token Builder ID session confirmed by whoami", async () => {
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({
          accessToken: "tok-expired",
          expiresAt: "2000-01-01T00:00:00Z",
          refreshToken: "builder-id-refresh",
        }),
      runWhoami: async () => ({ accountType: "BuilderId", email: "dev@example.com" }),
    });
    expect(result.status).toBe("authenticated");
    expect(result.detail).toContain("BuilderId");
  });

  it("reports authenticated when whoami succeeds (exit 0) but yields no parseable detail", async () => {
    // Regression guard: `kiro-cli whoami --format json` prints a JSON object
    // followed by trailing plaintext on stdout, so detail enrichment can be
    // empty even on success. A successful whoami must still count as
    // authenticated; success is keyed on the process exit code, not on
    // parsing. The cache's authMethod backstops the detail string.
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({
          accessToken: "tok-expired",
          expiresAt: "2000-01-01T00:00:00Z",
          refreshToken: "refresh-valid",
          authMethod: "IdC",
        }),
      runWhoami: async () => ({}),
    });
    expect(result.status).toBe("authenticated");
    expect(result.detail).toContain("IdC");
  });

  it("reports unauthenticated when the access token is expired and whoami fails (dead/revoked refresh token)", async () => {
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({
          accessToken: "tok-expired",
          expiresAt: "2000-01-01T00:00:00Z",
          refreshToken: "refresh-revoked",
        }),
      runWhoami: async () => undefined,
    });
    expect(result.status).toBe("unauthenticated");
    expect(result.detail).toMatch(/expired/i);
  });

  it("does not invoke whoami when the access token is expired and no refresh token is present", async () => {
    let whoamiCalled = false;
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({
          accessToken: "tok-expired",
          expiresAt: "2000-01-01T00:00:00Z",
        }),
      runWhoami: async () => {
        whoamiCalled = true;
        return {};
      },
    });
    expect(whoamiCalled).toBe(false);
    expect(result.status).toBe("unauthenticated");
  });

  it("does not invoke whoami on the happy path (unexpired access token)", async () => {
    let whoamiCalled = false;
    const result = await detectKiroAuth({
      whichKiro: async () => "/usr/local/bin/kiro-cli",
      readTokenCache: async () =>
        JSON.stringify({
          accessToken: "tok-valid",
          expiresAt: "2099-01-01T00:00:00Z",
          refreshToken: "refresh-present",
          authMethod: "IdC",
        }),
      runWhoami: async () => {
        whoamiCalled = true;
        return {};
      },
    });
    expect(whoamiCalled).toBe(false);
    expect(result.status).toBe("authenticated");
  });
});
