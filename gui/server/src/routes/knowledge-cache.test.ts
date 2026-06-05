import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";

let home: string; // simulated agent-smith home
let agentRoot: string;
let registryPath: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "knowledge-cache-"));
  agentRoot = join(home, "agents");
  await mkdir(agentRoot, { recursive: true });
  // Register one agent ("alpha") with a minimal valid bundle.
  const bundleDir = join(agentRoot, "alpha");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    join(bundleDir, "agent.config.json"),
    JSON.stringify({ name: "alpha", knowledge: { sources: [] } }),
  );
  registryPath = join(home, "registry.json");
  await writeFile(
    registryPath,
    JSON.stringify({
      version: 1,
      sources: [{ kind: "user-global", rootPath: agentRoot, label: "user" }],
    }),
  );
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const auth = { headers: { authorization: "Bearer t" } };
// State-changing requests must carry an Origin header that matches the
// server's allowedOrigin (defaults to http://localhost.test in tests).
const authStateChange = {
  headers: { authorization: "Bearer t", origin: "http://localhost.test" },
};

function appUnderTest() {
  return createApp({ token: "t", agentSmithHome: home, registryPath });
}

async function seedSourceCache(agent: string, sourceId: string) {
  const sourceDir = join(home, "knowledge", agent, "sources", sourceId);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "index.md"), "# cached\n");
  await writeFile(join(sourceDir, "extra.json"), '{"a":1}');
  return sourceDir;
}

describe("DELETE /api/agents/:name/knowledge/sources/:id/cache", () => {
  it("returns 204 and removes only the source's cache dir", async () => {
    const app = appUnderTest();
    const targetDir = await seedSourceCache("alpha", "docs");
    // Sibling source — must remain untouched.
    const siblingDir = await seedSourceCache("alpha", "other");

    const res = await app.request(
      "/api/agents/alpha/knowledge/sources/docs/cache",
      { ...authStateChange, method: "DELETE" },
    );
    expect(res.status).toBe(204);
    // Target gone
    let targetExists = true;
    try {
      await readdir(targetDir);
    } catch {
      targetExists = false;
    }
    expect(targetExists).toBe(false);
    // Sibling intact
    const siblingFiles = await readdir(siblingDir);
    expect(siblingFiles.length).toBe(2);
  });

  it("returns 204 idempotently when the cache dir does not exist", async () => {
    const app = appUnderTest();
    const res = await app.request(
      "/api/agents/alpha/knowledge/sources/docs/cache",
      { ...authStateChange, method: "DELETE" },
    );
    expect(res.status).toBe(204);
  });

  it("returns 400 when source id contains a path-traversal sequence", async () => {
    const app = appUnderTest();
    // %2e%2e%2f decodes to "../"
    const res = await app.request(
      "/api/agents/alpha/knowledge/sources/%2e%2e%2fbar/cache",
      { ...authStateChange, method: "DELETE" },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when agent name is invalid", async () => {
    const app = appUnderTest();
    const res = await app.request(
      "/api/agents/%2e%2e%2f/knowledge/sources/docs/cache",
      { ...authStateChange, method: "DELETE" },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the agent is not registered", async () => {
    const app = appUnderTest();
    const res = await app.request(
      "/api/agents/zeta/knowledge/sources/docs/cache",
      { ...authStateChange, method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });

  it("requires the bearer token", async () => {
    const app = appUnderTest();
    const res = await app.request(
      "/api/agents/alpha/knowledge/sources/docs/cache",
      { method: "DELETE", headers: { origin: "http://localhost.test" } },
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/agents/:name/knowledge/sources/:id/cache-status", () => {
  it("returns hasCachedFiles=true when files exist", async () => {
    const app = appUnderTest();
    await seedSourceCache("alpha", "docs");
    const res = await app.request(
      "/api/agents/alpha/knowledge/sources/docs/cache-status",
      auth,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasCachedFiles: boolean };
    expect(body.hasCachedFiles).toBe(true);
  });

  it("returns hasCachedFiles=false when the cache dir is missing", async () => {
    const app = appUnderTest();
    const res = await app.request(
      "/api/agents/alpha/knowledge/sources/docs/cache-status",
      auth,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasCachedFiles: boolean };
    expect(body.hasCachedFiles).toBe(false);
  });

  it("returns hasCachedFiles=false when the cache dir exists but is empty", async () => {
    const app = appUnderTest();
    const emptyDir = join(home, "knowledge", "alpha", "sources", "docs");
    await mkdir(emptyDir, { recursive: true });
    const res = await app.request(
      "/api/agents/alpha/knowledge/sources/docs/cache-status",
      auth,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasCachedFiles: boolean };
    expect(body.hasCachedFiles).toBe(false);
  });

  it("returns 404 when the agent is not registered", async () => {
    const app = appUnderTest();
    const res = await app.request(
      "/api/agents/zeta/knowledge/sources/docs/cache-status",
      auth,
    );
    expect(res.status).toBe(404);
  });

  it("requires the bearer token", async () => {
    const app = appUnderTest();
    const res = await app.request(
      "/api/agents/alpha/knowledge/sources/docs/cache-status",
    );
    expect(res.status).toBe(401);
  });
});
