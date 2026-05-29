import TurndownService from "turndown";
import type { AcquiredArtifact } from "../core/knowledge/acquire";
import { SmithError } from "../core/smith-error";
import {
  type AtlassianAuth,
  basicAuthHeader,
  remediationBaseUrlMissing,
  resolveAtlassianAuth,
  resolveAtlassianBaseUrl,
} from "./atlassian-auth";
import {
  atlassianFetch,
  createRequestBudget,
  isAbortError,
  type RequestBudget,
  remediationNotConfigured,
} from "./atlassian-http";
import { httpErrorFor } from "./http-error";

export type ConfluenceFormat = "storage" | "view" | "markdown";
export type ConfluencePageRef = string | { id: number };

export interface ConfluenceFetchOpts {
  /** Space key (e.g. "ENG"). Required. */
  space: string;
  /** Optional explicit list of pages by title or id. If omitted, list space pages up to maxPages. */
  pages?: ConfluencePageRef[];
  /** Default 25; hard ceiling 100 (enforced by schema). */
  maxPages?: number;
  /** Default false. */
  includeChildren?: boolean;
  /** Default 'markdown'. */
  format?: ConfluenceFormat;
  /** Test override. */
  resolveAuth?: () => AtlassianAuth | null;
  /** Test override for env vars (SMITH_ATLASSIAN_BASE_URL). */
  env?: NodeJS.ProcessEnv;
  /** Test override for fetch. */
  fetch?: typeof fetch;
}

export interface ConfluenceFetchResult {
  artifacts: AcquiredArtifact[];
  warnings: string[];
}

const DEFAULT_MAX_PAGES = 25;
const HARD_CEILING = 100;

const REMEDIATION = remediationNotConfigured;

function baseUrl(env: NodeJS.ProcessEnv): string {
  const url = resolveAtlassianBaseUrl({ env });
  if (!url) {
    throw new SmithError({
      code: "usage-error",
      message: remediationBaseUrlMissing(),
    });
  }
  return url;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

function bodyFormatParam(format: ConfluenceFormat): string {
  return format === "view" ? "view" : "storage";
}

function extractBody(
  page: { body?: Record<string, { value?: string }> },
  format: ConfluenceFormat,
): string {
  if (format === "view") return page.body?.["view"]?.value ?? "";
  return page.body?.["storage"]?.value ?? "";
}

export async function fetchConfluencePages(
  opts: ConfluenceFetchOpts,
): Promise<ConfluenceFetchResult> {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const resolver = opts.resolveAuth ?? resolveAtlassianAuth;
  const auth = resolver();
  if (!auth) {
    throw new SmithError({
      code: "usage-error",
      message: REMEDIATION(),
    });
  }

  const budget = createRequestBudget();

  const format: ConfluenceFormat = opts.format ?? "markdown";
  const maxPages = Math.min(opts.maxPages ?? DEFAULT_MAX_PAGES, HARD_CEILING);
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(auth),
    Accept: "application/json",
  };
  const base = baseUrl(env);
  const warnings: string[] = [];
  const artifacts: AcquiredArtifact[] = [];
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  // Defense in depth: strip executable / styling tags so they never end up in markdown.
  turndown.remove(["script", "style"]);

  const ids = await resolvePageIds({
    space: opts.space,
    pages: opts.pages,
    maxPages,
    includeChildren: opts.includeChildren ?? false,
    base,
    headers,
    doFetch,
    warnings,
    spaceIdCache: new Map(),
    budget,
  });

  for (const id of ids) {
    const url = `${base}/wiki/api/v2/pages/${encodeURIComponent(id)}?body-format=${bodyFormatParam(format)}`;
    try {
      const res = await atlassianFetch(url, { headers }, doFetch, { budget });
      if (!res.ok) {
        throw await httpErrorFor(res, {
          service: "Confluence",
          url,
          operation: "GET page",
        });
      }
      const page = (await res.json()) as {
        id: string;
        title: string;
        body?: Record<string, { value?: string }>;
      };
      const rawBody = extractBody(page, format);
      const slug = slugify(page.title);
      let filename: string;
      let bytes: Buffer;
      let contentType: string;
      if (format === "markdown") {
        const md = turndown.turndown(rawBody);
        filename = `${page.id}-${slug}.md`;
        bytes = Buffer.from(md, "utf8");
        contentType = "text/markdown";
      } else {
        filename = `${page.id}-${slug}.html`;
        bytes = Buffer.from(rawBody, "utf8");
        contentType = "text/html";
      }
      artifacts.push({ filename, relPath: filename, bytes, contentType });
    } catch (err) {
      // Re-throw cases where continuing makes no sense:
      // (a) Caller-AbortError → the caller asked us to stop.
      // (b) Auth rejected → token is dead, every subsequent request will fail
      //     identically; better to surface once.
      if (isAbortError(err)) throw err;
      // Auth rejected: token is dead, every subsequent request will fail
      // identically — surface once and abort the walk.
      if (err instanceof SmithError && err.payload.code === "permission-denied") {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`page ${id}: ${message}`);
    }
  }

  return { artifacts, warnings };
}

