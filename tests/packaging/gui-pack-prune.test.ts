import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneGuiTests } from "../../scripts/gui-pack-prune";

describe("pruneGuiTests", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test("prunes test + snapshot files, keeps production source", () => {
    root = mkdtempSync(join(tmpdir(), "smith-prune-"));
    mkdirSync(join(root, "src", "__snapshots__"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const x = 1;");
    writeFileSync(join(root, "src", "app.test.ts"), "test('x', () => {});");
    writeFileSync(join(root, "src", "app.test.tsx"), "test('y', () => {});");
    writeFileSync(join(root, "src", "__snapshots__", "app.snap"), "snapshot");

    const removed = pruneGuiTests([join(root, "src")]);

    expect(existsSync(join(root, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(root, "src", "app.test.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "app.test.tsx"))).toBe(false);
    expect(existsSync(join(root, "src", "__snapshots__"))).toBe(false);
    // Assert the exact set removed, not just the count, so a wrong-path bug
    // can't pass on the length alone.
    expect(removed.sort()).toEqual(
      [
        join(root, "src", "app.test.ts"),
        join(root, "src", "app.test.tsx"),
        join(root, "src", "__snapshots__"),
      ].sort(),
    );
  });

  test("recurses into nested subdirs (mirrors gui/server/src layout)", () => {
    root = mkdtempSync(join(tmpdir(), "smith-prune-nested-"));
    mkdirSync(join(root, "src", "jobs", "__snapshots__"), { recursive: true });
    writeFileSync(join(root, "src", "jobs", "runner.ts"), "export const r = 1;");
    writeFileSync(join(root, "src", "jobs", "runner.test.ts"), "test('r', () => {});");
    writeFileSync(join(root, "src", "jobs", "__snapshots__", "x.snap"), "snap");

    const removed = pruneGuiTests([join(root, "src")]);

    expect(existsSync(join(root, "src", "jobs", "runner.ts"))).toBe(true);
    expect(existsSync(join(root, "src", "jobs", "runner.test.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "jobs", "__snapshots__"))).toBe(false);
    expect(removed.length).toBe(2);
  });

  test("no-ops on a missing root", () => {
    expect(pruneGuiTests([join(tmpdir(), "smith-prune-does-not-exist-xyz")])).toEqual([]);
  });

  test("removes explicitly-listed extra files (e.g. gui/README.md)", () => {
    root = mkdtempSync(join(tmpdir(), "smith-prune-extra-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const x = 1;");
    const readme = join(root, "README.md");
    writeFileSync(readme, "# dev docs");

    const removed = pruneGuiTests([join(root, "src")], [readme]);

    expect(existsSync(readme)).toBe(false);
    expect(existsSync(join(root, "src", "index.ts"))).toBe(true);
    expect(removed).toContain(readme);
  });

  test("skips extra files that do not exist", () => {
    root = mkdtempSync(join(tmpdir(), "smith-prune-extra-missing-"));
    mkdirSync(join(root, "src"), { recursive: true });
    const removed = pruneGuiTests([join(root, "src")], [join(root, "README.md")]);
    expect(removed).toEqual([]);
  });
});
