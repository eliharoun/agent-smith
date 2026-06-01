import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildServeContext,
  handleRpc,
  type ServeContext,
} from "../../src/core/knowledge/serve-mcp";

/**
 * Build a fake materialized knowledge dir under the smith state home that
 * `knowledgeDirFor(name, paths)` would resolve to. The MCP server walks the
 * directory recursively and indexes `.md`/`.txt`/`.json` files.
 */
async function setupKnowledgeDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smith-serve-"));
  await mkdir(join(root, "sources/runbook"), { recursive: true });
  await writeFile(
    join(root, "sources/runbook/index.md"),
    "# Runbook\nDatabase connection retry policy: backoff 100ms 200ms 400ms.\n",
  );
  await mkdir(join(root, "sources/style"), { recursive: true });
  await writeFile(
    join(root, "sources/style/index.md"),
    "# Style guide\nUse named exports.\n",
  );
  return root;
}

describe("knowledge serve MCP handlers", () => {
  let root: string;
  let ctx: ServeContext;

  beforeEach(async () => {
    root = await setupKnowledgeDir();
    ctx = await buildServeContext(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("answers initialize with protocol info and capabilities", async () => {
    const res = await handleRpc(
      JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
      ctx,
    );
    const result = res?.result as {
      protocolVersion: string;
      capabilities: { tools: unknown };
      serverInfo: { name: string };
    };
    expect(result.protocolVersion).toBeDefined();
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toContain("knowledge");
  });

  it("answers tools/list with knowledge.search and knowledge.fetch", async () => {
    const res = await handleRpc(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      ctx,
    );
    expect(res?.result).toBeDefined();
    const tools = (res?.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "knowledge.fetch",
      "knowledge.search",
    ]);
  });

  it("knowledge.search returns BM25 hits with snippet for the matching file", async () => {
    const res = await handleRpc(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "knowledge.search",
          arguments: { query: "database retry" },
        },
      }),
      ctx,
    );
    const text =
      (res?.result as { content: { text: string }[] }).content[0]?.text ?? "";
    const hits = JSON.parse(text) as { path: string; snippet: string }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.path).toContain("runbook");
    expect(hits[0]?.snippet).toMatch(/retry|backoff|database/i);
  });

  it("knowledge.fetch reads a file under the root", async () => {
    const res = await handleRpc(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "knowledge.fetch",
          arguments: { path: "sources/runbook/index.md" },
        },
      }),
      ctx,
    );
    const text =
      (res?.result as { content: { text: string }[] }).content[0]?.text ?? "";
    expect(text).toContain("retry policy");
  });

  it("knowledge.fetch refuses paths that escape the root", async () => {
    const res = await handleRpc(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "knowledge.fetch",
          arguments: { path: "../etc/passwd" },
        },
      }),
      ctx,
    );
    expect(res?.error?.code).toBe(-32602);
    expect(res?.error?.message).toMatch(/escape/i);
  });

  it("returns method-not-found for unknown methods", async () => {
    const res = await handleRpc(
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "made_up" }),
      ctx,
    );
    expect(res?.error?.code).toBe(-32601);
  });

  it("returns undefined for notifications (no `id`) — must not reply", async () => {
    // JSON-RPC notifications never get a response. The MCP standard
    // handshake includes `notifications/initialized` from the client
    // after the server's initialize-response; replying to it (even with
    // an error) breaks strict clients (Kiro CLI in particular treats it
    // as a protocol violation and skips tools/list).
    const res = await handleRpc(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      ctx,
    );
    expect(res).toBeUndefined();
  });

  it("treats any id-less request as a notification, regardless of method", async () => {
    // Notification semantic is determined by the absence of `id`, not by
    // the method name. A notification with an unknown method must still
    // produce no reply.
    const res = await handleRpc(
      JSON.stringify({ jsonrpc: "2.0", method: "made_up_notification" }),
      ctx,
    );
    expect(res).toBeUndefined();
  });
});
