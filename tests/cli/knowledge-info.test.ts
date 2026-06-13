import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { knowledgeInfo } from "../../src/cli/commands/knowledge/info";
import type { IndexStats } from "../../src/core/knowledge/index/store";
import { SmithError } from "../../src/core/smith-error";

describe("knowledgeInfo", () => {
  let agentSmithHome: string;
  const spies: Array<ReturnType<typeof spyOn>> = [];
  beforeEach(async () => {
    agentSmithHome = await mkdtemp(join(tmpdir(), "smith-ki-"));
    await mkdir(join(agentSmithHome, "knowledge", "x"), { recursive: true });
  });
  afterEach(async () => {
    await rm(agentSmithHome, { recursive: true, force: true });
    for (const s of spies.splice(0)) s.mockRestore();
  });

  const hybridStats: IndexStats = {
    embedderId: "jinaai/jina-embeddings-v2-base-code@1",
    chunks: 100,
    vectors: 85,
    taggedPaths: 12,
    perSource: [{ sourceId: "alpha", chunks: 100, vectors: 85 }],
  };
  const bm25Stats: IndexStats = {
    embedderId: "none",
    chunks: 50,
    vectors: 0,
    taggedPaths: 0,
    perSource: [{ sourceId: "alpha", chunks: 50, vectors: 0 }],
  };

  it("throws not-found when the agent is not registered", async () => {
    const elog = spyOn(console, "error").mockImplementation(() => {});
    spies.push(elog as unknown as ReturnType<typeof spyOn>);
    const err = await knowledgeInfo(
      "x",
      { agentSmithHome },
      { loadDeclaredSources: async () => null },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SmithError);
    expect(err.payload.code).toBe("not-found");
  });

  it("reports HYBRID active when store has a real embedder and vectors", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const code = await knowledgeInfo(
      "x",
      { agentSmithHome },
      {
        loadDeclaredSources: async () => [
          { id: "alpha", type: "git", retrieval: { mode: "hybrid" } } as never,
        ],
        openStats: async () => hybridStats,
      },
    );
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    expect(out.toLowerCase()).toContain("hybrid");
    expect(out).toContain("jinaai/jina-embeddings-v2-base-code@1");
    expect(out).toContain("85");
  });

  it("reports BM25-only when embedderId is 'none' (explains why not hybrid)", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const code = await knowledgeInfo(
      "x",
      { agentSmithHome },
      {
        loadDeclaredSources: async () => [
          { id: "alpha", type: "git", retrieval: { mode: "bm25" } } as never,
        ],
        openStats: async () => bm25Stats,
      },
    );
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n").toLowerCase();
    expect(out).toContain("bm25");
    expect(out).not.toMatch(/hybrid.*active/);
  });

  it("reports 'not materialized' when no index DB is present (openStats -> null)", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const code = await knowledgeInfo(
      "x",
      { agentSmithHome },
      {
        loadDeclaredSources: async () => [{ id: "alpha", type: "git" } as never],
        openStats: async () => null,
      },
    );
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n").toLowerCase();
    expect(out).toContain("not");
  });

  it("--json emits a structured object with hybridActive and stats", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const code = await knowledgeInfo(
      "x",
      { agentSmithHome },
      {
        loadDeclaredSources: async () => [
          { id: "alpha", type: "git", retrieval: { mode: "hybrid" } } as never,
        ],
        openStats: async () => hybridStats,
      },
      { json: true },
    );
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.agent).toBe("x");
    expect(parsed.hybridActive).toBe(true);
    expect(parsed.stats.vectors).toBe(85);
    expect(parsed.embedderId).toBe("jinaai/jina-embeddings-v2-base-code@1");
  });

  it("hybridActive matches serve predicate: real embedder with zero vectors is still HYBRID", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    // Degenerate but serve-consistent: a real embedder header with 0 vectors.
    // serve would load the embedder and advertise Hybrid, so info must agree.
    const realEmbedderNoVectors: IndexStats = {
      embedderId: "jinaai/jina-embeddings-v2-base-code@1",
      chunks: 10,
      vectors: 0,
      taggedPaths: 0,
      perSource: [{ sourceId: "alpha", chunks: 10, vectors: 0 }],
    };
    const code = await knowledgeInfo(
      "x",
      { agentSmithHome },
      {
        loadDeclaredSources: async () => [
          { id: "alpha", type: "git", retrieval: { mode: "hybrid" } } as never,
        ],
        openStats: async () => realEmbedderNoVectors,
      },
      { json: true },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(log.mock.calls.flat().join("\n"));
    expect(parsed.hybridActive).toBe(true);
    expect(parsed.stats.vectors).toBe(0);
  });

  it("shows 'not indexed (runtime fetch)' for a lazy webpage source", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const code = await knowledgeInfo(
      "x",
      { agentSmithHome },
      {
        loadDeclaredSources: async () => [
          { id: "alpha", type: "webpage", lazy: true } as never,
        ],
        openStats: async () => ({
          embedderId: "none",
          chunks: 0,
          vectors: 0,
          taggedPaths: 0,
          perSource: [],
        }),
      },
    );
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n").toLowerCase();
    expect(out).toContain("lazy");
    expect(out).toContain("runtime fetch");
  });

  it("flags a hybrid source with no auto-refresh as stale", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    await knowledgeInfo(
      "x",
      { agentSmithHome },
      {
        loadDeclaredSources: async () => [
          { id: "alpha", type: "git", retrieval: { mode: "hybrid" } } as never, // no refresh => install
        ],
        openStats: async () => ({
          embedderId: "jinaai/jina-embeddings-v2-base-code@1",
          chunks: 10, vectors: 10, taggedPaths: 0,
          perSource: [{ sourceId: "alpha", chunks: 10, vectors: 10 }],
        }),
      },
    );
    const out = log.mock.calls.flat().join("\n").toLowerCase();
    expect(out).toContain("never auto-refreshed");
  });

  it("does NOT flag a hybrid source with ttl refresh", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    await knowledgeInfo(
      "x",
      { agentSmithHome },
      {
        loadDeclaredSources: async () => [
          { id: "alpha", type: "git", retrieval: { mode: "hybrid" }, refresh: { mode: "ttl", ttl: "7d" } } as never,
        ],
        openStats: async () => ({
          embedderId: "jinaai/jina-embeddings-v2-base-code@1",
          chunks: 10, vectors: 10, taggedPaths: 0,
          perSource: [{ sourceId: "alpha", chunks: 10, vectors: 10 }],
        }),
      },
    );
    const out = log.mock.calls.flat().join("\n").toLowerCase();
    expect(out).not.toContain("never auto-refreshed");
  });

  it("shows 'no indexed chunks' for a declared source with no perSource entry", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    spies.push(log as unknown as ReturnType<typeof spyOn>);
    const code = await knowledgeInfo(
      "x",
      { agentSmithHome },
      {
        loadDeclaredSources: async () => [
          { id: "ghost", type: "git", retrieval: { mode: "bm25" } } as never,
        ],
        openStats: async () => ({
          embedderId: "none",
          chunks: 5,
          vectors: 0,
          taggedPaths: 0,
          perSource: [{ sourceId: "other", chunks: 5, vectors: 0 }],
        }),
      },
    );
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n").toLowerCase();
    expect(out).toContain("no indexed chunks");
  });
});
