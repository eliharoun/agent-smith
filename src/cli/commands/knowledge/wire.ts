import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { SmithError } from "../../../core/smith-error";
import type { AgentBundle } from "../../../core/types";
import { atomicWriteText } from "../../../io/atomic-write";
import {
  defaultMcpConfigPaths,
  detectMcpStatus,
  keyForAgent,
  type McpPlatform,
  MCP_PLATFORMS,
  removeMcpEntry,
  writeMcpEntry,
} from "../../../io/mcp-wiring";
import { canonicalRegistryPath, loadRegistry } from "../../../io/registry";
import { resolveSmithPath as defaultResolveSmithPath } from "../../../io/resolve-smith-path";
import { findBundleOrFail, loadAllBundles, warnAllLoadFailures } from "../../load-all";

/**
 * `smith knowledge wire <agent>` and `smith knowledge unwire <agent>` —
 * the CLI counterpart to the GUI's MCP wiring toggle. Same write/detect
 * logic (shared via `src/io/mcp-wiring.ts`), same per-agent key
 * (`<agent>-knowledge`), same atomic writes. No GUI server involvement.
 */

export type WireMode = "wire" | "unwire";

export interface KnowledgeWireOptions {
  agent: string;
  mode: WireMode;
  /** Comma-separated platform filter, e.g. `"claude-code,kiro"`. */
  platforms?: string;
  // ── DI seams (tests only) ───────────────────────────────────────────────
  /** Override homedir (and the derived MCP config paths) for tests. */
  paths?: Record<McpPlatform, string>;
  loadBundle?: (name: string) => Promise<AgentBundle | null>;
  detectInstalled?: () => Promise<Set<McpPlatform>>;
  resolveSmithPath?: () => string;
  /** Hook for the optional re-install at the end. Production callers can
   * inject `install` from `cli/commands/install.ts`; tests pass a no-op. */
  runInstall?: (agentName: string) => Promise<void>;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
}

export interface KnowledgeWireResult {
  /** 0 on full success, 1 if any platform write or bundle update failed. */
  exitCode: 0 | 1;
  perPlatform: Array<{
    platform: McpPlatform;
    status: "wrote" | "removed" | "skipped-cli-missing" | "no-change" | "error";
    configPath: string;
    error?: string;
  }>;
  bundleUpdated: boolean;
}

/**
 * Parse the `--platforms` flag value into a set of valid platform IDs.
 * Empty/undefined returns null (= "all four"). Unknown tokens fail loud
 * with a SmithError so typos don't silently no-op the wire.
 */
function parsePlatformFilter(raw: string | undefined): Set<McpPlatform> | null {
  if (!raw) return null;
  const tokens = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = new Set<McpPlatform>(MCP_PLATFORMS);
  const out = new Set<McpPlatform>();
  const bad: string[] = [];
  for (const t of tokens) {
    if (allowed.has(t as McpPlatform)) {
      out.add(t as McpPlatform);
    } else {
      bad.push(t);
    }
  }
  if (bad.length > 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "--platforms",
      reasons: [
        `unknown platform(s): ${bad.join(", ")}`,
        `valid: ${MCP_PLATFORMS.join(", ")}`,
      ],
    });
  }
  return out;
}

async function defaultLoadBundle(name: string): Promise<AgentBundle | null> {
  const reg = await loadRegistry(canonicalRegistryPath());
  const all = await loadAllBundles(reg);
  warnAllLoadFailures(all.failures, (m) => console.error(m));
  try {
    return findBundleOrFail(all, name);
  } catch (err) {
    if (err instanceof SmithError && err.payload.code === "not-found") return null;
    throw err;
  }
}

/**
 * Update the bundle's `agent.config.json` `mcpServers[]` to add or remove
 * the per-agent key. Returns `true` if the file was rewritten, `false` if
 * the array was already in the desired state.
 */
