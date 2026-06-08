import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentKnowledgeView } from "../../../shared/src/index";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { errorHandler, errorMiddleware } from "../middleware/error";
import { registerKnowledgeRoute } from "./knowledge";

let home: string;

async function setup() {
  home = await mkdtemp(join(tmpdir(), "knowledge-route-"));
  // Agent bundle with knowledge sources.
  const agentRoot = join(home, "agents");
  const bundle = join(agentRoot, "myagent");
  await mkdir(bundle, { recursive: true });
  await writeFile(
    join(bundle, "agent.config.json"),
    JSON.stringify({
      name: "myagent",
      knowledge: {
        sources: [
          { id: "src-a", type: "file", path: "./a.md" },
          { id: "src-b", type: "url", url: "https://example.com/x" },
        ],
      },
    }),
  );
  // Registry pointing at agentRoot.
  await writeFile(
    join(home, "registry.json"),
    JSON.stringify({
      version: 1,
      sources: [{ kind: "user-global", rootPath: agentRoot, label: "a" }],
    }),
  );
  // Knowledge manifest (under agentSmithHome/knowledge/myagent/_manifest.json).
  const smithHome = join(home, "smith-home");
  const manifestDir = join(smithHome, "knowledge", "myagent");
  await mkdir(manifestDir, { recursive: true });
  await writeFile(
    join(manifestDir, "_manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      renderedAt: "2026-05-21T00:00:00Z",
      sources: [
        {
          id: "src-a",
          type: "file",
          files: [],
          tokensInline: 100,
        },
      ],
      totals: {
        tokensInline: 100,
        tokensInlineBudget: 1000,
        files: 0,
        bytes: 0,
      },
    }),
  );
  // Refresh consent manifest.
  const refreshManifestDir = join(smithHome, "refresh", "myagent");
  await mkdir(refreshManifestDir, { recursive: true });
  await writeFile(
    join(refreshManifestDir, "refresh-manifest.json"),
    JSON.stringify({
      agent: "myagent",
      refresh_consent: {
        granted_at: "2026-05-21T00:00:00Z",
        platforms: ["opencode"],
        sources: ["src-a"],
      },
    }),
  );
  // Refresh cache entry for src-a (under cacheRoot/agents/myagent/sources/).
  const cacheRoot = join(home, "cache");
  const cacheDir = join(cacheRoot, "agents", "myagent", "sources");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "src-a.meta.json"),
    JSON.stringify({
      last_refreshed_at: "2026-05-21T00:00:00Z",
      last_attempt_at: "2026-05-21T00:00:00Z",
      last_error: null,
    }),
  );

  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerKnowledgeRoute(app, {
    registryPath: join(home, "registry.json"),
    agentSmithHome: smithHome,
    cacheRoot,
    // Default to all platforms detected so PUT-consent tests don't depend
    // on the host PATH. Tests covering the filter override this explicitly.
    detectInstalledPlatforms: async () =>
      new Set(["opencode", "claude-code", "codex", "kiro"]),
  });
  app.onError(errorHandler);
  return app;
}

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const auth = { headers: { authorization: "Bearer t" } };

it("GET /api/knowledge/:agent joins config + manifest + cache + consent", async () => {
  const app = await setup();
  const res = await app.request("/api/knowledge/myagent", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as AgentKnowledgeView;
  expect(j.agent).toBe("myagent");
  expect(j.sources.length).toBe(2);
  const a = j.sources.find((s) => s.source.id === "src-a");
  const b = j.sources.find((s) => s.source.id === "src-b");
  expect(a?.manifestEntry?.id).toBe("src-a");
  expect(a?.refreshCache?.last_refreshed_at).toBe("2026-05-21T00:00:00Z");
  expect(b?.manifestEntry).toBeUndefined();
  expect(b?.refreshCache).toBeUndefined();
  expect(j.totals?.tokensInline).toBe(100);
  expect(j.consent?.granted_at).toBe("2026-05-21T00:00:00Z");
  expect(j.consent?.platforms).toEqual(["opencode"]);
});

it("GET /api/knowledge/:agent returns 404 when agent not registered", async () => {
  const app = await setup();
  const res = await app.request("/api/knowledge/nope", auth);
  expect(res.status).toBe(404);
});

it("GET /api/knowledge/:agent/refresh-history returns sourceId-keyed entries", async () => {
  const app = await setup();
  const res = await app.request("/api/knowledge/myagent/refresh-history", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as {
    entries: Array<{ sourceId: string }>;
    consent?: { granted_at: string };
  };
  expect(j.entries.length).toBe(1);
  expect(j.entries[0]?.sourceId).toBe("src-a");
  expect(j.consent?.granted_at).toBe("2026-05-21T00:00:00Z");
});

it("GET /api/knowledge/refresh-summary aggregates per-agent counts and lastRefreshAt", async () => {
  const app = await setup();
  const res = await app.request("/api/knowledge/refresh-summary", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as {
    summaries: Array<{
      agent: string;
      sourceCount: number;
      failingCount: number;
      lastRefreshAt?: string;
    }>;
  };
  expect(j.summaries.length).toBe(1);
  const s = j.summaries[0];
  expect(s?.agent).toBe("myagent");
  expect(s?.sourceCount).toBe(2);
  expect(s?.failingCount).toBe(0);
  expect(s?.lastRefreshAt).toBe("2026-05-21T00:00:00Z");
});

it("GET /api/knowledge/refresh-summary returns empty list when no agents registered", async () => {
  home = await mkdtemp(join(tmpdir(), "knowledge-empty-"));
  await writeFile(join(home, "registry.json"), JSON.stringify({ version: 1, sources: [] }));
  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerKnowledgeRoute(app, { registryPath: join(home, "registry.json") });
  app.onError(errorHandler);
  const res = await app.request("/api/knowledge/refresh-summary", auth);
  expect(res.status).toBe(200);
  const j = (await res.json()) as { summaries: unknown[] };
  expect(j.summaries).toEqual([]);
});

it("POST /api/knowledge/parse-url returns parsed kind", async () => {
  const app = await setup();
  const res = await app.request("/api/knowledge/parse-url", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ url: "https://acme.atlassian.net/browse/ENG-1" }),
  });
  expect(res.status).toBe(200);
  const j = (await res.json()) as { kind: string; key?: string };
  expect(j.kind).toBe("jira-issue");
  expect(j.key).toBe("ENG-1");
});

