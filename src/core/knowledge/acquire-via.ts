import { SmithError } from "../smith-error";
import type { McpClientPool } from "../../io/mcp-client-pool";
import type { McpClient, McpClientOpts } from "../../io/mcp-client";
import type { Via } from "./types";
import type { AcquiredArtifact } from "./acquire";
import { detectUrlParam } from "./probe-route";
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
 *   3) tool inputSchema introspection — wraps the URL in the right shape
 *      (string vs single-element string array) based on the declared
 *      parameter name and type.
 *   4) { url } fallback when no URL-shaped parameter can be detected.
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
  const client = await opts.pool.acquire(via.server, opts.spawnOptsFor(via.server));
  const args = await resolveArgs(via, url, client);
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

async function resolveArgs(
  via: Via,
  url: string,
  client: McpClient,
): Promise<Record<string, unknown>> {
  if (via.args) return via.args;
  const route = findRoute(url);
  if (route && route.server === via.server && route.tool === via.tool) {
    return route.argMapper(url);
  }
  // Inspect the tool's declared inputSchema so we wrap the URL in the
  // shape the tool actually expects — single string vs string[]. The
  // pool keeps the connection alive between calls so this is a single
  // extra round-trip per acquire.
  try {
    const tools = await client.listTools();
    const tool = tools.find((t) => t.name === via.tool);
    if (tool) {
      const param = detectUrlParam(tool);
      if (param?.kind === "string") return { [param.key]: url };
      if (param?.kind === "string-array") return { [param.key]: [url] };
    }
  } catch {
    // tools/list failure is non-fatal here — fall through to the
    // legacy { url } default and let callTool surface a meaningful
    // error if the tool genuinely doesn't accept that shape.
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
