import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAtlassianEnv, upsertEnvLines, writeAtlassianEnv } from "./atlassian-env";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atl-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readAtlassianEnv", () => {
  it("reports source=none when no creds anywhere", async () => {
    const out = await readAtlassianEnv({
      smithEnvPath: join(dir, "smith.env"),
      env: {},
    });
    expect(out).toEqual({ source: "none", hasToken: false, editable: true });
  });

  it("prefers process env over file", async () => {
    const path = join(dir, "smith.env");
    await writeFile(path, "SMITH_ATLASSIAN_EMAIL=file@x\nSMITH_ATLASSIAN_API_TOKEN=ft\n");
    const out = await readAtlassianEnv({
      smithEnvPath: path,
      env: {
        SMITH_ATLASSIAN_EMAIL: "env@x",
        SMITH_ATLASSIAN_API_TOKEN: "et",
      } as NodeJS.ProcessEnv,
    });
    expect(out.source).toBe("env");
    expect(out.editable).toBe(false);
  });

  it("reads from smith env file", async () => {
    const path = join(dir, "smith.env");
    await writeFile(path, "SMITH_ATLASSIAN_EMAIL=a@b\nSMITH_ATLASSIAN_API_TOKEN=tok\n");
    const out = await readAtlassianEnv({
      smithEnvPath: path,
      env: {},
    });
    expect(out).toMatchObject({
      source: "smith-env-file",
      email: "a@b",
      hasToken: true,
      editable: true,
    });
  });
});

describe("upsertEnvLines", () => {
  it("preserves comments and unknown keys", () => {
    const raw = "# top\nFOO=bar\nSMITH_ATLASSIAN_EMAIL=old@x\n";
    const next = upsertEnvLines(raw, {
      SMITH_ATLASSIAN_EMAIL: "new@x",
      SMITH_ATLASSIAN_API_TOKEN: "tk",
    });
    expect(next).toContain("# top");
    expect(next).toContain("FOO=bar");
    expect(next).toContain("SMITH_ATLASSIAN_EMAIL=new@x");
    expect(next).toContain("SMITH_ATLASSIAN_API_TOKEN=tk");
  });

  it("quotes values containing whitespace", () => {
    const next = upsertEnvLines("", { K: "has space" });
    expect(next).toContain('K="has space"');
  });
});

describe("writeAtlassianEnv", () => {
  it("creates the file and writes both keys", async () => {
    const path = join(dir, "smith.env");
    await writeAtlassianEnv({ email: "a@b", apiToken: "tk" }, { smithEnvPath: path, env: {} });
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("SMITH_ATLASSIAN_EMAIL=a@b");
    expect(raw).toContain("SMITH_ATLASSIAN_API_TOKEN=tk");
  });

  it("does not overwrite token when empty string", async () => {
    const path = join(dir, "smith.env");
    await writeFile(path, "SMITH_ATLASSIAN_EMAIL=old@x\nSMITH_ATLASSIAN_API_TOKEN=keepme\n");
    await writeAtlassianEnv({ email: "new@x", apiToken: "" }, { smithEnvPath: path, env: {} });
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("SMITH_ATLASSIAN_EMAIL=new@x");
    expect(raw).toContain("SMITH_ATLASSIAN_API_TOKEN=keepme");
  });
});

describe("writeAtlassianEnv bridge", () => {
  it("writes both unified and per-product vars when baseUrl is provided", async () => {
    const path = join(dir, "smith.env");
    await writeAtlassianEnv(
      { email: "alice@acme.com", apiToken: "tok123", baseUrl: "https://acme.atlassian.net" },
      { smithEnvPath: path, env: {} },
    );
    const raw = await readFile(path, "utf8");
    // Unified vars
    expect(raw).toContain("SMITH_ATLASSIAN_EMAIL=alice@acme.com");
    expect(raw).toContain("SMITH_ATLASSIAN_API_TOKEN=tok123");
    expect(raw).toContain("SMITH_ATLASSIAN_BASE_URL=https://acme.atlassian.net");
    // Bridged per-product vars
    expect(raw).toContain("JIRA_URL=https://acme.atlassian.net");
    expect(raw).toContain("JIRA_USERNAME=alice@acme.com");
    expect(raw).toContain("JIRA_API_TOKEN=tok123");
    expect(raw).toContain("CONFLUENCE_URL=https://acme.atlassian.net/wiki");
    expect(raw).toContain("CONFLUENCE_USERNAME=alice@acme.com");
    expect(raw).toContain("CONFLUENCE_API_TOKEN=tok123");
  });

  it("does not write bridged vars when baseUrl is absent", async () => {
    const path = join(dir, "smith.env");
    await writeAtlassianEnv(
      { email: "alice@acme.com", apiToken: "tok123" },
      { smithEnvPath: path, env: {} },
    );
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("SMITH_ATLASSIAN_EMAIL=alice@acme.com");
    expect(raw).not.toContain("JIRA_URL");
    expect(raw).not.toContain("CONFLUENCE_URL");
  });
});