it("POST /api/knowledge/parse-url returns 400 on missing url", async () => {
  const app = await setup();
  const res = await app.request("/api/knowledge/parse-url", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});

it("POST /api/knowledge/parse-url returns 400 on invalid url", async () => {
  const app = await setup();
  const res = await app.request("/api/knowledge/parse-url", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ url: "not a url" }),
  });
  expect(res.status).toBe(400);
});

it("PUT /api/knowledge/:agent/consent writes the refresh manifest", async () => {
  // Use the standard setup (which pre-seeds an existing consent
  // manifest). PUT overwrites it; we verify the new payload's
  // platforms/sources land on disk.
  const app = await setup();

  // PUT consent with a different shape than the pre-seeded one.
  const put = await app.request("/api/knowledge/myagent/consent", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ platforms: ["opencode", "claude-code"], sources: ["src-a", "src-b"] }),
  });
  expect(put.status).toBe(200);

  // GET reflects the new shape (overwritten, not merged).
  const after = await app.request("/api/knowledge/myagent", auth);
  expect(after.status).toBe(200);
  const afterJson = (await after.json()) as {
    consent?: { granted_at: string; platforms: string[]; sources: string[] };
  };
  expect(afterJson.consent).toBeDefined();
  expect(afterJson.consent?.platforms).toEqual(["opencode", "claude-code"]);
  expect(afterJson.consent?.sources).toEqual(["src-a", "src-b"]);
  expect(typeof afterJson.consent?.granted_at).toBe("string");
  // granted_at is freshly generated at PUT time, distinct from the
  // pre-seeded "2026-05-21" timestamp.
  expect(afterJson.consent?.granted_at).not.toBe("2026-05-21T00:00:00Z");
});

it("PUT /api/knowledge/:agent/consent rejects an unregistered agent name", async () => {
  const app = await setup();
  const res = await app.request("/api/knowledge/does-not-exist/consent", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ platforms: ["opencode"], sources: [] }),
  });
  expect(res.status).toBe(404);
});

it("PUT /api/knowledge/:agent/consent rejects malformed body", async () => {
  const app = await setup();
  const res = await app.request("/api/knowledge/myagent/consent", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ platforms: "not-an-array" }),
  });
  expect(res.status).toBe(400);
});

it("defensive platform filter — drops platforms whose CLI isn't detected", async () => {
  // Build the same fixture as setup() but inject a detectInstalledPlatforms
  // that only reports two of the four platforms as installed. The route
  // should drop the uninstalled ones before writing the manifest, even
  // though the client sent all four.
  home = await mkdtemp(join(tmpdir(), "knowledge-route-filter-"));
  const agentRoot = join(home, "agents");
  const bundle = join(agentRoot, "myagent");
  await mkdir(bundle, { recursive: true });
  await writeFile(
    join(bundle, "agent.config.json"),
    JSON.stringify({
      name: "myagent",
      knowledge: { sources: [{ id: "src-a", type: "file", path: "./a.md" }] },
    }),
  );
  await writeFile(
    join(home, "registry.json"),
    JSON.stringify({
      version: 1,
      sources: [{ kind: "user-global", rootPath: agentRoot, label: "a" }],
    }),
  );
  const smithHome = join(home, "smith-home");

  const app = new Hono();
  app.use("*", errorMiddleware);
  app.use("/api/*", authMiddleware("t"));
  registerKnowledgeRoute(app, {
    registryPath: join(home, "registry.json"),
    agentSmithHome: smithHome,
    detectInstalledPlatforms: async () => new Set(["claude-code", "kiro"]),
  });
  app.onError(errorHandler);

  const put = await app.request("/api/knowledge/myagent/consent", {
    method: "PUT",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({
      platforms: ["opencode", "claude-code", "codex", "kiro"],
      sources: ["src-a"],
    }),
  });
  expect(put.status).toBe(200);

  // Read back via GET — the manifest must reflect only the detected platforms.
  const after = await app.request("/api/knowledge/myagent", auth);
  expect(after.status).toBe(200);
  const j = (await after.json()) as {
    consent?: { platforms: string[]; sources: string[] };
  };
  expect(j.consent).toBeDefined();
  expect([...(j.consent?.platforms ?? [])].sort()).toEqual(["claude-code", "kiro"]);
  expect(j.consent?.sources).toEqual(["src-a"]);
});
