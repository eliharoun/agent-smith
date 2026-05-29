import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../../src/cli/commands/init";
import { SmithError } from "../../src/core/smith-error";

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * First-ever test for `smith init` — pins the post-`f077248` behavior:
 *
 *   - creates `<baseDir>/agents/`
 *   - creates `<baseDir>/registry.json` with version=1 and one default
 *     user-global source entry
 *   - creates `<baseDir>/USER.md` with the starter template
 *   - does NOT create `<baseDir>/build/` (the legacy dir was removed in
 *     commit f077248; a regression here would silently bring it back)
 *   - does NOT clobber an existing USER.md
 *
 * `init()` accepts a `baseDir` parameter purely so this test can run
 * hermetically against a tmpdir; production callers (the CLI dispatcher
 * in src/index.ts) invoke `init()` with no args, which defaults to
 * `~/.config/agent-smith`.
 */

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "smith-init-"));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("cli/init", () => {
  test("creates agents/ directory", async () => {
    await init(base);
    expect(await dirExists(join(base, "agents"))).toBe(true);
  });

  test("creates registry.json with default user-global source", async () => {
    await init(base);
    const registryRaw = await readFile(join(base, "registry.json"), "utf8");
    const reg = JSON.parse(registryRaw);
    expect(reg.schemaVersion).toBe(2);
    expect(Array.isArray(reg.sources)).toBe(true);
    expect(reg.sources.length).toBeGreaterThanOrEqual(1);
    expect(reg.sources.some((s: { kind: string }) => s.kind === "user-global")).toBe(true);
  });

  test("creates USER.md with the starter template when one does not exist", async () => {
    await init(base);
    const userMd = await readFile(join(base, "USER.md"), "utf8");
    expect(userMd).toContain("# About me");
    expect(userMd).toContain("Replace this");
  });

  test("does NOT clobber an existing USER.md", async () => {
    // Set up a pre-existing USER.md with custom content the user has authored.
    const userPath = join(base, "USER.md");
    const customContent = "# About me\n\nI am a custom user. Do not overwrite me.\n";
    await writeFile(userPath, customContent);
    await init(base);
    const after = await readFile(userPath, "utf8");
    expect(after).toBe(customContent);
  });

  test("does NOT create build/ directory (regression guard for f077248)", async () => {
    // Commit f077248 removed creation of `~/.config/agent-smith/build/`
    // because it served no purpose. Pin that removal: if anyone re-adds
    // mkdir(build), this test fails.
    await init(base);
    expect(await dirExists(join(base, "build"))).toBe(false);
  });

  test("is idempotent — second invocation does not throw or change registry", async () => {
    await init(base);
    const registryAfterFirst = await readFile(join(base, "registry.json"), "utf8");
    await init(base); // should not throw
    const registryAfterSecond = await readFile(join(base, "registry.json"), "utf8");
    expect(registryAfterSecond).toBe(registryAfterFirst);
  });

  test("overwrites a version-skewed registry with the default and exits 0", async () => {
    // Pre-populate registry.json at version 99 — incompatible with the
    // current registry schema version. `smith init` is the recovery
    // tool, so it must auto-recover from this specific failure class
    // (rather than propagating the version-mismatch SmithError, which
    // would leave the user with no path forward except hand-deletion).
    await writeFile(
      join(base, "registry.json"),
      JSON.stringify({ version: 99, sources: [] }),
      "utf8",
    );
    const code = await init(base);
    expect(code).toBe(0);
    const reg = JSON.parse(await readFile(join(base, "registry.json"), "utf8"));
    // CURRENT_VERSION in src/io/registry.ts is 1.
    expect(reg.schemaVersion).toBe(2);
    expect(Array.isArray(reg.sources)).toBe(true);
    expect(reg.sources.some((s: { kind: string }) => s.kind === "user-global")).toBe(true);
  });

  test("propagates SmithError(registry-corrupt-json) — does not auto-recover from corrupt JSON", async () => {
    // Counterpart to the version-skew / shape-invalid recoveries:
    // those structured-failure classes are auto-recovered. A corrupt-
    // JSON registry might be a file the user could hand-fix, so init
    // must surface it rather than silently trample it with a default.
    await writeFile(join(base, "registry.json"), "{ not json", "utf8");
    let caught: unknown;
    try {
      await init(base);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SmithError);
    expect((caught as SmithError).payload.code).toBe("registry-corrupt-json");
  });

  test("overwrites a shape-invalid registry with the default and exits 0", async () => {
    // Symmetric to the version-skew recovery (IO-6). The
    // registry-corrupt-shape remediation tells users to re-run
    // `smith init`, so init must auto-recover from this class too —
    // otherwise the documented recovery path would just rethrow.
    await writeFile(
      join(base, "registry.json"),
      JSON.stringify({
        version: 1,
        sources: [
          { kind: "user-glabal", rootPath: "/x", label: "x" }, // typo'd kind
        ],
      }),
      "utf8",
    );
    const code = await init(base);
    expect(code).toBe(0);
    const reg = JSON.parse(await readFile(join(base, "registry.json"), "utf8"));
    expect(reg.schemaVersion).toBe(2);
    expect(reg.sources.some((s: { kind: string }) => s.kind === "user-global")).toBe(true);
    // The typo'd entry is gone — replaced by defaults.
    expect(reg.sources.some((s: { kind: string }) => s.kind === "user-glabal")).toBe(false);
  });
});
