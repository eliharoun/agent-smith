import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstallCliOptions } from "../../src/cli/commands/install";
import { type KnowledgeFetchDeps, knowledgeFetch } from "../../src/cli/commands/knowledge/fetch";
import { urlCacheKey } from "../../src/core/knowledge/acquire";
import { installLockPath } from "../../src/core/knowledge/refresh-lock";
import type { RouteCache } from "../../src/core/knowledge/route-cache";
import { SmithError } from "../../src/core/smith-error";
import { cacheDirFor } from "../../src/io/knowledge-paths";

/** Build a stub `loadAllBundles` that returns the given bundles + no failures.
 *  Tests that only care about install behaviour pass `[]` to ensure the
 *  post-install refresh-cache block finds no bundle and is a no-op (no real
 *  filesystem access). */
function stubLoadBundles(bundles: unknown[] = []) {
  return mock(
    async () =>
      ({ bundles, failures: [] }) as unknown as Awaited<
        ReturnType<NonNullable<KnowledgeFetchDeps["loadAllBundles"]>>
      >,
  ) as unknown as NonNullable<KnowledgeFetchDeps["loadAllBundles"]>;
}

/** Build a stub `loadRegistry` that returns an empty registry shape; only used
 *  upstream of the stubbed `loadAllBundles` (which ignores it anyway). */
function stubLoadRegistry() {
  return mock(
    async () =>
      ({ sources: [] }) as unknown as Awaited<
        ReturnType<NonNullable<KnowledgeFetchDeps["loadRegistry"]>>
      >,
  ) as unknown as NonNullable<KnowledgeFetchDeps["loadRegistry"]>;
}

/** Common safe deps for tests that don't care about refresh-cache writes:
 *  ensures the post-install block never touches the real filesystem. */
function safeDeps(installFn: KnowledgeFetchDeps["install"]): KnowledgeFetchDeps {
  return {
    install: installFn,
    loadRegistry: stubLoadRegistry(),
    loadAllBundles: stubLoadBundles([]),
  };
}

/** Build a minimal AgentBundle shape that knowledgeFetch needs:
 *  config.name, config.knowledge.sources, bundlePath. */
function fakeBundle(
  name: string,
  sources: Array<{
    id: string;
    type: string;
    delivery?: string;
    [k: string]: unknown;
  }>,
) {
  return {
    bundlePath: "/fake/bundle/dir",
    config: { name, knowledge: { sources } },
  } as unknown;
}

