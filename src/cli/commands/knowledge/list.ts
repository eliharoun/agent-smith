import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import type { RefreshCacheEntry } from "../../../core/knowledge/refresh-cache";
import { parseRefresh } from "../../../core/knowledge/refresh-spec";
import type {
  KnowledgeManifest,
  KnowledgeSource,
  RefreshMode,
} from "../../../core/knowledge/types";
import { SmithError } from "../../../core/smith-error";
import { toMessage } from "../../../core/to-message";
import { type KnowledgePaths, knowledgeDirFor } from "../../../io/knowledge-paths";
import { formatRefreshSummary } from "./format-refresh-summary";

export interface KnowledgeListDeps {
  /**
   * Returns the agent's declared knowledge sources from agent.config.json,
   * or `null` if the agent is not registered. Distinguishes the "agent not
   * found" state from the "no sources declared" and "declared but not
   * materialized" states. CLI wiring injects a real registry-backed loader.
   */
  loadDeclaredSources?: (agent: string) => Promise<KnowledgeSource[] | null>;
  /**
   * Per-source refresh-cache reader. Returns the cached refresh state for
   * one source, or `undefined` when there is no entry (or the entry is
   * unreadable / off-schema — readRefreshCache normalizes those cases to
   * undefined). CLI wiring closes over defaultCacheRoot() and the agent
   * name. When omitted, all sources are treated as "no cache entry".
   */
  readRefreshCache?: (sourceId: string) => Promise<RefreshCacheEntry | undefined>;
  /** Injectable clock for deterministic age math in tests.
   *  Returns ms since epoch. Defaults to Date.now. */
  now?: () => number;
}

export interface KnowledgeListOptions {
  json?: boolean;
}

export async function knowledgeList(
  agent: string,
  paths: KnowledgePaths,
  deps: KnowledgeListDeps = {},
  options: KnowledgeListOptions = {},
): Promise<number> {
  const declared = deps.loadDeclaredSources ? await deps.loadDeclaredSources(agent) : undefined;

  if (declared === null) {
    throw new SmithError({
      code: "not-found",
      what: "agent",
      identifier: agent,
      suggestedCommand: `smith agent init ${agent}`,
    });
  }

  // Read per-source refresh cache in parallel. EACCES/EIO errors per source
  // become entries in cacheReadErrors and are treated as "no cache" downstream.
  // ENOENT and corrupt entries are normalized to undefined by readRefreshCache
  // itself and never surface here.
  const cacheReadErrors: string[] = [];
  const declaredList = declared ?? [];
  const declaredById = new Map(declaredList.map((d) => [d.id, d]));
  const cacheResults = await Promise.all(
    declaredList.map(async (s) => {
      if (!deps.readRefreshCache) return [s.id, undefined] as const;
      try {
        const entry = await deps.readRefreshCache(s.id);
        return [s.id, entry] as const;
      } catch (err) {
        cacheReadErrors.push(`${s.id}: ${toMessage(err)}`);
        return [s.id, undefined] as const;
      }
    }),
  );
  const cacheById = new Map<string, RefreshCacheEntry | undefined>(cacheResults);
  const nowMs = (deps.now ?? Date.now)();

  const dir = knowledgeDirFor(agent, paths);
  const manifestPath = join(dir, "_manifest.json");
  let manifest: KnowledgeManifest | null = null;
  try {
    const raw = await readFile(manifestPath, "utf8");
    manifest = JSON.parse(raw) as KnowledgeManifest;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new SmithError({
        code: "permission-denied",
        path: manifestPath,
        operation: "read",
      });
    }
    if (code !== "ENOENT") {
      throw new SmithError({
        code: "validation-failed",
        what: "knowledge manifest",
        reasons: [`could not read manifest: ${toMessage(err)}`],
      });
    }
  }

  if (options.json) {
    const declaredEntries = declaredList.map((s) =>
      jsonDeclaredEntry(s, cacheById.get(s.id), nowMs),
    );
    const state: "materialized" | "declared-only" = manifest ? "materialized" : "declared-only";
    // `manifest` is emitted verbatim as parsed from `_manifest.json`. Its shape
    // is versioned by `manifest.schemaVersion`; JSON consumers should branch on
    // that field if they need to handle future on-disk schema changes. We do not
    // project a CLI-owned subset, by design — see spec § JSON output.
    const output: KnowledgeListJsonOutput = {
      agent,
      state,
      declared: declaredEntries,
      manifest,
      cacheReadErrors,
    };
    // Compact output: pipe-friendly for jq, grep, line-oriented consumers.
    console.log(JSON.stringify(output));
    return 0;
  }

  if (!manifest) {
    if (declared === undefined) {
      throw new SmithError({
        code: "not-found",
        what: "installed knowledge",
        identifier: agent,
        suggestedCommand: `smith agent install ${agent}`,
      });
    }
    if (declared.length === 0) {
      console.log(pc.bold(`Knowledge for ${agent}:`));
      console.log(pc.dim("  no knowledge sources declared yet"));
      console.log("");
      console.log(pc.dim(`  Add one:  smith knowledge add ${agent} <type> <path-or-url>`));
      return 0;
    }
    console.log(pc.bold(`Knowledge for ${agent}:`));
    console.log(pc.dim(`  ${declaredList.length} source(s) declared but not yet materialized`));
    console.log("");
    for (const s of declaredList) {
      const ref = sourceRef(s);
      console.log(`  ${pc.bold(s.id)}  ${pc.dim(`(${s.type}${ref ? `, ${ref}` : ""})`)}`);
      if (s.description) console.log(pc.dim(`    ${s.description}`));
      const summary = formatRefreshSummary({
        refresh: s.refresh,
        cache: cacheById.get(s.id),
        now: nowMs,
      });
      console.log(summary.failed ? pc.red(`    ${summary.line}`) : pc.dim(`    ${summary.line}`));
    }
    console.log("");
    console.log(pc.dim(`  Materialize:  smith agent install ${agent}`));
    printCacheErrorFooter(cacheReadErrors);
    return 0;
  }

  console.log(pc.bold(`Knowledge for ${agent}:`));
  console.log(
    pc.dim(
      `  rendered ${manifest.renderedAt} • inline ${manifest.totals.tokensInline}/${manifest.totals.tokensInlineBudget} tokens • ${manifest.totals.files} files • ${manifest.totals.bytes}B`,
    ),
  );
  console.log("");
  for (const s of manifest.sources) {
    const head = `  ${pc.bold(s.id)}  ${pc.dim(`(${s.scope}, ${s.type}, ${s.delivery})`)}`;
    console.log(head);
    if (s.description) console.log(pc.dim(`    ${s.description}`));
    console.log(pc.dim(`    files: ${s.files.length}, tokens(inline): ${s.tokensInline}`));
    const declaredSrc = declaredById.get(s.id);
    const summary = formatRefreshSummary({
      refresh: declaredSrc?.refresh,
      cache: cacheById.get(s.id),
      now: nowMs,
    });
    console.log(summary.failed ? pc.red(`    ${summary.line}`) : pc.dim(`    ${summary.line}`));
    for (const f of s.files) console.log(`      - ${f.path}${f.summary ? `  — ${f.summary}` : ""}`);
  }
  printCacheErrorFooter(cacheReadErrors);
  return 0;
}

