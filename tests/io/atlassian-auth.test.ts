// tests/io/atlassian-auth.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AtlassianAuth,
  basicAuthHeader,
  remediationBaseUrlMissing,
  resolveAtlassianAuth,
  resolveAtlassianBaseUrl,
  tokenCreationInstructions,
} from "../../src/io/atlassian-auth";

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "atlassian-auth-"));
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe("resolveAtlassianAuth", () => {
  test("returns null when no env vars and no .env files exist", () => {
    const result = resolveAtlassianAuth({ homeDir, env: {} });
    expect(result).toBeNull();
  });

  test("reads from ~/.config/agent-smith/.env (file-smith tier)", async () => {
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(
      join(homeDir, ".config/agent-smith/.env"),
      "SMITH_ATLASSIAN_EMAIL=alice@example.com\nSMITH_ATLASSIAN_API_TOKEN=tok-smith\n",
    );
    const result = resolveAtlassianAuth({ homeDir, env: {} });
    expect(result).toEqual({
      email: "alice@example.com",
      token: "tok-smith",
      source: "file-smith",
    });
  });

  test("requires both email AND token to count as a complete pair", async () => {
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(join(homeDir, ".config/agent-smith/.env"), "SMITH_ATLASSIAN_EMAIL=alice@x\n");
    const result = resolveAtlassianAuth({ homeDir, env: {} });
    expect(result).toBeNull();
  });

  test("accepts SMITH_JIRA_API_TOKEN as fallback for SMITH_ATLASSIAN_API_TOKEN", async () => {
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(
      join(homeDir, ".config/agent-smith/.env"),
      "SMITH_ATLASSIAN_EMAIL=alice@x\nSMITH_JIRA_API_TOKEN=tok-jira\n",
    );
    const result = resolveAtlassianAuth({ homeDir, env: {} });
    expect(result?.token).toBe("tok-jira");
  });

  test(".env parser: ignores comments and blank lines", async () => {
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(
      join(homeDir, ".config/agent-smith/.env"),
      "# this is a comment\n\nSMITH_ATLASSIAN_EMAIL=alice@x\n# inline-style block\nSMITH_ATLASSIAN_API_TOKEN=tok-A\n",
    );
    const result = resolveAtlassianAuth({ homeDir, env: {} });
    expect(result?.email).toBe("alice@x");
    expect(result?.token).toBe("tok-A");
  });

  test(".env parser: strips surrounding quotes if present", async () => {
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(
      join(homeDir, ".config/agent-smith/.env"),
      `SMITH_ATLASSIAN_EMAIL="alice@x"\nSMITH_ATLASSIAN_API_TOKEN='tok-A'\n`,
    );
    const result = resolveAtlassianAuth({ homeDir, env: {} });
    expect(result?.email).toBe("alice@x");
    expect(result?.token).toBe("tok-A");
  });

  test("reads from process env SMITH_* (env-smith tier, highest priority)", () => {
    const result = resolveAtlassianAuth({
      homeDir,
      env: {
        SMITH_ATLASSIAN_EMAIL: "alice@env",
        SMITH_ATLASSIAN_API_TOKEN: "tok-env-smith",
      },
    });
    expect(result).toEqual({
      email: "alice@env",
      token: "tok-env-smith",
      source: "env-smith",
    });
  });

  test("env-smith wins over file-smith when both present", async () => {
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(
      join(homeDir, ".config/agent-smith/.env"),
      "SMITH_ATLASSIAN_EMAIL=file@x\nSMITH_ATLASSIAN_API_TOKEN=file-tok\n",
    );
    const result = resolveAtlassianAuth({
      homeDir,
      env: {
        SMITH_ATLASSIAN_EMAIL: "env@x",
        SMITH_ATLASSIAN_API_TOKEN: "env-tok",
      },
    });
    expect(result?.source).toBe("env-smith");
    expect(result?.email).toBe("env@x");
  });

  test("file-smith tier rethrows non-ENOENT read errors with path and cause", async () => {
    // Create a *directory* at the .env path so readFileSync throws EISDIR
    // (not ENOENT). This exercises the non-ENOENT branch of readDotenv,
    // which previously swallowed every error and returned {}.
    await mkdir(join(homeDir, ".config/agent-smith/.env"), { recursive: true });
    let caught: unknown = null;
    try {
      resolveAtlassianAuth({ homeDir, env: {} });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const e = caught as Error & { cause?: unknown };
    expect(e.message).toContain(join(homeDir, ".config/agent-smith/.env"));
    expect(e.message).toContain("failed to read");
    expect(e.cause).toBeDefined();
  });

  test("production path (no homeDir override) honors XDG_CONFIG_HOME for tier-2 smith .env", async () => {
    // Use the tmpdir directly AS the XDG root so the smith .env lands at
    // <xdg>/agent-smith/.env. The test seam (opts.homeDir) is intentionally
    // omitted to exercise the production code path that calls stateHome().
    const prevXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = homeDir;
    try {
      await mkdir(join(homeDir, "agent-smith"), { recursive: true });
      await writeFile(
        join(homeDir, "agent-smith/.env"),
        "SMITH_ATLASSIAN_EMAIL=xdg@x\nSMITH_ATLASSIAN_API_TOKEN=tok-xdg\n",
      );
      const result = resolveAtlassianAuth({ env: {} });
      expect(result).toEqual({
        email: "xdg@x",
        token: "tok-xdg",
        source: "file-smith",
      });
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
    }
  });
});

describe("basicAuthHeader", () => {
  test("encodes email:token as Base64 with Basic prefix", () => {
    const auth: AtlassianAuth = {
      email: "alice@x",
      token: "tok-A",
      source: "file-smith",
    };
    const header = basicAuthHeader(auth);
    expect(header).toBe(`Basic ${Buffer.from("alice@x:tok-A").toString("base64")}`);
  });
});

describe("resolveAtlassianBaseUrl", () => {
  test("returns null when no env vars and no .env files exist", () => {
    const result = resolveAtlassianBaseUrl({ homeDir, env: {} });
    expect(result).toBeNull();
  });

  test("reads SMITH_ATLASSIAN_BASE_URL from process env (env-smith tier)", () => {
    const result = resolveAtlassianBaseUrl({
      homeDir,
      env: { SMITH_ATLASSIAN_BASE_URL: "https://acme.atlassian.net" },
    });
    expect(result).toBe("https://acme.atlassian.net");
  });

  test("reads SMITH_ATLASSIAN_BASE_URL from ~/.config/agent-smith/.env (file-smith tier)", async () => {
    await mkdir(join(homeDir, ".config/agent-smith"), { recursive: true });
    await writeFile(
      join(homeDir, ".config/agent-smith/.env"),
      "SMITH_ATLASSIAN_BASE_URL=https://from-file.atlassian.net\n",
    );
    const result = resolveAtlassianBaseUrl({ homeDir, env: {} });
    expect(result).toBe("https://from-file.atlassian.net");
  });

  test("trims whitespace from value", () => {
    const result = resolveAtlassianBaseUrl({
      homeDir,
      env: { SMITH_ATLASSIAN_BASE_URL: "  https://acme.atlassian.net  " },
    });
    expect(result).toBe("https://acme.atlassian.net");
  });
});

describe("remediationBaseUrlMissing", () => {
  test("includes the SMITH_ATLASSIAN_BASE_URL env-var name and a placeholder workspace", () => {
    const msg = remediationBaseUrlMissing();
    expect(msg).toContain("SMITH_ATLASSIAN_BASE_URL");
    expect(msg).toContain("acme.atlassian.net");
    expect(msg).toContain("workspace-scoped");
  });
});

describe("tokenCreationInstructions", () => {
  test("returns the canonical Atlassian token-creation steps", () => {
    const lines = tokenCreationInstructions();
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(5);
    // First line is the imperative header.
    expect(lines[0]).toBe("To create an Atlassian API token:");
    // Includes the canonical Atlassian URL.
    const joined = lines.join("\n");
    expect(joined).toContain("https://id.atlassian.com/manage-profile/security/api-tokens");
    // Calls out the unscoped vs. scoped trade-off (Atlassian recommends
    // scoped, smith requires unscoped — explain why).
    expect(joined).toContain("Create API token");
    expect(joined).toContain("scopes");
    expect(joined).toContain("smith");
    // Mentions expiration (1-365 days; Atlassian default 1 year).
    expect(joined).toMatch(/1.*365/);
    // Mentions copy-immediately because tokens can't be recovered.
    expect(joined.toLowerCase()).toContain("copy");
    expect(joined.toLowerCase()).toContain("recover");
    // Links to Atlassian's official manage-api-tokens doc.
    expect(joined).toContain("support.atlassian.com/atlassian-account/docs/manage-api-tokens");
  });
});