describe("knowledgeFetch", () => {
  let dir: string;
  let tmpStateHome: string;
  let origXdgStateHome: string | undefined;
  const spies: Array<ReturnType<typeof spyOn>> = [];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-kf-"));
    tmpStateHome = await mkdtemp(join(tmpdir(), "smith-kf-state-"));
    origXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = tmpStateHome;
  });
  afterEach(async () => {
    for (const s of spies.splice(0)) s.mockRestore();
    if (origXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = origXdgStateHome;
    await rm(dir, { recursive: true, force: true });
    await rm(tmpStateHome, { recursive: true, force: true });
  });

  it("re-runs install for the named agent", async () => {
    const installFn = mock(async (_opts: string | InstallCliOptions) => 0);
    const code = await knowledgeFetch("my-agent", undefined, safeDeps(installFn));
    expect(code).toBe(0);
    expect(installFn).toHaveBeenCalledWith("my-agent");
  });

  it("propagates install failure", async () => {
    const installFn = mock(async (_opts: string | InstallCliOptions) => 1);
    const code = await knowledgeFetch("my-agent", undefined, safeDeps(installFn));
    expect(code).toBe(1);
  });

  it("when --source is given for a URL source and the cache files don't exist, succeeds silently (ENOENT swallowed)", async () => {
    // Per-source clear targets `<cacheDir>/<urlCacheKey(url)>.{json,bin}`.
    // If neither exists, rm({force:true}) returns without error and the surgical path runs.
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const sources = [{ id: "src", type: "url", delivery: "file", url: "https://example.com/x" }];
    const installFn = mock(async (_opts: string | InstallCliOptions) => 0);
    const refreshSourceFn = mock(async () => ({
      kind: "refreshed" as const,
      sourceId: "src",
      bytes: 100,
      entries: 1,
      tokens: 0,
      durationMs: 10,
    }));
    const rerenderFn = mock(async () => ({ ok: true as const }));
    const code = await knowledgeFetch("agent-noenoent", "src", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-noenoent", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      knowledgePaths: { agentSmithHome: dir },
    });
    expect(code).toBe(0);
    // Surgical path: refreshSource called, install NOT called
    expect(refreshSourceFn).toHaveBeenCalled();
    expect(installFn).not.toHaveBeenCalled();
  });

  // --- Defense-in-depth: traversal in agent-name CLI arg ---------------
  // knowledgeFetch with a sourceId calls rm(recursive:true) on a path built
  // from the agent name BEFORE any bundle lookup. assertValidAgentName
  // must reject traversal sequences, absolute paths, NUL bytes, backslash,
  // hidden-dot, empty string, and non-kebab shapes — and MUST NOT call
  // install or rm. We assert by checking the install spy was never invoked
  // and the rm spy never observed a call.
  for (const bad of ["../etc", "/abs/path", "a\0b", "a/b", "a\\b", ".hidden", "", "BadCase"]) {
    it(`rejects agent name ${JSON.stringify(bad)} with validation-failed before any IO`, async () => {
      const installFn = mock(async (_opts: string | InstallCliOptions) => 0);
      const rmSpy = spyOn(fsPromises, "rm").mockImplementation(async () => {
        throw new Error("rm should not be called");
      });
      spies.push(rmSpy as unknown as ReturnType<typeof spyOn>);
      let caught: unknown;
      try {
        await knowledgeFetch(bad, "any-source", safeDeps(installFn));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SmithError);
      expect((caught as InstanceType<typeof SmithError>).payload.code).toBe("validation-failed");
      expect(installFn).not.toHaveBeenCalled();
      expect(rmSpy).not.toHaveBeenCalled();
    });
  }

  it("when --source is given and per-source rm fails with non-ENOENT, propagates and does not call install", async () => {
    // Per-source clear runs BEFORE install. EACCES (e.g. read-only cache dir)
    // must surface so the user can act — install must NOT run, because a stale
    // cache would otherwise be silently reused.
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const sources = [{ id: "src", type: "url", delivery: "file", url: "https://example.com/x" }];
    const rmSpy = spyOn(fsPromises, "rm").mockImplementation(async () => {
      const e: NodeJS.ErrnoException = Object.assign(new Error("permission denied"), {
        code: "EACCES",
      });
      throw e;
    });
    spies.push(rmSpy as unknown as ReturnType<typeof spyOn>);
    const installFn = mock(async (_opts: string | InstallCliOptions) => 0);
    let caught: unknown;
    try {
      await knowledgeFetch("locked-agent", "src", {
        install: installFn,
        loadRegistry: stubLoadRegistry(),
        loadAllBundles: stubLoadBundles([fakeBundle("locked-agent", sources)]),
        knowledgePaths: { agentSmithHome: dir },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(String(caught)).toContain("src");
    expect(installFn).not.toHaveBeenCalled();
  });

  it("when --source is given for a URL source, clears only that source's cache files and leaves other URL caches intact", async () => {
    // Pre-create real cache files for two URL sources in a temp knowledge home;
    // request a refresh for source A; assert A's files are gone and B's remain.
    const urlA = "https://example.com/a";
    const urlB = "https://example.com/b";
    const sources = [
      { id: "id-a", type: "url", delivery: "file", url: urlA },
      { id: "id-b", type: "url", delivery: "file", url: urlB },
    ];
    const knowledgePaths = { agentSmithHome: dir };
    const cacheDir = cacheDirFor("agent-multi", knowledgePaths);
    await mkdir(cacheDir, { recursive: true });
    const keyA = urlCacheKey(urlA);
    const keyB = urlCacheKey(urlB);
    const aJson = join(cacheDir, `${keyA}.json`);
    const aBin = join(cacheDir, `${keyA}.bin`);
    const bJson = join(cacheDir, `${keyB}.json`);
    const bBin = join(cacheDir, `${keyB}.bin`);
    await writeFile(aJson, "{}");
    await writeFile(aBin, "a-body");
    await writeFile(bJson, "{}");
    await writeFile(bBin, "b-body");

    const installFn = mock(async (_opts: string | InstallCliOptions) => 0);
    const refreshSourceFn = mock(async () => ({
      kind: "refreshed" as const,
      sourceId: "id-a",
      bytes: 100,
      entries: 1,
      tokens: 0,
      durationMs: 10,
    }));
    const rerenderFn = mock(async () => ({ ok: true as const }));
    const code = await knowledgeFetch("agent-multi", "id-a", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-multi", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      knowledgePaths,
    });

    expect(code).toBe(0);
    expect(existsSync(aJson)).toBe(false);
    expect(existsSync(aBin)).toBe(false);
    expect(existsSync(bJson)).toBe(true);
    expect(existsSync(bBin)).toBe(true);
  });

  it("when --source is given for a git source, clears that source's git checkout directory", async () => {
    const gitUrl = "https://github.com/example/repo.git";
    const sources = [{ id: "git-src", type: "git", delivery: "file", url: gitUrl }];
    const knowledgePaths = { agentSmithHome: dir };
    const cacheDir = cacheDirFor("agent-git", knowledgePaths);
    const key = urlCacheKey(gitUrl);
    const checkoutDir = join(cacheDir, "git", key);
    await mkdir(checkoutDir, { recursive: true });
    const sentinel = join(checkoutDir, "README.md");
    await writeFile(sentinel, "# repo");

    const installFn = mock(async (_opts: string | InstallCliOptions) => 0);
    const refreshSourceFn = mock(async () => ({
      kind: "refreshed" as const,
      sourceId: "git-src",
      bytes: 100,
      entries: 1,
      tokens: 0,
      durationMs: 10,
    }));
    const rerenderFn = mock(async () => ({ ok: true as const }));
    const code = await knowledgeFetch("agent-git", "git-src", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-git", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      knowledgePaths,
    });

    expect(code).toBe(0);
    expect(existsSync(checkoutDir)).toBe(false);
    expect(existsSync(sentinel)).toBe(false);
  });

  // ============================================================
  // post-install per-source refresh-cache writes
  // ============================================================

  it("writes .meta.json per acquirable source on successful fetch (last_error=null, timestamps=now)", async () => {
    const sources = [
      { id: "src-a", type: "file", delivery: "file", path: "a.md" },
      { id: "src-b", type: "url", delivery: "file", url: "https://example.com/b" },
    ];
    const installFn = mock(async () => 0);
    const writes: Array<{ root: string; agent: string; sourceId: string; entry: unknown }> = [];
    const writeStub = mock(
      async (root: string, agent: string, sourceId: string, entry: unknown) => {
        writes.push({ root, agent, sourceId, entry });
      },
    );
    const acquireStub = mock(async () => ({ artifacts: [], warnings: [] }));
    const readStub = mock(async () => undefined);
    const now = "2026-05-21T12:00:00.000Z";

    const code = await knowledgeFetch("agent-x", undefined, {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-x", sources)]),
      acquireSource: acquireStub as unknown as NonNullable<KnowledgeFetchDeps["acquireSource"]>,
      writeRefreshCache: writeStub as unknown as NonNullable<
        KnowledgeFetchDeps["writeRefreshCache"]
      >,
      readRefreshCache: readStub as unknown as NonNullable<KnowledgeFetchDeps["readRefreshCache"]>,
      now: () => now,
      cacheRoot: () => dir,
    });

    expect(code).toBe(0);
    expect(acquireStub).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.sourceId).sort()).toEqual(["src-a", "src-b"]);
    for (const w of writes) {
      expect(w.root).toBe(dir);
      expect(w.agent).toBe("agent-x");
      expect(w.entry).toEqual({
        schemaVersion: 1,
        last_refreshed_at: now,
        last_attempt_at: now,
        last_error: null,
      });
    }
  });

  it("writes .meta.json with last_error set on failed source; preserves prior last_refreshed_at", async () => {
    const sources = [{ id: "bad", type: "url", delivery: "file", url: "https://x" }];
    const installFn = mock(async () => 0);
    const writes: Array<{ sourceId: string; entry: any }> = [];
    const writeStub = mock(async (_r: string, _a: string, sourceId: string, entry: unknown) => {
      writes.push({ sourceId, entry });
    });
    const acquireStub = mock(async () => {
      throw new Error("network unreachable");
    });
    const priorTs = "2026-05-20T00:00:00.000Z";
    const readStub = mock(async () => ({
      last_refreshed_at: priorTs,
      last_attempt_at: priorTs,
      last_error: null,
    }));
    const now = "2026-05-21T12:00:00.000Z";

    const code = await knowledgeFetch("agent-y", undefined, {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-y", sources)]),
      acquireSource: acquireStub as unknown as NonNullable<KnowledgeFetchDeps["acquireSource"]>,
      writeRefreshCache: writeStub as unknown as NonNullable<
        KnowledgeFetchDeps["writeRefreshCache"]
      >,
      readRefreshCache: readStub as unknown as NonNullable<KnowledgeFetchDeps["readRefreshCache"]>,
      now: () => now,
      cacheRoot: () => dir,
    });

    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.entry.last_error).toBe("network unreachable");
    expect(writes[0]!.entry.last_attempt_at).toBe(now);
    // last_refreshed_at must be preserved from prior so consumers know the
    // cached content is still the last-good.
    expect(writes[0]!.entry.last_refreshed_at).toBe(priorTs);
  });

  it("when sourceId is given, surgical path runs (no meta-write block)", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const sources = [
      { id: "keep-a", type: "file", delivery: "file", path: "a.md" },
      { id: "target", type: "url", delivery: "file", url: "https://x" },
      { id: "keep-b", type: "file", delivery: "file", path: "b.md" },
    ];
    const installFn = mock(async () => 0);
    const refreshSourceFn = mock(async () => ({
      kind: "refreshed" as const,
      sourceId: "target",
      bytes: 100,
      entries: 1,
      tokens: 0,
      durationMs: 10,
    }));
    const rerenderFn = mock(async () => ({ ok: true as const }));
    const writes: string[] = [];
    const writeStub = mock(async (_r: string, _a: string, sourceId: string, _e: unknown) => {
      writes.push(sourceId);
    });

    const code = await knowledgeFetch("agent-z", "target", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-z", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      writeRefreshCache: writeStub as unknown as NonNullable<
        KnowledgeFetchDeps["writeRefreshCache"]
      >,
      now: () => "2026-05-21T12:00:00.000Z",
      cacheRoot: () => dir,
      knowledgePaths: { agentSmithHome: dir },
    });

    expect(code).toBe(0);
    // Surgical path: refreshSource + rerender, no install, no meta-writes
    expect(refreshSourceFn).toHaveBeenCalled();
    expect(rerenderFn).toHaveBeenCalled();
    expect(installFn).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  // ============================================================
  // C.2 / F.F: post-install meta block gated on install success
  // ============================================================

  it("post-install meta block does NOT run when install() returns non-zero", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    spies.push(errSpy as unknown as ReturnType<typeof spyOn>);
    const sources = [{ id: "src-a", type: "url", delivery: "file", url: "https://example.com/a" }];
    const installFn = mock(async () => 1);
    const writes: string[] = [];
    const writeStub = mock(async (_r: string, _a: string, sourceId: string, _e: unknown) => {
      writes.push(sourceId);
    });
    const acquireStub = mock(async () => ({ artifacts: [], warnings: [] }));
    const readStub = mock(async () => undefined);

    const code = await knowledgeFetch("agent-fail", undefined, {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-fail", sources)]),
      acquireSource: acquireStub as unknown as NonNullable<KnowledgeFetchDeps["acquireSource"]>,
      writeRefreshCache: writeStub as unknown as NonNullable<
        KnowledgeFetchDeps["writeRefreshCache"]
      >,
      readRefreshCache: readStub as unknown as NonNullable<KnowledgeFetchDeps["readRefreshCache"]>,
      now: () => "2026-05-21T12:00:00.000Z",
      cacheRoot: () => dir,
    });

    expect(code).toBe(1);
    // No meta writes should have happened
    expect(writes).toHaveLength(0);
    expect(acquireStub).not.toHaveBeenCalled();
    // Error message should identify agent and exit code
    const errOutput = errSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errOutput).toContain("agent-fail");
    expect(errOutput).toContain("1");
  });

  it("post-install meta block still runs when install() succeeds", async () => {
    const sources = [
      { id: "src-ok", type: "url", delivery: "file", url: "https://example.com/ok" },
    ];
    const installFn = mock(async () => 0);
    const writes: string[] = [];
    const writeStub = mock(async (_r: string, _a: string, sourceId: string, _e: unknown) => {
      writes.push(sourceId);
    });
    const acquireStub = mock(async () => ({ artifacts: [], warnings: [] }));
    const readStub = mock(async () => undefined);

    const code = await knowledgeFetch("agent-ok", undefined, {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-ok", sources)]),
      acquireSource: acquireStub as unknown as NonNullable<KnowledgeFetchDeps["acquireSource"]>,
      writeRefreshCache: writeStub as unknown as NonNullable<
        KnowledgeFetchDeps["writeRefreshCache"]
      >,
      readRefreshCache: readStub as unknown as NonNullable<KnowledgeFetchDeps["readRefreshCache"]>,
      now: () => "2026-05-21T12:00:00.000Z",
      cacheRoot: () => dir,
    });

    expect(code).toBe(0);
    // Meta writes SHOULD have happened
    expect(writes).toEqual(["src-ok"]);
    expect(acquireStub).toHaveBeenCalledTimes(1);
  });

  // ============================================================
  // Task 7B: --source routes through refreshSource + rerenderPrompts
  // ============================================================

  it("--source routes through refreshSource (not install)", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const sources = [{ id: "src-a", type: "url", delivery: "file", url: "https://example.com/a" }];
    const installFn = mock(async () => 0);
    const refreshSourceFn = mock(async () => ({
      kind: "refreshed" as const,
      sourceId: "src-a",
      bytes: 100,
      entries: 1,
      tokens: 0,
      durationMs: 10,
    }));
    const rerenderFn = mock(async () => ({ ok: true as const }));

    const code = await knowledgeFetch("agent-surgical", "src-a", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-surgical", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      knowledgePaths: { agentSmithHome: dir },
    });

    expect(code).toBe(0);
    expect(refreshSourceFn).toHaveBeenCalled();
    expect(installFn).not.toHaveBeenCalled();
  });

  it("--source success calls rerenderPrompts", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const sources = [{ id: "src-b", type: "url", delivery: "file", url: "https://example.com/b" }];
    const installFn = mock(async () => 0);
    const refreshSourceFn = mock(async () => ({
      kind: "refreshed" as const,
      sourceId: "src-b",
      bytes: 200,
      entries: 2,
      tokens: 0,
      durationMs: 5,
    }));
    const rerenderFn = mock(async () => ({ ok: true as const }));

    const code = await knowledgeFetch("agent-rerender", "src-b", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-rerender", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      knowledgePaths: { agentSmithHome: dir },
    });

    expect(code).toBe(0);
    expect(rerenderFn).toHaveBeenCalledWith("agent-rerender");
  });

  it("--source refreshSource failure returns 1 with clear error", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    spies.push(errSpy as unknown as ReturnType<typeof spyOn>);
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const sources = [
      { id: "src-fail", type: "url", delivery: "file", url: "https://example.com/f" },
    ];
    const installFn = mock(async () => 0);
    const refreshSourceFn = mock(async () => {
      throw new Error("network timeout");
    });
    const rerenderFn = mock(async () => ({ ok: true as const }));

    const code = await knowledgeFetch("agent-fail-refresh", "src-fail", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-fail-refresh", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      knowledgePaths: { agentSmithHome: dir },
    });

    expect(code).toBe(1);
    expect(rerenderFn).not.toHaveBeenCalled();
    expect(installFn).not.toHaveBeenCalled();
    const errOutput = errSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errOutput).toContain("src-fail");
  });

  it("--source rerenderPrompts failure returns 1", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    spies.push(errSpy as unknown as ReturnType<typeof spyOn>);
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const sources = [{ id: "src-c", type: "url", delivery: "file", url: "https://example.com/c" }];
    const installFn = mock(async () => 0);
    const refreshSourceFn = mock(async () => ({
      kind: "refreshed" as const,
      sourceId: "src-c",
      bytes: 100,
      entries: 1,
      tokens: 0,
      durationMs: 10,
    }));
    const rerenderFn = mock(async () => ({ ok: false as const, error: "render exploded" }));

    const code = await knowledgeFetch("agent-rerender-fail", "src-c", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-rerender-fail", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      knowledgePaths: { agentSmithHome: dir },
    });

    expect(code).toBe(1);
    const errOutput = errSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errOutput).toContain("rerender");
  });

  // ============================================================
  // via routing (v1.2): pool lifecycle + spawn-opts threading
  // ============================================================

  it("routes a via-declared source through MCP on the surgical (--source) path", async () => {
    // Tempdir bundle so refreshSource can write into <home>/knowledge/<agent>/sources/.
    // The echo fixture echoes the request args back as JSON; refreshSource
    // materializes that into a file under sources/<id>/, which we then read
    // to confirm the via routing actually fired.
    const ECHO_FIXTURE = join(import.meta.dir, "..", "_fixtures", "echo-mcp-server.ts");
    const bundleDir = await mkdtemp(join(tmpdir(), "smith-kf-via-bundle-"));
    try {
      const sources = [
        {
          id: "via-src",
          type: "url",
          delivery: "file",
          url: "https://example.com/x",
          via: { server: "echo", tool: "Fetch" },
        },
      ];
      const installFn = mock(async () => 0);
      // readAvailableMcpServers stub returns the echo fixture spawn opts so
      // the resolver in fetch.ts builds against THIS map (no real $HOME read).
      const readAvailable = mock(async () => ({
        echo: { command: "bun", args: [ECHO_FIXTURE] },
      }));
      const rerenderFn = mock(async () => ({ ok: true as const }));
      const code = await knowledgeFetch("agent-via", "via-src", {
        install: installFn,
        loadRegistry: stubLoadRegistry(),
        loadAllBundles: stubLoadBundles([
          { bundlePath: bundleDir, config: { name: "agent-via", knowledge: { sources } } },
        ]),
        rerenderPrompts: rerenderFn as unknown as NonNullable<
          KnowledgeFetchDeps["rerenderPrompts"]
        >,
        readAvailableMcpServers: readAvailable as unknown as NonNullable<
          KnowledgeFetchDeps["readAvailableMcpServers"]
        >,
        knowledgePaths: { agentSmithHome: dir },
      });
      expect(code).toBe(0);
      expect(installFn).not.toHaveBeenCalled();
      // The materialized artifact should contain the echoed URL, proving the
      // request went through the echo MCP server (not direct HTTP).
      const sourcesDir = join(dir, "knowledge", "agent-via", "sources", "via-src");
      const entries = await fsPromises.readdir(sourcesDir);
      expect(entries.length).toBeGreaterThan(0);
      const firstFile = entries[0];
      if (!firstFile) throw new Error("no materialized artifact");
      const body = await fsPromises.readFile(join(sourcesDir, firstFile), "utf8");
      expect(body).toContain("example.com");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("surfaces a clear error when via.server isn't configured anywhere", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    spies.push(errSpy as unknown as ReturnType<typeof spyOn>);
    const bundleDir = await mkdtemp(join(tmpdir(), "smith-kf-via-bundle-"));
    try {
      const sources = [
        {
          id: "via-missing",
          type: "url",
          delivery: "file",
          url: "https://example.com/x",
          via: { server: "ghost", tool: "Fetch" },
        },
      ];
      const installFn = mock(async () => 0);
      // Empty available-map: 'ghost' is not configured anywhere.
      const readAvailable = mock(async () => ({}));
      const rerenderFn = mock(async () => ({ ok: true as const }));
      const code = await knowledgeFetch("agent-ghost", "via-missing", {
        install: installFn,
        loadRegistry: stubLoadRegistry(),
        loadAllBundles: stubLoadBundles([
          { bundlePath: bundleDir, config: { name: "agent-ghost", knowledge: { sources } } },
        ]),
        rerenderPrompts: rerenderFn as unknown as NonNullable<
          KnowledgeFetchDeps["rerenderPrompts"]
        >,
        readAvailableMcpServers: readAvailable as unknown as NonNullable<
          KnowledgeFetchDeps["readAvailableMcpServers"]
        >,
        knowledgePaths: { agentSmithHome: dir },
      });
      expect(code).toBe(1);
      const errOutput = errSpy.mock.calls.map((c) => c[0]).join("\n");
      // Error must mention the missing server name and the source id so
      // the user knows what to fix.
      expect(errOutput).toContain("ghost");
      expect(errOutput).toContain("via-missing");
      expect(rerenderFn).not.toHaveBeenCalled();
      expect(installFn).not.toHaveBeenCalled();
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("no --source path falls through to install + meta-writes (regression)", async () => {
    const sources = [{ id: "src-reg", type: "file", delivery: "file", path: "a.md" }];
    const installFn = mock(async () => 0);
    const refreshSourceFn = mock(async () => ({
      kind: "refreshed" as const,
      sourceId: "src-reg",
      bytes: 100,
      entries: 1,
      tokens: 0,
      durationMs: 10,
    }));
    const rerenderFn = mock(async () => ({ ok: true as const }));
    const writes: string[] = [];
    const writeStub = mock(async (_r: string, _a: string, sourceId: string, _e: unknown) => {
      writes.push(sourceId);
    });
    const acquireStub = mock(async () => ({ artifacts: [], warnings: [] }));
    const readStub = mock(async () => undefined);

    const code = await knowledgeFetch("agent-full", undefined, {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-full", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      acquireSource: acquireStub as unknown as NonNullable<KnowledgeFetchDeps["acquireSource"]>,
      writeRefreshCache: writeStub as unknown as NonNullable<
        KnowledgeFetchDeps["writeRefreshCache"]
      >,
      readRefreshCache: readStub as unknown as NonNullable<KnowledgeFetchDeps["readRefreshCache"]>,
      now: () => "2026-05-27T00:00:00.000Z",
      cacheRoot: () => dir,
    });

    expect(code).toBe(0);
    // Full path: install was called, refreshSource was NOT
    expect(installFn).toHaveBeenCalledWith("agent-full");
    expect(refreshSourceFn).not.toHaveBeenCalled();
    expect(rerenderFn).not.toHaveBeenCalled();
    // Meta writes happened
    expect(writes).toEqual(["src-reg"]);
  });

  // ============================================================
  // Phase 3 routing (cache + probe + record) — DI seams
  // ============================================================

  it("forwards cached routeCache into refreshSource on the surgical path", async () => {
    const sources = [
      { id: "src-cache", type: "url", delivery: "file", url: "https://wiki.test/team/foo" },
    ];
    const cache = {
      schemaVersion: 1 as const,
      entries: [
        {
          urlPattern: "https://wiki.test/**",
          server: "atlassian",
          tool: "fetch",
          learnedAt: "2026-06-02T00:00:00.000Z",
          hits: 4,
        },
      ],
    };
    let received: unknown;
    const refreshSourceFn = mock(async (opts: unknown) => {
      received = opts;
      return {
        kind: "refreshed" as const,
        sourceId: "src-cache",
        bytes: 100,
        entries: 1,
        tokens: 0,
        durationMs: 10,
      };
    });
    const rerenderFn = mock(async () => ({ ok: true as const }));
    const installFn = mock(async () => 0);

    const code = await knowledgeFetch("agent-cached", "src-cache", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-cached", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      readAvailableMcpServers: async () => ({}),
      loadRouteCache: async () => cache,
      knowledgePaths: { agentSmithHome: dir },
    });
    expect(code).toBe(0);
    const opts = received as {
      routeCache?: typeof cache;
      metaClaims?: unknown[];
      recordRoute?: unknown;
    };
    expect(opts.routeCache).toEqual(cache);
    expect(opts.metaClaims).toEqual([]);
    expect(typeof opts.recordRoute).toBe("function");
  });

  it("non-TTY → no probeOnFailure forwarded into refreshSource", async () => {
    const sources = [
      { id: "src-ntty", type: "url", delivery: "file", url: "https://example.com/x" },
    ];
    let received: unknown;
    const refreshSourceFn = mock(async (opts: unknown) => {
      received = opts;
      return {
        kind: "refreshed" as const,
        sourceId: "src-ntty",
        bytes: 10,
        entries: 1,
        tokens: 0,
        durationMs: 1,
      };
    });
    const rerenderFn = mock(async () => ({ ok: true as const }));
    const installFn = mock(async () => 0);

    const code = await knowledgeFetch("agent-ntty", "src-ntty", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-ntty", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      readAvailableMcpServers: async () => ({}),
      loadRouteCache: async () => ({ schemaVersion: 1, entries: [] }),
      isTTY: () => false,
      knowledgePaths: { agentSmithHome: dir },
    });
    expect(code).toBe(0);
    const opts = received as { probeOnFailure?: unknown };
    expect(opts.probeOnFailure).toBeUndefined();
  });

  it("TTY → probeOnFailure forwarded into refreshSource as a function", async () => {
    const sources = [
      { id: "src-tty", type: "url", delivery: "file", url: "https://example.com/x" },
    ];
    let received: unknown;
    const refreshSourceFn = mock(async (opts: unknown) => {
      received = opts;
      return {
        kind: "refreshed" as const,
        sourceId: "src-tty",
        bytes: 10,
        entries: 1,
        tokens: 0,
        durationMs: 1,
      };
    });
    const rerenderFn = mock(async () => ({ ok: true as const }));
    const installFn = mock(async () => 0);

    const code = await knowledgeFetch("agent-tty", "src-tty", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-tty", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<KnowledgeFetchDeps["refreshSource"]>,
      rerenderPrompts: rerenderFn as unknown as NonNullable<KnowledgeFetchDeps["rerenderPrompts"]>,
      readAvailableMcpServers: async () => ({}),
      loadRouteCache: async () => ({ schemaVersion: 1, entries: [] }),
      isTTY: () => true,
      knowledgePaths: { agentSmithHome: dir },
    });
    expect(code).toBe(0);
    const opts = received as { probeOnFailure?: unknown };
    expect(typeof opts.probeOnFailure).toBe("function");
  });

  it("recordRoute callback persists confirmed routes via saveRouteCache", async () => {
    const sources = [
      { id: "src-rec", type: "url", delivery: "file", url: "https://example.com/x" },
    ];
    let captured:
      | ((r: { url: string; server: string; tool: string }) => Promise<void>)
      | undefined;
    const refreshSourceFn = mock(async (opts: unknown) => {
      captured = (opts as { recordRoute?: typeof captured }).recordRoute;
      return {
        kind: "refreshed" as const,
        sourceId: "src-rec",
        bytes: 1,
        entries: 1,
        tokens: 0,
        durationMs: 1,
      };
    });
    const rerenderFn = mock(async () => ({ ok: true as const }));
    const installFn = mock(async () => 0);
    const saved: RouteCache[] = [];

    const code = await knowledgeFetch("agent-rec", "src-rec", {
      install: installFn,
      loadRegistry: stubLoadRegistry(),
      loadAllBundles: stubLoadBundles([fakeBundle("agent-rec", sources)]),
      refreshSource: refreshSourceFn as unknown as NonNullable<
        KnowledgeFetchDeps["refreshSource"]
      >,
      rerenderPrompts: rerenderFn as unknown as NonNullable<
        KnowledgeFetchDeps["rerenderPrompts"]
      >,
      readAvailableMcpServers: async () => ({}),
      loadRouteCache: async () => ({ schemaVersion: 1, entries: [] }),
      saveRouteCache: async (c) => {
        saved.push(c);
      },
      knowledgePaths: { agentSmithHome: dir },
    });
    expect(code).toBe(0);
    expect(captured).toBeDefined();
    await captured!({
      url: "https://wiki.test/team/foo",
      server: "atlassian",
      tool: "fetch",
    });

    expect(saved).toHaveLength(1);
    const persisted = saved[0]!;
    expect(persisted.entries).toHaveLength(1);
    expect(persisted.entries[0]?.urlPattern).toBe("https://wiki.test/**");
    expect(persisted.entries[0]?.server).toBe("atlassian");
    expect(persisted.entries[0]?.tool).toBe("fetch");
  });

  describe("--force-unlock", () => {
    it("removes a held install lock and proceeds with fetch", async () => {
      // Pre-create a 0-byte install lock — the canonical "previous run was
      // killed mid-flight" shape. knowledgeFetch must remove it before
      // delegating to install().
      const lockPath = installLockPath(dir, "my-agent");
      await mkdir(join(dir, "agents", "my-agent"), { recursive: true });
      await writeFile(lockPath, "");
      expect(existsSync(lockPath)).toBe(true);

      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      spies.push(errSpy as unknown as ReturnType<typeof spyOn>);

      const installFn = mock(async (_opts: string | InstallCliOptions) => {
        // The lock must be gone by the time install runs so its own
        // acquireInstallLock can take ownership cleanly.
        expect(existsSync(lockPath)).toBe(false);
        return 0;
      });
      const code = await knowledgeFetch("my-agent", undefined, {
        install: installFn,
        loadRegistry: stubLoadRegistry(),
        loadAllBundles: stubLoadBundles([]),
        knowledgePaths: { agentSmithHome: dir },
        forceUnlock: true,
      });
      expect(code).toBe(0);
      expect(installFn).toHaveBeenCalled();
      expect(existsSync(lockPath)).toBe(false);
      // Warning surfaces the path and mtime so the user sees what was released.
      const warnings = errSpy.mock.calls.map((c) => String(c[0]));
      expect(
        warnings.some((w) => w.includes("forcing release") && w.includes(".install.lock")),
      ).toBe(true);
      expect(warnings.some((w) => w.includes("held since"))).toBe(true);
    });

    it("is a silent no-op when no lock exists", async () => {
      const lockPath = installLockPath(dir, "my-agent");
      expect(existsSync(lockPath)).toBe(false);

      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      spies.push(errSpy as unknown as ReturnType<typeof spyOn>);

      const installFn = mock(async (_opts: string | InstallCliOptions) => 0);
      const code = await knowledgeFetch("my-agent", undefined, {
        install: installFn,
        loadRegistry: stubLoadRegistry(),
        loadAllBundles: stubLoadBundles([]),
        knowledgePaths: { agentSmithHome: dir },
        forceUnlock: true,
      });
      expect(code).toBe(0);
      // No warning when there was nothing to release.
      const warnings = errSpy.mock.calls.map((c) => String(c[0]));
      expect(warnings.some((w) => w.includes("forcing release"))).toBe(false);
    });
  });
});
