import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireGit, type GitSpawner, runGitWith } from "../../../src/core/knowledge/acquire";
import { SmithError } from "../../../src/core/smith-error";
import { buildSpawner, type StubCall } from "../../helpers/git-spawner-stub";

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "acquire-git-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe("acquireGit: error messages do not leak credentials", () => {
  test("clone failure error redacts user:pass from url", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "fatal: bad", code: 128 },
        },
      ],
      calls,
    );

    let err: Error | undefined;
    try {
      await acquireGit({
        url: "https://alice:supersecret@example.com/x.git",
        cacheDir,
        spawner,
      });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    // Post-migration: clone failure surfaces as SmithError(validation-failed)
    // with what='git clone' and reasons that include the redacted URL + stderr.
    // The Error.message is the headline only; the URL/stderr live in payload.reasons.
    expect(err).toBeInstanceOf(SmithError);
    const payload = (err as SmithError).payload;
    expect(payload.code).toBe("validation-failed");
    if (payload.code === "validation-failed") {
      const blob = payload.reasons.join(" | ");
      expect(blob).not.toContain("supersecret");
      expect(blob).not.toContain("alice");
      expect(blob).toContain("https://example.com/x.git");
    }
    // The headline (Error.message) must also never leak credentials.
    expect(err!.message).not.toContain("supersecret");
    expect(err!.message).not.toContain("alice");
  });
});

describe("runGitWith: missing git binary", () => {
  test("translates ENOENT from spawn into a clear 'git not installed' error", async () => {
    const spawnFn = (() => {
      const err = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }) as unknown as Parameters<typeof runGitWith>[0];

    // Post-migration: ENOENT surfaces as SmithError(not-found,
    // what: "executable", identifier: "git") with an install-hint
    // suggestedCommand. The Error.message is the headline only
    // ("executable not found: git").
    let caught: unknown;
    try {
      await runGitWith(spawnFn, ["--version"], process.cwd());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("not-found");
    if (payload.code === "not-found") {
      expect(payload.what).toBe("executable");
      expect(payload.identifier).toBe("git");
      expect(payload.suggestedCommand).toMatch(/Install git/);
    }
  });
});

describe("runGitWith: transport allowlist hardening", () => {
  test("hardens every git invocation with the transport allowlist", async () => {
    let captured: string[] = [];
    const stub = (cmd: string[]) => {
      captured = cmd;
      return {
        exited: Promise.resolve(0),
        stdout: new Response("").body!,
        stderr: new Response("").body!,
      };
    };
    await runGitWith(
      stub as unknown as Parameters<typeof runGitWith>[0],
      ["clone", "https://example.com/x", "/tmp/x"],
      "/tmp",
    );
    // git binary first, then the protocol hardening, then the subcommand+args
    expect(captured[0]).toBe("git");
    expect(captured).toContain("protocol.allow=never");
    expect(captured).toContain("protocol.https.allow=always");
    expect(captured).toContain("protocol.ssh.allow=always");
    expect(captured).toContain("protocol.file.allow=user");
    // the actual subcommand still present and AFTER the -c flags
    expect(captured).toContain("clone");
    expect(captured.indexOf("clone")).toBeGreaterThan(captured.indexOf("protocol.allow=never"));
  });
});

describe("acquireGit: fresh clone", () => {
  test("clones to <cacheDir>/git/<sha256(url)> and returns repo files", async () => {
    const calls: StubCall[] = [];
    const url = "https://github.com/acme/example.git";

    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(target, { recursive: true });
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "README.md"), "# example");
            await writeFile(join(target, "schema.sql"), "select 1;");
          },
        },
      ],
      calls,
    );

    const { artifacts } = await acquireGit({
      url,
      cacheDir,
      spawner,
    });

    const names = artifacts.map((a) => a.relPath).sort();
    expect(names).toEqual(["README.md", "schema.sql"]);
    expect(artifacts.find((a) => a.relPath === "README.md")?.bytes.toString("utf8")).toBe(
      "# example",
    );

    // clone, then a `rev-parse HEAD` probe used to stamp the incremental
    // ingest manifest. This stub has no rev-parse matcher, so that probe
    // returns nonzero and no manifest is written (changedPaths stays null).
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args[0]).toBe("clone");
    expect(calls[0]?.args).toContain("--depth=1");
    expect(calls[0]?.args).toContain(url);
    expect(calls[1]?.args).toEqual(["rev-parse", "HEAD"]);
  });

  test("uses ref as --branch when provided", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(target, { recursive: true });
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "x.md"), "x");
          },
        },
      ],
      calls,
    );

    await acquireGit({
      url: "https://github.com/acme/x.git",
      ref: "release-1.2",
      cacheDir,
      spawner,
    });

    const cloneArgs = calls[0]?.args ?? [];
    expect(cloneArgs).toContain("--branch=release-1.2");
  });

  test("omits --branch when ref is undefined", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(target, { recursive: true });
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "x.md"), "x");
          },
        },
      ],
      calls,
    );

    await acquireGit({
      url: "https://github.com/acme/x.git",
      cacheDir,
      spawner,
    });

    const cloneArgs = calls[0]?.args ?? [];
    expect(cloneArgs.some((s) => s.startsWith("--branch="))).toBe(false);
  });

  test("hard-errors with git stderr when clone fails", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: {
            stdout: "",
            stderr: "fatal: Authentication failed for 'https://example.com/x.git/'\n",
            code: 128,
          },
        },
      ],
      calls,
    );

    // Post-migration: clone failure surfaces as SmithError(validation-failed)
    // whose reasons array includes the verbatim git stderr.
    let caught: unknown;
    try {
      await acquireGit({
        url: "https://example.com/x.git",
        cacheDir,
        spawner,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("validation-failed");
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("git clone");
      expect(payload.reasons.join(" | ")).toMatch(/Authentication failed/);
    }
  });
});

