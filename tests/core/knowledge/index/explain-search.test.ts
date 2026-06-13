import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Embedder } from "../../../../src/core/knowledge/index/embedder";
import { explainSearch } from "../../../../src/core/knowledge/index/hybrid-search";
import { KnowledgeStore } from "../../../../src/core/knowledge/index/store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kexplain-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const H = {
  schemaVersion: 1,
  embedders: [{ id: "emb-a", dim: 3 }],
  chunkerVersion: 1,
  repomapVersion: 1,
};

// Stamp the chunk's embedder_id with the fake embedder's id so the
// embedder_id-partitioned searchVector matches it (the dense arm filters by id).
function chunk(id: string, relPath: string, text: string, vector: Float32Array) {
  return {
    id,
    sourceId: "s",
    relPath,
    startLine: 1,
    endLine: 2,
    kind: "prose" as const,
    text,
    contentHash: `h-${id}`,
    vector,
    embedderId: "fake@1",
    embedderDim: vector.length,
  };
}

function fakeEmbedder(vec: number[]): Embedder {
  return { id: "fake@1", dim: vec.length, embed: async () => [new Float32Array(vec)] };
}

describe("explainSearch", () => {
  test("lexical-only (empty embedders): vectors empty, fused entries carry lexicalRank, vectorRanks {}", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      chunk("1", "a.md", "rate limiting in the gateway", new Float32Array([1, 0, 0])),
      chunk("2", "b.md", "database connection retries", new Float32Array([0, 1, 0])),
    ]);
    const exp = await explainSearch(s, [], "rate limiting", 5);
    expect(exp.query).toBe("rate limiting");
    expect(exp.hybrid).toBe(false);
    expect(exp.vectors).toEqual({});
    expect(exp.lexical.length).toBeGreaterThan(0);
    const top = exp.fused[0]!;
    expect(top.relPath).toBe("a.md");
    expect(top.lexicalRank).toBe(1);
    expect(top.vectorRanks).toEqual({});
    expect(typeof top.fusedScore).toBe("number");
    s.close();
  });

  test("hybrid: dense arm populated; fused entry carries per-model rank", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      chunk("1", "a.md", "rate limiting in the gateway", new Float32Array([1, 0, 0])),
      chunk("2", "b.md", "database connection retries", new Float32Array([0, 1, 0])),
    ]);
    const exp = await explainSearch(s, [fakeEmbedder([1, 0, 0])], "rate limiting", 5);
    expect(exp.hybrid).toBe(true);
    expect(exp.vectors["fake@1"]!.length).toBeGreaterThan(0);
    const a = exp.fused.find((e) => e.relPath === "a.md");
    expect(a).toBeDefined();
    expect(a?.lexicalRank).toBe(1);
    expect(a?.vectorRanks["fake@1"]).toBe(1);
    s.close();
  });

  test("fused is sorted by fusedScore descending and limited to k", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      chunk("1", "a.md", "alpha alpha alpha", new Float32Array([1, 0, 0])),
      chunk("2", "b.md", "beta beta", new Float32Array([0, 1, 0])),
      chunk("3", "c.md", "alpha beta gamma", new Float32Array([0, 0, 1])),
    ]);
    const exp = await explainSearch(s, [], "alpha", 2);
    expect(exp.fused.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < exp.fused.length; i++) {
      expect(exp.fused[i - 1]!.fusedScore).toBeGreaterThanOrEqual(exp.fused[i]!.fusedScore);
    }
    s.close();
  });
});