interface ResolveIdsOpts {
  space: string;
  pages: ConfluencePageRef[] | undefined;
  maxPages: number;
  includeChildren: boolean;
  base: string;
  headers: Record<string, string>;
  doFetch: typeof fetch;
  warnings: string[];
  /** Memoization cache of spaceKey → spaceId, scoped to one fetch call. */
  spaceIdCache: Map<string, string>;
  budget: RequestBudget;
}

async function resolvePageIds(opts: ResolveIdsOpts): Promise<string[]> {
  if (opts.pages && opts.pages.length > 0) {
    const seedIds: string[] = [];
    const titlesToResolve: string[] = [];
    for (const ref of opts.pages) {
      if (typeof ref === "object" && "id" in ref) {
        seedIds.push(String(ref.id));
      } else if (typeof ref === "string") {
        titlesToResolve.push(ref);
      }
    }
    if (titlesToResolve.length > 0) {
      const titleMap = await listSpacePagesByTitle(opts);
      for (const title of titlesToResolve) {
        const id = titleMap.get(title);
        if (!id) {
          throw new SmithError({
            code: "not-found",
            what: "Confluence page",
            identifier: `"${title}" in space ${opts.space}`,
          });
        }
        seedIds.push(id);
      }
    }
    if (!opts.includeChildren) return seedIds;
    return expandWithDescendants(seedIds, opts);
  }
  // by-space listing
  const spaceId = await resolveSpaceId(opts);
  const allUrl = `${opts.base}/wiki/api/v2/spaces/${spaceId}/pages?limit=${HARD_CEILING}`;
  const res = await atlassianFetch(allUrl, { headers: opts.headers }, opts.doFetch, {
    budget: opts.budget,
  });
  if (!res.ok) {
    throw await httpErrorFor(res, {
      service: "Confluence",
      url: allUrl,
      operation: `list pages in space ${opts.space}`,
    });
  }
  const body = (await res.json()) as { results?: Array<{ id: string; title: string }> };
  const all = body.results ?? [];
  const selected = all.slice(0, opts.maxPages);
  if (all.length > selected.length) {
    opts.warnings.push(
      `Space ${opts.space} has ${all.length} pages; fetched first ${selected.length}. ` +
        `Set \`maxPages\` (≤${HARD_CEILING}) or list \`pages\` explicitly.`,
    );
  }
  return selected.map((p) => p.id);
}

/**
 * BFS-expands the given seed IDs with their descendants via the v2 children
 * endpoint. Honors `opts.maxPages` as a hard cap on the total returned set;
 * pushes a cap-hit warning when reached, mirroring the by-space code path.
 */
