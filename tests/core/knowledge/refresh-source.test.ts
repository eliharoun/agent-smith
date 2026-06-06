import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitSpawner } from "../../../src/core/knowledge/acquire";
import { acquireManifestLock } from "../../../src/core/knowledge/refresh-lock";
import { refreshSource } from "../../../src/core/knowledge/refresh-source";
import type {
  GitSource,
  KnowledgeManifest,
  KnowledgeSource,
  NpmSource,
  UrlSource,
} from "../../../src/core/knowledge/types";
import { knowledgeDirFor } from "../../../src/io/knowledge-paths";
import { McpClientPool } from "../../../src/io/mcp-client-pool";
import { lazyUrlSource } from "../../_helpers/lazy-fixtures";

const ECHO_FIXTURE = join(import.meta.dir, "..", "..", "_fixtures", "echo-mcp-server.ts");

// ---------- shared helpers ----------

const tmpDirs: string[] = [];

async function makeHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "refresh-source-home-"));
  tmpDirs.push(dir);
  return dir;
}

async function makeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "refresh-source-bundle-"));
  tmpDirs.push(dir);
  return dir;
}

async function makeCache(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "refresh-source-cache-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(async () => {
  // Best-effort cleanup. Some tests intentionally chmod dirs; restore perms
  // first so rm can recurse.
  for (const d of tmpDirs) {
    try {
      await chmod(d, 0o755);
    } catch {
      // ignore
    }
    await rm(d, { recursive: true, force: true });
  }
});

/** Build a GitSpawner stub that, when called with `clone`, writes the given
 *  files into the clone target dir (last positional arg in production
 *  `acquireGit` is the clone destination). For other git subcommands it
 *  returns a benign success. Adjust if Task 5 calls git differently. */
function makeWritingGitSpawner(files: Record<string, string>): GitSpawner {
  return async (args: string[], _cwd: string) => {
    if (args[0] === "clone") {
      // Find the destination dir argument (last non-flag arg).
      const dest = args[args.length - 1];
      if (dest && !dest.startsWith("-")) {
        await mkdir(dest, { recursive: true });
        for (const [name, content] of Object.entries(files)) {
          await writeFile(join(dest, name), content, "utf8");
        }
      }
    }
    return { stdout: "", stderr: "", code: 0 };
  };
}

function makeGitSource(id: string): GitSource {
  return {
    id,
    type: "git",
    delivery: "file",
    url: "https://example.invalid/repo.git",
    ref: "main",
  };
}

// ---------- tests ----------

