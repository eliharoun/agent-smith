import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KnowledgeListDeps, knowledgeList } from "../../../src/cli/commands/knowledge/list";
import type { RefreshCacheEntry } from "../../../src/core/knowledge/refresh-cache";
import type { KnowledgeManifest, KnowledgeSource } from "../../../src/core/knowledge/types";
import type { KnowledgePaths } from "../../../src/io/knowledge-paths";

// Pin the clock so age strings are deterministic.
const NOW_MS = Date.parse("2026-05-19T12:00:00.000Z");
const now = () => NOW_MS;
const minutesAgo = (n: number) => new Date(NOW_MS - n * 60_000).toISOString();

// Capture console.log without leaking output through bun test's reporter.
let logs: string[] = [];
let originalLog: typeof console.log;
beforeEach(() => {
  logs = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
});
afterEach(() => {
  console.log = originalLog;
});

// Temp home for manifest fixture.
let home: string;
let paths: KnowledgePaths;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agent-smith-list-refresh-"));
  paths = { agentSmithHome: home };
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function writeManifest(agent: string, manifest: KnowledgeManifest): Promise<void> {
  const dir = join(home, "knowledge", agent);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "_manifest.json"), JSON.stringify(manifest));
}

// Strip ANSI color codes so assertions match raw text.
function clean(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI codes for assertion
  return s.replace(/\x1B\[[0-9;]*m/g, "");
}

// Return the first captured log line. Throws (failing the test) if no log
// was captured — preferable to a non-null assertion because the failure
// message names the file's intent rather than dumping a TypeError.
function firstLog(): string {
  const line = logs[0];
  if (line === undefined) throw new Error("expected at least one console.log line");
  return line;
}

const baseSrc = (over: Partial<KnowledgeSource>): KnowledgeSource =>
  ({
    id: "src1",
    type: "webpage",
    url: "https://example.com",
    delivery: "auto",
    ...over,
  }) as KnowledgeSource;

const okCache = (mins: number): RefreshCacheEntry => ({
  schemaVersion: 1,
  last_refreshed_at: minutesAgo(mins),
  last_attempt_at: minutesAgo(mins),
  last_error: null,
});

describe("knowledgeList — refresh status (declared-only state)", () => {
  test("renders refresh summaries for declared-only sources", async () => {
    const sources: KnowledgeSource[] = [
      baseSrc({ id: "no-refresh" }),
      baseSrc({ id: "with-ttl", refresh: "1h" }),
      baseSrc({ id: "with-session", refresh: { mode: "session" } }),
    ];
    const deps: KnowledgeListDeps = {
      loadDeclaredSources: async () => sources,
      readRefreshCache: async (id) => (id === "with-ttl" ? okCache(12) : undefined),
      now,
    };

    const rc = await knowledgeList("agent1", paths, deps);
    expect(rc).toBe(0);

    const out = logs.map(clean).join("\n");
    expect(out).toContain("declared but not yet materialized");
    expect(out).toContain("no-refresh");
    expect(out).toContain("refresh: install only (no auto-refresh)");
    expect(out).toContain("refresh: ttl 1h, last 12m ago, ok (next in 48m)");
    expect(out).toContain("refresh: session, never refreshed");
  });
});

describe("knowledgeList — refresh status (materialized state)", () => {
  test("renders refresh summaries between file count and file list", async () => {
    const manifest: KnowledgeManifest = {
      schemaVersion: 1,
      renderedAt: "2026-05-19T11:00:00.000Z",
      sources: [
        {
          id: "src1",
          scope: "agent",
          type: "webpage",
          delivery: "auto",
          files: [{ path: "src1/index.md", sha256: "abc", bytes: 100 }],
          tokensInline: 0,
        },
      ],
      totals: { tokensInline: 0, tokensInlineBudget: 8000, files: 1, bytes: 100 },
    };
    await writeManifest("agent1", manifest);

    const deps: KnowledgeListDeps = {
      loadDeclaredSources: async () => [baseSrc({ id: "src1", refresh: "1h" })],
      readRefreshCache: async () => okCache(30),
      now,
    };

    const rc = await knowledgeList("agent1", paths, deps);
    expect(rc).toBe(0);

    const out = logs.map(clean).join("\n");
    // The new refresh line appears after the "files: X, tokens(inline): Y" line
    // and before the "  - <path>" file list.
    const lines = out.split("\n");
    const filesIdx = lines.findIndex((l) => l.includes("files: 1, tokens(inline): 0"));
    const refreshIdx = lines.findIndex((l) => l.includes("refresh: ttl 1h, last 30m ago, ok"));
    const fileIdx = lines.findIndex((l) => l.includes("- src1/index.md"));
    expect(filesIdx).toBeGreaterThanOrEqual(0);
    expect(refreshIdx).toBe(filesIdx + 1);
    expect(fileIdx).toBeGreaterThan(refreshIdx);
  });
});

describe("knowledgeList — --json output", () => {
  test("declared-only state: emits json with declared sources and null manifest", async () => {
    const sources: KnowledgeSource[] = [
      baseSrc({ id: "a", refresh: "1h" }),
      baseSrc({ id: "b" }), // no refresh
    ];
    const deps: KnowledgeListDeps = {
      loadDeclaredSources: async () => sources,
      readRefreshCache: async (id) => (id === "a" ? okCache(10) : undefined),
      now,
    };

    const rc = await knowledgeList("agent1", paths, deps, { json: true });
    expect(rc).toBe(0);

    // Exactly one line of JSON output.
    expect(logs).toHaveLength(1);
    const obj = JSON.parse(firstLog());

    // Lock the v1 top-level shape: any extra/missing key fails this test.
    expect(Object.keys(obj).sort()).toEqual([
      "agent",
      "cacheReadErrors",
      "declared",
      "manifest",
      "state",
    ]);

    expect(obj.agent).toBe("agent1");
    expect(obj.state).toBe("declared-only");
    expect(obj.manifest).toBeNull();
    expect(obj.cacheReadErrors).toEqual([]);
    expect(obj.declared).toHaveLength(2);

    const a = obj.declared.find((s: { id: string }) => s.id === "a");
    // Lock the v1 declared-entry shape and nested shapes.
    expect(Object.keys(a).sort()).toEqual(["cache", "description", "id", "ref", "refresh", "type"]);
    expect(Object.keys(a.refresh).sort()).toEqual(["mode", "ttl", "ttlMs"]);
    expect(Object.keys(a.cache).sort()).toEqual([
      "ageMs",
      "dueInMs",
      "lastAttemptAt",
      "lastError",
      "lastRefreshedAt",
    ]);
    expect(a.refresh).toEqual({ mode: "ttl", ttl: "1h", ttlMs: 3_600_000 });
    expect(a.cache.lastRefreshedAt).toBe(minutesAgo(10));
    expect(a.cache.lastError).toBeNull();
    expect(a.cache.ageMs).toBe(10 * 60_000);
    expect(a.cache.dueInMs).toBe(50 * 60_000);

    const b = obj.declared.find((s: { id: string }) => s.id === "b");
    expect(b.refresh).toEqual({ mode: "install", ttl: null, ttlMs: null });
    expect(b.cache).toEqual({
      lastRefreshedAt: null,
      lastAttemptAt: null,
      lastError: null,
      ageMs: null,
      dueInMs: null,
    });
  });

  test("materialized state: includes manifest", async () => {
    const manifest: KnowledgeManifest = {
      schemaVersion: 1,
      renderedAt: "2026-05-19T11:00:00.000Z",
      sources: [],
      totals: { tokensInline: 0, tokensInlineBudget: 8000, files: 0, bytes: 0 },
    };
    await writeManifest("agent1", manifest);

    const deps: KnowledgeListDeps = {
      loadDeclaredSources: async () => [],
      readRefreshCache: async () => undefined,
      now,
    };

    const rc = await knowledgeList("agent1", paths, deps, { json: true });
    expect(rc).toBe(0);
    const obj = JSON.parse(firstLog());
    expect(obj.state).toBe("materialized");
    expect(obj.manifest).toEqual(manifest);
  });

  test("cache read error: populates cacheReadErrors", async () => {
    const sources: KnowledgeSource[] = [baseSrc({ id: "boom", refresh: "1h" })];
    const deps: KnowledgeListDeps = {
      loadDeclaredSources: async () => sources,
      readRefreshCache: async () => {
        throw Object.assign(new Error("read failed"), { code: "EACCES" });
      },
      now,
    };

    const rc = await knowledgeList("agent1", paths, deps, { json: true });
    expect(rc).toBe(0);
    const obj = JSON.parse(firstLog());
    expect(obj.cacheReadErrors).toHaveLength(1);
    expect(obj.cacheReadErrors[0]).toContain("boom");
    expect(obj.declared[0].cache.lastRefreshedAt).toBeNull();
  });
});

describe("knowledgeList — cache read error (human mode)", () => {
  test("adds warning footer line", async () => {
    const sources: KnowledgeSource[] = [
      baseSrc({ id: "ok-src", refresh: "1h" }),
      baseSrc({ id: "bad-src", refresh: "1h" }),
    ];
    const deps: KnowledgeListDeps = {
      loadDeclaredSources: async () => sources,
      readRefreshCache: async (id) => {
        if (id === "bad-src") throw Object.assign(new Error("nope"), { code: "EIO" });
        return okCache(5);
      },
      now,
    };

    const rc = await knowledgeList("agent1", paths, deps);
    expect(rc).toBe(0);
    const out = logs.map(clean).join("\n");
    expect(out).toContain("1 source(s) had unreadable cache meta");
  });
});