async function expandWithDescendants(seedIds: string[], opts: ResolveIdsOpts): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  let capHit = false;
  const queue: string[] = [];

  function add(id: string): boolean {
    // Already seen → not a cap hit; signal "keep going" so callers don't break early.
    if (seen.has(id)) return true;
    if (out.length >= opts.maxPages) {
      capHit = true;
      return false;
    }
    seen.add(id);
    out.push(id);
    queue.push(id);
    return true;
  }

  for (const id of seedIds) {
    if (!add(id)) break;
  }

  while (queue.length > 0 && !capHit) {
    const current = queue.shift()!;
    const remaining = opts.maxPages - out.length;
    if (remaining <= 0) {
      capHit = true;
      break;
    }
    const children = await fetchChildrenOf(current, opts, remaining);
    for (const childId of children) {
      if (!add(childId)) break;
    }
  }

  if (capHit) {
    opts.warnings.push(
      `Confluence includeChildren: hit maxPages cap of ${opts.maxPages} during recursion. ` +
        `Set \`maxPages\` (≤${HARD_CEILING}) higher to fetch more descendants.`,
    );
  }
  return out;
}

async function fetchChildrenOf(
  parentId: string,
  opts: ResolveIdsOpts,
  remaining: number,
): Promise<string[]> {
  const ids: string[] = [];
  // Stop walking once we've collected enough to satisfy the BFS's remaining
  // capacity. Defends against parents with pathologically many children:
  // the caller can only consume `remaining` more ids before hitting maxPages,
  // so paging beyond that is wasted work.
  const scanLimit = Math.max(remaining, 1);
  let nextPath: string | null =
    `/wiki/api/v2/pages/${encodeURIComponent(parentId)}/children?limit=250`;
  while (nextPath && ids.length < scanLimit) {
    const url = nextPath.startsWith("http") ? nextPath : `${opts.base}${nextPath}`;
    const res = await atlassianFetch(url, { headers: opts.headers }, opts.doFetch, {
      budget: opts.budget,
    });
    if (!res.ok) {
      throw await httpErrorFor(res, {
        service: "Confluence",
        url,
        operation: `list children of ${parentId}`,
      });
    }
    const body = (await res.json()) as {
      results?: Array<{ id: string }>;
      _links?: { next?: string };
    };
    for (const r of body.results ?? []) {
      ids.push(r.id);
      if (ids.length >= scanLimit) break;
    }
    if (ids.length >= scanLimit) break;
    nextPath = body._links?.next ?? null;
  }
  return ids;
}

async function listSpacePagesByTitle(opts: ResolveIdsOpts): Promise<Map<string, string>> {
  const spaceId = await resolveSpaceId(opts);
  // Cap the total scanned pages defensively to avoid pathological loops.
  const scanLimit = Math.max(opts.maxPages * 4, 1000);
  const map = new Map<string, string>();
  let nextPath: string | null = `/wiki/api/v2/spaces/${spaceId}/pages?limit=250`;
  while (nextPath && map.size < scanLimit) {
    const url = nextPath.startsWith("http") ? nextPath : `${opts.base}${nextPath}`;
    const res = await atlassianFetch(url, { headers: opts.headers }, opts.doFetch, {
      budget: opts.budget,
    });
    if (!res.ok) {
      throw await httpErrorFor(res, {
        service: "Confluence",
        url,
        operation: `list pages in space ${opts.space}`,
      });
    }
    const body = (await res.json()) as {
      results?: Array<{ id: string; title: string }>;
      _links?: { next?: string };
    };
    for (const r of body.results ?? []) map.set(r.title, r.id);
    nextPath = body._links?.next ?? null;
  }
  return map;
}

async function resolveSpaceId(opts: ResolveIdsOpts): Promise<string> {
  const cached = opts.spaceIdCache.get(opts.space);
  if (cached) return cached;
  const url = `${opts.base}/wiki/api/v2/spaces?keys=${encodeURIComponent(opts.space)}`;
  const res = await atlassianFetch(url, { headers: opts.headers }, opts.doFetch, {
    budget: opts.budget,
  });
  if (!res.ok) {
    throw await httpErrorFor(res, {
      service: "Confluence",
      url,
      operation: `resolve space ${opts.space}`,
    });
  }
  const body = (await res.json()) as { results?: Array<{ id: string; key: string }> };
  const match = (body.results ?? []).find((s) => s.key === opts.space);
  if (!match) {
    throw new SmithError({
      code: "not-found",
      what: "Confluence space",
      identifier: opts.space,
    });
  }
  opts.spaceIdCache.set(opts.space, match.id);
  return match.id;
}
