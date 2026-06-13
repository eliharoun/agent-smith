import pc from "picocolors";
import { indexDbPath } from "../../../core/knowledge/index/index-paths";
import { type IndexStats, KnowledgeStore } from "../../../core/knowledge/index/store";
import type { KnowledgeSource } from "../../../core/knowledge/types";
import { SmithError } from "../../../core/smith-error";
import { type KnowledgePaths, knowledgeDirFor } from "../../../io/knowledge-paths";

export interface KnowledgeInfoDeps {
  /** Returns the agent's declared knowledge sources, or `null` if the agent is
   *  not registered. CLI wiring injects a registry-backed loader. */
  loadDeclaredSources?: (agent: string) => Promise<KnowledgeSource[] | null>;
  /** Opens the index DB read-only and returns its stats, or `null` when the DB
   *  is absent / unreadable / not running under Bun. CLI wiring closes over the
   *  resolved index path; tests inject a stub. */
  openStats?: (dbPath: string) => Promise<IndexStats | null>;
}

export interface KnowledgeInfoOptions {
  json?: boolean;
}

/** Default openStats: open the on-disk index DB read-only (same call serve
 *  makes) and read aggregate stats. The placeholder header is inert in readonly
 *  mode — real values come from stats()/storedEmbedderId(). */
async function defaultOpenStats(dbPath: string): Promise<IndexStats | null> {
  const store = await KnowledgeStore.open(
    dbPath,
    { schemaVersion: 1, embedderId: "none", embedderDim: 1, chunkerVersion: 1, repomapVersion: 1 },
    { readonly: true },
  );
  if (!store) return null;
  try {
    return store.stats();
  } finally {
    store.close();
  }
}

// A lazy webpage source is fetched at runtime and never indexed, so its
// retrieval mode is moot — report "lazy" so the per-source line reads honestly.
// `lazy` lives only on WebpageSource, so narrow via the discriminant rather
// than an unchecked `in`-cast.
function retrievalOf(s: KnowledgeSource): string {
  if (s.type === "webpage" && s.lazy) return "lazy";
  return s.retrieval?.mode ?? "off";
}

export async function knowledgeInfo(
  agent: string,
  paths: KnowledgePaths,
  deps: KnowledgeInfoDeps = {},
  options: KnowledgeInfoOptions = {},
): Promise<number> {
  const declared = deps.loadDeclaredSources ? await deps.loadDeclaredSources(agent) : null;
  if (declared === null) {
    throw new SmithError({
      code: "not-found",
      what: "agent",
      identifier: agent,
      suggestedCommand: `smith agent init ${agent}`,
    });
  }

  const dir = knowledgeDirFor(agent, paths);
  const dbPath = indexDbPath(dir);
  const openStats = deps.openStats ?? defaultOpenStats;
  const stats = await openStats(dbPath);

  // Hybrid is active iff the index exists AND was built with a real embedder.
  // This matches serve-mcp.ts's predicate exactly (store !== null &&
  // embedder.id !== "none") — serve loads the query embedder iff
  // storedEmbedderId() !== "none". Reporting the same predicate means `info`
  // never contradicts the agent's live knowledge.search tool description.
  // Vector coverage is surfaced separately below, so a degenerate
  // real-embedder/zero-vector index shows as HYBRID with 0% rather than being
  // silently downgraded.
  const hybridActive = stats !== null && stats.embedderId !== "none";

  if (options.json) {
    console.log(
      JSON.stringify({
        agent,
        materialized: stats !== null,
        hybridActive,
        embedderId: stats?.embedderId ?? null,
        stats,
        sources: declared.map((s) => ({ id: s.id, type: s.type, retrieval: retrievalOf(s) })),
      }),
    );
    return 0;
  }

  console.log(pc.bold(`Knowledge index for ${agent}:`));

  if (!stats) {
    console.log(pc.dim("  index not materialized yet (no .cache/index/knowledge.db)"));
    console.log("");
    console.log(pc.dim(`  Build it:  smith agent install ${agent}`));
    return 0;
  }

  const retrievalLabel = hybridActive
    ? `${pc.green("HYBRID")} ✓ active (semantic + lexical)`
    : `${pc.yellow("BM25")} only (lexical) — no query embedder loaded`;
  const percentVectorized = stats.chunks > 0 ? Math.round((stats.vectors / stats.chunks) * 100) : 0;
  console.log(`  retrieval: ${retrievalLabel}`);
  console.log(pc.dim(`  embedder: ${stats.embedderId ?? "none"}`));
  console.log(
    pc.dim(
      `  chunks: ${stats.chunks} • vectors: ${stats.vectors} (${percentVectorized}%) • code-mapped paths: ${stats.taggedPaths}`,
    ),
  );

  console.log("");
  console.log(pc.bold("  sources:"));
  const byId = new Map(stats.perSource.map((p) => [p.sourceId, p]));
  for (const s of declared) {
    const mode = retrievalOf(s);
    const ps = byId.get(s.id);
    const counts =
      mode === "lazy"
        ? pc.dim("not indexed (runtime fetch)")
        : ps
          ? pc.dim(`${ps.vectors}/${ps.chunks} vectors`)
          : pc.dim("no indexed chunks");
    console.log(`    ${pc.bold(s.id)}  ${pc.dim(`(${s.type}, ${mode})`)}  ${counts}`);
  }

  console.log("");
  console.log(
    pc.dim(
      "  note: a running knowledge MCP server reflects this only after a restart\n        (Claude Code: /mcp → reconnect, or start a new session)",
    ),
  );
  return 0;
}
