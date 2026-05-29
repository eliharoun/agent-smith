import { afterEach, beforeEach, describe, expect, it, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKnowledgeStage } from "../../../src/core/knowledge/pipeline";
import type { KnowledgeBlock } from "../../../src/core/knowledge/types";

describe("runKnowledgeStage", () => {
  let bundleDir: string;
  let knowledgeDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-pipe-bundle-"));
    knowledgeDir = await mkdtemp(join(tmpdir(), "smith-pipe-knw-"));
    cacheDir = join(knowledgeDir, ".cache");
  });
  afterEach(async () => {
    await rm(bundleDir, { recursive: true, force: true });
    await rm(knowledgeDir, { recursive: true, force: true });
  });

  it("processes a single inline file source: writes to disk, builds section, manifest", async () => {
    await writeFile(join(bundleDir, "schema.sql"), "select 1;");
    const block: KnowledgeBlock = {
      sources: [
        {
          id: "schema",
          type: "file",
          path: "./schema.sql",
          delivery: "inline",
          description: "Database schema",
        },
      ],
    };
    const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r.errors).toEqual([]);
    expect(r.section.inline).toHaveLength(1);
    expect(r.section.inline[0]?.id).toBe("schema");
    expect(r.section.inline[0]?.content).toContain("select 1;");
    expect(r.section.index).toEqual([]);

    const onDisk = await readFile(join(knowledgeDir, "sources/schema/schema.sql"), "utf8");
    expect(onDisk).toBe("select 1;");

    const m = JSON.parse(await readFile(join(knowledgeDir, "_manifest.json"), "utf8"));
    expect(m.schemaVersion).toBe(1);
    expect(m.sources).toHaveLength(1);
    expect(m.sources[0].id).toBe("schema");
    expect(m.sources[0].delivery).toBe("inline");
    expect(m.totals.tokensInline).toBeGreaterThan(0);
  });

  it("processes a file-mode dir source: writes files, builds index, no inline", async () => {
    await mkdir(join(bundleDir, "runbooks"));
    await writeFile(join(bundleDir, "runbooks", "deploy.md"), "# Deploy");
    await writeFile(join(bundleDir, "runbooks", "rollback.md"), "# Rollback");
    const block: KnowledgeBlock = {
      sources: [{ id: "runbooks", type: "dir", path: "./runbooks", delivery: "file" }],
    };
    const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r.errors).toEqual([]);
    expect(r.section.inline).toEqual([]);
    expect(r.section.index).toHaveLength(2);
    expect(r.section.index.map((i) => i.relPath).sort()).toEqual([
      "sources/runbooks/deploy.md",
      "sources/runbooks/rollback.md",
    ]);
  });

  it("auto-delivery picks inline for small single-file, file for many-files", async () => {
    await writeFile(join(bundleDir, "tiny.md"), "hi");
    await mkdir(join(bundleDir, "big"));
    await writeFile(join(bundleDir, "big", "a.md"), "A".repeat(50000));
    await writeFile(join(bundleDir, "big", "b.md"), "B".repeat(50000));
    const block: KnowledgeBlock = {
      inlineBudget: { totalTokens: 8000 },
      sources: [
        { id: "tiny", type: "file", path: "./tiny.md", delivery: "auto" },
        { id: "big", type: "dir", path: "./big", delivery: "auto" },
      ],
    };
    const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r.section.inline.map((s) => s.id)).toContain("tiny");
    expect(r.section.index.map((s) => s.relPath.split("/")[1])).toContain("big");
  });

  it("demotes inline sources past the budget to file-mode with a warning", async () => {
    await writeFile(join(bundleDir, "a.md"), "A".repeat(200000));
    await writeFile(join(bundleDir, "b.md"), "B".repeat(200000));
    const block: KnowledgeBlock = {
      inlineBudget: { totalTokens: 1000 },
      sources: [
        { id: "a", type: "file", path: "./a.md", delivery: "inline" },
        { id: "b", type: "file", path: "./b.md", delivery: "inline" },
      ],
    };
    const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r.warnings.some((w) => w.toLowerCase().includes("demoted"))).toBe(true);
    // CORE-7: when the cheap char-based pre-check trips, the value reported
    // is a lower bound (we never ran the real tokenizer). Must be marked with ≥.
    expect(
      r.warnings.some((w) => /inline tokens \(≥\d+\) exceed remaining budget \(\d+\)/.test(w)),
    ).toBe(true);
    expect(r.section.inline.length + r.section.index.length).toBe(2);
  });

  describe("pdf-extract materializer alignment (CORE-6 + CORE-9)", () => {
    test("running pdf-extract surfaces structured error and writes no output file", async () => {
      await writeFile(join(bundleDir, "doc.pdf"), "%PDF-fake");
      // Use `materialize: "pdf-extract"` directly to bypass the validator
      // (validator already rejects pdf-extract; this exercises the runtime
      // arm so any caller skipping validation gets a structured failure
      // instead of a 0-byte indexed file).
      const block: KnowledgeBlock = {
        sources: [
          {
            id: "manual",
            type: "file",
            path: "./doc.pdf",
            materialize: "pdf-extract",
            delivery: "file",
          },
        ],
      };
      const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });

      // Structured error row referencing the source id and the unsupported
      // materializer, with the reason surfaced.
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toContain("manual");
      expect(r.errors[0]).toContain("pdf-extract");
      expect(r.errors[0]!.toLowerCase()).toContain("not yet implemented");

      // Source must not be indexed and no inline content.
      expect(r.section.inline).toEqual([]);
      expect(r.section.index).toEqual([]);
      expect(r.manifest.sources).toEqual([]);

      // No output file written for this source. The per-source srcDir may
      // have been created (mkdir runs in Phase 3, but Phase 3 only runs
      // for processed sources — this source failed in Phase 1, so it's
      // not in `processed`). Either way, no file at sources/manual/doc.pdf.
      const outPath = join(knowledgeDir, "sources/manual/doc.pdf");
      await expect(readFile(outPath, "utf8")).rejects.toThrow();
    });
  });

  describe("unsupported source type alignment (CORE-2)", () => {
    test("unsupported source type surfaces validator-aligned wording via SmithError", async () => {
      // `npm` is in KnowledgeSourceType but the validator rejects it as
      // "type=npm is not supported yet". The runtime `default` arm must
      // produce the same wording (via SmithError) so callers bypassing
      // validation (e.g. programmatic sidecars) get a consistent message.
      const block: KnowledgeBlock = {
        sources: [
          {
            id: "pkg",
            // npm is a valid type but the pipeline's default arm rejects it
            // (acquire impl pending) — we're testing that runtime wording.
            type: "npm",
            package: "left-pad",
            delivery: "inline",
          },
        ],
      };
      const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });

      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toContain("pkg");
      expect(r.errors[0]).toContain("type=npm is not supported yet");
      // SmithError validation-failed should be formatted as `${what}: ${reasons}`.
      expect(r.errors[0]).toContain("knowledge source");

      expect(r.section.inline).toEqual([]);
      expect(r.section.index).toEqual([]);
      expect(r.manifest.sources).toEqual([]);
    });
  });

  it("collects per-source errors without aborting the stage", async () => {
    // Note: with atomic swap (Task 3), the returned `section` reflects what
    // would have been written, but the swap was aborted (no disk changes).
    // On-disk state remains the prior state.
    const block: KnowledgeBlock = {
      sources: [
        { id: "missing", type: "file", path: "./does-not-exist.md", delivery: "inline" },
        { id: "good", type: "file", path: "./good.md", delivery: "inline" },
      ],
    };
    await writeFile(join(bundleDir, "good.md"), "ok");
    const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r.errors.some((e) => e.includes("missing"))).toBe(true);
    expect(r.section.inline.map((s) => s.id)).toContain("good");
  });
});

