import { describe, expect, test } from "bun:test";
import {
  bridgeAtlassianAuthToPerProductEnv,
  detectBridgeDrift,
} from "../../src/io/atlassian-bridge";

describe("bridgeAtlassianAuthToPerProductEnv", () => {
  test("Cloud workspace: appends /wiki to CONFLUENCE_URL", () => {
    const out = bridgeAtlassianAuthToPerProductEnv({
      email: "alice@acme.com",
      token: "ATATT3xFfGF0",
      baseUrl: "https://acme.atlassian.net",
    });
    expect(out.JIRA_URL).toBe("https://acme.atlassian.net");
    expect(out.JIRA_USERNAME).toBe("alice@acme.com");
    expect(out.JIRA_API_TOKEN).toBe("ATATT3xFfGF0");
    expect(out.CONFLUENCE_URL).toBe("https://acme.atlassian.net/wiki");
    expect(out.CONFLUENCE_USERNAME).toBe("alice@acme.com");
    expect(out.CONFLUENCE_API_TOKEN).toBe("ATATT3xFfGF0");
  });

  test("Cloud workspace with trailing slash: trims slash before appending /wiki", () => {
    const out = bridgeAtlassianAuthToPerProductEnv({
      email: "alice@acme.com",
      token: "tok",
      baseUrl: "https://acme.atlassian.net/",
    });
    expect(out.JIRA_URL).toBe("https://acme.atlassian.net");
    expect(out.CONFLUENCE_URL).toBe("https://acme.atlassian.net/wiki");
  });

  test("Data Center workspace: no /wiki suffix on CONFLUENCE_URL", () => {
    const out = bridgeAtlassianAuthToPerProductEnv({
      email: "alice@acme.com",
      token: "PAT123",
      baseUrl: "https://confluence.acme-corp.com",
    });
    expect(out.CONFLUENCE_URL).toBe("https://confluence.acme-corp.com");
  });

  test("Bitbucket vars are not produced", () => {
    const out = bridgeAtlassianAuthToPerProductEnv({
      email: "a@b.c",
      token: "t",
      baseUrl: "https://acme.atlassian.net",
    });
    expect(out).not.toHaveProperty("BITBUCKET_URL");
    expect(out).not.toHaveProperty("BITBUCKET_PAT_TOKEN");
  });
});

describe("detectBridgeDrift", () => {
  test("returns 'in-sync' when smith vars match per-product vars", () => {
    const result = detectBridgeDrift({
      SMITH_ATLASSIAN_EMAIL: "a@b.c",
      SMITH_ATLASSIAN_API_TOKEN: "tok",
      SMITH_ATLASSIAN_BASE_URL: "https://acme.atlassian.net",
      JIRA_URL: "https://acme.atlassian.net",
      JIRA_USERNAME: "a@b.c",
      JIRA_API_TOKEN: "tok",
      CONFLUENCE_URL: "https://acme.atlassian.net/wiki",
      CONFLUENCE_USERNAME: "a@b.c",
      CONFLUENCE_API_TOKEN: "tok",
    });
    expect(result.status).toBe("in-sync");
  });

  test("returns 'not-bridged' when SMITH vars set but per-product vars all absent", () => {
    const result = detectBridgeDrift({
      SMITH_ATLASSIAN_EMAIL: "a@b.c",
      SMITH_ATLASSIAN_API_TOKEN: "tok",
      SMITH_ATLASSIAN_BASE_URL: "https://acme.atlassian.net",
    });
    expect(result.status).toBe("not-bridged");
  });

  test("returns 'drift' when JIRA_URL stale (different workspace)", () => {
    const result = detectBridgeDrift({
      SMITH_ATLASSIAN_EMAIL: "a@b.c",
      SMITH_ATLASSIAN_API_TOKEN: "tok",
      SMITH_ATLASSIAN_BASE_URL: "https://NEW.atlassian.net",
      JIRA_URL: "https://OLD.atlassian.net",
      JIRA_USERNAME: "a@b.c",
      JIRA_API_TOKEN: "tok",
      CONFLUENCE_URL: "https://NEW.atlassian.net/wiki",
      CONFLUENCE_USERNAME: "a@b.c",
      CONFLUENCE_API_TOKEN: "tok",
    });
    expect(result.status).toBe("drift");
    if (result.status === "drift") {
      expect(result.reasons.some((r) => r.includes("JIRA_URL drift"))).toBe(true);
    }
  });

  test("returns 'not-bridged' when SMITH vars not all set", () => {
    const result = detectBridgeDrift({
      SMITH_ATLASSIAN_EMAIL: "a@b.c",
      // SMITH_ATLASSIAN_API_TOKEN missing
    });
    expect(result.status).toBe("not-bridged");
  });
});
