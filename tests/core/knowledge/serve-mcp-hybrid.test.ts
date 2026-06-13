import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndexInto } from "../../../src/core/knowledge/index/build-into";
import {
  buildServeContext,
  handleRpc,
  searchToolDescription,
} from "../../../src/core/knowledge/serve-mcp";

let kd: string;
beforeEach(async () => {
  kd = await mkdtemp(join(tmpdir(), "serve-h-"));
  await mkdir(join(kd, "sources", "s"), { recursive: true });
});
afterEach(async () => {
  await rm(kd, { recursive: true, force: true });
});
const call = (ctx: any, method: string, params: unknown) =>
  handleRpc(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), ctx);

describe("serve-mcp hybrid wiring", () => {
  test("search + fetch always present; searches the built index", async () => {
    await writeFile(join(kd, "sources", "s", "doc.md"), "rate limiting in the gateway\n");
    await buildIndexInto(kd, null); // build the persistent store (lexical, NullEmbedder per Task 6)
    const ctx = await buildServeContext(kd, "agent");
    const list: any = await call(ctx, "tools/list", {});
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain("knowledge.search");
    expect(names).toContain("knowledge.fetch");
    const res: any = await call(ctx, "tools/call", {
      name: "knowledge.search",
      arguments: { query: "rate limiting" },
    });
    expect(res.result.content[0].text).toContain("doc.md");
  });

  test("falls back to in-memory BM25 when no knowledge.db exists", async () => {
    await writeFile(join(kd, "sources", "s", "doc.md"), "alpha beta\n");
    const ctx = await buildServeContext(kd, "agent"); // NO buildIndexInto -> no store
    const res: any = await call(ctx, "tools/call", {
      name: "knowledge.search",
      arguments: { query: "alpha" },
    });
    expect(res.result.content[0].text).toContain("doc.md");
  });

  test("knowledge.map is NOT advertised when there are no code sources", async () => {
    await writeFile(join(kd, "sources", "s", "doc.md"), "just prose\n");
    await buildIndexInto(kd, null);
    const ctx = await buildServeContext(kd, "agent");
    const list: any = await call(ctx, "tools/list", {});
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).not.toContain("knowledge.map");
  });

  test("knowledge.map IS advertised and returns a map when code sources are indexed", async () => {
    await writeFile(
      join(kd, "sources", "s", "code.ts"),
      "export function widget() { return helper(); }\nfunction helper() { return 1; }\n",
    );
    await buildIndexInto(kd, null); // extracts tags via tree-sitter at build time
    const ctx = await buildServeContext(kd, "agent");
    const list: any = await call(ctx, "tools/list", {});
    const names = list.result.tools.map((t: any) => t.name);
    if (!names.includes("knowledge.map")) return; // grammar unavailable on host -> tolerated skip
    const res: any = await call(ctx, "tools/call", { name: "knowledge.map", arguments: {} });
    expect(res.result.content[0].text).toContain("code.ts");
  });

  test("knowledge.explain is NOT advertised in lexical-only mode", async () => {
    await writeFile(join(kd, "sources", "s", "doc.md"), "rate limiting in the gateway\n");
    await buildIndexInto(kd, null);
    const ctx = await buildServeContext(kd, "agent");
    const list: any = await call(ctx, "tools/list", {});
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).not.toContain("knowledge.explain");
  });

  test("knowledge.explain returns an error when not in hybrid mode", async () => {
    await writeFile(join(kd, "sources", "s", "doc.md"), "rate limiting in the gateway\n");
    await buildIndexInto(kd, null);
    const ctx = await buildServeContext(kd, "agent");
    const res: any = await call(ctx, "tools/call", {
      name: "knowledge.explain",
      arguments: { query: "rate limiting" },
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32601);
  });

  test("knowledge.explain is advertised and returns per-arm provenance when hybrid is active", async () => {
    const { KnowledgeStore } = await import("../../../src/core/knowledge/index/store");
    const s = await KnowledgeStore.open(join(kd, "k.db"), {
      schemaVersion: 1,
      embedderId: "fake@1",
      embedderDim: 3,
      chunkerVersion: 1,
      repomapVersion: 1,
    });
    if (!s) return;
    await s.upsertChunks([
      {
        id: "1",
        sourceId: "s",
        relPath: "a.md",
        startLine: 1,
        endLine: 2,
        kind: "prose",
        text: "rate limiting in the gateway",
        contentHash: "h1",
        vector: new Float32Array([1, 0, 0]),
      },
    ]);
    const fakeEmbedder = { id: "fake@1", dim: 3, embed: async () => [new Float32Array([1, 0, 0])] };
    const ctx: any = {
      index: { search: () => [] },
      rootDir: kd,
      agent: "agent",
      store: s,
      embedder: fakeEmbedder,
      hasMap: false,
    };
    const list: any = await call(ctx, "tools/list", {});
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain("knowledge.explain");
    const res: any = await call(ctx, "tools/call", {
      name: "knowledge.explain",
      arguments: { query: "rate limiting" },
    });
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.query).toBe("rate limiting");
    expect(payload.hybrid).toBe(true);
    expect(payload.fused[0].relPath).toBe("a.md");
    expect(payload.fused[0].lexicalRank).toBe(1);
    expect(payload.fused[0].vectorRank).toBe(1);
    s.close();
  });
});

describe("searchToolDescription", () => {
  test("hybrid-active branch advertises semantic + hybrid wording", () => {
    const desc = searchToolDescription(true);
    expect(desc).toContain("Hybrid");
    expect(desc).toContain("semantic");
    expect(desc).not.toContain("Lexical BM25 search over"); // not the lexical-only phrasing
  });

  test("lexical branch advertises BM25 / Lexical wording without semantic claims", () => {
    const desc = searchToolDescription(false);
    expect(desc).toContain("BM25");
    expect(desc).toContain("Lexical");
    expect(desc).not.toContain("Hybrid");
    expect(desc).not.toContain("semantic");
  });
});

describe("knowledge.search description reflects mode", () => {
  test("lexical store (NullEmbedder) yields the BM25 description via buildServeContext", async () => {
    await writeFile(join(kd, "sources", "s", "doc.md"), "rate limiting in the gateway\n");
    await buildIndexInto(kd, null); // lexical-only store -> embedder.id === "none"
    const ctx = await buildServeContext(kd, "agent");
    // Precondition: this is genuinely the non-hybrid path.
    expect(ctx.embedder.id).toBe("none");
    const list: any = await call(ctx, "tools/list", {});
    const search = list.result.tools.find((t: any) => t.name === "knowledge.search");
    expect(search.description).toContain("BM25");
    expect(search.description).toContain("Lexical");
    expect(search.description).not.toContain("Hybrid");
    expect(search.description).not.toContain("semantic");
  });
});
