import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { Bm25Index } from "./bm25";

/**
 * Stdio MCP server exposing two tools — `knowledge.search` (BM25 over the
 * agent's materialized knowledge dir) and `knowledge.fetch` (range-bounded
 * file read under the same dir).
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
  index: Bm25Index;
  rootDir: string;
}

export async function buildServeContext(knowledgeDir: string): Promise<ServeContext> {
  const index = await buildIndex(knowledgeDir);
  return { index, rootDir: knowledgeDir };
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
  const id = req.id ?? null;

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
        serverInfo: { name: "agent-smith-knowledge", version: "1.0.0" },
      },
    };
  }

  if (req.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "knowledge.search",
            description:
              "BM25 search over the agent's materialized knowledge sources. Returns ranked file paths with snippets.",
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
        ],
      },
    };
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

function handleSearch(
  id: number | string | null,
  args: Record<string, unknown>,
  ctx: ServeContext,
): JsonRpcResponse {
  const query = typeof args.query === "string" ? args.query : "";
  const rawK = typeof args.k === "number" ? args.k : Number(args.k ?? 5);
  const k = Math.min(20, Math.max(1, Number.isFinite(rawK) ? rawK : 5));
  const hits = ctx.index.search(query, k);
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] },
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

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function buildIndex(rootDir: string): Promise<Bm25Index> {
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
export async function serveStdio(knowledgeDir: string): Promise<void> {
  const ctx = await buildServeContext(knowledgeDir);

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
      resolve();
    });
  });
}
