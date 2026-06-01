import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { JobManager } from "../jobs/job-manager";
import { __resetSmithPathCacheForTests } from "../services/resolve-smith-path";

// Stub the smith-path resolver via SMITH_BIN env override — same convention
// as smith-binary.ts. Tests can flip resolverShouldFail to simulate the
// not-found path without leaking a mock.module into other test files.
const STUB_RAW_PATH = join(tmpdir(), `smith-stub-routes-${process.pid}`);
let STUBBED_SMITH_PATH = STUB_RAW_PATH; // overwritten in beforeAll
let savedSmithBin: string | undefined;

beforeAll(() => {
  mkdirSync(join(STUB_RAW_PATH, ".."), { recursive: true });
  writeFileSync(STUB_RAW_PATH, "#!/bin/sh\nexit 0\n");
  chmodSync(STUB_RAW_PATH, 0o755);
  STUBBED_SMITH_PATH = realpathSync(STUB_RAW_PATH);
  savedSmithBin = process.env.SMITH_BIN;
  process.env.SMITH_BIN = STUB_RAW_PATH;
  __resetSmithPathCacheForTests();
});

afterAll(() => {
  if (savedSmithBin === undefined) delete process.env.SMITH_BIN;
  else process.env.SMITH_BIN = savedSmithBin;
  __resetSmithPathCacheForTests();
  try {
    require("node:fs").unlinkSync(STUB_RAW_PATH);
  } catch {
    /* ignore */
  }
});

let root: string;
let registryPath: string;

const fakeSpawner = () => ({ stop: () => {}, writeStdin: () => {} });

async function writeBundle(catalog: string, name: string) {
  const path = join(root, "catalogs", catalog, name);
  await mkdir(path, { recursive: true });
  for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
    await writeFile(join(path, f), `# ${f}\nbody\n`);
  }
  await writeFile(
    join(path, "agent.config.json"),
    JSON.stringify({ name, description: "test", model: "sonnet", targets: ["opencode"] }),
  );
  return path;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcp-routes-"));
  registryPath = join(root, "registry.json");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function configPaths() {
  return {
    "claude-code": join(root, "claude.json"),
    opencode: join(root, "opencode.json"),
    codex: join(root, "codex.toml"),
    kiro: join(root, "kiro-mcp.json"),
  } as const;
}

function appWith(opts?: {
  installed?: Array<"opencode" | "claude-code" | "codex" | "kiro">;
}) {
  const installed = new Set<"opencode" | "claude-code" | "codex" | "kiro">(
    opts?.installed ?? ["opencode", "claude-code", "codex", "kiro"],
  );
  const jm = new JobManager({ spawner: fakeSpawner });
  return createApp({
    token: "t",
    jobs: jm,
    registryPath,
    installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z", kiro: "/k" }),
    mcpConfigPathsFor: () => configPaths(),
    detectMcpPlatforms: async () => installed,
  });
}

