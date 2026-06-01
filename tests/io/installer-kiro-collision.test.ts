// Task 2.7: kiro same-name-different-filename collision scan.
// Two kiro agent JSON files declaring the same top-level `name` produce
// undefined kiro-cli runtime behavior. Smith refuses to add to the
// conflict on first install; warns and proceeds on reinstall.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstallPaths, RenderedAgent } from "../../src/core/types";
import { installRendered } from "../../src/io/installer";

let homeDir: string;
let installRoot: string;
let paths: InstallPaths;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "smith-kiro-collision-home-"));
  installRoot = mkdtempSync(join(tmpdir(), "smith-kiro-collision-target-"));
  paths = {
    opencode: join(installRoot, "opencode/agents"),
    "claude-code": join(installRoot, "claude/agents"),
    codex: join(installRoot, "agents/skills"),
    kiro: join(installRoot, ".kiro/agents"),
    "agents-md": join(installRoot, ".agents-md/agents"),
  };
});
afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(installRoot, { recursive: true, force: true });
});

const fakeKiroRender = (name: string): RenderedAgent => ({
  target: "kiro",
  format: "json",
  relativePath: `${name}.json`,
  data: { name, description: "from smith", prompt: "B" },
});

describe("kiro same-name-different-filename scan", () => {
  test("first install refuses when an external file declares the same name", async () => {
    mkdirSync(paths.kiro, { recursive: true });
    // Pre-existing file from another tool, declaring name "shared" at a
    // different filename (mimics AIM's <Pkg>-<name>.json convention).
    writeFileSync(
      join(paths.kiro, "OtherPackage-shared.json"),
      JSON.stringify({ name: "shared", description: "from another tool" }),
    );

    await expect(
      installRendered([fakeKiroRender("shared")], paths, { homeDir }),
    ).rejects.toThrow(/name collision|already declares name|same name/i);
  });

  test("reinstall warns but proceeds when external file pre-existed", async () => {
    mkdirSync(paths.kiro, { recursive: true });
    // First install: smith's bundle, no conflicts yet.
    await installRendered([fakeKiroRender("shared")], paths, { homeDir });

    // Now another tool drops a conflicting file at a different filename.
    writeFileSync(
      join(paths.kiro, "OtherPackage-shared.json"),
      JSON.stringify({ name: "shared", description: "from another tool" }),
    );

    // Reinstall: manifest entry exists → warn, proceed.
    const result = await installRendered([fakeKiroRender("shared")], paths, { homeDir });
    expect(result.installed.length + result.skipped.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => /name 'shared'/i.test(w))).toBe(true);
  });

  test("no collision when external file has different name", async () => {
    mkdirSync(paths.kiro, { recursive: true });
    writeFileSync(
      join(paths.kiro, "OtherPackage-different.json"),
      JSON.stringify({ name: "different", description: "from another tool" }),
    );

    const result = await installRendered([fakeKiroRender("shared")], paths, { homeDir });
    expect(result.installed).toHaveLength(1);
    expect(result.warnings.some((w) => /collision|same name/i.test(w))).toBe(false);
  });

  test("malformed JSON in dir is silently tolerated", async () => {
    mkdirSync(paths.kiro, { recursive: true });
    writeFileSync(join(paths.kiro, "broken.json"), "not valid json {{{");

    // Install proceeds without throwing on the malformed file.
    const result = await installRendered([fakeKiroRender("shared")], paths, { homeDir });
    expect(result.installed).toHaveLength(1);
  });

  test("scan does not match smith's own file (same path, same name)", async () => {
    // First install creates the file at <name>.json. A reinstall MUST
    // NOT see itself as a collision (the scan skips ourFilename).
    const result1 = await installRendered([fakeKiroRender("self")], paths, { homeDir });
    expect(result1.installed).toHaveLength(1);

    // Reinstall the exact same agent. No collision warning expected.
    const result2 = await installRendered([fakeKiroRender("self")], paths, { homeDir });
    expect(result2.warnings.some((w) => /collision|same name/i.test(w))).toBe(false);
  });
});
