import { SmithError } from "../smith-error";
import type { WebSource } from "./types";
import type { AcquiredArtifact } from "./acquire";
import { acquireUrl } from "./acquire";

export interface FetchedPage {
  bytes: Buffer;
  contentType?: string;
  url: string;
}
/** Injectable page fetcher; production default wraps acquireUrl. */
export type FetchPage = (url: string) => Promise<FetchedPage>;

export interface AcquireWebOpts {
  cacheDir: string;
  /** Defaults to a wrapper over acquireUrl. Tests inject an in-memory fetcher. */
  fetchPage?: FetchPage;
  onWarning?: (m: string) => void;
}

const DEFAULT_MAX_PAGES = 25;
const DEFAULT_DEPTH = 2;

function defaultFetchPage(cacheDir: string): FetchPage {
  return async (url) => {
    const arts = await acquireUrl(url, cacheDir);
    const a = arts[0];
    if (!a) throw new SmithError({ code: "network-error", operation: "fetch", url, cause: "empty response" });
    return { bytes: a.bytes, ...(a.contentType ? { contentType: a.contentType } : {}), url };
  };
}

/** POSIX relPath derived from a URL path; index/empty -> index.<ext>. */
function relPathForUrl(u: URL, ext: string): string {
  let p = u.pathname.replace(/^\/+/, "");
  if (p === "" || p.endsWith("/")) p += "index";
  if (!/\.[a-z0-9]+$/i.test(p)) p += ext;
  return p.replace(/[^a-zA-Z0-9._/-]/g, "_");
}

function extractLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  // Only follow <a> anchors — the navigable content graph. We deliberately
  // ignore `href` on <link>/<area>/<base> and similar elements: a page's <head>
  // points at stylesheets, icons, and API descriptors (RSD/EditURI, OpenSearch),
  // which are chrome and assets, not content. (Following those is what pulled
  // favicon.ico, load.php, and api.php into early Wikipedia crawls.) The `\b`
  // after `<a` keeps this from matching <area>, <abbr>, <address>, etc.
  const re = /<a\b[^>]*?\shref\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1]!, base);
      abs.hash = "";
      if (abs.protocol === "http:" || abs.protocol === "https:") out.push(abs.toString());
    } catch { /* skip malformed */ }
  }
  return out;
}

/** Content-types kept when crawling: HTML and the plain-text document family.
 *  Deliberately excludes images, fonts, CSS, JavaScript, XML, octet-stream, and
 *  other binary/asset types so non-text responses are never materialized. When
 *  a server omits the content-type we allow the page and rely on the
 *  extension skip-list to have already filtered obvious assets. */
const TEXTUAL_CONTENT_TYPE =
  /^(?:text\/html|application\/xhtml\+xml|text\/markdown|text\/plain|application\/json)\b/i;

function isTextualContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return true;
  return TEXTUAL_CONTENT_TYPE.test(contentType);
}

/** Path extensions that are never document content. Links ending in one of
 *  these are skipped before fetching, so a crawl neither wastes requests on
 *  assets nor chokes on binaries (and PDFs/office docs, which have no text
 *  materializer yet). JSON is intentionally absent — it is kept by the
 *  content-type gate when reached through a real anchor. */
const SKIP_LINK_EXTENSIONS = new Set<string>([
  // styles & scripts
  "css", "js", "mjs", "cjs", "map",
  // images
  "ico", "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif", "tiff",
  // fonts
  "woff", "woff2", "ttf", "otf", "eot",
  // audio / video
  "mp4", "webm", "mov", "avi", "mkv", "mp3", "wav", "ogg", "flac",
  // archives & binaries
  "zip", "gz", "tgz", "tar", "rar", "7z", "bz2", "xz", "dmg", "exe", "bin",
  // documents with no text materializer today
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
]);

function hasSkippableExtension(pathname: string): boolean {
  const m = /\.([a-z0-9]+)$/i.exec(pathname);
  return m !== null && SKIP_LINK_EXTENSIONS.has(m[1]!.toLowerCase());
}

