import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerAndToolsView } from "gui-shared";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { errorHandler, errorMiddleware } from "../middleware/error";
import { registerMcpPickerRoute } from "./mcp-picker";

let home: string;
let registryPath: string;
let bundleDir: string;

async function seedAgent(opts: { mcpServers?: string[] }) {
  const agentRoot = join(home, "agents");
  bundleDir = join(agentRoot, "myagent");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    join(bundleDir, "agent.config.json"),
    JSON.stringify({
      name: "myagent",
      ...(opts.mcpServers ? { mcpServers: opts.mcpServers } : {}),
    }),
  );
  registryPath = join(home, "registry.json");
  await writeFile(
    registryPath,
    JSON.stringify({
      version: 1,
      sources: [{ kind: "user-global", rootPath: agentRoot, label: "a" }],
    }),
  );
}

interface FakeTool {
  name: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Build a fake `loadCoreModule` that returns canned data instead of touching
 * `$HOME` or spawning real MCP servers. Each test passes the per-server tool
 * list and (optionally) the failure to inject for selected servers.
 */
function fakeCore(opts: {
  available: Record<string, { command: string; args?: string[] }>;
  toolsByServer: Record<string, FakeTool[]>;
  failures?: Record<string, string>;
}) {
  return async () => {
    return {
      readAvailableMcpServers: async () => opts.available,
      createSpawnOptsResolver: async () => (name: string) => {
        const entry = opts.available[name];
        if (!entry) throw new Error(`unknown server: ${name}`);
        return entry;
      },
      McpClientPool: class FakePool {
        async acquire(name: string) {
          if (opts.failures?.[name]) throw new Error(opts.failures[name]);
          return {
            listTools: async () => opts.toolsByServer[name] ?? [],
          };
        }
        async shutdown() {
          /* no-op */
        }
      },
      // Inline copy of detectUrlParam so the test doesn't depend on the real
      // probe-route module being importable from the test's runtime.
      detectUrlParam: (tool: FakeTool) => {
        const props = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)
          ?.properties;
        if (!props) return null;
        for (const [key, value] of Object.entries(props)) {
          if (!value || typeof value !== "object") continue;
          const v = value as { type?: string; items?: { type?: string } };
          if (/^(url|uri|target_url|page_url|link|href)$/i.test(key) && v.type === "string") {
            return { kind: "string" as const, key };
          }
          if (
            /^(urls|uris|inputs|targets|links|hrefs|pages)$/i.test(key) &&
            v.type === "array" &&
            v.items?.type === "string"
          ) {
            return { kind: "string-array" as const, key };
          }
        }
        return null;
      },
    };
  };
}

function appWith(loadCoreModule: ReturnType<typeof fakeCore>): { app: Hono } {
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerMcpPickerRoute(app, {
    registryPath,
    homeDir: home,
    loadCoreModule,
  });
  app.onError(errorHandler);
  return { app };
}

const auth = { headers: { authorization: "Bearer t" } };

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "mcp-picker-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("GET /api/agents/:name/mcp-servers-and-tools", () => {
  it("unions bundle servers + AI-client servers, labelling provenance", async () => {
    await seedAgent({ mcpServers: ["bundle-only", "in-both"] });
    const core = fakeCore({
      available: {
        "in-both": { command: "x" },
        "available-only": { command: "y" },
      },
      toolsByServer: {
        "in-both": [{ name: "read", inputSchema: { properties: { url: { type: "string" } } } }],
        "available-only": [
          {
            name: "scrape",
            inputSchema: {
              properties: { urls: { type: "array", items: { type: "string" } } },
            },
          },
        ],
      },
    });
    const { app } = appWith(core);
    const res = await app.request("/api/agents/myagent/mcp-servers-and-tools", auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpServerAndToolsView;
    // Bundle-declared first (declaration order preserved), then available-only.
    expect(body.servers.map((s) => s.name)).toEqual(["bundle-only", "in-both", "available-only"]);
    expect(body.servers[0]?.source).toBe("bundle");
    expect(body.servers[1]?.source).toBe("both");
    expect(body.servers[2]?.source).toBe("available");
    // bundle-only is declared by the bundle but absent from every AI client
    // config, so spawnOptsFor throws — the route surfaces that as `error`
    // rather than dropping the row, mirroring how the CLI's pick-via guides
    // the user toward installing the server in their client config.
    expect(body.servers[0]?.error).toMatch(/unknown server/);
    expect(body.toolsByServer["in-both"]).toEqual([
      { name: "read", urlParam: { kind: "string", key: "url" } },
    ]);
    expect(body.toolsByServer["available-only"]).toEqual([
      { name: "scrape", urlParam: { kind: "string-array", key: "urls" } },
    ]);
  });

  it("surfaces per-server failures as `error` while leaving other rows intact", async () => {
    await seedAgent({ mcpServers: ["good", "bad"] });
    const core = fakeCore({
      available: { good: { command: "x" }, bad: { command: "y" } },
      toolsByServer: {
        good: [{ name: "fetch", inputSchema: { properties: { url: { type: "string" } } } }],
      },
      failures: { bad: "spawn ENOENT" },
    });
    const { app } = appWith(core);
    const res = await app.request("/api/agents/myagent/mcp-servers-and-tools", auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpServerAndToolsView;
    const bad = body.servers.find((s) => s.name === "bad");
    expect(bad?.error).toMatch(/spawn ENOENT/);
    expect(body.toolsByServer.bad).toBeUndefined();
    const good = body.servers.find((s) => s.name === "good");
    expect(good?.error).toBeUndefined();
    expect(body.toolsByServer.good).toEqual([
      { name: "fetch", urlParam: { kind: "string", key: "url" } },
    ]);
  });

  it("filters out tools without a URL-shaped input parameter", async () => {
    await seedAgent({ mcpServers: ["mixed"] });
    const core = fakeCore({
      available: { mixed: { command: "x" } },
      toolsByServer: {
        mixed: [
          { name: "search", inputSchema: { properties: { query: { type: "string" } } } },
          { name: "fetch", inputSchema: { properties: { url: { type: "string" } } } },
          { name: "noschema" },
        ],
      },
    });
    const { app } = appWith(core);
    const res = await app.request("/api/agents/myagent/mcp-servers-and-tools", auth);
    const body = (await res.json()) as McpServerAndToolsView;
    expect(body.toolsByServer.mixed).toEqual([
      { name: "fetch", urlParam: { kind: "string", key: "url" } },
    ]);
  });

  it("returns an empty payload when neither bundle nor AI clients declare servers", async () => {
    await seedAgent({});
    const core = fakeCore({ available: {}, toolsByServer: {} });
    const { app } = appWith(core);
    const res = await app.request("/api/agents/myagent/mcp-servers-and-tools", auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpServerAndToolsView;
    expect(body.servers).toEqual([]);
    expect(body.toolsByServer).toEqual({});
  });

  it("404s for an unknown agent", async () => {
    await seedAgent({});
    const core = fakeCore({ available: {}, toolsByServer: {} });
    const { app } = appWith(core);
    const res = await app.request("/api/agents/ghost/mcp-servers-and-tools", auth);
    expect(res.status).toBe(404);
  });

  it("400s on an invalid agent name (path-traversal attempt)", async () => {
    await seedAgent({});
    const core = fakeCore({ available: {}, toolsByServer: {} });
    const { app } = appWith(core);
    const res = await app.request("/api/agents/%2E%2E%2Fother/mcp-servers-and-tools", auth);
    expect(res.status).toBe(400);
  });
});
