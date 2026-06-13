import pc from "picocolors";
import { indexDbPath } from "../../../core/knowledge/index/index-paths";
import { MODEL_POLICY_VERSION, roleForModelId } from "../../../core/knowledge/index/model-policy";
import { SCHEMA_VERSION } from "../../../core/knowledge/index/schema-version";
import { isStaleHybrid } from "../../../core/knowledge/stale-hybrid";
import { parseRefresh } from "../../../core/knowledge/refresh-spec";
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
    { schemaVersion: SCHEMA_VERSION, embedders: [], chunkerVersion: 1, modelPolicyVersion: MODEL_POLICY_VERSION, repomapVersion: 1 },
    { readonly: true },
  );
  if (!store) return null;
  try {
    return store.stats();
  } catch {
    return null; // stale/unreadable index -> treat as not materialized
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

function staleHybridFlag(s: KnowledgeSource): boolean {
  const lazy = s.type === "webpage" && s.lazy === true;
  return isStaleHybrid({
    retrievalMode: s.retrieval?.mode,
    refreshMode: parseRefresh(s.refresh).mode,
    lazy,
  });
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
  let stats: IndexStats | null;
  try {
    stats = await openStats(dbPath);
  } catch {
    stats = null; // never crash the CLI on an index read error
  }

  // Hybrid is active iff the index exists AND holds at least one embedding
  // model. This matches serve-mcp.ts's predicate exactly — serve loads query
  // embedders iff the index records live models. Reporting the same predicate
  // means `info` never contradicts the agent's live knowledge.search tool
  // description. Vector coverage is surfaced separately below, so a degenerate
  // real-embedder/zero-vector index shows as HYBRID with 0% rather than being
  // silently downgraded.
  const hybridActive = stats !== null && stats.embedders.length > 0;

  if (options.json) {
    console.log(
      JSON.stringify({
        agent,
        materialized: stats !== null,
        hybridActive,
        embedders: stats?.embedders ?? [],
        stats,
        sources: declared.map((s) => ({ id: s.id, type: s.type, retrieval: retrievalOf(s), staleHybrid: staleHybridFlag(s) })),
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
  if (stats.embedders.length > 0) {
    const list = stats.embedders.map((m) => `${roleForModelId(m.id)} → ${m.id}`).join(", ");
    console.log(pc.dim(`  embedders: ${list}`));
  } else {
    console.log(pc.dim(`  embedder: none`));
  }
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
    const modelTag =
      ps && ps.vectors > 0 && ps.models.length > 0
        ? `  ${pc.dim(`[${ps.models.map(roleForModelId).sort().join("+")}]`)}`
        : "";
    const stale = staleHybridFlag(s) ? `  ${pc.yellow("⚠ never auto-refreshed")}` : "";
    console.log(`    ${pc.bold(s.id)}  ${pc.dim(`(${s.type}, ${mode})`)}  ${counts}${modelTag}${stale}`);
  }

  if (declared.some(staleHybridFlag)) {
    console.log("");
    console.log(
      pc.dim(
        "  note: sources marked ⚠ are embedded but refresh only at install — their\n        vectors can drift. Set the source's `refresh` to \"ttl\"/\"session\" in the\n        agent config, then grant hooks with 'smith agent reconfigure <agent>'.",
      ),
    );
  }

  console.log("");
  console.log(
    pc.dim(
      "  note: a running knowledge MCP server reflects this only after a restart\n        (Claude Code: /mcp → reconnect, or start a new session)",
    ),
  );
  return 0;
}