describe("acquireGit: refresh on existing clone", () => {
  test("branch ref triggers fetch + reset --hard origin/<ref>", async () => {
    const calls: StubCall[] = [];
    const url = "https://github.com/acme/x.git";
    const ref = "main";

    const cloneSpawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "README.md"), "v1");
          },
        },
      ],
      calls,
    );
    await acquireGit({ url, ref, cacheDir, spawner: cloneSpawner });
    calls.length = 0;

    const refreshSpawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "rev-parse",
          result: { stdout: "abc123\n", stderr: "", code: 0 },
        },
        {
          match: (a) => a[0] === "fetch",
          result: { stdout: "", stderr: "", code: 0 },
        },
        {
          match: (a) => a[0] === "reset",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async (cwd) => {
            await writeFile(join(cwd, "README.md"), "v2");
          },
        },
      ],
      calls,
    );

    const { artifacts } = await acquireGit({ url, ref, cacheDir, spawner: refreshSpawner });

    // Trailing rev-parse is the `rev-parse HEAD` manifest-stamp probe.
    expect(calls.map((c) => c.args[0])).toEqual(["rev-parse", "fetch", "reset", "rev-parse"]);
    expect(calls[1]?.args).toContain("origin");
    expect(calls[1]?.args).toContain("main");
    expect(calls[2]?.args).toContain("origin/main");
    expect(artifacts.find((a) => a.relPath === "README.md")?.bytes.toString("utf8")).toBe("v2");
  });

  test("immutable ref (rev-parse fails) skips fetch/reset", async () => {
    const calls: StubCall[] = [];
    const url = "https://github.com/acme/x.git";
    const ref = "v1.0.0";

    const seedSpawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "tag-content.md"), "pinned");
          },
        },
      ],
      calls,
    );
    await acquireGit({ url, ref, cacheDir, spawner: seedSpawner });
    calls.length = 0;

    const refreshSpawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "rev-parse",
          result: {
            stdout: "",
            stderr: `fatal: ambiguous argument 'origin/${ref}': unknown revision\n`,
            code: 128,
          },
        },
      ],
      calls,
    );

    const { artifacts } = await acquireGit({ url, ref, cacheDir, spawner: refreshSpawner });

    // First rev-parse is the origin/<ref> branch probe (fails → immutable, skip
    // fetch/reset); second is the `rev-parse HEAD` manifest-stamp probe.
    expect(calls.map((c) => c.args[0])).toEqual(["rev-parse", "rev-parse"]);
    expect(artifacts.find((a) => a.relPath === "tag-content.md")?.bytes.toString("utf8")).toBe(
      "pinned",
    );
  });
});

