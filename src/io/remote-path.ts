// src/io/remote-path.ts
//
// Normalize an external git URL into a deterministic on-disk path under
// remoteRoot, used by C-series external-repo install. Pure function; no IO.
//
// Rules:
//   1. Accept only https://, git@host:, ssh://git@host, file:// (no plain http,
//      no ext::, no smart transports).
//   2. Strip trailing .git
//   3. Replace ':' separator (SSH form) with '/'
//   4. Strip port (:1234)
//   5. Lowercase host + owner + repo segments
//   6. Reject any segment that starts with '-' (git option-injection guard).
//   7. Defense-in-depth path-segment containment check against '..' injection
//
// Real assertWithin() (async, realpath-based) is invoked at the actual
// filesystem write site later in the install flow; this synchronous check
// covers the URL-normalization step where the target doesn't yet exist.
//
// file:// special case (C3.8 fixture-driven E2E support):
//   `file:///abs/path/to/bare.git` has no host/owner/repo triple, so it's
//   normalized to `<remoteRoot>/_local/<8-char-hash>-<basename>`. The hash
//   is derived from the absolute filesystem path so the same URL is always
//   idempotent, while two distinct local repos with identical basenames
//   don't collide. The `_local/` prefix keeps these clearly separated from
//   real remote URLs in directory listings. Intended primarily for tests;
//   production use is allowed but unusual.

import { createHash } from "node:crypto";
import { basename, resolve, sep } from "node:path";

const URL_PATTERNS = [/^https:\/\//i, /^git@/i, /^ssh:\/\/git@/i, /^file:\/\//i];

export function isLikelyGitUrl(s: string): boolean {
  if (!s) return false;
  return URL_PATTERNS.some((p) => p.test(s));
}

export function deriveRemotePath(url: string, remoteRoot: string): string {
  if (!isLikelyGitUrl(url)) {
    throw new Error(`not a recognized git url: ${url}`);
  }

  // file:// → _local/<hash>-<basename>
  if (/^file:\/\//i.test(url)) {
    return deriveLocalPath(url, remoteRoot);
  }

  let s = url;
  // Strip protocol forms in this order: ssh://git@host, git@host, https://
  s = s.replace(/^ssh:\/\/git@/i, "");
  s = s.replace(/^git@/i, "");
  s = s.replace(/^https:\/\//i, "");

  // Strip trailing .git
  s = s.replace(/\.git\/?$/i, "");

  // Strip port BEFORE SSH separator rewrite so host:port/path becomes host/path
  // (not host/port/path).
  s = s.replace(/^([^/:]+):\d+\//, "$1/");

  // SSH separator → / (after port stripping, only the SSH "host:owner" colon remains)
  s = s.replace(":", "/");

  // Reject '..' segments before they can escape via path.resolve.
  const rawParts = s.split("/").filter(Boolean);
  if (rawParts.some((p) => p === "..")) {
    throw new Error(`url contains '..' segment: ${url}`);
  }
  if (rawParts.length < 3) {
    throw new Error(`url did not contain host/owner/repo: ${url}`);
  }

  // Option-injection guard: reject any segment starting with '-'. Git treats
  // leading-dash arguments as flags, so a hostile URL like https://-evil/o/r
  // or git@h:-evil/r could be smuggled into a later `git clone <url>` call.
  const dashPart = rawParts.find((p) => p.startsWith("-"));
  if (dashPart) {
    throw new Error(`url segment starts with '-' (option injection): ${dashPart}`);
  }

  // Lowercase the first 3 segments (host, owner, repo); preserve deeper
  // path segments verbatim.
  const normalizedParts = rawParts.map((p, idx) => (idx < 3 ? p.toLowerCase() : p));

  const resolvedRoot = resolve(remoteRoot);
  const candidate = resolve(resolvedRoot, ...normalizedParts);

  // Defense-in-depth: segment-aware containment check.
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (candidate !== resolvedRoot && !candidate.startsWith(rootWithSep)) {
    throw new Error(`derived path escapes remoteRoot: ${candidate} not within ${resolvedRoot}`);
  }

  return candidate;
}

function deriveLocalPath(url: string, remoteRoot: string): string {
  // Strip file:// prefix; the remainder is an absolute filesystem path.
  const fsPath = url.replace(/^file:\/\//i, "");
  // Strip trailing .git/ for cleaner basenames in directory listings.
  const stripped = fsPath.replace(/\.git\/?$/i, "");
  const leaf = basename(stripped) || "repo";
  // 8 hex chars of SHA-256 over the absolute path keeps it short while
  // making same-URL idempotent and different-URL collision-free.
  const hash = createHash("sha256").update(fsPath).digest("hex").slice(0, 8);
  const resolvedRoot = resolve(remoteRoot);
  const candidate = resolve(resolvedRoot, "_local", `${hash}-${leaf}`);

  // Containment check (same defense-in-depth as the URL branch).
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (!candidate.startsWith(rootWithSep)) {
    throw new Error(`derived path escapes remoteRoot: ${candidate} not within ${resolvedRoot}`);
  }
  return candidate;
}
