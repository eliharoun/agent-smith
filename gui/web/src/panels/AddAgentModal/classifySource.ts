export type SourceKind = "git-url" | "archive" | "directory" | "unknown";

/**
 * Classifies a user-pasted string into one of four source kinds.
 *
 * Priority order mirrors src/io/install-source.ts isArchiveTarget semantics:
 *   1. SSH-style URLs (always git, regardless of extension) — prevents
 *      "git@host:repo.tgz" from being misrouted to archive.
 *   2. Extension check (after stripping query string and fragment) — covers
 *      both HTTP/HTTPS archive URLs and local .tgz paths.
 *   3. Scheme check — http:// and https:// without archive extension are git.
 *   4. Path shape — absolute, home-relative, or ./relative → local directory.
 *   5. Otherwise unknown.
 */
export function classifySource(s: string): SourceKind {
  const trimmed = s.trim();
  if (trimmed.length === 0) return "unknown";
  // SSH guard: scp-style "git@host:org/repo.tgz" and ssh:// URLs are always
  // git — the extension check below would otherwise misroute them.
  if (/^(ssh:\/\/|[\w._-]+@[\w.-]+:)/.test(trimmed)) return "git-url";
  // Extension second — strip query string and fragment before checking.
  const pathname = trimmed.split(/[?#]/)[0] ?? trimmed;
  if (pathname.endsWith(".smith-bundle.tgz") || pathname.endsWith(".tgz")) {
    return "archive";
  }
  // Scheme third.
  if (/^https?:\/\//.test(trimmed)) return "git-url";
  // Path-shaped local input.
  if (/^[/~]|^\.\//.test(trimmed)) return "directory";
  return "unknown";
}
