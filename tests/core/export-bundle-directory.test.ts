import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportBundle } from "../../src/core/export-bundle";

let outDir: string;

const FIXTURE_MINIMAL = join(import.meta.dir, "..", "_fixtures", "export-bundle-minimal");

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "export-dir-out-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("exportBundle — directory mode", () => {
  test("writes loose files at <to>/<name>/", async () => {
    const result = await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-05T15:00:00Z"),
      smithVersion: "1.11.0",
      format: "directory",
      outputPath: outDir,
    });
    const target = join(outDir, "minimal-bundle");
    expect(result.format).toBe("directory");
    expect(result.outputPath).toBe(target);
    expect(result.filesWritten).toBeDefined();
    expect(result.filesWritten!.length).toBeGreaterThanOrEqual(6);
    expect((await stat(join(target, "agent.config.json"))).isFile()).toBe(true);
    expect((await stat(join(target, "IDENTITY.md"))).isFile()).toBe(true);
    expect((await stat(join(target, "USER.md"))).isFile()).toBe(true);
  });

  test("includes _smith-export.json by default", async () => {
    await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-05T15:00:00Z"),
      smithVersion: "1.11.0",
      format: "directory",
      outputPath: outDir,
    });
    const manifestPath = join(outDir, "minimal-bundle", "_smith-export.json");
    const raw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    expect(manifest.bundle.name).toBe("minimal-bundle");
  });

  test("drops _smith-export.json when includeManifest is false", async () => {
    await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-05T15:00:00Z"),
      smithVersion: "1.11.0",
      format: "directory",
      outputPath: outDir,
      includeManifest: false,
    });
    await expect(stat(join(outDir, "minimal-bundle", "_smith-export.json"))).rejects.toThrow();
  });

  test("drops README.md by default", async () => {
    await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-05T15:00:00Z"),
      smithVersion: "1.11.0",
      format: "directory",
      outputPath: outDir,
    });
    await expect(stat(join(outDir, "minimal-bundle", "README.md"))).rejects.toThrow();
  });

  test("includes README.md when includeReadme is true", async () => {
    await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-05T15:00:00Z"),
      smithVersion: "1.11.0",
      format: "directory",
      outputPath: outDir,
      includeReadme: true,
    });
    expect((await stat(join(outDir, "minimal-bundle", "README.md"))).isFile()).toBe(true);
  });

  test("refuses if the destination <name>/ already exists", async () => {
    await mkdir(join(outDir, "minimal-bundle"));
    await writeFile(join(outDir, "minimal-bundle", "stale.txt"), "old");
    await expect(
      exportBundle({
        bundlePath: FIXTURE_MINIMAL,
        bundleName: "minimal-bundle",
        includeSkills: false,
        userMdPolicy: "stub",
        now: () => new Date("2026-06-05T15:00:00Z"),
        smithVersion: "1.11.0",
        format: "directory",
        outputPath: outDir,
      }),
    ).rejects.toMatchObject({
      payload: { code: "validation-failed", what: "output path" },
    });
  });

  test("force=true replaces the destination wholesale", async () => {
    await mkdir(join(outDir, "minimal-bundle"));
    await writeFile(join(outDir, "minimal-bundle", "stale.txt"), "old");
    await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: "minimal-bundle",
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-05T15:00:00Z"),
      smithVersion: "1.11.0",
      format: "directory",
      outputPath: outDir,
      force: true,
    });
    // Stale file is gone; export succeeded.
    await expect(stat(join(outDir, "minimal-bundle", "stale.txt"))).rejects.toThrow();
    expect((await stat(join(outDir, "minimal-bundle", "agent.config.json"))).isFile()).toBe(true);
  });
});
