import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { assertBundleFresh, mountStatic } from "./static";

let dir: string;
let prevSkipFlag: string | undefined;

beforeEach(async () => {
  // mountStatic invokes assertBundleFresh at mount time. Existing tests use a
  // synthetic dist fixture with no sibling src/, so the guard would no-op
  // anyway, but set the explicit skip flag for clarity & future-proofing.
  prevSkipFlag = process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK;
  process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK = "1";

  dir = await mkdtemp(join(tmpdir(), "static-"));
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "index.html"), "<html>root</html>");
  await writeFile(join(dir, "assets", "app.js"), "console.log('app')");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  if (prevSkipFlag === undefined) delete process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK;
  else process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK = prevSkipFlag;
});

describe("mountStatic", () => {
  it("serves index.html on /", async () => {
    const app = new Hono();
    mountStatic(app, dir);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("root");
  });

  it("serves asset files", async () => {
    const app = new Hono();
    mountStatic(app, dir);
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("app");
  });

  it("falls through to index.html for unknown routes (SPA)", async () => {
    const app = new Hono();
    mountStatic(app, dir);
    const res = await app.request("/agents/foo");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("root");
  });

  it("does not intercept /api/*", async () => {
    const app = new Hono();
    app.get("/api/ping", (c) => c.json({ ok: true }));
    mountStatic(app, dir);
    const res = await app.request("/api/ping");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

// Tests for assertBundleFresh exercise the guard directly, without the skip
// flag set, using real tmp filesystems.
describe("assertBundleFresh", () => {
  let root: string;
  // Save the suite-level skip flag and unset it for these guard-direct tests.
  let suiteSkipFlag: string | undefined;

  beforeEach(async () => {
    suiteSkipFlag = process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK;
    delete process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK;
    root = await mkdtemp(join(tmpdir(), "freshness-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    if (suiteSkipFlag === undefined) delete process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK;
    else process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK = suiteSkipFlag;
  });

  it("does not throw when dist is newer than src", async () => {
    const distRoot = join(root, "dist");
    const srcRoot = join(root, "src");
    await mkdir(distRoot, { recursive: true });
    await mkdir(srcRoot, { recursive: true });
    await writeFile(join(srcRoot, "App.tsx"), "x");
    // Make src older than dist by setting an old mtime on the src file.
    const old = new Date(Date.now() - 60_000);
    await utimes(join(srcRoot, "App.tsx"), old, old);
    await writeFile(join(distRoot, "index.html"), "<html/>");
    expect(() => assertBundleFresh(distRoot, srcRoot)).not.toThrow();
  });

  it("throws stale error when src is newer than dist", async () => {
    const distRoot = join(root, "dist");
    const srcRoot = join(root, "src");
    await mkdir(distRoot, { recursive: true });
    await mkdir(srcRoot, { recursive: true });
    await writeFile(join(distRoot, "index.html"), "<html/>");
    // Backdate dist/index.html so src will be newer.
    const old = new Date(Date.now() - 60_000);
    await utimes(join(distRoot, "index.html"), old, old);
    await writeFile(join(srcRoot, "App.tsx"), "x");
    expect(() => assertBundleFresh(distRoot, srcRoot)).toThrow(/stale/);
  });

  it("throws missing error when dist/index.html is absent", async () => {
    const distRoot = join(root, "dist");
    const srcRoot = join(root, "src");
    await mkdir(distRoot, { recursive: true });
    await mkdir(srcRoot, { recursive: true });
    expect(() => assertBundleFresh(distRoot, srcRoot)).toThrow(/missing/);
  });

  it("does not throw when src directory is absent (packaged install)", async () => {
    const distRoot = join(root, "dist");
    const srcRoot = join(root, "src");
    await mkdir(distRoot, { recursive: true });
    await writeFile(join(distRoot, "index.html"), "<html/>");
    // srcRoot intentionally not created
    expect(() => assertBundleFresh(distRoot, srcRoot)).not.toThrow();
  });

  it("skips entirely when SMITH_SKIP_BUNDLE_FRESHNESS_CHECK is set", async () => {
    const distRoot = join(root, "dist");
    const srcRoot = join(root, "src");
    // No dist/index.html, no src/ — would normally throw "missing".
    process.env.SMITH_SKIP_BUNDLE_FRESHNESS_CHECK = "1";
    expect(() => assertBundleFresh(distRoot, srcRoot)).not.toThrow();
  });

  it("ignores node_modules and dotfile directories during traversal", async () => {
    const distRoot = join(root, "dist");
    const srcRoot = join(root, "src");
    await mkdir(distRoot, { recursive: true });
    await mkdir(join(srcRoot, "node_modules"), { recursive: true });
    await mkdir(join(srcRoot, ".cache"), { recursive: true });
    await writeFile(join(distRoot, "index.html"), "<html/>");
    // Backdate dist so a real source file would trip the check.
    const old = new Date(Date.now() - 60_000);
    await utimes(join(distRoot, "index.html"), old, old);
    // Newer files inside skipped dirs should NOT trip the guard.
    await writeFile(join(srcRoot, "node_modules", "huge.js"), "x");
    await writeFile(join(srcRoot, ".cache", "stale.json"), "x");
    expect(() => assertBundleFresh(distRoot, srcRoot)).not.toThrow();
  });
});
