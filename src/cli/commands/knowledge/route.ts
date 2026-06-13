import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import pc from "picocolors";
import { parseConfig } from "../../../core/config-schema";
import type { KnowledgeBlock, KnowledgeSource, WebpageSource } from "../../../core/knowledge/types";
import { validateKnowledge } from "../../../core/knowledge/validator";
import { SmithError } from "../../../core/smith-error";
import { toMessage } from "../../../core/to-message";
import type { McpClientOpts } from "../../../io/mcp-client";
import { McpClientPool } from "../../../io/mcp-client-pool";
import { type AvailableMap, readAvailableMcpServers } from "../../../io/mcp-config-readers";
import { createSpawnOptsResolver } from "../../../io/mcp-spawn-resolver";
import { readToken } from "../../prompt";
import { pickViaInteractively } from "./pick-via";

export interface KnowledgeRouteOptions {
  /** Bundle directory containing agent.config.json. */
  bundleDir: string;
  /** Agent name (used only in user-facing error/help messages). */
  agentName: string;
  /** When set, restrict routing to a single source id. */
  sourceId?: string;
  /**
   * When true, remove `via:` from the source identified by `sourceId`,
   * switching it back to direct-HTTP fetching. Requires `sourceId`.
   * Mutually exclusive with the interactive picker — no prompt is shown.
   */
  clearVia?: boolean;
  /** DI: prompt user for input. Defaults to readToken. */
  prompt?: (msg: string) => Promise<string>;
  /** DI: TTY detection for the picker. Defaults to process.stdin.isTTY. */
  isTTY?: () => boolean;
  /** DI: read user's AI client MCP configs. Tests inject a stub map. */
  readAvailableMcpServers?: () => Promise<AvailableMap>;
  /** DI: build a spawn-opts resolver. Tests inject a stub. */
  spawnOptsFor?: (server: string) => McpClientOpts;
  /** DI: MCP client pool. When unset, the command owns its own pool. */
  pool?: McpClientPool;
}

function isUrlSource(s: KnowledgeSource): s is WebpageSource {
  return s.type === "webpage";
}

function truncateUrl(s: string, max = 80): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Set or update `via:` on existing URL knowledge sources by invoking the
 * interactive picker (the same one wired into `smith knowledge add`).
 *
 * Without `--source`, iterates every URL source that does not already have
 * `via:` set — sources with an existing route are skipped to avoid double-
 * prompting. With `--source <id>`, runs the picker against that single
 * source whether or not it already has `via:`.
 *
 * With `clearVia: true`, removes `via:` from the source identified by
 * `sourceId` (required) — no picker is invoked. mcpServers[] and
 * mcp.required[] are left intact since other sources may still depend
 * on them.
 *
 * Returns:
 *   - 0 on success (any number of sources routed, including 0).
 *   - throws SmithError on bundle-load failure, missing --source under
 *     --clear-via, or unmatched `--source`.
 */