function printCacheErrorFooter(cacheReadErrors: string[]): void {
  if (cacheReadErrors.length === 0) return;
  console.log(
    pc.dim(
      `\n  note: ${cacheReadErrors.length} source(s) had unreadable cache meta; refresh status may be incomplete`,
    ),
  );
}

function sourceRef(s: KnowledgeSource): string | undefined {
  if ("url" in s && typeof s.url === "string") return s.url;
  if ("path" in s && typeof s.path === "string") return s.path;
  if ("package" in s && typeof s.package === "string") return s.package;
  return undefined;
}

// Mirror of sourceRef() but returns `null` instead of `undefined` so the JSON
// output is JSON.stringify-friendly (undefined would be omitted from output,
// hiding the field). `null` is also legitimate for source types with no
// natural ref field (e.g., confluence, jira) — callers should not interpret
// null as "missing data".
function refOf(s: KnowledgeSource): string | null {
  return sourceRef(s) ?? null;
}

/**
 * Locked-down v1 JSON output schema. Every field is explicit; no optional
 * (`?:`) fields and no `unknown` — the type system enforces shape stability.
 * Changes to this shape are breaking for `--json` consumers.
 */
interface JsonRefresh {
  mode: RefreshMode;
  ttl: string | null;
  ttlMs: number | null;
}

interface JsonCache {
  lastRefreshedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  ageMs: number | null;
  /** Negative when overdue (|n| ms past the TTL). Null when mode !== "ttl"
   *  or when no cache entry exists. */
  dueInMs: number | null;
}

interface JsonDeclaredEntry {
  id: string;
  type: string;
  ref: string | null;
  description: string | null;
  refresh: JsonRefresh;
  cache: JsonCache;
}

interface KnowledgeListJsonOutput {
  agent: string;
  state: "materialized" | "declared-only";
  declared: JsonDeclaredEntry[];
  manifest: KnowledgeManifest | null;
  cacheReadErrors: string[];
}

function jsonDeclaredEntry(
  s: KnowledgeSource,
  cache: RefreshCacheEntry | undefined,
  nowMs: number,
): JsonDeclaredEntry {
  // parseRefresh only throws on malformed TTL strings, which the Zod schema
  // already rejects upstream. If it ever throws here, surface the error rather
  // than silently rewriting the user's refresh spec as "install" in machine
  // output — JSON consumers must never see a fabricated mode.
  const n = parseRefresh(s.refresh);
  const refresh: JsonRefresh = {
    mode: n.mode,
    ttl: n.ttl ?? null,
    ttlMs: n.ttlMs ?? null,
  };

  const lastRefreshedAt = cache?.last_refreshed_at ?? null;
  const lastAttemptAt = cache?.last_attempt_at ?? null;
  const lastError = cache?.last_error ?? null;
  const ageMs = lastRefreshedAt ? nowMs - Date.parse(lastRefreshedAt) : null;
  const dueInMs =
    refresh.mode === "ttl" && refresh.ttlMs !== null && ageMs !== null
      ? refresh.ttlMs - ageMs
      : null;

  return {
    id: s.id,
    type: s.type,
    ref: refOf(s),
    description: s.description ?? null,
    refresh,
    cache: {
      lastRefreshedAt,
      lastAttemptAt,
      lastError,
      ageMs,
      dueInMs,
    },
  };
}
