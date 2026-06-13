import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { keyForAgent } from "../../io/mcp-wiring";
import { Bm25Index } from "./bm25";
import { CHUNKER_VERSION } from "./index/chunker";
import { type Embedder, loadEmbedder, NullEmbedder } from "./index/embedder";
import { explainSearch, hybridSearch } from "./index/hybrid-search";
import { indexDbPath } from "./index/index-paths";
import { REPOMAP_VERSION } from "./index/repomap/extract";
import { rankFiles } from "./index/repomap/graph";
import { renderMap } from "./index/repomap/render";
import { KnowledgeStore } from "./index/store";

/**
 * Stdio MCP server exposing two tools — `knowledge.search` (hybrid
 * semantic+lexical search when the index has real vectors, else lexical BM25,
 * over the agent's materialized knowledge dir; the advertised description
 * reflects which mode is active) and `knowledge.fetch` (range-bounded file
 * read under the same dir).
 *
 * Why a hand-rolled JSON-RPC loop instead of @modelcontextprotocol/sdk: the
 * surface we need is small (initialize, tools/list, tools/call) and the SDK
 * adds a transitive dep weight we already have through `@anthropic-ai/sdk`
 * but don't import directly anywhere else. The frame format here matches the
 * MCP spec closely enough that real clients (Claude Code, OpenCode) accept
 * the responses.
 *
 * Testability seam: `buildServeContext` + `handleRpc` are pure async functions
 * over an explicit `ServeContext`. `serveStdio` is the thin wrapper that
 * pipes stdin → handleRpc → stdout. Tests target the seams directly so they
 * don't need to spawn subprocesses.
 */

/** 64 KiB cap on `knowledge.fetch` payloads. Prevents an LLM from accidentally
 * pulling the whole knowledge corpus through one tool call. Callers that need
 * more can issue follow-up calls with `start`/`end` ranges. */
const FETCH_BYTE_CAP = 64 * 1024;

/** Files we index. Skips dotfiles and `compile-manifest.json` because that
 * file is metadata, not knowledge content. */
const INDEXED_EXTENSIONS = new Set([".md", ".txt", ".json"]);

/**
 * The `knowledge.search` tool description, chosen to match the search mode
 * that will ACTUALLY run. Hybrid (semantic embeddings + lexical BM25, fused via
 * RRF) is only active when the index has real vectors — see `buildServeContext`
 * / `hybridSearch`. The agent reads this description to decide whether semantic
 * recall is available, so it must not over-promise: store-present-but-NullEmbedder
 * and the in-memory BM25 fallback are both lexical-only.
 */
