import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgeStore } from "../../../../src/core/knowledge/index/store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kstats-"));
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

function chunk(id: string, sourceId: string, relPath: string, vector?: Float32Array) {
  return {
    id,
    sourceId,
    relPath,
    startLine: 1,
    endLine: 2,
    kind: "prose" as const,
    text: `text ${id}`,
    contentHash: `h-${id}`,
    ...(vector ? { vector } : {}),
  };
}

describe("KnowledgeStore.stats", () => {
  test("empty index: zero counts, embedderId 'none' (no live vectors)", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    const stats = s.stats();
    expect(stats.chunks).toBe(0);
    expect(stats.vectors).toBe(0);
    expect(stats.taggedPaths).toBe(0);
    // embedderId now derives from LIVE vectors (not the header meta); an empty
    // index has none, so the single-model shim reports "none".
    expect(stats.embedderId).toBe("none");
    expect(stats.perSource).toEqual([]);
    s.close();
  });

  test("mixed sources: per-source chunk and vector counts", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertChunks([
      chunk("1", "alpha", "sources/alpha/a.md", new Float32Array([1, 0, 0])),
      chunk("2", "alpha", "sources/alpha/b.md", new Float32Array([0, 1, 0])),
      chunk("3", "beta", "sources/beta/c.md"),
    ]);
    const stats = s.stats();
    expect(stats.chunks).toBe(3);
    expect(stats.vectors).toBe(2);
    expect(stats.perSource).toEqual([
      { sourceId: "alpha", chunks: 2, vectors: 2 },
      { sourceId: "beta", chunks: 1, vectors: 0 },
    ]);
    s.close();
  });

  test("taggedPaths counts distinct tagged rel_paths", async () => {
    const s = await KnowledgeStore.open(join(dir, "k.db"), H);
    if (!s) return;
    await s.upsertTags("sources/alpha/a.ts", "h-a", [
      { name: "foo", role: "def", line: 1, signature: "foo()" },
      { name: "bar", role: "def", line: 2, signature: "bar()" },
    ]);
    await s.upsertTags("sources/alpha/b.ts", "h-b", [
      { name: "baz", role: "def", line: 1, signature: "baz()" },
    ]);
    const stats = s.stats();
    expect(stats.taggedPaths).toBe(2);
    s.close();
  });
});
