// src/io/git-url.ts
//
// Pure helpers for comparing git remote URLs across the codebase. Two
// public functions:
//
//   normalizeGitUrl(url)    — canonical string form for equality checks
//   sameGitRemote(a, b)     — boolean: "do these point to the same repo?"
//
// Consumers (rc.4 — consolidated):
//   - install-from-url duplicate-URL hard-error guard (checkDuplicateUrl)
//   - install-from-url collision check vs .git/config origin (checkCollision)
//   - register --git-remote duplicate-URL warning
//   - doctor duplicate-catalogs cluster detection
//   - cli/registry-validation.ts verifyGitRemote (CLI git remote -v matcher)
//
// Sibling implementation: gui/shared/src/git-url.ts holds a byte-
// identical copy used by gui/server (separate Bun workspace, can't
// import from root src/). Both are exercised by parity fixtures in
// the two test suites — drift between them surfaces immediately.
//
// Design contract: `sameGitRemote(a, b)` MUST agree with
// `deriveRemotePath(a, root) === deriveRemotePath(b, root)`. This is
// asserted by a property test in tests/io/git-url.test.ts. If you
// change either side, update both — they encode the same notion of
// "same repo".

const SCHEME_HTTPS = /^https:\/\//i;
const SCHEME_SSH_PROTO = /^ssh:\/\/git@/i;
const SCHEME_SSH_SHORT = /^git@/i;
const TRAILING_GIT = /\.git\/?$/i;
const TRAILING_SLASH = /\/+$/;

/**
 * Normalize a git URL to a canonical string. The exact string is an
 * implementation detail — only equality matters. Rules mirror
 * `deriveRemotePath`:
 *   - strip scheme (https://, git@, ssh://git@)
 *   - SSH colon separator → `/`
 *   - strip trailing `.git`, trailing `/`
 *   - lowercase host/owner/repo (first 3 segments)
 *
 * Non-URL inputs (no recognized scheme) are returned lowercased+trimmed
 * as a best-effort; equality between two such strings is a literal
 * comparison.
 */
export function normalizeGitUrl(url: string): string {
  let s = url.trim();
  s = s.replace(SCHEME_SSH_PROTO, "");
  s = s.replace(SCHEME_HTTPS, "");
  s = s.replace(SCHEME_SSH_SHORT, "");
  s = s.replace(TRAILING_GIT, "");
  s = s.replace(TRAILING_SLASH, "");
  // SSH `host:owner/repo` → `host/owner/repo`. Only the first colon counts;
  // port-bearing forms (host:1234/path) are uncommon for cloneable URLs.
  s = s.replace(":", "/");
  // Lowercase only the first 3 segments (host/owner/repo); deeper segments
  // preserved verbatim to match deriveRemotePath behavior.
  const parts = s.split("/");
  const lowered = parts.map((p, i) => (i < 3 ? p.toLowerCase() : p));
  return lowered.join("/");
}

/**
 * Return true iff `a` and `b` point to the same git repo per
 * `normalizeGitUrl`. Either side `undefined` → false (a missing remote
 * cannot be "same as" anything, including another missing remote — that's
 * a "linked" catalog with no URL identity).
 */
export function sameGitRemote(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeGitUrl(a) === normalizeGitUrl(b);
}
