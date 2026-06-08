import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guiBundlePresent } from "../../src/cli/commands/gui";

describe("guiBundlePresent", () => {
  test("is true when gui/web/dist/index.html exists", () => {
    const root = mkdtempSync(join(tmpdir(), "smith-guard-"));
    mkdirSync(join(root, "gui", "web", "dist"), { recursive: true });
    writeFileSync(join(root, "gui", "web", "dist", "index.html"), "<!doctype html>");
    try {
      expect(guiBundlePresent(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is false when the built SPA is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "smith-guard-"));
    // dist/ dir exists but index.html is absent — the bundle is not built.
    mkdirSync(join(root, "gui", "web", "dist"), { recursive: true });
    try {
      expect(guiBundlePresent(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
