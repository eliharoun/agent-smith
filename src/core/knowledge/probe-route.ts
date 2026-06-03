import type { McpClientPool } from "../../io/mcp-client-pool";
import type { McpClientOpts, McpToolDescriptor } from "../../io/mcp-client";
import { extractMetaClaims, matchMetaClaim } from "./route-meta";

export interface ProbeRouteOpts {
  url: string;
  bundleMcpServers: readonly string[];
  pool: McpClientPool;
  spawnOptsFor: (server: string) => McpClientOpts;
  /** UI callback. Returns the user's free-form response. The caller is
   *  responsible for interpreting "y"/"yes"/"" as the desired affirmative. */
  prompt: (msg: string) => Promise<string>;
}

export interface ProbeRouteResult {
  server: string;
  tool: string;
}

/** Read-shaped tool-name regex. Mirrors via-tool-guard's allowlist. */
const READ_SHAPED = /^(read|get|fetch|search|list|describe|preview|head)/i;

/**
 * Walk through candidate `(server, tool)` pairs from the bundle's
 * declared MCP servers. For each, ask the user; on yes, try a fetch; on
 * fetch-success, show a preview and ask for final confirmation.
 *
 * Returns the confirmed route, or null if nothing succeeded / user declined.
 */
export async function probeRoute(opts: ProbeRouteOpts): Promise<ProbeRouteResult | null> {
  if (opts.bundleMcpServers.length === 0) return null;

  for (const server of opts.bundleMcpServers) {
    let client;
    try {
      client = await opts.pool.acquire(server, opts.spawnOptsFor(server));
    } catch {
      continue;
    }

    let tools: McpToolDescriptor[];
    try {
      tools = await client.listTools();
    } catch {
      continue;
    }

    // First: tools with explicit _meta claims for this URL.
    const claims = extractMetaClaims(server, tools);
    const claimMatch = matchMetaClaim(claims, opts.url);
    if (claimMatch) {
      const confirmed = await tryRoute(opts, server, claimMatch.tool, "advertises this domain via metadata");
      if (confirmed) return confirmed;
    }

    // Then: read-shaped tools (heuristic candidates).
    for (const tool of tools) {
      if (!READ_SHAPED.test(tool.name)) continue;
      const confirmed = await tryRoute(opts, server, tool.name, "matches the read-shaped naming convention");
      if (confirmed) return confirmed;
    }
  }

  return null;
}

async function tryRoute(
  opts: ProbeRouteOpts,
  server: string,
  tool: string,
  reason: string,
): Promise<ProbeRouteResult | null> {
  const ans = (await opts.prompt(
    `  → Try ${server}.${tool}? (${reason}) [y/N]: `,
  )).trim().toLowerCase();
  if (ans !== "y" && ans !== "yes") return null;

  // Attempt the fetch. We don't import acquireViaMcp here to avoid a
  // circular dep; the caller (acquire-source dispatch) already has the
  // primitive — we just confirm the user wants this route.
  // For the purposes of this probe, returning the confirmed pair is
  // enough; the dispatch path will execute the fetch with the route.
  const previewAns = (await opts.prompt(
    `  Confirm: use ${server}.${tool} for this and similar URLs? [Y/n]: `,
  )).trim().toLowerCase();
  if (previewAns === "n" || previewAns === "no") return null;

  return { server, tool };
}
