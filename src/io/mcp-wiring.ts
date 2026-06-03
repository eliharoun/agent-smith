import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { atomicWriteText } from "./atomic-write";
import { detectInstalledPlatforms } from "./platform-detect";

/**
 * Per-agent MCP server key. Each bundle declares its OWN MCP server name so
 * multiple agents can have their knowledge servers wired simultaneously
 * without colliding in the user's AI-client config files.
 *
 * For the canonical `agent-smith` bundle this returns `"agent-smith-knowledge"`
 * (preserved verbatim — old bundles continue to work). Other bundles get
 * `"<agent>-knowledge"`.
 *
 * The agent name MUST match `/^[A-Za-z0-9_-]+$/` — same defense-in-depth
 * pattern as the route handlers — to keep the result safe to use as an
 * object key in JSON/TOML configs.
 */
const AGENT_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function keyForAgent(agent: string): string {
  if (!AGENT_NAME_PATTERN.test(agent)) {
    throw new Error(`invalid agent name for MCP key: ${agent}`);
  }
  return `${agent}-knowledge`;
}

export type McpPlatform = "opencode" | "claude-code" | "codex" | "kiro";

export const MCP_PLATFORMS: readonly McpPlatform[] = [
  "opencode",
  "claude-code",
  "codex",
  "kiro",
] as const;

export interface PlatformMcpStatus {
  platform: McpPlatform;
  cliInstalled: boolean;
  configPath: string;
  /**
   * True iff the config file currently has the agent's per-agent key wired
   * (`<agent>-knowledge`). Other agents' keys, even when present, do not
   * count — this status is per-agent.
   */
  hasEntry: boolean;
  /** True iff the file is parseable (or absent — absent files are writable). */
  configReadable: boolean;
}

/**
 * Default per-platform global MCP config paths. Mirrors the read paths
 * collected by `src/io/mcp-availability.ts`. Kiro is `~/.kiro/settings/mcp.json`
 * (verified empirically — global Kiro MCP config). The user-supplied
 * homedir is honoured so tests can stub it.
 */
export function defaultMcpConfigPaths(home: string = homedir()): Record<McpPlatform, string> {
  return {
    opencode: join(home, ".config", "opencode", "opencode.json"),
    "claude-code": join(home, ".claude.json"),
    codex: join(home, ".codex", "config.toml"),
    kiro: join(home, ".kiro", "settings", "mcp.json"),
  };
}

/**
 * Build the canonical spawn entry written into each platform's MCP config.
 *
 * `resolveSmithPath` MUST return an absolute path to the `smith` executable.
 * GUI-launched MCP clients (Spotlight, dock, Finder) inherit no shell PATH,
 * so a bare `"smith"` would silently fail to spawn. Callers inject the
 * resolver appropriate to their context — the GUI server uses its caching
 * resolver, the CLI uses `process.argv[1]` or its own probe.
 */
function spawnEntry(
  agent: string,
  resolveSmithPath: () => string,
): { command: string; args: string[] } {
  return { command: resolveSmithPath(), args: ["knowledge", "serve", agent, "--stdio"] };
}

/**
 * The shape Claude Code and Kiro use: top-level `mcpServers` object mapping
 * server name → { command, args }. OpenCode uses the same shape under the
 * `mcp` key instead of `mcpServers` (per the existing reader in
 * `src/io/mcp-availability.ts`).
 */
function jsonKey(platform: McpPlatform): string {
  return platform === "opencode" ? "mcp" : "mcpServers";
}

async function readJsonOrEmpty(path: string): Promise<Record<string, unknown>> {
  try {
    const f = Bun.file(path);
    if (!(await f.exists())) return {};
    return (await f.json()) as Record<string, unknown>;
  } catch {
    // Treat unparseable files as empty so we don't clobber the user's
    // hand-edited file with structural assumptions. The caller decides
    // whether to surface this via configReadable=false (detect path) vs.
    // refusing the write (writeMcpEntry path).
    return {};
  }
}

export interface WriteEntryInput {
  platform: McpPlatform;
  agent: string;
  configPath: string;
  /** Resolves smith's absolute path. Required — see {@link spawnEntry}. */
  resolveSmithPath: () => string;
}

export interface RemoveEntryInput {
  platform: McpPlatform;
  agent: string;
  configPath: string;
}

/**
 * Add the per-agent MCP entry for `agent` to the given platform's config
 * file. Creates the file (and parent dirs) when missing. Preserves all
 * unrelated content. Idempotent: writing the same entry twice produces the
 * same on-disk bytes.
 */
export async function writeMcpEntry(input: WriteEntryInput): Promise<void> {
  if (input.platform === "codex") {
    await writeTomlEntry(input.configPath, input.agent, input.resolveSmithPath);
    return;
  }
  await writeJsonEntry(input);
}

export async function removeMcpEntry(input: RemoveEntryInput): Promise<void> {
  if (input.platform === "codex") {
    await removeTomlEntry(input.configPath, input.agent);
    return;
  }
  await removeJsonEntry(input);
}