function matchesGlobish(path: string, patterns: string[]): boolean {
  return patterns.some((pat) => {
    const body = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
    const rx = new RegExp("^" + body.replace(/(\.\*\/?)+/g, ".*") + "$");
    return rx.test(path) || rx.test("/" + path.replace(/^\//, ""));
  });
}

/** Disambiguate a relPath within a single run, appending -2, -3 etc on collision. */
function dedupeRelPath(relPath: string, used: Map<string, number>): string {
  const count = used.get(relPath);
  if (count === undefined) { used.set(relPath, 1); return relPath; }
  used.set(relPath, count + 1);
  const dot = relPath.lastIndexOf(".");
  if (dot === -1) return `${relPath}-${count + 1}`;
  return `${relPath.slice(0, dot)}-${count + 1}${relPath.slice(dot)}`;
}

export async function acquireWeb(
  src: WebSource,
  opts: AcquireWebOpts,
): Promise<{ artifacts: AcquiredArtifact[]; warnings: string[] }> {
  const warnings: string[] = [];
  const warn = (m: string) => { warnings.push(m); opts.onWarning?.(m); };
  const fetchPage = opts.fetchPage ?? defaultFetchPage(opts.cacheDir);

  if (src.mode === "crawl") {
    const artifacts = await crawl(src, fetchPage, warn);
    return { artifacts, warnings };
  }
  if (src.mode === "llms-txt") {
    const artifacts = await llmsTxt(src, fetchPage, warn);
    return { artifacts, warnings };
  }
  return { artifacts: [await openapi(src, fetchPage)], warnings };
}

async function crawl(src: WebSource, fetchPage: FetchPage, warn: (m: string) => void): Promise<AcquiredArtifact[]> {
  const maxPages = src.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = src.depth ?? DEFAULT_DEPTH;
  const sameOrigin = src.sameOrigin ?? true;
  const seed = new URL(src.url);
  const seen = new Set<string>([seed.toString()]);
  const queue: { url: string; depth: number }[] = [{ url: seed.toString(), depth: 0 }];
  const out: AcquiredArtifact[] = [];
  const usedRelPaths = new Map<string, number>();

  while (queue.length > 0 && out.length < maxPages) {
    const { url, depth } = queue.shift()!;
    const u = new URL(url);
    const isSeed = url === seed.toString();
    if (!isSeed) {
      if (src.exclude && matchesGlobish(u.pathname, src.exclude)) continue;
      if (src.include && !matchesGlobish(u.pathname, src.include)) continue;
    }
    let page: FetchedPage;
    try {
      page = await fetchPage(url);
    } catch (err) {
      warn(`web crawl: skipped ${url} (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    // Content-type gate: keep only textual documents. A non-textual response
    // (image, font, stylesheet, binary) is dropped here rather than written to
    // disk as garbage, and we do not extract links from it.
    if (!isTextualContentType(page.contentType)) {
      warn(`web crawl: skipped ${url} (non-textual content-type: ${page.contentType ?? "unknown"})`);
      continue;
    }
    const rp = dedupeRelPath(relPathForUrl(u, ".html"), usedRelPaths);
    out.push({
      filename: rp,
      relPath: rp,
      bytes: page.bytes,
      ...(page.contentType ? { contentType: page.contentType } : {}),
      sourceUrl: url,
    });
    if (depth >= maxDepth) continue;
    const html = page.bytes.toString("utf8");
    for (const link of extractLinks(html, u)) {
      const lu = new URL(link);
      if (sameOrigin && lu.origin !== seed.origin) continue;
      // Skip obvious assets/binaries by extension before spending a request.
      if (hasSkippableExtension(lu.pathname)) continue;
      if (seen.has(link)) continue;
      seen.add(link);
      queue.push({ url: link, depth: depth + 1 });
    }
  }
  return out;
}

async function llmsTxt(src: WebSource, fetchPage: FetchPage, warn: (m: string) => void): Promise<AcquiredArtifact[]> {
  const maxPages = src.maxPages ?? DEFAULT_MAX_PAGES;
  let manifest: FetchedPage;
  try {
    manifest = await fetchPage(src.url);
  } catch (err) {
    throw new SmithError({ code: "network-error", operation: "fetch", url: src.url, cause: err instanceof Error ? err.message : String(err) });
  }
  const text = manifest.bytes.toString("utf8");
  const base = new URL(src.url);
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && links.length < maxPages) {
    try {
      const abs = new URL(m[1]!.trim(), base);
      if (abs.protocol === "http:" || abs.protocol === "https:") links.push(abs.toString());
    } catch { /* skip */ }
  }
  if (links.length === 0) {
    throw new SmithError({
      code: "validation-failed",
      what: `llms.txt at ${src.url}`,
      reasons: ["no markdown links found — is this a valid llms.txt manifest?"],
    });
  }
  const out: AcquiredArtifact[] = [{
    filename: "llms.txt", relPath: "llms.txt", bytes: manifest.bytes,
    ...(manifest.contentType ? { contentType: manifest.contentType } : {}), sourceUrl: src.url,
  }];
  const usedRelPaths = new Map<string, number>([["llms.txt", 1]]);
  for (const link of links) {
    try {
      const p = await fetchPage(link);
      const u = new URL(link);
      const rp = dedupeRelPath(relPathForUrl(u, ".md"), usedRelPaths);
      out.push({
        filename: rp, relPath: rp, bytes: p.bytes,
        ...(p.contentType ? { contentType: p.contentType } : {}), sourceUrl: link,
      });
    } catch (err) {
      warn(`llms.txt: skipped ${link} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return out;
}

async function openapi(src: WebSource, fetchPage: FetchPage): Promise<AcquiredArtifact> {
  let page: FetchedPage;
  try {
    page = await fetchPage(src.url);
  } catch (err) {
    throw new SmithError({ code: "network-error", operation: "fetch", url: src.url, cause: err instanceof Error ? err.message : String(err) });
  }
  const raw = page.bytes.toString("utf8");
  let spec: unknown;
  try {
    spec = JSON.parse(raw);
  } catch {
    const { load } = await import("js-yaml");
    try {
      spec = load(raw);
    } catch (err) {
      throw new SmithError({
        code: "validation-failed",
        what: `OpenAPI spec at ${src.url}`,
        reasons: [`could not parse as JSON or YAML: ${err instanceof Error ? err.message : String(err)}`],
      });
    }
  }
  const md = renderOpenApiMarkdown(spec);
  const bytes = Buffer.from(md, "utf8");
  return { filename: "openapi.md", relPath: "openapi.md", bytes, contentType: "text/markdown", sourceUrl: src.url };
}

function renderOpenApiMarkdown(spec: unknown): string {
  const s = (spec ?? {}) as { info?: { title?: string; version?: string }; paths?: Record<string, Record<string, { summary?: string }>> };
  const lines: string[] = [];
  lines.push(`# ${s.info?.title ?? "OpenAPI"}${s.info?.version ? ` (v${s.info.version})` : ""}`, "");
  const paths = s.paths ?? {};
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      lines.push(`## ${method.toUpperCase()} ${path}`);
      if (op?.summary) lines.push(op.summary);
      lines.push("");
    }
  }
  return lines.join("\n");
}