describe("acquireGit: subpath filter", () => {
  test("scopes the result to files under subpath", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await mkdir(join(target, "docs"), { recursive: true });
            await mkdir(join(target, "src"), { recursive: true });
            await writeFile(join(target, "README.md"), "top");
            await writeFile(join(target, "docs", "intro.md"), "intro");
            await writeFile(join(target, "docs", "guide.md"), "guide");
            await writeFile(join(target, "src", "x.ts"), "x");
          },
        },
      ],
      calls,
    );

    const { artifacts } = await acquireGit({
      url: "https://github.com/acme/x.git",
      subpath: "docs",
      cacheDir,
      spawner,
    });

    const names = artifacts.map((a) => a.relPath).sort();
    expect(names).toEqual(["guide.md", "intro.md"]);
  });

  test("rejects subpath that escapes the repo root (path traversal)", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "README.md"), "ok");
          },
        },
      ],
      calls,
    );

    // Post-migration: subpath traversal surfaces as
    // SmithError(validation-failed, what: "git source subpath") with the
    // detail in payload.reasons.
    let caught: unknown;
    try {
      await acquireGit({
        url: "https://github.com/acme/x.git",
        subpath: "../escape",
        cacheDir,
        spawner,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("validation-failed");
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("git source subpath");
      expect(payload.reasons.join(" | ")).toMatch(/subpath must not escape repository root/);
    }
    // Subpath traversal validation runs BEFORE clone — no I/O wasted on bad input.
    expect(calls).toEqual([]);
  });

  test("hard-errors when subpath does not exist, listing top-level entries", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await mkdir(join(target, "src"), { recursive: true });
            await writeFile(join(target, "README.md"), "top");
            await writeFile(join(target, "src", "x.ts"), "x");
          },
        },
      ],
      calls,
    );

    // Post-migration: missing subpath surfaces as SmithError(not-found,
    // what: "git subpath", identifier: "missing") with top-level entries in
    // suggestedCommand.
    let caught: unknown;
    try {
      await acquireGit({
        url: "https://github.com/acme/x.git",
        subpath: "missing",
        cacheDir,
        spawner,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("not-found");
    if (payload.code === "not-found") {
      expect(payload.what).toBe("git subpath");
      expect(payload.identifier).toBe("missing");
      expect(payload.suggestedCommand).toMatch(/README\.md.*src\//);
    }
  });
});

describe("acquireGit: include glob filter", () => {
  test("filters to matching files and emits no warning when matches found", async () => {
    const calls: StubCall[] = [];
    const warnings: string[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "a.md"), "A");
            await writeFile(join(target, "b.txt"), "B");
            await writeFile(join(target, "c.md"), "C");
          },
        },
      ],
      calls,
    );

    const { artifacts } = await acquireGit({
      url: "https://github.com/acme/x.git",
      include: ["**/*.md"],
      cacheDir,
      spawner,
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts.map((a) => a.relPath).sort()).toEqual(["a.md", "c.md"]);
    expect(warnings).toEqual([]);
  });

  test("warns (does not throw) when include matches zero files", async () => {
    const calls: StubCall[] = [];
    const warnings: string[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "a.txt"), "A");
          },
        },
      ],
      calls,
    );

    const { artifacts } = await acquireGit({
      url: "https://github.com/acme/x.git",
      include: ["**/*.md"],
      cacheDir,
      spawner,
      onWarning: (m) => warnings.push(m),
    });

    expect(artifacts).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/matched zero files/);
  });
});

describe("acquireGit: concurrency safety", () => {
  test("two concurrent calls for the same url serialize and both succeed", async () => {
    const url = "https://github.com/acme/concurrent.git";
    let cloneInFlight = 0;
    let maxConcurrentClones = 0;
    let cloneInvocations = 0;

    const spawner: GitSpawner = async (args, cwdParam) => {
      if (args[0] === "clone") {
        cloneInvocations += 1;
        cloneInFlight += 1;
        maxConcurrentClones = Math.max(maxConcurrentClones, cloneInFlight);
        // Simulate slow clone so the second caller has to wait on the lock.
        await new Promise((r) => setTimeout(r, 150));
        const target = args[args.length - 1] as string;
        await mkdir(join(target, ".git"), { recursive: true });
        await writeFile(join(target, "README.md"), "ok");
        cloneInFlight -= 1;
        return { stdout: "", stderr: "", code: 0 };
      }
      // refresh ops for the second caller (rev-parse + fetch + reset all succeed)
      return { stdout: "", stderr: "", code: 0 };
    };

    const [a, b] = await Promise.all([
      acquireGit({ url, cacheDir, spawner }),
      acquireGit({ url, cacheDir, spawner }),
    ]);

    expect(a.artifacts.map((x) => x.relPath)).toEqual(["README.md"]);
    expect(b.artifacts.map((x) => x.relPath)).toEqual(["README.md"]);
    // Critical assertion: the two operations did not run their clones concurrently.
    expect(maxConcurrentClones).toBe(1);
    // And the second caller saw an existing clone, so it took the refresh path
    // (zero clone ops) — not a second clone.
    expect(cloneInvocations).toBe(1);
  });
});

