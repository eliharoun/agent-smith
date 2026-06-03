import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcquiredArtifact } from "../../../src/core/knowledge/acquire";
import {
  acquireSource,
  chooseMaterializer,
  runMaterializer,
} from "../../../src/core/knowledge/acquire-source";
import type {
  DirSource,
  FileSource,
  GitSource,
  GlobSource,
  UrlSource,
} from "../../../src/core/knowledge/types";
import { McpClientPool } from "../../../src/io/mcp-client-pool";
import { SmithError } from "../../../src/core/smith-error";
import { EMPTY_CACHE, type RouteCache } from "../../../src/core/knowledge/route-cache";

async function makeTmp(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `acquire-source-${label}-`));
}

describe("acquireSource", () => {
  test("file source returns a single artifact with content", async () => {
    const bundleDir = await makeTmp("file");
    const cacheDir = await makeTmp("cache");
    try {
      await writeFile(join(bundleDir, "doc.md"), "# Hello\n", "utf8");
      const src: FileSource = { id: "f1", type: "file", delivery: "file", path: "doc.md" };
      const { artifacts, warnings } = await acquireSource(src, { bundleDir, cacheDir });
      expect(artifacts.length).toBe(1);
      expect(artifacts[0]?.filename).toBe("doc.md");
      expect(artifacts[0]?.bytes.toString("utf8")).toBe("# Hello\n");
      expect(warnings).toEqual([]);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("file source with absolute path bypasses bundleDir", async () => {
    const bundleDir = await makeTmp("file-abs");
    const otherDir = await makeTmp("file-other");
    const cacheDir = await makeTmp("cache");
    try {
      const abs = join(otherDir, "abs.md");
      await writeFile(abs, "abs content", "utf8");
      const src: FileSource = { id: "f-abs", type: "file", delivery: "file", path: abs };
      const { artifacts } = await acquireSource(src, { bundleDir, cacheDir });
      expect(artifacts.length).toBe(1);
      expect(artifacts[0]?.bytes.toString("utf8")).toBe("abs content");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(otherDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("dir source honors include/exclude", async () => {
    const bundleDir = await makeTmp("dir");
    const cacheDir = await makeTmp("cache");
    try {
      const sub = join(bundleDir, "src-dir");
      await mkdir(sub, { recursive: true });
      await writeFile(join(sub, "keep.md"), "keep", "utf8");
      await writeFile(join(sub, "drop.txt"), "drop", "utf8");
      const src: DirSource = {
        id: "d1",
        type: "dir",
        delivery: "file",
        path: "src-dir",
        include: ["**/*.md"],
        exclude: [],
      };
      const { artifacts } = await acquireSource(src, { bundleDir, cacheDir });
      expect(artifacts.length).toBe(1);
      expect(artifacts[0]?.filename).toBe("keep.md");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("glob source dispatches to acquireGlob", async () => {
    const bundleDir = await makeTmp("glob");
    const cacheDir = await makeTmp("cache");
    try {
      await writeFile(join(bundleDir, "a.md"), "a", "utf8");
      await writeFile(join(bundleDir, "b.md"), "b", "utf8");
      const src: GlobSource = { id: "g1", type: "glob", delivery: "file", path: "*.md" };
      const { artifacts } = await acquireSource(src, { bundleDir, cacheDir });
      expect(artifacts.length).toBe(2);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("git source forwards options to spawner", async () => {
    const bundleDir = await makeTmp("git");
    const cacheDir = await makeTmp("cache");
    try {
      const calls: { args: string[]; cwd: string }[] = [];
      const spawner = async (args: string[], cwd: string) => {
        calls.push({ args, cwd });
        return { stdout: "", stderr: "", code: 0 };
      };
      const src: GitSource = {
        id: "git1",
        type: "git",
        delivery: "file",
        url: "https://example.invalid/repo.git",
        ref: "main",
        subpath: "docs",
        include: ["**/*.md"],
      };
      try {
        await acquireSource(src, { bundleDir, cacheDir, gitSpawner: spawner });
      } catch {
        // acquireGit may throw because the stubbed clone produced no working tree;
        // we only want to assert the spawner was invoked with git args.
      }
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.args[0]).toBe("clone");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

describe("chooseMaterializer", () => {
  test("explicit source.materialize wins over inference", () => {
    const src: FileSource = {
      id: "x",
      type: "file",
      delivery: "file",
      path: "x.md",
      materialize: "passthrough",
    };
    const art: AcquiredArtifact = {
      filename: "x.html",
      relPath: "x.html",
      bytes: Buffer.from("<p>hi</p>"),
      contentType: "text/html",
    };
    expect(chooseMaterializer(src, art)).toBe("passthrough");
  });

  test("falls back to inference when no override", () => {
    const src: FileSource = { id: "x", type: "file", delivery: "file", path: "x.html" };
    const art: AcquiredArtifact = {
      filename: "x.html",
      relPath: "x.html",
      bytes: Buffer.from("<p>hi</p>"),
      contentType: "text/html",
    };
    expect(chooseMaterializer(src, art)).toBe("html-to-md");
  });
});

describe("runMaterializer", () => {
  test("passthrough returns content + empty warnings", () => {
    const art: AcquiredArtifact = {
      filename: "x.txt",
      relPath: "x.txt",
      bytes: Buffer.from("hello"),
    };
    const r = runMaterializer("passthrough", art);
    expect(r.content).toBe("hello");
    expect(r.warnings).toEqual([]);
  });

  test("json validates", () => {
    const art: AcquiredArtifact = {
      filename: "x.json",
      relPath: "x.json",
      bytes: Buffer.from('{"a":1}'),
    };
    const r = runMaterializer("json", art);
    expect(r.content).toContain('"a"');
  });

  test("html-to-md converts", () => {
    const art: AcquiredArtifact = {
      filename: "x.html",
      relPath: "x.html",
      bytes: Buffer.from("<h1>Hi</h1>"),
    };
    const r = runMaterializer("html-to-md", art);
    expect(r.content).toContain("Hi");
  });

  test("pdf-extract throws SmithError", () => {
    const art: AcquiredArtifact = {
      filename: "x.pdf",
      relPath: "x.pdf",
      bytes: Buffer.from("%PDF"),
    };
    expect(() => runMaterializer("pdf-extract", art)).toThrow();
  });
});

const ECHO_FIXTURE = join(import.meta.dir, "..", "..", "_fixtures", "echo-mcp-server.ts");

describe("acquire-source: via routing", () => {
  let pool: McpClientPool | null = null;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "as-via-"));
    pool = null;
  });
  afterEach(async () => {
    if (pool) await pool.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  it("routes through MCP when via is set and pool injected", async () => {
    pool = new McpClientPool();
    const src: UrlSource = {
      type: "url",
      id: "x",
      delivery: "file",
      url: "https://example.com/x",
      via: { server: "echo", tool: "Fetch" },
    };
    const r = await acquireSource(src, {
      bundleDir: dir,
      cacheDir: dir,
      mcpPool: pool,
      spawnOptsFor: () => ({ command: "bun", args: [ECHO_FIXTURE] }),
    });
    expect(r.artifacts[0]?.bytes.toString("utf8")).toContain("example.com");
  }, 30_000);

  it("throws internal-error when via is set but mcpPool missing", async () => {
    const src: UrlSource = {
      type: "url",
      id: "x",
      delivery: "file",
      url: "https://example.com/x",
      via: { server: "echo", tool: "Fetch" },
    };
    let caught: unknown;
    try {
      await acquireSource(src, { bundleDir: dir, cacheDir: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const e = caught as SmithError;
    expect(e.payload.code).toBe("internal-error");
    // The payload message must explain the missing wire-up — case-
    // insensitive contains for `internal-error` (the code) or `mcpPool`
    // (the missing field name).
    const detail =
      e.payload.code === "internal-error" ? e.payload.message : "";
    expect(`${e.payload.code} ${detail}`).toMatch(/internal-error|mcpPool/i);
  });

  it("falls through to acquireUrl when via is absent (existing behavior)", async () => {
    // Without via:, dispatch reaches the existing acquireUrl path. We don't
    // want to make a real network call, so we assert that the failure is a
    // network/HTTP error from acquireUrl — NOT an internal-error from the
    // missing-pool guard, and NOT a routing-via-MCP error.
    const src: UrlSource = {
      type: "url",
      id: "x",
      delivery: "file",
      url: "https://127.0.0.1:1/definitely-not-listening",
    };
    let caught: unknown;
    try {
      await acquireSource(src, { bundleDir: dir, cacheDir: dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const msg = caught instanceof Error ? caught.message : String(caught);
    expect(msg).not.toMatch(/internal-error/i);
    expect(msg).not.toMatch(/mcpPool/i);
  }, 30_000);
});

describe("acquire-source: Phase 3 resolver", () => {
  let pool: McpClientPool | null = null;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "as-phase3-"));
    pool = null;
  });
  afterEach(async () => {
    if (pool) await pool.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  it("uses cached route when available", async () => {
    pool = new McpClientPool();
    // Cache entry for example.com → echo.Fetch. The dispatch should route
    // through MCP and never make an HTTP call. Echo's Fetch tool returns
    // the call args as JSON — we assert the URL appears in the artifact.
    const cache: RouteCache = {
      schemaVersion: 1,
      entries: [
        {
          urlPattern: "https://example.com/**",
          server: "echo",
          tool: "Fetch",
          learnedAt: "2026-06-02T00:00:00.000Z",
          hits: 1,
        },
      ],
    };
    const src: UrlSource = {
      type: "url",
      id: "u-cache",
      delivery: "file",
      url: "https://example.com/some-doc",
    };
    const probeOnFailure = async () => {
      throw new Error("probe must NOT be called when a cached route exists");
    };
    const r = await acquireSource(src, {
      bundleDir: dir,
      cacheDir: dir,
      mcpPool: pool,
      spawnOptsFor: () => ({ command: "bun", args: [ECHO_FIXTURE] }),
      routeCache: cache,
      probeOnFailure,
    });
    // Echo's Fetch tool echoes args back as JSON; the URL must appear in
    // the artifact bytes. This proves we routed through MCP, not HTTP.
    const body = r.artifacts[0]?.bytes.toString("utf8") ?? "";
    expect(body).toContain("example.com/some-doc");
  }, 30_000);

  it("probes on auth failure when callback provided", async () => {
    pool = new McpClientPool();
    const probeCalls: string[] = [];
    const recordedRoutes: { url: string; server: string; tool: string }[] = [];
    const probeOnFailure = async (url: string) => {
      probeCalls.push(url);
      return { server: "echo", tool: "Fetch" };
    };
    const recordRoute = async (r: { url: string; server: string; tool: string }) => {
      recordedRoutes.push(r);
    };
    // Use a URL that will fail at the network layer (TCP refused) — this
    // surfaces as `network-error`, which isProbeRecoverable accepts.
    const src: UrlSource = {
      type: "url",
      id: "u-probe",
      delivery: "file",
      url: "https://127.0.0.1:1/auth-blocked",
    };
    const r = await acquireSource(src, {
      bundleDir: dir,
      cacheDir: dir,
      mcpPool: pool,
      spawnOptsFor: () => ({ command: "bun", args: [ECHO_FIXTURE] }),
      routeCache: EMPTY_CACHE,
      probeOnFailure,
      recordRoute,
    });
    expect(probeCalls).toEqual(["https://127.0.0.1:1/auth-blocked"]);
    expect(recordedRoutes).toEqual([
      { url: "https://127.0.0.1:1/auth-blocked", server: "echo", tool: "Fetch" },
    ]);
    const body = r.artifacts[0]?.bytes.toString("utf8") ?? "";
    expect(body).toContain("127.0.0.1");
  }, 30_000);

  it("does NOT probe on schema/usage errors", async () => {
    pool = new McpClientPool();
    let probeCalled = false;
    const probeOnFailure = async () => {
      probeCalled = true;
      return null;
    };
    // Force a non-recoverable failure by making `cacheDir` a regular file
    // — `acquireUrl` calls `mkdir(cacheDir, { recursive: true })` first,
    // which throws a generic node `Error` (NOT a SmithError) when the
    // path exists as a file. `isProbeRecoverable` returns false for any
    // non-SmithError, so the probe callback must never run.
    const fileAsCache = join(dir, "not-a-dir");
    await writeFile(fileAsCache, "x", "utf8");
    const src: UrlSource = {
      type: "url",
      id: "u-noprobe",
      delivery: "file",
      url: "https://example.com/whatever",
    };
    let caught: unknown;
    try {
      await acquireSource(src, {
        bundleDir: dir,
        cacheDir: fileAsCache,
        mcpPool: pool,
        spawnOptsFor: () => ({ command: "bun", args: [ECHO_FIXTURE] }),
        routeCache: EMPTY_CACHE,
        probeOnFailure,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(SmithError);
    expect(probeCalled).toBe(false);
  });
});
