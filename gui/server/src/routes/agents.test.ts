import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
