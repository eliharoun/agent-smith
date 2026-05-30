// gui/shared/src/git-url.ts
//
// Normalize a git remote URL to a canonical string form for equality
// checks. Mirror of `src/io/git-url.ts` in the root package. Both
// implementations MUST agree on output for any URL — that's enforced
// by the parity test in this directory's test suite.
//
// Two distinct copies are intentional: gui/server is a separate Bun
// workspace and never imports from root `src/`. Other shared logic in
// this codebase follows the same pattern (verifyGitRemote in CLI vs
// gui/server). When rules change here, mirror them in
// `src/io/git-url.ts` and re-run the parity fixture.
//
// Rules (mirror src/io/remote-path.ts:deriveRemotePath equality
// behavior so duplicate-URL detection agrees with on-disk path
// derivation):
//   - strip scheme (https://, git@, ssh://git@)
//   - SSH colon separator → `/`
//   - strip trailing `.git`, trailing `/`
//   - lowercase host/owner/repo (first 3 segments only; deeper
//     segments preserve case)

const SCHEME_HTTPS = /^https:\/\//i;
const SCHEME_SSH_PROTO = /^ssh:\/\/git@/i;
const SCHEME_SSH_SHORT = /^git@/i;
const TRAILING_GIT = /\.git\/?$/i;
const TRAILING_SLASH = /\/+$/;

export function normalizeGitUrl(url: string): string {
  let s = url.trim();
  s = s.replace(SCHEME_SSH_PROTO, "");
  s = s.replace(SCHEME_HTTPS, "");
  s = s.replace(SCHEME_SSH_SHORT, "");
  s = s.replace(TRAILING_GIT, "");
  s = s.replace(TRAILING_SLASH, "");
  // SSH `host:owner/repo` → `host/owner/repo`. Only the first colon
  // counts; port-bearing forms (host:1234/path) are uncommon for
  // cloneable URLs.
  s = s.replace(":", "/");
  // Lowercase only the first 3 segments (host/owner/repo); deeper
  // segments preserved verbatim to match deriveRemotePath behavior.
  const parts = s.split("/");
  const lowered = parts.map((p, i) => (i < 3 ? p.toLowerCase() : p));
  return lowered.join("/");
}

export function sameGitRemote(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeGitUrl(a) === normalizeGitUrl(b);
}