describe("pipeline: url source auth pass-through", () => {
  let bundleDir: string;
  let knowledgeDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-pipe-bundle-"));
    knowledgeDir = await mkdtemp(join(tmpdir(), "smith-pipe-knw-"));
    cacheDir = join(knowledgeDir, ".cache");
  });
  afterEach(async () => {
    await rm(bundleDir, { recursive: true, force: true });
    await rm(knowledgeDir, { recursive: true, force: true });
  });

  test("forwards src.auth to acquireUrl", async () => {
    let capturedAuthHeader: string | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>;
      capturedAuthHeader = h?.["Authorization"] ?? h?.["authorization"];
      return new Response("hello", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }) as unknown as typeof fetch;

    const prevEmail = process.env["SMITH_ATLASSIAN_EMAIL"];
    const prevToken = process.env["SMITH_ATLASSIAN_API_TOKEN"];
    const prevBaseUrl = process.env["SMITH_ATLASSIAN_BASE_URL"];
    process.env["SMITH_ATLASSIAN_EMAIL"] = "alice@x";
    process.env["SMITH_ATLASSIAN_API_TOKEN"] = "tok-A";
    process.env["SMITH_ATLASSIAN_BASE_URL"] = "https://example.atlassian.net";

    try {
      const block: KnowledgeBlock = {
        sources: [
          {
            id: "wiki",
            type: "url",
            url: "https://acme.atlassian.net/wiki/x",
            delivery: "file",
            auth: "atlassian",
          },
        ],
      };
      const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
      expect(r.errors).toEqual([]);
      expect(capturedAuthHeader).toBe(`Basic ${Buffer.from("alice@x:tok-A").toString("base64")}`);
    } finally {
      globalThis.fetch = originalFetch;
      if (prevEmail === undefined) delete process.env["SMITH_ATLASSIAN_EMAIL"];
      else process.env["SMITH_ATLASSIAN_EMAIL"] = prevEmail;
      if (prevToken === undefined) delete process.env["SMITH_ATLASSIAN_API_TOKEN"];
      else process.env["SMITH_ATLASSIAN_API_TOKEN"] = prevToken;
      if (prevBaseUrl === undefined) delete process.env["SMITH_ATLASSIAN_BASE_URL"];
      else process.env["SMITH_ATLASSIAN_BASE_URL"] = prevBaseUrl;
    }
  });
});