describe("refreshSource", () => {
  test("refreshed happy path (git source) returns shape with positive counts", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const source = makeGitSource("git-happy");
    const gitSpawner = makeWritingGitSpawner({
      "README.md": "# Hello\nLine 2\n",
      "guide.md": "# Guide\nbody body body\n",
    });

    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      gitSpawner,
    });

    expect(result.kind).toBe("refreshed");
    if (result.kind !== "refreshed") return;
    expect(result.sourceId).toBe("git-happy");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.entries).toBeGreaterThan(0);
    expect(result.tokens).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("inline-only for delivery=inline", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    await writeFile(join(bundleDir, "x.md"), "inline content", "utf8");
    const source: KnowledgeSource = {
      id: "inline-src",
      type: "file",
      delivery: "inline",
      path: "x.md",
    };

    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
    });

    expect(result.kind).toBe("inline-only");
    if (result.kind !== "inline-only") return;
    expect(result.delivery).toBe("inline");
    expect(result.sourceId).toBe("inline-src");
  });

  test("auto-delivery file source falls through to acquire+materialize (not skipped)", async () => {
    // Auto delivery resolves to inline-vs-file AFTER acquire based on content
    // size. The file branch of auto needs the full acquire+materialize chain to
    // land bytes on disk. The early-return for inline-only must NOT include auto.
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();

    // Write a file large enough that auto will choose file delivery (not inline).
    // Materialize's inline budget is typically ~50KB; exceed that.
    const largeContent = "# Title\n\n" + "x".repeat(60_000);
    await writeFile(join(bundleDir, "large.md"), largeContent, "utf8");

    const source: KnowledgeSource = {
      id: "auto-src-file",
      type: "file",
      delivery: "auto",
      path: "large.md",
    };

    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
    });

    // Before fix: kind === "inline-only" — file never materialized to disk.
    // After fix: kind === "refreshed" — file lands under sources/<id>/.
    expect(result.kind).toBe("refreshed");
    if (result.kind !== "refreshed") return;
    expect(result.sourceId).toBe("auto-src-file");
    expect(result.bytes).toBeGreaterThan(0);

    // Sanity: file exists at sources/<id>/ (proof the fix worked).
    const sourcesDir = join(home, "knowledge", "agent-a", "sources");
    const entries = await readdir(sourcesDir);
    expect(entries).toContain("auto-src-file");
  });

  test("lock-held when manifest lock is already taken", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const source = makeGitSource("lock-src");
    const gitSpawner = makeWritingGitSpawner({ "README.md": "x" });

    // Pre-acquire and intentionally do not release; refreshSource must observe
    // the held lock and return immediately.
    const held = await acquireManifestLock(home, "agent-a");
    expect(held).toBeDefined();

    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      gitSpawner,
    });

    expect(result.kind).toBe("lock-held");
    if (result.kind !== "lock-held") return;
    expect(result.sourceId).toBe("lock-src");
  });

  test("skipped for unsupported source type (npm)", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const source: NpmSource = {
      id: "npm-src",
      type: "npm",
      delivery: "file",
      package: "left-pad",
    };

    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
    });

    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") return;
    expect(result.reason).toBe("unsupported-source-type");
    expect(result.sourceId).toBe("npm-src");
  });

  test("acquire failure rejects with Error mentioning sourceId and agent", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const source = makeGitSource("git-failboat");
    // Spawner that simulates a failing git invocation.
    const gitSpawner: GitSpawner = async () => {
      return { stdout: "", stderr: "fatal: simulated failure", code: 128 };
    };

    let caught: unknown;
    try {
      await refreshSource({
        agentSmithHome: home,
        agent: "agent-zed",
        source,
        bundleDir,
        cacheRoot,
        gitSpawner,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const msg = String((caught as Error).message ?? caught);
    expect(msg).toContain("git-failboat");
    expect(msg).toContain("agent-zed");
  });

  test("materialize failure preserves last-good source dir", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const source = makeGitSource("target-source");
    const sourcesDir = join(home, "knowledge", "agent-a", "sources");
    const goodDir = join(sourcesDir, "target-source");
    await mkdir(goodDir, { recursive: true });
    await writeFile(join(goodDir, "old-file.txt"), "PRECIOUS", "utf8");

    // Make `sources/` read-only so the atomic rename into <sourceId>/ fails.
    // This is a posix-only technique; bun's test runner on macOS/Linux honors
    // chmod. Existing contents inside `target-source/` remain readable.
    await chmod(sourcesDir, 0o555);

    let threw = false;
    try {
      await refreshSource({
        agentSmithHome: home,
        agent: "agent-a",
        source,
        bundleDir,
        cacheRoot,
        gitSpawner: makeWritingGitSpawner({ "new.md": "new content" }),
      });
    } catch {
      threw = true;
    } finally {
      // Restore writability so afterAll can clean up.
      await chmod(sourcesDir, 0o755);
    }

    expect(threw).toBe(true);
    const preserved = await readFile(join(goodDir, "old-file.txt"), "utf8");
    expect(preserved).toBe("PRECIOUS");
  });

  test("manifest malformed JSON throws referencing manifest", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const source = makeGitSource("manifest-victim");
    const knowledgeDir = join(home, "knowledge", "agent-a");
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(join(knowledgeDir, "_manifest.json"), "{not json", "utf8");

    let caught: unknown;
    try {
      await refreshSource({
        agentSmithHome: home,
        agent: "agent-a",
        source,
        bundleDir,
        cacheRoot,
        gitSpawner: makeWritingGitSpawner({ "doc.md": "x" }),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const msg = String((caught as Error).message ?? caught).toLowerCase();
    expect(msg.includes("manifest") || msg.includes("_manifest.json")).toBe(true);

    // Regression: wrapWithPhase preserves the phase-tagged prefix and the
    // cause chain. Outer message is the per-source refresh phase; the inner
    // parse-failure error is reachable via `.cause` (a SyntaxError from
    // JSON.parse). Both layers must remain intact across refactors.
    const outer = caught as Error;
    expect(outer.message).toMatch(
      /^refresh of source manifest-victim for agent agent-a: failed to parse knowledge _manifest\.json/,
    );
    expect(outer.cause).toBeInstanceOf(Error);
    const inner = outer.cause as Error;
    expect(inner.message).toMatch(/^failed to parse knowledge _manifest\.json at /);
    expect(inner.cause).toBeInstanceOf(SyntaxError);
  });

  test("atomic swap leaves no tmp dir and content lives at sources/<sourceId>/", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const source = makeGitSource("atomic-src");
    const gitSpawner = makeWritingGitSpawner({ "doc.md": "hello atomic" });

    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      gitSpawner,
    });
    expect(result.kind).toBe("refreshed");

    const sourcesDir = join(home, "knowledge", "agent-a", "sources");
    const entries = await readdir(sourcesDir);
    const tmpLeftovers = entries.filter(
      (e) => e.startsWith(".atomic-src.tmp-") || e.startsWith(".atomic-src.tmp"),
    );
    expect(tmpLeftovers).toEqual([]);
    expect(entries).toContain("atomic-src");

    // Sanity: the final sources/<id>/ dir is non-empty.
    const finalEntries = await readdir(join(sourcesDir, "atomic-src"));
    expect(finalEntries.length).toBeGreaterThan(0);
  });

  test("manifest incremental update preserves other-source entry and top-level totals", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const knowledgeDir = join(home, "knowledge", "agent-a");
    await mkdir(knowledgeDir, { recursive: true });

    const preexisting: KnowledgeManifest = {
      schemaVersion: 1,
      renderedAt: "2024-01-01T00:00:00.000Z",
      sources: [
        {
          id: "other-source",
          scope: "agent",
          type: "file",
          delivery: "file",
          files: [{ path: "sources/other-source/x.md", sha256: "deadbeef", bytes: 10 }],
          tokensInline: 0,
        },
      ],
      totals: {
        tokensInline: 42,
        tokensInlineBudget: 1000,
        files: 1,
        bytes: 10,
      },
    };
    await writeFile(
      join(knowledgeDir, "_manifest.json"),
      JSON.stringify(preexisting, null, 2),
      "utf8",
    );

    const source = makeGitSource("target-source");
    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      gitSpawner: makeWritingGitSpawner({ "doc.md": "target content" }),
    });
    expect(result.kind).toBe("refreshed");

    const raw = await readFile(join(knowledgeDir, "_manifest.json"), "utf8");
    const after = JSON.parse(raw) as KnowledgeManifest;
    const other = after.sources.find((s) => s.id === "other-source");
    const target = after.sources.find((s) => s.id === "target-source");

    expect(other).toBeDefined();
    expect(other).toEqual(preexisting.sources[0]);
    expect(target).toBeDefined();
    expect(after.totals.tokensInline).toBe(42);
    expect(after.totals.tokensInlineBudget).toBe(1000);
  });

  test("orphan tmp-dir cleanup removes stale .<sourceId>.tmp-* on entry", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const sourcesDir = join(home, "knowledge", "agent-a", "sources");
    const stale = join(sourcesDir, ".target-source.tmp-stale");
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, "garbage.txt"), "leftover", "utf8");

    const source = makeGitSource("target-source");
    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      gitSpawner: makeWritingGitSpawner({ "doc.md": "fresh" }),
    });
    expect(result.kind).toBe("refreshed");

    const entries = await readdir(sourcesDir);
    expect(entries).not.toContain(".target-source.tmp-stale");
  });

  test("sweeps orphan tmp-dirs even on inline-only path", async () => {
    // If an operator flips a source from git → inline after a crash left a
    // .tmp-* orphan, refreshSource still needs to reap it. The sweep must
    // therefore run before the inline early-return.
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const sourcesDir = join(home, "knowledge", "agent-a", "sources");
    const stale = join(sourcesDir, ".inline-flipped.tmp-stale");
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, "garbage.txt"), "leftover", "utf8");
    await writeFile(join(bundleDir, "x.md"), "inline body", "utf8");

    const source: KnowledgeSource = {
      id: "inline-flipped",
      type: "file",
      delivery: "inline",
      path: "x.md",
    };

    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
    });

    expect(result.kind).toBe("inline-only");
    const entries = await readdir(sourcesDir);
    expect(entries).not.toContain(".inline-flipped.tmp-stale");
  });

  test("sweeps orphan .prev-* dirs from prior crashed swaps", async () => {
    // If the second rename of an atomic swap fails, the previous live
    // content is left at sources/<id>.prev-<rand>/ for recoverability.
    // The next refresh must reap that orphan rather than let it pile up.
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const sourcesDir = join(home, "knowledge", "agent-a", "sources");
    const stalePrev = join(sourcesDir, ".target-source.prev-stale");
    await mkdir(stalePrev, { recursive: true });
    await writeFile(join(stalePrev, "old.txt"), "leftover", "utf8");

    const source = makeGitSource("target-source");
    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      gitSpawner: makeWritingGitSpawner({ "doc.md": "fresh" }),
    });
    expect(result.kind).toBe("refreshed");

    const entries = await readdir(sourcesDir);
    expect(entries).not.toContain(".target-source.prev-stale");
    expect(entries).toContain("target-source");

    // Sanity: orphan from a DIFFERENT source must not be touched. Re-run
    // with an unrelated orphan and verify it survives.
    const unrelated = join(sourcesDir, ".other-source.prev-stale");
    await mkdir(unrelated, { recursive: true });
    await writeFile(join(unrelated, "u.txt"), "keep", "utf8");

    const second = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      gitSpawner: makeWritingGitSpawner({ "doc.md": "fresh2" }),
    });
    expect(second.kind).toBe("refreshed");
    const after = await readdir(sourcesDir);
    expect(after).toContain(".other-source.prev-stale");
  });

  test("atomic swap never exposes half-merged content to readers", async () => {
    // The achievable invariant: every successful readdir(sources/<id>/)
    // observation during a swap returns either the v1 file set OR the v2
    // file set — never an empty list (regression guard for the old
    // rm-then-rename pattern) and never a mixture of both versions.
    // ENOENT during the cross-rename window is acceptable; we filter
    // those out and require at least one successful observation.
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const cacheRoot2 = await makeCache();
    const source = makeGitSource("swap-witness");

    const v1Files = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      gitSpawner: makeWritingGitSpawner({ "v1-marker.txt": "first" }),
    });
    expect(v1Files.kind).toBe("refreshed");

    const finalDir = join(home, "knowledge", "agent-a", "sources", "swap-witness");
    let stop = false;
    const observations: string[][] = [];
    const readerPromise = (async () => {
      while (!stop) {
        try {
          const list = await readdir(finalDir);
          observations.push([...list].sort());
        } catch {
          // ENOENT during the cross-rename window — acceptable, skip.
        }
      }
    })();

    const second = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot: cacheRoot2,
      gitSpawner: makeWritingGitSpawner({ "v2-marker.txt": "second" }),
    });
    expect(second.kind).toBe("refreshed");

    // Let the reader sample a few more times post-swap to catch any
    // delayed cleanup-induced anomaly, then stop.
    await new Promise((r) => setTimeout(r, 25));
    stop = true;
    await readerPromise;

    expect(observations.length).toBeGreaterThan(0);
    for (const obs of observations) {
      // Regression guard #1: never empty. The old rm-then-rename pattern
      // would have left finalDir present-but-empty between the two ops.
      expect(obs.length).toBeGreaterThan(0);
      // Regression guard #2: never half-merged. Each observation must be
      // exactly one version's file set.
      const isV1 = obs.length === 1 && obs[0] === "v1-marker.txt";
      const isV2 = obs.length === 1 && obs[0] === "v2-marker.txt";
      expect(isV1 || isV2).toBe(true);
    }
  });

  test("writes to the same tree as knowledgeDirFor", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const source = makeGitSource("src-1");
    const gitSpawner = makeWritingGitSpawner({ "doc.md": "cross-val" });

    await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      gitSpawner,
    });

    // Positive: content lives under the canonical knowledgeDirFor tree.
    const expected = join(knowledgeDirFor("agent-a", { agentSmithHome: home }), "sources", "src-1");
    await stat(expected); // throws if not exists

    // Negative: the old buggy path was NOT written.
    await expect(stat(join(home, "agents", "agent-a", "knowledge"))).rejects.toThrow();
  });
});

