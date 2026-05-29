import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneOrFetch, type GitSpawner, lsRemoteHead, urlLockKey } from "../../src/io/git-clone";
import { createBareRemote } from "../fixtures/git-remote-helper";

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
      const spawner: GitSpawner = async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return { code: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "" };
      };
      await Promise.all([
        cloneOrFetch({ url: "https://x/y/z.git", ref: "main", targetDir, spawner }),
        cloneOrFetch({ url: "https://x/y/z.git", ref: "main", targetDir, spawner }),
        cloneOrFetch({ url: "https://x/y/z.git", ref: "main", targetDir, spawner }),
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
      const spawner: GitSpawner = async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return { code: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "" };
      };
      await Promise.all([
        cloneOrFetch({
          url: "https://x/y/a.git",
          ref: "main",
          targetDir: join(parent, "a"),
          spawner,
        }),
        cloneOrFetch({
          url: "https://x/y/b.git",
          ref: "main",
          targetDir: join(parent, "b"),
          spawner,
        }),
      ]);
      expect(maxInFlight).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("includes transport allowlist flags on clone (C4.0.4)", async () => {
    const parent = await mkdtemp(join(tmpdir(), "git-clone-tl-"));
    const targetDir = join(parent, "repo");
    const calls: string[][] = [];
    const spawner: GitSpawner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "" };
    };
    try {
      await cloneOrFetch({ url: "https://x/y/z.git", ref: "main", targetDir, spawner });
      const cloneInvocation = calls.find((c) => c.includes("clone"));
      expect(cloneInvocation).toBeDefined();
      const joined = cloneInvocation?.join(" ") ?? "";
      expect(joined).toMatch(/-c protocol\.allow=never/);
      expect(joined).toMatch(/-c protocol\.https\.allow=always/);
      expect(joined).toMatch(/-c protocol\.ssh\.allow=always/);
      expect(joined).toMatch(/-c protocol\.file\.allow=user/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("includes transport allowlist flags on fetch (C4.0.4)", async () => {
    const parent = await mkdtemp(join(tmpdir(), "git-clone-tl-fetch-"));
    const targetDir = join(parent, "repo");
    // Pre-create a .git dir so cloneOrFetch takes the fetch branch.
    await mkdir(join(targetDir, ".git"), { recursive: true });
    const calls: string[][] = [];
    const spawner: GitSpawner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "" };
    };
    try {
      await cloneOrFetch({ url: "https://x/y/z.git", ref: "main", targetDir, spawner });
      const fetchInvocation = calls.find((c) => c.includes("fetch"));
      expect(fetchInvocation).toBeDefined();
      expect(fetchInvocation?.join(" ")).toMatch(/-c protocol\.allow=never/);
      expect(fetchInvocation?.join(" ")).toMatch(/-c protocol\.https\.allow=always/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("includes transport allowlist flags on lsRemoteHead (C4.0.4)", async () => {
    const calls: string[][] = [];
    const spawner: GitSpawner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      return {
        code: 0,
        stdout: "0123456789abcdef0123456789abcdef01234567\trefs/heads/main\n",
        stderr: "",
      };
    };
    await lsRemoteHead({ url: "https://x/y/z.git", ref: "main", spawner });
    expect(calls).toHaveLength(1);
    const joined = calls[0]?.join(" ") ?? "";
    expect(joined).toMatch(/-c protocol\.allow=never/);
    expect(joined).toMatch(/-c protocol\.https\.allow=always/);
    expect(joined).toContain("ls-remote");
  });
});