describe("runKnowledgeStage: git source", () => {
  let bundleDirGit: string;
  let knowledgeDirGit: string;
  let cacheDirGit: string;

  beforeEach(async () => {
    bundleDirGit = await mkdtemp(join(tmpdir(), "smith-pipe-git-bundle-"));
    knowledgeDirGit = await mkdtemp(join(tmpdir(), "smith-pipe-git-knw-"));
    cacheDirGit = join(knowledgeDirGit, ".cache");
  });
  afterEach(async () => {
    await rm(bundleDirGit, { recursive: true, force: true });
    await rm(knowledgeDirGit, { recursive: true, force: true });
  });

  it("acquires a git source via the injected spawner and writes files", async () => {
    const url = "https://github.com/acme/repo.git";
    const block: KnowledgeBlock = {
      sources: [
        {
          id: "team-docs",
          type: "git",
          url,
          ref: "main",
          subpath: "docs",
          delivery: "file",
        },
      ],
    };

    const calls: { args: string[]; cwd: string }[] = [];
    const spawner = async (args: string[], cwd: string) => {
      calls.push({ args: [...args], cwd });
      if (args[0] === "clone") {
        const target = args[args.length - 1] as string;
        await mkdir(join(target, ".git"), { recursive: true });
        await mkdir(join(target, "docs"), { recursive: true });
        await writeFile(join(target, "README.md"), "top");
        await writeFile(join(target, "docs", "guide.md"), "# Guide");
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "unexpected", code: 128 };
    };

    const r = await runKnowledgeStage(
      block,
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
      { gitSpawner: spawner },
    );

    expect(r.errors).toEqual([]);
    expect(r.section.index.map((i) => i.relPath)).toEqual(["sources/team-docs/guide.md"]);
    expect(calls[0]?.args).toContain("--branch=main");
    expect(calls[0]?.args).toContain(url);
  });

  it("surfaces clone failure as a per-source error", async () => {
    const block: KnowledgeBlock = {
      sources: [
        {
          id: "broken",
          type: "git",
          url: "https://example.com/nonexistent.git",
          delivery: "file",
        },
      ],
    };

    const spawner = async (args: string[]) => {
      if (args[0] === "clone") {
        return {
          stdout: "",
          stderr: "fatal: repository 'https://example.com/nonexistent.git' does not exist\n",
          code: 128,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const r = await runKnowledgeStage(
      block,
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
      { gitSpawner: spawner },
    );

    expect(r.errors.some((e) => e.includes("broken") && e.includes("does not exist"))).toBe(true);
  });

  it("forwards include-zero-match warnings into result.warnings", async () => {
    const block: KnowledgeBlock = {
      sources: [
        {
          id: "empty-include",
          type: "git",
          url: "https://example.com/x.git",
          include: ["**/*.md"],
          delivery: "file",
        },
      ],
    };

    const spawner = async (args: string[]) => {
      if (args[0] === "clone") {
        const target = args[args.length - 1] as string;
        await mkdir(join(target, ".git"), { recursive: true });
        await writeFile(join(target, "only.txt"), "no markdown here");
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const r = await runKnowledgeStage(
      block,
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
      { gitSpawner: spawner },
    );

    expect(r.errors).toEqual([]);
    expect(
      r.warnings.some((w) => w.includes("empty-include") && /matched zero files/.test(w)),
    ).toBe(true);
  });

  it("creates a repos/<source-id> symlink pointing at the cache hash dir for each git source", async () => {
    const url = "https://github.com/acme/repo.git";
    const block: KnowledgeBlock = {
      sources: [
        {
          id: "team-docs",
          type: "git",
          url,
          delivery: "file",
        },
      ],
    };

    const spawner = async (args: string[]) => {
      if (args[0] === "clone") {
        const target = args[args.length - 1] as string;
        await mkdir(join(target, ".git"), { recursive: true });
        await writeFile(join(target, "README.md"), "# r");
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const r = await runKnowledgeStage(
      block,
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
      { gitSpawner: spawner },
    );

    expect(r.errors).toEqual([]);
    expect(r.section.hasGitSources).toBe(true);

    const linkPath = join(knowledgeDirGit, "repos", "team-docs");
    const linkStat = await lstat(linkPath);
    expect(linkStat.isSymbolicLink()).toBe(true);
    const linkValue = await readlink(linkPath);
    expect(linkValue).toBe("../.cache/git/" + createHash("sha256").update(url).digest("hex"));
    // And the symlink resolves to a directory containing the cloned files
    const readme = await readFile(join(linkPath, "README.md"), "utf8");
    expect(readme).toBe("# r");
  });

  it("does not create repos/ and leaves hasGitSources false when there are no git sources", async () => {
    const filePath = join(bundleDirGit, "inline.md");
    await writeFile(filePath, "# hello");

    const block: KnowledgeBlock = {
      sources: [{ id: "inline", type: "file", path: "inline.md", delivery: "file" }],
    };

    const r = await runKnowledgeStage(block, {
      bundleDir: bundleDirGit,
      knowledgeDir: knowledgeDirGit,
      cacheDir: cacheDirGit,
    });

    expect(r.errors).toEqual([]);
    expect(r.section.hasGitSources).toBeFalsy();

    const reposDir = join(knowledgeDirGit, "repos");
    await expect(lstat(reposDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("sweeps a stale repos/<id> symlink when its source is removed from config and the pipeline is re-run", async () => {
    const urlA = "https://github.com/acme/a.git";
    const urlB = "https://github.com/acme/b.git";

    const blockBoth: KnowledgeBlock = {
      sources: [
        { id: "git-a", type: "git", url: urlA, delivery: "file" },
        { id: "git-b", type: "git", url: urlB, delivery: "file" },
      ],
    };

    const spawner = async (args: string[]) => {
      if (args[0] === "clone") {
        const target = args[args.length - 1] as string;
        await mkdir(join(target, ".git"), { recursive: true });
        await writeFile(join(target, "README.md"), "x");
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    await runKnowledgeStage(
      blockBoth,
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
      { gitSpawner: spawner },
    );
    expect((await lstat(join(knowledgeDirGit, "repos", "git-a"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(knowledgeDirGit, "repos", "git-b"))).isSymbolicLink()).toBe(true);

    const blockOnlyA: KnowledgeBlock = {
      sources: [{ id: "git-a", type: "git", url: urlA, delivery: "file" }],
    };

    const r2 = await runKnowledgeStage(
      blockOnlyA,
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
      { gitSpawner: spawner },
    );

    expect(r2.errors).toEqual([]);
    expect((await lstat(join(knowledgeDirGit, "repos", "git-a"))).isSymbolicLink()).toBe(true);
    await expect(lstat(join(knowledgeDirGit, "repos", "git-b"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("surfaces a warning (and still succeeds) when symlink creation fails for one source", async () => {
    const url = "https://github.com/acme/repo.git";
    const block: KnowledgeBlock = {
      sources: [{ id: "blocked", type: "git", url, delivery: "file" }],
    };

    const spawner = async (args: string[]) => {
      if (args[0] === "clone") {
        // Plant the blocking file inside the tmpDir so it survives the
        // atomic swap and is present when symlink creation runs AFTER the
        // swap. Find the .tmp-stage-* dir in knowledgeDirGit.
        const { readdir: rd } = await import("node:fs/promises");
        const entries = await rd(knowledgeDirGit);
        const tmpDir = entries.find((e) => e.startsWith(".tmp-stage-"));
        if (tmpDir) {
          await mkdir(join(knowledgeDirGit, tmpDir, "repos"), { recursive: true });
          await writeFile(join(knowledgeDirGit, tmpDir, "repos", "blocked"), "i block the symlink");
        }
        const target = args[args.length - 1] as string;
        await mkdir(join(target, ".git"), { recursive: true });
        await writeFile(join(target, "README.md"), "k");
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const r = await runKnowledgeStage(
      block,
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
      { gitSpawner: spawner },
    );

    expect(r.errors).toEqual([]);
    expect(
      r.warnings.some((w) => w.includes("[blocked]") && w.includes("repo symlink creation failed")),
    ).toBe(true);
    expect(r.section.index.some((i) => i.relPath.startsWith("sources/blocked/"))).toBe(true);
  });

  it("preserves .cache/ across runs (wipes everything else under knowledgeDir)", async () => {
    // Pre-seed: simulate a previous run that left behind both cache and
    // non-cache artifacts under knowledgeDir.
    await mkdir(join(cacheDirGit, "git", "abc"), { recursive: true });
    await writeFile(join(cacheDirGit, "git", "abc", "marker"), "preserved");
    await writeFile(join(cacheDirGit, "deadbeef.json"), "{}");
    await mkdir(join(knowledgeDirGit, "sources", "old"), { recursive: true });
    await writeFile(join(knowledgeDirGit, "sources", "old", "stuff.txt"), "wiped");
    await writeFile(join(knowledgeDirGit, "_manifest.json"), "{}");

    // Run pipeline with an empty block (no sources). The wipe must still happen.
    await runKnowledgeStage(
      { sources: [] },
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
    );

    // Non-cache artifacts are gone
    await expect(lstat(join(knowledgeDirGit, "sources", "old"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Cache survives
    const marker = await readFile(join(cacheDirGit, "git", "abc", "marker"), "utf8");
    expect(marker).toBe("preserved");
    const urlEntry = await readFile(join(cacheDirGit, "deadbeef.json"), "utf8");
    expect(urlEntry).toBe("{}");
  });

  it("removes stale .cache/git/<hash>/ when a git source is removed from config and pipeline re-runs", async () => {
    const urlA = "https://github.com/acme/a.git";
    const urlB = "https://github.com/acme/b.git";
    const hashA = createHash("sha256").update(urlA).digest("hex");
    const hashB = createHash("sha256").update(urlB).digest("hex");

    const blockBoth: KnowledgeBlock = {
      sources: [
        { id: "git-a", type: "git", url: urlA, delivery: "file" },
        { id: "git-b", type: "git", url: urlB, delivery: "file" },
      ],
    };

    const spawner = async (args: string[]) => {
      if (args[0] === "clone") {
        const target = args[args.length - 1] as string;
        await mkdir(join(target, ".git"), { recursive: true });
        await writeFile(join(target, "README.md"), "x");
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    // First run: both clones land in cache.
    await runKnowledgeStage(
      blockBoth,
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
      { gitSpawner: spawner },
    );
    expect((await lstat(join(cacheDirGit, "git", hashA))).isDirectory()).toBe(true);
    expect((await lstat(join(cacheDirGit, "git", hashB))).isDirectory()).toBe(true);

    // Second run: git-b removed from config.
    const blockOnlyA: KnowledgeBlock = {
      sources: [{ id: "git-a", type: "git", url: urlA, delivery: "file" }],
    };

    const r2 = await runKnowledgeStage(
      blockOnlyA,
      { bundleDir: bundleDirGit, knowledgeDir: knowledgeDirGit, cacheDir: cacheDirGit },
      { gitSpawner: spawner },
    );

    expect(r2.errors).toEqual([]);
    // Symlink swept (existing v0.19.0 behavior)
    await expect(lstat(join(knowledgeDirGit, "repos", "git-b"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Cache swept (NEW v0.22.0 behavior)
    await expect(lstat(join(cacheDirGit, "git", hashB))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // git-a's cache is preserved
    expect((await lstat(join(cacheDirGit, "git", hashA))).isDirectory()).toBe(true);
  });
});

describe("pipeline: confluence source", () => {
  let bundleDir: string;
  let knowledgeDir: string;
  let cacheDir: string;
  const originalFetch = globalThis.fetch;
  const prevEmail = process.env["SMITH_ATLASSIAN_EMAIL"];
  const prevToken = process.env["SMITH_ATLASSIAN_API_TOKEN"];
  const prevBaseUrl = process.env["SMITH_ATLASSIAN_BASE_URL"];

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-pipe-bundle-"));
    knowledgeDir = await mkdtemp(join(tmpdir(), "smith-pipe-knw-"));
    cacheDir = join(knowledgeDir, ".cache");
  });

  afterEach(async () => {
    await rm(bundleDir, { recursive: true, force: true });
    await rm(knowledgeDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    if (prevEmail === undefined) delete process.env["SMITH_ATLASSIAN_EMAIL"];
    else process.env["SMITH_ATLASSIAN_EMAIL"] = prevEmail;
    if (prevToken === undefined) delete process.env["SMITH_ATLASSIAN_API_TOKEN"];
    else process.env["SMITH_ATLASSIAN_API_TOKEN"] = prevToken;
    if (prevBaseUrl === undefined) delete process.env["SMITH_ATLASSIAN_BASE_URL"];
    else process.env["SMITH_ATLASSIAN_BASE_URL"] = prevBaseUrl;
  });

  test("end-to-end: fetches one confluence page and writes it under sources/<id>/", async () => {
    process.env["SMITH_ATLASSIAN_EMAIL"] = "a@x";
    process.env["SMITH_ATLASSIAN_API_TOKEN"] = "tok";
    process.env["SMITH_ATLASSIAN_BASE_URL"] = "https://example.atlassian.net";
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: "42",
          title: "Architecture",
          body: { storage: { value: "<h1>arch</h1><p>doc</p>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const block: KnowledgeBlock = {
      sources: [
        {
          id: "wiki-eng",
          type: "confluence",
          space: "ENG",
          pages: [{ id: 42 }],
          format: "markdown",
          delivery: "file",
        },
      ],
    };
    const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });

    expect(r.errors).toEqual([]);
    expect(r.manifest.sources).toHaveLength(1);
    const entry = r.manifest.sources[0]!;
    expect(entry.id).toBe("wiki-eng");
    expect(entry.type).toBe("confluence");
    expect(entry.files).toHaveLength(1);
    expect(entry.files[0]!.path).toMatch(/sources\/wiki-eng\/42-architecture\.md/);
  });
});

describe("pipeline: jira source", () => {
  let bundleDir: string;
  let knowledgeDir: string;
  let cacheDir: string;
  const originalFetch = globalThis.fetch;
  const prevEmail = process.env["SMITH_ATLASSIAN_EMAIL"];
  const prevToken = process.env["SMITH_ATLASSIAN_API_TOKEN"];
  const prevBaseUrl = process.env["SMITH_ATLASSIAN_BASE_URL"];

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-pipe-bundle-"));
    knowledgeDir = await mkdtemp(join(tmpdir(), "smith-pipe-knw-"));
    cacheDir = join(knowledgeDir, ".cache");
  });

  afterEach(async () => {
    await rm(bundleDir, { recursive: true, force: true });
    await rm(knowledgeDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    if (prevEmail === undefined) delete process.env["SMITH_ATLASSIAN_EMAIL"];
    else process.env["SMITH_ATLASSIAN_EMAIL"] = prevEmail;
    if (prevToken === undefined) delete process.env["SMITH_ATLASSIAN_API_TOKEN"];
    else process.env["SMITH_ATLASSIAN_API_TOKEN"] = prevToken;
    if (prevBaseUrl === undefined) delete process.env["SMITH_ATLASSIAN_BASE_URL"];
    else process.env["SMITH_ATLASSIAN_BASE_URL"] = prevBaseUrl;
  });

  test("end-to-end: fetches jira issues and writes one .md per key", async () => {
    process.env["SMITH_ATLASSIAN_EMAIL"] = "a@x";
    process.env["SMITH_ATLASSIAN_API_TOKEN"] = "tok";
    process.env["SMITH_ATLASSIAN_BASE_URL"] = "https://example.atlassian.net";
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          issues: [
            { key: "ENG-100", fields: { summary: "first" } },
            { key: "ENG-101", fields: { summary: "second" } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const block: KnowledgeBlock = {
      sources: [
        {
          id: "tickets",
          type: "jira",
          jql: "project = ENG",
          delivery: "file",
        },
      ],
    };
    const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });

    expect(r.errors).toEqual([]);
    expect(r.manifest.sources[0]!.files.map((f) => f.path).sort()).toEqual([
      "sources/tickets/ENG-100.md",
      "sources/tickets/ENG-101.md",
    ]);
  });
});

describe("optional sources (CORE-8)", () => {
  let bundleDir: string;
  let knowledgeDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-pipe-opt-bundle-"));
    knowledgeDir = await mkdtemp(join(tmpdir(), "smith-pipe-opt-kn-"));
    cacheDir = await mkdtemp(join(tmpdir(), "smith-pipe-opt-cache-"));
    // Good source artifact: a real file.
    await writeFile(join(bundleDir, "good.md"), "# Good content\n");
  });

  afterEach(async () => {
    for (const d of [bundleDir, knowledgeDir, cacheDir]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("optional source with runtime error becomes a warning, other sources still materialize", async () => {
    const result = await runKnowledgeStage(
      {
        sources: [
          { id: "good", type: "file", path: "./good.md", delivery: "inline" },
          {
            id: "missing",
            type: "file",
            path: "./does-not-exist.md",
            delivery: "inline",
            optional: true,
          },
        ],
      },
      { bundleDir, knowledgeDir, cacheDir },
    );
    expect(result.errors).toEqual([]);
    expect(
      result.warnings.some((w) => w.includes("[missing]") && w.includes("optional source failed")),
    ).toBe(true);
    expect(result.manifest.sources.map((s) => s.id)).toEqual(["good"]);
  });

  it("optional source with validation-failed SmithError goes to warnings (per F.B)", async () => {
    // npm is a real NpmSource variant, but pipeline.acquire()'s default arm
    // throws SmithError(validation-failed) for it (no materializer wired yet).
    // optional:true demotes ALL errors to warnings — bundle validation belongs
    // at config-load time via Zod, not at materialization runtime.
    const result = await runKnowledgeStage(
      {
        sources: [
          {
            id: "pkg",
            type: "npm",
            package: "left-pad",
            delivery: "inline",
            optional: true,
          },
        ],
      },
      { bundleDir, knowledgeDir, cacheDir },
    );
    expect(result.errors).toEqual([]);
    expect(
      result.warnings.some((w) => w.includes("[pkg]") && w.includes("optional source failed")),
    ).toBe(true);
  });

  it("non-optional source with runtime error lands in errors (regression)", async () => {
    const result = await runKnowledgeStage(
      {
        sources: [
          {
            id: "missing",
            type: "file",
            path: "./does-not-exist.md",
            delivery: "inline",
          },
        ],
      },
      { bundleDir, knowledgeDir, cacheDir },
    );
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/\[missing\]/);
    expect(result.warnings.some((w) => w.includes("optional source failed"))).toBe(false);
  });
});

describe("pipeline: atomic materialization via tmp-dir + rename", () => {
  let bundleDir: string;
  let knowledgeDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "smith-pipe-atomic-bundle-"));
    knowledgeDir = await mkdtemp(join(tmpdir(), "smith-pipe-atomic-knw-"));
    cacheDir = join(knowledgeDir, ".cache");
  });
  afterEach(async () => {
    await rm(bundleDir, { recursive: true, force: true });
    await rm(knowledgeDir, { recursive: true, force: true });
  });

  test("prior-content-survives-failure: failed run leaves prior sources/ intact", async () => {
    // Run 1: successful pipeline populates sources/
    await writeFile(join(bundleDir, "good.md"), "# Good content");
    const block: KnowledgeBlock = {
      sources: [{ id: "doc", type: "file", path: "./good.md", delivery: "file" }],
    };
    const r1 = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r1.errors).toEqual([]);

    // Snapshot the file content from run 1
    const filePath = join(knowledgeDir, "sources/doc/good.md");
    const contentBefore = await readFile(filePath, "utf8");
    expect(contentBefore).toBe("# Good content");

    // Run 2: different sources — one that doesn't exist (non-optional).
    // With atomic approach: errors → no swap → run 1's content preserved.
    // With old wipe approach: wipe first → sources/doc/ gone → ENOENT.
    const blockFail: KnowledgeBlock = {
      sources: [{ id: "broken", type: "file", path: "./does-not-exist.md", delivery: "file" }],
    };
    const r2 = await runKnowledgeStage(blockFail, { bundleDir, knowledgeDir, cacheDir });
    expect(r2.errors.length).toBeGreaterThan(0);

    // Assert: prior content is preserved bit-for-bit
    const contentAfter = await readFile(filePath, "utf8");
    expect(contentAfter).toBe(contentBefore);
  });

  test("ENOSPC-mid-pipeline-preserves: liveDir untouched when all sources fail", async () => {
    // Run 1: successful pipeline
    await writeFile(join(bundleDir, "data.md"), "# Data");
    const block: KnowledgeBlock = {
      sources: [{ id: "data", type: "file", path: "./data.md", delivery: "file" }],
    };
    const r1 = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r1.errors).toEqual([]);

    const filePath = join(knowledgeDir, "sources/data/data.md");
    const contentBefore = await readFile(filePath, "utf8");
    expect(contentBefore).toBe("# Data");

    // Run 2: source that will fail (simulating mid-pipeline failure).
    // The key property: liveDir is untouched when errors occur.
    // Remove the source file so it fails during acquire.
    const { unlink } = await import("node:fs/promises");
    await unlink(join(bundleDir, "data.md"));

    const r2 = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r2.errors.length).toBeGreaterThan(0);

    // Assert: live state is unchanged
    const contentAfter = await readFile(filePath, "utf8");
    expect(contentAfter).toBe(contentBefore);

    // Assert: no leftover tmp dirs
    const { readdir: rd } = await import("node:fs/promises");
    const entries = await rd(knowledgeDir);
    const tmpDirs = entries.filter((e) => e.startsWith(".tmp-stage-"));
    expect(tmpDirs).toEqual([]);
  });

  test("crash-recovery-cleanup: stale .tmp-stage-* from prior run is swept at start", async () => {
    // Pre-seed a stale .tmp-stage-* directory with old mtime
    const staleDir = join(knowledgeDir, ".tmp-stage-99999-123456789");
    await mkdir(staleDir, { recursive: true });
    await writeFile(join(staleDir, "leftover.txt"), "stale");

    // Set mtime to 2 hours ago (older than 1h threshold)
    const { utimes } = await import("node:fs/promises");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(staleDir, twoHoursAgo, twoHoursAgo);

    // Also seed a .old-stage-* dir
    const staleOldDir = join(knowledgeDir, ".old-stage-88888-987654321");
    await mkdir(staleOldDir, { recursive: true });
    await utimes(staleOldDir, twoHoursAgo, twoHoursAgo);

    // Run pipeline
    await writeFile(join(bundleDir, "x.md"), "x");
    const block: KnowledgeBlock = {
      sources: [{ id: "x", type: "file", path: "./x.md", delivery: "file" }],
    };
    await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });

    // Assert: stale dirs are swept
    await expect(lstat(staleDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(staleOldDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("all-sources-fail leaves prior good state intact", async () => {
    // Run 1: successful pipeline
    await writeFile(join(bundleDir, "a.md"), "# A content");
    await writeFile(join(bundleDir, "b.md"), "# B content");
    const block: KnowledgeBlock = {
      sources: [
        { id: "a", type: "file", path: "./a.md", delivery: "file" },
        { id: "b", type: "file", path: "./b.md", delivery: "file" },
      ],
    };
    const r1 = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r1.errors).toEqual([]);

    // Snapshot
    const aContent = await readFile(join(knowledgeDir, "sources/a/a.md"), "utf8");
    const bContent = await readFile(join(knowledgeDir, "sources/b/b.md"), "utf8");

    // Run 2: ALL sources fail (non-optional) — different source IDs
    const blockAllFail: KnowledgeBlock = {
      sources: [
        { id: "x", type: "file", path: "./nonexistent1.md", delivery: "file" },
        { id: "y", type: "file", path: "./nonexistent2.md", delivery: "file" },
      ],
    };
    const r2 = await runKnowledgeStage(blockAllFail, { bundleDir, knowledgeDir, cacheDir });
    expect(r2.errors.length).toBe(2);

    // Assert: prior content preserved bit-for-bit
    const aAfter = await readFile(join(knowledgeDir, "sources/a/a.md"), "utf8");
    const bAfter = await readFile(join(knowledgeDir, "sources/b/b.md"), "utf8");
    expect(aAfter).toBe(aContent);
    expect(bAfter).toBe(bContent);
  });

  test("happy-path-tmp-cleaned-after-swap: no leftover .tmp-stage-* or .old-stage-*", async () => {
    await writeFile(join(bundleDir, "clean.md"), "# Clean");
    const block: KnowledgeBlock = {
      sources: [{ id: "clean", type: "file", path: "./clean.md", delivery: "file" }],
    };
    const r = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r.errors).toEqual([]);

    // Assert: no .tmp-stage-* or .old-stage-* dirs remain
    const { readdir: rd } = await import("node:fs/promises");
    const entries = await rd(knowledgeDir);
    const stageDirs = entries.filter(
      (e) => e.startsWith(".tmp-stage-") || e.startsWith(".old-stage-"),
    );
    expect(stageDirs).toEqual([]);

    // And the content is there
    const content = await readFile(join(knowledgeDir, "sources/clean/clean.md"), "utf8");
    expect(content).toBe("# Clean");
  });

  test("partial swap failure: tmpDir preserved for next-run cleanup", async () => {
    // Run 1: successful pipeline.
    await writeFile(join(bundleDir, "a.md"), "# A");
    const block: KnowledgeBlock = {
      sources: [{ id: "a", type: "file", path: "./a.md", delivery: "file" }],
    };
    const r1 = await runKnowledgeStage(block, { bundleDir, knowledgeDir, cacheDir });
    expect(r1.errors).toEqual([]);

    // Pre-create .cache/git so acquireGit's mkdir doesn't need liveDir writable.
    await mkdir(join(cacheDir, "git"), { recursive: true });

    // Use a git source with a spawner that chmods liveDir during acquire.
    // By the time the swap runs, liveDir is non-writable → mkdir(oldDir) throws.
    const blockGit: KnowledgeBlock = {
      sources: [{ id: "s", type: "git", url: "https://example.com/x.git", delivery: "file" }],
    };

    const { chmod, readdir: rd } = await import("node:fs/promises");
    const spawner = async (args: string[]) => {
      if (args[0] === "clone") {
        const target = args[args.length - 1] as string;
        await mkdir(join(target, ".git"), { recursive: true });
        await writeFile(join(target, "README.md"), "x");
        // Make liveDir non-writable AFTER tmpDir exists (created before try block).
        await chmod(knowledgeDir, 0o555);
        return { stdout: "", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    try {
      await expect(
        runKnowledgeStage(blockGit, { bundleDir, knowledgeDir, cacheDir }, { gitSpawner: spawner }),
      ).rejects.toThrow();

      // Assert: .tmp-stage-* is preserved (outer catch skipped rm because swapStarted).
      const entries = await rd(knowledgeDir);
      expect(entries.some((n) => n.startsWith(".tmp-stage-"))).toBe(true);
    } finally {
      await chmod(knowledgeDir, 0o755);
    }
  });
});
