// gui/web/src/lib/remote-path.ts
//
// Hand-maintained mirror of src/io/remote-path.ts. The CLI version imports
// node:crypto + node:path; this browser version uses a tiny posix-only path
// helper plus a synchronous non-crypto hash for file:// previews.
//
// Parity is enforced by gui/web/src/lib/remote-path.test.ts. When the CLI
// changes its regex or normalization rules, this file MUST be updated or
// the parity test will fail.
//
// file:// hash divergence: the CLI uses SHA-256 (8 hex chars) for the
// `_local/<hash>-<leaf>` segment. Web Crypto's digest is async and the
// Install-from-URL modal needs a synchronous preview, so this mirror uses
// FNV-1a. The preview is cosmetic — the real on-disk path is computed
// CLI-side. The parity test asserts format only, not exact hash bytes.

const URL_PATTERNS = [/^https:\/\//i, /^git@/i, /^ssh:\/\/git@/i, /^file:\/\//i];

export function isLikelyGitUrlWeb(s: string): boolean {
  if (!s) return false;
  return URL_PATTERNS.some((p) => p.test(s));
}

export function deriveRemotePathWeb(url: string, remoteRoot: string): string {
  if (!isLikelyGitUrlWeb(url)) {
    throw new Error(`not a recognized git url: ${url}`);
  }

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
  s = s.replace(/^([^/:]+):\d+\//, "$1/");

  // SSH separator → / (after port stripping, only the SSH "host:owner" colon remains)
  s = s.replace(":", "/");

  const rawParts = s.split("/").filter(Boolean);
  if (rawParts.some((p) => p === "..")) {
    throw new Error(`url contains '..' segment: ${url}`);
  }
  if (rawParts.length < 3) {
    throw new Error(`url did not contain host/owner/repo: ${url}`);
  }

  // Option-injection guard: reject any segment starting with '-'.
  const dashPart = rawParts.find((p) => p.startsWith("-"));
  if (dashPart) {
    throw new Error(`url segment starts with '-' (option injection): ${dashPart}`);
  }

  // Lowercase the first 3 segments (host, owner, repo); preserve deeper segments.
  const normalized = rawParts.map((p, i) => (i < 3 ? p.toLowerCase() : p));

  return joinPosix(remoteRoot, ...normalized);
}

function deriveLocalPath(url: string, remoteRoot: string): string {
  const fsPath = url.replace(/^file:\/\//i, "");
  const stripped = fsPath.replace(/\.git\/?$/i, "");
  const leaf = stripped.split("/").filter(Boolean).pop() || "repo";
  const enc = new TextEncoder().encode(fsPath);
  const hash = fnv1a(enc).toString(16).padStart(8, "0").slice(0, 8);
  return joinPosix(remoteRoot, "_local", `${hash}-${leaf}`);
}

function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function joinPosix(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+/, "").replace(/\/+$/, "")))
    .filter(Boolean)
    .join("/");
}
