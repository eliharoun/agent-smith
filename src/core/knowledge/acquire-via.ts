import { SmithError } from "../smith-error";
import type { McpClientPool } from "../../io/mcp-client-pool";
import type { McpClientOpts } from "../../io/mcp-client";
import type { Via } from "./types";
import type { AcquiredArtifact } from "./acquire";
import { findRoute } from "./routing-registry";
import { assertViaToolAllowed } from "./via-tool-guard";

export interface AcquireViaOpts {
  pool: McpClientPool;
  spawnOptsFor: (server: string) => McpClientOpts;
}

/**
 * Call `via.server.via.tool(args)` through the pool. Returns the tool's
 * text content as a single AcquiredArtifact (consistent with acquireUrl).
 *
 * Argument resolution order:
 *   1) via.args (explicit; highest precedence)
 *   2) routing-registry argMapper(url) (auto, when registry knows the URL
 *      AND the registry entry's server/tool match the declared via)
 *   3) { url } fallback
 *
 * Pre-flight checks:
 *   - via.tool name must be read-shaped or via.allowWriteTool=true.
 *
 * Image / binary content blocks are not yet supported — Phase 1 expects
 * URL-fetcher tools to return text. isError=true responses are surfaced.
 */
export async function acquireViaMcp(
  via: Via,
  url: string,
  opts: AcquireViaOpts,
): Promise<AcquiredArtifact[]> {
  assertViaToolAllowed(via);
  const args = resolveArgs(via, url);
  const client = await opts.pool.acquire(via.server, opts.spawnOptsFor(via.server));
  const result = await client.callTool(via.tool, args);
  if (result.isError) {
    const errText = result.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n\n");
    throw new SmithError({
      code: "network-error",
      operation: `mcp ${via.server}.${via.tool}`,
      url,
      cause: errText || "tool returned isError=true with no text content",
    });
  }
  const text = result.content
    .filter((c) => c.type === "text" && c.text !== undefined)
    .map((c) => c.text)
    .join("\n\n");
  if (text.length === 0) {
    throw new SmithError({
      code: "network-error",
      operation: `mcp ${via.server}.${via.tool}`,
      url,
      cause: "tool returned no text content",
    });
  }
  const filename = filenameFromUrl(url);
  return [{
    filename,
    relPath: filename,
    bytes: Buffer.from(text, "utf8"),
    contentType: "text/plain",
  }];
}

function resolveArgs(via: Via, url: string): Record<string, unknown> {
  if (via.args) return via.args;
  const route = findRoute(url);
  if (route && route.server === via.server && route.tool === via.tool) {
    return route.argMapper(url);
  }
  return { url };
}

function filenameFromUrl(url: string): string {
  let last: string;
  try {
    const u = new URL(url);
    last = u.pathname.split("/").filter(Boolean).pop() ?? "page";
  } catch {
    last = "page";
  }
  // Sanitize to safe filename chars and length-cap (path-traversal hygiene).
  const safe = last.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128) || "page";
  return `${safe}.txt`;
}
