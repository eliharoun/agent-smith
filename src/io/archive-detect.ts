const ARCHIVE_SUFFIXES = [".smith-bundle.tgz", ".tgz"];

/**
 * Returns true when `s` is either a local path or an https URL whose path
 * ends in `.smith-bundle.tgz` or `.tgz`. http:// URLs are rejected to keep
 * artifact transport on a TLS channel.
 *
 * Runs BEFORE the git-URL gate in the install pipeline. A git URL whose
 * path happens to end in `.tgz` is vanishingly unlikely; if a real one
 * shows up we'll add a more specific discriminator at that point.
 */
export function isArchiveTarget(s: string): boolean {
  if (s.length === 0) return false;
  if (s.startsWith("http://")) return false;
  // Reject SSH-style git URLs (user@host:path or ssh:// scheme) so that
  // a git remote whose path happens to end in .tgz is not misrouted to the
  // archive importer.
  if (/^[\w._-]+@[\w.-]+:/.test(s)) return false;
  if (s.startsWith("ssh://")) return false;
  let pathPart = s;
  if (s.startsWith("https://")) {
    try {
      pathPart = new URL(s).pathname;
    } catch {
      return false;
    }
  }
  const q = pathPart.indexOf("?");
  if (q >= 0) pathPart = pathPart.slice(0, q);
  const h = pathPart.indexOf("#");
  if (h >= 0) pathPart = pathPart.slice(0, h);
  return ARCHIVE_SUFFIXES.some((sfx) => pathPart.endsWith(sfx));
}
