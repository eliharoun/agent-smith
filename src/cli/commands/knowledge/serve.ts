import { serveStdio } from "../../../core/knowledge/serve-mcp";
import { SmithError } from "../../../core/smith-error";
import type { AgentBundle } from "../../../core/types";
import { type KnowledgePaths, knowledgeDirFor } from "../../../io/knowledge-paths";
import { canonicalRegistryPath, loadRegistry } from "../../../io/registry";
import { defaultKnowledgePaths } from "../../install-paths";
import { findBundleOrFail, loadAllBundles, warnAllLoadFailures } from "../../load-all";

/**
 * Dependency-injection seams for `runKnowledgeServe`. Production callers
 * omit these; tests pass `loadBundle` to feed in-memory fixtures without
 * writing a registry file. Mirrors the `compile` command's seam shape.
 */
export interface KnowledgeServeDeps {
  paths?: KnowledgePaths;
  loadBundle?: (name: string) => Promise<AgentBundle | null>;
}

export interface KnowledgeServeOptions extends KnowledgeServeDeps {
  name: string;
  stdio: boolean;
}

/**
 * `smith knowledge serve <agent> [--stdio]`
 *
 * Spawns a stdio MCP server backed by an in-memory BM25 index over the
 * agent's materialized knowledge dir. Two tools: `knowledge.search` and
 * `knowledge.fetch`. Index is rebuilt on every spawn (a future optimization
 * may persist it under `~/.cache/agent-smith/knowledge-index/<agent>/`).
 *
 * Stdio is currently the only transport. `--stdio` defaults to true at the
 * CLI layer; we keep the option here for forward compat with a future
 * `--http <port>` mode.
 */
export async function runKnowledgeServe(opts: KnowledgeServeOptions): Promise<void> {
  if (!opts.stdio) {
    throw new SmithError({
      code: "usage-error",
      message: "smith knowledge serve currently supports --stdio only",
      suggestedCommand: `smith knowledge serve ${opts.name} --stdio`,
    });
  }

  const paths = opts.paths ?? defaultKnowledgePaths();
  const loadOne = opts.loadBundle ?? defaultLoadBundle;

  // Validate the agent exists before opening stdio. Otherwise an unknown
  // agent would silently serve an empty index.
  const bundle = await loadOne(opts.name);
  if (!bundle) {
    throw new SmithError({
      code: "not-found",
      what: "agent",
      identifier: opts.name,
      suggestedCommand: `smith agent init ${opts.name}`,
    });
  }

  await serveStdio(knowledgeDirFor(opts.name, paths));
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
