import type { Hono } from "hono";
import { z } from "zod";
import { HttpError } from "../middleware/error";
import {
  defaultMcpConfigPaths,
  detectMcpStatus,
  type McpPlatform,
  MCP_PLATFORMS,
  removeMcpEntry,
  writeMcpEntry,
} from "../services/mcp-config";
import { parseRegistry } from "../services/parse-registry";

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
   */
  app.get("/api/agents/:name/mcp-wiring-plan", async (c) => {
    const name = c.req.param("name");
    assertValidAgentName(name);
    await assertAgentExists(deps.registryPath, name);
    const paths = configPathsFor();
    const platforms = await detectMcpStatus({
      agent: name,
      paths,
      ...(deps.detectInstalled ? { detectInstalled: deps.detectInstalled } : {}),
    });
    return c.json({ platforms });
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