describe("refreshSource: via routing", () => {
  let pool: McpClientPool | null = null;
  let tmpStateHome: string;
  let origXdgStateHome: string | undefined;

  beforeEach(async () => {
    tmpStateHome = await mkdtemp(join(tmpdir(), "rs-state-"));
    origXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = tmpStateHome;
  });

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
      pool = null;
    }
    if (origXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = origXdgStateHome;
    await rm(tmpStateHome, { recursive: true, force: true });
  });

  test("threads mcpPool through to acquireSource", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    pool = new McpClientPool();
    const source: UrlSource = {
      id: "via-src",
      type: "url",
      delivery: "file",
      url: "https://example.com/x",
      via: { server: "echo", tool: "Fetch" },
    };

    const result = await refreshSource({
      agentSmithHome: home,
      agent: "agent-a",
      source,
      bundleDir,
      cacheRoot,
      mcpPool: pool,
      spawnOptsFor: () => ({ command: "bun", args: [ECHO_FIXTURE] }),
    });

    expect(result.kind).toBe("refreshed");
    if (result.kind !== "refreshed") return;

    // The echo fixture echoes the args back as JSON; the URL must appear in
    // the materialized artifact text under sources/<id>/.
    const sourcesDir = join(home, "knowledge", "agent-a", "sources", "via-src");
    const entries = await readdir(sourcesDir);
    expect(entries.length).toBeGreaterThan(0);
    const firstFile = entries[0];
    if (!firstFile) return;
    const body = await readFile(join(sourcesDir, firstFile), "utf8");
    expect(body).toContain("example.com");
  }, 30_000);

  test("throws internal-error when via is set but mcpPool missing", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const cacheRoot = await makeCache();
    const source: UrlSource = {
      id: "via-no-pool",
      type: "url",
      delivery: "file",
      url: "https://example.com/x",
      via: { server: "echo", tool: "Fetch" },
    };

    let caught: unknown;
    try {
      await refreshSource({
        agentSmithHome: home,
        agent: "agent-zed",
        source,
        bundleDir,
        cacheRoot,
        // intentionally no mcpPool / spawnOptsFor
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    // refreshSource wraps acquire failures via wrapWithPhase. The phase
    // headline must mention the source/agent context; the original
    // SmithError surfaces via .cause and its payload.code is
    // "internal-error".
    const outer = caught as Error;
    expect(outer.message).toContain("via-no-pool");
    expect(outer.message).toContain("agent-zed");
    // Either the wrapped headline mentions internal-error/mcpPool, or the
    // cause carries the SmithError payload — accept either to keep the
    // assertion robust against minor wording changes upstream.
    const cause = outer.cause as { payload?: { code?: string } } | undefined;
    const causePayloadCode = cause?.payload?.code;
    const combined = `${outer.message} ${causePayloadCode ?? ""}`;
    expect(combined).toMatch(/internal-error|mcpPool/i);
  });
});

describe("refreshSource: lazy URL sources", () => {
  test("returns kind: lazy-only without fetching", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const source = lazyUrlSource({
      id: "wiki",
      url: "https://this-domain-does-not-resolve.invalid/x",
    });
    const result = await refreshSource({
      agentSmithHome: home,
      agent: "test-agent",
      source,
      bundleDir,
    });
    expect(result.kind).toBe("lazy-only");
    if (result.kind === "lazy-only") {
      expect(result.sourceId).toBe("wiki");
    }
  });

  test("does not write any files for a lazy source", async () => {
    const home = await makeHome();
    const bundleDir = await makeBundle();
    const source = lazyUrlSource({ id: "wiki" });
    await refreshSource({
      agentSmithHome: home,
      agent: "test-agent",
      source,
      bundleDir,
    });
    let entries: string[] = [];
    try {
      entries = await readdir(join(knowledgeDirFor("test-agent", { agentSmithHome: home }), "sources"));
    } catch {
      /* sources dir may not exist */
    }
    expect(entries).not.toContain("wiki");
  });
});
