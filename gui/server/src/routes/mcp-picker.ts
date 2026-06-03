import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerAndToolsView, McpUrlShapedTool } from "gui-shared";
import type { Hono } from "hono";
import { HttpError } from "../middleware/error";
import { parseRegistrySources } from "../services/parse-registry";

const AGENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Cross-rootDir loader for the smith-side primitives the picker needs.
 * Mirrors the dynamic-import pattern used by routes/knowledge.ts and
 * routes/agents.ts: gui/server's tsconfig has rootDir: "src", so a static
 * `import "../../../../src/..."` would fail typecheck. Bun resolves the
 * dynamic import at request time. Tests inject overrides via deps so the
 * real $HOME / spawn paths are never touched.
 */
interface CoreModule {
  readAvailableMcpServers: (opts: {
    homeDir: string;
  }) => Promise<Record<string, { command: string; args?: string[]; env?: Record<string, string> }>>;
  createSpawnOptsResolver: (opts: { homeDir: string }) => Promise<
    (name: string) => {
      command: string;
      args?: ReadonlyArray<string>;
      env?: Record<string, string>;
    }
  >;
  McpClientPool: new () => {
    acquire: (
      name: string,
      opts: {
        command: string;
        args?: ReadonlyArray<string>;
        env?: Record<string, string>;
      },
    ) => Promise<{
      listTools: () => Promise<
        Array<{
          name: string;
          inputSchema?: Record<string, unknown> | undefined;
        }>
      >;
    }>;
    shutdown: () => Promise<void>;
  };
  detectUrlParam: (tool: {
    name: string;
    inputSchema?: Record<string, unknown> | undefined;
  }) => { kind: "string" | "string-array"; key: string } | null;
}

async function loadCore(): Promise<CoreModule> {
  // Cross-rootDir loader: gui/server's tsconfig has rootDir: "src", so a
  // statically-typed import from "../../../../src/..." breaks the workspace
  // typecheck (TS analyzes the literal path target). Mirrors the indirection
  // pattern already used by `services/mcp-config.ts` (see `detectInstalledDefault`)
  // — assigning the path to a const variable keeps Bun's runtime resolution
  // intact while sidestepping the compile-time rootDir analysis. Tests
  // never reach this default; they inject a stub via `loadCoreModule`.
  const readersPath = "../../../../src/io/mcp-config-readers";
  const resolverPath = "../../../../src/io/mcp-spawn-resolver";
  const poolPath = "../../../../src/io/mcp-client-pool";
  const probePath = "../../../../src/core/knowledge/probe-route";
  const readers = (await import(readersPath)) as Pick<CoreModule, "readAvailableMcpServers">;
  const resolver = (await import(resolverPath)) as Pick<CoreModule, "createSpawnOptsResolver">;
  const pool = (await import(poolPath)) as Pick<CoreModule, "McpClientPool">;
  const probe = (await import(probePath)) as Pick<CoreModule, "detectUrlParam">;
  return {
    readAvailableMcpServers: readers.readAvailableMcpServers,
    createSpawnOptsResolver: resolver.createSpawnOptsResolver,
    McpClientPool: pool.McpClientPool,
    detectUrlParam: probe.detectUrlParam,
  };
}

export interface McpPickerRouteDeps {
  registryPath: string;
  /** Home directory used to read the user's AI client MCP configs. Tests
   *  inject a tmpdir so the real `~/.claude.json` etc. are never touched. */
  homeDir?: string;
  /**
   * Cross-rootDir module loader override. Tests inject a stub that returns
   * fake `readAvailableMcpServers`, `McpClientPool`, etc. so no real MCP
   * server is spawned and no real $HOME is read.
   */
  loadCoreModule?: () => Promise<CoreModule>;
}

async function locateBundleDir(agent: string, registryPath: string): Promise<string | null> {
  const sources = await parseRegistrySources(registryPath);
  for (const src of sources) {
    const dir = join(src.rootPath, agent);
    const cfg = join(dir, "agent.config.json");
    try {
      if ((await stat(cfg)).isFile()) return dir;
    } catch {
      // continue
    }
  }
  return null;
}

interface BundleInfo {
  mcpServers: string[];
}