export function searchToolDescription(hybridActive: boolean): string {
  return hybridActive
    ? "Hybrid search (semantic embeddings + lexical BM25, fused via reciprocal rank fusion) over the agent's materialized knowledge sources. Returns ranked file paths with snippets and line ranges."
    : "Lexical BM25 search over the agent's materialized knowledge sources. Returns ranked file paths with snippets.";
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface ServeContext {
  index: Bm25Index; // bottom rung, always built (in-memory)
  rootDir: string;
  /**
   * The agent this server is serving. Used to compose `serverInfo.name` in
   * the initialize response so each agent advertises its OWN per-agent key
   * (`<agent>-knowledge`) — the same key the user's AI client uses to
   * spawn this process. Mismatched names confuse client-side handlers
   * that key by serverInfo.name.
   */
  agent: string;
  store: KnowledgeStore | null; // read-only persistent index; null => use `index`
  embedder: Embedder; // query embedder; NullEmbedder unless the store has real vectors
  hasMap: boolean; // true iff store has code tags (gates knowledge.map)
}

export async function buildServeContext(
  knowledgeDir: string,
  agent: string,
): Promise<ServeContext> {
  const index = await buildLegacyBm25(knowledgeDir);
  let store: KnowledgeStore | null = null;
  let embedder: Embedder = new NullEmbedder();
  let hasMap = false;
  try {
    // In readonly mode the header is NOT written/reconciled (KnowledgeStore.open
    // skips migrate); these are inert placeholders. The index's actual embedder
    // id is read separately below via storedEmbedderId().
    store = await KnowledgeStore.open(
      indexDbPath(knowledgeDir),
      {
        schemaVersion: 1,
        embedderId: "none",
        embedderDim: 1,
        chunkerVersion: CHUNKER_VERSION,
        repomapVersion: REPOMAP_VERSION,
      },
      { readonly: true },
    );
    if (store) {
      hasMap = store.hasCode();
      // Only load the (heavy) query embedder when the index actually has
      // vectors — i.e. it was built with a real embedder. Avoids blocking the
      // MCP handshake on a model load when the index is lexical-only (§3.1.1).
      const storedEmb = store.storedEmbedderId();
      if (storedEmb && storedEmb !== "none") {
        embedder = await loadEmbedder({});
      }
    }
  } catch {
    store = null; // any failure -> in-memory BM25 fallback
  }
  return { index, rootDir: knowledgeDir, agent, store, embedder, hasMap };
}

/**
 * Handle a single JSON-RPC line. Returns the response object (caller frames
 * as `JSON.stringify(res) + "\n"`), or `undefined` when the input is a
 * notification (no `id`) or unparseable.
 */
export async function handleRpc(
  line: string,
  ctx: ServeContext,
): Promise<JsonRpcResponse | undefined> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return undefined;
  }

  // JSON-RPC notifications have no `id` field. They MUST NOT receive a
  // response — replying breaks strict clients (Kiro CLI in particular
  // treats an error reply to `notifications/initialized` as a protocol
  // violation and stops issuing tools/list). The MCP standard handshake
  // includes `notifications/initialized` from the client after the server
  // responds to `initialize`; silently accept it here.
  if (req.id === undefined) return undefined;
  const id = req.id;

  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        // `listChanged: false` is explicit-no-change rather than the bare `{}`.
        // Kiro CLI interprets `tools: {}` as "no tools supported" and skips
        // tools/list entirely; explicit `listChanged: false` makes the
        // capability assertion unambiguous. Claude Code accepts either.
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: keyForAgent(ctx.agent), version: "1.0.0" },
      },
    };
  }

  if (req.method === "tools/list") {
    // Hybrid (semantic) ranking is active iff the persistent store is present
    // AND a real query embedder was loaded — matches the routing in
    // `handleSearch`/`hybridSearch` exactly. Both non-hybrid cases (NullEmbedder
    // store, or in-memory BM25 fallback) advertise the lexical wording.
    const hybridActive = ctx.store !== null && ctx.embedder.id !== "none";
    const tools: unknown[] = [
      {
        name: "knowledge.search",
        description: searchToolDescription(hybridActive),
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            k: { type: "integer", minimum: 1, maximum: 20 },
          },
          required: ["query"],
        },
      },
      {
        name: "knowledge.fetch",
        description:
          "Read a file under the agent's knowledge dir (range-bounded; 64KB cap per call).",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            start: { type: "integer", minimum: 0 },
            end: { type: "integer", minimum: 0 },
          },
          required: ["path"],
        },
      },
    ];
    if (ctx.hasMap) {
      tools.push({
        name: "knowledge.map",
        description: "Ranked structural map of symbols across code knowledge sources.",
        inputSchema: {
          type: "object",
          properties: {
            focus: { type: "string" },
            mapTokens: { type: "integer", minimum: 100, maximum: 8000 },
          },
        },
      });
    }
    if (hybridActive) {
      tools.push({
        name: "knowledge.explain",
        description:
          "Debug hybrid retrieval: for a query, returns the lexical (BM25) arm's ranked hits, the semantic (vector) arm's ranked hits, and the RRF-fused result with each item's per-arm rank and fused score. Use to see which results came from semantic vs lexical matching.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            k: { type: "integer", minimum: 1, maximum: 20 },
          },
          required: ["query"],
        },
      });
    }
    return { jsonrpc: "2.0", id, result: { tools } };
  }

  if (req.method === "tools/call") {
    const params = (req.params ?? {}) as {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    if (params.name === "knowledge.search") {
      return handleSearch(id, params.arguments ?? {}, ctx);
    }
    if (params.name === "knowledge.fetch") {
      return handleFetch(id, params.arguments ?? {}, ctx);
    }
    if (params.name === "knowledge.map") {
      if (!ctx.store || !ctx.hasMap) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "knowledge.map unavailable (no code sources indexed)" },
        };
      }
      const a = (params.arguments ?? {}) as { focus?: unknown; mapTokens?: unknown };
      const mapTokens = clampInt(a.mapTokens, 100, 8000, 1000); // clampInt handles NaN/non-finite
      const focus = typeof a.focus === "string" ? a.focus : undefined;
      const tags = ctx.store.allTags().map((t) => ({
        relPath: t.relPath,
        name: t.name,
        role: t.role,
        line: t.line,
        signature: t.signature,
      }));
      const map = renderMap(rankFiles(tags, focus !== undefined ? { focus } : {}), mapTokens);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: map }] } };
    }
    if (params.name === "knowledge.explain") {
      return handleExplain(id, params.arguments ?? {}, ctx);
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `unknown tool: ${params.name ?? "<missing>"}` },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `method not found: ${req.method}` },
  };
}