async function writeJsonEntry(input: WriteEntryInput): Promise<void> {
  const data = await readJsonOrEmpty(input.configPath);
  const key = jsonKey(input.platform);
  const block =
    data[key] && typeof data[key] === "object" && !Array.isArray(data[key])
      ? (data[key] as Record<string, unknown>)
      : {};
  const serverKey = keyForAgent(input.agent);
  // Sort keys so idempotent re-writes produce stable bytes (the user's other
  // entries also stay stably ordered after our edit).
  const next: Record<string, unknown> = {
    ...block,
    [serverKey]: spawnEntry(input.agent, input.resolveSmithPath),
  };
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(next).sort()) sorted[k] = next[k];
  data[key] = sorted;
  await atomicWriteText(input.configPath, `${JSON.stringify(data, null, 2)}\n`);
}

async function removeJsonEntry(input: RemoveEntryInput): Promise<void> {
  const f = Bun.file(input.configPath);
  if (!(await f.exists())) return; // no-op: never create a file just to drop an entry
  const data = await readJsonOrEmpty(input.configPath);
  const key = jsonKey(input.platform);
  const block = data[key];
  if (!block || typeof block !== "object" || Array.isArray(block)) return;
  const rec = block as Record<string, unknown>;
  const serverKey = keyForAgent(input.agent);
  if (!(serverKey in rec)) return;
  const { [serverKey]: _drop, ...rest } = rec;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(rest).sort()) sorted[k] = rest[k];
  data[key] = sorted;
  await atomicWriteText(input.configPath, `${JSON.stringify(data, null, 2)}\n`);
}

async function readTomlOrEmpty(path: string): Promise<Record<string, unknown>> {
  try {
    const f = Bun.file(path);
    if (!(await f.exists())) return {};
    return parseToml(await f.text()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeTomlEntry(
  path: string,
  agent: string,
  resolveSmithPath: () => string,
): Promise<void> {
  const data = await readTomlOrEmpty(path);
  const existing = data.mcp_servers;
  const block: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  block[keyForAgent(agent)] = spawnEntry(agent, resolveSmithPath);
  data.mcp_servers = block;
  await atomicWriteText(path, stringifyToml(data));
}

async function removeTomlEntry(path: string, agent: string): Promise<void> {
  const f = Bun.file(path);
  if (!(await f.exists())) return;
  const data = await readTomlOrEmpty(path);
  const existing = data.mcp_servers;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return;
  const block = { ...(existing as Record<string, unknown>) };
  const serverKey = keyForAgent(agent);
  if (!(serverKey in block)) return;
  delete block[serverKey];
  if (Object.keys(block).length === 0) {
    delete data.mcp_servers;
  } else {
    data.mcp_servers = block;
  }
  await atomicWriteText(path, stringifyToml(data));
}

export interface DetectInput {
  agent: string;
  paths: Record<McpPlatform, string>;
  /** Optional override for tests. Production uses platform-detect.ts. */
  detectInstalled?: () => Promise<Set<McpPlatform>>;
}

async function detectInstalledDefault(): Promise<Set<McpPlatform>> {
  return detectInstalledPlatforms();
}

/**
 * For each supported platform, report:
 *  - whether its CLI is on PATH;
 *  - the path of its global MCP config;
 *  - whether the agent's per-agent `<agent>-knowledge` entry is wired;
 *  - whether the config file is readable/parseable (absent = readable).
 *
 * Used by the GUI's "wiring plan" preview before the user confirms a flip,
 * and by the CLI's `smith knowledge wire/unwire` to decide what to skip.
 */
export async function detectMcpStatus(input: DetectInput): Promise<PlatformMcpStatus[]> {
  const detect = input.detectInstalled ?? detectInstalledDefault;
  const installed = await detect();
  const out: PlatformMcpStatus[] = [];
  const serverKey = keyForAgent(input.agent);
  for (const platform of MCP_PLATFORMS) {
    const path = input.paths[platform];
    const status = await readEntryStatus(platform, path, serverKey);
    out.push({
      platform,
      cliInstalled: installed.has(platform),
      configPath: path,
      ...status,
    });
  }
  return out;
}

async function readEntryStatus(
  platform: McpPlatform,
  path: string,
  serverKey: string,
): Promise<{ hasEntry: boolean; configReadable: boolean }> {
  try {
    const f = Bun.file(path);
    const exists = await f.exists();
    if (!exists) return { hasEntry: false, configReadable: true };
    if (platform === "codex") {
      const parsed = parseToml(await f.text()) as Record<string, unknown>;
      const block = parsed.mcp_servers as Record<string, unknown> | undefined;
      const has = Boolean(block && typeof block === "object" && serverKey in block);
      return { hasEntry: has, configReadable: true };
    }
    const data = (await f.json()) as Record<string, unknown>;
    const block = data[jsonKey(platform)] as Record<string, unknown> | undefined;
    const has = Boolean(block && typeof block === "object" && serverKey in block);
    return { hasEntry: has, configReadable: true };
  } catch {
    return { hasEntry: false, configReadable: false };
  }
}
