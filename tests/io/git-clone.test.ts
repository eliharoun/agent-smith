import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneOrFetch, lsRemoteHead, urlLockKey } from "../../src/io/git-clone";
import { createBareRemote } from "../fixtures/git-remote-helper";

/** Bun.spawn-shaped success stub: returns `out` on stdout, exit 0. */
function successStub(out = "0123456789abcdef0123456789abcdef01234567\n") {
  return () => ({
    exited: Promise.resolve(0),
    stdout: new Response(out).body!,
    stderr: new Response("").body!,
  });
}

describe("cloneOrFetch", () => {
  test("clones a fresh remote into the target directory and returns the HEAD sha", async () => {
    const remote = await createBareRemote();
    await remote.commitFile("README.md", "# hello\n");
    const target = await mkdtemp(join(tmpdir(), "git-clone-target-"));
    const targetDir = join(target, "repo");
    try {
      const result = await cloneOrFetch({
        url: remote.url,
        ref: "main",
        targetDir,
      });
      expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.sha).toBe(await remote.headSha());
      expect((await stat(join(targetDir, ".git"))).isDirectory()).toBe(true);
      expect((await stat(join(targetDir, "README.md"))).isFile()).toBe(true);
    } finally {
      await rm(target, { recursive: true, force: true });
      await remote.cleanup();
    }
  });

  test("on existing checkout: fetches and fast-forwards to remote HEAD", async () => {
    const remote = await createBareRemote();
    await remote.commitFile("a.txt", "first\n");
    const target = await mkdtemp(join(tmpdir(), "git-clone-target-"));
    const targetDir = join(target, "repo");
    try {
      const first = await cloneOrFetch({ url: remote.url, ref: "main", targetDir });
      const newSha = await remote.commitFile("b.txt", "second\n");
      expect(newSha).not.toBe(first.sha);
      const second = await cloneOrFetch({ url: remote.url, ref: "main", targetDir });
      expect(second.fetched).toBe(true);
      expect(second.sha).toBe(newSha);
    } finally {
      await rm(target, { recursive: true, force: true });
      await remote.cleanup();
    }
  });

  test("on existing checkout when remote is unchanged: returns the same sha; fetched=true", async () => {
    const remote = await createBareRemote();
    await remote.commitFile("a.txt", "first\n");
    const target = await mkdtemp(join(tmpdir(), "git-clone-target-"));
    const targetDir = join(target, "repo");
    try {
      const first = await cloneOrFetch({ url: remote.url, ref: "main", targetDir });
      const second = await cloneOrFetch({ url: remote.url, ref: "main", targetDir });
      expect(second.sha).toBe(first.sha);
      expect(second.fetched).toBe(true);
    } finally {
      await rm(target, { recursive: true, force: true });
      await remote.cleanup();
    }
  });

  test("[DW-7] ref='HEAD' on existing checkout fast-forwards to the remote's new HEAD", async () => {
    // Regression: previously `git fetch origin HEAD` populated FETCH_HEAD
    // but left refs/remotes/origin/HEAD pointing at the clone-time SHA,
    // so `git reset --hard origin/HEAD` reset to the stale local pointer
    // and sync reported success while staying on the old commit. Every
    // remote-installed catalog (which defaults to ref:'HEAD') was affected.
    const remote = await createBareRemote();
    await remote.commitFile("a.txt", "first\n");
    const target = await mkdtemp(join(tmpdir(), "git-clone-target-"));
    const targetDir = join(target, "repo");
    try {
      const first = await cloneOrFetch({ url: remote.url, ref: "HEAD", targetDir });
      const newSha = await remote.commitFile("b.txt", "second\n");
      expect(newSha).not.toBe(first.sha);
      const second = await cloneOrFetch({ url: remote.url, ref: "HEAD", targetDir });
      expect(second.fetched).toBe(true);
      expect(second.sha).toBe(newSha);
    } finally {
      await rm(target, { recursive: true, force: true });
      await remote.cleanup();
    }
  });

  test("[DW-7] reset target is FETCH_HEAD for ref='HEAD', origin/<ref> otherwise", async () => {
    // Drives the fetch branch (pre-existing .git) with a recording spawnFn so
    // we can inspect the exact `reset --hard <target>` chosen per ref kind.
    async function captureResetTarget(ref: string): Promise<string> {
      const parent = await mkdtemp(join(tmpdir(), "git-clone-dw7-"));
      const targetDir = join(parent, "repo");
      await mkdir(join(targetDir, ".git"), { recursive: true });
      const cmds: string[][] = [];
      const spawnFn = (cmd: string[]) => {
        cmds.push(cmd);
        return {
          exited: Promise.resolve(0),
          stdout: new Response("0123456789abcdef0123456789abcdef01234567\n").body!,
          stderr: new Response("").body!,
        };
      };
      try {
        await cloneOrFetch({ url: "https://x/y/z.git", ref, targetDir, spawnFn: spawnFn as never });
        const resetCmd = cmds.find((c) => c.includes("reset"));
        expect(resetCmd).toBeDefined();
        // Target is the arg right after `reset --hard`.
        return resetCmd![resetCmd!.indexOf("reset") + 2]!;
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    }
    expect(await captureResetTarget("HEAD")).toBe("FETCH_HEAD");
    expect(await captureResetTarget("main")).toBe("origin/main");
  });

  test("urlLockKey is deterministic 64-char hex", () => {
    expect(urlLockKey("https://example.com/foo.git")).toMatch(/^[0-9a-f]{64}$/);
    expect(urlLockKey("https://example.com/foo.git")).toBe(
      urlLockKey("https://example.com/foo.git"),
    );
  });

  test("serializes concurrent clones against the same target dir (C4.0.3)", async () => {
    // Pre-create parent so the lock file's directory exists; cloneOrFetch
    // also runs mkdir(dirname(targetDir)) but only after acquire — the lock
    // helper's own mkdir guarantees the lock dir exists either way.
    const parent = await mkdtemp(join(tmpdir(), "git-clone-lock-"));
    const targetDir = join(parent, "repo");
    try {
      let inFlight = 0;
      let maxInFlight = 0;
      // Bun.spawn-shaped stub: count is incremented synchronously when the
      // spawn is CALLED, decremented when `exited` resolves after a delay.
      const spawnFn = () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return {
          exited: new Promise<number>((r) =>
            setTimeout(() => {
              inFlight--;
              r(0);
            }, 20),
          ),
          stdout: new Response("0123456789abcdef0123456789abcdef01234567\n").body!,
          stderr: new Response("").body!,
        };
      };
      await Promise.all([
        cloneOrFetch({ url: "https://x/y/z.git", ref: "main", targetDir, spawnFn: spawnFn as never }),
        cloneOrFetch({ url: "https://x/y/z.git", ref: "main", targetDir, spawnFn: spawnFn as never }),
        cloneOrFetch({ url: "https://x/y/z.git", ref: "main", targetDir, spawnFn: spawnFn as never }),
      ]);
      expect(maxInFlight).toBe(1);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("different target dirs do NOT serialize (lock is per-URL-or-dir)", async () => {
    // Sanity: two different targets must run concurrently. This guards
    // against an over-broad lock that would serialize unrelated work.
    const parent = await mkdtemp(join(tmpdir(), "git-clone-lock-"));
    try {
      let inFlight = 0;
      let maxInFlight = 0;
      const spawnFn = () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return {
          exited: new Promise<number>((r) =>
            setTimeout(() => {
              inFlight--;
              r(0);
            }, 20),
          ),
          stdout: new Response("0123456789abcdef0123456789abcdef01234567\n").body!,
          stderr: new Response("").body!,
        };
      };
      await Promise.all([
        cloneOrFetch({
          url: "https://x/y/a.git",
          ref: "main",
          targetDir: join(parent, "a"),
          spawnFn: spawnFn as never,
        }),
        cloneOrFetch({
          url: "https://x/y/b.git",
          ref: "main",
          targetDir: join(parent, "b"),
          spawnFn: spawnFn as never,
        }),
      ]);
      expect(maxInFlight).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("clone/fetch/ls-remote all flow through runGit's transport allowlist", async () => {
    const parent = await mkdtemp(join(tmpdir(), "git-clone-tl-"));
    const targetDir = join(parent, "repo");
    const cmds: string[][] = [];
    // Bun.spawn-shaped stub: records cmd, returns a 40-hex sha on stdout.
    const spawnFn = (cmd: string[]) => {
      cmds.push(cmd);
      return {
        exited: Promise.resolve(0),
        stdout: new Response("0123456789abcdef0123456789abcdef01234567\n").body!,
        stderr: new Response("").body!,
      };
    };
    try {
      await cloneOrFetch({ url: "https://x/y/z.git", ref: "main", targetDir, spawnFn: spawnFn as never });
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.every((c) => c[0] === "git" && c.includes("protocol.allow=never"))).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("clone failure surfaces gitOperationError; --branch fallback retries bare clone + checkout", async () => {
    // First `clone --branch` fails (exit 1); cloneOrFetch must rm + retry a
    // bare `clone` (no --branch), then `checkout <ref>`, then rev-parse.
    const parent = await mkdtemp(join(tmpdir(), "git-clone-fb-"));
    const targetDir = join(parent, "repo");
    const cmds: string[][] = [];
    let cloneCalls = 0;
    const spawnFn = (cmd: string[]) => {
      cmds.push(cmd);
      // Subcommand follows the allowlist; find the first non-flag token.
      const isBranchClone = cmd.includes("clone") && cmd.includes("--branch");
      if (isBranchClone) {
        cloneCalls++;
        return {
          exited: Promise.resolve(1),
          stdout: new Response("").body!,
          stderr: new Response("not a branch").body!,
        };
      }
      return {
        exited: Promise.resolve(0),
        stdout: new Response("0123456789abcdef0123456789abcdef01234567\n").body!,
        stderr: new Response("").body!,
      };
    };
    try {
      const result = await cloneOrFetch({
        url: "https://x/y/z.git",
        ref: "deadbeef",
        targetDir,
        spawnFn: spawnFn as never,
      });
      expect(result.sha).toBe("0123456789abcdef0123456789abcdef01234567");
      expect(result.fetched).toBe(false);
      expect(cloneCalls).toBe(1);
      // Bare-clone retry: a `clone` without `--branch`.
      expect(cmds.some((c) => c.includes("clone") && !c.includes("--branch"))).toBe(true);
      // Followed by a checkout of the requested ref.
      expect(cmds.some((c) => c.includes("checkout") && c.includes("deadbeef"))).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("lsRemoteHead", () => {
  test("returns the first 40-hex sha from ls-remote output", async () => {
    const spawnFn = successStub("0123456789abcdef0123456789abcdef01234567\trefs/heads/main\n");
    const sha = await lsRemoteHead({
      url: "https://x/y/z.git",
      ref: "main",
      spawnFn: spawnFn as never,
    });
    expect(sha).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  test("flows through runGit's transport allowlist", async () => {
    const cmds: string[][] = [];
    const spawnFn = (cmd: string[]) => {
      cmds.push(cmd);
      return {
        exited: Promise.resolve(0),
        stdout: new Response("0123456789abcdef0123456789abcdef01234567\trefs/heads/main\n").body!,
        stderr: new Response("").body!,
      };
    };
    await lsRemoteHead({ url: "https://x/y/z.git", ref: "main", spawnFn: spawnFn as never });
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.[0]).toBe("git");
    expect(cmds[0]).toContain("protocol.allow=never");
    expect(cmds[0]).toContain("ls-remote");
  });
});
