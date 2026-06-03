import { detectUrlParam } from "../../../core/knowledge/probe-route";
import type { McpClientOpts, McpToolDescriptor } from "../../../io/mcp-client";
import type { McpClientPool } from "../../../io/mcp-client-pool";
import { SmithError } from "../../../core/smith-error";

/**
 * Origin label for a server entry in the picker list. Drives the bracketed
 * suffix shown to the user and the "did smith have to extend mcpServers[]"
 * accounting reported back to the caller.
 */
export type ServerOrigin = "bundle" | "available";

export interface ServerCandidate {
  name: string;
  origin: ServerOrigin;
}

export interface PickViaOpts {
  /** The URL the user is adding. Currently only used in error/log messages. */
  url: string;
  /** Names already declared in the bundle's `mcpServers[]`. Order preserved. */
  currentMcpServers: readonly string[];
  /** Map of server-name → spawn opts read from the user's AI client configs. */
  availableMcpServers: Readonly<Record<string, unknown>>;
  /** Process-wide MCP client pool. Picker reuses any already-connected client
   *  but does NOT shut the pool down — the caller owns its lifetime. */
  pool: McpClientPool;
  /** Resolves a server name to spawn opts. Throws (typically SmithError) if
   *  the name is unknown to every platform's MCP config. */
  spawnOptsFor: (server: string) => McpClientOpts;
  /** UI prompt callback. Returns the user's free-form response, trimmed. */
  prompt: (msg: string) => Promise<string>;
  /** Optional info sink for one-way messages (no response expected). When
   *  omitted the picker prints to console.log. */
  notify?: (msg: string) => void;
}

export interface PickViaResult {
  server: string;
  tool: string;
  /** True when the picked server wasn't in `currentMcpServers` and the
   *  caller therefore needs to append it to the bundle's `mcpServers[]`. */
  serverWasAdded: boolean;
}

/**
 * Build the union list of candidate servers shown to the user. Bundle-
 * declared servers come first (preserving their declaration order); any
 * server present only in the available map is appended afterward in the
 * order the underlying map yields it. Names are deduplicated case-
 * sensitively — the bundle entry wins.
 */
export function buildServerCandidates(
  currentMcpServers: readonly string[],
  availableMcpServers: Readonly<Record<string, unknown>>,
): ServerCandidate[] {
  const seen = new Set<string>();
  const out: ServerCandidate[] = [];
  for (const name of currentMcpServers) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, origin: "bundle" });
  }
  for (const name of Object.keys(availableMcpServers)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, origin: "available" });
  }
  return out;
}

/**
 * Interactive MCP server/tool picker for `smith knowledge add` URL
 * sources. Prompts the user to pick a server (bundle ∪ user's AI client
 * config), then auto-selects the lone URL-shaped tool, prompts when
 * multiple exist, or raises a friendly error when the chosen server has
 * none.
 *
 * Returns:
 *   - `null` when the user picks "skip" / leaves input blank, or when
 *     there are no candidate servers at all (caller falls through to the
 *     existing curated-registry suggestion).
 *   - `{ server, tool, serverWasAdded }` on success. `serverWasAdded` is
 *     true when the chosen server wasn't already in `currentMcpServers`.
 *
 * Errors:
 *   - The chosen server has zero URL-shaped tools → throws a SmithError
 *     so the caller aborts the add (silently saving without via would
 *     contradict the explicit user request).
 *   - The chosen server fails to spawn (binary not on PATH, etc.) →
 *     throws a SmithError surfacing the cause; falling through silently
 *     would mask install issues the user should fix before adding the
 *     source.
 */
export async function pickViaInteractively(opts: PickViaOpts): Promise<PickViaResult | null> {
  const candidates = buildServerCandidates(opts.currentMcpServers, opts.availableMcpServers);
  if (candidates.length === 0) return null;

  const notify = opts.notify ?? ((msg: string) => console.log(msg));

  // Server picker.
  notify("");
  notify("  Which MCP server fetches this URL? (or skip for direct HTTP)");
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const tag = c.origin === "bundle" ? "[from bundle]" : "[from your AI client config]";
    notify(`    ${i + 1}. ${c.name.padEnd(28)} ${tag}`);
  }
  notify(`    0. skip — save as direct-HTTP source`);
  const pickRaw = (await opts.prompt(`  Choice [0]: `)).trim();
  if (pickRaw === "" || pickRaw === "0") return null;

  const pickIdx = Number.parseInt(pickRaw, 10);
  if (!Number.isInteger(pickIdx) || pickIdx < 1 || pickIdx > candidates.length) {
    throw new SmithError({
      code: "validation-failed",
      what: "MCP server picker input",
      reasons: [`'${pickRaw}' is not a number between 0 and ${candidates.length}`],
    });
  }
  const chosen = candidates[pickIdx - 1]!;

  // Tool picker. Spawn the chosen server through the pool and filter its
  // tool list with detectUrlParam — same shape detector probe-on-failure
  // already trusts.
  let tools: McpToolDescriptor[];
  try {
    const spawnOpts = opts.spawnOptsFor(chosen.name);
    const client = await opts.pool.acquire(chosen.name, spawnOpts);
    tools = await client.listTools();
  } catch (err) {
    throw new SmithError(
      {
        code: "validation-failed",
        what: `MCP server '${chosen.name}'`,
        reasons: [
          `failed to spawn or list tools: ${err instanceof Error ? err.message : String(err)}`,
          `verify the server is installed and runnable in your AI client config`,
        ],
      },
      { cause: err instanceof Error ? err : undefined },
    );
  }

  const urlShapedTools = tools.filter((t) => detectUrlParam(t) !== null);
  if (urlShapedTools.length === 0) {
    throw new SmithError({
      code: "validation-failed",
      what: `MCP server '${chosen.name}'`,
      reasons: [
        `has no URL-shaped tools (no inputSchema declares a url/uri/inputs/urls parameter)`,
        `pick a different server, or rerun and choose 0 to save without via`,
      ],
    });
  }

  let toolName: string;
  if (urlShapedTools.length === 1) {
    toolName = urlShapedTools[0]!.name;
    notify(`  → routing through ${chosen.name}.${toolName}`);
  } else {
    notify(`  ${chosen.name} has ${urlShapedTools.length} URL-shaped tools:`);
    for (let i = 0; i < urlShapedTools.length; i++) {
      const t = urlShapedTools[i]!;
      const param = detectUrlParam(t);
      const shape =
        param?.kind === "string-array"
          ? `(takes ${param.key}: string[])`
          : param
            ? `(takes ${param.key}: string)`
            : "";
      notify(`    ${i + 1}. ${t.name.padEnd(28)} ${shape}`);
    }
    const toolPickRaw = (await opts.prompt(`  Choice [1]: `)).trim();
    const toolIdx = toolPickRaw === "" ? 1 : Number.parseInt(toolPickRaw, 10);
    if (!Number.isInteger(toolIdx) || toolIdx < 1 || toolIdx > urlShapedTools.length) {
      throw new SmithError({
        code: "validation-failed",
        what: "MCP tool picker input",
        reasons: [`'${toolPickRaw}' is not a number between 1 and ${urlShapedTools.length}`],
      });
    }
    toolName = urlShapedTools[toolIdx - 1]!.name;
    notify(`  → routing through ${chosen.name}.${toolName}`);
  }

  return {
    server: chosen.name,
    tool: toolName,
    serverWasAdded: chosen.origin === "available",
  };
}
