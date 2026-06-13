import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireGit } from "../../../src/core/knowledge/acquire";

let work: string;
let originUrl: string;

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "sparse-int-"));
  const origin = join(work, "origin");
  await mkdir(join(origin, "src", "deep"), { recursive: true });
  await mkdir(join(origin, "docs"), { recursive: true });
  await writeFile(join(origin, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(join(origin, "src", "deep", "b.ts"), "export const b = 2;\n");
  await writeFile(join(origin, "docs", "guide.md"), "# guide\n");
  await writeFile(join(origin, "root.txt"), "root\n");
  git(origin, "init", "-q", "-b", "main");
  git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
  git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
  originUrl = `file://${origin}`;
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("acquireGit sparse vs full coverage invariant", () => {
  test("sparse-scoped include materializes the SAME files as a full clone would", async () => {
    const sparse = await acquireGit({
      url: originUrl,
      ref: "main",
      include: ["src/**/*.ts"],
      cacheDir: await mkdtemp(join(tmpdir(), "sparse-cache-")),
    });
    const paths = sparse.artifacts.map((a) => a.relPath).sort();
    expect(paths).toEqual(["src/a.ts", "src/deep/b.ts"]);
  });

  test("no-filter whole-repo clone materializes everything", async () => {
    const full = await acquireGit({
      url: originUrl,
      ref: "main",
      cacheDir: await mkdtemp(join(tmpdir(), "full-cache-")),
    });
    const paths = full.artifacts.map((a) => a.relPath).sort();
    expect(paths).toEqual(["docs/guide.md", "root.txt", "src/a.ts", "src/deep/b.ts"]);
  });

  test("refresh after a commit yields the changed-path list", async () => {
    const cache = await mkdtemp(join(tmpdir(), "diff-cache-"));
    const first = await acquireGit({ url: originUrl, ref: "main", cacheDir: cache });
    expect(first.changedPaths).toBeNull();

    const origin = originUrl.replace("file://", "");
    await writeFile(join(origin, "docs", "guide.md"), "# guide v2\n");
    git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-aqm", "update guide");

    const second = await acquireGit({ url: originUrl, ref: "main", cacheDir: cache });
    expect(second.changedPaths).toEqual(["docs/guide.md"]);
  });

  test("symlinks are skipped identically under sparse and full (invariant guard)", async () => {
    const origin = originUrl.replace("file://", "");
    const { symlink } = await import("node:fs/promises");
    await symlink("a.ts", join(origin, "src", "link.ts")).catch(() => {});
    git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
    git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add symlink");

    const sparse = await acquireGit({
      url: originUrl,
      ref: "main",
      include: ["src/**/*.ts"],
      cacheDir: await mkdtemp(join(tmpdir(), "sym-sparse-")),
    });
    const full = await acquireGit({
      url: originUrl,
      ref: "main",
      cacheDir: await mkdtemp(join(tmpdir(), "sym-full-")),
    });
    const sparsePaths = sparse.artifacts.map((a) => a.relPath).sort();
    const fullSrc = full.artifacts
      .map((a) => a.relPath)
      .filter((p) => p.startsWith("src/"))
      .sort();
    expect(sparsePaths).not.toContain("src/link.ts");
    expect(sparsePaths).toEqual(fullSrc);
  });

  test("change outside include filter yields changedPaths=[] (skip re-index signal)", async () => {
    const cache = await mkdtemp(join(tmpdir(), "filter-diff-cache-"));
    const origin = originUrl.replace("file://", "");
    const first = await acquireGit({
      url: originUrl,
      ref: "main",
      include: ["src/**/*.ts"],
      cacheDir: cache,
    });
    expect(first.changedPaths).toBeNull(); // first acquire

    await writeFile(join(origin, "docs", "guide.md"), "# v2\n");
    git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-aqm", "docs only");

    const second = await acquireGit({
      url: originUrl,
      ref: "main",
      include: ["src/**/*.ts"],
      cacheDir: cache,
    });
    // diff sees docs/guide.md, which the src/**/*.ts include filters out -> []
    expect(second.changedPaths).toEqual([]);
  });
});
