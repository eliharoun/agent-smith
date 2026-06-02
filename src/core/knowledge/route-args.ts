/**
 * Per-tool URL → tool-arguments mappers, called by the curated routing
 * registry to translate a raw URL into the shape the upstream MCP tool
 * expects. This file currently ships fallback `{ url }` stubs; real
 * pattern-matching mappers land in a follow-up change with their own
 * tests. Importers should treat the return value as opaque and pass it
 * through to `tools/call`.
 */

export function urlToConfluenceArgs(rawUrl: string): Record<string, unknown> {
  return { url: rawUrl };
}

export function urlToSharepointArgs(rawUrl: string): Record<string, unknown> {
  return { url: rawUrl };
}

export function urlToNotionArgs(rawUrl: string): Record<string, unknown> {
  return { url: rawUrl };
}

export function urlToGithubBlobArgs(rawUrl: string): Record<string, unknown> {
  return { url: rawUrl };
}
