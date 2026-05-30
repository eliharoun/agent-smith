import { describe, expect, it } from "vitest";
import { deriveRemotePathWeb, isLikelyGitUrlWeb } from "./remote-path";

// Parity table — every example must match what the CLI version (src/io/remote-path.ts)
// produces or rejects. When the CLI changes, this table MUST be updated.
//
// Note on file:// hash divergence: the web mirror uses FNV-1a (synchronous)
// instead of SHA-256 (Web Crypto is async). The parity test for file:// only
// asserts the format (_local/<8 hex>-<leaf>), not the exact hash.
const ACCEPTED: Array<[string, string]> = [
  ["https://github.com/owner/repo.git", "github.com/owner/repo"],
  ["https://github.com/Owner/Repo.git", "github.com/owner/repo"],
  ["https://github.com:443/owner/repo.git", "github.com/owner/repo"],
  ["git@github.com:owner/repo.git", "github.com/owner/repo"],
  ["ssh://git@github.com/owner/repo.git", "github.com/owner/repo"],
];

const REJECTED: string[] = [
  "ext::sh -c whoami",
  "ftp://h/o/r.git",
  "http://h/o/r.git",
  "https://-evil/o/r.git",
  "https://h/-evil/r.git",
  "https://h/o/-evil.git",
  "git@h:-evil/r.git",
  "",
  "not-a-url",
];

describe("remote-path.ts web parity (C4.4.1)", () => {
  for (const [url, suffix] of ACCEPTED) {
    it(`accepts ${url}`, () => {
      const path = deriveRemotePathWeb(url, "/root");
      expect(path).toBe(`/root/${suffix}`);
    });
  }

  for (const url of REJECTED) {
    it(`rejects ${JSON.stringify(url)}`, () => {
      expect(() => deriveRemotePathWeb(url, "/root")).toThrow();
    });
  }

  it("file:// returns _local/<hash>-<leaf> form", () => {
    const path = deriveRemotePathWeb("file:///tmp/bare.git", "/root");
    expect(path).toMatch(/^\/root\/_local\/[0-9a-f]{8}-bare$/);
  });

  it("file:// is idempotent for same path", () => {
    const a = deriveRemotePathWeb("file:///tmp/bare.git", "/root");
    const b = deriveRemotePathWeb("file:///tmp/bare.git", "/root");
    expect(a).toBe(b);
  });

  it("file:// produces different hashes for distinct paths with same basename", () => {
    const a = deriveRemotePathWeb("file:///tmp/a/bare.git", "/root");
    const b = deriveRemotePathWeb("file:///tmp/b/bare.git", "/root");
    expect(a).not.toBe(b);
  });

  it("isLikelyGitUrlWeb agrees with deriveRemotePathWeb acceptance", () => {
    for (const [url] of ACCEPTED) expect(isLikelyGitUrlWeb(url)).toBe(true);
    // Note: isLikelyGitUrlWeb is a pattern check (recognizes scheme); deeper
    // validation happens in deriveRemotePathWeb. Empty string returns false;
    // other REJECTED entries that don't match a URL scheme also return false.
    expect(isLikelyGitUrlWeb("")).toBe(false);
    expect(isLikelyGitUrlWeb("not-a-url")).toBe(false);
    expect(isLikelyGitUrlWeb("ext::sh -c whoami")).toBe(false);
    expect(isLikelyGitUrlWeb("ftp://h/o/r.git")).toBe(false);
    expect(isLikelyGitUrlWeb("http://h/o/r.git")).toBe(false);
  });
});
