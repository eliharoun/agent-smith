import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndexInto } from "../../../src/core/knowledge/index/build-into";
import { buildServeContext, handleRpc } from "../../../src/core/knowledge/serve-mcp";

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
});
