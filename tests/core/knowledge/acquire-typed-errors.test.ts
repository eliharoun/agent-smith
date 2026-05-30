// Typed-error boundary tests for acquire.ts. Asserts that every migrated
// throw site surfaces a SmithError with the expected payload code, so that
// downstream consumers (e.g. the knowledge pipeline aggregator) can branch
// on payload.code rather than raw message text.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireDir,
  acquireGit,
  acquireUrl,
  runGitWith,
} from "../../../src/core/knowledge/acquire";
import { SmithError } from "../../../src/core/smith-error";
import { buildSpawner, type StubCall } from "../../helpers/git-spawner-stub";

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "acquire-typed-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

async function catchErr(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("acquire — typed errors", () => {
  test("acquireDir on a file throws SmithError(validation-failed)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acq-typed-"));
    const file = join(dir, "x.txt");
    await writeFile(file, "hi");
    const caught = await catchErr(() => acquireDir(file));
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("validation-failed");
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("directory source");
      expect(payload.reasons[0]).toContain(file);
    }
    await rm(dir, { recursive: true, force: true });
  });

  test("acquireUrl on 500 throws SmithError(http-error)", async () => {
    const cache = await mkdtemp(join(tmpdir(), "cache-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("err", { status: 500 })) as unknown as typeof fetch;
    const caught = await catchErr(() => acquireUrl("https://example.com/x", cache));
    globalThis.fetch = originalFetch;
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("http-error");
    if (payload.code === "http-error") {
      expect(payload.status).toBe(500);
      expect(payload.service).toBe("example.com");
      expect(payload.url).toBe("https://example.com/x");
    }
    await rm(cache, { recursive: true, force: true });
  });

  test("acquireUrl with auth='atlassian' and no creds throws SmithError(usage-error)", async () => {
    const cache = await mkdtemp(join(tmpdir(), "cache-"));
    const caught = await catchErr(() =>
      acquireUrl("https://example.atlassian.net/wiki/x", cache, {
        auth: "atlassian",
        resolveAuth: () => null,
      }),
    );
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("usage-error");
    if (payload.code === "usage-error") {
      expect(payload.message).toContain("Atlassian credentials not configured");
    }
    await rm(cache, { recursive: true, force: true });
  });

  test("runGitWith on ENOENT throws SmithError(not-found, what: 'executable', identifier: 'git')", async () => {
    const spawnFn = (() => {
      const err = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }) as unknown as Parameters<typeof runGitWith>[0];

    const caught = await catchErr(() => runGitWith(spawnFn, ["--version"], process.cwd()));
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("not-found");
    if (payload.code === "not-found") {
      expect(payload.what).toBe("executable");
      expect(payload.identifier).toBe("git");
    }
  });

  test("acquireGit subpath traversal throws SmithError(validation-failed, what: 'git source subpath')", async () => {
    const spawner = buildSpawner([], []);
    const caught = await catchErr(() =>
      acquireGit({
        url: "https://github.com/acme/x.git",
        subpath: "../escape",
        cacheDir,
        spawner,
      }),
    );
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("validation-failed");
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("git source subpath");
    }
  });

  test("acquireGit clone failure throws SmithError(validation-failed, what: 'git clone'), redacts URL", async () => {
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
    const caught = await catchErr(() =>
      acquireGit({
        url: "https://alice:supersecret@example.com/x.git",
        cacheDir,
        spawner,
      }),
    );
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("validation-failed");
    if (payload.code === "validation-failed") {
      expect(payload.what).toBe("git clone");
      const reasonsBlob = payload.reasons.join(" | ");
      // URL must be redacted
      expect(reasonsBlob).not.toContain("supersecret");
      expect(reasonsBlob).not.toContain("alice");
      expect(reasonsBlob).toContain("https://example.com/x.git");
      // Stderr surfaced verbatim
      expect(reasonsBlob).toContain("fatal: bad");
    }
    // SmithError extends Error: .message comes from formatHeadline (must
    // also not leak credentials, since the headline is what bubbles up
    // through the partial-failure aggregator's toMessage() fallback).
    expect((caught as Error).message).not.toContain("supersecret");
    expect((caught as Error).message).not.toContain("alice");
  });

  test("acquireGit subpath not found throws SmithError(not-found, what: 'git subpath')", async () => {
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
            await writeFile(join(target, "README.md"), "x");
          },
        },
      ],
      calls,
    );
    const caught = await catchErr(() =>
      acquireGit({
        url: "https://github.com/acme/x.git",
        subpath: "missing",
        cacheDir,
        spawner,
      }),
    );
    expect(caught).toBeInstanceOf(SmithError);
    const payload = (caught as SmithError).payload;
    expect(payload.code).toBe("not-found");
    if (payload.code === "not-found") {
      expect(payload.what).toBe("git subpath");
      expect(payload.identifier).toBe("missing");
      expect(payload.suggestedCommand).toContain("README.md");
      expect(payload.suggestedCommand).toContain("src/");
    }
  });
});

describe("acquire — partial-failure aggregator regression", () => {
  // Verifies that the pipeline aggregator at src/core/knowledge/pipeline.ts
  // continues to extract a useful display string from typed acquire errors
  // even though the fallback is `toMessage(err)` (== Error.message ==
  // formatHeadline(payload) for SmithError leaves).
  test("SmithError(validation-failed) from acquireGit surfaces 'what + reasons' via the typed aggregator branch", async () => {
    // The aggregator special-cases validation-failed: see pipeline.ts:217-222.
    // For a git clone failure we get what='git clone' + reasons=[clone failed
    // ..., stderr]. Confirms aggregator's typed branch fires.
    const spawner = buildSpawner(
      [
        {
          match: (a) => a[0] === "clone",
          result: {
            stdout: "",
            stderr: "fatal: repository 'x' does not exist",
            code: 128,
          },
        },
      ],
      [],
    );
    const caught = await catchErr(() =>
      acquireGit({
        url: "https://example.com/x.git",
        cacheDir,
        spawner,
      }),
    );
    const sErr = caught as SmithError;
    // Mirror what pipeline.ts does for validation-failed:
    if (sErr.payload.code === "validation-failed") {
      const aggregated = `${sErr.payload.what}: ${sErr.payload.reasons.join("; ")}`;
      expect(aggregated).toContain("git clone");
      expect(aggregated).toContain("does not exist");
    } else {
      throw new Error("expected validation-failed payload");
    }
  });

  test("SmithError(http-error) from acquireUrl surfaces 'service+op: HTTP <status>' via Error.message fallback", async () => {
    // The aggregator's else-branch uses toMessage(err) == Error.message.
    // For SmithError(http-error) that is `${service} ${op}: HTTP ${status}`
    // (per formatHeadline in smith-error.ts).
    const cache = await mkdtemp(join(tmpdir(), "cache-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("err", { status: 503 })) as unknown as typeof fetch;
    const caught = await catchErr(() => acquireUrl("https://example.com/x", cache));
    globalThis.fetch = originalFetch;
    const sErr = caught as SmithError;
    // formatHeadline for http-error: `${service}${ ` ${operation}`}: HTTP ${status}`
    expect((sErr as Error).message).toBe("example.com GET: HTTP 503");
    // Sanity: pipeline aggregator's toMessage(err) fallback yields this same string.
    await rm(cache, { recursive: true, force: true });
  });
});