async function readBundleMcpServers(bundleDir: string): Promise<BundleInfo> {
  const cfgPath = join(bundleDir, "agent.config.json");
  let raw: string;
  try {
    raw = await readFile(cfgPath, "utf8");
  } catch {
    return { mcpServers: [] };
  }
  try {
    const data = JSON.parse(raw) as { mcpServers?: unknown };
    if (Array.isArray(data.mcpServers)) {
      const out: string[] = [];
      for (const v of data.mcpServers) {
        if (typeof v === "string" && v.length > 0) out.push(v);
      }
      return { mcpServers: out };
    }
  } catch {
    // fall through
  }
  return { mcpServers: [] };
}

/**
 * Build the union list of candidate servers, preserving bundle-declaration
 * order and labelling each entry by where smith found it. Mirrors
 * `buildServerCandidates` in src/cli/commands/knowledge/pick-via.ts; the
 * GUI labels duplicates with `source: "both"` so the dropdown can render a
 * single combined badge instead of dropping the second hit silently.
 */
function unionServers(
  bundle: readonly string[],
  available: Readonly<Record<string, unknown>>,
): Array<{ name: string; source: "bundle" | "available" | "both" }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; source: "bundle" | "available" | "both" }> = [];
  for (const name of bundle) {
    if (seen.has(name)) continue;
    seen.add(name);
    const inAvailable = Object.hasOwn(available, name);
    out.push({ name, source: inAvailable ? "both" : "bundle" });
  }
  for (const name of Object.keys(available)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, source: "available" });
  }
  return out;
}

export function registerMcpPickerRoute(app: Hono, deps: McpPickerRouteDeps): void {
  const homeDir = deps.homeDir ?? homedir();
  const loadCoreModule = deps.loadCoreModule ?? loadCore;

  /**
   * Per-agent server/tool picker payload for the Add Knowledge Source modal.
   *
   * Returns the union of bundle-declared `mcpServers[]` and the user's AI
   * client MCP configs, paired with each server's URL-shaped tools (filtered
   * via `detectUrlParam`). Per-server failures (spawn failed, listTools
   * errored, timed out) are surfaced as `error: <message>` in the server
   * entry instead of populating tools — the modal disables the tool dropdown
   * for that row but other rows remain pickable.
   *
   * Pool lifetime is scoped to this request: the route creates a fresh
   * `McpClientPool`, spawns each candidate server once, calls `tools/list`,
   * and shuts the pool down before responding. No background processes
   * leak between requests.
   */
  app.get("/api/agents/:name/mcp-servers-and-tools", async (c) => {
    const name = c.req.param("name");
    if (!AGENT_NAME_RE.test(name)) {
      throw new HttpError(400, "INVALID_NAME", `invalid agent name: ${name}`);
    }
    const bundleDir = await locateBundleDir(name, deps.registryPath);
    if (!bundleDir) {
      throw new HttpError(404, "NOT_FOUND", `agent ${name} not registered`);
    }

    const core = await loadCoreModule();
    const { mcpServers: bundleServers } = await readBundleMcpServers(bundleDir);
    const available = await core.readAvailableMcpServers({ homeDir });
    const servers = unionServers(bundleServers, available);

    if (servers.length === 0) {
      const empty: McpServerAndToolsView = { servers: [], toolsByServer: {} };
      return c.json(empty);
    }

    const spawnOptsFor = await core.createSpawnOptsResolver({ homeDir });
    const pool = new core.McpClientPool();
    const toolsByServer: Record<string, McpUrlShapedTool[]> = {};
    const annotatedServers: McpServerAndToolsView["servers"] = [];

    try {
      // Probe servers in parallel: each spawn-and-list is independent and
      // we want the slowest server to set the wall-clock floor, not the sum.
      const probes = servers.map(async (s) => {
        try {
          const opts = spawnOptsFor(s.name);
          const client = await pool.acquire(s.name, opts);
          const tools = await client.listTools();
          const urlShaped: McpUrlShapedTool[] = [];
          for (const t of tools) {
            const param = core.detectUrlParam(t);
            if (param === null) continue;
            urlShaped.push({ name: t.name, urlParam: { kind: param.kind, key: param.key } });
          }
          return { name: s.name, source: s.source, urlShaped };
        } catch (err) {
          return {
            name: s.name,
            source: s.source,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });
      const results = await Promise.all(probes);
      for (const r of results) {
        if ("error" in r) {
          annotatedServers.push({ name: r.name, source: r.source, error: r.error });
          continue;
        }
        annotatedServers.push({ name: r.name, source: r.source });
        toolsByServer[r.name] = r.urlShaped;
      }
    } finally {
      await pool.shutdown();
    }

    const view: McpServerAndToolsView = {
      servers: annotatedServers,
      toolsByServer,
    };
    return c.json(view);
  });
}