describe("acquireGit: .git as gitlink file (submodule/worktree)", () => {
  test("treats existing .git regular file as 'cloned' and takes refresh path", async () => {
    const url = "https://github.com/acme/gitlink.git";
    // Pre-create the cache dir for this URL with a .git regular file
    // (not directory) — the shape of a submodule/worktree gitlink.
    const repoKey = createHash("sha256").update(url).digest("hex");
    const repoDir = join(cacheDir, "git", repoKey);
    await mkdir(repoDir, { recursive: true });
    await writeFile(join(repoDir, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
    await writeFile(join(repoDir, "README.md"), "v1");

    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          // refresh path: rev-parse probe succeeds → branch flow
          match: (a) => a[0] === "rev-parse",
          result: { stdout: "abc\n", stderr: "", code: 0 },
        },
        {
          match: (a) => a[0] === "fetch",
          result: { stdout: "", stderr: "", code: 0 },
        },
        {
          match: (a) => a[0] === "reset",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async (cwd) => {
            await writeFile(join(cwd, "README.md"), "v2");
          },
        },
      ],
      calls,
    );

    const { artifacts } = await acquireGit({
      url,
      ref: "main",
      cacheDir,
      spawner,
    });

    // Critical: NO clone invocation. We took the refresh path because
    // .git existed (as a file, gitlink-style). Trailing rev-parse is the
    // `rev-parse HEAD` manifest-stamp probe.
    expect(calls.map((c) => c.args[0])).toEqual(["rev-parse", "fetch", "reset", "rev-parse"]);
    expect(calls.find((c) => c.args[0] === "clone")).toBeUndefined();
    expect(artifacts.find((a) => a.relPath === "README.md")?.bytes.toString("utf8")).toBe("v2");
  });
});

describe("acquireGit: stale lock recovery", () => {
  test("recovers from a lock file older than 5 minutes without waiting 30s", async () => {
    const url = "https://github.com/acme/stale.git";
    const repoKey = createHash("sha256").update(url).digest("hex");
    const cacheRoot = join(cacheDir, "git");
    await mkdir(cacheRoot, { recursive: true });
    const lockPath = join(cacheRoot, `${repoKey}.lock`);

    // Pre-create a stale lock with mtime 6 minutes ago.
    await writeFile(lockPath, "");
    const sixMinAgo = (Date.now() - 6 * 60 * 1000) / 1000;
    await utimes(lockPath, sixMinAgo, sixMinAgo);

    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "ok.md"), "ok");
          },
        },
      ],
      calls,
    );

    const start = Date.now();
    const { artifacts } = await acquireGit({ url, cacheDir, spawner });
    const elapsed = Date.now() - start;

    expect(artifacts.map((a) => a.relPath)).toEqual(["ok.md"]);
    // Must NOT have waited the full 30s lock timeout.
    expect(elapsed).toBeLessThan(5_000);
  });

  test("CORE-18: stale-lock recovery message is routed through onWarning when provided", async () => {
    const url = "https://github.com/acme/stale-warn.git";
    const repoKey = createHash("sha256").update(url).digest("hex");
    const cacheRoot = join(cacheDir, "git");
    await mkdir(cacheRoot, { recursive: true });
    const lockPath = join(cacheRoot, `${repoKey}.lock`);

    await writeFile(lockPath, "");
    const sixMinAgo = (Date.now() - 6 * 60 * 1000) / 1000;
    await utimes(lockPath, sixMinAgo, sixMinAgo);

    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "ok.md"), "ok");
          },
        },
      ],
      calls,
    );

    const warnings: string[] = [];
    await acquireGit({ url, cacheDir, spawner, onWarning: (m) => warnings.push(m) });

    expect(warnings.some((w) => w.includes("removing stale lock") && w.includes(lockPath))).toBe(
      true,
    );
  });
  test("does NOT remove a fresh lock (concurrency safety preserved)", async () => {
    // The existing concurrency test ("two concurrent calls for the same url
    // serialize and both succeed") would fail if stale-lock recovery removed
    // a fresh lock held by an in-flight clone. This test asserts the simpler
    // unit invariant directly: a freshly created lock survives one poll cycle.
    const url = "https://github.com/acme/fresh.git";
    const repoKey = createHash("sha256").update(url).digest("hex");
    const cacheRoot = join(cacheDir, "git");
    await mkdir(cacheRoot, { recursive: true });
    const lockPath = join(cacheRoot, `${repoKey}.lock`);
    await writeFile(lockPath, "");

    // Release the lock after 250ms so acquireGit eventually proceeds.
    const release = setTimeout(() => {
      void rm(lockPath, { force: true });
    }, 250);

    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "ok.md"), "ok");
          },
        },
      ],
      calls,
    );

    const start = Date.now();
    await acquireGit({ url, cacheDir, spawner });
    const elapsed = Date.now() - start;
    clearTimeout(release);

    // Should have waited at least one poll interval — proving the fresh lock
    // was respected and not bypassed as stale.
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });
});

