/**
 * Per-tool URL → tool-arguments mappers, called by the curated routing
 * registry to translate a raw URL into the shape the upstream MCP tool
 * expects. Each mapper falls back to `{ url: rawUrl }` when the path
 * shape is unrecognized so callers can still attempt a URL-shaped
 * fetch. Importers should treat the return value as opaque and pass it
 * through to `tools/call`.
 */

export function urlToConfluenceArgs(rawUrl: string): Record<string, unknown> {
  const m = rawUrl.match(/\/wiki\/spaces\/([^/]+)\/pages\/(\d+)/);
  return m ? { spaceKey: m[1]!, pageId: m[2]! } : { url: rawUrl };
}

export function urlToSharepointArgs(rawUrl: string): Record<string, unknown> {
  return { url: rawUrl };
}

export function urlToNotionArgs(rawUrl: string): Record<string, unknown> {
  const tail = rawUrl.split("-").pop() ?? "";
  const id = tail.replace(/[^a-f0-9]/gi, "");
  return id.length >= 16 ? { pageId: id } : { url: rawUrl };
}

export function urlToGithubBlobArgs(rawUrl: string): Record<string, unknown> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { url: rawUrl }; }
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  return m ? { owner: m[1]!, repo: m[2]!, ref: m[3]!, path: m[4]! } : { url: rawUrl };
}
