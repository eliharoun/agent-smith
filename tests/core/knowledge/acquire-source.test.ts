import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcquiredArtifact } from "../../../src/core/knowledge/acquire";
import {
  acquireSource,
  chooseMaterializer,
  runMaterializer,
} from "../../../src/core/knowledge/acquire-source";
import type {
  DirSource,
  FileSource,
  GitSource,
  GlobSource,
} from "../../../src/core/knowledge/types";

async function makeTmp(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `acquire-source-${label}-`));
}

describe("acquireSource", () => {
  test("file source returns a single artifact with content", async () => {
    const bundleDir = await makeTmp("file");
    const cacheDir = await makeTmp("cache");
    try {
      await writeFile(join(bundleDir, "doc.md"), "# Hello\n", "utf8");
      const src: FileSource = { id: "f1", type: "file", delivery: "file", path: "doc.md" };
      const { artifacts, warnings } = await acquireSource(src, { bundleDir, cacheDir });
      expect(artifacts.length).toBe(1);
      expect(artifacts[0]?.filename).toBe("doc.md");
      expect(artifacts[0]?.bytes.toString("utf8")).toBe("# Hello\n");
      expect(warnings).toEqual([]);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("file source with absolute path bypasses bundleDir", async () => {
    const bundleDir = await makeTmp("file-abs");
    const otherDir = await makeTmp("file-other");
    const cacheDir = await makeTmp("cache");
    try {
      const abs = join(otherDir, "abs.md");
      await writeFile(abs, "abs content", "utf8");
      const src: FileSource = { id: "f-abs", type: "file", delivery: "file", path: abs };
      const { artifacts } = await acquireSource(src, { bundleDir, cacheDir });
      expect(artifacts.length).toBe(1);
      expect(artifacts[0]?.bytes.toString("utf8")).toBe("abs content");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(otherDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("dir source honors include/exclude", async () => {
    const bundleDir = await makeTmp("dir");
    const cacheDir = await makeTmp("cache");
    try {
      const sub = join(bundleDir, "src-dir");
      await mkdir(sub, { recursive: true });
      await writeFile(join(sub, "keep.md"), "keep", "utf8");
      await writeFile(join(sub, "drop.txt"), "drop", "utf8");
      const src: DirSource = {
        id: "d1",
        type: "dir",
        delivery: "file",
        path: "src-dir",
        include: ["**/*.md"],
        exclude: [],
      };
      const { artifacts } = await acquireSource(src, { bundleDir, cacheDir });
      expect(artifacts.length).toBe(1);
      expect(artifacts[0]?.filename).toBe("keep.md");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("glob source dispatches to acquireGlob", async () => {
    const bundleDir = await makeTmp("glob");
    const cacheDir = await makeTmp("cache");
    try {
      await writeFile(join(bundleDir, "a.md"), "a", "utf8");
      await writeFile(join(bundleDir, "b.md"), "b", "utf8");
      const src: GlobSource = { id: "g1", type: "glob", delivery: "file", path: "*.md" };
      const { artifacts } = await acquireSource(src, { bundleDir, cacheDir });
      expect(artifacts.length).toBe(2);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test("git source forwards options to spawner", async () => {
    const bundleDir = await makeTmp("git");
    const cacheDir = await makeTmp("cache");
    try {
      const calls: { args: string[]; cwd: string }[] = [];
      const spawner = async (args: string[], cwd: string) => {
        calls.push({ args, cwd });
        return { stdout: "", stderr: "", code: 0 };
      };
      const src: GitSource = {
        id: "git1",
        type: "git",
        delivery: "file",
        url: "https://example.invalid/repo.git",
        ref: "main",
        subpath: "docs",
        include: ["**/*.md"],
      };
      try {
        await acquireSource(src, { bundleDir, cacheDir, gitSpawner: spawner });
      } catch {
        // acquireGit may throw because the stubbed clone produced no working tree;
        // we only want to assert the spawner was invoked with git args.
      }
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.args[0]).toBe("clone");
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

describe("chooseMaterializer", () => {
  test("explicit source.materialize wins over inference", () => {
    const src: FileSource = {
      id: "x",
      type: "file",
      delivery: "file",
      path: "x.md",
      materialize: "passthrough",
    };
    const art: AcquiredArtifact = {
      filename: "x.html",
      relPath: "x.html",
      bytes: Buffer.from("<p>hi</p>"),
      contentType: "text/html",
    };
    expect(chooseMaterializer(src, art)).toBe("passthrough");
  });

  test("falls back to inference when no override", () => {
    const src: FileSource = { id: "x", type: "file", delivery: "file", path: "x.html" };
    const art: AcquiredArtifact = {
      filename: "x.html",
      relPath: "x.html",
      bytes: Buffer.from("<p>hi</p>"),
      contentType: "text/html",
    };
    expect(chooseMaterializer(src, art)).toBe("html-to-md");
  });
});

describe("runMaterializer", () => {
  test("passthrough returns content + empty warnings", () => {
    const art: AcquiredArtifact = {
      filename: "x.txt",
      relPath: "x.txt",
      bytes: Buffer.from("hello"),
    };
    const r = runMaterializer("passthrough", art);
    expect(r.content).toBe("hello");
    expect(r.warnings).toEqual([]);
  });

  test("json validates", () => {
    const art: AcquiredArtifact = {
      filename: "x.json",
      relPath: "x.json",
      bytes: Buffer.from('{"a":1}'),
    };
    const r = runMaterializer("json", art);
    expect(r.content).toContain('"a"');
  });

  test("html-to-md converts", () => {
    const art: AcquiredArtifact = {
      filename: "x.html",
      relPath: "x.html",
      bytes: Buffer.from("<h1>Hi</h1>"),
    };
    const r = runMaterializer("html-to-md", art);
    expect(r.content).toContain("Hi");
  });

  test("pdf-extract throws SmithError", () => {
    const art: AcquiredArtifact = {
      filename: "x.pdf",
      relPath: "x.pdf",
      bytes: Buffer.from("%PDF"),
    };
    expect(() => runMaterializer("pdf-extract", art)).toThrow();
  });
});