async function updateBundleMcpServers(
  bundlePath: string,
  agent: string,
  mode: WireMode,
): Promise<boolean> {
  const configPath = join(bundlePath, "agent.config.json");
  const raw = await readFile(configPath, "utf8");
  const data = JSON.parse(raw) as Record<string, unknown>;
  const key = keyForAgent(agent);
  const existing = Array.isArray(data.mcpServers)
    ? (data.mcpServers as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const has = existing.includes(key);
  let next: string[];
  if (mode === "wire") {
    if (has) return false;
    next = [...existing, key];
  } else {
    if (!has) return false;
    next = existing.filter((v) => v !== key);
  }
  data.mcpServers = next;
  await atomicWriteText(configPath, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

/**
 * Drive the full wire/unwire flow:
 *   1. Resolve the bundle (404 if unknown).
 *   2. Detect per-platform status.
 *   3. For each filtered/installed platform: write, remove, or skip with
 *      a message describing the outcome.
 *   4. Update the bundle's `agent.config.json` mcpServers[] array.
 *   5. Return a summary; exit 1 if any platform-level write failed.
 */
export async function runKnowledgeWire(
  opts: KnowledgeWireOptions,
): Promise<KnowledgeWireResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const err = opts.err ?? ((m: string) => console.error(m));
  const loadOne = opts.loadBundle ?? defaultLoadBundle;

  const bundle = await loadOne(opts.agent);
  if (!bundle) {
    throw new SmithError({
      code: "not-found",
      what: "agent",
      identifier: opts.agent,
      suggestedCommand: `smith agent init ${opts.agent}`,
    });
  }

  const requested = parsePlatformFilter(opts.platforms);
  const paths = opts.paths ?? defaultMcpConfigPaths();
  const status = await detectMcpStatus({
    agent: opts.agent,
    paths,
    ...(opts.detectInstalled ? { detectInstalled: opts.detectInstalled } : {}),
  });

  const perPlatform: KnowledgeWireResult["perPlatform"] = [];
  let anyError = false;
  let cachedSmithPath: string | undefined;
  const resolveSmith = (): string => {
    if (cachedSmithPath) return cachedSmithPath;
    const r = opts.resolveSmithPath ?? defaultResolveSmithPath;
    cachedSmithPath = r();
    return cachedSmithPath;
  };

  for (const ps of status) {
    if (requested && !requested.has(ps.platform)) continue;
    if (!ps.cliInstalled) {
      log(pc.dim(`⊘ ${ps.platform} (CLI not detected — skipped)`));
      perPlatform.push({
        platform: ps.platform,
        status: "skipped-cli-missing",
        configPath: ps.configPath,
      });
      continue;
    }
    const desired = opts.mode === "wire";
    if (ps.hasEntry === desired) {
      log(
        pc.green(
          `✓ ${ps.platform} already ${desired ? "wired" : "unwired"} — no change`,
        ),
      );
      perPlatform.push({
        platform: ps.platform,
        status: "no-change",
        configPath: ps.configPath,
      });
      continue;
    }
    try {
      if (desired) {
        await writeMcpEntry({
          platform: ps.platform,
          agent: opts.agent,
          configPath: ps.configPath,
          resolveSmithPath: resolveSmith,
        });
        log(pc.green(`+ ${ps.platform} wired (${ps.configPath})`));
        perPlatform.push({
          platform: ps.platform,
          status: "wrote",
          configPath: ps.configPath,
        });
      } else {
        await removeMcpEntry({
          platform: ps.platform,
          agent: opts.agent,
          configPath: ps.configPath,
        });
        log(pc.yellow(`- ${ps.platform} unwired (${ps.configPath})`));
        perPlatform.push({
          platform: ps.platform,
          status: "removed",
          configPath: ps.configPath,
        });
      }
    } catch (e) {
      anyError = true;
      const message = e instanceof Error ? e.message : String(e);
      err(pc.red(`✗ ${ps.platform} ${desired ? "wire" : "unwire"} failed: ${message}`));
      perPlatform.push({
        platform: ps.platform,
        status: "error",
        configPath: ps.configPath,
        error: message,
      });
    }
  }

  // Bundle-level update — keep the source of truth (agent.config.json
  // mcpServers[]) in sync with the on-disk wiring state. Failures here
  // surface but don't roll back the platform writes (the user can retry).
  let bundleUpdated = false;
  try {
    bundleUpdated = await updateBundleMcpServers(bundle.bundlePath, opts.agent, opts.mode);
    if (bundleUpdated) {
      log(
        pc.dim(
          `  bundle: agent.config.json mcpServers[] ${
            opts.mode === "wire" ? "now includes" : "no longer includes"
          } ${keyForAgent(opts.agent)}`,
        ),
      );
    }
  } catch (e) {
    anyError = true;
    err(pc.red(`✗ failed to update bundle mcpServers[]: ${(e as Error).message}`));
  }

  // Optional re-render. We don't auto-run install here — that's a heavy
  // operation, and the user might want to batch wire calls before
  // re-rendering. Print a hint instead.
  if (opts.runInstall && bundleUpdated) {
    try {
      await opts.runInstall(opts.agent);
    } catch (e) {
      err(pc.red(`✗ runInstall hook failed: ${(e as Error).message}`));
      anyError = true;
    }
  } else if (bundleUpdated) {
    log(pc.dim(`  hint: run 'smith agent install ${opts.agent}' to re-render the bundle`));
  }

  return {
    exitCode: anyError ? 1 : 0,
    perPlatform,
    bundleUpdated,
  };
}