describe("GET /api/agents/:name/mcp-wiring-plan", () => {
  it("returns one entry per platform with cliInstalled + hasEntry flags", async () => {
    await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    // Pre-populate Claude Code with the canonical entry.
    const paths = configPaths();
    await writeFile(
      paths["claude-code"],
      JSON.stringify({
        mcpServers: {
          "agent-smith-knowledge": {
            command: "smith",
            args: ["knowledge", "serve", "foo", "--stdio"],
          },
        },
      }),
    );
    const app = appWith({ installed: ["claude-code", "opencode"] });
    const res = await app.request("/api/agents/foo/mcp-wiring-plan", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      platforms: Array<{
        platform: string;
        cliInstalled: boolean;
        hasEntry: boolean;
      }>;
    };
    const cc = body.platforms.find((p) => p.platform === "claude-code");
    expect(cc).toBeDefined();
    expect(cc?.cliInstalled).toBe(true);
    expect(cc?.hasEntry).toBe(true);
    const codex = body.platforms.find((p) => p.platform === "codex");
    expect(codex?.cliInstalled).toBe(false);
    expect(codex?.hasEntry).toBe(false);
  });

  it("404s for an unknown agent", async () => {
    await writeFile(registryPath, JSON.stringify({ catalogs: {} }));
    const res = await appWith().request("/api/agents/ghost/mcp-wiring-plan", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(404);
  });

  it("400s on invalid agent name (path traversal attempt)", async () => {
    await writeFile(registryPath, JSON.stringify({ catalogs: {} }));
    const res = await appWith().request("/api/agents/%2E%2E%2Fother/mcp-wiring-plan", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/agents/:name/mcp-wiring", () => {
  beforeEach(async () => {
    await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
  });

  it("enables: writes the canonical entry to each named platform", async () => {
    const app = appWith();
    const res = await app.request("/api/agents/foo/mcp-wiring", {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ enable: true, platforms: ["claude-code", "kiro"] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ platform: string; ok: boolean }>;
      platforms: Array<{ platform: string; hasEntry: boolean }>;
    };
    expect(body.results.every((r) => r.ok)).toBe(true);
    const cc = body.platforms.find((p) => p.platform === "claude-code");
    expect(cc?.hasEntry).toBe(true);
    const kiro = body.platforms.find((p) => p.platform === "kiro");
    expect(kiro?.hasEntry).toBe(true);
    // Verify on disk too. The command is the resolver's absolute path —
    // see the SMITH_BIN stub at the top of the file.
    const ccData = JSON.parse(await readFile(configPaths()["claude-code"], "utf8"));
    expect(ccData.mcpServers["agent-smith-knowledge"]).toEqual({
      command: STUBBED_SMITH_PATH,
      args: ["knowledge", "serve", "foo", "--stdio"],
    });
    expect(ccData.mcpServers["agent-smith-knowledge"].command.startsWith("/")).toBe(true);
  });

  it("disables: removes only the canonical entry, preserves siblings", async () => {
    // Seed configs with the canonical entry alongside another.
    const paths = configPaths();
    await writeFile(
      paths["claude-code"],
      JSON.stringify({
        mcpServers: {
          "github-mcp": { command: "gh-mcp", args: [] },
          "agent-smith-knowledge": {
            command: "smith",
            args: ["knowledge", "serve", "foo", "--stdio"],
          },
        },
      }),
    );
    const app = appWith();
    const res = await app.request("/api/agents/foo/mcp-wiring", {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ enable: false, platforms: ["claude-code"] }),
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(await readFile(paths["claude-code"], "utf8"));
    expect(data.mcpServers["agent-smith-knowledge"]).toBeUndefined();
    expect(data.mcpServers["github-mcp"]).toEqual({ command: "gh-mcp", args: [] });
  });

  it("400s on a malformed body (missing enable)", async () => {
    const app = appWith();
    const res = await app.request("/api/agents/foo/mcp-wiring", {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ platforms: ["claude-code"] }),
    });
    expect(res.status).toBe(400);
  });

  it("400s on an empty platforms array", async () => {
    const app = appWith();
    const res = await app.request("/api/agents/foo/mcp-wiring", {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ enable: true, platforms: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown agent", async () => {
    const app = appWith();
    const res = await app.request("/api/agents/ghost/mcp-wiring", {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ enable: true, platforms: ["claude-code"] }),
    });
    expect(res.status).toBe(404);
  });

  it("500s with an actionable body when the smith-path resolver fails (enable)", async () => {
    // Force the resolver into the not-found branch by pointing SMITH_BIN
    // at an invalid path and clearing all argv/HOME/PATH discovery candidates.
    const prevSmithBin = process.env.SMITH_BIN;
    const prevArgv1 = process.argv[1];
    const prevHome = process.env.HOME;
    const prevPath = process.env.PATH;
    const fakeHome = await mkdtemp(join(tmpdir(), "fail-home-"));
    process.env.SMITH_BIN = "/path/that/does/not/exist";
    process.argv[1] = "/path/that/does/not/exist";
    process.env.HOME = fakeHome; // no ~/.local/bin/smith here
    process.env.PATH = "/usr/bin:/bin"; // smith not on this PATH
    __resetSmithPathCacheForTests();
    try {
      const app = appWith();
      const res = await app.request("/api/agents/foo/mcp-wiring", {
        method: "POST",
        headers: {
          authorization: "Bearer t",
          "content-type": "application/json",
          origin: "http://localhost.test",
        },
        body: JSON.stringify({ enable: true, platforms: ["claude-code", "kiro"] }),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("SMITH_NOT_FOUND");
      expect(body.error).toMatch(/smith/i);
      expect(body.error).toMatch(/reinstall/i);
      // The config files MUST NOT have been touched: pre-flight failed.
      const ccPath = configPaths()["claude-code"];
      const ccExists = await Bun.file(ccPath).exists();
      expect(ccExists).toBe(false);
    } finally {
      if (prevSmithBin === undefined) delete process.env.SMITH_BIN;
      else process.env.SMITH_BIN = prevSmithBin;
      process.argv[1] = prevArgv1;
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevPath === undefined) delete process.env.PATH;
      else process.env.PATH = prevPath;
      __resetSmithPathCacheForTests();
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
