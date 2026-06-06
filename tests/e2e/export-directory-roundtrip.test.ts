import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportBundle } from "../../src/core/export-bundle";
import { installFromDir } from "../../src/core/install-from-dir";

// XDG isolation so installFromDir's registry writes don't touch the real home.
let home: string;
let prevXdg: string | undefined;
let prevXdgState: string | undefined;
let outDir: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "export-dir-roundtrip-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = home;
  process.env.XDG_STATE_HOME = home;
  outDir = await mkdtemp(join(tmpdir(), "export-dir-roundtrip-out-"));
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgState;
  await rm(home, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
});

const FIXTURE_MINIMAL = join(import.meta.dir, "..", "_fixtures", "export-bundle-minimal");
// Matches the `name` field in the fixture's agent.config.json.
const BUNDLE_NAME = "minimal-bundle";

describe("directory-mode export round-trip", () => {
  test("export → install-from-dir → re-export preserves contentHash", async () => {
    // Step 1: export the minimal fixture to a directory.
    const r1 = await exportBundle({
      bundlePath: FIXTURE_MINIMAL,
      bundleName: BUNDLE_NAME,
      includeSkills: false,
      userMdPolicy: "stub",
      now: () => new Date("2026-06-05T15:00:00Z"),
      smithVersion: "1.11.0",
      format: "directory",
      outputPath: outDir,
    });

    // Step 2: register the output dir as a catalog. installFromDir uses
    // XDG_CONFIG_HOME (set above) so the registry write stays in the temp home.
    const importResult = await installFromDir({ localPath: outDir });
    expect(importResult.bundles).toContain(BUNDLE_NAME);

    // Step 3: re-export from the installed bundle directory.
    const out2 = await mkdtemp(join(tmpdir(), "round2-"));
    try {
      const r2 = await exportBundle({
        bundlePath: join(outDir, BUNDLE_NAME),
        bundleName: BUNDLE_NAME,
        includeSkills: false,
        userMdPolicy: "stub",
        now: () => new Date("2026-06-05T15:00:00Z"),
        smithVersion: "1.11.0",
        format: "directory",
        outputPath: out2,
      });

      // A stable contentHash proves the directory write is deterministic and
      // that install-from-dir faithfully preserves all persona files.
      expect(r2.contentHash).toBe(r1.contentHash);
    } finally {
      await rm(out2, { recursive: true, force: true });
    }
  });
});
