// src/core/knowledge/acquire-source.ts
import { isAbsolute, resolve } from "node:path";
import type { McpClientOpts } from "../../io/mcp-client";
import type { McpClientPool } from "../../io/mcp-client-pool";
import { SmithError } from "../smith-error";
import {
  type AcquiredArtifact,
  acquireConfluence,
  acquireDir,
  acquireFile,
  acquireGit,
  acquireGlob,
  acquireJira,
  acquireUrl,
  type GitSpawner,
} from "./acquire";
import { acquireViaMcp } from "./acquire-via";
import {
  inferMaterializer,
  materializeHtml,
  materializeJson,
  materializePassthrough,
} from "./materialize";
import type { KnowledgeSource, Materializer } from "./types";

export interface AcquireSourceOpts {
  /** Used to resolve relative paths for file/dir source types. */
  bundleDir: string;
  /** Cache root for URL/git acquirer artifacts. */
  cacheDir: string;
  /** Optional DI for git invocations (tests). */
  gitSpawner?: GitSpawner;
  /** v1.2: pool for via-routed URL sources. Required when any source has
   *  an explicit `via:` declaration; absence triggers a fail-loud
   *  `internal-error` rather than a silent HTTP fall-through that would
   *  misroute auth-coupled URLs. */
  mcpPool?: McpClientPool;
  /** v1.2: resolver for spawn opts of a named MCP server. Required when
   *  `mcpPool` is set. */
  spawnOptsFor?: (server: string) => McpClientOpts;
  /** Phase 3: per-user routing cache (Layer 3). */
  routeCache?: import("./route-cache").RouteCache;
  /** Phase 3: _meta claims from bundle's MCP servers (Layer 2). */
  metaClaims?: import("./route-meta").MetaClaim[];
  /** Phase 3: probe-on-failure callback. Caller decides whether to enable. */
  probeOnFailure?: (url: string) => Promise<{ server: string; tool: string } | null>;
  /** Phase 3: callback to record a confirmed route into the cache. */
  recordRoute?: (route: { url: string; server: string; tool: string }) => Promise<void>;
}

/** Returns true if `acquireSource` has a real dispatch case for this source
 *  type. Currently `npm` is declared in the type union but not yet wired up.
 *  The exhaustive `switch` makes the type checker flag this function the
 *  moment a new variant lands in `KnowledgeSourceType` — no silent drift. */
export function isAcquirable(type: KnowledgeSource["type"]): boolean {
  switch (type) {
    case "file":
    case "dir":
    case "glob":
    case "url":
    case "git":
    case "confluence":
    case "jira":
      return true;
    case "npm":
      return false;
  }
}

/**
 * Dispatch a KnowledgeSource to its type-specific acquirer.
 * Returns acquired artifacts + any warnings emitted by streaming acquirers
 * (confluence, git).
 *
 * Extracted from pipeline.ts so both `runKnowledgeStage` and `refreshSource`
 * share one source-type switch.
 */
export async function acquireSource(
  src: KnowledgeSource,
  opts: AcquireSourceOpts,
): Promise<{ artifacts: AcquiredArtifact[]; warnings: string[] }> {
  const warnings: string[] = [];
  const warnSink = (m: string) => warnings.push(m);
  const artifacts = await dispatch(src, opts, warnSink);
  return { artifacts, warnings };
}

function resolveSourcePath(p: string, bundleDir: string): string {
  return isAbsolute(p) ? p : resolve(bundleDir, p);
}

function isProbeRecoverable(err: unknown): boolean {
  if (!(err instanceof SmithError)) return false;
  const code = err.payload.code;
  // Probe is appropriate when direct HTTP couldn't succeed for an auth-
  // or network-shaped reason. Don't probe on schema/usage errors.
  return code === "network-error" || code === "permission-denied" || code === "http-error";
}

