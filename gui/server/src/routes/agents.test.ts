import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { JobManager } from "../jobs/job-manager";

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
  root = await mkdtemp(join(tmpdir(), "agents-routes-"));
  registryPath = join(root, "registry.json");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("agents routes", () => {
  it("GET /api/agents lists agents across catalogs", async () => {
    const bundlePath = await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: bundlePath, "claude-code": "/nope", codex: "/nope" }),
    });
    const res = await app.request("/api/agents", { headers: { authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; catalog: string }>;
    expect(body[0]).toMatchObject({ name: "foo", catalog: "default" });
  });

  it("GET /api/agents/:name returns full detail", async () => {
    await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents/foo", { headers: { authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { identity: string };
    expect(body.identity).toContain("IDENTITY");
  });

  it("GET /api/agents/:name 404s when not in registry", async () => {
    await writeFile(registryPath, JSON.stringify({ catalogs: {} }));
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents/missing", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(404);
  });

  it("PUT /api/agents/:name/persona/:file writes the file atomically and returns ok", async () => {
    const bundlePath = await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents/foo/persona/IDENTITY", {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ content: "# new identity\nbody\n" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { readFile } = await import("node:fs/promises");
    const written = await readFile(join(bundlePath, "IDENTITY.md"), "utf8");
    expect(written).toBe("# new identity\nbody\n");
  });

  it("PUT /api/agents/:name/persona/:file 404s when agent not in registry", async () => {
    await writeFile(registryPath, JSON.stringify({ catalogs: {} }));
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents/missing/persona/IDENTITY", {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("PUT /api/agents/:name/persona/:file 400s when :file is not in the allowed enum", async () => {
    await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents/foo/persona/HACKED", {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /api/agents/:name/persona/:file 400s when body content exceeds the max", async () => {
    const bundlePath = await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    // 1 MiB + 1 byte exceeds the schema's max(1_048_576).
    const tooBig = "x".repeat(1_048_577);
    const res = await app.request("/api/agents/foo/persona/IDENTITY", {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ content: tooBig }),
    });
    expect(res.status).toBe(400);
    // Sanity: original file unchanged.
    const { readFile } = await import("node:fs/promises");
    const written = await readFile(join(bundlePath, "IDENTITY.md"), "utf8");
    expect(written).toBe("# IDENTITY.md\nbody\n");
  });

  it("PUT /api/agents/:name/persona/:file 500s when the bundle directory is unwritable", async () => {
    // Register an agent whose bundle path doesn't exist on disk. The atomic
    // writer attempts mkdir(dirname) which succeeds, but the real filesystem
    // location is one we explicitly do NOT create, so we instead simulate a
    // write failure by pointing the registry at a path that already exists
    // as a *file* (so mkdir(parent) of `<file>/IDENTITY.md` fails).
    const filePath = join(root, "catalogs", "default", "foo");
    await mkdir(join(root, "catalogs", "default"), { recursive: true });
    // Make the bundle path a regular file instead of a directory.
    await writeFile(filePath, "not a dir");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents/foo/persona/IDENTITY", {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).toBe(500);
  });

  it("GET /api/agents/:name/installed-status reports per-platform booleans", async () => {
    const bundlePath = await writeBundle("default", "foo");
    // Point at a real FILE (the new probe is Bun.file().exists(), which
    // returns false for directories). `IDENTITY.md` is written by
    // `writeBundle` above.
    const installedFile = join(bundlePath, "IDENTITY.md");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({
        opencode: installedFile,
        "claude-code": "/missing",
        codex: "/missing",
      }),
    });
    const res = await app.request("/api/agents/foo/installed-status", {
      headers: { authorization: "Bearer t" },
    });
    const body = (await res.json()) as { installed: Record<string, boolean> };
    expect(body.installed.opencode).toBe(true);
    expect(body.installed["claude-code"]).toBe(false);
  });

  it("GET /api/agents/:name/installed-status 404s when agent is not in registry", async () => {
    await writeFile(registryPath, JSON.stringify({ catalogs: {} }));
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents/nonexistent/installed-status", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });

  it("GET /api/agents lists all bundles across multiple catalogs (parallel scan)", async () => {
    await writeBundle("default", "foo");
    await writeBundle("default", "bar");
    await writeBundle("extra", "baz");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: {
          default: {
            path: join(root, "catalogs", "default"),
            agents: ["foo", "bar"],
          },
          extra: {
            path: join(root, "catalogs", "extra"),
            agents: ["baz"],
          },
        },
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents", { headers: { authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; catalog: string }>;
    expect(body).toHaveLength(3);
    const names = body.map((b) => b.name).sort();
    expect(names).toEqual(["bar", "baz", "foo"]);
  });

  it("GET /api/agents/:name warns and returns first match when name is duplicated across catalogs", async () => {
    await writeBundle("default", "foo");
    await writeBundle("extra", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: {
          default: { path: join(root, "catalogs", "default"), agents: ["foo"] },
          extra: { path: join(root, "catalogs", "extra"), agents: ["foo"] },
        },
      }),
    );
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const jm = new JobManager({ spawner: fakeSpawner });
      const app = createApp({
        token: "t",
        jobs: jm,
        registryPath,
        installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
      });
      const res = await app.request("/api/agents/foo", {
        headers: { authorization: "Bearer t" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { catalog: string };
      expect(body.catalog).toBe("default");
      const warned = warnSpy.mock.calls.some((args) => {
        const msg = String(args[0]);
        return msg.includes("foo") && msg.includes("default") && msg.includes("extra");
      });
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("PUT /api/agents/:name/persona/:file warns and writes to first match on duplicate-name", async () => {
    const firstBundle = await writeBundle("default", "foo");
    const secondBundle = await writeBundle("extra", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: {
          default: { path: join(root, "catalogs", "default"), agents: ["foo"] },
          extra: { path: join(root, "catalogs", "extra"), agents: ["foo"] },
        },
      }),
    );
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const jm = new JobManager({ spawner: fakeSpawner });
      const app = createApp({
        token: "t",
        jobs: jm,
        registryPath,
        installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
      });
      const res = await app.request("/api/agents/foo/persona/IDENTITY", {
        method: "PUT",
        headers: {
          authorization: "Bearer t",
          "content-type": "application/json",
          origin: "http://localhost.test",
        },
        body: JSON.stringify({ content: "# new\nbody\n" }),
      });
      expect(res.status).toBe(200);
      const { readFile } = await import("node:fs/promises");
      const written = await readFile(join(firstBundle, "IDENTITY.md"), "utf8");
      expect(written).toBe("# new\nbody\n");
      // Second bundle untouched.
      const untouched = await readFile(join(secondBundle, "IDENTITY.md"), "utf8");
      expect(untouched).toBe("# IDENTITY.md\nbody\n");
      const warned = warnSpy.mock.calls.some((args) => {
        const msg = String(args[0]);
        return msg.includes("foo") && msg.includes("default") && msg.includes("extra");
      });
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("GET /api/agents includes remote{} for catalogs cloned from a URL (C4.1.4)", async () => {
    // Use CLI registry shape (v2) so loadAgentRemotes can read the remote
    // block. The translation in parseRegistry will discover the agent via
    // listAgentBundles; the projection then attaches the remote.
    const catalogRoot = join(root, "remote", "github.com", "o", "r");
    await mkdir(join(catalogRoot, "foo"), { recursive: true });
    for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
      await writeFile(join(catalogRoot, "foo", f), `# ${f}\nbody\n`);
    }
    await writeFile(
      join(catalogRoot, "foo", "agent.config.json"),
      JSON.stringify({ name: "foo", description: "test", model: "sonnet", targets: ["opencode"] }),
    );
    await writeFile(
      registryPath,
      JSON.stringify({
        version: 2,
        sources: [
          {
            kind: "registered",
            rootPath: catalogRoot,
            label: "team",
            gitRemote: "https://github.com/o/r.git",
            remote: {
              url: "https://github.com/o/r.git",
              ref: "main",
              lastPulledSha: "a".repeat(40),
              lastPulledAt: "2026-05-25T10:00:00.000Z",
              lastRemoteSha: "b".repeat(40),
              lastCheckedAt: "2026-05-25T10:05:00.000Z",
            },
          },
        ],
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents", { headers: { authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      name: string;
      remote?: { url: string; ref: string; lastPulledSha?: string; lastRemoteSha?: string };
    }>;
    const foo = body.find((b) => b.name === "foo");
    expect(foo?.remote?.url).toBe("https://github.com/o/r.git");
    expect(foo?.remote?.ref).toBe("main");
    expect(foo?.remote?.lastPulledSha).toBe("a".repeat(40));
    expect(foo?.remote?.lastRemoteSha).toBe("b".repeat(40));
  });

  it("GET /api/agents omits remote{} for local (non-remote) catalogs (C4.1.4)", async () => {
    await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const jm = new JobManager({ spawner: fakeSpawner });
    const app = createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
    const res = await app.request("/api/agents", { headers: { authorization: "Bearer t" } });
    const body = (await res.json()) as Array<{ name: string; remote?: unknown }>;
    expect(body.find((b) => b.name === "foo")?.remote).toBeUndefined();
  });
});

describe("PUT /api/agents/:name/config", () => {
  function appWith() {
    const jm = new JobManager({ spawner: fakeSpawner });
    return createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z", kiro: "/k" }),
    });
  }
  function put(app: ReturnType<typeof createApp>, name: string, body: unknown) {
    return app.request(`/api/agents/${name}/config`, {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify(body),
    });
  }

  it("updates targets and modelTier and preserves other keys", async () => {
    const bundlePath = await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const res = await put(appWith(), "foo", { targets: ["opencode", "kiro"], modelTier: "high" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const written = JSON.parse(await readFile(join(bundlePath, "agent.config.json"), "utf8"));
    expect(written.targets).toEqual(["opencode", "kiro"]);
    expect(written.modelTier).toBe("high");
    expect(written.name).toBe("foo");
    expect(written.description).toBe("test");
  });

  it("rejects an empty targets array with 400", async () => {
    await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const res = await put(appWith(), "foo", { targets: [] });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown agent", async () => {
    await writeFile(registryPath, JSON.stringify({ catalogs: {} }));
    const res = await put(appWith(), "ghost", { modelTier: "fast" });
    expect(res.status).toBe(404);
  });

  // ─── Task v2.1-C: knowledge patch ──────────────────────────────────────
  it("writes a canonical `knowledge` block, replacing any prior block", async () => {
    const bundlePath = await writeBundle("default", "foo");
    // Seed a prior knowledge block so we can verify REPLACE semantics
    // (intentional removals must propagate; partial merge would be wrong).
    const cfgPath = join(bundlePath, "agent.config.json");
    const seed = JSON.parse(await readFile(cfgPath, "utf8"));
    seed.knowledge = { sources: [{ id: "old", type: "file", path: "/x", delivery: "inline" }] };
    await writeFile(cfgPath, JSON.stringify(seed));
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const res = await put(appWith(), "foo", {
      knowledge: {
        sources: [
          {
            id: "docs",
            type: "url",
            url: "https://x.test/",
            delivery: "auto",
            summary: "team docs",
            toc: true,
            retrieval: { mode: "bm25" },
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const written = JSON.parse(await readFile(cfgPath, "utf8"));
    expect(written.knowledge.sources).toHaveLength(1);
    expect(written.knowledge.sources[0]).toMatchObject({
      id: "docs",
      type: "url",
      url: "https://x.test/",
      delivery: "auto",
      summary: "team docs",
      toc: true,
      retrieval: { mode: "bm25" },
    });
    // Other top-level keys preserved.
    expect(written.name).toBe("foo");
    expect(written.targets).toEqual(["opencode"]);
  });

  it("rejects a malformed knowledge block with 400 BAD_KNOWLEDGE", async () => {
    await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    // type=url requires url; supplying `path` instead is structurally wrong
    // per the canonical schema's strict per-variant validation.
    const res = await put(appWith(), "foo", {
      knowledge: { sources: [{ id: "bad", type: "url", path: "/oops", delivery: "auto" }] },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BAD_KNOWLEDGE");
  });

  it("accepts a knowledge patch alongside targets/modelTier", async () => {
    const bundlePath = await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const res = await put(appWith(), "foo", {
      targets: ["opencode", "kiro"],
      modelTier: "high",
      knowledge: { sources: [] },
    });
    expect(res.status).toBe(200);
    const written = JSON.parse(await readFile(join(bundlePath, "agent.config.json"), "utf8"));
    expect(written.targets).toEqual(["opencode", "kiro"]);
    expect(written.modelTier).toBe("high");
    expect(written.knowledge).toEqual({ sources: [] });
  });

  // ─── Task v2.1-D: mcpServers patch (MCP wiring toggle) ────────────────
  // `mcpServers` is a string[] of server *names* per the canonical schema —
  // spawn config lives in the user's AI-client global MCP config, not the
  // bundle. The patch REPLACES the array verbatim so toggle-OFF can drop
  // the agent-smith-knowledge name without partial-merge confusion.
  it("writes an mcpServers array, replacing any prior array (toggle-OFF preserves siblings)", async () => {
    const bundlePath = await writeBundle("default", "foo");
    const cfgPath = join(bundlePath, "agent.config.json");
    const seed = JSON.parse(await readFile(cfgPath, "utf8"));
    seed.mcpServers = ["agent-smith-knowledge", "other-server"];
    await writeFile(cfgPath, JSON.stringify(seed));
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    // Toggle-OFF result: only `other-server` survives.
    const res = await put(appWith(), "foo", {
      mcpServers: ["other-server"],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const written = JSON.parse(await readFile(cfgPath, "utf8"));
    expect(written.mcpServers).toEqual(["other-server"]);
    // Other top-level keys preserved.
    expect(written.name).toBe("foo");
    expect(written.targets).toEqual(["opencode"]);
  });

  it("round-trips the canonical agent-smith-knowledge name on toggle-ON", async () => {
    const bundlePath = await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const res = await put(appWith(), "foo", {
      mcpServers: ["agent-smith-knowledge"],
    });
    expect(res.status).toBe(200);
    const written = JSON.parse(await readFile(join(bundlePath, "agent.config.json"), "utf8"));
    expect(written.mcpServers).toEqual(["agent-smith-knowledge"]);
  });

  it("writes an empty mcpServers array (toggle-OFF with no siblings)", async () => {
    const bundlePath = await writeBundle("default", "foo");
    const cfgPath = join(bundlePath, "agent.config.json");
    const seed = JSON.parse(await readFile(cfgPath, "utf8"));
    seed.mcpServers = ["agent-smith-knowledge"];
    await writeFile(cfgPath, JSON.stringify(seed));
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const res = await put(appWith(), "foo", { mcpServers: [] });
    expect(res.status).toBe(200);
    const written = JSON.parse(await readFile(cfgPath, "utf8"));
    expect(written.mcpServers).toEqual([]);
  });

  it("rejects the legacy AI-client object-map shape with 400 (regression guard)", async () => {
    await writeBundle("default", "foo");
    await writeFile(
      registryPath,
      JSON.stringify({
        catalogs: { default: { path: join(root, "catalogs", "default"), agents: ["foo"] } },
      }),
    );
    const res = await put(appWith(), "foo", {
      mcpServers: {
        "agent-smith-knowledge": { command: "smith", args: [] },
      },
    });
    expect(res.status).toBe(400);
  });
});

// ─── Bug A: synthetic self-source visibility ──────────────────────────
//
// The agent-smith bundle ships from a synthetic self-source — the running
// CLI's bundled `agents/` dir at `<workspaceRoot>/agents/`. Without the
// GUI's parseRegistry surfacing it, /api/agents would miss agent-smith
// and PUT /api/agents/agent-smith/config would 404 (or, worse, operate
// on the user-global phantom dir created by writeRefreshManifest).
//
// These tests pin a fixture workspace via SMITH_SELF_SOURCE_WORKSPACE so
// the assertions don't depend on the running repo.
describe("Bug A: synthetic self-source visibility", () => {
  let workspaceRoot: string;
  let bundlePath: string;
  let prevDisable: string | undefined;
  let prevWorkspace: string | undefined;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "self-src-fixture-"));
    // Mark this temp dir as an agent-smith workspace.
    await writeFile(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "agent-smith" }),
      "utf8",
    );
    // Stage the bundled agent-smith inside agents/.
    bundlePath = join(workspaceRoot, "agents", "agent-smith");
    await mkdir(bundlePath, { recursive: true });
    for (const f of ["IDENTITY.md", "EXPERTISE.md", "SOUL.md", "USER.md"]) {
      await writeFile(join(bundlePath, f), `# ${f}\nbody\n`);
    }
    await writeFile(
      join(bundlePath, "agent.config.json"),
      JSON.stringify({
        name: "agent-smith",
        description: "self bundle",
        model: "sonnet",
        targets: ["opencode"],
      }),
    );
    // Persisted registry contains NO agent-smith entry. The synthetic
    // source must surface it on its own.
    await writeFile(
      registryPath,
      JSON.stringify({ schemaVersion: 2, sources: [] }),
    );
    // Suppress test preload's blanket disable; pin our fixture.
    prevDisable = process.env.SMITH_DISABLE_SELF_SOURCE;
    prevWorkspace = process.env.SMITH_SELF_SOURCE_WORKSPACE;
    delete process.env.SMITH_DISABLE_SELF_SOURCE;
    process.env.SMITH_SELF_SOURCE_WORKSPACE = workspaceRoot;
  });

  afterEach(async () => {
    if (prevDisable !== undefined) process.env.SMITH_DISABLE_SELF_SOURCE = prevDisable;
    else delete process.env.SMITH_DISABLE_SELF_SOURCE;
    if (prevWorkspace !== undefined) process.env.SMITH_SELF_SOURCE_WORKSPACE = prevWorkspace;
    else delete process.env.SMITH_SELF_SOURCE_WORKSPACE;
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  function appWith() {
    const jm = new JobManager({ spawner: fakeSpawner });
    return createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z" }),
    });
  }

  it("GET /api/agents lists agent-smith via the synthetic self-source even when the registry has no entry for it", async () => {
    const res = await appWith().request("/api/agents", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; catalog: string; path: string }>;
    const self = body.find((a) => a.name === "agent-smith");
    expect(self).toBeDefined();
    expect(self?.catalog).toBe("agent-smith-self");
    expect(self?.path).toBe(bundlePath);
  });

  it("GET /api/agents/agent-smith resolves to the synthetic source's bundle path", async () => {
    const res = await appWith().request("/api/agents/agent-smith", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; catalog: string; path: string };
    expect(body.name).toBe("agent-smith");
    expect(body.catalog).toBe("agent-smith-self");
    expect(body.path).toBe(bundlePath);
  });

  it("PUT /api/agents/agent-smith/config writes to the synthetic source's bundle path (not user-global)", async () => {
    const res = await appWith().request("/api/agents/agent-smith/config", {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ targets: ["opencode", "claude-code"], modelTier: "high" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const written = JSON.parse(
      await readFile(join(bundlePath, "agent.config.json"), "utf8"),
    );
    expect(written.targets).toEqual(["opencode", "claude-code"]);
    expect(written.modelTier).toBe("high");
  });
});

describe("agent-name validation guard (:name routes)", () => {
  function appWith() {
    const jm = new JobManager({ spawner: fakeSpawner });
    return createApp({
      token: "t",
      jobs: jm,
      registryPath,
      installPathsFor: () => ({ opencode: "/x", "claude-code": "/y", codex: "/z", kiro: "/k" }),
    });
  }
  const TRAVERSAL = "%2E%2E%2Fother"; // decodes to ../other

  it("rejects an invalid name on GET /api/agents/:name with 400", async () => {
    const res = await appWith().request("/api/agents/foo%20bar", {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects path traversal on GET /api/agents/:name/installed-status with 400", async () => {
    const res = await appWith().request(`/api/agents/${TRAVERSAL}/installed-status`, {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects path traversal on PUT /api/agents/:name/persona/:file with 400", async () => {
    const res = await appWith().request(`/api/agents/${TRAVERSAL}/persona/IDENTITY`, {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects path traversal on PUT /api/agents/:name/config with 400 (before any fs access)", async () => {
    const res = await appWith().request(`/api/agents/${TRAVERSAL}/config`, {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        origin: "http://localhost.test",
      },
      body: JSON.stringify({ modelTier: "fast" }),
    });
    expect(res.status).toBe(400);
  });
});
