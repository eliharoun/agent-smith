import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `which` itself lives at /usr/bin/which on macOS/Linux. We want to
// neutralize PATH for smith but keep enough for `which` to load. The
// resolver's fromWhich step uses execFileSync("which", ...) which finds
// the binary via execvp — that lookup honours the child's PATH. Setting
// PATH to a dir without `which` makes the spawn ENOENT, which is fine —
// fromWhich returns undefined on any failure.
const PATH_WITHOUT_SMITH = "/usr/bin:/bin";
import {
  __resetSmithPathCacheForTests,
  resolveSmithPath,
  resolveSmithPathOrUndefined,
} from "./resolve-smith-path";

let root: string;
let savedArgv1: string;
let savedHome: string | undefined;
let savedPath: string | undefined;
let savedSmithBin: string | undefined;

function makeExecutable(path: string, body = "#!/bin/sh\nexit 0\n"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

beforeEach(async () => {
  // Canonicalize: macOS resolves /tmp -> /private/tmp via realpath, and the
  // resolver uses realpathSync, so assertions need the realpath'd form too.
  root = realpathSync(await mkdtemp(join(tmpdir(), "resolve-smith-")));
  savedArgv1 = process.argv[1] ?? "";
  savedHome = process.env.HOME;
  savedPath = process.env.PATH;
  savedSmithBin = process.env.SMITH_BIN;
  // Tests in this file exercise the discovery priority path. Other test
  // files (mcp-config.test.ts, mcp.test.ts) set SMITH_BIN as a stub; clear
  // it here so resolver discovery is what's under test.
  delete process.env.SMITH_BIN;
  __resetSmithPathCacheForTests();
});

afterEach(async () => {
  process.argv[1] = savedArgv1;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
  if (savedSmithBin === undefined) delete process.env.SMITH_BIN;
  else process.env.SMITH_BIN = savedSmithBin;
  __resetSmithPathCacheForTests();
  await rm(root, { recursive: true, force: true });
});

describe("resolveSmithPath", () => {
  it("honours SMITH_BIN env override when it points at a real executable (test/packaging escape hatch)", () => {
    const target = join(root, "explicit", "smith");
    makeExecutable(target);
    process.env.SMITH_BIN = target;
    process.argv[1] = "/does-not-exist";
    process.env.HOME = root;
    process.env.PATH = PATH_WITHOUT_SMITH;

    expect(resolveSmithPath()).toBe(target);
  });

  it("ignores SMITH_BIN when it doesn't resolve to an executable, falling through to discovery", () => {
    process.env.SMITH_BIN = "/path/that/does/not/exist";
    const fallback = join(root, ".local", "bin", "smith");
    makeExecutable(fallback);
    process.argv[1] = "/does-not-exist";
    process.env.HOME = root;
    process.env.PATH = PATH_WITHOUT_SMITH;

    expect(resolveSmithPath()).toBe(fallback);
  });

  it("returns argv[1] realpath when argv[1] points at an executable named `smith`", () => {
    const target = join(root, "real-bin", "smith");
    makeExecutable(target);
    // Symlink so we can verify realpath resolution.
    const linkDir = join(root, "link-bin");
    mkdirSync(linkDir, { recursive: true });
    const link = join(linkDir, "smith");
    symlinkSync(target, link);
    process.argv[1] = link;
    // Take HOME / PATH out so fallbacks would fail.
    process.env.HOME = root;
    process.env.PATH = PATH_WITHOUT_SMITH;

    const resolved = resolveSmithPath();
    expect(resolved).toBe(target);
    expect(resolved.startsWith("/")).toBe(true);
  });

  it("falls back to ~/.local/bin/smith when argv[1] is not a smith binary", () => {
    process.argv[1] = "/path/to/something/that/does-not-exist";
    process.env.HOME = root;
    process.env.PATH = PATH_WITHOUT_SMITH;
    const target = join(root, ".local", "bin", "smith");
    makeExecutable(target);

    const resolved = resolveSmithPath();
    expect(resolved).toBe(target);
  });

  it("falls back to `which smith` when argv[1] and ~/.local/bin/smith are unavailable", () => {
    process.argv[1] = "/path/to/something/that/does-not-exist";
    process.env.HOME = root; // no ~/.local/bin/smith here
    const onPathDir = join(root, "onpath");
    const target = join(onPathDir, "smith");
    makeExecutable(target);
    // Prepend onPathDir so `which smith` finds our shim, but keep
    // /usr/bin:/bin so the `which` binary itself is locatable.
    process.env.PATH = `${onPathDir}:${PATH_WITHOUT_SMITH}`;

    const resolved = resolveSmithPath();
    expect(resolved).toBe(target);
  });

  it("throws SmithError(not-found) when no candidate resolves", () => {
    process.argv[1] = "/path/to/something/that/does-not-exist";
    process.env.HOME = root; // no ~/.local/bin/smith
    process.env.PATH = PATH_WITHOUT_SMITH;

    let caught: unknown;
    try {
      resolveSmithPath();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).name).toBe("SmithError");
    // payload.code === "not-found"
    expect((caught as { payload: { code: string } }).payload.code).toBe("not-found");
  });

  it("caches the resolution across calls (second call doesn't re-stat)", () => {
    const target = join(root, ".local", "bin", "smith");
    makeExecutable(target);
    process.argv[1] = "/does-not-exist";
    process.env.HOME = root;
    process.env.PATH = PATH_WITHOUT_SMITH;

    const first = resolveSmithPath();
    // Now delete the file. If the resolver weren't caching, the second
    // call would throw because no candidate resolves anymore.
    rm(target, { force: true });
    // We don't await the rm — but synchronously, even if it had completed,
    // the cache should still satisfy the second call.
    const second = resolveSmithPath();
    expect(second).toBe(first);
  });
});

describe("resolveSmithPathOrUndefined", () => {
  it("returns undefined instead of throwing when no candidate resolves", () => {
    process.argv[1] = "/path/to/something/that/does-not-exist";
    process.env.HOME = root;
    process.env.PATH = PATH_WITHOUT_SMITH;

    const result = resolveSmithPathOrUndefined();
    expect(result).toBeUndefined();
  });

  it("returns the resolved path when one is available", () => {
    const target = join(root, ".local", "bin", "smith");
    makeExecutable(target);
    process.argv[1] = "/does-not-exist";
    process.env.HOME = root;
    process.env.PATH = PATH_WITHOUT_SMITH;

    const result = resolveSmithPathOrUndefined();
    expect(result).toBe(target);
  });
});
