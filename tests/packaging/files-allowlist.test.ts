import { test, expect } from "bun:test";
import pkg from "../../package.json";

test("files allowlist ships the GUI as raw TS + prebuilt SPA", () => {
  const files: string[] = pkg.files;
  for (const required of ["gui/server/src", "gui/shared/src", "gui/web/dist"]) {
    expect(files).toContain(required);
  }
});

test("files allowlist excludes runtime-irrelevant + dangerous GUI paths", () => {
  const files: string[] = pkg.files;
  expect(files).not.toContain("gui/web/src");           // would re-arm the freshness guard
  expect(files).not.toContain("gui/server/tsconfig.json"); // not load-bearing after relative-import rewrite
  expect(files).not.toContain("gui");                   // too-broad: would leak src + node_modules
  expect(files).not.toContain("gui/server");            // too-broad: would leak server node_modules
});