async function handleSearch(
  id: number | string | null,
  args: Record<string, unknown>,
  ctx: ServeContext,
): Promise<JsonRpcResponse> {
  const query = typeof args.query === "string" ? args.query : "";
  const rawK = typeof args.k === "number" ? args.k : Number(args.k ?? 5);
  const k = Math.min(20, Math.max(1, Number.isFinite(rawK) ? rawK : 5));
  const hits = ctx.store
    ? await hybridSearch(ctx.store, ctx.embedder, query, k)
    : ctx.index.search(query, k);
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] },
  };
}

async function handleExplain(
  id: number | string | null,
  args: Record<string, unknown>,
  ctx: ServeContext,
): Promise<JsonRpcResponse> {
  // Explain requires the persistent store AND a real query embedder — same gate
  // as the knowledge.explain advertisement in tools/list. Without a real
  // embedder there is no semantic arm to decompose.
  if (!ctx.store || ctx.embedder.id === "none") {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: "knowledge.explain unavailable (hybrid retrieval is not active)",
      },
    };
  }
  const query = typeof args.query === "string" ? args.query : "";
  const rawK = typeof args.k === "number" ? args.k : Number(args.k ?? 5);
  const k = Math.min(20, Math.max(1, Number.isFinite(rawK) ? rawK : 5));
  const explanation = await explainSearch(ctx.store, ctx.embedder, query, k);
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(explanation, null, 2) }] },
  };
}

async function handleFetch(
  id: number | string | null,
  args: Record<string, unknown>,
  ctx: ServeContext,
): Promise<JsonRpcResponse> {
  const requested = typeof args.path === "string" ? args.path : "";
  if (!requested) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: "knowledge.fetch: 'path' is required" },
    };
  }
  if (isAbsolute(requested)) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32602,
        message: "knowledge.fetch: absolute paths are not allowed (would escape root)",
      },
    };
  }
  const abs = join(ctx.rootDir, requested);
  const rel = relative(ctx.rootDir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: "knowledge.fetch: path escapes root" },
    };
  }
  let content: string;
  try {
    content = await readFile(abs, "utf8");
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32602,
        message: `knowledge.fetch: cannot read ${requested}: ${(err as Error).message}`,
      },
    };
  }
  const start = clampInt(args.start, 0, content.length, 0);
  const requestedEnd = clampInt(args.end, 0, content.length, content.length);
  const cappedEnd = Math.min(requestedEnd, start + FETCH_BYTE_CAP);
  const sliced = content.slice(start, cappedEnd);
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: sliced }] },
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function buildLegacyBm25(rootDir: string): Promise<Bm25Index> {
  const ix = new Bm25Index();
  await walk(rootDir, async (abs, rel) => {
    if (shouldSkip(rel)) return;
    if (!hasIndexedExtension(abs)) return;
    const content = await readFile(abs, "utf8");
    ix.addDoc(rel, content);
  });
  return ix;
}

function shouldSkip(rel: string): boolean {
  if (rel === "compile-manifest.json") return true;
  // Skip dotfiles and any path containing a dot-prefixed segment (e.g. .cache).
  for (const seg of rel.split(/[\\/]+/)) {
    if (seg.startsWith(".")) return true;
  }
  return false;
}

function hasIndexedExtension(abs: string): boolean {
  const dot = abs.lastIndexOf(".");
  if (dot < 0) return false;
  return INDEXED_EXTENSIONS.has(abs.slice(dot));
}

async function walk(
  root: string,
  visit: (abs: string, rel: string) => Promise<void>,
  base: string = root,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    // Knowledge dir might not exist yet (new agent, never compiled). Treat as
    // empty corpus rather than crashing the server.
    return;
  }
  for (const entry of entries) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, visit, base);
    } else if (entry.isFile()) {
      await visit(abs, relative(base, abs));
    }
  }
}

/**
 * Wire `process.stdin` → `handleRpc` → `process.stdout`. Each request is a
 * single JSON-encoded line; responses are line-framed too. EOF on stdin
 * exits the process cleanly (MCP host closing the pipe is the normal
 * shutdown signal).
 */
export async function serveStdio(knowledgeDir: string, agent: string): Promise<void> {
  const ctx = await buildServeContext(knowledgeDir, agent);

  process.stdin.setEncoding("utf8");
  let buf = "";

  await new Promise<void>((resolve) => {
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line) continue;
        // Fire-and-forget: each request is independent; ordering is preserved
        // by the single-threaded event loop because handleRpc awaits before
        // we write the response.
        void handleRpc(line, ctx).then((res) => {
          if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
        });
      }
    });
    process.stdin.on("end", () => {
      ctx.store?.close(); // release the read-only DB handle (matters if serveStdio is reused in-process)
      resolve();
    });
  });
}
