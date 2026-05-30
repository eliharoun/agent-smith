import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  acquireDir,
  acquireFile,
  acquireGlob,
} from "../../../src/core/knowledge/acquire";

describe("acquireFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-acq-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a single file and reports its filename", async () => {
    await writeFile(join(dir, "x.md"), "hello");
    const r = await acquireFile(join(dir, "x.md"));
    expect(r).toHaveLength(1);
    expect(r[0]?.filename).toBe("x.md");
    expect(r[0]?.bytes.toString("utf8")).toBe("hello");
  });

  it("throws ENOENT when missing", async () => {
    await expect(acquireFile(join(dir, "nope.md"))).rejects.toThrow();
  });
});

describe("acquireDir", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-acq-"));
    await writeFile(join(dir, "a.md"), "A");
    await writeFile(join(dir, "b.txt"), "B");
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "c.md"), "C");
    await writeFile(join(dir, "sub", "d.json"), "{}");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("recursively reads all files by default", async () => {
    const r = await acquireDir(dir);
    const names = r.map((a) => a.relPath).sort();
    expect(names).toEqual(["a.md", "b.txt", "sub/c.md", "sub/d.json"]);
  });

  it("respects include globs", async () => {
    const r = await acquireDir(dir, { include: ["**/*.md"] });
    const names = r.map((a) => a.relPath).sort();
    expect(names).toEqual(["a.md", "sub/c.md"]);
  });

  it("respects exclude globs", async () => {
    const r = await acquireDir(dir, { exclude: ["**/*.json", "sub/**"] });
    const names = r.map((a) => a.relPath).sort();
    expect(names).toEqual(["a.md", "b.txt"]);
  });
});

describe("acquireGlob", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smith-acq-"));
    await writeFile(join(dir, "a.md"), "A");
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "docs", "b.md"), "B");
    await writeFile(join(dir, "docs", "c.txt"), "C");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("matches files relative to the cwd", async () => {
    const r = await acquireGlob("**/*.md", dir);
    const names = r.map((a) => a.relPath).sort();
    expect(names).toEqual(["a.md", "docs/b.md"]);
  });
});