export async function knowledgeRoute(opts: KnowledgeRouteOptions): Promise<number> {
  const cfgPath = join(opts.bundleDir, "agent.config.json");
  let raw: string;
  try {
    raw = await readFile(cfgPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SmithError(
        {
          code: "config-missing",
          path: cfgPath,
          suggestedCommand: `smith agent init ${basename(opts.bundleDir)}`,
        },
        { cause: err },
      );
    }
    throw err;
  }
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new SmithError(
      {
        code: "validation-failed",
        what: "agent.config.json",
        reasons: [`${cfgPath}: ${toMessage(err)}`],
      },
      { cause: err },
    );
  }

  const block = (cfg.knowledge as KnowledgeBlock | undefined) ?? {};
  const sources = (block.sources ?? []).slice();
  const urlSources = sources.filter(isUrlSource);

  if (urlSources.length === 0) {
    throw new SmithError({
      code: "not-found",
      what: "URL knowledge source",
      identifier: `${opts.agentName} (no URL sources declared)`,
      suggestedCommand: `smith knowledge add ${opts.agentName} <url>`,
    });
  }

  // Explicit clear path: remove via: from a single source, no picker.
  // mcpServers[] and mcp.required[] are intentionally left intact —
  // other sources may still depend on the same server, and removing
  // mcp.required is a separate user action.
  if (opts.clearVia) {
    if (!opts.sourceId) {
      throw new SmithError({
        code: "usage-error",
        message: "--clear-via requires --source <id>",
        suggestedCommand: `smith knowledge route ${opts.agentName} --source <id> --clear-via`,
      });
    }
    const match = urlSources.find((s) => s.id === opts.sourceId);
    if (!match) {
      const knownIds = urlSources.map((s) => s.id);
      throw new SmithError({
        code: "not-found",
        what: "URL knowledge source",
        identifier: opts.sourceId,
        suggestedCommand:
          knownIds.length > 0
            ? `smith knowledge route ${opts.agentName} --source <one of: ${knownIds.join(", ")}> --clear-via`
            : `smith knowledge add ${opts.agentName} <url>`,
      });
    }
    if (match.via === undefined) {
      console.log(
        pc.dim("•"),
        `source ${match.id} is already direct-HTTP; nothing to clear`,
      );
      return 0;
    }
    delete (match as unknown as Record<string, unknown>).via;
    cfg.knowledge = { ...block, sources };
    const parsed = parseConfig(cfg);
    if (!parsed.success) {
      throw new SmithError({
        code: "validation-failed",
        what: "agent config (after knowledge route --clear-via)",
        reasons: parsed.errors,
      });
    }
    const k = validateKnowledge(cfg.knowledge as KnowledgeBlock | undefined);
    if (k.errors.length > 0) {
      throw new SmithError({
        code: "validation-failed",
        what: "knowledge block (after route --clear-via)",
        reasons: k.errors,
      });
    }
    for (const w of k.warnings) console.log(pc.yellow("warn"), w);
    await writeFile(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    console.log(pc.green("→"), `cleared via: from source ${match.id}`);
    return 0;
  }

  // Pick the candidates to prompt about.
  let candidates: WebpageSource[];
  if (opts.sourceId) {
    const match = urlSources.find((s) => s.id === opts.sourceId);
    if (!match) {
      const knownIds = urlSources.map((s) => s.id);
      throw new SmithError({
        code: "not-found",
        what: "URL knowledge source",
        identifier: opts.sourceId,
        suggestedCommand:
          knownIds.length > 0
            ? `smith knowledge route ${opts.agentName} --source <one of: ${knownIds.join(", ")}>`
            : `smith knowledge add ${opts.agentName} <url>`,
      });
    }
    candidates = [match];
  } else {
    candidates = urlSources.filter((s) => !s.via);
    if (candidates.length === 0) {
      console.log(
        pc.dim("•"),
        `all URL sources already have via: set; pass --source <id> to re-route a specific source`,
      );
      console.log(
        pc.dim(`  run smith knowledge fetch ${opts.agentName} to materialize current routes`),
      );
      return 0;
    }
  }

  const prompt = opts.prompt ?? readToken;
  const isTTY = opts.isTTY ?? (() => Boolean(process.stdin.isTTY));
  if (!isTTY()) {
    throw new SmithError({
      code: "validation-failed",
      what: "knowledge route",
      reasons: [
        "the picker is interactive-only; non-TTY runs cannot set via:",
        `set via: by hand-editing ${cfgPath} or rerun in a terminal`,
      ],
    });
  }

  // Pool lifetime: when the caller injects a pool, the caller owns
  // shutdown. Otherwise we spawn one for the duration of this command and
  // close it in `finally` so a partway error never leaks server processes.
  const ownsPool = !opts.pool;
  const pool = opts.pool ?? new McpClientPool();
  const readAvail =
    opts.readAvailableMcpServers ?? (() => readAvailableMcpServers({ homeDir: homedir() }));
  const spawnOptsFor =
    opts.spawnOptsFor ?? (await createSpawnOptsResolver({ homeDir: homedir() }));

  let routed = 0;
  let skipped = 0;
  try {
    const available = await readAvail();
    for (const source of candidates) {
      const declared = ((cfg.mcpServers as string[] | undefined) ?? []).slice();
      console.log("");
      console.log(`Routing source ${source.id}: ${truncateUrl(source.url)}`);
      if (declared.length === 0 && Object.keys(available).length === 0) {
        console.log(
          pc.dim("•"),
          "no MCP servers declared in the bundle and none available from your AI client config",
        );
        console.log(pc.dim("  skipping; install an MCP server and rerun"));
        skipped++;
        continue;
      }
      const picked = await pickViaInteractively({
        url: source.url,
        currentMcpServers: declared,
        availableMcpServers: available,
        pool,
        spawnOptsFor,
        prompt,
      });
      if (!picked) {
        skipped++;
        continue;
      }
      // Mutate the live source (it's a reference into `sources`).
      (source as unknown as Record<string, unknown>).via = {
        server: picked.server,
        tool: picked.tool,
      };
      routed++;

      // Auto-extend mcpServers[] and mcp.required[] mirroring add.ts.
      if (picked.serverWasAdded) {
        const existing = ((cfg.mcpServers as string[] | undefined) ?? []).slice();
        let addedToServers = false;
        if (!existing.includes(picked.server)) {
          existing.push(picked.server);
          cfg.mcpServers = existing;
          addedToServers = true;
        }
        const mcpBlock =
          cfg.mcp && typeof cfg.mcp === "object" && !Array.isArray(cfg.mcp)
            ? (cfg.mcp as { required?: string[]; peer?: string[] })
            : {};
        const required = (mcpBlock.required ?? []).slice();
        let addedToRequired = false;
        if (!required.includes(picked.server)) {
          required.push(picked.server);
          addedToRequired = true;
        }
        cfg.mcp = { ...mcpBlock, required };
        if (addedToServers || addedToRequired) {
          console.log(
            pc.green("→"),
            `added ${picked.server} to mcpServers[] and marked as required`,
          );
        }
      }
    }
  } finally {
    if (ownsPool) await pool.shutdown();
  }

  // Persist the rewritten sources back into the config.
  cfg.knowledge = { ...block, sources };

  // Validate before writing — the picker can't introduce schema errors,
  // but we run the gate for symmetry with add/remove and to catch a
  // pre-existing malformed config.
  const parsed = parseConfig(cfg);
  if (!parsed.success) {
    throw new SmithError({
      code: "validation-failed",
      what: "agent config (after knowledge route)",
      reasons: parsed.errors,
    });
  }
  const k = validateKnowledge(cfg.knowledge as KnowledgeBlock | undefined);
  if (k.errors.length > 0) {
    throw new SmithError({
      code: "validation-failed",
      what: "knowledge block (after route)",
      reasons: k.errors,
    });
  }
  for (const w of k.warnings) console.log(pc.yellow("warn"), w);

  await writeFile(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  console.log("");
  console.log(pc.green("→"), `Routed ${routed} sources, skipped ${skipped}`);
  console.log(pc.dim(`  run smith knowledge fetch ${opts.agentName} to materialize the new routes`));
  return 0;
}