async function dispatch(
  src: KnowledgeSource,
  opts: AcquireSourceOpts,
  warnSink: (m: string) => void,
): Promise<AcquiredArtifact[]> {
  switch (src.type) {
    case "file":
      return acquireFile(resolveSourcePath(src.path, opts.bundleDir));
    case "dir": {
      const dirOpts: { include?: string[]; exclude?: string[] } = {};
      if (src.include) dirOpts.include = src.include;
      if (src.exclude) dirOpts.exclude = src.exclude;
      return acquireDir(resolveSourcePath(src.path, opts.bundleDir), dirOpts);
    }
    case "glob":
      return acquireGlob(src.path, opts.bundleDir);
    case "url": {
      // Explicit via wins (Phase 1).
      if (src.via) {
        if (!opts.mcpPool || !opts.spawnOptsFor) {
          throw new SmithError({
            code: "internal-error",
            message: `URL source '${src.id}' has via:${src.via.server}.${src.via.tool} but acquireSource was called without mcpPool/spawnOptsFor. Caller must inject these.`,
          });
        }
        return acquireViaMcp(src.via, src.url, {
          pool: opts.mcpPool,
          spawnOptsFor: opts.spawnOptsFor,
        });
      }

      // Phase 3: three-layer resolver.
      if (opts.routeCache !== undefined && opts.mcpPool && opts.spawnOptsFor) {
        const { resolveRoute } = await import("./route-resolver");
        const resolved = resolveRoute({
          url: src.url,
          cache: opts.routeCache,
          metaClaims: opts.metaClaims ?? [],
        });
        if (resolved) {
          return acquireViaMcp(
            { server: resolved.server, tool: resolved.tool },
            src.url,
            { pool: opts.mcpPool, spawnOptsFor: opts.spawnOptsFor },
          );
        }
      }

      // Direct HTTP (Phase 1 baseline).
      try {
        return await acquireUrl(src.url, opts.cacheDir, {
          ...(src.auth ? { auth: src.auth } : {}),
        });
      } catch (err) {
        // Phase 3: probe on auth/network failure.
        if (
          opts.probeOnFailure &&
          opts.mcpPool &&
          opts.spawnOptsFor &&
          isProbeRecoverable(err)
        ) {
          const probed = await opts.probeOnFailure(src.url);
          if (probed) {
            if (opts.recordRoute) {
              await opts.recordRoute({ url: src.url, server: probed.server, tool: probed.tool });
            }
            return acquireViaMcp(probed, src.url, {
              pool: opts.mcpPool,
              spawnOptsFor: opts.spawnOptsFor,
            });
          }
        }
        throw err;
      }
    }
    case "git": {
      const gitOpts: import("./acquire").AcquireGitOpts = {
        url: src.url,
        cacheDir: opts.cacheDir,
        onWarning: warnSink,
        ...(src.ref ? { ref: src.ref } : {}),
        ...(src.subpath ? { subpath: src.subpath } : {}),
        ...(src.include ? { include: src.include } : {}),
        ...(opts.gitSpawner ? { spawner: opts.gitSpawner } : {}),
      };
      return acquireGit(gitOpts);
    }
    case "confluence": {
      const cOpts: Parameters<typeof acquireConfluence>[0] = { space: src.space };
      if (src.pages) cOpts.pages = src.pages;
      if (src.maxPages !== undefined) cOpts.maxPages = src.maxPages;
      if (src.includeChildren !== undefined) cOpts.includeChildren = src.includeChildren;
      if (src.format !== undefined) cOpts.format = src.format;
      const result = await acquireConfluence(cOpts);
      for (const w of result.warnings) warnSink(w);
      return result.artifacts;
    }
    case "jira": {
      const jOpts: Parameters<typeof acquireJira>[0] = { jql: src.jql };
      if (src.fields) jOpts.fields = src.fields;
      if (src.maxResults !== undefined) jOpts.maxResults = src.maxResults;
      return acquireJira(jOpts);
    }
    default:
      throw new SmithError({
        code: "validation-failed",
        what: "knowledge source",
        reasons: [`type=${(src as { type: string }).type} is not supported yet`],
      });
  }
}

/** Choose the effective materializer for an artifact, honoring an explicit
 *  `src.materialize` override and falling back to type/filename inference. */
export function chooseMaterializer(src: KnowledgeSource, art: AcquiredArtifact): Materializer {
  if (src.materialize) return src.materialize;
  const hint: { filename?: string; contentType?: string } = { filename: art.filename };
  if (art.contentType) hint.contentType = art.contentType;
  return inferMaterializer(hint);
}

/** Apply a materializer. Returns rendered string + materializer warnings. */
export function runMaterializer(
  m: Materializer,
  art: AcquiredArtifact,
): { content: string; warnings: string[] } {
  switch (m) {
    case "json":
      return materializeJson(art.bytes);
    case "html-to-md": {
      // Rewrite artifact filename: bytes after this materializer ARE markdown,
      // so the on-disk file should have a .md extension regardless of what
      // the input HTML's extension was. The sniffer picks `.html` based on
      // the INPUT content-type; the OUTPUT type is markdown after turndown.
      // Mutating in place because callers (refresh-source.ts) read these
      // fields after runMaterializer returns to choose where to write.
      if (art.filename.toLowerCase().endsWith(".html")) {
        art.filename = `${art.filename.slice(0, -5)}.md`;
      } else if (art.filename.toLowerCase().endsWith(".htm")) {
        art.filename = `${art.filename.slice(0, -4)}.md`;
      }
      if (art.relPath?.toLowerCase().endsWith(".html")) {
        art.relPath = `${art.relPath.slice(0, -5)}.md`;
      } else if (art.relPath?.toLowerCase().endsWith(".htm")) {
        art.relPath = `${art.relPath.slice(0, -4)}.md`;
      }
      return materializeHtml(art.bytes.toString("utf8"), art.sourceUrl ?? "https://localhost/");
    }
    case "passthrough":
    case "markdown":
    case "text":
      return materializePassthrough(art.bytes);
    case "pdf-extract":
      throw new SmithError({
        code: "validation-failed",
        what: "knowledge materializer",
        reasons: ["pdf-extract materializer not yet implemented"],
      });
  }
}
