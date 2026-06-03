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
  /** Optional one-way status callback for informational lines that don't
   *  expect a response (e.g. "N more candidates skipped"). Defaults to a
   *  no-op when omitted. */
  notify?: (msg: string) => void;
}

export interface ProbeRouteResult {
  server: string;
  tool: string;
}

/** Read-shaped tool-name regex. Mirrors via-tool-guard's allowlist. */
const READ_SHAPED = /^(read|get|fetch|search|list|describe|preview|head)/i;

/** Property-name regex identifying a URL parameter. */
const URL_PARAM_NAME = /^(url|uri|URL)$/i;

/** Maximum number of heuristic candidate prompts per probe (across all servers). */
const MAX_CANDIDATE_PROMPTS = 5;

/**
 * Returns true iff the tool's `inputSchema` advertises a string-typed
 * `url`/`uri` property — direct evidence the tool accepts a URL.
 *
 * Defensive against zod-shaped or otherwise non-plain JSON schemas: any
 * property whose value isn't a typed schema with `type === "string"` is
 * treated as not-a-URL and skipped.
 */
export function isUrlShapedTool(tool: McpToolDescriptor): boolean {
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== "object") return false;
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props !== "object") return false;
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (!URL_PARAM_NAME.test(key)) continue;
    if (!value || typeof value !== "object") continue;
    const type = (value as Record<string, unknown>).type;
    if (type === "string") return true;
  }
  return false;
}

/**
 * Walk through candidate `(server, tool)` pairs from the bundle's
 * declared MCP servers. For each, ask the user; on yes, try a fetch; on
 * fetch-success, show a preview and ask for final confirmation.
 *
 * Returns the confirmed route, or null if nothing succeeded / user declined.
 */
export async function probeRoute(opts: ProbeRouteOpts): Promise<ProbeRouteResult | null> {
  if (opts.bundleMcpServers.length === 0) return null;

  // Gather all heuristic candidates across servers first so we can cap
  // them globally. Meta-claim matches are handled inline (per-server)
  // because they're already targeted (the URL matched a declared
  // pattern); they don't contribute to the heuristic-candidate budget.
  const heuristicCandidates: Array<{ server: string; tool: string }> = [];

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

    // Then: tools that are both read-shaped AND advertise a url parameter.
    for (const tool of tools) {
      if (!READ_SHAPED.test(tool.name)) continue;
      if (!isUrlShapedTool(tool)) continue;
      heuristicCandidates.push({ server, tool: tool.name });
    }
  }

  const capped = heuristicCandidates.slice(0, MAX_CANDIDATE_PROMPTS);
  const skipped = heuristicCandidates.length - capped.length;

  for (const { server, tool } of capped) {
    const confirmed = await tryRoute(opts, server, tool, "takes a url parameter");
    if (confirmed) return confirmed;
  }

  if (skipped > 0) {
    opts.notify?.(`  → ${skipped} more candidates skipped; declare via: explicitly to use them\n`);
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