describe("acquireGit: sparse clone argv", () => {
  test("blobless+sparse clone when include yields a static prefix", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        { match: (a) => a[0] === "clone", result: { stdout: "", stderr: "", code: 0 } },
        { match: (a) => a[0] === "sparse-checkout", result: { stdout: "", stderr: "", code: 0 } },
        { match: (a) => a[0] === "checkout", result: { stdout: "", stderr: "", code: 0 } },
        { match: (a) => a[0] === "rev-parse", result: { stdout: "abc123\n", stderr: "", code: 0 } },
      ],
      calls,
    );
    await acquireGit({
      url: "https://example.com/x.git",
      ref: "main",
      include: ["src/**/*.ts"],
      cacheDir,
      spawner,
    }).catch(() => {});
    const clone = calls.find((c) => c.args[0] === "clone");
    expect(clone).toBeDefined();
    expect(clone!.args).toEqual(
      expect.arrayContaining([
        "--depth=1",
        "--single-branch",
        "--filter=blob:none",
        "--no-checkout",
      ]),
    );
    const sparse = calls.find((c) => c.args[0] === "sparse-checkout");
    expect(sparse).toBeDefined();
    expect(sparse!.args).toEqual(["sparse-checkout", "set", "--no-cone", "/src/"]);
    expect(calls.some((c) => c.args[0] === "checkout")).toBe(true);
  });

  test("plain shallow clone (no sparse) when no static prefix exists", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        { match: (a) => a[0] === "clone", result: { stdout: "", stderr: "", code: 0 } },
        { match: (a) => a[0] === "rev-parse", result: { stdout: "abc\n", stderr: "", code: 0 } },
      ],
      calls,
    );
    await acquireGit({
      url: "https://example.com/x.git",
      ref: "main",
      include: ["**/*.md"],
      cacheDir,
      spawner,
    }).catch(() => {});
    const clone = calls.find((c) => c.args[0] === "clone");
    expect(clone).toBeDefined();
    // Exact array (not arrayContaining) to assert --filter/--no-checkout are ABSENT.
    expect(clone!.args).toEqual([
      "clone",
      "--depth=1",
      "--single-branch",
      "--branch=main",
      "https://example.com/x.git",
      expect.any(String),
    ]);
    expect(calls.some((c) => c.args[0] === "sparse-checkout")).toBe(false);
  });
});

describe("acquireGit: changed-path list", () => {
  test("first acquire returns changedPaths=null (full re-walk signal)", async () => {
    const calls: StubCall[] = [];
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: { stdout: "", stderr: "", code: 0 },
          sideEffect: async () => {
            const last = calls[calls.length - 1];
            const target = last?.args[last.args.length - 1] as string;
            await mkdir(join(target, ".git"), { recursive: true });
            await writeFile(join(target, "README.md"), "x");
          },
        },
        { match: (a) => a[0] === "rev-parse", result: { stdout: "sha1\n", stderr: "", code: 0 } },
      ],
      calls,
    );
    const res = await acquireGit({ url: "https://e.com/x.git", ref: "main", cacheDir, spawner });
    expect(res.changedPaths).toBeNull();
  });
});
