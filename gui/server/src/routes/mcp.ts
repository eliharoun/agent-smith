import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { z } from "zod";
import { HttpError } from "../middleware/error";
import {
  defaultMcpConfigPaths,
  detectMcpStatus,
  keyForAgent,
  type McpPlatform,
  MCP_PLATFORMS,
  removeMcpEntry,
  writeMcpEntry,
} from "../services/mcp-config";
import { parseRegistry, type Registry } from "../services/parse-registry";
import { resolveSmithPath } from "../services/resolve-smith-path";

export interface McpRouteDeps {
  registryPath: string;
  /** Test override: per-platform global MCP config paths. */
  configPathsFor?: () => Record<McpPlatform, string>;
  /** Test override: detected platforms. */
  detectInstalled?: () => Promise<Set<McpPlatform>>;
}

const AGENT_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
function assertValidAgentName(name: string): void {
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${name}`);
  }
}

async function assertAgentExists(registryPath: string, name: string): Promise<void> {
  const reg = await parseRegistry(registryPath);
  const exists = Object.values(reg.catalogs).some((info) => info.agents.includes(name));
  if (!exists) {
    throw new HttpError(404, "NOT_FOUND", `agent ${name} not in registry`);
  }
}

/**
 * Read the bundle's saved `mcpServers[]` and report whether it already
 * contains the per-agent key (`<agent>-knowledge`). Returns `false` on any
 * read/parse failure — the modal shows the diff line conservatively in
 * that case (better to over-report than to silently skip the line).
 *
 * Kept inside the route handler (not in `mcp-wiring.ts`) so the wiring
 * module stays pure: it operates on AI-client config files only and never
 * reads the bundle's `agent.config.json`.
 */
async function readBundleHasEntry(
  registry: Registry,
  agentName: string,
): Promise<boolean> {
  for (const info of Object.values(registry.catalogs)) {
    if (!info.agents.includes(agentName)) continue;
    const configPath = join(info.path, agentName, "agent.config.json");
    try {
      const data = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
      const arr = data.mcpServers;
      if (!Array.isArray(arr)) return false;
      return arr.includes(keyForAgent(agentName));
    } catch {
      return false;
    }
  }
  return false;
}

const PlatformEnum = z.enum(MCP_PLATFORMS);
const WiringBody = z
  .object({
    enable: z.boolean(),
    platforms: z.array(PlatformEnum).min(1),
  })
  .strict();

export function registerMcpRoutes(app: Hono, deps: McpRouteDeps) {
  const configPathsFor = deps.configPathsFor ?? (() => defaultMcpConfigPaths());

  /**
   * Wiring plan preview. Returned shape lets the GUI render the confirm
   * modal without making per-platform decisions client-side.
   *
   * `bundleHasEntry` is a bundle-level fact (the saved `mcpServers[]`
   * array contains `<agent>-knowledge`) — kept at the response top-level
   * rather than inside `PlatformMcpStatus` because it is not per-platform.
   * The modal uses it to decide whether to show the
   * "+ mcpServers add ..." diff line.
   */
  app.get("/api/agents/:name/mcp-wiring-plan", async (c) => {
    const name = c.req.param("name");
    assertValidAgentName(name);
    const reg = await parseRegistry(deps.registryPath);
    const exists = Object.values(reg.catalogs).some((info) => info.agents.includes(name));
    if (!exists) {
      throw new HttpError(404, "NOT_FOUND", `agent ${name} not in registry`);
    }
    const paths = configPathsFor();
    const [platforms, bundleHasEntry] = await Promise.all([
      detectMcpStatus({
        agent: name,
        paths,
        ...(deps.detectInstalled ? { detectInstalled: deps.detectInstalled } : {}),
      }),
      readBundleHasEntry(reg, name),
    ]);
    return c.json({ platforms, bundleHasEntry });
  });

  /**
   * Apply wiring: add or remove the canonical entry on each requested
   * platform. Failures are isolated per-platform: if one write fails the
   * others are still applied. The response carries per-platform success
   * + error details, plus the resulting status.
   */
  app.post("/api/agents/:name/mcp-wiring", async (c) => {
    const name = c.req.param("name");
    assertValidAgentName(name);
    await assertAgentExists(deps.registryPath, name);
    const body = await c.req.json().catch(() => null);
    const parsed = WiringBody.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_REQUEST", parsed.error.message);
    }
    const { enable, platforms } = parsed.data;
    const paths = configPathsFor();
    // Pre-flight: when enabling, every platform's writer needs an absolute
    // smith path. If the resolver can't find smith we'd write the same
    // failure into N platforms — fail fast with a single, actionable 500
    // instead so the GUI banner can render "couldn't resolve smith path;
    // reinstall smith and retry".
    if (enable) {
      try {
        resolveSmithPath();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "could not resolve smith executable path";
        throw new HttpError(
          500,
          "SMITH_NOT_FOUND",
          `${message}. Reinstall smith and retry.`,
        );
      }
    }
    const results = await Promise.all(
      platforms.map(async (platform) => {
        const configPath = paths[platform];
        try {
          if (enable) {
            await writeMcpEntry({ platform, agent: name, configPath });
          } else {
            await removeMcpEntry({ platform, agent: name, configPath });
          }
          return { platform, ok: true as const, configPath };
        } catch (err) {
          return {
            platform,
            ok: false as const,
            configPath,
            error: (err as Error).message,
          };
        }
      }),
    );
    // Refresh the status snapshot for the response so the GUI can re-render
    // the modal "after" state if it wants to confirm visually.
    const status = await detectMcpStatus({
      agent: name,
      paths,
      ...(deps.detectInstalled ? { detectInstalled: deps.detectInstalled } : {}),
    });
    return c.json({ results, platforms: status });
  });
}
