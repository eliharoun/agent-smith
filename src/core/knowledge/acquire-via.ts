import { SmithError } from "../smith-error";
import type { McpClientPool } from "../../io/mcp-client-pool";
import type { McpClient, McpClientOpts } from "../../io/mcp-client";
import type { Via } from "./types";
import type { AcquiredArtifact } from "./acquire";
import { detectUrlParam } from "./probe-route";
import { findRoute } from "./routing-registry";
import { assertViaToolAllowed } from "./via-tool-guard";
import { sniffArtifact } from "./sniff-content";

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
  let result;
  try {
    result = await client.callTool(via.tool, args);
  } catch (err) {
    if (isMethodNotFoundError(err)) {
      throw await methodNotFoundSmithError(client, via);
    }
    throw err;
  }
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
  const declaredCt = readDeclaredContentType(result);
  const sniffHints: { url: string; declaredCt?: string } = { url };
  if (declaredCt) sniffHints.declaredCt = declaredCt;
  const sniff = sniffArtifact(Buffer.from(text, "utf8"), sniffHints);
  return [{
    filename: sniff.filename,
    relPath: sniff.filename,
    bytes: sniff.bytes,
    contentType: sniff.contentType,
  }];
}

/**
 * Read a content-type hint from an MCP tool result. The MCP spec allows
 * embedded resource blocks to declare `mimeType`; we honor that when
 * present. Otherwise, return undefined and let `sniffArtifact` infer
 * from the bytes themselves.
 */
function readDeclaredContentType(result: { content: ReadonlyArray<{ type: string; mimeType?: string }> }): string | undefined {
  for (const block of result.content) {
    if (block.type === "resource" && typeof block.mimeType === "string") return block.mimeType;
  }
  return undefined;
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

/**
 * JSON-RPC -32601 ("method not found") detection. McpClient's `callRaw`
 * formats every JSON-RPC error as `mcp error <code>: <message>`, so we
 * match the leading code rather than the human-facing message string.
 */
function isMethodNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\bmcp error -32601\b/.test(msg);
}

/**
 * Build a SmithError that names the missing tool and lists the URL-shaped
 * tools the server actually exposes, so authors can pick a real name
 * without consulting the server's docs separately. If listing tools also
 * fails (e.g. the server has since disconnected) we surface a simpler
 * fallback error.
 */
async function methodNotFoundSmithError(client: McpClient, via: Via): Promise<SmithError> {
  let tools;
  try {
    tools = await client.listTools();
  } catch {
    return new SmithError({
      code: "validation-failed",
      what: `via.tool '${via.tool}'`,
      reasons: [
        `tool not found on server '${via.server}', and listing available tools also failed`,
        `verify the server is still running and the tool name is correct`,
      ],
    });
  }
  const urlShaped = tools.filter((t) => detectUrlParam(t) !== null);
  return new SmithError({
    code: "validation-failed",
    what: `via.tool '${via.tool}' on server '${via.server}'`,
    reasons: [
      `tool not found on the server. The server reports these URL-shaped tools available:`,
      ...urlShaped.map((t) => `  - ${t.name}`),
      `update your bundle's via.tool to one of the names above, or run smith knowledge add again to use the picker.`,
    ],
  });
}

